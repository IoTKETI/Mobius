# Mobius 관리 콘솔 2판 — 판단 + 검증 (설계, 2026-09-06)

브레인스토밍 결과다. 이전 설계(2026-08-28 콘솔 설계 · 08-30 백로그 · 09-01 목적 선언 ·
08-29 인수인계 · 09-04 conf-cli 설계)에서 이미 결정된 것은 다시 결정하지 않고 그대로
쓴다. 이 문서는 **그 위에 무엇을 더하고 무엇을 고치는가**를 적는다.

## 0. 이번에 결정한 것 (대화 순서대로)

| 물음 | 결정 |
|---|---|
| 재설계 범위 | "지금 만들 수 있는 것까지" — 위반 4건 수정 + 종합 테스트 탭 + 구독 롤업 + ACP 신규 생성·`acpi` 연결 + `/hit`·`/total_*` 콘솔 이관. 코어 선행이 필요한 항목(대형 컨테이너 보정·거부 로그·구독 상세)은 "다음" |
| ACP 변경 이력 화면 | **만들지 않는다** — "A 에서 B 로 바꿨다" 는 기록이 필요 없다 |
| 접근 방식 | 점진 재구성 — 백엔드 골격·Vue 셸·작업 엔진 유지, 탭을 네 묶음으로 재편, 셸은 Vue Router |
| 종합 테스트의 성격 | 내 수정 확인이 아니라 **Mobius 전체 동작을 표준에 가깝게 훑는 케이스 모음**. 카테고리로 묶고 카테고리별·전체 실행 |
| 테스트 대상 | 콘솔이 붙어 있는 **그 Mobius 하나**(`adminCseHost/Port`). 다른 CSE 는 없다. 전용 AE 아래 격리 |
| 알림 수신 | 콘솔 백엔드가 **HTTP 수신기 + MQTT 구독자**를 겸한다. CoAP 는 뺀다(배포 사용 0건) |
| 성능 지표 | 단건 응답 시간(모든 케이스) + **부하 카테고리**(기본 꺼짐, 상한 고정, 실행 전 확인) |
| 실행 이력 | 파일로 최근 50회 보관, 두 실행 비교 |

## 1. 목적 선언 (수정)과 비목표

2026-09-01 목적 선언에 한 문장을 더한다.

> 관리 콘솔은 Mobius 가 자동으로 하지 않기로 한 판단을 사람이 내리는 자리이고,
> **붙어 있는 Mobius 의 동작을 표준 케이스로 검증하는 자리**이기도 하다. 검증용
> 리소스는 전용 AE 아래에서만 만들고 실행이 끝나면 지운다 — 비목표였던 "리소스
> 생성" 의 유일한 예외다. 서버·DB 의 생사와 설정은 여전히 다루지 않는다.

유지되는 것: 관리자 1명·공유 비밀번호 · 읽기는 DB 파사드, 쓰기는 반드시 CSE HTTP 경유 ·
코어 정책을 화면이 상수로 베끼지 않는다 · 전역 `COUNT(*)`·`acpi like` 금지, 상한 있는
카운트 + 키셋 페이징 · ACP 판정은 코어 함수 재사용 · 잠금 단위는 AE 하나.

비목표(이번에도 아님): 설정 편집·프로세스 제어(CLI 의 일) · 다중 사용자 · 보존 정책(mni/mbs)
편집 · DB 백업 · 대형 컨테이너 카운터 보정 · 거부/attach 로그 조회 · 구독 상세 화면 ·
ACP 변경 이력 화면 · 다른 CSE 를 대상으로 한 테스트.

## 2. 화면 구조

### 2.1 묶음과 화면

| 묶음 | 화면 | 상태 | 이번 일 |
|---|---|---|---|
| 판단 | 만료 | 있음(부분) | 정책 상수 제거 → 백엔드가 코어에서 유도(§3.1) |
| 판단 | 고아 | 있음(위반) | 라이브 스캔 제거 → 탐지 작업 + 마지막 결과(§3.3) |
| 판단 | ACP 문제 | 있음(부분) | `more/nextRi` 키셋 "더 보기"(§3.2) |
| 판단 | ACP 목록 | 있음(부분) | 신규 생성·`acpi` 연결/해제(§4) |
| 판단 | 시뮬레이터 | 있음 | `acpDiscoveryFilter` 경고(§3.4) |
| 구독 | 엔드포인트 | 없음 | 롤업 화면(§5) |
| 관측 | 통계 | 없음 | `/hit`·`/total_ae`·`/total_cbs` 이관(§6.1) |
| 관측 | 작업 | 없음(패널만) | `JobPanel` 을 화면으로(§6.2) |
| 검증 | 종합 테스트 | 없음 | 실행·결과·이력(§7) |

