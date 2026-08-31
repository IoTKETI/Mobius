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

var util = require('util');
var url = require('url');
var http = require('http');
var moment = require('moment');

var body = require('./body');
var responder = require('./responder');
var resource = require('./resource');

var db_sql = require('./sql_action');
var outbound = require('./outbound');
var once = require('./once');

// body_type 인자를 걷어냈다 (2026-08-31). json 전용이 되면서 이 함수의
// xml 분기가 죽었고, 넘어오던 값도 언제나 request.usebodytype = 'json' 이었다.
function check_body(res, res_body, callback) {
    var retrieve_Obj = {};

    // 멤버가 준 응답 본문이다. JSON 이 아닐 수 있다 — 앞단 프록시의 HTML
    // 오류 페이지, 빈 본문, 잘린 응답 등. 여기는 res.on('end') 안이라
    // 던지면 잡을 곳이 없어 uncaught exception 이 되고 워커가 죽는다.
    var result;
    try {
        result = JSON.parse(res_body);
    }
    catch (e) {
        console.error('[fopt check_body] 멤버 응답이 JSON 이 아니다 (' + res.req.path + '): ' + e.message);
        callback('0');
        return '0';
    }

    if(res.req.path.charAt(0) == '/') {
        retrieve_Obj.fr = res.req.path.replace('/', '');
    }
    else {
        retrieve_Obj.fr = res.req.path;
    }

    if(res.headers.hasOwnProperty('x-m2m-rsc')) {
        retrieve_Obj.rsc = res.headers['x-m2m-rsc'];
    }

    if(res.headers.hasOwnProperty('x-m2m-ri')) {
        retrieve_Obj.rqi = res.headers['x-m2m-ri'];
    }

    if(res.headers.hasOwnProperty('x-m2m-rvi')) {
        retrieve_Obj.rvi = res.headers['x-m2m-rvi'];
    }

    retrieve_Obj.pc = result;
    callback('1', retrieve_Obj);
    return '1';
}

function request_to_member(request, hostname, port, ri, agr, callback) {
    // 이 콜백은 응답 경로(res.on('end'))와 에러 경로(req.on('error')) 양쪽에서
    // 불릴 수 있다. 두 번 불리면 팬아웃 재귀가 두 갈래로 갈라져 최종 응답이
    // 두 번 나가고 워커가 죽는다.
    callback = once(callback, 'fopt request_to_member ' + ri);

    var ri_prefix = request.url.split('/fopt')[1];

    var options = {
        hostname: hostname,
        port: port,
        path: ri + ri_prefix,
        method: request.method,
        headers: request.headers
    };

    var req = http.request(options, function (res) {
        // 예전에는 여기서 `responseBody += chunk` 로 모았고, 바로 위의
        // `//res.setEncoding('utf8');` 는 **주석 처리되어 있었다.**
        // 그래서 조각마다 따로 디코드되어 멤버 응답의 한글이 깨졌다.
        //
        // 실측 재현 — 멤버가 보낸 con 이 "온도 25도, 습도 60%" 일 때:
        //     JSON.parse : 성공
        //     con        : "���도 25도, 습도 60%"
        //
        // **파싱이 성공한다**는 것이 고약하다. U+FFFD 는 JSON 문자열로 멀쩡하니
        // 에러가 나지 않고, 틀린 값이 그대로 집계(agr)에 들어간다.
        // 팬아웃 결과를 받는 쪽은 무엇이 틀렸는지 알 방법이 없다.
        body.read(res, function (err, responseBody) {
            if (err) {
                // 상한 초과·중간 끊김·스트림 오류. 멤버 하나의 실패가 그룹
                // 전체를 막지 않는다는 아래 방침을 그대로 따른다.
                console.error('[fopt_member] 멤버 응답을 받지 못해 결과에서 제외한다: ' +
                              ri + ' — ' + err.message);
                callback('200');
                return;
            }
            check_body(res, responseBody, function (rsc, retrieve_Obj) {
                if (rsc == '1') {
                    agr[retrieve_Obj.fr] = JSON.parse(JSON.stringify(retrieve_Obj));
                    retrieve_Obj = null;
                }
                else {
                    // 예전에는 else 가 없었다. 멤버 응답을 파싱하지 못하면
                    // 콜백이 사라져 팬아웃 사슬 전체가 멈추고, 요청은 매달린 채
                    // DB 커넥션도 반납되지 않았다.
                    // 이 멤버의 결과만 빼고 나머지 멤버로 계속 간다 — 에러 핸들러와
                    // 같은 방침이다(멤버 하나의 실패가 그룹 전체를 막지 않는다).
                    console.error('[fopt_member] 멤버 응답을 읽지 못해 결과에서 제외한다: ' + ri);
                }
                callback('200');
            });
        });
    });

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'fopt member');
    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[fopt_member] problem with request: ' + e.message);
        }

        callback('200');
    });

    req.write(request.body);
    req.end();
}

