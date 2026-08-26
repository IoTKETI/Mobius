# DB 레이어 추상화 2차분 — 결정 기록

- 작성일: 2026-08-27
- 대상 커밋 범위: `93af132..e558de9` (11 커밋)
- 계획: `docs/superpowers/plans/2026-08-26-db-layer-abstraction-part2.md`
- 1차분 결정: `docs/superpowers/specs/2026-08-26-db-layer-abstraction-decisions.md`

2차분 구현 중 컨트롤러가 내린 판정 13건이다.

## 3차 계획을 쓰기 전에 반드시 볼 것

- **Ruling 7** — `delete_lookup_et` 을 왜 되돌렸는지. 3차에서 다시 다룰 때 상한·`else`·`'200'` 정규화를 함께 설계해야 한다
- **Ruling 12** — 계획 문서와 테스트 주석에 28단계 기대값이 남아 있다. 하네스는 32단계다
- **Ruling 13** — 발견된 기존 결함 2건 (`update_dvc` 인자 개수 불일치로 죽은 코드, `ty==23` 분기의 콜백 누락)
- 1차분 **Ruling 17·20·22** — 에러 어휘 이관, 무분기 68개, SQL Injection 우선순위

## 이번 작업이 고친 것

| 대상 | 문제 | 확인 방법 |
|---|---|---|
| `update_acp` | SQLite 모드에서 ACP 정책 갱신 유실 | `acop` 63→51 수정 후 재조회 51 |
| `update_sub` | SQLite 모드에서 구독 갱신 유실 | `nu` 포트 59991→59992 수정 후 재조회 59992 |
| `update_lookup` | `acpi`/`at`/`aa`/`subl` 미이스케이프 (SQL Injection) | 따옴표+`drop table` 주입 무력화 |
| `update_acp` | `pv`/`pvs` 미이스케이프 (SQL Injection) | 〃 |

전환된 함수 8개: `update_lookup`, `update_acp`, `update_sub`, `get_ri_sri`, `select_cb`, `select_sum_cbs`, `select_sum_ae`, `update_cb_poa_csi`

`delete_lookup_et` 은 전환했다가 최종 리뷰에서 되돌렸다 (Ruling 7).

---

### Ruling 1 — 동등성 기준선이 이 워크트리에 없었다 (컨트롤러가 직접 확보)
`tools/equivalence/out/` 과 `tools/golden/out/` 은 gitignore 대상이라 새 워크트리에
따라오지 않는다. T3·T4·T6 이 `before-sqlite.json`/`before-mysql.json` 의 존재를
전제하는데 비어 있었다. 기준선은 **전환 전에** 떠야 하므로 T1 이 코드를 바꾸면
되돌리기 번거로워진다.
판정: 컨트롤러가 착수 전에 직접 확보한다(구현이 아니라 검증 준비이므로 내 몫이다).
확보 완료 — before-sqlite.json(28단계), before-mysql.json(28단계),
before-sqlite-sql.json(SQL 233건/44종).
— 틀렸을 때 비용: 없음. 기준선이 없으면 T3·T4·T6 이 비교할 대상이 없어 멈춘다.


### Ruling 2 — 계획의 `update_acp` 행 번호가 틀렸다
계획 T1 Files 가 `update_acp L2671-2690` 이라 했으나 실제는 **L2699** 다
(`grep -n "^exports.update_acp"` 확인). 분류 문서도 2699 로 적고 있다.
판정: 계획을 L2699 로 수정했다. 구현자가 잘못된 위치를 찾다 헤매지 않게 한다.
— 틀렸을 때 비용: 없음. 문서 정정이다.


