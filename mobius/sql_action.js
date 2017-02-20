/**
 * Copyright (c) 2016, OCEAN
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

var moment = require('moment');
var util = require('util');

var db = require('./db_action');

var _this = this;

const max_lim = 1000;

exports.select_csr_like = function(cb, callback) {
    var sql = util.format("select * from csr where ri like \'/%s/%%\'", cb);
    db.getResult(sql, '', function (err, results_csr) {
        if (!Array.isArray(results_csr.poa)) {
            results_csr.poa = [];
        }
        callback(err, results_csr);
    });
};

exports.select_csr = function(ri, callback) {
    var sql = util.format("select * from csr where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, results_csr) {
        callback(err, results_csr);
    });
};

exports.search_parents_lookup = function(ri, callback) {
    console.time('search_parents_lookup ' + ri);
    var sql = util.format("select ri from lookup where (ri =\'%s\' or pi=\'%s\' or pi like \'%s/%%\') and ty != \'4\' and ty != \'23\' and ty != \'30\' and ty != \'9\' and ty != \'17\'", ri, ri, ri);
    db.getResult(sql, '', function (err, result_lookup_ri) {
        console.timeEnd('search_parents_lookup ' + ri);
        callback(err, result_lookup_ri);
    });
};

exports.get_sri_shortid = function (ri, callback) {
    var sql = util.format('select sri from sri where ri = \'%s\'', ri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.get_ri_shortid = function (sri, callback) {
    var sql = util.format('select ri from sri where sri = \'%s\'', sri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

function set_sri(ri, sri, callback) {
    var sql = util.format('insert into sri (ri, sri) value (\'%s\', \'%s\')', ri, sri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
}

exports.insert_lookup = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, callback) {
    console.time('insert_lookup ' + ri);
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            set_sri(ri, sri, function (err, results) {
                console.timeEnd('insert_lookup ' + ri);
                callback(err, results);
            });
        }
    });
};

exports.insert_cb = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, cst, csi, srt, poa, nl, ncp, callback) {
    console.time('insert_cb ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into cb (' +
                'ri, cst, csi, srt, poa, nl, ncp) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cst, csi, srt, poa,
                nl, ncp);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_cb ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_acp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, pv, pvs, callback) {
    console.time('insert_acp ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into acp (ri, pv, pvs) ' +
                'value (\'%s\', \'%s\', \'%s\')',
                ri, pv, pvs);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_acp ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_ae = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, apn, api, aei, poa, or, nl, rr, callback) {
    console.time('insert_ae ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into ae (ri, apn, api, aei, poa, ae.or, nl, rr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, apn, api, aei, poa,
                or, nl, rr);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_ae ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_cnt = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, cr, mbs, mia, cni, cbs, li, or, callback) {
    console.time('insert_cnt ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into cnt (ri, cr, mni, mbs, mia, cni, cbs, li, cnt.or) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, mni, mbs, mia,
                cni, cbs, li, or);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_cnt ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_cin = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, cr, cnf, or, con, callback) {
    console.time('insert_cin ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into cin (ri, cr, cnf, cs, cin.or, con) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, cnf, cs, or,
                con);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_cin ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_grp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, cr, mt, cnm, mnm, mid, macp, mtv, csy, gn, callback) {
    console.time('insert_grp ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into grp (ri, cr, mt, cnm, mnm, mid, macp, mtv, csy, gn) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, mt, cnm, mnm,
                mid, macp, mtv, csy, gn);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_grp ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_lcp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, los, lou, lot, lor, loi, lon, lost, callback) {
    console.time('insert_lcp ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into lcp (ri, los, lou, lot, lor, loi, lon, lost) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, los, lou, lot, lor,
                loi, lon, lost);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_lcp ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_csr = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, cst, poa, cb, csi, mei, tri, rr, nl, callback) {
    console.time('insert_csr ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into csr (ri, cst, poa, cb, csi, mei, tri, rr, nl) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cst, poa, cb, csi,
                mei, tri, rr, nl);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_csr ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_req = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, op, tg, org, rid, mi, pc, rs, ors, callback) {
    console.time('insert_req ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into req (ri, op, tg, org, rid, mi, pc, rs, ors) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, op, tg, org, rid, mi, pc, rs, ors);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_req ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_sub = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su, callback) {
    console.time('insert_sub ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into sub (ri, pi, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, pi, enc, exc, nu,
                gpi, nfu, bn, rl, psn,
                pn, nsp, ln, nct, nec,
                cr, su);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_sub ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_sd = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, cr, dspt, or, callback) {
    console.time('insert_sd ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into sd (ri, cr, dspt, sd.or) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, dspt, or);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_sd ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_ts = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, cr, mbs, mia, cni, cbs, or, pei, mdd, mdn, mdl, mdc, mdt, callback) {
    console.time('insert_ts ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into ts (ri, cr, mni, mbs, mia, cni, cbs, ts.or, pei, mdd, mdn, mdl, mdc, mdt) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', ' +
                '\'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, mni, mbs, mia,
                cni, cbs, or, pei, mdd,
                mdn, mdl, mdc, mdt);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_ts ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_tsi = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, dgt, con, sqn, callback) {
    console.time('insert_tsi ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into tsi (ri, dgt, con, sqn) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                ri, dgt, con, sqn);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_tsi ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

exports.insert_mms = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, sid, soid, stid, asd, osd, sst, callback) {
    console.time('insert_mms ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mms (ri, sid, soid, stid, asd, osd, sst) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, sid, soid, stid, asd,
                osd, sst);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_mms ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
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

function build_discovery_sql(ty, lbl, cra, crb, lim, ofst, pi_list, bef_ct, cur_ct) {
//    var list_ri = '';
    var query_where = '';
    var query_count = 0;
    if(lbl != null) {
        query_where = ' where ';
        if(lbl.toString().split(',')[1] == null) {
            query_where += util.format(' a.lbl like \'%%\"%s\"%%\'', lbl);
            //query_where += util.format(' lbl like \'%s\'', request.query.lbl);
        }
        else {
            for(var i = 0; i < lbl.length; i++) {
                query_where += util.format(' a.lbl like \'%%\"%s\"%%\'', lbl[i]);
                //query_where += util.format(' lbl like \'%s\'', request.query.lbl[i]);

                if(i < lbl.length-1) {
                    query_where += ' or ';
                }
            }
        }
        query_count++;
    }

    var ty_str = '';
    if(ty != null) {
        ty_str = ' and ';
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }

        if(ty.toString().split(',').length == 1) {
            query_where += util.format('a.ty = \'%s\'', ty);
            ty_str += util.format('ty = \'%s\'', ty);
        }
        else {
            query_where += ' (';
            ty_str += ' (';
            for(i = 0; i < ty.length; i++) {
                query_where += util.format('a.ty = \'%s\'', ty[i]);
                ty_str += util.format('ty = \'%s\'', ty[i]);
                if(i < ty.length-1) {
                    query_where += ' or ';
                    ty_str += ' or ';
                }
            }
            query_where += ') ';
            ty_str += ') ';
        }
        query_count++;
    }

    if(cra != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format('\'%s\' <= a.ct', cra);
        query_count++;
    }

    if(crb != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format(' a.ct <= \'%s\'', crb);
//        query_count++;
    }

    if(lim != null) {
        if(lim > max_lim) {
            lim = max_lim;
        }
        //query_where += util.format(' order by ri desc limit %s', request.query.lim);
        query_where += util.format(' limit %s', lim);

        if(ofst != null) {
            query_where += util.format(' offset %s', ofst);
        }
    }
    else {
        //query_where += util.format(' order by ri desc limit 1000');
        query_where += util.format(' limit 1000');

        if(ofst != null) {
            query_where += util.format(' offset %s', ofst);
        }
    }

    query_where = util.format("select a.* from (select ri from lookup where (ri in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+") or pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and (ct > \'%s\' and ct <= \'%s\') order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;

    return query_where;
}

exports.search_lookup = function (ty, lbl, cra, crb, lim, ofst, lvl, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, callback) {
    var cur_pi = [];

    if(loop_cnt == 0) {
        loop_cnt++;
        console.time('search_lookup');
    }

    var cur_ct = moment(cur_d).format('YYYYMMDDTHHmmss');
    var bef_d = moment(cur_d).subtract(Math.pow(7, loop_cnt), 'days').format('YYYY-MM-DD HH:mm:ss');
    var bef_ct = moment(bef_d).format('YYYYMMDDTHHmmss');

    //console.log(cur_ct);
    //console.log(bef_ct);

    if(lim != null) {
        if(lim > max_lim) {
            lim = max_lim;
        }
    }
    else {
        lim = max_lim;
    }

    cur_pi.push(pi_list[pi_index]);

    //console.log(loop_cnt + ' - ' + cur_pi);

    /*if(lvl != null) {
        if((cur_pi[0].split('/').length-1) > (parseInt(lvl, 10))) {
            if(++pi_index >= pi_list.length) {
                if(++loop_cnt >= 4) {
                    console.timeEnd('search_lookup');
                    callback(err, found_Obj);
                }
                else {
                    pi_index = 0;
                    //cur_d.setDate(bef_d.getDate());
                    cur_d = bef_d;
                    _this.search_lookup(ty, lbl, cra, crb, lim, ofst, lvl, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, function (err, found_Obj) {
                        callback(err, found_Obj);
                    });
                    return;
                }
            }
            else {
                _this.search_lookup(ty, lbl, cra, crb, lim, ofst, lvl, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, function (err, found_Obj) {
                    callback(err, found_Obj);
                });
                return;
            }
        }
    }*/

    var sql = build_discovery_sql(ty, lbl, cra, crb, lim, ofst, cur_pi, bef_ct, cur_ct);
    //console.log(sql);
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            //make_json_arraytype(search_Obj);
            for(var i = 0; i < search_Obj.length; i++) {
                found_Obj[found_Cnt++] = search_Obj[i];
                if(found_Cnt >= lim) {
                    console.timeEnd('search_lookup');
                    callback(err, found_Obj);
                    return;
                }
            }

            if(++pi_index >= pi_list.length) {
                if(++loop_cnt >= 4) {
                    console.timeEnd('search_lookup');
                    callback(err, found_Obj);
                }
                else {
                    pi_index = 0;
                    //cur_d.setDate(bef_d.getDate());
                    cur_d = bef_d;
                    setTimeout( function() {
                        _this.search_lookup(ty, lbl, cra, crb, lim, ofst, lvl, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, function (err, found_Obj) {
                            callback(err, found_Obj);
                        });
                    }, 0);
                }
            }
            else {
                setTimeout( function() {
                    _this.search_lookup(ty, lbl, cra, crb, lim, ofst, lvl, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, function (err, found_Obj) {
                        callback(err, found_Obj);
                    });
                }, 0);
            }
        }
        else {
            callback(err, search_Obj);
        }
    });
};

