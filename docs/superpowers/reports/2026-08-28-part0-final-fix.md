# 최종 수정 웨이브 보고서 — admin-console-part0

전수 리뷰의 지적 사항 12건(Critical 2, Important 6, Minor 5 — 실제로는 Minor 를 세부
분해해 5항목)을 한 번에 반영했다. 추가로 검증 중에 발견한 같은 계열 결함 1건을 함께
고쳤다(§I4-b).

- 기준선: `npm test` 105/105
- 최종: `npm test` **126/126** (21건 추가, 실패 0)
- 선언한 제약(`var`/세미콜론, 콜백 시그니처 유지, RSC 문자열 리터럴, 요청당 로깅 금지,
  SQL 은 `sql_action.js` 에만, `global.usesqlite` 는 `mobius/db` 파사드에서만 읽기,
  다중 워커 전제, 배포 종속 값 금지)는 전부 지켰다.
- `conf.json` 은 백업 후 작업했고 **변경되지 않았다**(`diff` 로 확인, 커밋되지 않음).
- 띄운 서버는 모두 종료했고, 테스트 리소스는 DB 에 남기지 않았다(§정리 확인).

---

## CRITICAL 1 — CIN 삽입 무효화가 캐시 처리량과 클러스터 확장을 막던 문제

### (a) 자손 스윕 제거

`mobius/resource.js` 의 CIN 삽입 경로만 `cache_man.invalidate()` →
`cache_man.invalidate_self()` 로 바꿨다. 삭제(DELETE) 경로의 서브트리 스윕은 그대로 둔다.

- `mobius/cache_man.js`: `invalidate_self_local(ri)` / `invalidate_self(ri)` 추가.
  `store.delete(ri)` 한 번(O(1))만 하고 `{__mobius_cache_inv:true, ri, self:true}` 를
  브로드캐스트한다. `_on_message` 는 `self === true` 면 O(1) 삭제만 한다 — 받는 쪽에서도
  스윕이 일어나면 브로드캐스트 비용이 워커 수에 비례해 늘어난다.
- 근거: CIN 삽입으로 바뀌는 것은 부모 CNT 행의 `st`/`cni`/`cbs` 뿐이고 자손은 하나도
  바뀌지 않는다.

### (b) 세대 검사를 키별로

`generation` 은 단조 증가 논리 시계로 남기고, `Map<key, generation>`(`inv_gen`)에 키별
무효화 시점을 기록한다. `app.js:check_resource_from_url` 의
`if (cache_man.generation() === gen)` 를 `cache_man.set_if_unchanged(ri, row, gen)` 로 교체했다.

- `set_if_unchanged` 는 `ri` 와 **그 조상 접두어**를 따라 올라가며 확인한다(경로 깊이,
  oneM2M 에서 보통 4~5회). 조상 검사가 없으면 `invalidate('/Mobius/ae1')` 이
  아직 store 에 없는(= 지금 in-flight 로 읽히는 중인) `'/Mobius/ae1/cnt1'` 의 재캐싱을
  막지 못한다 — `keys_for` 는 store 에 있는 것만 찾을 수 있기 때문이다.
- **맵 상한**: `inv_gen` 은 `cache_limit` 과 같은 상한을 쓴다. 넘치면 가장 오래된
  기록부터 축출하되 그 세대를 `floor_gen` 으로 올리고, `gen < floor_gen` 인 채움은
  전부 거부한다(fail-closed). 축출은 오래된 것부터이므로 `floor_gen` 은 낮게 유지된다.
- `invalidate_all()` 은 `inv_gen` 을 비우고 `floor_gen` 을 현재 세대로 올린다.

### 벤치마크 (동일 방법, 50,000 항목, `invalidate_local` 계측)

스크립트는 `/Mobius/ae<i>/cnt<j>/4-<k>` 형태의 실제 트리를 흉내 내 50,000 항목을 채운 뒤
2,000회 호출의 평균을 잰다.

