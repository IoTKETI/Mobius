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

var fs = require('fs');
var http = require('http');
var https = require('https');
var express = require('express');
var util = require('util');
// 결과 코드는 카탈로그에서 가져온다 — 여기에 숫자를 직접 적지 않는다.
// (ws_response 가 parseInt 로 정규화하므로 예전 숫자 리터럴도 동작은 했다.
//  값이 흩어져 있던 것이 문제였지 버그는 아니었다.)
var RSC = require('./mobius/rsc').RSC;
var url = require('url');
var moment = require('moment');
var ip = require("ip");
var events = require('events');

var WebSocketServer = require('websocket').server;

// 받아 주는 WebSocket 서브프로토콜. 이 CSE 는 json 만 다룬다.
//
// 축약형(onem2m.json)도 넣는다 — 예전에도 목록에는 있었지만, accept 에
// 'onem2m.r2.0.json' 을 주는 바람에 라이브러리가 던져서 한 번도 동작하지
// 않았다. 이제 클라이언트가 요청한 이름을 그대로 accept 하므로 실제로 된다.
//
// onem2m.r2.0.xml / onem2m.xml / onem2m.r2.0.cbor / onem2m.cbor 은 뺐다.
var WS_SUBPROTOCOL = {
    'onem2m.r2.0.json': true,
    'onem2m.json':      true
};

var _server = null;

var _this = this;

var ws_state = 'init';

// ������ �����մϴ�.
var ws_app = express();

var usewscbhost = 'localhost'; // pxyws to mobius

var pxy_ws_server = null;


function originIsAllowed(origin) {
    // put logic here to detect whether the specified origin is allowed.
    return true;
}


