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
var acp_observe = require('./acp_observe');

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
/**
 * oneM2M accessControlOperations 비트. 호출부(app.js)가 '1'·'2'·'32' 같은
 * 리터럴을 아홉 곳에 흩어 쓰고 있었다(남은 일 §5.6). 값은 문자열이다 —
 * acop_allows 가 `rule.acop.toString() & access_value` 로 비교하고 default
 * 정책이 `access_value & '1'` 처럼 쓰므로, 숫자로 바꾸면 그 자리들을 같이 봐야 한다.
 *
 * SUB_CREATE 는 '3'(CREATE|RETRIEVE) 이다. 호출부 주석은 "NOTIFY 를 포함한 3"
 * 이라고 적었지만 NOTIFY 는 16 이다 — 값은 옛 코드 그대로 두고 이름만 사실대로
 * 붙였다. 바꾸는 것은 ACP 판정 변경이라 별건이다.
 */
exports.ACOP = Object.freeze({
    CREATE: '1', RETRIEVE: '2', UPDATE: '4', DELETE: '8', NOTIFY: '16', DISCOVERY: '32',
    SUB_CREATE: '3'
});

exports._acor_allows = acor_allows;
exports._acor_matches = acor_matches;
exports._acop_allows = acop_allows;
exports._evaluate_acr = evaluate_acr;
exports._evaluate_acr_traced = evaluate_acr_traced;
// 시뮬레이터(acp_simulate)가 이 함수를 그대로 쓴다. 판정 로직의 두 번째 사본을
// 만들면 언젠가 갈라지고, 그러면 "미리 본 결과" 를 믿을 수 없게 된다.
exports._evaluate_acp_rows = evaluate_acp_rows;

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
    // acor 이 없으면 "발신자 제한이 없다" 는 뜻이지 "연산 제한이 없다" 는 뜻이
    // 아니다. 예전에는 여기서 그냥 true 를 돌려줘 acop 을 **아예 보지 않았다** —
    // acop:0(아무 권한도 주지 않겠다는 규칙)이 DELETE 를 통과시켰다.
    // 발신자만 통과시키고 연산 비트는 아래와 똑같이 본다.
    //
    // 둘로 나눈 것은 판정근거 때문이다. 거부가 발신자 때문인지 연산 비트
    // 때문인지 구분하지 못하면 관리자가 ACP 를 어떻게 고쳐야 할지 알 수 없다.
    // **평가 순서는 그대로 지킨다** — acor 이 안 맞으면 acop 을 건드리지
    // 않는다. acop 이 없는 규칙은 그때만 던져야 한다(동작 보존).
    return acor_matches(rule, from) && acop_allows(rule, access_value);
}

/**
 * 발신자(acor)만 본다. acor 키가 없으면 발신자 제한이 없다는 뜻이라 통과다.
 */
function acor_matches(rule, from) {
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
            return true;
        }
    }
    return false;
}

/**
 * 연산 비트(acop)만 본다.
 *
 * acop 이 없으면 여기서 TypeError 가 난다 — 그러면 403 이 아니라 HTTP 500 이
 * 나간다. 예전부터 그랬고 고치지 않는다(동작 보존). 대신 acp_lint 가 그런
 * ACP 를 미리 찾아내고, 새로 쓰는 값은 acp.validate_privileges 가 막는다.
 */
function acop_allows(rule, access_value) {
    return (rule.acop.toString() & access_value) == access_value;
}

/**
 * 권한 규칙(acr 항목) 하나를 평가한다.
 *
 * acco(컨텍스트 제약)가 여러 개면 그중 하나라도 acip·actw 를 함께 만족하면
 * 된다. acco 가 없거나 비어 있으면 컨텍스트 제약이 없다는 뜻이다.
 */
function evaluate_acr(rule, request, from, access_value, use_ra) {
    return evaluate_acr_traced(rule, request, from, access_value, use_ra).allow;
}

/**
 * evaluate_acr 와 같은 판정을, **어느 조건에서 걸렸는지**와 함께 돌려준다.
 *
 * 세 관문을 원래 순서대로 지난다. 순서가 중요하다 — acco 나 acor 에서 막히면
 * acop 을 건드리지 않고, acop 이 없는 규칙은 그때 던지지 않는다.
 * 아직 보지 않은 관문은 null 이다(false 가 아니다).
 */
