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

var util = require('util');
var moment = require('moment');

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
    console.time('search_parents_lookup');
    var sql = util.format("select ri from lookup where (ri =\'%s\' or pi=\'%s\' or pi like \'%s/%%\') and ty != \'4\'", ri, ri, ri);
    db.getResult(sql, '', function (err, result_lookup_ri) {
        console.timeEnd('search_parents_lookup');
        callback(err, result_lookup_ri);
    });
};

exports.insert_lookup = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, callback) {
    console.time('insert_lookup');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        console.timeEnd('insert_lookup');
        callback(err, results);
    });
};

exports.insert_cb = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, cst, csi, srt, poa, nl, ncp, callback) {
    console.time('insert_cb');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into cb (' +
                'ri, cst, csi, srt, poa, nl, ncp) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cst, csi, srt, poa,
                nl, ncp);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_cb');
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

exports.insert_acp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, pv, pvs, callback) {
    console.time('insert_acp');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into acp (ri, pv, pvs) ' +
                'value (\'%s\', \'%s\', \'%s\')',
                ri, pv, pvs);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_acp');
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

exports.insert_ae = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, apn, api, aei, poa, or, nl, rr, callback) {
    console.time('insert_ae');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into ae (ri, apn, api, aei, poa, ae.or, nl, rr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, apn, api, aei, poa,
                or, nl, rr);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_ae');
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

exports.insert_cnt = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, cr, mbs, mia, cni, cbs, li, or, callback) {
    console.time('insert_cnt');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into cnt (ri, cr, mni, mbs, mia, cni, cbs, li, cnt.or) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, mni, mbs, mia,
                cni, cbs, li, or);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_cnt');
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

exports.insert_cin = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, cr, cnf, or, con, callback) {
    console.time('insert_cin');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into cin (ri, cr, cnf, cs, cin.or, con) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, cnf, cs, or,
                con);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_cin');
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

exports.insert_grp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, cr, mt, cnm, mnm, mid, macp, mtv, csy, gn, callback) {
    console.time('insert_grp');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into grp (ri, cr, mt, cnm, mnm, mid, macp, mtv, csy, gn) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, mt, cnm, mnm,
                mid, macp, mtv, csy, gn);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_grp');
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

exports.insert_lcp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, los, lou, lot, lor, loi, lon, lost, callback) {
    console.time('insert_lcp');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into lcp (ri, los, lou, lot, lor, loi, lon, lost) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, los, lou, lot, lor,
                loi, lon, lost);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_lcp');
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

exports.insert_csr = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, cst, poa, cb, csi, mei, tri, rr, nl, callback) {
    console.time('insert_csr');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into csr (ri, cst, poa, cb, csi, mei, tri, rr, nl) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cst, poa, cb, csi,
                mei, tri, rr, nl);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_csr');
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

exports.insert_sub = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su, callback) {
    console.time('insert_sub');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into sub (ri, pi, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, pi, enc, exc, nu,
                gpi, nfu, bn, rl, psn,
                pn, nsp, ln, nct, nec,
                cr, su);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_sub');
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

exports.insert_sd = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, cr, dspt, or, callback) {
    console.time('insert_sd');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into sd (ri, cr, dspt, sd.or) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, dspt, or);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_sd');
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

exports.insert_ts = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, cr, mbs, mia, cni, cbs, or, pin, mdd, mdmn, mdl, mdcn, mddt, callback) {
    console.time('insert_ts');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into ts (ri, cr, mni, mbs, mia, cni, cbs, ts.or, pin, mdd, mdmn, mdl, mdcn, mddt) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', ' +
                '\'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, mni, mbs, mia,
                cni, cbs, or, pin, mdd,
                mdmn, mdl, mdcn, mddt);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_ts');
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

exports.insert_tsi = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, dgt, con, sqn, callback) {
    console.time('insert_tsi');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into tsi (ri, dgt, con, sqn) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                ri, dgt, con, sqn);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_tsi');
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

