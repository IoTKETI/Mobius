# Mobius 설정 — 코어 정리와 conf CLI

- 작성일: 2026-09-04
- 대상 브랜치: `lite`
- 선행 문서: [관리 콘솔 목표 재정의](2026-09-01-admin-console-purpose.md), [관리 콘솔 설계](2026-08-28-admin-console-design.md)

**개정 이력**

| 판 | 무엇이었나 | 왜 바뀌었나 |
|---|---|---|
| 1 | 설정 탭 · 실행 탭을 **웹**으로 | 그 둘은 웹이어야 할 이유가 없었다 — §1.3 |
| 2 | 설정·실행을 **CLI** 로. `tools/mobius-ctl.js` 가 pm2 API 로 제어 | 웹이 실행 제어를 안 하게 되면서 **API 를 쓸 소비자가 사라졌다** |
| 3 | **pm2 를 배포의 것으로 밀어냈다.** CLI 는 `conf` 와 `status` 만 | 로컬에서 pm2 가 주는 것이 없다 — §1.4 |
| 4 | `conf` 조회·변경의 구조를 채웠다 | |
| **5** | **전수 검토 반영.** 코드와 어긋난 사실 5건, 구현이 막히는 미정 12건을 메웠다 | 아래 "5판에서 고친 것" |

**5판에서 고친 것** — 검토가 찾은 것 중 무거운 것들이다.

| | 초판~4판이 적은 것 | 실제 |
|---|---|---|
| conf 키 수 | 전체 19 · 노출 14 | **백엔드마다 다르다** — mysql 20/15, sqlite 22/18 |
| `sgnManPort` | "`exposed: true` 로 연다" | **읽는 코드가 0건인 죽은 키.** `hitManPort` 와 같다 → 지운다 |
| 프로세스 제어 라우트 | 3개 | **4개** (`status` 도 `process_ctl` 을 쓴다) |
| 비밀 키 거부 근거 | `secret` | **`exposed === false`.** `secret` 만 붙이면 CLI 로 써진다 |
| 새 키가 시험에 걸리는가 | "자동으로 걸린다" | **콘솔 6키는 반대로 시험을 실패시킨다** |

> ## 기조
>
> **설정은 CLI 가 맡는다. 웹은 리소스를 다룬다. 실행은 환경이 정한다.**
>
> 앞의 둘은 **권한 경계**다. 설정은 마스터 키를 쥐는 일(`conf` 에 `dbpass`·`superUser` 가
> 있다)이라 서버에 SSH 로 들어온 사람만 해야 한다. 웹은 리소스를 보고 고치는 일이라
> 외부에서 접근해도 ACP 로 통제할 수 있다.
>
> 세 번째는 **책임 경계**다. 로컬은 `node mobius.js`, 배포는 pm2 — 우리 도구가 그 위에
> 한 겹을 더 얹지 않는다.

---

## 0. 요약

**웹 화면을 새로 만들지 않고, 실행 래퍼도 만들지 않는다. 새 의존성이 없다.**

| | 무엇 | 어디 |
|---|---|---|
| 1 | 소스에 박힌 설정 9개를 conf 키로 내린다 (`mobius.js` 8 + `app.js` 1) | `mobius/conf_schema.js` · `mobius.js` · `app.js` |
| 2 | **콘솔 6키를 스키마로 올린다** + 시험의 키 스캐너를 넓힌다 | `conf_schema.js` · `test/conf-schema.test.js` |
| 3 | `csebaseport` 를 연다. 죽은 포트 키 둘(`hitManPort`·`sgnManPort`)을 지운다 | `conf_schema.js` · `mobius.js` |
| 4 | 기동 시 적용된 설정을 파일에 한 줄 남긴다 | `mobius.js` · `mobius/boot_record.js`(신설) · `mobius/conf_load.js`(신설) |
| 5 | **`conf` CLI** — 조회·변경 + `status` | `tools/mobius-conf.js`(신설) · `tools/conf_store.js`(이동) |
| 6 | 코어 결함 둘 — 포트 충돌 처리, `windowsHide` 한 줄 | `app.js` |
| 7 | 웹에서 conf 편집·프로세스 제어를 걷어낸다 | `admin/` |
| 8 | 낡는 문서를 고친다 | `CLAUDE.md` · `README.md` · `admin/README.md` |

---

## 1. 범위와 경계

### 1.1 빼는 것

- **웹 화면 신설** — 설정 탭도 실행 탭도 만들지 않는다. 기존 화면은 그대로 둔다
- **실행 래퍼** — `npm start` 는 `node mobius.js` 그대로다. 정지·재기동은 환경의 일(§1.4)
- **외부 접근 통제** — 로그인 시도 제한 · `Secure` 쿠키 · TLS · 사용자별 계정. 별도 사이클
- **`adminOrigin` 을 `superUser` 에서 떼는 일** — 웹의 만료·고아 삭제가 막힐 수 있다. §11
- **sub 탭 · 리소스 탭**, **기존 만료·고아·ACP 화면 정리** — 별도 사이클
- **콘솔의 MySQL 풀 설정(100/0)** — 실제로 DB 를 치는 화면을 손볼 때 다룬다

### 1.2 왜 설정이 CLI 인가

초판은 설정 탭과 실행 탭을 웹으로 만들려 했다. 다시 보니 그 둘은 웹이어야 할 이유가 없었다.

| | CLI 가 맞는 이유 |
|---|---|
| 실행·정지·재기동 | 감독자(pm2)가 이미 CLI 다 |
| 로그 | `tail -f` 를 웹 tail 이 이길 수 없다 |
| 상태 | 한 줄이면 되는 일 |
| 설정 | 화면이 유리하긴 하나 **권한이 문제다** — `conf` 에 `dbpass`·`superUser` 가 있다 |

그리고 웹에서 이 둘을 빼면 **외부 공개의 위험 대부분이 사라진다** — 서버 정지·기동과
`conf` 편집이 웹에서 없어진다. 콘솔 비밀번호 = superUser 마스터 키 문제만 남고, 그건 §11 이다.

### 1.3 왜 pm2 를 우리 도구가 다루지 않나

| | 로컬 개발 | 배포 |
|---|---|---|
| 감독·자동 재시작 | 필요 없다. 죽으면 다시 친다 | **필수** — 마스터가 죽으면 서비스가 멈춘다 |
| 등록부(정지·재기동) | Ctrl-C 로 끝 | 필요 |
| stdout 을 파일로 | 터미널에 그대로 보인다 | 필요 |
| 부팅 시 기동 | 필요 없다 | 필요 |

**로컬에서 pm2 가 주는 것이 하나도 없다.** 오히려 Windows 에서 워커 수만큼 콘솔 창을
띄운다(§10.1). 그리고 **배포는 이미 pm2 로 돌고 있다** — 우리가 도입하는 것이 아니다.

- `npm start` 는 `node mobius.js` 그대로. `run_*.bat` 셋도 손대지 않는다
- 정지·재기동은 로컬이면 Ctrl-C, 배포면 `pm2 restart Mobius`
- **pm2 를 `package.json` 의존성으로 넣지 않는다**
- `ecosystem.config.js` 는 배포의 선택지다 — §11

### 1.4 의존 방향과 **로드 순서**

