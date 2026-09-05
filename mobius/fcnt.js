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

// moduleclass 별로 본문에서 옮길 속성. 키는 shape.MODULE_CLASS 의 값(약칭)이다 —
// 어느 cnd 가 어느 약칭인지는 저 표만 알고, 여기는 약칭이 어떤 속성을 갖는지만 안다.
var HD_ATTRS = {
    dooLk: ['lock'], bat: ['lvl'], tempe: ['curT0'], binSh: ['powerSe'],
    fauDn: ['sus'], colSn: ['colSn'], color: ['red', 'green', 'blue'], brigs: ['brigs']
};


exports.build_fcnt = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    // - specific attributes
    resource_Obj[rootnm].cnd = body_Obj[rootnm].cnd;
    // cr 은 서버가 정한다 — 이유는 mobius/cnt.js 의 같은 자리 주석 참조.
    resource_Obj[rootnm].cr = request.headers['x-m2m-origin'];

    if(rootnm == 'fcnt' && body_Obj[rootnm].cnd.includes('org.onem2m.home.device.')) {
    }
    else {
        // 여덟 갈래 (rootnm == 'hd_X' && cnd == '...Y') 가 여기 있었다 — 같은 짝
        // 판정이 resource.js 에도 적혀 있었다. 판정은 접두 표(shape.MODULE_CLASS)의
        // 것이라 shape.hd_short 로 가고, 타입별로 옮길 속성만 HD_ATTRS 로 남는다.
        // 1단계 5번(2026-09-05).
        var hd = shape.hd_short(rootnm, body_Obj[rootnm].cnd);
        if (hd === null) {
            callback('400-54');
            return;
        }
        // 순서대로 옮긴다 — 키 순서가 응답 본문의 바이트다 (color 의 red·green·blue).
        HD_ATTRS[hd].forEach(function (attr) {
            resource_Obj[rootnm][attr] = body_Obj[rootnm][attr];
        });
    }

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};