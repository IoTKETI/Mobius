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

/*
 * MQTT client (singleton).
 *
 * All options are built here. queueQoSZero: false means publishes issued while the broker is unreachable are dropped instead of being queued without bound; the publish callback counts them.
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
    // reconnectPeriod makes the client reconnect on its own; the reference is kept.
});

/* Connection loss is made visible: the broker going away produces 'offline' / 'close', not 'error'. queue.length is logged; with queueQoSZero: false it is 0 unless non-publish packets are pending. */
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

/*
 * Notification result classification. Results are logged only; nothing is stored and no policy is applied.
 *
 *   ok       2xx and no X-M2M-RSC or a 2xxx one
 *   reject   2xx but RSC 4xxx/5xxx: the receiver got it and refused it (misconfiguration, not an unreachable subscriber)
 *   fail     4xx/5xx, or no connection at all
 *   unknown  protocol that cannot be judged (MQTT QoS 0)
 */
var NOTI_OK = 'ok';
var NOTI_REJECT = 'reject';
var NOTI_FAIL = 'fail';
var NOTI_UNKNOWN = 'unknown';

// Which subscription and which receiver; ri is the subscription ri passed down by sgn_action_send.
function noti_result(kind, proto, nu, ri, detail) {
    var line = '[noti] ' + kind + ' ' + proto +
               ' sub=' + (ri || '?') + ' nu=' + nu +
               (detail ? ' (' + detail + ')' : '');
    if (kind === NOTI_OK) { console.log(line); }
    else { console.error(line); }
}

/*
 * exports.post: fire-and-forget delivery, no ACK wait and no retry.
 * Parameters: nu, rqi, bodyString, ri (subscription ri, for the log line)
 */
exports.post = function (nu, rqi, bodyString, ri) {
    try {
        var sub_nu = url.parse(nu);
        if (sub_nu.protocol === 'http:' || sub_nu.protocol === 'https:') {
            request_noti_http(nu, bodyString, rqi, ri);
        }
        else if (sub_nu.protocol === 'coap:') {
            request_noti_coap(nu, bodyString, rqi, ri);
        }
        else if (sub_nu.protocol === 'mqtt:') {
            request_noti_mqtt(nu, bodyString, rqi, ri);
        }
        else {
            // Unsupported scheme, including ID-form nu that nu_resolve could not resolve and ws://.
            noti_result(NOTI_FAIL, '-', nu, ri, 'unsupported scheme');
        }
    }
    catch (e) {
        noti_result(NOTI_FAIL, '-', nu, ri, 'post exception: ' + e.message);
    }
};

/* HTTP / HTTPS */
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

    // Cut the request when no response arrives; destroying it triggers the error handler below.
    outbound.arm(req, 'notify http ' + (ri || nu));

    req.on('response', function (res) {
        // res.resume() is required: without consuming the body the socket is not released and the request would be held until the arm timeout.
        res.resume();

        var status = res.statusCode;
        var rsc = res.headers['x-m2m-rsc'];

        if (status >= 200 && status < 300) {
            // The receiver accepted the request but refused it at the oneM2M level; a misconfiguration, not an unreachable subscriber.
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
        // A normal close of a reused keep-alive socket must not count as a failure; the receiver may close idle sockets first, which surfaces as ECONNRESET on the next notification.
        if (req.reusedSocket && e.code === 'ECONNRESET') {
            noti_result(NOTI_UNKNOWN, 'http', nu, ri, 'keep-alive 소켓 재사용 실패 — 재시도 대상');
            return;
        }
        noti_result(NOTI_FAIL, 'http', nu, ri, e.code || e.message);
    });

    console.log('<======= [request_noti_http] ' + nu);
    req.write(bodyString);
    req.end();
}

/* CoAP */
function request_noti_coap(nu, bodyString, xm2mri, ri) {
    var parsed = url.parse(nu);
    var options = {
        host:        parsed.hostname,
        port:        parsed.port,
        pathname:    parsed.path,
        method:      'post',
        // 'false' is a string, so node-coap's `!== false` check sends CON with retransmission; the current behaviour relies on that.
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

    // Cut the request when no response arrives; destroying it triggers the error handler below.
    outbound.arm(req, 'notify coap ' + (ri || nu));

    req.on('response', function (res) {
        // CoAP response codes are strings like '2.04'; 2.xx is success. node-coap shares one UDP socket per agent, so requests do not consume file descriptors.
        var code = String(res.code || '');
        if (/^2\./.test(code)) { noti_result(NOTI_OK, 'coap', nu, ri, 'code=' + code); }
        else { noti_result(NOTI_FAIL, 'coap', nu, ri, 'code=' + code); }
    });

    req.on('error', function (e) {
        noti_result(NOTI_FAIL, 'coap', nu, ri, e.code || e.message);
    });

    console.log('<======= [request_noti_coap] ' + nu);
    req.write(bodyString);
    req.end();
}

/* MQTT */
function request_noti_mqtt(nu, bodyString, xm2mri, ri) {
    try {
        if (!sgn_mqtt_client) {
            noti_result(NOTI_FAIL, 'mqtt', nu, ri, 'client not ready');
            return;
        }
        var aeid       = url.parse(nu).pathname.replace('/', '').split('?')[0];
        var noti_topic = '/oneM2M/req/' + usecseid.replace('/', '') + '/' + aeid + '/json';

        // The publish callback distinguishes a failed publish from a successful write: with queueQoSZero: false, mqtt.js calls back with an error while the broker is unreachable.
        sgn_mqtt_client.publish(noti_topic, bodyString, function (err) {
            if (err) {
                noti_result(NOTI_FAIL, 'mqtt', nu, ri, '발행 실패: ' + err.message);
                return;
            }
            // The message was written to the socket. With QoS 0 there is no way to know whether the broker or the subscriber received it, so the result is 'unknown', not 'fail'.
            noti_result(NOTI_UNKNOWN, 'mqtt', nu, ri, 'QoS0 — 전달 확인 불가');
        });
    }
    catch (e) {
        noti_result(NOTI_FAIL, 'mqtt', nu, ri, e.message);
    }
}
