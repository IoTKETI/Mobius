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
const {callback} = require("pg/lib/native/query");

var _this = this;

global.max_lim = 2000;

const max_search_count = 2000;
const max_parent_count = 2000;

const geoJsonTypeText = {
    '1': 'Point',
    '2': 'LineString',
    '3': 'Polygon',
    '4': 'MultiPoint',
    '5': 'MultiLineString',
    '6': 'MultiPolygon'
};

const geoJsonTypeNum = {
     'Point': 1,
     'LineString': 2,
     'Polygon': 3,
     'MultiPoint': 4,
     'MultiLineString': 5,
     'MultiPolygon': 6
};



exports.set_tuning = function(connection, callback) {
    var sql = util.format('set global max_connections = 2000');
    db.getResult(sql, connection, function (err, results) {
        if(err) {
            //callback(err, results);
            //return;
            console.log(results.message);
        }
        sql = util.format('set global innodb_flush_log_at_trx_commit=0');
        db.getResult(sql, connection, function (err, results) {
            if(err) {
                //callback(err, results);
                //return;
                console.log(results.message);
            }
            sql = util.format('set global sync_binlog=0');
            db.getResult(sql, connection, function (err, results) {
                if(err) {
                    //callback(err, results);
                    //return;
                    console.log(results.message);
                }
                sql = util.format('set global transaction_isolation=\'READ-UNCOMMITTED\'');
                db.getResult(sql, connection, function (err, results) {
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

exports.get_hit_all = function(connection, callback) {
    var until = moment().utc().subtract(1, 'year').format('YYYYMMDD');

    var sql = util.format('select * from hit where ct > \'' + until + '\' limit 1000');
    db.getResult(sql, connection, function (err, results) {
        callback(err, results);
    });
};

exports.set_hit = function(connection, binding, callback) {
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

    var sql = util.format('INSERT INTO hit (ct, http, mqtt, coap, ws) VALUES (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\') ON CONFLICT (ct) DO UPDATE SET http=hit.http+%s, mqtt=hit.mqtt+%s, coap=hit.coap+%s, ws=hit.ws+%s;',
        _ct, _http, _mqtt, _coap, _ws, _http, _mqtt, _coap, _ws);

    db.getResult(sql, connection, function (err, results) {
        callback(err, results);
    });
};

exports.set_hit_n = function(connection, _ct, _http, _mqtt, _coap, _ws, callback) {
    var sql = util.format('INSERT INTO hit (ct, http, mqtt, coap, ws) VALUES (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\') ON DUPLICATE KEY UPDATE http=http+%s, mqtt=mqtt+%s, coap=coap+%s, ws=ws+%s;',
        _ct, _http, _mqtt, _coap, _ws, _http, _mqtt, _coap, _ws);

    db.getResult(sql, connection, function (err, results) {
        callback(err, results);
    });
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
    var sql = util.format('select ri from lookup where sri = \'%s\'', sri);
    db.getResult(sql, connection, function (err, results) {
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

exports.insert_lookup = function(connection, obj, callback) {
    //console.time('insert_lookup ' + obj.ri);

    let locSql = '';
    let geoJsonObj = {};
    if(!obj.hasOwnProperty('loc')) {
        let locObj = {};
        locObj.typ = 1; // 1: Point, 2: Line, 3: Polygon
        locObj.crd = [127.1, 37.4];
        // locObj.typ = 1; // 1: Point, 2: Line, 3: Polygon
        // locObj.crd = [127.16296271344285, 37.4047969850232];
        // locObj.typ = 2; // 1: Point, 2: Line, 3: Polygon
        // locObj.crd = [[100.0, 0.0], [101.0, 0.0], [101.0, 1.0]];
        // locObj.typ = 3; // 1: Point, 2: Line, 3: Polygon
        // locObj.crd = [[[100.0, 0.0], [101.0, 0.0], [101.0, 1.0], [100.0, 1.0], [100.0, 0.0]]];
        obj.loc = locObj;

        geoJsonObj = {};
        geoJsonObj.type = geoJsonTypeText[locObj.typ]; // 1: Point, 2: Line, 3: Polygon
        geoJsonObj.coordinates = JSON.parse(JSON.stringify(locObj.crd));

        locSql = ', ';
        locSql += 'ST_GeomFromGeoJSON(\'';
        locSql += JSON.stringify(geoJsonObj);
        locSql += '\')';
    }
    else {
        geoJsonObj = {};
        geoJsonObj.type = geoJsonTypeText[obj.loc.typ]; // 1: Point, 2: Line, 3: Polygon
        geoJsonObj.coordinates = JSON.parse(JSON.stringify(obj.loc.crd));

        locSql = ', ';
        locSql += 'ST_GeomFromGeoJSON(\'';
        locSql += JSON.stringify(geoJsonObj);
        locSql += '\')';
    }

    let sql = util.format("insert into lookup (" +
        'pi, ri, ty, ct, st, rn, lt, et, acpi, lbl, at, aa, subl, pil, lvl, loc, cr, cs) ' +
        'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        obj.pi, obj.ri, obj.ty, obj.ct, obj.st, obj.rn, obj.lt, obj.et,
        JSON.stringify(obj.acpi),
        JSON.stringify(obj.lbl, null, 4),
        JSON.stringify(obj.at),
        JSON.stringify(obj.aa),
        JSON.stringify(obj.subl),
        JSON.stringify(obj.pil),
        (obj.ri.split('_').length-2),
        JSON.stringify(geoJsonObj),
        obj.cr,
        obj.cs
    );
    db.getResult(sql, connection, (err, results) => {
        if(!err) {
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
};

exports.insert_cb = function(connection, obj, callback) {
    console.time('insert_cb ' + obj.ri);
    _this.insert_lookup(connection, obj, (err, results) => {
        if(!err) {
            var sql = util.format('insert into cb (' +
                'ri, cst, csi, srt, poa, nl, ncp, srv) ' +
                'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cst, obj.csi,
                JSON.stringify(obj.srt),
                JSON.stringify(obj.poa),
                obj.nl, obj.ncp,
                JSON.stringify(obj.srv)
            );
            db.getResult(sql, connection, (err, results) => {
                if(!err) {
                    console.timeEnd('insert_cb ' + obj.ri);
                    callback(err, results);
                }
                else {
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, () => {
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

exports.insert_acp = function(connection, obj, callback) {
    console.time('insert_acp ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into acp (ri, pv, pvs) ' +
                'values (\'%s\', \'%s\', \'%s\')',
                obj.ri, JSON.stringify(obj.pv), JSON.stringify(obj.pvs));
            db.getResult(sql, connection, (err, results) => {
                console.timeEnd('insert_acp ' + obj.ri);
                if(!err) {
                    callback(err, results);
                }
                else {
                    console.error('error insert_acp ' + obj.ri);
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, () => {
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

exports.insert_ae = function(connection, obj, callback) {
    console.time('insert_ae ' + obj.ri);
    _this.insert_lookup(connection, obj, (err, results) => {
        if(!err) {
            var sql = util.format('insert into ae (ri, apn, api, aei, poa, \"or\", nl, rr, csz, srv) ' +
                'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.apn, obj.api, obj.aei,
                // JSON.stringify(obj.poa).replace(/\"/g, '\\"').replace(/\'/g, '\\\''),
                JSON.stringify(obj.poa),
                obj.or, obj.nl, obj.rr, obj.csz,
                JSON.stringify(obj.srv));

            db.getResult(sql, connection, (err, results) => {
                console.timeEnd('insert_ae ' + obj.ri);
                if(!err) {
                    callback(err, results);
                }
                else {
                    console.error('error insert_ae ' + obj.ri);
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, () => {
                        callback(err, results);
                    });
                }
            });
        }
        else {
            console.timeEnd('insert_ae ' + obj.ri, ' - ', results);
            callback(err, results);
        }
    });
};

exports.insert_cnt = function(connection, obj, callback) {
    console.time('insert_cnt ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into cnt (ri, mni, mbs, mia, cni, cbs, li, \"or\", disr) ' +
                'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mni, obj.mbs, obj.mia, obj.cni, obj.cbs, obj.li, obj.or, obj.disr);
            db.getResult(sql, connection, (err, results) => {
                console.timeEnd('insert_cnt ' + obj.ri);
                if(!err) {
                    callback(err, results);
                }
                else {
                    console.error('error insert_cnt ' + obj.ri);
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, () => {
                        callback(err, results);
                    });
                }
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

exports.get_cni_count = function(connection, obj, callback) {
    _this.select_count_ri(connection, parseInt(obj.ty, 10), obj.ri, function (err, results) {
        if (results.length == 1) {
            // var cni = results[0]['cni'];
            // var cbs = (results[0]['cbs'] == null) ? 0 : results[0]['sum(cin.cs)'];
            var cni = results[0]['count(*)'];
            var cbs = (results[0]['sum(cin.cs)'] == null) ? 0 : results[0]['sum(cin.cs)'];
            var st = (results[0]['st'] == null) ? 0 : results[0]['st'];

            if (cni > parseInt(obj.mni, 10) || cbs > parseInt(obj.mbs, 10)) {

                if(cni > parseInt(obj.mni, 10)) {
                    var count = (cni - parseInt(obj.mni, 10));
                    if (count > 5000) {
                        count = 5000;
                    }
                }

                else if (cbs > parseInt(obj.mbs, 10)) {
                    count = 1;
                }

                delete_oldest(connection, obj, count, function (err, results_oldest) { // select oldest
                    if (results_oldest.affectedRows == count) {
                        _this.get_cni_count(connection, obj, function (cni, cbs, st) {
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

exports.insert_cin = function(connection, obj, callback) {
    let cin_id = 'insert_cin ' + obj.ri + ' - ' + require('shortid').generate();
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

            var sql = util.format('insert into cin (ri, cnf, \"or\", con) ' +
                'values (\'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cnf, obj.or, (con_type == 'string') ? obj.con.replace(/'/g, "\\'") : JSON.stringify(obj.con));
            db.getResult(sql, connection, (err, results) => {
                console.timeEnd(cin_id);
                if (!err) {
                    callback(err, results);
                }
                else {
                    console.error('error insert_cin ' + obj.ri);
                    sql = util.format("delete from lookup where ri = \'%s\'", obj.ri);
                    db.getResult(sql, connection, () => {
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

exports.insert_grp = function(connection, obj, callback) {
    console.time('insert_grp ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into grp (ri, mt, cnm, mnm, mid, macp, mtv, csy, gn) ' +
                'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.mt, obj.cnm, obj.mnm, JSON.stringify(obj.mid), JSON.stringify(obj.macp), obj.mtv, obj.csy, obj.gn);
            db.getResult(sql, connection, function (err, results) {
                if(!err) {
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


exports.insert_csr = function(connection, obj, callback) {
    console.time('insert_csr ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into csr (ri, cst, poa, cb, csi, mei, tri, rr, nl, srv) ' +
                'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, obj.cst, JSON.stringify(obj.poa), obj.cb, obj.csi, obj.mei, obj.tri, obj.rr, obj.nl, JSON.stringify(obj.srv));
            db.getResult(sql, connection, function (err, results) {
                if(!err) {
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

exports.insert_sub = function(connection, obj, callback) {
    console.time('insert_sub ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if(!err) {
            var sql = util.format('insert into sub (ri, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, su) ' +
                'values (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                obj.ri, JSON.stringify(obj.enc), obj.exc, JSON.stringify(obj.nu), obj.gpi, obj.nfu, JSON.stringify(obj.bn), obj.rl, obj.psn, obj.pn, obj.nsp, obj.ln, obj.nct, obj.nec, obj.su);
            db.getResult(sql, connection, function (err, results) {
                if(!err) {
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
        else {
            callback(err, results);
        }
    });
};

var isEmpty = function(value){
    return value === "" || value === null || value === undefined || (typeof value === "object" && !Object.keys(value).length);
};

let aggregate_cnt = (connection, ty, ri, callback) => {
    if(responder.typeRsrc[ty] === 'cnt') {
        select_count_ri(connection, ty, ri.replace(/\//g, '_'), (err, results) => {
            if (!err) {
                let cni = parseInt(results[0].count);
                let cbs = 0;
                if(isEmpty(results[0].sum)) {
                    cbs = 0;
                }
                else {
                    cbs = parseInt(results[0].sum);
                }
                update_count_ri(connection, ri, cni, cbs, (err, results) => {
                    if (!err) {
                        callback('1', cni, cbs);
                    }
                    else {
                        callback('0');
                    }
                });
            }
            else {
                callback('0');
            }
        });
    }
    else {
        callback('1');
    }
};

exports.select_resource_from_url = function(connection, ri, callback) {
    var sql = util.format('select * from lookup where (ri = \'%s\')', ri.replace(/\//g, '_'));
    db.getResult(sql, connection, (err, comm_Obj) => {
        if(!err) {
            if(comm_Obj.length === 0) {
                callback(err, comm_Obj);
            }
            else {
                let sql = "select * from " + responder.typeRsrc[comm_Obj[0].ty] + " where ri = \'" + comm_Obj[0].ri + "\'";
                db.getResult(sql, connection, (err, spec_Obj) => {
                    delete comm_Obj[0].lvl;

                    var resource_Obj = [];
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
            callback(err, comm_Obj);
        }
    });
};

exports.select_csr_like = function(connection, cb, callback) {
    var sql = util.format("select * from csr where ri like \'_%s_%%\'", cb);
    db.getResult(sql, connection, function (err, results_csr) {
        callback(err, results_csr);
    });
};

exports.select_csr = function(connection, ri, callback) {
    var sql = util.format("select * from csr where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, results_csr) {
        callback(err, results_csr);
    });
};

exports.select_ae = function(connection, ri, callback) {
    var sql = util.format("select * from ae where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, results_ae) {
        callback(err, results_ae);
    });
};

function build_search_query(query, callback) {
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

function search_parents_lookup_action(connection, pi_list, count, cur_result_ri, result_ri, callback) {
    if(count >= pi_list.length) {
        callback('200');
        return;
    }

    var sql = util.format("select ri, ty from lookup where pi = \'" + pi_list[count] + "\' and ty <> \'1\' and ty <> \'9\' and ty <> \'23\' and ty <> \'4\' and ty <> \'30\' and ty <> \'17\' limit 2000");
    //console.log('search_parents_lookup_action', sql);
    db.getResult(sql, connection, function (err, result_lookup_ri) {
        if(!err) {
            if(result_lookup_ri.length === 0) {
                search_parents_lookup_action(connection, pi_list, ++count, cur_result_ri, result_ri, (code) => {
                    callback(code);
                });
            }
            else {
                for(var idx in result_lookup_ri) {
                    if(result_lookup_ri.hasOwnProperty(idx)) {
                        cur_result_ri.push(result_lookup_ri[idx]);
                        if(cur_result_ri.length > max_parent_count) {
                            break;
                        }
                    }
                }

                result_lookup_ri = null;
                if(cur_result_ri.length > max_parent_count) {
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

exports.search_parents_lookup = function(connection, pi_list, cur_result_ri, result_ri, callback) {
    cur_result_ri = [];
    search_parents_lookup_action(connection, pi_list, 0, cur_result_ri, result_ri, (code) => {
        if(code === '200') {
            if (cur_result_ri.length === 0) {
                callback(code);
            }
            else {
                var pi_list = [];
                for (var idx in cur_result_ri) {
                    if (cur_result_ri.hasOwnProperty(idx)) {
                        pi_list.push(cur_result_ri[idx].ri);
                        result_ri.push(cur_result_ri[idx]);
                    }
                }

                if (pi_list.length === 0) {
                    callback(code);
                }
                else {
                    _this.search_parents_lookup(connection, pi_list, cur_result_ri, result_ri, function (code) {
                        callback(code);
                    });
                }
            }
        }
        else {
            callback(code);
        }
    });
};

let spec_tid = '';
exports.select_spec_ri = function(connection, found_Obj, count, callback) {
    if(Object.keys(found_Obj).length <= count) {
        console.timeEnd('select_spec (' + spec_tid + ')');
        callback('200');
        return;
    }

    if(count === 0) {
        spec_tid = require('shortid').generate();
        console.time('select_spec (' + spec_tid + ')');
    }

    var ri = Object.keys(found_Obj)[count];
    var sql = "select * from " + responder.typeRsrc[found_Obj[ri].ty] + " where ri = \'" + ri + "\'";
    db.getResult(sql, connection, function (err, spec_Obj) {
        if(err) {
            callback('500-1');
        }
        else {
            if(spec_Obj.length >= 1) {
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
};

function search_lookup_action(connection, pi_list, count, result_ri, query_where, callback) {
    if(count >= pi_list.length) {
        callback('200');
        return;
    }

    let pi_sql = util.format('pi in (');
    for (let i in pi_list) {
        if(pi_list.hasOwnProperty(i)) {
            pi_sql += ('\'' + pi_list[i] + '\'');
            if(i < pi_list.length-1) {
                pi_sql += ', ';
            }
            count++;
        }
    }
    pi_sql += ') ';
    var sql = util.format('select * from lookup where ' + pi_sql + query_where);
    db.getResult(sql, connection, function (err, result_lookup_ri) {
        if(!err) {
            if(result_lookup_ri.length === 0) {
                search_lookup_action(connection, pi_list, ++count, result_ri, query_where, function (code) {
                    callback(code);
                });
            }
            else {
                for(var idx in result_lookup_ri) {
                    if(result_lookup_ri.hasOwnProperty(idx)) {
                        result_ri.push(result_lookup_ri[idx]);
                        if(result_ri.length > max_search_count) {
                            break;
                        }
                    }
                }

                if(result_ri.length >= max_search_count) {
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
    if(loop_count >= 20) {
        callback('200');
        return;
    }

    var query_where = '';
    var query_count = 0;
    if (query.lbl != null) {
        query_where = ' and ';
        if (query.lbl.toString().split(',')[1] == null) {
            query_where += util.format(' lbl like \'[%%\"%s\"%%]\'', query.lbl);
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

    if (query.hasOwnProperty('gmty') && query.hasOwnProperty('gsf') && query.hasOwnProperty('geom')) {
        let geoJsonObj = {};
        geoJsonObj.type = geoJsonTypeText[query.gmty]; // 1: Point, 2: Line, 3: Polygon
        geoJsonObj.coordinates = JSON.parse(JSON.stringify(JSON.parse(query.geom)));

        let locSql = 'ST_GeomFromGeoJSON(\'';
        locSql += JSON.stringify(geoJsonObj);
        locSql += '\')';

        query_where += ' and (ty=2 or ty=3 or ty=5 or ty=16)';

        if(query.gsf == 1) {
            query_where += ' and ';
            query_where += util.format('ST_Within(loc, ' + locSql + ')');
            query_count++;
        }
        else if(query.gsf == 2) {
            query_where += ' and ';
            query_where += util.format('ST_Contains(loc, ' + locSql + ')');
            query_count++;
        }
        else if(query.gsf == 3) {
            query_where += ' and ';
            query_where += util.format('ST_Intersects(loc, ' + locSql + ')');
            query_count++;
        }
    }

    if (query.la != null) {
        cur_lim = parseInt(query.la, 10);

        // var before_ct = moment().subtract(Math.pow(2, loop_count*1), 'minutes').utc().format('YYYYMMDDTHHmmss');
        //
        // query_where += ' and ';
        // query_where += util.format(' (\'%s\' < ct) ', before_ct);
        // query_count++;

        query_where += util.format(' order by lookup.ct desc limit %s', cur_lim);
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
        if(code === '200') {
            search_Obj = search_Obj.reverse();
            for(var i in search_Obj) {
                if(search_Obj.hasOwnProperty(i)) {
                    seekObj[search_Obj[i].ri] = search_Obj[i];
                    if (Object.keys(seekObj).length >= cur_lim) {
                        break;
                    }
                }
            }

            callback(code);

            // if (query.la != null) {
            //     if(Object.keys(seekObj).length >= cur_lim) {
            //         callback(code);
            //     }
            //     else {
            //         var foundCount = Object.keys(seekObj).length;
            //         search_resource_action(connection, ri, query, parseInt(cur_lim, 10) - foundCount, pi_list, cni, ++loop_count, seekObj, function (code) {
            //             callback(code);
            //         });
            //     }
            // }
            // else {
            //     callback(code);
            // }
        }
        else {
            callback(code);
        }
    });
}

let search_tid = '';
exports.search_lookup = function (connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, loop_cnt, callback) {
    if (pi_index >= pi_list.length) {
        console.timeEnd('search_lookup (' + search_tid + ')');
        callback('200');
        return;
    }

    var cur_pi = [];

    if(loop_cnt == 0) {
        search_tid = require('shortid').generate();
        console.time('search_lookup (' + search_tid + ')');
    }

    for(let idx = 0; idx < 32; idx++) {
        if (pi_index < pi_list.length) {
            cur_pi.push(pi_list[pi_index++]);
        }
        else {
            break;
        }
    }

    var seekObj = {};
    search_resource_action(connection, ri, query, cur_lim, cur_pi, cni, 0, seekObj, function (code) {
        if(code === '200') {
            var search_Obj = [];
            for(var idx in seekObj) {
                if(seekObj.hasOwnProperty(idx)) {
                    search_Obj.push(seekObj[idx]);
                }
            }

            if(search_Obj.length > 0) {
                for(var i = 0; i < search_Obj.length; i++) {
                    found_Obj[search_Obj[i].ri] = search_Obj[i];
                    if(Object.keys(found_Obj).length >= query.lim) {
                        break;
                    }
                }

                if(Object.keys(found_Obj).length >= query.lim) {
                    console.timeEnd('search_lookup (' + search_tid + ')');
                    callback('200');
                }
                else {
                    cur_lim = parseInt(query.lim) - Object.keys(found_Obj).length;
                    _this.search_lookup(connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, ++loop_cnt, function (code) {
                        callback(code);
                    });
                }
            }
            else {
                cur_lim = parseInt(query.lim) - Object.keys(found_Obj).length;
                _this.search_lookup(connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, found_Cnt, cni, cur_d, ++loop_cnt, function (code) {
                    callback(code);
                });
            }
        }
        else {
            callback(code);
        }
    });
};

let select_latest_resources = (connection, parentObj, count, latestObj, callback) => {
    let tableName = responder.typeRsrc[parseInt(parentObj.ty, 10)+1];
    let sql = util.format('select * from lookup inner join %s on lookup.ri = %s.ri where lookup.pi = \'%s\' order by lookup.ct desc limit %s',
        tableName, tableName, parentObj.ri, count);
    db.getResult(sql, connection, (err, results_latest) => {
        if(!err) {
            let latest_ri = results_latest[0].ri;
            let latest_obj = {};
            for(let i = 0; i < results_latest.length; i++) {
                if(results_latest[i].ri >= latest_ri) {
                    latest_obj = results_latest[i];
                }
            }
            latestObj.push(latest_obj);
            callback('200');
        }
        else {
            callback('500-1');
        }
    });
};

let select_oldest_resources = (connection, parentObj, count, oldestObj, callback) => {
    let tableName = responder.typeRsrc[parseInt(parentObj.ty, 10)+1];
    let sql = util.format('select * from lookup inner join %s on lookup.ri = %s.ri where lookup.pi = \'%s\' order by lookup.ct asc limit %s',
        tableName, tableName, parentObj.ri, count);
    db.getResult(sql, connection, (err, results_oldest) => {
        if(!err) {
            let latest_ri = results_oldest[0].ri;
            let latest_obj = {};
            for(let i = 0; i < results_oldest.length; i++) {
                if(results_oldest[i].ri >= latest_ri) {
                    latest_obj = results_oldest[i];
                }
            }
            oldestObj.push(latest_obj);
            callback('200');
        }
        else {
            callback('500-1');
        }
    });
};

exports.select_latest_resources = select_latest_resources;
exports.select_oldest_resources = select_oldest_resources;

exports.select_lookup = function(connection, ri, callback) {
    //var tid = require('shortid').generate();
    //console.time('select_lookup ' + ri + ' (' + tid + ')');
    var sql = util.format("select * from lookup where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, direct_Obj) {
        //console.timeEnd('select_lookup ' + ri + ' (' + tid + ')');
        callback(err, direct_Obj);
    });
};

exports.select_ri_lookup = function(connection, ri, callback) {
    console.time('select_ri_lookup ' + ri);
    //var sql = util.format("select ri from lookup where ri = \'%s\'", ri);
    var sql = "select ri from lookup where ri = \'" + ri + "\'";
    db.getResult(sql, connection, function (err, ri_Obj) {
        console.timeEnd('select_ri_lookup ' + ri);
        callback(err, ri_Obj);
    });
};

exports.select_grp_lookup = function(connection, ri, callback) {
    console.time('select_group ' + ri);
    var sql = util.format("select * from lookup where ri = \'%s\' and ty = '9'", ri);
    db.getResult(sql, connection, function (err, group_Obj) {
        console.timeEnd('select_group ' + ri);
        callback(err, group_Obj);
    });
};

exports.select_grp = function(connection, ri, callback) {
    var sql = util.format("select * from grp where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, grp_Obj) {
        callback(err, grp_Obj);
    });
};

exports.select_acp = function(connection, ri, callback) {
    var sql = util.format("select * from acp where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, results_acp) {
        callback(err, results_acp);
    });
};

const select_acp_above = (connection, loop, uri_arr, callback) => {
    let ri = '';
    for (var idx in uri_arr) {
        if (uri_arr.hasOwnProperty(idx)) {
            if (uri_arr[idx] != '') {
                if (idx < uri_arr.length - (loop + 1)) {
                    ri += '_' + uri_arr[idx];
                }
            }
        }
    }

    let sql = util.format("select acpi, ty from lookup where ri = \'%s\'", ri);
    db.getResult(sql, connection, (err, results) => {
        if (!err) {
            if (results.length == 0) {
                callback(err, results);
            }
            else {
                results[0].acpi = JSON.parse(results[0].acpi);

                if (results[0].acpi.length == 0) {
                    if (results[0].ty == '3') {
                        select_acp_above(connection, ++loop, uri_arr, (err, acpiList) => {
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
        else {
            callback(err, results.message);
        }
    });
};

exports.select_acp_above = select_acp_above;

exports.select_acp_in = function(connection, acpiList, callback) {
    var sql = util.format('select * from acp where ri in (' + JSON.stringify(acpiList).replace(/\"/g, '\'').replace('[', '').replace(']', '') + ")");
    db.getResult(sql, connection, function (err, results_acp) {
        callback(err, results_acp);
    });
};

const select_resource_of = async (ri) => {
    const arr_code = await db.connection();
    if(arr_code[0] === '200') {
        const connection = arr_code[1];
        console.time('select_resource_of');
        let sql = util.format('select * from lookup where ri = \'%s\'', ri);
        let res_code = await db.query(sql, connection);
        if(!res_code[0]) {
            let comm_obj = res_code[1];
            let table_name = responder.typeRsrc[comm_obj[0].ty];
            sql = "select * from " + table_name + " where ri = \'" + ri + "\'";
            res_code = await db.query(sql, connection);
            console.timeEnd('select_resource_of');

            if(!res_code[0]) {
                let spec_obj = res_code[1];
                delete comm_obj[0].lvl;

                let resource_obj = [];
                resource_obj.push(merge(comm_obj[0], spec_obj[0]));

                make_array_type(resource_obj[0]);

                return [res_code[0], resource_obj];
            }

            connection.release();
            return res_code;
        }
        else {
            connection.release();
            return res_code;
        }
    }

    return arr_code;
};


const select_resources_under_action = async (ri, ty) => {
    const arr_code = await db.connection();
    if(arr_code[0] === '200') {
        const connection = arr_code[1];
        let table_name = responder.typeRsrc[ty];
        console.time('select_resources_under_action');
        let sql = util.format('select * from lookup inner join %s on lookup.ri = sub.ri where pi = \'%s\' and ty = \'%s\'', table_name, ri, ty);
        let res_code = await db.query(sql, connection);
        console.timeEnd('select_resources_under_action');
        connection.release();

        if(!res_code[0]) {
            for(let i in res_code[1]) {
                if(res_code[1].hasOwnProperty(i)) {
                    make_array_type(res_code[1][i]);
                }
            }
        }
        return res_code;
    }

    return arr_code;
};

const select_trs_under = async (ri) => {
    const ty = '39';
    const arr_code = await db.connection();
    if(arr_code[0] === '200') {
        const connection = arr_code[1];
        let table_name = responder.typeRsrc[ty];
        let _tid = 'select_trs_under ' + require('shortid').generate() + '';
        console.time(_tid);
        let sql = util.format('select * from lookup inner join %s on lookup.ri = %s.ri where pi = \'%s\' and ty = \'%s\'', table_name, table_name, ri, ty);
        let res_code = await db.query(sql, connection);
        console.timeEnd(_tid);
        connection.release();

        if(!res_code[0]) {
            for(let i in res_code[1]) {
                if(res_code[1].hasOwnProperty(i)) {
                    make_array_type(res_code[1][i]);
                }
            }
        }
        return res_code;
    }

    return arr_code;
};

const select_subs_under = async (ri) => {
    const ty = '23';
    const arr_code = await db.connection();
    if(arr_code[0] === '200') {
        const connection = arr_code[1];
        let table_name = responder.typeRsrc[ty];
        let _tid = 'select_subs_under ' + require('shortid').generate() + '';
        console.time(_tid);
        let sql = util.format('select * from lookup inner join %s on lookup.ri = %s.ri where pi = \'%s\' and ty = \'%s\'', table_name, table_name, ri, ty);
        let res_code = await db.query(sql, connection);
        console.timeEnd(_tid);
        connection.release();

        if(!res_code[0]) {
            for(let i in res_code[1]) {
                if(res_code[1].hasOwnProperty(i)) {
                    make_array_type(res_code[1][i]);
                }
            }
        }
        return res_code;
    }

    return arr_code;
};

exports.select_trs_under = select_trs_under;
exports.select_subs_under = select_subs_under;
exports.select_resource_of = select_resource_of;

exports.select_cb = function(connection, ri, callback) {
    var sql = util.format("select * from cb where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, results_cb) {
        callback(err, results_cb);
    });
};

exports.select_cni_parent = function (connection, ty, pi, callback) {
    if(ty == '4') {
        var sql = util.format("select cni, cbs, st, mni, mbs from cnt, lookup where cnt.ri = \'%s\' and lookup.ri = \'%s\'", pi, pi);
    }
    else {
        sql = util.format("select cni, cbs, st, mni, mbs from ts, lookup where ts.ri = \'%s\' and lookup.ri = \'%s\'", pi, pi);
    }

    db.getResult(sql, connection, function (err, results_cni) {
        callback(err, results_cni);
    });
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
    var sql = util.format('delete from lookup where pi = \'%s\' and ty = \'%s\' limit %s', obj.ri, parseInt(obj.ty, 10) + 1, count);
    db.getResult(sql, connection, function (err, results) {
        console.timeEnd(del_id);
        callback(err, results);
    });
}

exports.select_ts = function (connection, ri, callback) {
    var sql = util.format("select * from ts where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, ts_Obj) {
        callback(err, ts_Obj);
    });
};

exports.select_in_ri_list = function (connection, tbl, ri_list, ri_index, found_Obj, loop_cnt, callback) {
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
    db.getResult(sql, connection, function (err, search_Obj) {
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
                    _this.select_in_ri_list(connection, tbl, ri_list, ri_index, found_Obj, loop_cnt, function (err, found_Obj) {
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


exports.select_ts_in = function (connection, ri_list, callback) {
    var sql = util.format("select * from ts where ri in ("+JSON.stringify(ri_list).replace('[','').replace(']','') + ")");
    db.getResult(sql, connection, function (err, ts_Obj) {
        callback(err, ts_Obj);
    });

};

let select_count_ri = (connection, ty, ri, callback) => {
    var sql = util.format('select count(cs), sum(cs) ' +
        'FROM lookup ' +
        'where ty = \'%s\' and pi = \'%s\'', parseInt(ty)+1, ri);
    //var sql = util.format('select lookup.st, %s.cni, %s.cbs FROM lookup, %s where lookup.ri = \'%s\' and %s.ri = \'%s\'', responder.typeRsrc[ty], responder.typeRsrc[ty], responder.typeRsrc[ty], ri, responder.typeRsrc[ty], ri);
    db.getResult(sql, connection, function (err, results) {
        callback(err, results);
    });
};
exports.select_count_ri = select_count_ri;

let update_count_ri = (connection, ri, cni, cbs, callback) => {
    var sql = util.format('update cnt set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'', cni, cbs, ri);

    db.getResult(sql, connection, function (err, results) {
        callback(err, results);
    });
};

exports.update_ts_mdcn_mdl = function (connection, mdc, mdlt, ri, callback) {
    var sql = util.format("update ts set mdc = \'%s\', mdlt = \'%s\' where ri = \'%s\'", mdc, mdlt, ri);
    db.getResult(sql, connection, function (err, results) {
        callback(err, results);
    });
};

exports.update_cb_poa_csi = function (connection, poa, csi, srt, ri, callback) {
    console.time('update_cb_poa_csi ' + ri);
    var sql = util.format('update cb set poa = \'%s\', csi = \'%s\', srt = \'%s\' where ri=\'%s\'', poa, csi, srt, ri);
    db.getResult(sql, connection, function (err, results) {
        console.timeEnd('update_cb_poa_csi ' + ri);
        callback(err, results);
    });
};

exports.update_lookup = function (connection, obj, callback) {
    //console.time('update_lookup ' + ri);
    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', subl = \'%s\' where ri = \'%s\'',
        obj.lt, JSON.stringify(obj.acpi), obj.et, obj.st, JSON.stringify(obj.lbl), JSON.stringify(obj.at), JSON.stringify(obj.aa), JSON.stringify(obj.subl), obj.ri);
    db.getResult(sql1, connection, function (err, results) {
        //console.timeEnd('update_lookup ' + ri);
        callback(err, results);
    });
};

exports.update_acp = function (connection, obj, callback) {
    console.time('update_acp ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update acp set pv = \'%s\', pvs = \'%s\' where ri = \'%s\'',
                JSON.stringify(obj.pv), JSON.stringify(obj.pvs), obj.ri);
            db.getResult(sql2, connection, function (err, results) {
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

exports.update_ae = function (connection, obj, callback) {
    console.time('update_ae ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update ae set apn = \'%s\', poa = \'%s\', \"or\" = \'%s\', rr = \'%s\' where ri = \'%s\'',
                obj.apn, JSON.stringify(obj.poa), obj.or, obj.rr, obj.ri);
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
        else {
            callback(err, results);
        }
    });
};

exports.update_cnt = function (connection, obj, callback) {
    let cnt_id = 'update_cnt ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cnt_id);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            let sql2 = util.format('update cnt set mni = \'%s\', mbs = \'%s\', mia = \'%s\', li = \'%s\', \"or\" = \'%s\', cni = \'%s\', cbs = \'%s\' where ri = \'%s\'',
                obj.mni, obj.mbs, obj.mia, obj.li, obj.or, obj.cni, obj.cbs, obj.ri);
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

exports.update_sub = function (connection, obj, callback) {
    console.time('update_sub ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var sql2 = util.format('update sub set enc = \'%s\', exc = \'%s\', nu = \'%s\', gpi = \'%s\', nfu = \'%s\', bn = \'%s\', rl = \'%s\', pn = \'%s\', nsp = \'%s\', ln = \'%s\', nct = \'%s\', nec = \'%s\' where ri = \'%s\'',
                JSON.stringify(obj.enc), obj.exc, JSON.stringify(obj.nu), obj.gpi, obj.nfu, JSON.stringify(obj.bn), obj.rl, obj.pn, obj.nsp, obj.ln, obj.nct, obj.nec, obj.ri);
            db.getResult(sql2, connection, function (err, results) {
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

exports.update_cnt_cni = function (connection, obj, callback) {
    var cni_id = 'update_cnt_cni ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);
    var sql = util.format('update cnt, lookup set cnt.cni = \'%s\', cnt.cbs = \'%s\', lookup.st = \'%s\' where lookup.ri = \'%s\' and cnt.ri = \'%s\'', obj.cni, obj.cbs, obj.st, obj.ri, obj.ri);
    db.getResult(sql, connection, function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};

let select_oldest_rows = (connection, ty, ri, count, callback) => {
    let oldest_tid = 'select_oldest_rows ' + ri + ' - ' + require('shortid').generate();
    console.time(oldest_tid);
    let sql = util.format('select ri from lookup where pi = \'%s\' and ty = \'%s\' order by ct asc limit %s', ri, ty, count);
    db.getResult(sql, connection, (err, results) => {
        console.timeEnd(oldest_tid);
        callback(err, results);
    });
};

let delete_oldest_rows = (connection, ty, ri, count, callback) => {
    let oldest_tid = 'delete_oldest_rows ' + ri + ' - ' + require('shortid').generate();
    console.time(oldest_tid);
    let sql = util.format('delete from lookup where ri in (select ri from lookup where pi = \'%s\' and ty = \'%s\' order by ct asc limit %s)', ri,parseInt(ty)+1, count);
    db.getResult(sql, connection, (err, results) => {
        console.timeEnd(oldest_tid);
        callback(err, results);
    });
};

let delete_oldest_by_mni_mbs = (connection, ty, ri, cni, cbs, mni, mbs, callback) => {
    if(cni > mni) {
        let diff = parseInt(cni) - parseInt(mni);
        delete_oldest_rows(connection, ty, ri, diff, (err, results) => {
            callback('0');
        });
    }
    else if(cbs > mbs) {
        delete_oldest_rows(connection, ty, ri, 1, (err, results) => {
            callback('0');
        });
    }
    else {
        callback('1');
    }
};

exports.aggregate_cnt = aggregate_cnt;
exports.delete_oldest_by_mni_mbs = delete_oldest_by_mni_mbs;

exports.delete_ri_lookup = function (connection, ri, callback) {
    var sql = util.format("delete from lookup where ri = \'%s\'", ri);
    db.getResult(sql, connection, function (err, delete_Obj) {
        callback(err, delete_Obj);
    });
};

exports.delete_ri_lookup_in = function (connection, ty, ri, offset, callback) {
    var sql = util.format("DELETE FROM lookup WHERE pi = \'%s\' and ty = \'%s\' LIMIT %d", ri, ty, offset);
    //console.log(sql);
    db.getResult(sql, connection, function (err, results) {
        callback(err, results);
    });
};

function delete_lookup_action(connection, pi_list, req_count, callback) {
    if(pi_list.length <= req_count) {
        callback('200');
        return;
    }

    var sql = 'delete from lookup where pi = \'' + pi_list[req_count] + '\'';
    db.getResult(sql, connection, function (err, deleted_Obj) {
        if(!err) {
            console.log('deleted resource(s) of ' + pi_list[req_count]);

            delete_lookup_action(connection, pi_list, ++req_count, function (code) {
                callback(code);
            });
        }
        else {
            callback('500-1');
        }
    });
}

exports.delete_lookup = function (connection, pi_list, pi_index, found_Obj, found_Cnt, callback) {
    var cur_pi = [];

    for(var idx = 0; idx < 32; idx++) {
        if (pi_index < pi_list.length) {
            cur_pi.push(pi_list[pi_index++]);
        }
        else {
            break;
        }
    }

    delete_lookup_action(connection, cur_pi, 0, function (code) {
        if(code === '200') {
            if(pi_index >= pi_list.length) {
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

exports.delete_lookup_et = function (connection, et, callback) {
    var pi_list = [];
    var sql = util.format("select ri from lookup where et < \'%s\' and ty <> \'2\' and ty <> \'3\' and ty <> \'5\'", et);
    db.getResult(sql, connection, function (err, delete_Obj) {
        if(!err) {
            for(var i = 0; i < delete_Obj.length; i++) {
                pi_list.push(delete_Obj[i].ri);
            }

            var finding_Obj = [];
            _this.delete_lookup(connection, pi_list, 0, finding_Obj, 0, function (err, search_Obj) {
                callback(err, search_Obj);
            });
        }
    });
};


exports.delete_req = function (connection, callback) {
    var sql = util.format("delete from lookup where ty = \'17\'");
    db.getResult(sql, connection, function (err, delete_Obj) {
        if(!err) {
            callback(err, delete_Obj);
        }
    });
};


exports.select_sum_cbs = function(connection, callback) {
    var tid = require('shortid').generate();
    console.time('select_sum_cbs ' + tid);
    var sql = util.format('select sum(cbs) from cnt');
    db.getResult(sql, connection, function (err, result_Obj) {
        console.timeEnd('select_sum_cbs ' + tid);
        callback(err, result_Obj);
    });
};

exports.select_sum_ae = function(connection, callback) {
    var tid = require('shortid').generate();
    console.time('select_sum_ae ' + tid);
    var sql = util.format('select count(*) from ae');
    db.getResult(sql, connection, function (err, result_Obj) {
        console.timeEnd('select_sum_ae ' + tid);
        callback(err, result_Obj);
    });
};
