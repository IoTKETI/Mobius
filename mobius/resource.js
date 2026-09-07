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

var log_safe = require('./log_safe');
var name_limits = require('./name_limits');
var short_ri = require('./short_ri');
var url = require('url');
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
var lcp = require('./lcp');
var mms = require('./mms');
var acp = require('./acp');
var grp = require('./grp');
var nod = require('./nod');
var mgo = require('./mgo');
var fcnt = require('./fcnt');

var security = require('./security');
var acp_observe = require('./acp_observe');
var acp_filter = require('./acp_filter');
// DB facade.
var db = require('./db');
var db_facade = db;
var db_sql = require('./sql_action');
var db_errors = require('./db/errors');
var shape = require('./shape');

// moduleclass short name -> name of the sql_action insert/update function. cnd -> short name is shape.MODULE_CLASS; this table only maps short names to DB functions. Names are bound late through db_sql[name] so tests can replace the functions.
var HD_INSERT = {
    dooLk: 'insert_hd_dooLk', bat: 'insert_hd_bat', tempe: 'insert_hd_tempe', binSh: 'insert_hd_binSh',
    fauDn: 'insert_hd_fauDn', colSn: 'insert_hd_colSn', color: 'insert_hd_color', brigs: 'insert_hd_brigs'
};
var HD_UPDATE = {
    dooLk: 'update_hd_dooLk', bat: 'update_hd_bat', tempe: 'update_hd_tempe', binSh: 'update_hd_binSh',
    fauDn: 'update_hd_fauDn', colSn: 'update_hd_colSn', color: 'update_hd_color', brigs: 'update_hd_brigs'
};
var defaults = require('./defaults');
var rid = require('./rid');

var _this = this;

// search_action walks this list and queries the table of each type; every entry costs one query per discovery.
global.ty_list = ['1', '2', '3', '4', '5', '9', '10', '13', '14', '16', '23', '24', '27', '28', '91', '92', '93', '94', '95', '96', '97', '98'];

var create_np_attr_list = {};
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
create_np_attr_list.mms =['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'sid'];

create_np_attr_list.fwr = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'uds'];
create_np_attr_list.bat = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.dvi = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.dvc = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list.rbo = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];

create_np_attr_list.fcnt = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list['hd_dooLk'] = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list['hd_bat'] = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list['hd_tempe'] = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list['hd_binSh'] = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list['hd_fauDn'] = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list['hd_colSn'] = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list['hd_color'] = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];
create_np_attr_list['hd_brigs'] = ['ty', 'ri', 'pi', 'ct', 'lt', 'st'];

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
create_m_attr_list.mms =['soid', 'asd'];

create_m_attr_list.fwr = ['mgd', 'vr', 'fwnnam', 'url', 'ud'];
create_m_attr_list.bat = ['mgd', 'btl', 'bts'];
create_m_attr_list.dvi = ['mgd', 'dlb', 'man', 'mod', 'dty', 'fwv', 'swv', 'hwv'];
create_m_attr_list.dvc = ['mgd', 'can', 'att', 'cas', 'cus'];
create_m_attr_list.rbo = ['mgd'];

create_m_attr_list.fcnt = ['cnd'];
create_m_attr_list['hd_dooLk'] = ['cnd', 'lock'];
create_m_attr_list['hd_bat'] = ['cnd', 'lvl'];
create_m_attr_list['hd_tempe'] = ['cnd', 'curT0'];
create_m_attr_list['hd_binSh'] = ['cnd', 'powerSe'];
create_m_attr_list['hd_fauDn'] = ['cnd', 'sus'];
create_m_attr_list['hd_colSn'] = ['cnd', 'colSn'];
create_m_attr_list['hd_color'] = ['cnd', 'red', 'green', 'blue'];
create_m_attr_list['hd_brigs'] = ['cnd', 'brigs'];

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
create_opt_attr_list.mms =['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'stid', 'osd', 'sst'];

create_opt_attr_list.fwr = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.bat = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.dvi = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk'];
create_opt_attr_list.dvc = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk', 'ena', 'dis'];
create_opt_attr_list.rbo = ['rn', 'acpi', 'et', 'lbl', 'daci', 'objs', 'obps', 'dc', 'cmlk', 'rbo', 'far'];

create_opt_attr_list.fcnt = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_dooLk'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_bat'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_tempe'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_binSh'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_fauDn'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_colSn'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_color'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];
create_opt_attr_list['hd_brigs'] = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr'];

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
update_np_attr_list.mms =['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'sid', 'soid'];

update_np_attr_list.fwr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.bat = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.dvi = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.dvc = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];
update_np_attr_list.rbo = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'mgd', 'objs', 'obps'];

update_np_attr_list.fcnt = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_dooLk'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_bat'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_tempe'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_binSh'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_fauDn'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_colSn'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_color'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];
update_np_attr_list['hd_brigs'] = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnd'];

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
update_m_attr_list.mms = [];

update_m_attr_list.fwr = [];
update_m_attr_list.bat = [];
update_m_attr_list.dvi = [];
update_m_attr_list.dvc = [];
update_m_attr_list.rbo = [];

update_m_attr_list.fcnt = [];
update_m_attr_list['hd_dooLk'] = [];
update_m_attr_list['hd_bat'] = [];
update_m_attr_list['hd_tempe'] = [];
update_m_attr_list['hd_binSh'] = [];
update_m_attr_list['hd_fauDn'] = [];
update_m_attr_list['hd_colSn'] = [];
update_m_attr_list['hd_color'] = [];
update_m_attr_list['hd_brigs'] = [];

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
update_opt_attr_list.mms =['acpi', 'et', 'lbl', 'aa', 'at', 'stid', 'asd', 'osd', 'sst'];
// cr is not updatable: update_body copies every body attribute as is, and creator_bypasses grants access by cr.

update_opt_attr_list.fwr = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'vr', 'fwnnam', 'url', 'ud', 'uds'];
update_opt_attr_list.bat = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'btl', 'bts'];
update_opt_attr_list.dvi = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'dlb', 'man', 'mod', 'dty', 'fwv', 'swv', 'hwv'];
update_opt_attr_list.dvc = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'can', 'att', 'cas', 'cus', 'ena', 'dis'];
update_opt_attr_list.rbo = ['acpi', 'et', 'lbl', 'daci', 'dc', 'cmlk', 'rbo', 'far'];

