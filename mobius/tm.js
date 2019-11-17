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

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var responder = require('./responder');
var http = require('http');
var https = require('https');
var fs = require('fs');

var db_sql = require('./sql_action');

var _this = this;

global.tmd_v = {};
tmd_v.CSE_CONTROLLED = '1';
tmd_v.CREATOR_CONTROLLED = '2';

global.tltp_v = {};
tltp_v.BLOCK_ALL = '1';
tltp_v.ALLOW_RETRIEVES = '2';

var tmh_v = {};
tmh_v.DELETE = '1';
tmh_v.PERSIST = '2';

exports.build_tm = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].cr = (body_Obj[rootnm].cr) ? body_Obj[rootnm].cr : request.headers['x-m2m-origin'];

    resource_Obj[rootnm].rqps = body_Obj[rootnm].rqps;

    resource_Obj[rootnm].tctl = (body_Obj[rootnm].tctl) ? body_Obj[rootnm].tctl : tctl_v.INITIAL; // INITIAL
    resource_Obj[rootnm].tst = (body_Obj[rootnm].tst) ? body_Obj[rootnm].tst : tst_v.INITIAL;

    resource_Obj[rootnm].tltm = (body_Obj[rootnm].tltm) ? body_Obj[rootnm].tltm : '';
    resource_Obj[rootnm].text = (body_Obj[rootnm].text) ? body_Obj[rootnm].text : '';
    resource_Obj[rootnm].tct = (body_Obj[rootnm].tct) ? body_Obj[rootnm].tct : '';
    resource_Obj[rootnm].tept = (body_Obj[rootnm].tept) ? body_Obj[rootnm].tept : '';
    resource_Obj[rootnm].tmd = (body_Obj[rootnm].tmd) ? body_Obj[rootnm].tmd : tmd_v.CSE_CONTROLLED;
    resource_Obj[rootnm].tltp = (body_Obj[rootnm].tltp) ? body_Obj[rootnm].tltp : tltp_v.BLOCK_ALL; // BLOCK_ALL
    resource_Obj[rootnm].tmr = (body_Obj[rootnm].tmr) ? body_Obj[rootnm].tmr : '0';
    resource_Obj[rootnm].tmh = (body_Obj[rootnm].tmh) ? body_Obj[rootnm].tmh : tmh_v.DELETE;

    resource_Obj[rootnm].rsps = (body_Obj[rootnm].rsps) ? body_Obj[rootnm].rsps : '[]';

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};

function rsps_action(connection, ri, rsps) {
    console.log('rsps_action'); //callback(res.headers['x-m2m-rsc'], resBody);
    console.log(rsps);
/*
    if (res.statusCode == 201 || res.statusCode == 200) {
        var tst_value = tst_v.EXECUTED;
    }
    else {
        tst_value = tst_v.ERROR;
    }

    if (bodytype === 'xml') {
        try {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(resBody, function (err, body_Obj) {
                store_trsp(ri, tst_value, res, body_Obj);
            });
        }
        catch (e) {
            store_trsp(ri, tst_v.ERROR, res, e.message);
        }
    }
    else if (bodytype === 'cbor') {
    }
    else {
        try {
            var body_Obj = JSON.parse(resBody.toString());
            store_trsp(ri, tst_value, res, body_Obj);
        }
        catch (e) {
            store_trsp(ri, tst_v.ERROR, res, e.message);
        }
    }
    */
}

function store_trsp(connection, ri, tst_value, res, bodyObj) {
    var trsp_primitive = {};
    trsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
    trsp_primitive.rqi = res.headers['x-m2m-ri'];
    trsp_primitive.pc = bodyObj;

    db_sql.update_tr_trsp(connection, ri, tst_value, JSON.stringify(trsp_primitive), function (err) {
        if(!err) {
            console.log('store_trsp success');
        }
        else {
            console.log('store_trsp fail');
        }
    });
}

