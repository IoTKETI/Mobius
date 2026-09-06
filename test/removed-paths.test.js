'use strict';
/**
 * 도달 불가하거나 부르는 곳이 없던 경로를 지운 결정의 기록 (2026-09-06, 남은 일 §5.6).
 *
 * 1. AE 알림 중계 — POST 본문이 m2m:sgn 이고 대상이 AE 면 그 AE 의 poa 로 전달하던 경로
 *    (check_notification 의 notify 갈래 → check_ae_notify → notify_http → settle.raw).
 *    앞의 check_resource_supported 가 m2m:sgn 을 400-3 으로 먼저 끊어 도달할 수 없었고,
 *    그 기능을 쓸 원격 CSE 가 배포에 없다(csr 0행, 3일간 시도 0). 되살릴 때 새로 만든다.
 * 2. 구독 검증 요청(check_value 256, vrq) — 부르는 곳이 없었다. 검증을 구현하면 배포
 *    구독자(MQTT 로 받는 GCS 등)가 답하지 않을 때 구독 생성이 깨진다. 지원하지 않는다.
 * 3. acor_allows · evaluate_acr 는 남긴다 — 시험이 보는 계약이고 비용이 없다.
 * 4. WS 알림(sgn_man 의 request_noti_ws · post 의 ws 분기 · npm websocket) — 2026-09-06,
 *    남은 일 §8. 배포 3년치 ws nu 0건(sub 3,463 · ae/csr poa 모두 0). 101 을 안 주는 상대에
 *    타임아웃이 없어 소켓이 남는 결함이 있었고, 타임아웃을 넣었다가(7fed365) 사용자 결정으로
 *    경로째 지웠다. ws:// nu 는 이제 "받을 놈이 없는" 구독이다(unsupported scheme).
 *
 * 이 시험은 그 경로가 조용히 되살아나는 것을 막는다. 되살리려면 이 파일을 고쳐야 하고,
 * 그때 위 근거를 다시 본다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
function live(rel) {
    // 줄 주석을 먼저 걸러낸다 — 그 안에 우연히 '/*' 가 들어 있으면(예: 경로
    // 와일드카드 '/api/stats/*') 블록 주석 제거가 먼저 돌 때 다음 실제 '*/' 까지
    // 실코드를 통째로 삼켜 버린다(실측: 156줄, app.js). 순서를 바꾸면 안전하다.
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

test('AE 알림 중계 경로가 없다 — check_ae_notify · notify_http · notify 갈래', () => {
    const app = live('app.js');
    ['check_ae_notify', 'notify_http', 'check_notification', "'notify'", "settle.raw('ae notify'"].forEach((w) => {
        assert.strictEqual(app.indexOf(w), -1, w + ' 가 되살아났다');
    });
    // POST 는 ty 가 있어야 한다 — 남은 판정은 둘(Content-Type 없음 400-20 · ty 없음 400-19)
    assert.match(app, /function check_post_content_type\(request, callback\)/);
    assert.match(app, /check_post_content_type\(request, \(code\) => \{\s*if \(code === '200'\) \{\s*run_operation\(request, response, settle, 'POST', lookup_create\);/);
    // 그 경로의 사유 일곱도 없다
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
    // forward_http 는 지워진 경로의 404-7("AE for notification does not exist")을 빌려 쓰고
    // 있었다. 상류가 답하지 않은 것이니 TARGET_NOT_REACHABLE(5103/404) 이 맞다.
    const reason = require('../mobius/reason');
    assert.strictEqual(reason.REASON['404-10'].code.name, 'TARGET_NOT_REACHABLE');
    const app = live('app.js');
    const at = app.indexOf('function forward_http(');
    assert.ok(at > 0);
    assert.ok(/callback\('404-10'\)/.test(app.slice(at, at + 3000)), 'forward_http 가 404-10 을 쓰지 않는다');
});

// sgn_man 을 실제로 로드한다 — require 만으로 MQTT 클라이언트를 열어 브로커가 없으면
// 재접속이 프로세스를 붙들므로, mqtt 를 require.cache 에 스텁으로 심고 나서 로드한다.
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

    // 듣고 있는 포트에 ws:// 로 보내도 접속을 시도하지 않는다
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