function evaluate_acr_traced(rule, request, from, access_value, use_ra) {
    var acco_ok = true;

    if (rule.hasOwnProperty('acco')) {
        var acco = rule.acco;
        var keys = Object.keys(acco || {});
        if (keys.length === 0) {
            acco_ok = true;             // 빈 acco = 제약 없음
        }
        else {
            acco_ok = false;
            for (var i = 0; i < keys.length; i++) {
                var one = acco[keys[i]];
                if (acip_allows(one.acip, request, use_ra) && actw_allows(one.actw)) {
                    acco_ok = true;
                    break;
                }
            }
        }
    }

    if (!acco_ok) {
        return { allow: false, acco_ok: false, acor_ok: null, acop_ok: null };
    }

    var acor_ok = acor_matches(rule, from);
    if (!acor_ok) {
        return { allow: false, acco_ok: true, acor_ok: false, acop_ok: null };
    }

    var acop_ok = acop_allows(rule, access_value);
    return { allow: acop_ok, acco_ok: true, acor_ok: true, acop_ok: acop_ok };
}

/**
 * ACP 행 목록으로 판정한다 — DB 도 콜백도 없는 순수 함수.
 *
 * security_check_action 의 루프를 그대로 떼어냈다. 판정 규칙은 한 줄도 바뀌지
 * 않았고, 대신 **왜 그렇게 판정했는지**를 함께 돌려준다. 지금까지 거부는
 * '0' 한 글자였고 그 안에 이유가 없었다 — 어느 ACP 의 어느 규칙이 막았는지,
 * 뒤에 평가되지 못한 ACP 가 있는지 알 방법이 없었다.
 *
 * 이 함수가 DB 에서 떨어져 있어야 시뮬레이터("걸면 어떻게 되나")가 성립한다.
 * 요청을 실제로 보내지 않고도 같은 코드로 답할 수 있어야 하기 때문이다.
 *
 * @param rows         [{ri, pv, pvs}] — select_acp_in 이 돌려준 그대로
 * @param field        'pv' 또는 'pvs'
 * @param use_ra       client IPv4 를 remoteaddress 헤더에서 먼저 볼 것인가
 * @param cr_fallback  acr 없는 규칙에서 cr 비교로 즉시 끝낼 것인가
 * @returns { code: '1'|'0'|'500-1', trace: {...} }
 */
