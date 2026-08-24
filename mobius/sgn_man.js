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

global.NOPRINT = 'true';

/* ─── MQTT 클라이언트 (싱글톤) ─────────────────────────────────────────── */
var sgn_mqtt_client = null;

if (use_secure === 'disable') {
    sgn_mqtt_client = mqtt.connect('mqtt://' + use_mqtt_broker + ':' + use_mqtt_port);
}
else {
    var connectOptions = {
        host: use_mqtt_broker,
        port: use_mqtt_port,
        protocol: 'mqtts',
        keepalive: 10,
        protocolId: 'MQTT',
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 2000,
        connectTimeout: 2000,
        key:  fs.readFileSync('./server-key.pem'),
        cert: fs.readFileSync('./server-crt.pem'),
        rejectUnauthorized: false
    };
    sgn_mqtt_client = mqtt.connect(connectOptions);
}

sgn_mqtt_client.on('connect', function () {
    console.log('sgn_mqtt_client is connected');
});

sgn_mqtt_client.on('error', function (err) {
    console.log('[sgn_mqtt_client] error: ' + (err ? err.message : ''));
    // reconnectPeriod 옵션에 의해 자동 재연결되므로 null로 만들지 않음
});

/* ─── exports.post ───────────────────────────────────────────────────────
 *  Fire-and-forget 방식으로 알림 전송. ACK 대기/재시도 없음.
 *  파라미터: nu, bodytype, rqi, bodyString
 * ─────────────────────────────────────────────────────────────────────── */
exports.post = function (nu, bodytype, rqi, bodyString) {
    try {
        var sub_nu = url.parse(nu);
        if (sub_nu.protocol === 'http:' || sub_nu.protocol === 'https:') {
            request_noti_http(nu, bodyString, bodytype, rqi);
        }
        else if (sub_nu.protocol === 'coap:') {
            request_noti_coap(nu, bodyString, bodytype, rqi);
        }
        else if (sub_nu.protocol === 'ws:') {
            request_noti_ws(nu, bodyString, bodytype, rqi);
        }
        else if (sub_nu.protocol === 'mqtt:') {
            request_noti_mqtt(nu, bodyString, bodytype, rqi);
        }
    }
    catch (e) {
        console.log('[sgn_man] post exception - ' + e.message);
    }
};

/* ─── HTTP / HTTPS ───────────────────────────────────────────────────── */
function request_noti_http(nu, bodyString, bodytype, xm2mri) {
    var parsed = url.parse(nu);
    var options = {
        hostname: parsed.hostname,
        port:     parsed.port,
        path:     parsed.path,
        method:   'POST',
        headers: {
            'X-M2M-RI':       xm2mri,
            'Accept':         'application/' + bodytype,
            'X-M2M-Origin':   usecseid,
            'Content-Type':   'application/' + bodytype,
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

    req.on('error', function (e) {
        console.log('[request_noti_http] error: ' + e.message);
    });

    console.log('<======= [request_noti_http] ' + nu);
    // console.log(bodyString); // 알림 바디 전체 덤프 - 로그 폭주 원인이라 비활성
    req.write(bodyString);
    req.end();
}

/* ─── CoAP ───────────────────────────────────────────────────────────── */
function request_noti_coap(nu, bodyString, bodytype, xm2mri) {
    var parsed = url.parse(nu);
    var options = {
        host:        parsed.hostname,
        port:        parsed.port,
        pathname:    parsed.path,
        method:      'post',
        confirmable: 'false',
        options: {
            'Accept':         'application/' + bodytype,
            'Content-Type':   'application/' + bodytype,
            'Content-Length': Buffer.byteLength(bodyString)
        }
    };

    var req = coap.request(options);
    req.setOption('256', Buffer.from(usecseid));   // X-M2M-Origin
    req.setOption('257', Buffer.from(xm2mri));     // X-M2M-RI

    req.on('error', function (e) {
        console.log('[request_noti_coap] error: ' + e.message);
    });

    console.log('<======= [request_noti_coap] ' + nu);
    // console.log(bodyString); // 알림 바디 전체 덤프 - 로그 폭주 원인이라 비활성
    req.write(bodyString);
    req.end();
}

/* ─── MQTT ───────────────────────────────────────────────────────────── */
function request_noti_mqtt(nu, bodyString, bodytype, xm2mri) {
    try {
        if (!sgn_mqtt_client) {
            console.log('[request_noti_mqtt] client not ready, skip: ' + nu);
            return;
        }
        var aeid       = url.parse(nu).pathname.replace('/', '').split('?')[0];
        var noti_topic = '/oneM2M/req/' + usecseid.replace('/', '') + '/' + aeid + '/' + bodytype;
        sgn_mqtt_client.publish(noti_topic, bodyString);
        console.log('<======= [request_noti_mqtt] publish - ' + noti_topic);
    }
    catch (e) {
        console.log('[request_noti_mqtt] ' + e.message);
    }
}

/* ─── WebSocket ──────────────────────────────────────────────────────── */
function request_noti_ws(nu, bodyString, bodytype, xm2mri) {
    if (use_secure !== 'disable') {
        console.log('[request_noti_ws] secure ws not supported');
        return;
    }

    var WebSocketClient = require('websocket').client;
    var ws_client = new WebSocketClient();

    var subprotocol = 'onem2m.r2.0.json';
    if      (bodytype === 'xml')  { subprotocol = 'onem2m.r2.0.xml';  }
    else if (bodytype === 'cbor') { subprotocol = 'onem2m.r2.0.cbor'; }

    ws_client.connect(nu, subprotocol);

    ws_client.on('connectFailed', function (error) {
        console.log('[request_noti_ws] connectFailed: ' + error.toString());
    });

    ws_client.on('connect', function (conn) {
        console.log('<======= [request_noti_ws] connected - ' + nu);
        conn.on('error', function (error) {
            console.log('[request_noti_ws] conn error: ' + error.toString());
        });
        conn.sendUTF(bodyString);
        conn.close();
    });
}
