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

/* ── 커버리지 ─────────────────────────────────────────────────────────────
 *
 * 위 시험들은 arm() 이 **제대로 도는지**만 본다. "모든 아웃바운드 요청에
 * arm 이 걸려 있는가" 는 아무도 안 봤다. 새 요청 자리를 추가하면서 arm 을
 * 빠뜨려도 걸리는 것이 없었다.
 *
 * 같은 저장소가 나가는 요청의 Accept 고정에는 이미 이 감시를 두고 있다
 * (test/relay-headers.test.js 의 "상대에게 나가는 요청은 전부 Accept 를
 * json 으로 고정한다"). 타임아웃에는 대응물이 없었다.
 *
 * 이 시험이 없어서 실제로 오판이 났다 — 파일별로 `http.request` 발생 횟수와
 * `arm` 호출 횟수를 그냥 비교해 "프록시 10곳에 타임아웃이 없다" 고 보고했다.
 * 틀렸다. 각 함수가 use_secure 로 http/https 를 갈라 **같은 req 변수**에 담고
 * if/else **뒤에서** arm 을 한 번 부른다. 분기 쌍이 arm 하나를 공유한다.
 * 세는 방법이 틀렸던 것이지 코드가 빠진 것이 아니었다.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

test('http·https·coap 로 나가는 요청은 전부 outbound.arm 이 덮는다', function () {
    // **이 시험의 범위는 세 프로토콜뿐이다.** 제목을 그렇게 적어 둔다.
    //
    // 처음엔 "나가는 요청은 전부" 라고 적었는데 과장이었다. 이 검사는
    // `req = http|https|coap.request(...)` 라는 **모양**을 찾는다. 그래서
    // 그 모양이 아닌 아웃바운드는 애초에 시야에 없다:
    //
    //   mobius/sgn_man.js:349  ws_client.connect(nu, subprotocol)   <- WS 알림
    //   mobius/sgn_man.js:251  sgn_mqtt_client.publish(...)         <- MQTT 알림
    //
    // WS 알림에는 지금 타임아웃이 없다(connectFailed 는 접속 실패만 잡고,
    // 붙은 뒤 상대가 조용하면 기다린다). MQTT publish 는 요청-응답이 아니라
    // arm 의 대상이 아니다.
    //
    // 이 사각지대를 모르고 "11곳 전부 armed" 라고 문서에 적었다가 잡혔다.
    // 시험 제목이 실제 범위보다 넓으면 그런 오해를 만든다.
    // pxy_coap.js · pxy_mqtt.js · pxy_ws.js 가 여기 있었다.
    // 2026-09-04 에 프로토콜 프록시 3종을 지우면서 함께 뺐다.
    const files = ['app.js', 'mobius/fopt.js', 'mobius/grp.js', 'mobius/sgn_man.js'];

    for (const f of files) {
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);

        const reqs = [];   // req 에 요청 객체를 담는 줄
        const arms = [];   // 그 req 에 arm 을 거는 줄
        lines.forEach(function (l, i) {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }          // 주석은 뺀다
            // http · https · coap 셋 다 센다. arm() 은 setTimeout 이 없는
            // coap 요청도 자체 타이머로 다루므로(위 시험 참조) 똑같이 대상이다.
            // 처음엔 https? 만 셌다가 sgn_man 의 coap 알림에 걸린 arm 이
            // "아무것도 안 덮는다" 로 나왔다 — 코드가 아니라 이 줄이 틀렸었다.
            if (/^\s*(var\s+)?req\s*=\s*(https?|coap)\.request\(/.test(l)) { reqs.push(i + 1); }
            if (/outbound\.arm\(req\b/.test(l)) { arms.push(i + 1); }
        });

        if (reqs.length === 0) { continue; }

        // **함수 단위로 본다.** 처음엔 "직전 arm 이후의 req 를 덮는다" 로 셌는데
        // 너무 느슨했다 — 중간 arm 하나를 지워도 뒤쪽 함수의 arm 이 앞 함수의
        // 요청까지 덮는 것으로 쳐서 돌연변이가 안 잡혔다(pxy_ws 로 확인).
        //
        // 다른 함수에 있는 arm 은 이 요청을 지켜 주지 않는다.
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

        // 아무 요청도 안 덮는 arm 은 죽은 호출이다.
        for (const a of arms) {
            const home = fnOf(a);
            const covers = reqs.some(function (r) { return r < a && fnOf(r) === home; });
            assert.ok(covers,
                f + ':' + a + ' 의 arm 이 같은 함수의 요청을 안 덮는다 — 죽은 호출이거나 순서가 어긋났다');
        }
    }
});

test('arm 라벨이 어느 경로인지 말해 준다', function () {
    // 타임아웃 로그는 '[outbound] <label> 응답이 ...' 한 줄이 전부다.
    // label 이 비어 있거나 겹치면 어느 경로가 멈췄는지 알 수 없다.
    // pxy_coap.js · pxy_mqtt.js · pxy_ws.js 가 여기 있었다.
    // 2026-09-04 에 프로토콜 프록시 3종을 지우면서 함께 뺐다.
    const files = ['app.js', 'mobius/fopt.js', 'mobius/grp.js', 'mobius/sgn_man.js'];

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

    // 자리가 통째로 사라지면 위 두 시험이 조용히 통과한다(검사할 것이 없으니).
    // 최소 개수를 박아 그 경우를 잡는다.
    //
    // 하한이 10 이었다. 프로토콜 프록시 3종을 지우면서 arm 호출이
    // 11 -> 6 으로 줄어 6 으로 내렸다. 남는 여섯 자리:
    //     app.js 2 (ae notify · csr forward)
    //     mobius/fopt.js 1 · mobius/grp.js 1
    //     mobius/sgn_man.js 2 (notify http · notify coap)
    assert.ok(total >= 6,
        'arm 호출이 ' + total + '개뿐이다 — 아웃바운드 자리가 사라졌거나 시험이 못 찾고 있다');
});

test('globalAgent.maxSockets 를 손으로 세우지 않는다', function () {
    // ── 왜 지웠나 ────────────────────────────────────────────────────────
    //
    // app.js 네 자리에 `http.globalAgent.maxSockets = 1000000` 이 있었다.
    // 튜닝처럼 보이지만 **아무 일도 안 하는 줄**이었다:
    //
    //     Node 의 http/https.globalAgent.maxSockets 기본값 = Infinity
    //
    // 즉 값을 올리는 것이 아니라 **낮추고** 있었다(Infinity -> 1,000,000).
    // 그리고 1,000,000 은 어떤 현실적 부하에서도 안 걸린다.
    //
    // 남겨 두면 "동시성을 100만으로 튜닝했다" 는 인상을 주어 읽는 사람을
    // 오해시킨다. 넷 중 둘은 죽은 단일 프로세스 분기 안이기도 했다.
    //
    // ── 다시 세우려면 ────────────────────────────────────────────────────
    //
    // 나가는 요청에 진짜 역압이 필요하다고 판단되면 그때는 **실측으로 숫자를
    // 정한다.** 상대 호스트당 동시 소켓을 몇으로 둘지는 알림·팬아웃의 실제
    // 동시성에서 나와야 하고, 근거 없는 큰 수를 다시 박는 것은 같은 실수다.
    // 그렇게 정한 값이라면 이 시험도 함께 고친다.
    const files = ['app.js', 'mobius/fopt.js', 'mobius/grp.js', 'mobius/sgn_man.js'];

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
