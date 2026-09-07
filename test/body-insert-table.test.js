'use strict';
// The twenty body INSERTs became a table plus one common function. This test pins that the table uses the same tables and columns as the former SQL.
//
// A wrong column name in the table would not fail until that resource type is actually created, and these twenty types are not covered by the equivalence harness (the SQLite schema has no tables for them; MySQL only), so nobody exercises the path unless by hand.
//
// The expectations are extracted from the source of the commit before the conversion, not copied by hand; a hand copy would repeat the same mistakes.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Extracts (function -> table, columns) from sql_action.js at the pre-conversion commit (e71622a).
function legacyShapes() {
    let src;
    try {
        src = execFileSync('git', ['show', 'e71622a:mobius/sql_action.js'],
            { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
        return null;      // skipped when that commit is absent (shallow clone etc.)
    }

    const lines = src.split('\n');
    const heads = [];
    lines.forEach((l, i) => {
        const m = l.match(/^exports\.(insert_[a-zA-Z_0-9]+)\s*=\s*function/);
        if (m) heads.push({ name: m[1], start: i });
    });
    heads.forEach((h, i) => { h.end = (i + 1 < heads.length) ? heads[i + 1].start : lines.length; });

    const out = {};
    for (const h of heads) {
        const body = lines.slice(h.start, h.end).join('\n');
        const m = body.match(/insert into (\w+) \(([^)]*)\)/);
        if (!m) continue;                                   // already on the facade
        out[h.name] = {
            table: m[1],
            // Table-qualified columns such as fcnt.lock / mgo.mod / smd.or keep the column only
            cols: m[2].split(',').map((s) => s.trim().replace(/^\w+\./, ''))
        };
    }
    return out;
}

// Captures the SQL the current code produces: the adapter's execute is replaced by a recorder.
function capture(fnName, obj) {
    const DB = path.join(ROOT, 'mobius', 'db');
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(ROOT, 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    global.usedb = 'mysql';

    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    const realExecute = adapter.execute;

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    db.connect(function () {});

    const sql_action = require(path.join(ROOT, 'mobius', 'sql_action.js'));
    try {
        sql_action[fnName]({}, obj, function () {});
    } finally {
        adapter.execute = realExecute;
    }
    return seen;
}

const LEGACY = legacyShapes();

test('전환 전 커밋에서 옛 모양을 읽을 수 있다', function (t) {
    if (LEGACY === null) {
        t.skip('e71622a 를 못 읽는다 (얕은 클론?) — 대조를 건너뛴다');
        return;
    }
    assert.strictEqual(Object.keys(LEGACY).length, 20,
        '옛 소스에서 손으로 쓴 insert 를 20개 찾아야 한다: ' +
        Object.keys(LEGACY).length + '개');
});

// An obj with every column filled; with a missing value knex refuses the binding, and 'column missing' could not be told from 'value missing'.
function objFor(cols) {
    const o = { ri: '/M/x', pi: '/M', ty: '9', ct: '20260101T000000' };
    cols.forEach(function (c) { o[c] = (o[c] === undefined) ? ('v_' + c) : o[c]; });
    return o;
}

// Deliberate divergences from the former SQL, listed only where the former SQL was wrong.
//
// The rest of this file pins that the conversion did not change behaviour; for that comparison to mean anything, the exceptions must be visible as a list.
const LEGACY_DIVERGENCE = {
    // lcp.cr is NOT NULL without a default. The former code did not insert this column either, so under STRICT_TRANS_TABLES lcp creation always failed (ER_NO_DEFAULT_FOR_FIELD); an original bug, not a regression, and keeping parity would keep it. The siblings (grp, fcnt, the eight hd_*) all have cr.
    insert_lcp: { added: ['cr'] }
};

// Renamed entries: the former source name is mapped to the current export here. insert_hd_dooLK differed in case from its sibling update_hd_dooLk and was aligned to a lower-case k; table and columns are unchanged.
const LEGACY_RENAME = {
    insert_hd_dooLK: 'insert_hd_dooLk'
};

if (LEGACY) {
    for (const [name, want] of Object.entries(LEGACY)) {
        test('표가 옛 SQL 과 같다: ' + name, function () {
            const div = LEGACY_DIVERGENCE[name];
            const expect = want.cols.concat(div ? div.added : []);
            const seen = capture(LEGACY_RENAME[name] || name, objFor(expect));

            // insert_lookup goes first, the body next.
            const body = seen.filter(function (s) {
                return new RegExp('insert into `' + want.table + '`').test(s.sql);
            });
            assert.strictEqual(body.length, 1,
                name + ' 이 ' + want.table + ' 에 insert 를 한 번 내야 한다. 실제 SQL:\n  ' +
                seen.map(function (s) { return s.sql; }).join('\n  '));

            const got = (body[0].sql.match(/\(([^)]*)\) values/) || [])[1] || '';
            const cols = got.split(',').map(function (s) {
                return s.trim().replace(/`/g, '');
            });

            assert.deepStrictEqual(cols.slice().sort(), expect.slice().sort(),
                name + ' 의 컬럼이 기대와 다르다\n' +
                '  옛것: ' + want.cols.join(', ') +
                (div ? '\n  일부러 더한 것: ' + div.added.join(', ') : '') + '\n' +
                '  지금: ' + cols.join(', '));
        });
    }

    test('옛것과 갈라지는 자리는 목록에 적힌 것뿐이다', function () {
        // A stale exception list (not removed after a fix) loosens the comparison by that much.
        const stale = Object.keys(LEGACY_DIVERGENCE).filter(function (n) { return !LEGACY[n]; });
        assert.deepStrictEqual(stale, [],
            'LEGACY_DIVERGENCE 에 옛 소스에 없는 이름이 있다: ' + stale.join(', '));
    });
}

// --- UPDATE side ---

function legacyUpdateShapes() {
    let src;
    try {
        src = execFileSync('git', ['show', 'e71622a:mobius/sql_action.js'],
            { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (e) { return null; }

    const NAMES = ['update_fwr', 'update_bat', 'update_dvi', 'update_dvc', 'update_rbo',
                   'update_nod', 'update_csr', 'update_smd', 'update_mms'];
    const lines = src.split('\n');
    const heads = [];
    lines.forEach((l, i) => {
        const m = l.match(/^exports\.(update_[a-zA-Z_0-9]+)\s*=\s*function/);
        if (m) heads.push({ name: m[1], start: i });
    });
    heads.forEach((h, i) => { h.end = (i + 1 < heads.length) ? heads[i + 1].start : lines.length; });

    const out = {};
    for (const h of heads) {
        if (NAMES.indexOf(h.name) < 0) { continue; }
        const body = lines.slice(h.start, h.end).join('\n');
        const m = body.match(/update (\w+) set ([\s\S]*?) where ri = /);
        if (!m) { continue; }
        out[h.name] = {
            table: m[1],
            cols: m[2].split(',').map(function (s) {
                return s.trim().split(/\s*=/)[0].trim().replace(/^\w+\./, '');
            })
        };
    }
    return out;
}

const LEGACY_UPD = legacyUpdateShapes();

test('전환 전 커밋에서 옛 UPDATE 모양을 읽을 수 있다', function (t) {
    if (LEGACY_UPD === null) { t.skip('e71622a 를 못 읽는다'); return; }
    assert.strictEqual(Object.keys(LEGACY_UPD).length, 9,
        '옛 소스에서 손으로 쓴 update 를 9개 찾아야 한다: ' +
        Object.keys(LEGACY_UPD).length + '개');
});

if (LEGACY_UPD) {
    for (const [name, want] of Object.entries(LEGACY_UPD)) {
        test('표가 옛 UPDATE 와 같다: ' + name, function () {
            const seen = capture(name, objFor(want.cols.concat(['ri', 'lt', 'st'])));

            const body = seen.filter(function (s) {
                return new RegExp('update `' + want.table + '` set').test(s.sql);
            });
            assert.strictEqual(body.length, 1,
                name + ' 이 ' + want.table + ' 을 한 번 고쳐야 한다. 실제 SQL:\n  ' +
                seen.map(function (s) { return s.sql; }).join('\n  '));

            const setPart = (body[0].sql.match(/set ([\s\S]*?) where/) || [])[1] || '';
            const cols = setPart.split(',').map(function (s) {
                return s.trim().split(/\s*=/)[0].trim().replace(/`/g, '');
            });

            assert.deepStrictEqual(cols.slice().sort(), want.cols.slice().sort(),
                name + ' 의 set 컬럼이 옛것과 다르다\n' +
                '  옛것: ' + want.cols.join(', ') + '\n' +
                '  지금: ' + cols.join(', '));

            // where must be ri; without it the whole table is overwritten.
            assert.ok(/where `ri` = \?/.test(body[0].sql),
                name + ' 에 where ri 가 없다 — 테이블 전체가 덮인다: ' + body[0].sql);
        });
    }
}

test('본문 insert 가 실패하면 lookup 행을 되돌린다', function () {
    // An orphan lookup row breaks later discovery; a protection the former code had too.
    const DB = path.join(ROOT, 'mobius', 'db');
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(ROOT, 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    const real = adapter.execute;

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push(sql);
        // Fails only the body (grp) insert.
        if (/insert into `grp`/.test(sql)) { return cb(new Error('boom')); }
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    db.connect(function () {});
    const sql_action = require(path.join(ROOT, 'mobius', 'sql_action.js'));

    let done = false;
    sql_action.insert_grp({}, objFor(['ri', 'cr', 'mt', 'cnm', 'mnm', 'mid', 'macp', 'mtv', 'csy', 'gn']),
        function (err) {
            done = true;
            assert.ok(err, '본문 실패가 호출자에게 전달돼야 한다');
        });
    adapter.execute = real;

    assert.ok(done, '콜백이 안 불렸다');
    const rollback = seen.filter(function (s) { return /delete from `lookup`/.test(s); });
    assert.strictEqual(rollback.length, 1,
        'lookup 되돌리기가 없다 — 고아 행이 남는다. 나간 SQL:\n  ' + seen.join('\n  '));
});

// lcp's loi/lost are in create_np_attr_list, so a client cannot send them, and build_lcp does not fill them; they are always undefined. The builder sends undefined as NULL and those columns are NOT NULL, so the insert failed as a whole (the former util.format('%s') stored the string "undefined" and succeeded). The SQL-shape tests above cannot catch it: the columns are right and the values are wrong.
test('안 채운 속성이 있어도 insert 가 나간다 (NOT NULL 컬럼)', function () {
    // loi / lost are left out on purpose.
    const seen = capture('insert_lcp', {
        ri: '/M/lcp1', pi: '/M', ty: '10', ct: '20260101T000000',
        los: '1', lou: 'u', lot: '1', lor: 'r', lon: 'n'
    });
    const body = seen.filter(function (s) { return /insert into `lcp`/.test(s.sql); })[0];
    assert.ok(body, 'lcp insert 가 안 나갔다');

    assert.strictEqual(body.bindings.indexOf(undefined), -1,
        'undefined 가 바인딩에 들어갔다 — NOT NULL 컬럼에서 실패한다: ' +
        JSON.stringify(body.bindings));
    assert.strictEqual(body.bindings.indexOf(null), -1,
        'null 이 바인딩에 들어갔다 — NOT NULL 컬럼에서 실패한다: ' +
        JSON.stringify(body.bindings));
});

test('UPDATE 도 안 채운 속성을 NULL 로 보내지 않는다', function () {
    const seen = capture('update_csr', {
        ri: '/M/csr1', lt: '20260101T000000', st: 1,
        poa: ['http://a']            // mei/tri/rr/nl left out
    });
    const body = seen.filter(function (s) { return /update `csr` set/.test(s.sql); })[0];
    assert.ok(body, 'csr update 가 안 나갔다');
    assert.strictEqual(body.bindings.indexOf(undefined), -1,
        'undefined 가 바인딩에 들어갔다: ' + JSON.stringify(body.bindings));
    assert.strictEqual(body.bindings.indexOf(null), -1,
        'null 이 바인딩에 들어갔다: ' + JSON.stringify(body.bindings));
});

test('JSON 컬럼은 문자열로 바인딩된다', function () {
    const seen = capture('insert_csr', {
        ri: '/M/csr1', pi: '/M', ty: '16', ct: '20260101T000000',
        cst: '1', poa: ['http://a'], cb: '/M', csi: '/x', mei: '', tri: '',
        rr: 'true', nl: '', srv: ['2a']
    });
    const body = seen.filter(function (s) { return /insert into `csr`/.test(s.sql); })[0];
    assert.ok(body, 'csr insert 가 없다');
    assert.ok(body.bindings.indexOf('["http://a"]') >= 0,
        'poa 가 JSON 문자열로 안 들어갔다: ' + JSON.stringify(body.bindings));
    assert.ok(body.bindings.indexOf('["2a"]') >= 0,
        'srv 가 JSON 문자열로 안 들어갔다: ' + JSON.stringify(body.bindings));
});

test('값은 바인딩으로 나간다 — SQL 문자열에 인라인되지 않는다', function () {
    // The former code put values into the SQL and escaped every JSON column by hand; one missing escape is an injection.
    const evil = "x' or '1'='1";
    const seen = capture('insert_nod', {
        ri: '/M/n1', pi: '/M', ty: '14', ct: '20260101T000000',
        ni: evil, hcl: '', mgca: ''
    });
    const body = seen.filter(function (s) { return /insert into `nod`/.test(s.sql); })[0];
    assert.ok(body, 'nod insert 가 없다');
    assert.strictEqual(body.sql.indexOf(evil), -1,
        '값이 SQL 문자열에 들어갔다: ' + body.sql);
    assert.ok(body.bindings.indexOf(evil) >= 0, '값이 바인딩에 없다');
});

// --- Caller signatures ---
//
// Every builder generated from the table takes (connection, obj, callback). The former code took one positional argument per column, and the callers were changed with the table.
//
// A caller left in the old shape passes the lt string as obj and the acpi JSON as callback; the resulting TypeError is thrown inside update_lookup's callback, which is asynchronous with a real DB, so the worker dies.
//
// The names are not listed by hand; they are taken from the table in the source so a new builder is checked as well.
function generatedBuilderNames() {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const out = [];
    for (const t of ['BODY_UPDATES', 'BODY_TABLES']) {
        const m = src.match(new RegExp('var ' + t + ' = \\{([\\s\\S]*?)\\n\\};'));
        if (!m) { continue; }
        const re = /^\s{4}(\w+):/gm;
        let x;
        while ((x = re.exec(m[1])) !== null) { out.push(x[1]); }
    }
    return out;
}

// Counts bracket pairs to cut out one whole call; a regex cannot count nesting, and the arguments contain calls such as JSON.stringify(...).
function sliceCall(src, from) {
    const open = src.indexOf('(', from);
    let depth = 0, i = open;
    for (; i < src.length; i++) {
        if (src[i] === '(') { depth++; }
        else if (src[i] === ')') { depth--; if (depth === 0) { break; } }
    }
    return src.slice(open + 1, i);
}

// Counts top-level commas only; commas inside strings and nested brackets are excluded.
function countArgs(s) {
    let depth = 0, n = 1, inStr = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (c === '\\') { i++; } else if (c === inStr) { inStr = null; } continue; }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if ('([{'.indexOf(c) >= 0) { depth++; }
        else if (')]}'.indexOf(c) >= 0) { depth--; }
        else if (c === ',' && depth === 0) { n++; }
    }
    return n;
}

