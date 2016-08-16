/**
 * Copyright (c) 2015, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Created by Il Yeup, Ahn in KETI on 2016-07-28.
 */

var mn = require('./mobius/mn');

global.defaultnmtype        = 'short';
global.defaultbodytype      = 'json';


// parent CSE information
global.parent_cbname        = 'mobius';
global.parent_cbcseid       = '/mobius';
global.parent_cbhost        = 'localhost';
global.parent_cbhostport    = '7579';
global.parent_cbprotocol    = 'mqtt';               // select 'http' or 'mqtt' when register remoteCSE
global.parent_mqttbroker    = '203.253.128.151';


// my CSE information
global.usecsetype           = 'mn'; // select 'in or 'mn' or asn'
global.usecsebase           = 'rosemary';
global.usecseid             = '/rosemary';
global.usecsebaseport       = '7575';

global.usedbhost            = 'localhost';
global.usedbpass            = 'dksdlfduq2';


global.usepxymqttport       = '7574';
global.usetsagentport       = '7573';

global.usemqttbroker        = parent_mqttbroker; // mobius to mqttbroker


// CSE core
require('./app');


global.custom = new process.EventEmitter();

custom.on('register_remoteCSE', function() {
    mn.build_mn('/'+usecsebase, function (rsp) {
        console.log('[[[[[[[[[[[[[[[[register_remoteCSE]]]]]]]]]]]]]]]] ' + JSON.stringify(rsp));
        if(rsp.rsc == '2000') {
            clearInterval(refreshIntervalId);
        }
    });
});