```
mobius/conf_schema.js     선언 — 단일 진실원 (코어)
        ▲
tools/conf_store.js       파일 읽기·쓰기 (admin/ 에서 이동)
        ▲
tools/mobius-conf.js      CLI — conf 조회·변경 · status
        ▲
admin/                    웹. 리소스만 다룬다
```

`conf_store.js` 를 `admin/` 에서 `tools/` 로 옮긴다. 설정 편집이 CLI 의 일이 됐으니
`admin/` 소유가 아니고, 그대로 두면 `tools/ → admin/` 의존이 생겨 방향이 꼬인다.

> **키 표는 백엔드에 따라 달라진다. 그래서 로드 순서가 계약이다.**
>
> `conf_schema.js` 의 `mergeBackendConf()` 가 **require 시점에 즉시**
> `require('./db').confSchema()` 를 합치고, `db/index.js` 의 `pick()` 이 `global.usedb` 를
> 읽어 어댑터를 **캐시**한다. 실측: **mysql `all()`=20 / `exposed()`=15,
> sqlite `all()`=22 / `exposed()`=18.**
>
> 그래서 `tools/mobius-conf.js` 는 반드시 이 순서로 한다.
>
> ```
> 1. conf.json 을 읽는다
> 2. global.usedb = process.argv[2] || conf.db || 'mysql';
> 3. 그제서야 mobius/conf_schema 와 tools/conf_store 를 require 한다
> ```
>
> `admin/server.js` 가 같은 자리에서 같은 글자로 한다. 순서를 놓치면 SQLite 배포에서
> 없는 키(`dbpass`)를 보여 주고 실제로 쓰는 `sqlite*` 3키는 `conf set` 이
> "모르는 키"로 거부한다 — **조용히 틀린다.**

---

## 2. 설정을 conf 로 내린다

### 2.1 지금 설정이 어디에 흩어져 있나

| 어디 | mysql | sqlite |
|---|---|---|
| `conf_schema` 전체 (`all()`) | 20 | 22 |
| 그중 화면에 뜨는 것 (`exposed()`) | 15 | 18 |
| 숨김 (`exposed: false`) | 5 | 4 |
| `mobius.js` 상단 하드코딩 (`global.*`) | 8 | 8 |
| `app.js` 하드코딩 (`usespid`) | 1 | 1 |
| 콘솔 자신의 키 (`admin*`) | 7 (스키마 밖) | 7 |

> **기준선은 움직인다.** 이 문서를 쓰는 동안 `4a47c48` 이 프로토콜 프록시 3종과 `wdt.js` 를
> 지우며 `pxyWsPort`·`pxyMqttPort` 를 뺐고, 31분 뒤 `f982c28` 이 `latchStaleMs` 를 더했다.
> **착수 전에 `node -e "var s=require('./mobius/conf_schema'); console.log(s.all().length, s.exposed().length)"`
> 로 다시 센다.**

### 2.2 위험 3등급

전부 편집 가능하게 두지 않는다. `usecsebase` 를 추적한 결과가 그 이유다.

```
mobius/cb.js        CSEBase 의 ri = '' + '/' + 'Mobius'  =  /Mobius
mobius/resource.js  자식은  ri = pi + '/' + rn
```

**저장된 모든 경로가 `/Mobius/…` 로 시작한다.** 값을 바꾸면 `cb.js` 의 조회가 실패해
CSEBase 행이 하나 더 생기고 기존 트리 전체가 고아가 된다. discovery 의 `whole_tree`
최적화가 어긋나고, `fopt.js` 가 기존 멤버를 원격 CSE 로 오판해 **조용히 건너뛴다.**

| 등급 | 뜻 | 스키마 |
|---|---|---|
| **편집** | 그냥 저장 | 평범 |
| **관문** | 저장 전에 "무엇이 깨지는가"를 보이고 키 이름을 타이핑해야 통과 | **`grade: 'gate'`** |
| **읽기** | 값만 보이고 저장 거부 | `readOnly: true` (`conf_schema.validate` 가 막는다) |

> **필드 이름은 `grade` 다. `danger` 를 쓰지 않는다** — `conf_store.js` 에 이미 **뜻이 다른**
> `DANGER`(값이 특정 값일 때 위험하다는 술어)가 있고, §7 이 그 파일을 `tools/` 로 옮기므로
> 한 디렉터리에 같은 이름 두 뜻이 공존하게 된다.
>
> `grade` 는 새 스키마 필드이므로 **`describe()` 의 화이트리스트에도 더해야 한다** —
> 그 함수는 필드를 골라 복사하는 구조라 안 더하면 CLI 에 안 온다. `test/conf-schema.test.js`
> 의 "describe() 항목이 필드를 다 갖는다" 검사 목록도 같이 늘린다.

### 2.3 내리는 키

| 새 conf 키 | 지금 값 | 지금 자리 | group | apply | 등급 | 근거 |
|---|---|---|---|---|---|---|
| `cseBase` | `Mobius` | `mobius.js` `usecsebase` | CSE 신원 | restart | **읽기** | 모든 `ri` 가 이걸로 시작 |
| `cseId` | `/Mobius2` | `mobius.js` `usecseid` | CSE 신원 | restart | **관문** | MQTT 알림 토픽·`acpi` 절대표기 접기가 끊긴다 |
| `spId` | `//keti.re.kr` | **`app.js` `usespid`** | CSE 신원 | restart | **관문** | 절대 표기 접기가 안 되면 대상 해석 실패 |
| `releaseVersion` | `2a` | `mobius.js` `uservi` | CSE 신원 | runtime | 편집 | `valid` 를 `cb.js` 의 `srv=['1','2','2a']` 로 건다 |
| `mqttBroker` | `localhost` | `mobius.js` `use_mqtt_broker` | 네트워크 | restart | 편집 | 남은 소비처는 알림 발행(`sgn_man.js`)뿐 |
| `mqttPort` | `1883` | `mobius.js` `use_mqtt_port` | 네트워크 | restart | 편집 | `useSecure='enable'` 이면 8883 으로 덮인다 |
| `useSecure` | `disable` | `mobius.js` `use_secure` | 네트워크 | restart | **관문** | 켜면 **MQTT 알림이 mqtts 로 바뀌어 기존 브로커와 끊긴다**. pem 은 저장소에 실재하므로 throw 는 안 난다 |
| `allowedAeIds` | `[]` | `mobius.js` `allowed_ae_ids` | 접근 제한 | runtime | **관문** | 비면 전원 허용, 하나라도 넣으면 목록 밖 전부 `403-1` |
| `allowedAppIds` | `[]` | `mobius.js` `allowed_app_ids` | 접근 제한 | runtime | **관문** | AE 생성 시 `api` 화이트리스트 |
| `csebaseport` | `7579` | 이미 conf | 네트워크 | restart | **관문** | 등록된 AE 의 `poa` 가 어긋난다. **`exposed: true` 로 연다** |
| 콘솔 6키 | | 스키마 밖 | 콘솔 | restart | 편집 | `adminPassword`·`adminOrigin` 은 `secret` **+ `exposed: false`** |

### 2.4 지우는 키 셋

