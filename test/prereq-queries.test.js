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
