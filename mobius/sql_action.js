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

    var sql = util.format('select * from hit where ct > \'' + until + '\' limit 1000');

    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, null, function (err, results) {
            callback(err, results);
        });
    }
    else {
        db.getResult(sql, connection, function (err, results) {
            callback(err, results);
        });
    }
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

    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        // SQLite UPSERT syntax (requires SQLite 3.24+) or INSERT OR REPLACE
        // Simple INSERT OR REPLACE avoids ON DUPLICATE KEY UPDATE complexity for now if row exists
        // But for counters we want to increment.
        // SQLite standard UPSERT: INSERT INTO ... ON CONFLICT(ct) DO UPDATE SET http=http+excluded.http ...
        var sql = util.format('INSERT INTO hit (ct, http, mqtt, coap, ws) VALUES (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\') ON CONFLICT(ct) DO UPDATE SET http=http+%s, mqtt=mqtt+%s, coap=coap+%s, ws=ws+%s;',
            _ct, _http, _mqtt, _coap, _ws, _http, _mqtt, _coap, _ws);

        sqlite.getResult(sql, null, function (err, results) {
            callback(err, results);
        });
    }
    else {
        var sql = util.format('INSERT INTO hit (ct, http, mqtt, coap, ws) VALUES (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\') ON DUPLICATE KEY UPDATE http=http+%s, mqtt=mqtt+%s, coap=coap+%s, ws=ws+%s;',
            _ct, _http, _mqtt, _coap, _ws, _http, _mqtt, _coap, _ws);

        db.getResult(sql, connection, function (err, results) {
            callback(err, results);
        });
    }
};

exports.set_hit_n = function (connection, _ct, _http, _mqtt, _coap, _ws, callback) {
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');

        var sql = util.format('INSERT INTO hit (ct, http, mqtt, coap, ws) VALUES (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\') ON CONFLICT(ct) DO UPDATE SET http=http+%s, mqtt=mqtt+%s, coap=coap+%s, ws=ws+%s;',
            _ct, _http, _mqtt, _coap, _ws, _http, _mqtt, _coap, _ws);

        sqlite.getResult(sql, null, function (err, results) {
            callback(err, results);
        });
    }
    else {
        var sql = util.format('INSERT INTO hit (ct, http, mqtt, coap, ws) VALUES (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\') ON DUPLICATE KEY UPDATE http=http+%s, mqtt=mqtt+%s, coap=coap+%s, ws=ws+%s;',
            _ct, _http, _mqtt, _coap, _ws, _http, _mqtt, _coap, _ws);

        db.getResult(sql, connection, function (err, results) {
            callback(err, results);
        });
    }
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

exports.insert_lookup = function (connection, obj, callback) {
    //console.time('insert_lookup ' + obj.ri);
    if (global.usesqlite === 'true') {
        var pre_sql_executor = function (callback) {
            if (obj.acpi && obj.acpi.length > 0) {
                var acpi_list = obj.acpi;
                var acp_in_sql = "'" + acpi_list.join("','") + "'";
                var acp_sql = "SELECT pv FROM acp WHERE ri IN (" + acp_in_sql + ")";
                var sqlite = require('./db_sqlite');
                sqlite.getResult(acp_sql, connection, function (err, rows) {
                    if (!err && rows.length > 0) {
                        var acpl_arr = [];
                        for (var i = 0; i < rows.length; i++) {
                            try {
                                acpl_arr.push(JSON.parse(rows[i].pv));
                            } catch (e) {
                                acpl_arr.push(rows[i].pv);
                            }
                        }
                        obj.acpl = acpl_arr;
                    }
                    callback();
                });
            } else {
                callback();
            }
        };

        pre_sql_executor(function () {
            var sql = util.format('insert into lookup (' +
                'pi, ri, ty, ct, st, rn, lt, et, acpi, lbl, at, aa, sri, spi, subl, acpl) ' +
                'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.pi, obj.ri, obj.ty, obj.ct, obj.st, obj.rn, obj.lt, obj.et, JSON.stringify(obj.acpi || []).replace(/'/g, "''"), JSON.stringify(obj.lbl || [], null, 4).replace(/'/g, "''"), JSON.stringify(obj.at || []).replace(/'/g, "''"), JSON.stringify(obj.aa || []).replace(/'/g, "''"), obj.sri, obj.spi, JSON.stringify(obj.subl || []).replace(/'/g, "''"), (obj.acpl ? JSON.stringify(obj.acpl || []).replace(/'/g, "''") : ''));

            var sqlite = require('./db_sqlite');
            sqlite.getResult(sql, null, function (err, results) {
                callback(err, results);
            });
        });
    }
    else {
        var sql = util.format('insert into lookup (' +
            'pi, ri, ty, ct, st, rn, lt, et, acpi, lbl, at, aa, sri, spi, subl) ' +
            'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
            obj.pi, obj.ri, obj.ty, obj.ct, obj.st, obj.rn, obj.lt, obj.et, JSON.stringify(obj.acpi).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), JSON.stringify(obj.lbl, null, 4).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), JSON.stringify(obj.at).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), JSON.stringify(obj.aa).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.sri, obj.spi, JSON.stringify(obj.subl).replace(/\"/g, '\\"').replace(/\'/g, '\\\''));

        db.getResult(sql, connection, function (err, results) {
            if (!err) {
                // set_sri_sri(connection, obj.ri, obj.sri, function (err, results) {
                //     //console.timeEnd('insert_lookup ' + obj.ri);
                //     callback(err, results);
                // });
                callback(err, results);
            }
            else {
                callback(err, results);
            }
        });
    }
};

