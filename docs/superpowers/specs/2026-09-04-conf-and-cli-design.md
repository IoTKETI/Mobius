# Mobius 설정·실행 — 코어 정리와 CLI

- 작성일: 2026-09-04
- 대상 브랜치: `lite`
- **개정**: 초판은 "설정 탭 · 실행 탭"(웹)이었다. **설정과 실행을 CLI 로 옮기면서 다시 썼다** — §1.3
- 선행 문서: [관리 콘솔 목표 재정의](2026-09-01-admin-console-purpose.md), [관리 콘솔 설계](2026-08-28-admin-console-design.md)

> ## 기조
>
> **설정과 실행은 CLI 가 맡는다. 웹은 리소스를 다룬다.**
>
> 이 경계는 편의가 아니라 **권한 경계**다. 설정과 실행은 마스터 키를 쥐는 일이라
> 서버에 SSH 로 들어온 사람만 해야 한다. 웹은 리소스를 보고 고치는 일이라
> 외부에서 접근해도 ACP 로 통제할 수 있다.

---

## 0. 요약

바꾸는 것은 여섯이다. **웹 화면은 새로 만들지 않는다.**

| | 무엇 | 어디 |
|---|---|---|
| 1 | 소스에 박힌 설정 9개를 conf 키로 내린다 (`mobius.js` 8 + `app.js` 1) | `mobius/conf_schema.js` · `mobius.js` · `app.js` |
| 2 | 포트를 열고, 죽은 키 1개를 지운다 | `conf_schema.js` 의 `exposed` |
| 3 | 기동 시 적용된 설정을 파일에 한 줄 남긴다 | `mobius.js` · `mobius/boot_record.js`(신설) |
| 4 | **`tools/mobius-ctl.js` 신설** — conf 조회·변경, 실행·정지·재기동, 상태, 로그 | `tools/` · `package.json` · `run_*.bat` |
| 5 | 코어 전제 조건 둘 — `windowsHide`, 포트 충돌 처리 | `app.js` · `mobius.js` |
| 6 | 웹에서 conf 편집·프로세스 제어를 걷어낸다 | `admin/` |

---

## 1. 범위와 경계

### 1.1 넣는 것

위 표의 여섯 가지.

### 1.2 빼는 것

- **웹 화면 신설** — 설정 탭도 실행 탭도 만들지 않는다. 기존 화면은 그대로 둔다
- **외부 접근 통제** — 로그인 시도 제한 · `Secure` 쿠키 · TLS · 사용자별 계정. 별도 사이클(§11)
- **sub 탭 · 리소스 탭** — 별도 사이클
- **기존 만료·고아·ACP 화면 정리**(0층 위반 4건 포함) — 별도 사이클
- **콘솔의 MySQL 풀 설정(100/0)** — 실제로 DB 를 치는 화면을 손볼 때 다룬다

### 1.3 도구 경계 — 왜 CLI 와 웹으로 나누나

초판은 설정 탭과 실행 탭을 웹으로 만들려 했다. 다시 보니 그 둘은 웹이어야 할 이유가 없었다.

| | CLI 가 맞는 이유 |
|---|---|
| 실행·정지·재기동 | pm2 가 이미 CLI 다. 그 위에 웹을 한 겹 얹는 것뿐이었다 |
| 로그 | `tail -f` 를 웹 tail 이 이길 수 없다 |
| 상태 | 한 줄이면 되는 일 |
| 설정 | 화면이 유리한 자리이긴 하나 **권한이 문제다** — conf 에는 `dbpass`·`superUser` 가 있다 |

그리고 웹에서 이 둘을 빼면 **외부 공개의 위험 대부분이 사라진다.**

| 위험 | 이 나눔에서 |
|---|---|
| 서버 정지·기동이 웹에 있다 | **웹에서 사라짐** |
| `conf` 편집이 웹에 있다 | **웹에서 사라짐** |
| 콘솔 비밀번호 = superUser 마스터 키 | 남는다 — §11 에서 따로 푼다 |

**의존 방향**은 이렇게 정리된다. 코어는 어느 쪽도 모른다.

```
mobius/conf_schema.js     선언 — 단일 진실원 (코어)
        ▲
tools/conf_store.js       파일 읽기·쓰기 (admin/ 에서 이동)
        ▲
tools/mobius-ctl.js       CLI — conf · 실행 · 상태 · 로그
        ▲
admin/                    웹. 리소스만 다룬다
```

`conf_store.js` 를 `admin/` 에서 `tools/` 로 옮긴다. 설정 편집이 CLI 의 일이 됐으니
`admin/` 소유가 아니고, 그대로 두면 `tools/ → admin/` 의존이 생겨 방향이 꼬인다.
시험 20건도 같이 옮긴다.

---

## 2. 설정을 conf 로 내린다

### 2.1 지금 설정이 어디에 흩어져 있나

| 어디 | 개수 |
|---|---|
| `conf.json` — 스키마에 선언되고 `exposed` | 14 (권한 7 · 요청 처리 2 · 저장소 5) |
| `conf.json` — 선언은 됐지만 `exposed: false` | 5 (포트 3 + 비밀 2) |
| `mobius.js` 상단 하드코딩 (`global.*`) | 8 |
| `app.js` 하드코딩 (`usespid`) | 1 |
| 콘솔 자신의 키 (`admin*`) | 7 (스키마 밖) |

> **기준선 주의.** 문서 작성 중 `4a47c48` 이 프로토콜 프록시 3종(`pxy_mqtt.js`·`pxy_ws.js`·
> `pxy_coap.js`)과 `wdt.js` 를 지웠고, 그와 함께 conf 키 `pxyWsPort`·`pxyMqttPort` 도
> 빠졌다(전체 21 → 19키). 아래는 그 이후 기준이다.

