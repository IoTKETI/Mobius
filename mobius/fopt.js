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

var util = require('util');
var url = require('url');
var http = require('http');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var moment = require('moment');

var responder = require('./responder');
var resource = require('./resource');

var db_sql = require('./sql_action');

function check_body(res, body_type, res_body, callback) {
    var retrieve_Obj = {};

    if (body_type == 'xml') {
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(res_body, function (err, result) {
            if (!err) {
                for (var prop in result) {
                    if(result.hasOwnProperty(prop)) {
                        if (result[prop]['$'] != null) {
                            if (result[prop]['$'].rn != null) {
                                result[prop].rn = result[prop]['$'].rn;
                            }
                            delete result[prop]['$'];
                        }
                        retrieve_Obj.fr = res.req.path;
                        retrieve_Obj.rsc = res.headers['x-m2m-rsc'];
                        retrieve_Obj.pc = result;
                    }
                }
                callback('1', retrieve_Obj);
                return '1';
            }
            else {
                callback('0');
                return '0';
            }
        });
    }
    else { // json
        var result = JSON.parse(res_body);
        if(res.req.path.charAt(0) == '/') {
            retrieve_Obj.fr = res.req.path.replace('/', '');
        }
        else {
            retrieve_Obj.fr = res.req.path;
        }

        if(res.headers.hasOwnProperty('x-m2m-rsc')) {
            retrieve_Obj.rsc = res.headers['x-m2m-rsc'];
        }

        if(res.headers.hasOwnProperty('x-m2m-ri')) {
            retrieve_Obj.rqi = res.headers['x-m2m-ri'];
        }

        if(res.headers.hasOwnProperty('x-m2m-rvi')) {
            retrieve_Obj.rvi = res.headers['x-m2m-rvi'];
        }

        retrieve_Obj.pc = result;
        callback('1', retrieve_Obj);
        return '1';
    }
}

function request_to_member(request, hostname, port, ri, agr, callback) {
    var ri_prefix = request.url.split('/fopt')[1];

    var options = {
        hostname: hostname,
        port: port,
        path: ri + ri_prefix,
        method: request.method,
        headers: request.headers
    };

    var responseBody = '';
    var req = http.request(options, function (res) {
        //res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        res.on('end', function () {
            check_body(res, request.usebodytype, responseBody, function (rsc, retrieve_Obj) {
                if (rsc == '1') {
                    agr[retrieve_Obj.fr] = JSON.parse(JSON.stringify(retrieve_Obj));
                    retrieve_Obj = null;

                    callback('200');
                }
            });
        });
    });

    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[fopt_member] problem with request: ' + e.message);
        }

        callback('200');
    });

    req.write(request.body);
    req.end();
}

function fopt_member(request, response, req_count, mid, body_Obj, cse_poa, agr, callback) {
    if(req_count >= mid.length) {
        callback('200');
    }
    else {
        var ri_prefix = request.url.split('/fopt')[1];
        var ri = mid[req_count];
        db_sql.get_ri_sri(request.connection, ri, function (err, results) {
            if(!err) {
                ri = ((results.length == 0) ? ri : results[0].ri);
                var target_cb = ri.split('/')[1];
                var hostname = 'localhost';
                var port = usecsebaseport;

                if (target_cb != usecsebase) {
                    if (cse_poa[target_cb]) {
                        hostname = url.parse(cse_poa[target_cb]).hostname;
                        port = url.parse(cse_poa[target_cb]).port;
                        request_to_member(request, hostname, port, ri, agr, function (code) {
                            if(code === '200') {
                                fopt_member(request, response, req_count, mid, body_Obj, cse_poa, agr, function (code) {
                                    callback(code);
                                });
                            }
                            else {
                                callback(code);
                            }
                        });
                    }
                    else {
                        fopt_member(request, response, ++req_count, mid, body_Obj, cse_poa, agr, function (code) {
                            callback(code);
                        });
                    }
                }
                else {
                    request_to_member(request, hostname, port, ri, agr, function (code) {
                        if(code === '200') {
                            fopt_member(request, response, ++req_count, mid, body_Obj, cse_poa, agr, function (code) {
                                callback(code);
                            });
                        }
                        else {
                            callback(code);
                        }
                    });
                }
            }
            else {
                fopt_member(request, response, ++req_count, mid, body_Obj, cse_poa, agr, function (code) {
                    callback(code);
                });
            }
        });
    }
}


exports.check = function(request, response, grp, body_Obj, callback) {
    request.headers.rootnm = 'agr';
    var cse_poa = {};
    update_route(request.connection, cse_poa, function (code) {
        if(code === '200') {
            var ri_list = [];
            get_ri_list_sri(request, response, grp.mid, ri_list, 0, function (code) {
                if(code === '200') {
                    var req_count = 0;
                    var agr = {};
                    make_internal_ri(ri_list);
                    fopt_member(request, response, req_count, ri_list, body_Obj, cse_poa, agr, function (code) {
                        if(code == '200') {
                            var retrieve_Obj = agr;
                            if (Object.keys(retrieve_Obj).length != 0) {
                                request.resourceObj = JSON.parse(JSON.stringify(retrieve_Obj));
                                retrieve_Obj = null;

                                callback('200');
                            }
                            else {
                                callback('404-5');
                            }
                        }
                    });
                }
                else {
                    callback(code);
                }
            });
        }
        else {
            callback(code);
        }
    });
};

