# 요청 처리 흐름 — 남은 일

- **기준**: `lite` @ `61fc3be` (2026-09-04)
- **이 문서의 성격**: 계획서가 아니라 **남은 일 목록**이다. 끝난 것은 §6 에 한 줄씩만 적었다
- **앞선 문서**: [2026-08-26 요청 흐름 분석](../archive/2026-08-26-request-flow-perf-analysis.md)
  — 1,484줄. 그 문서의 결함 목록(D1~D20)은 **전부 처리됐고**, 개선 제안(§9)은
  일부만 실현됐다. 보관용이며 **읽고 계획을 세우지 말 것**

## 0. 이 문서를 읽는 법

**항목마다 `파일:행` 이 붙어 있다. 착수 전에 그 자리를 직접 열어 확인하라.**

앞선 문서가 낡아서 실제로 사고가 났다 — 2026-09-03 에 그 문서를 읽고
"캐시 모듈화가 남았다" 고 보고했는데, 그 캐시는 이미 삭제돼 있었다.
같은 날 "아웃바운드 11곳 전부 타임아웃 걸림" 이라고 적었는데 WebSocket 알림은
빠져 있었다. **문서를 신뢰하지 말고 코드를 신뢰하라.**

이 문서는 요원 14명이 7개 축으로 코드를 읽고, 나온 주장을 반증 단계에 태워
만들었다. 그래도 같은 함정에서 자유롭지 않다.

---

## 1. P0 — 기동 실패가 조용하다

### 1.1 DB 커넥션을 못 얻으면 포트를 안 열고 그냥 산다

```
app.js:481  db.connect((rsc) => {
app.js:483    db.getConnection((code, connection) => {
app.js:485      if (code === '200') {
app.js:525          for (var i = 0; i < cpuCount; i++) worker[i] = cluster.fork();
                    ...
app.js:552      else { console.log('[db.connect] No Connection'); }   ← 끝
```

`cluster.fork()` 가 `getConnection` 콜백의 성공 분기 **안에** 있다.
실패하면 로그 한 줄을 찍고 끝난다 — **프로세스는 살아 있고 어떤 포트도
열리지 않는다.**

워커도 같은 모양이다(`app.js:589-624`, 실패 시 `:621-623`). 워커가 죽지 않으니
`cluster.on('exit')`(`app.js:469`)이 발화하지 않아 **재포크도 안 걸린다.**
재기동 없이는 영구 결원이고, 다른 워커가 정상이면 서비스는 "느려짐" 으로만
보인다.

**왜 지금 문제인가.** MySQL 어댑터의 `connect` 는 `createPool` 만 하고 언제나
`'1'` 을 준다 — 실제 접속은 첫 `getConnection` 에서 일어난다. 기동 순간
MySQL 이 잠깐 늦거나 비밀번호가 틀리면 이 상태가 된다. 헬스체크는
"프로세스 살아 있음" 으로 보이고 요청은 전부 연결 거부다.

**고칠 방향.** 실패 시 종료(`process.exit`)해서 pm2 가 다시 띄우게 하거나,
재시도 루프를 둔다. 어느 쪽이든 **지금처럼 조용히 사는 것보다 낫다.**

---

## 2. P1 — 마스터에서 도는 주기 작업

**이 절은 2026-09-04 에 크게 줄었다.** 원래 네 항목이었는데 셋이
프로토콜 프록시 3종(`pxy_mqtt`·`pxy_coap`·`pxy_ws`) 안에 있었고,
그 셋을 지우면서(`4a47c48`) 함께 사라졌다. 지운 근거와 되살릴 때 필요한
것은 [프로토콜 프록시 제거 기록](../reports/2026-09-04-protocol-proxy-removal.md)에 있다.

### 2.1 주기 작업 래치에 타임아웃이 없다  ← **남은 유일한 P1**

```
app.js:366-391   purge_sweep_tick      purge_running      (플래그는 :364)
app.js:396-450   reconcile_counters    reconcile_running  (플래그는 :334)
```

