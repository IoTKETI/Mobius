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
 * @file Main code of Mobius Yellow. Role of flow router
 * @copyright KETI Korea 2015, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var fs = require('fs');
var http = require('http');
var mysql = require('mysql');
var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var util = require('util');
var xml2js = require('xml2js');
var url = require('url');
var xmlbuilder = require('xmlbuilder');
var js2xmlparser = require("js2xmlparser");
var ip = require('ip');
const crypto = require('crypto');
var FileStreamRotator = require('file-stream-rotator');
var merge = require('merge');
var https = require('https');

global.defaultnmtype = 'short';
global.defaultbodytype = 'xml';

global.usecsebase = 'mobius2';
global.usecsebaseport = '127.0.0.1';

global.usecbname = 'mobius2';
global.usecbhost = '127.0.0.1';
global.usecbhostport = '8080';
global.usecbid = '0.2.481.1.1.1.1';

global.usedbname = 'mysql';
//global.usedbname = 'mongodb';

global.conf_filename = 'conf_mn.json';

var mn = require('./mobius/mn');

var db = require('./mobius/db_action');



// ������ �����մϴ�.
var app = express();

// This is an async file read
fs.readFile(conf_filename, 'utf-8', function (err, data) {
    if (err) {
        NOPRINT == 'true' ? NOPRINT = 'true' : console.log("FATAL An error occurred trying to read in the file: " + err);
        NOPRINT == 'true' ? NOPRINT = 'true' : console.log("error : set to default for configuration")
    }
    else {
        var conf = JSON.parse(data)['m2m:conf'];

        usecsebase = conf['csebase'];
        usecsebaseport = conf['csebaseport'];
        usedbhost = conf['dbhost'];
        usedbpass = conf['dbpass'];

        db.connect(usedbhost, 3306, 'root', usedbpass, function (rsc) {
            if(rsc == '1') {
                var in_cse = conf['in-cse'];

                usecbhost = in_cse['cbhost'];
                usecbhostport = in_cse['cbhostport'];
                usecbname = in_cse['cbname'];
                usecbid = in_cse['cbid'];

                mn.build_mn('/'+usecbname, function (rsp) {
                    console.log(rsp);
                    process.exit();
                });
            }
        });
    }
});
