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
var mqtt = require('mqtt');
var util = require('util');
var url = require('url');
var moment = require('moment');
var RSC = require('./mobius/rsc').RSC;
var ip = require("ip");

var responder = require('./mobius/responder');

//var resp_mqtt_client_arr = [];
//var req_mqtt_client_arr = [];
var resp_mqtt_rqi_arr = [];

var http_response_q = {};

global.NOPRINT = 'true';


var _this = this;

var mqtt_state = 'init';
//var custom = new process.EventEmitter();
var events = require('events');
//var mqtt_custom = new events.EventEmitter();

// ������ �����մϴ�.
var mqtt_app = express();


var usemqttcbhost = 'localhost'; // pxymqtt to mobius



//var cache_limit = 64;
var cache_ttl = 3; // count
var cache_keep = 10; // sec
var message_cache = {};


var pxymqtt_client = null;

//mqtt_custom.on('mqtt_watchdog', function() {
exports.mqtt_watchdog = function() {
    if(mqtt_state === 'init') {
        if(use_secure === 'disable') {
            http.globalAgent.maxSockets = 1000000;
            http.createServer(mqtt_app).listen({port: usepxymqttport, agent: false}, function () {
                NOPRINT==='true'?NOPRINT='true':console.log('pxymqtt server (' + ip.address() + ') running at ' + usepxymqttport + ' port');

                mqtt_state = 'connect';
            });
        }
        else {
            var options = {
                key: fs.readFileSync('server-key.pem'),
                cert: fs.readFileSync('server-crt.pem'),
                ca: fs.readFileSync('ca-crt.pem')
            };
            https.globalAgent.maxSockets = 1000000;
            https.createServer(options, mqtt_app).listen({port: usepxymqttport, agent: false}, function () {
                console.log('pxymqtt server (' + ip.address() + ') running at ' + usepxymqttport + ' port');

                mqtt_state = 'connect';
            });
        }
    }
    else if(mqtt_state === 'connect') {
        http_retrieve_CSEBase(function(rsc, res_body) {
            if (rsc == '2000') {
                var jsonObj = JSON.parse(res_body);
                if(jsonObj.hasOwnProperty('m2m:cb')) {
                    usecseid = jsonObj['m2m:cb'].csi;

                    mqtt_state = 'connecting';
                }
                else {
                    console.log('CSEBase tag is none');
                }
            }
            else {
                console.log('Target CSE(' + usemqttcbhost + ') is not ready');
            }
        });
    }
    else if(mqtt_state === 'connecting') {
        if(pxymqtt_client == null) {
            if(use_secure === 'disable') {
                pxymqtt_client = mqtt.connect('mqtt://' + use_mqtt_broker + ':' + use_mqtt_port);
            }
            else {
                var connectOptions = {
                    host: use_mqtt_broker,
                    port: use_mqtt_port,
                    protocol: "mqtts",
                    keepalive: 10,
       //             clientId: serverUID,
                    protocolId: "MQTT",
                    protocolVersion: 4,
                    clean: true,
                    reconnectPeriod: 2000,
                    connectTimeout: 2000,
                    key: fs.readFileSync("./server-key.pem"),
                    cert: fs.readFileSync("./server-crt.pem"),
                    rejectUnauthorized: false
                };
                pxymqtt_client = mqtt.connect(connectOptions);
            }

            pxymqtt_client.on('connect', function () {
                req_sub();
                reg_req_sub();
                //resp_sub();
                mqtt_state = 'ready';
            });

            pxymqtt_client.on('message', mqtt_message_handler);
        }
    }
};

var mqtt_tid = require('shortid').generate();
wdt.set_wdt(mqtt_tid, 2, _this.mqtt_watchdog);


function resp_sub() {
    // var resp_topic = util.format('/oneM2M/resp/%s/#', usecseid.replace('/', ':'));
    // pxymqtt_client.subscribe(resp_topic);

    var resp_topic = util.format('/oneM2M/resp/%s/#', usecseid.replace('/', ''));
    pxymqtt_client.subscribe(resp_topic);

    console.log('subscribe resp_topic as ' + resp_topic);
}

function req_sub() {
    var req_topic = util.format('/oneM2M/req/+/%s/+', usecseid.replace('/', ''));
    pxymqtt_client.subscribe(req_topic);
    console.log('subscribe req_topic as ' + req_topic);

    // req_topic = util.format('/oneM2M/req/+/%s/+', usecsebase);
    // pxymqtt_client.subscribe(req_topic);
    // console.log('subscribe req_topic as ' + req_topic);
}

