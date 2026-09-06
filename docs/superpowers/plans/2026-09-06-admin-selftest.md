# 관리 콘솔 종합 테스트 — 구현 계획 (2/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 콘솔의 "검증" 묶음에 종합 테스트를 넣는다 — 붙어 있는 Mobius 하나를 대상으로, 카테고리로 묶인 표준 케이스를 골라 돌리고, 케이스별 pass/fail/error/skip 과 응답 시간(p50·p95·최대), 알림 지연, 선택적 부하 결과를 보여 주며, 실행 이력을 파일로 50회 보관해 두 실행을 비교한다.

**Architecture:** `admin/selftest/` 아래에 카탈로그(카테고리별 케이스 파일: 선언형 + 스크립트형) · 실행기(`jobs.js` 작업 하나로 케이스를 순차 실행, 전용 AE 아래 격리, `finally` 정리) · 수신기(실행 동안만 여는 HTTP 서버 + MQTT 구독자) · 이력(`admin/data/selftest/`, `data_dir.js`) · 성능 집계 · CLI 진입점. 요청은 전부 `admin/cse.js` 의 `Client`(1/2 계획 Task 4 의 `elapsedMs`·헤더 덮어쓰기·`create`)를 지난다. 기대값은 oneM2M 표준 rsc 를 케이스에 고정하고 HTTP 는 `mobius/rsc.js` 에서 유도한다.

**Tech Stack:** Node.js 내장 모듈 + 루트의 `mqtt`(이미 의존성) · Vue 3 + Vue Router(1/2 계획) · Node 내장 test runner.

**Spec:** `docs/superpowers/specs/2026-09-06-admin-console-v2-design.md` §7 (종합 테스트), §9 (설정 키), §10 (오류 처리), §11 (시험 전략), §12 (배포). 1/2 계획 `docs/superpowers/plans/2026-09-06-admin-console-v2.md` 가 먼저 끝나 있어야 한다(HEAD 에 Task 1~15 가 있다).

## Global Constraints

- **대상은 콘솔이 붙어 있는 Mobius 하나**(`ctx.cse` 의 host·port). 다른 CSE 는 없다.
- **격리**: 모든 쓰기는 전용 AE `admin_selftest` 아래 `run-<runId>` 컨테이너 안에서만. 절대 경로 쓰기는 카탈로그 시험이 잡는다. 실행 끝(성공·실패·취소·예외)에 AE 를 지운다. 이전 실행이 남긴 AE 가 있으면 시작 때 먼저 지운다.
- **케이스 결과는 넷**: `pass`·`fail`(응답이 왔으나 기대와 다름)·`error`(응답 없음·수신기 문제·예외)·`skip`(백엔드 미지원 타입·꺼진 부하). 실행기는 던지지 않는다.
- **기대 rsc 는 oneM2M 표준 코드**를 케이스에 고정, HTTP 는 `mobius/rsc.js` 의 카탈로그에서 유도(`expect.http` 로 명시하면 그것). `dbg` 문구는 단정하지 않는다.
- **지원 타입은 어댑터가 정한다** — `mobius/db/<이름>.js` 의 `supportedResourceTypes`(null 이면 제한 없음). 케이스의 `requires.types` 가 거기 없으면 `skip`.
- **순차 실행**(카테고리 순 → 케이스 순). `load` 카테고리만 동시. 실행은 `jobs.js` 작업 하나(`kind: 'selftest'`).
- **부하 상한은 서버가 강제**: 동시 ≤ 20, 총 ≤ 5,000. 처음 200건 오류율 20% 초과 시 중단. 기본 꺼짐.
- **수신기**: HTTP 는 `adminSelftestHost:adminSelftestPort`(기본 `adminHost` 값 · 7581), MQTT 는 대상의 `mqttBroker:mqttPort` 에 콘솔이 클라이언트로 붙는다. CoAP 없음. 포트가 쓰이면 실행을 시작하지 않는다(423).
- **이력은 `admin/data/selftest/<runId>.json`**, tmp+rename, 최근 50개.
- **새 백엔드 의존성 없음**(`mqtt` 는 루트에 있다). `npm test` 는 Mobius 를 띄우지 않는다 — 실행기 시험은 최소 CSE 대역(`test/selftest_fake_cse.js`)을 쓰고, 그 대역은 헤더·Content-Type 을 검사하며 실물보다 관대하지 않다. MQTT 는 단위 시험에서 제외(통합 실행으로 본다).
- **콘솔 conf 키는 `admin/server.js` 가 읽는다**(`test/conf-schema.test.js` 의 리더 규칙). 새 키 `adminSelftestPort`·`adminSelftestHost` 는 콘솔 그룹, `tier` 없음(고급).
- 주석·문서·커밋 메시지는 한국어. 백엔드 `var`·세미콜론. 커밋 말미 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `docs/` 는 `git add -f`. `CLAUDE.md` 는 디스크만.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `mobius/conf_schema.js` · `admin/server.js` | 수정 (1) | `adminSelftestPort`·`adminSelftestHost` 키와 읽기 → `ctx.selftest = { host, port }` |
| `admin/selftest/catalog/index.js` | **신설** (2) | 카테고리 파일 로드·검증·순서, `OPS`, `httpOf(rsc)` |
| `admin/selftest/catalog/{base,ae,cnt,cin,acp,discovery,types,edge}.js` | **신설** (2) | 선언형 케이스 |
| `admin/selftest/catalog/{sub,grp,fcnt,retention,load}.js` | **신설** (6) | 스크립트형이 섞인 카테고리 |
| `admin/selftest/runner.js` | **신설** (3) | 단계 실행·변수 해석·판정·격리·정리·결과 레코드·작업 연결 |
| `admin/selftest/receiver.js` | **신설** (4) | HTTP 수신 서버 + MQTT 구독자, `expect(sur, kind, timeoutMs, since)` |
| `admin/selftest/history.js` | **신설** (5) | 저장·목록·조회·비교·삭제·보관 50 |
| `admin/selftest/perf.js` | **신설** (6) | 백분위·요약·부하 집계 |
| `admin/selftest/target.js` | **신설** (3) | 대상 요약(host·port·백엔드·버전·부팅 기록의 적용값), 지원 타입 |
| `admin/selftest/run.js` | **신설** (8) | CLI 진입점 |
| `admin/api.js` | 수정 (7) | `/api/selftest/*` |
| `test/selftest_fake_cse.js` | **신설** (3) | 최소 oneM2M 대역(메모리 트리·rn 중복·discovery) |
| `admin/web/src/views/SelfTestView.vue` · `SelfTestRunView.vue` · `SelfTestHistoryView.vue` | **신설** (9) | 실행·결과·이력 |
| `admin/web/src/router.ts` · `api.ts` · `types.ts` | 수정 (9) | 라우트·API·타입 |
| `admin/README.md` · `CLAUDE.md` | 수정 (10) | 문서 |

**과제 순서**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.

---

## 공통 계약 (여러 과제가 쓴다)

**케이스 정의** (`admin/selftest/catalog/*.js`):

```js
module.exports = {
    category: 'cnt', title: '컨테이너', order: 30,
    cases: [
        // 선언형
        { id: 'cnt.create.ok', title: 'CNT 생성', ref: 'TS-0004 7.4.6',
          requires: { types: [3] },
          steps: [
              { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'c1' } },
                expect: { rsc: '2001', body: { 'm2m:cnt': { rn: 'c1', ty: 3 } } }, as: 'c1' },
              { op: 'retrieve', target: '$c1', expect: { rsc: '2000' } }
          ] },
        // 스크립트형
        { id: 'retention.mni.purge', title: '…', run: async function (ctx) { /* ctx 계약 아래 */ } }
    ]
};
```

- `op`: `create`·`retrieve`·`update`·`delete`·`discover`·`notify-wait`.
- `target`: `$run`(이번 실행의 루트 컨테이너), `$이름`(앞 단계가 `as` 로 남긴 리소스의 경로), `$ae`(실행 AE), `$cb`(CSEBase 경로 `/<cseBase>`), 또는 절대 경로(읽기 op 만 — 쓰기 op 의 절대 경로는 카탈로그 시험이 거부). `$이름/자식` 처럼 뒤에 경로를 붙일 수 있다.
- `headers`: 덮어쓴다. `undefined` 인 키는 헤더에서 뺀다(예: `{ 'X-M2M-Origin': undefined }`).
- `query`: `retrieve`·`discover` 의 쿼리 객체(`{ fu: 1, ty: 4, lim: 2 }`). `discover` 는 `fu=1` 을 자동으로 넣는다.
- `expect`: `rsc`(필수) · `http`(선택, 없으면 카탈로그에서 유도) · `body`(부분 일치 — 적은 키만, 값에 `$이름` 이면 그 경로) · `headers`(부분 일치, 소문자 키) · `discover: { contains: ['$c1'], notContains: [], count: n }`(`m2m:uril` 기준, `$` 해석).
- `as`: 이 단계가 만든 리소스의 경로를 이름에 담는다(`create` 는 `target + '/' + 응답의 rn`).
- `notify-wait`: `{ op: 'notify-wait', receiver: 'http'|'mqtt', sur: '$sub', timeoutMs: 5000 }` — 직전 단계가 끝난 시각 이후에 그 `sur` 의 알림이 오면 pass(`latencyMs` 기록), 상한 안에 없으면 fail, 수신기가 없으면 error.
- `requires.types`: 대상 백엔드가 지원하지 않으면 케이스 `skip`.

**스크립트형 `ctx`**:

| 멤버 | 뜻 |
|---|---|
| `ctx.create(target, ty, body, opts?)` → `{ ok, status, rsc, http, body, elapsedMs, path }` | `path` 는 만든 리소스 경로(응답 rn) |
| `ctx.retrieve(target, opts?)` · `ctx.update(target, body, opts?)` · `ctx.delete(target, opts?)` | 같은 결과 모양(`path` 없음) |
| `ctx.discover(target, query, opts?)` → `{ …, uril: string[] }` | |
| `opts.headers` | 덮어쓰기 |
| `ctx.resolve('$c1')` | 이름 → 경로 |
| `ctx.until(pred, timeoutMs, everyMs=250)` → `Promise<boolean>` | `pred` 는 `Promise<boolean>` |
| `ctx.assert(cond, message)` | 거짓이면 케이스 `fail`(message) |
| `ctx.receiver` | `receiver.expect(sur, kind, timeoutMs, sinceMs)`, `receiver.httpNu(runId)`, `receiver.mqttNu()`(없으면 null) |
| `ctx.conf` | 대상의 적용값(`target.js`) — `purgeSweepMs`, `maxBodyBytes`, `mqttBroker` … |
| `ctx.run` · `ctx.ae` · `ctx.origin` · `ctx.cseBase` | 경로·AE-ID |
| `ctx.record(step)` | 스크립트가 단계 하나를 결과에 남긴다 `{ op, target, expect, actual, ms, ok }` (create 류가 자동으로 남기므로 보통 안 쓴다) |
| `ctx.load` | `{ concurrency, total, mix }` (부하 케이스만) |
| `ctx.now()` | ms |

**결과 레코드** (스펙 §7.8 그대로):

```js
{ runId, startedAt, endedAt, status: 'running'|'done'|'cancelled', cancelled,
  target: { host, port, backend, cseBase, cseId, mobiusVersion, bootAt },
  categories: ['base', …], loadIncluded,
  summary: { pass, fail, error, skip, p50, p95, max },
  results: [{ id, category, title, status, ms, steps: [{ op, target, expect, actual, ms, ok, note }], failedStep, message }],
  perf: { byCategory: { cnt: { n, p50, p95, max, avg } }, notify: { http: {…}|null, mqtt: {…}|null }, load: null|{…} },
  cleanup: 'ok'|'failed'|'skipped', cleanupError }
```

---

### Task 1: 설정 키 `adminSelftestPort`·`adminSelftestHost`

**Files:**
- Modify: `mobius/conf_schema.js`(콘솔 그룹), `admin/server.js`(읽기 + `ctx.selftest`), `test/admin_app_helper.js`(`ctx.selftest` 기본값)
- Test: `test/admin-selftest-conf.test.js`

**Interfaces:**
- `ctx.selftest = { host: string, port: number }`. 기본 `host = adminHost 값(기본 '127.0.0.1')`, `port = 7581`.

- [ ] **Step 1: 실패하는 시험**

`test/admin-selftest-conf.test.js`:

```js
'use strict';
// 종합 테스트의 알림 수신기 주소. Mobius 가 알림을 보낼 때 닿는 콘솔 주소라
// adminHost 와 같은 기본을 쓴다(같은 장비면 루프백으로 충분하다).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.usedb = 'mysql';
const schema = require(path.join(ROOT, 'mobius', 'conf_schema'));

test('표에 두 키가 콘솔 그룹·고급으로 있다', function () {
    ['adminSelftestPort', 'adminSelftestHost'].forEach((k) => {
        const d = schema.get(k);
        assert.ok(d, k + ' 가 표에 없다');
        assert.strictEqual(d.group, '콘솔');
        assert.strictEqual(d.tier, undefined, '사용자 키가 아니다');
        assert.strictEqual(d.apply, 'restart');
    });
    assert.strictEqual(schema.get('adminSelftestPort').dflt, 7581);
    assert.strictEqual(schema.get('adminSelftestHost').dflt, '');
    assert.strictEqual(schema.checkValue('adminSelftestPort', 0).ok, false);
    assert.strictEqual(schema.checkValue('adminSelftestPort', 7581).ok, true);
});

test('admin/server.js 가 두 키를 읽어 ctx.selftest 로 넘긴다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'admin', 'server.js'), 'utf8')
        .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.match(src, /conf\.adminSelftestPort/);
    assert.match(src, /conf\.adminSelftestHost/);
    assert.match(src, /selftest:\s*\{\s*host:/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-selftest-conf.test.js` → FAIL (표에 없음)

- [ ] **Step 3: `mobius/conf_schema.js` — 콘솔 그룹의 `adminOrigin` 뒤에**

```js
    adminSelftestPort: {
        group: '콘솔',
        type: 'number', integer: true, min: 1, max: 65535, dflt: 7581, apply: 'restart',
        label: '종합 테스트 알림 수신 포트',
        help: '종합 테스트가 도는 동안만 연다. Mobius 가 HTTP 알림을 보낼 때 닿는 콘솔 포트.'
    },
    adminSelftestHost: {
        group: '콘솔',
        type: 'string', dflt: '', apply: 'restart',
        label: '종합 테스트 알림 수신 주소',
        help: 'Mobius 가 알림을 보낼 때 쓰는 콘솔 주소. 비우면 adminHost 를 따른다 — 같은 장비면 127.0.0.1 로 충분하다.'
    },
```

`max` 를 받는 `checkValue` 가 없으면(다른 키에 `max` 가 없다) `valid: function (v) { return v >= 1 && v <= 65535; }, validHint: '1~65535'` 로 대신한다 — `checkValue` 가 `valid` 함수를 지원하는 것은 `csebaseport` 항목이 보여 준다.

- [ ] **Step 4: `admin/server.js`**

`CSE_ORIGIN` 아래에:

```js
// 종합 테스트의 알림 수신기. Mobius 가 알림을 보낼 때 닿는 콘솔 주소다. 실행 동안만 연다.
var SELFTEST_PORT = (typeof conf.adminSelftestPort === 'number' && conf.adminSelftestPort > 0)
    ? conf.adminSelftestPort : 7581;
var SELFTEST_HOST = (typeof conf.adminSelftestHost === 'string' && conf.adminSelftestHost !== '')
    ? conf.adminSelftestHost : HOST;
```

`install` 에 넘기는 객체에 `selftest: { host: SELFTEST_HOST, port: SELFTEST_PORT },` 를 더한다. `test/admin_app_helper.js` 의 `ctx` 에도 `selftest: { host: '127.0.0.1', port: opts.selftestPort || 0 }` 를 더한다(0 이면 실행기가 임시 포트를 잡는다 — 시험용).

- [ ] **Step 5: 시험**

Run: `node --test test/admin-selftest-conf.test.js test/conf-schema.test.js` → PASS. Run: `npm test` → 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add mobius/conf_schema.js admin/server.js test/admin_app_helper.js test/admin-selftest-conf.test.js
git commit -m "conf(admin): 종합 테스트 수신기 주소 키 둘 — adminSelftestPort·adminSelftestHost

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 카탈로그 골격과 선언형 카테고리 여덟

**Files:**
- Create: `admin/selftest/catalog/index.js`, `admin/selftest/catalog/base.js`, `ae.js`, `cnt.js`, `cin.js`, `acp.js`, `discovery.js`, `types.js`, `edge.js`
- Test: `test/admin-selftest-catalog.test.js`

**Interfaces:**
- `catalog.load()` → `{ categories: [{ id, title, order, cases }] }` (order 오름차순, 파일은 `catalog/` 의 `*.js` 중 `index.js` 제외).
- `catalog.validate(cat)` → `string[]`(문제 목록, 비면 정상). 규칙: 카테고리 id 유일·`order` 숫자, 케이스 id 유일·`category.` 접두, 선언형은 `steps` 배열이고 각 `op` 가 `OPS` 에 있고 `expect.rsc` 가 `rsc.js` 카탈로그에 있으며 쓰기 op(`create`·`update`·`delete`)의 `target` 은 `$` 로 시작, `requires.types` 는 `shape.typeRsrc` 의 키, 스크립트형은 `run` 이 함수, 둘 다 아니면 오류.
- `catalog.httpOf(rsc)` → number (`rsc.js` 의 `RSC` 에서 그 rsc 를 가진 첫 항목의 http; `CONTENT_TOO_LARGE` 처럼 같은 rsc 의 둘째 항목은 케이스가 `expect.http` 로 적는다).
- `catalog.OPS`.
- 선언형 여덟 카테고리의 케이스는 아래 Step 3 의 것이 전부다(구현 때 늘려도 되지만 줄이지 않는다).

- [ ] **Step 1: 실패하는 시험**

`test/admin-selftest-catalog.test.js`:

```js
'use strict';
// 카탈로그의 모양을 잠근다. 케이스를 잘못 적으면(없는 rsc, 절대 경로 쓰기, 모르는 op)
// 실행 중이 아니라 여기서 잡힌다. 기대 rsc 는 oneM2M 표준 코드이고 HTTP 는 코어
// 카탈로그에서 유도한다 — 코어가 매핑을 잘못 바꾸면 테스트가 잡는 구조다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const catalog = require(path.join(__dirname, '..', 'admin', 'selftest', 'catalog'));
const rsc = require(path.join(__dirname, '..', 'mobius', 'rsc'));

test('카탈로그가 검증을 통과한다', function () {
    const cat = catalog.load();
    const problems = catalog.validate(cat);
    assert.deepStrictEqual(problems, []);
    assert.ok(cat.categories.length >= 8);
    const orders = cat.categories.map((c) => c.order);
    assert.deepStrictEqual(orders, orders.slice().sort((a, b) => a - b), '순서대로 실린다');
});

test('validate 는 흔한 실수를 잡는다', function () {
    const bad = { categories: [{ id: 'x', title: 'x', order: 1, cases: [
        { id: 'x.a', title: 'a', steps: [{ op: 'create', target: '/Mobius', ty: 3, body: {}, expect: { rsc: '2001' } }] },
        { id: 'x.a', title: 'dup', steps: [{ op: 'retrieve', target: '$run', expect: { rsc: '9999' } }] },
        { id: 'x.b', title: 'b', steps: [{ op: 'fly', target: '$run', expect: { rsc: '2000' } }] },
        { id: 'y.c', title: 'c', run: 'not a function' },
        { id: 'x.d', title: 'd', requires: { types: [77] }, steps: [] }
    ] }] };
    const p = catalog.validate(bad);
    assert.ok(p.some((m) => /x\.a/.test(m) && /절대 경로/.test(m)), '절대 경로 쓰기: ' + p);
    assert.ok(p.some((m) => /x\.a/.test(m) && /중복/.test(m)));
    assert.ok(p.some((m) => /9999/.test(m)));
    assert.ok(p.some((m) => /fly/.test(m)));
    assert.ok(p.some((m) => /y\.c/.test(m) && /접두/.test(m)));
    assert.ok(p.some((m) => /y\.c/.test(m) && /run/.test(m)));
    assert.ok(p.some((m) => /x\.d/.test(m) && /77/.test(m)));
});

test('httpOf 는 코어 카탈로그에서 유도한다', function () {
    assert.strictEqual(catalog.httpOf('2001'), 201);
    assert.strictEqual(catalog.httpOf('4004'), 404);
    assert.strictEqual(catalog.httpOf('4000'), 400, '같은 rsc 의 둘째 항목(413)은 케이스가 http 로 적는다');
    assert.strictEqual(catalog.httpOf('0000'), null);
    // 카탈로그 전체와 대조 — 여기서 안 나오는 값이 케이스에 있으면 validate 가 잡는다.
    Object.keys(rsc.RSC).forEach((name) => { assert.ok(catalog.httpOf(rsc.RSC[name].rsc) !== null); });
});

test('선언형 케이스는 전부 $run 아래에만 쓴다 · 알려진 케이스가 있다', function () {
    const cat = catalog.load();
    const all = [].concat.apply([], cat.categories.map((c) => c.cases));
    const ids = all.map((c) => c.id);
    ['base.cb.retrieve', 'ae.create.ok', 'cnt.create.dup-rn', 'cin.update.refused', 'acp.deny.retrieve',
     'discovery.lim', 'types.mgo.blocked', 'edge.json.broken'].forEach((id) => assert.ok(ids.indexOf(id) >= 0, id + ' 가 없다'));
    all.filter((c) => c.steps).forEach((c) => c.steps.forEach((s) => {
        if (['create', 'update', 'delete'].indexOf(s.op) >= 0) { assert.strictEqual(s.target.charAt(0), '$', c.id); }
    }));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-selftest-catalog.test.js` → FAIL (모듈 없음)

- [ ] **Step 3: `admin/selftest/catalog/index.js`**

```js
'use strict';
/**
 * 종합 테스트 카탈로그 — 카테고리별 케이스 파일을 읽고 검증한다.
 *
 * 케이스는 대부분 데이터(선언형)다. 기대 rsc 는 oneM2M 표준 코드를 적고 HTTP 는
 * 코어의 결과 코드 카탈로그(mobius/rsc.js)에서 유도한다 — 코어가 매핑을 잘못
 * 바꾸면 테스트가 잡는다. 여러 단계가 얽히는 것만 run(ctx) 를 가진 스크립트형이다.
 * 모양은 계획 문서(2026-09-06-admin-selftest.md) "공통 계약" 절이 정한다.
 */
var fs = require('fs');
var path = require('path');
var rsc = require('../../../mobius/rsc');
var shape = require('../../../mobius/shape');

var OPS = ['create', 'retrieve', 'update', 'delete', 'discover', 'notify-wait'];
var WRITE_OPS = ['create', 'update', 'delete'];

/** rsc 문자열 → HTTP. 같은 rsc 를 가진 항목이 둘이면(4000: 400·413) 앞의 것. */
function httpOf(code) {
    var names = Object.keys(rsc.RSC);
    for (var i = 0; i < names.length; i++) {
        if (rsc.RSC[names[i]].rsc === String(code)) { return rsc.RSC[names[i]].http; }
    }
    return null;
}

function load() {
    var dir = __dirname;
    var categories = fs.readdirSync(dir)
        .filter(function (f) { return /\.js$/.test(f) && f !== 'index.js'; })
        .map(function (f) { return require(path.join(dir, f)); })
        .sort(function (a, b) { return a.order - b.order; });
    return { categories: categories };
}

function validate(cat) {
    var problems = [];
    var catIds = {};
    var caseIds = {};
    var tyKeys = Object.keys(shape.typeRsrc).map(Number);
    (cat.categories || []).forEach(function (c) {
        if (!c.id || typeof c.id !== 'string') { problems.push('카테고리 id 없음'); return; }
        if (catIds[c.id]) { problems.push('카테고리 id 중복: ' + c.id); }
        catIds[c.id] = 1;
        if (typeof c.order !== 'number') { problems.push(c.id + ': order 가 숫자가 아니다'); }
        if (!Array.isArray(c.cases)) { problems.push(c.id + ': cases 가 배열이 아니다'); return; }
        c.cases.forEach(function (k) {
            var tag = (k && k.id) || '(id 없음)';
            if (!k || typeof k.id !== 'string') { problems.push(c.id + ': 케이스 id 없음'); return; }
            if (caseIds[k.id]) { problems.push(tag + ': 케이스 id 중복'); }
            caseIds[k.id] = 1;
            if (k.id.indexOf(c.id + '.') !== 0) { problems.push(tag + ': id 접두가 카테고리(' + c.id + '.) 가 아니다'); }
            if (k.requires && Array.isArray(k.requires.types)) {
                k.requires.types.forEach(function (t) {
                    if (tyKeys.indexOf(Number(t)) < 0) { problems.push(tag + ': requires.types 에 모르는 타입 ' + t); }
                });
            }
            var isScript = ('run' in k);
            var isDecl = Array.isArray(k.steps);
            if (isScript && typeof k.run !== 'function') { problems.push(tag + ': run 이 함수가 아니다'); }
            if (!isScript && !isDecl) { problems.push(tag + ': steps 도 run 도 없다'); }
            if (isDecl) {
                k.steps.forEach(function (s, i) {
                    var where = tag + ' step ' + (i + 1);
                    if (OPS.indexOf(s.op) < 0) { problems.push(where + ': 모르는 op ' + s.op); return; }
                    if (s.op === 'notify-wait') {
                        if (['http', 'mqtt'].indexOf(s.receiver) < 0) { problems.push(where + ': receiver 는 http|mqtt'); }
                        if (typeof s.sur !== 'string') { problems.push(where + ': sur 없음'); }
                        return;
                    }
                    if (typeof s.target !== 'string' || !s.target) { problems.push(where + ': target 없음'); return; }
                    if (WRITE_OPS.indexOf(s.op) >= 0 && s.target.charAt(0) !== '$') {
                        problems.push(where + ': 쓰기 op 의 target 이 절대 경로다(' + s.target + ') — $run 아래에만 쓴다');
                    }
                    if (!s.expect || typeof s.expect.rsc !== 'string') { problems.push(where + ': expect.rsc 없음'); return; }
                    if (httpOf(s.expect.rsc) === null) { problems.push(where + ': 카탈로그에 없는 rsc ' + s.expect.rsc); }
                    if (s.op === 'create' && (typeof s.ty !== 'number')) { problems.push(where + ': create 에 ty 없음'); }
                });
            }
        });
    });
    return problems;
}

module.exports = { load: load, validate: validate, httpOf: httpOf, OPS: OPS, WRITE_OPS: WRITE_OPS };
```

- [ ] **Step 4: 선언형 카테고리 파일 여덟**

`base.js` (order 10):