| 키 | 왜 |
|---|---|
| `hitManPort` | `global.use_hit_man_port` 를 세우지만 **읽는 코드가 0건** |
| `sgnManPort` | 똑같다. `conf_schema.js` 선언과 `mobius.js` 전역 대입 두 줄뿐이고 읽는 곳이 없다. `4a47c48` 의 보고서가 두 전역을 나란히 고아로 적어 두었다 |
| `adminPm2Name` | 이름과 달리 Mobius 의 pm2 이름인데, `admin/` 이 프로세스 제어를 안 하면 읽는 코드가 없어진다. **그래서 스키마에 올리는 콘솔 키는 6개다** |

> **키를 지울 때는 `conf_schema.js` 와 `mobius.js` 를 원자적으로 움직인다.**
> `test/conf-schema.test.js` 가 양방향으로 강제하므로 한쪽만 지우면 실패한다.

### 2.5 `csebaseport` 를 열면 기존 시험이 깨진다

`conf_schema.js` 가 `csebaseport` 를 `exposed: false` 로 두고 있어 `validate()` 와
`conf_store.isWritable()` 두 관문이 모두 막는다. 열려면 **같은 커밋에서**
`test/conf-schema.test.js` 의 거절 목록도 고친다.

```
지금   ['dbpass', 'superUser', 'csebaseport', 'pxyWsPort']  를 거절하는지 검사
바꿈   ['dbpass', 'superUser']                              로 줄이고
       assert(schema.validate('csebaseport','7580').ok === true)  를 더한다
```

그 시험이 지키려는 것은 주석대로 **비밀 키가 저장 경로로 써지지 않는 것**이지 포트가 아니다.
`pxyWsPort` 는 `4a47c48` 이 스키마에서 지워 지금은 "노출 대상이 아니다"가 아니라
**"모르는 키다"로 우연히 통과**하고 있어, 검사한다고 말하는 것을 검사하지 않는다.

### 2.6 콘솔 6키는 시험을 **실패시킨다**

이것이 1단계에서 가장 먼저 부딪히는 벽이다.

`test/conf-schema.test.js` 의 키 스캐너는 리더를 둘만 본다 — `mobius.js` 소스와
**지금 고른 어댑터**의 `confSchema()`. 콘솔 6키는 `admin/server.js` 만 읽으므로 어느 쪽에도
안 잡히고, 표에 올리는 순간 **"표에만 있고 아무도 안 읽는 키"** 검사가 여섯을 잡아 실패한다.

**그래서 스캐너에 `admin/server.js` 를 세 번째 리더로 더하는 것이 1단계 작업의 일부다.**
`mobius.js` 에 쓰는 것과 같은 주석 제거를 먼저 적용한다 — `adminOrigin` 이 주석에도
나오므로 안 걷으면 산문이 가드를 통과한다.

`spId` 와 달리 **코드를 옮겨서 풀 수 없다.** 콘솔 키를 `mobius.js` 가 읽을 이유가 없다.

### 2.7 `conf_schema` 규약이 요구하는 것

1. **`mobius.js` 가 `conf.<키>` 를 실행 코드로 읽어야 한다.** `app.js` 에서만 읽으면
   "표에 있는데 아무도 안 읽는 키"로 걸린다 — `spId` 를 옮기는 이유다
2. **기본값을 세 가지 작성 모양 중 하나로** 쓴다. `? conf.K : 리터럴;` / `conf.K || 리터럴;` /
   `함수(conf.K, 리터럴)`. 다른 모양이면 `dflt` 대조가 **조용히 건너뛰어진다**
3. **새 group 3개**(`CSE 신원`·`접근 제한`·`콘솔`)를 `KNOWN` 에 넣는다
4. `apply: 'reload'` 인 키는 `reloadWith` 도 반드시 준다. 이번 새 키에는 해당 없음
5. **콘솔 키는 §2.6 대로 스캐너를 넓혀야 통과한다**

덤으로 하나 고친다 — `mobius.js` 의 `use_mqtt_port = '8883'` 대입은 `global.` 접두가 없는
**암묵 전역 대입**이다(파일에 `'use strict'` 가 없어서 동작한다). 명시적으로 바꾼다.

---

## 3. 지금 도는 값 / 파일 값 / 재기동 필요

### 3.1 `apply` 는 파일을 고치는 것과 다른 얘기다

`apply` 의 "값"은 **`global.*`** 이지 `conf.json` 이 아니다. `mobius.js` 는 기동 때 한 번
파일을 읽어 전역에 심고 그 뒤로는 파일을 다시 안 본다. **CLI 도 웹도 파일만 고친다.**
그래서 `apply: 'runtime'` 인 키도 **재기동해야 반영된다.**

유일한 예외가 오히려 더 나쁘다 — `cluster.fork()` 가 `mobius.js` 를 다시 실행하므로
**죽었다 되살아난 워커만** 새 값을 읽는다.

### 3.2 부팅 기록 — `log/mobius-boot.jsonl`

```jsonl
{"role":"master","pid":8812,"at":"...","supervised":true,"cap":75,"conf":{"db":"mysql","cseBase":"Mobius",...}}
{"role":"worker","pid":8840,"at":"...","supervised":true,"conf":{...}}
```

**값은 어떻게 모으나 — 대응표를 만들지 않는다.**

conf 키와 전역 이름은 하나도 안 겹치고 규칙 변환으로도 못 만든다
(`maxBodyBytes`→`max_body_bytes`, `csebaseport`→`usecsebaseport`,
`defaultAccessPolicy`→`useaccesscontrolpolicy`, `acpDenyLog`/`acpDenyLogRate`→`acp_deny_log`
의 두 필드). 손으로 유지하는 목록을 만들면 새 키가 빠졌을 때 `undefined` 가 기록돼
그 키가 **영구히 "재기동 대기"** 로 뜬다.

그래서 **`mobius.js` 가 전역을 세우면서 같은 자리에서 `applied[<conf 키>] = <방금 심은 값>`
을 함께 쌓고**, 마지막에 `boot_record.write(applied)` 로 넘긴다. 대입문과 기록이 같은 줄에
있으므로 따로 유지할 목록이 없다.

- **`secret: true` 인 키는 `boot_record` 가 뺀다.** 받은 객체를 `conf_schema` 로 훑어 거르므로
  새 비밀 키가 생겨도 자동으로 빠진다. 호출부는 지울 키를 알 필요가 없다
- **`mobius.js` 가 전역을 안 세우는 키는 기록 대상이 아니다** — 콘솔 6키가 여기 해당한다

**파일 자리와 만들기**

- 경로는 **`__dirname` 기준**이다(`app.js` 의 `log/` 와 같은 규약). `conf.json` 이 cwd
  기준인 것과 다르니 섞지 않는다
- **`boot_record` 가 `log/` 를 없으면 만든다.** 지금 만드는 코드는 `app.js` 안에 있는데
  기록은 `require('./app')` **앞**에서 쓰므로, 새로 설치한 서버의 첫 기동이 ENOENT 로 죽는다
- 인코딩 utf8, 개행 `\n`

**상한과 `capped`**

