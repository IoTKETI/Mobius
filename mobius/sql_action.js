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
var fs = require('fs');

var db = require('./db_action');

var _this = this;

global.max_lim = 1000;

exports.get_sri_sri = function (ri, callback) {
    var sql = util.format('select sri from sri where ri = \'%s\'', ri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.get_ri_sri = function (request, response, sri, callback) {
    if(request.query != null) {
        if (request.query.real == 4) {
            var results = [];
            callback(null, results, request, response);
            return '1';
        }
    }

    var tid = require('shortid').generate();
    console.time('get_ri_sri' + ' (' + tid + ')');
    var sql = util.format('select ri from sri where sri = \'%s\'', sri);
    db.getResult(sql, '', function (err, results) {
        console.timeEnd('get_ri_sri' + ' (' + tid + ')');
        callback(err, results, request, response);
    });
};

function set_sri_sri(ri, sri, callback) {
    var sql = util.format('insert into sri (ri, sri) value (\'%s\', \'%s\')', ri, sri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
}

exports.insert_lookup = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, callback) {
    console.time('insert_lookup ' + ri);
    var sql = util.format('insert into lookup (' +
        'pi, ri, ty, ct, st, rn, lt, et, acpi, lbl, at, aa, sri, spi) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        pi, ri, ty, ct, st, rn, lt, et, acpi, lbl, at, aa, sri, spi);
    db.getResult(sql, '', function (err) {
        if(!err) {
            set_sri_sri(ri, sri, function (err, results) {
                console.timeEnd('insert_lookup ' + ri);
                callback(err, results);
            });
        }
    });
};

exports.insert_cb = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, cst, csi, srt, poa, nl, ncp, callback) {
    console.time('insert_cb ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
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

exports.insert_acp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, pv, pvs, callback) {
    console.time('insert_acp ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
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

exports.insert_ae = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, apn, api, aei, poa, or, nl, rr, csz, callback) {
    console.time('insert_ae ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into ae (ri, apn, api, aei, poa, ae.or, nl, rr, csz) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, apn, api, aei, poa,
                or, nl, rr, csz);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_ae ' + ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", ri);
                    db.getResult(sql, '', function () {
                    });
                    callback(err, results);
                }
            });
        }
        else {
            sql = util.format("delete from lookup where ri = \'%s\'", ri);
            db.getResult(sql, '', function () {
            });
            callback(err, results);
        }
    });
};

