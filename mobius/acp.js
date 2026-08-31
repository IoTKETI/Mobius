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


// acop 은 6비트다: 1 CREATE / 2 RETRIEVE / 4 UPDATE / 8 DELETE / 16 NOTIFY / 32 DISCOVERY
var ACOP_MAX = 63;

/**
 * pv / pvs 를 검증한다. DB 를 보지 않고, 절대 던지지 않는다.
 *
 * **새로 쓰는 값만 본다.** 이미 저장된 ACP 는 읽기·평가 어느 쪽에서도 검증하지
 * 않는다 — 잘못 저장된 것을 PUT 으로 고치는 길을 막으면 안 되기 때문이다.
 * 저장된 것을 훑는 일은 acp_lint 가 따로 한다.
 *
 * 거부와 경고를 나눈다. 거부는 "이대로 두면 나중에 403 이나 500 이 나는데
 * 그때는 원인을 못 찾는다" 인 것들이고, 경고는 "의도한 게 맞는지" 인 것들이다.
 * 경고로 거부하면 대원칙("잠글 곳만 명시적으로 잠근다")을 어기고 기존
 * 클라이언트를 깨뜨린다.
 *
 * @param obj   pv 또는 pvs 값
 * @param attr  'pv' | 'pvs'
 * @returns { code: null, warnings: [...] }            통과
 *          { code: '400-57', path: 'pv.acr[1].acop', warnings: [...] }  거부
 */
exports.validate_privileges = function (obj, attr) {
    var warnings = [];
    var deny = function (code, path) {
        return { code: code, path: path, warnings: warnings };
    };

    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        return deny('400-56', attr);
    }
    if (!obj.hasOwnProperty('acr')) {
        // pv:{} 가 여기서 막힌다. 평가 중 만나면 그 자리에서 판정을 끝내고
        // 뒤 ACP 를 통째로 가리는데, acpi 배열만 봐서는 이유를 알 수 없다.
        return deny('400-23', attr + '.acr');
    }
    if (!Array.isArray(obj.acr)) {
        return deny('400-12', attr + '.acr');
    }
    if (obj.acr.length === 0) {
        return deny('400-23', attr + '.acr');
    }

    var admin_seen = false;

    for (var i = 0; i < obj.acr.length; i++) {
        var rule = obj.acr[i];
        var at = attr + '.acr[' + i + ']';

        if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
            return deny('400-56', at);
        }

        // acop 이 없으면 평가 중 TypeError 가 나서 403 이 아니라 HTTP 500 이 된다.
        if (!rule.hasOwnProperty('acop')) {
            return deny('400-57', at + '.acop');
        }
        var acop = Number(rule.acop);
        if (!isFinite(acop) || Math.floor(acop) !== acop || acop < 0 || acop > ACOP_MAX) {
            return deny('400-57', at + '.acop');
        }
        if (acop === 0) {
            warnings.push({ rule: 'acop_zero', path: at + '.acop',
                message: '아무 권한도 주지 않는 규칙이다' });
        }

        if (rule.hasOwnProperty('acor')) {
            if (!Array.isArray(rule.acor)) {
                return deny('400-13', at + '.acor');
            }
            for (var j = 0; j < rule.acor.length; j++) {
                var who = rule.acor[j];
                if (typeof who !== 'string') {
                    return deny('400-58', at + '.acor[' + j + ']');
                }
                if (who === global.usesuperuser) { admin_seen = true; }
                if (who !== 'all' && who !== '*' && /[.*^$\[\]+?()|\\]/.test(who)) {
                    // 예전 코드가 발신자를 정규식으로 만들었던 잔재다. 지금은
                    // 문자열 등치라 'S.*' 같은 값은 아무와도 맞지 않는다.
                    // 배포의 유일한 ACP 가 acor:["S"] 인 것도 같은 유래다.
                    warnings.push({ rule: 'acor_looks_like_regex', path: at + '.acor[' + j + ']',
                        message: '정규식처럼 보인다 — 발신자 비교는 문자열 등치라 맞지 않는다' });
                }
                if (who.charAt(0) === '/') {
                    warnings.push({ rule: 'acor_not_normalized', path: at + '.acor[' + j + ']',
                        message: "'/' 로 시작한다 — '/X' 와 'X' 는 서로 다른 주체로 본다" });
                }
            }
        }

        if (rule.hasOwnProperty('acco')) {
            if (!Array.isArray(rule.acco)) {
                return deny('400-14', at + '.acco');
            }
            for (var k = 0; k < rule.acco.length; k++) {
                var one = rule.acco[k];
                var ck = at + '.acco[' + k + ']';
                if (one === null || typeof one !== 'object' || Array.isArray(one)) {
                    return deny('400-56', ck);
                }
                if (one.hasOwnProperty('actw')) {
                    if (!Array.isArray(one.actw)) {
                        return deny('400-59', ck + '.actw');
                    }
                    for (var w = 0; w < one.actw.length; w++) {
                        var fields = String(one.actw[w]).trim().split(/\s+/);
                        if (fields.length !== 6) {
                            // 6자리가 아니면 평가할 때마다 로그를 찍고 언제나 거부한다.
                            return deny('400-59', ck + '.actw[' + w + ']');
                        }
                        if (fields[0] !== '*' || fields[1] !== '*') {
                            warnings.push({ rule: 'actw_second_pinned', path: ck + '.actw[' + w + ']',
                                message: "초 또는 분이 '*' 가 아니다 — 하루에 그 순간만 열린다" });
                        }
                    }
                }
                if (one.hasOwnProperty('acip') && one.acip !== null && typeof one.acip === 'object') {
                    if (one.acip.hasOwnProperty('ipv4') && one.acip.hasOwnProperty('ipv6')) {
                        // acip_allows 가 ipv4 에서 끝내므로 ipv6 는 죽은 값이다.
                        return deny('400-60', ck + '.acip');
                    }
                }
            }
        }
    }

    if (attr === 'pvs' && !admin_seen) {
        // pvs 는 "이 ACP 자체를 누가 고칠 수 있는가" 다. acp 테이블에 cr 컬럼이
        // 없어 생성자로 되돌릴 수도 없다 — 관리자가 빠지면 수퍼유저 말고는
        // 아무도 못 고친다.
        warnings.push({ rule: 'pvs_no_admin', path: attr + '.acr',
            message: '관리자(' + global.usesuperuser + ')가 없다 — 수퍼유저 말고는 이 ACP 를 못 고친다' });
    }

    return { code: null, path: null, warnings: warnings };
};

