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

// 컨테이너 경로별 기본 보관 정책.
// 클라이언트가 CREATE 본문에 mni/mbs를 명시하면 그 값이 우선한다 (oneM2M 규격 유지).
//
//   KETI_Simul_*         시뮬레이터. sortie 포함 전부 최소 보관, oldest 삭제 허용
//   */disarm             상시 누적 컨테이너. 순환 보관, oldest 삭제 허용
//   */YYYY_MM_DD_T_HH_MM 소티. 삭제 없이 축적
//
// 판정 순서가 곧 우선순위다. KETI_Simul_11/disarm 과
// KETI_Simul_11/2026_08_16_T_18_05 은 모두 시뮬레이터 규칙을 따른다.
var SORTIE_RE = /\/\d{4}_\d{2}_\d{2}_T_\d{2}_\d{2}$/;
var MNI_MAX = '3153600000';       // Mobius 개수 상한 = 사실상 무제한
var MBS_UNLIMITED = '1099511627776'; // 1TiB = 사실상 무제한

function retention_policy(ri) {
    if (ri.indexOf('/KETI_Simul_') >= 0) {
        return {mni: '10000', mbs: null};
    }
    if (SORTIE_RE.test(ri)) {
        return {mni: MNI_MAX, mbs: MBS_UNLIMITED};
    }
    if (ri.slice(-7) === '/disarm') {
        return {mni: '100000', mbs: null};
    }
    return null;
}

exports.retention_policy = retention_policy;

exports.build_cnt = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].disr = (body_Obj[rootnm].disr) ? body_Obj[rootnm].disr : '';
    var policy = retention_policy(resource_Obj[rootnm].ri || '') || {};

    resource_Obj[rootnm].mni = (body_Obj[rootnm].mni) ? body_Obj[rootnm].mni : (policy.mni || '3153600000');
    if(parseInt(resource_Obj[rootnm].mni) >= 3153600000) {
        resource_Obj[rootnm].mni = '3153600000';
    }

    resource_Obj[rootnm].mbs = (body_Obj[rootnm].mbs) ? body_Obj[rootnm].mbs : (policy.mbs || '3153600000');
    resource_Obj[rootnm].mia = (body_Obj[rootnm].mia) ? body_Obj[rootnm].mia : '31536000';

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
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

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
