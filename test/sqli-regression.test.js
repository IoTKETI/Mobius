'use strict';
// Converted functions pass values as bindings. With string interpolation a quote breaks the SQL structure; as a binding it remains a value.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-sqli-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

// A quote inside an ACP policy must not break the SQL structure.
const EVIL = '{"acr":[{"acor":["a\'); drop table acp; --"],"acop":63}]}';

test('update_acp 의 pv 는 바인딩으로 나간다 (MySQL)', function () {
    const db = freshDb(false);
    db.connect(function () {});
    const n = db.k('acp').update({ pv: EVIL, pvs: '{}' }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0, 'SQL 본문에 값이 박히면 안 된다');
    assert.ok(n.bindings.indexOf(EVIL) >= 0, '값은 바인딩으로 가야 한다');
});

test('update_acp 의 pv 는 바인딩으로 나간다 (SQLite)', function () {
    const db = freshDb(true);
    db.connect(function () {});
    const n = db.k('acp').update({ pv: EVIL, pvs: '{}' }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0);
    assert.ok(n.bindings.indexOf(EVIL) >= 0);
});

test('update_lookup 의 acpi/at/aa 이 바인딩으로 나간다', function () {
    const db = freshDb(false);
    db.connect(function () {});
    const n = db.k('lookup').update({
        lt: '20260826T000000', acpi: EVIL, et: '20280826T000000', st: 1,
        lbl: '[]', at: '[]', aa: '[]'    }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0);
    assert.ok(n.bindings.indexOf(EVIL) >= 0);
});

// The tests above only prove that the facade binds. Whether the converted functions use the facade that way is a separate question: a util.format reintroduced in sql_action.js would still pass them. So the real exports are called and what reaches the driver is inspected.
function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapterPath = path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js');
    const adapter = require(adapterPath);
    const calls = [];

    adapter.execute = function (handle, sql, bindings, callback) {
        calls.push({ sql: sql, bindings: bindings });
        callback(null, { affectedRows: 1, insertId: 0 });
    };

    // update_acp / update_sub run inside db.transaction(). The MySQL adapter's begin/commit call methods on the real handle, and this test passes null as the connection, so stubs are needed (in production request.db_connection is passed).
    adapter.begin = function (handle, callback) { callback(null); };
    adapter.commit = function (handle, callback) { callback(null); };
    adapter.rollback = function (handle, callback) { callback(null); };

    db.connect(function () {});

    // Evicted from the cache and reloaded so sql_action reuses the facade.
    const SA = path.join(__dirname, '..', 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    const sql_action = require(SA);

    return { sql_action: sql_action, calls: calls };
}

// obj mimics the shape update_acp actually receives.
function acpObj(evil) {
    return {
        ri: '/Mobius/acp1', lt: '20260826T000000', et: '20280826T000000', st: 1,
        acpi: [], lbl: [], at: [], aa: [],
        pv: { acr: [{ acor: [evil], acop: 63 }] },
        pvs: { acr: [{ acor: ['S'], acop: 63 }] }
    };
}

test('exports.update_acp 이 드라이버에 값을 바인딩으로 넘긴다 (SQLite)', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.update_acp(null, acpObj("a'); drop table acp; --"), function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.ok(calls.length >= 2, 'lookup 과 acp 두 번 실행되어야 한다, 실제: ' + calls.length);
        calls.forEach(function (c, i) {
            assert.ok(c.sql.indexOf('drop table') < 0,
                i + '번째 SQL 본문에 값이 박혔다: ' + c.sql);
        });
        const bound = calls.map(function (c) { return JSON.stringify(c.bindings); }).join(' ');
        assert.ok(bound.indexOf('drop table') >= 0, '값이 바인딩으로 가야 한다');
        done();
    });
});

test('exports.update_acp 이 드라이버에 값을 바인딩으로 넘긴다 (MySQL)', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.update_acp(null, acpObj("b'); drop table acp; --"), function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        calls.forEach(function (c, i) {
            assert.ok(c.sql.indexOf('drop table') < 0,
                i + '번째 SQL 본문에 값이 박혔다: ' + c.sql);
        });
        const bound = calls.map(function (c) { return JSON.stringify(c.bindings); }).join(' ');
        assert.ok(bound.indexOf('drop table') >= 0);
        done();
    });
});

test('exports.update_lookup 이 acpi/at/aa 을 바인딩으로 넘긴다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    const evil = "c'); drop table lookup; --";
    sql_action.update_lookup(null, {
        ri: '/Mobius/x', lt: '20260826T000000', et: '20280826T000000', st: 1,
        acpi: [evil], lbl: [], at: [evil], aa: [evil]    }, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1);
        assert.ok(calls[0].sql.indexOf('drop table') < 0, 'SQL 본문에 값이 박혔다: ' + calls[0].sql);
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('drop table') >= 0);
        done();
    });
});

// obj mimics the shape update_sub actually receives.
function subObj(evil) {
    return {
        ri: '/Mobius/sub1', lt: '20260826T000000', et: '20280826T000000', st: 1,
        acpi: [], lbl: [], at: [], aa: [],
        enc: { net: [1] }, exc: 10, nu: [evil], gpi: 'g1', nfu: 'nfu1',
        bn: 1, rl: 1, pn: 1, nsp: 1, ln: 1, nct: 2, nec: 1
    };
}

