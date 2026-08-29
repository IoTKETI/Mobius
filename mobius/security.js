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
exports._acip_allows = acip_allows;
exports._actw_allows = actw_allows;
exports._acor_allows = acor_allows;
exports._evaluate_acr = evaluate_acr;

// ── 권한 평가 ────────────────────────────────────────────────────────
//
// 예전에는 security_check_action_pv(205줄)와 security_check_action_pvs(176줄)가
// 거의 같은 코드를 두 벌 들고 있었다. 그 중복이 실제로 사고를 냈다 —
// ipv4 분기의 ipv6_idx 오참조와 actw 시간창 반전을 pv 쪽만 고치고 pvs 쪽을
// 놓쳐, 한동안 절반만 고쳐진 채로 있었다.
//
// 이제 평가는 evaluate_acr() 한 곳에서만 한다. 고칠 일이 생기면 한 번만 고친다.
//
// 두 경로의 진짜 차이는 셋뿐이라 인자로 받는다.
//   field        'pv' 는 일반 리소스 접근, 'pvs' 는 ACP 자신에 대한 접근
//   use_ra       클라이언트 IPv4 를 remoteaddress 헤더에서 먼저 볼 것인가.
//                이 헤더는 CoAP 프록시가 넣는다(pxy_coap.js). pv 만 보고 있었다 —
//                pvs 도 봐야 맞을 것 같지만 동작을 바꾸지 않으려고 그대로 둔다.
//   cr_fallback  acr 이 없는 규칙을 만났을 때 cr(생성자)과 비교하고 즉시 끝낼
//                것인가. pv 만 그렇게 한다. pvs 는 그냥 다음 acp 로 넘어간다.

/**
 * 요청을 보낸 쪽의 IPv4 주소.
 *
 * @param use_ra  remoteaddress 헤더를 먼저 볼 것인가 (CoAP 프록시가 넣는다)
 */
function client_ipv4_of(request, use_ra) {
    if (use_ra && request.headers.hasOwnProperty('remoteaddress')) {
        return request.headers.remoteaddress;
    }
    if (request.connection.remoteAddress == '::1') {
        return ip.address();
    }
    return request.connection.remoteAddress.replace('::ffff:', '');
}

/**
 * acip(허용 IP) 조건을 통과하는가.
 *
 * 목록이 비어 있으면 "제한 없음"이라 통과다. 예전에는 ipv4 분기가 ipv6_idx 를
 * 보고 있어서 이 기본 통과가 죽어 있었다 — var 호이스팅으로 첫 평가에서
 * undefined 였고, 앞선 항목이 ipv6 분기를 탔다면 그 값에 오염됐다.
 */
function acip_allows(acip, request, use_ra) {
    if (acip == null) {
        return true;                    // acip 자체가 없으면 IP 제한이 없다
    }
    if (acip.hasOwnProperty('ipv4')) {
        var list4 = acip['ipv4'] || [];
        var keys4 = Object.keys(list4);
        if (keys4.length === 0) {
            return true;                // 빈 목록 = 제한 없음
        }
        var mine = client_ipv4_of(request, use_ra);
        for (var i = 0; i < keys4.length; i++) {
            if (list4[keys4[i]] == mine) { return true; }
        }
        return false;
    }
    if (acip.hasOwnProperty('ipv6')) {
        var list6 = acip['ipv6'] || [];
        var keys6 = Object.keys(list6);
        if (keys6.length === 0) {
            return true;
        }
        for (var j = 0; j < keys6.length; j++) {
            if (list6[keys6[j]] == request.connection.remoteAddress) { return true; }
        }
        return false;
    }
    return true;                        // ipv4 도 ipv6 도 없으면 제한이 없다
}

/**
 * actw(허용 시간창) 조건을 통과하는가. 목록이 비면 제한이 없다.
 */
function actw_allows(actw) {
    var keys = Object.keys(actw || {});
    if (keys.length === 0) {
        return true;
    }
    var now = [];
    now[5] = moment().utc().day();
    now[4] = moment().utc().month() + 1;
    now[3] = moment().utc().date();
    now[2] = moment().utc().hour();
    now[1] = moment().utc().minute();
    now[0] = moment().utc().second();

    for (var i = 0; i < keys.length; i++) {
        if (actw_matches(actw[keys[i]], now)) { return true; }
    }
    return false;
}

/**
 * acor(허용 발신자)와 acop(허용 연산) 조건을 통과하는가.
 *
 * acor 이 없으면 발신자 제한이 없다는 뜻이라 통과다. 있으면 정규식 일치나
 * 'all' / '*' 여야 하고, 그 위에 acop 비트가 요청한 연산을 포함해야 한다.
 */