### 2.2 위험 3등급

전부 편집 가능하게 두지 않는다. `usecsebase` 를 추적한 결과가 그 이유다.

```
mobius/cb.js        CSEBase 의 ri = '' + '/' + 'Mobius'  =  /Mobius
mobius/resource.js  자식은  ri = pi + '/' + rn
```

**저장된 모든 경로가 `/Mobius/…` 로 시작한다.** 값을 바꾸면 `cb.js` 의 조회가 실패해
CSEBase 행이 하나 더 생기고 기존 트리 전체가 고아가 된다. discovery 의 `whole_tree`
최적화가 어긋나고, `fopt.js` 가 기존 멤버를 원격 CSE 로 오판해 **조용히 건너뛴다.**
확인 관문으로 감쌀 수 있는 종류가 아니다.

| 등급 | 뜻 | 스키마 |
|---|---|---|
| **편집** | 그냥 저장 | 평범 |
| **관문** | 저장 전에 "무엇이 깨지는가"를 보이고 키 이름을 타이핑해야 통과 | `danger` 표시 |
| **읽기** | 값만 보이고 저장 거부 | `readOnly: true` (`conf_schema.validate` 가 막는다) |

### 2.3 내리는 키

| 새 conf 키 | 지금 값 | 지금 자리 | group | apply | 등급 | 근거 |
|---|---|---|---|---|---|---|
| `cseBase` | `Mobius` | `mobius.js` `usecsebase` | CSE 신원 | restart | **읽기** | 모든 `ri` 가 이걸로 시작 |
| `cseId` | `/Mobius2` | `mobius.js` `usecseid` | CSE 신원 | restart | **관문** | MQTT 알림 토픽(`sgn_man.js`)·`acpi` 절대표기 접기가 끊긴다 |
| `spId` | `//keti.re.kr` | **`app.js` `usespid`** | CSE 신원 | restart | **관문** | 절대 표기 접기가 안 되면 대상 해석 실패 |
| `releaseVersion` | `2a` | `mobius.js` `uservi` | CSE 신원 | runtime | 편집 | `valid` 를 `cb.js` 의 `srv=['1','2','2a']` 로 건다 |
| `mqttBroker` | `localhost` | `mobius.js` `use_mqtt_broker` | 네트워크 | restart | 편집 | 남은 소비처는 알림 발행(`sgn_man.js`)뿐 |
| `mqttPort` | `1883` | `mobius.js` `use_mqtt_port` | 네트워크 | restart | 편집 | `useSecure='enable'` 이면 8883 으로 덮인다 |
| `useSecure` | `disable` | `mobius.js` `use_secure` | 네트워크 | restart | **관문** | pem 3개가 없으면 `require` 시점에 throw |
| `allowedAeIds` | `[]` | `mobius.js` `allowed_ae_ids` | 접근 제한 | runtime | **관문** | 비면 전원 허용, 하나라도 넣으면 목록 밖 전부 `403-1` |
| `allowedAppIds` | `[]` | `mobius.js` `allowed_app_ids` | 접근 제한 | runtime | **관문** | AE 생성 시 `api` 화이트리스트 |
| `csebaseport` | `7579` | 이미 conf | 네트워크 | restart | **관문** | 등록된 AE 의 `poa` 가 어긋난다 |
| `sgnManPort` | `7599` | 이미 conf | 네트워크 | restart | 편집 | `exposed: true` 로 연다 |
| 콘솔 7키 | | 스키마 밖 | 콘솔 | restart | 편집 | `adminPassword`·`adminOrigin` 은 `secret` |

**`hitManPort` 는 삭제한다** — `global.use_hit_man_port` 를 세우지만 읽는 코드가 0건인 죽은 키다.
`pxyWsPort`·`pxyMqttPort` 는 `4a47c48` 이 프록시와 함께 이미 지웠다.

> **키를 지울 때는 `conf_schema.js` 와 `mobius.js` 를 원자적으로 움직인다.**
> `test/conf-schema.test.js` 가 양방향으로 강제하므로 한쪽만 지우면 실패한다.

`spId` 는 `app.js` 에서 `mobius.js` 로 옮긴다. 이유는 §2.4.

### 2.4 `conf_schema` 규약이 요구하는 것

1. **`mobius.js` 가 `conf.<키>` 를 실행 코드로 읽어야 한다.** 테스트의 키 스캐너가
   `mobius.js` 만 훑고 주석을 걷어낸다. `app.js` 에서만 읽으면 "표에 있는데 아무도 안 읽는
   키"로 걸린다 — `spId` 를 옮기는 이유다
2. **기본값을 세 가지 작성 모양 중 하나로** 쓴다. `? conf.K : 리터럴;` / `conf.K || 리터럴;` /
   `함수(conf.K, 리터럴)`. 다른 모양이면 `dflt` 대조가 **조용히 건너뛰어진다**
3. **새 group 3개**(`CSE 신원`·`접근 제한`·`콘솔`)를 `test/conf-schema.test.js` 의 `KNOWN` 에 넣는다
4. `apply: 'reload'` 인 키는 `reloadWith` 도 반드시 준다. 이번 새 키에는 해당 없음

덤으로 하나 고친다 — `mobius.js` 의 `use_mqtt_port = '8883'` 대입은 `global.` 접두가 없는
**암묵 전역 대입**이다(파일에 `'use strict'` 가 없어서 동작한다). 명시적으로 바꾼다.

---

## 3. 지금 도는 값 / 파일 값 / 재기동 필요

### 3.1 `apply` 는 파일을 고치는 것과 다른 얘기다