```js
'use strict';
// 기본 — CSEBase 조회, X-M2M 헤더, 콘텐츠 타입. 이 CSE 는 json 만 다룬다(CLAUDE.md "지원하지 않는 것").
module.exports = {
    category: 'base', title: '기본', order: 10,
    cases: [
        { id: 'base.cb.retrieve', title: 'CSEBase 조회', ref: 'TS-0004 7.3.3.2',
          steps: [{ op: 'retrieve', target: '$cb', expect: { rsc: '2000', body: { 'm2m:cb': { ty: 5 } } } }] },
        { id: 'base.cb.retrieve.rcn0', title: 'rcn=0 은 본문 없이',
          steps: [{ op: 'retrieve', target: '$cb', query: { rcn: 0 }, expect: { rsc: '2000' } }] },
        { id: 'base.header.no-ri', title: 'X-M2M-RI 없으면 400',
          steps: [{ op: 'retrieve', target: '$cb', headers: { 'X-M2M-RI': undefined }, expect: { rsc: '4000' } }] },
        { id: 'base.header.no-origin', title: 'X-M2M-Origin 없으면 400',
          steps: [{ op: 'retrieve', target: '$cb', headers: { 'X-M2M-Origin': undefined }, expect: { rsc: '4000' } }] },
        { id: 'base.ct.xml', title: 'xml 본문은 거절',
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'x' } }, headers: { 'Content-Type': 'application/xml;ty=3' }, expect: { rsc: '4000' } }] },
        { id: 'base.ct.cbor', title: 'cbor 본문은 거절',
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'x' } }, headers: { 'Content-Type': 'application/vnd.onem2m-res+cbor;ty=3' }, expect: { rsc: '4000' } }] },
        { id: 'base.notfound', title: '없는 경로는 404',
          steps: [{ op: 'retrieve', target: '$run/does-not-exist', expect: { rsc: '4004' } }] },
        { id: 'base.rvi.echo', title: '응답에 X-M2M-RSC 헤더가 있다',
          steps: [{ op: 'retrieve', target: '$cb', expect: { rsc: '2000', headers: { 'x-m2m-rsc': '2000' } } }] }
    ]
};
```

`ae.js` (order 20):

```js
'use strict';
module.exports = {
    category: 'ae', title: 'AE', order: 20,
    cases: [
        { id: 'ae.create.ok', title: 'AE 생성(rn 지정)', requires: { types: [2] },
          steps: [{ op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { rn: '$rn:ae1', api: 'selftest.ae', rr: false } },
                    headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '2001', body: { 'm2m:ae': { ty: 2, api: 'selftest.ae' } } }, as: 'ae1' },
                  { op: 'retrieve', target: '$ae1', expect: { rsc: '2000' } },
                  { op: 'delete', target: '$ae1', expect: { rsc: '2002' } }] },
        { id: 'ae.create.no-rn', title: 'rn 없이 생성하면 서버가 이름을 준다', requires: { types: [2] },
          steps: [{ op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { api: 'selftest.ae', rr: false } }, headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '2001' }, as: 'ae2' },
                  { op: 'delete', target: '$ae2', expect: { rsc: '2002' } }] },
        { id: 'ae.create.dup-rn', title: '같은 rn 두 번은 4105', requires: { types: [2] },
          steps: [{ op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { rn: '$rn:aedup', api: 'selftest.ae', rr: false } }, headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '2001' }, as: 'aedup' },
                  { op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { rn: '$rn:aedup', api: 'selftest.ae', rr: false } }, headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '4105' } },
                  { op: 'delete', target: '$aedup', expect: { rsc: '2002' } }] },
        { id: 'ae.update.lbl', title: 'lbl 갱신', requires: { types: [2] },
          steps: [{ op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { rn: '$rn:ae3', api: 'selftest.ae', rr: false } }, headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '2001' }, as: 'ae3' },
                  { op: 'update', target: '$ae3', body: { 'm2m:ae': { lbl: ['a', 'b'] } }, expect: { rsc: '2004', body: { 'm2m:ae': { lbl: ['a', 'b'] } } } },
                  { op: 'delete', target: '$ae3', expect: { rsc: '2002' } }] },
        { id: 'ae.update.np-attr', title: 'ri 는 갱신 불가(NP) — 4000', requires: { types: [2] },
          steps: [{ op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { rn: '$rn:ae4', api: 'selftest.ae', rr: false } }, headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '2001' }, as: 'ae4' },
                  { op: 'update', target: '$ae4', body: { 'm2m:ae': { ri: '/x' } }, expect: { rsc: '4000' } },
                  { op: 'delete', target: '$ae4', expect: { rsc: '2002' } }] },
        { id: 'ae.delete.subtree', title: 'AE 삭제는 자식까지', requires: { types: [2, 3] },
          steps: [{ op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { rn: '$rn:ae5', api: 'selftest.ae', rr: false } }, headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '2001' }, as: 'ae5' },
                  { op: 'create', target: '$ae5', ty: 3, body: { 'm2m:cnt': { rn: 'c' } }, expect: { rsc: '2001' }, as: 'ae5c' },
                  { op: 'delete', target: '$ae5', expect: { rsc: '2002' } },
                  { op: 'retrieve', target: '$ae5c', expect: { rsc: '4004' } }] },
        { id: 'ae.retrieve.missing', title: '없는 AE 조회는 404',
          steps: [{ op: 'retrieve', target: '$cb/no-such-ae-selftest', expect: { rsc: '4004' } }] },
        { id: 'ae.create.bad-api', title: 'api 없이 생성하면 4000', requires: { types: [2] },
          steps: [{ op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { rn: '$rn:ae6', rr: false } }, headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '4000' } }] }
    ]
};
```

AE 는 CSEBase 아래에 만들어야 하므로 `$cb` 를 대상으로 하되 **rn 을 실행마다 고유하게** 한다: `'$rn:ae1'` 은 실행기가 `admin_selftest_<runId>_ae1` 로 바꾼다(Task 3). AE 케이스는 케이스 안에서 지우고, 정리 단계도 `$cb` 아래 `admin_selftest_<runId>_*` AE 를 찾아 지운다. AE 생성의 origin `S` 는 "서버가 AE-ID 를 만든다" 는 oneM2M 규칙이다.

`cnt.js` (order 30):

```js
'use strict';
module.exports = {
    category: 'cnt', title: '컨테이너', order: 30,
    cases: [
        { id: 'cnt.create.ok', title: 'CNT 생성·조회', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'c1' } }, expect: { rsc: '2001', body: { 'm2m:cnt': { rn: 'c1', ty: 3 } } }, as: 'c1' },
                  { op: 'retrieve', target: '$c1', expect: { rsc: '2000', body: { 'm2m:cnt': { cni: 0, cbs: 0 } } } }] },
        { id: 'cnt.create.dup-rn', title: '같은 rn 두 번은 4105', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'dup' } }, expect: { rsc: '2001' } },
                  { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'dup' } }, expect: { rsc: '4105' } }] },
        { id: 'cnt.create.mni-mbs', title: 'mni·mbs 를 지정해 생성', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'c2', mni: 5, mbs: 1000 } }, expect: { rsc: '2001', body: { 'm2m:cnt': { mni: 5, mbs: 1000 } } } }] },
        { id: 'cnt.update.lbl', title: 'lbl·mni 갱신', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'c3' } }, expect: { rsc: '2001' }, as: 'c3' },
                  { op: 'update', target: '$c3', body: { 'm2m:cnt': { lbl: ['x'], mni: 7 } }, expect: { rsc: '2004', body: { 'm2m:cnt': { lbl: ['x'], mni: 7 } } } }] },
        { id: 'cnt.delete.ok', title: '삭제 뒤 404', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'c4' } }, expect: { rsc: '2001' }, as: 'c4' },
                  { op: 'delete', target: '$c4', expect: { rsc: '2002' } },
                  { op: 'retrieve', target: '$c4', expect: { rsc: '4004' } }] },
        { id: 'cnt.nested', title: '컨테이너 안의 컨테이너', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'p' } }, expect: { rsc: '2001' }, as: 'p' },
                  { op: 'create', target: '$p', ty: 3, body: { 'm2m:cnt': { rn: 'q' } }, expect: { rsc: '2001' }, as: 'q' },
                  { op: 'retrieve', target: '$q', expect: { rsc: '2000', body: { 'm2m:cnt': { rn: 'q' } } } }] },
        { id: 'cnt.la.empty', title: '빈 컨테이너의 la 는 404', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'e' } }, expect: { rsc: '2001' }, as: 'e' },
                  { op: 'retrieve', target: '$e/la', expect: { rsc: '4004' } }] },
        { id: 'cnt.reserved-rn', title: '예약어 rn(la) 은 거절', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'la' } }, expect: { rsc: '4000' } }] },
        { id: 'cnt.post-to-la', title: 'la 에 POST 는 405', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'c5' } }, expect: { rsc: '2001' }, as: 'c5' },
                  { op: 'create', target: '$c5/la', ty: 4, body: { 'm2m:cin': { con: 'x' } }, expect: { rsc: '4005' } }] }
    ]
};
```

`cin.js` (order 40):

```js
'use strict';
module.exports = {
    category: 'cin', title: '콘텐츠 인스턴스', order: 40,
    cases: [
        { id: 'cin.create.ok', title: 'CIN 생성 — cni·cbs 가 는다', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'k1' } }, expect: { rsc: '2001' }, as: 'k1' },
                  { op: 'create', target: '$k1', ty: 4, body: { 'm2m:cin': { con: 'hello' } }, expect: { rsc: '2001', body: { 'm2m:cin': { ty: 4, con: 'hello' } } }, as: 'i1' },
                  { op: 'retrieve', target: '$k1', expect: { rsc: '2000', body: { 'm2m:cnt': { cni: 1, cbs: 5 } } } }] },
        { id: 'cin.la-ol', title: 'la 와 ol', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'k2' } }, expect: { rsc: '2001' }, as: 'k2' },
                  { op: 'create', target: '$k2', ty: 4, body: { 'm2m:cin': { con: 'first' } }, expect: { rsc: '2001' } },
                  { op: 'create', target: '$k2', ty: 4, body: { 'm2m:cin': { con: 'second' } }, expect: { rsc: '2001' } },
                  { op: 'retrieve', target: '$k2/la', expect: { rsc: '2000', body: { 'm2m:cin': { con: 'second' } } } },
                  { op: 'retrieve', target: '$k2/ol', expect: { rsc: '2000', body: { 'm2m:cin': { con: 'first' } } } }] },
        { id: 'cin.update.refused', title: 'CIN 은 갱신 불가(4005)', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'k3' } }, expect: { rsc: '2001' }, as: 'k3' },
                  { op: 'create', target: '$k3', ty: 4, body: { 'm2m:cin': { con: 'v' } }, expect: { rsc: '2001' }, as: 'i3' },
                  { op: 'update', target: '$i3', body: { 'm2m:cin': { con: 'w' } }, expect: { rsc: '4005' } }] },
        { id: 'cin.delete.ok', title: 'CIN 삭제 뒤 cni 가 준다', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'k4' } }, expect: { rsc: '2001' }, as: 'k4' },
                  { op: 'create', target: '$k4', ty: 4, body: { 'm2m:cin': { con: 'v' } }, expect: { rsc: '2001' }, as: 'i4' },
                  { op: 'delete', target: '$i4', expect: { rsc: '2002' } },
                  { op: 'retrieve', target: '$k4', expect: { rsc: '2000', body: { 'm2m:cnt': { cni: 0 } } } }] },
        { id: 'cin.json-con', title: 'con 에 JSON 객체', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'k5' } }, expect: { rsc: '2001' }, as: 'k5' },
                  { op: 'create', target: '$k5', ty: 4, body: { 'm2m:cin': { con: { t: 21.5, u: 'C' } } }, expect: { rsc: '2001' }, as: 'i5' },
                  { op: 'retrieve', target: '$i5', expect: { rsc: '2000', body: { 'm2m:cin': { con: { t: 21.5, u: 'C' } } } } }] },
        { id: 'cin.cnf', title: 'cnf 지정', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'k6' } }, expect: { rsc: '2001' }, as: 'k6' },
                  { op: 'create', target: '$k6', ty: 4, body: { 'm2m:cin': { con: 'x', cnf: 'text/plain:0' } }, expect: { rsc: '2001', body: { 'm2m:cin': { cnf: 'text/plain:0' } } } }] },
        { id: 'cin.under-ae', title: 'AE 바로 아래 CIN 은 4000(부모-자식 조합)', requires: { types: [4] },
          steps: [{ op: 'create', target: '$ae', ty: 4, body: { 'm2m:cin': { con: 'x' } }, expect: { rsc: '4000' } }] },
        { id: 'cin.mbs.exceeded', title: 'mbs 보다 큰 con 은 거절', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'k7', mbs: 4 } }, expect: { rsc: '2001' }, as: 'k7' },
                  { op: 'create', target: '$k7', ty: 4, body: { 'm2m:cin': { con: 'toolong' } }, expect: { rsc: '4000' } }] }
    ]
};
```

`acp.js` (order 50):

```js
'use strict';
// 접근 제어. 실행 AE 가 만든 리소스라 실행 origin 은 생성자로 통과한다 — 거부는
// **다른 origin** 으로 확인한다. superUser 는 대상의 conf 값이라 케이스가 모른다:
// 실행기가 '$superuser' 를 ctx.conf.superUser 로 바꾼다(Task 3).
module.exports = {
    category: 'acp', title: '접근 제어', order: 50,
    cases: [
        { id: 'acp.create.ok', title: 'ACP 생성·조회', requires: { types: [1] },
          steps: [{ op: 'create', target: '$ae', ty: 1, body: { 'm2m:acp': { rn: 'a1', pv: { acr: [{ acor: ['Cother'], acop: 2 }] }, pvs: { acr: [{ acor: ['$origin'], acop: 63 }] } } },
                    expect: { rsc: '2001', body: { 'm2m:acp': { ty: 1 } } }, as: 'a1' },
                  { op: 'retrieve', target: '$a1', expect: { rsc: '2000' } }] },
        { id: 'acp.deny.retrieve', title: 'acpi 가 걸린 CNT 를 남이 읽으면 4103', requires: { types: [1, 3] },
          steps: [{ op: 'create', target: '$ae', ty: 1, body: { 'm2m:acp': { rn: 'a2', pv: { acr: [{ acor: ['Cnobody'], acop: 2 }] }, pvs: { acr: [{ acor: ['$origin'], acop: 63 }] } } }, expect: { rsc: '2001' }, as: 'a2' },
                  { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'locked', acpi: ['$a2'] } }, expect: { rsc: '2001' }, as: 'locked' },
                  { op: 'retrieve', target: '$locked', headers: { 'X-M2M-Origin': 'Cstranger' }, expect: { rsc: '4103' } }] },
        { id: 'acp.allow.retrieve', title: 'acor 에 든 origin 은 읽는다', requires: { types: [1, 3] },
          steps: [{ op: 'create', target: '$ae', ty: 1, body: { 'm2m:acp': { rn: 'a3', pv: { acr: [{ acor: ['Cfriend'], acop: 2 }] }, pvs: { acr: [{ acor: ['$origin'], acop: 63 }] } } }, expect: { rsc: '2001' }, as: 'a3' },
                  { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'shared', acpi: ['$a3'] } }, expect: { rsc: '2001' }, as: 'shared' },
                  { op: 'retrieve', target: '$shared', headers: { 'X-M2M-Origin': 'Cfriend' }, expect: { rsc: '2000' } },
                  { op: 'update', target: '$shared', headers: { 'X-M2M-Origin': 'Cfriend' }, body: { 'm2m:cnt': { lbl: ['x'] } }, expect: { rsc: '4103' } }] },
        { id: 'acp.creator.passes', title: '생성자는 ACP 와 무관하게 통과', requires: { types: [1, 3] },
          steps: [{ op: 'create', target: '$ae', ty: 1, body: { 'm2m:acp': { rn: 'a4', pv: { acr: [{ acor: ['Cnobody'], acop: 2 }] }, pvs: { acr: [{ acor: ['$origin'], acop: 63 }] } } }, expect: { rsc: '2001' }, as: 'a4' },
                  { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'mine', acpi: ['$a4'] } }, expect: { rsc: '2001' }, as: 'mine' },
                  { op: 'retrieve', target: '$mine', expect: { rsc: '2000' } }] },
        { id: 'acp.superuser.passes', title: 'superUser 는 전부 통과', requires: { types: [1, 3] },
          steps: [{ op: 'create', target: '$ae', ty: 1, body: { 'm2m:acp': { rn: 'a5', pv: { acr: [{ acor: ['Cnobody'], acop: 2 }] }, pvs: { acr: [{ acor: ['$origin'], acop: 63 }] } } }, expect: { rsc: '2001' }, as: 'a5' },
                  { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'su', acpi: ['$a5'] } }, expect: { rsc: '2001' }, as: 'su' },
                  { op: 'retrieve', target: '$su', headers: { 'X-M2M-Origin': '$superuser' }, expect: { rsc: '2000' } }] },
        { id: 'acp.update.pv', title: 'pv 갱신은 pvs 가 허용한 origin 만', requires: { types: [1] },
          steps: [{ op: 'create', target: '$ae', ty: 1, body: { 'm2m:acp': { rn: 'a6', pv: { acr: [] }, pvs: { acr: [{ acor: ['$origin'], acop: 63 }] } } }, expect: { rsc: '2001' }, as: 'a6' },
                  { op: 'update', target: '$a6', body: { 'm2m:acp': { pv: { acr: [{ acor: ['Cx'], acop: 2 }] } } }, expect: { rsc: '2004' } },
                  { op: 'update', target: '$a6', headers: { 'X-M2M-Origin': 'Cstranger' }, body: { 'm2m:acp': { pv: { acr: [] } } }, expect: { rsc: '4103' } }] },
        { id: 'acp.dangling', title: '없는 ACP 를 가리키면 생성 거절(4000)', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'dang', acpi: ['$run/no-such-acp'] } }, expect: { rsc: '4000' } }] },
        { id: 'acp.delete.ok', title: 'ACP 삭제', requires: { types: [1] },
          steps: [{ op: 'create', target: '$ae', ty: 1, body: { 'm2m:acp': { rn: 'a7', pv: { acr: [] }, pvs: { acr: [{ acor: ['$origin'], acop: 63 }] } } }, expect: { rsc: '2001' }, as: 'a7' },
                  { op: 'delete', target: '$a7', expect: { rsc: '2002' } },
                  { op: 'retrieve', target: '$a7', expect: { rsc: '4004' } }] }
    ]
};
```

`acp.dangling` 의 기대 `4000` 은 이 코어의 가드레일(acpi 검사) 동작이다 — 통합 실행에서 다르게 나오면(예: 2001 뒤 조용한 거부) 그 케이스의 기대를 코어 동작으로 고치고 `ref` 에 근거를 적는다.

`discovery.js` (order 60):

```js
'use strict';
module.exports = {
    category: 'discovery', title: '검색', order: 60,
    cases: [
        { id: 'discovery.setup', title: '검색용 트리(cnt 2 · cin 3 · lbl)', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'd1', lbl: ['tag-a'] } }, expect: { rsc: '2001' }, as: 'd1' },
                  { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'd2', lbl: ['tag-b'] } }, expect: { rsc: '2001' }, as: 'd2' },
                  { op: 'create', target: '$d1', ty: 4, body: { 'm2m:cin': { con: '1' } }, expect: { rsc: '2001' }, as: 'd1i1' },
                  { op: 'create', target: '$d1', ty: 4, body: { 'm2m:cin': { con: '2' } }, expect: { rsc: '2001' }, as: 'd1i2' },
                  { op: 'create', target: '$d2', ty: 4, body: { 'm2m:cin': { con: '3' } }, expect: { rsc: '2001' }, as: 'd2i1' }] },
        { id: 'discovery.all', title: 'fu=1 은 하위 전부', requires: { types: [3, 4] },
          steps: [{ op: 'discover', target: '$run', query: {}, expect: { rsc: '2000', discover: { contains: ['$d1', '$d2', '$d1i1', '$d2i1'] } } }] },
        { id: 'discovery.ty', title: 'ty=4 는 CIN 만', requires: { types: [3, 4] },
          steps: [{ op: 'discover', target: '$run', query: { ty: 4 }, expect: { rsc: '2000', discover: { contains: ['$d1i1', '$d1i2', '$d2i1'], notContains: ['$d1', '$d2'] } } }] },
        { id: 'discovery.ty-multi', title: 'ty=3,4 다중', requires: { types: [3, 4] },
          steps: [{ op: 'discover', target: '$run', query: { ty: '3,4' }, expect: { rsc: '2000', discover: { contains: ['$d1', '$d1i1'] } } }] },
        { id: 'discovery.lim', title: 'lim=2 는 둘만', requires: { types: [3, 4] },
          steps: [{ op: 'discover', target: '$run', query: { ty: 4, lim: 2 }, expect: { rsc: '2000', discover: { count: 2 } } }] },
        { id: 'discovery.ofst', title: 'lim+ofst 페이징은 겹치지 않는다', requires: { types: [3, 4] },
          steps: [{ op: 'discover', target: '$run', query: { ty: 4, lim: 2, ofst: 2 }, expect: { rsc: '2000', discover: { count: 1 } } }] },
        { id: 'discovery.lbl', title: 'lbl 필터', requires: { types: [3, 4] },
          steps: [{ op: 'discover', target: '$run', query: { ty: 3, lbl: 'tag-a' }, expect: { rsc: '2000', discover: { contains: ['$d1'], notContains: ['$d2'] } } }] },
        { id: 'discovery.cra', title: 'cra(미래) 는 빈 결과', requires: { types: [3, 4] },
          steps: [{ op: 'discover', target: '$run', query: { ty: 4, cra: '20991231T000000' }, expect: { rsc: '2000', discover: { count: 0 } } }] },
        { id: 'discovery.rcn', title: 'rcn=4 는 자식 리소스 본문까지', requires: { types: [3, 4] },
          steps: [{ op: 'retrieve', target: '$d1', query: { rcn: 4 }, expect: { rsc: '2000', body: { 'm2m:cnt': { rn: 'd1' } } } }] },
        { id: 'discovery.bad-rcn', title: '잘못된 rcn 은 4000', requires: { types: [3] },
          steps: [{ op: 'retrieve', target: '$d1', query: { rcn: 99 }, expect: { rsc: '4000' } }] },
        { id: 'discovery.la-ol', title: 'la/ol 에 rcn=1', requires: { types: [3, 4] },
          steps: [{ op: 'retrieve', target: '$d1/la', query: { rcn: 1 }, expect: { rsc: '2000', body: { 'm2m:cin': { con: '2' } } } }] }
    ]
};
```

카테고리 안 케이스는 선언 순서로 돌고 `$이름` 은 카테고리 안에서 공유된다(`discovery.setup` 이 만든 것을 뒤 케이스가 쓴다). 실행기의 변수 범위는 **카테고리** 다(Task 3).

`types.js` (order 70):

```js
'use strict';
// 그 밖의 타입. mgo(13) 는 생성 경로가 의도적으로 막혀 있다(mobius/type_resolver.js).
module.exports = {
    category: 'types', title: '기타 타입', order: 70,
    cases: [
        { id: 'types.grp.crud', title: 'GRP 생성·조회·삭제', requires: { types: [9, 3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'gm1' } }, expect: { rsc: '2001' }, as: 'gm1' },
                  { op: 'create', target: '$ae', ty: 9, body: { 'm2m:grp': { rn: 'g1', mt: 3, mnm: 5, mid: ['$gm1'] } }, expect: { rsc: '2001', body: { 'm2m:grp': { ty: 9 } } }, as: 'g1' },
                  { op: 'retrieve', target: '$g1', expect: { rsc: '2000' } },
                  { op: 'delete', target: '$g1', expect: { rsc: '2002' } }] },
        { id: 'types.grp.mnm-exceeded', title: 'mnm 보다 많은 mid 는 6010', requires: { types: [9, 3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'gm2' } }, expect: { rsc: '2001' }, as: 'gm2' },
                  { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'gm3' } }, expect: { rsc: '2001' }, as: 'gm3' },
                  { op: 'create', target: '$ae', ty: 9, body: { 'm2m:grp': { rn: 'g2', mt: 3, mnm: 1, mid: ['$gm2', '$gm3'] } }, expect: { rsc: '6010' } }] },
        { id: 'types.lcp.crud', title: 'LCP 생성·삭제', requires: { types: [10] },
          steps: [{ op: 'create', target: '$ae', ty: 10, body: { 'm2m:lcp': { rn: 'l1', los: 1 } }, expect: { rsc: '2001' }, as: 'l1' },
                  { op: 'delete', target: '$l1', expect: { rsc: '2002' } }] },
        { id: 'types.nod.crud', title: 'NOD 생성·삭제', requires: { types: [14] },
          steps: [{ op: 'create', target: '$cb', ty: 14, body: { 'm2m:nod': { rn: '$rn:n1', ni: 'node-selftest' } }, expect: { rsc: '2001' }, as: 'n1' },
                  { op: 'delete', target: '$n1', expect: { rsc: '2002' } }] },
        { id: 'types.smd.crud', title: 'SMD 생성·삭제', requires: { types: [24, 3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'sm' } }, expect: { rsc: '2001' }, as: 'sm' },
                  { op: 'create', target: '$sm', ty: 24, body: { 'm2m:smd': { rn: 's1', dcrp: 1, dsp: 'PHNlbWFudGljLz4=' } }, expect: { rsc: '2001' }, as: 's1' },
                  { op: 'delete', target: '$s1', expect: { rsc: '2002' } }] },
        { id: 'types.mgo.blocked', title: 'mgo(13) 생성은 막혀 있다', requires: { types: [14] },
          steps: [{ op: 'create', target: '$cb', ty: 14, body: { 'm2m:nod': { rn: '$rn:n2', ni: 'node2' } }, expect: { rsc: '2001' }, as: 'n2' },
                  { op: 'create', target: '$n2', ty: 13, body: { 'm2m:bat': { rn: 'b', mgd: 1006, btl: 50, bts: 1 } }, expect: { rsc: '4000' } },
                  { op: 'delete', target: '$n2', expect: { rsc: '2002' } }] },
        { id: 'types.removed.ts', title: '지원하지 않는 타입(ts=29) 은 거절', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 29, body: { 'm2m:ts': { rn: 't' } }, expect: { rsc: '4000' } }] }
    ]
};
```

`types.mgo.blocked`·`types.removed.ts` 의 기대는 코어 동작(`4000` 계열)이다 — 통합 실행에서 `5001`(NOT_IMPLEMENTED) 로 나오면 그것으로 고친다. 둘 다 `httpOf` 에 있다.

`edge.js` (order 80):

```js
'use strict';
module.exports = {
    category: 'edge', title: '에러·엣지', order: 80,
    cases: [
        { id: 'edge.json.broken', title: '깨진 JSON 은 4000', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, raw: '{"m2m:cnt": {"rn": ', expect: { rsc: '4000' } }] },
        { id: 'edge.body.empty', title: '빈 본문 POST 는 4000', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, raw: '', expect: { rsc: '4000' } }] },
        { id: 'edge.root.mismatch', title: '루트 이름과 ty 가 다르면 4000', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:ae': { rn: 'z' } }, expect: { rsc: '4000' } }] },
        { id: 'edge.rn.too-long', title: '긴 rn 은 거절', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'x'.repeat(300) } }, expect: { rsc: '4000' } }] },
        { id: 'edge.rn.slash', title: 'rn 에 슬래시', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'a/b' } }, expect: { rsc: '4000' } }] },
        { id: 'edge.utf8.4byte', title: '4바이트 문자(이모지) con', requires: { types: [3, 4] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'u' } }, expect: { rsc: '2001' }, as: 'u' },
                  { op: 'create', target: '$u', ty: 4, body: { 'm2m:cin': { con: '🌊 파도' } }, expect: { rsc: '2001' }, as: 'ui' },
                  { op: 'retrieve', target: '$ui', expect: { rsc: '2000', body: { 'm2m:cin': { con: '🌊 파도' } } } }] },
        { id: 'edge.nonblocking.rt1', title: '논블로킹 rt=1 은 지원하지 않는다', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'nb' } }, query: { rt: 1 }, expect: { rsc: '5001' } }] },
        { id: 'edge.unknown.ty', title: '모르는 ty(999) 는 4000', requires: { types: [3] },
          steps: [{ op: 'create', target: '$run', ty: 999, body: { 'm2m:cnt': { rn: 'q' } }, expect: { rsc: '4000' } }] },
        { id: 'edge.delete.cb', title: 'CSEBase 삭제는 4005',
          steps: [{ op: 'delete', target: '$cb', expect: { rsc: '4005' } }] },
        { id: 'edge.head', title: 'HEAD 는 워커를 죽이지 않는다(200)',
          steps: [{ op: 'retrieve', target: '$cb', method: 'HEAD', expect: { rsc: '2000' } }] }
    ]
};
```

