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

// var db = require('./db_action') 이 여기 있었다. 마지막 db.getResult 호출이
// 사라지면서(손으로 쓴 SQL 0개) 죽은 require 가 되어 지웠다. db_action.js 와
// db_sqlite.js 자체도 같은 커밋에서 없앴다 — 파사드 위에 아무것도 더하지
// 않는 껍데기였고, 유일하게 남아 있던 임대 장부는 파사드로 옮겼다.
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

// MAX_PURGE_ROUNDS 는 여기 있었다. get_cni_count 가 purge 후 재조회하며
// 재귀했기 때문에 필요한 상한이었는데, get_cni_count 가 순수 읽기가 되면서
// 그 재귀 자체가 없어졌다.

// 이번 패스에서 얼마나 지워야 하는지 계산한다.
//   need_cnt   개수 한도까지 지워야 할 건수
//   need_cs    용량 한도까지 지워야 할 바이트
//   candidates 조회할 후보 행 수. 용량 초과는 몇 건이 필요한지 미리 알 수 없어
//              상한만큼 가져온 뒤 호출부에서 누적하며 자른다.
//   est_count  실제 cs 를 볼 수 없는 경로용 평균 기반 추정 건수
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

// set_tuning 은 여기 있었다. MySQL 인스턴스의 **전역** 설정 네 개를
// 기동할 때마다 SET GLOBAL 로 바꾸는 함수였다:
//
//   max_connections = 2000
//   innodb_flush_log_at_trx_commit = 0        커밋 유실 1초 허용
//   sync_binlog = 0                           binlog fsync 안 함
//   transaction_isolation = READ-UNCOMMITTED  인스턴스 전체 더티 리드
//
// 애플리케이션이 할 일이 아니다. 배포 서버의 my.cnf 는
// innodb_flush_log_at_trx_commit = 1 / max_connections = 300 이라고 적어
// 두었는데 이 함수가 부팅마다 뒤집고 있었다 — 설정 파일과 도는 값이 달랐다.
//
// 값은 그대로 두고 자리만 옮겼다 (2026-09-01, 배포 서버에 SET PERSIST).
// 자세한 것은 app.js 의 호출부 자리 주석 참고.
//
// 파사드의 capabilities.serverTuning 은 이 함수 하나를 위한 것이었다.
// 어댑터 선언은 남겨 둔다 — 서버 파라미터를 바꿀 일이 또 생기면 같은
// 관문을 쓰면 되고, 지금 지우면 그 관문이 있었다는 사실이 사라진다.

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

// 컨테이너의 현재 cni/cbs/st 를 돌려준다. **읽기만 한다.**
//
// 예전에는 매번 cin 을 전부 세는 O(n) 집계를 돌렸다. 저장된 cnt.cni/cbs 를
// 못 믿었기 때문인데, 그 불신에는 근거가 있었다 — 감소 경로가 깨져 있어서
// CIN 을 지워도 cni 가 안 줄었다 (update_cnt_by_delete 의 cs 인자 누락, ea40cbc).
// 지금은 저장값을 유지하는 주체가 전부 증분이거나 실측 절대 대입이라 믿을 수 있고,
// 드리프트는 reconcile_cnt_counters 가 주기적으로 잡는다.
//
// **여기 있던 한도 정리(checkAndPurge -> delete_oldest)를 뺐다.**
//
// 이 함수의 유일한 호출부는 resource.js 의 update_action(ty=='3'), 즉 컨테이너
// PUT 이고 그것은 **워커 25개**가 처리한다. 그런데 한도 정리는 마스터의
// purge_sweep 이 맡기로 했고, 그 "정리 주체가 하나" 라는 전제 위에서
// delete_oldest 의 트랜잭션과 SELECT ... FOR UPDATE NOWAIT 를 걷어냈다.
// 즉 이 호출이 남아 있는 한 전제가 거짓이고, 잠금을 뺀 것이 위험해진다.
//
// 구체적으로: 마스터가 컨테이너를 한도까지 내려놓은 직후, 낡은 cni 를 들고
// 진입한 워커가 재확인 없이 다음 100건을 더 지운다. lookup 삭제는
// FK(cin_ri ON DELETE CASCADE)라 cin 본문까지 되돌릴 수 없이 사라진다.
//
// 정리를 여기서 빼면 한도 강제가 삽입/수정과 동기가 아니게 되지만, 그것은
// 이 설계가 이미 받아들인 것이다 — 스윕 주기(global.purge_sweep_ms) 안의
// 최종적 정리다. 요청 경로에서 최대 10라운드를 돌던 재귀도 함께 사라진다.
exports.get_cni_count = function (connection, obj, callback) {
    _this.select_cni_parent(connection, obj.ri, function (err, rows) {
        if (err || !rows || rows.length !== 1) {
            callback(0, 0, 0);
            return;
        }

        var r = rows[0];
        callback(
            parseInt(r.cni || 0, 10),
            parseInt(r.cbs || 0, 10),
            (r.st == null) ? 0 : parseInt(r.st, 10));
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

// ---------------------------------------------------------------------------
// 본문 테이블 하나짜리 리소스의 생성
//
// 스무 곳이 전부 같은 모양이었다:
//   lookup 에 넣는다 -> 본문 테이블에 넣는다 -> 본문이 실패하면 lookup 을 되돌린다.
//
// 다른 것은 **테이블 이름과 컬럼 목록뿐**이고, 스무 개 전부 **컬럼 이름이 곧
// obj 의 키**다(소스에서 값 순서를 뽑아 대조해 확인했다). 그래서 표로 적고
// 함수는 하나만 둔다. 새 리소스 타입은 표에 한 줄이다.
//
// 옮기기 전에는 스무 곳이 각자 util.format 으로 SQL 을 조립했다. 그 형태의
// 진짜 문제는 방언이 아니라 **값이 SQL 문자열 안으로 들어간다**는 것이었다 —
// JSON 컬럼마다 .replace(/"/g,'\\"').replace(/'/g,"\\'") 를 손으로 붙이고
// 있었고 하나만 빠져도 SQL Injection 이다(이 저장소에서 이미 3건 나왔다).
// 바인딩을 쓰면 그 이스케이프가 통째로 사라진다.
//
// 예약어도 사라진다. 예전에는 컬럼을 fcnt.lock / mgo.mod / smd.or 처럼
// 테이블로 한정해 예약어를 피했는데, 그건 MySQL 이 봐 주는 것이지 표준이
// 아니다. 빌더가 방언에 맞게 식별자를 인용한다.
//
//   [테이블, 컬럼(공백 구분), JSON 으로 저장할 컬럼]
var BODY_TABLES = {
    insert_grp:      ['grp',  'ri cr mt cnm mnm mid macp mtv csy gn', 'mid macp'],
    insert_lcp:      ['lcp',  'ri los lou lot lor loi lon lost'],
    insert_fcnt:     ['fcnt', 'ri cnd cr'],

    // hd_* 여덟은 전부 fcnt 테이블이고 가운데 컬럼 하나만 다르다.
    insert_hd_dooLK: ['fcnt', 'ri cnd lock cr'],
    insert_hd_bat:   ['fcnt', 'ri cnd lvl cr'],
    insert_hd_tempe: ['fcnt', 'ri cnd curT0 cr'],
    insert_hd_binSh: ['fcnt', 'ri cnd powerSe cr'],
    insert_hd_fauDn: ['fcnt', 'ri cnd sus cr'],
    insert_hd_colSn: ['fcnt', 'ri cnd colSn cr'],
    insert_hd_brigs: ['fcnt', 'ri cnd brigs cr'],
    insert_hd_color: ['fcnt', 'ri cnd red green blue cr'],

    // mgo 족.
    insert_fwr:      ['mgo',  'ri mgd objs obps dc vr fwnnam url ud uds', 'uds'],
    insert_bat:      ['mgo',  'ri mgd objs obps dc btl bts'],
    insert_dvi:      ['mgo',  'ri mgd objs obps dc dbl man mod dty fwv swv hwv'],
    insert_dvc:      ['mgo',  'ri mgd objs obps dc can att cas cus ena dis', 'cas'],
    insert_rbo:      ['mgo',  'ri mgd objs obps dc rbo far'],

    insert_nod:      ['nod',  'ri ni hcl mgca'],
    insert_csr:      ['csr',  'ri cst poa cb csi mei tri rr nl srv', 'poa srv'],
    insert_smd:      ['smd',  'ri cr dsp dcrp soe rels or', 'rels'],
    insert_mms:      ['mms',  'ri sid soid stid asd osd sst']
};

function make_body_insert(name, table, cols, json_cols) {
    return function (connection, obj, callback) {
        var label = name + ' ' + obj.ri;
        console.time(label);

        _this.insert_lookup(connection, obj, function (err, results) {
            if (err) {
                callback(err, results);
                return;
            }

            var row = {};
            cols.forEach(function (c) {
                // JSON 컬럼의 || [] 는 insert_ae / insert_cnt 와 같은 규약이다.
                // 예전 코드는 JSON.stringify(undefined) 에 .replace 를 걸어
                // TypeError 를 냈다 — DB 콜백 안이라 워커가 죽는 자리다.
                if (json_cols.indexOf(c) >= 0) {
                    row[c] = JSON.stringify(obj[c] || []);
                    return;
                }
                // **undefined 를 빈 문자열로 둔다.** 빌더는 undefined 를 NULL 로
                // 보내는데, 이 테이블들의 컬럼은 대부분 NOT NULL 이라 그대로
                // 실패한다. 실측: lcp 생성이 500 이 됐다 — loi/lost 는
                // create_np_attr_list 에 있어 클라이언트가 보낼 수 없고
                // build_lcp 도 채우지 않아 언제나 undefined 다.
                //
                // 옛 코드는 util.format('%s') 라 문자열 "undefined" 를 저장하며
                // 성공했다. 그 값을 그대로 재현하지는 않는다 — 빈 문자열이
                // 덜 나쁘고, "안 채운 속성" 이라는 뜻도 더 정확하다.
                //
                // null 도 같이 막는다. 클라이언트가 {"ni": null} 을 보내면
                // build_resource(resource.js)의 속성 검사는 "속성이 있다" 로
                // 세어 통과시키고, 그 null 이 그대로 NOT NULL 컬럼에 닿는다.
                // 옛 코드는 문자열 'null' 을 저장하며 201 을 줬다.
                //
                // 제대로 된 수정은 각 타입의 build_* 가 자기 속성을 채우는
                // 것이다(예: build_lcp 가 loi/lost 를 정한다). 그것은 값의
                // 의미를 정하는 일이라 이 전환의 범위가 아니다.
                row[c] = (obj[c] === undefined || obj[c] === null) ? '' : obj[c];
            });

            facade.run(facade.k(table).insert(row), connection, function (err2, results2) {
                if (!err2) {
                    console.timeEnd(label);
                    callback(err2, results2);
                    return;
                }

                // 본문 insert 가 실패하면 lookup 행이 고아로 남는다. 되돌린다.
                // 그 고아 행은 이후 discovery 를 깨뜨린다.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        console.timeEnd(label);
                        callback(err2, results2);
                    });
            });
        });
    };
}

Object.keys(BODY_TABLES).forEach(function (name) {
    var t = BODY_TABLES[name];
    exports[name] = make_body_insert(
        name, t[0], t[1].split(' '), (t[2] || '').split(' ').filter(Boolean));
});
// ---------------------------------------------------------------------------

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

// 등록된 원격 CSE 목록. update_route(app.js)가 fanOutPoint 와 그룹 생성마다 부른다.
//
// cb 는 usecsebase(설정값)라 지금은 안전하지만, LIKE 패턴에 문자열을 이어
// 붙이고 있었다. 바인딩으로 옮기면 그 질문 자체가 없어진다.
// 와일드카드는 값 쪽에 둔다 — 패턴 문자(%)는 바인딩된 값 안에서만 뜻을 갖는다.
//
// 여기 있던 `if (!Array.isArray(results_csr.poa)) results_csr.poa = []` 는 뺐다.
// results_csr 는 **행 배열**이라 그 .poa 는 언제나 undefined 였고, 배열 객체에
// 속성 하나를 붙인 뒤 아무도 읽지 않았다(호출부는 results_csr[i].poa 를 본다).
// 실패했을 때는 에러 객체에 .poa 를 붙이고 있었다.
exports.select_csr_like = function (connection, cb, callback) {
    facade.run(facade.k('csr').select('*').where('ri', 'like', '/' + cb + '/%'),
        connection, callback);
};

exports.select_csr = function (connection, ri, callback) {
    facade.run(facade.k('csr').select('*').where({ ri: ri }), connection, callback);
};

exports.select_ae = function (connection, ri, callback) {
    facade.run(facade.k('ae').select('*').where({ ri: ri }), connection, callback);
};

// --- discovery 파라미터 정규화 ---
//
// 원래는 SQL Injection 방어였다 (한국전자기술연구원 취약점 보고,
// Mobius <=2.5.15). 필터 값을 문자열 concat 으로 WHERE 에 넣고 있어서,
// 넣기 전에 값마다 SQL 리터럴 이스케이프를 걸었다.
//
// **그 이스케이프는 없앴다.** build_search_query 가 값을 이름 바인딩으로
// 넘기므로 값이 SQL 문자열에 들어가지 않는다. 이스케이프를 남겨 두면
// 이중으로 걸려 `it's` 를 찾는 요청이 `it''s` 를 찾게 된다.
// 이스케이프는 하나만 빠져도 뚫리고 방언마다 규칙이 다르다 — 바인딩이
// 그 문제를 통째로 없앤다.
//
// 숫자 검증은 남긴다. 그 값들은 바인딩이 아니라 여전히 SQL 에 직접 들어가거나
// (limit / offset / sk_lvl) 분기 판단에 쓰인다:
//   sza / szb   바인딩이지만 parseInt 로 수가 되어야 비교가 성립한다
//   la / ofst   limit / offset 리터럴
//   lvl         재귀 깊이 상한 리터럴
//   ty          requested_ty_list / size_filter_excludes_all 이 읽는다
// 정수가 아니면 해당 필터를 **버린다**(fail-safe) — 예전과 같다.
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

    // 문자열 필터는 **값 자체는 손대지 않지만 타입은 본다.**
    //
    // 이스케이프는 없앴다(바인딩이 하므로). 그런데 옛 esc_sql_str 이
    // String(v) 를 겸하고 있어서, 그것을 지우자 문자열이 아닌 값이 그대로
    // 바인딩까지 흘러갔다.
    //
    // express 는 query parser 기본값이 'extended'(qs)라 ?cra[x]=1 이 객체
    // { x: '1' } 가 된다. 그 객체를 바인딩하면 node-mysql 의 SqlString 이
    // objectToValues 로 펼쳐 `x` = '1' 을 SQL 에 써 넣는다:
    //
    //   ?rn[x]=1    ->  and rn = `x` = '1'        ER_BAD_FIELD_ERROR -> 500
    //   ?cra[x]=1   ->  and `x` = '1' <= ct       문법은 맞다. 0 <= ct 가 참이라
    //                                             **cra 필터가 통째로 무력화**된다
    //
    // 두 번째가 더 나쁘다 — 에러 없이 전건이 나간다. 옛 코드는 String(v) 덕에
    // '[object Object]' 가 되어 0건이었다(정답은 아니지만 fail-safe 였다).
    //
    // 그래서 스칼라가 아니면 그 필터를 **버린다**. 숫자 쪽과 같은 fail-safe 다.
    // lbl 만 배열을 허용한다 — 라벨 여럿(lbl=a&lbl=b)이 정상 요청이고
    // build_search_query 가 OR 그룹으로 묶는다.
    var isScalar = function (v) {
        return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
    };

    ['rn', 'cty', 'cra', 'crb', 'ms', 'us', 'exa', 'exb', 'sts', 'stb'].forEach(function (k) {
        if (query[k] == null) { return; }
        if (!isScalar(query[k])) { delete query[k]; }
    });

    if (query.lbl != null) {
        if (Array.isArray(query.lbl)) {
            if (!query.lbl.every(isScalar)) { delete query.lbl; }
        }
        else if (!isScalar(query.lbl)) {
            delete query.lbl;
        }
    }
}
exports.sanitize_discovery_query = sanitize_discovery_query;

