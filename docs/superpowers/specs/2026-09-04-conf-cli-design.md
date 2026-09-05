# Mobius 설정 — 코어 정리와 conf CLI

- 작성일: 2026-09-04 · **8판** (7판이 구현·배포 준비 완료, 8판은 2차 — §13)
- 대상 브랜치: `lite`
- 선행 문서: [관리 콘솔 목표 재정의](2026-09-01-admin-console-purpose.md), [관리 콘솔 설계](2026-08-28-admin-console-design.md)

**개정 이력**

| 판 | 무엇이었나 |
|---|---|
| 1 | 설정 탭 · 실행 탭을 **웹**으로 |
| 2 | 설정·실행을 **CLI** 로. `mobius-ctl` 이 pm2 API 로 제어 |
| 3 | **pm2 를 배포의 것으로 밀어냈다.** CLI 는 `conf` 와 `status` 만 |
| 4 | `conf` 조회·변경의 구조를 채웠다 |
| 5 | 전수 검토 반영 — 코드와 어긋난 사실 5건, 미정 12건 |
| 6 | **첫 구동 마법사** 추가 · `cseBase` 등급 정정 |
| 7 | 2차 전수 검토 반영 — 아래 |
| **8** | **2차 작업(§13)** — 사용자/고급 키 구분(`tier`)과 `--all` · 비밀 봉인(`conf.seal.json`) · 일괄 편집(`conf edit`) · 마법사에 `superUser` · `--superuser`. 사용자 결정 2026-09-05 |

**7판에서 고친 것** — 두 번째 검토가 잡은 것 중 무거운 것들이다.

| | 6판이 적은 것 | 실제 |
|---|---|---|
| `cseBase` 를 바꾸면 | "옛 리소스는 새 CSE 에서 안 보인다" | **거짓.** 루트 discovery·비구조 주소는 이름을 안 본다 — §2.2.1 |
| 생존 판정 | 포트 | **마스터 pid.** 포트는 남이 쥐어도 열려 보인다 — §3.3 |
| 마법사의 쓰기 | `conf_store` 를 쓴다 | **지금 API 로는 파일을 못 만든다** — §4.5.2 |
| CLI 의 `global.usedb` | `mobius.js` 와 같은 글자 | **`argv[2]` 를 읽으면 안 된다** — 그건 하위 명령이다 — §1.4 |
| 시험이 읽는 `mobius.js` | 그대로 | **`conf_load` 로 옮기면 시험 넷이 깨진다** — §8.0 |

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
| 1 | `conf` 로딩을 코어 모듈로 뺀다 | `mobius/conf_load.js`(신설) · `mobius.js` |
| 2 | 소스에 박힌 설정 9개를 conf 키로 (`mobius.js` 8 + `app.js` 1) | `conf_schema.js` · `conf_load.js` · `app.js` |
| 3 | 콘솔 6키를 스키마로 + **시험의 키 스캐너를 넓힌다** | `conf_schema.js` · `test/conf-schema.test.js` |
| 4 | `csebaseport` 를 열고, 죽은 포트 키 둘을 지운다 | `conf_schema.js` · `conf_load.js` |
| 5 | 기동 시 적용된 설정을 파일에 한 줄 남긴다 | `mobius/boot_record.js`(신설) |
| 6 | 코어 결함 둘 — 포트 충돌 처리, `windowsHide` | `app.js` |
| 7 | **`conf` CLI** — 조회·변경 + `status` | `tools/mobius-conf.js`(신설) · `tools/conf_store.js`(이동) |
| 8 | **첫 구동 마법사** — `npm run setup` | `tools/setup.js`(신설) · `mobius/setup_prompt.js`(신설) |
| 9 | 웹에서 conf 편집·프로세스 제어를 걷어낸다 | `admin/` |
| 10 | 낡는 문서를 고친다 | `CLAUDE.md` · `README.md` · `admin/README.md` |
| 11 | **(2차)** 사용자 키 7개와 고급 키를 가른다 — CLI 는 기본으로 사용자 키만, `--all` 로 전부 | `conf_schema.js` · `tools/conf_cli.js` · `tools/mobius-conf.js` |
| 12 | **(2차)** `dbpass`·`superUser` 를 봉인한다 — 도구로만 바꾸고, 손으로 고치면 기동을 거부 | `mobius/conf_seal.js`(신설) · `conf_load.js` · `tools/conf_store.js` |
| 13 | **(2차)** 일괄 편집 `npm run conf -- edit` — 첫 실행처럼 사용자 키를 차례로 묻는다 | `tools/conf_cli.js` |

---

## 1. 범위와 경계

### 1.1 빼는 것

- **웹 화면 신설** — 설정 탭도 실행 탭도 만들지 않는다. 기존 화면은 그대로 둔다
- **실행 래퍼** — `npm start` 는 `node mobius.js` 그대로다. 정지·재기동은 환경의 일
- **외부 접근 통제** · **`adminOrigin` 을 `superUser` 에서 떼는 일** — §12
- **sub 탭 · 리소스 탭**, **기존 만료·고아·ACP 화면 정리** — 별도 사이클
- **콘솔의 MySQL 풀 설정(100/0)** — 실제로 DB 를 치는 화면을 손볼 때

### 1.2 왜 설정이 CLI 인가

| | CLI 가 맞는 이유 |
|---|---|
| 실행·정지·재기동 | 감독자(pm2)가 이미 CLI 다 |
| 로그 | `tail -f` 를 웹 tail 이 이길 수 없다 |
| 상태 | 한 줄이면 되는 일 |
| 설정 | 화면이 유리하긴 하나 **권한이 문제다** — `conf` 에 `dbpass`·`superUser` 가 있다 |

웹에서 이 둘을 빼면 **외부 공개의 위험 대부분이 사라진다.** 콘솔 비밀번호 = superUser
마스터 키 문제만 남고, 그건 §12 다.

### 1.3 왜 pm2 를 우리 도구가 다루지 않나

| | 로컬 개발 | 배포 |
|---|---|---|
| 감독·자동 재시작 | 필요 없다 | **필수** |
| 등록부(정지·재기동) | Ctrl-C 로 끝 | 필요 |
| stdout 을 파일로 | 터미널에 보인다 | 필요 |
| 부팅 시 기동 | 필요 없다 | 필요 |

**로컬에서 pm2 가 주는 것이 하나도 없다.** 오히려 Windows 에서 워커 수만큼 콘솔 창을
띄운다(§11.1). 그리고 **배포는 이미 pm2 로 돌고 있다.**

`npm start` 는 `node mobius.js` 그대로. `run_*.bat` 셋도 손대지 않는다. pm2 를
`package.json` 의존성으로 넣지 않는다. `ecosystem.config.js` 는 배포의 선택지다(§12).

### 1.4 의존 방향과 로드 순서

**코어는 `tools/` 를 require 하지 않는다.** 마법사도 이 방향을 지킨다 — 프롬프트 로직은
코어에 두고 양쪽이 그것을 부른다.

```
mobius/conf_schema.js   선언 (단일 진실원)
mobius/conf_write.js    원자적 쓰기
mobius/setup_prompt.js  프롬프트 (readline 만 쓴다)
        ▲        ▲        ▲
tools/conf_store.js ─────┤        │
        ▲                │        │
tools/mobius-conf.js ────┴────────┤
tools/setup.js ───────────────────┘
        ▲
admin/                  웹. 리소스만 다룬다
```

`conf_store.js` 를 `admin/` 에서 `tools/` 로 옮긴다. 설정 편집이 CLI 의 일이 됐으니
`admin/` 소유가 아니다. 원자적 쓰기는 마법사(코어)도 써야 하므로 `mobius/conf_write.js` 로
내린다.

> **키 표는 백엔드에 따라 달라진다. 그래서 로드 순서가 계약이다.**
>
> `conf_schema.js` 의 `mergeBackendConf()` 가 **require 시점에 즉시**
> `require('./db').confSchema()` 를 합치고, `db/index.js` 의 `pick()` 이 `global.usedb` 를
> 읽어 어댑터를 **캐시한다.** 실측(2026-09-04): **mysql `all()`=20 / `exposed()`=15,
> sqlite `all()`=22 / `exposed()`=18.**
>
> ```
> 1. conf.json 을 읽는다
> 2. global.usedb = conf.db || 'mysql';      ← process.argv[2] 를 읽지 않는다
> 3. 그제서야 mobius/conf_schema 와 tools/conf_store 를 require 한다
> ```
>
> **CLI 는 `process.argv[2]` 를 백엔드 이름으로 읽지 않는다.** §4.1 이 정한 대로 CLI 의
> `argv[2]` 는 **하위 명령 또는 키 이름**이다. `mobius.js` 의 글자를 그대로 베끼면
> `npm run conf -- set mqttPort 1884` 가 `global.usedb='set'` 을 만들고 `pick()` 이
> 로그 한 줄만 찍고 mysql 로 떨어진다 — sqlite 배포에서 `dbpass` 를 유효 키로 보여 주고
> `sqlite*` 3키를 "모르는 키"로 거부하는, 이 절이 막으려던 그 오작동이다. 백엔드를 강제할
> 일이 생기면 위치 인자가 아니라 `--db=<이름>` 이라는 이름 있는 옵션을 판다.
>
> `admin/server.js` 가 **같은 순서**를 따른다 — 다만 글자까지 같지는 않다. 그 파일은 위치
> 인자를 받지 않아 `argv[2]` 가 늘 `undefined` 이므로 무해할 뿐이다.

---

## 2. 설정을 conf 로 내린다

### 2.1 지금 설정이 어디에 흩어져 있나

| 어디 | mysql | sqlite |
|---|---|---|
| `conf_schema` 전체 (`all()`) | 20 | 22 |
| 그중 화면에 뜨는 것 (`exposed()`) | 15 | 18 |
| `mobius.js` 상단 하드코딩 (`global.*`) | 8 | 8 |
| `app.js` 하드코딩 (`usespid`) | 1 | 1 |
| 콘솔 자신의 키 (`admin*`) | 7 (스키마 밖) | 7 |

> **기준선은 움직인다.** 이 문서를 쓰는 동안에도 `4a47c48` 이 `pxyWsPort`·`pxyMqttPort` 를
> 빼고 `f982c28` 이 `latchStaleMs` 를 더했다. **착수 전에 다시 센다.**
>
> ```
> node -e "global.usedb='mysql';var s=require('./mobius/conf_schema');console.log(s.all().length,s.exposed().length)"
> ```

### 2.2 위험 3등급

값을 바꿨을 때 **되돌릴 수 있는가**가 기준이다.

| 등급 | 뜻 | 스키마 |
|---|---|---|
| **편집** | 그냥 저장 | 평범 |
| **관문** | 저장 전에 "무엇이 달라지는가"를 보이고 키 이름을 타이핑해야 통과 | **`grade: 'gate'` + `gateWarn: '<문구>'`** |
| **읽기** | 값만 보이고 저장 거부 | `readOnly: true` |