수정 **전**:

```
invalidate_local (subtree scan): 1.0358 ms/call  (store=50000, iter=2000)  -> 965 calls/sec
invalidate_self_local: (아직 없음 — 수정 전 코드)
```

수정 **후**:

```
invalidate_local (subtree scan): 1.0354 ms/call  (store=50000, iter=2000)  -> 966 calls/sec
invalidate_self_local (O(1)): 0.0003 ms/call  (store=50000, iter=2000)  -> 3055768 calls/sec
```

`invalidate_local` 자체는 그대로다(삭제 경로가 계속 쓴다). CIN 경로가 부르는 함수가
**1.0354 ms → 0.0003 ms (약 3,400배)** 로 줄었다. 리뷰가 잰 0.6379 ms 와 절대값이 다른
것은 장비/트리 형태 차이이며, 개선 비율이 요점이다.

### 커버 테스트

`test/cache-man.test.js` (9건 추가):

| 테스트 | 무엇을 잠그는가 |
|---|---|
| `invalidate_self 는 자기 자신만 지우고 자손을 축출하지 않는다` | (a) 요구된 테스트 |
| `invalidate_self 는 self:true 를 브로드캐스트하고, 받는 쪽도 자손을 남긴다` | 수신 측 O(1) |
| `삭제 경로의 invalidate 는 여전히 자손을 걷어낸다` | 스윕이 사라지지 않았음 |
| `set_if_unchanged: 관계없는 리소스의 무효화는 채움을 막지 않는다` | (b) 전역 카운터 회귀 방지 |
| `set_if_unchanged: 그 키 자신이 무효화됐으면 채우지 않는다` | TOCTOU 보존 |
| `set_if_unchanged: 조상이 무효화됐으면 in-flight 자손 채움을 막는다` | (b) 요구된 테스트 |
| `set_if_unchanged: 무효화가 조회 시작 *전* 이었으면 채운다` | 과잉 차단 방지 |
| `set_if_unchanged: invalidate_all 이후에는 그 전에 시작된 채움을 전부 막는다` | floor 동작 |
| `set_if_unchanged: 세대 기록 맵은 상한을 넘지 않고, 축출분은 fail-closed 로 막힌다` | 맵 상한 |

명령: `node --test test/cache-man.test.js` — 전부 통과 (전체 스위트 결과는 §검증).

---

## CRITICAL 2 — 추출된 ipv6 분기가 잘못된 클라이언트 IP 를 봐서 헤더 스푸핑으로 ACP 우회

### 원본 확인

`git show bad4d4c:mobius/security.js` 로 직접 확인했다. `_pv`(:84)와 `_pvs`(:268) 모두
ipv6 분기는 `request.connection.remoteAddress` 를 **가공 없이** 비교한다 — 헤더 오버라이드도,
`::1` → `ip.address()` 치환도, `'::ffff:'` 제거도 없다. ipv4 분기만 그 유도를 거친다.
리뷰의 지적이 정확했다.

### 수정

- `mobius/acp_eval.js`: `checkAcip(acco_entry, clientIp, rawRemoteAddress, ipv6_idx_ref)` 로
  인자를 늘리고, ipv6 분기 비교를 `list6[j] === rawRemoteAddress` 로 바꿨다.
  `checkAcco` 가 `ctx.rawRemoteAddress` 를 전달한다.
- `mobius/security.js`: `raw_remote_address_of(request)` 를 추가하고 `ctx_of` 와
  `ctx_of_pvs` **양쪽**이 `rawRemoteAddress` 를 싣는다(원본이 여기서는 대칭이므로 대칭).
- `client_ip_of` / `client_ip_of_pvs` 주석에 **ipv4 분기 전용 유도값**임을 명시했다.
- 이 파일의 다른 `KNOWN BUG` 는 하나도 건드리지 않았다.

### 커버 테스트 — 리뷰 표의 두 행을 그대로