function evaluate_acp_rows(rows, request, cr, access_value, field, use_ra, cr_fallback) {
    var from = request.headers['x-m2m-origin'];
    var trace = {
        decided_by: null,
        field: field,
        acp_ri: null,
        acr_index: null,
        cr: cr,
        from: from,
        access_value: access_value,
        order: (rows || []).map(function (r) { return r.ri; }),
        evaluated: [],
        stopped_early: false,
        not_evaluated: [],
        error: null
    };

    function rest_of(i) {
        return trace.order.slice(i + 1);
    }

    if (!rows || rows.length === 0) {
        // 참조한 ACP 를 하나도 못 찾았다. 잠금이 조용히 풀려 생성자만 통과한다.
        trace.decided_by = 'no_acp_row';
        return { code: (from == cr ? '1' : '0'), trace: trace };
    }

    for (var i = 0; i < rows.length; i++) {
        var ruleObj = parse_acp_rule(rows[i][field], field, rows[i].ri);
        if (ruleObj === null) {
            // 깨진 acp 행 하나가 그 ACP 를 참조하는 모든 요청을 죽이면 안 된다.
            trace.evaluated.push({ ri: rows[i].ri, skipped: true, reason: 'parse_error', rules: [] });
            continue;
        }

        if (!ruleObj.hasOwnProperty('acr')) {
            trace.evaluated.push({ ri: rows[i].ri, skipped: true, reason: 'no_acr', rules: [] });
            // pv 는 여기서 생성자와 비교하고 끝낸다. pvs 에는 이 분기가
            // 없어서 그냥 다음 acp 로 넘어갔다 — 동작을 바꾸지 않는다.
            if (cr_fallback) {
                trace.decided_by = 'no_acr_cr';
                trace.acp_ri = rows[i].ri;
                trace.stopped_early = true;
                trace.not_evaluated = rest_of(i);
                return { code: (from == cr ? '1' : '0'), trace: trace };
            }
            continue;
        }

        var seen = { ri: rows[i].ri, skipped: false, reason: null, rules: [] };
        trace.evaluated.push(seen);

        var acr_keys = Object.keys(ruleObj.acr || {});
        for (var j = 0; j < acr_keys.length; j++) {
            var rule = ruleObj.acr[acr_keys[j]];
            try {
                var detail = evaluate_acr_traced(rule, request, from, access_value, use_ra);
                seen.rules.push({
                    i: j,
                    acor_ok: detail.acor_ok,
                    acop_ok: detail.acop_ok,
                    acco_ok: detail.acco_ok,
                    allow: detail.allow
                });
                if (detail.allow) {
                    trace.decided_by = 'acr';
                    trace.acp_ri = rows[i].ri;
                    trace.acr_index = j;
                    trace.stopped_early = i < rows.length - 1;
                    trace.not_evaluated = rest_of(i);
                    return { code: '1', trace: trace };
                }
            }
            catch (e) {
                // acop 이 없는 규칙이 여기로 온다. 403 이 아니라 500 이 나가는데,
                // 그 사실이 지금까지 로그 한 줄로만 남았다.
                console.log('[security_check_action ' + field + '] ' + e);
                trace.decided_by = 'eval_error';
                trace.acp_ri = rows[i].ri;
                trace.acr_index = j;
                trace.error = e && e.message ? e.message : String(e);
                trace.stopped_early = true;
                trace.not_evaluated = rest_of(i);
                return { code: '500-1', trace: trace };
            }
        }
    }

    trace.decided_by = 'exhausted';
    return { code: '0', trace: trace };
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
            callback(code, { decided_by: 'lookup_error', field: field, acpi: acpiList });
            return;
        }

        db_sql.select_acp_in(request.db_connection, ri_list, function (err, results_acp) {
            if (err) {
                console.log('query error: ' + results_acp.message);
                callback('500-1', { decided_by: 'db_error', field: field, acpi: ri_list });
                return;
            }

            var verdict = evaluate_acp_rows(results_acp, request, cr, access_value,
                                            field, use_ra, cr_fallback);
            verdict.trace.acpi = ri_list;
            results_acp = null;
            callback(verdict.code, verdict.trace);
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
    // acpi 가 아무 데도 없는 리소스의 기본 정책이다. useaccesscontrolpolicy 라는
    // 이름과 달리 "ACP 를 쓰느냐" 가 아니라 "ACP 가 없을 때 어떻게 하느냐" 다.
    var trace = {
        decided_by: 'default_policy',
        source: 'none',
        policy: useaccesscontrolpolicy,
        cr: cr,
        from: request.headers['x-m2m-origin'],
        cr_match: request.headers['x-m2m-origin'] == cr,
        access_value: access_value
    };

    if(useaccesscontrolpolicy == 'enable') {
        if (request.headers['x-m2m-origin'] == cr) {
            callback('1', trace);
        }
        else {
            callback('0', trace);
        }
    }
    else {
        if (request.headers['x-m2m-origin'] == cr) {
            callback('1', trace);
        }
        else {
            if (access_value & '1' || access_value & '2' || access_value & '32') {
                callback('1', trace);
            }
            else {
                callback('0', trace);
            }
        }
    }
}

/**
 * 생성자는 ACP 가 걸려 있어도 통과하는가.
 *
 * 예전에는 cr 을 세 자리에서만 봤다 — acpi 가 비었을 때(기본 정책), 참조한
 * ACP 가 DB 에 없을 때, pv 에 acr 키가 없을 때. **정상 ACP 가 걸리는 순간
 * 생성자는 자기 리소스에서 밀려났다.** 그 결과가 둘이다.
 *
 *   - 장치가 만든 리소스를 그 장치가 못 읽는다. 사람은 장치의 원본 ID 를
 *     모르므로 pv.acr 에 적어 줄 수도 없다.
 *   - 잘못 걸린 ACP 를 생성자가 스스로 못 푼다. 배포의 /Mobius/sch8 이
 *     수퍼유저 말고는 아무도 못 쓰는 상태로 남아 있는 이유다.
 *
 * 운영 대원칙("수정·삭제는 생성자만")대로면 생성자는 자기 것에서 배제되지
 * 않아야 한다. 그래서 ACP 는 **권한을 더하는 것**이지 생성자를 몰아내는
 * 것이 아니다.
 *
 * ty=1(ACP 리소스 자신)은 뺀다. ACP 를 누가 고칠 수 있는지는 pvs 가 정하고,
 * 여기 오는 cr 이 ACP 의 생성자가 아니기 때문이다 — check_acp_update_acpi
 * (resource.js)는 **대상 리소스의** cr 을 넘긴다. 빼지 않으면 대상의
 * 생성자가 아무 ACP 나, 그 ACP 의 pvs 와 무관하게 갖다 붙일 수 있다.
 */
function creator_bypasses(ty, cr, from) {
    if (ty == '1') {
        return false;
    }
    // cr 이 빈 문자열·undefined 인 리소스가 있다(acp 와 ae 에는 cr 컬럼이 없다).
    // 그때 from 이 마침 빈 값이면 아무나 통과해 버린다 — 반드시 막는다.
    if (!cr || !from) {
        return false;
    }
    return String(from) === String(cr);
}

exports._creator_bypasses = creator_bypasses;

/**
 * 접근을 판정한다.
 *
 * callback(code, trace) 로 **판정근거**를 함께 준다. 기존 호출부 셋은 두 번째
 * 인자를 무시하므로 그대로 둬도 된다. 지금까지 거부는 '0' 한 글자였고 그 안에
 * 이유가 없어서, 403 이 나면 관리자가 어느 ACP 를 어떻게 고쳐야 할지 알 수
 * 없었다 — 배포 로그 22개 파일에 거부 흔적이 한 줄도 없는 이유이기도 하다.
 */
exports.check = function(request, response, ty, acpiList, access_value, cr, callback) {
    var from = request.headers['x-m2m-origin'];

    function done(code, trace) {
        var t = trace || {};
        t.ty = ty;
        t.op_value = access_value;
        // 관찰 모드면 여기서 '0' 이 '1' 로 바뀐다. 판정 자체는 그대로 두고
        // 내보낼 코드만 바꾼다 — trace 에는 원래 거부 사유가 남는다.
        callback(acp_observe.record_decision(request, code, t), t);
    }

    if(from == usesuperuser || from == ('/'+usesuperuser)) {
        // 수퍼유저는 ACP 를 하나도 보지 않는다. 이 통과는 정책 검증이 아니다.
        done('1', { decided_by: 'superuser', from: from, cr: cr });
    }
    else if (creator_bypasses(ty, cr, from)) {
        done('1', { decided_by: 'creator', from: from, cr: cr });
    }
    else {
        if (ty == '1') { // check selfPrevileges
            var self_acp = false;
            if (acpiList.length == 0) {
                acpiList = [url.parse(request.url).pathname.split('?')[0]];
                self_acp = true;
            }
            security_check_action_pvs(request, response, acpiList, access_value, cr, function (code, trace) {
                var t = trace || {};
                t.path = 'pvs';
                t.self = self_acp;
                done(code, t);
            });
        }
        else if(ty == '23' || ty == '4' || ty == '3') { // cnt or sub --> check parents acpi to AE
            if (acpiList.length == 0) {
                var targetUri = request.url.split('?')[0];
                var targetUri_arr = targetUri.split('/');

                var loop_cnt = 0;
                db_sql.select_acp_cnt(request.db_connection, loop_cnt, targetUri_arr, function (err, results_acpi, found_ri) {
                    if (!err) {
                        if (results_acpi.length == 0) {
                            security_default_check_action(request, response, cr, access_value, done);
                        }
                        else {
                            security_check_action_pv(request, response, results_acpi, cr, access_value, function (code, trace) {
                                var t = trace || {};
                                // 이 리소스가 아니라 **조상**의 acpi 로 판정했다는 사실은
                                // 지금 어디에도 남지 않았다. AE 의 ACP 를 고쳐도 왜 안
                                // 먹는지(중간 컨테이너가 덮어썼다) 를 여기서만 알 수 있다.
                                t.source = 'inherited';
                                t.inherited_from = found_ri || null;
                                done(code, t);
                            });
                        }
                    }
                    else {
                        done('500-1', { decided_by: 'db_error', source: 'inherited' });
                    }
                });
            }
            else {
                security_check_action_pv(request, response, acpiList, cr, access_value, function (code, trace) {
                    var t = trace || {};
                    t.source = 'own';
                    done(code, t);
                });
            }
        }
        else {
            if (acpiList.length == 0) {
                security_default_check_action(request, response, cr, access_value, done);
            }
            else {
                security_check_action_pv(request, response, acpiList, cr, access_value, function (code, trace) {
                    var t = trace || {};
                    t.source = 'own';
                    done(code, t);
                });
            }
        }
    }
};
