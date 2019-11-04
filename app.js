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
 * @file Main code of Mobius. Role of flow router
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

process.env.NODE_ENV = 'production';
//process.env.NODE_ENV = 'development';

var fs = require('fs');
var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var util = require('util');
var xml2js = require('xml2js');
var url = require('url');
var xmlbuilder = require('xmlbuilder');
var ip = require('ip');
var crypto = require('crypto');
var fileStreamRotator = require('file-stream-rotator');
var merge = require('merge');
var https = require('https');
var cbor = require('cbor');
var moment = require('moment');

var mqtt = require('mqtt');
//global.noti_mqtt = null;

global.NOPRINT = 'true';
global.ONCE = 'true';

var cb = require('./mobius/cb');
var responder = require('./mobius/responder');
var resource = require('./mobius/resource');
var security = require('./mobius/security');
var fopt = require('./mobius/fopt');
var tr = require('./mobius/tr');
var sgn = require('./mobius/sgn');

var db = require('./mobius/db_action');
var db_sql = require('./mobius/sql_action');

// ������ �����մϴ�.
var app = express();

global.usespid              = '//keti.re.kr';
global.usesuperuser         = 'Superman';

global.useobserver          = 'Sandwich';

global.resultStatusCode = {
    '4230': "LOCKED: this resource was occupied by others",
    '4103': "ACCESS DENIED"
};