test('표에서 만들어지는 빌더의 호출부는 전부 3인자다', function () {
    const names = generatedBuilderNames();
    assert.ok(names.length >= 20,
        '빌더를 ' + names.length + '개만 찾았다 — 표를 읽는 정규식이 낡았을 수 있다');

    const FILES = ['mobius/resource.js', 'app.js', 'mobius/ae.js', 'mobius/cb.js',
                   'mobius/grp.js', 'mobius/sgn.js'];
    const bad = [];
    let calls = 0;

    for (const f of FILES) {
        const p = path.join(ROOT, f);
        if (!fs.existsSync(p)) { continue; }
        const src = fs.readFileSync(p, 'utf8');
        for (const name of names) {
            const re = new RegExp('db_sql\\.' + name + '\\s*\\(', 'g');
            let m;
            while ((m = re.exec(src)) !== null) {
                calls++;
                const n = countArgs(sliceCall(src, m.index));
                if (n !== 3) {
                    const line = src.slice(0, m.index).split('\n').length;
                    bad.push(f + ':' + line + ' ' + name + ' 이 인자 ' + n + '개');
                }
            }
        }
    }

    // Table dispatch: the eight insert_hd_* are called at one place as db_sql[HD_INSERT[hd]](...). The regex above does not see that place, so it is counted separately; the three-argument protection of the eight builders must not disappear silently.
    const rsrc = fs.readFileSync(path.join(ROOT, 'mobius/resource.js'), 'utf8');
    const DISPATCH = 'db_sql[HD_INSERT[hd]](';
    const at = rsrc.indexOf(DISPATCH);
    assert.ok(at > 0, 'insert_hd_* 표 디스패치 자리를 못 찾았다 — 이 검사의 전제가 바뀌었다');
    assert.strictEqual(rsrc.indexOf(DISPATCH, at + 1), -1, '표 디스패치 자리는 하나여야 한다');
    {
        let depth = 0, n = 1;
        for (let i = at + DISPATCH.length - 1; i < rsrc.length; i++) {
            const ch = rsrc[i];
            if ('([{'.indexOf(ch) >= 0) { depth++; }
            else if (')]}'.indexOf(ch) >= 0) { depth--; if (depth === 0) { break; } }
            else if (ch === ',' && depth === 1) { n++; }
        }
        calls++;
        if (n !== 3) {
            bad.push('mobius/resource.js:' + rsrc.slice(0, at).split('\n').length + ' db_sql[HD_INSERT[hd]] 이 인자 ' + n + '개');
        }
    }

    assert.ok(calls > 0, '호출부를 하나도 못 찾았다 — 검사가 헛돈다');
    assert.deepStrictEqual(bad, [],
        '표에서 만들어지는 빌더는 (connection, obj, callback) 3인자다. ' +
        '옛 위치인자로 부르면 callback 자리에 문자열이 들어가고, ' +
        '그 TypeError 가 비동기 콜백 안에서 나 **워커가 죽는다**:\n  ' + bad.join('\n  '));
});

