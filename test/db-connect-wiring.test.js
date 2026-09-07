'use strict';
// connect() wiring. The adapter owns the DB coordinates and reads the password from conf, so broken wiring is invisible at the call site; a server running that way connects with an empty password.
//
// Source scanning alone is insufficient: `db.applyConf({})` and `foo.applyConf(conf)` both pass an order check while producing exactly that state. The core of this file therefore inspects the values that actually reach the driver; the source scan remains as a backstop for the case where the wiring code is missing entirely.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

// Intercepts the driver's createPool and captures the configuration the adapter actually built. The adapter source is not read; only the delivered values are checked.
//
// The intercepted module must be the same one the adapter loads. Changing the driver requires changing this constant.
const DRIVER = 'mysql2';

function capturePool(fn) {
    const mysql = require(DRIVER);
    const orig = mysql.createPool;
    let captured = null;
    mysql.createPool = function (cfg) { captured = cfg; return { fake: true }; };
    try { fn(); } finally { mysql.createPool = orig; }
    return captured;
}

function freshAdapter() {
    const p = require.resolve('../mobius/db/mysql');
    delete require.cache[p];
    return require(p);
}

test('applyConf 가 준 dbpass 가 드라이버까지 도착한다', function () {
    const a = freshAdapter();
    a.applyConf({ dbpass: 'p@ss word!' });

    const cfg = capturePool(function () { a.connect(function () {}); });

    assert.ok(cfg, 'createPool 이 안 불렸다');
    assert.strictEqual(cfg.password, 'p@ss word!',
        'conf.dbpass 가 드라이버까지 안 갔다 — 빈 비밀번호로 붙는다');
});

test('좌표는 어댑터가 갖는다 — 코어가 안 넘겨도 채워진다', function () {
    const a = freshAdapter();
    a.applyConf({});

    const cfg = capturePool(function () { a.connect(function () {}); });

    // The values must be exactly the defaults the deployment relies on.
    assert.strictEqual(cfg.host, 'localhost');
    assert.strictEqual(cfg.port, 3306);
    assert.strictEqual(cfg.user, 'root');
    assert.strictEqual(cfg.database, 'mobiusdb');
});

test('dbpass 가 없으면 빈 문자열이다 — undefined 를 넘기지 않는다', function () {
    const a = freshAdapter();
    a.applyConf({});
    const cfg = capturePool(function () { a.connect(function () {}); });
    assert.strictEqual(cfg.password, '');
});

test('applyConf 를 아예 안 부르면 빈 비밀번호가 된다 — 그래서 순서가 중요하다', function () {
    // Documents the failure: shows what happens when the wiring is missing, which is why the ordering checks below exist.
    const a = freshAdapter();   // applyConf not called
    const cfg = capturePool(function () { a.connect(function () {}); });
    assert.strictEqual(cfg.password, '',
        '배선이 끊어졌을 때의 증상이 바뀌었다 — 아래 순서 검사의 전제가 달라진다');
});

test('풀 크기와 대기열이 드라이버까지 도착한다', function () {
    const a = freshAdapter();
    a.applyConf({});
    const before = [global.use_db_connection_limit, global.use_db_queue_limit];
    global.use_db_connection_limit = 7;
    global.use_db_queue_limit = 9;
    try {
        const cfg = capturePool(function () { a.connect(function () {}); });
        assert.strictEqual(cfg.connectionLimit, 7);
        assert.strictEqual(cfg.queueLimit, 9);
    } finally {
        global.use_db_connection_limit = before[0];
        global.use_db_queue_limit = before[1];
    }
});

test('파사드 connect 는 콜백 하나만 받는다 — 옛 5인자 호출을 이름 붙여 막는다', function () {
    delete require.cache[require.resolve('../mobius/db')];
    const db = require('../mobius/db');
    assert.throws(function () { db.connect('localhost', 3306, 'root', 'pw', function () {}); },
        /connect\(callback\)/,
        '옛 시그니처가 조용히 통과했다 — 첫 인자를 콜백으로 부르게 된다');
    delete require.cache[require.resolve('../mobius/db')];
});

// Backstop: catches the case where the wiring code is missing entirely.
//
// The tests above call the adapter directly. Tool files have no require.main guard and connect to the DB as soon as they are required (backfill does), so they cannot be unit-tested; they are checked by source, pinning the receiver object and argument name.
test('connect 하는 도구는 그 앞에서 db.applyConf(conf) 를 부른다', function () {
    const dir = path.join(ROOT, 'tools');
    const bad = [];

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js')) { continue; }
        const src = fs.readFileSync(path.join(dir, f), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        const at = src.indexOf('db.connect(');
        if (at < 0) { continue; }   // this tool does not use the DB

        // Matches the receiver object (db.) and argument name (conf) literally; matching only '.applyConf(' would accept db.applyConf({}).
        const apply = src.indexOf('db.applyConf(conf)');
        if (apply < 0) {
            bad.push('tools/' + f + ' — db.applyConf(conf) 가 없다');
        } else if (apply > at) {
            bad.push('tools/' + f + ' — db.applyConf(conf) 가 db.connect() 뒤에 있다');
        }
    }

    assert.deepStrictEqual(bad, [],
        '도구가 conf 를 어댑터에 안 넘긴다 — 빈 비밀번호로 붙는다:\n  ' + bad.join('\n  '));
});

test('코어에 옛 연결 좌표가 남아 있지 않다', function () {
    // The core must not carry 3306 / 'root' / 'localhost' again.
    const files = ['app.js', 'mobius.js', 'mobius/conf_load.js'];
    const bad = [];

    for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        if (/\busedbhost\b|\busedbpass\b/.test(src)) { bad.push(f + ': usedbhost/usedbpass'); }
        if (/connect\s*\([^)]*3306/.test(src)) { bad.push(f + ': connect 에 3306'); }
        if (/connect\s*\([^)]*'root'/.test(src)) { bad.push(f + ": connect 에 'root'"); }
    }

    assert.deepStrictEqual(bad, [],
        '코어가 DB 연결 좌표를 다시 들었다: ' + bad.join(', '));
});

// Module is required to make the require.cache manipulation explicit.
assert.ok(Module);
