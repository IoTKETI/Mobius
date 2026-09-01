# 관리 콘솔 선행 작업 (Mobius 본체) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리 콘솔이 올바르게 동작하기 위해 Mobius 본체가 먼저 갖춰야 할 네 가지 — 워커 간 캐시 무효화, 리소스별 사용 이력 수집, 인덱스, ACP 판정 로직 공유 — 를 구현한다.

**Architecture:** 콘솔은 별도 프로세스이므로 이 계획에는 콘솔 코드가 없다. 전부 Mobius 본체 변경이며, 각 태스크는 콘솔 없이도 그 자체로 버그 수정이거나 성능 개선이다. ACP 판정은 순수 함수(`mobius/acp_eval.js`)로 뽑아 서버와 콘솔이 같은 코드를 쓰게 하고, 사용 이력은 워커별 인메모리 버퍼를 거쳐 배치로 기록해 요청 경로에 DB 쓰기를 늘리지 않는다.

**Tech Stack:** Node.js, Express 4, `cluster`, MySQL(`mysql` 드라이버) / SQLite(`sqlite3`), knex 3.3.0(빌더 전용), `node --test`

**Spec:** [docs/superpowers/specs/2026-08-28-admin-console-design.md](../specs/2026-08-28-admin-console-design.md)

## Global Constraints

- **코드 스타일**: `var` 선언, `util.format()` 문자열 조립, 세미콜론. 주변 코드를 따른다. 새 파일도 `'use strict';` + `var` 로 쓴다
- **비동기 패턴**: 콜백 스타일 `(err, result) => {}`. 기존 함수 시그니처를 바꾸지 않는다
- **에러 코드**: oneM2M RSC 를 문자열 리터럴로 (`'200'`, `'404-1'`, `'500-4'`). 상수 모듈 없음
- **DB 쿼리**: SQL 은 `mobius/sql_action.js` 에만 둔다. 새 쿼리는 `mobius/db` 파사드(`db.k()` 빌더)를 쓴다 — `util.format` 문자열 조립을 새로 만들지 않는다
- **설정 접근**: `global.*` 을 직접 읽는다. 설정 모듈 없음. 새 설정은 `conf.json` → `mobius.js` 의 `global.*` 대입으로 잇는다
- **로깅**: `console.log` / `console.error`. **요청마다 응답 본문이나 DB 행 전체를 덤프하지 않는다**
- **클러스터 전제**: 워커가 여러 개다. 카운터는 상대 증분(`SET x = x + delta`), 읽고-쓰는 구간은 락이나 트랜잭션으로 보호
- **배포 종속 값 금지**: 경로명·호스트·자격증명을 코드에 넣지 않는다. `conf.json` 으로 뺀다
- **테스트 실행**: `npm test` = `node --test test/*.test.js`. 단일 파일은 `node --test test/<name>.test.js`
- **SQLite 스키마 제약**: `mobiusdb_sqlite.sql` 은 `CREATE TABLE IF NOT EXISTS` 라 기존 DB 에 **컬럼을 추가하지 못한다.** 단 `CREATE INDEX IF NOT EXISTS` 와 신규 `CREATE TABLE` 은 기존 DB 에도 적용된다
- **동작 보존 원칙**: 이 계획의 리팩터링(Task 1·2)은 **기존 동작을 한 비트도 바꾸지 않는다.** ACP 판정의 알려진 결함(스펙 §1.8 `acor` 정규식 역전)도 그대로 보존하며, 수정은 별건으로 분리한다

---

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `mobius/acp_eval.js` | 신규 | ACP 판정 순수 함수. DB·request 의존 없음. 서버와 콘솔이 공유 |
| `mobius/security.js` | 수정 | DB 조회·상속 탐색만 남기고 판정은 `acp_eval` 에 위임 |
| `mobius/mobiusdb_sqlite.sql` | 수정 | 인덱스 5개 + `hit_ri` 테이블 추가 |
| `docs/mysql-migration-2.7.md` | 신규 | MySQL 인덱스·테이블 마이그레이션 SQL |
| `app.js` | 수정 | 캐시 무효화 IPC, 캐시 상한, `hit_ri` 수집 배선 |
| `mobius/cache_man.js` | 신규 | `cache_resource_url` 의 상한·무효화·IPC 를 한곳에 모은다 |
| `mobius/hit_man.js` | 신규 | `hit_ri` 인메모리 버퍼와 주기 flush |
| `mobius/sql_action.js` | 수정 | `upsert_hit_ri_batch`, `delete_hit_ri_old`, `delete_lookup_et` 진단 로그 |
| `mobius.js` | 수정 | `conf.json` 의 `superuser`/`adminOrigin`/`hitRi` 를 `global.*` 로 |
| `test/acp-eval.test.js` | 신규 | 판정 순수 함수 특성화 테스트 |
| `test/cache-man.test.js` | 신규 | 캐시 상한·무효화 키 확장 테스트 |
| `test/hit-man.test.js` | 신규 | 버퍼 누적·CIN 귀속·콘솔 제외·flush |
| `test/prereq-queries.test.js` | 신규 | 신규 SQL 의 SQL/bindings 잠금 |

`cache_man.js` 와 `hit_man.js` 를 별도 파일로 뽑는 이유: `app.js` 가 이미 150KB 다. 여기에 IPC 프로토콜과 버퍼 관리를 인라인으로 더하면 테스트가 불가능해진다. 두 모듈 다 순수 로직과 I/O 를 분리해 단위 테스트가 가능한 형태로 만든다.

---

### Task 1: `acp_eval.js` — ACP 판정 순수 함수 추출

현재 판정 로직은 `security.js` 의 `security_check_action_pv`(24-207행)와 `security_check_action_pvs`(209-380행)에 **거의 동일한 코드로 두 번** 들어있고, 둘 다 `request`/`response`/DB 커넥션에 묶여 있어 단위 테스트가 불가능하다. 콘솔의 유효 권한 표가 서버와 일치하려면 이 판정을 공유해야 한다.

**이 태스크는 동작을 바꾸지 않는다.** 알려진 결함(정규식 역전, `actw` 의 OR 판정)까지 그대로 옮기고, 각 결함에 주석으로 표시만 한다.

**Files:**
- Create: `mobius/acp_eval.js`
- Test: `test/acp-eval.test.js`

**Interfaces:**
- Consumes: 없음 (순수 함수, 의존성 없음)
- Produces:
  - `ACOP` — `{CREATE:1, RETRIEVE:2, UPDATE:4, DELETE:8, NOTIFY:16, DISCOVERY:32}`
  - `evaluatePrivileges(privList, ctx)` → `{allowed:boolean, reason:string, matchedIndex:number|null, acorWasRegex:boolean}`
    - `privList`: `pv` 또는 `pvs` 객체의 배열. 각 원소는 `{acr:[...]}`
    - `ctx`: `{originator:string, acop:number, clientIp:string, now:Date, creator:string}`
    - `reason` ∈ `'acr-match' | 'no-acr-matched'`
  - `evaluateDefault(ctx, enforcement)` → `{allowed:boolean, reason:string}`
    - `enforcement`: `'enable'` | `'disable'`
    - `reason` ∈ `'creator' | 'default-open' | 'denied'`
  - `evaluateBrokenAcpi(ctx)` → `{allowed:boolean, reason:string}` — `reason` ∈ `'creator' | 'denied'`

- [ ] **Step 1: 특성화 테스트를 먼저 쓴다**

`test/acp-eval.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const acp = require('../mobius/acp_eval');

const NOW = new Date(Date.UTC(2026, 7, 28, 10, 30, 45)); // 2026-08-28 10:30:45 UTC (금요일)

function ctx(over) {
    return Object.assign({
        originator: 'CAdmin',
        acop: acp.ACOP.RETRIEVE,
        clientIp: '10.0.0.5',
        now: NOW,
        creator: 'CCreator'
    }, over || {});
}

test('acor 가 정확히 일치하고 acop 비트를 포함하면 허용', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: 63 }] }];
    const r = acp.evaluatePrivileges(pv, ctx());
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.reason, 'acr-match');
    assert.strictEqual(r.matchedIndex, 0);
});

test('acop 비트가 모자라면 거부', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: acp.ACOP.RETRIEVE }] }];
    const r = acp.evaluatePrivileges(pv, ctx({ acop: acp.ACOP.DELETE }));
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.reason, 'no-acr-matched');
});

test('acor 가 다르면 거부', function () {
    const pv = [{ acr: [{ acor: ['SomeoneElse'], acop: 63 }] }];
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, false);
});

test("acor 'all' 과 '*' 는 누구에게나 허용", function () {
    assert.strictEqual(acp.evaluatePrivileges([{ acr: [{ acor: ['all'], acop: 63 }] }], ctx()).allowed, true);
    assert.strictEqual(acp.evaluatePrivileges([{ acr: [{ acor: ['*'], acop: 63 }] }], ctx()).allowed, true);
});

test('acr 에 acor 가 아예 없으면 무조건 허용 (기존 동작)', function () {
    const pv = [{ acr: [{ acop: 63 }] }];
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, true);
});

// 스펙 §1.8 — 알려진 결함. 이 테스트는 결함이 "보존되었음"을 잠근다.
// 별건 보안 수정에서 이 테스트가 깨지면 그게 의도된 변경이다.
test('KNOWN BUG: originator 가 정규식으로 쓰여 .* 가 모든 acor 를 매칭한다', function () {
    const pv = [{ acr: [{ acor: ['OnlyThisAE'], acop: 63 }] }];
    const r = acp.evaluatePrivileges(pv, ctx({ originator: '.*' }));
    assert.strictEqual(r.allowed, true, '현재 서버는 이걸 허용한다');
    assert.strictEqual(r.acorWasRegex, true);
});

test('정규식으로 깨지는 originator 는 예외를 던지지 않고 거부', function () {
    const pv = [{ acr: [{ acor: ['x'], acop: 63 }] }];
    const r = acp.evaluatePrivileges(pv, ctx({ originator: '[' }));
    assert.strictEqual(r.allowed, false);
});

test('acco.acip.ipv4 목록에 있으면 허용, 없으면 거부', function () {
    const mk = (ips) => [{ acr: [{ acor: ['CAdmin'], acop: 63, acco: [{ acip: { ipv4: ips } }] }] }];
    assert.strictEqual(acp.evaluatePrivileges(mk(['10.0.0.5']), ctx()).allowed, true);
    assert.strictEqual(acp.evaluatePrivileges(mk(['10.0.0.9']), ctx()).allowed, false);
});

test('acco 가 빈 배열이면 제약 없음으로 통과 (기존 동작)', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: 63, acco: [] }] }];
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, true);
});

// KNOWN QUIRK: 원본은 6개 필드 중 하나만 맞아도 허용한다 (AND 가 아니라 OR).
// actw 필드 순서는 [초, 분, 시, 일, 월, 요일] 이다.
test('KNOWN QUIRK: actw 는 6개 필드 중 하나만 일치해도 허용', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: 63, acco: [{ actw: ['* * 10 * * *'] }] }] }];
    // now 의 hour = 10, 세 번째 필드(index 2)가 시(hour)
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, true);
});

test('evaluateDefault: 생성자는 enforcement 와 무관하게 전권', function () {
    const c = ctx({ originator: 'CCreator', acop: acp.ACOP.DELETE });
    assert.deepStrictEqual(acp.evaluateDefault(c, 'disable'), { allowed: true, reason: 'creator' });
    assert.deepStrictEqual(acp.evaluateDefault(c, 'enable'), { allowed: true, reason: 'creator' });
});

test('evaluateDefault: disable 이면 그 외 origin 은 C/R/Discovery 만 허용', function () {
    for (const op of [acp.ACOP.CREATE, acp.ACOP.RETRIEVE, acp.ACOP.DISCOVERY]) {
        assert.strictEqual(acp.evaluateDefault(ctx({ acop: op }), 'disable').allowed, true);
    }
    for (const op of [acp.ACOP.UPDATE, acp.ACOP.DELETE, acp.ACOP.NOTIFY]) {
        assert.strictEqual(acp.evaluateDefault(ctx({ acop: op }), 'disable').allowed, false);
    }
});

test('evaluateDefault: enable 이면 그 외 origin 은 전부 거부', function () {
    assert.strictEqual(acp.evaluateDefault(ctx({ acop: acp.ACOP.RETRIEVE }), 'enable').allowed, false);
});

test('evaluateBrokenAcpi: ACP 를 못 찾으면 생성자만 허용', function () {
    assert.strictEqual(acp.evaluateBrokenAcpi(ctx({ originator: 'CCreator' })).allowed, true);
    assert.strictEqual(acp.evaluateBrokenAcpi(ctx({ originator: 'Other' })).allowed, false);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test test/acp-eval.test.js`