### 2.2 셸

- **Vue Router(hash 모드)** 로 바꾼다. 화면마다 URL(`#/judge/expired`, `#/verify/selftest/runs/<runId>` …)이 생겨
  결과 화면을 링크로 열 수 있다. 지금의 `TABS` 문자열 스위치는 없앤다.
- 왼쪽 묶음 내비게이션, 상단에 백엔드 이름·대상 CSE(`host:port`)·ACP 관찰 모드 배지.
  관찰 모드 배지는 지금처럼 "콘솔이 읽은 conf.json 값" 임을 문구로 밝힌다.
- 인증·세션·빌드(Vite → `admin/web/dist` 정적 서빙)·`api.ts`·`job.ts` 는 그대로다.
- 새 의존성은 `vue-router` 하나. 차트는 인라인 SVG(막대·스파크라인)로 그린다.

## 3. 위반 4건 수정 (재작업 1순위)

### 3.1 만료 화면의 정책 상수

`ExpiredView.vue` 의 `AUTO_DELETED_RISKY`·`ET_EXTENDABLE` 을 없앤다. 백엔드
`GET /api/expired/policy` 가 `{ autoDeletedTypes: [], etExtendableTypes: [...] }` 를 내려
주고 화면은 그것만 본다. 값의 출처는 코어다 — `mobius/resource.js` 의 타입별 갱신 가능
속성 표에서 `et` 를 받는 타입을 뽑고, 자동 삭제 타입은 코어의 만료 스윕이 실제로 지우는
타입 목록(지금은 비어 있다)을 export 한 것이다. 코어에 그 export 가 없으면 이번에 만든다
(§8). 시험: 코어 표와 API 응답이 같음을 대조한다.

### 3.2 ACP 문제 화면의 잘림

`acpLint`/`acpLintRefs` 응답의 `more`·`nextRi` 를 화면이 받아 "더 보기" 로 이어 붙인다.
잘렸는데 말하지 않는 일이 없어야 한다 — `more:true` 인데 버튼이 없으면 시험이 잡는다.

### 3.3 고아 화면의 라이브 스캔

- 화면을 열어도 스캔하지 않는다. "고아 탐지 시작" 이 `jobs.js` 작업 하나를 만들고, 작업은
  키셋(`ri`)으로 조각내어 상한(기본 200,000행 검사)까지만 훑는다. 상한에 닿으면 `capped`.
- 결과 표본(고아 `ri`·`ty`·`pi` 상위 N 건, 기본 1,000)을 `admin/data/orphans/<runId>.json` 에
  남기고 화면은 마지막 결과만 보여 준다. 콘솔을 재시작해도 남는다.
- 인수인계 §6 의 고아 `lookup` 행(`cin` 에 없는 `ty=4`)도 같은 작업의 둘째 단계로 표본만
  뽑는다. **세지 않는다**(전수 카운트 532초).
- 삭제는 사람이 고른 것만, 조각(기본 200건)으로 CSE DELETE. 조각 실패는 결과에 적고 다음
  조각으로 넘어간다.

### 3.4 `acpDiscoveryFilter` 노출

`GET /api/session` 에 `acp.discoveryFilter` 를 싣는다. `'off'` 면 시뮬레이터 상단에 "잠근
컨테이너의 경로가 상위 discovery 에 그대로 나온다 — 시뮬레이션 결과가 보호를 과장한다" 를
띄운다.

## 4. ACP 신규 생성과 `acpi` 연결/해제 (ACP 목록 화면)

- **새 ACP**: 편집 화면의 A/B/C 템플릿 마법사를 재사용해 본문을 만들고, `acpValidate` →
  시뮬레이터 미리보기(`acpSimulateWithRows`) → CSE 에 `POST … ty=1`. 부모는 잠금 단위인
  AE(사용자가 고른다). 백엔드 `POST /api/acp/create { parentRi, body }`.