exports.insert_mms = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs, sid, soid, stid, asd, osd, sst, callback) {
    console.time('insert_mms');
    var sql = util.format('insert into lookup (' +
        'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs);
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            sql = util.format('insert into mms (ri, sid, soid, stid, asd, osd, sst) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, sid, soid, stid, asd,
                osd, sst);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_mms');
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

function build_discovery_sql(ty, lbl, cra, crb, lim, pi_list, bef_ct, cur_ct) {
//    var list_ri = '';
    var query_where = '';
    var query_count = 0;
    if(lbl != null) {
        query_where = ' where ';
        if(lbl.toString().split(',')[1] == null) {
            query_where += util.format(' a.lbl like \'%%%s%%\'', lbl);
            //query_where += util.format(' lbl like \'%s\'', request.query.lbl);
        }
        else {
            for(var i = 0; i < lbl.length; i++) {
                query_where += util.format(' a.lbl like \'%%%s%%\'', lbl[i]);
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
        else if(query_count > 0) {
            query_where += ' and ';
        }
        if(ty.toString().split(',')[1] == null) {
            query_where += util.format('a.ty = \'%s\'', ty);
            ty_str += util.format('ty = \'%s\'', ty);
        }
        else {
            for(i = 0; i < ty.length; i++) {
                query_where += util.format('a.ty = \'%s\'', ty[i]);
                ty_str += util.format('ty = \'%s\'', ty[i]);
                if(i < ty.length-1) {
                    query_where += ' or ';
                    ty_str += ' or ';
                }
            }
        }
        query_count++;
    }

    if(cra != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else if(query_count > 0) {
            query_where += ' and ';
        }
        query_where += util.format('\'%s\' <= a.ct', cra);
        query_count++;
    }

    if(crb != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else if(query_count > 0) {
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
    }
    else {
        //query_where += util.format(' order by ri desc limit 1000');
        query_where += util.format(' limit 1000');
    }

    query_where = util.format("select a.* from (select ri from lookup where pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+") %s and (ct > \'%s\' and ct <= \'%s\') order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;

    return query_where;
}

exports.search_lookup = function (ty, lbl, cra, crb, lim, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, callback) {
    var cur_pi = [];

    if(loop_cnt == 0) {
        loop_cnt++;
        console.time('search_lookup');
    }

    var cur_ct = moment(cur_d).format('YYYYMMDDTHHmmss');
    var bef_d = moment(cur_d).subtract(Math.pow(3,loop_cnt), 'days').format('YYYY-MM-DD HH:mm:ss');
    var bef_ct = moment(bef_d).format('YYYYMMDDTHHmmss');

    if(lim != null) {
        if(lim > max_lim) {
            lim = max_lim;
        }
    }
    else {
        lim = 1000;
    }

    cur_pi.push(pi_list[pi_index]);

    var sql = build_discovery_sql(ty, lbl, cra, crb, lim, cur_pi, bef_ct, cur_ct);
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            for(var i = 0; i < search_Obj.length; i++) {
                found_Obj[found_Cnt++] = search_Obj[i];
                if(found_Cnt >= lim) {
                    console.timeEnd('search_lookup');
                    callback(err, found_Obj);
                    return;
                }
            }

            if(++pi_index >= pi_list.length) {
                if(++loop_cnt > 5) {
                    console.timeEnd('search_lookup');
                    callback(err, found_Obj);
                }
                else {
                    pi_index = 0;
                    //cur_d.setDate(bef_d.getDate());
                    cur_d = bef_d;
                    _this.search_lookup(ty, lbl, cra, crb, lim, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, function (err, found_Obj) {
                        callback(err, found_Obj);
                    });
                }
            }
            else {
                _this.search_lookup(ty, lbl, cra, crb, lim, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, function (err, found_Obj) {
                    callback(err, found_Obj);
                });
            }
        }
        else {
            callback(err, search_Obj);
        }
    });
};

exports.select_latest_lookup = function(ri, cur_d, loop_cnt, ty, callback) {
    if(loop_cnt++ == 0) {
        console.time('select_latest');
    }

    var bef_d = moment(cur_d).subtract(Math.pow(2,loop_cnt), 'days').format('YYYY-MM-DD HH:mm:ss');
    var bef_ct = moment(bef_d).format('YYYYMMDDTHHmmss');

    var sql = util.format('select a.* from (select ri from lookup where (pi = \'%s\') and ct > \'%s\' order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri where a.ty = \'%s\' limit 1', ri, bef_ct, ty);
    db.getResult(sql, '', function (err, latest_Obj) {
        if(!err) {
            if(latest_Obj.length == 1) {
                console.timeEnd('select_latest');
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
            console.timeEnd('select_latest');
            callback(err, latest_Obj);
        }
    });
};

exports.select_oldest_lookup = function(ri, callback) {
    console.time('select_oldest');
    var sql = util.format('select a.* from (select ri from lookup where (pi = \'%s\') limit 1000) b left join lookup as a on b.ri = a.ri where a.ty = \'4\' or a.ty = \'26\' limit 1', ri);
    db.getResult(sql, '', function (err, oldest_Obj) {
        console.timeEnd('select_oldest');
        callback(err, oldest_Obj);
    });
};

exports.select_direct_lookup = function(ri, callback) {
    console.time('select_direct');
    var sql = util.format("select * from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, direct_Obj) {
        console.timeEnd('select_direct');
        callback(err, direct_Obj);
    });
};

exports.select_ri_lookup = function(ri, callback) {
    console.time('select_ri_lookup');
    var sql = util.format("select ri from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, ri_Obj) {
        console.timeEnd('select_ri_lookup');
        callback(err, ri_Obj);
    });
};

exports.select_grp_lookup = function(ri, callback) {
    console.time('select_group');
    var sql = util.format("select * from lookup where ri = \'%s\' and ty = '9'", ri);
    db.getResult(sql, '', function (err, group_Obj) {
        console.timeEnd('select_group');
        callback(err, group_Obj);
    });
};

exports.select_grp = function(ri, callback) {
    var sql = util.format("select * from grp where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, grp_Obj) {
        callback(err, grp_Obj);
    });
};

exports.select_ts = function (ri, callback) {
    var sql = util.format("select * from ts where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, ts_Obj) {
        callback(err, ts_Obj);
    });
};

