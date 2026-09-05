# 알림 라우팅 원천을 `sub` 테이블로 — 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 알림 발송 목록을 `lookup.subl` 사본이 아니라 `sub` 테이블에서 읽게 하고, ID 형 nu 해석을 배치로 바꾼다. `subl` 쓰기는 유지한다(이중 쓰기 — 2단계에서 뗀다).

**Architecture:** `sgn.check` 가 언제나 자기 커넥션을 빌려 `sub where pi = targetObject.ri` 를 한 번 읽고(128 은 지워진 구독 자신), 기존 `sgn_action` 루프에 그 행을 넘긴다. 행의 nu/enc 는 JSON 문자열이라 `subl_entry.read` 가 그대로 읽는다. nu 해석은 새 모듈 `nu_resolve.js`(질의 3번)가 맡는다. 두 새 모듈(`sub_source.js`, `nu_resolve.js`)은 `sgn_man` 을 끌어오지 않아 시험에서 로드된다.

**Tech Stack:** Node 22 콜백 스타일, knex 빌더(`facade.k`), `node --test`, MySQL 8 / SQLite.

**Spec:** `docs/superpowers/specs/2026-09-05-notification-routing-source-design.md`

## Global Constraints

- 판정·발송 목록·순서는 스펙 §3.3 의 8건 말고는 바뀌지 않는다. 8건은 전부 오늘 무영향.
- 마이그레이션에 `autoApply` 를 붙이지 않는다 — 인덱스 생성·컬럼 변경은 DDL 종류로 금지된다(`test/db-bootstrap.test.js`). 배포 때 `node tools/migrate.js --apply` 로 손으로 적용한다. **스펙 §3.2 의 "즉시 적용 대상" 은 이 규칙에 맞춰 고친다(Task 10).**
- 마이그레이션이 만드는 인덱스는 `mobius/db/mobiusdb.sql` 에도 같은 이름으로 선언한다(`test/schema-drift.test.js`).
- SQL 은 `sql_action.js` 에서 knex 빌더로만. `sgn.js` 는 `request.db_connection` 을 쓰지 않는다.
- 커밋마다 `npm test` 실패 0. 검증 사슬은 `set -o pipefail` + `ℹ fail 0` 직접 확인.
- 다른 세션(mobius-8f)이 같은 `lite`·같은 서버를 쓴다. 커밋은 파일을 명시해서, 배포 전 서버 HEAD 확인.

---

### Task 1: `sub(pi)` 인덱스 — 마이그레이션 013 + 스키마 파일

**Files:**
- Create: `migrations/013-sub-pi-index.js`
- Modify: `mobius/db/mobiusdb.sql` (sub 테이블 KEY 추가), `mobius/db/mobiusdb_sqlite.sql` (CREATE INDEX IF NOT EXISTS)
- Test: `test/schema-drift.test.js` (기존), `test/migrate.test.js` (기존), `test/db-bootstrap.test.js` (기존)

**Interfaces:** Produces 인덱스 이름 리터럴 `idx_sub_pi`.

- [ ] **Step 1: 마이그레이션 파일 작성**

```js
'use strict';
// sub(pi) 인덱스.
//
// 알림 라우팅의 원천을 lookup.subl 사본에서 sub 테이블로 옮긴다
// (docs/superpowers/specs/2026-09-05-notification-routing-source-design.md).
// 그러면 쓰기마다 `select ... from sub where pi = ?` 가 한 번 돈다.
// 배포 실측(2026-09-05): sub 3,463행, pi 인덱스 없이는 풀스캔 2.48ms, PK 조회 0.35ms.
//
// autoApply 를 붙이지 않는다 — 인덱스 생성은 DDL 종류로 기동 경로에서 금지된다
// (test/db-bootstrap.test.js). 3,463행이라 즉시 끝나지만 규칙은 행 수가 아니라
// 종류로 정한다. 배포 때 손으로 적용한다: node tools/migrate.js --apply
//
// SQLite 는 mobiusdb_sqlite.sql 의 CREATE INDEX IF NOT EXISTS 가 기동 때 만든다.
// 되돌리려면 DROP INDEX idx_sub_pi ON sub;
function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['sub', 'idx_sub_pi']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

module.exports = {
    id: '013-sub-pi-index',
    description: 'sub(pi) 인덱스 — 알림이 부모 ri 로 구독 행을 읽는다',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            cb(null, exists ? '이미 있음 — 적용하면 이력만 남긴다'
                            : '없음 — sub 는 수천 행이라 즉시 끝난다 (INPLACE, LOCK=NONE)');
        });
    },

    up: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (exists) {
                console.log('    (인덱스가 이미 있다 — 만들지 않고 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            ctx.db.run(
                ctx.db.raw('ALTER TABLE sub ADD INDEX idx_sub_pi (pi), ALGORITHM=INPLACE, LOCK=NONE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
```

- [ ] **Step 2: 스키마 파일 둘에 선언**

`mobiusdb.sql` 의 `CREATE TABLE \`sub\`` 블록에 `KEY \`idx_sub_pi\` (\`pi\`),` 를 `UNIQUE KEY` 다음 줄에 넣는다. `mobiusdb_sqlite.sql` 은 기존 `CREATE INDEX IF NOT EXISTS idx_lookup_...` 줄들 옆에 `CREATE INDEX IF NOT EXISTS idx_sub_pi ON sub(pi);` 를 넣는다.

- [ ] **Step 3: 시험**

Run: `node --test test/schema-drift.test.js test/migrate.test.js test/db-bootstrap.test.js`
Expected: 전부 통과 (schema-drift 가 `idx_sub_pi` 를 mobiusdb.sql 에서 찾는다).

- [ ] **Step 4: 커밋** — Task 2 와 함께.

