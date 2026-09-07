'use strict';
// Expired-resource listing and deletion.
//
// Not run automatically. The admin UI lists expired resources and deletes or extends only the selected ones. So (1) a read-only listing exists, (2) deletion has an upper bound, and (3) the callback fires on every path.
//
// delete_lookup_et deletes the expired resources themselves by ri.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-expiry-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

function tapAdapter(useSqlite, selectRows) {
    const db = freshDb(useSqlite);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));
    const seen = [];
    let sel = 0;

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        if (/^select/i.test(sql)) {
            const rows = selectRows[sel] === undefined ? [] : selectRows[sel];
            sel++;
            return cb(null, rows);
        }
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    adapter.begin = function (h, cb) { seen.push({ sql: 'BEGIN' }); cb(null); };
    adapter.commit = function (h, cb) { seen.push({ sql: 'COMMIT' }); cb(null); };
    adapter.rollback = function (h, cb) { seen.push({ sql: 'ROLLBACK' }); cb(null); };

    db.connect(function () {});

    // The legacy path (db_action / db_sqlite) no longer exists; test/db-adapter-contract.test.js checks that it does not return.

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    return { sql_action: require(path.join(__dirname, '..', 'mobius', 'sql_action.js')), seen: seen };
}

function assertNoLegacy(seen) {
    const leaked = seen.filter(function (s) { return /^LEGACY_/.test(s.sql); });
    assert.deepStrictEqual(leaked.map(function (s) { return s.legacySql; }), [],
        '구 경로로 샌 쿼리가 있다');
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

const ET = '20260828T000000';

// select_expired_resources (read only).

test('select_expired_resources: 파사드를 거치고 값을 바인딩한다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[{ ri: '/M/x', ty: 4, rn: 'x', pi: '/M', et: '20200101T000000' }]]);
    sql_action.select_expired_resources({}, ET, 100, guard(done, function (err, rows) {
        assert.strictEqual(err, null, '실패하면 안 된다: ' + JSON.stringify(rows));
        assertNoLegacy(seen);
        const q = seen[0];
        assert.ok(q.sql.indexOf(ET) === -1, 'et 가 SQL 에 인라인되면 안 된다');
        assert.ok(q.bindings.indexOf(ET) !== -1, 'et 는 바인딩이어야 한다');
        assert.strictEqual(rows.length, 1);
        done();
    }));
});

test('select_expired_resources: 읽기만 한다 (삭제 금지)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[]]);
    sql_action.select_expired_resources({}, ET, 100, guard(done, function () {
        const writes = seen.filter(function (s) { return /^(delete|update|insert)/i.test(s.sql); });
        assert.deepStrictEqual(writes, [], '조회 함수가 쓰기를 했다');
        done();
    }));
});

test('select_expired_resources: LIMIT 을 건다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[]]);
    sql_action.select_expired_resources({}, ET, 250, guard(done, function () {
        assert.match(seen[0].sql.toLowerCase(), /limit/, 'LIMIT 이 없다: ' + seen[0].sql);
        assert.ok(seen[0].bindings.indexOf(250) !== -1, 'limit 은 바인딩이어야 한다');
        done();
    }));
});

test('select_expired_resources: 관리자 UI 가 쓸 필드를 돌려준다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[]]);
    sql_action.select_expired_resources({}, ET, 100, guard(done, function () {
        const sql = seen[0].sql;
        ['ri', 'ty', 'rn', 'pi', 'et'].forEach(function (col) {
            assert.ok(new RegExp('`' + col + '`').test(sql), col + ' 를 안 읽는다: ' + sql);
        });
        done();
    }));
});

// --- delete_lookup_et --------------------------------------------------------

test('delete_lookup_et: 만료된 리소스 자신을 지운다 (자식이 아니라)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[
        { ri: '/M/a', ty: 23, rn: 'a', pi: '/M', et: '20200101T000000' },
        { ri: '/M/b', ty: 4, rn: 'b', pi: '/M', et: '20200101T000000' }
    ]]);
    sql_action.delete_lookup_et({}, ET, 100, guard(done, function (err, report) {
        assert.strictEqual(err, null, '실패하면 안 된다: ' + JSON.stringify(report));
        assertNoLegacy(seen);

        const del = seen.filter(function (s) { return /^delete/i.test(s.sql); });
        assert.strictEqual(del.length, 1, 'DELETE 는 배치 1개여야 한다');
        // The target column must be ri. Placing the values in the pi slot would delete the children instead.
        assert.match(del[0].sql, /delete from `lookup` where `ri` in/i,
            'ri 가 아니라 다른 컬럼으로 지운다: ' + del[0].sql);
        assert.ok(del[0].bindings.indexOf('/M/a') !== -1);
        assert.ok(del[0].bindings.indexOf('/M/b') !== -1);
        assert.strictEqual(report.deleted, 2);
        done();
    }));
});

test('delete_lookup_et: 대상이 없으면 삭제하지 않는다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[]]);
    sql_action.delete_lookup_et({}, ET, 100, guard(done, function (err, report) {
        assert.strictEqual(err, null);
        assert.deepStrictEqual(seen.filter(function (s) { return /^delete/i.test(s.sql); }), []);
        assert.strictEqual(report.deleted, 0);
        done();
    }));
});

test('delete_lookup_et: LIMIT 을 건다 (상한 없는 스윕 금지)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[]]);
    sql_action.delete_lookup_et({}, ET, 500, guard(done, function () {
        assert.match(seen[0].sql.toLowerCase(), /limit/);
        assert.ok(seen[0].bindings.indexOf(500) !== -1);
        done();
    }));
});

// The callback must fire when the lookup fails; the caller releases the connection inside the callback.
test('delete_lookup_et: 조회가 실패해도 콜백이 불린다', function (t, done) {
    const { sql_action } = tapAdapter(true, [[]]);
    const adapter = require(path.join(DB, 'sqlite.js'));
    adapter.execute = function (conn, sql, bindings, cb) {
        cb(new Error('boom'), null);
    };
    sql_action.delete_lookup_et({}, ET, 100, guard(done, function (err) {
        assert.strictEqual(err, true, '실패는 cb(true, err) 여야 한다');
        done();
    }));
});

test('delete_lookup_et: MySQL 에서도 파사드를 거친다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false, [[
        { ri: '/M/c', ty: 4, rn: 'c', pi: '/M', et: '20200101T000000' }
    ]]);
    sql_action.delete_lookup_et({}, ET, 100, guard(done, function (err, report) {
        assert.strictEqual(err, null);
        assertNoLegacy(seen);
        assert.strictEqual(report.deleted, 1);
        done();
    }));
});

// No periodic execution may be wired. Only what the admin confirms in the UI is deleted.
test('app.js 에 만료 스윕 주기 실행이 걸려 있지 않다', function () {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.strictEqual(/setInterval\s*\(\s*del_expired_resource/.test(src), false,
        'del_expired_resource 에 setInterval 이 걸려 있다');
    assert.strictEqual(/^\s*del_expired_resource\s*\(\s*\)\s*;/m.test(src), false,
        'del_expired_resource 를 기동 시 호출한다');
});
