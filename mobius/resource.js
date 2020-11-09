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
var fcnt = require('./fcnt');
var tm = require('./tm');
var tr = require('./tr');

var security = require('./security');
var db_sql = require('./sql_action');
var cnt_man = require('./cnt_man');

var _this = this;

global.ty_list = ['1', '2', '3', '4', '5', '9', '10', '13', '14', '16', '17', '23', '24', '27', '28', '29', '30', '38', '39', '91', '92', '93', '94', '95', '96', '97', '98'];

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
update_np_attr_list.ts = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'cni', 'cbs', 'mdlt', 'mdc'];
update_np_attr_list.mms = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'sid', 'soid'];
update_np_attr_list.tm = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'tltm', 'text', 'tct', 'tept', 'tmd', 'tltp', 'rqps', 'rsps'];
update_np_attr_list.tr = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'daci', 'tid', 'tst', 'tltm', 'text', 'tct', 'tltp', 'trqp', 'trsp'];

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
update_m_attr_list.ts = [];
update_m_attr_list.mms = [];
update_m_attr_list.tm = [];
update_m_attr_list.tr = [];

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
update_opt_attr_list.ts = ['acpi', 'et', 'lbl', 'aa', 'at', 'mni', 'mbs', 'mia', 'pei', 'mdd', 'mdn', 'mdt', 'or'];
update_opt_attr_list.mms = ['acpi', 'et', 'lbl', 'aa', 'at', 'stid', 'asd', 'osd', 'sst'];
update_opt_attr_list.tm = ['acpi', 'et', 'lbl', 'daci', 'tctl', 'tmr', 'tmh'];
update_opt_attr_list.tr = ['acpi', 'et', 'lbl', 'cr', 'tctl'];

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
    var rqi = require('shortid').generate();
    var jsonObj = {};
    jsonObj.ts = {};
    jsonObj.ts.ri = ri;
    var reqBodyString = JSON.stringify(jsonObj);

    var responseBody = '';

    if (use_secure == 'disable') {
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
    var rqi = require('shortid').generate();
    var reqBodyString = '';

    var responseBody = '';

    if (use_secure == 'disable') {
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

function create_action(request, response, callback) {
    var rootnm = request.headers.rootnm;
    var ty = request.ty;
    var resource_Obj = request.resourceObj;
    var body_Obj = {};

    if (ty == '1') {
        db_sql.insert_acp(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        //resource_Obj[rootnm].sri = resource_Obj[rootnm].aei;
        db_sql.insert_ae(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    if(results.message.includes('aei_UNIQUE')) {
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
        db_sql.insert_cnt(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                if(useCert == 'enable') {
                    db_sql.update_parent_st(request.connection, request.targetObject[Object.keys(request.targetObject)[0]], function () {
                    });
                }
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        // 20180322 removed <-- update stateTag for every resources
        var parent_rootnm = Object.keys(request.targetObject)[0];
        resource_Obj[rootnm].st = parseInt(request.targetObject[parent_rootnm].st, 10) + 1;
        request.targetObject[parent_rootnm].st = resource_Obj[rootnm].st;
        // db_sql.update_st(request.connection, request.targetObject[parent_rootnm], function() {
        // });

        db_sql.insert_cin(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                var targetObject = JSON.parse(JSON.stringify(request.targetObject));
                var cs = parseInt(resource_Obj[rootnm].cs);

                db_sql.update_parent_by_insert(request.connection, targetObject[parent_rootnm], cs, function () {
                    //request_update_cnt(JSON.stringify(targetObject), cs);

                    cnt_man.put(request.connection, JSON.stringify(targetObject));
                    targetObject = null;
                });

                results = null;
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        db_sql.insert_grp(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        db_sql.insert_lcp(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
            db_sql.insert_fwr(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
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
            db_sql.insert_bat(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
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
            db_sql.insert_dvi(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
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
            db_sql.insert_dvc(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
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
            db_sql.insert_rbo(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
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
            body_Obj = {};
            body_Obj['dbg'] = "this resource of mgmtObj is not supported";
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else if (ty == '28' || ty == '98' || ty == '97' || ty == '96' || ty == '95' || ty == '94' || ty == '93' || ty == '92' || ty == '91') {
        if (rootnm == 'fcnt' && resource_Obj[rootnm].cnd.includes('org.onem2m.home.device.')) {
            db_sql.insert_fcnt(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (rootnm == 'hd_dooLk' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.doorlock') {
            db_sql.insert_hd_dooLK(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (rootnm == 'hd_bat' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.battery') {
            db_sql.insert_hd_bat(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (rootnm == 'hd_tempe' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.temperature') {
            db_sql.insert_hd_tempe(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (rootnm == 'hd_binSh' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.binarySwitch') {
            db_sql.insert_hd_binSh(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (rootnm == 'hd_fauDn' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.faultDetection') {
            db_sql.insert_hd_fauDn(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (rootnm == 'hd_colSn' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colourSaturation') {
            db_sql.insert_hd_colSn(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (rootnm == 'hd_brigs' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.brightness') {
            db_sql.insert_hd_brigs(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
                        callback('409-5');
                    }
                    else {
                        console.log('[create_action] create resource error ======== ' + results.code);
                        callback('500-4');
                    }
                }
            });
        }
        else if (rootnm == 'hd_color' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colour') {
            db_sql.insert_hd_color(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
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
            callback('409-4');
        }
    }
    else if (ty == '14') {
        db_sql.insert_nod(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        db_sql.insert_csr(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '17') {
        db_sql.insert_req(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        db_sql.insert_sub(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                var parent_rootnm = Object.keys(request.targetObject)[0];
                var parentObj = request.targetObject;
                parentObj[parent_rootnm].subl.push(resource_Obj[rootnm]);

                db_sql.update_lookup(request.connection, parentObj[parent_rootnm], function (err, results) {
                    if(!err) {
                        callback('200');
                    }
                });
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        db_sql.insert_smd(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '29') {
        db_sql.insert_ts(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                });
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '30') {
        db_sql.insert_tsi(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        db_sql.insert_mms(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
                    callback('409-5');
                }
                else {
                    console.log('[create_action] create resource error ======== ' + results.code);
                    callback('500-4');
                }
            }
        });
    }
    else if (ty == '38') { // transactionMgmt resource
        if (resource_Obj[rootnm].tmd == tmd_v.CREATOR_CONTROLLED) { // INITIAL
            resource_Obj[rootnm].tst = tst_v.INITIAL;
            db_sql.insert_tm(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    if (results.code == 'ER_DUP_ENTRY') {
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
            tm.request_lock(resource_Obj, 0, function(rsc, resource_Obj, rsps) {
                if(rsc != '1') {
                    callback('400-37');
                    return;
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

                db_sql.insert_tm(request.connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        if (results.code == 'ER_DUP_ENTRY') {
                            callback('409-5');
                        }
                        else {
                            console.log('[create_action] create resource error ======== ' + results.code);
                            callback('500-4');
                        }
                    }
                });
            });
        }
    }
    else if (ty == '39') { // transaction resource
        db_sql.insert_tr(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                if (results.code == 'ER_DUP_ENTRY') {
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
        callback('409-3');
        return;
    }

    resource_Obj[rootnm].rn = request.ty + '-' + moment().utc().format('YYYYMMDDHHmmssSSS');
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
    resource_Obj[rootnm].ct = moment().utc().format('YYYYMMDDTHHmmss');
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;
    resource_Obj[rootnm].st = 0;
    resource_Obj[rootnm].et = moment().utc().add(2, 'years').format('YYYYMMDDTHHmmss');
    if (request.ty == '17') {
        resource_Obj[rootnm].et = moment().utc().add(1, 'days').format('YYYYMMDDTHHmmss');
    }

    if (request.ty == '3' || request.ty == '29') {
        resource_Obj[rootnm].mni = '3153600000';
    }

    if (request.ty == '4') {
        resource_Obj[rootnm].cs = '0';
        resource_Obj[rootnm].cnf = '';
    }

    if (ty_list.includes(request.ty.toString())) {
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
    resource_Obj[rootnm].subl = (body_Obj[rootnm].subl) ? body_Obj[rootnm].subl : [];

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
        case '17':
            req.build_req(request, response, resource_Obj, body_Obj, function (code) {
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
        case '29':
            ts.build_ts(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '30':
            tsi.build_tsi(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '38':
            tm.build_tm(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        case '39':
            tr.build_tr(request, response, resource_Obj, body_Obj, function (code) {
                callback(code);
            });
            break;
        default: {
            callback('409-4');
            return;
        }
    }
}

exports.create = function (request, response, callback) {
    var rootnm = request.headers.rootnm;
    build_resource(request, response, function (code) {
        if(code === '200') {
            var resource_Obj = request.resourceObj;

            resource_Obj[rootnm].spi = request.targetObject[Object.keys(request.targetObject)[0]].sri;
            resource_Obj[rootnm].sri = request.ty + '-' + moment().utc().format('YYYYMMDDHHmmssSSS') + (Math.random() * 999).toFixed(0).padStart(3, '0');

            if(resource_Obj[rootnm].ty == 2) {
                resource_Obj[rootnm].sri = resource_Obj[rootnm].aei;
            }

            if (request.query.tctl == 3) { // for EXECUTE of transaction
                _this.remove_no_value(request, request.resourceObj);

                callback('201');
                return;
            }

            create_action(request, response, function (code) {
                if(code === '200') {
                    _this.remove_no_value(request, request.resourceObj);

                    sgn.check(request, request.resourceObj[rootnm], 3, function (code) {

                    });

                    if (request.query.rt == 3) {
                        response.header('Content-Location', request.resourceObj[rootnm].ri.replace('/', ''));
                    }

                    if (rootnm == 'smd') {
                        smd.request_post(request.url, JSON.stringify(request.resourceObj));
                    }

                    if (Object.keys(request.resourceObj)[0] == 'req') {
                        request.headers.tg = request.resourceObj[rootnm].ri.replace('/', '');
                        request.headers.rootnm = 'uri';
                        var resource_Obj = {};
                        resource_Obj.uri = {};
                        resource_Obj.uri = request.resourceObj[rootnm].ri.replace('/', '');
                        request.resourceObj = resource_Obj;

                        if (request.headers.hasOwnProperty('x-m2m-rtu')) {
                            callback('202-2');
                        }
                        else {
                            callback('202-1');
                        }
                    }
                    else {
                        if (useCert == 'enable') {
                            if (request.ty == 23) { // when ty is 23, send notification for verification
                                var notiObj = JSON.parse(JSON.stringify(request.resourceObj));
                                _this.remove_no_value(request, notiObj);
                                sgn.check(request, notiObj[rootnm], 256, function (code) {

                                });

                                var count = 1000000000;
                                while (count--) {
                                }
                            }
                        }

                        if (request.query.rcn == 2) { // hierarchical address
                            request.headers.rootnm = 'uri';
                            resource_Obj = {};
                            resource_Obj.uri = {};
                            resource_Obj.uri = request.resourceObj[rootnm].ri;
                            resource_Obj.uri = resource_Obj.uri.replace('/', ''); // make cse relative uri
                            request.resourceObj = resource_Obj;

                            callback('201');
                        }
                        else if (request.query.rcn == 3) { // hierarchical address and attributes
                            request.headers.rootnm = rootnm;
                            request.resourceObj.rce = {};
                            request.resourceObj.rce.uri = request.resourceObj[rootnm].ri;
                            request.resourceObj.rce.uri = request.resourceObj.rce.uri.replace('/', ''); // make cse relative uri
                            request.resourceObj.rce[rootnm] = request.resourceObj[rootnm];
                            delete request.resourceObj[rootnm];

                            callback('201-3');
                        }
                        else {
                            callback('201');
                        }
                    }
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

function presearch_action(request, response, pi_list, found_parent_list, callback) {
    var resource_Obj = request.resourceObj;
    var rootnm = Object.keys(resource_Obj)[0];

    console.time('search_parents_lookup ' + resource_Obj[rootnm].ri);
    var cur_found_parent_list = [];
    db_sql.search_parents_lookup(request.connection, pi_list, cur_found_parent_list, found_parent_list, function (code) {
        console.timeEnd('search_parents_lookup ' + resource_Obj[rootnm].ri);
        if(code === '200') {
            request.query.cni = '0';
            if (request.query.ty == '2') {
                request.query.lvl = '1';
            }

            if (request.query.la != null) {
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

            // remove pi be parent resource
            if (request.query.ty == '4') {
                for (var i = 0; i < found_parent_list.length; i) {
                    if (found_parent_list[i].ty != '3') {
                        found_parent_list.splice(i, 1);
                    }
                    else {
                        i++;
                    }
                }
            }
            else if (request.query.ty == '2') {
                for (i = 0; i < found_parent_list.length; i) {
                    if (found_parent_list[i].ty != '5') {
                        found_parent_list.splice(i, 1);
                    }
                    else {
                        i++;
                    }
                }
            }
            else if (request.query.ty == '3') {
                for (i = 0; i < found_parent_list.length; i) {
                    if (found_parent_list[i].ty != '2' && found_parent_list[i].ty != '3' && found_parent_list[i].ty != '5') {
                        found_parent_list.splice(i, 1);
                    }
                    else {
                        i++;
                    }
                }
            }
            else if (request.query.ty == '1') {
                for (i = 0; i < found_parent_list.length; i) {
                    if (found_parent_list[i].ty != '2' && found_parent_list[i].ty != '3' && found_parent_list[i].ty != '5' && found_parent_list[i].ty != '29') {
                        found_parent_list.splice(i, 1);
                    }
                    else {
                        i++;
                    }
                }
            }
            else if (request.query.ty == '29') {
                for (i = 0; i < found_parent_list.length; i) {
                    if (found_parent_list[i].ty != '2' && found_parent_list[i].ty != '29' && found_parent_list[i].ty != '5') {
                        found_parent_list.splice(i, 1);
                    }
                    else {
                        i++;
                    }
                }
            }
            else if (request.query.ty == '30') {
                for (i = 0; i < found_parent_list.length; i) {
                    if (found_parent_list[i].ty != '29') {
                        found_parent_list.splice(i, 1);
                    }
                    else {
                        i++;
                    }
                }
            }

            callback(code);
        }
        else {
            callback(code);
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

    db_sql.select_in_ri_list(request.connection, responder.typeRsrc[tbl], ri_list, 0, finding_Obj, 0, function (err, search_Obj) {
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

exports.retrieve = function (request, response, callback) {
    request.resourceObj = JSON.parse(JSON.stringify(request.targetObject));
    var rootnm = Object.keys(request.targetObject)[0];

    var ty = request.resourceObj[rootnm].ty;
    var resource_Obj = request.resourceObj;

    if (request.query.fu == 2 && request.query.rcn == 1) {
        _this.set_rootnm(request, ty);
        _this.remove_no_value(request, request.resourceObj);

        callback('200');
    }
    else if (request.query.fu == 1 && (request.query.smf)) {
        smd.request_get_discovery(request, response, function (code) {
            callback(code);
        });
    }
    else {
        request.headers.rootnm = 'agr';


        var found_parent_list = [];
        var ri_list = [];
        var pi_list = [];
        pi_list.push(resource_Obj[rootnm].ri);
        var foundObj = {};

        presearch_action(request, response, pi_list, found_parent_list, function (code) {
            if (code == '200') {
                pi_list = [];
                pi_list.push(resource_Obj[rootnm].ri);
                var cur_lvl = parseInt((url.parse(request.url).pathname.split('/').length), 10) - 2;
                for (i = 0; i < found_parent_list.length; i++) {
                    if (request.query.lvl != null) {
                        var lvl = request.query.lvl;
                        if ((found_parent_list[i].ri.split('/').length - 1) <= (cur_lvl + (parseInt(lvl, 10)))) {
                            pi_list.push(found_parent_list[i].ri);
                        }
                    }
                    else {
                        pi_list.push(found_parent_list[i].ri);
                    }
                }

                var cur_d = moment().add(1, 'd').utc().format('YYYY-MM-DD HH:mm:ss');
                db_sql.search_lookup(request.connection, resource_Obj[rootnm].ri, request.query, request.query.lim, pi_list, 0, foundObj, 0, request.query.cni, cur_d, 0, function (code) {
                    if (code === '200') {
                        db_sql.select_spec_ri(request.connection, foundObj, 0, function (code) {
                            if(code === '200') {
                                if (Object.keys(foundObj).length >= 1) {
                                    if (Object.keys(foundObj).length >= max_lim) {
                                        response.header('X-M2M-CTS', 1);

                                        if (request.query.ofst != null) {
                                            response.header('X-M2M-CTO', parseInt(request.query.ofst, 10) + Object.keys(foundObj).length);
                                        }
                                        else {
                                            response.header('X-M2M-CTO', Object.keys(foundObj).length);
                                        }
                                    }

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

                                    callback('200-1');
                                }
                                else if (request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6) {
                                    request.headers.rootnm = 'rsp';
                                    request.resourceObj = JSON.parse(JSON.stringify(foundObj));
                                    _this.remove_no_value(request, request.resourceObj);

                                    callback('200-1');
                                }
                                else {
                                    callback('400');
                                }
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

function update_action(request, response, callback) {
    var rootnm = request.headers.rootnm;
    var resource_Obj = request.resourceObj;
    var ty = request.ty;
    var body_Obj = {};

    if (ty == '1') {
        db_sql.update_acp(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                callback('500-1');
            }
        });
    }
    else if (ty == '2') {
        db_sql.update_ae(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                callback('500-1');
            }
        });
    }
    else if (ty == '3') {
        db_sql.get_cni_count(request.connection, resource_Obj[rootnm], function (cni, cbs, st) {
            resource_Obj[rootnm].cni = cni;
            resource_Obj[rootnm].cbs = cbs;
            resource_Obj[rootnm].st = st + 1;
            db_sql.update_cnt(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        });
    }
    else if (ty == '9') {
        db_sql.update_grp(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
    }
    else if (ty == '10') {
        db_sql.update_lcp(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
    }
    else if (ty == '13') {
        if (responder.mgoType[resource_Obj[rootnm].mgd] == rootnm) {
            if (resource_Obj[rootnm].mgd == 1001) {
                db_sql.update_fwr(request.connection, resource_Obj[rootnm], function (err, results) {
                        if (!err) {
                            callback('200');
                        }
                        else {
                            callback('500-1');
                        }
                    });
            }
            else if (resource_Obj[rootnm].mgd == 1006) {
                db_sql.update_bat(request.connection, resource_Obj[rootnm], function (err, results) {
                        if (!err) {
                            callback('200');
                        }
                        else {
                            callback('500-1');
                        }
                    });
            }
            else if (resource_Obj[rootnm].mgd == 1007) {
                db_sql.update_dvi(request.connection, resource_Obj[rootnm], function (err, results) {
                        if (!err) {
                            callback('200');
                        }
                        else {
                            callback('500-1');
                        }
                    });
            }
            else if (resource_Obj[rootnm].mgd == 1008) {
                db_sql.update_dvc(request.connection, resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
                    JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].ri,
                    resource_Obj[rootnm].dc, resource_Obj[rootnm].can, resource_Obj[rootnm].att, JSON.stringify(resource_Obj[rootnm].cas), resource_Obj[rootnm].cus,
                    resource_Obj[rootnm].ena, resource_Obj[rootnm].dis, function (err, results) {
                        if (!err) {
                            callback('200');
                        }
                        else {
                            callback('500-1');
                        }
                    });
            }
            else if (resource_Obj[rootnm].mgd == 1009) {
                db_sql.update_rbo(request.connection, resource_Obj[rootnm], function (err, results) {
                        if (!err) {
                            callback('200');
                        }
                        else {
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
        if (resource_Obj[rootnm].cnd.includes('org.onem2m.home.device.')) {
            db_sql.update_fcnt(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.doorlock') {
            db_sql.update_hd_dooLk(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.battery') {
            db_sql.update_hd_bat(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.temperature') {
            db_sql.update_hd_tempe(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.binarySwitch') {
            db_sql.update_hd_binSh(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.faultDetection') {
            db_sql.update_hd_fauDn(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colourSaturation') {
            db_sql.update_hd_colSn(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colour') {
            db_sql.update_hd_color(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.brightness') {
            db_sql.update_hd_brigs(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else {
            callback('400-53');
        }
    }
    else if (ty == '14') {
        db_sql.update_nod(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
    }
    else if (ty == '16') {
        db_sql.update_csr(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
    }
    else if (ty == '23') {
        db_sql.update_sub(request.connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                db_sql.select_lookup(request.connection, resource_Obj[rootnm].pi, function (err, results_comm) {
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
                        db_sql.update_lookup(request.connection, parentObj, function (err, results) {
                            if (!err) {
                                callback('200');
                            }
                        });
                    }
                });
            }
            else {
                callback('500-1');
            }
        });
    }
    else if (ty == '24') {
        db_sql.update_smd(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
    }
    else if (ty == '29') {
        db_sql.update_ts(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    check_TS(resource_Obj[rootnm].ri, function (rsc, res_Obj) {
                    });
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
    }
    else if (ty == '27') {
        db_sql.update_mms(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
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

                db_sql.update_tm(request.connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        callback('500-1');
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

                db_sql.update_tm(request.connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        callback('500-1');
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

                db_sql.update_tm(request.connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        callback('500-1');
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

                db_sql.update_tm(request.connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        callback('500-1');
                    }
                });
            });
        }
        else if ((resource_Obj[rootnm].tctl == tctl_v.INITIAL) && (resource_Obj[rootnm].tst == tst_v.ERROR || resource_Obj[rootnm].tst == tst_v.COMMITTED || resource_Obj[rootnm].tst == tst_v.ABORTED)) { // INITIAL
            resource_Obj[rootnm].tst = tst_v.INITIAL;
            resource_Obj[rootnm].rsps = [];

            db_sql.update_tm(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else {
            callback('400-50');
        }
    }
    else if (ty == '39') { // transaction
        if (resource_Obj[rootnm].tctl == tctl_v.LOCK && (resource_Obj[rootnm].tst == tst_v.ABORTED || resource_Obj[rootnm].tst == tst_v.COMMITTED)) { // LOCK
            resource_Obj[rootnm].tst = tst_v.LOCKED;
            resource_Obj[rootnm].trsp = '';
            db_sql.update_tr(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else if (resource_Obj[rootnm].tctl == tctl_v.EXECUTE && (resource_Obj[rootnm].tst == tst_v.LOCKED)) { // EXCUTE
            tr.request_execute(resource_Obj, function(rsc, resource_Obj) {
                db_sql.update_tr(request.connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        callback('500-1');
                    }
                });
            });
        }
        else if (resource_Obj[rootnm].tctl == tctl_v.COMMIT && (resource_Obj[rootnm].tst == tst_v.EXECUTED)) { // COMMIT
            tr.request_commit(resource_Obj, function (rsc, resource_Obj) {
                db_sql.update_tr(request.connection, resource_Obj[rootnm], function (err, results) {
                    if (!err) {
                        callback('200');
                    }
                    else {
                        callback('500-1');
                    }
                });
            });
        }
        else if (resource_Obj[rootnm].tctl == tctl_v.ABORT && (resource_Obj[rootnm].tst == tst_v.LOCKED || resource_Obj[rootnm].tst == tst_v.EXECUTED)) { // ABORT
            resource_Obj[rootnm].tst = tst_v.ABORTED;
            db_sql.update_tr(request.connection, resource_Obj[rootnm], function (err, results) {
                if (!err) {
                    callback('200');
                }
                else {
                    callback('500-1');
                }
            });
        }
        else {
            callback('400-50');
        }
    }
    else {
        callback('400-52');
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

function check_acp_update_acpi(request, response, acpi, cr, callback) {
    // when update acpi check pvs of acp
    if (acpi.length > 0) {
        security.check(request, response, '1', acpi, '4', cr, function (code) {
            callback(code);
        });
    }
    else {
        callback('1');
    }
}

function update_resource(request, response, callback) {
    var rootnm = request.headers.rootnm;
    var body_Obj = request.bodyObj;
    var resource_Obj = {};
    resource_Obj[rootnm] = request.targetObject[Object.keys(request.targetObject)[0]];

    if (ty_list.includes(request.ty.toString())) {
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

        if(body_Obj[rootnm].hasOwnProperty('acpi')) {
            var updateAcpiList = resource_Obj[rootnm].acpi;
        }
        else {
            updateAcpiList = [];
        }
        check_acp_update_acpi(request, response, updateAcpiList, resource_Obj[rootnm].cr, function (code) {
            if (code === '1') {
                update_body(rootnm, body_Obj, resource_Obj); // (attr == 'aa' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' || attr == 'nu' || attr == 'mid' || attr == 'macp')

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
    else {
        callback('405-5');
    }
}

exports.update = function (request, response, callback) {
    var rootnm = request.headers.rootnm;
    var updateObj = request.targetObject;
    var ty = updateObj[Object.keys(updateObj)[0]].ty;

    if(ty == 2) {
        updateObj[rootnm].cr = updateObj[rootnm].aei;
    }
    else if (ty == 16) {
        updateObj[rootnm].cr = updateObj[rootnm].cb;
    }

    update_resource(request, response, function (code) {
        if(code === '200') {
            if (useCert == 'enable') {
                if (ty == 23) { // when ty is 23, send notification for verification
                    var notiObj = JSON.parse(JSON.stringify(request.resourceObj));
                    _this.remove_no_value(request, notiObj);
                    sgn.check(request, notiObj[rootnm], 256, function (code) {

                    });

                    var count = 1000000000;
                    while (count--) {
                    }
                }
            }

            update_action(request, response, function (code) {
                if (code == '200') {
                    _this.remove_no_value(request, request.resourceObj);

                    sgn.check(request, request.resourceObj[rootnm], 1, function (code) {

                    });

                    callback('200');
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

/* 20180322 removed <-- update stateTag for every resources

*/
function update_cnt_by_delete(connection, pi, cs, callback) {
    db_sql.select_resource_from_url(connection, pi, pi, function (err, results) {
        if (err) {
            callback(null, 500);
            return '0';
        }
        else {
            if (results.length == 0) {
                callback(null, 404);
                return '0';
            }

            var targetObject = {};
            var ty = results[0].ty;
            targetObject[responder.typeRsrc[ty]] = results[0];
            var rootnm = Object.keys(targetObject)[0];
            makeObject(targetObject[rootnm]);

            db_sql.update_parent_by_delete(connection, targetObject[rootnm], cs, function (err, results) {
            });
        }
    });
}

function delete_action(request, response, callback) {
    var resource_Obj = request.resourceObj;
    var rootnm = Object.keys(request.resourceObj)[0];

    var pi_list = [];
    var result_ri = [];
    pi_list.push(resource_Obj[rootnm].ri);
    console.time('search_parents_lookup ' + resource_Obj[rootnm].ri);
    var cur_result_ri = [];
    db_sql.search_parents_lookup(request.connection, pi_list, cur_result_ri, result_ri, function (code) {
        console.timeEnd('search_parents_lookup ' + resource_Obj[rootnm].ri);
        if(code === '200') {
            for (var i = 0; i < result_ri.length; i++) {
                pi_list.push(result_ri[i].ri);
            }
            result_ri = null;

            pi_list.reverse();
            var finding_Obj = [];
            console.time('delete_lookup ' + resource_Obj[rootnm].ri);
            db_sql.delete_lookup(request.connection, pi_list, 0, finding_Obj, 0, function (code) {
                if (code === '200') {
                    db_sql.delete_ri_lookup(request.connection, resource_Obj[rootnm].ri, function (err) {
                        if(!err) {
                            console.timeEnd('delete_lookup ' + resource_Obj[rootnm].ri);

                            // for sgn
                            db_sql.select_lookup(request.connection, resource_Obj[rootnm].pi, function (err, results) {
                                if (!err) {
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

                                        var parentObj = request.targetObject[parent_rootnm];
                                        for(var idx in parentObj.subl) {
                                            if(parentObj.subl.hasOwnProperty(idx)) {
                                                if(parentObj.subl[idx].ri == resource_Obj[rootnm].ri) {
                                                    parentObj.subl.splice(idx, 1);
                                                }
                                            }
                                        }

                                        db_sql.update_lookup(request.connection, parentObj, function (err, results) {
                                        });

                                        callback('200');
                                    }
                                    else if (resource_Obj[rootnm].ty == '29') {
                                        delete_TS(function (rsc, res_Obj) {
                                        });
                                        callback('200');
                                    }
                                    else if (resource_Obj[rootnm].ty == '4') {
                                        update_cnt_by_delete(request.connection, resource_Obj[rootnm].pi, function (rsc) {
                                        });
                                        callback('200');
                                    }
                                    else {
                                        callback('200');
                                    }
                                }
                                else {
                                    callback('500-1');
                                }
                            });
                        }
                        else {
                            console.timeEnd('delete_lookup ' + resource_Obj[rootnm].ri);
                            callback('500-1');
                        }
                    });
                }
                else {
                    console.timeEnd('delete_lookup ' + resource_Obj[rootnm].ri);
                    callback(code);
                }
            });
        }
        else {
            callback(code);
        }
    });
}

exports.delete = function (request, response, callback) {
    var ty = request.ty;

    _this.set_rootnm(request, ty);

    request.resourceObj = JSON.parse(JSON.stringify(request.targetObject));
    var rootnm = Object.keys(request.resourceObj)[0];

    delete_action(request, response, function (code) {
        if (code === '200') {
            _this.remove_no_value(request, request.resourceObj);

            sgn.check(request, request.resourceObj[rootnm], 4, function (code) {

            });

            if(useCert == 'enable') {
                if (request.resourceObj[rootnm].ty == 4) {
                    db_sql.update_parent_by_delete(request.connection, request.targetObject[Object.keys(request.targetObject)[0]], parseInt(request.resourceObj[rootnm].cs, 10), function () {
                    });
                }
                else {
                    db_sql.update_parent_st(request.connection, request.targetObject[Object.keys(request.targetObject)[0]], function () {
                    });
                }
                callback('200');
            }
            else {
                callback('200');
            }
        }
        else {
            callback(code);
        }
    });
};


function request_update_cnt(bodyString, cs) {
    var options = {
        hostname: 'localhost',
        port: use_cnt_man_port,
        path: '/cnt',
        method: 'PUT',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': bodyString.length,
            'cs': cs
        }
    };

    var bodyStr = '';
    if (use_secure == 'disable') {
        var req = http.request(options, function (res) {
            res.setEncoding('utf8');

            res.on('data', function (chunk) {
                bodyStr += chunk;
            });

            res.on('end', function () {
                if(res.statusCode == 200 || res.statusCode == 201) {
                    console.log('-------> [response_update_cnt] - ' + bodyStr);
                }
            });
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');

        req = https.request(options, function (res) {
            res.setEncoding('utf8');

            res.on('data', function (chunk) {
                bodyStr += chunk;
            });

            res.on('end', function () {
                if(res.statusCode == 200 || res.statusCode == 201) {
                    console.log('-------> [response_update_cnt] - ' + bodyStr);
                }
            });
        });
    }

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            //console.log('--xxx--> [request_noti - problem with request: ' + e.message + ']');
            console.log('--xxx--> [request_update_cnt]');
        }
    });

    req.on('close', function () {
        //console.log('--xxx--> [request_noti - close: no response for notification');
    });

    console.log('<------- [request_update_cnt]');
    req.write(bodyString);
    req.end();
}