/**
 * discovery 필터를 WHERE 조각으로 만든다.
 *
 * **클라이언트 값은 전부 이름 바인딩으로 나간다.** 예전에는 util.format 으로
 * SQL 문자열에 직접 이어 붙였고, 그래서 sanitize_discovery_query 가 값마다
 * 손으로 이스케이프해야 했다(한국전자기술연구원 취약점 보고, Mobius <=2.5.15).
 * 이스케이프는 하나만 빠져도 뚫리고, 방언마다 규칙이 다르다.
 *
 * **위치 바인딩(?)이 아니라 이름 바인딩(:name)이어야 한다.** 값 안에 물음표가
 * 있으면 knex 가 그것까지 자리표로 세어 "Expected N bindings, saw N+1" 로
 * 죽는다. 물음표는 리소스 이름이나 라벨에 얼마든지 들어가는 평범한 글자다
 * (재현: ?fu=1&rn=what%3F -> HTTP 500). 이름 바인딩은 :name 만 찾는다.
 * 골격 CTE 의 :root_ri 도 같은 이유로 이름 바인딩이다.
 *
 * 돌려주는 것: { where, bindings }
 *   where     ' and ...' 로 시작하는 조각 (없으면 빈 문자열)
 *   bindings  { q_xxx: 값 }  — 호출부가 :root_ri 와 합쳐 넘긴다
 */
function build_search_query(query) {
    var where = '';
    var b = {};
    var n = 0;
    // 이름은 겹치면 안 된다. 라벨/타입이 여럿일 수 있어 일련번호를 붙인다.
    function bind(v) {
        var k = 'q' + (n++);
        b[k] = v;
        return ':' + k;
    }

    if (query.lbl != null) {
        // lbl 은 JSON 배열을 담은 문자열이라 like 로 찾는다. 패턴 전체를
        // 값으로 넘긴다.
        //
        // **주의: 이것이 값 안의 % 를 막아 주지는 않는다.** LIKE 는 패턴
        // 피연산자가 바인딩이어도 그 안의 % / _ 를 와일드카드로 해석한다.
        // ?lbl=a%b 는 전환 전후 모두 lbl like '%"%a%b%"%' 로 나간다.
        // 막으려면 값에서 % / _ 를 이스케이프하고 ESCAPE 절을 붙여야 하는데,
        // 그건 동작 변경이라 여기서 하지 않는다.
        //
        // 분기 조건은 예전 그대로 둔다. lbl 이 'a,b' 같은 **문자열**이면
        // 아래 else 가 query.lbl.length 로 문자열 길이를 돌아 글자 하나씩을
        // 라벨로 본다 — 원래 있던 결함이고 여기서 고치지 않는다.
        // (lbl=a&lbl=b 로 오면 배열이라 정상이다.)
        var like = function (v) { return '%"%' + v + '%"%'; };
        if (query.lbl.toString().split(',')[1] == null) {
            where += ' and lbl like ' + bind(like(query.lbl));
        }
        else {
            // 라벨 여러 개는 OR 로 묶는다. 괄호가 없으면 뒤에 오는 필터가
            // 마지막 라벨에만 걸린다 — AND 가 OR 보다 세다:
            //   and lbl~a or lbl~b and ty=3  ->  (lbl~a) or ((lbl~b) and ty=3)
            // 그러면 ty 를 줘도 첫 라벨은 타입 상관없이 다 딸려 나온다.
            var parts = [];
            for (var i = 0; i < query.lbl.length; i++) {
                parts.push('lbl like ' + bind(like(query.lbl[i])));
            }
            where += ' and (' + parts.join(' or ') + ')';
        }
    }

    if (query.ty != null) {
        // 타입은 **등치**여야 한다. MySQL 재귀 CTE 안에서는 ref 접근만 되고
        // range 가 안 되어, ty in (...) 이나 ty < 4 로 쓰면 인덱스가 pi 까지만
        // 듣고 나머지는 필터가 된다 (배포 실측 6,961ms vs 434ms).
        // 값은 예전 리터럴과 같게 문자열로 넘긴다.
        var tys = Array.isArray(query.ty) ? query.ty : String(query.ty).split(',');
        if (tys.length === 1) {
            where += ' and ty = ' + bind(String(tys[0]));
        }
        else {
            var ors = tys.map(function (t) { return 'ty = ' + bind(String(t)); });
            where += ' and (' + ors.join(' or ') + ')';
        }
    }

    if (query.cra != null) { where += ' and ' + bind(query.cra) + ' <= ct'; }
    if (query.crb != null) { where += ' and ct < ' + bind(query.crb); }
    if (query.ms != null) { where += ' and ' + bind(query.ms) + ' <= lt'; }
    if (query.us != null) { where += ' and lt < ' + bind(query.us); }
    if (query.exa != null) { where += ' and ' + bind(query.exa) + ' <= et'; }
    if (query.exb != null) { where += ' and et < ' + bind(query.exb); }
    if (query.sts != null) { where += ' and st < ' + bind(query.sts); }
    if (query.stb != null) { where += ' and ' + bind(query.stb) + ' <= st'; }

    // sza / szb / cty 는 contentInstance 의 속성을 본다 — cs(contentSize) 와
    // cnf(contentInfo) 다. 그 둘은 lookup 이 아니라 cin 에 있으므로 별칭 c 로
    // 부른다. 호출부(build_descendant_sql)가 이 셋 중 하나라도 있으면
    // cin 을 조인한다.
    //
    // 예전에는 별칭 없이 cs / cnf 라고 써서 lookup 에 붙였고, lookup 에는 그
    // 컬럼이 없으니 SQL 준비 단계에서 깨져 **항상 HTTP 500** 이었다.
    // 8년 전 mobiusdb.sql 에서 두 컬럼을 뺄 때 이쪽을 안 고쳤다.
    //
    // 크기는 수로 비교한다 — cs 는 MySQL 이 int, SQLite 가 TEXT 다.
    if (query.sza != null) {
        where += ' and ' + bind(parseInt(query.sza, 10)) + ' <= ' + facade.numericExpr('c.cs');
    }
    if (query.szb != null) {
        where += ' and ' + facade.numericExpr('c.cs') + ' < ' + bind(parseInt(query.szb, 10));
    }

    if (query.rn != null) { where += ' and rn = ' + bind(query.rn); }

    if (query.cty != null) {
        // cnf 에는 클라이언트가 준 contentInfo 가 그대로 들어간다
        // (예: 'application/json:0'). 정확 일치로 본다.
        where += ' and c.cnf = ' + bind(query.cty);
    }

    return { where: where, bindings: b };
}
exports._build_search_query = build_search_query;

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
// search_lookup_parents 는 여기 있었다. 재귀 CTE 로 옮기면서(340b436)
// 쓰이지 않게 되어 주석 처리해 둔 것을, 76줄짜리 죽은 주석으로 남길
// 이유가 없어 지웠다. 필요하면 git 이 갖고 있다.

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