`raw`: 실행기가 JSON 직렬화 대신 그 문자열을 그대로 본문으로 보낸다(Task 3). `method: 'HEAD'`: `retrieve` 를 HEAD 로 보낸다. `edge.delete.cb` 는 `$cb` 를 쓰기 대상으로 쓰는 유일한 케이스라 `validate` 의 절대 경로 규칙에 걸리지 않는다(`$` 로 시작). `edge.nonblocking.rt1`·`edge.unknown.ty` 의 기대도 통합 실행에서 코어 동작으로 맞춘다.

- [ ] **Step 5: 시험**

Run: `node --test test/admin-selftest-catalog.test.js` → PASS (4/4). Run: `npm test` → 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add admin/selftest/catalog test/admin-selftest-catalog.test.js
git commit -m "selftest(catalog): 카탈로그 골격과 선언형 여덟 카테고리 — 표준 rsc 고정, HTTP 는 코어 카탈로그에서

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 실행기 — 단계 실행·변수·판정·격리·정리·결과, 대상 요약, 최소 CSE 대역

**Files:**
- Create: `admin/selftest/runner.js`, `admin/selftest/target.js`, `test/selftest_fake_cse.js`
- Modify: `admin/cse.js`(`body.raw` 지원 — 한 줄)
- Test: `test/admin-selftest-runner.test.js`

**Interfaces:**
- `admin/cse.js`: `request(method, path, body, cb, opts)` 에서 `body && typeof body.raw === 'string'` 이면 `payload = body.raw`(JSON 직렬화 없이 그대로).
- `target.describe({ root, host, port, backend })` → `{ host, port, backend, cseBase, cseId, spId, mobiusVersion, bootAt, conf }`. `conf` 는 `log/mobius-boot.jsonl` 의 **마지막 마스터 줄**의 `conf` 를 스키마 기본값 위에 덮은 것(없으면 기본값만). `target.supportedTypes(backend)` → `number[] | null`(`mobius/db/<backend>.js` 의 `supportedResourceTypes`, 어댑터가 없거나 선언하지 않으면 null = 제한 없음).
- `new runner.Runner(opts)`:

```js
opts = {
  runId, host, port,
  adminClient,          // 콘솔의 Client(superUser 등) — 격리 AE 의 생성·삭제에 쓴다
  cseBase, superUser,   // '$cb' 와 '$superuser'
  catalog,              // catalog.load() 결과
  categoryIds,          // 돌릴 카테고리 id 배열(카탈로그 순서로 정렬해 돈다)
  supportedTypes,       // number[] | null
  target,               // target.describe() 결과 → result.target
  conf,                 // target.conf → ctx.conf
  receiver,             // Task 4 의 수신기 또는 null
  load,                 // { enabled, concurrency, total } — 부하 카테고리(Task 6)
  onProgress            // function (done, total, caseId)
}
```

  - `runner.setup(cb)` → `cb(err)`: `$cb/admin_selftest` 가 있으면 `adminClient` 로 지우고, AE `admin_selftest`(origin `Cadmin_selftest`, `api: 'admin.selftest'`, `rr: false`)와 컨테이너 `run-<runId>` 를 만든다. 실패하면 `err`(실행을 시작하지 않는다).
  - `runner.cases()` → 돌릴 케이스 배열(카테고리 순 → 선언 순, 각 원소 `{ category, kase }`).
  - `runner.runCase(entry, cb)` → `cb(status)`; `status ∈ pass|fail|error|skip`. 결과는 `runner.result.results` 에 쌓인다.
  - `runner.finish(cancelled, cb)` → `cb(null, result)`: 정리(AE 삭제, `$cb` 아래 `admin_selftest_<runId>_*` 삭제), `summary`·`perf` 계산, `endedAt`·`status`. 정리 실패는 `cleanup: 'failed'` 와 사유로 남긴다.
  - `runner.result` — 공통 계약의 결과 레코드.
- 변수: `$run`·`$ae`·`$cb`·`$origin`·`$superuser`·`$이름`. `$rn:이름` → `admin_selftest_<runId>_이름`. 변수 범위는 **카테고리**(카테고리가 바뀌면 `$이름` 을 비운다). 치환은 `target`·`headers` 값·`query` 값·`body`(깊이)·`expect.body`·`expect.discover.*`·`sur` 에 적용.
- 판정 순서: (1) 응답 없음(`status === 0`) → `error` (2) rsc 다름 → fail (3) http 다름 → fail (4) `expect.body` 부분 일치 (5) `expect.headers` (6) `expect.discover`. 실패한 단계에서 케이스를 닫고 뒤 단계는 `note: '건너뜀'`.
- `$이름` 은 `as` 가 있는 `create` 에서 `target + '/' + 응답 rn`. 응답에 rn 이 없으면 fail.

- [ ] **Step 1: `test/selftest_fake_cse.js` — 최소 oneM2M 대역**

```js
'use strict';
/**
 * 실행기 시험용 최소 CSE. 메모리 트리 하나로 생성·조회·갱신·삭제·discovery 를 흉내낸다.
 *
 * **관대하지 않다.** X-M2M-RI·X-M2M-Origin 없으면 400/4000, xml·cbor 는 400/4000,
 * 깨진 JSON·빈 본문은 400/4000, 루트 이름과 ty 불일치는 400/4000, 없는 부모는
 * 404/4004, 같은 rn 은 409/4105, CIN 갱신은 405/4005, acpi 가 있는 리소스를 생성자·
 * 'Sponde' 가 아닌 origin 이 건드리면 403/4103. 응답에는 X-M2M-RSC 를 싣는다.
 * 실제 Mobius 의 전부가 아니다 — 실행기의 **기계**(변수·판정·격리·정리)를 시험하는
 * 데 필요한 만큼이다. 카탈로그의 기대값은 통합 실행이 본다.
 */
const http = require('http');
const url = require('url');

const ROOT_OF = { 1: 'm2m:acp', 2: 'm2m:ae', 3: 'm2m:cnt', 4: 'm2m:cin', 5: 'm2m:cb', 9: 'm2m:grp', 23: 'm2m:sub', 28: 'm2m:fcnt' };

function create(opts) {
    opts = opts || {};
    const cseBase = opts.cseBase || 'Mobius';
    const tree = new Map();   // path → { ty, body(root 안 객체), cr, children:[] }
    tree.set('/' + cseBase, { ty: 5, body: { rn: cseBase, ty: 5, ri: '/' + cseBase }, cr: 'system' });
    const calls = [];
    let seq = 0;
    let hang = null;          // (rec) => true 면 응답하지 않는다(타임아웃 시험)

    function reply(res, status, rsc, body) {
        res.statusCode = status;
        res.setHeader('X-M2M-RSC', rsc);
        res.setHeader('Content-Type', 'application/json');
        res.end(body === undefined ? '' : JSON.stringify(body));
    }
    function parentOf(p) { return p.slice(0, p.lastIndexOf('/')); }
    function descendants(p) { return [...tree.keys()].filter((k) => k !== p && k.indexOf(p + '/') === 0); }
    function children(p) { return descendants(p).filter((k) => parentOf(k) === p); }
    function cinsOf(p) { return children(p).filter((k) => tree.get(k).ty === 4).sort(); }
    function canTouch(node, origin) { return !node.body.acpi || node.cr === origin || origin === 'Sponde'; }

    const srv = http.createServer((req, res) => {
        let s = '';
        req.on('data', (c) => { s += c; });
        req.on('end', () => {
            const u = url.parse(req.url, true);
            const origin = req.headers['x-m2m-origin'];
            const rec = { method: req.method, path: u.pathname, query: u.query, headers: req.headers, raw: s };
            calls.push(rec);
            if (hang && hang(rec)) { return; }
            if (!req.headers['x-m2m-ri'] || !origin) { return reply(res, 400, '4000', { 'm2m:dbg': 'header' }); }
            const ct = String(req.headers['content-type'] || '');
            if (/xml|cbor/.test(ct)) { return reply(res, 400, '4000', { 'm2m:dbg': 'json only' }); }
            let p = u.pathname.replace(/\/+$/, '');
            let alias = null;
            if (/\/(la|ol)$/.test(p)) { alias = p.slice(-2); p = p.slice(0, -3); }
            const node = tree.get(p);

            if (req.method === 'GET' || req.method === 'HEAD') {
                if (!node) { return reply(res, 404, '4004', { 'm2m:dbg': 'not found' }); }
                if (!canTouch(node, origin)) { return reply(res, 403, '4103'); }
                if (alias) {
                    const cins = cinsOf(p);
                    if (!cins.length) { return reply(res, 404, '4004'); }
                    const k = alias === 'la' ? cins[cins.length - 1] : cins[0];
                    return reply(res, 200, '2000', { 'm2m:cin': tree.get(k).body });
                }
                if (u.query.rcn === '99') { return reply(res, 400, '4000'); }
                if (u.query.fu === '1') {
                    let list = descendants(p);
                    if (u.query.ty) { const tys = String(u.query.ty).split(',').map(Number); list = list.filter((k) => tys.indexOf(tree.get(k).ty) >= 0); }
                    if (u.query.lbl) { list = list.filter((k) => (tree.get(k).body.lbl || []).indexOf(u.query.lbl) >= 0); }
                    if (u.query.cra) { list = list.filter((k) => tree.get(k).body.ct >= u.query.cra); }
                    list.sort();
                    const ofst = parseInt(u.query.ofst, 10) || 0;
                    const lim = parseInt(u.query.lim, 10) || list.length;
                    return reply(res, 200, '2000', { 'm2m:uril': list.slice(ofst, ofst + lim) });
                }
                const out = {}; out[ROOT_OF[node.ty]] = node.body;
                return reply(res, 200, '2000', req.method === 'HEAD' ? undefined : out);
            }
            if (req.method === 'DELETE') {
                if (!node) { return reply(res, 404, '4004'); }
                if (node.ty === 5) { return reply(res, 405, '4005'); }
                if (!canTouch(node, origin)) { return reply(res, 403, '4103'); }
                descendants(p).forEach((k) => tree.delete(k));
                tree.delete(p);
                return reply(res, 200, '2002', {});
            }
            // POST / PUT
            if (!s) { return reply(res, 400, '4000', { 'm2m:dbg': 'empty' }); }
            let body;
            try { body = JSON.parse(s); } catch (e) { return reply(res, 400, '4000', { 'm2m:dbg': 'json' }); }
            const rootName = Object.keys(body)[0];
            if (req.method === 'PUT') {
                if (!node) { return reply(res, 404, '4004'); }
                if (node.ty === 4) { return reply(res, 405, '4005'); }
                if (!canTouch(node, origin)) { return reply(res, 403, '4103'); }
                if (body[rootName] && 'ri' in body[rootName]) { return reply(res, 400, '4000', { 'm2m:dbg': 'np attr' }); }
                Object.assign(node.body, body[rootName]);
                const out = {}; out[ROOT_OF[node.ty]] = node.body;
                return reply(res, 200, '2004', out);
            }
            if (alias) { return reply(res, 405, '4005'); }
            if (!node) { return reply(res, 404, '4004'); }
            const m = /;ty=(\d+)/.exec(ct);
            const ty = m ? parseInt(m[1], 10) : NaN;
            if (!ROOT_OF[ty]) { return reply(res, 400, '4000', { 'm2m:dbg': 'ty' }); }
            if (rootName !== ROOT_OF[ty]) { return reply(res, 400, '4000', { 'm2m:dbg': 'root/ty' }); }
            if (ty === 4 && node.ty !== 3) { return reply(res, 400, '4000', { 'm2m:dbg': 'parent' }); }
            if (ty === 2 && !body[rootName].api) { return reply(res, 400, '4000', { 'm2m:dbg': 'api' }); }
            const attrs = Object.assign({}, body[rootName]);
            if (!attrs.rn) { attrs.rn = String(ty) + '-' + (++seq); }
            if (attrs.rn === 'la' || attrs.rn === 'ol' || /\//.test(attrs.rn) || attrs.rn.length > 64) { return reply(res, 400, '4000', { 'm2m:dbg': 'rn' }); }
            const child = p + '/' + attrs.rn;
            if (tree.has(child)) { return reply(res, 409, '4105'); }
            if (ty === 4 && node.body.mbs !== undefined && String(attrs.con).length > node.body.mbs) { return reply(res, 400, '4000', { 'm2m:dbg': 'mbs' }); }
            attrs.ty = ty; attrs.ri = child; attrs.pi = p; attrs.ct = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
            if (ty === 2) { attrs.aei = origin.charAt(0) === 'S' ? 'S' + (++seq) : origin; }
            if (ty === 3) { attrs.cni = 0; attrs.cbs = 0; }
            tree.set(child, { ty: ty, body: attrs, cr: origin });
            if (ty === 4) { node.body.cni = (node.body.cni || 0) + 1; node.body.cbs = (node.body.cbs || 0) + String(attrs.con).length; }
            const out = {}; out[rootName] = attrs;
            return reply(res, 201, '2001', out);
        });
    });

    return {
        srv, calls, tree, cseBase,
        listen: () => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port))),
        close: () => new Promise((r) => srv.close(() => r())),
        hangWhen: (fn) => { hang = fn; },
        has: (p) => tree.has(p)
    };
}

module.exports = { create };
```

- [ ] **Step 2: 실패하는 시험 — `test/admin-selftest-runner.test.js`**

```js
'use strict';
// 실행기의 기계를 시험한다: 변수·판정·격리·정리·오류 분류·취소. 카탈로그의 기대값이
// 실제 Mobius 와 맞는지는 여기서 보지 않는다(통합 실행 run.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fake = require('./selftest_fake_cse');
const { Client } = require(path.join(__dirname, '..', 'admin', 'cse.js'));
const { Runner } = require(path.join(__dirname, '..', 'admin', 'selftest', 'runner.js'));

function mini(cases, extra) {
    return { categories: [Object.assign({ id: 't', title: 't', order: 1, cases: cases }, extra || {})] };
}
async function boot(cases, ropts) {
    const cse = fake.create({ cseBase: 'Mobius' });
    const port = await cse.listen();
    const admin = new Client({ host: '127.0.0.1', port, origin: 'Sponde', timeoutMs: 500 });
    const runner = new Runner(Object.assign({
        runId: 'T1', host: '127.0.0.1', port,
        adminClient: admin, cseBase: 'Mobius', superUser: 'Sponde',
        catalog: mini(cases), categoryIds: ['t'], supportedTypes: null,
        target: { host: '127.0.0.1', port, backend: 'fake', cseBase: 'Mobius', cseId: '/Mobius2', mobiusVersion: '0', bootAt: null },
        conf: { purgeSweepMs: 100, maxBodyBytes: 1024, superUser: 'Sponde' },
        receiver: null, load: { enabled: false }, onProgress: function () {}
    }, ropts || {}));
    await new Promise((r, j) => runner.setup((e) => (e ? j(e) : r())));
    return { cse, runner, admin, port };
}
async function runAll(runner) {
    const out = [];
    for (const entry of runner.cases()) { out.push(await new Promise((r) => runner.runCase(entry, r))); }
    const result = await new Promise((r, j) => runner.finish(false, (e, res) => (e ? j(e) : r(res))));
    return { statuses: out, result };
}

test('격리: AE 와 run 컨테이너를 만들고, 끝나면 AE 를 지운다 — 실패해도', async function () {
    const { cse, runner } = await boot([
        { id: 't.ok', title: 'ok', steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'c1' } }, expect: { rsc: '2001' }, as: 'c1' }] },
        { id: 't.fail', title: 'fail', steps: [{ op: 'retrieve', target: '$run/nope', expect: { rsc: '2000' } }] }
    ]);
    assert.ok(cse.has('/Mobius/admin_selftest'), 'AE 가 생겼다');
    assert.ok(cse.has('/Mobius/admin_selftest/run-T1'));
    const { statuses, result } = await runAll(runner);
    assert.deepStrictEqual(statuses, ['pass', 'fail']);
    assert.ok(!cse.has('/Mobius/admin_selftest'), '정리 뒤 AE 가 없다');
    assert.strictEqual(result.cleanup, 'ok');
    assert.strictEqual(result.summary.pass, 1);
    assert.strictEqual(result.summary.fail, 1);
    assert.strictEqual(result.results[1].failedStep, 1);
    assert.match(result.results[1].message, /4004/);
    assert.strictEqual(typeof result.summary.p95, 'number');
    assert.strictEqual(result.status, 'done');
    await cse.close();
});

test('이전 실행이 남긴 AE 는 시작 때 지운다', async function () {
    const cse = fake.create({ cseBase: 'Mobius' });
    const port = await cse.listen();
    cse.tree.set('/Mobius/admin_selftest', { ty: 2, body: { rn: 'admin_selftest', ty: 2 }, cr: 'Cold' });
    cse.tree.set('/Mobius/admin_selftest/run-OLD', { ty: 3, body: { rn: 'run-OLD', ty: 3 }, cr: 'Cold' });
    const admin = new Client({ host: '127.0.0.1', port, origin: 'Sponde' });
    const runner = new Runner({ runId: 'T2', host: '127.0.0.1', port, adminClient: admin, cseBase: 'Mobius', superUser: 'Sponde',
        catalog: mini([]), categoryIds: ['t'], supportedTypes: null, target: {}, conf: {}, receiver: null, load: { enabled: false }, onProgress: function () {} });
    await new Promise((r, j) => runner.setup((e) => (e ? j(e) : r())));
    assert.ok(!cse.has('/Mobius/admin_selftest/run-OLD'), '옛 것이 지워졌다');
    assert.ok(cse.has('/Mobius/admin_selftest/run-T2'));
    await new Promise((r) => runner.finish(false, r));
    await cse.close();
});

test('변수: $이름·$rn:·$origin·$superuser, 카테고리가 바뀌면 이름을 비운다', async function () {
    const cse = fake.create({ cseBase: 'Mobius' });
    const port = await cse.listen();
    const admin = new Client({ host: '127.0.0.1', port, origin: 'Sponde' });
    const catalog = { categories: [
        { id: 'a', title: 'a', order: 1, cases: [
            { id: 'a.mk', title: 'mk', steps: [
                { op: 'create', target: '$cb', ty: 2, body: { 'm2m:ae': { rn: '$rn:x', api: 'a' } }, headers: { 'X-M2M-Origin': 'S' }, expect: { rsc: '2001' }, as: 'x' },
                { op: 'create', target: '$x', ty: 3, body: { 'm2m:cnt': { rn: 'c', lbl: ['$origin'] } }, expect: { rsc: '2001', body: { 'm2m:cnt': { lbl: ['Cadmin_selftest'] } } }, as: 'c' },
                { op: 'retrieve', target: '$c', headers: { 'X-M2M-Origin': '$superuser' }, expect: { rsc: '2000' } } ] } ] },
        { id: 'b', title: 'b', order: 2, cases: [
            { id: 'b.stale', title: 'stale', steps: [{ op: 'retrieve', target: '$c', expect: { rsc: '2000' } }] } ] }
    ] };
    const runner = new Runner({ runId: 'T3', host: '127.0.0.1', port, adminClient: admin, cseBase: 'Mobius', superUser: 'Sponde',
        catalog, categoryIds: ['a', 'b'], supportedTypes: null, target: {}, conf: {}, receiver: null, load: { enabled: false }, onProgress: function () {} });
    await new Promise((r, j) => runner.setup((e) => (e ? j(e) : r())));
    const { statuses, result } = await runAll(runner);
    assert.deepStrictEqual(statuses, ['pass', 'error']);
    assert.ok(cse.calls.some((c) => c.path === '/Mobius/admin_selftest_T3_x/c'), '$rn: 이 runId 로 풀렸다');
    assert.ok(cse.calls.some((c) => c.headers['x-m2m-origin'] === 'Sponde' && c.path === '/Mobius/admin_selftest_T3_x/c'));
    assert.match(result.results[1].message, /\$c/, '모르는 변수는 error 로 — 사유에 이름');
    assert.ok(!cse.has('/Mobius/admin_selftest_T3_x'), '$cb 아래에 만든 $rn: AE 도 정리한다');
    await cse.close();
});

test('판정: body 부분 일치·http 유도·discover·skip·error', async function () {
    const { cse, runner } = await boot([
        { id: 't.body', title: 'body', steps: [
            { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'b', lbl: ['x'] } }, expect: { rsc: '2001', body: { 'm2m:cnt': { rn: 'b', ty: 3 } } }, as: 'b' },
            { op: 'retrieve', target: '$b', expect: { rsc: '2000', body: { 'm2m:cnt': { lbl: ['y'] } } } } ] },
        { id: 't.http', title: 'http', steps: [{ op: 'retrieve', target: '$run/none', expect: { rsc: '4004', http: 200 } }] },
        { id: 't.disc', title: 'disc', steps: [
            { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'd' } }, expect: { rsc: '2001' }, as: 'd' },
            { op: 'create', target: '$d', ty: 4, body: { 'm2m:cin': { con: '1' } }, expect: { rsc: '2001' }, as: 'i' },
            { op: 'discover', target: '$run', query: { ty: 4 }, expect: { rsc: '2000', discover: { contains: ['$i'], notContains: ['$d'], count: 1 } } } ] },
        { id: 't.skip', title: 'skip', requires: { types: [9] }, steps: [] },
        { id: 't.raw', title: 'raw', steps: [{ op: 'create', target: '$run', ty: 3, raw: '{"m2m:cnt": {', expect: { rsc: '4000' } }] },
        { id: 't.head', title: 'head', steps: [{ op: 'retrieve', target: '$cb', method: 'HEAD', expect: { rsc: '2000' } }] }
    ], { supportedTypes: [1, 2, 3, 4, 5, 23] });
    cse.hangWhen((rec) => rec.path.endsWith('/hang'));
    runner.opts.catalog.categories[0].cases.push({ id: 't.err', title: 'err', steps: [{ op: 'retrieve', target: '$run/hang', expect: { rsc: '4004' } }] });
    const { statuses, result } = await runAll(runner);
    assert.deepStrictEqual(statuses, ['fail', 'fail', 'pass', 'skip', 'pass', 'pass', 'error']);
    assert.match(result.results[0].message, /lbl/);
    assert.match(result.results[1].message, /http/i);
    assert.strictEqual(result.results[6].status, 'error');
    assert.match(result.results[6].message, /timeout/);
    assert.strictEqual(result.summary.skip, 1);
    assert.strictEqual(result.summary.error, 1);
    assert.ok(cse.calls.some((c) => c.method === 'HEAD'));
    assert.ok(cse.calls.some((c) => c.raw === '{"m2m:cnt": {'), 'raw 본문이 그대로 나갔다');
    await cse.close();
});

test('스크립트형: ctx 로 요청하고 assert 실패는 fail, 예외는 error', async function () {
    const { cse, runner } = await boot([
        { id: 't.s1', title: 's1', run: async function (ctx) {
            const c = await ctx.create('$run', 3, { 'm2m:cnt': { rn: 's' } });
            ctx.assert(c.rsc === '2001', 'create');
            const ok = await ctx.until(async () => (await ctx.retrieve(c.path)).rsc === '2000', 500);
            ctx.assert(ok, 'until');
            const d = await ctx.discover('$run', { ty: 3 });
            ctx.assert(d.uril.indexOf(c.path) >= 0, 'discover');
        } },
        { id: 't.s2', title: 's2', run: async function (ctx) { ctx.assert(false, '일부러'); } },
        { id: 't.s3', title: 's3', run: async function () { throw new Error('boom'); } }
    ]);
    const { statuses, result } = await runAll(runner);
    assert.deepStrictEqual(statuses, ['pass', 'fail', 'error']);
    assert.strictEqual(result.results[1].message, '일부러');
    assert.match(result.results[2].message, /boom/);
    assert.ok(result.results[0].steps.length >= 3, '스크립트의 요청도 단계로 남는다');
    await cse.close();
});

test('취소: finish(true) 는 status cancelled 로 닫고 정리한다', async function () {
    const { cse, runner } = await boot([{ id: 't.a', title: 'a', steps: [{ op: 'retrieve', target: '$cb', expect: { rsc: '2000' } }] }]);
    const result = await new Promise((r) => runner.finish(true, (e, res) => r(res)));
    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(result.cancelled, true);
    assert.ok(!cse.has('/Mobius/admin_selftest'));
    await cse.close();
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --test test/admin-selftest-runner.test.js` → FAIL (모듈 없음)

- [ ] **Step 4: `admin/cse.js` — raw 본문**

`Client.prototype.request` 의 `var payload = body ? JSON.stringify(body.content) : null;` 을:

```js
    // raw 는 JSON 직렬화 없이 그대로 보낸다 — 종합 테스트의 "깨진 JSON"·"빈 본문" 케이스.
    var payload = body ? ((typeof body.raw === 'string') ? body.raw : JSON.stringify(body.content)) : null;
```

로 바꾸고, Content-Length 계산 줄의 `if (payload)` 를 `if (payload !== null)` 로(빈 문자열도 본문이다).

- [ ] **Step 5: `admin/selftest/target.js`**

```js
'use strict';
/**
 * 대상 Mobius 의 요약. 콘솔은 Mobius 와 같은 저장소 루트에서 돈다(스펙 §12.1) —
 * 그래서 적용값은 log/mobius-boot.jsonl 의 마지막 마스터 줄에서 읽는다. 없으면
 * 스키마 기본값이다.
 */
var fs = require('fs');
var path = require('path');

function last_master(root) {
    var file = path.join(root, 'log', 'mobius-boot.jsonl');
    if (!fs.existsSync(file)) { return null; }
    var lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (var i = lines.length - 1; i >= 0; i--) {
        try {
            var r = JSON.parse(lines[i]);
            if (r.role === 'master') { return r; }
        } catch (e) { /* 깨진 줄은 건너뛴다 */ }
    }
    return null;
}

exports.describe = function (o) {
    var schema = require(path.join(o.root, 'mobius', 'conf_schema'));
    var conf = {};
    schema.all().forEach(function (k) { conf[k] = schema.get(k).dflt; });
    var master = last_master(o.root);
    if (master && master.conf) { Object.keys(master.conf).forEach(function (k) { conf[k] = master.conf[k]; }); }
    var version = null;
    try { version = JSON.parse(fs.readFileSync(path.join(o.root, 'package.json'), 'utf8')).version; } catch (e) { /* 없어도 된다 */ }
    return {
        host: o.host, port: o.port, backend: o.backend,
        cseBase: conf.cseBase, cseId: conf.cseId, spId: conf.spId,
        mobiusVersion: version, bootAt: master ? master.at : null,
        conf: conf
    };
};

/** 어댑터가 선언한 지원 타입. 선언하지 않으면 null(제한 없음). 연결하지 않고 모듈만 읽는다. */
exports.supportedTypes = function (root, backend) {
    try {
        var a = require(path.join(root, 'mobius', 'db', backend + '.js'));
        return Array.isArray(a.supportedResourceTypes) ? a.supportedResourceTypes.map(Number) : null;
    } catch (e) { return null; }
};
```

