# 관리 콘솔 2판 골격 — 구현 계획 (1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리 콘솔을 "판단 + 검증" 도구의 골격으로 재편한다 — Vue Router 셸, 코어 정책 위반 4건 수정, ACP 신규 생성·`acpi` 연결, 구독 엔드포인트 롤업, 통계·작업 관측, 그리고 그것을 받치는 코어의 작은 읽기 전용 변경과 `/hit`·`/total_*` 공개 경로 제거.

**Architecture:** 백엔드 골격(`admin/server.js`·`cse.js`·`jobs.js`)은 유지하되 라우트를 `admin/api.js` 의 `install(app, ctx)` 로 갈라 시험이 같은 라우트를 임시 DB·가짜 CSE 로 띄울 수 있게 한다. 코어 정책은 함수(`mobius/expiry_policy.js`, `mobius/db.supportedResourceTypes()`)로 묻고 화면은 상수를 갖지 않는다. 프런트는 Vue 3 + Vite 그대로에 `vue-router`(hash 모드)만 더한다. 종합 테스트는 **2/2 계획**(`2026-09-06-admin-selftest.md`)이 이 골격 위에 얹는다.

**Tech Stack:** Node.js(내장 모듈 + 기존 `express`·`moment`), Vue 3 + TypeScript + Vite, `vue-router` 4 (유일한 새 의존성, `admin/web` 에만), Node 내장 test runner.

**Spec:** `docs/superpowers/specs/2026-09-06-admin-console-v2-design.md` (§1~§6, §8, §10~§12). §7·§9 는 2/2 계획.

## Global Constraints

스펙에서 그대로 옮긴 것이다. 모든 과제의 요구사항에 암묵적으로 포함된다.

- **읽기는 DB 파사드(`mobius/db`) 직접, 쓰기는 반드시 CSE oneM2M HTTP(`admin/cse.js`) 경유.** 콘솔이 DB 에 쓰는 코드는 없다.
- **코어 정책을 화면이 상수로 베끼지 않는다.** 만료 정책·지원 타입·결과 코드는 코어 함수에서 받는다. `types.ts` 의 `AUTO_DELETED_RISKY`·`ET_EXTENDABLE`·`NEVER_AUTO_DELETED` 는 이 계획에서 사라진다.
- **전역 `COUNT(*)`·`acpi like` 금지. 상한 있는 카운트 + 키셋 페이징. 잘렸으면 `capped`/`more` 로 말한다.**
- **고아 탐지는 화면에서 라이브로 돌리지 않는다.** 작업(`jobs.js`)으로 돌리고 결과 파일을 보여 준다.
- **관리자 1명·공유 비밀번호·메모리 세션** 그대로.
- **새 백엔드 의존성 없음.** 프런트는 `vue-router` 하나만. 차트는 인라인 SVG.
- **코어 변경은 §8 의 다섯 가지뿐**: `mobius/attr_lists.js`(속성 목록 분리) + `mobius/expiry_policy.js`, `sql_action` 의 읽기 전용 질의 셋, `app.js` 의 `extra_api_action` 제거, `admin/cse.js` 의 `elapsedMs`·헤더 덮어쓰기·`create`. 코어의 응답 경로는 건드리지 않는다 — 응답 골든 29건은 전후 동일해야 한다.
- **시험 대역은 실물보다 관대하면 안 된다.** 가짜 CSE 는 헤더(`X-M2M-RI`·`X-M2M-Origin`·`X-M2M-RVI`)와 `Content-Type;ty=` 를 검사하고 없으면 400 을 낸다. 어댑터 대역은 SQL 과 bindings 를 기록한다.
- **`npm test` 는 Mobius 를 띄우지 않는다.** 콘솔 라우트 시험은 express 앱을 임시 포트에 띄우고 어댑터 대역·가짜 CSE 를 쓴다.
- **`test/conf-schema.test.js` 의 양방향 대조**: 콘솔 conf 키는 `admin/server.js` 가 `conf.<키>` 로 읽어야 리더로 잡힌다. `api.js` 는 `ctx` 로 받는다.
- **`admin/web` 빌드는 `vue-tsc --noEmit && vite build` 가 통과해야 한다.** 프런트 과제의 검증은 이것이다(컴포넌트 시험은 두지 않는다).
- 주석·문서·커밋 메시지는 한국어. 백엔드는 `var`·세미콜론·근거를 적는 긴 주석, 프런트는 기존 `.vue` 의 TS 스타일을 따른다.
- 커밋 메시지 말미: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `docs/` 는 gitignore 되어 있으나 스펙·계획은 추적한다 — 문서를 커밋할 때는 `git add -f`. `CLAUDE.md` 는 gitignore 라 디스크만 고치고 커밋하지 않는다.
- `admin/data/` 는 gitignore 에 추가한다(결과 파일 자리).

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `mobius/attr_lists.js` | **신설** (1) | 리소스 타입별 속성 목록 다섯 개(`create_m/create_opt/update_np/update_m/update_opt`). `resource.js` 에서 그대로 옮겨 오고 전역도 그대로 세운다 — 부수 효과 없이 require 할 수 있는 자리 |
| `mobius/resource.js` | 수정 (1) | 목록 정의를 지우고 `require('./attr_lists')` 한 줄 |
| `mobius/expiry_policy.js` | **신설** (1) | `etExtendableTypes()`·`autoDeletedTypes()` — 만료 정책의 단일 진실원 |
| `mobius/sql_action.js` | 수정 (2) | `select_sub_endpoint_rollup`·`select_subs_by_endpoint`·`select_lookup_only_cin_page` — 읽기 전용 |
| `app.js` | 수정 (3) | `extra_api_action` 과 `/hit`·`/total_ae`·`/total_cbs` 제거 |
| `admin/cse.js` | 수정 (4) | `elapsedMs`, `opts.headers` 덮어쓰기, `create()` |
| `admin/api.js` | **신설** (5) | 모든 `/api/*` 라우트. `install(app, ctx)` |
| `admin/server.js` | 수정 (5, 6) | conf 읽기·전역·`ctx` 조립·정적 서빙·기동만 남는다 |
| `admin/data_dir.js` | **신설** (9) | `admin/data/<하위>/` 경로와 원자적 JSON 쓰기·목록·보관 개수 |
| `admin/orphan_scan.js` | **신설** (9) | 고아 탐지 작업(조각·상한·표본·결과 파일) |
| `test/admin_app_helper.js` | **신설** (5) | 라우트 시험용 부팅 헬퍼(어댑터 대역·가짜 CSE·세션 쿠키) |
| `admin/web/src/router.ts` | **신설** (10) | 라우트 표(네 묶음) |
| `admin/web/src/App.vue` | 수정 (10) | 셸: 왼쪽 묶음 내비 + 상단 배지 + `<RouterView>` |
| `admin/web/src/views/JobsView.vue` · `StatsView.vue` | **신설** (10) | 관측 |
| `admin/web/src/components/BarChart.vue` | **신설** (10) | 인라인 SVG 막대 |
| `admin/web/src/views/ExpiredView.vue` · `AcpProblemsView.vue` · `AcpSimulateView.vue` | 수정 (11) | 위반 수정 |
| `admin/web/src/views/OrphanView.vue` | 수정 (12) | 작업 기반으로 |
| `admin/web/src/views/AcpCreateView.vue` · `AcpAttachView.vue` · `AcpListView.vue` | 신설·수정 (13) | 신규 생성·연결 |
| `admin/web/src/views/SubsView.vue` | **신설** (14) | 엔드포인트 롤업 |
| `admin/web/src/api.ts` · `types.ts` | 수정 (10~14) | 새 라우트·타입, 정책 상수 삭제 |
| `admin/README.md` · `CLAUDE.md` · 계획의 배포 절 | 수정 (15) | 문서 |

**과제 순서**: 1→2→3→4→5 (백엔드 토대) → 6→7→8→9 (라우트) → 10→11→12→13→14 (프런트) → 15 (문서·배포). 5 가 끝나야 6~9 의 시험이 성립하고, 10 이 끝나야 11~14 의 화면이 라우터에 걸린다.

---

## 시험용 가짜 CSE 와 어댑터 대역 (Task 5 가 만든다, 6~9·2/2 계획이 쓴다)

`test/admin_app_helper.js` 의 계약. Task 5 에 전체 코드가 있다.

```js
const h = await boot({
    conf: { adminPassword: 'pw', acpDiscoveryFilter: 'off' },   // server.js 가 읽는 값과 같은 이름
    execute: function (sql, bindings) { return []; },           // 어댑터 대역: SELECT 결과 행 배열, 그 외 { affectedRows }
    cse: { status: 201, rsc: '2001', body: { 'm2m:acp': { ri: '/M/a/acp1' } } } // 가짜 CSE 의 기본 응답
});
await h.login();                                    // 세션 쿠키를 잡는다
const r = await h.request('GET', '/api/session');  // { status, body }
h.cse.calls   // 가짜 CSE 가 받은 요청 [{ method, path, headers, body }]
h.calls       // 어댑터 대역이 받은 [{ sql, bindings }]
await h.close();
```

가짜 CSE 는 **관대하지 않다**: `X-M2M-RI`·`X-M2M-Origin` 이 없으면 400, 본문이 있는데 `Content-Type` 에 `ty=` 가 없으면(POST) 400 을 내고 `calls` 에 `rejected: true` 로 남긴다.

---

### Task 1: `mobius/attr_lists.js` 분리 + `mobius/expiry_policy.js`

**Files:**
- Create: `mobius/attr_lists.js`, `mobius/expiry_policy.js`
- Modify: `mobius/resource.js:113-256` (목록 정의 → `require('./attr_lists')`)
- Test: `test/expiry-policy.test.js`

**Interfaces:**
- Produces: `require('./attr_lists')` → `{ create_m_attr_list, create_opt_attr_list, update_np_attr_list, update_m_attr_list, update_opt_attr_list }` (전역도 같은 이름으로 세운다 — 코어의 다른 파일이 전역으로 읽는다).
- Produces: `expiry_policy.etExtendableTypes()` → `number[]` 오름차순 (예: `[1, 2, 3, 9, 10, 14, 16, 23, 24, 27, 28]`), `expiry_policy.autoDeletedTypes()` → `number[]` (지금은 `[]`).

- [ ] **Step 1: 실패하는 시험**

`test/expiry-policy.test.js`:

```js
'use strict';
// 만료 정책의 단일 진실원. 관리 콘솔이 "et 를 늘릴 수 있는 타입" 과 "만료되면
// 자동으로 지워지는 타입" 을 화면 상수로 들고 있다가 코어와 어긋났다(2026-09-01
// 목적 문서 §0층). 그 두 값을 코어 함수에서 받게 하고, 이 시험이 그 함수를 코어의
// 속성 목록·app.js 와 대조한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const policy = require(path.join(ROOT, 'mobius', 'expiry_policy'));
const attr = require(path.join(ROOT, 'mobius', 'attr_lists'));
const shape = require(path.join(ROOT, 'mobius', 'shape'));

function code_of(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

test('attr_lists 는 부수 효과 없이 require 되고 전역을 세운다', function () {
    // resource.js 는 sgn·responder 를 끌고 오므로 콘솔이 require 하면 안 된다.
    // 목록만 따로 둔 이유다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'attr_lists.js'), 'utf8');
    assert.ok(!/require\(/.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')),
        'attr_lists.js 가 무언가를 require 한다 — 목록만 있어야 한다');
    assert.deepStrictEqual(global.update_opt_attr_list.cnt, attr.update_opt_attr_list.cnt);
    assert.ok(attr.update_opt_attr_list.cnt.indexOf('et') >= 0);
    assert.ok(attr.create_m_attr_list.grp.indexOf('mid') >= 0);
});

test('resource.js 는 목록을 정의하지 않고 attr_lists 를 require 한다', function () {
    const code = code_of('mobius/resource.js');
    assert.ok(/require\('\.\/attr_lists'\)/.test(code), 'resource.js 가 attr_lists 를 안 읽는다');
    assert.ok(!/global\.create_m_attr_list\s*=/.test(code), '목록 정의가 resource.js 에 남아 있다');
    assert.ok(!/update_opt_attr_list\.cnt\s*=/.test(code), '목록 정의가 resource.js 에 남아 있다');
});

test('etExtendableTypes 는 update 목록에 et 가 있는 타입이다 — 이름을 ty 로 접는다', function () {
    const got = policy.etExtendableTypes();
    // 속성 목록에서 직접 다시 계산해 대조한다. 함수가 상수를 들고 있으면 여기서 갈린다.
    const expect = [];
    Object.keys(attr.update_opt_attr_list).forEach((name) => {
        if (attr.update_opt_attr_list[name].indexOf('et') < 0) { return; }
        let ty = null;
        Object.keys(shape.typeRsrc).forEach((k) => { if (shape.typeRsrc[k] === name) { ty = Number(k); } });
        if (ty === null) { return; }               // fwr/bat/… 은 mgo 하위라 ty 가 없다
        if (ty >= 91 && ty <= 98) { ty = 28; }     // hd_* 는 fcnt 의 별칭
        if (expect.indexOf(ty) < 0) { expect.push(ty); }
    });
    expect.sort((a, b) => a - b);
    assert.deepStrictEqual(got, expect);
    // 알려진 사실 몇 개는 이름으로도 못박는다 — 목록이 통째로 비면 위 대조도 빈 것끼리 같다.
    assert.ok(got.indexOf(2) >= 0 && got.indexOf(3) >= 0, 'AE·CNT 는 et 를 늘릴 수 있다');
    assert.ok(got.indexOf(4) < 0, 'CIN 은 oneM2M 상 UPDATE 가 안 된다');
    assert.ok(got.indexOf(5) < 0, 'CSEBase 는 수정할 수 없다');
    assert.ok(got.indexOf(13) < 0, 'mgo 는 갱신 목록에 없다');
    assert.ok(got.indexOf(28) >= 0, 'fcnt 는 et 를 늘릴 수 있다 — 예전 화면 상수가 이것을 막고 있었다');
});

test('autoDeletedTypes 는 app.js 의 만료 스윕과 같다 — 지금은 스윕이 없다', function () {
    assert.deepStrictEqual(policy.autoDeletedTypes(), []);
    // 스윕이 되살아나면 이 단정이 먼저 깨져야 한다. 주석은 제외하고 본다.
    const code = code_of('app.js');
    assert.ok(!/del_expired_resource\(/.test(code), 'app.js 가 del_expired_resource 를 부른다 — autoDeletedTypes 를 그 타입으로 바꿀 것');
    assert.ok(!/select_expired_resources\(/.test(code), 'app.js 가 만료 스윕을 돌린다 — autoDeletedTypes 를 맞출 것');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/expiry-policy.test.js`
Expected: FAIL — `Cannot find module '.../mobius/expiry_policy'`

- [ ] **Step 3: `mobius/attr_lists.js` 를 만든다 — `resource.js:113-256` 을 그대로 옮긴다**

`mobius/resource.js` 에서 `global.create_m_attr_list = {};`(113행)부터 `update_opt_attr_list['hd_brigs'] = ['acpi', 'et', 'lbl', 'brigs'];`(256행)까지를 **잘라내어** 아래 파일의 표시된 자리에 붙인다. 내용은 한 글자도 바꾸지 않는다(주석 포함).

```js
'use strict';
/**
 * 리소스 타입별 속성 목록 — resource.js 에서 옮겨 왔다(2026-09-06).
 *
 * 왜 따로 두는가: 관리 콘솔이 "et 를 수정할 수 있는 타입" 을 화면 상수로 들고
 * 있다가 코어와 어긋났다. 코어에서 받으려면 이 목록을 읽어야 하는데,
 * resource.js 는 sgn·responder·타입 핸들러를 통째로 끌고 오는 파일이라 콘솔이
 * require 할 수 없었다. 목록은 순수 데이터다 — 여기 두면 어디서든 읽는다.
 *
 * 전역(create_m_attr_list 등)은 그대로 세운다. resource.js 와 타입 핸들러가
 * 전역 이름으로 읽는다. 옮기면서 그 계약은 건드리지 않았다.
 */

// ── 여기부터 resource.js 113~256 행을 그대로 ──────────────────────────
// (global.create_m_attr_list = {}; … update_opt_attr_list['hd_brigs'] = [...];)
// ── 여기까지 ─────────────────────────────────────────────────────────

exports.create_m_attr_list = global.create_m_attr_list;
exports.create_opt_attr_list = global.create_opt_attr_list;
exports.update_np_attr_list = global.update_np_attr_list;
exports.update_m_attr_list = global.update_m_attr_list;
exports.update_opt_attr_list = global.update_opt_attr_list;
```

`mobius/resource.js` 의 잘라낸 자리에는 이 두 줄을 넣는다:

```js
// 타입별 속성 목록은 mobius/attr_lists.js 에 있다 — 전역을 거기서 세운다.
require('./attr_lists');
```

- [ ] **Step 4: `mobius/expiry_policy.js`**

```js
'use strict';
/**
 * 만료(et) 정책의 단일 진실원.
 *
 * 관리 콘솔의 만료 화면이 "et 를 늘릴 수 있는 타입" 과 "만료되면 자동으로 지워지는
 * 타입" 을 화면 상수로 들고 있었다. 둘 다 코어와 어긋나 있었다 — ACP 만 자동
 * 삭제된다고 표시했는데 실제로는 지금 아무것도 자동 삭제되지 않고, 코어가 et 를
 * 받아 주는 NOD·CSR·LCP·FCNT·SMD·MMS 를 화면이 막고 있었다(2026-09-01 목적 문서 §0층).
 *
 * 화면은 이 두 함수의 결과만 본다. test/expiry-policy.test.js 가 속성 목록·app.js 와 대조한다.
 */
var attr = require('./attr_lists');
var shape = require('./shape');

/** 리소스 이름 → ty. shape.typeRsrc 의 역방향. 없으면 null (fwr/bat/… 은 mgo 의 하위 이름이다). */
function ty_of(name) {
    var keys = Object.keys(shape.typeRsrc);
    for (var i = 0; i < keys.length; i++) {
        if (shape.typeRsrc[keys[i]] === name) { return Number(keys[i]); }
    }
    return null;
}

/**
 * UPDATE 에서 et 를 받는 타입. resource.js 의 update_opt_attr_list 에서 계산한다.
 * hd_*(91~98) 는 fcnt(28) 의 별칭이라 28 로 접는다.
 */
exports.etExtendableTypes = function () {
    var out = [];
    Object.keys(attr.update_opt_attr_list).forEach(function (name) {
        if (attr.update_opt_attr_list[name].indexOf('et') < 0) { return; }
        var ty = ty_of(name);
        if (ty === null) { return; }
        if (ty >= 91 && ty <= 98) { ty = 28; }
        if (out.indexOf(ty) < 0) { out.push(ty); }
    });
    return out.sort(function (a, b) { return a - b; });
};

/**
 * 만료 스윕이 지우는 타입. **지금은 없다** — app.js 가 del_expired_resource 를
 * 주기 실행하던 것을 뺐다(app.js 상단 "예전에는 del_expired_resource 를 24시간마다"
 * 주석). 스윕을 되살리면 여기서 그 타입 목록을 돌려주고, 시험이 app.js 와 대조한다.
 */
exports.autoDeletedTypes = function () {
    return [];
};
```

- [ ] **Step 5: 시험 통과 확인과 전체 시험**

Run: `node --test test/expiry-policy.test.js` → PASS (4/4)
Run: `npm test` → 전부 통과. `resource.js` 의 전역 계약이 깨졌다면 리소스 관련 시험이 먼저 잡는다.

- [ ] **Step 6: 커밋**

```bash
git add mobius/attr_lists.js mobius/expiry_policy.js mobius/resource.js test/expiry-policy.test.js
git commit -m "core(expiry_policy): 만료 정책의 단일 진실원 — 속성 목록을 attr_lists.js 로 갈라 콘솔이 읽는다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `sql_action` 읽기 전용 질의 셋 — 구독 롤업·엔드포인트별 표본·lookup 에만 남은 CIN

**Files:**
- Modify: `mobius/sql_action.js` (`audit_subscriptions` 바로 위에 추가)
- Test: `test/sub-endpoint-rollup.test.js`

**Interfaces:**
- Produces: `select_sub_endpoint_rollup(connection, { scanCap=20000, limit=100, after='', severityOf=null }, cb)` → `cb(null, { endpoints: [{ endpoint, total, broken, suspect, sample: string[] }], endpointsTruncated, scanned, capped, next })`. `severityOf(ri)` 는 `'broken'|'suspect'|null` 을 돌려주는 함수(선택) — 라우트가 `audit_subscriptions` 결과로 만든다.
- Produces: `select_subs_by_endpoint(connection, { endpoint, limit=200, scanCap=20000 }, cb)` → `cb(null, { rows: [{ ri, pi, nu: string[], enc, cr }], more, scanned, capped })`.
- Produces: `select_lookup_only_cin_page(connection, { afterRi='', limit=50, scanCap=200000 }, cb)` → `cb(null, { rows: [{ ri, pi, rn, ct }], more, nextRi, scanned, scanCapped })` — `lookup.ty=4` 인데 `cin` 에 행이 없는 것(인수인계 §6).
- 엔드포인트 문자열: `scheme://host[:port]`(`URL` 로 해석). URL 이 아닌 nu(ID 형)는 `'(ID 형)'`.

- [ ] **Step 1: 실패하는 시험**

`test/sub-endpoint-rollup.test.js`:

```js
'use strict';
// 구독을 nu 의 엔드포인트로 묶어 센다. 배포는 구독 3,463건에 고유 nu 202개, 상위
// 3개가 57% 다 — 목록을 그대로 화면에 올리면 못 읽는다(백로그 §3-1). 전역 스캔이
// 아니라 ri 키셋 배치 + 상한이고, 판정(broken/suspect)은 코어의 audit 결과를
// 라우트가 severityOf 로 넘겨 준다 — 콘솔이 자기 기준을 만들지 않는다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-sub-rollup-test.db');
global.NOPRINT = 'true';
global.usecsebase = 'Mobius'; global.usecseid = '/Mobius2'; global.usespid = '//keti.re.kr';

// 심어 둔 SELECT 결과를 순서대로 돌려주는 어댑터 대역. sql 과 bindings 를 기록한다.
function tap(pages) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    let i = 0;
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        const rows = (pages && pages[i] !== undefined) ? pages[i] : [];
        i++;
        cb(null, rows);
    };
    db.connect(function () {});
    return { sa: require(path.join(__dirname, '..', 'mobius', 'sql_action.js')), seen: seen };
}

const sub = (ri, nus) => ({ ri: ri, pi: '/Mobius/ae', nu: JSON.stringify(nus), enc: '{}', cr: 'Cae' });

test('엔드포인트로 묶고 건수 순으로 낸다 — 판정은 severityOf 가 준다', function (t, done) {
    const { sa, seen } = tap([[
        sub('/Mobius/ae/s1', ['mqtt://broker.example/A?ct=json']),
        sub('/Mobius/ae/s2', ['mqtt://broker.example/B?ct=json']),
        sub('/Mobius/ae/s3', ['http://10.0.0.5:8080/noti']),
        sub('/Mobius/ae/s4', ['/Mobius/ae/other']),               // ID 형
        sub('/Mobius/ae/s5', ['mqtt://broker.example/C', 'http://10.0.0.5:8080/noti'])  // nu 둘
    ]]);
    const sev = { '/Mobius/ae/s2': 'suspect', '/Mobius/ae/s3': 'broken' };
    sa.select_sub_endpoint_rollup(null, { severityOf: (ri) => sev[ri] || null }, function (err, r) {
        assert.ifError(err);
        assert.deepStrictEqual(r.endpoints.map((e) => e.endpoint),
            ['mqtt://broker.example', 'http://10.0.0.5:8080', '(ID 형)']);
        const m = r.endpoints[0];
        assert.strictEqual(m.total, 3);
        assert.strictEqual(m.suspect, 1);
        assert.strictEqual(m.broken, 0);
        assert.deepStrictEqual(m.sample, ['/Mobius/ae/s1', '/Mobius/ae/s2', '/Mobius/ae/s5']);
        assert.strictEqual(r.endpoints[1].broken, 1);
        assert.strictEqual(r.scanned, 5);
        assert.strictEqual(r.capped, false);
        assert.strictEqual(r.next, null);
        // 키셋 배치: ri 로 정렬하고 상한 안에서만 읽는다. 전역 count 가 아니다.
        assert.match(seen[0].sql, /from `sub`/);
        assert.match(seen[0].sql, /order by `ri` asc/);
        assert.match(seen[0].sql, /limit/);
        assert.ok(!/count\(\*\)/i.test(seen[0].sql));
        done();
    });
});

test('상한에 닿으면 capped 와 next 를 준다 — 조용히 자르지 않는다', function (t, done) {
    const page = [];
    for (let i = 0; i < 500; i++) { page.push(sub('/M/s' + String(i).padStart(4, '0'), ['http://h/n'])); }
    const { sa } = tap([page, page.map((r) => ({ ...r, ri: r.ri + 'b' }))]);
    sa.select_sub_endpoint_rollup(null, { scanCap: 600 }, function (err, r) {
        assert.ifError(err);
        assert.strictEqual(r.capped, true);
        assert.strictEqual(r.scanned, 1000);
        assert.strictEqual(typeof r.next, 'string');
        done();
    });
});

test('select_subs_by_endpoint 는 그 엔드포인트의 구독만 돌려준다', function (t, done) {
    const { sa } = tap([[
        sub('/M/s1', ['mqtt://broker.example/A']),
        sub('/M/s2', ['http://h/n']),
        sub('/M/s3', ['mqtt://broker.example/B'])
    ]]);
    sa.select_subs_by_endpoint(null, { endpoint: 'mqtt://broker.example', limit: 10 }, function (err, r) {
        assert.ifError(err);
        assert.deepStrictEqual(r.rows.map((x) => x.ri), ['/M/s1', '/M/s3']);
        assert.deepStrictEqual(r.rows[0].nu, ['mqtt://broker.example/A']);
        assert.strictEqual(r.more, false);
        done();
    });
});

test('select_lookup_only_cin_page 는 cin 에 짝이 없는 lookup ty=4 행만 돌려준다', function (t, done) {
    // 1쪽: lookup 의 ty=4 행 3개, 2쪽: cin 에 있는 ri (whereIn 로 확인)
    const { sa, seen } = tap([
        [{ ri: '/M/c/4-1', pi: '/M/c', rn: '4-1', ct: '20260901T000000' },
         { ri: '/M/c/4-2', pi: '/M/c', rn: '4-2', ct: '20260901T000000' },
         { ri: '/M/c/4-3', pi: '/M/c', rn: '4-3', ct: '20260901T000000' }],
        [{ ri: '/M/c/4-2' }]
    ]);
    sa.select_lookup_only_cin_page(null, { limit: 10, scanCap: 100 }, function (err, r) {
        assert.ifError(err);
        assert.deepStrictEqual(r.rows.map((x) => x.ri), ['/M/c/4-1', '/M/c/4-3']);
        assert.strictEqual(r.scanned, 3);
        assert.strictEqual(r.more, false);
        assert.match(seen[0].sql, /`ty` = \?/);
        assert.match(seen[1].sql, /from `cin`/);
        assert.match(seen[1].sql, /in \(/);
        done();
    });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/sub-endpoint-rollup.test.js`