// The sub body UPDATE must reach the SQLite driver in SQLite mode (it used to go to the MySQL driver unconditionally and was silently lost), with the values as bindings.
test('exports.update_sub 이 드라이버에 값을 바인딩으로 넘긴다 (SQLite)', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.update_sub(null, subObj("d'); drop table sub; --"), function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.ok(calls.length >= 2, 'lookup 과 sub 두 번 실행되어야 한다, 실제: ' + calls.length);
        calls.forEach(function (c, i) {
            assert.ok(c.sql.indexOf('drop table') < 0,
                i + '번째 SQL 본문에 값이 박혔다: ' + c.sql);
        });
        const bound = calls.map(function (c) { return JSON.stringify(c.bindings); }).join(' ');
        assert.ok(bound.indexOf('drop table') >= 0, '값이 바인딩으로 가야 한다');
        done();
    });
});

// update_hd_*: the WHERE clause was missing entirely in all eight:
//
//     util.format('update fcnt set fcnt.lock = \'%s\'', obj.lock)
//                                                     ^ no where
//
// A PUT to one door lock changed every row of the fcnt table. The value was also assembled without escaping, so it was an injection surface as well. Facade bindings remove both.

test('fcnt 갱신은 ri 로 대상을 한정한다', function () {
    const db = freshDb(false);
    db.connect(function () {});
    const n = db.k('fcnt').update({ lock: 'true' }).where({ ri: '/M/x/d' }).toSQL().toNative();
    assert.ok(/where/i.test(n.sql), 'where 절이 없으면 테이블 전체가 바뀐다: ' + n.sql);
    assert.ok(n.bindings.indexOf('/M/x/d') >= 0, 'ri 가 바인딩으로 가야 한다');
});

test('예약어 lock 도 빌더가 인용한다', function () {
    // The builder quotes per dialect, so only the column name is passed (the fcnt.lock table prefix is no longer needed).
    for (const sqlite of [false, true]) {
        const db = freshDb(sqlite);
        db.connect(function () {});
        const n = db.k('fcnt').update({ lock: 'x' }).where({ ri: '/r' }).toSQL().toNative();
        assert.ok(/["`]lock["`]/.test(n.sql),
            (sqlite ? 'SQLite' : 'MySQL') + ': lock 이 인용되지 않았다 — ' + n.sql);
    }
});

// Parent counter update.

// Extracts the function body only. Comments are excluded; they quote old forms (usesqlite, FOR UPDATE ...) while explaining the change.
function bodyOf(name) {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');
    const at = src.indexOf(name);
    assert.ok(at > 0, name + ' 을 못 찾았다');
    let end = src.indexOf('\nexports.', at + name.length);
    if (end < 0) { end = src.length; }
    return src.slice(at, end).split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

test('카운터 갱신이 pi 를 문자열로 박지 않는다', function () {
    // pi is the target container's ri, which is derived from the client-supplied rn (build_resource in resource.js). A container whose rn contains a quote, followed by a cin under it, made the counter update a second-order injection when the ri was inlined into the SQL.
    const body = bodyOf('exports.update_parent_counters');

    assert.ok(!/util\.format/.test(body), '카운터 갱신에 util.format 이 남아 있다');
    assert.ok(!/%s/.test(body), '카운터 갱신에 %s 문자열 결합이 남아 있다');
    assert.ok(/facade\.k\('cnt'\)/.test(body), '빌더를 쓰지 않는다');
});

test('카운터 갱신에 백엔드 분기가 없다', function () {
    // The whereExists guard expresses the same meaning backend-neutrally (formerly a MySQL multi-table UPDATE versus two SQLite statements); update_parent_st already runs in that form.
    const body = bodyOf('exports.update_parent_counters');

    assert.ok(!/usesqlite/.test(body), '카운터 갱신에 usesqlite 분기가 있다');
    assert.ok(/whereExists/.test(body),
        'cnt 행이 있을 때만 st 를 올리는 가드가 없다 — 고아 lookup 의 st 가 오른다');
});

test('카운터 갱신이 NaN 을 걸러낸다', function () {
    // cs is passed by resource.js through parseInt and is NaN when absent. Binding NaN violates NOT NULL and fails the whole update for that container.
    const body = bodyOf('exports.update_parent_counters');
    assert.ok(/isFinite\(cs\)/.test(body), 'cs 를 수로 검사하지 않는다');
});

test('delete_oldest 가 빌더로 나가고 분기가 없다', function () {
    // With the master as the only cleaner, no transaction or row lock is needed, and there is no reason to branch by backend.
    const body = bodyOf('function delete_oldest');

    assert.ok(!/usesqlite/.test(body), 'delete_oldest 에 usesqlite 분기가 남아 있다');
    assert.ok(!/util\.format/.test(body), 'delete_oldest 에 문자열 조립이 남아 있다');
    assert.ok(!/beginTransaction|FOR UPDATE/i.test(body),
        '정리 주체가 하나인데 트랜잭션·행잠금이 남아 있다');
    assert.ok(/whereIn\('ri', del_ri\)/.test(body),
        '센 집합을 그대로 지우지 않는다 — 고른 것과 지운 것이 갈리면 카운터가 틀어진다');
});

test('sql_action 에 WHERE 없는 update 가 없다', function () {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');

    // Finds string-assembled update statements without a where.
    const bad = [];
    const lines = src.split(/\r?\n/);
    lines.forEach(function (l, i) {
        const m = l.match(/'(update\s+\w+\s+set\s[^']*)'/i);
        if (m && !/where/i.test(m[1])) {
            // Statements may be concatenated over several lines, so the next two lines are included.
            const around = lines.slice(i, i + 3).join(' ');
            if (!/where/i.test(around)) { bad.push((i + 1) + ': ' + l.trim().slice(0, 80)); }
        }
    });
    assert.deepStrictEqual(bad, [],
        'WHERE 없는 update 가 남아 있다 — 테이블 전체를 덮어쓴다:\n  ' + bad.join('\n  '));
});
