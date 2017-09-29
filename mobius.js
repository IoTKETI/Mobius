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

var fs = require('fs');

var data  = fs.readFileSync('conf.json', 'utf-8');
var conf = JSON.parse(data);

global.defaultnmtype        = 'short';
global.defaultbodytype      = 'json';

// my CSE information
global.usecsetype           = conf.csetype; // select 'in' or 'mn' or asn'
global.usecsebase           = conf.csebase;
global.usecseid             = conf.cseid;
global.usecsebaseport       = conf.csebaseport;

global.usedbhost            = conf.dbhost;
global.usedbuser            = conf.dbuser;
global.usedbpass            = conf.dbpass;
global.usedbname            = conf.dbname;

global.usepxymqttport       = conf.pxymqttport;
global.usepxycoapport       = conf.pxycoapport;
global.usepxywsport         = conf.pxywsport;
global.usetsagentport       = conf.tsagentport;

global.usemqttbroker        = conf.mqttbroker; // mqttbroker for mobius

global.usesecure            = conf.secure;

global.superadm_usr         = conf.superadm_usr;
global.superadm_pwd         = conf.superadm_pwd;
global.authorization        = conf.authorization;
global.logDir        		= conf.logDir;

if(usesecure === 'enable') {
    global.usemqttport      = '8883';
}
else {
    usemqttport             = '1883';
}

global.wdt = require('./wdt');

// CSE core
require('./app');