Expected: FAIL — `sa.select_sub_endpoint_rollup is not a function`

- [ ] **Step 3: 구현 — `mobius/sql_action.js` 의 `/* ─── 구독 도달성 감사` 주석 블록 바로 앞에 넣는다**

```js
/* ─── 구독 엔드포인트 롤업 (관리 콘솔) ───────────────────────────────
 *
 * 구독을 nu 의 scheme://host[:port] 로 묶어 센다. 읽기만 한다.
 * 배포(2026-08-30 실측): 구독 3,463건, 고유 nu 202개, 상위 3개가 57%.
 * 목록을 그대로 보여 주면 못 읽으므로 묶음이 첫 화면이다.
 *
 * 전역 스캔이 아니다 — ri 키셋 배치로 전진하고 scanCap 에서 멈춘다.
 * 판정(broken/suspect)은 여기서 하지 않는다. audit_subscriptions 가 그 기준의
 * 단일 진실원이고, 호출자가 그 결과를 severityOf(ri) 로 넘긴다.
 */
var SUB_ROLLUP_BATCH = 500;

/** nu 하나 → 엔드포인트 문자열. URL 이 아니면(ID 형) '(ID 형)'. */
function sub_endpoint_of(nu) {
    try {
        var u = new URL(String(nu));
        return u.protocol + '//' + u.host;
    }
    catch (e) { return '(ID 형)'; }
}

exports.select_sub_endpoint_rollup = function (connection, opts, callback) {
    var o = opts || {};
    var cap = parseInt(o.scanCap, 10) || 20000;
    var limit = parseInt(o.limit, 10) || 100;
    var severityOf = (typeof o.severityOf === 'function') ? o.severityOf : function () { return null; };
    var groups = {};
    var scanned = 0;

    function finish(next, capped) {
        var list = Object.keys(groups).map(function (k) { return groups[k]; })
            .sort(function (a, b) { return b.total - a.total || (a.endpoint < b.endpoint ? -1 : 1); });
        callback(null, {
            endpoints: list.slice(0, limit),
            endpointsTruncated: list.length > limit,
            scanned: scanned,
            capped: !!capped,
            next: capped ? next : null
        });
    }

    function step(cursor) {
        facade.run(facade.k('sub').select('ri', 'nu').where('ri', '>', cursor)
                       .orderBy('ri', 'asc').limit(SUB_ROLLUP_BATCH),
            connection, function (err, rows) {
                if (err) { return callback(err, rows); }
                rows.forEach(function (r) {
                    scanned++;
                    var sev = severityOf(r.ri);
                    (parse_json_array(r.nu) || []).forEach(function (nu) {
                        var ep = sub_endpoint_of(nu);
                        var g = groups[ep] || (groups[ep] = { endpoint: ep, total: 0, broken: 0, suspect: 0, sample: [] });
                        g.total++;
                        if (sev === 'broken') { g.broken++; }
                        else if (sev === 'suspect') { g.suspect++; }
                        if (g.sample.length < 5 && g.sample.indexOf(r.ri) < 0) { g.sample.push(r.ri); }
                    });
                });
                var last = rows.length ? rows[rows.length - 1].ri : cursor;
                if (rows.length < SUB_ROLLUP_BATCH) { return finish(null, false); }
                if (scanned >= cap) { return finish(last, true); }
                step(last);
            });
    }
    step((o.after === undefined || o.after === null) ? '' : String(o.after));
};

/** 한 엔드포인트의 구독 표본. 같은 배치 스캔이고 상한 안에서 limit 까지 모은다. */
exports.select_subs_by_endpoint = function (connection, opts, callback) {
    var o = opts || {};
    var endpoint = String(o.endpoint || '');
    var limit = parseInt(o.limit, 10) || 200;
    var cap = parseInt(o.scanCap, 10) || 20000;
    var out = [];
    var scanned = 0;

    function step(cursor) {
        facade.run(facade.k('sub').select('ri', 'pi', 'nu', 'enc', 'cr').where('ri', '>', cursor)
                       .orderBy('ri', 'asc').limit(SUB_ROLLUP_BATCH),
            connection, function (err, rows) {
                if (err) { return callback(err, rows); }
                var more = false;
                for (var i = 0; i < rows.length; i++) {
                    scanned++;
                    var nus = parse_json_array(rows[i].nu) || [];
                    var hit = nus.some(function (nu) { return sub_endpoint_of(nu) === endpoint; });
                    if (!hit) { continue; }
                    if (out.length >= limit) { more = true; break; }
                    out.push({ ri: rows[i].ri, pi: rows[i].pi, nu: nus, enc: rows[i].enc, cr: rows[i].cr });
                }
                if (more) { return callback(null, { rows: out, more: true, scanned: scanned, capped: false }); }
                var last = rows.length ? rows[rows.length - 1].ri : cursor;
                if (rows.length < SUB_ROLLUP_BATCH) { return callback(null, { rows: out, more: false, scanned: scanned, capped: false }); }
                if (scanned >= cap) { return callback(null, { rows: out, more: true, scanned: scanned, capped: true }); }
                step(last);
            });
    }
    step('');
};

/* ─── lookup 에만 남은 CIN (인수인계 §6) ──────────────────────────────
 *
 * cin 테이블에는 없는데 lookup 에 ty=4 로 남은 행. 규모를 모른다(전수 카운트가
 * 배포에서 532초) — 그래서 세지 않고 표본만 뽑는다. 원인이 밝혀지지 않아 삭제는
 * 사람이 결정한다.
 *
 * select_orphan_page 와 같은 꼴이다: ri 키셋으로 전진하고 배치마다 cin 존재를
 * 리터럴 whereIn 으로 확인한다(조인은 콜레이션이 달라 인덱스를 못 탄다).
 */
exports.select_lookup_only_cin_page = function (connection, opts, callback) {
    var o = opts || {};
    var limit = o.limit > 0 ? o.limit : 50;
    var cap = o.scanCap > 0 ? o.scanCap : 200000;
    var BATCH = 1000;
    var out = [];
    var scanned = 0;

    function step(cursor) {
        facade.run(facade.k('lookup').select('ri', 'pi', 'rn', 'ct').where({ ty: '4' }).where('ri', '>', cursor)
                       .orderBy('ri', 'asc').limit(BATCH),
            connection, function (err, rows) {
                if (err) { return callback(err, rows); }
                if (rows.length === 0) { return callback(null, { rows: out, more: false, nextRi: null, scanned: scanned, scanCapped: false }); }
                scanned += rows.length;
                var ris = rows.map(function (r) { return r.ri; });
                facade.run(facade.k('cin').select('ri').whereIn('ri', ris), connection, function (err2, present) {
                    if (err2) { return callback(err2, present); }
                    var have = {};
                    (present || []).forEach(function (p) { have[p.ri] = true; });
                    var more = false;
                    for (var i = 0; i < rows.length; i++) {
                        if (have[rows[i].ri]) { continue; }
                        if (out.length >= limit) { more = true; break; }
                        out.push(rows[i]);
                    }
                    var last = rows[rows.length - 1].ri;
                    if (more) { return callback(null, { rows: out, more: true, nextRi: out[out.length - 1].ri, scanned: scanned, scanCapped: false }); }
                    if (rows.length < BATCH) { return callback(null, { rows: out, more: false, nextRi: null, scanned: scanned, scanCapped: false }); }
                    if (scanned >= cap) { return callback(null, { rows: out, more: true, nextRi: last, scanned: scanned, scanCapped: true }); }
                    step(last);
                });
            });
    }
    step((o.afterRi === undefined || o.afterRi === null) ? '' : String(o.afterRi));
};
```

`parse_json_array` 는 같은 파일의 감사 절에 이미 있다(함수 선언이라 앞에서 써도 된다). `URL` 은 Node 전역이다.

- [ ] **Step 4: 시험 통과와 전체 시험**

Run: `node --test test/sub-endpoint-rollup.test.js` → PASS (4/4)
Run: `npm test` → 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add mobius/sql_action.js test/sub-endpoint-rollup.test.js
git commit -m "sql(sub): 엔드포인트 롤업·엔드포인트별 표본·lookup 에만 남은 CIN 표본 — 읽기 전용, 키셋 + 상한

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `app.js` 의 `/hit`·`/total_ae`·`/total_cbs` 제거

**Files:**
- Modify: `app.js` (`function extra_api_action` 1876~1973행 삭제, `app.get('*')` 핸들러 2537~2591행 교체)
- Test: `test/no-extra-api.test.js`
- 확인: `test/converted-queries.test.js:14`, `test/settle-helper.test.js:140` 은 주석에서만 언급한다 — 고칠 것 없음. `settle.raw` 는 csr 포워딩(`app.js:1448`)이 계속 쓰므로 남긴다.

**Interfaces:**
- 없어지는 것: `GET /hit`, `GET /total_ae`, `GET /total_cbs` (일반 리소스 조회로 떨어져 404).
- 남는 것: `sql_action.get_hit_all`·`select_sum_ae`·`select_sum_cbs`(콘솔이 Task 6 에서 쓴다), `count_hit`/`set_hit`(hit 표는 계속 쓴다).

- [ ] **Step 1: 실패하는 시험**

`test/no-extra-api.test.js`:

```js
'use strict';
// /hit · /total_ae · /total_cbs 는 X-M2M 헤더 검사와 ACP 앞에서 200 을 내던 경로다.
// 외부에서 닿고(인수인계 §7 실측) 호출 건수·AE 수·CIN 바이트 총합을 인증 없이
// 내보냈다. 2026-09-06 에 관리 콘솔의 /api/stats/* 로 옮기고 코어에서 걷어냈다.
// 되살아나면 이 시험이 잡는다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('app.js 에 extra_api_action 이 없다', function () {
    assert.ok(!/extra_api_action/.test(code));
});

test("app.js 가 '/hit' · '/total_ae' · '/total_cbs' 를 URL 로 갈라 보지 않는다", function () {
    assert.ok(!/['"]\/hit['"]/.test(code));
    assert.ok(!/['"]\/total_ae['"]/.test(code));
    assert.ok(!/['"]\/total_cbs['"]/.test(code));
});

test('GET 라우트는 헤더 검사부터 시작한다 — 그 앞에 응답하는 갈래가 없다', function () {
    const at = code.indexOf("app.get('*'");
    assert.ok(at >= 0);
    const handler = code.slice(at, at + 1500);
    assert.match(handler, /with_connection\(request, response, \(settle\) => \{\s*check_xm2m_headers\(request/);
});

test('hit 집계 질의는 남아 있다 — 콘솔이 쓴다', function () {
    const sa = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');
    ['get_hit_all', 'select_sum_ae', 'select_sum_cbs'].forEach((fn) => {
        assert.ok(new RegExp('exports\\.' + fn + ' = function').test(sa), fn + ' 이 사라졌다');
    });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/no-extra-api.test.js`
Expected: FAIL — 첫 시험(`extra_api_action` 존재)

- [ ] **Step 3: `app.js` 수정**

(가) `function extra_api_action(connection, url, callback) {` 부터 그 함수의 닫는 `}` 까지(1876~1973행)를 통째로 지운다. 바로 다음의 `function check_xm2m_headers` 는 그대로다.

(나) `app.get('*', onem2mParser, (request, response) => {` 핸들러(2537행부터 `});` 로 닫히는 2591행까지)를 아래로 바꾼다:

```js
app.get('*', onem2mParser, (request, response) => {
    with_connection(request, response, (settle) => {
        // /hit · /total_ae · /total_cbs 가 여기(extra_api_action) 있었다. 2026-09-06 에
        // 관리 콘솔의 /api/stats/* 로 옮겼다 — 헤더·ACP 검사 **앞에서** 인증 없이
        // 호출 건수·AE 수·CIN 바이트 총합을 내보내던 경로였다(인수인계 §7, 외부에서
        // 닿는 것을 실측). 세 URL 은 이제 일반 리소스 조회로 떨어져 404 다.
        check_xm2m_headers(request, (code) => {
            if (code === '200') {
                // 헤더 검증을 통과한 요청만 센다 (§5.1).
                count_hit(request.headers['binding'] || 'H');

                get_target_url(request, response, (code) => {
                    if (code === '200') {
                        if (request.option !== '/fopt') {
                            run_operation(request, response, settle, 'GET', lookup_retrieve);
                        }
                        else { //if (request.option === '/fopt') {
                            run_fanout(request, response, settle, (request.query.fu == 1) ? security.ACOP.DISCOVERY : security.ACOP.RETRIEVE, false);
                        }
                    }
                    else if (code === '301-1') {
                        forward_to_csr(request, response, settle);
                    }
                    else {
                        settle.error(code);
                    }
                });
            }
            else {
                settle.error(code);
            }
        });
    });
});
```

- [ ] **Step 4: 시험**

Run: `node --test test/no-extra-api.test.js` → PASS (4/4)
Run: `npm test` → 전부 통과. `moment`·`fs` 가 app.js 에서 더 이상 안 쓰이는 것이 아니다(다른 곳에서 쓴다) — 지우지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add app.js test/no-extra-api.test.js
git commit -m "app: /hit·/total_ae·/total_cbs 공개 경로 제거 — 헤더·ACP 앞에서 운영 규모를 내보내던 구멍 (인수인계 §7 ②)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `admin/cse.js` — `elapsedMs`, 요청별 헤더 덮어쓰기, `create()`

**Files:**
- Modify: `admin/cse.js`
- Test: `test/admin-cse.test.js` (신설. 기존 `test/admin-cse-truncated.test.js` 는 손대지 않는다)

**Interfaces:**
- `Client.prototype.request(method, path, body, callback, opts)` — `opts` 는 선택. `opts.headers` 의 키가 기본 헤더를 덮어쓴다(`X-M2M-Origin` 포함). 결과 객체에 `elapsedMs`(number, 소수 첫째 자리) 가 항상 실린다 — 성공·실패·타임아웃 모두.
- `Client.prototype.create(parentPath, ty, rootName, attrs, callback, opts)` → `POST parentPath` with `{ content: { [rootName]: attrs }, ty }`.
- 기존 4인자 호출은 그대로 동작한다.

- [ ] **Step 1: 실패하는 시험**

`test/admin-cse.test.js`:

```js
'use strict';
// 콘솔의 CSE 클라이언트. 종합 테스트(2/2 계획)가 요청마다 소요 시간을 재고
// 케이스마다 X-M2M-Origin 을 바꿔야 해서, 요청별 헤더 덮어쓰기와 elapsedMs 를 더했다.
// 실제 http 서버를 띄워 검사한다 — 헤더가 정말 그렇게 나가는지는 소켓으로만 안다.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');

const { Client } = require(path.join(__dirname, '..', 'admin', 'cse.js'));

function serve(handler) {
    return new Promise((resolve) => {
        const srv = http.createServer(handler);
        srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
    });
}
function body_of(req) {
    return new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => resolve(s)); });
}

test('결과에 elapsedMs 가 실린다 — 성공·실패·타임아웃 모두', async function () {
    const { srv, port } = await serve(async (req, res) => {
        if (req.url === '/slow') { return; }             // 답하지 않는다 → 타임아웃
        res.setHeader('X-M2M-RSC', req.url === '/nf' ? '4004' : '2000');
        res.statusCode = req.url === '/nf' ? 404 : 200;
        res.end('{"m2m:cb":{}}');
    });
    const c = new Client({ host: '127.0.0.1', port, origin: 'Sponde', timeoutMs: 150 });
    const ok = await new Promise((r) => c.request('GET', '/Mobius', null, r));
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(typeof ok.elapsedMs, 'number');
    assert.ok(ok.elapsedMs >= 0 && ok.elapsedMs < 5000);
    const nf = await new Promise((r) => c.request('GET', '/nf', null, r));
    assert.strictEqual(nf.rsc, '4004');
    assert.strictEqual(typeof nf.elapsedMs, 'number');
    const to = await new Promise((r) => c.request('GET', '/slow', null, r));
    assert.match(to.error, /timeout/);
    assert.ok(to.elapsedMs >= 100, '타임아웃도 잰다: ' + to.elapsedMs);
    srv.close();
});

test('opts.headers 가 기본 헤더를 덮어쓴다 — Origin 을 케이스마다 바꿀 수 있다', async function () {
    let seen = null;
    const { srv, port } = await serve((req, res) => { seen = req.headers; res.setHeader('X-M2M-RSC', '2000'); res.end('{}'); });
    const c = new Client({ host: '127.0.0.1', port, origin: 'Sponde' });
    await new Promise((r) => c.request('GET', '/Mobius', null, r, { headers: { 'X-M2M-Origin': 'Cdev', 'X-M2M-RVI': '3' } }));
    assert.strictEqual(seen['x-m2m-origin'], 'Cdev');
    assert.strictEqual(seen['x-m2m-rvi'], '3');
    assert.ok(seen['x-m2m-ri'], '기본 헤더는 남는다');
    // 넷째 인자만 주는 옛 호출도 그대로다.
    await new Promise((r) => c.request('GET', '/Mobius', null, r));
    assert.strictEqual(seen['x-m2m-origin'], 'Sponde');
    srv.close();
});

test('create 는 POST 에 ty 를 Content-Type 으로 싣고 루트 이름으로 감싼다', async function () {
    let got = null;
    const { srv, port } = await serve(async (req, res) => {
        got = { method: req.method, url: req.url, ct: req.headers['content-type'], body: JSON.parse(await body_of(req)) };
        res.setHeader('X-M2M-RSC', '2001'); res.statusCode = 201; res.end('{"m2m:acp":{"ri":"/M/ae/acp1"}}');
    });
    const c = new Client({ host: '127.0.0.1', port, origin: 'Sponde' });
    const r = await new Promise((r) => c.create('/M/ae', 1, 'm2m:acp', { rn: 'acp1', pv: { acr: [] } }, r));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.rsc, '2001');
    assert.deepStrictEqual(got, { method: 'POST', url: '/M/ae', ct: 'application/json;ty=1',
                                  body: { 'm2m:acp': { rn: 'acp1', pv: { acr: [] } } } });
    srv.close();
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-cse.test.js`
Expected: FAIL — `elapsedMs` 가 `undefined`, `c.create is not a function`

- [ ] **Step 3: 구현**

`admin/cse.js` 의 `Client.prototype.request` 를 다음으로 바꾼다(주석은 기존 것을 유지하고 아래 표시한 곳만 더한다):

```js
/**
 * 한 건 요청한다. **예외를 던지지 않는다** — 실패도 결과의 한 종류다.
 * 일괄 작업에서 한 건의 실패가 나머지를 멈추면 안 된다.
 *
 * @param opts.headers  기본 헤더를 덮어쓴다. 종합 테스트가 케이스마다 X-M2M-Origin
 *                      을 바꾸고, 헤더 누락 케이스는 빈 문자열이 아니라 undefined 로
 *                      지운다(값이 undefined 인 키는 헤더에서 뺀다).
 * @returns callback({ ok, status, rsc, body, error, elapsedMs })
 *   rsc 는 Mobius 가 돌려주는 문자열 그대로다('2002', '4004' 등).
 *   서버 콘솔 로그와 대조할 수 있어야 하므로 재해석하지 않는다.
 *   elapsedMs 는 요청을 보낸 시점부터 결과가 확정될 때까지(타임아웃 포함)다.
 */
Client.prototype.request = function (method, path, body, callback, opts) {
    var self = this;
    var payload = body ? JSON.stringify(body.content) : null;
    var extra = (opts && opts.headers) || {};

    var headers = {
        'X-M2M-RI': this._ri(),
        'X-M2M-Origin': this.origin,
        'X-M2M-RVI': this.rvi,
        'Accept': 'application/json'
    };
    if (payload) {
        headers['Content-Type'] = 'application/json' + (body.ty ? ';ty=' + body.ty : '');
        headers['Content-Length'] = Buffer.byteLength(payload);
    }
    Object.keys(extra).forEach(function (k) {
        if (extra[k] === undefined) { delete headers[k]; }
        else { headers[k] = extra[k]; }
    });

    var t0 = process.hrtime.bigint();
    var settled = false;
    function settle(result) {
        if (settled) { return; }
        settled = true;
        result.elapsedMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;
        callback(result);
    }
    // … 이하 http.request 부터는 기존 코드 그대로 …
```

`settle` 이후의 본문(`var req = http.request(...)` 부터 `req.end();` 까지)은 바꾸지 않는다. 파일 끝의 `setExpiry` 뒤에 추가:

```js
/**
 * 자식 리소스를 만든다. ty 는 Content-Type 의 ;ty= 로 나간다 — Mobius 는 그것으로
 * 타입을 정한다(mobius/type_resolver.js).
 */
Client.prototype.create = function (parentPath, ty, rootName, attrs, callback, opts) {
    var content = {};
    content[rootName] = attrs;
    this.request('POST', parentPath, { content: content, ty: ty }, callback, opts);
};
```

- [ ] **Step 4: 시험**

Run: `node --test test/admin-cse.test.js test/admin-cse-truncated.test.js` → 전부 PASS
Run: `npm test` → 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add admin/cse.js test/admin-cse.test.js
git commit -m "admin(cse): 요청마다 elapsedMs · 헤더 덮어쓰기 · create() — 종합 테스트와 ACP 생성이 쓴다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 라우트를 `admin/api.js` 로 — `install(app, ctx)` + 시험 부팅 헬퍼

**Files:**
- Create: `admin/api.js`, `test/admin_app_helper.js`(시험 헬퍼 — `*.test.js` 가 아니라 러너가 직접 돌리지 않는다)
- Modify: `admin/server.js`
- Test: `test/admin-api-session.test.js`

**Interfaces:**
- Produces: `require('./api').install(app, ctx)`. `ctx` 의 모양(서버와 시험이 같은 것을 만든다):

```js
{
  conf,                 // 읽은 conf.json 객체 (api.js 는 conf.acp* 같은 코어 키만 읽는다 — 콘솔 키는 server.js 가 읽어 아래로 준다)
  password,             // adminPassword
  db, db_sql, responder, acp_simulate, acp_lint, acp_rules, expiry_policy,
  jobs,                 // admin/jobs.js
  cse,                  // admin/cse.js Client 또는 null(조회 전용)
  cseHost, csePort, cseOrigin, superUser,
  dataDir               // admin/data 절대 경로 (Task 9 가 쓴다; 시험은 임시 디렉터리)
}
```

- `server.js` 에 남는 것: conf 읽기와 검증, `HOST/PORT/PASSWORD`, 전역(`usedb`·CSE 신원), 모듈 require, `ctx` 조립, `install`, 정적 서빙, `db.applyConf`·`connect`·`listen`. **`conf.<키>` 읽기는 전부 server.js 에 남는다** — `test/conf-schema.test.js` 가 그 파일에서 리더를 찾는다.
- 시험 헬퍼 계약은 이 문서 앞의 "시험용 가짜 CSE 와 어댑터 대역" 절.

- [ ] **Step 1: 실패하는 시험**

`test/admin-api-session.test.js`:

```js
'use strict';
// 콘솔 라우트를 실제 express 앱으로 띄워 검사한다. 이전에는 server.js 가 conf 를
// 읽고 DB 에 붙고 listen 까지 한 파일에서 해서 라우트를 시험할 수 없었다 —
// api.js 로 가른 이유다.
const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./admin_app_helper');

test('세션 없이는 401, 로그인 뒤에는 세션 정보 — discoveryFilter 까지', async function () {
    const h = await boot({ conf: { adminPassword: 'pw', acpDiscoveryFilter: 'off', acpObserveMode: 'observe' } });
    try {
        const anon = await h.request('GET', '/api/session');
        assert.strictEqual(anon.status, 401);

        const bad = await h.login('nope');
        assert.strictEqual(bad.status, 401);

        const ok = await h.login('pw');
        assert.strictEqual(ok.status, 200);
        const s = await h.request('GET', '/api/session');
        assert.strictEqual(s.status, 200);
        assert.strictEqual(s.body.backend, 'mysql');
        assert.strictEqual(s.body.write.enabled, true);
        assert.strictEqual(s.body.write.superuser, true);
        assert.strictEqual(s.body.acp.observeMode, 'observe');
        // 위반 4 — 'off' 면 잠근 경로가 discovery 에 새서 시뮬레이터가 보호를 과장한다.
        assert.strictEqual(s.body.acp.discoveryFilter, 'off');
        assert.ok(!('origin' in s.body.write), 'origin 값은 내려보내지 않는다 — superUser 는 공유 비밀이다');
    } finally { await h.close(); }
});

test('로그아웃하면 같은 쿠키로 401', async function () {
    const h = await boot({});
    try {
        await h.login();
        await h.request('POST', '/api/logout');
        const s = await h.request('GET', '/api/session');
        assert.strictEqual(s.status, 401);
    } finally { await h.close(); }
});

test('기존 라우트가 살아 있다 — 작업 목록·ACP 검사·만료 요약', async function () {
    const h = await boot({
        execute: function (sql) {
            // 만료 요약: count_expired_by_type 의 배치 SELECT → 빈 결과면 0건으로 끝난다.
            return [];
        }
    });
    try {
        await h.login();
        const jobs = await h.request('GET', '/api/jobs');
        assert.deepStrictEqual(jobs.body, { jobs: [] });
        const sum = await h.request('GET', '/api/expired/summary');
        assert.strictEqual(sum.status, 200);
        assert.strictEqual(sum.body.counted, 0);
        assert.ok(h.calls.length > 0, '어댑터 대역이 질의를 받았다');
        const nojob = await h.request('GET', '/api/jobs/nope');
        assert.strictEqual(nojob.status, 404);
    } finally { await h.close(); }
});

test('쓰기 주소가 없으면 조회 전용이다 — 삭제 작업은 503', async function () {
    const h = await boot({ cse: null });
    try {
        await h.login();
        const s = await h.request('GET', '/api/session');
        assert.strictEqual(s.body.write.enabled, false);
        const r = await h.request('POST', '/api/jobs/expired-delete', { ris: ['/M/a'] });
        assert.strictEqual(r.status, 503);
    } finally { await h.close(); }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-api-session.test.js`
Expected: FAIL — `Cannot find module './admin_app_helper'`

- [ ] **Step 3: `test/admin_app_helper.js`**

```js
'use strict';
/**
 * 콘솔 라우트 시험용 부팅.
 *
 * 실제 express 앱을 임시 포트에 띄운다. DB 는 어댑터 대역(execute 를 가로채
 * SQL·bindings 를 기록하고 시험이 준 행을 돌려준다), CSE 는 가짜 HTTP 서버다.
 *
 * 가짜 CSE 는 **관대하지 않다** — X-M2M-RI·X-M2M-Origin 이 없으면 400, POST 에
 * Content-Type 의 ;ty= 가 없으면 400 을 낸다. 콘솔이 헤더를 빠뜨려도 시험이
 * 초록이면 시험이 거짓말을 하는 것이다.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');

function listen(srv) {
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

function fakeCse(dflt) {
    const calls = [];
    let reply = (dflt === null) ? null : Object.assign({ status: 200, rsc: '2000', body: {} }, dflt || {});
    const srv = http.createServer((req, res) => {
        let s = '';
        req.on('data', (c) => { s += c; });
        req.on('end', () => {
            let body = null;
            try { body = s ? JSON.parse(s) : null; } catch (e) { body = s; }
            const rec = { method: req.method, path: req.url, headers: req.headers, body: body, rejected: false };
            calls.push(rec);
            function refuse(msg) {
                rec.rejected = true;
                res.statusCode = 400; res.setHeader('X-M2M-RSC', '4000'); res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 'm2m:dbg': msg }));
            }
            if (!req.headers['x-m2m-ri'] || !req.headers['x-m2m-origin']) { return refuse('X-M2M-RI / X-M2M-Origin 없음'); }
            if (req.method === 'POST' && !/;ty=\d+/.test(req.headers['content-type'] || '')) { return refuse('Content-Type 에 ty 없음'); }
            const r = (typeof reply === 'function') ? reply(rec) : reply;
            res.statusCode = r.status; res.setHeader('X-M2M-RSC', r.rsc); res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(r.body === undefined ? {} : r.body));
        });
    });
    return { srv, calls, set(r) { reply = r; } };
}

/**
 * @param opts.conf     conf.json 값 (adminPassword 기본 'pw')
 * @param opts.execute  (sql, bindings) → SELECT 행 배열 | { affectedRows } . 던지면 DB 오류가 된다
 * @param opts.cse      가짜 CSE 기본 응답 { status, rsc, body } 또는 (rec) → 그것. null 이면 조회 전용
 * @param opts.dataDir  admin/data 대신 쓸 디렉터리 (기본: 임시)
 */
async function boot(opts) {
    opts = opts || {};
    global.NOPRINT = 'true';
    global.usedb = 'mysql';
    global.usecsebase = 'Mobius'; global.usecseid = '/Mobius2'; global.usespid = '//keti.re.kr';
    global.usesuperuser = 'Sponde';

    ['mobius/db/index.js', 'mobius/db/mysql.js', 'mobius/db/sqlite.js', 'mobius/sql_action.js',
     'mobius/acp_lint.js', 'mobius/acp_simulate.js', 'admin/jobs.js', 'admin/api.js']
        .forEach((p) => { delete require.cache[require.resolve(path.join(ROOT, p))]; });

    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const calls = [];
    adapter.connect = function (cb) { cb('1'); };
    adapter.getConnection = function (cb) { cb('200', { fake: true }); };
    adapter.release = function () {};
    adapter.execute = function (conn, sql, bindings, cb) {
        calls.push({ sql: sql, bindings: bindings });
        let out;
        try { out = opts.execute ? opts.execute(sql, bindings) : []; }
        catch (e) { return cb(e); }
        if (out === undefined) { out = /^\s*select\b/i.test(sql) ? [] : { affectedRows: 0 }; }
        cb(null, out);
    };
    db.connect(function () {});

    const jobs = require(path.join(ROOT, 'admin', 'jobs.js'));
    jobs._reset();

    const conf = Object.assign({ adminPassword: 'pw' }, opts.conf || {});
    let fc = null, cse = null, csePort = 0;
    if (opts.cse !== null) {
        fc = fakeCse(opts.cse);
        csePort = await listen(fc.srv);
        const { Client } = require(path.join(ROOT, 'admin', 'cse.js'));
        cse = new Client({ host: '127.0.0.1', port: csePort, origin: conf.adminOrigin || 'Sponde', timeoutMs: 2000 });
    }
    const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'admin-data-'));

    const ctx = {
        conf: conf,
        password: conf.adminPassword,
        db: db,
        db_sql: require(path.join(ROOT, 'mobius', 'sql_action')),
        responder: require(path.join(ROOT, 'mobius', 'responder')),
        acp_simulate: require(path.join(ROOT, 'mobius', 'acp_simulate')),
        acp_lint: require(path.join(ROOT, 'mobius', 'acp_lint')),
        acp_rules: require(path.join(ROOT, 'mobius', 'acp')),
        expiry_policy: require(path.join(ROOT, 'mobius', 'expiry_policy')),
        jobs: jobs,
        cse: cse,
        cseHost: '127.0.0.1', csePort: csePort, cseOrigin: conf.adminOrigin || 'Sponde', superUser: 'Sponde',
        dataDir: dataDir
    };

    const app = express();
    require(path.join(ROOT, 'admin', 'api.js')).install(app, ctx);
    const srv = http.createServer(app);
    const port = await listen(srv);

    let cookie = '';
    function request(method, p, body) {
        return new Promise((resolve, reject) => {
            const payload = body === undefined ? null : JSON.stringify(body);
            const headers = {};
            if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
            if (cookie) { headers.Cookie = cookie; }
            const req = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: headers }, (res) => {
                let s = '';
                res.on('data', (c) => { s += c; });
                res.on('end', () => {
                    const sc = res.headers['set-cookie'];
                    if (sc && sc.length) { cookie = sc[0].split(';')[0]; }
                    let parsed = s;
                    try { parsed = JSON.parse(s); } catch (e) { /* 텍스트 응답 */ }
                    resolve({ status: res.statusCode, headers: res.headers, body: parsed });
                });
            });
            req.on('error', reject);
            if (payload) { req.write(payload); }
            req.end();
        });
    }

    return {
        app, ctx, calls, cse: fc, dataDir,
        request,
        login: (pw) => request('POST', '/api/login', { password: pw === undefined ? conf.adminPassword : pw }),
        close: () => new Promise((resolve) => { srv.close(() => { if (fc) { fc.srv.close(() => resolve()); } else { resolve(); } }); })
    };
}

module.exports = { boot, fakeCse };
```

- [ ] **Step 4: `admin/api.js` — server.js 의 라우트를 옮긴다**

`admin/server.js` 에서 `// ── 세션 ──` 절부터 `app.post('/api/jobs/:id/cancel', …)` 핸들러의 끝(898행 `});`)까지를 **잘라내어** 아래 골격의 표시된 자리에 넣고, 자유 변수를 표대로 바꾼다. 로직은 바꾸지 않는다(Task 6~9 가 바꾼다).

| 옮긴 코드의 이름 | `api.js` 에서 |
|---|---|
| `conf` | `ctx.conf` (`conf.acpObserveMode` 등 — 코어 키만 남는다) |
| `PASSWORD` | `ctx.password` |
| `db` · `db_sql` · `responder` · `acp_simulate` · `acp_lint` · `acp_rules` · `jobs` | `ctx.db` … `ctx.jobs` (함수 첫머리에서 `var db = ctx.db;` 처럼 지역 변수로 받아 본문은 그대로 둔다) |
| `cse` | `ctx.cse` (지역 `var cse = ctx.cse;`) |
| `CSE_HOST` · `CSE_PORT` · `CSE_ORIGIN` · `SUPER_USER` | `ctx.cseHost` · `ctx.csePort` · `ctx.cseOrigin` · `ctx.superUser` |
| `MAX_TARGETS` · `SESSION_TTL_MS` · `SCAN_MAX_PASSES` · `EXTENDABLE` | `api.js` 의 모듈 상수로 (EXTENDABLE 은 Task 6 가 없앤다) |
| `moment` · `crypto` | `api.js` 상단에서 require |
| `app.use(express.json(...))` | `install` 첫 줄로 (`express` 를 api.js 가 require) |

```js
'use strict';
/**
 * 관리 콘솔의 /api/* 라우트.
 *
 * server.js 가 conf 를 읽고 DB 에 붙고 listen 하는 일을 하고, 라우트는 여기 있다.
 * 가른 이유는 시험이다 — 같은 라우트를 임시 포트·어댑터 대역·가짜 CSE 로 띄워
 * 검사한다(test/admin_app_helper.js). ctx 의 모양은 계획 문서 Task 5 에 있다.
 *
 * **conf.json 의 콘솔 키(admin*)는 server.js 가 읽는다.** 여기서는 ctx 로 받는다.
 * test/conf-schema.test.js 가 admin/server.js 에서 리더를 찾기 때문이다.
 */
var crypto = require('crypto');
var express = require('express');
var moment = require('moment');

/** 한 작업이 다룰 수 있는 대상 수. 넘으면 나눠서 돌린다. */
var MAX_TARGETS = 5000;
var SESSION_TTL_MS = 8 * 60 * 60 * 1000;
var SCAN_MAX_PASSES = 50;

exports.install = function (app, ctx) {
    var conf = ctx.conf;
    var db = ctx.db;
    var db_sql = ctx.db_sql;
    var responder = ctx.responder;
    var acp_simulate = ctx.acp_simulate;
    var acp_lint = ctx.acp_lint;
    var acp_rules = ctx.acp_rules;
    var jobs = ctx.jobs;
    var cse = ctx.cse;

    app.use(express.json({ limit: '256kb' }));

    // ── 여기부터 server.js 의 "세션" 절 ~ "/api/jobs/:id/cancel" 핸들러를 그대로 ──
    // (sessions · new_session · valid_session · password_matches · parse_cookie ·
    //  /api/login · /api/logout · 게이트 · with_connection · now_et · /api/session ·
    //  만료 · 고아 · drain/scan_refs_all/lint_refs_all · ACP 라우트 · 일괄 작업 ·
    //  /api/jobs*)
    // ── 여기까지 ──────────────────────────────────────────────────────────
};
```

`password_matches` 는 `PASSWORD` 대신 `ctx.password` 를 본다. `require_write` 는 `cse` 지역 변수를 본다. `/api/session` 의 `write.target` 은 `ctx.cseHost + ':' + ctx.csePort`, `superuser` 는 `ctx.cseOrigin === ctx.superUser`.

`/api/session` 의 `acp` 객체에 한 줄을 더한다(위반 4 — 나머지는 Task 11 이 화면에서 쓴다):

```js
            acp: {
                observeMode: conf.acpObserveMode || 'off',
                attachPolicy: conf.acpiAttachPolicy || 'open',
                defaultPolicy: conf.defaultAccessPolicy || 'disable',
                audit: conf.acpAudit || 'on',
                denyLog: conf.acpDenyLog || 'sample',
                // 'off' 면 잠근 컨테이너의 경로가 상위 discovery 에 그대로 나온다 —
                // 시뮬레이터의 "거부" 가 실제 보호를 과장한다. 화면이 경고를 띄운다.
                discoveryFilter: conf.acpDiscoveryFilter || 'on'
            }
```

- [ ] **Step 5: `admin/server.js` 를 줄인다**

잘라낸 자리에 `ctx` 조립과 `install` 을 넣는다. 파일의 나머지(상단 conf 읽기·전역·모듈 require, 하단 정적 서빙·기동)는 그대로다. `express.json` 줄과 `MAX_TARGETS` 선언은 api.js 로 갔으므로 지운다.

```js
// ── 앱 ────────────────────────────────────────────────────────────────────
var app = express();

// 라우트는 admin/api.js 에 있다. 여기서는 그것이 필요로 하는 것을 모아 넘긴다 —
// 시험이 같은 install 을 임시 포트·어댑터 대역·가짜 CSE 로 부른다.
var expiry_policy = require(path.join(ROOT, 'mobius', 'expiry_policy'));
var DATA_DIR = path.join(__dirname, 'data');
require('./api').install(app, {
    conf: conf,
    password: PASSWORD,
    db: db, db_sql: db_sql, responder: responder,
    acp_simulate: acp_simulate, acp_lint: acp_lint, acp_rules: acp_rules,
    expiry_policy: expiry_policy,
    jobs: jobs,
    cse: cse,
    cseHost: CSE_HOST, csePort: CSE_PORT, cseOrigin: CSE_ORIGIN, superUser: SUPER_USER,
    dataDir: DATA_DIR
});
```

`.gitignore` 에 `admin/data/` 를 더한다.

- [ ] **Step 6: 시험**

Run: `node --test test/admin-api-session.test.js` → PASS (4/4)
Run: `npm test` → 전부 통과. 특히 `test/conf-schema.test.js` 가 `admin/server.js` 에서 `adminPassword`·`adminPort`·`adminHost`·`adminCseHost`·`adminCsePort`·`adminOrigin` 을 여전히 찾는지 — 그 여섯 읽기는 server.js 에 남아 있어야 한다.

- [ ] **Step 7: 커밋**

```bash
git add admin/api.js admin/server.js test/admin_app_helper.js test/admin-api-session.test.js .gitignore
git commit -m "admin(api): 라우트를 api.js 의 install(app, ctx) 로 — 시험이 임시 포트·어댑터 대역·가짜 CSE 로 띄운다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 만료 정책·통계 라우트 — `/api/expired/policy`, `/api/stats/*`, 연장 작업의 상수 제거

**Files:**
- Modify: `admin/api.js`
- Test: `test/admin-api-expired-stats.test.js`

**Interfaces:**
- `GET /api/expired/policy` → `{ autoDeletedTypes: number[], etExtendableTypes: number[], undeletableTypes: [5], typeNames }`.
- `GET /api/stats/hit` → `{ asOf, rows: [{ ct: 'YYYYMMDD', http, mqtt, coap, ws }] }` (최근 1년, `get_hit_all` 그대로).
- `GET /api/stats/total-ae` → `{ total: number }` · `GET /api/stats/total-cbs` → `{ total: number }`.
- `expired-extend` 작업이 `EXTENDABLE` 상수 대신 `ctx.expiry_policy.etExtendableTypes()` 를 본다.

- [ ] **Step 1: 실패하는 시험**

`test/admin-api-expired-stats.test.js`:

```js
'use strict';
// 만료 화면의 정책 상수 두 개(AUTO_DELETED_RISKY·ET_EXTENDABLE)가 코어와 어긋나
// 있었다(목적 문서 §0층). 이제 화면은 이 라우트만 본다. 통계는 코어의 공개 경로
// (/hit·/total_*)를 지운 자리다 — 세션 뒤에서만 나간다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { boot } = require('./admin_app_helper');
const policy = require(path.join(__dirname, '..', 'mobius', 'expiry_policy'));

test('/api/expired/policy 는 코어 함수의 값 그대로다', async function () {
    const h = await boot({});
    try {
        await h.login();
        const r = await h.request('GET', '/api/expired/policy');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.etExtendableTypes, policy.etExtendableTypes());
        assert.deepStrictEqual(r.body.autoDeletedTypes, policy.autoDeletedTypes());
        assert.deepStrictEqual(r.body.undeletableTypes, [5]);
        assert.strictEqual(r.body.typeNames['2'], 'ae');
    } finally { await h.close(); }
});

test('et 연장 작업은 정책 함수로 타입을 가른다 — fcnt 는 되고 cin 은 건너뛴다', async function () {
    const h = await boot({
        execute: function (sql, bindings) {
            // select_lookup(ri) — 대상의 타입을 돌려준다.
            if (/from `lookup`/.test(sql)) {
                const ri = bindings[0];
                return [{ ri: ri, ty: ri.endsWith('/f') ? '28' : '4', et: '20990101T000000' }];
            }
            return [];
        },
        cse: { status: 200, rsc: '2004', body: {} }
    });
    try {
        await h.login();
        const r = await h.request('POST', '/api/jobs/expired-extend', { ris: ['/M/a/f', '/M/a/c/4-1'], et: '20991231T000000' });
        assert.strictEqual(r.status, 202);
        const id = r.body.id;
        let job;
        for (let i = 0; i < 200; i++) {
            job = (await h.request('GET', '/api/jobs/' + id)).body;
            if (job.state !== 'running') { break; }
            await new Promise((res) => setTimeout(res, 10));
        }
        assert.strictEqual(job.state, 'done');
        assert.strictEqual(job.ok, 1, 'fcnt 는 연장된다 — 예전 상수는 이것을 막았다');
        assert.strictEqual(job.skipped, 1, 'cin 은 건너뛴다');
        assert.match(job.skips[0].reason, /CIN/);
        const put = h.cse.calls.find((c) => c.method === 'PUT');
        assert.strictEqual(put.path, '/M/a/f');
        assert.deepStrictEqual(put.body, { 'm2m:fcnt': { et: '20991231T000000' } });
    } finally { await h.close(); }
});

test('/api/stats/* 는 세션 뒤에서 hit·AE 수·CIN 바이트 총합을 준다', async function () {
    const h = await boot({
        execute: function (sql) {
            if (/from `hit`/.test(sql)) { return [{ ct: '20260905', http: 100, mqtt: 5, coap: 0, ws: 0 }]; }
            if (/count\(\*\) from ae/.test(sql)) { return [{ 'count(*)': 42 }]; }
            if (/sum\(cbs\) from cnt/.test(sql)) { return [{ 'sum(cbs)': 123456 }]; }
            return [];
        }
    });
    try {
        assert.strictEqual((await h.request('GET', '/api/stats/hit')).status, 401);
        await h.login();
        const hit = await h.request('GET', '/api/stats/hit');
        assert.strictEqual(hit.status, 200);
        assert.deepStrictEqual(hit.body.rows, [{ ct: '20260905', http: 100, mqtt: 5, coap: 0, ws: 0 }]);
        assert.match(hit.body.asOf, /^\d{8}T\d{6}$/);
        assert.deepStrictEqual((await h.request('GET', '/api/stats/total-ae')).body, { total: 42 });
        assert.deepStrictEqual((await h.request('GET', '/api/stats/total-cbs')).body, { total: 123456 });
    } finally { await h.close(); }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-api-expired-stats.test.js`
Expected: FAIL — `/api/expired/policy` 404

- [ ] **Step 3: 구현 — `admin/api.js`**

(가) 만료 라우트 절(`/api/expired/summary` 앞)에:

```js
    /**
     * 만료 정책. 화면이 상수로 들고 있던 것을 코어 함수로 바꿨다 — ACP 만 자동 삭제된다고
     * 표시했는데 실제로는 아무것도 자동 삭제되지 않고, 코어가 et 를 받아 주는 타입을
     * 화면이 막고 있었다(목적 문서 §0층 위반 1·2). undeletableTypes 는 정책이 아니라
     * 구조다 — CSEBase 는 트리의 뿌리라 지울 수 없다(405-9).
     */
    app.get('/api/expired/policy', function (req, res) {
        res.json({
            autoDeletedTypes: ctx.expiry_policy.autoDeletedTypes(),
            etExtendableTypes: ctx.expiry_policy.etExtendableTypes(),
            undeletableTypes: [5],
            typeNames: responder.typeRsrc
        });
    });