exports.select_ts_in = function (ri_list, callback) {
    var sql = util.format("select * from ts where ri in ("+JSON.stringify(ri_list).replace('[','').replace(']','') + ")");
    db.getResult(sql, '', function (err, ts_Obj) {
        callback(err, ts_Obj);
    });

};

exports.update_ts_mdcn_mdl = function (mdcn, mdl, ri, callback) {
    var sql = util.format("update ts set mdcn = \'%s\', mdl = \'%s\' where ri = \'%s\'", mdcn, mdl, ri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.update_cb_poa_csi = function (poa, csi, ri, callback) {
    console.time('update_cb_poa_csi');
    var sql = util.format('update cb set poa = \'%s\', csi = \'%s\' where ri=\'%s\'', poa, csi, ri);
    db.getResult(sql, '', function (err, results) {
        console.timeEnd('update_cb_poa_csi');
        callback(err, results);
    });
};

exports.update_st_lookup = function (st, ri, callback) {
    console.time('update_st_lookup');
    var sql = util.format('update lookup set st = \'%s\' where ri=\'%s\'', st, ri);
    db.getResult(sql, '', function (err, results) {
        console.timeEnd('update_st_lookup');
        callback(err, results);
    });
};

exports.update_acp = function (lt, acpi, et, st, lbl, at, aa, mni, ri, pv, pvs, callback) {
    var body_Obj = {};
    console.time('update_acp');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update acp set pv = \'%s\', pvs = \'%s\' where ri = \'%s\'',
                pv, pvs, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_acp');
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
    var body_Obj = {};
    console.time('update_ae');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update ae set apn = \'%s\', poa = \'%s\', ae.or = \'%s\', rr = \'%s\' where ri = \'%s\'',
                apn, poa, or, rr, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_ae');
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
    var body_Obj = {};
    console.time('update_cnt');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update cnt set mni = \'%s\', mbs = \'%s\', mia = \'%s\', li = \'%s\', cnt.or = \'%s\' where ri = \'%s\'',
                mni, mbs, mia, li, or, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_cnt');
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
    var body_Obj = {};
    console.time('update_grp');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update grp set mnm = \'%s\', mid = \'%s\', macp = \'%s\', gn = \'%s\' where ri = \'%s\'',
                mnm, mid, macp, gn, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_grp');
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
    var body_Obj = {};
    console.time('update_lcp');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update lcp set lou = \'%s\', lon = \'%s\' where ri = \'%s\'',
                lou, lon, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_lcp');
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
    var body_Obj = {};
    console.time('update_csr');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update csr set poa = \'%s\', mei = \'%s\', tri = \'%s\', rr = \'%s\', nl = \'%s\' where ri = \'%s\'',
                poa, mei, tri, rr, nl, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_csr');
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

exports.update_sub = function (lt, acpi, et, st, lbl, at, aa, mni, ri, enc, exc, nu, gpi, nfu, bn, rl, pn, nsp, ln, nct, nec, callback) {
    var body_Obj = {};
    console.time('update_sub');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update sub set enc = \'%s\', exc = \'%s\', nu = \'%s\', gpi = \'%s\', nfu = \'%s\', bn = \'%s\', rl = \'%s\', pn = \'%s\', nsp = \'%s\', ln = \'%s\', nct = \'%s\', nec = \'%s\' where ri = \'%s\'',
                enc, exc, nu, gpi, nfu, bn, rl, pn, nsp, ln, nct, nec, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_sub');
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
    var body_Obj = {};
    console.time('update_sd');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update sd set dspt = \'%s\', sd.or = \'%s\' where ri = \'%s\'',
                dspt, or, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_sd');
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

exports.update_ts = function (lt, acpi, et, st, lbl, at, aa, mni, ri, mbs, mia, or, mdmn, mddt, mdl, mdcn, callback) {
    var body_Obj = {};
    console.time('update_ts');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update ts set mni = \'%s\', mbs = \'%s\', mia = \'%s\', ts.or = \'%s\', mdmn = \'%s\', mddt = \'%s\', mdl = \'%s\', mdcn = \'%s\'  where ri = \'%s\'',
                mni, mbs, mia, or, mdmn, mddt, mdl, mdcn, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_ts');
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
    var body_Obj = {};
    console.time('update_mms');
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, mni, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update mms set stid = \'%s\', asd = \'%s\', osd = \'%s\', sst = \'%s\' where ri = \'%s\'',
                stid, asd, osd, sst, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_mms');
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

exports.delete_ri_lookup = function (ri, callback) {
    var sql = util.format("delete from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, delete_Obj) {
        if(!err) {
            callback(err, delete_Obj);
        }
    });
};

exports.delete_lookup = function (ri, pi_list, pi_index, found_Obj, found_Cnt, callback) {
    var cur_pi = [];
    cur_pi.push(pi_list[pi_index]);

    if(pi_index == 0) {
        console.time('delete_lookup');
    }

    var sql = util.format("delete a.* from (select ri from lookup where pi in ("+JSON.stringify(cur_pi).replace('[','').replace(']','') + ")) b left join lookup as a on b.ri = a.ri");
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            found_Cnt += search_Obj.affectedRows;
            if(++pi_index >= pi_list.length) {
                sql = util.format("delete from lookup where ri = \'%s\'", pi_list[0]);
                db.getResult(sql, '', function (err, search_Obj) {
                    if(!err) {
                        console.timeEnd('delete_lookup');
                        found_Cnt += search_Obj.affectedRows;
                        console.log('deleted ' + found_Cnt + ' resource(s).');
                    }
                    callback(err, found_Obj);
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