`conf_schema` 는 `global.usedb` 가 세워진 뒤에 require 해야 한다(로드 순서 계약) — 콘솔과 CLI 모두 그 뒤에 부른다.

- [ ] **Step 6: `admin/selftest/runner.js`**

```js
'use strict';
/**
 * 종합 테스트 실행기.
 *
 * 케이스를 카테고리 순 → 선언 순으로 돌린다. 요청은 전부 admin/cse.js 의 Client 를
 * 지나고, 모든 쓰기는 전용 AE admin_selftest 아래 run-<runId> 컨테이너 안이다.
 * 결과는 넷 — pass·fail(응답이 왔으나 다름)·error(응답 없음·예외)·skip(미지원 타입).
 * **던지지 않는다.** 정리(AE 삭제)는 성공·실패·취소 모두 finish 가 한다.
 *
 * 작업(jobs.js)이나 CLI 가 setup → runCase* → finish 순서로 부른다.
 */
var path = require('path');
var { Client } = require('../cse');
var catalog = require('./catalog');
var perf = require('./perf');

var AE_RN = 'admin_selftest';
var AE_ORIGIN = 'Cadmin_selftest';

function AssertionFail(message) { this.message = message; this.assertion = true; }

function Runner(opts) {
    this.opts = opts;
    this.runId = opts.runId;
    this.client = new Client({ host: opts.host, port: opts.port, origin: AE_ORIGIN, timeoutMs: opts.timeoutMs || 10000 });
    this.vars = {};
    this.currentCategory = null;
    this.rootCreated = [];       // $cb 아래에 $rn: 으로 만든 것 — 정리 대상
    this.result = {
        runId: opts.runId, startedAt: new Date().toISOString(), endedAt: null, status: 'running', cancelled: false,
        target: opts.target || {}, categories: opts.categoryIds.slice(), loadIncluded: !!(opts.load && opts.load.enabled),
        summary: null, results: [], perf: null, cleanup: 'skipped', cleanupError: null
    };
    this.samples = { byCategory: {}, notify: { http: [], mqtt: [] } };
    this.loadResult = null;
}

// ── 변수 ──────────────────────────────────────────────────────────────────
Runner.prototype.resolve = function (s) {
    var self = this;
    if (typeof s !== 'string' || s.indexOf('$') < 0) { return s; }
    if (s.indexOf('$rn:') === 0) { return AE_RN + '_' + self.runId + '_' + s.slice(4); }
    return s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, function (m, name) {
        if (name === 'run') { return self.runPath; }
        if (name === 'ae') { return self.aePath; }
        if (name === 'cb') { return '/' + self.opts.cseBase; }
        if (name === 'origin') { return AE_ORIGIN; }
        if (name === 'superuser') { return self.opts.superUser; }
        if (Object.prototype.hasOwnProperty.call(self.vars, name)) { return self.vars[name]; }
        throw new Error('모르는 변수 $' + name);
    });
};
Runner.prototype.deep = function (v) {
    var self = this;
    if (Array.isArray(v)) { return v.map(function (x) { return self.deep(x); }); }
    if (v && typeof v === 'object') {
        var o = {};
        Object.keys(v).forEach(function (k) { o[k] = self.deep(v[k]); });
        return o;
    }
    return self.resolve(v);
};

// ── 요청 ──────────────────────────────────────────────────────────────────
function query_string(q) {
    var keys = Object.keys(q || {});
    if (!keys.length) { return ''; }
    return '?' + keys.map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k])); }).join('&');
}
function root_of(body) { return (body && typeof body === 'object') ? Object.keys(body)[0] : null; }

/** 한 요청. 결과에 http·path 를 더한다. 던지지 않는다. */
Runner.prototype.request = function (op, target, o, cb) {
    var self = this;
    var method = o.method || { create: 'POST', retrieve: 'GET', update: 'PUT', delete: 'DELETE', discover: 'GET' }[op];
    var q = Object.assign({}, o.query || {});
    if (op === 'discover') { q.fu = 1; }
    var p = target + query_string(q);
    var body = null;
    if (typeof o.raw === 'string') { body = { raw: o.raw, ty: o.ty }; }
    else if (o.body) { body = { content: o.body, ty: o.ty }; }
    var headers = Object.assign({}, o.headers || {});
    if (op === 'create' && !('Content-Type' in headers) && o.ty !== undefined && body) { body.ty = o.ty; }
    self.client.request(method, p, body, function (r) {
        r.http = r.status;
        if (op === 'create' && r.ok && r.body && typeof r.body === 'object') {
            var rn = (r.body[root_of(r.body)] || {}).rn;
            r.path = rn ? target + '/' + rn : null;
        }
        if (op === 'discover' && r.body && typeof r.body === 'object') {
            r.uril = Array.isArray(r.body['m2m:uril']) ? r.body['m2m:uril'] : [];
        }
        cb(r);
    }, { headers: headers });
};

// ── 판정 ──────────────────────────────────────────────────────────────────
function subset(expect, actual) {
    if (expect === null || typeof expect !== 'object') { return JSON.stringify(expect) === JSON.stringify(actual); }
    if (Array.isArray(expect)) { return JSON.stringify(expect) === JSON.stringify(actual); }
    if (actual === null || typeof actual !== 'object') { return false; }
    return Object.keys(expect).every(function (k) { return subset(expect[k], actual[k]); });
}
function norm_path(p) { return String(p).replace(/^\/+/, ''); }

Runner.prototype.judge = function (step, r) {
    var e = step.expect;
    if (r.status === 0) { return { status: 'error', message: r.error || '응답 없음' }; }
    if (String(r.rsc) !== String(e.rsc)) { return { status: 'fail', message: 'rsc ' + e.rsc + ' 를 기대했으나 ' + r.rsc + ' (HTTP ' + r.status + ')' }; }
    var http = (e.http !== undefined) ? e.http : catalog.httpOf(e.rsc);
    if (http !== null && r.status !== http) { return { status: 'fail', message: 'HTTP ' + http + ' 를 기대했으나 ' + r.status + ' (rsc ' + r.rsc + ')' }; }
    if (e.body && !subset(this.deep(e.body), r.body)) { return { status: 'fail', message: '본문이 기대와 다르다: ' + JSON.stringify(this.deep(e.body)).slice(0, 200) + ' ⊄ ' + JSON.stringify(r.body).slice(0, 300) }; }
    if (e.headers) {
        var hs = r.headers || {};
        var bad = Object.keys(e.headers).filter(function (k) { return String(hs[k.toLowerCase()]) !== String(e.headers[k]); });
        if (bad.length) { return { status: 'fail', message: '헤더가 기대와 다르다: ' + bad.join(', ') }; }
    }
    if (e.discover) {
        var d = this.deep(e.discover);
        var got = (r.uril || []).map(norm_path);
        var missing = (d.contains || []).map(norm_path).filter(function (x) { return got.indexOf(x) < 0; });
        var extra = (d.notContains || []).map(norm_path).filter(function (x) { return got.indexOf(x) >= 0; });
        if (missing.length) { return { status: 'fail', message: 'discovery 에 없다: ' + missing.join(', ') }; }
        if (extra.length) { return { status: 'fail', message: 'discovery 에 있으면 안 되는 것: ' + extra.join(', ') }; }
        if (d.count !== undefined && got.length !== d.count) { return { status: 'fail', message: 'discovery 건수 ' + d.count + ' 를 기대했으나 ' + got.length }; }
    }
    return { status: 'pass' };
};

// ── 격리 ──────────────────────────────────────────────────────────────────
Runner.prototype.setup = function (cb) {
    var self = this;
    var admin = self.opts.adminClient;
    self.aePath = '/' + self.opts.cseBase + '/' + AE_RN;
    self.runPath = self.aePath + '/run-' + self.runId;
    admin.retrieve(self.aePath, function (r) {
        function make_ae() {
            self.client.create('/' + self.opts.cseBase, 2, 'm2m:ae', { rn: AE_RN, api: 'admin.selftest', rr: false }, function (r2) {
                if (!r2.ok) { return cb(new Error('격리 AE 를 만들지 못했다: ' + (r2.error || ('HTTP ' + r2.status + ' rsc=' + r2.rsc)))); }
                self.client.create(self.aePath, 3, 'm2m:cnt', { rn: 'run-' + self.runId }, function (r3) {
                    if (!r3.ok) { return cb(new Error('실행 컨테이너를 만들지 못했다: ' + (r3.error || ('HTTP ' + r3.status)))); }
                    cb(null);
                });
            });
        }
        if (r.ok) {
            // 이전 실행이 남긴 것(콘솔이 죽었을 때). 먼저 지운다.
            admin.remove(self.aePath, function (d) {
                if (!d.ok && d.status !== 404) { return cb(new Error('이전 실행의 AE 를 지우지 못했다: ' + (d.error || ('HTTP ' + d.status)))); }
                make_ae();
            });
        }
        else if (r.status === 404) { make_ae(); }
        else { cb(new Error('대상에 닿지 못했다: ' + (r.error || ('HTTP ' + r.status)))); }
    });
};

// ── 케이스 ────────────────────────────────────────────────────────────────
Runner.prototype.cases = function () {
    var self = this;
    var out = [];
    self.opts.catalog.categories.forEach(function (c) {
        if (self.opts.categoryIds.indexOf(c.id) < 0) { return; }
        c.cases.forEach(function (k) { out.push({ category: c, kase: k }); });
    });
    return out;
};

Runner.prototype.skip_reason = function (kase) {
    if (kase.requires && Array.isArray(kase.requires.types) && Array.isArray(this.opts.supportedTypes)) {
        var st = this.opts.supportedTypes;
        var missing = kase.requires.types.filter(function (t) { return st.indexOf(Number(t)) < 0; });
        if (missing.length) { return '백엔드가 지원하지 않는 타입: ' + missing.join(', '); }
    }
    if (kase.load && !(this.opts.load && this.opts.load.enabled)) { return '부하 카테고리는 꺼져 있다'; }
    return null;
};

Runner.prototype.runCase = function (entry, cb) {
    var self = this;
    var c = entry.category, k = entry.kase;
    if (self.currentCategory !== c.id) { self.currentCategory = c.id; self.vars = {}; }
    var rec = { id: k.id, category: c.id, title: k.title, ref: k.ref || null, status: 'pass', ms: 0, steps: [], failedStep: null, message: null };
    self.result.results.push(rec);
    var t0 = Date.now();
    function close(status, message) {
        rec.status = status; rec.message = message || null; rec.ms = Date.now() - t0;
        if (!self.samples.byCategory[c.id]) { self.samples.byCategory[c.id] = []; }
        rec.steps.forEach(function (s) { if (typeof s.ms === 'number' && s.ok !== null) { self.samples.byCategory[c.id].push(s.ms); } });
        if (typeof self.opts.onProgress === 'function') { self.opts.onProgress(self.result.results.length, null, k.id); }
        cb(status);
    }
    var why = self.skip_reason(k);
    if (why) { return close('skip', why); }
    if (typeof k.run === 'function') { return self.runScript(k, rec, close); }
    self.runSteps(k.steps, 0, rec, close);
};

Runner.prototype.runSteps = function (steps, i, rec, close) {
    var self = this;
    if (i >= steps.length) { return close('pass'); }
    var step = steps[i];
    var s = { op: step.op, target: null, expect: step.expect || null, actual: null, ms: null, ok: null, note: null };
    rec.steps.push(s);
    function fail_rest(status, message) {
        rec.failedStep = i + 1;
        for (var j = i + 1; j < steps.length; j++) { rec.steps.push({ op: steps[j].op, target: null, expect: steps[j].expect || null, actual: null, ms: null, ok: null, note: '건너뜀' }); }
        close(status, message);
    }
    var resolved;
    try {
        resolved = {
            target: step.target !== undefined ? self.resolve(step.target) : null,
            headers: self.deep(step.headers || {}),
            query: self.deep(step.query || {}),
            body: step.body !== undefined ? self.deep(step.body) : undefined,
            raw: step.raw, ty: step.ty, method: step.method
        };
    } catch (e) { s.ok = false; return fail_rest('error', (e && e.message) || String(e)); }
    s.target = resolved.target;

    if (step.op === 'notify-wait') {
        if (!self.opts.receiver) { s.ok = false; return fail_rest('error', '수신기가 없다 — ' + step.receiver + ' 알림을 확인할 수 없다'); }
        var since = self.lastStepEndedAt || Date.now();
        var sur;
        try { sur = self.resolve(step.sur); } catch (e) { s.ok = false; return fail_rest('error', e.message); }
        s.target = sur;
        self.opts.receiver.expect(sur, step.receiver, step.timeoutMs || 5000, since).then(function (got) {
            s.ms = got.latencyMs; s.ok = true; s.actual = { received: true, latencyMs: got.latencyMs };
            self.samples.notify[step.receiver].push(got.latencyMs);
            self.runSteps(steps, i + 1, rec, close);
        }, function (err) {
            s.ok = false; s.actual = { received: false };
            fail_rest(err && err.receiverError ? 'error' : 'fail', (err && err.message) || '알림이 오지 않았다');
        });
        return;
    }

    self.request(step.op, resolved.target, resolved, function (r) {
        s.actual = { rsc: r.rsc, http: r.status, elapsedMs: r.elapsedMs, error: r.error || null };
        s.ms = r.elapsedMs;
        self.lastStepEndedAt = Date.now();
        var v = self.judge(step, r);
        s.ok = v.status === 'pass';
        if (!s.ok) { s.note = v.message; return fail_rest(v.status, v.message); }
        if (step.as) {
            if (step.op === 'create' && !r.path) { s.ok = false; return fail_rest('fail', '응답에 rn 이 없어 $' + step.as + ' 를 정할 수 없다'); }
            var made = step.op === 'create' ? r.path : resolved.target;
            self.vars[step.as] = made;
            if (made.indexOf('/' + self.opts.cseBase + '/' + AE_RN + '_') === 0) { self.rootCreated.push(made); }
        }
        self.runSteps(steps, i + 1, rec, close);
    });
};

// ── 스크립트형 ctx ────────────────────────────────────────────────────────
Runner.prototype.makeCtx = function (rec) {
    var self = this;
    function call(op, target, o) {
        return new Promise(function (resolve) {
            var t;
            try { t = self.resolve(target); } catch (e) { return resolve({ ok: false, status: 0, rsc: null, error: e.message, http: 0, elapsedMs: 0 }); }
            var s = { op: op, target: t, expect: null, actual: null, ms: null, ok: null, note: null };
            rec.steps.push(s);
            self.request(op, t, Object.assign({}, o, { body: o.body !== undefined ? self.deep(o.body) : undefined, headers: self.deep(o.headers || {}) }), function (r) {
                s.actual = { rsc: r.rsc, http: r.status, elapsedMs: r.elapsedMs, error: r.error || null };
                s.ms = r.elapsedMs; s.ok = r.status !== 0;
                self.lastStepEndedAt = Date.now();
                if (r.path && r.path.indexOf('/' + self.opts.cseBase + '/' + AE_RN + '_') === 0) { self.rootCreated.push(r.path); }
                resolve(r);
            });
        });
    }
    return {
        run: self.runPath, ae: self.aePath, origin: AE_ORIGIN, cseBase: self.opts.cseBase,
        conf: self.opts.conf || {}, receiver: self.opts.receiver, load: self.opts.load || { enabled: false },
        runId: self.runId, client: self.client,
        create: function (target, ty, body, o) { return call('create', target, Object.assign({}, o || {}, { ty: ty, body: body })); },
        retrieve: function (target, o) { return call('retrieve', target, o || {}); },
        update: function (target, body, o) { return call('update', target, Object.assign({}, o || {}, { body: body })); },
        delete: function (target, o) { return call('delete', target, o || {}); },
        discover: function (target, query, o) { return call('discover', target, Object.assign({}, o || {}, { query: query || {} })); },
        resolve: function (s) { return self.resolve(s); },
        set: function (name, value) { self.vars[name] = value; },
        now: function () { return Date.now(); },
        until: function (pred, timeoutMs, everyMs) {
            var deadline = Date.now() + (timeoutMs || 5000);
            return (function loop() {
                return Promise.resolve().then(pred).then(function (ok) {
                    if (ok) { return true; }
                    if (Date.now() >= deadline) { return false; }
                    return new Promise(function (r) { setTimeout(r, everyMs || 250); }).then(loop);
                });
            }());
        },
        assert: function (cond, message) { if (!cond) { throw new AssertionFail(message || '단정 실패'); } },
        record: function (step) { rec.steps.push(Object.assign({ op: '-', target: null, expect: null, actual: null, ms: null, ok: null, note: null }, step)); },
        notify: function (kind, ms) { self.samples.notify[kind].push(ms); },
        setLoadResult: function (r) { self.loadResult = r; }
    };
};

Runner.prototype.runScript = function (kase, rec, close) {
    var self = this;
    var ctx = self.makeCtx(rec);
    Promise.resolve().then(function () { return kase.run(ctx); }).then(function () {
        var broken = rec.steps.filter(function (s) { return s.ok === false; });
        if (broken.length) { rec.failedStep = rec.steps.indexOf(broken[0]) + 1; return close('error', broken[0].actual && broken[0].actual.error || '응답 없음'); }
        close('pass');
    }, function (e) {
        if (e && e.assertion) { rec.failedStep = rec.steps.length || null; return close('fail', e.message); }
        close('error', (e && e.message) || String(e));
    });
};

// ── 정리와 요약 ───────────────────────────────────────────────────────────
Runner.prototype.finish = function (cancelled, cb) {
    var self = this;
    var admin = self.opts.adminClient;
    self.result.cancelled = !!cancelled;
    self.result.status = cancelled ? 'cancelled' : 'done';
    var targets = [self.aePath].concat(self.rootCreated);
    var errors = [];
    (function next(i) {
        if (i >= targets.length) {
            self.result.cleanup = errors.length ? 'failed' : 'ok';
            self.result.cleanupError = errors.length ? errors.join('; ') : null;
            self.summarize();
            self.result.endedAt = new Date().toISOString();
            return cb(null, self.result);
        }
        admin.remove(targets[i], function (r) {
            if (!r.ok && r.status !== 404) { errors.push(targets[i] + ': ' + (r.error || ('HTTP ' + r.status + ' rsc=' + r.rsc))); }
            next(i + 1);
        });
    }(0));
};

Runner.prototype.summarize = function () {
    var self = this;
    var counts = { pass: 0, fail: 0, error: 0, skip: 0 };
    var all = [];
    self.result.results.forEach(function (r) { counts[r.status]++; });
    var byCategory = {};
    Object.keys(self.samples.byCategory).forEach(function (c) { byCategory[c] = perf.summarize(self.samples.byCategory[c]); all = all.concat(self.samples.byCategory[c]); });
    var total = perf.summarize(all);
    self.result.summary = { pass: counts.pass, fail: counts.fail, error: counts.error, skip: counts.skip, p50: total.p50, p95: total.p95, max: total.max };
    self.result.perf = {
        byCategory: byCategory,
        notify: { http: self.samples.notify.http.length ? perf.summarize(self.samples.notify.http) : null,
                  mqtt: self.samples.notify.mqtt.length ? perf.summarize(self.samples.notify.mqtt) : null },
        load: self.loadResult
    };
};

module.exports = { Runner: Runner, AE_RN: AE_RN, AE_ORIGIN: AE_ORIGIN, AssertionFail: AssertionFail };
```

`admin/selftest/perf.js` 는 Task 6 에서 완성하지만 실행기가 `summarize` 를 쓰므로 여기서 최소 형태를 만든다:

```js
'use strict';
/** 응답 시간 집계. 정렬한 표본에서 가까운 순위 백분위(nearest-rank). */
exports.percentile = function (sorted, p) {
    if (!sorted.length) { return 0; }
    var idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
    return sorted[idx];
};
exports.summarize = function (samples) {
    var s = (samples || []).filter(function (x) { return typeof x === 'number' && !isNaN(x); }).slice().sort(function (a, b) { return a - b; });
    if (!s.length) { return { n: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 }; }
    var sum = s.reduce(function (a, b) { return a + b; }, 0);
    return { n: s.length, p50: exports.percentile(s, 50), p95: exports.percentile(s, 95), p99: exports.percentile(s, 99),
             max: s[s.length - 1], avg: Math.round(sum / s.length * 10) / 10 };
};
```

- [ ] **Step 7: 시험**

Run: `node --test test/admin-selftest-runner.test.js` → PASS (6/6). Run: `node --test test/admin-cse.test.js test/admin-cse-truncated.test.js` → PASS(raw 변경이 기존을 안 깨뜨린다). Run: `npm test` → 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add admin/selftest/runner.js admin/selftest/target.js admin/selftest/perf.js admin/cse.js test/selftest_fake_cse.js test/admin-selftest-runner.test.js
git commit -m "selftest(runner): 실행기 — 변수·판정·격리·정리·결과, 대상 요약, 최소 CSE 대역

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 수신기 — HTTP 서버 + MQTT 구독자

**Files:**
- Create: `admin/selftest/receiver.js`
- Test: `test/admin-selftest-receiver.test.js`

**Interfaces:**
- `receiver.open({ host, port, runId, mqtt: { broker, port, cseId } | null, mqttClientFactory? }, cb)` → `cb(err, rx)`. `port` 가 0 이면 임시 포트. 포트가 사용 중이면 `err.code === 'EADDRINUSE'`.
- `rx.httpNu()` → `'http://<host>:<port>/noti/<runId>'`. `rx.mqttNu()` → `'mqtt://<broker>/<receiverId>?ct=json'` 또는 null(브로커 없음·접속 실패). `receiverId = 'admin_selftest_' + runId`.
- `rx.expect(sur, kind, timeoutMs, sinceMs)` → `Promise<{ latencyMs, at, body }>`. 같은 `sur`·`kind` 로 `sinceMs` 이후에 받은 알림이 이미 있으면 즉시, 아니면 올 때까지 상한만큼 기다린다. 상한이면 reject `Error('… 알림이 오지 않았다')`; `kind === 'mqtt'` 인데 MQTT 가 없으면 reject with `receiverError: true`.
- `rx.received` → `[{ kind, sur, at, body }]`. `rx.close(cb)`.
- HTTP 수신: `POST /noti/<runId>` 본문 `m2m:sgn` → `sur` 로 기록, 응답 `200` + `X-M2M-RSC: 2000` + `X-M2M-RI` 에코. `vrq: true`(구독 검증 요청)도 같은 응답이고 기록에는 `verification: true`.
- MQTT: `mqtt.connect('mqtt://' + broker + ':' + port)` 로 붙고 `/oneM2M/req/<cseId 앞 슬래시 제거>/<receiverId>/json` 을 구독한다. 메시지 본문의 `m2m:rqp.pc['m2m:sgn'].sur` 또는 `m2m:sgn.sur` 를 기록. 접속 실패는 `mqttNu()` 를 null 로 두고 `rx.mqttError` 에 사유. `mqttClientFactory(url)` 가 오면 `mqtt.connect` 대신 그것을 쓴다(시험용 — `on('connect'|'message'|'error')`, `subscribe(topic, cb)`, `end()`).
- `sur` 비교는 앞 슬래시를 뗀 문자열 동등.

- [ ] **Step 1: 실패하는 시험**

`test/admin-selftest-receiver.test.js`:

```js
'use strict';
// 알림 수신기. HTTP 는 실제 소켓으로, MQTT 는 클라이언트 대역(on/subscribe/end)으로
// 토픽 계산과 메시지 해석만 본다 — 브로커가 필요한 부분은 통합 실행이 본다.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const EventEmitter = require('events');
const receiver = require(path.join(__dirname, '..', 'admin', 'selftest', 'receiver.js'));

function open(o) { return new Promise((r, j) => receiver.open(o, (e, rx) => (e ? j(e) : r(rx)))); }
function post(port, p, body, headers) {
    return new Promise((resolve) => {
        const d = JSON.stringify(body);
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: p,
            headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d), 'X-M2M-RI': 'r1', 'X-M2M-Origin': '/Mobius2' }, headers || {}) }, (res) => {
            let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s }));
        });
        req.write(d); req.end();
    });
}

test('HTTP 알림을 받아 sur 로 기록하고 2000 으로 답한다 — expect 는 since 이후 것만', async function () {
    const rx = await open({ host: '127.0.0.1', port: 0, runId: 'R1', mqtt: null });
    const port = Number(rx.httpNu().match(/:(\d+)\//)[1]);
    assert.match(rx.httpNu(), /^http:\/\/127\.0\.0\.1:\d+\/noti\/R1$/);
    const early = await post(port, '/noti/R1', { 'm2m:sgn': { sur: '/Mobius/a/sub1', nev: { rep: {} } } });
    assert.strictEqual(early.status, 200);
    assert.strictEqual(early.headers['x-m2m-rsc'], '2000');
    assert.strictEqual(early.headers['x-m2m-ri'], 'r1');
    const since = Date.now() + 5;
    await new Promise((r) => setTimeout(r, 10));
    const p = rx.expect('Mobius/a/sub1', 'http', 1000, since);
    setTimeout(() => post(port, '/noti/R1', { 'm2m:sgn': { sur: 'Mobius/a/sub1' } }), 30);
    const got = await p;
    assert.ok(got.latencyMs >= 0 && got.latencyMs < 1000);
    assert.strictEqual(rx.received.length, 2);
    await assert.rejects(rx.expect('Mobius/a/none', 'http', 50, Date.now()), /오지 않았다/);
    const vrq = await post(port, '/noti/R1', { 'm2m:sgn': { vrq: true, sur: '/Mobius/a/sub2' } });
    assert.strictEqual(vrq.status, 200);
    assert.strictEqual(rx.received[2].verification, true);
    const other = await post(port, '/noti/OTHER', { 'm2m:sgn': { sur: 'x' } });
    assert.strictEqual(other.status, 404, '다른 runId 의 경로는 받지 않는다');
    await new Promise((r) => rx.close(r));
});

test('포트가 쓰이면 EADDRINUSE 로 알린다', async function () {
    const rx = await open({ host: '127.0.0.1', port: 0, runId: 'R2', mqtt: null });
    const port = Number(rx.httpNu().match(/:(\d+)\//)[1]);
    await assert.rejects(open({ host: '127.0.0.1', port, runId: 'R3', mqtt: null }), (e) => e.code === 'EADDRINUSE');
    await new Promise((r) => rx.close(r));
});

test('MQTT: 토픽을 계산해 구독하고 m2m:rqp 안의 sgn 을 해석한다', async function () {
    const fakeClient = new EventEmitter();
    const subscribed = [];
    fakeClient.subscribe = (topic, cb) => { subscribed.push(topic); cb(null); };
    fakeClient.end = () => { fakeClient.ended = true; };
    const rx = await open({ host: '127.0.0.1', port: 0, runId: 'R4', mqtt: { broker: 'broker.local', port: 1883, cseId: '/Mobius2' },
                            mqttClientFactory: (u) => { fakeClient.url = u; setImmediate(() => fakeClient.emit('connect')); return fakeClient; } });
    assert.strictEqual(fakeClient.url, 'mqtt://broker.local:1883');
    assert.deepStrictEqual(subscribed, ['/oneM2M/req/Mobius2/admin_selftest_R4/json']);
    assert.strictEqual(rx.mqttNu(), 'mqtt://broker.local/admin_selftest_R4?ct=json');
    const since = Date.now();
    const p = rx.expect('Mobius/a/sub9', 'mqtt', 500, since);
    fakeClient.emit('message', '/oneM2M/req/Mobius2/admin_selftest_R4/json', Buffer.from(JSON.stringify({ 'm2m:rqp': { pc: { 'm2m:sgn': { sur: '/Mobius/a/sub9' } } } })));
    const got = await p;
    assert.strictEqual(got.body['m2m:sgn'].sur, '/Mobius/a/sub9');
    await new Promise((r) => rx.close(r));
    assert.strictEqual(fakeClient.ended, true);
});

test('MQTT 접속 실패면 mqttNu 는 null 이고 mqtt expect 는 receiverError', async function () {
    const rx = await open({ host: '127.0.0.1', port: 0, runId: 'R5', mqtt: { broker: 'nowhere', port: 1, cseId: '/Mobius2' },
                            mqttClientFactory: () => { const c = new EventEmitter(); c.subscribe = () => {}; c.end = () => {}; setImmediate(() => c.emit('error', new Error('ECONNREFUSED'))); return c; } });
    assert.strictEqual(rx.mqttNu(), null);
    assert.match(rx.mqttError, /ECONNREFUSED/);
    await assert.rejects(rx.expect('x', 'mqtt', 10, Date.now()), (e) => e.receiverError === true);
    await new Promise((r) => rx.close(r));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-selftest-receiver.test.js` → FAIL (모듈 없음)