`test/acp-eval.test.js` (단위, 2건) + `test/security-delegation.test.js` (security.check
경유 end-to-end, 3건):

| 케이스 | bad4d4c | 수정 전 HEAD | 수정 후 |
|---|---|---|---|
| 루프백 클라이언트, `acip.ipv6: ['::1']` | `'1'` 허용 | `'0'` 거부 | **`'1'` 허용** |
| 스푸핑 `remoteaddress: 2001:db8::5` vs `acip.ipv6: ['2001:db8::5']` | `'0'` 거부 | `'1'` 허용 | **`'0'` 거부** |

`_pvs` 경로(ty='1')에도 같은 루프백 케이스를 추가했다 — `ctx_of_pvs` 가 누락되는 회귀를
잡는다.

또한 기존 테스트 `KNOWN BUG: ipv6_idx leak 은 뒤따르는 acr 의 ipv6 매치로 해소된다` 는
ctx 에 `rawRemoteAddress` 가 없어 "매치되지 않는데도 통과"하는 상태였다(sentinel 이 비교
*전에* 대입되므로 결과만 우연히 같았다). ctx 팩토리에 `rawRemoteAddress: '::ffff:10.0.0.5'`
를 추가하고 그 테스트의 ipv6 목록을 실제로 매치되는 값으로 고쳐, 원래 의도한 경로를 다시
타게 했다.

### 판별력 확인 (수정을 되돌려 실패하는지)

```
$ sed -i 's/list6[j] === rawRemoteAddress/list6[j] === clientIp/' mobius/acp_eval.js
$ node --test test/acp-eval.test.js test/security-delegation.test.js
ℹ pass 24
ℹ fail 5
✖ failing tests:
✖ divergence 회귀: ipv6 분기는 유도된 clientIp 가 아니라 소켓 주소 원본을 본다 (루프백 허용)
✖ divergence 회귀: ipv6 분기는 remoteaddress 헤더 스푸핑을 통과시키지 않는다
✖ Critical 2: _pv 의 ipv6 분기는 루프백 소켓 주소(::1)를 그대로 보고 허용한다
✖ Critical 2: _pvs 의 ipv6 분기도 루프백 소켓 주소를 그대로 보고 허용한다
✖ Critical 2: remoteaddress 헤더로는 ipv6 제약을 우회할 수 없다
```

되돌리면 5건 전부 실패, 복원하면 전부 통과. 이후 `mobius/acp_eval.js` 는 복원했다
(`grep` 으로 `rawRemoteAddress` 복귀 확인).

---

## I3 — `mobius/mobiusdb.sql` 미갱신으로 신규 MySQL 설치가 아무것도 못 받던 문제

`mobius/mobiusdb.sql` 에 다음을 반영했다.

- `hit_ri` 테이블 (`PRIMARY KEY (ri, ct)` + `KEY idx_hit_ri_ct (ct)`), `lcp` 앞에 배치
- `lookup` 에 `KEY idx_lookup_ty_et (ty, et)`, `KEY idx_lookup_pi_sri (pi, sri)` 추가
- `idx_lookup_pi` 의 `/*!80000 INVISIBLE */` 마커 제거

`docs/mysql-migration-2.7.md` 는 **기존 설치 전용 경로**로 그대로 두되, 신규 설치는
`mobiusdb.sql` 이 이미 담고 있다는 안내 한 문단을 맨 위에 넣었다.

### 검증 — 실제 MySQL 8.0.22 에 통째로 적용

`mobius/mobiusdb.sql` 전체를 임시 DB(`mobius_schema_check`)에 적용하고 결과를 확인한 뒤
임시 DB 를 삭제했다(운영 `mobiusdb` 는 건드리지 않았다).

```
mobiusdb.sql 적용 성공 (mobius_schema_check)
  hit_ri 테이블 생성됨: true
  idx_lookup_pi      : present, Visible=YES
  idx_lookup_ty_et   : present
  idx_lookup_pi_sri  : present
  hit_ri indexes     : PRIMARY, idx_hit_ri_ct
임시 DB 삭제 완료
```

