# DB 레이어 추상화 1차분 — 결정 기록

- 작성일: 2026-08-26
- 대상 커밋 범위: `27ecce1..ed67bc3` (17 커밋)
- 계획: `docs/superpowers/plans/2026-08-26-db-layer-abstraction-part1.md`
- 스펙: `docs/superpowers/specs/2026-08-26-db-layer-abstraction-design.md`
- 분류: `docs/superpowers/specs/2026-08-26-branch-classification.md`

1차분 구현 중 컨트롤러가 내린 판정 25건이다. 대부분은 **계획 자체의 결함**을
발견해 그 자리에서 고친 것이고, 몇 건은 2차 계획으로 이월했다.

2차 계획을 쓰거나 실행하는 사람은 이 문서를 먼저 읽어라. 특히 다음이 중요하다:

- **Ruling 17** — 에러 어휘 전환은 함수 단위로 동반되어야 한다 (계획의 순서 결함)
- **Ruling 20** — 분류가 108개 export 중 31개만 다뤘다. 68개는 분기 없이 MySQL 로 나간다
- **Ruling 22** — 기존 코드의 SQL Injection 2건이 전환 우선순위를 정한다
- **Ruling 24** — 잔여 Minor 3건이 park 되어 있다

각 판정은 "무엇을 결정했는가 / 왜 / 틀렸을 때 비용" 형식이다.

---

### Ruling 1 — `insert_acp` 가 T1 에서 REVIEW 로 판정될 경우
T5 는 `insert_acp` 가 MERGE 임을 전제한다. 직접 읽어 확인한 바로는 양쪽 분기가
동일한 3컬럼 insert 에 동일한 보상 로직이고 차이는 이스케이프와 실행자뿐이므로
MERGE 가 거의 확실하다. 그럼에도 T1 이 REVIEW 로 판정하면 T5 대상을
MERGE 판정을 받은 가장 단순한 `insert_*` 함수로 교체하고 이 원장에 기록한다.
— 틀렸을 때 비용: T5 가 부적절한 참조 패턴을 만들 수 있으나, T5 의 SQLite/MySQL
동등성 검증 2종이 잡는다. 재작업 범위는 함수 1개.


### Ruling 2 — T3 산출물이 Plan 1 안에서 비교에 쓰이지 않음
T3 는 SQL 기준선을 만들지만 T4/T5 의 검증은 동등성 하네스만 쓴다. T3 의 주된
가치는 Plan 2 대량 전환의 기준선이다. 다만 T5 가 실제로 SQL 을 바꾸므로,
T5 완료 시 `tools/golden/diff.js` 로 변화를 관측해 원장에 남긴다(계획에 없는
추가 단계). 의도한 변화만 일어났는지 확인하는 값이 비용보다 크다.
— 틀렸을 때 비용: T5 에 관측 단계 하나가 추가될 뿐. 되돌릴 것 없음.


### Ruling 3 — shape() 정규화가 보간 SQL 과 바인딩 SQL 을 다른 토큰으로 만든다
리뷰어가 실증: `cni = cni + 5 ... ri = 'x'` 는 `cni + N ... ri = 'V'` 로,
`cni = cni + ? ... ri = ?` 는 `cni + V ... ri = V` 로 정규화되어 불일치.
바인딩 전환 후 44종 전부가 "사라짐+새로생김"으로 나와 도구가 무용해진다.
스펙 302행은 "바인딩을 되꽂고 정규화"라고 명시하므로 계획이 스펙에서 벗어난 것이다.
스펙이 구속력 있는 권위이므로 finding 이 옳다.
판정: 값 자리(문자열 리터럴 / `?` / 맨숫자)를 **모두 같은 토큰 `V`** 로 통일한다.
탭은 SQL 문자열만 보므로 바인딩을 실제로 되꽂는 것보다 이쪽이 단순하고 목적을 달성한다.
— 틀렸을 때 비용: 서로 다른 SQL 이 같은 형태로 뭉개져 변화를 놓칠 수 있다. 다만
현재는 100% 오탐이라 어느 쪽이든 개선이고, 동등성 하네스가 별도 안전망으로 남는다.