exports.select_latest_lookup = function(ri, cur_d, loop_cnt, ty, callback) {
    if(loop_cnt++ == 0) {
        console.time('select_latest ' + ri);
    }

    var bef_d = moment(cur_d).subtract(Math.pow(2,loop_cnt), 'days').format('YYYY-MM-DD HH:mm:ss');
    var bef_ct = moment(bef_d).format('YYYYMMDDTHHmmss');

    var sql = util.format('select a.* from (select ri from lookup where (pi = \'%s\') and ct > \'%s\' order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri where a.ty = \'%s\' limit 1', ri, bef_ct, ty);
    db.getResult(sql, '', function (err, latest_Obj) {
        if(!err) {
            if(latest_Obj.length == 1) {
                console.timeEnd('select_latest ' + ri);
                callback(err, latest_Obj);
            }
            else {
                if(loop_cnt > 8) {
                    callback(err, latest_Obj);
                }
                else {
                    cur_d = bef_d;
                    _this.select_latest_lookup(ri, cur_d, loop_cnt, ty, function(err, latest_Obj) {
                        callback(err, latest_Obj);
                    });
                }
            }
        }
        else {
            console.timeEnd('select_latest ' + ri);
            callback(err, latest_Obj);
        }
    });
};

exports.select_oldest_lookup = function(ri, callback) {
    console.time('select_oldest ' + ri);
    var sql = util.format('select a.* from (select ri from lookup where (pi = \'%s\') limit 1000) b left join lookup as a on b.ri = a.ri where a.ty = \'4\' or a.ty = \'30\' limit 1', ri);
    db.getResult(sql, '', function (err, oldest_Obj) {
        console.timeEnd('select_oldest ' + ri);
        callback(err, oldest_Obj);
    });
};