지적의 심각도도 실증됐다. 이 개발 머신의 실제 `mobiusdb` 를 조회한 결과:

```
hit_ri exists in mobiusdb: false
lookup indexes: PRIMARY, ri_UNIQUE, idx_lookup_ty, idx_lookup_pi, idx_lookup_ct,
                idx_lookup_sri, idx_lookup_lbl, idx_lookup_rn, idx_lookup_pi_ri_ty,
                idx_lookup_pi_ty_ct
```

`hit_ri` 도 2.7 인덱스도 없다 — 마이그레이션 문서를 읽지 않은 설치가 정확히 이 상태다.

---

## I4 — `hit_ri` 부재 시 실패 모드

`mobius/hit_man.js`:

**(1) 진짜 에러 보존.** 파사드 규약은 실패 시 `callback(true, err)` 인데
(`mobius/db/index.js:72,76`) writer 가 두 번째 인자를 버려 로그가
`[hit_man] flush failed, will retry: true` 였다. `to_error(err, second)` 를 두어 두 번째
인자의 실제 에러를 콜백으로 넘긴다.

**(2) 되돌리기 버퍼 상한.** `MAX_BUFFER_KEYS = 50000`. 넘으면 `trim_buffer()` 가 가장
오래된 `ct` 부터 버리고(키는 `ri|ct`, `ct` 는 `YYYYMMDD` 라 문자열 정렬 = 시간 순),
**버린 주기에만** 한 줄 남긴다.

**(3) 실패 로그 스로틀.** 첫 실패에 한 번, 이후 `FAIL_LOG_EVERY = 360` 연속 실패마다
한 번(10초 주기 기준 약 1시간에 한 줄). 복구되면 `flush recovered after N failure(s)` 를
한 줄 남기고 카운터를 리셋한다. 8워커 × 10초 × 영구 = 하루 7만 줄이 되던 흐름을 끊는다.

### 실환경 확인 (MySQL, `hit_ri` 없는 상태)

수정 전:

```
[del_old_hit_ri] error true
```

수정 후 (같은 조건, 실제 부팅 로그):

```
[del_old_hit_ri] error: ER_NO_SUCH_TABLE: Table 'mobiusdb.hit_ri' doesn't exist
[hit_man] flush failed (연속 1회), will retry: ER_NO_SUCH_TABLE: Table 'mobiusdb.hit_ri' doesn't exist
```

### I4-b — 리뷰에 없던 같은 계열 결함 (검증 중 발견, 함께 고침)

`app.js` 의 `del_old_hit_ri` 도 정확히 같은 실수를 하고 있었다:
`console.error('[del_old_hit_ri] error', err)` 에서 `err === true` 다. I6 이 손대는 바로
그 함수라 함께 고쳤다(위 로그의 첫 줄이 그 결과다).

### 커버 테스트

`test/hit-man.test.js` (4건 추가):
`flush 실패가 반복돼도 버퍼가 상한을 넘지 않고, 오래된 ct 부터 버린다`,
`flush 실패 로그에 파사드의 (true, err) 규약이 아니라 진짜 에러 메시지가 실린다`,
`flush 실패 로그는 매 주기마다 찍지 않는다 (연속 실패 스로틀)`,
`flush 가 복구되면 한 줄 남기고 실패 카운터를 리셋한다`.

```
$ node --test test/hit-man.test.js
ℹ tests 23
ℹ pass 23
ℹ fail 0
```

---

## I5 — 사용량 카운터가 정규화되지 않은 요청 경로로 집계되던 문제

컨트롤러 판단대로 `record()` 호출을 **`get_target_url` 이 `'200'` 을 준 직후**로 옮겼다.
네 곳 모두(`POST`/`GET`/`PUT`/`DELETE`) 동일하다.

