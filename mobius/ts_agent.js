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
 * @file Main code of Mobius Yellow. Role of flow router
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var fs = require('fs');
var http = require('http');
var https = require('https');
var mysql = require('mysql');
var express = require('express');
var bodyParser = require('body-parser');
var util = require('util');
var xml2js = require('xml2js');
var ip = require('ip');
var js2xmlparser = require('js2xmlparser');
var moment = require('moment');

var db = require('./db_action');
var db_sql = require('./sql_action');

// ������ �����մϴ�.
var ts_app = express();

if(use_secure == 'disable') {
    http.globalAgent.maxSockets = 1000000;
    http.createServer(ts_app).listen({port: usetsagentport, agent: false}, function () {
        console.log('ts_missing agent server (' + ip.address() + ') running at ' + usetsagentport + ' port');

        // Searching TS with missingDetect. if it is TRUE, restart mdt
        init_TS(function (rsc) {
            console.log('init_TS - ' + rsc);
        });
    });
}
else {
    var options = {
        key: fs.readFileSync('server-key.pem'),
        cert: fs.readFileSync('server-crt.pem'),
        ca: fs.readFileSync('ca-crt.pem')
    };
    https.globalAgent.maxSockets = 1000000;
    https.createServer(options, ts_app).listen({port: usetsagentport, agent: false}, function () {
        console.log('ts_missing agent server (' + ip.address() + ') running at ' + usetsagentport + ' port');

        // Searching TS with missingDetect. if it is TRUE, restart mdt
        init_TS(function (rsc) {
            console.log('init_TS - ' + rsc);
        });
    });
}

function init_TS(callback) {
    var ri = '/missingDataDetect';
    var rqi = require('shortid').generate();
    //var reqBodyString = '';
    var jsonObj = {ts:{}};
    jsonObj.ts.ri = 'all';
    var reqBodyString = JSON.stringify(jsonObj);

    var responseBody = '';

    var options = {
        hostname: 'localhost',
        port: usetsagentport,
        path: ri,
        method: 'post',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/vnd.onem2m-res+json',
            'X-M2M-RVI': uservi
        },
        rejectUnauthorized: false
    };

    if(use_secure == 'disable') {
        var req = http.request(options, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');

        req = https.request(options, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[init_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write(reqBodyString);
    req.end();
}


function search_TS(request, response, callback) {
    var ri = '/' + usecsebase + '?fu=1&ty=29';
    var rqi = require('shortid').generate();
    var responseBody = '';

    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: ri,
        method: 'get',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/json',
            'X-M2M-Origin': usecseid,
            'X-M2M-RVI': uservi
        },
        rejectUnauthorized: false
    };

    if(use_secure == 'disable') {
        var req = http.request(options, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(request, response, res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }
    else {
        options.ca = fs.readFileSync('ca-crt.pem');

        req = https.request(options, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });

            res.on('end', function () {
                callback(request, response, res.headers['x-m2m-rsc'], responseBody);
            });
        });
    }

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[search_TS] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write('');
    req.end();
}


