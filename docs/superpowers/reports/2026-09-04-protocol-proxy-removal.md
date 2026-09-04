# 프로토콜 프록시 3종 제거 — 무엇이었고, 왜 지웠고, 되살리려면

- **지운 것**: `pxy_mqtt.js` · `pxy_coap.js` · `pxy_ws.js`
- **기준**: `lite` @ `47e3a7e` 에서 작업, 2026-09-04
- **이 문서의 목적**: 되살릴 때 덜 아프도록 남긴다. **git revert 로는 안 된다** — §5 참조

## 1. 무엇이었나

oneM2M 의 MQTT / CoAP / WebSocket 바인딩을 받아 **자기 자신의 HTTP 포트로
되던지는 루프백 프록시**다. 요청을 직접 처리하지 않고 `http://localhost:7579`
로 다시 쏜 뒤 응답을 원래 프로토콜로 포장해 돌려줬다.

**cluster 마스터에서 돌았다** (`app.js:583-585` 의 `require`). 워커가 아니다 —
되살릴 때 그대로 마스터에 둘지 워커로 옮길지가 판단 지점이다.

```
포트   pxyWsPort   = 7577  (TCP)
       pxyMqttPort = 7578  (TCP, 라우트 없는 HTTP 서버)
       pxy_coap    = 7579  (UDP, csebaseport 와 같은 번호)
```

**이 숫자는 어느 커밋으로도 복원되지 않는다.** `conf.json` 은 `.gitignore`
대상이고, 없을 때 `mobius.js` 가 만드는 것은 `csebaseport`·`dbpass`·`db`
세 키뿐이다. 그래서 여기 적어 둔다.

## 2. 왜 지웠나 — 3년치 실측

배포 DB 의 `hit` 테이블(프로토콜별 일일 카운터)을 전수 조회했다.

```
1,092일 누적 (2022-10-31 ~ 2026-09-03)
    http   124,988,941
    mqtt            32
    coap             0
    ws               0

http 외가 기록된 날은 3일뿐
    20240320  mqtt=30      20240322  mqtt=1      20241123  mqtt=1
```

**CoAP·WebSocket 은 3년간 단 한 건도 없다.** MQTT 는 3일, 마지막이 9개월 반 전,
누적 32건이다. 2024-03-20 의 30건은 한 번의 연동 시험으로 보인다.

삭제 직전 배포 실측(20초 관찰)도 같은 답을 줬다.

```
tcp *:7577  (pxy_ws)         연결 0.  TIME-WAIT 조차 0
tcp *:7578  (pxy_mqtt HTTP)  연결 0
udp   :7579 (pxy_coap)       rx_queue 0, drops 0
pxy_mqtt 의 브로커 구독 2개   20초간 0건

같은 20초에 알림 토픽 146건, tcp *:7579 에 외부 IP 6개
```

그리고 이 셋이 알려진 결함의 근원이었다 — 크기 상한 없는 원시 `+= chunk`
10곳이 전부 여기, `pxy_mqtt` 메시지 캐시의 영구 누수(`ttl` 필드 없음),
`maxSockets` 1,000,000. **마스터라 자동 복구가 없다.**

저장소가 이미 예고해 두기도 했다 — `mobius/rsc.js:166` 과 `pxy_coap.js:22` 에
"CoAP 바인딩은 쓰는 배포가 없고 삭제 예정" 이라 적혀 있었다.

## 3. 알림은 이것과 **별개다**

**이걸 안 적어 두면 다음 사람이 "MQTT 를 지웠는데 알림이 왜 도나" 로 헤맨다.**

```
mobius/sgn_man.js:20   require('mqtt')       자기 클라이언트를 따로 연다
mobius/sgn_man.js:21   require('coap')
mobius/sgn_man.js:341  require('websocket')

pxy_ 를 require 하는 곳: 0
```

토픽도 안 겹친다.

```
알림 발행   /oneM2M/req/<cseid>/<aeid>/json
pxy 구독    /oneM2M/req/+/<cseid>/+          <- aeid 자리에 cseid 가 와야 매치
```

배포 구독 3,463개의 **99.85%가 `mqtt://`** 로 알림을 받는다. 그 경로는
워커 24개가 각자 브로커에 건 연결이고, `pxy_mqtt` 의 마스터 연결 1개와는
별개다. **삭제해도 그대로 돈다** — 반증 단계에서 여섯 갈래로 깨뜨리려 했으나
전부 버텼다.

그래서 npm 의존성 `mqtt`·`coap`·`websocket` 은 **하나도 지우지 않았다.**

## 4. 코어에 걸치던 접점 — 되살리려면 이것만 맞추면 된다

```
global.make_json_obj(str, callback)     2026-09-01(044f29a)에 bodytype 인자가 빠져
                                        2인자가 됐다. 옛 3인자로 부르면 조용히 틀린다
wdt.set_wdt(tid, 주기초, 콜백)
outbound.arm(req, 라벨)
mobius/rsc.js 의 RSC.BAD_REQUEST.rsc · RSC.INTERNAL_SERVER_ERROR.rsc · toCoapCode(rsc)

암묵 전역
    usecsebaseport · usecsebase · usecseid
    usepxywsport · usepxymqttport · NOPRINT
```