exports.select_direct_lookup = function(ri, callback) {
    var tid = require('shortid').generate();
    console.time('select_direct ' + ri + ' (' + tid + ')');
    var sql = util.format("select * from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, direct_Obj) {
        console.timeEnd('select_direct ' + ri + ' (' + tid + ')');
        callback(err, direct_Obj);
    });
};

exports.select_resource = function(ty, ri, callback) {
    console.time('select_resource '+ ty + ' ' + ri);
    var sql = util.format("select * from " + ty + " where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, rsc_Obj) {
        console.timeEnd('select_resource ' + ty + ' ' + ri);
        callback(err, rsc_Obj);
    });
};

exports.select_ri_lookup = function(ri, callback) {
    console.time('select_ri_lookup ' + ri);
    var sql = util.format("select ri from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, ri_Obj) {
        console.timeEnd('select_ri_lookup ' + ri);
        callback(err, ri_Obj);
    });
};

exports.select_grp_lookup = function(ri, callback) {
    console.time('select_group ' + ri);
    var sql = util.format("select * from lookup where ri = \'%s\' and ty = '9'", ri);
    db.getResult(sql, '', function (err, group_Obj) {
        console.timeEnd('select_group ' + ri);
        callback(err, group_Obj);
    });
};

exports.select_grp = function(ri, callback) {
    var sql = util.format("select * from grp where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, grp_Obj) {
        callback(err, grp_Obj);
    });
};