- `app.js` 에 `record_hit(request)` 헬퍼를 추가했다. `request.targetObject` 에서 해석된
  `ri` 와 `ty` 를 꺼내 `hit_man.record(ri, ty, binding, origin)` 을 부른다.
- **ACP 검사보다 앞**이다(의도). 거부된 접근도 사용 신호이고, 삭제 판정에서는 거짓
  "미사용" 이 거짓 "사용중" 보다 위험하다.
- 404 는 더 이상 집계되지 않는다.
- `ty` 를 항상 알게 되어 `attribute()` 의 `4-\d` 추측 규칙에 의존하지 않는다. 규칙 자체는
  다른 호출자(향후 프록시 배선)를 위한 폴백으로 남겼다 — 제거는 요청 범위 밖이다.

### 실환경 확인

SQLite 로 띄우고 같은 컨테이너를 네 가지 주소 형식으로 건드린 뒤 `hit_ri` 를 확인했다.

```
CIN ri = 4-20260828113130789746
구조 경로        GET /Mobius/hitcheck_ae/c1 -> 200
가상 자식 /la    GET /Mobius/hitcheck_ae/c1/la -> 200
가상 자식 /latest GET /Mobius/hitcheck_ae/c1/latest -> 200
비구조 CIN 주소  GET /Mobius/4-20260828113130789746 -> 404
```

플러시 후:

```
hit_ri rows:
   /Mobius 20260828 http=3
   /Mobius/hitcheck_ae 20260828 http=1
   /Mobius/hitcheck_ae/c1 20260828 http=4
```

`/c1` 의 4 = CIN POST(부모 귀속) + 구조 GET + `/la` + `/latest`. 네 가지 주소 형식이
**하나의 정규화된 키**로 모였다. 404 로 끝난 비구조 주소는 집계되지 않았다(예전에는
`4-\d` 규칙으로 CSEBase 에 잘못 귀속됐다).

`lookup` 조인 검사:

```
hit_ri -> lookup.ri 조인 결과:
   /Mobius                        http=3  lookup 매칭=1
   /Mobius/hitcheck_ae            http=1  lookup 매칭=1
   /Mobius/hitcheck_ae/c1         http=4  lookup 매칭=1

모든 hit_ri 키가 lookup.ri 와 조인된다.
```

### 커버 테스트

`test/hit-man.test.js` 에 2건 추가 —
`attribute: 비구조 CIN 주소를 그대로 받으면 CSEBase 로 잘못 귀속된다 (배선을 옮긴 이유)`,
`attribute: get_target_url 이 해석한 구조 ri 를 받으면 올바른 부모 CNT 로 귀속된다`.
기존 테스트 중 옛 배선에 의존하던 것은 없었다(전부 `attribute()` 단위 테스트다).

---

## I6 — 마스터의 `del_old_hit_ri()` 가 `assertReady()` 예외에 무방비

`app.js` 의 `del_old_hit_ri()` 본문 전체를 `try/catch` 로 감싸고 `console.error` 를
남긴다. 워커 쪽(`mobius/hit_man.js` 의 `start()`)과 같은 모양이다. 주석에 왜 이 좁은
경로가 위험한지(파사드 `connect()` 가 의도적으로 try/catch 되어 `knexInstance` 가 null 로
남을 수 있고, 마스터에는 `uncaughtException` 핸들러가 없다) 적었다.

---

## I7 — 마스터 정리 루틴이 성공 분기에서만 무효화하던 문제

`cache_man.invalidate_all()` 을 `if`/`else` 밖으로 뺐다. 세 곳 모두:

- `app.js` `del_req_resource()` — 추가로 실패 분기에 `console.error` 를 넣고,
  성공일 때만 `delete_Obj.affectedRows` 를 읽도록 했다.
- `app.js` `del_expired_resource()`
- `app.js` `del_orphan_resource()`