Expected: FAIL — `Cannot find module '../mobius/acp_eval'`

- [ ] **Step 3: `mobius/acp_eval.js` 를 구현한다**

```js
'use strict';
// ACP 판정 순수 함수.
//
// security.js 의 security_check_action_pv / _pvs 에서 판정부만 뽑았다.
// DB, request, response 에 의존하지 않으므로 관리 콘솔이 같은 코드를 쓸 수 있다.
//
// 동작 보존이 이 모듈의 계약이다. 원본의 결함(아래 KNOWN 주석)까지 그대로 옮겼다.
// 고칠 때는 test/acp-eval.test.js 의 KNOWN 테스트를 함께 바꿔야 한다.

var ACOP = {
    CREATE: 1, RETRIEVE: 2, UPDATE: 4, DELETE: 8, NOTIFY: 16, DISCOVERY: 32
};

// acco[].acip 검사. acco 가 없거나 비면 제약 없음으로 통과한다.
function checkAcip(acco_entry, clientIp) {
    if (!acco_entry.hasOwnProperty('acip')) { return true; }
    var acip = acco_entry.acip;

    if (acip.hasOwnProperty('ipv4')) {
        var list4 = acip['ipv4'];
        for (var i in list4) {
            if (list4.hasOwnProperty(i) && list4[i] === clientIp) { return true; }
        }
        return false;
    }
    if (acip.hasOwnProperty('ipv6')) {
        var list6 = acip['ipv6'];
        for (var j in list6) {
            if (list6.hasOwnProperty(j) && list6[j] === clientIp) { return true; }
        }
        return false;
    }
    return true;
}

// KNOWN QUIRK: 원본(security.js)은 6개 필드 중 하나라도 일치하면 허용한다.
// 정상적인 시간창 의미(모든 필드가 맞아야 함)가 아니지만 동작을 보존한다.
// 필드 순서는 [초, 분, 시, 일, 월, 요일].
function checkActw(acco_entry, now) {
    if (!acco_entry.hasOwnProperty('actw')) { return true; }

    var cur = [
        now.getUTCSeconds(), now.getUTCMinutes(), now.getUTCHours(),
        now.getUTCDate(), now.getUTCMonth() + 1, now.getUTCDay()
    ];

    for (var idx in acco_entry.actw) {
        if (!acco_entry.actw.hasOwnProperty(idx)) { continue; }
        var parts = String(acco_entry.actw[idx]).split(' ');
        for (var d = 0; d < 6; d++) {
            if (parts[d] !== '*' && parts[d] === cur[d].toString()) { return true; }
        }
    }
    return false;
}

// acco 배열 전체를 본다. 배열이 비어 있으면 제약 없음으로 통과한다
// (원본의 acco_idx == 99 분기와 같은 결과).
function checkAcco(acr, ctx) {
    if (!acr.hasOwnProperty('acco')) { return true; }
    var acco = acr.acco;
    var sawEntry = false;

    for (var idx in acco) {
        if (!acco.hasOwnProperty(idx)) { continue; }
        sawEntry = true;
        if (checkAcip(acco[idx], ctx.clientIp) && checkActw(acco[idx], ctx.now)) {
            return true;
        }
    }
    return !sawEntry;
}

// KNOWN BUG (스펙 §1.8): 원본은 요청자의 originator 로 정규식을 만들고
// 저장된 acor 값을 그 패턴에 매칭한다 — 방향이 뒤집혀 있다.
// X-M2M-Origin: .* 로 보내면 모든 acor 를 통과한다.
// 이 모듈은 동작을 보존하며, 호출자가 알 수 있도록 acorWasRegex 를 돌려준다.
function checkAcor(acr, originator) {
    if (!acr.hasOwnProperty('acor')) { return { ok: true, usedRegex: false }; }

    var re = null;
    try {
        re = new RegExp('^' + originator + '$');
    } catch (e) {
        re = null; // 정규식으로 깨지는 originator 는 매칭 실패로 취급
    }

    for (var idx in acr.acor) {
        if (!acr.acor.hasOwnProperty(idx)) { continue; }
        var value = acr.acor[idx];
        if ((re && re.test(value)) || value === 'all' || value === '*') {
            return { ok: true, usedRegex: true };
        }
    }
    return { ok: false, usedRegex: true };
}

// pv 또는 pvs 객체들의 배열을 판정한다.
exports.evaluatePrivileges = function (privList, ctx) {
    var sawRegex = false;

    for (var p in privList) {
        if (!privList.hasOwnProperty(p)) { continue; }
        var priv = privList[p];
        if (!priv || !priv.hasOwnProperty('acr')) { continue; }

        for (var index in priv.acr) {
            if (!priv.acr.hasOwnProperty(index)) { continue; }
            var acr = priv.acr[index];

            if (!checkAcco(acr, ctx)) { continue; }

            var acorResult = checkAcor(acr, ctx.originator);
            if (acorResult.usedRegex) { sawRegex = true; }
            if (!acorResult.ok) { continue; }

            // 원본과 동일: 요청한 비트가 acop 에 전부 들어 있어야 한다.
            if ((Number(acr.acop) & ctx.acop) === ctx.acop) {
                return {
                    allowed: true, reason: 'acr-match',
                    matchedIndex: Number(index), acorWasRegex: sawRegex
                };
            }
        }
    }

    return { allowed: false, reason: 'no-acr-matched', matchedIndex: null, acorWasRegex: sawRegex };
};

// acpi 를 하나도 못 찾았을 때의 폴백.
// security.js:384 security_default_check_action 을 그대로 옮겼다.
exports.evaluateDefault = function (ctx, enforcement) {
    if (ctx.originator === ctx.creator) {
        return { allowed: true, reason: 'creator' };
    }
    if (enforcement === 'enable') {
        return { allowed: false, reason: 'denied' };
    }
    var open = ACOP.CREATE | ACOP.RETRIEVE | ACOP.DISCOVERY;
    if (ctx.acop & open) {
        return { allowed: true, reason: 'default-open' };
    }
    return { allowed: false, reason: 'denied' };
};

// acpi 가 가리키는 ACP 행이 조회되지 않을 때 (깨진 참조).
// security.js:30-37 과 동일 — 거부가 아니라 생성자 폴백이다.
exports.evaluateBrokenAcpi = function (ctx) {
    if (ctx.originator === ctx.creator) {
        return { allowed: true, reason: 'creator' };
    }
    return { allowed: false, reason: 'denied' };
};

exports.ACOP = ACOP;
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `node --test test/acp-eval.test.js`
Expected: PASS — 14 tests

`KNOWN QUIRK: actw` 테스트가 실패하면 `checkActw` 의 필드 순서를 확인한다. `now.getUTCHours()` 가 `cur[2]` 여야 하고 `'* * 10 * * *'` 의 `parts[2]` 가 `'10'` 이어야 한다.

- [ ] **Step 5: 커밋**

```bash
git add mobius/acp_eval.js test/acp-eval.test.js
git commit -m "refactor: ACP 판정을 순수 함수로 추출 (동작 보존)"
```

---

### Task 2: `security.js` 를 `acp_eval` 에 위임

Task 1 이 만든 함수를 실제로 쓰게 한다. `security.js` 에는 DB 조회와 상속 탐색만 남는다. 중복된 `_pv` / `_pvs` 두 벌의 판정 코드가 사라진다.

**Files:**
- Modify: `mobius/security.js:24-207` (`security_check_action_pv`), `mobius/security.js:209-380` (`security_check_action_pvs`), `mobius/security.js:384-405` (`security_default_check_action`)
- Test: `test/acp-eval.test.js` (기존), `tools/equivalence` 하네스

**Interfaces:**
- Consumes: Task 1 의 `evaluatePrivileges(privList, ctx)`, `evaluateDefault(ctx, enforcement)`, `evaluateBrokenAcpi(ctx)`, `ACOP`
- Produces: 없음 (외부 시그니처 불변 — `exports.check(request, response, ty, acpiList, access_value, cr, callback)` 그대로)

- [ ] **Step 1: 전환 전 동등성 스냅샷을 뜬다**

Run: `node tools/equivalence/run-scenarios.js`
결과를 `tools/equivalence/out/before-task2.json` 으로 보관한다. 전환 후 이 파일과 비교하는 것이 이 태스크의 검증이다.

```bash
cp tools/equivalence/out/latest.json tools/equivalence/out/before-task2.json
```

파일명이 다르면 `tools/equivalence/README.md` 를 읽고 실제 산출물 경로를 쓴다.

- [ ] **Step 2: 클라이언트 IP 추출을 헬퍼로 뽑는다**

`security.js` 상단(`var moment = require('moment');` 아래)에 추가:

```js
var acp_eval = require('./acp_eval');

// 원본이 acip 검사 안에서 하던 IP 추출을 그대로 옮겼다.
function client_ip_of(request) {
    if (request.headers.hasOwnProperty('remoteaddress')) {
        return request.headers.remoteaddress;
    }
    if (request.connection.remoteAddress === '::1') {
        return ip.address();
    }
    return request.connection.remoteAddress.replace('::ffff:', '');
}