exports.ws_watchdog = function() {
    if(ws_state === 'init') {
        if(use_secure === 'disable') {
            http.globalAgent.maxSockets = 1000000;
            _server = http.createServer(ws_app);

            _server.listen({port: usepxywsport, agent: false}, function () {
                console.log('pxyws server (' + ip.address() + ') running at ' + usepxywsport + ' port');

                ws_state = 'connect';
            });
        }
        else {
            var options = {
                key: fs.readFileSync('server-key.pem'),
                cert: fs.readFileSync('server-crt.pem'),
                ca: fs.readFileSync('ca-crt.pem')
            };
            https.globalAgent.maxSockets = 1000000;
            _server = https.createServer(options, ws_app);

            _server.listen({port: usepxywsport, agent: false}, function () {
                console.log('pxyws server (' + ip.address() + ') running at ' + usepxywsport + ' port');

                ws_state = 'connect';
            });
        }
    }
    else if(ws_state === 'connect') {
        http_retrieve_CSEBase(function(status, res_body) {
            if (status == '2000') {
                var jsonObj = JSON.parse(res_body);
                usecseid = jsonObj['m2m:cb'].csi;

                ws_state = 'connecting';
            }
            else {
                console.log('Target CSE(' + usewscbhost + ') is not ready');
            }
        });
    }
    else if(ws_state === 'connecting') {
        if(pxy_ws_server == null) {
            pxy_ws_server = new WebSocketServer({
                httpServer: _server,
                // You should not use autoAcceptConnections for production
                // applications, as it defeats all standard cross-origin protection
                // facilities built into the protocol and the browser.  You should
                // *always* verify the connection's origin and decide whether or not
                // to accept it.
                autoAcceptConnections: false
            });

            ws_state = 'ready';

            pxy_ws_server.on('request', function (request) {
                if (!originIsAllowed(request.origin)) {
                    // Make sure we only accept requests from an allowed origin
                    request.reject();
                    console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
                    return;
                }

                // 이 CSE 는 json 만 다룬다. xml·cbor 서브프로토콜은 받지 않는다.
                //
                // ── 예전 코드의 결함 두 가지 (둘 다 실측으로 재현했다) ──────
                //
                // (1) 축약형 이름을 요청하면 던졌다.
                //     클라이언트가 'onem2m.xml' 을 요청했는데 서버가
                //     'onem2m.r2.0.xml' 로 accept 했다. websocket 라이브러리는
                //     클라이언트가 요청하지 않은 이름을 주면 던진다:
                //       Error: Specified protocol was not requested by the client.
                //     xml·cbor·json 세 분기가 전부 같은 상태였다. **축약형은
                //     한 번도 동작한 적이 없다.**
                //
                // (2) 지원하지 않는 것을 먼저 적으면 두 번 응답했다.
                //     else 에서 reject 한 뒤 break 가 없어 루프가 계속 돌았고,
                //     뒤에 유효한 이름이 있으면 accept 가 또 불렸다:
                //       Error: WebSocketRequest may only be accepted or rejected one time.
                //     ['onem2m.bogus', 'onem2m.r2.0.json'] 으로 재현된다.
                //
                // 프록시는 cluster.isMaster 안에서 require 되므로 여기서 던지면
                // 마스터가 위험하다. 지금은 backstop 이 마스터를 살려 두지만
                // 그 요청은 깨지고 로그만 지저분해진다.
                //
                // 그래서 **고르기와 응답을 분리한다** — 루프에서는 고르기만 하고,
                // accept 든 reject 든 루프 밖에서 정확히 한 번 한다. accept 에는
                // 클라이언트가 요청한 이름을 그대로 준다.
                var chosen = null;
                for (var pi = 0; pi < request.requestedProtocols.length; pi++) {
                    if (WS_SUBPROTOCOL[request.requestedProtocols[pi]]) {
                        chosen = request.requestedProtocols[pi];
                        break;
                    }
                }

                if (chosen === null) {
                    // 400 을 쓴다. 403(기본값)은 "원점이 거부됐다" 로 읽히는데
                    // 여기는 형식 문제다. 이유를 헤더에 담아 되돌린다 —
                    // 핸드셰이크 단계라 본문을 실을 자리가 없다.
                    request.reject(400, 'only json is supported',
                                   { 'X-M2M-RSC': '4000' });
                    console.log((new Date()) + ' 지원하지 않는 서브프로토콜: [' +
                                request.requestedProtocols.join(', ') + '] — json 만 받는다');
                    return;
                }

                let connection = request.accept(chosen, request.origin);
                console.log((new Date()) + ' Connection accepted. (' + chosen + ')');
                connection.on('message', ws_message_handler);
                connection.on('close', function (reasonCode, description) {
                    console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
                });
            });
        }
    }
};

var ws_tid = require('shortid').generate();
var outbound = require('./mobius/outbound');
wdt.set_wdt(ws_tid, 2, _this.ws_watchdog);

function ws_message_handler(message) {
    var _this = this;
    if(message.type === 'utf8') {
        // 예전에는 프레임을 통째로 찍었다. 맥락도 없이 본문만 나갔다.
        // CLAUDE.md 가 금지한다 — 프레임마다 본문을 덤프하면 운영 로그가
        // 밀려 장애 분석이 불가능해진다. 본문에 센서 값이나 개인정보가
        // 들어갈 수도 있다.
        //
        // pxy_mqtt 는 같은 자리에 NOPRINT 가드가 있어 이미 꺼져 있었는데,
        // 이 파일은 그 가드도 없고 global.NOPRINT 를 세우지도 않았다.
        console.log('-----> [pxy_ws] ' + this.protocol +
                    '  ' + message.utf8Data.length + '자');


        make_json_obj(message.utf8Data.toString(), function(rsc, result) {
            if(rsc == '1') {
                ws_message_action(_this, result);
            }
            else {
                ws_response(_this, RSC.BAD_REQUEST.rsc, '', '', '', 'to parsing error');
            }
        });
    }
    else if(message.type === 'binary') {
        // Buffer.from('80', 'hex').toString('utf8');
        // Buffer.from(message).toString('hex');
        //
        // 예전에는 프레임 전체를 hex 로 찍었다. utf8 쪽보다 나쁘다 —
        // 바이트당 두 글자라 로그가 본문의 두 배로 불어난다.
        console.log('-----> [pxy_ws] ' + this.protocol +
                    '  binary ' + message.binaryData.length + '바이트');

        //var data = Buffer.from(message);

        //Array.prototype.map.call(new Uint8Array(data), x => ('00' + x.toString(16)).slice(-2)).join('').match(/[a-fA-F0-9]{2}/g).reverse().join('');


        var str = message.binaryData.toString('hex');
        make_json_obj(str, function(rsc, result) {
            if(rsc == '1') {
                ws_message_action(_this, result);
            }
            else {
                ws_response(_this, RSC.BAD_REQUEST.rsc, '', '', '', 'to parsing error');
            }
        });

    }
}

