'use strict';
// The settler: response transmission and connection.release() exactly once.
//
// The former per-route form was
//
//     responder.response_result(request, response, '200', '2000', '', () => {
//         connection.release();
//         request = null;
//         response = null;
//     });
//
// scattered over every route, which is where 'responded but never released' and 'settled twice' came from.

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

// Fake for the on_error slot. Records the call and invokes the callback.
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
    // A second settlement must not touch the null response and kill the worker, but it must still surface; swallowing it silently would hide the defect.
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
    // The branch where db.getConnection failed: there is nothing to release.
    const log = [];
    const s = settle_mod.make({}, {}, null, fakeOnError(log));

    s.error('500-5');          // must not throw

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

// app.js has not reverted to the old form. Scattered settlement brings the same class of defects back.

test('app.js 에 흩어진 정산 클로저가 남아 있지 않다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // The two lines that marked route settlement. Collected into the settler, so almost none should remain.
    const nulls = (src.match(/^\s*request = null;\s*$/gm) || []).length;
    assert.ok(nulls <= 2,
        'request = null 이 ' + nulls + '곳이다 — 정산이 다시 흩어졌는지 확인할 것');

    // release also appears in startup and periodic jobs, so it cannot be 0. Only growth in route settlement is blocked.
    const rel = (src.match(/^\s*connection\.release\(\);\s*$/gm) || []).length;
    assert.ok(rel <= 12,
        'connection.release() 가 ' + rel + '곳이다 — 라우트 정산이 다시 흩어졌는지 확인할 것');
});

test('라우트 핸들러 안에서 db.release 를 직접 부르지 않는다', function () {
    // Responses must not bypass the settler with
    //
    //     db.release(connection);                          <- before the response
    //     response.header('Content-Type', ...);
    //     response.status(200).end(JSON.stringify(result));
    //
    // Two things are wrong there: the release precedes the response, so another request may borrow the connection meanwhile; and without the settler there is no double-settlement guard.
    //
    // settle.raw(what, fn) is exactly for this: fn sends the response, then the connection is released, in order and through claim().
    //
    // Scope: startup and periodic jobs (the top of app.js) have no settler and are not targets. Only the part after the first app.get/post/put/delete is scanned.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    const routes_at = src.search(/^app\.(get|post|put|delete)\(/m);
    assert.ok(routes_at > 0, '라우트 시작을 찾지 못했다 — 이 시험의 범위 계산을 다시 볼 것');

    // Comments do not execute. Scanning comments would let a single word in a comment pass the check, so both the scan and the exception test below look at executable lines only.
    const is_comment = function (l) { return /^\s*(\/\/|\*|\/\*)/.test(l); };

    const lines = src.slice(routes_at).split(/\r?\n/);
    const bad = [];
    const before = src.slice(0, routes_at).split(/\r?\n/).length;
    lines.forEach(function (l, i) {
        if (is_comment(l)) { return; }
        if (!/\bdb\.release\(/.test(l)) { return; }

        // Exception: the set_hit connection.
        //
        // POST writes the hit counter on its own connection, not the request connection (fire-and-forget, so it does not queue ahead of the request's first SELECT). That connection is not on the response path, has no settler, and is correctly released in the write callback. This test targets bypasses on the response path only.
        const near = lines.slice(Math.max(0, i - 4), i)
            .filter(function (n) { return !is_comment(n); })
            .join('\n');
        if (/set_hit\(/.test(near)) { return; }

        bad.push('app.js:' + (before + i) + '  ' + l.trim());
    });

    assert.deepStrictEqual(bad, [],
        '라우트 안에서 db.release 를 직접 부른다:\n  ' + bad.join('\n  ') +
        '\n  settle.raw(설명, function () { ...응답... }) 를 쓸 것 — ' +
        '응답 뒤에 반납하고 이중 정산도 막는다');
});

// lookup_* pipeline. create / retrieve / update / delete share the tail 'check authorization, then run', collected in authorize_and_run.
//
// app.js has no exports and cannot be called; only regression is guarded.

test('lookup_* 가 security.check 를 직접 부르지 않는다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // Exactly two call sites remain.
    //   authorize_and_run  ordinary resource access (decided by the target's acpi)
    //   run_fanout         fanOutPoint (decided by the group's macp, reject code 403-5)
    //
    // The decision target and reject code differ, so the two are not merged. A third direct call means the pipeline is scattering again.
    const calls = (src.match(/security\.check\(/g) || []).length;
    assert.strictEqual(calls, 2,
        'security.check 호출이 ' + calls + '곳이다 — 파이프라인이 다시 흩어졌는지 확인할 것');
});

test('죽은 캐시 cache_security_check 가 되살아나지 않았다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // Write-only global that accumulated per origin and ri without bound: a memory leak.
    assert.strictEqual(/^global\.cache_security_check/m.test(src), false,
        'cache_security_check 전역이 되살아났다');
    assert.strictEqual(/cache_security_check\[/.test(src), false,
        'cache_security_check 에 다시 쓰고 있다');
});

test('CREATE 마다 돌던 security.check 계측이 없다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // Per-request shortid plus two console.time lines must not return.
    assert.strictEqual(/'security\.check - '/.test(src), false,
        'CREATE 마다 도는 계측이 되살아났다');
});
