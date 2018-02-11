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
var util = require('util');
var xml2js = require('xml2js');
var js2xmlparser = require('js2xmlparser');
var url = require('url');
var xmlbuilder = require('xmlbuilder');
var moment = require('moment');
var ip = require("ip");
var events = require('events');
var cbor = require('cbor');

var WebSocketServer = require('websocket').server;

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
        if(usesecure === 'disable') {
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

                for (var index in request.requestedProtocols) {
                    if(request.requestedProtocols.hasOwnProperty(index)) {
                        if(request.requestedProtocols[index] === 'onem2m.r2.0.xml') {
                            var connection = request.accept('onem2m.r2.0.xml', request.origin);
                            console.log((new Date()) + ' Connection accepted. (xml)');
                            connection.on('message', ws_message_handler);
                            connection.on('close', function (reasonCode, description) {
                                console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
                            });
                            break;
                        }
                        else if(request.requestedProtocols[index] === 'onem2m.r2.0.cbor') {
                            var connection = request.accept('onem2m.r2.0.cbor', request.origin);
                            console.log((new Date()) + ' Connection accepted. (cbor)');
                            connection.on('message', ws_message_handler);
                            connection.on('close', function (reasonCode, description) {
                                console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
                            });
                            break;
                        }
                        else if(request.requestedProtocols[index] === 'onem2m.r2.0.json') {
                            var connection = request.accept('onem2m.r2.0.json', request.origin);
                            console.log((new Date()) + ' Connection accepted. (json)');
                            connection.on('message', ws_message_handler);
                            connection.on('close', function (reasonCode, description) {
                                console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
                            });
                            break;
                        }
                    }
                }
            });
        }
    }
};

var ws_tid = require('shortid').generate();
wdt.set_wdt(ws_tid, 2, _this.ws_watchdog);

