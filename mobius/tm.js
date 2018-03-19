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

var tmd_v = {};
tmd_v.CSE_CONTROLLED = '1';
tmd_v.CREATOR_CONTROLLED = '2';

global.tltp_v = {};
tltp_v.BLOCK_ALL = '1';
tltp_v.ALLOW_RETRIEVES = '2';

var tmh_v = {};
tmh_v.DELETE = '1';
tmh_v.PERSIST = '2';

exports.build_tm = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

    resource_Obj[rootnm].rqps = body_Obj[rootnm].rqps;

    resource_Obj[rootnm].tctl = (body_Obj[rootnm].tctl) ? body_Obj[rootnm].tctl : tctl_v.INITIAL; // INITIAL
    resource_Obj[rootnm].tst = (body_Obj[rootnm].tst) ? body_Obj[rootnm].tst : '';

    resource_Obj[rootnm].tltm = (body_Obj[rootnm].tltm) ? body_Obj[rootnm].tltm : '';
    resource_Obj[rootnm].text = (body_Obj[rootnm].text) ? body_Obj[rootnm].text : '';
    resource_Obj[rootnm].tct = (body_Obj[rootnm].tct) ? body_Obj[rootnm].tct : '';
    resource_Obj[rootnm].tept = (body_Obj[rootnm].tept) ? body_Obj[rootnm].tept : '';
    resource_Obj[rootnm].tmd = (body_Obj[rootnm].tmd) ? body_Obj[rootnm].tmd : tmd_v.CSE_CONTROLLED;
    resource_Obj[rootnm].tltp = (body_Obj[rootnm].tltp) ? body_Obj[rootnm].tltp : tltp_v.BLOCK_ALL; // BLOCK_ALL
    resource_Obj[rootnm].tmr = (body_Obj[rootnm].tmr) ? body_Obj[rootnm].tmr : '0';
    resource_Obj[rootnm].tmh = (body_Obj[rootnm].tmh) ? body_Obj[rootnm].tmh : tmh_v.DELETE;

    resource_Obj[rootnm].rsps = (body_Obj[rootnm].rsps) ? body_Obj[rootnm].rsps : '[]';

    callback('1', resource_Obj);
};

function trsp_action(ri, bodytype, res, resBody) {
    console.log('EXECUTE of transaction'); //callback(res.headers['x-m2m-rsc'], resBody);
    console.log(resBody);

    if (res.statusCode == 201 || res.statusCode == 200) {
        var tst_value = tst_v.EXECUTED;
    }
    else {
        tst_value = tst_v.ERROR;
    }

    if (bodytype === 'xml') {
        try {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(resBody, function (err, body_Obj) {
                store_trsp(ri, tst_value, res, body_Obj);
            });
        }
        catch (e) {
            store_trsp(ri, tst_v.ERROR, res, e.message);
        }
    }
    else if (bodytype === 'cbor') {
    }
    else {
        try {
            var body_Obj = JSON.parse(resBody.toString());
            store_trsp(ri, tst_value, res, body_Obj);
        }
        catch (e) {
            store_trsp(ri, tst_v.ERROR, res, e.message);
        }
    }
}

function store_trsp(ri, tst_value, res, bodyObj) {
    var trsp_primitive = {};
    trsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
    trsp_primitive.rqi = res.headers['x-m2m-ri'];
    trsp_primitive.pc = bodyObj;

    db_sql.update_tr_trsp(ri, tst_value, JSON.stringify(trsp_primitive), function (err) {
        if(!err) {
            console.log('store_trsp success');
        }
        else {
            console.log('store_trsp fail');
        }
    });
}

exports.request_execute = function(ri, frqp) {
    var rqi = require('shortid').generate();
    var content_type = 'application/json';
    var bodytype = 'json';

    switch (frqp.op.toString()) {
        case '1':
            var op = 'post';
            content_type += (frqp.ty)?('; ty=' + frqp.ty):'';
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
            frqp.pc[Object.keys(frqp.pc)[0]]['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            for (var prop in frqp.pc) {
                if (frqp.pc.hasOwnProperty(prop)) {
                    for (var prop2 in frqp.pc[prop]) {
                        if (frqp.pc[prop].hasOwnProperty(prop2)) {
                            if (prop2 == 'rn') {
                                frqp.pc[prop]['@'] = {rn: frqp.pc[prop][prop2]};
                                delete frqp.pc[prop][prop2];
                                break;
                            }
                        }
                    }
                }
            }

            try {
                reqBodyString = js2xmlparser.parse(Object.keys(frqp.pc)[0], frqp.pc[Object.keys(frqp.pc)[0]]);
            }
            catch (e) {
                reqBodyString = "";
            }
        }
        else { // json
            reqBodyString = JSON.stringify(frqp.pc);
        }
    }

    var resBody = '';

    if (frqp.to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
        frqp.to = frqp.to.replace(usespid + usecseid + '/', '/');
    }
    else if (frqp.to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
        frqp.to = frqp.to.replace(usecseid + '/', '/');
    }
    else if (frqp.to.split(usecsebase)[0] == '') { // cse relative
        frqp.to = '/' + frqp.to;
    }

    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: frqp.to,
        method: op,
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': frqp.fr,
            'Content-Type': content_type
        }
    };

    if (usesecure == 'disable') {
        var req = http.request(options, function (res) {
            res.on('data', function (chunk) {
                resBody += chunk;
            });

            res.on('end', function () {
                trsp_action(ri, bodytype, res, resBody);
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
                trsp_action(ri, bodytype, res, resBody);
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

exports.request_commit = function(ri, tst) {
    if(tst === tst_v.EXECUTED) {
        tst = tst_v.COMMITTED;
    }

    db_sql.update_tr_tst(ri, tst, function (err) {
        if(!err) {
            console.log('store_tst [' + tst + '] success');
        }
        else {
            console.log('store_tst [' + tst + '] fail');
        }
    });
};

exports.request_abort = function(ri, tst) {
    if(tst === tst_v.ERROR) {
        tst = tst_v.ABORTED;
    }

    db_sql.update_tr_tst(ri, tst, function (err) {
        if(!err) {
            console.log('store_tst [' + tst + '] success');
        }
        else {
            console.log('store_tst [' + tst + '] fail');
        }
    });
};

exports.check = function(request, pi, body_Obj, callback) {
    var state = tst_v.COMMITTED;

    db_sql.select_tr(pi, function (err, results_tr) {
        if (!err) {
            for (var i = 0; i < results_tr.length; i++) {
                if (results_tr[i].hasOwnProperty('tst')) {
                    if(results_tr[i].tst !== tst_v.COMMITTED && results_tr[i].tst !== tst_v.ABORTED) {
                        state = results_tr[i].tst;
                        break;
                    }
                }
            }

            if(state === tst_v.COMMITTED || state === tst_v.ABORTED) {
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
