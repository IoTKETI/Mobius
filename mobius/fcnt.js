/**
 * Copyright (c) 2020, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2020, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var util = require('util');
var responder = require('./responder');
var shape = require('./shape');

// Attributes copied from the body per moduleclass. Keys are the short names from shape.MODULE_CLASS.
var HD_ATTRS = {
    dooLk: ['lock'], bat: ['lvl'], tempe: ['curT0'], binSh: ['powerSe'],
    fauDn: ['sus'], colSn: ['colSn'], color: ['red', 'green', 'blue'], brigs: ['brigs']
};


exports.build_fcnt = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    // - specific attributes
    resource_Obj[rootnm].cnd = body_Obj[rootnm].cnd;
    // cr is set by the server from the origin header.
    resource_Obj[rootnm].cr = request.headers['x-m2m-origin'];

    if(rootnm == 'fcnt' && body_Obj[rootnm].cnd.includes('org.onem2m.home.device.')) {
    }
    else {
        // Resolve the moduleclass short name from the root name and cnd (shape.hd_short); unknown pairs are rejected with 400-54.
        var hd = shape.hd_short(rootnm, body_Obj[rootnm].cnd);
        if (hd === null) {
            callback('400-54');
            return;
        }
        // Copy in order: key order is the byte order of the response body (red, green, blue for color).
        HD_ATTRS[hd].forEach(function (attr) {
            resource_Obj[rootnm][attr] = body_Obj[rootnm][attr];
        });
    }

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};