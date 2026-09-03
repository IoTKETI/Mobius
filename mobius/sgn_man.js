/**
 * Copyright (c) 2018, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var fs   = require('fs');
var http = require('http');
var https = require('https');
var mqtt = require('mqtt');
var coap = require('coap');
var url  = require('url');
var outbound = require('./outbound');

global.NOPRINT = 'true';

/* ─── MQTT 클라이언트 (싱글톤) ─────────────────────────────────────────────
 *
 * ── 옵션은 한 곳에서만 만든다 ────────────────────────────────────────────
 * 예전에는 use_secure 분기마다 따로 만들었는데, **쓰는 쪽에 설정이 없고
 * 안 쓰는 쪽에 있었다.** 배포는 'disable' 인데 그쪽은 URL 문자열만 넘겨
 * 라이브러리 기본값(keepalive 60초)으로 돌았고, keepalive 10초·
 * reconnectPeriod 2초는 쓰지 않는 'enable' 분기에만 적혀 있었다.
 *
 * keepalive 가 60초면 브로커가 조용히 사라졌을 때 그것을 알아채기까지
 * 최악 60초가 걸리고, 그동안 발행은 전부 아래 큐로 들어간다.
 *
 * ── 끊긴 동안 쌓지 않는다 (queueQoSZero: false) ──────────────────────────
 * mqtt.js 는 연결이 끊긴 동안 QoS 0 발행을 **크기 제한이 없는 배열**에
 * 쌓는다. 2.18.9 도 5.15.2 도 같고, queueLimit 같은 옵션은 없다.
 *
 *   _sendPacket: if (!this.connected) {
 *       if ((qos === 0 && this.queueQoSZero) || cmd !== 'publish')
 *           this.queue.push({ packet, cb })     // <- 상한 없음
 *
 * 배포 실측으로 알림은 하루 약 11만건(초당 2.8건), 본문 약 1KB 다.
 * 브로커가 한 시간 죽어 있으면 워커당 수 MB 이고 워커는 25개다.
 * 그리고 실제로 죽는다 — 2026-09-03 11:42 에 systemd 가 SIGABRT 로
 * mosquitto 를 죽였다(SIGTERM 에 응답하지 않아서).
 *
 * 쌓아서 나중에 보내는 것이 좋아 보이지만 그렇지 않다.
 *   - 알림은 이미 fire-and-forget 이다. ACK·재시도·타임아웃이 전부 없다
 *   - QoS 0 이라 구독자는 **버려진 것과 유실된 것을 구분할 수 없다**
 *   - 센서 데이터는 늦게 도착하면 값이 없다. 20시간 뒤에 오는 11만건은
 *     도움이 아니라 부담이다
 * 그래서 버린다. 대신 **버린 것을 센다**(아래 publish 콜백).
 */
var MQTT_OPTIONS = {
    host: use_mqtt_broker,
    port: use_mqtt_port,
    protocol: (use_secure === 'disable') ? 'mqtt' : 'mqtts',
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    keepalive: 10,
    reconnectPeriod: 2000,
    connectTimeout: 2000,
    queueQoSZero: false
};

if (use_secure !== 'disable') {
    MQTT_OPTIONS.key  = fs.readFileSync('./server-key.pem');
    MQTT_OPTIONS.cert = fs.readFileSync('./server-crt.pem');
    MQTT_OPTIONS.rejectUnauthorized = false;
}

var sgn_mqtt_client = mqtt.connect(MQTT_OPTIONS);

sgn_mqtt_client.on('connect', function () {
    console.log('sgn_mqtt_client is connected');
});

sgn_mqtt_client.on('error', function (err) {
    console.log('[sgn_mqtt_client] error: ' + (err ? err.message : ''));
    // reconnectPeriod 옵션에 의해 자동 재연결되므로 null로 만들지 않음
});

/* ── 단절을 보이게 한다 ───────────────────────────────────────────────────
 *
 * 리스너가 connect 와 error 둘뿐이었다. 그런데 브로커가 끊길 때 나오는 것은
 * 'offline' / 'close' 이고 'error' 가 아니다. 배포 로그가 그것을 보여 준다 —
 *
 *   [sgn_mqtt_client] error        0건
 *   sgn_mqtt_client is connected   400건   (워커 25개 x 16회 재연결)
 *
 * 재연결이 워커당 16번 있었는데 error 는 한 줄도 없었다. 즉 **끊겨서 알림을
 * 못 보내는 동안 로그에 아무 흔적이 없었다.**
 *
 * queue.length 를 같이 찍는다. queueQoSZero: false 라 0 이어야 정상이고,
 * 0 이 아니면 publish 가 아닌 패킷(subscribe 등)이 밀린 것이다.
 */
