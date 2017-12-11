/**
 * Copyright (c) 2017, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2017, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var js2xmlparser = require("js2xmlparser");
var http = require('http');
var https = require('https');
var moment = require('moment');
var fs = require('fs');

var sgn = require('./sgn');
var responder = require('./responder');
var csr = require('./csr');
var cnt = require('./cnt');
var cin = require('./cin');
var ae = require('./ae');
var sub = require('./sub');
var smd = require('./smd');
var ts = require('./ts');
var tsi = require('./tsi');
var lcp = require('./lcp');
var mms = require('./mms');
var acp = require('./acp');
var grp = require('./grp');
var req = require('./req');
var nod = require('./nod');
var mgo = require('./mgo');

var util = require('util');
var merge = require('merge');


var db_sql = require('./sql_action');

var _this = this;

global.update_np_attr_list = {};
update_np_attr_list.acp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt'];
update_np_attr_list.csr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cst', 'cb', 'csi'];
update_np_attr_list.ae = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'api', 'aei'];
update_np_attr_list.cnt = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'cni', 'cbs', 'disr'];
update_np_attr_list.sub = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'psn', 'su'];
update_np_attr_list.lcp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'los', 'lot', 'lor', 'loi', 'lon', 'lost'];
update_np_attr_list.grp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'mt', 'cnm', 'mtv', 'csy', 'ssi'];
update_np_attr_list.fwr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.bat = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.dvi = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.dvc = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.rbo = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.nod = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'hcl'];
update_np_attr_list.smd = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr'];
update_np_attr_list.ts = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'cni', 'cbs', 'mdlt', 'mdc'];
update_np_attr_list.mms = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'sid', 'soid'];

global.update_m_attr_list = {};
update_m_attr_list.acp = [];
update_m_attr_list.csr = [];
update_m_attr_list.ae = [];
update_m_attr_list.cnt = [];
update_m_attr_list.sub = [];
update_m_attr_list.lcp = [];
update_m_attr_list.grp = [];
update_m_attr_list.fwr = [];
update_m_attr_list.dvi = [];
update_m_attr_list.dvc = [];
update_m_attr_list.rbo = [];
update_m_attr_list.nod = [];
update_m_attr_list.smd = [];
update_m_attr_list.ts = [];
update_m_attr_list.mms = [];

global.update_opt_attr_list = {};
update_opt_attr_list.fwr = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'vr', 'fwnnam', 'url', 'ud', 'uds'];
update_opt_attr_list.bat = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'btl', 'bts'];
update_opt_attr_list.dvi = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'dlb', 'man', 'mod', 'dty', 'fwv', 'swv', 'hwv'];
update_opt_attr_list.dvc = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'can', 'att', 'cas', 'cus', 'ena', 'dis'];
update_opt_attr_list.rbo = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'rbo', 'far'];
update_opt_attr_list.acp = ['et', 'lbl', 'aa', 'at', 'pv', 'pvs'];
update_opt_attr_list.csr = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'poa', 'mei', 'rr', 'nl', 'tri', 'esi'];
update_opt_attr_list.ae = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'apn', 'poa', 'or', 'nl', 'rr', 'csz', 'esi'];
update_opt_attr_list.cnt = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mni', 'mbs', 'mia', 'li', 'or'];
update_opt_attr_list.sub = ['acpi', 'et', 'lbl', 'daci', 'enc', 'exc', 'nu', 'gpi', 'bn', 'rl', 'pn', 'nsp', 'ln', 'nct', 'nec'];
update_opt_attr_list.lcp = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'lou'];
update_opt_attr_list.grp = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mnm', 'mid', 'macp', 'gn'];
update_opt_attr_list.nod = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'ni', 'mgca'];
update_opt_attr_list.smd = ['acpi', 'et', 'lbl', 'aa', 'at', 'dcrp', 'soe', 'dsp', 'or', 'rels'];
update_opt_attr_list.ts = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mni', 'mbs', 'mia', 'pei', 'mdd', 'mdn', 'mdt', 'or'];
update_opt_attr_list.mms = ['acpi', 'et', 'lbl', 'aa', 'at', 'stid', 'asd', 'osd', 'sst'];


exports.t_isr = function (id, param1, param2, param3) {
    console.log(id, param1, param2, param3);
};

exports.set_rootnm = function(request, ty) {
    request.headers.rootnm = responder.typeRsrc[ty];
};

exports.remove_no_value = function(request, resource_Obj) {
    var rootnm = request.headers.rootnm;

    for(var index in resource_Obj[rootnm]) {
        if(resource_Obj[rootnm].hasOwnProperty(index)) {
            if(request.hash) {
                if(request.hash.split('#')[1] == index) {

                }
                else {
                    delete resource_Obj[rootnm][index];
                }
            }
            else {
                if (typeof resource_Obj[rootnm][index] === 'boolean') {
                    resource_Obj[rootnm][index] = resource_Obj[rootnm][index].toString();
                }
                else if (typeof resource_Obj[rootnm][index] === 'string') {
                    if (resource_Obj[rootnm][index] == '' || resource_Obj[rootnm][index] == 'undefined' || resource_Obj[rootnm][index] == '[]') {
                        delete resource_Obj[rootnm][index];
                    }
                }
                else if (typeof resource_Obj[rootnm][index] === 'number') {
                    resource_Obj[rootnm][index] = resource_Obj[rootnm][index].toString();
                }
                else {
                }
            }
        }
    }
};

global.make_cse_relative = function(resource_Obj) {
    for(var index in resource_Obj) {
        if(resource_Obj.hasOwnProperty(index)) {
            resource_Obj[index] = resource_Obj[index].replace('/', '');
        }
    }
};

global.make_internal_ri = function(resource_Obj) {
    for(var index in resource_Obj) {
        if(resource_Obj.hasOwnProperty(index)) {
            if(resource_Obj[index].split(usespid + usecseid+'/')[0] == '') { // absolute relative
                resource_Obj[index] = resource_Obj[index].replace(usespid + usecseid+'/', '/');
            }
            else if(resource_Obj[index].split(usecseid+'/')[0] == '') { // sp relative
                resource_Obj[index] = resource_Obj[index].replace(usecseid+'/', '/');
            }
            else if(resource_Obj[index].split(usecsebase)[0] == '') { // cse relative
                resource_Obj[index] = '/' + resource_Obj[index];
            }
        }
    }
};

function check_TS(ri, callback) {
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var jsonObj = {};
    jsonObj.ts = {};
    jsonObj.ts.ri = ri;
    var reqBodyString = JSON.stringify(jsonObj);

    var responseBody = '';

    if(usesecure == 'disable') {
        var options = {
            hostname: 'localhost',
            port: usetsagentport,
            path: '/missingDataDetect',
            method: 'post',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/json',
                'X-M2M-Origin': usecseid,
                'Content-Type': 'application/vnd.onem2m-res+json'
            }
        };

        var req = http.request(options, function (res) {
            //res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }
    else {
        options = {
            hostname: 'localhost',
            port: usetsagentport,
            path: '/missingDataDetect',
            method: 'post',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/json',
                'X-M2M-Origin': usecseid,
                'Content-Type': 'application/vnd.onem2m-res+json'
            },
            ca: fs.readFileSync('ca-crt.pem')
        };

        req = https.request(options, function (res) {
            //res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[check_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}

function delete_TS(callback) {
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var reqBodyString = '';

    var responseBody = '';

    if(usesecure == 'disable') {
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

        var req = http.request(options, function (res) {
            //res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }
    else {
        options = {
            hostname: 'localhost',
            port: usetsagentport,
            path: '/missingDataDetect',
            method: 'delete',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/json',
                'X-M2M-Origin': usecseid
            },
            ca: fs.readFileSync('ca-crt.pem')
        };

        req = https.request(options, function (res) {
            //res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }

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
    db_sql.select_cni_parent(ty, pi, function (err, results_cni) {
        if (results_cni.length == 1) {
            var cni = results_cni[0]['cni'];
            var cbs = results_cni[0]['cbs'];
            var st = results_cni[0]['st'];
            if (parseInt(cni, 10) >= parseInt(mni, 10)) {
                db_sql.select_cs_parent(ty, pi, function (err, results) {
                    if (results.length == 1) {
                        cni = (parseInt(cni, 10) - 1).toString();
                        cbs = (parseInt(cbs, 10) - parseInt(results[0].cs, 10)).toString();
                        db_sql.delete_ri_lookup(results[0].ri, function (err) {
                            if (!err) {
                                st = (parseInt(st, 10) + 1).toString();
                                cni = (parseInt(cni, 10) + 1).toString();
                                cbs = (parseInt(cbs, 10) + parseInt(cs, 10)).toString();
                                results_cni[0].st = st;
                                results_cni[0].cni = cni;
                                results_cni[0].cbs = cbs;
                                db_sql.update_cni_parent(ty, cni, cbs, st, pi, function (err, results) {
                                    if (!err) {
                                        db_sql.update_st_lookup(st, ri, function (err, results) {
                                            if (!err) {
                                                callback('1');
                                            }
                                            else {
                                                var body_Obj = {};
                                                body_Obj['dbg'] = results.message;
                                                console.log(JSON.stringify(body_Obj));
                                                callback('0');
                                                return '0';
                                            }
                                        });
                                    }
                                    else {
                                        var body_Obj = {};
                                        body_Obj['dbg'] = results.message;
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
                db_sql.update_cni_parent(ty, cni, cbs, st, pi, function (err, results) {
                    if (!err) {
                        db_sql.update_st_lookup(st, ri, function (err, results) {
                            if (!err) {
                                callback('1', st);
                            }
                            else {
                                var body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                console.log(JSON.stringify(body_Obj));
                                callback('0');
                                return '0';
                            }
                        });
                    }
                    else {
                        var body_Obj = {};
                        body_Obj['dbg'] = results.message;
                        //responder.response_result(request, response, 500, body_Obj, 5000, request.url, results.message);
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

    db_sql.get_sri_sri(resource_Obj[rootnm].pi, function (err, results) {
        if(!err) {
            resource_Obj[rootnm].spi = (results.length == 0) ? '' : results[0].sri;
            resource_Obj[rootnm].sri = require('shortid').generate();

            if (ty == '1') {
                db_sql.insert_acp(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    JSON.stringify(resource_Obj[rootnm].pv), JSON.stringify(resource_Obj[rootnm].pvs), function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '2') {
                resource_Obj[rootnm].sri = resource_Obj[rootnm].aei;
                db_sql.insert_ae(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].apn, resource_Obj[rootnm].api, resource_Obj[rootnm].aei, JSON.stringify(resource_Obj[rootnm].poa),
                    resource_Obj[rootnm].or, resource_Obj[rootnm].nl, resource_Obj[rootnm].rr, resource_Obj[rootnm].csz, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '3') {
                db_sql.insert_cnt(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].cr, resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia,
                    resource_Obj[rootnm].cni, resource_Obj[rootnm].cbs, resource_Obj[rootnm].li, resource_Obj[rootnm].or, resource_Obj[rootnm].disr, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '4') {
                db_sql.insert_cin(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].cr, resource_Obj[rootnm].or, resource_Obj[rootnm].con, function (err, results) {
                        if (!err) {
                            create_action_cni(resource_Obj[rootnm].ri, resource_Obj[rootnm].ty, resource_Obj[rootnm].pi, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, function (rsc, st) {
                                resource_Obj[rootnm].st = st;
                                delete resource_Obj[rootnm].mni;
                                callback('1', resource_Obj);
                            });
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '9') {
                db_sql.insert_grp(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].cr, resource_Obj[rootnm].mt, resource_Obj[rootnm].cnm, resource_Obj[rootnm].mnm,
                    JSON.stringify(resource_Obj[rootnm].mid), JSON.stringify(resource_Obj[rootnm].macp), resource_Obj[rootnm].mtv, resource_Obj[rootnm].csy, resource_Obj[rootnm].gn, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '10') {
                db_sql.insert_lcp(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].los, resource_Obj[rootnm].lou, resource_Obj[rootnm].lot, resource_Obj[rootnm].lor,
                    resource_Obj[rootnm].loi, resource_Obj[rootnm].lon, resource_Obj[rootnm].lost, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '13') {
                if(resource_Obj[rootnm].mgd == 1001) {
                    db_sql.insert_fwr(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                        resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                        JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                        resource_Obj[rootnm].mgd, resource_Obj[rootnm].objs, resource_Obj[rootnm].obps, resource_Obj[rootnm].dc,
                        resource_Obj[rootnm].vr, resource_Obj[rootnm].fwnnam, resource_Obj[rootnm].url, resource_Obj[rootnm].ud, JSON.stringify(resource_Obj[rootnm].uds), function (err, results) {
                            if (!err) {
                                callback('1', resource_Obj);
                            }
                            else {
                                if (results.code == 'ER_DUP_ENTRY') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                                }
                                callback('0', resource_Obj);
                                return '0';
                            }
                        });
                }
                else if(resource_Obj[rootnm].mgd == 1006) {
                    db_sql.insert_bat(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                        resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                        JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                        resource_Obj[rootnm].mgd, resource_Obj[rootnm].objs, resource_Obj[rootnm].obps, resource_Obj[rootnm].dc,
                        resource_Obj[rootnm].btl, resource_Obj[rootnm].bts, function (err, results) {
                            if (!err) {
                                callback('1', resource_Obj);
                            }
                            else {
                                if (results.code == 'ER_DUP_ENTRY') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                                }
                                callback('0', resource_Obj);
                                return '0';
                            }
                        });
                }
                else if(resource_Obj[rootnm].mgd == 1007) {
                    db_sql.insert_dvi(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                        resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                        JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                        resource_Obj[rootnm].mgd, resource_Obj[rootnm].objs, resource_Obj[rootnm].obps, resource_Obj[rootnm].dc,
                        resource_Obj[rootnm].dbl, resource_Obj[rootnm].man, resource_Obj[rootnm].mod, resource_Obj[rootnm].dty, resource_Obj[rootnm].fwv, resource_Obj[rootnm].swv, resource_Obj[rootnm].hwv, function (err, results) {
                            if (!err) {
                                callback('1', resource_Obj);
                            }
                            else {
                                if (results.code == 'ER_DUP_ENTRY') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                                }
                                callback('0', resource_Obj);
                                return '0';
                            }
                        });
                }
                else if(resource_Obj[rootnm].mgd == 1008) {
                    db_sql.insert_dvc(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                        resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                        JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                        resource_Obj[rootnm].mgd, resource_Obj[rootnm].objs, resource_Obj[rootnm].obps, resource_Obj[rootnm].dc,
                        resource_Obj[rootnm].can, resource_Obj[rootnm].att, JSON.stringify(resource_Obj[rootnm].cas), resource_Obj[rootnm].cus, resource_Obj[rootnm].ena, resource_Obj[rootnm].dis, function (err, results) {
                            if (!err) {
                                callback('1', resource_Obj);
                            }
                            else {
                                if (results.code == 'ER_DUP_ENTRY') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                                }
                                callback('0', resource_Obj);
                                return '0';
                            }
                        });
                }
                else if(resource_Obj[rootnm].mgd == 1009) {
                    db_sql.insert_rbo(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                        resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                        JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                        resource_Obj[rootnm].mgd, resource_Obj[rootnm].objs, resource_Obj[rootnm].obps, resource_Obj[rootnm].dc,
                        resource_Obj[rootnm].rbo, resource_Obj[rootnm].far, function (err, results) {
                            if (!err) {
                                callback('1', resource_Obj);
                            }
                            else {
                                if (results.code == 'ER_DUP_ENTRY') {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = results.message;
                                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                                }
                                callback('0', resource_Obj);
                                return '0';
                            }
                        });
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = "this resource of mgmtObj is not supported";
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                }
            }
            else if (ty == '14') {
                db_sql.insert_nod(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].ni, resource_Obj[rootnm].hcl, resource_Obj[rootnm].mgca, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '16') {
                db_sql.insert_csr(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].cst, JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].cb, resource_Obj[rootnm].csi,
                    resource_Obj[rootnm].mei, resource_Obj[rootnm].tri, resource_Obj[rootnm].rr, resource_Obj[rootnm].nl, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '17') {
                db_sql.insert_req(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].op, resource_Obj[rootnm].tg, resource_Obj[rootnm].org, resource_Obj[rootnm].rid,
                    resource_Obj[rootnm].mi, resource_Obj[rootnm].pc, resource_Obj[rootnm].rs, resource_Obj[rootnm].ors, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '23') {
                db_sql.insert_sub(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    JSON.stringify(resource_Obj[rootnm].enc), resource_Obj[rootnm].exc, JSON.stringify(resource_Obj[rootnm].nu),
                    resource_Obj[rootnm].gpi, resource_Obj[rootnm].nfu, JSON.stringify(resource_Obj[rootnm].bn), resource_Obj[rootnm].rl, resource_Obj[rootnm].psn,
                    resource_Obj[rootnm].pn, resource_Obj[rootnm].nsp, resource_Obj[rootnm].ln, resource_Obj[rootnm].nct, resource_Obj[rootnm].nec,
                    resource_Obj[rootnm].cr, resource_Obj[rootnm].su, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '24') {
                db_sql.insert_smd(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].cr, resource_Obj[rootnm].dsp, resource_Obj[rootnm].dcrp, resource_Obj[rootnm].soe, JSON.stringify(resource_Obj[rootnm].rels), resource_Obj[rootnm].or, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '29') {
                db_sql.insert_ts(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].cr, resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia,
                    resource_Obj[rootnm].cni, resource_Obj[rootnm].cbs, resource_Obj[rootnm].or, resource_Obj[rootnm].pei, resource_Obj[rootnm].mdd,
                    resource_Obj[rootnm].mdn, resource_Obj[rootnm].mdlt, resource_Obj[rootnm].mdc, resource_Obj[rootnm].mdt, function (err, results) {
                        if (!err) {
                            check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                            });
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '30') {
                db_sql.insert_tsi(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].dgt, resource_Obj[rootnm].con, resource_Obj[rootnm].sqn, function (err, results) {
                        if (!err) {
                            create_action_cni(resource_Obj[rootnm].ri, resource_Obj[rootnm].ty, resource_Obj[rootnm].pi, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, function (rsc, st) {
                                resource_Obj[rootnm].st = st;
                                delete resource_Obj[rootnm].mni;
                                callback('1', resource_Obj);
                            });
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (ty == '27') {
                db_sql.insert_mms(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].cnf, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi,
                    resource_Obj[rootnm].sid, resource_Obj[rootnm].soid, resource_Obj[rootnm].stid, resource_Obj[rootnm].asd,
                    resource_Obj[rootnm].osd, resource_Obj[rootnm].sst, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            if (results.code == 'ER_DUP_ENTRY') {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                            }
                            else {
                                body_Obj = {};
                                body_Obj['dbg'] = results.message;
                                responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            }
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else {
                body_Obj = {};
                body_Obj['dbg'] = "ty does not supported";
                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                callback('0', resource_Obj);
                return '0';
            }
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
        resource_Obj[rootnm].rn = request.headers['x-m2m-nm'];
    }

    if (body_Obj[rootnm]['rn'] == 'latest' || body_Obj[rootnm]['rn'] == 'oldest' || body_Obj[rootnm]['rn'] == 'ol' || body_Obj[rootnm]['rn'] == 'la') {
        var _rn = body_Obj[rootnm]['rn'];
        body_Obj = {};
        body_Obj['dbg'] = "resource name (" + _rn + ") can not use that is keyword";
        responder.response_result(request, response, 409, body_Obj, 4005, request.url, body_Obj['dbg']);
        callback('0');
        return '0';
    }

    if (body_Obj[rootnm]['rn'] != null && body_Obj[rootnm]['rn'] != '') {
        resource_Obj[rootnm].rn = body_Obj[rootnm]['rn'];
    }

    resource_Obj[rootnm].ty = ty;
    resource_Obj[rootnm].pi = url.parse(request.url).pathname;
    resource_Obj[rootnm].ri = resource_Obj[rootnm].pi + '/' + resource_Obj[rootnm].rn;
    resource_Obj[rootnm].ct = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
    //var et = new Date();
    //et.setYear(cur_d.getFullYear()+1); // adds time to existing time
    //resource_Obj[rootnm].et = et.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
    resource_Obj[rootnm].et = moment().utc().add(3, 'years').format('YYYYMMDDTHHmmss');
    if(ty == 17) {
        resource_Obj[rootnm].et = moment().utc().add(1, 'days').format('YYYYMMDDTHHmmss');
    }
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;

    resource_Obj[rootnm].st = '0';

    resource_Obj[rootnm].mni = '3153600000';
    resource_Obj[rootnm].cs = '';
    resource_Obj[rootnm].cnf = '';

    if(ty == '3' || ty == '29') {
        resource_Obj[rootnm].mni = '3153600000';
    }

    if(ty == '4') {
        resource_Obj[rootnm].cs = '0';
        resource_Obj[rootnm].cnf = '';
    }

    db_sql.select_direct_lookup(resource_Obj[rootnm].ri, function (err, result_Obj) {
        if(!err) {
            if (result_Obj.length == 1) {
                body_Obj = {};
                body_Obj['dbg'] = "resource (" + result_Obj[0].rn + ") is already exist";
                responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
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
                        cin.build_cin(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
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
                    case '13':
                        mgo.build_mgo(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '14':
                        nod.build_nod(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '16':
                        csr.build_csr(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '17':
                        req.build_req(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '23':
                        sub.build_sub(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '24':
                        smd.build_smd(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '29':
                        ts.build_ts(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '30':
                        tsi.build_tsi(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    case '27':
                        mms.build_mms(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
                            callback(rsc, resource_Obj);
                        });
                        break;
                    default:
                    {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource requested is not supported";
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                        callback('0');
                        return '0';
                    }
                }
            }
        }
        else {
            body_Obj = {};
            body_Obj['dbg'] = result_Obj.message;
            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
            callback('0');
            return '0';
        }
    });
}

exports.create = function(request, response, ty, body_Obj, callback) {
    var rootnm = request.headers.rootnm;
    build_resource(request, response, ty, body_Obj, function(rsc, resource_Obj) {
        if(rsc == '0') {
            callback(rsc);
            return rsc;
        }
        create_action(request, response, ty, resource_Obj, function(rsc, create_Obj) {
            if(rsc == '1') {
                _this.remove_no_value(request, create_Obj);

                sgn.check(request, create_Obj[rootnm], 3);

                var status_code = 201;
                var rsc_code = 2001;

                if(request.query.rt == 3) {
                    response.setHeader('Content-Location', create_Obj[rootnm].ri.replace('/', ''));
                }

                if(rootnm == 'smd') {
                    smd.request_post(request.url, JSON.stringify(create_Obj));
                }

                if(Object.keys(create_Obj)[0] == 'req') {
                    request.headers.tg = create_Obj[rootnm].ri.replace('/', '');
                    status_code = 202;
                    rsc_code = 1000;
                    request.headers.rootnm = 'uri';
                    var resource_Obj = {};
                    resource_Obj.uri = {};
                    resource_Obj.uri = create_Obj[rootnm].ri.replace('/', '');
                    responder.response_result(request, response, status_code, resource_Obj, rsc_code, create_Obj[rootnm].ri, '');
                    callback(rsc);
                    return 0;
                }

                if(request.query.rcn == 2) { // hierarchical address
                    status_code = 200;
                    rsc_code = 2000;
                    request.headers.rootnm = 'uri';
                    var resource_Obj = {};
                    resource_Obj.uri = {};
                    resource_Obj.uri = create_Obj[rootnm].ri;
                    resource_Obj.uri = resource_Obj.uri.replace('/', ''); // make cse relative uri
                    responder.response_result(request, response, status_code, resource_Obj, rsc_code, create_Obj[rootnm].ri, '');
                    callback(rsc);
                    return 0;
                }
                else if(request.query.rcn == 3) { // hierarchical address and attributes
                    status_code = 200;
                    rsc_code = 2000;
                    request.headers.rootnm = rootnm;
                    create_Obj.rce = {};
                    create_Obj.rce.uri = create_Obj[rootnm].ri;
                    create_Obj.rce.uri = create_Obj.rce.uri.replace('/', ''); // make cse relative uri
                    create_Obj.rce[rootnm] = create_Obj[rootnm];
                    delete create_Obj[rootnm];
                    responder.response_rcn3_result(request, response, status_code, create_Obj, rsc_code, create_Obj.rce[rootnm].ri, '');
                    callback(rsc);
                    return '0';
                }
                else {
                    responder.response_result(request, response, status_code, create_Obj, rsc_code, create_Obj[rootnm].ri, '');
                    callback(rsc);
                    return '0';
                }
            }
        });
    });
};

function presearch_action(request, response, ri_list, comm_Obj, callback) {
    //var rootnm = request.headers.rootnm;
    var pi_list = [];
    var result_ri = [];
    pi_list.push(comm_Obj.ri);
    console.time('search_parents_lookup ' + comm_Obj.ri);
    db_sql.search_parents_lookup(comm_Obj.ri, pi_list, result_ri, function (err, search_Obj) {
        console.timeEnd('search_parents_lookup ' + comm_Obj.ri);
        if(!err) {
            var finding_Obj = {};
            var found_Obj = {};

            if(request.query.ty == '2') {
                request.query.lvl = '1';
            }

            if(request.query.lim != null) {
                if(request.query.lim > max_lim) {
                    request.query.lim = max_lim;
                }
            }
            else {
                request.query.lim = max_lim;
            }

            var cur_lvl = parseInt((url.parse(request.url).pathname.split('/').length), 10) - 2;
            for(var i = 0; i < search_Obj.length; i++) {
                if(request.query.lvl != null) {
                    var lvl = request.query.lvl;
                    if((search_Obj[i].ri.split('/').length-1) <= (cur_lvl + (parseInt(lvl, 10)))) {
                        pi_list.push(search_Obj[i].ri);
                        //ri_list.push(search_Obj[i].ri);
                        //found_Obj[search_Obj[i].ri] = search_Obj[i];
                    }
                }
                else {
                    pi_list.push(search_Obj[i].ri);
                    //ri_list.push(search_Obj[i].ri);
                    //found_Obj[search_Obj[i].ri] = search_Obj[i];
                }
            }

            var cur_d = moment().add(1, 'd').utc().format('YYYY-MM-DD HH:mm:ss');
            var bef_d = moment(cur_d).subtract(Math.pow(3, 0), 'hours').format('YYYY-MM-DD HH:mm:ss');
            db_sql.search_lookup(comm_Obj.ri, request.query, request.query.lim, pi_list, 0, finding_Obj, 0, bef_d, cur_d, 0, function (err, search_Obj) {
                if(!err) {
                    if(Object.keys(search_Obj).length >= 1) {
                        if(Object.keys(search_Obj).length >= max_lim) {
                            response.setHeader('X-M2M-CTS', 1);

                            if(request.query.ofst != null) {
                                response.setHeader('X-M2M-CTO', parseInt(request.query.ofst, 10) + Object.keys(search_Obj).length);
                            }
                            else {
                                response.setHeader('X-M2M-CTO', Object.keys(search_Obj).length);
                            }
                        }

                        for (var index in search_Obj) {
                            if (search_Obj.hasOwnProperty(index)) {
                                ri_list.push(search_Obj[index].ri);
                                found_Obj[search_Obj[index].ri] = search_Obj[index];
                                delete search_Obj[index];
                            }
                        }

                        callback('1', ri_list, found_Obj);
                    }
                    else {
                        // search_Obj = {};
                        // search_Obj['dbg'] = 'resource does not exist';
                        // responder.response_result(request, response, 404, search_Obj, 4004, request.url, 'resource does not exist');
                        // callback('0', search_Obj);
                        // return '0';

                        callback('1', ri_list, found_Obj);
                    }
                }
                else {
                    search_Obj = {};
                    search_Obj['dbg'] = search_Obj.message;
                    responder.response_result(request, response, 500, search_Obj, 5000, request.url, search_Obj['dbg']);
                    callback('0', search_Obj);
                    return '0';
                }
            });
        }
        else {
            search_Obj = {};
            search_Obj['dbg'] = search_Obj.message;
            responder.response_result(request, response, 500, search_Obj, 5000, request.url, search_Obj['dbg']);
            callback('0', search_Obj);
            return '0';
        }
    });
}

global.ty_list = ['1', '2', '3', '4', '5', '9', '10', '13', '14', '16', '17','23', '24', '27', '29', '30'];

function search_action(request, response, seq, resource_Obj, ri_list, strObj, presearch_Obj, callback) {
    if(ty_list.length <= seq) {
        callback('1', strObj);
        return '0';
    }

    var finding_Obj = [];
    var tbl = ty_list[seq];

    if(seq == 0) {
        console.time('search_resource');
    }

    if(request.query.ty != null) {
        tbl = request.query.ty;
        seq = ty_list.length;
    }

    db_sql.select_in_ri_list(responder.typeRsrc[tbl], ri_list, 0, finding_Obj, 0, function (err, search_Obj) {
        if(!err) {
            if(search_Obj.length >= 1) {
                //console.timeEnd('search_resource');

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

            if(++seq >= ty_list.length) {
                console.timeEnd('search_resource');
                callback('1', strObj);
                return '0';
            }
            else {
                search_action(request, response, seq, resource_Obj, ri_list, strObj, presearch_Obj, function (rsc, strObj) {
                    callback(rsc, strObj);
                    return '0';
                });
            }
        }
        else {
            /*spec_Obj = {};
            spec_Obj['dbg'] = spec_Obj.message;
            responder.response_result(request, response, 500, spec_Obj, 5000, request.url, spec_Obj['dbg']);
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

    var tid = require('shortid').generate();
    console.time('resource_retrieve ' + comm_Obj.ri + ' (' + tid + ')');
    db_sql.select_resource(responder.typeRsrc[ty], comm_Obj.ri, function (err, spec_Obj) {
        if(!err) {
            if (spec_Obj.length == 1) {
                console.timeEnd('resource_retrieve ' + comm_Obj.ri + ' (' + tid + ')');
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
                if (spec_Obj[0].bn) {
                    spec_Obj[0].bn = JSON.parse(spec_Obj[0].bn);
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
                if (spec_Obj[0].uds) {
                    spec_Obj[0].uds = JSON.parse(spec_Obj[0].uds);
                }
                if (spec_Obj[0].cas) {
                    spec_Obj[0].cas = JSON.parse(spec_Obj[0].cas);
                }
                if (spec_Obj[0].rels) {
                    spec_Obj[0].rels = JSON.parse(spec_Obj[0].rels);
                }
                if (spec_Obj[0].con) {
                    if(getType(spec_Obj[0].con) === 'object' || getType(spec_Obj[0].con) === 'array') {
                        try {
                            spec_Obj[0].con = JSON.parse(spec_Obj[0].con);
                        }
                        catch (e) {
                        }
                    }
                }
                resource_Obj[rootnm] = merge(comm_Obj, spec_Obj[0]);
                callback('1', resource_Obj);
            }
            else {
                spec_Obj = {};
                spec_Obj['dbg'] = 'resource does not exist';
                responder.response_result(request, response, 404, spec_Obj, 4004, request.url, spec_Obj['dbg']);
                callback('0', resource_Obj);
                return '0';
            }
        }
        else {
            spec_Obj = {};
            spec_Obj['dbg'] = spec_Obj.message;
            responder.response_result(request, response, 500, spec_Obj, 5000, request.url, spec_Obj['dbg']);
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
    else if(request.query.fu == 1 && (request.query.smf)) {
        smd.request_get_discovery(request, response, request.query.smf, function (response, statusCode, searchStr) {
            var ri_list = searchStr.split(',');
            if(statusCode == 200) {
                request.headers.rootnm = 'uril';
                var resource_Obj = {};
                resource_Obj.uril = {};
                resource_Obj.uril = ri_list;
                make_cse_relative(ri_list);
                responder.search_result(request, response, 200, resource_Obj, 2000, comm_Obj.ri, '');
            }
            else {
                resource_Obj = {};
                resource_Obj.dbg = {};
                resource_Obj.dbg = ri_list[0];
                var rsc = (statusCode == 400) ? 4000 : 4004;
                responder.response_result(request, response, statusCode, resource_Obj, rsc, comm_Obj.ri, resource_Obj.dbg);
            }
            return '0';
        });
    }
    else {
        search_resource(request, function (rsc, resource_Obj) {
            if (rsc == '0') {
                return rsc;
            }
            //var ri_list = [comm_Obj.ri];
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
                    make_cse_relative(ri_list);
                    responder.search_result(request, response, 200, resource_Obj, 2000, comm_Obj.ri, '');
                }
                else if (request.query.rcn == 4 || request.query.rcn == 5 ||request.query.rcn == 6) {
                    request.headers.rootnm = 'rsp';

                    search_action(request, response, 0, resource_Obj, ri_list, '{', search_Obj, function (rsc, strObj) {
                        if (rsc == '1') {
                            strObj += '}';
                            resource_Obj = JSON.parse(strObj);
                            for (var index in resource_Obj) {
                                if (resource_Obj.hasOwnProperty(index)) {
                                    resource_Obj[index] = merge(resource_Obj[index], search_Obj[index]);
                                    for (var index2 in resource_Obj[index]) {
                                        if (resource_Obj[index].hasOwnProperty(index2)) {
                                            if (resource_Obj[index][index2] == null || resource_Obj[index][index2] == '' || resource_Obj[index][index2] == 'undefined') {
                                                delete resource_Obj[index][index2];
                                            }
                                        }
                                    }
                                }
                            }

                            _this.remove_no_value(request, resource_Obj);
                            responder.search_result(request, response, 200, resource_Obj, 2000, comm_Obj.ri, '');

                            /*
                            retrieve_action(request, response, ty, comm_Obj, function (rsc, retrieve_Obj) {
                                if (rsc == '1') {
                                    _this.remove_no_value(request, retrieve_Obj);
                                    resource_Obj[retrieve_Obj[Object.keys(retrieve_Obj)[0]].ri] = retrieve_Obj[Object.keys(retrieve_Obj)[0]];
                                    request.headers.targetnm = responder.typeRsrc[retrieve_Obj[Object.keys(retrieve_Obj)[0]].ty];
                                    responder.search_result(request, response, 200, resource_Obj, 2000, comm_Obj.ri, '');
                                }
                                else {
                                    resource_Obj = {};
                                    resource_Obj['dbg'] = {};
                                    resource_Obj['dbg'] = 'resource does not exist';
                                    responder.response_result(request, response, 404, resource_Obj, 4004, request.url, resource_Obj['dbg']);
                                }
                            });
                            */
                        }
                        else {
                            request.headers.rootnm = 'rsp';
                            resource_Obj = {};
                            resource_Obj['dbg'] = {};
                            resource_Obj['dbg'] = 'response with hierarchical resource structure mentioned in onem2m spec is not supported instead all the requested resources will be returned !';
                            responder.response_result(request, response, 501, resource_Obj, 5001, request.url, resource_Obj['dbg']);
                        }
                    });
                }
                else {
                    request.headers.rootnm = 'rsp';
                    resource_Obj = {};
                    resource_Obj['dbg'] = {};
                    resource_Obj['dbg'] = 'response with hierarchical resource structure mentioned in onem2m spec is not supported instead all the requested resources will be returned !';
                    responder.response_result(request, response, 501, resource_Obj, 5001, request.url, resource_Obj['dbg']);
                }
            });
        });
    }
};