| `apply` | 뜻 |
|---|---|
| `runtime` | 요청마다 `global.*` 을 읽는다 — **값만 바꾸면** 즉시 먹는다 |
| `reload` | 모듈이 캐시한다. 재설정 함수를 불러야 한다 |
| `restart` | 기동 시 한 번 읽는다 |

여기서 "값"은 **`global.*`** 이지 `conf.json` 이 아니다. `mobius.js` 는 기동 때 한 번 파일을
읽어 전역에 심고 그 뒤로는 파일을 다시 안 본다. **CLI 도 웹도 파일만 고친다.**
그래서 `apply: 'runtime'` 인 키도 **재기동해야 반영된다.**

유일한 예외가 오히려 더 나쁘다 — `cluster.fork()` 가 `mobius.js` 를 다시 실행하므로
**죽었다 되살아난 워커만** 새 값을 읽는다. 재기동 없이 파일만 고치면 워커마다 값이 갈린다.

### 3.2 부팅 기록 — `log/mobius-boot.jsonl`

`mobius.js` 가 전역을 다 세운 뒤, `require('./app')` 직전에 한 줄 남긴다.

```jsonl
{"role":"master","pid":8812,"at":"2026-09-04T01:20:03.114Z","pm2":true,"conf":{"db":"mysql","cseBase":"Mobius",...}}
{"role":"worker","pid":8840,"at":"2026-09-04T01:20:04.902Z","pm2":true,"conf":{...}}
```

- **`secret: true` 인 키는 뺀다.** 대상 목록을 `conf_schema.all()` 에서 secret 을 걸러 만들므로
  **새 비밀 키가 생겨도 자동으로 빠진다.** 손으로 유지하는 목록을 만들지 않는다
- 값은 `conf` 원본이 아니라 **실제로 전역에 심긴 값**이다. 파일에 없어 기본값이 쓰였거나
  `argv[2]` 가 `conf.db` 를 이긴 경우까지 사실대로 남는다
- **마스터가 기동 때 파일을 비우고, 이후 전원이 append.** 파일은 항상 "지금 이 판"만 담는다
- **줄 수에 상한을 둔다(예: 워커 수 × 3).** 상한이 없으면 재포크 루프(§5.2)에서 워커가
  초당 24줄씩 append 해 **하루 수백 MB** 로 자란다. 상한에 닿으면 `{"role":"capped"}` 한 줄만
  남긴다 — **그 줄이 곧 재포크 루프 탐지 신호**가 된다
- **`pm2` 필드** — `process.env.pm_id` 유무. pm2 밖에서 떴으면 CLI 가 "정지·재기동을 할 수
  없다"를 말할 수 있다

**파일을 고른 이유** — pm2 여부와 무관하기 때문이다. stdout 은 pm2 가 가져가지만 이 파일은
Mobius 자신이 쓴다. 그래서 **누가 어떻게 띄웠든** 설정 대조가 된다.

### 3.3 판정

키마다 세 갈래로 답한다. 근거는 **mtime 이 아니라 값 대조**다 — 어느 키가 다른지까지
말할 수 있어야 한다.

| 상태 | 조건 |
|---|---|
| **적용됨** | 파일 값 = 마스터 기록 값 |
| **재기동 대기** | 파일 값 ≠ 마스터 기록 값 |
| **모름** | 기록 파일이 없거나 Mobius 가 안 떠 있음 → 값 대조를 **아예 하지 않는다** |

여기에 경고 둘을 단다.

> **워커 불일치** — 기록의 워커 줄들이 서로 다른 값을 갖고 있다. 재기동 없이 파일이 바뀐 뒤
> 일부 워커만 되살아난 상태다.
>
> **좀비 의심** — 기록이 `capped` 이거나 워커 줄이 계속 늘어난다. 재포크 루프다(§5.2).

### 3.4 오류 처리

- **기록 파일이 없다** → "모름". CLI 가 만들지 않는다
- **기록이 깨졌다** → 깨진 줄만 버리고 나머지로 판정. 전부 깨졌으면 "모름"
- **`conf.json` 이 깨졌다** → `mobius.js` 와 같은 원칙. **덮어쓰지 않고** "파일이 깨져 있다 —
  고치기 전에는 저장할 수 없다"를 말한다
- **기록에는 있는데 스키마에 없는 키** → 옛 판으로 뜬 Mobius 다. 대조에서 빼고
  "기록이 오래됐다"만 표시

---

## 4. CLI — `tools/mobius-ctl.js`

### 4.1 왜 모듈 하나인가

실행 지식이 콘솔 안에 있으면 터미널 사용자는 같은 일을 다른 방법으로 해야 하고,
두 길이 어긋날 여지가 계속 남는다. 그래서 처음부터 하나로 만든다.

```
   npm start / npm run conf / npm run status …
                  ▼
        tools/mobius-ctl.js        ← 실행·설정 지식은 여기 하나뿐
         · 앱 이름 · 스크립트 경로 · exec_mode 'fork' · instances 1
         · 기동 전 포트·pm2 상태 확인
         · conf 조회·변경 (tools/conf_store.js 경유)
                  ▼
              pm2 데몬  →  node mobius.js
```

**pm2 는 `package.json` 의존성으로, 배포와 같은 `6.0.14` 로 핀한다.** 전역 설치가 필요 없으니
"pm2 가 없으면 어떡하나"라는 문제 자체가 없어진다. 셸도 PATH 탐색도 명령 문자열 조립도 없다.

배포 데몬이 6.0.14 이므로 7.x 모듈로 붙으면 버전 불일치가 난다. 나중에 배포 pm2 를 올리면
핀도 같이 올려야 하므로 그 사실을 `admin/README.md` 에 적는다.

