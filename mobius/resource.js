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
var url = require('url');
var http = require('http');
var https = require('https');
var moment = require('moment');
var fs = require('fs');

var sgn = require('./sgn');
var subl_entry = require('./subl');
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
// req(ty=17) 는 논블로킹 요청의 임시 기록이었다. 논블로킹을 지원하지 않게
// 되면서 이 리소스를 만드는 경로가 사라져 핸들러째 걷어냈다.
var nod = require('./nod');
var mgo = require('./mgo');
var fcnt = require('./fcnt');

var security = require('./security');
var acp_observe = require('./acp_observe');
var acp_filter = require('./acp_filter');
// DB 파사드. 예전에는 db_action.js 라는 껍데기를 한 겹 거쳤다.
var db = require('./db');
// db_facade 라는 두 번째 이름이 있었다. 이제 같은 것이라 합쳤다.
var db_facade = db;
var db_sql = require('./sql_action');
var db_errors = require('./db/errors');
var defaults = require('./defaults');
var rid = require('./rid');

var _this = this;

// search_action 이 이 목록을 돌며 타입별 테이블을 조회한다. 여기에 있으면
// discovery 때마다 그 테이블을 한 번씩 읽는다.
//
// '17'(req)을 뺐다 — 논블로킹을 지원하지 않게 되면서 이 리소스를 만드는
// 경로가 없어졌으므로, 매 discovery 마다 req 테이블을 읽을 이유가 없다.
// 기존 배포에 남아 있는 행은 migrations/003-drop-req-table.js 가 걷어낸다.
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
// req(17)의 속성표는 걷어냈다. 논블로킹을 지원하지 않게 되면서 이 리소스를
// 만드는 경로가 없고(ty_list / typeRsrc 에서 빠졌다), app.js 가 ty=17 요청을
// 405-2 로 막는다. 테이블도 migrations/003 이 지웠다.
// 표만 남겨 두면 "만들 수 있는 타입" 으로 읽힌다.

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
// cr 이 옵션 목록에 있었다. update_body 는 본문 속성을 전부 그대로 옮기므로
// PUT {"m2m:tr":{"cr":"남"}} 하나로 소유권이 넘어갔다 — creator_bypasses 가
// 들어온 뒤로는 그것이 곧 권한 탈취다. 다른 타입은 전부 np 목록에 있다.

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
            // 문자열이 아니면 건드리지 않는다. 예전에는 .split 이 TypeError 를
            // 던졌는데, 호출부가 전부 DB 콜백 안이거나 security.check 안이라
            // 잡을 곳이 없어 **워커가 죽었다.** 그룹의 macp 에 숫자를 하나
            // 넣고 그 fanOutPoint 를 치면 재현된다(app.js 의 그룹 권한 검사가
            // macp 를 그대로 여기로 넘긴다).
            //
            // 값을 그대로 두면 뒤의 whereIn 에서 아무것과도 안 맞아 "그런 ACP 가
            // 없다" 로 처리된다 — 잘못된 값을 통과시키는 것이 아니다.
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

