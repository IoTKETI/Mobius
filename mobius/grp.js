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
var http = require('http');
var util = require('util');
var moment = require('moment');

var body = require('./body');
var responder = require('./responder');

var db_sql = require('./sql_action');
var outbound = require('./outbound');
var once = require('./once');

function check_mt(request, res_body, callback) {
    var mt = request.mt;

    // The body came from a remote CSE and may not be JSON (proxy error page, truncated response). This runs inside res.on('end'), so a throw would be uncaught; an unreadable body counts as a type mismatch ('0').
    var result;
    try {
        result = JSON.parse(res_body);
    }
    catch (e) {
        console.error('[grp check_mt] 멤버 응답이 JSON 이 아니다: ' + e.message);
        callback('0');
        return;
    }

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

function check_member(request, response, req_count, cse_poa, callback) {
    // The callback can be reached from both the response path and the error path, and both advance the recursion with ++req_count; it must run once.
    callback = once(callback, 'grp check_member ' + req_count);

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
        db_sql.get_ri_sri(request.db_connection, absolute_ri, function (err, results) {
            // On a DB error results is the error object; the input ri is used as is, the same as when no row matches.
            if (err) {
                console.error('[grp check_member] get_ri_sri 실패, 입력한 ri 를 그대로 쓴다: ' + absolute_ri);
            }
            ri = ((err || results.length == 0) ? ri : results[0].ri);
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
                            // This CSE reads and produces JSON only.
                            'Accept': 'application/json',
                            'X-M2M-Origin': request.headers['x-m2m-origin'],
                            'X-M2M-RVI': uservi
                        }
                    };

                    var req = http.request(options, function (res) {
                        // body.read decodes the whole body as UTF-8 so multi-byte characters are not split across chunks.
                        body.read(res, function (err, responseBody) {
                            if (err) {
                                // Member response not received: not counted as a valid member; continue with the next one, as for a non-200 status.
                                console.error('[grp check_member] 멤버 응답을 받지 못했다: ' +
                                              ri + ' — ' + err.message);
                                check_member(request, response, ++req_count, cse_poa, function (code) {
                                    callback(code);
                                });
                                return;
                            }
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

                    // Cut the request when no response arrives; destroying it triggers the error handler below.
                    outbound.arm(req, 'grp member check');
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
    update_route(request.db_connection, cse_poa, function (code) {
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
                else {
                    // A non-'200' code from check_member is passed up so the group creation is answered.
                    callback(code);
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

// macp is mediumtext, so the varchar(200) limit of acpi does not apply; a cap is still needed because the element count check derives from it.
var MACP_MAX_JSON = 2000;

exports.build_grp = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // macp goes through the same access check path as acpi (the group fan-out in app.js passes it to security.check), so it is validated like acpi.
    if (!body_Obj[rootnm].hasOwnProperty('macp')) {
        return build_rest();
    }
    validate_acpi(request, response, body_Obj[rootnm].macp, { maxJson: MACP_MAX_JSON },
        function (code, normalized) {
            if (code) { return callback(code); }
            body_Obj[rootnm].macp = normalized;
            build_rest();
        });

    function build_rest() {
    // body
    resource_Obj[rootnm].mnm = body_Obj[rootnm].mnm;
    resource_Obj[rootnm].mid = remove_duplicated_mid(body_Obj[rootnm].mid);

    // cr is set by the server from the origin header.
    resource_Obj[rootnm].cr = request.headers['x-m2m-origin'];
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
    }
};

