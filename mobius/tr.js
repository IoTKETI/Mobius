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

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var responder = require('./responder');
var http = require('http');
var https = require('https');
var fs = require('fs');

var db_sql = require('./sql_action');

global.tctl_v = {};
tctl_v.INITIAL = '1';
tctl_v.LOCK = '2';
tctl_v.EXECUTE = '3';
tctl_v.COMMIT = '4';
tctl_v.ABORT = '5';

global.tst_v = {};
tst_v.INITIAL = '1';
tst_v.LOCKED = '2';
tst_v.EXECUTED = '3';
tst_v.COMMITTED = '4';
tst_v.ERROR = '5';
tst_v.ABORTED = '6';

exports.build_tr = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

    resource_Obj[rootnm].tid = body_Obj[rootnm].tid;
    resource_Obj[rootnm].trqp = body_Obj[rootnm].trqp;

    resource_Obj[rootnm].tctl = (body_Obj[rootnm].tctl) ? body_Obj[rootnm].tctl : tctl_v.LOCK; // LOCK
    resource_Obj[rootnm].tst = (body_Obj[rootnm].tst) ? body_Obj[rootnm].tst : tst_v.LOCKED;

    resource_Obj[rootnm].tltm = (body_Obj[rootnm].tltm) ? body_Obj[rootnm].tltm : '';
    resource_Obj[rootnm].text = (body_Obj[rootnm].text) ? body_Obj[rootnm].text : '';
    resource_Obj[rootnm].tct = (body_Obj[rootnm].tct) ? body_Obj[rootnm].tct : '';
    resource_Obj[rootnm].tltp = (body_Obj[rootnm].tltp) ? body_Obj[rootnm].tltp : tltp_v.BLOCK_ALL; // BLOCK_ALL
    resource_Obj[rootnm].trqp = (body_Obj[rootnm].trqp) ? body_Obj[rootnm].trqp : '';
    resource_Obj[rootnm].trsp = (body_Obj[rootnm].trsp) ? body_Obj[rootnm].trsp : '';

    callback('1', resource_Obj);
};

function execute_action(ri, bodytype, res, resBody, callback) {
    console.log('EXECUTE of transaction'); //callback(res.headers['x-m2m-rsc'], resBody);
    console.log(resBody);

    if (res.headers['x-m2m-rsc'] == 2001 || res.headers['x-m2m-rsc'] == 2000 || res.headers['x-m2m-rsc'] == 2004 || res.headers['x-m2m-rsc'] == 2002) {
        var tst_value = tst_v.EXECUTED;
    }
    else {
        tst_value = tst_v.ABORTED;
    }

    callback('1', tst_value);
}

