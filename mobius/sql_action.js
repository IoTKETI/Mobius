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
 * Created by Il Yeup, Ahn in KETI on 2016-07-13.
 */

var responder = require('./responder');
var moment = require('moment');
var util = require('util');
var merge = require('merge');

var db = require('./db_action');
var sqlite = require('./db_sqlite');

// 전환된 함수는 이 파사드를 쓴다. 전환이 끝나면 위 두 줄은 삭제한다.
var facade = require('./db');

// 구독 도달성 감사(audit_subscriptions)가 nu 와 poa 를 읽는다.
var url = require('url');
var poa_util = require('./poa');

var _this = this;

global.max_lim = 2000;

const max_search_count = 2000;

// delete_oldest 1회 트랜잭션당 삭제 상한.
// lookup 삭제는 FK(cin_ri ON DELETE CASCADE)로 cin 본문까지 연쇄 삭제하며,
// 265GB cin 테이블에서 행당 인덱스 3개 랜덤 I/O ≈ 40ms 가 든다 (실측:
// 500건 패스가 락을 쥔 채 20초). 100이면 패스당 ~4초로 묶이고, 초과분은
// 다음 CIN 삽입의 flush에서 이어서 정리된다. 배출량은 어차피 삭제 I/O가
// 상한이라 패스를 키워도 총 시간은 같고 락 점유만 길어진다.
const MAX_PURGE_PER_PASS = 100;

// get_cni_count 는 purge 후 재조회하며 재귀한다. delete_oldest 가 카운터를
// 못 줄이면 무한히 돌기 때문에 상한을 둔다. 한 패스에 최대 100건을 지우므로
// 10회면 1000건까지 정리된다 — 그보다 많이 밀렸다면 드리프트를 의심해야 한다.
const MAX_PURGE_ROUNDS = 10;

// 이번 패스에서 얼마나 지워야 하는지 계산한다.
//   need_cnt   개수 한도까지 지워야 할 건수
//   need_cs    용량 한도까지 지워야 할 바이트
//   candidates 조회할 후보 행 수. 용량 초과는 몇 건이 필요한지 미리 알 수 없어
//              상한만큼 가져온 뒤 호출부에서 누적하며 자른다.
//   est_count  실제 cs 를 볼 수 없는 경로(SQLite)용 평균 기반 추정 건수
// 용량 초과 시 무조건 1건만 지우던 예전 동작은 초과량과 무관해 수렴하지 못했다.
exports.purge_plan = function (cni, cbs, mni, mbs) {
    var need_cnt = (cni > mni) ? (cni - mni) : 0;
    var need_cs = (cbs > mbs) ? (cbs - mbs) : 0;

    var est_count = need_cnt;
    if (need_cs > 0) {
        var avg_cs = (cni > 0) ? Math.ceil(cbs / cni) : 1;
        var by_size = Math.ceil(need_cs / avg_cs);
        if (by_size > est_count) est_count = by_size;
    }
    if (est_count > MAX_PURGE_PER_PASS) est_count = MAX_PURGE_PER_PASS;

    return {
        need_cnt: need_cnt,
        need_cs: need_cs,
        est_count: est_count,
        candidates: (need_cs > 0) ? MAX_PURGE_PER_PASS : Math.min(need_cnt, MAX_PURGE_PER_PASS)
    };
};

exports.set_tuning = function (connection, callback) {
    var sql = util.format('set global max_connections = 2000');
    db.getResult(sql, connection, function (err, results) {
        if (err) {
            //callback(err, results);
            //return;
            console.log(results.message);
        }
        sql = util.format('set global innodb_flush_log_at_trx_commit=0');
        db.getResult(sql, connection, function (err, results) {
            if (err) {
                //callback(err, results);
                //return;
                console.log(results.message);
            }
            sql = util.format('set global sync_binlog=0');
            db.getResult(sql, connection, function (err, results) {
                if (err) {
                    //callback(err, results);
                    //return;
                    console.log(results.message);
                }
                sql = util.format('set global transaction_isolation=\'READ-UNCOMMITTED\'');
                db.getResult(sql, connection, function (err, results) {
                    if (err) {
                        //callback(err, results);
                        //return;
                        console.log(results.message);
                    }
                    callback(err, results);
                });
            });
        });
    });
};

exports.get_hit_all = function (connection, callback) {
    var until = moment().utc().subtract(1, 'year').format('YYYYMMDD');

    facade.run(facade.k('hit').select('*').where('ct', '>', until).limit(1000),
        connection, callback);
};

// SQLite helper to read schema file and init
// Schema initialization moved to db_sqlite.js connect() to ensure DB is open


exports.set_hit = function (connection, binding, callback) {
    var _ct = moment().utc().format('YYYYMMDD');
    var _http = 0;
    var _mqtt = 0;
    var _coap = 0;
    var _ws = 0;

    if (binding === 'H') {
        _http = 1;
    }
    else if (binding === 'M') {
        _mqtt = 1;
    }
    else if (binding === 'C') {
        _coap = 1;
    }
    else if (binding === 'W') {
        _ws = 1;
    }

    bump_hit(connection, _ct, _http, _mqtt, _coap, _ws, callback);
};

// 일자별 프로토콜 히트 카운터를 증분한다.
//
// 예전에는 SQLite 가 ON CONFLICT(ct) DO UPDATE, MySQL 이 ON DUPLICATE KEY UPDATE
// 로 갈라져 있었다. 같은 문장을 방언만 바꿔 두 번 쓰던 것이라 knex 의
// onConflict().merge() 가 대신 고른다.
function bump_hit(connection, _ct, _http, _mqtt, _coap, _ws, callback) {
    var qb = facade.k('hit')
        .insert({ ct: _ct, http: _http, mqtt: _mqtt, coap: _coap, ws: _ws })
        .onConflict('ct')
        .merge({
            http: facade.raw('http + ?', [_http]),
            mqtt: facade.raw('mqtt + ?', [_mqtt]),
            coap: facade.raw('coap + ?', [_coap]),
            ws: facade.raw('ws + ?', [_ws])
        });

    facade.run(qb, connection, callback);
}

exports.set_hit_n = function (connection, _ct, _http, _mqtt, _coap, _ws, callback) {
    bump_hit(connection, _ct, _http, _mqtt, _coap, _ws, callback);
};

// exports.get_sri_sri = function (connection, ri, callback) {
//     var sql = util.format('select sri from lookup where ri = \'%s\'', ri);
//     db.getResult(sql, connection, function (err, results) {
//         callback(err, results);
//     });
// };

exports.get_ri_sri = function (connection, sri, callback) {
    var tid = require('shortid').generate();
    console.time('get_ri_sri' + ' (' + tid + ')');
    facade.run(facade.k('lookup').select('ri').where({ sri: sri }), connection, function (err, results) {
        console.timeEnd('get_ri_sri' + ' (' + tid + ')');
        callback(err, results);
    });
};

// function set_sri_sri(connection, ri, sri, callback) {
//     var sql = util.format('insert into sri (ri, sri) value (\'%s\', \'%s\')', ri, sri);
//     db.getResult(sql, connection, function (err, results) {
//         callback(err, results);
//     });
// }

// 모든 리소스 생성이 맨 먼저 거치는 공통 진입점이다 (insert_cb / insert_acp /
// insert_ae / insert_cnt / insert_cin / insert_sub / ... 20여 곳).
//
// 두 백엔드의 진짜 차이는 두 가지뿐이었다.
//
// 1. 수동 이스케이프 방식 — SQLite 는 ' -> '', MySQL 은 \" 와 \' 였다.
//    둘 다 값을 SQL 문자열에 직접 끼워 넣느라 필요했던 것이고,
//    빠뜨리면 그대로 주입 통로가 된다. 바인딩을 쓰면 아예 없어진다.
//
// 2. acpl 컬럼 — SQLite 스키마에만 있었고, 그 값을 채우려고 삽입 때마다
//    acp 를 한 번 더 조회했다. 그런데 저장소 전체에서 acpl 을 **읽는 곳이
//    하나도 없다**. MySQL 에는 컬럼 자체가 없다. 컬럼과 사전 조회를 함께
//    걷어냈다 (mobius/mobiusdb_sqlite.sql 에서도 뺐다 — nullable 이라
//    기존 SQLite DB 에 그대로 남아 있어도 삽입에 지장이 없다).
//
// 겸사겸사 MySQL 갈래의 잠재 크래시도 없앴다. 예전에는 obj.acpi 가 undefined
// 면 JSON.stringify 가 undefined 를 돌려주고 그 뒤 .replace 에서 TypeError 로
// 워커가 죽었다. SQLite 갈래는 `|| []` 로 막고 있었다 — 그쪽에 맞췄다.
exports.insert_lookup = function (connection, obj, callback) {
    facade.run(facade.k('lookup').insert({
        pi: obj.pi,
        ri: obj.ri,
        ty: obj.ty,
        ct: obj.ct,
        st: obj.st,
        rn: obj.rn,
        lt: obj.lt,
        et: obj.et,
        acpi: JSON.stringify(obj.acpi || []),
        // lbl 만 들여쓰기 4칸으로 저장해 왔다. 읽는 쪽은 JSON.parse 라 형태와
        // 무관하지만, 저장 값이 달라지면 기존 행과 모양이 어긋난다.
        lbl: JSON.stringify(obj.lbl || [], null, 4),
        at: JSON.stringify(obj.at || []),
        aa: JSON.stringify(obj.aa || []),
        sri: obj.sri,
        spi: obj.spi,
        subl: JSON.stringify(obj.subl || [])
    }), connection, callback);
};

exports.insert_cb = function (connection, obj, callback) {
    console.time('insert_cb ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            // 두 분기는 같은 INSERT 였고 수동 이스케이프만 달랐다
            // (SQLite 는 '' 로, MySQL 은 \" \' 로). 바인딩을 쓰면 둘 다 필요 없다.
            var qb = facade.k('cb').insert({
                ri: obj.ri,
                cst: obj.cst,
                csi: obj.csi,
                srt: JSON.stringify(obj.srt),
                poa: JSON.stringify(obj.poa),
                nl: obj.nl,
                ncp: obj.ncp,
                srv: JSON.stringify(obj.srv)
            });

            facade.run(qb, connection, function (err2, results2) {
                if (!err2) {
                    console.timeEnd('insert_cb ' + obj.ri);
                    callback(err2, results2);
                    return;
                }
                // cb 삽입이 실패하면 앞서 넣은 lookup 행을 되돌린다.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        callback(err2, results2);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_acp = function (connection, obj, callback) {
    console.time('insert_acp ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (err) {
            callback(err, results);
            return;
        }

        facade.run(facade.k('acp').insert({
            ri: obj.ri,
            pv: JSON.stringify(obj.pv),
            pvs: JSON.stringify(obj.pvs)
        }), connection, function (err2, results2) {
            if (!err2) {
                console.timeEnd('insert_acp ' + obj.ri);
                callback(err2, results2);
                return;
            }

            // 본문 insert 가 실패하면 lookup 행이 고아로 남는다. 되돌린다.
            facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection, function () {
                callback(err2, results2);
            });
        });
    });
};

