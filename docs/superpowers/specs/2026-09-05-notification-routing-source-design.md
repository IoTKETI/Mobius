# 알림 라우팅의 원천을 `sub` 테이블로 — `lookup.subl` 사본 제거 설계

2026-09-05. 남은 일 §5.6-1(구독별 DB 조회 배치)에서 출발해 "`subl` 을 쓰는 것이
더 효율적인가" 를 실측으로 따진 결과다. 결정: **B — `sub` 테이블이 원천**.

## 0. 결론 먼저

| | A `subl` 사본 (지금) | B `sub` 조회 (이 설계) |
|---|---|---|
| 알림당 추가 질의 | 0 | 1 (인덱스 있으면 0.35ms) |
| 어긋남(유령·중복·낡은 nu·침묵) | 장치로 막는다 — 이미 한 번 무너졌고 스윕 쪽 구멍이 남아 있다 | **구조적으로 없다** — FK 하나가 보장 |
| 구독 쓰기 | 부모 행 트랜잭션 + `FOR UPDATE` 읽고-고쳐-쓰기 | 없음 |
| 유지 장치 | `subl.js` · `update_subl` · rebuild/snapshot 도구 · responder 지우기 · 감사의 불신 주석 | 없음 |
| SQLite 동시 구독 생성 | 유실(72개 중 52개 실측) | 문제 자체가 없다 |

처리량으로는 A 가 쓰기당 0.35ms 빠르다. 그 차이는 이 규모(최고 시간대 12.6 q/s)에서
어떤 지표에도 나타나지 않는다. A 의 대가는 이미 현실이 됐던 유령 9,475건이다.

## 1. 실측 (배포 서버, 평일인 2026-09-04 기준)

| 항목 | 값 |
|---|---|
| 쓰기 요청 / 그중 구독 있는 부모 대상 | 362,452 / 172,199 (47.5%) |
| 알림 발송 / 실패 | 약 174,000 / 0 |
| 구독 / 부모 / 부모당 최대 | 3,463 / 3,025 / 6 |
| nu | 전부 `mqtt://` URL, 구독마다 정확히 하나, ID 형식 0 |
| `su` 가 설정된 구독 | **0** (구독 삭제 알림 128 경로는 한 번도 안 돈다) |
| `subl` 총량 / 최대 한 행 | 732KB / 1,112B |
| `sub`↔`subl` 어긋남 | 지금 0 (`tools/rebuild-subl.js` 적용 결과) |
| `sub.pi` 인덱스 | **없음** — `where pi=?` 풀스캔 2.48ms, PK 조회는 0.35ms |
| `sub.nu` / `enc` 폭 | varchar(200) / varchar(45), 실제 최대 91 / 25, `sql_mode` STRICT |
| POST 응답시간 | p50 9.5ms · p90 12.0ms · p99 15.4ms |

쓰기 트래픽은 한 클라이언트(UMACAIR GCS)가 평일 낮에만 낸다. 주말인 오늘 POST 가
168건인 것은 그 때문이고, 어제 21:44 KST 에 스스로 끝나 오늘 배포와 무관하다.

## 2. 지금의 흐름

```
쓰기 요청 → resource.js 가 부모 행(lookup select *)을 이미 읽어 둠
         → sgn.check(request, notiObj, net)            ← 빈 콜백, 곧바로 응답
             parentObj = request.targetObject[root]     (모든 경우 "그 리소스 자신")
             subl = parentObj.subl                       ← 사본
             needs_connection(subl)?  ID 형 nu 가 있을 때만 커넥션 대여
             sgn_action: 항목마다 subl_entry.read → net 대조 → get_nu_arr(순차, nu 마다 질의 2)
                       → setTimeout(1~10ms 랜덤) → sgn_man.post
```

`sgn.check` 호출 넷의 `parentObj` 는 전부 **"구독이 붙은 리소스 자신"** 이다.
생성(3)은 POST 대상, 갱신(1)은 PUT 대상, 자식 삭제(4)와 구독 삭제(128)는
`delete_action` 이 부모로 바꿔 둔 `targetObject`. 즉 읽어야 할 것은 언제나
`sub where pi = targetObject.ri` 다.

사본을 지키는 코드: `subl.js`(158줄) · `sql_action.update_subl`(트랜잭션 + 행 잠금) ·
`resource.js` 의 호출 셋 · `responder` 가 모든 응답에서 `subl` 삭제 · `makeObject` 가
부모를 읽을 때마다 파싱 · `tools/rebuild-subl.js` · `tools/snapshot-subl.js` ·
`test/sgn-subl-entry.test.js`. 그리고 감사 코드의 "부모의 subl 사본은 신뢰할 수 없다".

남아 있는 구멍: 만료 스윕(`delete_lookup_et`)이 `sub` 행을 FK 로 지우면서 부모의
`subl` 은 안 건드린다(admin/README 실측 — 유령 1 남음). 스윕이 돌 때마다 다시 쌓인다.

