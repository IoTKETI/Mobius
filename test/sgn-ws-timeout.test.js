'use strict';
// WS 알림에 타임아웃이 없었다 (요청 흐름 남은 일 §8).
//
// sgn_man 의 request_noti_ws 는 websocket 라이브러리의 client.connect 에 인자 둘만
// 넘겼다. 상대가 TCP 는 받아놓고 101 Switching Protocols 를 영영 안 주면 'connect' 도
// 'connectFailed' 도 발화하지 않는다 — 알림마다 소켓과 파일 디스크립터가 하나씩 남는다.
//
// outbound.arm 이 못 덮는 자리다. ws_client 는 http 요청 객체가 아니고(setTimeout 없음),
// 결과를 'connect'/'connectFailed' 로 알리므로 arm 의 자체 타이머가 듣는
// 'response'/'error'/'close' 가 오지 않는다 — 그대로 걸면 접속이 된 뒤에도 타이머가
// 살아 거짓 '끊는다' 로그를 남긴다. test/outbound-timeout.test.js 의 커버리지 감시도
// `req = http.request(...)` 모양만 찾으므로 이 자리를 보지 못한다.
// 여기서는 "101 을 안 주는" 서버를 띄워 그 상황을 직접 만든다.
//
// sgn_man 은 require 만으로 MQTT 클라이언트를 연다. 브로커가 없으면 2초마다 재접속을
// 시도하며 프로세스를 붙든다 — mqtt 를 require.cache 에 스텁으로 심고 나서 로드한다.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const events = require('node:events');

global.NOPRINT = 'true';
global.usecseid = '/Mobius';
global.use_secure = 'disable';
global.use_mqtt_broker = '127.0.0.1';
global.use_mqtt_port = '1';

const mqttPath = require.resolve('mqtt');
require.cache[mqttPath] = { id: mqttPath, filename: mqttPath, loaded: true,
    exports: { connect: () => { const c = new events.EventEmitter(); c.publish = () => {}; c.queue = []; return c; } } };

const sgn_man = require(path.join(__dirname, '..', 'mobius', 'sgn_man.js'));

