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
var http = require('http');
var moment = require('moment');

var sgn = require('./sgn');
var responder = require('./responder');
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

    for(var index in resource_Obj[rootnm]) {
        if(resource_Obj[rootnm].hasOwnProperty(index)) {
            if (resource_Obj[rootnm][index] == null || resource_Obj[rootnm][index] == '' || resource_Obj[rootnm][index] == 'undefined' || resource_Obj[rootnm][index] == '[]') {
                delete resource_Obj[rootnm][index];
            }
        }
    }
};


function check_TS(ri, callback) {
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var options = {
        hostname: 'localhost',
        port: usetsagentport,
        path: '/missingDataDetect',
        method: 'post',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/xml',
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/vnd.onem2m-res+xml'
        }
    };

    var jsonObj = {};
    jsonObj.ri = ri;
    var reqBodyString = js2xmlparser('ts', JSON.stringify(jsonObj));

    var responseBody = '';
    var req = http.request(options, function (res) {
        //res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function() {
            callback(res.headers['x-m2m-rsc'], responseBody);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[check_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}

function delete_TS(ri, callback) {
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var options = {
        hostname: 'localhost',
        port: usetsagentport,
        path: '/missingDataDetect',
        method: 'delete',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': usecseid
        }
    };

    var reqBodyString = '';

    var responseBody = '';
    var req = http.request(options, function (res) {
        //res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function() {
            callback(res.headers['x-m2m-rsc'], responseBody);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[delete_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}

function create_action_cni(ri, ty, pi, mni, cs, callback) {
    if(ty == '4') {
        var sql = util.format("select cni, cbs, st from cnt, lookup where cnt.ri = \'%s\' and lookup.ri = \'%s\'", pi, pi);
    }
    else {
        sql = util.format("select cni, cbs, st from ts, lookup where cnt.ri = \'%s\' and lookup.ri = \'%s\'", pi, pi);
    }
    db.getResult(sql, '', function (err, results_cni) {
        if (results_cni.length == 1) {
            var cni = results_cni[0]['cni'];
            var cbs = results_cni[0]['cbs'];
            var st = results_cni[0]['st'];
            if (parseInt(cni, 10) >= parseInt(mni, 10)) {
                sql = util.format("select ri, cs from lookup where pi = \'%s\' and ty = \'%s\' order by ri asc limit 1", pi, ty);
                db.getResult(sql, '', function (err, results) {
                    if (results.length == 1) {
                        cni = (parseInt(cni, 10) - 1).toString();
                        cbs = (parseInt(cbs, 10) - parseInt(results[0].cs, 10)).toString();
                        sql = util.format("delete from lookup where ri = \'%s\'", results[0].ri);
                        db.getResult(sql, '', function (err) {
                            if (!err) {
                                st = (parseInt(st, 10) + 1).toString();
                                cni = (parseInt(cni, 10) + 1).toString();
                                cbs = (parseInt(cbs, 10) + parseInt(cs, 10)).toString();
                                results_cni[0].st = st;
                                results_cni[0].cni = cni;
                                results_cni[0].cbs = cbs;
                                if (ty == '4') {
                                    sql = util.format("update cnt, lookup set cnt.cni = \'%s\', cnt.cbs = \'%s\', lookup.st = \'%s\'  where cnt.ri = \'%s\' and lookup.ri = \'%s\'", cni, cbs, st, pi, pi);
                                }
                                else {
                                    sql = util.format("update ts, lookup set ts.cni = \'%s\', ts.cbs = \'%s\', lookup.st = \'%s\'  where ts.ri = \'%s\' and lookup.ri = \'%s\'", cni, cbs, st, pi, pi);
                                }
                                db.getResult(sql, results_cni[0], function (err, results) {
                                    if (!err) {
                                        db_sql.update_st_lookup(st, ri, function (err, results) {
                                            if (!err) {
                                                callback('1');
                                            }
                                            else {
                                                var body_Obj = {};
                                                body_Obj['rsp'] = {};
                                                body_Obj['rsp'].cap = results.message;
                                                console.log(JSON.stringify(body_Obj));
                                                callback('0');
                                                return '0';
                                            }
                                        });
                                    }
                                    else {
                                        var body_Obj = {};
                                        body_Obj['rsp'] = {};
                                        body_Obj['rsp'].cap = results.message;
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
                st = (parseInt(st, 10) + 1).toString();
                cni = (parseInt(cni, 10) + 1).toString();
                cbs = (parseInt(cbs, 10) + parseInt(cs, 10)).toString();
                results_cni[0].st = st;
                results_cni[0].cni = cni;
                results_cni[0].cbs = cbs;
                if (ty == '4') {
                    sql = util.format("update cnt, lookup set cnt.cni = \'%s\', cnt.cbs = \'%s\', lookup.st = \'%s\'  where cnt.ri = \'%s\' and lookup.ri = \'%s\'", cni, cbs, st, pi, pi);
                }
                else {
                    sql = util.format("update ts, lookup set ts.cni = \'%s\', ts.cbs = \'%s\', lookup.st = \'%s\'  where ts.ri = \'%s\' and lookup.ri = \'%s\'", cni, cbs, st, pi, pi);
                }
                db.getResult(sql, results_cni[0], function (err, results) {
                    if (!err) {
                        db_sql.update_st_lookup(st, ri, function (err, results) {
                            if (!err) {
                                callback('1', st);
                            }
                            else {
                                var body_Obj = {};
                                body_Obj['rsp'] = {};
                                body_Obj['rsp'].cap = results.message;
                                console.log(JSON.stringify(body_Obj));
                                callback('0');
                                return '0';
                            }
                        });
                    }
                    else {
                        var body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        //responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), results.message);
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
    var body_Obj = {};

    if(ty == '1') {
        db_sql.insert_acp(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            JSON.stringify(resource_Obj[rootnm].pv), JSON.stringify(resource_Obj[rootnm].pvs), function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '2') {
        db_sql.insert_ae(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].apn, resource_Obj[rootnm].api, resource_Obj[rootnm].aei, JSON.stringify(resource_Obj[rootnm].poa),
            resource_Obj[rootnm].or, resource_Obj[rootnm].nl, resource_Obj[rootnm].rr, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '3') {
        db_sql.insert_cnt(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].cr, resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia,
            resource_Obj[rootnm].cni, resource_Obj[rootnm].cbs, resource_Obj[rootnm].li, resource_Obj[rootnm].or, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '4') {
        db_sql.insert_cin(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].cr, resource_Obj[rootnm].cnf, resource_Obj[rootnm].or,
            resource_Obj[rootnm].con, function (err, results) {
                if (!err) {
                    create_action_cni(resource_Obj[rootnm].ri, resource_Obj[rootnm].ty, resource_Obj[rootnm].pi, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, function(rsc, st) {
                        resource_Obj[rootnm].st = st;
                        delete resource_Obj[rootnm].mni;
                        callback('1', resource_Obj);
                    });
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '9') {
        db_sql.insert_grp(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].cr, resource_Obj[rootnm].mt, resource_Obj[rootnm].cnm, resource_Obj[rootnm].mnm,
            JSON.stringify(resource_Obj[rootnm].mid), JSON.stringify(resource_Obj[rootnm].macp), resource_Obj[rootnm].mtv, resource_Obj[rootnm].csy, resource_Obj[rootnm].gn, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '10') {
        db_sql.insert_lcp(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].los, resource_Obj[rootnm].lou, resource_Obj[rootnm].lot, resource_Obj[rootnm].lor,
            resource_Obj[rootnm].loi, resource_Obj[rootnm].lon, resource_Obj[rootnm].lost, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '16') {
        db_sql.insert_csr(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].cst, JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].cb, resource_Obj[rootnm].csi,
            resource_Obj[rootnm].mei, resource_Obj[rootnm].tri, resource_Obj[rootnm].rr, resource_Obj[rootnm].nl, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '23') {
        db_sql.insert_sub(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            JSON.stringify(resource_Obj[rootnm].enc), resource_Obj[rootnm].exc, JSON.stringify(resource_Obj[rootnm].nu),
            resource_Obj[rootnm].gpi, resource_Obj[rootnm].nfu, resource_Obj[rootnm].bn, resource_Obj[rootnm].rl, resource_Obj[rootnm].psn,
            resource_Obj[rootnm].pn, resource_Obj[rootnm].nsp, resource_Obj[rootnm].ln, resource_Obj[rootnm].nct, resource_Obj[rootnm].nec,
            resource_Obj[rootnm].cr, resource_Obj[rootnm].su, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '24') {
        db_sql.insert_sd(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].cr, resource_Obj[rootnm].dspt, resource_Obj[rootnm].or, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '25') {
        db_sql.insert_ts(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].cr, resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia,
            resource_Obj[rootnm].cni, resource_Obj[rootnm].cbs, resource_Obj[rootnm].or, resource_Obj[rootnm].pin, resource_Obj[rootnm].mdd,
            resource_Obj[rootnm].mdmn, resource_Obj[rootnm].mdl, resource_Obj[rootnm].mdcn, resource_Obj[rootnm].mddt, function (err, results) {
                if (!err) {
                    check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                    });
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '26') {
        db_sql.insert_tsi(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].dgt, resource_Obj[rootnm].con, resource_Obj[rootnm].sqn, function (err, results) {
                if (!err) {
                    create_action_cni(resource_Obj[rootnm].ri, resource_Obj[rootnm].ty, resource_Obj[rootnm].pi, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, function(rsc, st) {
                        resource_Obj[rootnm].st = st;
                        delete resource_Obj[rootnm].mni;
                        callback('1', resource_Obj);
                    });
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '27') {
        db_sql.insert_mms(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs,
            resource_Obj[rootnm].sid, resource_Obj[rootnm].soid, resource_Obj[rootnm].stid, resource_Obj[rootnm].asd,
            resource_Obj[rootnm].osd, resource_Obj[rootnm].sst, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 409, body_Obj, 4105, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['rsp'] = {};
                        body_Obj['rsp'].cap = results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = "ty does not supported";
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }
}


function build_resource(request, response, ty, body_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    var cur_d = new Date();
    var msec = (parseInt(cur_d.getMilliseconds(), 10)<10) ? ('00'+cur_d.getMilliseconds()) : ((parseInt(cur_d.getMilliseconds(), 10)<100) ? ('0'+cur_d.getMilliseconds()) : cur_d.getMilliseconds());

    resource_Obj[rootnm].rn = ty + '-' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec + randomValueBase64(4);
    resource_Obj[rootnm].rn = resource_Obj[rootnm].rn.toLowerCase();

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
    var et = new Date();
    et.setYear(cur_d.getFullYear()+1); // adds time to existing time
    resource_Obj[rootnm].et = et.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
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
            body_Obj['rsp'].cap = result_Obj.message;
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

                if(request.query.rcn == 2) { // hierarchical address
                    request.headers.rootnm = 'uri';
                    var resource_Obj = {};
                    resource_Obj.uri = {};
                    resource_Obj.uri = create_Obj[rootnm].ri;
                    responder.response_result(request, response, 200, resource_Obj, 2000, create_Obj[rootnm].ri, '');
                    return 0;
                }
                else if(request.query.rcn == 3) { // hierarchical address and attributes
                    request.headers.rootnm = rootnm;
                    create_Obj.rce = {};
                    create_Obj.rce.uri = create_Obj[rootnm].ri;
                    create_Obj.rce[rootnm] = create_Obj[rootnm];
                    delete create_Obj[rootnm];
                    responder.response_rcn3_result(request, response, 200, create_Obj, 2000, create_Obj.rce[rootnm].ri, '');
                    return '0';
                }
                else {
                    responder.response_result(request, response, 201, create_Obj, 2001, create_Obj[rootnm].ri, '');
                    return '0';
                }
            }
        });
    });
};

function presearch_action(request, response, ri_list, comm_Obj, callback) {
    //var rootnm = request.headers.rootnm;
    var pi_list = [];
    db_sql.search_parents_lookup(comm_Obj.ri, function (err, search_Obj) {
        if(!err) {
            for(var i = 0; i < search_Obj.length; i++) {
                pi_list.push(search_Obj[i].ri);
            }

            var finding_Obj = [];
            var found_Obj = {};
            var cur_d = moment().utc().format('YYYY-MM-DD HH:mm:ss');
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
                    search_Obj['rsp'].cap = search_Obj.message;
                    responder.response_result(request, response, 500, search_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), search_Obj['rsp'].cap);
                    callback('0', search_Obj);
                    return '0';
                }
            });
        }
        else {
            search_Obj = {};
            search_Obj['rsp'] = {};
            search_Obj['rsp'].cap = search_Obj.message;
            responder.response_result(request, response, 500, search_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), search_Obj['rsp'].cap);
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

    //var rootnm = request.headers.rootnm;

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
            spec_Obj['rsp'].cap = spec_Obj.message;
            responder.response_result(request, response, 500, spec_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), spec_Obj['rsp'].cap);
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
            spec_Obj['rsp'].cap = spec_Obj.message;
            responder.response_result(request, response, 500, spec_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), spec_Obj['rsp'].cap);
            callback('0', resource_Obj);
            return '0';
        }
    });
}

function get_resource(request, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    callback('1', resource_Obj);
}

function search_resource(request, callback) {
    var rootnm = 'agr';
    request.headers.rootnm = 'agr';
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    callback('1', resource_Obj);
}

exports.retrieve = function(request, response, comm_Obj) {
    var ty = comm_Obj.ty;

    if(request.query.fu == 2 && request.query.rcn == 1) {
        _this.set_rootnm(request, ty);

        var rootnm = request.headers.rootnm;

        get_resource(request, function (rsc) {
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
        search_resource(request, function (rsc, resource_Obj) {
            if (rsc == '0') {
                return rsc;
            }
            var ri_list = [];
            presearch_action(request, response, ri_list, comm_Obj, function (rsc, ri_list, search_Obj) {
                if (rsc == '0') {
                    return rsc;
                }
                if (request.query.fu == 1) {
                    request.headers.rootnm = 'uril';
                    resource_Obj = {};
                    resource_Obj.uril = {};
                    resource_Obj.uril = ri_list;
                    responder.search_result(request, response, 200, resource_Obj, 2000, comm_Obj.ri, '');
                }
                else if (request.query.rcn == 4 || request.query.rcn == 5 ||request.query.rcn == 6) {
                    request.headers.rootnm = 'rsp';
                    search_action(request, response, 0, resource_Obj, ri_list, '{', search_Obj, function (rsc, strObj) {
                        if (rsc == '1') {
                            strObj += '}';
                            resource_Obj = JSON.parse(strObj);
                            for (var index in resource_Obj) {
                                if(resource_Obj.hasOwnProperty(index)) {
                                    resource_Obj[index] = merge(resource_Obj[index], search_Obj[index]);
                                    for (var index2 in resource_Obj[index]) {
                                        if(resource_Obj[index].hasOwnProperty(index2)) {
                                            if (resource_Obj[index][index2] == null || resource_Obj[index][index2] == '' || resource_Obj[index][index2] == 'undefined') {
                                                delete resource_Obj[index][index2];
                                            }
                                        }
                                    }
                                }
                            }
                            responder.search_result(request, response, 200, resource_Obj, 2000, comm_Obj.ri, '');
                        }
                    });
                }
                else {
                    request.headers.rootnm = 'rsp';
                    resource_Obj = {};
                    resource_Obj['rsp'] = {};
                    resource_Obj['rsp'].cap = 'response with hierarchical resource structure mentioned in onem2m spec is not supported instead all the requested resources will be returned !';
                    responder.response_result(request, response, 501, resource_Obj, 5001, url.parse(request.url).pathname.toLowerCase(), resource_Obj['rsp'].cap);
                }
            });
        });
    }
};

function update_action_mni(ty, ri, mni, callback) {
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
                            body_Obj['rsp'].cap = results.message;
                            //responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
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
            body_Obj['rsp'].cap = results.message;
            //responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
            console.log(JSON.stringify(body_Obj));
            callback('0');
            return '0';
        }
    });
}

function update_action( request, response, ty, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var body_Obj = {};

    if(ty == '1') {
        db_sql.update_acp(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            JSON.stringify(resource_Obj[rootnm].pv), JSON.stringify(resource_Obj[rootnm].pvs), function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '2') {
        db_sql.update_ae(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].apn, JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].or, resource_Obj[rootnm].rr, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '3') {
        db_sql.update_cnt(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia, resource_Obj[rootnm].li, resource_Obj[rootnm].or, function (err, results) {
                if (!err) {
                    update_action_mni('4', resource_Obj[rootnm].ri, resource_Obj[rootnm].mni, function(rsc, cni, cbs) {
                        resource_Obj[rootnm].cni = cni;
                        resource_Obj[rootnm].cbs = cbs;
                        callback('1', resource_Obj);
                    });
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '9') {
        db_sql.update_grp(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].mnm, JSON.stringify(resource_Obj[rootnm].mid), JSON.stringify(resource_Obj[rootnm].macp), resource_Obj[rootnm].gn, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '10') {
        db_sql.update_lcp(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].lou, resource_Obj[rootnm].lon, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '16') {
        db_sql.update_csr(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].mei, resource_Obj[rootnm].tri, resource_Obj[rootnm].rr, resource_Obj[rootnm].nl, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '23') {
        db_sql.update_sub(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            JSON.stringify(resource_Obj[rootnm].enc), resource_Obj[rootnm].exc, JSON.stringify(resource_Obj[rootnm].nu), resource_Obj[rootnm].gpi, resource_Obj[rootnm].nfu,
            resource_Obj[rootnm].bn, resource_Obj[rootnm].rl, resource_Obj[rootnm].pn, resource_Obj[rootnm].nsp, resource_Obj[rootnm].ln,
            resource_Obj[rootnm].nct, resource_Obj[rootnm].nec, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '24') {
        db_sql.update_sd(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].dspt, resource_Obj[rootnm].or, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '25') {
        db_sql.update_ts(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia, resource_Obj[rootnm].or,
            resource_Obj[rootnm].mdmn, resource_Obj[rootnm].mddt, resource_Obj[rootnm].mdl, resource_Obj[rootnm].mdcn, function (err, results) {
                if (!err) {
                    check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                    });
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '27') {
        db_sql.update_mms(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].stid, resource_Obj[rootnm].asd, resource_Obj[rootnm].osd, resource_Obj[rootnm].sst, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['rsp'] = {};
                    body_Obj['rsp'].cap = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = "ty does not supported";
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }
}

function update_resource(request, response, ty, body_Obj, resource_Obj, callback) {
//    var rootnm = request.headers.rootnm;
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


function delete_action(request, response, resource_Obj, comm_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var pi_list = [];
    db_sql.search_parents_lookup(comm_Obj.ri, function (err, search_Obj) {
        if(!err) {
            if(search_Obj.length == 0) {
                pi_list.push(comm_Obj.ri);
            }

            for(var i = 0; i < search_Obj.length; i++) {
                pi_list.push(search_Obj[i].ri);
            }

            var finding_Obj = [];
            //var found_Obj = {};
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
                    search_Obj['rsp'].cap = search_Obj.message;
                    responder.response_result(request, response, 500, search_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), search_Obj['rsp'].cap);
                    callback('0', search_Obj);
                    return '0';
                }
            });
        }
        else {
            search_Obj = {};
            search_Obj['rsp'] = {};
            search_Obj['rsp'].cap = search_Obj.message;
            responder.response_result(request, response, 500, search_Obj, 5000, url.parse(request.url).pathname.toLowerCase(), search_Obj['rsp'].cap);
            callback('0', search_Obj);
            return '0';
        }
    });
}

function delete_resource(request, comm_Obj, callback) {
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

    delete_resource(request, comm_Obj, function(rsc, resource_Obj) {
        if(rsc == '0') {
            return rsc;
        }
        delete_action(request, response, resource_Obj, comm_Obj, function(rsc, delete_Obj) {
            if(rsc == '1') {
                _this.remove_no_value(request, delete_Obj);

                sgn.check(request, delete_Obj[rootnm], 4);

                responder.response_result(request, response, 200, delete_Obj, 2002, delete_Obj[rootnm].ri, '');
                return '0';
            }
        });
    });
};