둘 다 플래그를 켜고 **DB 콜백 안에서만** 끈다. 질의가 매달리거나 커넥션이
죽어 콜백이 유실되면 플래그가 켜진 채 남고, 10초 틱과 24시간 틱이
`if (running) return` 으로 전부 튕긴다. **그 주기 작업이 영구히 멈추고
로그도 안 난다.**

마스터에서 도는 일이라 워커 재기동으로 회복되지 않는다. 프로세스를 다시
띄우기 전까지 보존 정책 스윕과 카운터 정합이 멈춘 채로 있게 된다.

**고칠 방향.** 래치에 시각을 함께 담아, 일정 시간이 지나면 스스로 풀리게
한다. 또는 `db.getConnection` 에 이미 있는 임대 장부(`mobius/lease.js`)처럼
오래된 것을 알리는 감시를 붙인다.

### 2.2 워커의 maxSockets = 1,000,000  — **고치지 마라 (지금은)**

```
app.js:650 · 667    워커 블록 (http · https)
app.js:710 · 722    죽은 단일 프로세스 분기 (use_clustering = 1 하드코딩)
```

`globalAgent` 는 Mobius 가 **밖으로 보내는** HTTP 요청의 커넥션 풀이고,
`maxSockets` 는 상대 호스트 하나당 동시 소켓 상한이다.

**이 네 줄은 사실상 아무 일도 안 한다.**

```
Node 의 http.globalAgent.maxSockets 기본값 = Infinity
```

값을 올리는 것이 아니라 **낮추는** 줄이다(Infinity → 1,000,000). 그리고
1,000,000 은 어떤 현실적 부하에서도 안 걸린다.

원래 이 항목은 **마스터** 프록시의 것이었다(`pxy_mqtt.js:66`·`pxy_ws.js:68`).
MQTT 유입은 브로커가 밀어 넣어 역압이 없으므로 마스터 FD 가 위험했다.
그쪽은 파일과 함께 사라졌다.

**판단: 지금 손대지 마라.** 해가 없고, 넷 중 둘은 죽은 코드 안이며,
지금 워커를 죽이는 결함(§3.2)과 ACP 구멍(§3.5)이 대기 중이다.

**그 근처를 손댈 때 같이 지워라.** 이 줄은 "동시성을 100만으로 튜닝했다" 는
인상을 주는데 사실이 아니라 읽는 사람을 오해시킨다. 진짜 역압이 필요하다고
판단되면 그때는 실측으로 숫자를 정해야 하고, 그것은 별건이다.

> **참고 — 마스터는 accept 루프다.** 리눅스에서 `cluster.schedulingPolicy`
> 기본값이 `SCHED_RR` 이라 리스닝 소켓을 마스터가 갖고 accept 한 뒤 fd 를
> 워커에 넘긴다. **마스터 이벤트 루프가 막히면 워커가 전부 멀쩡해도 신규
> 연결이 수락되지 않는다.** "마스터는 요청을 처리하지 않는다" 는 서술이
> 이 사실을 가린다.
>
> 프록시가 사라진 지금 마스터에서 도는 것은 **주기 작업 둘과 cluster 관리**
> 뿐이다. 그만큼 이 위험은 줄었다.
---

## 3. P2 — 도달 가능한 결함

### 3.1 `?rcn=7` 이 400 대신 500 을 받는다

```
mobius/resource.js:1514   callback('400');      ← 카탈로그에 없는 코드
게이트                     app.js:2239 (rcn == 7 허용), app.js:1676-1681
```

`settle.error('400')` → `reason.get('400')` 이 `null` → `app.js:1131` 이
"정의되지 않은 코드" 로 500 을 낸다. **그것도 discovery 를 다 돌린 뒤에.**

### 3.2 옛 7인자로 `response_result` 를 부르는 자리 6곳

```
시그니처   responder.js:442   (request, response, status, rsc, cap, callback)   ← 6개
호출       resource.js:574 · 1312 · 1955 · 1968 · 1978 · 1991
           (request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg'])
                                        ^^^^^^^^  한 칸씩 밀린다
```

인자가 밀려 이렇게 들어간다:

| 파라미터 | 받는 값 |
|---|---|
| `rsc` | `body_Obj` — **객체** |
| `cap` | `4000` |
| `callback` | `body_Obj['dbg']` — **문자열** |

두 가지가 동시에 터진다.

1. `apply_headers(request, response, rsc)` 에 객체가 가서
   **`X-M2M-RSC: [object Object]`** 가 나간다. 이 저장소가 이미 배포에서
   한 번 겪은 그 결함이다
2. `responder.js:465`·`470`·`568` 이 `callback()` 을 부르는데 문자열이라
   **TypeError → 워커 사망**

**도달 가능성을 자리마다 확인해야 한다.** 여섯 곳 다 에러 응답 경로라
평소에는 안 지나갈 수 있다.

### 3.3 ~~MQTT 프록시가 내부 함수명과 예외 원문을 발행한다~~ — 해결됨

`pxy_mqtt.js:575-578` 이 `'[mqtt_response]' + e.message` 를 응답 토픽으로
발행하고 있었다. `501b195` 가 HTTP 에서 닫은 것과 같은 부류였다.

**2026-09-04 에 파일과 함께 사라졌다**(`4a47c48`).

> 다만 **같은 부류를 다른 곳에서 다시 만들지 않도록** 남겨 둔다 — 예외 원문과
> 내부 식별자는 클라이언트로 나가면 안 된다. HTTP 쪽은 `501b195` 가 닫았고,
> 지금 저장소에 남은 아웃바운드는 알림(`sgn_man.js`)뿐이다.

### 3.4 `/hit` · `/total_ae` · `/total_cbs` 가 검증도 ACP 도 안 거친다

```
app.js:2222   extra_api_action(connection, request.url, …)   ← 먼저
app.js:2232   check_xm2m_headers(…)                          ← 나중
```

이 세 URL 로 GET 하면 `X-M2M-RI` 도 `X-M2M-Origin` 도 없이 200 과 JSON 이
돌아온다. 그리고 `app.js:2283-2285` 는 **정산기까지 우회한다** —
응답보다 먼저 커넥션을 반납하고 이중 정산 방지 장치를 안 탄다.

### 3.5 관찰 모드가 `pvs` 거부까지 뒤집는다

```
mobius/acp_observe.js:101-106   OBSERVABLE — decided_by 만 본다
mobius/security.js:559
```

`OBSERVABLE` 이 `trace.field`(`'pv'` | `'pvs'`)를 안 본다. 그래서 관찰 창
동안 **인증된 아무나 ACP 본문을 고치거나 지울 수 있고, 그 변경은 관찰 모드를
꺼도 돌아오지 않는다.**

`acpObserveMode` 는 "잠그기 전에 무엇이 막힐지 보는" 용도인데, `pvs` 는
ACP 자신에 대한 UPDATE·DELETE 라 성격이 다르다.

---

## 4. P3 — 커넥션 수명

### 4.1 응답을 정산한 뒤에도 요청 커넥션 위에서 도는 쓰기 3곳

```
resource.js:403    update_parent_st(…, function () { });   빈 콜백
                   callback('200');                        ← 밖에서 곧바로

resource.js:2538   같은 모양
resource.js:2562   같은 모양

대조군
resource.js:441    update_parent_counters(…, function () { callback('200'); });
                                                          ^ 안에서 부른다. 이쪽이 옳다
```

세 곳 모두 질의를 발행하고 **빈 콜백을 준 뒤 그것을 기다리지 않고** 상위
콜백을 부른다. 상위는 `settle` 로 이어져 응답을 보내고
`db.release(connection)` 을 한다 — **아직 그 커넥션 위에서 쓰기가 돌고 있는데
반납한다.**

`sgn.js` 에서 이미 고친 것과 **같은 유형**이다(D17). 고치는 모양도
`resource.js:441` 이 이미 보여 준다.

### 4.2 `hit` UPSERT 가 요청 커넥션 위에서 줄을 선다

```
GET     app.js:2228
PUT     app.js:2311
DELETE  app.js:2405
POST    app.js:2078   ← 여기만 자기 커넥션
```

