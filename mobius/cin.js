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

//var _this = this;



exports.build_cin = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    if(body_Obj[rootnm].con['$'] != null) {
        resource_Obj[rootnm].con = body_Obj[rootnm].con['_'];
    }
    else {
        resource_Obj[rootnm].con = body_Obj[rootnm].con;
    }
    /*if (Array.isArray(body_Obj[rootnm].con)) {
        return 'array';
    }
    else if (typeof body_Obj[rootnm].con == 'string') {
        return 'string';
    }
    else if (body_Obj[rootnm].con != null && typeof body_Obj[rootnm].con == 'object') {
        if(body_Obj[rootnm].con['$'] != null) {

        }
        else {
            resource_Obj[rootnm].con = body_Obj[rootnm].con;
        }
    }
    else {
        return 'other';
    }*/

    var con_type = getType(resource_Obj[rootnm].con);
    if(con_type == 'string') {
        resource_Obj[rootnm].cs = Buffer.byteLength(resource_Obj[rootnm].con, 'utf8').toString();
    }
    else {
        if (con_type === 'string_object') {
            try {
                resource_Obj[rootnm].con = JSON.parse(resource_Obj[rootnm].con);
            }
            catch (e) {
            }
        }
        resource_Obj[rootnm].cs = Buffer.byteLength(JSON.stringify(resource_Obj[rootnm].con), 'utf8').toString();
    }

    resource_Obj[rootnm].cnf = (body_Obj[rootnm].cnf) ? body_Obj[rootnm].cnf : '';
    if(resource_Obj[rootnm].cnf != '') {
        if (resource_Obj[rootnm].cnf.split(':')[0] == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'BAD REQUEST: contentInfo(cnf) format is not match';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }

    resource_Obj[rootnm].or = (body_Obj[rootnm].or) ? body_Obj[rootnm].or : '';
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

    callback('1', resource_Obj);
};
