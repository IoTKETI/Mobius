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
var bodyParser = require('body-parser');
var mqtt = require('mqtt');
var util = require('util');
var xml2js = require('xml2js');
var js2xmlparser = require('js2xmlparser');
var url = require('url');
var xmlbuilder = require('xmlbuilder');
var moment = require('moment');
var ip = require("ip");
var cbor = require('cbor');

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



//require('./mobius/ts_agent');

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
                
                require('./mobius/ts_agent');
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
    if(topic_arr[5] != null) {
        var bodytype = (topic_arr[5] == 'xml') ? topic_arr[5] : ((topic_arr[5] == 'json') ? topic_arr[5] : ((topic_arr[5] == 'cbor') ? topic_arr[5] : 'json'));
    }
    else {
        bodytype = defaultbodytype;
        topic_arr[5] = defaultbodytype;
    }

    if((topic_arr[1] == 'oneM2M' && topic_arr[2] == 'resp' && ((topic_arr[3].replace(':', '/') == usecseid) || (topic_arr[3] == usecseid.replace('/', ''))))) {
        make_json_obj(bodytype, message.toString(), function(rsc, jsonObj) {
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
                mqtt_response(resp_topic, 4000, '', '', '', '', 'to parsing error', bodytype);
            }
        });
    }
    else if(topic_arr[1] === 'oneM2M' && topic_arr[2] === 'req' && ((topic_arr[4].replace(':', '/') == usecseid) || (topic_arr[4] == usecseid.replace('/', '')) || (topic_arr[4] == usecsebase))) {
        NOPRINT==='true'?NOPRINT='true':console.log('----> [response_mqtt] - ' + topic);
        NOPRINT==='true'?NOPRINT='true':console.log(message.toString());

        make_json_obj(bodytype, message.toString(), function(rsc, result) {
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

                    mqtt_message_action(topic_arr, bodytype, result);
                }
            }
            else {
                resp_topic = '/oneM2M/resp/';
                if (topic_arr[2] === 'reg_req') {
                    resp_topic = '/oneM2M/reg_resp/';
                }
                resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
                mqtt_response(resp_topic, 4000, '', '', '', '', 'to parsing error', bodytype);
            }
        });
    }
    else if(topic_arr[1] === 'oneM2M' && topic_arr[2] === 'reg_req' && ((topic_arr[4].replace(':', '/') == usecseid) || (topic_arr[4] == usecseid.replace('/', '')))) {
        make_json_obj(bodytype, message.toString(), function(rsc, result) {
            if(result['m2m:rqp'] == null) {
                result['m2m:rqp'] = result;
            }
            if(rsc == '1') {
                mqtt_message_action(topic_arr, bodytype, result);
            }
            else {
                var resp_topic = '/oneM2M/resp/';
                if (topic_arr[2] === 'reg_req') {
                    resp_topic = '/oneM2M/reg_resp/';
                }
                resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
                mqtt_response(resp_topic, 4000, '', '', '', '', 'to parsing error', bodytype);
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
wdt.set_wdt(cache_tid, cache_keep, cache_ttl_manager);

function mqtt_message_action(topic_arr, bodytype, jsonObj) {
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
                mqtt_binding(op, to, fr, rqi, ty, pc, bodytype, function (res, res_body) {
                    if (res_body == '') {
                        res_body = '{}';
                    }
                    mqtt_response(resp_topic_rel1, res.headers['x-m2m-rsc'], op, to, usecseid, rqi, JSON.parse(res_body), bodytype);
                    mqtt_response(resp_topic, res.headers['x-m2m-rsc'], op, to, usecseid, rqi, JSON.parse(res_body), bodytype);
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
            mqtt_response(resp_topic, 5000, op, fr, usecseid, rqi, 'to parsing error', bodytype);
        }
    }
    else {
        NOPRINT==='true'?NOPRINT='true':console.log('mqtt message tag is not different : m2m:rqp');

        resp_topic = '/oneM2M/resp/';
        if (topic_arr[2] == 'reg_req') {
            resp_topic = '/oneM2M/reg_resp/';
        }
        resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
        mqtt_response(resp_topic, 4000, "", "", usecseid, "", '\"m2m:dbg\":\"mqtt message tag is different : m2m:rqp\"', bodytype);
    }
}

function mqtt_binding(op, to, fr, rqi, ty, pc, bodytype, callback) {
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

    req.on('error', function (e) {
        //console.log('[pxymqtt-mqtt_binding] problem with request: ' + e.message);
    });

    // write data to request body

    //console.log(options);
    //console.log(reqBodyString);

    req.write(reqBodyString);
    req.end();
}

function mqtt_response(resp_topic, rsc, op, to, fr, rqi, inpc, bodytype) {
    var rsp_message = {};
    rsp_message['m2m:rsp'] = {};
    //rsp_message['m2m:rsp'].rsc = rsc;
    rsp_message['m2m:rsp'].rsc = parseInt(rsc); // convert to int
    //rsp_message['m2m:rsp'].to = to;
    //rsp_message['m2m:rsp'].fr = fr;

    rsp_message['m2m:rsp'].rqi = rqi;
    rsp_message['m2m:rsp'].pc = inpc;

    var cache_key = op.toString() + to.toString() + rqi.toString();

    if (bodytype == 'xml') {
        var bodyString = responder.convertXmlMqtt('rsp', rsp_message['m2m:rsp']);

        /*rsp_message['m2m:rsp']['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        for(var prop in rsp_message['m2m:rsp'].pc) {
            if (rsp_message['m2m:rsp'].pc.hasOwnProperty(prop)) {
                for(var prop2 in rsp_message['m2m:rsp'].pc[prop]) {
                    if (rsp_message['m2m:rsp'].pc[prop].hasOwnProperty(prop2)) {
                        if(prop2 == 'rn') {
                            rsp_message['m2m:rsp'].pc[prop]['@'] = {rn : rsp_message['m2m:rsp'].pc[prop][prop2]};
                            delete rsp_message['m2m:rsp'].pc[prop][prop2];
                        }
                        for(var prop3 in rsp_message['m2m:rsp'].pc[prop][prop2]) {
                            if (rsp_message['m2m:rsp'].pc[prop][prop2].hasOwnProperty(prop3)) {
                                if(prop3 == 'rn') {
                                    rsp_message['m2m:rsp'].pc[prop][prop2]['@'] = {rn : rsp_message['m2m:rsp'].pc[prop][prop2][prop3]};
                                    delete rsp_message['m2m:rsp'].pc[prop][prop2][prop3];
                                }
                            }
                        }
                    }
                }
            }
        }

        var bodyString = js2xmlparser.parse("m2m:rsp", rsp_message['m2m:rsp']);
*/
        if(message_cache.hasOwnProperty(cache_key)) {
            message_cache[cache_key].rsp = bodyString.toString();
        }
        else {
            message_cache[cache_key] = {};
            message_cache[cache_key].rsp = bodyString.toString();
        }

        pxymqtt_client.publish(resp_topic, bodyString.toString());
    }
    else if(bodytype === 'cbor') {
        bodyString = cbor.encode(rsp_message['m2m:rsp']).toString('hex');

        if(message_cache.hasOwnProperty(cache_key)) {
            message_cache[cache_key].rsp = bodyString.toString();
        }
        else {
            message_cache[cache_key] = {};
            message_cache[cache_key].rsp = bodyString.toString();
        }

        pxymqtt_client.publish(resp_topic, bodyString);
    }
    else { // 'json'
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
}

// for notification
var onem2mParser = bodyParser.text(
    {
        limit: '1mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);

mqtt_app.post('/notification', onem2mParser, function(request, response, next) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;

        try {
            var aeid = url.parse(request.headers.nu).pathname.replace('/', '').split('?')[0];
            NOPRINT==='true'?NOPRINT='true':console.log('[pxy_mqtt] - ' + aeid);

            if (aeid == '') {
                NOPRINT==='true'?NOPRINT='true':console.log('aeid of notification url is none');
                return;
            }

            if (mqtt_state == 'ready') {
                var noti_topic = util.format('/oneM2M/req/%s/%s/%s', usecseid.replace('/', ''), aeid, request.headers.bodytype);

                var rqi = request.headers['x-m2m-ri'];
                resp_mqtt_rqi_arr.push(rqi);
                http_response_q[rqi] = response;

                pxymqtt_client.publish(noti_topic, request.body);
                NOPRINT==='true'?NOPRINT='true':console.log('<---- ' + noti_topic);
            }
            else {
                NOPRINT==='true'?NOPRINT='true':console.log('pxymqtt is not ready');
            }
        }
        catch (e) {
            NOPRINT==='true'?NOPRINT='true':console.log(e.message);
            var rsp_Obj = {};
            rsp_Obj['rsp'] = {};
            rsp_Obj['rsp'].dbg = 'notificationUrl does not support : ' + request.headers.nu;
            response.header('X-M2M-RSC', '4000');
            response.status(400).end(JSON.stringify(rsp_Obj));
        }
    });
});

mqtt_app.post('/register_csr', onem2mParser, function(request, response, next) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;

        var cseid = (request.headers.cseid == null) ? '' : request.headers.cseid;

        if (cseid == '') {
            NOPRINT==='true'?NOPRINT='true':console.log('cseid of register url is none');
            return;
        }

        if (mqtt_state == 'ready') {
            var reg_req_topic = util.format('/oneM2M/reg_req/%s/%s/%s', usecseid.replace('/', ':'), cseid.replace('/', ':'), request.headers.bodytype);

            var rqi = request.headers['x-m2m-ri'];
            resp_mqtt_rqi_arr.push(rqi);
            http_response_q[rqi] = response;

            var pc = JSON.parse(request.body);

            var req_message = {};
            req_message['m2m:rqp'] = {};
            req_message['m2m:rqp'].op = '1'; // post
            req_message['m2m:rqp'].to = request.headers.csebasename; // CSEBase Relative
            req_message['m2m:rqp'].fr = request.headers['x-m2m-origin'];
            req_message['m2m:rqp'].rqi = rqi;
            req_message['m2m:rqp'].ty = '16';

            req_message['m2m:rqp'].pc = pc;

            if (request.headers.bodytype == 'xml') {
                req_message['m2m:rqp']['@'] = {
                    "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                };

                var xmlString = js2xmlparser.parse("m2m:rqp", req_message['m2m:rqp']);

                pxymqtt_client.publish(reg_req_topic, xmlString);
                NOPRINT==='true'?NOPRINT='true':console.log('<---- ' + reg_req_topic);
            }
            else { // 'json'
                pxymqtt_client.publish(reg_req_topic, JSON.stringify(req_message['m2m:rqp']));
                NOPRINT==='true'?NOPRINT='true':console.log('<---- ' + reg_req_topic);
            }
        }
        else {
            NOPRINT==='true'?NOPRINT='true':console.log('pxymqtt is not ready');
        }
    });
});

mqtt_app.get('/get_cb', onem2mParser, function(request, response, next) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;

        var cseid = (request.headers.cseid == null) ? '' : request.headers.cseid;

        if (cseid == '') {
            NOPRINT==='true'?NOPRINT='true':console.log('cseid of register url is none');
            return;
        }

        if (mqtt_state == 'ready') {
            var reg_req_topic = util.format('/oneM2M/reg_req/%s/%s/%s', usecseid.replace('/', ':'), cseid.replace('/', ':'), request.headers.bodytype);

            var rqi = request.headers['x-m2m-ri'];
            resp_mqtt_rqi_arr.push(rqi);
            http_response_q[rqi] = response;

            var pc = '';

            var req_message = {};
            req_message['m2m:rqp'] = {};
            req_message['m2m:rqp'].op = '2'; // get
            req_message['m2m:rqp'].to = request.headers.csebasename; // CSEBase Relative
            req_message['m2m:rqp'].fr = request.headers['x-m2m-origin'];
            req_message['m2m:rqp'].rqi = rqi;
            req_message['m2m:rqp'].ty = '16';

            req_message['m2m:rqp'].pc = pc;

            if (request.headers.bodytype == 'xml') {
                req_message['m2m:rqp']['@'] = {
                    "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                };

                var xmlString = js2xmlparser.parse("m2m:rqp", req_message['m2m:rqp']);

                pxymqtt_client.publish(reg_req_topic, xmlString);
                NOPRINT==='true'?NOPRINT='true':console.log('<---- ' + reg_req_topic);
            }
            else { // 'json'
                pxymqtt_client.publish(reg_req_topic, JSON.stringify(req_message['m2m:rqp']));
                NOPRINT==='true'?NOPRINT='true':console.log('<---- ' + reg_req_topic);
            }
        }
        else {
            NOPRINT==='true'?NOPRINT='true':console.log('pxymqtt is not ready');
        }
    });
});


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

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            //console.log('[pxymqtt - http_retrieve_CSEBase] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write('');
    req.end();
}

function forward_mqtt(forward_cseid, op, to, fr, rqi, ty, nm, inpc) {
    var forward_message = {};
    forward_message.op = op;
    forward_message.to = to;
    forward_message.fr = fr;
    forward_message.rqi = rqi;
    forward_message.ty = ty;
    forward_message.nm = nm;
    forward_message.pc = inpc;

    forward_message['@'] = {
        "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
    };

    var xmlString = js2xmlparser.parse("m2m:rqp", forward_message);

    var forward_topic = util.format('/oneM2M/req/%s/%s', usecseid.replace('/', ':'), forward_cseid);

    pxymqtt_client.publish(forward_topic, xmlString);
}