mysql2 는 커넥션마다 명령 큐를 하나 둔다. fire-and-forget 으로 쓰였는데도
**그 요청의 첫 SELECT 앞에 선다.** POST 처럼 전용 커넥션을 쓰거나, 검증
뒤로 옮겨야 한다(§5.1 과 같이 처리하면 좋다).

### 4.3 CIN 생성/삭제의 트랜잭션 비대칭

```
mobius/sql_action.js:3410   update_parent_counters   트랜잭션 없음
mobius/sql_action.js:3480   update_parent_…          BEGIN/COMMIT
```

둘 다 "cnt 의 `cni`/`cbs` 를 증분하고 lookup 의 `st` 를 증분한다" 는 같은 두
문장인데 한쪽만 트랜잭션 안이다. 파사드 가로채기로 실측 확인됐다.

---

## 5. P4 — 구조와 성능 (급하지 않다)

### 5.1 `set_hit` 이 헤더 검증보다 먼저다

```
POST    set_hit 2080 < check_xm2m_headers 2105
GET             2228 <                    2232
PUT             2311 <                    2315
DELETE          2405 <                    2409
```

`X-M2M-RI` 가 없어 400 으로 거절될 요청도 `hit` 테이블에 쓴다.
POST 는 이를 위해 풀 커넥션을 하나 더 잡는다.

### 5.2 팬아웃이 직렬이라 최악 대기가 곱해진다

```
mobius/fopt.js:146-204   fopt_member — 순차 재귀
mobius/fopt.js:133       멤버당 arm (기본 10초)
```

D16 이 "영원히 매달림" 을 "10초 뒤 끊김" 으로 바꿨지만, **직렬이라 한도가
멤버마다 새로 시작한다.** 무응답 멤버 50개면 최악 500초이고 그동안 요청의
DB 커넥션이 묶인다. `mid` 원소 수에 상한이 있는지도 확인할 것
(`mobius/grp.js:279`).

`Promise`/`async` 는 `fopt.js`·`grp.js` 어디에도 없다.

### 5.3 ACP 조회가 3단 직렬이다

```
1단  select_acp_cnt 재귀    security.js:589 → sql_action.js:2192, 재귀 :2226
2단  get_ri_list_sri        acpi 원소마다 1회   ← 이 단은 없앨 수 있다
3단  select_acp_in          IN 1회 (여기만 배치)
```

**2단은 정상 사용에서 결과가 항상 0행이다.** `validate_acpi`
(`resource.js:2055-2094`)를 통과해 저장된 `acpi` 는 이미 `ri` 표기인데,
`get_ri_sri`(`sql_action.js:162-169`)는 `sri` 컬럼을 찾는다. 한 건도 안 맞는
질의를 원소마다 순차로 낸다.

### 5.4 `pv`/`pvs` 평가가 두 함수로 갈려 있다

```
mobius/security.js:460   security_check_action_pv
mobius/security.js:465   security_check_action_pvs
```

`security.check` 시그니처의 `ty` 파라미터도 그대로다
(`security.js:550`). 앞선 문서 §9.4 가 `evaluate(acp, ctx, acop, field)` 로
합치자고 했다.

> **`mobius/acp_eval.js` 를 되살리지 말 것.** 한때 판정을 그 파일로 추출했다가
> 대체·삭제됐고, 2차 병합에서 되살아나 ACP 시험 3벌이 죽었다. 통합을 다시
> 한다면 `security.js` 안에서 한다. **이 금지를 지키는 시험이 없고,
> `test/acp-eval.test.js` 라는 파일명이 남아 혼동을 준다.**

### 5.5 요청 경로의 `console.time` 계측 37곳

```
mobius/sql_action.js   console.time 37곳 / timeEnd 46곳 / shortid.generate 12곳
mobius/resource.js     2곳
감시                    test/request-log-volume.test.js — app.js 와 문자열
                        'select_latest' 만 본다
```

CIN 생성마다 `sql_action.js:468` 이 stdout 에 한 줄을 낸다(실측 재현).
이 배포에서 CIN 생성은 가장 잦은 쓰기다. 커밋 `112619d` 가 app.js 에서 없앤
것과 같은 부류다.

