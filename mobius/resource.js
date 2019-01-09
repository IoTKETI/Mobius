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
 * @file
 * @copyright KETI Korea 2018, KETI
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
var tm = require('./tm');
var tr = require('./tr');

var util = require('util');
var merge = require('merge');

var security = require('./security');

var db_sql = require('./sql_action');

var _this = this;

global.ty_list = ['1', '2', '3', '4', '5', '9', '10', '13', '14', '16', '17', '23', '24', '27', '29', '30', '38', '39'];

global.create_np_attr_list = {};
create_np_attr_list.acp = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.csr = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.ae = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'aei'];
create_np_attr_list.cnt = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cni', 'cbs'];
create_np_attr_list.cin = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cs'];
create_np_attr_list.sub = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.lcp = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'loi', 'lost'];
create_np_attr_list.grp = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnm', 'mtv', 'ssi'];
create_np_attr_list.nod = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.smd = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'soe'];
create_np_attr_list.ts = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cni', 'cbs', 'mdlt', 'mdc'];
create_np_attr_list.tsi = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.mms = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'sid'];
create_np_attr_list.req = ['rn', 'ty', 'ri', 'et', 'pi', 'ct', 'lt', 'acpi', 'lbl', 'st', 'daci', 'op', 'tg', 'org', 'rid', 'mi', 'pc', 'rs', 'ors'];
create_np_attr_list.tm = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'tctl', 'tst', 'trsp'];
create_np_attr_list.tr = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'tctl', 'tst', 'trsp'];

create_np_attr_list.fwr = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'uds'];
create_np_attr_list.bat = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.dvi = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.dvc = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.rbo = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];

global.create_m_attr_list = {};
create_m_attr_list.acp = ['pv', 'pvs'];
create_m_attr_list.csr = ['cb', 'csi', 'rr'];
create_m_attr_list.ae = ['api', 'rr'];
create_m_attr_list.cnt = [];
create_m_attr_list.cin = ['con'];
create_m_attr_list.sub = ['nu'];
create_m_attr_list.lcp = ['los'];
create_m_attr_list.grp = ['mnm', 'mid'];
create_m_attr_list.nod = ['ni'];
create_m_attr_list.smd = ['dcrp', 'dsp'];
create_m_attr_list.ts = [];
create_m_attr_list.tsi = ['dgt', 'con'];
create_m_attr_list.mms = ['soid', 'asd'];
create_m_attr_list.req = [];
create_m_attr_list.tm = ['rqps'];
create_m_attr_list.tr = ['tid', 'trqp'];

create_m_attr_list.fwr = ['mgd', 'vr', 'fwnnam', 'url', 'ud'];
create_m_attr_list.bat = ['mgd', 'btl', 'bts'];
create_m_attr_list.dvi = ['mgd', 'dlb', 'man', 'mod', 'dty', 'fwv', 'swv', 'hwv'];
create_m_attr_list.dvc = ['mgd', 'can', 'att', 'cas', 'cus'];
create_m_attr_list.rbo = ['mgd'];

global.create_opt_attr_list = {};
create_opt_attr_list.acp = ['rn', 'et', 'lbl', 'aa', 'at'];
create_opt_attr_list.csr = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cst', 'poa', 'mei', 'tri', 'nl', 'esi', 'srv'];
create_opt_attr_list.ae = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'apn', 'poa', 'or', 'nl', 'csz', 'esi', 'srv'];
create_opt_attr_list.cnt = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr', 'mni', 'mbs', 'mia', 'li', 'or', 'disr'];
create_opt_attr_list.cin = ['rn', 'et', 'lbl', 'aa', 'at', 'daci', 'cr', 'cnf', 'conr', 'or'];
create_opt_attr_list.sub = ['rn', 'acpi', 'et', 'lbl', 'daci', 'cr', 'enc', 'exc', 'gpi', 'nfu', 'bn', 'rl', 'psn', 'pn', 'nsp', 'ln', 'nct', 'nec', 'su'];
create_opt_attr_list.lcp = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'lou', 'lot', 'lor', 'lon'];
create_opt_attr_list.grp = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mt', 'macp', 'csy', 'gn'];
create_opt_attr_list.nod = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'hcl', 'mgca'];
create_opt_attr_list.smd = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'cr', 'or', 'rels'];
create_opt_attr_list.ts = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'cr', 'mni', 'mbs', 'mia', 'pei', 'mdd', 'mdn', 'mdt', 'or'];
create_opt_attr_list.tsi = ['rn', 'et', 'lbl', 'aa', 'at', 'sqn'];
create_opt_attr_list.mms = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'stid', 'osd', 'sst'];
create_opt_attr_list.req = [];
create_opt_attr_list.tm = ['rn', 'acpi', 'et', 'lbl', 'daci', 'cr', 'tltm', 'text', 'tct', 'tept', 'tmd', 'tltp', 'tmr', 'tmh'];
create_opt_attr_list.tr = ['rn', 'acpi', 'et', 'lbl', 'daci', 'cr', 'tltm', 'text', 'tct', 'tltp'];

create_opt_attr_list.fwr = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.bat = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.dvi = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.dvc = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk', 'ena', 'dis'];
create_opt_attr_list.rbo = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk', 'rbo', 'far'];


global.update_np_attr_list = {};
update_np_attr_list.acp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt'];
update_np_attr_list.csr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cst', 'cb', 'csi'];
update_np_attr_list.ae = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'api', 'aei'];
update_np_attr_list.cnt = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'cni', 'cbs', 'disr'];
update_np_attr_list.sub = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'psn', 'su'];
update_np_attr_list.lcp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'los', 'lot', 'lor', 'loi', 'lon', 'lost'];
update_np_attr_list.grp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'mt', 'cnm', 'mtv', 'csy', 'ssi'];
update_np_attr_list.nod = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'hcl'];
update_np_attr_list.smd = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr'];
update_np_attr_list.ts = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'cni', 'cbs', 'mdlt', 'mdc'];
update_np_attr_list.mms = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'sid', 'soid'];
update_np_attr_list.tm = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'tltm', 'text', 'tct', 'tept', 'tmd', 'tltp', 'rqps', 'rsps'];
update_np_attr_list.tr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'daci', 'tid', 'tst', 'tltm', 'text', 'tct', 'tltp', 'trqp', 'trsp'];

update_np_attr_list.fwr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.bat = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.dvi = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.dvc = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.rbo = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];

global.update_m_attr_list = {};
update_m_attr_list.acp = [];
update_m_attr_list.csr = [];
update_m_attr_list.ae = [];
update_m_attr_list.cnt = [];
update_m_attr_list.sub = [];
update_m_attr_list.lcp = [];
update_m_attr_list.grp = [];
update_m_attr_list.nod = [];
update_m_attr_list.smd = [];
update_m_attr_list.ts = [];
update_m_attr_list.mms = [];
update_m_attr_list.tm = [];
update_m_attr_list.tr = [];