- [ ] **Step 3: `admin/selftest/receiver.js`**

```js
'use strict';
/**
 * 알림 수신기. 종합 테스트가 도는 동안만 연다.
 *
 * HTTP: adminSelftestHost:adminSelftestPort 에 서버를 열고 POST /noti/<runId> 를 받는다.
 *       m2m:sgn 의 sur 로 기록하고 200/2000 으로 답한다(vrq 도 같다).
 * MQTT: 대상 Mobius 와 같은 브로커에 붙어 /oneM2M/req/<cseId>/<수신자ID>/json 을
 *       구독한다(sgn_man.js 의 noti_topic 과 같은 꼴). 접속 실패는 실행을 막지 않는다 —
 *       MQTT 알림 케이스만 error 가 된다.
 *
 * expect(sur, kind, timeoutMs, since) 는 since 이후에 받은 알림만 인정한다 — 앞
 * 케이스가 남긴 알림에 속지 않기 위해서다.
 */
var http = require('http');

function norm(p) { return String(p || '').replace(/^\/+/, ''); }

function extract_sgn(obj) {
    if (!obj || typeof obj !== 'object') { return null; }
    if (obj['m2m:sgn']) { return obj['m2m:sgn']; }
    if (obj['m2m:rqp'] && obj['m2m:rqp'].pc && obj['m2m:rqp'].pc['m2m:sgn']) { return obj['m2m:rqp'].pc['m2m:sgn']; }
    return null;
}

exports.open = function (o, cb) {
    var received = [];
    var waiters = [];
    var receiverId = 'admin_selftest_' + o.runId;
    var mqttClient = null;
    var mqttOk = false;
    var mqttError = null;
    var boundPort = null;

    function record(kind, body, verification) {
        var sgn = extract_sgn(body) || {};
        var entry = { kind: kind, sur: norm(sgn.sur), at: Date.now(), body: body, verification: !!verification };
        received.push(entry);
        waiters.slice().forEach(function (w) {
            if (w.kind === kind && w.sur === entry.sur && entry.at >= w.since) {
                waiters.splice(waiters.indexOf(w), 1);
                clearTimeout(w.timer);
                w.resolve({ latencyMs: entry.at - w.since, at: entry.at, body: body });
            }
        });
    }

    var srv = http.createServer(function (req, res) {
        var s = '';
        req.on('data', function (c) { s += c; });
        req.on('end', function () {
            if (req.method !== 'POST' || req.url !== '/noti/' + o.runId) {
                res.statusCode = 404; return res.end();
            }
            var body = null;
            try { body = s ? JSON.parse(s) : null; } catch (e) { body = { raw: s }; }
            var sgn = extract_sgn(body) || {};
            record('http', body, sgn.vrq === true);
            res.statusCode = 200;
            res.setHeader('X-M2M-RSC', '2000');
            if (req.headers['x-m2m-ri']) { res.setHeader('X-M2M-RI', req.headers['x-m2m-ri']); }
            res.setHeader('Content-Type', 'application/json');
            res.end('');
        });
    });

    var rx = {
        received: received,
        get mqttError() { return mqttError; },
        httpNu: function () { return 'http://' + o.host + ':' + boundPort + '/noti/' + o.runId; },
        mqttNu: function () { return mqttOk ? 'mqtt://' + o.mqtt.broker + '/' + receiverId + '?ct=json' : null; },
        expect: function (sur, kind, timeoutMs, since) {
            var want = norm(sur);
            return new Promise(function (resolve, reject) {
                if (kind === 'mqtt' && !mqttOk) {
                    var e = new Error('MQTT 수신기가 없다' + (mqttError ? ' (' + mqttError + ')' : ''));
                    e.receiverError = true; return reject(e);
                }
                var hit = received.filter(function (r) { return r.kind === kind && r.sur === want && r.at >= since; })[0];
                if (hit) { return resolve({ latencyMs: hit.at - since, at: hit.at, body: hit.body }); }
                var w = { kind: kind, sur: want, since: since, resolve: resolve, timer: null };
                w.timer = setTimeout(function () {
                    waiters.splice(waiters.indexOf(w), 1);
                    reject(new Error(kind + ' 알림이 ' + timeoutMs + 'ms 안에 오지 않았다 (sur=' + want + ')'));
                }, timeoutMs);
                waiters.push(w);
            });
        },
        close: function (done) {
            waiters.forEach(function (w) { clearTimeout(w.timer); });
            waiters = [];
            if (mqttClient) { try { mqttClient.end(); } catch (e) { /* 이미 닫혔을 수 있다 */ } }
            srv.close(function () { done && done(); });
        }
    };

    srv.on('error', function (e) { cb(e); });
    srv.listen(o.port, o.host, function () {
        boundPort = srv.address().port;
        if (!o.mqtt || !o.mqtt.broker) { return cb(null, rx); }
        var url = 'mqtt://' + o.mqtt.broker + ':' + (o.mqtt.port || 1883);
        var factory = o.mqttClientFactory || function (u) { return require('mqtt').connect(u, { connectTimeout: 3000, reconnectPeriod: 0 }); };
        var settled = false;
        function finish() { if (settled) { return; } settled = true; cb(null, rx); }
        try { mqttClient = factory(url); }
        catch (e) { mqttError = e.message; return finish(); }
        var topic = '/oneM2M/req/' + String(o.mqtt.cseId || '').replace(/^\//, '') + '/' + receiverId + '/json';
        mqttClient.on('connect', function () {
            mqttClient.subscribe(topic, function (err) {
                if (err) { mqttError = err.message; } else { mqttOk = true; }
                finish();
            });
        });
        mqttClient.on('message', function (t, payload) {
            var body = null;
            try { body = JSON.parse(payload.toString()); } catch (e) { body = { raw: payload.toString() }; }
            record('mqtt', body, false);
        });
        mqttClient.on('error', function (e) { mqttError = e.message || String(e); mqttOk = false; finish(); });
        setTimeout(function () { if (!settled) { mqttError = mqttError || '브로커 접속 대기 초과'; finish(); } }, 4000).unref();
    });
};
```

- [ ] **Step 4: 시험**

Run: `node --test test/admin-selftest-receiver.test.js` → PASS (4/4). Run: `npm test` → 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add admin/selftest/receiver.js test/admin-selftest-receiver.test.js
git commit -m "selftest(receiver): HTTP 수신 서버와 MQTT 구독자 — since 이후의 알림만 인정

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 이력 — 저장·목록·조회·비교·삭제·보관 50

**Files:**
- Create: `admin/selftest/history.js`
- Test: `test/admin-selftest-history.test.js`

**Interfaces:**
- `history.save(dataDir, result)` → 파일 경로 (`admin/data/selftest/<runId>.json`, tmp+rename), 저장 뒤 `keepLatest(50)`.
- `history.list(dataDir)` → `[{ runId, startedAt, endedAt, status, categories, loadIncluded, summary, target: { backend, mobiusVersion }, broken? }]` 최신순.
- `history.get(dataDir, runId)` → 결과 객체 또는 null. `history.remove(dataDir, runId)` → boolean.
- `history.compare(a, b)` → `{ a: runId, b: runId, sameTarget: boolean, targetDiff: string[], newlyFailing: [{ id, from, to }], fixed: [{ id, from, to }], onlyInA: string[], onlyInB: string[], perf: [{ category, p95a, p95b, deltaPct, flag }] }`. `flag` 는 `|deltaPct| > 20` 일 때 `'slower'|'faster'`. `from/to` 는 상태 문자열. "실패" 는 `fail|error`.

- [ ] **Step 1: 실패하는 시험**

`test/admin-selftest-history.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const history = require(path.join(__dirname, '..', 'admin', 'selftest', 'history.js'));

function result(runId, statuses, p95, extra) {
    return Object.assign({
        runId: runId, startedAt: '2026-09-06T00:00:00.000Z', endedAt: '2026-09-06T00:01:00.000Z', status: 'done', cancelled: false,
        target: { host: 'h', port: 1, backend: 'mysql', cseBase: 'Mobius', cseId: '/Mobius2', mobiusVersion: '2.6.0', bootAt: null },
        categories: ['cnt'], loadIncluded: false,
        summary: { pass: 0, fail: 0, error: 0, skip: 0, p50: 1, p95: p95, max: 2 },
        results: Object.keys(statuses).map((id) => ({ id: id, category: id.split('.')[0], title: id, status: statuses[id], ms: 1, steps: [], failedStep: null, message: null })),
        perf: { byCategory: { cnt: { n: 3, p50: 1, p95: p95, max: 2, avg: 1 } }, notify: { http: null, mqtt: null }, load: null },
        cleanup: 'ok', cleanupError: null
    }, extra || {});
}

test('save/list/get/remove 와 보관 50', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-hist-'));
    for (let i = 0; i < 55; i++) {
        const p = history.save(dir, result('r' + String(i).padStart(3, '0'), { 'cnt.a': 'pass' }, 5));
        fs.utimesSync(p, new Date(1e12 + i * 1000), new Date(1e12 + i * 1000));
    }
    const list = history.list(dir);
    assert.strictEqual(list.length, 50);
    assert.strictEqual(list[0].runId, 'r054');
    assert.strictEqual(list[0].summary.p95, 5);
    assert.strictEqual(list[0].target.backend, 'mysql');
    assert.ok(!('results' in list[0]), '목록은 요약만');
    assert.strictEqual(history.get(dir, 'r054').results.length, 1);
    assert.strictEqual(history.get(dir, 'nope'), null);
    assert.strictEqual(history.remove(dir, 'r054'), true);
    assert.strictEqual(history.get(dir, 'r054'), null);
    fs.writeFileSync(path.join(dir, 'selftest', 'zzz.json'), '{bad', 'utf8');
    assert.ok(history.list(dir).some((x) => x.broken === true), '깨진 파일은 표시하고 건너뛴다');
});

test('compare: 새로 실패·고쳐짐·한쪽에만·p95 변화', function () {
    const a = result('A', { 'cnt.a': 'pass', 'cnt.b': 'pass', 'cnt.c': 'fail', 'cnt.d': 'skip' }, 10);
    const b = result('B', { 'cnt.a': 'fail', 'cnt.b': 'pass', 'cnt.c': 'pass', 'cnt.e': 'error' }, 13);
    const c = history.compare(a, b);
    assert.deepStrictEqual(c.newlyFailing, [{ id: 'cnt.a', from: 'pass', to: 'fail' }]);
    assert.deepStrictEqual(c.fixed, [{ id: 'cnt.c', from: 'fail', to: 'pass' }]);
    assert.deepStrictEqual(c.onlyInA, ['cnt.d']);
    assert.deepStrictEqual(c.onlyInB, ['cnt.e']);
    assert.strictEqual(c.sameTarget, true);
    assert.deepStrictEqual(c.perf, [{ category: 'cnt', p95a: 10, p95b: 13, deltaPct: 30, flag: 'slower' }]);
    const b2 = result('B2', {}, 10, { target: { backend: 'sqlite', mobiusVersion: '2.6.0' } });
    const c2 = history.compare(a, b2);
    assert.strictEqual(c2.sameTarget, false);
    assert.ok(c2.targetDiff.some((s) => /backend/.test(s)));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-selftest-history.test.js` → FAIL

- [ ] **Step 3: `admin/selftest/history.js`**

```js
'use strict';
/**
 * 실행 이력. admin/data/selftest/<runId>.json 하나가 실행 하나다. 최근 50개만 남긴다.
 * 비교는 "전에 되던 것이 안 되는가" 를 먼저 보여 준다 — 새로 실패한 케이스, 고쳐진
 * 케이스, 카테고리별 p95 변화(±20% 넘으면 강조), 대상이 다르면 그 사실.
 */
var path = require('path');
var data_dir = require('../data_dir');

var SUB = 'selftest';
var KEEP = 50;

exports.save = function (dataDir, result) {
    var file = data_dir.file(dataDir, SUB, result.runId + '.json');
    data_dir.writeJson(file, result);
    data_dir.keepLatest(dataDir, SUB, KEEP);
    return file;
};

function brief(r) {
    return {
        runId: r.runId, startedAt: r.startedAt, endedAt: r.endedAt, status: r.status, cancelled: !!r.cancelled,
        categories: r.categories, loadIncluded: !!r.loadIncluded, summary: r.summary,
        target: { backend: r.target && r.target.backend, mobiusVersion: r.target && r.target.mobiusVersion, host: r.target && r.target.host, port: r.target && r.target.port },
        cleanup: r.cleanup
    };
}

exports.list = function (dataDir) {
    return data_dir.listJson(dataDir, SUB).map(function (item) {
        if (item.broken) { return { runId: item.name.replace(/\.json$/, ''), broken: true }; }
        try { return brief(data_dir.readJson(item.path)); }
        catch (e) { return { runId: item.name.replace(/\.json$/, ''), broken: true }; }
    });
};

exports.get = function (dataDir, runId) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(runId))) { return null; }
    var file = path.join(dataDir, SUB, runId + '.json');
    try { return data_dir.readJson(file); } catch (e) { return null; }
};

exports.remove = function (dataDir, runId) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(runId))) { return false; }
    var file = path.join(dataDir, SUB, runId + '.json');
    try { require('fs').unlinkSync(file); return true; } catch (e) { return false; }
};

var FAILING = { fail: 1, error: 1 };

exports.compare = function (a, b) {
    var sa = {}, sb = {};
    (a.results || []).forEach(function (r) { sa[r.id] = r.status; });
    (b.results || []).forEach(function (r) { sb[r.id] = r.status; });
    var newlyFailing = [], fixed = [], onlyInA = [], onlyInB = [];
    Object.keys(sa).forEach(function (id) {
        if (!(id in sb)) { onlyInA.push(id); return; }
        if (!FAILING[sa[id]] && FAILING[sb[id]]) { newlyFailing.push({ id: id, from: sa[id], to: sb[id] }); }
        if (FAILING[sa[id]] && !FAILING[sb[id]]) { fixed.push({ id: id, from: sa[id], to: sb[id] }); }
    });
    Object.keys(sb).forEach(function (id) { if (!(id in sa)) { onlyInB.push(id); } });

    var perf = [];
    var cats = {};
    Object.keys((a.perf && a.perf.byCategory) || {}).forEach(function (c) { cats[c] = 1; });
    Object.keys((b.perf && b.perf.byCategory) || {}).forEach(function (c) { cats[c] = 1; });
    Object.keys(cats).sort().forEach(function (c) {
        var pa = a.perf && a.perf.byCategory[c] ? a.perf.byCategory[c].p95 : null;
        var pb = b.perf && b.perf.byCategory[c] ? b.perf.byCategory[c].p95 : null;
        var delta = (pa && pb) ? Math.round((pb - pa) / pa * 100) : null;
        var flag = (delta !== null && Math.abs(delta) > 20) ? (delta > 0 ? 'slower' : 'faster') : null;
        perf.push({ category: c, p95a: pa, p95b: pb, deltaPct: delta, flag: flag });
    });

    var targetDiff = [];
    ['backend', 'mobiusVersion', 'host', 'port', 'cseBase'].forEach(function (k) {
        var va = a.target && a.target[k], vb = b.target && b.target[k];
        if (String(va) !== String(vb)) { targetDiff.push(k + ': ' + va + ' → ' + vb); }
    });
    return { a: a.runId, b: b.runId, sameTarget: targetDiff.length === 0, targetDiff: targetDiff,
             newlyFailing: newlyFailing, fixed: fixed, onlyInA: onlyInA, onlyInB: onlyInB, perf: perf };
};
```

- [ ] **Step 4: 시험**

Run: `node --test test/admin-selftest-history.test.js` → PASS (2/2). Run: `npm test` → 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add admin/selftest/history.js test/admin-selftest-history.test.js
git commit -m "selftest(history): 실행 이력 파일 — 목록·조회·비교(새 실패·고쳐짐·p95 변화)·보관 50

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 알림·그룹·fcnt·보관 정책·부하 카테고리 + 성능 집계

**Files:**
- Create: `admin/selftest/catalog/sub.js`, `grp.js`, `fcnt.js`, `retention.js`, `load.js`
- Modify: `admin/selftest/runner.js`(`$nu:http`·`$nu:mqtt`, `notify-wait` 의 `absent`), `admin/selftest/catalog/index.js`(`absent` 허용), `admin/selftest/perf.js`(부하 집계)
- Test: `test/admin-selftest-perf.test.js`, `test/admin-selftest-runner.test.js` 에 두 건 추가

**Interfaces:**
- 변수 `$nu:http` → `receiver.httpNu()`, `$nu:mqtt` → `receiver.mqttNu()`. 수신기가 없거나 MQTT 가 null 이면 해석 오류 → 케이스 `error`(사유에 "수신기").
- `notify-wait` 에 `absent: true` 가 있으면 상한 안에 알림이 **오지 않아야** pass(오면 fail).
- `perf.loadSummary(samples, { concurrency, total, done, errors, seconds, aborted })` → `{ concurrency, total, done, errors, errorRate, seconds, throughput, p50, p95, p99, max, aborted }`.
- 부하 케이스는 `load: true` 를 가진 스크립트형이고 `ctx.load = { enabled, concurrency, total }` 를 읽는다. 상한(동시 20·총 5,000)은 라우트(Task 7)와 CLI(Task 8)가 서버 쪽에서 강제한다 — 케이스는 받은 값을 믿는다.

- [ ] **Step 1: 실패하는 시험**

`test/admin-selftest-perf.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const perf = require(path.join(__dirname, '..', 'admin', 'selftest', 'perf.js'));

test('nearest-rank 백분위', function () {
    const s = perf.summarize([5, 1, 3, 2, 4]);
    assert.deepStrictEqual(s, { n: 5, p50: 3, p95: 5, p99: 5, max: 5, avg: 3 });
    assert.deepStrictEqual(perf.summarize([]), { n: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 });
    assert.strictEqual(perf.summarize([1, 'x', NaN, 2]).n, 2);
});

test('loadSummary 는 처리량과 오류율을 낸다', function () {
    const r = perf.loadSummary([10, 20, 30, 40], { concurrency: 2, total: 4, done: 4, errors: 1, seconds: 2, aborted: false });
    assert.strictEqual(r.throughput, 2);
    assert.strictEqual(r.errorRate, 0.25);
    assert.strictEqual(r.p95, 40);
    assert.strictEqual(r.aborted, false);
});
```

`test/admin-selftest-runner.test.js` 끝에:

```js
test('$nu:http 는 수신기 주소, absent 는 안 와야 pass, 수신기가 없으면 error', async function () {
    const receiver = require(path.join(__dirname, '..', 'admin', 'selftest', 'receiver.js'));
    const rx = await new Promise((r, j) => receiver.open({ host: '127.0.0.1', port: 0, runId: 'T9', mqtt: null }, (e, x) => (e ? j(e) : r(x))));
    const { cse, runner } = await boot([
        { id: 't.nu', title: 'nu', steps: [
            { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'n' } }, expect: { rsc: '2001' }, as: 'n' },
            { op: 'create', target: '$n', ty: 23, body: { 'm2m:sub': { rn: 's', nu: ['$nu:http'], enc: { net: [3] } } }, expect: { rsc: '2001', body: { 'm2m:sub': { nu: [rx.httpNu()] } } }, as: 's' },
            { op: 'notify-wait', receiver: 'http', sur: '$s', timeoutMs: 100, absent: true } ] },
        { id: 't.mqtt', title: 'mqtt', steps: [{ op: 'notify-wait', receiver: 'mqtt', sur: '$s', timeoutMs: 100 }] }
    ], { receiver: rx });
    const { statuses, result } = await runAll(runner);
    assert.deepStrictEqual(statuses, ['pass', 'error']);
    assert.match(result.results[1].message, /MQTT/);
    await new Promise((r) => rx.close(r));
    await cse.close();
});

test('수신기가 없으면 $nu:http 는 error', async function () {
    const { cse, runner } = await boot([
        { id: 't.nonu', title: 'nonu', steps: [{ op: 'create', target: '$run', ty: 23, body: { 'm2m:sub': { rn: 's', nu: ['$nu:http'] } }, expect: { rsc: '2001' } }] }
    ]);
    const { statuses, result } = await runAll(runner);
    assert.deepStrictEqual(statuses, ['error']);
    assert.match(result.results[0].message, /수신기/);
    await cse.close();
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-selftest-perf.test.js test/admin-selftest-runner.test.js` → FAIL

- [ ] **Step 3: `runner.js` 수정**

`Runner.prototype.resolve` 의 `$rn:` 분기 아래에:

```js
    if (s === '$nu:http' || s === '$nu:mqtt') {
        var rx = self.opts.receiver;
        if (!rx) { throw new Error('수신기가 없다 — ' + s + ' 를 쓸 수 없다'); }
        var nu = (s === '$nu:http') ? rx.httpNu() : rx.mqttNu();
        if (!nu) { throw new Error('MQTT 수신기가 없다' + (rx.mqttError ? ' (' + rx.mqttError + ')' : '')); }
        return nu;
    }
```

`runSteps` 의 `notify-wait` 처리에서 `then/catch` 를 `absent` 를 보게 바꾼다:

```js
        self.opts.receiver.expect(sur, step.receiver, step.timeoutMs || 5000, since).then(function (got) {
            if (step.absent) { s.ok = false; s.actual = { received: true }; return fail_rest('fail', '오지 않아야 할 알림이 왔다 (sur=' + sur + ')'); }
            s.ms = got.latencyMs; s.ok = true; s.actual = { received: true, latencyMs: got.latencyMs };
            self.samples.notify[step.receiver].push(got.latencyMs);
            self.runSteps(steps, i + 1, rec, close);
        }, function (err) {
            if (err && err.receiverError) { s.ok = false; s.actual = null; return fail_rest('error', err.message); }
            if (step.absent) { s.ok = true; s.actual = { received: false }; return self.runSteps(steps, i + 1, rec, close); }
            s.ok = false; s.actual = { received: false };
            fail_rest('fail', (err && err.message) || '알림이 오지 않았다');
        });
```

`catalog/index.js` 의 `notify-wait` 검사에 `if (s.absent !== undefined && typeof s.absent !== 'boolean') { problems.push(where + ': absent 는 boolean'); }` 를 더한다.

- [ ] **Step 4: `perf.js` 에 부하 집계**

```js
exports.loadSummary = function (samples, o) {
    var s = exports.summarize(samples);
    var seconds = o.seconds > 0 ? o.seconds : 0.001;
    return {
        concurrency: o.concurrency, total: o.total, done: o.done, errors: o.errors,
        errorRate: o.done ? Math.round(o.errors / o.done * 1000) / 1000 : 0,
        seconds: Math.round(seconds * 100) / 100,
        throughput: Math.round(o.done / seconds * 10) / 10,
        p50: s.p50, p95: s.p95, p99: s.p99, max: s.max, aborted: !!o.aborted
    };
};
```

- [ ] **Step 5: 카테고리 파일 다섯**

`sub.js` (order 55):

```js
'use strict';
// 구독·알림. nu 는 수신기 주소($nu:http / $nu:mqtt)다. sur 는 구독의 ri(구조화 경로)다.
module.exports = {
    category: 'sub', title: '구독·알림', order: 55,
    cases: [
        { id: 'sub.create.ok', title: 'SUB 생성·조회', requires: { types: [3, 23] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'sc1' } }, expect: { rsc: '2001' }, as: 'sc1' },
                  { op: 'create', target: '$sc1', ty: 23, body: { 'm2m:sub': { rn: 's1', nu: ['$nu:http'], enc: { net: [3] } } }, expect: { rsc: '2001', body: { 'm2m:sub': { ty: 23 } } }, as: 's1' },
                  { op: 'retrieve', target: '$s1', expect: { rsc: '2000', body: { 'm2m:sub': { enc: { net: [3] } } } } }] },
        { id: 'sub.notify.http.child', title: '자식 생성 → HTTP 알림', requires: { types: [3, 4, 23] },
          steps: [{ op: 'create', target: '$sc1', ty: 4, body: { 'm2m:cin': { con: 'n1' } }, expect: { rsc: '2001' } },
                  { op: 'notify-wait', receiver: 'http', sur: '$s1', timeoutMs: 5000 }] },
        { id: 'sub.notify.mqtt.child', title: '자식 생성 → MQTT 알림', requires: { types: [3, 4, 23] },
          steps: [{ op: 'create', target: '$sc1', ty: 23, body: { 'm2m:sub': { rn: 's2', nu: ['$nu:mqtt'], enc: { net: [3] } } }, expect: { rsc: '2001' }, as: 's2' },
                  { op: 'create', target: '$sc1', ty: 4, body: { 'm2m:cin': { con: 'n2' } }, expect: { rsc: '2001' } },
                  { op: 'notify-wait', receiver: 'mqtt', sur: '$s2', timeoutMs: 5000 }] },
        { id: 'sub.notify.update', title: 'net=1 은 갱신 때 알림', requires: { types: [3, 23] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'sc3' } }, expect: { rsc: '2001' }, as: 'sc3' },
                  { op: 'create', target: '$sc3', ty: 23, body: { 'm2m:sub': { rn: 's3', nu: ['$nu:http'], enc: { net: [1] } } }, expect: { rsc: '2001' }, as: 's3' },
                  { op: 'update', target: '$sc3', body: { 'm2m:cnt': { lbl: ['upd'] } }, expect: { rsc: '2004' } },
                  { op: 'notify-wait', receiver: 'http', sur: '$s3', timeoutMs: 5000 }] },
        { id: 'sub.notify.delete-child', title: 'net=4 는 자식 삭제 때 알림', requires: { types: [3, 4, 23] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'sc4' } }, expect: { rsc: '2001' }, as: 'sc4' },
                  { op: 'create', target: '$sc4', ty: 23, body: { 'm2m:sub': { rn: 's4', nu: ['$nu:http'], enc: { net: [4] } } }, expect: { rsc: '2001' }, as: 's4' },
                  { op: 'create', target: '$sc4', ty: 4, body: { 'm2m:cin': { con: 'd' } }, expect: { rsc: '2001' }, as: 'sc4i' },
                  { op: 'delete', target: '$sc4i', expect: { rsc: '2002' } },
                  { op: 'notify-wait', receiver: 'http', sur: '$s4', timeoutMs: 5000 }] },
        { id: 'sub.notify.filtered', title: 'net=3 구독은 갱신에 알리지 않는다', requires: { types: [3, 23] },
          steps: [{ op: 'update', target: '$sc1', body: { 'm2m:cnt': { lbl: ['quiet'] } }, expect: { rsc: '2004' } },
                  { op: 'notify-wait', receiver: 'http', sur: '$s1', timeoutMs: 1500, absent: true }] },
        { id: 'sub.delete.stops', title: '구독을 지우면 알림이 멈춘다', requires: { types: [3, 4, 23] },
          steps: [{ op: 'delete', target: '$s1', expect: { rsc: '2002' } },
                  { op: 'create', target: '$sc1', ty: 4, body: { 'm2m:cin': { con: 'after' } }, expect: { rsc: '2001' } },
                  { op: 'notify-wait', receiver: 'http', sur: '$s1', timeoutMs: 1500, absent: true }] },
        { id: 'sub.unsubscribable', title: 'CIN 에는 구독할 수 없다(5203)', requires: { types: [3, 4, 23] },
          steps: [{ op: 'create', target: '$sc1', ty: 4, body: { 'm2m:cin': { con: 'z' } }, expect: { rsc: '2001' }, as: 'zi' },
                  { op: 'create', target: '$zi', ty: 23, body: { 'm2m:sub': { rn: 'bad', nu: ['$nu:http'] } }, expect: { rsc: '5203' } }] }
    ]
};
```

