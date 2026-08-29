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
var util = require('util');
var responder = require('./responder');
var http = require('http');
var https = require('https');
var fs = require('fs');

var db_sql = require('./sql_action');
var outbound = require('./outbound');

var _this = this;

global.tmd_v = {};
tmd_v.CSE_CONTROLLED = '1';
tmd_v.CREATOR_CONTROLLED = '2';

global.tltp_v = {};
tltp_v.BLOCK_ALL = '1';
tltp_v.ALLOW_RETRIEVES = '2';

var tmh_v = {};
tmh_v.DELETE = '1';
tmh_v.PERSIST = '2';

/**
 * 하위 요청의 응답 본문을 pc 로 읽는다. 절대 던지지 않는다.
 *
 * 상대가 준 본문이라 JSON 이 아닐 수 있다 — 앞단 프록시의 오류 페이지,
 * 잘린 응답, 빈 본문 등. 호출부가 전부 res.on('end') 안이라 여기서 던지면
 * 잡을 곳이 없어 워커가 죽고, 진행 중이던 다른 요청까지 함께 날아간다.
 *
 * 읽지 못하면 pc 를 비운다. rsc 는 헤더에서 오므로 판정에는 지장이 없다.
 */
function read_pc(res, where) {
    var raw = (res.body == null) ? '' : res.body.toString();
    if (raw === '') {
        return undefined;
    }
    try {
        return JSON.parse(raw);
    }
    catch (e) {
        console.error('[tm ' + where + '] 하위 응답이 JSON 이 아니다: ' + e.message);
        return undefined;
    }
}

exports.build_tm = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

    resource_Obj[rootnm].rqps = body_Obj[rootnm].rqps;

    resource_Obj[rootnm].tctl = (body_Obj[rootnm].tctl) ? body_Obj[rootnm].tctl : tctl_v.INITIAL; // INITIAL
    resource_Obj[rootnm].tst = (body_Obj[rootnm].tst) ? body_Obj[rootnm].tst : tst_v.INITIAL;

    resource_Obj[rootnm].tltm = (body_Obj[rootnm].tltm) ? body_Obj[rootnm].tltm : '';
    resource_Obj[rootnm].text = (body_Obj[rootnm].text) ? body_Obj[rootnm].text : '';
    resource_Obj[rootnm].tct = (body_Obj[rootnm].tct) ? body_Obj[rootnm].tct : '';
    resource_Obj[rootnm].tept = (body_Obj[rootnm].tept) ? body_Obj[rootnm].tept : '';
    resource_Obj[rootnm].tmd = (body_Obj[rootnm].tmd) ? body_Obj[rootnm].tmd : tmd_v.CSE_CONTROLLED;
    resource_Obj[rootnm].tltp = (body_Obj[rootnm].tltp) ? body_Obj[rootnm].tltp : tltp_v.BLOCK_ALL; // BLOCK_ALL
    resource_Obj[rootnm].tmr = (body_Obj[rootnm].tmr) ? body_Obj[rootnm].tmr : '0';
    resource_Obj[rootnm].tmh = (body_Obj[rootnm].tmh) ? body_Obj[rootnm].tmh : tmh_v.DELETE;

    resource_Obj[rootnm].rsps = (body_Obj[rootnm].rsps) ? body_Obj[rootnm].rsps : '[]';

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};

function rsps_action(connection, ri, rsps) {
    console.log('rsps_action'); //callback(res.headers['x-m2m-rsc'], resBody);
    console.log(rsps);
/*
    if (res.statusCode == 201 || res.statusCode == 200) {
        var tst_value = tst_v.EXECUTED;
    }
    else {
        tst_value = tst_v.ERROR;
    }

    if (bodytype === 'xml') {
        try {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(resBody, function (err, body_Obj) {
                store_trsp(ri, tst_value, res, body_Obj);
            });
        }
        catch (e) {
            store_trsp(ri, tst_v.ERROR, res, e.message);
        }
    }
    else if (bodytype === 'cbor') {
    }
    else {
        try {
            var body_Obj = JSON.parse(resBody.toString());
            store_trsp(ri, tst_value, res, body_Obj);
        }
        catch (e) {
            store_trsp(ri, tst_v.ERROR, res, e.message);
        }
    }
    */
}