exports.select_acp = function(ri, callback) {
    var sql = util.format("select * from acp where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, results_acp) {
        callback(err, results_acp);
    });
};

exports.select_acp_in = function(acpiList, callback) {
    var sql = util.format("select * from acp where ri in (" + JSON.stringify(acpiList).replace('[', '').replace(']', '') + ")");
    db.getResult(sql, '', function (err, results_acp) {
        callback(err, results_acp);
    });
};

exports.select_sub = function(pi, callback) {
    var sql = util.format('select * from sub where pi = \'%s\'', pi);
    db.getResult(sql, '', function (err, results_ss) {
        callback(err, results_ss);
    });
};

exports.select_cb = function(ri, callback) {
    var sql = util.format("select * from cb where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, results_cb) {
        callback(err, results_cb);
    });
};

exports.select_cni_parent = function (ty, pi, callback) {
    if(ty == '4') {
        var sql = util.format("select cni, cbs, st from cnt, lookup where cnt.ri = \'%s\' and lookup.ri = \'%s\'", pi, pi);
    }
    else {
        sql = util.format("select cni, cbs, st from ts, lookup where ts.ri = \'%s\' and lookup.ri = \'%s\'", pi, pi);
    }

    db.getResult(sql, '', function (err, results_cni) {
        callback(err, results_cni);
    });
};

exports.select_cs_parent = function (ty, pi, callback) {
    var sql = util.format("select ri, cs from lookup where pi = \'%s\' and ty = \'%s\' order by ri asc limit 1", pi, ty);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.select_ts = function (ri, callback) {
    var sql = util.format("select * from ts where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, ts_Obj) {
        callback(err, ts_Obj);
    });
};

exports.select_in_ri_list = function (tbl, ri_list, callback) {
    var sql = util.format("select * from " + tbl + " where ri in ("+JSON.stringify(ri_list).replace('[','').replace(']','')+")");
    db.getResult(sql, '', function (err, search_Obj) {
        callback(err, search_Obj);
    });
};


exports.select_ts_in = function (ri_list, callback) {
    var sql = util.format("select * from ts where ri in ("+JSON.stringify(ri_list).replace('[','').replace(']','') + ")");
    db.getResult(sql, '', function (err, ts_Obj) {
        callback(err, ts_Obj);
    });

};

