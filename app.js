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
 * @file Main code of Mobius. Role of flow router
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

process.env.NODE_ENV = 'production';
//process.env.NODE_ENV = 'development';

var fs = require('fs');
var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var util = require('util');
var xml2js = require('xml2js');
var url = require('url');
var ip = require('ip');
var crypto = require('crypto');
var fileStreamRotator = require('file-stream-rotator');
var https = require('https');
var cbor = require('cbor');
var moment = require('moment');

const cors = require('cors');

global.NOPRINT = 'true';
global.ONCE = 'true';

var cb = require('./mobius/cb');
var responder = require('./mobius/responder');
var resource = require('./mobius/resource');
var security = require('./mobius/security');
var fopt = require('./mobius/fopt');
var tr = require('./mobius/tr');
var sgn = require('./mobius/sgn');

var db = require('./mobius/db_action');
var db_sql = require('./mobius/sql_action');

// 전환된 sql_action 함수들이 쓰는 새 DB 파사드.
// 전환이 끝나면(구 db_action/db_sqlite 삭제 시) 위 db 를 이것으로 대체한다.
var db_facade = require('./mobius/db');

// ������ �����մϴ�.
var app = express();

global.cache_resource_url = {};
global.cache_security_check = {};

app.use(cors());

global.usespid = '//keti.re.kr';
global.usesuperuser = 'Sponde'; //'Superman';
global.useobserver = 'Sandwich';

var logDirectory = __dirname + '/log';

// ensure log directory exists
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

// create a rotating write stream
var accessLogStream = fileStreamRotator.getStream({
    date_format: 'YYYYMMDD',
    filename: logDirectory + '/access-%DATE%.log',
    frequency: 'daily',
    verbose: false
});

// setup the logger
app.use(morgan('combined', {stream: accessLogStream}));

//ts_app.use(morgan('short', {stream: accessLogStream}));

function del_req_resource() {
    db.getConnection((code, connection) => {
        if (code === '200') {
            db_sql.delete_req(connection, (err, delete_Obj) => {
                if (!err) {
                    console.log('deleted ' + delete_Obj.affectedRows + ' request resource(s).');
                }
                connection.release();
            });
        }
        else {
            console.log('[del_req_resource] No Connection');
        }
    });
}

// 만료 리소스는 **자동으로 지우지 않는다.**
//
// 예전에는 del_expired_resource 를 24시간마다 돌렸는데, 그 구현이 만료된 ri 를
// pi 자리에 넣어 "만료 리소스의 자식"을 지우고 정작 대상은 남기는 no-op 이었다.
// 고쳐서 제대로 지우게 만드는 순간, 지금까지 한 번도 안 지워진 만료 리소스가
// 한꺼번에 사라진다. 그건 관리자가 확인하고 결정할 일이다.
//
// 그래서 기능만 남기고 주기 실행은 걸지 않는다. 관리자 UI 가 쓸 함수:
//   db_sql.select_expired_resources(conn, et, limit, cb)  목록 조회 (읽기 전용)
//   db_sql.delete_lookup_et(conn, et, limit, cb)          선택 후 삭제
// et 를 늘리는 것은 일반 oneM2M UPDATE 로 하면 된다.

// 저장된 cnt.cni/cbs 를 실제 cin 집계와 맞춘다 (기동 시 + 일 1회).
//
// get_cni_count 가 매번 재집계하던 것을 저장값 읽기로 바꾸면서(O(n) -> O(1))
// 그 안전망이 사라졌다. 아직 감산하지 않는 경로(subtree 배경 삭제, 만료 스윕)가
// 남아 있으므로 주기적으로 맞춰 준다.
//
// 커서를 프로세스 안에 들고 이어서 돈다. 컨테이너가 3만 개대이고 그중 몇 개는
// CIN 이 수백만 건이라 한 번에 다 돌 수 없다 — 시간 예산만큼만 일하고
// 다음 호출이 멈춘 자리에서 계속한다. 한 바퀴를 다 돌면 처음으로 되감는다.
var reconcile_cursor = '';
var reconcile_running = false;
// 한 바퀴 동안 집계를 못 한 컨테이너를 모았다가 바퀴 끝에 한 번만 보고한다.
// 매 조각마다 찍으면 같은 대형 컨테이너가 계속 로그를 채운다.
var reconcile_deferred = [];
var reconcile_failed = [];

// 한 바퀴가 끝나기 전까지는 24시간을 기다리지 않고 곧바로 이어서 돈다.
//
// 커서는 "다음 호출이 멈춘 자리에서 계속한다" 를 전제로 만들었는데, 그
// 다음 호출이 24시간 뒤였다. 배포 환경 기준 컨테이너 30,220개를 조각당
// 2000개씩 나누면 한 바퀴에 16일이 걸린다 — 드리프트 교정이 사실상
// 동작하지 않았다. 조각 사이를 1분으로 두면 한 바퀴가 20분 안에 끝난다.
var RECONCILE_GAP_MS = 60 * 1000;

// is_continuation 은 이어 돌기가 스스로 부를 때만 true 다.
// 24시간 타이머는 한 바퀴가 도는 중이면 그냥 넘어간다 — 안 그러면 두 흐름이
// 같은 reconcile_cursor 를 각자 전진시켜 컨테이너를 건너뛴다.
function reconcile_counters(is_continuation) {
    if (reconcile_running && !is_continuation) { return; }
    reconcile_running = true;

    db.getConnection((code, connection) => {
        if (code !== '200') {
            console.log('[reconcile_counters] No Connection');
            reconcile_running = false;
            return;
        }

        db_sql.reconcile_cnt_counters(connection,
            // limit 은 한 번에 읽어 둘 컨테이너 수이고, 실질 상한은 budgetMs 다.
            // cnt 는 3만 행대라 2000행을 읽는 것 자체는 싸다.
            { limit: 2000, cursor: reconcile_cursor, budgetMs: 30000 },
            (err, report) => {
                connection.release();

                if (err) {
                    console.log('[reconcile_counters] error', report);
                    reconcile_running = false;
                    return;
                }

                if (report.fixed > 0) {
                    console.log('[reconcile_counters] ' + report.checked + '건 확인, ' +
                                report.fixed + '건 교정');
                }
                reconcile_deferred = reconcile_deferred.concat(report.deferredRis || []);
                reconcile_failed = reconcile_failed.concat(report.failedRis || []);

                if (report.done) {
                    // 한 바퀴 완료. 손대지 못한 것들을 한 번만 알리고 되감는다.
                    var stuck = reconcile_deferred.concat(reconcile_failed);
                    if (stuck.length > 0) {
                        console.log('[reconcile_counters] 한 바퀴 완료 — 유예(대형) ' +
                                    reconcile_deferred.length + '건, 실패 ' +
                                    reconcile_failed.length + '건. 관리자 UI 에서 개별 처리 필요: ' +
                                    stuck.slice(0, 10).join(', ') +
                                    (stuck.length > 10 ? ' 외 ' + (stuck.length - 10) + '건' : ''));
                    }
                    reconcile_cursor = '';
                    reconcile_deferred = [];
                    reconcile_failed = [];
                    reconcile_running = false;   // 한 바퀴 끝. 다음 24시간 틱을 받는다.
                }
                else {
                    // 아직 도는 중이다. reconcile_running 을 켠 채로 두어
                    // 24시간 틱이 끼어들지 못하게 한다.
                    reconcile_cursor = report.nextCursor;
                    setTimeout(function () { reconcile_counters(true); }, RECONCILE_GAP_MS);
                }
            });
    });
}

// 비동기 subtree 삭제 도중 프로세스가 죽어 남은 고아 행 정리 (기동 시 + 일 1회)
function del_orphan_resource() {
    db.getConnection((code, connection) => {
        if (code === '200') {
            db_sql.delete_orphan_lookup(connection, (err) => {
                if (err) {
                    console.log('[del_orphan_resource] error', err);
                }
                connection.release();
            });
        }
        else {
            console.log('[del_orphan_resource] No Connection');
        }
    });
}

var cluster = require('cluster');
var os = require('os');
//var cpuCount = (os.cpus().length / 2);
var cpuCount = os.cpus().length;