### Ruling 3 — T1 Step 2 가 TDD 의 RED 를 기대하지 않는다
Step 1 의 테스트는 파사드가 이미 바인딩을 쓰므로 작성 즉시 통과한다. 계획이
"여기서 통과하는 것이 정상"이라고 명시하고 있으나, 리뷰 루브릭은 "즉시 통과하는
테스트"를 결함으로 볼 수 있다.
판정: 이 테스트의 목적은 새 동작을 이끄는 것이 아니라 **전환 후에도 바인딩 성질이
유지되는지 잠그는 회귀 테스트**다. RED 없음이 정당하다. 대신 진짜 RED/GREEN 증거는
T1 Step 6 의 통합 검증(ACP acop 63→51 반영)이 담당한다 — 전환 전이면 63,
전환 후면 51 이 나온다.
— 틀렸을 때 비용: 리뷰어가 이를 결함으로 올리면 이 판정을 근거로 기각한다.
   실질 위험 없음.


### Ruling 4 — SQLi 회귀 테스트가 실제 전환 함수를 검증하지 않는다 (fix now)
test/sqli-regression.test.js 가 db.k('acp').update(...) 를 직접 부를 뿐
exports.update_acp / exports.update_lookup 을 호출하지 않는다. 즉 "파사드가
바인딩한다"만 증명하고 "전환된 함수가 파사드를 그렇게 쓴다"는 증명하지 못한다.
sql_action.js 안에 util.format 이 다시 들어와도 이 테스트는 통과한다 —
이 프로젝트가 없애려는 결함 계열을 정확히 비켜간다.
리뷰어는 "기존 test/db-facade.test.js 도 같은 패턴이라 신규 결함은 아니다"라며
후속 처리를 권했으나, **브리프가 Task 2~4 에 이 패턴을 반복하라고 지시**하므로
지금 고치지 않으면 4개 태스크로 번진다.
판정: 어댑터의 execute 를 스텁으로 갈아끼워 exports.update_acp 를 실제로 호출하고,
드라이버에 도달하는 sql/bindings 를 검사하는 테스트를 추가한다.
— 틀렸을 때 비용: 테스트 파일이 조금 커진다. 스텁이 실드라이버와 어긋날 위험은
   있으나 목적은 "값이 SQL 본문에 박히지 않는다"를 잠그는 것이라 충분하다.

### Ruling 5 — 동등성 "28/28 일치"가 6개 중 5개에 무의미하다 (fix now)
리뷰어가 각 함수의 호출부를 추적한 결과:
  delete_lookup_et  — setInterval(24시간) 로만 호출. 시나리오 창(13초)에 절대 안 돎
  select_sum_ae/cbs — /total_ae, /total_cbs 커스텀 라우트 전용. 시나리오가 요청 안 함
  select_cb         — asn.js/mn.js 에서만, usecsetype=='mn'|'asn' 게이트. 기본은 'in'
  get_ri_sri        — acpiList 가 비면 단락됨. 시나리오 요청 본문에 acpi 가 없음
  update_cb_poa_csi — 부팅 시 CSE 자기등록에서 1회. 유일하게 실행 가능성 있음
즉 "차이 없음"은 옳지만 이유가 다르다 — **함수가 실행되지 않았을 뿐**이다.
리포트가 이를 "시나리오 범위에서 동일한 결과를 냈다"고 적어 미검증 코드를
검증된 것처럼 제시했다.
판정: tapAdapter 패턴(Task 1 확립)으로 6개 각각의 생성 SQL/bindings 를 잠그는
테스트를 추가한다. 동등성 하네스가 못 닿는 함수는 단위 테스트로 덮어야 한다.
— 틀렸을 때 비용: 테스트 파일이 커진다. 스텁이 실드라이버와 어긋날 위험은 있으나
   목적은 "생성 SQL 이 원본과 같은 의미인가"를 잠그는 것이라 충분하다.

### Ruling 6 — Task 3+4 리뷰어의 "get_ri_sri 미실행" 판단이 부분적으로 틀렸다
리뷰어는 acpiList 단락 때문에 get_ri_sri 가 시나리오에서 실행되지 않는다고 판단했으나,
SQL 탭이 실제 실행을 포착했다(mysql -> sqlite 이동으로 관측). update_cb_poa_csi 도 마찬가지.
다만 동등성에 차이가 없던 이유는 여전히 성립한다 — 쿼리가 엉뚱한 DB 로 가서 빈 결과를
돌려줬고, 호출부가 빈 결과를 같은 방식으로 처리했기 때문이다. 즉 "실행됐지만 관측 가능한
차이를 안 냈다"가 정확한 서술이다.
판정: 기록만 남긴다. Task 3+4 의 단위 테스트가 이미 이 6개를 덮고 있어 추가 조치 불필요.
— 틀렸을 때 비용: 없음. 사실관계 정정이다.