function store_trsp(connection, ri, tst_value, res, bodyObj) {
    var trsp_primitive = {};
    trsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
    trsp_primitive.rqi = res.headers['x-m2m-ri'];
    trsp_primitive.pc = bodyObj;

    db_sql.update_tr_trsp(connection, ri, tst_value, JSON.stringify(trsp_primitive), function (err) {
        if(!err) {
            console.log('store_trsp success');
        }
        else {
            console.log('store_trsp fail');
        }
    });
}

exports.request_lock = function(obj, retry_count, callback) {
    var resource_Obj = obj[Object.keys(obj)[0]];
    var ri = resource_Obj.ri;
    var rqps = resource_Obj.rqps;
    var tmr = parseInt(resource_Obj.tmr, 10);
    var request_count = 0;
    var rsps = [];
    var resBody = '';

    // 콜백을 부르는 지점이 전부 아래 루프 안에서 등록되는 응답 핸들러에만 있다.
    // rqps 가 비면 루프가 한 번도 돌지 않아 콜백이 영영 안 불렸다 — 응답도
    // connection.release() 도 없이 요청이 매달렸다. 크래시가 아니라 워커
    // 재시작도 안 걸리는 조용한 고갈이다.
    //
    // rqps 는 필수 속성이지만 생성 검증이 "존재하는가" 만 보므로 rqps: [] 가
    // 그대로 통과한다. 즉 본문 한 줄로 만들 수 있는 상태였다.
    // 이 함수의 규약은 rsc == '1' 만 성공이다. 잠글 요청이 없는 트랜잭션은
    // 만들 수 없으므로 실패로 알린다 — 소비자가 400-37 로 응답한다.
    if (!rqps || rqps.length === 0) {
        console.log('[request_lock] rqps 가 비어 잠글 요청이 없다: ' + ri);
        callback('0', obj, rsps);
        return;
    }

    for(var idx in rqps) {
        if (rqps.hasOwnProperty(idx)) {
            var rqi = require('shortid').generate();
            var content_type = 'application/json; ty=39';
            var bodytype = 'json';
            var op = 'post';
            var reqBodyString = JSON.stringify(rqps[idx].pc);


            if (rqps[idx].to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
                rqps[idx].to = rqps[idx].to.replace(usespid + usecseid + '/', '/');
            }
            else if (rqps[idx].to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
                rqps[idx].to = rqps[idx].to.replace(usecseid + '/', '/');
            }
            else if (rqps[idx].to.split(usecsebase)[0] == '') { // cse relative
                rqps[idx].to = '/' + rqps[idx].to;
            }

            var options = {
                hostname: 'localhost',
                port: usecsebaseport,
                path: rqps[idx].to,
                method: op,
                headers: {
                    'X-M2M-RI': rqi,
                    'Accept': 'application/json',
                    'X-M2M-Origin': rqps[idx].fr,
                    'Content-Type': content_type,
                    'X-M2M-RVI': uservi
                }
            };

            if (use_secure == 'disable') {
                var req = http.request(options, function (res) {
                    res.on('data', function (chunk) {
                        resBody += chunk;
                    });

                    res.on('end', function () {
                        res.body = resBody;
                        resBody = '';
                        request_count++;

                        var rsp_primitive = {};
                        rsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                        rsp_primitive.rqi = res.headers['x-m2m-ri'];
                        rsp_primitive.pc = read_pc(res, 'request_lock');
                        rsps.push(rsp_primitive);
                        if(request_count >= rqps.length) {
                            retry_count++;
                            var check_rsps = 0;
                            for(var idx in rsps) {
                                if(rsps.hasOwnProperty(idx)) {
                                    if (rsps[idx].rsc == 2001) {
                                        check_rsps++;
                                    }
                                    else {
                                        check_rsps = 0;
                                        break;
                                    }
                                }
                            }

                            if(check_rsps == 0) {
                                if(retry_count >= tmr) {
                                    callback('0', obj);
                                }
                                else {
                                    _this.request_lock(obj, retry_count, function (rsc, obj, rsps) {
                                        callback(rsc, obj, rsps);
                                    });
                                }
                            }
                            else {

                                callback('1', obj, rsps);
                            }
                        }
                    });
                });
            }
            else {
                options.ca = fs.readFileSync('ca-crt.pem');

                req = https.request(options, function (res) {
                    res.on('data', function (chunk) {
                        resBody += chunk;
                    });

                    res.on('end', function () {
                        res.body = resBody;
                        resBody = '';
                        request_count++;

                        var rsp_primitive = {};
                        rsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                        rsp_primitive.rqi = res.headers['x-m2m-ri'];
                        rsp_primitive.pc = read_pc(res, 'request_lock');
                        rsps.push(rsp_primitive);
                        if(request_count >= rqps.length) {
                            retry_count++;
                            var check_rsps = 0;
                            for(var idx in rsps) {
                                if(rsps.hasOwnProperty(idx)) {
                                    if (rsps[idx].rsc == 2001) {
                                        check_rsps++;
                                    }
                                    else {
                                        check_rsps = 0;
                                        break;
                                    }
                                }
                            }

                            if(check_rsps == 0) {
                                if(retry_count >= tmr) {
                                    callback('0', obj, rsps);
                                }
                                else {
                                    _this.request_lock(obj, retry_count, function (rsc, obj, rsps) {
                                        callback(rsc, obj, rsps);
                                    });
                                }
                            }
                            else {

                                callback('1', obj, rsps);
                            }
                        }
                    });
                });
            }

            // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
            outbound.arm(req, 'tm notify');
            req.on('error', function (e) {
                if (e.message != 'read ECONNRESET') {
                    console.log('[delete_TM] problem with request: ' + e.message);
                }

                request_count++;
                if(request_count >= rqps.length) {
                    retry_count++;
                    if(retry_count >= tmr) {
                        callback('0', obj);
                    }
                    else {
                        _this.request_lock(obj, retry_count, function (rsc, obj, rsps) {
                            callback(rsc, obj, rsps);
                        });
                    }
                }
            });

            // write data to request body
            req.write(reqBodyString);
            req.end();
        }
    }
};


