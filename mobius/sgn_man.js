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
var mqtt = require('mqtt');
var url = require('url');

var db = require('./db_action');
var db_sql = require('./sql_action');

var resp_mqtt_rqi_arr = {};

global.NOPRINT = 'true';

var _this = this;

var resp_timeout = 2500;

var MAX_NUM_RETRY = 16;
var ss_fail_count = {};

var sgn_mqtt_client = null;

if(sgn_mqtt_client == null) {
    if(use_secure === 'disable') {
        sgn_mqtt_client = mqtt.connect('mqtt://' + use_mqtt_broker + ':' + use_mqtt_port);
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
        sgn_mqtt_client = mqtt.connect(connectOptions);
    }

    sgn_mqtt_client.on('connect', function () {
        console.log('sgn_mqtt_client is connected');
    });

    sgn_mqtt_client.on('message', sgn_mqtt_message_handler);

    sgn_mqtt_client.on('error', function () {
        sgn_mqtt_client = null;
    });
}

exports.post = function(ri, exc, nu, bodytype, rqi, bodyString, parentObj) {
    try {
        if(ss_fail_count.hasOwnProperty(ri)) {
            if(exc != "" && ( exc == 0 || exc == '0')) {
                ss_fail_count[ri] = 0;
            }
        }
        else {
            ss_fail_count[ri] = 0;
        }

        if (ss_fail_count[ri] >= MAX_NUM_RETRY) {
            var aeid = url.parse(nu).pathname.replace('/', '').split('?')[0];
            var noti_resp_topic = '/oneM2M/resp/' + usecseid.replace('/', '') + '/' + aeid + '/' + bodytype;
            sgn_mqtt_client.unsubscribe(noti_resp_topic);

            delete ss_fail_count[ri];
            delete_sub(ri, rqi, parentObj);
        }
        else {
            delete parentObj;
            parentObj = null;
            var sub_nu = url.parse(nu);
            if (sub_nu.protocol == 'http:' || sub_nu.protocol == 'https:') {
                request_noti_http(nu, ri, bodyString, bodytype, rqi);
            }
            else if (sub_nu.protocol == 'coap:') {
                request_noti_coap(nu, ri, bodyString, bodytype, rqi);
            }
            else if (sub_nu.protocol == 'ws:') {
                request_noti_ws(nu, ri, bodyString, bodytype, rqi);
            }
            else if (sub_nu.protocol == 'mqtt:') { // mqtt:
                request_noti_mqtt(nu, ri, bodyString, bodytype, rqi);
            }
            nu = null;
        }
    }
    catch (e) {
        console.log('[sgn_man] post function exception - ' + e.message);
    }
};

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
                    if(timerID.hasOwnProperty(jsonObj['m2m:rsp'].rqi)) {
                        clearTimeout(timerID[jsonObj['m2m:rsp'].rqi]);
                        delete timerID[jsonObj['m2m:rsp'].rqi];
                        //sgn_mqtt_client.unsubscribe(topic);
                    }

                    if(resp_mqtt_rqi_arr.hasOwnProperty(jsonObj['m2m:rsp'].rqi)) {
                        console.log('=======> [response_noti_mqtt]' + resp_mqtt_rqi_arr[jsonObj['m2m:rsp'].rqi]);
                        delete ss_fail_count[resp_mqtt_rqi_arr[jsonObj['m2m:rsp'].rqi]];
                        delete resp_mqtt_rqi_arr[jsonObj['m2m:rsp'].rqi];
                    }
                }
                delete jsonObj;
                jsonObj = null;
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

function request_noti_http(nu, ri, bodyString, bodytype, xm2mri) {
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
            'Content-Length' : bodyString.length //, for cert
            //'X-M2M-RVI': uservi
            //
        }
    };

    function response_noti_http(res) {
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            // if (res.statusCode == 200 || res.statusCode == 201) {
            //     //console.log('----> [request_noti_http - ' + ss_fail_count[ri] + ']');
            //     delete ss_fail_count[ri];
            // }
            // else {
            //     console.log('----> [request_noti - wrong response - ' + res.statusCode + ']');
            // }

            if(timerID.hasOwnProperty(xm2mri)) {
                clearTimeout(timerID[xm2mri]);
                delete timerID[xm2mri];
            }

            if(ss_fail_count.hasOwnProperty(ri)) {
                console.log('=======> [response_noti_http] - ' + ri);
                delete ss_fail_count[ri];
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
        //console.log('[request_noti_http] - close event - ' + ri + ' - ' + xm2mri);
    });

    req.on('socket',function(socket) {
        console.log('<======= [request_noti_http] - socket event - ' + ri + ' - ' + xm2mri);
        timerID[xm2mri] = setTimeout(checkResponse, resp_timeout, ri, xm2mri, socket);
    });

    console.log(bodyString);
    req.write(bodyString);
    req.end();
}

function checkResponse(ri, rqi, socket) {
    console.log('[checkResponse]');

    if(timerID.hasOwnProperty(rqi)) {
        delete timerID[rqi];

        if(socket != null) {
            socket.destroy();
        }
    }

    if(ss_fail_count.hasOwnProperty(ri)) {
        ss_fail_count[ri]++;
        console.log('=XXXXX=> [' + ss_fail_count[ri] + '] ' + ri);

        // if (ss_fail_count[ri] >= MAX_NUM_RETRY) {
        //     delete_sub(ri, rqi);
        //     console.log('      [sgn_man] remove subscription because no response');
        // }
    }
}