**새로 내리는 키 중에 읽기 전용은 없다.** 그 등급은 기존 `retentionPolicies` 가 쓴다.

> **관문 문구는 `gateWarn` 에 둔다. CLI 안에 키별 문구를 적지 않는다** — 적으면 §2.3 의
> 근거 칸과 두 벌이 되고, 코어의 정책을 화면이 베끼는 것이 된다(CLAUDE.md).
>
> `grade` 와 `gateWarn` **둘 다** `describe()` 의 화이트리스트와 `test/conf-schema.test.js`
> 의 필드 목록에 넣는다 — 그 함수는 필드를 골라 복사하는 구조라 안 더하면 CLI 에 안 온다.
> 그리고 **`grade:'gate'` 인데 `gateWarn` 이 비어 있으면 실패하는 시험**을 같은 파일에 둔다.
> `apply:'reload'` 에 `reloadWith` 를 강제하는 검사와 같은 모양이다.

### 2.2.1 `cseBase` 를 바꾸면 무슨 일이 나나

`mobius/cb.js` 가 기동할 때 하는 일은 이렇다.

```
select_ri_lookup('/<이름>')
  ├─ 1건 있으면  →  update_cb_poa_csi   기존 CSEBase 를 그대로 쓴다   rsc 2004
  └─ 없으면      →  insert_cb           새 CSEBase 를 만든다          rsc 2001
```

**이름을 바꿔 띄우면 그 이름의 CSE 로 정상 기동한다.** 오류가 아니라 지원되는 동작이다.

- **빈 DB 에 새 이름으로 처음 시작하면** 그것으로 끝이다 — 옛 데이터가 없다
- **데이터가 있는 DB 에서 바꾸면 경로 조회만 막힌다.** `/새이름/…` 로는 404 다.
  다만 **다음 셋은 경로 접두사를 보지 않는다**

| | 무엇 | 왜 |
|---|---|---|
| ① | **루트 discovery 가 옛 이름 리소스를 돌려준다** | `sql_action.js` 의 `whole_tree` 단축(`ri === root_ri`)이 **부모 제한을 통째로 버린다.** `GET /새이름?fu=1&ty=3` 이 옛 경로를 `uril` 에 그대로 싣는다 |
| ② | **비구조 주소는 이름을 아예 안 본다** | `GET /{sri}` 는 `ri = ? or sri = ?` 라 200 을 돌려준다 |
| ③ | **옛 경로를 `mid` 로 가진 그룹은 멤버를 조용히 건너뛴다** | `fopt.js` 가 `ri.split('/')[1]` 을 `usecsebase` 와 비교해 원격 CSE 로 분류한다 |

- 지워지지 않는다. **이름을 되돌리면 원래대로 돌아온다** — 위 분기가 기존 것을 찾아 재사용한다
- 같은 DB 에 그 이름의 CSE 가 이미 있으면 **그것을 이어받는다**

파괴적이지 않고 되돌릴 수 있다. **다만 절반만 안 보이는 상태가 되므로** 관문 등급이다.
아래가 `cseBase` 의 `gateWarn` 값이다.

```
⚠ cseBase 를 바꾸면 다른 CSE 로 뜬다.
  · 지금 이름으로 만든 리소스는 지워지지 않지만 /새이름/… 경로로는 404 다
  · 그런데 루트 discovery 와 비구조 주소(/{sri})로는 여전히 나온다 — 절반만 가려진다
  · 옛 경로를 mid 로 가진 그룹은 그 멤버를 조용히 건너뛴다
  · 이름을 되돌리면 원래대로 돌아온다
```

**관문은 확인만 받는다. 값이 성립하는지는 `valid` 가 본다**(§2.3).

**빈 DB 에 처음 설치할 때 이름을 정하는 것이 가장 자연스러운 자리**이고, 그래서 §4.5 의
첫 구동 마법사가 이 값을 묻는다.

### 2.3 내리는 키

| 새 conf 키 | 지금 값 | 지금 자리 | group | apply | 등급 | 근거 |
|---|---|---|---|---|---|---|
| `cseBase` | `Mobius` | `usecsebase` | CSE 신원 | restart | **관문** | §2.2.1. **`valid`: `/^[A-Za-z0-9_-]{1,64}$/` 이고 `la`·`latest`·`ol`·`oldest`·`fopt` 는 거부** |
| `cseId` | `/Mobius2` | `usecseid` | CSE 신원 | restart | **관문** | MQTT 알림 토픽·`acpi` 절대표기 접기가 끊긴다 |
| `spId` | `//keti.re.kr` | **`app.js` `usespid`** | CSE 신원 | restart | **관문** | 절대 표기 접기가 안 되면 대상 해석 실패 |
| `releaseVersion` | `2a` | `uservi` | CSE 신원 | runtime | 편집 | `valid` 를 `cb.js` 의 `srv=['1','2','2a']` 로 |
| `mqttBroker` | `localhost` | `use_mqtt_broker` | 네트워크 | restart | 편집 | 남은 소비처는 알림 발행뿐 |
| `mqttPort` | `1883` | `use_mqtt_port` | 네트워크 | restart | 편집 | `useSecure='enable'` 이면 8883 으로 덮인다 |
| `useSecure` | `disable` | `use_secure` | 네트워크 | restart | **관문** | 켜면 MQTT 알림이 mqtts 로 바뀌어 기존 브로커와 끊긴다 |
| `allowedAeIds` | `[]` | `allowed_ae_ids` | 접근 제한 | runtime | **관문** | 비면 전원 허용, 채우면 목록 밖 전부 `403-1` |
| `allowedAppIds` | `[]` | `allowed_app_ids` | 접근 제한 | runtime | **관문** | AE 생성 시 `api` 화이트리스트 |
| `csebaseport` | `7579` | 이미 conf | 네트워크 | restart | **관문** | 등록된 AE 의 `poa` 가 어긋난다. **`exposed: true` 로 연다** |
| 콘솔 6키 | | 스키마 밖 | 콘솔 | restart | 편집 | `adminPassword`·`adminOrigin` 은 **`secret: true` + `exposed: false` 를 함께** |

**`cseBase` 의 `valid` 가 필요한 이유** — 문자열 타입에 `valid` 가 없으면 **빈 문자열도
통과한다.** 빈 값이면 `cb.js` 의 `ri` 가 `'/'` 가 되고 `sql_action.js` 의 `root_ri` 도
`'/'` 가 되어 `whole_tree` 판정이 어긋난다. `/` 가 들어가면 `pi=''` 인 트리와 깊이가 안 맞고,
다섯 예약어는 `app.js` 의 `la`/`ol`/`fopt` 분기와 충돌한다. `validHint` 는
`영문·숫자·_·- 1~64자. la/latest/ol/oldest/fopt 는 쓸 수 없다`.

### 2.4 지우는 키 셋

| 키 | 왜 |
|---|---|
| `hitManPort` | 전역을 세우지만 **읽는 코드가 0건** |
| `sgnManPort` | 똑같다. `4a47c48` 의 보고서가 두 전역을 나란히 고아로 적어 두었다 |
| `adminPm2Name` | `admin/` 이 프로세스 제어를 안 하면 읽는 코드가 없어진다. **그래서 콘솔 키는 6개다** |

> **키를 지울 때는 스키마와 `conf_load` 를 원자적으로 움직인다.**
> `test/conf-schema.test.js` 가 양방향으로 강제하므로 한쪽만 지우면 실패한다.

### 2.5 `csebaseport` 를 열면 기존 시험이 깨진다

지금 `exposed: false` 라 `validate()` 와 `conf_store.isWritable()` 두 관문이 막는다.
열려면 **같은 커밋에서** `test/conf-schema.test.js` 의 거절 목록도 고친다.

```
지금   ['dbpass', 'superUser', 'csebaseport', 'pxyWsPort']  를 거절하는지 검사
바꿈   ['dbpass', 'superUser']                              로 줄이고
       assert(schema.validate('csebaseport','7580').ok === true)  를 더한다
```

그 시험이 지키려는 것은 주석대로 **비밀 키가 저장 경로로 써지지 않는 것**이지 포트가 아니다.
`pxyWsPort` 는 이미 스키마에서 지워져 "노출 대상이 아니다"가 아니라 **"모르는 키다"로 우연히
통과**하고 있어, 검사한다고 말하는 것을 검사하지 않는다.

### 2.6 콘솔 6키는 시험을 **실패시킨다**

키 스캐너는 리더를 둘만 본다 — **코어 소스**(§6 이후 `mobius/conf_load.js`)와 지금 고른
어댑터의 `confSchema()`. 콘솔 6키는 `admin/server.js` 만 읽으므로 어느 쪽에도 안 잡히고,
표에 올리는 순간 **"표에만 있고 아무도 안 읽는 키"** 검사가 여섯을 잡아 실패한다.

**그래서 스캐너에 `admin/server.js` 를 세 번째 리더로 더하는 것이 작업의 일부다.**
코어에 쓰는 것과 같은 주석 제거를 먼저 적용한다 — `adminOrigin` 이 주석에도 나오므로
안 걷으면 산문이 가드를 통과한다.

`spId` 와 달리 **코드를 옮겨서 풀 수 없다.** 콘솔 키를 코어가 읽을 이유가 없다.

### 2.7 `conf_schema` 규약이 요구하는 것

1. **`mobius/conf_load.js` 가 `conf.<키>` 를 실행 코드로 읽어야 한다**(§6 이전에는
   `mobius.js` 였고, 스캐너의 리더도 그때 같이 옮긴다). `app.js` 에서만 읽으면 걸린다 —
   `spId` 를 옮기는 이유다
2. **기본값을 세 가지 작성 모양 중 하나로** 쓴다. `? conf.K : 리터럴;` / `conf.K || 리터럴;` /
   `함수(conf.K, 리터럴)`. 다른 모양이면 `dflt` 대조가 **조용히 건너뛰어진다**
3. **새 group 3개**(`CSE 신원`·`접근 제한`·`콘솔`)를 `KNOWN` 에 넣는다
4. `apply: 'reload'` 인 키는 `reloadWith` 도 반드시 준다
5. **콘솔 키는 §2.6 대로 스캐너를 넓혀야 통과한다**
6. **`secret: true` 를 붙일 때는 `exposed: false` 도 반드시 함께** — §4.3

덤으로 하나 고친다 — `use_mqtt_port = '8883'` 대입은 `global.` 접두가 없는 **암묵 전역
대입**이다(`'use strict'` 가 없어서 동작한다). 명시적으로 바꾼다.

---

## 3. 지금 도는 값 / 파일 값 / 재기동 필요

### 3.1 `apply` 는 파일을 고치는 것과 다른 얘기다

`apply` 의 "값"은 **`global.*`** 이지 `conf.json` 이 아니다. 코어는 기동 때 한 번 파일을
읽어 전역에 심고 그 뒤로는 다시 안 본다. **CLI 도 웹도 파일만 고친다.** 그래서
`apply: 'runtime'` 인 키도 **재기동해야 반영된다.**

