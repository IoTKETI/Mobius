/**
 * Copyright (c) 2015, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2015, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var js2xmlparser = require("js2xmlparser");
var sgn = require('./sgn');
var responder = require('./responder');
var http = require('http');

var csr = require('./csr');
var cnt = require('./cnt');
var cin = require('./cin');
var ae = require('./ae');
var sub = require('./sub');
var sd = require('./sd');
var ts = require('./ts');
var tsi = require('./tsi');
var lcp = require('./lcp');
var mms = require('./mms');
var acp = require('./acp');
var grp = require('./grp');

var util = require('util');
var db = require('./db_action');
var merge = require('merge');


var db_sql = require('./sql_action');

var _this = this;

exports.set_rootnm = function(request, ty) {
    request.headers.rootnm = responder.typeRsrc[ty];
};

exports.remove_no_value = function(request, resource_Obj) {
    var rootnm = request.headers.rootnm;

    for(index in resource_Obj[rootnm]) {
        if(resource_Obj[rootnm][index] == null || resource_Obj[rootnm][index] == '' || resource_Obj[rootnm][index] == 'undefined' || resource_Obj[rootnm][index] == '[]') {
            delete resource_Obj[rootnm][index];
        }
    }
};


function check_TS(ri, callback) {
    var options = {
        hostname: 'localhost',
        port: usetsagentport,
        path: '/missingDataDetect',
        method: 'post',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': '12345',
            'Accept': 'application/xml',
            'X-M2M-Origin': 'Origin',
            'nmtype': 'long',
            'Content-Type': 'application/vnd.onem2m-res+xml'
        }
    };

    var reqBodyString = '';
    var jsonObj = {};
    jsonObj.ri = ri;
    reqBodyString = js2xmlparser('ts', JSON.stringify(jsonObj));

    var responseBody = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function() {
            callback(res.headers['x-m2m-rsc'], responseBody);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}



function delete_oldest(ri, callback) {
    var options = {
        hostname: usecsebase,
        port: usecsebaseport,
        path: ri + '/oldest',
        method: 'delete',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': '12345',
            'Accept': 'application/json',
            'X-M2M-Origin': ri,
            'nmtype': 'short'
        }
    };

    var reqBodyString = '';

    var responseBody = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function() {
            callback(res.headers['x-m2m-rsc'], responseBody);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}


function delete_TS(ri, callback) {
    var options = {
        hostname: 'localhost',
        port: usetsagentport,
        path: '/missingDataDetect',
        method: 'delete',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': '12345',
            'Accept': 'application/xml',
            'X-M2M-Origin': 'Origin',
            'nmtype': 'long'
        }
    };

    var reqBodyString = '';

    var responseBody = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function() {
            callback(res.headers['x-m2m-rsc'], responseBody);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}

function create_action_cni(request, response, ty, pi, mni, cs, callback) {
    if(ty == '4') {
        var sql = util.format("select cni, cbs from cnt where ri = \'%s\'", pi);
    }
    else {
        sql = util.format("select cni, cbs from ts where ri = \'%s\'", pi);
    }
    db.getResult(sql, '', function (err, results_cni) {
        if (results_cni.length == 1) {
            var cni = results_cni[0]['cni'];
            var cbs = results_cni[0]['cbs'];
            if (parseInt(cni, 10) >= parseInt(mni, 10)) {
                sql = util.format("select ri, cs from lookup where pi = \'%s\' and ty = \'%s\' order by ri asc limit 1", pi, ty);
                db.getResult(sql, '', function (err, results) {
                    if (results.length == 1) {
                        cni = (parseInt(cni, 10) - 1).toString();
                        cbs = (parseInt(cbs, 10) - parseInt(results[0].cs, 10)).toString();
                        sql = util.format("delete from lookup where ri = \'%s\'", results[0].ri);
                        db.getResult(sql, '', function (err, results) {
                            if (!err) {
                                cni = (parseInt(cni, 10) + 1).toString();
                                cbs = (parseInt(cbs, 10) + parseInt(cs, 10)).toString();
                                results_cni[0].cni = cni;
                                results_cni[0].cbs = cbs;
                                if (ty == '4') {
                                    sql = util.format("update cnt set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cni, cbs, pi);
                                }
                                else {
                                    sql = util.format("update ts set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cni, cbs, pi);
                                }
                                db.getResult(sql, results_cni[0], function (err, results) {
                                    if (!err) {
                                        callback('1');
                                    }
                                    else {
                                        var body_Obj = {};
                                        body_Obj['rsp'] = {};
                                        body_Obj['rsp'].cap = results.code;
                                        //responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.code);
                                        console.log(JSON.stringify(body_Obj));
                                        callback('0');
                                        return '0';
                                    }
                                });
                            }
                        });
                    }
                });
            }
            else {
                cni = (parseInt(cni, 10) + 1).toString();
                cbs = (parseInt(cbs, 10) + parseInt(cs, 10)).toString();
                results_cni[0].cni = cni;
                results_cni[0].cbs = cbs;
                if (ty == '4') {
                    sql = util.format("update cnt set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cni, cbs, pi);
                }
                else {
                    sql = util.format("update ts set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cni, cbs, pi);
                }
                db.getResult(sql, results_cni[0], function (err, results) {
                    if (!err) {
                        callback('1');
                    }
                    else {
                        var body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.code;
                        //responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.code);
                        console.log(JSON.stringify(body_Obj));
                        callback('0');
                        return '0';
                    }
                });
            }
        }
    });
}

function create_action(request, response, ty, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var queryJson = {};
    var lookupJson = {};
    var resourceJson = {};
    var sql1 = util.format('insert into lookup (ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
        'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
        resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
        resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
        JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs);
    queryJson.type = 'insert';
    lookupJson.ty = resource_Obj[rootnm].ty;
    lookupJson.ri = resource_Obj[rootnm].ri;
    lookupJson.rn = resource_Obj[rootnm].rn;
    lookupJson.pi = resource_Obj[rootnm].pi;
    lookupJson.ct = resource_Obj[rootnm].ct;
    lookupJson.lt = resource_Obj[rootnm].lt;
    lookupJson.et = resource_Obj[rootnm].et;
    lookupJson.acpi = resource_Obj[rootnm].acpi;
    lookupJson.lbl = resource_Obj[rootnm].lbl;
    lookupJson.at = resource_Obj[rootnm].at;
    lookupJson.aa = resource_Obj[rootnm].aa;
    lookupJson.st = resource_Obj[rootnm].st;
    lookupJson.mni = resource_Obj[rootnm].mni;
    lookupJson.cs = resource_Obj[rootnm].cs;

    switch (ty) {
        case '1':
            var sql2 = util.format('insert into acp (ri, pv, pvs) ' +
                'VALUE (\'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, JSON.stringify(resource_Obj[rootnm].pv), JSON.stringify(resource_Obj[rootnm].pvs));
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.pv = resource_Obj[rootnm].pv;
            resourceJson.pvs = resource_Obj[rootnm].pvs;
            break;
        case '2':
            sql2 = util.format('insert into ae (ri, apn, api, aei, poa, ae.or, nl, rr) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].apn, resource_Obj[rootnm].api, resource_Obj[rootnm].aei, JSON.stringify(resource_Obj[rootnm].poa),
                resource_Obj[rootnm].or, resource_Obj[rootnm].nl, resource_Obj[rootnm].rr);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.apn = resource_Obj[rootnm].apn;
            resourceJson.api = resource_Obj[rootnm].api;
            resourceJson.aei = resource_Obj[rootnm].aei;
            resourceJson.poa = resource_Obj[rootnm].poa;
            resourceJson.or = resource_Obj[rootnm].or;
            resourceJson.nl = resource_Obj[rootnm].nl;
            resourceJson.rr = resource_Obj[rootnm].rr;
            break;
        case '3':
            sql2 = util.format('insert into cnt (ri, cr, mni, mbs, mia, cni, cbs, li, cnt.or) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].cr, resource_Obj[rootnm].mni, resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia,
                resource_Obj[rootnm].cni, resource_Obj[rootnm].cbs, resource_Obj[rootnm].li, resource_Obj[rootnm].or);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.cr = resource_Obj[rootnm].cr;
            resourceJson.mni = resource_Obj[rootnm].mni;
            resourceJson.mbs = resource_Obj[rootnm].mbs;
            resourceJson.mia = resource_Obj[rootnm].mia;
            resourceJson.cni = resource_Obj[rootnm].cni;
            resourceJson.cbs = resource_Obj[rootnm].cbs;
            resourceJson.li = resource_Obj[rootnm].li;
            resourceJson.or = resource_Obj[rootnm].or;
            break;
        case '4':
            sql2 = util.format('insert into cin (ri, cr, cnf, cs, cin.or, con) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].cr, resource_Obj[rootnm].cnf, resource_Obj[rootnm].cs, resource_Obj[rootnm].or,
                resource_Obj[rootnm].con);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.cr = resource_Obj[rootnm].cr;
            resourceJson.cnf = resource_Obj[rootnm].cnf;
            resourceJson.cs = resource_Obj[rootnm].cs;
            resourceJson.or = resource_Obj[rootnm].or;
            resourceJson.con = resource_Obj[rootnm].con;
            break;
        case '9':
            sql2 = util.format('insert into grp (ri, cr, mt, cnm, mnm, mid, macp, mtv, csy, gn) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].cr, resource_Obj[rootnm].mt, resource_Obj[rootnm].cnm, resource_Obj[rootnm].mnm,
                JSON.stringify(resource_Obj[rootnm].mid), JSON.stringify(resource_Obj[rootnm].macp), resource_Obj[rootnm].mtv, resource_Obj[rootnm].csy, resource_Obj[rootnm].gn);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.cr = resource_Obj[rootnm].cr;
            resourceJson.mt = resource_Obj[rootnm].mt;
            resourceJson.cnm = resource_Obj[rootnm].cnm;
            resourceJson.mnm = resource_Obj[rootnm].mnm;
            resourceJson.mid = resource_Obj[rootnm].mid;
            resourceJson.macp = resource_Obj[rootnm].macp;
            resourceJson.mtv = resource_Obj[rootnm].mtv;
            resourceJson.csy = resource_Obj[rootnm].csy;
            resourceJson.gn = resource_Obj[rootnm].gn;
            break;
        case '10':
            sql2 = util.format('insert into lcp (ri, los, lou, lot, lor, loi, lon, lost) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].los, resource_Obj[rootnm].lou, resource_Obj[rootnm].lot, resource_Obj[rootnm].lor,
                resource_Obj[rootnm].loi, resource_Obj[rootnm].lon, resource_Obj[rootnm].lost);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.los = resource_Obj[rootnm].los;
            resourceJson.lou = resource_Obj[rootnm].lou;
            resourceJson.lot = resource_Obj[rootnm].lot;
            resourceJson.lor = resource_Obj[rootnm].lor;
            resourceJson.loi = resource_Obj[rootnm].loi;
            resourceJson.lon = resource_Obj[rootnm].lon;
            resourceJson.lost = resource_Obj[rootnm].lost;
            break;
        case '16':
            sql2 = util.format('insert into csr (ri, cst, poa, cb, csi, mei, tri, rr, nl) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].cst, JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].cb, resource_Obj[rootnm].csi,
                resource_Obj[rootnm].mei, resource_Obj[rootnm].tri, resource_Obj[rootnm].rr, resource_Obj[rootnm].nl);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.cst = resource_Obj[rootnm].cst;
            resourceJson.poa = resource_Obj[rootnm].poa;
            resourceJson.cb = resource_Obj[rootnm].cb;
            resourceJson.csi = resource_Obj[rootnm].csi;
            resourceJson.mei = resource_Obj[rootnm].mei;
            resourceJson.tri = resource_Obj[rootnm].tri;
            resourceJson.rr = resource_Obj[rootnm].rr;
            resourceJson.nl = resource_Obj[rootnm].nl;
            break;
        case '23':
            sql2 = util.format('insert into sub (ri, pi, enc, exc, nu, gpi, nfu, bn, rl, psn, pn, nsp, ln, nct, nec, cr, su) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].pi, JSON.stringify(resource_Obj[rootnm].enc), resource_Obj[rootnm].exc, JSON.stringify(resource_Obj[rootnm].nu),
                resource_Obj[rootnm].gpi, resource_Obj[rootnm].nfu, resource_Obj[rootnm].bn, resource_Obj[rootnm].rl, resource_Obj[rootnm].psn,
                resource_Obj[rootnm].pn, resource_Obj[rootnm].nsp, resource_Obj[rootnm].ln, resource_Obj[rootnm].nct, resource_Obj[rootnm].nec,
                resource_Obj[rootnm].cr, resource_Obj[rootnm].su);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.pi = resource_Obj[rootnm].pi;
            resourceJson.enc = resource_Obj[rootnm].enc;
            resourceJson.exc = resource_Obj[rootnm].exc;
            resourceJson.nu = resource_Obj[rootnm].nu;
            resourceJson.gpi = resource_Obj[rootnm].gpi;
            resourceJson.nfu = resource_Obj[rootnm].nfu;
            resourceJson.bn = resource_Obj[rootnm].bn;
            resourceJson.rl = resource_Obj[rootnm].rl;
            resourceJson.psn = resource_Obj[rootnm].psn;
            resourceJson.pn = resource_Obj[rootnm].pn;
            resourceJson.nsp = resource_Obj[rootnm].nsp;
            resourceJson.ln = resource_Obj[rootnm].ln;
            resourceJson.nct = resource_Obj[rootnm].nct;
            resourceJson.nec = resource_Obj[rootnm].nec;
            resourceJson.cr = resource_Obj[rootnm].cr;
            resourceJson.su = resource_Obj[rootnm].su;
            break;
        case '24':
            sql2 = util.format('insert into sd (ri, cr, dspt, sd.or) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].cr, resource_Obj[rootnm].dspt, resource_Obj[rootnm].or);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.cr = resource_Obj[rootnm].cr;
            resourceJson.dspt = resource_Obj[rootnm].dspt;
            resourceJson.or = resource_Obj[rootnm].or;
            break;
        case '25':
            sql2 = util.format('insert into ts (ri, cr, mni, mbs, mia, cni, cbs, ts.or, pin, mdd, mdmn, mdl, mdcn, mddt) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', ' +
                '\'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].cr, resource_Obj[rootnm].mni, resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia,
                resource_Obj[rootnm].cni, resource_Obj[rootnm].cbs, resource_Obj[rootnm].or, resource_Obj[rootnm].pin, resource_Obj[rootnm].mdd,
                resource_Obj[rootnm].mdmn, resource_Obj[rootnm].mdl, resource_Obj[rootnm].mdcn, resource_Obj[rootnm].mddt);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.cr = resource_Obj[rootnm].cr;
            resourceJson.mni = resource_Obj[rootnm].mni;
            resourceJson.mbs = resource_Obj[rootnm].mbs;
            resourceJson.mia = resource_Obj[rootnm].mia;
            resourceJson.cni = resource_Obj[rootnm].cni;
            resourceJson.cbs = resource_Obj[rootnm].cbs;
            resourceJson.or = resource_Obj[rootnm].or;
            resourceJson.pin = resource_Obj[rootnm].pin;
            resourceJson.mdd = resource_Obj[rootnm].mdd;
            resourceJson.mdmn = resource_Obj[rootnm].mdmn;
            resourceJson.mdl = resource_Obj[rootnm].mdl;
            resourceJson.mdcn = resource_Obj[rootnm].mdcn;
            resourceJson.mddt = resource_Obj[rootnm].mddt;
            break;
        case '26':
            sql2 = util.format('insert into tsi (ri, dgt, con, sqn) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].dgt, resource_Obj[rootnm].con, resource_Obj[rootnm].sqn);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.dgt = resource_Obj[rootnm].dgt;
            resourceJson.con = resource_Obj[rootnm].con;
            resourceJson.sqn = resource_Obj[rootnm].sqn;

            break;
        case '27':
            sql2 = util.format('insert into mms (ri, sid, soid, stid, asd, osd, sst) ' +
                'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                resource_Obj[rootnm].ri, resource_Obj[rootnm].sid, resource_Obj[rootnm].soid, resource_Obj[rootnm].stid, resource_Obj[rootnm].asd,
                resource_Obj[rootnm].osd, resource_Obj[rootnm].sst);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.sid = resource_Obj[rootnm].sid;
            resourceJson.soid = resource_Obj[rootnm].soid;
            resourceJson.stid = resource_Obj[rootnm].stid;
            resourceJson.asd = resource_Obj[rootnm].asd;
            resourceJson.osd = resource_Obj[rootnm].osd;
            resourceJson.sst = resource_Obj[rootnm].sst;
            break;
    }

    var body_Obj = {};
    console.time('resource_create');
    queryJson.table = 'lookup';
    queryJson.values = lookupJson;
    db.getResult( sql1, lookupJson, function (err, results) {
        if(!err) {
            queryJson.table = responder.typeRsrc[ty];
            queryJson.values = resourceJson;
            db.getResult( sql2, queryJson, function (err, results) {
                if(!err) {
                    if(ty == 4 || ty == 26) {
                        // create_action_maxnrofinstances(request, response, resource_Obj[rootnm].ty, resource_Obj[rootnm].pi, resource_Obj[rootnm].mni, function(rsc) {
                        //     console.timeEnd('resource_create');
                        //     delete resource_Obj[rootnm].mni;
                        //     callback('1', resource_Obj);
                        // });
                        create_action_cni(request, response, resource_Obj[rootnm].ty, resource_Obj[rootnm].pi, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, function(rsc) {
                            console.timeEnd('resource_create');
                            delete resource_Obj[rootnm].mni;
                            callback('1', resource_Obj);
                        });
                    }
                    else if(ty == 25) {
                        console.timeEnd('resource_create');
                        check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                        });
                        callback('1', resource_Obj);
                    }
                    else if(ty == 16) {
                        console.timeEnd('resource_create');
                        callback('1', resource_Obj);
                    }
                    else {
                        console.timeEnd('resource_create');
                        callback('1', resource_Obj);
                    }
                }
                else {
                    if(results.code == 'ER_DUP_ENTRY') {
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.code;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), results.code);
                    }
                    else {
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.code;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.code);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
        }
        else {
            if(results.code == 'ER_DUP_ENTRY') {
                if(ty == 25) {
                    check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                    });
                }
                body_Obj['rsp'] = {};
                body_Obj['rsp'].cap = results.code;
                responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), results.code);
            }
            else {
                body_Obj['rsp'] = {};
                body_Obj['rsp'].cap = results.code;
                responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.code);
            }
            callback('0', resource_Obj);
            return '0';
        }
    });
}


function build_resource(request, response, ty, body_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    var cur_d = new Date();
    var msec = (parseInt(cur_d.getMilliseconds(), 10)<10) ? ('00'+cur_d.getMilliseconds()) : ((parseInt(cur_d.getMilliseconds(), 10)<100) ? ('0'+cur_d.getMilliseconds()) : cur_d.getMilliseconds());

    resource_Obj[rootnm].rn = ty + '-' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec + randomValueBase64(4);
    if (request.headers['x-m2m-nm'] != null && request.headers['x-m2m-nm'] != '') {
        resource_Obj[rootnm].rn = request.headers['x-m2m-nm'].toLowerCase();
    }
    if (body_Obj[rootnm]['rn'] != null && body_Obj[rootnm]['rn'] != '') {
        resource_Obj[rootnm].rn = body_Obj[rootnm]['rn'].toLowerCase();
    }

    resource_Obj[rootnm].ty = ty;
    resource_Obj[rootnm].pi = url.parse(request.url).pathname.toLowerCase();
    resource_Obj[rootnm].ri = resource_Obj[rootnm].pi + '/' + resource_Obj[rootnm].rn;
    resource_Obj[rootnm].ct = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;

    resource_Obj[rootnm].st = '0';

    resource_Obj[rootnm].mni = '';
    resource_Obj[rootnm].cs = '';

    if(ty == '3' || ty == '25') {
        resource_Obj[rootnm].mni = '9007199254740991';
    }

    if(ty == '4') {
        resource_Obj[rootnm].cs = '0';
    }

    var queryJson = {};
    var sql = util.format("select * from lookup where ri = \'%s\'", resource_Obj[rootnm].ri);
    db.getResult(sql, queryJson, function(err, result_Obj) {
        if(!err) {
            if (result_Obj.length == 1) {
                body_Obj = {};
                body_Obj['rsp'] = {};
                body_Obj['rsp'].cap = "resource is already exist";
                responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                callback('0');
                return '0';
            }
            else {
                switch (ty) {
                    case '1':
                        acp.build_acp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '2':
                        ae.build_ae(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '3':
                        cnt.build_cnt(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '4':
                        cin.build_cin(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '9':
                        grp.build_grp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '10':
                        lcp.build_lcp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '16':
                        csr.build_csr(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '23':
                        sub.build_sub(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '24':
                        sd.build_sd(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '25':
                        ts.build_ts(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '26':
                        tsi.build_tsi(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '27':
                        mms.build_mms(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                }
            }
        }
        else {
            body_Obj = {};
            body_Obj['rsp'] = {};
            body_Obj['rsp'].cap = result_Obj.code;
            responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
            callback('0');
            return '0';
        }
    });
}

exports.create = function(request, response, ty, body_Obj) {
    var rootnm = request.headers.rootnm;
    build_resource(request, response, ty, body_Obj, function(rsc, resource_Obj) {
        if(rsc == '0') {
            return rsc;
        }
        create_action(request, response, ty, resource_Obj, function(rsc, create_Obj) {
            if(rsc == '1') {
                _this.remove_no_value(request, create_Obj);

                sgn.check(request, create_Obj[rootnm], 3);

                response.setHeader('Content-Location', create_Obj[rootnm].ri);

                responder.response_result(request, response, 201, create_Obj, 2001, create_Obj[rootnm].ri, '');
                return '0';
            }
        });
    });
};

function presearch_action(request, response, ty, ri_list, comm_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var pi_list = [];
    db_sql.search_parents_lookup(comm_Obj.ri, function (err, search_Obj) {
        if(!err) {
            for(var i = 0; i < search_Obj.length; i++) {
                pi_list.push(search_Obj[i].ri);
            }

            var finding_Obj = [];
            var found_Obj = {};
            var cur_d = new Date();
            db_sql.search_lookup(request.query.ty, request.query.lbl, request.query.cra, request.query.crb, request.query.lim, pi_list, 0, finding_Obj, 0, cur_d, 0, function (err, search_Obj) {
                if(!err) {
                    if(search_Obj.length >= 1) {
                        for(var i = 0; i < search_Obj.length; i++) {
                            ri_list.push(search_Obj[i].ri);
                            found_Obj[search_Obj[i].ri] = search_Obj[i];
                            delete search_Obj[i];
                        }
                        callback('1', ri_list, found_Obj);
                    }
                    else {
                        search_Obj = {};
                        search_Obj['rsp'] = {};
                        search_Obj['rsp'].cap = 'resource do not exist';
                        responder.response_result(request, response, 404, search_Obj, 4004, url.parse(request.url).pathname.toLowerCase(), 'resource do not exist');
                        callback('0', search_Obj);
                        return '0';
                    }
                }
                else {
                    search_Obj = {};
                    search_Obj['rsp'] = {};
                    search_Obj['rsp'].cap = search_Obj.code;
                    responder.response_result(request, response, 500, search_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), search_Obj.code);
                    callback('0', search_Obj);
                    return '0';
                }
            });
        }
        else {
            search_Obj = {};
            search_Obj['rsp'] = {};
            search_Obj['rsp'].cap = search_Obj.code;
            responder.response_result(request, response, 500, search_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), search_Obj.code);
            callback('0', search_Obj);
            return '0';
        }
    });
}

const ty_list = ['1', '2', '3', '4', '5', '9', '10', /*'13', '14',*/ '16', /*'17',*/ '23', '25', '26', '27', '24'];