`mobius/sql_action.js` `delete_req` 는 `else` 가 없어 쿼리 실패 시 콜백이 아예 불리지
않았다(→ `connection.release()` 와 `invalidate_all()` 이 통째로 누락). `delete_lookup_et`
이 받았던 것과 같은 형태로 고쳤다:

```js
if (err) {
    console.error('[delete_req] query error:', (delete_Obj && delete_Obj.message) || err);
    callback(err, delete_Obj);
    return;
}
```

---

## I8 — 동등성 하네스의 `acco`/`acip`/`actw` 커버리지

`tools/equivalence/run-scenarios.js` 에 6개 시나리오를 추가했다. 각각 자기 ACP(제약은
`pv` 에, `pvs` 는 ORIGIN 전권)와 자기 컨테이너(`acpi` 로 연결)를 만들고, 그 컨테이너를
GET 했을 때의 허용/거부를 기록한다. 본문은 스냅샷에 넣지 않는다(관심사는 판정 하나뿐이고
본문에는 실행마다 달라지는 필드가 섞인다).

| 시나리오 | 구성 | 기대 |
|---|---|---|
| `acco-acip-ipv4-match` | `ipv4:['198.51.100.7']` + 헤더 `remoteaddress: 198.51.100.7` | 허용 |
| `acco-acip-ipv4-nomatch` | 같은 acco + 헤더 `203.0.113.9` | 거부 |
| `acco-acip-ipv6-match` | `ipv6:['::1','::ffff:127.0.0.1','127.0.0.1']` + 헤더 `203.0.113.9` | 허용 |
| `acco-acip-ipv6-nomatch` | `ipv6:['2001:db8::5']` + 헤더 `2001:db8::5` (스푸핑) | 거부 |
| `acco-actw-match` | `actw:['* * * * <현재 UTC 월> *']` | 허용 |
| `acco-actw-nomatch` | `actw:['99 99 99 99 99 99']` | 거부 |

ipv6 두 건은 **헤더와 소켓 주소를 일부러 갈라놓아** 판별력을 만든다. 월(month)은 실행
중에 바뀌지 않으므로 `actw` 매치는 결정적이다. 기존 32단계 뒤에 붙여 앞부분이 예전
기준선과 그대로 정렬되게 했고, 시작 시 잔재 삭제 + 종료 시 정리를 넣어 재실행 가능하다.

### 하네스가 Critical 2 를 실제로 잡는지 확인 (요구된 순서대로: 수정 → 확인)

수정된 코드로 한 번, `list6[j] === clientIp` 로 되돌린 코드로 한 번, 각각 서버를 새로
띄워 스냅샷을 뜨고 비교했다.

```
$ node tools/equivalence/compare.js after-fix.json reverted-c2.json
[acco-acip-ipv6-match] 결과가 다르다
  before: {"setup":201,"status":200,"rsc":"2000"}
  after : {"setup":201,"status":403,"rsc":"4103"}

[acco-acip-ipv6-nomatch] 결과가 다르다
  before: {"setup":201,"status":403,"rsc":"4103"}
  after : {"setup":201,"status":200,"rsc":"2000"}

2단계에서 차이 발견
```

39단계 중 정확히 이 2단계만 갈렸고, 방향도 리뷰 표와 일치한다 — 루프백은 허용→거부로
깨지고, 헤더 스푸핑은 거부→허용으로 권한이 올라간다. **이 시나리오들이 있었다면
Critical 2 는 통과하지 못했다.**

수정된 코드에서의 6단계 실측:

```
acco-acip-ipv4-match    {"setup":201,"status":200,"rsc":"2000"}
acco-acip-ipv4-nomatch  {"setup":201,"status":403,"rsc":"4103"}
acco-acip-ipv6-match    {"setup":201,"status":200,"rsc":"2000"}
acco-acip-ipv6-nomatch  {"setup":201,"status":403,"rsc":"4103"}
acco-actw-match         {"setup":201,"status":200,"rsc":"2000"}
acco-actw-nomatch       {"setup":201,"status":403,"rsc":"4103"}
```

