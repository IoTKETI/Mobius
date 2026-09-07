/**
 * get_ri_list_sri: one whereIn instead of one sequential query per element.
 *
 * Semantics are unchanged: ri when found, the original value otherwise. The function is used by fopt (mid) and by resource's acpi validation; the tests below are the contract of those two call sites.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// app.js opens ports on require. The function body is cut out of the source and run with a replaced db_sql.
function load_get_ri_list_sri(stub) {
    // Repository files may be CRLF; line endings are normalised before slicing.
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('global.get_ri_list_sri = function');
    assert.ok(start > 0, 'get_ri_list_sri 정의를 못 찾았다');
    const end = src.indexOf('\n};\n', start) + 4;
    const body = src.slice(start, end).replace('global.get_ri_list_sri = ', 'return ');
    // eslint-disable-next-line no-new-func
    return new Function('db_sql', 'console', body)(stub, { log: function () { stub.logs.push(Array.prototype.join.call(arguments, ' ')); } });
}
function stubDb(rows, err) {
    const s = { calls: [], logs: [] };
    s.get_ri_sri_in = function (conn, list, cb) { s.calls.push(list.slice()); setImmediate(function () { cb(err || null, err ? null : rows); }); };
    s.get_ri_sri = function () { throw new Error('원소마다 부르는 옛 경로를 타면 안 된다'); };
    return s;
}
const req = { db_connection: {}, method: 'GET', url: '/x' };

test('빈 목록은 질의 없이 200', (t, done) => {
    const stub = stubDb([]);
    const fn = load_get_ri_list_sri(stub);
    const out = [];
    fn(req, {}, [], out, 0, function (code) {
        assert.strictEqual(code, '200'); assert.deepStrictEqual(out, []); assert.strictEqual(stub.calls.length, 0); done();
    });
});

test('한 질의로, 있으면 ri 없으면 원값 — 순서·개수 보존', (t, done) => {
    const stub = stubDb([{ ri: '/Mobius/acp1', sri: 'S1' }, { ri: '/Mobius/acp3', sri: 'S3' }]);
    const fn = load_get_ri_list_sri(stub);
    const out = [];
    fn(req, {}, ['S1', '/Mobius/already', 'S3', 'S9'], out, 0, function (code) {
        assert.strictEqual(code, '200');
        assert.deepStrictEqual(out, ['/Mobius/acp1', '/Mobius/already', '/Mobius/acp3', 'S9']);
        assert.strictEqual(stub.calls.length, 1, '질의는 한 번');
        assert.deepStrictEqual(stub.calls[0], ['S1', '/Mobius/already', 'S3', 'S9']);
        assert.strictEqual(stub.logs.length, 1, '치환이 일어나면 로그 한 줄');
        assert.ok(/2\/4/.test(stub.logs[0]), stub.logs[0]);
        done();
    });
});

test('치환이 없으면 로그도 없다 (정상 사용 — 저장된 acpi 는 이미 ri)', (t, done) => {
    const stub = stubDb([]);
    const fn = load_get_ri_list_sri(stub);
    const out = [];
    fn(req, {}, ['/Mobius/a', '/Mobius/b'], out, 0, function (code) {
        assert.strictEqual(code, '200'); assert.deepStrictEqual(out, ['/Mobius/a', '/Mobius/b']); assert.strictEqual(stub.logs.length, 0); done();
    });
});

test('count 오프셋은 옛 계약대로 그 자리부터 채운다', (t, done) => {
    const stub = stubDb([{ ri: '/r/S2', sri: 'S2' }]);
    const fn = load_get_ri_list_sri(stub);
    const out = ['keep'];
    fn(req, {}, ['S1', 'S2'], out, 1, function (code) {
        assert.strictEqual(code, '200'); assert.deepStrictEqual(out, ['keep', '/r/S2']); assert.deepStrictEqual(stub.calls[0], ['S2']); done();
    });
});

test('같은 sri 행이 둘이면 먼저 온 것, 프로토타입 키는 안 섞인다', (t, done) => {
    const stub = stubDb([{ ri: '/first', sri: 'S1' }, { ri: '/second', sri: 'S1' }]);
    const fn = load_get_ri_list_sri(stub);
    const out = [];
    fn(req, {}, ['S1', 'toString', '__proto__'], out, 0, function (code) {
        assert.strictEqual(code, '200'); assert.deepStrictEqual(out, ['/first', 'toString', '__proto__']); done();
    });
});

test('DB 오류는 500-1 (옛 계약)', (t, done) => {
    const stub = stubDb(null, new Error('boom'));
    const fn = load_get_ri_list_sri(stub);
    fn(req, {}, ['S1'], [], 0, function (code) { assert.strictEqual(code, '500-1'); done(); });
});

// Inspects the SQL shape the same way as converted-queries' tapAdapter.
test('get_ri_sri_in 은 lookup 에서 (ri, sri) 를 whereIn 으로 한 번에 읽는다', (t, done) => {
    const DB = path.join(ROOT, 'mobius', 'db');
    process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-ri-sri-batch-test.db');
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const calls = [];
    adapter.execute = function (handle, sql, bindings, callback) { calls.push({ sql: sql, bindings: bindings }); callback(null, []); };
    db.connect(function () {});
    const SA = path.join(ROOT, 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    const sql_action = require(SA);
    sql_action.get_ri_sri_in(null, ['S1', 'S2'], function (err, rows) {
        assert.ok(!err);
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].sql, 'select `ri`, `sri` from `lookup` where `sri` in (?, ?)');
        assert.deepStrictEqual(calls[0].bindings, ['S1', 'S2']);
        assert.ok(Array.isArray(rows));
        done();
    });
});
