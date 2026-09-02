'use strict';
// la / ol 은 양쪽 백엔드가 같은 질의를 쓴다.
//
// 예전 MySQL 갈래는 5^n 분짜리 시간창을 넓혀 가며 최대 10회 재귀했다.
// (pi, ty, ct) 복합 인덱스가 없어 그냥 정렬하면 ct 인덱스를 역스캔했기
// 때문이다. 그래서 **가장 최근 CIN 이 약 3.7년(5^9분)보다 오래된 컨테이너는
// la 가 아예 응답하지 못했다.**
//
// 로컬 MySQL 실측 (2026-08-29, ct 를 2015년으로 옮긴 컨테이너):
//   예전 코드 -> lookup 질의 10회, HTTP 404 "resource does not exist"
//   신규 코드 -> lookup 질의  1회, HTTP 200 con=old-data
//
// 이제 인덱스가 양쪽에 있어(migrations/001, mobiusdb_sqlite.sql) 우회가
// 필요 없다. InnoDB 가 PK 를 뒤에 붙여 실제 구성이 (pi, ty, ct, ri) 이므로
// `order by ct desc, ri desc limit 1` 이 인덱스 끝에서 한 항목만 읽는다.
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

    // 구 경로(db_action / db_sqlite)의 getResult 를 가로채 "그쪽으로 샜는가"
    // 를 보던 자리다. 두 파일을 지웠으므로(2026-09-01) 샐 곳이 없다.
    // 되살아나지 않았는지는 test/db-adapter-contract.test.js 가 본다.

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

// --- 질의는 한 번뿐이다 -------------------------------------------------------

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

// --- 정렬과 상한 -------------------------------------------------------------

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

    // 부모가 ty=3(CNT) 이면 자식은 ty=4(CIN) 다.
    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '3' }, 0, [],
        guard(done, function () {
            const b = tap.seen[0].bindings;
            assert.ok(b.indexOf('/M/a/c') !== -1, 'pi 가 바인딩에 없다: ' + JSON.stringify(b));
            assert.ok(b.indexOf('4') !== -1, '자식 ty(4) 가 바인딩에 없다: ' + JSON.stringify(b));
            done();
        }));
});

// --- 양쪽 백엔드가 같은 질의를 쓴다 ------------------------------------------

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

    // ty=99 의 자식 타입 100 은 responder.typeRsrc 에 없다.
    tap.sql_action.select_latest_resource(null, { ri: '/M/a/c', ty: '99' }, 0, out,
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            assert.strictEqual(tap.seen.length, 0, '없는 테이블에 질의했다');
            assert.deepStrictEqual(out, []);
            done();
        }));
});