`pxy_mqtt.js:28` 의 `require('./mobius/responder')` 는 파일 안에서 한 번도
안 쓰던 죽은 줄이다. 되살릴 때 넣지 말 것.

프록시는 `responder.response_result` 를 **전혀 부르지 않았다.** 저장소에 남은
옛 7인자 호출은 `mobius/resource.js` 쪽 문제이지 프록시와 무관하다.

## 5. **되살리는 것은 revert 로 안 된다**

이 문서에서 가장 중요한 절이다. 처음엔 "필요하면 그때 되살리면 된다" 로
생각했는데, 반증 단계가 그것을 깨뜨렸다.

**(가) 이 코드는 잠들어 있지 않았다.** 프록시를 건드린 커밋 25개 중
**10개가 2026-08-28~09-01 여드레에 몰려 있고**(그 앞은 2026-04-16),
그중 7개가 코어 변경을 따라간 적응 커밋이다. 가장 빠르게 끌려다니던 코드다.

**(나) 사흘 만에 이미 시그니처가 깨졌다.** `global.make_json_obj` 가
`(bodytype, str, cb)` → `(str, cb)` 로 바뀌었다(`044f29a`).

**(다) 실패가 조용하다.** `require` 자리가 마스터 블록이고 backstop 은 마스터를
살린다. 그래서 되살린 프록시가 어긋나면 크래시 없이 **메시지마다 TypeError 를
뱉는 벙어리 프록시**가 된다.

**(라) 검증할 시험이 없다.** 프록시를 참조하던 13곳이 전부 소스 문자열 검사이고,
MQTT/WS/CoAP 를 **실제로 여는 시험이 0건**이었다.

**(마) 이 저장소의 선례가 더 나쁘다.** `mobius/acp_eval.js` —
`8f5d13e` 추출 → `063b7c4` 재추출 → `ef995cc` 센티널 불일치 fix →
`82a50d6` ipv6 IP 출처 복원(Critical 2). 교정 두 건이 들었고 **파일은 지금 없다.**

**(바) git 이 못 되살리는 조각이 있다.** §1 의 포트 값이 그렇다.

**결론: "지우고, 필요하면 새로 만든다."** 이 저장소가 xml/cbor·ASN/MN-CSE·
시맨틱 브로커에 쓴 표현 그대로다.

## 6. 되살렸다면 이렇게 확인하라

`npm test` 로는 프록시가 도는지 알 수 없다(§5-라). `044f29a` 가 실제로 밟은
경로를 그대로 옮겨 적는다.

```
MQTT
  xml 토픽으로 발행      -> 4000 거절
  cbor 토픽으로 발행     -> 거절
  json 토픽으로 발행     -> 2001 생성

WebSocket
  json 서브프로토콜      -> AE 생성 2001
  xml 서브프로토콜       -> 거절
  축약형 + 깨진 본문     -> 4000

알림
  구독 만들고 CIN 생성   -> HTTP 수신기에 1건 도착
```

## 7. 같이 지운 것과 남긴 것

**같이 지웠다** (삭제 후 소비자 0):

| 대상 | 왜 |
|---|---|
| `wdt.js` 전체 + `global.wdt` | `set_wdt` 호출자 4개가 전부 프록시 안 |
| `global.make_json_obj` (`app.js`) | 호출처 5곳이 전부 프록시 |
| `mobius/rsc.js` 의 CoAP 절 | `toCoapCode`·`coapFor`·`missingCoap`·`COAP_ONLY` 운영 호출자 0 |
| `global.NOPRINT` | 세우는 곳 4, **읽는 곳은 프록시뿐**이었다 |
| `pxyWsPort`·`pxyMqttPort` | conf 키 + `mobius.js` 전역. **원자적으로 함께** (§8) |
| `usepxywsport`·`usepxymqttport` | 위와 짝 |

**남겼다**:

| 대상 | 왜 |
|---|---|
| npm `mqtt`·`coap`·`websocket` | 알림이 셋 다 쓴다 (§3) |
| `sql_action.js:119-127` 의 `M`/`C`/`W` 분기 | 도달 불가가 되지만 **과거 데이터와 스키마가 그 값을 갖고 있다** |
| `security.js` 의 `remoteaddress` 경로 | 저장소 내 생산자는 사라지나 시뮬레이터가 쓴다 |
| 죽은 단일 프로세스 분기(`app.js:684-736`) | 범위가 커진다. 별건으로 둔다 |

## 8. 원자적으로 지켜야 하는 짝

`test/conf-schema.test.js` 가 conf 키를 **양방향으로 강제한다** — 표에 없는 키를
읽어도, 아무도 안 읽는 키를 표에 둬도 실패한다.

```
mobius.js:154-155            global.usepxywsport / usepxymqttport
mobius/conf_schema.js:244-245  pxyWsPort / pxyMqttPort
```

**둘 다 남기거나 둘 다 지워야 한다.** 한쪽만 지우면 시험이 실패한다.

## 9. 이번에 드러난 곁가지 — 이미 고아였던 것

프록시와 무관하게 **이번 삭제 이전부터** 읽는 코드가 0이던 것들이다.

```
global.use_sgn_man_port  (mobius.js:157)
global.use_hit_man_port  (mobius.js:169)   hit_man.js 가 f34db1c 에서 삭제됨
```

이번 커밋 범위 밖으로 두되, 정리 대상으로 기록해 둔다.
