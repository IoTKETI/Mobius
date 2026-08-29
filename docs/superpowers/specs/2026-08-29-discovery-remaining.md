# discovery 남은 작업

discovery 를 재귀 CTE 로 통일하고(`origin/lite` 기준) 골격 재귀를 분기 1개로
줄이는 데까지 끝냈다. 그 과정에서 확인했지만 손대지 않은 것들을 순서대로 적는다.

배경과 실측치는 커밋 메시지와 `mobius/sql_action.js` 의 `build_descendant_sql`
주석, `migrations/004-lookup-pi-notcin-index.js` 에 있다.

**현재 성능 (배포 서버, 조용한 상태, 2026-08-29)**

| 질의 | 지금 | 20분기 때 | CTE 이전(레벨 방식) |
|---|---|---|---|
| `fu=1&ty=3&lim=100` | 442ms | 4,994ms | 804ms |
| `fu=1&ty=3&lbl=status` | 779ms / 96건 | 5,350ms / 96건 | 4,462ms / **6건** |
| `fu=1&ty=3&ofst=1000` | 438ms / 100건 | 4,991ms / 100건 | 3,985ms / **0건** |
| `fu=1&ty=3&lim=2000` | 2,231ms | 6,803ms | 2,934ms |
| 좁은 경로 20건 평균 | 27ms | 32ms | 72ms |

---

## 1. `select_spec_ri` 의 N+1 — **완료 (2026-08-29 배포)**

타입별로 묶어 `where ri in (...)` 로 던지도록 바꿨다. ri 가 최대 200자라
500개씩 끊는다. 배포 서버 실측:

| | 전 | 후 |
|---|---|---|
| `fu=1&ty=3&lim=2000` | 2,231ms | **550ms** |
| 그 요청이 던지는 질의 | 2,000회 넘음 | **6회** (CTE 1 + `cnt` 청크 4 + hit 1) |
| `fu=1&ty=3&lim=100` | 442ms | 436ms / **3회** |

지켜야 했던 동작 두 가지는 `test/select-spec-ri.test.js` 로 고정했다:
키 순서(=응답 순서) 보존, 타입 테이블에 짝 없는 행 제거.

곁들여 고친 것: `typeRsrc` 에 없는 `ty` 가 어느 `ri` 인지 로그에 남기고,
파사드 규약(`cb(true, errObj)`)대로 둘째 인자에서 오류 메시지를 읽는다.
그리고 `search_lookup` 이 "인덱스가 없다" 를 따로 알린다 — `force index`
때문에 마이그레이션 004 를 안 돌리면 discovery 가 전부 500 이 되는데,
로컬에서 실제로 겪었다(새로 설치하면 `mobiusdb.sql` 이 만들어 주므로
업그레이드만 해당).

<details>
<summary>원래 문제 설명</summary>

`mobius/sql_action.js` 의 `select_spec_ri` 가 discovery 결과 **한 건마다 질의
하나**를 순차로 던진다. `mobius/resource.js` 의 `retrieve` 가 `fu`/`rcn` 과
무관하게 이 함수를 부르므로, `lim=2000` 이면 CTE 1회 + 단건 조회 2,000회다.
그동안 커넥션 하나를 계속 쥔다.

`fu=1`(uril, 경로만 필요) 일 때도 전부 던진다. `lim=2000` 이 2,231ms 인 이유의
상당 부분이 여기로 보인다.

고칠 방향: 타입별로 묶어 `where ri in (...)` 한 번씩. 타입 수만큼(최대 몇 회)
줄어든다. `Object.keys(found_Obj)[count]` 를 행마다 다시 만드는 O(n²) 도 같이.

주의: 이 함수는 `lookup` 에는 있는데 타입 테이블에 없는 행을 응답에서 빼는
역할도 한다(`delete found_Obj[ri]`). 그 동작을 유지해야 한다 — 배포 서버에
그런 행이 실제로 2건 있다.

</details>

## 2. `X-M2M-CTS` / `X-M2M-CTO` — **완료 (2026-08-29 배포)**

`search_lookup` 의 콜백을 `callback(code, { rows, limit, offset })` 으로 바꿔,
SQL 에 실제로 건 한도와 돌려준 행 수를 호출부에 넘긴다. 판정은
"SQL 이 한도를 정확히 채웠는가" 이고, 다음 오프셋은 `offset + rows` 다.

세 가지가 고쳐졌다:
1. 상수 2000 대신 요청의 실효 한도와 비교 — `lim=100` 도 신호를 받는다
2. `la` 요청은 `query.la` 가 실효 한도다
3. CTO 를 `select_spec_ri` 가 고아 행을 걷어내기 **전** 행 수로 계산 —
   DB 가 건너뛴 만큼과 일치한다

