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
var acp_eval = require('./acp_eval');

// 원본이 acip 검사 안에서 하던 IP 추출을 그대로 옮겼다.
// _pv (security_check_action_pv) 전용: 원본(91a3f40:security.js:59-61)은
// remoteaddress 헤더가 있으면 그 값으로 클라이언트 IP 를 덮어썼다. _pvs 는
// 이 오버라이드가 없었다(client_ip_of_pvs 참고) — 리뷰에서 지적된 대로, 이 둘을
// 하나로 합치면 헤더로 _pvs 의 acip 제약을 우회할 수 있게 되는 회귀가 생긴다.
function client_ip_of(request) {
    if (request.headers.hasOwnProperty('remoteaddress')) {
        return request.headers.remoteaddress;
    }
    if (request.connection.remoteAddress === '::1') {
        return ip.address();
    }
    return request.connection.remoteAddress.replace('::ffff:', '');
}

// _pvs (security_check_action_pvs) 전용: 원본(91a3f40:security.js:247-252)은
// remoteaddress 헤더를 전혀 보지 않는다. client_ip_of 와 절대 합치지 말 것.
function client_ip_of_pvs(request) {
    if (request.connection.remoteAddress === '::1') {
        return ip.address();
    }
    return request.connection.remoteAddress.replace('::ffff:', '');
}

function ctx_of(request, access_value, cr) {
    return {
        originator: request.headers['x-m2m-origin'],
        acop: parseInt(access_value, 10),
        clientIp: client_ip_of(request),
        now: new Date(),
        creator: cr
    };
}

function ctx_of_pvs(request, access_value, cr) {
    return {
        originator: request.headers['x-m2m-origin'],
        acop: parseInt(access_value, 10),
        clientIp: client_ip_of_pvs(request),
        now: new Date(),
        creator: cr
    };
}

function security_check_action_pv(request, response, acpiList, cr, access_value, callback) {
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

            var ctx = ctx_of(request, access_value, cr);

            if (results_acp.length === 0) {
                callback(acp_eval.evaluateBrokenAcpi(ctx).allowed ? '1' : '0');
                return;
            }

            // KNOWN BEHAVIOR (원본 91a3f40:security.js:42, :186-194): pv 행에 acr 키가
            // 없으면 원본은 그 자리에서 creator 검사로 즉시 응답하고 이후 행은 절대
            // 보지 않는다. evaluatePrivileges 는 privList 전체를 한 번에 평가해야만
            // ipv6_idx leak 을 재현할 수 있으므로(행 단위 호출 불가), 이 "행 단위 즉시
            // 중단"은 별도로 흉내낸다: acr 없는 첫 행 앞까지만 잘라 평가하고, 매치가
            // 없으면 그 행에서 원본과 동일하게 즉시 응답한다. _pvs 는 이 분기가
            // 원본에도 없었으므로 건드리지 않는다.
            var privList = [];
            for (var i = 0; i < results_acp.length; i++) {
                var parsedPv;
                try {
                    // ACCEPTED DIVERGENCE: 원본(91a3f40:security.js:40,45)은 이
                    // JSON.parse 를 try 밖에 두어, pv 가 깨진 JSON 이면 예외가 DB
                    // 콜백 안에서 잡히지 않고 워커를 크래시시켰다. 여기서는 의도적으로
                    // 그 크래시를 재현하지 않고 fail-closed 로 '500-1' 을 반환한다 —
                    // 더 안전하며, pv 는 서버 자신이 JSON.stringify 로만 쓰므로 정상
                    // 운영에서는 도달하지 않는 경로다.
                    parsedPv = JSON.parse(results_acp[i].pv);
                } catch (e) {
                    console.log('[security_check_action_pv] bad pv json: ' + (e.message || e));
                    callback('500-1');
                    return;
                }

                if (!parsedPv || !parsedPv.hasOwnProperty('acr')) {
                    if (acp_eval.evaluatePrivileges(privList, ctx).allowed) {
                        callback('1');
                    } else {
                        callback(acp_eval.evaluateBrokenAcpi(ctx).allowed ? '1' : '0');
                    }
                    return;
                }
                privList.push(parsedPv);
            }

            callback(acp_eval.evaluatePrivileges(privList, ctx).allowed ? '1' : '0');
        });
    });
}

function security_check_action_pvs(request, response, acpiList, access_value, cr, callback) {
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

            var ctx = ctx_of_pvs(request, access_value, cr);

            if (results_acp.length === 0) {
                callback(acp_eval.evaluateBrokenAcpi(ctx).allowed ? '1' : '0');
                return;
            }

            var privList = [];
            for (var i = 0; i < results_acp.length; i++) {
                try {
                    // ACCEPTED DIVERGENCE: 원본(91a3f40:security.js:229,233)은 이
                    // JSON.parse 를 try 밖에 두어, pvs 가 깨진 JSON 이면 예외가 DB
                    // 콜백 안에서 잡히지 않고 워커를 크래시시켰다. 여기서는 의도적으로
                    // 그 크래시를 재현하지 않고 fail-closed 로 '500-1' 을 반환한다 —
                    // 더 안전하며, pvs 는 서버 자신이 JSON.stringify 로만 쓰므로
                    // 정상 운영에서는 도달하지 않는 경로다.
                    privList.push(JSON.parse(results_acp[i].pvs));
                } catch (e) {
                    console.log('[security_check_action_pvs] bad pvs json: ' + (e.message || e));
                    callback('500-1');
                    return;
                }
            }

            callback(acp_eval.evaluatePrivileges(privList, ctx).allowed ? '1' : '0');
        });
    });
}

function security_default_check_action(request, response, cr, access_value, callback) {
    var result = acp_eval.evaluateDefault(ctx_of(request, access_value, cr), useaccesscontrolpolicy);
    callback(result.allowed ? '1' : '0');
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