exports.request_execute = function(obj, callback) {
    var rqi = require('shortid').generate();
    var content_type = 'application/json';
    var bodytype = 'json';

    switch (obj.tr.trqp.op.toString()) {
        case '1':
            var op = 'post';
            content_type += (obj.tr.trqp.ty)?('; ty=' + obj.tr.trqp.ty):'';
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
    if( op === 'post' || op === 'put') {
        if (bodytype === 'xml') {
            obj.tr.trqp.pc[Object.keys(obj.tr.trqp.pc)[0]]['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            for (var prop in obj.tr.trqp.pc) {
                if (obj.tr.trqp.pc.hasOwnProperty(prop)) {
                    for (var prop2 in obj.tr.trqp.pc[prop]) {
                        if (obj.tr.trqp.pc[prop].hasOwnProperty(prop2)) {
                            if (prop2 == 'rn') {
                                obj.tr.trqp.pc[prop]['@'] = {rn: obj.tr.trqp.pc[prop][prop2]};
                                delete obj.tr.trqp.pc[prop][prop2];
                                break;
                            }
                        }
                    }
                }
            }

            try {
                reqBodyString = js2xmlparser.parse(Object.keys(obj.tr.trqp.pc)[0], obj.tr.trqp.pc[Object.keys(obj.tr.trqp.pc)[0]]);
            }
            catch (e) {
                reqBodyString = "";
            }
        }
        else { // json
            reqBodyString = JSON.stringify(obj.tr.trqp.pc);
        }
    }

    var resBody = '';

    if (obj.tr.trqp.to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
        obj.tr.trqp.to = obj.tr.trqp.to.replace(usespid + usecseid + '/', '/');
    }
    else if (obj.tr.trqp.to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
        obj.tr.trqp.to = obj.tr.trqp.to.replace(usecseid + '/', '/');
    }
    else if (obj.tr.trqp.to.split(usecsebase)[0] == '') { // cse relative
        obj.tr.trqp.to = '/' + obj.tr.trqp.to;
    }

    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: obj.tr.trqp.to + '?tctl=3&tid=' + obj.tr.tid,
        method: op,
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': obj.tr.trqp.fr,
            'Content-Type': content_type
        }
    };

    if (usesecure == 'disable') {
        var req = http.request(options, function (res) {
            res.on('data', function (chunk) {
                resBody += chunk;
            });

            res.on('end', function () {
                execute_action(obj.tr.ri, bodytype, res, resBody, function(rsc, tst) {
                    obj.tr.tst = tst;
                    callback(rsc, obj);
                });
            });
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');

        req = https.request(options, function (res) {
            res.on('data', function (chunk) {
                resBody += chunk;
            });

            res.on('end', function () {
                execute_action(obj.tr.ri, bodytype, res, resBody, function(rsc, tst) {
                    obj.tr.tst = tst;
                    callback(rsc, obj);
                });
            });
        });
    }

    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[delete_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
};

function trsp_action(ri, bodytype, res, resBody, callback) {
    console.log('COMMIT of transaction'); //callback(res.headers['x-m2m-rsc'], resBody);
    console.log(resBody);

    if (res.headers['x-m2m-rsc'] == 2001 || res.headers['x-m2m-rsc'] == 2000 || res.headers['x-m2m-rsc'] == 2004 || res.headers['x-m2m-rsc'] == 2002) {
        var tst_value = tst_v.COMMITTED;
    }
    else {
        tst_value = tst_v.ABORTED;
    }

    if (bodytype === 'xml') {
        try {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(resBody, function (err, body_Obj) {
                var trsp_primitive = {};
                trsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                trsp_primitive.rqi = res.headers['x-m2m-ri'];
                trsp_primitive.pc = JSON.parse(body_Obj.toString());

                callback('1', tst_value, trsp_primitive);
            });
        }
        catch (e) {
            trsp_primitive = {};
            trsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
            trsp_primitive.rqi = res.headers['x-m2m-ri'];
            trsp_primitive.pc = JSON.parse(resBody.toString());
            callback('1', tst_value, trsp_primitive);
        }
    }
    else if (bodytype === 'cbor') {
    }
    else {
        try {
            var trsp_primitive = {};
            trsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
            trsp_primitive.rqi = res.headers['x-m2m-ri'];
            trsp_primitive.pc = JSON.parse(resBody.toString());

            callback('1', tst_value, trsp_primitive);
        }
        catch (e) {
            trsp_primitive = {};
            trsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
            trsp_primitive.rqi = res.headers['x-m2m-ri'];
            trsp_primitive.pc = JSON.parse(resBody.toString());
            callback('1', tst_value, trsp_primitive);
        }
    }
}

exports.request_commit = function(obj, callback) {
    var rqi = require('shortid').generate();
    obj.tr.trqp.rqi = rqi;

    var content_type = 'application/json';
    var bodytype = 'json';

    switch (obj.tr.trqp.op.toString()) {
        case '1':
            var op = 'post';
            content_type += (obj.tr.trqp.ty)?('; ty=' + obj.tr.trqp.ty):'';
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
    if( op === 'post' || op === 'put') {
        if (bodytype === 'xml') {
            obj.tr.trqp.pc[Object.keys(obj.tr.trqp.pc)[0]]['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            for (var prop in obj.tr.trqp.pc) {
                if (obj.tr.trqp.pc.hasOwnProperty(prop)) {
                    for (var prop2 in obj.tr.trqp.pc[prop]) {
                        if (obj.tr.trqp.pc[prop].hasOwnProperty(prop2)) {
                            if (prop2 == 'rn') {
                                obj.tr.trqp.pc[prop]['@'] = {rn: obj.tr.trqp.pc[prop][prop2]};
                                delete obj.tr.trqp.pc[prop][prop2];
                                break;
                            }
                        }
                    }
                }
            }

            try {
                reqBodyString = js2xmlparser.parse(Object.keys(obj.tr.trqp.pc)[0], obj.tr.trqp.pc[Object.keys(obj.tr.trqp.pc)[0]]);
            }
            catch (e) {
                reqBodyString = "";
            }
        }
        else { // json
            reqBodyString = JSON.stringify(obj.tr.trqp.pc);
        }
    }

    var resBody = '';

    if (obj.tr.trqp.to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
        obj.tr.trqp.to = obj.tr.trqp.to.replace(usespid + usecseid + '/', '/');
    }
    else if (obj.tr.trqp.to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
        obj.tr.trqp.to = obj.tr.trqp.to.replace(usecseid + '/', '/');
    }
    else if (obj.tr.trqp.to.split(usecsebase)[0] == '') { // cse relative
        obj.tr.trqp.to = '/' + obj.tr.trqp.to;
    }

    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: obj.tr.trqp.to + '?tid=' + obj.tr.tid,
        method: op,
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': obj.tr.trqp.fr,
            'Content-Type': content_type
        }
    };

    if (usesecure == 'disable') {
        var req = http.request(options, function (res) {
            res.on('data', function (chunk) {
                resBody += chunk;
            });

            res.on('end', function () {
                trsp_action(obj.tr.ri, bodytype, res, resBody, function(rsc, tst, trsp) {
                    obj.tr.tst = tst;
                    obj.tr.trsp = trsp;
                    callback(rsc, obj);
                });
            });
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');

        req = https.request(options, function (res) {
            res.on('data', function (chunk) {
                resBody += chunk;
            });

            res.on('end', function () {
                trsp_action(obj.tr.ri, bodytype, res, resBody, function(rsc, tst, trsp) {
                    obj.tr.tst = tst;
                    obj.tr.trsp = trsp;
                    callback(rsc, obj);
                });
            });
        });
    }

    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[delete_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
};

exports.check = function(request, pi, body_Obj, callback) {
    var state = tst_v.COMMITTED;

    db_sql.select_tr(pi, function (err, results_tr) {
        if (!err) {
            for (var i = 0; i < results_tr.length; i++) {
                if(request.query.tid == results_tr[i].tid) {
                    callback('1', body_Obj);
                    return '0';
                }

                if (results_tr[i].hasOwnProperty('tltp')) {
                    if(results_tr[i].tltp == tltp_v.BLOCK_ALL) {
                        if (results_tr[i].hasOwnProperty('tst')) {
                            if (results_tr[i].tst !== tst_v.COMMITTED && results_tr[i].tst !== tst_v.ABORTED) {
                                state = results_tr[i].tst;
                                break;
                            }
                        }
                    }
                    else if(results_tr[i].tltp == tltp_v.ALLOW_RETRIEVES) {
                        if(request.method === 'GET') {
                            state = tst_v.COMMITTED;
                            break;
                        }
                        else {
                            if (results_tr[i].hasOwnProperty('tst')) {
                                if (results_tr[i].tst !== tst_v.COMMITTED && results_tr[i].tst !== tst_v.ABORTED) {
                                    state = results_tr[i].tst;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if (state === tst_v.COMMITTED || state === tst_v.ABORTED) {
                callback('1', body_Obj);
            }
            else {
                callback('0', body_Obj);
            }
        }
        else {
            console.log('query error: ' + results_tr.message);
            callback('1', body_Obj);
        }
    });

};