### Task 2: `sub.nu` / `sub.enc` 폭 — 마이그레이션 014 + 스키마 파일

**Files:**
- Create: `migrations/014-sub-widen-nu-enc.js`
- Modify: `mobius/db/mobiusdb.sql` (sub 의 nu·enc 를 `text`)

- [ ] **Step 1: 마이그레이션 파일 작성**

```js
'use strict';
// sub.nu / sub.enc 를 text 로.
//
// sub 테이블이 알림 라우팅의 원천이 되면(013 참조) 이 두 컬럼이 곧 발송 주소와
// 이벤트 조건이다. varchar(200) 은 URL 두세 개면 넘치고, varchar(45) 는 enc 에
// atr/om 필터를 넣으면 넘친다. 배포는 STRICT 라 넘치면 생성이 실패하지 조용히
// 잘리지는 않는다(실측 최대 nu 91 / enc 25). 원천 컬럼에 그런 상한을 둘 이유가 없다.
//
// COPY 알고리즘이라 테이블을 다시 쓴다 — sub 는 수천 행이라 즉시 끝난다.
// autoApply 는 붙이지 않는다(DDL 규칙). 배포 때 node tools/migrate.js --apply
// SQLite 는 VARCHAR 폭을 강제하지 않아 할 일이 없다.
// 되돌리려면 ALTER TABLE sub MODIFY nu varchar(200), MODIFY enc varchar(45);
function types(ctx, cb) {
    ctx.db.run(ctx.db.raw(
        'select column_name as n, data_type as t from information_schema.columns' +
        " where table_schema = database() and table_name = 'sub' and column_name in ('nu','enc')"),
        ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            var t = {};
            (rows || []).forEach(function (r) { t[r.n || r.N] = String(r.t || r.T).toLowerCase(); });
            cb(null, t);
        });
}

module.exports = {
    id: '014-sub-widen-nu-enc',
    description: 'sub.nu / sub.enc 를 text 로 — 원천 컬럼에 폭 상한을 두지 않는다',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        types(ctx, function (err, t) {
            if (err) { return cb(err, null); }
            cb(null, 'nu=' + (t.nu || '?') + ' enc=' + (t.enc || '?') +
                     ((t.nu === 'text' && t.enc === 'text') ? ' — 이미 text' : ' — text 로 바꾼다 (수천 행, 즉시)'));
        });
    },

    up: function (ctx, cb) {
        types(ctx, function (err, t) {
            if (err) { return cb(err, t); }
            if (t.nu === 'text' && t.enc === 'text') { return cb(null, { affectedRows: 0 }); }
            ctx.db.run(ctx.db.raw('ALTER TABLE sub MODIFY nu text, MODIFY enc text'),
                       ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
```

- [ ] **Step 2: `mobiusdb.sql` 의 sub 테이블에서 `nu` varchar(200) → `text`, `enc` varchar(45) → `text`.**

- [ ] **Step 3: 시험** — `node --test test/migrate.test.js test/db-bootstrap.test.js test/schema-drift.test.js` 통과.

- [ ] **Step 4: 커밋**

```bash
git add migrations/013-sub-pi-index.js migrations/014-sub-widen-nu-enc.js mobius/db/mobiusdb.sql mobius/db/mobiusdb_sqlite.sql
git commit -m "db(sub): pi 인덱스와 nu/enc 폭 — 알림 라우팅 원천이 되기 위한 스키마 (013·014)"
```

### Task 3: `sql_action.select_subs_by_pi`

**Files:**
- Modify: `mobius/sql_action.js` (`insert_sub` 근처)
- Test: `test/sgn-source.test.js` (신규, SQL 모양 부분)

**Interfaces:** Produces `select_subs_by_pi(connection, pi, callback)` → `callback(err, rows)`; rows = `[{ ri, nu, enc, nct, nec, cr }]` (nu·enc 는 JSON **문자열**), `ri` 오름차순.

- [ ] **Step 1: 실패하는 시험** (`test/sgn-source.test.js` 앞부분)

```js
'use strict';
// 알림 라우팅의 원천은 sub 테이블이다 (스펙: docs/superpowers/specs/2026-09-05-notification-routing-source-design.md)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function tapSql() {
    const DB = path.join(ROOT, 'mobius', 'db');
    process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-sgn-source-test.db');
    ['', 'mysql.js', 'sqlite.js'].forEach((f) => { delete require.cache[require.resolve(path.join(DB, f))]; });
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const calls = [];
    adapter.execute = function (h, sql, bindings, cb) { calls.push({ sql, bindings }); cb(null, calls.rows ? calls.rows.shift() : []); };
    db.connect(function () {});
    const SA = path.join(ROOT, 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    return { sql_action: require(SA), calls };
}

test('select_subs_by_pi — sub 에서 발송 6필드를 부모 ri 로, ri 오름차순', (t, done) => {
    const { sql_action, calls } = tapSql();
    sql_action.select_subs_by_pi(null, '/Mobius/ae1/c1', (err, rows) => {
        assert.ok(!err);
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].sql, 'select `ri`, `nu`, `enc`, `nct`, `nec`, `cr` from `sub` where `pi` = ? order by `ri` asc');
        assert.deepStrictEqual(calls[0].bindings, ['/Mobius/ae1/c1']);
        assert.ok(Array.isArray(rows));
        done();
    });
});
```

- [ ] **Step 2: 실패 확인** — `node --test test/sgn-source.test.js` → `select_subs_by_pi is not a function`.

- [ ] **Step 3: 구현** (`sql_action.js`, `insert_sub` 바로 위)