```

(나) `var EXTENDABLE = { '1': 1, '2': 1, '3': 1, '9': 1, '23': 1 };` 줄과 그 위 주석을 지운다. `expired-extend` 워커의 `if (!EXTENDABLE[ty]) {` 를:

```js
                    var extendable = ctx.expiry_policy.etExtendableTypes();
                    if (extendable.indexOf(parseInt(ty, 10)) < 0) {
```

로 바꾼다(`nm.toUpperCase() + ' — et 를 수정할 수 없는 타입'` 문구는 그대로).

(다) 일괄 작업 절 앞(`// ── 일괄 작업` 주석 위)에 통계 라우트:

```js
    // ── 통계 (관측) ───────────────────────────────────────────────────────
    //
    // 코어의 /hit · /total_ae · /total_cbs 가 여기로 왔다(2026-09-06). 그 경로는
    // X-M2M 헤더 검사와 ACP 앞에서 인증 없이 응답했고 외부에서 닿았다(인수인계 §7).
    // 여기서는 세션 게이트 뒤다. 질의는 코어의 것을 그대로 쓴다.

    function first_value(rows) {
        if (!rows || !rows.length) { return 0; }
        var r = rows[0];
        var k = Object.keys(r)[0];
        return Number(r[k]) || 0;
    }

    app.get('/api/stats/hit', function (req, res) {
        with_connection(res, function (conn, done) {
            db_sql.get_hit_all(conn, function (err, rows) {
                done();
                if (err) { return res.status(500).json({ error: String((rows && rows.message) || err) }); }
                res.json({ asOf: now_et(), rows: rows });
            });
        });
    });
    app.get('/api/stats/total-ae', function (req, res) {
        with_connection(res, function (conn, done) {
            db_sql.select_sum_ae(conn, function (err, rows) {
                done();
                if (err) { return res.status(500).json({ error: String((rows && rows.message) || err) }); }
                res.json({ total: first_value(rows) });
            });
        });
    });
    app.get('/api/stats/total-cbs', function (req, res) {
        with_connection(res, function (conn, done) {
            db_sql.select_sum_cbs(conn, function (err, rows) {
                done();
                if (err) { return res.status(500).json({ error: String((rows && rows.message) || err) }); }
                res.json({ total: first_value(rows) });
            });
        });
    });
```

- [ ] **Step 4: 시험**

Run: `node --test test/admin-api-expired-stats.test.js test/admin-api-session.test.js` → PASS
Run: `npm test` → 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add admin/api.js test/admin-api-expired-stats.test.js
git commit -m "admin(api): 만료 정책은 코어 함수로 · /api/stats/* 로 hit·AE·cbs 집계 이관 · 연장 작업의 타입 상수 제거

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 구독 롤업 라우트 — `/api/subs/endpoints`, `/api/subs/sample`

**Files:**
- Modify: `admin/api.js`
- Test: `test/admin-api-subs.test.js`

**Interfaces:**
- `GET /api/subs/endpoints?limit=100&scanCap=20000` → `{ endpoints: [{ endpoint, total, broken, suspect, sample }], endpointsTruncated, scanned, capped, audit: { scanned, capped, bySeverity, byReason } }`.
- `GET /api/subs/sample?endpoint=<문자열>&limit=200` → `{ rows: [{ ri, pi, nu, enc, cr, severity, reason }], more, scanned, capped }`. `severity` 는 `'broken'|'suspect'|null`.
- 판정은 `db_sql.audit_subscriptions` 를 끝까지(`next` 커서) 돌려 `ri → {severity, reason}` 맵을 만든 뒤 넘긴다. 콘솔은 자기 기준을 만들지 않는다.

- [ ] **Step 1: 실패하는 시험**

`test/admin-api-subs.test.js`:

```js
'use strict';
// 구독 화면은 목록이 아니라 엔드포인트 묶음이다(백로그 §3-1). broken 과 suspect 를
// 같은 선택에 섞지 않는 것이 코어 감사 함수의 계약이고, 라우트는 그 결과를 그대로
// 전한다.
const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./admin_app_helper');

const sub = (ri, nus) => ({ ri: ri, pi: '/M/ae', nu: JSON.stringify(nus), enc: '{}', cr: 'Cae',
                             nct: null, nec: null, exc: null, su: null });

function execute(sql, bindings) {
    // 롤업·표본·감사가 모두 sub 를 ri 키셋으로 읽는다. 감사는 lookup 도 본다(대상 존재 확인) —
    // 빈 결과를 주면 mqtt 대상이 없어 'mqtt_topic_unregistered'(suspect) 로 판정된다.
    if (/from `sub`/.test(sql)) {
        const after = bindings[0] || '';
        return [sub('/M/ae/s1', ['mqtt://broker/A?ct=json']), sub('/M/ae/s2', ['http://10.0.0.5:8080/n'])]
            .filter((r) => r.ri > after);
    }
    return [];
}

test('엔드포인트로 묶고 코어 감사의 판정을 붙인다', async function () {
    const h = await boot({ execute });
    try {
        await h.login();
        const r = await h.request('GET', '/api/subs/endpoints');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.endpoints.map((e) => e.endpoint).sort(), ['http://10.0.0.5:8080', 'mqtt://broker']);
        const mq = r.body.endpoints.find((e) => e.endpoint === 'mqtt://broker');
        assert.strictEqual(mq.total, 1);
        assert.strictEqual(mq.broken + mq.suspect <= 1, true);
        assert.ok(r.body.audit && typeof r.body.audit.scanned === 'number', '감사 요약을 같이 준다');
        assert.strictEqual(r.body.capped, false);
    } finally { await h.close(); }
});

test('표본은 그 엔드포인트의 구독만, 판정과 함께', async function () {
    const h = await boot({ execute });
    try {
        await h.login();
        const r = await h.request('GET', '/api/subs/sample?endpoint=' + encodeURIComponent('http://10.0.0.5:8080'));
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.rows.map((x) => x.ri), ['/M/ae/s2']);
        assert.ok('severity' in r.body.rows[0]);
        assert.ok('reason' in r.body.rows[0]);
        const bad = await h.request('GET', '/api/subs/sample');
        assert.strictEqual(bad.status, 400);
    } finally { await h.close(); }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-api-subs.test.js`
Expected: FAIL — 404

- [ ] **Step 3: 구현 — `admin/api.js` 의 통계 절 뒤에**

```js
    // ── 구독 (엔드포인트 롤업) ────────────────────────────────────────────
    //
    // 배포는 구독 3,463건에 고유 nu 202개, 상위 3개가 57% 다. 목록을 그대로 올리면
    // 못 읽는다 — nu 의 엔드포인트로 묶는 것이 첫 화면이다. 판정(broken/suspect)은
    // 코어 audit_subscriptions 가 유일한 기준이고, 여기서는 그 결과를 ri 맵으로
    // 만들어 롤업에 넘긴다. **콘솔이 자기 기준을 만들지 않는다.**

    /** 감사를 끝까지 돌려 ri → { severity, reason } 를 만든다. */
    function audit_map(conn, callback) {
        var map = {};
        var acc = { scanned: 0, capped: false, bySeverity: {}, byReason: {} };
        drain(
            function (after, cb) {
                var o = { batch: 500, scanCap: 20000, maxFindings: 2000 };
                if (after) { o.after = after; }
                db_sql.audit_subscriptions(conn, o, cb);
            },
            acc,
            function (a, p) {
                a.scanned += p.scanned;
                a.capped = a.capped || p.capped;
                Object.keys(p.bySeverity || {}).forEach(function (k) { a.bySeverity[k] = (a.bySeverity[k] || 0) + p.bySeverity[k]; });
                Object.keys(p.byReason || {}).forEach(function (k) { a.byReason[k] = (a.byReason[k] || 0) + p.byReason[k]; });
                (p.findings || []).forEach(function (f) { map[f.ri] = { severity: f.severity, reason: f.reason }; });
            },
            function (err, a) { callback(err, map, a); });
    }

    app.get('/api/subs/endpoints', function (req, res) {
        var limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        var scanCap = Math.min(parseInt(req.query.scanCap, 10) || 20000, 200000);
        with_connection(res, function (conn, done) {
            audit_map(conn, function (err, map, audit) {
                if (err) { done(); return res.status(500).json({ error: String((map && map.message) || err) }); }
                db_sql.select_sub_endpoint_rollup(conn, {
                    limit: limit, scanCap: scanCap,
                    severityOf: function (ri) { return map[ri] ? map[ri].severity : null; }
                }, function (err2, r) {
                    done();
                    if (err2) { return res.status(500).json({ error: String((r && r.message) || err2) }); }
                    r.audit = audit;
                    res.json(r);
                });
            });
        });
    });

    app.get('/api/subs/sample', function (req, res) {
        var endpoint = req.query.endpoint;
        if (!endpoint) { return res.status(400).json({ error: 'endpoint 가 필요하다' }); }
        var limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
        with_connection(res, function (conn, done) {
            audit_map(conn, function (err, map) {
                if (err) { done(); return res.status(500).json({ error: String((map && map.message) || err) }); }
                db_sql.select_subs_by_endpoint(conn, { endpoint: String(endpoint), limit: limit }, function (err2, r) {
                    done();
                    if (err2) { return res.status(500).json({ error: String((r && r.message) || err2) }); }
                    r.rows = r.rows.map(function (row) {
                        var f = map[row.ri];
                        row.severity = f ? f.severity : null;
                        row.reason = f ? f.reason : null;
                        return row;
                    });
                    res.json(r);
                });
            });
        });
    });
```

`drain` 은 이미 api.js 에 있다(ACP 절에서 옮겨 왔다). 이 절은 `drain` 정의보다 **아래**에 있어야 한다 — 통계 절 뒤에 두면 그렇다.

- [ ] **Step 4: 시험**

Run: `node --test test/admin-api-subs.test.js` → PASS (2/2)
Run: `npm test` → 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add admin/api.js test/admin-api-subs.test.js
git commit -m "admin(api): 구독 엔드포인트 롤업·표본 — 판정은 코어 감사 결과 그대로

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: ACP 신규 생성·`acpi` 연결 라우트 — `/api/acp/create`, `/api/acp/attach`

**Files:**
- Modify: `admin/api.js`
- Test: `test/admin-api-acp-write.test.js`

**Interfaces:**
- `POST /api/acp/create { parentRi, rn, pv, pvs }` → 201 `{ ok, ri, status, rsc }`. 부모는 AE(`ty=2`)여야 한다(잠금 단위). `rn` 은 `/^[A-Za-z0-9_-]{1,64}$/`. `pv`·`pvs` 는 `acp_rules.validate_privileges` 를 지난다. CSE 에 `POST parentRi` `ty=1` `{ 'm2m:acp': { rn, pv, pvs } }` 한 번.
- `POST /api/acp/attach { targetRi, acpi: string[] }` → 200 `{ ok, status, rsc }`. 대상은 AE 여야 하고, `acpi` 는 0~7개의 `'/'` 로 시작하는 ri, 각각 `lookup` 에 `ty=1` 로 있어야 한다. CSE 에 `PUT targetRi` `{ 'm2m:ae': { acpi } }` 한 번. 빈 배열은 "전부 해제" 다.
- 둘 다 `require_write` 를 지난다(조회 전용이면 503).

- [ ] **Step 1: 실패하는 시험**

`test/admin-api-acp-write.test.js`:

```js
'use strict';
// ACP 를 만들고 AE 에 붙이는 두 쓰기. 둘 다 CSE HTTP 한 번이고 DB 는 프리플라이트로만
// 읽는다. 잠금 단위는 AE 하나다 — 컨테이너·CIN 에는 붙이지 않는다(이전 결정).
const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./admin_app_helper');

function lookup_rows(byRi) {
    return function (sql, bindings) {
        if (/from `lookup`/.test(sql)) {
            const row = byRi[bindings[0]];
            return row ? [row] : [];
        }
        return [];
    };
}

test('create: AE 아래에 ty=1 POST 한 번, 검사에 걸리면 CSE 를 부르지 않는다', async function () {
    const h = await boot({
        execute: lookup_rows({ '/M/ae': { ri: '/M/ae', ty: '2' }, '/M/ae/c': { ri: '/M/ae/c', ty: '3' } }),
        cse: { status: 201, rsc: '2001', body: { 'm2m:acp': { ri: '/M/ae/acp1' } } }
    });
    try {
        await h.login();
        const pv = { acr: [{ acor: ['Cdev'], acop: 63 }] };
        const pvs = { acr: [{ acor: ['Cadmin'], acop: 63 }] };
        const ok = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae', rn: 'acp1', pv, pvs });
        assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
        assert.strictEqual(ok.body.ri, '/M/ae/acp1');
        const post = h.cse.calls[0];
        assert.strictEqual(post.method, 'POST');
        assert.strictEqual(post.path, '/M/ae');
        assert.match(post.headers['content-type'], /;ty=1$/);
        assert.deepStrictEqual(post.body, { 'm2m:acp': { rn: 'acp1', pv, pvs } });

        const n = h.cse.calls.length;
        const badRn = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae', rn: 'a b', pv, pvs });
        assert.strictEqual(badRn.status, 400);
        const badParent = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae/c', rn: 'x', pv, pvs });
        assert.strictEqual(badParent.status, 400);
        assert.match(badParent.body.error, /AE/);
        const badPv = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae', rn: 'x', pv: { acr: [{ acor: ['a'] }] }, pvs });
        assert.strictEqual(badPv.status, 400);
        assert.ok(badPv.body.problems && badPv.body.problems.length);
        assert.strictEqual(h.cse.calls.length, n, '검사에 걸린 요청은 CSE 로 가지 않는다');
    } finally { await h.close(); }
});

test('attach: AE 에 acpi 배열을 PUT 한 번 — 대상·ACP 존재를 먼저 본다', async function () {
    const h = await boot({
        execute: lookup_rows({
            '/M/ae': { ri: '/M/ae', ty: '2' },
            '/M/ae/c': { ri: '/M/ae/c', ty: '3' },
            '/M/ae/acp1': { ri: '/M/ae/acp1', ty: '1' },
            '/M/other/acp9': { ri: '/M/other/acp9', ty: '1' }
        }),
        cse: { status: 200, rsc: '2004', body: {} }
    });
    try {
        await h.login();
        const ok = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae', acpi: ['/M/ae/acp1', '/M/other/acp9'] });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
        const put = h.cse.calls[0];
        assert.strictEqual(put.method, 'PUT');
        assert.strictEqual(put.path, '/M/ae');
        assert.deepStrictEqual(put.body, { 'm2m:ae': { acpi: ['/M/ae/acp1', '/M/other/acp9'] } });

        const n = h.cse.calls.length;
        const notAe = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae/c', acpi: ['/M/ae/acp1'] });
        assert.strictEqual(notAe.status, 400);
        const missing = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae', acpi: ['/M/nope'] });
        assert.strictEqual(missing.status, 400);
        assert.match(missing.body.error, /nope/);
        const tooMany = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae', acpi: Array.from({ length: 8 }, (_, i) => '/M/ae/acp' + i) });
        assert.strictEqual(tooMany.status, 400);
        assert.strictEqual(h.cse.calls.length, n);

        // 빈 배열은 전부 해제다.
        const clear = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae', acpi: [] });
        assert.strictEqual(clear.status, 200);
        assert.deepStrictEqual(h.cse.calls[h.cse.calls.length - 1].body, { 'm2m:ae': { acpi: [] } });
    } finally { await h.close(); }
});

test('CSE 가 거절하면 그 rsc 를 그대로 전한다', async function () {
    const h = await boot({
        execute: lookup_rows({ '/M/ae': { ri: '/M/ae', ty: '2' } }),
        cse: { status: 403, rsc: '4103', body: { 'm2m:dbg': 'no privilege' } }
    });
    try {
        await h.login();
        const r = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae', rn: 'x', pv: { acr: [] }, pvs: { acr: [] } });
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.body.rsc, '4103');
    } finally { await h.close(); }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/admin-api-acp-write.test.js`
Expected: FAIL — 404

- [ ] **Step 3: 구현 — `admin/api.js` 의 `/api/acp/save` 뒤에**

```js
    /** lookup 에서 ri 하나의 타입을 본다. 없으면 null. */
    function type_of(conn, ri, cb) {
        db_sql.select_lookup(conn, ri, function (e, rows) {
            if (e) { return cb('DB 조회 실패: ' + String((rows && rows.message) || e)); }
            if (!rows || rows.length === 0) { return cb(null, null); }
            cb(null, String(rows[0].ty));
        });
    }

    function cse_failure(res, r) {
        res.status(r.status >= 400 && r.status < 500 ? 400 : 502).json({
            error: describe(r), status: r.status, rsc: r.rsc, body: r.body
        });
    }

    /**
     * ACP 신규 생성. 부모는 AE 다 — 잠금 단위가 AE 하나이므로(이전 결정) 컨테이너
     * 아래에 ACP 를 두는 길을 열지 않는다. 검사 → CSE POST 한 번. 부분 적용은 없다.
     */
    app.post('/api/acp/create', function (req, res) {
        if (!require_write(res)) { return; }
        var b = req.body || {};
        if (typeof b.parentRi !== 'string' || b.parentRi.charAt(0) !== '/') {
            return res.status(400).json({ error: 'parentRi 가 필요하다' });
        }
        if (typeof b.rn !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.rn)) {
            return res.status(400).json({ error: 'rn 은 영문·숫자·_·- 1~64자다' });
        }
        var problems = [];
        ['pv', 'pvs'].forEach(function (f) {
            if (!b[f] || typeof b[f] !== 'object') {
                problems.push({ field: f, code: '400-57', path: f, message: f + ' 가 객체가 아니다' });
                return;
            }
            var v = acp_rules.validate_privileges(b[f], f);
            if (v.code) { problems.push({ field: f, code: v.code, path: v.path, message: v.message || '' }); }
        });
        if (problems.length) { return res.status(400).json({ error: '값이 올바르지 않다', problems: problems }); }

        with_connection(res, function (conn, done) {
            type_of(conn, b.parentRi, function (e, ty) {
                done();
                if (e) { return res.status(500).json({ error: e }); }
                if (ty !== '2') { return res.status(400).json({ error: '부모는 AE 여야 한다 (잠금 단위는 AE 하나다)' }); }
                cse.create(b.parentRi, 1, 'm2m:acp', { rn: b.rn, pv: b.pv, pvs: b.pvs }, function (r) {
                    if (!r.ok) { return cse_failure(res, r); }
                    res.status(201).json({ ok: true, ri: b.parentRi + '/' + b.rn, status: r.status, rsc: r.rsc });
                });
            });
        });
    });

    /**
     * acpi 연결/해제. AE 의 acpi 를 통째로 바꾼다(oneM2M UPDATE 는 보낸 속성만 바꾸므로
     * acpi 만 보낸다). 최대 7개 — lookup.acpi 가 varchar(200) 이다. 손입력은 없다:
     * 화면이 목록에서 고르고, 여기서는 각 ri 가 정말 ACP 인지 본다.
     */
    app.post('/api/acp/attach', function (req, res) {
        if (!require_write(res)) { return; }
        var b = req.body || {};
        if (typeof b.targetRi !== 'string' || b.targetRi.charAt(0) !== '/') {
            return res.status(400).json({ error: 'targetRi 가 필요하다' });
        }
        if (!Array.isArray(b.acpi) || b.acpi.length > 7) {
            return res.status(400).json({ error: 'acpi 는 0~7개의 배열이다 (컬럼 폭 200)' });
        }
        for (var i = 0; i < b.acpi.length; i++) {
            if (typeof b.acpi[i] !== 'string' || b.acpi[i].charAt(0) !== '/') {
                return res.status(400).json({ error: 'acpi 원소가 리소스 경로가 아니다: ' + String(b.acpi[i]).slice(0, 80) });
            }
        }
        with_connection(res, function (conn, done) {
            type_of(conn, b.targetRi, function (e, ty) {
                if (e) { done(); return res.status(500).json({ error: e }); }
                if (ty !== '2') { done(); return res.status(400).json({ error: '대상은 AE 여야 한다 (잠금 단위는 AE 하나다)' }); }
                var idx = 0;
                (function check() {
                    if (idx >= b.acpi.length) {
                        done();
                        return cse.update(b.targetRi, 'm2m:ae', { acpi: b.acpi }, function (r) {
                            if (!r.ok) { return cse_failure(res, r); }
                            res.json({ ok: true, status: r.status, rsc: r.rsc });
                        });
                    }
                    var ri = b.acpi[idx++];
                    type_of(conn, ri, function (e2, t) {
                        if (e2) { done(); return res.status(500).json({ error: e2 }); }
                        if (t !== '1') { done(); return res.status(400).json({ error: 'ACP 가 아니거나 없다: ' + ri }); }
                        check();
                    });
                }());
            });
        });
    });
```

- [ ] **Step 4: 시험**

Run: `node --test test/admin-api-acp-write.test.js` → PASS (3/3)
Run: `npm test` → 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add admin/api.js test/admin-api-acp-write.test.js
git commit -m "admin(api): ACP 신규 생성과 acpi 연결/해제 — AE 아래에만, CSE 요청 한 번

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 고아 탐지 작업 — 라이브 스캔 제거, 결과 파일, `/api/orphans/last`

**Files:**
- Create: `admin/data_dir.js`, `admin/orphan_scan.js`
- Modify: `admin/api.js` (`/api/orphans/summary`·`/api/orphans` 제거, `POST /api/jobs/orphan-scan`·`GET /api/orphans/last` 추가, `orphan-delete` 는 유지)
- Test: `test/admin-data-dir.test.js`, `test/admin-orphan-scan.test.js`

**Interfaces:**
- `data_dir.file(dataDir, sub, name)` → 절대 경로(디렉터리를 만든다). `data_dir.writeJson(path, obj)` (tmp + rename, `mobius/conf_write.writeAtomic` 재사용). `data_dir.listJson(dataDir, sub)` → `[{ name, path, mtime }]` 최신순, 깨진 파일은 `{ name, broken: true }`. `data_dir.keepLatest(dataDir, sub, n)` → 오래된 것부터 지운다.
- `orphan_scan.start(ctx, opts)` → `jobs.start` 의 반환(`Job|null`). `opts = { scanCap=200000, chunk=5000, sampleCap=1000 }`. 작업의 `targets` 는 조각 번호 배열(`scanCap/chunk` 개), 조각 하나가 `select_orphan_page` 를 `afterRi` 커서로 한 번 부른다(`limit: sampleCap, scanCap: chunk`). 다 훑었으면 남은 조각은 `skipped('끝')`. 끝나면(`onFinish`) `admin/data/orphans/<runId>.json` 을 쓰고 `keepLatest(…, 20)`.
- 결과 파일: `{ runId, startedAt, endedAt, cancelled, scanned, scanCapped, orphans: [{ ri, pi, ty, rn, ct }], sampleCap, sampleTruncated, lookupOnlyCin: { rows: [...], scanned, scanCapped, sampleTruncated } }`. 둘째 단계(`select_lookup_only_cin_page`)는 첫 단계와 같은 조각 규칙으로, 표본 상한은 같다.
- `POST /api/jobs/orphan-scan { scanCap?, sampleCap? }` → 202 `job.view()`. `GET /api/orphans/last` → 최신 결과 파일 내용 + `typeNames`, 없으면 `{ none: true }`.
- `types.ts`·화면은 Task 12.

- [ ] **Step 1: 실패하는 시험 — `test/admin-data-dir.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dd = require(path.join(__dirname, '..', 'admin', 'data_dir.js'));

test('writeJson 은 원자적으로 쓰고 listJson 은 최신순·깨진 파일 표시', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dd-'));
    const a = dd.file(root, 'orphans', 'a.json');
    dd.writeJson(a, { n: 1 });
    const b = dd.file(root, 'orphans', 'b.json');
    dd.writeJson(b, { n: 2 });
    fs.utimesSync(a, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    fs.writeFileSync(dd.file(root, 'orphans', 'c.json'), '{not json', 'utf8');
    const list = dd.listJson(root, 'orphans');
    assert.deepStrictEqual(list.map((x) => x.name), ['c.json', 'b.json', 'a.json']);
    assert.strictEqual(list[0].broken, true);
    assert.strictEqual(list[1].broken, undefined);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(b, 'utf8')), { n: 2 });
    assert.ok(!fs.readdirSync(path.join(root, 'orphans')).some((f) => /\.tmp/.test(f)), '임시 파일이 남지 않는다');
});

test('keepLatest 는 오래된 것부터 지운다', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dd-'));
    for (let i = 0; i < 5; i++) {
        const p = dd.file(root, 'x', 'r' + i + '.json');
        dd.writeJson(p, { i });
        fs.utimesSync(p, new Date(1000 * i + 1e12), new Date(1000 * i + 1e12));
    }
    dd.keepLatest(root, 'x', 2);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'x')).sort(), ['r3.json', 'r4.json']);
});
```

- [ ] **Step 2: 실패하는 시험 — `test/admin-orphan-scan.test.js`**

```js
'use strict';
// 고아 탐지는 화면에서 라이브로 돌리지 않는다(설계 §명시적 비목표, 배포 lookup 5,740만 행).
// 작업으로 조각내어 상한까지만 훑고 결과 파일을 남긴다. 화면은 마지막 결과만 본다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { boot } = require('./admin_app_helper');

function settled(h, id) {
    return (async function poll() {
        for (let i = 0; i < 500; i++) {
            const j = (await h.request('GET', '/api/jobs/' + id)).body;
            if (j.state !== 'running') { return j; }
            await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error('작업이 끝나지 않는다');
    }());
}

test('조각으로 훑어 표본을 파일에 남기고 /api/orphans/last 가 그것을 준다', async function () {
    // lookup 을 ri 키셋으로 읽는다. 1~30 번 행 중 부모가 없는 것은 10, 20 이다.
    const rows = [];
    for (let i = 1; i <= 30; i++) { rows.push({ ri: '/M/r' + String(i).padStart(3, '0'), pi: (i % 10 === 0) ? '/M/gone' + i : '/M', ty: '3', rn: 'r' + i, ct: '20260901T000000', lt: '', et: '' }); }
    const h = await boot({
        execute: function (sql, bindings) {
            if (/from `lookup`/.test(sql) && /`ri` > \?/.test(sql)) {
                const after = bindings[bindings.length - 2] !== undefined && typeof bindings[0] === 'string' ? bindings[0] : '';
                return rows.filter((r) => r.ri > after).slice(0, 1000);
            }
            if (/from `lookup`/.test(sql) && /in \(/.test(sql)) {
                // 부모 존재 확인: '/M' 만 있다.
                return bindings.filter((b) => b === '/M').map((ri) => ({ ri }));
            }
            if (/from `cin`/.test(sql)) { return []; }
            return [];
        }
    });
    try {
        await h.login();
        const start = await h.request('POST', '/api/jobs/orphan-scan', { scanCap: 100, sampleCap: 50 });
        assert.strictEqual(start.status, 202, JSON.stringify(start.body));
        const job = await settled(h, start.body.id);
        assert.strictEqual(job.state, 'done');
        assert.strictEqual(job.kind, 'orphan-scan');

        const last = await h.request('GET', '/api/orphans/last');
        assert.strictEqual(last.status, 200);
        assert.deepStrictEqual(last.body.orphans.map((o) => o.ri), ['/M/r010', '/M/r020', '/M/r030']);
        assert.strictEqual(last.body.scanCapped, false);
        assert.ok(last.body.scanned >= 30);
        assert.ok('lookupOnlyCin' in last.body);
        assert.strictEqual(last.body.typeNames['3'], 'cnt');
        assert.ok(fs.existsSync(path.join(h.dataDir, 'orphans', last.body.runId + '.json')));

        // 옛 라이브 경로는 없다.
        assert.strictEqual((await h.request('GET', '/api/orphans')).status, 404);
        assert.strictEqual((await h.request('GET', '/api/orphans/summary')).status, 404);
    } finally { await h.close(); }
});

test('결과가 없으면 none', async function () {
    const h = await boot({});
    try {
        await h.login();
        const r = await h.request('GET', '/api/orphans/last');
        assert.deepStrictEqual(r.body, { none: true });
    } finally { await h.close(); }
});
```

`select_orphan_page` 의 SQL 모양(키셋 `ri > ?` + 부모 `whereIn`)은 `mobius/sql_action.js:4408` 의 구현이 정한다. 구현자는 실제 bindings 위치를 `h.calls` 로 확인해 위 `execute` 의 after 추출을 맞춘다 — 시험이 코어의 SQL 형태를 가정하는 자리는 이 한 곳이다.

- [ ] **Step 3: 실패 확인**

Run: `node --test test/admin-data-dir.test.js test/admin-orphan-scan.test.js`
Expected: FAIL — `Cannot find module 'admin/data_dir.js'`

- [ ] **Step 4: `admin/data_dir.js`**

```js
'use strict';
/**
 * 콘솔의 결과 파일 자리 — admin/data/<하위>/. gitignore 다.
 *
 * 고아 탐지 결과(Task 9)와 종합 테스트 이력(2/2 계획)이 쓴다. 쓰기는 tmp + rename
 * 이라 반쯤 쓰인 파일이 목록에 올라오지 않고, 깨진 파일은 목록에서 broken 으로
 * 표시만 한다 — 조용히 건너뛰지 않는다.
 */
var fs = require('fs');
var path = require('path');
var conf_write = require('../mobius/conf_write');

exports.file = function (dataDir, sub, name) {
    var dir = path.join(dataDir, sub);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, name);
};

exports.writeJson = function (file, obj) {
    conf_write.writeAtomic(file, obj);
};

exports.listJson = function (dataDir, sub) {
    var dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir)
        .filter(function (f) { return /\.json$/.test(f); })
        .map(function (f) {
            var p = path.join(dir, f);
            var st = fs.statSync(p);
            var item = { name: f, path: p, mtime: st.mtimeMs };
            try { JSON.parse(fs.readFileSync(p, 'utf8')); }
            catch (e) { item.broken = true; }
            return item;
        })
        .sort(function (a, b) { return b.mtime - a.mtime; });
};

exports.readJson = function (file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
};

exports.keepLatest = function (dataDir, sub, n) {
    exports.listJson(dataDir, sub).slice(n).forEach(function (item) {
        try { fs.unlinkSync(item.path); } catch (e) { /* 이미 없으면 그만 */ }
    });
};
```

`mobius/conf_write.writeAtomic(file, obj)` 는 conf-cli 가 만든 것이다(`JSON.stringify(obj, null, 4)` 를 같은 디렉터리의 임시 파일에 쓰고 rename). 동기 함수다.

- [ ] **Step 5: `admin/orphan_scan.js`**

```js
'use strict';
/**
 * 고아 탐지 작업.
 *
 * 화면이 열릴 때 lookup 을 훑던 것(라이브 스캔)을 없앴다 — 설계의 명시적 비목표였고
 * 배포 lookup 은 5,740만 행이다. 대신 관리자가 "탐지 시작" 을 누르면 jobs.js 작업
 * 하나가 조각(chunk 행)으로 전진하며 scanCap 까지만 훑고, 표본(sampleCap)을 파일로
 * 남긴다. 화면은 마지막 파일만 본다.
 *
 * 두 단계다: (1) 부모가 lookup 에 없는 행(select_orphan_page) (2) cin 에 없는데
 * lookup 에 ty=4 로 남은 행(select_lookup_only_cin_page, 인수인계 §6). 둘 다 세지
 * 않는다 — 표본만.
 */
var crypto = require('crypto');
var data_dir = require('./data_dir');

exports.start = function (ctx, opts) {
    var o = opts || {};
    var scanCap = Math.min(parseInt(o.scanCap, 10) || 200000, 2000000);
    var chunk = Math.min(parseInt(o.chunk, 10) || 5000, 50000);
    var sampleCap = Math.min(parseInt(o.sampleCap, 10) || 1000, 5000);
    var chunks = Math.ceil(scanCap / chunk);

    var runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15) + '-' + crypto.randomBytes(2).toString('hex');
    var result = {
        runId: runId, startedAt: new Date().toISOString(), endedAt: null, cancelled: false,
        scanCap: scanCap, sampleCap: sampleCap,
        scanned: 0, scanCapped: false, orphans: [], sampleTruncated: false,
        lookupOnlyCin: { rows: [], scanned: 0, scanCapped: false, sampleTruncated: false }
    };
    // 단계마다 커서 하나. stage 1 이 끝나면(더 없음) stage 2 로 넘어간다.
    var stage = 1;
    var cursor = null;
    var exhausted = false;

    function borrow(fn) {
        ctx.db.getConnection(function (code, conn) {
            if (code !== '200') { return fn('database unavailable (' + code + ')', null, function () {}); }
            var released = false;
            fn(null, conn, function () { if (released) { return; } released = true; ctx.db.release(conn); });
        });
    }

    function worker(chunkNo, cb) {
        if (exhausted) { return cb('skipped', '끝'); }
        borrow(function (err, conn, done) {
            if (err) { done(); return cb('failed', err); }
            if (stage === 1) {
                ctx.db_sql.select_orphan_page(conn, { limit: sampleCap, afterRi: cursor, scanCap: chunk }, function (e, page) {
                    done();
                    if (e) { return cb('failed', String((page && page.message) || e)); }
                    result.scanned += page.scanned;
                    page.rows.forEach(function (r) {
                        if (result.orphans.length < sampleCap) { result.orphans.push({ ri: r.ri, pi: r.pi, ty: r.ty, rn: r.rn, ct: r.ct }); }
                        else { result.sampleTruncated = true; }
                    });
                    if (page.more && page.nextRi) { cursor = page.nextRi; }
                    else { stage = 2; cursor = null; }
                    if (result.scanned >= scanCap && stage === 1) { result.scanCapped = true; exhausted = true; }
                    cb('ok');
                });
                return;
            }
            ctx.db_sql.select_lookup_only_cin_page(conn, { limit: sampleCap, afterRi: cursor, scanCap: chunk }, function (e, page) {
                done();
                if (e) { return cb('failed', String((page && page.message) || e)); }
                var s = result.lookupOnlyCin;
                s.scanned += page.scanned;
                page.rows.forEach(function (r) {
                    if (s.rows.length < sampleCap) { s.rows.push({ ri: r.ri, pi: r.pi, rn: r.rn, ct: r.ct }); }
                    else { s.sampleTruncated = true; }
                });
                if (page.more && page.nextRi) { cursor = page.nextRi; } else { exhausted = true; }
                if (s.scanned >= scanCap) { s.scanCapped = true; exhausted = true; }
                cb('ok');
            });
        });
    }

    var targets = [];
    for (var i = 0; i < chunks * 2; i++) { targets.push(i); }   // 두 단계 × 조각 수

    return ctx.jobs.start({
        kind: 'orphan-scan',
        title: '고아 탐지 (상한 ' + scanCap.toLocaleString() + '행 · 표본 ' + sampleCap + ')',
        note: '세지 않고 표본만 뽑는다. 삭제는 결과에서 골라 따로 시작한다.',
        targets: targets,
        keyOf: function (t) { return 'chunk-' + t; },
        concurrency: 1,
        worker: worker,
        onFinish: function (job) {
            result.endedAt = new Date().toISOString();
            result.cancelled = job.state === 'cancelled';
            var file = data_dir.file(ctx.dataDir, 'orphans', runId + '.json');
            data_dir.writeJson(file, result);
            data_dir.keepLatest(ctx.dataDir, 'orphans', 20);
        }
    });
};
```

- [ ] **Step 6: `admin/api.js` 수정**

(가) `app.get('/api/orphans/summary', …)` 와 `app.get('/api/orphans', …)` 두 핸들러를 **지운다**(주석 블록 포함).

(나) 그 자리에:

```js
    // ── 고아 (배치 결과) ───────────────────────────────────────────────────
    //
    // 라이브 스캔은 없다. 탐지는 POST /api/jobs/orphan-scan 이 작업으로 돌리고,
    // 화면은 마지막 결과 파일(admin/data/orphans/)만 본다. admin/orphan_scan.js.
    var orphan_scan = require('./orphan_scan');
    var data_dir = require('./data_dir');

    app.post('/api/jobs/orphan-scan', function (req, res) {
        var b = req.body || {};
        var job = orphan_scan.start(ctx, { scanCap: b.scanCap, sampleCap: b.sampleCap });
        if (!job) {
            return res.status(409).json({ error: '이미 도는 작업이 있다. 끝나거나 취소된 뒤에 시작한다.', active: jobs.active().view() });
        }
        res.status(202).json(job.view());
    });

    app.get('/api/orphans/last', function (req, res) {
        var list = data_dir.listJson(ctx.dataDir, 'orphans').filter(function (x) { return !x.broken; });
        if (!list.length) { return res.json({ none: true }); }
        var r = data_dir.readJson(list[0].path);
        r.typeNames = responder.typeRsrc;
        res.json(r);
    });
```

`/api/jobs/orphan-delete` 는 그대로 둔다(결과 화면에서 고른 ri 를 받는다).

- [ ] **Step 7: 시험**

Run: `node --test test/admin-data-dir.test.js test/admin-orphan-scan.test.js` → PASS
Run: `npm test` → 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add admin/data_dir.js admin/orphan_scan.js admin/api.js test/admin-data-dir.test.js test/admin-orphan-scan.test.js
git commit -m "admin: 고아 탐지를 작업으로 — 라이브 스캔 제거, 조각·상한·표본, 결과 파일과 /api/orphans/last

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 프런트 과제 공통

- 작업 디렉터리 `admin/web`. 검증은 `npm run build`(= `vue-tsc --noEmit && vite build`) 통과다. 실행 확인은 `npm run dev` 로 5173 에 띄우고 콘솔 백엔드(7580)에 프록시한다 — 사람이 보는 단계이고 과제의 필수 단계는 빌드다.
- 새 파일도 기존 뷰의 관례를 따른다: `<script setup lang="ts">`, `ref/computed/onMounted`, 스타일은 `scoped` 와 `var(--panel)` 류 토큰(`style.css`), 오류는 `error` ref 에 문자열로.
- `api.ts` 의 `get/post` 래퍼를 쓴다. 새 함수는 이 계획의 각 과제가 적는다.
- 커밋은 `admin/web` 의 변경만 묶는다(`dist/` 는 gitignore).

### Task 10: 셸 — Vue Router, 네 묶음 내비, 관측 화면(작업·통계)

**Files:**
- Modify: `admin/web/package.json`(`vue-router` 추가), `admin/web/src/main.ts`, `admin/web/src/App.vue`, `admin/web/src/api.ts`, `admin/web/src/types.ts`
- Create: `admin/web/src/router.ts`, `admin/web/src/views/JobsView.vue`, `admin/web/src/views/StatsView.vue`, `admin/web/src/components/BarChart.vue`

**Interfaces:**
- 라우트 이름과 경로(hash): `judge-expired` `/judge/expired` · `judge-orphans` `/judge/orphans` · `judge-acp-problems` `/judge/acp/problems` · `judge-acp-list` `/judge/acp` · `judge-acp-edit` `/judge/acp/edit/:ri` · `judge-acp-create` `/judge/acp/create` · `judge-acp-attach` `/judge/acp/attach/:ri?` · `judge-acp-sim` `/judge/acp/simulate/:ri?` · `subs-endpoints` `/subs` · `observe-stats` `/observe/stats` · `observe-jobs` `/observe/jobs` · `verify-selftest` `/verify/selftest`(2/2 가 채운다 — 이번에는 "준비 중" 자리표시 뷰). `ri` 파라미터는 `encodeURIComponent` 로 넣고 `decodeURIComponent` 로 꺼낸다.
- `App.vue` 가 `session` 을 한 번 읽어 `provide('session', sessionRef)` 로 내려준다. 뷰는 `inject` 대신 props 로 받던 `write` 를 계속 props 로 받는다(라우터가 `props` 함수로 넘긴다) — 기존 뷰를 덜 고치기 위해서다.
- `types.ts`: `AcpConfig` 에 `discoveryFilter: string` 추가. `ExpiryPolicy { autoDeletedTypes: number[]; etExtendableTypes: number[]; undeletableTypes: number[]; typeNames: Record<string,string> }`. `HitRow { ct: string; http: number; mqtt: number; coap: number; ws: number }`. `JobKind` 에 `'orphan-scan'` 추가.
- `api.ts`: `expiredPolicy()`, `statsHit()`, `statsTotalAe()`, `statsTotalCbs()`, `jobList()`.
- `BarChart.vue` props: `{ values: { label: string; value: number }[]; height?: number; unit?: string }` — 인라인 SVG 세로 막대, 값 0 도 막대 자리 유지, 마지막 막대 강조, 축 눈금 3개.

- [ ] **Step 1: 의존성**

```bash
cd admin/web && npm install vue-router@^4.5.0
```

`package.json` 의 `dependencies` 에 `"vue-router": "^4.5.0"` 이 들어간다. `package-lock.json` 도 같이 커밋한다.

- [ ] **Step 2: `src/router.ts`**

```ts
import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import ExpiredView from './views/ExpiredView.vue'
import OrphanView from './views/OrphanView.vue'
import AcpProblemsView from './views/AcpProblemsView.vue'
import AcpListView from './views/AcpListView.vue'
import AcpSimulateView from './views/AcpSimulateView.vue'
import AcpEditView from './views/AcpEditView.vue'
import AcpCreateView from './views/AcpCreateView.vue'
import AcpAttachView from './views/AcpAttachView.vue'
import SubsView from './views/SubsView.vue'
import StatsView from './views/StatsView.vue'
import JobsView from './views/JobsView.vue'
import SelfTestPlaceholderView from './views/SelfTestPlaceholderView.vue'

/** 왼쪽 내비의 묶음. 순서가 곧 화면 순서다. */
export const GROUPS: { id: string; label: string }[] = [
  { id: 'judge', label: '판단' },
  { id: 'subs', label: '구독' },
  { id: 'observe', label: '관측' },
  { id: 'verify', label: '검증' },
]

/** 내비에 보이는 화면. 편집·생성·연결처럼 목록에서 들어가는 화면은 여기 없다. */
export const NAV: { name: string; group: string; label: string }[] = [
  { name: 'judge-expired', group: 'judge', label: '만료' },
  { name: 'judge-orphans', group: 'judge', label: '고아' },
  { name: 'judge-acp-problems', group: 'judge', label: 'ACP 문제' },
  { name: 'judge-acp-list', group: 'judge', label: 'ACP 목록' },
  { name: 'judge-acp-sim', group: 'judge', label: '시뮬레이터' },
  { name: 'subs-endpoints', group: 'subs', label: '엔드포인트' },
  { name: 'observe-stats', group: 'observe', label: '통계' },
  { name: 'observe-jobs', group: 'observe', label: '작업' },
  { name: 'verify-selftest', group: 'verify', label: '종합 테스트' },
]

const ri = (r: { params: { ri?: string | string[] } }) => {
  const v = Array.isArray(r.params.ri) ? r.params.ri[0] : r.params.ri
  return v ? decodeURIComponent(v) : null
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/judge/expired' },
  { path: '/judge/expired', name: 'judge-expired', component: ExpiredView },
  { path: '/judge/orphans', name: 'judge-orphans', component: OrphanView },
  { path: '/judge/acp/problems', name: 'judge-acp-problems', component: AcpProblemsView },
  { path: '/judge/acp', name: 'judge-acp-list', component: AcpListView, props: (r) => ({ selected: r.query.ri ? String(r.query.ri) : null }) },
  { path: '/judge/acp/edit/:ri', name: 'judge-acp-edit', component: AcpEditView, props: (r) => ({ ri: ri(r) }) },
  { path: '/judge/acp/create', name: 'judge-acp-create', component: AcpCreateView },
  { path: '/judge/acp/attach/:ri?', name: 'judge-acp-attach', component: AcpAttachView, props: (r) => ({ initialRi: ri(r) }) },
  { path: '/judge/acp/simulate/:ri?', name: 'judge-acp-sim', component: AcpSimulateView, props: (r) => ({ initialRi: ri(r) }) },
  { path: '/subs', name: 'subs-endpoints', component: SubsView },
  { path: '/observe/stats', name: 'observe-stats', component: StatsView },
  { path: '/observe/jobs', name: 'observe-jobs', component: JobsView },
  { path: '/verify/selftest', name: 'verify-selftest', component: SelfTestPlaceholderView },
  { path: '/:pathMatch(.*)*', redirect: '/judge/expired' },
]

export const router = createRouter({ history: createWebHashHistory(), routes })

/** ri 를 라우트 파라미터로. 슬래시가 들어 있으므로 반드시 인코딩한다. */
export function riParam(ri: string): string {
  return encodeURIComponent(ri)
}
```

`AcpCreateView`·`AcpAttachView`·`SubsView` 는 Task 13·14 가 만든다. 이 과제에서는 **빈 자리표시 컴포넌트**로 만들어 빌드를 통과시킨다(각 파일에 `<template><section><h2>제목</h2><p class="muted">Task N 이 채운다.</p></section></template>`). `SelfTestPlaceholderView.vue` 도 같은 꼴로 만들고 2/2 계획이 바꾼다:

```vue
<template>
  <section>
    <h2>종합 테스트</h2>
    <p class="lead">붙어 있는 Mobius 를 표준 케이스로 검증하는 화면입니다. 준비 중입니다.</p>
  </section>
</template>
<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
.lead { margin: 0; color: var(--muted); font-size: 1.02rem; }
</style>
```

- [ ] **Step 3: `src/main.ts`**

```ts
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './style.css'

createApp(App).use(router).mount('#app')
```

- [ ] **Step 4: `types.ts` · `api.ts` 추가**

`types.ts` — `AcpConfig` 에 한 줄, 새 타입 셋, `JobKind` 확장:

```ts
export interface AcpConfig {
  observeMode: string
  attachPolicy: string
  defaultPolicy: string
  audit: string
  denyLog: string
  /** 'off' 면 잠근 컨테이너의 경로가 상위 discovery 에 그대로 나온다 — 시뮬레이터가 보호를 과장한다. */
  discoveryFilter: string
}

/** 코어가 정하는 만료 정책. 화면은 이것만 본다 — 상수를 두지 않는다. */
export interface ExpiryPolicy {
  autoDeletedTypes: number[]
  etExtendableTypes: number[]
  undeletableTypes: number[]
  typeNames: Record<string, string>
}

export interface HitRow { ct: string; http: number; mqtt: number; coap: number; ws: number }

export type JobKind = 'expired-delete' | 'expired-extend' | 'orphan-delete' | 'orphan-scan' | 'selftest'
```

`api.ts` 끝에:

```ts
// ── 정책·관측 ──────────────────────────────────────────────────────────────

export function expiredPolicy() {
  return get<ExpiryPolicy>('/api/expired/policy')
}

export function statsHit() {
  return get<{ asOf: string; rows: HitRow[] }>('/api/stats/hit')
}
export function statsTotalAe() {
  return get<{ total: number }>('/api/stats/total-ae')
}
export function statsTotalCbs() {
  return get<{ total: number }>('/api/stats/total-cbs')
}

export function jobList() {
  return get<{ jobs: Job[] }>('/api/jobs')
}
```

(`import type` 목록에 `ExpiryPolicy`·`HitRow` 를 더한다.)

- [ ] **Step 5: `components/BarChart.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'

/**
 * 인라인 SVG 세로 막대. 라이브러리를 들이지 않는다 — 통계 화면과 종합 테스트의
 * p50/p95 막대가 전부다. 마지막 막대(오늘·최신)를 강조하고, 값 0 도 자리를 지킨다.
 */
const props = withDefaults(
  defineProps<{ values: { label: string; value: number }[]; height?: number; unit?: string }>(),
  { height: 160, unit: '' },
)

const W = 640
const PAD = { l: 44, r: 8, t: 10, b: 26 }
const max = computed(() => Math.max(1, ...props.values.map((v) => v.value)))
const innerW = computed(() => W - PAD.l - PAD.r)
const innerH = computed(() => props.height - PAD.t - PAD.b)
const slot = computed(() => innerW.value / Math.max(1, props.values.length))
const bars = computed(() =>
  props.values.map((v, i) => {
    const h = (v.value / max.value) * innerH.value
    return {
      x: PAD.l + i * slot.value + slot.value * 0.15,
      w: slot.value * 0.7,
      y: PAD.t + innerH.value - h,
      h,
      label: v.label,
      value: v.value,
      last: i === props.values.length - 1,
    }
  }),
)
const ticks = computed(() => [0, 0.5, 1].map((f) => ({ y: PAD.t + innerH.value * (1 - f), v: Math.round(max.value * f) })))
const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))
</script>

<template>
  <svg class="chart" :viewBox="`0 0 ${W} ${height}`" role="img" :aria-label="`막대 ${values.length}개`">
    <g v-for="t in ticks" :key="t.v">
      <line :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y" class="grid" />
      <text :x="PAD.l - 6" :y="t.y + 4" class="tick" text-anchor="end">{{ fmt(t.v) }}{{ unit }}</text>
    </g>
    <g v-for="b in bars" :key="b.label">
      <rect :x="b.x" :y="b.y" :width="b.w" :height="Math.max(b.h, 1)" :class="['bar', { last: b.last }]">
        <title>{{ b.label }}: {{ b.value.toLocaleString() }}{{ unit }}</title>
      </rect>
      <text v-if="values.length <= 16 || b.last" :x="b.x + b.w / 2" :y="height - 8" class="lbl" text-anchor="middle">
        {{ b.label }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.chart { width: 100%; height: auto; display: block; }
.grid { stroke: var(--border-soft); stroke-width: 1; }
.tick, .lbl { fill: var(--muted); font-size: 11px; font-family: var(--mono); }
.bar { fill: var(--accent); opacity: 0.75; }
.bar.last { opacity: 1; fill: var(--accent-strong); }
</style>
```

- [ ] **Step 6: `views/JobsView.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { jobList, cancelJob } from '../api'
import type { Job } from '../types'
import JobPanel from '../components/JobPanel.vue'

/**
 * 최근 작업. 메모리에만 있어 콘솔을 재시작하면 사라진다 — 화면에 그렇게 적는다.
 * 도는 작업이 있으면 1초마다 다시 읽는다.
 */
const jobs = ref<Job[]>([])
const error = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

async function load() {
  try {
    jobs.value = (await jobList()).jobs
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  if (timer !== null) clearTimeout(timer)
  timer = jobs.value.some((j) => j.state === 'running') ? setTimeout(load, 1000) : null
}

async function cancel(j: Job) {
  try {
    await cancelJob(j.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

const KIND_LABEL: Record<string, string> = {
  'expired-delete': '만료 삭제',
  'expired-extend': 'et 연장',
  'orphan-delete': '고아 삭제',
  'orphan-scan': '고아 탐지',
  selftest: '종합 테스트',
}

onMounted(load)
onUnmounted(() => { if (timer !== null) clearTimeout(timer) })
</script>

<template>
  <section>
    <h2>작업</h2>
    <p class="lead">
      콘솔이 돌린 일괄 작업입니다. 한 번에 하나만 돕니다. 기록은 메모리에만 있어
      콘솔을 재시작하면 사라집니다 — 이미 지운 것이 되살아나지는 않습니다.
    </p>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!jobs.length" class="empty">작업이 없습니다.</p>
    <div v-for="j in jobs" :key="j.id" class="row">
      <div class="kind">{{ KIND_LABEL[j.kind] ?? j.kind }}</div>
      <JobPanel :job="j" @cancel="cancel(j)" @dismiss="() => {}" />
    </div>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 74ch; }
.err { color: var(--danger); }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; }
.row { margin-bottom: 1rem; }
.kind { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; margin-bottom: 0.3rem; }
</style>
```

`JobPanel` 의 `dismiss` 는 화면에서 패널을 닫는 용도라 여기서는 아무것도 하지 않는다(목록이 곧 기록이다).

- [ ] **Step 7: `views/StatsView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { statsHit, statsTotalAe, statsTotalCbs } from '../api'
import type { HitRow } from '../types'
import BarChart from '../components/BarChart.vue'

/**
 * 코어의 /hit · /total_ae · /total_cbs 가 보여 주던 것. 그 경로는 인증 없이 외부에
 * 열려 있어 코어에서 걷어냈고(인수인계 §7), 이제 세션 뒤의 이 화면이 유일한 창이다.
 */
const rows = ref<HitRow[]>([])
const asOf = ref('')
const totalAe = ref<number | null>(null)
const totalCbs = ref<number | null>(null)
const error = ref('')
const loading = ref(false)

const DAYS = 30
const recent = computed(() => {
  const byDay = new Map(rows.value.map((r) => [r.ct, r]))
  const out: { label: string; value: number }[] = []
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const key = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    const r = byDay.get(key)
    out.push({ label: key.slice(4, 6) + '/' + key.slice(6, 8), value: r ? (r.http || 0) + (r.mqtt || 0) + (r.coap || 0) + (r.ws || 0) : 0 })
  }
  return out
})

const table = computed(() => [...rows.value].sort((a, b) => (a.ct < b.ct ? 1 : -1)).slice(0, DAYS))

function gb(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB'
  return n.toLocaleString() + ' B'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [h, a, c] = await Promise.all([statsHit(), statsTotalAe(), statsTotalCbs()])
    rows.value = h.rows
    asOf.value = h.asOf
    totalAe.value = a.total
    totalCbs.value = c.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <section>
    <h2>통계</h2>
    <p class="lead">
      일별 호출 건수(<code>hit</code> 표)와 AE 수·CIN 바이트 총합입니다. 예전에는
      <code>/hit</code>·<code>/total_ae</code>·<code>/total_cbs</code> 가 인증 없이 내보내던 값입니다.
    </p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="tiles">
      <div class="tile"><div class="k">AE</div><div class="v">{{ totalAe === null ? '—' : totalAe.toLocaleString() }}</div><div class="s">등록된 AE 수</div></div>
      <div class="tile"><div class="k">CIN 바이트 총합</div><div class="v">{{ gb(totalCbs) }}</div><div class="s">컨테이너 cbs 의 합</div></div>
      <div class="tile"><div class="k">오늘 호출</div><div class="v">{{ recent.length ? recent[recent.length - 1].value.toLocaleString() : '—' }}</div><div class="s">UTC 기준</div></div>
    </div>

    <div class="panel">
      <h3>최근 {{ DAYS }}일 호출</h3>
      <BarChart :values="recent" :height="180" />
    </div>

    <div v-if="table.length" class="table-wrap">
      <table>
        <thead><tr><th>날짜 (UTC)</th><th>HTTP</th><th>MQTT</th><th>CoAP</th><th>WS</th></tr></thead>
        <tbody>
          <tr v-for="r in table" :key="r.ct">
            <td class="mono">{{ r.ct }}</td>
            <td class="num">{{ (r.http || 0).toLocaleString() }}</td>
            <td class="num">{{ (r.mqtt || 0).toLocaleString() }}</td>
            <td class="num">{{ (r.coap || 0).toLocaleString() }}</td>
            <td class="num">{{ (r.ws || 0).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="footer">
      <button :disabled="loading" @click="load">{{ loading ? '읽는 중…' : '다시 읽기' }}</button>
      <span class="muted">{{ asOf }}</span>
    </div>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 74ch; }
.err { color: var(--danger); }
.muted { color: var(--muted); font-size: 0.92rem; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.9rem; }
.tile { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; }
.tile .k { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
.tile .v { font-size: 2.1rem; font-weight: 650; line-height: 1.25; letter-spacing: -0.02em; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.tile .s { font-size: 0.88rem; color: var(--muted); }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; margin: 1.2rem 0; }
.table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: auto; max-height: 50vh; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.footer { display: flex; align-items: center; gap: 1rem; padding: 1rem 0; }
</style>
```

- [ ] **Step 8: `App.vue` — 셸을 라우터로**

`<script setup>` 의 뷰 import 와 `TABS`·`tab`·`focusRi`·`openAcp/simulateRi/editRi` 를 지우고 아래로 바꾼다. 로그인·`probe`·`write`·`acpCfg` 는 그대로다.

```ts
import { ref, onMounted, provide } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { session, login, logout, AuthError } from './api'
import type { AcpConfig, WriteInfo } from './types'
import { GROUPS, NAV } from './router'

const route = useRoute()
// … authed / backend / password / loginError / busy / OFFLINE / write / acpCfg / probe / doLogin / doLogout 그대로 …
const target = ref<string | null>(null)   // probe 에서 write.target 을 넣는다

provide('write', write)
provide('acpCfg', acpCfg)
```

`probe()` 안에 `target.value = s.write?.target ?? null` 한 줄을 더한다.

템플릿의 `<header>…</header>` 와 `<main>…</main>` 을 다음으로 바꾼다(로그인 폼과 관찰 모드 `alertbar` 는 그대로):

```vue
    <div class="frame">
      <aside>
        <div class="brand">
          <strong>Mobius 관리 콘솔</strong>
          <span class="muted small">{{ backend }} · {{ target ?? '조회 전용' }}</span>
        </div>
        <nav>
          <template v-for="g in GROUPS" :key="g.id">
            <div class="group">{{ g.label }}</div>
            <RouterLink
              v-for="n in NAV.filter((x) => x.group === g.id)"
              :key="n.name"
              :to="{ name: n.name }"
              class="tab"
              :class="{ on: route.name === n.name || String(route.name ?? '').startsWith(n.name + '-') || (n.name === 'judge-acp-list' && ['judge-acp-edit', 'judge-acp-create', 'judge-acp-attach'].includes(String(route.name))) }"
            >
              {{ n.label }}
            </RouterLink>
          </template>
        </nav>
        <div class="foot">
          <span v-if="!write.enabled" class="pill readonly">조회 전용</span>
          <span v-else-if="write.superuser" class="pill super" :title="`쓰기 대상 ${write.target}`">쓰기 · superuser</span>
          <span v-else class="pill write" :title="`쓰기 대상 ${write.target}`">쓰기</span>
          <button @click="doLogout">로그아웃</button>
        </div>
      </aside>

      <div class="content">
        <div v-if="acpCfg && acpCfg.observeMode === 'observe'" class="alertbar">
          <!-- 기존 alertbar 본문 그대로 -->
        </div>
        <main>
          <RouterView :write="write" :acp="acpCfg" />
        </main>
      </div>
    </div>
```

`RouterView` 에 넘긴 `write`·`acp` 는 각 뷰가 `defineProps` 로 선언한 것만 받는다(선언하지 않으면 attribute 로 떨어지고 무해하다). `AcpSimulateView` 는 Task 11 에서 `acp` prop 을 선언한다.

스타일: `header`·`nav`·`.tab`·`.group`·`.spacer`·`main` 규칙을 지우고 다음을 넣는다(`.login*`·`.alertbar`·`.pill*` 는 그대로).

```css
.frame { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
aside {
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 1rem 0.9rem;
  display: flex; flex-direction: column; gap: 0.6rem;
  position: sticky; top: 0; height: 100vh; overflow: auto;
}
.brand { display: grid; gap: 0.15rem; padding: 0.2rem 0.4rem 0.8rem; }
.brand strong { font-size: 1.05rem; letter-spacing: -0.01em; color: var(--text-strong); }
.small { font-size: 0.8rem; }
.muted { color: var(--muted); }
nav { display: grid; gap: 0.15rem; }
.group {
  font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em;
  font-weight: 700; margin: 0.9rem 0.4rem 0.25rem;
}
.tab {
  display: block; text-decoration: none; color: var(--muted);
  padding: 0.45rem 0.7rem; border-radius: 8px; font-size: 0.95rem; border: 1px solid transparent;
}
.tab:hover { background: var(--accent-wash); color: var(--accent-strong); }
.tab.on { background: var(--accent-wash); border-color: var(--accent); color: var(--accent-strong); font-weight: 600; }
.foot { margin-top: auto; display: grid; gap: 0.5rem; padding: 0.6rem 0.4rem 0; }
.content { min-width: 0; }
main { padding: 1.6rem 1.6rem 3rem; max-width: 1500px; }
@media (max-width: 900px) {
  .frame { grid-template-columns: 1fr; }
  aside { position: static; height: auto; }
}
```

- [ ] **Step 9: 빌드**

Run: `cd admin/web && npm run build`
Expected: `vue-tsc` 오류 0, `dist/` 생성. 기존 뷰가 `focusRi`·emit(`open`/`simulate`/`edit`) 으로 화면을 옮기던 부분은 Task 11·13 이 라우터로 바꾼다 — 이 과제에서는 emit 이 아무 데도 연결되지 않아도 빌드는 통과한다(`RouterView` 가 알 수 없는 이벤트를 무시한다).

- [ ] **Step 10: 커밋**

```bash
git add admin/web/package.json admin/web/package-lock.json admin/web/src
git commit -m "admin(web): Vue Router 셸 — 네 묶음 내비, 관측(작업·통계) 화면, 인라인 SVG 막대

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 위반 수정 — 만료 화면 정책, ACP 문제 화면 더 보기, 시뮬레이터 경고

**Files:**
- Modify: `admin/web/src/views/ExpiredView.vue`, `admin/web/src/views/AcpProblemsView.vue`, `admin/web/src/views/AcpSimulateView.vue`, `admin/web/src/types.ts`(정책 상수 삭제), `admin/web/src/api.ts`(`acpLintRefs` 는 그대로; `acpLint` 는 이미 `afterRi` 를 받는다)

**Interfaces:**
- `types.ts` 에서 `NEVER_AUTO_DELETED`·`AUTO_DELETED_RISKY`·`ET_EXTENDABLE` 을 **지운다**. `UNDELETABLE` 은 남긴다(구조).
- `ExpiredView` 는 `expiredPolicy()` 를 처음에 읽어 `fate()`·`extendable` 를 그것으로 판단한다.
- `AcpProblemsView` 는 본문 검사(`acpLint`)를 `more/nextRi` 로 이어 붙인다. 참조 검사(`acpLintRefs`)는 서버가 끝까지 돌리므로 그대로다.
- `AcpSimulateView` 는 `acp: AcpConfig | null` prop 을 받아 `discoveryFilter === 'off'` 면 상단 경고를 띄운다.

- [ ] **Step 1: `types.ts`**

```ts
/** 삭제할 수 없는 타입 — CSEBase 는 트리의 뿌리다. 정책이 아니라 구조라 여기 둔다. */
export const UNDELETABLE = new Set([5])
```

만 남기고 `NEVER_AUTO_DELETED`·`AUTO_DELETED_RISKY`·`ET_EXTENDABLE` 세 선언(주석 포함)을 지운다. 빌드가 그것을 쓰는 자리를 전부 잡아 준다 — `ExpiredView.vue` 뿐이어야 한다.

- [ ] **Step 2: `ExpiredView.vue`**

import 줄을 바꾼다:

```ts
import { expiredSummary, expiredPage, expiredPolicy, fmtTime, daysSince, etAfterDays, startExpiredDelete, startExpiredExtend } from '../api'
import { UNDELETABLE } from '../types'
import type { ExpiredRow, ExpiredSummary, ExpiryPolicy, WriteInfo } from '../types'
```

상태에 `const policy = ref<ExpiryPolicy | null>(null)` 을 더하고, `extendable` 과 `fate` 를 바꾼다:

```ts
/** 선택 중 et 를 실제로 늘릴 수 있는 것들 — 코어가 정한다(expiry_policy.etExtendableTypes). */
const extendable = computed(() => {
  const ok = new Set(policy.value?.etExtendableTypes ?? [])
  return selectedList.value.filter((ri) => {
    const ty = byRi.value.get(ri)?.ty
    return ty !== undefined && ok.has(ty)
  })
})

/** 이 타입이 자동 정리에서 어떻게 다뤄지는지 — 코어의 만료 정책에서 받는다. */
function fate(ty: number): { text: string; cls: string } {
  if (!policy.value) return { text: '…', cls: 'manual' }
  if (policy.value.autoDeletedTypes.includes(ty)) return { text: '만료 시 자동 삭제', cls: 'risky' }
  return { text: '자동 삭제 안 됨 — 수동 정리', cls: 'never' }
}
```

`onMounted` 를:

```ts
onMounted(async () => {
  void runner.attach()
  try {
    policy.value = await expiredPolicy()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  await loadSummary()
  await loadFirst()
})
```

연장 확인 대화상자의 문구 `CIN 은 oneM2M 상 수정할 수 없습니다.` 를 `et 를 수정할 수 없는 타입입니다(코어의 만료 정책 기준).` 로 바꾼다. `lead` 문단의 "만료 스윕은 주기 실행이 걸려 있지 않아" 는 사실이므로 둔다.

- [ ] **Step 3: `AcpProblemsView.vue`**

본문 검사를 이어 붙인다. `<script setup>` 에서 `lint` 를 누적 구조로 바꾼다:

```ts
const lint = ref<AcpLintPage | null>(null)
const lintMore = ref(false)
const lintNext = ref<string | null>(null)
const loadingMore = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [a, b] = await Promise.all([acpLint({ limit: 200 }), acpLintRefs({ maxRefs: 500 })])
    lint.value = a
    lintMore.value = a.more
    lintNext.value = a.nextRi
    refs.value = b
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 200개에서 조용히 잘리던 것(목적 문서 §0층 위반 3). 서버의 more/nextRi 를 이어 붙인다. */
async function loadMoreLint() {
  if (!lintMore.value || loadingMore.value || !lint.value) return
  loadingMore.value = true
  try {
    const p = await acpLint({ limit: 200, afterRi: lintNext.value })
    lint.value = {
      rows: lint.value.rows.concat(p.rows),
      more: p.more,
      nextRi: p.nextRi,
      counts: {
        error: lint.value.counts.error + p.counts.error,
        warn: lint.value.counts.warn + p.counts.warn,
        clean: lint.value.counts.clean + p.counts.clean,
      },
    }
    lintMore.value = p.more
    lintNext.value = p.nextRi
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingMore.value = false
  }
}
```

템플릿의 "ACP 본문" 표 아래(`</div>` 뒤, `</template>` 앞)에:

```vue
      <div class="more">
        <button v-if="lintMore" :disabled="loadingMore" @click="loadMoreLint">
          {{ loadingMore ? '불러오는 중…' : '더 보기 (다음 200건)' }}
        </button>
        <span class="muted">{{ lint?.rows.length ?? 0 }}건 검사<template v-if="lintMore"> · 더 있음</template></span>
      </div>
```

"정상 ACP" 타일의 설명을 `본문에 문제가 없습니다` 에서 `본문에 문제가 없습니다 (지금까지 검사한 것 중)` 로. `.more { display: flex; align-items: center; gap: 1rem; padding: 0.6rem 0; }` 를 스타일에 더한다. `emit('open', r.ri)` 는 라우터 이동으로 바꾼다:

```ts
import { useRouter } from 'vue-router'
const router = useRouter()
function open(ri: string) { router.push({ name: 'judge-acp-list', query: { ri } }) }
```

템플릿의 `@click="emit('open', r.ri)"` → `@click="open(r.ri)"`. `defineEmits` 줄은 지운다.

- [ ] **Step 4: `AcpSimulateView.vue`**

`defineProps` 에 `acp?: AcpConfig | null` 을 더한다(기존 `initialRi` 옆). `import type` 에 `AcpConfig` 를 더한다. 템플릿의 `<h2>` 바로 아래에:

```vue
    <div v-if="acp && acp.discoveryFilter === 'off'" class="banner danger">
      <strong><code>acpDiscoveryFilter</code> 가 <code>off</code> 입니다.</strong>
      잠근 컨테이너의 경로가 상위 discovery 결과에 그대로 나옵니다 — 아래 판정에서
      DISCOVERY 가 “거부” 로 나와도 실제로는 경로가 보입니다. 시뮬레이션이 보호를 과장합니다.
      <em>(콘솔이 읽은 설정값 기준입니다.)</em>
    </div>
```

스타일이 없으면 `.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); padding: 0.8rem 1rem; border-radius: 0 8px 8px 0; margin: 0.8rem 0; font-size: 0.95rem; max-width: 88ch; }` 를 더한다(다른 뷰와 같은 모양).

- [ ] **Step 5: 빌드와 확인**

Run: `cd admin/web && npm run build` → 통과. `grep -rn "AUTO_DELETED_RISKY\|ET_EXTENDABLE\|NEVER_AUTO_DELETED" admin/web/src` → 0건.

- [ ] **Step 6: 커밋**

```bash
git add admin/web/src
git commit -m "admin(web): 위반 수정 — 만료 정책은 코어에서, ACP 문제 더 보기, discoveryFilter 경고

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 고아 화면 — 탐지 작업과 마지막 결과

**Files:**
- Modify: `admin/web/src/views/OrphanView.vue`, `admin/web/src/api.ts`, `admin/web/src/types.ts`

**Interfaces:**
- `api.ts`: `startOrphanScan(opts?: { scanCap?: number; sampleCap?: number })` → `post<Job>('/api/jobs/orphan-scan', opts)`, `orphanLast()` → `get<OrphanScanResult | { none: true }>('/api/orphans/last')`. `orphanSummary`·`orphanPage` 는 **지운다**.
- `types.ts`: `OrphanScanResult { runId; startedAt; endedAt: string | null; cancelled: boolean; scanCap; sampleCap; scanned; scanCapped; orphans: OrphanRow[]; sampleTruncated; lookupOnlyCin: { rows: { ri; pi; rn; ct }[]; scanned; scanCapped; sampleTruncated }; typeNames }`. `OrphanPage`·`OrphanSummary` 는 지운다.

- [ ] **Step 1: `types.ts` · `api.ts`**

`OrphanPage`·`OrphanSummary` 인터페이스를 지우고:

```ts
/** 고아 탐지 작업 하나의 결과 파일. 세지 않는다 — 표본이다. */
export interface OrphanScanResult {
  runId: string
  startedAt: string
  endedAt: string | null
  cancelled: boolean
  scanCap: number
  sampleCap: number
  scanned: number
  scanCapped: boolean
  orphans: OrphanRow[]
  sampleTruncated: boolean
  lookupOnlyCin: { rows: { ri: string; pi: string; rn: string; ct: string }[]; scanned: number; scanCapped: boolean; sampleTruncated: boolean }
  typeNames: Record<string, string>
}
```

`api.ts` 에서 `orphanSummary`·`orphanPage` 를 지우고:

```ts
export function startOrphanScan(opts: { scanCap?: number; sampleCap?: number } = {}) {
  return post<Job>('/api/jobs/orphan-scan', opts)
}
export function orphanLast() {
  return get<OrphanScanResult | { none: true }>('/api/orphans/last')
}
```

- [ ] **Step 2: `OrphanView.vue` 를 다시 쓴다**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { orphanLast, startOrphanScan, startOrphanDelete, fmtTime } from '../api'
import type { OrphanRow, OrphanScanResult, WriteInfo } from '../types'
import { useJobRunner } from '../job'
import JobPanel from '../components/JobPanel.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

/**
 * 고아 리소스 — 라이브 스캔은 없다. "탐지 시작" 이 작업을 돌리고, 화면은 마지막
 * 결과 파일만 보여 준다(배포 lookup 5,740만 행 — 설계의 명시적 비목표였다).
 */
defineProps<{ write: WriteInfo }>()

const result = ref<OrphanScanResult | null>(null)
const none = ref(false)
const error = ref('')
const loading = ref(false)
const scanCap = ref(200000)

async function loadLast() {
  loading.value = true
  error.value = ''
  try {
    const r = await orphanLast()
    if ('none' in r) { none.value = true; result.value = null }
    else { none.value = false; result.value = r }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const runner = useJobRunner(() => { void loadLast() })
const starting = ref(false)
const confirming = ref(false)

async function scan() {
  starting.value = true
  await runner.start(() => startOrphanScan({ scanCap: scanCap.value, sampleCap: 1000 }))
  starting.value = false
}

// ── 선택·삭제 ────────────────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set())
const rows = computed<OrphanRow[]>(() => result.value?.orphans ?? [])
function toggle(ri: string) { const s = new Set(selected.value); s.has(ri) ? s.delete(ri) : s.add(ri); selected.value = s }
const allSelected = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.ri)))
function toggleAll() { selected.value = allSelected.value ? new Set() : new Set(rows.value.map((r) => r.ri)) }
const selectedList = computed(() => [...selected.value])