function reg_req_sub() {
    var reg_req_topic = util.format('/oneM2M/reg_req/+/%s/+', usecseid.replace('/', ''));
    pxymqtt_client.subscribe(reg_req_topic);
    console.log('subscribe reg_req_topic as ' + reg_req_topic);

    // reg_req_topic = util.format('/oneM2M/reg_req/+/%s/+', usecsebase);
    // pxymqtt_client.subscribe(reg_req_topic);
    // console.log('subscribe reg_req_topic as ' + reg_req_topic);
}

function mqtt_message_handler(topic, message) {
    var topic_arr = topic.split("/");

    // 토픽의 마지막 조각이 형식이다 — /oneM2M/req/{발신}/{수신}/{ct}.
    //
    // 이 CSE 는 json 만 다룬다. xml·cbor 로 오면 거절한다. 여기서 끊으면
    // xml2js·cbor 디코드도, 코어로 나가는 HTTP 요청도 없다.
    //
    // 코어의 json_only 미들웨어로는 이걸 못 잡는다. 이 프록시가 가장자리에서
    // 본문을 풀어 **json 으로 다시 싸서** 코어에 올리기 때문이다(mqtt_request 가
    // Content-Type 을 application/vnd.onem2m-res+json 으로 고정한다). 그래서
    // 관문이 여기 따로 있어야 한다.
    //
    // 미지의 조각은 예전처럼 json 으로 떨어뜨린다. 거절 대상은 xml 과 cbor 두
    // 리터럴뿐이다.
    if (topic_arr[5] === 'xml' || topic_arr[5] === 'cbor') {
        // 응답 토픽은 요청 토픽에서 만든다. req -> resp, reg_req -> reg_resp.
        // 형식 조각은 json 으로 바꿔 답한다 — "json 을 쓰라" 는 안내를 xml
        // 토픽으로 보내면 앞뒤가 안 맞는다.
        var deny_topic = (topic_arr[2] === 'reg_req') ? '/oneM2M/reg_resp/' : '/oneM2M/resp/';
        deny_topic += topic_arr[3] + '/' + topic_arr[4] + '/json';

        console.error('[json_only] mqtt ' + topic + ' — json 만 받는다');
        try {
            pxymqtt_client.publish(deny_topic, JSON.stringify({
                'm2m:rsp': { rsc: 4000, rqi: '', pc: { 'm2m:dbg': 'only json is supported' } }
            }));
        }
        catch (e) {
            // 발행이 실패해도 여기서 던지면 안 된다 — 이 핸들러는 cluster
            // 마스터에서 돌고, 던지면 워커 재시작 로직까지 위험해진다.
            console.error('[json_only] mqtt 거절 응답 발행 실패: ' + e.message);
        }
        return;
    }

    // 여기까지 왔으면 json 이다. 미지의 조각도 json 으로 본다 — 예전과 같다.
    if (topic_arr[5] == null) { topic_arr[5] = 'json'; }

    if((topic_arr[1] == 'oneM2M' && topic_arr[2] == 'resp' && ((topic_arr[3].replace(':', '/') == usecseid) || (topic_arr[3] == usecseid.replace('/', ''))))) {
        make_json_obj(message.toString(), function(rsc, jsonObj) {
            if(rsc == '1') {
                if(jsonObj['m2m:rsp'] == null) {
                    jsonObj['m2m:rsp'] = jsonObj;
                }

                if (jsonObj['m2m:rsp'] != null) {
                    for (var i = 0; i < resp_mqtt_rqi_arr.length; i++) {
                        if (resp_mqtt_rqi_arr[i] == jsonObj['m2m:rsp'].rqi) {
                            NOPRINT==='true'?NOPRINT='true':console.log('----> ' + jsonObj['m2m:rsp'].rsc);

                            http_response_q[resp_mqtt_rqi_arr[i]].header('X-M2M-RSC', jsonObj['m2m:rsp'].rsc);
                            http_response_q[resp_mqtt_rqi_arr[i]].header('X-M2M-RI', resp_mqtt_rqi_arr[i]);

                            var status_code = '404';
                            if(jsonObj['m2m:rsp'].rsc == '4105') {
                                status_code = '409';
                            }
                            else if(jsonObj['m2m:rsp'].rsc == '2000') {
                                status_code = '200';
                            }
                            else if(jsonObj['m2m:rsp'].rsc == '2001') {
                                status_code = '201';
                            }
                            else if(jsonObj['m2m:rsp'].rsc == '4000') {
                                status_code = '400';
                            }
                            else if(jsonObj['m2m:rsp'].rsc == '5000') {
                                status_code = '500';
                            }
                            else {

                            }

                            http_response_q[resp_mqtt_rqi_arr[i]].status(status_code).end(JSON.stringify(jsonObj['m2m:rsp'].pc));

                            delete http_response_q[resp_mqtt_rqi_arr[i]];
                            resp_mqtt_rqi_arr.splice(i, 1);

                            break;
                        }
                    }
                }
            }
            else {
                var resp_topic = '/oneM2M/resp/';
                if (topic_arr[2] === 'reg_req') {
                    resp_topic = '/oneM2M/reg_resp/';
                }
                resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
                mqtt_response(resp_topic, 4000, '', '', '', '', 'to parsing error');
            }
        });
    }
    else if(topic_arr[1] === 'oneM2M' && topic_arr[2] === 'req' && ((topic_arr[4].replace(':', '/') == usecseid) || (topic_arr[4] == usecseid.replace('/', '')) || (topic_arr[4] == usecsebase))) {
        NOPRINT==='true'?NOPRINT='true':console.log('----> [response_mqtt] - ' + topic);
        NOPRINT==='true'?NOPRINT='true':console.log(message.toString());

        make_json_obj(message.toString(), function(rsc, result) {
            if(rsc == '1') {
                if(result && result['m2m:rqp'] == null) {
                    result['m2m:rqp'] = result;
                }

                var cache_key = result['m2m:rqp'].op.toString() + result['m2m:rqp'].to.toString() + result['m2m:rqp'].rqi.toString();

                if(message_cache.hasOwnProperty(cache_key)) {
                    if(message_cache[cache_key].to == result['m2m:rqp'].to) { // duplicated message
                        //console.log("duplicated message");
                        var resp_topic = '/oneM2M/resp/';
                        if (topic_arr[2] === 'reg_req') {
                            resp_topic = '/oneM2M/reg_resp/';
                        }

                        var resp_topic_rel1 = resp_topic + (topic_arr[3] + '/' + topic_arr[4]);
                        resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);

                        if(message_cache[cache_key].hasOwnProperty('rsp')) {
                            message_cache[cache_key].ttl = cache_ttl;
                            pxymqtt_client.publish(resp_topic_rel1, message_cache[cache_key].rsp);
                            pxymqtt_client.publish(resp_topic, message_cache[cache_key].rsp);
                        }
                    }
                }
                else {
                    // if(Object.keys(message_cache).length >= cache_limit) {
                    //     delete message_cache[Object.keys(message_cache)[0]];
                    // }

                    message_cache[cache_key] = {};
                    message_cache[cache_key].to = result['m2m:rqp'].to;
                    message_cache[cache_key].ttl = cache_ttl;
                    message_cache[cache_key].rsp = '';

                    mqtt_message_action(topic_arr, result);
                }
            }
            else {
                resp_topic = '/oneM2M/resp/';
                if (topic_arr[2] === 'reg_req') {
                    resp_topic = '/oneM2M/reg_resp/';
                }
                resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
                mqtt_response(resp_topic, 4000, '', '', '', '', 'to parsing error');
            }
        });
    }
    else if(topic_arr[1] === 'oneM2M' && topic_arr[2] === 'reg_req' && ((topic_arr[4].replace(':', '/') == usecseid) || (topic_arr[4] == usecseid.replace('/', '')))) {
        make_json_obj(message.toString(), function(rsc, result) {
            // 파싱에 실패하면 make_json_obj 는 callback('0') 만 부르므로 result 가
            // undefined 다. 예전에는 rsc 를 보기 전에 result['m2m:rqp'] 를 읽어,
            // 잘못된 MQTT 메시지 한 줄로 pxy_mqtt 를 require 한 cluster 마스터가
            // 죽었다. 마스터가 죽으면 워커 재시작 로직도 함께 사라진다.
            // 바로 위 req 분기에는 있던 가드가 여기만 빠져 있었다.
            if(rsc == '1') {
                if(result && result['m2m:rqp'] == null) {
                    result['m2m:rqp'] = result;
                }
                mqtt_message_action(topic_arr, result);
            }
            else {
                var resp_topic = '/oneM2M/resp/';
                if (topic_arr[2] === 'reg_req') {
                    resp_topic = '/oneM2M/reg_resp/';
                }
                resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
                mqtt_response(resp_topic, 4000, '', '', '', '', 'to parsing error');
            }
        });
    }
    else {
        NOPRINT==='true'?NOPRINT='true':console.log('topic(' + topic + ') is not supported');
    }
}