update_opt_attr_list.fcnt = ['acpi', 'et', 'lbl'];
update_opt_attr_list['hd_dooLk'] = ['acpi', 'et', 'lbl', 'lock'];
update_opt_attr_list['hd_bat'] = ['acpi', 'et', 'lbl', 'lvl'];
update_opt_attr_list['hd_tempe'] = ['acpi', 'et', 'lbl', 'curT0'];
update_opt_attr_list['hd_binSh'] = ['acpi', 'et', 'lbl', 'powerSe'];
update_opt_attr_list['hd_fauDn'] = ['acpi', 'et', 'lbl', 'sus'];
update_opt_attr_list['hd_colSn'] = ['acpi', 'et', 'lbl', 'colSn'];
update_opt_attr_list['hd_color'] = ['acpi', 'et', 'lbl', 'red', 'green', 'blue'];
update_opt_attr_list['hd_brigs'] = ['acpi', 'et', 'lbl', 'brigs'];

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
            // Non-strings are left alone; the value then matches nothing in the later whereIn and is treated as an unknown ACP.
            if (typeof resource_Obj[index] !== 'string') { continue; }

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

// Unsupported types are rejected here: the insert_* functions below run insert_lookup first, so letting them through would leave an orphan lookup row when the body insert fails. The list belongs to the adapter.
function check_db_support(ty) {
    // A backend without restriction (MySQL) returns null and passes. This gate answers 501, so it must be fail-open; supportedResourceTypes() never throws (db/index.js).
    var allowed = db_facade.supportedResourceTypes();
    if (allowed === null) {
        return true;
    }
    return allowed.indexOf(String(ty)) >= 0;
}

