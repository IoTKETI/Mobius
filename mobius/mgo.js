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
var util = require('util');
var responder = require('./responder');


exports.build_mgo = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    // - specific attributes
    resource_Obj[rootnm].mgd = body_Obj[rootnm].mgd;
    resource_Obj[rootnm].objs = (body_Obj[rootnm].objs) ? body_Obj[rootnm].objs : '';
    resource_Obj[rootnm].obps = (body_Obj[rootnm].obps) ? body_Obj[rootnm].obps : '';
    resource_Obj[rootnm].dc = (body_Obj[rootnm].dc) ? body_Obj[rootnm].dc : '';

    if(rootnm == 'fwr' && body_Obj[rootnm].mgd == '1001') {
        resource_Obj[rootnm].vr = body_Obj[rootnm].vr;
        resource_Obj[rootnm].fwnnam = body_Obj[rootnm].fwnnam;
        resource_Obj[rootnm].url = body_Obj[rootnm].url;
        resource_Obj[rootnm].ud = body_Obj[rootnm].ud;
        resource_Obj[rootnm].uds = '';
    }
    else if(rootnm == 'bat' && body_Obj[rootnm].mgd == '1006') {
        resource_Obj[rootnm].btl = body_Obj[rootnm].btl;
        resource_Obj[rootnm].bts = body_Obj[rootnm].bts;
    }
    else if(rootnm == 'dvi' && body_Obj[rootnm].mgd == '1007') {
        resource_Obj[rootnm].dbl = body_Obj[rootnm].dbl;
        resource_Obj[rootnm].man = body_Obj[rootnm].man;
        resource_Obj[rootnm].mod = body_Obj[rootnm].mod;
        resource_Obj[rootnm].dty = body_Obj[rootnm].dty;
        resource_Obj[rootnm].fwv = body_Obj[rootnm].fwv;
        resource_Obj[rootnm].swv = body_Obj[rootnm].swv;
        resource_Obj[rootnm].hwv = body_Obj[rootnm].hwv;
    }
    else if(rootnm == 'dvc' && body_Obj[rootnm].mgd == '1008') {
        resource_Obj[rootnm].can = body_Obj[rootnm].can;
        resource_Obj[rootnm].att = body_Obj[rootnm].att;
        resource_Obj[rootnm].cas = body_Obj[rootnm].cas;
        resource_Obj[rootnm].cus = body_Obj[rootnm].cus;
        resource_Obj[rootnm].ena = (body_Obj[rootnm].ena) ? body_Obj[rootnm].ena : 'true';
        resource_Obj[rootnm].dis = (body_Obj[rootnm].dis) ? body_Obj[rootnm].dis : 'true';
    }
    else if(rootnm == 'rbo' && body_Obj[rootnm].mgd == '1009') {
        resource_Obj[rootnm].rbo = (body_Obj[rootnm].rbo) ? body_Obj[rootnm].rbo : 'true';
        resource_Obj[rootnm].far = (body_Obj[rootnm].far) ? body_Obj[rootnm].far : 'true';
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'mgmtDefinition is not match with mgmtObj resource';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    callback('1', resource_Obj);
};

// exports.modify_mgo = function(request, response, resource_Obj, body_Obj, callback) {
//     var rootnm = request.headers.rootnm;
//
//     // check M
//     for (var attr in update_m_attr_list[rootnm]) {
//         if (update_m_attr_list[rootnm].hasOwnProperty(attr)) {
//             if (body_Obj[rootnm].includes(attr)) {
//             }
//             else {
//                 body_Obj = {};
//                 body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Mandatory\' attribute';
//                 responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//                 callback('0', resource_Obj);
//                 return '0';
//             }
//         }
//     }
//
//     // check NP and body
//     for (attr in body_Obj[rootnm]) {
//         if (body_Obj[rootnm].hasOwnProperty(attr)) {
//             if (update_np_attr_list[rootnm].includes(attr)) {
//                 body_Obj = {};
//                 body_Obj['dbg'] = 'BAD REQUEST: ' + attr + ' is \'Not Present\' attribute';
//                 responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//                 callback('0', resource_Obj);
//                 return '0';
//             }
//             else {
//                 if (update_opt_attr_list[rootnm].includes(attr)) {
//                 }
//                 else {
//                     body_Obj = {};
//                     body_Obj['dbg'] = 'NOT FOUND: ' + attr + ' attribute is not defined';
//                     responder.response_result(request, response, 404, body_Obj, 4004, request.url, body_Obj['dbg']);
//                     callback('0', resource_Obj);
//                     return '0';
//                 }
//             }
//         }
//     }
//
//     update_body(rootnm, body_Obj, resource_Obj);
//
//     resource_Obj[rootnm].st = (parseInt(resource_Obj[rootnm].st, 10) + 1).toString();
//
//     var cur_d = new Date();
//     resource_Obj[rootnm].lt = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
//
//     if (resource_Obj[rootnm].et != '') {
//         if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
//             body_Obj = {};
//             body_Obj['dbg'] = 'expiration time is before now';
//             responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
//             callback('0', resource_Obj);
//             return '0';
//         }
//     }
//
//     callback('1', resource_Obj);
// };