- **연결/해제**: 대상 AE 를 고르면 그 AE 의 현재 `acpi` 와 ACP 목록을 보여 주고 붙이고 뗀다.
  손입력은 없다. 최대 7개(`acpi` varchar(200)). 저장 전에 "이 조합이면 원발신자별로 무엇이
  되는가" 를 시뮬레이터로 미리 본다. 쓰기는 AE 에 대한 CSE `PUT { m2m:ae: { acpi: [...] } }`
  한 번. 백엔드 `POST /api/acp/attach { targetRi, acpi: [] }`.
- 컨테이너·CIN 에는 붙이지 못한다(코어 `acpiAttachPolicy` 와 무관하게 콘솔이 막는다 —
  이전 결정 "잠금 단위는 AE 하나").

## 5. 구독 롤업 (구독 묶음)

- 백엔드 `GET /api/subs/endpoints?limit=100`: 구독을 `nu` 의 `scheme://host[:port]` 로 묶어
  `{ endpoint, total, broken, suspect, sample: [ri…] }` 목록. 전역 스캔이 아니라 **상한
  있는 집계** — `sql_action.js` 에 `select_sub_endpoint_rollup(limit)` 를 새로 둔다(읽기
  전용, §8). `broken`/`suspect` 판정은 코어의 구독 감사 함수 결과를 그대로 쓴다(배포:
  `broken` 0, `suspect` = `mqtt_topic_unregistered` 29.8%).
- 화면: 엔드포인트 표(건수 순) → 하나를 고르면 그 엔드포인트의 구독 표본(상한 200, `ri`·
  부모·`nu`·`enc`·판정). 삭제는 `broken` 만 미리 선택되고 `suspect` 는 같은 선택에 섞이지
  않는다(별도 확인). 삭제는 CSE DELETE, 작업 엔진 경유.
- 구독 상세·전체 목록 페이징은 코어 함수(`select_sub_list`/`select_sub_detail`)가 없어 이번
  범위 밖이다.

## 6. 관측

### 6.1 통계

- 콘솔 `GET /api/stats/hit` · `/api/stats/total-ae` · `/api/stats/total-cbs` 가 코어 질의
  (`get_hit_all` · `select_sum_ae` · `select_sum_cbs`)를 DB 파사드로 부른다.
- 코어의 공개 경로 `/hit`·`/total_ae`·`/total_cbs`(`app.js` `extra_api_action`)는
  **제거**한다(인수인계 §7 의 ②안). 헤더·ACP 검사 앞에서 응답하던 구멍이 사라진다. 관련
  시험 3건을 콘솔 라우트 시험으로 옮긴다.
- 화면: 총 AE 수·CIN 바이트 총합·일별 호출 건수 표 + 최근 30일 막대(인라인 SVG).

### 6.2 작업

`jobs.list()` 를 화면으로. 최근 작업의 종류·시작·진행률·결과·취소. 메모리에만 있어 콘솔
재시작 시 사라진다(지금과 같다 — 화면에 그렇게 적는다).

## 7. 종합 테스트

### 7.1 개념

- **케이스**: 요청 몇 개와 기대값의 묶음. 결과는 `pass`·`fail`·`error`·`skip` 넷.
- **카테고리**: 케이스의 묶음. 화면은 카테고리를 골라 돌리거나 전체를 돌린다.
- **실행(run)**: 카테고리 집합을 한 번 돌린 기록. 파일 하나.
- 기대값은 **oneM2M 표준 rsc** 를 케이스에 고정한다. HTTP 상태는 코어 카탈로그
  (`mobius/rsc.js`, "한 rsc 는 한 HTTP")에서 유도한다 — 코어가 매핑을 잘못 바꾸면 테스트가
  잡는다. 사유 문구(`dbg`)는 단정하지 않는다.

### 7.2 케이스 정의

두 형태가 있고 실행기는 둘을 같은 결과 레코드로 낸다.

**선언형** (대부분: CRUD·검색·네거티브):

