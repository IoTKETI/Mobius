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

function security_check_action_pv(request, response, acpiList, cr, access_value, callback) {
    make_internal_ri(acpiList);
    var ri_list = [];
    get_ri_list_sri(request, response, acpiList, ri_list, 0, function (code) {
        if(code === '200') {
            db_sql.select_acp_in(request.connection, ri_list, function (err, results_acp) {
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
                            var pvObj = JSON.parse(results_acp[i].pv);
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

                                                                if (ipv6_idx == 99) {
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
                                                            var actw_idx = 99;
                                                            for (actw_idx in acco[acco_idx].actw) {
                                                                if (acco[acco_idx].actw.hasOwnProperty(actw_idx)) {
                                                                    var actw_arr = acco[acco_idx].actw[actw_idx].split(' ');
                                                                    for (var d = 0; d < 6; d++) {
                                                                        if (actw_arr[d] != '*' && actw_arr[d] == actw_cur[d].toString()) {
                                                                            actw_permit = 1;
                                                                            break;
                                                                        }
                                                                    }

                                                                    if (actw_permit == 1) {
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
            db_sql.select_acp_in(request.connection, ri_list, function (err, results_acp) {
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
                            var pvsObj = JSON.parse(results_acp[i].pvs);
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

                                                            if (ipv6_idx == 99) {
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
                                                        var actw_idx = 99;
                                                        for (actw_idx in acco[acco_idx].actw) {
                                                            if (acco[acco_idx].actw.hasOwnProperty(actw_idx)) {
                                                                var actw_arr = acco[acco_idx].actw[actw_idx].split(' ');
                                                                for (var d = 0; d < 6; d++) {
                                                                    if (actw_arr[d] != '*' && actw_arr[d] == actw_cur[d].toString()) {
                                                                        actw_permit = 1;
                                                                        break;
                                                                    }
                                                                }

                                                                if (actw_permit == 1) {
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
        else if(ty == '33' || ty == '23' || ty == '4') { // cnt or sub --> check parents acpi to AE
            if (acpiList.length == 0) {
                var targetUri = request.url.split('?')[0];
                var targetUri_arr = targetUri.split('/');

                var loop_cnt = 0;
                db_sql.select_acp_cnt(request.connection, loop_cnt, targetUri_arr, function (err, results_acpi) {
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