### 4.2 명령

```
mobius-ctl conf                    전체 목록 — 카테고리별 · 현재값 · 3상태
mobius-ctl conf <키>               단건 상세 — 도움말 · 유효값 · 기본값 · apply · 등급
mobius-ctl conf set <키> <값>      변경
mobius-ctl conf unset <키>         기본값으로 되돌린다
mobius-ctl start | stop | restart  pm2 경유
mobius-ctl status                  pm2 · 포트 · 부팅 기록 · 재기동 대기 건수
mobius-ctl logs [access|out|err]   로그 경로를 알려 주고 tail 한다
```

npm 스크립트:

```json
"start"         : "node tools/mobius-ctl.js start",     ← 감독 받는 경로가 기본
"start:direct"  : "node mobius.js",                     ← 감독 없는 직접 실행
"mobius:stop"   : "node tools/mobius-ctl.js stop",
"mobius:restart": "node tools/mobius-ctl.js restart",
"status"        : "node tools/mobius-ctl.js status",
"conf"          : "node tools/mobius-ctl.js conf",
"logs"          : "node tools/mobius-ctl.js logs"
```

`npm start` 를 감독 경로로 바꾼다. 기조가 "웬만하면 감독 받는 쪽"이므로 기본값이 그쪽이어야
한다. 직접 실행은 없애지 않고 `start:direct` 로 남긴다.
`run_mobius.bat`·`run_sqlite.bat`·`run_mysql.bat` 셋도 같이 고친다.

### 4.3 conf 조회

```
$ npm run conf

CSE 신원
  cseBase              Mobius              적용됨      [읽기 전용]
  cseId                /Mobius2            적용됨      ⚠ 관문
  spId                 //keti.re.kr        적용됨      ⚠ 관문
  releaseVersion       2a                  적용됨

네트워크
  csebaseport          7579                적용됨      ⚠ 관문
  mqttBroker           localhost           적용됨
  mqttPort             1883                적용됨
  useSecure            disable             적용됨      ⚠ 관문
  sgnManPort           7599                적용됨

저장소
  db                   mysql               적용됨
  dbConnectionLimit    25                  ● 재기동 대기 (파일 25 / 도는 값 100)
  ...

비밀 — 값을 띄우지 않는다
  dbpass               설정됨
  superUser            없음 (기본값 사용)

● 재기동 대기 1건.  반영하려면:  npm run mobius:restart
```

3상태는 §3 의 부팅 기록과 대조해 나온다. Mobius 가 안 떠 있으면 그 열이 `모름` 이 되고
**대조를 아예 하지 않는다.**

### 4.4 conf 변경

```
$ npm run conf -- set maxBodyBytes 20971520
maxBodyBytes  10485760 → 20971520  저장됨
⚠ 재기동해야 반영된다.  지금 재기동할까요? [y/N]

$ npm run conf -- set cseId /Mobius3
⚠ cseId 를 바꾸면 이것들이 끊긴다:
    · MQTT 알림 토픽이 바뀌어 기존 AE 의 구독이 안 온다
    · acpi·mid·nu 에 저장된 절대 표기를 못 접는다
  계속하려면 키 이름을 그대로 입력:  cseId
> _

$ npm run conf -- set cseBase Mobius2
거부: cseBase 는 읽기 전용이다.
      저장된 모든 ri 가 /Mobius/… 로 시작하므로 바꾸면 트리 전체가 고아가 된다.
```

- 검증은 **`conf_schema.validate()` 단일 관문**을 지난다. CLI 가 자기 규칙을 따로 갖지 않는다
- §2.2 의 3등급이 그대로 적용된다
- 쓰기는 `tools/conf_store.js` 의 **원자적 쓰기**를 쓴다. 모르는 키는 보존한다

**비밀 키(`dbpass`·`superUser`·`adminPassword`)는 조회만 하고 변경은 지원하지 않는다.**

- **명령줄 인자로 주면 셸 히스토리에 남는다**
- `conf_schema.validate()` 가 비밀 키를 거부하도록 시험이 강제한다. 뚫으려면 규약을 건드려야 한다
- 비밀번호를 바꾸는 일은 드물다

조회에서 "설정됨/없음"만 보이고, 바꾸려면 `conf.json` 을 직접 고치라고 안내한다.

### 4.5 실행 · 상태 · 로그

```
$ npm run status
Mobius     pm2 online · pid 247395 · 9시간 4분 · 재시작 13회 · 워커 24
포트 7579  열림
설정       재기동 대기 1건  (dbConnectionLimit)
로그       ~/.pm2/logs/Mobius-out.log · Mobius-error.log
           log/access-20260904.log  (56MB)
```

- **셋을 교차해서 본다** — `pm2.list()` · 부팅 기록 · 포트 `connect`. pm2 가 `online` 이라 해도
  포트를 열었다는 뜻이 아니고, **"online + 포트 열림"도 정상을 뜻하지 않는다**(§5.2 좀비)
- 로그 경로는 **`pm2.list()` 가 준 것**(`pm_out_log_path`·`pm_err_log_path`)을 쓴다. 추측하지 않는다
- 배포에 `pm2-logrotate` 가 이미 돌고 있어(10M/10개/매일 0시) 회전본이 생긴다. `logs` 는
  현재 파일과 회전본을 함께 보여 준다
- 액세스 로그 요약을 낼 때 **마지막 필드의 `-` 를 0으로 세지 않는다.** 중단된 요청이 그 필드가
  `-` 인데, 숫자로 강제 변환하면 **가장 나쁜 요청들이 통째로 빠진다**. 별도 카운터로 센다

### 4.6 안전 — 이름 하나만 만진다

