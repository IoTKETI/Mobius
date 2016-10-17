/**
 * Copyright (c) 2015, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2015, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var fs = require('fs');
var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var mqtt = require('mqtt');
var util = require('util');
var xml2js = require('xml2js');
var url = require('url');
var xmlbuilder = require('xmlbuilder');
var js2xmlparser = require("js2xmlparser");
var moment = require('moment');
var ip = require("ip");

var resp_mqtt_client_arr = [];
var req_mqtt_client_arr = [];
var resp_mqtt_rqi_arr = [];

var http_response_q = {};

global.NOPRINT = 'true';


var _this = this;

var mqtt_state = 'init';
var custom = new process.EventEmitter();

// ������ �����մϴ�.
var mqtt_app = express();


var usemqttcbhost = 'localhost'; // pxymqtt to mobius


http.globalAgent.maxSockets = 1000000;

http.createServer(mqtt_app).listen({port: usepxymqttport, agent: false}, function () {
    console.log('pxymqtt server (' + ip.address() + ') running at ' + usepxymqttport + ' port');

    mqtt_state = 'connect';

    setInterval(function () {
        custom.emit('mqtt_watchdog');
    }, 2000);
});

var pxymqtt_client = null;

custom.on('mqtt_watchdog', function() {
    if(mqtt_state == 'connect') {
        http_retrieve_CSEBase(function(status, res_body) {
            if (status == 2000) {
                var jsonObj = JSON.parse(res_body);
                usecseid = jsonObj['m2m:cb'].csi;

                mqtt_state = 'connecting';
            }
            else {
                console.log('Target CSE(' + usemqttcbhost + ') is not ready');
            }
        });
    }
    else if(mqtt_state == 'connecting') {
        if(pxymqtt_client == null) {
            pxymqtt_client = mqtt.connect('mqtt://' + usemqttbroker);
            pxymqtt_client.on('connect', function () {
                req_sub(pxymqtt_client);
                reg_req_sub(pxymqtt_client);
                resp_sub(pxymqtt_client);
                mqtt_state = 'ready';

                require('./mobius/ts_agent');
                require('./pxy_coap');
            });

            pxymqtt_client.on('message', mqtt_message_handler);
        }
    }
});

function resp_sub(mqtt_client) {
    var resp_topic = util.format('/oneM2M/resp/%s/#', usecseid.replace('/', ':'));
    mqtt_client.subscribe(resp_topic);
    console.log('subscribe resp_topic as ' + resp_topic);
}

function req_sub(mqtt_client) {
    var req_topic = util.format('/oneM2M/req/+/%s/#', usecseid.replace('/', ':'));
    mqtt_client.subscribe(req_topic);
    console.log('subscribe req_topic as ' + req_topic);
}

function reg_req_sub(mqtt_client) {
    var reg_req_topic = util.format('/oneM2M/reg_req/+/%s/#', usecseid.replace('/', ':'));
    mqtt_client.subscribe(reg_req_topic);
    console.log('subscribe reg_req_topic as ' + reg_req_topic);
}

function mqtt_message_handler(topic, message) {
    var topic_arr = topic.split("/");
    if(topic_arr[5] != null) {
        //var bodytype = (topic_arr[5] == 'xml') ? topic_arr[5] : ((topic_arr[5] == 'json') ? topic_arr[5] : 'json');
        var bodytype = (topic_arr[5] == 'xml') ? topic_arr[5] : 'json';
    }
    else {
        bodytype = defaultbodytype;
    }

    if((topic_arr[1] == 'oneM2M' && topic_arr[2] == 'resp' && topic_arr[3].replace(':', '/') == usecseid)) {
        if(bodytype == 'xml') {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(message.toString(), function (err, jsonObj) {
                if (err) {
                    console.log('[pxymqtt-resp xml2js parser error]');
                }
                else {
                    if (jsonObj['m2m:rsp'] != null) {
                        for (var i = 0; i < resp_mqtt_rqi_arr.length; i++) {
                            if (resp_mqtt_rqi_arr[i] == jsonObj['m2m:rsp'].rqi) {
                                console.log('----> ' + jsonObj['m2m:rsp'].rsc);

                                http_response_q[resp_mqtt_rqi_arr[i]].setHeader('X-M2M-RSC', jsonObj['m2m:rsp'].rsc);
                                http_response_q[resp_mqtt_rqi_arr[i]].setHeader('X-M2M-RI', resp_mqtt_rqi_arr[i]);

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

                                http_response_q[resp_mqtt_rqi_arr[i]].status(status_code).end(JSON.stringify(jsonObj['m2m:rsp'].pc));

                                delete http_response_q[resp_mqtt_rqi_arr[i]];
                                resp_mqtt_rqi_arr.splice(i, 1);

                                break;
                            }
                        }
                    }
                }
            });
        }
        else { // 'json'
            var jsonObj = JSON.parse(message.toString());
            if (jsonObj['m2m:rsp'] != null) {
                for (var i = 0; i < resp_mqtt_rqi_arr.length; i++) {
                    if (resp_mqtt_rqi_arr[i] == jsonObj['m2m:rsp'].rqi) {
                        console.log('----> ' + jsonObj['m2m:rsp'].rsc);

                        http_response_q[resp_mqtt_rqi_arr[i]].setHeader('X-M2M-RSC', jsonObj['m2m:rsp'].rsc);
                        http_response_q[resp_mqtt_rqi_arr[i]].setHeader('X-M2M-RI', resp_mqtt_rqi_arr[i]);

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

                        http_response_q[resp_mqtt_rqi_arr[i]].status(status_code).end(JSON.stringify(jsonObj['m2m:rsp'].pc));

                        delete http_response_q[resp_mqtt_rqi_arr[i]];
                        resp_mqtt_rqi_arr.splice(i, 1);

                        break;
                    }
                }
            }
        }
    }
    else if(topic_arr[1] == 'oneM2M' && topic_arr[2] == 'req' && topic_arr[4].replace(':', '/') == usecseid) {
        if (bodytype == 'xml') {
            parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(message.toString(), function (err, result) {
                if (err) {
                    console.log('[pxymqtt-rqp xml2js parser error]');
                }
                else {
                    mqtt_message_action(pxymqtt_client, topic_arr, bodytype, result);
                }
            });
        }
        else { // 'json'
            try {
                mqtt_message_action(pxymqtt_client, topic_arr, bodytype, JSON.parse(message.toString()));
            }
            catch(e) {
                console.log('mqtt message is not supported');
            }
        }
    }
    else if(topic_arr[1] == 'oneM2M' && topic_arr[2] == 'reg_req' && topic_arr[4].replace(':', '/') == usecseid) {
        if (bodytype == 'xml') {
            parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(message.toString(), function (err, result) {
                if (err) {
                    console.log('[pxymqtt-rqp xml2js parser error]');
                }
                else {
                    mqtt_message_action(pxymqtt_client, topic_arr, bodytype, result);
                }
            });
        }
        else { // 'json'
            try {
                mqtt_message_action(pxymqtt_client, topic_arr, bodytype, JSON.parse(message.toString()));
            }
            catch(e) {
                console.log('mqtt message is not supported');
            }
        }
    }
    else {
        console.log('topic is not supported');
    }
}

function mqtt_message_action(mqtt_client, topic_arr, bodytype, jsonObj) {
    if (jsonObj['m2m:rqp'] != null) {
        var op = (jsonObj['m2m:rqp'].op == null) ? '' : jsonObj['m2m:rqp'].op;
        var to = (jsonObj['m2m:rqp'].to == null) ? '' : jsonObj['m2m:rqp'].to;
        var fr = (jsonObj['m2m:rqp'].fr == null) ? '' : jsonObj['m2m:rqp'].fr;
        if(fr == '') {
            fr = topic_arr[4];
        }
        var rqi = (jsonObj['m2m:rqp'].rqi == null) ? '' : jsonObj['m2m:rqp'].rqi;
        var ty = (jsonObj['m2m:rqp'].ty == null) ? '' : jsonObj['m2m:rqp'].ty.toString();
        var pc = (jsonObj['m2m:rqp'].pc == null) ? '' : jsonObj['m2m:rqp'].pc;

        if (to.split('/')[1] == usecsebase) {
            if(topic_arr[2] == 'reg_req') {
                var resp_topic = '/oneM2M/reg_resp/';
            }
            else {
                resp_topic = '/oneM2M/resp/';
            }
            resp_topic += (topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5]);
            mqtt_binding(op, to, fr, rqi, ty, pc, bodytype, function(res, res_body) {
                //res_body = res_body.toString().replace(/m2m:/g, '');
                if(bodytype == 'xml') {
                    var parser = new xml2js.Parser({explicitArray: false, ignoreAttrs: true});
                    parser.parseString(res_body.toString(), function (err, result) {
                        if (err) {
                            console.log('[mqtt_binding parser error]');
                        }
                        else {
                            mqtt_response(mqtt_client, resp_topic, res.headers['x-m2m-rsc'], to, usecseid, rqi, result, bodytype);
                        }
                    });
                }
                else { // 'json
                    //res_body = res_body.toString().replace('m2m:', '');
                    mqtt_response(mqtt_client, resp_topic, res.headers['x-m2m-rsc'], to, usecseid, rqi, JSON.parse(res_body), bodytype);
                }
            });
        }
        else {
            mqtt_response(mqtt_client, resp_topic, 4004, fr, usecseid, rqi, '<h1>this is not MN-CSE, csebase do not exist</h1>');
        }
    }
    else {
        console.log('mqtt message tag is not fit');
    }
}

function mqtt_binding(op, to, fr, rqi, ty, pc, bodytype, callback) {
    var content_type = 'application/vnd.onem2m-res+' + bodytype;

    switch (op) {
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
        var temp_pc = JSON.stringify(pc).replace(/m2m:/g, '');
        pc = JSON.parse(temp_pc);
        var jsonObj = {};
        if(bodytype == 'xml') {
            switch (ty) {
                case '16':
                    jsonObj = (pc.csr == null) ? pc['remoteCSE'] : pc['csr'];
                    if(pc.csr['$'].rn) {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                            "rn": pc.csr['$'].rn
                        };
                        delete pc.csr['$'];
                    }
                    else {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                        };
                    }
                    reqBodyString = (pc.csr == null) ? js2xmlparser('m2m:remoteCSE', JSON.stringify(jsonObj)) : js2xmlparser('m2m:csr', JSON.stringify(jsonObj));
                    break;
                case '2':
                    jsonObj = (pc.ae == null) ? pc['ae'] : pc['ae'];
                    if(pc.ae['$'].rn) {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                            "rn": pc.ae['$'].rn
                        };
                        delete pc.ae['$'];
                    }
                    else {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                        };
                    }
                    reqBodyString = (pc.ae == null) ? js2xmlparser('m2m:AE', JSON.stringify(jsonObj)) : js2xmlparser('m2m:ae', JSON.stringify(jsonObj));
                    break;
                case '3':
                    jsonObj = (pc.cnt == null) ? pc['container'] : pc['cnt'];
                    if(pc.cnt['$'].rn) {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                            "rn": pc.cnt['$'].rn
                        };
                        delete pc.cnt['$'];
                    }
                    else {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                        };
                    }
                    reqBodyString = (pc.cnt == null) ? js2xmlparser('m2m:container', JSON.stringify(jsonObj)) : js2xmlparser('m2m:cnt', JSON.stringify(jsonObj));
                    break;
                case '4':
                    jsonObj = (pc.cin == null) ? pc['contentInstance'] : pc['cin'];
                    if(pc.cin['$'].rn) {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                            "rn": pc.cin['$'].rn
                        };
                        delete pc.cin['$'];
                    }
                    else {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                        };
                    }
                    reqBodyString = (pc.cin == null) ? js2xmlparser('m2m:contentInstance', JSON.stringify(jsonObj)) : js2xmlparser('m2m:cin', JSON.stringify(jsonObj));
                    break;
                case '23':
                    jsonObj = (pc.sub == null) ? pc['sgn'] : pc['sub'];
                    if(pc.sub['$'].rn) {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                            "rn": pc.sub['$'].rn
                        };
                        delete pc.sub['$'];
                    }
                    else {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                        };
                    }
                    reqBodyString = (pc.sub == null) ? js2xmlparser('m2m:subscription', JSON.stringify(jsonObj)) : js2xmlparser('m2m:sub', JSON.stringify(jsonObj));
                    break;
                case '24':
                    jsonObj = (pc.sd == null) ? pc['semanticDescriptor'] : pc['sd'];
                    if(pc.sd['$'].rn) {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                            "rn": pc.sd['$'].rn
                        };
                        delete pc.sub['$'];
                    }
                    else {
                        jsonObj['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                        };
                    }
                    reqBodyString = (pc.sd == null) ? js2xmlparser('m2m:semanticDescriptor', JSON.stringify(jsonObj)) : js2xmlparser('m2m:sd', JSON.stringify(jsonObj));
                    break;
            }
        }
        else {
            switch (ty) {
                case '16':
                    (pc.csr == null) ? jsonObj['m2m:remoteCSE'] = pc['remoteCSE'] : jsonObj['m2m:csr'] = pc['csr'];
                    break;
                case '2':
                    (pc.ae == null) ? jsonObj['m2m:AE'] = pc['ae'] : jsonObj['m2m:ae'] = pc['ae'];
                    break;
                case '3':
                    (pc.cnt == null) ? jsonObj['m2m:container'] = pc['container'] : jsonObj['m2m:cnt'] = pc['cnt'];
                    break;
                case '4':
                    (pc.cin == null) ? jsonObj['m2m:contentInstance'] = pc['contentInstance'] : jsonObj['m2m:cin'] = pc['cin'];
                    break;
                case '23':
                    (pc.sub == null) ? jsonObj['m2m:subscription'] = pc['sgn'] : jsonObj['m2m:sub'] = pc['sub'];
                    break;
                case '24':
                    (pc.sd == null) ? jsonObj['m2m:semanticDescriptor'] = pc['semanticDescriptor'] : jsonObj['m2m:sd'] = pc['sd'];
                    break;
            }

            reqBodyString = JSON.stringify(jsonObj);
        }
    }

    var options = {
        hostname: usemqttcbhost,
        port: usecsebaseport,
        path: to,
        method: op,
        headers: {
            'locale': 'ko',
            'X-M2M-RI': rqi,
            'Accept': 'application/' + bodytype,
            'X-M2M-Origin': fr,
            'Content-Type': content_type
        }
    };

    var bodyStr = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            callback(res, bodyStr);
        });
    });

    req.on('error', function (e) {
        console.log('[pxymqtt-mqtt_binding] problem with request: ' + e.message);
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}

function mqtt_response(mqtt_client, resp_topic, rsc, to, fr, rqi, inpc, bodytype) {
    var rsp_message = {};
    rsp_message['m2m:rsp'] = {};
    rsp_message['m2m:rsp'].rsc = rsc;
    //rsp_message['m2m:rsp'].to = to;
    //rsp_message['m2m:rsp'].fr = fr;

    rsp_message['m2m:rsp'].rqi = rqi;
    rsp_message['m2m:rsp'].pc = inpc;

    if(rqi == 'keti') {
        for(var attr in inpc) {
            if(inpc.hasOwnProperty(attr)) {
                if (inpc[attr].ty) {
                    delete inpc[attr].ty;
                }

                if (inpc[attr].ct) {
                    delete inpc[attr].ct;
                }

                if (inpc[attr].lt) {
                    delete inpc[attr].lt;
                }

                if (inpc[attr].st) {
                    delete inpc[attr].st;
                }

                if (inpc[attr].con) {
                    delete inpc[attr].con;
                }

                if (inpc[attr].cs) {
                    delete inpc[attr].cs;
                }

                if (inpc[attr].rn) {
                    delete inpc[attr].rn;
                }

                if (inpc[attr].pi) {
                    delete inpc[attr].pi;
                }
            }
        }
    }
    else {
        if (bodytype == 'xml') {
            rsp_message['m2m:rsp']['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            var xmlString = js2xmlparser("m2m:rsp", rsp_message['m2m:rsp']);

            mqtt_client.publish(resp_topic, xmlString.toString());
        }
        else { // 'json'
            mqtt_client.publish(resp_topic, JSON.stringify(rsp_message));
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
            var aeid = url.parse(request.headers.nu).pathname.replace('/', '');

            if (aeid == '') {
                console.log('aeid of notification url is none');
                return;
            }

            if (mqtt_state == 'ready') {
                var noti_topic = util.format('/oneM2M/req/%s/%s/%s', usecseid.replace('/', ':'), aeid, request.headers.bodytype);

                var rqi = request.headers['x-m2m-ri'];
                resp_mqtt_rqi_arr.push(rqi);
                http_response_q[rqi] = response;

                var pc = JSON.parse(request.body);

                try {
                    var noti_message = {};
                    noti_message['m2m:rqp'] = {};
                    noti_message['m2m:rqp'].op = 5; // notification
                    noti_message['m2m:rqp'].net = (pc['sgn'] != null) ? pc.sgn.net : pc.singleNotification.notificationEventType;
                    noti_message['m2m:rqp'].to = (pc['sgn'] != null) ? pc.sgn.sur : pc.singleNotification.subscriptionReference;
                    noti_message['m2m:rqp'].fr = usecseid;
                    noti_message['m2m:rqp'].rqi = rqi;

                    noti_message['m2m:rqp'].pc = pc;

                    if (pc['sgn'] != null) {
                        if (!pc.sgn.nec) {
                            var nec = pc.sgn.nec;
                            delete pc.sgn.nec;
                        }
                    }
                    else {
                        if (!pc.singleNotification.notificationEventCat) {
                            nec = pc.singleNotification.notificationEventCat;
                            delete pc.singleNotification.notificationEventCat;
                        }
                    }
                }
                catch (e) {
                    rsp_Obj = {};
                    rsp_Obj['rsp'] = {};
                    rsp_Obj['rsp'].cap = 'notification body message type error';
                    response.setHeader('X-M2M-RSC', '4000');
                    response.setHeader('X-M2M-RI', rqi);

                    response.status(400).end(JSON.stringify(rsp_Obj));
                    return;
                }

                if (nec == 'keti') { // for mqtt implementation of keti
                    noti_topic = util.format('/req/%s/%s/%s', usecseid.replace('/', ':'), aeid, request.headers.bodytype);

                    noti_message = {};
                    noti_message['m2m:rqp'] = {};
                    noti_message['m2m:rqp'].op = 5; // notification
                    noti_message['m2m:rqp'].rqi = rqi;

                    noti_message['m2m:rqp'].pc = pc;

                    if (pc.sgn.net) {
                        delete pc.sgn.net;
                    }

                    if (pc.sgn.sur) {
                        delete pc.sgn.sur;
                    }

                    for (var attr in pc.sgn.nev.rep) {
                        if (pc.sgn.nev.rep.hasOwnProperty(attr)) {
                            if (pc.sgn.nev.rep[attr].cs) {
                                delete pc.sgn.nev.rep[attr].cs;
                            }

                            if (pc.sgn.nev.rep[attr].ct) {
                                delete pc.sgn.nev.rep[attr].ct;
                            }

                            if (pc.sgn.nev.rep[attr].lt) {
                                delete pc.sgn.nev.rep[attr].lt;
                            }

                            if (pc.sgn.nev.rep[attr].pi) {
                                delete pc.sgn.nev.rep[attr].pi;
                            }

                            if (pc.sgn.nev.rep[attr].rn) {
                                delete pc.sgn.nev.rep[attr].rn;
                            }

                            if (pc.sgn.nev.rep[attr].st) {
                                delete pc.sgn.nev.rep[attr].st;
                            }

                            if (pc.sgn.nev.rep[attr].ty) {
                                delete pc.sgn.nev.rep[attr].ty;
                            }

                            if (pc.sgn.nev.rep[attr].ri) {
                                delete pc.sgn.nev.rep[attr].ri;
                            }
                        }
                    }

                    noti_message['m2m:rqp'] = pc.sgn.nev.rep;
                    if (request.headers.bodytype == 'xml') {
                        noti_message['m2m:rqp']['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                        };

                        var xmlString = js2xmlparser("m2m:rqp", noti_message['m2m:rqp']);

                        pxymqtt_client.publish(noti_topic, xmlString);
                        console.log('<---- ' + noti_topic);
                    }
                    else { // 'json'
                        //pxymqtt_client.publish(noti_topic, JSON.stringify(noti_message));
                        noti_topic = noti_topic.replace('json', 'j');
                        pxymqtt_client.publish(noti_topic, pc.sgn.nev.rep[attr].con);
                        console.log('<---- ' + noti_topic);
                    }

                    console.log('----> 2001');
                    response.setHeader('X-M2M-RSC', '2001');
                    response.setHeader('X-M2M-RI', rqi);
                    response.status(201).end('{\"m2m:rsp\":\"success to receive notification\"}');
                }
                else {
                    noti_message['m2m:rqp'].pc['m2m:sgn'] = noti_message['m2m:rqp'].pc.sgn;
                    delete noti_message['m2m:rqp'].pc.sgn;

                    if (request.headers.bodytype == 'xml') {
                        noti_message['m2m:rqp']['@'] = {
                            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                        };

                        xmlString = js2xmlparser("m2m:rqp", noti_message['m2m:rqp']);

                        pxymqtt_client.publish(noti_topic, xmlString);
                        console.log('<---- ' + noti_topic);
                    }
                    else { // 'json'
                        pxymqtt_client.publish(noti_topic, JSON.stringify(noti_message));
                        console.log('<---- ' + noti_topic);
                    }
                }
            }
            else {
                console.log('pxymqtt is not ready');
            }
        }
        catch (e) {
            var rsp_Obj = {};
            rsp_Obj['rsp'] = {};
            rsp_Obj['rsp'].cap = 'notificationUrl does not support : ' + request.headers.nu;
            response.setHeader('X-M2M-RSC', '4000');
            response.setHeader('X-M2M-RI', rqi);

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
            console.log('cseid of register url is none');
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
            req_message['m2m:rqp'].to = '/'+request.headers.csebasename;
            req_message['m2m:rqp'].fr = request.headers['x-m2m-origin'];
            req_message['m2m:rqp'].rqi = rqi;
            req_message['m2m:rqp'].ty = '16';

            req_message['m2m:rqp'].pc = pc;

            if (request.headers.bodytype == 'xml') {
                req_message['m2m:rqp']['@'] = {
                    "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                };

                var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

                pxymqtt_client.publish(reg_req_topic, xmlString);
                console.log('<---- ' + reg_req_topic);
            }
            else { // 'json'
                pxymqtt_client.publish(reg_req_topic, JSON.stringify(req_message));
                console.log('<---- ' + reg_req_topic);
            }
        }
        else {
            console.log('pxymqtt is not ready');
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
            console.log('cseid of register url is none');
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
            req_message['m2m:rqp'].to = '/'+request.headers.csebasename;
            req_message['m2m:rqp'].fr = request.headers['x-m2m-origin'];
            req_message['m2m:rqp'].rqi = rqi;
            req_message['m2m:rqp'].ty = '16';

            req_message['m2m:rqp'].pc = pc;

            if (request.headers.bodytype == 'xml') {
                req_message['m2m:rqp']['@'] = {
                    "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                };

                var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

                pxymqtt_client.publish(reg_req_topic, xmlString);
                console.log('<---- ' + reg_req_topic);
            }
            else { // 'json'
                pxymqtt_client.publish(reg_req_topic, JSON.stringify(req_message));
                console.log('<---- ' + reg_req_topic);
            }
        }
        else {
            console.log('pxymqtt is not ready');
        }
    });
});


function http_retrieve_CSEBase(callback) {
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var resourceid = '/' + usecsebase;
    var options = {
        hostname: usemqttcbhost,
        port: usecsebaseport,
        path: resourceid,
        method: 'get',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': usecseid
        }
    };

    var responseBody = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function() {
            callback(res.headers['x-m2m-rsc'], responseBody);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[pxymqtt - http_retrieve_CSEBase] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write('');
    req.end();
}


//
//
// function mqtt_forwarding(mqtt_client, resp_cseid, op, to, fr, rqi, ty, nm, pc) {
//     NOPRINT == 'true' ? NOPRINT = 'true' : console.log('[mqtt_forwarding]');
//
//     var ri = util.format('/%s/%s', usecsebase, to);
//     var sql = util.format("select * from lookup where ri = \'%s\'", ri);
//     var queryJson = {};
//     queryJson.type = 'select';
//     queryJson.table = 'lookup';
//     queryJson.condition = 'direct';
//     db.getResult(sql, queryJson, function (err, results) {
//         if(!err) {
//             if (results.length == 1) {
//                 if(results[0].resourcetype == 16) {
//                     var forward_cseid = results[0].cseid;
//                 }
//                 else if(results[0].resourcetype == 2) {
//                     forward_cseid = results[0].aeid;
//                 }
//                 forward_mqtt(forward_cseid, op, to, fr, rqi, ty, nm, pc);
//             }
//             else {
//                 NOPRINT == 'true' ? NOPRINT = 'true' : console.log('csebase forwarding do not exist');
//                 var resp_topic = '/oneM2M/resp/' + topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5];
//                 mqtt_response(mqtt_client, resp_topic, 4004, fr, usecseid, rqi, '<h1>csebase forwarding do not exist</h1>');
//             }
//         }
//         else {
//             console.log('query error: ' + results.message);
//         }
//     });
// }
//

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

    var xmlString = js2xmlparser("m2m:rqp", forward_message);

    var forward_topic = util.format('/oneM2M/req/%s/%s', usecseid.replace('/', ':'), forward_cseid);

    for(var i = 0; i < mqtt_client_arr.length; i++) {
        mqtt_client_arr[i].publish(forward_topic, xmlString);
    }
}