```js
// 알림 라우팅의 원천. sgn.check 가 쓰기마다 부모 ri 로 한 번 읽는다
// (docs/superpowers/specs/2026-09-05-notification-routing-source-design.md).
// 발송기(subl_entry.read)가 읽는 6필드만 고르고, 순서는 ri 오름차순으로 고정한다 —
// 옛 subl 은 삽입순이었지만 랜덤 지연이 이미 순서를 흔들고 있어 실효가 없다.
exports.select_subs_by_pi = function (connection, pi, callback) {
    facade.run(facade.k('sub').select('ri', 'nu', 'enc', 'nct', 'nec', 'cr')
                     .where({ pi: pi }).orderBy('ri', 'asc'), connection, callback);
};
```

- [ ] **Step 4: 통과 확인.**  `test/merged-branches.test.js` 의 `select_sub` 항목 사유 문구를 `'호출부 0 — 알림은 select_subs_by_pi 로 sub 를 읽는다'` 로 바꾼다(정규식은 `select_subs_by_pi` 에 안 걸린다).

### Task 4: `sql_action.select_resources_in`

**Files:**
- Modify: `mobius/sql_action.js` (`select_resource_from_url` 바로 아래)
- Test: `test/sgn-source.test.js`

**Interfaces:** Produces `select_resources_in(connection, ri_list, sri_list, callback)` → `callback(err, rows)`; rows = lookup 행에 타입 테이블 행을 merge 한 것(있으면). `select_resource_from_url` 과 같은 규칙 — 타입 테이블이 없는 ty 는 lookup 행만.

- [ ] **Step 1: 실패하는 시험**

```js
test('select_resources_in — lookup 한 번(ri in … or sri in …) 뒤 타입별 테이블 한 번씩, merge', (t, done) => {
    const { sql_action, calls } = tapSql();
    calls.rows = [
        [{ ri: '/M/ae1', sri: 'Cae1', ty: '2' }, { ri: '/M/ae2', sri: 'Cae2', ty: '2' }, { ri: '/M/x', sri: 'X', ty: '99' }],
        [{ ri: '/M/ae1', poa: '["http://a"]' }, { ri: '/M/ae2', poa: '["http://b"]' }]
    ];
    const errs = []; const oe = console.error; console.error = (m) => errs.push(String(m));
    sql_action.select_resources_in(null, ['/M/ae1', '/M/ae2', '/M/x'], ['Cae1', 'Cae2', 'X'], (err, rows) => {
        console.error = oe;
        assert.ok(!err);
        assert.strictEqual(calls.length, 2, 'lookup 1 + ae 1');
        assert.match(calls[0].sql, /^select \* from `lookup` where \(`ri` in \(\?, \?, \?\) or `sri` in \(\?, \?, \?\)\)$/);
        assert.strictEqual(calls[1].sql, 'select * from `ae` where `ri` in (?, ?)');
        assert.deepStrictEqual(rows.map((r) => [r.ri, r.poa]), [['/M/ae1', '["http://a"]'], ['/M/ae2', '["http://b"]'], ['/M/x', undefined]]);
        assert.ok(errs.some((e) => /지원하지 않는 타입/.test(e)));
        done();
    });
});

test('select_resources_in — 빈 목록이면 질의 없이 빈 배열', (t, done) => {
    const { sql_action, calls } = tapSql();
    sql_action.select_resources_in(null, [], [], (err, rows) => {
        assert.ok(!err); assert.strictEqual(calls.length, 0); assert.deepStrictEqual(rows, []); done();
    });
});
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현**

```js
// select_resource_from_url 의 배치판. nu 해석(mobius/nu_resolve.js)이 ID 형 nu 전부를
// 한 번에 푼다. lookup 을 ri 목록 또는 sri 목록으로 한 번 읽고, 나온 타입마다 테이블을
// 한 번씩 읽어 merge 한다. 규칙은 단건과 같다 — 이 CSE 가 다루지 않는 타입은
// lookup 행만 돌려준다(poa 가 없으니 호출부가 "보낼 곳이 없다" 로 뺀다).
exports.select_resources_in = function (connection, ri_list, sri_list, callback) {
    var ris = ri_list || [], sris = sri_list || [];
    if (ris.length === 0 && sris.length === 0) { callback(null, []); return; }
    var qb = facade.k('lookup').select('*').where(function () {
        this.whereIn('ri', ris).orWhereIn('sri', sris);
    });
    facade.run(qb, connection, function (err, comm) {
        if (err) { callback(err, comm); return; }
        var byTable = {};
        (comm || []).forEach(function (row) {
            var table = responder.typeRsrc[row.ty];
            if (!table) {
                console.error('[select_resources_in] 지원하지 않는 타입의 행: ty=' + row.ty + ' ' + row.ri);
                return;
            }
            (byTable[table] = byTable[table] || []).push(row.ri);
        });
        var tables = Object.keys(byTable);
        var spec = {};
        (function next(i) {
            if (i >= tables.length) {
                callback(null, (comm || []).map(function (row) {
                    return spec[row.ri] ? merge(row, spec[row.ri]) : row;
                }));
                return;
            }
            facade.run(facade.k(tables[i]).select('*').whereIn('ri', byTable[tables[i]]), connection,
                function (err2, rows) {
                    if (err2) { callback(err2, rows); return; }
                    (rows || []).forEach(function (r) { spec[r.ri] = r; });
                    next(i + 1);
                });
        })(0);
    });
};
```

- [ ] **Step 4: 통과 확인, 커밋**

```bash
git add mobius/sql_action.js test/sgn-source.test.js test/merged-branches.test.js
git commit -m "sql(sub): select_subs_by_pi · select_resources_in — 알림 라우팅 원천과 nu 배치 해석용"
```

### Task 5: `mobius/nu_resolve.js` — ID 형 nu 를 질의 3번에

**Files:**
- Create: `mobius/nu_resolve.js`
- Test: `test/sgn-resolve-nu.test.js`

**Interfaces:**
- Consumes `db_sql.get_ri_sri_in(connection, sri_list, cb)`, `db_sql.select_resources_in(connection, ri_list, sri_list, cb)`, `poa_util.parse(raw, label)`, 전역 `usespid`·`usecseid`.
- Produces `resolve(connection, nu_arr, sub_ri, callback)` → `callback(resolved_nu_arr)` (URL 문자열 배열, 원래 순서, ID 항목은 poa URL 들로 늘어나거나 빠진다). 옛 `get_nu_arr` 의 판정·문구를 그대로 지킨다.

- [ ] **Step 1: 실패하는 시험**

```js
'use strict';
// 옛 get_nu_arr(nu 마다 질의 2, 순차) 를 질의 3번(sri 풀기 · lookup · 타입 테이블)으로.
// 판정과 로그 문구는 옛것 그대로다. (남은 일 §5.6-1, 스펙 §3.2)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
global.usespid = '//sp.test'; global.usecseid = '/Mobius'; global.usecsebase = 'Mobius';
const db_sql = require('../mobius/sql_action');
const nu_resolve = require('../mobius/nu_resolve');

