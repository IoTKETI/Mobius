'use strict';
// 정산기 — 응답 전송과 connection.release() 를 정확히 한 번만.
//
// 예전에는 라우트마다 이 다섯 줄이 흩어져 있었다.
//
//     responder.response_result(request, response, '200', '2000', '', () => {
//         connection.release();
//         request = null;
//         response = null;
//     });
//
// app.js 에만 68곳. 그 흩어짐 때문에 "응답은 했는데 반납을 빠뜨렸다" 와
// "두 번 정산했다" 가 반복해서 생겼다.

const test = require('node:test');
const assert = require('node:assert');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const settle_mod = require('../mobius/settle');

function fakeConn() {
    const c = { released: 0 };
    c.release = function () { c.released++; };
    return c;
}

function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); }
    finally { console.error = orig; }
    return lines;
}

// on_error 자리에 넣을 가짜. 호출을 기록하고 콜백을 부른다.
function fakeOnError(log) {
    return function (request, response, code, cb) {
        log.push('error:' + code);
        cb();
    };
}

test('error 로 정산하면 응답을 보내고 커넥션을 반납한다', function () {
    const conn = fakeConn();
    const log = [];
    const s = settle_mod.make({}, {}, conn, fakeOnError(log));

    s.error('404-1');

    assert.deepStrictEqual(log, ['error:404-1']);
    assert.strictEqual(conn.released, 1);
    assert.strictEqual(s.isSettled(), true);
});

test('두 번 정산하면 두 번째는 무시하고 로그를 남긴다', function () {
    // 예전에는 두 번째가 null 이 된 response 를 만져 워커가 죽었다.
    // 죽지 않으면서도 드러나야 한다 — 조용히 삼키면 결함이 묻힌다.
    const conn = fakeConn();
    const log = [];
    const s = settle_mod.make({}, {}, conn, fakeOnError(log));

    s.error('404-1');
    const lines = quiet(function () { s.error('500-1'); });

    assert.deepStrictEqual(log, ['error:404-1'], '두 번째 응답은 나가면 안 된다');
    assert.strictEqual(conn.released, 1, '커넥션은 한 번만 반납한다');
    assert.strictEqual(lines.length, 1, '두 번째 시도는 로그로 남아야 한다');
    assert.ok(/settle/.test(lines[0]));
    assert.ok(/500-1/.test(lines[0]), '어떤 정산이 막혔는지 적혀야 한다: ' + lines[0]);
});

test('서로 다른 종류로 두 번 정산해도 막는다', function () {
    const conn = fakeConn();
    const log = [];
    const s = settle_mod.make({}, {}, conn, fakeOnError(log));

    s.raw('첫 응답', function () { log.push('raw'); });
    quiet(function () { s.error('404-1'); });

    assert.deepStrictEqual(log, ['raw']);
    assert.strictEqual(conn.released, 1);
});

test('커넥션이 없으면(못 빌린 경로) 응답만 보낸다', function () {
    // db.getConnection 이 실패한 분기다 — 반납할 것이 없다.
    const log = [];
    const s = settle_mod.make({}, {}, null, fakeOnError(log));

    s.error('500-5');          // 던지지 않아야 한다

    assert.deepStrictEqual(log, ['error:500-5']);
    assert.strictEqual(s.isSettled(), true);
});

test('raw 는 넘긴 함수를 부르고 반납한다', function () {
    const conn = fakeConn();
    let called = 0;
    const s = settle_mod.make({}, {}, conn, fakeOnError([]));

    s.raw('csr forward', function () { called++; });

    assert.strictEqual(called, 1);
    assert.strictEqual(conn.released, 1);
});

test('정산 전에는 isSettled 가 거짓이다', function () {
    const s = settle_mod.make({}, {}, fakeConn(), fakeOnError([]));
    assert.strictEqual(s.isSettled(), false);
});

// ── app.js 가 옛 형태로 되돌아가지 않았는지 ─────────────────────────
//
// 정산이 다시 흩어지면 같은 부류의 결함이 되돌아온다.

test('app.js 에 흩어진 정산 클로저가 남아 있지 않다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // 라우트 정산의 표식이던 두 줄. 정산기로 모았으므로 거의 없어야 한다.
    const nulls = (src.match(/^\s*request = null;\s*$/gm) || []).length;
    assert.ok(nulls <= 2,
        'request = null 이 ' + nulls + '곳이다 — 정산이 다시 흩어졌는지 확인할 것');

    // release 는 기동·주기 작업에도 있으므로 0 이 될 수 없다.
    // 라우트 정산이 다시 늘어나는 것만 막는다.
    const rel = (src.match(/^\s*connection\.release\(\);\s*$/gm) || []).length;
    assert.ok(rel <= 12,
        'connection.release() 가 ' + rel + '곳이다 — 라우트 정산이 다시 흩어졌는지 확인할 것');
});

// ── lookup_* 파이프라인 (§9.3) ───────────────────────────────────────
//
// create / retrieve / update / delete 는 "권한을 보고 연산한다" 는 같은 꼬리를
// 네 벌 들고 있었다. authorize_and_run 으로 모았다.
//
// app.js 는 export 가 없어 직접 부를 수 없다. 되돌아가지 않았는지만 지킨다.

test('lookup_* 가 security.check 를 직접 부르지 않는다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // authorize_and_run 안의 1곳 + fanOutPoint 4곳 = 5곳.
    //
    // fopt 쪽은 아직 안 모았다. 판정 대상이 다르고(그룹의 macp), 거부 코드도
    // 403-5 로 다르며, 권한이 있을 때 하는 일이 메서드마다 다르다 —
    // POST 는 본문 파싱이 끼어든다. 같은 부류의 중복이지만 별도 작업이다.
    const calls = (src.match(/security\.check\(/g) || []).length;
    assert.strictEqual(calls, 5,
        'security.check 호출이 ' + calls + '곳이다 — lookup_* 파이프라인이 다시 흩어졌는지 확인할 것');
});

test('죽은 캐시 cache_security_check 가 되살아나지 않았다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // 쓰기만 하고 읽는 곳이 없어 origin·ri 로 무한히 쌓이던 메모리 누수다.
    assert.strictEqual(/^global\.cache_security_check/m.test(src), false,
        'cache_security_check 전역이 되살아났다');
    assert.strictEqual(/cache_security_check\[/.test(src), false,
        'cache_security_check 에 다시 쓰고 있다');
});

test('CREATE 마다 돌던 security.check 계측이 없다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // 요청마다 shortid 를 만들고 console.time 두 줄을 찍던 것이다.
    assert.strictEqual(/'security\.check - '/.test(src), false,
        'CREATE 마다 도는 계측이 되살아났다');
});