function request_tctl(obj, retry_count, tctl, callback) {
    var resource_Obj = obj[Object.keys(obj)[0]];
    var ri = resource_Obj.ri;
    var rqps = resource_Obj.rqps;
    var tmr = parseInt(resource_Obj.tmr, 10);
    var request_count = 0;
    var rsps = [];
    var resBody = '';

    // request_lock 과 같은 이유다 — 콜백이 전부 루프 안에서 등록되는 응답
    // 핸들러에만 있어, rqps 가 비면 콜백이 영영 안 불리고 요청이 매달렸다.
    if (!rqps || rqps.length === 0) {
        console.log('[request_tctl] rqps 가 비어 보낼 요청이 없다: ' + ri);
        callback('0', obj, rsps);
        return;
    }

    for(var idx in rqps) {
        if (rqps.hasOwnProperty(idx)) {
            var rqi = require('shortid').generate();
            var content_type = 'application/json';
            var bodytype = 'json';
            var op = 'put';
            var rn = rqps[idx].pc['m2m:tr'].rn;
            rqps[idx].pc['m2m:tr'] = {};
            rqps[idx].pc['m2m:tr'].tctl = tctl;
            var reqBodyString = JSON.stringify(rqps[idx].pc);

            if (rqps[idx].to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
                rqps[idx].to = rqps[idx].to.replace(usespid + usecseid + '/', '/');
            }
            else if (rqps[idx].to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
                rqps[idx].to = rqps[idx].to.replace(usecseid + '/', '/');
            }
            else if (rqps[idx].to.split(usecsebase)[0] == '') { // cse relative
                rqps[idx].to = '/' + rqps[idx].to;
            }

            var options = {
                hostname: 'localhost',
                port: usecsebaseport,
                path: rqps[idx].to + '/' + rn,
                method: op,
                headers: {
                    'X-M2M-RI': rqi,
                    'Accept': 'application/json',
                    'X-M2M-Origin': rqps[idx].fr,
                    'Content-Type': content_type,
                    'X-M2M-RVI': uservi
                }
            };

            if (use_secure == 'disable') {
                var req = http.request(options, function (res) {
                    res.on('data', function (chunk) {
                        resBody += chunk;
                    });

                    res.on('end', function () {
                        res.body = resBody;
                        resBody = '';
                        request_count++;

                        var rsp_primitive = {};
                        rsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                        rsp_primitive.rqi = res.headers['x-m2m-ri'];
                        rsp_primitive.pc = read_pc(res, 'request_tctl');
                        rsps.push(rsp_primitive);
                        if(request_count >= rqps.length) {
                            retry_count++;
                            var check_rsps = 0;
                            for(var idx in rsps) {
                                if(rsps.hasOwnProperty(idx)) {
                                    if (rsps[idx].rsc == 2004) {
                                        check_rsps++;
                                    }
                                    else {
                                        check_rsps = 0;
                                        break;
                                    }
                                }
                            }

                            if(check_rsps == 0) {
                                if(retry_count >= tmr) {
                                    callback('0', obj, rsps);
                                }
                                else {
                                    request_tctl(obj, retry_count, tctl, function (rsc, obj, rsps) {
                                        callback(rsc, obj, rsps);
                                    });
                                }
                            }
                            else {
                                callback('1', obj, rsps);
                            }
                        }
                    });
                });
            }
            else {
                options.ca = fs.readFileSync('ca-crt.pem');

                req = https.request(options, function (res) {
                    res.on('data', function (chunk) {
                        resBody += chunk;
                    });

                    res.on('end', function () {
                        res.body = resBody;
                        resBody = '';
                        request_count++;

                        var rsp_primitive = {};
                        rsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                        rsp_primitive.rqi = res.headers['x-m2m-ri'];
                        rsp_primitive.pc = read_pc(res, 'request_tctl');
                        rsps.push(rsp_primitive);
                        if(request_count >= rqps.length) {
                            retry_count++;
                            var check_rsps = 0;
                            for(var idx in rsps) {
                                if(rsps.hasOwnProperty(idx)) {
                                    if (rsps[idx].rsc == 2001) {
                                        check_rsps++;
                                    }
                                    else {
                                        check_rsps = 0;
                                        break;
                                    }
                                }
                            }

                            if(check_rsps == 0) {
                                if(retry_count >= tmr) {
                                    callback('0', obj);
                                }
                                else {
                                    request_tctl(obj, retry_count, tctl, function (rsc, obj, rsps) {
                                        callback(rsc, obj, rsps);
                                    });
                                }
                            }
                            else {

                                callback('1', obj, rsps);
                            }
                        }
                    });
                });
            }

            // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
            outbound.arm(req, 'tm notify');
            req.on('error', function (e) {
                if (e.message != 'read ECONNRESET') {
                    console.log('[delete_TM] problem with request: ' + e.message);
                }

                request_count++;
                if(request_count >= rqps.length) {
                    retry_count++;
                    if(retry_count >= tmr) {
                        callback('0', obj);
                    }
                    else {
                        request_tctl(obj, retry_count, tctl, function (rsc, obj, rsps) {
                            callback(rsc, obj, rsps);
                        });
                    }
                }
            });

            // write data to request body
            req.write(reqBodyString);
            req.end();
        }
    }
}


exports.request_execute = function(obj, retry_count, callback) {
    request_tctl(obj, retry_count, tctl_v.EXECUTE, function (rsc, obj, rsps) {
        callback(rsc, obj, rsps);
    });
};

exports.request_commit = function(obj, retry_count, callback) {
    request_tctl(obj, retry_count, tctl_v.COMMIT, function (rsc, obj, rsps) {
        callback(rsc, obj, rsps);
    });
};

exports.request_abort = function(obj, retry_count, callback) {
    request_tctl(obj, retry_count, tctl_v.ABORT, function (rsc, obj, rsps) {
        callback(rsc, obj, rsps);
    });
};
