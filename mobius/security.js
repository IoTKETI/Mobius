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
var db_sql = require('./sql_action');
var ip = require("ip");

var moment = require('moment');

/**
 * acp 행의 pv / pvs 를 권한 규칙 객체로 읽는다. 절대 던지지 않는다.
 *
 * 호출부가 전부 DB 콜백 안이라 여기서 던지면 잡을 곳이 없어 워커가 죽고,
 * 깨진 acp 행 하나가 그 ACP 를 참조하는 모든 요청을 죽이는 크래시 루프가 된다.
 *
 * @returns {Object|null} 규칙 객체. 읽을 수 없으면 null — 호출부는 그 행을
 *                        건너뛴다. 판단할 수 없는 규칙을 통과시키지 않는다.
 */
function parse_acp_rule(raw, attr, ri) {
    var obj = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        }
        catch (e) {
            console.error('[security] ' + attr + ' 를 읽을 수 없어 이 acp 를 건너뛴다 (' + ri + '): ' + e.message);
            return null;
        }
    }
    // JSON.parse('null') 은 던지지 않고 null 을 준다. 배열도 규칙 객체가 아니다.
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        console.error('[security] ' + attr + ' 가 권한 규칙 객체가 아니어서 이 acp 를 건너뛴다 (' + ri + ')');
        return null;
    }
    return obj;
}

// 테스트에서 직접 부를 수 있게 내보낸다. 공개 진입점은 exports.check 하나다.
/**
 * 지금이 accessControlWindow 안인가.
 *
 * actw 는 crontab 형식(초 분 시 일 월 요일)의 허용 시간창 목록이다.
 * 창 하나가 성립하려면 여섯 자리가 *전부* 맞아야 하고, '*' 는
 * "이 자리는 제한 없음" 이라 언제나 맞는 것으로 친다.
 *
 * 예전 코드는 두 가지가 반대였다.
 *   - 한 자리라도 맞으면 곧바로 허용했다(AND 가 아니라 OR).
 *     '0 0 3 * * *'(매일 새벽 3시)가 12:00:00 에도 통과했다 — 초가 0 이라는
 *     이유만으로. 권한을 과하게 내주는 쪽이라 이쪽이 더 위험했다.
 *   - `actw_arr[d] != '*'` 조건 때문에 '*' 자리는 맞는 것으로 칠 수 없었다.
 *     그래서 '* * * * * *'(항상 허용)가 한 자리도 못 맞춰 *항상 거부* 됐다.
 *
 * 자리 값의 목록·범위·주기 표기(1,3 또는 1-5 등)는 예전에도 지원하지 않았다.
 * 여기서도 정확히 일치만 본다.
 *
 * @param {string} window  창 하나 (예: '0 0 3 * * *')
 * @param {Array}  now     [초, 분, 시, 일, 월, 요일] 현재 값
 * @returns {boolean} 이 창에 들어오면 true. 형식이 6자리가 아니면 false
 */
function actw_matches(window, now) {
    var parts = String(window).trim().split(/\s+/);
    if (parts.length !== 6) {
        // 판단할 수 없는 창은 허용하지 않는다.
        console.error('[security] actw 형식이 6자리가 아니다: ' + window);
        return false;
    }
    for (var d = 0; d < 6; d++) {
        if (parts[d] === '*') {
            continue;                       // 이 자리는 제한 없음
        }
        if (parts[d] !== String(now[d])) {
            return false;
        }
    }
    return true;
}

exports._parse_acp_rule = parse_acp_rule;
// 테스트에서 직접 부를 수 있게 내보낸다. 공개 진입점은 exports.check 하나다.
exports._actw_matches = actw_matches;