---

## MINOR

| 항목 | 조치 |
|---|---|
| `sql_action.js:209` 의 `var merge` 가 모듈 상단 `require('merge')` 를 가림 | `mergeExpr` 로 개명 + 이유 주석 |
| `security.js:21` 의 죽은 `require('moment')` | 제거 (`grep moment mobius/security.js` → 결과 없음) |
| `conf.json` 키 3개 미문서화 | `README.md` 예시와 `mobius.js:24-31` 자동 생성 기본값 **양쪽**에 `cacheLimit`(50000) / `hitRiFlushSec`(10) / `hitRiRetentionDays`(120) 추가. README 에는 워커별 상한이라 총량이 `cacheLimit × 코어 수` 라는 점, 보관 기간은 판정 창보다 길어야 한다는 점을 덧붙였다 |
| `acp_eval.js:31-33` 에 divergence 2건 누락 | 같은 주석 블록에 `acr.acop` 누락(원본 `bad4d4c:security.js:160,:342` 의 `acop.toString()` 이 던져 `'500-1'` 즉시 응답)과 non-string `actw` 원소(원본 `:114,:298` 의 `.split(' ')` 이 던짐) 두 줄 추가. **원본을 직접 확인하고 썼다** |
| `prereq-queries.test.js` 에 실엔진 왕복 없음 | `SQLite 실엔진 왕복: 여러 행 UPSERT 가 파싱되고 증분이 누적된다` 추가. `adapter.execute` 를 가로채지 않고 실제 sqlite3 로 보낸다. 2행 배치 INSERT → 재실행으로 1→2, 다시 2→4 누적, 배치의 두 번째 행도 독립 누적 확인. 전용 임시 DB 파일을 쓰고 끝나면 지운다 |

---

## 검증

### `npm test`

기준선(작업 시작 전):

```
ℹ tests 105
ℹ suites 0
ℹ pass 105
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 788.2268
```

최종:

```
ℹ tests 126
ℹ suites 0
ℹ pass 126
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 717.1851
```

### 벤치마크

§CRITICAL 1 참조. `1.0358 ms → 0.0003 ms` (CIN 경로가 부르는 무효화 호출 기준).

### Critical 2 두 케이스

§CRITICAL 2 참조. 수정 후 두 케이스 모두 `bad4d4c` 와 일치하며, 되돌리면 5개 테스트가
실패한다.

### `tools/equivalence`

`tools/equivalence/README.md` 절차대로 SQLite 로 서버를 띄우고 시나리오를 돌렸다.
기준선 `before-task2.json` 은 **재생성하지 않았다**. 새 6단계는 기존 32단계 뒤에 붙였으므로
앞 32단계가 그대로 정렬된다 — `compare.js` 는 길이가 같아야 하므로 39단계 스냅샷의 앞
32단계만 잘라 비교했다.

```
$ node tools/equivalence/compare.js tools/equivalence/out/before-task2.json after-fix-prefix32.json

[cin-latest] 결과가 다르다
  before: {"status":200,"rsc":"2000","body":{"m2m:cin":{"con":"v4",...}}}
  after : {"status":200,"rsc":"2000","body":{"m2m:cin":{"con":"v3",...}}}

1단계에서 차이 발견
```

**차이는 `cin-latest` 하나뿐이며, 이것이 안내받은 타이밍 플레이크다. 깨끗했다고 주장하지
않는다.** 다만 이 단계에서는 `before-task2` 쪽이 이상값이라는 근거가 있다. 저장된 모든
스냅샷을 훑어보면:

```
before-task2         la.con= v4  cni= 3
after-task2          la.con= v3  cni= 3
after-task2-fix      la.con= v3  cni= 3
after-task2-run2     la.con= v3  cni= 3
after-task2-run3     la.con= v3  cni= 3
after-task5          la.con= v3  cni= 3
after-task10         la.con= v3  cni= 3
control-orig-run1    la.con= v3  cni= 3
control-orig-run2    la.con= v3  cni= 3
```