function ctx_of(request, access_value, cr) {
    return {
        originator: request.headers['x-m2m-origin'],
        acop: parseInt(access_value, 10),
        clientIp: client_ip_of(request),
        now: new Date(),
        creator: cr
    };
}
```

- [ ] **Step 3: `security_check_action_pv` 본문을 교체한다**

24-207행의 함수 전체를 아래로 바꾼다:

```js
function security_check_action_pv(request, response, acpiList, cr, access_value, callback) {
    make_internal_ri(acpiList);
    var ri_list = [];
    get_ri_list_sri(request, response, acpiList, ri_list, 0, function (code) {
        if (code !== '200') {
            callback(code);
            return;
        }
        db_sql.select_acp_in(request.db_connection, ri_list, function (err, results_acp) {
            if (err) {
                console.log('query error: ' + results_acp.message);
                callback('500-1');
                return;
            }

            var ctx = ctx_of(request, access_value, cr);

            if (results_acp.length === 0) {
                callback(acp_eval.evaluateBrokenAcpi(ctx).allowed ? '1' : '0');
                return;
            }

            var privList = [];
            for (var i = 0; i < results_acp.length; i++) {
                try {
                    privList.push(JSON.parse(results_acp[i].pv));
                } catch (e) {
                    console.log('[security_check_action_pv] bad pv json: ' + (e.message || e));
                    callback('500-1');
                    return;
                }
            }

            callback(acp_eval.evaluatePrivileges(privList, ctx).allowed ? '1' : '0');
        });
    });
}
```

- [ ] **Step 4: `security_check_action_pvs` 본문을 교체한다**

209-380행의 함수 전체를 아래로 바꾼다. `pv` 대신 `pvs` 를 읽는 것만 다르다:

```js
function security_check_action_pvs(request, response, acpiList, access_value, cr, callback) {
    make_internal_ri(acpiList);
    var ri_list = [];
    get_ri_list_sri(request, response, acpiList, ri_list, 0, function (code) {
        if (code !== '200') {
            callback(code);
            return;
        }
        db_sql.select_acp_in(request.db_connection, ri_list, function (err, results_acp) {
            if (err) {
                console.log('query error: ' + results_acp.message);
                callback('500-1');
                return;
            }

            var ctx = ctx_of(request, access_value, cr);

            if (results_acp.length === 0) {
                callback(acp_eval.evaluateBrokenAcpi(ctx).allowed ? '1' : '0');
                return;
            }

            var privList = [];
            for (var i = 0; i < results_acp.length; i++) {
                try {
                    privList.push(JSON.parse(results_acp[i].pvs));
                } catch (e) {
                    console.log('[security_check_action_pvs] bad pvs json: ' + (e.message || e));
                    callback('500-1');
                    return;
                }
            }

            callback(acp_eval.evaluatePrivileges(privList, ctx).allowed ? '1' : '0');
        });
    });
}
```

- [ ] **Step 5: `security_default_check_action` 을 교체한다**

384-405행:

```js
function security_default_check_action(request, response, cr, access_value, callback) {
    var result = acp_eval.evaluateDefault(ctx_of(request, access_value, cr), useaccesscontrolpolicy);
    callback(result.allowed ? '1' : '0');
}
```

- [ ] **Step 6: 이제 안 쓰는 `console.log('%%%...')` 디버그 출력이 사라졌는지 확인한다**

Run: `grep -n "%%%%%" mobius/security.js`
Expected: 출력 없음. 남아 있으면 Step 3 의 교체가 불완전한 것이다.

- [ ] **Step 7: 단위 테스트와 동등성 하네스를 돌린다**

Run: `node --test test/acp-eval.test.js`
Expected: PASS (Task 1 과 동일)

Run: `node tools/equivalence/run-scenarios.js`
Then: `node tools/equivalence/compare.js tools/equivalence/out/before-task2.json tools/equivalence/out/latest.json`
Expected: 차이 없음. **차이가 있으면 동작이 바뀐 것이므로 커밋하지 말고 원인을 찾는다.**

- [ ] **Step 8: 커밋**

```bash
git add mobius/security.js
git commit -m "refactor: security.js 판정을 acp_eval 에 위임 — 중복 코드 제거"
```

---

### Task 3: 인덱스 추가 (SQLite 스키마 + MySQL 마이그레이션)

트리 자식 조회, 만료 필터, 컨테이너 내 CIN 페이징이 현재 두 백엔드 모두 풀스캔이거나 filesort 다. 스펙 §1.2·§5.2 참조.

**Files:**
- Modify: `mobius/mobiusdb_sqlite.sql`
- Create: `docs/mysql-migration-2.7.md`
- Modify: `README.md` (마이그레이션 안내 링크)

**Interfaces:**
- Consumes: 없음
- Produces: 인덱스 `idx_lookup_pi`, `idx_lookup_ty_et`, `idx_lookup_pi_sri`, `idx_cin_pi` (SQLite). MySQL 은 문서로 제공

- [ ] **Step 1: SQLite 스키마에 인덱스를 추가한다**

`mobius/mobiusdb_sqlite.sql` 맨 아래에 추가:

```sql
-- 인덱스 (2.7). CREATE TABLE 과 달리 CREATE INDEX 는 기존 DB 에도 적용된다.
-- 근거는 docs/superpowers/specs/2026-08-28-admin-console-design.md §1.2, §5.2
CREATE INDEX IF NOT EXISTS idx_lookup_pi     ON lookup(pi);
CREATE INDEX IF NOT EXISTS idx_lookup_ty_et  ON lookup(ty, et);
CREATE INDEX IF NOT EXISTS idx_lookup_pi_sri ON lookup(pi, sri);
CREATE INDEX IF NOT EXISTS idx_cin_pi        ON cin(pi);
```

- [ ] **Step 2: 인덱스가 실제로 붙는지 확인한다**

기존 개발 DB 를 복사해 실험한다 (원본을 건드리지 않는다):

```bash
cp mobius.db /tmp/idx-test.db
node -e "
const s=require('sqlite3');const fs=require('fs');
const db=new s.Database('/tmp/idx-test.db');
db.exec(fs.readFileSync('mobius/mobiusdb_sqlite.sql','utf8'), e=>{
  if(e){console.error('FAIL',e);process.exit(1);}
  db.all(\"SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name\",
    (e2,r)=>{console.log(r.map(x=>x.name).join('\n'));db.close();});
});
"
```

Expected 출력:
```
idx_cin_pi
idx_lookup_pi
idx_lookup_pi_sri
idx_lookup_ty_et
```

- [ ] **Step 3: 인덱스가 실제로 쓰이는지 쿼리 플랜으로 확인한다**

```bash
node -e "
const s=require('sqlite3');const db=new s.Database('/tmp/idx-test.db');
const qs=[
 \"EXPLAIN QUERY PLAN SELECT ri FROM lookup WHERE pi='/Mobius/ae_test' AND ty<>4\",
 \"EXPLAIN QUERY PLAN SELECT ri FROM lookup WHERE ty IN (2,3) AND et<'20260828T000000' ORDER BY et\",
 \"EXPLAIN QUERY PLAN SELECT ri FROM lookup WHERE pi='/Mobius/ae_test/cnt1' ORDER BY sri DESC\"
];
let i=0;(function next(){ if(i>=qs.length){db.close();return;}
 db.all(qs[i], (e,r)=>{console.log(qs[i].slice(24,70)+' ->', r.map(x=>x.detail).join(' | ')); i++; next();});})();
"
```

Expected: 세 줄 전부 `USING INDEX idx_...` 를 포함한다. `SCAN lookup` 만 나오면 인덱스가 안 쓰인 것이다.

- [ ] **Step 4: MySQL 마이그레이션 문서를 만든다**

`docs/mysql-migration-2.7.md`:

```markdown
# MySQL 마이그레이션 — 2.7 (관리 콘솔 선행 작업)

기존 MySQL 설치에 아래를 적용한다. SQLite 는 기동 시 자동 적용되므로 불필요하다.

## 1. 인덱스

`idx_lookup_pi` 는 스키마에 이미 있으나 `INVISIBLE` 로 선언되어 옵티마이저가 무시한다.

```sql
ALTER TABLE lookup ALTER INDEX idx_lookup_pi VISIBLE;
CREATE INDEX idx_lookup_ty_et  ON lookup(ty, et);
CREATE INDEX idx_lookup_pi_sri ON lookup(pi, sri);
```

`cin` 은 `cin_ri_idx(pi,ri,cs)` 가 이미 `pi` 로 시작하므로 추가 인덱스가 필요 없다.

### 보류: `lookup(ty, ri)`

경로 접두어 범위 안에서 타입을 거르는 질의(`WHERE ri >= ? AND ri < ? AND ty <> 4`)에는 `(ty, ri)` 가 유리하다. 하지만 `lookup` 은 CIN 등록마다 INSERT 가 일어나는 쓰기 집중 테이블이고, 이 계획은 이미 인덱스 3개를 추가한다. 네 번째 인덱스의 쓰기 비용이 조회 이득보다 큰지는 **콘솔의 scope 필터 화면을 실제로 만든 뒤 측정해서 판단한다.** 지금 추가하지 않는다.


## 2. `hit_ri` 테이블

```sql
CREATE TABLE IF NOT EXISTS hit_ri (
  ri   varchar(200) NOT NULL,
  ct   varchar(8)   NOT NULL,
  http int NOT NULL DEFAULT 0,
  mqtt int NOT NULL DEFAULT 0,
  coap int NOT NULL DEFAULT 0,
  ws   int NOT NULL DEFAULT 0,
  PRIMARY KEY (ri, ct),
  KEY idx_hit_ri_ct (ct)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

## 운영 주의

대형 `lookup` 테이블에 `CREATE INDEX` 는 락을 잡을 수 있다. MySQL 5.6 이상은
온라인 DDL 을 지원하지만 배포처 버전과 부하를 확인하고 트래픽이 적은 시간에
적용한다. 필요하면 `ALGORITHM=INPLACE, LOCK=NONE` 을 명시한다:

```sql
CREATE INDEX idx_lookup_ty_et ON lookup(ty, et) ALGORITHM=INPLACE, LOCK=NONE;
```
```

- [ ] **Step 5: README 에 링크를 추가한다**

`README.md` 의 `### Migration Notes` 절 마지막 줄 뒤에 추가:

```markdown
- **2.7 마이그레이션.** 관리 콘솔 선행 작업으로 인덱스와 `hit_ri` 테이블이 추가되었다. MySQL 사용자는 [docs/mysql-migration-2.7.md](docs/mysql-migration-2.7.md) 를 적용한다. SQLite 는 기동 시 자동 적용된다.
```

- [ ] **Step 6: 서버가 정상 기동하는지 확인한다**

```bash
rm -f /tmp/idx-test.db
node mobius.js sqlite
```

Expected: `SQLite Schema Initialized` 와 `mobius server ... running at 7579 port` 가 뜬다. 스키마 에러가 없어야 한다. 확인 후 Ctrl+C.

- [ ] **Step 7: 커밋**

```bash
git add mobius/mobiusdb_sqlite.sql docs/mysql-migration-2.7.md README.md
git commit -m "perf: lookup/cin 인덱스 추가 + MySQL 마이그레이션 문서"
```

---

### Task 4: 워커 간 캐시 무효화 (`cache_man.js` + IPC)

현재 `process.send` 가 코드 전체에 한 곳도 없다. 워커 A 가 지운 리소스를 워커 B~N 이 계속 200 으로 돌려준다. 스펙 §1.4.

