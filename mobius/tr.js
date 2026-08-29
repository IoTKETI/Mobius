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
var cbor = require('cbor');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var responder = require('./responder');
var http = require('http');
var https = require('https');
var fs = require('fs');

var db_sql = require('./sql_action');
var outbound = require('./outbound');
var once = require('./once');

global.tctl_v = {};
tctl_v.INITIAL = '1';
tctl_v.LOCK = '2';
tctl_v.EXECUTE = '3';
tctl_v.COMMIT = '4';
tctl_v.ABORT = '5';

global.tst_v = {};
tst_v.INITIAL = '1';
tst_v.LOCKED = '2';
tst_v.EXECUTED = '3';
tst_v.COMMITTED = '4';
tst_v.ERROR = '5';
tst_v.ABORTED = '6';

exports.build_tr = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

    resource_Obj[rootnm].tid = body_Obj[rootnm].tid;
    resource_Obj[rootnm].trqp = body_Obj[rootnm].trqp;

    resource_Obj[rootnm].tctl = (body_Obj[rootnm].tctl) ? body_Obj[rootnm].tctl : tctl_v.LOCK; // LOCK
    resource_Obj[rootnm].tst = (body_Obj[rootnm].tst) ? body_Obj[rootnm].tst : tst_v.LOCKED;

    resource_Obj[rootnm].tltm = (body_Obj[rootnm].tltm) ? body_Obj[rootnm].tltm : '';
    resource_Obj[rootnm].text = (body_Obj[rootnm].text) ? body_Obj[rootnm].text : '';
    resource_Obj[rootnm].tct = (body_Obj[rootnm].tct) ? body_Obj[rootnm].tct : '';
    resource_Obj[rootnm].tltp = (body_Obj[rootnm].tltp) ? body_Obj[rootnm].tltp : tltp_v.BLOCK_ALL; // BLOCK_ALL
    resource_Obj[rootnm].trqp = (body_Obj[rootnm].trqp) ? body_Obj[rootnm].trqp : '';
    resource_Obj[rootnm].trsp = (body_Obj[rootnm].trsp) ? body_Obj[rootnm].trsp : '';

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};

function execute_action(ri, bodytype, res, resBody, callback) {
    console.log('EXECUTE of transaction'); //callback(res.headers['x-m2m-rsc'], resBody);
    console.log(resBody);

    if (res.headers['x-m2m-rsc'] == 2001 || res.headers['x-m2m-rsc'] == 2000 || res.headers['x-m2m-rsc'] == 2004 || res.headers['x-m2m-rsc'] == 2002) {
        var tst_value = tst_v.EXECUTED;
    }
    else {
        tst_value = tst_v.ABORTED;
    }

    callback('1', tst_value);
}

exports.request_execute = function(obj, callback) {
    // 이 콜백은 응답 경로(res.on('end'))와 에러 경로(req.on('error')) 양쪽에서
    // 불릴 수 있다. 예전에는 에러 경로가 로그만 남기고 콜백을 부르지 않았다.
    //
    // 그러면 호출부(resource.js 의 update_action)가 영원히 기다린다 —
    // update_action -> resource.update -> authorize_and_run -> settle 이
    // 통째로 멈추므로 응답도 안 나가고 커넥션도 반납되지 않는다.
    // 크래시가 아니라 cluster 재시작도 안 걸리는 조용한 고갈이다.
    //
    // outbound.arm 이 응답 없는 요청을 끊으면 곧바로 이 경로로 온다.
    // tm.js 는 같은 자리에서 '0' 으로 실패를 알린다 — 그 관례를 따른다.
    callback = once(callback, 'tr request_execute ' + (obj.tr ? obj.tr.ri : ''));

    var rqi = require('shortid').generate();
    var content_type = 'application/json';
    var bodytype = 'json';

    switch (obj.tr.trqp.op.toString()) {
        case '1':
            var op = 'post';
            content_type += (obj.tr.trqp.ty)?('; ty=' + obj.tr.trqp.ty):'';
            break;
        case '2':
            op = 'get';
            break;
        case '3':
            op = 'put';
            break;
        case '4':
            op = 'delete';
            break;
    }

    var reqBodyString = '';
    if( op === 'post' || op === 'put') {
        if (bodytype === 'xml') {
            obj.tr.trqp.pc[Object.keys(obj.tr.trqp.pc)[0]]['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            for (var prop in obj.tr.trqp.pc) {
                if (obj.tr.trqp.pc.hasOwnProperty(prop)) {
                    for (var prop2 in obj.tr.trqp.pc[prop]) {
                        if (obj.tr.trqp.pc[prop].hasOwnProperty(prop2)) {
                            if (prop2 == 'rn') {
                                obj.tr.trqp.pc[prop]['@'] = {rn: obj.tr.trqp.pc[prop][prop2]};
                                delete obj.tr.trqp.pc[prop][prop2];
                                break;
                            }
                        }
                    }
                }
            }

            try {
                reqBodyString = js2xmlparser.parse(Object.keys(obj.tr.trqp.pc)[0], obj.tr.trqp.pc[Object.keys(obj.tr.trqp.pc)[0]]);
            }
            catch (e) {
                reqBodyString = "";
            }
        }
        else { // json
            reqBodyString = JSON.stringify(obj.tr.trqp.pc);
        }
    }

    var resBody = '';

    if (obj.tr.trqp.to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
        obj.tr.trqp.to = obj.tr.trqp.to.replace(usespid + usecseid + '/', '/');
    }
    else if (obj.tr.trqp.to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
        obj.tr.trqp.to = obj.tr.trqp.to.replace(usecseid + '/', '/');
    }
    else if (obj.tr.trqp.to.split(usecsebase)[0] == '') { // cse relative
        obj.tr.trqp.to = '/' + obj.tr.trqp.to;
    }

    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: obj.tr.trqp.to + '?tctl=3&tid=' + obj.tr.tid,
        method: op,
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': obj.tr.trqp.fr,
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
                execute_action(obj.tr.ri, bodytype, res, resBody, function(rsc, tst) {
                    obj.tr.tst = tst;
                    callback(rsc, obj);
                });
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
                execute_action(obj.tr.ri, bodytype, res, resBody, function(rsc, tst) {
                    obj.tr.tst = tst;
                    callback(rsc, obj);
                });
            });
        });
    }

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'tr notify');
    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[delete_TR] problem with request: ' + e.message);
        }

        // 여기서 반드시 콜백을 불러야 한다. 안 부르면 호출부가 영원히 기다린다.
        // 상태(tst)는 건드리지 않는다 — 실패했으므로 이전 상태 그대로 남는다.
        callback('0', obj);
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
};