function cache_ttl_manager() {
    for(var idx in message_cache) {
        if(message_cache.hasOwnProperty(idx)) {
            message_cache[idx].ttl--;
            if(message_cache[idx].ttl <= 0) {
                delete message_cache[idx];
            }
        }
    }
}

var cache_tid = require('shortid').generate();
var outbound = require('./mobius/outbound');
wdt.set_wdt(cache_tid, cache_keep, cache_ttl_manager);

// bodytype 인자를 걷어냈다 — 관문(mqtt_message_handler 위)이 json 토픽만
// 통과시키므로 값이 언제나 json 이었다.
function mqtt_message_action(topic_arr, jsonObj) {
    if (jsonObj['m2m:rqp'] != null) {
        var op = (jsonObj['m2m:rqp'].op == null) ? '' : jsonObj['m2m:rqp'].op;
        var to = (jsonObj['m2m:rqp'].to == null) ? '' : jsonObj['m2m:rqp'].to;

        to = to.replace(usespid + usecseid + '/', '/');
        to = to.replace(usecseid + '/', '/');

        if(to.charAt(0) != '/') {
            to = '/' + to;
        }

        var fr = (jsonObj['m2m:rqp'].fr == null) ? '' : jsonObj['m2m:rqp'].fr;
        if(fr == '') {
            fr = topic_arr[3];
        }
        var rqi = (jsonObj['m2m:rqp'].rqi == null) ? '' : jsonObj['m2m:rqp'].rqi;
        var ty = (jsonObj['m2m:rqp'].ty == null) ? '' : jsonObj['m2m:rqp'].ty.toString();
        var pc = (jsonObj['m2m:rqp'].pc == null) ? '' : jsonObj['m2m:rqp'].pc;

        if(jsonObj['m2m:rqp'].hasOwnProperty('fc')) {
            var query_count = 0;
            for(var fc_idx in jsonObj['m2m:rqp'].fc) {
                if(jsonObj['m2m:rqp'].fc.hasOwnProperty(fc_idx)) {
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
                    to += jsonObj['m2m:rqp'].fc[fc_idx].toString();
                }
            }
        }

        try {
            var resp_topic = '/oneM2M/resp/';
            if (topic_arr[2] == 'reg_req') {
                resp_topic = '/oneM2M/reg_resp/';
            }
            var resp_topic_rel1 = resp_topic + (topic_arr[3] + '/' + topic_arr[4]);
            resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);

            //if (to.split('/')[1].split('?')[0] == usecsebase) {
                mqtt_binding(op, to, fr, rqi, ty, pc, function (res, res_body) {
                    if (res_body == '') {
                        res_body = '{}';
                    }
                    // 바깥 try/catch 는 이 콜백을 감싸지 못한다. 콜백은 mqtt_binding 의
                    // res.on('end') 안에서 나중에 도는데, 그때 try 는 이미 빠져나간
                    // 뒤다. 여기서 던지면 pxy_mqtt 를 require 한 cluster 마스터가
                    // 죽고, 워커 재시작 로직까지 함께 사라진다.
                    var pc_obj;
                    try {
                        pc_obj = JSON.parse(res_body);
                    }
                    catch (e) {
                        console.error('[pxy_mqtt] 응답 본문이 JSON 이 아니다 (' + to + '): ' + e.message);
                        pc_obj = { 'm2m:dbg': 'response body is not valid JSON' };
                        mqtt_response(resp_topic_rel1, RSC.INTERNAL_SERVER_ERROR.rsc, op, to, usecseid, rqi, pc_obj);
                        mqtt_response(resp_topic, RSC.INTERNAL_SERVER_ERROR.rsc, op, to, usecseid, rqi, pc_obj);
                        return;
                    }
                    mqtt_response(resp_topic_rel1, res.headers['x-m2m-rsc'], op, to, usecseid, rqi, pc_obj);
                    mqtt_response(resp_topic, res.headers['x-m2m-rsc'], op, to, usecseid, rqi, pc_obj);
                });
            //}
            ////else {
            //    mqtt_response(resp_topic, 4004, fr, usecseid, rqi, 'this is not MN-CSE, csebase do not exist', bodytype);
            ////}
        }
        catch (e) {
            console.error(e);
            resp_topic = '/oneM2M/resp/';
            if (topic_arr[2] == 'reg_req') {
                resp_topic = '/oneM2M/reg_resp/';
            }
            resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
            mqtt_response(resp_topic, 5000, op, fr, usecseid, rqi, 'to parsing error');
        }
    }
    else {
        NOPRINT==='true'?NOPRINT='true':console.log('mqtt message tag is not different : m2m:rqp');

        resp_topic = '/oneM2M/resp/';
        if (topic_arr[2] == 'reg_req') {
            resp_topic = '/oneM2M/reg_resp/';
        }
        resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
        mqtt_response(resp_topic, 4000, "", "", usecseid, "", '\"m2m:dbg\":\"mqtt message tag is different : m2m:rqp\"');
    }
}

