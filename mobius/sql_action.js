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

exports.set_tuning = function(callback) {
    var sql = util.format('set global max_connections = 2000');
    db.getResult(sql, '', function (err, results) {
        if(err) {
            //callback(err, results);
            //return;
            console.log(results.message);
        }
        sql = util.format('set global innodb_flush_log_at_trx_commit=0');
        db.getResult(sql, '', function (err, results) {
            if(err) {
                //callback(err, results);
                //return;
                console.log(results.message);
            }
            sql = util.format('set global sync_binlog=0');
            db.getResult(sql, '', function (err, results) {
                if(err) {
                    //callback(err, results);
                    //return;
                    console.log(results.message);
                }
                sql = util.format('set global transaction_isolation=\'READ-UNCOMMITTED\'');
                db.getResult(sql, '', function (err, results) {
                    if(err) {
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

exports.insert_lookup = function(obj, callback) {
    //console.time('insert_lookup ' + obj.ri);
    var sql = util.format('insert into lookup (' +
        'pi, ri, ty, ct, st, rn, lt, et, acpi, lbl, at, aa, sri, spi, subl) ' +
        'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        obj.pi, obj.ri, obj.ty, obj.ct, obj.st, obj.rn, obj.lt, obj.et, JSON.stringify(obj.acpi), JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), obj.sri, obj.spi, JSON.stringify(obj.subl));
    db.getResult(sql, '', function (err, results) {
        if(!err) {
            set_sri_sri(obj.ri, obj.sri, function (err, results) {
                //console.timeEnd('insert_lookup ' + obj.ri);
                callback(err, results);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_cb = function(obj, callback) {
    console.time('insert_cb ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into cb (' +
                'ri, cst, csi, srt, poa, nl, ncp, srv) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cst, obj.csi, JSON.stringify(obj.srt), JSON.stringify(obj.poa), obj.nl, obj.ncp, JSON.stringify(obj.srv));
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_cb ' + obj.ri);
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

exports.insert_acp = function(obj, callback) {
    console.time('insert_acp ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into acp (ri, pv, pvs) ' +
                'value (\'%s\', \'%s\', \'%s\')',
                obj.ri, JSON.stringify(obj.pv), JSON.stringify(obj.pvs));
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_acp ' + obj.ri);
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

exports.insert_ae = function(obj, callback) {
    console.time('insert_ae ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into ae (ri, apn, api, aei, poa, ae.or, nl, rr, csz, srv) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.apn, obj.api, obj.aei, JSON.stringify(obj.poa), obj.or, obj.nl, obj.rr, obj.csz, JSON.stringify(obj.srv));
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_ae ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, '', function () {
                    });
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_cnt = function(obj, callback) {
    console.time('insert_cnt ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into cnt (ri, cr, mni, mbs, mia, cni, cbs, li, cnt.or, disr) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cr, obj.mni, obj.mbs, obj.mia, obj.cni, obj.cbs, obj.li, obj.or, obj.disr);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_cnt ' + obj.ri);
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

exports.get_cni_count = function(obj, callback) {
    _this.select_count_ri(parseInt(obj.ty, 10) + 1, obj.ri, function (err, results) {
        if (results.length == 1) {
            var cni = results[0]['count(*)'];
            var cbs = (results[0]['sum('+responder.typeRsrc[parseInt(obj.ty, 10) + 1]+'.cs)'] == null) ? 0 : results[0]['sum('+responder.typeRsrc[parseInt(obj.ty, 10) + 1]+'.cs)'];
            var st = (results[0]['st'] == null) ? 0 : results[0]['st'];

            if (cni > parseInt(obj.mni, 10) || cbs > parseInt(obj.mbs, 10)) {
                var count = (cni - parseInt(obj.mni, 10));
                if(count > 5000) {
                    count = 5000;
                }
                _this.delete_oldests(obj, count, function (err, results_oldest) { // select oldest
                    if (results_oldest.affectedRows == count) {
                        _this.get_cni_count(obj, function (cni, cbs, st) {
                            callback(cni, cbs, st);
                        });
                    }
                    else {
                        callback(cni, cbs, st);
                    }
                });
            }
            else {
                callback(cni, cbs, st);
            }
        }
    });
};

exports.insert_cin = function(obj, callback) {
    var cin_id = 'insert_cin ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cin_id);
    _this.insert_lookup(obj, function (err, results) {
        if (!err) {
            var con_type = getType(obj.con);
            if (con_type === 'string_object') {
                try {
                    obj.con = JSON.parse(obj.con);
                }
                catch (e) {
                }
            }

            var sql = util.format('insert into cin (ri, pi, cr, cnf, cs, cin.or, con) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.pi, obj.cr, obj.cnf, obj.cs, obj.or, (con_type == 'string') ? obj.con.replace(/'/g, "\\'") : JSON.stringify(obj.con));
            db.getResult(sql, '', function (err, results) {
                if (!err) {
                    console.timeEnd(cin_id);
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_grp = function(obj, callback) {
    console.time('insert_grp ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into grp (ri, cr, mt, cnm, mnm, mid, macp, mtv, csy, gn) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cr, obj.mt, obj.cnm, obj.mnm, JSON.stringify(obj.mid), JSON.stringify(obj.macp), obj.mtv, obj.csy, obj.gn);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_grp ' + obj.ri);
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

exports.insert_lcp = function(obj, callback) {
    console.time('insert_lcp ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into lcp (ri, los, lou, lot, lor, loi, lon, lost) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.los, obj.lou, obj.lot, obj.lor, obj.loi, obj.lon, obj.lost);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_lcp ' + obj.ri);
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

exports.insert_fwr = function(obj, callback) {
    console.time('insert_fwr ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, vr, fwnnam, url, ud, uds) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.vr, obj.fwnnam, obj.url, obj.ud, JSON.stringify(obj.uds));
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_fwr ' + obj.ri);
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

exports.insert_bat = function(obj, callback) {
    console.time('insert_bat ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, btl, bts) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.btl, obj.bts);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_bat ' + obj.ri);
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

exports.insert_dvi = function(obj, callback) {
    console.time('insert_dvi ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, dbl, man, mgo.mod, dty, fwv, swv, hwv) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.dbl, obj.man, obj.mod, obj.dty, obj.fwv, obj.swv, obj.hwv);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_dvi ' + obj.ri);
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

exports.insert_dvc = function(obj, callback) {
    console.time('insert_dvc ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, can, att, cas, cus, ena, dis) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.can, obj.att, JSON.stringify(obj.cas), obj.cus, obj.ena, obj.dis);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_dvc ' + obj.ri);
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

exports.insert_rbo = function(obj, callback) {
    console.time('insert_rbo ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mgo (ri, mgd, objs, obps, dc, rbo, far) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mgd, obj.objs, obj.obps, obj.dc, obj.rbo, obj.far);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_rbo ' + obj.ri);
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

exports.insert_nod = function(obj, callback) {
    console.time('insert_nod ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into nod (ri, ni, hcl, mgca) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.ni, obj.hcl, obj.mgca);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_nod ' + obj.ri);
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

exports.insert_csr = function(obj, callback) {
    console.time('insert_csr ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into csr (ri, cst, poa, cb, csi, mei, tri, rr, nl, srv) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cst, JSON.stringify(obj.poa), obj.cb, obj.csi, obj.mei, obj.tri, obj.rr, obj.nl, JSON.stringify(obj.srv));
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_csr ' + obj.ri);
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

exports.insert_req = function(obj, callback) {
    console.time('insert_req ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into req (ri, op, tg, org, rid, mi, pc, rs, ors) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.op, obj.tg, obj.org, obj.rid, obj.mi, obj.pc, obj.rs, obj.ors);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_req ' + obj.ri);
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

exports.insert_sub = function(obj, callback) {
    console.time('insert_sub ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into sub (ri, pi, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.pi, JSON.stringify(obj.enc), obj.exc, JSON.stringify(obj.nu), obj.gpi, obj.nfu, JSON.stringify(obj.bn), obj.rl, obj.psn, obj.pn, obj.nsp, obj.ln, obj.nct, obj.nec, obj.cr, obj.su);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_sub ' + obj.ri);
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

exports.insert_smd = function(obj, callback) {
    console.time('insert_smd ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into smd (ri, cr, dsp, dcrp, soe, rels, smd.or) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cr, obj.dsp, obj.dcrp, obj.soe, JSON.stringify(obj.rels), obj.or);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_smd ' + obj.ri);
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

exports.insert_ts = function(obj, callback) {
    console.time('insert_ts ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into ts (ri, cr, mni, mbs, mia, cni, cbs, ts.or, pei, mdd, mdn, mdlt, mdc, mdt) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', ' +
                '\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cr, obj.mni, obj.mbs, obj.mia, obj.cni, obj.cbs, obj.or, obj.pei, obj.mdd, obj.mdn, obj.mdlt, obj.mdc, obj.mdt);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_ts ' + obj.ri);
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

exports.insert_tsi = function(obj, callback) {
    console.time('insert_tsi ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
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

exports.insert_mms = function(obj, callback) {
    console.time('insert_mms ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into mms (ri, sid, soid, stid, asd, osd, sst) ' +
                'value (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.sid, obj.soid, obj.stid, obj.asd, obj.osd, obj.sst);
            db.getResult(sql, '', function (err, results) {
                if(!err) {
                    console.timeEnd('insert_mms ' + obj.ri);
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

exports.insert_tr = function(obj, callback) {
    console.time('insert_tr ' + obj.ri);
    _this.insert_lookup(obj, function (err, results) {
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
    _this.insert_lookup(obj, function (err, results) {
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

exports.select_resource_from_url = function(ri, sri, callback) {
    var sql = util.format('select * from lookup where ri = \'%s\' or ri = (select ri from sri where sri = \'%s\')', ri, sri);
    db.getResult(sql, '', function (err, comm_Obj) {
        if(!err) {
            if(comm_Obj.length == 0) {
                callback(err, comm_Obj);
            }
            else {
                var sql = "select * from " + responder.typeRsrc[comm_Obj[0].ty] + " where ri = \'" + comm_Obj[0].ri + "\'";
                db.getResult(sql, '', function (err, spec_Obj) {
                    var resource_Obj = [];
                    resource_Obj.push(merge(comm_Obj[0], spec_Obj[0]));
                    callback(err, resource_Obj);
                });
            }
        }
        else {
            callback(err, comm_Obj);
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
                var found_pi_list = [];
                for(var idx in result_lookup_ri) {
                    if(result_lookup_ri.hasOwnProperty(idx)) {
                        if(result_lookup_ri[idx].ty != '23' && result_lookup_ri[idx].ty != '4' && result_lookup_ri[idx].ty != '30' && result_lookup_ri[idx].ty != '17') {
                            found_pi_list.push(result_lookup_ri[idx].ri);
                            result_ri.push(result_lookup_ri[idx]);
                        }
                    }
                }

                if(found_pi_list.length === 0) {
                    callback(err, result_ri);
                }
                else {
                    _this.search_parents_lookup(ri, found_pi_list, result_ri, function (err, result_ri) {
                        callback(err, result_ri);
                    });
                }
            }
        }
    });
};


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

function search_resource_action(ri, query, cur_lim, pi_list, cni, loop_count, seekObj, callback) {
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

    if (query.cty != null) {
        query_where += ' and ';
        query_where += util.format('cnf = \'%s\'', query.cty);
        query_count++;
    }

    if (query.la != null) {
        cur_lim = parseInt(query.la, 10);

        var before_ct = moment().subtract(Math.pow(10, ++loop_count), 'minutes').utc().format('YYYYMMDDTHHmmss');

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
    query_where = "select a.* from (select ri from lookup where (ri = \'" + ri + "\') or (pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) " + query_where + " ) b left join lookup as a on b.ri = a.ri ";
    //query_where = util.format("select a.* from (select ri from lookup where ((ri = \'" + ri + "\') or (pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and ((\'%s\' < ct) and (ct <= \'%s\')))) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;
    //query_where = util.format("select a.* from (select ri from lookup where ((ri = \'" + ri + "\') or pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and (ct > \'%s\' and ct <= \'%s\') limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;
    //query_where = util.format("select a.* from (select ri from lookup where (pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and (ct > \'%s\' and ct <= \'%s\') order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;

    db.getResult(query_where, '', function (err, search_Obj) {
        if(!err) {
            if(query.la != null) {
                seekObj[search_Obj[0].ri] = search_Obj[0];
                var st_idx = (search_Obj.length > parseInt(cur_lim, 10)) ? (search_Obj.length - parseInt(cur_lim, 10) + 1) : 0;
                for(i = st_idx; i < search_Obj.length; i++) {
                    seekObj[search_Obj[i].ri] = search_Obj[i];
                    if(Object.keys(seekObj).length > cur_lim) {
                        break;
                    }
                }

                if(Object.keys(seekObj).length > cur_lim) {
                    search_Obj = [];
                    for(var idx in seekObj) {
                        if(seekObj.hasOwnProperty(idx)) {
                            search_Obj.push(seekObj[idx]);
                        }
                    }
                    callback(err, search_Obj);
                }
                else {
                    if(loop_count >= 6) {
                        search_Obj = [];
                        for(idx in seekObj) {
                            if(seekObj.hasOwnProperty(idx)) {
                                search_Obj.push(seekObj[idx]);
                            }
                        }
                        callback(err, search_Obj);
                    }
                    else {
                        var foundCount = Object.keys(seekObj).length;
                        search_resource_action(ri, query, parseInt(cur_lim, 10) - foundCount, pi_list, cni, loop_count, seekObj, function (err, search_Obj) {
                            callback(err, search_Obj);
                        });
                    }
                }
            }
            else {
                callback(err, search_Obj);
            }
        }
        else {
            callback(err, search_Obj);
        }
    });
}

function build_discovery_sql(ri, query, cur_lim, pi_list, cni) {
//    var list_ri = '';
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

    if (query.cty != null) {
        query_where += ' and ';
        query_where += util.format('cnf = \'%s\'', query.cty);
        query_count++;
    }

    if (query.la != null) {
        query_where += util.format(' limit %s offset %s ', parseInt(query.la, 10) + 1, ((parseInt(cni, 10) - parseInt(query.la, 10)) > 0) ? (parseInt(cni, 10) - parseInt(query.la, 10)) : 0);
        query_count++;
    }
    else {
        query_where += ' limit ' + cur_lim;
        if (query.ofst != null) {
            query_where += util.format(' offset %s', query.ofst);
        }
    }
    query_where = "select a.* from (select ri from lookup where ((ri = \'" + ri + "\') or (pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+"))" + ty_str + ") " + query_where + " ) b left join lookup as a on b.ri = a.ri ";
    //query_where = util.format("select a.* from (select ri from lookup where ((ri = \'" + ri + "\') or (pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and ((\'%s\' < ct) and (ct <= \'%s\')))) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;
    //query_where = util.format("select a.* from (select ri from lookup where ((ri = \'" + ri + "\') or pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and (ct > \'%s\' and ct <= \'%s\') limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;
    //query_where = util.format("select a.* from (select ri from lookup where (pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+")) %s and (ct > \'%s\' and ct <= \'%s\') order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct, cur_ct) + query_where;

    return query_where;
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

    var seekObj = {};
    search_resource_action(ri, query, cur_lim, cur_pi, cni, 0, seekObj, function (err, search_Obj) {
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
    // //console.log(loop_cnt + ' - ' + sql);
    // db.getResult(sql, '', function (err, search_Obj) {
    //     if(!err) {
    //         if(search_Obj.length > 0) {
    //             for(var i = 0; i < search_Obj.length; i++) {
    //                 found_Obj[search_Obj[i].ri] = search_Obj[i];
    //                 if(Object.keys(found_Obj).length >= query.lim) {
    //                     break;
    //                 }
    //             }
    //
    //             if(Object.keys(found_Obj).length >= query.lim) {
    //                 select_spec_ri(found_Obj, 0, function (err, found_Obj) {
    //                     console.timeEnd('search_lookup (' + search_tid + ')');
    //                     callback(err, found_Obj, response);
    //                 });
    //             }
    //             else {
    //                 select_spec_ri(found_Obj, 0, function (err, found_Obj) {
    //                     if (pi_index >= pi_list.length) {
    //                         console.timeEnd('search_lookup (' + search_tid + ')');
    //                         callback(err, found_Obj, response);
    //                     }
    //                     else {
    //                         cur_lim = parseInt(query.lim) - Object.keys(found_Obj).length;
    //                         _this.search_lookup(ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, ++loop_cnt, response, function (err, found_Obj, response) {
    //                             callback(err, found_Obj, response);
    //                         });
    //                     }
    //                 });
    //             }
    //         }
    //         else {
    //             if (pi_index >= pi_list.length) {
    //                 console.timeEnd('search_lookup (' + search_tid + ')');
    //                 callback(err, found_Obj, response);
    //             }
    //             else {
    //                 cur_lim = parseInt(query.lim) - Object.keys(found_Obj).length;
    //                 _this.search_lookup(ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, ++loop_cnt, response, function (err, found_Obj, response) {
    //                     callback(err, found_Obj, response);
    //                 });
    //             }
    //         }
    //     }
    //     else {
    //         callback(err, search_Obj, response);
    //     }
    // });
};

exports.select_latest_resource = function(parentObj, loop_count, callback) {
    var before_ct = moment().subtract(Math.pow(5, ++loop_count), 'minutes').utc().format('YYYYMMDDTHHmmss');

    var sql = util.format('select * from (select * from lookup where (pi = \'%s\' and ct > \'%s\') and ty = \'%s\') b join %s as a on b.ri = a.ri', parentObj.ri, before_ct, parseInt(parentObj.ty, 10) + 1, responder.typeRsrc[parseInt(parentObj.ty, 10) + 1]);
    db.getResult(sql, '', function (err, results_latest) {
        if(!err) {
            if(results_latest.length > 0) {
                var latest_cin = [];
                latest_cin.push(results_latest[results_latest.length-1]);
                callback(err, latest_cin);
            }
            else {
                if(loop_count >= 6) {
                    latest_cin = [];
                    callback(err, latest_cin);
                }
                else {
                    _this.select_latest_resource(parentObj, loop_count, function (err, resultObj) {
                        callback(err, resultObj);
                    });
                }
            }
        }
        else {
            callback(err, results_latest);
        }
    });
};

exports.select_oldest_resource = function(ty, ri, callback) {
    console.time('select_oldest ' + ri);
    //var sql = util.format('select a.* from (select ri from lookup where (pi = \'%s\') limit 100) b left join lookup as a on b.ri = a.ri where a.ty = \'4\' or a.ty = \'30\' limit 1', ri);
    var sql = 'select * from lookup where pi = \'' + ri + '\' and ty = \'' + ty + '\'';
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

exports.select_lookup = function(ri, callback) {
    //var tid = require('shortid').generate();
    //console.time('select_lookup ' + ri + ' (' + tid + ')');
    var sql = util.format("select * from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, direct_Obj) {
        //console.timeEnd('select_lookup ' + ri + ' (' + tid + ')');
        callback(err, direct_Obj);
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
    console.time('select_sub');
    var sql = util.format('select * from sub where pi = \'%s\'', pi);
    db.getResult(sql, '', function (err, results_ss) {
        console.timeEnd('select_sub');
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

exports.select_st = function (ri, callback) {
    var sql = util.format("select ri, st from lookup where ri = \'%s\'", ri);

    db.getResult(sql, '', function (err, results_st) {
        callback(err, results_st);
    });
};

exports.select_oldests = function (obj, count, callback) {
    var sql = util.format('select * from (select * from lookup where pi = \'%s\' and ty = \'%s\' limit %s) b join %s as a on b.ri = a.ri', obj.ri, parseInt(obj.ty, 10) + 1, count, responder.typeRsrc[parseInt(obj.ty, 10) + 1]);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
    });
};

exports.delete_oldests = function (obj, count, callback) {
    var del_id = 'delete_oldests (' + count + ') ' + obj.ri + ' - ' + require('shortid').generate() + '';
    console.time(del_id);
    var sql = util.format('delete from lookup where pi = \'%s\' and ty = \'%s\' limit %s', obj.ri, parseInt(obj.ty, 10) + 1, count);
    db.getResult(sql, '', function (err, results) {
        console.timeEnd(del_id);
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
    var sql = util.format('select lookup.st, count(*), sum(%s.cs) FROM lookup, %s where lookup.ri = \'%s\' and cin.pi = \'%s\'', responder.typeRsrc[ty], responder.typeRsrc[ty], ri, ri);
    db.getResult(sql, '', function (err, results) {
        callback(err, results);
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

exports.update_st = function (obj, callback) {
    var st_id = 'update_st ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(st_id);
    var sql = util.format('update lookup set st = st+1 where ri=\'%s\'', obj.ri);
    db.getResult(sql, '', function (err, results) {
        console.timeEnd(st_id);
        callback(err, results);
    });
};

exports.update_lookup = function (obj, callback) {
    //console.time('update_lookup ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', subl = \'%s\' where ri = \'%s\'',
        obj.lt, JSON.stringify(obj.acpi), obj.et, obj.st, JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), JSON.stringify(obj.subl), obj.ri);
    db.getResult(sql1, '', function (err, results) {
        //console.timeEnd('update_lookup ' + ri);
        callback(err, results);
    });
};

exports.update_acp = function (obj, callback) {
    console.time('update_acp ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update acp set pv = \'%s\', pvs = \'%s\' where ri = \'%s\'',
                JSON.stringify(obj.pv), JSON.stringify(obj.pvs), obj.ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_acp ' + obj.ri);
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

exports.update_ae = function (obj, callback) {
    console.time('update_ae ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update ae set apn = \'%s\', poa = \'%s\', ae.or = \'%s\', rr = \'%s\' where ri = \'%s\'',
                obj.apn, JSON.stringify(obj.poa), obj.or, obj.rr, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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
            callback(err, results);
        }
    });
};

exports.update_cnt = function (obj, callback) {
    var cnt_id = 'update_cnt ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cnt_id);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update cnt set mni = \'%s\', mbs = \'%s\', mia = \'%s\', li = \'%s\', cnt.or = \'%s\', cni = \'%s\', cbs = \'%s\' where ri = \'%s\'',
                obj.mni, obj.mbs, obj.mia, obj.li, obj.or, obj.cni, obj.cbs, obj.ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd(cnt_id);
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

exports.update_grp = function (obj, callback) {
    console.time('update_grp ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update grp set mnm = \'%s\', mid = \'%s\', macp = \'%s\', gn = \'%s\' where ri = \'%s\'',
                obj.mnm, JSON.stringify(obj.mid), JSON.stringify(obj.macp), obj.gn, obj.ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_grp ' + obj.ri);
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

exports.update_lcp = function (obj, callback) {
    console.time('update_lcp ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update lcp set lou = \'%s\', lon = \'%s\' where ri = \'%s\'',
                obj.lou, obj.lon, obj.ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_lcp ' + obj.ri);
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

exports.update_fwr = function (obj, callback) {
    console.time('update_fwr ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', vr = \'%s\', fwnnam = \'%s\', url = \'%s\', ud = \'%s\', uds = \'%s\' where ri = \'%s\'',
                obj.dc, obj.vr, obj.fwnnam, obj.url, obj.ud, JSON.stringify(obj.uds), obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_bat = function (obj, callback) {
    console.time('update_bat ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', btl = \'%s\', bts = \'%s\' where ri = \'%s\'', obj.dc, obj.btl, obj.bts, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_dvi = function (obj, callback) {
    console.time('update_dvi ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', dbl = \'%s\', man = \'%s\', mgo.mod = \'%s\', dty = \'%s\', fwv = \'%s\', swv = \'%s\', hwv = \'%s\' where ri = \'%s\'',
                obj.dc, obj.dbl, obj.man, obj.mod, obj.dty, obj.fwv, obj.swv, obj.hwv, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_dvc = function (obj, callback) {
    console.time('update_dvc ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', can = \'%s\', att = \'%s\', cas = \'%s\', cus = \'%s\', ena = \'%s\', dis = \'%s\' where ri = \'%s\'',
                obj.dc, obj.can, obj.att, JSON.stringify(obj.cas), obj.cus, obj.ena, obj.dis, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_rbo = function (obj, callback) {
    console.time('update_rbo ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mgo set dc = \'%s\', rbo = \'%s\', far = \'%s\' where ri = \'%s\'',
                obj.dc, obj.rbo, obj.far, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_nod = function (obj, callback) {
    console.time('update_nod ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update nod set ni = \'%s\', mgca = \'%s\' where ri = \'%s\'', obj.ni, obj.mgca, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_csr = function (obj, callback) {
    console.time('update_csr ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update csr set poa = \'%s\', mei = \'%s\', tri = \'%s\', rr = \'%s\', nl = \'%s\' where ri = \'%s\'',
                JSON.stringify(obj.poa), obj.mei, obj.tri, obj.rr, obj.nl, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_req = function (ri, pc, op, mi, rs, ors, callback) {
    console.time('update_req ' + ri);
    //var sql2 = util.format('update req set pc = \'%s\', rs = \'%s\' where ri = \'%s\'', (new Buffer(pc)).toString('base64'), rs, ri);
    var sql2 = util.format('update req set pc = \'%s\', op = \'%s\', mi = \'%s\', rs = \'%s\', ors = \'%s\' where ri = \'%s\'', pc, op, mi, rs, ors, ri);
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

exports.update_sub = function (obj, callback) {
    console.time('update_sub ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update sub set enc = \'%s\', exc = \'%s\', nu = \'%s\', gpi = \'%s\', nfu = \'%s\', bn = \'%s\', rl = \'%s\', pn = \'%s\', nsp = \'%s\', ln = \'%s\', nct = \'%s\', nec = \'%s\' where ri = \'%s\'',
                JSON.stringify(obj.enc), obj.exc, JSON.stringify(obj.nu), obj.gpi, obj.nfu, JSON.stringify(obj.bn), obj.rl, obj.pn, obj.nsp, obj.ln, obj.nct, obj.nec, obj.ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_sub ' + obj.ri);
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

exports.update_smd = function (obj, callback) {
    console.time('update_smd ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update smd set dsp = \'%s\', dcrp = \'%s\', soe = \'%s\', rels = \'%s\', smd.or = \'%s\' where ri = \'%s\'',
                obj.dsp, obj.dcrp, obj.soe, JSON.stringify(obj.rels), obj.or, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_ts = function (obj, callback) {
    console.time('update_ts ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update ts set mni = \'%s\', mbs = \'%s\', mia = \'%s\', ts.or = \'%s\', mdn = \'%s\', mdt = \'%s\', mdlt = \'%s\', mdc = \'%s\'  where ri = \'%s\'',
                obj.mni, obj.mbs, obj.mia, obj.or, obj.mdn, obj.mdt, obj.mdlt, obj.mdc, obj.ri);
            db.getResult(sql2, '', function (err, results) {
                if (!err) {
                    console.timeEnd('update_ts ' + obj.ri);
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

exports.update_mms = function (obj, callback) {
    console.time('update_mms ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update mms set stid = \'%s\', asd = \'%s\', osd = \'%s\', sst = \'%s\' where ri = \'%s\'',
                obj.stid, obj.asd, obj.osd, obj.sst, obj.ri);
            db.getResult(sql2, '', function (err, results) {
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

exports.update_tm = function (obj, callback) {
    console.time('update_tm ' + obj.ri);
    _this.update_lookup(obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update tm set cr = \'%s\', tctl = \'%s\', tst = \'%s\', tmr = \'%s\', tmh = \'%s\', rsps = \'%s\' where ri = \'%s\'',
                obj.cr, obj.tctl, obj.tst, obj.tmr, obj.tmh, JSON.stringify(obj.rsps), obj.ri);
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
    _this.update_lookup(obj, function (err, results) {
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

exports.update_cnt_cni = function (obj, callback) {
    var cni_id = 'update_cnt_cni ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);
    var sql = util.format('update cnt, lookup set cnt.cni = \'%s\', cnt.cbs = \'%s\', lookup.st = \'%s\' where lookup.ri = \'%s\' and cnt.ri = \'%s\'', obj.cni, obj.cbs, obj.st, obj.ri, obj.ri);
    db.getResult(sql, '', function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_cnt_by_cni = function (obj, cs, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var cni_id = 'update_cnt_by_cni ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);
    var sql = util.format('update %s, lookup set %s.cni = %s.cni+1, %s.cbs = %s.cbs+%s, lookup.st = lookup.st+1 where lookup.ri = \'%s\' and %s.ri = \'%s\'', tableName, tableName, tableName, tableName, tableName, cs, obj.ri, tableName,  obj.ri);
    db.getResult(sql, '', function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
            callback(err, results);
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