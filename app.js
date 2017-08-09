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
 * @file Main code of Mobius Yellow. Role of flow router
 * @copyright KETI Korea 2015, OCEAN
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
const crypto = require('crypto');
var fileStreamRotator = require('file-stream-rotator');
var merge = require('merge');
var https = require('https');
var cbor = require('cbor');
var moment = require('moment');

global.NOPRINT = 'true';
global.ONCE = 'true';

var cb = require('./mobius/cb');
var responder = require('./mobius/responder');
var resource = require('./mobius/resource');
var security = require('./mobius/security');
var fopt = require('./mobius/fopt');

var db = require('./mobius/db_action');
var db_sql = require('./mobius/sql_action');

// ������ �����մϴ�.
var app = express();

global.M2M_SP_ID = '//mobius.keti.re.kr';

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

var logDirectory = global.logDir;

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
    db_sql.delete_req(function (err, delete_Obj) {
        if(!err) {
            console.log('deleted ' + delete_Obj.affectedRows + ' request resource(s).');
        }
    });
}

function del_expired_resource() {
    // this routine is that delete resource expired time exceed et of resource
    var et = moment().utc().format('YYYYMMDDTHHmmss');
    db_sql.delete_lookup_et(et, function (err) {
        if(!err) {
            console.log('---------------');
            console.log('delete resources expired et');
            console.log('---------------');
        }
    });
}

