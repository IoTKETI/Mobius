/**
 * Copyright (c) 2017, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2017, OCEAN
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
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var options = {
        hostname: cbhost,
        port: cbhostport,
        path: ri,
        method: 'get',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': usecseid
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
                if (defaultbodytype == 'xml') {
                    var parser = new xml2js.Parser({explicitArray: false});
                    parser.parseString(fullBody, function (err, result) {
                        if (err) {
                            console.log('[retrieve_CSEBase_http] fail to set csetype to MN-CSE. csetype is IN-CSE');
                        }
                        else {
                            result['m2m:cb'].rn = result['m2m:cb']['$'].rn;
                            delete result['m2m:cb']['$'];

                            if(result['m2m:cb'].poa) {
                                result['m2m:cb'].poa = result['m2m:cb'].poa.split(' ');
                            }

                            if(result['m2m:cb'].srt) {
                                result['m2m:cb'].srt = result['m2m:cb'].srt.split(' ');
                            }

                            if(result['m2m:cb'].lbl) {
                                result['m2m:cb'].lbl = result['m2m:cb'].lbl.split(' ');
                            }

                            if(result['m2m:cb'].acpi) {
                                result['m2m:cb'].acpi = result['m2m:cb'].acpi.split(' ');
                            }

                            jsonObj.csr = {};
                            jsonObj.csr = result['m2m:cb'];
                        }
                    });
                }
                else { // json
                    jsonObj = JSON.parse(fullBody);
                    jsonObj.csr = jsonObj['m2m:cb'];
                    delete jsonObj['m2m:cb'];
                }

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

    if (defaultbodytype == 'xml') {
        var xml = xmlbuilder.create('m2m:' + rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
            {pubID: null, sysID: null}, {allowSurrogateChars: false, skipNullAttributes: false, headless: false, ignoreDecorators: false, stringify: {}}
        ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

        for (var index in body_Obj) {
            if(body_Obj.hasOwnProperty(index)) {
                for (var attr in body_Obj[index]) {
                    if(body_Obj[index].hasOwnProperty(attr)) {
                        if (attr == 'rn') {
                            xml.att(attr, body_Obj[index][attr]);
                        }
                        else if (attr == 'acpi') {
                            xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                        }
                        else if (attr == 'lbl') {
                            xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                        }
                        else if (attr == 'srt') {
                            xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                        }
                        else if (attr == 'poa') {
                            xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                        }
                        else {
                            xml.ele(attr, body_Obj[index][attr]);
                        }
                    }
                }
            }
        }
        bodyString = xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
    }

    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var ri = '/' + cbname;
    var options = {
        hostname: cbhost,
        port: cbhostport,
        path: ri,
        method: 'post',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/'+defaultbodytype+';ty=16',
            'csr': 'self'
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

exports.build_asn = function(ri, callback) {
    // check remotecse if parent cse exist
    var rspObj = {};
    db_sql.select_direct_lookup(ri, function (err, results_comm) {
        if(!err) {
            if (results_comm.length == 1) {
                db_sql.select_cb(ri, function (err, results_cb) {
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

                            if (rspObj.csr.srt) {
                                rspObj.csr.srt = JSON.parse(rspObj.csr.srt);
                                delete rspObj.csr.srt;
                            }
                            
                            if(parent_cbprotocol == 'http') {
                                create_remoteCSE_http(parent_cbname, parent_cbhost, parent_cbhostport, rspObj, function (rsc) {
                                    if (rsc == 200 || rsc == 201 || rsc == 403 || rsc == 409) {
                                        retrieve_CSEBase_http(parent_cbname, parent_cbhost, parent_cbhostport, function (rsc, jsonObj) {
                                            if (rsc == 200 || rsc == 201 || rsc == 403 || rsc == 409) {
                                                create_remoteCSE_http(usecsebase, 'localhost', usecsebaseport, jsonObj, function (rsc) {
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
                                                create_remoteCSE_mqtt(usecseid, usecsebase, jsonObj, function (rsc) {
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

    if (defaultbodytype == 'xml') {
        var xml = xmlbuilder.create('m2m:' + rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
            {pubID: null, sysID: null}, {allowSurrogateChars: false, skipNullAttributes: false, headless: false, ignoreDecorators: false, stringify: {}}
        ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

        for (var index in body_Obj) {
            if(body_Obj.hasOwnProperty(index)) {
                for (var attr in body_Obj[index]) {
                    if(body_Obj[index].hasOwnProperty(attr)) {
                        if (attr == 'resourceName' || attr == 'rn') {
                            xml.att(attr, body_Obj[index][attr]);
                        }
                        else if (attr == 'accessControlPolicyIDs' || attr == 'acpi') {
                            xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                        }
                        else if (attr == 'labels' || attr == 'lbl') {
                            xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                        }
                        else if (attr == 'supportedResourceType' || attr == 'srt') {
                            xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                        }
                        else if (attr == 'pointOfAccess' || attr == 'poa') {
                            xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                        }
                        else {
                            xml.ele(attr, body_Obj[index][attr]);
                        }
                    }
                }
            }
        }
        bodyString = xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
    }

    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var options = {
        hostname: 'localhost',
        port: usepxymqttport,
        path: '/register_csr',
        method: 'POST',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/vnd.onem2m-res+'+defaultbodytype,
            'cseid': cseid,
            'csebasename': csebasename,
            'bodytype': defaultbodytype
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
    var rqi = moment().utc().format('mmssSSS') + randomValueBase64(4);
    var options = {
        hostname: 'localhost',
        port: usepxymqttport,
        path: '/get_cb',
        method: 'get',
        headers: {
            'X-M2M-RI': rqi,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/vnd.onem2m-res+'+defaultbodytype,
            'cseid': cseid,
            'csebasename': csebasename,
            'bodytype': defaultbodytype
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
                if (defaultbodytype == 'xml') {
                    var parser = new xml2js.Parser({explicitArray: false});
                    parser.parseString(fullBody, function (err, result) {
                        if (err) {
                            console.log('[retrieve_CSEBase_http] fail to set csetype to MN-CSE. csetype is IN-CSE');
                        }
                        else {
                            result['m2m:cb'] = (result['m2m:cb'] == null) ? result['cb'] : result['m2m:cb'];
                            if(result['cb']) {
                                delete result['cb'];
                            }
                            result['m2m:cb'].rn = result['m2m:cb']['$'].rn;
                            delete result['m2m:cb']['$'];

                            if(result['m2m:cb'].poa) {
                                result['m2m:cb'].poa = result['m2m:cb'].poa.split(' ');
                            }

                            if(result['m2m:cb'].srt) {
                                result['m2m:cb'].srt = result['m2m:cb'].srt.split(' ');
                            }

                            if(result['m2m:cb'].lbl) {
                                result['m2m:cb'].lbl = result['m2m:cb'].lbl.split(' ');
                            }

                            if(result['m2m:cb'].acpi) {
                                result['m2m:cb'].acpi = result['m2m:cb'].acpi.split(' ');
                            }

                            jsonObj.csr = {};
                            jsonObj.csr = result['m2m:cb'];
                        }
                    });
                }
                else { // json
                    jsonObj = JSON.parse(fullBody);
                    jsonObj.csr = {};
                    jsonObj.csr = (jsonObj['m2m:cb'] == null) ? jsonObj['cb'] : jsonObj['m2m:cb'];
                    delete jsonObj['m2m:cb'];
                    delete jsonObj['cb'];
                }

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