// 지원하지 않는 타입은 여기서 막아야 한다. create_action 아래의 insert_* 는
// 내부에서 insert_lookup 을 먼저 실행하므로, 그대로 흘려보내면 lookup 행만 남고
// 본문 insert 가 실패해 고아 행이 생긴다. 그 고아 행은 이후 discovery 를 깨뜨린다.
//
// **목록은 어댑터가 갖는다.** 예전에는 여기 SQLITE_SUPPORTED_TY 라는 이름으로
// 있었다 — 코어에, 한 백엔드 이름을 달고. 그래서 다른 백엔드가 다른 부분집합을
// 지원하려면 이 파일을 고쳐야 했고, 그것은 "어댑터 파일 하나로 붙는다" 가
// 깨지는 자리였다.
function check_db_support(ty) {
    // 제한이 없는 백엔드(MySQL)는 null 을 준다 — 그냥 통과한다.
    // 이 게이트는 501 을 내보내므로 반드시 fail-open 이어야 한다.
    // supportedResourceTypes() 는 던지지 않는 계약이다(db/index.js).
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
        // 백엔드 이름을 적지 않는다 — 여기 'the sqlite backend' 라고 적혀 있었다.
        // 아래 create 의 같은 게이트(1065행 근처)는 'this backend' 라고 적어서
        // 두 로그가 서로 달랐다. 어느 쪽이든 이 게이트는 어댑터가 지원 목록을
        // 선언했을 때 걸리는 것이지 SQLite 라서 걸리는 것이 아니다.
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
        //resource_Obj[rootnm].sri = resource_Obj[rootnm].aei;
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

                // 자식이 생겼으니 부모 stateTag 를 올린다.
                // 이 호출은 원래 useCert=='enable' 뒤에 있어 한 번도 실행되지 않았다
                // (mobius.js 가 'disable' 로 하드코딩). 플래그를 걷어내며 되살렸다.
                db_sql.update_parent_st(request.db_connection,
                    request.targetObject[cnt_parent_rootnm], function () {
                    });

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
    else if (ty == '4') {
        // 20180322 removed <-- update stateTag for every resources
        var parent_rootnm = Object.keys(request.targetObject)[0];
        resource_Obj[rootnm].st = parseInt(request.targetObject[parent_rootnm].st, 10) + 1;
        request.targetObject[parent_rootnm].st = resource_Obj[rootnm].st;

        db_sql.insert_cin(request.db_connection, resource_Obj[rootnm], (err, results) => {
            if (!err) {
                var cs = parseInt(resource_Obj[rootnm].cs, 10);
                var parent_ri = request.targetObject[parent_rootnm].ri;

                // 부모 카운터를 그 자리에서 올린다. 문장 두 개, 둘 다 PK 인덱스다.
                //
                // 예전에는 cnt_man 이 pi 별 델타를 메모리에 모아 1초 debounce 로
                // flush 했다. 배포 실측이 그 전제를 무너뜨렸다 — 전체 요청이
                // 초당 3.6건이고 컨테이너가 30,284개라 묶을 것이 없었다. 대신
                // 델타가 인메모리라 재시작하면 최대 11초분이 사라졌다.
                //
                // 한도 정리는 여기서 하지 않는다. 마스터의 purge 스윕이 맡는다
                // (app.js). 정리 주체가 하나여야 delete_oldest 가 잠금 없이
                // 단순해지고, 그래야 백엔드를 가를 이유가 사라진다.
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
            body_Obj = {};
            body_Obj['dbg'] = "this resource of mgmtObj is not supported";
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else if (ty == '28' || ty == '98' || ty == '97' || ty == '96' || ty == '95' || ty == '94' || ty == '93' || ty == '92' || ty == '91') {
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
        else if (rootnm == 'hd_dooLk' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.doorlock') {
            db_sql.insert_hd_dooLK(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (rootnm == 'hd_bat' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.battery') {
            db_sql.insert_hd_bat(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (rootnm == 'hd_tempe' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.temperature') {
            db_sql.insert_hd_tempe(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (rootnm == 'hd_binSh' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.binarySwitch') {
            db_sql.insert_hd_binSh(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (rootnm == 'hd_fauDn' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.faultDetection') {
            db_sql.insert_hd_fauDn(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (rootnm == 'hd_colSn' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colourSaturation') {
            db_sql.insert_hd_colSn(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (rootnm == 'hd_brigs' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.brightness') {
            db_sql.insert_hd_brigs(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (rootnm == 'hd_color' && resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colour') {
            db_sql.insert_hd_color(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
            callback('409-4');
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
                var parent_rootnm = Object.keys(request.targetObject)[0];
                var parentObj = request.targetObject[parent_rootnm];

                // 목록을 여기서 만들지 않는다. update_subl 이 부모 행을 잠그고
                // **그 안에서 읽은** 배열에 이 함수를 적용한다.
                //
                // 예전에는 request.targetObject 의 부모 사본에 push 했다. 그
                // 사본은 요청이 시작될 때 읽은 것이라, 그 사이 같은 부모에
                // 다른 구독이 생기면 절대값 UPDATE 가 그것을 지웠다.
                // 수정·삭제는 그 자리에서 부모를 다시 읽는데 생성만 안 읽었다.
                var entry = subl_entry.pack(resource_Obj[rootnm]);
                db_sql.update_subl(request.db_connection, parentObj.ri, function (list) {
                    return subl_entry.upsert(list, entry);
                }, (err, results) => {
                    // else 가 없었다. 부모 갱신이 실패하면 콜백이 사라져
                    // 응답도 connection.release() 도 없이 요청이 매달렸다.
                    // 데드락, 락 타임아웃, 커넥션 끊김, SQLITE_BUSY 에서 실제로 난다.
                    //
                    // sub 행은 이미 들어갔으므로 200 이 완전히 틀린 것은 아니지만,
                    // 부모의 subl 이 갱신되지 않아 알림이 안 나간다. 실패를 알린다.
                    if(!err) {
                        callback('200');
                    }
                    else {
                        console.error('[create_action] sub 의 부모 subl 갱신 실패: ' +
                                      ((results && (results.driverCode || results.code)) || '?') +
                                      ' 부모=' + parentObj.ri + ' sub=' + resource_Obj[rootnm].ri);
                        callback('500-1');
                    }
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
        callback('409-3');
        return;
    }

    // 타임스탬프만으로 만들면 같은 밀리초에 들어온 두 건이 같은 rn 을 갖고,
    // rn 은 그대로 ri(PK)가 되므로 뒤엣것이 409 로 실패한다.
    // 실측: CIN 40건 동시 POST 중 23건 유실. mobius/rid.js 주석 참고.
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
    resource_Obj[rootnm].ct = moment().utc().format('YYYYMMDDTHHmmss');
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;
    resource_Obj[rootnm].st = 0;
    // et 를 명시하지 않으면 사실상 만료하지 않는다 (mobius/defaults.js 주석 참조).
    resource_Obj[rootnm].et = defaults.DEFAULT_ET;
    if (request.ty == '3') {
        resource_Obj[rootnm].mni = '3153600000';
    }

    if (request.ty == '4') {
        resource_Obj[rootnm].cs = '0';
        resource_Obj[rootnm].cnf = '';
    }

    if (ty_list.includes(request.ty.toString())) {
        // ty_list 에는 있는데 속성표에는 없는 타입이 있다 — cb(5)와 mgo(13)다.
        // 그대로 두면 create_np_attr_list[rootnm] 이 undefined 이고
        // .includes 가 TypeError 를 낸다. 여기는 db.getConnection 콜백 안이라
        // uncaughtException 핸들러도 없어 워커가 죽고 빌린 커넥션도 새어 나간다.
        //
        // 실측: POST /Mobius/<nod> 에 {"m2m:mgo":{...}} 하나로 워커가 죽었다.
        // mgo 는 추상 타입이라 표가 없는 것이 맞다 — 구체 타입(fwr/bat/dvi/dvc/rbo)
        // 에는 표가 있다. 즉 이것은 '표를 채워야 할 누락' 이 아니라
        // '도달하면 안 되는 조합' 이므로 거절이 옳다.
        if (!create_np_attr_list.hasOwnProperty(rootnm)) {
            console.log('[build_resource] 속성표가 없는 리소스 이름이다: ' + rootnm + ' (ty=' + request.ty + ')');
            callback('409-4');
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
            callback('409-4');
            return;
        }
    }
}

exports.create = function (request, response, callback) {
    var rootnm = request.headers.rootnm;

    // **게이트는 여기다.** create_action 에도 같은 검사가 있지만 그것만으로는
    // 늦다 — build_resource 아래의 타입별 빌더가 먼저 DB 를 친다.
    //
    // 실측(등가성 하네스, SQLite): grp(9) 생성이 501 이 아니라 500 "database
    // error" 로 나갔다. build_grp -> update_route -> select_csr_like 가
    // `select * from csr` 를 쏘는데 mobiusdb_sqlite.sql 에는 csr 테이블이 없다.
    // 그 실패는 로그도 안 남기고 500-1 로 뭉개져서, 클라이언트는 "이 백엔드가
    // 이 타입을 안 받는다" 대신 "DB 가 고장났다" 를 듣는다.
    //
    // 예전에는 안 보였다. db_action.getResult 가 usesqlite 와 무관하게 항상
    // MySQL 로 나갔기 때문이다(241f553 에서 파사드로 옮기며 사라진 동작).
    // 즉 SQLite 모드에서 grp 를 만들면 조용히 MySQL 의 csr 을 읽고 있었다.
    if (!check_db_support(request.ty)) {
        console.log('[create] ty=' + request.ty + ' is not supported by this backend');
        callback('501-2');
        return;
    }

    // acpi 를 실제로 보낸 요청에만 붙는다. 안 보내면 질의가 한 번도 안 나간다
    // (배포 34,313 비-CIN 행 중 acpi 가 채워진 것은 2건이다).
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
        // 정규화한 값으로 갈아끼운다. build_resource 가 이 값을 그대로 쓴다.
        body.acpi = normalized;
        build_and_create();
    });

    function build_and_create() {
    build_resource(request, response, function (code) {
        if(code === '200') {
            var resource_Obj = request.resourceObj;

            resource_Obj[rootnm].spi = request.targetObject[Object.keys(request.targetObject)[0]].sri;
            resource_Obj[rootnm].sri = request.ty + '-' + moment().utc().format('YYYYMMDDHHmmssSSS') + (Math.random() * 999).toFixed(0).padStart(3, '0');

            if(resource_Obj[rootnm].ty == 2) {
                resource_Obj[rootnm].sri = resource_Obj[rootnm].aei;
            }

            create_action(request, response, (code) => {
                if(code === '200') {
                    var made = request.resourceObj[rootnm];
                    // 커넥션이 살아 있는 동안 남긴다 — 응답 뒤에는 반납된다.
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

                    // 여기서 시맨틱 브로커로 POST 하던 것을 걷어냈다 (2026-08-31).
                    // 사용자가 브로커를 쓰지 않기로 했다. semanticDescriptor(ty=24)
                    // 리소스 자체는 그대로 만들어지고 저장된다 — 이 호출은
                    // fire-and-forget 이라 응답 코드에 영향을 준 적도 없다.

                    // req(ty=17) 를 만들었을 때 202 를 돌려주던 분기는 걷어냈다.
                    // 논블로킹을 지원하지 않게 되면서 req 를 만드는 경로가 없고,
                    // '202-1'/'202-2' 를 받아 응답하는 곳도 없다.
                    {
                        if (request.query.rcn == 2) { // hierarchical address
                            request.headers.rootnm = 'uri';
                            var resource_Obj = {};
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
            });
        }
        else {
            callback(code);
        }
    });
    }
};

// discovery 요청 파라미터를 정규화한다.
//
// 예전에는 여기서 트리 전체의 부모 목록을 레벨별로 긁어 왔다
// (search_parents_lookup). 이제 search_lookup 이 재귀 CTE 한 문장으로
// 자손을 직접 뽑으므로 그 사전 탐색이 필요 없다 — 배포 서버에서 이 단계만
// 25회 왕복 / 626ms 였고, 레벨당 2,000개 상한 때문에 큰 트리에서는 결과가
// 조용히 잘리기까지 했다.
//
// 남은 일은 뒤 단계가 의존하는 질의 파라미터 보정뿐이라 DB 를 건드리지 않는다.
function presearch_action(request, response, pi_list, found_parent_list, callback) {
    var resource_Obj = request.resourceObj;
    var rootnm = Object.keys(resource_Obj)[0];

    request.query.cni = '0';

    // ty=2(AE)는 CSE 바로 아래에만 있다. 더 내려갈 이유가 없다.
    if (request.query.ty == '2') {
        request.query.lvl = '1';
    }

    // la 는 "이 컨테이너의 최신 CIN N건" 이다.
    //
    // **컨테이너에만 적용되고, 대상은 그 컨테이너의 직속 CIN 이다.**
    // 그래서 여기서 ty=4 와 lvl=1 을 못박는다. 그러면 질의가 "부모 하나 +
    // ty 고정" 이 되어 인덱스가 정렬을 그대로 준다 — 배포 실측으로
    // MySQL 이 Backward index scan 을 골라 0.00초다.
    //
    // 안 박으면 골격 전체를 훑고 **타입 무관하게** 최신 N 건을 고른다.
    // 실제 결함이 둘이었다(배포 실측 2026-09-01):
    //   - 컨테이너 2,806개에 걸친 전역 정렬이 되어 filesort -> 30초 상한 500
    //   - CIN 이 아닌 리소스(구독 등)도 결과에 섞였다
    // 여러 부모에 걸친 ORDER BY 는 인덱스로 못 푼다(MySQL/SQLite 동일).
    //
    // 컨테이너가 아닌 대상에 la 를 걸면 ty=4 + lvl=1 이 자연히 0건을 준다.
    // "la 는 컨테이너에만 적용된다" 가 그대로 성립하므로 따로 분기하지 않는다.
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

    if (seq == 0) {
        console.time('search_resource');
    }

    if (request.query.ty != null) {
        tbl = request.query.ty;
        seq = ty_list.length;
    }

    db_sql.select_in_ri_list(request.db_connection, responder.typeRsrc[tbl], ri_list, 0, finding_Obj, 0, function (err, search_Obj) {
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
                        if((obj[attr] == null) || (obj[attr] == '')) {
                            obj[attr] = '[]';
                        }
                    }

                    if (attr == 'aa' || attr == 'at' || attr == 'lbl' || attr == 'srt' || attr == 'nu' || attr == 'acpi' || attr == 'poa' || attr == 'enc'
                        || attr == 'bn' || attr == 'pv' || attr == 'pvs' || attr == 'mid' || attr == 'uds' || attr == 'cas' || attr == 'macp'
                        || attr == 'rels' || attr == 'srv' || attr == 'mi' || attr == 'subl') {
                        try {
                            //console.log(attr);
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

        callback('200');
    }
    // 여기 있던 smf(시맨틱 필터) 분기를 걷어냈다 (2026-08-31).
    //
    // 외부 시맨틱 브로커에 물어보는 경로였는데, 사용자가 그 브로커를 쓰지
    // 않기로 했다. 주소가 mobius.js 에 사설 IP 로 박혀 있었고 배포에서
    // 닿지도 않았다 — 이 분기로 들어오면 아웃바운드 타임아웃(기본 10초)을
    // 다 쓰고 404-2 가 나갔다.
    //
    // 이제 ?smf= 가 와도 그 파라미터를 무시하고 **일반 discovery 로 떨어진다.**
    // 400 을 주지 않는 이유: smf 는 oneM2M 표준 파라미터이고, 우리가 그
    // 기능을 제공하지 않는 것이지 요청이 잘못된 것이 아니다. 거절하면
    // 지금까지 10초 뒤 404 를 받던 클라이언트가 즉시 400 을 받게 되는데,
    // 어느 쪽도 원하는 답이 아니라면 결과를 주는 쪽이 낫다.
    else {
        request.headers.rootnm = 'agr';


        var found_parent_list = [];
        var ri_list = [];
        // 부모 목록을 미리 모으지 않는다 — search_lookup 이 재귀 CTE 로
        // 루트 아래를 직접 훑는다. lvl 도 그 안에서 처리된다.
        var pi_list = [resource_Obj[rootnm].ri];
        var foundObj = {};

        presearch_action(request, response, pi_list, found_parent_list, function (code) {
            if (code == '200') {
                var cur_d = moment().add(1, 'd').utc().format('YYYY-MM-DD HH:mm:ss');
                db_sql.search_lookup(request.db_connection, resource_Obj[rootnm].ri, request.query, request.query.lim, pi_list, 0, foundObj, 0, request.query.cni, cur_d, 0, function (code, search_info) {
                    if (code === '200') {
                        db_sql.select_spec_ri(request.db_connection, foundObj, 0, function (code) {
                            if(code !== '200') { return callback(code); }
                            // 탐색은 요청 대상 하나만 검사하고 결과를 그대로 냈다.
                            // 그래서 AE 아래 컨테이너 하나만 잠가도 그 경로가
                            // 상위 탐색 결과에 나왔다 — 내용은 안 새고 이름·구조·
                            // 개수·생성 시각이 샜다. select_spec_ri 뒤라 cr 이
                            // 이미 붙어 있어 생성자 우회도 질의 없이 적용된다.
                            acp_filter.filter_found(request.db_connection, request,
                                resource_Obj[rootnm].ri, foundObj, function (ferr, fstat) {
                            if (ferr) {
                                console.error('[discovery] ACP 필터 실패 — 결과를 내보내지 않는다: ' +
                                    ((fstat && (fstat.sqlMessage || fstat.message)) || fstat));
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
                                // 결과가 잘렸으면 알린다 (oneM2M: CTS=1 은 부분 결과,
                                // CTO 는 이어받을 오프셋).
                                //
                                // 판정은 **SQL 이 건 한도를 정확히 채웠는가** 다.
                                // 예전에는 세 가지가 틀렸다:
                                //   1. 상수 max_lim(2000)과 비교해서 lim<2000 요청은
                                //      결과가 잘려도 아무 신호를 못 받았다
                                //   2. la 요청의 실효 한도는 query.la 인데 그걸 안 봤다
                                //   3. select_spec_ri 가 고아 행을 걷어낸 **뒤**의 건수를
                                //      썼다. DB 는 그만큼을 이미 건너뛰었으므로 다음
                                //      오프셋이 모자라 클라이언트가 앞을 다시 읽는다
                                // search_lookup 이 SQL 에 실제로 건 한도와 돌려준 행 수를
                                // 그대로 넘겨주므로 판정이 SQL 과 어긋날 수 없다.
                                if (search_info && search_info.limit > 0 &&
                                    search_info.rows >= search_info.limit) {
                                    response.header('X-M2M-CTS', 1);
                                    response.header('X-M2M-CTO',
                                        search_info.offset + search_info.rows);
                                }

                                // lbl 로 찾으면서 ty 를 안 주면 CIN 을 뺀다.
                                // like 는 인덱스를 못 타서 안 빼면 후보가
                                // 1억4,560만 행이 되고 30초 상한에 걸린다.
                                //
                                // **조용히 좁히지 않는다.** CIN 의 레이블은
                                // 실제로 쓰이므로, 안 찾아본 것과 없는 것을
                                // 구별할 수 있어야 한다. 찾으려면 ty=4 를 주고
                                // 대상을 좁힌다.
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
                db_sql.update_dvc(request.db_connection, resource_Obj[rootnm].lt, JSON.stringify(resource_Obj[rootnm].acpi), resource_Obj[rootnm].et, resource_Obj[rootnm].st, JSON.stringify(resource_Obj[rootnm].lbl),
                    JSON.stringify(resource_Obj[rootnm].at), JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].ri,
                    resource_Obj[rootnm].dc, resource_Obj[rootnm].can, resource_Obj[rootnm].att, JSON.stringify(resource_Obj[rootnm].cas), resource_Obj[rootnm].cus,
                    resource_Obj[rootnm].ena, resource_Obj[rootnm].dis, function (err, results) {
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
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.doorlock') {
            db_sql.update_hd_dooLk(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.battery') {
            db_sql.update_hd_bat(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.temperature') {
            db_sql.update_hd_tempe(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.binarySwitch') {
            db_sql.update_hd_binSh(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.faultDetection') {
            db_sql.update_hd_fauDn(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colourSaturation') {
            db_sql.update_hd_colSn(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colour') {
            db_sql.update_hd_color(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        else if (resource_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.brightness') {
            db_sql.update_hd_brigs(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
                db_sql.select_lookup(request.db_connection, resource_Obj[rootnm].pi, function (err, results_comm) {
                    // 이 두 콜백에 else 가 없었다. 부모를 못 읽거나 갱신하지
                    // 못하면 update_action 의 콜백이 사라져, 응답도
                    // connection.release() 도 없이 PUT 요청이 매달렸다.
                    if (err) {
                        console.log('[update_action] sub 의 부모 조회 실패: ' +
                                    ((results_comm && (results_comm.driverCode || results_comm.code)) || '?'));
                        callback('500-1');
                        return;
                    }

                    // 부모를 잃은 sub 를 수정하면 results_comm 이 빈 배열이라
                    // results_comm[0] 이 undefined 가 되고, 다음 줄의
                    // parentObj.subl 에서 워커가 죽었다.
                    if (results_comm.length === 0) {
                        console.log('[update_action] sub 의 부모 lookup 행이 없다: ' + resource_Obj[rootnm].pi);
                        callback('404-1');
                        return;
                    }

                    makeObject(results_comm[0]);
                    var parentObj = results_comm[0];

                    // 첫 항목만 갈아 끼우고 break 하던 자리다. 같은 ri 가 두 개면
                    // 뒤엣것은 옛 nu 를 그대로 들고 계속 발송했다 — 배포에서
                    // "subl 과 sub 의 nu 가 다른" 194건이 이것이다.
                    // upsert 는 첫 자리에 새 것을 놓고 나머지 같은 ri 를 버린다.
                    var entry = subl_entry.pack(resource_Obj[rootnm]);
                    db_sql.update_subl(request.db_connection, parentObj.ri, function (list) {
                        return subl_entry.upsert(list, entry);
                    }, function (err, results) {
                        if (!err) {
                            callback('200');
                        }
                        else {
                            console.error('[update_action] sub 의 부모 subl 갱신 실패: ' +
                                          ((results && (results.driverCode || results.code)) || '?') +
                                          ' 부모=' + parentObj.ri + ' sub=' + resource_Obj[rootnm].ri);
                            callback('500-1');
                        }
                    });
                });
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

// acpi 직렬화 길이 한도. lookup.acpi 가 varchar(200) 이다.
// ri 가 22자면 7개(176자)까지 들어가고 8개는 201자라 넘친다.
var ACPI_MAX_JSON = 200;

/**
 * acpi 를 검증하고 내부 ri 표기로 정규화한다.
 *
 * 지금까지 acpi 는 존재·타입·개수 무엇도 검사하지 않고 클라이언트 원문 그대로
 * 저장됐다. 그 결과가 셋이다.
 *
 *   - 없는 ACP 를 가리켜도 200 이다. 그러면 잠금이 "생성자만 통과" 로 조용히
 *     풀리는데 아무 로그도 없다. 배포의 /Mobius/sch8 이 그 상태다.
 *   - 8개째부터 varchar(200) 을 넘겨 400 이 아니라 **HTTP 500** 이 난다.
 *     500 은 서버 오류라 운영자가 원인을 못 찾는다.
 *   - 숫자를 넣으면 make_internal_ri 의 .split 이 TypeError 를 던져 워커가 죽는다.
 *   - 절대/SP상대/CSE상대 세 표기가 그대로 저장돼 역참조 조회가 조용히 어긋난다.
 *
 * **새로 쓰는 값만 본다.** 이미 저장된 acpi 는 건드리지 않는다.
 *
 * @param opts.maxJson  직렬화 길이 한도. 기본은 lookup.acpi 의 varchar(200).
 *                      grp.macp 는 mediumtext 라 더 넉넉하다.
 * @param callback callback(null, normalized) 통과 / callback(code) 거부
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

    // **원소 수를 먼저 막는다.** get_ri_list_sri 는 원소마다 질의를 한 번씩
    // 내므로, 개수를 안 보면 클라이언트가 배열 하나로 질의 수천 건을 만든다.
    // 길이 검사는 sri 해석이 끝난 뒤에야 할 수 있어서(짧은 sri 가 긴 ri 로
    // 풀린다) 그 전에 값싼 상한을 하나 둔다.
    //
    // 한도는 직렬화 한도에서 나온다 — 원소 하나가 최소 세 글자("x",)라고 보면
    // maxJson 을 넘길 수 없는 개수의 상한이 이만큼이다. 정상 사용(ACP 7개,
    // 그룹 macp 도 한 자리)에는 걸리지 않는다.
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

        // 중복은 거부하지 않고 조용히 없앤다 — mid 의 remove_duplicated_mid 와 같은 취급.
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
                // 어느 것이 없는지는 응답에 못 담는다(msg 가 정적이다). 로그에 남긴다.
                console.log('[acp] reject 400-63 — 없는 ACP 를 가리킨다: ' + missing.join(', '));
                callback('400-63');
                return;
            }

            callback(null, normalized);
        });
    });
};

/**
 * acpi 를 바꿀 권한이 있는가.
 *
 * @param acpi     **지금 걸려 있는** acpi. 새로 걸 것이 아니다.
 * @param newAcpi  새로 걸 acpi (관측용). 없으면 관측만 건너뛴다.
 */
function check_acp_update_acpi(request, response, acpi, cr, newAcpi, callback) {
    if (typeof newAcpi === 'function') { callback = newAcpi; newAcpi = undefined; }

    // 이미 ACP 가 걸려 있으면 그 ACP 의 pvs 가 정한다. oneM2M 의 selfPrivileges 다.
    if (acpi.length > 0) {
        security.check(request, response, '1', acpi, '4', cr, function (code) {
            callback(code);
        });
        return;
    }

    // 여기가 문제의 자리다. **지금은 인증된 아무나** ACP 가 안 걸린 남의
    // 리소스에 자기 ACP 를 붙여 잠글 수 있다(실측: HTTP 200, 그 뒤 생성자
    // 조회가 403). 붙이는 순간 잠기고, 그 사실이 아무 데도 안 남는다.
    //
    // 그렇다고 지금 바로 막으면 acpi 를 붙이던 정상 요청이 거부되기 시작한다.
    // 스위치와 관측을 먼저 넣고, 켜는 것은 로그를 본 뒤에 정한다.
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
        // build_resource 와 같은 이유의 방어다. UPDATE 쪽이 더 넓다 —
        // CREATE 는 부모-자식 검증이 cb 를 먼저 막아 주지만 UPDATE 에는
        // 그런 관문이 없다.
        //
        // 실측: PUT /Mobius/<아무 리소스> 에 {"m2m:cb":{"lbl":["x"]}} 하나로
        // 워커가 죽었다. 본문을 {"m2m:cb":{"acpi":[...]}} 로 하면
        // updates_beyond_acpi 가 ACP 검사까지 건너뛰므로 인증만 되면 누구나 할 수 있었다.
        if (!update_np_attr_list.hasOwnProperty(rootnm)) {
            console.log('[update_resource] 속성표가 없는 리소스 이름이다: ' + rootnm + ' (ty=' + request.ty + ')');
            callback('409-4');
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
                        // pv/pvs 는 acp 의 **옵션** 속성이라 아래 mandatory 분기의
                        // pvs 검사에 영영 닿지 않았다(update_m_attr_list.acp 가 []).
                        // 그래서 pvs 를 {} 로 바꾸는 UPDATE 가 그대로 통과했고,
                        // acp 테이블에 cr 컬럼이 없어 그 순간 수퍼유저 말고는
                        // 아무도 그 ACP 를 못 고치게 됐다.
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

        // macp 도 같은 길로 권한 검사에 들어간다(app.js 의 그룹 팬아웃이
        // security.check 에 macp 를 그대로 넘긴다). 검증을 안 하면 원소에
        // 숫자 하나로 워커가 죽는다.
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

        // **지금 걸려 있는** acpi 로 권한을 본다. 새로 걸 ACP 가 아니다 —
        // 새 값으로 보면 "내가 만든 ACP 를 붙이겠다" 가 언제나 통과한다.
        // resource_Obj 는 아직 DB 에서 읽은 그대로다(update_body 는 뒤에 돈다).
        var existingAcpi = resource_Obj[rootnm].acpi;

        // acpi 만 바꾸는 PUT 도 여기를 지난다 — app.js 가 건너뛰는 것은
        // authorize_and_run(대상 리소스 권한)이지 update_resource 가 아니다.
        validate_acpi(request, response, body_Obj[rootnm].acpi, function (code, normalized) {
            if (code) {
                callback(code);
                return;
            }
            // update_body 가 body 값을 그대로 옮기므로 여기만 갈아끼우면 된다.
            body_Obj[rootnm].acpi = normalized;
            run_acp_check(existingAcpi, normalized);
        });

        function run_acp_check(updateAcpiList, newAcpi) {
        check_acp_update_acpi(request, response, updateAcpiList, resource_Obj[rootnm].cr, newAcpi, function (code) {
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
        }
    }
    else {
        callback('405-5');
    }
}

// acpi / pv / pvs 가 실제로 바뀐 경우에만 이력을 남긴다.
//
// **setImmediate 로 미루지 않는다.** 미루면 그 사이 응답이 나가고
// request.db_connection 이 풀에 반납된다. 반납된 핸들로 질의하면 그 커넥션을
// 이미 빌려 간 **다른 요청의 트랜잭션 안으로** INSERT 가 섞여 들어가고,
// 그쪽이 롤백하면 이력이 조용히 사라진다. 최악은 남의 트랜잭션을 방해하는 것이다.
//
// 대신 값이 실제로 바뀐 경우에만 부른다. 배포에서 acpi 를 바꾸는 요청은
// 사실상 없으므로(채워진 행 2개) 일상 트래픽에 INSERT 가 늘지 않는다.
// insert_acp_audit 은 best-effort 라 실패해도 요청을 실패시키지 않는다 —
// 감사 때문에 운영이 멈추면 감사부터 꺼진다.
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

    // rootnm 은 **본문**의 루트 이름이고 updateObj 는 **대상 행**의 타입으로
    // 키가 잡힌 객체다. 둘이 어긋나면 updateObj[rootnm] 이 undefined 다.
    //
    // app.js 의 check_type_update_resource 관문은 이것을 못 잡는다. 거기서
    // 대조하는 request.ty 는 방금 그 본문에서 뽑은 값이라 본문끼리 비교하는
    // 항등식이기 때문이다. 그래서 대상이 AE 인데 {"m2m:cnt":{...}} 를 PUT 하면
    // 바로 아래 updateObj['cnt'].aei 에서 워커가 죽었다 — 요청 한 줄로
    // 재현되고, 본문이 acpi 만 건드리면 ACP 검사도 건너뛴다.
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

    // update_resource 가 resourceObj 를 새로 만들기 전에 옛 값을 붙잡는다.
    var before_acpi = acpi_of(updateObj[rootnm]);
    var before_pv = updateObj[rootnm].pv;
    var before_pvs = updateObj[rootnm].pvs;

    update_resource(request, response, function (code) {
        if(code === '200') {
            update_action(request, response, function (code) {
                if (code == '200') {
                    var now = request.resourceObj[rootnm];
                    // 커넥션이 살아 있는 동안 남긴다 — 응답 뒤에는 반납된다.
                    record_acp_change(request, 'acpi_set', before_acpi, acpi_of(now),
                        now.ri, ty, now.cr, function () {
                    record_acp_change(request, 'acp_update',
                        ty == 1 ? { pv: before_pv, pvs: before_pvs } : null,
                        ty == 1 ? { pv: now.pv, pvs: now.pvs } : null,
                        now.ri, ty, now.cr, function () {

                    _this.remove_no_value(request, request.resourceObj);

                    sgn.check(request, request.resourceObj[rootnm], 1, function (code) {

                    });

                    callback('200');
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

// update_cnt_by_delete 는 여기 있었다. pi 로 부모를 조회한 뒤
// update_parent_by_delete 를 부르는 래퍼였는데, 삭제 경로가 바로 위 select_lookup
// 으로 이미 부모를 들고 있어서 같은 행을 두 번 읽고 있었다. 호출부에서 직접
// update_parent_by_delete 를 부르도록 바꾸고 제거했다.

// 리프 타입(하위 리소스를 가질 수 없는 ty)은 background subtree 삭제가 필요 없다.
// 자식을 가질 수 없는 타입. 여기에 없으면 삭제 시 자식 탐색을 예약한다.
var leaf_ty_list = ['1', '4', '9', '23'];

// R4 방식 비동기 subtree 삭제: 응답은 루트 행 삭제 직후 나가고,
// 자손은 별도 커넥션으로 백그라운드 삭제한다. 도중에 프로세스가 죽어
// 고아 행이 남으면 delete_orphan_lookup(기동 시/일 1회)이 정리한다.
function delete_descendants_background(root_ri, attempt) {
    attempt = attempt || 1;

    // 커넥션은 파사드가 준다. 예전에는 SQLite 면 run(null) 로 갔는데, 그것은
    // 커넥션 원천이 MySQL 풀로 고정되어 있어 SQLite 모드가 그 풀을 안 건드리게
    // 하려던 우회였다. 원천이 파사드로 옮겨졌으니 그 우회가 필요 없다.
    {
        db.getConnection(function (code, connection) {
            if (code === '200') {
                run(connection);
            }
            else {
                // 커넥션을 못 빌렸다. 예전에는 5초마다 무한히 다시 시도했고
                // 로그가 없어, 풀이 고갈된 동안 이 재시도가 몇 개나 돌고 있는지
                // 알 수 없었다. 횟수를 세어 남기고, 일정 횟수 뒤에는 포기한다 —
                // 포기해도 고아 정리로 치울 수 있고, 영원히 도는 것보다 낫다.
                if (attempt >= 12) {          // 5초 x 12 = 1분
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
        console.time('delete_descendants ' + root_ri);
        db_sql.search_parents_lookup_all(connection, pi_list, [], result_ri, function (code) {
            if (code !== '200') {
                // 자손 목록을 못 만들었다. 루트는 이미 지워졌으므로 그 아래가
                // 통째로 고아가 된다. 예전에는 조용히 return 했다.
                console.error('[delete_descendants] ' + root_ri +
                              ' 의 자손 목록을 만들지 못했다 (code=' + code +
                              '). 자손이 통째로 고아로 남는다.');
                console.timeEnd('delete_descendants ' + root_ri);
                if (connection) db.release(connection);
                return;
            }
            for (var i = 0; i < result_ri.length; i++) {
                pi_list.push(result_ri[i].ri);
            }
            pi_list.reverse();
            db_sql.delete_lookup(connection, pi_list, 0, [], 0, function (code) {
                // 예전에는 이 code 를 아예 보지 않았다. 삭제가 중간에 멈춰도
                // 흔적이 없어서, 고아가 왜 생기는지 물어도 답할 근거가 없었다.
                //
                // 원인 후보는 여럿이다 — 워커 16개가 겹치는 서브트리를 동시에
                // 지울 때의 InnoDB 데드락, 대형 서브트리의 60초 쿼리 타임아웃,
                // 커넥션 끊김. 어느 것인지는 로그를 봐야 안다.
                if (code !== '200') {
                    console.error('[delete_descendants] ' + root_ri +
                                  ' subtree 삭제가 끝나지 못했다 (code=' + code +
                                  ', 대상 ' + pi_list.length + '개). 남은 것은 고아가 된다.');
                }
                console.timeEnd('delete_descendants ' + root_ri);
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
                                        // 부모 행이 이미 없음(고아 리소스 삭제 또는 동시 subtree 삭제 경쟁).
                                        // 리소스 자체는 지워졌으므로 부모 갱신만 생략하고 성공 처리.
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

                                        var parentObj = request.targetObject[parent_rootnm];
                                        var gone_ri = resource_Obj[rootnm].ri;

                                        // for-in 으로 돌면서 splice 하던 자리다. 뒤 원소가 앞으로
                                        // 당겨지며 건너뛰어, 같은 ri 가 두 개면 하나만 지워졌다 —
                                        // 배포의 "중복 1,481묶음" 이 지워지지 않고 남는 이유다.
                                        // without 은 같은 ri 를 전부 뺀다.
                                        //
                                        // **이 갱신을 기다린 뒤에 응답한다.** update_subl 은 MySQL 에서
                                        // 트랜잭션을 연다. 예전처럼 던져 놓고 곧바로 응답하면, 응답에서
                                        // connection.release() 까지가 한 tick 안에서 끝나므로 커넥션이
                                        // **열린 트랜잭션째** 풀로 돌아간다. 다음 요청이 남의 트랜잭션
                                        // 안에서 돌게 되고, 하필 delete_oldest 의 SELECT ... FOR UPDATE 와
                                        // 겹치면 반쪽 상태가 커밋된다. 크래시가 아니라 조용한 뒤섞임이라
                                        // 로그에 아무것도 안 남는다(mobius/db/index.js 의 같은 주석 참고).
                                        db_sql.update_subl(request.db_connection, parentObj.ri, function (list) {
                                            return subl_entry.without(list, gone_ri);
                                        }, function (err, results) {
                                            // 콜백이 비어 있었다. 여기가 실패하면 sub 행은 이미
                                            // FK CASCADE 로 사라졌는데 목록에는 항목이 남아
                                            // **영구히 알림을 계속 보내는 유령**이 된다.
                                            //
                                            // 응답은 200 이 맞다 — 리소스는 지워졌다. 대신 무엇이
                                            // 남았는지 반드시 남긴다. 그래야 감사가 그 부모를 짚는다.
                                            if (err) {
                                                console.error('[delete_action] sub 의 부모 subl 갱신 실패 — ' +
                                                    '유령이 남는다: ' +
                                                    ((results && (results.driverCode || results.code)) || '?') +
                                                    ' 부모=' + parentObj.ri + ' sub=' + gone_ri);
                                            }

                                            // update_lookup 은 st 를 obj.st 그대로 다시 쓴다(대입).
                                            // 자식이 지워졌으니 부모 stateTag 는 올라가야 한다.
                                            db_sql.update_parent_st(request.db_connection,
                                                request.targetObject[parent_rootnm], function () {
                                                });

                                            callback('200');
                                        });
                                    }
                                    else if (resource_Obj[rootnm].ty == '4') {
                                        // 부모는 위 select_lookup 으로 이미 조회했다.
                                        // 예전에는 update_cnt_by_delete 가 pi 로 한 번 더 찾았다 —
                                        // 같은 행을 두 번 읽던 것이라 직접 부른다.
                                        //
                                        // cs(지워진 CIN 의 contentSize)를 빠뜨리면 부모 cbs 가
                                        // 엉뚱한 값으로 줄거나 쿼리가 통째로 실패한다.
                                        db_sql.update_parent_by_delete(request.db_connection,
                                            request.targetObject[parent_rootnm],
                                            parseInt(resource_Obj[rootnm].cs, 10) || 0,
                                            function () {
                                            });

                                        callback('200');
                                    }
                                    else {
                                        // CIN 외의 자식이 지워져도 부모 stateTag 는 올라가야 한다.
                                        db_sql.update_parent_st(request.db_connection,
                                            request.targetObject[parent_rootnm], function () {
                                            });

                                        callback('200');
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

    // DELETE 에는 본문이 없어 request.ty 가 null 이다(app.js check_xm2m_headers).
    // 지우는 대상 자신의 ty 를 쓴다 — retrieve 와 같은 방식이다.
    //
    // 예전에는 request.ty 를 넘겼는데 그 값이 기본값 '99' 였고 typeRsrc['99']
    // 가 'rsp' 라 headers.rootnm 이 늘 'rsp' 였다. 실측으로 확인한 결과 두 가지:
    //
    //  1) remove_no_value 가 resource_Obj['rsp'] 를 도느라 한 바퀴도 안 돌았다.
    //     그래서 숫자→문자열 변환이 빠졌고, 뒤이은 typeCheckforJson 이 0 을
    //     "값 없음" 으로 보고 지웠다 — cnt 를 지우면 응답에서 st/cni/cbs 가
    //     통째로 빠졌다(GET 응답에는 있다).
    //  2) sgn.check 가 headers.rootnm 을 그대로 쓰므로(mobius/sgn.js:553, 473)
    //     삭제 알림이 표준에 없는 nev.rep['m2m:rsp'] 를 실어 날랐다.
    var ty = request.resourceObj[rootnm].ty;

    _this.set_rootnm(request, ty);

    delete_action(request, response, function (code) {
        if (code === '200') {
            var gone = request.resourceObj[rootnm];
            var gone_ty = ty;   // 위에서 대상 행에서 읽은 값이다
            // ACP 를 지우면 그것을 참조하던 리소스는 "생성자만 통과" 로 조용히
            // 풀린다. 무엇이 사라졌는지 남겨야 되돌릴 수 있다.
            // 커넥션이 살아 있는 동안 남긴다 — 응답 뒤에는 반납된다.
            record_acp_change(request, 'acp_delete',
                gone_ty == '1' ? { pv: gone.pv, pvs: gone.pvs } : null, null,
                gone.ri, gone_ty, gone.cr, function () {

            _this.remove_no_value(request, request.resourceObj);

            sgn.check(request, request.resourceObj[rootnm], 4, function (code) {

            });

            // useCert 플래그 제거(2026-08-27). 여기 있던 부모 갱신 호출은 인증서
            // 모드에서만 돌았으므로 실측상 한 번도 실행되지 않았고, 실행됐다면
            // 깨졌을 코드다 — targetObject 는 삭제 대상 자신이지 부모가 아니라서
            // ty=4 이면 `update cin set cni = ...` 이 되고 cin 에는 그 컬럼이 없다.
            //
            // 그래서 지금 CIN 을 지워도 부모 cnt 의 cni/cbs 가 줄지 않는다.
            // 올바른 복원 방안은
            // docs/superpowers/specs/2026-08-27-counter-maintenance-review.md 참조.
            callback('200');
            });
        }
        else {
            callback(code);
        }
    });
};


// request_update_cnt 는 여기 있었다. use_cnt_man_port 로 자기 자신에게 HTTP PUT /cnt
// 을 보내 부모 카운터를 갱신하던 옛 구조의 흔적으로, 호출부가 하나도 없었다.
// 지금은 cnt_man 이 같은 프로세스 안에서 배치로 처리한다.