var cluster = require('cluster');
var os = require('os');
var cpuCount = os.cpus().length;
var worker = [];
const use_clustering = 1;
if (use_clustering) {
    if (cluster.isMaster) {
        cluster.on('death', function (worker) {
            console.log('worker' + worker.pid + ' died --> start again');
            cluster.fork();
        });

        db.connect(usedbhost, 3306, usedbuser, usedbpass, usedbname, function (rsc) {
            if (rsc == '1') {
                cb.create(function (rsp) {
                    console.log(JSON.stringify(rsp));

                    console.log('CPU Count:', cpuCount);
                    for (var i = 0; i < cpuCount; i++) {
                        worker[i] = cluster.fork();
                    }

                    wdt.set_wdt(require('shortid').generate(), 43200, del_req_resource);
                    wdt.set_wdt(require('shortid').generate(), 86400, del_expired_resource);

                    require('./pxy_mqtt');
                    require('./pxy_coap');
                    require('./pxy_ws');

                    if (usecsetype == 'mn' || usecsetype == 'asn') {
                        global.refreshIntervalId = setInterval(function () {
                            csr_custom.emit('register_remoteCSE');
                        }, 5000);
                    }
                });
            }
        });
    }
    else {
        //   app.use(bodyParser.urlencoded({ extended: true }));
        //   app.use(bodyParser.json({limit: '1mb', type: 'application/*+json' }));
        //   app.use(bodyParser.text({limit: '1mb', type: 'application/*+xml' }));


        db.connect(usedbhost, 3306, usedbuser, usedbpass, usedbname, function (rsc) {
            if (rsc == '1') {
                if(usesecure === 'disable') {
                    http.globalAgent.maxSockets = 1000000;
                    http.createServer(app).listen({port: usecsebaseport, agent: false}, function () {
                        console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                        cb.create(function (rsp) {
                            console.log(JSON.stringify(rsp));
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
                        cb.create(function (rsp) {
                            console.log(JSON.stringify(rsp));
                        });
                    });
                }
            }
        });
    }
}
else {
    db.connect(usedbhost, 3306, usedbuser, usedbpass, usedbname, function (rsc) {
        if (rsc == '1') {
            cb.create(function (rsp) {
                console.log(JSON.stringify(rsp));

                if(usesecure === 'disable') {
                    http.globalAgent.maxSockets = 1000000;
                    http.createServer(app).listen({port: usecsebaseport, agent: false}, function () {
                        console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                        require('./pxy_mqtt');
                        //require('./mobius/ts_agent');

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
                        //require('./mobius/ts_agent');

                        if (usecsetype === 'mn' || usecsetype === 'asn') {
                            global.refreshIntervalId = setInterval(function () {
                                csr_custom.emit('register_remoteCSE');
                            }, 5000);
                        }
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
        db_sql.get_ri_sri(request, response, sri_list[count], function (err, results, request, response) {
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

global.update_route = function (callback) {
    var cse_poa = {};
    db_sql.select_csr_like(usecsebase, function (err, results_csr) {
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

function make_short_nametype(nmtype, body_Obj) {
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

global.make_json_arraytype = function (body_Obj) {
    for (var prop in body_Obj) {
        if (body_Obj.hasOwnProperty(prop)) {
            for (var attr in body_Obj[prop]) {
                if (body_Obj[prop].hasOwnProperty(attr)) {
                    if (attr == 'aa' || attr == 'at' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' || attr == 'nu' || attr == 'mid' || attr == 'macp') {
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
                                    var temp = body_Obj[prop][attr].acr;
                                    body_Obj[prop][attr].acr = [];
                                    body_Obj[prop][attr].acr[0] = temp;
                                }

                                for (var acr_idx in body_Obj[prop][attr].acr) {
                                    if (body_Obj[prop][attr].acr.hasOwnProperty(acr_idx)) {
                                        if (body_Obj[prop][attr].acr[acr_idx].acor) {
                                            body_Obj[prop][attr].acr[acr_idx].acor = body_Obj[prop][attr].acr[acr_idx].acor.split(' ');
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

function check_body_format(request) {
    request.headers.usebodytype = 'json';
    if (request.headers.accept) {
        try {
            if ((request.headers.accept.split('/')[1] == 'xml') || (request.headers.accept.split('+')[1] == 'xml')) {
                request.headers.usebodytype = 'xml';
            }
            else if ((request.headers.accept.split('/')[1] == 'cbor') || (request.headers.accept.split('+')[1] == 'cbor')) {
                request.headers.usebodytype = 'cbor';
            }
        }
        catch (e) {
        }
    }
}

function check_http_body(request, response, callback) {
    var body_Obj = {};

    if (request.body == "") {
        responder.error_result(request, response, 400, 4000, 'body is empty');
        callback('0', body_Obj, 'json', request, response);
        return '0';
    }

    //console.log(request.body);

    try {
        var content_type = request.headers['content-type'].split(';');
    }
    catch (e) {
        responder.error_result(request, response, 400, 4000, 'content-type is null');
        callback('0', body_Obj, content_type, request, response);
        return '0';
    }

    if(request.headers['content-type'].includes('xml')) {
        request.headers.usebodytype = 'xml';
    }
    else if(request.headers['content-type'].includes('cbor')) {
        request.headers.usebodytype = 'cbor';
    }
    else {
        request.headers.usebodytype = 'json';
    }

    if (request.headers.usebodytype === 'xml') {
        try {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(request.body, function (err, result) {
                if (err) {
                    responder.error_result(request, response, 400, 4000, 'do not parse xml body');
                    callback('0', body_Obj, content_type, request, response);
                }
                else {
                    body_Obj = result;
                    make_short_nametype(request.headers.nmtype, body_Obj);
                    make_json_arraytype(body_Obj);

                    callback('1', body_Obj, content_type, request, response);
                }
            });
        }
        catch(e) {
            responder.error_result(request, response, 400, 4000, 'do not parse xml body');
            callback('0', body_Obj, content_type, request, response);
        }
    }
    else if (request.headers.usebodytype === 'cbor') {
        try {
            var encoded = request.body;
            cbor.decodeFirst(encoded, function(err, body_Obj) {
                if (err) {
                    responder.error_result(request, response, 400, 4000, 'do not parse cbor body');
                    callback('0', body_Obj, content_type, request, response);
                }
                else {
                    make_short_nametype(request.headers.nmtype, body_Obj);
                    //make_json_arraytype(body_Obj);

                    callback('1', body_Obj, content_type, request, response);
                }
            });
        }
        catch(e) {
            responder.error_result(request, response, 400, 4000, 'do not parse xml body');
            callback('0', body_Obj, content_type, request, response);
        }
    }
    else {
        try {
            body_Obj = JSON.parse(request.body.toString());
            make_short_nametype(request.headers.nmtype, body_Obj);

            if (Object.keys(body_Obj)[0] == 'undefined') {
                responder.error_result(request, response, 400, 4000, 'root tag of body is not matched');
                callback('0', body_Obj, content_type, request, response);
                return 0;
            }
            callback('1', body_Obj, content_type, request, response);
        }
        catch (e) {
            responder.error_result(request, response, 400, 4000, 'do not parse json body');
            callback('0', body_Obj, content_type, request, response);
        }
    }
}

function check_http(request, response, callback) {
    request.headers.rootnm = 'dbg';

    var body_Obj = {};
    if (request.headers.nmtype == null) {
        request.headers.nmtype = defaultnmtype;
    }

//    check_body_format();

    // Check X-M2M-RI Header
    if ((request.headers['x-m2m-ri'] == null)) {
        responder.error_result(request, response, 400, 4000, 'X-M2M-RI is null');
        callback('0', body_Obj, request, response);
        return '0';
    }

    // Check X-M2M-Origin Header
    if ((request.headers['x-m2m-origin'] == null || request.headers['x-m2m-origin'] == '')) {
        // responder.error_result(request, response, 400, 4000, 'X-M2M-Origin Header is null');
        // callback('0', body_Obj, request, response);
        // return '0';

        request.headers['x-m2m-origin'] = 'S';
    }

    /*if (request.headers['x-m2m-origin'].substr(0, 1) != '/' && request.headers['x-m2m-origin'].substr(0, 1) != 'S' && request.headers['x-m2m-origin'].substr(0, 1) != 'C') {
     body_Obj = {};
     body_Obj['dbg'] = 'AE-ID should start capital S or C or / in X-M2M-Origin Header';
     responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
     callback('0', body_Obj, request, response);
     return '0';
     }*/ // ignore value of Origin tag

    /*if (request.method != 'POST' && (request.headers['x-m2m-origin'] == 'S' || request.headers['x-m2m-origin'] == 'C' || request.headers['x-m2m-origin'] == '/')) {
     body_Obj = {};
     body_Obj['dbg'] = 'When GET, PUT, DELETE request, AE-ID should be full AE-ID in X-M2M-Origin Header';
     responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
     callback('0', body_Obj, request, response);
     return '0';
     }*/

    var url_arr = url.parse(request.url).pathname.split('/');
    var last_url = url_arr[url_arr.length - 1];

    if (request.method == 'POST' || request.method == 'PUT') {
        // if(content_type[0].split('+')[0] != 'application/vnd.onem2m-res') {
        //     body_Obj['dbg'] = 'Content-Type is not match (application/vnd.onem2m-res)';
        //     responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        //     callback('0', body_Obj, request, response);
        //     return '0';
        // }

        //resource.set_rootnm(request, ty);
        //var rootnm = request.headers.rootnm;

        check_http_body(request, response, function (rsc, body_Obj, content_type, request, response) {
            if (rsc == '1') {
                if (request.method == 'POST') {
                    try {
                        var ty = content_type[1].split('=')[1];
                    }
                    catch (e) {
                        responder.error_result(request, response, 400, 4000, 'ty is null');
                        callback('0', body_Obj, request, response);
                        return '0';
                    }

                    if (ty == '17') {
                        responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED (req is not supported when post request)');
                        callback('0', body_Obj, request, response);
                        return '0';
                    }

                    if (responder.typeRsrc[ty] != Object.keys(body_Obj)[0]) {
                        if(responder.typeRsrc[ty] == 'mgo') {
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
                                responder.error_result(request, response, 400, 4000, 'ty [' + ty + '] is different with body (' + Object.keys(body_Obj)[0] + ')');
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }
                        else {
                            responder.error_result(request, response, 400, 4000, 'ty [' + ty + '] is different with body (' + Object.keys(body_Obj)[0] + ')');
                            callback('0', body_Obj, request, response);
                            return '0';
                        }
                    }
                }
                else {
                    ty = '99';
                    for (var ty_idx in responder.typeRsrc) {
                        if (responder.typeRsrc.hasOwnProperty(ty_idx)) {
                            if ((ty_idx == 4) && (responder.typeRsrc[ty_idx] == Object.keys(body_Obj)[0])) {
                                responder.error_result(request, response, 400, 4000, 'Update cin is not supported');
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                            else if ((ty_idx != 4) && (responder.typeRsrc[ty_idx] == Object.keys(body_Obj)[0])) {
                                if ((ty_idx == 17) && (responder.typeRsrc[ty_idx] == Object.keys(body_Obj)[0])) {
                                    responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED (req is not supported when put request)');
                                    callback('0', body_Obj, request, response);
                                    return 0;
                                }
                                else {
                                    ty = ty_idx;
                                    break;
                                }
                            }
                        }
                    }

                    if (ty == '99') {
                        responder.error_result(request, response, 400, 4000, 'resource type in body is not match to target resource');
                        callback('0', body_Obj, request, response);
                        return '0';
                    }
                }

                request.headers.rootnm = Object.keys(body_Obj)[0];

                for (prop in body_Obj) {
                    if (body_Obj.hasOwnProperty(prop)) {
                        if (body_Obj[prop].aa) {
                            if (!Array.isArray(body_Obj[prop].aa)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'aa should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].at) {
                            if (!Array.isArray(body_Obj[prop].at)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'at should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].poa) {
                            if (!Array.isArray(body_Obj[prop].poa)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'poa should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].lbl) {
                            if (!Array.isArray(body_Obj[prop].lbl)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'lbl should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].acpi) {
                            if (!Array.isArray(body_Obj[prop].acpi)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'acpi should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].srt) {
                            if (!Array.isArray(body_Obj[prop].srt)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'srt should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].nu) {
                            if (!Array.isArray(body_Obj[prop].nu)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'nu should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].enc) {
                            if (body_Obj[prop].enc.net) {
                                if (!Array.isArray(body_Obj[prop].enc.net)) {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'enc.net should be json array format';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0', body_Obj, request, response);
                                    return '0';
                                }
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = 'enc should have net key in json format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].pv) {
                            if (body_Obj[prop].pv.acr) {
                                if (!Array.isArray(body_Obj[prop].pv.acr)) {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'pv.acr should be json array format';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0', body_Obj, request, response);
                                    return '0';
                                }

                                if (body_Obj[prop].pv.acr.acor) {
                                    if (!Array.isArray(body_Obj[prop].pv.acr.acor)) {
                                        body_Obj = {};
                                        body_Obj['dbg'] = 'pv.acr.acor should be json array format';
                                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                        callback('0', body_Obj, request, response);
                                        return '0';
                                    }
                                }
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = 'pv should have acr key in json format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].pvs) {
                            if (body_Obj[prop].pvs.acr) {
                                if (!Array.isArray(body_Obj[prop].pvs.acr)) {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'pvs.acr should be json array format';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0', body_Obj, request, response);
                                    return '0';
                                }

                                if (body_Obj[prop].pvs.acr.acor) {
                                    if (!Array.isArray(body_Obj[prop].pvs.acr.acor)) {
                                        body_Obj = {};
                                        body_Obj['dbg'] = 'pvs.acr.acor should be json array format';
                                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                        callback('0', body_Obj, request, response);
                                        return '0';
                                    }
                                }
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = 'pvs should have acr key in json format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].mid) {
                            if (!Array.isArray(body_Obj[prop].mid)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'mid should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].macp) {
                            if (!Array.isArray(body_Obj[prop].macp)) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'macp should be json array format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].uds) {
                            if (body_Obj[prop].uds.can && body_Obj[prop].uds.sus) {
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = 'uds should have can and sus key in json format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }

                        if (body_Obj[prop].cas) {
                            if (body_Obj[prop].cas.can && body_Obj[prop].cas.sus) {
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = 'cas should have can and sus key in json format';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0', body_Obj, request, response);
                                return '0';
                            }
                        }
                    }
                }

                callback(ty, body_Obj, request, response);
            }
        });
    }
    else if (request.method == 'GET' || request.method == 'DELETE') {
        if (last_url == 'latest' || last_url == 'la') {
            callback('latest', body_Obj, request, response);
        }
        else if (last_url == 'oldest' || last_url == 'ol') {
            callback('oldest', body_Obj, request, response);
        }
        else {
            callback('direct', body_Obj, request, response);
        }
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'request method is not supported';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', body_Obj, request, response);
        return '0';
    }
}

function check_resource(request, response, callback) {
    var ri = url.parse(request.url).pathname;

    var url_arr = ri.split('/');
    var last_url = url_arr[url_arr.length - 1];
    var op = 'direct';

    if (last_url == 'latest' || last_url == 'la') {
        ri = ri.replace('/latest', '');
        ri = ri.replace('/la', '');
        op = 'latest';
        db_sql.select_direct_lookup(ri, function (err, result_Obj) {
            if (!err) {
                if (result_Obj.length == 1) {
                    if (result_Obj[0].ty == '3') {
                        var cur_ty = '4';
                    }
                    else if (result_Obj[0].ty == '29') {
                        cur_ty = '30';
                    }
                    else {
                        result_Obj = {};
                        result_Obj['dbg'] = 'this resource can not have latest resource';
                        responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
                        callback('0', {}, '', request, response);
                        return '0';
                    }
                    var cur_d = new Date();
                    db_sql.select_latest_lookup(ri, cur_d, 0, cur_ty, function (err, result_Obj) {
                        if (!err) {
                            if (result_Obj.length == 1) {
                                result_Obj[0].acpi = JSON.parse(result_Obj[0].acpi);
                                result_Obj[0].lbl = JSON.parse(result_Obj[0].lbl);
                                result_Obj[0].aa = JSON.parse(result_Obj[0].aa);
                                result_Obj[0].at = JSON.parse(result_Obj[0].at);
                                callback('1', result_Obj[0], op, request, response);
                            }
                            else {
                                result_Obj = {};
                                result_Obj['dbg'] = 'resource does not exist';
                                responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
                                callback('0', {}, '', request, response);
                                return '0';
                            }
                        }
                        else {
                            var code = result_Obj.message;
                            result_Obj = {};
                            result_Obj['dbg'] = code;
                            responder.response_result(request, response, 500, result_Obj, 5000, request.url, result_Obj['dbg']);
                            callback('0', {}, '', request, response);
                            return '0';
                        }
                    });
                }
                else {
                    result_Obj = {};
                    result_Obj['dbg'] = 'resource does not exist';
                    responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
                    callback('0', {}, '', request, response);
                    return '0';
                }
            }
            else {
                var code = result_Obj.message;
                result_Obj = {};
                result_Obj['dbg'] = code;
                responder.response_result(request, response, 500, result_Obj, 5000, request.url, result_Obj['dbg']);
                callback('0', {}, '', request, response);
                return '0';
            }
        });
    }
    else if (last_url == 'oldest' || last_url == 'ol') {
        ri = ri.replace('/oldest', '');
        ri = ri.replace('/ol', '');
        op = 'oldest';
        db_sql.select_oldest_lookup(ri, function (err, result_Obj) {
            if (!err) {
                if (result_Obj.length == 1) {
                    result_Obj[0].acpi = JSON.parse(result_Obj[0].acpi);
                    result_Obj[0].lbl = JSON.parse(result_Obj[0].lbl);
                    result_Obj[0].aa = JSON.parse(result_Obj[0].aa);
                    result_Obj[0].at = JSON.parse(result_Obj[0].at);
                    callback('1', result_Obj[0], op, request, response);
                }
                else {
                    result_Obj = {};
                    result_Obj['dbg'] = 'resource does not exist';
                    responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
                    callback('0', {}, '', request, response);
                    return '0';
                }
            }
            else {
                var code = result_Obj.message;
                result_Obj = {};
                result_Obj['dbg'] = code;
                responder.response_result(request, response, 500, result_Obj, 5000, request.url, result_Obj['dbg']);
                callback('0', {}, '', request, response);
                return '0';
            }
        });
    }
    else if (last_url == 'fanoutpoint' || last_url == 'fopt') {
        ri = ri.replace('/fanoutpoint', '');
        ri = ri.replace('/fopt', '');
        op = 'fanoutpoint';
        db_sql.select_grp_lookup(ri, function (err, result_Obj) {
            if (!err) {
                if (result_Obj.length == 1) {
                    result_Obj[0].acpi = JSON.parse(result_Obj[0].acpi);
                    result_Obj[0].lbl = JSON.parse(result_Obj[0].lbl);
                    result_Obj[0].aa = JSON.parse(result_Obj[0].aa);
                    result_Obj[0].at = JSON.parse(result_Obj[0].at);
                    callback('1', result_Obj[0], op, request, response);
                }
                else {
                    result_Obj = {};
                    result_Obj['dbg'] = 'resource does not exist';
                    responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
                    callback('0', {}, '', request, response);
                    return '0';
                }
            }
            else {
                var code = result_Obj.message;
                result_Obj = {};
                result_Obj['dbg'] = code;
                responder.response_result(request, response, 500, result_Obj, 5000, request.url, result_Obj['dbg']);
                callback('0', {}, '', request, response);
                return '0';
            }
        });
    }
    else {
        op = 'direct';
        console.log('X-M2M-Origin: ' + request.headers['x-m2m-origin']);
        db_sql.select_direct_lookup(ri, function (err, result_Obj) {
            if (!err) {
                if (result_Obj.length == 1) {
                    result_Obj[0].acpi = JSON.parse(result_Obj[0].acpi);
                    result_Obj[0].lbl = JSON.parse(result_Obj[0].lbl);
                    result_Obj[0].aa = JSON.parse(result_Obj[0].aa);
                    result_Obj[0].at = JSON.parse(result_Obj[0].at);
                    callback('1', result_Obj[0], op, request, response);
                }
                else {
                    result_Obj = {};
                    result_Obj['dbg'] = 'resource does not exist';
                    responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
                    callback('0', {}, '', request, response);
                    return '0';
                }
            }
            else {
                result_Obj = {};
                result_Obj['dbg'] = result_Obj.message;
                responder.response_result(request, response, 500, result_Obj, 5000, request.url, result_Obj['dbg']);
                callback('0', {}, '', request, response);
                return '0';
            }
        });
    }
}

function check_rt_query(request, response, callback) {
    //var ri = url.parse(request.url).pathname;

    //var url_arr = ri.split('/');
    //var last_url = url_arr[url_arr.length-1];
    //var op = 'direct';

    if (request.query.rt == 3) { // default, blocking
        check_resource(request, response, function (rsc, parent_comm, op, request, response) {
            callback(rsc, parent_comm, op, request, response);
        });
    }
    else if (request.query.rt == 1 || request.query.rt == 2) { // nodblocking
        if(request.query.rt == 2 && request.headers['x-m2m-rtu'] == null) {
            body_Obj = {};
            body_Obj['dbg'] = 'X-M2M-RTU is null';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', {}, '', request, response);
            return '0';
        }

        // first create request resource under CSEBase
        var temp_rootnm = request.headers.rootnm;
        //var temp_rt = request.query.rt;
        var ty = '17';
        var body_Obj = {req: {}};
        request.headers.rootnm = Object.keys(body_Obj)[0];
        request.query.rt = 3;
        resource.create(request, response, ty, body_Obj, function (rsc) {
            if (rsc == '1') {
                request.headers.rootnm = temp_rootnm;
                request.query.rt = 1;
                check_resource(request, response, function (rsc, parent_comm, op, request, response) {
                    callback(rsc, parent_comm, op, request, response);
                });
            }
        });
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'OPERATION_NOT_ALLOWED (rt query is not supported)';
        responder.response_result(request, response, 405, body_Obj, 4005, request.url, body_Obj['dbg']);
        callback('0', {}, '', request, response);
        return '0';
    }
}

function check_grp(request, response, ri, callback) {
    db_sql.select_grp(ri, function (err, result_Obj) {
        if (!err) {
            if (result_Obj.length == 1) {
                result_Obj[0].macp = JSON.parse(result_Obj[0].macp);
                result_Obj[0].mid = JSON.parse(result_Obj[0].mid);
                callback('1', result_Obj[0]);
            }
            else {
                result_Obj = {};
                result_Obj['dbg'] = 'resource does not exist';
                responder.response_result(request, response, 404, result_Obj, 4004, request.url, result_Obj['dbg']);
                callback('0');
                return '0';
            }
        }
        else {
            result_Obj = {};
            result_Obj['dbg'] = result_Obj.message;
            responder.response_result(request, response, 500, result_Obj, 5000, request.url, result_Obj['dbg']);
            callback('0');
            return '0';
        }
    });
}

/**
 *
 * @param request
 * @param response
 */
function lookup_create(request, response) {
    check_http(request, response, function (ty, body_Obj, request, response) {
        if (ty == '0') {
            return ty;
        }
        check_rt_query(request, response, function (rsc, parent_comm, op, request, response) {
            if (rsc == '0') {
                return rsc;
            }

            var rootnm = request.headers.rootnm;

            if (op == 'fanoutpoint') {
                // check access right for fanoutpoint
                check_grp(request, response, parent_comm.ri, function (rsc, result_grp) {
                    if (rsc == '0') {
                        return rsc;
                    }

                    security.check(request, response, parent_comm.ty, result_grp.macp, '1', result_grp.cr, function (rsc, request, response) {
                        if (rsc == '0') {
                            body_Obj = {};
                            body_Obj['dbg'] = 'ACCESS_DENIED';
                            responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                            return '0';
                        }

                        fopt.check(request, response, result_grp, ty, body_Obj);
                    });
                });
            }
            else { //if(op == 'direct') {
                if ((ty == 1) && (parent_comm.ty == 5 || parent_comm.ty == 16 || parent_comm.ty == 2)) { // accessControlPolicy
                }
                else if ((ty == 9) && (parent_comm.ty == 5 || parent_comm.ty == 16 || parent_comm.ty == 2)) { // group
                }
                else if ((ty == 16) && (parent_comm.ty == 5)) { // remoteCSE
                    if (usecsetype == 'asn' && request.headers.csr == null) {
                        body_Obj = {};
                        body_Obj['dbg'] = 'ASN CSE can not have child CSE (remoteCSE)';
                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                        return '0';
                    }
                }
                else if ((ty == 10) && (parent_comm.ty == 5)) { // locationPolicy
                }
                else if ((ty == 2) && (parent_comm.ty == 5)) { // ae
                }
                else if ((ty == 3) && (parent_comm.ty == 5 || parent_comm.ty == 2 || parent_comm.ty == 3)) { // container
                }
                else if ((ty == 23) && (parent_comm.ty == 5 || parent_comm.ty == 16 || parent_comm.ty == 2 ||
                    parent_comm.ty == 3 || parent_comm.ty == 24 || parent_comm.ty == 29 || parent_comm.ty == 9 || parent_comm.ty == 1 || parent_comm.ty == 27)) { // sub
                }
                else if ((ty == 4) && (parent_comm.ty == 3)) { // contentInstance
                }
                else if ((ty == 24) && (parent_comm.ty == 2 || parent_comm.ty == 3 || parent_comm.ty == 4 || parent_comm.ty == 29)) { // semanticDescriptor
                }
                else if ((ty == 29) && (parent_comm.ty == 5 || parent_comm.ty == 16 || parent_comm.ty == 2)) { // timeSeries
                }
                else if ((ty == 30) && (parent_comm.ty == 29)) { // timeSeriesInstance
                    body_Obj[rootnm].mni = parent_comm.mni;
                }
                else if ((ty == 27) && (parent_comm.ty == 2 || parent_comm.ty == 16)) { // multimediaSession
                }
                else if ((ty == 14) && (parent_comm.ty == 5)) { // node
                }
                else if ((ty == 13) && (parent_comm.ty == 14)) { // mgmtObj
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = 'TARGET_NOT_SUBSCRIBABLE: request ty creating can not create under parent resource';
                    responder.response_result(request, response, 403, body_Obj, 5203, request.url, body_Obj['dbg']);
                    return '0';
                }

                // for security with acp
                if (!body_Obj[rootnm].acpi) {
                    body_Obj[rootnm].acpi = [];
                }

                for (var index in parent_comm.acpi) {
                    if (parent_comm.acpi.hasOwnProperty(index)) {
                        body_Obj[rootnm].acpi.push(parent_comm.acpi[index]);
                    }
                }

                if (parent_comm.ty == 2 || parent_comm.ty == 4 || parent_comm.ty == 3 || parent_comm.ty == 9 || parent_comm.ty == 24 || parent_comm.ty == 23 || parent_comm.ty == 29) {
                    db_sql.select_resource(responder.typeRsrc[parent_comm.ty], parent_comm.ri, function (err, parent_spec) {
                        if (!err) {

                            if ((ty == 4) && (parent_comm.ty == 3)) { // contentInstance
                                if (parent_spec[0].mni == null) {
                                    body_Obj[rootnm].mni = '3153600000';
                                }
                                else {
                                    if (parseInt(parent_spec[0].mni) == 0) {
                                        body_Obj = {};
                                        body_Obj['dbg'] = 'can not create cin because mni value is zero';
                                        responder.response_result(request, response, 406, body_Obj, 5207, request.url, body_Obj['dbg']);
                                        return '0';
                                    }
                                    else if (parseInt(parent_spec[0].mbs) == 0) {
                                        body_Obj = {};
                                        body_Obj['dbg'] = 'can not create cin because mbs value is zero';
                                        responder.response_result(request, response, 406, body_Obj, 5207, request.url, body_Obj['dbg']);
                                        return '0';
                                    }
                                    else {
                                        body_Obj[rootnm].mni = parent_spec[0].mni;
                                    }
                                }
                            }

                            if (parent_spec.length == 0) {
                                parent_spec[0] = {};
                                parent_spec[0].cr = '';
                                console.log('no creator');
                            }
                            else {
                                if (parent_comm.ty == 2) {
                                    parent_spec[0].cr = parent_spec[0].aei;
                                }
                            }

                            security.check(request, response, parent_comm.ty, parent_comm.acpi, '1', parent_spec[0].cr, function (rsc, request, response) {
                                if (rsc == '0') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'ACCESS_DENIED';
                                    responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                                    return '0';
                                }
                                resource.create(request, response, ty, body_Obj, function (rsc) {

                                });
                            });
                        }
                    });
                }
                else {
                    if (ty == 23) {
                        var access_value = '3';
                    }
                    else {
                        access_value = '1';
                    }
                    security.check(request, response, parent_comm.ty, parent_comm.acpi, access_value, '', function (rsc, request, response) {
                        if (rsc == '0') {
                            body_Obj = {};
                            body_Obj['dbg'] = 'ACCESS_DENIED';
                            responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                            return '0';
                        }
                        resource.create(request, response, ty, body_Obj, function (rsc) {

                        });
                    });
                }
            }
        });
    });
}

function lookup_retrieve(request, response) {
    check_http(request, response, function (option, body_Obj, request, response) {
        if (option == '0') {
            return option;
        }
        check_rt_query(request, response, function (rsc, results_comm, op, request, response) {
            if (rsc == '0') {
                return rsc;
            }

            if (op == 'fanoutpoint') {
                // check access right for fanoutpoint
                check_grp(request, response, results_comm.ri, function (rsc, result_grp) {
                    if (rsc == '0') {
                        return rsc;
                    }

                    security.check(request, response, results_comm.ty, result_grp.macp, '2', result_grp.cr, function (rsc, request, response) {
                        if (rsc == '0') {
                            body_Obj = {};
                            body_Obj['dbg'] = 'ACCESS_DENIED';
                            responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                            return '0';
                        }

                        fopt.check(request, response, result_grp, body_Obj);
                    });
                });
            }
            else { //if(op == 'direct') {
                if(results_comm.ty == 2 || results_comm.ty == 4 || results_comm.ty == 3 || results_comm.ty == 9 || results_comm.ty == 24 || results_comm.ty == 23 || results_comm.ty == 29) {
                    db_sql.select_resource(responder.typeRsrc[results_comm.ty], results_comm.ri, function (err, results_spec) {
                        if (!err) {
                            if(results_spec.length == 0) {
                                results_spec[0] = {};
                                results_spec[0].cr = '';
                                console.log('no creator');
                            }
                            else {
                                if(results_comm.ty == 2) {
                                    results_spec[0].cr = results_spec[0].aei;
                                }
                            }

                            security.check(request, response, results_comm.ty, results_comm.acpi, '2', results_spec[0].cr, function (rsc, request, response) {
                                if (rsc == '0') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'ACCESS_DENIED';
                                    responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                                    return '0';
                                }
                                resource.retrieve(request, response, results_comm);
                            });
                        }
                    });
                }
                else {
                    security.check(request, response, results_comm.ty, results_comm.acpi, '2', '', function (rsc, request, response) {
                        if (rsc == '0') {
                            body_Obj = {};
                            body_Obj['dbg'] = 'ACCESS_DENIED';
                            responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                            return '0';
                        }
                        resource.retrieve(request, response, results_comm);
                    });
                }
            }
        });
    });
}

function lookup_update(request, response) {
    check_http(request, response, function (option, body_Obj, request, response) {
        if (option == '0') {
            return option;
        }
        check_rt_query(request, response, function (rsc, results_comm, op, request, response) {
            if (rsc == '0') {
                return rsc;
            }

            if (op == 'fanoutpoint') {
                // check access right for fanoutpoint
                check_grp(request, response, results_comm.ri, function (rsc, result_grp) {
                    if (rsc == '0') {
                        return rsc;
                    }

                    security.check(request, response, results_comm.ty, result_grp.macp, '4', result_grp.cr, function (rsc, request, response) {
                        if (rsc == '0') {
                            body_Obj = {};
                            body_Obj['dbg'] = 'ACCESS_DENIED';
                            responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                            return '0';
                        }

                        fopt.check(request, response, result_grp, results_comm.ty, body_Obj);
                    });
                });
            }
            else { //if(op == 'direct') {
                if(results_comm.ty == 2 || results_comm.ty == 4 || results_comm.ty == 3 || results_comm.ty == 9 || results_comm.ty == 24 || results_comm.ty == 23 || results_comm.ty == 29) {
                    db_sql.select_resource(responder.typeRsrc[results_comm.ty], results_comm.ri, function (err, results_spec) {
                        if (!err) {
                            if(results_spec.length == 0) {
                                results_spec[0] = {};
                                results_spec[0].cr = '';
                                console.log('no creator');
                            }
                            else {
                                if(results_comm.ty == 2) {
                                    results_spec[0].cr = results_spec[0].aei;
                                }
                            }
                            security.check(request, response, results_comm.ty, results_comm.acpi, '4', results_spec[0].cr, function (rsc, request, response) {
                                if (rsc == '0') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'ACCESS_DENIED';
                                    responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                                    return '0';
                                }
                                resource.update(request, response, results_comm, body_Obj);
                            });
                        }
                    });
                }
                else {
                    security.check(request, response, results_comm.ty, results_comm.acpi, '4', '', function (rsc, request, response) {
                        if (rsc == '0') {
                            body_Obj = {};
                            body_Obj['dbg'] = 'ACCESS_DENIED';
                            responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                            return '0';
                        }
                        resource.update(request, response, results_comm, body_Obj);
                    });
                }
            }
        });
    });
}

function lookup_delete(request, response) {
    check_http(request, response, function (option, body_Obj, request, response) {
        if (option == '0') {
            return option;
        }
        check_rt_query(request, response, function (rsc, results_comm, op, request, response) {
            if (rsc == '0') {
                return rsc;
            }

            if (op == 'fanoutpoint') {
                // check access right for fanoutpoint
                check_grp(request, response, results_comm.ri, function (rsc, result_grp) {
                    if (rsc == '0') {
                        return rsc;
                    }

                    security.check(request, response, results_comm.ty, result_grp.macp, '8', result_grp.cr, function (rsc, request, response) {
                        if (rsc == '0') {
                            body_Obj = {};
                            body_Obj['dbg'] = 'ACCESS_DENIED';
                            responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                            return '0';
                        }

                        fopt.check(request, response, result_grp, results_comm.ty, body_Obj);
                    });
                });
            }
            else { //if(op == 'direct') {
                if(results_comm.ty == 2 || results_comm.ty == 4 || results_comm.ty == 3 || results_comm.ty == 9 || results_comm.ty == 24 || results_comm.ty == 23 || results_comm.ty == 29) {
                    db_sql.select_resource(responder.typeRsrc[results_comm.ty], results_comm.ri, function (err, results_spec) {
                        if (!err) {
                            if(results_spec.length == 0) {
                                results_spec[0] = {};
                                results_spec[0].cr = '';
                                console.log('no creator');
                            }
                            else {
                                if(results_comm.ty == 2) {
                                    results_spec[0].cr = results_spec[0].aei;
                                }
                            }
                            security.check(request, response, results_comm.ty, results_comm.acpi, '8', results_spec[0].cr, function (rsc, request, response) {
                                if (rsc == '0') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'ACCESS_DENIED';
                                    responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                                    return '0';
                                }
                                resource.delete(request, response, results_comm);
                            });
                        }
                    });
                }
                else {
                    security.check(request, response, results_comm.ty, results_comm.acpi, '8', '', function (rsc, request, response) {
                        if (rsc == '0') {
                            body_Obj = {};
                            body_Obj['dbg'] = 'ACCESS_DENIED';
                            responder.response_result(request, response, 403, body_Obj, 4103, request.url, 'ACCESS_DENIED');
                            return '0';
                        }
                        resource.delete(request, response, results_comm);
                    });
                }
            }
        });
    });
}


// global.elapsed_hrstart = {};
// global.elapsed_tid = '0';


var onem2mParser = bodyParser.text(
    {
        limit: '1mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);
//var onem2mParser = bodyParser.text({ limit: '1mb', type: '*/*' });

// remoteCSE, ae, cnt
app.post(onem2mParser, function (request, response) {
    // elapsed_tid = require('shortid').generate();
    // elapsed_hrstart[elapsed_tid] = process.hrtime();
    // console.time(elapsed_tid);

    var fullBody = '';
    request.on('data', function (chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function () {
        request.body = fullBody;
        if (request.query.fu == null) {
            request.query.fu = 2;
        }
        if (request.query.rcn == null) {
            request.query.rcn = 1;
        }
        if (request.query.rt == null) {
            request.query.rt = 3;
        }

        check_body_format(request);

        //request.url = request.url.replace(/\/$/, "");
        //var url_arr = url.parse(request.url).pathname.split('/');
        var absolute_url = request.url.replace(/\/~\/[^\/]+\/?/, '/').split('#')[0];
        absolute_url = absolute_url.replace(/\/_/, '/' + usecsebase);
        var absolute_url_arr = absolute_url.split('/');
        db_sql.get_ri_sri(request, response, absolute_url_arr[1].split('?')[0], function (err, results, request, response) {
            if (err) {
                responder.error_result(request, response, 500, 5000, 'database error (can not get resourceID from database)');
            }
            else {
                absolute_url = (results.length == 0) ? absolute_url : ((results[0].hasOwnProperty('ri')) ? absolute_url.replace('/' + absolute_url_arr[1], results[0].ri) : absolute_url);

                if (url.parse(absolute_url).pathname.split('/')[1] == usecsebase) {
                    request.url = absolute_url;
                    if ((request.query.fu == 2) &&
                        (request.query.rcn == 0 || request.query.rcn == 1 || request.query.rcn == 2 || request.query.rcn == 3)) {
                        lookup_create(request, response);
                    }
                    else {
                        responder.error_result(request, response, 400, 4000, 'rcn or fu query is not supported at POST request');
                    }
                }
                else {
                    check_csr(absolute_url, function (rsc, body_Obj) {
                        if (rsc == '0') {
                            responder.error_result(request, response, 500, 5000, body_Obj['dbg']);
                        }
                        else if (rsc == '1') {
                            forward_http(body_Obj.forwardcbhost, body_Obj.forwardcbport, request, response);
                        }
                        else if (rsc == '2') {
                            responder.error_result(request, response, 500, 5000, 'forwarding with mqtt is not supported');
                        }
                        else {
                            responder.error_result(request, response, 500, 5000, body_Obj['dbg']);
                        }
                    });
                }
            }
        });
    });
});

app.get(onem2mParser, function (request, response) {
    // elapsed_tid = require('shortid').generate();
    // elapsed_hrstart[elapsed_tid] = process.hrtime();
    // console.time(elapsed_tid);

    var fullBody = '';
    request.on('data', function (chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function () {
        request.body = fullBody;
        if (request.query.fu == null) {
            request.query.fu = 2;
        }
        if (request.query.rcn == null) {
            request.query.rcn = 1;
        }
        if (request.query.rt == null) {
            request.query.rt = 3;
        }

        check_body_format(request);

        request.url = request.url.replace('%23', '#'); // convert '%23' to '#' of url
        request.hash = url.parse(request.url).hash;
        var absolute_url = request.url.replace(/\/~\/[^\/]+\/?/, '/').split('#')[0];
        absolute_url = absolute_url.replace(/\/_/, '/' + usecsebase);
        var absolute_url_arr = absolute_url.split('/');
        db_sql.get_ri_sri(request, response, absolute_url_arr[1].split('?')[0], function (err, results, request, response) {
            if (err) {
                responder.error_result(request, response, 500, 5000, 'database error (can not get resourceID from database)');
            }
            else {
                absolute_url = (results.length == 0) ? absolute_url : ((results[0].hasOwnProperty('ri')) ? absolute_url.replace('/' + absolute_url_arr[1], results[0].ri) : absolute_url);

                if (url.parse(absolute_url).pathname.split('/')[1] == usecsebase) {
                    request.url = absolute_url;
                    if ((request.query.fu == 1 || request.query.fu == 2) &&
                        (request.query.rcn == 1 || request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6 || request.query.rcn == 7)) {
                        lookup_retrieve(request, response);
                    }
                    else {
                        responder.error_result(request, response, 400, 4000, 'BAD_REQUEST (rcn or fu query is not supported in GET request)');
                    }
                }
                else {
                    check_csr(absolute_url, function (rsc, body_Obj) {
                        if (rsc == '0') {
                            responder.error_result(request, response, 500, 5000, body_Obj['dbg']);
                        }
                        else if (rsc == '1') {
                            forward_http(body_Obj.forwardcbhost, body_Obj.forwardcbport, request, response);
                        }
                        else if (rsc == '2') {
                            responder.error_result(request, response, 500, 5000, 'forwarding with mqtt is not supported');
                        }
                        else {
                            responder.error_result(request, response, 500, 5000, body_Obj['dbg']);
                        }
                    });
                }
            }
        });
    });
});


app.put(onem2mParser, function (request, response) {
    // elapsed_tid = require('shortid').generate();
    // elapsed_hrstart[elapsed_tid] = process.hrtime();
    // console.time(elapsed_tid);

    var fullBody = '';
    request.on('data', function (chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function () {
        request.body = fullBody;
        if (request.query.fu == null) {
            request.query.fu = 2;
        }
        if (request.query.rcn == null) {
            request.query.rcn = 1;
        }
        if (request.query.rt == null) {
            request.query.rt = 3;
        }

        check_body_format(request);

        //request.url = request.url.replace(/\/$/, "");
        //var url_arr = url.parse(request.url).pathname.split('/');
        var absolute_url = request.url.replace(/\/~\/[^\/]+\/?/, '/').split('#')[0];
        absolute_url = absolute_url.replace(/\/_/, '/' + usecsebase);
        var absolute_url_arr = absolute_url.split('/');
        db_sql.get_ri_sri(request, response, absolute_url_arr[1].split('?')[0], function (err, results, request, response) {
            if (err) {
                responder.error_result(request, response, 500, 5000, 'database error (can not get resourceID from database)');
            }
            else {
                absolute_url = (results.length == 0) ? absolute_url : ((results[0].hasOwnProperty('ri')) ? absolute_url.replace('/' + absolute_url_arr[1], results[0].ri) : absolute_url);

                if (url.parse(absolute_url).pathname == ('/' + usecsebase)) {
                    responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED');
                }
                else if (url.parse(absolute_url).pathname.split('/')[1] == usecsebase) {
                    request.url = absolute_url;
                    if ((request.query.fu == 2) &&
                        (request.query.rcn == 0 || request.query.rcn == 1)) {
                        lookup_update(request, response);
                    }
                    else {
                        responder.error_result(request, response, 400, 4000, 'rcn query is not supported at PUT request');
                    }
                }
                else {
                    check_csr(absolute_url, function (rsc, body_Obj) {
                        if (rsc == '0') {
                            responder.error_result(request, response, 500, 5000, body_Obj['dbg']);
                        }
                        else if (rsc == '1') {
                            forward_http(body_Obj.forwardcbhost, body_Obj.forwardcbport, request, response);
                        }
                        else if (rsc == '2') {
                            responder.error_result(request, response, 500, 5000, 'forwarding with mqtt is not supported');
                        }
                        else {
                            responder.error_result(request, response, 500, 5000, body_Obj['dbg']);
                        }
                    });
                }
            }
        });
    });
});

app.delete(onem2mParser, function (request, response) {
    // elapsed_tid = require('shortid').generate();
    // elapsed_hrstart[elapsed_tid] = process.hrtime();
    // console.time(elapsed_tid);

    var fullBody = '';
    request.on('data', function (chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function () {
        request.body = fullBody;
        if (request.query.fu == null) {
            request.query.fu = 2;
        }
        if (request.query.rcn == null) {
            request.query.rcn = 1;
        }
        if (request.query.rt == null) {
            request.query.rt = 3;
        }

        check_body_format(request);

        //request.url = request.url.replace(/\/$/, "");
        //var url_arr = url.parse(request.url).pathname.split('/');
        var absolute_url = request.url.replace(/\/~\/[^\/]+\/?/, '/').split('#')[0];
        absolute_url = absolute_url.replace(/\/_/, '/' + usecsebase);
        var absolute_url_arr = absolute_url.split('/');
        db_sql.get_ri_sri(request, response, absolute_url_arr[1].split('?')[0], function (err, results, request, response) {
            if (err) {
                responder.error_result(request, response, 500, 5000, 'database error (can not get resourceID from database)');
            }
            else {
                absolute_url = (results.length == 0) ? absolute_url : ((results[0].hasOwnProperty('ri')) ? absolute_url.replace('/' + absolute_url_arr[1], results[0].ri) : absolute_url);

                if (url.parse(absolute_url).pathname == ('/' + usecsebase)) {
                    responder.error_result(request, response, 405, 4005, 'OPERATION_NOT_ALLOWED');
                }
                else if (url.parse(absolute_url).pathname.split('/')[1] == usecsebase) {
                    request.url = absolute_url;
                    if ((request.query.fu == 2) &&
                        (request.query.rcn == 0 || request.query.rcn == 1)) {
                        lookup_delete(request, response);
                    }
                    else {
                        responder.error_result(request, response, 400, 4000, 'rcn query is not supported in DELETE request');
                    }
                }
                else {
                    check_csr(absolute_url, function (rsc, body_Obj) {
                        if (rsc == '0') {
                            responder.error_result(request, response, 500, 5000, body_Obj['dbg']);
                        }
                        else if (rsc == '1') {
                            forward_http(body_Obj.forwardcbhost, body_Obj.forwardcbport, request, response);
                        }
                        else if (rsc == '2') {
                            responder.error_result(request, response, 500, 5000, 'forwarding with mqtt is not supported');
                        }
                        else {
                            responder.error_result(request, response, 500, 5000, body_Obj['dbg']);
                        }
                    });
                }
            }
        });
    });
});

function check_csr(absolute_url, callback) {
    var ri = util.format('/%s/%s', usecsebase, url.parse(absolute_url).pathname.split('/')[1]);
    console.log('[check_csr] : ' + ri);
    db_sql.select_csr(ri, function (err, result_csr) {
        if (!err) {
            if (result_csr.length == 1) {
                var body_Obj = {};
                body_Obj.forwardcbname = result_csr[0].cb.replace('/', '');
                var poa_arr = JSON.parse(result_csr[0].poa);
                for (var i = 0; i < poa_arr.length; i++) {
                    if (url.parse(poa_arr[i]).protocol == 'http:') {
                        body_Obj.forwardcbhost = url.parse(poa_arr[i]).hostname;
                        body_Obj.forwardcbport = url.parse(poa_arr[i]).port;

                        console.log('csebase forwarding to ' + body_Obj.forwardcbname);

                        callback('1', body_Obj);
                    }
                    else if (url.parse(poa_arr[i]).protocol == 'mqtt:') {
                        body_Obj.forwardcbmqtt = url.parse(poa_arr[i]).hostname;

                        callback('2', body_Obj);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = 'poa of csr is not supported';
                        callback('0', body_Obj);
                        break;
                    }
                }
            }
            else {
                result_csr = {};
                result_csr['dbg'] = 'csebase is not found';
                callback('3', result_csr);
            }
        }
        else {
            console.log('[check_csr] query error: ' + result_csr.message);
        }
    });
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
                response.setHeader('Content-Type', res.headers['content-type']);
            }
            if (res.headers['x-m2m-ri']) {
                response.setHeader('X-M2M-RI', res.headers['x-m2m-ri']);
            }
            if (res.headers['x-m2m-rsc']) {
                response.setHeader('X-M2M-RSC', res.headers['x-m2m-rsc']);
            }
            if (res.headers['content-location']) {
                response.setHeader('Content-Location', res.headers['content-location']);
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
    //console.log("Production Mode");
} else if (process.env.NODE_ENV == 'development') {
    //console.log("Development Mode");
}