function fopt_member(request, response, req_count, mid, body_Obj, cse_poa, agr, callback) {
    if(req_count >= mid.length) {
        callback('200');
    }
    else {
        var ri_prefix = request.url.split('/fopt')[1];
        var ri = mid[req_count];
        db_sql.get_ri_sri(request.db_connection, ri, function (err, results) {
            if(!err) {
                ri = ((results.length == 0) ? ri : results[0].ri);
                var target_cb = ri.split('/')[1];
                var hostname = 'localhost';
                var port = usecsebaseport;

                if (target_cb != usecsebase) {
                    if (cse_poa[target_cb]) {
                        hostname = url.parse(cse_poa[target_cb]).hostname;
                        port = url.parse(cse_poa[target_cb]).port;
                        request_to_member(request, hostname, port, ri, agr, function (code) {
                            if(code === '200') {
                                // 원격 CSE 멤버도 다음 멤버로 넘어가야 한다. 여기만 req_count 를
                                // 올리지 않아, 원격 멤버가 있는 그룹의 fanOutPoint 요청이 같은
                                // 멤버를 무한히 호출했다. 나머지 재귀 3곳과 동일하게 맞춘다.
                                fopt_member(request, response, ++req_count, mid, body_Obj, cse_poa, agr, function (code) {
                                    callback(code);
                                });
                            }
                            else {
                                callback(code);
                            }
                        });
                    }
                    else {
                        fopt_member(request, response, ++req_count, mid, body_Obj, cse_poa, agr, function (code) {
                            callback(code);
                        });
                    }
                }
                else {
                    request_to_member(request, hostname, port, ri, agr, function (code) {
                        if(code === '200') {
                            fopt_member(request, response, ++req_count, mid, body_Obj, cse_poa, agr, function (code) {
                                callback(code);
                            });
                        }
                        else {
                            callback(code);
                        }
                    });
                }
            }
            else {
                fopt_member(request, response, ++req_count, mid, body_Obj, cse_poa, agr, function (code) {
                    callback(code);
                });
            }
        });
    }
}


exports.check = function(request, response, grp, body_Obj, callback) {
    // 팬아웃의 최상위 콜백이다. 응답 전송과 커넥션 반납으로 이어진다.
    callback = once(callback, 'fopt.check');

    request.headers.rootnm = 'agr';
    var cse_poa = {};
    update_route(request.db_connection, cse_poa, function (code) {
        if(code === '200') {
            var ri_list = [];
            get_ri_list_sri(request, response, grp.mid, ri_list, 0, function (code) {
                if(code === '200') {
                    var req_count = 0;
                    var agr = {};
                    make_internal_ri(ri_list);
                    fopt_member(request, response, req_count, ri_list, body_Obj, cse_poa, agr, function (code) {
                        if(code == '200') {
                            var retrieve_Obj = agr;
                            if (Object.keys(retrieve_Obj).length != 0) {
                                request.resourceObj = JSON.parse(JSON.stringify(retrieve_Obj));
                                retrieve_Obj = null;

                                callback('200');
                            }
                            else {
                                callback('404-5');
                            }
                        }
                        else {
                            // 예전에는 else 가 없었다. fopt_member 가 '200' 이 아닌
                            // 코드를 주면 콜백이 사라져 요청이 매달렸다.
                            // 지금 사슬은 항상 '200' 을 주지만, 한 곳만 바뀌어도
                            // 다시 매달리게 되므로 받아서 그대로 올린다.
                            callback(code);
                        }
                    });
                }
                else {
                    callback(code);
                }
            });
        }
        else {
            callback(code);
        }
    });
};

