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
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var http = require('http');
var util = require('util');
var moment = require('moment');

var responder = require('./responder');

var db_sql = require('./sql_action');

function check_mt(request, res_body, callback) {
    var body_type = request.usebodytype;
    var mt = request.mt;

    if (body_type == 'xml') {
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(res_body, function (err, result) {
            if (!err) {
                for (var prop in result) {
                    if(result.hasOwnProperty(prop)) {
                        if (result[prop].ty == mt) {
                            result = null;
                            callback('1');
                            return;
                        }
                    }
                }
                result = null;
                callback('0');
            }
            else {
                result = null;
                callback('0');
            }
        });
    }
    else { // json
        var result = JSON.parse(res_body);
        for (var prop in result) {
            if(result.hasOwnProperty(prop)) {
                if (result[prop].ty == mt) {
                    result = null;
                    callback('1');
                    return;
                }
            }
        }
        result = null;
        callback('0');
    }
}

function check_member(request, response, req_count, cse_poa, callback) {
    if(req_count >= request.mid.length) {
        callback('200');
    }
    else {
        var ri = request.mid[req_count];
        if (ri.charAt(0) != '/') {
            var absolute_ri = '/' + ri;
        }
        else {
            absolute_ri = ri.replace(/\/\/[^\/]+\/?/, '\/');
            absolute_ri = absolute_ri.replace(/\/[^\/]+\/?/, '/');
        }
        db_sql.get_ri_sri(request.connection, absolute_ri, function (err, results) {
            ri = ((results.length == 0) ? ri : results[0].ri);
            var target_cb = ri.split('/')[1];
            if (target_cb != usecsebase) {
                if (cse_poa[target_cb]) {
                    var options = {
                        hostname: url.parse(cse_poa[target_cb]).hostname,
                        port: url.parse(cse_poa[target_cb]).port,
                        path: ri,
                        method: 'get',
                        headers: {
                            'X-M2M-RI': require('shortid').generate(),
                            'Accept': 'application/' + request.usebodytype,
                            'X-M2M-Origin': request.headers['x-m2m-origin'],
                            'X-M2M-RVI': uservi
                        }
                    };

                    var responseBody = '';
                    var req = http.request(options, function (res) {
                        //res.setEncoding('utf8');
                        res.on('data', function (chunk) {
                            responseBody += chunk;
                        });

                        res.on('end', function () {
                            if (res.statusCode == 200) {
                                check_mt(request, responseBody, function (rsc) {
                                    if (rsc == '1') {
                                        request.valid_mid.push(ri);
                                    }

                                    check_member(request, response, ++req_count, cse_poa, function (code) {
                                        callback(code);
                                    });
                                });
                            }
                            else {
                                check_member(request, response, ++req_count, cse_poa, function (code) {
                                    callback(code);
                                });
                            }
                        });
                    });

                    req.on('error', function (e) {
                        if (e.message != 'read ECONNRESET') {
                            console.log('[check_member] problem with request: ' + e.message);
                        }

                        check_member(request, response, ++req_count, cse_poa, function (code) {
                            callback(code);
                        });
                    });

                    req.write('');
                    req.end();
                }
                else {
                    check_member(request, response, ++req_count, cse_poa, function (code) {
                        callback(code);
                    });
                }
            }
            else {
                check_member(request, response, ++req_count, cse_poa, function (code) {
                    callback(code);
                });
            }
        });
    }
}


function check_mtv(request, response, resource_Obj, callback) {
    var cse_poa = {};
    update_route(request.connection, cse_poa, function (code) {
        if(code === '200') {
            var req_count = 0;
            var rootnm = Object.keys(resource_Obj)[0];
            var mid = resource_Obj[rootnm].mid;
            make_internal_ri(mid);
            request.mid = mid;
            request.mt = resource_Obj[Object.keys(resource_Obj)[0]].mt;
            request.valid_mid = [];
            check_member(request, response, req_count, cse_poa, function (code) {
                if (code === '200') {
                    if (request.valid_mid.length == mid.length) {
                        if (resource_Obj[rootnm].csy == '1') { // ABANDON_MEMBER
                            resource_Obj[rootnm].mid = JSON.parse(JSON.stringify(request.valid_mid));
                            resource_Obj[rootnm].cnm = request.valid_mid.length.toString();
                            resource_Obj[rootnm].mtv = 'true';
                            callback('200');
                        }
                        else if (resource_Obj[rootnm].csy == '2') { // ABANDON_GROUP
                            callback('400-34');
                        }
                        else { // SET_MIXED
                            resource_Obj[rootnm].mt = '0';
                            resource_Obj[rootnm].mtv = 'false';
                            callback('200');
                        }
                    }
                    else {
                        resource_Obj[rootnm].mtv = 'true';
                        callback('200');
                    }
                }
            });
        }
        else {
            callback(code);
        }
    });
}