// discovery 는 두 백엔드 모두 재귀 CTE 로 골격을 만든 뒤, 그 골격을 부모
// 목록으로 삼아 자식을 뽑는다. **문장은 둘이다.**
//
// 예전에는 MySQL 만 "레벨별로 부모를 모아 두고 부모마다 질의" 하는 2단계였다.
// 그 방식은 레벨당 2,000개 상한이 있어 큰 트리에서 결과가 조용히 잘렸고,
// 부모 수만큼 왕복이 생겼다. SQLite 는 이미 CTE 였으므로 CTE 로 통일했다.
//
// 그 다음 단계로 골격 CTE 와 자식 질의를 **한 문장으로 붙였다가 다시 갈랐다.**
// 붙여 두면 pi 가 조인에서 오므로 MySQL 이 ref 접근을 골라 인덱스를
// (pi, ty) 까지만 쓰고, ct 는 키 범위가 아니라 ICP 로 스캔하며 거른다:
//
//   EXPLAIN FORMAT=JSON (배포 실측 2026-09-01)
//     table: r  access_type: ref  key: idx_lookup_pi_ty_ct
//     used_key_parts: ["pi", "ty"]                 <- ct 가 없다
//     index_condition: ('2026...' <= `r`.`ct`)     <- 스캔하며 거른다
//
// 그래서 부모마다 그 컨테이너의 CIN 인덱스 항목을 끝까지 훑었다.
// /Mobius/KETI_MUV/Mission_Data 는 부모 2,806개에 CIN 2,282만 건이고
// 가장 큰 컨테이너 하나가 593만 건이다 — 30초 상한에 걸려 하루 4건 500 이 났다.
// lim 은 도움이 안 된다. cra 가 "지금" 이면 매칭이 0건이라 조기 종료가
// 일어나지 않고 전부 훑는다 — **0건일 때가 가장 느리다.**
//
// pi 가 상수 목록이면 range 옵티마이저가 ct 까지 키 범위에 넣는다:
//   join skel      ref    key_len 606 (pi, ty)       30,000ms 타임아웃
//   LATERAL        ref    key_len 606                동일 — 안 된다
//   pi IN (목록)   range  key_len 671 (pi, ty, ct)      126ms
// 매칭 개수와 무관하다(부모당 O(그 부모의 행 수) -> O(log n)):
//   cra=지금 0건 0.126초 / 오늘 343건 0.12초 / 전체(후보 2,282만) 0.42초
//
// 골격은 "CIN(ty=4) 이 아닌 자식" 을 따라 넓힌다. 조건의 표현은 백엔드마다
// 다르므로 파사드가 낸다 — facade.notCinPredicate() / notCinIndexName() 참고.
// (MySQL 은 재귀 CTE 안에서 등치만 인덱스를 타므로 가상 생성 컬럼을 쓴다)

// 큰 트리에서 pathological 한 질의(ty 없이 lbl like '%..%' 등)가 커넥션을
// 오래 붙잡지 않도록 문장 단위 상한을 건다. 지원하지 않는 백엔드에서는 null 이라
// 아무것도 붙지 않는다. 배포 서버 실측: 그런 질의는 현행 코드에서도 23초 걸린다.
const DISCOVERY_TIMEOUT_MS = 30000;

// 자식 질의 하나에 넣을 부모(IN 목록)의 최대 개수.
//
// **배치는 선택이 아니라 필수다 — 안 나누면 조용히 더 나빠진다.**
// range_optimizer_max_mem_size 가 8MB 다. IN 목록이 그 예산을 넘으면 MySQL 은
// range 를 **포기하고** 전체 인덱스 스캔으로 떨어진다. 경고도 에러도 없다.
//
//   부모 수    접근                옵티마이저 추정 행
//   2,000      range                        2,015
//   5,000      range                        5,015
//   8,000      range                        8,015
//   10,000     index (전체 스캔)       61,947,616     <- 여기서 무너진다
//
// 전환점은 8,000~10,000 사이이고 **경로 문자열 길이에 따라 움직인다.**
// 그래서 여유 2배를 두고 4,000 으로 잡는다. 이 값을 올리면 어느 날 경로가
// 길어졌다는 이유만으로 전체 스캔으로 떨어진다 — test/discovery-cte.test.js
// 가 상한을 못박고 있다.
//
// CSE 루트 /Mobius 의 골격은 34,414 노드이므로 루트 최악 9배치다.
// (골격 빌드 자체는 병목이 아니다 — 루트 34,414개가 0.32초다. 단
//  force index (idx_lookup_pi_notcin) 를 빼면 25초를 넘긴다.)
//
// SQLite: 번들 sqlite3 3.44.2 에서 바인딩 999 / 5,000 / 32,766 개 전부 통과.
// 4,000 은 양쪽 백엔드에서 안전하다.
const DISCOVERY_PARENT_BATCH = 4000;

// 배치 하나를 던질 가치가 있는 최소 남은 예산.
const MIN_BATCH_BUDGET_MS = 100;

// **예산은 부모 수가 아니라 range 조합 수다.**
//
// 위 표의 "부모 수" 는 ty 를 하나만 준 질의로 잰 값이다. ty 를 여러 개 주면
// where 가 (ty = :q0 or ty = :q1 ...) 이 되고, 옵티마이저는 부모마다 ty 값
// 수만큼 범위를 만든다 — 조합은 (부모 수 x ty 값 수)다. ty 를 넷 주면
// 부모 4,000 개가 16,000 조합이 되어 위 표의 붕괴 지점을 훌쩍 넘는다.
//
// 그래서 배치를 ty 값 수로 나눈다. ty 를 안 주면 ty 술어가 없으므로 1 이다.
function discovery_batch_size(query) {
    var n = 1;
    if (query.ty != null) {
        var list = Array.isArray(query.ty) ? query.ty : String(query.ty).split(',');
        n = list.filter(function (v) { return String(v).trim() !== ''; }).length || 1;
    }
    return Math.max(1, Math.floor(DISCOVERY_PARENT_BATCH / n));
}
exports.discovery_batch_size = discovery_batch_size;

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

// ri 아래 **골격**(자손 중 부모가 될 수 있는 노드)만 뽑는 SQL. {sql, bindings}.
//
// 마지막에 sk_ri / sk_lvl 을 그대로 내보낸다. 자식은 별도 문장이 이 목록을
// pi IN (...) 으로 받아 뽑는다 — 왜 나눴는지는 위 DISCOVERY_PARENT_BATCH
// 주석 위의 설명을 볼 것.
//
// 컬럼 이름을 sk_ 로 접두하는 이유는 그대로다: build_search_query 는 컬럼을
// alias 없이 부르므로(lbl, ty, ct ...) 골격이 ri / ty 같은 이름을 내보내면
// 자식 질의의 where 가 모호해진다.
// budget_ms 는 **이 문장 하나**에 걸 상한이다. 배치 경로는 문장이 여러 개라
// DISCOVERY_TIMEOUT_MS 를 문장마다 새로 걸면 요청 전체 상한이 그 배수로 늘어난다
// (루트 10문장 = 300초). 호출부가 남은 예산을 계산해 넘긴다.
function build_skeleton_sql(ri, query, budget_ms) {
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

    var timeout = facade.statementTimeoutHint(budget_ms || DISCOVERY_TIMEOUT_MS);
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
    //
    // 루트는 **이름 바인딩**(:root_ri)이다. 위치 바인딩(?)을 쓰면 안 된다 —
    // 값 안의 물음표를 knex 가 자리표로 세어 "Expected N bindings, saw N+1" 로
    // 죽는다(재현: ?fu=1&rn=what%3F -> HTTP 500). 자식 질의의 :pN / :qN 도
    // 같은 이유로 이름 바인딩이다.
    var sql =
        'with recursive skel as (\n' +
        '  select ri' + C + ' as sk_ri, 0 as sk_lvl from lookup where ri = :root_ri' + branches + '\n' +
        ')\n' +
        lead + 'sk_ri, sk_lvl from skel';

    // max_lvl 로 자르는 일은 호출부가 JS 에서 한다 (search_lookup 참고).
    // 재귀 분기의 s.sk_lvl < max_lvl 가드가 이미 깊이를 막고 있고, 남는 것은
    // 마지막 한 레벨을 부모 목록에서 빼는 일뿐이라 SQL 을 더 복잡하게 할
    // 이유가 없다.
    return { sql: sql, bindings: { root_ri: ri } };
}
exports.build_skeleton_sql = build_skeleton_sql;

