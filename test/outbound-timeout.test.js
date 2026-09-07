'use strict';
// Checks that the outbound timeout actually ends a request.
//
// req.on('error') only catches connection failures; a peer that accepts TCP and never answers would wait forever, holding a DB pool connection meanwhile.
//
// A server that accepts and never answers is started to create that situation.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const outbound = require('../mobius/outbound');

// A server that accepts connections and never answers.
function silentServer() {
    return new Promise(function (resolve) {
        const held = [];
        const srv = http.createServer(function (req, res) {
            held.push(res);          // holds the response and does nothing
        });
        srv.listen(0, '127.0.0.1', function () {
            resolve({
                port: srv.address().port,
                close: function () {
                    held.forEach(function (r) { try { r.destroy(); } catch (e) { /* already closed */ } });
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
            // If nothing happens within 1.5 seconds the request is hung.
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
    console.error = function () { /* swallows the timeout log */ };
    try {
        const settled = await new Promise(function (resolve) {
            const req = http.request({ hostname: '127.0.0.1', port: srv.port, path: '/', method: 'GET' },
                function () { resolve('response'); });
            req.on('error', function (e) { resolve('error: ' + e.message); });
            outbound.arm(req, 'unit test', 300);        // short: 300ms
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
        // Waits well past the timeout to check that nothing is cut late.
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
    // A coap request object has no setTimeout; arm handles it with its own timer.
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
    fake.emit('response');                 // normal response

    return new Promise(function (resolve) {
        setTimeout(function () {
            assert.strictEqual(destroyed, null, '응답을 받았는데 뒤늦게 끊었다');
            resolve();
        }, 200);
    });
});

/*
 * Coverage.
 *
 * The tests above check that arm() works. This part checks that every outbound request is armed, so a new request site without arm is caught (the counterpart of test/relay-headers.test.js for Accept).
 *
 * Each function selects http or https by use_secure, stores the request in the same req variable, and calls arm once after the if/else; the branch pair shares one arm.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

test('http·https·coap 로 나가는 요청은 전부 outbound.arm 이 덮는다', function () {
    // Scope of this test: the three protocols only. The check looks for the shape `req = http|https|coap.request(...)`; outbound calls of other shapes are outside its view:
    //
    //   mobius/sgn_man.js  request_noti_mqtt  sgn_mqtt_client.publish(...)        <- MQTT notification
    //
    // MQTT publish is not request-response and is not a target of arm. A new outbound call that is not of the `req = http.request` shape needs its own watch.
    const files = ['app.js', 'mobius/fanout.js', 'mobius/fopt.js', 'mobius/grp.js', 'mobius/sgn_man.js'];

    for (const f of files) {
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);

        const reqs = [];   // lines that store a request object in req
        const arms = [];   // lines that arm that req
        lines.forEach(function (l, i) {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }          // comments are excluded
            // http, https and coap are all counted. arm() handles coap requests without setTimeout with its own timer (see the test above), so they are targets as well.
            if (/^\s*(var\s+)?req\s*=\s*(https?|coap)\.request\(/.test(l)) { reqs.push(i + 1); }
            if (/outbound\.arm\(req\b/.test(l)) { arms.push(i + 1); }
        });

        if (reqs.length === 0) { continue; }

        // Checked per function. Counting 'req after the previous arm' is too loose: removing one arm in the middle lets a later function's arm cover an earlier function's request. An arm in another function does not protect this request.
        const fnStarts = [];
        lines.forEach(function (l, i) {
            if (/^(function\s+\w+|exports\.\w+\s*=\s*function|var\s+\w+\s*=\s*function)/.test(l)) {
                fnStarts.push(i + 1);
            }
        });

        function fnOf(line) {
            let owner = 0;
            for (const s of fnStarts) { if (s <= line) { owner = s; } else { break; } }
            return owner;
        }

        for (const r of reqs) {
            const home = fnOf(r);
            const guarded = arms.some(function (a) { return a > r && fnOf(a) === home; });
            assert.ok(guarded,
                f + ':' + r + ' 의 요청에 outbound.arm 이 없다 (함수 시작 ' + home + '행) — ' +
                '상대가 응답을 안 주면 그 자리에서 멈춘다');
        }

        // An arm that covers no request is a dead call.
        for (const a of arms) {
            const home = fnOf(a);
            const covers = reqs.some(function (r) { return r < a && fnOf(r) === home; });
            assert.ok(covers,
                f + ':' + a + ' 의 arm 이 같은 함수의 요청을 안 덮는다 — 죽은 호출이거나 순서가 어긋났다');
        }
    }
});

test('arm 라벨이 어느 경로인지 말해 준다', function () {
    // The timeout log is the single line '[outbound] <label> ...'. An empty or duplicate label makes it impossible to tell which path stalled.
    const files = ['app.js', 'mobius/fanout.js', 'mobius/fopt.js', 'mobius/grp.js', 'mobius/sgn_man.js'];

    let total = 0;
    for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const calls = src.split(/\r?\n/).filter(function (l) {
            return !/^\s*(\/\/|\*|\/\*)/.test(l) && /outbound\.arm\(/.test(l);
        });
        for (const c of calls) {
            total++;
            assert.match(c, /outbound\.arm\(\s*req\s*,\s*['"]/,
                f + ' 의 arm 에 라벨 문자열이 없다: ' + c.trim());
        }
    }

    // If a site disappears entirely the two tests above pass silently (nothing to check). A minimum count catches that case.
    //
    // The five remaining sites:
    //     app.js 1 (csr forward)
    //     mobius/fanout.js 1 (fan-out member), mobius/grp.js 1
    //     mobius/sgn_man.js 2 (notify http, notify coap)
    assert.ok(total >= 5,
        'arm 호출이 ' + total + '개뿐이다 — 아웃바운드 자리가 사라졌거나 시험이 못 찾고 있다');
});

test('globalAgent.maxSockets 를 손으로 세우지 않는다', function () {
    // `http.globalAgent.maxSockets = 1000000` must not return. Node's default is Infinity, so the line lowered the limit rather than raising it, and 1,000,000 is never reached under any realistic load; it only suggests a tuning that does not exist.
    //
    // If real back-pressure on outbound requests is ever needed, the number must come from measured concurrency of notifications and fan-out, and this test changes with it.
    const files = ['app.js', 'mobius/fanout.js', 'mobius/fopt.js', 'mobius/grp.js', 'mobius/sgn_man.js'];

    for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const live = src.split(/\r?\n/).filter(function (l) {
            return !/^\s*(\/\/|\*|\/\*)/.test(l) && /globalAgent\.maxSockets\s*=/.test(l);
        });
        assert.deepStrictEqual(live, [],
            f + ' 이 globalAgent.maxSockets 를 세운다: ' + live.join(' | ') +
            '\n  Node 기본값이 Infinity 라 이 대입은 상한을 낮출 뿐이고 실효가 없다. ' +
            '진짜 역압이 필요하면 실측으로 값을 정하고 이 시험을 고칠 것');
    }
});

/* arm is an idle timer, not a total limit. A request whose peer keeps sending within the limit is never cut; turning it into a total limit would cut peers that legitimately send a large response slowly. That choice is pinned here. */
test('arm 은 유휴 타이머다 — 한도보다 짧은 간격의 드립은 끊지 않는다 (총 상한이 아니다)', async function () {
    // A server that sends headers immediately, then one byte every 100ms, 12 times (1.2 seconds). The limit is 300ms.
    const srv = http.createServer(function (req, res) {
        res.writeHead(200);
        let n = 0;
        const t = setInterval(function () {
            res.write('x');
            if (++n >= 12) { clearInterval(t); res.end(); }
        }, 100);
    });
    await new Promise(function (r) { srv.listen(0, '127.0.0.1', r); });
    const origErr = console.error;
    console.error = function () { /* a timeout log is itself a failure; the assertion below catches it */ };
    try {
        const outcome = await new Promise(function (resolve) {
            const req = http.request({ hostname: '127.0.0.1', port: srv.address().port, path: '/', method: 'GET' },
                function (res) {
                    let bytes = 0;
                    res.on('data', function (d) { bytes += d.length; });
                    res.on('end', function () { resolve('completed ' + bytes); });
                });
            req.on('error', function (e) { resolve('error: ' + e.message); });
            outbound.arm(req, 'drip', 300);
            req.end();
        });
        assert.match(outcome, /^completed 12$/, '한도(300ms)보다 짧은 간격의 드립인데 끊었거나 다 못 받았다: ' + outcome);
    } finally {
        console.error = origErr;
        srv.close();
    }
});
