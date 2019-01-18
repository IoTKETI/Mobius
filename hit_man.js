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
var http = require('http');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var moment = require('moment');
var ip = require("ip");

var hit_cache = {};

var hit_app = express();

var hit_server = null;

if(use_secure === 'disable') {
    if(hit_server == null) {
        http.globalAgent.maxSockets = 10000;
        hit_server = http.createServer(hit_app);
    }
}
else {
    if(hit_server == null) {
        var options = {
            key: fs.readFileSync('server-key.pem'),
            cert: fs.readFileSync('server-crt.pem'),
            ca: fs.readFileSync('ca-crt.pem')
        };
        https.globalAgent.maxSockets = 10000;
        hit_server = https.createServer(options, hit_app);
    }
}

hit_server.listen({port: use_hit_man_port, agent: false}, function () {
    console.log('hit_man server (' + ip.address() + ') running at ' + use_hit_man_port + ' port');

    try {
        var hitStr = fs.readFileSync('hit.json', 'utf8');
        hit_cache = JSON.parse(hitStr);

        var moment = require('moment');
        var a = moment().utc();
        var cur_t = a.format('YYYYMMDD');
        if (!hit_cache.hasOwnProperty(cur_t)) {
            hit_cache[cur_t] = [];
            for (var h = 0; h < 24; h++) {
                hit_cache[cur_t].push({});
            }
        }
    }
    catch (e) {
        moment = require('moment');
        a = moment().utc();
        cur_t = a.format('YYYYMMDD');
        if (!hit_cache.hasOwnProperty(cur_t)) {
            hit_cache[cur_t] = [];
            for (h = 0; h < 24; h++) {
                hit_cache[cur_t].push({});
            }
        }
    }
});

hit_server.on('connection', function (socket) {
    //console.log("A new connection was made by a client.");
    socket.setTimeout(1000, function () {
    });
});

// for notification
var onem2mParser = bodyParser.text(
    {
        limit: '1mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);

hit_app.post('/hit', onem2mParser, function(request, response, next) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;

        try {
            var _hit = JSON.parse(request.body);

            var a = moment().utc();
            var cur_t = a.format('YYYYMMDD');
            var h = a.hours();

            if (hit_cache.hasOwnProperty(cur_t)) {
                hit_cache[cur_t][h][_hit.binding]++;
            }
            else {
                hit_cache[cur_t] = [];
                for (var i = 0; i < 24; i++) {
                    _hit[cur_t].push({});
                }
                hit_cache[cur_t][h][_hit.binding]++;
            }

            fs.writeFileSync('hit.json', JSON.stringify(hit_cache, null, 4), 'utf8');
            response.status(201).end('');
        }
        catch (e) {
            console.log('[updateHitCount] ' + e.message);
        }
    });
});