### Ruling 4 — tap.js 가 전환된 함수를 못 본다 (리뷰어가 못 잡은 추가 결함)
tap.js 는 db_action/db_sqlite 의 getResult 만 감싼다. Task 5 이후 전환된 함수는
db.run -> mobius/db/<backend>.execute 로 가므로 캡처에서 통째로 사라진다.
그러면 "after" 측 SQL 이 비어 diff 가 의미를 잃는다.
판정: tap.js 가 `mobius/db/mysql.js`·`mobius/db/sqlite.js` 의 `execute` 도 감싼다.
해당 모듈은 Task 4 이후에만 존재하므로 require 실패 시 조용히 건너뛴다.
— 틀렸을 때 비용: 없음. 없으면 건너뛰므로 현재 동작에 영향 없고, Task 4 이후
자동으로 활성화된다.

### Ruling 5 — 중립 에러 코드에 락 충돌이 없다 (fix now)
sql_action.js:2501 이 `code === 'ER_LOCK_NOWAIT' || errno === 3572` 로 "다른 워커가 purge 중 → 스킵"을 판별한다. 파사드를 거치면 code 가 'UNKNOWN' 이 되어 첫 조건이 영구히 거짓이 되고, MySQL 전용 매직넘버만 우연히 살아남는다. 추상화가 백엔드 누출을 오히려 강제하는 형태다.
판정: 중립 코드에 LOCK_CONFLICT / LOCK_TIMEOUT 추가, 원본을 err.driverCode 로 보존.
— 틀렸을 때 비용: 코드 두 개와 필드 하나가 남는다. Plan 2 에서 안 쓰면 죽은 코드일 뿐.


### Ruling 6 — transaction() 콜백 규약이 경로마다 다르고 에러 객체를 잃는다 (fix now)
begin/commit 실패는 Error, 본문 실패는 본문이 넘긴 것, 게다가 body(conn, function(err){}) 가 인자를 하나만 받아 done(true, err) 하면 에러 객체가 소멸한다.
판정: 전 경로를 (true, err) 로 통일하고 finish(err, result) 2인자로 받는다.
— 틀렸을 때 비용: 이 API 사용처가 아직 0 이라 되돌리기 쉽다.


### Ruling 7 — transaction() 이 본문 동기 예외에 무방비 (fix now)
body 가 동기 throw 하면 rollback 없이 빠져나가 MySQL 풀 커넥션이 열린 트랜잭션 상태로 반납된다. 다음 요청이 남의 트랜잭션 안에서 동작한다 — 요청 간 오염.
판정: try/catch + 이중 정산 방지, commit 실패 시 rollback 시도, rollback 실패 로깅.
— 틀렸을 때 비용: 없음. 순수 방어 추가.


### Ruling 8 — SQLite execute 의 읽기/쓰기 판별이 조용히 틀린다 (fix now)
리뷰어 실측: 선행 주석, PRAGMA, EXPLAIN, RETURNING 이 배열 대신 객체를 돌려주고 affectedRows 는 직전 문장의 잔값이다. 전역 제약 "SELECT 는 배열 그대로"가 db.raw 경로에서 깨진다.
판정: 선행 주석/공백을 걷어낸 뒤 첫 키워드로 판별하고 RETURNING 도 읽기로 취급.
— 틀렸을 때 비용: 판별이 과하게 넓으면 쓰기가 읽기로 처리되어 affectedRows 를 잃는다. 그 경우 호출부가 즉시 드러낸다.


### Ruling 9 — err.constraint 가 실제로는 정규화되지 않는다 (fix now, 계약 명시)
MySQL 5.7 "aei_UNIQUE" / MySQL 8 "ae.aei_UNIQUE" / SQLite "ae.aei" — 같은 논리 제약이 다른 문자열이다. 동등 비교하면 MySQL 8 에서 409-6 이 조용히 사라진다.
판정: 테이블 접두사를 떼고, **동등 비교가 아니라 부분 문자열 비교**를 계약으로 못 박는다(주석+계약 문서). 그래야 MySQL "aei_UNIQUE" 와 SQLite "aei" 가 둘 다 /aei/ 로 잡힌다.
— 틀렸을 때 비용: 부분 비교라 오탐 가능성이 있으나, 현행 resource.js:360 이 이미 message.includes('aei_UNIQUE') 라 동등한 수준이다.


