/**
 * Copyright (c) 2015, OCEAN
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
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var http = require('http');
var util = require('util');
var moment = require('moment');

var responder = require('./responder');


function check_mt(body_type, mt, res_body, callback) {
    if (body_type == 'xml') {
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(res_body, function (err, result) {
            if (!err) {
                for (var prop in result) {
                    if(result.hasOwnProperty(prop)) {
                        if (result[prop].ty == mt) {
                            callback('1');
                            return '1';
                        }
                        else {
                            callback('0');
                            return '0';
                        }
                    }
                }
            }
            else {
                callback('0');
                return '0';
            }
        });
    }
    else { // json
        var result = JSON.parse(res_body);
        for (var prop in result) {
            if(result.hasOwnProperty(prop)) {
                if (result[prop].ty == mt) {
                    callback('1');
                    return '1';
                }
                else {
                    callback('0');
                    return '0';
                }
            }
        }
    }
}

function check_member(request, response, mt, req_count, mid, cse_poa, valid_mid, callback) {
    if(req_count == mid.length) {
        callback(valid_mid);
    }
    else {
        var ri = mid[req_count];
        var target_cb = ri.split('/')[1];
        var hostname = 'localhost';
        var port = usecsebaseport;
        if(target_cb != usecsebase) {
            if(cse_poa[target_cb]) {
                hostname = url.parse(cse_poa[target_cb]).hostname;
                port = url.parse(cse_poa[target_cb]).port;
            }
            else {
                check_member(request, response, mt, ++req_count, mid, cse_poa, valid_mid, function (valid_mid) {
                    callback(valid_mid);
                });
                return;
            }
        }

        var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
        var options = {
            hostname: hostname,
            port: port,
            path: ri,
            method: 'get',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/'+request.headers.usebodytype,
                'X-M2M-Origin': usecseid
            }
        };

        var responseBody = '';
        var req = http.request(options, function (res) {
            //res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                if(res.statusCode == 200) {
                    check_mt(request.headers.usebodytype, mt, responseBody, function (rsc) {
                        if(rsc == '1') {
                            valid_mid.push(ri);
                        }

                        check_member(request, response, mt, ++req_count, mid, cse_poa, valid_mid, function (valid_mid) {
                            callback(valid_mid);
                        });
                    });
                }
                else {
                    check_member(request, response, mt, ++req_count, mid, cse_poa, valid_mid, function (valid_mid) {
                        callback(valid_mid);
                    });
                }
            });
        });

        req.on('error', function (e) {
            if (e.message != 'read ECONNRESET') {
                console.log('[check_member] problem with request: ' + e.message);
            }

            check_member(request, response, mt, ++req_count, mid, cse_poa, valid_mid, function (valid_mid) {
                callback(valid_mid);
            });
        });

        req.write('');
        req.end();
    }
}


function check_mtv(request, response, mt, mid, callback) {
    update_route(function (cse_poa) {
        var req_count = 0;
        var valid_mid = [];
        check_member(request, response, mt, req_count, mid, cse_poa, valid_mid, function (results_mid) {
            if (results_mid.length == mid.length) {
                callback('1', results_mid);
            }
            else {
                callback('0', results_mid);
            }
        });
    });
/*
    var sql = util.format("select ri from lookup where where ty = \'%s\' and ri in ("+JSON.stringify(mid).replace('[','').replace(']','')+")", mt);
    db.getResult(sql, '', function (err, results_mid) {
        if(!err) {
            if (results_mid.length == mid.length) {
                callback('1', results_mid);
            }
            else {
                callback('0', results_mid);
            }
        }
        else {
            callback('2', results_mid);
        }
    });*/
}

function remove_duplicated_mid(mid) {
    var temp_mid = {};
    for(var id in mid) {
        if (mid.hasOwnProperty(id)) {
            temp_mid[mid[id]] = mid[id];
        }
    }

    mid = [];
    for(id in temp_mid) {
        if (temp_mid.hasOwnProperty(id)) {
            mid.push(temp_mid[id]);
        }
    }

    return mid;
}