**Files:**
- Create: `mobius/cache_man.js`
- Modify: `app.js:58` (전역 선언), `app.js:146-205` (마스터 분기), `app.js:2354-2355`, `app.js:2564-2576`
- Modify: `mobius/resource.js:415-416`, `mobius/resource.js:759-760`, `mobius/resource.js:2488-2490`
- Test: `test/cache-man.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `cache_man.get(ri)` → 캐시된 행 또는 `undefined`
  - `cache_man.set(ri, row)` → 저장 (상한 초과 시 가장 오래된 항목 축출)
  - `cache_man.invalidate(ri)` → 로컬 무효화 + 워커면 마스터에 브로드캐스트 요청
  - `cache_man.invalidate_local(ri)` → 브로드캐스트 없이 로컬만 (IPC 수신 시 사용)
  - `cache_man.keys_for(ri)` → 무효화 대상 키 배열 (순수 함수, 테스트용)
  - `cache_man.size()` → 현재 항목 수
  - `cache_man.install_master(cluster)` → 마스터에서 중계 핸들러 등록
  - `cache_man.install_worker()` → 워커에서 수신 핸들러 등록
  - IPC 메시지 형식: `{__mobius_cache_inv: true, ri: '<경로>'}`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/cache-man.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const MOD = path.join(__dirname, '..', 'mobius', 'cache_man.js');

function fresh(limit) {
    delete require.cache[require.resolve(MOD)];
    global.cache_limit = limit;
    return require(MOD);
}

test('keys_for 는 자기 자신, 부모의 /la, 자손 접두어를 모은다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', { ri: '/Mobius/ae1', pi: '/Mobius' });
    cm.set('/Mobius/ae1/cnt1', { ri: '/Mobius/ae1/cnt1', pi: '/Mobius/ae1' });
    cm.set('/Mobius/ae1/cnt1/la', { ri: 'x' });
    cm.set('/Mobius/ae2', { ri: '/Mobius/ae2', pi: '/Mobius' });

    const keys = cm.keys_for('/Mobius/ae1').sort();
    assert.deepStrictEqual(keys, [
        '/Mobius/ae1', '/Mobius/ae1/cnt1', '/Mobius/ae1/cnt1/la', '/Mobius/la'
    ].sort());
});

test('keys_for 는 접두어가 겹치는 형제를 잘못 포함하지 않는다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    cm.set('/Mobius/ae12', {});          // ae1 의 자손이 아니다
    cm.set('/Mobius/ae1/cnt', {});
    const keys = cm.keys_for('/Mobius/ae1');
    assert.ok(!keys.includes('/Mobius/ae12'), 'ae12 는 ae1 의 자손이 아니다');
    assert.ok(keys.includes('/Mobius/ae1/cnt'));
});

test('invalidate_local 이 대상 키를 전부 지운다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    cm.set('/Mobius/ae1/cnt1', {});
    cm.invalidate_local('/Mobius/ae1');
    assert.strictEqual(cm.get('/Mobius/ae1'), undefined);
    assert.strictEqual(cm.get('/Mobius/ae1/cnt1'), undefined);
});

test('상한을 넘으면 가장 오래 전에 넣은 항목이 축출된다', function () {
    const cm = fresh(3);
    cm.set('a', {}); cm.set('b', {}); cm.set('c', {});
    assert.strictEqual(cm.size(), 3);
    cm.set('d', {});
    assert.strictEqual(cm.size(), 3);
    assert.strictEqual(cm.get('a'), undefined, 'a 가 축출되어야 한다');
    assert.notStrictEqual(cm.get('d'), undefined);
});

test('get 은 항목을 최신으로 끌어올린다 (LRU)', function () {
    const cm = fresh(3);
    cm.set('a', {}); cm.set('b', {}); cm.set('c', {});
    cm.get('a');            // a 를 최신으로
    cm.set('d', {});        // b 가 축출되어야 한다
    assert.notStrictEqual(cm.get('a'), undefined);
    assert.strictEqual(cm.get('b'), undefined);
});

test('IPC 메시지를 받으면 로컬만 무효화하고 되쏘지 않는다', function () {
    const cm = fresh(100);
    let sent = 0;
    cm._set_sender(function () { sent++; });
    cm.set('/Mobius/ae1', {});

    cm._on_message({ __mobius_cache_inv: true, ri: '/Mobius/ae1' });

    assert.strictEqual(cm.get('/Mobius/ae1'), undefined);
    assert.strictEqual(sent, 0, 'IPC 수신은 다시 브로드캐스트하지 않는다');
});

test('invalidate 는 로컬 무효화 후 브로드캐스트를 요청한다', function () {
    const cm = fresh(100);
    const sent = [];
    cm._set_sender(function (msg) { sent.push(msg); });
    cm.set('/Mobius/ae1', {});

    cm.invalidate('/Mobius/ae1');

    assert.strictEqual(cm.get('/Mobius/ae1'), undefined);
    assert.deepStrictEqual(sent, [{ __mobius_cache_inv: true, ri: '/Mobius/ae1' }]);
});

test('관계없는 IPC 메시지는 무시한다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    cm._on_message({ some: 'other message' });
    assert.notStrictEqual(cm.get('/Mobius/ae1'), undefined);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test test/cache-man.test.js`
Expected: FAIL — `Cannot find module '../mobius/cache_man.js'`

- [ ] **Step 3: `mobius/cache_man.js` 를 구현한다**

