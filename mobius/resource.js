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
var acp = require('./acp');
var grp = require('./grp');

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
create_np_attr_list.grp = ['ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cnm', 'mtv', 'ssi'];

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
create_m_attr_list.grp = ['mnm', 'mid'];

create_m_attr_list.fwr = ['mgd', 'vr', 'fwnnam', 'url', 'ud'];
create_m_attr_list.bat = ['mgd', 'btl', 'bts'];
create_m_attr_list.dvi = ['mgd', 'dlb', 'man', 'mod', 'dty', 'fwv', 'swv', 'hwv'];
create_m_attr_list.dvc = ['mgd', 'can', 'att', 'cas', 'cus'];
create_m_attr_list.rbo = ['mgd'];

global.create_opt_attr_list = {};
create_opt_attr_list.acp = ['rn', 'et', 'lbl', 'aa', 'at'];
create_opt_attr_list.csr = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cst', 'poa', 'mei', 'tri', 'nl', 'esi', 'srv', 'loc'];
create_opt_attr_list.ae = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'apn', 'poa', 'or', 'nl', 'csz', 'esi', 'srv', 'loc'];
create_opt_attr_list.cnt = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'cr', 'mni', 'mbs', 'mia', 'li', 'or', 'disr', 'loc'];
create_opt_attr_list.cin = ['rn', 'et', 'lbl', 'aa', 'at', 'daci', 'cr', 'cnf', 'conr', 'or'];
create_opt_attr_list.sub = ['rn', 'acpi', 'et', 'lbl', 'daci', 'cr', 'enc', 'exc', 'gpi', 'nfu', 'bn', 'rl', 'psn', 'pn', 'nsp', 'ln', 'nct', 'nec', 'su'];
create_opt_attr_list.grp = ['rn', 'acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mt', 'macp', 'csy', 'gn'];

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
update_np_attr_list.grp = ['rn', 'ty', 'ri', 'pi', 'ct', 'lt', 'st', 'cr', 'mt', 'cnm', 'mtv', 'csy', 'ssi'];

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
update_m_attr_list.grp = [];

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
update_opt_attr_list.grp = ['acpi', 'et', 'lbl', 'aa', 'at', 'daci', 'mnm', 'mid', 'macp', 'gn'];

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