function search_action(request, response, seq, resource_Obj, ri_list, strObj, presearch_Obj, callback) {
    if(ty_list.length <= seq) {
        callback('1', strObj);
        return '0';
    }

    var rootnm = request.headers.rootnm;

    var sql = util.format("select * from " + responder.typeRsrc[ty_list[seq]] + " where ri in ("+JSON.stringify(ri_list).replace('[','').replace(']','')+")");

    console.time('search_resource');
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            if(search_Obj.length >= 1) {
                console.timeEnd('search_resource');

                if(strObj.length > 1) {
                    strObj += ',';
                }
                for(var i = 0; i < search_Obj.length; i++) {
                    //strObj += ('\"' + responder.typeRsrc[ty_list[ty]] + '-' + i + '\": ' + JSON.stringify(search_Obj[i]));
                    strObj += ('\"' + search_Obj[i].ri + '\": ' + JSON.stringify(search_Obj[i]));
                    if(i < search_Obj.length-1) {
                        strObj += ',';
                    }
                }
            }
            search_action(request, response, ++seq, resource_Obj, ri_list, strObj, presearch_Obj, function(rsc, strObj) {
                callback(rsc, strObj);
            });
        }
        else {
            /*spec_Obj = {};
            spec_Obj['rsp'] = {};
            spec_Obj['rsp'].cap = spec_Obj.code;
            responder.response_result(request, response, 500, spec_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), spec_Obj.code);
            callback('0', resource_Obj);
            return '0';*/
            callback('1', strObj);
            return '0';
        }
    });
}