### Ruling 10 — SQLite 에러 분화가 전환 시 회귀를 만든다 (Plan 2 규칙으로 이월)
현재 SQLite 는 FK/NOT NULL 위반도 ER_DUP_ENTRY 로 뭉뚱그려 409-5 를 준다. 새 어댑터는 FK_VIOLATION/NOT_NULL 로 분화하므로, DUPLICATE_KEY 만 409-5 로 매핑하면 같은 요청이 500 으로 바뀐다.
판정: 코드는 그대로 둔다(분화는 스펙이 요구한 것). 대신 Plan 2 전환 규칙에 명시한다 — "SQLite 경로에서 FK_VIOLATION/NOT_NULL 도 기존과 같은 RSC 를 주려면 resource.js 매핑을 함께 손봐야 한다."
— 틀렸을 때 비용: Plan 2 에서 이 규칙을 놓치면 SQLite 의 FK/NOT NULL 위반 응답이 409 에서 500 으로 바뀐다. 동등성 하네스가 잡는다.


### Ruling 11 — transaction() 에 테스트가 없다 (fix now)
6종 중 트랜잭션 경로를 건드리는 것이 0개다. 위험 4 의 핵심인데 미검증이다.
판정: 무능력 경로(본문 실행/에러 전파/동기 예외)를 검증하는 테스트를 추가한다. MySQL 트랜잭션 경로는 서버가 필요해 이번 범위 밖 — 리포트에 명시한다.
— 틀렸을 때 비용: 테스트가 늘어날 뿐.

### Ruling 12 — fix 가 새 결함을 만들었다 (내 지시의 허점)
내가 준 transaction() 코드에서 settled 가드를 capable 경로 안에만 뒀다. 무능력
경로(SQLite = 기본 백엔드)에는 가드가 없고, 새로 넣은 try/catch 가 "정산 후 동기
throw" 라는 새 이중 호출 경로를 만들었다. 재리뷰어가 실행으로 확인:
  INCAPABLE / finish() 두 번        -> callback 2회 (기대 1회)
  INCAPABLE / finish() 후 sync throw -> callback 2회 (기대 1회)
109개 전환이 올라탈 계약에서 콜백 이중 호출은 이중 응답/이중 알림이 된다.
판정: settled 를 능력 분기 위로 끌어올리고 두 경로가 같은 finish 를 지나게 한다.
— 틀렸을 때 비용: 없음. 순수 결함 수정이고 테스트로 잠근다.


### Ruling 13 — capable 경로에 테스트가 없다 (round 2 에 포함)
구현자가 "MySQL 서버가 없어 통합 테스트 불가"라고 했으나 재리뷰어가 어댑터의
begin/commit/rollback 을 스텁으로 갈아끼워 서버 없이 6개 경로를 전부 실행해 보였다.
구현자의 "무능력 경로와 같은 골격을 공유한다"는 주장도 사실이 아니다 — 무능력
경로에는 finish 도 settled 도 없다. 즉 기존 3종 테스트는 begin/commit/rollback/
settled 로직을 하나도 검증하지 못한다.
판정: 스텁 어댑터로 capable 경로 테스트를 추가한다.
— 틀렸을 때 비용: 테스트가 늘 뿐. 스텁이 실제 드라이버와 어긋날 위험은 있으나
   계약(호출 순서·콜백 형태)을 잠그는 것이 목적이라 충분하다.


### Ruling 14 — Minor 3건도 함께 고친다 (조용한 실패 제거)
(a) index.js:117 commit 실패 후 rollback 실패가 로그 없이 사라진다
(b) index.js:125-129 정산 후 동기 throw 가 settled 가드에 먹혀 흔적 없이 사라진다
(c) sqlite.js:79 /\breturning\b/i 가 문장 전체를 훑어 값 안의 단어에 걸린다
    (`values ('returning home')` -> true, 쓰기가 읽기로 오분류되어 affectedRows 소실)