- 상한은 **마스터가 정해 `cap` 필드로 기록**한다. 워커가 각자 계산하지 않는다
- 워커는 **append 하기 전에** 줄 수를 세고, 상한 이상이면 자기 줄을 쓰지 않는다
- **상한에 처음 닿은 프로세스만** `{"role":"capped","at":...}` 를 **끝에 한 줄 덧붙인다.**
  파일을 대체하지 않는다 — 마스터 줄이 사라지면 §3.3 의 값 대조가 전 키에서 불가능해진다
- 이미 `capped` 줄이 있으면 아무도 더 쓰지 않는다

상한이 없으면 재포크 루프(§5.1)에서 초당 24줄씩 자라 **하루 수백 MB** 가 된다.
그리고 **`capped` 줄이 곧 좀비 탐지 신호**다.

**`supervised`** — `process.env.pm_id` 유무다. **pm2 를 쓸 때만 참**이므로
systemd·docker 로 띄우면 감독자가 있어도 거짓이다. 그래서 CLI 는 이 값으로
"감독자가 없다"를 단정하지 않고 **"pm2 로 뜬 것이 아니다"** 까지만 말한다.

### 3.3 판정

**비교는 정규화한 뒤 한다.** 순진한 `===` 로는 정상 상태가 상시 불일치로 보인다.

| 무엇 | 왜 |
|---|---|
| 배열은 **원소별**로 비교 | `allowedAeIds` 등은 참조가 달라 `===` 가 언제나 거짓 |
| 숫자·문자열은 `String()` 으로 맞춰 비교 | `port_of()` 가 문자열화한다 |
| `db` 는 `argv[2]` 가 이겼으면 **대조에서 뺀다** | `node mobius.js sqlite` 로 띄우면 파일과 다른 것이 정상이다 |
| `mqttPort` 는 `useSecure='enable'` 이면 대조에서 뺀다 | 8883 으로 덮이는 것이 정상이다 |

| 상태 | 조건 |
|---|---|
| **적용됨** | 파일 값 = 마스터 기록 값 |
| **재기동 대기** | 파일 값 ≠ 마스터 기록 값 |
| **모름** | 아래 판정으로 "안 돌고 있다"면 → 값 대조를 **아예 하지 않는다** |
| **대조 대상 아님** | 스키마에는 있는데 기록에 없는 키(콘솔 6키). `모름` 과 섞지 않는다 |

**"돌고 있는가"의 판정은 포트다.** 기록 파일은 서버가 죽어도 남으므로(파일은 "지금 이 판"만
담지, "살아 있음"을 뜻하지 않는다) 기록만으로 단정하면 **죽은 서버의 낡은 기록과 파일을
대조해 "적용됨"을 말하게 된다.** 포트가 닫혀 있으면 `모름` 이다.

경고 둘:

> **워커 불일치** — 기록의 워커 줄들이 서로 다른 값을 갖고 있다.
>
> **좀비 의심** — 기록에 `capped` 줄이 있다. 재포크 루프다(§5.1).

### 3.4 오류 처리

- **기록 파일이 없다** → `모름`. CLI 가 만들지 않는다
- **기록이 깨졌다** → 깨진 줄만 버리고 나머지로 판정. 전부 깨졌으면 `모름`
- **`conf.json` 이 깨졌다** → **덮어쓰지 않는다.** 사유를 말하고 종료
- **기록에는 있는데 스키마에 없는 키** → 옛 판으로 뜬 Mobius 다. 대조에서 빼고
  "기록이 오래됐다"만 표시

---

## 4. conf CLI — `tools/mobius-conf.js`

### 4.0 파일을 찾는 기준

**`conf.json` 은 저장소 루트 기준이다** (`__dirname` 에서 올라간다). cwd 기준으로 하면
다른 디렉터리에서 실행했을 때 §4.5 의 "없으면 만든다"가 **재현이 안 되는 파일을 엉뚱한
자리에 하나 더** 만들고, 3상태가 영원히 "재기동 대기"가 된다.

`log/mobius-boot.jsonl` 도 같은 기준이다(§3.2).

### 4.1 명령과 npm 스크립트

```
mobius-conf                    전체 목록 — 카테고리별 · 현재값 · 3상태
mobius-conf <키>               단건 상세 — 도움말 · 유효값 · 기본값 · apply · 등급
mobius-conf set <키> <값>      변경
mobius-conf unset <키>         기본값으로 되돌린다
mobius-conf status             포트 · 부팅 기록 · 재기동 대기 건수 (+ pm2 정보)
```

```json
"start"  : "node mobius.js",
"conf"   : "node tools/mobius-conf.js",
"status" : "node tools/mobius-conf.js status",
"test"   : "node --test test/*.test.js"
```

### 4.2 조회

값을 세 곳에서 합친다 — `conf_schema`(선언) · `conf.json`(파일 값) · 부팅 기록(도는 값).
**단, 첫 줄의 "키 목록" 자체가 `global.usedb` 에 달려 있다** — §1.4 의 순서를 지킨다.

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

저장소
  db                   mysql               적용됨
  dbConnectionLimit    25                  ● 재기동 대기 (파일 25 / 도는 값 100)
  ...

콘솔                                       — 대조 대상 아님 (Mobius 가 안 읽는다)
  adminPort            7580
  adminHost            127.0.0.1
  ...

비밀 — 값을 띄우지 않는다
  dbpass               설정됨
  superUser            없음 (기본값 사용)
  adminPassword        설정됨
  adminOrigin          없음 (superUser 로 떨어진다)

● 재기동 대기 1건.  반영하려면 Mobius 를 다시 띄운다.
```

단건 조회는 스키마가 가진 것을 다 보여 준다(유효값·도움말·`apply`·등급). `apply` 가
`runtime` 이든 `reload` 든 **CLI 관점에서는 전부 "재기동"** 이다(§3.1).

### 4.3 변경

**다섯 관문을 지난다.**

```
1. 타입 변환     명령줄은 전부 문자열이다                    ← 새로 짠다
2. validate()    conf_store.validate() → conf_schema.validate()
3. 등급 확인     grade === 'gate' 면 키 이름 타이핑           ← 새로 짠다
4. 원자적 쓰기   conf_store.update() / removeKey()
5. 안내          "재기동해야 반영된다"
```

**2·4번은 대부분 이미 있는 코드다.** `conf_store` 의 주석이 그 성질을 명시한다 —
*"하나라도 틀리면 아무것도 쓰지 않는다"*, *"모르는 키는 그대로 둔다"*, 관문이 이중인 이유는
*"잘못 통과하면 비밀이 파일에 써지고, 그건 되돌릴 수 없다"*.

**타입 변환 규칙** — 여기서 조용히 틀리기 쉽다.

| type | 규칙 |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` 에 맞을 때만 `Number()`. **빈 문자열·`"20MB"` 는 거부한다** — `Number('')===0` 이고 `dbQueueLimit` 의 0 은 "타임아웃 없는 무제한 대기열"이다 |
| `array` | 쉼표로 나누고 각 원소를 `trim()`. 빈 문자열이면 `[]` |
| `enum`·`string` | 그대로 |

**관문의 입출력 계약** — 이것이 없으면 대역이 계약을 정하게 된다.

- 확인 입력은 **stdin 에서 읽는다**
- **TTY 가 아니거나 EOF 면 거부한다.** 통과가 아니다. 이 한 줄이 없으면 EOF 를 통과로 읽는
  구현 하나로 관문 6키가 전부 무력해진다