// bodytype 인자를 걷어냈다 — 핸드셰이크가 json 서브프로토콜 둘만
// 받으므로(WS_SUBPROTOCOL) 값이 언제나 json 이었다.
function ws_message_action(ws_conn, jsonObj) {
    if (jsonObj['m2m:rqp'] != null) {
        console.log('m2m:rqp tag of ws message is removed');

        var res_body = {};
        res_body['m2m:dbg'] = 'm2m:rqp tag of ws message is removed';

        // 예전에는 JSON.parse(res_body) 였다. res_body 는 바로 위에서 만든
        // 객체라 String() 이 '[object Object]' 가 되어 *언제나* SyntaxError 였다.
        // 이 오류 응답은 한 번도 나간 적이 없고, 대신 예외가 그대로 올라가
        // pxy_ws 를 require 한 cluster 마스터를 죽였다.
        // ws_response 의 inpc 인자는 객체로 쓰이므로 그대로 넘긴다.
        ws_response(ws_conn, RSC.BAD_REQUEST.rsc, "", usecseid, "", res_body);
    }
    else {
        var op = (jsonObj.op == null) ? '' : jsonObj.op;
        var to = (jsonObj.to == null) ? '' : jsonObj.to;

        to = to.replace(usespid + usecseid + '/', '/');
        to = to.replace(usecseid + '/', '/');

        if(to.charAt(0) != '/') {
            to = '/' + to;
        }

        var fr = (jsonObj.fr == null) ? '' : jsonObj.fr;
        var rqi = (jsonObj.rqi == null) ? '' : jsonObj.rqi;
        var ty = (jsonObj.ty == null) ? '' : jsonObj.ty.toString();
        var pc = (jsonObj.pc == null) ? '' : jsonObj.pc;

        if(jsonObj.fc) {
            var query_count = 0;
            for(var fc_idx in jsonObj.fc) {
                if(jsonObj.fc.hasOwnProperty(fc_idx)) {
                    if(query_count == 0) {
                        to += '?';
                        query_count++;
                    }
                    else {
                        to += '&';
                        query_count++;
                    }
                    to += fc_idx;
                    to += '=';
                    to += jsonObj.fc[fc_idx].toString();
                }
            }
        }

        try {
            //if (to.split('/')[1].split('?')[0] == usecsebase) {
                ws_binding(op, to, fr, rqi, ty, pc, function (res, res_body) {
                    if (res_body == '') {
                        res_body = '{}';
                    }
                    // 아래 try/catch 는 이 콜백을 감싸지 못한다. 콜백은 ws_binding 의
                    // res.on('end') 안에서 나중에 도는데, 그때 바깥 try 는 이미
                    // 빠져나간 뒤다. 여기서 던지면 pxy_ws 를 require 한 cluster
                    // 마스터가 죽고, 워커 재시작 로직까지 함께 사라진다.
                    var pc_obj;
                    try {
                        pc_obj = JSON.parse(res_body);
                    }
                    catch (e) {
                        console.error('[pxy_ws] 응답 본문이 JSON 이 아니다 (' + to + '): ' + e.message);
                        ws_response(ws_conn, RSC.INTERNAL_SERVER_ERROR.rsc, to, usecseid, rqi,
                                    { 'm2m:dbg': 'response body is not valid JSON' });
                        return;
                    }
                    ws_response(ws_conn, res.headers['x-m2m-rsc'], to, usecseid, rqi, pc_obj);
                });
            // }
            // else {
            //     ws_response(ws_conn, 4004, fr, usecseid, rqi, 'this is not MN-CSE, csebase do not exist', bodytype);
            // }
        }
        catch (e) {
            console.error(e);
            ws_response(ws_conn, RSC.INTERNAL_SERVER_ERROR.rsc, fr, usecseid, rqi, 'to parsing error');
        }
    }
}

