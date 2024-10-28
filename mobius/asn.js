/**
 * Copyright (c) 2024, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2024, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var http = require('http');
var util = require('util');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var fs = require('fs');
var url = require('url');
var moment = require('moment');
var merge = require('merge');

var db = require('./db_action');
var db_sql = require('./sql_action');

_this = this;

function retrieve_CSEBase_http(cbname, cbhost, cbhostport, callback) {
    var ri = '/' + cbname;
    var rqi = require('shortid').generate();
    var options = {
        hostname: cbhost,
        port: cbhostport,
        path: ri,
        method: 'get',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': use_cb_id,
            'X-M2M-RVI': use_rvi
        }
    };

    var req = http.request(options, function (res) {
        var fullBody = '';
        res.on('data', function(chunk) {
            fullBody += chunk.toString();
        });

        res.on('end', function () {
            if (res.statusCode == 200) {
                var jsonObj = {};
                jsonObj = JSON.parse(fullBody);
                jsonObj.csr = jsonObj['m2m:cb'];
                delete jsonObj['m2m:cb'];

                for(var idx in jsonObj.csr) {
                    if(jsonObj.csr.hasOwnProperty(idx)) {
                        if (jsonObj.csr[idx] == null || jsonObj.csr[idx] == '' || jsonObj.csr[idx] == 'undefined' || jsonObj.csr[idx] == '[]') {
                            delete jsonObj.csr[idx];
                        }
                    }
                }

                delete jsonObj.csr.ty;
                delete jsonObj.csr.ri;
                delete jsonObj.csr.ct;
                delete jsonObj.csr.lt;
                delete jsonObj.csr.st;
                delete jsonObj.csr.srt;

                jsonObj.csr.cst = '5';
                jsonObj.csr.rr = 'true';
                jsonObj.csr.cb = jsonObj.csr.rn;

                callback(res.statusCode, jsonObj);
            }
            else {

            }
        });
    });

    req.on('error', function (e) {
        console.log('[retrieve_CSEBase_http - mn] problem with request: ' + e.message);
        callback('0', {});
    });

    // write data to request body
    req.write('');
    req.end();
}

function create_remoteCSE_http(cbname, cbhost, cbhostport, body_Obj, callback) {
    var rootnm = 'csr';

    body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
    delete body_Obj[Object.keys(body_Obj)[0]];

    var bodyString = JSON.stringify(body_Obj);

    var rqi = require('shortid').generate();
    var ri = '/' + cbname;
    var options = {
        hostname: cbhost,
        port: cbhostport,
        path: ri,
        method: 'post',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': use_cb_id,
            'Content-Type': 'application/'+defaultbodytype+';ty=16',
            'csr': 'self',
            'X-M2M-RVI': use_rvi
        }
    };

    var req = http.request(options, function (res) {
        var fullBody = '';
        res.on('data', function(chunk) {
            fullBody += chunk.toString();
        });
        res.on('end', function() {
            callback(res.statusCode);
        });
    });

    req.on('error', function (e) {
        console.log('[create_remoteCSE_http - mn] problem with request: ' + e.message);
        callback('0', {});
    });

    // write data to request body
    req.write(bodyString);
    req.end();
}

exports.build_asn = function(connection, ri, callback) {
    // check remotecse if parent cse exist
    var rspObj = {};
    db_sql.select_lookup(connection, ri, function (err, results_comm) {
        if(!err) {
            if (results_comm.length == 1) {
                db_sql.select_cb(connection, ri, function (err, results_cb) {
                    if(!err) {
                        if (results_cb.length == 1) {
                            rspObj.csr = {};
                            rspObj.csr = merge(results_comm[0], results_cb[0]);

                            for(var idx in rspObj.csr) {
                                if(rspObj.csr.hasOwnProperty(idx)) {
                                    if (rspObj.csr[idx] == null || rspObj.csr[idx] == '' || rspObj.csr[idx] == 'undefined' || rspObj.csr[idx] == '[]') {
                                        delete rspObj.csr[idx];
                                    }
                                }
                            }

                            delete rspObj.csr.ty;
                            delete rspObj.csr.ri;
                            delete rspObj.csr.ct;
                            delete rspObj.csr.lt;
                            delete rspObj.csr.st;

                            rspObj.csr.cst = '5';
                            rspObj.csr.rr = 'true';
                            rspObj.csr.cb = rspObj.csr.rn;

                            if (rspObj.csr.poa) {
                                rspObj.csr.poa = JSON.parse(rspObj.csr.poa);
                            }

                            if (rspObj.csr.lbl) {
                                rspObj.csr.lbl = JSON.parse(rspObj.csr.lbl);
                            }

                            if (rspObj.csr.acpi) {
                                rspObj.csr.acpi = JSON.parse(rspObj.csr.acpi);
                            }

                            if (rspObj.csr.subl) {
                                rspObj.csr.subl = JSON.parse(rspObj.csr.subl);
                            }

                            if (rspObj.csr.srt) {
                                rspObj.csr.srt = JSON.parse(rspObj.csr.srt);
                                delete rspObj.csr.srt;
                            }
                            
                            if(parent_cbprotocol == 'http') {
                                create_remoteCSE_http(parent_cbname, parent_cbhost, parent_cbhostport, rspObj, function (rsc) {
                                    if (rsc == 200 || rsc == 201 || rsc == 403 || rsc == 409) {
                                        retrieve_CSEBase_http(parent_cbname, parent_cbhost, parent_cbhostport, function (rsc, jsonObj) {
                                            if (rsc == 200 || rsc == 201 || rsc == 403 || rsc == 409) {
                                                create_remoteCSE_http(use_cb_name, 'localhost', use_cb_port, jsonObj, function (rsc) {
                                                    if (rsc == 200 || rsc == 201 || rsc == 403 || rsc == 409) {
                                                        rspObj = {};
                                                        rspObj.rsc = '2000';
                                                        rspObj.ri = ri;
                                                        rspObj.dbg = "mn-cse setting success";
                                                        callback(rspObj);
                                                    }
                                                    else {
                                                        rspObj.rsc = '5000';
                                                        rspObj.ri = ri;
                                                        rspObj.dbg = "mn-cse setting fail";
                                                        callback(rspObj);
                                                    }
                                                });
                                            }
                                        });
                                    }
                                    else {
                                        console.log('ASN : response status code error for create remoteCSE : ' + rsc);
                                        rspObj = {};
                                        rspObj.rsc = '5000';
                                        rspObj.ri = ri;
                                        rspObj.dbg = results_cb.message;
                                        callback(rspObj);
                                    }
                                });
                            }
                            else { // parent_cbprotocol == 'mqtt'
                                create_remoteCSE_mqtt(parent_cbcseid, parent_cbname, rspObj, function (rsc) {
                                    if (rsc == 200 || rsc == 201 || rsc == 403 || rsc == 409) {
                                        retrieve_CSEBase_mqtt(parent_cbcseid, parent_cbname, function (rsc, jsonObj) {
                                            if (rsc == 200 || rsc == 201 || rsc == 403 || rsc == 409) {
                                                create_remoteCSE_mqtt(use_cb_id, use_cb_name, jsonObj, function (rsc) {
                                                    if (rsc == 200 || rsc == 201 || rsc == 403 || rsc == 409) {
                                                        rspObj = {};
                                                        rspObj.rsc = '2000';
                                                        rspObj.ri = ri;
                                                        rspObj.dbg = "mn-cse setting success";
                                                        callback(rspObj);
                                                    }
                                                    else {
                                                        rspObj.rsc = '5000';
                                                        rspObj.ri = ri;
                                                        rspObj.dbg = "mn-cse setting fail";
                                                        callback(rspObj);
                                                    }
                                                });
                                            }
                                        });
                                    }
                                    else {
                                        console.log('ASN : response status code error for create remoteCSE : ' + rsc);
                                        rspObj = {};
                                        rspObj.rsc = '5000';
                                        rspObj.ri = ri;
                                        rspObj.dbg = results_cb.message;
                                        callback(rspObj);
                                    }
                                });
                            }
                        }
                    }
                    else {
                        rspObj = {};
                        rspObj.rsc = '5000';
                        rspObj.ri = ri;
                        rspObj.dbg = results_cb.message;
                        callback(rspObj);
                    }
                });
            }
            else {
                rspObj = {};
                rspObj.rsc = '2001';
                rspObj.ri = ri;
                rspObj.dbg = '';
                callback(rspObj);
            }
        }
        else {
            rspObj = {};
            rspObj.rsc = '5000';
            rspObj.ri = ri;
            rspObj.dbg = results_comm.message;
            callback(rspObj);
        }
    });
};


function create_remoteCSE_mqtt(cseid, csebasename, body_Obj, callback) {
    var rootnm = 'csr';

    body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
    delete body_Obj[Object.keys(body_Obj)[0]];

    var bodyString = JSON.stringify(body_Obj);

    var rqi = require('shortid').generate();
    var options = {
        hostname: 'localhost',
        port: use_pxy_mqtt_port,
        path: '/register_csr',
        method: 'POST',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': use_cb_id,
            'Content-Type': 'application/vnd.onem2m-res+'+defaultbodytype,
            'cseid': cseid,
            'csebasename': csebasename,
            'bodytype': defaultbodytype,
            'X-M2M-RVI': use_rvi
        }
    };

    var fullBody = '';
    var req = http.request(options, function (res) {
        res.on('data', function(chunk) {
            fullBody += chunk.toString();
        });
        res.on('end', function() {
            callback(res.statusCode);
        });
    });

    req.on('error', function (e) {
        console.log('[create_remoteCSE_mqtt - mn] ' + csebasename + ' problem with request: ' + e.message);
        callback('0', {});
    });

    // write data to request body
    req.write(bodyString);
    req.end();
}


function retrieve_CSEBase_mqtt(cseid, csebasename, callback) {
    var rqi = require('shortid').generate();
    var options = {
        hostname: 'localhost',
        port: use_pxy_mqtt_port,
        path: '/get_cb',
        method: 'get',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': use_cb_id,
            'Content-Type': 'application/vnd.onem2m-res+'+defaultbodytype,
            'cseid': cseid,
            'csebasename': csebasename,
            'bodytype': defaultbodytype,
            'X-M2M-RVI': use_rvi
        }
    };

    var fullBody = '';
    var req = http.request(options, function (res) {
        res.on('data', function(chunk) {
            fullBody += chunk.toString();
        });
        res.on('end', function() {
            if (res.statusCode == 200) {
                var jsonObj = {};
                jsonObj = JSON.parse(fullBody);
                jsonObj.csr = {};
                jsonObj.csr = (jsonObj['m2m:cb'] == null) ? jsonObj['cb'] : jsonObj['m2m:cb'];
                delete jsonObj['m2m:cb'];
                delete jsonObj['cb'];

                for(var idx in jsonObj.csr) {
                    if(jsonObj.csr.hasOwnProperty(idx)) {
                        if (jsonObj.csr[idx] == null || jsonObj.csr[idx] == '' || jsonObj.csr[idx] == 'undefined' || jsonObj.csr[idx] == '[]') {
                            delete jsonObj.csr[idx];
                        }
                    }
                }

                delete jsonObj.csr.ty;
                delete jsonObj.csr.ri;
                delete jsonObj.csr.ct;
                delete jsonObj.csr.lt;
                delete jsonObj.csr.st;

                jsonObj.csr.cst = '5';
                jsonObj.csr.rr = 'true';
                jsonObj.csr.cb = jsonObj.csr.rn;

                callback(res.statusCode, jsonObj);
            }
        });
    });

    req.on('error', function (e) {
        console.log('[retrieve_CSEBase_mqtt - mn] problem with request: ' + e.message);
        callback('0', {});
    });

    // write data to request body
    req.write('');
    req.end();
}