update_m_attr_list.fwr = [];
update_m_attr_list.bat = [];
update_m_attr_list.dvi = [];
update_m_attr_list.dvc = [];
update_m_attr_list.rbo = [];

global.update_opt_attr_list = {};
update_opt_attr_list.acp = ['et', 'lbl', 'aa', 'at', 'pv', 'pvs'];
update_opt_attr_list.csr = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'poa', 'mei', 'rr', 'nl', 'tri', 'esi', 'srv'];
update_opt_attr_list.ae = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'apn', 'poa', 'or', 'nl', 'rr', 'csz', 'esi', 'srv'];
update_opt_attr_list.cnt = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mni', 'mbs', 'mia', 'li', 'or'];
update_opt_attr_list.sub = ['acpi', 'et', 'lbl', 'daci', 'enc', 'exc', 'nu', 'gpi', 'bn', 'rl', 'pn', 'nsp', 'ln', 'nct', 'nec'];
update_opt_attr_list.lcp = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'lou'];
update_opt_attr_list.grp = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mnm', 'mid', 'macp', 'gn'];
update_opt_attr_list.nod = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'ni', 'mgca'];
update_opt_attr_list.smd = ['acpi', 'et', 'lbl', 'aa', 'at', 'dcrp', 'soe', 'dsp', 'or', 'rels'];
update_opt_attr_list.ts = ['acpi', 'et', 'lbl', 'aa', 'at', 'mni', 'mbs', 'mia', 'pei', 'mdd', 'mdn', 'mdt', 'or'];
update_opt_attr_list.mms = ['acpi', 'et', 'lbl', 'aa', 'at', 'stid', 'asd', 'osd', 'sst'];
update_opt_attr_list.tm = ['acpi', 'et', 'lbl', 'daci', 'tctl', 'tmr', 'tmh'];
update_opt_attr_list.tr = ['acpi', 'et', 'lbl', 'cr', 'tctl'];

update_opt_attr_list.fwr = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'vr', 'fwnnam', 'url', 'ud', 'uds'];
update_opt_attr_list.bat = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'btl', 'bts'];
update_opt_attr_list.dvi = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'dlb', 'man', 'mod', 'dty', 'fwv', 'swv', 'hwv'];
update_opt_attr_list.dvc = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'can', 'att', 'cas', 'cus', 'ena', 'dis'];
update_opt_attr_list.rbo = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'rbo', 'far'];


exports.t_isr = function (id, param1, param2, param3) {
    console.log(id, param1, param2, param3);
};

exports.set_rootnm = function (request, ty) {
    request.headers.rootnm = responder.typeRsrc[ty];
};