function mqtt_binding(op, to, fr, rqi, ty, pc, callback) {
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
        hostname: usemqttcbhost,
        port: usecsebaseport,
        path: to,
        method: op,
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': fr,
            'Content-Type': content_type,
            'binding': 'M',
            'X-M2M-RVI': uservi
        }
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
    outbound.arm(req, 'pxy_mqtt -> mobius');
    req.on('error', function (e) {
        //console.log('[pxymqtt-mqtt_binding] problem with request: ' + e.message);
    });

    // write data to request body

    //console.log(options);
    //console.log(reqBodyString);

    req.write(reqBodyString);
    req.end();
}

function mqtt_response(resp_topic, rsc, op, to, fr, rqi, inpc) {
    var rsp_message = {};
    rsp_message['m2m:rsp'] = {};
    //rsp_message['m2m:rsp'].rsc = rsc;
    rsp_message['m2m:rsp'].rsc = parseInt(rsc); // convert to int
    //rsp_message['m2m:rsp'].to = to;
    //rsp_message['m2m:rsp'].fr = fr;

    rsp_message['m2m:rsp'].rqi = rqi;
    rsp_message['m2m:rsp'].pc = inpc;

    var cache_key = op.toString() + to.toString() + rqi.toString();

    try {
        if(message_cache.hasOwnProperty(cache_key)) {
            message_cache[cache_key].rsp = JSON.stringify(rsp_message['m2m:rsp']);
        }
        else {
            message_cache[cache_key] = {};
            message_cache[cache_key].rsp = JSON.stringify(rsp_message['m2m:rsp']);
        }

        pxymqtt_client.publish(resp_topic, message_cache[cache_key].rsp);
    }
    catch (e) {
        console.log(e.message);
        delete message_cache[cache_key];
        var dbg = {};
        dbg['m2m:dbg'] = '[mqtt_response]' + e.message;
        pxymqtt_client.publish(resp_topic, JSON.stringify(dbg));
    }
}

