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

var conf = {};
try {
    conf = JSON.parse(fs.readFileSync('conf.json', 'utf8'));
}
catch (e) {
    conf.csebaseport = "7579";
    conf.dbpass = "dksdlfduq2";
    fs.writeFileSync('conf.json', JSON.stringify(conf, null, 4), 'utf8');
}

global.defaultbodytype      = 'json';

// my CSE information
global.usecsetype           = 'in'; // select 'in' or 'mn' or asn'
global.usecsebase           = 'Mobius';
global.usecseid             = '/Mobius2';
global.usecsebaseport       = conf.csebaseport;

global.usedbhost            = 'localhost';
global.usedbpass            = conf.dbpass;


global.usepxywsport         = '7577';
global.usepxymqttport       = '7578';

global.use_sgn_man_port     = '7599';
global.use_cnt_man_port     = '7583';
global.use_hit_man_port     = '7594';

global.usetsagentport       = '7582';

global.use_mqtt_broker      = 'localhost'; // mqttbroker for mobius

global.use_secure           = 'disable';
global.use_mqtt_port        = '1883';
if(use_secure === 'enable') {
    use_mqtt_port           = '8883';
}

global.useaccesscontrolpolicy = 'disable';

global.wdt = require('./wdt');


global.allowed_ae_ids = [];
//allowed_ae_ids.push('ryeubi');

global.allowed_app_ids = [];
//allowed_app_ids.push('APP01');

global.usesemanticbroker    = '10.10.202.114';

global.uservi = '2a';

global.useCert = 'disable';

// CSE core
require('./app');
