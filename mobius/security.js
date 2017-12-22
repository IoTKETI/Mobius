/**
 * Copyright (c) 2017, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2016, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var util = require('util');
var db_sql = require('./sql_action');

function security_check_action_pv(request, response, acpiList, cr, access_value, callback) {
    make_internal_ri(acpiList);
    var ri_list = [];
    get_ri_list_sri(request, response, acpiList, ri_list, 0, function (ri_list, request, response) {
        db_sql.select_acp_in(ri_list, function (err, results_acp) {
            if (!err) {
                if (results_acp.length == 0) {
                    if (request.headers['x-m2m-origin'] == cr) {
                        callback('1', request, response);
                    }
                    else {
                        callback('0', request, response);
                    }
                }
                else {
                    for (var i = 0; i < results_acp.length; i++) {
                        var pvObj = JSON.parse(results_acp[i].pv);
                        var from = request.headers['x-m2m-origin'];
                        for (var index in pvObj.acr) {
                            if (pvObj.acr.hasOwnProperty(index)) {
                                try {
                                    var re = new RegExp('^' + from + '$');
                                    for (var acor_idx in pvObj.acr[index].acor) {
                                        if (pvObj.acr[index].acor.hasOwnProperty(acor_idx)) {
                                            if (pvObj.acr[index].acor[acor_idx].match(re) || pvObj.acr[index].acor[acor_idx] == 'all' || pvObj.acr[index].acor[acor_idx] == '*') {
                                                if ((pvObj.acr[index].acop.toString() & access_value) == access_value) {
                                                    callback('1', request, response);
                                                    return '1';
                                                }
                                            }
                                        }
                                    }
                                }
                                catch (e) {
                                    console.log('[security_check_action_pv]' + e);
                                }
                            }
                        }
                    }
                    callback('0', request, response);
                }
            }
            else {
                console.log('query error: ' + results_acp.message);
                callback('0', request, response);
            }
        });
    });
}

function security_check_action_pvs(request, response, acpiList, cr, access_value, callback) {
    make_internal_ri(acpiList);
    var ri_list = [];
    get_ri_list_sri(request, response, acpiList, ri_list, 0, function (ri_list, request, response) {
        db_sql.select_acp_in(ri_list, function (err, results_acp) {
            if (!err) {
                if (results_acp.length == 0) {
                    if (request.headers['x-m2m-origin'] == cr) {
                        callback('1', request, response);
                    }
                    else {
                        callback('0', request, response);
                    }
                }
                else {
                    for (var i = 0; i < results_acp.length; i++) {
                        var pvsObj = JSON.parse(results_acp[i].pvs);
                        var from = request.headers['x-m2m-origin'];
                        for (var index in pvsObj.acr) {
                            if (pvsObj.acr.hasOwnProperty(index)) {
                                try {
                                    var re = new RegExp('^' + from + '$');
                                    for (var acor_idx in pvsObj.acr[index].acor) {
                                        if (pvsObj.acr[index].acor.hasOwnProperty(acor_idx)) {
                                            if (pvsObj.acr[index].acor[acor_idx].match(re) || pvsObj.acr[index].acor[acor_idx] == 'all' || pvsObj.acr[index].acor[acor_idx] == '*') {
                                                if ((pvsObj.acr[index].acop.toString() & access_value) == access_value) {
                                                    callback('1', request, response);
                                                    return '1';
                                                }
                                            }
                                        }
                                    }
                                }
                                catch (e) {
                                    console.log('[security_check_action_pvs]' + e);
                                }
                            }
                        }
                    }
                    callback('0', request, response);
                }
            }
            else {
                console.log('query error: ' + results_acp.message);
                callback('0', request, response);
            }
        });
    });
}

function security_default_check_action(request, response, cr, access_value, callback) {
    if(useaccesscontrolpolicy == 'enable') {
        if (request.headers['x-m2m-origin'] == cr) {
            callback('1', request, response);
        }
        else {
            callback('0', request, response);
        }
    }
    else {
        if (request.headers['x-m2m-origin'] == cr) {
            callback('1', request, response);
        }
        else {
            if (access_value == '1' || access_value == '2' || access_value == '32') {
                callback('1', request, response);
            }
            else {
                callback('0', request, response);
            }
        }
    }
}

exports.check = function(request, response, ty, acpiList, access_value, cr, callback) {
    if(request.headers['x-m2m-origin'] == usesuperuser || request.headers['x-m2m-origin'] == ('/'+usesuperuser)) {
        callback('1', request, response);
        return '1';
    }

    // if(request.headers['x-m2m-origin'] == cr) {
    //     callback('1');
    //     return '1';
    // }

    if(ty == '1') { // check selfPrevileges
        acpiList = [url.parse(request.url).pathname.split('?')[0]];
        security_check_action_pvs(request, response, acpiList, cr, access_value, function (rsc, request, response) {
            callback(rsc, request, response);
            return rsc;
        });
    }
    else {
        if (acpiList.length == 0) {
            // we decide to permit to everybody in this case which is not set accessControlPolicy
            // this policy may change to not permit later
            // 2017-12-06 we decide to not permit to everybody for security interop event for oneM2M in korea
            // and we allowed retrieve and create right to observer only

            if(ty == '3') { // cnt
                var pi_list = [];
                var pi = '';
                var targetUri = request.url.split('?')[0];
                var targetUri_arr = targetUri.split('/');

                var loop_cnt = 0;
                db_sql.select_acp_cnt(loop_cnt, targetUri_arr, function (err, results_acpi) {
                    if(!err) {
                        if(results_acpi.length == 0) {
                            security_default_check_action(request, response, cr, access_value, function (rsc, request, response) {
                                callback(rsc, request, response);
                                return rsc;
                            });
                        }
                        else {
                            security_check_action_pv(request, response, results_acpi, cr, access_value, function (rsc, request, response) {
                                callback(rsc, request, response);
                                return rsc;
                            });
                        }
                    }
                    else {
                        console.log('query error: ');
                        callback('0', request, response);
                        return '0';
                    }
                });
            }
            else {
                security_default_check_action(request, response, cr, access_value, function (rsc, request, response) {
                    callback(rsc, request, response);
                    return rsc;
                });
            }
        }
        else {
            security_check_action_pv(request, response, acpiList, cr, access_value, function (rsc, request, response) {
                callback(rsc, request, response);
                return rsc;
            });
        }
    }
};
