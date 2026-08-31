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
var responder = require('./responder');

// 컨테이너 경로(ri)별 기본 보관 정책. 선택 기능이며 기본은 비활성이다.
// conf.json 의 "retentionPolicies" 배열로 정의한다. 정의하지 않으면 어떤 규칙도
// 적용되지 않고 Mobius 기본값(mni/mbs = 3153600000)이 그대로 쓰인다.
//
// 클라이언트가 CREATE 본문에 mni/mbs 를 명시하면 언제나 그 값이 우선한다
// (oneM2M 규격 유지). 이 정책은 명시하지 않았을 때의 기본값만 바꾼다.
//
//   "retentionPolicies": [
//     {"match": "contains", "value": "/Simul_", "mni": "10000"},
//     {"match": "regex", "value": "/\\d{4}_\\d{2}_\\d{2}_T_\\d{2}_\\d{2}$",
//      "mni": "3153600000", "mbs": "1099511627776"},
//     {"match": "suffix", "value": "/archive", "mni": "100000"}
//   ]
//
//   match : "contains"(기본) | "prefix" | "suffix" | "regex"
//   value : 비교 문자열. regex 는 JS 정규식 소스이며 JSON 이므로 역슬래시를 이스케이프한다
//   mni   : 생략하면 Mobius 기본값을 쓴다
//   mbs   : 생략하면 Mobius 기본값을 쓴다
//
// 배열 순서가 곧 우선순위다. 처음 일치하는 규칙 하나만 적용된다.
var RETENTION_RULES = null;

function build_matcher(match, value) {
    if (match === 'regex') {
        var re = new RegExp(value);
        return function (ri) { return re.test(ri); };
    }
    if (match === 'prefix') {
        return function (ri) { return ri.indexOf(value) === 0; };
    }
    if (match === 'suffix') {
        return function (ri) { return ri.length >= value.length && ri.slice(-value.length) === value; };
    }
    return function (ri) { return ri.indexOf(value) >= 0; };
}

// 잘못된 규칙 하나 때문에 컨테이너 생성 전체가 막히면 안 되므로,
// 문제가 있는 항목은 로그를 남기고 건너뛴다.
function compile_retention_rules() {
    var raw = global.retention_policies;
    var rules = [];

    if (!Array.isArray(raw)) {
        return rules;
    }

    for (var i = 0; i < raw.length; i++) {
        var rule = raw[i];

        if (!rule || typeof rule.value !== 'string' || rule.value === '') {
            console.error('[retention_policy] rule ' + i + ' skipped: "value" is required');
            continue;
        }

        var match = rule.match || 'contains';
        if (['contains', 'prefix', 'suffix', 'regex'].indexOf(match) < 0) {
            console.error('[retention_policy] rule ' + i + ' skipped: unknown match "' + match + '"');
            continue;
        }

        try {
            rules.push({
                test: build_matcher(match, rule.value),
                mni: (rule.mni == null) ? null : String(rule.mni),
                mbs: (rule.mbs == null) ? null : String(rule.mbs)
            });
        }
        catch (e) {
            console.error('[retention_policy] rule ' + i + ' skipped: ' + e.message);
        }
    }

    return rules;
}

function retention_policy(ri) {
    if (RETENTION_RULES === null) {
        RETENTION_RULES = compile_retention_rules();
        if (RETENTION_RULES.length > 0) {
            console.log('[retention_policy] ' + RETENTION_RULES.length + ' rule(s) loaded');
        }
    }

    for (var i = 0; i < RETENTION_RULES.length; i++) {
        if (RETENTION_RULES[i].test(ri)) {
            return {mni: RETENTION_RULES[i].mni, mbs: RETENTION_RULES[i].mbs};
        }
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
    // cr 은 서버가 정한다. 본문 값을 받으면 남의 이름으로 리소스를 만들 수 있고
    // (실측: 201 로 통과하고 cr 이 피해자 ID 로 저장됐다), security.js 의
    // creator_bypasses 가 cr 로 접근을 허용하므로 그것이 곧 권한 위조가 된다.
    // 본문에 cr 을 실어 보내는 것 자체는 oneM2M 상 허용이라 거부하지 않고 무시한다.
    resource_Obj[rootnm].cr = request.headers['x-m2m-origin'];

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