exports.insert_cb = function (connection, obj, callback) {
    console.time('insert_cb ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            if (global.usesqlite === 'true') {
                var sql = util.format('insert into cb (' +
                    'ri, cst, csi, srt, poa, nl, ncp, srv) ' +
                    'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.cst, obj.csi, JSON.stringify(obj.srt).replace(/'/g, "''"), JSON.stringify(obj.poa).replace(/'/g, "''"), obj.nl, obj.ncp, JSON.stringify(obj.srv).replace(/'/g, "''"));

                sqlite.getResult(sql, null, function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_cb ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                        sqlite.getResult(sql, null, function () {
                            callback(err, results);
                        });
                    }
                });
            }
            else {
                var sql = util.format('insert into cb (' +
                    'ri, cst, csi, srt, poa, nl, ncp, srv) ' +
                    'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.cst, obj.csi, JSON.stringify(obj.srt).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), JSON.stringify(obj.poa).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.nl, obj.ncp, JSON.stringify(obj.srv).replace(/\"/g, '\\"').replace(/\'/g, '\\\''));

                db.getResult(sql, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_cb ' + obj.ri);
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
            if (global.usesqlite === 'true') {
                var sql = util.format('insert into ae (ri, apn, api, aei, poa, "or", nl, rr, csz, srv) ' +
                    'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.apn, obj.api, obj.aei, JSON.stringify(obj.poa).replace(/'/g, "''"), obj.or, obj.nl, obj.rr, obj.csz, JSON.stringify(obj.srv).replace(/'/g, "''"));

                sqlite.getResult(sql, null, function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_ae ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                        sqlite.getResult(sql, null, function () {
                            console.timeEnd('insert_ae ' + obj.ri);
                            callback(err, results);
                        });
                    }
                });
            }
            else {
                var sql = util.format('insert into ae (ri, apn, api, aei, poa, ae.or, nl, rr, csz, srv) ' +
                    'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.apn, obj.api, obj.aei, JSON.stringify(obj.poa).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.or, obj.nl, obj.rr, obj.csz, JSON.stringify(obj.srv).replace(/\"/g, '\\"').replace(/\'/g, '\\\''));

                db.getResult(sql, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_ae ' + obj.ri);
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
            if (global.usesqlite === 'true') {
                var sql = util.format('insert into cnt (ri, cr, mni, mbs, mia, cni, cbs, li, "or", disr) ' +
                    'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.cr, obj.mni, obj.mbs, obj.mia, obj.cni, obj.cbs, obj.li, obj.or, obj.disr);
                var sqlite = require('./db_sqlite');
                // console.log('[DEBUG-SQLite] insert_cnt query:', sql); 
                sqlite.getResult(sql, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_cnt ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        console.error('[DEBUG-SQLite] insert_cnt error:', results); // Log 'results' which contains the error object
                        sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                        sqlite.getResult(sql, connection, function () {
                            console.timeEnd('insert_cnt ' + obj.ri);
                            callback(err, results);
                        });
                    }
                });
            }
            else {
                var sql = util.format('insert into cnt (ri, cr, mni, mbs, mia, cni, cbs, li, cnt.or, disr) ' +
                    'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.cr, obj.mni, obj.mbs, obj.mia, obj.cni, obj.cbs, obj.li, obj.or, obj.disr);
                db.getResult(sql, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_cnt ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                        db.getResult(sql, connection, function () {
                            console.timeEnd('insert_cnt ' + obj.ri);
                            callback(err, results);
                        });
                    }
                });
            }
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
            delete_oldest(connection, obj, count, function (err) {
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

            if (global.usesqlite === 'true') {
                var sql = util.format('insert into cin (ri, pi, cr, cnf, cs, "or", con) ' +
                    'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.pi, obj.cr, obj.cnf, obj.cs, obj.or, (con_type == 'string') ? obj.con.replace(/'/g, "''") : JSON.stringify(obj.con).replace(/'/g, "''"));
                var sqlite = require('./db_sqlite');
                sqlite.getResult(sql, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd(cin_id);
                        callback(err, results);
                    }
                    else {
                        console.error('[DEBUG-SQLite] insert_cin error:', results);
                        sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                        sqlite.getResult(sql, connection, function () {
                            callback(err, results);
                        });
                    }
                });
            }
            else {
                var sql = util.format('insert into cin (ri, pi, cr, cnf, cs, cin.or, con) ' +
                    'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.pi, obj.cr, obj.cnf, obj.cs, obj.or, (con_type == 'string') ? obj.con.replace(/'/g, "\\'") : JSON.stringify(obj.con).replace(/\"/g, '\\"').replace(/\'/g, '\\\''));
                db.getResult(sql, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd(cin_id);
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

exports.insert_req = function (connection, obj, callback) {
    console.time('insert_req ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into req (ri, op, tg, org, rid, mi, pc, rs, ors) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.op, obj.tg, obj.org, obj.rid, obj.mi, obj.pc, obj.rs, obj.ors);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_req ' + obj.ri);
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
            if (global.usesqlite === 'true') {
                var sqlite = require('./db_sqlite');
                var sql = util.format('insert into sub (ri, pi, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su) ' +
                    'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.pi, JSON.stringify(obj.enc).replace(/'/g, "''"), obj.exc, JSON.stringify(obj.nu).replace(/'/g, "''"), obj.gpi, obj.nfu, JSON.stringify(obj.bn).replace(/'/g, "''"), obj.rl, obj.psn, obj.pn, obj.nsp, obj.ln, obj.nct, obj.nec, obj.cr, obj.su);
                sqlite.getResult(sql, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_sub ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                        sqlite.getResult(sql, connection, function () {
                            callback(err, results);
                        });
                    }
                });
            }
            else {
                var sql = util.format('insert into sub (ri, pi, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su) ' +
                    'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.pi, JSON.stringify(obj.enc).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.exc, JSON.stringify(obj.nu).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.gpi, obj.nfu, JSON.stringify(obj.bn).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.rl, obj.psn, obj.pn, obj.nsp, obj.ln, obj.nct, obj.nec, obj.cr, obj.su);
                db.getResult(sql, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_sub ' + obj.ri);
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

exports.insert_tr = function (connection, obj, callback) {
    console.time('insert_tr ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into tr (ri, cr, tid, tctl, tst, tltm, text, tct, tltp, trqp, trsp) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cr, obj.tid, obj.tctl, obj.tst, obj.tltm, obj.text, obj.tct, obj.tltp, JSON.stringify(obj.trqp), JSON.stringify(obj.trsp).replace(/\"/g, '\\"').replace(/\'/g, '\\\''));
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_tr ' + obj.ri);
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

exports.insert_tm = function (connection, obj, callback) {
    console.time('insert_tm ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql = util.format('insert into tm (ri, tltm, text, tct, tept, tmd, tltp, tctl, tst, tmr, tmh, rqps, rsps, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.tltm, obj.text, obj.tct, obj.tept, obj.tmd, obj.tltp, obj.tctl, obj.tst, obj.tmr, obj.tmh, JSON.stringify(obj.rqps).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), JSON.stringify(obj.rsps).replace(/\"/g, '\\"').replace(/\'/g, '\\\''), obj.cr);
            db.getResult(sql, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('insert_tm ' + obj.ri);
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

exports.select_resource_from_url = function (connection, ri, sri, callback) {
    var sql = util.format('select * from lookup where (ri = \'%s\') or (sri = \'%s\')', ri, sri);

    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
        sqlite.getResult(sql, null, function (err, comm_Obj) {
            if (!err) {
                // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
                if (comm_Obj.length == 0) {
                    callback(err, comm_Obj);
                }
                else {
                    var sql = "select * from " + responder.typeRsrc[comm_Obj[0].ty] + " where ri = \'" + comm_Obj[0].ri + "\'";
                    // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
                    sqlite.getResult(sql, null, function (err, spec_Obj) {
                        var resource_Obj = [];
                        if (spec_Obj.length > 0) {
                            // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
                            resource_Obj.push(merge(comm_Obj[0], spec_Obj[0]));
                        } else {
                            // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
                            resource_Obj.push(comm_Obj[0]);
                        }
                        // console.log("[DEBUG-SQLite] select_resource_from_url merged result:", resource_Obj);

                        comm_Obj = [];
                        spec_Obj = [];
                        comm_Obj = null;
                        spec_Obj = null;
                        callback(err, resource_Obj);
                    });
                }
            }
            else {
                callback(err, comm_Obj);
            }
        });
    }
    else {
        // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
        db.getResult(sql, connection, function (err, comm_Obj) {
            if (!err) {
                // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
                if (comm_Obj.length == 0) {
                    callback(err, comm_Obj);
                }
                else {
                    var sql = "select * from " + responder.typeRsrc[comm_Obj[0].ty] + " where ri = \'" + comm_Obj[0].ri + "\'";
                    // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
                    db.getResult(sql, connection, function (err, spec_Obj) {
                        var resource_Obj = [];
                        // 요청당 SQL·결과 로그 - 로그 폭주 원인이라 비활성
                        resource_Obj.push(merge(comm_Obj[0], spec_Obj[0]));
                        comm_Obj = [];
                        spec_Obj = [];
                        comm_Obj = null;
                        spec_Obj = null;
                        callback(err, resource_Obj);
                    });
                }
            }
            else {
                console.error("[DEBUG-MySQL] select_resource_from_url error:", err);
                callback(err, comm_Obj);
            }
        });
    }
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
    var sql = util.format("select * from ae where ri = \'%s\'", ri);
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, null, function (err, results_ae) {
            callback(err, results_ae);
        });
    }
    else {
        db.getResult(sql, connection, function (err, results_ae) {
            callback(err, results_ae);
        });
    }
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
            //query_where += util.format(' lbl like \'%s\'', request.query.lbl);
        }
        else {
            for (var i = 0; i < query.lbl.length; i++) {
                query_where += util.format(' lbl like \'%%\"%%%s%%\"%%\'', query.lbl[i]);
                //query_where += util.format(' lbl like \'%s\'', request.query.lbl[i]);

                if (i < query.lbl.length - 1) {
                    query_where += ' or ';
                }
            }
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

    if (query.sza != null) {
        query_where += ' and ';
        query_where += util.format('%s <= cs', query.sza);
        query_count++;
    }

    if (query.szb != null) {
        query_where += ' and ';
        query_where += util.format('cs < %s', query.szb);
        query_count++;
    }

    if (query.rn != null) {
        query_where += ' and ';
        query_where += util.format('rn = \'%s\'', query.rn);
        query_count++;
    }

    if (query.cty != null) {
        query_where += ' and ';
        query_where += util.format('cnf = \'%s\'', query.cty);
        query_count++;
    }

    callback(query_where);
}
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

const max_parent_count = 2000;

function search_parents_lookup_action(connection, pi_list, count, cur_result_ri, result_ri, callback) {
    if (count >= pi_list.length) {
        callback('200');
        return;
    }

    var sql = util.format("select ri, ty from lookup where pi = \'" + pi_list[count] + "\' and ty <> \'1\' and ty <> \'9\' and ty <> \'23\' and ty <> \'4\' and ty <> \'17\' limit 2000");
    db.getResult(sql, connection, function (err, result_lookup_ri) {
        if (!err) {
            if (result_lookup_ri.length === 0) {
                search_parents_lookup_action(connection, pi_list, ++count, cur_result_ri, result_ri, (code) => {
                    callback(code);
                });
            }
            else {
                for (var idx in result_lookup_ri) {
                    if (result_lookup_ri.hasOwnProperty(idx)) {
                        cur_result_ri.push(result_lookup_ri[idx]);
                        if (cur_result_ri.length > max_parent_count) {
                            break;
                        }
                    }
                }

                result_lookup_ri = null;
                if (cur_result_ri.length > max_parent_count) {
                    callback('200');
                }
                else {
                    search_parents_lookup_action(connection, pi_list, ++count, cur_result_ri, result_ri, (code) => {
                        callback(code);
                    });
                }
            }
        }
        else {
            callback('500-1');
        }
    });
}

// 읽기(presearch) 경로: 레벨 단위 재귀 + 2000개 상한 (구버전 복원).
// 무제한 CTE는 초대형 lookup에서 루트 디스커버리가 분 단위로 걸리는 회귀가
// 있었다. 삭제/고아정리 등 전체 수집이 필요한 곳은 search_parents_lookup_all 사용.
exports.search_parents_lookup = function (connection, pi_list, cur_result_ri, result_ri, callback) {
    if (global.usesqlite === 'true') {
        return _this.search_parents_lookup_all(connection, pi_list, cur_result_ri, result_ri, callback);
    }

    cur_result_ri = [];
    search_parents_lookup_action(connection, pi_list, 0, cur_result_ri, result_ri, (code) => {
        if (code === '200') {
            if (cur_result_ri.length === 0) {
                callback(code);
            }
            else {
                var next_pi_list = [];
                for (var idx in cur_result_ri) {
                    if (cur_result_ri.hasOwnProperty(idx)) {
                        next_pi_list.push(cur_result_ri[idx].ri);
                        result_ri.push(cur_result_ri[idx]);
                    }
                }

                _this.search_parents_lookup(connection, next_pi_list, cur_result_ri, result_ri, function (code) {
                    callback(code);
                });
            }
        }
        else {
            callback(code);
        }
    });
};

// 하위(비-리프 타입) 자손 전체를 재귀 CTE 한 번으로 수집 (무상한).
// background subtree 삭제 전용 — 응답 경로에서 쓰면 대형 트리에서 분 단위가 걸린다.
exports.search_parents_lookup_all = function (connection, pi_list, cur_result_ri, result_ri, callback) {
    if (pi_list.length === 0) {
        callback('200');
        return;
    }

    var anchor_pi = pi_list.map(id => `'${id}'`).join(',');

    var sql = `
        WITH RECURSIVE hierarchy AS (
            SELECT ri, ty, pi FROM lookup WHERE pi IN (${anchor_pi}) AND ty <> '1' AND ty <> '9' AND ty <> '23' AND ty <> '4' AND ty <> '17'
            UNION ALL
            SELECT l.ri, l.ty, l.pi FROM lookup l JOIN hierarchy p ON l.pi = p.ri
            WHERE l.ty <> '1' AND l.ty <> '9' AND l.ty <> '23' AND l.ty <> '4' AND l.ty <> '17'
        )
        SELECT * FROM hierarchy
    `;

    var exec = (global.usesqlite === 'true') ? require('./db_sqlite').getResult : db.getResult;
    exec(sql, connection, function (err, rows) {
        if (!err) {
            for (var i = 0; i < rows.length; i++) {
                result_ri.push(rows[i]);
            }
            callback('200');
        } else {
            console.error('[search_parents_lookup] Error:', err);
            callback('500-1');
        }
    });
};


exports.select_spec_ri = function (connection, found_Obj, count, callback) {
    if (Object.keys(found_Obj).length <= count) {
        callback('200');
        return;
    }

    var ri = Object.keys(found_Obj)[count];
    var sql = "select * from " + responder.typeRsrc[found_Obj[ri].ty] + " where ri = \'" + ri + "\'";
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, connection, function (err, spec_Obj) {
            if (err) {
                callback('500-1');
            }
            else {
                if (spec_Obj.length >= 1) {
                    makeObject(spec_Obj[0]);
                    found_Obj[ri] = merge(found_Obj[ri], spec_Obj[0]);

                    _this.select_spec_ri(connection, found_Obj, ++count, function (code) {
                        callback(code);
                    });
                }
                else {
                    delete found_Obj[ri];
                    _this.select_spec_ri(connection, found_Obj, count, function (code) {
                        callback(code);
                    });
                }
            }
        });
    }
    else {
        db.getResult(sql, connection, function (err, spec_Obj) {
            if (err) {
                callback('500-1');
            }
            else {
                if (spec_Obj.length >= 1) {
                    makeObject(spec_Obj[0]);
                    found_Obj[ri] = merge(found_Obj[ri], spec_Obj[0]);

                    _this.select_spec_ri(connection, found_Obj, ++count, function (code) {
                        callback(code);
                    });
                }
                else {
                    delete found_Obj[ri];
                    _this.select_spec_ri(connection, found_Obj, count, function (code) {
                        callback(code);
                    });
                }
            }
        });
    }
};

function search_lookup_action(connection, pi_list, count, result_ri, query_where, callback) {
    if (count >= pi_list.length) {
        callback('200');
        return;
    }

    var sql = util.format("select * from lookup where pi = \'" + pi_list[count] + "\' " + query_where);
    db.getResult(sql, connection, function (err, result_lookup_ri) {
        if (!err) {
            if (result_lookup_ri.length === 0) {
                search_lookup_action(connection, pi_list, ++count, result_ri, query_where, function (code) {
                    callback(code);
                });
            }
            else {
                for (var idx in result_lookup_ri) {
                    if (result_lookup_ri.hasOwnProperty(idx)) {
                        result_ri.push(result_lookup_ri[idx]);
                        if (result_ri.length > max_search_count) {
                            break;
                        }
                    }
                }

                if (result_ri.length > max_search_count) {
                    callback('200');
                }
                else {
                    search_lookup_action(connection, pi_list, ++count, result_ri, query_where, function (code) {
                        callback(code);
                    });
                }
            }
        }
        else {
            callback('500-1');
        }
    });
}

function search_resource_action(connection, ri, query, cur_lim, pi_list, cni, loop_count, seekObj, callback) {
    if (loop_count >= 20) {
        callback('200');
        return;
    }

    var query_where = '';
    var query_count = 0;
    if (query.lbl != null) {
        query_where = ' and ';
        if (query.lbl.toString().split(',')[1] == null) {
            query_where += util.format(' lbl like \'[\"%%%s%%\"]\'', query.lbl);
            //query_where += util.format(' lbl like \'%s\'', request.query.lbl);
        }
        else {
            for (var i = 0; i < query.lbl.length; i++) {
                query_where += util.format(' lbl like \'%%\"%s\"%%\'', query.lbl[i]);
                //query_where += util.format(' lbl like \'%s\'', request.query.lbl[i]);

                if (i < query.lbl.length - 1) {
                    query_where += ' or ';
                }
            }
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

    if (query.sza != null) {
        query_where += ' and ';
        query_where += util.format('%s <= cs', query.sza);
        query_count++;
    }

    if (query.szb != null) {
        query_where += ' and ';
        query_where += util.format('cs < %s', query.szb);
        query_count++;
    }

    if (query.rn != null) {
        query_where += ' and ';
        query_where += util.format('rn = \'%s\'', query.rn);
        query_count++;
    }

    if (query.cty != null) {
        query_where += ' and ';
        query_where += util.format('cnf = \'%s\'', query.cty);
        query_count++;
    }

    if (query.la != null) {
        cur_lim = parseInt(query.la, 10);

        var before_ct = moment().subtract(Math.pow(2, loop_count * 1), 'minutes').utc().format('YYYYMMDDTHHmmss');

        query_where += ' and ';
        query_where += util.format(' (\'%s\' < ct) ', before_ct);
        query_count++;
    }
    else {
        query_where += ' limit ' + cur_lim;
        if (query.ofst != null) {
            query_where += util.format(' offset %s', query.ofst);
        }
    }

    var search_Obj = [];
    search_lookup_action(connection, pi_list, 0, search_Obj, query_where, function (code) {
        if (code === '200') {
            search_Obj = search_Obj.reverse();
            for (var i in search_Obj) {
                if (search_Obj.hasOwnProperty(i)) {
                    seekObj[search_Obj[i].ri] = search_Obj[i];
                    if (Object.keys(seekObj).length >= cur_lim) {
                        break;
                    }
                }
            }

            if (query.la != null) {
                if (Object.keys(seekObj).length >= cur_lim) {
                    callback(code);
                }
                else {
                    var foundCount = Object.keys(seekObj).length;
                    search_resource_action(connection, ri, query, parseInt(cur_lim, 10) - foundCount, pi_list, cni, ++loop_count, seekObj, function (code) {
                        callback(code);
                    });
                }
            }
            else {
                callback(code);
            }
        }
        else {
            callback(code);
        }
    });
}

exports.search_lookup_sqlite = function (connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, loop_cnt, callback) {
    // 1. Build Filter Clause
    build_search_query(query, function (query_where) {
        // 2. Construct CTE Query
        // Anchor: The root resource (ri)
        // Recursive: Children (pi = parent.ri)
        // Note: We exclude the root itself from result if typically desired, but discovery usually includes filtered results under root.
        // Mobius logic usually starts discovery *under* the target.
        // The original search_lookup starts with pi_list populated with the Target's RI.
        // So we are looking for children of Target.
        // We will start the anchor with children of the Target (pi = ri).

        var anchor_sql = util.format("select * from lookup where pi = '%s'", ri);

        // If we want the root included in search scope? usually discovery is "descendants".
        // existing search_lookup uses 'select * from lookup where pi = ...' so it searches children.

        var sql = `
            WITH RECURSIVE hierarchy AS (
                ${anchor_sql}
                UNION ALL
                SELECT l.* FROM lookup l JOIN hierarchy p ON l.pi = p.ri
            )
            SELECT * FROM hierarchy WHERE 1=1 ${query_where} 
        `;

        // Handle 'la' (Latest N) - implies ordering by creation time descending
        if (query.la != null) {
            // ct 는 초 단위라 동점이 흔하다. ri 로 가려야 최신 N건이 안정적이다.
            sql += ` ORDER BY ct DESC, ri DESC LIMIT ${query.la}`;
            if (query.ofst != null) {
                sql += ` OFFSET ${query.ofst}`;
            }
        }
        else {
            // Standard limit logic
            if (query.lim != null) {
                sql += ` LIMIT ${cur_lim}`;
            }
            else {
                sql += ` LIMIT 1000`; // Default safety limit
            }

            if (query.ofst != null) {
                sql += ` OFFSET ${query.ofst}`;
            }
        }

        var sqlite = require('./db_sqlite');
        // console.log('[DEBUG-S] Search SQL:', sql);
        sqlite.getResult(sql, connection, function (err, rows) {
            if (!err) {
                // console.log('[DEBUG-S] CTE Result Count:', rows.length);
                for (var i = 0; i < rows.length; i++) {
                    found_Obj[rows[i].ri] = rows[i];
                }
                callback('200');
            }
            else {
                console.error('[search_lookup_sqlite] CTE Error:', err);
                callback('500-1');
            }
        });
    });
};

exports.search_lookup = function (connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, loop_cnt, callback, search_tid) {
    sanitize_discovery_query(query); // SQL Injection 방어: 두 backend(MySQL/SQLite) 진입점에서 한 번만 정규화
    if (global.usesqlite === 'true') {
        return _this.search_lookup_sqlite(connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, loop_cnt, callback);
    }

    // 타이머 라벨을 모듈 전역이 아닌 호출 체인 지역으로 유지 (동시 검색 시 race로 'No such label' 경고 발생하던 문제)
    if (!search_tid) {
        search_tid = 'search_lookup (' + require('shortid').generate() + ')';
        console.time(search_tid);
    }

    if (pi_index >= pi_list.length) {
        console.timeEnd(search_tid);
        callback('200');
        return;
    }

    var cur_pi = [];

    for (var idx = 0; idx < 32; idx++) {
        if (pi_index < pi_list.length) {
            cur_pi.push(pi_list[pi_index++]);
        }
        else {
            break;
        }
    }

    var seekObj = {};
    search_resource_action(connection, ri, query, cur_lim, cur_pi, cni, 0, seekObj, function (code) {
        if (code === '200') {
            var search_Obj = [];
            for (var idx in seekObj) {
                if (seekObj.hasOwnProperty(idx)) {
                    search_Obj.push(seekObj[idx]);
                }
            }

            if (search_Obj.length > 0) {
                for (var i = 0; i < search_Obj.length; i++) {
                    found_Obj[search_Obj[i].ri] = search_Obj[i];
                    if (Object.keys(found_Obj).length >= query.lim) {
                        break;
                    }
                }

                if (Object.keys(found_Obj).length >= query.lim) {
                    console.timeEnd(search_tid);
                    callback('200');
                }
                else {
                    cur_lim = parseInt(query.lim) - Object.keys(found_Obj).length;
                    _this.search_lookup(connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, ++loop_cnt, function (code) {
                        callback(code);
                    }, search_tid);
                }
            }
            else {
                cur_lim = parseInt(query.lim) - Object.keys(found_Obj).length;
                _this.search_lookup(connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, ++loop_cnt, function (code) {
                    callback(code);
                }, search_tid);
            }
        }
        else {
            console.timeEnd(search_tid);
            callback(code);
        }
    });
};

exports.select_latest_resource = function (connection, parentObj, loop_count, latestObj, callback) {
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        // Optimized SQLite query: select top 1 ordered by ct desc
        // ct 는 초 단위라 같은 초에 만들어진 형제들 사이에서 순서를 못 가린다.
        // 실측(2026-08-28): CIN 22건에 서로 다른 ct 가 2개뿐이었고, la 가 진짜
        // 최신 대신 다른 건을 10회 모두 돌려줬다.
        // ri 를 타이브레이커로 쓴다 — 자동 생성 rn 은 폭이 고정이라 사전순이
        // 곧 생성순이다(mobius/rid.js). 클라이언트가 rn 을 직접 준 경우에는
        // 순서가 임의이지만, 그때도 ct 가 먼저 결정하므로 초 단위까지는 정확하다.
        var sql = 'select * from (select * from lookup where pi = \'' + parentObj.ri + '\' and ty = \'' + (parseInt(parentObj.ty, 10) + 1).toString() + '\' order by ct desc, ri desc limit 1)b join ' + responder.typeRsrc[parseInt(parentObj.ty, 10) + 1] + ' as a on b.ri = a.ri';

        sqlite.getResult(sql, connection, (err, results_latest) => {
            if (!err) {
                if (results_latest.length > 0) {
                    latestObj.push(results_latest[0]);
                }
                callback('200');
            }
            else {
                callback('500-1');
            }
        });
    }
    else {
        if (loop_count > 9) {
            callback('200');
            return;
        }

        var before_ct = moment().subtract(Math.pow(5, loop_count), 'minutes').utc().format('YYYYMMDDTHHmmss');
        var query_where = ' and ty = \'' + (parseInt(parentObj.ty, 10) + 1).toString() + '\' and ';
        // ct 를 먼저 본다. ri 만으로 정렬하면 클라이언트가 rn 을 직접 준 리소스가
        // 생성 시각과 무관한 자리에 온다.
        query_where += util.format(' (\'%s\' < ct) order by ct desc, ri desc limit 10', before_ct);

        var sql = 'select * from (select * from lookup where (pi = \'' + parentObj.ri + '\') ' + query_where + ')b join ' + responder.typeRsrc[parseInt(parentObj.ty, 10) + 1] + ' as a on b.ri = a.ri';
        db.getResult(sql, connection, (err, results_latest) => {
            if (!err) {
                if (results_latest.length > 0) {
                    // 바깥 JOIN 이 서브쿼리의 정렬을 보존한다는 보장이 없어
                    // 여기서 다시 고른다. 정렬 키는 SQL 과 같아야 한다 —
                    // ct 를 먼저 보고, 같으면 ri 로 가린다. 예전에는 ri 만 봐서
                    // 클라이언트가 rn 을 직접 준 리소스가 엉뚱하게 최신이 됐다.
                    let latest_obj = results_latest[0];
                    for (let i = 1; i < results_latest.length; i++) {
                        let c = results_latest[i];
                        if (c.ct > latest_obj.ct ||
                            (c.ct === latest_obj.ct && c.ri > latest_obj.ri)) {
                            latest_obj = c;
                        }
                    }
                    latestObj.push(latest_obj);
                    callback('200');
                }
                else {
                    _this.select_latest_resource(connection, parentObj, ++loop_count, latestObj, function (code) {
                        callback(code);
                    });
                }
            }
            else {
                callback('500-1');
            }
        });
    }
};

exports.select_oldest_resource = function (connection, ty, ri, oldestObj, callback) {
    console.time('select_oldest ' + ri);
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        // Optimized SQLite query: select bottom 1 ordered by ct asc
        // ct 는 초 단위라 동점이 흔하다. ri 로 가린다 (select_latest_resource 주석 참고).
        var sql = 'select * from (select * from lookup where pi = \'' + ri + '\' and ty = \'' + ty + '\' order by ct asc, ri asc limit 1)b join ' + responder.typeRsrc[parseInt(ty, 10)] + ' as a on b.ri = a.ri';

        sqlite.getResult(sql, connection, function (err, results_oldest) {
            console.timeEnd('select_oldest ' + ri);
            if (!err) {
                if (results_oldest.length >= 1) {
                    oldestObj.push(results_oldest[0]);
                }
                callback('200');
            }
            else {
                callback('500-1');
            }
        });
    }
    else {
        // 예전에는 ORDER BY 가 아예 없어 limit 1 이 임의의 행을 골랐다 —
        // "가장 오래된 것"이라는 의미가 성립하지 않았다.
        var sql = 'select * from (select * from lookup where pi = \'' + ri + '\' and ty = \'' + ty + '\' order by ct asc, ri asc limit 1)b join ' + responder.typeRsrc[parseInt(ty, 10)] + ' as a on b.ri = a.ri';
        db.getResult(sql, connection, function (err, results_oldest) {
            console.timeEnd('select_oldest ' + ri);
            if (!err) {
                if (results_oldest.length >= 1) {
                    oldestObj.push(results_oldest[0]);
                }
                callback('200');
            }
            else {
                callback('500-1');
            }
        });
    }
};

exports.select_lookup = function (connection, ri, callback) {
    //var tid = require('shortid').generate();
    //console.time('select_lookup ' + ri + ' (' + tid + ')');
    var sql = util.format("select * from lookup where ri = \'%s\'", ri);
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, connection, function (err, direct_Obj) {
            callback(err, direct_Obj);
        });
    }
    else {
        db.getResult(sql, connection, function (err, direct_Obj) {
            //console.timeEnd('select_lookup ' + ri + ' (' + tid + ')');
            callback(err, direct_Obj);
        });
    }
};

exports.select_ri_lookup = function (connection, ri, callback) {
    console.time('select_ri_lookup ' + ri);
    //var sql = util.format("select ri from lookup where ri = \'%s\'", ri);
    var sql = "select ri, sri from lookup where ri = \'" + ri + "\'";
    if (global.usesqlite === 'true') {
        sqlite.getResult(sql, null, function (err, ri_Obj) {
            console.timeEnd('select_ri_lookup ' + ri);
            callback(err, ri_Obj);
        });
    }
    else {
        db.getResult(sql, connection, function (err, ri_Obj) {
            console.timeEnd('select_ri_lookup ' + ri);
            callback(err, ri_Obj);
        });
    }
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
    var sql = util.format("select * from acp where ri = \'%s\'", ri);
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, connection, function (err, results_acp) {
            callback(err, results_acp);
        });
    }
    else {
        db.getResult(sql, connection, function (err, results_acp) {
            callback(err, results_acp);
        });
    }
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

    var sql = util.format("select acpi, ty from lookup where ri = \"%s\"", pi);
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, connection, function (err, results) {
            if (err) {
                callback(err, results.message);
            }
            else {
                if (results.length == 0) {
                    callback(err, results);
                }
                else {
                    try {
                        results[0].acpi = JSON.parse(results[0].acpi);
                    } catch (e) {
                        results[0].acpi = [];
                    }

                    if (results[0].acpi.length == 0) {
                        if (results[0].ty == '3') {
                            _this.select_acp_cnt(connection, ++loop, uri_arr, function (err, acpiList) {
                                if (err) {
                                    callback(err, acpiList);
                                }
                                else {
                                    callback(err, acpiList);
                                }
                            });
                        }
                        else {
                            callback(err, results[0].acpi);
                        }
                    }
                    else {
                        callback(err, results[0].acpi);
                    }
                }
            }
        });
    }
    else {
        db.getResult(sql, connection, function (err, results) {
            if (err) {
                callback(err, results.message);
            }
            else {
                if (results.length == 0) {
                    callback(err, results);
                }
                else {
                    results[0].acpi = JSON.parse(results[0].acpi);

                    if (results[0].acpi.length == 0) {
                        if (results[0].ty == '3') {
                            _this.select_acp_cnt(connection, ++loop, uri_arr, function (err, acpiList) {
                                if (err) {
                                    callback(err, acpiList);
                                }
                                else {
                                    callback(err, acpiList);
                                }
                            });
                        }
                        else {
                            callback(err, results[0].acpi);
                        }
                    }
                    else {
                        callback(err, results[0].acpi);
                    }
                }
            }
        });
    }
};