var worker = [];
var use_clustering = 1;
var worker_init_count = 0;
if (use_clustering) {
    if (cluster.isMaster) {
        cluster.on('death', (worker) => {
            console.log('worker' + worker.pid + ' died --> start again');
            cluster.fork();
        });

        db.connect(usedbhost, 3306, 'root', usedbpass, (rsc) => {
            if (rsc == '1') {
                // 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
                // 전환 안 된 함수들은 구 경로로 계속 동작하고, 전환된 함수는
                // db.run() 이 콜백으로 에러를 돌려준다(워커는 죽지 않는다).
                try {
                    db_facade.connect(usedbhost, 3306, 'root', usedbpass, (rsc2) => {
                        if (rsc2 !== '1') {
                            console.error('[db_facade] connect failed (' + rsc2 +
                                ') — 전환된 DB 함수는 전부 실패한다');
                        }
                    });
                } catch (e) {
                    console.error('[db_facade] connect threw (' + (e.message || e) +
                        ') — 전환된 DB 함수는 전부 실패한다');
                }
                db.getConnection((code, connection) => {
                    if (code === '200') {
                        db_sql.set_tuning(connection, (err, results) => {
                            if (err) {
                                console.log('[set_tuning] error');
                            }

                            console.log('CPU Count:', cpuCount);
                            for (var i = 0; i < cpuCount; i++) {
                                worker[i] = cluster.fork();
                            }

                            cb.create(connection, (rsp) => {
                                console.log(JSON.stringify(rsp));

                                setInterval(del_req_resource, (24) * (60) * (60) * (1000));
                                // 만료 스윕(del_expired_resource)의 주기 실행은 뺐다.
                                // 이유는 위 주석 참고 — 관리자 UI 가 확인 후 호출한다.

                                del_orphan_resource();
                                setInterval(del_orphan_resource, (24) * (60) * (60) * (1000));

                                reconcile_counters();
                                setInterval(reconcile_counters, (24) * (60) * (60) * (1000));

                                require('./pxy_mqtt');
                                require('./pxy_coap');
                                require('./pxy_ws');

                                if (usecsetype == 'mn' || usecsetype == 'asn') {
                                    global.refreshIntervalId = setInterval(() => {
                                        csr_custom.emit('register_remoteCSE');
                                    }, 5000);
                                }

                                connection.release();
                            });
                        });
                    }
                    else {
                        console.log('[db.connect] No Connection');
                    }
                });
            }
        });
    }
    else {
        db.connect(usedbhost, 3306, 'root', usedbpass, (rsc) => {
            if (rsc === '1') {
                // 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
                // 전환 안 된 함수들은 구 경로로 계속 동작하고, 전환된 함수는
                // db.run() 이 콜백으로 에러를 돌려준다(워커는 죽지 않는다).
                try {
                    db_facade.connect(usedbhost, 3306, 'root', usedbpass, (rsc2) => {
                        if (rsc2 !== '1') {
                            console.error('[db_facade] connect failed (' + rsc2 +
                                ') — 전환된 DB 함수는 전부 실패한다');
                        }
                    });
                } catch (e) {
                    console.error('[db_facade] connect threw (' + (e.message || e) +
                        ') — 전환된 DB 함수는 전부 실패한다');
                }
                db.getConnection((code, connection) => {
                    if (code === '200') {
                        if (use_secure === 'disable') {
                            http.globalAgent.maxSockets = 1000000;
                            http.createServer(app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                cb.create(connection, (rsp) => {
                                    console.log(JSON.stringify(rsp));
                                    //noti_mqtt_begin();

                                    connection.release();
                                });
                            });
                        }
                        else {
                            var options = {
                                key: fs.readFileSync('server-key.pem'),
                                cert: fs.readFileSync('server-crt.pem'),
                                ca: fs.readFileSync('ca-crt.pem')
                            };
                            https.globalAgent.maxSockets = 1000000;
                            https.createServer(options, app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                cb.create(connection, (rsp) => {
                                    console.log(JSON.stringify(rsp));
                                    //noti_mqtt_begin();

                                    connection.release();
                                });
                            });
                        }
                    }
                    else {
                        console.log('[db.connect] No Connection');
                    }
                });
            }
        });
    }
}
else {
    db.connect(usedbhost, 3306, 'root', usedbpass, (rsc) => {
        if (rsc == '1') {
            // 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
            // 전환 안 된 함수들은 구 경로로 계속 동작하고, 전환된 함수는
            // db.run() 이 콜백으로 에러를 돌려준다(워커는 죽지 않는다).
            try {
                db_facade.connect(usedbhost, 3306, 'root', usedbpass, (rsc2) => {
                    if (rsc2 !== '1') {
                        console.error('[db_facade] connect failed (' + rsc2 +
                            ') — 전환된 DB 함수는 전부 실패한다');
                    }
                });
            } catch (e) {
                console.error('[db_facade] connect threw (' + (e.message || e) +
                    ') — 전환된 DB 함수는 전부 실패한다');
            }
            db.getConnection((code, connection) => {
                if (code === '200') {
                    cb.create(connection, (rsp) => {
                        console.log(JSON.stringify(rsp));

                        if (use_secure === 'disable') {
                            http.globalAgent.maxSockets = 1000000;
                            http.createServer(app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                require('./pxy_mqtt');
                                //noti_mqtt_begin();

                                if (usecsetype === 'mn' || usecsetype === 'asn') {
                                    global.refreshIntervalId = setInterval(() => {
                                        csr_custom.emit('register_remoteCSE');
                                    }, 5000);
                                }
                            });
                        }
                        else {
                            var options = {
                                key: fs.readFileSync('server-key.pem'),
                                cert: fs.readFileSync('server-crt.pem'),
                                ca: fs.readFileSync('ca-crt.pem')
                            };
                            https.globalAgent.maxSockets = 1000000;
                            https.createServer(options, app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                require('./pxy_mqtt');
                                //noti_mqtt_begin();

                                if (usecsetype === 'mn' || usecsetype === 'asn') {
                                    global.refreshIntervalId = setInterval(() => {
                                        csr_custom.emit('register_remoteCSE');
                                    }, 5000);
                                }
                            });
                        }

                        connection.release();
                    });
                }
                else {
                    console.log('[db.connect] No Connection');
                }
            });
        }
    });
}

global.get_ri_list_sri = function (request, response, sri_list, ri_list, count, callback) {
    if (sri_list.length <= count) {
        callback('200');
    }
    else {
        db_sql.get_ri_sri(request.db_connection, sri_list[count], (err, results) => {
            if (!err) {
                ri_list[count] = ((results.length == 0) ? sri_list[count] : results[0].ri);
                results = null;

                get_ri_list_sri(request, response, sri_list, ri_list, ++count, (code) => {
                    callback(code);
                });
            }
            else {
                callback('500-1');
            }
        });
    }
};

global.update_route = function (connection, cse_poa, callback) {
    db_sql.select_csr_like(connection, usecsebase, (err, results_csr) => {
        if (!err) {
            for (var i = 0; i < results_csr.length; i++) {
                var poa_arr = JSON.parse(results_csr[i].poa);
                for (var j = 0; j < poa_arr.length; j++) {
                    if (url.parse(poa_arr[j]).protocol == 'http:' || url.parse(poa_arr[j]).protocol == 'https:') {
                        cse_poa[results_csr[i].ri.split('/')[2]] = poa_arr[j];
                    }
                }
            }
            results_csr = null;
            callback('200');
        }
        else {
            callback('500-1');
        }
    });
};

function make_short_nametype(body_Obj) {
    if (body_Obj[Object.keys(body_Obj)[0]]['$'] != null) {
        if (body_Obj[Object.keys(body_Obj)[0]]['$'].rn != null) {
            body_Obj[Object.keys(body_Obj)[0]].rn = body_Obj[Object.keys(body_Obj)[0]]['$'].rn;
        }
        delete body_Obj[Object.keys(body_Obj)[0]]['$'];
    }

    var arr_rootnm = Object.keys(body_Obj)[0].split(':');

    if(arr_rootnm[0] === 'hd') {
        var rootnm = Object.keys(body_Obj)[0].replace('hd:', 'hd_');
    }
    else {
        rootnm = Object.keys(body_Obj)[0].replace('m2m:', '');
    }

    body_Obj[rootnm] = body_Obj[Object.keys(body_Obj)[0]];
    delete body_Obj[Object.keys(body_Obj)[0]];

    for (var attr in body_Obj[rootnm]) {
        if (body_Obj[rootnm].hasOwnProperty(attr)) {
            if (typeof body_Obj[rootnm][attr] === 'boolean') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else if (typeof body_Obj[rootnm][attr] === 'string') {
            }
            else if (typeof body_Obj[rootnm][attr] === 'number') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else {
            }
        }
    }
}

global.make_json_obj = function (bodytype, str, callback) {
    try {
        if (bodytype === 'xml') {
            var message = str;
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(message.toString(), (err, result) => {
                if (err) {
                    console.log('[mqtt make json obj] xml2js parser error]');
                    callback('0');
                }
                else {
                    for (var prop in result) {
                        if (result.hasOwnProperty(prop)) {
                            for (var attr in result[prop]) {
                                if (result[prop].hasOwnProperty(attr)) {
                                    if (attr == '$') {
                                        delete result[prop][attr];
                                    }
                                    else if (attr == 'pc') {
                                        make_json_arraytype(result[prop][attr]);
                                    }
                                }
                            }
                        }
                    }
                    callback('1', result);
                }
            });
        }
        else if (bodytype === 'cbor') {
            cbor.decodeFirst(str, (err, result) => {
                if (err) {
                    console.log('cbor parser error]');
                }
                else {
                    callback('1', result);
                }
            });
        }
        else {
            var result = JSON.parse(str);
            callback('1', result);
        }
    }
    catch (e) {
        console.error(e.message);
        callback('0');
    }
};