- **비대화형에서 통과시키는 수단(`--yes` 같은 것)을 두지 않는다.** 관문 키는 사람이 친다
- 거부하면 **파일을 건드리지 않고** 종료 코드 1

**비밀 키는 조회만 한다.** 대상은 `conf_store` 의 `SECRET` 목록 넷 —
`dbpass`·`superUser`·`adminPassword`·`adminOrigin`.

> **거부 근거는 `secret` 이 아니라 `exposed === false` 다.** `conf_schema.validate()` 의
> 실제 관문이 그것이고 `secret` 은 보지 않는다. **`secret: true` 만 붙이고 `exposed: false`
> 를 빠뜨린 키는 그냥 써진다.** `adminOrigin` 은 콘솔의 CSE 쓰기 권한을 정하는 값이라
> 그 구멍이 곧 권한이다. 콘솔 6키를 올릴 때 두 필드를 **함께** 붙인다.

**`unset` 은 새 API 가 필요하다.** `conf_store` 의 쓰기 API 는 `update(patch)` 하나이고
내부가 대입뿐이라 키를 지우는 수단이 없다. `removeKey(key)` 를 더하되 **`isWritable()` 을
같은 자리에서 지나게** 한다 — 값 없는 경로로 짜면 유일한 관문을 우회해 `unset dbpass` 가
통한다.

배열은 쉼표로 받는다.

```
$ npm run conf -- set allowedAeIds ryeubi,APP01
⚠ allowedAeIds 를 채우면 목록 밖의 Origin 이 전부 403 을 받는다.
  지금은 비어 있어 전원 허용 상태다.

  바뀔 값:  [] → ["ryeubi", "APP01"]

  계속하려면 키 이름을 그대로 입력:  allowedAeIds
> _
```

### 4.4 `status`

```
$ npm run status
Mobius     돌고 있다 · 포트 7579 열림
기동       2026-09-04 04:15 · 마스터 pid 247395 · 워커 24
감독       pm2 online · 재시작 13회
설정       재기동 대기 1건  (dbConnectionLimit)
```

- **포트와 부팅 기록만으로 처음 네 줄 중 셋이 나온다.** `감독` 줄만 pm2 가 필요하다
- **pm2 를 못 찾거나 목록에 없으면 `감독` 줄이 이렇게 바뀐다** — `supervised: true` 면
  "pm2 로 떴으나 지금 목록에서 찾지 못함", 거짓이면 "pm2 로 뜬 것이 아니다".
  §3.2 대로 "감독자가 없다"를 단정하지 않는다
- **어느 pm2 앱이 Mobius 인지는 이름이 아니라 pid 로 고른다.** 배포 데몬에 앱이 17개인데
  이름을 들고 있던 `adminPm2Name` 은 §7 에서 지운다. `jlist` 의 `pid` 와 **부팅 기록의
  마스터 pid** 를 대조하면 된다 — Mobius 는 `fork_mode` 라 pm2 가 보는 pid 가 곧 클러스터
  마스터 pid 다. 이름을 CLI 에 하드코딩하면 "배포 종속 값 금지"에 걸린다
- **워커 수는 `role:"worker"` 줄 수가 아니다.** 그 값은 이 판에서 기동된 워커의 **누적 수**이고
  재포크가 늘린다. 마스터 줄에 `workers` 를 함께 기록하고 그것을 쓴다

**액세스 로그 요약은 넣지 않는다.** 초판 로그 탭의 잔재였다. `tail -f log/access-*.log` 가
그 자리다.

### 4.5 오류 처리

- **`conf.json` 이 없다** → 읽기는 전부 기본값으로 답한다. **쓰기만 파일을 만든다**
- **`conf.json` 이 깨졌다** → 덮어쓰지 않는다. 사유를 말하고 종료
- **부팅 기록이 없거나 포트가 닫혀 있다** → 3상태를 `모름` 으로 두고 대조하지 않는다
- **pm2 가 없다** → `감독` 줄의 문구만 바뀐다. 나머지는 그대로

---

## 5. 코어 결함 둘

### 5.1 포트 충돌이 좀비를 만든다

이미 포트를 누가 쥔 상태에서 Mobius 를 또 띄우면(§10.7):

```
워커    EADDRINUSE → listen 에 .on('error') 가 없어 uncaught 로 던진다
마스터  backstop 이 워커만 죽이고 1초 뒤 재포크 → 또 EADDRINUSE → 무한 반복
        실측 12초에 워커 사망 20회 이상
pm2     마스터가 안 죽으니 status online · restart_time 0 — 정상으로 본다
```

`fail_start` 는 이걸 안 잡는다 — 호출부 6곳이 전부 **DB 연결 실패 경로**다.
**감독자가 없으면 더 나쁘다** — 아무도 이상을 안 알려 준다.

**(가) 기동 전 시험 바인드 — 마스터가 한 번만**

- 자리는 `mobius.js` 의 `require('./app')` **앞**, **부팅 기록을 쓰기 전**, `cluster.isPrimary`
  일 때만
- **워커가 각자 하면 안 된다.** cluster 는 리스닝 소켓을 마스터가 만들어 넘기므로 두 번째
  워커부터 **자기 인스턴스가 연 포트**를 점유자로 보고 거부한다 → 워커 1개짜리 서버가 되고
  포트는 열려 있어 겉으로 정상이다
- 방법은 connect 탐침이 아니라 **시험 바인드**다. **`host` 를 주지 않는다** — 실제 `listen`
  이 와일드카드에 바인드하므로 같은 주소를 봐야 한다. 성공하면 `close()` 하고 잇는다
- **거부할 때 기록 파일을 손대지 않는다.** 순서를 뒤집으면 중복 실행된 인스턴스가
  **살아 있는 서버의 부팅 기록을 비우고** 종료한다

**(나) `listen` 의 `.on('error')` — 네 곳 전부**

`app.js` 의 `.listen(` 은 **네 곳**이다(워커 http·워커 https·단일 http·단일 https).
`use_secure` 로 갈리는 둘 다 살아 있으므로 하나만 고치면 https 배포에서 좀비가 남는다.

```js
var EXIT_PORT_TAKEN = 12;   // app.js 상단에 한 번만 선언
```

- **1 은 쓸 수 없다.** `backstop` 과 `fail_start` 가 이미 쓰고 있어, 1 을 고르면 **DB 가 몇 초
  늦어 죽은 워커에도 마스터가 자살한다** — `app.js` 주석이 명시적으로 보호하던 경우다
- 워커는 `backstop.exitAfterFlush(EXIT_PORT_TAKEN)` 으로 나간다(액세스 로그를 비우고)
- **`fail_start()` 를 쓰지 않는다.** 그 3초 지연은 DB 가 늦게 뜨는 경우의 재시도 주기다.
  포트 충돌은 기다려서 나아지지 않으므로 붙이면 pm2 가 영원히 재시작만 하고 `errored` 에
  못 간다
- **마스터 분기**는 `cluster.on('exit')` 의 `exitedAfterDisconnect` 조기 반환 **뒤**,
  재포크 `setTimeout` **앞**이다. `code === EXIT_PORT_TAKEN` 이면 안내를 찍고
  **마스터도 같은 코드로 즉시 종료**한다