function trsp_action(ri, bodytype, res, resBody, callback) {
    console.log('COMMIT of transaction'); //callback(res.headers['x-m2m-rsc'], resBody);
    console.log(resBody);

    if (res.headers['x-m2m-rsc'] == 2001 || res.headers['x-m2m-rsc'] == 2000 || res.headers['x-m2m-rsc'] == 2004 || res.headers['x-m2m-rsc'] == 2002) {
        var tst_value = tst_v.COMMITTED;
    }
    else {
        tst_value = tst_v.ABORTED;
    }

    // 응답 본문을 pc 로 옮긴다. 어떤 경우에도 정확히 한 번만 정산한다.
    //
    // 예전에는 세 분기가 각각 다른 방식으로 깨져 있었다.
    //   xml : JSON.parse(body_Obj.toString()) — body_Obj 는 파싱된 객체라
    //         String() 이 '[object Object]' 가 되어 *언제나* 던졌다. 그리고
    //         catch 가 같은 본문을 또 JSON 으로 파싱해 다시 던졌다.
    //   cbor: 블록이 비어 있어 콜백이 아예 안 불렸다 — 요청이 매달렸다.
    //   json: catch 가 방금 던진 것과 글자 그대로 같은 파싱을 반복했다.
    //         복구 능력이 0이라 첫 파싱이 실패하면 두 번째도 반드시 실패하고,
    //         이번엔 잡아 줄 곳이 없어 워커가 죽었다.
    //
    // 상대 CSE 가 준 본문이라 형식을 신뢰할 수 없다. 읽지 못하면 pc 를 비우고
    // 원문을 로그로 남긴다 — 트랜잭션 상태(tst)는 이미 rsc 로 정했으므로
    // pc 를 못 읽었다고 해서 사슬을 멈출 이유가 없다.
    var trsp_primitive = {};
    trsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
    trsp_primitive.rqi = res.headers['x-m2m-ri'];

    function settle(pc) {
        if (pc != null) {
            trsp_primitive.pc = pc;
        }
        callback('1', tst_value, trsp_primitive);
    }

    function unreadable(why) {
        console.error('[trsp_action] 상대 응답을 읽지 못했다 (' + ri + ', ' + bodytype + '): ' + why);
        settle(null);
    }

    if (bodytype === 'xml') {
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(resBody, function (err, body_Obj) {
            if (err) {
                unreadable(err.message);
                return;
            }
            settle(body_Obj);        // 파싱 결과가 곧 pc 다. 다시 파싱하지 않는다
        });
    }
    else if (bodytype === 'cbor') {
        cbor.decodeFirst(resBody, function (err, decoded) {
            if (err) {
                unreadable(err.message);
                return;
            }
            settle(decoded);
        });
    }
    else { // json
        var parsed;
        try {
            parsed = JSON.parse(resBody.toString());
        }
        catch (e) {
            unreadable(e.message);
            return;
        }
        settle(parsed);
    }
}