유일한 예외가 오히려 더 나쁘다 — `cluster.fork()` 가 코어를 다시 실행하므로 **죽었다
되살아난 워커만** 새 값을 읽는다.

### 3.2 부팅 기록 — `log/mobius-boot.jsonl`

```jsonl
{"role":"master","pid":8812,"at":"…","supervised":true,"cap":75,"confPath":"/home/keti/Mobius/conf.json","conf":{…}}
{"role":"worker","pid":8840,"at":"…","supervised":true,"conf":{…}}
```

**값은 어떻게 모으나 — 대응표를 만들지 않는다.**

conf 키와 전역 이름은 하나도 안 겹치고 규칙 변환으로도 못 만든다
(`maxBodyBytes`→`max_body_bytes`, `csebaseport`→`usecsebaseport`,
`defaultAccessPolicy`→`useaccesscontrolpolicy`). 손 목록을 만들면 새 키가 빠졌을 때
`undefined` 가 기록돼 그 키가 **영구히 "재기동 대기"** 로 뜬다.

그래서 **`conf_load` 가 전역을 세우면서 같은 자리에서 `applied[<conf 키>] = <방금 심은 값>`
을 함께 쌓고**, 마지막에 `boot_record.write(applied)` 로 넘긴다.

- **`secret: true` 인 키는 `boot_record` 가 뺀다.** 받은 객체를 `conf_schema` 로 훑어
  거르므로 새 비밀 키가 생겨도 자동으로 빠진다
- **코어가 전역을 안 세우는 키는 기록 대상이 아니다** — 콘솔 6키가 여기 해당한다
- **`confPath` 를 함께 남긴다** — 마스터가 실제로 읽은 `conf.json` 의 절대 경로.
  CLI 가 다른 파일을 보고 있으면 그것을 알 수 있어야 한다

**파일 자리와 만들기**

- 경로는 **저장소 루트 기준**이다 — `conf.json` 과 같다(§4.0)
- **`boot_record` 가 `log/` 를 없으면 만든다**(`recursive: true`). 지금 만드는 코드는
  `app.js` 안에 있는데 기록은 그보다 **앞**에서 쓰므로, 새로 설치한 서버의 첫 기동이
  ENOENT 로 죽는다
- 인코딩 utf8, 개행 `\n`

**마스터가 비우고 전원이 append 한다.** 마스터가 기록을 쓸 때 파일을 truncate 하므로
파일은 항상 "지금 이 판"만 담는다. 그래서 §5.1 의 시험 바인드가 **이보다 앞**이어야 한다 —
순서를 뒤집으면 중복 실행된 인스턴스가 살아 있는 서버의 기록을 비우고 종료한다.

**상한과 `capped`**

- 상한은 **마스터가 정해 `cap` 필드로 기록**한다. 워커가 각자 계산하지 않는다
- 워커는 **append 하기 전에** 줄 수를 세고, 상한 이상이면 자기 줄을 쓰지 않는다
- **상한에 처음 닿은 프로세스만** `{"role":"capped","at":…}` 를 **끝에 한 줄 덧붙인다.**
  파일을 대체하지 않는다 — 마스터 줄이 사라지면 §3.3 의 값 대조가 전 키에서 불가능해진다
- 이미 `capped` 줄이 있으면 아무도 더 쓰지 않는다

상한이 없으면 재포크 루프(§5.1)에서 초당 24줄씩 자라 **하루 수백 MB** 가 된다.
그리고 **`capped` 줄이 곧 좀비 탐지 신호**다.

**기록 쓰기 실패는 기동을 막지 않는다.** 디렉터리 생성·줄 수 세기·append 를 모두
`try/catch` 로 감싸고, 실패하면 사유만 `console.error('[boot_record] 기록 실패: …')` 로
남긴 뒤 **정상 반환한다.** `app.js` 는 디렉터리가 이미 있으면 fs 를 안 건드리므로,
`log/` 가 있으되 쓸 수 없는 배포는 **지금은 뜨는데** 이 스펙대로면 안 뜨게 된다 —
새로 들이는 회귀다.

**`supervised`** — `process.env.pm_id` 유무다. **pm2 를 쓸 때만 참**이므로 systemd·docker
로 띄우면 감독자가 있어도 거짓이다. CLI 는 이 값으로 "감독자가 없다"를 단정하지 않고
**"pm2 로 뜬 것이 아니다"** 까지만 말한다.

### 3.3 판정

**"돌고 있는가"의 판정은 부팅 기록의 마스터 pid 하나로 한다.**

`role:"master"` 줄이 있고 그 pid 가 살아 있을 때만(`process.kill(pid, 0)` 이 던지지 않을 때)
값 대조를 한다. 기록 파일은 서버가 죽어도 남으므로 기록의 존재만으로 단정하면 **죽은 서버의
낡은 기록과 파일을 대조하게 된다** — 그것을 막는 것이 pid 검사다.

**포트와 pm2 는 이 분기에 쓰지 않는다.** 포트는 남이 쥐고 있어도 열려 보이고(§5.1),
pm2 의 `online` 은 §11.6 대로 정상을 뜻하지 않는다. 둘은 **경고**로만 쓴다.

> **포트 안 열림** — 마스터 pid 는 살아 있는데 포트가 닫혀 있다. 기동 중이거나 listen 에
> 실패한 상태다.

| 상태 | 조건 |
|---|---|
| **적용됨** | 파일 값 = 마스터 기록 값 |
| **재기동 대기** | 파일 값 ≠ 마스터 기록 값 |
| **모름** | 기록 파일이 없거나, 있어도 `role:"master"` 줄의 pid 가 죽어 있음 → **값 대조를 아예 하지 않는다** |
| **대조 대상 아님** | 스키마에는 있는데 기록에 없는 키(콘솔 6키) |

`모름` 을 낼 때는 기록의 `at` 을 함께 보인다 —
`모름 — Mobius 가 떠 있지 않다 (마지막 기동 2026-09-04 04:15, pid 247395 없음)`.

**비교는 정규화한 뒤 한다.**

| 무엇 | 왜 |
|---|---|
| 배열·객체는 `JSON.stringify` 후 비교 | `allowedAeIds` 는 참조가 달라 `===` 가 언제나 거짓이고, `retentionPolicies` 는 **객체가 든 배열**이라 원소별 `===` 로도 언제나 거짓이다 |
| 숫자·문자열은 `String()` 으로 맞춰 | `port_of()` 가 문자열화한다 |
| `mqttPort` 는 `useSecure='enable'` 이면 **유도됨** | 8883 으로 덮이는 것이 정상이다 |

**대조에서 뺀 키는 상태가 아니라 사유를 적는다.** 위 네 상태 중 어느 것도 쓰지 않는다.

```
mqttPort    8883     유도됨 (useSecure=enable · 파일 1883)
```

**정규화로 생기는 불일치는 "재기동 대기"라고 말하지 않는다.** 코어가 유효하지 않은 값을
기본값으로 떨어뜨리는 키들(`acpiAttachPolicy`·`acpAudit`·`acpDiscoveryFilter` 등)은 파일
값이 유효하지 않으면 **재기동해도 적용값이 안 바뀐다.** 그래서 파일 값이 `valid()` 를
통과하지 못하면 `파일 값이 유효하지 않다 (기본값으로 떨어짐)` 으로 적고, 재기동이 아니라
`set` 으로 고치라고 안내한다.

경고 둘:

> **워커 불일치** — 기록의 워커 줄들이 서로 다른 값을 갖고 있다.
>
> **좀비 의심** — 기록에 `capped` 줄이 있다. 재포크 루프다(§5.1).

### 3.4 오류 처리 (CLI 한정)

- **기록 파일이 없거나 마스터 pid 가 죽어 있다** → `모름`. CLI 가 만들지 않는다
- **기록이 깨졌다** → 깨진 줄만 버리고 나머지로 판정. 전부 깨졌으면 `모름`
- **`conf.json` 이 깨졌다** → **덮어쓰지 않는다.** 사유를 말하고 종료.
  **코어는 다르다** — §4.5.1 (라)대로 기본값으로 진행한다

---

## 4. conf CLI — `tools/mobius-conf.js`

### 4.0 파일을 찾는 기준

**`conf.json` 은 저장소 루트 기준이다**(`__dirname` 에서 올라간다). `log/mobius-boot.jsonl`
도 같다.

> **지금 코어는 cwd 기준이다.** `mobius.js` 가 베어 `'conf.json'` 을 쓴다.
> **이 작업에서 루트 기준으로 바꾼다 — §9 1단계, `conf_load` 를 뺄 때 같이 한다.**
> `admin/server.js` 가 이미 루트 기준이므로 코어·CLI·콘솔 셋이 같아진다.
>
> **배포 반영 전에 `pm2 describe Mobius` 의 `pm_cwd` 가 저장소 루트인지 확인한다** —
> 다르면 지금 쓰이던 파일이 루트 밖에 있고, 그 파일은 재현이 안 되므로 옮기기 전에 백업한다.

### 4.1 명령과 npm 스크립트

```
mobius-conf                    전체 목록 — 카테고리별 · 현재값 · 3상태
mobius-conf <키>               단건 상세
mobius-conf set <키> <값>      변경
mobius-conf unset <키>         기본값으로 되돌린다
mobius-conf status             마스터 pid · 포트 · 부팅 기록 · 재기동 대기 건수
```

```json
"start"  : "node mobius.js",
"setup"  : "node tools/setup.js",
"conf"   : "node tools/mobius-conf.js",
"status" : "node tools/mobius-conf.js status",
"test"   : "node --test test/*.test.js"
```

### 4.2 조회

값을 세 곳에서 합친다 — `conf_schema`(선언) · `conf.json`(파일 값) · 부팅 기록(도는 값).
**키 목록 자체가 `global.usedb` 에 달려 있다** — §1.4 의 순서를 지킨다.

```
$ npm run conf

CSE 신원
  cseBase              Mobius              적용됨      ⚠ 관문
  cseId                /Mobius2            적용됨      ⚠ 관문
  spId                 //keti.re.kr        적용됨      ⚠ 관문
  releaseVersion       2a                  적용됨

네트워크
  csebaseport          7579                적용됨      ⚠ 관문
  mqttBroker           localhost           적용됨
  mqttPort             8883                유도됨 (useSecure=enable · 파일 1883)
  useSecure            enable              적용됨      ⚠ 관문

저장소
  db                   mysql               적용됨
  dbConnectionLimit    25                  ● 재기동 대기 (파일 25 / 도는 값 100)
  ...

콘솔                                       — 대조 대상 아님 (코어가 안 읽는다)
  adminPort            7580
  ...

비밀 — 값을 띄우지 않는다
  dbpass               설정됨
  superUser            없음 (기본값 사용)
  adminPassword        설정됨
  adminOrigin          없음 (superUser 로 떨어진다)

● 재기동 대기 1건.  반영하려면 Mobius 를 다시 띄운다.
```

