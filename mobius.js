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

var fs = require('fs');

var data  = fs.readFileSync('conf.json', 'utf-8');
var conf = JSON.parse(data);

global.defaultnmtype        = 'short';
global.defaultbodytype      = 'json';


// my CSE information
global.usecsetype           = 'in'; // select 'in' or 'mn' or asn'
global.usecsebase           = 'Mobius';
global.usecseid             = '/Mobius';
global.usecsebaseport       = conf.csebaseport;

global.usedbhost            = 'localhost';
global.usedbpass            = conf.dbpass;


global.usepxywsport         = '7577';
global.usepxymqttport       = '7578';


global.usetsagentport       = '7582';

global.usemqttbroker        = 'localhost'; // mqttbroker for mobius
global.usesemanticbroker    = '10.10.202.114';
global.usesecure            = 'disable';
if(usesecure === 'enable') {
    global.usemqttport      = '8883';
}
else {
    usemqttport             = '1883';
}

global.useaccesscontrolpolicy = 'disable';

global.wdt = require('./wdt');


var file = 'hit.json';
fs.open(file, 'w', function(err, fd) {
    if (err) {
        throw err;
    }
    else {
        var hit = {};

        var moment = require('moment');
        var a = moment().utc();
        var cur_t = a.format('YYYYMMDD');
        var h = a.hours();

        if(!hit.hasOwnProperty(cur_t)) {
            hit[cur_t] = [];
            for(var i = 0; i < 24; i++) {
                hit[cur_t].push({});
            }
        }

        //console.log(hit);
        fs.writeFileSync('hit.json', JSON.stringify(hit, null, 4), 'utf8');
    }
});

// CSE core
require('./app');
