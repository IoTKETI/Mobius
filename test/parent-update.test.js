'use strict';
// Captures the SQL/bindings the parent-update functions pass to the driver through the facade.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-parent-update-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

// Intercepts the adapter's execute and collects the sql/bindings that reach the driver. The real exports are called, so the whole call path is exercised.
function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapterPath = path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js');
    const adapter = require(adapterPath);
    const seen = [];

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    // A backend with transaction capability also records begin/commit.
    adapter.begin = function (h, cb) { seen.push({ sql: 'BEGIN' }); cb(null); };
    adapter.commit = function (h, cb) { seen.push({ sql: 'COMMIT' }); cb(null); };
    adapter.rollback = function (h, cb) { seen.push({ sql: 'ROLLBACK' }); cb(null); };

    db.connect(function () {});

    // The legacy path (db_action / db_sqlite) no longer exists; test/db-adapter-contract.test.js checks that it does not return.

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    const sql_action = require(path.join(__dirname, '..', 'mobius', 'sql_action.js'));
    return { sql_action: sql_action, seen: seen };
}

// Checks that no call leaked to the legacy path.
function assertNoLegacy(seen) {
    const leaked = seen.filter(function (s) { return /^LEGACY_/.test(s.sql); });
    assert.deepStrictEqual(leaked.map(function (s) { return s.legacySql; }), [],
        '구 경로(db_action/db_sqlite)로 샌 쿼리가 있다');
}

// facade.transaction catches an exception thrown from the body after settlement and only logs it (by design: there is no callback left to send it to). An assert inside the callback would therefore be swallowed and done never called. The guard forwards the exception to done(e).
function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

test('update_parent_st: SQLite 에서도 파사드를 거친다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1, 'UPDATE 는 1개여야 한다');
        assert.match(updates[0].sql, /update `lookup` set `st`/i);
        // Every value must go out as a binding; the ri must not be inlined in the SQL.
        assert.ok(updates[0].sql.indexOf('/M/c1') === -1, 'ri 가 SQL 에 인라인되면 안 된다');
        assert.ok(updates[0].bindings.indexOf('/M/c1') !== -1, 'ri 는 바인딩으로 나가야 한다');
        done();
    }));
});

test('update_parent_st: MySQL 에서도 같은 형태로 나간다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1);
        assert.match(updates[0].sql, /update `lookup` set `st`/i);
        assert.ok(updates[0].bindings.indexOf('/M/c1') !== -1);
        done();
    }));
});

test('update_parent_st: 타입 테이블 존재 조건을 유지한다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, guard(done, function () {
        const upd = seen.filter(function (s) { return /^update/i.test(s.sql); })[0];
        // The 'and cnt.ri = ?' condition raises st only when the type table has a row. Without it the st of an orphan lookup row would be raised too.
        assert.match(upd.sql, /select \* from `cnt`|exists/i,
            '타입 테이블 존재 조건이 사라졌다');
        done();
    }));
});

test('update_parent_by_delete: SQLite 에서 두 UPDATE 가 파사드로 나간다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 2, 'cnt 와 lookup 각각 1개씩이어야 한다');
        assert.match(updates[0].sql, /update `cnt` set/i);
        assert.match(updates[0].sql, /`cni`[\s\S]*`cbs`|`cbs`[\s\S]*`cni`/i);
        assert.match(updates[1].sql, /update `lookup` set `st`/i);
        // cs must be a binding.
        assert.ok(updates[0].bindings.indexOf(4) !== -1, 'cs 는 바인딩이어야 한다');
        done();
    }));
});

test('update_parent_by_delete: SQLite 는 트랜잭션 없이 본문만 돈다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, guard(done, function () {
        assert.strictEqual(seen.filter(function (s) { return s.sql === 'BEGIN'; }).length, 0,
            'SQLite 는 transaction 능력이 없다');
        done();
    }));
});

test('update_parent_by_delete: MySQL 은 BEGIN/COMMIT 으로 감싼다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.deepStrictEqual(order, ['BEGIN', 'UPDATE', 'UPDATE', 'COMMIT'],
            '두 UPDATE 가 한 트랜잭션 안에 있어야 한다');
        done();
    }));
});

test('update_acp: MySQL 에서 lookup 과 acp 가 한 트랜잭션이다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_acp({}, {
        ri: '/M/a1', lbl: [], acpi: [], at: [], aa: [],
        et: '20280101T000000', st: 1, pv: { acr: [] }, pvs: { acr: [] }
    }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.strictEqual(order[0], 'BEGIN', '트랜잭션으로 감싸야 한다');
        assert.strictEqual(order[order.length - 1], 'COMMIT');
        assert.strictEqual(order.filter(function (o) { return o === 'UPDATE'; }).length, 2);
        done();
    }));
});

test('update_sub: MySQL 에서 lookup 과 sub 가 한 트랜잭션이다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_sub({}, {
        ri: '/M/s1', lbl: [], acpi: [], at: [], aa: [],
        et: '20280101T000000', st: 1, enc: {}, nu: [], nct: 1, pn: 1, exc: 0
    }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.strictEqual(order[0], 'BEGIN');
        assert.strictEqual(order[order.length - 1], 'COMMIT');
        done();
    }));
});