global.make_internal_ri = (resource_Obj) => {
    for (var index in resource_Obj) {
        if (resource_Obj.hasOwnProperty(index)) {
            if (resource_Obj[index].split(usespid + use_cb_id + '/')[0] == '') { // absolute relative
                resource_Obj[index] = resource_Obj[index].replace(usespid + use_cb_id + '/', '/');
            }
            else if (resource_Obj[index].split(use_cb_id + '/' + use_cb_name + '/')[0] == '') { // sp relative
                resource_Obj[index] = resource_Obj[index].replace(use_cb_id + '/', '/');
            }
            else if (resource_Obj[index].split(use_cb_name)[0] == '') { // cse relative
                resource_Obj[index] = '/' + resource_Obj[index];
            }

            resource_Obj[index] = resource_Obj[index].replace(/\//g, '_');
        }
    }
};

const check_result_code_db_action = (rcode, rmessage='') => {
    if (rcode === 'ER_DUP_ENTRY') {
        if (rmessage.includes('aei_UNIQUE')) {
            return ('409-6');
        }
        else {
            return ('409-5');
        }
    }
    else if (rcode === '23505') {
        return ('409-5');
    }
    else {
        console.log('[create_action] create resource error ======== ' + rcode);
        return ('500-4');
    }
}

function create_action(request, response, callback) {
    let rootnm = request.headers.rootnm;
    let ty = request.ty;
    let resource_Obj = request.resourceObj;

    if (ty == '1') {
        db_sql.insert_acp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                callback(check_result_code_db_action(results.code, results.message));
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
                callback(check_result_code_db_action(results.code, results.message));

            }
        });
    }
    else if (ty == '3') {
        db_sql.insert_cnt(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                callback(check_result_code_db_action(results.code, results.message));
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
                var targetObject = JSON.parse(JSON.stringify(request.targetObject));
                var cs = parseInt(resource_Obj[rootnm].cs);

                cache_resource_url[resource_Obj[rootnm].pi.replace(/_/g, '\/') + '/la'] = resource_Obj[rootnm];

                if(cache_resource_url.hasOwnProperty(targetObject[parent_rootnm].ri.replace(/_/g, '\/'))) {
                    delete cache_resource_url[targetObject[parent_rootnm].ri.replace(/_/g, '\/')];
                }

                results = null;
                callback('200');
            }
            else {
                callback(check_result_code_db_action(results.code, results.message));
            }
        });
    }
    else if (ty == '9') {
        db_sql.insert_grp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                callback(check_result_code_db_action(results.code, results.message));
            }
        });
    }
    else if (ty == '16') {
        db_sql.insert_csr(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                callback(check_result_code_db_action(results.code, results.message));
            }
        });
    }
    else if (ty == '17') {
        db_sql.insert_req(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                callback(check_result_code_db_action(results.code, results.message));
            }
        });
    }
    else if (ty == '23') {
        db_sql.insert_sub(request.db_connection, resource_Obj[rootnm], (err, results) => {
            if (!err) {
                var parent_rootnm = Object.keys(request.targetObject)[0];
                var parentObj = request.targetObject;
                parentObj[parent_rootnm].subl.push(resource_Obj[rootnm]);

                if(cache_resource_url.hasOwnProperty(parentObj[parent_rootnm].ri.replace(/_/g, '\/'))) {
                    delete cache_resource_url[parentObj[parent_rootnm].ri.replace(/_/g, '\/')];
                }

                // db_sql.update_lookup(request.db_connection, parentObj[parent_rootnm], (err, results) => {
                //     if(!err) {
                //         callback('200');
                //     }
                // });
                callback('200');
            }
            else {
                callback(check_result_code_db_action(results.code, results.message));
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
    else if (body_Obj[rootnm]['rn'] != null && body_Obj[rootnm]['rn'] != '') {
        resource_Obj[rootnm].rn = body_Obj[rootnm]['rn'];
    }

    if(91 <= parseInt(request.ty, 10) && parseInt(request.ty, 10) <= 98) {
        resource_Obj[rootnm].ty = '28';
    }
    else {
        resource_Obj[rootnm].ty = request.ty;
    }
    resource_Obj[rootnm].pi = url.parse(request.url).pathname.replace(/\//g, '_');
    resource_Obj[rootnm].ri = resource_Obj[rootnm].pi + '_' + resource_Obj[rootnm].rn;
    resource_Obj[rootnm].ct = moment().utc().format('YYYYMMDDTHHmmss');
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;
    resource_Obj[rootnm].st = 0;
    resource_Obj[rootnm].et = moment().utc().add(2, 'years').format('YYYYMMDDTHHmmss');
    resource_Obj[rootnm].cs = '0';

    if (request.ty == '17') {
        resource_Obj[rootnm].et = moment().utc().add(1, 'days').format('YYYYMMDDTHHmmss');
    }

    if (request.ty == '3' || request.ty == '29') {
        resource_Obj[rootnm].mni = '3153600000';
    }

    if (request.ty == '4') {
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
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

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

            if (request.query.tctl == 3) { // for EXECUTE of transaction
                _this.remove_no_value(request, request.resourceObj);

                callback('201');
                return;
            }

            create_action(request, response, (code) => {
                if(code === '200') {
                    _this.remove_no_value(request, request.resourceObj);

                    if(request.ty != 23) {
                        sgn.check(request, request.resourceObj[rootnm], 3);
                    }

                    let parent_rootnm = Object.keys(request.targetObject)[0];
                    cnt_man.update_parent_by_insert(request.targetObject[parent_rootnm], () => {
                    });

                    if (request.query.rt == 3) {
                        response.header('Content-Location', request.resourceObj[rootnm].ri.replace('/', ''));
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
    db_sql.search_parents_lookup(request.db_connection, pi_list, cur_found_parent_list, found_parent_list, (code) => {
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

            // remove pi be parent resource when loc
            if (request.query.hasOwnProperty('gmty') || request.query.hasOwnProperty('gsf') || request.query.hasOwnProperty('geom')) {
                for (i = 0; i < found_parent_list.length; i) {
                    if (found_parent_list[i].ty != '2' && found_parent_list[i].ty != '3' && found_parent_list[i].ty != '5') {
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
                        || attr == 'rels' || attr == 'rqps' || attr == 'rsps' || attr == 'srv' || attr == 'mi' || attr == 'subl') {
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
                for (let i = 0; i < found_parent_list.length; i++) {
                    if (request.query.lvl != null) {
                        var lvl = request.query.lvl;
                        if ((found_parent_list[i].ri.split('_').length - 1) <= (cur_lvl + (parseInt(lvl, 10)))) {
                            pi_list.push(found_parent_list[i].ri);
                        }
                    }
                    else {
                        pi_list.push(found_parent_list[i].ri);
                    }
                }

                var cur_d = moment().add(1, 'd').utc().format('YYYY-MM-DD HH:mm:ss');
                db_sql.search_lookup(request.db_connection, resource_Obj[rootnm].ri, request.query, request.query.lim, pi_list, 0, foundObj, 0, request.query.cni, cur_d, 0, function (code) {
                    if (code === '200') {
                        db_sql.select_spec_ri(request.db_connection, foundObj, 0, function (code) {
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
                                else if (request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 8) {
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
        db_sql.update_acp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
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
                callback('500-1');
            }
        });
    }
    else if (ty == '3') {
        db_sql.update_cnt(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
                callback('500-1');
            }
        });
    }
    else if (ty == '9') {
        db_sql.update_grp(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
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
                callback('500-1');
            }
        });
    }
    else if (ty == '14') {
        db_sql.update_nod(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
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
                callback('500-1');
            }
        });
    }
    else if (ty == '23') {
        db_sql.update_sub(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                db_sql.select_lookup(request.db_connection, resource_Obj[rootnm].pi, function (err, results_comm) {
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
                        // db_sql.update_lookup(request.db_connection, parentObj, function (err, results) {
                        //     if (!err) {
                        //         callback('200');
                        //     }
                        // });
                        callback('200');
                    }
                });
            }
            else {
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
                callback('500-1');
            }
        });
    }
    else if (ty == '29') {
        db_sql.update_ts(request.db_connection, resource_Obj[rootnm], function (err, results) {
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
        db_sql.update_mms(request.db_connection, resource_Obj[rootnm], function (err, results) {
            if (!err) {
                callback('200');
            }
            else {
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
            update_action(request, response, function (code) {
                if (code == '200') {
                    _this.remove_no_value(request, request.resourceObj);

                    sgn.check(request, request.resourceObj[rootnm], 1);

                    cnt_man.update_st_by_action(request.resourceObj[rootnm], () => {

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

function delete_action(request, response, callback) {
    var resource_Obj = request.resourceObj;
    var rootnm = Object.keys(request.resourceObj)[0];

    var pi_list = [];
    var result_ri = [];
    pi_list.push(resource_Obj[rootnm].ri);
    console.time('search_parents_lookup ' + resource_Obj[rootnm].ri);
    var cur_result_ri = [];
    db_sql.search_parents_lookup(request.db_connection, pi_list, cur_result_ri, result_ri, function (code) {
        console.timeEnd('search_parents_lookup ' + resource_Obj[rootnm].ri);
        if(code === '200') {
            for (var i = 0; i < result_ri.length; i++) {
                pi_list.push(result_ri[i].ri);
            }
            result_ri = null;

            pi_list.reverse();
            var finding_Obj = [];
            console.time('delete_lookup ' + resource_Obj[rootnm].ri);
            db_sql.delete_lookup(request.db_connection, pi_list, 0, finding_Obj, 0, function (code) {
                if (code === '200') {
                    db_sql.delete_ri_lookup(request.db_connection, resource_Obj[rootnm].ri, function (err) {
                        if(!err) {
                            console.timeEnd('delete_lookup ' + resource_Obj[rootnm].ri);

                            // for sgn
                            db_sql.select_lookup(request.db_connection, resource_Obj[rootnm].pi, function (err, results) {
                                if (!err) {
                                    var ty = results[0].ty;
                                    request.targetObject = {};
                                    request.targetObject[responder.typeRsrc[ty]] = results[0];
                                    var parent_rootnm = Object.keys(request.targetObject)[0];
                                    makeObject(request.targetObject[parent_rootnm]);

                                    if(cache_resource_url.hasOwnProperty(request.targetObject[parent_rootnm].ri.replace(/_/g, '\/'))) {
                                        delete cache_resource_url[request.targetObject[parent_rootnm].ri.replace(/_/g, '\/')];
                                    }

                                    if (resource_Obj[rootnm].ty == '23') {
                                        if(resource_Obj[rootnm].hasOwnProperty('su')) {
                                            if(resource_Obj[rootnm].su != '') {
                                                var notiObj = JSON.parse(JSON.stringify(resource_Obj[rootnm]));
                                                _this.remove_no_value(request, notiObj);
                                                sgn.check(request, notiObj, 128);
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

                                        // db_sql.update_lookup(request.db_connection, parentObj, function (err, results) {
                                        // });

                                        callback('200');
                                    }
                                    else if (resource_Obj[rootnm].ty == '29') {
                                        delete_TS(function (rsc, res_Obj) {
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

            sgn.check(request, request.resourceObj[rootnm], 4);

            cnt_man.update_parent_by_delete(request.targetObject[Object.keys(request.targetObject)[0]], () => {
            });

            callback('200');
        }
        else {
            callback(code);
        }
    });
};