function security_check_action_pv(request, response, acpiList, cr, access_value, callback) {
    make_internal_ri(acpiList);
    var ri_list = [];
    get_ri_list_sri(request, response, acpiList, ri_list, 0, function (code) {
        if(code === '200') {
            db_sql.select_acp_in(request.db_connection, ri_list, function (err, results_acp) {
                if (!err) {
                    if (results_acp.length == 0) {
                        if (request.headers['x-m2m-origin'] == cr) {
                            callback('1');
                        }
                        else {
                            callback('0');
                        }
                    }
                    else {
                        for (var i = 0; i < results_acp.length; i++) {
                            // 아래 try 는 :45 에서야 열리므로 이 파싱과 hasOwnProperty 는
                            // 보호 밖이었다. 여기는 DB 콜백 안이라 던지면 잡을 곳이 없고,
                            // 깨진 acp 행 하나가 그 ACP 를 참조하는 모든 요청을 죽인다.
                            // JSON.parse('null') 은 던지지 않고 null 을 돌려주므로
                            // 다음 줄 hasOwnProperty 에서 터지는 쪽이 더 찾기 어렵다.
                            //
                            // 정상 생성 경로는 JSON.stringify 로 넣지만, pv 는 생성 시
                            // 타입 검사를 전혀 하지 않는다(pvs 만 acr 를 확인한다).
                            // 읽을 수 없는 권한은 "권한 없음"으로 다룬다 — 판단할 수
                            // 없는 규칙을 통과시키면 안 된다.
                            var pvObj = parse_acp_rule(results_acp[i].pv, 'pv', results_acp[i].ri);
                            if (pvObj === null) {
                                continue;
                            }
                            var from = request.headers['x-m2m-origin'];
                            if (pvObj.hasOwnProperty('acr')) {
                                for (var index in pvObj.acr) {
                                    if (pvObj.acr.hasOwnProperty(index)) {
                                        try {
                                            var acip_permit = 0;
                                            var actw_permit = 0;
                                            var acor_permit = 0;
                                            if (pvObj.acr[index].hasOwnProperty('acco')) {
                                                var acco = pvObj.acr[index].acco;
                                                var acco_idx = 99;
                                                for (acco_idx in acco) {
                                                    if (acco.hasOwnProperty(acco_idx)) {
                                                        if (acco[acco_idx].hasOwnProperty('acip')) {
                                                            if (acco[acco_idx].acip.hasOwnProperty('ipv4')) {
                                                                var ipv4_idx = 99;
                                                                for (ipv4_idx in acco[acco_idx].acip['ipv4']) {
                                                                    if (acco[acco_idx].acip['ipv4'].hasOwnProperty(ipv4_idx)) {
                                                                        if (request.headers.hasOwnProperty('remoteaddress')) {
                                                                            client_ipv4 = request.headers.remoteaddress;
                                                                        }
                                                                        else if (request.connection.remoteAddress == '::1') {
                                                                            var client_ipv4 = ip.address();
                                                                        }
                                                                        else {
                                                                            client_ipv4 = request.connection.remoteAddress.replace('::ffff:', '');
                                                                        }

                                                                        if (acco[acco_idx].acip['ipv4'][ipv4_idx] == client_ipv4) {
                                                                            acip_permit = 1;
                                                                            break;
                                                                        }
                                                                    }
                                                                }

                                                                // ipv4 목록이 비어 있으면(= 제한이 없으면) 허용한다.
                                                                // 원래 여기가 ipv6_idx 를 보고 있었다. 두 가지로 틀린다.
                                                                //   - 첫 평가에서는 ipv6_idx 가 아직 대입 전이라 undefined 다.
                                                                //     var 는 함수 스코프로 호이스팅되므로 선언은 아래에 있어도
                                                                //     참조 자체는 되지만 값이 없다. undefined == 99 는 거짓이라
                                                                //     이 기본 허용 분기가 한 번도 실행되지 않았다.
                                                                //   - 앞선 acco 항목이 ipv6 분기를 탔다면 그때의 인덱스가 남아,
                                                                //     이번 ipv4 판정이 이전 항목의 결과에 오염된다.
                                                                if (ipv4_idx == 99) {
                                                                    acip_permit = 1;
                                                                }
                                                            }
                                                            else if (acco[acco_idx].acip.hasOwnProperty('ipv6')) {
                                                                var ipv6_idx = 99;
                                                                for (ipv6_idx in acco[acco_idx].acip['ipv6']) {
                                                                    if (acco[acco_idx].acip['ipv6'].hasOwnProperty(ipv6_idx)) {
                                                                        if (acco[acco_idx].acip['ipv6'][ipv6_idx] == request.connection.remoteAddress) {
                                                                            acip_permit = 1;
                                                                            break;
                                                                        }
                                                                    }
                                                                }

                                                                if (ipv6_idx == 99) {
                                                                    acip_permit = 1;
                                                                }
                                                            }
                                                            else {
                                                                acip_permit = 1;
                                                            }
                                                        }
                                                        else {
                                                            acip_permit = 1;
                                                        }

                                                        if (acco[acco_idx].hasOwnProperty('actw')) {
                                                            var actw_cur = [];
                                                            actw_cur[5] = moment().utc().day();
                                                            actw_cur[4] = moment().utc().month() + 1;
                                                            actw_cur[3] = moment().utc().date();
                                                            actw_cur[2] = moment().utc().hour();
                                                            actw_cur[1] = moment().utc().minute();
                                                            actw_cur[0] = moment().utc().second();
                                                            // 판정은 actw_matches() 가 한다 — 그 주석에 예전 동작과
                                                            // 무엇이 반대였는지 적어 두었다.
                                                            var actw_idx = 99;
                                                            for (actw_idx in acco[acco_idx].actw) {
                                                                if (acco[acco_idx].actw.hasOwnProperty(actw_idx)) {
                                                                    if (actw_matches(acco[acco_idx].actw[actw_idx], actw_cur)) {
                                                                        actw_permit = 1;
                                                                        break;
                                                                    }
                                                                }
                                                            }

                                                            if (actw_idx == 99) {
                                                                actw_permit = 1;
                                                            }
                                                        }
                                                        else {
                                                            actw_permit = 1;
                                                        }

                                                        if (actw_permit == 1 && acip_permit == 1) {
                                                            break;
                                                        }
                                                    }
                                                }

                                                if (acco_idx == 99) {
                                                    acip_permit = 1;
                                                    actw_permit = 1;
                                                }
                                            }
                                            else {
                                                acip_permit = 1;
                                                actw_permit = 1;
                                            }

                                            if (acip_permit == 1 && actw_permit == 1) {
                                                if (pvObj.acr[index].hasOwnProperty('acor')) {
                                                    var re = new RegExp('^' + from + '$');
                                                    for (var acor_idx in pvObj.acr[index].acor) {
                                                        if (pvObj.acr[index].acor.hasOwnProperty(acor_idx)) {
                                                            if (pvObj.acr[index].acor[acor_idx].match(re) || pvObj.acr[index].acor[acor_idx] == 'all' || pvObj.acr[index].acor[acor_idx] == '*') {
                                                                console.log('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', access_value);

                                                                if ((pvObj.acr[index].acop.toString() & access_value) == access_value) {
                                                                    acor_permit = 1;
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                else {
                                                    acor_permit = 1;
                                                }
                                            }

                                            if (acip_permit == 1 && actw_permit == 1 && acor_permit == 1) {
                                                callback('1');
                                                return;
                                            }
                                        }
                                        catch (e) {
                                            console.log('[security_check_action_pvs]' + e);
                                            callback('500-1');
                                            return;
                                        }
                                    }
                                }
                            }
                            else {
                                if (request.headers['x-m2m-origin'] == cr) {
                                    callback('1');
                                    return;
                                }
                                else {
                                    callback('0');
                                    return;
                                }
                            }
                        }
                        callback('0');
                    }
                }
                else {
                    console.log('query error: ' + results_acp.message);
                    callback('500-1');
                }
            });
        }
        else {
            callback(code);
        }
    });
}

function security_check_action_pvs(request, response, acpiList, access_value, cr, callback) {
    make_internal_ri(acpiList);
    var ri_list = [];
    get_ri_list_sri(request, response, acpiList, ri_list, 0, function (code) {
        if(code === '200') {
            db_sql.select_acp_in(request.db_connection, ri_list, function (err, results_acp) {
                if (!err) {
                    if (results_acp.length == 0) {
                        if (request.headers['x-m2m-origin'] == cr) {
                            callback('1');
                        }
                        else {
                            callback('0');
                        }
                    }
                    else {
                        for (var i = 0; i < results_acp.length; i++) {
                            // pv 쪽과 같은 이유로 보호한다. pvs 는 생성 시 acr 존재를
                            // 확인하므로 pv 보다는 안전하지만, 마이그레이션이나 수동
                            // 편집으로 들어온 행까지 막아주지는 않는다.
                            var pvsObj = parse_acp_rule(results_acp[i].pvs, 'pvs', results_acp[i].ri);
                            if (pvsObj === null) {
                                continue;
                            }
                            var from = request.headers['x-m2m-origin'];
                            for (var index in pvsObj.acr) {
                                if (pvsObj.acr.hasOwnProperty(index)) {
                                    try {
                                        var acip_permit = 0;
                                        var actw_permit = 0;
                                        var acor_permit = 0;
                                        if (pvsObj.acr[index].hasOwnProperty('acco')) {
                                            var acco = pvsObj.acr[index].acco;
                                            var acco_idx = 99;
                                            for (acco_idx in acco) {
                                                if (acco.hasOwnProperty(acco_idx)) {
                                                    if (acco[acco_idx].hasOwnProperty('acip')) {
                                                        if (acco[acco_idx].acip.hasOwnProperty('ipv4')) {
                                                            var ipv4_idx = 99;
                                                            for (ipv4_idx in acco[acco_idx].acip['ipv4']) {
                                                                if (acco[acco_idx].acip['ipv4'].hasOwnProperty(ipv4_idx)) {
                                                                    if (request.connection.remoteAddress == '::1') {
                                                                        var client_ipv4 = ip.address();
                                                                    }
                                                                    else {
                                                                        client_ipv4 = request.connection.remoteAddress.replace('::ffff:', '');
                                                                    }
                                                                    if (acco[acco_idx].acip['ipv4'][ipv4_idx] == client_ipv4) {
                                                                        acip_permit = 1;
                                                                        break;
                                                                    }
                                                                }
                                                            }

                                                            // pv 쪽과 같은 오참조였다 — ipv4 분기인데 ipv6_idx 를 봤다.
                                                            // 첫 평가에서는 undefined 라 이 기본 허용이 죽고, 앞선 acco
                                                            // 항목이 ipv6 분기를 탔다면 그 값에 오염된다.
                                                            if (ipv4_idx == 99) {
                                                                acip_permit = 1;
                                                            }
                                                        }
                                                        else if (acco[acco_idx].acip.hasOwnProperty('ipv6')) {
                                                            var ipv6_idx = 99;
                                                            for (ipv6_idx in acco[acco_idx].acip['ipv6']) {
                                                                if (acco[acco_idx].acip['ipv6'].hasOwnProperty(ipv6_idx)) {
                                                                    if (acco[acco_idx].acip['ipv6'][ipv6_idx] == request.connection.remoteAddress) {
                                                                        acip_permit = 1;
                                                                        break;
                                                                    }
                                                                }
                                                            }

                                                            if (ipv6_idx == 99) {
                                                                acip_permit = 1;
                                                            }
                                                        }
                                                        else {
                                                            acip_permit = 1;
                                                        }
                                                    }
                                                    else {
                                                        acip_permit = 1;
                                                    }

                                                    if (acco[acco_idx].hasOwnProperty('actw')) {
                                                        var actw_cur = [];
                                                        actw_cur[5] = moment().utc().day();
                                                        actw_cur[4] = moment().utc().month() + 1;
                                                        actw_cur[3] = moment().utc().date();
                                                        actw_cur[2] = moment().utc().hour();
                                                        actw_cur[1] = moment().utc().minute();
                                                        actw_cur[0] = moment().utc().second();
                                                        // pv 쪽과 같은 판정이다 — actw_matches() 주석에 예전 동작과
                                                        // 무엇이 반대였는지 적어 두었다.
                                                        var actw_idx = 99;
                                                        for (actw_idx in acco[acco_idx].actw) {
                                                            if (acco[acco_idx].actw.hasOwnProperty(actw_idx)) {
                                                                if (actw_matches(acco[acco_idx].actw[actw_idx], actw_cur)) {
                                                                    actw_permit = 1;
                                                                    break;
                                                                }
                                                            }
                                                        }

                                                        if (actw_idx == 99) {
                                                            actw_permit = 1;
                                                        }
                                                    }
                                                    else {
                                                        actw_permit = 1;
                                                    }

                                                    if (actw_permit == 1 && acip_permit == 1) {
                                                        break;
                                                    }
                                                }
                                            }

                                            if (acco_idx == 99) {
                                                acip_permit = 1;
                                                actw_permit = 1;
                                            }
                                        }
                                        else {
                                            acip_permit = 1;
                                            actw_permit = 1;
                                        }

                                        if (acip_permit == 1 && actw_permit == 1) {
                                            if (pvsObj.acr[index].hasOwnProperty('acor')) {
                                                var re = new RegExp('^' + from + '$');
                                                for (var acor_idx in pvsObj.acr[index].acor) {
                                                    if (pvsObj.acr[index].acor.hasOwnProperty(acor_idx)) {
                                                        if (pvsObj.acr[index].acor[acor_idx].match(re) || pvsObj.acr[index].acor[acor_idx] == 'all' || pvsObj.acr[index].acor[acor_idx] == '*') {
                                                            if ((pvsObj.acr[index].acop.toString() & access_value) == access_value) {
                                                                acor_permit = 1;
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else {
                                                acor_permit = 1;
                                            }
                                        }

                                        if (acip_permit == 1 && actw_permit == 1 && acor_permit == 1) {
                                            results_acp = null;
                                            callback('1');
                                            return;
                                        }
                                    }
                                    catch (e) {
                                        console.log('[security_check_action_pvs]' + e);
                                        callback('500-1');
                                        return;
                                    }
                                }
                            }
                        }
                        callback('0');
                    }
                }
                else {
                    console.log('query error: ' + results_acp.message);
                    callback('500-1');
                }
            });
        }
        else {
            callback(code);
        }
    });
}

function security_default_check_action(request, response, cr, access_value, callback) {
    if(useaccesscontrolpolicy == 'enable') {
        if (request.headers['x-m2m-origin'] == cr) {
            callback('1');
        }
        else {
            callback('0');
        }
    }
    else {
        if (request.headers['x-m2m-origin'] == cr) {
            callback('1');
        }
        else {
            if (access_value & '1' || access_value & '2' || access_value & '32') {
                callback('1');
            }
            else {
                callback('0');
            }
        }
    }
}

exports.check = function(request, response, ty, acpiList, access_value, cr, callback) {
    if(request.headers['x-m2m-origin'] == usesuperuser || request.headers['x-m2m-origin'] == ('/'+usesuperuser)) {
        callback('1');
    }
    else {
        if (ty == '1') { // check selfPrevileges
            if (acpiList.length == 0) {
                acpiList = [url.parse(request.url).pathname.split('?')[0]];
            }
            security_check_action_pvs(request, response, acpiList, access_value, cr, function (code) {
                callback(code);
            });
        }
        else if(ty == '33' || ty == '23' || ty == '4' || ty == '3') { // cnt or sub --> check parents acpi to AE
            if (acpiList.length == 0) {
                var targetUri = request.url.split('?')[0];
                var targetUri_arr = targetUri.split('/');

                var loop_cnt = 0;
                db_sql.select_acp_cnt(request.db_connection, loop_cnt, targetUri_arr, function (err, results_acpi) {
                    if (!err) {
                        if (results_acpi.length == 0) {
                            security_default_check_action(request, response, cr, access_value, function (code) {
                                callback(code);
                            });
                        }
                        else {
                            security_check_action_pv(request, response, results_acpi, cr, access_value, function (code) {
                                callback(code);
                            });
                        }
                    }
                    else {
                        callback('500-1');
                    }
                });
            }
            else {
                security_check_action_pv(request, response, acpiList, cr, access_value, function (code) {
                    callback(code);
                });
            }
        }
        else {
            if (acpiList.length == 0) {
                security_default_check_action(request, response, cr, access_value, function (code) {
                    callback(code);
                });
            }
            else {
                security_check_action_pv(request, response, acpiList, cr, access_value, function (code) {
                    callback(code);
                });
            }
        }
    }
};