function stub(lookupRows, opts) {
    opts = opts || {};
    const s = { sri_calls: [], res_calls: [] };
    db_sql.get_ri_sri_in = (c, list, cb) => { s.sri_calls.push(list.slice()); setImmediate(() => cb(opts.sriErr || null, opts.sriErr ? null : (opts.sriRows || []))); };
    db_sql.select_resources_in = (c, ris, sris, cb) => { s.res_calls.push([ris.slice(), sris.slice()]); setImmediate(() => cb(opts.resErr || null, opts.resErr ? null : lookupRows)); };
    return s;
}
function run(nu_arr, sub_ri) { return new Promise((r) => nu_resolve.resolve({}, nu_arr, sub_ri || '/M/s1', r)); }
function quiet(fn) { const e = console.error, lines = []; console.error = (m) => lines.push(String(m)); return Promise.resolve().then(fn).then((v) => { console.error = e; return { v, lines }; }, (x) => { console.error = e; throw x; }); }

test('전부 URL 이면 질의 없이 그대로', async () => {
    const s = stub([]);
    const out = await run(['mqtt://b/t', 'http://h/p']);
    assert.deepStrictEqual(out, ['mqtt://b/t', 'http://h/p']);
    assert.strictEqual(s.sri_calls.length + s.res_calls.length, 0);
});

test('ID 형은 한 번에 풀린다 — 질의 1+1, 순서 보존, poa 가 여럿이면 여럿으로', async () => {
    const s = stub([{ ri: '/Mobius/ae1', sri: 'Cae1', ty: '2', poa: '["http://a:1/n/","http://b:2"]' }]);
    const out = await run(['mqtt://first', 'Cae1', 'http://last']);
    assert.deepStrictEqual(out, ['mqtt://first', 'http://a:1/n', 'http://b:2', 'http://last']);
    assert.deepStrictEqual(s.sri_calls, [['Cae1']]);
    assert.deepStrictEqual(s.res_calls, [[['/Cae1'], ['Cae1']]]);
});

test('sri 가 풀리면 그 ri 로 lookup 을 묻는다 (옛 replace 규칙, 쿼리는 버려진다)', async () => {
    const s = stub([{ ri: '/Mobius/ae1', sri: 'Cae1', ty: '2', poa: '["http://a"]' }], { sriRows: [{ sri: 'Cae1', ri: '/Mobius/ae1' }] });
    const out = await run(['Cae1?rcn=9']);
    assert.deepStrictEqual(out, ['http://a']);
    assert.deepStrictEqual(s.res_calls, [[['/Mobius/ae1'], ['Cae1']]]);
});

test('프로토콜 없는 poa 는 localhost 로, sp/cse 상대 표기는 접힌다', async () => {
    stub([{ ri: '/Mobius/ae1', sri: 'Cae1', ty: '2', poa: '["Mobius/ae1"]' }]);
    const out = await run(['//sp.test/Mobius/Cae1', '/Mobius/Cae1']);
    assert.deepStrictEqual(out, ['http://localhost:7579/Cae1', 'http://localhost:7579/Cae1']);
});

test('받을 리소스가 없으면 그 nu 만 빠지고 문구가 남는다', async () => {
    stub([]);
    const { v, lines } = await quiet(() => run(['Cnone', 'mqtt://ok'], '/M/s9'));
    assert.deepStrictEqual(v, ['mqtt://ok']);
    assert.ok(lines.some((l) => l === '[noti] fail - sub=/M/s9 nu=Cnone (받을 리소스가 없다: /Cnone)'), lines.join('\n'));
});

test('poa 가 비면 빠진다', async () => {
    stub([{ ri: '/Mobius/ae1', sri: 'Cae1', ty: '2', poa: '[]' }]);
    const { v, lines } = await quiet(() => run(['Cae1']));
    assert.deepStrictEqual(v, []);
    assert.ok(lines.some((l) => /받을 리소스에 poa 가 없다: \/Cae1/.test(l)));
});

test('ri 매치가 sri 매치보다 먼저다 (옛 코드에서 미정의였던 순서를 고정)', async () => {
    stub([{ ri: '/other', sri: 'Cae1', ty: '2', poa: '["http://by-sri"]' }, { ri: '/Cae1', sri: 'zzz', ty: '2', poa: '["http://by-ri"]' }]);
    assert.deepStrictEqual(await run(['Cae1']), ['http://by-ri']);
});