배포 데몬에 앱이 17개 있고 Mobius 는 그중 하나다(§10.4).

```js
// conf.adminPm2Name 하나만 다룬다. 다른 이름은 이 모듈을 통과하지 못한다.
function guard(name) {
    if (name !== TARGET) { throw new Error('이 모듈은 ' + TARGET + ' 만 다룬다'); }
}
```

- `list()` 결과는 **그 이름으로 걸러서** 쓴다
- `start`/`stop`/`restart` 는 상수 `TARGET` 만 인자로 받는다. **명령줄에서 이름을 받지 않는다**
- **`delete` 는 아예 구현하지 않는다.** 앱 등록 해제는 이 모듈이 할 일이 아니다

### 4.7 오류 처리

- **pm2 데몬이 없다** → API 가 데몬을 띄운다. 그 사실을 알린다
- **버전 불일치** → `pm2.connect` 가 경고를 낸다. 그대로 노출하고 진행하지 않는다
- **이미 돌고 있다** → `start` 는 띄우지 않고 그 사실을 말한다. `pm2 start` 는 이 경우
  **재시작**해 버리므로(§10.7) 모듈이 막아야 한다
- **pm2 밖에서 돌고 있다** → 부팅 기록의 `pm2:false` 로 알아채고, 정지·재기동이 안 되는
  이유와 `npm start` 로 다시 띄우는 방법을 안내한다
- **`online` 인데 포트가 안 열림** → "떠 있지만 요청을 못 받는다"로 구분하고 `error` 로그
  마지막 줄을 함께 보여 준다

---

## 5. 코어 전제 조건

CLI 밖의 파일이지만 없으면 이 작업이 성립하지 않는다.

### 5.1 `windowsHide` 한 줄

```js
cluster.setupPrimary({ windowsHide: true });   // fork 루프 앞. Linux 에서는 무시된다
```

없으면 Windows 에서 **워커 수만큼 콘솔 창이 뜬다.** CLI 로 띄워도 pm2 를 지나므로 똑같다.
실측 근거는 §10.1.

### 5.2 포트 충돌 처리 — 지금은 좀비가 된다

이미 포트를 누가 쥔 상태에서 Mobius 를 또 띄우면(§10.7):

```
워커    EADDRINUSE → listen 에 .on('error') 가 없어 uncaught 로 던진다
        backstop 이 잡아 워커만 종료 (마스터는 살린다)
마스터  cluster.on('exit') → 재포크 → 또 EADDRINUSE → 무한 반복
        실측 12초에 워커 사망 20회 이상
pm2     마스터가 안 죽으니 status online · restart_time 0 — 정상으로 본다
```

`app.js` 의 `fail_start` 는 이걸 안 잡는다 — 호출부 6곳이 전부 **DB 연결 실패 경로**다.
cluster 가 아닌 단일 프로세스였다면 pm2 가 `errored` 로 포기했을 것이다(실측). Mobius 는
마스터가 살아 있어서 그 안전장치가 작동하지 않는다.

현실적인 경로는 이렇다 — **어딘가에서 띄워 두고 잊는다. 다른 창에서 또 띄운다.**

방어를 셋 둔다.

**(가) `mobius-ctl` 이 기동 전에 확인한다.** 포트와 pm2 상태를 먼저 보고 이미 돌고 있으면
띄우지 않는다.

**(나) 코어 자체 방어 — 마지막 방어선.** `npm run start:direct` 는 모듈을 안 지나므로 필요하다.

- 기동 전 포트 확인 → 열려 있으면 뜨지 않고 `[기동 거부]` 로 안내
- `listen` 에 `.on('error')` → `EADDRINUSE` 면 워커가 **예약 종료 코드**로 나가고,
  마스터는 `cluster.on('exit')` 에서 그 코드를 보면 **재포크하지 않고 자기도 종료**한다.
  워커만 죽이면 3초 느린 루프가 될 뿐이다

**(다) pm2 밖 기동을 기록한다.** `process.env.pm_id` 부재를 부팅 기록에 남기고 로그에 경고한다.

> **직접 실행을 막지 않는다.** 좀비의 원인은 "터미널로 띄웠다"가 아니라 "포트 충돌이
> 처리되지 않았다"이다. 막아도 pm2 안에서 중복이 생기면 똑같고, 대신
> `npm run start:direct`·`node --inspect`·비상 시 탈출구를 잃는다.

---

## 6. 웹에서 걷어낼 것

설정과 실행이 CLI 로 갔으므로 웹에서는 없앤다. **화면은 새로 만들지 않는다.**

| 무엇 | 어디 |
|---|---|
| `conf` 조회·저장 라우트 | `admin/server.js` |
| 프로세스 제어 라우트 3개 | `admin/server.js` |
| 설정 화면 | `admin/web/src/views/ConfView.vue` 삭제 |
| 서버 제어 컴포넌트 | `admin/web/src/components/ServerControl.vue` 삭제 |
| detached spawn | `admin/process_ctl.js` 삭제 (딸린 시험 10건 포함) |
| conf 파일 계층 | `admin/conf_store.js` → `tools/conf_store.js` 로 **이동** |

남는 웹 화면은 만료·고아·ACP 4종이다.

`adminOrigin` 을 `superUser` 에서 떼는 것은 **여기서 하지 않는다** — 웹이 할 수 있는 일이
줄어들어 만료·고아 삭제가 막힐 수 있다. §11 로 넘긴다.

---

## 7. 시험 계약

`test/conf-schema.test.js` 가 이미 19건으로 conf 키를 양방향 강제하므로 **새 키 16개**(소스에서
내리는 9개 + 콘솔 7개)**는 자동으로 거기 걸린다.** 새로 쓰는 것은 그 표가 못 잡는 것들이다.