sgn_mqtt_client.on('offline', function () {
    console.error('[sgn_mqtt_client] offline — 브로커와 끊겼다. ' +
                  '재연결까지 오는 알림은 버려진다 (queue=' +
                  (sgn_mqtt_client.queue ? sgn_mqtt_client.queue.length : '?') + ')');
});

sgn_mqtt_client.on('close', function () {
    console.error('[sgn_mqtt_client] close — 연결이 닫혔다');
});

sgn_mqtt_client.on('reconnect', function () {
    console.error('[sgn_mqtt_client] reconnect — 재연결 시도 (queue=' +
                  (sgn_mqtt_client.queue ? sgn_mqtt_client.queue.length : '?') + ')');
});

/* ─── 알림 결과 판정 ─────────────────────────────────────────────────────
 *
 * 여기까지는 "알림이 나갔는지" 를 판정하는 코드가 한 줄도 없었다.
 * HTTP 는 'response' 리스너가 없어 수신자가 500 을 줘도 성공과 구분되지 않았고,
 * 실패 로그에는 어느 구독인지가 없어 역추적조차 안 됐다.
 *
 * 그래서 운영자가 "안 쓰는 구독 / 못 보내는 구독" 을 물어도 답할 데이터가
 * 없었다. 이 단계는 **판정만** 한다 — 저장도, 정책도, 자동 삭제도 없다.
 * 스키마를 바꾸지 않고 로그만 정확하게 만드는 것이 목적이다.
 *
 * 결과는 네 갈래다.
 *   ok       2xx 이고 X-M2M-RSC 가 없거나 2xxx
 *   reject   2xx 인데 RSC 가 4xxx/5xxx — 수신자가 받긴 했으나 거부했다.
 *            설정이 어긋난 것이지 "못 보내는 구독" 이 아니다. 구분해야 한다.
 *   fail     4xx/5xx, 또는 연결 자체가 안 됨
 *   unknown  판정할 수 없는 프로토콜(MQTT QoS0, WS) — '실패' 로 세면 안 된다
 */
var NOTI_OK = 'ok';
var NOTI_REJECT = 'reject';
var NOTI_FAIL = 'fail';
var NOTI_UNKNOWN = 'unknown';

// 어느 구독의 어느 수신처였는지가 로그의 전부다.
// ri 는 sgn_action_send 가 이미 인자로 들고 있던 값이라 추가 조회가 없다.
function noti_result(kind, proto, nu, ri, detail) {
    var line = '[noti] ' + kind + ' ' + proto +
               ' sub=' + (ri || '?') + ' nu=' + nu +
               (detail ? ' (' + detail + ')' : '');
    if (kind === NOTI_OK) { console.log(line); }
    else { console.error(line); }
}

/* ─── exports.post ───────────────────────────────────────────────────────
 *  Fire-and-forget 방식으로 알림 전송. ACK 대기/재시도 없음.
 *  파라미터: nu, rqi, bodyString, ri(구독 ri — 로그 역추적용)
 * ─────────────────────────────────────────────────────────────────────── */
// bodytype 인자를 걷어냈다 (2026-09-01). 알림은 언제나 json 이다 —
// sgn.js 가 그 자리에 'json' 리터럴을 넘기고 있었다. 값이 하나뿐인
// 인자는 형식이 아직 선택 가능한 것처럼 보이게 한다.
exports.post = function (nu, rqi, bodyString, ri) {
    try {
        var sub_nu = url.parse(nu);
        if (sub_nu.protocol === 'http:' || sub_nu.protocol === 'https:') {
            request_noti_http(nu, bodyString, rqi, ri);
        }
        else if (sub_nu.protocol === 'coap:') {
            request_noti_coap(nu, bodyString, rqi, ri);
        }
        else if (sub_nu.protocol === 'ws:') {
            request_noti_ws(nu, bodyString, rqi, ri);
        }
        else if (sub_nu.protocol === 'mqtt:') {
            request_noti_mqtt(nu, bodyString, rqi, ri);
        }
        else {
            // 네 분기 어디에도 안 걸리면 조용히 사라졌다. get_nu_arr 이 풀지 못한
            // ID 형식 nu 가 여기로 온다 — 정확히 "받을 놈이 없는" 구독이다.
            noti_result(NOTI_FAIL, '-', nu, ri, 'unsupported scheme');
        }
    }
    catch (e) {
        noti_result(NOTI_FAIL, '-', nu, ri, 'post exception: ' + e.message);
    }
};