## 3. 설계

### 3.1 데이터 흐름

```
쓰기 요청 → 응답(지금과 같다)
         → sgn.check(request, notiObj, net)
             pi = request.targetObject[root].ri
             자기 커넥션 대여 (언제나)
             rows = select_subs_by_pi(pi)                ← 원천
             128 이면 rows = [notiObj]                    ← 지워진 구독 자신 (FK 로 이미 사라졌다)
             sgn_action(rows)                             ← 루프는 그대로. subl_entry.read 가 행을 읽는다
               nu 해석: resolve_nu_list — ID 형 nu 전부를 질의 3번에 (§5.6-1)
               발송: 지금과 같다
             반납
```

**왜 자기 커넥션인가(요청 커넥션 아님).** 요청 커넥션으로 하려면 호출부 넷이 질의를
기다린 뒤 응답해야 하고 쓰기마다 +0.35ms 가 붙는다(p50 9.5ms 의 3.7%). 자기 커넥션이면
응답 지연은 0 이고 지금의 `run_with_own_connection` 구조가 그대로다. 대가는 풀이
고갈됐을 때 알림을 건너뛰고 로그를 남기는 실패 모드 하나가 새로 생긴다는 것이다
(지금은 알림이 DB 를 안 써서 그 모드가 없다). 풀 600(24×25) 에 대여 1ms·최고 12.6/s 라
정상 운영에서는 닿지 않는다. 그 모드에 닿았다면 서버가 이미 다른 이유로 아픈 것이다.

### 3.2 바뀌는 것

**`mobius/sql_action.js`**
- `select_subs_by_pi(connection, pi, cb)` — `sub` 에서 `ri, nu, enc, nct, nec, cr` 를
  `where pi = ?` 로. 순서는 `ri` 오름차순(`select_acp_in` 과 같은 규칙, 결정적).
- `select_resources_in(connection, ri_list, sri_list, cb)` — `lookup where ri in … or sri in …`
  한 번 뒤 나온 타입별로 테이블 한 번씩. `select_resource_from_url` 과 같은 merge 규칙,
  미지원 타입은 lookup 행만. (nu 배치용)
- `update_subl` 은 1단계에서 그대로, 2단계에서 삭제.

**`mobius/sgn.js`**
- `check`: `needs_connection` 삭제, 언제나 자기 커넥션. `select_subs_by_pi` → `sgn_action`.
  128 은 `[notiObj]`.
- `get_nu_arr` → `resolve_nu_list(connection, nu_arr, sub_ri, cb)` 세 단계(순수 분류 →
  질의 → 순수 재조립). 옛 판정 그대로: 매치 행이 정확히 1개일 때만 통과, ri 매치 우선
  (옛 코드에서 미정의였던 순서를 고정하고 주석에 적는다), 배치 질의 오류면 ID 항목 전부
  "DB 오류" 문구로 제외하고 URL 항목은 보낸다.
- 랜덤 지연(§5.6-2)·`256` 죽은 갈래·`localhost:7579` 리터럴은 **손대지 않는다**.

**`mobius/subl.js`** — `read` 는 남는다(행의 nu/enc 가 JSON 문자열이라 같은 파싱이
필요하다). `pack`/`upsert`/`without` 은 1단계에서 그대로, 2단계에서 삭제. 이름이
`subl` 인 것은 2단계에서 `sub_entry` 로 바꾼다.

**`mobius/resource.js`** — 1단계 변경 없음(이중 쓰기 유지). 2단계에서 `update_subl`
호출 셋과 그 대기 사슬 제거.

**스키마 (`migrations/`)**
- `013-sub-pi-index`: MySQL `ALTER TABLE sub ADD INDEX idx_sub_pi (pi)` — 3,463행이라
  즉시 끝나지만 **`autoApply` 는 붙이지 않는다.** 인덱스 생성·컬럼 변경은 DDL 종류로
  기동 경로에서 금지된다(`test/db-bootstrap.test.js` — 규칙은 행 수가 아니라 종류).
  배포 때 `node tools/migrate.js --check` 뒤 `--apply` 로 손으로 적용한다. SQLite 는
  `mobiusdb_sqlite.sql` 의 `CREATE INDEX IF NOT EXISTS`(001 과 같은 방식). 인덱스가
  아직 없어도 코드는 돈다 — 풀스캔 2.48ms 일 뿐이다.
- `014-sub-widen-nu-enc`: MySQL `nu`·`enc` 를 `text` 로. 원천이 되는 컬럼이 URL 두세 개에
  넘치면 안 된다(STRICT 라 지금은 생성이 실패하지 조용히 잘리진 않는다). 3,463행이라
  즉시. 역시 손으로 적용. SQLite 는 폭 제한이 없어 no-op.

**`mobius/responder.js`** — `subl` 지우기는 컬럼이 남아 있는 동안 유지.