### 7.1 코어

**① 빈 `conf.json` 으로도 지금 동작이 그대로다** ← 배포 안전의 핵심
`dflt` 대조는 "리터럴이 같은가"만 본다. 보장해야 하는 것은 **"배포 `conf.json`(5키)에
아무것도 안 넣어도 동작이 안 바뀐다"** 이다. 빈 conf 로 `mobius.js` 를 로드해 전역을 확인한다.

```
usecsebase 'Mobius' · usecseid '/Mobius2' · usespid '//keti.re.kr'
use_mqtt_broker 'localhost' · use_secure 'disable' · use_mqtt_port '1883'
uservi '2a' · allowed_ae_ids [] · allowed_app_ids []
```

**② `spId` 를 `mobius.js` 가 세우고, 콘솔은 하드코딩하지 않는다**
`app.js` 의 옛 자리가 안 남아야 하고, `admin/server.js` 가 같은 값을 두 번째로 박아 둔 것도
없어져야 한다.

**③ `useSecure='enable'` 이면 `mqttPort` 가 8883 이 된다**

**④ 부팅 기록** — 마스터가 비우고 워커가 append / **`secret` 키가 안 들어간다**(새 비밀 키를
하나 추가해도 자동으로 빠지는지) / 값이 `conf` 원본이 아니라 실제 전역 값 / `pm2` 필드

**⑤ 부팅 기록에 상한이 걸린다** — 상한을 넘겨 append 하려 하면 `capped` 한 줄만 남고
파일이 더 안 자라는지

**⑥ `cluster.setupPrimary({ windowsHide: true })` 가 fork 앞에 있다**
Linux CI 에서는 증상이 안 나오므로 소스 검사로 잡는다. 다만 이 저장소에는 전례가 있다 —
`test/admin-process-ctl.test.js` 가 소스 문자열만 봐서 **머리말 주석만으로 통과**했다.
그래서 **주석을 걷어낸 뒤** 검사한다.

**⑦ 포트 충돌이 좀비를 만들지 않는다** — 워커가 `EADDRINUSE` 로 죽을 때 마스터가
**재포크하지 않고 종료**하는지. 실제로 포트를 잡아 두고 띄워 확인한다. 지금은 무한 재포크가
되므로(§10.7) 이 시험은 **처음에 반드시 실패해야 한다.**

### 7.2 CLI

**⑧ 이름 하나만 만진다** ← 배포에 남의 앱 16개가 있어 제일 중요
`start`/`stop`/`restart` 가 `TARGET` 외 이름으로 호출되지 않는다 / `list()` 가 걸러진다 /
`delete` 가 export 되지 않는다

**⑨ 이미 돌고 있으면 기동하지 않는다** — `online` 상태에서 `start` 를 부르면 띄우지 않고
그 사실을 돌려준다. pm2 는 이 경우 **재시작**해 버리므로(§10.7) 모듈이 막아야 한다

**⑩ `conf` 조회가 3상태를 낸다** — 부팅 기록이 없으면 대조를 아예 안 하고 `모름` /
워커 줄이 서로 다르면 불일치 / `capped` 면 좀비 의심

**⑪ `conf set` 이 `validate()` 를 지난다** — CLI 가 자기 검증 규칙을 따로 갖지 않는지.
모르는 키·읽기 전용·유효값 밖·비밀 키가 모두 거부되는지

**⑫ 위험 등급이 CLI 에서 지켜진다** — 읽기 전용은 거부, 관문 키는 확인 입력 없이는 저장되지
않음. **확인 입력을 흉내 낸 대역이 실물보다 관대하면 안 된다**

### 7.3 웹

**⑬ conf·프로세스 제어가 웹에서 사라졌다** — `admin/server.js` 에 그 라우트가 없고,
`admin/` 어디에도 pm2 를 부르거나 `conf.json` 에 쓰는 코드가 없는지

### 7.4 시험 대역 원칙

CLAUDE.md 의 규칙을 따른다 — **가짜가 실물보다 관대하면 시험이 거짓말을 한다.**
이 저장소는 그걸로 두 번 당했다.

- **pm2 가짜는 "무엇을 불렀나"를 기록해야 한다.** 성공만 돌려주면 ⑧이 아무것도 안 지킨다
- **부팅 기록 시험은 실제 파일을 쓴다**(임시 디렉터리). 메모리 목으로는 마스터 truncate ↔
  워커 append 경합을 못 본다
- **로그 파서는 실제 형식의 줄로** 시험한다

`npm test` 는 `node --test test/*.test.js` 라 `test/admin-*.test.js` 가 **이미 관문에 걸린다.**
없는 것은 CI 다.

---

## 8. 작업 순서

배포 반영을 **두 번**으로 나눈다.

| | 단계 | 파일 | 시험 |
|---|---|---|---|
| 1 | conf 키 내리기 | `conf_schema.js` · `mobius.js` · `app.js`(spId 이전) | 기존 19 + ①②③ |
| 2 | 부팅 기록 (상한·`pm2` 필드 포함) | `mobius.js` · `mobius/boot_record.js`(신설) | ④⑤ |
| 3 | `windowsHide` 한 줄 | `app.js` | ⑥ |
| 4 | 포트 충돌 처리 | `app.js` · `mobius.js` | ⑦ |
| — | **배포 1차** — 코어 반영 + Mobius 재기동 | | 동작 불변 확인 |
| 5 | `conf_store.js` 이동 | `admin/` → `tools/` (시험 20건 동반) | 기존 20 |
| 6 | CLI — 실행·상태·로그 | `tools/mobius-ctl.js`(신설) · `package.json` · `run_*.bat` | ⑧⑨ |
| 7 | CLI — conf 조회·변경 | `tools/mobius-ctl.js` | ⑩⑪⑫ |
| 8 | 웹에서 걷어내기 | `admin/server.js` · `ConfView.vue`·`ServerControl.vue`·`process_ctl.js` 삭제 | ⑬ |
| — | **배포 2차** — CLI 반영 + 웹 재기동 | | |