```js
// admin/selftest/catalog/cnt.js
module.exports = {
    category: 'cnt', title: '컨테이너',
    cases: [
        { id: 'cnt.create.ok', title: 'CNT 생성', ref: 'TS-0004 7.4.6',
          steps: [
              { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'c1' } },
                expect: { rsc: '2001', body: { 'm2m:cnt': { rn: 'c1', ty: 3 } } }, as: 'c1' },
              { op: 'retrieve', target: '$c1', expect: { rsc: '2000' } }
          ] },
        { id: 'cnt.create.dup-rn', title: '같은 rn 두 번',
          steps: [
              { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'dup' } }, expect: { rsc: '2001' } },
              { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'dup' } }, expect: { rsc: '4105' } }
          ] },
        { id: 'grp.create.ok', requires: { types: [9] }, /* SQLite 면 skip */ steps: [ /* … */ ] }
    ]
};
```

- `op`: `create` · `retrieve` · `update` · `delete` · `discover` · `notify-wait` 여섯.
- `target`: 경로. `$run` 은 이번 실행의 루트 컨테이너, `$이름` 은 앞 단계가 `as` 로 남긴
  리소스. 절대 경로(`/Mobius`)도 된다(CSEBase 조회 등 읽기 전용에만).
- `headers`: 기본은 `X-M2M-Origin: <실행 AE 의 aei>`, `X-M2M-RI` 자동, `X-M2M-RVI: 2a`.
  케이스가 덮어쓸 수 있다(헤더 누락·다른 origin 케이스).
- `expect`: `rsc`(필수), `body`(부분 일치 — 적은 키만 본다), `headers`(부분 일치),
  `discover: { contains: [...], notContains: [...] }`.
- `requires: { types: [...] }`: 대상 백엔드가 그 타입을 지원하지 않으면 `skip`. 지원 목록은
  화면·케이스가 베끼지 않고 `mobius/db` 파사드의 `supportedResourceTypes()` 로 읽는다.
- `notify-wait: { receiver: 'http'|'mqtt', sur: '$sub', timeoutMs: 5000 }` — 수신기가 그
  `sur` 의 알림을 받으면 pass, 상한 안에 못 받으면 fail, 수신기가 없으면 error.

**스크립트형** (여러 단계가 얽히는 것: 알림 시나리오·보관 정책·팬아웃·부하):

```js
{ id: 'retention.mni.purge', title: 'mni 초과분이 스윕에 지워진다',
  run: async function (ctx) {
      var c = await ctx.create('$run', 3, { 'm2m:cnt': { rn: 'r', mni: 3 } });
      for (var i = 0; i < 5; i++) { await ctx.create(c.path, 4, { 'm2m:cin': { con: String(i) } }); }
      var ok = await ctx.until(function () { return ctx.discover(c.path, { ty: 4 }).then(r => r.count <= 3); },
                               ctx.conf.purgeSweepMs * 2 + 1000);
      ctx.assert(ok, 'cni 가 mni 아래로 내려오지 않았다');
  } }
```

`ctx` 가 주는 것: `create/retrieve/update/delete/discover`(선언형과 같은 실행 경로),
`until(pred, timeoutMs)`, `assert`, `receiver.expect(sur, kind, timeoutMs)`, `conf`(대상
Mobius 의 적용값 — 부팅 기록 최신 마스터 줄에서 읽는다, 없으면 스키마 기본값), `timer`.

### 7.3 카테고리 (초안)

