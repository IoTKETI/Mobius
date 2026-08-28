'use strict';
// 아웃바운드 타임아웃(D16)이 실제로 요청을 끊는지 확인한다.
//
// 서버가 내보내는 요청에 타임아웃이 한 곳도 없었다. req.on('error') 는
// 연결 실패만 잡는다 — 상대가 TCP 는 받아놓고 응답을 안 주면 영원히 기다린다.
// 응답을 기다리는 경로는 그동안 DB 풀 커넥션을 함께 묶는다.
//
// 여기서는 "받아놓고 응답을 안 주는" 서버를 띄워 그 상황을 직접 만든다.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const outbound = require('../mobius/outbound');

// 연결은 받고 응답은 영원히 안 주는 서버
function silentServer() {
    return new Promise(function (resolve) {
        const held = [];
        const srv = http.createServer(function (req, res) {
            held.push(res);          // 응답을 붙들고 아무것도 안 한다
        });
        srv.listen(0, '127.0.0.1', function () {
            resolve({
                port: srv.address().port,
                close: function () {
                    held.forEach(function (r) { try { r.destroy(); } catch (e) { /* 이미 닫힘 */ } });
                    srv.close();
                }
            });
        });
    });
}

test('타임아웃이 없으면 응답이 오지 않는다 (문제 재현)', async function () {
    const srv = await silentServer();
    try {
        const settled = await new Promise(function (resolve) {
            const req = http.request({ hostname: '127.0.0.1', port: srv.port, path: '/', method: 'GET' },
                function () { resolve('response'); });
            req.on('error', function () { resolve('error'); });
            req.end();
            // 1.5초 안에 아무 일도 안 일어나면 매달린 것이다
            setTimeout(function () { req.destroy(); resolve('hung'); }, 1500);
        });
        assert.strictEqual(settled, 'hung', '타임아웃 없이도 응답이 왔다면 이 테스트가 무의미하다');
    } finally {
        srv.close();
    }
});

test('arm 을 걸면 요청이 끊기고 error 핸들러가 뒷정리를 한다', async function () {
    const srv = await silentServer();
    const origErr = console.error;
    console.error = function () { /* 타임아웃 로그를 삼킨다 */ };
    try {
        const settled = await new Promise(function (resolve) {
            const req = http.request({ hostname: '127.0.0.1', port: srv.port, path: '/', method: 'GET' },
                function () { resolve('response'); });
            req.on('error', function (e) { resolve('error: ' + e.message); });
            outbound.arm(req, 'unit test', 300);        // 300ms 로 짧게
            req.end();
            setTimeout(function () { req.destroy(); resolve('hung'); }, 3000);
        });
        assert.ok(/^error: /.test(settled), '요청이 끊기지 않았다: ' + settled);
        assert.ok(/outbound timeout/.test(settled), '타임아웃 사유가 에러에 담겨야 한다: ' + settled);
    } finally {
        console.error = origErr;
        srv.close();
    }
});

test('정상 응답이면 타임아웃이 끼어들지 않는다', async function () {
    const srv = await new Promise(function (resolve) {
        const s = http.createServer(function (req, res) { res.end('ok'); });
        s.listen(0, '127.0.0.1', function () { resolve({ port: s.address().port, close: function () { s.close(); } }); });
    });
    try {
        const got = await new Promise(function (resolve) {
            const req = http.request({ hostname: '127.0.0.1', port: srv.port, path: '/', method: 'GET' },
                function (res) {
                    let b = '';
                    res.on('data', function (c) { b += c; });
                    res.on('end', function () { resolve(b); });
                });
            req.on('error', function (e) { resolve('error: ' + e.message); });
            outbound.arm(req, 'unit test', 300);
            req.end();
        });
        assert.strictEqual(got, 'ok');
        // 타임아웃보다 넉넉히 기다려 뒤늦게 끊지 않는지 본다
        await new Promise(function (r) { setTimeout(r, 500); });
    } finally {
        srv.close();
    }
});

test('한도는 conf 값 -> 전역 -> 기본값 순으로 정해진다', function () {
    const saved = global.outbound_timeout_ms;
    try {
        global.outbound_timeout_ms = 0;
        assert.strictEqual(outbound.limitMs(), outbound.DEFAULT_MS, '전역이 0 이면 기본값');
        global.outbound_timeout_ms = 3000;
        assert.strictEqual(outbound.limitMs(), 3000, '전역이 있으면 그 값');
        assert.strictEqual(outbound.limitMs(500), 500, '인자가 있으면 인자가 우선');
        assert.strictEqual(outbound.limitMs(0), 3000, '인자가 0 이면 전역');
    } finally {
        global.outbound_timeout_ms = saved;
    }
});

test('arm 은 setTimeout 이 없는 요청 객체도 다룬다 (coap)', function () {
    // coap 요청 객체에는 setTimeout 이 없다. 자체 타이머로 처리해야 한다.
    const events = require('events');
    const fake = new events.EventEmitter();
    let destroyed = null;
    fake.destroy = function (e) { destroyed = e; };

    outbound.arm(fake, 'fake coap', 50);
    assert.strictEqual(destroyed, null, '아직 끊으면 안 된다');

    return new Promise(function (resolve) {
        setTimeout(function () {
            assert.ok(destroyed, '타임아웃 뒤에는 끊어야 한다');
            assert.ok(/outbound timeout/.test(destroyed.message));
            resolve();
        }, 200);
    });
});

test('응답이 오면 자체 타이머는 해제된다', function () {
    const events = require('events');
    const fake = new events.EventEmitter();
    let destroyed = null;
    fake.destroy = function (e) { destroyed = e; };

    outbound.arm(fake, 'fake coap', 50);
    fake.emit('response');                 // 정상 응답

    return new Promise(function (resolve) {
        setTimeout(function () {
            assert.strictEqual(destroyed, null, '응답을 받았는데 뒤늦게 끊었다');
            resolve();
        }, 200);
    });
});