### 5.6 그 밖에

- **구독별 DB 조회가 배치가 아니다** — `sgn.js` 에 `whereIn`/`IN (` 0곳
- **알림 전송 앞 1~10ms 랜덤 지연** — `sgn.js:185`·`421`. 근거가 주석에 없다
- **`csr` 포워딩 블록 4회 복붙** — `app.js:2179`·`2261`·`2358`·`2443`, 각 12줄
- **`access_value` 리터럴 12개가 9곳에 흩어짐** — 상수 정의가 없다
- **CORS 이중 적용** — `app.js:149` `cors()` 와 `:1983-1989` 수동 헤더
- **rsc↔HTTP 불일치** — 같은 `4005` 가 405·409 양쪽. 키 접두 규칙 위반 4건
  (`301-3`·`301-4`·`301-5` 가 http 405, `500-6` 이 400)
- **죽은 코드** — `ty == '33'`(없는 타입), `useobserver`(참조 0),
  `acor_allows`/`evaluate_acr`(시험만 부름), `check_allowed_app_ids` 의 mgo 분기,
  POST 의 `notify` 분기와 `check_ae_notify`(도달 불가),
  `sgnManPort`/`hitManPort`(아무도 안 듣는다)

---

## 6. 이미 끝난 것 — 다시 하지 말 것

앞선 문서를 읽고 착수하기 전에 이 목록을 볼 것.

| 항목 | 어떻게 끝났나 |
|---|---|
| 결함 D1~D20 | **전부 처리.** D20 은 `mn.js`/`asn.js` 삭제로 무의미해짐 |
| 핸들러 855줄 복붙 | 390줄. `settle.js` · `authorize_and_run` · `run_fanout` 세 추출의 결과 |
| `connection.release()` 81회 | **0회.** 정산기가 가져갔다 |
| `request = null` 75회 | **0회** |
| 에러 응답 관용구 47회 | **0회.** `response_error_result` 하나 |
| 아웃바운드 타임아웃 0곳 | http·https·coap **11곳 armed**. WS 는 §7 참조 |
| 팬아웃 무한 루프 | `ae1756d` |
| 콜백 유실 4 / 다중 호출 2 | `once`/`settle` |
| xml/cbor 응답 협상 | **전제 소멸.** json 전용이 되어 분기 자체가 없다 |
| 결과 코드 5곳 분산 | `rsc.js`·`reason.js` 카탈로그. `test/rsc-catalog.test.js` 16건이 지킨다 |
| 워커별 리소스/판정 캐시 | **삭제.** 모듈화가 아니라 제거로 끝났다. 재도입 금지 시험 2벌 |
| `usesuperuser` 하드코딩 | `conf.superUser` |
| `ipv6_idx` 오참조 · `actw` 반전 | `security.js` 안에서 수정 |
| knex 전환 | 100%. 파사드 경계 유지 |
| 기동 실패가 조용하던 것 | `47e3a7e`. DB 커넥션을 못 얻으면 종료해 감독이 다시 띄운다 |
| **프로토콜 프록시 3종** | `4a47c48`. **1,733줄 삭제.** 3년간 실사용 mqtt 32 / coap 0 / ws 0 — [제거 기록](../reports/2026-09-04-protocol-proxy-removal.md) |
| 프록시 본문 누적 · MQTT 캐시 누수 | 위와 함께 사라졌다. 위험한 `본문 += chunk` 패턴 **0곳** |

---

## 7. 감시가 못 보는 것

**착수 전에 이 절을 읽어라.** 여기 적힌 것은 "시험을 돌려도 안 걸린다".

### 7.1 MySQL 경로는 한 문장도 실행되지 않는다

MySQL 시험은 전부 `adapter.execute` 를 스텁으로 갈아끼우고 **만들어진 SQL
문자열만** 어서션한다(`test/discovery-cte.test.js:66-107` 등).