**코어를 먼저 하는 이유**는 CLI 가 코어가 준 것(스키마·부팅 기록)에 의존하고 반대는 아니기
때문이다. 그리고 1~4가 배포에 무해하므로 먼저 올려 두면 CLI 작업 중에도 배포가 안전하다.
배포에 `mobius-boot.jsonl` 이 생겨야 3상태가 "모름"을 벗어난다.

**4단계(포트 충돌)는 CLI 와 무관한 코어 결함 수정이다.** 지금은 운영 중에 중복 실행이 나도
아무도 모른다.

**8단계는 한 커밋에 한다.** 라우트·화면·`process_ctl.js` 를 같이 지운다. 반쪽만 지운 상태를
만들지 않는다.

### 8.1 각 단계의 "끝났다" 기준

- **1~4** — `npm test` 전건 통과 + 빈 conf 로 띄워 전역이 지금과 같음 + 포트를 잡아 두고
  띄웠을 때 **좀비가 아니라 깨끗한 실패**가 되는 것을 실제로 확인
- **배포 1차** — 재기동 후 `pm2 jlist` 의 `restart_time` 이 안 늘고, `mobius-boot.jsonl` 이
  생기고, 응답이 전과 같음(`tools/response-golden/headers.js`)
- **5~7** — `npm test` 전건 통과. `npm start`·`npm run status`·`npm run conf` 가 동작하고,
  이미 돌고 있을 때 `npm start` 가 띄우지 않고 그 사실을 말함
- **8** — 웹이 여전히 뜨고 남은 화면이 동작. `admin/` 에 pm2·conf 쓰기 코드가 0건
- **배포 2차** — SSH 로 들어가 `npm run conf` → `set` → `npm run mobius:restart` →
  `적용됨` 으로 바뀌는 것까지 한 번 걸어 봄

---

## 9. 배포 반영

### 9.1 원칙 — "동작이 안 바뀌는 변경"만 먼저

새 conf 키의 기본값을 지금 하드코딩 값과 같게 두면 배포 `conf.json`(5키)에 아무것도 안 넣어도
동작이 그대로다. `windowsHide` 한 줄도 Linux 에서는 무시된다.

### 9.2 순서

1. **pm2 버전을 6.0.14 로 핀한다** (`package.json`, 캐럿 없이)
2. **코어를 먼저 배포하고 Mobius 를 재기동한다.** 워커 24개 재기동이라 순단이 있다.
   `mobius-boot.jsonl` 은 **새 코어로 재기동해야 생긴다**
3. **CLI 를 배포한다.** `npm install` 로 pm2 의존성이 들어간다
4. **웹 정리분을 배포하고 콘솔을 재기동한다.** 배포 `conf.json` 에 `adminPassword` 가 없어
   지금은 콘솔이 안 뜬다 — 넣으려면 **파일을 먼저 백업한다**(재현이 안 되는 파일이다)

### 9.3 조심할 것

**배포 데몬에 앱이 17개고 16개가 같은 사용자의 다른 서비스다.** §4.6 의 "이름 하나만 만진다"는
로컬에서는 형식적이지만 배포에서는 실제 안전장치다.

**다른 세션과 겹친다.** 이 문서를 쓰는 동안에도 `lite` 가 여러 번 움직였고 프로토콜 프록시
3종이 삭제됐다. `mobius.js` 와 `app.js` 는 다른 사람도 만지고 있을 수 있으므로
**반영 전에 조율한다.**

### 9.4 pm2 7 업그레이드는 별도 작업으로

Node 22 라 요건은 만족하고 우리가 쓰는 API 표면에 깨지는 변화도 없다. 다만 7.0 의 변경 중
하나가 **TreeKill 재작성**이라 워커 24개의 종료 동작이 바뀐다. 배포가 지금 안정화 중이므로
겹치면 원인 분리가 어렵다. 확인할 것: `dump.pm2` 백업 / `pm2-logrotate` 재설치 필요 여부 /
`pm2 stop Mobius` 후 워커 24개가 다 정리되는지.

---

## 10. 실측 근거

전부 2026-09-04 에 직접 실행해 확인한 것이다.

### 10.1 창은 `cluster.fork()` 가 만든다

관리 UI 에서 Mobius 를 띄우자 콘솔 창이 워커 수만큼 떴다(이 장비 16코어 → 16개).
워커 2개짜리 흉내 스크립트로 변형을 갈라 측정했다(보이는 최상위 창을 열거해 소유 프로세스 확인).

| 변형 | 새로 뜬 창 |
|---|---|
| 아무 것도 안 함 (지금 코드) | **2개** |
| `spawn` 에만 `windowsHide` | **2개** — 무효 |
| `cluster` 에만 `windowsHide` | **0개** |
| 둘 다 | **0개** |
| pm2 + `HIDE_WORKERS=0` | **5개** |
| pm2 + `HIDE_WORKERS=1` | **0개** |

`spawn` 쪽 옵션은 효과가 없고 **`cluster` 쪽 한 줄이 전부**다. 실행 방식 선택과 무관한 문제다.

### 10.2 `pm2 start <이름>` 은 이름을 경로로 먼저 해석한다

등록되지 않은 이름으로 불렀더니 **실패하지 않고** 존재하지 않는 경로를 스크립트로 잡은 채 떴다.