function capture() {
    const lines = [];
    const l = console.log, e = console.error;
    console.log = (s) => lines.push(String(s));
    console.error = (s) => lines.push(String(s));
    return { lines, restore: () => { console.log = l; console.error = e; } };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// pred() 가 참값을 낼 때까지 20ms 마다 본다. 한도를 넘기면 마지막 값을 돌려준다.
async function waitFor(pred, ms) {
    const until = Date.now() + ms;
    for (;;) {
        const v = pred();
        if (v || Date.now() > until) { return v; }
        await sleep(20);
    }
}

// 업그레이드 요청은 받아 두고 101 도 다른 응답도 영영 안 주는 서버
function silentUpgradeServer() {
    return new Promise((resolve) => {
        const held = [];
        const srv = http.createServer((req, res) => { held.push(res); });
        srv.on('upgrade', (req, socket) => { held.push(socket); socket.on('error', () => {}); });
        srv.listen(0, '127.0.0.1', () => resolve({
            port: srv.address().port,
            held,
            close: () => { held.forEach((s) => { try { s.destroy(); } catch (e) { /* 이미 닫힘 */ } }); srv.close(); }
        }));
    });
}

test('101 을 영영 안 주는 상대 — 한도 안에 끊고 실패로 판정한다', async () => {
    const srv = await silentUpgradeServer();
    const saved = global.outbound_timeout_ms;
    global.outbound_timeout_ms = 300;
    const cap = capture();
    try {
        const nu = 'ws://127.0.0.1:' + srv.port + '/noti';
        const t0 = Date.now();
        sgn_man.post(nu, 'rqi-1', '{"m2m:sgn":{}}', '/M/sub-ws');

        assert.ok(await waitFor(() => srv.held.length === 1, 1000), '상대가 업그레이드 요청을 못 받았다');
        // http.Server 의 소켓은 allowHalfOpen 이라 상대(우리)가 FIN 을 보내도 'close' 가
        // 저절로 오지 않는다 — 'end' 가 "클라이언트가 끊었다" 는 신호다.
        const closedAt = new Promise((r) => {
            const done = () => r(Date.now() - t0);
            srv.held[0].once('end', done);
            srv.held[0].once('close', done);
        });

        const judged = await waitFor(() => cap.lines.find((l) => /^\[noti\] fail ws sub=\/M\/sub-ws nu=/.test(l)), 2000);
        assert.ok(judged, '한도(300ms)를 넘겨도 판정이 없다 — 타임아웃이 없다:\n' + cap.lines.join('\n'));
        assert.match(judged, /timeout/, '사유가 타임아웃이어야 한다: ' + judged);

        const at = await Promise.race([closedAt, sleep(1000).then(() => null)]);
        assert.notStrictEqual(at, null, '판정만 하고 소켓을 안 끊었다 — 디스크립터가 남는다');
        assert.ok(at >= 250 && at < 1500, '끊은 시점 ' + at + 'ms — 한도(300ms) 근처여야 한다');

        // 끊고 나서 라이브러리가 뒤따라 올리는 connectFailed 로 두 번 판정하지 않는다
        await sleep(300);
        const mine = cap.lines.filter((l) => /^\[noti\] .* sub=\/M\/sub-ws /.test(l));
        assert.strictEqual(mine.length, 1, '한 알림에 판정이 둘이다:\n' + mine.join('\n'));
    } finally {
        cap.restore();
        global.outbound_timeout_ms = saved;
        srv.close();
    }
});

test('접속이 되면 타임아웃이 끼어들지 않는다 — 본문이 가고 판정은 unknown 하나', async () => {
    const WebSocketServer = require('websocket').server;
    const srv = http.createServer((req, res) => res.end());
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const received = [];
    const wss = new WebSocketServer({ httpServer: srv, autoAcceptConnections: false });
    wss.on('request', (req) => {
        const conn = req.accept('onem2m.r2.0.json', req.origin);
        conn.on('message', (m) => received.push(m.utf8Data));
        conn.on('error', () => {});
    });
    const saved = global.outbound_timeout_ms;
    global.outbound_timeout_ms = 300;
    const cap = capture();
    try {
        const nu = 'ws://127.0.0.1:' + srv.address().port + '/noti';
        sgn_man.post(nu, 'rqi-2', '{"m2m:sgn":{"ok":1}}', '/M/sub-ws2');

        assert.ok(await waitFor(() => received.length === 1, 2000), '알림 본문이 안 왔다:\n' + cap.lines.join('\n'));
        assert.strictEqual(received[0], '{"m2m:sgn":{"ok":1}}');

        await sleep(700);   // 한도(300ms)를 충분히 넘긴다 — 타이머가 살아 있으면 여기서 터진다
        const mine = cap.lines.filter((l) => /sub=\/M\/sub-ws2 /.test(l) || /^\[outbound\]/.test(l));
        assert.deepStrictEqual(mine.filter((l) => /fail|^\[outbound\]/.test(l)), [],
            '접속이 됐는데 타임아웃이 끊었다:\n' + mine.join('\n'));
        assert.strictEqual(mine.filter((l) => /^\[noti\] unknown ws /.test(l)).length, 1,
            '판정은 unknown 하나여야 한다:\n' + mine.join('\n'));
    } finally {
        cap.restore();
        global.outbound_timeout_ms = saved;
        wss.shutDown();
        srv.close();
    }
});

test('접속 자체가 안 되면 곧바로 실패다 — 타임아웃을 기다리지 않는다', async () => {
    // 아무도 안 듣는 포트. 바로 ECONNREFUSED 다.
    const probe = http.createServer();
    await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));

    const saved = global.outbound_timeout_ms;
    global.outbound_timeout_ms = 400;
    const cap = capture();
    try {
        const t0 = Date.now();
        sgn_man.post('ws://127.0.0.1:' + port + '/noti', 'rqi-3', '{}', '/M/sub-ws3');
        const judged = await waitFor(() => cap.lines.find((l) => /^\[noti\] fail ws sub=\/M\/sub-ws3 /.test(l)), 1500);
        assert.ok(judged, '접속 실패 판정이 없다:\n' + cap.lines.join('\n'));
        assert.match(judged, /connectFailed/, judged);
        assert.ok(Date.now() - t0 < 300, '접속 거부인데 한도(400ms)까지 기다렸다');

        // 실패로 판정한 뒤 타이머가 살아 있으면 한도(400ms)에 두 번째 판정을 낸다
        await sleep(600);
        const mine = cap.lines.filter((l) => /sub=\/M\/sub-ws3 /.test(l) || /^\[outbound\]/.test(l));
        assert.strictEqual(mine.length, 1, '판정이 둘이거나 타이머가 뒤늦게 터졌다:\n' + mine.join('\n'));
    } finally {
        cap.restore();
        global.outbound_timeout_ms = saved;
    }
});