단건 조회는 스키마가 가진 것을 다 보여 준다. `apply` 가 `runtime` 이든 `reload` 든
**CLI 관점에서는 전부 "재기동"** 이다(§3.1).

### 4.3 변경

```
1. 타입 변환     명령줄은 전부 문자열이다                        ← 새로 짠다
2. validate()    conf_store.validate() → conf_schema.validate()
3. 등급 확인     describe()[키].grade === 'gate' 면
                 gateWarn 을 그대로 찍고 키 이름 타이핑          ← 새로 짠다
4. 원자적 쓰기   conf_store.update() / removeKey()
5. 안내          "재기동해야 반영된다"
```

**2·4번은 대부분 이미 있는 코드다.** `conf_store` 의 주석이 그 성질을 명시한다 —
*"하나라도 틀리면 아무것도 쓰지 않는다"*, *"모르는 키는 그대로 둔다"*.

**타입 변환 규칙**

| type | 규칙 |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` 에 맞을 때만 `Number()`. **빈 문자열·`"20MB"` 는 거부** — `Number('')===0` 이고 `dbQueueLimit` 의 0 은 "타임아웃 없는 무제한 대기열"이다 |
| `array` | 쉼표로 나누고 각 원소를 `trim()`. 빈 문자열이면 `[]` |
| `enum`·`string` | 그대로 |

**관문의 입출력 계약**

- 확인 입력은 **stdin 에서 읽는다**
- **TTY 가 아니거나 EOF 면 거부한다.** 통과가 아니다
- **비대화형에서 통과시키는 수단(`--yes`)을 두지 않는다**
- 거부하면 **파일을 건드리지 않고** 종료 코드 1

**비밀 키는 조회만 한다.** 대상은 **`conf_schema` 에서 `secret: true` 인 키**다 — 지금은
`dbpass`·`superUser`·`adminPassword`·`adminOrigin` 넷이지만 목록을 하드코딩하지 않는다.

> **거부 근거는 `secret` 이 아니라 `exposed === false` 다.** `validate()` 의 실제 관문이
> 그것이고 `secret` 은 보지 않는다. **`secret: true` 만 붙이고 `exposed: false` 를 빠뜨린
> 키는 그냥 써진다.** `adminOrigin` 은 콘솔의 CSE 쓰기 권한을 정하는 값이라 그 구멍이 곧
> 권한이다. 그래서 **둘이 어긋난 키가 0건인지를 전수로 보는 시험**을 둔다(C6).

**`unset` 은 새 API 가 필요하다.** `conf_store` 의 쓰기 API 는 `update(patch)` 하나이고
내부가 대입뿐이다. `removeKey(key)` 를 더하되 **`isWritable()` 을 같은 자리에서 지나게**
한다 — 값 없는 경로로 짜면 유일한 관문을 우회해 `unset dbpass` 가 통한다.

### 4.4 `status`

```
$ npm run status
Mobius     돌고 있다 · 마스터 pid 247395 살아 있음 · 포트 7579 열림
기동       2026-09-04 04:15 · 워커 24
감독       pm2 online · 재시작 13회
설정       재기동 대기 1건  (dbConnectionLimit)
```

- **"돌고 있다"의 근거는 마스터 pid 이고 포트는 부가 정보다.** pid 는 살아 있는데 포트가
  닫혀 있으면 그 줄에 경고를 붙인다(§3.3)
- **pm2 를 못 찾거나 목록에 없으면** `감독` 줄의 문구만 바뀐다 — `supervised: true` 면
  "pm2 로 떴으나 지금 목록에서 찾지 못함", 거짓이면 "pm2 로 뜬 것이 아니다"
- **어느 pm2 앱이 Mobius 인지는 이름이 아니라 pid 로 고른다.** 배포 데몬에 앱이 17개인데
  이름을 들고 있던 `adminPm2Name` 은 §7 에서 지운다. `jlist` 의 `pid` 와 **부팅 기록의
  마스터 pid** 를 대조한다 — Mobius 는 `fork_mode` 라 pm2 가 보는 pid 가 곧 마스터 pid 다
- **워커 수는 `role:"worker"` 줄 수가 아니다.** 그 값은 이 판에서 기동된 워커의 **누적
  수**이고 재포크가 늘린다. 마스터 줄에 `workers` 를 함께 기록하고 그것을 쓴다

### 4.5 첫 구동 설정 — `npm run setup`

`conf.json` 이 없으면 첫 설치다. 지금은 코어가 세 키로 파일을 만들고 진행하는데,
**`dbpass` 기본값이 소스에 박힌 값이라 대부분 안 맞아** DB 연결에서 실패한다.

> **마법사의 로드 순서는 §1.4 와 다르다 — 1번이 없기 때문이다.**
>
> ```
> 1. require('./mobius/db').backends() 만 먼저 부른다
> 2. 답을 받아 global.usedb = 고른 이름;
> 3. 그 뒤에야 mobius/conf_schema 와 tools/conf_store 를 require 한다
> ```
>
> **1번은 `backends()` 여야 한다. `conf_schema.choices('db')` 로 대체하지 마라.**
> `backends()` 는 어댑터 목록만 돌려주고 `pick()` 을 부르지 않는다. 굳으면 둘이 동시에
> 깨진다 — (1) 표가 mysql 로 남아 sqlite 설치에서 `dbpass` 가 유효 키로 보이고 `sqlite*`
> 3키가 "모르는 키"가 된다, (2) 파사드 캐시 때문에 **마스터에서 도는 보존 정책 스윕만
> 다른 DB 를 본다.**

**마법사가 읽고 쓰는 `conf.json` 의 자리는 하나다** — §4.0 의 저장소 루트 기준이다.

```
Mobius 첫 설정입니다.

  DB              [1] mysql  [2] sqlite          > 1
  DB 비밀번호     (화면에 안 보입니다)             > ********
  CSE 이름        Mobius                          > Vita
  CSE ID          /Mobius2                        > ⏎
  SP-ID           //keti.re.kr                    > //example.com
  HTTP 포트       7579                            > ⏎

conf.json 을 만들었습니다.  나머지 설정은 `npm run conf` 로 봅니다.
```

**묻는 것은 일곱뿐이다.** `dbpass` 는 `db` 가 `mysql` 일 때만 묻는다. `superUser` 는 SP-ID 다음에 화면에 안 보이게 묻고 비우면 `Sponde` 다(2026-09-05 사용자 요청으로 추가).
**각 입력은 `conf_schema.validate()` 를 그대로 지난다** — 통과하지 못하면 `validHint` 를
보여 주고 같은 항목을 다시 묻는다. 손으로 만든 별도 검사를 두지 않는다.

**바꾸기 어려운 것을 처음에 묻는다.** `cseBase`·`cseId`·`spId`·`csebaseport` 넷이 관문
등급이다.

**비밀번호는 평문으로 저장한다**(§12). 대신 **입력할 때 화면에 안 보이게** 한다.

> **마스킹은 `readline` 단독으로 안 된다.** 에코를 끄는 공개 API 가 없으므로
> `stream.Writable`(역시 내장)로 출력 프록시를 만들어 `output` 으로 주고 `terminal: true`
> 로 인터페이스를 연 뒤, **`rl.question()` 을 부른 직후에** 음소거를 켠다 — 프롬프트가
> 먼저 나가야 한다. 거꾸로 하면 프롬프트까지 삼켜 사용자가 빈 화면 앞에 앉는다. 답을
> 받으면 음소거를 끄고 개행을 직접 쓴다 — 에코가 꺼져 있으면 Enter 도 안 찍힌다.
> 비공개 API(`rl._writeToOutput`)를 덮는 방식은 쓰지 않는다.

**비밀번호를 다시 넣는 길**

```
npm run setup                 conf.json 이 없을 때만
npm run setup -- --dbpass     비밀번호만 다시 받는다 (파일이 있어도)
npm run setup -- --superuser  수퍼유저 Origin 만 다시 받는다 (파일이 있어도 · 2026-09-05 추가)
```

이 둘이 §4.3 의 "비밀 키는 CLI 로 변경 불가"의 **유일한 예외**다. 명령줄 인자로 값을 받지
않고 **프롬프트로만** 받으므로 셸 히스토리에 안 남는다.

### 4.5.1 지키는 것 — 조건과 행동

| | 조건 | **무엇을 한다** |
|---|---|---|
| **(가)** | `process.stdin.isTTY && process.stdout.isTTY` 가 참이 아니다 | **`conf.json` 을 만들지 않는다.** `conf_load` 는 `callback(err)` 로 돌려주고 **종료는 `mobius.js` 가** 한다 |
| **(나)** | 워커다 (`cluster.isPrimary` 가 거짓) | **묻지 않는다.** `conf.json` 이 없으면 `callback(err)` |
| **(나)** | 마스터인데 파일 생성 실패 또는 취소 | **`require('./app')` 을 하지 않는다** — cluster 를 만들지 않고 종료 |
| **(다)** | 프롬프트가 비동기다 | `conf_load` 가 콜백을 받는다 |
| **(라)** | `conf.json` 이 있으나 **파싱이 깨졌다** | **아무것도 바꾸지 않는다.** 오늘처럼 로그를 남기고 기본값으로 진행한다 |
| **(마)** | 프롬프트를 열었다 | **성공·취소·EOF·오류 어느 경로에서도 `rl.close()` 를 지난다** |

**(가) — 파일을 만들지 않는 것이 핵심이다.**

```
[설정 없음] conf.json 이 없고 대화형 터미널이 아니다.
            터미널에서 `node mobius.js` 를 한 번 실행하면 설정을 묻고 만든다 (또는 `npm run setup`).