exports.select_count_ri = function (ty, ri, callback) {
    var sql = util.format("select count(ri), sum(cs) from lookup where pi = \'%s\' and ty = \'%s\'", ri, ty);
    //console.log(sql);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};


exports.update_ts_mdcn_mdl = function (mdc, mdl, ri, callback) {
    var sql = util.format("update ts set mdc = \'%s\', mdl = \'%s\' where ri = \'%s\'", mdc, mdl, ri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.update_cb_poa_csi = function (poa, csi, ri, callback) {
    console.time('update_cb_poa_csi ' + ri);
    var sql = util.format('update cb set poa = \'%s\', csi = \'%s\' where ri=\'%s\'', poa, csi, ri);
    db.getResult(sql, '', function (err, results) {
        console.timeEnd('update_cb_poa_csi ' + ri);
        callback(err, results);
    });
};

exports.update_st_lookup = function (st, ri, callback) {
    console.time('update_st_lookup ' + ri);
    var sql = util.format('update lookup set st = \'%s\' where ri=\'%s\'', st, ri);
    db.getResult(sql, '', function (err, results) {
        console.timeEnd('update_st_lookup ' + ri);
        callback(err, results);
    });
};

exports.update_acp = function (lt, acpi, et, st, lbl, at, aa, mni, ri, pv, pvs, callback) {
    console.time('update_acp ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update acp set pv = \'%s\', pvs = \'%s\' where ri = \'%s\'',
                pv, pvs, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_acp ' + ri);
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

exports.update_ae = function (lt, acpi, et, st, lbl, at, aa, mni, ri, apn, poa, or, rr, callback) {
    console.time('update_ae ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update ae set apn = \'%s\', poa = \'%s\', ae.or = \'%s\', rr = \'%s\' where ri = \'%s\'',
                apn, poa, or, rr, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_ae ' + ri);
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

exports.update_cnt = function (lt, acpi, et, st, lbl, at, aa, mni, ri, mbs, mia, li, or, callback) {
    console.time('update_cnt ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update cnt set mni = \'%s\', mbs = \'%s\', mia = \'%s\', li = \'%s\', cnt.or = \'%s\' where ri = \'%s\'',
                mni, mbs, mia, li, or, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_cnt ' + ri);
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

exports.update_grp = function (lt, acpi, et, st, lbl, at, aa, mni, ri, mnm, mid, macp, gn, callback) {
    console.time('update_grp ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update grp set mnm = \'%s\', mid = \'%s\', macp = \'%s\', gn = \'%s\' where ri = \'%s\'',
                mnm, mid, macp, gn, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_grp ' + ri);
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

exports.update_lcp = function (lt, acpi, et, st, lbl, at, aa, mni, ri, lou, lon, callback) {
    console.time('update_lcp ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update lcp set lou = \'%s\', lon = \'%s\' where ri = \'%s\'',
                lou, lon, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_lcp ' + ri);
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

exports.update_csr = function (lt, acpi, et, st, lbl, at, aa, mni, ri, poa, mei, tri, rr, nl, callback) {
    console.time('update_csr ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update csr set poa = \'%s\', mei = \'%s\', tri = \'%s\', rr = \'%s\', nl = \'%s\' where ri = \'%s\'',
                poa, mei, tri, rr, nl, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_csr ' + ri);
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

exports.update_req = function (ri, pc, rs, callback) {
    console.time('update_req ' + ri);
    //var sql2 = util.format('update req set pc = \'%s\', rs = \'%s\' where ri = \'%s\'', (new Buffer(pc)).toString('base64'), rs, ri);
    var sql2 = util.format('update req set pc = \'%s\', rs = \'%s\' where ri = \'%s\'', pc, rs, ri);
    db.getResult(sql2, '', function (err, results) {
        if (!err) {
            console.timeEnd('update_req ' + ri);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_sub = function (lt, acpi, et, st, lbl, at, aa, mni, ri, enc, exc, nu, gpi, nfu, bn, rl, pn, nsp, ln, nct, nec, callback) {
    console.time('update_sub ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update sub set enc = \'%s\', exc = \'%s\', nu = \'%s\', gpi = \'%s\', nfu = \'%s\', bn = \'%s\', rl = \'%s\', pn = \'%s\', nsp = \'%s\', ln = \'%s\', nct = \'%s\', nec = \'%s\' where ri = \'%s\'',
                enc, exc, nu, gpi, nfu, bn, rl, pn, nsp, ln, nct, nec, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_sub ' + ri);
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

exports.update_sd = function (lt, acpi, et, st, lbl, at, aa, mni, ri, dspt, or, callback) {
    console.time('update_sd ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update sd set dspt = \'%s\', sd.or = \'%s\' where ri = \'%s\'',
                dspt, or, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_sd ' + ri);
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

exports.update_ts = function (lt, acpi, et, st, lbl, at, aa, mni, ri, mbs, mia, or, mdn, mdt, mdl, mdc, callback) {
    console.time('update_ts ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update ts set mni = \'%s\', mbs = \'%s\', mia = \'%s\', ts.or = \'%s\', mdn = \'%s\', mdt = \'%s\', mdl = \'%s\', mdc = \'%s\'  where ri = \'%s\'',
                mni, mbs, mia, or, mdn, mdt, mdl, mdc, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_ts ' + ri);
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

exports.update_mms = function (lt, acpi, et, st, lbl, at, aa, mni, ri, stid, asd, osd, sst, callback) {
    console.time('update_mms ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update mms set stid = \'%s\', asd = \'%s\', osd = \'%s\', sst = \'%s\' where ri = \'%s\'',
                stid, asd, osd, sst, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_mms ' + ri);
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

exports.update_cni_parent = function (ty, cni, cbs, st, pi, callback) {
    if (ty == '4') {
        var sql = util.format("update cnt, lookup set cnt.cni = \'%s\', cnt.cbs = \'%s\', lookup.st = \'%s\'  where cnt.ri = \'%s\' and lookup.ri = \'%s\'", cni, cbs, st, pi, pi);
    }
    else {
        sql = util.format("update ts, lookup set ts.cni = \'%s\', ts.cbs = \'%s\', lookup.st = \'%s\'  where ts.ri = \'%s\' and lookup.ri = \'%s\'", cni, cbs, st, pi, pi);
    }

    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.update_cni_ri = function (ty, ri, cni, cbs, callback) {
    if (ty == '4') {
        sql = util.format("update cnt set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cni, cbs, ri);
    }
    else {
        sql = util.format("update ts set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cni, cbs, ri);
    }

    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};



exports.delete_ri_lookup = function (ri, callback) {
    var sql = util.format("delete from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, delete_Obj) {
        if(!err) {
            callback(err, delete_Obj);
        }
    });
};

exports.delete_ri_lookup_in = function (ty, ri, offset, callback) {
    var sql = util.format("DELETE FROM lookup WHERE pi = \'%s\' and ty = \'%s\' LIMIT %d", ri, ty, offset);
    //console.log(sql);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.delete_lookup = function (ri, pi_list, pi_index, found_Obj, found_Cnt, callback) {
    var cur_pi = [];
    cur_pi.push(pi_list[pi_index]);

    if(pi_index == 0) {
        console.time('delete_lookup ' + ri);
    }

    var sql = util.format("delete a.* from (select ri from lookup where pi in ("+JSON.stringify(cur_pi).replace('[','').replace(']','') + ")) b left join lookup as a on b.ri = a.ri");
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            found_Cnt += search_Obj.affectedRows;
            if(++pi_index >= pi_list.length) {
                sql = util.format("delete from lookup where ri = \'%s\'", pi_list[0]);
                db.getResult(sql, '', function (err, search_Obj) {
                    if(!err) {
                        console.timeEnd('delete_lookup ' + ri);
                        found_Cnt += search_Obj.affectedRows;
                        console.log('deleted ' + found_Cnt + ' resource(s).');
                        callback(err, found_Obj);
                    }
                    else {
                        callback(err, search_Obj);
                    }
                });
            }
            else {
                _this.delete_lookup(ri, pi_list, pi_index, found_Obj, found_Cnt, function (err, found_Obj) {
                    callback(err, found_Obj);
                });
            }
        }
    });
};
