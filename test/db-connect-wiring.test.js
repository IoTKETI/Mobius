'use strict';
// connect() 배선. **좌표가 코어의 인자에서 사라진 뒤 남은 유일한 안전망이다.**
//
// 예전 시그니처는 connect(host, port, user, password, cb) 였다. 틀린 값을 넘기면
// 호출부에서 눈에 보였다. 지금은 어댑터가 좌표를 갖고 conf 에서 비밀번호를
// 읽으므로, 배선이 끊어져도 **호출부는 멀쩡해 보인다.** 끊어진 채로 도는
// 서버는 '빈 비밀번호로 붙는' 상태가 되고, 그 증상은 접속 실패 한 줄뿐이다.
//
// ── 왜 소스 스캔만으로는 부족한가 ────────────────────────────────────────
// "applyConf 가 connect 보다 앞에 있는가" 를 문자열로 보는 검사를 먼저 썼는데,
// 적대적 검토에서 뚫렸다. 그 검사는 두 가지를 못 본다:
//
//   db.applyConf({})        — 인자가 빈 객체여도 순서는 맞다
//   foo.applyConf(conf)     — 수신 객체가 db 가 아니어도 매칭된다
//
// 둘 다 "빈 비밀번호로 붙는" 바로 그 상태를 만든다. 그래서 이 파일의 중심은
// **드라이버에 실제로 도착한 값**을 보는 쪽이다. 소스 스캔은 "배선 코드가
// 아예 없다" 는 극단만 잡는 보조 장치로 남긴다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

// 드라이버의 createPool 을 가로채, 어댑터가 실제로 만든 설정을 붙잡는다.
// 어댑터 소스를 안 읽는다 — 도착한 값만 본다.
//
// **어댑터와 같은 모듈을 잡아야 한다.** 2026-09-04 에 mysql -> mysql2 로
// 옮기면서 이 줄이 'mysql' 을 그대로 붙잡고 있어 시험 5벌이 한꺼번에
// 'Cannot find module' 로 죽었다. 가로채기는 이름을 하드코딩하므로 드라이버를
// 바꾸면 여기도 같이 바꿔야 한다 — 그 사실 자체를 여기 적어 둔다.
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

    // 값 자체는 예전에 app.js 6곳과 mobius.js 에 박혀 있던 것 그대로여야 한다.
    // 하나라도 달라지면 배포가 다른 자리로 붙는다.
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
    // 이 테스트는 **실패를 문서화한다.** 배선이 끊어지면 무슨 일이 나는지
    // 코드로 못 박아 둬야, 아래 순서 검사가 왜 있는지가 설명된다.
    const a = freshAdapter();   // applyConf 안 부름
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

// ── 보조: 배선 코드가 아예 없는 극단을 잡는다 ────────────────────────────
//
// 위 테스트들은 어댑터를 직접 부른다. 도구 파일은 require.main 가드가 없어
// require 하면 곧장 DB 에 붙으려 하므로(backfill 이 그렇다) 유닛으로 못 덮는다.
// 그래서 그쪽은 소스로 본다 — 다만 수신 객체와 인자 이름까지 못 박는다.
test('connect 하는 도구는 그 앞에서 db.applyConf(conf) 를 부른다', function () {
    const dir = path.join(ROOT, 'tools');
    const bad = [];

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js')) { continue; }
        const src = fs.readFileSync(path.join(dir, f), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        const at = src.indexOf('db.connect(');
        if (at < 0) { continue; }   // 이 도구는 DB 를 안 쓴다

        // **수신 객체(db.)와 인자 이름(conf)까지 글자 그대로 본다.**
        // '.applyConf(' 만 보면 db.applyConf({}) 도 통과한다 — 적대적 검토에서
        // 실제로 지적된 구멍이다.
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
    // 3306 / 'root' / 'localhost' 를 코어가 다시 들면 이 작업이 되돌려진 것이다.
    const files = ['app.js', 'mobius.js'];
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

// Module 은 require.cache 조작이 의도된 것임을 드러내려고 들여둔다.
assert.ok(Module);