exports.request_lock = function(obj, retry_count, callback) {
    var resource_Obj = obj[Object.keys(obj)[0]];
    var ri = resource_Obj.ri;
    var rqps = resource_Obj.rqps;
    var tmr = parseInt(resource_Obj.tmr, 10);
    var request_count = 0;
    var rsps = [];
    var resBody = '';

    for(var idx in rqps) {
        if (rqps.hasOwnProperty(idx)) {
            var rqi = require('shortid').generate();
            var content_type = 'application/json; ty=39';
            var bodytype = 'json';
            var op = 'post';
            var reqBodyString = JSON.stringify(rqps[idx].pc);


            if (rqps[idx].to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
                rqps[idx].to = rqps[idx].to.replace(usespid + usecseid + '/', '/');
            }
            else if (rqps[idx].to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
                rqps[idx].to = rqps[idx].to.replace(usecseid + '/', '/');
            }
            else if (rqps[idx].to.split(usecsebase)[0] == '') { // cse relative
                rqps[idx].to = '/' + rqps[idx].to;
            }

            var options = {
                hostname: 'localhost',
                port: usecsebaseport,
                path: rqps[idx].to,
                method: op,
                headers: {
                    'X-M2M-RI': rqi,
                    'Accept': 'application/json',
                    'X-M2M-Origin': rqps[idx].fr,
                    'Content-Type': content_type,
                    'X-M2M-RVI': uservi
                }
            };

            if (use_secure == 'disable') {
                var req = http.request(options, function (res) {
                    res.on('data', function (chunk) {
                        resBody += chunk;
                    });

                    res.on('end', function () {
                        res.body = resBody;
                        resBody = '';
                        request_count++;

                        var rsp_primitive = {};
                        rsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                        rsp_primitive.rqi = res.headers['x-m2m-ri'];
                        rsp_primitive.pc = JSON.parse(res.body.toString());
                        rsps.push(rsp_primitive);
                        if(request_count >= rqps.length) {
                            retry_count++;
                            var check_rsps = 0;
                            for(var idx in rsps) {
                                if(rsps.hasOwnProperty(idx)) {
                                    if (rsps[idx].rsc == 2001) {
                                        check_rsps++;
                                    }
                                    else {
                                        check_rsps = 0;
                                        break;
                                    }
                                }
                            }

                            if(check_rsps == 0) {
                                if(retry_count >= tmr) {
                                    callback('0', obj);
                                }
                                else {
                                    _this.request_lock(obj, retry_count, function (rsc, obj, rsps) {
                                        callback(rsc, obj, rsps);
                                    });
                                }
                            }
                            else {

                                callback('1', obj, rsps);
                            }
                        }
                    });
                });
            }
            else {
                options.ca = fs.readFileSync('ca-crt.pem');

                req = https.request(options, function (res) {
                    res.on('data', function (chunk) {
                        resBody += chunk;
                    });

                    res.on('end', function () {
                        res.body = resBody;
                        resBody = '';
                        request_count++;

                        var rsp_primitive = {};
                        rsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                        rsp_primitive.rqi = res.headers['x-m2m-ri'];
                        rsp_primitive.pc = JSON.parse(res.body.toString());
                        rsps.push(rsp_primitive);
                        if(request_count >= rqps.length) {
                            retry_count++;
                            var check_rsps = 0;
                            for(var idx in rsps) {
                                if(rsps.hasOwnProperty(idx)) {
                                    if (rsps[idx].rsc == 2001) {
                                        check_rsps++;
                                    }
                                    else {
                                        check_rsps = 0;
                                        break;
                                    }
                                }
                            }

                            if(check_rsps == 0) {
                                if(retry_count >= tmr) {
                                    callback('0', obj, rsps);
                                }
                                else {
                                    _this.request_lock(obj, retry_count, function (rsc, obj, rsps) {
                                        callback(rsc, obj, rsps);
                                    });
                                }
                            }
                            else {

                                callback('1', obj, rsps);
                            }
                        }
                    });
                });
            }

            req.on('error', function (e) {
                if (e.message != 'read ECONNRESET') {
                    console.log('[delete_TS] problem with request: ' + e.message);
                }

                request_count++;
                if(request_count >= rqps.length) {
                    retry_count++;
                    if(retry_count >= tmr) {
                        callback('0', obj);
                    }
                    else {
                        _this.request_lock(obj, retry_count, function (rsc, obj, rsps) {
                            callback(rsc, obj, rsps);
                        });
                    }
                }
            });

            // write data to request body
            req.write(reqBodyString);
            req.end();
        }
    }
};