function make_json_obj(bodytype, str, callback) {
    try {
        if (bodytype == 'xml') {
            var message = str;
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(message.toString(), function (err, result) {
                if (err) {
                    console.log('[ws make json obj] xml2js parser error]');
                    callback('0');
                }
                else {
                    for (var prop in result) {
                        if (result.hasOwnProperty(prop)) {
                            for (var attr in result[prop]) {
                                if (result[prop].hasOwnProperty(attr)) {
                                    if (attr == '$') {
                                        delete result[prop][attr];
                                    }
                                    else if (attr == 'pc') {
                                        for (var attr2 in result[prop][attr]) {
                                            if (result[prop][attr].hasOwnProperty(attr2)) {
                                                if (result[prop][attr][attr2].at) {
                                                    result[prop][attr][attr2].at = result[prop][attr][attr2].at.split(' ');
                                                }

                                                if (result[prop][attr][attr2].aa) {
                                                    result[prop][attr][attr2].aa = result[prop][attr][attr2].aa.split(' ');
                                                }

                                                if (result[prop][attr][attr2].poa) {
                                                    result[prop][attr][attr2].poa = result[prop][attr][attr2].poa.split(' ');
                                                }

                                                if (result[prop][attr][attr2].lbl) {
                                                    result[prop][attr][attr2].lbl = result[prop][attr][attr2].lbl.split(' ');
                                                }

                                                if (result[prop][attr][attr2].acpi) {
                                                    result[prop][attr][attr2].acpi = result[prop][attr][attr2].acpi.split(' ');
                                                }

                                                if (result[prop][attr][attr2].srt) {
                                                    result[prop][attr][attr2].srt = result[prop][attr][attr2].srt.split(' ');
                                                }

                                                if (result[prop][attr][attr2].nu) {
                                                    result[prop][attr][attr2].nu = result[prop][attr][attr2].nu.split(' ');
                                                }

                                                if (result[prop][attr][attr2].enc) {
                                                    if (result[prop][attr][attr2].enc.net) {
                                                        result[prop][attr][attr2].enc.net = result[prop][attr][attr2].enc.net.split(' ');
                                                    }
                                                }

                                                if (result[prop][attr][attr2].pv) {
                                                    if (result[prop][attr][attr2].pv.acr) {
                                                        if (!Array.isArray(result[prop][attr][attr2].pv.acr)) {
                                                            var temp = result[prop][attr][attr2].pv.acr;
                                                            result[prop][attr][attr2].pv.acr = [];
                                                            result[prop][attr][attr2].pv.acr[0] = temp;
                                                        }

                                                        for (var acr_idx in result[prop][attr][attr2].pv.acr) {
                                                            if (result[prop][attr][attr2].pv.acr.hasOwnProperty(acr_idx)) {
                                                                if (result[prop][attr][attr2].pv.acr[acr_idx].acor) {
                                                                    result[prop][attr][attr2].pv.acr[acr_idx].acor = result[prop][attr][attr2].pv.acr[acr_idx].acor.split(' ');
                                                                }
                                                            }
                                                        }
                                                    }
                                                }

                                                if (result[prop][attr][attr2].pvs) {
                                                    if (result[prop][attr][attr2].pvs.acr) {
                                                        if (!Array.isArray(result[prop][attr][attr2].pvs.acr)) {
                                                            temp = result[prop][attr][attr2].pvs.acr;
                                                            result[prop][attr][attr2].pvs.acr = [];
                                                            result[prop][attr][attr2].pvs.acr[0] = temp;
                                                        }

                                                        for (acr_idx in result[prop][attr][attr2].pvs.acr) {
                                                            if (result[prop][attr][attr2].pvs.acr.hasOwnProperty(acr_idx)) {
                                                                if (result[prop][attr][attr2].pvs.acr[acr_idx].acor) {
                                                                    result[prop][attr][attr2].pvs.acr[acr_idx].acor = result[prop][attr][attr2].pvs.acr[acr_idx].acor.split(' ');
                                                                }
                                                            }
                                                        }
                                                    }
                                                }

                                                if (result[prop][attr][attr2].mid) {
                                                    result[prop][attr][attr2].mid = result[prop][attr][attr2].mid.split(' ');
                                                }

                                                if (result[prop][attr][attr2].macp) {
                                                    result[prop][attr][attr2].macp = result[prop][attr][attr2].macp.split(' ');
                                                }

                                                if (result[prop][attr][attr2]['$']) {
                                                    if (result[prop][attr][attr2]['$'].rn && result[prop][attr][attr2]['$'].rn != '') {
                                                        result[prop][attr][attr2].rn = result[prop][attr][attr2]['$'].rn;
                                                        delete result[prop][attr][attr2]['$'];
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    callback('1', result);
                }
            });
        }
        else if (bodytype === 'cbor') {
            cbor.decodeFirst(str, function(err, result) {
                if (err) {
                    console.log('[mqtt make json obj] cbor parser error]');
                }
                else {
                    if(result['m2m:rqp'] == null) {
                        if(result['op'] == null) {
                            callback('0');
                        }
                        else {
                            result['m2m:rqp'] = result;
                            callback('1', result);
                        }
                    }
                    else {
                        callback('1', result);
                    }
                }
            });
        }
        else {
            var result = JSON.parse(str);

            if(result['m2m:rqp'] == null) {
                if(result['op'] == null) {
                    callback('0');
                }
                else {
                    result['m2m:rqp'] = result;
                    callback('1', result);
                }
            }
            else {
                callback('1', result);
            }
        }
    }
    catch (e) {
        console.error(e.message);
        callback('0');
    }
}

function ws_message_handler(message) {
    var _this = this;
    if(message.type === 'utf8') {
        console.log(message.utf8Data.toString());

        var protocol_arr = this.protocol.split('.');
        var bodytype = protocol_arr[protocol_arr.length-1];

        make_json_obj(bodytype, message.utf8Data.toString(), function(rsc, result) {
            if(rsc == '1') {
                ws_message_action(_this, bodytype, result);
            }
            else {
                ws_response(_this, 4000, '', '', '', 'to parsing error', bodytype);
            }
        });
    }
    else if(message.type === 'binary') {

    }
}

function ws_message_action(connection, bodytype, jsonObj) {
    if (jsonObj['m2m:rqp'] != null) {
        var op = (jsonObj['m2m:rqp'].op == null) ? '' : jsonObj['m2m:rqp'].op;
        var to = (jsonObj['m2m:rqp'].to == null) ? '' : jsonObj['m2m:rqp'].to;
        if(to.split(usespid + '/' + usecseid + '/' + usecsebase)[0] == '') { // Absolute
            var to_arr = to.split(usespid + '/' + usecseid + '/' + usecsebase);
            to='/'+usecsebase;
            for(var i = 1; i < to_arr.length; i++) {
                to += '/';
                to += to_arr[i];
            }
        }
        else if(to.split(usecseid + '/' + usecsebase)[0] == '') { // SP Relative
            var to_arr = to.split(usespid + '/' + usecseid + '/' + usecsebase);
            to='/'+usecsebase;
            for(i = 1; i < to_arr.length; i++) {
                to += '/';
                to += to_arr[i];
            }
        }
        else if(to.split(usecsebase)[0] == '') { // CSE Relative
            var to_arr = to.split(usespid + '/' + usecseid + '/' + usecsebase);
            to='/'+usecsebase;
            for(i = 1; i < to_arr.length; i++) {
                to += '/';
                to += to_arr[i];
            }
        }
        var fr = (jsonObj['m2m:rqp'].fr == null) ? '' : jsonObj['m2m:rqp'].fr;
        var rqi = (jsonObj['m2m:rqp'].rqi == null) ? '' : jsonObj['m2m:rqp'].rqi;
        var ty = (jsonObj['m2m:rqp'].ty == null) ? '' : jsonObj['m2m:rqp'].ty.toString();
        var pc = (jsonObj['m2m:rqp'].pc == null) ? '' : jsonObj['m2m:rqp'].pc;

        if(jsonObj['m2m:rqp'].fc) {
            var query_count = 0;
            for(var fc_idx in jsonObj['m2m:rqp'].fc) {
                if(jsonObj['m2m:rqp'].fc.hasOwnProperty(fc_idx)) {
                    if(query_count == 0) {
                        to += '?';
                    }
                    else {
                        to += '&';
                    }
                    to += fc_idx;
                    to += '=';
                    to += jsonObj['m2m:rqp'].fc[fc_idx].toString();
                }
            }
        }

        try {
            if (to.split('/')[1].split('?')[0] == usecsebase) {
                ws_binding(op, to, fr, rqi, ty, pc, bodytype, function (res, res_body) {
                    if (res_body == '') {
                        res_body = '{}';
                    }
                    ws_response(connection, res.headers['x-m2m-rsc'], to, usecseid, rqi, JSON.parse(res_body), bodytype);
                });
            }
            else {
                ws_response(connection, 4004, fr, usecseid, rqi, 'this is not MN-CSE, csebase do not exist', bodytype);
            }
        }
        catch (e) {
            console.error(e);
            ws_response(connection, 5000, fr, usecseid, rqi, 'to parsing error', bodytype);
        }
    }
    else {
        console.log('ws message tag is not different : m2m:rqp');

        ws_response(connection, 4000, "", usecseid, "", '\"m2m:dbg\":\"ws message tag is different : m2m:rqp\"', bodytype);
    }
}

function ws_binding(op, to, fr, rqi, ty, pc, bodytype, callback) {
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
            'binding': 'W'
        }
    };

    if(usesecure == 'disable') {
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
        console.log('[pxyws_binding] problem with request: ' + e.message);
    });

    // write data to request body

    //console.log(options);
    //console.log(reqBodyString);

    req.write(reqBodyString);
    req.end();
}

function ws_response(connection, rsc, to, fr, rqi, inpc, bodytype) {
    var rsp_message = {};
    rsp_message['m2m:rsp'] = {};
    //rsp_message['m2m:rsp'].rsc = rsc;
    rsp_message['m2m:rsp'].rsc = parseInt(rsc); // convert to int
    //rsp_message['m2m:rsp'].to = to;
    //rsp_message['m2m:rsp'].fr = fr;

    rsp_message['m2m:rsp'].rqi = rqi;
    rsp_message['m2m:rsp'].pc = inpc;


    if (bodytype === 'xml') {
        rsp_message['m2m:rsp']['@'] = {
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

        connection.sendUTF(bodyString.toString());
    }
    else if (bodytype === 'cbor') { // 'json'
        bodyString = cbor.encode(rsp_message['m2m:rsp']).toString('hex');
        connection.sendUTF(bodyString);
    }
    else { // 'json'
        connection.sendUTF(JSON.stringify(rsp_message['m2m:rsp']));
    }
}

function http_retrieve_CSEBase(callback) {
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var resourceid = '/' + usecsebase;
    var responseBody = '';

    if(usesecure == 'disable') {
        var options = {
            hostname: usewscbhost,
            port: usecsebaseport,
            path: resourceid,
            method: 'get',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/json',
                'X-M2M-Origin': usecseid
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
                'X-M2M-Origin': usecseid
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

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            //console.log('[pxyws - http_retrieve_CSEBase] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write('');
    req.end();
}
