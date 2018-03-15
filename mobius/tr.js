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

var tst_v = {};
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

    resource_Obj[rootnm].tctl = (body_Obj[rootnm].tctl) ? body_Obj[rootnm].tctl : '2'; // LOCK
    resource_Obj[rootnm].tst = (body_Obj[rootnm].tst) ? body_Obj[rootnm].tst : tst_v.LOCKED;

    resource_Obj[rootnm].tltm = (body_Obj[rootnm].tltm) ? body_Obj[rootnm].tltm : '';
    resource_Obj[rootnm].text = (body_Obj[rootnm].text) ? body_Obj[rootnm].text : '';
    resource_Obj[rootnm].tct = (body_Obj[rootnm].tct) ? body_Obj[rootnm].tct : '';
    resource_Obj[rootnm].tltp = (body_Obj[rootnm].tltp) ? body_Obj[rootnm].tltp : '1'; // BLOCK_ALL
    resource_Obj[rootnm].trqp = (body_Obj[rootnm].trqp) ? body_Obj[rootnm].trqp : '';
    resource_Obj[rootnm].trsp = (body_Obj[rootnm].trsp) ? body_Obj[rootnm].trsp : '';

    callback('1', resource_Obj);
};

function trsp_action(ri, tst_value, bodytype, res, resBody) {
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
            console.log('store_trsp fail')
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
                console.log('EXECUTE of transaction'); //callback(res.headers['x-m2m-rsc'], resBody);
                console.log(resBody);

                if (res.statusCode == 201 || res.statusCode == 200) {
                    var tst_value = tst_v.EXECUTED;
                }
                else {
                    tst_value = tst_v.ERROR;
                }

                trsp_action(ri, tst_value, bodytype, res, resBody)
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
                //callback(res.headers['x-m2m-rsc'], resBody);
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

exports.request_post = function(uri, bodyString) {
    var options = {
        hostname: usesemanticbroker,
        port: 7591,
        path: '',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    var bodyStr = '';

    var req = http.request(options, function (res) {
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            console.log('----> [smd.request_post()] response for smd  ' + res.statusCode);
        });
    });

    req.on('error', function (e) {
        console.log('[smd.request_post()] problem with request: ' + e.message);
    });

    req.on('close', function() {
        console.log('[smd.request_post()] close()');
    });

    console.log('<---- [smd.request_post()] request for smd');
    req.write(bodyString);
    req.end();
};


exports.request_get_discovery = function(request, response, smf, callback) {
    var options = {
        hostname: usesemanticbroker,
        port: 7591,
        path: '',
        method: 'GET',
        headers: {
            'smf': encodeURI(smf)
        }
    };

    var bodyStr = '';

    var req = http.request(options, function (res) {
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            console.log('----> [smd.request_post()] response for smd  ' + res.statusCode);
            callback(response, res.statusCode, bodyStr);
        });
    });

    req.on('error', function (e) {
        console.log('[smd.request_post()] problem with request: ' + e.message);
    });

    req.on('close', function() {
        console.log('[smd.request_post()] close()');
    });

    console.log('<---- [smd.request_post()] request for smd');
    req.write('');
    req.end();
};

// exports.modify_sd = function(request, response, resource_Obj, body_Obj, callback) {
//     var rootnm = request.headers.rootnm;
//
//     // check M
//     for (var attr in update_m_attr_list[rootnm]) {
//         if (update_m_attr_list[rootnm].hasOwnProperty(attr)) {
//             if (body_Obj[rootnm].includes(attr)) {
//             }
//             else {
//                 body_Obj = {};
//                 body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Mandatory\' attribute';
//                 responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//                 callback('0', resource_Obj);
//                 return '0';
//             }
//         }
//     }
//
//     // check NP and body
//     for (attr in body_Obj[rootnm]) {
//         if (body_Obj[rootnm].hasOwnProperty(attr)) {
//             if (update_np_attr_list[rootnm].includes(attr)) {
//                 body_Obj = {};
//                 body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Not Present\' attribute';
//                 responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//                 callback('0', resource_Obj);
//                 return '0';
//             }
//             else {
//                 if (update_opt_attr_list[rootnm].includes(attr)) {
//                 }
//                 else {
//                     body_Obj = {};
//                     body_Obj['dbg'] = 'NOT FOUND: ' + attr + ' attribute is not defined';
//                     responder.response_result(request, response, 404, body_Obj, 4004, request.url, body_Obj['dbg']);
//                     callback('0', resource_Obj);
//                     return '0';
//                 }
//             }
//         }
//     }
//
//     update_body(rootnm, body_Obj, resource_Obj); // (attr == 'aa' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' || attr == 'nu' || attr == 'mid' || attr == 'macp')
//
//     resource_Obj[rootnm].st = (parseInt(resource_Obj[rootnm].st, 10) + 1).toString();
//
//     var cur_d = new Date();
//     resource_Obj[rootnm].lt = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
//
//     if (resource_Obj[rootnm].et != '') {
//         if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
//             body_Obj = {};
//             body_Obj['dbg'] = 'expiration time is before now';
//             responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//             callback('0', resource_Obj);
//             return '0';
//         }
//     }
//
//     callback('1', resource_Obj);
// };