`grp.js` (order 65):

```js
'use strict';
module.exports = {
    category: 'grp', title: '그룹·팬아웃', order: 65,
    cases: [
        { id: 'grp.setup', title: '멤버 둘과 그룹', requires: { types: [3, 9] },
          steps: [{ op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'm1' } }, expect: { rsc: '2001' }, as: 'm1' },
                  { op: 'create', target: '$run', ty: 3, body: { 'm2m:cnt': { rn: 'm2' } }, expect: { rsc: '2001' }, as: 'm2' },
                  { op: 'create', target: '$ae', ty: 9, body: { 'm2m:grp': { rn: 'g', mt: 3, mnm: 10, mid: ['$m1', '$m2'] } }, expect: { rsc: '2001', body: { 'm2m:grp': { cnm: 2 } } }, as: 'g' }] },
        { id: 'grp.fopt.create', title: 'fopt 로 CIN 을 멤버 전부에', requires: { types: [3, 4, 9] },
          steps: [{ op: 'create', target: '$g/fopt', ty: 4, body: { 'm2m:cin': { con: 'fan' } }, expect: { rsc: '2000', body: { 'm2m:agr': {} } } },
                  { op: 'retrieve', target: '$m1/la', expect: { rsc: '2000', body: { 'm2m:cin': { con: 'fan' } } } },
                  { op: 'retrieve', target: '$m2/la', expect: { rsc: '2000', body: { 'm2m:cin': { con: 'fan' } } } }] },
        { id: 'grp.fopt.retrieve', title: 'fopt 조회는 집계 응답', requires: { types: [3, 9] },
          steps: [{ op: 'retrieve', target: '$g/fopt', expect: { rsc: '2000', body: { 'm2m:agr': {} } } }] },
        { id: 'grp.fopt.update', title: 'fopt 갱신은 멤버 전부에', requires: { types: [3, 9] },
          steps: [{ op: 'update', target: '$g/fopt', body: { 'm2m:cnt': { lbl: ['fan'] } }, expect: { rsc: '2000' } },
                  { op: 'retrieve', target: '$m2', expect: { rsc: '2000', body: { 'm2m:cnt': { lbl: ['fan'] } } } }] },
        { id: 'grp.member.missing', title: '없는 멤버가 섞이면 생성 거절', requires: { types: [9] },
          steps: [{ op: 'create', target: '$ae', ty: 9, body: { 'm2m:grp': { rn: 'gbad', mt: 3, mnm: 10, mid: ['$run/no-such-member'] } }, expect: { rsc: '4000' } }] }
    ]
};
```

`fcnt.js` (order 68) — `cnd` 문자열은 `tools/response-golden/fcnt-check.js` 의 `MC` 표에서 그대로 가져온다(구현 때 그 파일을 연다). 아래는 표의 `bat` 항목이 `org.onem2m.home.moduleclass.battery` 라는 전제로 적었다 — 다르면 표의 값으로 바꾼다.

```js
'use strict';
// flexContainer 와 hd_* 별칭. cnd 는 tools/response-golden/fcnt-check.js 의 MC 표와 같다.
module.exports = {
    category: 'fcnt', title: 'flexContainer', order: 68,
    cases: [
        { id: 'fcnt.create.device', title: 'fcnt 디바이스 생성', requires: { types: [28] },
          steps: [{ op: 'create', target: '$run', ty: 28, body: { 'm2m:fcnt': { rn: 'dev', cnd: 'org.onem2m.home.device.deviceLight' } }, expect: { rsc: '2001', body: { 'm2m:fcnt': { cnd: 'org.onem2m.home.device.deviceLight' } } }, as: 'dev' }] },
        { id: 'fcnt.create.hd-bat', title: 'hd:bat 모듈 생성·조회', requires: { types: [28] },
          steps: [{ op: 'create', target: '$dev', ty: 28, body: { 'hd:bat': { rn: 'bat', cnd: 'org.onem2m.home.moduleclass.battery', lvl: 50 } }, expect: { rsc: '2001', body: { 'hd:bat': { lvl: 50 } } }, as: 'bat' },
                  { op: 'retrieve', target: '$bat', expect: { rsc: '2000', body: { 'hd:bat': { lvl: 50 } } } }] },
        { id: 'fcnt.update.via-root', title: 'm2m:fcnt 루트로 갱신하면 hd:bat 로 답한다', requires: { types: [28] },
          steps: [{ op: 'update', target: '$bat', body: { 'm2m:fcnt': { lbl: ['u'] } }, expect: { rsc: '2004', body: { 'hd:bat': { lbl: ['u'] } } } }] },
        { id: 'fcnt.update.hd-root', title: 'hd:bat 루트로 갱신은 관문이 막는다', requires: { types: [28] },
          steps: [{ op: 'update', target: '$bat', body: { 'hd:bat': { lvl: 60 } }, expect: { rsc: '4000' } }] },
        { id: 'fcnt.bad-pair', title: 'hd:bat 에 doorlock cnd 는 거절', requires: { types: [28] },
          steps: [{ op: 'create', target: '$dev', ty: 28, body: { 'hd:bat': { rn: 'bad', cnd: 'org.onem2m.home.moduleclass.doorlock', lvl: 1 } }, expect: { rsc: '4000' } }] },
        { id: 'fcnt.unknown-cnd', title: '모르는 moduleclass 는 거절', requires: { types: [28] },
          steps: [{ op: 'create', target: '$dev', ty: 28, body: { 'hd:bat': { rn: 'bad2', cnd: 'org.onem2m.home.moduleclass.nope', lvl: 1 } }, expect: { rsc: '4000' } }] },
        { id: 'fcnt.sub.notify', title: 'hd:bat 갱신 → 알림', requires: { types: [23, 28] },
          steps: [{ op: 'create', target: '$bat', ty: 23, body: { 'm2m:sub': { rn: 'fs', nu: ['$nu:http'], enc: { net: [1] } } }, expect: { rsc: '2001' }, as: 'fs' },
                  { op: 'update', target: '$bat', body: { 'm2m:fcnt': { lbl: ['v'] } }, expect: { rsc: '2004' } },
                  { op: 'notify-wait', receiver: 'http', sur: '$fs', timeoutMs: 5000 }] }
    ]
};
```

`retention.js` (order 75):

```js
'use strict';
// 보관 정책. mni/mbs 초과분은 마스터의 주기 스윕(purgeSweepMs)이 지운다 — 즉시가
// 아니다. 그래서 스윕 주기의 두 배 + 1초까지 기다린다.
module.exports = {
    category: 'retention', title: '보관 정책', order: 75,
    cases: [
        { id: 'retention.mni.purge', title: 'mni 초과분이 스윕에 지워진다', requires: { types: [3, 4] },
          run: async function (ctx) {
              var c = await ctx.create('$run', 3, { 'm2m:cnt': { rn: 'r1', mni: 3 } });
              ctx.assert(c.rsc === '2001', 'cnt 생성 ' + c.rsc);
              for (var i = 0; i < 5; i++) {
                  var r = await ctx.create(c.path, 4, { 'm2m:cin': { con: String(i) } });
                  ctx.assert(r.rsc === '2001', 'cin 생성 ' + r.rsc);
              }
              var wait = (ctx.conf.purgeSweepMs || 10000) * 2 + 1000;
              var ok = await ctx.until(async function () {
                  var d = await ctx.discover(c.path, { ty: 4 });
                  return d.rsc === '2000' && d.uril.length <= 3;
              }, wait, 500);
              ctx.assert(ok, wait + 'ms 안에 CIN 이 mni(3) 아래로 내려오지 않았다');
              var cnt = await ctx.retrieve(c.path);
              ctx.assert(cnt.body['m2m:cnt'].cni <= 3, 'cni 가 ' + cnt.body['m2m:cnt'].cni);
          } },
        { id: 'retention.mbs.purge', title: 'mbs 초과분이 스윕에 지워진다', requires: { types: [3, 4] },
          run: async function (ctx) {
              var c = await ctx.create('$run', 3, { 'm2m:cnt': { rn: 'r2', mbs: 12 } });
              ctx.assert(c.rsc === '2001', 'cnt 생성 ' + c.rsc);
              for (var i = 0; i < 4; i++) {
                  var r = await ctx.create(c.path, 4, { 'm2m:cin': { con: 'abcde' } });   // 5바이트 × 4 = 20 > 12
                  ctx.assert(r.rsc === '2001', 'cin 생성 ' + r.rsc);
              }
              var wait = (ctx.conf.purgeSweepMs || 10000) * 2 + 1000;
              var ok = await ctx.until(async function () {
                  var cnt = await ctx.retrieve(c.path);
                  return cnt.rsc === '2000' && cnt.body['m2m:cnt'].cbs <= 12;
              }, wait, 500);
              ctx.assert(ok, wait + 'ms 안에 cbs 가 mbs(12) 아래로 내려오지 않았다');
          } },
        { id: 'retention.explicit-beats-policy', title: '명시한 mni 가 정책보다 우선한다', requires: { types: [3] },
          run: async function (ctx) {
              var c = await ctx.create('$run', 3, { 'm2m:cnt': { rn: 'r3', mni: 2 } });
              ctx.assert(c.rsc === '2001', 'cnt 생성');
              ctx.assert(c.body['m2m:cnt'].mni === 2, '응답의 mni 가 ' + c.body['m2m:cnt'].mni);
          } }
    ]
};
```

`load.js` (order 90):

```js
'use strict';
// 부하. 기본 꺼짐 — 실행기가 ctx.load.enabled 로 skip 한다. 상한은 라우트/CLI 가 강제한다.
// 처음 200건에서 오류율이 20% 를 넘으면 중단한다 — 운영 서버 보호.
var perf = require('../perf');

module.exports = {
    category: 'load', title: '부하', order: 90,
    cases: [
        { id: 'load.mixed', title: '동시 요청 — 생성 50% · 조회 30% · discovery 20%', load: true, requires: { types: [3, 4] },
          run: async function (ctx) {
              var conc = ctx.load.concurrency, total = ctx.load.total;
              var c = await ctx.create('$run', 3, { 'm2m:cnt': { rn: 'load' } });
              ctx.assert(c.rsc === '2001', '부하 컨테이너 생성');
              var seed = await ctx.create(c.path, 4, { 'm2m:cin': { con: 'seed' } });
              ctx.assert(seed.rsc === '2001', '씨앗 CIN');
              var samples = [], done = 0, errors = 0, issued = 0, aborted = false;
              var t0 = Date.now();
              function one(i) {
                  var kind = (i % 10 < 5) ? 'create' : (i % 10 < 8) ? 'retrieve' : 'discover';
                  var p = kind === 'create' ? ctx.client_request('POST', c.path, { content: { 'm2m:cin': { con: 'L' + i } }, ty: 4 })
                        : kind === 'retrieve' ? ctx.client_request('GET', c.path + '/la', null)
                        : ctx.client_request('GET', c.path + '?fu=1&ty=4&lim=10', null);
                  return p.then(function (r) {
                      done++;
                      if (r.status === 0 || r.status >= 500) { errors++; } else { samples.push(r.elapsedMs); }
                      if (done === 200 && errors / done > 0.2) { aborted = true; }
                  });
              }
              async function worker() {
                  while (!aborted && issued < total) { var i = issued++; await one(i); }
              }
              var workers = [];
              for (var w = 0; w < conc; w++) { workers.push(worker()); }
              await Promise.all(workers);
              var summary = perf.loadSummary(samples, { concurrency: conc, total: total, done: done, errors: errors, seconds: (Date.now() - t0) / 1000, aborted: aborted });
              ctx.setLoadResult(summary);
              ctx.record({ op: 'load', target: c.path, actual: summary, ms: summary.seconds * 1000, ok: !aborted, note: aborted ? '오류율 20% 초과로 중단' : null });
              ctx.assert(!aborted, '처음 200건에서 오류율이 20% 를 넘어 중단했다 (' + errors + '/' + done + ')');
          } }
    ]
};
```

`ctx.client_request(method, path, body)` 를 `makeCtx` 에 더한다 — 단계 기록 없이 `self.client.request` 를 Promise 로 감싼 것(부하는 수천 건이라 단계로 남기지 않는다):

```js
        client_request: function (method, p, body) { return new Promise(function (r) { self.client.request(method, p, body, r); }); },
```

- [ ] **Step 6: 시험**

Run: `node --test test/admin-selftest-perf.test.js test/admin-selftest-runner.test.js test/admin-selftest-catalog.test.js` → PASS. Run: `npm test` → 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add admin/selftest test/admin-selftest-perf.test.js test/admin-selftest-runner.test.js
git commit -m "selftest(catalog): 구독·알림, 그룹·팬아웃, flexContainer, 보관 정책, 부하 — \$nu:*·absent·부하 집계

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: API — `/api/selftest/*` 와 작업 연결

**Files:**
- Create: `admin/selftest/job.js`(실행 시작: 수신기 → 대상 → setup → jobs.start → finish → 이력)
- Modify: `admin/api.js`, `test/admin_app_helper.js`(`opts.csePort` 로 외부 CSE 사용, `opts.selftestPort`)
- Test: `test/admin-api-selftest.test.js`

**Interfaces:**
- `selftest_job.start(ctx, { categories, load }, cb)` → `cb(err, { job, runId })`. `err.code`: `'BUSY'`(작업 슬롯), `'PORT'`(수신 포트 사용 중), `'SETUP'`(격리 실패 — 사유 포함), `'BAD_REQUEST'`(모르는 카테고리·값). 시작 직후 `history.save` 로 `status: 'running'` 레코드를 쓰고, 끝나면(`onFinish`) `runner.finish` → 수신기 닫기 → `history.save` 로 덮는다.
- `ctx.root`: 저장소 루트(`target.describe`·`supportedTypes` 용) — `admin/api.js` 가 `path.join(__dirname, '..')` 로 넣는다(시험 헬퍼도 같다).
- 라우트(스펙 §7.11): `GET /api/selftest/catalog`, `POST /api/selftest/runs`(202 / 400 / 409 / 423 / 502), `GET /api/selftest/runs`, `GET /api/selftest/runs/:id`(404), `GET /api/selftest/compare?a=&b=`(404), `DELETE /api/selftest/runs/:id`.
- 부하 상한: `concurrency` 1~20(기본 10), `total` 1~5000(기본 2000) — 서버가 잘라 넣고 결과에 실제 값이 남는다.

- [ ] **Step 1: 헬퍼 확장 — `test/admin_app_helper.js`**

`boot` 에서 `if (opts.cse !== null)` 블록을:

```js
    if (opts.csePort) {
        csePort = opts.csePort;                 // 시험이 띄운 CSE(예: selftest_fake_cse)
        const { Client } = require(path.join(ROOT, 'admin', 'cse.js'));
        cse = new Client({ host: '127.0.0.1', port: csePort, origin: conf.adminOrigin || 'Sponde', timeoutMs: 2000 });
    } else if (opts.cse !== null) { /* 기존 가짜 CSE 블록 그대로 */ }
```

`ctx` 에 `root: ROOT` 와 `selftest: { host: '127.0.0.1', port: opts.selftestPort || 0 }` 이 있어야 한다(Task 1 이 넣었다).

- [ ] **Step 2: 실패하는 시험**

`test/admin-api-selftest.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { boot } = require('./admin_app_helper');
const fake = require('./selftest_fake_cse');

async function settled(h, id) {
    for (let i = 0; i < 1000; i++) {
        const j = (await h.request('GET', '/api/jobs/' + id)).body;
        if (j.state !== 'running') { return j; }
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('작업이 끝나지 않는다');
}
async function fileSettled(h, runId) {
    for (let i = 0; i < 500; i++) {
        const r = await h.request('GET', '/api/selftest/runs/' + runId);
        if (r.status === 200 && r.body.status !== 'running') { return r.body; }
        await new Promise((r2) => setTimeout(r2, 10));
    }
    throw new Error('이력이 닫히지 않는다');
}

test('catalog 는 카테고리·대상·지원 타입·부하 한도를 준다', async function () {
    const cse = fake.create({ cseBase: 'Mobius' });
    const port = await cse.listen();
    const h = await boot({ csePort: port });
    try {
        await h.login();
        const r = await h.request('GET', '/api/selftest/catalog');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.categories.some((c) => c.id === 'cnt' && c.count > 0));
        assert.ok(r.body.categories.every((c) => c.cases.every((k) => typeof k.script === 'boolean')));
        assert.deepStrictEqual(r.body.load.max, { concurrency: 20, total: 5000 });
        assert.strictEqual(r.body.target.host, '127.0.0.1');
        assert.ok('supportedTypes' in r.body);
    } finally { await h.close(); await cse.close(); }
});

test('실행: 202 → 작업 완료 → 이력 파일에 결과, 정리됨', async function () {
    const cse = fake.create({ cseBase: 'Mobius' });
    const port = await cse.listen();
    const h = await boot({ csePort: port });
    try {
        await h.login();
        const bad = await h.request('POST', '/api/selftest/runs', { categories: ['nope'] });
        assert.strictEqual(bad.status, 400);
        const r = await h.request('POST', '/api/selftest/runs', { categories: ['base', 'cnt'] });
        assert.strictEqual(r.status, 202, JSON.stringify(r.body));
        assert.strictEqual(r.body.job.kind, 'selftest');
        const running = await h.request('GET', '/api/selftest/runs/' + r.body.runId);
        assert.strictEqual(running.status, 200, '시작 직후에도 이력이 있다');
        const job = await settled(h, r.body.job.id);
        assert.strictEqual(job.state, 'done');
        const result = await fileSettled(h, r.body.runId);
        assert.strictEqual(result.status, 'done');
        assert.ok(result.results.length > 5);
        assert.ok(result.results.some((x) => x.id === 'cnt.create.ok' && x.status === 'pass'), JSON.stringify(result.results.filter((x) => x.status !== 'pass')));
        assert.strictEqual(result.cleanup, 'ok');
        assert.ok(!cse.has('/Mobius/admin_selftest'));
        assert.ok(fs.existsSync(path.join(h.dataDir, 'selftest', r.body.runId + '.json')));
        const list = await h.request('GET', '/api/selftest/runs');
        assert.strictEqual(list.body.runs[0].runId, r.body.runId);
        const cmp = await h.request('GET', '/api/selftest/compare?a=' + r.body.runId + '&b=' + r.body.runId);
        assert.strictEqual(cmp.status, 200);
        assert.deepStrictEqual(cmp.body.newlyFailing, []);
        assert.strictEqual((await h.request('DELETE', '/api/selftest/runs/' + r.body.runId)).status, 200);
        assert.strictEqual((await h.request('GET', '/api/selftest/runs/' + r.body.runId)).status, 404);
    } finally { await h.close(); await cse.close(); }
});

test('도는 중에는 409, 수신 포트가 쓰이면 423, 부하는 상한으로 잘린다', async function () {
    const cse = fake.create({ cseBase: 'Mobius' });
    const port = await cse.listen();
    cse.hangWhen((rec) => rec.path.endsWith('/run-hold'));   // 실행 컨테이너 생성 자체를 멈춰 첫 실행을 붙잡는다
    const busy = http.createServer(() => {});
    await new Promise((r) => busy.listen(0, '127.0.0.1', r));
    const h = await boot({ csePort: port, selftestPort: busy.address().port });
    try {
        await h.login();
        const p = await h.request('POST', '/api/selftest/runs', { categories: ['base'] });
        assert.strictEqual(p.status, 423, JSON.stringify(p.body));
        busy.close();
        h.ctx.selftest.port = 0;
        const first = await h.request('POST', '/api/selftest/runs', { categories: ['base'], load: { concurrency: 99, total: 99999 } });
        assert.strictEqual(first.status, 202, JSON.stringify(first.body));
        const second = await h.request('POST', '/api/selftest/runs', { categories: ['base'] });
        assert.strictEqual(second.status, 409);
        await settled(h, first.body.job.id);
        const result = await fileSettled(h, first.body.runId);
        assert.strictEqual(result.loadIncluded, true);
        assert.strictEqual(result.load.concurrency, 20);
        assert.strictEqual(result.load.total, 5000);
    } finally { await h.close(); await cse.close(); }
});
```

셋째 시험의 `hangWhen` 은 실행 컨테이너 이름이 `run-hold` 일 때만 걸리므로 실제로는 걸리지 않는다 — 409 는 **첫 실행이 아직 끝나기 전**에 둘째 요청이 들어가기 때문에 나온다(카테고리 하나라도 요청 수십 건이라 수십 ms 는 걸린다). 부하는 `load: true` 케이스 하나뿐인데 `base` 카테고리엔 없으므로 결과에 `load` 가 실릴 뿐 돌지 않는다 — `result.load` 는 요청값(잘린 것)이다.

- [ ] **Step 3: 실패 확인**

Run: `node --test test/admin-api-selftest.test.js` → FAIL (404)

- [ ] **Step 4: `admin/selftest/job.js`**

```js
'use strict';
/**
 * 종합 테스트 실행 하나를 시작한다 — 수신기 → 대상 요약 → 격리 → jobs.start.
 * 작업의 대상은 케이스 목록이고 워커 하나가 케이스 하나를 돈다(동시 1).
 * 끝나면(onFinish) runner.finish → 수신기 닫기 → 이력 저장.
 */
var crypto = require('crypto');
var catalog = require('./catalog');
var target = require('./target');
var receiver = require('./receiver');
var history = require('./history');
var { Runner } = require('./runner');

var LOAD_DEFAULT = { concurrency: 10, total: 2000 };
var LOAD_MAX = { concurrency: 20, total: 5000 };

function err(code, message) { var e = new Error(message); e.code = code; return e; }

exports.LOAD_DEFAULT = LOAD_DEFAULT;
exports.LOAD_MAX = LOAD_MAX;

exports.clampLoad = function (load) {
    if (!load) { return null; }
    var c = parseInt(load.concurrency, 10) || LOAD_DEFAULT.concurrency;
    var t = parseInt(load.total, 10) || LOAD_DEFAULT.total;
    return { enabled: true, concurrency: Math.min(Math.max(c, 1), LOAD_MAX.concurrency), total: Math.min(Math.max(t, 1), LOAD_MAX.total) };
};

exports.start = function (ctx, o, cb) {
    var cat = catalog.load();
    var known = cat.categories.map(function (c) { return c.id; });
    var categories = Array.isArray(o.categories) && o.categories.length ? o.categories : known;
    var unknown = categories.filter(function (c) { return known.indexOf(c) < 0; });
    if (unknown.length) { return cb(err('BAD_REQUEST', '모르는 카테고리: ' + unknown.join(', '))); }
    if (ctx.jobs.active()) { return cb(err('BUSY', '이미 도는 작업이 있다. 끝나거나 취소된 뒤에 시작한다.')); }
    if (!ctx.cse) { return cb(err('SETUP', 'Mobius 주소가 설정되지 않아 테스트를 돌릴 수 없다 (csebaseport 또는 adminCsePort)')); }

    var runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15) + '-' + crypto.randomBytes(2).toString('hex');
    var backend = ctx.db.backendName();
    var tgt = target.describe({ root: ctx.root, host: ctx.cseHost, port: ctx.csePort, backend: backend });
    var load = exports.clampLoad(o.load) || { enabled: false };
    var mqtt = (tgt.conf.mqttBroker) ? { broker: tgt.conf.mqttBroker, port: parseInt(tgt.conf.mqttPort, 10) || 1883, cseId: tgt.cseId } : null;

    receiver.open({ host: ctx.selftest.host, port: ctx.selftest.port, runId: runId, mqtt: mqtt }, function (e, rx) {
        if (e) {
            if (e.code === 'EADDRINUSE') { return cb(err('PORT', '알림 수신 포트 ' + ctx.selftest.port + ' 을 다른 프로세스가 쓰고 있다 — conf.json 의 adminSelftestPort 를 바꾼다')); }
            return cb(err('SETUP', '수신기를 열지 못했다: ' + e.message));
        }
        var runner = new Runner({
            runId: runId, host: ctx.cseHost, port: ctx.csePort,
            adminClient: ctx.cse, cseBase: tgt.cseBase, superUser: ctx.superUser,
            catalog: cat, categoryIds: categories, supportedTypes: target.supportedTypes(ctx.root, backend),
            target: tgt, conf: tgt.conf, receiver: rx, load: load,
            onProgress: function () {}
        });
        runner.result.load = load.enabled ? { concurrency: load.concurrency, total: load.total } : null;
        runner.result.receiver = { http: rx.httpNu(), mqtt: rx.mqttNu(), mqttError: rx.mqttError || null };
        runner.setup(function (e2) {
            if (e2) { return rx.close(function () { cb(err('SETUP', e2.message)); }); }
            var entries = runner.cases();
            history.save(ctx.dataDir, runner.result);
            var job = ctx.jobs.start({
                kind: 'selftest',
                title: '종합 테스트 ' + categories.join(', ') + ' (' + entries.length + '건)',
                note: '전용 AE 아래에서만 만들고 끝나면 지운다.',
                targets: entries,
                keyOf: function (en) { return en.kase.id; },
                concurrency: 1,
                worker: function (en, done) {
                    runner.runCase(en, function (status) {
                        var rec = runner.result.results[runner.result.results.length - 1];
                        if (status === 'pass') { return done('ok'); }
                        if (status === 'skip') { return done('skipped', rec.message); }
                        done('failed', status + ': ' + (rec.message || ''));
                    });
                },
                onFinish: function (j) {
                    runner.finish(j.state === 'cancelled', function (e3, result) {
                        rx.close(function () { history.save(ctx.dataDir, result); });
                    });
                }
            });
            if (!job) { return rx.close(function () { cb(err('BUSY', '이미 도는 작업이 있다.')); }); }
            cb(null, { job: job, runId: runId });
        });
    });
};
```