| id | 제목 | 대략 건수 | 내용 |
|---|---|---|---|
| `base` | 기본 | 15 | CSEBase 조회(rcn 별), X-M2M 헤더 누락/잘못됨, Content-Type 별(json·xml·cbor 거절), HEAD |
| `ae` | AE | 20 | 생성(rn 지정·미지정·api·rr·poa), 조회, 갱신(lbl·poa), 삭제(자식 포함), 중복 rn, 잘못된 속성 |
| `cnt` | 컨테이너 | 25 | 생성·조회·갱신·삭제, mni/mbs 설정, `la`/`ol` 빈 컨테이너, 깊이, 예약어 rn(`la`·`ol`·`fopt`), 중복 |
| `cin` | 콘텐츠 인스턴스 | 25 | 생성(con 문자열·JSON·cnf), 조회, `la`/`ol`, 갱신 거부(4005), 삭제, cni/cbs 증가, mbs 초과 |
| `acp` | 접근 제어 | 30 | ACP 생성·조회·갱신·삭제, 허용/거부 판정(원발신자별·연산별), `acpi` 없는 리소스의 기본 정책, superUser 통과, 자기 ACP 삭제 |
| `sub` | 구독·알림 | 25 | SUB 생성(nu http/mqtt, enc), 자식 생성 → 알림 수신(http·mqtt), 갱신 → 알림, 삭제 → 알림 없음, 잘못된 nu, 구독 못 하는 대상(5203) |
| `grp` | 그룹·팬아웃 | 15 | GRP 생성(mid 검증·mnm 초과 6010), `fopt` GET/POST/PUT/DELETE, 멤버 일부 없음 |
| `fcnt` | flexContainer | 20 | fcnt + hd_* 8종 생성·조회·갱신·삭제·구독 알림 |
| `types` | 기타 타입 | 20 | lcp·nod·csr·smd·mms CRUD, mgo 는 생성 차단이 정상 |
| `discovery` | 검색 | 30 | fu·rcn 0~6·lim·ofst·lbl·ty(다중)·cra/crb·la/ol, ACP 로 걸러짐(`acpDiscoveryFilter`), 잘못된 파라미터 |
| `retention` | 보관 정책 | 6 | mni/mbs 초과 → 스윕 대기 후 정리, 명시 mni 가 정책보다 우선 |
| `edge` | 에러·엣지 | 25 | 잘못된 JSON, 빈 본문, 본문 크기 `maxBodyBytes+1` → 413, 지원하지 않는 타입(ts·req), 논블로킹 rt=1/2 거부, 잘못된 부모-자식 조합(4110), 긴 rn, 4바이트 문자 |
| `load` | 부하 | 1 | §7.7. 기본 꺼짐 |

건수는 구현 때 확정한다. 카테고리 파일마다 `title` 과 `order` 가 있고 화면은 그 순서로 보인다.

### 7.4 실행기

- 실행 = `jobs.js` 의 작업 하나(`kind: 'selftest'`). 삭제 작업과 동시에 돌지 않는다(단일
  슬롯). 진행률은 `done/total` 케이스 수.
- 카테고리는 선언 순서로, 카테고리 안 케이스도 선언 순서로 **순차** 실행한다(응답 시간을
  섞지 않기 위해). `load` 만 동시 실행이다.
- 요청은 전부 `admin/cse.js` 의 `Client` 를 쓴다. `Client.request` 가 결과에
  `elapsedMs`(hrtime 기준)를 싣도록 한 줄 보탠다 — 다른 호출부에는 영향이 없다.
- 케이스 안 단계는 앞 단계가 실패하면 나머지를 건너뛰고 케이스를 `fail` 로 닫는다. 케이스
  사이는 독립이다.
- 취소: 진행 중 케이스까지 하고 정리(§7.5)로 넘어간다. 결과 파일에는 `cancelled: true`.

### 7.5 격리와 정리

- 실행 시작: `POST /Mobius` 로 AE `admin_selftest`(`api: 'admin.selftest'`, `rr: false`)를
  만들고 그 아래 `run-<yyyymmddThhmmss>` 컨테이너를 만든다. 모든 쓰기는 그 아래에서만.
- 이전 실행이 남긴 `admin_selftest` 가 있으면(콘솔이 죽은 경우) 먼저 지운다.
- 실행 끝: 성공·실패·취소·예외 모두 `finally` 에서 AE 삭제(자식 포함). 삭제가 실패하면 결과에
  `cleanup: 'failed'` 와 사유를 남기고 화면이 경고한다.
- 케이스가 절대 경로에 쓰는 것은 금지다 — 카탈로그 시험이 `$run`/`$이름` 밖으로 쓰는 단계를
  잡는다(읽기 전용 op 는 예외).

### 7.6 수신기

- HTTP: 실행 동안만 `adminSelftestHost:adminSelftestPort`(§9)에 서버를 연다. `nu` 는
  `http://<host>:<port>/noti/<runId>`. 본문의 `m2m:sgn.sur` 로 짝짓고, 받은 시각을 기록해
  `notify-wait` 가 지연(이벤트 요청 완료 → 수신)을 낸다. `vrq`(구독 검증 요청)에는 2000 으로
  답한다.
- MQTT: 대상 Mobius 의 `mqttBroker:mqttPort`(부팅 기록의 적용값)에 콘솔이 클라이언트로
  붙어 `/oneM2M/req/<cseId 의 앞 슬래시 제거>/<수신자ID>/json` 을 구독한다. `nu` 는
  `mqtt://<broker>/<수신자ID>?ct=json`. 수신자ID 는 `admin_selftest_<runId>`.