test('DB 오류면 ID 항목은 전부 빠지고 URL 항목은 남는다', async () => {
    stub([], { sriErr: new Error('x') });
    const a = await quiet(() => run(['Cae1', 'mqtt://ok', 'Cae2']));
    assert.deepStrictEqual(a.v, ['mqtt://ok']);
    assert.strictEqual(a.lines.filter((l) => /nu 해석 중 DB 오류/.test(l)).length, 2);
    stub([], { resErr: new Error('y') });
    const b = await quiet(() => run(['Cae1', 'mqtt://ok']));
    assert.deepStrictEqual(b.v, ['mqtt://ok']);
    assert.ok(b.lines.some((l) => /받을 리소스 조회 중 DB 오류/.test(l)));
});

test('sgn.js 는 옛 get_nu_arr 이 없고 nu_resolve 를 쓴다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.strictEqual(src.indexOf('function get_nu_arr'), -1);
    assert.strictEqual(src.indexOf('get_ri_sri('), -1, 'nu 별 조회가 되살아났다');
    assert.strictEqual(src.indexOf('select_resource_from_url('), -1);
    assert.match(src, /nu_resolve\.resolve\(connection, nu_arr, results_ss\.ri, function \(resolved\)/);
});
```

- [ ] **Step 2: 실패 확인** — 모듈 없음.

- [ ] **Step 3: 구현** `mobius/nu_resolve.js`

```js
'use strict';
/**
 * 구독 nu 목록의 ID 형 항목을 보낼 주소(URL)로 푼다 — 질의 3번.
 *
 * 옛 sgn.js 의 get_nu_arr 은 nu 하나씩 재귀하며 ID 형마다 질의 2번(get_ri_sri →
 * select_resource_from_url)을 순차로 냈다. 이 파일은 같은 판정을 세 단계로 한다:
 *   1) 순수 분류 — URL 은 그대로, ID 는 옛 규칙대로 절대 경로와 첫 세그먼트 계산
 *   2) 질의 — get_ri_sri_in 한 번, select_resources_in 한 번(+ 타입 수)
 *   3) 순수 재조립 — 원래 순서대로. ID 는 poa URL 들로(여럿이면 여럿), 못 풀면 뺀다
 *
 * 옛 판정 그대로: 매치 행이 없으면 뺀다. 프로토콜 없는 poa 는 localhost:7579 +
 * 절대 경로. 끝 '/' 는 뗀다. 로그 문구도 같다 — "[noti] fail - sub=… nu=… (…)".
 * 옛 코드에서 ri 매치와 sri 매치가 둘 다 있을 때 어느 행을 쓰는지는 DB 순서에 달린
 * 미정의였다. 여기서는 ri 매치를 먼저 쓴다.
 * 배치 질의가 실패하면 ID 항목 전부를 "DB 오류" 로 빼고 URL 항목은 보낸다 — 옛 코드도
 * 오류 상황에서는 nu 마다 같은 오류를 만났다.
 *
 * sgn_man 을 끌어오지 않는다 — 그래서 시험이 이 파일을 로드할 수 있다.
 */
var url = require('url');
var db_sql = require('./sql_action');
var poa_util = require('./poa');

// 옛 get_nu_arr 의 ID 판정과 접기 그대로.
function classify(nu) {
    if (url.parse(nu).protocol != null) { return null; }
    var absolute_url = nu.replace(usespid + usecseid + '/', '/').replace(usecseid + '/', '/');
    if (absolute_url.charAt(0) != '/') { absolute_url = '/' + absolute_url; }
    var seg_raw = absolute_url.split('/')[1];              // 쿼리가 붙어 있을 수 있다
    return { absolute_url: absolute_url, seg_raw: seg_raw, sri: seg_raw.split('?')[0] };
}

exports.resolve = function (connection, nu_arr, sub_ri, callback) {
    var items = nu_arr.map(function (nu) { return { nu: nu, id: classify(String(nu)), out: null }; });
    var ids = items.filter(function (it) { return it.id; });

    function fail(it, why) {
        console.error('[noti] fail - sub=' + (sub_ri || '?') + ' nu=' + it.nu + ' (' + why + ')');
        it.out = [];
    }
    function finish() {
        var out = [];
        items.forEach(function (it) {
            if (!it.id) { out.push(it.nu); }
            else if (it.out) { Array.prototype.push.apply(out, it.out); }
        });
        callback(out);
    }
    if (ids.length === 0) { finish(); return; }

    db_sql.get_ri_sri_in(connection, ids.map(function (it) { return it.id.sri; }), function (err, rows) {
        if (err) { ids.forEach(function (it) { fail(it, 'nu 해석 중 DB 오류'); }); finish(); return; }
        var map = {};
        (rows || []).forEach(function (r) { if (!(r.sri in map)) { map[r.sri] = r.ri; } });
        ids.forEach(function (it) {
            if (it.id.sri in map) {
                it.id.absolute_url = it.id.absolute_url.replace('/' + it.id.seg_raw, map[it.id.sri]);
            }
            it.ri = it.id.absolute_url.split('?')[0];
        });
        db_sql.select_resources_in(connection,
            ids.map(function (it) { return it.ri; }), ids.map(function (it) { return it.id.sri; }),
            function (err2, found) {
                if (err2) { ids.forEach(function (it) { fail(it, '받을 리소스 조회 중 DB 오류'); }); finish(); return; }
                ids.forEach(function (it) {
                    var row = null;
                    for (var i = 0; i < found.length && !row; i++) { if (found[i].ri === it.ri) { row = found[i]; } }
                    for (var j = 0; j < found.length && !row; j++) { if (found[j].sri === it.id.sri) { row = found[j]; } }
                    if (!row) { fail(it, '받을 리소스가 없다: ' + it.ri); return; }
                    var poa_arr = poa_util.parse(row.poa, '[sgn_action] ' + it.ri);
                    if (poa_arr === null || poa_arr.length === 0) { fail(it, '받을 리소스에 poa 가 없다: ' + it.ri); return; }
                    it.out = poa_arr.map(function (p) {
                        if (url.parse(p).protocol == null) { return 'http://localhost:7579' + it.id.absolute_url; }
                        return (p.charAt(p.length - 1) == '/') ? p.slice(0, -1) : p;
                    });
                });
                finish();
            });
    });
};
```

- [ ] **Step 4: 통과 확인 (마지막 소스 시험은 Task 7 뒤에 통과), 커밋은 Task 7 과 함께.**

### Task 6: `mobius/sub_source.js` — 어느 행으로 발송하나

**Files:**
- Create: `mobius/sub_source.js`
- Test: `test/sgn-source.test.js` (행 원천 부분)

**Interfaces:** Produces `rows_for(connection, parentObj, notiObj, check_value, callback)` → `callback(rows)`; 128 이면 `[notiObj]`, 아니면 `select_subs_by_pi(parentObj.ri)`; DB 오류면 로그 한 줄 + `[]`.

- [ ] **Step 1: 실패하는 시험**

```js
const sub_source = require('../mobius/sub_source');
function rowsFor(parentObj, notiObj, cv) { return new Promise((r) => sub_source.rows_for({}, parentObj, notiObj, cv, r)); }