function ws_binding(op, to, fr, rqi, ty, pc, callback) {
    var content_type = 'application/vnd.onem2m-res+json';

    switch (op.toString()) {
        case '1':
            op = 'post';
            content_type += ('; ty=' + ty);
            break;
        case '2':
            op = 'get';
            break;
        case '3':
            op = 'put';
            break;
        case '4':
            op = 'delete';
            break;
    }

    var reqBodyString = '';
    if( op == 'post' || op == 'put') {
        reqBodyString = JSON.stringify(pc);
    }

    var bodyStr = '';

    var options = {
        hostname: usewscbhost,
        port: usecsebaseport,
        path: to,
        method: op,
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': fr,
            'Content-Type': content_type,
            'binding': 'W',
            'X-M2M-RVI': uservi
        },
        rejectUnauthorized: false
    };

    if(use_secure == 'disable') {
        var req = http.request(options, function (res) {
            res.setEncoding('utf8');

            res.on('data', function (chunk) {
                bodyStr += chunk;
            });

            res.on('end', function () {
                callback(res, bodyStr);
            });
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');

        req = https.request(options, function (res) {
            res.setEncoding('utf8');

            res.on('data', function (chunk) {
                bodyStr += chunk;
            });

            res.on('end', function () {
                callback(res, bodyStr);
            });
        });
    }

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'pxy_ws -> mobius');
    req.on('error', function (e) {
        console.log('[pxyws_binding] problem with request: ' + e.message);
    });

    // write data to request body

    //console.log(options);
    //console.log(reqBodyString);

    req.write(reqBodyString);
    req.end();
}

function ws_response(ws_conn, rsc, to, fr, rqi, inpc) {
    var rsp_message = {};
    rsp_message['m2m:rsp'] = {};
    //rsp_message['m2m:rsp'].rsc = rsc;
    rsp_message['m2m:rsp'].rsc = parseInt(rsc); // convert to int
    //rsp_message['m2m:rsp'].to = to;
    //rsp_message['m2m:rsp'].fr = fr;

    rsp_message['m2m:rsp'].rqi = rqi;
    rsp_message['m2m:rsp'].rvi = uservi;
    rsp_message['m2m:rsp'].pc = inpc;

    ws_conn.sendUTF(JSON.stringify(rsp_message['m2m:rsp']));
}

function http_retrieve_CSEBase(callback) {
    var rqi = require('shortid').generate();
    var resourceid = '/' + usecsebase;
    var responseBody = '';

    if(use_secure == 'disable') {
        var options = {
            hostname: usewscbhost,
            port: usecsebaseport,
            path: resourceid,
            method: 'get',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/json',
                'X-M2M-Origin': usecseid,
                'X-M2M-RVI': uservi
            }
        };

        var req = http.request(options, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }
    else {
        options = {
            hostname: usewscbhost,
            port: usecsebaseport,
            path: resourceid,
            method: 'get',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/json',
                'X-M2M-Origin': usecseid,
                'X-M2M-RVI': uservi
            },
            ca: fs.readFileSync('ca-crt.pem')
        };

        req = https.request(options, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'pxy_ws -> mobius');
    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            //console.log('[pxyws - http_retrieve_CSEBase] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write('');
    req.end();
}