exports.insert_cnt = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, sri, spi, cr, mbs, mia, cni, cbs, li, or, disr, callback) {
    console.time('insert_cnt ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into cnt (ri, cr, mni, mbs, mia, cni, cbs, li, cnt.or, disr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, mni, mbs, mia,
                cni, cbs, li, or, disr);
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

global.getType = function (p) {
    var type = 'string';
    if (Array.isArray(p)) {
        type = 'array';
    }
    else if (typeof p === 'string') {
        try {
            var _p = JSON.parse(p);
            if(typeof _p === 'object') {
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

function get_info_cins(pi, cni, callback) {
    if (cbs_cache.hasOwnProperty(pi)) {
        if (cni === -1 || cni != cbs_cache[pi].st) {
            var sql2 = 'select count(*), sum(cs) from cin where pi = \'' + pi + '\'';
            db.getResult(sql2, '', function (err, results) {
                cbs_cache[pi] = {};
                cbs_cache[pi].cni = results[0]['count(*)'];
                cbs_cache[pi].cbs = (results[0]['sum(cs)'] == null) ? 0 : results[0]['sum(cs)'];
                if (parseInt(cbs_cache[pi].cni, 10) == 0) {
                    cbs_cache[pi].st = 0;
                }
                else {
                    cbs_cache[pi].st = cbs_cache[pi].cni;
                }
                //set_cbs_cache(pi, cbs_cache[pi]);
                callback(cbs_cache[pi].cni, cbs_cache[pi].cbs, cbs_cache[pi].st);
            });
        }
        else {
            callback(cbs_cache[pi].cni, cbs_cache[pi].cbs, cbs_cache[pi].st);
        }
    }
    else {
        sql2 = 'select count(*), sum(cs) from cin where pi = \'' + pi + '\'';
        db.getResult(sql2, '', function (err, results) {
            cbs_cache[pi] = {};
            cbs_cache[pi].cni = results[0]['count(*)'];
            cbs_cache[pi].cbs = (results[0]['sum(cs)'] == null) ? 0 : results[0]['sum(cs)'];
            if (parseInt(cbs_cache[pi].cni, 10) == 0) {
                cbs_cache[pi].st = 0;
            }
            else {
                cbs_cache[pi].st = cbs_cache[pi].cni;
            }
            //set_cbs_cache(pi, cbs_cache[pi]);
            callback(cbs_cache[pi].cni, cbs_cache[pi].cbs, cbs_cache[pi].st);
        });
    }
}

function create_action_cni(ty, pi, cni, cbs, mni, mbs, callback) {
    if (cni > parseInt(mni, 10) || cbs > parseInt(mbs, 10)) {
        _this.select_cs_parent(ty, pi, function (err, results_cs) { // select oldest
            if (results_cs.length == 1) {
                _this.delete_ri_lookup(results_cs[0].ri, function (err) {
                    if (!err) {
                        cni = (parseInt(cni, 10) - 1).toString();
                        cbs = (parseInt(cbs, 10) - parseInt(results_cs[0].cs, 10)).toString();

                        create_action_cni(ty, pi, cni, cbs, mni, mbs, function (rsc, cni, cbs) {
                            callback(rsc, cni, cbs);
                        });
                    }
                    else {
                        var body_Obj = {};
                        body_Obj['dbg'] = 'delete error in create_action_cni';
                        console.log(JSON.stringify(body_Obj));
                        callback('0');
                        return '0';
                    }
                });
            }
            else {
                var body_Obj = {};
                body_Obj['dbg'] = results_cs.message;
                console.log(JSON.stringify(body_Obj));
                callback('0');
                return '0';
            }
        });
    }
    else {
        callback('1', cni, cbs);
    }
}

exports.insert_cin = function(obj, mni, mbs, p_st, callback) {
    console.time('total_insert_cin ' + obj.ri);
    get_info_cins(obj.pi, p_st, function(cni, cbs, st) {
        st = parseInt(st, 10) + 1;
        _this.insert_lookup(obj.ty, obj.ri, obj.rn, obj.pi, obj.ct, obj.lt, obj.et, JSON.stringify(obj.acpi), JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), st, obj.sri, obj.spi, function (err, results) {
            if (!err) {
                var con_type = getType(obj.con);
                if (con_type === 'string_object') {
                    try {
                        obj.con = JSON.parse(obj.con);
                    }
                    catch (e) {
                    }
                }

                console.time('insert_cin ' + obj.ri);
                var sql = util.format('insert into cin (ri, pi, cr, cnf, cs, cin.or, con) ' +
                    'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    obj.ri, obj.pi, obj.cr, obj.cnf, obj.cs, obj.or, (con_type == 'string') ? obj.con.replace(/'/g, "\\'") : JSON.stringify(obj.con));
                db.getResult(sql, '', function (err, results) {
                    if (!err) {
                        console.timeEnd('insert_cin ' + obj.ri);
                        cni = parseInt(cni, 10) + 1;
                        cbs = parseInt(cbs, 10) + parseInt(obj.cs, 10);

                        create_action_cni(obj.ty, obj.pi, cni, cbs, mni, mbs, function (rsc, cni, cbs) {
                            if(rsc == '1') {
                                if (cbs_cache.hasOwnProperty(obj.pi)) {
                                    cbs_cache[obj.pi].cni = cni;
                                    cbs_cache[obj.pi].cbs = cbs;
                                    cbs_cache[obj.pi].st = st;
                                    set_cbs_cache(obj.pi, cbs_cache[obj.pi]);
                                }
                                else {
                                    console.log(cbs_cache);
                                }

                                p_st = parseInt(p_st, 10) + 1;
                                _this.update_cni_parent(obj.ty, cni, cbs, p_st, obj.pi, function (err, results) {
                                    if (!err) {
                                        console.timeEnd('total_insert_cin ' + obj.ri);
                                        callback(err, results);
                                    }
                                    else {
                                        callback(err, results);
                                    }
                                });
                            }
                            else {
                                callback('0');
                            }
                        });

                    }
                });
            }
            else {
                callback(err, results);
            }
        });
    });
};

exports.insert_grp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, cr, mt, cnm, mnm, mid, macp, mtv, csy, gn, callback) {
    console.time('insert_grp ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
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

exports.insert_lcp = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, los, lou, lot, lor, loi, lon, lost, callback) {
    console.time('insert_lcp ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
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

exports.insert_fwr = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, mgd, objs, obps, dc, vr, fwnnam, url, ud, uds, callback) {
    console.time('insert_fwr ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, vr, fwnnam, url, ud, uds) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, mgd, objs, obps, dc, vr, fwnnam, url, ud, uds);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_fwr ' + ri);
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

exports.insert_bat = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, mgd, objs, obps, dc, btl, bts, callback) {
    console.time('insert_bat ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, btl, bts) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, mgd, objs, obps, dc, btl, bts);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_bat ' + ri);
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

exports.insert_dvi = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, mgd, objs, obps, dc, dbl, man, mod, dty, fwv, swv, hwv, callback) {
    console.time('insert_dvi ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, dbl, man, mgo.mod, dty, fwv, swv, hwv) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, mgd, objs, obps, dc, dbl, man, mod, dty, fwv, swv, hwv);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_dvi ' + ri);
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

exports.insert_dvc = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, mgd, objs, obps, dc, can, att, cas, cus, ena, dis, callback) {
    console.time('insert_dvc ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, can, att, cas, cus, ena, dis) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, mgd, objs, obps, dc, can, att, cas, cus, ena, dis);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_dvc ' + ri);
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

exports.insert_rbo = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, mgd, objs, obps, dc, rbo, far, callback) {
    console.time('insert_rbo ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, rbo, far) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, mgd, objs, obps, dc, rbo, far);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_rbo ' + ri);
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

exports.insert_nod = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, ni, hcl, mgca, callback) {
    console.time('insert_nod ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into nod (ri, ni, hcl, mgca) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                ri, ni, hcl, mgca);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_nod ' + ri);
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

exports.insert_csr = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, cst, poa, cb, csi, mei, tri, rr, nl, callback) {
    console.time('insert_csr ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
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

exports.insert_req = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, op, tg, org, rid, mi, pc, rs, ors, callback) {
    console.time('insert_req ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
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

exports.insert_sub = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su, callback) {
    console.time('insert_sub ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
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

exports.insert_smd = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, cr, dsp, dcrp, soe, rels, or, callback) {
    console.time('insert_smd ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into smd (ri, cr, dsp, dcrp, soe, rels, smd.or) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, dsp, dcrp, soe, rels, or);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_smd ' + ri);
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

exports.insert_ts = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, sri, spi, cr, mbs, mia, cni, cbs, or, pei, mdd, mdn, mdlt, mdc, mdt, callback) {
    console.time('insert_ts ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into ts (ri, cr, mni, mbs, mia, cni, cbs, ts.or, pei, mdd, mdn, mdlt, mdc, mdt) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', ' +
                '\'%s\', \'%s\', \'%s\', \'%s\')',
                ri, cr, mni, mbs, mia,
                cni, cbs, or, pei, mdd,
                mdn, mdlt, mdc, mdt);
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

exports.insert_tsi = function(obj, callback) {
    console.time('insert_tsi ' + obj.ri);
    _this.insert_lookup(obj.ty, obj.ri, obj.rn, obj.pi, obj.ct, obj.lt, obj.et, JSON.stringify(obj.acpi), JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), obj.st, obj.sri, obj.spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into tsi (ri, pi, dgt, con, sqn, cs) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.pi, obj.dgt, obj.con, obj.sqn, obj.cs);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_tsi ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
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

exports.insert_mms = function(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, sid, soid, stid, asd, osd, sst, callback) {
    console.time('insert_mms ' + ri);
    _this.insert_lookup(ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, sri, spi, function (err, results) {
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

exports.insert_tr = function(obj, callback) {
    console.time('insert_tr ' + obj.ri);
    _this.insert_lookup(obj.ty, obj.ri, obj.rn, obj.pi, obj.ct, obj.lt, obj.et, JSON.stringify(obj.acpi), JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), obj.st, obj.sri, obj.spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into tr (ri, cr, tid, tctl, tst, tltm, text, tct, tltp, trqp, trsp) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cr, obj.tid, obj.tctl, obj.tst, obj.tltm, obj.text, obj.tct, obj.tltp, JSON.stringify(obj.trqp), JSON.stringify(obj.trsp));
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_tr ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
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

exports.insert_tm = function(obj, callback) {
    console.time('insert_tm ' + obj.ri);
    _this.insert_lookup(obj.ty, obj.ri, obj.rn, obj.pi, obj.ct, obj.lt, obj.et, JSON.stringify(obj.acpi), JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), obj.st, obj.sri, obj.spi, function (err, results) {
        if(!err) {
            var sql = util.format('insert into tm (ri, tltm, text, tct, tept, tmd, tltp, tctl, tst, tmr, tmh, rqps, rsps, cr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.tltm, obj.text, obj.tct, obj.tept, obj.tmd, obj.tltp, obj.tctl, obj.tst, obj.tmr, obj.tmh, JSON.stringify(obj.rqps), JSON.stringify(obj.rsps), obj.cr);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_tm ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
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

exports.select_ae = function(ri, callback) {
    var sql = util.format("select * from ae where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, results_ae) {
        callback(err, results_ae);
    });
};


exports.search_parents_lookup = function(ri, pi_list, result_ri, callback) {
    // //var sql = util.format("select ri from lookup where (ri =\'%s\') or ((pi=\'%s\' or pi like \'%s/%%\') and ty != \'1\' and ty != \'4\' and ty != \'23\' and ty != \'30\' and ty != \'9\' and ty != \'17\')", ri, ri, ri);
    // var sql = util.format("select ri from lookup where (ri =\'%s\') or (pi=\'%s\' or pi like \'%s/%%\')", ri, ri, ri);
    // db.getResult(sql, '', function (err, result_lookup_ri) {
    //     console.timeEnd('search_parents_lookup ' + ri);
    //     callback(err, result_lookup_ri);
    // });

    var sql = util.format("select ri, ty from lookup where pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+") limit 1000");
    db.getResult(sql, '', function (err, result_lookup_ri) {
        if(!err) {
            if(result_lookup_ri.length === 0) {
                callback(err, result_ri);
            }
            else {
                pi_list = [];
                for(var idx in result_lookup_ri) {
                    if(result_lookup_ri.hasOwnProperty(idx)) {
                        if(result_lookup_ri[idx].ty != '23' && result_lookup_ri[idx].ty != '4' && result_lookup_ri[idx].ty != '30' && result_lookup_ri[idx].ty != '17') {
                            pi_list.push(result_lookup_ri[idx].ri);
                            result_ri.push(result_lookup_ri[idx]);
                        }
                    }
                }

                if(pi_list.length === 0) {
                    callback(err, result_ri);
                }
                else {
                    _this.search_parents_lookup(ri, pi_list, result_ri, function (err, result_ri) {
                        callback(err, result_ri);
                    });
                }
            }
        }
    });
};

function build_discovery_sql(ri, query, cur_lim, pi_list, cni) {
//    var list_ri = '';
    var query_where = '';
    var query_count = 0;
    if(query.lbl != null) {
        query_where = ' where ';
        if(query.lbl.toString().split(',')[1] == null) {
            query_where += util.format(' a.lbl like \'[\"%%%s%%\"]\'', query.lbl);
            //query_where += util.format(' lbl like \'%s\'', request.query.lbl);
        }
        else {
            for(var i = 0; i < query.lbl.length; i++) {
                query_where += util.format(' a.lbl like \'%%\"%s\"%%\'', query.lbl[i]);
                //query_where += util.format(' lbl like \'%s\'', request.query.lbl[i]);

                if(i < query.lbl.length-1) {
                    query_where += ' or ';
                }
            }
        }
        query_count++;
    }

    var ty_str = '';
    if(query.ty != null) {
        ty_str = ' and ';
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }

        if(query.ty.toString().split(',').length == 1) {
            query_where += util.format('a.ty = \'%s\'', query.ty);
            ty_str += util.format('ty = \'%s\'', query.ty);
        }
        else {
            query_where += ' (';
            ty_str += ' (';
            for(i = 0; i < query.ty.length; i++) {
                query_where += util.format('a.ty = \'%s\'', query.ty[i]);
                ty_str += util.format('ty = \'%s\'', query.ty[i]);
                if(i < query.ty.length-1) {
                    query_where += ' or ';
                    ty_str += ' or ';
                }
            }
            query_where += ') ';
            ty_str += ') ';
        }
        query_count++;
    }

    if(query.cra != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format('\'%s\' <= a.ct', query.cra);
        query_count++;
    }

    if(query.la != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }

        if(cbs_cache.hasOwnProperty(ri)) {
            var st = parseInt(cbs_cache[ri].st, 10) - (parseInt(query.la, 10) - 1);
            query_where += util.format(' a.st >= \'%s\'', st);
            query_count++;
        }
        else {
            get_info_cins(ri, -1, function(cni, cbs, st) {
            });
            query_where += util.format(' a.st >= \'0\'');
            query_count++;
        }
    }

    if(query.crb != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format(' a.ct < \'%s\'', query.crb);
        query_count++;
    }

    if(query.ms != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format('\'%s\' <= a.lt', query.ms);
        query_count++;
    }

    if(query.us != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format(' a.lt < \'%s\'', query.us);
        query_count++;
    }

    if(query.exa != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format('\'%s\' <= a.et', query.exa);
        query_count++;
    }

    if(query.exb != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format(' a.et < \'%s\'', query.exb);
        query_count++;
    }

    if(query.sts != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format(' a.st < \'%s\'', query.sts);
        query_count++;
    }

    if(query.stb != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format('\'%s\' <= a.st', query.stb);
        query_count++;
    }

    if(query.sza != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format('%s <= a.cs', query.sza);
        query_count++;
    }

    if(query.szb != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format('a.cs < %s', query.szb);
        query_count++;
    }

    if(query.cty != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else {
            query_where += ' and ';
        }
        query_where += util.format('a.cnf = \'%s\'', query.cty);
        query_count++;
    }

    query_where += ' limit ' + cur_lim;
//    query_where += util.format(' order by ct desc limit %s', cur_lim);

    if(query.ofst != null) {
        query_where += util.format(' offset %s', query.ofst);
    }

    query_where = "select a.* from (select ri from lookup where ((pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+"))" + ty_str + ")) b left join lookup as a on b.ri = a.ri " + query_where;
    //query_where = util.format("select a.* from (select ri from lookup where ((ri = \'" + ri + "\') or (pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and ((\'%s\' < ct) and (ct <= \'%s\')))) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;
    //query_where = util.format("select a.* from (select ri from lookup where ((ri = \'" + ri + "\') or pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and (ct > \'%s\' and ct <= \'%s\') limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;
    //query_where = util.format("select a.* from (select ri from lookup where (pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and (ct > \'%s\' and ct <= \'%s\') order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;

    return query_where;
}

function select_spec_ri(found_Obj, count, callback) {
    var ri = Object.keys(found_Obj)[count];
    var sql = "select * from " + responder.typeRsrc[found_Obj[ri].ty] + " where ri = \'" + ri + "\'";
    db.getResult(sql, ri, function (err, spec_Obj, ri) {
        if(err) {
            delete found_Obj[ri];
            select_spec_ri(found_Obj, count, function (err, found_Obj) {
                callback(err, found_Obj);
            });
        }
        else {
            if(spec_Obj.length >= 1) {
                makeObject(spec_Obj[0]);
                found_Obj[spec_Obj[0].ri] = merge(found_Obj[spec_Obj[0].ri], spec_Obj[0]);
                if (++count >= Object.keys(found_Obj).length) {
                    callback(err, found_Obj);
                }
                else {
                    select_spec_ri(found_Obj, count, function (err, found_Obj) {
                        callback(err, found_Obj);
                    });
                }
            }
            else {
                delete found_Obj[ri];
                select_spec_ri(found_Obj, count, function (err, found_Obj) {
                    callback(err, found_Obj);
                });
            }
        }
    });
}


var search_tid = '';
exports.search_lookup = function (ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, loop_cnt, response, callback) {
    var cur_pi = [];

    if(loop_cnt == 0) {
        search_tid = require('shortid').generate();
        console.time('search_lookup (' + search_tid + ')');
    }

    for(var idx = 0; idx < 16; idx++) {
        if (pi_index < pi_list.length) {
            cur_pi.push(pi_list[pi_index++]);
        }
        else {
            break;
        }
    }

    var sql = build_discovery_sql(ri, query, cur_lim, cur_pi, cni);
    //console.log(loop_cnt + ' - ' + sql);
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            if(search_Obj.length > 0) {
                for(var i = 0; i < search_Obj.length; i++) {
                    found_Obj[search_Obj[i].ri] = search_Obj[i];
                    if(Object.keys(found_Obj).length >= query.lim) {
                        break;
                    }
                }

                if(Object.keys(found_Obj).length >= query.lim) {
                    select_spec_ri(found_Obj, 0, function (err, found_Obj) {
                        console.timeEnd('search_lookup (' + search_tid + ')');
                        callback(err, found_Obj, response);
                    });
                }
                else {
                    select_spec_ri(found_Obj, 0, function (err, found_Obj) {
                        if (pi_index >= pi_list.length) {
                            console.timeEnd('search_lookup (' + search_tid + ')');
                            callback(err, found_Obj, response);
                        }
                        else {
                            cur_lim = parseInt(query.lim) - Object.keys(found_Obj).length;
                            _this.search_lookup(ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, ++loop_cnt, response, function (err, found_Obj, response) {
                                callback(err, found_Obj, response);
                            });
                        }
                    });
                }
            }
            else {
                if (pi_index >= pi_list.length) {
                    console.timeEnd('search_lookup (' + search_tid + ')');
                    callback(err, found_Obj, response);
                }
                else {
                    cur_lim = parseInt(query.lim) - Object.keys(found_Obj).length;
                    _this.search_lookup(ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, ++loop_cnt, response, function (err, found_Obj, response) {
                        callback(err, found_Obj, response);
                    });
                }
            }
        }
        else {
            callback(err, search_Obj, response);
        }
    });
};

exports.select_latest_resource = function(ri, cur_d, loop_cnt, ty, cni, lim, callback) {
    console.time('select_latest ' + ri);

    get_info_cins(ri, cni, function(cni, cbs, st) {
        var sql = 'select * from lookup where pi = \'' + ri + '\' and ty = \'4\' and st = \'' + st + '\'';
        db.getResult(sql, '', function (err, latest_Comm) {
            if(!err) {
                if(latest_Comm.length >= 1) {
                    sql = "select * from " + responder.typeRsrc[ty] + " where ri = \'" + latest_Comm[0].ri + "\'";
                    db.getResult(sql, '', function (err, latest_Spec) {
                        console.timeEnd('select_latest ' + ri);
                        var result_Obj = [];
                        result_Obj.push(merge(latest_Comm[0], latest_Spec[0]));
                        callback(err, result_Obj);
                    });
                }
                else {
                    console.timeEnd('select_latest ' + ri);
                    callback(err, latest_Comm);
                }
            }
            else {
                console.timeEnd('select_latest ' + ri);
                callback(err, latest_Comm);
            }
        });
    });
};

exports.select_oldest_resource = function(ri, callback) {
    console.time('select_oldest ' + ri);
    //var sql = util.format('select a.* from (select ri from lookup where (pi = \'%s\') limit 100) b left join lookup as a on b.ri = a.ri where a.ty = \'4\' or a.ty = \'30\' limit 1', ri);
    var sql = 'select * from lookup where pi = \'' + ri + '\' and ty = \'4\'';
    db.getResult(sql, '', function (err, oldest_Comm) {
        if(!err) {
            if(oldest_Comm.length >= 1) {
                sql = "select * from " + responder.typeRsrc[oldest_Comm[0].ty] + " where ri = \'" + oldest_Comm[0].ri + "\'";
                db.getResult(sql, '', function (err, oldest_Spec) {
                    console.timeEnd('select_oldest ' + ri);
                    var result_Obj = [];
                    result_Obj.push(merge(oldest_Comm[0], oldest_Spec[0]));
                    callback(err, result_Obj);
                });
            }
            else {
                console.timeEnd('select_oldest ' + ri);
                callback(err, oldest_Comm);
            }
        }
        else {
            console.timeEnd('select_oldest ' + ri);
            callback(err, oldest_Comm);
        }
    });
};

exports.select_direct_lookup = function(ri, callback) {
    var tid = require('shortid').generate();
    console.time('select_direct_lookup ' + ri + ' (' + tid + ')');
    var sql = util.format("select * from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, direct_Obj) {
        console.timeEnd('select_direct_lookup ' + ri + ' (' + tid + ')');
        callback(err, direct_Obj);
    });
};

exports.select_resource = function(ty, ri, callback) {
    var tid = require('shortid').generate();
    console.time('select_resource '+ ty + ' ' + ri + ' (' + tid + ')');
    //var sql = util.format("select * from " + ty + " where ri = \'%s\'", ri);
    var sql = "select * from " + ty + " where ri = \'" + ri + "\'";
    db.getResult(sql, '', function (err, rsc_Obj) {
        console.timeEnd('select_resource ' + ty + ' ' + ri + ' (' + tid + ')');
        callback(err, rsc_Obj);
    });
};

exports.select_ri_lookup = function(ri, callback) {
    console.time('select_ri_lookup ' + ri);
    //var sql = util.format("select ri from lookup where ri = \'%s\'", ri);
    var sql = "select ri from lookup where ri = \'" + ri + "\'";
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

exports.select_acp_cnt = function(loop, uri_arr, callback) {
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
    db.getResult(sql, '', function (err, results) {
        if (err) {
            callback(err, results.message);
        }
        else {
            if(results.length == 0) {
                callback(err, results);
            }
            else {
                results[0].acpi = JSON.parse(results[0].acpi);

                if (results[0].acpi.length == 0) {
                    if (results[0].ty == '3') {
                        _this.select_acp_cnt(++loop, uri_arr, function (err, acpiList) {
                            if (err) {
                                callback(err, acpiList.message);
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

exports.select_tr = function(pi, callback) {
    var sql = util.format('select * from lookup where pi = \'%s\' and ty = \'39\'', pi);
    db.getResult(sql, '', function (err, results_comm_tr) {
        if(!err) {
            if(results_comm_tr.length === 0) {
                callback(err, results_comm_tr);
            }
            else {
                var sql2 = util.format('select * from tr where ri = \'%s\'', results_comm_tr[0].ri);
                db.getResult(sql2, '', function (err, results_tr) {
                    callback(err, results_tr);
                });
            }
        }
        else {
            callback(err, results_comm_tr);
        }
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
        var sql = util.format("select cni, cbs, st, mni, mbs from cnt, lookup where cnt.ri = \'%s\' and lookup.ri = \'%s\'", pi, pi);
    }
    else {
        sql = util.format("select cni, cbs, st, mni, mbs from ts, lookup where ts.ri = \'%s\' and lookup.ri = \'%s\'", pi, pi);
    }

    db.getResult(sql, '', function (err, results_cni) {
        callback(err, results_cni);
    });
};

exports.select_st_parent = function (pi, callback) {
    var sql = util.format("select st from lookup where ri = \'%s\'", pi);

    db.getResult(sql, '', function (err, results_st) {
        callback(err, results_st);
    });
};

exports.select_cs_parent = function (ty, pi, callback) {
    var sql = util.format("select cs, ri from cin where ri = (select ri from lookup where pi = \'%s\' and ty = \'%s\' order by ri asc limit 1)", pi, ty);
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

exports.select_in_ri_list = function (tbl, ri_list, ri_index, found_Obj, loop_cnt, callback) {
    var cur_ri = [];

    if(loop_cnt == 0) {
        search_tid = require('shortid').generate();
        console.time('select_in_ri_list (' + search_tid + ')');
    }

    for(var idx = 0; idx < 8; idx++) {
        if (ri_index < ri_list.length) {
            cur_ri.push(ri_list[ri_index++]);
        }
        else {
            break;
        }
    }

    var sql = util.format("select * from " + tbl + " where ri in ("+JSON.stringify(cur_ri).replace('[','').replace(']','')+")");
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            for(var i = 0; i < search_Obj.length; i++) {
                found_Obj.push(search_Obj[i]);
            }

            if(ri_index >= ri_list.length) {
                console.timeEnd('select_in_ri_list (' + search_tid + ')');
                callback(err, found_Obj);
            }
            else {
                setTimeout( function() {
                    _this.select_in_ri_list(tbl, ri_list, ri_index, found_Obj, loop_cnt, function (err, found_Obj) {
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


exports.select_ts_in = function (ri_list, callback) {
    var sql = util.format("select * from ts where ri in ("+JSON.stringify(ri_list).replace('[','').replace(']','') + ")");
    db.getResult(sql, '', function (err, ts_Obj) {
        callback(err, ts_Obj);
    });

};

exports.select_count_ri = function (ty, ri, callback) {
    var sql = 'select count(*) from ' + responder.typeRsrc[ty] + ' where pi = \'' + ri + '\'';
    db.getResult(sql, '', function (err, results) {
        var cni = results[0]['count(*)'];
        var sql2 = 'select sum(cs) from ' + responder.typeRsrc[ty] + ' where pi = \'' + ri + '\'';
        db.getResult(sql2, '', function (err, results) {
            results[0]['count(*)'] = cni;
            callback(err, results);
        });
    });
};

exports.update_ts_mdcn_mdl = function (mdc, mdlt, ri, callback) {
    var sql = util.format("update ts set mdc = \'%s\', mdlt = \'%s\' where ri = \'%s\'", mdc, mdlt, ri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.update_cb_poa_csi = function (poa, csi, srt, ri, callback) {
    console.time('update_cb_poa_csi ' + ri);
    var sql = util.format('update cb set poa = \'%s\', csi = \'%s\', srt = \'%s\' where ri=\'%s\'', poa, csi, srt, ri);
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

exports.update_lookup = function (lt, acpi, et, st, lbl, at, aa, ri, callback) {
    console.time('update_lookup ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, ri);
    db.getResult(sql1, '', function (err, results) {
        console.timeEnd('update_lookup ' + ri);
        callback(err, results);
    });
};

exports.update_acp = function (lt, acpi, et, st, lbl, at, aa, ri, pv, pvs, callback) {
    console.time('update_acp ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
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

exports.update_ae = function (lt, acpi, et, st, lbl, at, aa, ri, apn, poa, or, rr, callback) {
    console.time('update_ae ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
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

exports.update_cnt = function (obj, callback) {
    console.time('update_cnt ' + obj.ri);
    _this.update_lookup(obj.lt, JSON.stringify(obj.acpi), obj.et, obj.st, JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), obj.ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update cnt set mni = \'%s\', mbs = \'%s\', mia = \'%s\', li = \'%s\', cnt.or = \'%s\', cni = \'%s\', cbs = \'%s\' where ri = \'%s\'',
                obj.mni, obj.mbs, obj.mia, obj.li, obj.or, obj.cni, obj.cbs, obj.ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_cnt ' + obj.ri);
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

exports.update_grp = function (lt, acpi, et, st, lbl, at, aa, ri, mnm, mid, macp, gn, callback) {
    console.time('update_grp ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
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

exports.update_lcp = function (lt, acpi, et, st, lbl, at, aa, ri, lou, lon, callback) {
    console.time('update_lcp ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
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

exports.update_fwr = function (lt, acpi, et, st, lbl, at, aa, ri, dc, vr, fwnnam, url, ud, uds, callback) {
    console.time('update_fwr ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', vr = \'%s\', fwnnam = \'%s\', url = \'%s\', ud = \'%s\', uds = \'%s\' where ri = \'%s\'', dc, vr, fwnnam, url, ud, uds, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_fwr ' + ri);
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

exports.update_bat = function (lt, acpi, et, st, lbl, at, aa, ri, dc, btl, bts, callback) {
    console.time('update_bat ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\' where ri = \'%s\'',
        lt, acpi, et, st, lbl, at, aa, ri);
    db.getResult(sql1, '', function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', btl = \'%s\', bts = \'%s\' where ri = \'%s\'', dc, btl, bts, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_bat ' + ri);
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

exports.update_dvi = function (lt, acpi, et, st, lbl, at, aa, ri, dc, dbl, man, mod, dty, fwv, swv, hwv, callback) {
    console.time('update_dvi ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', dbl = \'%s\', man = \'%s\', mgo.mod = \'%s\', dty = \'%s\', fwv = \'%s\', swv = \'%s\', hwv = \'%s\' where ri = \'%s\'', dc, dbl, man, mod, dty, fwv, swv, hwv, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_dvi ' + ri);
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

exports.update_dvc = function (lt, acpi, et, st, lbl, at, aa, ri, dc, can, att, cas, cus, ena, dis, callback) {
    console.time('update_dvc ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', can = \'%s\', att = \'%s\', cas = \'%s\', cus = \'%s\', ena = \'%s\', dis = \'%s\' where ri = \'%s\'', dc, can, att, cas, cus, ena, dis, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_dvc ' + ri);
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

exports.update_rbo = function (lt, acpi, et, st, lbl, at, aa, ri, dc, rbo, far, callback) {
    console.time('update_rbo ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', rbo = \'%s\', far = \'%s\' where ri = \'%s\'', dc, rbo, far, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_rbo ' + ri);
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

exports.update_nod = function (lt, acpi, et, st, lbl, at, aa, ri, ni, mgca, callback) {
    console.time('update_nod ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update nod set ni = \'%s\', mgca = \'%s\' where ri = \'%s\'', ni, mgca, ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_nod ' + ri);
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

exports.update_csr = function (lt, acpi, et, st, lbl, at, aa, ri, poa, mei, tri, rr, nl, callback) {
    console.time('update_csr ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
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

exports.update_sub = function (lt, acpi, et, st, lbl, at, aa, ri, enc, exc, nu, gpi, nfu, bn, rl, pn, nsp, ln, nct, nec, callback) {
    console.time('update_sub ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
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

exports.update_sd = function (lt, acpi, et, st, lbl, at, aa, ri, dsp, dcrp, soe, rels, or, callback) {
    console.time('update_sd ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update smd set dsp = \'%s\', dcrp = \'%s\', soe = \'%s\', rels = \'%s\', smd.or = \'%s\' where ri = \'%s\'',
                dsp, dcrp, soe, rels, or, ri);
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

exports.update_ts = function (lt, acpi, et, st, lbl, at, aa, mni, ri, mbs, mia, or, mdn, mdt, mdlt, mdc, callback) {
    console.time('update_ts ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update ts set mni = \'%s\', mbs = \'%s\', mia = \'%s\', ts.or = \'%s\', mdn = \'%s\', mdt = \'%s\', mdlt = \'%s\', mdc = \'%s\'  where ri = \'%s\'',
                mni, mbs, mia, or, mdn, mdt, mdlt, mdc, ri);
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

exports.update_mms = function (lt, acpi, et, st, lbl, at, aa, ri, stid, asd, osd, sst, callback) {
    console.time('update_mms ' + ri);
    _this.update_lookup(lt, acpi, et, st, lbl, at, aa, ri, function (err, results) {
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

exports.update_tm = function (obj, callback) {
    console.time('update_tm ' + obj.ri);
    _this.update_lookup(obj.lt, JSON.stringify(obj.acpi), obj.et, obj.st, JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), obj.ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update tm set cr = \'%s\', tctl = \'%s\', tst = \'%s\', tmr = \'%s\', tmh = \'%s\', rsps = \'%s\' where ri = \'%s\'', obj.cr, obj.tctl, obj.tst, obj.tmr, obj.tmh, JSON.stringify(obj.rsps), obj.ri);
            db.getResult(sql2, '', function (err, results) {
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


exports.update_tr = function (obj, callback) {
    console.time('update_tr ' + obj.ri);
    _this.update_lookup(obj.lt, JSON.stringify(obj.acpi), obj.et, obj.st, JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), obj.ri, function (err, results) {
        if (!err) {
            var sql2 = util.format('update tr set cr = \'%s\', tctl = \'%s\', tst = \'%s\', trsp = \'%s\' where ri = \'%s\'',
                obj.cr, obj.tctl, obj.tst, JSON.stringify(obj.trsp), obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_tr_trsp = function (ri, tst, trsp, callback) {
    console.time('update_tr_trsp ' + ri);
    var sql2 = util.format('update tr set tst = \'%s\', trsp = \'%s\' where ri = \'%s\'', tst, trsp, ri);
    db.getResult(sql2, '', function (err, results) {
        if (!err) {
            console.timeEnd('update_tr_trsp ' + ri);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_tr_tst = function (ri, tst, callback) {
    console.time('update_tr_tst ' + ri);
    var sql2 = util.format('update tr set tst = \'%s\' where ri = \'%s\'', tst, ri);
    db.getResult(sql2, '', function (err, results) {
        if (!err) {
            console.timeEnd('update_tr_tst ' + ri);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};


exports.update_cni_parent = function (ty, cni, cbs, st, pi, callback) {
    var lt = moment().utc().format('YYYYMMDDTHHmmss');
    if (ty == '4') {
        var sql = util.format("update cnt, lookup set cnt.cni = \'%s\', cnt.cbs = \'%s\', lookup.st = \'%s\', lookup.lt = \'%s\' where cnt.ri = \'%s\' and lookup.ri = \'%s\'", cni, cbs, st, lt, pi, pi);
    }
    else {
        sql = util.format("update ts, lookup set ts.cni = \'%s\', ts.cbs = \'%s\', lookup.st = \'%s\', lookup.lt = \'%s\' where ts.ri = \'%s\' and lookup.ri = \'%s\'", cni, cbs, st, lt, pi, pi);
    }

    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.update_cni_ri = function (ty, ri, cni, cbs, callback) {
    if (ty == '4') {
        var sql = util.format("update cnt set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cni, cbs, ri);
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

    for(var idx = 0; idx < 8; idx++) {
        if (pi_index < pi_list.length) {
            cur_pi.push(pi_list[pi_index++]);
        }
    }

    var sql = util.format("delete a.* from (select ri from lookup where pi in ("+JSON.stringify(cur_pi).replace('[','').replace(']','') + ")) b left join lookup as a on b.ri = a.ri");
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            found_Cnt += search_Obj.affectedRows;
            if(pi_index >= pi_list.length) {
                sql = util.format("delete from lookup where ri = \'%s\'", ri);
                db.getResult(sql, '', function (err, search_Obj) {
                    if(!err) {
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

exports.delete_lookup_et = function (et, callback) {
    var pi_list = [];
    var sql = util.format("select ri from lookup where et < \'%s\'", et);
    db.getResult(sql, '', function (err, delete_Obj) {
        if(!err) {
            for(var i = 0; i < delete_Obj.length; i++) {
                pi_list.push(delete_Obj[i].ri);
            }

            var finding_Obj = [];
            _this.delete_lookup('', pi_list, 0, finding_Obj, 0, function (err, search_Obj) {
                callback(err, search_Obj);
            });
        }
    });
};


exports.delete_req = function (callback) {
    var sql = util.format("delete from lookup where ty = \'17\'");
    db.getResult(sql, '', function (err, delete_Obj) {
        if(!err) {
            callback(err, delete_Obj);
        }
    });
};


exports.select_sum_cbs = function(callback) {
    var tid = require('shortid').generate();
    console.time('select_sum_cbs ' + tid);
    var sql = util.format('select sum(cbs) from cnt');
    db.getResult(sql, '', function (err, result_Obj) {
        console.timeEnd('select_sum_cbs ' + tid);
        callback(err, result_Obj);
    });
};

exports.select_sum_ae = function(callback) {
    var tid = require('shortid').generate();
    console.time('select_sum_ae ' + tid);
    var sql = util.format('select count(*) from ae');
    db.getResult(sql, '', function (err, result_Obj) {
        console.timeEnd('select_sum_ae ' + tid);
        callback(err, result_Obj);
    });
};