function acor_allows(rule, from, access_value) {
    if (!rule.hasOwnProperty('acor')) {
        return true;
    }

    // 발신자를 **그대로** 비교한다. 절대 정규식으로 만들지 말 것.
    //
    // 예전에는 new RegExp('^' + from + '$') 로 **요청자가 보낸 헤더**를 정규식으로
    // 만들어 정책 쪽 항목(acor)을 검사했다. 방향이 반대다. 그래서:
    //
    //   1. `X-M2M-Origin: .*` 한 줄로 acor 의 어떤 값에도 매칭돼 ACP 가 통째로
    //      우회됐다. RETRIEVE 뿐 아니라 DELETE 까지 통과한다.
    //      배포 서버 실측(2026-08-29, /Mobius/Camera1/health, acor=["S","SjOu6u0QHNF"]):
    //        X-M2M-Origin: Cstranger  -> 403  (정상)
    //        X-M2M-Origin: .*         -> 200  (우회)
    //        X-M2M-Origin: .+         -> 200  (우회)
    //        X-M2M-Origin: S.*        -> 200  (우회)
    //   2. `X-M2M-Origin: [` 처럼 깨진 정규식이면 RegExp 생성자가 던져
    //      security_check_action 의 catch 로 빠지고 500 "database error" 가 났다.
    //      헤더 한 줄로 임의의 ACP 경로를 500 으로 만들 수 있었다.
    //
    // 정규식이 무슨 기능을 준 것도 아니다. acor 쪽에 패턴을 적는 것은 원래도
    // 동작하지 않았다 — acor:['S.*'] 에 from='SAE1' 은 false 다 (방향이 반대라서).
    // 여러 발신자를 한꺼번에 허용하려면 'all' 또는 '*' 를 쓴다.
    var keys = Object.keys(rule.acor || {});
    for (var i = 0; i < keys.length; i++) {
        var who = rule.acor[keys[i]];
        if (String(who) === String(from) || who === 'all' || who === '*') {
            if ((rule.acop.toString() & access_value) == access_value) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 권한 규칙(acr 항목) 하나를 평가한다.
 *
 * acco(컨텍스트 제약)가 여러 개면 그중 하나라도 acip·actw 를 함께 만족하면
 * 된다. acco 가 없거나 비어 있으면 컨텍스트 제약이 없다는 뜻이다.
 */
function evaluate_acr(rule, request, from, access_value, use_ra) {
    var ctx_ok = true;

    if (rule.hasOwnProperty('acco')) {
        var acco = rule.acco;
        var keys = Object.keys(acco || {});
        if (keys.length === 0) {
            ctx_ok = true;              // 빈 acco = 제약 없음
        }
        else {
            ctx_ok = false;
            for (var i = 0; i < keys.length; i++) {
                var one = acco[keys[i]];
                if (acip_allows(one.acip, request, use_ra) && actw_allows(one.actw)) {
                    ctx_ok = true;
                    break;
                }
            }
        }
    }

    if (!ctx_ok) {
        return false;
    }
    return acor_allows(rule, from, access_value);
}

/**
 * acpiList 가 가리키는 ACP 들의 field(pv|pvs)로 접근을 판정한다.
 *
 * @param field       'pv' 또는 'pvs'
 * @param use_ra      client IPv4 를 remoteaddress 헤더에서 먼저 볼 것인가
 * @param cr_fallback acr 없는 규칙에서 cr 비교로 즉시 끝낼 것인가
 */
function security_check_action(request, response, acpiList, cr, access_value,
                               field, use_ra, cr_fallback, callback) {
    make_internal_ri(acpiList);
    var ri_list = [];
    get_ri_list_sri(request, response, acpiList, ri_list, 0, function (code) {
        if (code !== '200') {
            callback(code);
            return;
        }

        db_sql.select_acp_in(request.db_connection, ri_list, function (err, results_acp) {
            if (err) {
                console.log('query error: ' + results_acp.message);
                callback('500-1');
                return;
            }

            if (results_acp.length == 0) {
                callback(request.headers['x-m2m-origin'] == cr ? '1' : '0');
                return;
            }

            var from = request.headers['x-m2m-origin'];

            for (var i = 0; i < results_acp.length; i++) {
                // 깨진 acp 행 하나가 그 ACP 를 참조하는 모든 요청을 죽이면 안 된다.
                // parse_acp_rule 은 던지지 않고 null 을 준다.
                var ruleObj = parse_acp_rule(results_acp[i][field], field, results_acp[i].ri);
                if (ruleObj === null) {
                    continue;
                }

                if (!ruleObj.hasOwnProperty('acr')) {
                    // pv 는 여기서 생성자와 비교하고 끝낸다. pvs 에는 이 분기가
                    // 없어서 그냥 다음 acp 로 넘어갔다 — 동작을 바꾸지 않는다.
                    if (cr_fallback) {
                        callback(from == cr ? '1' : '0');
                        return;
                    }
                    continue;
                }

                var acr_keys = Object.keys(ruleObj.acr || {});
                for (var j = 0; j < acr_keys.length; j++) {
                    try {
                        if (evaluate_acr(ruleObj.acr[acr_keys[j]], request, from, access_value, use_ra)) {
                            callback('1');
                            return;
                        }
                    }
                    catch (e) {
                        console.log('[security_check_action ' + field + '] ' + e);
                        callback('500-1');
                        return;
                    }
                }
            }

            results_acp = null;
            callback('0');
        });
    });
}

// pv  — 일반 리소스 접근. remoteaddress 헤더를 보고, acr 없는 규칙에서 cr 로 끝낸다.
function security_check_action_pv(request, response, acpiList, cr, access_value, callback) {
    security_check_action(request, response, acpiList, cr, access_value,
                          'pv', true, true, callback);
}

// pvs — ACP 자신에 대한 접근. 인자 순서가 pv 와 달랐다(cr 과 access_value 가
// 뒤바뀌어 있었다). 호출부를 그대로 두려고 시그니처는 유지한다.
function security_check_action_pvs(request, response, acpiList, access_value, cr, callback) {
    security_check_action(request, response, acpiList, cr, access_value,
                          'pvs', false, false, callback);
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