exports.insert_ae = function (connection, obj, callback) {
    console.time('insert_ae ' + obj.ri);
    _this.insert_lookup(connection, obj, (err, results) => {
        if (!err) {
            // 두 갈래의 차이는 예약어 or 의 인용(SQLite `"or"` vs MySQL `ae.or`)과
            // 비표준 키워드(`value` vs `values`), 그리고 수동 이스케이프뿐이었다.
            // 빌더가 방언별로 식별자를 인용하므로 셋 다 사라진다.
            facade.run(facade.k('ae').insert({
                ri: obj.ri,
                apn: obj.apn,
                api: obj.api,
                aei: obj.aei,
                poa: JSON.stringify(obj.poa || []),
                or: obj.or,
                nl: obj.nl,
                rr: obj.rr,
                csz: obj.csz,
                srv: JSON.stringify(obj.srv || [])
            }), connection, function (aerr, ares) {
                if (!aerr) {
                    console.timeEnd('insert_ae ' + obj.ri);
                    callback(aerr, ares);
                    return;
                }
                // ae 삽입이 실패하면 앞서 넣은 lookup 행을 되돌린다.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        console.timeEnd('insert_ae ' + obj.ri);
                        callback(aerr, ares);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_cnt = function (connection, obj, callback) {
    console.time('insert_cnt ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            // insert_ae 와 같은 이유로 갈렸다 — `"or"` vs `cnt.or`, `values` vs
            // `value`. 값 목록은 양쪽이 문자 그대로 같았다.
            facade.run(facade.k('cnt').insert({
                ri: obj.ri,
                cr: obj.cr,
                mni: obj.mni,
                mbs: obj.mbs,
                mia: obj.mia,
                cni: obj.cni,
                cbs: obj.cbs,
                li: obj.li,
                or: obj.or,
                disr: obj.disr
            }), connection, function (cerr, cres) {
                if (!cerr) {
                    console.timeEnd('insert_cnt ' + obj.ri);
                    callback(cerr, cres);
                    return;
                }
                // cnt 삽입이 실패하면 앞서 넣은 lookup 행을 되돌린다.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        console.timeEnd('insert_cnt ' + obj.ri);
                        callback(cerr, cres);
                    });
            });
        }
        else {
            console.timeEnd('insert_cnt ' + obj.ri, ' - ', results);
            callback(err, results);
        }
    });
};

global.getType = function (p) {
    var type = 'string';
    if (Array.isArray(p)) {
        type = 'array';
    }
    else if (typeof p === 'string') {
        try {
            var _p = JSON.parse(p);
            if (typeof _p === 'object') {
                type = 'string_object';
            }
            else {
                type = 'string';
            }
        } catch (e) {
            type = 'string';
            return type;
        }
    }
    else if (p != null && typeof p === 'object') {
        type = 'object';
    }
    else {
        type = 'other';
    }

    return type;
};

// 컨테이너의 현재 cni/cbs/st 를 돌려주고, 한도를 넘었으면 오래된 것부터 지운다.
//
// 예전에는 매번 cin 을 전부 세는 O(n) 집계를 돌렸다. 저장된 cnt.cni/cbs 를
// 못 믿었기 때문인데, 그 불신에는 근거가 있었다 — 감소 경로가 깨져 있어서
// CIN 을 지워도 cni 가 안 줄었다 (update_cnt_by_delete 의 cs 인자 누락, ea40cbc).
//
// 지금은 저장값을 유지하는 세 주체가 전부 증분이라 동시성에도 안전하다:
//   cnt_man flush          cni = cni + δ
//   delete_oldest          cni = cni - N
//   update_parent_by_delete cni = cni - 1
// 그래서 저장값을 읽는다. 드리프트는 reconcile_cnt_counters 가 주기적으로 잡는다.
//
// mni/mbs 도 이제 DB 에서 읽는다. 예전에는 호출자의 메모리 객체에서 왔는데,
// cnt_man 은 debounce 창의 첫 CIN 시점 사본을 들고 있어서 그 사이 클라이언트가
// mni 를 낮추면 옛 값으로 한도를 판정했다.
//
// depth 는 재귀 상한이다. purge 후 재조회하는 구조라, delete_oldest 가 실제로
// 카운터를 못 줄이면 (지울 행이 없거나 감산이 실패하면) 무한히 돈다.
// 예전 구조도 같은 위험이 있었다 — 실측 COUNT 를 읽어도 지운 게 없으면
// 같은 값이 나오므로 마찬가지였다.
exports.get_cni_count = function (connection, obj, callback, depth) {
    depth = depth || 0;

    function checkAndPurge(connection, cni, cbs, st, mni, mbs, obj, callback) {
        if (cni > mni || cbs > mbs) {
            // 정리할 때만 로그를 남긴다. 매 flush 마다 찍으면 로그가 폭주해
            // pm2-logrotate 보관분(20분)이 다 밀려나 장애 분석이 불가능해진다.
            console.log('[checkAndPurge] ri=' + obj.ri + ' cni=' + cni + ' mni=' + mni + ' cbs=' + cbs + ' mbs=' + mbs);
            var count = _this.purge_plan(cni, cbs, mni, mbs).est_count;
            if (count < 1) count = 1;

            console.log('[checkAndPurge] delete_oldest count=' + count);
            delete_oldest(connection, obj, count, function (err, deleted) {
                // 실제로 지운 게 있을 때만 재조회·재귀한다. delete_oldest 는
                // NOWAIT 스킵 / 이미 정리됨 / 후보 0건 세 경로에서 진행 없이
                // 성공처럼 반환하는데, 예전에는 그걸 구분하지 않고 무조건
                // 재귀해서 cni 가 그대로인 채 같은 사이클을 초당 474회 돌았다.
                // 워커 26개가 같은 cnt 행을 두고 NOWAIT 경합을 하니 대부분
                // 스킵으로 떨어져 라이브락이 됐고, 한 바퀴마다 10만행
                // COUNT+SUM 이 돌아 mysqld 가 21코어를 먹었다.
                // (2026-08-27 실측: load 1085, 동시 쿼리 1243건, 그중 99%가
                //  MUL3/disarm 집계. 같은 cnt 행을 기다리던 cnt_man flush 는
                //  ER_LOCK_WAIT_TIMEOUT 3330건.)
                // 지운 건수가 있으면 cni 는 반드시 줄어드므로 재귀는 종료한다.
                if (!deleted) {
                    callback(cni, cbs, st);
                    return;
                }

                // 위의 !deleted 가 정상 종료 조건이고, 이건 그래도 안 줄어드는
                // 경우의 최후 방어다. 지웠다고 보고했는데 카운터가 안 줄면
                // (드리프트, 다른 워커와의 경합) 무한히 돌 수 있다.
                if (depth + 1 >= MAX_PURGE_ROUNDS) {
                    console.error('[get_cni_count] purge 가 ' + MAX_PURGE_ROUNDS +
                        '회 안에 수렴하지 않았다 — ri=' + obj.ri +
                        ' cni=' + cni + ' mni=' + mni + ' cbs=' + cbs + ' mbs=' + mbs +
                        ' (카운터 드리프트 의심, reconcile_cnt_counters 확인)');
                    callback(cni, cbs, st);
                    return;
                }
                // 삭제 후 재조회로 정확한 최종값 반환
                _this.get_cni_count(connection, obj, function (cni2, cbs2, st2) {
                    callback(cni2, cbs2, st2);
                }, depth + 1);
            });
        }
        else {
            // 여기 있던 드리프트 보정(UPDATE cnt SET cni=<실측> WHERE cni<>...)은
            // 뺐다. 그 코드는 cni/cbs 가 select_count_ri 의 **실측값**이라는 전제로
            // 쓰였는데, 이제 select_cni_parent 가 읽는 **저장값**이다. 같은 값을
            // 같은 값과 비교하므로 WHERE 가 절대 맞지 않아 영구 no-op 이면서
            // flush 마다 쿼리를 한 번 더 쓰는 코드가 된다.
            //
            // 실측 재집계를 없앤 이유는 O(n) 이기 때문이다 — CIN 100k 기준
            // 7.2ms, 그리고 이 저장소의 운영 배포에는 CIN 이 593만 건인 컨테이너가
            // 있다. 그 집계가 매 flush 마다 도는 것이 2026-08-27 장애의 직접 원인이었다.
            //
            // 드리프트는 두 곳이 잡는다:
            //   delete_oldest        purge 트랜잭션 안에서 실측 재카운트로 절대 보정
            //   reconcile_cnt_counters  기동 시 + 일 1회 전수 보정
            // 남는 구멍은 "버스트로 어긋난 뒤 조용해진 컨테이너"이고,
            // 다음 reconcile 까지 최대 하루 어긋난 채로 있는다.
            callback(cni, cbs, st);
        }
    }

    _this.select_cni_parent(connection, obj.ri, function (err, rows) {
        if (err || !rows || rows.length !== 1) {
            callback(0, 0, 0);
            return;
        }

        var r = rows[0];
        checkAndPurge(connection,
            parseInt(r.cni || 0, 10),
            parseInt(r.cbs || 0, 10),
            (r.st == null) ? 0 : parseInt(r.st, 10),
            parseInt(r.mni || 0, 10),
            parseInt(r.mbs || 0, 10),
            obj, callback);
    });
};

exports.insert_cin = function (connection, obj, callback) {
    var cin_id = 'insert_cin ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cin_id);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var con_type = getType(obj.con);
            if (con_type === 'string_object') {
                try {
                    obj.con = JSON.parse(obj.con);
                }
                catch (e) {
                }
            }

            // 예약어 or 의 인용(`"or"` vs `cin.or`)과 `values`/`value`,
            // con 의 이스케이프만 달랐다. con 의 문자열/객체 판별은 위에서
            // 이미 끝나 있어 양쪽이 같은 값을 쓴다.
            //
            // cin 은 1억 4천만 행짜리 테이블이라 삽입 경로가 가장 비싸다.
            // 바인딩 전환 뒤 배포 서버에서 insert_cin 타이머로 확인할 것.
            facade.run(facade.k('cin').insert({
                ri: obj.ri,
                pi: obj.pi,
                cr: obj.cr,
                cnf: obj.cnf,
                cs: obj.cs,
                or: obj.or,
                con: (con_type == 'string') ? obj.con : JSON.stringify(obj.con)
            }), connection, function (ierr, ires) {
                if (!ierr) {
                    console.timeEnd(cin_id);
                    callback(ierr, ires);
                    return;
                }
                // cin 삽입이 실패하면 앞서 넣은 lookup 행을 되돌린다.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        console.timeEnd(cin_id);
                        callback(ierr, ires);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_grp = function (connection, obj, callback) {
    console.time('insert_grp ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into grp (ri, cr, mt, cnm, mnm, mid, macp, mtv, csy, gn) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cr, obj.mt, obj.cnm, obj.mnm, JSON.stringify(obj.mid).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), JSON.stringify(obj.macp).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.mtv, obj.csy, obj.gn);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_grp ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_lcp = function (connection, obj, callback) {
    console.time('insert_lcp ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into lcp (ri, los, lou, lot, lor, loi, lon, lost) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.los, obj.lou, obj.lot, obj.lor, obj.loi, obj.lon, obj.lost);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_lcp ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_fcnt = function (connection, obj, callback) {
    console.time('insert_fcnt ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, cr) ' +
                'value (\'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_fcnt ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_hd_dooLK = function (connection, obj, callback) {
    console.time('insert_hd_dooLK ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, fcnt.lock, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.lock, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_hd_dooLK ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_hd_bat = function (connection, obj, callback) {
    console.time('insert_hd_bat ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, fcnt.lvl, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.lvl, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_hd_bat ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_hd_tempe = function (connection, obj, callback) {
    console.time('insert_hd_tempe ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, fcnt.curT0, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.curT0, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_hd_tempe ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_hd_binSh = function (connection, obj, callback) {
    console.time('insert_hd_binSh ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, fcnt.powerSe, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.powerSe, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_hd_binSh ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_hd_fauDn = function (connection, obj, callback) {
    console.time('insert_hd_fauDn ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, fcnt.sus, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.sus, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_hd_fauDn ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_hd_colSn = function (connection, obj, callback) {
    console.time('insert_hd_colSn ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, fcnt.colSn, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.colSn, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_hd_colSn ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_hd_brigs = function (connection, obj, callback) {
    console.time('insert_hd_brigs ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, fcnt.brigs, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.brigs, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_hd_brigs ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_hd_color = function (connection, obj, callback) {
    console.time('insert_hd_color ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into fcnt (ri, cnd, fcnt.red, fcnt.green, fcnt.blue, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnd, obj.red, obj.green, obj.blue, obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_hd_color ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_fwr = function (connection, obj, callback) {
    console.time('insert_fwr ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, vr, fwnnam, url, ud, uds) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.vr, obj.fwnnam, obj.url, obj.ud, JSON.stringify(obj.uds).replace(/\"/g, '\\"').replace(/\'/g, '\\\''));
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_fwr ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_bat = function (connection, obj, callback) {
    console.time('insert_bat ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, btl, bts) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.btl, obj.bts);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_bat ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_dvi = function (connection, obj, callback) {
    console.time('insert_dvi ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, dbl, man, mgo.mod, dty, fwv, swv, hwv) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.dbl, obj.man, obj.mod, obj.dty, obj.fwv, obj.swv, obj.hwv);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_dvi ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_dvc = function (connection, obj, callback) {
    console.time('insert_dvc ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, can, att, cas, cus, ena, dis) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.can, obj.att, JSON.stringify(obj.cas).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.cus, obj.ena, obj.dis);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_dvc ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_rbo = function (connection, obj, callback) {
    console.time('insert_rbo ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, rbo, far) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.rbo, obj.far);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_rbo ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_nod = function (connection, obj, callback) {
    console.time('insert_nod ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into nod (ri, ni, hcl, mgca) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.ni, obj.hcl, obj.mgca);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_nod ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_csr = function (connection, obj, callback) {
    console.time('insert_csr ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into csr (ri, cst, poa, cb, csi, mei, tri, rr, nl, srv) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cst, JSON.stringify(obj.poa).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.cb, obj.csi, obj.mei, obj.tri, obj.rr, obj.nl, JSON.stringify(obj.srv).replace(/\"/g, '\\"').replace(/\'/g, '\\\''));
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_csr ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_sub = function (connection, obj, callback) {
    console.time('insert_sub ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            // 가장 순수한 가짜 분기였다 — 예약어도 없고 컬럼 17개가 그대로
            // 같았다. `values` vs `value` 와 이스케이프 스킴만 달랐다.
            facade.run(facade.k('sub').insert({
                ri: obj.ri,
                pi: obj.pi,
                enc: JSON.stringify(obj.enc || {}),
                exc: obj.exc,
                nu: JSON.stringify(obj.nu || []),
                gpi: obj.gpi,
                nfu: obj.nfu,
                bn: JSON.stringify(obj.bn || {}),
                rl: obj.rl,
                psn: obj.psn,
                pn: obj.pn,
                nsp: obj.nsp,
                ln: obj.ln,
                nct: obj.nct,
                nec: obj.nec,
                cr: obj.cr,
                su: obj.su
            }), connection, function (serr, sres) {
                if (!serr) {
                    console.timeEnd('insert_sub ' + obj.ri);
                    callback(serr, sres);
                    return;
                }
                // sub 삽입이 실패하면 앞서 넣은 lookup 행을 되돌린다.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        console.timeEnd('insert_sub ' + obj.ri);
                        callback(serr, sres);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_smd = function (connection, obj, callback) {
    console.time('insert_smd ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into smd (ri, cr, dsp, dcrp, soe, rels, smd.or) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cr, obj.dsp, obj.dcrp, obj.soe, JSON.stringify(obj.rels).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.or);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_smd ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_mms =function (connection, obj, callback) {
    console.time('insert_mms ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into mms (ri, sid, soid, stid, asd, osd, sst) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.sid, obj.soid, obj.stid, obj.asd, obj.osd, obj.sst);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_mms ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, function () {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

// 공통 속성(lookup) 한 행과 타입별 테이블 한 행을 합쳐 돌려준다.
//
// 두 분기를 합치면서 SQLite 쪽의 가드를 채택했다. MySQL 분기는
// merge(comm_Obj[0], spec_Obj[0]) 를 무조건 불렀는데, 타입별 행이 없으면
// spec_Obj[0] 이 undefined 라 결과가 깨졌다. lookup 행만 있고 타입 행이 없는
// 상태는 subtree 삭제 도중에 실제로 생긴다.
exports.select_resource_from_url = function (connection, ri, sri, callback) {
    var qb = facade.k('lookup').select('*')
        .where({ ri: ri })
        .orWhere({ sri: sri });

    facade.run(qb, connection, function (err, comm_Obj) {
        if (err) {
            callback(err, comm_Obj);
            return;
        }

        if (comm_Obj.length === 0) {
            callback(err, comm_Obj);
            return;
        }

        var table = responder.typeRsrc[comm_Obj[0].ty];
        if (!table) {
            // 이 CSE 가 다루지 않는 타입이다. 지원을 걷어낸 타입의 옛 행이
            // lookup 에 남아 있으면 여기로 온다.
            //
            // 예전에는 undefined 를 그대로 테이블 이름 자리에 넣어 깨진 질의를
            // 만들었고 500 "database error" 가 나갔다 — 원인을 짐작할 수 없는
            // 응답이다.
            //
            // lookup 행만 돌려준다. 지우거나 비우지 않는 이유는 호출부가 ty 를
            // 보고 "지원하지 않는 타입" 이라고 답할 수 있어야 하기 때문이다.
            // 빈 배열로 만들면 그냥 404 가 되어 이유가 사라진다.
            console.error('[select_resource_from_url] 지원하지 않는 타입의 행: ty=' +
                          comm_Obj[0].ty + ' ' + comm_Obj[0].ri);
            callback(null, [comm_Obj[0]]);
            return;
        }

        facade.run(facade.k(table).select('*').where({ ri: comm_Obj[0].ri }), connection,
            function (err2, spec_Obj) {
                if (err2) {
                    callback(err2, spec_Obj);
                    return;
                }
                var resource_Obj = [];
                resource_Obj.push(spec_Obj.length > 0
                    ? merge(comm_Obj[0], spec_Obj[0])
                    : comm_Obj[0]);
                callback(null, resource_Obj);
            });
    });
};

exports.select_csr_like = function (connection, cb, callback) {
    var sql = util.format("select * from csr where ri like \'/%s/%%\'", cb);
    db.getResult(sql, connection, function (err, results_csr) {
        if (!Array.isArray(results_csr.poa)) {
            results_csr.poa = [];
        }
        callback(err, results_csr);
    });
};

exports.select_csr = function (connection, ri, callback) {
    var sql = util.format("select * from csr where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, results_csr) {
        callback(err, results_csr);
    });
};

exports.select_ae = function (connection, ri, callback) {
    facade.run(facade.k('ae').select('*').where({ ri: ri }), connection, callback);
};

// --- SQL Injection 방어 (한국전자기술연구원 취약점 보고서, Mobius <=2.5.15) ---
// discovery 필터 파라미터를 문자열 concat으로 WHERE 절에 넣기 전에 정규화한다.
// - 숫자 컨텍스트(따옴표 없이 삽입)는 부호 없는 정수만 허용, 아니면 해당 필터를 무시(fail-safe)
// - 문자열 컨텍스트(따옴표로 감싸 삽입)는 SQL 리터럴 이스케이프 (MySQL/SQLite 공통 안전)
function esc_sql_str(v) {
    return String(v).replace(/[\\'\x00\n\r\x1a]/g, function (c) {
        switch (c) {
            case '\\': return '\\\\';
            case '\'': return '\'\'';
            case '\x00': return '\\0';
            case '\n': return '\\n';
            case '\r': return '\\r';
            case '\x1a': return '\\Z';
        }
    });
}

function sanitize_discovery_query(query) {
    if (!query || typeof query !== 'object') {
        return;
    }
    var isUint = function (v) { return /^[0-9]+$/.test(String(v)); };

    // 숫자 컨텍스트: sza/szb/la/ofst/lvl 은 따옴표 없이 삽입되므로 정수만 허용
    ['sza', 'szb', 'la', 'ofst', 'lvl'].forEach(function (k) {
        if (query[k] != null && !isUint(query[k])) {
            delete query[k];
        }
    });

    // ty: 단일 정수 또는 정수 목록만 허용
    if (query.ty != null) {
        var tys = Array.isArray(query.ty) ? query.ty : String(query.ty).split(',');
        if (!tys.every(isUint)) {
            delete query.ty;
        }
    }

    // 문자열 컨텍스트: 따옴표로 감싸 삽입되는 파라미터는 이스케이프
    ['lbl', 'rn', 'cty', 'cra', 'crb', 'ms', 'us', 'exa', 'exb', 'sts', 'stb'].forEach(function (k) {
        if (query[k] == null) {
            return;
        }
        query[k] = Array.isArray(query[k]) ? query[k].map(esc_sql_str) : esc_sql_str(query[k]);
    });
}
exports.sanitize_discovery_query = sanitize_discovery_query;

function build_search_query(query, callback) {
    var query_where = '';
    var query_count = 0;
    if (query.lbl != null) {
        query_where = ' and ';
        if (query.lbl.toString().split(',')[1] == null) {
            query_where += util.format(' lbl like \'%%\"%%%s%%\"%%\'', query.lbl);
        }
        else {
            // 라벨 여러 개는 OR 로 묶는다. 괄호가 없으면 뒤에 오는 필터가
            // 마지막 라벨에만 걸린다 — AND 가 OR 보다 세다:
            //   and lbl~a or lbl~b and ty=3  ->  (lbl~a) or ((lbl~b) and ty=3)
            // 그러면 ty 를 줘도 첫 라벨은 타입 상관없이 다 딸려 나온다.
            query_where += ' (';
            for (var i = 0; i < query.lbl.length; i++) {
                query_where += util.format(' lbl like \'%%\"%%%s%%\"%%\'', query.lbl[i]);

                if (i < query.lbl.length - 1) {
                    query_where += ' or ';
                }
            }
            query_where += ') ';
        }
        query_count++;
    }

    var ty_str = '';
    if (query.ty != null) {
        ty_str = ' and ';
        query_where += ' and ';

        if (query.ty.toString().split(',').length == 1) {
            query_where += util.format('ty = \'%s\'', query.ty);
            ty_str += util.format('ty = \'%s\'', query.ty);
        }
        else {
            query_where += ' (';
            ty_str += ' (';
            for (i = 0; i < query.ty.length; i++) {
                query_where += util.format('ty = \'%s\'', query.ty[i]);
                ty_str += util.format('ty = \'%s\'', query.ty[i]);
                if (i < query.ty.length - 1) {
                    query_where += ' or ';
                    ty_str += ' or ';
                }
            }
            query_where += ') ';
            ty_str += ') ';
        }
        query_count++;
    }

    if (query.cra != null) {
        query_where += ' and ';
        query_where += util.format('\'%s\' <= ct', query.cra);
        query_count++;
    }

    if (query.crb != null) {
        query_where += ' and ';
        query_where += util.format(' ct < \'%s\'', query.crb);
        query_count++;
    }

    if (query.ms != null) {
        query_where += ' and ';
        query_where += util.format('\'%s\' <= lt', query.ms);
        query_count++;
    }

    if (query.us != null) {
        query_where += ' and ';
        query_where += util.format(' lt < \'%s\'', query.us);
        query_count++;
    }

    if (query.exa != null) {
        query_where += ' and ';
        query_where += util.format('\'%s\' <= et', query.exa);
        query_count++;
    }

    if (query.exb != null) {
        query_where += ' and ';
        query_where += util.format(' et < \'%s\'', query.exb);
        query_count++;
    }

    if (query.sts != null) {
        query_where += ' and ';
        query_where += util.format(' st < \'%s\'', query.sts);
        query_count++;
    }

    if (query.stb != null) {
        query_where += ' and ';
        query_where += util.format('\'%s\' <= st', query.stb);
        query_count++;
    }

    // sza / szb / cty 는 contentInstance 의 속성을 본다 — cs(contentSize) 와
    // cnf(contentInfo) 다. 그 둘은 lookup 이 아니라 cin 에 있으므로 별칭 c 로
    // 부른다. 호출부(build_descendant_sql)가 이 셋 중 하나라도 있으면
    // cin 을 조인한다.
    //
    // 예전에는 별칭 없이 cs / cnf 라고 써서 lookup 에 붙였고, lookup 에는 그
    // 컬럼이 없으니 SQL 준비 단계에서 깨져 **항상 HTTP 500** 이었다.
    // 8년 전 mobiusdb.sql 에서 두 컬럼을 뺄 때 이쪽을 안 고쳤다.
    if (query.sza != null) {
        query_where += ' and ';
        // cs 는 MySQL 이 int, SQLite 가 TEXT 라 비교 전에 수로 맞춘다.
        query_where += util.format('%s <= %s', query.sza, facade.numericExpr('c.cs'));
        query_count++;
    }

    if (query.szb != null) {
        query_where += ' and ';
        query_where += util.format('%s < %s', facade.numericExpr('c.cs'), query.szb);
        query_count++;
    }

    if (query.rn != null) {
        query_where += ' and ';
        query_where += util.format('rn = \'%s\'', query.rn);
        query_count++;
    }

    if (query.cty != null) {
        query_where += ' and ';
        // cnf 에는 클라이언트가 준 contentInfo 가 그대로 들어간다
        // (예: 'application/json:0'). 정확 일치로 본다.
        query_where += util.format('c.cnf = \'%s\'', query.cty);
        query_count++;
    }

    callback(query_where);
}

// sza / szb / cty 는 cin 의 속성을 본다. 하나라도 있으면 조인해야 한다.
function needs_cin_join(query) {
    return query.sza != null || query.szb != null || query.cty != null;
}
exports.needs_cin_join = needs_cin_join;

// 요청이 고른 ty 목록. 없으면 null (타입을 안 가린다).
function requested_ty_list(query) {
    if (query.ty == null) { return null; }
    var raw = Array.isArray(query.ty) ? query.ty : String(query.ty).split(',');
    return raw.map(function (t) { return String(t).trim(); }).filter(Boolean);
}

/**
 * 인덱스로 좁힐 수 없는 필터를 쓰면서 타입을 안 고른 요청인가.
 *
 * `lbl` 은 JSON 배열을 담은 문자열이라 `like '%..%'` 로 찾는다. 선행
 * 와일드카드라 어떤 인덱스도 못 탄다. 그래서 타입을 안 고르면 후보가
 * 골격 아래 **모든 자식**이 되고, 그 대부분이 CIN 이다(배포 1억4,560만 행).
 *
 * 배포 실측:
 *   ?fu=1&lbl=status            30초 상한 -> HTTP 500   (0건)
 *   ?fu=1&ty=3&lbl=status       774ms                  (96건)
 *
 * 레이블이 달린 행은 전체에서 극히 적다 — 배포에서 비-CIN 27,677행
 * (ty=3 이 27,333, ty=2 가 338), CIN 은 20만 표본에 9행이다.
 * 즉 후보의 99.95% 를 읽어 버리는 셈이다.
 *
 * 그래서 타입을 안 고르면 **CIN 을 뺀다.** (pi, not_cin) 인덱스가 이미 있어
 * 등치 두 개로 끝난다 — 배포 실측 1.02초 / 96건.
 *
 * CIN 의 레이블은 실제로 쓰인다(예: /Mobius/Arthall/DAQ_1/IR-UWB 의
 * ["signal","only"]). 그래서 **조용히 빼지 않는다** — 호출부가 알 수 있게
 * 표시하고, 찾으려면 ty=4 로 명시하게 한다. 그때는 대상을 좁혀야 한다.
 */
function like_filter_without_ty(query) {
    return query.lbl != null && query.ty == null;
}
exports._like_filter_without_ty = like_filter_without_ty;

// cs / cnf 는 contentInstance(ty=4)에만 있다. 그래서 크기·형식 필터가 붙으면
// 결과는 반드시 ty=4 다. 요청이 다른 타입만 찾고 있으면 답이 있을 수 없다.
//
// 이걸 안 보면 DB 가 그 사실을 모른 채 골격 전체를 훑는다 — 배포 서버에서
// `fu=1&ty=3&sza=10` 이 컨테이너 30,281개마다 cin(249GB)을 찾아보고 0건을
// 돌려주느라 30초 상한에 걸렸다. 질의를 아예 던지지 않는 게 맞다.
function size_filter_excludes_all(query) {
    if (!needs_cin_join(query)) { return false; }
    var tys = requested_ty_list(query);
    if (tys === null) { return false; }   // ty 를 안 줬으면 CIN 도 후보다
    return tys.indexOf('4') < 0;
}
exports.size_filter_excludes_all = size_filter_excludes_all;
/*
exports.search_lookup_parents = function(connection, query, pi, cur_lim, count, found_Obj, callback) {
    if(count >= Object.keys(responder.typeRsrc).length-1) {
        callback('1', found_Obj);
        return;
    }

    build_search_query(query, function (query_where) {
        var query_where_1 = '(pi like \'' + pi + '%\' and ri like \'' + pi + '/%\')';

        if(query.lvl != null) {
            query_where_1 = '(pi like \'' + pi + '%\' and pi not like \'' + pi;
            for(var l = 0; l < query.lvl; l++) {
                query_where_1 += '/%'
            }
            query_where_1 += '\' and ri like \'' + pi + '/%\')';
        }

        if (query.la != null) {
            if (query.la != null) {
                cur_lim = parseInt(query.la, 10);

                var before_ct = moment().subtract(Math.pow(3, count), 'minutes').utc().format('YYYYMMDDTHHmmss');

                query_where += ' and ';
                query_where += util.format(' (\'%s\' < ct) ', before_ct);
            }

            var sql = 'select * from (select * from lookup where ' + query_where_1 + ' ' + query_where + ') b join cin as a on b.ri = a.ri limit ' + cur_lim;
        }
        else {
            var num = Object.keys(responder.typeRsrc)[count];
            sql = 'select * from (select * from lookup where ' + query_where_1 + ' ' + query_where + ') b join ' + responder.typeRsrc[num] + ' as a on b.ri = a.ri limit ' + cur_lim;
        }

        if (query.ofst != null) {
            sql += ' offset ' + query.ofst;
        }

        db.getResult(sql, connection, function (err, result_lookup_ri) {
            if (!err) {
                if (result_lookup_ri.length > 0) {
                    result_lookup_ri = result_lookup_ri.reverse();
                    for (var idx in result_lookup_ri) {
                        if (result_lookup_ri.hasOwnProperty(idx)) {
                            found_Obj[result_lookup_ri[idx].ri] = result_lookup_ri[idx];
                            if(Object.keys(found_Obj).length >= cur_lim) {
                                break;
                            }
                        }
                    }

                    if(Object.keys(found_Obj).length >= cur_lim) {
                        _this.search_lookup_parents(connection, query, pi, cur_lim, Object.keys(responder.typeRsrc).length, found_Obj, function (rsc, found_Obj) {
                            callback(rsc, found_Obj);
                        });
                    }
                    else {
                        _this.search_lookup_parents(connection, query, pi, cur_lim, ++count, found_Obj, function (rsc, found_Obj) {
                            callback(rsc, found_Obj);
                        });
                    }
                }
                else {
                    _this.search_lookup_parents(connection, query, pi, cur_lim, ++count, found_Obj, function (rsc, found_Obj) {
                        callback(rsc, found_Obj);
                    });
                }
            }
            else {
                console.log('[search_lookup_parents] - Database error');
                callback('0');
            }
        });
    });
};
*/

// 자손 수집이 훑지 않는 타입. 리프(4=cin, 23=sub, 17=req)와
// 별도 경로로 다루는 것(1=acp, 9=grp)이다.
const PRESEARCH_SKIP_TY = ['1', '9', '23', '4'];

// 하위(비-리프 타입) 자손을 재귀 CTE 한 번으로 수집.
//
// max_levels 를 주면 그 깊이까지만 내려간다. 안 주면 무상한이다 —
// background subtree 삭제(resource.js 의 delete_descendants_background)가
// 그렇게 쓴다. 응답 경로에서 무상한으로 쓰면 대형 트리에서 분 단위가 걸린다.
exports.search_parents_lookup_all = function (connection, pi_list, cur_result_ri, result_ri,
                                              callback, max_levels) {
    if (pi_list.length === 0) {
        callback('200');
        return;
    }

    var bounded = (max_levels !== undefined && max_levels !== null);
    if (bounded && max_levels <= 0) {
        callback('200');
        return;
    }

    // 예전에는 pi 를 `'${id}'` 로 SQL 에 그대로 끼워 넣었다. pi 는 DB 에서 읽은
    // ri 이고 그 ri 는 클라이언트가 정한 rn 을 담으므로 2차 주입 통로였다.
    var anchor_marks = pi_list.map(function () { return '?'; }).join(',');
    var bindings = pi_list.slice();

    // ty 제외 목록도 바인딩으로 넘긴다. 앵커와 재귀 항에 각각 한 벌씩 필요하다.
    var ty_marks = PRESEARCH_SKIP_TY.map(function () { return '?'; }).join(',');
    bindings = bindings.concat(PRESEARCH_SKIP_TY);

    var depth_sel = bounded ? ', 1 AS depth' : '';
    var depth_rec = bounded ? ', p.depth + 1' : '';
    var depth_lim = '';
    if (bounded) {
        depth_lim = ' AND p.depth < ?';
    }

    var sql =
        'WITH RECURSIVE hierarchy AS (' +
        '  SELECT ri, ty, pi' + depth_sel + ' FROM lookup' +
        '   WHERE pi IN (' + anchor_marks + ') AND ty NOT IN (' + ty_marks + ')' +
        '  UNION ALL' +
        '  SELECT l.ri, l.ty, l.pi' + depth_rec + ' FROM lookup l JOIN hierarchy p ON l.pi = p.ri' +
        '   WHERE l.ty NOT IN (' + ty_marks + ')' + depth_lim +
        ') SELECT ri, ty, pi FROM hierarchy';

    bindings = bindings.concat(PRESEARCH_SKIP_TY);
    if (bounded) { bindings.push(max_levels); }

    facade.run(facade.raw(sql, bindings), connection, function (err, rows) {
        if (err) {
            console.error('[search_parents_lookup] Error:', rows);
            callback('500-1');
            return;
        }
        rows = rows || [];
        for (var i = 0; i < rows.length; i++) {
            result_ri.push(rows[i]);
        }
        callback('200');
    });
};


// discovery 로 찾은 lookup 행에 타입 테이블(cnt / cin / ae ...)의 속성을 채운다.
// 타입 테이블에 짝이 없는 행은 응답에서 뺀다 — lookup 에만 남은 고아다
// (배포 서버에 실제로 ty=3 기준 2건 있다).
//
// 예전에는 결과 **한 건마다 질의 하나**를 순차로 던졌다. resource.js 의
// retrieve 가 fu / rcn 과 무관하게 이 함수를 부르므로, lim=2000 이면
// CTE 1회 + 단건 조회 2,000회이고 그동안 커넥션 하나를 계속 쥐고 있었다.
// 타입별로 묶으면 타입 수만큼(대개 1~3회)으로 끝난다.
//
// count 인자는 그 재귀 구현의 잔재다. 호출부(resource.js)가 0 을 넘기고,
// 이제는 읽지 않는다.
exports.select_spec_ri = function (connection, found_Obj, count, callback) {
    // 키 순서가 곧 응답 순서다. 아래에서 **이미 있는 키에만 대입**하므로
    // (새 키를 만들지 않으므로) 순서가 보존된다.
    var ris = Object.keys(found_Obj);
    if (ris.length === 0) {
        callback('200');
        return;
    }

    // 타입별로 나눈다.
    var by_table = {};
    var i;
    for (i = 0; i < ris.length; i++) {
        var table = responder.typeRsrc[found_Obj[ris[i]].ty];
        if (!table) {
            // 예전에는 facade.k(undefined) 가 만든 SQL 이 깨져 500 이 났다.
            // 결과는 같게 두되 원인을 알아볼 수 있게 남긴다.
            console.error('[select_spec_ri] unknown ty=' + found_Obj[ris[i]].ty +
                          ' ri=' + ris[i] + ' — responder.typeRsrc 에 없다');
            callback('500-1');
            return;
        }
        if (!by_table[table]) { by_table[table] = []; }
        by_table[table].push(ris[i]);
    }

    // ri 는 최대 200자라 500개씩이면 IN 목록이 100KB 남짓이다.
    var CHUNK = 500;
    var tables = Object.keys(by_table);
    var spec_by_ri = {};

    function done() {
        for (var k = 0; k < ris.length; k++) {
            var ri = ris[k];
            if (spec_by_ri[ri]) { found_Obj[ri] = merge(found_Obj[ri], spec_by_ri[ri]); }
            else { delete found_Obj[ri]; }
        }
        callback('200');
    }

    function next_table(ti) {
        if (ti >= tables.length) { return done(); }
        var t = tables[ti];
        var list = by_table[t];
        var pos = 0;

        function next_chunk() {
            if (pos >= list.length) { return next_table(ti + 1); }
            var chunk = list.slice(pos, pos + CHUNK);
            pos += CHUNK;

            facade.run(facade.k(t).select('*').whereIn('ri', chunk), connection,
                function (err, rows) {
                    if (err) {
                        console.error('[select_spec_ri] ' + t + ': ' +
                                      ((rows && (rows.sqlMessage || rows.message)) || rows));
                        return callback('500-1');
                    }
                    rows = rows || [];
                    for (var r = 0; r < rows.length; r++) {
                        // makeObject 가 행을 제자리에서 고치므로 키를 먼저 잡아 둔다.
                        var key = rows[r].ri;
                        makeObject(rows[r]);
                        spec_by_ri[key] = rows[r];
                    }
                    next_chunk();
                });
        }

        next_chunk();
    }

    next_table(0);
};

// discovery 는 두 백엔드 모두 재귀 CTE 하나로 처리한다.
//
// 예전에는 MySQL 만 "레벨별로 부모를 모아 두고 부모마다 질의" 하는 2단계였다.
// 그 방식은 레벨당 2,000개 상한이 있어 큰 트리에서 결과가 조용히 잘렸고,
// 부모 수만큼 왕복이 생겼다. SQLite 는 이미 CTE 였으므로 CTE 로 통일한다.
//
// 골격은 "CIN(ty=4) 이 아닌 자식" 을 따라 넓힌다. 조건의 표현은 백엔드마다
// 다르므로 파사드가 낸다 — facade.notCinPredicate() / notCinIndexName() 참고.
// (MySQL 은 재귀 CTE 안에서 등치만 인덱스를 타므로 가상 생성 컬럼을 쓴다)

// 큰 트리에서 pathological 한 질의(ty 없이 lbl like '%..%' 등)가 커넥션을
// 오래 붙잡지 않도록 문장 단위 상한을 건다. 지원하지 않는 백엔드에서는 null 이라
// 아무것도 붙지 않는다. 배포 서버 실측: 그런 질의는 현행 코드에서도 23초 걸린다.
const DISCOVERY_TIMEOUT_MS = 30000;

// lvl -> 골격을 몇 레벨까지 훑을지. null 이면 무제한.
//
// 골격의 루트가 sk_lvl=0 이고 그 자식이 결과 depth 1 이다. lvl=N 이면
// 결과는 depth N 까지이므로 부모는 sk_lvl <= N-1 까지만 있으면 된다.
function descendant_max_lvl(query) {
    if (query.lvl == null) { return null; }
    var n = parseInt(query.lvl, 10);
    if (isNaN(n)) { return null; }
    return Math.max(0, n - 1);
}
exports.descendant_max_lvl = descendant_max_lvl;

// ri 아래 자손을 한 문장으로 뽑는 SQL 을 만든다. {sql, bindings} 를 준다.
//
// query_where 는 build_search_query 가 만든 조각으로 이미 이스케이프돼 있고
// (sanitize_discovery_query), 컬럼을 alias 없이 부른다. 골격 CTE 는 컬럼을
// sk_ri / sk_lvl 로 이름 붙여 그 조각과 절대 겹치지 않게 한다.
function build_descendant_sql(ri, query, query_where, cur_lim) {
    var C = facade.pathCollate();
    var max_lvl = descendant_max_lvl(query);

    // 재귀항에는 반드시 인덱스를 고정해야 한다.
    //
    // 안 걸면 옵티마이저가 클러스터드 PRIMARY(pi, ri, ty) 를 골라 pi 로만 찾고
    // 나머지를 **필터**로 처리한다. 그러면 골격을 넓히려고 컨테이너를 훑을
    // 때마다 그 컨테이너의 CIN 을 전부 읽는다. 어느 계획을 고르는지는 통계와
    // 캐시 상태로 뒤집혀서, 같은 질의가 아침에 751ms 오후에 80초였고 배포
    // 서버가 실제로 HTTP 500 을 내고 있었다.
    var recur_hint = facade.indexHint(facade.notCinIndexName());

    // 골격은 "CIN 이 아닌 자식" 을 따라 넓힌다 — 분기 하나면 된다.
    //
    // 예전에는 비-리프 타입마다 UNION 분기를 하나씩 만들었다(20개). MySQL 의
    // 재귀 CTE 안에서는 ref(등치) 접근만 되고 range 가 안 되기 때문이다.
    // 배포 서버 실측(2026-08-29, 전체 CSE 골격):
    //   ty in (2,3,5)     인덱스는 pi 까지만, 나머지는 Filter      6,961ms
    //   ty < 4 / ty > 4   인덱스를 고정해도 Filter 로 밀림       125,385ms
    //   ty between        마찬가지                              77,060ms
    //   ty = 'N' 등치 20개                                        4,856ms
    // 골격 30,794노드 × 20 = 616,000회 탐색이 전체 CSE discovery 5초의 대부분이고,
    // 그중 15개 타입은 이 배포에 행이 0개인데도 노드마다 찾아봤다.
    //
    // 이제 lookup 에 (pi, not_cin) 인덱스가 있다(migrations/004). not_cin 은
    // (ty <> 4) 를 담은 가상 생성 컬럼이라 "CIN 이 아니다" 가 등치가 되고,
    // 분기 하나로 끝난다 — 탐색 616,000 -> 34,243 회.
    //
    // ty <> 4 는 SUB / ACP / GRP 도 골격에 넣지만(30,794 -> 34,243) 배포 서버에서
    // 자식을 가진 노드의 타입은 2 / 3 / 5 / 14 뿐이라 결과는 같다. 오히려 앞으로
    // 어떤 타입이 자식을 갖게 되어도 목록을 고칠 필요가 없어 더 안전하다.
    var branches = '';
    // max_lvl 이 0 이면 직계 자식만 보면 되므로 재귀가 아예 필요 없다.
    if (max_lvl === null || max_lvl > 0) {
        var guard = (max_lvl === null) ? '' : ' and s.sk_lvl < ' + max_lvl;
        branches = '\n  union\n' +
            '  select l.ri' + C + ', s.sk_lvl + 1 from lookup l' + recur_hint +
            ' join skel s on l.pi = s.sk_ri' +
            ' where ' + facade.notCinPredicate('l') + guard;
    }

    // 바깥 질의는 (pi, ty, ct) 를 고정한다. 여기는 요청의 ty 로 거르는데,
    // lbl 처럼 인덱스 밖 컬럼이 끼면 옵티마이저가 PRIMARY 를 골라 ty 를 범위에서
    // 빼 버리고 부모마다 CIN 을 전부 읽는다 — 배포 서버에서 60초를 넘겼다.
    //
    // 타입을 안 고르고 lbl 로 찾는 경우는 (pi, not_cin) 을 쓴다. 그래야
    // 부모마다 CIN 을 건너뛰고 비-CIN 자식만 읽는다 — 위 함수 주석 참고.
    var skip_cin = like_filter_without_ty(query);
    var hint = facade.indexHint(skip_cin ? facade.notCinIndexName() : 'idx_lookup_pi_ty_ct');
    var skip_cin_where = skip_cin ? (' and ' + facade.notCinPredicate('r')) : '';

    var timeout = facade.statementTimeoutHint(DISCOVERY_TIMEOUT_MS);
    // 해시 조인을 막는다. 옵티마이저가 재귀항에서 "작은 인덱스를 통째로 훑고
    // 골격의 새 행으로 해시를 만드는" 계획을 고를 때가 있는데, 재귀는 반복마다
    // 상대가 바뀌므로 그 해시를 매번 새로 만든다 (실측 15,584ms -> 4,856ms).
    var nohash = facade.noHashJoinHint(['l', 's']);
    var hints = [timeout, nohash].filter(Boolean).join(' ');
    var lead = 'select ' + (hints ? '/*+ ' + hints + ' */ ' : '');

    // 골격 컬럼을 처음부터 비교용 콜레이션으로 만든다.
    //
    // 조인할 때만 붙이면(s.sk_ri collate ...) 골격 안에 대소문자만 다른 경로가
    // 그대로 남는다. lookup.ri 는 utf8mb3_bin 이라 UNION 이 그것들을 서로 다른
    // 행으로 보기 때문이다. 그러면 같은 자식이 그 수만큼 중복으로 나오고,
    // 호출부가 found_Obj[ri] 로 합치면서 응답이 lim 보다 적어진다.
    //
    // 배포 서버 실측(2026-08-29): 골격 30,855행 중 61행이 대소문자만 다른
    // 중복이었고, ty=3 lim=2000 요청이 2,000행을 받아 1,960건만 돌려줬다.
    // 골격 컬럼을 ci 로 선언하면 UNION 이 원천에서 지운다 — 골격 30,794행,
    // 응답 2,000건, ty=3 전체도 정확히 30,281건(컨테이너 수와 일치).
    // 바인딩은 **이름**으로 준다. 위치 바인딩(?)을 쓰면 안 된다 —
    // query_where 는 클라이언트가 준 값을 문자열 리터럴로 품고 있고, 그 값에
    // 물음표가 하나라도 있으면 knex 가 그것까지 자리표로 세어
    // "Expected 1 bindings, saw 2" 로 죽는다. 물음표는 리소스 이름이나
    // 라벨에 얼마든지 들어갈 수 있는 평범한 글자다
    // (로컬 재현: ?fu=1&rn=what%3F -> HTTP 500).
    // 이름 바인딩에서는 knex 가 :name 만 찾으므로 리터럴 물음표를 건드리지 않는다.
    // 두 방언(mysql / sqlite3) 모두 확인했다.
    // sza / szb / cty 를 쓰면 cin 을 조인한다. 그 값(cs / cnf)은 lookup 에 없다.
    //
    // 조인 키를 (pi, ri) 둘 다로 잡는 이유: cin_ri_idx(pi, ri, cs) 가
    // cs 까지 담고 있어서, sza / szb 만 쓰면 cin 행을 읽지 않고 인덱스만으로
    // 끝난다. cnf 는 인덱스에 없어 행 접근이 필요하다.
    // 두 컬럼 모두 lookup 쪽과 콜레이션이 같아 별도 지정이 필요 없다
    // (pi 는 양쪽 general_ci, ri 는 양쪽 bin).
    //
    // inner join 이 맞다 — cs / cnf 가 없는 리소스(컨테이너 등)는 크기·형식으로
    // 거를 대상이 아니므로 결과에서 빠져야 한다.
    var cin_join = needs_cin_join(query)
        ? ' join cin c on c.pi = r.pi and c.ri = r.ri' : '';

    // 크기·형식 필터가 붙으면 결과는 반드시 ty=4 다 (cs / cnf 가 cin 에만 있다).
    // 조인만으로도 결과는 같지만, 이 조건을 명시해야 (pi, ty) 인덱스가 CIN 만
    // 집어낸다. 없으면 옵티마이저가 골격의 모든 자식을 후보로 놓고 cin 을
    // 하나씩 찾아본다 — 249GB 테이블에 대한 임의 접근이라 매우 비싸다.
    var cin_ty = needs_cin_join(query) ? " and r.ty = '4'" : '';

    var sql =
        'with recursive skel as (\n' +
        '  select ri' + C + ' as sk_ri, 0 as sk_lvl from lookup where ri = :root_ri' + branches + '\n' +
        ')\n' +
        lead + 'r.* from lookup r' + hint +
        ' join skel s on r.pi = s.sk_ri' + cin_join + '\n' +
        ' where 1 = 1' + cin_ty + skip_cin_where + query_where;

    if (max_lvl !== null) { sql += ' and s.sk_lvl <= ' + max_lvl; }

    // la 는 "최신 N건"이다. ct 는 초 단위라 동점이 흔해 ri 로 가려야
    // 안정적이다 (select_edge_resource 와 같은 이유).
    var lim, ofst = null;
    if (query.la != null) {
        sql += ' order by r.ct desc, r.ri desc';
        lim = parseInt(query.la, 10);
    }
    else {
        lim = parseInt(cur_lim, 10);
    }
    if (isNaN(lim) || lim < 0) { lim = max_search_count; }

    if (query.ofst != null) {
        var o = parseInt(query.ofst, 10);
        if (!isNaN(o) && o > 0) { ofst = o; }
    }

    sql += ' limit ' + lim;
    if (ofst !== null) { sql += ' offset ' + ofst; }

    // limit / offset 을 같이 돌려준다. 호출부가 "결과가 잘렸는가" 를 판정하고
    // 다음 오프셋을 계산하는 데 쓴다 (X-M2M-CTS / X-M2M-CTO).
    // 여기서 계산한 값을 그대로 넘겨야 판정이 SQL 과 어긋나지 않는다.
    return { sql: sql, bindings: { root_ri: ri }, limit: lim, offset: ofst || 0,
             // 이 요청에서 CIN 을 뺐는가. 호출부가 응답에 표시하고 로그에 남긴다 —
             // 조용히 좁히면 "없다" 와 "안 찾아봤다" 를 구별할 수 없다.
             skippedCin: skip_cin };
}
exports.build_descendant_sql = build_descendant_sql;

// 인자 목록은 예전 2단계 구현의 것을 그대로 둔다 — 호출부(resource.js)와
// 테스트가 이 형태를 쓴다. pi_list / pi_index / skipped / cni / cur_d /
// loop_cnt / search_tid 는 CTE 가 한 문장으로 끝내므로 더는 읽지 않는다.
//
// 콜백은 callback(code, info) 다. 성공하면 info 에
//   { rows, limit, offset }   SQL 이 돌려준 행 수와 실제로 건 한도/오프셋
// 이 담긴다. 호출부는 이것으로 "결과가 잘렸는가" 를 판정하고 다음 오프셋을
// 계산한다 (X-M2M-CTS / X-M2M-CTO).
//
// **rows 는 select_spec_ri 가 고아 행을 걷어내기 전 수**다. 다음 오프셋은
// DB 가 실제로 건너뛴 만큼이어야 하므로 응답 건수가 아니라 이 값을 써야 한다.
// 안 그러면 클라이언트가 다음 페이지에서 고아 수만큼 앞을 다시 읽는다.
exports.search_lookup = function (connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, skipped, cni, cur_d, loop_cnt, callback, search_tid) {
    sanitize_discovery_query(query); // SQL Injection 방어

    build_search_query(query, function (query_where) {
        var q = build_descendant_sql(ri, query, query_where, cur_lim);

        // 답이 있을 수 없는 조합이면 DB 를 건드리지 않는다.
        // (크기·형식 필터 + ty=4 를 뺀 타입 지정 — 위 함수 주석 참고)
        if (size_filter_excludes_all(query)) {
            return callback('200', { rows: 0, limit: q.limit, offset: q.offset,
                                     skippedCin: q.skippedCin });
        }

        // 파사드 규약: 실패는 cb(true, errObj) 다 — 에러 객체는 **둘째** 인자로 온다
        // (mobius/db/index.js 의 run 참고). 첫 인자를 에러로 착각하면 err 는 그냥
        // boolean true 라서 err.code / err.message 가 전부 undefined 가 되고,
        // 로그에 '[search_lookup] true' 한 줄만 남아 원인을 알 수 없게 된다.
        facade.run(facade.raw(q.sql, q.bindings), connection, function (err, res) {
            if (err) {
                // 문장 상한(MySQL ER_MAX_EXECUTION_TIME_EXCEEDED)은 DB 고장이
                // 아니라 "이 질의가 감당 못 할 범위"라는 뜻이다. 구분해서 남긴다.
                //
                // 대표적인 형태가 ty 없이 lbl like '%..%' 다. 그러면 후보에
                // CIN 이 전부 들어오는데(배포 서버 6,620만 행) LIKE 는 인덱스를
                // 못 타므로 어떤 계획으로도 빠를 수 없다. 인덱스를 강제해도
                // 안 해도 30초를 넘긴다(2026-08-29 실측). 예전 구현은 lbl 패턴이
                // 아예 안 맞아 늘 빈 결과였다(커밋 83e8461).
                if (res && (res.driverCode === 'ER_MAX_EXECUTION_TIME_EXCEEDED' || res.errno === 3024)) {
                    console.error('[search_lookup] statement timeout (' + DISCOVERY_TIMEOUT_MS +
                                  'ms) ri=' + ri + ' query=' + JSON.stringify(query) +
                                  ' — 대상을 좁히거나(더 깊은 경로) ty 를 함께 준다');
                    // 상한에 걸린 것은 DB 고장이 아니라 "이 범위를 감당 못 한다" 다.
                    // 500 "database error" 로 뭉개면 호출자가 무엇을 고쳐야 할지 모른다.
                    return callback('500-6');
                }
                // 인덱스가 없으면 force index 때문에 discovery 가 **전부** 실패한다.
                // 코드만 올리고 마이그레이션을 안 돌린 경우다 — 원인을 바로 알려준다.
                // (새로 설치하면 mobiusdb.sql 이 만들어 주므로 이 경우는 업그레이드뿐)
                else if (res && (res.driverCode === 'ER_KEY_DOES_NOT_EXITS' ||
                                 res.errno === 1176 ||
                                 /Key '[^']*' doesn't exist/i.test(res.sqlMessage || res.message || ''))) {
                    console.error('[search_lookup] 인덱스가 없다: ' +
                                  (res.sqlMessage || res.message) +
                                  ' — node tools/migrate.js --check mysql 로 확인하고 적용할 것');
                }
                else {
                    console.error('[search_lookup] ' + ((res && (res.sqlMessage || res.message)) || res));
                }
                return callback('500-1');
            }
            var rows = res || [];
            for (var i = 0; i < rows.length; i++) {
                found_Obj[rows[i].ri] = rows[i];
            }
            callback('200', { rows: rows.length, limit: q.limit, offset: q.offset,
                              skippedCin: q.skippedCin });
        });
    });
};

// 부모 아래에서 타입으로 거른 뒤 생성순 양 끝 하나를 고른다. la / ol 이 쓴다.
//
// 정렬 키는 (ct, ri) 다. ct 는 초 단위라 같은 초에 만들어진 형제들 사이에서
// 순서를 못 가린다 — 실측(2026-08-28)으로 CIN 22건에 서로 다른 ct 가 2개뿐이라
// la 가 10회 모두 진짜 최신이 아닌 건을 돌려줬다. ri 를 타이브레이커로 쓴다:
// 자동 생성 rn 은 폭이 고정이라 사전순이 곧 생성순이다(mobius/rid.js).
// 클라이언트가 rn 을 직접 준 경우 그 안에서는 임의이지만, ct 가 먼저
// 결정하므로 초 단위까지는 정확하다.
//
// ── MySQL 의 시간창 우회를 걷어냈다 ─────────────────────────────────────
// 예전 MySQL 갈래는 5^n 분짜리 창을 넓혀 가며 최대 10회 재귀했다.
// (pi, ty, ct) 복합 인덱스가 없어서 그냥 정렬하면 ct 인덱스를 역스캔하며
// 수백만 행을 훑었기 때문이다. 그래서 조용해진 큰 컨테이너의 la 는
// 창 안에 아무것도 없어 사실상 응답하지 못했다.
//
// 이제 그 인덱스가 양쪽 백엔드에 있다 (migrations/001, mobiusdb_sqlite.sql).
// InnoDB 가 PK 를 뒤에 붙여 실제 구성이 (pi, ty, ct, ri) 이므로
// `order by ct desc, ri desc limit 1` 이 인덱스 끝에서 한 항목만 읽는다.
// 우회가 필요 없어졌고, 질의도 최대 10회에서 1회가 된다.
function select_edge_resource(connection, parent_ri, child_ty, direction, outObj, callback) {
    var table = responder.typeRsrc[child_ty];
    if (!table) {
        // 알 수 없는 타입이면 조회할 테이블이 없다. 빈 결과로 다룬다.
        callback('200');
        return;
    }

    // ty 는 MySQL 에서 int, SQLite 에서 INTEGER 다. 예전 코드가 문자열로
    // 넘겼고 양쪽 다 컬럼 타입으로 변환해 왔으므로 그대로 둔다.
    var inner = facade.k('lookup')
        .select('*')
        .where({ pi: parent_ri, ty: String(child_ty) })
        .orderBy([{ column: 'ct', order: direction }, { column: 'ri', order: direction }])
        .limit(1);

    var qb = facade.k(inner.as('b'))
        .select('*')
        .join(table + ' as a', 'b.ri', 'a.ri');

    facade.run(qb, connection, function (err, rows) {
        if (err) {
            callback('500-1');
            return;
        }
        if (rows && rows.length > 0) {
            outObj.push(rows[0]);
        }
        callback('200');
    });
}

// loop_count 는 더 쓰지 않는다. 시간창 재귀가 사라져서다 —
// 호출부(app.js)가 아직 0 을 넘기므로 인자는 남겨 둔다.
exports.select_latest_resource = function (connection, parentObj, loop_count, latestObj, callback) {
    var child_ty = parseInt(parentObj.ty, 10) + 1;
    console.time('select_latest ' + parentObj.ri);
    select_edge_resource(connection, parentObj.ri, child_ty, 'desc', latestObj,
        function (code) {
            console.timeEnd('select_latest ' + parentObj.ri);
            callback(code);
        });
};

// select_latest_resource 와 정렬 방향만 다른 쌍둥이다.
// 두 갈래의 SQL 은 이미 바이트 단위로 같았고 실행자만 갈라져 있었다.
// (예전에는 MySQL 쪽에 ORDER BY 가 아예 없어 limit 1 이 임의의 행을 골랐다 —
//  "가장 오래된 것"이라는 의미가 성립하지 않았다. 그건 앞서 고쳤다.)
exports.select_oldest_resource = function (connection, ty, ri, oldestObj, callback) {
    console.time('select_oldest ' + ri);
    select_edge_resource(connection, ri, parseInt(ty, 10), 'asc', oldestObj,
        function (code) {
            console.timeEnd('select_oldest ' + ri);
            callback(code);
        });
};

exports.select_lookup = function (connection, ri, callback) {
    facade.run(facade.k('lookup').select('*').where({ ri: ri }), connection, callback);
};

exports.select_ri_lookup = function (connection, ri, callback) {
    console.time('select_ri_lookup ' + ri);
    facade.run(facade.k('lookup').select('ri', 'sri').where({ ri: ri }), connection,
        function (err, results) {
            console.timeEnd('select_ri_lookup ' + ri);
            callback(err, results);
        });
};

exports.select_grp_lookup = function (connection, ri, callback) {
    console.time('select_group ' + ri);
    var sql = util.format("select * from lookup where ri = \'%s\' and ty = '9'", ri);
    db.getResult(sql, connection, function (err, group_Obj) {
        console.timeEnd('select_group ' + ri);
        callback(err, group_Obj);
    });
};

exports.select_grp = function (connection, ri, callback) {
    var sql = util.format("select * from grp where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, grp_Obj) {
        callback(err, grp_Obj);
    });
};

exports.select_acp = function (connection, ri, callback) {
    facade.run(facade.k('acp').select('*').where({ ri: ri }), connection, callback);
};

exports.select_acp_cnt = function (connection, loop, uri_arr, callback) {
    var pi = '';

    for (var idx in uri_arr) {
        if (uri_arr.hasOwnProperty(idx)) {
            if (uri_arr[idx] != '') {
                if (idx < uri_arr.length - (loop + 1)) {
                    pi += '/' + uri_arr[idx];
                }
            }
        }
    }

    // 두 분기를 합치면서 SQLite 쪽의 try/catch 를 채택했다. MySQL 분기는
    // JSON.parse 를 그대로 불러, acpi 가 깨진 행 하나에 요청 전체가 죽었다.
    facade.run(facade.k('lookup').select('acpi', 'ty').where({ ri: pi }), connection,
        function (err, results) {
            if (err) {
                callback(err, results && results.message);
                return;
            }

            if (results.length === 0) {
                callback(err, results);
                return;
            }

            try {
                results[0].acpi = JSON.parse(results[0].acpi);
            } catch (e) {
                results[0].acpi = [];
            }

            if (results[0].acpi.length === 0 && results[0].ty == '3') {
                _this.select_acp_cnt(connection, ++loop, uri_arr, callback);
                return;
            }

            // 세 번째 인자로 **어느 조상에서 찾았는지**를 준다. 상속으로 판정한
            // 사실이 지금까지 어디에도 남지 않아, AE 의 ACP 를 고쳐도 왜 안
            // 먹는지(중간 컨테이너가 덮어썼다) 를 알 수 없었다.
            // 기존 호출부는 두 인자만 받으므로 그대로 둬도 된다.
            callback(err, results[0].acpi, pi);
        });
};

// 예전에는 IN 목록을 JSON.stringify 한 뒤 대괄호만 떼어 SQL 에 붙였다.
// acpi 는 클라이언트가 주는 값이라 따옴표가 섞이면 SQL 구조가 깨진다.
// whereIn 은 원소마다 바인딩을 만든다.
// 평가 순서가 결과를 바꾸므로 옵티마이저에 맡기지 않는다. pv 에 acr 이 없는
// ACP 를 만나면 security.js 가 그 자리에서 평가를 끝내고 뒤 ACP 를 안 본다.
// ORDER BY 가 없을 때 실측한 것: 요청 순서가 [dev, aaa_empty] 인데 반환은
// [aaa_empty, dev] 로 뒤집혀, ACP 이름만 바꿔도 권한이 사라졌다.
exports.select_acp_in = function (connection, acpiList, callback) {
    facade.run(facade.k('acp').select('*').whereIn('ri', acpiList || []).orderBy('ri', 'asc'),
        connection, callback);
};

exports.select_sub = function (connection, pi, callback) {
    console.time('select_sub');
    var sql = util.format('select * from sub where pi = \'%s\'', pi);
    db.getResult(sql, connection, function (err, results_ss) {
        console.timeEnd('select_sub');
        callback(err, results_ss);
    });
};

exports.select_cb = function (connection, ri, callback) {
    facade.run(facade.k('cb').select('*').where({ ri: ri }), connection, function (err, results_cb) {
        callback(err, results_cb);
    });
};

// 부모 컨테이너의 카운터와 한도를 한 번에 읽는다.
// cnt(cni, cbs, mni, mbs) 와 lookup(st) 둘 다 PK 1행이라 O(1) 이다.
//
// 예전 get_cni_count 는 cin 을 전부 세는 O(n) 집계를 썼다.
// 실측(CIN 100,000건): 집계 7.246ms vs 이 쿼리 0.129ms — 56배.
// 컨테이너가 커질수록 격차가 벌어지고 상한이 없었다.
//
// 예전 시그니처의 ty 인자는 쓰이지 않아 뺐다 (호출부가 없어 안전).
exports.select_cni_parent = function (connection, ri, callback) {
    var qb = facade.k('cnt')
        .join('lookup', 'lookup.ri', 'cnt.ri')
        .select('cnt.cni', 'cnt.cbs', 'cnt.mni', 'cnt.mbs', 'lookup.st')
        .where('cnt.ri', ri);

    facade.run(qb, connection, callback);
};

exports.select_st = function (connection, ri, callback) {
    var sql = util.format("select ri, st from lookup where ri = \'%s\'", ri);

    db.getResult(sql, connection, function (err, results_st) {
        callback(err, results_st);
    });
};

function delete_oldest(connection, obj, count, callback) {
    var del_id = 'delete_oldest (' + count + ') ' + obj.ri + ' - ' + require('shortid').generate() + '';
    console.time(del_id);
    if (global.usesqlite === 'true') {
        var pre_update_executor = function (cb_pre) {
            if (obj.ty == '4' || parseInt(obj.ty, 10) == 4 || obj.ty == '3') {
                var child_ty = parseInt(obj.ty, 10) + 1;
                var find_sql = util.format("SELECT l.ri, c.cs FROM lookup l LEFT JOIN cin c ON l.ri = c.ri WHERE l.pi = '%s' AND l.ty = '%s' ORDER BY l.ct ASC, l.ri ASC LIMIT %s", obj.ri, child_ty, count);
                var sqlite = require('./db_sqlite');
                sqlite.getResult(find_sql, connection, function (err, rows) {
                    if (!err && rows && rows.length > 0) {
                        var total_cs = 0;
                        var total_cnt = rows.length;
                        for (var i = 0; i < rows.length; i++) {
                            total_cs += parseInt(rows[i].cs || 0, 10);
                        }
                        var update_sql = util.format("UPDATE cnt SET cni = cni - %s, cbs = cbs - %s WHERE ri = '%s'", total_cnt, total_cs, obj.ri);
                        sqlite.getResult(update_sql, connection, function (err2, res2) {
                            // 자식(CIN)이 지워졌으니 부모 stateTag 도 올라가야 한다.
                            // CIN 생성(cnt_man)과 단건 삭제(update_parent_by_delete)는
                            // 이미 올리는데 보존 정책 purge 만 빠져 있었다.
                            var st_sql = util.format("UPDATE lookup SET st = st + 1 WHERE ri = '%s'", obj.ri);
                            sqlite.getResult(st_sql, connection, function () {
                                cb_pre();
                            });
                        });
                    } else {
                        cb_pre();
                    }
                });
            } else {
                cb_pre();
            }
        };

        pre_update_executor(function () {
            var sql = util.format('delete from lookup where ri in (select ri from lookup where pi = \'%s\' and ty = \'%s\' order by ct asc, ri asc limit %s)', obj.ri, parseInt(obj.ty, 10) + 1, count);
            var sqlite = require('./db_sqlite');
            sqlite.getResult(sql, connection, function (err, results) {
                console.timeEnd(del_id);
                // MySQL 경로와 같은 규약: 두 번째 인자는 실제 삭제 건수.
                // 객체를 그대로 넘기면 0건 삭제여도 truthy 라 호출자가 재귀한다.
                var deleted = 0;
                if (!err && results) deleted = results.changes || results.affectedRows || 0;
                callback(err, deleted);
            });
        });
    }
    else {
        // MySQL: 트랜잭션 + FOR UPDATE로 클러스터 동시 실행 race condition 방지
        var child_ty = parseInt(obj.ty, 10) + 1;
        var mni = parseInt(obj.mni, 10);
        var mbs = parseInt(obj.mbs, 10);

        connection.beginTransaction(function (txErr) {
            if (txErr) {
                console.error('[delete_oldest] beginTransaction error:', txErr.message);
                console.timeEnd(del_id);
                callback(txErr);
                return;
            }

            // cnt 행 잠금 (FOR UPDATE NOWAIT).
            // 락이 잡혀 있다 = 다른 워커가 같은 컨테이너를 purge 중이라는 뜻이고,
            // 그 패스가 실측 재카운트로 초과분 전체를 지우므로 여기서는 즉시 스킵한다.
            // 예전 FOR UPDATE(대기)는 mni 정상상태에서 매 insert마다 워커들이
            // 줄을 서서 락 컨보이를 만들었고, 대기가 50초를 넘으면 같은 행을 쓰는
            // cnt_man flush가 ER_LOCK_WAIT_TIMEOUT으로 죽었다 (2026-08-25 실측 390건).
            var lock_sql = util.format("SELECT cni, cbs FROM cnt WHERE ri = '%s' FOR UPDATE NOWAIT", obj.ri);
            db.getResult(lock_sql, connection, function (err, lockRows) {
                if (err) {
                    connection.rollback(function () {});
                    console.timeEnd(del_id);
                    if (lockRows && (lockRows.code === 'ER_LOCK_NOWAIT' || lockRows.errno === 3572)) {
                        console.log('[delete_oldest] busy (other worker purging), skip');
                        callback(null);
                    }
                    else {
                        callback(lockRows);
                    }
                    return;
                }
                if (!lockRows || lockRows.length === 0) {
                    connection.rollback(function () {});
                    console.timeEnd(del_id);
                    callback(new Error('cnt row not found'));
                    return;
                }

                // 실제 CIN 카운트 재조회 (잠금 후 최신값)
                // cin_ri_idx(pi, ri, cs) 커버링 인덱스만 읽는다. 예전의
                // lookup LEFT JOIN cin 형태는 결과가 같지만 자식 수만큼 cin 테이블에
                // 랜덤 접근해서, 버퍼 풀에 없으면 락을 쥔 채 수십 초가 걸렸다.
                // (114,627행 실측: LEFT JOIN 7.178s vs 아래 0.142s)
                // cnt.cni/cnt.cbs 를 대신 쓰면 더 싸지만, 그 값은 실제와 최대 100%까지
                // 어긋나 있어 삭제 판단 근거로 쓸 수 없다.
                var recount_sql = util.format(
                    "SELECT COUNT(*) AS n, IFNULL(SUM(cs),0) AS s FROM cin WHERE pi = '%s'",
                    obj.ri);
                db.getResult(recount_sql, connection, function (err2, rcRows) {
                    if (err2 || !rcRows || rcRows.length === 0) {
                        connection.rollback(function () {});
                        console.timeEnd(del_id);
                        callback(err2);
                        return;
                    }

                    var actual_cni = parseInt(rcRows[0].n || 0, 10);
                    var actual_cbs = parseInt(rcRows[0].s || 0, 10);

                    if (actual_cni <= mni && actual_cbs <= mbs) {
                        // 다른 워커가 이미 정리 완료. 저장값이 실측과 어긋나 있으면
                        // (재시작으로 유실된 디바운스 델타, 과거 flush 실패 누적)
                        // 락을 쥔 김에 실측값으로 보정하고 종료 — 드리프트 자가 치유.
                        var stored_cni = parseInt(lockRows[0].cni, 10);
                        var stored_cbs = parseInt(lockRows[0].cbs, 10);
                        var finish_clean = function () {
                            connection.commit(function () {
                                console.log('[delete_oldest] already clean (actual_cni=' + actual_cni + ' <= mni=' + mni + '), skip');
                                console.timeEnd(del_id);
                                callback(null);
                            });
                        };
                        if (stored_cni !== actual_cni || stored_cbs !== actual_cbs) {
                            var heal_sql = util.format(
                                "UPDATE cnt SET cni = %s, cbs = %s WHERE ri = '%s'",
                                actual_cni, actual_cbs, obj.ri);
                            db.getResult(heal_sql, connection, function () {
                                console.log('[delete_oldest] healed drift: cni ' + stored_cni + '->' + actual_cni + ' cbs ' + stored_cbs + '->' + actual_cbs);
                                finish_clean();
                            });
                        }
                        else {
                            finish_clean();
                        }
                        return;
                    }

                    var plan = _this.purge_plan(actual_cni, actual_cbs, mni, mbs);
                    var need_cnt = plan.need_cnt;
                    var need_cs = plan.need_cs;
                    var candidates = plan.candidates;

                    console.log('[delete_oldest] tx delete: actual_cni=' + actual_cni + ' mni=' + mni +
                        ' actual_cbs=' + actual_cbs + ' mbs=' + mbs +
                        ' need_cnt=' + need_cnt + ' need_cs=' + need_cs + ' candidates=' + candidates);

                    var find_sql = util.format(
                        "SELECT l.ri, c.cs FROM lookup l LEFT JOIN cin c ON l.ri = c.ri WHERE l.pi = '%s' AND l.ty = '%s' ORDER BY l.ct ASC, l.ri ASC LIMIT %s",
                        obj.ri, child_ty, candidates);
                    db.getResult(find_sql, connection, function (err3, rows) {
                        if (err3 || !rows || rows.length === 0) {
                            connection.rollback(function () {});
                            console.timeEnd(del_id);
                            callback(err3);
                            return;
                        }

                        // 개수·용량 조건이 모두 충족되는 지점까지만 자른다.
                        var total_cs = 0;
                        var total_cnt = 0;
                        var del_ri = [];
                        for (var i = 0; i < rows.length; i++) {
                            total_cs += parseInt(rows[i].cs || 0, 10);
                            total_cnt++;
                            del_ri.push(connection.escape(rows[i].ri));
                            if (total_cnt >= need_cnt && total_cs >= need_cs) break;
                        }

                        // cni/cbs 는 상대 감산(cni = cni - n)이 아니라 실측 기반
                        // 절대값을 쓴다. 어차피 이 트랜잭션이 실측 재카운트를 이미
                        // 했으므로 공짜이고, 재시작·과거 flush 실패로 누적된 드리프트가
                        // 매 purge마다 자가 치유된다.
                        // (커밋 후 도착하는 디바운스 델타만큼의 오차는 남지만 ~1초분으로 유계)
                        //
                        // lookup.st 는 증분이다. 자식(CIN)이 지워졌으니 부모 stateTag 가
                        // 올라가야 하는데 보존 정책 purge 만 빠져 있었다. st 는 변경
                        // 카운터라 실측값이 없으므로 절대값으로 쓸 수 없다.
                        // MySQL 은 다중 테이블 UPDATE 를 쓸 수 있어 왕복이 늘지 않는다.
                        var update_sql = util.format(
                            "UPDATE cnt, lookup SET cnt.cni = %s, cnt.cbs = %s, " +
                            "lookup.st = lookup.st + 1 WHERE cnt.ri = '%s' AND lookup.ri = '%s'",
                            actual_cni - total_cnt, actual_cbs - total_cs, obj.ri, obj.ri);
                        db.getResult(update_sql, connection, function (err4) {
                            if (err4) {
                                connection.rollback(function () {});
                                console.timeEnd(del_id);
                                callback(err4);
                                return;
                            }

                            // 위에서 고른 바로 그 행들을 지운다.
                            // 예전 "DELETE ... LIMIT n" 은 ORDER BY 가 없어 임의의 n건을
                            // 지웠다. 집계한 집합과 지운 집합이 달라져 cnt 보정값이 틀어졌고,
                            // 오래된 것 대신 최신 데이터가 지워질 수 있었다.
                            var del_sql = "DELETE FROM lookup WHERE ri IN (" + del_ri.join(',') + ")";
                            db.getResult(del_sql, connection, function (err5, results) {
                                if (err5) {
                                    connection.rollback(function () {});
                                    console.timeEnd(del_id);
                                    callback(err5);
                                    return;
                                }
                                connection.commit(function (commitErr) {
                                    var deleted = (results && results.affectedRows) ? results.affectedRows : 0;
                                    console.log('[delete_oldest] committed: deleted=' + deleted);
                                    console.timeEnd(del_id);
                                    // 두 번째 인자가 호출자의 재귀 여부를 정한다.
                                    // 진행 없이 반환하는 다른 경로들은 undefined 를 넘긴다.
                                    callback(commitErr, commitErr ? 0 : deleted);
                                });
                            });
                        });
                    });
                });
            });
        });
    }
}


exports.select_in_ri_list = function (connection, tbl, ri_list, ri_index, found_Obj, loop_cnt, callback, search_tid) {
    var cur_ri = [];

    // 재귀 시 loop_cnt가 증가하지 않아 배치마다 타이머가 새로 생성/누수되던 문제 — tid를 인자로 전달
    if (!search_tid) {
        search_tid = 'select_in_ri_list (' + require('shortid').generate() + ')';
        console.time(search_tid);
    }

    for (var idx = 0; idx < 8; idx++) {
        if (ri_index < ri_list.length) {
            cur_ri.push(ri_list[ri_index++]);
        }
        else {
            break;
        }
    }

    var sql = util.format("select * from " + tbl + " where ri in (" + JSON.stringify(cur_ri).replace('[', '').replace(']', '') + ")");
    db.getResult(sql, connection, function (err, search_Obj) {
        if (!err) {
            for (var i = 0; i < search_Obj.length; i++) {
                found_Obj.push(search_Obj[i]);
            }

            if (ri_index >= ri_list.length) {
                console.timeEnd(search_tid);
                callback(err, found_Obj);
            }
            else {
                setTimeout(function () {
                    _this.select_in_ri_list(connection, tbl, ri_list, ri_index, found_Obj, loop_cnt, function (err, found_Obj) {
                        callback(err, found_Obj);
                    }, search_tid);
                }, 0);
            }
        }
        else {
            console.timeEnd(search_tid);
            callback(err, search_Obj);
        }
    });
};


// select_count_ri 는 여기 있었다. cin 을 전부 세는 O(n) 집계였고,
// get_cni_count 가 저장값(select_cni_parent)을 읽게 되면서 호출부가 없어졌다.
// 실제 값이 필요한 곳은 reconcile_cnt_counters 하나뿐이고 거기서 직접 만든다.

exports.update_cb_poa_csi = function (connection, poa, csi, srt, ri, callback) {
    console.time('update_cb_poa_csi ' + ri);
    facade.run(facade.k('cb').update({ poa: poa, csi: csi, srt: srt }).where({ ri: ri }),
        connection, function (err, results) {
            console.timeEnd('update_cb_poa_csi ' + ri);
            callback(err, results);
        });
};

// update_st 는 여기 있었다. 호출부가 하나도 없었고, `set st = <값>` 대입식이라
// 동시에 두 워커가 부르면 하나가 다른 하나를 덮는다. stateTag 를 올리는 일은
// update_parent_st(증분식)가 맡는다.

exports.update_lookup = function (connection, obj, callback) {
    facade.run(facade.k('lookup').update({
        lt: obj.lt,
        acpi: JSON.stringify(obj.acpi),
        et: obj.et,
        st: obj.st,
        lbl: JSON.stringify(obj.lbl),
        at: JSON.stringify(obj.at),
        aa: JSON.stringify(obj.aa),
        subl: JSON.stringify(obj.subl)
    }).where({ ri: obj.ri }), connection, function (err, results) {
        callback(err, results);
    });
};

// 이전에는 db.getResult 를 무조건 호출해 SQLite 모드에서도 MySQL 로 나갔다.
// select_acp 는 SQLite 에서 읽으므로 정책 갱신이 조용히 유실됐다(2차에서 수정).
// 여기서는 lookup 과 acp 두 문장을 한 트랜잭션으로 묶는다 — 반쪽만 반영되면
// 리소스 메타데이터와 접근 정책이 어긋난다.
exports.update_acp = function (connection, obj, callback) {
    console.time('update_acp ' + obj.ri);
    facade.transaction(connection, function (conn, finish) {
        _this.update_lookup(conn, obj, function (err, results) {
            if (err) { return finish(err, results); }

            facade.run(facade.k('acp').update({
                pv: JSON.stringify(obj.pv),
                pvs: JSON.stringify(obj.pvs)
            }).where({ ri: obj.ri }), conn, function (err2, results2) {
                finish(err2, err2 ? results2 : results);
            });
        });
    }, function (err, results) {
        if (!err) {
            console.timeEnd('update_acp ' + obj.ri);
        }
        callback(err, results);
    });
};

exports.update_ae = function (connection, obj, callback) {
    console.time('update_ae ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            // 두 갈래의 차이는 예약어 or 의 인용뿐이었다 (`ae.or` vs `"or"`).
            // 빌더가 방언별로 인용하므로 사라진다.
            facade.run(facade.k('ae').where({ ri: obj.ri }).update({
                apn: obj.apn,
                poa: JSON.stringify(obj.poa || []),
                or: obj.or,
                rr: obj.rr
            }), connection, function (uerr, ures) {
                console.timeEnd('update_ae ' + obj.ri);
                callback(uerr, ures);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_cnt = function (connection, obj, callback) {
    var cnt_id = 'update_cnt ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cnt_id);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            // update_ae 와 같은 이유로 갈렸다 — `cnt.or` vs `"or"`.
            facade.run(facade.k('cnt').where({ ri: obj.ri }).update({
                mni: obj.mni,
                mbs: obj.mbs,
                mia: obj.mia,
                li: obj.li,
                or: obj.or,
                cni: obj.cni,
                cbs: obj.cbs
            }), connection, function (uerr, ures) {
                console.timeEnd(cnt_id);
                callback(uerr, ures);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_grp = function (connection, obj, callback) {
    console.time('update_grp ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            facade.run(facade.k('grp').update({
                mnm: obj.mnm,
                mid: JSON.stringify(obj.mid),
                macp: JSON.stringify(obj.macp),
                gn: obj.gn
            }).where({ ri: obj.ri }), connection, function (err2, results2) {
                if (!err2) {
                    console.timeEnd('update_grp ' + obj.ri);
                }
                callback(err2, results2);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_lcp = function (connection, obj, callback) {
    console.time('update_lcp ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            facade.run(facade.k('lcp').update({ lou: obj.lou, lon: obj.lon })
                .where({ ri: obj.ri }), connection, function (err2, results2) {
                if (!err2) {
                    console.timeEnd('update_lcp ' + obj.ri);
                }
                callback(err2, results2);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_fcnt = function (connection, obj, callback) {
    console.time('update_fcnt ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            console.timeEnd('update_fcnt ' + obj.ri);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_dooLk = function (connection, obj, callback) {
    console.time('update_hd_dooLk ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ lock: obj.lock }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_hd_dooLk ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_bat = function (connection, obj, callback) {
    console.time('update_hd_bat ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ lvl: obj.lvl }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_hd_bat ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_tempe = function (connection, obj, callback) {
    console.time('update_hd_tempe ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ curT0: obj.curT0 }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_hd_tempe ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_binSh = function (connection, obj, callback) {
    console.time('update_hd_binSh ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ powerSe: obj.powerSe }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_hd_binSh ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_fauDn = function (connection, obj, callback) {
    console.time('update_hd_fauDn ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ sus: obj.sus }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_hd_fauDn ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_colSn = function (connection, obj, callback) {
    console.time('update_hd_colSn ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ colSn: obj.colSn }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_hd_colSn ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_brigs = function (connection, obj, callback) {
    console.time('update_hd_brigs ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ brigs: obj.brigs }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_hd_brigs ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_color = function (connection, obj, callback) {
    console.time('update_hd_color ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ red: obj.red, green: obj.green, blue: obj.blue }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_hd_color ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_fwr = function (connection, obj, callback) {
    console.time('update_fwr ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', vr = \'%s\', fwnnam = \'%s\', url = \'%s\', ud = \'%s\', uds = \'%s\' where ri = \'%s\'',
                obj.dc, obj.vr, obj.fwnnam, obj.url, obj.ud, JSON.stringify(obj.uds), obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_fwr ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_bat = function (connection, obj, callback) {
    console.time('update_bat ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', btl = \'%s\', bts = \'%s\' where ri = \'%s\'', obj.dc, obj.btl, obj.bts, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_bat ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_dvi = function (connection, obj, callback) {
    console.time('update_dvi ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', dbl = \'%s\', man = \'%s\', mgo.mod = \'%s\', dty = \'%s\', fwv = \'%s\', swv = \'%s\', hwv = \'%s\' where ri = \'%s\'',
                obj.dc, obj.dbl, obj.man, obj.mod, obj.dty, obj.fwv, obj.swv, obj.hwv, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_dvi ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_dvc = function (connection, obj, callback) {
    console.time('update_dvc ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', can = \'%s\', att = \'%s\', cas = \'%s\', cus = \'%s\', ena = \'%s\', dis = \'%s\' where ri = \'%s\'',
                obj.dc, obj.can, obj.att, JSON.stringify(obj.cas), obj.cus, obj.ena, obj.dis, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_dvc ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_rbo = function (connection, obj, callback) {
    console.time('update_rbo ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', rbo = \'%s\', far = \'%s\' where ri = \'%s\'',
                obj.dc, obj.rbo, obj.far, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_rbo ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_nod = function (connection, obj, callback) {
    console.time('update_nod ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update nod set ni = \'%s\', mgca = \'%s\' where ri = \'%s\'', obj.ni, obj.mgca, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_nod ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_csr = function (connection, obj, callback) {
    console.time('update_csr ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update csr set poa = \'%s\', mei = \'%s\', tri = \'%s\', rr = \'%s\', nl = \'%s\' where ri = \'%s\'',
                JSON.stringify(obj.poa), obj.mei, obj.tri, obj.rr, obj.nl, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_csr ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

// 이전에는 db.getResult 를 무조건 호출해 SQLite 모드에서 구독 갱신이 유실됐다
// (2차에서 수정). 여기서는 lookup 과 sub 두 문장을 한 트랜잭션으로 묶는다 —
// 반쪽만 반영되면 리소스 메타데이터와 알림 설정이 어긋난다.
exports.update_sub = function (connection, obj, callback) {
    console.time('update_sub ' + obj.ri);
    facade.transaction(connection, function (conn, finish) {
        _this.update_lookup(conn, obj, function (err, results) {
            if (err) { return finish(err, results); }

            facade.run(facade.k('sub').update({
                enc: JSON.stringify(obj.enc),
                exc: obj.exc,
                nu: JSON.stringify(obj.nu),
                gpi: obj.gpi,
                nfu: obj.nfu,
                bn: JSON.stringify(obj.bn),
                rl: obj.rl,
                pn: obj.pn,
                nsp: obj.nsp,
                ln: obj.ln,
                nct: obj.nct,
                nec: obj.nec
            }).where({ ri: obj.ri }), conn, function (err2, results2) {
                finish(err2, err2 ? results2 : results);
            });
        });
    }, function (err, results) {
        if (!err) {
            console.timeEnd('update_sub ' + obj.ri);
        }
        callback(err, results);
    });
};

exports.update_smd = function (connection, obj, callback) {
    console.time('update_smd ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update smd set dsp = \'%s\', dcrp = \'%s\', soe = \'%s\', rels = \'%s\', smd.or = \'%s\' where ri = \'%s\'',
                obj.dsp, obj.dcrp, obj.soe, JSON.stringify(obj.rels), obj.or, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_smd ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_mms =function (connection, obj, callback) {
    console.time('update_mms ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mms set stid = \'%s\', asd = \'%s\', osd = \'%s\', sst = \'%s\' where ri = \'%s\'',
                obj.stid, obj.asd, obj.osd, obj.sst, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_mms ' + obj.ri);
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};


// 컨테이너의 cni/cbs 를 절대값으로 고쳐 쓴다. 정합 맞추기(reconcile_cnt_counters)
// 전용이다 — 평상시 카운터 유지는 전부 증분(cnt_man / delete_oldest /
// update_parent_by_delete)이 담당한다.
//
// lookup.st 는 일부러 건드리지 않는다. st 는 변경 카운터라 실제 데이터에서
// 다시 계산할 수 없고, 정합 맞추기가 올리면 없던 구독 알림이 나간다.
// (예전에는 다중 테이블 UPDATE 를 그대로 옮기느라 st 까지 대입했다.)
exports.update_cnt_cni = function (connection, obj, callback) {
    var cni_id = 'update_cnt_cni ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);

    var qb = facade.k('cnt')
        .update({ cni: obj.cni, cbs: obj.cbs })
        .where({ ri: obj.ri });

    facade.run(qb, connection, function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
        }
        callback(err, results);
    });
};

// 저장된 cni/cbs 를 실제 cin 집계와 맞춘다.
//
// get_cni_count 가 저장값을 읽게 되면서 "매번 재집계" 라는 안전망이 사라졌다.
// 아직 감산하지 않는 경로가 남아 있어 드리프트가 생길 수 있다:
//   - delete_descendants_background (subtree 배경 삭제)
//   - delete_lookup_et (만료 스윕)
//   - 프로세스 중단, 직접 DB 조작
//
// 한 번에 limit 건씩만 본다. 컨테이너가 많아도 한 패스가 길어지지 않게 하려는 것이다.
// 하위 질의는 cin_ri_idx(pi, ri, cs) 커버링 인덱스만 읽는다.
// 저장된 cni/cbs 를 실제 cin 집계와 맞춘다.
//
// get_cni_count 가 저장값을 읽게 되면서 "매번 재집계" 라는 안전망이 사라졌다.
// 아직 감산하지 않는 경로(subtree 배경 삭제, 만료 스윕, 프로세스 중단)가
// 남아 있어 드리프트가 생길 수 있다.
//
// ── 운영 규모를 견디도록 설계했다 ──────────────────────────────────────
// 배포 환경: 컨테이너 30,279개, CIN 1억 4558만 행, 그중 593만 건짜리 컨테이너 존재.
//
// 1. 커서로 진행한다. 예전 구현은 ORDER BY 없이 `limit N` 만 걸어서 늘 같은
//    N개만 봤다 — 나머지 컨테이너는 영원히 검사되지 않았다.
// 2. 조인을 쓰지 않는다. 운영 스키마는 ri 가 utf8mb3_bin, pi 가
//    utf8mb3_general_ci 라 부모↔자식 조인이 인덱스를 못 쓴다
//    (실측: LEFT JOIN 형태는 컨테이너 50개에 20초 상한 초과).
//    리터럴 비교는 정상적으로 인덱스를 탄다 (type: ref, Using index).
// 3. 시간 예산을 둔다. 한 번 호출이 무한정 길어지지 않게 하고 남은 몫은
//    커서로 넘긴다.
// 4. 컨테이너 하나에도 상한을 건다. 예산 검사만으로는 부족했다 — 검사는
//    컨테이너 *사이*에서만 하므로, 집계 하나가 예산보다 오래 걸리면 그
//    컨테이너가 스윕 전체를 삼킨다. 게다가 예전 판은 집계가 실패하면
//    로그만 찍고 조용히 다음으로 넘어가서, 호출자는 무슨 일이 있었는지
//    알 수 없었다.
//
//    배포 서버 실측 (2026-08-28): 가장 큰 컨테이너
//    /Mobius/KETI_MUV/.../SBUS/disarm (cni 5,930,795) 의 집계는
//    커버링 인덱스를 쓰고도(type: ref, Using index, rows 11,372,914)
//    20초 상한에 걸려 강제 종료됐다.
//
//    그래서 (a) 집계마다 aggTimeoutMs 를 걸고 남은 예산으로 더 조이며,
//    (b) maxCni 를 넘는 컨테이너는 아예 집계하지 않고 미루고,
//    (c) 실패·유예를 보고에 담아 관리자 UI 가 따로 처리할 수 있게 한다.
//    미룬 컨테이너는 어차피 매 스윕 상한에 걸릴 뿐이라, 빼는 편이
//    나머지 3만 개를 실제로 검사하게 한다.
//
//    aggTimeoutMs 는 **서버 측** 상한이다(db.statementTimeoutHint).
//    드라이버 타임아웃으로 걸면 안 된다 — 걸리는 순간 커넥션이 죽어서
//    남은 컨테이너가 전부 PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR 로 연쇄
//    실패한다(로컬 MySQL 실측). 서버 힌트는 그 문장만 중단한다.
//    SQLite 에는 해당 힌트가 없어 상한이 안 걸린다 — 임베디드 규모라
//    문제가 안 된다. maxCni 는 양쪽 백엔드에서 똑같이 동작한다.
//
// opts: { limit, cursor, budgetMs, aggTimeoutMs, maxCni }
// 콜백: (err, { checked, fixed, failed, failedRis, deferred, deferredRis,
//               nextCursor, done })
//   done=false 면 nextCursor 로 다시 부르면 이어서 돈다.
exports.reconcile_cnt_counters = function (connection, opts, callback) {
    // 예전 시그니처 (connection, limit, callback) 도 받아 준다.
    if (typeof opts === 'number') { opts = { limit: opts }; }
    opts = opts || {};

    var limit = opts.limit || 200;
    var cursor = opts.cursor || '';
    var budgetMs = (opts.budgetMs === undefined) ? 30000 : opts.budgetMs;
    // 컨테이너 하나의 집계에 허용할 시간. 0 이면 상한을 걸지 않는다.
    var aggTimeoutMs = (opts.aggTimeoutMs === undefined) ? 5000 : opts.aggTimeoutMs;
    // 저장된 cni 가 이보다 크면 집계하지 않고 미룬다. 0 이면 전부 집계한다.
    var maxCni = (opts.maxCni === undefined) ? 1000000 : opts.maxCni;

    var rec_id = 'reconcile_cnt_counters - ' + require('shortid').generate();
    console.time(rec_id);
    var started = Date.now();

    var batch = facade.k('cnt')
        .select('ri', 'cni', 'cbs')
        .where('ri', '>', cursor)
        .orderBy('ri', 'asc')
        .limit(limit);

    facade.run(batch, connection, function (err, rows) {
        if (err) {
            console.timeEnd(rec_id);
            callback(err, rows);
            return;
        }

        rows = rows || [];
        var idx = 0;
        var fixed = 0;
        var failed = [];      // 집계가 실패한 컨테이너 (타임아웃 등)
        var deferred = [];    // maxCni 를 넘어 집계를 건너뛴 컨테이너
        var lastRi = cursor;

        function finish(outOfBudget) {
            console.timeEnd(rec_id);
            if (fixed > 0 || failed.length > 0 || deferred.length > 0) {
                console.log('[reconcile_cnt_counters] ' + idx + '건 확인, ' + fixed + '건 교정' +
                            (failed.length ? ', ' + failed.length + '건 실패' : '') +
                            (deferred.length ? ', ' + deferred.length + '건 유예(대형)' : ''));
            }
            callback(null, {
                checked: idx,
                fixed: fixed,
                failed: failed.length,
                failedRis: failed,
                deferred: deferred.length,
                deferredRis: deferred,
                nextCursor: lastRi,
                // 배치를 다 채웠거나 예산이 끊겼으면 아직 남았다.
                done: !outOfBudget && rows.length < limit
            });
        }

        // 예산이 한 건을 볼 만큼 남지 않았으면 시작하지 않는다. 남은 예산이
        // 몇 ms 뿐인데 집계를 걸면 그 컨테이너가 '실패' 로 기록되는데,
        // 실제로는 느린 게 아니라 그냥 시간이 없었을 뿐이다 — 관리자 UI 에
        // 가짜 후보를 올리게 된다.
        var MIN_SLICE_MS = 200;
        // budgetMs: 0 은 "예산 없음" 이 아니라 "시간이 없다" 는 뜻이다
        // (첫 컨테이너를 보기 전에 멈춘다). null 을 줘야 예산을 안 건다.
        var hasBudget = (budgetMs !== null && budgetMs !== undefined);

        (function next() {
            if (idx >= rows.length) { return finish(false); }
            if (hasBudget && (Date.now() - started) >= Math.max(0, budgetMs - MIN_SLICE_MS)) {
                return finish(true);
            }

            var row = rows[idx++];
            lastRi = row.ri;

            // 너무 큰 컨테이너는 집계 자체가 예산을 넘긴다. 건너뛰고 보고에 남긴다.
            // 게이트는 저장된 cni 로 하는데, 그 값이야말로 지금 의심하는 값이다.
            // 저장값이 실제보다 작게 어긋나 있으면 여기를 통과해 집계를 시도하고
            // 그때는 aggTimeoutMs 가 받아 낸다 — 두 겹으로 막힌다.
            if (maxCni && (parseInt(row.cni, 10) || 0) > maxCni) {
                deferred.push(row.ri);
                // 이 갈래는 비동기 호출이 없어 그대로 재귀하면 스택이 쌓인다
                // (limit 이 2000 이다). 이벤트 루프를 놓아 트래픽도 막지 않는다.
                return setImmediate(next);
            }

            // 리터럴 pi 로 집계한다 — cin_ri_idx(pi, ri, cs) 커버링 인덱스만 읽는다.
            var agg = facade.k('cin')
                .count('* as n')
                .sum('cs as s')
                .where({ pi: row.ri });

            // 집계 상한은 남은 예산보다 클 수 없다. 안 그러면 마지막 컨테이너
            // 하나가 예산을 넘겨 버린다.
            //
            // 상한은 **서버 측** 힌트로 건다. 드라이버 타임아웃(run 의
            // opts.timeoutMs)을 쓰면 안 된다 — 한 번 걸리는 순간 커넥션이
            // 죽어서 남은 컨테이너가 전부 PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR
            // 로 연쇄 실패한다. 로컬 MySQL 실측으로 확인했다: 첫 건이
            // PROTOCOL_SEQUENCE_TIMEOUT 으로 죽자 뒤의 4건이 그대로 무너졌다.
            // 서버 힌트는 그 문장만 중단하고 커넥션을 살려 둔다.
            if (aggTimeoutMs) {
                var remain = hasBudget ? (budgetMs - (Date.now() - started)) : 0;
                var capMs = (remain > 0 && remain < aggTimeoutMs) ? remain : aggTimeoutMs;
                var hint = facade.statementTimeoutHint(capMs);
                if (hint) { agg = agg.hintComment(hint); }
            }

            facade.run(agg, connection, function (aerr, ares) {
                if (aerr) {
                    failed.push(row.ri);
                    console.error('[reconcile_cnt_counters] 집계 실패 ri=' + row.ri + ': ' +
                                  ((ares && (ares.driverCode || ares.code)) || ares));
                    return next();
                }

                var a = (ares && ares[0]) || {};
                var real_cni = parseInt(a.n || 0, 10);
                var real_cbs = parseInt(a.s || 0, 10);

                if (parseInt(row.cni, 10) === real_cni &&
                    parseInt(row.cbs, 10) === real_cbs) {
                    return next();
                }

                console.log('[reconcile_cnt_counters] drift ri=' + row.ri +
                            ' cni ' + row.cni + '->' + real_cni +
                            ' cbs ' + row.cbs + '->' + real_cbs);

                _this.update_cnt_cni(connection,
                    { ri: row.ri, cni: real_cni, cbs: real_cbs },
                    function (uerr, ures) {
                        if (uerr) {
                            console.error('[reconcile_cnt_counters] 교정 실패 ri=' + row.ri + ': ' +
                                          ((ures && (ures.driverCode || ures.code)) || ures));
                        }
                        else {
                            fixed++;
                        }
                        next();
                    });
            });
        })();
    });
};

// update_parent_by_insert 는 여기 있었다. 호출부가 하나도 없었다 —
// CIN 삽입 시 부모 카운터를 올리는 일은 cnt_man 이 debounce 배치로 완전히
// 대체했다 (resource.js 의 cnt_man.schedule 이 유일한 경로다).

// 이전에는 MySQL 전용 다중 테이블 UPDATE(`update cnt, lookup set ...`)를
// db.getResult 로 보냈다. db_action.getResult 는 usesqlite 와 무관하게 항상
// MySQL 풀로 가므로, SQLite 모드에서는 MySQL 의 0개 행에 적용되고 에러 없이
// 성공 처리됐다 — st 증가가 조용히 유실됐다.
//
// tableName 은 SET 절이 아니라 조건절에만 쓰였다. "해당 ri 가 그 타입
// 테이블에 존재할 때만 올린다"는 의미이므로, EXISTS 서브쿼리로 그대로 옮긴다.
exports.update_parent_st = function (connection, obj, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var st_id = 'update_parent_st ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(st_id);

    var qb = facade.k('lookup')
        .update({ st: facade.raw('st + 1') })
        .where({ ri: obj.ri })
        .whereExists(facade.k(tableName).select('*').whereRaw('??.?? = ?', [tableName, 'ri', obj.ri]));

    facade.run(qb, connection, function (err, results) {
        if (!err) {
            console.timeEnd(st_id);
        }
        callback(err, results);
    });
};

// 이전에는 MySQL 전용 다중 테이블 UPDATE 를 db.getResult 로 보냈다.
// SQLite 모드에서는 MySQL 의 0개 행에 적용돼 cni/cbs 감소가 조용히 유실됐다
// (실측: cin 은 지워지는데 cnt.cni 는 그대로).
//
// 한 문장을 두 문장으로 쪼개면 원자성을 잃으므로 transaction 으로 감싼다.
// MySQL 은 실제 BEGIN/COMMIT 이 돌고, SQLite 는 능력이 없어 본문만 돈다
// (기존 SQLite 경로도 이미 비원자적이었으므로 회귀는 아니다).
//
// console.time 라벨이 'update_parent_by_insert' 였던 것은 복사 실수다.
exports.update_parent_by_delete = function (connection, obj, cs, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var cni_id = 'update_parent_by_delete ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);

    facade.transaction(connection, function (conn, finish) {
        var q1 = facade.k(tableName)
            .update({
                cni: facade.raw('cni - 1'),
                cbs: facade.raw('cbs - ?', [cs])
            })
            .where({ ri: obj.ri });

        facade.run(q1, conn, function (err1, r1) {
            if (err1) { return finish(err1, r1); }

            var q2 = facade.k('lookup')
                .update({ st: facade.raw('st + 1') })
                .where({ ri: obj.ri });

            facade.run(q2, conn, function (err2, r2) {
                finish(err2, err2 ? r2 : r1);
            });
        });
    }, function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
        }
        callback(err, results);
    });
};

exports.delete_ri_lookup = function (connection, ri, callback) {
    facade.run(facade.k('lookup').where({ ri: ri }).del(), connection, callback);
};

// delete_ri_lookup_in 은 여기 있었다. 호출부가 하나도 없었고,
// `DELETE ... LIMIT` 은 MySQL 전용이라 SQLite 에서는 애초에 못 쓰는 문장이었다.

function delete_lookup_action(connection, pi_list, req_count, callback) {
    if (pi_list.length <= req_count) {
        callback('200');
        return;
    }

    var pi = pi_list[req_count];

    // 파사드가 결과를 {affectedRows} 로 정규화하므로 예전의
    // (changes || affectedRows) 백엔드별 분기가 필요 없다.
    facade.run(facade.k('lookup').where({ pi: pi }).del(), connection,
        function (err, deleted_Obj) {
            if (err) {
                // 예전에는 아무것도 남기지 않고 '500-1' 만 돌려줬다. 위로
                // 올라가도 호출부가 코드를 안 보기 때문에(아래 delete_lookup 과
                // resource.js 의 delete_descendants_background), subtree 삭제가
                // 중간에 멈춰도 흔적이 하나도 없었다.
                //
                // 그래서 "고아가 왜 생기나" 를 물으면 답할 근거가 없었다.
                // 데드락인지, 60초 쿼리 타임아웃인지, 커넥션이 끊긴 것인지
                // 구분할 수 없다. 드라이버 코드를 남긴다.
                console.error('[delete_lookup_action] ' + pi + ' 삭제 실패: ' +
                              ((deleted_Obj && (deleted_Obj.driverCode || deleted_Obj.code)) || '?') +
                              ' / ' + ((deleted_Obj && deleted_Obj.message) || ''));
                callback('500-1');
                return;
            }
            console.log('deleted ' + deleted_Obj.affectedRows + ' resource(s) of ' + pi);
            delete_lookup_action(connection, pi_list, ++req_count, callback);
        });
}

exports.delete_lookup = function (connection, pi_list, pi_index, found_Obj, found_Cnt, callback) {
    var cur_pi = [];
    var batch_start = pi_index;      // 실패 시 어느 구간이었는지 알려면 필요하다

    for (var idx = 0; idx < 32; idx++) {
        if (pi_index < pi_list.length) {
            cur_pi.push(pi_list[pi_index++]);
        }
        else {
            break;
        }
    }

    delete_lookup_action(connection, cur_pi, 0, function (code) {
        if (code === '200') {
            if (pi_index >= pi_list.length) {
                callback(code);
            }
            else {
                _this.delete_lookup(connection, pi_list, pi_index, found_Obj, found_Cnt, function (err, found_Obj) {
                    callback(err, found_Obj);
                });
            }
        }
        else {
            // 한 배치(32개)에서 실패하면 남은 것을 건드리지 않고 멈춘다.
            // 어디까지 가고 멈췄는지를 남긴다 — 이게 없으면 subtree 가
            // 반만 지워진 채로 끝나도 아무도 모른다.
            //
            // 배치의 *시작* 인덱스를 적는다. pi_index 는 이미 배치 끝까지
            // 전진해 있어서 그대로 쓰면 진행도를 과장한다. 실패는 이 배치
            // 안 어딘가에서 났고, 그 앞(batch_start 개)까지는 지워졌다.
            console.error('[delete_lookup] ' + batch_start + '/' + pi_list.length +
                          ' 까지 지우고 다음 배치에서 멈췄다 (code=' + code +
                          '). 나머지는 고아로 남는다.');
            callback(code);
        }
    });
};

// et 가 지난 리소스를 조회한다. 읽기만 한다 — 관리자 UI 가 목록을 보여 주고
// 무엇을 지울지, 무엇의 et 를 늘릴지 고르게 하는 용도다.
//
// AE(2)·CNT(3)·CSEBase(5) 는 제외한다. 이들을 자동으로 지우면 그 아래 데이터가
// 통째로 사라진다. (제외 정책을 바꿀지는 별도 판단 사항이다.)
exports.select_expired_resources = function (connection, et, limit, callback) {
    var qb = facade.k('lookup')
        .select('ri', 'ty', 'rn', 'pi', 'et')
        .where('et', '<', et)
        .whereNotIn('ty', [2, 3, 5])
        .orderBy('et', 'asc')
        .limit(limit);

    facade.run(qb, connection, callback);
};

// 만료된 리소스를 지운다. **자동 실행하지 않는다** — app.js 에 주기 등록이 없다.
// 관리자가 select_expired_resources 로 확인한 뒤 호출하는 용도다.
//
// 예전 구현의 문제:
//   1. 만료된 ri 를 pi 자리에 넣어 "만료 리소스의 자식"을 지웠다. 정작 만료
//      리소스 자신은 남았다 (실측 확인). 선택되는 타입이 대부분 자식 없는
//      리프라 사실상 아무 것도 안 지우는 no-op 이었다.
//   2. LIMIT 이 없어 만료 행이 많으면 한 번에 전부 읽었다.
//   3. if (!err) 만 있고 else 가 없어, 조회 실패 시 콜백이 안 불렸다 —
//      호출부가 콜백 안에서 connection.release() 를 하므로 커넥션이 샜다.
//   4. 조회가 db.getResult(MySQL 고정)라 SQLite 모드에서는 MySQL 을 읽고
//      SQLite 를 지우는 스플릿브레인이었다.
//
// lookup 행을 지우면 하위 테이블(ae/cnt/cin ...)은 FK ON DELETE CASCADE 로
// 함께 지워지고, 남는 자손은 delete_orphan_lookup 이 걷는다.
exports.delete_lookup_et = function (connection, et, limit, callback) {
    var del_id = 'delete_lookup_et - ' + require('shortid').generate();
    console.time(del_id);

    _this.select_expired_resources(connection, et, limit, function (err, rows) {
        if (err) {
            console.timeEnd(del_id);
            callback(err, rows);
            return;
        }

        rows = rows || [];
        if (rows.length === 0) {
            console.timeEnd(del_id);
            callback(null, { deleted: 0, rows: [] });
            return;
        }

        var ri_list = rows.map(function (r) { return r.ri; });

        facade.run(facade.k('lookup').whereIn('ri', ri_list).del(), connection,
            function (derr, dres) {
                console.timeEnd(del_id);
                if (derr) {
                    callback(derr, dres);
                    return;
                }
                console.log('[delete_lookup_et] ' + rows.length + '건 삭제');
                callback(null, { deleted: rows.length, rows: rows });
            });
    });
};


// 부모(pi)가 lookup에 없는 고아 행 정리 (비동기 subtree 삭제 중 크래시 잔여물).
// ri 키셋으로 5000행씩 훑으며 각 배치의 부모 존재를 PK IN 조회로 확인하는
// 증분 스캔. 예전의 풀테이블 LEFT JOIN 안티조인은 수백만 행 테이블(ketigcs)
// 에서 60초 쿼리 타임아웃으로 매 부팅 실패했다 — 고아가 0건일 때(평상시)가
// 오히려 최악 케이스였다. 지금은 쿼리 하나하나가 인덱스 범위 조회라 짧고,
// 사이사이 이벤트 루프를 놓아 라이브 트래픽을 막지 않는다.
// 다단계 고아: 같은 패스에서 부모가 지워진 자식은 다음 패스가 잡는다.
// 패스는 삭제가 있었던 동안만 반복한다 (평상시 1패스로 끝).
// 실행자만 갈라져 있었다 (db_sqlite.getResult vs db.getResult). SQL 은 한 벌을
// 공유했으므로 파사드로 옮기면 분기가 사라진다.
//
// 겸사겸사 수동 이스케이프(esc)를 걷어냈다. `\` 와 `'` 만 다루는 불완전한
// 것이었고, ri/pi 는 클라이언트가 정한 rn 을 담으므로 2차 주입 통로였다.
// ── ACP 조회 (관리 콘솔용) ────────────────────────────────────────────
//
// 전부 읽기 전용이다. 무엇도 지우거나 고치지 않고 목록만 돌려준다 — 되돌릴
// 수 없는 조작은 관리자가 화면을 보고 정한다.
//
// **lookup.acpi 에는 인덱스가 없다.** JSON 문자열이라 SQL 로 역질의도 안 된다
// (`acpi like '%...%'` 는 선행 와일드카드라 인덱스를 못 탄다 — 배포 lookup 은
// 5,740만 행이므로 절대 쓰지 않는다). 그래서 역참조는 not_cin 술어로 CIN
// 3,400만 행을 빼고 남는 34,313 행만 키셋으로 훑으며 앱에서 대조한다.

var ACP_LIST_MAX = 500;
var ACP_SCAN_BATCH = 2000;
var ACP_SCAN_CAP = 200000;
var ACP_REFS_MAX = 1000;

// CIN 이 아닌 리소스 타입. responder.typeRsrc 가 이 CSE 가 다루는 타입의
// 단일 출처라 목록을 손으로 유지하지 않는다 — 새 타입이 생겨도 따라온다.
function non_cin_ty_list() {
    var out = [];
    var map = responder.typeRsrc || {};
    Object.keys(map).forEach(function (k) {
        var t = Number(k);
        if (isFinite(t) && t !== 4) { out.push(t); }
    });
    out.sort(function (a, b) { return a - b; });
    return out;
}

exports._non_cin_ty_list = non_cin_ty_list;

/**
 * ACP 리소스 목록. ty 등치라 idx_lookup_ty 를 탄다.
 *
 * @param opts { limit=100(상한 500), afterRi='' }
 * @returns callback(null, { rows:[{ri,pi,rn,ct,lt,et,acpi}], more, nextRi })
 */
exports.select_acp_list = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};
    var limit = Math.min(Math.max(parseInt(o.limit, 10) || 100, 1), ACP_LIST_MAX);
    var after = o.afterRi || '';

    var qb = facade.k('lookup')
        .select('ri', 'pi', 'rn', 'ct', 'lt', 'et', 'acpi')
        .where('ty', 1)
        .where('ri', '>', after)
        .orderBy('ri', 'asc')
        .limit(limit + 1);          // 한 줄 더 읽어 more 를 판단한다

    facade.run(qb, connection, function (err, rows) {
        if (err) { return callback(err, rows); }
        rows = rows || [];
        var more = rows.length > limit;
        if (more) { rows = rows.slice(0, limit); }
        callback(null, {
            rows: rows,
            more: more,
            // **반환된 마지막 행**의 ri 다. 잘라낸 limit+1 번째를 쓰면 한 줄이 샌다.
            nextRi: rows.length ? rows[rows.length - 1].ri : null
        });
    });
};

/**
 * ACP 한 건의 상세 — lookup 행과 acp 본문을 함께 준다.
 *
 * @returns callback(null, {ri,rn,pi,ct,lt,et,pv,pvs,pv_parsed,pvs_parsed}) 또는 null
 */
exports.select_acp_detail = function (connection, ri, callback) {
    facade.run(facade.k('lookup').select('ri', 'pi', 'rn', 'ty', 'ct', 'lt', 'et', 'acpi').where({ ri: ri }),
        connection, function (err, lrows) {
            if (err) { return callback(err, lrows); }
            if (!lrows || lrows.length === 0) { return callback(null, null); }

            // ACP 가 아니면 그렇다고 말한다. 예전에는 ty 를 안 봐서, 컨테이너
            // 경로를 넣으면 acp 행이 없다는 이유로 body_missing:true 가 나갔다 —
            // 화면이 "본문이 없는 깨진 ACP" 로 그린다. 없는 문제를 만들어 낸다.
            if (String(lrows[0].ty) !== '1') {
                var notAcp = lrows[0];
                notAcp.is_acp = false;
                notAcp.pv = null;
                notAcp.pvs = null;
                notAcp.pv_parsed = null;
                notAcp.pvs_parsed = null;
                notAcp.body_missing = false;
                return callback(null, notAcp);
            }

            facade.run(facade.k('acp').select('ri', 'pv', 'pvs').where({ ri: ri }), connection,
                function (err2, arows) {
                    if (err2) { return callback(err2, arows); }
                    var a = (arows && arows[0]) ? arows[0] : { pv: null, pvs: null };
                    var out = lrows[0];
                    out.is_acp = true;
                    out.pv = a.pv;
                    out.pvs = a.pvs;
                    out.pv_parsed = safe_json(a.pv);
                    out.pvs_parsed = safe_json(a.pvs);
                    // acp 행이 없으면 lookup 에만 남은 반쪽이다. 평가에서는
                    // "참조한 ACP 를 못 찾음" 으로 취급돼 잠금이 조용히 풀린다.
                    out.body_missing = !arows || arows.length === 0;
                    callback(null, out);
                });
        });
};

function safe_json(s) {
    if (s === null || s === undefined) { return null; }
    if (typeof s === 'object') { return s; }
    try { return JSON.parse(s); }
    catch (e) { return null; }
}

// 전역을 이름으로 바로 읽으면 없을 때 ReferenceError 로 **동기 throw** 한다 —
// 콜백으로도 안 나오고 함수가 통째로 죽는다. 관리 콘솔은 app.js 를 require 하지
// 않으므로 usespid 가 실제로 없다(app.js 에서만 세운다). 값이 **틀린** 경우가
// 더 나쁘다: 절대 표기를 못 접어서 "참조 없음" 으로 잘못 보고하고, 그러면
// ACP 삭제 영향 분석이 조용히 빗나간다. 그래서 읽을 때마다 안전하게 본다.
function g(name) {
    return (typeof global[name] === 'string') ? global[name] : '';
}

// acpi 원소를 make_internal_ri 와 같은 규칙으로 접는다. 스캔 중에는 DB 를 더
// 부르지 않는다 — 3만 행에 한 건씩 질의하면 N+1 이 된다.
function fold_acpi_entry(v) {
    if (typeof v !== 'string') { return null; }
    var spid = g('usespid');
    var cseid = g('usecseid');
    var cb = g('usecsebase');

    if (cseid !== '') {
        if (spid !== '' && v.indexOf(spid + cseid + '/') === 0) {
            return v.replace(spid + cseid + '/', '/');
        }
        if (cb !== '' && v.indexOf(cseid + '/' + cb + '/') === 0) {
            return v.replace(cseid + '/', '/');
        }
    }
    if (cb !== '' && v.indexOf(cb) === 0) { return '/' + v; }
    return v;
}

/**
 * 표기를 접는 데 필요한 전역이 서 있는가.
 *
 * 없으면 절대·SP상대 표기를 못 접어 역참조가 조용히 어긋난다. 죽지는 않지만
 * 결과가 틀리므로, 부르는 쪽(관리 콘솔 등)이 확인할 수 있게 내보낸다.
 */
/**
 * 주어진 ri 들 중 **acpi 가 채워진 것만** 돌려준다.
 *
 * discovery 필터가 조상의 잠금을 확인할 때 쓴다. ri 가 PK 라 등치 IN 이고,
 * 대부분의 요청에서 빈 결과가 온다(배포에 acpi 가 채워진 리소스는 2개다).
 * 목록은 **행 수가 아니라 서로 다른 조상 수**라 페이지가 커도 잘 안 는다 —
 * CIN 2,000건이 한 컨테이너 아래면 조상은 하나다.
 */
exports.select_lookup_acpi_in = function (connection, ri_list, callback) {
    if (!ri_list || ri_list.length === 0) { return callback(null, []); }
    facade.run(facade.k('lookup').select('ri', 'acpi')
        .whereIn('ri', ri_list)
        .whereNot('acpi', '')
        .whereNot('acpi', '[]'),
        connection, callback);
};

// acpi 목록을 내부 ri 표기로 접는다. 실제 판정 경로(make_internal_ri)와 같은
// 규칙이되 전역에 의존하지 않는다 — 관리 콘솔은 app.js 를 require 하지 않는다.
exports.fold_acpi_list = function (list) {
    return (list || []).map(function (v) {
        var f = fold_acpi_entry(v);
        return f === null ? v : f;
    });
};

exports.acp_ri_context = function () {
    var missing = ['usecsebase', 'usecseid', 'usespid'].filter(function (n) { return g(n) === ''; });
    return { ok: missing.length === 0, missing: missing,
             usecsebase: g('usecsebase'), usecseid: g('usecseid'), usespid: g('usespid') };
};

// 이어보기 커서. 타입과 ri 를 **하나로 묶는다.**
//
// 예전에는 nextTy 와 nextRi 를 따로 돌려줬는데, 호출부가 ri 만 넘기면 타입이
// 0 으로 돌아가 **같은 자리를 무한히 다시 훑었다** — 결과가 틀린 것이 아니라
// 루프가 닫히지 않았다(콘솔에서 패스 201 에서 강제 중단으로 실측).
// 쪼갤 수 있는 커서를 주면 언젠가 쪼개진다. 그래서 안 쪼개지게 만든다.
function make_scan_cursor(ty, ri) {
    return String(ty) + '|' + String(ri);
}

function parse_scan_cursor(v) {
    if (typeof v !== 'string' || v === '') { return null; }
    var at = v.indexOf('|');
    if (at < 0) { return null; }
    var ty = Number(v.slice(0, at));
    if (!isFinite(ty)) { return null; }
    return { ty: ty, ri: v.slice(at + 1) };
}

exports._make_scan_cursor = make_scan_cursor;
exports._parse_scan_cursor = parse_scan_cursor;

/**
 * 어떤 리소스가 이 ACP 를 쓰는가 — 풀스캔 없이.
 *
 * ACP 를 지우면 그것을 참조하던 리소스는 "생성자만 통과" 로 조용히 풀린다.
 * 삭제 전 영향 분석을 할 수단이 지금까지 없었다.
 *
 * @param opts { acpRi=null(전부), tys=null, batch, scanCap, maxRefs, after }
 *        after 는 앞선 호출의 result.next 를 **그대로** 넘긴다. 쪼개지 말 것.
 * @returns callback(null, { refs, refsTruncated, byAcp, scanned, capped,
 *                           broken, unresolved, next })
 *          next 는 capped 일 때만 값이 있다. 없으면 다 훑은 것이다.
 */
exports.scan_acpi_refs = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};

    // 쪼갠 커서를 넘기면 조용히 처음부터 다시 훑는 대신 분명히 거부한다.
    if (o.afterRi !== undefined || o.afterTy !== undefined) {
        return callback(true, { code: 'BAD_CURSOR',
            message: 'afterRi / afterTy 는 더 쓰지 않는다. result.next 를 after 로 그대로 넘긴다' });
    }
    var cursor = null;
    if (o.after !== undefined && o.after !== null && o.after !== '') {
        cursor = parse_scan_cursor(o.after);
        if (cursor === null) {
            return callback(true, { code: 'BAD_CURSOR', message: '이어보기 커서를 읽을 수 없다: ' + o.after });
        }
    }

    var target = o.acpRi ? fold_acpi_entry(o.acpRi) : null;
    var batch = Math.min(Math.max(parseInt(o.batch, 10) || ACP_SCAN_BATCH, 1), 10000);
    var cap = parseInt(o.scanCap, 10) || ACP_SCAN_CAP;
    var maxRefs = parseInt(o.maxRefs, 10) || ACP_REFS_MAX;

    var refs = [];
    var byAcp = {};
    var unresolved = {};
    var scanned = 0;
    var broken = 0;
    var truncated = false;

    // **타입마다 등치로 훑는다.** not_cin 술어를 그냥 쓰면 인덱스를 하나도
    // 못 탄다 — idx_lookup_pi_notcin 은 선행 컬럼이 pi 라 not_cin 단독 조건에
    // 쓸 수 없고, PK 는 (pi, ri, ty) 라 ri 범위에도 못 쓴다. 배포에서 EXPLAIN 을
    // 재 봤다: `where not_cin = 1 and ri > ''` 는 ri_UNIQUE 범위 스캔으로
    // **3,097만 행** 추정이다. 사실상 전수 순회다.
    //
    // ty 등치는 idx_lookup_ty 를 탄다(ref, rows=1). CIN(ty=4)만 빼면 남는 것이
    // 34,313 행이므로, 타입 목록을 돌며 각각 키셋으로 훑는 편이 훨씬 싸다.
    // discovery 재귀 CTE 에서 배운 것과 같다 — MySQL 은 ty 등치만 인덱스를 탄다.
    var ty_list = (Array.isArray(o.tys) && o.tys.length > 0)
        ? o.tys.map(Number).filter(function (t) { return t !== 4; })
        : non_cin_ty_list();
    var ty_at = 0;

    function scan(after) {
        if (ty_at >= ty_list.length) { return done(null); }

        var qb = facade.k('lookup')
            .select('ri', 'ty', 'pi', 'rn', 'acpi')
            .where('ty', ty_list[ty_at])
            .where('ri', '>', after)
            .orderBy('ri', 'asc')
            .limit(batch);

        facade.run(qb, connection, function (err, rows) {
            if (err) { return callback(err, rows); }
            rows = rows || [];
            if (rows.length === 0) {
                // 이 타입은 끝났다. 다음 타입을 처음부터.
                ty_at++;
                return setImmediate(scan, '');
            }

            var next = rows[rows.length - 1].ri;
            for (var i = 0; i < rows.length; i++) {
                scanned++;
                var raw = rows[i].acpi;
                if (raw === null || raw === undefined || raw === '' || raw === '[]') { continue; }

                var list = safe_json(raw);
                if (!Array.isArray(list)) { broken++; continue; }

                var folded = [];
                var hit = (target === null);
                for (var j = 0; j < list.length; j++) {
                    var f = fold_acpi_entry(list[j]);
                    if (f === null) { broken++; continue; }
                    if (f.charAt(0) !== '/') { unresolved[f] = 1; }
                    folded.push(f);
                    if (target !== null && f === target) { hit = true; }
                }
                if (!hit || folded.length === 0) { continue; }

                for (var k = 0; k < folded.length; k++) {
                    byAcp[folded[k]] = (byAcp[folded[k]] || 0) + 1;
                }
                if (refs.length < maxRefs) {
                    refs.push({ ri: rows[i].ri, ty: rows[i].ty, rn: rows[i].rn, pi: rows[i].pi,
                                acpi: folded, raw: String(raw),
                                normalized: JSON.stringify(folded) === String(raw) });
                }
                else {
                    truncated = true;
                }
            }

            if (scanned >= cap) { return done(next, true); }
            setImmediate(scan, next);
        });
    }

    function done(next, capped) {
        callback(null, {
            refs: refs,
            refsTruncated: truncated,
            byAcp: byAcp,
            scanned: scanned,
            capped: !!capped,
            broken: broken,
            unresolved: Object.keys(unresolved),
            // 타입과 ri 를 하나로 묶어서 준다. 쪼갤 수 있게 두면 언젠가
            // 쪼개지고, 그러면 같은 자리를 무한히 다시 훑는다.
            next: (capped && ty_list[ty_at] !== undefined)
                ? make_scan_cursor(ty_list[ty_at], next) : null
        });
    }

    if (cursor === null) {
        scan('');
        return;
    }
    var at = ty_list.indexOf(cursor.ty);
    if (at < 0) {
        // 커서가 가리키는 타입이 목록에 없다(tys 를 바꿨거나 타입이 사라졌다).
        // 조용히 처음부터 다시 훑으면 호출부의 이어보기 루프가 안 닫힌다.
        return callback(true, { code: 'BAD_CURSOR',
            message: '커서의 타입 ' + cursor.ty + ' 가 이번 스캔 대상에 없다' });
    }
    ty_at = at;
    scan(cursor.ri);
};

/**
 * sri 표기로 적힌 acpi 원소를 내부 ri 로 푼다. scan_acpi_refs 의 unresolved 용.
 */
exports.resolve_acpi_entries = function (connection, entries, callback) {
    var list = (entries || []).filter(function (e) { return typeof e === 'string'; });
    if (list.length === 0) { return callback(null, { map: {} }); }

    facade.run(facade.k('lookup').select('ri', 'sri').whereIn('sri', list), connection,
        function (err, rows) {
            if (err) { return callback(err, rows); }
            var bySri = {};
            (rows || []).forEach(function (r) { bySri[r.sri] = r.ri; });
            var map = {};
            list.forEach(function (e) { map[e] = bySri[e] || null; });
            callback(null, { map: map });
        });
};

/**
 * 그룹의 macp 참조. fanOutPoint 는 acpi 가 아니라 grp.macp 로 판정하므로,
 * ACP 삭제 전 참조 확인이 여기를 빠뜨리면 그룹 팬아웃이 조용히 잠긴다.
 * macp 는 mediumtext 라 acpi 의 7개 한계가 적용되지 않는다.
 */
exports.scan_macp_refs = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var target = (opts && opts.acpRi) ? fold_acpi_entry(opts.acpRi) : null;

    facade.run(facade.k('grp').select('ri', 'macp'), connection, function (err, rows) {
        if (err) { return callback(err, rows); }
        var refs = [];
        var byAcp = {};
        var broken = 0;

        (rows || []).forEach(function (r) {
            var list = safe_json(r.macp);
            if (!Array.isArray(list)) {
                if (r.macp !== null && r.macp !== undefined && r.macp !== '') { broken++; }
                return;
            }
            var folded = [];
            var hit = (target === null);
            list.forEach(function (v) {
                var f = fold_acpi_entry(v);
                if (f === null) { broken++; return; }
                folded.push(f);
                if (target !== null && f === target) { hit = true; }
            });
            if (!hit || folded.length === 0) { return; }
            folded.forEach(function (f) { byAcp[f] = (byAcp[f] || 0) + 1; });
            refs.push({ ri: r.ri, macp: folded });
        });

        callback(null, { refs: refs, byAcp: byAcp, broken: broken });
    });
};

// ── ACP 변경 이력 ─────────────────────────────────────────────────────
//
// acp 테이블에는 cr 컬럼이 없어 ACP 를 누가 만들었는지 어디에도 남지 않고,
// acpi 를 바꾸면 옛 값이 사라진다. 삭제와 달리 "목록을 다시 조회하면 드러난다"
// 가 성립하지 않아 되돌릴 근거가 없다.
//
// 쓰기는 best-effort 다. 이력 저장이 실패해도 본 요청을 실패시키지 않는다 —
// 감사 때문에 운영이 멈추면 감사부터 꺼진다.

var AUDIT_LIST_MAX = 200;

/**
 * @param entry { op, ri, ty, origin, cr, before, after }
 *        op 는 'acpi_set' | 'acp_create' | 'acp_update' | 'acp_delete'
 */
exports.insert_acp_audit = function (connection, entry, callback) {
    var cb = callback || function () {};
    if (global.acp_audit === 'off') { return cb(null); }

    var e = entry || {};
    var row;
    try {
        row = {
            ts: moment().utc().format('YYYYMMDDTHHmmss'),
            op: String(e.op || ''),
            ri: String(e.ri || ''),
            ty: parseInt(e.ty, 10) || 0,
            origin: e.origin === undefined ? null : String(e.origin),
            cr: e.cr === undefined || e.cr === null ? null : String(e.cr),
            before_val: e.before === undefined ? null : JSON.stringify(e.before),
            after_val: e.after === undefined ? null : JSON.stringify(e.after)
        };
    }
    catch (ex) {
        console.error('[acp_audit] 항목을 만들 수 없다: ' + (ex.message || ex));
        return cb(null);
    }

    facade.run(facade.k('acp_audit').insert(row), connection, function (err, res) {
        if (err) {
            // 마이그레이션 007 전이면 테이블이 없다. 그래도 요청은 정상 처리한다.
            console.error('[acp_audit] 이력을 남기지 못했다 (' + row.op + ' ' + row.ri + '): ' +
                ((res && res.message) || ''));
        }
        cb(null);
    });
};

/**
 * @param opts { ri=null, op=null, limit=50(상한 200), afterId=null }
 * @returns callback(null, { rows, more, nextId })
 */
exports.select_acp_audit = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};
    var limit = Math.min(Math.max(parseInt(o.limit, 10) || 50, 1), AUDIT_LIST_MAX);

    var qb = facade.k('acp_audit')
        .select('id', 'ts', 'op', 'ri', 'ty', 'origin', 'cr', 'before_val', 'after_val')
        .orderBy('id', 'desc')
        .limit(limit + 1);
    if (o.ri) { qb = qb.where({ ri: o.ri }); }
    if (o.op) { qb = qb.where({ op: o.op }); }
    // 최신순이므로 커서는 "이 id 보다 작은 것" 이다.
    if (o.afterId) { qb = qb.where('id', '<', o.afterId); }

    facade.run(qb, connection, function (err, rows) {
        if (err) { return callback(err, rows); }
        rows = rows || [];
        var more = rows.length > limit;
        if (more) { rows = rows.slice(0, limit); }
        rows.forEach(function (r) {
            r.before = safe_json(r.before_val);
            r.after = safe_json(r.after_val);
            if (r.before === null && r.before_val !== null) { r.before = r.before_val; }
            if (r.after === null && r.after_val !== null) { r.after = r.after_val; }
        });
        callback(null, {
            rows: rows,
            more: more,
            nextId: rows.length ? rows[rows.length - 1].id : null
        });
    });
};

/**
 * 오래된 이력을 지운다. **자동으로 돌지 않는다** — 관리자가 부른다.
 * @param opts { beforeTs, limit=1000 }
 */
exports.prune_acp_audit = function (connection, opts, callback) {
    var o = opts || {};
    if (!o.beforeTs) {
        return callback(true, { message: 'beforeTs 가 필요하다 — 전체 삭제를 실수로 부르지 않게 한다' });
    }
    var limit = Math.min(Math.max(parseInt(o.limit, 10) || 1000, 1), 100000);
    facade.run(facade.k('acp_audit').where('ts', '<', o.beforeTs).limit(limit).del(),
        connection, function (err, res) {
            if (err) { return callback(err, res); }
            callback(null, { deleted: (res && res.affectedRows) || 0 });
        });
};

/**
 * 고아 행이 몇 개인지 센다. 아무것도 바꾸지 않는다.
 *
 * delete_orphan_lookup 은 lookup 전체를 훑고 여러 패스를 돌아 비싸다. 지우기
 * 전에 "정말 지울 것이 있는가" 를 먼저 볼 수 있어야 관리자가 판단할 수 있다.
 * 만료 스윕의 select_expired_resources 와 같은 역할이다.
 *
 * 세는 것도 전수 스캔이라 공짜는 아니다. 다만 삭제와 달리 한 패스로 끝나고
 * 아무것도 바꾸지 않는다.
 *
 * @param {number} limit  이 수를 넘으면 세기를 멈추고 그 값을 돌려준다.
 *                        "많다" 는 것만 알면 되는데 끝까지 세느라 오래 걸릴
 *                        이유가 없다. 0 이나 미지정이면 끝까지 센다.
 * @returns callback(err, { count, capped }) — capped 면 실제로는 더 많다
 */
exports.count_orphan_lookup = function (connection, limit, callback) {
    if (typeof limit === 'function') { callback = limit; limit = 0; }
    var BATCH = 5000;
    var total = 0;

    function scan(last_ri) {
        var qb = facade.k('lookup')
            .select('ri', 'pi')
            .where('ri', '>', last_ri)
            .whereNot('pi', '')          // CSEBase 는 pi 가 빈 문자열이라 제외
            .orderBy('ri', 'asc')
            .limit(BATCH);

        facade.run(qb, connection, function (err, rows) {
            if (err) { return callback(err, rows); }
            rows = rows || [];
            if (!rows.length) { return callback(null, { count: total, capped: false }); }

            var next_ri = rows[rows.length - 1].ri;
            var pi_set = {};
            for (var i = 0; i < rows.length; i++) { pi_set[rows[i].pi] = 1; }

            facade.run(facade.k('lookup').select('ri').whereIn('ri', Object.keys(pi_set)), connection,
                function (err2, prows) {
                    if (err2) { return callback(err2, prows); }
                    var exists = {};
                    prows = prows || [];
                    for (var j = 0; j < prows.length; j++) { exists[prows[j].ri] = 1; }
                    for (var k = 0; k < rows.length; k++) {
                        if (!exists[rows[k].pi]) { total++; }
                    }
                    if (limit > 0 && total >= limit) {
                        return callback(null, { count: total, capped: true });
                    }
                    setImmediate(scan, next_ri);
                });
        });
    }

    scan('');
};

// **자동 실행하지 않는다** — app.js 에 주기 등록이 없다.
// 관리자가 count_orphan_lookup 으로 확인한 뒤 호출하는 용도다.
// 비용은 app.js 의 "고아 행 정리는 자동으로 돌리지 않는다" 주석 참고.
exports.delete_orphan_lookup = function (connection, callback) {
    var BATCH = 5000;
    var grand_total = 0;

    function run_pass(pass_deleted, last_ri, pass_done) {
        // CSEBase 는 pi 가 빈 문자열이다 — 고아가 아니므로 뺀다.
        var scan = facade.k('lookup')
            .select('ri', 'pi')
            .where('ri', '>', last_ri)
            .whereNot('pi', '')
            .orderBy('ri', 'asc')
            .limit(BATCH);

        facade.run(scan, connection, function (err, rows) {
            if (err) {
                console.error('[delete_orphan_lookup] scan error:', rows);
                callback(rows);
                return;
            }
            rows = rows || [];
            if (!rows.length) {
                pass_done(pass_deleted);
                return;
            }
            var next_ri = rows[rows.length - 1].ri;
            var pi_set = {};
            for (var i = 0; i < rows.length; i++) { pi_set[rows[i].pi] = 1; }
            var pi_list = Object.keys(pi_set);

            facade.run(facade.k('lookup').select('ri').whereIn('ri', pi_list), connection,
                function (err2, prows) {
                    if (err2) {
                        console.error('[delete_orphan_lookup] parent check error:', prows);
                        callback(prows);
                        return;
                    }
                    prows = prows || [];
                    var exists = {};
                    for (var j = 0; j < prows.length; j++) { exists[prows[j].ri] = 1; }
                    var orphans = rows.filter(function (r) { return !exists[r.pi]; })
                        .map(function (r) { return r.ri; });
                    if (!orphans.length) {
                        setImmediate(run_pass, pass_deleted, next_ri, pass_done);
                        return;
                    }
                    facade.run(facade.k('lookup').whereIn('ri', orphans).del(), connection,
                        function (err3, dres) {
                            if (err3) {
                                console.error('[delete_orphan_lookup] delete error:', dres);
                                callback(dres);
                                return;
                            }
                            // 파사드가 두 백엔드 모두 affectedRows 로 맞춰 준다
                            // (예전에는 SQLite 의 changes 를 따로 봐야 했다).
                            var n = (dres && dres.affectedRows) || 0;
                            grand_total += n;
                            console.log('[delete_orphan_lookup] deleted ' + n + ' orphan row(s)');
                            setImmediate(run_pass, pass_deleted + n, next_ri, pass_done);
                        });
                });
        });
    }

    (function next_pass() {
        run_pass(0, '', function (deleted_in_pass) {
            if (deleted_in_pass > 0) {
                next_pass();
            }
            else {
                if (grand_total > 0) console.log('[delete_orphan_lookup] done, total ' + grand_total + ' row(s)');
                callback(null);
            }
        });
    })();
};


// req(ty=17) 관련 질의는 전부 걷어냈다 — insert_req / update_req / delete_req.
//
// req 는 논블로킹 요청의 임시 기록이었는데, 논블로킹을 지원하지 않게 되면서
// 만드는 경로가 사라졌다. 기존 배포에 남은 행과 테이블은
// migrations/003-drop-req-table.js 가 한 번에 정리한다.

exports.select_sum_cbs = function (connection, callback) {
    var tid = require('shortid').generate();
    console.time('select_sum_cbs ' + tid);
    // 집계 컬럼 이름(sum(cbs))이 응답에 그대로 나가므로 빌더 대신 raw 로 SQL 을 유지한다.
    facade.run(facade.raw('select sum(cbs) from cnt'), connection, function (err, result_Obj) {
        console.timeEnd('select_sum_cbs ' + tid);
        callback(err, result_Obj);
    });
};

exports.select_sum_ae = function (connection, callback) {
    var tid = require('shortid').generate();
    console.time('select_sum_ae ' + tid);
    // 집계 컬럼 이름(count(*))이 응답에 그대로 나가므로 빌더 대신 raw 로 SQL 을 유지한다.
    facade.run(facade.raw('select count(*) from ae'), connection, function (err, result_Obj) {
        console.timeEnd('select_sum_ae ' + tid);
        callback(err, result_Obj);
    });
};

/* ─── 구독 도달성 감사 ────────────────────────────────────────────────
 *
 * "구독은 잔뜩 있는데 받을 놈이 사라진" 상태를 찾는다. 읽기만 한다.
 *
 * 알림 경로(sgn.js)는 이 판정을 이미 매번 하고 있다 — 다만 로그로만 남기고
 * 버린다. 그리고 알림이 실제로 발생해야(= 부모에 CIN 이 들어와야) 드러난다.
 * 여기서는 같은 판정을 **전송 시도 없이, 오프라인으로** 재현한다.
 * 그래서 관리 UI 가 알림을 기다리지 않고 목록을 만들 수 있다.
 *
 * ── 하지 않는 것
 *
 * et 가 과거인 구독을 "보낼 수 없는 구독" 으로 분류하지 않는다.
 * et 는 이 코드의 런타임 어디에서도 강제되지 않는다 — 만료 스윕은 주기 실행이
 * 없고, 알림 경로에도 리소스 조회 경로에도 et 비교가 없다.
 * 즉 et 가 지난 구독의 대다수는 **지금 이 순간 정상적으로 알림을 보내고 있다.**
 * 배포 표본에서 et 의 약 81% 가 이미 과거이므로, 이것을 삭제 후보로 올리면
 * 목록이 통째로 오염된다. 만료는 select_expired_resources 가 따로 다룬다.
 *
 * ── 왜 subl 을 안 보는가
 *
 * 부모의 subl 사본은 신뢰할 수 없다. update_lookup 이 절대값으로 덮어쓰고
 * 호출부가 26곳이라, 구독을 동시에 만들면 조용히 사라진다(실측: 12개 중 11개).
 * 진실은 lookup(ty=23) + sub 이다.
 */

// 판정 사유. 관리 UI 가 그룹으로 묶어 보여 줄 수 있게 코드로 준다.
var SUB_AUDIT_REASON = {
    NO_SUB_ROW:    'no_sub_row',      // lookup 에는 ty=23 인데 sub 행이 없다
    NU_EMPTY:      'nu_empty',        // nu 가 비었거나 읽을 수 없다
    NU_UNRESOLVED: 'nu_unresolved',   // ID 형식인데 그 리소스가 없다 <- 받을 놈이 사라짐
    NU_NO_POA:     'nu_no_poa',       // 리소스는 있는데 보낼 주소가 없다
    NU_BAD_SCHEME: 'nu_bad_scheme',   // http/https/coap/ws/mqtt 가 아니다
    MQTT_TOPIC_UNREGISTERED: 'mqtt_topic_unregistered'  // 토픽의 AE-ID 가 등록돼 있지 않다
};
exports.SUB_AUDIT_REASON = SUB_AUDIT_REASON;

/**
 * 사유의 확신 등급.
 *
 *   broken   그 자체로 보낼 수 없다. 근거가 DB 안에서 닫힌다.
 *   suspect  못 보낼 가능성이 높지만 DB 만으로는 단정할 수 없다.
 *            **삭제 후보로 바로 올리면 안 된다.**
 *
 * 관리 UI 가 이 둘을 섞으면 멀쩡한 구독을 지우게 된다.
 */
var SUB_AUDIT_SEVERITY = {
    no_sub_row:               'broken',
    nu_empty:                 'broken',
    nu_unresolved:            'broken',
    nu_no_poa:                'broken',
    nu_bad_scheme:            'broken',
    // MQTT 토픽을 AE 로 등록하지 않고 듣기만 하는 클라이언트가 있을 수 있다.
    // 배포 표본에서 mobmon_* 같은 이름이 그렇게 보인다. 등록이 없다는 것은
    // 강한 신호지만 증거는 아니다 — MQTT 3.1.1 에는 구독자 존재를 발신자가
    // 알 방법이 없다.
    mqtt_topic_unregistered:  'suspect'
};
exports.SUB_AUDIT_SEVERITY = SUB_AUDIT_SEVERITY;

var SUB_AUDIT_BATCH = 500;
var SUB_AUDIT_CAP = 20000;
var SUB_AUDIT_MAX_FINDINGS = 2000;
var SUB_NU_SCHEMES = ['http:', 'https:', 'coap:', 'ws:', 'mqtt:'];

function parse_json_array(raw) {
    if (Array.isArray(raw)) { return raw; }
    if (raw === null || raw === undefined || raw === '') { return []; }
    try {
        var v = JSON.parse(raw);
        return Array.isArray(v) ? v : null;
    }
    catch (e) { return null; }
}

/**
 * 알림을 보낼 수 없는 구독을 찾는다. DB 쓰기 0.
 *
 * @param opts { batch, scanCap, maxFindings, after }
 *        after 는 앞선 호출의 result.next 를 **그대로** 넘긴다.
 * @returns callback(null, {
 *            findings: [{ ri, pi, nu, reason, detail }],
 *            findingsTruncated, scanned, capped, byReason, next })
 *          next 가 null 이면 다 훑은 것이다.
 */
exports.audit_subscriptions = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};

    var batch = Math.min(Math.max(parseInt(o.batch, 10) || SUB_AUDIT_BATCH, 1), 5000);
    var cap = parseInt(o.scanCap, 10) || SUB_AUDIT_CAP;
    var maxFindings = parseInt(o.maxFindings, 10) || SUB_AUDIT_MAX_FINDINGS;
    var after = (o.after === undefined || o.after === null) ? '' : String(o.after);

    // targets: 이 리소스들을 가리키는 구독만 보고한다.
    //
    // 관리 UI 가 AE 를 지우기 전에 "이걸 지우면 누구의 알림이 끊기는가" 를
    // 물을 때 쓴다. 지금 삭제 다이얼로그는 자손만 경고하고, 그 AE 를 nu 로
    // 가리키는 남의 구독은 말하지 않는다.
    //
    // 배포의 nu 는 100% URL 형식이라 ID 매칭만으로는 아무것도 안 잡힌다.
    // mqtt 토픽의 AE-ID(mqtt://host/<AE-ID>)까지 봐야 한다.
    var targets = null;
    if (Array.isArray(o.targets) && o.targets.length > 0) {
        targets = {};
        o.targets.forEach(function (t) {
            var s = String(t);
            targets[s] = true;
            // 구조화 경로로 줘도, ID 로 줘도 걸리게 한다.
            var tail = s.split('/').filter(Boolean).pop();
            if (tail) { targets[tail] = true; }
        });
    }

    // 이 발견이 targets 에 걸리는가. targets 가 없으면 전부 통과.
    function inTargets(hit) {
        if (targets === null) { return true; }
        for (var i = 0; i < hit.length; i++) {
            if (hit[i] && targets[hit[i]]) { return true; }
        }
        return false;
    }

    var findings = [];
    var byReason = {};
    var bySeverity = {};
    var scanned = 0;
    var truncated = false;

    // hit: 이 발견이 가리키는 대상 후보들(구조화 경로 / AE-ID 등).
    //      targets 필터가 이것으로 판정한다.
    function note(ri, pi, nu, reason, detail, hit) {
        if (!inTargets(hit || [])) { return; }
        var sev = SUB_AUDIT_SEVERITY[reason] || 'broken';
        byReason[reason] = (byReason[reason] || 0) + 1;
        bySeverity[sev] = (bySeverity[sev] || 0) + 1;
        if (findings.length >= maxFindings) { truncated = true; return; }
        findings.push({ ri: ri, pi: pi, nu: nu, reason: reason,
                        severity: sev, detail: detail || '' });
    }

    function done(next, capped) {
        callback(null, {
            findings: findings,
            findingsTruncated: truncated,
            scanned: scanned,
            capped: !!capped,
            byReason: byReason,
            // broken 과 suspect 를 갈라서 준다. 관리 UI 가 섞으면
            // 멀쩡한 구독을 지우게 된다.
            bySeverity: bySeverity,
            // 상한에 걸렸을 때만 이어보기 커서를 준다. 조용히 자르지 않는다.
            next: capped ? next : null
        });
    }

    // ID 형식 nu 를 절대 경로와 첫 조각으로 나눈다.
    //
    // sgn.js 의 get_nu_arr 과 **정확히 같은 방식**이라야 판정이 갈리지 않는다.
    // 해석은 두 단계다 — 첫 조각(sri)으로 그 리소스의 ri 를 찾고, 그것으로
    // 경로 앞부분을 치환한 뒤 전체 경로로 대상을 찾는다.
    // 한 단계만 하면 첫 조각(대개 CSEBase 이름)을 대상으로 착각한다.
    function split_id_nu(nu) {
        var s = String(nu);
        s = s.replace(usespid + usecseid + '/', '/');
        s = s.replace(usecseid + '/', '/');
        if (s.charAt(0) !== '/') { s = '/' + s; }
        var parts = s.split('/');
        return { abs: s, head: (parts[1] || '').split('?')[0] };
    }

    function classify(found, pending, next) {
        pending.forEach(function (p) {
            var target = found[p.target_path];
            if (!target) {
                // **여기가 "받을 놈이 사라진" 구독이다.**
                // AE 가 등록을 해제하면 그 AE 를 nu 로 가진 구독이 전부 여기 걸린다.
                note(p.ri, p.pi, p.nu, SUB_AUDIT_REASON.NU_UNRESOLVED, '대상: ' + p.target_path,
                     [p.target_path, p.head]);
                return;
            }
            if (!POA_TABLE[String(target.ty)]) {
                // AE/CSEBase/remoteCSE 가 아니면 poa 자체가 없는 타입이다.
                // 컨테이너를 nu 로 적어 둔 것 같은 설정 실수가 여기 걸린다.
                note(p.ri, p.pi, p.nu, SUB_AUDIT_REASON.NU_NO_POA,
                     '대상 ty=' + target.ty + ' 는 poa 를 갖지 않는다');
                return;
            }
            var poa = poa_util.parse(target.poa, '[audit] ' + target.ri);
            if (poa === null || poa.length === 0) {
                note(p.ri, p.pi, p.nu, SUB_AUDIT_REASON.NU_NO_POA, '대상: ' + target.ri,
                     [target.ri, target.sri]);
            }
        });
        next();
    }

    // mqtt nu 에서 sgn_man 이 토픽에 쓰는 AE-ID 를 뽑는다.
    //
    // sgn_man.request_noti_mqtt 와 **같은 방식**이라야 판정이 갈리지 않는다:
    //   var aeid = url.parse(nu).pathname.replace('/', '').split('?')[0];
    // 첫 슬래시 하나만 뗀다. 그래서 'UMACAIR/KETI_3D_LTE' 처럼 슬래시가 남는
    // 값도 그대로 AE-ID 자리에 들어간다 — 실제로 배포에 그런 값이 있다.
    function mqtt_topic_id(parsed) {
        if (!parsed.pathname) { return ''; }
        return parsed.pathname.replace('/', '').split('?')[0];
    }

    // 토픽의 AE-ID 들이 실제 등록된 AE 인지 한 번에 확인한다.
    function resolve_aeids(wantAei, pendingMqtt, next) {
        var keys = Object.keys(wantAei);
        if (keys.length === 0) { return next(); }

        // ae.aei 는 UNIQUE 인덱스가 있다(mobiusdb.sql 의 aei_UNIQUE).
        facade.run(facade.k('ae').select('aei').whereIn('aei', keys),
            connection, function (err, rows) {
                if (err) { return callback(true, rows); }

                var known = {};
                (rows || []).forEach(function (r) { known[r.aei] = true; });

                pendingMqtt.forEach(function (p) {
                    if (known[p.topic]) { return; }
                    note(p.ri, p.pi, p.nu, SUB_AUDIT_REASON.MQTT_TOPIC_UNREGISTERED,
                         '토픽 ' + p.topic + ' 로 등록된 AE 가 없다', [p.topic]);
                });
                next();
            });
    }

    // 대상을 두 단계로, 페이지 단위 배치로 확인한다.
    // 구독마다 따로 조회하면 구독 수만큼 왕복이 된다.
    //
    // poa 는 lookup 에 없다. 타입별 테이블(ae/cb/csr)에 있으므로
    // select_resource_from_url 과 같이 한 단계 더 읽는다.
    function resolve_targets(want, pending, next) {
        var heads = Object.keys(want);
        if (heads.length === 0) { return next(); }

        // 1단계: 첫 조각(sri)으로 그 리소스의 ri 를 찾는다.
        facade.run(facade.k('lookup').select('ri', 'sri').whereIn('sri', heads),
            connection, function (err, head_rows) {
                if (err) { return callback(true, head_rows); }

                var head_ri = {};
                (head_rows || []).forEach(function (r) { head_ri[r.sri] = r.ri; });

                // 2단계: 치환한 전체 경로로 대상을 찾는다.
                // 첫 조각을 못 찾으면 경로를 그대로 쓴다 — sgn.js 와 같다.
                var paths = {};
                pending.forEach(function (p) {
                    var hr = head_ri[p.head];
                    p.target_path = hr ? p.abs.replace('/' + p.head, hr) : p.abs;
                    p.target_path = p.target_path.split('?')[0];
                    paths[p.target_path] = true;
                });

                var keys = Object.keys(paths);
                if (keys.length === 0) { return next(); }

                facade.run(facade.k('lookup').select('ri', 'sri', 'ty').whereIn('ri', keys),
                    connection, function (err2, rows) {
                        if (err2) { return callback(true, rows); }

                        var found = {};
                        (rows || []).forEach(function (r) { found[r.ri] = r; });

                        // ri 로 못 찾으면 sri 로도 본다 —
                        // select_resource_from_url 이 둘 다 보기 때문이다.
                        var miss = keys.filter(function (k) { return !found[k]; });
                        if (miss.length === 0) { return fetch_poa(found, pending, next); }

                        facade.run(facade.k('lookup').select('ri', 'sri', 'ty').whereIn('sri', miss),
                            connection, function (err3, rows2) {
                                if (err3) { return callback(true, rows2); }
                                (rows2 || []).forEach(function (r) { found[r.sri] = r; });
                                fetch_poa(found, pending, next);
                            });
                    });
            });
    }

    // poa 를 가진 타입은 ae(2) / cb(5) / csr(16) 뿐이다.
    // 그 밖의 타입이 nu 대상이면 보낼 주소가 없는 것이다.
    var POA_TABLE = { '2': 'ae', '5': 'cb', '16': 'csr' };

    function fetch_poa(found, pending, next) {
        var byTable = {};
        Object.keys(found).forEach(function (k) {
            var t = POA_TABLE[String(found[k].ty)];
            if (!t) { return; }              // poa 가 없는 타입 — classify 가 처리한다
            if (!byTable[t]) { byTable[t] = []; }
            byTable[t].push(found[k].ri);
        });

        var tables = Object.keys(byTable);
        if (tables.length === 0) { return classify(found, pending, next); }

        var poa_by_ri = {};
        var at = 0;
        (function step() {
            if (at >= tables.length) {
                Object.keys(found).forEach(function (k) {
                    found[k].poa = poa_by_ri[found[k].ri];
                });
                return classify(found, pending, next);
            }
            var t = tables[at++];
            facade.run(facade.k(t).select('ri', 'poa').whereIn('ri', byTable[t]),
                connection, function (err, rows) {
                    if (err) { return callback(true, rows); }
                    (rows || []).forEach(function (r) { poa_by_ri[r.ri] = r.poa; });
                    step();
                });
        })();
    }

    function scan(cursor) {
        // ty 등치라 idx_lookup_ty 를 탄다. 선행 와일드카드 LIKE 나
        // 전역 COUNT(*) 는 5,740만 행에서 풀스캔이라 쓰지 않는다.
        var qb = facade.k('lookup')
            .select('ri', 'pi', 'rn', 'ct', 'lt', 'et')
            .where({ ty: 23 })
            .andWhere('ri', '>', cursor)
            .orderBy('ri', 'asc')
            .limit(batch);

        function advance(last_ri) {
            if (scanned >= cap) { return done(last_ri, true); }
            setImmediate(scan, last_ri);
        }

        facade.run(qb, connection, function (err, rows) {
            if (err) { return callback(true, rows); }
            if (!rows || rows.length === 0) { return done(null, false); }

            scanned += rows.length;
            // 커서는 **반환된 마지막 행**이다. 계산해서 만들면 한 칸씩 어긋난다.
            var last = rows[rows.length - 1].ri;
            var ri_list = rows.map(function (r) { return r.ri; });
            var by_ri = {};
            rows.forEach(function (r) { by_ri[r.ri] = r; });

            // sub 는 PK 가 ri 라 whereIn 이 인덱스를 탄다.
            facade.run(facade.k('sub').select('ri', 'nu').whereIn('ri', ri_list),
                connection, function (err2, subs) {
                    if (err2) { return callback(true, subs); }

                    var have = {};
                    (subs || []).forEach(function (s) { have[s.ri] = s; });

                    // 이 페이지에서 확인해야 할 것을 모은다.
                    // 구독마다 따로 조회하면 구독 수만큼 왕복이 된다.
                    var want = {};          // ID 형식 nu 의 첫 조각
                    var pending = [];
                    var wantAei = {};       // mqtt 토픽의 AE-ID
                    var pendingMqtt = [];

                    ri_list.forEach(function (ri) {
                        var row = by_ri[ri];
                        var s = have[ri];
                        if (!s) {
                            // FK ON DELETE CASCADE 라 정상적으로는 생기지 않는다.
                            // 생겼다면 그 자체가 보고할 일이다.
                            note(ri, row.pi, '', SUB_AUDIT_REASON.NO_SUB_ROW, 'sub 행이 없다');
                            return;
                        }
                        var nu_arr = parse_json_array(s.nu);
                        if (nu_arr === null) {
                            note(ri, row.pi, String(s.nu), SUB_AUDIT_REASON.NU_EMPTY, 'nu 를 읽을 수 없다');
                            return;
                        }
                        if (nu_arr.length === 0) {
                            note(ri, row.pi, '', SUB_AUDIT_REASON.NU_EMPTY, 'nu 가 비어 있다');
                            return;
                        }
                        nu_arr.forEach(function (nu) {
                            var parsed = url.parse(String(nu));
                            if (parsed.protocol === null) {
                                // ID 형식이다. 대상 리소스를 확인해야 한다.
                                var split = split_id_nu(nu);
                                if (split.head === '') {
                                    note(ri, row.pi, nu, SUB_AUDIT_REASON.NU_EMPTY, 'nu 형식을 읽을 수 없다');
                                    return;
                                }
                                want[split.head] = true;
                                pending.push({ ri: ri, pi: row.pi, nu: nu,
                                               head: split.head, abs: split.abs });
                                return;
                            }
                            if (parsed.protocol === 'mqtt:') {
                                // MQTT 는 발송 결과로 판정할 수 없다 — QoS0 라
                                // 브로커 도달조차 모르고, MQTT 3.1.1 에 구독자
                                // 존재를 발신자에게 알릴 수단이 없다.
                                //
                                // 대신 DB 로 한 가지는 볼 수 있다. sgn_man 은
                                // nu 의 경로 첫 조각을 AE-ID 로 삼아
                                // /oneM2M/req/<cseid>/<AE-ID>/<bodytype> 로 publish 한다.
                                // 그 AE-ID 가 등록돼 있지 않으면 아무도 안 들을
                                // 가능성이 높다.
                                //
                                // **단정은 아니다.** AE 로 등록하지 않고 토픽만
                                // 듣는 클라이언트가 있을 수 있어 suspect 로 둔다.
                                // 배포 실측: 3,452건 중 1,028건(29.8%)이 여기 걸리고,
                                // mobmon_* 같은 이름은 모니터링 도구로 보인다.
                                var topic = mqtt_topic_id(parsed);
                                if (topic === '') {
                                    note(ri, row.pi, nu, SUB_AUDIT_REASON.NU_EMPTY,
                                         'mqtt nu 에 토픽이 없다');
                                    return;
                                }
                                wantAei[topic] = true;
                                pendingMqtt.push({ ri: ri, pi: row.pi, nu: nu, topic: topic });
                                return;
                            }
                            if (SUB_NU_SCHEMES.indexOf(parsed.protocol) < 0) {
                                note(ri, row.pi, nu, SUB_AUDIT_REASON.NU_BAD_SCHEME, parsed.protocol);
                            }
                            // URL 형식은 여기서 도달성을 알 수 없다.
                            // 그건 알림 결과 신호([noti] 로그)가 답한다.
                        });
                    });

                    // ID 형식 확인 -> mqtt 토픽 확인 -> 다음 페이지
                    function afterIds() {
                        if (pendingMqtt.length === 0) { return advance(last); }
                        resolve_aeids(wantAei, pendingMqtt, function () { advance(last); });
                    }
                    if (pending.length === 0) { return afterIds(); }
                    resolve_targets(want, pending, afterIds);
                });
        });
    }

    scan(after);
};
