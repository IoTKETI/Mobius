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
function client_ip_of(request) {
    if (request.headers.hasOwnProperty('remoteaddress')) {
        return request.headers.remoteaddress;
    }
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

            var privList = [];
            for (var i = 0; i < results_acp.length; i++) {
                try {
                    privList.push(JSON.parse(results_acp[i].pv));
                } catch (e) {
                    console.log('[security_check_action_pv] bad pv json: ' + (e.message || e));
                    callback('500-1');
                    return;
                }
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

            var ctx = ctx_of(request, access_value, cr);

            if (results_acp.length === 0) {
                callback(acp_eval.evaluateBrokenAcpi(ctx).allowed ? '1' : '0');
                return;
            }

            var privList = [];
            for (var i = 0; i < results_acp.length; i++) {
                try {
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