global.randomValueBase64 = function (len) {
    return crypto.randomBytes(Math.ceil(len * 3 / 4))
        .toString('base64')   // convert to base64 format
        .slice(0, len)        // return required number of characters
        .replace(/\+/g, '0')  // replace '+' with '0'
        .replace(/\//g, '0'); // replace '/' with '0'
};

global.randomIntInc = function (low, high) {
    return Math.floor(Math.random() * (high - low + 1) + low);
};

global.randomValue = function (qty) {
    return crypto.randomBytes(qty).toString(2);
};

var logDirectory = __dirname + '/log';

// ensure log directory exists
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

// create a rotating write stream
var accessLogStream = fileStreamRotator.getStream({
    date_format: 'YYYYMMDD',
    filename: logDirectory + '/access-%DATE%.log',
    frequency: 'daily',
    verbose: false
});

// setup the logger
app.use(morgan('combined', {stream: accessLogStream}));
//ts_app.use(morgan('short', {stream: accessLogStream}));

function del_req_resource() {
    db.getConnection(function (err, connection) {
        if(err) {
            console.log('[del_req_resource] No Connection');
        }
        else {
            db_sql.delete_req(connection, function (err, delete_Obj) {
                if (!err) {
                    console.log('deleted ' + delete_Obj.affectedRows + ' request resource(s).');
                    db.releaseConnection(connection);
                }
            });
        }
    });
}

function del_expired_resource() {
    db.getConnection(function (err, connection) {
        if(err) {
            console.log('[del_expired_resource] No Connection');
        }
        else {
            // this routine is that delete resource expired time exceed et of resource
            var et = moment().utc().format('YYYYMMDDTHHmmss');
            db_sql.delete_lookup_et(connection, et, function (err) {
                if (!err) {
                    console.log('---------------');
                    console.log('delete resources expired et');
                    console.log('---------------');
                    db.releaseConnection(connection);
                }
            });
        }
    });
}

var cluster = require('cluster');
var os = require('os');
//var cpuCount = (os.cpus().length / 2);
var cpuCount = os.cpus().length;

var worker = [];
var use_clustering = 1;
var worker_init_count = 0;
if (use_clustering) {
    if (cluster.isMaster) {
        cluster.on('death', function (worker) {
            console.log('worker' + worker.pid + ' died --> start again');
            cluster.fork();
        });

        db.connect(usedbhost, 3306, 'root', usedbpass, function (rsc) {
            if (rsc == '1') {
                db.getConnection(function (err, connection) {
                    if(err) {
                        console.log('[db.connect] No Connection');
                    }
                    else {
                        db_sql.set_tuning(connection, function (err, results) {
                            if (err) {
                                console.log('[set_tuning] error');
                            }

                            console.log('CPU Count:', cpuCount);
                            for (var i = 0; i < cpuCount; i++) {
                                worker[i] = cluster.fork();
                            }

                            cb.create(connection, function (rsp) {
                                console.log(JSON.stringify(rsp));

                                setInterval(del_req_resource, (24) * (60) * (1000));
                                setInterval(del_expired_resource, (24) * (60) * (1000));

                                require('./pxy_mqtt');
                                require('./pxy_coap');
                                require('./pxy_ws');

                                if (usecsetype == 'mn' || usecsetype == 'asn') {
                                    global.refreshIntervalId = setInterval(function () {
                                        csr_custom.emit('register_remoteCSE');
                                    }, 5000);
                                }

                                db.releaseConnection(connection);
                            });
                        });
                    }
                });
            }
        });
    }
    else {
        db.connect(usedbhost, 3306, 'root', usedbpass, function (rsc) {
            if (rsc == '1') {
                db.getConnection(function (err, connection) {
                    if (err) {
                        console.log('[db.connect] No Connection');
                    }
                    else {
                        if (use_secure === 'disable') {
                            http.globalAgent.maxSockets = 1000000;
                            http.createServer(app).listen({port: usecsebaseport, agent: false}, function () {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                cb.create(connection, function (rsp) {
                                    console.log(JSON.stringify(rsp));
                                    //noti_mqtt_begin();

                                    db.releaseConnection(connection);
                                });
                            });
                        }
                        else {
                            var options = {
                                key: fs.readFileSync('server-key.pem'),
                                cert: fs.readFileSync('server-crt.pem'),
                                ca: fs.readFileSync('ca-crt.pem')
                            };
                            https.globalAgent.maxSockets = 1000000;
                            https.createServer(options, app).listen({port: usecsebaseport, agent: false}, function () {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                cb.create(connection, function (rsp) {
                                    console.log(JSON.stringify(rsp));
                                    //noti_mqtt_begin();

                                    db.releaseConnection(connection);
                                });
                            });
                        }
                    }
                });
            }
        });
    }
}
else {
    db.connect(usedbhost, 3306, 'root', usedbpass, function (rsc) {
        if (rsc == '1') {
            db.getConnection(function (err, connection) {
                if (err) {
                    console.log('[db.connect] No Connection');
                }
                else {
                    cb.create(connection, function (rsp) {
                        console.log(JSON.stringify(rsp));

                        if (use_secure === 'disable') {
                            http.globalAgent.maxSockets = 1000000;
                            http.createServer(app).listen({port: usecsebaseport, agent: false}, function () {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                require('./pxy_mqtt');
                                //noti_mqtt_begin();

                                if (usecsetype === 'mn' || usecsetype === 'asn') {
                                    global.refreshIntervalId = setInterval(function () {
                                        csr_custom.emit('register_remoteCSE');
                                    }, 5000);
                                }
                            });
                        }
                        else {
                            var options = {
                                key: fs.readFileSync('server-key.pem'),
                                cert: fs.readFileSync('server-crt.pem'),
                                ca: fs.readFileSync('ca-crt.pem')
                            };
                            https.globalAgent.maxSockets = 1000000;
                            https.createServer(options, app).listen({port: usecsebaseport, agent: false}, function () {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                require('./pxy_mqtt');
                                //noti_mqtt_begin();
                                //require('./mobius/ts_agent');

                                if (usecsetype === 'mn' || usecsetype === 'asn') {
                                    global.refreshIntervalId = setInterval(function () {
                                        csr_custom.emit('register_remoteCSE');
                                    }, 5000);
                                }
                            });
                        }

                        db.releaseConnection(connection);
                    });
                }
            });
        }
    });
}

global.get_ri_list_sri = function (request, response, sri_list, ri_list, count, callback) {
    if(sri_list.length <= count) {
        callback(sri_list, request, response);
    }
    else {
        db_sql.get_ri_sri(request.connection, request, response, sri_list[count], function (err, results, request, response) {
            ri_list[count] = ((results.length == 0) ? sri_list[count] : results[0].ri);

            if (sri_list.length <= ++count) {
                callback(ri_list, request, response);
            }
            else {
                get_ri_list_sri(request, response, sri_list, ri_list, count, function (ri_list, request, response) {
                    callback(ri_list, request, response);
                });
            }
        });
    }
};

global.update_route = function (connection, callback) {
    var cse_poa = {};
    db_sql.select_csr_like(connection, usecsebase, function (err, results_csr) {
        if (!err) {
            for (var i = 0; i < results_csr.length; i++) {
                var poa_arr = JSON.parse(results_csr[i].poa);
                for (var j = 0; j < poa_arr.length; j++) {
                    if (url.parse(poa_arr[j]).protocol == 'http:' || url.parse(poa_arr[j]).protocol == 'https:') {
                        cse_poa[results_csr[i].ri.split('/')[2]] = poa_arr[j];
                    }
                }
            }
        }
        callback(cse_poa);
    });
};

function make_short_nametype(body_Obj) {
    if (body_Obj[Object.keys(body_Obj)[0]]['$'] != null) {
        if (body_Obj[Object.keys(body_Obj)[0]]['$'].rn != null) {
            body_Obj[Object.keys(body_Obj)[0]].rn = body_Obj[Object.keys(body_Obj)[0]]['$'].rn;
        }
        delete body_Obj[Object.keys(body_Obj)[0]]['$'];
    }

    var rootnm = Object.keys(body_Obj)[0].split(':')[1];
    body_Obj[rootnm] = body_Obj[Object.keys(body_Obj)[0]];
    delete body_Obj[Object.keys(body_Obj)[0]];

    for (var attr in body_Obj[rootnm]) {
        if (body_Obj[rootnm].hasOwnProperty(attr)) {
            if (typeof body_Obj[rootnm][attr] === 'boolean') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else if (typeof body_Obj[rootnm][attr] === 'string') {
            }
            else if (typeof body_Obj[rootnm][attr] === 'number') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else {
            }
        }
    }
}

global.make_json_obj = function(bodytype, str, callback) {
    try {
        if (bodytype === 'xml') {
            var message = str;
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(message.toString(), function (err, result) {
                if (err) {
                    console.log('[mqtt make json obj] xml2js parser error]');
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
                                        make_json_arraytype(result[prop][attr]);
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
                    console.log('cbor parser error]');
                }
                else {
                    callback('1', result);
                }
            });
        }
        else {
            var result = JSON.parse(str);
            callback('1', result);
        }
    }
    catch (e) {
        console.error(e.message);
        callback('0');
    }
};

global.make_json_arraytype = function (body_Obj) {
    for (var prop in body_Obj) {
        if (body_Obj.hasOwnProperty(prop)) {
            for (var attr in body_Obj[prop]) {
                if (body_Obj[prop].hasOwnProperty(attr)) {
                    if (attr == 'srv' || attr == 'aa' || attr == 'at' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' || attr == 'nu' || attr == 'mid' || attr == 'macp' || attr == 'rels') {
                        if (body_Obj[prop][attr]) {
                            body_Obj[prop][attr] = body_Obj[prop][attr].split(' ');
                        }
                        if (body_Obj[prop][attr] == '') {
                            body_Obj[prop][attr] = [];
                        }
                        if (body_Obj[prop][attr] == '[]') {
                            body_Obj[prop][attr] = [];
                        }
                    }

                    if (attr == 'rqps') {
                        var rqps_type = getType(body_Obj[prop][attr]);
                        if (rqps_type === 'array') {

                        }
                        else if (rqps_type === 'object') {
                            var temp = body_Obj[prop][attr];
                            body_Obj[prop][attr] = [];
                            body_Obj[prop][attr].push(temp);
                        }
                        else {

                        }
                    }

                    if (attr == 'enc') {
                        if (body_Obj[prop][attr]) {
                            if (body_Obj[prop][attr].net) {
                                body_Obj[prop][attr].net = body_Obj[prop][attr].net.split(' ');
                            }
                        }
                    }

                    if (attr == 'pv' || attr == 'pvs') {
                        if (body_Obj[prop][attr]) {
                            if (body_Obj[prop][attr].acr) {
                                if (!Array.isArray(body_Obj[prop][attr].acr)) {
                                    temp = body_Obj[prop][attr].acr;
                                    body_Obj[prop][attr].acr = [];
                                    body_Obj[prop][attr].acr[0] = temp;
                                }

                                for (var acr_idx in body_Obj[prop][attr].acr) {
                                    if (body_Obj[prop][attr].acr.hasOwnProperty(acr_idx)) {
                                        if (body_Obj[prop][attr].acr[acr_idx].acor) {
                                            body_Obj[prop][attr].acr[acr_idx].acor = body_Obj[prop][attr].acr[acr_idx].acor.split(' ');
                                        }

                                        if (body_Obj[prop][attr].acr[acr_idx].hasOwnProperty('acco')) {
                                            if (!Array.isArray(body_Obj[prop][attr].acr[acr_idx].acco)) {
                                                temp = body_Obj[prop][attr].acr[acr_idx].acco;
                                                body_Obj[prop][attr].acr[acr_idx].acco = [];
                                                body_Obj[prop][attr].acr[acr_idx].acco[0] = temp;
                                            }

                                            var acco = body_Obj[prop][attr].acr[acr_idx].acco;
                                            for(var acco_idx in acco) {
                                                if(acco.hasOwnProperty(acco_idx)) {
                                                    if (acco[acco_idx].hasOwnProperty('acip')) {
                                                        if (acco[acco_idx].acip.hasOwnProperty('ipv4')) {
                                                            if (getType(acco[acco_idx].acip['ipv4']) == 'string') {
                                                                acco[acco_idx].acip['ipv4'] = acco[acco_idx].acip.ipv4.split(' ');
                                                            }
                                                        }
                                                        else if (acco[acco_idx].acip.hasOwnProperty('ipv6')) {
                                                            if (getType(acco[acco_idx].acip['ipv6']) == 'string') {
                                                                acco[acco_idx].acip['ipv6'] = acco[acco_idx].acip.ipv6.split(' ');
                                                            }
                                                        }
                                                    }
                                                    if (acco[acco_idx].hasOwnProperty('actw')) {
                                                        if (getType(acco[acco_idx].actw) == 'string') {
                                                            temp = acco[acco_idx].actw;
                                                            acco[acco_idx]['actw'] = [];
                                                            acco[acco_idx].actw[0] = temp;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            if (body_Obj[prop][attr].acr == '') {
                                body_Obj[prop][attr].acr = [];
                            }

                            if (body_Obj[prop][attr].acr == '[]') {
                                body_Obj[prop][attr].acr = [];
                            }
                        }
                    }
                }
            }
        }
    }
};

function parse_to_json(request, response, callback) {
    var body_Obj = {};

    if (request.usebodytype === 'xml') {
        try {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(request.body.toString(), function (err, result) {
                if (err) {
                    responder.error_result(request, response, 400, 4000, '[parse_to_json] do not parse xml body' + err.message);
                    callback('0', body_Obj);
                    return '0';
                }
                else {
                    body_Obj = result;
                    make_short_nametype(body_Obj);
                    make_json_arraytype(body_Obj);

                    request.headers.rootnm = Object.keys(body_Obj)[0];
                    request.bodyObj = body_Obj;
                    callback('1', body_Obj);
                }
            });
        }
        catch(e) {
            responder.error_result(request, response, 400, 4000, '[parse_to_json] do not parse xml body');
            callback('0', body_Obj);
            return '0';
        }
    }
    else if (request.usebodytype === 'cbor') {
        try {
            var encoded = request.body;
            cbor.decodeFirst(encoded, function(err, result) {
                if (err) {
                    responder.error_result(request, response, 400, 4000, '[parse_to_json] do not parse cbor body');
                    callback('0', body_Obj);
                    return '0';
                }
                else {
                    body_Obj = result;
                    make_short_nametype(body_Obj);
                    //make_json_arraytype(body_Obj);

                    request.headers.rootnm = Object.keys(body_Obj)[0];
                    request.bodyObj = body_Obj;
                    callback('1', body_Obj);
                }
            });
        }
        catch(e) {
            responder.error_result(request, response, 400, 4000, '[parse_to_json] do not parse cbor body');
            callback('0', body_Obj);
            return '0';
        }
    }
    else {
        try {
            body_Obj = JSON.parse(request.body.toString());
            make_short_nametype(body_Obj);

            if (Object.keys(body_Obj)[0] == 'undefined') {
                responder.error_result(request, response, 400, 4000, '[parse_to_json] root tag of body is not matched');
                callback('0', body_Obj);
                return '0';
            }

            request.headers.rootnm = Object.keys(body_Obj)[0];
            request.bodyObj = body_Obj;
            callback('1', body_Obj);
        }
        catch (e) {
            responder.error_result(request, response, 400, 4000, '[parse_to_json] do not parse json body');
            callback('0', body_Obj);
            return '0';
        }
    }
}

function parse_body_format(request, response, callback) {
    parse_to_json(request, response, function(rsc, body_Obj) {
        if(rsc == '0') {
            callback('0', body_Obj);
        }
        else {
            request.headers.rootnm = Object.keys(body_Obj)[0];
            for (var prop in body_Obj) {
                if (body_Obj.hasOwnProperty(prop)) {
                    for (var attr in body_Obj[prop]) {
                        if (body_Obj[prop].hasOwnProperty(attr)) {
                            if (attr == 'aa' || attr == 'at' || attr == 'poa' || attr == 'acpi' || attr == 'srt' ||
                                attr == 'nu' || attr == 'mid' || attr == 'macp' || attr == 'rels' || attr == 'rqps' || attr == 'srv') {
                                if (!Array.isArray(body_Obj[prop][attr])) {
                                    body_Obj = {};
                                    body_Obj['dbg'] = attr + ' attribute should be json array format';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0', body_Obj);
                                    return '0';
                                }
                            }
                            else if (attr == 'lbl') {
                                if (body_Obj[prop][attr] == null) {
                                    body_Obj[prop][attr] = [];
                                }
                                else if (!Array.isArray(body_Obj[prop][attr])) {
                                    body_Obj = {};
                                    body_Obj['dbg'] = attr + ' attribute should be json array format';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0', body_Obj);
                                    return '0';
                                }
                            }
                            else if (attr == 'enc') {
                                if (body_Obj[prop][attr].net) {
                                    if (!Array.isArray(body_Obj[prop][attr].net)) {
                                        body_Obj = {};
                                        body_Obj['dbg'] = attr + '.net attribute should be json array format';
                                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                        callback('0', body_Obj);
                                        return '0';
                                    }
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = attr + 'attribute should have net key as child in json format';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0', body_Obj);
                                    return '0';
                                }
                            }
                            else if (attr == 'pv' || attr == 'pvs') {
                                if (body_Obj[prop][attr].hasOwnProperty('acr')) {
                                    if (!Array.isArray(body_Obj[prop][attr].acr)) {
                                        body_Obj = {};
                                        body_Obj['dbg'] = attr + '.acr should be json array format';
                                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                        callback('0', body_Obj);
                                        return '0';
                                    }

                                    var acr = body_Obj[prop][attr].acr;
                                    for (var acr_idx in acr) {
                                        if (acr.hasOwnProperty(acr_idx)) {
                                            if (acr[acr_idx].acor) {
                                                if (!Array.isArray(acr[acr_idx].acor)) {
                                                    body_Obj = {};
                                                    body_Obj['dbg'] = attr + '.acr[' + acr_idx + '].acor should be json array format';
                                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                                    callback('0', body_Obj);
                                                    return '0';
                                                }
                                            }

                                            if (acr[acr_idx].acco) {
                                                if (!Array.isArray(acr[acr_idx].acco)) {
                                                    body_Obj = {};
                                                    body_Obj['dbg'] = attr + '.acr[' + acr_idx + '].acco should be json array format';
                                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                                    callback('0', body_Obj);
                                                    return '0';
                                                }
                                                for (var acco_idx in acr[acr_idx].acco) {
                                                    if (acr[acr_idx].acco.hasOwnProperty(acco_idx)) {
                                                        var acco = acr[acr_idx].acco[acco_idx];
                                                        if (acco.acip) {
                                                            if (acco.acip['ipv4']) {
                                                                if (!Array.isArray(acco.acip['ipv4'])) {
                                                                    body_Obj = {};
                                                                    body_Obj['dbg'] = attr + '.acr[' + acr_idx + '].acco.acip.ipv4 should be json array format';
                                                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                                                    callback('0', body_Obj);
                                                                    return '0';
                                                                }
                                                            }
                                                            else if (acco.acip['ipv6']) {
                                                                if (!Array.isArray(acco.acip['ipv6'])) {
                                                                    body_Obj = {};
                                                                    body_Obj['dbg'] = attr + '.acr[' + acr_idx + '].acco.acip.ipv6 should be json array format';
                                                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                                                    callback('0', body_Obj);
                                                                    return '0';
                                                                }
                                                            }
                                                        }

                                                        if (acco.actw) {
                                                            if (!Array.isArray(acco.actw)) {
                                                                body_Obj = {};
                                                                body_Obj['dbg'] = attr + '.acr[' + acr_idx + '].acco[' + acco_idx + '].actw should be json array format';
                                                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                                                callback('0', body_Obj);
                                                                return '0';
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            else if (attr == 'uds') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = attr + ' attribute should have can and sus key in json format';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0', body_Obj);
                                    return '0';
                                }
                            }
                            else if (attr == 'cas') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = attr + ' attribute should have can and sus key in json format';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0', body_Obj);
                                    return '0';
                                }
                            }
                            else {
                            }
                        }
                    }
                }
            }

            callback(request.ty, body_Obj);
        }
    });
}

function check_resource(request, response, body_Obj, callback) {
    var ri = url.parse(request.url).pathname;

    var chk_fopt = ri.split('/fopt');
    if(chk_fopt.length == 2) {
        ri = chk_fopt[0];
        op = 'fanoutpoint';
        db_sql.select_grp_lookup(request.connection, ri, function (err, result_Obj) {
            if (!err) {
                if (result_Obj.length == 1) {
                    result_Obj[0].acpi = JSON.parse(result_Obj[0].acpi);
                    result_Obj[0].lbl = JSON.parse(result_Obj[0].lbl);
                    result_Obj[0].aa = JSON.parse(result_Obj[0].aa);
                    result_Obj[0].at = JSON.parse(result_Obj[0].at);
                    callback('1', result_Obj[0], op, request, response, body_Obj);
                }
                else {
                    result_Obj = {};
                    result_Obj['dbg'] = '[check_resource] resource does not exist';
                    responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
                    callback('0', {}, '', request, response, body_Obj);
                    return '0';
                }
            }
            else {
                var code = result_Obj.message;
                result_Obj = {};
                result_Obj['dbg'] = code;
                responder.response_result(request, response, 500, result_Obj, 5000, request.url, result_Obj['dbg']);
                callback('0', {}, '', request, response, body_Obj);
                return '0';
            }
        });
    }
    else {
        console.log('X-M2M-Origin: ' + request.headers['x-m2m-origin']);
        console.log(body_Obj);

        var op = 'direct';
        var resource_Obj = request.targetObject;
        var rootnm = Object.keys(resource_Obj)[0];
        callback('1', resource_Obj[rootnm], op, request, response, body_Obj);
        return '0';
    }
}

function check_rt_query(request, response, body_Obj, callback) {
    //var ri = url.parse(request.url).pathname;

    //var url_arr = ri.split('/');
    //var last_url = url_arr[url_arr.length-1];
    //var op = 'direct';

    if (request.query.real == 4) {
        var check_Obj = {};
        check_Obj.ty = '3';
        callback('1', check_Obj, 'direct', request, response, body_Obj);
        return'1';
    }

    if (request.query.rt == 3) { // default, blocking
        check_resource(request, response, body_Obj, function (rsc, check_Obj, op, request, response, body_Obj) {
            callback(rsc, check_Obj, op, request, response, body_Obj);
        });
    }
    else if (request.query.rt == 1 || request.query.rt == 2) { // nonblocking
        if(request.query.rt == 2 && request.headers['x-m2m-rtu'] == null && request.headers['x-m2m-rtu'] == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'X-M2M-RTU is none';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', {}, '', request, response, body_Obj);
            return '0';
        }

        // first create request resource under CSEBase
        var temp_rootnm = request.headers.rootnm;
        //var temp_rt = request.query.rt;
        var ty = '17';
        var rt_body_Obj = {req: {}};
        request.headers.rootnm = Object.keys(rt_body_Obj)[0];
        request.query.rt = 3;
        resource.create(request, response, ty, rt_body_Obj, function (rsc) {
            if (rsc == '1') {
                request.headers.rootnm = temp_rootnm;
                request.query.rt = 1;
                check_resource(request, response, body_Obj, function (rsc, parent_comm, op, request, response, body_Obj) {
                    callback(rsc, parent_comm, op, request, response, body_Obj);
                });
            }
        });
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'OPERATION_NOT_ALLOWED (rt query is not supported)';
        responder.response_result(request, response, 405, body_Obj, 4005, request.url, body_Obj['dbg']);
        callback('0', {}, '', request, response, body_Obj);
        return '0';
    }
}

function check_grp(request, response, callback) {
    var result_Obj = request.targetObject;
    var rootnm = Object.keys(result_Obj)[0];

    if(result_Obj[rootnm].ty == 9) {
        if (result_Obj[rootnm].mid.length == 0) {
            result_Obj = {};
            result_Obj['dbg'] = 'NO_MEMBERS: memberID in parent group is empty';
            responder.response_result(request, response, 403, result_Obj, 4109, request.url, result_Obj['dbg']);
            callback('0');
            return '0';
        }
        else {
            callback('1', result_Obj[rootnm]);
        }
    }
    else {
        result_Obj = {};
        result_Obj['dbg'] = '[check_grp] resource does not exist';
        responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
        callback('0');
        return '0';
    }
}

/**
 *
 * @param request
 * @param response
 */
function lookup_create(request, response) {
    check_rt_query(request, response, request.bodyObj, function (rsc, parentObj, op, request, response, body_Obj) {
        if (rsc == '0') {
            return rsc;
        }

        var rootnm = request.headers.rootnm;

        tr.check(request, parentObj.ri, body_Obj, function (rsc, body_Obj) {
            if (rsc == '0') {
                body_Obj = {};
                body_Obj['dbg'] = resultStatusCode['4230'];
                responder.response_result(request, response, 423, body_Obj, 4230, request.url, resultStatusCode['4230']);
                return '0';
            }


            if(request.query.real == 4) {

            }

            if ((request.ty == 1) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // accessControlPolicy
            }
            else if ((request.ty == 9) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // group
            }
            else if ((request.ty == 16) && (parentObj.ty == 5)) { // remoteCSE
                if (usecsetype == 'asn' && request.headers.csr == null) {
                    body_Obj = {};
                    body_Obj['dbg'] = 'ASN CSE can not have child CSE (remoteCSE)';
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    return '0';
                }
            }
            else if ((request.ty == 10) && (parentObj.ty == 5)) { // locationPolicy
            }
            else if ((request.ty == 2) && (parentObj.ty == 5)) { // ae
            }
            else if ((request.ty == 3) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3)) { // container
            }
            else if ((request.ty == 23) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 ||
                    parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 29 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27)) { // sub
            }
            else if ((request.ty == 4) && (parentObj.ty == 3)) { // contentInstance
            }
            else if ((request.ty == 24) && (parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 4 || parentObj.ty == 29)) { // semanticDescriptor
            }
            else if ((request.ty == 29) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // timeSeries
            }
            else if ((request.ty == 30) && (parentObj.ty == 29)) { // timeSeriesInstance
                //body_Obj[rootnm].mni = parent_comm.mni;
            }
            else if ((request.ty == 27) && (parentObj.ty == 2 || parentObj.ty == 16)) { // multimediaSession
            }
            else if ((request.ty == 14) && (parentObj.ty == 5)) { // node
            }
            else if ((request.ty == 13) && (parentObj.ty == 14)) { // mgmtObj
            }
            else if ((request.ty == 38) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 ||
                    parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 29 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27)) { // transaction
            }
            else if ((request.ty == 39) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 ||
                    parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 29 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27)) { // transaction
            }
            else {
                body_Obj = {};
                body_Obj['dbg'] = 'TARGET_NOT_SUBSCRIBABLE: request ty creating can not create under parent resource';
                responder.response_result(request, response, 403, body_Obj, 5203, request.url, body_Obj['dbg']);
                return '0';
            }

            if (((request.ty == 4) && (parentObj.ty == 3)) || ((request.ty == 30) && (parentObj.ty == 29))) { // contentInstance
                if (parentObj.mni == null) {
                    //body_Obj[rootnm].mni = '3153600000';
                }
                else {
                    if (parseInt(parentObj.mni) == 0) {
                        body_Obj = {};
                        body_Obj['dbg'] = 'can not create cin because mni value is zero';
                        responder.response_result(request, response, 406, body_Obj, 5207, request.url, body_Obj['dbg']);
                        return '0';
                    }
                    else if (parseInt(parentObj.mbs) == 0) {
                        body_Obj = {};
                        body_Obj['dbg'] = 'can not create cin because mbs value is zero';
                        responder.response_result(request, response, 406, body_Obj, 5207, request.url, body_Obj['dbg']);
                        return '0';
                    }
                    else if (parentObj.disr == true) {
                        body_Obj = {};
                        body_Obj['dbg'] = 'OPERATION NOT ALLOWED: disr attribute is true';
                        responder.response_result(request, response, 405, body_Obj, 4005, request.url, body_Obj['dbg']);
                        return '0';
                    }
                    else {
                        //body_Obj[rootnm].mni = parent_spec[0].mni;
                    }
                }

                request.headers.mni = parentObj.mni;
                request.headers.mbs = parentObj.mbs;
                request.headers.cni = parentObj.cni;
                request.headers.cbs = parentObj.cbs;
                request.headers.st = parentObj.st;
            }

            if (parentObj.length == 0) {
                parentObj = {};
                parentObj.cr = '';
                console.log('no creator');
            }
            else {
                if (parentObj.ty == 2) {
                    parentObj.cr = parentObj.aei;
                }
            }

            if (request.ty == 23) {
                var access_value = '3';
            }
            else {
                access_value = '1';
            }

            var tid = 'security.check - ' + require('shortid').generate();
            console.time(tid);
            security.check(request, response, parentObj.ty, parentObj.acpi, access_value, parentObj.cr, function (rsc, request, response) {
                if (rsc == '0') {
                    body_Obj = {};
                    body_Obj['dbg'] = resultStatusCode['4103'];
                    responder.response_result(request, response, 403, body_Obj, 4103, request.url, resultStatusCode['4103']);
                    return '0';
                }
                console.timeEnd(tid);
                resource.create(request, response, request.ty, body_Obj, function (rsc) {

                });
            });
        });
    });
}

function lookup_retrieve(request, response) {
    check_rt_query(request, response, request.bodyObj, function (rsc, resultObj, op, request, response, body_Obj) {
        if (rsc == '0') {
            return rsc;
        }

        tr.check(request, resultObj.ri, body_Obj, function (rsc, body_Obj) {
            if (rsc == '0') {
                body_Obj = {};
                body_Obj['dbg'] = resultStatusCode['4230'];
                responder.response_result(request, response, 423, body_Obj, 4230, request.url, resultStatusCode['4230']);
                return '0';
            }

            if (resultObj.ty == 2) {
                resultObj.cr = resultObj.aei;
            }
            else if (resultObj.ty == 16) {
                resultObj.cr = resultObj.csi;
            }

            if (request.query.fu == 1) {
                security.check(request, response, resultObj.ty, resultObj.acpi, '32', resultObj.cr, function (rsc, request, response) {
                    if (rsc == '0') {
                        body_Obj = {};
                        body_Obj['dbg'] = resultStatusCode['4103'];
                        responder.response_result(request, response, 403, body_Obj, 4103, request.url, resultStatusCode['4103']);
                        return '0';
                    }
                    resource.retrieve(request, response, resultObj);
                });
            }
            else {
                security.check(request, response, resultObj.ty, resultObj.acpi, '2', resultObj.cr, function (rsc, request, response) {
                    if (rsc == '0') {
                        body_Obj = {};
                        body_Obj['dbg'] = resultStatusCode['4103'];
                        responder.response_result(request, response, 403, body_Obj, 4103, request.url, resultStatusCode['4103']);
                        return '0';
                    }
                    resource.retrieve(request, response, resultObj);
                });
            }
        });
    });
}

function lookup_update(request, response) {
    check_rt_query(request, response, request.bodyObj, function (rsc, resultObj, op, request, response, body_Obj) {
        if (rsc == '0') {
            return rsc;
        }

        tr.check(request, resultObj.ri, body_Obj, function (rsc, body_Obj) {
            if (rsc == '0') {
                body_Obj = {};
                body_Obj['dbg'] = resultStatusCode['4230'];
                responder.response_result(request, response, 423, body_Obj, 4230, request.url, resultStatusCode['4230']);
                return '0';
            }

            if (resultObj.ty == 2) {
                resultObj.cr = resultObj.aei;
            }
            else if (resultObj.ty == 16) {
                resultObj.cr = resultObj.csi;
            }

            var acpi_check = 0;
            var other_check = 0;
            for(var rootnm in body_Obj) {
                if(body_Obj.hasOwnProperty(rootnm)) {
                    for(var attr in body_Obj[rootnm]) {
                        if(body_Obj[rootnm].hasOwnProperty(attr)) {
                            if(attr == 'acpi') {
                                acpi_check++;
                            }
                            else {
                                other_check++;
                            }
                        }
                    }
                }
            }

            if(other_check > 0) {
                security.check(request, response, resultObj.ty, resultObj.acpi, '4', resultObj.cr, function (rsc, request, response) {
                    if (rsc == '0') {
                        body_Obj = {};
                        body_Obj['dbg'] = resultStatusCode['4103'];
                        responder.response_result(request, response, 403, body_Obj, 4103, request.url, resultStatusCode['4103']);
                        return '0';
                    }
                    resource.update(request, response, resultObj, body_Obj);
                });
            }
            else {
                resource.update(request, response, resultObj, body_Obj);
            }
        });
    });
}

function lookup_delete(request, response) {
    check_rt_query(request, response, request.bodyObj, function (rsc, resultObj, op, request, response, body_Obj) {
        if (rsc == '0') {
            return rsc;
        }

        tr.check(request, resultObj.ri, body_Obj, function (rsc, body_Obj) {
            if (rsc == '0') {
                var body_Obj = {};
                body_Obj['dbg'] = resultStatusCode['4230'];
                responder.response_result(request, response, 423, body_Obj, 4230, request.url, resultStatusCode['4230']);
                return '0';
            }

            if (resultObj.ty == 2) {
                resultObj.cr = resultObj.aei;
            }
            else if (resultObj.ty == 16) {
                resultObj.cr = resultObj.csi;
            }

            security.check(request, response, resultObj.ty, resultObj.acpi, '8', resultObj.cr, function (rsc, request, response) {
                if (rsc == '0') {
                    body_Obj = {};
                    body_Obj['dbg'] = resultStatusCode['4103'];
                    responder.response_result(request, response, 403, body_Obj, 4103, request.url, resultStatusCode['4103']);
                    return '0';
                }

                // for(var idx in cbs_cache) {
                //     if(cbs_cache.hasOwnProperty(idx)) {
                //         if(idx.includes(resultObj.ri)) {
                //             delete cbs_cache[idx];
                //             del_cbs_cache(idx);
                //         }
                //     }
                // }

                resource.delete(request, response, resultObj);
            });
        });
    });
}

// var resource_cache = {};
global.get_resource_from_url = function(connection, ri, sri, option, callback) {
    var targetObject = {};
    // if(resource_cache.hasOwnProperty(ri+option)) {
    //     targetObject = JSON.parse(resource_cache[ri]);
    //     callback(targetObject);
    // }
    // else {
        db_sql.select_resource_from_url(connection, ri, sri, function (err, results) {
            if (err) {
                callback(null, 500);
                return '0';
            }
            else {
                if (results.length == 0) {
                    callback(null, 404);
                    return '0';
                }

                var ty = results[0].ty;
                targetObject[responder.typeRsrc[ty]] = results[0];
                var rootnm = Object.keys(targetObject)[0];
                makeObject(targetObject[rootnm]);

                if (option == '/latest') {
                    // db_sql.get_cni_count(connection, targetObject[rootnm], function (cni, cbs, st) {
                    //     targetObject[rootnm].cni = cni;
                    //     targetObject[rootnm].cbs = cbs;
                    //     targetObject[rootnm].st = st;
                    //
                    //     if (parseInt(targetObject[rootnm].cni, 10) != cni || parseInt(targetObject[rootnm].cbs, 10) != cbs || parseInt(targetObject[rootnm].st, 10) != st) {
                    //         db_sql.update_cnt_cni(connection, targetObject[rootnm], function () {
                    //         });
                    //     }

                        var la_id = 'select_latest_resource ' + targetObject[rootnm].ri + ' - ' + require('shortid').generate();
                        console.time(la_id);
                        db_sql.select_latest_resource(connection, targetObject[rootnm], 0, function (err, result_Obj) {
                            if (!err) {
                                console.timeEnd(la_id);
                                if (result_Obj.length == 1) {
                                    targetObject = {};
                                    targetObject[responder.typeRsrc[result_Obj[0].ty]] = result_Obj[0];
                                    makeObject(targetObject[Object.keys(targetObject)[0]]);
                                    //ri = (result_Obj.length == 0) ? absolute_url : ((result_Obj[0].hasOwnProperty('ri')) ? absolute_url.replace('/' + absolute_url_arr[1], result_Obj[0].ri) : absolute_url);
                                    callback(targetObject);
                                }
                                else {
                                    callback(null, 404);
                                    return '0';
                                }
                            }
                            else {
                                callback(null, 500);
                                return '0';
                            }
                        });
                    // });
                }
                else if (option == '/oldest') {
                    db_sql.select_oldest_resource(connection, parseInt(ty, 10) + 1, ri, function (err, result_Obj) {
                        if (!err) {
                            if (result_Obj.length == 1) {
                                targetObject = {};
                                targetObject[responder.typeRsrc[result_Obj[0].ty]] = result_Obj[0];
                                makeObject(targetObject[Object.keys(targetObject)[0]]);
                                callback(targetObject);
                            }
                            else {
                                callback(null, 404);
                                return '0';
                            }
                        }
                        else {
                            callback(null, 500);
                            return '0';
                        }
                    });
                }
                else if (option == '/fopt') {
                    //ri = (results.length == 0) ? absolute_url : ((results[0].hasOwnProperty('ri')) ? absolute_url.replace('/' + absolute_url_arr[1], results[0].ri) : absolute_url);
                    callback(targetObject);
                }
                else {
                    //ri = (results.length == 0) ? absolute_url : ((results[0].hasOwnProperty('ri')) ? absolute_url.replace('/' + absolute_url_arr[1], results[0].ri) : absolute_url);
                    // resource_cache[targetObject[rootnm].ri] = JSON.stringify(targetObject);

                    // if(targetObject[rootnm].ty == 3 || targetObject[rootnm].ty == 29) {
                    //     db_sql.get_cni_count(connection, targetObject[rootnm], function (cni, cbs, st) {
                    //         if (parseInt(targetObject[rootnm].cni, 10) != cni || parseInt(targetObject[rootnm].cbs, 10) != cbs || parseInt(targetObject[rootnm].st, 10) != st) {
                    //             targetObject[rootnm].cni = cni;
                    //             targetObject[rootnm].cbs = cbs;
                    //             targetObject[rootnm].st = st;
                    //             db_sql.update_cnt_cni(connection, targetObject[rootnm], function () {
                    //             });
                    //         }
                    //     });
                    // }

                    // if(targetObject[rootnm].ty == 3 || targetObject[rootnm].ty == 29) {
                    //     if(cbs_cache[targetObject[rootnm].ri] == null ||
                    //         (parseInt(cbs_cache[targetObject[rootnm].ri].cni, 10) != targetObject[rootnm].cni || parseInt(cbs_cache[targetObject[rootnm].ri].cbs, 10) != targetObject[rootnm].cbs)) {
                    //         db_sql.get_cni_count(connection, targetObject[rootnm], function (cni, cbs, st) {
                    //             if (parseInt(targetObject[rootnm].cni, 10) != cni || parseInt(targetObject[rootnm].cbs, 10) != cbs || parseInt(targetObject[rootnm].st, 10) != st) {
                    //                 targetObject[rootnm].cni = cni;
                    //                 targetObject[rootnm].cbs = cbs;
                    //                 targetObject[rootnm].st = st;
                    //                 cbs_cache[targetObject[rootnm].ri] = {};
                    //                 cbs_cache[targetObject[rootnm].ri].cni = cni;
                    //                 cbs_cache[targetObject[rootnm].ri].cbs = cbs;
                    //                 db_sql.update_cnt_cni(connection, targetObject[rootnm], function () {
                    //                 });
                    //             }
                    //         });
                    //     }
                    //     else {
                    //     }
                    // }
                    callback(targetObject);
                }
            }
        });
    // }
};

function check_headers_requested(headers, callback) {
    // Check X-M2M-RI Header
    if ((headers['x-m2m-ri'] == null)) {
        responder.error_result(request, response, 400, 4000, 'BAD REQUEST: X-M2M-RI is none');
        return '0';
    }

    // Check X-M2M-RVI Header
    if ((headers['x-m2m-rvi'] == null)) {
        // responder.error_result(request, response, 400, 4000, 'BAD REQUEST: X-M2M-RI is none');
        // callback('0', body_Obj, request, response);
        // return '0';
        // todo: RVI check
        headers['x-m2m-rvi'] = uservi;
    }

    request.ty = '99';
    var content_type = request.headers['content-type'].split(';');
    try {
        var ty = '99';
        for (var i in content_type) {
            if (content_type.hasOwnProperty(i)) {
                var ty_arr = content_type[i].replace(/ /g, '').split('=');
                if (ty_arr[0].replace(/ /g, '') == 'ty') {
                    ty = ty_arr[1].replace(' ', '');
                    break;
                }
            }
        }
        request.ty = ty;
    }
    catch (e) {
        responder.error_result(request, response, 400, 4000, 'ty is none');
        return '0';
    }

    if (request.ty == '5') {
        responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED: CSEBase can not be created by others');
        return '0';
    }

    if (request.ty == '17') {
        responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED (req is not supported when post request)');
        return '0';
    }

    if (headers.hasOwnProperty('content-type')) {
        if (headers['content-type'].includes('xml')) {
            request.usebodytype = 'xml';
        }
        else if (headers['content-type'].includes('cbor')) {
            request.usebodytype = 'cbor';
        }
        else {
            request.usebodytype = 'json';
        }
    }
    else {
        request.usebodytype = 'json';
    }

    // Check X-M2M-Origin Header
    if (headers['x-m2m-origin'] == null || headers['x-m2m-origin'] == '') {
        if (request.ty == '2' || request.ty == '16') {
            headers['x-m2m-origin'] = 'S';
        }
        else {
            responder.error_result(request, response, 400, 4000, 'BAD REQUEST: X-M2M-Origin header is Mandatory');
            return '0';
        }
    }
}

var onem2mParser = bodyParser.text(
    {
        limit: '5mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);

//////// contribution code
// Kevin Lee, Executive Director, Unibest INC, Owner of Howchip.com
// Process for CORS problem
app.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
    res.header('Access-Control-Expose-Headers', 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
    (req.method == 'OPTIONS') ? res.sendStatus(200) : next();
});

app.use(function (request, response, next) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });

    request.on('end', function() {
        request.body = fullBody;

        db.getConnection(function (err, connection) {
            if (err) {
                console.log('[app.use] No Connection');
                responder.error_result(request, response, 500, 5000, 'DB Error : No Connection Pool');
                return '0';
            }
            else {
                request.connection = connection;
                if (request.method.toLowerCase() == 'get') {
                    if (request.url == '/hit') {
                        response.header('Content-Type', 'application/json');

                        // for backup hit count
                        if (0) {
                            var _hit_old = JSON.parse(fs.readFileSync('hit.json', 'utf-8'));
                            for (var dd in _hit_old) {
                                if (_hit_old.hasOwnProperty(dd)) {
                                    for (var ff in _hit_old[dd]) {
                                        if (_hit_old[dd].hasOwnProperty(ff)) {
                                            if (Object.keys(_hit_old[dd][ff]).length > 0) {
                                                for (var gg in _hit_old[dd][ff]) {
                                                    if (_hit_old[dd][ff].hasOwnProperty(gg)) {
                                                        var _http = 0;
                                                        var _mqtt = 0;
                                                        var _coap = 0;
                                                        var _ws = 0;

                                                        if (_hit_old[dd][ff][gg] == null) {
                                                            _hit_old[dd][ff][gg] = 0;
                                                        }
                                                        if (gg == 'H') {
                                                            _http = _hit_old[dd][ff][gg];
                                                        }
                                                        else if (gg == 'M') {
                                                            _mqtt = _hit_old[dd][ff][gg];
                                                        }
                                                        else if (gg == 'C') {
                                                            _coap = _hit_old[dd][ff][gg];
                                                        }
                                                        else if (gg == 'W') {
                                                            _ws = _hit_old[dd][ff][gg];
                                                        }
                                                    }
                                                }

                                                db_sql.set_hit(request.connection, dd, _http, _mqtt, _coap, _ws, function () {

                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        db_sql.get_hit_all(request.connection, function (err, result) {
                            if (!err) {
                                request.connection.release();
                                var total_hit = result;
                                response.header('Content-Type', 'application/json');
                                response.status(200).end(JSON.stringify(total_hit, null, 4));
                            }
                        });
                        return;
                    }

                    if (request.url == '/total_ae') {
                        db_sql.select_sum_ae(request.connection, function (err, result) {
                            if (!err) {
                                request.connection.release();
                                var total_ae = result[0];
                                response.header('Content-Type', 'application/json');
                                response.status(200).end(JSON.stringify(total_ae, null, 4));
                            }
                        });
                        return;
                    }

                    if (request.url == '/total_cbs') {
                        db_sql.select_sum_cbs(request.connection, function (err, result) {
                            if (!err) {
                                request.connection.release();
                                var total_cbs = result[0];
                                response.header('Content-Type', 'application/json');
                                response.status(200).end(JSON.stringify(total_cbs, null, 4));
                            }
                        });
                        return;
                    }
                }

                // Check X-M2M-RI Header
                if ((request.headers['x-m2m-ri'] == null)) {
                    responder.error_result(request, response, 400, 4000, 'BAD REQUEST: X-M2M-RI is none');
                    return '0';
                }

                // Check X-M2M-RVI Header
                if ((request.headers['x-m2m-rvi'] == null)) {
                    // responder.error_result(request, response, 400, 4000, 'BAD REQUEST: X-M2M-RI is none');
                    // callback('0', body_Obj, request, response);
                    // return '0';
                    // todo: RVI check
                    request.headers['x-m2m-rvi'] = uservi;
                }

                request.ty = '99';
                if (request.method.toLowerCase() == 'post') {
                    var content_type = request.headers['content-type'].split(';');
                    try {
                        var ty = '99';
                        for (var i in content_type) {
                            if (content_type.hasOwnProperty(i)) {
                                var ty_arr = content_type[i].replace(/ /g, '').split('=');
                                if (ty_arr[0].replace(/ /g, '') == 'ty') {
                                    ty = ty_arr[1].replace(' ', '');
                                    break;
                                }
                            }
                        }
                        request.ty = ty;
                    }
                    catch (e) {
                        responder.error_result(request, response, 400, 4000, 'ty is none');
                        return '0';
                    }

                    if (request.ty == '5') {
                        responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED: CSEBase can not be created by others');
                        return '0';
                    }

                    if (request.ty == '17') {
                        responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED (req is not supported when post request)');
                        return '0';
                    }
                }

                // Check X-M2M-Origin Header
                if (request.headers['x-m2m-origin'] == null || request.headers['x-m2m-origin'] == '') {
                    if (request.ty == '2' || request.ty == '16') {
                        request.headers['x-m2m-origin'] = 'S';
                    }
                    else {
                        responder.error_result(request, response, 400, 4000, 'BAD REQUEST: X-M2M-Origin header is Mandatory');
                        return '0';
                    }
                }

                if (request.headers.hasOwnProperty('content-type')) {
                    if (request.headers['content-type'].includes('xml')) {
                        request.usebodytype = 'xml';
                    }
                    else if (request.headers['content-type'].includes('cbor')) {
                        request.usebodytype = 'cbor';
                    }
                    else {
                        request.usebodytype = 'json';
                    }
                }
                else {
                    request.usebodytype = 'json';
                }

                if (request.query.fu == null) {
                    request.query.fu = 2;
                }
                if (request.query.rcn == null) {
                    request.query.rcn = 1;
                }
                if (request.query.rt == null) {
                    request.query.rt = 3;
                }

                var allow = 1;
                if (allowed_ae_ids.length > 0) {
                    allow = 0;
                    for (var idx in allowed_ae_ids) {
                        if (allowed_ae_ids.hasOwnProperty(idx)) {
                            if (usecseid == request.headers['x-m2m-origin']) {
                                allow = 1;
                                break;
                            }
                            else if (allowed_ae_ids[idx] == request.headers['x-m2m-origin']) {
                                allow = 1;
                                break;
                            }
                        }
                    }

                    if (allow == 0) {
                        responder.error_result(request, response, 403, 4107, 'OPERATION_NOT_ALLOWED: AE-ID is not allowed');
                        return '0';
                    }
                }

                if (responder.typeRsrc[request.ty] == null) {
                    responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED: we do not support (' + request.ty + ') resource');
                    return '0';
                }

                if (request.method.toLowerCase() == 'post' || request.method.toLowerCase() == 'put') {
                    if (request.body != '') {
                        make_json_obj(request.usebodytype, request.body, function (err, body) {
                            try {
                                var rootnm = Object.keys(body)[0].replace('m2m:', '');
                                var checkCount = 0;
                                for (var key in responder.typeRsrc) {
                                    if (responder.typeRsrc.hasOwnProperty(key)) {
                                        if (responder.typeRsrc[key] == rootnm) {
                                            break;
                                        }
                                        checkCount++;
                                    }
                                }

                                if (checkCount >= Object.keys(responder.typeRsrc).length) {
                                    responder.error_result(request, response, 400, 4000, 'BAD REQUEST - not supported resource type requested');
                                    return '0';
                                }
                            }
                            catch (e) {
                                responder.error_result(request, response, 400, 4000, 'BAD REQUEST');
                                return '0';
                            }
                        });
                    }
                }

                request.url = request.url.replace('%23', '#'); // convert '%23' to '#' of url
                request.hash = url.parse(request.url).hash;

                var absolute_url = request.url.replace('\/_\/', '\/\/').split('#')[0];
                absolute_url = absolute_url.replace(usespid, '/~');
                absolute_url = absolute_url.replace(/\/~\/[^\/]+\/?/, '/');
                var absolute_url_arr = absolute_url.split('/');

                console.log('\n' + request.method + ' : ' + request.url);
                request.bodyObj = {};

                var option = '';
                var sri = absolute_url_arr[1].split('?')[0];
                if (absolute_url_arr[absolute_url_arr.length - 1] == 'la' || absolute_url_arr[absolute_url_arr.length - 1] == 'latest') {
                    var ri = absolute_url.split('?')[0].replace('/latest', '');
                    ri = ri.replace('/la', '');
                    option = '/latest';
                }
                else if (absolute_url_arr[absolute_url_arr.length - 1] == 'ol' || absolute_url_arr[absolute_url_arr.length - 1] == 'oldest') {
                    ri = absolute_url.split('?')[0].replace('/oldest', '');
                    ri = ri.replace('/ol', '');
                    option = '/oldest';
                }
                else if (absolute_url_arr[absolute_url_arr.length - 1] == 'fopt') {
                    ri = absolute_url.split('?')[0].replace('/fopt', '');
                    option = '/fopt';
                }
                else {
                    ri = absolute_url.split('?')[0];
                    option = '';
                }

                var tid = require('shortid').generate();
                console.time('get_resource_from_url' + ' (' + tid + ') - ' + absolute_url);
                get_resource_from_url(request.connection, ri, sri, option, function (targetObject, status) {
                    console.timeEnd('get_resource_from_url' + ' (' + tid + ') - ' + absolute_url);
                    if (targetObject) {
                        request.targetObject = targetObject;
                        if (option == '/fopt') {
                            // check access right for fanoutpoint
                            check_grp(request, response, function (rsc, result_grp) {
                                if (rsc == '0') {
                                    return rsc;
                                }

                                if (request.method.toLowerCase() == 'post') {
                                    var access_value = '1';
                                }
                                else if (request.method.toLowerCase() == 'get') {
                                    if (request.query.fu == 1) {
                                        access_value = '32';
                                    }
                                    else {
                                        access_value = '2';
                                    }
                                }
                                else if (request.method.toLowerCase() == 'put') {
                                    access_value = '4';
                                }
                                else {
                                    access_value = '8'
                                }

                                var body_Obj = {};
                                security.check(request, response, targetObject[Object.keys(targetObject)[0]].ty, result_grp.macp, access_value, result_grp.cr, function (rsc, request, response) {
                                    if (rsc == '0') {
                                        responder.error_result(request, response, 403, 4103, '[app.use] ACCESS DENIED (fopt)');
                                        return '0';
                                    }

                                    if (request.method.toLowerCase() == 'post' || request.method.toLowerCase() == 'put') {
                                        parse_body_format(request, response, function (rsc, body_Obj) {
                                            if (rsc != '0') {
                                                fopt.check(request, response, result_grp, targetObject[Object.keys(targetObject)[0]].ty, body_Obj);
                                            }
                                        });
                                    }
                                    else {
                                        fopt.check(request, response, result_grp, targetObject[Object.keys(targetObject)[0]].ty, body_Obj);
                                    }
                                });
                            });
                        }
                        else {
                            absolute_url = targetObject[Object.keys(targetObject)[0]].ri;

                            next();
                        }
                    }
                    else {
                        if (status == 404) {
                            if (url.parse(absolute_url).pathname.split('/')[1] == usecsebase) {
                                responder.error_result(request, response, 404, 4004, '[app.use] resource does not exist');
                                return '0';
                            }
                            else {
                                check_csr(absolute_url, request, response);
                                return '0';
                            }
                        }
                        else if (status == 500) {
                            responder.error_result(request, response, 404, 4004, '[app.use] Database error at get_resource_from_url in ' + usecsebase);
                            return '0';
                        }
                    }
                });
            }
        });
    });
});

// remoteCSE, ae, cnt
app.post(onem2mParser, function (request, response) {
    var _ct = moment().utc().format('YYYYMMDD');
    var _http = 0;
    var _mqtt = 0;
    var _coap = 0;
    var _ws = 0;
    if (request.headers.hasOwnProperty('binding')) {
        if(request.headers['binding'] == 'H') {
            _http = 1;
        }
        else if(request.headers['binding'] == 'M') {
            _mqtt = 1;
        }
        else if(request.headers['binding'] == 'C') {
            _coap = 1;
        }
        else if(request.headers['binding'] == 'W') {
            _ws = 1;
        }
        db_sql.set_hit(request.connection, _ct, _http, _mqtt, _coap, _ws, function () {

        });
    }
    else {
        _http = 1;
        db_sql.set_hit(request.connection, _ct, _http, _mqtt, _coap, _ws, function () {

        });
    }

    if (request.body == "") {
        responder.error_result(request, response, 400, 4000, 'body is empty');
        return '0';
    }

    parse_body_format(request, response, function (rsc, body_Obj) {
        if (rsc != '0') {
            if (responder.typeRsrc[request.ty] != Object.keys(body_Obj)[0]) {
                if(responder.typeRsrc[request.ty] == 'mgo') {
                    var support_mgo = 0;
                    for (var prop in responder.mgoType) {
                        if(responder.mgoType.hasOwnProperty(prop)) {
                            if (responder.mgoType[prop] == Object.keys(body_Obj)[0]) {
                                support_mgo = 1;
                                break;
                            }
                        }
                    }

                    if(support_mgo == 0) {
                        responder.error_result(request, response, 400, 4000, 'ty [' + request.ty + '] is different with body (' + Object.keys(body_Obj)[0] + ')');
                        return '0';
                    }
                }
                else {
                    responder.error_result(request, response, 400, 4000, 'ty [' + request.ty + '] is different with body (' + Object.keys(body_Obj)[0] + ')');
                    return '0';
                }
            }

            if(request.ty == '2') {
                var allow = 1;
                if(allowed_app_ids.length > 0) {
                    allow = 0;
                    for(var idx in allowed_app_ids) {
                        if(allowed_app_ids.hasOwnProperty(idx)) {
                            if(allowed_app_ids[idx] == request.bodyObj.ae.api) {
                                allow = 1;
                                break;
                            }
                        }
                    }

                    if(allow == 0) {
                        responder.error_result(request, response, 403, 4107, 'OPERATION_NOT_ALLOWED: APP-ID in AE is not allowed');
                        return '0';
                    }
                }
            }

            var rootnm = Object.keys(request.targetObject)[0];
            var absolute_url = request.targetObject[rootnm].ri;
            check_notification(request, absolute_url, function (status, http_code, rsc_code, caption) {
                if (status == 'notify') {
                    check_ae(request.targetObject, request, response);
                }
                else if (status == 'post') {
                    request.url = absolute_url;
                    if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1 || request.query.rcn == 2 || request.query.rcn == 3)) {
                        lookup_create(request, response);
                    }
                    else {
                        responder.error_result(request, response, http_code, rsc_code, 'rcn or fu query is not supported at POST request');
                        return '0';
                    }
                }
                else if (status == '0') {
                    responder.error_result(request, response, http_code, rsc_code, caption);
                    return '0';
                }
            });
        }
    });
});

app.get(onem2mParser, function (request, response) {
    var _ct = moment().utc().format('YYYYMMDD');
    var _http = 0;
    var _mqtt = 0;
    var _coap = 0;
    var _ws = 0;
    if (request.headers.hasOwnProperty('binding')) {
        if(request.headers['binding'] == 'H') {
            _http = 1;
        }
        else if(request.headers['binding'] == 'M') {
            _mqtt = 1;
        }
        else if(request.headers['binding'] == 'C') {
            _coap = 1;
        }
        else if(request.headers['binding'] == 'W') {
            _ws = 1;
        }
        db_sql.set_hit(request.connection, _ct, _http, _mqtt, _coap, _ws, function () {

        });
    }
    else {
        _http = 1;
        db_sql.set_hit(request.connection, _ct, _http, _mqtt, _coap, _ws, function () {

        });
    }

    var rootnm = Object.keys(request.targetObject)[0];
    var absolute_url = request.targetObject[rootnm].ri;

    request.url = absolute_url;
    if ((request.query.fu == 1 || request.query.fu == 2) && (request.query.rcn == 1 || request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6 || request.query.rcn == 7)) {
        lookup_retrieve(request, response);
    }
    else {
        responder.error_result(request, response, 400, 4000, 'BAD_REQUEST (rcn or fu query is not supported at GET request)');
        return '0';
    }
});


app.put(onem2mParser, function (request, response) {
    var _ct = moment().utc().format('YYYYMMDD');
    var _http = 0;
    var _mqtt = 0;
    var _coap = 0;
    var _ws = 0;
    if (request.headers.hasOwnProperty('binding')) {
        if(request.headers['binding'] == 'H') {
            _http = 1;
        }
        else if(request.headers['binding'] == 'M') {
            _mqtt = 1;
        }
        else if(request.headers['binding'] == 'C') {
            _coap = 1;
        }
        else if(request.headers['binding'] == 'W') {
            _ws = 1;
        }
        db_sql.set_hit(request.connection, _ct, _http, _mqtt, _coap, _ws, function () {

        });
    }
    else {
        _http = 1;
        db_sql.set_hit(request.connection, _ct, _http, _mqtt, _coap, _ws, function () {

        });
    }

    if (request.body == "") {
        responder.error_result(request, response, 400, 4000, 'body is empty');
        return '0';
    }

    parse_body_format(request, response, function (rsc, body_Obj) {
        if (rsc != '0') {
            for (var ty_idx in responder.typeRsrc) {
                if (responder.typeRsrc.hasOwnProperty(ty_idx)) {
                    if ((ty_idx == 4) && (responder.typeRsrc[ty_idx] == Object.keys(body_Obj)[0])) {
                        responder.error_result(request, response, 405, 4005, 'Update cin is not supported');
                        return '0';
                    }
                    else if ((ty_idx != 4) && (responder.typeRsrc[ty_idx] == Object.keys(body_Obj)[0])) {
                        if ((ty_idx == 17) && (responder.typeRsrc[ty_idx] == Object.keys(body_Obj)[0])) {
                            responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED (req is not supported when put request)');
                            return 0;
                        }
                        else {
                            request.ty = ty_idx;
                            break;
                        }
                    }
                    else if (ty_idx == 13) {
                        for (var mgo_idx in responder.mgoType) {
                            if (responder.mgoType.hasOwnProperty(mgo_idx)) {
                                if ((responder.mgoType[mgo_idx] == Object.keys(body_Obj)[0])) {
                                    request.ty = ty_idx;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            var rootnm = Object.keys(request.targetObject)[0];
            var absolute_url = request.targetObject[rootnm].ri;

            if (url.parse(absolute_url).pathname == ('/' + usecsebase)) {
                responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED');
                return '0';
            }

            request.url = absolute_url;
            if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1)) {
                lookup_update(request, response);
            }
            else {
                responder.error_result(request, response, 400, 4000, 'rcn query is not supported at PUT request');
                return '0';
            }
        }
    });
});

app.delete(onem2mParser, function (request, response) {
    var _ct = moment().utc().format('YYYYMMDD');
    var _http = 0;
    var _mqtt = 0;
    var _coap = 0;
    var _ws = 0;
    if (request.headers.hasOwnProperty('binding')) {
        if(request.headers['binding'] == 'H') {
            _http = 1;
        }
        else if(request.headers['binding'] == 'M') {
            _mqtt = 1;
        }
        else if(request.headers['binding'] == 'C') {
            _coap = 1;
        }
        else if(request.headers['binding'] == 'W') {
            _ws = 1;
        }
        db_sql.set_hit(request.connection, _ct, _http, _mqtt, _coap, _ws, function () {

        });
    }
    else {
        _http = 1;
        db_sql.set_hit(request.connection, _ct, _http, _mqtt, _coap, _ws, function () {

        });
    }

    var rootnm = Object.keys(request.targetObject)[0];
    var absolute_url = request.targetObject[rootnm].ri;

    if (url.parse(absolute_url).pathname == ('/' + usecsebase)) {
        responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED');
        return '0';
    }

    request.url = absolute_url;
    if ((request.query.fu == 2) &&
        (request.query.rcn == 0 || request.query.rcn == 1)) {
        lookup_delete(request, response);
    }
    else {
        responder.error_result(request, response, 400, 4000, 'rcn query is not supported at DELETE request');
        return '0';
    }
});

function check_notification(request, url, callback) {
    if(request.headers.hasOwnProperty('content-type')) {
        if(request.headers['content-type'].includes('ty')) { // post
            callback('post');
        }
        else {
            if(request.headers.rootnm == 'sgn') {
                callback('notify');
            }
            else {
                callback('0', 400, 4000, '[check_notification] post request without ty value is but body is not for notification');
            }
        }
    }
    else {
        callback('0', 400, 4000, 'content-type is none');
    }
}

function check_ae(absolute_url, request, response) {
    var ri = absolute_url;
    console.log('[check_ae] : ' + ri);
    db_sql.select_ae(ri, function (err, result_ae) {
        if (!err) {
            if (result_ae.length == 1) {
                var point = {};
                var poa_arr = JSON.parse(result_ae[0].poa);
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = url.parse(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        console.log('send notification to ' + poa_arr[i]);

                        notify_http(poa.hostname, poa.port, poa.path, request, response);
                    }
                    else if (poa.protocol == 'coap:') {
                        console.log('send notification to ' + poa_arr[i]);

                        notify_http(poa.hostname, poa.port, poa.path, request, response);
                    }
                    else if (poa.protocol == 'mqtt:') {
                        responder.error_result(request, response, 500, 5000, 'notification with mqtt is not supported');
                        return '0';
                    }
                    else if (poa.protocol == 'ws:') {
                        responder.error_result(request, response, 500, 5000, 'notification with mqtt is not supported');
                        return '0';
                    }
                    else {
                        point = {};
                        point['dbg'] = 'protocol(' + poa.protocol + ') in poa of ae is not supported';
                        responder.error_result(request, response, 400, 4000, point['dbg']);
                        return '0';
                    }
                }
            }
            else {
                point = {};
                point['dbg'] = 'ae is not found';
                responder.error_result(request, response, 400, 4000, point['dbg']);
                return '0';
            }
        }
        else {
            console.log('[check_ae] query error: ' + result_ae.message);
        }
    });
}

function check_csr(absolute_url, request, response) {
    var ri = util.format('/%s/%s', usecsebase, url.parse(absolute_url).pathname.split('/')[1]);
    console.log('[check_csr] : ' + ri);
    db_sql.select_csr(request.connection, ri, function (err, result_csr) {
        if (!err) {
            if (result_csr.length == 1) {
                var point = {};
                point.forwardcbname = result_csr[0].cb.replace('/', '');
                var poa_arr = JSON.parse(result_csr[0].poa);
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = url.parse(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        point.forwardcbhost = poa.hostname;
                        point.forwardcbport = poa.port;

                        console.log('csebase forwarding to ' + point.forwardcbname);

                        request.connection.release();
                        forward_http(point.forwardcbhost, point.forwardcbport, request, response);
                    }
                    else if (poa.protocol == 'mqtt:') {
                        point.forwardcbmqtt = poa.hostname;

                        responder.error_result(request, response, 500, 5000, 'forwarding with mqtt is not supported');
                        return '0';
                    }
                    else {
                        point = {};
                        point['dbg'] = 'protocol(' + poa.protocol + ') in poa of csr is not supported';
                        responder.error_result(request, response, 400, 4000, point['dbg']);
                        return '0';
                    }
                }
            }
            else {
                point = {};
                point['dbg'] = 'csebase is not found';
                responder.error_result(request, response, 400, 4000, point['dbg']);
                return '0';
            }
        }
        else {
            console.log('[check_csr] query error: ' + result_csr.message);
        }
    });
}


function notify_http(hostname, port, path, request, response) {
    var options = {
        hostname: hostname,
        port: port,
        path: path,
        method: request.method,
        headers: request.headers
    };

    var req = http.request(options, function (res) {
        var fullBody = '';
        res.on('data', function (chunk) {
            fullBody += chunk.toString();
        });

        res.on('end', function () {
            console.log('--------------------------------------------------------------------------');
            //console.log(res.url);
            //console.log(res.headers);
            console.log(fullBody);
            console.log('[notify_http response : ' + res.statusCode + ']');

            //response.headers = res.headers;
            if (res.headers['content-type']) {
                response.header('Content-Type', res.headers['content-type']);
            }
            if (res.headers['x-m2m-ri']) {
                response.header('X-M2M-RI', res.headers['x-m2m-ri']);
            }
            if (res.headers['x-m2m-rvi']) {
                response.header('X-M2M-RVI', res.headers['x-m2m-rvi']);
            }
            if (res.headers['x-m2m-rsc']) {
                response.header('X-M2M-RSC', res.headers['x-m2m-rsc']);
            }
            if (res.headers['content-location']) {
                response.header('Content-Location', res.headers['content-location']);
            }

            response.statusCode = res.statusCode;
            response.send(fullBody);
        });
    });

    req.on('error', function (e) {
        console.log('[forward_http] problem with request: ' + e.message);

        response.statusCode = '404';
        response.send(url.parse(request.url).pathname + ' : ' + e.message);
    });

    console.log(request.method + ' - ' + path);
//    console.log(request.headers);
    console.log(request.body);

    // write data to request body
    if ((request.method.toLowerCase() == 'get') || (request.method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(request.body);
    }
    req.end();
}

function forward_http(forwardcbhost, forwardcbport, request, response) {
    var options = {
        hostname: forwardcbhost,
        port: forwardcbport,
        path: request.url,
        method: request.method,
        headers: request.headers
    };

    var req = http.request(options, function (res) {
        var fullBody = '';
        res.on('data', function (chunk) {
            fullBody += chunk.toString();
        });

        res.on('end', function () {
            console.log('--------------------------------------------------------------------------');
            console.log(res.url);
            console.log(res.headers);
            console.log(fullBody);
            console.log('[Forward response : ' + res.statusCode + ']');

            //response.headers = res.headers;
            if (res.headers['content-type']) {
                response.header('Content-Type', res.headers['content-type']);
            }
            if (res.headers['x-m2m-ri']) {
                response.header('X-M2M-RI', res.headers['x-m2m-ri']);
            }
            if (res.headers['x-m2m-rvi']) {
                response.header('X-M2M-RVI', res.headers['x-m2m-rvi']);
            }
            if (res.headers['x-m2m-rsc']) {
                response.header('X-M2M-RSC', res.headers['x-m2m-rsc']);
            }
            if (res.headers['content-location']) {
                response.header('Content-Location', res.headers['content-location']);
            }

            response.statusCode = res.statusCode;
            response.send(fullBody);
        });
    });

    req.on('error', function (e) {
        console.log('[forward_http] problem with request: ' + e.message);

        response.statusCode = '404';
        response.send(url.parse(request.url).pathname + ' : ' + e.message);
    });

    console.log(request.method + ' - ' + request.url);
    console.log(request.headers);
    console.log(request.body);

    // write data to request body
    if ((request.method.toLowerCase() == 'get') || (request.method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(request.body);
    }
    req.end();
}

if (process.env.NODE_ENV == 'production') {
    console.log("Production Mode");
} else if (process.env.NODE_ENV == 'development') {
    console.log("Development Mode");
}