function request_noti_coap(nu, ri, bodyString, bodytype, xm2mri) {
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
            // if(res.code == '2.03' || res.code == '2.01') {
            //     //console.log('----> [request_noti_coap] response for notification through coap  ' + res.code + ' - ' + ri);
            //     delete ss_fail_count[ri];
            // }

            if(timerID.hasOwnProperty(xm2mri)) {
                clearTimeout(timerID[xm2mri]);
                delete timerID[xm2mri];
            }

            if(ss_fail_count.hasOwnProperty(ri)) {
                console.log('=======> [response_noti_coap] - ' + ri);
                delete ss_fail_count[ri];
            }
        });
    });

    req.on('error', function (e) {
        //console.log('[request_noti_coap] problem with request: ' + e.message);
    });

    req.on('socket',function(socket) {
        console.log('<======= [request_noti_coap] - socket event - ' + ri + ' - ' + xm2mri);
        timerID[xm2mri] = setTimeout(checkResponse, resp_timeout, ri, xm2mri, socket);
    });

    console.log(bodyString);
    req.write(bodyString);
    req.end();
}

var timerID = {};
function request_noti_mqtt(nu, ri, bodyString, bodytype, xm2mri) {
    try {
        resp_mqtt_rqi_arr[xm2mri] = ri;

        var aeid = url.parse(nu).pathname.replace('/', '').split('?')[0];
        var noti_resp_topic = '/oneM2M/resp/' + usecseid.replace('/', '') + '/' + aeid + '/' + bodytype;

        sgn_mqtt_client.subscribe(noti_resp_topic);
        console.log('subscribe noti_resp_topic as ' + noti_resp_topic);

        var noti_topic = '/oneM2M/req/' + usecseid.replace('/', '') + '/' + aeid + '/' + bodytype;
        sgn_mqtt_client.publish(noti_topic, bodyString);

        timerID[xm2mri] = setTimeout(checkResponseMqtt, resp_timeout, ri, noti_resp_topic, xm2mri);

        console.log('<======= [request_noti_mqtt - ' + ri + '] publish - ' + noti_topic);
        //console.log(bodyString);
    }
    catch (e) {
        console.log(e.message);
        console.log('can not send notification to ' + nu);
    }
}

function checkResponseMqtt(ri, resp_topic, rqi) {
    console.log('[checkResponseMqtt]');

    if(timerID.hasOwnProperty(rqi)) {
        delete timerID[rqi];
//        sgn_mqtt_client.unsubscribe(resp_topic);
    }

    if(resp_mqtt_rqi_arr.hasOwnProperty(rqi)) {
        delete resp_mqtt_rqi_arr[rqi];
    }

    if(ss_fail_count.hasOwnProperty(ri)) {
        ss_fail_count[ri]++;
        console.log('=XXXXX=> [' + ss_fail_count[ri] + '] ' + ri);

        // if (ss_fail_count[ri] >= MAX_NUM_RETRY) {
        //     delete_sub(ri, rqi);
        //     console.log('      [sgn_man] remove subscription because no response');
        // }
    }
}

function request_noti_ws(nu, ri, bodyString, bodytype, xm2mri) {
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

        ws_client.on('connect', function (conn) {
            console.log('<======= [request_noti_ws] - connection - ' + ri + ' - ' + xm2mri);
            timerID[xm2mri] = setTimeout(checkResponse, resp_timeout, ri, xm2mri, conn);

            conn.sendUTF(bodyString);

            conn.on('error', function (error) {
                //console.log("[request_noti_ws] Connection Error: " + error.toString());

            });
            conn.on('close', function () {
                //console.log('[request_noti_ws] Connection Closed');
            });
            conn.on('message', function (message) {
                console.log(message.utf8Data.toString());

                //console.log('----> [request_noti_ws] ' + message.utf8Data.toString());

                //delete ss_fail_count[ri];

                if(timerID.hasOwnProperty(xm2mri)) {
                    clearTimeout(timerID[xm2mri]);
                    delete timerID[xm2mri];
                }

                if(ss_fail_count.hasOwnProperty(ri)) {
                    console.log('=======> [response_noti_ws] - ' + ri);
                    delete ss_fail_count[ri];
                }

                conn.close();
            });
        });
    }
    else {
        console.log('[request_noti_ws] not support secure notification through ws');
    }
}



function delete_sub(ri, xm2mri, parentObj) {
    db.getConnection(function (code, connection) {
        if(code === '200') {
            for (var idx in parentObj.subl) {
                if (parentObj.subl.hasOwnProperty(idx)) {
                    if (parentObj.subl[idx].ri == ri) {
                        parentObj.subl.splice(idx, 1);
                    }
                }
            }

            db_sql.update_lookup(connection, parentObj, function (err, results) {
                if (!err) {
                    db_sql.delete_ri_lookup(connection, ri, function () {
                        console.log('      [sgn_man] remove subscription because no response');
                        parentObj = null;
                        connection.release();
                    });
                }
                else {
                    connection.release();
                }
            });
        }
        else {
            console.log('[delete_sub] - No Connection');
        }
    });
}