- 수신기는 실행이 끝나면 닫는다. 포트가 이미 쓰이면 실행을 시작하지 않는다(§10).

### 7.7 성능과 부하

- 모든 케이스가 단계별 `elapsedMs` 를 남긴다. 카테고리·전체에 p50·p95·최대·평균을 낸다.
  알림 케이스는 수신 지연을 따로 낸다.
- `load` 카테고리(기본 꺼짐): 실행 전 확인 대화상자("운영 서버에 N 건을 보냅니다"). 기본
  동시 10 · 총 2,000 건 · 섞임 생성 50% / 조회 30% / discovery 20%, 상한 동시 20 · 총 5,000
  — **서버가 강제**한다(화면 값이 커도 잘린다). 결과: 초당 처리량, p50·p95·p99, 오류율,
  총 소요. 처음 200 건에서 오류율 20% 를 넘으면 중단하고 `aborted: 'error-rate'`.
- 부하 대상 리소스도 `$run` 아래이고 정리에 포함된다.

### 7.8 결과 레코드·이력·비교

`admin/data/selftest/<runId>.json`:

```json
{ "runId": "20260906T143000-3f2a", "startedAt": "…", "endedAt": "…", "cancelled": false,
  "target": { "host": "127.0.0.1", "port": 7579, "backend": "mysql", "cseBase": "Mobius",
              "cseId": "/Mobius2", "mobiusVersion": "2.6.0", "bootAt": "…" },
  "categories": ["base", "cnt", "…"], "loadIncluded": false,
  "summary": { "pass": 210, "fail": 2, "error": 0, "skip": 15, "p50": 3.1, "p95": 12.4, "max": 88 },
  "results": [ { "id": "cnt.create.dup-rn", "category": "cnt", "status": "fail", "ms": 9.2,
                 "steps": [ { "op": "create", "expect": { "rsc": "4105" }, "actual": { "rsc": "4105", "http": 409 }, "ms": 4.1, "ok": true } ],
                 "failedStep": 1, "message": "rsc 4105 를 기대했으나 4005" } ],
  "perf": { "byCategory": { "cnt": { "n": 25, "p50": 3, "p95": 11, "max": 40 } },
            "notify": { "http": { "n": 8, "p50": 15, "p95": 40 }, "mqtt": { "n": 8, "p50": 20, "p95": 60 } },
            "load": null },
  "cleanup": "ok" }
```

- 파일은 tmp + rename(`mobius/conf_write.writeAtomic` 재사용). 최근 50개만 남기고 오래된
  것부터 지운다. 깨진 파일은 목록에서 경고와 함께 건너뛴다.
- 이력 목록: 시각·카테고리·pass/fail/error/skip·p95·부하 포함. 두 실행을 고르면 **비교**:
  새로 실패한 케이스, 고쳐진 케이스, 카테고리별 p95 변화(±20% 넘으면 강조), 대상이 다르면
  (백엔드·버전) 그 사실을 앞세운다.

### 7.9 화면

- **실행**: 카테고리 체크리스트(건수·설명), "전체" 토글, 부하는 별도 표시와 확인. 대상 요약
  (host:port·백엔드·버전). "시작" → 진행률(작업 엔진) → 끝나면 결과로 이동.
- **결과**: 요약 띠(pass/fail/error/skip·p95) → 카테고리 표(건수·실패·p50/p95 막대) →
  카테고리를 펼치면 케이스 표(id·제목·상태·소요·실패 단계의 기대/실제). 실패 케이스는 단계
  요청·응답(본문은 접힘)을 보여 준다. 성능 절: 카테고리별 p50/p95 막대, 알림 지연, 부하 결과.
- **이력**: 목록 + 비교 선택.

### 7.10 CLI 진입점

`node admin/selftest/run.js --port 7579 [--host 127.0.0.1] [--category cnt,sub] [--load]
[--out <파일>]` — UI 없이 같은 엔진을 돌리고 결과 JSON 을 쓴다. 표준 출력에 요약 표. 종료
코드 0(전부 pass/skip) · 1(fail 있음) · 2(error 있음). 배포 서버 검증과 카탈로그 기대값 확인에
쓴다. 콘솔 conf.json(수신기 포트)과 대상 Mobius 의 부팅 기록을 같은 규칙으로 읽는다.

### 7.11 백엔드 API