// --- Missing NOT NULL columns ---
//
// An insert builder that does not fill a NOT NULL column of its table makes creation of that type fail every time under STRICT_TRANS_TABLES (ER_NO_DEFAULT_FOR_FIELD).
//
// Both the table and the schema are read from the source; hand-written lists drift.
function bodyTableEntries() {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const m = src.match(/var BODY_TABLES = \{([\s\S]*?)\n\};/);
    assert.ok(m, 'BODY_TABLES 를 못 찾았다 — 정규식이 낡았다');
    const out = [];
    const re = /^\s{4}(\w+):\s*\[\s*'([^']+)',\s*'([^']*)'/gm;
    let x;
    while ((x = re.exec(m[1])) !== null) {
        out.push({ name: x[1], table: x[2], cols: x[3].split(/\s+/).filter(Boolean) });
    }
    return out;
}

// Columns that must be filled: NOT NULL without a default. DEFAULT / AUTO_INCREMENT / generated columns are filled by the DB.
function mustFillCols(schema, table) {
    const t = schema.match(new RegExp('CREATE TABLE `' + table + '` \\(([\\s\\S]*?)\\n\\) ENGINE'));
    if (!t) { return null; }
    const out = [];
    const re = /^\s+`(\w+)`\s+([^,\n]*)/gm;
    let y;
    while ((y = re.exec(t[1])) !== null) {
        const decl = y[2];
        if (!/NOT NULL/i.test(decl)) { continue; }
        if (/DEFAULT/i.test(decl)) { continue; }
        if (/AUTO_INCREMENT/i.test(decl)) { continue; }
        if (/GENERATED ALWAYS/i.test(decl)) { continue; }
        out.push(y[1]);
    }
    return out;
}

test('insert 빌더는 NOT NULL 컬럼을 전부 채운다', function () {
    const schema = fs.readFileSync(require('../mobius/db/mysql').schemaPath, 'utf8');
    const entries = bodyTableEntries();
    assert.ok(entries.length >= 15,
        '빌더를 ' + entries.length + '개만 찾았다 — 표를 읽는 정규식이 낡았다');

    const bad = [];
    let checked = 0;
    for (const e of entries) {
        const need = mustFillCols(schema, e.table);
        assert.ok(need !== null, e.name + ': 스키마에서 테이블 ' + e.table + ' 을 못 찾았다');
        assert.ok(need.length > 0, e.name + ': ' + e.table + ' 에 NOT NULL 컬럼이 하나도 없다 — 파서가 헛돈다');
        checked++;
        const missing = need.filter((c) => e.cols.indexOf(c) < 0);
        if (missing.length) { bad.push(e.name + ' (' + e.table + '): ' + missing.join(' ')); }
    }

    assert.ok(checked === entries.length, '검사 못 한 빌더가 있다');
    assert.deepStrictEqual(bad, [],
        'NOT NULL 인데 기본값이 없는 컬럼을 빌더가 안 채운다. ' +
        'STRICT_TRANS_TABLES 에서 그 타입의 생성이 **언제나** 실패한다:\n  ' + bad.join('\n  '));
});

test('cr 은 본문이 아니라 요청 Origin 에서 온다', function () {
    // cr is the value creator_bypasses in security.js uses to grant access. Taking it from the body would let anyone create a resource under another's name and forge permissions.
    //
    // The convention is pinned together with the new cr in lcp.
    const FILES = ['cnt.js', 'grp.js', 'lcp.js'];
    for (const f of FILES) {
        const src = fs.readFileSync(path.join(ROOT, 'mobius', f), 'utf8')
            // A comment must not satisfy the check.
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        assert.match(src, /\.cr = request\.headers\['x-m2m-origin'\]/,
            'mobius/' + f + ' 가 cr 을 요청 Origin 에서 안 가져온다');
        assert.ok(!/\.cr = body_Obj/.test(src),
            'mobius/' + f + ' 가 cr 을 본문에서 받는다 — 권한 위조가 된다');
    }
});