판정: 셋 다 수정. (c) 는 문자열 리터럴을 먼저 지우고 검사한다. 전부 한두 줄이고,
이번 리뷰들이 반복해서 잡아낸 것이 정확히 "조용히 틀린 결과"라 같은 부류를 남길
이유가 없다.
— 틀렸을 때 비용: (c) 의 리터럴 제거가 과하면 실제 RETURNING 을 놓칠 수 있으나,
   그 경우 배열 대신 객체가 와서 호출부가 즉시 드러낸다.

### Ruling 15 — 파사드 connect() 가 실제 기동 경로에서 호출되지 않는다 (load-bearing 계획 결함)
app.js:149/194/237 은 db_action 의 connect 만 부른다. 파사드는 test/db-facade.test.js
에서만 connect 된다. 따라서 전환된 함수가 워커에서 처음 db.k() 를 부르는 순간
assertReady() 가 throw 하고 워커가 죽는다 — 동등성 2/28 단계(acp-create, acp-delete)
실패가 바로 이것이다.
원인: Task 4 를 "아무도 안 쓴다"로 설계해 놓고, Task 5 에 배선 단계를 안 넣었다.
판정: app.js 의 세 곳에서 기존 db.connect 성공 후 파사드 connect 도 호출한다.
두 파사드 공존은 계획이 이미 채택한 설계이므로 배선만 채우면 된다.
— 틀렸을 때 비용: SQLite 모드에서 워커당 mobius.db 핸들이 2개가 된다(기존 1 + 파사드 1).
   SQLite 는 다중 커넥션을 지원하고 busyTimeout 50s 가 양쪽에 걸려 있어 감당 가능하나,
   쓰기 잠금 경합이 늘 수 있다. stage 8(구 모듈 삭제)에서 해소된다. 전환 기간 한정 비용.


### Ruling 16 — SQLite 어댑터의 `handle || db` 가 틀렸다
app.js 는 usesqlite 와 무관하게 항상 MySQL 풀 커넥션을 sql_action 에 넘긴다(스펙
배경 2번 문제). 그 핸들이 truthy 라 `handle || db` 가 MySQL 커넥션을 골라 h.all() 을
부르게 된다. 기존 db_sqlite.getResult 는 connection 인자를 **완전히 무시**하고
모듈 핸들만 쓴다(db_sqlite.js:57-70 확인) — 내가 그 동작을 잘못 옮겼다.
판정: SQLite 어댑터의 execute 는 자기 db 핸들만 쓴다. 왜 그런지 주석으로 남긴다.
— 틀렸을 때 비용: 없음. 기존 동작과 정확히 일치시키는 것이다.

### Ruling 17 — 에러 어휘 전환이 함수 단위로 동반되어야 한다 (Plan 2 순서 결함)
파사드는 err.code 를 중립 코드로 덮어쓰는데 resource.js 에 `results.code == 'ER_DUP_ENTRY'`
검사가 29곳 있다. insert_acp 는 우연히 안전하다 — insert_lookup(미전환)이 lookup.ri PK 로
중복을 먼저 잡아 구경로 코드를 그대로 돌려주기 때문이다.
그러나 **insert_ae(Plan 2 의 바로 다음 전환)는 안전하지 않다.** AE 중복은 ri 가 매번
새로 생성되어 lookup 을 통과하고 ae 본문의 aei_UNIQUE 에서 잡힌다. resource.js:359 가
code=='ER_DUP_ENTRY' AND message.includes('aei_UNIQUE') 를 봐야 409-6 을 내는데,
전환하면 code 가 DUPLICATE_KEY 가 되어 500-4 로 떨어진다.
내 계획은 "에러 어휘 중립화"를 Plan 2 Step 6 으로, 전환(Step 2~4) **뒤에** 놓았다. 순서가 뒤집혔다.
판정: 전환 패턴 문서에 이 사실을 항목으로 추가하고, "같은 커밋에서 해당 함수를 부르는
resource.js 검사를 함께 고친다"를 규칙으로 못 박는다. Plan 2 작성 시 Step 6 을 함수 단위
동반 수정으로 바꾼다.
— 틀렸을 때 비용: 안 고치면 Plan 2 작업자가 insert_ae 전환 직후 원인 불명의 500 을 만난다.
   동등성 하네스의 ae-create-duplicate 단계가 잡아주긴 하나 원인 진단에 시간이 든다.


