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
var util = require('util');
var responder = require('./responder');

exports.build_lcp = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].los = body_Obj[rootnm].los;
    resource_Obj[rootnm].lou = (body_Obj[rootnm].lou) ? body_Obj[rootnm].lou : '0';
    resource_Obj[rootnm].lot = (body_Obj[rootnm].lot) ? body_Obj[rootnm].lot : '';
    resource_Obj[rootnm].lor = (body_Obj[rootnm].lor) ? body_Obj[rootnm].lor : '';
    resource_Obj[rootnm].loi = (body_Obj[rootnm].loi) ? body_Obj[rootnm].loi : '';
    resource_Obj[rootnm].lon = (body_Obj[rootnm].lon) ? body_Obj[rootnm].lon : '';
    resource_Obj[rootnm].lost = (body_Obj[rootnm].lost) ? body_Obj[rootnm].lost : '';

    // cr is set by the server from the origin header. A cr in the body is ignored, never trusted.
    resource_Obj[rootnm].cr = request.headers['x-m2m-origin'];

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};