function retrieve_action(request, response, ty, comm_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    var sql = util.format("select * from " + responder.typeRsrc[ty] + " where ri = \'%s\'", comm_Obj.ri);

    console.time('resource_retrieve');
    db.getResult(sql, '', function (err, spec_Obj) {
        if(!err) {
            if (spec_Obj.length == 1) {
                console.timeEnd('resource_retrieve');
                if(spec_Obj[0].srt) {
                    spec_Obj[0].srt = JSON.parse(spec_Obj[0].srt);
                }
                if(spec_Obj[0].nu) {
                    spec_Obj[0].nu = JSON.parse(spec_Obj[0].nu);
                }
                if(spec_Obj[0].acpi) {
                    spec_Obj[0].acpi = JSON.parse(spec_Obj[0].acpi);
                }
                if(spec_Obj[0].poa) {
                    spec_Obj[0].poa = JSON.parse(spec_Obj[0].poa);
                }
                if (spec_Obj[0].enc) {
                    spec_Obj[0].enc = JSON.parse(spec_Obj[0].enc);
                }
                if (spec_Obj[0].pv) {
                    spec_Obj[0].pv = JSON.parse(spec_Obj[0].pv);
                }
                if (spec_Obj[0].pvs) {
                    spec_Obj[0].pvs = JSON.parse(spec_Obj[0].pvs);
                }
                if (spec_Obj[0].mid) {
                    spec_Obj[0].mid = JSON.parse(spec_Obj[0].mid);
                }
                resource_Obj[rootnm] = merge(comm_Obj, spec_Obj[0]);
                callback('1', resource_Obj);
            }
            else {
                spec_Obj = {};
                spec_Obj['rsp'] = {};
                spec_Obj['rsp'].cap = 'resource do not exist';
                responder.response_result(request, response, 404, spec_Obj, 4004, url.parse(request.url).pathname.toLowerCase(), spec_Obj['rsp'].cap);
                callback('0', resource_Obj);
                return '0';
            }
        }
        else {
            spec_Obj = {};
            spec_Obj['rsp'] = {};
            spec_Obj['rsp'].cap = spec_Obj.code;
            responder.response_result(request, response, 500, spec_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), spec_Obj.code);
            callback('0', resource_Obj);
            return '0';
        }
    });
}