exports.select_acp_in = function (connection, acpiList, callback) {
    var sql = util.format("select * from acp where ri in (" + JSON.stringify(acpiList).replace('[', '').replace(']', '') + ")");
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, connection, function (err, results_acp) {
            callback(err, results_acp);
        });
    }
    else {
        db.getResult(sql, connection, function (err, results_acp) {
            callback(err, results_acp);
        });
    }
};

exports.select_sub = function (connection, pi, callback) {
    console.time('select_sub');
    var sql = util.format('select * from sub where pi = \'%s\'', pi);
    db.getResult(sql, connection, function (err, results_ss) {
        console.timeEnd('select_sub');
        callback(err, results_ss);
    });
};

exports.select_tr = function (connection, pi, callback) {
    var sql = util.format('select * from lookup where pi = \'%s\' and ty = \'39\'', pi);
    db.getResult(sql, connection, function (err, results_comm_tr) {
        if (!err) {
            if (results_comm_tr.length === 0) {
                callback(err, results_comm_tr);
            }
            else {
                var sql2 = util.format('select * from tr where ri = \'%s\'', results_comm_tr[0].ri);
                db.getResult(sql2, connection, function (err, results_tr) {
                    callback(err, results_tr);
                });
            }
        }
        else {
            callback(err, results_comm_tr);
        }
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
                callback(err, results);
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
                        // 다른 워커가 이미 정리 완료 → 커밋 후 종료
                        connection.commit(function () {
                            console.log('[delete_oldest] already clean (actual_cni=' + actual_cni + ' <= mni=' + mni + '), skip');
                            console.timeEnd(del_id);
                            callback(null);
                        });
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

                        // 자식(CIN)이 지워졌으니 부모 stateTag 도 올라가야 한다.
                        // CIN 생성(cnt_man)과 단건 삭제(update_parent_by_delete)는
                        // 이미 올리는데 보존 정책 purge 만 빠져 있었다.
                        // MySQL 은 다중 테이블 UPDATE 를 쓸 수 있어 왕복이 늘지 않는다
                        // (cnt_man.js 의 MySQL 경로와 같은 형태).
                        var update_sql = util.format(
                            "UPDATE cnt, lookup SET cnt.cni = cnt.cni - %s, cnt.cbs = cnt.cbs - %s, " +
                            "lookup.st = lookup.st + 1 WHERE cnt.ri = '%s' AND lookup.ri = '%s'",
                            total_cnt, total_cs, obj.ri, obj.ri);
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
                                    console.log('[delete_oldest] committed: deleted=' + (results ? results.affectedRows : 0));
                                    console.timeEnd(del_id);
                                    callback(commitErr);
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


exports.select_count_ri =function (connection, ty, ri, callback) {
    var sql = util.format('select lookup.st, count(*) as cnt, sum(cin.cs) as size FROM lookup, cin where lookup.ri = \'%s\' and cin.pi = \'%s\'', ri, ri);
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, connection, function (err, results) {
            callback(err, results);
        });
    }
    else {
        db.getResult(sql, connection, function (err, results) {
            callback(err, results);
        });
    }
};

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
            var sql2 = util.format('update ae set apn = \'%s\', poa = \'%s\', ae.or = \'%s\', rr = \'%s\' where ri = \'%s\'',
                obj.apn, JSON.stringify(obj.poa), obj.or, obj.rr, obj.ri);
            if (global.usesqlite === 'true') {
                var sql2_sqlite = util.format('update ae set apn = \'%s\', poa = \'%s\', "or" = \'%s\', rr = \'%s\' where ri = \'%s\'',
                    obj.apn, JSON.stringify(obj.poa), obj.or, obj.rr, obj.ri);
                var sqlite = require('./db_sqlite');
                sqlite.getResult(sql2_sqlite, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('update_ae ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        callback(err, results);
                    }
                });
            }
            else {
                db.getResult(sql2, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('update_ae ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        callback(err, results);
                    }
                });
            }
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
            var sql2 = util.format('update cnt set mni = \'%s\', mbs = \'%s\', mia = \'%s\', li = \'%s\', cnt.or = \'%s\', cni = \'%s\', cbs = \'%s\' where ri = \'%s\'',
                obj.mni, obj.mbs, obj.mia, obj.li, obj.or, obj.cni, obj.cbs, obj.ri);
            if (global.usesqlite === 'true') {
                var sql2_sqlite = util.format('update cnt set mni = \'%s\', mbs = \'%s\', mia = \'%s\', li = \'%s\', "or" = \'%s\', cni = \'%s\', cbs = \'%s\' where ri = \'%s\'',
                    obj.mni, obj.mbs, obj.mia, obj.li, obj.or, obj.cni, obj.cbs, obj.ri);
                var sqlite = require('./db_sqlite');
                sqlite.getResult(sql2_sqlite, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd(cnt_id);
                        callback(err, results);
                    } else {
                        callback(err, results);
                    }
                });
            } else {
                db.getResult(sql2, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd(cnt_id);
                        callback(err, results);
                    }
                    else {
                        callback(err, results);
                    }
                });
            }
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
            var sql2 = util.format('update grp set mnm = \'%s\', mid = \'%s\', macp = \'%s\', gn = \'%s\' where ri = \'%s\'',
                obj.mnm, JSON.stringify(obj.mid), JSON.stringify(obj.macp), obj.gn, obj.ri);
            if (global.usesqlite === 'true') {
                var sqlite = require('./db_sqlite');
                sqlite.getResult(sql2, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('update_grp ' + obj.ri);
                        callback(err, results);
                    } else {
                        callback(err, results);
                    }
                });
            } else {
                db.getResult(sql2, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('update_grp ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        callback(err, results);
                    }
                });
            }
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
            var sql2 = util.format('update lcp set lou = \'%s\', lon = \'%s\' where ri = \'%s\'',
                obj.lou, obj.lon, obj.ri);
            if (global.usesqlite === 'true') {
                var sqlite = require('./db_sqlite');
                sqlite.getResult(sql2, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('update_lcp ' + obj.ri);
                        callback(err, results);
                    } else {
                        callback(err, results);
                    }
                });
            } else {
                db.getResult(sql2, connection, function (err, results) {
                    if (!err) {
                        console.timeEnd('update_lcp ' + obj.ri);
                        callback(err, results);
                    }
                    else {
                        callback(err, results);
                    }
                });
            }
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
            var sql2 = util.format('update fcnt set fcnt.lock = \'%s\'', obj.lock);
            db.getResult(sql2, connection, function (err, results) {
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
            var sql2 = util.format('update fcnt set lvl = \'%s\'', obj.lvl);
            db.getResult(sql2, connection, function (err, results) {
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
            var sql2 = util.format('update fcnt set curT0 = \'%s\'', obj.curT0);
            db.getResult(sql2, connection, function (err, results) {
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
            var sql2 = util.format('update fcnt set powerSe = \'%s\'', obj.powerSe);
            db.getResult(sql2, connection, function (err, results) {
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
            var sql2 = util.format('update fcnt set sus = \'%s\'', obj.sus);
            db.getResult(sql2, connection, function (err, results) {
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
            var sql2 = util.format('update fcnt set colSn = \'%s\'', obj.colSn);
            db.getResult(sql2, connection, function (err, results) {
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
            var sql2 = util.format('update fcnt set brigs = \'%s\'', obj.brigs);
            db.getResult(sql2, connection, function (err, results) {
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
            var sql2 = util.format('update fcnt set red = \'%s\', green = \'%s\', blue = \'%s\'', obj.red, obj.green, obj.blue);
            db.getResult(sql2, connection, function (err, results) {
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

exports.update_req = function (connection, ri, pc, op, mi, rs, ors, callback) {
    console.time('update_req ' + ri);
    //var sql2 = util.format('update req set pc = \'%s\', rs = \'%s\' where ri = \'%s\'', (new Buffer(pc)).toString('base64'), rs, ri);
    var sql2 = util.format('update req set pc = \'%s\', op = \'%s\', mi = \'%s\', rs = \'%s\', ors = \'%s\' where ri = \'%s\'', pc, op, mi, rs, ors, ri);
    db.getResult(sql2, connection, function (err, results) {
        if (!err) {
            console.timeEnd('update_req ' + ri);
            callback(err, results);
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

exports.update_tm = function (connection, obj, callback) {
    console.time('update_tm ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update tm set cr = \'%s\', tctl = \'%s\', tst = \'%s\', tmr = \'%s\', tmh = \'%s\', rsps = \'%s\' where ri = \'%s\'',
                obj.cr, obj.tctl, obj.tst, obj.tmr, obj.tmh, JSON.stringify(obj.rsps), obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_tm ' + obj.ri);
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


exports.update_tr = function (connection, obj, callback) {
    console.time('update_tr ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update tr set cr = \'%s\', tctl = \'%s\', tst = \'%s\', trsp = \'%s\' where ri = \'%s\'',
                obj.cr, obj.tctl, obj.tst, JSON.stringify(obj.trsp), obj.ri);
            db.getResult(sql2, connection, function (err, results) {
                if (!err) {
                    console.timeEnd('update_tr ' + obj.ri);
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

exports.update_tr_trsp = function (connection, ri, tst, trsp, callback) {
    console.time('update_tr_trsp ' + ri);
    var sql2 = util.format('update tr set tst = \'%s\', trsp = \'%s\' where ri = \'%s\'', tst, trsp, ri);
    db.getResult(sql2, connection, function (err, results) {
        if (!err) {
            console.timeEnd('update_tr_trsp ' + ri);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_tr_tst = function (connection, ri, tst, callback) {
    console.time('update_tr_tst ' + ri);
    var sql2 = util.format('update tr set tst = \'%s\' where ri = \'%s\'', tst, ri);
    db.getResult(sql2, connection, function (err, results) {
        if (!err) {
            console.timeEnd('update_tr_tst ' + ri);
            callback(err, results);
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
exports.reconcile_cnt_counters = function (connection, limit, callback) {
    var rec_id = 'reconcile_cnt_counters - ' + require('shortid').generate();
    console.time(rec_id);

    var qb = facade.k('cnt')
        .select('cnt.ri', 'cnt.cni', 'cnt.cbs')
        .select(facade.raw(
            '(select count(*) from cin where cin.pi = cnt.ri) as real_cni'))
        .select(facade.raw(
            '(select coalesce(sum(cs), 0) from cin where cin.pi = cnt.ri) as real_cbs'))
        .limit(limit);

    facade.run(qb, connection, function (err, rows) {
        if (err) {
            console.timeEnd(rec_id);
            callback(err, rows);
            return;
        }

        rows = rows || [];
        var drifted = rows.filter(function (r) {
            return parseInt(r.cni, 10) !== parseInt(r.real_cni, 10) ||
                   parseInt(r.cbs, 10) !== parseInt(r.real_cbs, 10);
        });

        var idx = 0;
        var fixed = 0;

        (function next() {
            if (idx >= drifted.length) {
                console.timeEnd(rec_id);
                if (fixed > 0) {
                    console.log('[reconcile_cnt_counters] ' + rows.length + '건 확인, ' +
                                fixed + '건 교정');
                }
                callback(null, { checked: rows.length, fixed: fixed });
                return;
            }

            var r = drifted[idx++];
            console.log('[reconcile_cnt_counters] drift ri=' + r.ri +
                        ' cni ' + r.cni + '->' + r.real_cni +
                        ' cbs ' + r.cbs + '->' + r.real_cbs);

            _this.update_cnt_cni(connection, {
                ri: r.ri,
                cni: parseInt(r.real_cni, 10),
                cbs: parseInt(r.real_cbs, 10)
            }, function (uerr, ures) {
                if (uerr) {
                    console.error('[reconcile_cnt_counters] 교정 실패 ri=' + r.ri + ': ' +
                                  ((ures && (ures.driverCode || ures.code)) || ures));
                }
                else {
                    fixed++;
                }
                next();
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
    //console.time('delete_ri_lookup ' + ri);
    var sql = util.format("delete from lookup where ri = \'%s\'", ri);
    if (global.usesqlite === 'true') {
        console.log('[DEBUG-SQLite] delete_ri_lookup query:', sql);
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, null, function (err, delete_Obj) {
            console.log('[DEBUG-SQLite] delete_ri_lookup result:', err, delete_Obj);
            //console.timeEnd('delete_ri_lookup ' + ri);
            callback(err, delete_Obj);
        });
    }
    else {
        db.getResult(sql, connection, function (err, delete_Obj) {
            //console.timeEnd('delete_ri_lookup ' + ri);
            callback(err, delete_Obj);
        });
    }
};

exports.delete_ri_lookup_in = function (connection, ty, ri, offset, callback) {
    var sql = util.format("DELETE FROM lookup WHERE pi = \'%s\' and ty = \'%s\' LIMIT %d", ri, ty, offset);
    //console.log(sql);
    db.getResult(sql, connection, function (err, results) {
        callback(err, results);
    });
};

function delete_lookup_action(connection, pi_list, req_count, callback) {
    if (pi_list.length <= req_count) {
        callback('200');
        return;
    }

    var sql = 'delete from lookup where pi = \'' + pi_list[req_count] + '\'';
    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getResult(sql, connection, function (err, deleted_Obj) {
            if (!err) {
                console.log('deleted ' + (deleted_Obj.changes || deleted_Obj.affectedRows) + ' resource(s) of ' + pi_list[req_count]);
                delete_lookup_action(connection, pi_list, ++req_count, function (code) {
                    callback(code);
                });
            }
            else {
                callback('500-1');
            }
        });
    }
    else {
        db.getResult(sql, connection, function (err, deleted_Obj) {
            if (!err) {
                console.log('deleted ' + deleted_Obj.affectedRows + ' resource(s) of ' + pi_list[req_count]);
                delete_lookup_action(connection, pi_list, ++req_count, function (code) {
                    callback(code);
                });
            }
            else {
                callback('500-1');
            }
        });
    }
}

exports.delete_lookup = function (connection, pi_list, pi_index, found_Obj, found_Cnt, callback) {
    var cur_pi = [];

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


// 부모(pi)가 lookup에 없는 고아 행을 배치 단위로 반복 삭제.
// 비동기 subtree 삭제 중 프로세스가 죽었을 때의 잔여물 정리용.
// SELECT(무락 consistent read)로 1000건씩 모은 뒤 PK로 지워서
// 라이브 트래픽 중인 대형 테이블에서도 락 시간이 짧다.
// 다단계 고아(자식의 자식)는 다음 루프의 SELECT가 잡는다.
exports.delete_orphan_lookup = function (connection, callback) {
    var sel = "SELECT l.ri FROM lookup l LEFT JOIN lookup p ON l.pi = p.ri WHERE p.ri IS NULL AND l.pi <> '' LIMIT 1000";
    var exec = (global.usesqlite === 'true') ? require('./db_sqlite').getResult : db.getResult;
    exec(sel, connection, function (err, rows) {
        if (err) {
            console.error('[delete_orphan_lookup] select error:', rows);
            callback(rows);
            return;
        }
        if (rows.length === 0) {
            callback(null);
            return;
        }
        var in_list = rows.map(r => `'${r.ri}'`).join(',');
        exec("DELETE FROM lookup WHERE ri IN (" + in_list + ")", connection, function (err2, result) {
            if (err2) {
                console.error('[delete_orphan_lookup] delete error:', result);
                callback(result);
                return;
            }
            var n = (result.affectedRows || result.changes || 0);
            console.log('[delete_orphan_lookup] deleted ' + n + ' orphan row(s)');
            _this.delete_orphan_lookup(connection, callback);
        });
    });
};


exports.delete_req = function (connection, callback) {
    var sql = util.format("delete from lookup where ty = \'17\'");
    db.getResult(sql, connection, function (err, delete_Obj) {
        if (!err) {
            callback(err, delete_Obj);
        }
    });
};


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
