/**
 * Copyright (c) 2024, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2024, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var util = require('util');
var responder = require('./responder');


exports.build_cnt = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].disr = (body_Obj[rootnm].disr) ? body_Obj[rootnm].disr : '';
    resource_Obj[rootnm].mni = (body_Obj[rootnm].mni) ? body_Obj[rootnm].mni : '3153600000';
    if(parseInt(resource_Obj[rootnm].mni) >= 3153600000) {
        resource_Obj[rootnm].mni = '3153600000';
    }

    resource_Obj[rootnm].mbs = (body_Obj[rootnm].mbs) ? body_Obj[rootnm].mbs : '3153600000';
    resource_Obj[rootnm].mia = (body_Obj[rootnm].mia) ? body_Obj[rootnm].mia : '31536000';

    if(body_Obj[rootnm].hasOwnProperty('loc')) {
        if(!body_Obj[rootnm].loc.hasOwnProperty('typ')) {
            callback('400-61');
            return;
        }
        if(!body_Obj[rootnm].loc.hasOwnProperty('crd')) {
            callback('400-62');
            return;
        }
        else {
            if (!Array.isArray(body_Obj[rootnm].loc.crd)) {
                callback('400-63');
                return;
            }
        }

        resource_Obj[rootnm].loc = JSON.parse(JSON.stringify(body_Obj[rootnm].loc));
    }

    if(parseInt(resource_Obj[rootnm].mni) < 0) { // clsase 7.4.6.2.1 TS-0004
        callback('400-29');
        return;
    }

    if(parseInt(resource_Obj[rootnm].mbs) < 0) { // clsase 7.4.6.2.1 TS-0004
        callback('400-30');
        return;
    }

    if(parseInt(resource_Obj[rootnm].mia) < 0) { // clsase 7.4.6.2.1 TS-0004
        callback('400-31');
        return;
    }

    resource_Obj[rootnm].li = (body_Obj[rootnm].li) ? body_Obj[rootnm].li : '';
    resource_Obj[rootnm].or = (body_Obj[rootnm].or) ? body_Obj[rootnm].or : '';

    resource_Obj[rootnm].cni = 0;
    resource_Obj[rootnm].cbs = 0;

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};



// exports.modify_cnt = function(request, response, resource_Obj, body_Obj, callback) {
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
//     update_body(rootnm, body_Obj, resource_Obj);
//
//     resource_Obj[rootnm].st = (parseInt(resource_Obj[rootnm].st, 10) + 1).toString();
//
//
//     if(body_Obj[rootnm].mni) {
//         resource_Obj[rootnm].mni = body_Obj[rootnm].mni;
//         if(parseInt(resource_Obj[rootnm].mni) >= 3153600000) {
//             resource_Obj[rootnm].mni = '3153600000';
//         }
//     }
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
//