| 메서드·경로 | 하는 일 |
|---|---|
| `GET /api/selftest/catalog` | 카테고리·케이스 목록(id·제목·ref·requires), 대상 요약, 지원하지 않는 타입 |
| `POST /api/selftest/runs { categories:[], load:{concurrency,total}? }` | 작업 시작. 409 = 다른 작업 진행 중, 423 = 수신기 포트 사용 중 |
| `GET /api/selftest/runs` | 이력 목록(요약만) |
| `GET /api/selftest/runs/:id` | 결과 전체 |
| `GET /api/selftest/compare?a=&b=` | 비교 결과 |
| `DELETE /api/selftest/runs/:id` | 이력 삭제 |
| `GET /api/jobs/:id` | (기존) 진행률 |

## 8. 코어 변경 (작다, 전부 읽기 전용이거나 제거)

| 파일 | 변경 | 이유 |
|---|---|---|
| `mobius/resource.js` 또는 새 `mobius/expiry_policy.js` | `etExtendableTypes()`·`autoDeletedTypes()` export | §3.1 — 화면이 상수를 베끼지 않게 |
| `mobius/sql_action.js` | `select_sub_endpoint_rollup(limit, cb)` | §5 — 상한 있는 집계 |
| `app.js` | `extra_api_action` 과 `/hit`·`/total_ae`·`/total_cbs` 제거 | §6.1 — 인수인계 §7 ② |
| `test/*` | 위 세 경로의 시험 3건을 콘솔 라우트 시험으로 | |
| `admin/cse.js` | `Client.request` 결과에 `elapsedMs` | §7.4 |

`mobius/db` 파사드의 `supportedResourceTypes()` 는 이미 있다. 코어의 응답 경로는 건드리지
않으므로 응답 골든 29건은 전후 동일해야 한다.

## 9. 설정 키 (콘솔 그룹, 고급)

| 키 | 기본 | 뜻 |
|---|---|---|
| `adminSelftestPort` | 7581 | 실행 동안 여는 HTTP 알림 수신 포트 |
| `adminSelftestHost` | `adminHost` 값 | Mobius 가 알림을 보낼 때 닿는 콘솔 주소. 같은 장비면 `127.0.0.1` 로 충분하다 |

`mobius/conf_schema.js` 콘솔 그룹에 `tier` 없이(고급) 올린다. `test/conf-schema.test.js` 가
리더(`admin/`)와 양방향으로 대조한다.

## 10. 오류 처리

- 실행기는 던지지 않는다. 응답이 왔으나 기대와 다르면 `fail`, 응답이 없으면(타임아웃·연결
  실패·수신기 문제) `error`, 지원하지 않는 타입·꺼진 부하는 `skip`. 정리는 `finally`.
- 수신 포트 사용 중 → 423 과 "포트 N 을 쓰는 프로세스 확인, `adminSelftestPort` 로 변경".
  MQTT 브로커 접속 실패 → MQTT 알림 케이스만 `error`, 나머지 진행, 결과 상단에 표시.
- 부하 상한은 서버가 강제. 오류율 20% 초과 시 중단(§7.7).
- 작업 슬롯 충돌 → 409 와 진행 중 작업 정보.
- 이력 파일 원자적 쓰기, 깨진 파일 건너뜀.
- ACP 생성·연결: 검사 → 미리보기 → 한 번의 CSE 요청. 실패 시 rsc·dbg 그대로 표시, 부분 적용
  없음. 고아 탐지·삭제: 조각 실패는 기록하고 다음 조각.
- 통계 질의는 DB 파사드 타임아웃을 그대로 따르고, 실패하면 화면에 사유와 재시도 버튼.

## 11. 시험 전략

- **카탈로그 시험**(`test/admin-selftest-catalog.test.js`): id 유일 · 카테고리 선언·순서 ·
  기대 `rsc` 가 `mobius/rsc.js` 에 있음 · `requires.types` 가 코어 타입 표에 있음 · 스크립트
  케이스가 `run` 을 export · 쓰기 단계의 `target` 이 `$run`/`$이름` 아래.
- **실행기·수신기·이력 시험**(`test/admin-selftest-runner.test.js` 등): 순서·취소·정리·오류
  분류·이력 쓰기/보관 50·비교를 **최소 CSE 대역**으로 검사한다. 대역은 X-M2M 헤더·
  Content-Type·본문 모양을 엄격히 검사해 실물보다 관대하지 않다. HTTP 수신기는 실제 소켓.
  MQTT 구독자는 브로커가 필요해 단위 시험에서 제외한다(통합 실행으로 본다).
