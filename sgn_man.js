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

var resp_mqtt_rqi_arr = [];
var resp_mqtt_rqi_arr_max_size = 512;
var http_response_q = {};

global.NOPRINT = 'true';

var _this = this;

var MAX_NUM_RETRY = 16;
var ss_fail_count = {};

var sgn_app = express();

var sgn_server = null;

if(use_secure === 'disable') {
    if(sgn_server == null) {
        http.globalAgent.maxSockets = 10000;
        sgn_server = http.createServer(sgn_app);
    }
}
else {
    if(sgn_server == null) {
        var options = {
            key: fs.readFileSync('server-key.pem'),
            cert: fs.readFileSync('server-crt.pem'),
            ca: fs.readFileSync('ca-crt.pem')
        };
        https.globalAgent.maxSockets = 10000;
        sgn_server = https.createServer(options, sgn_app);
    }
}

sgn_server.listen({port: use_sgn_man_port, agent: false}, function () {
    console.log('sgn_man server (' + ip.address() + ') running at ' + use_sgn_man_port + ' port');
});

sgn_server.on('connection', function (socket) {
    //console.log("A new connection was made by a client.");
    socket.setTimeout(5000, function () {
        if(ss_fail_count.hasOwnProperty(socket._httpMessage.req.headers.ri)) {
            ss_fail_count[socket._httpMessage.req.headers.ri]++;
        }

        for (var i = 0; i < resp_mqtt_rqi_arr.length; i++) {
            if (resp_mqtt_rqi_arr[i] == socket._httpMessage.req.headers['x-m2m-ri']) {
                delete http_response_q[resp_mqtt_rqi_arr[i]];
                resp_mqtt_rqi_arr.splice(i, 1);
                break;
            }
        }
    });
});

var sgn_mqtt_client = null;
if(use_secure === 'disable') {
    if(sgn_mqtt_client == null) {
        sgn_mqtt_client = mqtt.connect('mqtt://' + use_mqtt_broker + ':' + use_mqtt_port);
    }
}
else {
    if(sgn_mqtt_client == null) {
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
        sgn_mqtt_client = mqtt.connect(connectOptions);
    }
}

sgn_mqtt_client.on('connect', function () {
    console.log('sgn_mqtt_client is connected')
});

sgn_mqtt_client.on('message', sgn_mqtt_message_handler);


// for notification
var onem2mParser = bodyParser.text(
    {
        limit: '1mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);

sgn_app.post('/sgn', onem2mParser, function(request, response, next) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;

        try {
            if(ss_fail_count[request.headers.ri] == null) {
                ss_fail_count[request.headers.ri] = 0;
            }

            if(request.headers.exc != "" && ( request.headers.exc == 0 || request.headers.exc == '0')) {
                ss_fail_count[request.headers.ri] = 0;
            }

            if (ss_fail_count[request.headers.ri] >= MAX_NUM_RETRY) {
                delete ss_fail_count[request.headers.ri];
                delete_sub(request.headers.ri, request.headers['x-m2m-ri']);
                console.log('      [sgn_man] remove subscription because no response');
            }
            else {
                var sub_nu = url.parse(request.headers.nu);
                if (sub_nu.protocol == 'http:' || sub_nu.protocol == 'https:') {
                    request_noti_http(response, request.headers.nu, request.headers.ri, request.body, request.headers.bodytype, request.headers['x-m2m-ri']);
                }
                else if (sub_nu.protocol == 'coap:') {
                    request_noti_coap(response, request.headers.nu, request.headers.ri, request.body, request.headers.bodytype, request.headers['x-m2m-ri']);
                }
                else if (sub_nu.protocol == 'ws:') {
                    request_noti_ws(response, request.headers.nu, request.headers.ri, request.body, request.headers.bodytype, request.headers['x-m2m-ri']);
                }
                else if (sub_nu.protocol == 'mqtt:') { // mqtt:
                    request_noti_mqtt(response, request.headers.nu, request.headers.ri, request.body, request.headers.bodytype, request.headers['x-m2m-ri']);
                }
            }
        }
        catch (e) {
            NOPRINT==='true'?NOPRINT='true':console.log(e.message);
            var rsp_Obj = {};
            rsp_Obj['rsp'] = {};
            rsp_Obj['rsp'].dbg = 'notificationUrl does not support : ' + request.headers.nu;
            response.setHeader('X-M2M-RSC', '4000');
            response.status(400).end(JSON.stringify(rsp_Obj));
        }
    });
});