저장소가 이미 이 대가를 치렀다 — `test/purge-sweep.test.js:4-7` 이
"모킹 tap 은 SQL 을 기록만 할 뿐 실행하지 않으므로 조용히 통과했다.
배포에서 드러났다" 고 적어 두었다.

### 7.2 SQLite 로 도는 시험은 리소스 타입 16종을 실행할 수 없다

```
mobius/db/sqlite.js:117   supportedResourceTypes = ['1','2','3','4','5','23']
```

나머지 16종의 CREATE/UPDATE/DELETE/discovery 경로는 **어느 시험에서도 한 번도
실행되지 않는다.**

### 7.3 소스 감시 시험의 79%가 손으로 적은 파일 목록이다

전체 트리(`git ls-files`)를 훑는 것은 **4개뿐**이다. 나머지 35개는 목록 밖으로
코드가 옮겨지면 조용히 통과한다.

`cache_resource_url` 이 `mobius/cnt.js` 나 새 모듈에서 되살아나면
`no-resource-cache` 는 통과한다.

### 7.4 감시가 아예 없는 불변식

- **워커 카운터의 상대 증분**(`cni + 1`) — `CLAUDE.md` 가 명시한 불변식인데
  시험이 없다
- **`purge_sweep`/`reconcile_counters` 가 마스터에서만 돈다** — 배치가
  감시되지 않는다
- **`acp_eval.js` 부활 금지** — 문서에만 있다
- **`arm()` 의 유휴 타이머 한계** — 실측은 `outbound.js:60-74` 에 적혀 있으나
  시험으로 고정돼 있지 않다

### 7.5 헛도는 시험 하나

```
test/rsc-catalog.test.js:32-48   liveSuccess()
```

정규식이 `responder.response_result(x, y, '200', '2000'` 형태를 찾는데,
`fe1e694` 가 호출부를 `settle.result(...)` 로 바꿔서 **이제 주석 한 줄만
맞힌다.** "성공 코드의 (http, rsc) 쌍이 모두 카탈로그에 있다" 는 시험이
아무것도 검사하지 않는다.

---

## 8. WebSocket 알림 — 분류가 애매한 것

```
mobius/sgn_man.js:341-349   ws_client.connect(nu, subprotocol)   ← 인자 2개, 옵션 없음
```

아웃바운드 타임아웃이 없다. 상대가 TCP 는 받아놓고 101 Switching Protocols 를
영영 안 주면 `connect` 도 `connectFailed` 도 발화하지 않는다.

**다만 실사용이 없다** — 배포 구독 3,463개의 `nu` 스킴은 99.85%가 `mqtt://`,
나머지가 `http://` 3건이다. `ws://` 는 0건이다.

그래서 P0~P4 어디에도 넣지 않았다. **고칠 때 같이 고치면 되는 것**으로 둔다.
`test/outbound-timeout.test.js` 의 커버리지 감시는 이 자리를 보지 못하며,
그 사각지대가 시험 주석에 적혀 있다.

---

## 9. 착수 규칙

1. **항목의 `파일:행` 을 먼저 열어라.** 이 문서도 낡는다
2. **고친 것은 시험으로 못박아라.** 이 저장소의 관행이고, §7 이 그 관행의
   빈틈을 적어 둔 것이다
3. **시험이 정말 잡는지 돌연변이로 확인하라.** 값을 반대로 바꿔 보고 실패하는지
   본다. 주석만 보고 통과하는 시험을 이 저장소에서 여러 번 만들었다
4. **MySQL 경로를 바꿨으면 배포 규모에서 확인하라.** 로컬 시험은 sqlite 로 돈다
5. **마스터에서 도는 것을 바꿨으면 재기동 후 실제로 봐라.** 워커와 달리
   자동 복구가 없다
6. **지우기 전에 시험부터 고쳐라.** 이 저장소의 소스 감시 시험은 대부분
   `readFileSync` 에 `try/catch` 가 없다 — 파일이 사라지면 ENOENT 로 던진다.
   프록시를 지울 때 그런 자리가 시험 4개 파일 7개 시험 + 도구 1개였다.
   시험을 먼저 고치면 중간 상태에서도 `npm test` 가 통과한다