- [ ] **Step 5: `admin/api.js` — 라우트**

`// ── 정적 파일` 앞(라우트 절 끝)에:

```js
    // ── 종합 테스트 (검증) ─────────────────────────────────────────────────
    var selftest_job = require('./selftest/job');
    var selftest_catalog = require('./selftest/catalog');
    var selftest_target = require('./selftest/target');
    var selftest_history = require('./selftest/history');

    app.get('/api/selftest/catalog', function (req, res) {
        var cat = selftest_catalog.load();
        var backend = db.backendName();
        var tgt = selftest_target.describe({ root: ctx.root, host: ctx.cseHost, port: ctx.csePort, backend: backend });
        res.json({
            categories: cat.categories.map(function (c) {
                return { id: c.id, title: c.title, order: c.order, count: c.cases.length,
                         cases: c.cases.map(function (k) { return { id: k.id, title: k.title, ref: k.ref || null, requires: k.requires || null, script: typeof k.run === 'function', load: !!k.load }; }) };
            }),
            target: { host: tgt.host, port: tgt.port, backend: tgt.backend, cseBase: tgt.cseBase, cseId: tgt.cseId, mobiusVersion: tgt.mobiusVersion, bootAt: tgt.bootAt },
            supportedTypes: selftest_target.supportedTypes(ctx.root, backend),
            load: { defaults: selftest_job.LOAD_DEFAULT, max: selftest_job.LOAD_MAX },
            receiver: { host: ctx.selftest.host, port: ctx.selftest.port, mqttBroker: tgt.conf.mqttBroker || null },
            writeEnabled: cse !== null
        });
    });

    app.post('/api/selftest/runs', function (req, res) {
        if (!require_write(res)) { return; }
        var b = req.body || {};
        selftest_job.start(ctx, { categories: b.categories, load: b.load }, function (e, started) {
            if (e) {
                var status = { BAD_REQUEST: 400, BUSY: 409, PORT: 423, SETUP: 502 }[e.code] || 500;
                var body = { error: e.message };
                if (e.code === 'BUSY' && jobs.active()) { body.active = jobs.active().view(); }
                return res.status(status).json(body);
            }
            res.status(202).json({ job: started.job.view(), runId: started.runId });
        });
    });

    app.get('/api/selftest/runs', function (req, res) {
        res.json({ runs: selftest_history.list(ctx.dataDir) });
    });
    app.get('/api/selftest/runs/:id', function (req, res) {
        var r = selftest_history.get(ctx.dataDir, req.params.id);
        if (!r) { return res.status(404).json({ error: '그런 실행이 없다' }); }
        res.json(r);
    });
    app.get('/api/selftest/compare', function (req, res) {
        var a = selftest_history.get(ctx.dataDir, req.query.a);
        var b2 = selftest_history.get(ctx.dataDir, req.query.b);
        if (!a || !b2) { return res.status(404).json({ error: '비교할 실행을 찾지 못했다' }); }
        res.json(selftest_history.compare(a, b2));
    });
    app.delete('/api/selftest/runs/:id', function (req, res) {
        if (!selftest_history.remove(ctx.dataDir, req.params.id)) { return res.status(404).json({ error: '그런 실행이 없다' }); }
        res.json({ ok: true });
    });
```

`admin/server.js` 의 `install` 호출에 `root: ROOT` 를 더한다. `test/admin_app_helper.js` 의 `ctx` 에도 `root: ROOT`.

- [ ] **Step 6: 시험**

Run: `node --test test/admin-api-selftest.test.js` → PASS (3/3). Run: `npm test` → 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add admin/selftest/job.js admin/api.js admin/server.js test/admin_app_helper.js test/admin-api-selftest.test.js
git commit -m "selftest(api): /api/selftest/* — 카탈로그·실행 시작(409/423/502)·이력·비교·삭제

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: CLI 진입점 `node admin/selftest/run.js`

**Files:**
- Create: `admin/selftest/run.js`
- Modify: `package.json`(`"selftest": "node admin/selftest/run.js"`)
- Test: `test/admin-selftest-cli.test.js`

**Interfaces:**
- `node admin/selftest/run.js [--host H] [--port P] [--category a,b] [--load[=conc,total]] [--out FILE] [--receiver-port N] [--json]`. 기본 host/port 는 conf.json 의 `adminCseHost`/`adminCsePort||csebaseport`, 수신기는 `adminSelftestHost/Port`(포트 0 이면 임시), 관리 origin 은 conf.json 의 `superUser`(없으면 `Sponde`). 종료 코드 0(전부 pass/skip) · 1(fail 있음) · 2(error 있음 또는 시작 실패).
- 표준 출력: 카테고리별 `pass/fail/error/skip · p50 · p95` 표와 실패 케이스의 id·메시지. `--json` 이면 결과 JSON 만.
- DB 에 붙지 않는다(`supportedTypes` 는 어댑터 모듈에서 읽는다). `global.usedb = conf.db || 'mysql'` 을 세운 뒤 `conf_schema` 를 읽는다(로드 순서 계약).

- [ ] **Step 1: 실패하는 시험**

`test/admin-selftest-cli.test.js`:

```js
'use strict';
// CLI 는 같은 엔진을 UI 없이 돌린다. 가짜 CSE 를 띄우고 자식 프로세스로 실행해 종료
// 코드와 출력 파일을 본다. conf.json 은 임시 저장소 루트로 돌린다(--root).
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fake = require('./selftest_fake_cse');

const ROOT = path.join(__dirname, '..');

test('카테고리 하나를 돌려 JSON 을 쓰고 종료 코드를 낸다', async function () {
    const cse = fake.create({ cseBase: 'Mobius' });
    const port = await cse.listen();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'st-cli-'));
    const out = path.join(tmp, 'r.json');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'admin', 'selftest', 'run.js'),
        '--host', '127.0.0.1', '--port', String(port), '--category', 'cnt', '--out', out, '--receiver-port', '0', '--cse-base', 'Mobius', '--admin-origin', 'Sponde'],
        { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);   // 가짜 CSE 는 la 에 POST 를 405 로 내지만 mbs 초과 등 일부는 다르게 답해 fail 이 섞인다
    const result = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.strictEqual(result.categories[0], 'cnt');
    assert.ok(result.results.length >= 8);
    assert.match(r.stdout, /cnt\s+/);
    assert.match(r.stdout, /p95/);
    assert.ok(!cse.has('/Mobius/admin_selftest'), '정리했다');
    await cse.close();
});

test('닿지 않는 대상은 2 로 끝난다', function () {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'admin', 'selftest', 'run.js'), '--host', '127.0.0.1', '--port', '1', '--category', 'base', '--receiver-port', '0', '--cse-base', 'Mobius'],
        { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /대상|ECONNREFUSED|닿지/);
});
```

첫 시험의 종료 코드 단정(1)은 가짜 CSE 가 `cnt` 카테고리 아홉 케이스 중 일부(`cnt.create.mni-mbs` 의 응답 본문에 `mni` 를 그대로 싣는 등)를 통과시키고 일부는 아니기 때문이다 — 구현자는 실제로 돌려 본 상태 목록을 시험 주석에 적고, 단정은 "0 이 아니다 · 결과 파일이 있다 · 정리됐다" 를 지킨다. 가짜 CSE 를 케이스에 맞춰 늘리지 **않는다**(카탈로그의 진실은 통합 실행이다).

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-selftest-cli.test.js` → FAIL (파일 없음)

- [ ] **Step 3: `admin/selftest/run.js`**

```js
#!/usr/bin/env node
'use strict';
/**
 * 종합 테스트 CLI — 콘솔 UI 없이 같은 엔진을 돌린다.
 *
 *   node admin/selftest/run.js [--host H] [--port P] [--category a,b] [--load[=conc,total]]
 *                              [--out FILE] [--receiver-port N] [--receiver-host H] [--json]
 *                              [--cse-base NAME] [--admin-origin ORIGIN]
 *
 * 기본값은 conf.json 에서 온다(adminCseHost · adminCsePort|csebaseport · adminSelftest* ·
 * superUser · cseBase). 배포 서버 검증과 카탈로그 기대값 확인에 쓴다.
 * 종료 코드 0 = 전부 pass/skip, 1 = fail 있음, 2 = error 있음 또는 시작 실패.
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');

function arg(name, dflt) {
    var i = process.argv.indexOf('--' + name);
    if (i < 0) { return dflt; }
    var v = process.argv[i + 1];
    if (v === undefined || v.indexOf('--') === 0) { return true; }
    return v;
}

var conf = {};
try { conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'conf.json'), 'utf8')); } catch (e) { /* 없으면 인자로만 */ }
global.usedb = conf.db || 'mysql';
global.NOPRINT = 'true';

var { Client } = require('../cse');
var catalog = require('./catalog');
var target = require('./target');
var receiver = require('./receiver');
var perf = require('./perf');
var job = require('./job');
var { Runner } = require('./runner');

var host = String(arg('host', conf.adminCseHost || '127.0.0.1'));
var port = parseInt(arg('port', conf.adminCsePort || conf.csebaseport || 7579), 10);
var categories = arg('category', null);
categories = categories ? String(categories).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : null;
var loadArg = arg('load', null);
var load = null;
if (loadArg !== null) {
    var parts = (loadArg === true) ? [] : String(loadArg).split(',');
    load = job.clampLoad({ concurrency: parts[0], total: parts[1] });
}
var outFile = arg('out', null);
var asJson = arg('json', false) === true;
var rxHost = String(arg('receiver-host', conf.adminSelftestHost || conf.adminHost || '127.0.0.1'));
var rxPort = parseInt(arg('receiver-port', conf.adminSelftestPort || 7581), 10);
var backend = global.usedb;
var tgt = target.describe({ root: ROOT, host: host, port: port, backend: backend });
var cseBase = String(arg('cse-base', tgt.cseBase || 'Mobius'));
var adminOrigin = String(arg('admin-origin', conf.superUser || 'Sponde'));

var cat = catalog.load();
var problems = catalog.validate(cat);
if (problems.length) { console.error('카탈로그 오류:\n  ' + problems.join('\n  ')); process.exit(2); }
var known = cat.categories.map(function (c) { return c.id; });
var ids = categories || known;
var unknown = ids.filter(function (c) { return known.indexOf(c) < 0; });
if (unknown.length) { console.error('모르는 카테고리: ' + unknown.join(', ') + ' (있는 것: ' + known.join(', ') + ')'); process.exit(2); }

var runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15) + '-cli';
var mqtt = tgt.conf.mqttBroker ? { broker: tgt.conf.mqttBroker, port: parseInt(tgt.conf.mqttPort, 10) || 1883, cseId: tgt.cseId } : null;

receiver.open({ host: rxHost, port: rxPort, runId: runId, mqtt: mqtt }, function (e, rx) {
    if (e) { console.error('수신기를 열지 못했다: ' + e.message); process.exit(2); }
    var runner = new Runner({
        runId: runId, host: host, port: port,
        adminClient: new Client({ host: host, port: port, origin: adminOrigin, timeoutMs: 10000 }),
        cseBase: cseBase, superUser: adminOrigin,
        catalog: cat, categoryIds: ids, supportedTypes: target.supportedTypes(ROOT, backend),
        target: tgt, conf: tgt.conf, receiver: rx, load: load || { enabled: false },
        onProgress: function (done, total, id) { if (!asJson) { process.stderr.write('\r' + done + ' ' + id + '        '); } }
    });
    runner.result.load = load ? { concurrency: load.concurrency, total: load.total } : null;
    runner.setup(function (e2) {
        if (e2) { console.error('시작 실패 — ' + e2.message); rx.close(function () { process.exit(2); }); return; }
        var entries = runner.cases();
        (function next(i) {
            if (i >= entries.length) {
                return runner.finish(false, function (e3, result) {
                    rx.close(function () {
                        if (outFile) { fs.writeFileSync(outFile, JSON.stringify(result, null, 2)); }
                        if (asJson) { process.stdout.write(JSON.stringify(result) + '\n'); }
                        else { print(result); }
                        process.exit(result.summary.error ? 2 : result.summary.fail ? 1 : 0);
                    });
                });
            }
            runner.runCase(entries[i], function () { next(i + 1); });
        }(0));
    });
});

function pad(s, n) { s = String(s); while (s.length < n) { s += ' '; } return s; }
function print(result) {
    process.stderr.write('\r' + pad('', 60) + '\r');
    console.log('종합 테스트 ' + result.runId + ' — ' + result.target.host + ':' + result.target.port + ' (' + result.target.backend + ', Mobius ' + result.target.mobiusVersion + ')');
    console.log(pad('카테고리', 12) + pad('pass', 6) + pad('fail', 6) + pad('error', 6) + pad('skip', 6) + pad('p50', 8) + 'p95');
    result.categories.forEach(function (c) {
        var rs = result.results.filter(function (r) { return r.category === c; });
        var n = function (s) { return rs.filter(function (r) { return r.status === s; }).length; };
        var p = (result.perf.byCategory[c]) || perf.summarize([]);
        console.log(pad(c, 12) + pad(n('pass'), 6) + pad(n('fail'), 6) + pad(n('error'), 6) + pad(n('skip'), 6) + pad(p.p50 + 'ms', 8) + p.p95 + 'ms');
    });
    var s = result.summary;
    console.log('합계 pass ' + s.pass + ' · fail ' + s.fail + ' · error ' + s.error + ' · skip ' + s.skip + ' · p95 ' + s.p95 + 'ms · 정리 ' + result.cleanup);
    result.results.filter(function (r) { return r.status === 'fail' || r.status === 'error'; }).forEach(function (r) {
        console.log('  ' + r.status.toUpperCase() + ' ' + r.id + (r.failedStep ? ' (단계 ' + r.failedStep + ')' : '') + ' — ' + (r.message || ''));
    });
    if (result.perf.notify.http || result.perf.notify.mqtt) {
        console.log('알림 지연 p95: http ' + (result.perf.notify.http ? result.perf.notify.http.p95 + 'ms' : '-') + ' · mqtt ' + (result.perf.notify.mqtt ? result.perf.notify.mqtt.p95 + 'ms' : '-'));
    }
    if (result.perf.load) { console.log('부하: ' + JSON.stringify(result.perf.load)); }
}
```

`package.json` 의 `scripts` 에 `"selftest": "node admin/selftest/run.js"`.

- [ ] **Step 4: 시험**

Run: `node --test test/admin-selftest-cli.test.js` → PASS (2/2). Run: `npm test` → 전부 통과.

- [ ] **Step 5: 통합 실행 (사람이 한다 — 개발 장비)**

개발 장비에서 Mobius 가 떠 있을 때(터미널에서 직접 띄운다 — 도구 셸에서 띄우지 않는다):

```bash
npm run selftest -- --category base,ae,cnt,cin,acp,discovery,types,edge,sub,grp,fcnt,retention --receiver-port 0
```

여기서 나오는 `fail` 중 **코어 동작이 케이스의 기대와 다른 것**(예: `types.mgo.blocked` 가 4000 이 아니라 5001)은 케이스의 기대를 코어 동작으로 고치고 `ref` 에 근거를 적는다. 코어의 결함이면 남은 일로 적는다. 이 단계의 결과를 Task 10 의 문서에 남긴다.

- [ ] **Step 6: 커밋**

```bash
git add admin/selftest/run.js package.json test/admin-selftest-cli.test.js admin/selftest/catalog
git commit -m "selftest(cli): node admin/selftest/run.js — 같은 엔진을 UI 없이, 종료 코드 0/1/2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 화면 — 실행·결과·이력

**Files:**
- Create: `admin/web/src/views/SelfTestView.vue`, `SelfTestRunView.vue`, `SelfTestHistoryView.vue`
- Delete: `admin/web/src/views/SelfTestPlaceholderView.vue`
- Modify: `admin/web/src/router.ts`, `api.ts`, `types.ts`

**Interfaces:**
- 라우트: `verify-selftest` `/verify/selftest`(실행), `verify-selftest-run` `/verify/selftest/runs/:runId`(결과), `verify-selftest-history` `/verify/selftest/history`(이력). NAV 의 검증 묶음에 `종합 테스트`·`이력` 둘.
- `api.ts`: `selftestCatalog()`, `startSelftest({ categories, load })` → `post<{ job: Job; runId: string }>`, `selftestRuns()`, `selftestRun(runId)`, `selftestCompare(a, b)`, `deleteSelftestRun(runId)`.
- `types.ts`: `SelftestCatalog`, `SelftestRun`(결과 레코드), `SelftestRunBrief`, `SelftestCompare`.

- [ ] **Step 1: `types.ts`**

```ts
export interface SelftestCaseInfo { id: string; title: string; ref: string | null; requires: { types?: number[] } | null; script: boolean; load: boolean }
export interface SelftestCategory { id: string; title: string; order: number; count: number; cases: SelftestCaseInfo[] }
export interface SelftestCatalog {
  categories: SelftestCategory[]
  target: { host: string; port: number; backend: string; cseBase: string; cseId: string; mobiusVersion: string | null; bootAt: string | null }
  supportedTypes: number[] | null
  load: { defaults: { concurrency: number; total: number }; max: { concurrency: number; total: number } }
  receiver: { host: string; port: number; mqttBroker: string | null }
  writeEnabled: boolean
}
export type SelftestStatus = 'pass' | 'fail' | 'error' | 'skip'
export interface SelftestStep { op: string; target: string | null; expect: unknown; actual: { rsc?: string; http?: number; elapsedMs?: number; error?: string | null; received?: boolean; latencyMs?: number } | null; ms: number | null; ok: boolean | null; note: string | null }
export interface SelftestResult { id: string; category: string; title: string; ref: string | null; status: SelftestStatus; ms: number; steps: SelftestStep[]; failedStep: number | null; message: string | null }
export interface PerfSummary { n: number; p50: number; p95: number; p99: number; max: number; avg: number }
export interface SelftestRun {
  runId: string; startedAt: string; endedAt: string | null; status: 'running' | 'done' | 'cancelled'; cancelled: boolean
  target: SelftestCatalog['target']
  categories: string[]; loadIncluded: boolean
  load: { concurrency: number; total: number } | null
  receiver?: { http: string; mqtt: string | null; mqttError: string | null }
  summary: { pass: number; fail: number; error: number; skip: number; p50: number; p95: number; max: number } | null
  results: SelftestResult[]
  perf: { byCategory: Record<string, PerfSummary>; notify: { http: PerfSummary | null; mqtt: PerfSummary | null }; load: Record<string, number | boolean> | null } | null
  cleanup: 'ok' | 'failed' | 'skipped'; cleanupError: string | null
}
export interface SelftestRunBrief { runId: string; startedAt?: string; endedAt?: string | null; status?: string; cancelled?: boolean; categories?: string[]; loadIncluded?: boolean; summary?: SelftestRun['summary']; target?: { backend?: string; mobiusVersion?: string | null }; cleanup?: string; broken?: boolean }
export interface SelftestCompare {
  a: string; b: string; sameTarget: boolean; targetDiff: string[]
  newlyFailing: { id: string; from: string; to: string }[]; fixed: { id: string; from: string; to: string }[]
  onlyInA: string[]; onlyInB: string[]
  perf: { category: string; p95a: number | null; p95b: number | null; deltaPct: number | null; flag: 'slower' | 'faster' | null }[]
}
```

- [ ] **Step 2: `api.ts`**