### Ruling 18 — 검증 레시피가 전환에서 가장 손으로 다시 쓴 부분을 안 밟는다
시나리오의 acp-create 는 성공만 시키고 실패시키지 않는다. 그래서 새로 쓴 보상 블록
(sql_action.js:342-344)은 이번 태스크의 **어떤 증거로도 실행된 적이 없다.** 골든 스냅샷에
`delete from lookup where ri = ?` 형태가 등장하지 않으므로 "44종 불변"도 보상 SQL 의
정확성을 증명하지 못한다. Ruling 17 의 결함 계열과 정확히 겹친다 — 레시피가 전환이
만들어내는 결함을 구조적으로 비켜간다.
판정: 패턴 문서에 "전환한 함수의 실패 경로를 최소 1회 실제로 밟아야 한다"를 명시한다.
— 틀렸을 때 비용: 명시 안 하면 108개 함수의 보상/에러 경로가 전부 미검증으로 남는다.

### Ruling 19 — C1: 동등성 하네스가 서버가 안 떠 있어도 통과를 보고한다 (병합 차단)
run-scenarios.js:39-44 가 모든 fetch 실패를 잡아 결정론적 에러 객체를 반환하고,
main() 은 status:0 개수를 세지 않고 스냅샷을 쓴 뒤 exit 0 한다. 죽은 서버에 두 번
돌리면 compare.js 가 "동일 — 28단계 모두 일치"를 출력한다. 108개 전환의 유일한
안전망이 실패 시 침묵의 초록을 내는 것은 안전망이 없는 것보다 나쁘다 — 없는
확신을 제조하기 때문이다.
판정: 준비 상태 폴링 + status:0 이 하나라도 있으면 스냅샷 쓰지 말고 비정상 종료.
— 틀렸을 때 비용: 없음. 순수 방어 추가.
주: 이번 작업의 실제 실행들은 유효했다(매번 `grep -c "running at"` 로 워커 수를
확인했고 201/200 실응답을 받았다). 하네스 자체가 위험한 것이다.


### Ruling 20 — C2: 분류 문서가 108개 export 중 31개만 다룬다 (병합 차단, 내 스코핑 오류)
Task 1 을 "33개 usesqlite 분기"로 스코핑했는데, 정적 스캔 결과 **68개 export 가
분기 없이 db.getResult 를 무조건 호출**한다 — SQLite 모드에서도 MySQL 로 나간다.
그중 update_acp(ty=1, SQLite 지원 타입!)는 update_lookup 이 SQLite 에 쓴 뒤
sql2 가 acp.pv/pvs 를 MySQL 에 쓴다. select_acp 는 SQLite 에서 읽는다.
**ACP 정책 갱신이 조용히 유실된다** — 출하된 코드의 실 버그다.
select_sub/update_sub(ty=23), select_cb/update_cb_poa_csi(ty=5) 등도 SQLite 핫패스에 있다.
Plan 2 관점의 문제: 이들 전환은 "보존"이 아니라 **동작 변경**이라 Global Constraint
("기존 동작을 보존한다")와 정면 충돌하는데, 무엇이 옳은 답인지 계획이 말하지 않는다.
판정: 분류 문서에 두 번째 표를 추가해 68개를 열거하고 "전환하면 SQLite 동작이
바뀌는가, 그게 의도된 것인가"에 답한다. 문서 작업이고 Plan 2 가 파생될 근거다.
— 틀렸을 때 비용: 안 하면 Plan 2 가 63% 의 표면에 판정 없이 착수한다.


### Ruling 21 — 병합 전 필수 항목 확정 (리뷰어 triage 채택)
C1, C2, I2(sqlite.execute null 가드 — 실패한 DB 열기가 워커 크래시 루프가 됨),
deferred #8(테스트가 실제 ./mobius.db 를 건드림), #12(각주 부정확), #14(npm test 스텁).
여기에 내 판단으로 추가: I3(부팅 경로 try/catch — 이 diff 가 만든 신규 위험),
I7(knex 정확 버전 고정 — 빌더 출력이 곧 계약인데 캐럿 범위 + lockfile 무시),
그리고 리뷰어 권고 2(I1/I5 패턴 문서 보강 — 지금 싸고 50개 전환 후엔 비싸다).
I4(스키마 중복 exec), I6(limit/offset 정규화)는 Plan 2 이월 — 정확성이 아니라 비용 문제.
— 틀렸을 때 비용: 이월한 두 건은 부팅 락 경합과 골든 노이즈로 남는다. 관측 가능하다.