async function runDelete() {
  starting.value = true
  const ok = await runner.start(() => startOrphanDelete(selectedList.value))
  starting.value = false
  confirming.value = false
  if (ok) selected.value = new Set()
}

function typeLabel(ty: number): string {
  const raw = result.value?.typeNames?.[String(ty)] ?? ''
  if (!raw) return `ty${ty}`
  const bare = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
  return bare.toUpperCase()
}
function rootOf(pi: string): string {
  const parts = pi.split('/').filter(Boolean)
  return parts.length >= 2 ? '/' + parts.slice(0, 2).join('/') : pi
}
function when(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '—' }

onMounted(async () => { void runner.attach(); await loadLast() })
</script>

<template>
  <section>
    <h2>고아 리소스</h2>
    <p class="lead">
      부모(<code>pi</code>)가 <code>lookup</code> 에 없는 행입니다. 트리에서 도달할 수 없지만
      DB 에는 남아 공간을 차지하고, 컨테이너 카운터를 어긋나게 합니다.
      <strong>화면을 열어도 훑지 않습니다</strong> — 탐지는 작업으로 돌리고, 마지막 결과만 보여 줍니다.
    </p>

    <div class="caution">
      <strong>아래 숫자는 “끊긴 지점”의 표본입니다 — 총량이 아닙니다.</strong>
      <p>
        상한(기본 20만 행)까지만 훑고 표본 1,000건까지만 남깁니다. 끊긴 컨테이너 하나 아래에
        CIN 수백만 건이 있을 수 있습니다. 끊긴 지점을 지우면 그 자식들이 다음 탐지에서 새
        고아로 올라옵니다.
      </p>
    </div>

    <div class="actionbar top">
      <label class="days-pick">
        훑을 상한
        <select v-model.number="scanCap">
          <option :value="50000">5만 행</option>
          <option :value="200000">20만 행</option>
          <option :value="1000000">100만 행</option>
        </select>
      </label>
      <button class="primary" :disabled="starting" @click="scan">탐지 시작</button>
      <span class="muted" v-if="result">마지막 탐지 {{ when(result.endedAt) }} · {{ result.scanned.toLocaleString() }}행 훑음
        <span v-if="result.scanCapped" class="warntext">· 상한에서 멈춤</span>
        <span v-if="result.cancelled" class="warntext">· 취소됨</span>
      </span>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <JobPanel v-if="runner.job.value" :job="runner.job.value" :error="runner.error.value" @cancel="runner.cancel" @dismiss="runner.dismiss" />

    <p v-if="none && !loading" class="empty">아직 탐지한 적이 없습니다. “탐지 시작” 을 누르세요.</p>

    <template v-if="result">
      <div class="tiles">
        <div class="tile"><div class="k">끊긴 지점 (표본)</div><div class="v">{{ result.orphans.length.toLocaleString() }}<span v-if="result.sampleTruncated">+</span></div><div class="s">표본 상한 {{ result.sampleCap.toLocaleString() }}</div></div>
        <div class="tile"><div class="k">lookup 에만 남은 CIN (표본)</div><div class="v">{{ result.lookupOnlyCin.rows.length.toLocaleString() }}<span v-if="result.lookupOnlyCin.sampleTruncated">+</span></div><div class="s">cin 표에 짝이 없는 ty=4 행 — 원인 미상, 세지 않음</div></div>
      </div>

      <p v-if="!write.enabled" class="note ro">조회 전용으로 떠 있습니다. 삭제를 쓰려면 <code>conf.json</code> 에 <code>csebaseport</code>(또는 <code>adminCsePort</code>)를 넣어 Mobius 주소를 알려 줍니다.</p>

      <div v-if="write.enabled && selected.size" class="actionbar">
        <strong>{{ selected.size.toLocaleString() }}건 선택</strong>
        <button class="link" @click="selected = new Set()">선택 해제</button>
        <span class="spacer" />
        <button class="danger" @click="confirming = true">삭제 ({{ selected.size.toLocaleString() }}건)</button>
      </div>

      <div v-if="rows.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="cb"><input type="checkbox" :checked="allSelected" :disabled="!write.enabled" aria-label="전체 선택" @change="toggleAll" /></th>
              <th>고아 경로 (ri)</th><th>타입</th><th>사라진 부모 (pi)</th><th>어느 서브트리</th><th>생성 (ct)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.ri" :class="{ picked: selected.has(r.ri) }">
              <td class="cb"><input type="checkbox" :checked="selected.has(r.ri)" :disabled="!write.enabled" :aria-label="r.ri + ' 선택'" @change="toggle(r.ri)" /></td>
              <td class="mono path">{{ r.ri }}</td>
              <td><span class="ty">{{ typeLabel(r.ty) }}</span></td>
              <td class="mono path missing">{{ r.pi }}</td>
              <td class="mono root">{{ rootOf(r.pi) }}</td>
              <td class="mono muted">{{ fmtTime(r.ct) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">표본에 고아가 없습니다<span v-if="result.scanCapped"> (상한까지는 — 뒤에 더 있을 수 있습니다)</span>.</p>

      <h3>lookup 에만 남은 CIN</h3>
      <p class="sub">원인이 밝혀지지 않아 삭제 버튼을 두지 않습니다. 인수인계 문서 §6 을 읽고 결정합니다.</p>
      <div v-if="result.lookupOnlyCin.rows.length" class="table-wrap short">
        <table>
          <thead><tr><th>ri</th><th>부모 (pi)</th><th>생성 (ct)</th></tr></thead>
          <tbody>
            <tr v-for="r in result.lookupOnlyCin.rows" :key="r.ri">
              <td class="mono path">{{ r.ri }}</td><td class="mono path">{{ r.pi }}</td><td class="mono muted">{{ fmtTime(r.ct) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty small">표본에 없습니다.</p>
    </template>

    <ConfirmDialog v-if="confirming" title="고아 리소스를 삭제합니다" :confirm-label="`${selected.size.toLocaleString()}건 삭제`" :paths="selectedList" destructive :busy="starting" @cancel="confirming = false" @confirm="runDelete">
      <p class="dlg">되돌릴 수 없습니다. 삭제 직전에 부모가 여전히 없는지 다시 확인해서, 그사이 부모가 되살아난 것은 건너뜁니다.</p>
      <p class="dlg warn"><strong>한 번에 다 끝나지 않습니다.</strong> 끊긴 지점을 지우면 그 자식들이 새로 고아가 되어 다음 탐지에 올라옵니다. 탐지 → 삭제를 반복해야 합니다.</p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
/* 기존 OrphanView 의 스타일 블록을 그대로 두고 아래를 더한다. .why 블록 규칙은 지워도 된다. */
h3 { margin: 1.8rem 0 0.2rem; font-size: 1.15rem; color: var(--text-strong); }
.sub { margin: 0 0 0.8rem; color: var(--muted); font-size: 0.95rem; max-width: 78ch; }
.actionbar.top { background: var(--panel); border-color: var(--border); }
.actionbar .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.warntext { color: var(--warn); font-weight: 600; }
.table-wrap.short { max-height: 36vh; }
.empty.small { padding: 1rem 0; font-size: 0.95rem; }
.days-pick { font-size: 0.92rem; color: var(--muted); display: flex; align-items: center; gap: 0.4rem; }
.days-pick select { font: inherit; padding: 0.3rem 0.5rem; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); color: var(--text); }
</style>
```

기존 파일의 `<style scoped>` 규칙(`.lead`·`.caution`·`.tiles`·`.tile`·`.table-wrap`·`.path`·`.ty`·`.actionbar`·`.cb`·`.dlg` 등)은 그대로 두고 위 블록을 그 뒤에 붙인다.

- [ ] **Step 3: 빌드**

Run: `cd admin/web && npm run build` → 통과. `grep -n "orphanPage\|orphanSummary" admin/web/src -r` → 0건.

- [ ] **Step 4: 커밋**

```bash
git add admin/web/src
git commit -m "admin(web): 고아 화면 — 라이브 스캔 제거, 탐지 작업 + 마지막 결과 표본, lookup 에만 남은 CIN

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: ACP 신규 생성·`acpi` 연결 화면 + 목록의 라우터 이동

**Files:**
- Create: `admin/web/src/views/AcpCreateView.vue`, `admin/web/src/views/AcpAttachView.vue`(Task 10 의 자리표시를 채운다)
- Modify: `admin/web/src/views/AcpListView.vue`, `admin/web/src/views/AcpEditView.vue`(`done` emit → 라우터), `admin/web/src/api.ts`, `admin/web/src/types.ts`

**Interfaces:**
- `api.ts`: `acpCreate({ parentRi, rn, pv, pvs })` → `post<{ ok; ri; status; rsc }>('/api/acp/create', …)`, `acpAttach({ targetRi, acpi })` → `post<{ ok; status; rsc }>('/api/acp/attach', …)`.
- `AcpCreateView` 는 편집 화면의 템플릿 셋(A/B/C)과 규칙 편집기를 그대로 쓴다 — 그 부분을 `components/AcpRulesEditor.vue` 로 뽑아 두 화면이 공유한다. props `{ modelValue: EditRule[]; title: string; placeholder: string }`, `update:modelValue`. `EditRule = { acor: string; acop: number }` 를 `types.ts` 로 옮긴다.
- `AcpAttachView` props `{ initialRi: string | null }`: 대상 AE 경로 입력 → `acpDetail` 이 아니라 `acpSimulate` 의 `acpi`(현재 값) 로 지금 붙은 것을 보이고, ACP 목록(`acpList` 를 끝까지)에서 체크로 고른다(최대 7). 저장 전 `acpSimulate({ ri: 대상, origins, ops, acpiOverride: 고른 목록 })` 미리보기.
- `AcpListView`: `emit('simulate'|'edit')` 대신 `router.push`. 상단에 "새 ACP"·"acpi 연결/해제" 버튼. 변경 이력 표는 상세에 그대로 둔다(ACP 한 건의 이력이고, 전역 이력 화면만 뺐다).

- [ ] **Step 1: `types.ts` · `api.ts`**

```ts
/** 편집기의 규칙 한 줄. acor 는 쉼표로 구분한 문자열, acop 은 비트 합. */
export interface EditRule { acor: string; acop: number }
```

```ts
export function acpCreate(body: { parentRi: string; rn: string; pv: AcpPrivileges; pvs: AcpPrivileges }) {
  return post<{ ok: boolean; ri: string; status: number; rsc: string | null }>('/api/acp/create', body)
}
export function acpAttach(body: { targetRi: string; acpi: string[] }) {
  return post<{ ok: boolean; status: number; rsc: string | null }>('/api/acp/attach', body)
}
```

- [ ] **Step 2: `components/AcpRulesEditor.vue` — 편집 화면에서 뽑는다**

`AcpEditView.vue` 의 `OP_BITS`·`toggleBit`·`addRule`·`removeRule` 과 "규칙 카드" 템플릿(한 열의 `<div v-for="(r, i) in pv" …>` 블록 + `＋ 규칙 추가` 버튼)을 옮긴다:

```vue
<script setup lang="ts">
import type { EditRule } from '../types'

const props = defineProps<{ modelValue: EditRule[]; title: string; placeholder: string; emptyNote: string }>()
const emit = defineEmits<{ 'update:modelValue': [rules: EditRule[]] }>()

/** acop 비트. 63 이 무슨 뜻인지 화면에서 알 수 있어야 한다. */
const OP_BITS: { bit: number; name: string; hint: string }[] = [
  { bit: 1, name: 'CREATE', hint: '자식 리소스 만들기' },
  { bit: 2, name: 'RETRIEVE', hint: '읽기' },
  { bit: 4, name: 'UPDATE', hint: '수정' },
  { bit: 8, name: 'DELETE', hint: '삭제' },
  { bit: 16, name: 'NOTIFY', hint: '알림 받기' },
  { bit: 32, name: 'DISCOVERY', hint: '검색 결과에 나오기' },
]

function set(rules: EditRule[]) { emit('update:modelValue', rules) }
function toggleBit(i: number, bit: number) {
  const rules = props.modelValue.map((r) => ({ ...r }))
  const r = rules[i]
  r.acop = (r.acop & bit) === bit ? r.acop & ~bit : r.acop | bit
  set(rules)
}
function setAcor(i: number, v: string) {
  const rules = props.modelValue.map((r) => ({ ...r }))
  rules[i].acor = v
  set(rules)
}
function add() { set(props.modelValue.concat([{ acor: '', acop: 2 }])) }
function remove(i: number) { set(props.modelValue.filter((_, j) => j !== i)) }
</script>

<template>
  <div class="col">
    <h3>{{ title }}</h3>
    <div v-for="(r, i) in modelValue" :key="i" class="rule">
      <div class="rowline">
        <input :value="r.acor" class="mono" :placeholder="placeholder" @input="setAcor(i, ($event.target as HTMLInputElement).value)" />
        <button class="del" title="이 규칙 지우기" @click="remove(i)">×</button>
      </div>
      <div class="bits">
        <button v-for="o in OP_BITS" :key="o.bit" class="bit" :class="{ on: (r.acop & o.bit) === o.bit }" :title="o.hint" @click="toggleBit(i, o.bit)">{{ o.name }}</button>
        <span class="acopval">acop = {{ r.acop }}</span>
      </div>
    </div>
    <button class="add" @click="add">＋ 규칙 추가</button>
    <p v-if="!modelValue.length" class="none">{{ emptyNote }}</p>
  </div>
</template>

<style scoped>
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.col { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1.1rem 1.2rem; }
.rule { border: 1px solid var(--border); border-radius: 9px; padding: 0.7rem 0.8rem; margin-bottom: 0.6rem; background: var(--bg); }
.rowline { display: flex; gap: 0.5rem; align-items: center; }
.rowline input { font: inherit; flex: 1; padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); color: var(--text); }
.del { border: none; background: none; color: var(--muted); font-size: 1.3rem; line-height: 1; padding: 0 0.3rem; cursor: pointer; }
.del:hover { color: var(--danger); }
.bits { display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center; margin-top: 0.5rem; }
.bit { font-size: 0.78rem; padding: 0.2rem 0.5rem; border-radius: 5px; border: 1px solid var(--border); background: var(--panel); color: var(--muted); }
.bit.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent-strong); font-weight: 600; }
.acopval { font-size: 0.8rem; color: var(--muted); font-family: var(--mono); margin-left: 0.3rem; }
.add { margin-top: 0.3rem; font-size: 0.9rem; }
.none { color: var(--muted); font-size: 0.93rem; }
</style>
```

`AcpEditView.vue` 는 두 열을 `<AcpRulesEditor v-model="pv" title="pv — 지켜지는 리소스의 권한" placeholder="Cteam, Cmaint (비우면 누구나)" empty-note="규칙이 없습니다 — 이 ACP 를 가리키는 리소스는 생성자만 통과합니다." />` 와 `pvs` 용으로 바꾸고, 옮긴 함수·상수·스타일을 지운다. `EditRule` 은 `types.ts` 에서 import. `emit('done')` 은 `router.push({ name: 'judge-acp-list', query: { ri: props.ri } })` 로.

`TEMPLATES` 상수도 `components/acp_templates.ts` 로 뽑아 두 화면이 import 한다:

```ts
import type { EditRule } from '../types'

/**
 * 운영 방안이 정한 템플릿 셋. 문서는 "예외 세 가지만 쓴다 / 리소스마다 만들지
 * 않는다 / ACP 개수를 한 자리로 유지한다" 고 못박았다.
 * 출처: docs/superpowers/specs/2026-08-29-acp-operating-model.md
 */
export const TEMPLATES: { key: string; name: string; hint: string; pv: EditRule[] }[] = [
  { key: 'A', name: 'A · 완전 비공개', hint: '정해진 곳만 봅니다. 장치 ID 는 적지 않아도 됩니다 — 생성자는 자동으로 통과합니다.', pv: [{ acor: '', acop: 63 }] },
  { key: 'B', name: 'B · 올리기는 열고, 보는 것만 제한', hint: '장비는 계속 올리고 조회·탐색만 제한합니다.', pv: [{ acor: '', acop: 63 }, { acor: 'all', acop: 1 }] },
  { key: 'C', name: 'C · 보는 건 열고, 만드는 것만 막기', hint: '읽기는 지금처럼 열되 아무나 데이터를 넣지는 못하게 합니다.', pv: [{ acor: '', acop: 63 }, { acor: 'all', acop: 34 }] },
]

export function toPrivileges(rules: EditRule[]) {
  return { acr: rules.map((r) => ({ acor: r.acor.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean), acop: r.acop })) }
}
```

- [ ] **Step 3: `views/AcpCreateView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { acpValidate, acpCreate, acpSimulateWithRows } from '../api'
import type { AcpOp, AcpSimulation, AcpValidation, EditRule, WriteInfo } from '../types'
import AcpRulesEditor from '../components/AcpRulesEditor.vue'
import AcpPolicyNote from '../components/AcpPolicyNote.vue'
import { TEMPLATES, toPrivileges } from '../components/acp_templates'

/**
 * ACP 신규 생성. 잠금 단위가 AE 하나이므로 부모는 AE 다. 검사 → 미리보기 → 저장 순서는
 * 편집 화면과 같다 — 콘솔은 수퍼유저로 붙어 자기가 만든 잠금을 자신은 통과하므로,
 * 저장 전에 판정을 보는 것이 계약이다.
 */
defineProps<{ write: WriteInfo }>()
const router = useRouter()

const parentRi = ref('')
const rn = ref('')
const pv = ref<EditRule[]>(TEMPLATES[0].pv.map((r) => ({ ...r })))
const pvs = ref<EditRule[]>([{ acor: '', acop: 63 }])
const templateApplied = ref('A')
const validation = ref<Record<'pv' | 'pvs', AcpValidation | null>>({ pv: null, pvs: null })
const error = ref('')
const saving = ref(false)

const previewOrigins = ref('')
const previewOps = ref<AcpOp[]>(['CREATE', 'RETRIEVE', 'UPDATE', 'DELETE'])
const preview = ref<AcpSimulation | null>(null)
const previewFresh = ref(false)
const previewing = ref(false)
const previewOriginList = computed(() => previewOrigins.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))

const rnOk = computed(() => /^[A-Za-z0-9_-]{1,64}$/.test(rn.value))
const parentOk = computed(() => parentRi.value.startsWith('/'))
const blocking = computed(() => !!validation.value.pv?.code || !!validation.value.pvs?.code)

function applyTemplate(key: string) {
  const t = TEMPLATES.find((x) => x.key === key)
  if (!t) return
  pv.value = t.pv.map((r) => ({ ...r }))
  templateApplied.value = key
}

async function check() {
  try {
    const [a, b] = await Promise.all([acpValidate('pv', toPrivileges(pv.value)), acpValidate('pvs', toPrivileges(pvs.value))])
    validation.value = { pv: a, pvs: b }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function runPreview() {
  if (!parentOk.value || !previewOriginList.value.length) return
  previewing.value = true
  error.value = ''
  try {
    // 아직 없는 ACP 라 rows 에 가짜 ri 를 넣어 판정만 본다. 대상은 부모 AE 다.
    preview.value = await acpSimulateWithRows({
      ri: parentRi.value, origins: previewOriginList.value, ops: previewOps.value,
      rows: [{ ri: parentRi.value + '/' + (rn.value || 'new-acp'), pv: toPrivileges(pv.value), pvs: toPrivileges(pvs.value) }],
    })
    previewFresh.value = true
  } catch (e) {
    preview.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    previewing.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const r = await acpCreate({ parentRi: parentRi.value, rn: rn.value, pv: toPrivileges(pv.value), pvs: toPrivileges(pvs.value) })
    router.push({ name: 'judge-acp-list', query: { ri: r.ri } })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

watch([pv, pvs], () => { previewFresh.value = false; void check() }, { deep: true, immediate: true })
</script>

<template>
  <section>
    <div class="head">
      <h2>새 ACP</h2>
      <span class="spacer" />
      <button @click="router.push({ name: 'judge-acp-list' })">목록으로</button>
    </div>
    <AcpPolicyNote variant="compact" />
    <p v-if="!write.enabled" class="banner danger">조회 전용으로 떠 있어 만들 수 없습니다.</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="form">
      <label class="field"><span>부모 AE (경로)</span><input v-model.trim="parentRi" class="mono" placeholder="/Mobius/Cdevice1" /></label>
      <label class="field"><span>이름 (rn)</span><input v-model.trim="rn" class="mono" placeholder="acp_team" /></label>
      <p v-if="parentRi && !parentOk" class="err small">경로는 / 로 시작합니다.</p>
      <p v-if="rn && !rnOk" class="err small">영문·숫자·_·- 1~64자.</p>
    </div>

    <div class="templates">
      <span class="tlabel">템플릿에서 시작</span>
      <button v-for="t in TEMPLATES" :key="t.key" class="tbtn" :class="{ on: templateApplied === t.key }" :title="t.hint" @click="applyTemplate(t.key)">{{ t.name }}</button>
    </div>

    <div class="cols">
      <AcpRulesEditor v-model="pv" title="pv — 지켜지는 리소스의 권한" placeholder="Cteam, Cmaint (비우면 누구나)" empty-note="규칙이 없습니다 — 생성자만 통과합니다." />
      <AcpRulesEditor v-model="pvs" title="pvs — 이 ACP 를 고칠 권한" placeholder="Cowner" empty-note="규칙이 없습니다 — 수퍼유저 말고는 못 고칩니다." />
    </div>

    <div v-if="blocking" class="banner danger">
      <strong>이대로는 만들 수 없습니다.</strong>
      <div v-if="validation.pv?.code" class="prob"><code>{{ validation.pv.code }}</code> <code class="at">{{ validation.pv.path }}</code></div>
      <div v-if="validation.pvs?.code" class="prob"><code>{{ validation.pvs.code }}</code> <code class="at">{{ validation.pvs.path }}</code></div>
    </div>

    <div class="preview">
      <h3>만들기 전에 — 누가 무엇을 할 수 있게 되나</h3>
      <div class="pform">
        <label class="field"><span>원본</span><input v-model="previewOrigins" class="mono" placeholder="Cteam, Cother" /></label>
        <button :disabled="previewing || !parentOk || !previewOriginList.length" @click="runPreview">{{ previewing ? '판정 중…' : '미리 보기' }}</button>
      </div>
      <div v-if="preview" class="ptable" :class="{ stale: !previewFresh }">
        <p v-if="!previewFresh" class="stalenote">규칙을 고쳤습니다 — 아래는 고치기 전 결과입니다.</p>
        <table>
          <thead><tr><th>원본 \ 연산</th><th v-for="o in previewOps" :key="o">{{ o }}</th></tr></thead>
          <tbody>
            <tr v-for="og in previewOriginList" :key="og">
              <th class="rowh mono">{{ og }}</th>
              <td v-for="o in previewOps" :key="o">
                <template v-for="m in preview.matrix.filter((x) => x.origin === og && x.op === o)" :key="m.op">
                  <div class="verdict" :class="[m.allowed ? 'yes' : 'no', m.decided_by]"><span class="mark">{{ m.allowed ? '허용' : '거부' }}</span><span class="why">{{ m.decided_by }}</span></div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="actions">
      <button class="primary" :disabled="!write.enabled || blocking || saving || !rnOk || !parentOk" @click="save">{{ saving ? '만드는 중…' : '만들기' }}</button>
      <span class="muted">만든 뒤에는 “acpi 연결/해제” 로 AE 에 붙입니다 — 붙이기 전에는 효력이 없습니다.</span>
    </div>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: baseline; gap: 0.8rem; margin-bottom: 0.5rem; }
h2 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.spacer { flex: 1; }
.err { color: var(--danger); }
.small { font-size: 0.88rem; }
.muted { color: var(--muted); font-size: 0.92rem; }
.form { display: grid; gap: 0.6rem; max-width: 560px; margin: 1rem 0; }
.field { display: grid; gap: 0.3rem; }
.field > span { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.field input { font: inherit; padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); }
.templates { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
.tlabel { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.tbtn { font-size: 0.9rem; padding: 0.3rem 0.75rem; border-radius: 999px; }
.tbtn.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.4rem; }
.banner { padding: 0.85rem 1.1rem; border-radius: 0 8px 8px 0; margin: 1rem 0; font-size: 0.95rem; max-width: 88ch; }
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.prob { margin-top: 0.35rem; }
.at { color: var(--accent-strong); }
.preview { margin-top: 1.6rem; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1.2rem 1.3rem; }
.pform { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
.ptable { margin-top: 1rem; overflow: auto; }
.ptable.stale { opacity: 0.55; }
.stalenote { color: var(--warn); font-size: 0.92rem; margin: 0 0 0.5rem; }
.ptable th.rowh { text-align: left; font-family: var(--mono); font-weight: 600; text-transform: none; letter-spacing: 0; font-size: 0.95rem; color: var(--text); position: static; }
.verdict { display: grid; gap: 0.1rem; padding: 0.3rem 0.5rem; border-radius: 7px; min-width: 90px; }
.verdict .mark { font-weight: 700; font-size: 0.9rem; }
.verdict .why { font-size: 0.73rem; opacity: 0.85; font-family: var(--mono); }
.verdict.yes { background: rgba(46, 160, 118, 0.14); color: var(--ok); }
.verdict.no { background: var(--danger-wash); color: var(--danger); }
.verdict.creator, .verdict.superuser { background: var(--accent-wash); color: var(--accent-strong); }
.actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.4rem; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.actions .primary:disabled { opacity: 0.5; }
</style>
```

- [ ] **Step 4: `views/AcpAttachView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { acpList, acpSimulate, acpAttach } from '../api'
import type { AcpListRow, AcpOp, AcpSimulation, WriteInfo } from '../types'

/**
 * AE 에 acpi 를 붙이고 뗀다. 손입력이 없다 — 목록에서 고른다(최대 7, 컬럼 폭 200).
 * 지금 붙은 것은 시뮬레이터의 acpi 필드로 읽는다(코어가 실제로 푼 값이다).
 */
const props = defineProps<{ initialRi: string | null; write: WriteInfo }>()
const router = useRouter()

const targetRi = ref(props.initialRi ?? '')
const current = ref<string[] | null>(null)
const chosen = ref<Set<string>>(new Set())
const acps = ref<AcpListRow[]>([])
const error = ref('')
const loading = ref(false)
const saving = ref(false)

const previewOrigins = ref('')
const previewOps = ref<AcpOp[]>(['CREATE', 'RETRIEVE', 'UPDATE', 'DELETE'])
const preview = ref<AcpSimulation | null>(null)
const previewFresh = ref(false)
const previewOriginList = computed(() => previewOrigins.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))

const chosenList = computed(() => [...chosen.value])
const changed = computed(() => JSON.stringify([...(current.value ?? [])].sort()) !== JSON.stringify(chosenList.value.slice().sort()))

/** ACP 목록을 끝까지 읽는다 — 고를 목록이 잘려 있으면 "없는 줄" 알게 된다. */
async function loadAcps() {
  const out: AcpListRow[] = []
  let after: string | null = null
  for (let i = 0; i < 50; i++) {
    const p = await acpList({ limit: 500, afterRi: after })
    out.push(...p.rows)
    if (!p.more) break
    after = p.nextRi
  }
  acps.value = out
}

/** 대상의 현재 acpi. 시뮬레이터가 실제로 푼 값을 준다(존재하지 않는 ri 는 오류). */
async function loadCurrent() {
  if (!targetRi.value.startsWith('/')) return
  loading.value = true
  error.value = ''
  try {
    const s = await acpSimulate({ ri: targetRi.value, origins: ['__probe__'], ops: ['RETRIEVE'] })
    if (s.ty !== 2) { error.value = '대상은 AE 여야 합니다 (잠금 단위는 AE 하나입니다)'; current.value = null; return }
    current.value = s.acpi ?? []
    chosen.value = new Set(current.value)
    preview.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    current.value = null
  } finally {
    loading.value = false
  }
}

function toggle(ri: string) {
  const s = new Set(chosen.value)
  if (s.has(ri)) s.delete(ri)
  else if (s.size >= 7) { error.value = 'acpi 는 최대 7개입니다'; return }
  else s.add(ri)
  chosen.value = s
  previewFresh.value = false
}

async function runPreview() {
  if (!previewOriginList.value.length || current.value === null) return
  error.value = ''
  try {
    preview.value = await acpSimulate({ ri: targetRi.value, origins: previewOriginList.value, ops: previewOps.value, acpiOverride: chosenList.value })
    previewFresh.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    await acpAttach({ targetRi: targetRi.value, acpi: chosenList.value })
    await loadCurrent()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

watch(() => props.initialRi, (v) => { if (v) { targetRi.value = v; void loadCurrent() } })
onMounted(async () => {
  try { await loadAcps() } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  if (targetRi.value) await loadCurrent()
})
</script>

<template>
  <section>
    <div class="head">
      <h2>acpi 연결 / 해제</h2>
      <span class="spacer" />
      <button @click="router.push({ name: 'judge-acp-list' })">목록으로</button>
    </div>
    <p class="lead">AE 하나에 ACP 를 붙이거나 뗍니다. 컨테이너·CIN 에는 붙이지 않습니다 — 잠금 단위는 AE 하나입니다.</p>
    <p v-if="!write.enabled" class="banner danger">조회 전용으로 떠 있어 저장할 수 없습니다.</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="pform">
      <label class="field"><span>대상 AE (경로)</span><input v-model.trim="targetRi" class="mono" placeholder="/Mobius/Cdevice1" @keyup.enter="loadCurrent" /></label>
      <button :disabled="loading || !targetRi.startsWith('/')" @click="loadCurrent">{{ loading ? '읽는 중…' : '읽기' }}</button>
    </div>

    <template v-if="current !== null">
      <p class="muted">지금 붙은 것: <code v-if="current.length" class="mono">{{ current.join(', ') }}</code><span v-else>없음 — 기본 정책이 적용됩니다</span></p>

      <div class="table-wrap">
        <table>
          <thead><tr><th class="cb"></th><th>ACP (ri)</th><th>이름</th></tr></thead>
          <tbody>
            <tr v-for="a in acps" :key="a.ri" :class="{ picked: chosen.has(a.ri) }">
              <td class="cb"><input type="checkbox" :checked="chosen.has(a.ri)" :aria-label="a.ri + ' 선택'" @change="toggle(a.ri)" /></td>
              <td class="mono path">{{ a.ri }}</td>
              <td class="mono">{{ a.rn }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!acps.length" class="empty">ACP 가 없습니다. 먼저 “새 ACP” 로 만듭니다.</p>

      <div class="preview">
        <h3>저장하기 전에 — 이 조합이면 누가 무엇을 할 수 있나</h3>
        <div class="pform">
          <label class="field"><span>원본</span><input v-model="previewOrigins" class="mono" placeholder="Cteam, Cother" /></label>
          <button :disabled="!previewOriginList.length" @click="runPreview">미리 보기</button>
        </div>
        <div v-if="preview" class="ptable" :class="{ stale: !previewFresh }">
          <p v-if="!previewFresh" class="stalenote">선택을 바꿨습니다 — 아래는 바꾸기 전 결과입니다.</p>
          <table>
            <thead><tr><th>원본 \ 연산</th><th v-for="o in previewOps" :key="o">{{ o }}</th></tr></thead>
            <tbody>
              <tr v-for="og in previewOriginList" :key="og">
                <th class="rowh mono">{{ og }}</th>
                <td v-for="o in previewOps" :key="o">
                  <template v-for="m in preview.matrix.filter((x) => x.origin === og && x.op === o)" :key="m.op">
                    <div class="verdict" :class="[m.allowed ? 'yes' : 'no', m.decided_by]"><span class="mark">{{ m.allowed ? '허용' : '거부' }}</span><span class="why">{{ m.decided_by }}</span></div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="actions">
        <button class="primary" :disabled="!write.enabled || saving || !changed" @click="save">{{ saving ? '저장 중…' : chosen.size ? `저장 (${chosen.size}개 연결)` : '저장 (전부 해제)' }}</button>
        <span v-if="!changed" class="muted">바뀐 것이 없습니다.</span>
        <span v-else-if="!previewFresh" class="muted">바뀐 조합을 아직 미리 보지 않았습니다.</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: baseline; gap: 0.8rem; margin-bottom: 0.5rem; }
h2 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.spacer { flex: 1; }
.lead { margin: 0 0 1.2rem; color: var(--muted); font-size: 1.02rem; max-width: 74ch; }
.err { color: var(--danger); }
.muted { color: var(--muted); font-size: 0.95rem; }
.empty { color: var(--muted); padding: 2rem 0; text-align: center; }
.banner { padding: 0.85rem 1.1rem; border-radius: 0 8px 8px 0; margin: 1rem 0; font-size: 0.95rem; max-width: 88ch; }
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.pform { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; margin: 0.6rem 0; }
.field { display: grid; gap: 0.3rem; }
.field > span { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.field input { font: inherit; padding: 0.4rem 0.6rem; min-width: 300px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); }
.table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: auto; max-height: 40vh; margin-top: 0.8rem; }
.cb { width: 2.4rem; text-align: center; }
.cb input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); cursor: pointer; }
tr.picked td { background: var(--accent-wash); }
.path { max-width: 520px; overflow-wrap: anywhere; font-size: 0.95rem; }
.preview { margin-top: 1.4rem; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1.2rem 1.3rem; }
.ptable { margin-top: 1rem; overflow: auto; }
.ptable.stale { opacity: 0.55; }
.stalenote { color: var(--warn); font-size: 0.92rem; margin: 0 0 0.5rem; }
.ptable th.rowh { text-align: left; font-family: var(--mono); font-weight: 600; text-transform: none; letter-spacing: 0; font-size: 0.95rem; color: var(--text); position: static; }
.verdict { display: grid; gap: 0.1rem; padding: 0.3rem 0.5rem; border-radius: 7px; min-width: 90px; }
.verdict .mark { font-weight: 700; font-size: 0.9rem; }
.verdict .why { font-size: 0.73rem; opacity: 0.85; font-family: var(--mono); }
.verdict.yes { background: rgba(46, 160, 118, 0.14); color: var(--ok); }
.verdict.no { background: var(--danger-wash); color: var(--danger); }
.verdict.creator, .verdict.superuser { background: var(--accent-wash); color: var(--accent-strong); }
.actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.4rem; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.actions .primary:disabled { opacity: 0.5; }
</style>
```

`acpSimulate` 의 응답 `ty` 로 AE 인지 본다(`AcpSimulation.ty`). `__probe__` 원본은 판정만 받기 위한 값이고 결과는 쓰지 않는다.

- [ ] **Step 5: `AcpListView.vue`**

- `defineEmits` 를 지우고 `const router = useRouter()`. `emit('simulate', ri)` → `router.push({ name: 'judge-acp-sim', params: { ri: riParam(ri) } })`, `emit('edit', ri)` → `router.push({ name: 'judge-acp-edit', params: { ri: riParam(ri) } })` (`riParam` 은 `../router` 에서 import).
- 상단 `<h2>` 아래에 버튼 두 개:

```vue
    <div class="toolbar">
      <button class="primary" :disabled="!write.enabled" @click="router.push({ name: 'judge-acp-create' })">새 ACP</button>
      <button :disabled="!write.enabled" @click="router.push({ name: 'judge-acp-attach' })">acpi 연결 / 해제</button>
    </div>
```

상세 drawer 의 버튼 줄에 `<button @click="router.push({ name: 'judge-acp-attach', params: { ri: riParam(openRi) } })">이 ACP 를 붙일 AE 고르기</button>` 를 더하지 **않는다** — 연결 화면은 AE 기준이다. 대신 "이 ACP 를 쓰는 리소스" 목록의 각 항목 옆에 `<button class="small" @click="router.push({ name: 'judge-acp-attach', params: { ri: riParam(r.ri) } })">연결 편집</button>` 을 둔다.
- `.toolbar { display: flex; gap: 0.6rem; margin: 0.6rem 0 1rem; } .toolbar .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }`.

- [ ] **Step 6: 빌드**

Run: `cd admin/web && npm run build` → 통과. `grep -rn "defineEmits" admin/web/src/views` → `AcpProblemsView`·`AcpListView`·`AcpEditView` 에 없어야 한다.

- [ ] **Step 7: 커밋**

```bash
git add admin/web/src
git commit -m "admin(web): ACP 신규 생성·acpi 연결 화면 — 규칙 편집기·템플릿 공유, 목록은 라우터로 이동

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: 구독 엔드포인트 화면

**Files:**
- Create: `admin/web/src/views/SubsView.vue`(자리표시를 채운다)
- Modify: `admin/web/src/api.ts`, `admin/web/src/types.ts`

**Interfaces:**
- `api.ts`: `subsEndpoints(opts?: { limit?: number })` → `get<SubsEndpointsPage>('/api/subs/endpoints…')`, `subsSample(endpoint: string, limit = 200)` → `get<SubsSamplePage>('/api/subs/sample?endpoint=…')`, `startSubDelete(ris)` → 기존 `orphan-delete` 가 아니라 **새 작업 종류가 필요하다**: `POST /api/jobs/sub-delete { ris }` — 백엔드에 한 라우트를 더한다(아래 Step 1). 삭제 직전 프리플라이트: `select_lookup` 으로 `ty=23` 인지 본다.
- `types.ts`: `SubsEndpoint { endpoint; total; broken; suspect; sample: string[] }`, `SubsEndpointsPage { endpoints; endpointsTruncated; scanned; capped; audit: { scanned; capped; bySeverity: Record<string, number>; byReason: Record<string, number> } }`, `SubsSampleRow { ri; pi; nu: string[]; enc: unknown; cr: string; severity: 'broken' | 'suspect' | null; reason: string | null }`, `SubsSamplePage { rows; more; scanned; capped }`. `JobKind` 에 `'sub-delete'`.

- [ ] **Step 1: 백엔드 — `admin/api.js` 에 `sub-delete` 작업 (일괄 작업 절)**

```js
    /**
     * 구독 삭제. 구독 화면에서 broken 만 미리 선택되어 온다. 삭제 직전 그 ri 가 여전히
     * 구독(ty=23)인지 본다 — 목록이 낡았을 수 있다.
     */
    app.post('/api/jobs/sub-delete', function (req, res) {
        if (!require_write(res)) { return; }
        var ris = req.body && req.body.ris;
        var bad = bad_targets(ris);
        if (bad) { return res.status(400).json({ error: bad }); }
        start_or_conflict(res, {
            kind: 'sub-delete',
            title: '구독 삭제 ' + ris.length + '건',
            note: '삭제 직전 대상이 여전히 구독(ty=23)인지 다시 확인한다.',
            targets: ris,
            concurrency: 4,
            worker: make_delete_worker(function (conn, row, next) {
                if (String(row.ty) !== '23') { return next('구독이 아님 (ty=' + row.ty + ')'); }
                next(null);
            })
        });
    });
```

시험 `test/admin-api-subs.test.js` 에 한 건을 더한다:

```js
test('sub-delete 는 구독만 지운다', async function () {
    const h = await boot({
        execute: function (sql, bindings) {
            if (/from `lookup`/.test(sql)) { return [{ ri: bindings[0], ty: bindings[0].endsWith('/s1') ? '23' : '3' }]; }
            return [];
        },
        cse: { status: 200, rsc: '2002', body: {} }
    });
    try {
        await h.login();
        const r = await h.request('POST', '/api/jobs/sub-delete', { ris: ['/M/ae/s1', '/M/ae/c'] });
        assert.strictEqual(r.status, 202);
        let job;
        for (let i = 0; i < 200; i++) {
            job = (await h.request('GET', '/api/jobs/' + r.body.id)).body;
            if (job.state !== 'running') { break; }
            await new Promise((res) => setTimeout(res, 10));
        }
        assert.strictEqual(job.ok, 1);
        assert.strictEqual(job.skipped, 1);
        assert.deepStrictEqual(h.cse.calls.filter((c) => c.method === 'DELETE').map((c) => c.path), ['/M/ae/s1']);
    } finally { await h.close(); }
});
```

Run: `node --test test/admin-api-subs.test.js` → PASS (3/3).

- [ ] **Step 2: `types.ts` · `api.ts`**

```ts
export interface SubsEndpoint { endpoint: string; total: number; broken: number; suspect: number; sample: string[] }
export interface SubsEndpointsPage {
  endpoints: SubsEndpoint[]
  endpointsTruncated: boolean
  scanned: number
  capped: boolean
  audit: { scanned: number; capped: boolean; bySeverity: Record<string, number>; byReason: Record<string, number> }
}
export interface SubsSampleRow { ri: string; pi: string; nu: string[]; enc: unknown; cr: string; severity: 'broken' | 'suspect' | null; reason: string | null }
export interface SubsSamplePage { rows: SubsSampleRow[]; more: boolean; scanned: number; capped: boolean }
export type JobKind = 'expired-delete' | 'expired-extend' | 'orphan-delete' | 'orphan-scan' | 'sub-delete' | 'selftest'
```

```ts
export function subsEndpoints(opts: { limit?: number } = {}) {
  return get<SubsEndpointsPage>(`/api/subs/endpoints?limit=${opts.limit ?? 100}`)
}
export function subsSample(endpoint: string, limit = 200) {
  return get<SubsSamplePage>(`/api/subs/sample?endpoint=${encodeURIComponent(endpoint)}&limit=${limit}`)
}
export function startSubDelete(ris: string[]) {
  return post<Job>('/api/jobs/sub-delete', { ris })
}
```

- [ ] **Step 3: `views/SubsView.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { subsEndpoints, subsSample, startSubDelete } from '../api'
import type { SubsEndpoint, SubsEndpointsPage, SubsSampleRow, WriteInfo } from '../types'
import { useJobRunner } from '../job'
import JobPanel from '../components/JobPanel.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

/**
 * 구독을 nu 의 엔드포인트로 묶어 본다(배포: 3,463건, 고유 nu 202개, 상위 3개가 57%).
 * 판정은 코어 감사 함수의 것이다. **broken 만 미리 선택되고 suspect 는 섞이지 않는다** —
 * suspect(예: mqtt 토픽 미등록)는 멀쩡히 동작 중인 구독일 수 있다.
 */
defineProps<{ write: WriteInfo }>()

const page = ref<SubsEndpointsPage | null>(null)
const picked = ref<SubsEndpoint | null>(null)
const sample = ref<SubsSampleRow[]>([])
const sampleMore = ref(false)
const loading = ref(false)
const loadingSample = ref(false)
const error = ref('')

const selected = ref<Set<string>>(new Set())
const selectedList = computed(() => [...selected.value])
const brokenRows = computed(() => sample.value.filter((r) => r.severity === 'broken'))
const suspectSelected = computed(() => sample.value.filter((r) => r.severity === 'suspect' && selected.value.has(r.ri)).length)

async function load() {
  loading.value = true
  error.value = ''
  try { page.value = await subsEndpoints({ limit: 100 }) }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { loading.value = false }
}

async function open(e: SubsEndpoint) {
  picked.value = e
  sample.value = []
  selected.value = new Set()
  loadingSample.value = true
  try {
    const p = await subsSample(e.endpoint, 200)
    sample.value = p.rows
    sampleMore.value = p.more
    // broken 만 미리 선택한다. suspect 는 사람이 하나씩 고른다.
    selected.value = new Set(p.rows.filter((r) => r.severity === 'broken').map((r) => r.ri))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loadingSample.value = false
  }
}

function toggle(ri: string) { const s = new Set(selected.value); s.has(ri) ? s.delete(ri) : s.add(ri); selected.value = s }

const runner = useJobRunner(() => { void load(); if (picked.value) void open(picked.value) })
const confirming = ref(false)
const starting = ref(false)
async function runDelete() {
  starting.value = true
  const ok = await runner.start(() => startSubDelete(selectedList.value))
  starting.value = false
  confirming.value = false
  if (ok) selected.value = new Set()
}

const REASON_LABEL: Record<string, string> = {
  mqtt_topic_unregistered: 'MQTT 토픽의 AE 가 등록돼 있지 않음',
}
function sev(r: SubsSampleRow): string {
  if (r.severity === 'broken') return '깨짐'
  if (r.severity === 'suspect') return '의심'
  return '정상'
}

onMounted(async () => { void runner.attach(); await load() })
</script>

<template>
  <section>
    <h2>구독 엔드포인트</h2>
    <p class="lead">
      구독을 알림 주소(<code>nu</code>)의 <code>scheme://host</code> 로 묶었습니다. 판정은 코어의 구독 감사와 같습니다 —
      <strong>깨짐(broken)</strong> 은 알림을 보낼 수 없는 구독, <strong>의심(suspect)</strong> 은 보낼 수는 있으나 받을 상대가
      확인되지 않는 구독입니다. 의심은 일괄 선택에 섞이지 않습니다.
    </p>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="page" class="tiles">
      <div class="tile"><div class="k">훑은 구독</div><div class="v">{{ page.scanned.toLocaleString() }}<span v-if="page.capped">+</span></div><div class="s" :class="{ warn: page.capped }">{{ page.capped ? '상한에 걸림 — 더 있을 수 있음' : '전수' }}</div></div>
      <div class="tile" :class="{ hot: (page.audit.bySeverity.broken ?? 0) > 0 }"><div class="k">깨짐</div><div class="v">{{ (page.audit.bySeverity.broken ?? 0).toLocaleString() }}</div><div class="s">알림을 보낼 수 없음</div></div>
      <div class="tile"><div class="k">의심</div><div class="v">{{ (page.audit.bySeverity.suspect ?? 0).toLocaleString() }}</div><div class="s">받을 상대 미확인</div></div>
      <div class="tile"><div class="k">엔드포인트</div><div class="v">{{ page.endpoints.length }}<span v-if="page.endpointsTruncated">+</span></div><div class="s">건수 순</div></div>
    </div>

    <JobPanel v-if="runner.job.value" :job="runner.job.value" :error="runner.error.value" @cancel="runner.cancel" @dismiss="runner.dismiss" />

    <div v-if="page?.endpoints.length" class="table-wrap">
      <table>
        <thead><tr><th>엔드포인트</th><th class="num">구독</th><th class="num">깨짐</th><th class="num">의심</th></tr></thead>
        <tbody>
          <tr v-for="e in page.endpoints" :key="e.endpoint" :class="{ picked: picked?.endpoint === e.endpoint }">
            <td class="mono path"><button class="linkish" @click="open(e)">{{ e.endpoint }}</button></td>
            <td class="num">{{ e.total.toLocaleString() }}</td>
            <td class="num" :class="{ bad: e.broken }">{{ e.broken.toLocaleString() }}</td>
            <td class="num" :class="{ warn: e.suspect }">{{ e.suspect.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="empty">구독이 없습니다.</p>

    <div v-if="picked" class="drawer">
      <div class="dhead">
        <strong class="mono">{{ picked.endpoint }}</strong>
        <span class="muted">표본 {{ sample.length }}건<span v-if="sampleMore"> · 더 있음(상한 200)</span></span>
        <span class="spacer" />
        <button @click="picked = null">닫기</button>
      </div>
      <p v-if="loadingSample" class="muted">읽는 중…</p>

      <div v-if="write.enabled && selected.size" class="actionbar">
        <strong>{{ selected.size }}건 선택</strong>
        <span class="muted">(깨짐 {{ brokenRows.filter((r) => selected.has(r.ri)).length }} · 의심 {{ suspectSelected }})</span>
        <button class="link" @click="selected = new Set()">선택 해제</button>
        <span class="spacer" />
        <button class="danger" @click="confirming = true">구독 삭제 ({{ selected.size }}건)</button>
      </div>

      <table v-if="sample.length" class="sample">
        <thead><tr><th class="cb"></th><th>구독 (ri)</th><th>판정</th><th>사유</th><th>nu</th></tr></thead>
        <tbody>
          <tr v-for="r in sample" :key="r.ri" :class="[r.severity ?? 'ok', { picked: selected.has(r.ri) }]">
            <td class="cb"><input type="checkbox" :checked="selected.has(r.ri)" :disabled="!write.enabled" :aria-label="r.ri + ' 선택'" @change="toggle(r.ri)" /></td>
            <td class="mono path">{{ r.ri }}</td>
            <td><span class="sev" :class="r.severity ?? 'ok'">{{ sev(r) }}</span></td>
            <td class="small">{{ r.reason ? (REASON_LABEL[r.reason] ?? r.reason) : '' }}</td>
            <td class="mono small nu">{{ r.nu.join(', ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ConfirmDialog v-if="confirming" title="구독을 삭제합니다" :confirm-label="`${selected.size}건 삭제`" :paths="selectedList" destructive :busy="starting" @cancel="confirming = false" @confirm="runDelete">
      <p class="dlg">되돌릴 수 없습니다. 삭제 직전에 여전히 구독인지 다시 확인합니다.</p>
      <p v-if="suspectSelected" class="dlg warn"><strong>의심 {{ suspectSelected }}건이 섞여 있습니다.</strong> 의심 구독은 지금 정상 동작 중일 수 있습니다 — 정말 지울 것인지 다시 보세요.</p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 80ch; }
.err { color: var(--danger); }
.muted { color: var(--muted); font-size: 0.92rem; }
.small { font-size: 0.88rem; }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.9rem; margin-bottom: 1.2rem; }
.tile { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; }
.tile.hot { border-color: var(--danger); }
.tile .k { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
.tile .v { font-size: 2.1rem; font-weight: 650; line-height: 1.25; letter-spacing: -0.02em; color: var(--text-strong); }
.tile .s { font-size: 0.86rem; color: var(--muted); }
.tile .s.warn { color: var(--warn); font-weight: 600; }
.table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: auto; max-height: 45vh; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.num.bad { color: var(--danger); font-weight: 600; }
.num.warn { color: var(--warn); font-weight: 600; }
.path { max-width: 520px; overflow-wrap: anywhere; font-size: 0.95rem; }
.linkish { border: none; background: none; padding: 0; font: inherit; color: var(--accent-strong); text-decoration: underline; cursor: pointer; text-align: left; }
tr.picked td { background: var(--accent-wash); }
.drawer { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1.2rem 1.4rem; margin-top: 1rem; }
.dhead { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.8rem; }
.dhead .spacer { flex: 1; }
.sample { font-size: 0.93rem; }
.sample tr.broken td:first-child { box-shadow: inset 3px 0 0 var(--danger); }
.sample tr.suspect td:first-child { box-shadow: inset 3px 0 0 var(--warn); }
.sev { font-size: 0.75rem; font-weight: 700; border-radius: 4px; padding: 0.05rem 0.4rem; white-space: nowrap; }
.sev.broken { background: var(--danger); color: #fff; }
.sev.suspect { background: var(--warn); color: #fff; }
.sev.ok { background: var(--accent-wash); color: var(--accent-strong); }
.nu { max-width: 360px; overflow-wrap: anywhere; color: var(--muted); }
.cb { width: 2.4rem; text-align: center; }
.cb input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); cursor: pointer; }
.actionbar { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; margin: 0.6rem 0 1rem; padding: 0.8rem 1rem; background: var(--accent-wash); border: 1px solid var(--accent); border-radius: 10px; }
.actionbar .spacer { flex: 1; }
.actionbar .link { border: none; background: none; color: var(--muted); text-decoration: underline; padding: 0; font-size: 0.92rem; }
.actionbar .danger { background: var(--danger); border-color: var(--danger); color: #fff; font-weight: 600; }
.dlg { margin: 0 0 0.6rem; font-size: 0.97rem; }
.dlg.warn { color: var(--danger); }
</style>
```

- [ ] **Step 4: 빌드와 시험**

Run: `cd admin/web && npm run build` → 통과. Run: `npm test`(저장소 루트) → 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add admin/api.js test/admin-api-subs.test.js admin/web/src
git commit -m "admin: 구독 엔드포인트 화면 — 롤업·표본·broken 만 미리 선택, sub-delete 작업

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: 문서 — `admin/README.md`, `CLAUDE.md`, 배포 절

**Files:**
- Modify: `admin/README.md`, `CLAUDE.md`(gitignore — 디스크만), 이 계획의 "배포 1차" 절(체크 표시는 배포하는 사람이 한다)

- [ ] **Step 1: `admin/README.md`**

"무엇을 보여 주는가" 에 절 셋을 더한다(기존 절 뒤):

```markdown
### 구독 (엔드포인트)

구독을 알림 주소(`nu`)의 `scheme://host` 로 묶어 본다. 배포는 구독 3,463건에 고유
`nu` 202개, 상위 3개가 57% 다 — 목록을 그대로 올리면 못 읽는다. 판정은 코어의
`audit_subscriptions` 그대로다. **깨짐(broken)만 미리 선택되고 의심(suspect)은
섞이지 않는다** — 의심은 지금 정상 동작 중일 수 있다.

### 관측

`통계` 는 코어의 `/hit`·`/total_ae`·`/total_cbs` 가 보여 주던 것이다. 그 경로는
인증 없이 외부에 열려 있어 코어에서 걷어냈고(2026-09-06), 이제 세션 뒤의 이
화면이 유일한 창이다. `작업` 은 최근 일괄 작업의 진행·결과다(메모리에만 있다).

### 고아 — 라이브 스캔은 없다

화면을 열어도 훑지 않는다. "탐지 시작" 이 작업으로 조각(5,000행)마다 상한(기본
20만 행)까지 훑어 표본(1,000건)을 `admin/data/orphans/<runId>.json` 에 남기고,
화면은 마지막 결과만 보여 준다. `lookup` 에만 남은 CIN(cin 표에 짝이 없는 ty=4)도
같은 작업의 둘째 단계로 표본만 뽑는다 — 세지 않는다(전수 카운트가 배포에서 532초).
```

"무엇을 할 수 있는가" 표에 `ACP 신규 생성`(AE 아래, 템플릿, 미리보기 뒤 POST) · `acpi 연결/해제`(AE 하나, 최대 7개, 목록에서 고름, PUT 한 번) · `구독 삭제`(broken 우선) · `고아 탐지`(작업) 행을 더한다.

"설계 메모" 에:

```markdown
- **코어 정책을 화면이 상수로 베끼지 않는다.** 만료 화면의 "et 를 늘릴 수 있는 타입",
  "만료 시 자동 삭제되는 타입" 은 `GET /api/expired/policy` 가 `mobius/expiry_policy.js`
  에서 받아 준다. 예전에 화면 상수로 두었다가 코어와 어긋났다(2026-09-01 §0층).
- **라우트는 `admin/api.js`** 의 `install(app, ctx)` 에 있다. `server.js` 는 conf 를 읽고
  `ctx` 를 만들어 넘긴다. 시험(`test/admin_app_helper.js`)이 같은 `install` 을 임시
  포트·어댑터 대역·가짜 CSE 로 띄운다.
- **결과 파일은 `admin/data/`** (gitignore). 고아 탐지 결과와 종합 테스트 이력.
- **화면은 Vue Router(hash)** 다. 화면마다 URL 이 있어 링크로 열 수 있다.
```

"실행" 의 빌드 명령 앞에 `npm install` 이 `vue-router` 를 가져온다는 한 줄.

- [ ] **Step 2: `CLAUDE.md`(디스크)**

`### 관리 콘솔 (admin/)` 절에 위 설계 메모 네 줄을 요약해 더하고, `## Commands` 의 시험 수치를 `npm test` 결과로 맞춘다. `mobius/expiry_policy.js`·`mobius/attr_lists.js` 를 핵심 모듈 표에 한 줄씩 더한다(`attr_lists`: "리소스 타입별 속성 목록 — resource.js 에서 분리, 전역도 세운다"; `expiry_policy`: "만료 정책의 단일 진실원 — 콘솔이 화면 상수 대신 읽는다"). `/hit`·`/total_*` 가 코어에서 사라졌다는 문장을 "지원하지 않는 것" 에 더한다.

- [ ] **Step 3: 커밋**

```bash
git add admin/README.md
git commit -m "docs(admin): 콘솔 2판 골격 — 구독·관측·고아 작업·정책 함수·api.js 구조

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 배포 1차 (사람이 한다) — 콘솔 2판 골격

- [ ] `git pull --ff-only origin lite` (서버 `/home/keti/Mobius`). 코어 변경이 있으므로 Mobius 재기동이 필요하다.
- [ ] 재기동 **전**: `node tools/response-golden/headers.js 7579 ~/golden-before-v2.json`.
- [ ] `pm2 restart Mobius --update-env` → `~/.pm2/logs/Mobius-out.log` 의 "running at 7579 port", 워커 24, `log/mobius-boot.jsonl` 25줄·capped 없음, `npm run status`.
- [ ] `node tools/response-golden/headers.js 7579 ~/golden-after-v2.json` → `--diff` 로 **29건 전부 동일** 이어야 한다(코어의 응답 경로를 안 건드렸다). `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7579/hit` 이 **404**.
- [ ] 콘솔: `cd admin/web && npm install && npm run build`, `pm2 restart mobius-admin`(콘솔을 pm2 로 띄워 두었다면; 아니면 `node admin/server.js`). 브라우저에서 네 묶음이 보이고 `#/observe/stats` 에 AE 수·CIN 바이트가 나온다.
- [ ] 고아 화면에서 "탐지 시작"(상한 5만 행) → 작업 완료 → 표본이 보인다. `admin/data/orphans/` 에 파일 하나.
- [ ] 구독 화면에서 엔드포인트 표(202개 근처)와 깨짐/의심 건수가 나온다. **삭제는 하지 않는다.**
- [ ] 만료 화면의 자동 정리 열이 전부 "자동 삭제 안 됨" 이고, fcnt 를 선택했을 때 연장 건수에 포함된다.
- [ ] 접근 로그에서 재기동 이후 5xx 0 (`awk '$9 ~ /^5/'` 류로, 중단된 요청 `-` 는 따로).

---

## 자체 점검 (계획 작성 후)

**스펙 대조** — §1 목적 선언·비목표 → Global Constraints. §2.1 표: 만료(Task 6·11), 고아(9·12), ACP 문제(11), ACP 목록 생성·연결(8·13), 시뮬레이터 경고(5·11), 구독(2·7·14), 통계(3·6·10), 작업(10), 종합 테스트 자리표시(10, 본체는 2/2). §2.2 셸(10). §3.1(1·6·11) §3.2(11) §3.3(2·9·12) §3.4(5·11). §4(8·13). §5(2·7·14). §6.1(3·6·10) §6.2(10). §8 코어 변경 다섯: attr_lists+expiry_policy(1), sql_action 셋(2), extra_api_action(3), cse.js(4), 시험 이전(3 — 주석뿐이라 이전할 시험이 없었다: `test/no-extra-api.test.js` 가 그 자리). §10 오류 처리: CSE 거절 전달(8), 조각 실패 기록(9), 이력 원자적 쓰기(9), 작업 슬롯 409(9·14). §11: 카탈로그·실행기 시험은 2/2, 라우트 시험(5~9·14), 코어 회귀(3, 골든은 배포 절), 프런트 빌드(10~14). §12 배포(배포 1차 절).

**스펙과 다르게 한 것** — (1) 스펙 §5 는 구독 삭제를 "작업 엔진 경유" 라고만 했다. 기존 `orphan-delete` 를 재활용하면 프리플라이트가 "부모 없음" 을 보므로 구독을 못 지운다 — `sub-delete` 작업을 하나 더 두었다(Task 14). (2) 스펙 §3.1 은 "코어에 export 가 없으면 만든다" 였고, 실제로 없어서 `attr_lists.js` 분리까지 갔다 — `resource.js` 가 sgn 을 끌고 와 콘솔이 require 할 수 없기 때문이다. (3) 스펙 §7.11 의 종합 테스트 API 는 이 계획에 없다 — 2/2.

**이름 일관성** — `expiry_policy.etExtendableTypes/autoDeletedTypes` (1·6·11), `select_sub_endpoint_rollup/select_subs_by_endpoint/select_lookup_only_cin_page` (2·7·9), `Client.request(…, opts)/create` (4·8), `install(app, ctx)`·`ctx.{conf,password,db,db_sql,responder,acp_simulate,acp_lint,acp_rules,expiry_policy,jobs,cse,cseHost,csePort,cseOrigin,superUser,dataDir}` (5~9·2/2), `boot()` 헬퍼의 `{ request, login, close, calls, cse.calls, dataDir }` (5~9·14), `data_dir.{file,writeJson,listJson,readJson,keepLatest}` (9·2/2), `orphan_scan.start(ctx, opts)` (9), 라우트 이름 `judge-*`·`subs-endpoints`·`observe-*`·`verify-selftest` (10~14·2/2), `api.ts` 의 `expiredPolicy/statsHit/statsTotalAe/statsTotalCbs/jobList/startOrphanScan/orphanLast/acpCreate/acpAttach/subsEndpoints/subsSample/startSubDelete` (10~14).

**`test/conf-schema.test.js`** — 콘솔 키 리더는 `admin/server.js` 다. Task 5 가 `conf.admin*` 여섯 읽기를 그 파일에 남긴다. 2/2 가 더하는 `adminSelftestPort/Host` 도 그 파일에서 읽는다.