test('rows_for — 생성·갱신·자식 삭제는 부모 ri 로 sub 를 읽는다', async () => {
    const calls = [];
    db_sql.select_subs_by_pi = (c, pi, cb) => { calls.push(pi); setImmediate(() => cb(null, [{ ri: '/M/p/s1', nu: '["mqtt://x"]', enc: '{"net":[3]}', nct: 2, nec: null, cr: 'C' }])); };
    for (const cv of [3, 1, 4]) {
        const rows = await rowsFor({ ri: '/M/p' }, { ri: '/M/p/child' }, cv);
        assert.deepStrictEqual(rows.map((r) => r.ri), ['/M/p/s1']);
    }
    assert.deepStrictEqual(calls, ['/M/p', '/M/p', '/M/p']);
});

test('rows_for — 구독 삭제(128)는 지워진 구독 자신이다 (FK 로 행이 이미 없다)', async () => {
    db_sql.select_subs_by_pi = () => { throw new Error('128 은 질의하지 않는다'); };
    const gone = { ri: '/M/p/s2', nu: ['http://h'], enc: { net: [3] }, nct: 2, cr: 'C', su: 'http://h' };
    assert.deepStrictEqual(await rowsFor({ ri: '/M/p' }, gone, 128), [gone]);
});

test('rows_for — DB 오류면 로그 한 줄과 빈 목록 (알림은 fire-and-forget)', async () => {
    db_sql.select_subs_by_pi = (c, pi, cb) => setImmediate(() => cb(new Error('boom'), { message: 'boom' }));
    const { v, lines } = await quiet(() => rowsFor({ ri: '/M/p' }, { ri: '/M/p/c' }, 3));
    assert.deepStrictEqual(v, []);
    assert.ok(lines.some((l) => /\[sgn\] 구독 조회 실패.*\/M\/p/.test(l)));
});
```

(`quiet` 는 Task 5 시험의 것과 같은 도우미를 이 파일에도 둔다.)

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현** `mobius/sub_source.js`

```js
'use strict';
/**
 * 알림을 어느 구독들에 보낼 것인가 — 원천은 sub 테이블이다.
 *
 * 예전에는 부모 lookup 행의 subl(구독 사본 JSON)을 읽었다. 그 사본을 지키는 장치
 * (트랜잭션 잠금 · 되만드는 도구 · 감사의 불신)가 통째로 있었고, 그래도 어긋났다 —
 * 유령 9,475건. 스펙: docs/superpowers/specs/2026-09-05-notification-routing-source-design.md
 *
 * 규칙은 둘뿐이다.
 *   - 생성(3)·갱신(1)·자식 삭제(4): sub where pi = 구독이 붙은 리소스(parentObj).ri
 *   - 구독 삭제(128): 지워진 구독 자신. FK CASCADE 로 행이 이미 없으므로 묻지 않는다.
 *     (옛 코드는 사본에 아직 남은 그 구독과 **형제 구독 전부**에 sud 를 보냈다 —
 *     형제에게 가던 것은 실수였고 배포에 su 설정 구독은 0 이라 영향이 없다.)
 *
 * sgn_man 을 끌어오지 않는다 — 시험이 로드할 수 있다.
 */
var db_sql = require('./sql_action');
var db_errors = require('./db/errors');