### Ruling 22 — 보안: 기존 코드의 SQL Injection 2건이 Plan 2 우선순위를 정한다
update_lookup(MySQL 경로가 acpi/at/aa/subl 미이스케이프)과 update_acp 의 sql2
(pv/pvs 를 양쪽 경로 모두 미이스케이프 — JSON.stringify 는 " 만 이스케이프하고
' 는 안 한다, pv 는 클라이언트 제어값). 둘 다 **이번 diff 가 만든 것이 아니라
출하된 코드의 기존 취약점**이다.
판정: Plan 2 에서 이 둘을 이름순이 아니라 **최우선**으로 전환한다. 바인딩 전환이
부수 효과로 고치므로 "리팩터링 위험"이 "보안 이득"으로 바뀐다.
— 틀렸을 때 비용: 늦추면 취약점이 그만큼 오래 남는다.


### Ruling 23 — 구현자의 FIX 6 이탈을 수용한다
`node --test test/` 가 Node v24.14.0 에서 MODULE_NOT_FOUND 를 낸다며 `test/*.test.js` 로 바꿨다.
재리뷰어가 양쪽을 독립 재현했고, 글로브가 셸 의존이 아니라 Node 자체 엔진이 푸는 것도 확인했다.
판정: 수용. 다만 재리뷰어가 추가로 밝힌 한계를 잔여로 남긴다 — `*` 가 경로 구분자를 넘지
못해 `test/sub/b.test.js` 같은 중첩 파일과 `*-test.js` 명명을 놓친다(격리 트리에서 3개 중
1개만 발견). bare `node --test` 가 3/3 을 발견하므로 그쪽이 더 나았다.
— 틀렸을 때 비용: Plan 2 에서 테스트 파일이 늘 때 조용히 누락된다. 한 줄 후속 수정으로 해소.


### Ruling 24 — 잔여 Minor 3건은 Plan 2 로 park 한다 (fix wave 2회차 없음)
(a) npm test 글로브 협소 (Ruling 23 참조)
(b) `db_sqlite.js:22` 는 './mobius.db' 를 하드코딩하는데 `db/sqlite.js:22` 는 이제
    MOBIUS_SQLITE_PATH 를 존중한다. 전환 기간에 두 모듈이 동시에 살아 있으므로,
    실배포에서 이 변수를 설정하면 **에러 없이 DB 가 두 파일로 쪼개진다.**
    실질 위험은 낮다(변수가 신규·미문서화이고 테스트만 사용).
(c) `db/mysql.js:51` 이 `handle.query` 를 null 검사 없이 부른다 — FIX 3 이 SQLite 에
    고친 것의 정확한 거울상. 오늘은 도달 불가하나 Plan 2 에서 문제가 된다.
판정: 셋 다 Minor 이고 병합을 막지 않는다. 스킬 규칙상 fix wave 는 1회뿐이므로 park 하고
사용자에게 보고한다. (b) 는 한 줄 주석이면 되므로 Plan 2 착수 시 가장 먼저 처리한다.
— 틀렸을 때 비용: (b) 가 현실화되면 데이터가 두 파일로 갈린다. 다만 MOBIUS_SQLITE_PATH 를
   운영에서 설정할 이유가 현재 없다.


### Ruling 25 — update_parent_by_delete 중복 정의는 조치하지 않는다
sql_action.js:3425 와 :3457 에 바이트 동일한 본문으로 두 번 정의되어 있다(재리뷰어가
라인 단위 대조 확인). JS 재할당으로 :3457 이 유효하고 :3425 는 도달 불가. **동작 영향 없음.**
이 브랜치가 만든 것이 아니라 기존 코드다. 분류 문서가 이미 Step 4 정리 대상으로 라우팅했다.
판정: 지금 고치지 않는다. Plan 2 Step 4 에서 처리.
— 틀렸을 때 비용: 없음. 죽은 코드가 조금 더 남을 뿐.