### Ruling 7 — Critical: delete_lookup_et 전환이 휴면 중이던 파괴적 경로를 깨운다 (되돌린다)
전환 전에는 SELECT 가 무조건 MySQL 로 나가 SQLite 배포에서는 사실상 아무것도
안 했다. 전환하면 SQLite 에서 실제 만료 행을 가져오고, **미전환** delete_lookup 이
그걸 지운다. 문제가 겹겹이다:
  - SELECT 에 상한이 없다. 형제 delete_orphan_lookup 은 LIMIT 1000 을 쓰고
    "라이브 트래픽 중 락 시간이 짧다"는 주석까지 달려 있다(내가 원본 확인).
    이 저장소는 09477df "Cap purge pass lock time and stop log flooding" 을
    이미 겪었다.
  - 행마다 DELETE 1건 + console.log 1줄을 순차 실행. 단일 SQLite 쓰기 핸들에서
    락 스톰 + 로그 범람.
  - 작업 집합이 안 줄어든다. 만료 행의 *자식*을 지울 뿐 만료 행 자체는 안 지운다.
    매일 같은 집합 + 신규가 누적된다.
  - SELECT 실패 시 else 가 없어 콜백이 호출되지 않는다 -> app.js:112 의
    connection.release() 가 콜백 **안**에 있어 커넥션이 샌다(내가 원본 확인).
  - delete_lookup 이 성공을 callback('200') 로 알리는데 '200' 은 truthy 라
    app.js:107 의 if (!err) 가 **항상 거짓**이다. 성공/실패 구분 불가.
  - setInterval 24시간이라 **배포 24시간 뒤 마스터에서만** 처음 발화한다.
    이번 작업의 어떤 검증으로도 드러날 수 없었다.
판정: **이 함수 전환을 이번 PR 에서 되돌린다.** 9개 중 유일하게 하류가 파괴적이고,
유일하게 하류가 구 핸들에 남아 있으며, 유일하게 계약이 이미 깨져 있다. 상한·else·
'200' 정규화는 그 자체로 설계가 필요한 수정이지 전환에 끼워 넣을 것이 아니다.
— 틀렸을 때 비용: delete_lookup_et 이 SQLite 모드에서 계속 휴면한다. 그건 오늘과
   같은 상태이므로 새 위험이 없다. 나머지 8개는 그대로 나간다.


### Ruling 8 — Important #5: update_action 이 에러를 아무것도 안 찍는다 (fix now)
resource.js 의 update_action 은 실패 시 callback('500-1') 만 하고 로깅이 없다.
파사드가 err.code 를 UNKNOWN 으로 덮으므로 전환된 함수의 실패는 진단 불가능한
500 이 된다. Task 5 가 "해당 없음"으로 결론냈는데, ER_DUP_ENTRY 검사가 없다는
부분은 맞지만 Ruling 17 의 두 번째 절(로그도 함께 고친다)을 "로그가 없으니 해당
없음"으로 읽었다. 로그가 없는 건 code 만 찍는 것보다 **더 나쁘다**.
판정: update_action 의 에러 분기에 driverCode/message 를 찍는 한 줄을 넣는다.
— 틀렸을 때 비용: 로그 한 줄이 는다.


### Ruling 9 — Recommendation #4: 시나리오에 acp-update / sub-update 추가 (fix now)
이번 PR 의 두 핵심 수정(ACP·구독 갱신)을 내가 curl 로 직접 확인했으나, 그건 일회성이라
아무도 다시 안 돌린다. 하네스에 이미 acp-create/sub-create 가 있으므로 두 단계만
더하면 영구 회귀 커버리지가 된다. 리뷰어가 "highest value-per-line" 으로 꼽았다.
판정: 추가한다. 단계 수가 28 -> 30 이 되어 기존 기준선과 비교 불가해지므로,
**같은 조건 두 번 실행이 일치하는지**로 결정성을 증명하고 3차 계획 착수 시
기준선을 새로 뜬다.
— 틀렸을 때 비용: 이번 PR 의 동등성 비교는 이미 28단계로 끝냈고 통과했다.
   새 단계가 불안정하면 두 번 실행 비교에서 드러난다.