global.make_json_arraytype = function (body_Obj) {
    for (var prop in body_Obj) {
        if (body_Obj.hasOwnProperty(prop)) {
            for (var attr in body_Obj[prop]) {
                if (body_Obj[prop].hasOwnProperty(attr)) {
                    if (attr == 'srv' || attr == 'aa' || attr == 'at' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' || attr == 'nu' || attr == 'mid' || attr == 'macp' || attr == 'rels') {
                        if (body_Obj[prop][attr]) {
                            body_Obj[prop][attr] = body_Obj[prop][attr].split(' ');
                        }
                        if (body_Obj[prop][attr] == '') {
                            body_Obj[prop][attr] = [];
                        }
                        if (body_Obj[prop][attr] == '[]') {
                            body_Obj[prop][attr] = [];
                        }
                    }
                    else if (attr == 'rqps') {
                        var rqps_type = getType(body_Obj[prop][attr]);
                        if (rqps_type === 'array') {

                        }
                        else if (rqps_type === 'object') {
                            var temp = body_Obj[prop][attr];
                            body_Obj[prop][attr] = [];
                            body_Obj[prop][attr].push(temp);
                        }
                        else {

                        }
                    }
                    else if (attr == 'enc') {
                        if (body_Obj[prop][attr]) {
                            if (body_Obj[prop][attr].net) {
                                if (!Array.isArray(body_Obj[prop][attr].net)) {
                                    body_Obj[prop][attr].net = body_Obj[prop][attr].net.split(' ');
                                }
                            }
                        }
                    }
                    else if (attr == 'pv' || attr == 'pvs') {
                        if (body_Obj[prop][attr]) {
                            if (body_Obj[prop][attr].acr) {
                                if (!Array.isArray(body_Obj[prop][attr].acr)) {
                                    temp = body_Obj[prop][attr].acr;
                                    body_Obj[prop][attr].acr = [];
                                    body_Obj[prop][attr].acr[0] = temp;
                                }

                                for (var acr_idx in body_Obj[prop][attr].acr) {
                                    if (body_Obj[prop][attr].acr.hasOwnProperty(acr_idx)) {
                                        if (body_Obj[prop][attr].acr[acr_idx].acor) {
                                            body_Obj[prop][attr].acr[acr_idx].acor = body_Obj[prop][attr].acr[acr_idx].acor.split(' ');
                                        }

                                        if (body_Obj[prop][attr].acr[acr_idx].hasOwnProperty('acco')) {
                                            if (!Array.isArray(body_Obj[prop][attr].acr[acr_idx].acco)) {
                                                temp = body_Obj[prop][attr].acr[acr_idx].acco;
                                                body_Obj[prop][attr].acr[acr_idx].acco = [];
                                                body_Obj[prop][attr].acr[acr_idx].acco[0] = temp;
                                            }

                                            var acco = body_Obj[prop][attr].acr[acr_idx].acco;
                                            for (var acco_idx in acco) {
                                                if (acco.hasOwnProperty(acco_idx)) {
                                                    if (acco[acco_idx].hasOwnProperty('acip')) {
                                                        if (acco[acco_idx].acip.hasOwnProperty('ipv4')) {
                                                            if (getType(acco[acco_idx].acip['ipv4']) == 'string') {
                                                                acco[acco_idx].acip['ipv4'] = acco[acco_idx].acip.ipv4.split(' ');
                                                            }
                                                        }
                                                        else if (acco[acco_idx].acip.hasOwnProperty('ipv6')) {
                                                            if (getType(acco[acco_idx].acip['ipv6']) == 'string') {
                                                                acco[acco_idx].acip['ipv6'] = acco[acco_idx].acip.ipv6.split(' ');
                                                            }
                                                        }
                                                    }
                                                    if (acco[acco_idx].hasOwnProperty('actw')) {
                                                        if (getType(acco[acco_idx].actw) == 'string') {
                                                            temp = acco[acco_idx].actw;
                                                            acco[acco_idx]['actw'] = [];
                                                            acco[acco_idx].actw[0] = temp;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            if (body_Obj[prop][attr].acr == '') {
                                body_Obj[prop][attr].acr = [];
                            }

                            if (body_Obj[prop][attr].acr == '[]') {
                                body_Obj[prop][attr].acr = [];
                            }
                        }
                    }
                }
            }
        }
    }
};

function parse_to_json(request, response, callback) {
    if (request.usebodytype === 'xml') {
        try {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(request.body.toString(), (err, result) => {
                if (err) {
                    callback('400-5');
                }
                else {
                    request.bodyObj = result;
                    make_short_nametype(request.bodyObj);
                    make_json_arraytype(request.bodyObj);

                    request.headers.rootnm = Object.keys(request.bodyObj)[0];
                    callback('200');
                }
            });
        }
        catch (e) {
            callback('400-5');
        }
    }
    else if (request.usebodytype === 'cbor') {
        try {
            var encoded = request.body;
            cbor.decodeFirst(encoded, (err, result) => {
                if (err) {
                    callback('400-6');
                }
                else {
                    request.bodyObj = result;
                    make_short_nametype(request.bodyObj);
                    //make_json_arraytype(request.bodyObj);

                    request.headers.rootnm = Object.keys(request.bodyObj)[0];
                    callback('200');
                }
            });
        }
        catch (e) {
            callback('400-6');
        }
    }
    else {
        try {
            request.bodyObj = JSON.parse(request.body.toString());
            make_short_nametype(request.bodyObj);

            if (Object.keys(request.bodyObj)[0] == 'undefined') {
                callback('400-7');
            }
            else {
                request.headers.rootnm = Object.keys(request.bodyObj)[0];
                callback('200');
            }
        }
        catch (e) {
            callback('400-7');
        }
    }
}

function parse_body_format(request, response, callback) {
    parse_to_json(request, response, (code) => {
        if (code === '200') {
            var body_Obj = request.bodyObj;
            for (var prop in body_Obj) {
                if (body_Obj.hasOwnProperty(prop)) {
                    for (var attr in body_Obj[prop]) {
                        if (body_Obj[prop].hasOwnProperty(attr)) {
                            if (attr == 'aa' || attr == 'at' || attr == 'poa' || attr == 'acpi' || attr == 'srt' ||
                                attr == 'nu' || attr == 'mid' || attr == 'macp' || attr == 'rels' || attr == 'rqps' || attr == 'srv') {
                                if (!Array.isArray(body_Obj[prop][attr])) {
                                    callback('400-8');
                                    return;
                                }
                            }
                            else if (attr == 'lbl') {
                                if (body_Obj[prop][attr] == null) {
                                    body_Obj[prop][attr] = [];
                                }
                                else if (!Array.isArray(body_Obj[prop][attr])) {
                                    callback('400-9');
                                    return;
                                }
                            }
                            else if (attr == 'enc') {
                                if (body_Obj[prop][attr].net) {
                                    if (!Array.isArray(body_Obj[prop][attr].net)) {
                                        callback('400-10');
                                        return;
                                    }
                                }
                                else {
                                    callback('400-11');
                                    return;
                                }
                            }
                            else if (attr == 'pv' || attr == 'pvs') {
                                if (body_Obj[prop][attr].hasOwnProperty('acr')) {
                                    if (!Array.isArray(body_Obj[prop][attr].acr)) {
                                        callback('400-12');
                                        return;
                                    }
                                    var acr = body_Obj[prop][attr].acr;
                                    for (var acr_idx in acr) {
                                        if (acr.hasOwnProperty(acr_idx)) {
                                            if (acr[acr_idx].acor) {
                                                if (!Array.isArray(acr[acr_idx].acor)) {
                                                    callback('400-13');
                                                    return;
                                                }
                                            }
                                            if (acr[acr_idx].acco) {
                                                if (!Array.isArray(acr[acr_idx].acco)) {
                                                    callback('400-14');
                                                    return;
                                                }
                                                for (var acco_idx in acr[acr_idx].acco) {
                                                    if (acr[acr_idx].acco.hasOwnProperty(acco_idx)) {
                                                        var acco = acr[acr_idx].acco[acco_idx];
                                                        if (acco.acip) {
                                                            if (acco.acip['ipv4']) {
                                                                if (!Array.isArray(acco.acip['ipv4'])) {
                                                                    callback('400-15');
                                                                    return;
                                                                }
                                                            }
                                                            else if (acco.acip['ipv6']) {
                                                                if (!Array.isArray(acco.acip['ipv6'])) {
                                                                    callback('400-16');
                                                                    return;
                                                                }
                                                            }
                                                        }
                                                        if (acco.actw) {
                                                            if (!Array.isArray(acco.actw)) {
                                                                callback('400-17');
                                                                return;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            else if (attr == 'uds') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    callback('400-18');
                                    return;
                                }
                            }
                            else if (attr == 'cas') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    callback('400-18');
                                    return;
                                }
                            }
                            else {
                            }
                        }
                    }
                }
            }
            callback(code);
        }
        else {
            callback(code);
        }
    });
}

function check_resource(request, response, callback) {
    var ri = url.parse(request.url).pathname;

    var chk_fopt = ri.split('/fopt');
    if (chk_fopt.length == 2) {
        ri = chk_fopt[0];
        db_sql.select_grp_lookup(request.db_connection, ri, (err, result_Obj) => {
            if (!err) {
                if (result_Obj.length == 1) {
                    result_Obj[0].acpi = JSON.parse(result_Obj[0].acpi);
                    result_Obj[0].lbl = JSON.parse(result_Obj[0].lbl);
                    result_Obj[0].aa = JSON.parse(result_Obj[0].aa);
                    result_Obj[0].at = JSON.parse(result_Obj[0].at);

                    request.targetObj = JSON.parse(JSON.stringify(result_Obj[0]));
                    result_Obj = null;

                    callback('200');
                }
                else {
                    callback('404-4');
                }
            }
            else {
                callback('500-3');
            }
        });
    }
    else {
        console.log('X-M2M-Origin: ' + request.headers['x-m2m-origin']);
        callback('200');
    }
}

function check_request_query_rt(request, response, callback) {
    //var ri = url.parse(request.url).pathname;

    //var url_arr = ri.split('/');
    //var last_url = url_arr[url_arr.length-1];
    //var op = 'direct';

    if (request.query.rt == 3) { // default, blocking
        callback('200');
    }
    else if (request.query.rt == 1 || request.query.rt == 2) { // nonblocking
        if (request.query.rt == 2 && request.headers['x-m2m-rtu'] == null && request.headers['x-m2m-rtu'] == '') {
            callback('400-21');
        }
        else {
            // first create request resource under CSEBase
            var temp_rootnm = request.headers.rootnm;
            var temp_body_Obj = JSON.parse(JSON.stringify(request.bodyObj));
            var temp_ty = request.ty;


            request.ty = '17';
            var rt_body_Obj = {req: {}};
            request.headers.rootnm = 'req';
            request.bodyObj = rt_body_Obj;
            request.query.rt = 3;

            resource.create(request, response, (code) => {
                if (code === '200') {
                    request.ty = temp_ty;
                    request.headers.rootnm = temp_rootnm;
                    request.bodyObj = temp_body_Obj;
                    request.query.rt = 1;
                    callback(code);
                }
                else {
                    callback(code);
                }
            });
        }
    }
    else {
        callback('405-4');
    }
}

function check_grp(request, response, callback) {
    var result_Obj = request.targetObject;
    var rootnm = Object.keys(result_Obj)[0];

    if (result_Obj[rootnm].ty == 9) {
        if (result_Obj[rootnm].mid.length == 0) {
            result_Obj = {};
            result_Obj['dbg'] = 'NO_MEMBERS: memberID in parent group is empty';
            responder.response_result(request, response, '403', result_Obj, '4109', request.url, result_Obj['dbg']);
            callback('2');
            return '0';
        }
        else {
            callback('1', result_Obj[rootnm]);
            return '1';
        }
    }
    else {
        result_Obj = {};
        result_Obj['dbg'] = '[check_grp] resource does not exist';
        responder.response_result(request, response, '404', result_Obj, '4004', request.url, result_Obj['dbg']);
        callback('0');
        return '0';
    }
}

// 결과 코드 표는 mobius/reason.js 가 만든다. 형태는 { key: [status, rsc, msg] } 로
// 예전과 같아서 아래 호출부들이 그대로 동작한다.
//   결과 코드·바인딩 매핑 -> mobius/rsc.js
//   사유별 문구          -> mobius/reason.js
// 결과 코드와 사유는 카탈로그가 들고 있다.
//   mobius/rsc.js     결과 코드 + 바인딩 매핑(http/coap)
//   mobius/reason.js  사유별 문구
//
// 에러 응답은 전부 아래 response_error_result(request, response, code, cb) 를 거친다.
// 예전의 { key: [status, rsc, msg] } 호환 표는 읽는 곳이 없어져 걷어냈다.
// (reason.toLegacyTable() 은 골든 하네스와 테스트가 아직 쓴다)
var reason = require('./mobius/reason');
var RSC = require('./mobius/rsc').RSC;

// 에러 응답의 단일 통로. 코드 키('400-8')만 넘기면 나머지는 카탈로그가 채운다.
//
// 예전에는 호출부마다 resultStatusCode[code][0], [1], [2] 를 직접 펼쳐 넘겼다.
// 표의 3원소 배열 구조가 47곳에 새어 나가 있어서, 표에 필드를 하나 더하려면
// 그 47곳을 전부 봐야 했다.
function response_error_result(request, response, code, callback) {
    var r = reason.get(code);
    if (!r) {
        // 표에 없는 코드. 예전에는 resultStatusCode[code][0] 에서 TypeError 가 나
        // 워커가 죽었다. 500 으로 응답하고 로그에 남긴다.
        console.error('[response_error_result] 정의되지 않은 코드: ' + code);
        responder.respond(request, response, {
            code: RSC.INTERNAL_SERVER_ERROR,
            dbg: 'internal error',
            detail: 'unknown result code: ' + code
        }, callback);
        return;
    }
    responder.respond(request, response, { code: r.code, dbg: r.msg }, callback);
}

function lookup_create(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code === '200') {
            var parentObj = request.targetObject[Object.keys(request.targetObject)[0]];

            tr.check(request, (code) => {
                if (code === '200') {
                    if ((request.ty == 1) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // accessControlPolicy
                    }
                    else if ((request.ty == 9) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // group
                    }
                    else if ((request.ty == 16) && (parentObj.ty == 5)) { // remoteCSE
                        if (usecsetype == 'asn' && request.headers.csr == null) {
                            callback('400-28');
                            return;
                        }
                    }
                    else if ((request.ty == 10) && (parentObj.ty == 5)) { // locationPolicy
                    }
                    else if ((request.ty == 2) && (parentObj.ty == 5)) { // ae
                    }
                    else if ((request.ty == 3) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3)) { // container
                    }
                    else if ((request.ty == 23) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27 || parentObj.ty == 28)) { // sub
                    }
                    else if ((request.ty == 4) && (parentObj.ty == 3)) { // contentInstance
                    }
                    else if ((request.ty == 24) && (parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 4)) { // semanticDescriptor
                    }
                    else if ((request.ty == 27) && (parentObj.ty == 2 || parentObj.ty == 16)) { // multimediaSession
                    }
                    else if ((request.ty == 14) && (parentObj.ty == 5)) { // node
                    }
                    else if ((request.ty == 13) && (parentObj.ty == 14)) { // mgmtObj
                    }
                    else if ((request.ty == 38) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27)) { // transaction
                    }
                    else if ((request.ty == 39) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27)) { // transaction
                    }
                    else if ((request.ty == 28) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 28)) { // flexcontainer
                    }
                    else if ((request.ty == 98 || request.ty == 97 || request.ty == 96 || request.ty == 95 || request.ty == 94 || request.ty == 93 || request.ty == 92 || request.ty == 91) && (parentObj.ty == 28)) { // flexcontainer
                    }
                    else {
                        callback('403-2');
                        return;
                    }

                    if ((request.ty == 4) && (parentObj.ty == 3)) { // contentInstance
                        if (parseInt(parentObj.mni) == 0) {
                            callback('406-1');
                            return;
                        }
                        else if (parseInt(parentObj.mbs) == 0) {
                            callback('406-2');
                            return;
                        }
                        else if (parentObj.disr == true) {
                            callback('405-6');
                            return;
                        }

                        request.headers.mni = parentObj.mni;
                        request.headers.mbs = parentObj.mbs;
                        request.headers.cni = parentObj.cni;
                        request.headers.cbs = parentObj.cbs;
                        request.headers.st = parentObj.st;
                    }

                    if (parentObj.length == 0) {
                        parentObj = {};
                        parentObj.cr = '';
                        console.log('no creator');
                    }
                    else {
                        if (parentObj.ty == 2) {
                            parentObj.cr = parentObj.aei;
                        }
                    }

                    if (request.ty == 23) {
                        var access_value = '3';
                    }
                    else {
                        access_value = '1';
                    }

                    var tid = 'security.check - ' + require('shortid').generate();
                    console.time(tid);
                    security.check(request, response, parentObj.ty, parentObj.acpi, access_value, parentObj.cr, (code) => {
                        console.timeEnd(tid);

                        cache_security_check[request.headers['x-m2m-origin']] = {};
                        cache_security_check[request.headers['x-m2m-origin']][parentObj.ri] = {}
                        cache_security_check[request.headers['x-m2m-origin']][parentObj.ri][access_value] = code;

                        if (code === '1') {
                            resource.create(request, response, (code) => {
                                callback(code);
                            });
                        }
                        else if (code === '0') {
                            callback('403-3');

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
        }
        else {
            callback(code);
        }
    });
}

function lookup_retrieve(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code === '200') {
            var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

            if(!resultObj.hasOwnProperty('acpi')) {
                resultObj.acpi = [];
            }

            tr.check(request, (code) => {
                if (code === '200') {
                    if (resultObj.ty == 2) {
                        resultObj.cr = resultObj.aei;
                    }
                    else if (resultObj.ty == 16) {
                        resultObj.cr = resultObj.csi;
                    }

                    if (request.query.fu == 1) {
                        security.check(request, response, resultObj.ty, resultObj.acpi, '32', resultObj.cr, (code) => {
                            if (code === '1') {
                                resource.retrieve(request, response, (code) => {
                                    callback(code);
                                });
                            }
                            else if (code === '0') {
                                callback('403-3');
                            }
                            else {
                                callback(code);
                            }
                        });
                    }
                    else {
                        security.check(request, response, resultObj.ty, resultObj.acpi, '2', resultObj.cr, (code) => {
                            if (code === '1') {
                                resource.retrieve(request, response, (code) => {
                                    callback(code);
                                });
                            }
                            else if (code === '0') {
                                callback('403-3');
                            }
                            else {
                                callback(code);
                            }
                        });
                    }
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
}

function lookup_update(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code === '200') {
            var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

            tr.check(request, (code) => {
                if (code === '200') {
                    if (resultObj.ty == 2) {
                        resultObj.cr = resultObj.aei;
                    }
                    else if (resultObj.ty == 16) {
                        resultObj.cr = resultObj.csi;
                    }

                    var acpi_check = 0;
                    var other_check = 0;
                    for (var rootnm in request.bodyObj) {
                        if (request.bodyObj.hasOwnProperty(rootnm)) {
                            for (var attr in request.bodyObj[rootnm]) {
                                if (request.bodyObj[rootnm].hasOwnProperty(attr)) {
                                    if (attr == 'acpi') {
                                        acpi_check++;
                                    }
                                    else {
                                        other_check++;
                                    }
                                }
                            }
                        }
                    }

                    if (other_check > 0) {
                        security.check(request, response, resultObj.ty, resultObj.acpi, '4', resultObj.cr, (code) => {
                            if (code === '1') {
                                resource.update(request, response, (code) => {
                                    callback(code)
                                });
                            }
                            else if (code === '0') {
                                callback('403-3');
                            }
                            else {
                                callback(code);
                            }
                        });
                    }
                    else {
                        resource.update(request, response, (code) => {
                            callback(code)
                        });
                    }
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
}

function lookup_delete(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code === '200') {
            var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

            tr.check(request, (code) => {
                if (code === '200') {
                    if (resultObj.ty == 2) {
                        resultObj.cr = resultObj.aei;
                    }
                    else if (resultObj.ty == 16) {
                        resultObj.cr = resultObj.csi;
                    }

                    security.check(request, response, resultObj.ty, resultObj.acpi, '8', resultObj.cr, (code) => {
                        if (code === '1') {
                            resource.delete(request, response, (code) => {
                                callback(code);
                            });
                        }
                        else if (code === '0') {
                            callback('403-3');
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
        }
        else {
            callback(code);
        }
    });
}

function check_resource_from_url(connection, ri, sri, callback) {
    if(cache_resource_url.hasOwnProperty(ri)) {
        callback(cache_resource_url[ri], 200);
    }
    else {
        db_sql.select_resource_from_url(connection, ri, sri, (err, results) => {
            if (err) {
                callback(null, 500);
            }
            else {
                if (results.length === 0) {
                    callback(null, 404);
                }
                else {
                    cache_resource_url[ri] = JSON.parse(JSON.stringify(results[0]));
                    callback(results[0], 200);
                }
            }
        });
    }
}

function get_resource_from_url(connection, ri, sri, option, callback) {
    var targetObject = {};

    check_resource_from_url(connection, ri, sri, (result, code) => {
        if(code === 200) {
            var ty = result.ty;
            targetObject[responder.typeRsrc[ty]] = result;
            var rootnm = Object.keys(targetObject)[0];
            makeObject(targetObject[rootnm]);

            if (option == '/latest') {
                // if(cache_resource_url.hasOwnProperty(ri + '/la')) {
                //
                //     ty = cache_resource_url[ri + '/la'].ty;
                //     targetObject = {};
                //     targetObject[responder.typeRsrc[ty]] = JSON.parse(JSON.stringify(cache_resource_url[ri + '/la']));
                //     rootnm = Object.keys(targetObject)[0];
                //     makeObject(targetObject[rootnm]);
                //
                //     console.log(targetObject);
                //
                //     callback(targetObject, 200);
                // }
                // else {
                    var la_id = 'select_latest_resource ' + targetObject[rootnm].ri + ' - ' + require('shortid').generate();
                    console.time(la_id);
                    var latestObj = [];
                    db_sql.select_latest_resource(connection, targetObject[rootnm], 0, latestObj, (code) => {
                        console.timeEnd(la_id);
                        if (code === '200') {
                            if (latestObj.length == 1) {

                                let strLatestObj = JSON.stringify(latestObj[0]).replace('RowDataPacket ', '');

                                latestObj[0] = JSON.parse(strLatestObj);

                                targetObject = {};
                                targetObject[responder.typeRsrc[latestObj[0].ty]] = latestObj[0];
                                makeObject(targetObject[Object.keys(targetObject)[0]]);

                                //cache_resource_url[latestObj[0].pi + '/la'] = targetObject[Object.keys(targetObject)[0]];
                                //console.log(cache_resource_url);

                                callback(targetObject);
                            }
                            else {
                                callback(null, 404);
                                return '0';
                            }
                        }
                        else {
                            callback(null, 500);
                            return '0';
                        }
                    });
                // }
            }
            else if (option == '/oldest') {
                var oldestObj = [];
                db_sql.select_oldest_resource(connection, parseInt(ty, 10) + 1, ri, oldestObj, (code) => {
                    if (code === '200') {
                        if (oldestObj.length == 1) {
                            targetObject = {};
                            targetObject[responder.typeRsrc[oldestObj[0].ty]] = oldestObj[0];
                            makeObject(targetObject[Object.keys(targetObject)[0]]);
                            callback(targetObject);
                        }
                        else {
                            callback(null, 404);
                            return '0';
                        }
                    }
                    else {
                        callback(null, 500);
                        return '0';
                    }
                });
            }
            else if (option == '/fopt') {
                callback(targetObject, 200);
            }
            else {
                callback(targetObject, 200);
            }
        }
        else {
            callback(result, code);
        }
    });
}

function extra_api_action(connection, url, callback) {
    if (url == '/hit') {
        // for backup hit count
        if (0) {
            var _hit_old = JSON.parse(fs.readFileSync('hit.json', 'utf-8'));
            var _http = 0;
            var _mqtt = 0;
            var _coap = 0;
            var _ws = 0;

            for (var dd in _hit_old) {
                if (_hit_old.hasOwnProperty(dd)) {
                    for (var ff in _hit_old[dd]) {
                        if (_hit_old[dd].hasOwnProperty(ff)) {
                            if (Object.keys(_hit_old[dd][ff]).length > 0) {
                                for (var gg in _hit_old[dd][ff]) {
                                    if (_hit_old[dd][ff].hasOwnProperty(gg)) {
                                        if (_hit_old[dd][ff][gg] == null) {
                                            _hit_old[dd][ff][gg] = 0;
                                        }
                                        if (gg == 'H') {
                                            _http = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'M') {
                                            _mqtt = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'C') {
                                            _coap = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'W') {
                                            _ws = _hit_old[dd][ff][gg];
                                        }
                                    }
                                }

                                db_sql.set_hit_n(connection, dd, _http, _mqtt, _coap, _ws, (err, results) => {
                                    results = null;
                                });
                            }
                        }
                    }
                }
            }
        }

        if (0) {
            var count = 0;
            setTimeout((count) => {
                if (count > 250) {
                    return;
                }
                var dd = moment().utc().subtract(count, 'days').format('YYYYMMDD');
                var _http = 5000 + Math.random() * 50000;
                var _mqtt = 1000 + Math.random() * 9000;
                var _coap = 0;
                var _ws = 0;

                db_sql.set_hit_n(connection, dd, _http, _mqtt, _coap, _ws, (err, results) => {
                    results = null;
                    console.log(count);
                    setTimeout(random_hit, 100, ++count);
                });
            }, 100, count);
        }

        db_sql.get_hit_all(connection, (err, result) => {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else if (url == '/total_ae') {
        db_sql.select_sum_ae(connection, function (err, result) {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else if (url == '/total_cbs') {
        db_sql.select_sum_cbs(connection, function (err, result) {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else {
        callback('200');
    }
}

function check_xm2m_headers(request, callback) {
    // Check X-M2M-RI Header
    if (request.headers.hasOwnProperty('x-m2m-ri')) {
        if (request.headers['x-m2m-ri'] === '') {
            callback('400-1');
            return;
        }
    }
    else {
        callback('400-1');
        return;
    }

    // Check X-M2M-RVI Header
    if (!request.headers.hasOwnProperty('x-m2m-rvi')) {
        request.headers['x-m2m-rvi'] = uservi;
    }

    request.ty = '99';
    if (request.headers.hasOwnProperty('content-type')) {
        var content_type = request.headers['content-type'].split(';');
        for (var i in content_type) {
            if (content_type.hasOwnProperty(i)) {
                var ty_arr = content_type[i].replace(/ /g, '').split('=');
                if (ty_arr[0].replace(/ /g, '') == 'ty') {
                    request.ty = ty_arr[1].replace(' ', '');
                    content_type = null;
                    break;
                }
            }
        }

        if (request.ty == '5') {
            callback('405-1');
            return;
        }

        if (request.ty == '17') {
            callback('405-2');
            return;
        }

        if (request.headers['content-type'].includes('xml')) {
            request.usebodytype = 'xml';
        }
        else if (request.headers['content-type'].includes('cbor')) {
            request.usebodytype = 'cbor';
        }
        else {
            request.usebodytype = 'json';
        }
    }
    else {
        request.usebodytype = 'json';
    }

    // Check X-M2M-Origin Header
    if (request.headers.hasOwnProperty('x-m2m-origin')) {
        if (request.headers['x-m2m-origin'] === '') {
            if (request.ty == '2' || request.ty == '16') {
                request.headers['x-m2m-origin'] = 'S';
            }
            else {
                callback('400-2');
                return;
            }
        }
    }
    else {
        callback('400-2');
        return;
    }

    if (!request.query.hasOwnProperty('fu')) {
        request.query.fu = 2;
    }

    if (!request.query.hasOwnProperty('rcn')) {
        request.query.rcn = 1;
    }

    if (!request.query.hasOwnProperty('rt')) {
        request.query.rt = 3;
    }

    var allow = 1;
    if (allowed_ae_ids.length > 0) {
        allow = 0;
        for (var idx in allowed_ae_ids) {
            if (allowed_ae_ids.hasOwnProperty(idx)) {
                if (usecseid == request.headers['x-m2m-origin']) {
                    allow = 1;
                    break;
                }
                else if (allowed_ae_ids[idx] == request.headers['x-m2m-origin']) {
                    allow = 1;
                    break;
                }
            }
        }

        if (allow == 0) {
            callback('403-1');
            return;
        }
    }

    if (!responder.typeRsrc.hasOwnProperty(request.ty)) {
        callback('405-3');
        return;
    }

    callback('200');
}

function check_resource_supported(request, response, callback) {
    make_json_obj(request.usebodytype, request.body, (err, body) => {
        try {
            var arr_rootnm = Object.keys(body)[0].split(':');

            if(arr_rootnm[0] === 'hd') {
                var rootnm = Object.keys(body)[0].replace('hd:', 'hd_');
            }
            else {
                rootnm = Object.keys(body)[0].replace('m2m:', '');
            }

            var checkCount = 0;
            for (var key in responder.typeRsrc) {
                if (responder.typeRsrc.hasOwnProperty(key)) {
                    if (responder.typeRsrc[key] == rootnm) {
                        request.ty = key;
                        break;
                    }
                    checkCount++;
                }
            }
            body = null;

            if (checkCount >= Object.keys(responder.typeRsrc).length) {
                callback('400-3');
            }
            else {
                callback('200');
            }
        }
        catch (e) {
            callback('400-4');
        }
    });
}

function get_target_url(request, response, callback) {
    request.url = request.url.replace('%23', '#'); // convert '%23' to '#' of url
    request.hash = url.parse(request.url).hash;

    var absolute_url = request.url.replace('\/_\/', '\/\/').split('#')[0];
    absolute_url = absolute_url.replace(usespid, '/~');
    absolute_url = absolute_url.replace(/\/~\/[^\/]+\/?/, '/');
    var absolute_url_arr = absolute_url.split('/');

    console.log('\n' + request.method + ' : ' + request.url);
    request.bodyObj = {};

    request.option = '';
    request.sri = absolute_url_arr[1].split('?')[0];
    if (absolute_url_arr[absolute_url_arr.length - 1] == 'la') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-3);
            request.option = '/latest';
        }
        else {
            // return 이 없으면 아래 get_resource_from_url 까지 실행이 흘러 콜백이 두 번
            // 불린다. 첫 호출이 409 를 보내고 핸들러가 request = null 로 지운 뒤라
            // 두 번째 호출은 error_result 에서 request.query 를 읽다 워커를 죽였다.
            callback('409-1');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'latest') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-7);
            request.option = '/latest';
        }
        else {
            // return 이 없으면 아래 get_resource_from_url 까지 실행이 흘러 콜백이 두 번
            // 불린다. 첫 호출이 409 를 보내고 핸들러가 request = null 로 지운 뒤라
            // 두 번째 호출은 error_result 에서 request.query 를 읽다 워커를 죽였다.
            callback('409-1');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'ol') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-3);
            request.option = '/oldest';
        }
        else {
            // 위와 같은 이유로 return 이 필요하다 (콜백 중복 호출 -> 워커 크래시)
            callback('409-2');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'oldest') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-7);
            request.option = '/oldest';
        }
        else {
            // 위와 같은 이유로 return 이 필요하다 (콜백 중복 호출 -> 워커 크래시)
            callback('409-2');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'fopt') {
        request.ri = absolute_url.split('?')[0].replace('/fopt', '');
        request.option = '/fopt';
    }
    else {
        request.ri = absolute_url.split('?')[0];
        request.option = '';
    }

    request.absolute_url = absolute_url;
    absolute_url = null;
    var tid = require('shortid').generate();
    console.time('get_resource_from_url' + ' (' + tid + ') - ' + request.absolute_url);
    get_resource_from_url(request.db_connection, request.ri, request.sri, request.option, (targetObject, status) => {
        console.timeEnd('get_resource_from_url' + ' (' + tid + ') - ' + request.absolute_url);
        if (status == 404) {
            if (url.parse(request.absolute_url).pathname.split('/')[1] == usecsebase) {
                callback('404-1');
            }
            else {
                callback('301-1');
            }
        }
        else if (status == 500) {
            callback('500-1');
        }
        else {
            if (targetObject) {
                request.targetObject = JSON.parse(JSON.stringify(targetObject));
                targetObject = null;

                callback('200');
            }
            else {
                callback('404-1');
            }
        }
    });
}

function check_allowed_app_ids(request, callback) {
    if (responder.typeRsrc[request.ty] != Object.keys(request.bodyObj)[0]) {
        if (responder.typeRsrc[request.ty] == 'mgo') {
            var support_mgo = 0;
            for (var prop in responder.mgoType) {
                if (responder.mgoType.hasOwnProperty(prop)) {
                    if (responder.mgoType[prop] == Object.keys(request.bodyObj)[0]) {
                        support_mgo = 1;
                        break;
                    }
                }
            }

            if (support_mgo == 0) {
                callback('400-42');
                return;
            }
        }
        else {
            callback('400-42');
            return;
        }
    }

    if (request.ty == '2') {
        var allow = 1;
        if (allowed_app_ids.length > 0) {
            allow = 0;
            for (var idx in allowed_app_ids) {
                if (allowed_app_ids.hasOwnProperty(idx)) {
                    if (allowed_app_ids[idx] == request.bodyObj.ae.api) {
                        allow = 1;
                        break;
                    }
                }
            }
            if (allow == 0) {
                callback('403-4');
                return;
            }
        }
    }

    callback('200');
}

function check_type_update_resource(request, callback) {
    for (var ty_idx in responder.typeRsrc) {
        if (responder.typeRsrc.hasOwnProperty(ty_idx)) {
            if ((ty_idx == 4) && (responder.typeRsrc[ty_idx] == Object.keys(request.bodyObj)[0])) {
                callback('405-7');
                return;
            }
            else if ((ty_idx != 4) && (responder.typeRsrc[ty_idx] == Object.keys(request.bodyObj)[0])) {
                if ((ty_idx == 17) && (responder.typeRsrc[ty_idx] == Object.keys(request.bodyObj)[0])) {
                    callback('405-8');
                    return;
                }
                else {
                    request.ty = ty_idx;
                    break;
                }
            }
            else if (ty_idx == 13) {
                for (var mgo_idx in responder.mgoType) {
                    if (responder.mgoType.hasOwnProperty(mgo_idx)) {
                        if ((responder.mgoType[mgo_idx] == Object.keys(request.bodyObj)[0])) {
                            request.ty = ty_idx;
                            break;
                        }
                    }
                }
            }
        }
    }

    if (url.parse(request.targetObject[Object.keys(request.targetObject)[0]].ri).pathname == ('/' + usecsebase)) {
        callback('405-9');
        return;
    }

    callback('200');
}

function check_type_delete_resource(request, callback) {
    if (url.parse(request.targetObject[Object.keys(request.targetObject)[0]].ri).pathname == ('/' + usecsebase)) {
        callback('405-9');
    }
    else {
        callback('200');
    }
}

var onem2mParser = bodyParser.text(
    {
        limit: '5mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);

//////// contribution code
// Kevin Lee, Executive Director, Unibest INC, Owner of Howchip.com
// Process for CORS problem
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
    res.header('Access-Control-Expose-Headers', 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
    (req.method == 'OPTIONS') ? res.sendStatus(200) : next();
});

// var heapdump = require('heapdump');
// app.use('/heapdump',function(req,res,next){
//     var filename = Date.now() + '.heapsnapshot';
//     heapdump.writeSnapshot(filename);
//     res.send('Heapdump has been generated in '+filename);
// });

// var graphqlHTTP = require('express-graphql');
// var { buildSchema } = require('graphql');
//
// var schema = buildSchema(`
//     type Query {
//         hello: String
//     }
// `);
//
// var root = { hello: () => 'Hello world!' };
//
// app.use('/' + usecsebase + '/discovery', graphqlHTTP({
//     schema: schema,
//     rootValue: root,
//     graphiql: true,
// }));

// remoteCSE, ae, cnt
app.post('*', onem2mParser, (request, response) => {
    var fullBody = '';
    request.on('data', (chunk) => {
        fullBody += chunk.toString();
    });

    request.on('end', () => {
        request.body = fullBody;

        var binding = request.headers['binding'] || 'H';   // request 참조를 동기 시점으로 이동
        db.getConnection((code, connection) => {
            if (code === '200') {
                db_sql.set_hit(connection, binding, (err, results) => {
                    results = null;
                    connection.release();
                });
            }
        });
        // db.getConnection((code, connection) => {
        //     if (code === '200') {
        //         if (!request.headers.hasOwnProperty('binding')) {
        //             request.headers['binding'] = 'H';
        //         }

        //         db_sql.set_hit(connection, request.headers['binding'], (err, results) => {
        //             results = null;

        //             connection.release();
        //         });
        //     }
        // });

        db.getConnection((code, connection) => {
            if (code === '200') {
                request.db_connection = connection;

                check_xm2m_headers(request, (code) => {
                    if (code === '200') {
                        if (request.body !== "") {
                            check_resource_supported(request, response, (code) => {
                                if (code === '200') {
                                    get_target_url(request, response, (code) => {
                                        if (code === '200') {
                                            if (request.option !== '/fopt') {
                                                parse_body_format(request, response, (code) => {
                                                    if (code === '200') {
                                                        check_allowed_app_ids(request, (code) => {
                                                            if (code === '200') {
                                                                var rootnm = Object.keys(request.targetObject)[0];
                                                                var absolute_url = request.targetObject[rootnm].ri;
                                                                check_notification(request, response, (code) => {
                                                                    if (code === 'post') {
                                                                        request.url = absolute_url;
                                                                        if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1 || request.query.rcn == 2 || request.query.rcn == 3)) {
                                                                            lookup_create(request, response, (code) => {
                                                                                if (code === '201') {
                                                                                    responder.response_result(request, response, '201', '2001', '', () => {
                                                                                        connection.release();
                                                                                        request = null;
                                                                                        response = null;
                                                                                    });
                                                                                }
                                                                                else if (code === '201-3') {
                                                                                    responder.response_rcn3_result(request, response, '201', '2001', '', () => {
                                                                                        connection.release();
                                                                                        request = null;
                                                                                        response = null;
                                                                                    });
                                                                                }
                                                                                else if (code === '202-1') {
                                                                                    responder.response_result(request, response, '202', '1001', '', () => {
                                                                                        connection.release();
                                                                                        request = null;
                                                                                        response = null;
                                                                                    });
                                                                                }
                                                                                else if (code === '202-2') {
                                                                                    responder.response_result(request, response, '202', '1002', '', () => {
                                                                                        connection.release();
                                                                                        request = null;
                                                                                        response = null;
                                                                                    });
                                                                                }
                                                                                else {
                                                                                    response_error_result(request, response, code, () => {
                                                                                        connection.release();
                                                                                        request = null;
                                                                                        response = null;
                                                                                    });
                                                                                }
                                                                            });
                                                                        }
                                                                        else {
                                                                            code = '400-43';
                                                                            response_error_result(request, response, code, () => {
                                                                                connection.release();
                                                                                request = null;
                                                                                response = null;
                                                                            });
                                                                        }
                                                                    }
                                                                    else if (code === 'notify') {
                                                                        check_ae_notify(request, response, (code, res) => {
                                                                            if (code === '200') {
                                                                                connection.release();

                                                                                if (res.headers['content-type']) {
                                                                                    response.header('Content-Type', res.headers['content-type']);
                                                                                }
                                                                                if (res.headers['x-m2m-ri']) {
                                                                                    response.header('X-M2M-RI', res.headers['x-m2m-ri']);
                                                                                }
                                                                                if (res.headers['x-m2m-rvi']) {
                                                                                    response.header('X-M2M-RVI', res.headers['x-m2m-rvi']);
                                                                                }
                                                                                if (res.headers['x-m2m-rsc']) {
                                                                                    response.header('X-M2M-RSC', res.headers['x-m2m-rsc']);
                                                                                }
                                                                                if (res.headers['content-location']) {
                                                                                    response.header('Content-Location', res.headers['content-location']);
                                                                                }

                                                                                response.statusCode = res.statusCode;
                                                                                response.send(res.body);

                                                                                res = null;
                                                                                request = null;
                                                                                response = null;
                                                                            }
                                                                            else {
                                                                                response_error_result(request, response, code, () => {
                                                                                    connection.release();
                                                                                    request = null;
                                                                                    response = null;
                                                                                });
                                                                            }
                                                                        });
                                                                    }
                                                                    else {
                                                                        response_error_result(request, response, code, () => {
                                                                            connection.release();
                                                                            request = null;
                                                                            response = null;
                                                                        });
                                                                    }
                                                                });
                                                            }
                                                            else {
                                                                response_error_result(request, response, code, () => {
                                                                    connection.release();
                                                                    request = null;
                                                                    response = null;
                                                                });
                                                            }
                                                        });
                                                    }
                                                    else {
                                                        response_error_result(request, response, code, () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                });
                                            }
                                            else { // if (request.option === '/fopt') {
                                                check_grp(request, response, (rsc, result_grp) => { // check access right for fanoutpoint
                                                    if (rsc == '1') {
                                                        var access_value = '1';
                                                        var body_Obj = {};
                                                        security.check(request, response, request.targetObject[Object.keys(request.targetObject)[0]].ty, result_grp.macp, access_value, result_grp.cr, (code) => {
                                                            if (code === '1') {
                                                                parse_body_format(request, response, (code) => {
                                                                    if (code === '200') {
                                                                        fopt.check(request, response, result_grp, body_Obj, (code) => {
                                                                            if (code === '200') {
                                                                                responder.search_result(request, response, '200', '2000', '', () => {
                                                                                    connection.release();
                                                                                    request = null;
                                                                                    response = null;
                                                                                });
                                                                            }
                                                                            else {
                                                                                response_error_result(request, response, code, () => {
                                                                                    connection.release();
                                                                                    request = null;
                                                                                    response = null;
                                                                                });
                                                                            }
                                                                        });
                                                                    }
                                                                    else {
                                                                        response_error_result(request, response, code, () => {
                                                                            connection.release();
                                                                            request = null;
                                                                            response = null;
                                                                        });
                                                                    }
                                                                });
                                                            }
                                                            else if (code === '0') {
                                                                response_error_result(request, response, '403-5', () => {
                                                                    connection.release();
                                                                    request = null;
                                                                    response = null;
                                                                });
                                                            }
                                                            else {
                                                                response_error_result(request, response, code, () => {
                                                                    connection.release();
                                                                    request = null;
                                                                    response = null;
                                                                });
                                                            }
                                                        });
                                                    }
                                                    else if (rsc == '2') {
                                                        code = '403-6';
                                                        response_error_result(request, response, code, () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                    else {
                                                        code = '404-4';
                                                        response_error_result(request, response, code, () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                });
                                            }
                                        }
                                        else if (code === '301-1') {
                                            check_csr(request, response, (code) => {
                                                if (code === '301-2') {
                                                    response.status(response.statusCode).end(response.body);
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                }
                                                else {
                                                    response_error_result(request, response, code, () => {
                                                        connection.release();
                                                        request = null;
                                                        response = null;
                                                    });
                                                }
                                            });
                                        }
                                        else {
                                            response_error_result(request, response, code, () => {
                                                connection.release();
                                                request = null;
                                                response = null;
                                            });
                                        }
                                    });
                                }
                                else {
                                    response_error_result(request, response, code, () => {
                                        connection.release();
                                        request = null;
                                        response = null;
                                    });
                                }
                            });
                        }
                        else {
                            response_error_result(request, response, '400-40', () => {
                                connection.release();
                                request = null;
                                response = null;
                            });
                        }
                    }
                    else {
                        response_error_result(request, response, code, () => {
                            connection.release();
                            request = null;
                            response = null;
                        });
                    }
                });
            }
            else {
                response_error_result(request, response, code, () => {
                    request = null;
                    response = null;
                });
            }
        });
    });
});

app.get('*', onem2mParser, (request, response) => {
    var fullBody = '';
    request.on('data', (chunk) => {
        fullBody += chunk.toString();
    });

    request.on('end', () => {
        request.body = fullBody;

        db.getConnection((code, connection) => {
            if (code === '200') {
                request.db_connection = connection;

                extra_api_action(connection, request.url, (code, result) => {
                    if (code === '200') {
                        if (!request.headers.hasOwnProperty('binding')) {
                            request.headers['binding'] = 'H';
                        }

                        db_sql.set_hit(request.db_connection, request.headers['binding'], (err, results) => {
                            results = null;
                        });

                        check_xm2m_headers(request, (code) => {
                            if (code === '200') {
                                get_target_url(request, response, (code) => {
                                    if (code === '200') {
                                        if (request.option !== '/fopt') {
                                            var rootnm = Object.keys(request.targetObject)[0];
                                            request.url = request.targetObject[rootnm].ri;
                                            if ((request.query.fu == 1 || request.query.fu == 2) && (request.query.rcn == 1 || request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6 || request.query.rcn == 7)) {
                                                lookup_retrieve(request, response, (code) => {
                                                    if (code === '200') {
                                                        responder.response_result(request, response, '200', '2000', '', () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                    else if (code === '200-1') {
                                                        responder.search_result(request, response, '200', '2000', '', () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                    else {
                                                        response_error_result(request, response, code, () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                });
                                            }
                                            else {
                                                response_error_result(request, response, '400-44', () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                        }
                                        else { //if (request.option === '/fopt') {
                                            check_grp(request, response, (rsc, result_grp) => { // check access right for fanoutpoint
                                                if (rsc == '1') {
                                                    var access_value = (request.query.fu == 1) ? '32' : '2';
                                                    var body_Obj = {};
                                                    security.check(request, response, request.targetObject[Object.keys(request.targetObject)[0]].ty, result_grp.macp, access_value, result_grp.cr, (code) => {
                                                        if (code === '1') {
                                                            fopt.check(request, response, result_grp, body_Obj, (code) => {
                                                                if (code === '200') {
                                                                    responder.search_result(request, response, '200', '2000', '', () => {
                                                                        connection.release();
                                                                        request = null;
                                                                        response = null;
                                                                    });
                                                                }
                                                                else {
                                                                    response_error_result(request, response, code, () => {
                                                                        connection.release();
                                                                        request = null;
                                                                        response = null;
                                                                    });
                                                                }
                                                            });
                                                        }
                                                        else if (code === '0') {
                                                            response_error_result(request, response, '403-5', () => {
                                                                connection.release();
                                                                request = null;
                                                                response = null;
                                                            });
                                                        }
                                                        else {
                                                            response_error_result(request, response, code, () => {
                                                                connection.release();
                                                                request = null;
                                                                response = null;
                                                            });
                                                        }
                                                    });
                                                }
                                                else if (rsc == '2') {
                                                    code = '403-6';
                                                    response_error_result(request, response, code, () => {
                                                        connection.release();
                                                        request = null;
                                                        response = null;
                                                    });
                                                }
                                                else {
                                                    response_error_result(request, response, '404-4', () => {
                                                        connection.release();
                                                        request = null;
                                                        response = null;
                                                    });
                                                }
                                            });
                                        }
                                    }
                                    else if (code === '301-1') {
                                        check_csr(request, response, (code) => {
                                            if (code === '301-2') {
                                                connection.release();
                                                response.status(response.statusCode).end(response.body);
                                                request = null;
                                                response = null;
                                            }
                                            else {
                                                response_error_result(request, response, code, () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                        });
                                    }
                                    else {
                                        response_error_result(request, response, code, () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else {
                                response_error_result(request, response, code, () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        });
                    }
                    else if (code === '201') {
                        connection.release();
                        response.header('Content-Type', 'application/json');
                        response.status(200).end(JSON.stringify(result, null, 4));
                        result = null;
                    }
                    else {
                        response_error_result(request, response, code, () => {
                            connection.release();
                            request = null;
                            response = null;
                        });
                    }
                });
            }
            else {
                response_error_result(request, response, code, () => {
                    request = null;
                    response = null;
                });
            }
        });
    });
});


app.put('*', onem2mParser, (request, response) => {
    var fullBody = '';
    request.on('data', (chunk) => {
        fullBody += chunk.toString();
    });

    request.on('end', () => {
        request.body = fullBody;

        db.getConnection((code, connection) => {
            if (code === '200') {
                request.db_connection = connection;

                if (!request.headers.hasOwnProperty('binding')) {
                    request.headers['binding'] = 'H';
                }

                db_sql.set_hit(request.db_connection, request.headers['binding'], (err, results) => {
                    results = null;
                });

                check_xm2m_headers(request, (code) => {
                    if (code === '200') {
                        if (request.body !== "") {
                            check_resource_supported(request, response, (code) => {
                                if (code === '200') {
                                    get_target_url(request, response, (code) => {
                                        if (code === '200') {
                                            if (request.option !== '/fopt') {
                                                parse_body_format(request, response, (code) => {
                                                    if (code === '200') {
                                                        check_type_update_resource(request, (code) => {
                                                            if (code === '200') {
                                                                var rootnm = Object.keys(request.targetObject)[0];
                                                                request.url = request.targetObject[rootnm].ri;
                                                                if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1)) {
                                                                    lookup_update(request, response, (code) => {
                                                                        if (code === '200') {
                                                                            if(cache_resource_url.hasOwnProperty(request.url)) {
                                                                                delete cache_resource_url[request.url];
                                                                            }

                                                                            responder.response_result(request, response, '200', '2004', '', () => {
                                                                                connection.release();
                                                                                request = null;
                                                                                response = null;
                                                                            });
                                                                        }
                                                                        else {
                                                                            response_error_result(request, response, code, () => {
                                                                                connection.release();
                                                                                request = null;
                                                                                response = null;
                                                                            });
                                                                        }
                                                                    });
                                                                }
                                                                else {
                                                                    response_error_result(request, response, '400-45', () => {
                                                                        connection.release();
                                                                        request = null;
                                                                        response = null;
                                                                    });
                                                                }
                                                            }
                                                            else {
                                                                response_error_result(request, response, code, () => {
                                                                    connection.release();
                                                                    request = null;
                                                                    response = null;
                                                                });
                                                            }
                                                        });
                                                    }
                                                    else {
                                                        response_error_result(request, response, code, () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                });
                                            }
                                            else { // if (request.option === '/fopt') {
                                                check_grp(request, response, (rsc, result_grp) => { // check access right for fanoutpoint
                                                    if (rsc == '1') {
                                                        var access_value = '4';
                                                        var body_Obj = {};
                                                        security.check(request, response, request.targetObject[Object.keys(request.targetObject)[0]].ty, result_grp.macp, access_value, result_grp.cr, (code) => {
                                                            if (code === '1') {
                                                                parse_body_format(request, response, (code) => {
                                                                    if (code === '200') {
                                                                        fopt.check(request, response, result_grp, body_Obj, (code) => {
                                                                            if (code === '200') {
                                                                                responder.search_result(request, response, '200', '2000', '', () => {
                                                                                    connection.release();
                                                                                    request = null;
                                                                                    response = null;
                                                                                });
                                                                            }
                                                                            else {
                                                                                response_error_result(request, response, code, () => {
                                                                                    connection.release();
                                                                                    request = null;
                                                                                    response = null;
                                                                                });
                                                                            }
                                                                        });
                                                                    }
                                                                    else {
                                                                        response_error_result(request, response, code, () => {
                                                                            connection.release();
                                                                            request = null;
                                                                            response = null;
                                                                        });
                                                                    }
                                                                });
                                                            }
                                                            else if (code === '0') {
                                                                response_error_result(request, response, '403-5', () => {
                                                                    connection.release();
                                                                    request = null;
                                                                    response = null;
                                                                });
                                                            }
                                                            else {
                                                                response_error_result(request, response, code, () => {
                                                                    connection.release();
                                                                    request = null;
                                                                    response = null;
                                                                });
                                                            }
                                                        });
                                                    }
                                                    else if (rsc == '2') {
                                                        code = '403-6';
                                                        response_error_result(request, response, code, () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                    else {
                                                        response_error_result(request, response, '404-4', () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                });
                                            }
                                        }
                                        else if (code === '301-1') {
                                            check_csr(request, response, (code) => {
                                                if (code === '301-2') {
                                                    connection.release();
                                                    response.status(response.statusCode).end(response.body);
                                                    request = null;
                                                    response = null;
                                                }
                                                else {
                                                    response_error_result(request, response, code, () => {
                                                        connection.release();
                                                        request = null;
                                                        response = null;
                                                    });
                                                }
                                            });
                                        }
                                        else {
                                            response_error_result(request, response, code, () => {
                                                connection.release();
                                                request = null;
                                                response = null;
                                            });
                                        }
                                    });
                                }
                                else {
                                    response_error_result(request, response, code, () => {
                                        connection.release();
                                        request = null;
                                        response = null;
                                    });
                                }
                            });
                        }
                        else {
                            response_error_result(request, response, '400-40', () => {
                                connection.release();
                                request = null;
                                response = null;
                            });
                        }
                    }
                    else {
                        response_error_result(request, response, code, () => {
                            connection.release();
                            request = null;
                            response = null;
                        });
                    }
                });
            }
            else {
                response_error_result(request, response, code, () => {
                    request = null;
                    response = null;
                });
            }
        });
    });
});

app.delete('*', onem2mParser, (request, response) => {
    var fullBody = '';
    request.on('data', (chunk) => {
        fullBody += chunk.toString();
    });

    request.on('end', () => {
        request.body = fullBody;

        db.getConnection((code, connection) => {
            if (code === '200') {
                request.db_connection = connection;

                if (!request.headers.hasOwnProperty('binding')) {
                    request.headers['binding'] = 'H';
                }

                db_sql.set_hit(request.db_connection, request.headers['binding'], (err, results) => {
                    results = null;
                });

                check_xm2m_headers(request, (code) => {
                    if (code === '200') {
                        get_target_url(request, response, (code) => {
                            if (code === '200') {
                                if (request.option !== '/fopt') {
                                    check_type_delete_resource(request, (code) => {
                                        if (code === '200') {
                                            var rootnm = Object.keys(request.targetObject)[0];
                                            request.url = request.targetObject[rootnm].ri;
                                            request.pi = request.targetObject[rootnm].pi;
                                            if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1)) {
                                                lookup_delete(request, response, (code) => {
                                                    if (code === '200') {
                                                        if(cache_resource_url.hasOwnProperty(request.url)) {
                                                            delete cache_resource_url[request.url];
                                                        }

                                                        if(cache_resource_url.hasOwnProperty(request.pi + '/la')) {
                                                            delete cache_resource_url[request.pi + '/la'];
                                                        }

                                                        Object.keys(cache_resource_url).forEach((_url) => {
                                                            if(_url.includes(request.url+'/')) {
                                                                delete cache_resource_url[_url];
                                                            }
                                                        });

                                                        responder.response_result(request, response, '200', '2002', '', () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                    else {
                                                        response_error_result(request, response, code, () => {
                                                            connection.release();
                                                            request = null;
                                                            response = null;
                                                        });
                                                    }
                                                });
                                            }
                                            else {
                                                response_error_result(request, response, '400-46', () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                        }
                                        else {
                                            response_error_result(request, response, code, () => {
                                                connection.release();
                                                request = null;
                                                response = null;
                                            });
                                        }
                                    });
                                }
                                else { // if (request.option === '/fopt') {
                                    check_grp(request, response, (rsc, result_grp) => { // check access right for fanoutpoint
                                        if (rsc == '1') {
                                            var access_value = '8';
                                            var body_Obj = {};
                                            security.check(request, response, request.targetObject[Object.keys(request.targetObject)[0]].ty, result_grp.macp, access_value, result_grp.cr, (code) => {
                                                if (code === '1') {
                                                    fopt.check(request, response, result_grp, body_Obj, (code) => {
                                                        if (code === '200') {
                                                            responder.search_result(request, response, '200', '2000', '', () => {
                                                                connection.release();
                                                                request = null;
                                                                response = null;
                                                            });
                                                        }
                                                        else {
                                                            response_error_result(request, response, code, () => {
                                                                connection.release();
                                                                request = null;
                                                                response = null;
                                                            });
                                                        }
                                                    });
                                                }
                                                else if (code === '0') {
                                                    response_error_result(request, response, '403-5', () => {
                                                        connection.release();
                                                        request = null;
                                                        response = null;
                                                    });
                                                }
                                                else {
                                                    response_error_result(request, response, code, () => {
                                                        connection.release();
                                                        request = null;
                                                        response = null;
                                                    });
                                                }
                                            });
                                        }
                                        else if (rsc == '2') {
                                            code = '403-6';
                                            response_error_result(request, response, code, () => {
                                                connection.release();
                                                request = null;
                                                response = null;
                                            });
                                        }
                                        else {
                                            response_error_result(request, response, '404-4', () => {
                                                connection.release();
                                                request = null;
                                                response = null;
                                            });
                                        }
                                    });
                                }
                            }
                            else if (code === '301-1') {
                                check_csr(request, response, (code) => {
                                    if (code === '301-2') {
                                        connection.release();
                                        response.status(response.statusCode).end(response.body);
                                        request = null;
                                        response = null;
                                    }
                                    else {
                                        response_error_result(request, response, code, () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else {
                                response_error_result(request, response, code, () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        });
                    }
                    else {
                        response_error_result(request, response, code, () => {
                            connection.release();
                            request = null;
                            response = null;
                        });
                    }
                });
            }
            else {
                response_error_result(request, response, code, () => {
                    request = null;
                    response = null;
                });
            }
        });
    });
});

function check_notification(request, response, callback) {
    if (request.headers.hasOwnProperty('content-type')) {
        if (request.headers['content-type'].includes('ty')) { // post
            callback('post');
        }
        else {
            if (request.headers.rootnm == 'sgn') {
                callback('notify');
            }
            else {
                callback('400-19');
            }
        }
    }
    else {
        callback('400-20');
    }
}

function check_ae_notify(request, response, callback) {
    var ri = request.targetObject[Object.keys(request.targetObject)[0]].ri;
    console.log('[check_ae_notify] : ' + ri);
    // select_ae 의 시그니처는 (connection, ri, callback) 이다. connection 을 빠뜨려
    // 인자가 한 칸씩 밀리면서 callback 이 undefined 가 되어, 이 경로는 호출 즉시
    // TypeError 로 죽었다.
    db_sql.select_ae(request.db_connection, ri, (err, result_ae) => {
        if (!err) {
            if (result_ae.length == 1) {
                var point = {};
                var poa_arr = JSON.parse(result_ae[0].poa);
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = url.parse(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        console.log('send notification to ' + poa_arr[i]);
                        notify_http(poa.hostname, poa.port, poa.path, request.method, request.headers, request.body, (code, res) => {
                            callback(code, res)
                        });
                    }
                    else if (poa.protocol == 'coap:') {
                        console.log('send notification to ' + poa_arr[i]);
                        callback('405-12');
                    }
                    else if (poa.protocol == 'mqtt:') {
                        callback('405-10');
                    }
                    else if (poa.protocol == 'ws:') {
                        callback('405-11');
                    }
                    else {
                        callback('400-47');
                    }
                }
            }
            else {
                callback('404-6');
            }
        }
        else {
            console.log('[check_ae_notify] query error: ' + result_ae.message);
            callback('500-1');
        }
    });
}

function check_csr(request, response, callback) {
    var ri = util.format('/%s/%s', usecsebase, url.parse(request.absolute_url).pathname.split('/')[1]);
    console.log('[check_csr] : ' + ri);
    db_sql.select_csr(request.db_connection, ri, (err, result_csr) => {
        if (!err) {
            if (result_csr.length == 1) {
                var point = {};
                point.forwardcbname = result_csr[0].cb.replace('/', '');
                var poa_arr = JSON.parse(result_csr[0].poa);
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = url.parse(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        point.forwardcbhost = poa.hostname;
                        point.forwardcbport = poa.port;

                        console.log('csebase forwarding to ' + point.forwardcbname);

                        forward_http(point.forwardcbhost, point.forwardcbport, request.url, request.method, request.headers, request.body, (code, _res) => {
                            if (code === '200') {
                                var res = JSON.parse(JSON.stringify(_res));
                                _res = null;
                                if (res.headers.hasOwnProperty('content-type')) {
                                    response.setHeader('Content-Type', res.headers['content-type']);
                                }

                                if (res.headers.hasOwnProperty('x-m2m-ri')) {
                                    response.setHeader('X-M2M-RI', res.headers['x-m2m-ri']);
                                }

                                if (res.headers.hasOwnProperty('x-m2m-rvi')) {
                                    response.setHeader('X-M2M-RVI', res.headers['x-m2m-rvi']);
                                }

                                if (res.headers.hasOwnProperty('x-m2m-rsc')) {
                                    response.setHeader('X-M2M-RSC', res.headers['x-m2m-rsc']);
                                }

                                if (res.headers.hasOwnProperty('content-location')) {
                                    response.setHeader('Content-Location', res.headers['content-location']);
                                }

                                response.body = res.body;
                                response.statusCode = res.statusCode;

                                callback('301-2');
                            }
                            else {
                                callback(code);
                            }
                        });
                    }
                    else if (poa.protocol == 'mqtt:') {
                        point.forwardcbmqtt = poa.hostname;
                        console.log('forwarding with mqtt is not supported');

                        callback('301-3');
                    }
                    else {
                        console.log('protocol in poa of csr is not supported');

                        callback('301-4');
                    }
                }
                result_csr = null;
            }
            else {
                result_csr = null;
                callback('404-3');
            }
        }
        else {
            console.log('[check_csr] query error: ' + result_csr.message);
            callback('404-3');
        }
    });
}


function notify_http(hostname, port, path, method, headers, bodyString, callback) {
    var options = {
        hostname: hostname,
        port: port,
        path: path,
        method: method,
        headers: headers
    };

    var req = http.request(options, (res) => {
        var fullBody = '';
        res.on('data', (chunk) => {
            fullBody += chunk.toString();
        });

        res.on('end', () => {
            console.log('--------------------------------------------------------------------------');
            console.log(fullBody);
            console.log('[notify_http response : ' + res.statusCode + ']');

            callback('200', res);
        });
    });

    req.on('error', (e) => {
        console.log('[forward_http] problem with request: ' + e.message);

        callback('404-7');
    });

    console.log(method + ' - ' + path);
    console.log(bodyString);

    // write data to request body
    if ((method.toLowerCase() == 'get') || (method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(bodyString);
    }
    req.end();
}

function forward_http(forwardcbhost, forwardcbport, f_url, f_method, f_headers, f_body, callback) {
    var options = {
        hostname: forwardcbhost,
        port: forwardcbport,
        path: f_url,
        method: f_method,
        headers: f_headers
    };

    var req = http.request(options, (res) => {
        var fullBody = '';

        res.on('data', (chunk) => {
            fullBody += chunk.toString();
        });

        res.on('end', () => {
            res.body = fullBody;

            console.log('--------------------------------------------------------------------------');
            console.log(res.url);
            console.log(res.headers);
            console.log(res.body);
            console.log('[Forward response : ' + res.statusCode + ']');

            callback('200', res);
        });
    });

    req.on('error', (e) => {
        console.log('[forward_http] problem with request: ' + e.message);

        callback('404-3');
    });

    console.log(f_method + ' - ' + f_url);
    console.log(f_headers);
    console.log(f_body);

    // write data to request body
    if ((f_method.toLowerCase() == 'get') || (f_method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(f_body);
    }
    req.end();
}

if (process.env.NODE_ENV == 'production') {
    console.log("Production Mode");
}
else if (process.env.NODE_ENV == 'development') {
    console.log("Development Mode");
}

function scheduleGc() {
    if (!global.gc) {
        console.log('Garbage collection is not exposed');
        return;
    }

    // schedule next gc within a random interval (e.g. 15-45 minutes)
    // tweak this based on your app's memory usage
    var nextMinutes = Math.random() * 30 + 15;

    setTimeout(() => {
        global.gc();
        console.log('Manual gc', process.memoryUsage());
        scheduleGc();
    }, nextMinutes * 60 * 1000);
}

// call this in the startup script of your app (once per process)
scheduleGc();
