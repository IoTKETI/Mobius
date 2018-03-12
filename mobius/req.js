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
 * @copyright KETI Korea 2018
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var responder = require('./responder');

var op = {
    post: '1',
    get: '2',
    put: '3',
    delete: '4',
    notify: '5'
};

exports.build_req = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].pi = '/' + usecsebase;
    resource_Obj[rootnm].ri = '/' + usecsebase + '/' + resource_Obj[rootnm].rn;

    resource_Obj[rootnm].op = (body_Obj[rootnm].op) ? body_Obj[rootnm].op : op[request.method];
    //resource_Obj[rootnm].tg = (body_Obj[rootnm].tg) ? body_Obj[rootnm].tg : resource_Obj[rootnm].ri;
    resource_Obj[rootnm].tg = (body_Obj[rootnm].tg) ? body_Obj[rootnm].tg : url.parse(request.url).pathname;
    resource_Obj[rootnm].org = (body_Obj[rootnm].org) ? body_Obj[rootnm].org : request.headers['x-m2m-origin'];
    resource_Obj[rootnm].rid = (body_Obj[rootnm].rid) ? body_Obj[rootnm].rid : request.headers['x-m2m-ri'];
    resource_Obj[rootnm].mi = (body_Obj[rootnm].mi) ? body_Obj[rootnm].mi : '';
    resource_Obj[rootnm].pc = (body_Obj[rootnm].pc) ? body_Obj[rootnm].pc : '';
    resource_Obj[rootnm].rs = (body_Obj[rootnm].rs) ? body_Obj[rootnm].rs : '';
    resource_Obj[rootnm].ors = (body_Obj[rootnm].ors) ? body_Obj[rootnm].ors : '';

    callback('1', resource_Obj);
};