```
$ pm2 start Mobius
[PM2] Starting C:\...\Mobius\Mobius in fork_mode (1 instance)
[PM2] Done.          ← 그런 파일은 없다
```

`mobius-ctl` 이 이름·경로·모드를 직접 갖는 이유다.

### 10.3 `process_ctl` 의 소유권 판정은 터미널 기동을 못 다룬다

`ours` 의 근거가 **콘솔이 직접 적은 `.mobius-console.pid`** 하나뿐이라, 터미널로 띄운 Mobius 는
정지·재기동이 영원히 거부된다. **pm2 로 가면 통째로 사라진다** — 누가 띄웠든 pm2 가 주인이다.

### 10.4 배포 서버 현황

```
OS/CPU     Ubuntu · 커널 6.8 · 24 코어
node       v22.22.2
pm2        6.0.14
저장소     /home/keti/Mobius · lite
conf.json  5키 — csebaseport, dbpass, db, dbConnectionLimit, dbQueueLimit
Mobius     pm2 name=Mobius · fork_mode · online · 재시작 13회
pm2 앱     17개 (Mobius 외 16개는 같은 사용자의 다른 서비스)
액세스로그 하루 53~71MB
pm2 로그   Mobius-error 하루 3~5MB · pm2-logrotate 설치됨 (10M/10개/매일 0시)
```

### 10.5 pm2 프로그래매틱 API 가 주는 필드

`pid` · `status` · `restart_time` · `unstable_restarts` · `pm_uptime` · `exec_mode` ·
`instances` · `pm_exec_path` · `pm_cwd` · `pm_out_log_path` · `pm_err_log_path` ·
`memory` · `cpu`

로그 경로까지 API 가 직접 주므로 경로를 추측할 필요가 없다.

### 10.6 콘솔은 코드 수정 없이 뜬다

막는 것은 빌드가 아니라 `conf.json` 이다. `adminPassword` 가 없으면 프로세스가 아예
`exit(1)` 한다. 빌드 부재는 2차 장벽이고, 서버는 뜨고 `/` 만 503 을 준다.

### 10.7 중복 실행은 좀비가 되고, pm2 는 정상으로 본다

`app.js` 의 기동 구조(cluster 마스터 + 워커, `listen` 에 `.on('error')` 없음, 워커
`uncaughtException` 시 워커만 종료)를 그대로 본뜬 껍데기로 측정했다.

**포트를 먼저 잡아 두고 두 번째 인스턴스를 띄운 결과:**

```
[B][worker] uncaught: EADDRINUSE — 워커만 종료한다
[B][master] 워커 죽음 (누적 1, 0초)
[B][master] 워커 죽음 (누적 10, 4초)
...            12초에 20회 이상. 마스터는 계속 살아 있다
```

**같은 상황을 pm2 로 띄웠을 때 pm2 가 보고하는 것:**

```
5초 후   status online · restarts 0 · pid 고정
12초 후  status online · restarts 0 · pid 고정
```

cluster 가 아닌 단일 프로세스였다면 pm2 가 `errored` 로 포기했을 것이다(실측
`restarts 30` → `errored`).

**그리고 `pm2 start <이름>` 은 이미 `online` 인 앱에 불러도 거부하지 않는다:**

```
[PM2] Applying action restartProcessId on app [mobiusfake](ids: [ 0 ])
```

거부가 아니라 **재시작**이다. 그래서 `mobius-ctl` 이 상태를 먼저 봐야 한다(§5.2 가).

### 10.8 웹을 외부에 열려면 지금은 부족하다

```
adminHost      기본 127.0.0.1 — conf 로 바꿀 수 있다
루프백 아니면   경고 한 줄만 찍고 그대로 뜬다 (admin/server.js)
세션 쿠키       HttpOnly · SameSite=Strict · 8시간 — Secure 없음
로그인 시도 제한  0건
비밀번호 비교    해시 + timingSafeEqual — 이건 제대로 돼 있다
```

`adminOrigin` 을 안 주면 콘솔이 `superUser` 로 CSE 에 접근하고 `security.check` 가 그 값을
무조건 통과시킨다. **설정과 실행을 CLI 로 옮기면 위험의 큰 축 둘이 웹에서 사라지지만,
이 마스터 키 문제는 남는다.** §11 참조.

---

## 11. 정하지 않은 것

- **웹을 외부에 어떻게 열 것인가** — 리버스 프록시(TLS + 추가 인증) 뒤에 두는 안이 유력하다.
  콘솔 코드는 루프백 바인드 그대로 두면 되므로 이 스펙을 바꾸지 않는다. 다만
  **로그인 시도 제한과 `Secure` 쿠키는 그때 필수**다
- **`adminOrigin` 을 `superUser` 에서 뗄 것인가** — 떼면 웹이 ACP 로 제한되지만 만료·고아
  삭제가 막힐 수 있다. 재정의 문서의 **결정 ②**(관리자 1명 전제)와 함께 정한다
- **루프백이 아닌 바인드를 거부할 것인가** — 지금은 경고만 한다.
  `adminAllowRemote: true` 를 명시해야 열리도록 바꾸는 안이 있다
- **콘솔을 배포에서 상시 띄울 것인가** — `pm2 save` 로 부팅 시 복구 목록에 넣을지
- **`npm run status` 의 출력 형식** — 사람이 읽는 표인지 `--json` 도 줄지
- **배포 소스의 `usecsebase`·`usecseid`·`usespid` 실제 값**이 이 문서가 적은 기본값과 같은지.
  배포 HEAD 가 달라 다를 수 있으므로 **1단계 착수 전에 확인한다**
