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

var util = require('util');
var url = require('url');
var http = require('http');
var https = require('https');
var coap = require('coap');
var js2xmlparser = require('js2xmlparser');
var xmlbuilder = require('xmlbuilder');
var fs = require('fs');
var db_sql = require('./sql_action');
var cbor = require("cbor");
var merge = require('merge');

var responder = require('./responder');

var sgn_man = require('./sgn_man');
const db = require("./db_action");

function make_xml_noti_message(pc, xm2mri, callback) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        //noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
        //noti_message['m2m:rqp'].to = pc['m2m:sgn'].sur;
        noti_message['m2m:rqp'].fr = use_cb_id;
        noti_message['m2m:rqp'].rqi = xm2mri;
        noti_message['m2m:rqp'].pc = pc;

        if(noti_message['m2m:rqp'].pc.hasOwnProperty('m2m:sgn')) {
            if(noti_message['m2m:rqp'].pc['m2m:sgn'].hasOwnProperty('nev')) {
                for(var prop in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep) {
                    if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep.hasOwnProperty(prop)) {
                        for(var prop2 in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop]) {
                            if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop].hasOwnProperty(prop2)) {
                                if(prop2 == 'rn') {
                                    noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop]['@'] = {rn : noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]};
                                    delete noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2];
                                    break;
                                }
                                else {
                                    for (var prop3 in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]) {
                                        if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2].hasOwnProperty(prop3)) {
                                            if (prop3 == 'rn') {
                                                noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]['@'] = {rn: noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2][prop3]};
                                                delete noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2][prop3];
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
        }

        noti_message['m2m:rqp']['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        var xmlString = js2xmlparser.parse("m2m:rqp", noti_message['m2m:rqp']);

        callback(xmlString);
    }
    catch (e) {
        console.log('[make_xml_noti_message] xml parsing error');
        callback(e.message);
        return "";
    }
}

function make_cbor_noti_message(pc, xm2mri) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        //noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
        //noti_message['m2m:rqp'].to = pc['m2m:sgn'].sur;
        noti_message['m2m:rqp'].fr = use_cb_id;
        noti_message['m2m:rqp'].rqi = xm2mri;

        noti_message['m2m:rqp'].pc = pc;

        return cbor.encode(noti_message['m2m:rqp']).toString('hex');
    }
    catch (e) {
        console.log('[make_cbor_noti_message] cbor parsing error');
    }
}

function make_json_noti_message(nu, pc, xm2mri, short_flag) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        noti_message['m2m:rqp'].rqi = xm2mri;

        if(short_flag == 1) {

        }
        else {
            //noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
            noti_message['m2m:rqp'].to = nu;
            noti_message['m2m:rqp'].fr = use_cb_id;
        }

        noti_message['m2m:rqp'].pc = pc;

        var notiString = JSON.stringify(noti_message['m2m:rqp']);
        delete noti_message;
        noti_message = null;
        return notiString;
    }
    catch (e) {
        console.log('[make_json_noti_message] json parsing error');
    }
}

function make_body_string_for_noti(protocol, nu, node, sub_bodytype, xm2mri, short_flag) {
    let bodyString = ''
    if (protocol == 'http:' || protocol == 'https:' || protocol == 'coap:') {
        bodyString = JSON.stringify(node);
    }
    else if (protocol == 'ws:' || protocol == 'mqtt:') {
        bodyString = make_json_noti_message(nu, node, xm2mri, short_flag);
    }
    else {
        bodyString = '';
    }

    return (bodyString);
}

