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

global.defaultnmtype = 'short';
global.defaultbodytype = 'json';

global.usecbtype = 'in';
global.usecbname = 'mobius2';
global.usecbhost = '127.0.0.1';
global.usecbhostport = '8080';
global.usecbcseid = '0.2.481.1.1.1.1';

global.usecsebase = 'mobius';
global.usecseid = '0.2.481.1.1.1.1';
global.usecsebaseport = '7579';

global.usedbname = 'mysql';
//global.usedbname = 'mongodb';

global.usedbhost = '';
global.usedbpass = '';
global.usemqttbroker = 'localhost';
//global.usemqttproxyport = '9726';

global.conf_filename = 'conf.json';

// This is an async file read
fs.readFile(conf_filename, 'utf-8', function (err, data) {
    if (err) {
        NOPRINT == 'true' ? NOPRINT = 'true' : console.log("FATAL An error occurred trying to read in the file: " + err);
        NOPRINT == 'true' ? NOPRINT = 'true' : console.log("error : set to default for configuration")
    }
    else {
        var conf = JSON.parse(data)['m2m:conf'];

        usecbtype = 'in';
        defaultnmtype = 'short';

        usecsebase = conf['csebase'];
        usecsebaseport = conf['csebaseport'];
        usedbhost = conf['dbhost'];
        usedbpass = conf['dbpass'];
        usemqttbroker = conf['mqttbroker'];

        require('./app');
    }
});