배포 서버 실측 (컨테이너 30,281개, `lim=2000` 으로 CTO 만 따라가기):
16페이지, **중복 0건**, 30,279건 수집(= 30,281 − 고아 2건), 마지막 페이지에
CTS 없음. 페이지 7·8 은 고아가 껴서 1,999건이었지만 CTO 는 2,000씩 전진했다 —
예전 계산이었으면 여기서 어긋나 이후 페이지가 계속 밀렸다.

헤더 자체는 `tools/discovery-compare/headers.js` 로 9케이스를 검증한다
(MySQL / SQLite 양쪽).

<details>
<summary>원래 문제 설명</summary>


`mobius/resource.js` 의 `retrieve` 가 `Object.keys(foundObj).length >= max_lim`
(상수 2000)일 때만 잘림 헤더를 붙인다. 요청이 `lim=100` 이면 결과가 잘려도
클라이언트는 더 있는지 알 방법이 없다.

구조적으로는 더 깊은 문제가 있다: `search_lookup` 의 콜백이 코드만 넘기고
SQL 이 준 행 수를 안 넘긴다. 그래서 호출부는 "SQL 이 정확히 lim 을 채웠다(잘림)"
와 "lim 보다 적게 왔다(완결)" 를 구분할 수단이 없다. 콜백 계약을 바꿔야 한다.

</details>

## 3. `sza` / `szb` / `cty` — **완료 (2026-08-29 배포)**

셋 중 하나라도 있으면 `cin` 을 조인한다:
`join cin c on c.pi = r.pi and c.ri = r.ri`. 조인 키를 (pi, ri) 둘 다로 잡아
`cin_ri_idx(pi, ri, cs)` 가 `cs` 까지 담게 했다 — `sza`/`szb` 만 쓰면 cin 행을
읽지 않는다. `cnf` 는 인덱스에 없어 행 접근이 필요하다.

`cs` 는 MySQL 이 int, SQLite 가 TEXT 라 SQLite 에서만 캐스팅한다. 안 하면
어느 쪽에도 수치 affinity 가 없어 정수가 늘 텍스트보다 작다고 판정되고,
`10 <= cs` 가 모든 행에서 참이 되어 필터가 무력해진다.

성능도 같이 잡아야 했다. `cs`/`cnf` 는 contentInstance 에만 있으므로:
- 요청 `ty` 에 4 가 없으면 답이 있을 수 없다 → 질의를 아예 안 던진다
- `ty` 를 안 줘도 `where r.ty = '4'` 를 명시한다 → (pi, ty) 인덱스가 CIN 만 집는다

배포 서버 실측:

| 질의 | 전 | 후 |
|---|---|---|
| `fu=1&ty=3&sza=10` | 30,048ms / **500** | 68ms / 200 (0건) |
| `fu=1&ty=3&szb=100000` | 30,044ms / **500** | 31ms / 200 (0건) |
| `fu=1&ty=3&cty=...` | 9,207ms / 500 | 70ms / 200 |
| `fu=1&ty=4&sza=100` (컨테이너 안) | — | 82ms / 5건 |

`cnf` 는 클라이언트가 준 contentInfo 를 그대로 저장하므로(예 `text/plain:0`)
정확 일치로 본다. 배포 서버는 표본 2만 건이 전부 빈 문자열이라 `cty` 를 쓰는
클라이언트는 없는 것으로 보인다.

검증 도구: `tools/discovery-compare/size-filter.js` (12케이스, 두 백엔드).

<details>
<summary>원래 문제 설명</summary>


oneM2M discovery 필터다 — contentInstance 를 크기(`sza`=sizeAbove,
`szb`=sizeBelow)와 형식(`cty`=contentType)으로 거른다. `build_search_query` 가
`cs` / `cnf` 로 조건을 만드는데 그 컬럼은 `cin` 에만 있고 `lookup` 에는 없다.
SQL 준비 단계에서 깨지므로 데이터 규모와 무관하게 항상 500 이다.

트리거 범위는 좁다: `?sza=100` 만 붙이면 200 이고(`fu` 기본값이 2, `rcn` 이 1이라
discovery 경로를 안 탄다), `fu=1&...&sza=100` 이나 `fu=2&rcn=4&...&sza=100` 이 500 이다.

8년 전 `mobiusdb.sql` 에서 컬럼을 뺄 때 `sql_action.js` 를 안 고쳤고, `test/` 에
이 셋을 다루는 케이스가 0건이라 안 걸렸다. 실트래픽 사용 기록은 없다.

고칠 방향: `cin` 과 조인. `sza`/`szb` 는 커버링 인덱스 `cin_ri_idx(pi, ri, cs)`
로 싸고, `cnf` 만 행 접근이 필요해 비용 등급이 다르다.

</details>

## 4. discovery 결과에 리소스별 ACP 검사가 없다