function request_tctl(obj, retry_count, tctl, callback) {
    var resource_Obj = obj[Object.keys(obj)[0]];
    var ri = resource_Obj.ri;
    var rqps = resource_Obj.rqps;
    var tmr = parseInt(resource_Obj.tmr, 10);
    var request_count = 0;
    var rsps = [];
    var resBody = '';

    for(var idx in rqps) {
        if (rqps.hasOwnProperty(idx)) {
            var rqi = require('shortid').generate();
            var content_type = 'application/json';
            var bodytype = 'json';
            var op = 'put';
            var rn = rqps[idx].pc['m2m:tr'].rn;
            rqps[idx].pc['m2m:tr'] = {};
            rqps[idx].pc['m2m:tr'].tctl = tctl;
            var reqBodyString = JSON.stringify(rqps[idx].pc);

            if (rqps[idx].to.split(usespid + usecseid + '/')[0] == '') { // absolute relative
                rqps[idx].to = rqps[idx].to.replace(usespid + usecseid + '/', '/');
            }
            else if (rqps[idx].to.split(usecseid + '/' + usecsebase + '/')[0] == '') { // sp relative
                rqps[idx].to = rqps[idx].to.replace(usecseid + '/', '/');
            }
            else if (rqps[idx].to.split(usecsebase)[0] == '') { // cse relative
                rqps[idx].to = '/' + rqps[idx].to;
            }

            var options = {
                hostname: 'localhost',
                port: usecsebaseport,
                path: rqps[idx].to + '/' + rn,
                method: op,
                headers: {
                    'X-M2M-RI': rqi,
                    'Accept': 'application/json',
                    'X-M2M-Origin': rqps[idx].fr,
                    'Content-Type': content_type,
                    'X-M2M-RVI': uservi
                }
            };

            if (use_secure == 'disable') {
                var req = http.request(options, function (res) {
                    res.on('data', function (chunk) {
                        resBody += chunk;
                    });

                    res.on('end', function () {
                        res.body = resBody;
                        resBody = '';
                        request_count++;

                        var rsp_primitive = {};
                        rsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                        rsp_primitive.rqi = res.headers['x-m2m-ri'];
                        rsp_primitive.pc = JSON.parse(res.body.toString());
                        rsps.push(rsp_primitive);
                        if(request_count >= rqps.length) {
                            retry_count++;
                            var check_rsps = 0;
                            for(var idx in rsps) {
                                if(rsps.hasOwnProperty(idx)) {
                                    if (rsps[idx].rsc == 2004) {
                                        check_rsps++;
                                    }
                                    else {
                                        check_rsps = 0;
                                        break;
                                    }
                                }
                            }

                            if(check_rsps == 0) {
                                if(retry_count >= tmr) {
                                    callback('0', obj, rsps);
                                }
                                else {
                                    request_tctl(obj, retry_count, tctl, function (rsc, obj, rsps) {
                                        callback(rsc, obj, rsps);
                                    });
                                }
                            }
                            else {
                                callback('1', obj, rsps);
                            }
                        }
                    });
                });
            }
            else {
                options.ca = fs.readFileSync('ca-crt.pem');

                req = https.request(options, function (res) {
                    res.on('data', function (chunk) {
                        resBody += chunk;
                    });

                    res.on('end', function () {
                        res.body = resBody;
                        resBody = '';
                        request_count++;

                        var rsp_primitive = {};
                        rsp_primitive.rsc = parseInt(res.headers['x-m2m-rsc']); // convert to int
                        rsp_primitive.rqi = res.headers['x-m2m-ri'];
                        rsp_primitive.pc = JSON.parse(res.body.toString());
                        rsps.push(rsp_primitive);
                        if(request_count >= rqps.length) {
                            retry_count++;
                            var check_rsps = 0;
                            for(var idx in rsps) {
                                if(rsps.hasOwnProperty(idx)) {
                                    if (rsps[idx].rsc == 2001) {
                                        check_rsps++;
                                    }
                                    else {
                                        check_rsps = 0;
                                        break;
                                    }
                                }
                            }

                            if(check_rsps == 0) {
                                if(retry_count >= tmr) {
                                    callback('0', obj);
                                }
                                else {
                                    request_tctl(obj, retry_count, tctl, function (rsc, obj, rsps) {
                                        callback(rsc, obj, rsps);
                                    });
                                }
                            }
                            else {

                                callback('1', obj, rsps);
                            }
                        }
                    });
                });
            }

            req.on('error', function (e) {
                if (e.message != 'read ECONNRESET') {
                    console.log('[delete_TS] problem with request: ' + e.message);
                }

                request_count++;
                if(request_count >= rqps.length) {
                    retry_count++;
                    if(retry_count >= tmr) {
                        callback('0', obj);
                    }
                    else {
                        request_tctl(obj, retry_count, tctl, function (rsc, obj, rsps) {
                            callback(rsc, obj, rsps);
                        });
                    }
                }
            });

            // write data to request body
            req.write(reqBodyString);
            req.end();
        }
    }
}


exports.request_execute = function(obj, retry_count, callback) {
    request_tctl(obj, retry_count, tctl_v.EXECUTE, function (rsc, obj, rsps) {
        callback(rsc, obj, rsps);
    });
};

exports.request_commit = function(obj, retry_count, callback) {
    request_tctl(obj, retry_count, tctl_v.COMMIT, function (rsc, obj, rsps) {
        callback(rsc, obj, rsps);
    });
};

exports.request_abort = function(obj, retry_count, callback) {
    request_tctl(obj, retry_count, tctl_v.ABORT, function (rsc, obj, rsps) {
        callback(rsc, obj, rsps);
    });
};