### Ruling 10 — Important #6 일부: SQLite 모드 단위 테스트 보강 (fix now)
converted-queries.test.js 가 전부 tapAdapter(false)(MySQL)만 쓴다. 고치려는 결함
종류가 "SQLite 모드가 MySQL 로 라우팅된다"인데 SQLite 모드 실행이 테스트에 없다.
판정: 남은 함수들에 tapAdapter(true) 변형을 추가해 sqlite 어댑터가 호출을 받는지
단언한다.
— 틀렸을 때 비용: 테스트가 는다. 리뷰어가 방언 차이 위험은 낮다고 실측 확인했으므로
   새 결함을 찾을 가능성은 낮지만, 라우팅을 잠그는 값이 있다.


### Ruling 11 — 나머지는 3차 계획으로 이월
Important #2(update 계열 비원자성 — 3차의 원자성 범위에 포함), #3(assertReady 동기
throw), #4(SQLite 경로 분기 — MOBIUS_SQLITE_PATH 를 db_sqlite.js 도 읽도록),
#7(insert_lookup 전환 전 ER_DUP_ENTRY 29곳 선행 이관 — 3차 계획의 Global
Constraints 에 차단 조건으로 명시), Minor #8~11.
판정: 이월. 리뷰어 triage 를 따른다.
— 틀렸을 때 비용: #7 을 놓치면 insert_lookup 전환 시 모든 중복 생성이 409 에서
   500 으로 바뀐다. 하네스의 ae-create-duplicate 가 잡지만 원인 추적에 시간이 든다.


### Ruling 12 — 잔여 Low 3건을 park 한다 (fix wave 2회차 없음)
(a) test/converted-queries.test.js:16 의 헤더 주석이 "동등성 28/28 일치"를 인용하는데
    같은 wave 의 75032fe 가 하네스를 32단계로 바꿨다. wave 가 만든 자기모순 문서다.
(b) plans/...part2.md:741 Step 5 의 기대값이 "28단계 일치"로 남아 있다. 그대로 돌리면
    32단계가 나와 실패로 오독될 수 있다.
(c) resource.js 의 새 로그 33곳이 console.log 다. CLAUDE.md 는 logger 사용을 규정한다.
    내가 그 형태를 지시했으므로 의도된 이탈이다.
판정: 스킬 규칙상 fix wave 는 1회뿐이므로 park 한다. (a)(b)는 3차 계획을 **내가**
작성하므로 그때 32단계 기준으로 새로 쓰면 자연히 해소된다. (c)는 프로젝트 전반의
logger 전환과 함께 다뤄야 할 사안이라 단독 수정이 부적절하다.
— 틀렸을 때 비용: (b)를 놓치면 3차 작업자가 28단계 기대값을 보고 혼란한다. 3차 계획
   작성 시 내가 반영한다.


### Ruling 13 — 발견된 기존 결함 2건은 3차로 이월
(a) resource.js:1700 (ty==13/mgd==1008) 이 update_dvc 를 16개 인자로 부르는데
    시그니처는 3개다. obj 에 문자열이, callback 에 JSON 문자열이 들어가 콜백이
    문자열을 호출한다 — **죽은 코드**. master 에도 있는 기존 결함.
(b) resource.js 의 ty=='23' 내부 분기들이 select_lookup/update_lookup 실패 시
    else 가 없어 콜백을 떨어뜨린다 — 요청이 행 걸린다. 기존 결함.
판정: 둘 다 이번 전환이 만든 것이 아니고 별도 수정이 필요하다. 3차 계획에 기록한다.
— 틀렸을 때 비용: (a)는 이미 죽은 코드라 영향 없음. (b)는 실패 시 요청 행 걸림이
   계속되나 오늘과 같은 상태다.