function create_action(request, response, callback) {
    var rootnm = request.headers.rootnm;
    var ty = request.ty;
    var resource_Obj = request.resourceObj;
    var body_Obj = {};

    if (!check_db_support(ty)) {
        // The log does not name a backend: the gate fires because the adapter declares a support list, not because of a particular backend.
        console.log('[create_action] ty=' + ty + ' is not supported by this backend');
        callback('501-2');
        return;
    }

    if (ty == '1') {
        db_sql.insert_acp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '2') {
        db_sql.insert_ae(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    if(db_errors.isAeiDuplicate(results)) {
                        callback('409-6');
                    }
                    else {
                        callback('409-5');
                    }
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '3') {
        db_sql.insert_cnt(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                var cnt_parent_rootnm = Object.keys(request.targetObject)[0];

                // A child was created, so the parent's stateTag goes up. The response is sent after the update completes; a failed update is logged and does not change the response.
                db_sql.update_parent_st(request.db_connection,
                    request.targetObject[cnt_parent_rootnm], function (err) {
                        if (err) { console.log('[create_action] update_parent_st failed: ' + err); }
                        callback('200');
                    });
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '4') {
        var parent_rootnm = Object.keys(request.targetObject)[0];
        resource_Obj[rootnm].st = parseInt(request.targetObject[parent_rootnm].st, 10) + 1;
        request.targetObject[parent_rootnm].st = resource_Obj[rootnm].st;

        db_sql.insert_cin(request.db_connection, resource_Obj[rootnm], (err, results) => {
            if (!err) {
                var cs = parseInt(resource_Obj[rootnm].cs, 10);
                var parent_ri = request.targetObject[parent_rootnm].ri;

                // The parent counters are updated in place with two statements, both on the primary key. Limit enforcement is not done here; the primary's purge sweep does it (app.js), so there is a single purger and delete_oldest needs no locking.
                db_sql.update_parent_counters(request.db_connection, parent_ri, cs,
                    function () {
                        results = null;
                        callback('200');
                    });
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '9') {
        db_sql.insert_grp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '10') {
        db_sql.insert_lcp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '13') {
        if (resource_Obj[rootnm].mgd == 1001) {
            db_sql.insert_fwr(request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (db_errors.isDuplicateKey(results)) {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (resource_Obj[rootnm].mgd == 1006) {
            db_sql.insert_bat(request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (db_errors.isDuplicateKey(results)) {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (resource_Obj[rootnm].mgd == 1007) {
            db_sql.insert_dvi(request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (db_errors.isDuplicateKey(results)) {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (resource_Obj[rootnm].mgd == 1008) {
            db_sql.insert_dvc(request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (db_errors.isDuplicateKey(results)) {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (resource_Obj[rootnm].mgd == 1009) {
            db_sql.insert_rbo(request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (db_errors.isDuplicateKey(results)) {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else {
            // An mgd that is none of the five (1001 fwr, 1006 bat, 1007 dvi, 1008 dvc, 1009 rbo): return the code like the sibling branches. Currently unreachable because type_resolver rejects concrete mgmtObj types with 400-3 first.
            callback('400-53');
        }
    }
    else if (ty == '28' || ty == '98' || ty == '97' || ty == '96' || ty == '95' || ty == '94' || ty == '93' || ty == '92' || ty == '91') {
        // moduleclass short name; null with a non-device fcnt means an unknown pair.
        var hd = shape.hd_short(rootnm, resource_Obj[rootnm].cnd);
        if (rootnm == 'fcnt' && resource_Obj[rootnm].cnd.includes('org.onem2m.home.device.')) {
            db_sql.insert_fcnt(request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (db_errors.isDuplicateKey(results)) {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (hd !== null) {
            // The pair is decided by shape.hd_short and the function by the HD_INSERT name table.
            db_sql[HD_INSERT[hd]](request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (db_errors.isDuplicateKey(results)) {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else {
            callback('405-15');
        }
    }
    else if (ty == '14') {
        db_sql.insert_nod(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '16') {
        db_sql.insert_csr(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '23') {
        db_sql.insert_sub(request.db_connection, resource_Obj[rootnm], (err, results) => {
            if (!err) {
                // Nothing else to do: the sub row just inserted is the delivery list (notification routing reads the sub table).
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '24') {
        db_sql.insert_smd(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '27') {
        db_sql.insert_mms(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (db_errors.isDuplicateKey(results)) {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else {
        callback('400-36');
    }
}


function build_resource(request, response, callback) {
    var body_Obj = request.bodyObj;
    var rootnm = request.headers.rootnm;
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    if (body_Obj[rootnm]['rn'] == 'latest' || body_Obj[rootnm]['rn'] == 'oldest' || body_Obj[rootnm]['rn'] == 'ol' || body_Obj[rootnm]['rn'] == 'la') {
        callback('400-66');   // reserved rn: an invalid value, hence BAD_REQUEST
        return;
    }

    // rid.next_rn adds a worker tag and a sequence number to the timestamp so concurrent creates in the same millisecond do not collide on rn (which becomes the primary key).
    resource_Obj[rootnm].rn = rid.next_rn(request.ty);
    if (request.headers['x-m2m-nm'] != null && request.headers['x-m2m-nm'] != '') {
        resource_Obj[rootnm].rn = request.headers['x-m2m-nm'];
    }
    if (body_Obj[rootnm]['rn'] != null && body_Obj[rootnm]['rn'] != '') {
        resource_Obj[rootnm].rn = body_Obj[rootnm]['rn'];
    }

    if(91 <= parseInt(request.ty, 10) && parseInt(request.ty, 10) <= 98) {
        resource_Obj[rootnm].ty = '28';
    }
    else {
        resource_Obj[rootnm].ty = request.ty;
    }
    resource_Obj[rootnm].pi = url.parse(request.url).pathname;
    resource_Obj[rootnm].ri = resource_Obj[rootnm].pi + '/' + resource_Obj[rootnm].rn;
    // Names and paths over the schema width are rejected with 400 here instead of a MySQL 'Data too long' 500.
    var too_long = name_limits.check(resource_Obj[rootnm].rn, resource_Obj[rootnm].ri);
    if (too_long) {
        callback(too_long);
        return;
    }
    resource_Obj[rootnm].ct = moment().utc().format('YYYYMMDDTHHmmss');
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;
    resource_Obj[rootnm].st = 0;
    // Without an explicit et the resource effectively never expires (mobius/defaults.js).
    resource_Obj[rootnm].et = defaults.DEFAULT_ET;
    if (request.ty == '3') {
        resource_Obj[rootnm].mni = '3153600000';
    }

    if (request.ty == '4') {
        resource_Obj[rootnm].cs = '0';
        resource_Obj[rootnm].cnf = '';
    }

    if (ty_list.includes(request.ty.toString())) {
        // Types in ty_list without an attribute table (cb(5), mgo(13)) are rejected here; otherwise create_np_attr_list[rootnm] would be undefined and .includes would throw inside a DB callback. mgo is abstract; only its concrete types (fwr/bat/dvi/dvc/rbo) have tables.
        if (!create_np_attr_list.hasOwnProperty(rootnm)) {
            console.log('[build_resource] 속성표가 없는 리소스 이름이다: ' + rootnm + ' (ty=' + request.ty + ')');
            callback('405-15');
            return;
        }

        var mandatory_check_count = 0;

        // check Not_Present and check Option and check Mandatory
        for (var attr in body_Obj[rootnm]) {
            if (body_Obj[rootnm].hasOwnProperty(attr)) {
                if (create_np_attr_list[rootnm].includes(attr)) {
                    callback('400-22');
                    return;
                }
                else {
                    if (create_opt_attr_list[rootnm].includes(attr)) {
                    }
                    else {
                        if (create_m_attr_list[rootnm].includes(attr)) {
                            if(attr === 'pvs') {
                                if(body_Obj[rootnm][attr].hasOwnProperty('acr')) {
                                    if(body_Obj[rootnm][attr].acr.length == 0) {
                                        callback('400-23');
                                        return;
                                    }
                                }
                                else {
                                    callback('400-23');
                                    return;
                                }
                            }
                            else if(attr === 'nu') {
                                if(body_Obj[rootnm][attr].length == 0) {
                                    callback('400-24');
                                    return;
                                }
                            }
                            resource_Obj[rootnm][attr] = body_Obj[rootnm][attr];
                            mandatory_check_count += 1;
                        }
                        else {
                            callback('400-25');
                            return;
                        }
                    }
                }
            }
        }

        if(mandatory_check_count < create_m_attr_list[rootnm].length) {
            callback('400-26');
            return;
        }
    }
    else {
        callback('405-5');
        return;
    }

    resource_Obj[rootnm].acpi = (body_Obj[rootnm].acpi) ? body_Obj[rootnm].acpi : [];
    resource_Obj[rootnm].et = (body_Obj[rootnm].et) ? body_Obj[rootnm].et : resource_Obj[rootnm].et;
    resource_Obj[rootnm].lbl = (body_Obj[rootnm].lbl) ? body_Obj[rootnm].lbl : [];
    resource_Obj[rootnm].at = (body_Obj[rootnm].at) ? body_Obj[rootnm].at : [];
    resource_Obj[rootnm].aa = (body_Obj[rootnm].aa) ? body_Obj[rootnm].aa : [];

    if (body_Obj[rootnm].et == '') {
        if (body_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            callback('400-27');
            return;
        }
    }

    switch (request.ty) {
        case '1':
            acp.build_acp(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '2':
            ae.build_ae(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '3':
            cnt.build_cnt(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '4':
            cin.build_cin(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '9':
            grp.build_grp(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '10':
            lcp.build_lcp(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '13':
            mgo.build_mgo(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '98':
        case '97':
        case '96':
        case '95':
        case '94':
        case '93':
        case '92':
        case '91':
        case '28':
            fcnt.build_fcnt(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '14':
            nod.build_nod(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '16':
            csr.build_csr(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '23':
            sub.build_sub(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '24':
            smd.build_smd(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '27':
            mms.build_mms(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        default: {
            callback('405-15');
            return;
        }
    }
}

exports.create = function (request, response, callback) {
    var rootnm = request.headers.rootnm;

    // The gate is here: create_action has the same check, but the type-specific builder under build_resource touches the DB first (build_grp -> update_route -> select_csr_like), and on a backend without that table the failure would surface as 500 instead of 501.
    if (!check_db_support(request.ty)) {
        console.log('[create] ty=' + request.ty + ' is not supported by this backend');
        callback('501-2');
        return;
    }

    // Only requests that actually send acpi are validated; without acpi no query is made.
    var body = request.bodyObj && request.bodyObj[rootnm] ? request.bodyObj[rootnm] : {};
    if (!body.hasOwnProperty('acpi')) {
        build_and_create();
        return;
    }
    validate_acpi(request, response, body.acpi, function (code, normalized) {
        if (code) {
            callback(code);
            return;
        }
        // Replace with the normalised value; build_resource uses it as is.
        body.acpi = normalized;
        build_and_create();
    });

    function build_and_create() {
    build_resource(request, response, function (code) {
        if(code === '200') {
            var resource_Obj = request.resourceObj;

            resource_Obj[rootnm].spi = request.targetObject[Object.keys(request.targetObject)[0]].sri;
            // Short ids come from short_ri, which is unique across workers.
            resource_Obj[rootnm].sri = short_ri.generate(request.ty + '-');

            if(resource_Obj[rootnm].ty == 2) {
                resource_Obj[rootnm].sri = resource_Obj[rootnm].aei;
            }

            create_action(request, response, (code) => {
                if(code === '200') {
                    var made = request.resourceObj[rootnm];
                    // Recorded while the connection is alive; it is released after the response.
                    record_acp_change(request, 'acp_create', null,
                        request.ty == '1' ? { pv: made.pv, pvs: made.pvs } : null,
                        made.ri, request.ty, made.cr, function () {
                    record_acp_change(request, 'acpi_set', [], acpi_of(made),
                        made.ri, request.ty, made.cr, function () {
                    after_audit();
                    });
                    });
                    return;
                }
                else {
                    callback(code);
                }

                function after_audit() {
                    _this.remove_no_value(request, request.resourceObj);

                    if(request.ty != 23) {
                        sgn.check(request, request.resourceObj[rootnm], 3, function (code) {

                        });
                    }

                    if (request.query.rt == 3) {
                        response.header('Content-Location', request.resourceObj[rootnm].ri.replace('/', ''));
                    }


                    {
                        if (request.query.rcn == 2) { // hierarchical address
                            request.headers.rootnm = 'uri';
                            var resource_Obj = {};
                            resource_Obj.uri = {};
                            resource_Obj.uri = request.resourceObj[rootnm].ri;
                            resource_Obj.uri = resource_Obj.uri.replace('/', ''); // make cse relative uri
                            request.resourceObj = resource_Obj;

                            // rcn=2: a single uri; single shape. The result goes up as an argument.
                            callback(null, { rsc: 'CREATED', shape: 'single', rootnm: 'uri', body: request.resourceObj });
                        }
                        else if (request.query.rcn == 3) { // hierarchical address and attributes
                            request.headers.rootnm = rootnm;
                            request.resourceObj.rce = {};
                            request.resourceObj.rce.uri = request.resourceObj[rootnm].ri;
                            request.resourceObj.rce.uri = request.resourceObj.rce.uri.replace('/', ''); // make cse relative uri
                            request.resourceObj.rce[rootnm] = request.resourceObj[rootnm];
                            delete request.resourceObj[rootnm];

                            // rcn=3: rce shape.
                            callback(null, { rsc: 'CREATED', shape: 'rce', rootnm: rootnm, body: request.resourceObj });
                        }
                        else {
                            callback(null, { rsc: 'CREATED', shape: 'single', rootnm: rootnm, body: request.resourceObj });
                        }
                    }
                }
            });
        }
        else {
            callback(code);
        }
    });
    }
};

// Normalises the discovery request parameters. No DB access: search_lookup fetches the descendants with one recursive CTE, so no parent pre-scan is needed.
function presearch_action(request, response, pi_list, found_parent_list, callback) {
    var resource_Obj = request.resourceObj;
    var rootnm = Object.keys(resource_Obj)[0];

    // The cty filter is rejected before the DB is touched: it compares against cin.cnf, which holds only what clients sent (mostly empty) and has no index, so the answer would be wrong and slow. sza / szb are accepted: cs is filled by the server, so the answer is correct (and lookup.cs avoids the join since migration 012).
    if (request.query.cty != null) {
        callback('400-65');
        return;
    }

    request.query.cni = '0';

    // ty=2 (AE) lives directly under the CSE; no need to go deeper.
    if (request.query.ty == '2') {
        request.query.lvl = '1';
    }

    // la means 'the latest N CINs of this container': ty=4 and lvl=1 are fixed so the query is 'one parent + fixed type' and the index gives the order. On a non-container target this naturally yields 0 rows.
    if (request.query.la != null) {
        request.query.ty = '4';
        request.query.lvl = '1';
        if (resource_Obj[rootnm].ty == '3') {
            request.query.cni = parseInt(resource_Obj[rootnm].cni, 10);
        }
    }

    if (request.query.lim != null) {
        if (request.query.lim > max_lim) {
            request.query.lim = max_lim;
        }
    }
    else {
        request.query.lim = max_lim;
    }

    callback('200');
}

function search_action(request, response, seq, resource_Obj, ri_list, strObj, presearch_Obj, callback) {
    if (ty_list.length <= seq) {
        callback('1', strObj);
        return '0';
    }

    var finding_Obj = [];
    var tbl = ty_list[seq];

    if (request.query.ty != null) {
        tbl = request.query.ty;
        seq = ty_list.length;
    }

    db_sql.select_in_ri_list(request.db_connection, responder.typeRsrc[tbl], ri_list, 0, finding_Obj, 0, function (err, search_Obj) {
        if (!err) {
            if (search_Obj.length >= 1) {

                if (strObj.length > 1) {
                    strObj += ',';
                }
                for (var i = 0; i < search_Obj.length; i++) {
                    strObj += ('\"' + search_Obj[i].ri + '\": ' + JSON.stringify(search_Obj[i]));
                    if (i < search_Obj.length - 1) {
                        strObj += ',';
                    }
                }
            }

            if (++seq >= ty_list.length) {
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
                    if (attr == 'aa' || attr == 'at' || attr == 'lbl' || attr == 'srt' || attr == 'nu' || attr == 'acpi' || attr == 'poa' || attr == 'enc'
                        || attr == 'bn' || attr == 'pv' || attr == 'pvs' || attr == 'mid' || attr == 'uds' || attr == 'cas' || attr == 'macp'
                        || attr == 'rels' || attr == 'srv' || attr == 'mi') {
                        try {
                            if((obj[attr] == null) || (obj[attr] == '')) {
                                obj[attr] = '[]';
                            }

                            obj[attr] = JSON.parse(obj[attr]);
                        }
                        catch (e) {
                            console.log(e.message);
                        }
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

exports.retrieve = function (request, response, callback) {
    request.resourceObj = JSON.parse(JSON.stringify(request.targetObject));
    var rootnm = Object.keys(request.targetObject)[0];

    var ty = request.resourceObj[rootnm].ty;
    var resource_Obj = request.resourceObj;

    if (request.query.fu == 2 && request.query.rcn == 1) {
        _this.set_rootnm(request, ty);
        _this.remove_no_value(request, request.resourceObj);

        // The result goes up as an argument: an OK result object with the single shape and the current request.resourceObj as body.
        callback(null, { rsc: 'OK', shape: 'single', rootnm: request.headers.rootnm, body: request.resourceObj });
    }
    // A ?smf= parameter (semantic filter) is ignored and the request falls through to ordinary discovery; there is no semantic broker.
    else {
        // This branch yields two shapes only: uril for fu=1, grouped for rcn=4/5/6. The route gate lets rcn=7 through for GET, so fu=2&rcn=7 reaches here and is rejected with a catalogue code before discovery runs.
        if (request.query.fu != 1 &&
            !(request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6)) {
            callback('400-44');
            return;
        }

        request.headers.rootnm = 'agr';


        var found_parent_list = [];
        var ri_list = [];
        // The parent list is not collected in advance; search_lookup walks below the root with a recursive CTE, including lvl.
        var pi_list = [resource_Obj[rootnm].ri];
        var foundObj = {};

        presearch_action(request, response, pi_list, found_parent_list, function (code) {
            if (code == '200') {
                var cur_d = moment().add(1, 'd').utc().format('YYYY-MM-DD HH:mm:ss');
                db_sql.search_lookup(request.db_connection, resource_Obj[rootnm].ri, request.query, request.query.lim, pi_list, 0, foundObj, 0, request.query.cni, cur_d, 0, function (code, search_info) {
                    if (code === '200') {
                        db_sql.select_spec_ri(request.db_connection, foundObj, 0, function (code) {
                            if(code !== '200') { return callback(code); }
                            // Filter the results by per-resource ACP so a locked subtree does not leak its paths. Runs after select_spec_ri so cr is already merged and the creator bypass needs no query.
                            acp_filter.filter_found(request.db_connection, request,
                                resource_Obj[rootnm].ri, foundObj, function (ferr, fstat) {
                            if (ferr) {
                                console.error('[discovery] ACP 필터 실패 — 결과를 내보내지 않는다: ' +
                                    db_errors.text(fstat));
                                return callback('500-1');
                            }
                            if (fstat.removed > 0) {
                                console.log('[acp] discovery filtered removed=' + fstat.removed +
                                    ' kept=' + fstat.kept + ' evaluated=' + fstat.evaluated +
                                    ' queries=' + fstat.queries +
                                    ' origin=' + log_safe.origin(request.headers['x-m2m-origin']) +
                                    ' url=' + request.url);
                            }
                            {
                                // Signal a truncated result (oneM2M: CTS=1 partial result, CTO offset to continue). The criterion is whether the SQL limit was exactly filled; search_lookup reports the limit it actually applied and the rows it returned, so the verdict cannot disagree with the SQL.
                                if (search_info && search_info.limit > 0 &&
                                    search_info.rows >= search_info.limit) {
                                    response.header('X-M2M-CTS', 1);
                                    response.header('X-M2M-CTO',
                                        search_info.offset + search_info.rows);
                                }

                                // A lbl search without ty excludes CINs (like cannot use the index, so the candidate set would be the whole cin table). The narrowing is announced in a response header and the log, so a missing CIN can be told from an unsearched one.
                                if (search_info && search_info.skippedCin) {
                                    response.header('X-M2M-Partial-Scope', 'ty!=4');
                                    console.log('[discovery] lbl 검색에 ty 가 없어 CIN 을 뺐다 ' +
                                        '(찾으려면 ty=4 와 더 좁은 대상) url=' + request.url);
                                }

                                if (Object.keys(foundObj).length >= 1) {
                                    for (var index in foundObj) {
                                        if (foundObj.hasOwnProperty(index)) {
                                            ri_list.push(foundObj[index].ri);
                                        }
                                    }
                                }

                                if (request.query.fu == 1) {
                                    request.headers.rootnm = 'uril';
                                    make_cse_relative(ri_list);
                                    request.resourceObj = {};
                                    request.resourceObj.uril = {};
                                    request.resourceObj.uril = ri_list;

                                    // fu=1: uril shape.
                                    callback(null, { rsc: 'OK', shape: 'uril', rootnm: 'uril', body: request.resourceObj });
                                }
                                else if (request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6) {
                                    request.headers.rootnm = 'rsp';
                                    request.resourceObj = JSON.parse(JSON.stringify(foundObj));
                                    _this.remove_no_value(request, request.resourceObj);

                                    // rcn=4/5/6: grouped shape (root name 'rsp').
                                    callback(null, { rsc: 'OK', shape: 'grouped', rootnm: request.headers.rootnm, body: request.resourceObj });
                                }
                                else {
                                    // Unreachable because of the rejection above; kept as a guard, because an uncatalogued '400' would become a 500.
                                    callback('400-44');
                                }
                            }
                            });
                        });
                    }
                    else {
                        callback(code);
                    }
                });
            }
            else {
                callback(code);
            }
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

            if (attr === 'aa' || attr === 'poa' || attr === 'lbl' || attr === 'acpi' || attr === 'srt' || attr === 'nu' || attr === 'mid' || attr === 'macp' || attr === 'srv') {
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

function update_action(request, response, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = request.resourceObj;
    var ty = request.ty;
    var body_Obj = {};

    if (ty == '1') {
        db_sql.update_acp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else if (ty == '2') {
        db_sql.update_ae(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else if (ty == '3') {
        db_sql.get_cni_count(request.db_connection, resource_Obj[rootnm], function (cni, cbs, st) {
            resource_Obj[rootnm].cni = cni;
            resource_Obj[rootnm].cbs = cbs;
            resource_Obj[rootnm].st = st + 1;
            db_sql.update_cnt(request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    console.log('[update_action] ty=' + ty + ' error: ' +
                                (results.driverCode || results.code) + ' / ' + results.message);
                    callback('500-1');
                }
            });
        });
    }
    else if (ty == '9') {
        db_sql.update_grp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else if (ty == '10') {
        db_sql.update_lcp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else if (ty == '13') {
        if (responder.mgoType[resource_Obj[rootnm].mgd] == rootnm) {
            if (resource_Obj[rootnm].mgd == 1001) {
                db_sql.update_fwr(request.db_connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        console.log('[update_action] ty=' + ty + ' error: ' +
                                    (results.driverCode || results.code) + ' / ' + results.message);
                        callback('500-1');
                    }
                });
            }
            else if (resource_Obj[rootnm].mgd == 1006) {
                db_sql.update_bat(request.db_connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        console.log('[update_action] ty=' + ty + ' error: ' +
                                    (results.driverCode || results.code) + ' / ' + results.message);
                        callback('500-1');
                    }
                });
            }
            else if (resource_Obj[rootnm].mgd == 1007) {
                db_sql.update_dvi(request.db_connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        console.log('[update_action] ty=' + ty + ' error: ' +
                                    (results.driverCode || results.code) + ' / ' + results.message);
                        callback('500-1');
                    }
                });
            }
            else if (resource_Obj[rootnm].mgd == 1008) {
                // update_dvc takes (connection, obj, callback) like its siblings.
                db_sql.update_dvc(request.db_connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        console.log('[update_action] ty=' + ty + ' error: ' +
                                    (results.driverCode || results.code) + ' / ' + results.message);
                        callback('500-1');
                    }
                });
            }
            else if (resource_Obj[rootnm].mgd == 1009) {
                db_sql.update_rbo(request.db_connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        console.log('[update_action] ty=' + ty + ' error: ' +
                                    (results.driverCode || results.code) + ' / ' + results.message);
                        callback('500-1');
                    }
                });
            }
            else {
                callback('400-53');
            }
        }
        else {
            callback('400-51');
        }
    }
    else if (ty == '28' || ty == '98' || ty == '97' || ty == '96' || ty == '95' || ty == '94' || ty == '93' || ty == '92' || ty == '91') {
        // UPDATE checks cnd only, not rootnm.
        var hd = shape.cnd_short(resource_Obj[rootnm].cnd);
        if (resource_Obj[rootnm].cnd.includes('org.onem2m.home.device.')) {
            db_sql.update_fcnt(request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    console.log('[update_action] ty=' + ty + ' error: ' +
                                (results.driverCode || results.code) + ' / ' + results.message);
                    callback('500-1');
                }
            });
        }
        else if (hd !== null) {
            // The function is chosen by the HD_UPDATE name table.
            db_sql[HD_UPDATE[hd]](request.db_connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    console.log('[update_action] ty=' + ty + ' error: ' +
                                (results.driverCode || results.code) + ' / ' + results.message);
                    callback('500-1');
                }
            });
        }
        else {
            callback('400-53');
        }
    }
    else if (ty == '14') {
        db_sql.update_nod(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else if (ty == '16') {
        db_sql.update_csr(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else if (ty == '23') {
        db_sql.update_sub(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                // Nothing else to do: the updated sub row is the delivery list (notification routing reads the sub table).
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else if (ty == '24') {
        db_sql.update_smd(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else if (ty == '27') {
        db_sql.update_mms(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                console.log('[update_action] ty=' + ty + ' error: ' +
                            (results.driverCode || results.code) + ' / ' + results.message);
                callback('500-1');
            }
        });
    }
    else {
        callback('400-52');
    }
}


// Serialised length limit for acpi: lookup.acpi is varchar(200). With 22-character ris, 7 entries fit (176) and 8 do not (201).
var ACPI_MAX_JSON = 200;

/**
 * Validates acpi and normalises it to internal ri notation: every entry must be a string, the count and the serialised length must fit the column, sri-form entries are resolved to ri, duplicates are dropped, and every referenced ACP must exist. Only values being written are checked; stored acpi is not touched.
 *
 * @param opts.maxJson  serialised length limit; default lookup.acpi's varchar(200). grp.macp is mediumtext and passes a larger one.
 * @param callback callback(null, normalized) on success / callback(code) on rejection
 */
global.validate_acpi = function (request, response, acpi, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};
    var maxJson = o.maxJson || ACPI_MAX_JSON;

    if (!Array.isArray(acpi)) {
        callback('400-8');
        return;
    }
    for (var i = 0; i < acpi.length; i++) {
        if (typeof acpi[i] !== 'string') {
            callback('400-61');
            return;
        }
    }
    if (acpi.length === 0) {
        callback(null, []);
        return;
    }

    // The element count is capped first, cheaply: the length check can only run after sri resolution (a short sri can expand into a long ri). The cap follows from the serialised limit (at least three characters per element) and is never reached in normal use.
    var max_count = Math.max(8, Math.ceil(maxJson / 3));
    if (acpi.length > max_count) {
        console.log('[acp] reject 400-62 — 원소가 ' + acpi.length + '개다 (상한 ' + max_count + ')');
        callback('400-62');
        return;
    }

    var given = acpi.slice();
    make_internal_ri(given);

    var ri_list = [];
    get_ri_list_sri(request, response, given, ri_list, 0, function (code) {
        if (code !== '200') {
            callback(code);
            return;
        }

        // Duplicates are dropped silently, like remove_duplicated_mid for mid.
        var normalized = [];
        for (var j = 0; j < ri_list.length; j++) {
            if (normalized.indexOf(ri_list[j]) === -1) {
                normalized.push(ri_list[j]);
            }
        }

        if (JSON.stringify(normalized).length > maxJson) {
            callback('400-62');
            return;
        }

        db_sql.select_acp_in(request.db_connection, normalized, function (err, rows) {
            if (err) {
                callback('500-1');
                return;
            }
            var found = {};
            for (var k = 0; k < rows.length; k++) { found[rows[k].ri] = true; }

            var missing = normalized.filter(function (r) { return !found[r]; });
            if (missing.length > 0) {
                // Which entry is missing cannot go into the response (msg is static); it is logged.
                console.log('[acp] reject 400-63 — 없는 ACP 를 가리킨다: ' + missing.join(', '));
                callback('400-63');
                return;
            }

            callback(null, normalized);
        });
    });
};

/**
 * Whether the requester may change acpi.
 *
 * @param acpi     the acpi currently attached, not the new one
 * @param newAcpi  the acpi to attach (for observation); optional
 */
function check_acp_update_acpi(request, response, acpi, cr, newAcpi, callback) {
    if (typeof newAcpi === 'function') { callback = newAcpi; newAcpi = undefined; }

    // With an ACP already attached, that ACP's pvs decides (oneM2M selfPrivileges).
    if (acpi.length > 0) {
        security.check(request, response, '1', acpi, '4', cr, function (code) {
            callback(code);
        });
        return;
    }

    // With no ACP attached, acpiAttachPolicy decides: 'open' lets any authenticated originator attach the first acpi; 'creator' restricts it to the creator and the superuser. The attachment is recorded for observation either way.
    var from = request.headers['x-m2m-origin'];
    var target_ri = request.url ? request.url.split('?')[0] : '';

    if (newAcpi !== undefined && newAcpi !== null && newAcpi.length > 0) {
        acp_observe.record('acpi_attach', {
            ri: target_ri, ty: request.ty, origin: from, cr: cr,
            before: [], after: newAcpi
        });
    }

    if (global.acpi_attach_policy === 'creator') {
        var is_su = (from === usesuperuser || from === ('/' + usesuperuser));
        callback((is_su || (cr && from === cr)) ? '1' : '0');
        return;
    }

    callback('1');
}

function update_resource(request, response, callback) {
    var rootnm = request.headers.rootnm;
    var body_Obj = request.bodyObj;
    var resource_Obj = {};
    resource_Obj[rootnm] = request.targetObject[Object.keys(request.targetObject)[0]];

    if (ty_list.includes(request.ty.toString())) {
        // Same guard as in build_resource; UPDATE has no parent-child validation in front of it, so a body naming a type without an attribute table (m2m:cb) would otherwise reach here with an undefined table.
        if (!update_np_attr_list.hasOwnProperty(rootnm)) {
            console.log('[update_resource] 속성표가 없는 리소스 이름이다: ' + rootnm + ' (ty=' + request.ty + ')');
            callback('405-15');
            return;
        }

        var mandatory_check_count = 0;

        // check Not Present and check Option and check Mandatory
        for (var attr in body_Obj[rootnm]) {
            if (body_Obj[rootnm].hasOwnProperty(attr)) {
                if (update_np_attr_list[rootnm].includes(attr)) {
                    callback('400-22');
                    return;
                }
                else {
                    if (update_opt_attr_list[rootnm].includes(attr)) {
                        if(attr === 'nu') {
                            if(body_Obj[rootnm][attr].length === 0) {
                                callback('400-24');
                                return;
                            }
                        }
                        // pv/pvs are optional attributes of acp and never reach the mandatory branch below, so they are validated here; an invalid pvs would otherwise be stored and lock the ACP for everyone but the superuser.
                        else if (attr === 'pv' || attr === 'pvs') {
                            var v = acp.validate_privileges(body_Obj[rootnm][attr], attr);
                            for (var wi = 0; wi < v.warnings.length; wi++) {
                                console.log('[acp] warn ' + v.warnings[wi].rule + ' at ' +
                                    v.warnings[wi].path + ' — ' + v.warnings[wi].message);
                            }
                            if (v.code !== null) {
                                console.log('[acp] reject ' + v.code + ' at ' + v.path);
                                callback(v.code);
                                return;
                            }
                        }
                    }
                    else {
                        if (update_m_attr_list[rootnm].includes(attr)) {
                            if(attr === 'pvs') {
                                if(body_Obj[rootnm][attr].hasOwnProperty('acr')) {
                                    if(body_Obj[rootnm][attr].acr.length === 0) {
                                        callback('400-23');
                                        return;
                                    }
                                }
                            }
                            mandatory_check_count += 1;
                        }
                        else {
                            callback('400-25');
                            return;
                        }
                    }
                }
            }
        }

        // macp takes the same path into the access check as acpi (the group fan-out in app.js passes it to security.check), so it is validated the same way.
        if (body_Obj[rootnm].hasOwnProperty('macp')) {
            validate_acpi(request, response, body_Obj[rootnm].macp, { maxJson: 2000 },
                function (mcode, mnorm) {
                    if (mcode) { return callback(mcode); }
                    body_Obj[rootnm].macp = mnorm;
                    after_macp();
                });
            return;
        }
        after_macp();

        function after_macp() {
        if (!body_Obj[rootnm].hasOwnProperty('acpi')) {
            run_acp_check([]);
            return;
        }

        // Access is checked with the acpi currently attached, not the new one; resource_Obj still holds the row as read from the DB (update_body runs later).
        var existingAcpi = resource_Obj[rootnm].acpi;

        // A PUT that only changes acpi passes here too; what app.js skips is authorize_and_run (access to the target), not update_resource.
        validate_acpi(request, response, body_Obj[rootnm].acpi, function (code, normalized) {
            if (code) {
                callback(code);
                return;
            }
            // update_body copies body values as is, so replacing it here is enough.
            body_Obj[rootnm].acpi = normalized;
            run_acp_check(existingAcpi, normalized);
        });

        function run_acp_check(updateAcpiList, newAcpi) {
        check_acp_update_acpi(request, response, updateAcpiList, resource_Obj[rootnm].cr, newAcpi, function (code) {
            if (code === '1') {
                update_body(rootnm, body_Obj, resource_Obj);

                resource_Obj[rootnm].st = (parseInt(resource_Obj[rootnm].st, 10) + 1).toString();
                resource_Obj[rootnm].lt = moment().utc().format('YYYYMMDDTHHmmss');

                if (body_Obj[rootnm].et == '') {
                    if (body_Obj[rootnm].et < resource_Obj[rootnm].ct) {
                        callback('400-27');
                        return;
                    }
                }
                request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));

                callback('200');
            }
            else if (code === '0') {
                callback('403-3');
            }
            else {
                callback(code);
            }
        });
        }
        }
    }
    else {
        callback('405-5');
    }
}

// Records history only when acpi / pv / pvs actually changed. Not deferred with setImmediate: by then the response is out and the connection returned to the pool, so the INSERT would run inside another request's transaction. insert_acp_audit is best-effort; a failure does not fail the request.
function record_acp_change(request, op, before, after, ri, ty, cr, done) {
    var cb = done || function () {};
    if (global.acp_audit === 'off') { return cb(); }
    if (JSON.stringify(before) === JSON.stringify(after)) { return cb(); }

    db_sql.insert_acp_audit(request.db_connection, {
        op: op, ri: ri, ty: ty,
        origin: request.headers ? request.headers['x-m2m-origin'] : undefined,
        cr: cr, before: before, after: after
    }, cb);
}

function acpi_of(obj) {
    if (!obj) { return []; }
    var v = obj.acpi;
    if (Array.isArray(v)) { return v; }
    if (typeof v !== 'string' || v === '') { return []; }
    try {
        var o = JSON.parse(v);
        return Array.isArray(o) ? o : [];
    }
    catch (e) { return []; }
}

exports.update = function (request, response, callback) {
    var rootnm = request.headers.rootnm;
    var updateObj = request.targetObject;

    // rootnm is the body's root name and updateObj is keyed by the target row's type; when they differ updateObj[rootnm] is undefined. check_type_update_resource in app.js cannot catch this because the request.ty it compares was derived from the same body.
    if (!updateObj[rootnm]) {
        console.log('[update] 본문 루트(' + rootnm + ')가 대상 행의 타입(' +
                    Object.keys(updateObj).join(',') + ')과 다르다: ' + request.url);
        callback('400-42');
        return;
    }

    var ty = updateObj[Object.keys(updateObj)[0]].ty;

    if(ty == 2) {
        updateObj[rootnm].cr = updateObj[rootnm].aei;
    }
    else if (ty == 16) {
        updateObj[rootnm].cr = updateObj[rootnm].cb;
    }

    // Capture the old values before update_resource builds a new resourceObj.
    var before_acpi = acpi_of(updateObj[rootnm]);
    var before_pv = updateObj[rootnm].pv;
    var before_pvs = updateObj[rootnm].pvs;

    update_resource(request, response, function (code) {
        if(code === '200') {
            update_action(request, response, function (code) {
                if (code == '200') {
                    var now = request.resourceObj[rootnm];
                    // Recorded while the connection is alive; it is released after the response.
                    record_acp_change(request, 'acpi_set', before_acpi, acpi_of(now),
                        now.ri, ty, now.cr, function () {
                    record_acp_change(request, 'acp_update',
                        ty == 1 ? { pv: before_pv, pvs: before_pvs } : null,
                        ty == 1 ? { pv: now.pv, pvs: now.pvs } : null,
                        now.ri, ty, now.cr, function () {

                    _this.remove_no_value(request, request.resourceObj);

                    sgn.check(request, request.resourceObj[rootnm], 1, function (code) {

                    });

                    // The result goes up as an argument: UPDATED, single shape.
                    callback(null, { rsc: 'UPDATED', shape: 'single', rootnm: rootnm, body: request.resourceObj });
                    });
                    });
                }
                else {
                    callback(code);
                }
            });
        }
        else {
            callback(code);
        }
    });
};


// Leaf types (types that cannot have children) need no background subtree delete. Types not listed schedule a descendant scan on delete.
var leaf_ty_list = ['1', '4', '9', '23'];

// Asynchronous subtree delete (R4 style): the response goes out right after the root row is deleted and the descendants are deleted in the background on a separate connection. Orphans left by a crash mid-way are cleaned by delete_orphan_lookup.
function delete_descendants_background(root_ri, attempt) {
    attempt = attempt || 1;

    // The connection comes from the facade.
    {
        db.getConnection(function (code, connection) {
            if (code === '200') {
                run(connection);
            }
            else {
                // No connection available: retry every 5 seconds with a counter, and give up after a bounded number of attempts; the orphans can be cleaned later.
                if (attempt >= 12) {          // 5 s x 12 = 1 minute
                    console.error('[delete_descendants] ' + root_ri +
                                  ' 커넥션을 ' + attempt + '번 못 빌려 포기한다. 자손이 고아로 남는다.');
                    return;
                }
                if (attempt === 1) {
                    console.error('[delete_descendants] ' + root_ri +
                                  ' 커넥션을 못 빌렸다 — 5초 뒤 재시도 (풀 고갈?)');
                }
                setTimeout(delete_descendants_background, 5000, root_ri, attempt + 1);
            }
        });
    }

    function run(connection) {
        var pi_list = [root_ri];
        var result_ri = [];
        db_sql.search_parents_lookup_all(connection, pi_list, [], result_ri, function (code) {
            if (code !== '200') {
                // The descendant list could not be built. The root is already gone, so the whole subtree becomes orphaned; logged.
                console.error('[delete_descendants] ' + root_ri +
                              ' 의 자손 목록을 만들지 못했다 (code=' + code +
                              '). 자손이 통째로 고아로 남는다.');
                if (connection) db.release(connection);
                return;
            }
            for (var i = 0; i < result_ri.length; i++) {
                pi_list.push(result_ri[i].ri);
            }
            pi_list.reverse();
            db_sql.delete_lookup(connection, pi_list, 0, [], 0, function (code) {
                // A delete that stopped mid-way is logged with the number of targets, so orphans can be traced (candidates: InnoDB deadlocks between workers deleting overlapping subtrees, the 60 s query timeout on large subtrees, a dropped connection).
                if (code !== '200') {
                    console.error('[delete_descendants] ' + root_ri +
                                  ' subtree 삭제가 끝나지 못했다 (code=' + code +
                                  ', 대상 ' + pi_list.length + '개). 남은 것은 고아가 된다.');
                }
                if (connection) db.release(connection);
            });
        });
    }
}

function delete_action(request, response, callback) {
    var resource_Obj = request.resourceObj;
    var rootnm = Object.keys(request.resourceObj)[0];

    db_sql.delete_ri_lookup(request.db_connection, resource_Obj[rootnm].ri, function (err) {
        if(!err) {
            if (leaf_ty_list.indexOf(String(resource_Obj[rootnm].ty)) < 0) {
                setImmediate(delete_descendants_background, resource_Obj[rootnm].ri);
            }

                            // for sgn
                            db_sql.select_lookup(request.db_connection, resource_Obj[rootnm].pi, function (err, results) {
                                if (!err) {
                                    if (results.length === 0) {
                                        // The parent row is already gone (orphan delete or a concurrent subtree delete). The resource itself is deleted, so the parent update is skipped and the delete succeeds.
                                        callback('200');
                                        return;
                                    }
                                    var ty = results[0].ty;
                                    request.targetObject = {};
                                    request.targetObject[responder.typeRsrc[ty]] = results[0];
                                    var parent_rootnm = Object.keys(request.targetObject)[0];
                                    makeObject(request.targetObject[parent_rootnm]);

                                    if (resource_Obj[rootnm].ty == '23') {
                                        if(resource_Obj[rootnm].hasOwnProperty('su')) {
                                            if(resource_Obj[rootnm].su != '') {
                                                var notiObj = JSON.parse(JSON.stringify(resource_Obj[rootnm]));
                                                _this.remove_no_value(request, notiObj);
                                                sgn.check(request, notiObj, 128, function (code) {

                                                });
                                            }
                                        }

                                        // Nothing else to do for the sub table: the row disappears by FK CASCADE, which ends delivery. The parent's stateTag goes up because a child was deleted; the response is sent after the update.
                                        db_sql.update_parent_st(request.db_connection,
                                            request.targetObject[parent_rootnm], function (err) {
                                                if (err) { console.log('[delete_action] update_parent_st failed: ' + err); }
                                                callback('200');
                                            });
                                    }
                                    else if (resource_Obj[rootnm].ty == '4') {
                                        // The parent was already read by select_lookup above. cs (the deleted CIN's contentSize) is passed so the parent's cbs is decremented correctly.
                                        db_sql.update_parent_by_delete(request.db_connection,
                                            request.targetObject[parent_rootnm],
                                            parseInt(resource_Obj[rootnm].cs, 10) || 0,
                                            function () {
                                            });

                                        callback('200');
                                    }
                                    else {
                                        // Any deleted child raises the parent's stateTag; the response is sent after the update.
                                        db_sql.update_parent_st(request.db_connection,
                                            request.targetObject[parent_rootnm], function (err) {
                                                if (err) { console.log('[delete_action] update_parent_st failed: ' + err); }
                                                callback('200');
                                            });
                                    }
                                }
                                else {
                                    callback('500-1');
                                }
                            });
        }
        else {
            callback('500-1');
        }
    });
}

exports.delete = function (request, response, callback) {
    request.resourceObj = JSON.parse(JSON.stringify(request.targetObject));
    var rootnm = Object.keys(request.resourceObj)[0];

    // DELETE has no body, so request.ty is null (app.js check_xm2m_headers); the type of the deleted resource itself is used, as in retrieve.
    var ty = request.resourceObj[rootnm].ty;

    _this.set_rootnm(request, ty);

    delete_action(request, response, function (code) {
        if (code === '200') {
            var gone = request.resourceObj[rootnm];
            var gone_ty = ty;   // read from the target row above
            // Deleting an ACP silently opens the resources that referenced it (creator only), so what disappeared is recorded. Recorded while the connection is alive; it is released after the response.
            record_acp_change(request, 'acp_delete',
                gone_ty == '1' ? { pv: gone.pv, pvs: gone.pvs } : null, null,
                gone.ri, gone_ty, gone.cr, function () {

            _this.remove_no_value(request, request.resourceObj);

            sgn.check(request, request.resourceObj[rootnm], 4, function (code) {

            });

            // The result goes up as an argument: DELETED, single shape.
            callback(null, { rsc: 'DELETED', shape: 'single', rootnm: rootnm, body: request.resourceObj });
            });
        }
        else {
            callback(code);
        }
    });
};


