/**
 * Copyright (c) 2016, OCEAN
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
 * @copyright KETI Korea 2016, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var fs = require('fs');
var http = require('http');
var https = require('https');
var coap = require('coap');
var util = require('util');
var xml2js = require('xml2js');
var url = require('url');
var xmlbuilder = require('xmlbuilder');
var moment = require('moment');
var ip = require("ip");


global.NOPRINT = 'true';


var _this = this;

var coap_state = 'init';

//var custom = new process.EventEmitter();
var events = require('events');
var coap_custom = new events.EventEmitter();


var usecoapcbhost = 'localhost'; // pxycoap to mobius



var coap_rsc_code = {
    '2000': '2.05',
    '2001': '2.01',
    '2002': '2.02',
    '2004': '2.04',
    '4000': '4.00',
    '4004': '4.04',
    '4005': '4.05',
    '4008': '4.04',
    '4101': '4.03',
    '4102': '4.00',
    '4103': '4.03',
    '4104': '4.00',
    '4105': '4.03',
    '5000': '5.00',
    '5001': '5.01',
    '5103': '4.04',
    '5105': '4.03',
    '5106': '5.06',
    '5203': '4.03',
    '5204': '5.00',
    '5205': '4.03',
    '5206': '5.00',
    '5207': '4.06',
    '6003': '4.04',
    '6005': '4.04',
    '6010': '4.00',
    '6011': '4.00',
    '6020': '5.00',
    '6021': '5.00',
    '6022': '4.00',
    '6023': '4.00',
    '6024': '4.00',
    '6025': '5.00',
    '6026': '5.00',
    '6028': '4.00',
    '6029': '4.00'
};

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
            pxycoap_server.listen(usepxycoapport, function() {
                var options = {
                    host: 'localhost',
                    port: usepxycoapport,
                    pathname: '/'+usecsebase,
                    method: 'get',
                    confirmable: 'false',
                    options: {
                        'Accept': 'application/json'
                    }
                };

                var bodyString = '';
                var responseBody = '';
                var req = coap.request(options);
                req.setOption("256", new Buffer(usecseid));      // X-M2M-Origin
                req.setOption("257", new Buffer('hello'));    // X-M2M-RI
                req.on('response', function (res) {
                    res.on('data', function () {
                        responseBody += res.payload.toString();
                    });

                    res.on('end', function () {
                        if(res.code == '2.05') {
                            coap_state = 'ready';
                            console.log('[pxy_coap] coap ready');
                        }
                    });
                });
                req.on('error', function (e) {
                    console.log(e);
                });

                req.write(bodyString);
                req.end();
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

    var responseBody = '';

    if(usesecure === 'disable') {
        var options = {
            hostname: usecoapcbhost,
            port: usecsebaseport,
            path: request.url,
            method: request.method,
            headers: headers
        };

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
                var rqi = new Buffer(2);
                rqi.writeUInt16BE(parseInt(res.headers['x-m2m-ri'], 'hex'), 0);
                response.setOption("257", rqi);    // X-M2M-RQI
                if (res.headers['content-type']) {
                    response.setOption("Content-Format", res.headers['content-type']);
                }
                response.code = coap_rsc_code[res.headers['x-m2m-rsc']];
                response.end(responseBody);
            });
        });
    }
    else if(usesecure === 'enable') {
        options = {
            hostname: usecoapcbhost,
            port: usecsebaseport,
            path: request.url,
            method: request.method,
            headers: headers,
            ca: fs.readFileSync('ca-crt.pem')
        };

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
                response.code = coap_rsc_code[res.headers['x-m2m-rsc']];
                response.end(responseBody);
            });
        });

    }

    req.on('error', function (e) {
        if (e.message !== 'read ECONNRESET') {
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