global.remove_duplicated_mid = function(mid) {
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
};

exports.build_grp = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].mnm = body_Obj[rootnm].mnm;
    resource_Obj[rootnm].mid = remove_duplicated_mid(body_Obj[rootnm].mid);

    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];
    resource_Obj[rootnm].macp = (body_Obj[rootnm].macp) ? body_Obj[rootnm].macp : [];
    resource_Obj[rootnm].mt = (body_Obj[rootnm].mt) ? body_Obj[rootnm].mt : '0';
    resource_Obj[rootnm].csy = (body_Obj[rootnm].csy) ? body_Obj[rootnm].csy : '1'; // default : ABANDON_MEMBER
    resource_Obj[rootnm].cnm = resource_Obj[rootnm].mid.length.toString();
    resource_Obj[rootnm].gn = (body_Obj[rootnm].gn) ? body_Obj[rootnm].gn : '';

    if(parseInt(resource_Obj[rootnm].mnm, 10) < parseInt(resource_Obj[rootnm].cnm)) {
        callback('400-33');
        return;
    }

    if(resource_Obj[rootnm].mt != '0') {
        check_mtv(request, response, resource_Obj, function(code) {
            if(code === '200') {
                request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
                resource_Obj = null;

                callback(code);
            }
            else {
                callback(code);
            }
        });
    }
    else {
        resource_Obj[rootnm].mtv = 'false';

        request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));

        callback('200');
    }
};



// exports.modify_grp = function(request, response, resource_Obj, body_Obj, callback) {
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
//     var cur_d = new Date();
//     resource_Obj[rootnm].lt = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
//
//     if (resource_Obj[rootnm].et != '') {
//         if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
//             body_Obj = {};
//             body_Obj['dbg'] = 'expiration time is before now';
//             responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//             callback('0', resource_Obj);
//             return '0';
//         }
//     }
//
//     if(body_Obj[rootnm].mid) {
//         resource_Obj[rootnm].mid = body_Obj[rootnm].mid;
//
//         if(resource_Obj[rootnm].mt != '0') {
//             check_mtv(resource_Obj[rootnm].mt, resource_Obj[rootnm].mid, function(rsc, results_mid) {
//                 if(rsc == '0') { // mt inconsistency
//                     if(results_mid.length == '0') {
//                         body_Obj = {};
//                                     body_Obj['dbg'] = 'can not create group because mid is empty after validation check of mt requested';
//                         responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//                         callback('0', body_Obj);
//                         return '0';
//                     }
//                     else {
//                         if (resource_Obj[rootnm].csy == '1') { // ABANDON_MEMBER
//                             resource_Obj[rootnm].mid = results_mid;
//                             resource_Obj[rootnm].cnm = body_Obj[rootnm].mid.length.toString();
//                             resource_Obj[rootnm].mtv = 'true';
//                         }
//                         else if (resource_Obj[rootnm].csy == '2') { // ABANDON_GROUP
//                             body_Obj = {};
//                                             body_Obj['dbg'] = 'can not create group because csy is ABANDON_GROUP when MEMBER_TYPE_INCONSISTENT';
//                             responder.response_result(request, response, 400, body_Obj, 6011, request.url, body_Obj['dbg']);
//                             callback('0', body_Obj);
//                             return '0';
//                         }
//                         else { // SET_MIXED
//                             resource_Obj[rootnm].mt = '0';
//                             resource_Obj[rootnm].mtv = 'false';
//                         }
//                     }
//                 }
//                 else if(rsc == '1') {
//                     resource_Obj[rootnm].mtv = 'true';
//                 }
//                 else { // db error
//                     body_Obj = {};
//                             body_Obj['dbg'] = results_mid.message;
//                     responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
//                     callback('0', body_Obj);
//                     return '0';
//                 }
//
//                 callback('1', resource_Obj);
//             });
//         }
//         else {
//             resource_Obj[rootnm].mtv = 'false';
//             callback('1', resource_Obj);
//         }
//     }
//     else {
//         callback('1', resource_Obj);
//     }
// };

