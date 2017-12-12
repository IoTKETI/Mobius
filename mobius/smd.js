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

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var responder = require('./responder');
var http = require('http');
var https = require('https');
var fs = require('fs');


exports.build_smd = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // check NP
    if(body_Obj[rootnm].ty) {
        body_Obj = {};
        body_Obj['dbg'] = 'ty as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ri) {
        body_Obj = {};
        body_Obj['dbg'] = 'ri as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].pi) {
        body_Obj = {};
        body_Obj['dbg'] = 'pi as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ct) {
        body_Obj = {};
        body_Obj['dbg'] = 'ct as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].lt) {
        body_Obj = {};
        body_Obj['dbg'] = 'lt as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].st) {
        body_Obj = {};
        body_Obj['dbg'] = 'st as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    // check M
    if(!body_Obj[rootnm].dsp) {
        body_Obj = {};
        body_Obj['dbg'] = 'dsp as M Tag should be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(!body_Obj[rootnm].dcrp) {
        body_Obj = {};
        body_Obj['dbg'] = 'dcrp as M Tag should be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    // body
    resource_Obj[rootnm].dsp = body_Obj[rootnm].dsp;
    resource_Obj[rootnm].dcrp = body_Obj[rootnm].dcrp;

    resource_Obj[rootnm].acpi = (body_Obj[rootnm].acpi) ? body_Obj[rootnm].acpi : [];
    resource_Obj[rootnm].et = (body_Obj[rootnm].et) ? body_Obj[rootnm].et : resource_Obj[rootnm].et;
    resource_Obj[rootnm].lbl = (body_Obj[rootnm].lbl) ? body_Obj[rootnm].lbl : [];
    resource_Obj[rootnm].at = (body_Obj[rootnm].at) ? body_Obj[rootnm].at : [];
    resource_Obj[rootnm].aa = (body_Obj[rootnm].aa) ? body_Obj[rootnm].aa : [];

    resource_Obj[rootnm].or = (body_Obj[rootnm].or) ? body_Obj[rootnm].or : '';
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];
    resource_Obj[rootnm].soe = (body_Obj[rootnm].soe) ? body_Obj[rootnm].soe : '';
    resource_Obj[rootnm].rels = (body_Obj[rootnm].rels) ? body_Obj[rootnm].rels : [];

    if (resource_Obj[rootnm].et != '') {
        if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            body_Obj = {};
            body_Obj['dbg'] = 'expiration time is before now';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }

    callback('1', resource_Obj);
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