exports.request_commit = function(obj, callback) {
    // request_execute 와 같은 이유다. 에러 경로가 콜백을 부르지 않으면
    // 요청이 응답 없이 매달리고 커넥션이 반납되지 않는다.
    callback = once(callback, 'tr request_commit ' + (obj.tr ? obj.tr.ri : ''));

    var rqi = require('shortid').generate();
    obj.tr.trqp.rqi = rqi;

    var content_type = 'application/json';
    var bodytype = 'json';

    switch (obj.tr.trqp.op.toString()) {
        case '1':
            var op = 'post';
            content_type += (obj.tr.trqp.ty)?('; ty=' + obj.tr.trqp.ty):'';
            break;
        case '2':
            op = 'get';
            break;
        case '3':
            op = 'put';
            break;
        case '4':
            op = 'delete';
            break;
    }

    var reqBodyString = '';
    if( op === 'post' || op === 'put') {
        if (bodytype === 'xml') {
            obj.tr.trqp.pc[Object.keys(obj.tr.trqp.pc)[0]]['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            for (var prop in obj.tr.trqp.pc) {
                if (obj.tr.trqp.pc.hasOwnProperty(prop)) {
                    for (var prop2 in obj.tr.trqp.pc[prop]) {
                        if (obj.tr.trqp.pc[prop].hasOwnProperty(prop2)) {
                            if (prop2 == 'rn') {
                                obj.tr.trqp.pc[prop]['@'] = {rn: obj.tr.trqp.pc[prop][prop2]};
                                delete obj.tr.trqp.pc[prop][prop2];
                                break;
                            }
                        }
                    }
                }
            }

            try {
                reqBodyString = js2xmlparser.parse(Object.keys(obj.tr.trqp.pc)[0], obj.tr.trqp.pc[Object.keys(obj.tr.trqp.pc)[0]]);
            }
            catch (e) {
                reqBodyString = "";
            }
        }
        else { // json
            reqBodyString = JSON.stringify(obj.tr.trqp.pc);
        }
    }

    var resBody = '';

    if (obj.tr.trqp.to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
        obj.tr.trqp.to = obj.tr.trqp.to.replace(usespid + usecseid + '/', '/');
    }
    else if (obj.tr.trqp.to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
        obj.tr.trqp.to = obj.tr.trqp.to.replace(usecseid + '/', '/');
    }
    else if (obj.tr.trqp.to.split(usecsebase)[0] == '') { // cse relative
        obj.tr.trqp.to = '/' + obj.tr.trqp.to;
    }

    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: obj.tr.trqp.to + '?tid=' + obj.tr.tid,
        method: op,
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': obj.tr.trqp.fr,
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
                trsp_action(obj.tr.ri, bodytype, res, resBody, function(rsc, tst, trsp) {
                    obj.tr.tst = tst;
                    obj.tr.trsp = trsp;
                    callback(rsc, obj);
                });
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
                trsp_action(obj.tr.ri, bodytype, res, resBody, function(rsc, tst, trsp) {
                    obj.tr.tst = tst;
                    obj.tr.trsp = trsp;
                    callback(rsc, obj);
                });
            });
        });
    }

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'tr notify');
    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[delete_TR] problem with request: ' + e.message);
        }

        // 여기서 반드시 콜백을 불러야 한다. 안 부르면 호출부가 영원히 기다린다.
        // 상태(tst)는 건드리지 않는다 — 실패했으므로 이전 상태 그대로 남는다.
        callback('0', obj);
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
};

exports.check = function(request, callback) {
    var pi = request.targetObject[Object.keys(request.targetObject)[0]].ri;

    var state = tst_v.COMMITTED;
    db_sql.select_tr(request.db_connection, pi, function (err, results_tr) {
        if (!err) {
            for (var i = 0; i < results_tr.length; i++) {
                if(request.query.tid == results_tr[i].tid) {
                    results_tr = null;
                    callback('200');
                    return;
                }

                if (results_tr[i].hasOwnProperty('tltp')) {
                    if(results_tr[i].tltp == tltp_v.BLOCK_ALL) {
                        if (results_tr[i].hasOwnProperty('tst')) {
                            if (results_tr[i].tst != tst_v.COMMITTED && results_tr[i].tst != tst_v.ABORTED) {
                                state = results_tr[i].tst;
                                break;
                            }
                        }
                    }
                    else if(results_tr[i].tltp == tltp_v.ALLOW_RETRIEVES) {
                        if(request.method === 'GET') {
                            state = tst_v.COMMITTED;
                            break;
                        }
                        else {
                            if (results_tr[i].hasOwnProperty('tst')) {
                                if (results_tr[i].tst != tst_v.COMMITTED && results_tr[i].tst != tst_v.ABORTED) {
                                    state = results_tr[i].tst;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if (state === tst_v.COMMITTED || state === tst_v.ABORTED) {
                results_tr = null;
                callback('200');
            }
            else {
                results_tr = null;
                callback('423-1');
            }
        }
        else {
            console.log('query error: ' + results_tr.message);
            results_tr = null;
            callback('200');
        }
    });

};
