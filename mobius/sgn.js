/**
 * Copyright (c) 2017, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2017, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var util = require('util');
var url = require('url');
var http = require('http');
var https = require('https');
var coap = require('coap');
var js2xmlparser = require('js2xmlparser');
var xmlbuilder = require('xmlbuilder');
var fs = require('fs');
var db_sql = require('./sql_action');
var cbor = require("cbor");

var responder = require('./responder');

var ss_fail_count = {};

function make_xml_noti_message(pc, xm2mri) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
        //noti_message['m2m:rqp'].to = pc['m2m:sgn'].sur;
        noti_message['m2m:rqp'].fr = usecseid;
        noti_message['m2m:rqp'].rqi = xm2mri;
        noti_message['m2m:rqp'].pc = pc;

        for(var prop in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep) {
            if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep.hasOwnProperty(prop)) {
                for(var prop2 in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop]) {
                    if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop].hasOwnProperty(prop2)) {
                        if(prop2 == 'rn') {
                            noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop]['@'] = {rn : noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]};
                            delete noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2];
                            break;
                        }
                        else {
                            for (var prop3 in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]) {
                                if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2].hasOwnProperty(prop3)) {
                                    if (prop3 == 'rn') {
                                        noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]['@'] = {rn: noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2][prop3]};
                                        delete noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2][prop3];
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        noti_message['m2m:rqp']['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        return js2xmlparser.parse("m2m:rqp", noti_message['m2m:rqp']);
    }
    catch (e) {
        console.log('[make_xml_noti_message] xml parsing error');
    }
}

function make_cbor_noti_message(pc, xm2mri) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
        //noti_message['m2m:rqp'].to = pc['m2m:sgn'].sur;
        noti_message['m2m:rqp'].fr = usecseid;
        noti_message['m2m:rqp'].rqi = xm2mri;

        noti_message['m2m:rqp'].pc = pc;

        return cbor.encode(noti_message['m2m:rqp']).toString('hex');
    }
    catch (e) {
        console.log('[make_cbor_noti_message] cbor parsing error');
    }
}

function make_json_noti_message(nu, pc, xm2mri, short_flag) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        noti_message['m2m:rqp'].rqi = xm2mri;

        if(short_flag == 1) {

        }
        else {
            noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
            noti_message['m2m:rqp'].to = nu;
            noti_message['m2m:rqp'].fr = usecseid;
        }

        noti_message['m2m:rqp'].pc = pc;

        return JSON.stringify(noti_message['m2m:rqp']);
    }
    catch (e) {
        console.log('[make_json_noti_message] json parsing error');
    }
}

function sgn_action(rootnm, check_value, results_ss, noti_Obj, sub_bodytype) {
    var enc_Obj = JSON.parse(results_ss.enc);
    var net_arr = enc_Obj.net;

    for (var j = 0; j < net_arr.length; j++) {
        if (net_arr[j] == check_value) { // 1 : Update_of_Subscribed_Resource, 3 : Create_of_Direct_Child_Resource, 4 : Delete_of_Direct_Child_Resource
            var nu_arr = JSON.parse(results_ss.nu);
            for (var k = 0; k < nu_arr.length; k++) {
                var nu = nu_arr[k];
                var sub_nu = url.parse(nu);
                var nct = results_ss.nct;

                var node = {};
                if (nct == 2 || nct == 1) {
                    node['m2m:sgn'] = {};
                    node['m2m:sgn'].net = check_value.toString();
                    node['m2m:sgn'].sur = results_ss.ri;
                    node['m2m:sgn'].nec = results_ss.nec;
                    node['m2m:sgn'].nev = {};
                    node['m2m:sgn'].nev.rep = {};
                    node['m2m:sgn'].nev.rep['m2m:'+rootnm] = noti_Obj;

                    responder.typeCheckforJson(node['m2m:sgn'].nev.rep);

                    //cur_d = new Date();
                    //msec = (parseInt(cur_d.getMilliseconds(), 10)<10) ? ('00'+cur_d.getMilliseconds()) : ((parseInt(cur_d.getMilliseconds(), 10)<100) ? ('0'+cur_d.getMilliseconds()) : cur_d.getMilliseconds());
                    //xm2mri = 'rqi-' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec + randomValueBase64(4);
                    var xm2mri = require('shortid').generate();
                    var short_flag = 0;

                    if(sub_nu.query != null) {
                        var sub_nu_query_arr = sub_nu.query.split('&');
                        for(var prop in sub_nu_query_arr) {
                            if (sub_nu_query_arr.hasOwnProperty(prop)) {
                                if (sub_nu_query_arr[prop].split('=')[0] == 'ct') {
                                    if (sub_nu_query_arr[prop].split('=')[1] == 'xml') {
                                        sub_bodytype = 'xml';
                                    }
                                    else {
                                        sub_bodytype = 'json';
                                    }
                                }

                                else if (sub_nu_query_arr[prop].split('=')[0] == 'rcn') {
                                    if (sub_nu_query_arr[prop].split('=')[1] == '9') {

                                        for (var index in node['m2m:sgn'].nev.rep) {
                                            if (node['m2m:sgn'].nev.rep.hasOwnProperty(index)) {
                                                if (node['m2m:sgn'].nev.rep[index].cr) {
                                                    delete node['m2m:sgn'].nev.rep[index].cr;
                                                }

                                                if (node['m2m:sgn'].nev.rep[index].st) {
                                                    delete node['m2m:sgn'].nev.rep[index].st;
                                                }

                                                delete node['m2m:sgn'].nev.rep[index].ct;
                                                delete node['m2m:sgn'].nev.rep[index].lt;
                                                delete node['m2m:sgn'].nev.rep[index].et;
                                                delete node['m2m:sgn'].nev.rep[index].ri;
                                                delete node['m2m:sgn'].nev.rep[index].pi;
                                                delete node['m2m:sgn'].nev.rep[index].rn;
                                                delete node['m2m:sgn'].nev.rep[index].ty;
                                                delete node['m2m:sgn'].nev.rep[index].fr;

                                                short_flag = 1;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (sub_bodytype == 'xml') {
                        if (sub_nu.protocol == 'http:') {
                            node[Object.keys(node)[0]]['@'] = {
                                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                            };

                            var bodyString = js2xmlparser.parse(Object.keys(node)[0], node[Object.keys(node)[0]]);
                            request_noti_http(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                        else if (sub_nu.protocol == 'coap:') {
                            node[Object.keys(node)[0]]['@'] = {
                                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                            };

                            bodyString = js2xmlparser.parse(Object.keys(node)[0], node[Object.keys(node)[0]]);
                            request_noti_coap(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                        else if (sub_nu.protocol == 'ws:') {
                            bodyString = make_xml_noti_message(node, xm2mri);
                            request_noti_ws(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                        else { // mqtt:
                            bodyString = make_xml_noti_message(node, xm2mri);
                            request_noti_mqtt(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                    }
                    else if (sub_bodytype == 'cbor') {
                        if (sub_nu.protocol == 'http:') {
                            //node['m2m:'+Object.keys(node)[0]] = node[Object.keys(node)[0]];
                            //delete node[Object.keys(node)[0]];
                            bodyString = cbor.encode(node).toString('hex');
                            request_noti_http(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                        else if (sub_nu.protocol == 'coap:') {
                            //node['m2m:'+Object.keys(node)[0]] = node[Object.keys(node)[0]];
                            //delete node[Object.keys(node)[0]];
                            bodyString = cbor.encode(node).toString('hex');
                            request_noti_coap(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                        else if (sub_nu.protocol == 'ws:') {
                            bodyString = make_cbor_noti_message(node, xm2mri);
                            request_noti_ws(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                        else { // mqtt:
                            bodyString = make_cbor_noti_message(node, xm2mri);
                            request_noti_mqtt(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                    }
                    else { // defaultbodytype == 'json')
                        if (sub_nu.protocol == 'http:') {
                            //node['m2m:'+Object.keys(node)[0]] = node[Object.keys(node)[0]];
                            //delete node[Object.keys(node)[0]];
                            request_noti_http(nu, results_ss.ri, JSON.stringify(node), sub_bodytype, xm2mri);
                        }
                        else if (sub_nu.protocol == 'coap:') {
                            //node['m2m:'+Object.keys(node)[0]] = node[Object.keys(node)[0]];
                            //delete node[Object.keys(node)[0]];
                            request_noti_coap(nu, results_ss.ri, JSON.stringify(node), sub_bodytype, xm2mri);
                        }
                        else if (sub_nu.protocol == 'ws:') {
                            bodyString = make_json_noti_message(nu, node, xm2mri, short_flag);
                            request_noti_ws(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                        else { // mqtt:
                            bodyString = make_json_noti_message(nu, node, xm2mri, short_flag);
                            request_noti_mqtt(nu, results_ss.ri, bodyString, sub_bodytype, xm2mri);
                        }
                    }
                }
                else {
                    console.log('nct except 2 (All Attribute) do not support');
                }
            }
        }
        //else {
        //    console.log('enc-net except 3 do not support');
        //}
    }
}

exports.check = function(request, notiObj, check_value) {
    var rootnm = request.headers.rootnm;


    if((request.method == "PUT" && check_value == 1)) {
        var pi = notiObj.ri;
    }
    else if ((request.method == "POST" && check_value == 3) || (request.method == "DELETE" && check_value == 4)) {
        pi = notiObj.pi;
    }

    var noti_Str = JSON.stringify(notiObj);

    db_sql.select_sub(pi, function (err, results_ss) {
        if (!err) {
            for (var i = 0; i < results_ss.length; i++) {
                var noti_Obj = JSON.parse(noti_Str);

                if(results_ss[i].ri == noti_Obj.ri) {
                    continue;
                }
                //var cur_d = new Date();
                //var msec = (parseInt(cur_d.getMilliseconds(), 10)<10) ? ('00'+cur_d.getMilliseconds()) : ((parseInt(cur_d.getMilliseconds(), 10)<100) ? ('0'+cur_d.getMilliseconds()) : cur_d.getMilliseconds());
                //var xm2mri = 'rqi-' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec + randomValueBase64(4);
                var xm2mri = require('shortid').generate();
                if (ss_fail_count[results_ss[i].ri] == null) {
                    ss_fail_count[results_ss[i].ri] = 0;
                }
                //ss_fail_count[results_ss[i].ri]++;
                //if (ss_fail_count[results_ss[i].ri] >= 8) {
                //    delete ss_fail_count[results_ss[i].ri];
                //    delete_sub(results_ss[i].ri, xm2mri);
                //    sgn_action(rootnm, check_value, results_ss[i], noti_Obj, request.headers.usebodytype);
                //}
                //else {
                    sgn_action(rootnm, check_value, results_ss[i], noti_Obj, request.headers.usebodytype);
                //}
            }
        }
        else {
            console.log('query error: ' + results_ss.message);
        }
    });
};


function request_noti_http(nu, ri, bodyString, bodytype, xm2mri) {
    var bodyStr = '';
    var options = {
        hostname: url.parse(nu).hostname,
        port: url.parse(nu).port,
        path: url.parse(nu).path,
        method: 'POST',
        headers: {
            'X-M2M-RI': xm2mri,
            'Accept': 'application/'+bodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/'+bodytype,
            'ri': ri
        }
    };

    function response_noti_http(res) {
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            if (res.statusCode == 200 || res.statusCode == 201) {
                ss_fail_count[res.req._headers.ri] = 0;
                console.log('----> [request_noti_http - ' + ss_fail_count[res.req._headers.ri] + ']');
            }
        });
    }

    if(url.parse(nu).protocol == 'http:') {
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
        console.log('[request_noti_http - problem with request: ' + e.message + ']');
        console.log('[request_noti_http - no response - ' + ss_fail_count[req._headers.ri] + ']');
        if (ss_fail_count[req._headers.ri] > 8) {
            delete ss_fail_count[req._headers.ri];
            delete_sub(req._headers.ri, xm2mri);
        }
    });

    req.on('close', function() {
        console.log('[request_noti_http - close: no response for notification');
    });

    ss_fail_count[req._headers.ri]++;
    console.log('<---- [request_noti_http - ' + ss_fail_count[req._headers.ri] + '] ');
    req.write(bodyString);
    req.end();
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
            if(res.code == '2.03' || res.code == '2.01') {
                ss_fail_count[ri] = 0;
                console.log('----> [request_noti_coap] response for notification through coap  ' + res.code + ' - ' + ri);
            }
        });
    });

    console.log('<---- [request_noti_coap] request for notification through coap with ' + bodytype);

    req.write(bodyString);
    req.end();
}

function request_noti_mqtt(nu, ri, bodyString, bodytype, xm2mri) {
    var bodyStr = '';
    var options = {
        hostname: 'localhost',
        port: usepxymqttport,
        path: '/notification',
        method: 'POST',
        headers: {
            'X-M2M-RI': xm2mri,
            'Accept': 'application/' + bodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/' + bodytype,
            'nu': nu,
            'bodytype': bodytype,
            'ri': ri
        }
    };

    function response_noti_mqtt(res) {
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            if (res.statusCode == 200 || res.statusCode == 201) {
                ss_fail_count[res.req._headers.ri] = 0;
                console.log('----> [request_noti_mqtt - ' + ss_fail_count[res.req._headers.ri] + ']');
            }
        });
    }

    if(usesecure == 'disable') {
        var req = http.request(options, function (res) {
            response_noti_mqtt(res);
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');
        req = https.request(options, function (res) {
            response_noti_mqtt(res);
        });
    }

    req.on('error', function (e) {
        console.log('[request_noti_mqtt - problem with request: ' + e.message + ']');
        console.log('[request_noti_mqtt - no response - ' + ss_fail_count[req._headers.ri] + ']');
        if (ss_fail_count[req._headers.ri] > 8) {
            delete ss_fail_count[req._headers.ri];
            delete_sub(req._headers.ri, xm2mri);
        }
    });

    req.on('close', function() {
        console.log('[request_noti_mqtt - close: no response for notification');
    });

    ss_fail_count[req._headers.ri]++;
    console.log('<---- [request_noti_mqtt - ' + ss_fail_count[req._headers.ri] + '] ');
    req.write(bodyString);
    req.end();
}


function request_noti_ws(nu, ri, bodyString, bodytype, xm2mri) {
    var bodyStr = '';

    if(usesecure == 'disable') {
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

            if (ss_fail_count[ri] >= 8) {
                delete ss_fail_count[ri];
                delete_sub(ri, xm2mri);
            }
        });

        ws_client.on('connect', function (connection) {
            console.log('<---- [request_noti_ws] ' + nu + ' - ' + bodyString);

            connection.sendUTF(bodyString);

            connection.on('error', function (error) {
                console.log("[request_noti_ws] Connection Error: " + error.toString());

            });
            connection.on('close', function () {
                console.log('[request_noti_ws] Connection Closed');
            });
            connection.on('message', function (message) {
                console.log(message.utf8Data.toString());

                console.log('----> [request_noti_ws] ' + message.utf8Data.toString());
                ss_fail_count[ri] = 0;

                connection.close();
            });
        });
    }
    else {
        console.log('not support secure notification through ws');
    }
}

function delete_sub(ri, xm2mri) {
    db_sql.delete_ri_lookup(ri, function (err) {
        if (!err) {
            console.log('delete sgn of ' + ri + ' for no response');
        }
    });
}

