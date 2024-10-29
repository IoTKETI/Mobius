/**
 * Copyright (c) 2024, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2024, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var util = require('util');
var responder = require('./responder');
var db_sql = require('./sql_action');

function verify_nu(request, response, body_Obj, req_count, callback) {
    var rootnm = request.headers.rootnm;
    var nu_arr = body_Obj[rootnm].nu;

    if(req_count == nu_arr.length) {
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

        let absolute_url = absolute_ri.replace(/_/g, '\/');

        db_sql.select_ri_lookup(request.db_connection, absolute_url, (err, results_ri) => {
            if (results_ri.length == 0) {
                callback('500-2');
                return;
            }

            results_ri = null;
            verify_nu(request, response, body_Obj, ++req_count, (code) => {
                callback(code);
            });
        });
    }
    else {
        verify_nu(request, response, body_Obj, ++req_count, (code) => {
            callback(code);
        });
    }
}

exports.build_sub = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body

    // verify nu
    verify_nu(request, response, body_Obj, 0, function (code) {
        if(code === '200') {
            resource_Obj[rootnm].nu = body_Obj[rootnm].nu;

            resource_Obj[rootnm].enc = (body_Obj[rootnm].enc) ? body_Obj[rootnm].enc : {"net": ["1"]};
            resource_Obj[rootnm].exc = (body_Obj[rootnm].exc) ? body_Obj[rootnm].exc : '100';
            resource_Obj[rootnm].gpi = (body_Obj[rootnm].gpi) ? body_Obj[rootnm].gpi : '';
            resource_Obj[rootnm].nfu = (body_Obj[rootnm].nfu) ? body_Obj[rootnm].nfu : '';
            resource_Obj[rootnm].bn = (body_Obj[rootnm].bn) ? body_Obj[rootnm].bn : {};
            resource_Obj[rootnm].rl = (body_Obj[rootnm].rl) ? body_Obj[rootnm].rl : '';
            resource_Obj[rootnm].psn = (body_Obj[rootnm].psn) ? body_Obj[rootnm].psn : '';
            resource_Obj[rootnm].pn = (body_Obj[rootnm].pn) ? body_Obj[rootnm].pn : '';
            resource_Obj[rootnm].nsp = (body_Obj[rootnm].nsp) ? body_Obj[rootnm].nsp : '';
            resource_Obj[rootnm].ln = (body_Obj[rootnm].ln) ? body_Obj[rootnm].ln : '';
            resource_Obj[rootnm].nct = (body_Obj[rootnm].nct) ? body_Obj[rootnm].nct : '2';
            resource_Obj[rootnm].nec = (body_Obj[rootnm].nec) ? body_Obj[rootnm].nec : '';
            resource_Obj[rootnm].su = (body_Obj[rootnm].su) ? body_Obj[rootnm].su : '';
            resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

            request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
            resource_Obj = null;

            callback(code);
        }
        else {
            callback(code)
        }
    });
};


// exports.modify_sub = function(request, response, resource_Obj, body_Obj, callback) {
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
//     update_body(rootnm, body_Obj, resource_Obj); // (attr == 'aa' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' || attr == 'nu' || attr == 'mid' || attr == 'macp')
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