> 이 분기를 넣으면 `test/cluster-respawn.test.js` 의 핸들러 추출 정규식 상한이 먼저 깨진다.
> 같이 올린다.

### 5.2 `windowsHide` 한 줄

```js
cluster.setupPrimary({ windowsHide: true });   // fork 루프 앞. Linux 에서는 무시된다
```

**터미널에서 `node mobius.js` 로 띄우면 워커가 부모 콘솔을 상속해 창이 안 뜬다.** 창은
pm2 처럼 콘솔 없는 부모가 띄울 때만 생긴다(§10.1). 그래서 전제 조건이 아니라 **넣어 두는 게
싼 것**이다 — 한 줄이고 Linux 에서는 무시되며, 로컬에서 누가 pm2 를 쓰는 순간 필요해진다.

---

## 6. `conf` 로딩을 모듈로 뺀다

시험 ① — "빈 `conf.json` 으로도 지금 동작이 그대로다" — 를 **지금 구조에서는 실행할 수 없다.**
`mobius.js` 의 마지막 줄이 `require('./app')` 이고, `app.js` 는 로드만으로 DB 에 붙고 CPU
코어 수만큼 fork 하고 7579 를 연다. 게다가 `mobius.js` 는 cwd 의 `conf.json` 이 없으면
만들어 버린다. 저장소의 어떤 시험도 `mobius.js` 를 require 하지 않고 소스를 문자열로 읽을 뿐이다.

그래서 **conf 를 읽어 전역을 세우는 부분을 `mobius/conf_load.js` 로 뺀다.**

```
mobius/conf_load.js    conf.json 을 읽고 global.* 을 세우고 applied 를 돌려준다
mobius.js              conf_load() → boot_record.write(applied) → require('./app')
```

- 시험은 `conf_load` 만 require 한다. 서버가 안 뜨므로 ① 이 자동 시험으로 성립한다
- §3.2 의 `applied` 수집이 자연스럽게 이 모듈 안에 든다
- 환경 변수를 늘리지 않는다 (`MOBIUS_SQLITE_PATH` 하나뿐이라는 규약을 지킨다)

---

## 7. 웹에서 걷어낼 것

**화면은 새로 만들지 않는다.** 한 커밋에 한다.

| 무엇 | 자리 |
|---|---|
| `conf` 조회·저장 라우트 | `admin/server.js` |
| 프로세스 제어 라우트 **4개** | `GET /api/server/status` · `POST .../start` · `stop` · `restart` |
| `require('./process_ctl')` 과 `ctl` 인스턴스 생성부 | `admin/server.js` |
| 설정 화면 | `admin/web/src/views/ConfView.vue` 삭제 |
| 서버 제어 컴포넌트 | `admin/web/src/components/ServerControl.vue` 삭제 |
| **`App.vue`** — import · `Tab` 유니온의 `'conf'` · `TABS` · 렌더 분기 | 넷 다 |
| **`api.ts`** — 서버 제어 4함수 · `CtlResult` · `confView`/`confSave` | |
| **`types.ts`** — `ServerStatus` · `ConfView` 등 | |
| detached spawn | `admin/process_ctl.js` 삭제 (딸린 시험 10건 포함) |
| conf 파일 계층 | `admin/conf_store.js` → `tools/conf_store.js` 로 **이동** |
| CSE 신원 하드코딩 **세 줄** | `admin/server.js` — §7.1 |

> **프런트 세 파일을 안 건드리면 TypeScript 빌드가 깨진다.** 뷰 파일 둘만 지우는 것으로는
> 정리되지 않는다.

**`process_ctl.js` 에서 건져 올 것이 있다** — `status` 가 쓸 포트 프로브와 pm2 탐지가
그 파일 안에 있다. 지우기 전에 `tools/mobius-conf.js` 로 옮긴다.

남는 웹 화면은 **6개**다 (AcpEdit · AcpList · AcpProblems · AcpSimulate · Expired · Orphan).

### 7.1 콘솔의 CSE 신원 하드코딩 — 지우는 게 아니라 옮긴다

`admin/server.js` 는 `usecsebase`·`usecseid`·`usespid` **세 줄**을 박아 두었다.
안 세우면 `sql_action.fold_acpi_entry` 가 ReferenceError 를 내고, **값이 틀리면 절대 표기를
못 접어 ACP 삭제 영향 분석이 "참조 없음"으로 조용히 오판한다.**

§2.3 이 `cseId`·`spId` 를 관문 등급으로 열어 CLI 로 바꿀 수 있게 하므로, **세 줄 모두
`conf` 에서 읽도록 바꾼다.** 한 줄만 고치면 콘솔이 코어와 다른 신원으로 돈다.

---

## 8. 시험 계약

### 8.0 먼저 고쳐야 하는 기존 시험

새 시험을 쓰기 전에 이것들이 깨진다.

| 시험 | 왜 |
|---|---|
| `test/conf-schema.test.js` | 키 스캐너에 `admin/server.js` 추가(§2.6) · 거절 목록 수정(§2.5) · `KNOWN` group 3개 · `describe()` 필드 목록에 `grade` |
| `test/admin-conf-store.test.js` | require 경로·파일 이름이 `tools/` 로 바뀐다. 숨김 키·콘솔 키 검사도 |
| `test/admin-process-ctl.test.js` | 10건 전부 §7 과 함께 삭제 |
| `test/cluster-respawn.test.js` | 핸들러 추출 정규식 상한(§5.1) |
| `test/usesqlite-single-reader.test.js` | `KNOWN_NAME_SITES` 가 **줄 번호**로 허용한다. 1단계가 `mobius.js` 를 건드리면 밀리고, 검사가 양방향이라 실패한다 |

### 8.1 코어

**① 빈 `conf.json` 으로도 지금 동작이 그대로다** ← 배포 안전의 핵심.
§6 의 `conf_load` 를 require 해 전역을 확인한다.

```
usecsebase 'Mobius' · usecseid '/Mobius2' · usespid '//keti.re.kr'
use_mqtt_broker 'localhost' · use_secure 'disable' · use_mqtt_port '1883'
uservi '2a' · allowed_ae_ids [] · allowed_app_ids []
```

**② `spId` 를 `mobius.js`(conf_load)가 세우고, 콘솔은 세 줄 다 conf 에서 읽는다**

**③ `useSecure='enable'` 이면 `mqttPort` 가 8883 이 된다**

**④ 키 표가 백엔드를 따라간다** — `db:'sqlite'` 면 `sqlite*` 3키가 나오고 `dbpass` 는
안 나오는가. `mysql` 이면 그 반대인가. **로드 순서(§1.4)를 어기면 실패해야 한다**

**⑤ 콘솔 키의 리더가 스캐너에 잡힌다** — `admin/server.js` 실행 코드에서 `adminPassword` 를
지우면 역방향 검사가 실제로 실패하는가(주석에만 남은 이름이 가드를 통과하지 않는지)

**⑥ 부팅 기록** — 마스터가 비우고 워커가 append / **`secret` 키가 안 들어간다**(새 비밀 키를
하나 더해도 자동으로 빠지는지) / 값이 `conf` 원본이 아니라 실제 전역 값 / `log/` 를 없으면
만드는지