/* ─── HTTP / HTTPS ───────────────────────────────────────────────────── */
function request_noti_http(nu, bodyString, xm2mri, ri) {
    var parsed = url.parse(nu);
    var options = {
        hostname: parsed.hostname,
        port:     parsed.port,
        path:     parsed.path,
        method:   'POST',
        headers: {
            'X-M2M-RI':       xm2mri,
            'Accept':         'application/json',
            'X-M2M-Origin':   usecseid,
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(bodyString)
        }
    };

    var req;
    if (parsed.protocol === 'http:') {
        req = http.request(options);
    }
    else {
        options.rejectUnauthorized = false;
        req = https.request(options);
    }

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'notify http ' + (ri || nu));

    req.on('response', function (res) {
        // **res.resume() 이 이 코드의 유일한 함정이다.**
        // 리스너를 붙이고 본문을 소비하지 않으면 소켓이 풀리지 않아,
        // 정상 응답을 받은 요청도 arm 타임아웃(기본 10초)까지 붙잡혀 있다가
        // 가짜 '응답이 오지 않아 끊는다' 로그를 남긴다. 개선이 아니라 장애가 된다.
        res.resume();

        var status = res.statusCode;
        var rsc = res.headers['x-m2m-rsc'];

        if (status >= 200 && status < 300) {
            // 수신자가 받긴 했는데 oneM2M 수준에서 거부한 경우가 있다.
            // 이건 "못 보내는 구독" 이 아니라 설정이 어긋난 것이므로 갈라 둔다.
            if (rsc && !/^2\d{3}$/.test(String(rsc))) {
                noti_result(NOTI_REJECT, 'http', nu, ri, 'rsc=' + rsc);
            }
            else {
                noti_result(NOTI_OK, 'http', nu, ri, rsc ? 'rsc=' + rsc : '');
            }
        }
        else {
            noti_result(NOTI_FAIL, 'http', nu, ri, 'status=' + status + (rsc ? ' rsc=' + rsc : ''));
        }
    });

    req.on('error', function (e) {
        // keep-alive 재사용 소켓의 정상 종료를 실패로 세면 안 된다.
        // Node 의 globalAgent 는 keepAlive 가 기본 true 라(실측: timeout 5000)
        // 수신자가 자기 idle 타임아웃으로 먼저 닫으면 다음 알림이 ECONNRESET 으로
        // 떨어진다. 수신자는 멀쩡한데 실패로 쌓이면 판정이 통째로 어긋난다.
        if (req.reusedSocket && e.code === 'ECONNRESET') {
            noti_result(NOTI_UNKNOWN, 'http', nu, ri, 'keep-alive 소켓 재사용 실패 — 재시도 대상');
            return;
        }
        noti_result(NOTI_FAIL, 'http', nu, ri, e.code || e.message);
    });

    console.log('<======= [request_noti_http] ' + nu);
    // console.log(bodyString); // 알림 바디 전체 덤프 - 로그 폭주 원인이라 비활성
    req.write(bodyString);
    req.end();
}

/* ─── CoAP ───────────────────────────────────────────────────────────── */
function request_noti_coap(nu, bodyString, xm2mri, ri) {
    var parsed = url.parse(nu);
    var options = {
        host:        parsed.hostname,
        port:        parsed.port,
        pathname:    parsed.path,
        method:      'post',
        // 'false' 는 **문자열**이라 node-coap 의 `!== false` 검사를 통과한다.
        // 즉 실제로는 CON 으로 나가고 재전송까지 하고 있다. 이름과 동작이
        // 다르지만 지금 그 재전송에 기대고 있으므로 건드리지 않는다 —
        // boolean false 로 '고치면' 재전송이 사라진다.
        confirmable: 'false',
        options: {
            'Accept':         'application/json',
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(bodyString)
        }
    };

    var req = coap.request(options);
    req.setOption('256', Buffer.from(usecseid));   // X-M2M-Origin
    req.setOption('257', Buffer.from(xm2mri));     // X-M2M-RI

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'notify coap ' + (ri || nu));

    req.on('response', function (res) {
        // CoAP 응답 코드는 '2.04' 같은 문자열이다. 2.xx 가 성공이다.
        // node-coap 은 agent 가 UDP 소켓 하나를 공유하므로 요청당 FD 가 늘지 않는다.
        var code = String(res.code || '');
        if (/^2\./.test(code)) { noti_result(NOTI_OK, 'coap', nu, ri, 'code=' + code); }
        else { noti_result(NOTI_FAIL, 'coap', nu, ri, 'code=' + code); }
    });

    req.on('error', function (e) {
        noti_result(NOTI_FAIL, 'coap', nu, ri, e.code || e.message);
    });

    console.log('<======= [request_noti_coap] ' + nu);
    // console.log(bodyString); // 알림 바디 전체 덤프 - 로그 폭주 원인이라 비활성
    req.write(bodyString);
    req.end();
}