`control-orig-run1/2` 는 **원본 코드**로 뜬 대조군인데 이들도 `v3` 다. `v4` 를 낸 것은
`before-task2` 하나뿐이다.

브랜치의 가장 최근 스냅샷(`after-task10`, 내 변경 직전)과 비교하면 완전히 일치한다:

```
$ node tools/equivalence/compare.js tools/equivalence/out/after-task10.json after-fix-prefix32.json
동일 — 32단계 모두 일치
```

### 양쪽 백엔드 부팅

**SQLite** (`node mobius.js sqlite`) — 정상:

```
[db/sqlite] connected
SQLite Schema Initialized
CPU Count: 16
[db/sqlite] schema initialized
select_ri_lookup /Mobius: 1.718ms
update_cb_poa_csi /Mobius: 3.986ms
deleted 0 old hit_ri row(s)
pxyws server (192.168.0.230) running at 7577 port
```

**MySQL** (`node mobius.js mysql`) — **MySQL 은 이 머신에서 사용 가능했고 실제로 붙었다**:

```
CPU Count: 16
[del_old_hit_ri] error: ER_NO_SUCH_TABLE: Table 'mobiusdb.hit_ri' doesn't exist
[hit_man] flush failed (연속 1회), will retry: ER_NO_SUCH_TABLE: Table 'mobiusdb.hit_ri' doesn't exist
mobius server (192.168.0.230) running at 7579 port
```

`hit_ri` 부재 에러는 **이 개발 머신의 `mobiusdb` 에 2.7 마이그레이션이 적용되지 않았기
때문**이며(§I3 의 조회 결과), 코드 결함이 아니다. 오히려 I4/I4-b 수정이 그 원인을 정확히
말해 주고 있고(예전에는 `true` 였다), 서버는 정상 기동해 7579 에서 응답했다. 운영
데이터베이스를 임의로 변경하는 것은 이 작업의 범위가 아니라고 판단해 마이그레이션을
적용하지 않았다 — 대신 §I3 처럼 임시 DB 에 `mobiusdb.sql` 전체를 적용해 스키마 변경이
유효함을 검증하고 임시 DB 를 삭제했다.

두 서버 모두 종료했다.

### 정리 확인

```
$ cat conf.json  (백업본과 diff)
conf.json unchanged

$ (SQLite) 남은 테스트 리소스
leftover test rows in lookup: none
hit_ri cleared: ok

$ (MySQL) 임시 DB
임시 DB 삭제 완료
```

동등성 하네스가 만든 `eqv_ae` / `eqv_acp` / `eqv_acco_ae` / `eqv_acp_*` 는 하네스 자신이
정리했고(전부 404 확인), 수동 확인용 `hitcheck_ae` 는 API 로 삭제했다.

---

## 구현하지 않은 것

없다. 리뷰의 12개 항목을 모두 반영했고, 반박하거나 보류한 지적은 없다. 원본 대조(`bad4d4c`)
와 실측으로 확인한 결과 리뷰의 사실관계는 전부 정확했다.

명시된 범위 밖 항목(`global.cache_security_check`, `mobius.js:59`/`app.js:67` 의
`'Sponde'` 중복, `hit_man.start()` 의 `global.wdt` 의존, `checkAndPurge` 의 무효화 누락,
비클러스터 부팅 경로, `cache_man.get` 의 참조 반환)은 손대지 않았다. `acp_eval.js` 의
`KNOWN BUG` 도 하나도 고치지 않았다.

범위를 한 곳 넘긴 것은 §I4-b 뿐이다: `app.js` 의 `del_old_hit_ri` 로그가 I4 와 똑같이
`err === true` 를 찍고 있었고, I6 이 손대는 바로 그 함수이며, MySQL 부팅 검증에서 실제로
`error true` 를 관측했기에 함께 고쳤다.