**`tools/rebuild-subl.js` · `snapshot-subl.js`** — 2단계에서 삭제
(`test/usesqlite-single-reader.test.js` 의 허용 목록 갱신). **admin/README** 의 스윕 유령
표는 2단계에서 "더 이상 해당 없음" 으로.

### 3.3 동작 변화 (전부 명시)

| # | 변화 | 오늘 영향 |
|---|---|---|
| ① | 알림 라우팅 원천이 `subl` → `sub` | 어긋남 0 이라 발송 목록·순서 동일 |
| ② | 스윕이 지운 구독은 즉시 발송 중단 | 정상화(유령 재발 차단) |
| ③ | 구독 삭제 알림(128)이 **지워진 구독 자신에게만** — 형제 구독에 sud 를 보내던 것이 사라진다 | `su` 설정 구독 0 → 없음 |
| ④ | 쓰기마다 풀 커넥션 1회 대여(~1ms), 고갈 시 알림 생략 + 로그 | 정상 운영에서 없음 |
| ⑤ | ID 형 nu 해석이 nu 당 질의 2 → 전체 3 | ID 형 nu 0 → 없음 |
| ⑥ | SQLite 에서 동시 구독 생성 유실 소멸 | 임베디드 규모 |
| ⑦ | `sub.nu`/`enc` 가 text | 값 변화 없음 |
| ⑧ | 형제 구독 간 발송 순서가 `subl` 삽입순(생성순) → `ri` 오름차순 | 랜덤 지연(1~10ms)이 이미 순서를 흔들고 있어 실효 없음. 부모당 최대 6개 |

### 3.4 단계와 되돌리기

**1단계 (이 작업)** — 읽기 전환 + 이중 쓰기 + 마이그레이션 둘. `subl` 은 계속
쓰이므로 되돌리기는 커밋 revert 한 번이고 그 사이 만들어진 구독도 `subl` 에 있다.

**검증 관문** — 배포 뒤 **첫 평일** 하루: 시간당 발송 수(기준 최고 56,000/시간),
`[noti] fail`, `[sgn] 커넥션을 못 빌려` 로그 0, POST p50/p99 변화 없음. 이것을 숫자로
확인한 뒤에만 2단계로 간다.

**2단계** — `update_subl` 호출 셋 · `subl.js` 의 pack/upsert/without · `update_subl` ·
도구 둘 · `sgn-subl-entry` 시험 삭제, `subl` 컬럼 쓰기 0. 컬럼 자체는 그 뒤 별도
마이그레이션으로 지운다(`responder` 지우기도 그때).

## 4. 증명

- **차분 하네스** (스크래치): 같은 구독 픽스처를 (가) `subl` 배열 → 옛 `sgn_action`,
  (나) `sub` 행 → 새 `sgn.check` 로 돌려 **발송 목록(nu · 본문 · 순서)** 을 전수 대조.
  `sgn_man.post` 를 가로채 기록한다. nu 해석은 옛 `get_nu_arr` 과 `resolve_nu_list` 를
  같은 DB 스텁 위에서 격자 대조(URL/ID 섞임 × 있음·없음·중복·poa 없음·poa 여럿·
  프로토콜 없는 poa·미지원 타입·DB 오류).
- **새 시험** `test/sgn-source.test.js`: `check` 가 `targetObject.ri` 로 묻는다 ·
  행의 문자열 nu/enc 를 읽는다 · 128 은 지워진 구독 자신 · 풀 대여 실패는 로그 + 생략 ·
  소스에 `parentObj.subl` 읽기 없음 · `needs_connection` 없음.
  `test/sgn-resolve-nu.test.js`: 전부 URL 이면 질의 0 · 섞인 목록에서 질의 정확히
  1+1+타입 수 · 순서 보존과 poa 늘리기 · 세 실패 문구.
- **기존 시험 갱신**: `merged-branches`(제거 목록의 `select_sub` 사유), `callback-contract`
  (`get_nu_arr` 정규식), `sgn-connection`(needs_connection 둘 → "언제나 대여" 와
  "정산 뒤 요청 커넥션 사용 없음" 으로).
- **실서버 골든** (sqlite 새 DB): AE(poa = 로컬 리스너) · cnt · 구독(nu = `http://` 리스너,
  그리고 nu = AE 의 **ID 형식**) · CIN 생성 → 리스너가 받은 알림 본문을 전후 대조.
  정식 골든에는 알림 수신 케이스가 없어 새로 만든다.
- **변이**: 원천을 `subl` 로 되돌림 · `pi` 대신 `ri` 로 조회 · 128 을 형제로 · 배치를
  순차로 · 순서 뒤집기 — 각각 어느 시험이 잡는지.
- **배포 뒤**: 3.4 의 관문.

## 5. 범위 밖

랜덤 지연(§5.6-2) · `256` 죽은 갈래 · `http://localhost:7579` 리터럴 · 구독 감사
(`sub_audit`) 로직 · `subl` 컬럼 삭제(2단계 뒤).