/* ─── MQTT ───────────────────────────────────────────────────────────── */
function request_noti_mqtt(nu, bodyString, xm2mri, ri) {
    try {
        if (!sgn_mqtt_client) {
            noti_result(NOTI_FAIL, 'mqtt', nu, ri, 'client not ready');
            return;
        }
        var aeid       = url.parse(nu).pathname.replace('/', '').split('?')[0];
        var noti_topic = '/oneM2M/req/' + usecseid.replace('/', '') + '/' + aeid + '/json';

        // **콜백을 준다.** 예전에는 publish(topic, body) 로만 불러서, 브로커가
        // 끊겨 발행이 안 되어도 아래 UNKNOWN 한 줄만 남았다 — 정상일 때와
        // 로그가 똑같았다.
        //
        // queueQoSZero: false 와 짝이다. 끊긴 상태에서 mqtt.js 가
        // cb(new Error('No connection to broker')) 를 준다. 실측으로 확인했다:
        //   queueQoSZero true  -> queue 에 쌓이고 콜백은 안 불린다
        //   queueQoSZero false -> queue 0, 콜백에 err 가 온다
        sgn_mqtt_client.publish(noti_topic, bodyString, function (err) {
            if (err) {
                noti_result(NOTI_FAIL, 'mqtt', nu, ri, '발행 실패: ' + err.message);
                return;
            }
            // 여기까지 왔다는 것은 소켓에 썼다는 뜻이다. QoS 0 이라 브로커가
            // 받았는지도 알 수 없고, 받았다 해도 구독자에게 닿았는지는
            // MQTT 3.1.1 에 알 방법이 없다. '실패' 로 세면 멀쩡한 구독이 죽은
            // 것으로 보이므로 '판정 불가' 로 둔다.
            noti_result(NOTI_UNKNOWN, 'mqtt', nu, ri, 'QoS0 — 전달 확인 불가');
        });
    }
    catch (e) {
        noti_result(NOTI_FAIL, 'mqtt', nu, ri, e.message);
    }
}

/* ─── WebSocket ──────────────────────────────────────────────────────── */
function request_noti_ws(nu, bodyString, xm2mri, ri) {
    if (use_secure !== 'disable') {
        noti_result(NOTI_FAIL, 'ws', nu, ri, 'secure ws not supported');
        return;
    }

    var WebSocketClient = require('websocket').client;
    var ws_client = new WebSocketClient();

    // xml/cbor 서브프로토콜 분기를 걷어냈다. 도달할 수 없었다 —
    // sgn.js 가 'json' 리터럴을 넘겼고, pxy_ws 의 WS_SUBPROTOCOL 도
    // json 둘만 받으므로 상대가 우리면 그 이름으로는 붙지도 못한다.
    var subprotocol = 'onem2m.r2.0.json';

    ws_client.connect(nu, subprotocol);

    ws_client.on('connectFailed', function (error) {
        // 접속 자체가 안 된 것은 확실한 실패다 — 수신자가 사라졌다는 뜻이다.
        noti_result(NOTI_FAIL, 'ws', nu, ri, 'connectFailed: ' + error.message);
    });

    ws_client.on('connect', function (conn) {
        console.log('<======= [request_noti_ws] connected - ' + nu);
        conn.on('error', function (error) {
            noti_result(NOTI_FAIL, 'ws', nu, ri, 'conn error: ' + error.message);
        });
        conn.sendUTF(bodyString);

        // 보내자마자 닫으므로 수신자가 처리했는지는 알 수 없다.
        // 접속이 됐다는 것까지만 확실하다.
        noti_result(NOTI_UNKNOWN, 'ws', nu, ri, '접속됨 — 처리 확인 불가');
        conn.close();
    });
}