// for notification
// mqtt_app 의 HTTP 라우트 셋을 걷어냈다 (2026-08-31).
//
//   POST /notification   호출처 0곳 — 저장소 어디서도 부르지 않았다
//   POST /register_csr   mobius/asn.js · mn.js 만 불렀다
//   GET  /get_cb         〃
//
// ASN/MN-CSE 모드를 포기하면서 그 둘이 사라졌으므로 부르는 코드가 없다.
// 셋 다 request.headers.bodytype 을 읽었는데, 그 헤더를 **세우는 코드는
// 저장소에 없었다** — 토픽 끝에 undefined 가 붙는 상태였다.
//
// mqtt_app 자체와 그 위의 http 서버는 남긴다. listen() 콜백이
// mqtt_state 를 init -> connect 로 넘기는 유일한 자리라(위 mqtt_watchdog),
// 서버를 지우면 MQTT 가 통째로 죽는다. 라우트만 없앤 빈 서버다.

// 여기 있던 forward_mqtt 도 지웠다 — 호출처가 0곳이었고, 본문을 언제나
// XML 로 만들어 publish 했다. json 전용이 된 지금은 되살릴 수도 없다.


function http_retrieve_CSEBase(callback) {
    var resourceid = '/' + usecsebase;
    var responseBody = '';

    var options = {
        hostname: usemqttcbhost,
        port: usecsebaseport,
        path: resourceid,
        method: 'get',
        headers: {
            'X-M2M-RI': require('shortid').generate(),
            'Accept': 'application/json',
            'X-M2M-Origin': usecseid,
            'X-M2M-RVI': uservi
        },
        rejectUnauthorized: false
    };

    if(use_secure == 'disable') {
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
        options.ca = fs.readFileSync('ca-crt.pem');

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
    outbound.arm(req, 'pxy_mqtt -> mobius');
    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            //console.log('[pxymqtt - http_retrieve_CSEBase] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write('');
    req.end();
}