function req_sub() {
    var req_topic = util.format('/oneM2M/req/+/%s/+', usecseid.replace('/', ''));
    sgn_mqtt_client.subscribe(req_topic);
    console.log('subscribe req_topic as ' + req_topic);

    req_topic = util.format('/oneM2M/req/+/%s/+', usecsebase);
    sgn_mqtt_client.subscribe(req_topic);
    console.log('subscribe req_topic as ' + req_topic);
}

function reg_req_sub() {
    var reg_req_topic = util.format('/oneM2M/reg_req/+/%s/+', usecseid.replace('/', ''));
    sgn_mqtt_client.subscribe(reg_req_topic);
    console.log('subscribe reg_req_topic as ' + reg_req_topic);

    reg_req_topic = util.format('/oneM2M/reg_req/+/%s/+', usecsebase);
    sgn_mqtt_client.subscribe(reg_req_topic);
    console.log('subscribe reg_req_topic as ' + reg_req_topic);
}

function sgn_mqtt_message_handler(topic, message) {
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
                            else {
                            }

                            http_response_q[resp_mqtt_rqi_arr[i]].status(status_code).end(JSON.stringify(jsonObj['m2m:rsp'].pc));

                            delete ss_fail_count[http_response_q[resp_mqtt_rqi_arr[i]].req.headers.ri];
                            delete http_response_q[resp_mqtt_rqi_arr[i]];
                            resp_mqtt_rqi_arr.splice(i, 1);
                            break;
                        }
                    }
                }
            }
            else {
                console.log('[sgn_mqtt_message_handler] parsing error')
            }
        });
    }
    else {
        NOPRINT==='true'?NOPRINT='true':console.log('topic(' + topic + ') is not supported');
    }
}