```

(안내 문구는 2026-09-05 에 `node mobius.js` 를 앞세우도록 바꿨다 — 사용자 의도가 "별도 명령이 아니라
첫 기동이 자동으로 만든다" 이므로, `npm run setup` 은 대안으로만 적는다.)

**지금 동작(기본값으로 만들고 진행)을 바꾸는 것이다.** 만들어 두면 다음 기동에 마법사가
안 돌고, `dbpass` 가 소스 기본값이라 DB 연결에서 실패한다 — 원인이 두 단계 멀어진다.

`stdin` 과 `stdout` 을 **둘 다** 본다. `stdin` 만 보면 `npm start > log` 를 놓친다 —
입력은 받는데 **무엇을 묻는지가 파일로 가서** 사람은 빈 화면 앞에 앉는다.
**Ctrl-D(EOF)도 취소로 본다.**

**대화형 터미널이면 `node mobius.js` 자신이 마법사를 돌린다.** 위 안내문은 **비-TTY 일
때만** 나온다.

**(나) — 실패하면 fork 에 도달하지 않는다.**

`cluster.fork()` 가 코어를 처음부터 다시 실행하고, **워커는 부모의 stdio 를 상속하므로
마스터가 TTY 면 워커도 TTY 다** — (가)로는 못 막는다.

**워커는 전용 종료 코드로 나간다.** `1` 은 `backstop` 과 `fail_start` 가 이미 쓰므로
§5.1 과 같은 이유로 쓸 수 없다.

```js
var EXIT_NO_CONF = 13;   // app.js 상단, EXIT_PORT_TAKEN 옆에 선언
```

- 콜백은 `process.exit(cluster.isPrimary ? 1 : EXIT_NO_CONF)` 다
- **마스터 분기는 §5.1 과 같은 자리, 같은 모양이다** — `cluster.on('exit')` 의
  `exitedAfterDisconnect` 조기 반환 **뒤**, 재포크 `setTimeout` **앞**에서
  `code === EXIT_NO_CONF` 를 잡아 안내를 찍고 **재포크하지 않고 마스터도 종료**한다
- 도달 경로는 운영 중 `conf.json` 을 지우거나 옮긴 경우다

**(다) — 기동 순서**

```js
conf_load(function (err, applied) {
    if (err) { console.error('[설정] ' + err.message);
               process.exit(cluster.isPrimary ? 1 : EXIT_NO_CONF); return; }
    if (cluster.isPrimary && !port_free(applied.csebaseport)) {
        console.error('[포트] ' + applied.csebaseport + ' 을 이미 누가 쥐고 있다.');
        process.exit(EXIT_PORT_TAKEN);   // 기록보다 앞이다 — §5.1 (가)
    }
    boot_record.write(applied);          // 던지지 않는다 — §3.2. 마스터는 여기서 파일을 비운다
    require('./app');                    // 실패하면 여기에 도달하지 않는다 — (나)
});
```

**시험 바인드가 `boot_record.write` 보다 앞인 것이 규칙이다**(§5.1 (가)).

**(라) — "없다"와 "깨졌다"는 계속 갈린다.**

(가)가 뒤집는 것은 **"없다" 쪽 하나뿐이다.** 지금 코어의 catch 가 그대로 `conf_load` 로
옮겨간다 — 읽기 실패를 쓰기로 갚지 않는다. 근거는 그 주석의 실측이다(반쪽 파일을 한 번
읽힌 뒤 운영 키 8개가 3개로 줄고 `dbpass` 가 하드코딩 기본값이 되었으며 `adminPassword`
소실로 콘솔도 못 떴다). 워커 24개가 각자 이 파일을 읽으므로 종료로 바꾸면 누군가 제자리에서
파일을 쓰는 동안 재포크된 워커가 **전부 기동에 실패한다.**

**§3.4 의 "종료"는 CLI 에만 해당한다.**

**(마) — 터미널을 되돌린다.**

`terminal: true` 는 TTY stdin 을 raw 모드에 넣는다. 마법사는 종료하지 않고 같은 프로세스에서
`require('./app')` 으로 이어지므로, close 를 못 지나면 **뒤이어 뜬 서버가 raw 상태의 stdin
을 물려받아 Ctrl-C 가 안 먹는다.**

### 4.5.2 마법사가 쓸 API 를 `conf_store` 에 더한다

**지금 `conf_store` 로는 마법사가 파일을 못 만든다** — `update()` 는 `_read()` 때문에
파일이 없으면 던지고, `isWritable()` 이 마법사가 반드시 써야 하는 `dbpass`·`csebaseport`
를 거부한다. 그래서 **관문을 우회하는 예외 API 둘**을 더한다. `update()` 를 우회하는 것은
이 둘뿐이고, 그 사실과 화이트리스트를 파일 주석에 적는다.

**`create(obj)`** — 파일이 **없을 때만** 동작한다. 존재 확인과 쓰기 사이의 경합은 `rename`
대신 **`wx` 플래그 쓰기**로 막는다. `isWritable()` 대신 **마법사가 묻는 여섯으로 고정한
화이트리스트**(`db`·`dbpass`·`cseBase`·`cseId`·`spId`·`csebaseport`)로 거르고, 밖의 키가
하나라도 있으면 거부한다. 값은 `validate()` 의 **타입·유효값 검사만** 지난다.

**`setSecret(key, value)`** — `--dbpass`·`--superuser` 전용. 대상 키를 **`dbpass`·`superUser` 둘로 못박고** 다른
키는 거부한다. 파일이 있어야 하며 `_read()` → 그 키만 변경 → 원자적 쓰기.

### 4.6 오류 처리

- **`conf.json` 이 없다** → 읽기는 전부 기본값으로 답한다. **`set`/`unset` 은 거부하고 `npm run setup` 을 안내한다** — 부분 파일을 만들면 다음 기동에 마법사가 안 돈다(§4.5.1 가). (7판까지는 "쓰기만 파일을 만든다" 였다 — 2026-09-05 구현 리뷰에서 §4.5.1 과 충돌해 바꿨다)
- **`conf.json` 이 깨졌다** → CLI 는 덮어쓰지 않고 종료. **코어는 §4.5.1 (라)**
- **부팅 기록이 없거나 마스터 pid 가 죽어 있다** → `모름`. **포트가 닫힌 것만으로는
  `모름` 으로 가지 않는다**
- **pm2 가 없다** → `감독` 줄의 문구만 바뀐다

---

## 5. 코어 결함 둘

### 5.1 포트 충돌이 좀비를 만든다

이미 포트를 누가 쥔 상태에서 또 띄우면(§11.6): 워커가 `EADDRINUSE` 로 uncaught 를 던지고,
`backstop` 이 워커만 죽이고, 마스터가 1초 뒤 재포크해 **무한 반복**한다. 실측 12초에 워커
사망 20회 이상. **pm2 는 마스터가 안 죽으니 `online`·재시작 0 으로 본다.**

`fail_start` 는 이걸 안 잡는다 — 호출부 6곳이 전부 **DB 연결 실패 경로**다.

**(가) 기동 전 시험 바인드 — 마스터가 한 번만**

- 자리는 `require('./app')` **앞**, **부팅 기록을 쓰기 전**, `cluster.isPrimary` 일 때만
- **워커가 각자 하면 안 된다.** cluster 는 리스닝 소켓을 마스터가 만들어 넘기므로 두 번째
  워커부터 **자기 인스턴스가 연 포트**를 점유자로 보고 거부한다 → 워커 1개짜리 서버가 되고
  포트는 열려 있어 겉으로 정상이다
- 방법은 connect 탐침이 아니라 **시험 바인드**다. **`host` 를 주지 않는다** — 실제 `listen`
  이 와일드카드에 바인드하므로 같은 주소를 봐야 한다
- **거부할 때 기록 파일을 손대지 않는다**

**(나) `listen` 의 `.on('error')` — 네 곳 전부**

`.listen(` 은 **네 곳**이다(워커 http·워커 https·단일 http·단일 https). `use_secure` 로
갈리는 둘 다 살아 있으므로 하나만 고치면 https 배포에서 좀비가 남는다.

```js
var EXIT_PORT_TAKEN = 12;   // app.js 상단에 한 번만 선언
```

- **핸들러는 `err.code === 'EADDRINUSE'` 일 때만** 이 코드로 나간다. 그 밖의 listen
  오류(`EACCES`·`EADDRNOTAVAIL`)는 **다시 던져 지금처럼 `backstop` 에 맡긴다** — backstop 은
  워커만 죽이고 마스터를 살린다. 포트 점유가 아닌데 마스터 분기가 발화하면 없애려던 좀비보다
  나쁜 상태가 된다
- **1 은 쓸 수 없다.** `backstop` 과 `fail_start` 가 이미 쓰고 있어, 1 을 고르면 **DB 가
  몇 초 늦어 죽은 워커에도 마스터가 자살한다**
- 워커는 `backstop.exitAfterFlush(EXIT_PORT_TAKEN)` 으로 나간다
- **`fail_start()` 를 쓰지 않는다.** 그 3초 지연은 DB 가 늦게 뜨는 경우의 재시도 주기다
- **마스터 분기**는 `exitedAfterDisconnect` 조기 반환 **뒤**, 재포크 `setTimeout` **앞**.
  안내를 찍고 **마스터도 같은 코드로 즉시 종료**한다

> 이 분기를 넣으면 `test/cluster-respawn.test.js` 의 핸들러 추출 정규식 상한이 먼저 깨진다.
> 같이 올린다. (재포크 지연은 1초다 — 3초가 아니다.)

### 5.2 `windowsHide` 한 줄

```js
cluster.setupPrimary({ windowsHide: true });   // fork 루프 앞. Linux 에서는 무시된다
```

**터미널에서 직접 띄우면 워커가 부모 콘솔을 상속해 창이 안 뜬다.** 창은 pm2 처럼 콘솔 없는
부모가 띄울 때만 생긴다(§11.1). 전제 조건이 아니라 **넣어 두는 게 싼 것**이다.

---

## 6. `conf` 로딩을 코어 모듈로 뺀다

시험 C1 — "빈 `conf.json` 으로도 지금 동작이 그대로다" — 를 **지금 구조에서는 실행할 수
없다.** `mobius.js` 의 마지막 줄이 `require('./app')` 이고, `app.js` 는 로드만으로 DB 에
붙고 CPU 코어 수만큼 fork 하고 포트를 연다.

```
mobius/conf_load.js    conf.json 을 읽고 global.* 을 세우고 applied 를 돌려준다
                       conf_load(opts, callback)  ·  opts 는 생략할 수 있다
                         opts.file         읽을 conf.json 경로 (기본: §4.0 의 저장소 루트)
                         opts.interactive  마법사를 돌려도 되는가 (기본 true)
mobius.js              conf_load(function (err, applied) { … })
```

- **`conf_load` 는 어떤 경로에서도 프로세스를 끝내지 않는다.** 실패는 전부 `callback(err)`
  로 돌려주고 `process.exit` 은 `mobius.js` 만 한다 — 모듈이 exit 하면 평면 글롭으로 도는
  67개 시험 파일이 **통째로 죽는다**
- 시험은 임시 디렉터리에 `{}` 만 담은 파일을 만들어 `opts.file` 로 넘긴다.
  **cwd 를 바꾸지 않는다** — 저장소 루트에는 실제 `conf.json` 이 있다
- **`opts.file` 이 가리키는 파일이 없을 때 만들지 않는 것**도 계약이다. 지금의 기본값
  생성은 인자 없는 기본 경로에서만 유지한다
- 환경 변수를 늘리지 않는다

---

## 7. 웹에서 걷어낼 것

**화면은 새로 만들지 않는다.** 한 커밋에 한다.

| 무엇 | 자리 |
|---|---|
| `conf` 조회·저장 라우트 | `admin/server.js` |
| 프로세스 제어 라우트 **4개** | `GET /api/server/status` · `POST .../start` · `stop` · `restart` |
| `require('./process_ctl')` 과 `ctl` 인스턴스 생성부 | `admin/server.js` |
| 설정 화면 · 서버 제어 컴포넌트 | `ConfView.vue` · `ServerControl.vue` 삭제 |
| **`App.vue`** — import · `Tab` 유니온의 `'conf'` · `TABS` · 렌더 분기 | 넷 다 |
| **`api.ts`** — 서버 제어 4함수 · `CtlResult` · `confView`/`confSave` | |
| **`types.ts`** — `ServerStatus` · `ConfView` 등 | |
| detached spawn | `admin/process_ctl.js` 삭제 (딸린 시험 10건 포함) |
| conf 파일 계층 | `admin/conf_store.js` → `tools/conf_store.js` 로 **이동** |
| CSE 신원 하드코딩 **세 줄** | `admin/server.js` — §7.1 |

> **프런트 세 파일을 안 건드리면 TypeScript 빌드가 깨진다.**

**`process_ctl.js` 에서 건져 올 것이 있다** — `status` 가 쓸 포트 프로브와 pm2 탐지가
그 안에 있다. 지우기 전에 `tools/mobius-conf.js` 로 옮긴다.

남는 웹 화면은 **6개**다.

### 7.1 콘솔의 CSE 신원 하드코딩 — 지우는 게 아니라 옮긴다

`admin/server.js` 는 `usecsebase`·`usecseid`·`usespid` **세 줄**을 박아 두었다. 안 세우면
`sql_action.fold_acpi_entry` 가 ReferenceError 를 내고, **값이 틀리면 절대 표기를 못 접어
ACP 삭제 영향 분석이 "참조 없음"으로 조용히 오판한다.** §2.3 이 `cseId`·`spId` 를 관문
등급으로 열어 CLI 로 바꿀 수 있게 하므로 **세 줄 모두 `conf` 에서 읽도록** 바꾼다.

---

## 8. 시험 계약

번호는 절별 접두를 쓴다 — **C**(코어) · **L**(CLI) · **W**(마법사) · **A**(웹).

### 8.0 먼저 고쳐야 하는 기존 시험

| 시험 | 왜 |
|---|---|
| `test/conf-schema.test.js` | **키 스캐너와 기본값 대조의 리더를 `mobius.js` → `mobius/conf_load.js` 로 바꾼다**(§6). 세 검사(키 스캐너·"파싱 실패가 conf.json 을 덮어쓰지 않는다"·"표의 dflt 와 기본값이 같다")가 전부 그 파일을 읽는다. **같은 커밋에 안 고치면 역방향 검사가 코어 키 전부에서 실패한다** · 스캐너에 `admin/server.js` 추가(§2.6) · 거절 목록 수정(§2.5) · `KNOWN` group 3개 · `describe()` 필드 목록에 `grade`·`gateWarn` |
| `test/db-adapter-contract.test.js` | **`mobius.js` 소스**에서 `global.usedb =` 를 찾고, 같은 소스에서 `global.usesqlite =`·`conf.usesqlite` 부재를 본다. **세 단정의 대상 파일을 `conf_load.js` 로 바꾼다** |
| `test/admin-conf-store.test.js` | require 경로·파일 이름이 `tools/` 로 바뀐다 |
| `test/admin-process-ctl.test.js` | 10건 전부 §7 과 함께 삭제 |
| `test/cluster-respawn.test.js` | 핸들러 추출 정규식 상한(§5.1) |
| `test/usesqlite-single-reader.test.js` | `KNOWN_NAME_SITES` 가 **줄 번호**로 허용하고 파일 이름도 든다. `mobius.js` → `conf_load.js` 이사와 줄 밀림 둘 다 걸린다 |

> **`db-adapter-contract` 의 부재 단정은 실패로 드러나지 않는다.** 얇아진 `mobius.js` 에
> 대해 `global.usesqlite =` 가 없다는 검사는 **조용히 통과한다**(빈 파일도 통과). 대상
> 파일을 함께 옮기지 않으면 "선택자는 이름 하나"를 지키던 가드가 **실패 없이 사라진다.**

### 8.1 코어

**C1 빈 `conf.json` 으로도 지금 동작이 그대로다** ← 배포 안전의 핵심
임시 디렉터리에 `{}` 만 담은 파일을 만들고 그 경로를 `conf_load({file: …}, cb)` 에 넘겨
전역을 확인한다. **저장소 루트의 실제 `conf.json` 을 읽으면 이 시험은 거짓말을 한다.**

```
usecsebase 'Mobius' · usecseid '/Mobius2' · usespid '//keti.re.kr'
use_mqtt_broker 'localhost' · use_secure 'disable' · use_mqtt_port '1883'
uservi '2a' · allowed_ae_ids [] · allowed_app_ids []
```

**C2 `spId` 를 `conf_load` 가 세우고, 콘솔은 세 줄 다 conf 에서 읽는다**

**C3 `useSecure='enable'` 이면 `mqttPort` 가 8883 이 된다**

**C4 키 표가 백엔드를 따라간다** — `db:'sqlite'` 면 `sqlite*` 3키가 나오고 `dbpass` 는
안 나오는가. **하위 명령을 붙여서도 돌린다** — `conf -- status` 와 `conf -- set <키> <값>`
이 sqlite 표를 쓰는가. `argv[2]` 를 백엔드로 읽으면 여기서 실패한다

**C5 콘솔 키의 리더가 스캐너에 잡힌다** — `admin/server.js` 실행 코드에서 `adminPassword`
를 지우면 역방향 검사가 실제로 실패하는가(주석에만 남은 이름이 통과하지 않는지)

**C6 `secret` 과 `exposed` 가 어긋난 키가 0건이다** — `all()` 을 **전수로** 훑어
`secret === true` 인데 `exposed !== false` 인 키가 없는지. **키 이름을 하드코딩하지 않는다**

**C7 부팅 기록** — 마스터가 비우고 워커가 append / `secret` 키가 안 들어간다(새 비밀 키를
더해도 자동으로 빠지는지) / 값이 실제 전역 값 / `confPath`·`supervised`·`workers` /
**`log/` 를 만들 수도 쓸 수도 없을 때 던지지 않고 서버가 그대로 뜨는지**

**C8 상한과 `capped`** — 끝에 한 줄만 덧붙고 마스터 줄이 남아 있는지. 이미 있으면 더 안 쓰는지

**C9 포트 충돌이 좀비를 만들지 않는다** — 포트를 잡아 두고 띄웠을 때 마스터가 재포크하지
않고 `EXIT_PORT_TAKEN` 으로 종료하는지. 시험 바인드가 마스터에서만 도는지.
**`EADDRINUSE` 가 아닌 listen 오류(`EACCES`)에서는 워커만 죽고 마스터는 재포크를 잇는지**

**C10 `conf.json` 이 사라진 워커가 재포크 루프를 만들지 않는다** — 마스터를 띄운 뒤
`conf.json` 을 지우고 워커를 죽였을 때 마스터가 다시 fork 하지 않고 `EXIT_NO_CONF` 로 종료하는지

**C11 깨진 `conf.json` 을 코어가 덮어쓰지도 종료하지도 않는다** — 반쪽 JSON 을 놓고
`conf_load` 를 부르면 기본값으로 진행하고 파일이 그대로인지

**C12 `windowsHide` 가 fork 앞에 있다** — **주석을 걷어낸 뒤** 소스를 검사한다.
`test/admin-process-ctl.test.js` 가 머리말 주석만으로 통과한 전례가 있다

**C13 `cseBase` 유효성** — 빈 값·`Mo/bius`·`la`·`fopt`·65자가 `validate` 에서 거부되는지

### 8.2 CLI

**L1 조회가 3상태를 낸다** — 시험 입력에 **「포트는 열려 있지만 마스터 pid 가 죽은 기록」과
「마스터 pid 는 살아 있지만 포트가 닫힌 상태」를 둘 다** 넣어, 앞의 것이 `적용됨` 을 내지
않고 뒤의 것이 `모름` 을 내지 않는지. 콘솔 키는 `대조 대상 아님`

**L2 비교가 정규화된다** — `retentionPolicies` 처럼 **객체가 든 배열**이 내용이 같으면
`적용됨` 으로 나오는지. `mqttPort` 가 `유도됨` 으로 빠지는지. 파일 값이 `valid()` 를 통과
못 하면 `재기동 대기` 가 아니라 `파일 값이 유효하지 않다` 로 나오는지

**L3 타입 변환** — `number` 키에 `""`·`"20MB"` 를 주면 **거부**하는지. `array` 의 쉼표·공백

**L4 `set` 이 `validate()` 를 지난다** — 모르는 키·읽기 전용·유효값 밖·**`exposed:false`**
넷이 거부되는지. **`secret` 은 거부 근거가 아니다** — 그 정합은 C6 이 본다

**L5 `unset` 이 관문을 지난다** — `unset dbpass` 가 거부되는지

**L6 관문의 입출력 계약** — TTY 가 아니거나 EOF 면 **거부**하고 파일을 안 건드리는지.
문구가 **`gateWarn` 에서** 오는지(CLI 에 하드코딩이 없는지)

**L7 `status` 가 pm2 없이도 동작한다** — `감독` 줄의 문구만 바뀌는지. pm2 앱을 **pid 로**
고르는지

### 8.3 마법사

**W1 비대화형에서 파일을 만들지 않고 종료한다** — 파이프로 실행했을 때 (1) 매달리지 않고
(2) **`conf.json` 이 안 생기고** (3) 종료 코드가 1 인지. **(4) 취소한 뒤
`process.stdin.isRaw` 가 거짓인지**

**W2 마법사가 만든 `conf.json` 이 유효하다** — `db` 선택지가 `backends()` 에서 오는지,
SQLite 를 고르면 `dbpass` 를 안 묻는지, 만든 파일을 `conf_load` 가 그대로 읽는지.
**취소하면 파일이 안 생기는지**(부분 저장 금지)

**W3 `create` 와 `setSecret` 이 화이트리스트를 지킨다** — `create` 가 여섯 밖의 키를
거부하는지, 파일이 있으면 동작하지 않는지. `setSecret` 이 `dbpass` 외의 키를 거부하는지

### 8.4 웹

**A1 conf·프로세스 제어가 웹에서 사라졌다** — 라우트 4개가 없고, `admin/` 어디에도
프로세스를 띄우거나 `conf.json` 에 쓰는 코드가 없는지. **프런트가 빌드되는지**

### 8.5 시험 대역 원칙

**가짜가 실물보다 관대하면 시험이 거짓말을 한다.** 이 저장소는 그걸로 두 번 당했다.

- **부팅 기록 시험은 실제 파일을 쓴다**(임시 디렉터리)
- **관문 확인 입력 대역은 실물처럼 굴어야 한다.** 무조건 통과시키면 L6 이 무의미하다
- 새 시험 파일은 `test/` 아래 아무 이름이나 좋다 — 평면 글롭이다. `admin-` 접두는 떼고
  `conf-` 로 한다

---

## 9. 작업 순서

| | 단계 | 파일 | 시험 |
|---|---|---|---|
| 1 | `conf_load` 분리 + 경로 기준을 루트로 | `mobius/conf_load.js`(신설) · `mobius.js` · **`test/conf-schema.test.js`** · **`test/db-adapter-contract.test.js`** · `test/usesqlite-single-reader.test.js` | C1 + §8.0 |
| 2 | conf 키 9개 내리기 | `conf_schema.js` · `conf_load.js` · `app.js`(spId) | 기존 19 + C2 C3 C13 |
| 3 | 콘솔 6키 + 스캐너 확장 + 죽은 키 셋 + `csebaseport` | `conf_schema.js` · `test/conf-schema.test.js` | C4 C5 C6 |
| 4 | 부팅 기록 | `mobius/boot_record.js`(신설) · `conf_load.js` | C7 C8 |
| 5 | 포트 충돌 + `windowsHide` | `app.js` · `test/cluster-respawn.test.js` | C9 C10 C11 C12 |
| — | **배포 1차** — 코어 반영 + Mobius 재기동 | | 동작 불변 확인 |
| 6 | `conf_write` 분리 + `conf_store.js` 이동 (+ `removeKey`·`create`·`setSecret`) | `mobius/conf_write.js`(신설) · `admin/` → `tools/` | 기존 20 |
| 7 | conf CLI | `tools/mobius-conf.js`(신설) · `package.json` | L1~L7 |
| 8 | 첫 구동 마법사 | `mobius/setup_prompt.js`(신설) · `tools/setup.js`(신설) · `conf_load.js` | W1 W2 W3 |
| 9 | 웹에서 걷어내기 | `admin/server.js` · 뷰 2개 · 프런트 3파일 · `process_ctl.js` | A1 |
| 10 | 문서 갱신 | `CLAUDE.md` · `README.md` · `admin/README.md` | — |
| — | **배포 2차** — CLI 반영 + 웹 재기동 | | |
| 11 | (2차) 사용자/고급 키 · `--all` | `conf_schema.js` · `mobius/db/mysql.js` · `tools/conf_cli.js` · `tools/mobius-conf.js` · 문서 | T1 T2 T3 |
| 12 | (2차) 봉인 | `mobius/conf_seal.js`(신설) · `conf_load.js` · `exit_codes.js` · `mobius.js` · `app.js` · `tools/conf_store.js` · `.gitignore` · 문서 | S1~S6 |
| 13 | (2차) 일괄 편집 | `tools/conf_cli.js` · `tools/mobius-conf.js` · 문서 | E1~E6 |
| — | **배포 3차** — 재기동 전에 `npm run setup -- --superuser`(또는 `--dbpass`)로 봉인을 만든다 | | |

**코어를 먼저 하는 이유**는 CLI 가 코어가 준 것(스키마·부팅 기록)에 의존하고 반대는 아니기
때문이다. 1~5가 배포에 무해하므로 먼저 올려 두면 CLI 작업 중에도 배포가 안전하다.

**1단계가 가장 위험하다.** 파일을 옮기면서 **시험 넷의 대상 파일을 같이 옮겨야** 한다.
안 하면 `npm test` 가 코어 키 전부에서 빨개지고, 그중 하나는 **실패 없이 가드가 사라진다.**

**9단계는 한 커밋에 한다.** 라우트 4개·뷰 2개·프런트 3파일·`process_ctl.js`·CSE 신원 세 줄.

**10단계에서 낡는 문서** — `CLAUDE.md` 의 conf 키 표(개수와 행이 바뀐다) · "환경 변수를 보는
운영 코드는 `MOBIUS_SQLITE_PATH` 하나뿐"(부팅 기록이 `pm_id` 를 본다) · 죽은 키 표 ·
관리 콘솔 모듈 목록. `README.md` 의 실행·설정 예시. `admin/README.md` 의 키 표.
**`CLAUDE.md` 는 `.gitignore` 되어 코드 커밋이 자동으로 안 건드린다.**

### 9.1 각 단계의 "끝났다" 기준

- **1~5** — `npm test` 전건 통과 + **임시 파일 경로를 넘겨** 빈 conf 로 전역이 지금과 같음 +
  포트를 잡아 두고 띄웠을 때 **좀비가 아니라 깨끗한 실패**가 되는 것을 실제로 확인
- **배포 1차** — 재기동 후 `mobius-boot.jsonl` 이 생기고, 응답이 전과 같음
  (`tools/response-golden/headers.js`)
- **6~7** — `npm test` 전건 통과. `npm run conf`·`npm run status` 가 **pm2 없이도** 동작.
  number·array 키를 실제로 고쳐 본다. **SQLite 로도 한 번 조회**해 키 표가 바뀌는지
- **8** — `conf.json` 을 옮겨 두고 `npm start` 로 마법사를 한 번 끝까지 돌려 본다.
  파이프로도 돌려 매달리지 않는지 확인한다
- **9** — 웹이 여전히 뜨고 남은 6화면이 동작. `npm run build` 가 통과
- **배포 2차** — SSH 로 들어가 `npm run conf` → `set` → `pm2 restart Mobius` →
  `적용됨` 으로 바뀌는 것까지 한 번 걸어 봄

---

## 10. 배포 반영

### 10.1 원칙

새 conf 키의 기본값을 지금 하드코딩 값과 같게 두면 배포 `conf.json`(5키)에 아무것도 안 넣어도
동작이 그대로다. `windowsHide` 도 Linux 에서는 무시된다.
**pm2 는 건드리지 않는다.**

### 10.2 순서

1. **`pm2 describe Mobius` 의 `pm_cwd` 를 먼저 확인한다**(§4.0). 저장소 루트가 아니면
   지금 쓰이던 `conf.json` 이 루트 밖에 있다 — **재현이 안 되는 파일이므로 옮기기 전에 백업**
2. **코어를 배포하고 Mobius 를 재기동한다**(`pm2 restart Mobius`). 워커 24개 재기동이라
   순단이 있다. `mobius-boot.jsonl` 은 **새 코어로 재기동해야 생긴다**
3. **CLI 를 배포한다.** 새 의존성이 없으므로 `npm install` 도 필요 없다
4. **웹 정리분을 배포하고 콘솔을 재기동한다.** 배포 `conf.json` 에 `adminPassword` 가 없어
   지금은 콘솔이 안 뜬다 — 넣으려면 **파일을 먼저 백업한다**

### 10.3 조심할 것

**다른 세션과 겹친다.** 이 문서를 쓰는 동안에도 `lite` 가 여러 번 움직였다.
`mobius.js`·`app.js`·`conf_schema.js` 는 다른 사람도 만지고 있으므로 **착수 전에 조율하고,
§2.1 의 수치를 다시 센다.**

**배포 데몬에 앱이 17개고 16개가 같은 사용자의 다른 서비스다.** 재기동할 때 이름을 정확히
줘야 한다 — `pm2 restart Mobius`.

---

## 11. 실측 근거

전부 2026-09-04 에 직접 실행해 확인한 것이다.

### 11.1 창은 `cluster.fork()` 가 만든다

관리 UI(pm2 경유)로 띄우자 콘솔 창이 워커 수만큼 떴다(이 장비 16코어). 워커 2개짜리 흉내
스크립트로 변형을 갈라 측정했다(보이는 최상위 창을 열거해 소유 프로세스 확인).

| 변형 | 새로 뜬 창 |
|---|---|
| 아무 것도 안 함 | **2개** |
| `spawn` 에만 `windowsHide` | **2개** — 무효 |
| `cluster` 에만 `windowsHide` | **0개** |
| pm2 + `HIDE_WORKERS=1` | **0개** |

`spawn` 쪽 옵션은 효과가 없고 **`cluster` 쪽 한 줄이 전부**다. **터미널에서 직접 띄우면
애초에 안 뜬다** — 워커가 부모 콘솔을 상속하기 때문이다. 판정에 쓴 것은 **0이냐 아니냐**다.

### 11.2 `pm2 start <이름>` 은 이름을 경로로 먼저 해석한다

등록되지 않은 이름으로 불렀더니 **실패하지 않고** 존재하지 않는 경로를 스크립트로 잡은 채 떴다.

```
$ pm2 start Mobius
[PM2] Starting C:\...\Mobius\Mobius in fork_mode (1 instance)
[PM2] Done.          ← 그런 파일은 없다
```

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
pm2 로그   Mobius-error 하루 3~5MB · pm2-logrotate 설치됨
```

### 11.4 pm2 `jlist` 가 주는 필드

`status` 의 `감독` 줄이 쓸 수 있는 것들이다.

`pid` · `status` · `restart_time` · `unstable_restarts` · `pm_uptime` · `exec_mode` ·
`instances` · `pm_exec_path` · `pm_cwd` · `pm_out_log_path` · `pm_err_log_path` ·
`memory` · `cpu`

### 11.5 콘솔은 코드 수정 없이 뜬다

막는 것은 빌드가 아니라 `conf.json` 이다. `adminPassword` 가 없으면 `exit(1)` 한다.

### 11.6 중복 실행은 좀비가 되고, pm2 는 정상으로 본다

`app.js` 의 기동 구조를 그대로 본뜬 껍데기로 측정했다. 포트를 먼저 잡아 두고 두 번째
인스턴스를 띄웠다.

```
[B][worker] uncaught: EADDRINUSE — 워커만 종료한다
[B][master] 워커 죽음 (누적 10, 4초)
...            12초에 20회 이상. 마스터는 계속 살아 있다

pm2 가 보고하는 것:  5초 후·12초 후 모두  status online · restarts 0 · pid 고정
```

cluster 가 아닌 단일 프로세스였다면 pm2 가 `errored` 로 포기했을 것이다(실측
`restarts 30` → `errored`). **그리고 `pm2 start <이름>` 은 이미 `online` 인 앱에 불러도
거부가 아니라 재시작이다.**

### 11.7 웹을 외부에 열려면 지금은 부족하다

```
adminHost      기본 127.0.0.1 — 루프백 아니면 경고 한 줄만 찍고 그대로 뜬다
세션 쿠키       HttpOnly · SameSite=Strict · 8시간 — Secure 없음
로그인 시도 제한  0건
비밀번호 비교    해시 + timingSafeEqual — 이건 제대로 돼 있다
```

`adminOrigin` 을 안 주면 콘솔이 `superUser` 로 CSE 에 접근하고 `security.check` 가 그 값을
무조건 통과시킨다.

---

## 12. 정하지 않은 것

- **웹을 외부에 어떻게 열 것인가** — 리버스 프록시(TLS + 추가 인증) 뒤에 두는 안이 유력하다.
  콘솔 코드는 루프백 바인드 그대로 두면 되므로 이 스펙을 바꾸지 않는다. **로그인 시도 제한과
  `Secure` 쿠키는 그때 필수**다
- **`adminOrigin` 을 `superUser` 에서 뗄 것인가** — 떼면 웹이 ACP 로 제한되지만 만료·고아
  삭제가 막힐 수 있다. 재정의 문서의 **결정 ②**(관리자 1명 전제)와 함께 정한다.
  이번 작업과 커밋을 섞지 않는다
- **루프백이 아닌 바인드를 거부할 것인가** — 지금은 경고만 한다
- **`npm run status` 에 `--json` 을 줄 것인가** — 사람이 읽는 형식은 §4.4 에서 확정했다
- **`dbpass` 암호화는 하지 않기로 했다** — 서버가 스스로 복호화할 수 있으면 그 서버를 읽을
  수 있는 사람도 복호화할 수 있어 "DB 접속 차단"이 될 수 없다. 마법사가 입력할 때 화면에
  안 보이게 하는 것으로 충분하다고 판단했다. 되살리려면 별도 키 파일 방식이 후보다
  (장비 고유값 파생은 백업 복원·서버 이전에서 깨진다)
- **부팅 기록 상한의 계수** — `capped` 의 뜻·판정 시점·`cap` 필드는 §3.2 에서 정했다
- **pm2 존재 판정 방법과 `jlist` 타임아웃** — 실패를 전부 "pm2 없음"으로 떨어뜨린다는
  계약만 §4.4 에 있으면 된다
- **배포에 `ecosystem.config.js` 를 둘 것인가** — 두면 `pm2 start` 의 모호성(§11.2)이
  없어진다. 이 스펙의 범위 밖
- **배포 소스의 `usecsebase`·`usecseid`·`usespid` 실제 값**이 이 문서가 적은 기본값과 같은지.
  **1단계 착수 전에 확인한다**

---

## 13. 2차 — 사용자/고급 키 · 봉인 · 일괄 편집 (8판, 2026-09-05)

7판을 구현한 뒤 사용자가 정한 것 셋이다. 셋 다 "설정은 CLI 가 맡는다" 는 기조 안에 있고, 7판의
결정을 뒤집지 않는다(비밀은 평문, pm2 는 안 다룬다, 웹은 리소스만).

### 13.1 사용자 키와 고급 키

**표의 키를 둘로 가른다.** 사용자가 바꿀 일이 있는 것과, 소스 기본값으로 두면 되는 것.

| 등급 | 뜻 | 스키마 | 누가 어떻게 바꾸나 |
|---|---|---|---|
| **사용자** | 첫 실행이 묻는 것 | `tier: 'user'` | 마법사 · `npm run conf`(목록·`set`·`unset`·`edit`) · 비밀은 `npm run setup -- --…` |
| **고급** | 굳이 바꿀 필요가 없는 것 | (표시 없음 = 기본) | 아는 사람이 `conf.json` 을 직접 고치거나 `npm run conf -- --all` |

**사용자 키는 일곱이다** — `db`·`dbpass`·`cseBase`·`cseId`·`spId`·`superUser`·`csebaseport`. 첫 실행 마법사가
묻는 것(§13.4)·`WIZARD_KEYS`·`conf_schema.userKeys()` 가 **같은 집합**이어야 하고 시험이 이름으로 못박는다.
`dbpass` 는 mysql 어댑터의 `confSchema` 에 있으므로 `tier` 도 거기 적는다.

**새 키의 기본은 고급이다.** 표에 키를 더할 때 `tier: 'user'` 를 명시하지 않으면 사용자에게 안 보인다 —
실수로 노출되는 방향이 아니라 실수로 숨는 방향이 안전하다.

**CLI 는 기본으로 사용자 키만 안다.** 목록은 사용자 키와 비밀 둘(`dbpass`·`superUser`)만 보이고 끝에
"고급 키 N개는 숨겼다 — `--all`" 한 줄을 둔다. 고급 키에 `set`/`unset`/단건 조회/`edit` 을 하면
`고급 키다 — conf.json 을 직접 고치거나 --all 을 줄 것` 으로 거부한다. **`--all` 을 주면 지금(7판)과
같다** — 전부 보이고 전부 고칠 수 있다(유효값 검사·관문은 그대로). `status` 의 재기동 대기 건수는
`--all` 과 무관하게 전 키를 센다(운영 상태는 숨기지 않는다).

`describe()` 가 `tier`('user'|'advanced')를 내보낸다.

### 13.2 봉인 — `dbpass`·`superUser` 는 도구로만 바꾼다

**목적은 권한이 아니라 경로다.** 소유자와 사용자를 나누지 않는다. `conf.json` 을 편집기로 열어 비밀
둘을 고치는 길을 닫고, `npm run setup -- --dbpass` / `-- --superuser`(프롬프트로만)만 남긴다.

**파일** — `conf.json` 옆 `conf.seal.json`(gitignore):

```json
{ "key": "<설치 때 만든 난수 32바이트, hex>", "keys": ["dbpass", "superUser"],
  "seal": "<HMAC-SHA256(key, JSON.stringify({dbpass: 값|null, superUser: 값|null})) hex>", "at": "…" }
```

`conf.json` 은 그대로 평문이다 — 값을 숨기는 것이 목적이 아니다.

**쓰는 쪽은 둘뿐이다.** 마법사가 `conf.json` 을 만들 때 key 를 만들고 봉인한다. `setSecret`(`--dbpass`·
`--superuser`)이 값을 바꾼 뒤 다시 봉인한다. **봉인만 새로 만드는 명령(`--seal`)은 두지 않는다** — 손으로
고치고 봉인하는 뒷문이 된다. `npm run conf -- set` 은 비밀을 못 건드리므로 봉인을 깨지 않는다.

**읽는 쪽은 코어다.** `conf_load` 가 `conf.json` 을 파싱한 직후 대조한다.

| 상태 | 무엇을 한다 |
|---|---|
| 맞음 | 그대로 기동 |
| `conf.seal.json` 없음 · 깨짐 · 불일치 | **기동하지 않는다.** `[설정] dbpass·superUser 가 도구 밖에서 바뀌었다(또는 봉인이 없다) — npm run setup -- --superuser (mysql 이면 --dbpass 도) 로 다시 넣을 것`. 마스터는 exit 1, 워커는 **`EXIT_BAD_SEAL = 14`** 로 나가고 마스터가 재포크하지 않고 같이 종료한다(`NO_CONF` 와 같은 자리) |
| 파싱이 깨진 `conf.json` | 7판 그대로 기본값으로 진행(값이 손편집된 것이 아니라 파일이 깨진 것) |

**기존 배포 파일에는 봉인이 없다.** 새 코어로 재기동하기 전에 `npm run setup -- --superuser`(어느 백엔드든
된다; mysql 이면 `--dbpass` 로도 된다)를 **한 번** 쳐서 봉인을 만든다 — 배포 3차의 순서다. 그냥 통과시키는
유예는 두지 않는다.

**한계.** 같은 계정이 `conf.seal.json` 의 key 로 HMAC 을 직접 계산하면 우회할 수 있다. 사용자가 소유자·
사용자를 나누지 않기로 했으므로 막지 않는다. 콘솔의 비밀(`adminPassword`·`adminOrigin`)은 봉인 대상이
아니다 — 고급 키라 손편집이 설계다.

`npm run conf` 목록은 봉인이 어긋나 있으면 경고 한 줄을 낸다(서버가 뜨지 않을 것이므로).

### 13.3 일괄 편집 — `npm run conf -- edit`

첫 실행처럼 **사용자 키를 카테고리 순서대로 차례로 묻는다**(`--all` 이면 고급 키까지). 비밀 둘은 안 묻고
(각자 `npm run setup -- --…`), 읽기 전용은 값만 보이고 건너뛴다.

```
CSE 신원
  cseBase              Mobius                          > ⏎
  cseId                /Mobius2                        > /Vita1
네트워크
  csebaseport          7579                            > ⏎
저장소
  db                   mysql  (mysql / sqlite)          > ⏎
```

- 현재 값(파일에 있으면 파일 값, 없으면 기본값 — `(기본값)` 표시)을 보이고 **Enter 는 "그대로"** 다.
  파일에 없던 키를 Enter 로 지나가면 파일에 넣지 않는다.
- 답마다 `set` 과 같은 타입 변환·`validate()`. 틀리면 `validHint` 를 보이고 같은 항목을 다시 묻는다.
- **관문 키는 값을 바꿨을 때만** 끝에 `set` 과 같은 관문(경고 + 키 이름 타이핑)을 지난다. 거부하면 그 키만
  빠지고 나머지는 쓴다.
- 끝에 바뀐 것을 한 번에 보이고 **한 번의 원자적 쓰기**(`store.update(patch)`), "재기동해야 반영된다".
  바뀐 것이 없으면 파일을 건드리지 않는다. Ctrl-C/Ctrl-D 는 아무것도 쓰지 않는다.
- TTY 가 아니면 거부. `conf.json` 이 없으면 `set` 과 같이 거부(먼저 `node mobius.js`).

### 13.4 마법사와 재입력 (7판 이후 이미 들어간 것)

- 마법사는 **일곱**을 묻는다: DB → dbpass(mysql 만) → cseBase → cseId → spId → **superUser** → csebaseport.
  superUser 는 화면에 안 보이게 받고 비우면 `Sponde`.
- `npm run setup -- --superuser` — `--dbpass` 와 같은 길. 빈 입력은 바꾸지 않는다.
- 비-TTY 첫 기동의 안내는 `node mobius.js` 를 앞세운다(별도 명령이 아니라 첫 기동이 묻고 만든다).

### 13.5 시험 계약 (2차)

**T1** `userKeys()` 가 정확히 일곱이고 `WIZARD_KEYS`·마법사 질문과 같은 집합이다 · **T2** `--all` 없이 고급 키
`set`/`unset`/단건/`edit` 이 거부되고 파일이 안 바뀐다; `--all` 이면 7판과 같다 · **T3** 목록이 고급 키를 숨기고
개수를 말한다; 새 키의 기본 등급이 고급이다(`describe().tier`).

**S1** 마법사가 `conf.json` 과 함께 `conf.seal.json` 을 만들고, 이어서 `conf_load` 가 통과한다 · **S2** `dbpass`
또는 `superUser` 를 손으로 고치면 `conf_load` 가 `BAD_SEAL` 로 거부하고 파일을 건드리지 않는다 · **S3** 봉인
파일이 없거나 깨졌어도 거부 · **S4** `setSecret` 뒤 봉인이 다시 맞고 key 는 유지된다 · **S5** `set` 으로 다른
키를 바꿔도 봉인이 깨지지 않는다 · **S6** 워커의 `BAD_SEAL` 이 14 로 나가고 마스터가 재포크하지 않는다(소스).

**E1** Enter 만 치면 파일이 안 바뀐다 · **E2** 바꾼 키만 한 번에 쓰인다(파일에 없던 키를 Enter 로 지나면 안
생긴다) · **E3** 유효하지 않은 답은 같은 항목을 다시 묻는다 · **E4** 관문 키는 바꿨을 때만 확인을 받고, 거부하면
그 키만 빠진다 · **E5** 비-TTY·EOF 는 아무것도 쓰지 않는다 · **E6** `--all` 이면 고급 키도 묻는다.