**⑦ 상한과 `capped`** — 상한을 넘겨 append 하려 하면 **끝에 `capped` 한 줄만 덧붙고**
마스터 줄이 남아 있는지. 이미 `capped` 가 있으면 더 안 쓰는지

**⑧ 포트 충돌이 좀비를 만들지 않는다** — 포트를 잡아 두고 띄웠을 때 마스터가 **재포크하지
않고 `EXIT_PORT_TAKEN` 으로 종료**하는지. **지금은 무한 재포크가 되므로 이 시험은 처음에
반드시 실패해야 한다.** 시험 바인드가 마스터에서만 도는지도 함께

**⑨ `cluster.setupPrimary({ windowsHide: true })` 가 fork 앞에 있다**
소스 검사로 잡되 **주석을 걷어낸 뒤** 검사한다 — `test/admin-process-ctl.test.js` 가
머리말 주석만으로 통과한 전례가 있다

### 8.2 CLI

**⑩ 조회가 3상태를 낸다** — 포트가 닫혀 있으면 대조를 아예 안 하고 `모름` / 콘솔 키는
`대조 대상 아님` / 워커 줄이 서로 다르면 불일치 / `capped` 면 좀비 의심

**⑪ 비교가 정규화된다** — 배열이 원소별로 비교되는지, `argv[2]` 로 띄운 `db` 와
`useSecure='enable'` 의 `mqttPort` 가 대조에서 빠지는지

**⑫ 타입 변환** — `number` 키에 `""`·`"20MB"` 를 주면 **거부**하는지(`Number('')===0` 이
그냥 통과하면 `dbQueueLimit` 이 0 이 된다). `array` 키의 쉼표·공백·빈 문자열

**⑬ `set` 이 `validate()` 를 지난다** — 모르는 키·읽기 전용·유효값 밖·**`exposed:false`**
가 모두 거부되는지. `secret` 만 붙은 가짜 키를 넣어 **그것도 거부되는지** 확인한다

**⑭ `unset` 이 관문을 지난다** — `unset dbpass` 가 거부되는지. 값 없는 경로가
`isWritable()` 을 우회하지 않는지

**⑮ 관문의 입출력 계약** — TTY 가 아니거나 EOF 면 **거부**하고 파일을 안 건드리는지.
**대역이 무조건 통과시키면 이 시험이 아무것도 안 지킨다**

**⑯ `status` 가 pm2 없이도 동작한다** — `감독` 줄의 문구만 바뀌고 나머지는 나오는지.
pm2 앱을 **pid 로** 고르는지(이름 하드코딩이 없는지)

### 8.3 웹

**⑰ conf·프로세스 제어가 웹에서 사라졌다** — 라우트 4개가 없고, `admin/` 어디에도
프로세스를 띄우거나 `conf.json` 에 쓰는 코드가 없는지. **프런트가 빌드되는지**

### 8.4 시험 대역 원칙

CLAUDE.md 의 규칙을 따른다 — **가짜가 실물보다 관대하면 시험이 거짓말을 한다.**

- **부팅 기록 시험은 실제 파일을 쓴다**(임시 디렉터리). 메모리 목으로는 truncate ↔ append
  경합을 못 본다
- **관문 확인 입력 대역은 실물처럼 굴어야 한다.** 무조건 통과시키면 ⑮ 가 무의미하다
- 새 시험 파일은 `test/` 아래 아무 이름이나 좋다 — `npm test` 가 평면 글롭이다.
  다만 `admin-` 접두는 떼서 `conf-` 로 한다

---

## 9. 작업 순서

| | 단계 | 파일 | 시험 |
|---|---|---|---|
| 1 | `conf_load` 분리 + conf 키 9개 내리기 | `mobius/conf_load.js`(신설) · `conf_schema.js` · `mobius.js` · `app.js` | 기존 19 + ①②③ |
| 2 | 콘솔 6키 + 스캐너 확장 + 죽은 키 셋 삭제 + `csebaseport` 열기 | `conf_schema.js` · `mobius.js` · `test/conf-schema.test.js` | ④⑤ + §8.0 |
| 3 | 부팅 기록 | `mobius/boot_record.js`(신설) · `conf_load.js` | ⑥⑦ |
| 4 | 포트 충돌 처리 + `windowsHide` | `app.js` · `mobius.js` · `test/cluster-respawn.test.js` | ⑧⑨ |
| — | **배포 1차** — 코어 반영 + Mobius 재기동 | | 동작 불변 확인 |
| 5 | `conf_store.js` 이동 (+ `removeKey`) | `admin/` → `tools/` · `test/admin-conf-store.test.js` | 기존 20 |
| 6 | conf CLI | `tools/mobius-conf.js`(신설) · `package.json` | ⑩~⑯ |
| 7 | 웹에서 걷어내기 | `admin/server.js` · 뷰 2개 · 프런트 3파일 · `process_ctl.js` | ⑰ |
| 8 | 문서 갱신 | `CLAUDE.md` · `README.md` · `admin/README.md` | — |
| — | **배포 2차** — CLI 반영 + 웹 재기동 | | |

**코어를 먼저 하는 이유**는 CLI 가 코어가 준 것(스키마·부팅 기록)에 의존하고 반대는 아니기
때문이다. 1~4가 배포에 무해하므로 먼저 올려 두면 CLI 작업 중에도 배포가 안전하다.

**7단계는 한 커밋에 한다.** 라우트 4개·뷰 2개·프런트 3파일·`process_ctl.js`·CSE 신원 세 줄을
같이 고친다. 반쪽만 지우면 빌드가 깨진다.

**8단계에서 낡는 문서** — `CLAUDE.md` 의 conf 키 표(개수와 행이 바뀐다) · "환경 변수를 보는
운영 코드는 `MOBIUS_SQLITE_PATH` 하나뿐"(부팅 기록이 `pm_id` 를 본다) · 죽은 키 표 ·
관리 콘솔 모듈 목록. `README.md` 의 실행·설정 예시. `admin/README.md` 의 admin 키 표.
**`CLAUDE.md` 는 `.gitignore` 되어 코드 커밋이 자동으로 안 건드린다.**

### 9.1 각 단계의 "끝났다" 기준

- **1~4** — `npm test` 전건 통과 + `conf_load` 를 빈 conf 로 불러 전역이 지금과 같음 +
  포트를 잡아 두고 띄웠을 때 **좀비가 아니라 깨끗한 실패**가 되는 것을 실제로 확인
- **배포 1차** — 재기동 후 `mobius-boot.jsonl` 이 생기고, 응답이 전과 같음
  (`tools/response-golden/headers.js`)
- **5~6** — `npm test` 전건 통과. `npm run conf` 와 `npm run status` 가 **pm2 없이도** 동작.
  number·array 키를 명령줄에서 실제로 고쳐 본다. **SQLite 로도 한 번 조회해 키 표가 바뀌는지**
- **7** — 웹이 여전히 뜨고 남은 6화면이 동작. `npm run build` 가 통과
- **배포 2차** — SSH 로 들어가 `npm run conf` → `set` → `pm2 restart Mobius` →
  `적용됨` 으로 바뀌는 것까지 한 번 걸어 봄

