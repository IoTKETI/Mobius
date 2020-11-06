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
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var responder = require('./responder');


exports.build_fcnt = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    // - specific attributes
    resource_Obj[rootnm].cnd = body_Obj[rootnm].cnd;
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

    if(rootnm == 'fcnt' && body_Obj[rootnm].cnd.includes('org.onem2m.home.device.')) {
    }
    else if(rootnm == 'hd_dooLk' && body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.doorlock') {
        resource_Obj[rootnm].lock = body_Obj[rootnm].lock;
    }
    else if(rootnm == 'hd_bat' && body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.battery') {
        resource_Obj[rootnm].lvl = body_Obj[rootnm].lvl;
    }
    else if(rootnm == 'hd_tempe' && body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.temperature') {
        resource_Obj[rootnm].curT0 = body_Obj[rootnm].curT0;
    }
    else if(rootnm == 'hd_binSh' && body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.binarySwitch') {
        resource_Obj[rootnm].powerSe = body_Obj[rootnm].powerSe;
    }
    else if(rootnm == 'hd_fauDn' && body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.faultDetection') {
        resource_Obj[rootnm].sus = body_Obj[rootnm].sus;
    }
    else if(rootnm == 'hd_colSn' && body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colourSaturation') {
        resource_Obj[rootnm].colSn = body_Obj[rootnm].colSn;
    }
    else if(rootnm == 'hd_color' && body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colour') {
        resource_Obj[rootnm].red = body_Obj[rootnm].red;
        resource_Obj[rootnm].green = body_Obj[rootnm].green;
        resource_Obj[rootnm].blue = body_Obj[rootnm].blue;
    }
    else if(rootnm == 'hd_brigs' && body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.brightness') {
        resource_Obj[rootnm].brigs = body_Obj[rootnm].brigs;
    }
    else {
        callback('400-54');
        return;
    }

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};