function sgn_action_send(nu_arr, req_count, sub_bodytype, node, short_flag, check_value, ss_cr, ss_ri, xm2mri, exc, parentObj) {
    if(nu_arr.length <= req_count) {
        return;
    }

    var nu = nu_arr[req_count];
    var sub_nu = new URL(nu);

    if (sub_nu.query != null) {
        var sub_nu_query_arr = sub_nu.query.split('&');
        for (var prop in sub_nu_query_arr) {
            if (sub_nu_query_arr.hasOwnProperty(prop)) {
                if (sub_nu_query_arr[prop].split('=')[0] == 'rcn') {
                    if (sub_nu_query_arr[prop].split('=')[1] == '9') {
                        for (var index in node['m2m:sgn'].nev.rep) {
                            if (node['m2m:sgn'].nev.rep.hasOwnProperty(index)) {
                                if (node['m2m:sgn'].nev.rep[index].cr) {
                                    delete node['m2m:sgn'].nev.rep[index].cr;
                                }

                                if (node['m2m:sgn'].nev.rep[index].st) {
                                    delete node['m2m:sgn'].nev.rep[index].st;
                                }

                                delete node['m2m:sgn'].nev.rep[index].ct;
                                delete node['m2m:sgn'].nev.rep[index].lt;
                                delete node['m2m:sgn'].nev.rep[index].et;
                                delete node['m2m:sgn'].nev.rep[index].ri;
                                delete node['m2m:sgn'].nev.rep[index].pi;
                                delete node['m2m:sgn'].nev.rep[index].rn;
                                delete node['m2m:sgn'].nev.rep[index].ty;
                                delete node['m2m:sgn'].nev.rep[index].fr;

                                short_flag = 1;
                            }
                        }
                    }
                }
            }
        }
    }

    if(check_value == 128) {
        node['m2m:sgn'].sud = true;
        delete node['m2m:sgn'].nev;
    }
    else if(check_value == 256) {
        if(!node['m2m:sgn'].hasOwnProperty('vrq')) {
            node['m2m:sgn'].vrq = true;
        }
        node['m2m:sgn'].vrq = true;
        var temp = node['m2m:sgn'].sur;
        delete node['m2m:sgn'].sur;
        node['m2m:sgn'].sur = temp;
        node['m2m:sgn'].cr = ss_cr;
        delete node['m2m:sgn'].nev;
    }

    if(useCert !== 'enable') {
        node['m2m:sgn'].rvi = uservi;
    }

    let bodyString = make_body_string_for_noti(sub_nu.protocol, nu, node, sub_bodytype, xm2mri, short_flag);
    if (bodyString === '') { // parse error
        console.log('can not send notification since error of converting json to xml');
    }
    else {
        sgn_man.post(ss_ri, exc, nu, sub_bodytype, xm2mri, bodyString, parentObj);
    }

    sgn_action_send(nu_arr, ++req_count, sub_bodytype, node, short_flag, check_value, ss_cr, ss_ri, xm2mri, exc, parentObj);
}

function get_nu_arr(connection, nu_arr, req_count, callback) {
    if(nu_arr.length <= req_count) {
        callback('200');
        return;
    }

    var nu = nu_arr[req_count];
    var sub_nu = new URL(nu);

    if(sub_nu.protocol == null) { // ID format
        let absolute_ri = '';
        if (nu.charAt(0) != '/') {
            absolute_ri = '/' + nu;
        }
        else {
            absolute_ri = nu.replace(/\/\/[^\/]+\/?/, '\/');
            absolute_ri = absolute_ri.replace(/\/[^\/]+\/?/, '/');
        }

        let res_code = db_sql.select_resource_of(absolute_ri);
        const err = res_code[0];
        let res_obj = [];
        if (!err) {
            res_obj = res_code[1];
            if (res_obj[0].poa != null || res_obj[0].poa != '') {
                nu_arr.pop();
                var poa_arr = JSON.parse(res_obj[0].poa);
                for (var i = 0; i < poa_arr.length; i++) {
                    sub_nu = new URL(poa_arr[i]);
                    if (sub_nu.protocol == null) {
                        let absolute_url = absolute_ri.replace(/_/g, '\/');
                        nu_arr.push('http://localhost:7579' + absolute_url);
                    }
                    else {
                        if (poa_arr[i].charAt(poa_arr[i].length - 1) == '/') {
                            poa_arr[i] = poa_arr[i].slice(0, -1);
                        }
                        nu_arr.push(poa_arr[i]);
                    }
                }
            }
        }

        get_nu_arr(connection, nu_arr, ++req_count, function (code) {
            callback(code);
        });
    }
    else {
        get_nu_arr(connection, nu_arr, ++req_count, function (code) {
            callback(code);
        });
    }
}

