'use strict';
/**
 * Record of removed paths that were unreachable or had no callers.
 *
 *  1. AE notification relay: forwarding a POST whose body is m2m:sgn to the target AE's poa (check_notification's notify branch -> check_ae_notify -> notify_http -> settle.raw). check_resource_supported rejected m2m:sgn with 400-3 first, so it could not be reached, and no remote CSE uses it. To be rebuilt from scratch if ever needed.
 *  2. Subscription verification request (check_value 256, vrq): had no callers. Implementing it would break subscription creation for subscribers that do not answer (e.g. MQTT receivers). Not supported.
 *  3. acor_allows and evaluate_acr stay: tests rely on the contract and they cost nothing.
 *  4. WS notifications (sgn_man's request_noti_ws, the ws branch of post, npm websocket): no ws nu existed in the deployment, and a peer that never sends 101 left sockets open without a timeout. ws:// nu is now a subscription with no receiver (unsupported scheme).
 *
 * This test keeps those paths from returning silently. Reviving one requires editing this file and revisiting the reasoning above.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
function live(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

test('AE 알림 중계 경로가 없다 — check_ae_notify · notify_http · notify 갈래', () => {
    const app = live('app.js');
    ['check_ae_notify', 'notify_http', 'check_notification', "'notify'", "settle.raw('ae notify'"].forEach((w) => {
        assert.strictEqual(app.indexOf(w), -1, w + ' 가 되살아났다');
    });
    // POST requires ty. The remaining decisions are two: Content-Type missing (400-20) and ty missing (400-19).
    assert.match(app, /function check_post_content_type\(request, callback\)/);
    assert.match(app, /check_post_content_type\(request, \(code\) => \{\s*if \(code === '200'\) \{\s*run_operation\(request, response, settle, 'POST', lookup_create\);/);
    // The seven reasons of that path are gone as well.
    const reason = require('../mobius/reason');
    ['404-6', '404-7', '404-8', '405-10', '405-11', '405-12', '400-47'].forEach((k) => {
        assert.strictEqual(reason.REASON[k], undefined, k + ' 가 되살아났다');
    });
    assert.strictEqual(reason.REASON['400-19'].msg, 'POST must carry ty in Content-Type');
});

test('구독 검증 요청(256, vrq)을 만드는 갈래가 없다', () => {
    const sgn = live('mobius/sgn.js');
    assert.strictEqual(sgn.indexOf('256'), -1, 'check_value 256 이 되살아났다');
    assert.strictEqual(sgn.indexOf('vrq'), -1, 'vrq 를 만드는 코드가 되살아났다');
    assert.match(sgn, /if\(check_value != 128\) \{/, '128 만 남은 분기가 아니다');
});

test('remoteCSE 포워딩이 상류 무응답을 AE 알림의 사유로 내지 않는다', () => {
    // forward_http used to borrow 404-7 ('AE for notification does not exist') from the removed path. The upstream did not answer, so TARGET_NOT_REACHABLE (5103/404) is the right code.
    const reason = require('../mobius/reason');
    assert.strictEqual(reason.REASON['404-10'].code.name, 'TARGET_NOT_REACHABLE');
    const app = live('app.js');
    const at = app.indexOf('function forward_http(');
    assert.ok(at > 0);
    assert.ok(/callback\('404-10'\)/.test(app.slice(at, at + 3000)), 'forward_http 가 404-10 을 쓰지 않는다');
});

// Loads sgn_man for real. Requiring it opens an MQTT client, and without a broker the reconnect loop keeps the process alive, so mqtt is stubbed into require.cache first.
test('WS 알림 경로가 없다 — ws:// nu 는 접속 시도 없이 "받을 놈이 없는" 구독으로 판정한다', async () => {
    const src = live('mobius/sgn_man.js');
    ['request_noti_ws', "require('websocket')", "'ws:'", 'WebSocketClient'].forEach((w) => {
        assert.strictEqual(src.indexOf(w), -1, w + ' 가 되살아났다');
    });
    assert.strictEqual(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').indexOf('"websocket"'), -1,
        'npm 의존성 websocket 이 되살아났다');

    const events = require('events');
    const http = require('http');
    global.NOPRINT = 'true'; global.usecseid = '/Mobius'; global.use_secure = 'disable';
    global.use_mqtt_broker = '127.0.0.1'; global.use_mqtt_port = '1';
    const mqttPath = require.resolve('mqtt');
    require.cache[mqttPath] = { id: mqttPath, filename: mqttPath, loaded: true,
        exports: { connect: () => { const c = new events.EventEmitter(); c.publish = () => {}; c.queue = []; return c; } } };
    const sgn_man = require('../mobius/sgn_man');

    // Sending to a listening port with ws:// does not attempt a connection.
    let connections = 0;
    const srv = http.createServer();
    srv.on('connection', () => { connections++; });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const nu = 'ws://127.0.0.1:' + srv.address().port + '/noti';
    const lines = [];
    const origErr = console.error;
    console.error = (s) => lines.push(String(s));
    try {
        sgn_man.post(nu, 'rqi', '{}', '/M/sub-ws');
        await new Promise((r) => setTimeout(r, 200));
    } finally {
        console.error = origErr;
        srv.close();
    }
    assert.deepStrictEqual(lines.filter((l) => /^\[noti\]/.test(l)),
        ['[noti] fail - sub=/M/sub-ws nu=' + nu + ' (unsupported scheme)']);
    assert.strictEqual(connections, 0, 'ws:// 에 접속을 시도했다');
});