`app.js` 가 **대상 리소스**에만 discovery 권한을 본다. 결과에 담긴 개별
리소스의 접근 권한은 확인하지 않는 것으로 보인다. 권한 문제라 성능 작업과
섞으면 안 된다 — 먼저 권한 없는 리소스가 실제로 노출되는지 재현부터 할 것.

## 5. 안 쓰는 인덱스 — **005 적용됨, 006 은 관찰 후**

**확인 결과: `idx_lookup_ct` 는 안 쓰이고 `idx_lookup_sri` 는 쓰인다.**

배포 서버 실측 (2026-08-29, MySQL 가동 40.6시간 누적,
`performance_schema.table_io_waits_summary_by_index_usage`):

| 인덱스 | 읽기 | 크기 |
|---|---|---|
| `idx_lookup_pi_notcin` | 12,925,133 | 10.0GB |
| `idx_lookup_pi_ty_ct` | 3,292,103 | 11.1GB |
| `ri_UNIQUE` | 98,317 | 9.7GB |
| `idx_lookup_ty` | 37,561 | 9.7GB |
| (테이블 스캔) | 16,171 | — |
| `idx_lookup_sri` | 15,883 | 15.5GB |
| PRIMARY | 14,584 | 22.2GB |
| **`idx_lookup_ct`** | **0** | **15.6GB** |

코드로도 교차 확인했다. `lookup` 을 `ct` 로 거르거나 정렬하는 곳은 전부
`pi`(대개 `ty` 까지)와 함께라 `idx_lookup_pi_ty_ct` 가 처리한다 — discovery 의
`la` 정렬, `delete_oldest`, `select_edge_resource`. `ct` 단독 접근은 없고
만료 스윕은 `et` 를 쓴다. 이 DB 를 쓰는 다른 프로세스도 없다(접속은 Mobius 워커뿐).

**진행 상태**
- `migrations/005` (INVISIBLE) — **배포 서버 적용 완료** (0.2초, 메타데이터만).
  옵티마이저가 안 쓰는 상태를 위험 없이 흉내 낸다. 되돌리기는 1초:
  `ALTER TABLE lookup ALTER INDEX idx_lookup_ct VISIBLE;`
- `migrations/006` (DROP) — **아직 적용 안 함.** 하루 이상 관찰한 뒤 적용한다.

**관찰할 것** (005 적용 뒤 하루 이상 두고):
```sql
select ifnull(index_name,'(TABLE SCAN)'), count_read
  from performance_schema.table_io_waits_summary_by_index_usage
 where object_schema='mobiusdb' and object_name='lookup'
 order by count_read desc;
```
응답 시간에 변화가 없고 위 표의 다른 인덱스 분포가 그대로면 006 을 적용한다.
적용 뒤 15.6GB 가 회수되고, `lookup` 에 쓰는 모든 질의가 인덱스 하나를 덜
유지한다. DROP 자체는 빠르지만(002 에서 2.5초) 되돌리려면 수십 분이다.

`mobiusdb.sql` 에서도 뺐다 — 안 그러면 신규 설치가 다시 만든다.

<details>
<summary>원래 조사 항목</summary>


`lookup` 의 인덱스 총량이 61.4GB 다 (데이터는 22.2GB).

| 인덱스 | 크기 |
|---|---|
| PRIMARY (pi, ri, ty) | 22.2GB |
| `idx_lookup_ct` (ct) | 15.6GB |
| `idx_lookup_sri` (sri) | 15.5GB |
| `idx_lookup_pi_ty_ct` (pi, ty, ct) | 11.1GB |
| `idx_lookup_pi_notcin` (pi, not_cin) | 10.0GB |
| `idx_lookup_ty` (ty) | 9.7GB |
| `ri_UNIQUE` (ri) | 9.7GB |

`idx_lookup_ct` 가 의심스럽다. 마이그레이션 001 의 주석이 "옵티마이저가
`idx_lookup_ct` 를 역방향 스캔하며 pi 로 걸러낸다"를 문제로 지목했고, 그걸
고치려고 `idx_lookup_pi_ty_ct` 를 만들었다. 그 뒤로 `ct` 단독 인덱스를 쓰는
질의가 남아 있는지 확인하지 않았다.

확인 방법: `performance_schema.table_io_waits_summary_by_index_usage` 로 인덱스별
읽기 횟수를 본다(서버 기동 이후 누적이므로 충분히 지난 뒤에 볼 것). 0 이면
후보다. 쓰기마다 갱신 비용이 드는 것이라 안 쓰면 지우는 게 낫다.

지울 때 주의: `DROP INDEX` 자체는 빠르지만(002 에서 2.5초) 되돌리려면 다시
수십 분이 든다. 그리고 `information_schema` 통계만으로 "안 쓴다"고 단정하면 안
된다 — 드물게 도는 관리 질의가 쓸 수 있다. 최소 하루치 사용량을 보고 판단할 것.

디스크는 여유가 있다(3.6TB 중 2.9TB). 급한 일은 아니다.

</details>
