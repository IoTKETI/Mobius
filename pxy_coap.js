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
 * Created by Il Yeup, Ahn in KETI on 2016-10-18.
 */

/**
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

// ─────────────────────────────────────────────────────────────────────────
// CoAP 바인딩은 삭제 예정이다.
//
// 프로토콜 지원용으로 만들어 뒀으나 쓰는 배포가 없고 검증 수단도 없다.
// 이 파일에 새로 투자하지 말 것 — 결과 코드 매핑도 규격 대조 없이
// 카탈로그의 폴백에 기대고 있다.
// ─────────────────────────────────────────────────────────────────────────

var fs = require('fs');
var http = require('http');
var https = require('https');
var coap = require('coap');

global.NOPRINT = 'true';

var _this = this;

var coap_state = 'init';

//var custom = new process.EventEmitter();
var events = require('events');
var coap_custom = new events.EventEmitter();

var usecoapcbhost = 'localhost'; // pxycoap to mobius

// rsc -> CoAP 응답 코드는 mobius/rsc.js 카탈로그가 들고 있다.
//
// 예전에는 여기에 자체 표가 있었는데, app.js 의 결과 코드 표와 서로를 몰라서
// 매핑이 어긋나 있었다. 실제로 6종(1001 1002 4106 4107 4109 4230)이 이 표에
// 없어서 response.code 에 undefined 가 들어갔다.
//
// toCoapCode() 는 매핑이 없으면 rsc 첫 자리로 정한 값을 준다 — undefined 는
// 절대 나가지 않는다.
var toCoapCode = require('./mobius/rsc').toCoapCode;

coap_state = 'init';

//setInterval(function () {
//    coap_custom.emit('coap_watchdog');
//}, 2000);

var pxycoap_server = null;

//coap_custom.on('coap_watchdog', function() {
exports.coap_watchdog = function () {
    if(coap_state === 'init') {
        coap_state = 'connect';
    }
    else if(coap_state === 'connect') {
        if(pxycoap_server == null) {
            pxycoap_server = coap.createServer();
            pxycoap_server.listen(usecsebaseport, function() {
                // var options = {
                //     host: 'localhost',
                //     port: usecsebaseport,
                //     pathname: '/'+usecsebase,
                //     method: 'get',
                //     confirmable: 'false',
                //     options: {
                //         'Accept': 'application/json'
                //     }
                // };
                //
                // var bodyString = '';
                // var responseBody = '';
                // var req = coap.request(options);
                // req.setOption("256", new Buffer(usecseid));      // X-M2M-Origin
                // req.setOption("257", new Buffer('hello'));    // X-M2M-RI
                // req.on('response', function (res) {
                //     res.on('data', function () {
                //         responseBody += res.payload.toString();
                //     });
                //
                //     res.on('end', function () {
                //         if(res.code == '2.05') {
                //             coap_state = 'ready';
                //             console.log('[pxy_coap] coap ready');
                //         }
                //     });
                // });
                // req.on('error', function (e) {
                //     console.log(e);
                // });
                //
                // req.write(bodyString);
                // req.end();
            });


            pxycoap_server.on('request', coap_message_handler);

            pxycoap_server.on('error', function (e) {
                console.log(e);
            });
        }
    }
};


var coap_tid = require('shortid').generate();
wdt.set_wdt(coap_tid, 2, _this.coap_watchdog);

function coap_message_handler(request, response) {

    var headers = {};
    headers['X-M2M-TY'] = '';

    // check coap options
    for (var idx in request.options) {
        if (request.options.hasOwnProperty(idx)) {
            if (request.options[idx].name == '256') { // 'X-M2M-Origin
                headers['X-M2M-Origin'] = request.options[idx].value.toString();
            }
            else if (request.options[idx].name == '257') { // 'X-M2M-RI
                headers['X-M2M-RI'] = request.options[idx].value.toString();
            }
            else if (request.options[idx].name == '267') { // 'X-M2M-TY
                headers['X-M2M-TY'] = Buffer.isBuffer(request.options[idx].value) ? request.options[idx].value[0].toString() : request.options[idx].value.toString();
            }
            // else if (request.options[idx].name == '268') { // 'X-M2M-RVI
            //     headers['X-M2M-RVI'] = request.options[idx].value.toString();
            // }
        }
    }

    if(request.headers['Accept'])
    {
        headers['Accept'] = request.headers['Accept'];
    }

    if(request.headers['Content-Type'])
    {
        if(headers['X-M2M-TY'] == '') {
            headers['Content-Type'] = request.headers['Content-Type'];
        }
        else {
            headers['Content-Type'] = request.headers['Content-Type'] + ';ty=' + headers['X-M2M-TY'];
        }
    }

    delete headers['X-M2M-TY'];

    headers['binding'] = 'C';
    headers['remoteaddress'] = request.rsinfo.address;

    var responseBody = '';

    var options = {
        hostname: usecoapcbhost,
        port: usecsebaseport,
        path: request.url,
        method: request.method,
        headers: headers
    };

    if(use_secure === 'disable') {
        var req = http.request(options, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                console.log('<----- [pxy_coap]');
                console.log(responseBody);

                var rsc = new Buffer(2);
                rsc.writeUInt16BE(parseInt(res.headers['x-m2m-rsc'], 'hex'), 0);
                response.setOption("265", rsc);    // X-M2M-RSC
                //var rqi = new Buffer(2);
                //rqi.writeUInt16BE(parseInt(res.headers['x-m2m-ri'], 'hex'), 0);
                //var rqi = res.headers['x-m2m-ri'];
                var rqi = Buffer.from(res.headers['x-m2m-ri'], 'utf-8');
                response.setOption("257", rqi);    // X-M2M-RQI
                if (res.headers['content-type']) {
                    response.setOption("Content-Format", res.headers['content-type']);
                }
                // if(res.headers.hasOwnProperty('x-m2m-rvi')) {
                //     var rvi = Buffer.from(res.headers['x-m2m-rvi'], 'utf-8');
                //     response.setOption("268", rvi);    // X-M2M-RVI
                // }
                response.code = toCoapCode(res.headers['x-m2m-rsc']);
                response.end(responseBody);
            });
        });
    }
    else if(use_secure === 'enable') {
        options.ca = fs.readFileSync('ca-crt.pem');

        req = https.request(options, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                console.log('<----- [pxy_coap]');
                console.log(responseBody);

                var rsc = new Buffer(2);
                rsc.writeUInt16BE(parseInt(res.headers['x-m2m-rsc'], 'hex'), 0);
                response.setOption("265", rsc);    // X-M2M-RSC
                var rqi = new Buffer(2);
                rqi.writeUInt16BE(parseInt(res.headers['x-m2m-ri'], 'hex'), 0);
                response.setOption("257", rqi);    // X-M2M-RQI
                if (res.headers['content-type']) {
                    response.setOption("Content-Format", res.headers['content-type']);
                }
                // if(res.headers.hasOwnProperty('x-m2m-rvi')) {
                //     response.setOption("X-M2M-RVI", res.headers['x-m2m-rvi']);
                // }
                response.code = toCoapCode(res.headers['x-m2m-rsc']);
                response.end(responseBody);
            });
        });

    }

    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[pxycoap - http_retrieve_CSEBase] problem with request: ' + e.message);
        }
    });

    var bodyString = request.payload.toString();
    console.log('-----> [pxy_coap]');
    console.log(bodyString);

    // write data to request body
    req.write(bodyString);
    req.end();
}