function get_resource(request, response, ty, comm_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    callback('1', resource_Obj);
}

function search_resource(request, response, ty, comm_Obj, callback) {
    var rootnm = 'agr';
    request.headers.rootnm = 'agr';
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    callback('1', resource_Obj);
}

exports.retrieve = function(request, response, comm_Obj) {
    var ty = comm_Obj.ty;

    if(Object.keys(request.query).length == 0) {
        _this.set_rootnm(request, ty);

        var rootnm = request.headers.rootnm;

        get_resource(request, response, ty, comm_Obj, function (rsc, resource_Obj) {
            if (rsc == '0') {
                return rsc;
            }
            retrieve_action(request, response, ty, comm_Obj, function (rsc, retrieve_Obj) {
                if (rsc == '1') {
                    _this.remove_no_value(request, retrieve_Obj);
                    responder.response_result(request, response, 200, retrieve_Obj, 2000, retrieve_Obj[rootnm].ri, '');
                    return '0';
                }
            });
        });
    }
    else {
        search_resource(request, response, ty, comm_Obj, function (rsc, resource_Obj) {
            if (rsc == '0') {
                return rsc;
            }
            var ri_list = [];
            if(request.query.fu == 1) {
                request.headers.rootnm = 'uril';
            }
            else {
                request.headers.rootnm = 'rsp';
            }
            presearch_action(request, response, ty, ri_list, comm_Obj, function (rsc, ri_list, search_Obj) {
                if (rsc == '0') {
                    return rsc;
                }
                if(request.query.fu == 1) {
                    resource_Obj = {};
                    resource_Obj.uril = {};
                    //resource_Obj.uril = ri_list.toString().replace(/,/g, ' ');
                    resource_Obj.uril = ri_list;
                    responder.search_result(request, response, 200, resource_Obj, 2000, comm_Obj.ri, '');
                }
                else if(request.query.rcn == 5) {
                    resource_Obj = {};
                    resource_Obj['rsp'] = {};
                    resource_Obj['rsp'].cap = 'response with hierarchical resource structure mentioned in onem2m spec is not supported instead all the requested resources will be returned !';
                    responder.response_result(request, response, 501, resource_Obj, 5001, url.parse(request.url).pathname.toLowerCase(), resource_Obj['rsp'].cap);
                }
                else {
                    search_action(request, response, 0, resource_Obj, ri_list, '{', search_Obj, function (rsc, strObj) {
                        if (rsc == '1') {
                            strObj += '}';
                            resource_Obj = JSON.parse(strObj);
                            for(var index in resource_Obj) {
                                resource_Obj[index] = merge(resource_Obj[index], search_Obj[index]);
                                for(var index2 in resource_Obj[index]) {
                                    if(resource_Obj[index][index2] == null || resource_Obj[index][index2] == '' || resource_Obj[index][index2] == 'undefined') {
                                        delete resource_Obj[index][index2];
                                    }
                                }
                            }
                            responder.search_result(request, response, 200, resource_Obj, 2000, comm_Obj.ri, '');
                        }
                    });
                }
            });
        });
    }
};

