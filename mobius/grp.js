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

var body = require('./body');
var responder = require('./responder');

var db_sql = require('./sql_action');
var outbound = require('./outbound');
var once = require('./once');

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
        // 원격 CSE 가 준 응답 본문이라 JSON 이 아닐 수 있다 — 앞단 프록시의 HTML
        // 오류 페이지, 잘린 응답, Accept 를 무시한 XML 등. 게다가 이 분기는
        // cbor 요청도 함께 삼키는데, check_member 는 Accept: application/cbor 로
        // GET 하므로 그때는 확정적으로 던진다.
        //
        // 여기는 res.on('end') 안이라 던지면 잡을 곳이 없어 워커가 죽는다.
        // 멤버 타입을 확인하지 못한 것이므로 '0'(불일치)으로 다룬다.
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
}

function check_member(request, response, req_count, cse_poa, callback) {
    // 이 콜백은 응답 경로(res.on('end'))와 에러 경로(req.on('error')) 양쪽에서
    // 불릴 수 있다. 둘 다 ++req_count 로 **재귀를 진행시킨다.**
    //
    // 둘 다 발화하면 재귀가 두 갈래로 갈라져 각자 끝까지 돌고 각자 콜백을
    // 부른다. 그러면 그룹 생성 응답이 두 번 나가고, 두 번째가 이미 반납된
    // 커넥션과 null 이 된 request 를 만져 워커가 죽는다.
    // outbound.arm 이 요청을 끊으면 응답 직후 error 가 뜰 수 있어
    // 이 조합은 실제로 가능하다. fopt.js 의 request_to_member 가
    // 같은 이유로 같은 처방을 쓴다.
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
            // err 를 보지 않았다. db 계층은 실패할 때 callback(true, err) 로 부르므로
            // results 가 에러 객체다 — results.length 가 undefined 라 `undefined == 0`
            // 이 false 가 되고, 곧바로 results[0].ri 에서 워커가 죽었다.
            // 같은 호출을 하는 fopt.js 는 if(!err) 로 감싸고 있다.
            //
            // 조회에 실패하면 원래 값을 그대로 쓴다 — results.length == 0 일 때와 같다.
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
                            'Accept': 'application/' + request.usebodytype,
                            'X-M2M-Origin': request.headers['x-m2m-origin'],
                            'X-M2M-RVI': uservi
                        }
                    };

                    var req = http.request(options, function (res) {
                        // 여기도 `//res.setEncoding('utf8');` 가 주석 처리된 채
                        // `responseBody += chunk` 로 모으고 있었다. fopt.js 와
                        // 같은 결함이다 — 조각마다 따로 디코드되어 멤버 응답의
                        // 멀티바이트가 U+FFFD 로 깨진다.
                        //
                        // 이쪽은 check_mt 가 멤버 **타입**만 보므로 지금까지
                        // 실해가 드러나지 않았을 것이다. 타입은 숫자다.
                        // 그래도 고친다 — 한 줄 주석으로 조용히 깨지는 구조를
                        // 남겨 두면 다음에 본문을 쓸 때 같은 일이 난다.
                        body.read(res, function (err, responseBody) {
                            if (err) {
                                // 멤버 응답을 못 읽었다. 유효 멤버로 세지 않고
                                // 다음 멤버로 간다 — statusCode 가 200 이 아닐 때와
                                // 같은 처리다.
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

                    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
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
                    // 예전에는 이 else 가 없어, check_member 가 '200' 이 아닌
                    // 코드를 주면 콜백이 그대로 사라졌다. 그러면 그룹 생성
                    // 요청이 응답 없이 매달리고 커넥션도 반납되지 않는다 —
                    // 크래시가 아니라 워커 재시작도 안 걸리는 조용한 고갈이다.
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

// macp 는 mediumtext 라 acpi 의 varchar(200) 한도가 적용되지 않는다.
// 그래도 상한은 둔다 — 개수 검사가 이 값에서 나오고, 그것이 없으면
// 배열 하나로 질의 수천 건을 만들 수 있다.
var MACP_MAX_JSON = 2000;

exports.build_grp = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // macp 는 acpi 와 같은 길로 권한 검사에 들어간다 — app.js 의 그룹 팬아웃이
    // security.check 에 macp 를 그대로 넘긴다. 그래서 acpi 와 같은 검증이
    // 필요하다. 안 하면 원소에 숫자를 하나 넣는 것만으로 make_internal_ri 가
    // 던져 **워커가 죽었다**(그 fanOutPoint 를 치는 순간).
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

    // cr 은 서버가 정한다 — 이유는 mobius/cnt.js 의 같은 자리 주석 참조.
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

