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
var util = require('util');
var merge = require('merge');

var responder = require('./responder');
var short_ri = require('./short_ri');
var name_limits = require('./name_limits');

exports.build_ae = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].apn = (body_Obj[rootnm].apn) ? body_Obj[rootnm].apn : '';
    resource_Obj[rootnm].poa = (body_Obj[rootnm].poa) ? body_Obj[rootnm].poa : [];
    resource_Obj[rootnm].or = (body_Obj[rootnm].or) ? body_Obj[rootnm].or : '';
    resource_Obj[rootnm].csz = (body_Obj[rootnm].csz) ? body_Obj[rootnm].csz : '';
    resource_Obj[rootnm].srv = (body_Obj[rootnm].srv) ? body_Obj[rootnm].srv : '';

    // ── AE-ID 정책 (사용자 결정 2026-09-06, test/ae-id-policy.test.js) ──────────
    // X-M2M-Origin 이 정확히 'S' 나 'C' 일 때만 CSE 가 만든다. 그 밖의 값은 **그대로**
    // aei 다 — 형식은 검사하지 않는다(S/C 로 시작하는지 보지 않는다). oneM2M 은 그렇게 정하지만 사용자들은
    // oneM2M 을 모르므로 "S/C 로 시작하지 않는다" 는 오류를 받아도 대처하지 못했고,
    // 강제하면 사용자가 만들 수 있는 id 가 제한된다. 배포에도 S/C 로 시작하지 않는 aei 가
    // 13개 있다. 길이만 이 CSE 의 저장 한계로 막는다(name_limits — 넘으면 400-70).
    if( (request.headers['x-m2m-origin'] == 'S') ) {
        // aei 도 short_ri 로 — shortid 는 프로세스마다 카운터가 0 에서 시작해 같은 초에 뜬 워커끼리 겹칠 수 있다
        resource_Obj[rootnm].aei = short_ri.generate('S');
    }
    else if( (request.headers['x-m2m-origin'] == 'C') ) {
        resource_Obj[rootnm].aei = short_ri.generate('C');
    }
    else {
        resource_Obj[rootnm].aei = request.headers['x-m2m-origin'];
        var too_long = name_limits.check_id(resource_Obj[rootnm].aei);
        if (too_long) {
            callback(too_long);
            return;
        }
    }

    resource_Obj[rootnm].nl = '';

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};



// exports.modify_ae = function(request, response, resource_Obj, body_Obj, callback) {
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
//     if(body_Obj[rootnm].et == '') {
//         if (body_Obj[rootnm].et < resource_Obj[rootnm].ct) {
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

