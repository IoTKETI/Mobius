'use strict';
// Checks that the five converted functions (get_ri_sri, select_cb, select_sum_cbs, select_sum_ae, update_cb_poa_csi) go through the facade and hand the driver the right SQL and bindings.
//
// The equivalence harness scenarios do not exercise four of the five (select_sum_* serve the statistics routes only, select_cb the mn/asn CSE types only, get_ri_sri only with an acpiList), so its 'equivalent' verdict does not prove them; the exports of sql_action.js are called directly and the SQL/bindings reaching the driver are captured, with the freshDb/tapAdapter pattern of sqli-regression.test.js copied as is.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-converted-queries-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

// The same structure as tapAdapter in sqli-regression.test.js, but the execute stub returns an array for SELECT and {affectedRows, insertId} otherwise, imitating the real driver's isRowReturning branch.
function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapterPath = path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js');
    const adapter = require(adapterPath);
    const calls = [];

    adapter.execute = function (handle, sql, bindings, callback) {
        calls.push({ sql: sql, bindings: bindings });
        if (/^\s*select\b/i.test(sql)) {
            callback(null, []);
        } else {
            callback(null, { affectedRows: 1, insertId: 0 });
        }
    };

    db.connect(function () {});

    const SA = path.join(__dirname, '..', 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    const sql_action = require(SA);

    return { sql_action: sql_action, calls: calls };
}

test('get_ri_sri 가 lookup 에서 ri 를 sri 로 조회하고 값은 bindings 로 나간다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.get_ri_sri(null, 'S1', function (err, results) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'select `ri` from `lookup` where `sri` = ?');
        assert.ok(calls[0].sql.indexOf('S1') < 0, '값이 SQL 본문에 박혔다: ' + calls[0].sql);
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('S1') >= 0, '값이 bindings 에 없다');
        assert.ok(Array.isArray(results), 'SELECT 는 배열을 돌려줘야 한다');
        done();
    });
});

// Checks that in SQLite mode the sqlite adapter really receives the calls (nothing leaks to MySQL). tapAdapter(true) stubs only the execute of mobius/db/sqlite.js, so a filled calls array is itself the proof of SQLite routing.
test('get_ri_sri 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.get_ri_sri(null, 'S1', function (err, results) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'select `ri` from `lookup` where `sri` = ?');
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('S1') >= 0, '값이 bindings 에 없다');
        assert.ok(Array.isArray(results), 'SELECT 는 배열을 돌려줘야 한다');
        done();
    });
});

test('select_cb 가 cb 를 ri 로 조회하고 값은 bindings 로 나간다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.select_cb(null, '/M/cb', function (err, results_cb) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'select * from `cb` where `ri` = ?');
        assert.ok(calls[0].sql.indexOf('/M/cb') < 0, '값이 SQL 본문에 박혔다: ' + calls[0].sql);
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('/M/cb') >= 0, '값이 bindings 에 없다');
        assert.ok(Array.isArray(results_cb), 'SELECT 는 배열을 돌려줘야 한다');
        done();
    });
});

test('select_cb 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.select_cb(null, '/M/cb', function (err, results_cb) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'select * from `cb` where `ri` = ?');
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('/M/cb') >= 0, '값이 bindings 에 없다');
        assert.ok(Array.isArray(results_cb), 'SELECT 는 배열을 돌려줘야 한다');
        done();
    });
});

test('select_sum_cbs 는 집계 컬럼 이름을 보존한 SQL 을 그대로 실행한다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.select_sum_cbs(null, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'select sum(cbs) from cnt');
        assert.deepStrictEqual(calls[0].bindings, [], '바인딩할 값이 없어야 한다');
        done();
    });
});

test('select_sum_cbs 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.select_sum_cbs(null, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'select sum(cbs) from cnt');
        assert.deepStrictEqual(calls[0].bindings, [], '바인딩할 값이 없어야 한다');
        done();
    });
});

test('select_sum_ae 는 집계 컬럼 이름을 보존한 SQL 을 그대로 실행한다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.select_sum_ae(null, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'select count(*) from ae');
        assert.deepStrictEqual(calls[0].bindings, [], '바인딩할 값이 없어야 한다');
        done();
    });
});

test('select_sum_ae 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.select_sum_ae(null, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'select count(*) from ae');
        assert.deepStrictEqual(calls[0].bindings, [], '바인딩할 값이 없어야 한다');
        done();
    });
});

test('update_cb_poa_csi 가 cb 를 poa/csi/srt 로 갱신하고 4개 값 모두 bindings 로 나간다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.update_cb_poa_csi(null, 'P', 'C', 'S', '/M/cb', function (err, results) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'update `cb` set `poa` = ?, `csi` = ?, `srt` = ? where `ri` = ?');
        ['P', 'C', 'S', '/M/cb'].forEach(function (v) {
            assert.ok(calls[0].sql.indexOf(v) < 0, '값 "' + v + '" 이 SQL 본문에 박혔다: ' + calls[0].sql);
        });
        assert.deepStrictEqual(calls[0].bindings, ['P', 'C', 'S', '/M/cb']);
        done();
    });
});

test('update_cb_poa_csi 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.update_cb_poa_csi(null, 'P', 'C', 'S', '/M/cb', function (err, results) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'update `cb` set `poa` = ?, `csi` = ?, `srt` = ? where `ri` = ?');
        assert.deepStrictEqual(calls[0].bindings, ['P', 'C', 'S', '/M/cb']);
        done();
    });
});