exports.rows_for = function (connection, parentObj, notiObj, check_value, callback) {
    if (check_value == 128) { callback([notiObj]); return; }
    db_sql.select_subs_by_pi(connection, parentObj.ri, function (err, rows) {
        if (err) {
            // 알림은 fire-and-forget 이다. 여기서 재시도하면 아픈 DB 를 더 아프게 한다.
            console.error('[sgn] 구독 조회 실패 — 이 알림을 건너뛴다: 부모=' + parentObj.ri +
                          ' ' + db_errors.text(rows));
            callback([]);
            return;
        }
        callback(rows || []);
    });
};
```

(`db/errors.js` 에 `text()` 가 없으면 `(rows && rows.message) || String(rows)` 로 대신한다 — 실행 시 확인.)

- [ ] **Step 4: 통과 확인.**

### Task 7: `sgn.js` — 원천 전환, `needs_connection`·`get_nu_arr` 제거

**Files:**
- Modify: `mobius/sgn.js` (`get_nu_arr` 전체 삭제, `sgn_action` 의 nu 해석 호출, `needs_connection`·`run_with_own_connection`·`check`)
- Modify: `test/sgn-connection.test.js`, `test/callback-contract.test.js`
- Test: `test/sgn-source.test.js` (소스 규칙 부분)

**Interfaces:** Consumes `sub_source.rows_for`, `nu_resolve.resolve`. `sgn.check(request, notiObj, check_value, callback)` 서명 불변.

- [ ] **Step 1: 실패하는 시험** (`test/sgn-source.test.js` 뒤)

```js
test('sgn.js 는 subl 사본을 읽지 않고, 언제나 자기 커넥션으로 sub_source 를 묻는다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.strictEqual(src.indexOf('parentObj.subl'), -1, 'subl 사본을 다시 읽는다');
    assert.strictEqual(src.indexOf('needs_connection'), -1, 'DB 필요 여부 판정이 되살아났다 — 이제 언제나 필요하다');
    assert.strictEqual(src.indexOf('request.db_connection'), -1);
    assert.match(src, /sub_source\.rows_for\(connection, parentObj, notiObj, check_value, function \(rows\)/);
    assert.match(src, /db\.getConnection\(/);
    assert.match(src, /released\s*=\s*true/);
});
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: `sgn.js` 고치기**

(가) 상단 require 에 추가:
```js
var sub_source = require('./sub_source');
var nu_resolve = require('./nu_resolve');
```
(나) `function get_nu_arr(` 부터 그 함수 끝(`}` 다음 빈 줄, `function sgn_action` 앞)까지 삭제. 그 위의 "sub_ri 는 로그 역추적용이다" 주석 블록도 함께.

(다) `sgn_action` 안의 호출을 바꾼다:
```js
            nu_resolve.resolve(connection, nu_arr, results_ss.ri, function (resolved) {
                if (nct == 2 || nct == 1) {
                    setTimeout(function (nu_arr, count, node, short_flag, check_value, cr, ri, xm2mri, exc, parentObj) {
                        sgn_action_send(nu_arr, count, node, short_flag, check_value, results_ss.cr, results_ss.ri, xm2mri, results_ss.exc, parentObj, function (code) {
                            console.log('[sgn_action_send] - ' + code);
                        });
                    }, parseInt(1 + Math.random() * 10), resolved, 0, node, short_flag, check_value, results_ss.cr, results_ss.ri, xm2mri, results_ss.exc, parentObj);
                }
                else {
                    console.log('nct except 2 (All Attribute) do not support');
                }
                sgn_action(connection, rootnm, check_value, subl, ++req_count, noti_Obj, parentObj, function (code) {
                    callback(code);
                });
            });
```
(옛 `if(code == '200') … else …` 갈래는 없어진다 — resolve 는 코드를 주지 않고 언제나 부른다. 두 갈래가 하던 "다음 구독으로" 는 위 한 줄이다.)

(라) `needs_connection` 함수 삭제. `run_with_own_connection(subl, body, on_giveup)` 을 `with_connection(body, on_giveup)` 으로 — 첫 `if (!needs_connection(subl)) {…}` 블록만 지우고 나머지는 그대로. 머리말 주석을 "DB 가 언제나 필요하다(sub 를 읽는다)" 로.

(마) `check` 의 마지막 블록:
```js
    // 요청 커넥션을 쓰면 안 된다. (…기존 설명 유지…)
    //
    // 원천은 sub 테이블이다(sub_source). 그래서 커넥션이 언제나 필요하다 — 정상
    // 운영에서 대여는 1ms 안팎이고 최고 시간대에도 초당 13번이다. 풀이 고갈됐으면
    // 알림을 건너뛰고 남긴다(with_connection) — 그때는 서버가 이미 다른 이유로 아프다.
    with_connection(function (connection, release) {
        sub_source.rows_for(connection, parentObj, notiObj, check_value, function (rows) {
            sgn_action(connection, rootnm, check_value, rows, 0, noti_Obj, parentObj, function (code) {
                release();
                callback(code);
            });
        });
    }, callback);
```
`var subl = parentObj.subl;` 줄은 지운다. `sgn_action` 의 `subl` 파라미터 이름은 `rows` 로 바꾸지 않아도 되지만, 바꾼다면 `callback-contract` 정규식도 같이.

(바) 파일 머리말에 원천 전환 한 문단 추가(스펙 경로 인용).

- [ ] **Step 4: 기존 시험 셋 갱신**

`test/sgn-connection.test.js`: `needs_connection` 관련 시험 둘(47~67행)을 아래로 바꾼다.
```js
test('알림은 언제나 자기 커넥션을 빌린다 — 원천이 sub 테이블이라 DB 가 필요하다', function () {
    assert.strictEqual(SGN.indexOf('needs_connection'), -1, '"DB 가 필요할 때만" 판정이 되살아났다 — 이제 언제나 필요하다');
    assert.ok(/function with_connection\(body, on_giveup\)/.test(SGN));
    assert.ok(/sub_source\.rows_for\(connection, parentObj, notiObj, check_value/.test(SGN));
});
```
파일 머리말의 "DB 가 필요할 때만 빌린다" 절도 같이 고친다.

`test/callback-contract.test.js` 217~227행: `get_nu_arr` 호출 정규식을 새 호출로.
```js
test('sgn_action 이 nu 해석 뒤 언제나 다음 구독으로 간다', function () {
    const src = fsR.readFileSync(pathR.join(ROOT_R, 'mobius', 'sgn.js'), 'utf8');
    const at = src.indexOf('nu_resolve.resolve(connection, nu_arr, results_ss.ri, function (resolved) {');
    assert.ok(at > 0, 'sgn_action 의 nu_resolve.resolve 호출을 찾지 못했다');
    const body = src.slice(at, at + 1500);
    // nct 갈래 어느 쪽이든 그 뒤에 다음 구독 호출이 한 번 있어야 한다.
    assert.ok(/sgn_action\(connection, rootnm, check_value, subl, \+\+req_count/.test(body),
        'nu 해석 뒤 다음 구독으로 넘어가지 않는다');
});
```

- [ ] **Step 5: 통과 확인** — `node --test test/sgn-source.test.js test/sgn-resolve-nu.test.js test/sgn-connection.test.js test/callback-contract.test.js test/merged-branches.test.js test/sgn-subl-entry.test.js`, 그리고 `npm test` 실패 0.

- [ ] **Step 6: 커밋**

```bash
git add mobius/sgn.js mobius/sub_source.js mobius/nu_resolve.js test/sgn-source.test.js test/sgn-resolve-nu.test.js test/sgn-connection.test.js test/callback-contract.test.js
git commit -m "sgn: 알림 라우팅 원천을 sub 테이블로, nu 해석을 질의 3번으로 (1단계 — subl 이중 쓰기 유지)"
```

### Task 8: 차분 하네스 — 옛 `sgn_action`(subl) vs 새 `check`(sub 행)

**Files:** 스크래치패드 `diff-sgn.js` (커밋하지 않는다).

- [ ] **Step 1: 스크립트.** `git show HEAD~1:mobius/sgn.js` 를 스크래치에 떠서 상대 require 를 절대 경로로 바꾸고, `require.cache` 에 `sgn_man` 스텁(`post(nu, xm2mri, body, ri)` 를 기록)을 미리 심은 뒤 옛·새 `sgn.js` 를 로드한다. `db.getConnection` 스텁, `db_sql.select_subs_by_pi`/`get_ri_sri_in`/`select_resources_in`(새) 과 `get_ri_sri`/`select_resource_from_url`(옛) 스텁을 **같은 픽스처**로. 픽스처: 부모 3종(구독 0·1·6) × nu(mqtt URL · http URL · ID 형 있음·없음) × net(3,1,4) × nct(1,2) × check_value(3,1,4,128). 옛 쪽은 `parentObj.subl` 에 같은 구독을 6필드로 심어 준다. 랜덤 지연은 `setTimeout` 을 즉시 실행으로 바꿔 순서를 고정한다.
- [ ] **Step 2: 대조.** 각 조합의 `post` 호출 목록을 `(nu, body)` 로 정렬해 비교. 다른 것은 128 조합(스펙 ③: 옛것은 형제 포함, 새것은 자신만)뿐이어야 한다. 그 외 0건.

### Task 9: 실서버 알림 골든 — `tools/response-golden/noti-check.js`

**Files:** Create `tools/response-golden/noti-check.js`.

- [ ] **Step 1: 스크립트.** sqlite 새 DB 로 서버를 띄우고(`fcnt-check.js` 와 같은 뼈대), 로컬 HTTP 리스너(127.0.0.1:0)를 열어 받은 알림을 `{path, sur, net|sud}` 로 기록한다. 시나리오: AE(poa=[리스너/notify]) → cnt → sub1(nu=[리스너/direct], enc.net=[1,3,4]) → sub2(nu=[AE 의 ri 응답값 = ID 형], enc.net=[3], su=리스너/su) → CIN 생성(기대: direct·notify 각 1) → cnt PUT lbl(기대: direct net=1) → CIN 삭제(기대: direct net=4) → sub2 삭제(128: 옛 코드 direct+notify 2건 sud, 새 코드 notify 1건 sud) → AE 삭제. 기록은 `(path, sur, net/sud)` 정렬 후 저장. `--diff a b` 로 대조하며 128 케이스는 스펙 ③으로 허용된 차이임을 출력에 적는다.
- [ ] **Step 2: 전(워크트리 `936ecee`, node_modules 정션은 걷을 때 `cmd //c rmdir` 로 먼저 끊는다)·후(작업 트리) 실행, 대조.**
- [ ] **Step 3: 커밋** `git add tools/response-golden/noti-check.js && git commit -m "tools(golden): 알림 수신 실측 — 직접 nu · ID 형 nu · 구독 삭제"`

### Task 10: 변이 · 전체 시험 · 문서

- [ ] **Step 1: 변이** (스크래치 `mutate-sgn.js`): 원천을 `parentObj.subl` 로 되돌림 · `pi` 대신 `ri` 로 조회 · 128 을 `select_subs_by_pi` 로 · nu_resolve 의 ri 우선을 sri 우선으로 · poa 여럿 중 첫 것만 · `orderBy` 제거 · `select_resources_in` 의 미지원 타입을 빈 배열로. 각각 어느 시험이 잡는지 확인(파일 단위 실패는 무효).
- [ ] **Step 2: `npm test` 실패 0.**
- [ ] **Step 3: 문서.** 스펙 §3.2 의 "`db_bootstrap` 의 즉시 적용 대상" 을 "배포 때 `node tools/migrate.js --apply` 로 손으로(DDL 규칙)" 로 고친다. 남은 일 §5.6-1 을 "B 로 흡수 — 스펙 경로" 로 닫는다. CLAUDE.md: 모듈 표에 `sub_source.js`·`nu_resolve.js`, `sgn.js` 설명("subl 이 아니라 sub 를 읽는다"), 시험 수, 마이그레이션 013·014 손 적용 안내.
- [ ] **Step 4: 커밋·푸시.** 배포는 사용자 지시("1번") — 배포 절차: 서버 HEAD 확인 → pull → `node tools/migrate.js --check` → `--apply`(013·014) → pm2 restart → 스모크 → 알림 골든은 로컬만 → 첫 평일 관문(스펙 §3.4).