function request_noti_http(response, nu, ri, bodyString, bodytype, xm2mri) {
    var bodyStr = '';
    var options = {
        hostname: url.parse(nu).hostname,
        port: url.parse(nu).port,
        path: url.parse(nu).path,
        method: 'POST',
        headers: {
            'X-M2M-RI': xm2mri,
            'Accept': 'application/' + bodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/' + bodytype,
            'Content-Length' : bodyString.length,
            'X-M2M-RVI': uservi
        }
    };

    function response_noti_http(res) {
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            if (res.statusCode == 200 || res.statusCode == 201) {
                //console.log('----> [request_noti_http - ' + ss_fail_count[ri] + ']');
                delete ss_fail_count[ri];

                response.setHeader('X-M2M-RSC', res.headers['x-m2m-rsc']);
                response.setHeader('X-M2M-RI', res.headers['x-m2m-ri']);

                response.status(res.statusCode).end(bodyStr);
            }
        });
    }

    if (url.parse(nu).protocol == 'http:') {
        var req = http.request(options, function (res) {
            response_noti_http(res);
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');

        req = https.request(options, function (res) {
            response_noti_http(res);
        });
    }

    req.on('error', function (e) {
        //console.log('[request_noti_http - problem with request: ' + e.message + ']');
        //console.log('[request_noti_http - no response - ' + ss_fail_count[ri] + ']');
    });

    req.on('close', function () {
        //console.log('[request_noti_http - close: no response for notification');
    });

    console.log('<------- [request_noti_http - ' + ss_fail_count[ri] + '] ');
    console.log(bodyString);
    req.write(bodyString);
    req.end();
}

function request_noti_coap(response, nu, ri, bodyString, bodytype, xm2mri) {
    var options = {
        host: url.parse(nu).hostname,
        port: url.parse(nu).port,
        pathname: url.parse(nu).path,
        method: 'post',
        confirmable: 'false',
        options: {
            'Accept': 'application/'+bodytype,
            'Content-Type': 'application/'+bodytype,
            'Content-Length' : bodyString.length
        }
    };

    var responseBody = '';
    var req = coap.request(options);
    req.setOption("256", new Buffer(usecseid));      // X-M2M-Origin
    req.setOption("257", new Buffer(xm2mri));    // X-M2M-RI
    req.on('response', function (res) {
        res.on('data', function () {
            responseBody += res.payload.toString();
        });

        res.on('end', function () {
            if(res.code == '2.03' || res.code == '2.01') {
                //console.log('----> [request_noti_coap] response for notification through coap  ' + res.code + ' - ' + ri);
                delete ss_fail_count[ri];

                response.setHeader('X-M2M-RSC', 2000);
                response.setHeader('X-M2M-RI', xm2mri);

                response.status(200).end(responseBody);
            }
        });
    });

    req.on('error', function (e) {
        //console.log('[request_noti_coap] problem with request: ' + e.message);
    });

    console.log('<------- [request_noti_coap - ' + ss_fail_count[ri] + '] ');
    console.log(bodyString);
    req.write(bodyString);
    req.end();
}

function request_noti_mqtt(response, nu, ri, bodyString, bodytype, xm2mri) {
    try {
        if(resp_mqtt_rqi_arr.length >= resp_mqtt_rqi_arr_max_size) {
            resp_mqtt_rqi_arr.splice(0, 1);
        }

        resp_mqtt_rqi_arr.push(xm2mri);
        http_response_q[xm2mri] = response;

        var aeid = url.parse(nu).pathname.replace('/', '').split('?')[0];
        var noti_resp_topic = '/oneM2M/resp/' + usecseid.replace('/', '') + '/' + aeid + '/' + bodytype;
        var noti_resp_topic2 = '/oneM2M/resp/' + usecsebase + '/' + aeid + '/' + bodytype;

        //noti_mqtt.unsubscribe(noti_resp_topic);
        sgn_mqtt_client.subscribe(noti_resp_topic);
        console.log('subscribe noti_resp_topic as ' + noti_resp_topic);

        sgn_mqtt_client.subscribe(noti_resp_topic2);
        console.log('subscribe noti_resp_topic as ' + noti_resp_topic2);

        var noti_topic = '/oneM2M/req/' + usecseid.replace('/', '') + '/' + aeid + '/' + bodytype;
        sgn_mqtt_client.publish(noti_topic, bodyString);
        console.log('<------- [request_noti_mqtt - ' + ss_fail_count[ri] + '] publish - ' + noti_topic);
        NOPRINT==='true'?NOPRINT='true':console.log(bodyString);
    }
    catch (e) {
        console.log(e.message);
        console.log('can not send notification to ' + nu);
    }
}


function request_noti_ws(response, nu, ri, bodyString, bodytype, xm2mri) {
    var bodyStr = '';

    if(use_secure == 'disable') {
        var WebSocketClient = require('websocket').client;
        var ws_client = new WebSocketClient();

        if(bodytype == 'xml') {
            ws_client.connect(nu, 'onem2m.r2.0.xml');
        }
        else if(bodytype == 'cbor') {
            ws_client.connect(nu, 'onem2m.r2.0.cbor');
        }
        else {
            ws_client.connect(nu, 'onem2m.r2.0.json');
        }

        ws_client.on('connectFailed', function (error) {
            ss_fail_count[ri]++;
            console.log('Connect Error: ' + error.toString() + ' - ' + ss_fail_count[ri]);
            ws_client.removeAllListeners();
        });

        ws_client.on('connect', function (connection) {
            console.log('<---- [request_noti_ws] ' + nu + ' - ' + bodyString);

            connection.sendUTF(bodyString);

            connection.on('error', function (error) {
                //console.log("[request_noti_ws] Connection Error: " + error.toString());

            });
            connection.on('close', function () {
                //console.log('[request_noti_ws] Connection Closed');
            });
            connection.on('message', function (message) {
                console.log(message.utf8Data.toString());

                //console.log('----> [request_noti_ws] ' + message.utf8Data.toString());

                delete ss_fail_count[ri];

                response.setHeader('X-M2M-RSC', 2000);
                response.setHeader('X-M2M-RI', xm2mri);

                response.status(200).end(message.utf8Data.toString());

                connection.close();
            });
        });
    }
    else {
        console.log('not support secure notification through ws');
    }
}


function delete_sub(ri, xm2mri) {
    var bodyStr = '';
    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: ri,
        method: 'DELETE',
        headers: {
            'X-M2M-RI': xm2mri,
            'Accept': 'application/json',
            'X-M2M-Origin': usesuperuser,
            'X-M2M-RVI': uservi
        }
    };

    function response_del_sub(res) {
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            if (res.statusCode == 200 || res.statusCode == 202) {
                console.log('----> [delete_sub - ' + res.statusCode + ']');
            }
        });
    }

    if(use_secure == 'disable') {
        var req = http.request(options, function (res) {
            response_del_sub(res);
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');
        req = https.request(options, function (res) {
            response_del_sub(res);
        });
    }

    req.on('error', function (e) {
        console.log('[delete_sub - problem with request: ' + e.message + ']');
    });

    req.on('close', function() {
        console.log('[delete_sub - close: no response for notification');
    });

    console.log('<---- [delete_sub - ]');
    req.write('');
    req.end();
}