function sgn_action(connection, rootnm, check_value, subl, req_count, noti_Obj, sub_bodytype, parentObj) {
    if(subl.length <= req_count) {
        return;
    }

    var results_ss = subl[req_count];
    var notiObj = merge({}, noti_Obj);

    var nct = results_ss.nct;
    var enc_Obj = results_ss.enc;
    var net_arr = JSON.parse(JSON.stringify(enc_Obj.net));
    var nu_arr = JSON.parse(JSON.stringify(results_ss.nu));

    var xm2mri = require('shortid').generate();
    var short_flag = 0;

    var node = {};
    node['m2m:sgn'] = {};

    if(results_ss.ri.charAt(0) == '/') {
        node['m2m:sgn'].sur = results_ss.ri.replace('/', '');
    }
    else {
        node['m2m:sgn'].sur = results_ss.ri;
    }

    if (results_ss.nec) {
        node['m2m:sgn'].nec = results_ss.nec;
    }
    node['m2m:sgn'].nev = {};
    node['m2m:sgn'].nev.rep = {};

    if(rootnm == 'mgo') {
        node['m2m:sgn'].nev.rep['m2m:' + responder.mgoType[notiObj.mgd]] = JSON.parse(JSON.stringify(notiObj));
    }
    else if(rootnm == 'fcnt') {
        if (notiObj.cnd.includes('org.onem2m.home.device.')) {
            node['m2m:sgn'].nev.rep['m2m:' + rootnm] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.doorlock') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'dooLk')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.battery') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'bat')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.temperature') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'tempe')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.binarySwitch') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'binSh')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.faultDetection') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'fauDn')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.colourSaturation') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'colSn')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.colour') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'color')] = JSON.parse(JSON.stringify(notiObj));
            delete body_Obj[rootnm];
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.brightness') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'brigs')] = JSON.parse(JSON.stringify(notiObj));
        }
    }
    else if(rootnm.includes('hd_')) {
        node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('hd_', '')] = JSON.parse(JSON.stringify(notiObj));
    }
    else {
        node['m2m:sgn'].nev.rep['m2m:' + rootnm] = JSON.parse(JSON.stringify(notiObj));
    }

    responder.typeCheckforJson(node['m2m:sgn'].nev.rep);

    notiObj = null;

    for (var j = 0; j < net_arr.length; j++) {
        if (net_arr[j] == check_value || check_value == 256 || check_value == 128) { // 1 : Update_of_Subscribed_Resource, 3 : Create_of_Direct_Child_Resource, 4 : Delete_of_Direct_Child_Resource
            node['m2m:sgn'].nev.net = parseInt(net_arr[j].toString());

            get_nu_arr(connection, nu_arr, 0, function (code) {
                if(code == '200') {
                    if (nct == 2 || nct == 1) {
                        sgn_action_send(nu_arr, 0, sub_bodytype, node, short_flag, check_value, results_ss.cr, results_ss.ri, xm2mri, results_ss.exc, parentObj);

                        sgn_action(connection, rootnm, check_value, subl, ++req_count, noti_Obj, sub_bodytype, parentObj);
                    }
                    else {
                        console.log('nct except 2 (All Attribute) do not support');
                        sgn_action(connection, rootnm, check_value, subl, ++req_count, noti_Obj, sub_bodytype, parentObj);
                    }
                }
            });
            break;
        }
    }
}

exports.check = async function(request, notiObj, check_value) {
    var rootnm = request.headers.rootnm;

    if((request.method.toLowerCase() == "put" && check_value == 1)) {
        var pi = notiObj.ri;
    }
    else if ((request.method.toLowerCase() == "post" && check_value == 3) || (request.method.toLowerCase() == "delete" && check_value == 4)) {
        pi = notiObj.pi;
    }

    var ri = notiObj.ri;

    var noti_Str = JSON.stringify(notiObj);
    var noti_Obj = JSON.parse(noti_Str);

    var targetObj = JSON.parse(JSON.stringify(request.targetObject))[Object.keys(request.targetObject)[0]];

    const res_code = await db_sql.select_subs_under(targetObj.ri);
    const err = res_code[0];
    let subl = [];

    if(!err) {
        subl = res_code[1];
    }

    if(check_value == 256 || check_value == 128) { // verification
        sgn_action(request.db_connection, rootnm, check_value, subl, 0, noti_Obj, request.usebodytype, targetObj);
    }
    else {
        var noti_ri = noti_Obj.ri;
        noti_Obj.ri = noti_Obj.sri;
        delete noti_Obj.sri;
        noti_Obj.pi = noti_Obj.spi;
        delete noti_Obj.spi;

        sgn_action(request.db_connection, rootnm, check_value, subl, 0, noti_Obj, request.usebodytype, targetObj);
    }
};