- **통합 실행**: `node admin/selftest/run.js` 를 개발 장비와 배포 서버의 실제 Mobius 에 대고
  돌려 카탈로그 기대값을 확인한다. `npm test` 는 Mobius 를 띄우지 않는다(Windows 콘솔 창·
  워커 포크).
- **백엔드 라우트 시험**: 통계·구독 롤업·만료 정책·고아 작업·ACP 생성/연결은 지금 콘솔
  시험처럼 임시 SQLite(`MOBIUS_SQLITE_PATH`)로.
- **코어 회귀**: 시험 3건 이전 + 응답 골든 29건 전후 대조(`tools/response-golden/headers.js`).
- **프런트**: `vue-tsc --noEmit` 와 `vite build` 통과. 컴포넌트 시험은 두지 않는다.
- **배포 검증**: 배포 뒤 서버에서 종합 테스트 전체(부하 제외)를 한 번 돌린다.

## 12. 배포·운영

- 콘솔은 지금처럼 별도 프로세스(`node admin/server.js`, 포트 7580). 배포 서버에서는 Mobius
  와 같은 장비라 수신기 주소는 `127.0.0.1` 이면 된다. 방화벽 밖으로 7581 을 열 필요가 없다.
- `admin/web` 은 배포 때 다시 빌드한다(`dist/` 미추적). 새 의존성 `vue-router` 는 `admin/web`
  의 `npm install`.
- 코어 변경(`extra_api_action` 제거)이 있으므로 Mobius 재기동이 한 번 필요하다. 그 뒤 종합
  테스트 전체 실행이 곧 배포 검증이다.
- `admin/data/` 는 gitignore. 이력 50개 × 수십 KB 라 디스크 걱정은 없다.

## 12.1 전제

콘솔은 지금처럼 **Mobius 와 같은 저장소 루트**에서 돈다(같은 `conf.json` 을 읽는 것이 이미
그 전제다). 그래서 대상 Mobius 의 적용값(`ctx.conf`, MQTT 브로커 주소, 백엔드 이름)은
`log/mobius-boot.jsonl` 의 최신 마스터 줄에서 읽고, 부팅 기록이 없으면 스키마 기본값으로
간다. 다른 장비의 Mobius 를 대상으로 하는 것은 비목표다.

## 12.2 구현 순서

계획은 두 묶음으로 나눈다. 앞 묶음이 끝나면 배포할 수 있고, 뒤 묶음은 그 위에 얹는다.

1. **콘솔 2판 골격** — Vue Router 셸, 위반 4건(§3), ACP 생성·연결(§4), 구독 롤업(§5),
   관측(§6), 코어 변경(§8). 배포 1회(코어 재기동 포함).
2. **종합 테스트** — 카탈로그·실행기·수신기·이력·화면·CLI(§7), 설정 키(§9). 배포 1회
   (콘솔만 재기동, 코어는 그대로).

## 13. 다음 (이번 범위 밖으로 남긴 것)

- 대형 컨테이너 7개 카운터 보정 — "쓰기는 CSE 경유" 원칙의 예외 결정이 먼저.
- ACP 거부·attach 로그 조회 — 코어 로그 싱크 필요. `acpiAttachPolicy:'creator'` 전환 근거.
- 구독 상세·전체 목록 — `select_sub_list`/`select_sub_detail`.
- 보존 정책(mni/mbs) 편집, MySQL 서버 설정, DB 백업, 다중 사용자.
- 종합 테스트의 CoAP 알림, 다른 CSE 대상, 케이스의 사용자 편집.

## 14. 참고

- `docs/superpowers/specs/2026-09-01-admin-console-purpose.md` — 목적 선언
- `docs/superpowers/specs/2026-08-30-admin-console-backlog.md` — 백로그 §3·§4
- `docs/superpowers/specs/2026-08-29-admin-ui-handoff.md` — 인수인계 §1·§2·§6·§7
- `docs/superpowers/specs/2026-09-04-conf-cli-design.md` — 콘솔에서 뺀 것
- `admin/README.md` — 지금 콘솔의 화면·실행 방법