```js
'use strict';
// 리소스 경로 캐시. 예전에는 app.js 의 global.cache_resource_url 이었다.
//
// 두 가지를 고친다.
//   1) 무제한 증가 -> 상한(LRU)
//   2) 워커 로컬 무효화 -> cluster IPC 로 전 워커 브로드캐스트
//
// 브로드캐스트가 없으면 워커 A 가 지운 리소스를 워커 B 가 계속 200 으로
// 돌려준다. app.js 의 check_resource_from_url 이 캐시 히트 시 그 행으로
// 바로 응답을 만들기 때문이다.

var DEFAULT_LIMIT = 50000;

// Map 은 삽입 순서를 보존한다. 맨 앞이 가장 오래된 항목이다.
var store = new Map();
var send = null;   // 브로드캐스트 요청 함수. 마스터/단일 프로세스에서는 null

function limit() {
    var n = parseInt(global.cache_limit, 10);
    return (n > 0) ? n : DEFAULT_LIMIT;
}

exports.get = function (ri) {
    if (!store.has(ri)) { return undefined; }
    var row = store.get(ri);
    store.delete(ri);      // LRU: 접근한 항목을 맨 뒤로
    store.set(ri, row);
    return row;
};

exports.has = function (ri) {
    return store.has(ri);
};

exports.set = function (ri, row) {
    if (store.has(ri)) { store.delete(ri); }
    store.set(ri, row);

    var max = limit();
    while (store.size > max) {
        var oldest = store.keys().next().value;
        store.delete(oldest);
    }
};

exports.size = function () {
    return store.size;
};

// 무효화 대상 키를 모은다. 순수 함수이므로 테스트가 쉽다.
//   1) ri 자신
//   2) 부모의 '<pi>/la' — 최신 자식이 바뀌었을 수 있다
//   3) '<ri>/' 로 시작하는 모든 키 (자손)
//
// 접두어 비교에 슬래시를 붙이는 것이 중요하다. '/Mobius/ae1' 로 시작하는
// 문자열에는 형제인 '/Mobius/ae12' 도 걸린다.
exports.keys_for = function (ri) {
    var out = [];
    if (store.has(ri)) { out.push(ri); }

    var slash = ri.lastIndexOf('/');
    if (slash > 0) {
        var la = ri.substring(0, slash) + '/la';
        if (store.has(la)) { out.push(la); }
    }

    var prefix = ri + '/';
    store.forEach(function (value, key) {
        if (key.indexOf(prefix) === 0) { out.push(key); }
    });

    return out;
};

exports.invalidate_local = function (ri) {
    var keys = exports.keys_for(ri);
    for (var i = 0; i < keys.length; i++) {
        store.delete(keys[i]);
    }
    return keys.length;
};

exports.invalidate = function (ri) {
    var n = exports.invalidate_local(ri);
    if (send) {
        send({ __mobius_cache_inv: true, ri: ri });
    }
    return n;
};

// --- IPC 배선 ---

exports._set_sender = function (fn) { send = fn; };

exports._on_message = function (msg) {
    if (!msg || msg.__mobius_cache_inv !== true) { return false; }
    exports.invalidate_local(msg.ri);
    return true;
};

// 마스터에서 호출. 워커가 보낸 무효화를 전 워커에 중계한다.
exports.install_master = function (cluster) {
    cluster.on('message', function (worker, msg) {
        if (!msg || msg.__mobius_cache_inv !== true) { return; }
        for (var id in cluster.workers) {
            if (cluster.workers.hasOwnProperty(id)) {
                try {
                    cluster.workers[id].send(msg);
                } catch (e) {
                    // 죽는 중인 워커에 보내면 던진다. 무시해도 안전하다.
                }
            }
        }
    });
};

// 워커에서 호출. 마스터가 중계한 무효화를 받고, 자신의 무효화를 올려보낸다.
exports.install_worker = function () {
    exports._set_sender(function (msg) {
        if (process.send) { process.send(msg); }
    });
    process.on('message', function (msg) {
        exports._on_message(msg);
    });
};
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `node --test test/cache-man.test.js`
Expected: PASS — 8 tests

- [ ] **Step 5: `app.js` 에서 전역을 교체한다**

`app.js:58` 의

```js
global.cache_resource_url = {};
```

을 아래로 바꾼다:

```js
global.cache_man = require('./mobius/cache_man');
// 하위 호환: 아직 cache_resource_url 을 직접 읽는 코드가 남아 있을 수 있다.
// 전환이 끝나면 이 줄을 지운다.
global.cache_resource_url = {};
```

`conf.json` 에서 상한을 읽도록 `mobius.js` 의 `global.retention_policies` 대입 아래에 추가:

```js
// 리소스 경로 캐시 상한 (항목 수). 미설정 시 cache_man 의 기본값 50000.
global.cache_limit = conf.cacheLimit || 50000;
```

- [ ] **Step 6: 마스터와 워커에 IPC 를 설치한다**

`app.js:147` 의 `if (cluster.isMaster) {` 바로 다음 줄에 추가:

```js
        require('./mobius/cache_man').install_master(cluster);
```

`app.js:206` 의 `else {` (워커 분기) 바로 다음 줄에 추가:

```js
        require('./mobius/cache_man').install_worker();
```

- [ ] **Step 7: 캐시 읽기·쓰기 지점을 `cache_man` 으로 바꾼다**

`app.js:1232-1247` 의 `check_resource_from_url`:

```js
function check_resource_from_url(connection, ri, sri, callback) {
    var cached = cache_man.get(ri);
    if (cached !== undefined) {
        callback(cached, 200);
    }
    else {
        db_sql.select_resource_from_url(connection, ri, sri, (err, results) => {
            if (err) {
                callback(null, 500);
            }
            else {
                if (results.length === 0) {
                    callback(null, 404);
                }
                else {
                    cache_man.set(ri, JSON.parse(JSON.stringify(results[0])));
                    callback(results[0], 200);
                }
            }
        });
    }
}
```

- [ ] **Step 8: 무효화 지점 6곳을 `cache_man.invalidate` 로 바꾼다**

`app.js:2354-2355` (PUT 성공 후):

```js
                                                                            cache_man.invalidate(request.url);
```

`app.js:2564-2576` (DELETE 성공 후) — 세 블록 전체를 한 줄로:

```js
                                                        cache_man.invalidate(request.url);
```

`mobius/resource.js:411-416`:

```js
                cache_man.set(resource_Obj[rootnm].pi + '/la', resource_Obj[rootnm]);
                cache_man.invalidate(targetObject[parent_rootnm].ri);
```

`mobius/resource.js:759-760`:

```js
                cache_man.invalidate(parentObj[parent_rootnm].ri);
```

`mobius/resource.js:2488-2490`:

```js
                                    cache_man.invalidate(request.targetObject[parent_rootnm].ri);
```

`resource.js` 상단(`var db_sql = require('./sql_action');` 근처)에 추가:

```js
var cache_man = require('./cache_man');
```

- [ ] **Step 9: 남은 직접 참조가 없는지 확인한다**

Run: `grep -n "cache_resource_url" app.js mobius/*.js`
Expected: `app.js:59` 의 하위 호환 선언 한 줄만 남는다. 다른 줄이 나오면 Step 7·8 이 불완전한 것이다.

- [ ] **Step 10: 두 워커로 실제 동작을 확인한다**

이 검증이 이 태스크의 핵심이다. 워커가 최소 2개여야 재현된다.

```bash
# 터미널 1
node mobius.js sqlite
```

```bash
# 터미널 2 — AE 를 만들고, 지우고, 여러 번 조회한다.
# 워커가 라운드로빈이므로 20회 조회하면 여러 워커에 흩어진다.
curl -s -X POST http://localhost:7579/Mobius \
  -H 'X-M2M-RI: 1' -H 'X-M2M-Origin: Sponde' -H 'X-M2M-RVI: 2a' \
  -H 'Content-Type: application/json;ty=2' \
  -d '{"m2m:ae":{"rn":"cachetest","api":"N.t","rr":"true"}}' -o /dev/null -w '%{http_code}\n'

for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code} ' http://localhost:7579/Mobius/cachetest \
    -H 'X-M2M-RI: 2' -H 'X-M2M-Origin: Sponde' -H 'X-M2M-RVI: 2a'
done; echo

curl -s -X DELETE http://localhost:7579/Mobius/cachetest \
  -H 'X-M2M-RI: 3' -H 'X-M2M-Origin: Sponde' -H 'X-M2M-RVI: 2a' -o /dev/null -w '\ndeleted: %{http_code}\n'

for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code} ' http://localhost:7579/Mobius/cachetest \
    -H 'X-M2M-RI: 4' -H 'X-M2M-Origin: Sponde' -H 'X-M2M-RVI: 2a'
done; echo
```

Expected: 삭제 전 20회는 전부 `200`, 삭제 후 20회는 **전부 `404`** 여야 한다.
이 변경 전에는 삭제 후에도 `200` 이 섞여 나온다 — 그것이 고치려는 버그다.

- [ ] **Step 11: 커밋**

```bash
git add mobius/cache_man.js test/cache-man.test.js app.js mobius/resource.js mobius.js
git commit -m "fix: 워커 간 캐시 무효화 브로드캐스트 + 캐시 상한 (P0)"
```

---

### Task 5: `usesuperuser` 설정 분리와 콘솔 전용 origin

`app.js:64` 에 슈퍼유저 origin 이 `'Sponde'` 로 하드코딩되어 있다. 배포처별로 바꿀 수 없고 소스에 남는다. 콘솔은 별도 origin 을 써야 감사 로그에서 구분된다. 스펙 §3 P0-5.

**Files:**
- Modify: `app.js:63-65`
- Modify: `mobius.js` (conf 로딩부)
- Modify: `mobius/security.js:409`
- Modify: `README.md` (설정 표)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `global.usesuperuser` — 기존 이름 유지, 값은 `conf.json` 에서
  - `global.useadminorigin` — 콘솔 전용 origin. `''` 이면 비활성
  - `conf.json` 키: `superuser`, `adminOrigin`

- [ ] **Step 1: `mobius.js` 에서 conf 를 읽는다**

`mobius.js` 의 `global.retention_policies = ...` 줄 아래에 추가:

```js
// 슈퍼유저 origin. 이 origin 은 모든 ACP 검사를 우회한다.
// 미설정 시 기존 기본값을 유지해 업그레이드가 동작을 바꾸지 않게 한다.
global.usesuperuser = conf.superuser || 'Sponde';

// 관리 콘솔 전용 origin. 감사 로그에서 콘솔 작업과 사람 작업을 구분한다.
// 빈 문자열이면 비활성.
global.useadminorigin = conf.adminOrigin || '';
```

`mobius.js` 의 `catch (e)` 블록(기본 conf 생성)에도 추가:

```js
    conf.superuser = "Sponde";
    conf.adminOrigin = "";
```

`fs.writeFileSync('conf.json', ...)` 바로 앞에 넣는다.

- [ ] **Step 2: `app.js` 의 하드코딩을 지운다**

`app.js:63-65` 를:

```js
global.usespid = '//keti.re.kr';
global.usesuperuser = 'Sponde'; //'Superman';
global.useobserver = 'Sandwich';
```

에서 아래로 바꾼다:

```js
global.usespid = '//keti.re.kr';
// usesuperuser / useadminorigin 은 mobius.js 가 conf.json 에서 설정한다.
// app.js 를 직접 실행하는 경로(테스트 등)를 위해 기본값만 채운다.
if (typeof global.usesuperuser === 'undefined') { global.usesuperuser = 'Sponde'; }
if (typeof global.useadminorigin === 'undefined') { global.useadminorigin = ''; }
global.useobserver = 'Sandwich';
```

- [ ] **Step 3: `security.js` 가 콘솔 origin 도 인식하게 한다**

`mobius/security.js:409` 의

```js
    if(request.headers['x-m2m-origin'] == usesuperuser || request.headers['x-m2m-origin'] == ('/'+usesuperuser)) {
```

을 아래로 바꾼다:

```js
    var from = request.headers['x-m2m-origin'];
    var is_super = (from == usesuperuser || from == ('/' + usesuperuser));
    var is_admin = (useadminorigin !== '' &&
                    (from == useadminorigin || from == ('/' + useadminorigin)));

    if (is_super || is_admin) {
```

- [ ] **Step 4: README 설정 표에 두 키를 추가한다**

`README.md` 의 `conf.json` 예시 블록을:

```
{
  "csebaseport": "7579", //Mobius HTTP hosting  port
  "dbpass": "*******",   //MySQL root password
  "usesqlite": "false",  //"true" to use SQLite instead of MySQL
  "superuser": "Sponde", //origin that bypasses all ACP checks
  "adminOrigin": ""      //origin used by the admin console (empty = disabled)
}
```

으로 바꾼다.

- [ ] **Step 5: 설정이 실제로 먹는지 확인한다**

```bash
node -e "
const fs=require('fs');
const orig=fs.readFileSync('conf.json','utf8');
const c=JSON.parse(orig); c.superuser='TestSuper'; c.adminOrigin='TestAdmin';
fs.writeFileSync('conf.json', JSON.stringify(c,null,4));
console.log('conf.json 수정됨 — 서버를 띄워 확인하고 아래로 되돌린다');
fs.writeFileSync('/tmp/conf.backup.json', orig);
"
node -e "
process.argv[2]='sqlite';
require('./mobius.js');
setTimeout(()=>{ console.log('usesuperuser =', global.usesuperuser);
  console.log('useadminorigin =', global.useadminorigin); process.exit(0); }, 2000);
" sqlite
cp /tmp/conf.backup.json conf.json
```

Expected: `usesuperuser = TestSuper`, `useadminorigin = TestAdmin`

- [ ] **Step 6: 동등성 하네스로 회귀가 없는지 확인한다**

Run: `node tools/equivalence/run-scenarios.js`
Expected: 기존 시나리오가 전부 통과한다. `conf.json` 에 `superuser` 가 없으면 기본값 `'Sponde'` 로 떨어져 기존 동작이 유지되어야 한다.

- [ ] **Step 7: 커밋**

```bash
git add app.js mobius.js mobius/security.js README.md
git commit -m "feat: superuser/adminOrigin 을 conf.json 으로 분리"
```

---

### Task 6: `hit_ri` 테이블과 SQL 함수

리소스별 사용 이력을 담을 테이블과 그것을 읽고 쓰는 SQL. 버퍼링은 Task 7 에서 붙인다. 스펙 §3 P0-2.

**Files:**
- Modify: `mobius/mobiusdb_sqlite.sql`
- Modify: `mobius/sql_action.js` (`get_hit_all` 아래, 103행 근처)
- Modify: `docs/mysql-migration-2.7.md` (Task 3 에서 이미 `hit_ri` DDL 을 넣었다 — 확인만)
- Test: `test/prereq-queries.test.js`

**Interfaces:**
- Consumes: `mobius/db` 파사드 (`db.k()`, `db.raw()`, `db.run()`)
- Produces:
  - `sql_action.upsert_hit_ri_batch(connection, rows, callback)` — `rows` 는 `[{ri, ct, http, mqtt, coap, ws}]`. 증분 UPSERT
  - `sql_action.select_hit_ri(connection, ri, since_ct, callback)` — `callback(err, rows)`
  - `sql_action.delete_hit_ri_old(connection, before_ct, callback)`

- [ ] **Step 1: SQLite 스키마에 테이블을 추가한다**

`mobius/mobiusdb_sqlite.sql` 의 Task 3 인덱스 블록 **앞에** 추가 (인덱스가 테이블을 참조하므로 순서가 중요하다):

```sql
-- hit_ri (리소스별 × 날짜별 프로토콜 접근 횟수)
CREATE TABLE IF NOT EXISTS hit_ri (
  ri   TEXT NOT NULL,
  ct   TEXT NOT NULL,
  http INTEGER NOT NULL DEFAULT 0,
  mqtt INTEGER NOT NULL DEFAULT 0,
  coap INTEGER NOT NULL DEFAULT 0,
  ws   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ri, ct)
);
```

그리고 인덱스 블록에 한 줄 추가:

```sql
CREATE INDEX IF NOT EXISTS idx_hit_ri_ct ON hit_ri(ct);
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`test/prereq-queries.test.js`:

```js
'use strict';
// hit_ri 관련 신규 SQL 이 파사드를 거쳐 드라이버에 올바른 SQL/bindings 를
// 넘기는지 확인한다. converted-queries.test.js 의 tapAdapter 패턴을 그대로 쓴다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-prereq-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));
    const calls = [];
    adapter.execute = function (handle, sql, bindings, callback) {
        calls.push({ sql: sql, bindings: bindings });
        if (/^\s*select\b/i.test(sql)) { callback(null, []); }
        else { callback(null, { affectedRows: 1, insertId: 0 }); }
    };
    db.connect('h', 1, 'u', 'p', function () {});
    const SA = path.join(__dirname, '..', 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    return { sql_action: require(SA), calls: calls };
}

test('upsert_hit_ri_batch 는 MySQL 에서 증분 ON DUPLICATE KEY UPDATE 를 만든다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.upsert_hit_ri_batch(null, [
        { ri: '/Mobius/ae1', ct: '20260828', http: 3, mqtt: 0, coap: 0, ws: 0 }
    ], function (err) {
        assert.strictEqual(err, null);
        assert.strictEqual(calls.length, 1);
        assert.match(calls[0].sql, /insert into `hit_ri`/i);
        assert.match(calls[0].sql, /on duplicate key update/i);
        assert.match(calls[0].sql, /http`?\s*\+/i, '절대값이 아니라 증분이어야 한다');
        assert.ok(calls[0].bindings.includes('/Mobius/ae1'));
        assert.ok(calls[0].bindings.includes('20260828'));
        done();
    });
});

test('upsert_hit_ri_batch 는 SQLite 에서 ON CONFLICT 를 만든다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.upsert_hit_ri_batch(null, [
        { ri: '/Mobius/ae1', ct: '20260828', http: 1, mqtt: 0, coap: 0, ws: 0 }
    ], function () {
        assert.match(calls[0].sql, /on conflict/i);
        assert.match(calls[0].sql, /http`?\s*\+/i);
        done();
    });
});

test('upsert_hit_ri_batch 는 여러 행을 한 문장으로 보낸다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.upsert_hit_ri_batch(null, [
        { ri: '/a', ct: '20260828', http: 1, mqtt: 0, coap: 0, ws: 0 },
        { ri: '/b', ct: '20260828', http: 0, mqtt: 2, coap: 0, ws: 0 }
    ], function () {
        assert.strictEqual(calls.length, 1, '행마다 쿼리를 날리면 안 된다');
        assert.ok(calls[0].bindings.includes('/a'));
        assert.ok(calls[0].bindings.includes('/b'));
        done();
    });
});

test('빈 배열이면 쿼리를 아예 날리지 않는다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.upsert_hit_ri_batch(null, [], function (err) {
        assert.strictEqual(err, null);
        assert.strictEqual(calls.length, 0);
        done();
    });
});

test('select_hit_ri 는 ri 와 ct 범위로 조회한다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.select_hit_ri(null, '/Mobius/ae1', '20260601', function () {
        assert.match(calls[0].sql, /^select .* from `hit_ri`/i);
        assert.deepStrictEqual(calls[0].bindings, ['/Mobius/ae1', '20260601']);
        done();
    });
});

test('delete_hit_ri_old 는 ct 기준으로 지운다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.delete_hit_ri_old(null, '20260401', function () {
        assert.match(calls[0].sql, /^delete from `hit_ri`/i);
        assert.deepStrictEqual(calls[0].bindings, ['20260401']);
        done();
    });
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `node --test test/prereq-queries.test.js`
Expected: FAIL — `sql_action.upsert_hit_ri_batch is not a function`

- [ ] **Step 4: `sql_action.js` 에 세 함수를 추가한다**

`mobius/sql_action.js` 의 `exports.set_hit_n` 함수 바로 아래(187행 근처)에 추가:

```js
// --- hit_ri (리소스별 사용 이력) ---
//
// 기존 set_hit 과 달리 요청마다 호출되지 않는다. hit_man 이 워커 메모리에
// 모았다가 주기적으로 이 함수를 한 번 부른다.

exports.upsert_hit_ri_batch = function (connection, rows, callback) {
    if (!rows || rows.length === 0) {
        callback(null, { affectedRows: 0 });
        return;
    }

    var qb = db_facade.k('hit_ri').insert(rows).onConflict(['ri', 'ct']).merge({
        http: db_facade.raw('hit_ri.http + values(hit_ri.http)'),
        mqtt: db_facade.raw('hit_ri.mqtt + values(hit_ri.mqtt)'),
        coap: db_facade.raw('hit_ri.coap + values(hit_ri.coap)'),
        ws:   db_facade.raw('hit_ri.ws + values(hit_ri.ws)')
    });

    db_facade.run(qb, connection, function (err, result) {
        callback(err ? err : null, result);
    });
};

exports.select_hit_ri = function (connection, ri, since_ct, callback) {
    var qb = db_facade.k('hit_ri')
        .select('ri', 'ct', 'http', 'mqtt', 'coap', 'ws')
        .where('ri', ri)
        .andWhere('ct', '>=', since_ct)
        .orderBy('ct', 'asc');

    db_facade.run(qb, connection, function (err, rows) {
        callback(err ? err : null, rows);
    });
};

exports.delete_hit_ri_old = function (connection, before_ct, callback) {
    var qb = db_facade.k('hit_ri').where('ct', '<', before_ct).del();
    db_facade.run(qb, connection, function (err, result) {
        callback(err ? err : null, result);
    });
};
```

`sql_action.js` 상단에 파사드가 이미 `require` 되어 있는지 확인한다. 없으면 추가:

```js
var db_facade = require('./db');
```

Run: `grep -n "require('./db')" mobius/sql_action.js` 로 확인한다. 변수명이 다르면(`db_facade` 가 아니라면) 위 코드의 `db_facade` 를 그 이름으로 맞춘다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `node --test test/prereq-queries.test.js`
Expected: PASS — 6 tests

`values(hit_ri.http)` 문법이 SQLite 에서 `excluded.http` 로 나와야 한다. knex 의 `onConflict().merge()` 가 백엔드별로 처리한다. 실패하면 `merge()` 에 객체 대신 컬럼 배열을 넘기고 증분을 `db_facade.raw` 로 구성하는 형태를 시험한다 — 그 경우 **양쪽 백엔드에서 생성 SQL 을 직접 출력해 확인한다:**

```bash
node -e "
global.usesqlite='true';
const db=require('./mobius/db'); db.connect('h',1,'u','p',()=>{});
console.log(db.k('hit_ri').insert([{ri:'a',ct:'1',http:1}])
  .onConflict(['ri','ct']).merge({http: db.raw('hit_ri.http + 1')}).toSQL().toNative());
"
```

- [ ] **Step 6: 실제 DB 에 테이블이 생기고 증분이 동작하는지 확인한다**

```bash
cp mobius.db /tmp/hitri-test.db
MOBIUS_SQLITE_PATH=/tmp/hitri-test.db node -e "
global.usesqlite='true';
const db=require('./mobius/db');
db.connect('h',1,'u','p',function(){
  const sa=require('./mobius/sql_action');
  const rows=[{ri:'/Mobius/ae1',ct:'20260828',http:3,mqtt:0,coap:0,ws:0}];
  sa.upsert_hit_ri_batch(null, rows, function(e){
    if(e){console.error('FAIL 1',e);process.exit(1);}
    sa.upsert_hit_ri_batch(null, rows, function(e2){
      if(e2){console.error('FAIL 2',e2);process.exit(1);}
      sa.select_hit_ri(null,'/Mobius/ae1','20260101',function(e3,r){
        console.log(JSON.stringify(r));
        if(r[0].http!==6){console.error('증분 실패: http 가 6 이어야 하는데', r[0].http);process.exit(1);}
        console.log('OK — 증분 동작 확인');process.exit(0);
      });
    });
  });
});
"
rm -f /tmp/hitri-test.db
```

Expected: `[{"ri":"/Mobius/ae1","ct":"20260828","http":6,...}]` 와 `OK — 증분 동작 확인`

- [ ] **Step 7: 커밋**

```bash
git add mobius/mobiusdb_sqlite.sql mobius/sql_action.js test/prereq-queries.test.js
git commit -m "feat: hit_ri 테이블과 증분 UPSERT/조회/정리 SQL"
```

---

### Task 7: `hit_man.js` — 인메모리 버퍼와 주기 flush

요청 경로에서 DB 를 때리지 않는 것이 이 태스크의 목적이다. 기존 `set_hit` 은 전 워커가 매 요청마다 같은 한 행을 UPSERT 해 핫로우 경합을 만든다. 스펙 §3 P0-2.

**Files:**
- Create: `mobius/hit_man.js`
- Test: `test/hit-man.test.js`

**Interfaces:**
- Consumes: Task 6 의 `sql_action.upsert_hit_ri_batch`, `sql_action.delete_hit_ri_old`
- Produces:
  - `hit_man.record(ri, ty, binding, originator)` — 버퍼에 1 증가. DB 접근 없음
  - `hit_man.attribute(ri, ty)` → 실제 기록될 `ri` (순수 함수). CIN 은 부모 CNT 로, `/la`·`/ol` 접미는 컨테이너로
  - `hit_man.pending()` → 현재 버퍼 스냅샷 (테스트용)
  - `hit_man.flush(callback)` — 버퍼를 비우고 DB 에 배치 기록
  - `hit_man.start()` — `wdt` 에 주기 flush 등록
  - `hit_man._set_writer(fn)` — 테스트용 주입

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/hit-man.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const MOD = path.join(__dirname, '..', 'mobius', 'hit_man.js');

function fresh() {
    delete require.cache[require.resolve(MOD)];
    global.useadminorigin = 'AdminConsole';
    global.hit_ri_flush_sec = 10;
    return require(MOD);
}

test('attribute: CIN(ty=4) 은 부모 CNT 로 귀속된다', function () {
    const hm = fresh();
    assert.strictEqual(
        hm.attribute('/Mobius/ae1/cnt1/4-20260828010203456', 4),
        '/Mobius/ae1/cnt1');
});

test('attribute: /la 와 /ol 은 컨테이너로 귀속된다', function () {
    const hm = fresh();
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/la', 3), '/Mobius/ae1/cnt1');
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/ol', 3), '/Mobius/ae1/cnt1');
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/latest', 3), '/Mobius/ae1/cnt1');
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/oldest', 3), '/Mobius/ae1/cnt1');
});

test('attribute: AE 와 CNT 는 그대로', function () {
    const hm = fresh();
    assert.strictEqual(hm.attribute('/Mobius/ae1', 2), '/Mobius/ae1');
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1', 3), '/Mobius/ae1/cnt1');
});

test('record: 프로토콜별로 누적된다', function () {
    const hm = fresh();
    hm.record('/Mobius/ae1', 2, 'H', 'CSomeone');
    hm.record('/Mobius/ae1', 2, 'H', 'CSomeone');
    hm.record('/Mobius/ae1', 2, 'M', 'CSomeone');

    const p = hm.pending();
    const key = Object.keys(p)[0];
    assert.strictEqual(p[key].http, 2);
    assert.strictEqual(p[key].mqtt, 1);
    assert.strictEqual(p[key].ri, '/Mobius/ae1');
});

test('record: 콘솔 origin 의 요청은 집계하지 않는다', function () {
    const hm = fresh();
    hm.record('/Mobius/ae1', 2, 'H', 'AdminConsole');
    assert.deepStrictEqual(hm.pending(), {},
        '콘솔이 조회한 것을 사용 이력으로 세면 판정 신호가 오염된다');
});

test('record: CIN 등록이 부모 CNT 한 키로 합쳐진다', function () {
    const hm = fresh();
    hm.record('/Mobius/ae1/cnt1/4-2026082801', 4, 'H', 'CDevice');
    hm.record('/Mobius/ae1/cnt1/4-2026082802', 4, 'H', 'CDevice');
    const p = hm.pending();
    assert.strictEqual(Object.keys(p).length, 1);
    assert.strictEqual(p[Object.keys(p)[0]].ri, '/Mobius/ae1/cnt1');
    assert.strictEqual(p[Object.keys(p)[0]].http, 2);
});

test('record: 빈 ri 나 없는 ri 는 무시한다', function () {
    const hm = fresh();
    hm.record('', 2, 'H', 'x');
    hm.record(null, 2, 'H', 'x');
    assert.deepStrictEqual(hm.pending(), {});
});

test('flush: 버퍼를 비우고 writer 에 배열을 넘긴다', function (t, done) {
    const hm = fresh();
    let got = null;
    hm._set_writer(function (rows, cb) { got = rows; cb(null); });

    hm.record('/Mobius/ae1', 2, 'H', 'CSomeone');
    hm.record('/Mobius/ae2', 2, 'C', 'CSomeone');

    hm.flush(function (err) {
        assert.strictEqual(err, null);
        assert.strictEqual(got.length, 2);
        assert.ok(got.every(r => r.ct && r.ct.length === 8), 'ct 는 YYYYMMDD 8자');
        assert.deepStrictEqual(hm.pending(), {}, 'flush 후 버퍼는 비어야 한다');
        done();
    });
});

test('flush: 버퍼가 비면 writer 를 부르지 않는다', function (t, done) {
    const hm = fresh();
    let called = 0;
    hm._set_writer(function (rows, cb) { called++; cb(null); });
    hm.flush(function () {
        assert.strictEqual(called, 0);
        done();
    });
});

test('flush 실패 시 버퍼를 되돌려 다음 주기에 재시도한다', function (t, done) {
    const hm = fresh();
    hm._set_writer(function (rows, cb) { cb(new Error('db down')); });
    hm.record('/Mobius/ae1', 2, 'H', 'x');

    hm.flush(function (err) {
        assert.ok(err, '에러가 전달되어야 한다');
        const p = hm.pending();
        assert.strictEqual(Object.keys(p).length, 1, '유실되면 안 된다');
        assert.strictEqual(p[Object.keys(p)[0]].http, 1);
        done();
    });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test test/hit-man.test.js`
Expected: FAIL — `Cannot find module '../mobius/hit_man.js'`

- [ ] **Step 3: `mobius/hit_man.js` 를 구현한다**

```js
'use strict';
// 리소스별 사용 이력(hit_ri) 수집.
//
// 요청 경로에서는 메모리만 건드린다. wdt 가 주기적으로 flush 를 불러
// 모인 증분을 한 문장으로 기록한다.
//
// 설계 근거는 docs/superpowers/specs/2026-08-28-admin-console-design.md §3 P0-2.
//   - CIN 은 자체 키를 만들지 않는다. 부모 CNT 에 귀속시킨다.
//     안 그러면 hit_ri 가 lookup 보다 커진다.
//   - 콘솔 자신의 조회는 집계하지 않는다. 콘솔이 리소스를 들여다볼 때마다
//     "마지막 접근"이 갱신되면 삭제 판정 신호가 오염된다.

var moment = require('moment');
var db_sql = require('./sql_action');

var DEFAULT_FLUSH_SEC = 10;
var WDT_ID = 'hit_ri_flush';

var buffer = {};   // key = ri + '|' + ct
var flushing = false;

// 기본 writer 는 실제 DB 로 간다. 테스트가 _set_writer 로 갈아끼운다.
var writer = function (rows, callback) {
    var db = require('./db_action');
    db.getConnection(function (code, connection) {
        if (code !== '200') {
            callback(new Error('[hit_man] no connection: ' + code));
            return;
        }
        db_sql.upsert_hit_ri_batch(connection, rows, function (err) {
            connection.release();
            callback(err || null);
        });
    });
};

function today() {
    return moment().utc().format('YYYYMMDD');
}

// 어떤 ri 로 기록할지 정한다. 순수 함수.
exports.attribute = function (ri, ty) {
    if (!ri) { return null; }

    // 가상 자식(/la, /ol, /latest, /oldest)은 컨테이너의 접근이다.
    var virtual = ['/la', '/ol', '/latest', '/oldest'];
    for (var i = 0; i < virtual.length; i++) {
        if (ri.length > virtual[i].length &&
            ri.lastIndexOf(virtual[i]) === ri.length - virtual[i].length) {
            return ri.substring(0, ri.length - virtual[i].length);
        }
    }

    // CIN 은 부모 컨테이너에 귀속한다.
    if (String(ty) === '4') {
        var slash = ri.lastIndexOf('/');
        return (slash > 0) ? ri.substring(0, slash) : ri;
    }

    return ri;
};

exports.record = function (ri, ty, binding, originator) {
    if (!ri) { return; }

    // 콘솔 자신의 트래픽은 제외한다.
    if (global.useadminorigin && originator &&
        (originator === global.useadminorigin ||
         originator === ('/' + global.useadminorigin))) {
        return;
    }

    var target = exports.attribute(ri, ty);
    if (!target) { return; }

    var ct = today();
    var key = target + '|' + ct;

    if (!buffer[key]) {
        buffer[key] = { ri: target, ct: ct, http: 0, mqtt: 0, coap: 0, ws: 0 };
    }

    if (binding === 'M') { buffer[key].mqtt++; }
    else if (binding === 'C') { buffer[key].coap++; }
    else if (binding === 'W') { buffer[key].ws++; }
    else { buffer[key].http++; }
};

exports.pending = function () {
    return buffer;
};

exports.flush = function (callback) {
    callback = callback || function () {};

    var keys = Object.keys(buffer);
    if (keys.length === 0) { callback(null); return; }

    // 겹쳐 도는 flush 를 막는다. 이번 주기는 건너뛰고 다음에 같이 나간다.
    if (flushing) { callback(null); return; }
    flushing = true;

    var rows = [];
    for (var i = 0; i < keys.length; i++) { rows.push(buffer[keys[i]]); }
    buffer = {};

    writer(rows, function (err) {
        flushing = false;
        if (err) {
            // 유실보다 중복 누적이 낫다. 되돌려 다음 주기에 재시도한다.
            for (var j = 0; j < rows.length; j++) {
                var k = rows[j].ri + '|' + rows[j].ct;
                if (!buffer[k]) { buffer[k] = rows[j]; }
                else {
                    buffer[k].http += rows[j].http;
                    buffer[k].mqtt += rows[j].mqtt;
                    buffer[k].coap += rows[j].coap;
                    buffer[k].ws   += rows[j].ws;
                }
            }
            console.error('[hit_man] flush failed, will retry: ' + (err.message || err));
            callback(err);
            return;
        }
        callback(null);
    });
};

exports.start = function () {
    var sec = parseInt(global.hit_ri_flush_sec, 10) || DEFAULT_FLUSH_SEC;
    global.wdt.set_wdt(WDT_ID, sec, function () {
        exports.flush(function () {});
    });
};

exports._set_writer = function (fn) { writer = fn; };
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `node --test test/hit-man.test.js`
Expected: PASS — 10 tests

- [ ] **Step 5: 커밋**

```bash
git add mobius/hit_man.js test/hit-man.test.js
git commit -m "feat: hit_ri 인메모리 버퍼와 주기 flush (hit_man)"
```

---

### Task 8: `hit_ri` 수집 배선과 보관 정리

`hit_man` 을 실제 요청 경로에 연결하고, 90일이 지난 행을 정리한다.

**Files:**
- Modify: `app.js:1837-1860` (POST), `app.js:2134-2160` (GET), `app.js:2316-2340` (PUT), `app.js:2530-2555` (DELETE)
- Modify: `app.js:85-136` (정리 함수들 근처), `app.js:176-196` (마스터 setInterval 블록)
- Modify: `mobius.js` (flush 주기·보관 기간 설정)

**Interfaces:**
- Consumes: Task 7 의 `hit_man.record(ri, ty, binding, originator)`, `hit_man.start()`; Task 6 의 `sql_action.delete_hit_ri_old`
- Produces: 없음

- [ ] **Step 1: 설정을 `mobius.js` 에 추가한다**

Task 5 에서 추가한 `global.useadminorigin` 아래에:

```js
// hit_ri 수집. flush 주기(초)와 보관 기간(일).
// 보관은 판정 기준(무접근 90일)보다 길게 잡는다 — 경계에서 판정이 흔들리지 않도록.
global.hit_ri_flush_sec = conf.hitRiFlushSec || 10;
global.hit_ri_retention_days = conf.hitRiRetentionDays || 120;
```

- [ ] **Step 2: 워커에서 `hit_man.start()` 를 부른다**

`app.js` 워커 분기에서 Task 4 가 넣은 `install_worker()` 바로 아래에 추가:

```js
        require('./mobius/hit_man').start();
```

- [ ] **Step 3: 네 라우터에 수집을 배선한다**

각 라우터의 기존 `db_sql.set_hit(...)` 호출 **바로 아래**에 `hit_man.record` 를 넣는다. `set_hit`(전역 집계)은 그대로 둔다 — 대시보드가 쓴다.

`app.js` 상단(`var db_sql = require('./mobius/sql_action');` 근처)에 추가:

```js
var hit_man = require('./mobius/hit_man');
```

POST(`app.js:1849` 근처) — 이 시점에는 `request.url` 이 부모 경로다:

```js
                db_sql.set_hit(connection, binding, (err, results) => {
                    results = null;
                });
                hit_man.record(url.parse(request.url).pathname, null,
                               binding, request.headers['x-m2m-origin']);
```

GET(`app.js:2153` 근처), PUT(`app.js:2333` 근처), DELETE(`app.js:2547` 근처) — 세 곳 모두 같은 형태:

```js
                db_sql.set_hit(request.db_connection, request.headers['binding'], (err, results) => {
                    results = null;
                });
                hit_man.record(url.parse(request.url).pathname, null,
                               request.headers['binding'], request.headers['x-m2m-origin']);
```

`ty` 를 `null` 로 넘기는 이유: 이 시점에는 아직 대상 리소스를 조회하지 않아 타입을 모른다. `attribute()` 의 `/la`·`/ol` 접미 규칙은 `ty` 없이도 동작하고, CIN 직접 조회는 경로 마지막 세그먼트가 `4-` 로 시작하므로 Step 4 에서 보완한다.

- [ ] **Step 4: `attribute` 에 경로 기반 CIN 판별을 추가한다**

`ty` 를 모르는 호출을 위해 `mobius/hit_man.js` 의 `attribute` 에서 CIN 분기를 아래로 바꾼다:

```js
    // CIN 은 부모 컨테이너에 귀속한다.
    // ty 를 아는 호출은 ty 로, 모르는 호출(라우터 진입 시점)은 경로 규칙으로 판별한다.
    // Mobius 의 CIN rn 은 '4-<타임스탬프>' 형식이다 (resource.js 가 생성).
    var last = ri.substring(ri.lastIndexOf('/') + 1);
    if (String(ty) === '4' || /^4-\d/.test(last)) {
        var slash = ri.lastIndexOf('/');
        return (slash > 0) ? ri.substring(0, slash) : ri;
    }
```

그리고 `test/hit-man.test.js` 에 테스트를 추가한다:

```js
test('attribute: ty 를 몰라도 경로로 CIN 을 판별한다', function () {
    const hm = fresh();
    assert.strictEqual(
        hm.attribute('/Mobius/ae1/cnt1/4-20260828010203456', null),
        '/Mobius/ae1/cnt1');
    // CIN 이 아닌 것을 CIN 으로 오인하면 안 된다
    assert.strictEqual(hm.attribute('/Mobius/ae1/4things', null), '/Mobius/ae1/4things');
});
```

Run: `node --test test/hit-man.test.js`
Expected: PASS — 12 tests

- [ ] **Step 5: 보관 정리 함수를 추가한다**

`app.js` 의 `del_orphan_resource` 함수(122-136행) 아래에 추가:

```js
function del_old_hit_ri() {
    db.getConnection((code, connection) => {
        if (code === '200') {
            var days = parseInt(global.hit_ri_retention_days, 10) || 120;
            var before = moment().utc().subtract(days, 'days').format('YYYYMMDD');
            db_sql.delete_hit_ri_old(connection, before, (err, result) => {
                if (err) {
                    console.error('[del_old_hit_ri] error', err);
                }
                else {
                    console.log('deleted ' + (result.affectedRows || 0) + ' old hit_ri row(s)');
                }
                connection.release();
            });
        }
        else {
            console.log('[del_old_hit_ri] No Connection');
        }
    });
}
```

- [ ] **Step 6: 마스터에서 일 1회 실행한다**

`app.js:183` 의 `setInterval(del_orphan_resource, (24) * (60) * (60) * (1000));` 아래에 추가:

```js
                                del_old_hit_ri();
                                setInterval(del_old_hit_ri, (24) * (60) * (60) * (1000));
```

- [ ] **Step 7: 실제로 기록되는지 확인한다**

```bash
node mobius.js sqlite
```

다른 터미널에서:

```bash
curl -s -X POST http://localhost:7579/Mobius \
  -H 'X-M2M-RI: 1' -H 'X-M2M-Origin: Sponde' -H 'X-M2M-RVI: 2a' \
  -H 'Content-Type: application/json;ty=2' \
  -d '{"m2m:ae":{"rn":"hittest","api":"N.t","rr":"true"}}' -o /dev/null -w '%{http_code}\n'

for i in $(seq 1 5); do
  curl -s -o /dev/null http://localhost:7579/Mobius/hittest \
    -H 'X-M2M-RI: 2' -H 'X-M2M-Origin: CTester' -H 'X-M2M-RVI: 2a'
done

echo "flush 주기(10초) 를 기다린다"; sleep 12

node -e "
const s=require('sqlite3');const db=new s.Database('mobius.db',s.OPEN_READONLY);
db.all('SELECT * FROM hit_ri ORDER BY ri', (e,r)=>{console.log(JSON.stringify(r,null,1));db.close();});
"
```

Expected: `/Mobius/hittest` 행이 있고 `http` 가 5 이상이다. (POST 는 `/Mobius` 에 기록된다.)

이어서 콘솔 origin 제외를 확인한다:

```bash
node -e "
const fs=require('fs');const c=JSON.parse(fs.readFileSync('conf.json','utf8'));
c.adminOrigin='AdminConsole'; fs.writeFileSync('conf.json',JSON.stringify(c,null,4));
"
# 서버 재시작 후
for i in $(seq 1 5); do
  curl -s -o /dev/null http://localhost:7579/Mobius/hittest \
    -H 'X-M2M-RI: 3' -H 'X-M2M-Origin: AdminConsole' -H 'X-M2M-RVI: 2a'
done
sleep 12
```

Expected: `hit_ri` 의 `/Mobius/hittest` 행 `http` 가 **증가하지 않는다.**

정리:

```bash
curl -s -X DELETE http://localhost:7579/Mobius/hittest \
  -H 'X-M2M-RI: 9' -H 'X-M2M-Origin: Sponde' -H 'X-M2M-RVI: 2a' -o /dev/null
```

- [ ] **Step 8: 커밋**

```bash
git add app.js mobius.js mobius/hit_man.js test/hit-man.test.js
git commit -m "feat: hit_ri 수집 배선과 보관 정리 (콘솔 origin 제외)"
```

---

### Task 9: `delete_lookup_et` 진단 로그

만료 정리가 실패해도 흔적이 없다. `if (!err)` 뿐이고 `else` 가 없어 콜백조차 호출되지 않는다. 스펙 §13 #2.

**이 태스크는 삭제 범위를 바꾸지 않는다.** AE/CNT 제외와 SQLite 미동작은 의도적으로 유지한다(콘솔이 대신한다). 실패가 보이게만 만든다.

**Files:**
- Modify: `mobius/sql_action.js:3568-3583`
- Modify: `app.js:101-119`

**Interfaces:**
- Consumes: 없음
- Produces: `delete_lookup_et(connection, et, callback)` — **실패 시에도 `callback(err)` 를 부른다** (기존에는 안 불렀다)

- [ ] **Step 1: `delete_lookup_et` 에 실패 분기를 넣는다**

`mobius/sql_action.js:3568` 의 함수를 아래로 바꾼다:

```js
// 주의: 이 함수는 ty 2(AE) / 3(CNT) / 5(CSEBase) 를 의도적으로 제외한다.
// 만료된 AE·컨테이너는 관리 콘솔에서 사람이 확인하고 지운다.
// 또한 MySQL 전용이다 — SQLite 배포에서는 만료 자동 정리가 동작하지 않는다.
// 두 제약 모두 의도된 것이며 근거는
// docs/superpowers/specs/2026-08-28-admin-console-design.md §배경, §13 을 참조.
exports.delete_lookup_et = function (connection, et, callback) {
    var pi_list = [];
    var sql = util.format("select ri from lookup where et < \'%s\' and ty <> \'2\' and ty <> \'3\' and ty <> \'5\'", et);
    db.getResult(sql, connection, function (err, delete_Obj) {
        if (err) {
            console.error('[delete_lookup_et] select failed: ' +
                          ((delete_Obj && delete_Obj.message) || delete_Obj));
            callback(err, delete_Obj);
            return;
        }

        for (var i = 0; i < delete_Obj.length; i++) {
            pi_list.push(delete_Obj[i].ri);
        }

        if (pi_list.length === 0) {
            callback(null, []);
            return;
        }

        console.log('[delete_lookup_et] ' + pi_list.length + ' expired resource(s) to delete');

        var finding_Obj = [];
        _this.delete_lookup(connection, pi_list, 0, finding_Obj, 0, function (err2, search_Obj) {
            if (err2 && err2 !== '200') {
                console.error('[delete_lookup_et] delete failed: ' + err2);
            }
            callback(err2, search_Obj);
        });
    });
};
```

- [ ] **Step 2: 호출부가 실패를 로그로 남기게 한다**

`app.js:101-119` 의 `del_expired_resource`:

```js
function del_expired_resource() {
    // SQLite 배포에서는 delete_lookup_et 이 MySQL 전용이라 동작하지 않는다.
    // 만료 정리는 관리 콘솔이 담당한다.
    if (global.usesqlite === 'true') {
        console.log('[del_expired_resource] skipped — SQLite backend, use the admin console');
        return;
    }

    db.getConnection((code, connection) => {
        if (code === '200') {
            var et = moment().utc().format('YYYYMMDDTHHmmss');
            db_sql.delete_lookup_et(connection, et, (err) => {
                if (err && err !== '200') {
                    console.error('[del_expired_resource] failed:', err);
                }
                else {
                    console.log('[del_expired_resource] done (AE/CNT/CSEBase are excluded by design)');
                }
                connection.release();
            });
        }
        else {
            console.log('[del_expired_resource] No Connection');
        }
    });
}
```

- [ ] **Step 3: 함수가 콜백을 반드시 부르는지 확인한다**

```bash
node -e "
global.usesqlite='false';
const path=require('path');
const db=require('./mobius/db_action');
// getResult 를 실패로 스텁해 콜백이 불리는지 본다
db.getResult=function(sql,conn,cb){ cb(true,{message:'simulated failure'}); };
const sa=require('./mobius/sql_action');
let called=false;
sa.delete_lookup_et(null,'20260828T000000',function(err){ called=true;
  console.log('callback 호출됨, err =', err); });
setTimeout(()=>{ if(!called){console.error('FAIL: 콜백이 호출되지 않았다');process.exit(1);}
  console.log('OK'); },300);
"
```

Expected: `callback 호출됨, err = true` 와 `OK`. 변경 전에는 `FAIL` 이 난다.

- [ ] **Step 4: 커밋**

```bash
git add mobius/sql_action.js app.js
git commit -m "fix: delete_lookup_et 실패 시 콜백 호출과 진단 로그 추가"
```

---

### Task 10: 전체 회귀 확인과 문서 갱신

**Files:**
- Modify: `CLAUDE.md` (새 모듈 표에 반영)
- Modify: `README.md` (What's New)

**Interfaces:**
- Consumes: Task 1-9 전부
- Produces: 없음

- [ ] **Step 1: 전체 테스트를 돌린다**

Run: `npm test`
Expected: 기존 테스트(`converted-queries`, `db-facade`, `sqli-regression`) + 신규 4개 파일이 전부 PASS

- [ ] **Step 2: 동등성 하네스를 돌린다**

Run: `node tools/equivalence/run-scenarios.js`
Expected: 모든 시나리오 통과. Task 2 에서 뜬 `before-task2.json` 과 비교해 차이가 없어야 한다.

- [ ] **Step 3: 두 백엔드로 기동을 확인한다**

```bash
node mobius.js sqlite    # 기동 후 Ctrl+C
node mobius.js mysql     # MySQL 이 있는 환경에서만. 기동 후 Ctrl+C
```

Expected: 스키마 초기화 에러 없음, `mobius server ... running` 출력

- [ ] **Step 4: `CLAUDE.md` 의 핵심 모듈 표에 세 줄을 추가한다**

`| wdt.js | 범용 주기 콜백 레지스트리...` 행 아래에:

```markdown
| `mobius/acp_eval.js` | ACP 판정 순수 함수. `security.js` 와 관리 콘솔이 공유한다 |
| `mobius/cache_man.js` | 리소스 경로 캐시 — LRU 상한 + cluster IPC 로 워커 간 무효화 |
| `mobius/hit_man.js` | 리소스별 사용 이력(`hit_ri`) 버퍼링과 주기 flush |
```

- [ ] **Step 5: `CLAUDE.md` 의 캐싱 절을 갱신한다**

기존 문장:

```markdown
애플리케이션 레벨 LRU 캐시는 없다. `pxy_mqtt.js`가 `wdt` 기반 TTL로 메시지 캐시를 두는 정도다.
```

를 아래로 바꾼다:

```markdown
`mobius/cache_man.js`가 리소스 경로 캐시를 관리한다. LRU 상한(`conf.json` 의 `cacheLimit`, 기본 50000)이 있고, 삭제·수정 시 cluster IPC 로 **전 워커에 무효화를 브로드캐스트**한다. 브로드캐스트 없이 로컬만 지우면 다른 워커가 삭제된 리소스를 계속 200 으로 돌려준다. 그 밖에 `pxy_mqtt.js`가 `wdt` 기반 TTL로 메시지 캐시를 둔다.
```

- [ ] **Step 6: `README.md` 의 What's New 에 절을 추가한다**

`### SQLite Support` 앞에 삽입:

```markdown
### Admin Console Prerequisites

Groundwork for the resource management console, each item useful on its own:

- **Cross-worker cache invalidation.** Deleting a resource previously cleared only the handling worker's cache, so other workers kept serving it with `200`. Invalidation is now broadcast to every worker over cluster IPC, and the cache has an LRU bound (`cacheLimit`, default 50000).
- **Per-resource usage history.** A new `hit_ri` table records access counts per resource per day per protocol. Collection is buffered in worker memory and flushed periodically, so the request path performs no extra database write. contentInstance accesses are attributed to the parent container.
- **Indexes.** `lookup(pi)`, `lookup(ty, et)`, `lookup(pi, sri)` and `cin(pi)`. Tree expansion, expiry filtering and container paging were full scans on SQLite and partly on MySQL, where `idx_lookup_pi` was declared `INVISIBLE`. MySQL users must apply [docs/mysql-migration-2.7.md](docs/mysql-migration-2.7.md).
- **Shared ACP evaluation.** Access decision logic moved to `mobius/acp_eval.js` as pure functions, so the console reports exactly what the server enforces. Behaviour is unchanged.
- **Configurable superuser.** `usesuperuser` moved from a hardcoded value in `app.js` to `conf.json` (`superuser`), alongside a separate `adminOrigin` for the console.
```

- [ ] **Step 7: 커밋**

```bash
git add CLAUDE.md README.md
git commit -m "docs: 선행 작업 반영 — 새 모듈, 캐싱 정책, What's New"
```

---

## Self-Review

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| §3 P0-1 캐시 무효화 브로드캐스트 | Task 4 |
| §3 P0-1 `cache_resource_url` 상한 | Task 4 |
| §3 P0-2 `hit_ri` 테이블·SQL | Task 6 |
| §3 P0-2 버퍼링·flush | Task 7 |
| §3 P0-2 CIN → 부모 CNT 귀속 | Task 7 Step 3, Task 8 Step 4 |
| §3 P0-2 콘솔 origin 제외 | Task 7 Step 3 |
| §3 P0-2 보관 120일 | Task 8 Step 5-6 |
| §3 P0-3 SQLite 인덱스 | Task 3 |
| §3 P0-3 MySQL 마이그레이션 | Task 3 |
| §3 P0-4 `acp_eval` 추출 | Task 1, 2 |
| §3 P0-5 `usesuperuser` 설정화 | Task 5 |
| §13 #2 `delete_lookup_et` 진단 로그 | Task 9 |

**이 계획에서 의도적으로 제외한 것**

- **§13 #1 `acor` 정규식 역전 (인증 우회).** Task 1 이 결함을 그대로 보존하고 `KNOWN BUG` 테스트로 잠근다. 수정은 별건 보안 패치로 분리한다 — 동작을 바꾸는 변경과 리팩터링을 한 커밋에 섞으면 회귀 원인을 가릴 수 없기 때문이다. 다만 추출 덕분에 수정이 `checkAcor` 한 함수의 변경으로 끝난다
- **§13 #4 `delete_descendants_background` 재시도 상한.** 콘솔의 카나리 실행으로 완화하며, 근본 수정은 별건
- **`hit_ri` 수집 시작일 기록.** 콘솔의 `admin.db` 에 들어가므로 다음 계획의 범위
- **`admin.db`, 콘솔 서버, Vue 프런트엔드.** 전부 다음 계획들

**타입·이름 일관성 확인**

- `cache_man` 의 API 이름이 Task 4 정의(`get`/`set`/`has`/`invalidate`/`invalidate_local`/`keys_for`/`size`)와 Step 7·8 사용처에서 일치한다
- `hit_man.record(ri, ty, binding, originator)` 의 인자 순서가 Task 7 정의와 Task 8 Step 3 호출부에서 일치한다
- `sql_action.upsert_hit_ri_batch(connection, rows, callback)` 가 Task 6 정의와 Task 7 의 `writer` 호출에서 일치한다
- `acp_eval.evaluateDefault(ctx, enforcement)` 의 인자 순서가 Task 1 정의와 Task 2 Step 5 호출에서 일치한다

---

## 후속 계획 (이 계획의 범위 밖)

스펙 §11 의 단계표에 대응한다. 각각 별도 계획 문서로 작성한다.

| 계획 | 내용 | 선행 |
|---|---|---|
| part1 | 콘솔 골격 + 인증 + 읽기 API + 정리 대상 그리드 + 리소스 상세 + 트리 탐색 | 이 계획 |
| part2 | 작업 엔진 (프리플라이트·아카이브·카나리·2축 진행률·사후 검증) + 만료 연장/삭제 | part1 |
| part3 | 권한(ACP) UI + 유효 권한 시뮬레이터 | part1, Task 1-2 |
| part4 | 현황 대시보드 + 진단 (카운터 불일치, 고아 배치) | part1 |

**part1 은 이 계획을 배포하고 최소 2~3주 뒤에 시작하는 것이 좋다.** `hit_ri` 에 데이터가 쌓여야 "무접근" 신호가 의미를 갖는다. 수집 없이 콘솔을 열면 모든 리소스가 무접근으로 보이고, 그 상태로 일괄 삭제하면 살아있는 AE 를 지운다.
