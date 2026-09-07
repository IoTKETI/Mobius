'use strict';
// la / ol use the same query on both backends.
//
// With the (pi, ty, ct) index present on both (migrations/001, mobiusdb_sqlite.sql), no time-window workaround is needed. InnoDB appends the PK so the effective index is (pi, ty, ct, ri), and `order by ct desc, ri desc limit 1` reads one entry from the end of the index.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-laol-test.db');

function tapAdapter(rows, useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));

    const seen = [];
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, rows);
    };
    adapter.begin = function (h, cb) { cb(null); };
    adapter.commit = function (h, cb) { cb(null); };
    adapter.rollback = function (h, cb) { cb(null); };
    db.connect(function () {});

    // The legacy path (db_action / db_sqlite) no longer exists; test/db-adapter-contract.test.js checks that it does not return.

    delete require.cache[require.resolve(path.join(ROOT, 'mobius', 'sql_action.js'))];
    return { sql_action: require(path.join(ROOT, 'mobius', 'sql_action.js')), seen: seen };
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

const HIT = [{ ri: '/M/a/c/1', ty: 4, ct: '20150101T000000', con: 'old' }];

// Exactly one query.

test('la 는 시간창 없이 질의를 한 번만 던진다', function (t, done) {
    const tap = tapAdapter(HIT);

    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            assert.strictEqual(tap.seen.length, 1,
                '질의를 ' + tap.seen.length + '번 던졌다 — 시간창 재귀가 남아 있다');
            done();
        }));
});

test('결과가 없어도 재귀하지 않는다 (예전엔 10회까지 넓혔다)', function (t, done) {
    const tap = tapAdapter([]);

    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            assert.strictEqual(tap.seen.length, 1,
                '빈 결과에 재귀했다 (' + tap.seen.length + '회)');
            done();
        }));
});

test('la 질의에 ct 시간창 조건이 없다', function (t, done) {
    const tap = tapAdapter(HIT);

    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
        guard(done, function () {
            const sql = tap.seen[0].sql;
            assert.ok(!/<\s*`?ct`?/.test(sql) && !/`?ct`?\s*>/.test(sql),
                'ct 범위 조건이 남아 있다: ' + sql);
            done();
        }));
});

// Ordering and limit.

test('la 는 ct desc, ri desc 로 한 건만 고른다', function (t, done) {
    const tap = tapAdapter(HIT);

    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
        guard(done, function () {
            const sql = tap.seen[0].sql;
            assert.match(sql, /order by `ct` desc, `ri` desc/i, sql);
            assert.strictEqual(tap.seen[0].bindings[tap.seen[0].bindings.length - 1], 1,
                'limit 1 이 아니다');
            done();
        }));
});

test('ol 은 ct asc, ri asc 로 한 건만 고른다', function (t, done) {
    const tap = tapAdapter(HIT);

    tap.sql_action.select_oldest_resource(null, 4, '/M/a/c', [],
        guard(done, function () {
            const sql = tap.seen[0].sql;
            assert.match(sql, /order by `ct` asc, `ri` asc/i, sql);
            done();
        }));
});

test('la 는 부모 아래에서 자식 타입으로 거른다', function (t, done) {
    const tap = tapAdapter(HIT);

    // A ty=3 (CNT) parent has ty=4 (CIN) children.
    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
        guard(done, function () {
            const b = tap.seen[0].bindings;
            assert.ok(b.indexOf('/M/a/c') !== -1, 'pi 가 바인딩에 없다: ' + JSON.stringify(b));
            assert.ok(b.indexOf('4') !== -1, '자식 ty(4) 가 바인딩에 없다: ' + JSON.stringify(b));
            done();
        }));
});

// Both backends build the same query.

test('MySQL 과 SQLite 가 같은 la 질의를 만든다', function (t, done) {
    const my = tapAdapter(HIT, false);
    my.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
        guard(done, function () {
            const lite = tapAdapter(HIT, true);
            lite.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
                guard(done, function () {
                    assert.strictEqual(my.seen[0].sql, lite.seen[0].sql,
                        '백엔드마다 질의가 다르다:\n  MySQL : ' + my.seen[0].sql +
                        '\n  SQLite: ' + lite.seen[0].sql);
                    done();
                }));
        }));
});

test('구 경로(db_action / db_sqlite)로 새지 않는다', function (t, done) {
    const tap = tapAdapter(HIT);

    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
        guard(done, function () {
            const leaked = tap.seen.filter((s) => /^LEGACY/.test(s.sql));
            assert.deepStrictEqual(leaked, [], '구 경로로 샜다');
            done();
        }));
});

test('알 수 없는 타입이면 질의하지 않고 빈 결과로 끝낸다', function (t, done) {
    const tap = tapAdapter(HIT);
    const out = [];

    // Child type 100 of ty=99 is not in responder.typeRsrc.
    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '99' }, 0, out,
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            assert.strictEqual(tap.seen.length, 0, '없는 테이블에 질의했다');
            assert.deepStrictEqual(out, []);
            done();
        }));
});