exports.remove_no_value = function (request, resource_Obj) {
    var rootnm = request.headers.rootnm;

    for (var index in resource_Obj[rootnm]) {
        if (resource_Obj[rootnm].hasOwnProperty(index)) {
            if (request.hash) {
                if (request.hash.split('#')[1] == index) {

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
                        if (resource_Obj[rootnm][index] == '' && index == 'pi') {
                            resource_Obj[rootnm][index] = null;
                        }
                        else {
                            delete resource_Obj[rootnm][index];
                        }
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

global.make_cse_relative = function (resource_Obj) {
    for (var index in resource_Obj) {
        if (resource_Obj.hasOwnProperty(index)) {
            resource_Obj[index] = resource_Obj[index].replace('/', '');
        }
    }
};

global.make_internal_ri = function (resource_Obj) {
    for (var index in resource_Obj) {
        if (resource_Obj.hasOwnProperty(index)) {
            if (resource_Obj[index].split(usespid + usecseid + '/')[0] == '') { // absolute relative
                resource_Obj[index] = resource_Obj[index].replace(usespid + usecseid + '/', '/');
            }
            else if (resource_Obj[index].split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
                resource_Obj[index] = resource_Obj[index].replace(usecseid + '/', '/');
            }
            else if (resource_Obj[index].split(usecsebase)[0] == '') { // cse relative
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

    if (usesecure == 'disable') {
        var options = {
            hostname: 'localhost',
            port: usetsagentport,
            path: '/missingDataDetect',
            method: 'post',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/json',
                'X-M2M-Origin': usecseid,
                'Content-Type': 'application/vnd.onem2m-res+json',
                'X-M2M-RVI': uservi
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
                'Content-Type': 'application/vnd.onem2m-res+json',
                'X-M2M-RVI': uservi
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
        if (e.message != 'read ECONNRESET') {
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

    if (usesecure == 'disable') {
        var options = {
            hostname: 'localhost',
            port: usetsagentport,
            path: '/missingDataDetect',
            method: 'delete',
            headers: {
                'X-M2M-RI': rqi,
                'Accept': 'application/json',
                'X-M2M-Origin': usecseid,
                'X-M2M-RVI': uservi
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
                'X-M2M-Origin': usecseid,
                'X-M2M-RVI': uservi
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
        if (e.message != 'read ECONNRESET') {
            console.log('[delete_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}

function create_action(request, response, ty, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var body_Obj = {};

    if (ty == '1') {
        db_sql.insert_acp(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '2') {
        //resource_Obj[rootnm].sri = resource_Obj[rootnm].aei;
        db_sql.insert_ae(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '3') {
        db_sql.insert_cnt(resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('1', resource_Obj);
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    body_Obj = {};
                    body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = '[create_action] ' + results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                }
                callback('0', resource_Obj);
                return '0';
            }
        });
    }
    else if (ty == '4') {
        // 20180322 removed <-- update stateTag for every resources
        var parent_rootnm = Object.keys(request.targetObject)[0];
        resource_Obj[rootnm].st = parseInt(request.targetObject[parent_rootnm].st, 10) + 1;
        request.targetObject[parent_rootnm].st = resource_Obj[rootnm].st;
        db_sql.update_st(request.targetObject[parent_rootnm], function() {
        });

        db_sql.insert_cin(resource_Obj[rootnm], function (err, results) {
            if (!err) {
                // request.targetObject[parent_rootnm].st = resource_Obj[rootnm].st;
                // request.targetObject[parent_rootnm].cni = parseInt(request.targetObject[parent_rootnm].cni, 10) + 1;
                // request.targetObject[parent_rootnm].cbs = parseInt(request.targetObject[parent_rootnm].cni, 10) + parseInt(resource_Obj[rootnm].cs, 10);
                // db_sql.update_cnt_cni(request.targetObject[parent_rootnm], function () {
                //
                // });
                if(cbs_cache[request.targetObject[parent_rootnm].ri]) {
                    cbs_cache[request.targetObject[parent_rootnm].ri].cni = parseInt(cbs_cache[request.targetObject[parent_rootnm].ri].cni, 10) + 1;
                    cbs_cache[request.targetObject[parent_rootnm].ri].cbs = parseInt(cbs_cache[request.targetObject[parent_rootnm].ri].cbs, 10) + parseInt(resource_Obj[rootnm].cs, 10);
                }
                callback('1', resource_Obj);
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    body_Obj = {};
                    body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = '[create_action] ' + results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                }
                callback('0', resource_Obj);
                return '0';
            }
        });
    }
    else if (ty == '9') {
        db_sql.insert_grp(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '10') {
        db_sql.insert_lcp(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '13') {
        if (resource_Obj[rootnm].mgd == 1001) {
            db_sql.insert_fwr(resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('1', resource_Obj);
                    }
                    else {
                        if (results.code == 'ER_DUP_ENTRY') {
                            body_Obj = {};
                            body_Obj['dbg'] = '[create_action] ' + results.message;
                            responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = '[create_action] ' + results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                        }
                        callback('0', resource_Obj);
                        return '0';
                    }
                });
        }
        else if (resource_Obj[rootnm].mgd == 1006) {
            db_sql.insert_bat(resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('1', resource_Obj);
                    }
                    else {
                        if (results.code == 'ER_DUP_ENTRY') {
                            body_Obj = {};
                            body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                            responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = '[create_action] ' + results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                        }
                        callback('0', resource_Obj);
                        return '0';
                    }
                });
        }
        else if (resource_Obj[rootnm].mgd == 1007) {
            db_sql.insert_dvi(resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('1', resource_Obj);
                    }
                    else {
                        if (results.code == 'ER_DUP_ENTRY') {
                            body_Obj = {};
                            body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                            responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = '[create_action] ' + results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                        }
                        callback('0', resource_Obj);
                        return '0';
                    }
                });
        }
        else if (resource_Obj[rootnm].mgd == 1008) {
            db_sql.insert_dvc(resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('1', resource_Obj);
                    }
                    else {
                        if (results.code == 'ER_DUP_ENTRY') {
                            body_Obj = {};
                            body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                            responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = '[create_action] ' + results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                        }
                        callback('0', resource_Obj);
                        return '0';
                    }
                });
        }
        else if (resource_Obj[rootnm].mgd == 1009) {
            db_sql.insert_rbo(resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('1', resource_Obj);
                    }
                    else {
                        if (results.code == 'ER_DUP_ENTRY') {
                            body_Obj = {};
                            body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                            responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = '[create_action] ' + results.message;
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
        db_sql.insert_nod(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '16') {
        db_sql.insert_csr(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '17') {
        db_sql.insert_req(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '23') {
        db_sql.insert_sub(resource_Obj[rootnm], function (err, results) {
            if (!err) {
                var parent_rootnm = Object.keys(request.targetObject)[0];
                var parentObj = request.targetObject;
                parentObj[parent_rootnm].subl.push(resource_Obj[rootnm]);

                db_sql.update_lookup(parentObj[parent_rootnm], function (err, results) {
                    if(!err) {
                        callback('1', resource_Obj);
                    }
                });
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    body_Obj = {};
                    body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = '[create_action] ' + results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                }
                callback('0', resource_Obj);
                return '0';
            }
        });
    }
    else if (ty == '24') {
        db_sql.insert_smd(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '29') {
        db_sql.insert_ts(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                    });
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '30') {
        db_sql.insert_tsi(resource_Obj[rootnm], function (err, results) {
            if (!err) {
                resource_Obj[rootnm].st = st;
                callback('1', resource_Obj);
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    body_Obj = {};
                    body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = '[create_action] ' + results.message;
                    responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                }
                callback('0', resource_Obj);
                return '0';
            }
        });
    }
    else if (ty == '27') {
        db_sql.insert_mms(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
    }
    else if (ty == '38') { // transactionMgmt resource
        if (resource_Obj[rootnm].tmd == tmd_v.CREATOR_CONTROLLED) { // INITIAL
            resource_Obj[rootnm].tst = tst_v.INITIAL;
            db_sql.insert_tm(resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('1', resource_Obj);
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        body_Obj = {};
                        body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                        responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = '[create_action] ' + results.message;
                        responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                    }
                    callback('0', resource_Obj);
                    return '0';
                }
            });
        }
        else {
            tm.request_lock(resource_Obj, 0, function(rsc, resource_Obj, rsps) {
                if(rsc != '1') {
                    body_Obj = {};
                    body_Obj['dbg'] = "BAD_REQUEST: transaction resource could not create";
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }

                var check_tst = 0;
                for(var idx in rsps) {
                    if(rsps.hasOwnProperty(idx)) {
                        for(var root in rsps[idx].pc) {
                            if(rsps[idx].pc.hasOwnProperty(root)) {
                                for(var attr in rsps[idx].pc[root]) {
                                    if (rsps[idx].pc[root].hasOwnProperty(attr)) {
                                        if(attr === 'tst') {
                                            if(rsps[idx].pc[root][attr] == tst_v.LOCKED) {
                                                check_tst++;
                                            }
                                            else {
                                                check_tst = 0;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if(check_tst == 0) {
                    resource_Obj[rootnm].tst = tst_v.ERROR;
                }
                else {
                    resource_Obj[rootnm].tst = tst_v.LOCKED;
                }
                resource_Obj[rootnm].rsps = rsps;

                db_sql.insert_tm(resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('1', resource_Obj);
                    }
                    else {
                        if (results.code == 'ER_DUP_ENTRY') {
                            body_Obj = {};
                            body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                            responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = '[create_action] ' + results.message;
                            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
                        }
                        callback('0', resource_Obj);
                        return '0';
                    }
                });
            });
        }
    }
    else if (ty == '39') { // transaction resource
        db_sql.insert_tr(resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('1', resource_Obj);
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    body_Obj = {};
                    body_Obj['dbg'] = "resource (" + resource_Obj[rootnm].rn + ") is already exist";
                    responder.response_result(request, response, 409, body_Obj, 4105, request.url, body_Obj['dbg']);
                }
                else {
                    body_Obj = {};
                    body_Obj['dbg'] = '[create_action] ' + results.message;
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


function build_resource(request, response, ty, body_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    var cur_d = new Date();
    var msec = (parseInt(cur_d.getMilliseconds(), 10) < 10) ? ('00' + cur_d.getMilliseconds()) : ((parseInt(cur_d.getMilliseconds(), 10) < 100) ? ('0' + cur_d.getMilliseconds()) : cur_d.getMilliseconds());

    //resource_Obj[rootnm].rn = ty + '-' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec + randomValueBase64(4);

    var hrTime = process.hrtime();
    var timeTail = '000000'+hrTime[1].toString();
    timeTail = timeTail.substring(timeTail.length-9, timeTail.length);
    resource_Obj[rootnm].rn = ty + '-' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + timeTail;

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
    if (ty == 17) {
        resource_Obj[rootnm].et = moment().utc().add(1, 'days').format('YYYYMMDDTHHmmss');
    }
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;

    resource_Obj[rootnm].st = 0;

    if (ty == '3' || ty == '29') {
        resource_Obj[rootnm].mni = '3153600000';
    }

    if (ty == '4') {
        resource_Obj[rootnm].cs = '0';
        resource_Obj[rootnm].cnf = '';
    }

    if (ty_list.includes(ty.toString())) {
        var mandatory_check_count = 0;

        // check Not_Present and check Option and check Mandatory
        for (var attr in body_Obj[rootnm]) {
            if (body_Obj[rootnm].hasOwnProperty(attr)) {
                if (create_np_attr_list[rootnm].includes(attr)) {
                    body_Obj = {};
                    body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Not Present\' attribute';
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    callback('0');
                    return '0';
                }
                else {
                    if (create_opt_attr_list[rootnm].includes(attr)) {
                    }
                    else {
                        if (create_m_attr_list[rootnm].includes(attr)) {
                            if(attr === 'pvs') {
                                if(body_Obj[rootnm][attr].hasOwnProperty('acr')) {
                                    if(body_Obj[rootnm][attr].acr.length == 0) {
                                        body_Obj = {};
                                        body_Obj['dbg'] = 'BAD REQUEST: ' + attr + '.acr must have values';
                                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                        callback('0');
                                        return '0';
                                    }
                                }
                                else {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'BAD REQUEST: ' + attr + '.acr must have values';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0');
                                    return '0';
                                }
                            }
                            else if(attr === 'nu') {
                                if(body_Obj[rootnm][attr].length == 0) {
                                    body_Obj = {};
                                    body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' must have values';
                                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                    callback('0');
                                    return '0';
                                }
                            }
                            resource_Obj[rootnm][attr] = body_Obj[rootnm][attr];
                            mandatory_check_count += 1;
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' attribute is not defined';
                            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                            callback('0');
                            return '0';
                        }
                    }
                }
            }
        }

        if(mandatory_check_count < create_m_attr_list[rootnm].length) {
            body_Obj = {};
            body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Mandatory\' attribute';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'we do not support to create resource';
        responder.response_result(request, response, 405, body_Obj, 4005, request.url, body_Obj['dbg']);
        callback('0');
        return '0';
    }

    resource_Obj[rootnm].acpi = (body_Obj[rootnm].acpi) ? body_Obj[rootnm].acpi : [];
    resource_Obj[rootnm].et = (body_Obj[rootnm].et) ? body_Obj[rootnm].et : resource_Obj[rootnm].et;
    resource_Obj[rootnm].lbl = (body_Obj[rootnm].lbl) ? body_Obj[rootnm].lbl : [];
    resource_Obj[rootnm].at = (body_Obj[rootnm].at) ? body_Obj[rootnm].at : [];
    resource_Obj[rootnm].aa = (body_Obj[rootnm].aa) ? body_Obj[rootnm].aa : [];
    resource_Obj[rootnm].subl = (body_Obj[rootnm].subl) ? body_Obj[rootnm].subl : [];

    if (body_Obj[rootnm].et == '') {
        if (body_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            body_Obj = {};
            body_Obj['dbg'] = 'expiration time is before now';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }

    switch (ty) {
        case '1':
            acp.build_acp(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '2':
            ae.build_ae(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '3':
            cnt.build_cnt(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '4':
            cin.build_cin(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '9':
            grp.build_grp(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '10':
            lcp.build_lcp(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '13':
            mgo.build_mgo(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '14':
            nod.build_nod(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '16':
            csr.build_csr(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '17':
            req.build_req(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '23':
            sub.build_sub(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '24':
            smd.build_smd(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '27':
            mms.build_mms(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '29':
            ts.build_ts(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '30':
            tsi.build_tsi(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '38':
            tm.build_tm(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        case '39':
            tr.build_tr(request, response, resource_Obj, body_Obj, function (rsc, resource_Obj) {
                callback(rsc, resource_Obj);
            });
            break;
        default: {
            body_Obj = {};
            body_Obj['dbg'] = "resource requested is not supported";
            responder.response_result(request, response, 500, body_Obj, 5000, request.url, body_Obj['dbg']);
            callback('0');
            return '0';
        }
    }
}

exports.create = function (request, response, ty, body_Obj, callback) {
    var rootnm = request.headers.rootnm;
    build_resource(request, response, ty, body_Obj, function (rsc, resource_Obj) {
        if (rsc == '0') {
            callback(rsc);
            return rsc;
        }

        resource_Obj[rootnm].spi = request.targetObject[Object.keys(request.targetObject)[0]].sri;
        resource_Obj[rootnm].sri = require('shortid').generate();

        // var cipher = crypto.createCipher('des','d6F3Efeq');
        // var crypted = cipher.update(resource_Obj[rootnm].ri,'utf8','hex');
        // crypted += cipher.final('hex');
        // resource_Obj[rootnm].sri = crypted;

        if (request.query.real == 4) { // realtime, new
            var notiObj = JSON.parse(JSON.stringify(resource_Obj));
            _this.remove_no_value(request, notiObj);
            sgn.check(request, notiObj[rootnm], 3);
        }

        else if(ty == 23) { // when ty is 23, send notification for verification
            var notiObj = JSON.parse(JSON.stringify(resource_Obj));
            _this.remove_no_value(request, notiObj);
            sgn.check(request, notiObj[rootnm], 256);
        }

        if (request.query.tctl == 3) { // for EXECUTE of transaction
            var resultObj = JSON.parse(JSON.stringify(resource_Obj));
            _this.remove_no_value(request, resultObj);

            responder.response_result(request, response, 201, resultObj, 2001, resultObj[rootnm].ri, '');
            callback(rsc);
            return '0';
        }

        // for ceritification
        // if (request.query.real != 4) {
        //     notiObj = JSON.parse(JSON.stringify(resource_Obj));
        //     _this.remove_no_value(request, notiObj);
        //     sgn.check(request, notiObj[rootnm], 3);
        // }

        create_action(request, response, ty, resource_Obj, function (rsc, create_Obj) {
            if (rsc == '1') {
                _this.remove_no_value(request, create_Obj);

                if (request.query.real != 4) {
                    sgn.check(request, create_Obj[rootnm], 3);
                }

                var status_code = 201;
                var rsc_code = 2001;

                if (request.query.rt == 3) {
                    response.setHeader('Content-Location', create_Obj[rootnm].ri.replace('/', ''));
                }

                if (rootnm == 'smd') {
                    smd.request_post(request.url, JSON.stringify(create_Obj));
                }

                if (Object.keys(create_Obj)[0] == 'req') {
                    request.headers.tg = create_Obj[rootnm].ri.replace('/', '');
                    status_code = 202;
                    if(request.headers.hasOwnProperty('x-m2m-rtu')) {
                        rsc_code = 1002;
                    }
                    else {
                        rsc_code = 1001;
                    }
                    request.headers.rootnm = 'uri';
                    var resource_Obj = {};
                    resource_Obj.uri = {};
                    resource_Obj.uri = create_Obj[rootnm].ri.replace('/', '');
                    responder.response_result(request, response, status_code, resource_Obj, rsc_code, create_Obj[rootnm].ri, '');
                    callback(rsc);
                    return 0;
                }

                if (request.query.rcn == 2) { // hierarchical address
                    status_code = 201;
                    rsc_code = 2001;
                    request.headers.rootnm = 'uri';
                    var resource_Obj = {};
                    resource_Obj.uri = {};
                    resource_Obj.uri = create_Obj[rootnm].ri;
                    resource_Obj.uri = resource_Obj.uri.replace('/', ''); // make cse relative uri
                    responder.response_result(request, response, status_code, resource_Obj, rsc_code, create_Obj[rootnm].ri, '');
                    callback(rsc);
                    return 0;
                }
                else if (request.query.rcn == 3) { // hierarchical address and attributes
                    status_code = 201;
                    rsc_code = 2001;
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
        if (!err) {
            var finding_Obj = {};
            var found_Obj = {};

            request.query.cni = '0';
            if (request.query.ty == '2') {
                request.query.lvl = '1';
            }

            if (comm_Obj.ty == '3' && request.query.la) {
                request.query.cni = parseInt(comm_Obj.cni, 10);
            }

            if (request.query.lim != null) {
                if (request.query.lim > max_lim) {
                    request.query.lim = max_lim;
                }
            }
            else {
                request.query.lim = max_lim;
            }

            var cur_lvl = parseInt((url.parse(request.url).pathname.split('/').length), 10) - 2;
            for (var i = 0; i < search_Obj.length; i++) {
                if (request.query.lvl != null) {
                    var lvl = request.query.lvl;
                    if ((search_Obj[i].ri.split('/').length - 1) <= (cur_lvl + (parseInt(lvl, 10)))) {
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
            //var bef_d = moment(cur_d).subtract(Math.pow(3, 0), 'hours').format('YYYY-MM-DD HH:mm:ss');

            db_sql.search_lookup(comm_Obj.ri, request.query, request.query.lim, pi_list, 0, finding_Obj, 0, request.query.cni, cur_d, 0, response, function (err, search_Obj, response) {
                if (!err) {
                    if (Object.keys(search_Obj).length >= 1) {
                        if (Object.keys(search_Obj).length >= max_lim) {
                            response.setHeader('X-M2M-CTS', 1);

                            if (request.query.ofst != null) {
                                response.setHeader('X-M2M-CTO', parseInt(request.query.ofst, 10) + Object.keys(search_Obj).length);
                            }
                            else {
                                response.setHeader('X-M2M-CTO', Object.keys(search_Obj).length);
                            }
                        }

                        for (var index in search_Obj) {
                            if (search_Obj.hasOwnProperty(index)) {
                                ri_list.push(search_Obj[index].ri);
                                //found_Obj[search_Obj[index].ri] = search_Obj[index];
                                //delete search_Obj[index];
                            }
                        }

                        callback('1', ri_list, search_Obj);
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

function search_action(request, response, seq, resource_Obj, ri_list, strObj, presearch_Obj, callback) {
    if (ty_list.length <= seq) {
        callback('1', strObj);
        return '0';
    }

    var finding_Obj = [];
    var tbl = ty_list[seq];

    if (seq == 0) {
        console.time('search_resource');
    }

    if (request.query.ty != null) {
        tbl = request.query.ty;
        seq = ty_list.length;
    }

    db_sql.select_in_ri_list(responder.typeRsrc[tbl], ri_list, 0, finding_Obj, 0, function (err, search_Obj) {
        if (!err) {
            if (search_Obj.length >= 1) {
                //console.timeEnd('search_resource');

                if (strObj.length > 1) {
                    strObj += ',';
                }
                for (var i = 0; i < search_Obj.length; i++) {
                    //strObj += ('\"' + responder.typeRsrc[ty_list[ty]] + '-' + i + '\": ' + JSON.stringify(search_Obj[i]));
                    strObj += ('\"' + search_Obj[i].ri + '\": ' + JSON.stringify(search_Obj[i]));
                    if (i < search_Obj.length - 1) {
                        strObj += ',';
                    }
                }
            }

            if (++seq >= ty_list.length) {
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

global.makeObject = function (obj) {
    if(getType(obj) == 'object') {
        for(var attr in obj) {
            if (obj.hasOwnProperty(attr)) {
                if((getType(obj[attr]) == 'object' || getType(obj[attr]) == 'array')) {
                }
                else {
                    if(attr == 'subl') {
                        if((obj[attr] == null) || (attr == '')) {
                            obj[attr] = '[]';
                        }
                    }

                    if (attr == 'aa' || attr == 'at' || attr == 'lbl' || attr == 'srt' || attr == 'nu' || attr == 'acpi' || attr == 'poa' || attr == 'enc'
                        || attr == 'bn' || attr == 'pv' || attr == 'pvs' || attr == 'mid' || attr == 'uds' || attr == 'cas' || attr == 'macp'
                        || attr == 'rels' || attr == 'rqps' || attr == 'rsps' || attr == 'srv' || attr == 'mi' || attr == 'subl') {
                        obj[attr] = JSON.parse(obj[attr]);
                    }
                    else if (attr == 'trqp') {
                        var trqp_type = getType(obj.trqp);
                        if (trqp_type === 'object' || trqp_type === 'array' || trqp_type === 'string_object') {
                            try {
                                obj.trqp = JSON.parse(obj.trqp);
                            }
                            catch (e) {
                            }
                        }
                    }
                    else if (attr == 'trsp') {
                        var trsp_type = getType(obj.trsp);
                        if (trsp_type === 'object' || trsp_type === 'array' || trsp_type === 'string_object') {
                            try {
                                obj.trsp = JSON.parse(obj.trsp);
                            }
                            catch (e) {
                            }
                        }
                    }
                    else if (attr == 'con') {
                        var con_type = getType(obj.con);
                        if (con_type === 'object' || con_type === 'array' || con_type === 'string_object') {
                            try {
                                obj.con = JSON.parse(obj.con);
                            }
                            catch (e) {
                            }
                        }
                    }
                }
            }
        }
    }
};

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

exports.retrieve = function (request, response, resource_Obj) {
    var ty = resource_Obj.ty;

    if (request.query.fu == 2 && request.query.rcn == 1) {
        _this.set_rootnm(request, ty);

        var rootnm = request.headers.rootnm;

        // get_resource(request, function (rsc) {
        //     if (rsc == '0') {
        //         return rsc;
        //     }

            var retrieve_Obj = {};
            retrieve_Obj[rootnm] = merge({}, resource_Obj);
            _this.remove_no_value(request, retrieve_Obj);
            responder.response_result(request, response, 200, retrieve_Obj, 2000, retrieve_Obj[rootnm].ri, '');
            return '0';
        // });
    }
    else if (request.query.fu == 1 && (request.query.smf)) {
        smd.request_get_discovery(request, response, request.query.smf, function (response, statusCode, searchStr) {
            var ri_list = searchStr.split(',');
            if (statusCode == 200) {
                request.headers.rootnm = 'uril';
                var resource_Obj = {};
                resource_Obj.uril = {};
                resource_Obj.uril = ri_list;
                make_cse_relative(ri_list);
                responder.search_result(request, response, 200, resource_Obj, 2000, resource_Obj.ri, '');
            }
            else {
                resource_Obj = {};
                resource_Obj.dbg = {};
                resource_Obj.dbg = ri_list[0];
                var rsc = (statusCode == 400) ? 4000 : 4004;
                responder.response_result(request, response, statusCode, resource_Obj, rsc, resource_Obj.ri, resource_Obj.dbg);
            }
            return '0';
        });
    }
    else {
        search_resource(request, function (rsc, found_Obj) {
            if (rsc == '0') {
                return rsc;
            }
            //var ri_list = [comm_Obj.ri];
            var ri_list = [];
            presearch_action(request, response, ri_list, resource_Obj, function (rsc, ri_list, search_Obj) {
                if (rsc == '0') {
                    return rsc;
                }

                if (request.query.fu == 1) {
                    request.headers.rootnm = 'uril';
                    resource_Obj = {};
                    resource_Obj.uril = {};
                    resource_Obj.uril = ri_list;
                    make_cse_relative(ri_list);
                    responder.search_result(request, response, 200, resource_Obj, 2000, resource_Obj.ri, '');
                }
                else if (request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6) {
                    request.headers.rootnm = 'rsp';
                    resource_Obj = merge({}, search_Obj);
                    _this.remove_no_value(request, resource_Obj);
                    responder.search_result(request, response, 200, resource_Obj, 2000, resource_Obj.ri, '');
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

global.update_body = function (rootnm, body_Obj, resource_Obj) {
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

            if (attr === 'aa' || attr === 'poa' || attr === 'lbl' || attr === 'acpi' || attr === 'srt' || attr === 'nu' || attr === 'mid' || attr === 'macp' || attr === 'srv' || attr == 'subl') {
                if (body_Obj[rootnm][attr] === '') {
                    resource_Obj[rootnm][attr] = [];
                }

                if (attr === 'acpi') {
                    (resource_Obj[rootnm][attr]);
                }
                else if (attr === 'mid') {
                    resource_Obj[rootnm][attr] = remove_duplicated_mid(body_Obj[rootnm][attr]);
                }
            }
            else {
                if (body_Obj[rootnm][attr] === '') {
                    resource_Obj[rootnm][attr] = '';
                }
            }
        }
    }
};

function update_action(request, response, ty, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;
    var body_Obj = {};

    if (ty == '1') {
        db_sql.update_acp(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '2') {
        db_sql.update_ae(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '3') {
        db_sql.get_cni_count(resource_Obj[rootnm], function (cni, cbs, st) {
            resource_Obj[rootnm].cni = cni;
            resource_Obj[rootnm].cbs = cbs;
            resource_Obj[rootnm].st = st + 1;
            db_sql.update_cnt(resource_Obj[rootnm], function (err, results) {
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
        });
    }
    else if (ty == '9') {
        db_sql.update_grp(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '10') {
        db_sql.update_lcp(resource_Obj[rootnm], function (err, results) {
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
        if (responder.mgoType[resource_Obj[rootnm].mgd] == rootnm) {
            if (resource_Obj[rootnm].mgd == 1001) {
                db_sql.update_fwr(resource_Obj[rootnm], function (err, results) {
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
                db_sql.update_bat(resource_Obj[rootnm], function (err, results) {
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
                db_sql.update_dvi(resource_Obj[rootnm], function (err, results) {
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
                    JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].ri,
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
                db_sql.update_rbo(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '14') {
        db_sql.update_nod(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '16') {
        db_sql.update_csr(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '23') {
        db_sql.update_sub(resource_Obj[rootnm], function (err, results) {
            if (!err) {
                db_sql.select_lookup(resource_Obj[rootnm].pi, function (err, results_comm) {
                    if (!err) {
                        makeObject(results_comm[0]);
                        var parentObj = results_comm[0];
                        for(var idx in parentObj.subl) {
                            if(parentObj.subl.hasOwnProperty(idx)) {
                                if(parentObj.subl[idx].ri == resource_Obj[rootnm].ri) {
                                    parentObj.subl[idx] = resource_Obj[rootnm];
                                    break;
                                }
                            }
                        }
                        db_sql.update_lookup(parentObj, function (err, results) {
                            if (!err) {
                                callback('1', resource_Obj);
                            }
                        });
                    }
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
    else if (ty == '24') {
        db_sql.update_smd(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '29') {
        db_sql.update_ts(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '27') {
        db_sql.update_mms(resource_Obj[rootnm], function (err, results) {
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
    else if (ty == '38') { // transactionMgmt
        if (resource_Obj[rootnm].tctl == tctl_v.LOCK && (resource_Obj[rootnm].tst == tst_v.INITIAL)) { // LOCK
            tm.request_lock(resource_Obj, 0, function(rsc, resource_Obj, rsps) {
                if(rsc != '1') {
                    body_Obj = {};
                    body_Obj['dbg'] = "BAD_REQUEST: transaction resource could not create";
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }

                var check_tst = 0;
                for(var idx in rsps) {
                    if(rsps.hasOwnProperty(idx)) {
                        for(var root in rsps[idx].pc) {
                            if(rsps[idx].pc.hasOwnProperty(root)) {
                                for(var attr in rsps[idx].pc[root]) {
                                    if (rsps[idx].pc[root].hasOwnProperty(attr)) {
                                        if(attr === 'tst') {
                                            if(rsps[idx].pc[root][attr] == tst_v.LOCKED) {
                                                check_tst++;
                                            }
                                            else {
                                                check_tst = 0;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if(check_tst == 0) {
                    resource_Obj[rootnm].tst = tst_v.ERROR;
                }
                else {
                    resource_Obj[rootnm].tst = tst_v.LOCKED;
                }
                resource_Obj[rootnm].rsps = rsps;

                db_sql.update_tm(resource_Obj[rootnm], function (err, results) {
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
            });
        }
        else if ((resource_Obj[rootnm].tctl == tctl_v.EXECUTE) && (resource_Obj[rootnm].tst == tst_v.LOCKED)) { // EXECUTE
            tm.request_execute(resource_Obj, 0, function (rsc, resource_Obj, rsps) {
                var check_tst = 0;
                if(rsc == '1') {
                    for (var idx in rsps) {
                        if (rsps.hasOwnProperty(idx)) {
                            for (var root in rsps[idx].pc) {
                                if (rsps[idx].pc.hasOwnProperty(root)) {
                                    for (var attr in rsps[idx].pc[root]) {
                                        if (rsps[idx].pc[root].hasOwnProperty(attr)) {
                                            if (attr === 'tst') {
                                                if (rsps[idx].pc[root][attr] == tst_v.EXECUTED) {
                                                    check_tst++;
                                                }
                                                else {
                                                    check_tst = 0;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if(check_tst == 0) {
                    resource_Obj[rootnm].tst = tst_v.ERROR;
                }
                else {
                    resource_Obj[rootnm].tst = tst_v.LOCKED;
                }
                resource_Obj[rootnm].rsps = rsps;

                db_sql.update_tm(resource_Obj[rootnm], function (err, results) {
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
            });
        }
        else if ((resource_Obj[rootnm].tctl == tctl_v.ABORT) && (resource_Obj[rootnm].tst == tst_v.LOCKED || resource_Obj[rootnm].tst == tst_v.EXECUTED || resource_Obj[rootnm].tst == tst_v.ERROR)) { // ABORT
            tm.request_abort(resource_Obj, 0, function (rsc, resource_Obj, rsps) {
                var check_tst = 0;
                if(rsc == '1') {
                    for (var idx in rsps) {
                        if (rsps.hasOwnProperty(idx)) {
                            for (var root in rsps[idx].pc) {
                                if (rsps[idx].pc.hasOwnProperty(root)) {
                                    for (var attr in rsps[idx].pc[root]) {
                                        if (rsps[idx].pc[root].hasOwnProperty(attr)) {
                                            if (attr === 'tst') {
                                                if (rsps[idx].pc[root][attr] == tst_v.ABORTED) {
                                                    check_tst++;
                                                }
                                                else {
                                                    check_tst = 0;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if(check_tst == 0) {
                    resource_Obj[rootnm].tst = tst_v.ERROR;
                }
                else {
                    resource_Obj[rootnm].tst = tst_v.ABORTED;
                }
                resource_Obj[rootnm].rsps = rsps;

                db_sql.update_tm(resource_Obj[rootnm], function (err, results) {
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
            });
        }
        else if ((resource_Obj[rootnm].tctl == tctl_v.COMMIT) && resource_Obj[rootnm].tst == tst_v.EXECUTED) { // COMMIT
            tm.request_commit(resource_Obj, 0, function (rsc, resource_Obj, rsps) {
                var check_tst = 0;
                if(rsc == '1') {
                    for (var idx in rsps) {
                        if (rsps.hasOwnProperty(idx)) {
                            for (var root in rsps[idx].pc) {
                                if (rsps[idx].pc.hasOwnProperty(root)) {
                                    for (var attr in rsps[idx].pc[root]) {
                                        if (rsps[idx].pc[root].hasOwnProperty(attr)) {
                                            if (attr === 'tst') {
                                                if (rsps[idx].pc[root][attr] == tst_v.COMMITTED) {
                                                    check_tst++;
                                                }
                                                else {
                                                    check_tst = 0;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if(check_tst == 0) {
                    resource_Obj[rootnm].tst = tst_v.ERROR;
                }
                else {
                    resource_Obj[rootnm].tst = tst_v.COMMITTED;
                }
                resource_Obj[rootnm].rsps = rsps;

                db_sql.update_tm(resource_Obj[rootnm], function (err, results) {
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
            });
        }
        else if ((resource_Obj[rootnm].tctl == tctl_v.INITIAL) && (resource_Obj[rootnm].tst == tst_v.ERROR || resource_Obj[rootnm].tst == tst_v.COMMITTED || resource_Obj[rootnm].tst == tst_v.ABORTED)) { // INITIAL
            resource_Obj[rootnm].tst = tst_v.INITIAL;
            resource_Obj[rootnm].rsps = [];

            db_sql.update_tm(resource_Obj[rootnm], function (err, results) {
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
            body_Obj['dbg'] = 'BAD_REQUEST: state of transactionMgmt is mismatch';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else if (ty == '39') { // transaction
        if (resource_Obj[rootnm].tctl == tctl_v.LOCK && (resource_Obj[rootnm].tst == tst_v.ABORTED || resource_Obj[rootnm].tst == tst_v.COMMITTED)) { // LOCK
            resource_Obj[rootnm].tst = tst_v.LOCKED;
            resource_Obj[rootnm].trsp = '';
            db_sql.update_tr(resource_Obj[rootnm], function (err, results) {
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
        else if (resource_Obj[rootnm].tctl == tctl_v.EXECUTE && (resource_Obj[rootnm].tst == tst_v.LOCKED)) { // EXCUTE
            tr.request_execute(resource_Obj, function(rsc, resource_Obj) {
                db_sql.update_tr(resource_Obj[rootnm], function (err, results) {
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
            });
        }
        else if (resource_Obj[rootnm].tctl == tctl_v.COMMIT && (resource_Obj[rootnm].tst == tst_v.EXECUTED)) { // COMMIT
            tr.request_commit(resource_Obj, function (rsc, resource_Obj) {
                db_sql.update_tr(resource_Obj[rootnm], function (err, results) {
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
            });
        }
        else if (resource_Obj[rootnm].tctl == tctl_v.ABORT && (resource_Obj[rootnm].tst == tst_v.LOCKED || resource_Obj[rootnm].tst == tst_v.EXECUTED)) { // ABORT
            resource_Obj[rootnm].tst = tst_v.ABORTED;
            db_sql.update_tr(resource_Obj[rootnm], function (err, results) {
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
            body_Obj['dbg'] = 'BAD_REQUEST: state of transaction is mismatch';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = "ty does not supported";
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }
}

function create_resource(request, response, ty, body_Obj, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;

    if (ty_list.includes(ty.toString())) {
        // check M
        for (var attr in create_m_attr_list[rootnm]) {
            if (create_m_attr_list[rootnm].hasOwnProperty(attr)) {
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
                if (create_np_attr_list[rootnm].includes(attr)) {
                    body_Obj = {};
                    body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Not Present\' attribute';
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    callback('0', resource_Obj);
                    return '0';
                }
                else {
                    if (create_opt_attr_list[rootnm].includes(attr)) {
                    }
                    else {
                        body_Obj = {};
                        body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' attribute is not defined';
                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                        callback('0', resource_Obj);
                        return '0';
                    }
                }
            }
        }

        callback('1', resource_Obj);
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'we do not support to create resource';
        responder.response_result(request, response, 405, body_Obj, 4005, request.url, body_Obj['dbg']);
        callback('0', body_Obj);
        return '0';
    }
}

function check_acp_update_acpi(request, response, bodyObj, acpi, cr, callback) {
    // when update acpi check pvs of acp
    if (acpi.length > 0) {
        security.check(request, response, '1', acpi, '4', cr, function (rsc, request, response) {
            callback(rsc, request, response, bodyObj);
        });
    }
    else {
        callback('1', request, response, bodyObj);
    }
}

function update_resource(request, response, ty, body_Obj, resource_Obj, callback) {
    var rootnm = request.headers.rootnm;

    if (ty_list.includes(ty.toString())) {
        var mandatory_check_count = 0;

        // check Not Present and check Option and check Mandatory
        for (var attr in body_Obj[rootnm]) {
            if (body_Obj[rootnm].hasOwnProperty(attr)) {
                if (update_np_attr_list[rootnm].includes(attr)) {
                    body_Obj = {};
                    body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Not Present\' attribute';
                    responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                    callback('0');
                    return '0';
                }
                else {
                    if (update_opt_attr_list[rootnm].includes(attr)) {
                        if(attr === 'nu') {
                            if(body_Obj[rootnm][attr].length === 0) {
                                body_Obj = {};
                                body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' must have values';
                                responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                callback('0');
                                return '0';
                            }
                        }
                    }
                    else {
                        if (update_m_attr_list[rootnm].includes(attr)) {
                            if(attr === 'pvs') {
                                if(body_Obj[rootnm][attr].hasOwnProperty('acr')) {
                                    if(body_Obj[rootnm][attr].acr.length === 0) {
                                        body_Obj = {};
                                        body_Obj['dbg'] = 'BAD REQUEST: ' + attr + '.acr must have values';
                                        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                                        callback('0');
                                        return '0';
                                    }
                                }
                            }
                            mandatory_check_count += 1;
                        }
                        else {
                            body_Obj = {};
                            body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' attribute is not defined';
                            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
                            callback('0');
                            return '0';
                        }
                    }
                }
            }
        }

        if(body_Obj[rootnm].hasOwnProperty('acpi')) {
            var updateAcpiList = resource_Obj[rootnm].acpi;
        }
        else {
            updateAcpiList = [];
        }
        check_acp_update_acpi(request, response, body_Obj, updateAcpiList, resource_Obj[rootnm].cr, function (rsc, request, response, body_Obj) {
            if (rsc == '0') {
                body_Obj = {};
                body_Obj['dbg'] = resultStatusCode['4103'];
                responder.response_result(request, response, 403, body_Obj, 4103, request.url, resultStatusCode['4103']);
                callback('0', resource_Obj);
                return '0';
            }
            else {
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
        });
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'we do not support to update resource';
        responder.response_result(request, response, 405, body_Obj, 4005, request.url, body_Obj['dbg']);
        callback('0', body_Obj);
        return '0';
    }
}

exports.update = function (request, response, comm_Obj, body_Obj) {
    var rootnm = request.headers.rootnm;
    var updateObj = request.targetObject;
    var ty = updateObj[rootnm].ty;

    if(ty == 2) {
        updateObj[rootnm].cr = updateObj[rootnm].aei;
    }
    else if (ty == 16) {
        updateObj[rootnm].cr = updateObj[rootnm].cb;
    }

    update_resource(request, response, ty, body_Obj, updateObj, function (rsc, update_resource_Obj) {
        if (rsc == '0') {
            return rsc;
        }

        if (request.query.real == 4) { // realtime, new
            var notiObj = JSON.parse(JSON.stringify(update_resource_Obj));
            _this.remove_no_value(request, notiObj);
            sgn.check(request, notiObj[rootnm], 1);
        }

        if(ty == 23) { // when ty is 23, send notification for verification
            var notiObj = JSON.parse(JSON.stringify(update_resource_Obj));
            _this.remove_no_value(request, notiObj);
            sgn.check(request, notiObj[rootnm], 256);
        }

        update_action(request, response, ty, update_resource_Obj, function (rsc, update_Obj) {
            if (rsc == '1') {
                _this.remove_no_value(request, update_Obj);

                if (request.query.real != 4) {
                    sgn.check(request, update_Obj[rootnm], 1);
                }

                responder.response_result(request, response, 200, update_Obj, 2004, update_Obj[rootnm].ri, '');
                return '0';
            }
        });
    });
};

/* 20180322 removed <-- update stateTag for every resources

*/
function delete_action_st(pi, callback) {
    db_sql.select_st(pi, function (err, results_st) {
        if (results_st.length == 1) {
            var st = results_st[0]['st'];
            st = (parseInt(st, 10) + 1).toString();
            db_sql.update_st(results_st[0], function (err, results) {
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
    });
}

function delete_action(request, response, resource_Obj, comm_Obj, callback) {
    var pi_list = [];
    var result_ri = [];
    pi_list.push(comm_Obj.ri);
    console.time('search_parents_lookup ' + comm_Obj.ri);
    db_sql.search_parents_lookup(comm_Obj.ri, pi_list, result_ri, function (err, search_Obj) {
        console.timeEnd('search_parents_lookup ' + comm_Obj.ri);
        if (!err) {
            //if(search_Obj.length == 0) {
            //    pi_list.push(comm_Obj.ri);
            //}

            //pi_list.push(comm_Obj.ri);
            for (var i = 0; i < search_Obj.length; i++) {
                pi_list.push(search_Obj[i].ri);
            }

            var finding_Obj = [];
            console.time('delete_lookup ' + comm_Obj.ri);
            db_sql.delete_lookup(comm_Obj.ri, pi_list, 0, finding_Obj, 0, function (err, search_Obj) {
                if (!err) {
                    console.timeEnd('delete_lookup ' + comm_Obj.ri);
                    if (comm_Obj.ty == '23') {
                        if(comm_Obj.hasOwnProperty('su')) {
                            if(comm_Obj.su != '') {
                                var notiObj = JSON.parse(JSON.stringify(comm_Obj));
                                _this.remove_no_value(request, notiObj);
                                sgn.check(request, notiObj, 128);
                            }
                        }

                        db_sql.select_lookup(comm_Obj.pi, function (err, results_comm) {
                            if (!err) {
                                makeObject(results_comm[0]);
                                var parentObj = results_comm[0];
                                for(var idx in parentObj.subl) {
                                    if(parentObj.subl.hasOwnProperty(idx)) {
                                        if(parentObj.subl[idx].ri == comm_Obj.ri) {
                                            parentObj.subl.splice(idx, 1);
                                            break;
                                        }
                                    }
                                }
                                db_sql.update_lookup(parentObj, function (err, results) {
                                    if (!err) {
                                        callback('1', resource_Obj);
                                    }
                                });
                            }
                        });
                    }
                    else if (comm_Obj.ty == '29') {
                        delete_TS(function (rsc, res_Obj) {
                        });
                        callback('1', resource_Obj);
                    }
                    else if (comm_Obj.ty == '4') {
                        delete_action_st(comm_Obj.pi, function (rsc) {
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

exports.delete = function (request, response, comm_Obj) {
    var ty = comm_Obj.ty;

    _this.set_rootnm(request, ty);

    var rootnm = request.headers.rootnm;

    delete_resource(request, comm_Obj, function (rsc, resource_Obj) {
        if (rsc == '0') {
            return rsc;
        }

        if (request.query.real == 4) { // realtime, new
            var notiObj = JSON.parse(JSON.stringify(resource_Obj));
            _this.remove_no_value(request, notiObj);
            sgn.check(request, notiObj[rootnm], 4);
        }

        delete_action(request, response, resource_Obj, comm_Obj, function (rsc, delete_Obj) {
            if (rsc == '1') {
                _this.remove_no_value(request, delete_Obj);

                if (request.query.real != 4) {
                    sgn.check(request, delete_Obj[rootnm], 4);
                }

                responder.response_result(request, response, 200, delete_Obj, 2002, delete_Obj[rootnm].ri, '');
                return '0';
            }
        });
    });
};