/**
 * 골격의 한 배치를 부모로 삼아 자식을 뽑는 SQL. {sql, bindings} 를 준다.
 *
 * parents 는 이 배치의 sk_ri 문자열 배열이다. **값은 전부 이름 바인딩(:pN)
 * 으로 나간다** — SQL 문자열에 경로를 넣으면 안 된다. 경로에 물음표가 들어간
 * 실제 500 사례가 있다. 필터 쪽 이름(:qN)과 겹치지 않게 접두사를 나눈다.
 *
 * lim / ofst 는 **이 배치 안에서의** 한도와 오프셋이다. 전역 오프셋을 배치마다
 * 그대로 주면 배치 수만큼 건너뛰어 틀리므로, 호출부가 앞 배치들의 행 수를
 * 먼저 소진시킨 뒤 **남은 만큼만** 여기에 넘긴다(search_lookup 참고).
 *
 * count_cap 을 주면 행 대신 **개수**를 세는 문장을 만든다. 그때 바깥 select 는
 * `select count(*) from (select 1 ... limit count_cap) t` 라 최대 count_cap 행만
 * 훑는다. 경계 없는 count 는 쓰면 안 된다 — 배포 실측으로 ty=4 한 건이
 * 25초 상한에 걸렸고, 경계를 주면 같은 질의가 0.05초다.
 */
function build_children_sql(parents, query, search, lim, budget_ms, ofst, count_cap) {
    // 자식 질의는 (pi, ty, ct) 를 고정한다. 여기는 요청의 ty 로 거르는데,
    // lbl 처럼 인덱스 밖 컬럼이 끼면 옵티마이저가 PRIMARY 를 골라 ty 를 범위에서
    // 빼 버리고 부모마다 CIN 을 전부 읽는다 — 배포 서버에서 60초를 넘겼다.
    //
    // 타입을 안 고르고 lbl 로 찾는 경우는 (pi, not_cin) 을 쓴다. 그래야
    // 부모마다 CIN 을 건너뛰고 비-CIN 자식만 읽는다 — like_filter_without_ty
    // 주석 참고.
    var skip_cin = like_filter_without_ty(query);
    var hint = facade.indexHint(skip_cin ? facade.notCinIndexName() : 'idx_lookup_pi_ty_ct');
    var skip_cin_where = skip_cin ? (' and ' + facade.notCinPredicate('r')) : '';

    // **la 는 인덱스를 강제하지 않는다.**
    //
    // la 는 `order by ct desc, ri desc limit N` 이라 정렬이 붙는다. 인덱스를
    // 강제하면 MySQL 이 ref 접근을 골라 그 정렬을 filesort 로 처리한다 —
    // 배포 실측(부모 하나, CIN 593만):
    //
    //   pi IN (...) + force index    ref     filesort    30초 상한 초과
    //   pi IN (...) 강제 없음        range   정렬 없음   즉시
    //
    // 강제를 빼면 옵티마이저가 인덱스를 역방향 range 로 훑어 정렬이 사라진다.
    // 강제가 필요했던 이유(옵티마이저가 PRIMARY 를 골라 CIN 을 전부 읽는 것)는
    // 정렬이 없는 질의의 이야기라 la 에는 해당하지 않는다.
    //
    // pi 가 **상수**여야 한다는 조건도 같이 필요하다. 골격을 조인하면 상수가
    // 아니라 강제를 빼도 filesort 다 — 그래서 la 도 이 배치 경로(pi IN)를 탄다.
    if (query.la != null) { hint = ''; }

    var timeout = facade.statementTimeoutHint(budget_ms || DISCOVERY_TIMEOUT_MS);
    var lead = 'select ' + (timeout ? '/*+ ' + timeout + ' */ ' : '');

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

    // 빈 목록은 `in ()` 이라는 문법 오류 SQL 이 된다. 호출부가 이미 막지만
    // 이 함수는 export 돼 있으므로 여기서도 막는다 — null 을 주면 호출부가
    // "던질 것이 없다" 를 알 수 있다.
    if (!parents || parents.length === 0) { return null; }

    var bindings = {};
    var slots = [];
    for (var i = 0; i < parents.length; i++) {
        bindings['p' + i] = parents[i];
        slots.push(':p' + i);
    }

    // 개수만 셀 때는 컬럼을 읽지 않는다 — 인덱스만으로 끝난다.
    var cols = (count_cap != null) ? '1' : 'r.*';

    var sql = lead + cols + ' from lookup r' + hint + cin_join + '\n' +
        ' where r.pi in (' + slots.join(', ') + ')' +
        cin_ty + skip_cin_where + search.where;

    // limit / offset 은 리터럴이다. 값은 호출부가 정수로 계산해 준다
    // (sanitize_discovery_query 가 la / ofst / lim 을 정수로 강제한다).
    if (count_cap != null) {
        // **경계 있는 count.** 안쪽 limit 이 없으면 후보를 전부 훑는다 —
        // 배포 실측: ty=4 (후보 2,282만) 에서 경계 없음 25초 상한 초과,
        // 경계 있음(limit 2001) 0.05초.
        sql = 'select count(*) as n from (' + sql +
              ' limit ' + Math.max(0, Math.floor(count_cap)) + ') t';
    }
    else {
        // la 는 "최신 N건" 이다. ct 는 초 단위라 동점이 흔해 ri 로 가려야
        // 안정적이다 — 없앴을 때 la 가 10회 모두 진짜 최신이 아닌 건을
        // 돌려준 실측이 있다(2026-08-28). 위에서 인덱스 강제를 뺐으므로
        // 옵티마이저가 이 정렬을 인덱스 역방향 스캔으로 처리한다.
        //
        // presearch_action 이 la 요청에 lvl=1 을 박으므로 부모는 언제나
        // 하나다. 즉 이 정렬은 배치 안이 곧 전역이다.
        if (query.la != null) { sql += ' order by r.ct desc, r.ri desc'; }
        sql += ' limit ' + Math.max(0, Math.floor(lim));
        if (ofst > 0) { sql += ' offset ' + Math.floor(ofst); }
    }

    // 필터의 :qN 을 합쳐 넘긴다. 이름이 겹치지 않게 부모는 p, 필터는 q 다.
    Object.keys(search.bindings).forEach(function (k) {
        bindings[k] = search.bindings[k];
    });

    return { sql: sql, bindings: bindings };
}
exports.build_children_sql = build_children_sql;

// ── 예전의 한 문장 경로. ofst 나 la 가 있으면 이쪽을 쓴다 ────────────────
//
// 배치 경로(build_skeleton_sql + build_children_sql)는 **ofst 가 없고 la 도
// 없는 요청에만** 쓴다. 나머지는 이 함수 그대로다. 이유는 둘이다.
//
//   ofst  전역 오프셋은 SQL 이 DB 안에서 건너뛴다. 배치로 나누면 그럴 수
//         없어 JS 가 앞부분을 버려야 하는데, 그러려면 배치마다
//         limit (ofst + lim) 을 걸어 **버릴 행까지 전부 실어 와야 한다.**
//         ofst 는 서버가 X-M2M-CTO 로 광고하므로 정상 페이징이 그 경로를 밟는다.
//   la    전역 정렬이라 조기 종료를 못 한다. 모든 배치를 던지고 결과를
//         전부 메모리에 쌓아 다시 정렬해야 한다 — 왕복만 늘고 이득이 없다.
//
// 실측으로 확인된 타임아웃(2026-09-01, 배포 서버)은 전부 ofst 없는 요청이었다.
// 그쪽만 바꾸면 위 두 문제가 애초에 생기지 않는다.
function build_descendant_sql(ri, query, search, cur_lim) {
    var query_where = search.where;
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
    // 바인딩은 **이름**으로 준다. 위치 바인딩(?)을 쓰면 안 된다.
    //
    // 근거가 두 번 바뀌었으니 지금 상태로 적는다. 원래는 query_where 가
    // 클라이언트 값을 문자열 리터럴로 품고 있어서, 그 값의 물음표를 knex 가
    // 자리표로 세어 "Expected 1 bindings, saw 2" 로 죽었다
    // (재현: ?fu=1&rn=what%3F -> HTTP 500). 그 값들은 이제 :qN 바인딩이라
    // SQL 본문에 물음표가 남지 않는다.
    //
    // **지금의 근거는 이것 하나다: 골격의 :root_ri 와 필터의 :qN 을 한 문장에
    // 섞어야 한다.** 위치 바인딩으로는 두 곳에서 만든 조각의 순서를 맞출 수
    // 없다. 이름이면 knex 가 등장 순서대로 알아서 편다.
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
    // 골격의 :root_ri 와 필터의 :qN 을 합쳐 넘긴다. 이름이 겹치지 않게
    // 필터 쪽은 q 로 시작한다.
    var bindings = { root_ri: ri };
    Object.keys(search.bindings).forEach(function (k) {
        bindings[k] = search.bindings[k];
    });

    return { sql: sql, bindings: bindings, limit: lim, offset: ofst || 0,
             // 이 요청에서 CIN 을 뺐는가. 호출부가 응답에 표시하고 로그에 남긴다 —
             // 조용히 좁히면 "없다" 와 "안 찾아봤다" 를 구별할 수 없다.
             skippedCin: skip_cin };
}
exports.build_descendant_sql = build_descendant_sql;