exports.build_grp = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // check NP
    if(body_Obj[rootnm].ty) {
        body_Obj = {};
        body_Obj['dbg'] = 'ty as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ri) {
        body_Obj = {};
        body_Obj['dbg'] = 'ri as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].pi) {
        body_Obj = {};
        body_Obj['dbg'] = 'pi as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ct) {
        body_Obj = {};
        body_Obj['dbg'] = 'ct as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].lt) {
        body_Obj = {};
        body_Obj['dbg'] = 'lt as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].st) {
        body_Obj = {};
        body_Obj['dbg'] = 'st as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].cnm) {
        body_Obj = {};
        body_Obj['dbg'] = 'cni as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].mtv) {
        body_Obj = {};
        body_Obj['dbg'] = 'cbs as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    // check M
    if(!body_Obj[rootnm].mnm) {
        body_Obj = {};
        body_Obj['dbg'] = 'mnm as M Tag should be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(!body_Obj[rootnm].mid) {
        body_Obj = {};
        body_Obj['dbg'] = 'mid as M Tag should be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    // body
    resource_Obj[rootnm].mnm = body_Obj[rootnm].mnm;
    resource_Obj[rootnm].mid = remove_duplicated_mid(body_Obj[rootnm].mid);

    make_sp_relative((body_Obj[rootnm].acpi) ? body_Obj[rootnm].acpi : []);
    resource_Obj[rootnm].acpi = (body_Obj[rootnm].acpi) ? body_Obj[rootnm].acpi : [];
    resource_Obj[rootnm].et = (body_Obj[rootnm].et) ? body_Obj[rootnm].et : resource_Obj[rootnm].et;
    resource_Obj[rootnm].lbl = (body_Obj[rootnm].lbl) ? body_Obj[rootnm].lbl : [];
    resource_Obj[rootnm].at = (body_Obj[rootnm].at) ? body_Obj[rootnm].at : [];
    resource_Obj[rootnm].aa = (body_Obj[rootnm].aa) ? body_Obj[rootnm].aa : [];

    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];
    resource_Obj[rootnm].macp = (body_Obj[rootnm].macp) ? body_Obj[rootnm].macp : [];
    resource_Obj[rootnm].mt = (body_Obj[rootnm].mt) ? body_Obj[rootnm].mt : '0';
    resource_Obj[rootnm].csy = (body_Obj[rootnm].csy) ? body_Obj[rootnm].csy : '1'; // default : ABANDON_MEMBER
    resource_Obj[rootnm].cnm = resource_Obj[rootnm].mid.length.toString();
    resource_Obj[rootnm].gn = (body_Obj[rootnm].gn) ? body_Obj[rootnm].gn : '';

    if(parseInt(resource_Obj[rootnm].mnm, 10) < parseInt(resource_Obj[rootnm].cnm)) {
        body_Obj = {};
        body_Obj['dbg'] = 'MAX_NUMBER_OF_MEMBER_EXCEEDED';
        responder.response_result(request, response, 400, body_Obj, 6010, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if (resource_Obj[rootnm].et != '') {
        if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            body_Obj = {};
            body_Obj['dbg'] = 'expiration time is before now';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }

    if(resource_Obj[rootnm].mt != '0') {
        check_mtv(request, response, resource_Obj[rootnm].mt, resource_Obj[rootnm].mid, function(rsc, results_mid) {
            if(rsc == '0') { // mt inconsistency
                if(results_mid.length == '0') {
                    body_Obj = {};
                    body_Obj['dbg'] = 'can not create group because mid is empty after validation check of mt requested';
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    callback('0', body_Obj);
                    return '0';
                }
                else {
                    if (resource_Obj[rootnm].csy == '1') { // ABANDON_MEMBER
                        resource_Obj[rootnm].mid = results_mid;
                        resource_Obj[rootnm].cnm = body_Obj[rootnm].mid.length.toString();
                        resource_Obj[rootnm].mtv = 'true';
                    }
                    else if (resource_Obj[rootnm].csy == '2') { // ABANDON_GROUP
                        body_Obj = {};
                        body_Obj['dbg'] = 'can not create group because csy is ABANDON_GROUP when MEMBER_TYPE_INCONSISTENT';
                        responder.response_result(request, response, 400, body_Obj, 6011, request.url, body_Obj['dbg']);
                        callback('0', body_Obj);
                        return '0';
                    }
                    else { // SET_MIXED
                        resource_Obj[rootnm].mt = '0';
                        resource_Obj[rootnm].mtv = 'false';
                    }
                }
            }
            else if(rsc == '1') {
                resource_Obj[rootnm].mtv = 'true';
            }
            else { // db error
                body_Obj = {};
                    body_Obj['dbg'] = results_mid.message;
                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                callback('0', body_Obj);
                return '0';
            }

            callback('1', resource_Obj);
        });
    }
    else {
        resource_Obj[rootnm].mtv = 'false';
        callback('1', resource_Obj);
    }
};



exports.modify_grp = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // todd
    // check NP
    if(body_Obj[rootnm].rn) {
        body_Obj = {};
        body_Obj['dbg'] = 'rn as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ty) {
        body_Obj = {};
        body_Obj['dbg'] = 'ty as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ri) {
        body_Obj = {};
        body_Obj['dbg'] = 'ri as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].pi) {
        body_Obj = {};
        body_Obj['dbg'] = 'pi as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ct) {
        body_Obj = {};
        body_Obj['dbg'] = 'ct as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].lt) {
        body_Obj = {};
        body_Obj['dbg'] = 'lt as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].st) {
        body_Obj = {};
        body_Obj['dbg'] = 'st as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].cr) {
        body_Obj = {};
        body_Obj['dbg'] = 'cr as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].mt) {
        body_Obj = {};
        body_Obj['dbg'] = 'mt as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].cnm) {
        body_Obj = {};
        body_Obj['dbg'] = 'cnm as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].mtv) {
        body_Obj = {};
        body_Obj['dbg'] = 'mtv as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].csy) {
        body_Obj = {};
        body_Obj['dbg'] = 'csy as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    // check M

    // body

    update_body(rootnm, body_Obj, resource_Obj); // (attr == 'aa' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' || attr == 'nu' || attr == 'mid' || attr == 'macp')

    resource_Obj[rootnm].st = (parseInt(resource_Obj[rootnm].st, 10) + 1).toString();

    var cur_d = new Date();
    resource_Obj[rootnm].lt = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');

    if (resource_Obj[rootnm].et != '') {
        if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            body_Obj = {};
            body_Obj['dbg'] = 'expiration time is before now';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }

    if(body_Obj[rootnm].mid) {
        resource_Obj[rootnm].mid = body_Obj[rootnm].mid;

        if(resource_Obj[rootnm].mt != '0') {
			// [TIM] error, request, response parameters missing
            check_mtv(request, response, resource_Obj[rootnm].mt, resource_Obj[rootnm].mid, function(rsc, results_mid) {
                if(rsc == '0') { // mt inconsistency
                    if(results_mid.length == '0') {
                        body_Obj = {};
                                    body_Obj['dbg'] = 'can not create group because mid is empty after validation check of mt requested';
                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                        callback('0', body_Obj);
                        return '0';
                    }
                    else {
                        if (resource_Obj[rootnm].csy == '1') { // ABANDON_MEMBER
                            resource_Obj[rootnm].mid = results_mid;
                            resource_Obj[rootnm].cnm = body_Obj[rootnm].mid.length.toString();
                            resource_Obj[rootnm].mtv = 'true';
                        }
                        else if (resource_Obj[rootnm].csy == '2') { // ABANDON_GROUP
                            body_Obj = {};
                                            body_Obj['dbg'] = 'can not create group because csy is ABANDON_GROUP when MEMBER_TYPE_INCONSISTENT';
                            responder.response_result(request, response, 400, body_Obj, 6011, request.url, body_Obj['dbg']);
                            callback('0', body_Obj);
                            return '0';
                        }
                        else { // SET_MIXED
                            resource_Obj[rootnm].mt = '0';
                            resource_Obj[rootnm].mtv = 'false';
                        }
                    }
                }
                else if(rsc == '1') {
                    resource_Obj[rootnm].mtv = 'true';
                }
                else { // db error
                    body_Obj = {};
                            body_Obj['dbg'] = results_mid.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    callback('0', body_Obj);
                    return '0';
                }

                callback('1', resource_Obj);
            });
        }
        else {
            resource_Obj[rootnm].mtv = 'false';
            callback('1', resource_Obj);
        }
    }
    else {
        callback('1', resource_Obj);
    }
};