function update_action_mni(request, response, ty, ri, mni, callback) {
    //var sql = util.format("delete from lookup where ri in (select ri from (select ri from lookup where pi = \'%s\' and ty = \'%s\' order by ri desc limit %s, 9007199254740991) x)", ri, ty, mni);

    if(mni == '18446744073709551615') {
        mni = '9007199254740991';
    }
    var offset = 9007199254740991 - parseInt(mni, 10);
    var sql = util.format("delete from lookup where pi = \'%s\' and ty = \'%s\' order by ri asc limit %d", ri, ty, offset);
    db.getResult(sql, '', function (err, results) {
        if (!err) {
            sql = util.format("select count(ri), sum(cs) from lookup where pi = \'%s\' and ty = \'%s\'", ri, ty);
            db.getResult(sql, '', function (err, results) {
                if (results.length == 1) {
                    var cniObj = {};
                    cniObj.cni = results[0]['count(ri)'];
                    cniObj.cbs = results[0]['sum(cs)'];
                    if (ty == '4') {
                        sql = util.format("update cnt set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cniObj.cni, cniObj.cbs, ri);
                    }
                    else {
                        sql = util.format("update ts set cni = \'%s\', cbs = \'%s\' where ri = \'%s\'", cniObj.cni, cniObj.cbs, ri);
                    }
                    db.getResult(sql, cniObj, function (err, results) {
                        if (!err) {
                            callback('1', cniObj.cni, cniObj.cbs);
                        }
                        else {
                            var body_Obj = {};
                            body_Obj['rsp'] = {};
                            body_Obj['rsp'].cap = results.code;
                            //responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.code);
                            console.log(JSON.stringify(body_Obj));
                            callback('0');
                            return '0';
                        }
                    });
                }
            });
        }
        else {
            var body_Obj = {};
            body_Obj['rsp'] = {};
            body_Obj['rsp'].cap = results.code;
            //responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.code);
            console.log(JSON.stringify(body_Obj));
            callback('0');
            return '0';
        }
    });
}

function update_action( request, response, ty, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var lookupJson = {};
    var resourceJson = {};

    var sql1 = util.format('update lookup set lt = \'%s\', acpi = \'%s\', et = \'%s\', st = \'%s\', lbl = \'%s\', at = \'%s\', aa = \'%s\', mni = \'%s\' where ri = \'%s\'',
        resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
        JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri);
    lookupJson.ri = resource_Obj[rootnm].ri;
    lookupJson.lt = resource_Obj[rootnm].lt;
    lookupJson.et = resource_Obj[rootnm].et;
    lookupJson.acpi = resource_Obj[rootnm].acpi;
    lookupJson.lbl = resource_Obj[rootnm].lbl;
    lookupJson.at = resource_Obj[rootnm].at;
    lookupJson.aa = resource_Obj[rootnm].aa;
    lookupJson.st = resource_Obj[rootnm].st;
    lookupJson.mni = resource_Obj[rootnm].mni;

    var body_Obj = {};
    switch (ty) {
        case '1':
            var sql2 = util.format('update acp set pv = \'%s\', pvs = \'%s\' where ri = \'%s\'',
                JSON.stringify(resource_Obj[rootnm].pv), JSON.stringify(resource_Obj[rootnm].pvs), resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.apn = resource_Obj[rootnm].apn;
            resourceJson.poa = resource_Obj[rootnm].poa;
            resourceJson.or = resource_Obj[rootnm].or;
            resourceJson.rr = resource_Obj[rootnm].rr;
            break;
        case '2':
            sql2 = util.format('update ae set apn = \'%s\', poa = \'%s\', ae.or = \'%s\', rr = \'%s\' where ri = \'%s\'',
                resource_Obj[rootnm].apn, JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].or, resource_Obj[rootnm].rr, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.apn = resource_Obj[rootnm].apn;
            resourceJson.poa = resource_Obj[rootnm].poa;
            resourceJson.or = resource_Obj[rootnm].or;
            resourceJson.rr = resource_Obj[rootnm].rr;
            break;
        case '3':
            sql2 = util.format('update cnt set mni = \'%s\', mbs = \'%s\', mia = \'%s\', li = \'%s\', cnt.or = \'%s\' where ri = \'%s\'',
                resource_Obj[rootnm].mni, resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia, resource_Obj[rootnm].li, resource_Obj[rootnm].or, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.mni = resource_Obj[rootnm].mni;
            resourceJson.mbs = resource_Obj[rootnm].mbs;
            resourceJson.mia = resource_Obj[rootnm].mia;
            resourceJson.li = resource_Obj[rootnm].li;
            resourceJson.or = resource_Obj[rootnm].or;
            break;
        case '9':
            sql2 = util.format('update grp set mnm = \'%s\', mid = \'%s\', macp = \'%s\', gn = \'%s\' where ri = \'%s\'',
                resource_Obj[rootnm].mnm, resource_Obj[rootnm].mid, resource_Obj[rootnm].macp, resource_Obj[rootnm].gn, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.mnm = resource_Obj[rootnm].mnm;
            resourceJson.mid = resource_Obj[rootnm].mid;
            resourceJson.macp = resource_Obj[rootnm].macp;
            resourceJson.gn = resource_Obj[rootnm].gn;
            break;
        case '10':
            sql2 = util.format('update lcp set lou = \'%s\', lon = \'%s\' where ri = \'%s\'',
                resource_Obj[rootnm].lou, resource_Obj[rootnm].lon, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.lou = resource_Obj[rootnm].lou;
            resourceJson.lon = resource_Obj[rootnm].lon;
            break;
        case '16':
            sql2 = util.format('update csr set poa = \'%s\', mei = \'%s\', tri = \'%s\', rr = \'%s\', nl = \'%s\' where ri = \'%s\'',
                JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].mei, resource_Obj[rootnm].tri, resource_Obj[rootnm].rr, resource_Obj[rootnm].nl, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.poa = resource_Obj[rootnm].poa;
            resourceJson.mei = resource_Obj[rootnm].mei;
            resourceJson.tri = resource_Obj[rootnm].tri;
            resourceJson.rr = resource_Obj[rootnm].rr;
            resourceJson.nl = resource_Obj[rootnm].nl;
            break;
        case '23':
            sql2 = util.format('update sub set enc = \'%s\', exc = \'%s\', nu = \'%s\', gpi = \'%s\', nfu = \'%s\', bn = \'%s\', rl = \'%s\', pn = \'%s\', nsp = \'%s\', ln = \'%s\', nct = \'%s\', nec = \'%s\' where ri = \'%s\'',
                JSON.stringify(resource_Obj[rootnm].enc), resource_Obj[rootnm].exc, JSON.stringify(resource_Obj[rootnm].nu), resource_Obj[rootnm].gpi, resource_Obj[rootnm].nfu,
                resource_Obj[rootnm].bn, resource_Obj[rootnm].rl, resource_Obj[rootnm].pn, resource_Obj[rootnm].nsp, resource_Obj[rootnm].ln,
                resource_Obj[rootnm].nct, resource_Obj[rootnm].nec, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.enc = resource_Obj[rootnm].enc;
            resourceJson.exc = resource_Obj[rootnm].exc;
            resourceJson.nu = resource_Obj[rootnm].nu;
            resourceJson.gpi = resource_Obj[rootnm].gpi;
            resourceJson.nfu = resource_Obj[rootnm].nfu;
            resourceJson.bn = resource_Obj[rootnm].bn;
            resourceJson.rl = resource_Obj[rootnm].rl;
            resourceJson.pn = resource_Obj[rootnm].pn;
            resourceJson.nsp = resource_Obj[rootnm].nsp;
            resourceJson.ln = resource_Obj[rootnm].ln;
            resourceJson.nct = resource_Obj[rootnm].nct;
            resourceJson.nec = resource_Obj[rootnm].nec;
            break;
        case '24':
            sql2 = util.format('update sd set dspt = \'%s\', sd.or = \'%s\' where ri = \'%s\'',
                resource_Obj[rootnm].dspt, resource_Obj[rootnm].or, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.dspt = resource_Obj[rootnm].dspt;
            resourceJson.or = resource_Obj[rootnm].or;
            break;
        case '25':
            sql2 = util.format('update ts set mni = \'%s\', mbs = \'%s\', mia = \'%s\', ts.or = \'%s\', mdmn = \'%s\', mddt = \'%s\', mdl = \'%s\', mdcn = \'%s\'  where ri = \'%s\'',
                resource_Obj[rootnm].mni, resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia, resource_Obj[rootnm].or,
                resource_Obj[rootnm].mdmn, resource_Obj[rootnm].mddt, resource_Obj[rootnm].mdl, resource_Obj[rootnm].mdcn, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.mni = resource_Obj[rootnm].mni;
            resourceJson.mbs = resource_Obj[rootnm].mbs;
            resourceJson.mia = resource_Obj[rootnm].mia;
            resourceJson.or = resource_Obj[rootnm].or;
            resourceJson.mdmn = resource_Obj[rootnm].mdmn;
            resourceJson.mdl = resource_Obj[rootnm].mdl;
            resourceJson.mdcn = resource_Obj[rootnm].mdcn;
            resourceJson.mddt = resource_Obj[rootnm].mddt;
            break;
        case '27':
            sql2 = util.format('update mms set stid = \'%s\', asd = \'%s\', osd = \'%s\', sst = \'%s\' where ri = \'%s\'',
                resource_Obj[rootnm].stid, resource_Obj[rootnm].asd, resource_Obj[rootnm].osd, resource_Obj[rootnm].sst, resource_Obj[rootnm].ri);
            resourceJson.ri = resource_Obj[rootnm].ri;
            resourceJson.stid = resource_Obj[rootnm].stid;
            resourceJson.asd = resource_Obj[rootnm].asd;
            resourceJson.osd = resource_Obj[rootnm].osd;
            resourceJson.sst = resource_Obj[rootnm].sst;
            break;
    }

    console.time('resource_update');
    db.getResult( sql1, lookupJson, function (err, results) {
        if(!err) {
            db.getResult( sql2, resourceJson, function (err, results) {
                if(!err) {
                    if(ty == '3') {
                        update_action_mni(request, response, '4', resource_Obj[rootnm].ri, resource_Obj[rootnm].mni, function(rsc, cni, cbs) {
                            console.timeEnd('resource_update');
                            resource_Obj[rootnm].cni = cni;
                            resource_Obj[rootnm].cbs = cbs;
                            callback('1', resource_Obj);
                        });
                    }
                    else if(ty == 25) {
                        console.timeEnd('resource_update');
                        check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                        });
                        callback('1', resource_Obj);
                    }
                    else {
                        console.timeEnd('resource_update');
                        callback('1', resource_Obj);
                    }
                }
                else {
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.code;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.code);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
        }
        else {
            body_Obj['rsp'] = {};
            body_Obj['rsp'].cap = results.code;
            responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.code);
            callback('0', resource_Obj);
            return '0';
        }
    });
}

function update_resource(request, response, ty, body_Obj, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;
    switch (ty) {
        case '1':
            acp.update_acp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '2':
            ae.update_ae(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '3':
            cnt.update_cnt(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '9':
            grp.update_grp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '10':
            lcp.update_lcp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '16':
            csr.update_csr(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '23':
            sub.update_sub(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '24':
            sd.update_sd(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            }); break;
        case '25': 
            ts.update_ts(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            }); 
            break;
        case '27':
            mms.update_mms(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        default:
            body_Obj = {};
            body_Obj['rsp'] = {};
            body_Obj['rsp'].cap = 'request is not supported in oneM2M Spec!';
            responder.response_result(request, response, 405, body_Obj, 4005, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
            callback('0', body_Obj);
            break;
    }
}

exports.update = function(request, response, comm_Obj, body_Obj) {
    var rootnm = request.headers.rootnm;
    var ty = comm_Obj.ty;

    retrieve_action(request, response, ty, comm_Obj, function(rsc, retrieve_Obj) {
        if (rsc == '0') {
            return rsc;
        }
        update_resource(request, response, ty, body_Obj, retrieve_Obj, function(rsc, update_resource_Obj) {
            if (rsc == '0') {
                return rsc;
            }
            update_action(request, response, ty, update_resource_Obj, function(rsc, update_Obj) {
                if(rsc == '1') {
                    _this.remove_no_value(request, update_Obj);

                    sgn.check(request, update_Obj[rootnm], 1);

                    responder.response_result(request, response, 200, update_Obj, 2004, update_Obj[rootnm].ri, '');
                    return '0';
                }
            });
        });
    });
};


function delete_action(request, response, ty, resource_Obj, comm_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var pi_list = [];
    db_sql.search_parents_lookup(comm_Obj.ri, function (err, search_Obj) {
        if(!err) {
            for(var i = 0; i < search_Obj.length; i++) {
                pi_list.push(search_Obj[i].ri);
            }

            var finding_Obj = [];
            var found_Obj = {};
            db_sql.delete_lookup(comm_Obj.ri, pi_list, 0, finding_Obj, 0, function (err, search_Obj) {
                if(!err) {
                    if(comm_Obj.ty == '25') {
                        delete_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                        });
                        callback('1', resource_Obj);
                    }
                    else {
                        callback('1', resource_Obj);
                    }
                }
                else {
                    search_Obj = {};
                    search_Obj['rsp'] = {};
                    search_Obj['rsp'].cap = search_Obj.code;
                    responder.response_result(request, response, 500, search_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), search_Obj.code);
                    callback('0', search_Obj);
                    return '0';
                }
            });
        }
        else {
            search_Obj = {};
            search_Obj['rsp'] = {};
            search_Obj['rsp'].cap = search_Obj.code;
            responder.response_result(request, response, 500, search_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), search_Obj.code);
            callback('0', search_Obj);
            return '0';
        }
    });
    /*
    var sql = util.format("delete from lookup where ri = \'%s\' or ri like \'%s/%%\'", comm_Obj.ri, comm_Obj.ri);

    console.time('resource_delete');
    db.getResult(sql, '', function (err, spec_Obj) {
        if(!err) {
            if(comm_Obj.ty == '25') {
                delete_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                });
                console.timeEnd('resource_delete');
                callback('1', resource_Obj);
            }
            else {
                console.timeEnd('resource_delete');
                callback('1', resource_Obj);
            }
        }
        else {
            spec_Obj = {};
            spec_Obj['rsp'] = {};
            spec_Obj['rsp'].cap = spec_Obj.code;
            responder.response_result(request, response, 500, spec_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), spec_Obj.code);
            callback('0', resource_Obj);
            return '0';
        }
    });*/
}

function delete_resource(request, response, ty, comm_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    resource_Obj[rootnm] = merge(resource_Obj[rootnm], comm_Obj);

    callback('1', resource_Obj);
}

exports.delete = function(request, response, comm_Obj) {
    var ty = comm_Obj.ty;

    _this.set_rootnm(request, ty);

    var rootnm = request.headers.rootnm;

    delete_resource(request, response, ty, comm_Obj, function(rsc, resource_Obj) {
        if(rsc == '0') {
            return rsc;
        }
        delete_action(request, response, ty, resource_Obj, comm_Obj, function(rsc, delete_Obj) {
            if(rsc == '1') {
                _this.remove_no_value(request, delete_Obj);

                sgn.check(request, delete_Obj[rootnm], 4);

                responder.response_result(request, response, 200, delete_Obj, 2002, delete_Obj[rootnm].ri, '');
                return '0';
            }
        });
    });
};