// 인자 목록은 예전 2단계 구현의 것을 그대로 둔다 — 호출부(resource.js)와
// 테스트가 이 형태를 쓴다. pi_list / pi_index / skipped / cni / cur_d /
// loop_cnt / search_tid 는 여기서 더는 읽지 않는다.
//
// 콜백은 callback(code, info) 다. 성공하면 info 에
//   { rows, limit, offset }   실제로 취한 행 수와 건 한도/오프셋
// 이 담긴다. 호출부는 이것으로 "결과가 잘렸는가" 를 판정하고 다음 오프셋을
// 계산한다 (X-M2M-CTS / X-M2M-CTO).
//
// **rows 는 select_spec_ri 가 고아 행을 걷어내기 전 수**다. 다음 오프셋은
// DB 가 실제로 건너뛴 만큼이어야 하므로 응답 건수가 아니라 이 값을 써야 한다.
// 안 그러면 클라이언트가 다음 페이지에서 고아 수만큼 앞을 다시 읽는다.
//
// ── 두 경로 ──────────────────────────────────────────────────────────────
// **배치 경로는 ofst 가 없고 la 도 없는 요청에만 쓴다.** 나머지는 예전
// 한 문장(build_descendant_sql) 그대로다 — 이유는 그 함수 위 주석에 있다.
//
// 배치 경로의 왕복은 골격 1회 + ceil(부모수 / 배치크기) 회다. 보통 요청은
// 2회. **부모마다 던지던 시절(배포 실측 4,080회)로 돌아가면 안 된다.**
//
// ── 행 순서 ──────────────────────────────────────────────────────────────
// 한 문장이던 시절의 순서는 (골격 순서 × 부모별 인덱스 순서)였다. 배치로
// 나눈 뒤에는 배치 안에서 range 접근이 pi 오름차순으로 준다. 둘 다
// **결정적**이라 결과가 빠지지는 않는다. ofst 가 있는 요청은 예전 경로를
// 쓰므로 페이징 순서는 애초에 바뀌지 않는다.
exports.search_lookup = function (connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, skipped, cni, cur_d, loop_cnt, callback, search_tid) {
    // 숫자로 쓰이는 파라미터만 거른다. 문자열 값은 이제 바인딩으로 나가므로
    // 이스케이프하지 않는다 (build_search_query 주석 참고).
    sanitize_discovery_query(query);

    var search = build_search_query(query);
    var max_lvl = descendant_max_lvl(query);
    var la_mode = (query.la != null);

    // 실효 한도. la 가 있으면 그 값이 한도다.
    var lim = parseInt(la_mode ? query.la : cur_lim, 10);
    if (isNaN(lim) || lim < 0) { lim = max_search_count; }

    var ofst = 0;
    if (query.ofst != null) {
        var o = parseInt(query.ofst, 10);
        if (!isNaN(o) && o > 0) { ofst = o; }
    }

    var info = {
        rows: 0, limit: lim, offset: ofst,
        // 이 요청에서 CIN 을 뺐는가. 호출부가 응답에 표시하고 로그에 남긴다 —
        // 조용히 좁히면 "없다" 와 "안 찾아봤다" 를 구별할 수 없다.
        skippedCin: like_filter_without_ty(query)
    };

    // 답이 있을 수 없는 조합이면 DB 를 건드리지 않는다.
    // (크기·형식 필터 + ty=4 를 뺀 타입 지정 — size_filter_excludes_all 주석 참고)
    if (size_filter_excludes_all(query)) {
        return callback('200', info);
    }

    // 콜백은 정확히 한 번이다. 배치 루프에서 두 번 부르기 쉽다.
    var settled = false;

    // 파사드 규약: 실패는 cb(true, errObj) 다 — 에러 객체는 **둘째** 인자로 온다
    // (mobius/db/index.js 의 run 참고). 첫 인자를 에러로 착각하면 err 는 그냥
    // boolean true 라서 err.code / err.message 가 전부 undefined 가 되고,
    // 로그에 '[search_lookup] true' 한 줄만 남아 원인을 알 수 없게 된다.
    function bail(res) {
        if (settled) { return; }
        settled = true;

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

    // ── 경로 선택 ────────────────────────────────────────────────────────
    // **한 질의 모양은 언제나 같은 경로를 탄다.** 이게 규칙이다.
    //
    // 처음에는 ofst 가 있으면 예전 경로로 보냈는데, 그러면 같은 페이징의
    // 1페이지(ofst 없음)와 2페이지(ofst 있음)가 **서로 다른 경로**를 타게 된다.
    // 두 경로는 행 순서가 다르다 — 배치 경로는 range 접근이라 pi 오름차순이고,
    // 예전 경로는 조인 순서다. 그래서 offset N 이 1페이지가 준 것과 다른 N 건을
    // 건너뛴다. 배포 실측(2026-09-01): ty=3 자손 2,806건을 페이징으로 모으니
    // **2,558건에 중복 248건** — 248건이 조용히 빠졌다.
    //
    // 그래서 ofst 는 배치 경로가 직접 처리한다(아래 next_batch 참고).
    //
    // **la 도 배치 경로를 탄다.** 한때 예전 한 문장으로 보냈는데, 그 경로는
    // 골격을 조인하므로 pi 가 상수가 아니고, 그러면 `order by ct desc, ri desc`
    // 가 filesort 가 되어 30초 상한에 걸렸다(배포 실측, CIN 593만). pi 를 상수로
    // 주고 인덱스 강제를 빼야 옵티마이저가 인덱스 역방향 range 로 정렬을
    // 없앤다 — 그 둘을 build_children_sql 이 한다.
    //
    // presearch_action 이 la 요청에 ty=4 / lvl=1 을 박으므로 부모는 언제나
    // 하나다. 배치가 하나뿐이라 배치 안의 정렬이 곧 전역 정렬이다.

    // 여기부터 배치 경로다. 오프셋은 아래 next_batch 가 배치별로 소진한다.
    var skip = ofst;
    var need = lim;
    var taken = 0;

    // **요청 하나의 DB 예산은 여전히 DISCOVERY_TIMEOUT_MS 다.**
    // 문장이 1 + N 개가 되었으므로 문장마다 30초를 새로 걸면 요청 상한이
    // 그 배수로 늘어난다(루트 10문장 = 300초). 남은 예산을 계산해 넘기고,
    // 다 쓰면 상한에 걸린 것과 같이 취급한다.
    var started = Date.now();
    function budget_left() {
        return DISCOVERY_TIMEOUT_MS - (Date.now() - started);
    }
    function out_of_budget() {
        console.error('[search_lookup] statement timeout (' + DISCOVERY_TIMEOUT_MS +
                      'ms) ri=' + ri + ' query=' + JSON.stringify(query) +
                      ' — 대상을 좁히거나(더 깊은 경로) ty 를 함께 준다');
        if (settled) { return; }
        settled = true;
        return callback('500-6');
    }

    var batch_size = discovery_batch_size(query);

    function finish() {
        if (settled) { return; }
        settled = true;
        info.rows = taken;
        callback('200', info);
    }

    // 골격 질의의 결과. next_batch 가 여기서 배치를 잘라 간다.
    var parents = [];

    var skel = build_skeleton_sql(ri, query, budget_left());
    facade.run(facade.raw(skel.sql, skel.bindings), connection, function (err, res) {
        if (err) { return bail(res); }

        // lvl 로 결과 깊이를 제한한 요청은 마지막 레벨의 노드가 부모가 될 수
        // 없다. 재귀 분기의 s.sk_lvl < max_lvl 가드가 골격의 깊이를 이미
        // 막았으므로 여기서는 한 레벨만 걷어내면 된다.
        var srows = res || [];
        for (var i = 0; i < srows.length; i++) {
            if (max_lvl !== null && Number(srows[i].sk_lvl) > max_lvl) { continue; }
            parents.push(srows[i].sk_ri);
        }

        // 부모가 0개면 DB 를 더 칠 이유가 없다 (없는 ri, 또는 lvl 로 전부 잘림).
        if (parents.length === 0) { return finish(); }

        next_batch(0);
    });

    function next_batch(start) {
        if (settled) { return; }
        // 한도를 채웠으면 남은 배치를 던지지 않는다 (조기 종료).
        if (need === 0) { return finish(); }
        if (start >= parents.length) { return finish(); }

        // 예산이 거의 없으면 던지지 않는다. MAX_EXECUTION_TIME(3) 같은 값은
        // 서버가 곧바로 3024 로 죽여서 결과는 같고 왕복만 버린다.
        var left = budget_left();
        if (left < MIN_BATCH_BUDGET_MS) { return out_of_budget(); }

        var batch = parents.slice(start, start + batch_size);

        // ── 오프셋 소진 ──────────────────────────────────────────────────
        // 남은 오프셋이 있으면 이 배치가 몇 건을 가졌는지부터 센다.
        //   센 값 <= skip   이 배치는 통째로 건너뛴다. 행을 하나도 안 받는다.
        //   센 값 >  skip   이 배치 안에서 skip 건을 건너뛰고 받는다.
        //
        // **경계를 반드시 준다(limit skip+1).** 경계가 없으면 후보를 전부
        // 훑는다 — 배포 실측으로 ty=4(후보 2,282만)가 25초 상한을 넘겼고,
        // 경계를 주면 같은 질의가 0.05초다. skip+1 만 넘으면 "더 있다" 를
        // 아는 데 충분하다.
        if (skip > 0) {
            var cq = build_children_sql(batch, query, search, 0, left, 0, skip + 1);
            if (cq === null) { return finish(); }
            return facade.run(facade.raw(cq.sql, cq.bindings), connection,
                function (err, res) {
                    if (err) { return bail(res); }
                    var n = (res && res[0] && Number(res[0].n)) || 0;
                    if (n <= skip) {
                        // 이 배치는 전부 오프셋 안쪽이다. 행을 안 받고 넘어간다.
                        skip -= n;
                        return next_batch(start + batch_size);
                    }
                    fetch_batch(start, batch);
                });
        }

        fetch_batch(start, batch);
    }

    function fetch_batch(start, batch) {
        if (settled) { return; }
        var left = budget_left();
        if (left < MIN_BATCH_BUDGET_MS) { return out_of_budget(); }

        var q = build_children_sql(batch, query, search, need, left, skip);
        if (q === null) { return finish(); }

        facade.run(facade.raw(q.sql, q.bindings), connection, function (err, res) {
            if (err) { return bail(res); }
            // 이 배치에서 오프셋을 다 썼다. 다음 배치부터는 앞에서부터 받는다.
            skip = 0;
            var rows = res || [];
            for (var j = 0; j < rows.length && need > 0; j++) {
                found_Obj[rows[j].ri] = rows[j];
                taken++;
                need--;
            }
            next_batch(start + batch_size);
        });
    }
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

// select_grp_lookup 과 select_grp 은 여기 있었다. 저장소 어디서도 부르지
// 않아 지웠다 — 그룹 조회는 select_resource_from_url 이 lookup 을 통해 한다.
// (같은 이유로 앞서 select_count_ri 와 delete_ri_lookup_in 을 지웠다.)

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

// select_sub 은 여기 있었다. 호출부가 없어 지웠다 — 알림 경로는 sub 테이블을
// pi 로 뒤지지 않고 부모 lookup 의 subl 컬럼에 캐시된 항목을 읽는다
// (sgn.js 의 sgn_action -> subl_entry.read).

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

// select_st 는 여기 있었다. 호출부가 없어 지웠다 — st 는 select_cni_parent 가
// lookup 조인으로 함께 읽는다.

// 한 컨테이너에서 오래된 자식을 지운다. **마스터의 purge_sweep 만 부른다.**
//
// 순서가 이 함수의 전부다: **실측 -> 판단 -> 삭제.** 저장값(cnt.cni/cbs)으로는
// 지울지 말지를 정하지 않는다.
//
// 한때 실측을 삭제 **뒤로** 옮긴 판이 있었다(더 짧아 보였다). 그러면 삭제
// 건수의 유일한 근거가 저장값이 되는데, 저장값은 실제보다 클 수 있다 —
// 이 파일이 스스로 적어 둔 원인이 둘이다: delete_lookup_et 과
// delete_descendants_background 가 lookup 을 지우면서 cnt 를 감산하지 않는다.
// 그러면 **한도 안에 있는 컨테이너에서 살아 있는 CIN 을 지운다.** lookup 삭제는
// FK(cin_ri ON DELETE CASCADE)라 cin 본문까지 되돌릴 수 없이 사라진다.
//
// 실측은 cin_ri_idx(pi, ri, cs) 커버링 인덱스만 읽는다. lookup 을 조인하면
// 자식 수만큼 cin 에 랜덤 접근해서 114,627행 기준 7.178s 대 0.142s 였다.
// 12만 8천 행 컨테이너 실측 0.114s — 관문 값으로 충분히 싸다.
//
// 트랜잭션과 SELECT ... FOR UPDATE NOWAIT 는 없다. 그것들은 워커 25개가
// 동시에 정리하기 때문에 있었고, **잠금이 없는 백엔드는 그 알고리즘을 못 써서
// 아예 다른 갈래를 들고 있었다.** 정리 주체를 마스터 하나로 만들어 없앴다.
// 그 전제는 get_cni_count 에서 정리를 걷어내면서 비로소 참이 되었다 —
// 그전에는 컨테이너 PUT 이 워커에서 같은 함수를 부르고 있었다.
function delete_oldest(connection, obj, count, callback) {
    var del_id = 'delete_oldest (' + count + ') ' + obj.ri + ' - ' + require('shortid').generate() + '';
    console.time(del_id);

    var child_ty = String(parseInt(obj.ty, 10) + 1);
    var mni = parseInt(obj.mni, 10);
    var mbs = parseInt(obj.mbs, 10);

    function done(err, n) {
        console.timeEnd(del_id);
        callback(err, n);
    }

    // 한도를 모르면 **아무것도 지우지 않는다.** 한도가 없으면 무엇이 초과분인지
    // 정의되지 않으므로, 여기서 넘어가면 count 만큼을 근거 없이 지우게 된다.
    // 관문이 조용히 꺼지는 경로를 남기지 않는다 — mni 가 NULL 이거나 문자열이
    // 아니거나 해서 NaN 이 되는 순간이 정확히 그 경로다.
    // (배포 실측: cnt 30,306행 중 mni/mbs 가 NULL 인 것은 0건. 그래도 닫는다.)
    if (!isFinite(mni) || !isFinite(mbs)) {
        console.error('[delete_oldest] 한도를 모른다 — 지우지 않는다 ri=' + obj.ri +
                      ' mni=' + obj.mni + ' mbs=' + obj.mbs);
        return done(null, 0);
    }

    // 1) 실측한다. 여기서 나온 값만 삭제 판단의 근거다.
    facade.run(facade.k('cin')
        .count('* as n')
        .sum({ s: facade.raw('coalesce(cs, 0)') })
        .where({ pi: obj.ri }), connection, function (err0, rc) {

        if (err0 || !rc || !rc.length) {
            console.error('[delete_oldest] 실측 실패 ri=' + obj.ri + ' — 아무것도 지우지 않는다');
            return done(err0 || true, rc);
        }

        var actual_cni = parseInt(rc[0].n || 0, 10);
        var actual_cbs = parseInt(rc[0].s || 0, 10);

        // 2) 한도 안이면 지우지 않는다. 저장값이 어긋나 있었으면 실측으로
        //    고쳐 두고 끝낸다 — 드리프트 자가 치유. 이 관문이 없으면
        //    "cnt.cni 가 부풀어 있다" 가 곧 "멀쩡한 데이터를 지운다" 가 된다.
        if (actual_cni <= mni && actual_cbs <= mbs) {
            facade.run(facade.k('cnt')
                .update({ cni: actual_cni, cbs: actual_cbs })
                .where({ ri: obj.ri })
                .andWhere(function () {
                    this.whereNot('cni', actual_cni).orWhereNot('cbs', actual_cbs);
                }), connection, function (eh, rh) {
                if (eh) {
                    // 보정이 실패하면 저장값이 부풀어 있는 채로 남고,
                    // select_over_limit 이 저장값으로 고르므로 이 컨테이너가
                    // 다음 주기에 또 잡힌다 — 그리고 매번 전수 실측을 다시 돈다.
                    // 로그가 없으면 "초과 N개 중 0개 정리" 만 반복되어 원인을
                    // 짚을 단서가 없다. 이 함수의 다른 실패 경로와 같은 규약이다.
                    console.error('[delete_oldest] 드리프트 보정 실패 ri=' + obj.ri +
                                  ' : ' + ((rh && rh.message) || rh));
                }
                else if (rh && rh.affectedRows) {
                    console.log('[delete_oldest] 이미 한도 안 — 드리프트만 보정했다 ri=' +
                                obj.ri + ' cni->' + actual_cni + ' cbs->' + actual_cbs);
                }
                done(null, 0);
            });
            return;
        }

        // 3) 실측값으로 다시 계획한다. purge_sweep 이 저장값으로 잡아 준
        //    count 는 상한으로만 쓴다.
        var plan = _this.purge_plan(actual_cni, actual_cbs, mni, mbs);
        var need_cnt = plan.need_cnt;
        var need_cs = plan.need_cs;
        var candidates = plan.candidates;
        if (candidates < 1) { candidates = 1; }
        if (candidates > count) { candidates = count; }

        // 4) 후보를 고른다. ct 가 같을 수 있으므로 ri 로 동점을 깬다 —
        //    안 그러면 LIMIT 이 매번 다른 집합을 골라 센 것과 지운 것이 갈린다.
        facade.run(facade.k('lookup as l')
            .leftJoin('cin as c', 'l.ri', 'c.ri')
            .select('l.ri as ri', 'c.cs as cs')
            .where({ 'l.pi': obj.ri, 'l.ty': child_ty })
            .orderBy([{ column: 'l.ct', order: 'asc' }, { column: 'l.ri', order: 'asc' }])
            .limit(candidates), connection, function (err, rows) {

            if (err) { return done(err, rows); }
            if (!rows || rows.length === 0) { return done(null, 0); }

            // 5) **필요한 만큼만 자른다.** 개수와 용량 조건이 둘 다 채워지는
            //    지점에서 멈춘다. 후보를 통째로 지우면 용량 초과 정리에서
            //    필요 이상으로 지운다 — est_count 는 평균 cs 기반 추정이라
            //    실제 cs 가 평균보다 작으면 과대 추정된다. cs 를 SELECT 해
            //    놓고 쓰지 않던 것이 그 결함이었다.
            var total_cs = 0;
            var del_ri = [];
            for (var i = 0; i < rows.length; i++) {
                total_cs += parseInt(rows[i].cs || 0, 10);
                del_ri.push(rows[i].ri);
                if (del_ri.length >= need_cnt && total_cs >= need_cs) { break; }
            }
            if (del_ri.length === 0) { return done(null, 0); }

            // 6) 센 집합을 그대로 지운다. 다시 고르지 않는다 —
            //    예전에 "고른 집합" 과 "지운 집합" 이 달라져 카운터 보정이 틀어졌다.
            facade.run(facade.k('lookup').whereIn('ri', del_ri).del(),
                connection, function (err2, res2) {
                if (err2) { return done(err2, res2); }

                var deleted = del_ri.length;

                // 7) 카운터는 실측에서 뺀 절대값이다. 상대 감산이 아니라서
                //    과거에 쌓인 드리프트가 정리할 때마다 스스로 낫는다 —
                //    배포 실측으로 컨테이너 30,278개 중 1,659개(5.5%)가
                //    어긋나 있었다. 실측을 이미 했으므로 왕복이 늘지 않는다.
                //
                //    **알고 받아들이는 오차가 하나 있다.** 위 실측(1단계)과 이
                //    대입 사이에 CIN 생성의 증분(update_parent_counters)이
                //    착지하면 그만큼 덮인다. 그 창은 실측 + 후보 선택 + 삭제,
                //    100건 기준 배포 실측 0.26초 + 질의 둘이다.
                //
                //    방향은 안전한 쪽이다 — 저장값이 실제보다 **작아지므로**
                //    과다 삭제가 아니라 과소 삭제다. 다만 그래서 **다음 스윕이
                //    이것을 못 잡는다**: select_over_limit 은 저장값으로
                //    고르는데 그 값이 한도 밑이라 목록에 안 들어온다.
                //    잡는 것은 reconcile_cnt_counters 뿐이다(기동 시 + 일 1회).
                //    한 자릿수 오차가 최대 한 바퀴 남는 것이라 잠금을 들이지 않는다.
                var new_cni = actual_cni - deleted;
                var new_cbs = actual_cbs - total_cs;
                if (new_cni < 0) { new_cni = 0; }
                if (new_cbs < 0) { new_cbs = 0; }   // cbs 는 bigint unsigned 다

                facade.run(facade.k('cnt')
                    .update({ cni: new_cni, cbs: new_cbs })
                    .where({ ri: obj.ri }), connection, function (err4, r4) {
                    if (err4) {
                        console.error('[delete_oldest] cnt 보정 실패 ri=' + obj.ri +
                                      ' : ' + ((r4 && r4.message) || r4));
                    }

                    // 자식이 사라졌으니 부모 stateTag 를 올린다.
                    // 실패하면 자식은 없는데 st 는 그대로다 — 캐시를 든
                    // 클라이언트가 변경을 놓치므로 조용히 넘기지 않는다.
                    facade.run(facade.k('lookup')
                        .update({ st: facade.raw('st + 1') })
                        .where({ ri: obj.ri }), connection, function (err5, r5) {
                        if (err5) {
                            console.error('[delete_oldest] st 갱신 실패 ri=' + obj.ri +
                                          ' : ' + ((r5 && r5.message) || r5));
                        }
                        done(null, deleted);
                    });
                });
            });
        });
    });
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

    // 예전에는 IN 목록을 JSON.stringify 로 만들었다:
    //   where ri in ("a","b")
    // MySQL 은 큰따옴표를 문자열로 받아 주지만 **표준 SQL 에서 그것은
    // 식별자**다. 다른 백엔드에서는 "그런 컬럼이 없다" 가 된다.
    // 게다가 값이 SQL 안으로 들어가 이스케이프에 의존한다.
    // whereIn 은 방언에 맞게 인용하고 값은 바인딩으로 나간다.
    //
    // tbl 은 responder.typeRsrc 의 값이라 내부에서만 온다(클라이언트 입력이
    // 아니다). 그래도 식별자는 빌더가 인용하게 둔다.
    facade.run(facade.k(tbl).select('*').whereIn('ri', cur_ri), connection, function (err, search_Obj) {
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

// subl 은 여기서 쓰지 않는다. update_subl 로만 쓴다.
//
// 예전에는 이 함수가 subl 을 **절대값으로** 같이 덮었다. 그런데 이 함수를
// 부르는 래퍼가 update_cnt / update_ae / update_acp 등 20여 개다. 즉 부모
// 컨테이너에 PUT 한 번만 해도 그 요청이 시작될 때 읽은 subl 스냅샷으로
// 되감겼다 — 그 사이 다른 워커가 만든 구독은 사라진다.
//
// 구독과 무관한 갱신이 구독 목록을 건드릴 이유가 없다. 떼어 놓으면 subl 을
// 쓸 수 있는 곳이 구독 생성·수정·삭제 세 곳뿐이 된다.
exports.update_lookup = function (connection, obj, callback) {
    facade.run(facade.k('lookup').update({
        lt: obj.lt,
        acpi: JSON.stringify(obj.acpi),
        et: obj.et,
        st: obj.st,
        lbl: JSON.stringify(obj.lbl),
        at: JSON.stringify(obj.at),
        aa: JSON.stringify(obj.aa)
    }).where({ ri: obj.ri }), connection, function (err, results) {
        callback(err, results);
    });
};

/**
 * 부모의 발송 목록을 **읽은 자리에서 고쳐 쓴다.** 다른 컬럼은 안 건드린다.
 *
 *   update_subl(connection, ri, mutate, callback)
 *   mutate(list) -> 새 list          list 는 지금 DB 에 있는 배열이다
 *
 * 호출부는 구독 생성(resource.js create_action ty=23), 수정(update_action
 * ty=23), 삭제(delete_action ty=23) 세 곳뿐이다. 늘리지 말 것.
 *
 * ── 왜 배열을 받지 않고 함수를 받나 ─────────────────────────────────
 * 예전에는 호출부가 완성된 배열을 넘겼다. 그 배열은 요청이 시작될 때 읽은
 * 부모의 사본에서 나온 것이라, 읽은 뒤 쓰기까지의 사이에 다른 요청이 같은
 * 부모를 고치면 그 변경이 통째로 날아갔다. 절대값 UPDATE 라 병합이 없다.
 *
 * 창이 좁아 보이지만 무증상이고 영구적이다. 두 방향으로 샌다:
 *   같은 부모에 구독 두 개를 동시에 만들면 나중 UPDATE 가 앞의 것을 지운다.
 *   sub 행은 남아 있고 응답도 201 이지만, 발송기는 subl 만 보므로 먼저 만든
 *   구독은 영원히 알림을 못 받는다 — 배포의 "침묵 21건".
 *
 *   삭제와 겹치면 낡은 사본이 지워진 구독을 되살린다. sub 행은 FK CASCADE 로
 *   없는데 목록에만 남아 계속 발송한다 — "유령".
 *
 * 워커가 16개라서 생기는 문제가 아니다. 읽기와 쓰기가 DB 콜백 경계로
 * 쪼개져 있어 **워커 하나 안에서도** 두 요청이 이벤트 루프에서 교차하면 난다.
 *
 * 그래서 읽기를 여기로 들여왔다. MySQL 은 트랜잭션 + SELECT ... FOR UPDATE 로
 * 그 부모 행을 잡고 읽는다.
 *
 * 실측 — 같은 부모에 구독 12개를 동시에 만들기를 6회, MySQL:
 *     잠그기 전   sub 행 72 / subl 항목 9    -> 63개가 침묵
 *     잠근 뒤     sub 행 72 / subl 항목 72   -> 0
 *
 * 대기(FOR UPDATE)를 쓴다. delete_oldest 는 NOWAIT 로 즉시 스킵하지만 그쪽은
 * CIN 유입마다 도는 자리라 락 컨보이가 문제였다. 구독 생성은 배포 기준 월
 * 150건이라 줄을 서도 된다 — 스킵하면 목록 갱신이 조용히 사라진다.
 *
 * ── SQLite 는 아직 막지 못한다 ──────────────────────────────────────
 * mobius/db/sqlite.js 가 transaction / rowLock 을 둘 다 false 로 선언한다.
 * 워커당 핸들이 하나뿐이라 비동기 호출이 겹치면 서로 다른 논리적 트랜잭션이
 * 같은 핸들에서 뒤섞이기 때문이다. BEGIN IMMEDIATE 로 파일 락을 잡는 것도
 * 답이 아니다 — 그 사이 같은 핸들로 나가는 **무관한 질의까지** 그 트랜잭션에
 * 끌려들어가고, 롤백하면 남의 삽입이 함께 사라진다.
 *
 * 그래서 SQLite 에서는 잠금 없이 읽고 쓴다. 같은 부모에 구독을 동시에 만들면
 * 하나가 사라진다 — 위와 같은 시험에서 72개 중 52개를 잃었다. 고치려면
 * 어댑터에 핸들 풀이나 직렬화 큐가 필요하다(sqlite.js 가 "후속 작업" 으로
 * 적어 둔 것). 배포는 MySQL 이고 SQLite 는 임베디드 규모라 여기서 멈춘다.
 * **모른 채 두지 않는다** — test/sgn-subl-entry.test.js 가 이 한계를 못박는다.
 */
exports.update_subl = function (connection, ri, mutate, callback) {
    function apply(conn, done) {
        var qb = facade.k('lookup').select('subl').where({ ri: ri });
        if (facade.can('rowLock')) { qb = qb.forUpdate(); }

        facade.run(qb, conn, function (err, rows) {
            if (err) { return done(err, rows); }
            if (!rows || rows.length === 0) {
                // 부모 행이 없다. 자식이 지워지는 중이거나 이미 지워졌다.
                // 성공으로 두면 호출부가 목록이 갱신된 줄 안다.
                return done('404', { code: '404-1', message: 'parent gone: ' + ri });
            }

            var list = [];
            var raw = rows[0].subl;
            if (raw !== null && raw !== undefined && String(raw) !== '') {
                try {
                    var parsed = JSON.parse(String(raw));
                    if (Array.isArray(parsed)) { list = parsed; }
                    else {
                        console.error('[update_subl] subl 이 배열이 아니다 — 새로 만든다: ' + ri);
                    }
                }
                catch (e) {
                    // 못 읽는 목록은 발송기도 못 쓴다(subl.read 가 항목마다
                    // 걸러낸다). 여기서 새로 만드는 것이 수리다. 다만 무엇을
                    // 잃는지 모르므로 반드시 남긴다.
                    console.error('[update_subl] subl 을 읽을 수 없어 새로 만든다: ' + ri +
                                  ' (' + e.message + ')');
                }
            }

            var next;
            try { next = mutate(list); }
            catch (e2) { return done(e2, { code: '500-4', message: e2.message }); }
            if (!Array.isArray(next)) { next = []; }

            facade.run(facade.k('lookup').update({ subl: JSON.stringify(next) })
                             .where({ ri: ri }), conn, done);
        });
    }

    if (facade.can('transaction')) {
        facade.transaction(connection, apply, callback);
    }
    else {
        apply(connection, callback);
    }
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

// ---------------------------------------------------------------------------
// 본문 테이블 하나짜리 리소스의 수정
//
// 생성(BODY_TABLES)과 짝이다. 아홉 곳이 전부 같은 모양이었다:
//   lookup 을 고치고 -> 본문 테이블을 고친다.
//
// 생성과 달리 되돌리기가 없다. 옛 코드도 그랬다 — 본문 UPDATE 가 실패하면
// lookup 의 lt/st 만 바뀐 채로 남는다. 여기서 고치지 않는다. 트랜잭션 없이
// 두 문장을 묶을 방법이 없고, 그것은 이 전환의 범위가 아니다.
//
// **컬럼 목록이 생성과 다르다.** 생성은 전체 컬럼, 수정은 바꿀 수 있는
// 컬럼만이다 (예: mgo 는 생성이 mgd/objs/obps 까지 넣지만 수정은 안 건드린다).
// 그래서 표를 따로 둔다.
//
//   [테이블, set 할 컬럼(공백 구분), JSON 으로 저장할 컬럼]
var BODY_UPDATES = {
    update_fwr: ['mgo', 'dc vr fwnnam url ud uds', 'uds'],
    update_bat: ['mgo', 'dc btl bts'],
    update_dvi: ['mgo', 'dc dbl man mod dty fwv swv hwv'],
    update_dvc: ['mgo', 'dc can att cas cus ena dis', 'cas'],
    update_rbo: ['mgo', 'dc rbo far'],
    update_nod: ['nod', 'ni mgca'],
    update_csr: ['csr', 'poa mei tri rr nl', 'poa'],
    update_smd: ['smd', 'dsp dcrp soe rels or', 'rels'],
    update_mms: ['mms', 'stid asd osd sst']
};

function make_body_update(name, table, cols, json_cols) {
    return function (connection, obj, callback) {
        var label = name + ' ' + obj.ri;
        console.time(label);

        _this.update_lookup(connection, obj, function (err, results) {
            if (err) {
                callback(err, results);
                return;
            }

            var row = {};
            cols.forEach(function (c) {
                // 생성 쪽과 달리 || [] 를 붙이지 않는다. 옛 코드가
                // JSON.stringify(obj.x) 를 그대로 썼고, 여기서 기본값을
                // 만들어 주면 "안 보낸 속성" 이 빈 배열로 덮인다.
                if (json_cols.indexOf(c) >= 0) {
                    row[c] = JSON.stringify(obj[c]);
                    return;
                }
                // 생성 쪽과 같은 이유로 undefined/null 을 빈 문자열로 둔다 —
                // 빌더가 NULL 로 보내면 NOT NULL 컬럼에서 그대로 실패한다.
                row[c] = (obj[c] === undefined || obj[c] === null) ? '' : obj[c];
            });

            facade.run(facade.k(table).update(row).where({ ri: obj.ri }), connection,
                function (err2, results2) {
                    console.timeEnd(label);
                    callback(err2, results2);
                });
        });
    };
}

Object.keys(BODY_UPDATES).forEach(function (name) {
    var t = BODY_UPDATES[name];
    exports[name] = make_body_update(
        name, t[0], t[1].split(' '), (t[2] || '').split(' ').filter(Boolean));
});
// ---------------------------------------------------------------------------

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

// CIN 하나가 생겼을 때 부모 컨테이너의 카운터를 올린다.
//
// ── 왜 인라인인가 (예전에는 debounce 배치였다) ──────────────────────────
//
// cnt_man 이라는 모듈이 pi 별로 델타를 메모리에 모아 1초 debounce 로 flush 했다.
// 쓰기 증폭을 줄이려는 것이었는데, 배포 실측이 그 전제를 무너뜨렸다:
//
//     전체 요청량   308,425/일 = 3.6건/초   (모든 메서드·모든 타입 합계)
//     컨테이너 수   30,284개
//
// CIN 생성은 그 부분집합이므로 카운터 행 하나가 받는 쓰기는 초당 1건에도
// 한참 못 미친다. **묶을 것이 없다.** 대신 debounce 는 대가를 치르고 있었다:
//
//   - 델타가 순수 인메모리이고 종료 훅이 없어, 재시작하면 최대 11초분이
//     사라졌다. 배포 드리프트(컨테이너 30,278개 중 1,659개 = 5.5%)의 원인 중
//     하나가 이것이다.
//   - flush 마다 풀에서 커넥션을 따로 빌렸다.
//   - debounce 창의 첫 CIN 시점 사본으로 한도를 판정해, 그 사이 클라이언트가
//     mni 를 낮춰도 옛 값을 봤다.
//
// 그래서 요청 커넥션에서 그 자리에서 올린다. 문장 두 개, 둘 다 PK 인덱스다.
//
// ── 왜 두 문장인가 ─────────────────────────────────────────────────────
//
// 예전 MySQL 코드는 `update cnt, lookup set ...` 다중 테이블 UPDATE 였다.
// 그것은 크로스 조인이라 **두 행이 다 있을 때만** 갱신된다 — cnt 행 없는
// lookup 고아에서 st 만 오르는 것을 막는 성질이다.
//
// 같은 의미를 백엔드 중립으로 쓰는 방법이 바로 아래 update_parent_st 에 있다:
// whereExists 가드. 그것을 그대로 쓴다. 다중 테이블 UPDATE 는 MySQL 전용이고,
// 그 하나 때문에 이 파일에 usesqlite 분기가 남아 있었다.
// 한도를 넘긴 컨테이너를 찾는다. 보존 정책 스윕의 첫 단계다.
//
// ── 왜 스윕인가 (예전에는 CIN 삽입마다 판정했다) ────────────────────────
//
// 예전에는 CIN 이 들어올 때마다 그 컨테이너의 한도를 그 자리에서 판정하고,
// 넘었으면 그 요청을 처리하던 워커가 삭제까지 했다. 워커가 25개이므로
// **같은 컨테이너를 여러 워커가 동시에 정리**할 수 있었고, 그래서
// delete_oldest 는 트랜잭션 + SELECT ... FOR UPDATE NOWAIT 로 서로를
// 막아야 했다. 그 잠금이 다시 락 컨보이를 만들어 ER_LOCK_WAIT_TIMEOUT 이
// 390건 났고(2026-08-25 실측), NOWAIT 으로 바꾼 것이 그 대응이었다.
//
// **그리고 잠금이 없는 백엔드는 그 알고리즘을 쓸 수 없어서 SQLite 는 아예
// 다른 갈래를 갖고 있었다.** 코어에 usesqlite 분기가 남은 마지막 이유다.
//
// 정리하는 주체를 하나로 만들면 그 사슬이 뿌리에서 끊긴다. 워커 경쟁이
// 없으니 행 잠금이 필요 없고, 잠금이 없으니 백엔드를 가를 이유가 없다.
//
// 비용은 실측했다 — 배포 서버에서 이 질의가 **13ms**, cnt 30,284행 전수.
// 한 번에 걸리는 컨테이너는 14개였다. 컬럼끼리 비교라 인덱스를 못 타지만
// 그 규모에서는 문제가 되지 않는다.
// 보존 정책 스윕 한 바퀴. 한도를 넘긴 컨테이너를 찾아 오래된 자식부터 지운다.
//
// **마스터에서만 돈다** (app.js). 정리하는 주체가 하나라는 것이 이 설계의
// 전부다 — 그래야 delete_oldest 가 잠금 없이 단순해진다.
//
// 한 컨테이너를 완전히 정리하지 않고 한 바퀴에 MAX_PURGE_PER_PASS 만큼만
// 지운다. 남으면 다음 바퀴가 이어서 한다. 삭제 I/O 가 상한이라 한 번에
// 많이 지워도 총 시간은 같고, 그 사이 다른 컨테이너가 밀리기만 한다.
exports.purge_sweep = function (connection, opts, callback) {
    var o = opts || {};
    var limit = o.limit || 100;
    var report = { scanned: 0, purged: 0, deleted: 0, failed: 0 };

    _this.select_over_limit(connection, limit, function (err, rows) {
        if (err) { return callback(err, rows); }
        report.scanned = rows.length;
        if (!rows.length) { return callback(null, report); }

        var i = 0;
        (function next() {
            if (i >= rows.length) { return callback(null, report); }
            var r = rows[i];
            i++;

            // SQLite 스키마는 이 다섯이 TEXT 라 문자열로 온다. 숫자로 바꿔야
            // purge_plan 의 비교와 뺄셈이 맞는다 ('9' > '10' 이 참이 되는 문제).
            var cni = parseInt(r.cni || 0, 10);
            var cbs = parseInt(r.cbs || 0, 10);

            // **한도에는 `|| 0` 을 쓰지 않는다.** mni 가 NULL 일 때 0 이 되면
            // 그것은 "한도 0" 즉 **자식을 전부 지우라**는 뜻이 된다. 모르는 값을
            // 가장 파괴적인 값으로 번역하는 셈이다. NaN 으로 두면 delete_oldest 가
            // "한도를 모른다" 로 보고 한 건도 지우지 않는다.
            var mni = parseInt(r.mni, 10);
            var mbs = parseInt(r.mbs, 10);
            if (!isFinite(mni) || !isFinite(mbs)) {
                report.failed++;
                console.error('[purge_sweep] 한도가 비어 있다 — 건너뛴다 ri=' + r.ri +
                              ' mni=' + r.mni + ' mbs=' + r.mbs);
                return next();
            }

            var plan = _this.purge_plan(cni, cbs, mni, mbs);
            var count = plan.est_count < 1 ? 1 : plan.est_count;

            console.log('[purge_sweep] ri=' + r.ri + ' cni=' + cni + '/' + mni +
                        ' cbs=' + cbs + '/' + mbs + ' -> 최대 ' + count + '건');

            // mni/mbs 를 함께 넘긴다. delete_oldest 는 이 둘로 **실측을 판정**해서
            // 한도 안이면 한 건도 지우지 않는다. 위 cni/cbs 는 저장값이라
            // 실제보다 클 수 있고(delete_lookup_et 등이 감산하지 않는다),
            // 그것만 믿으면 멀쩡한 컨테이너를 비운다. count 는 상한일 뿐이다.
            delete_oldest(connection, { ri: r.ri, ty: r.ty, mni: mni, mbs: mbs },
                count, function (e, deleted) {
                if (e) {
                    report.failed++;
                    console.error('[purge_sweep] 실패 ri=' + r.ri + ' : ' +
                                  ((deleted && deleted.message) || deleted));
                } else if (deleted) {
                    report.purged++;
                    report.deleted += deleted;
                }
                next();
            });
        })();
    });
};

// 한도를 넘긴 컨테이너 목록. cnt 는 배포 실측 30,284행이라 전수 스캔해도 싸다.
//
// ty 는 cnt 에 없다 — lookup 에만 있다. delete_oldest 가 자식 타입을 ty+1 로
// 구하므로 조인해서 가져온다. (cnt.ri 는 lookup.ri 를 참조하는 PK 라 1:1 이다.)
//
// 비교는 numericExpr 로 감싼다. MySQL 은 cni/mni 가 bigint 라 그냥 되지만
// SQLite 스키마는 전부 TEXT 라서 `cni > mni` 가 사전순이 된다 —
// '9' > '10' 이 참이 되어 한도 안인 컨테이너를 정리 대상으로 잡는다.
exports.select_over_limit = function (connection, limit, callback) {
    var n = parseInt(limit, 10);
    if (!(n > 0)) { n = 100; }

    var num = function (col) { return facade.numericExpr(col); };

    facade.run(facade.k('cnt')
        .join('lookup', 'lookup.ri', 'cnt.ri')
        .select('cnt.ri as ri', 'lookup.ty as ty',
                'cnt.cni as cni', 'cnt.cbs as cbs',
                'cnt.mni as mni', 'cnt.mbs as mbs')
        .where(function () {
            this.whereRaw(num('cnt.cni') + ' > ' + num('cnt.mni'))
                .orWhereRaw(num('cnt.cbs') + ' > ' + num('cnt.mbs'));
        })
        .limit(n), connection, callback);
};

exports.update_parent_counters = function (connection, pi, cs, callback) {
    var n = (typeof cs === 'number' && isFinite(cs)) ? cs : 0;

    facade.run(facade.k('cnt').update({
        cni: facade.raw('cni + 1'),
        cbs: facade.raw('cbs + ?', [n])
    }).where({ ri: pi }), connection, function (err, results) {
        if (err) {
            // 카운터가 어긋나도 CIN 은 이미 저장됐다. 요청을 실패시키지 않는다 —
            // reconcile 이 하루 안에 실측으로 바로잡는다.
            console.error('[update_parent_counters] cnt 갱신 실패 pi=' + pi +
                          ' : ' + ((results && results.message) || results));
            return callback(err, results);
        }

        // 자식이 생겼으니 부모 stateTag 를 올린다. cnt 행이 있을 때만 —
        // 위 UPDATE 와 같은 조건이어야 둘이 갈라지지 않는다.
        facade.run(facade.k('lookup')
            .update({ st: facade.raw('st + 1') })
            .where({ ri: pi })
            .whereExists(facade.k('cnt').select('*').whereRaw('cnt.ri = ?', [pi])),
            connection, function (err2, r2) {
            if (err2) {
                console.error('[update_parent_counters] st 갱신 실패 pi=' + pi +
                              ' : ' + ((r2 && r2.message) || r2));
            }
            callback(err2, r2);
        });
    });
};

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
 * @param opts { batch, scanCap, maxFindings, after, targets }
 *        after 는 앞선 호출의 result.next 를 **그대로** 넘긴다.
 * @returns callback(null, {
 *            findings: [{ ri, pi, nu, reason, severity, detail }],
 *            findingsTruncated, scanned, capped, byReason, bySeverity, next })
 *          next 가 null 이면 다 훑은 것이다.
 *
 * severity 는 SUB_AUDIT_SEVERITY 가 정한다 — broken / suspect 두 값이다.
 * **삭제 후보에는 broken 만 올린다.** 위 표의 주석을 읽을 것.
 * 이 계약을 읽는 쪽(관리 콘솔)이 자체 기준을 만들면 코어와 콘솔이 서로 다른
 * 기준으로 "지워도 되는 구독" 을 말하게 된다.
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
