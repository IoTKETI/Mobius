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


// acop is a 6-bit mask: 1 CREATE / 2 RETRIEVE / 4 UPDATE / 8 DELETE / 16 NOTIFY / 32 DISCOVERY
var ACOP_MAX = 63;

/**
 * Validates a pv or pvs value. Does not touch the database and never throws. Only values being written are checked; stored ACPs are not validated on read or evaluation (acp_lint scans those separately).
 *
 * Rejections are conditions that would later surface as 403 or 500; warnings flag values that are probably not intended.
 *
 * @param obj   the pv or pvs value
 * @param attr  'pv' | 'pvs'
 * @returns { code: null, warnings: [...] }            accepted
 *          { code: '400-57', path: 'pv.acr[1].acop', warnings: [...] }  rejected
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
        // pv:{} is rejected here; during evaluation it would end the decision at this point and hide the ACPs after it.
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

        // A rule without acop would throw during evaluation (HTTP 500 instead of 403).
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
                    // Originator comparison is string equality, so a regex-looking value such as 'S.*' matches nobody.
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
                            // Anything but 6 fields is rejected at every evaluation.
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
                        // acip_allows stops at ipv4, so ipv6 would be dead configuration.
                        return deny('400-60', ck + '.acip');
                    }
                }
            }
        }
    }

    if (attr === 'pvs' && !admin_seen) {
        // pvs says who may modify this ACP itself; without the administrator only the superuser can change it.
        warnings.push({ rule: 'pvs_no_admin', path: attr + '.acr',
            message: '관리자(' + global.usesuperuser + ')가 없다 — 수퍼유저 말고는 이 ACP 를 못 고친다' });
    }

    return { code: null, path: null, warnings: warnings };
};

exports.build_acp = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // Invalid pv/pvs would otherwise be stored silently and show up later as 403 or 500; reject at write time.
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
    resource_Obj[rootnm].pv = body_Obj[rootnm].pv;
    resource_Obj[rootnm].pvs = body_Obj[rootnm].pvs;

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};