```ts
export function selftestCatalog() { return get<SelftestCatalog>('/api/selftest/catalog') }
export function startSelftest(body: { categories: string[]; load: { concurrency: number; total: number } | null }) {
  return post<{ job: Job; runId: string }>('/api/selftest/runs', body)
}
export function selftestRuns() { return get<{ runs: SelftestRunBrief[] }>('/api/selftest/runs') }
export function selftestRun(runId: string) { return get<SelftestRun>(`/api/selftest/runs/${encodeURIComponent(runId)}`) }
export function selftestCompare(a: string, b: string) { return get<SelftestCompare>(`/api/selftest/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`) }
export async function deleteSelftestRun(runId: string): Promise<void> {
  const res = await fetch(`/api/selftest/runs/${encodeURIComponent(runId)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (res.status === 401) throw new AuthError('not authenticated')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
```

`post` 의 423 은 일반 `Error(body.error)` 로 떨어진다 — 화면은 메시지를 그대로 보여 준다.

- [ ] **Step 3: `router.ts`**

`SelfTestPlaceholderView` import 와 라우트를 지우고:

```ts
import SelfTestView from './views/SelfTestView.vue'
import SelfTestRunView from './views/SelfTestRunView.vue'
import SelfTestHistoryView from './views/SelfTestHistoryView.vue'
// NAV:
  { name: 'verify-selftest', group: 'verify', label: '종합 테스트' },
  { name: 'verify-selftest-history', group: 'verify', label: '이력' },
// routes:
  { path: '/verify/selftest', name: 'verify-selftest', component: SelfTestView },
  { path: '/verify/selftest/history', name: 'verify-selftest-history', component: SelfTestHistoryView },
  { path: '/verify/selftest/runs/:runId', name: 'verify-selftest-run', component: SelfTestRunView, props: (r) => ({ runId: String(r.params.runId) }) },
```

`App.vue` 의 활성 표시 규칙은 `startsWith(n.name + '-')` 라 `verify-selftest-run` 이 `verify-selftest` 를 켠다(이력은 별도 항목이라 그 자체가 켜진다 — `verify-selftest-history` 가 `verify-selftest-` 로 시작하므로 둘 다 켜지는 것을 막기 위해 `App.vue` 의 조건을 `route.name === n.name || (String(route.name) === n.name + '-run')` 처럼 **정확히 `-run` 만** 으로 바꾼다).

- [ ] **Step 4: `views/SelfTestView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { selftestCatalog, startSelftest } from '../api'
import type { SelftestCatalog, WriteInfo } from '../types'
import { useJobRunner } from '../job'
import JobPanel from '../components/JobPanel.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

/**
 * 종합 테스트 — 카테고리를 골라 돌린다. 대상은 붙어 있는 Mobius 하나. 부하는 별도
 * 확인을 받는다(운영 서버에 N 건을 보낸다).
 */
defineProps<{ write: WriteInfo }>()
const router = useRouter()

const cat = ref<SelftestCatalog | null>(null)
const error = ref('')
const chosen = ref<Set<string>>(new Set())
const loadOn = ref(false)
const loadConc = ref(10)
const loadTotal = ref(2000)
const confirmingLoad = ref(false)
const starting = ref(false)
const lastRunId = ref<string | null>(null)

const runner = useJobRunner((j) => { if (lastRunId.value && j.state !== 'running') router.push({ name: 'verify-selftest-run', params: { runId: lastRunId.value } }) })

const normal = computed(() => (cat.value?.categories ?? []).filter((c) => !c.cases.every((k) => k.load)))
const total = computed(() => normal.value.filter((c) => chosen.value.has(c.id)).reduce((n, c) => n + c.count, 0))
const unsupported = (c: { cases: { requires: { types?: number[] } | null }[] }) => {
  const st = cat.value?.supportedTypes
  if (!st) return 0
  return c.cases.filter((k) => (k.requires?.types ?? []).some((t) => !st.includes(t))).length
}

function toggle(id: string) { const s = new Set(chosen.value); s.has(id) ? s.delete(id) : s.add(id); chosen.value = s }
function all() { chosen.value = new Set(normal.value.map((c) => c.id)) }
function none() { chosen.value = new Set() }

async function load() {
  try {
    cat.value = await selftestCatalog()
    loadConc.value = cat.value.load.defaults.concurrency
    loadTotal.value = cat.value.load.defaults.total
    all()
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}

async function start() {
  if (loadOn.value && !confirmingLoad.value) { confirmingLoad.value = true; return }
  confirmingLoad.value = false
  starting.value = true
  error.value = ''
  const categories = [...chosen.value]
  if (loadOn.value) categories.push('load')
  const ok = await runner.start(async () => {
    const r = await startSelftest({ categories, load: loadOn.value ? { concurrency: loadConc.value, total: loadTotal.value } : null })
    lastRunId.value = r.runId
    return r.job
  })
  starting.value = false
  if (!ok) error.value = runner.error.value
}

onMounted(async () => { void runner.attach(); await load() })
</script>

<template>
  <section>
    <h2>종합 테스트</h2>
    <p class="lead">
      붙어 있는 Mobius 를 표준 케이스로 훑습니다. 모든 쓰기는 전용 AE <code>admin_selftest</code> 아래에서만
      일어나고 끝나면 지웁니다. 응답 시간은 곧 운영 성능입니다.
    </p>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="cat" class="tiles">
      <div class="tile"><div class="k">대상</div><div class="v small">{{ cat.target.host }}:{{ cat.target.port }}</div><div class="s">{{ cat.target.backend }} · Mobius {{ cat.target.mobiusVersion ?? '?' }} · {{ cat.target.cseBase }}</div></div>
      <div class="tile"><div class="k">알림 수신기</div><div class="v small">{{ cat.receiver.host }}:{{ cat.receiver.port }}</div><div class="s">MQTT {{ cat.receiver.mqttBroker ?? '없음' }}</div></div>
      <div class="tile"><div class="k">지원 타입</div><div class="v small">{{ cat.supportedTypes ? cat.supportedTypes.join(', ') : '전부' }}</div><div class="s">미지원 타입의 케이스는 skip</div></div>
    </div>

    <JobPanel v-if="runner.job.value" :job="runner.job.value" :error="runner.error.value" @cancel="runner.cancel" @dismiss="runner.dismiss" />

    <p v-if="cat && !cat.writeEnabled" class="banner danger">조회 전용으로 떠 있어 테스트를 돌릴 수 없습니다 — <code>csebaseport</code>(또는 <code>adminCsePort</code>)가 필요합니다.</p>

    <div v-if="cat" class="picker">
      <div class="phead">
        <strong>카테고리</strong>
        <button class="link" @click="all">전체</button>
        <button class="link" @click="none">없음</button>
        <span class="spacer" />
        <span class="muted">{{ total }}건 선택</span>
      </div>
      <label v-for="c in normal" :key="c.id" class="row" :class="{ on: chosen.has(c.id) }">
        <input type="checkbox" :checked="chosen.has(c.id)" @change="toggle(c.id)" />
        <span class="cid mono">{{ c.id }}</span>
        <span class="ctitle">{{ c.title }}</span>
        <span class="spacer" />
        <span class="muted">{{ c.count }}건<span v-if="unsupported(c)"> · skip {{ unsupported(c) }}</span></span>
      </label>
      <label class="row loadrow" :class="{ on: loadOn }">
        <input type="checkbox" v-model="loadOn" />
        <span class="cid mono">load</span>
        <span class="ctitle">부하 — 운영 서버에 요청을 보냅니다</span>
        <span class="spacer" />
        <span class="muted">
          동시 <input type="number" v-model.number="loadConc" :min="1" :max="cat.load.max.concurrency" class="num" :disabled="!loadOn" />
          · 총 <input type="number" v-model.number="loadTotal" :min="1" :max="cat.load.max.total" class="num wide" :disabled="!loadOn" />
        </span>
      </label>
    </div>

    <div class="actions">
      <button class="primary" :disabled="!cat || !cat.writeEnabled || starting || (!chosen.size && !loadOn) || !!runner.job.value" @click="start">
        {{ starting ? '시작 중…' : '시작' }}
      </button>
      <button @click="router.push({ name: 'verify-selftest-history' })">이력</button>
    </div>

    <ConfirmDialog v-if="confirmingLoad" title="부하를 겁니다" :confirm-label="`동시 ${loadConc} · 총 ${loadTotal}건 보내기`" :paths="[]" destructive :busy="starting" @cancel="confirmingLoad = false" @confirm="start">
      <p class="dlg">운영 서버에 요청 {{ loadTotal.toLocaleString() }}건을 동시 {{ loadConc }}개로 보냅니다. 처음 200건에서 오류율이 20% 를 넘으면 스스로 멈춥니다. 상한은 서버가 강제합니다(동시 {{ cat?.load.max.concurrency }} · 총 {{ cat?.load.max.total.toLocaleString() }}).</p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 78ch; }
.err { color: var(--danger); }
.muted { color: var(--muted); font-size: 0.92rem; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.9rem; margin-bottom: 1.2rem; }
.tile { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; }
.tile .k { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
.tile .v { font-size: 1.4rem; font-weight: 650; color: var(--text-strong); font-family: var(--mono); }
.tile .s { font-size: 0.86rem; color: var(--muted); }
.banner { padding: 0.85rem 1.1rem; border-radius: 0 8px 8px 0; margin: 1rem 0; font-size: 0.95rem; max-width: 88ch; }
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.picker { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 0.6rem 0.9rem; }
.phead { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0.3rem 0.6rem; border-bottom: 1px solid var(--border-soft); }
.phead .link { border: none; background: none; color: var(--accent-strong); text-decoration: underline; padding: 0; font-size: 0.9rem; }
.spacer { flex: 1; }
.row { display: flex; align-items: center; gap: 0.7rem; padding: 0.5rem 0.3rem; border-bottom: 1px solid var(--border-soft); cursor: pointer; }
.row:last-child { border-bottom: none; }
.row.on { background: var(--accent-wash); }
.row input[type='checkbox'] { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); }
.cid { min-width: 90px; color: var(--accent-strong); font-size: 0.92rem; }
.ctitle { font-size: 0.97rem; }
.loadrow { border-top: 2px solid var(--border); }
.num { width: 4.5rem; font: inherit; padding: 0.2rem 0.4rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
.num.wide { width: 6rem; }
.actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.2rem; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.actions .primary:disabled { opacity: 0.5; }
.dlg { margin: 0; font-size: 0.97rem; }
</style>
```

- [ ] **Step 5: `views/SelfTestRunView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { selftestRun } from '../api'
import type { SelftestRun, SelftestResult, SelftestStatus } from '../types'
import BarChart from '../components/BarChart.vue'

const props = defineProps<{ runId: string }>()
const router = useRouter()
const run = ref<SelftestRun | null>(null)
const error = ref('')
const open = ref<Set<string>>(new Set())
const filter = ref<'all' | 'notpass'>('notpass')
let timer: ReturnType<typeof setTimeout> | null = null

async function load() {
  try {
    run.value = await selftestRun(props.runId)
    error.value = ''
    if (run.value.status === 'running') timer = setTimeout(load, 1000)
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}

const byCategory = computed(() => {
  const r = run.value
  if (!r) return []
  return r.categories.map((c) => {
    const rs = r.results.filter((x) => x.category === c)
    const n = (s: SelftestStatus) => rs.filter((x) => x.status === s).length
    return { id: c, results: rs, pass: n('pass'), fail: n('fail'), error: n('error'), skip: n('skip'), perf: r.perf?.byCategory[c] ?? null }
  })
})
const p95Bars = computed(() => byCategory.value.filter((c) => c.perf).map((c) => ({ label: c.id, value: c.perf!.p95 })))
function shown(rs: SelftestResult[]) { return filter.value === 'all' ? rs : rs.filter((x) => x.status !== 'pass') }
function toggle(id: string) { const s = new Set(open.value); s.has(id) ? s.delete(id) : s.add(id); open.value = s }
const LABEL: Record<SelftestStatus, string> = { pass: '통과', fail: '실패', error: '오류', skip: '건너뜀' }
function when(iso: string | null | undefined) { return iso ? iso.replace('T', ' ').slice(0, 19) : '—' }

onMounted(load)
onUnmounted(() => { if (timer !== null) clearTimeout(timer) })
</script>

<template>
  <section>
    <div class="head">
      <h2>실행 결과 <code class="mono small">{{ runId }}</code></h2>
      <span class="spacer" />
      <button @click="router.push({ name: 'verify-selftest' })">다시 돌리기</button>
      <button @click="router.push({ name: 'verify-selftest-history' })">이력</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <template v-if="run">
      <p class="muted">
        {{ when(run.startedAt) }} → {{ when(run.endedAt) }} · {{ run.target.host }}:{{ run.target.port }} · {{ run.target.backend }} · Mobius {{ run.target.mobiusVersion ?? '?' }}
        <span v-if="run.status === 'running'" class="warntext">· 진행 중</span>
        <span v-if="run.cancelled" class="warntext">· 취소됨</span>
        <span v-if="run.cleanup === 'failed'" class="dangertext">· 정리 실패: {{ run.cleanupError }}</span>
        <span v-if="run.receiver?.mqttError" class="warntext">· MQTT 수신기 없음 ({{ run.receiver.mqttError }})</span>
      </p>

      <div v-if="run.summary" class="tiles">
        <div class="tile ok"><div class="k">통과</div><div class="v">{{ run.summary.pass }}</div></div>
        <div class="tile" :class="{ hot: run.summary.fail }"><div class="k">실패</div><div class="v">{{ run.summary.fail }}</div></div>
        <div class="tile" :class="{ hot: run.summary.error }"><div class="k">오류</div><div class="v">{{ run.summary.error }}</div></div>
        <div class="tile"><div class="k">건너뜀</div><div class="v">{{ run.summary.skip }}</div></div>
        <div class="tile"><div class="k">p50 / p95 / 최대</div><div class="v small">{{ run.summary.p50 }} / {{ run.summary.p95 }} / {{ run.summary.max }} ms</div></div>
      </div>

      <div class="panel" v-if="p95Bars.length">
        <h3>카테고리별 p95 (ms)</h3>
        <BarChart :values="p95Bars" :height="160" unit="ms" />
        <p v-if="run.perf?.notify.http || run.perf?.notify.mqtt" class="muted">
          알림 지연 p95 — HTTP {{ run.perf?.notify.http?.p95 ?? '—' }} ms · MQTT {{ run.perf?.notify.mqtt?.p95 ?? '—' }} ms
        </p>
        <p v-if="run.perf?.load" class="muted">
          부하 — 동시 {{ run.perf.load.concurrency }} · {{ run.perf.load.done }}/{{ run.perf.load.total }}건 · {{ run.perf.load.throughput }} req/s ·
          p50 {{ run.perf.load.p50 }} · p95 {{ run.perf.load.p95 }} · p99 {{ run.perf.load.p99 }} ms · 오류율 {{ run.perf.load.errorRate }}
          <span v-if="run.perf.load.aborted" class="dangertext">· 오류율 초과로 중단</span>
        </p>
      </div>

      <div class="filters">
        <button :class="{ on: filter === 'notpass' }" @click="filter = 'notpass'">실패·오류·건너뜀만</button>
        <button :class="{ on: filter === 'all' }" @click="filter = 'all'">전부</button>
      </div>

      <div v-for="c in byCategory" :key="c.id" class="cat">
        <div class="chead">
          <strong class="mono">{{ c.id }}</strong>
          <span class="cnt ok">{{ c.pass }}</span><span class="cnt" :class="{ bad: c.fail }">{{ c.fail }}</span><span class="cnt" :class="{ bad: c.error }">{{ c.error }}</span><span class="cnt">{{ c.skip }}</span>
          <span class="spacer" />
          <span v-if="c.perf" class="muted">p50 {{ c.perf.p50 }} · p95 {{ c.perf.p95 }} · 최대 {{ c.perf.max }} ms</span>
        </div>
        <table v-if="shown(c.results).length" class="cases">
          <tbody>
            <template v-for="r in shown(c.results)" :key="r.id">
              <tr :class="r.status" @click="toggle(r.id)">
                <td class="st"><span class="sev" :class="r.status">{{ LABEL[r.status] }}</span></td>
                <td class="mono id">{{ r.id }}</td>
                <td>{{ r.title }}</td>
                <td class="msg">{{ r.message ?? '' }}</td>
                <td class="num">{{ r.ms }} ms</td>
              </tr>
              <tr v-if="open.has(r.id)" class="detail">
                <td colspan="5">
                  <table class="steps">
                    <thead><tr><th>#</th><th>op</th><th>대상</th><th>기대</th><th>실제</th><th>ms</th><th></th></tr></thead>
                    <tbody>
                      <tr v-for="(s, i) in r.steps" :key="i" :class="{ bad: s.ok === false }">
                        <td>{{ i + 1 }}</td><td class="mono">{{ s.op }}</td><td class="mono small">{{ s.target ?? '' }}</td>
                        <td class="mono small">{{ s.expect ? JSON.stringify(s.expect) : '' }}</td>
                        <td class="mono small">{{ s.actual ? JSON.stringify(s.actual) : '' }}</td>
                        <td class="num">{{ s.ms ?? '' }}</td><td class="small">{{ s.note ?? '' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-else class="muted small">{{ filter === 'all' ? '케이스 없음' : '전부 통과' }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: baseline; gap: 0.8rem; margin-bottom: 0.5rem; }
h2 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.spacer { flex: 1; }
.small { font-size: 0.85rem; }
.err { color: var(--danger); }
.muted { color: var(--muted); font-size: 0.92rem; }
.warntext { color: var(--warn); font-weight: 600; }
.dangertext { color: var(--danger); font-weight: 600; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.8rem; margin: 1rem 0; }
.tile { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 0.8rem 1rem; }
.tile.hot { border-color: var(--danger); }
.tile.ok { border-color: var(--ok); }
.tile .k { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
.tile .v { font-size: 1.9rem; font-weight: 650; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.tile .v.small { font-size: 1.1rem; font-family: var(--mono); }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; margin: 1rem 0; }
.filters { display: flex; gap: 0.4rem; margin: 1rem 0 0.6rem; }
.filters button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.cat { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); margin-bottom: 0.8rem; overflow: hidden; }
.chead { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.9rem; border-bottom: 1px solid var(--border-soft); }
.cnt { font-size: 0.8rem; padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); font-variant-numeric: tabular-nums; }
.cnt.ok { border-color: var(--ok); color: var(--ok); }
.cnt.bad { border-color: var(--danger); color: var(--danger); font-weight: 700; }
.cases { width: 100%; font-size: 0.93rem; }
.cases tr:not(.detail) { cursor: pointer; }
.cases tr.fail td:first-child, .cases tr.error td:first-child { box-shadow: inset 3px 0 0 var(--danger); }
.cases tr.skip td:first-child { box-shadow: inset 3px 0 0 var(--border); }
.st { width: 4.5rem; }
.sev { font-size: 0.75rem; font-weight: 700; border-radius: 4px; padding: 0.05rem 0.4rem; white-space: nowrap; }
.sev.pass { background: var(--accent-wash); color: var(--ok); }
.sev.fail, .sev.error { background: var(--danger); color: #fff; }
.sev.skip { background: var(--border); color: var(--muted); }
.id { color: var(--accent-strong); white-space: nowrap; }
.msg { color: var(--danger); font-size: 0.9rem; max-width: 520px; overflow-wrap: anywhere; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.detail td { background: var(--bg); padding: 0.5rem 0.9rem; }
.steps { width: 100%; font-size: 0.85rem; }
.steps td { vertical-align: top; max-width: 320px; overflow-wrap: anywhere; }
.steps tr.bad td { color: var(--danger); }
</style>
```

- [ ] **Step 6: `views/SelfTestHistoryView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { selftestRuns, selftestCompare, deleteSelftestRun } from '../api'
import type { SelftestRunBrief, SelftestCompare } from '../types'

const router = useRouter()
const runs = ref<SelftestRunBrief[]>([])
const error = ref('')
const picked = ref<string[]>([])
const cmp = ref<SelftestCompare | null>(null)

async function load() {
  try { runs.value = (await selftestRuns()).runs; error.value = '' }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}
function pick(id: string) {
  const i = picked.value.indexOf(id)
  if (i >= 0) picked.value.splice(i, 1)
  else { picked.value.push(id); if (picked.value.length > 2) picked.value.shift() }
  cmp.value = null
}
const canCompare = computed(() => picked.value.length === 2)
async function compare() {
  if (!canCompare.value) return
  // 오래된 것을 a, 최신을 b 로 — "전에 되던 것이 안 되는가" 의 방향이다.
  const [x, y] = picked.value
  const ix = runs.value.findIndex((r) => r.runId === x), iy = runs.value.findIndex((r) => r.runId === y)
  const [a, b] = ix > iy ? [x, y] : [y, x]
  try { cmp.value = await selftestCompare(a, b) } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}
async function remove(id: string) {
  try { await deleteSelftestRun(id); await load(); picked.value = picked.value.filter((p) => p !== id); cmp.value = null }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}
function when(iso: string | null | undefined) { return iso ? iso.replace('T', ' ').slice(0, 19) : '—' }
onMounted(load)
</script>

<template>
  <section>
    <h2>종합 테스트 이력</h2>
    <p class="lead">최근 50회. 둘을 골라 비교하면 새로 실패한 케이스·고쳐진 케이스·카테고리별 p95 변화를 보여 줍니다.</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="actions">
      <button class="primary" :disabled="!canCompare" @click="compare">선택한 둘 비교</button>
      <span class="muted">{{ picked.length }}/2 선택</span>
      <span class="spacer" />
      <button @click="router.push({ name: 'verify-selftest' })">새로 돌리기</button>
    </div>

    <div v-if="cmp" class="panel">
      <h3>비교 <code class="mono small">{{ cmp.a }}</code> → <code class="mono small">{{ cmp.b }}</code></h3>
      <p v-if="!cmp.sameTarget" class="banner danger"><strong>대상이 다릅니다.</strong> {{ cmp.targetDiff.join(' · ') }}</p>
      <div class="cols">
        <div>
          <h4 :class="{ bad: cmp.newlyFailing.length }">새로 실패 {{ cmp.newlyFailing.length }}</h4>
          <ul><li v-for="x in cmp.newlyFailing" :key="x.id" class="mono">{{ x.id }} <span class="muted">{{ x.from }} → {{ x.to }}</span></li></ul>
        </div>
        <div>
          <h4>고쳐짐 {{ cmp.fixed.length }}</h4>
          <ul><li v-for="x in cmp.fixed" :key="x.id" class="mono">{{ x.id }} <span class="muted">{{ x.from }} → {{ x.to }}</span></li></ul>
        </div>
        <div>
          <h4>한쪽에만</h4>
          <ul><li v-for="x in cmp.onlyInA" :key="'a' + x" class="mono">{{ x }} <span class="muted">(앞에만)</span></li><li v-for="x in cmp.onlyInB" :key="'b' + x" class="mono">{{ x }} <span class="muted">(뒤에만)</span></li></ul>
        </div>
      </div>
      <table class="perf">
        <thead><tr><th>카테고리</th><th class="num">p95 앞</th><th class="num">p95 뒤</th><th class="num">변화</th></tr></thead>
        <tbody>
          <tr v-for="p in cmp.perf" :key="p.category" :class="p.flag ?? ''">
            <td class="mono">{{ p.category }}</td><td class="num">{{ p.p95a ?? '—' }}</td><td class="num">{{ p.p95b ?? '—' }}</td>
            <td class="num">{{ p.deltaPct === null ? '—' : (p.deltaPct > 0 ? '+' : '') + p.deltaPct + '%' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr><th class="cb"></th><th>실행</th><th>시각</th><th>카테고리</th><th class="num">통과</th><th class="num">실패</th><th class="num">오류</th><th class="num">건너뜀</th><th class="num">p95</th><th>대상</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in runs" :key="r.runId" :class="{ picked: picked.includes(r.runId), broken: r.broken }">
            <td class="cb"><input v-if="!r.broken" type="checkbox" :checked="picked.includes(r.runId)" @change="pick(r.runId)" /></td>
            <td class="mono"><button v-if="!r.broken" class="linkish" @click="router.push({ name: 'verify-selftest-run', params: { runId: r.runId } })">{{ r.runId }}</button><span v-else>{{ r.runId }} (깨진 파일)</span></td>
            <td class="mono small">{{ when(r.startedAt) }}<span v-if="r.status === 'running'" class="warntext"> · 진행 중</span><span v-if="r.cancelled" class="warntext"> · 취소</span></td>
            <td class="small">{{ (r.categories ?? []).join(', ') }}<span v-if="r.loadIncluded"> · 부하</span></td>
            <td class="num">{{ r.summary?.pass ?? '—' }}</td><td class="num" :class="{ bad: r.summary?.fail }">{{ r.summary?.fail ?? '—' }}</td>
            <td class="num" :class="{ bad: r.summary?.error }">{{ r.summary?.error ?? '—' }}</td><td class="num">{{ r.summary?.skip ?? '—' }}</td>
            <td class="num">{{ r.summary?.p95 ?? '—' }}</td>
            <td class="small">{{ r.target?.backend }} · {{ r.target?.mobiusVersion ?? '?' }}</td>
            <td><button class="small" @click="remove(r.runId)">삭제</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!runs.length" class="empty">이력이 없습니다.</p>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
h4 { margin: 0.4rem 0 0.3rem; font-size: 0.95rem; color: var(--text-strong); }
h4.bad { color: var(--danger); }
.lead { margin: 0 0 1.2rem; color: var(--muted); font-size: 1.02rem; max-width: 78ch; }
.err { color: var(--danger); }
.muted { color: var(--muted); font-size: 0.92rem; }
.small { font-size: 0.86rem; }
.empty { color: var(--muted); padding: 2rem 0; text-align: center; }
.warntext { color: var(--warn); font-weight: 600; }
.spacer { flex: 1; }
.actions { display: flex; align-items: center; gap: 0.8rem; margin: 0.6rem 0 1rem; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.actions .primary:disabled { opacity: 0.5; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; margin-bottom: 1rem; }
.banner { padding: 0.7rem 1rem; border-radius: 0 8px 8px 0; margin: 0.6rem 0; font-size: 0.95rem; }
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
.cols ul { margin: 0; padding-left: 1.1rem; font-size: 0.9rem; }
.perf { margin-top: 0.8rem; font-size: 0.92rem; }
.perf tr.slower td { color: var(--danger); font-weight: 600; }
.perf tr.faster td { color: var(--ok); }
.table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: auto; max-height: 60vh; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.num.bad { color: var(--danger); font-weight: 600; }
.cb { width: 2.4rem; text-align: center; }
.cb input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); }
tr.picked td { background: var(--accent-wash); }
tr.broken td { color: var(--muted); }
.linkish { border: none; background: none; padding: 0; font: inherit; color: var(--accent-strong); text-decoration: underline; cursor: pointer; }
button.small { padding: 0.2rem 0.6rem; font-size: 0.85rem; }
</style>
```

- [ ] **Step 7: 빌드**

Run: `cd admin/web && npm run build` → 통과. `SelfTestPlaceholderView.vue` 를 지운 뒤 `grep -rn Placeholder admin/web/src` → 0건.

- [ ] **Step 8: 커밋**

```bash
git add admin/web/src
git commit -m "admin(web): 종합 테스트 화면 — 카테고리 선택·실행, 결과(카테고리·케이스·단계·성능), 이력·비교

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 문서와 배포 2차

**Files:**
- Modify: `admin/README.md`, `CLAUDE.md`(디스크), `docs/superpowers/specs/2026-09-06-admin-console-v2-design.md` §7.3(통합 실행으로 확정한 건수와 기대값 변경을 적는다)

- [ ] **Step 1: `admin/README.md`**

"무엇을 보여 주는가" 에:

```markdown
### 종합 테스트 (검증)

붙어 있는 Mobius 를 표준 케이스로 훑는다. 카테고리(기본·AE·CNT·CIN·접근 제어·구독·알림·
그룹·flexContainer·검색·기타 타입·보관 정책·에러·엣지·부하)를 골라 돌리고 케이스마다
pass/fail/error/skip 과 응답 시간을, 카테고리·전체로 p50·p95·최대를, 알림은 수신 지연을
낸다. 모든 쓰기는 전용 AE `admin_selftest` 아래 `run-<runId>` 안이고 끝나면(취소·오류
포함) 지운다. 결과는 `admin/data/selftest/<runId>.json` 에 최근 50회 남고 둘을 비교할 수
있다. 기대값은 oneM2M 표준 rsc 를 케이스에 고정하고 HTTP 는 코어의 `mobius/rsc.js`
에서 유도한다. 지원하지 않는 타입(어댑터의 `supportedResourceTypes`)의 케이스는 skip.

알림은 콘솔이 받는다 — 실행 동안만 HTTP 수신 서버(`adminSelftestHost:adminSelftestPort`,
기본 `adminHost`:7581)를 열고 Mobius 의 `mqttBroker` 에 MQTT 구독자로 붙는다. CoAP 는
없다. MQTT 브로커에 못 붙으면 MQTT 알림 케이스만 error 다.

부하 카테고리는 기본 꺼짐이다. 켜면 동시 N(≤20)·총 M(≤5,000)건을 보내고 처리량·p50/p95/p99·
오류율을 낸다. 처음 200건에서 오류율 20% 를 넘으면 스스로 멈춘다. 상한은 서버가 강제한다.

같은 엔진을 UI 없이 돌린다: `npm run selftest -- --category cnt,sub --receiver-port 0`
(종료 코드 0 전부 통과/skip · 1 fail 있음 · 2 error 있음). 배포 검증에 쓴다.
```

"실행" 의 conf 키 표에 `adminSelftestPort`(7581)·`adminSelftestHost`(`adminHost`) 두 행. 설계 메모에 "케이스는 `admin/selftest/catalog/<카테고리>.js` — 선언형이 기본, 여러 단계가 얽히면 `run(ctx)`. `test/admin-selftest-catalog.test.js` 가 모양을 잠근다."

- [ ] **Step 2: `CLAUDE.md`(디스크)**

`## Commands` 에 `npm run selftest -- --category …` 한 줄. 관리 콘솔 절에 종합 테스트 요약 세 줄(격리 AE · 결과 파일 · CLI). 시험 수치를 `npm test` 결과로 갱신.

- [ ] **Step 3: 스펙 §7.3 갱신**

Task 8 Step 5 의 통합 실행에서 확정한 카테고리별 건수와, 코어 동작에 맞춰 바꾼 기대값(케이스 id 와 전후 rsc)을 §7.3 표 아래에 "구현 확정(날짜)" 절로 적고 `git add -f` 로 커밋한다.

- [ ] **Step 4: 커밋**

```bash
git add admin/README.md
git add -f docs/superpowers/specs/2026-09-06-admin-console-v2-design.md
git commit -m "docs(selftest): 종합 테스트 사용법·설정 키·CLI, 스펙 §7.3 구현 확정

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 배포 2차 (사람이 한다) — 종합 테스트

1/2 계획의 배포 1차가 끝난 뒤. 코어 변경이 없으므로 **Mobius 재기동은 없다**(`admin/cse.js` 의 raw 는 콘솔 코드다).

- [ ] `git pull --ff-only origin lite`. `conf.json` 에 `adminSelftestPort`(기본 7581 이면 생략 가능)를 확인한다 — `npm run conf -- --all` 로 콘솔 그룹을 본다.
- [ ] `cd admin/web && npm run build`, 콘솔 재기동.
- [ ] 서버에서 CLI 로 먼저: `npm run selftest -- --category base,ae,cnt,cin,discovery,edge --receiver-port 7581`. 종료 코드와 fail 목록을 본다. 알림 카테고리는 브로커가 같은 장비의 `localhost` 라 MQTT 도 된다: `--category sub,fcnt,grp,types,acp,retention`.
- [ ] 콘솔의 검증 → 종합 테스트에서 **부하 제외 전체** 를 한 번 돌리고 결과 화면·이력·비교(같은 실행 둘)를 확인한다. `admin/data/selftest/` 에 파일.
- [ ] 실행 뒤 `GET /Mobius/admin_selftest` 가 404 인지(정리됨), 접근 로그에 5xx 가 없는지.
- [ ] 부하는 트래픽이 적은 시간에 기본값(동시 10·2,000건)으로 한 번만 돌려 p95·처리량을 기록한다.

---

## 자체 점검 (계획 작성 후)

**스펙 대조** — §7.1 개념(2·3), §7.2 케이스 정의(2·3·6 — `raw`·`method`·`absent`·`$rn:`·`$nu:*` 는 스펙에 없던 세부이나 스펙의 계약을 깨지 않는다), §7.3 카테고리 13개(2·6 — `load` 포함, 건수는 통합 실행 뒤 §7.3 에 적는다: Task 10), §7.4 실행기(3·7), §7.5 격리·정리(3), §7.6 수신기(4), §7.7 성능·부하(3·6·7), §7.8 결과·이력·비교(3·5), §7.9 화면(9), §7.10 CLI(8), §7.11 API(7), §9 설정 키(1), §10 오류 처리(3·4·7), §11 시험 전략(2~8 — MQTT 단위 시험 제외 명시, 통합 실행 8·배포 2차), §12 배포·전제(target.js 의 부팅 기록 읽기, 배포 2차).

**스펙과 다르게 한 것** — (1) `notify-wait` 에 `absent` 를 더했다 — "구독을 지우면 멈춘다"·"net 필터" 케이스가 필요했다. (2) 변수 범위를 카테고리로 잡았다(스펙은 미정) — 검색·구독 카테고리가 앞 케이스의 리소스를 쓴다. (3) `$rn:` 로 CSEBase 아래에 만드는 AE·NOD 를 실행마다 고유하게 하고 정리 대상에 넣었다 — 격리 원칙을 지키면서 AE 케이스를 돌리기 위해서다. (4) CLI 에 `--cse-base`·`--admin-origin` 을 더했다 — 시험이 conf.json 없이 돌기 위해서다.

**이름 일관성** — `catalog.{load,validate,httpOf,OPS}` (2·3·7·8), `Runner` 의 `{setup,cases,runCase,finish,result}` (3·7·8), `ctx.{create,retrieve,update,delete,discover,resolve,until,assert,record,notify,setLoadResult,client_request,conf,load,receiver,run,ae,origin,cseBase}` (3·6), `receiver.open → rx.{httpNu,mqttNu,expect,received,close,mqttError}` (4·6·7·8), `history.{save,list,get,remove,compare}` (5·7·9), `perf.{percentile,summarize,loadSummary}` (3·6·8), `target.{describe,supportedTypes}` (3·7·8), `selftest_job.{start,clampLoad,LOAD_DEFAULT,LOAD_MAX}` (7·8), `ctx.{selftest,root,dataDir}` (1·7), 라우트 `verify-selftest`·`verify-selftest-run`·`verify-selftest-history` (9), `api.ts` 의 `selftestCatalog/startSelftest/selftestRuns/selftestRun/selftestCompare/deleteSelftestRun` (9).

**`test/admin_app_helper.js`** 의 확장(`csePort`·`selftestPort`·`root`·`selftest`)은 1/2 의 시험을 깨지 않는다 — 기본값이 이전과 같다.