global.build_body = function(rootnm, body_Obj, resource_Obj) {
    // todo: update for optimize
    for (var attr in body_Obj[rootnm]) {
        if (body_Obj[rootnm].hasOwnProperty(attr)) {
            if(body_Obj[rootnm][attr]) {
                resource_Obj[rootnm][attr] = body_Obj[rootnm][attr];
            }

            if (attr === 'aa' || attr === 'poa' || attr === 'lbl' || attr === 'acpi' || attr === 'srt' || attr === 'nu' || attr === 'mid' || attr === 'macp') {
                if(body_Obj[rootnm][attr] === '') {
                    resource_Obj[rootnm][attr] = [];
                }

                if(attr === 'acpi') {
                    (resource_Obj[rootnm][attr]);
                }
            }
            else {
                if(body_Obj[rootnm][attr] === '') {
                    resource_Obj[rootnm][attr] = '';
                }
            }
        }
    }
};

global.update_body = function(rootnm, body_Obj, resource_Obj) {
    for (var attr in body_Obj[rootnm]) {
        if (body_Obj[rootnm].hasOwnProperty(attr)) {
            if (typeof body_Obj[rootnm][attr] === 'boolean') {
                resource_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else if (typeof body_Obj[rootnm][attr] === 'string') {
                resource_Obj[rootnm][attr] = body_Obj[rootnm][attr];
            }
            else if (typeof body_Obj[rootnm][attr] === 'number') {
                resource_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else {
                resource_Obj[rootnm][attr] = body_Obj[rootnm][attr];
            }

            if (attr === 'aa' || attr === 'poa' || attr === 'lbl' || attr === 'acpi' || attr === 'srt' || attr === 'nu' || attr === 'mid' || attr === 'macp') {
                if(body_Obj[rootnm][attr] === '') {
                    resource_Obj[rootnm][attr] = [];
                }

                if(attr === 'acpi') {
                    (resource_Obj[rootnm][attr]);
                }
            }
            else {
                if(body_Obj[rootnm][attr] === '') {
                    resource_Obj[rootnm][attr] = '';
                }
            }
        }
    }
};



function update_action_mni(ty, ri, mni, callback) {
    //var sql = util.format("delete from lookup where ri in (select ri from (select ri from lookup where pi = \'%s\' and ty = \'%s\' order by ri desc limit %s, 3153600000) x)", ri, ty, mni);

    if(mni == '9007199254740991') {
        mni = '3153600000';
    }
    db_sql.select_count_ri(ty, ri, function (err, results) {
        if (results.length == 1) {
            var cniObj = {};
            cniObj.cni = results[0]['count(ri)'];
            cniObj.cbs = (cniObj.cni == 0) ? 0 : results[0]['sum(cs)'];

            var offset = parseInt(cniObj.cni, 10) - parseInt(mni, 10);

            if (offset > 0) {
                db_sql.delete_ri_lookup_in(ty, ri, offset, function (err, results) {
                    if (!err) {
                        db_sql.select_count_ri(ty, ri, function (err, results) {
                            if (results.length == 1) {
                                cniObj.cni = results[0]['count(ri)'];
                                cniObj.cbs = (cniObj.cni == 0) ? 0 : results[0]['sum(cs)'];

                                console.log('[update_action_mni] cni: ' + cniObj.cni + ', cbs: ' + cniObj.cbs);

                                db_sql.update_cni_ri(ty, ri, cniObj.cni, cniObj.cbs, function (err, results) {
                                    if (!err) {
                                        callback('1', cniObj.cni, cniObj.cbs);
                                    }
                                    else {
                                        var body_Obj = {};
                                        body_Obj['dbg'] = results.message;
                                        //responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
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
                        body_Obj['dbg'] = results.message;
                        //responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                        console.log(JSON.stringify(body_Obj));
                        callback('0');
                        return '0';
                    }
                });
            }
            else {
                callback('1', cniObj.cni, cniObj.cbs);
            }
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
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
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
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
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
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
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
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
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
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '13') {
        if(responder.mgoType[resource_Obj[rootnm].mgd] == rootnm) {
            if (resource_Obj[rootnm].mgd == 1001) {
                db_sql.update_fwr(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
                    JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
                    resource_Obj[rootnm].dc, resource_Obj[rootnm].vr, resource_Obj[rootnm].fwnnam, resource_Obj[rootnm].url, resource_Obj[rootnm].ud, JSON.stringify(resource_Obj[rootnm].uds), function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (resource_Obj[rootnm].mgd == 1006) {
                db_sql.update_bat(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
                    JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
                    resource_Obj[rootnm].dc, resource_Obj[rootnm].btl, resource_Obj[rootnm].bts, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (resource_Obj[rootnm].mgd == 1007) {
                db_sql.update_dvi(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
                    JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
                    resource_Obj[rootnm].dc, resource_Obj[rootnm].dbl, resource_Obj[rootnm].man, resource_Obj[rootnm].mod, resource_Obj[rootnm].dty,
                    resource_Obj[rootnm].fwv, resource_Obj[rootnm].swv, resource_Obj[rootnm].hwv, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (resource_Obj[rootnm].mgd == 1008) {
                db_sql.update_dvc(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
                    JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
                    resource_Obj[rootnm].dc, resource_Obj[rootnm].can, resource_Obj[rootnm].att, JSON.stringify(resource_Obj[rootnm].cas), resource_Obj[rootnm].cus,
                    resource_Obj[rootnm].ena, resource_Obj[rootnm].dis, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else if (resource_Obj[rootnm].mgd == 1009) {
                db_sql.update_rbo(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
                    JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
                    resource_Obj[rootnm].dc, resource_Obj[rootnm].rbo, resource_Obj[rootnm].far, function (err, results) {
                        if (!err) {
                            callback('1', resource_Obj);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                            callback('0', resource_Obj);
                            return '0';
                        }
                    });
            }
            else {
                body_Obj = {};
                body_Obj['dbg'] = "this resource of mgmtObj is not supported";
                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                callback('0', resource_Obj);
                return '0';
            }
        }
        else {
            body_Obj = {};
            body_Obj['dbg'] = "mgmtObj requested is not match with content type of body";
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else if(ty == '14') {
        db_sql.update_nod(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].ni, resource_Obj[rootnm].mgca, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
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
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '23') {
        db_sql.update_sub(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            JSON.stringify(resource_Obj[rootnm].enc), resource_Obj[rootnm].exc, JSON.stringify(resource_Obj[rootnm].nu), resource_Obj[rootnm].gpi, resource_Obj[rootnm].nfu,
            JSON.stringify(resource_Obj[rootnm].bn), resource_Obj[rootnm].rl, resource_Obj[rootnm].pn, resource_Obj[rootnm].nsp, resource_Obj[rootnm].ln,
            resource_Obj[rootnm].nct, resource_Obj[rootnm].nec, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '24') {
        db_sql.update_sd(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].dsp, resource_Obj[rootnm].dcrp, resource_Obj[rootnm].soe, JSON.stringify(resource_Obj[rootnm].rels), resource_Obj[rootnm].or, function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if(ty == '29') {
        db_sql.update_ts(resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
            JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].mni, resource_Obj[rootnm].ri,
            resource_Obj[rootnm].mbs, resource_Obj[rootnm].mia, resource_Obj[rootnm].or,
            resource_Obj[rootnm].mdn, resource_Obj[rootnm].mdt, resource_Obj[rootnm].mdlt, resource_Obj[rootnm].mdc, function (err, results) {
                if (!err) {
                    check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                    });
                    callback('1', resource_Obj);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
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
                    body_Obj['dbg'] = results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = "ty does not supported";
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }
}

function update_resource(request, response, ty, body_Obj, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;

    if(ty_list.includes(ty)) {
        // check M
        for (var attr in update_m_attr_list[rootnm]) {
            if (update_m_attr_list[rootnm].hasOwnProperty(attr)) {
                if (body_Obj[rootnm].includes(attr)) {
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Mandatory\' attribute';
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }
            }
        }

        // check NP and body
        for (attr in body_Obj[rootnm]) {
            if (body_Obj[rootnm].hasOwnProperty(attr)) {
                if (update_np_attr_list[rootnm].includes(attr)) {
                    body_Obj = {};
                    body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Not Present\' attribute';
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }
                else {
                    if (update_opt_attr_list[rootnm].includes(attr)) {
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = 'NOT FOUND: ' + attr + ' attribute is not defined';
                        responder.response_result(request, response, 404, body_Obj, 4004, request.url, body_Obj['dbg']);
                        callback('0', resource_Obj);
                        return '0';
                    }
                }
            }
        }

        update_body(rootnm, body_Obj, resource_Obj); // (attr == 'aa' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' || attr == 'nu' || attr == 'mid' || attr == 'macp')

        resource_Obj[rootnm].st = (parseInt(resource_Obj[rootnm].st, 10) + 1).toString();

        var cur_d = new Date();
        resource_Obj[rootnm].lt = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');

        if (body_Obj[rootnm].et == '') {
            if (body_Obj[rootnm].et < resource_Obj[rootnm].ct) {
                body_Obj = {};
                body_Obj['dbg'] = 'expiration time is before now';
                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                callback('0', resource_Obj);
                return '0';
            }
        }

        callback('1', resource_Obj);
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'we do not support to update resource';
        responder.response_result(request, response, 405, body_Obj, 4005, request.url, body_Obj['dbg']);
        callback('0', body_Obj);
    }

// //    var rootnm = request.headers.rootnm;
//     switch (ty) {
//         case '1':
//             acp.modify_acp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '2':
//             ae.modify_ae(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '3':
//             cnt.modify_cnt(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '9':
//             grp.modify_grp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '10':
//             lcp.modify_lcp(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '13':
//             mgo.modify_mgo(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '14':
//             nod.modify_nod(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '16':
//             csr.modify_csr(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '23':
//             sub.modify_sub(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '24':
//             smd.modify_sd(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             }); break;
//         case '29':
//             ts.modify_ts(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         case '27':
//             mms.modify_mms(request, response, resource_Obj, body_Obj, function(rsc, resource_Obj) {
//                 callback(rsc, resource_Obj);
//             });
//             break;
//         default:
//             body_Obj = {};
//             body_Obj['dbg'] = 'request is not supported in oneM2M Spec!';
//             responder.response_result(request, response, 405, body_Obj, 4005, request.url, body_Obj['dbg']);
//             callback('0', body_Obj);
//             break;
//     }
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

function delete_action_cni(ri, ty, pi, cs, callback) {
    db_sql.select_cni_parent(ty, pi, function (err, results_cni) {
        if (results_cni.length == 1) {
            var cni = results_cni[0]['cni'];
            var cbs = results_cni[0]['cbs'];
            var st = results_cni[0]['st'];

            st = (parseInt(st, 10) + 1).toString();
            cni = (parseInt(cni, 10) - 1).toString();
            cbs = (parseInt(cbs, 10) - parseInt(cs, 10)).toString();

            db_sql.update_cni_parent(ty, cni, cbs, st, pi, function (err, results) {
                if (!err) {
                    db_sql.update_st_lookup(st, ri, function (err, results) {
                        if (!err) {
                            callback('1', st);
                        }
                        else {
                            var body_Obj = {};
                            body_Obj['dbg'] = results.message;
                            console.log(JSON.stringify(body_Obj));
                            callback('0');
                            return '0';
                        }
                    });
                }
                else {
                    var body_Obj = {};
                    body_Obj['dbg'] = results.message;
                    //responder.response_result(request, response, 500, body_Obj, 5000, request.url, results.message);
                    console.log(JSON.stringify(body_Obj));
                    callback('0');
                    return '0';
                }
            });
        }
    });
}

function delete_action(request, response, resource_Obj, comm_Obj, callback) {
    var pi_list = [];
    var result_ri = [];
    pi_list.push(comm_Obj.ri);
    console.time('search_parents_lookup ' + comm_Obj.ri);
    db_sql.search_parents_lookup(comm_Obj.ri, pi_list, result_ri, function (err, search_Obj) {
        console.timeEnd('search_parents_lookup ' + comm_Obj.ri);
        if(!err) {
            //if(search_Obj.length == 0) {
            //    pi_list.push(comm_Obj.ri);
            //}

            //pi_list.push(comm_Obj.ri);
            for(var i = 0; i < search_Obj.length; i++) {
                pi_list.push(search_Obj[i].ri);
            }

            var finding_Obj = [];
            console.time('delete_lookup ' + comm_Obj.ri);
            db_sql.delete_lookup(comm_Obj.ri, pi_list, 0, finding_Obj, 0, function (err, search_Obj) {
                console.timeEnd('delete_lookup ' + comm_Obj.ri);
                if(!err) {
                    if(comm_Obj.ty == '29') {
                        delete_TS(function (rsc, res_Obj) {
                        });
                        callback('1', resource_Obj);
                    }
                    else if(comm_Obj.ty == '4') {
                        delete_action_cni(comm_Obj.ri, comm_Obj.ty, comm_Obj.pi, comm_Obj.cs, function (rsc) {

                        });
                        callback('1', resource_Obj);
                    }
                    else {
                        callback('1', resource_Obj);
                    }
                }
                else {
                    var body_Obj = {};
                    body_Obj['dbg'] = search_Obj.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    callback('0', body_Obj);
                    return '0';
                }
            });
        }
        else {
            var body_Obj = {};
            body_Obj['dbg'] = search_Obj.message;
            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
            callback('0', body_Obj);
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