---

## 10. 배포 반영

### 10.1 원칙

새 conf 키의 기본값을 지금 하드코딩 값과 같게 두면 배포 `conf.json`(5키)에 아무것도 안 넣어도
동작이 그대로다. `windowsHide` 한 줄도 Linux 에서는 무시된다.

**pm2 는 건드리지 않는다.** 버전도, `ecosystem.config.js` 도입 여부도 이 작업의 일이 아니다.

### 10.2 순서

1. **코어를 배포하고 Mobius 를 재기동한다**(`pm2 restart Mobius`). 워커 24개 재기동이라
   순단이 있다. `mobius-boot.jsonl` 은 **새 코어로 재기동해야 생긴다**
2. **CLI 를 배포한다.** 새 의존성이 없으므로 `npm install` 도 필요 없다
3. **웹 정리분을 배포하고 콘솔을 재기동한다.** 배포 `conf.json` 에 `adminPassword` 가 없어
   지금은 콘솔이 안 뜬다 — 넣으려면 **파일을 먼저 백업한다**(재현이 안 되는 파일이다)

### 10.3 조심할 것

**다른 세션과 겹친다.** 이 문서를 쓰는 동안에도 `lite` 가 여러 번 움직였다 — 프로토콜 프록시
3종 삭제, `latchStaleMs` 추가, ACP 관찰 모드 수정. `mobius.js`·`app.js`·`conf_schema.js` 는
다른 사람도 만지고 있으므로 **착수 전에 조율하고, §2.1 의 수치를 다시 센다.**

**배포 데몬에 앱이 17개고 16개가 같은 사용자의 다른 서비스다.** 재기동할 때 이름을 정확히
줘야 한다 — `pm2 restart Mobius`.

---

## 11. 실측 근거

전부 2026-09-04 에 직접 실행해 확인한 것이다.

### 11.1 창은 `cluster.fork()` 가 만든다

관리 UI(pm2 경유)로 Mobius 를 띄우자 콘솔 창이 워커 수만큼 떴다(이 장비 16코어 → 16개).
워커 2개짜리 흉내 스크립트로 변형을 갈라 측정했다(보이는 최상위 창을 열거해 소유 프로세스 확인).

| 변형 | 새로 뜬 창 |
|---|---|
| 아무 것도 안 함 (지금 코드) | **2개** |
| `spawn` 에만 `windowsHide` | **2개** — 무효 |
| `cluster` 에만 `windowsHide` | **0개** |
| 둘 다 | **0개** |
| pm2 + `HIDE_WORKERS=1` | **0개** |

`spawn` 쪽 옵션은 효과가 없고 **`cluster` 쪽 한 줄이 전부**다. 그리고 **터미널에서 직접
띄우면 애초에 안 뜬다** — 워커가 부모 콘솔을 상속하기 때문이다.

(창 수가 워커 수와 정확히 같지 않은 측정도 있었다 — Windows Terminal 이 창을 묶는 방식
때문이다. 판정에 쓴 것은 **0이냐 아니냐**다.)

### 11.2 `pm2 start <이름>` 은 이름을 경로로 먼저 해석한다

등록되지 않은 이름으로 불렀더니 **실패하지 않고** 존재하지 않는 경로를 스크립트로 잡은 채 떴다.

```
$ pm2 start Mobius
[PM2] Starting C:\...\Mobius\Mobius in fork_mode (1 instance)
[PM2] Done.          ← 그런 파일은 없다
```

배포에서 pm2 를 쓸 때 알아 둘 것 — `pm2 start <이름>` 은 **이미 등록된 앱에만** 안전하다.

### 11.3 배포 서버 현황

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

### 11.4 pm2 `jlist` 가 주는 필드

`status` 의 `감독` 줄이 쓸 수 있는 것들이다.

`pid` · `status` · `restart_time` · `unstable_restarts` · `pm_uptime` · `exec_mode` ·
`instances` · `pm_exec_path` · `pm_cwd` · `pm_out_log_path` · `pm_err_log_path` ·
`memory` · `cpu`

### 11.5 콘솔은 코드 수정 없이 뜬다

막는 것은 빌드가 아니라 `conf.json` 이다. `adminPassword` 가 없으면 프로세스가 아예
`exit(1)` 한다. 빌드 부재는 2차 장벽이고, 서버는 뜨고 `/` 만 503 을 준다.

### 11.6 중복 실행은 좀비가 되고, pm2 는 정상으로 본다

`app.js` 의 기동 구조를 그대로 본뜬 껍데기로 측정했다.

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
`restarts 30` → `errored`). **그리고 `pm2 start <이름>` 은 이미 `online` 인 앱에 불러도
거부가 아니라 재시작이다.**

### 11.7 웹을 외부에 열려면 지금은 부족하다

```
adminHost      기본 127.0.0.1 — conf 로 바꿀 수 있다
루프백 아니면   경고 한 줄만 찍고 그대로 뜬다
세션 쿠키       HttpOnly · SameSite=Strict · 8시간 — Secure 없음
로그인 시도 제한  0건
비밀번호 비교    해시 + timingSafeEqual — 이건 제대로 돼 있다
```

`adminOrigin` 을 안 주면 콘솔이 `superUser` 로 CSE 에 접근하고 `security.check` 가 그 값을
무조건 통과시킨다. **설정과 실행을 웹에서 빼면 위험의 큰 축 둘이 사라지지만, 이 마스터 키
문제는 남는다.**

---

## 12. 정하지 않은 것

- **웹을 외부에 어떻게 열 것인가** — 리버스 프록시(TLS + 추가 인증) 뒤에 두는 안이 유력하다.
  콘솔 코드는 루프백 바인드 그대로 두면 되므로 이 스펙을 바꾸지 않는다. 다만
  **로그인 시도 제한과 `Secure` 쿠키는 그때 필수**다
- **`adminOrigin` 을 `superUser` 에서 뗄 것인가** — 떼면 웹이 ACP 로 제한되지만 만료·고아
  삭제가 막힐 수 있다. 재정의 문서의 **결정 ②**(관리자 1명 전제)와 함께 정한다.
  이번 작업과 커밋을 섞지 않는다
- **루프백이 아닌 바인드를 거부할 것인가** — 지금은 경고만 한다
- **`npm run status` 에 `--json` 을 줄 것인가** — 사람이 읽는 형식은 §4.4 에서 확정했다
- **부팅 기록 상한의 계수** — `capped` 의 뜻·판정 시점·`cap` 필드는 §3.2 에서 정했다.
  `os.cpus().length * 3 + 여유` 의 계수는 구현 재량
- **pm2 존재 판정 방법과 `jlist` 타임아웃** — 실패를 전부 "pm2 없음"으로 떨어뜨린다는
  계약만 §4.4 에 있으면 된다
- **배포에 `ecosystem.config.js` 를 둘 것인가** — 두면 `pm2 start` 의 모호성(§11.2)이
  없어지고 로그 경로·모드를 파일로 고정할 수 있다. 이 스펙의 범위 밖
- **배포 소스의 `usecsebase`·`usecseid`·`usespid` 실제 값**이 이 문서가 적은 기본값과 같은지.
  **1단계 착수 전에 확인한다**