exports.build_acp = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // 잘못된 pv/pvs 는 조용히 저장됐다가 나중에 403 이나 500 으로 나타난다.
    // 그때는 어느 값이 문제였는지 알 방법이 없으므로 쓰는 시점에 막는다.
    var checked = ['pv', 'pvs'];
    for (var c = 0; c < checked.length; c++) {
        var attr = checked[c];
        if (!body_Obj[rootnm].hasOwnProperty(attr)) { continue; }
        var v = exports.validate_privileges(body_Obj[rootnm][attr], attr);
        for (var w = 0; w < v.warnings.length; w++) {
            console.log('[acp] warn ' + v.warnings[w].rule + ' at ' + v.warnings[w].path +
                ' — ' + v.warnings[w].message);
        }
        if (v.code !== null) {
            console.log('[acp] reject ' + v.code + ' at ' + v.path);
            callback(v.code);
            return;
        }
    }

    // body
    //body_Obj[rootnm].pv.acr[body_Obj[rootnm].pv.acr.length] = {acor:['Superman'], acop:'63'};
    //body_Obj[rootnm].pvs.acr[body_Obj[rootnm].pvs.acr.length] = {acor:['Superman'], acop:'63'};
    resource_Obj[rootnm].pv = body_Obj[rootnm].pv;
    resource_Obj[rootnm].pvs = body_Obj[rootnm].pvs;

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};



// exports.modify_acp = function(request, response, resource_Obj, body_Obj, callback) {
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
//     if(body_Obj[rootnm].pv) {
//         body_Obj[rootnm].pv.acr[body_Obj[rootnm].pv.acr.length] = {acor:[usecseid], acop:'63'};
//         resource_Obj[rootnm].pv = body_Obj[rootnm].pv;
//     }
//
//     if(body_Obj[rootnm].pvs) {
//         body_Obj[rootnm].pvs.acr[body_Obj[rootnm].pvs.acr.length] = {acor:[usecseid], acop:'63'};
//         resource_Obj[rootnm].pvs = body_Obj[rootnm].pvs;
//     }
//
//     var cur_d = new Date();
//     resource_Obj[rootnm].lt = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
//
//     if (resource_Obj[rootnm].et != '') {
//         if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
//             body_Obj = {};
//
//             body_Obj['dbg'] = 'expiration time is before now';
//             responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//             callback('0', resource_Obj);
//             return '0';
//         }
//     }
//
//     callback('1', resource_Obj);
// };