var onem2mParser = bodyParser.text(
    {
        limit: '1mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);

var ts_timer = {};
var ts_timer_id = {};

var missing_detect_check = function(connection, pei, mdd, mdt, cni, ri, callback) {
    var rsc = {};
    rsc.status = 2000;
    if((pei != null && pei != '' && pei != '0') && (mdd != null && mdd == 'TRUE') && mdt != '0') {
        if(ts_timer[ri] == null) {
            //ts_timer[ri] = new process.EventEmitter();
            var events = require('events');
            ts_timer[ri] = new events.EventEmitter();
            ts_timer[ri].on(ri, function () {
                db_sql.select_ts(connection, ri, function (err, results) {
                    if (results.length == 1) {
                        console.log(results[0].ri);
                        var new_cni = results[0]['cni'];
                        if (parseInt(new_cni, 10) == parseInt(cni, 10)) {
                            if (parseInt(results[0].mdc, 10) <= parseInt(results[0].mdn, 10)) {
                                var cur_d = new Date();
                                var timestamp = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
                                var mdlt = timestamp + ' ' + results[0].mdlt;
                                var mdc = (parseInt(results[0].mdc, 10) + 1).toString();
                                console.log(mdc, mdlt);
                                db_sql.update_ts_mdcn_mdl(connection, mdc, mdlt, ri, function (err, results) {
                                    if (!err) {
                                    }
                                    else {
                                        console.log('query error: ' + results.message);
                                    }
                                });
                            }
                            else {
                                if(ts_timer_id[ri] != null) {
                                    clearInterval(ts_timer_id[ri]);
                                    delete ts_timer_id[ri];
                                }
                            }
                        }
                        cni = new_cni;
                    }
                });
            });
        }

        if(ts_timer_id[ri] == null) {
            ts_timer_id[ri] = setInterval(function () {
                ts_timer[ri].emit(ri);
            }, (parseInt(mdt) * 1000));
            rsc.status = 2000;
            rsc.ri = ri;
            callback(rsc);
        }
        else if(ts_timer_id[ri] != null) {
            clearInterval(ts_timer_id[ri]);
            ts_timer_id[ri] = setInterval(function () {
                ts_timer[ri].emit(ri);
            }, (parseInt(mdt)*1000));
            rsc.status = 2000;
            rsc.ri = ri;
            callback(rsc);
        }
        else {
            rsc.status = 2001;
            rsc.ri = ri;
            callback(rsc);
        }
    }
    else {
        if(ts_timer_id[ri] != null) {
            clearInterval(ts_timer_id[ri]);
            delete ts_timer_id[ri];
        }

        rsc.status = 2001;
        rsc.ri = ri;
        callback(rsc);
    }
};


//
ts_app.post('/missingDataDetect', onem2mParser, function(request, response) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;

        db.getConnection(function (code, connection) {
            if(code === '200') {
                request.connection = connection;

                var jsonObj = JSON.parse(request.body);
                if (jsonObj.ts.ri == 'all') {
                    search_TS(request, response, function (request, response, rsc, responseBody) {
                        //console.log(rsc);
                        //console.log(responseBody);

                        var jsonObj = JSON.parse(responseBody);
                        var ts_ri = [];
                        if (jsonObj['m2m:dbg']) {
                            ts_ri = [];
                        }
                        else if (jsonObj['m2m:uril']) {
                            if (jsonObj['m2m:uril'].hasOwnProperty('_')) {
                                ts_ri = jsonObj['m2m:uril']['_'].toString().split(' ');
                            }
                            else {
                                ts_ri = [];
                            }
                        }

                        var ts = {};
                        if (ts_ri.length >= 1) {
                            db_sql.select_ts_in(request.connection, ts_ri, function (err, results_ts) {
                                if (!err) {
                                    if (results_ts.length >= 1) {
                                        missing_detect_check(request.connection, results_ts[0].pei, results_ts[0].mdd, results_ts[0].mdt, results_ts[0].cni, results_ts[0].ri, function (rsc) {
                                            console.log(rsc);
                                            request.connection.release();
                                        });
                                    }
                                }

                                response.header('X-M2M-RSC', '2000');

                                ts.status = '2000';
                                ts.ri = jsonObj['m2m:uril']['_'];
                                response.status(200).end(JSON.stringify(ts));
                            });
                        }
                        else {
                            request.connection.release();
                            response.header('X-M2M-RSC', '4004');
                            ts.status = '4004';
                            ts.ri = '';
                            response.status(404).end(JSON.stringify(ts));
                        }
                    });
                }
                else {
                    db_sql.select_ts(request.connection, jsonObj.ts.ri, function (err, results_ts) {
                        if (!err) {
                            if (results_ts.length == 1) {
                                missing_detect_check(request.connection, results_ts[0].pei, results_ts[0].mdd, results_ts[0].mdt, results_ts[0].cni, results_ts[0].ri, function (rsc) {
                                    request.connection.release();
                                    console.log(rsc.status + ' - ' + rsc.ri);
                                    response.header('X-M2M-RSC', '2000');
                                    response.status(200).end(JSON.stringify(rsc));
                                });
                            }
                        }
                    });
                }
            }
            else {
                console.log('[ts_app.post] - /missingDataDetect - No Connection');
                response.header('X-M2M-RSC', '5000');
                ts.status = '4004';
                ts.ri = '';
                response.status(404).end("[ts_app.post] No Connection to DB");
            }
        });
    });
});


ts_app.delete('/missingDataDetect', onem2mParser, function(request, response) {
    var fullBody = '';
    request.on('data', function(chunk) {
        fullBody += chunk.toString();
    });
    request.on('end', function() {
        request.body = fullBody;
        if(request.body === '') {
        }
        else {
            var jsonObj = JSON.parse(request.body);
            var ri = jsonObj.ts.ri;
            if (ts_timer[ri] != null) {
                ts_timer[ri].removeAllListeners(ri);
                delete ts_timer[ri];
            }

            if (ts_timer_id[ri] != null) {
                clearInterval(ts_timer_id[ri]);
                delete ts_timer_id[ri];
            }
        }

        var rsc = {};
        rsc.status = 2000;
        rsc.ri = request.url;
        console.log(rsc.status + ' - ' + rsc.ri);
        response.header('X-M2M-RSC', '2000');
        response.status(200).end(JSON.stringify(rsc));
    });
});
