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
 * @file
 * @copyright KETI Korea 2015, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var util = require('util');
var url = require('url');
var http = require('http');
var js2xmlparser = require('js2xmlparser');
var xmlbuilder = require('xmlbuilder');
var db = require('./db_action');

var responder = require('./responder');

var ss_fail_count = {};

exports.check = function(request, noti_Obj, check_value) {
    var rootnm = request.headers.rootnm;

    if((request.method == "PUT" && check_value == 1)) {
        var pi = noti_Obj.ri;
    }
    else if ((request.method == "POST" && check_value == 3) || (request.method == "DELETE" && check_value == 4)) {
        pi = noti_Obj.pi;
    }
    var sql = util.format('select * from sub where pi = \'%s\'', pi);
    db.getResult(sql, '', function (err, results_ss) {
        if (!err) {
            for (var i = 0; i < results_ss.length; i++) {
                if(results_ss[i].ri == noti_Obj.ri) {
                    continue;
                }
                var cur_d = new Date();
                var msec = (parseInt(cur_d.getMilliseconds(), 10)<10) ? ('00'+cur_d.getMilliseconds()) : ((parseInt(cur_d.getMilliseconds(), 10)<100) ? ('0'+cur_d.getMilliseconds()) : cur_d.getMilliseconds());
                var xm2mri = 'rqi-' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec + randomValueBase64(4);
                if (ss_fail_count[results_ss[i].ri] == null) {
                    ss_fail_count[results_ss[i].ri] = 0;
                }
                ss_fail_count[results_ss[i].ri]++;
                if (ss_fail_count[results_ss[i].ri] >= 16) {
                    delete ss_fail_count[results_ss[i].ri];
                    delete_sub(results_ss[i].ri, xm2mri);
                }
                else {
                    var enc_Obj = JSON.parse(results_ss[i].enc);
                    var net_arr = enc_Obj.net;

                    for (var j = 0; j < net_arr.length; j++) {
                        if (net_arr[j] == check_value) { // 1 : Update_of_Subscribed_Resource, 3 : Create_of_Direct_Child_Resource, 4 : Delete_of_Direct_Child_Resource
                            var nu_arr = JSON.parse(results_ss[i].nu);
                            for (var k = 0; k < nu_arr.length; k++) {
                                var nu = nu_arr[k];
                                var sub_nu = url.parse(nu);
                                var nct = results_ss[i].nct;

                                var node = {};
                                if (nct == 2) {
                                    if(request.headers.nmtype == 'long') {
                                        node[responder.attrLname['sgn']] = {};
                                        node[responder.attrLname['sgn']][responder.attrLname['net']] = check_value.toString();
                                        node[responder.attrLname['sgn']][responder.attrLname['sur']] = results_ss[i].ri;
                                        node[responder.attrLname['sgn']][responder.attrLname['nec']] = results_ss[i].nec;
                                        node[responder.attrLname['sgn']][responder.attrLname['nev']] = {};
                                        node[responder.attrLname['sgn']][responder.attrLname['nev']][responder.attrLname['rep']] = {};

                                        var temp_Obj = {};
                                        temp_Obj[rootnm] = {};
                                        for(var index in noti_Obj) {
                                            if(noti_Obj.hasOwnProperty(index)) {
                                                if (index == "$") {
                                                    delete noti_Obj[index];
                                                    continue;
                                                }
                                                temp_Obj[rootnm][responder.attrLname[index]] = noti_Obj[index];
                                                delete noti_Obj[index];
                                            }
                                        }
                                        noti_Obj[responder.rsrcLname[rootnm]] = temp_Obj[rootnm];
                                        delete temp_Obj[rootnm];
                                        rootnm = responder.rsrcLname[rootnm];

                                        node[responder.attrLname['sgn']][responder.attrLname['nev']][responder.attrLname['rep']][rootnm] = noti_Obj[rootnm];
                                    }
                                    else {
                                        node.sgn = {};
                                        node.sgn.net = check_value.toString();
                                        node.sgn.sur = results_ss[i].ri;
                                        node.sgn.nec = results_ss[i].nec;
                                        node.sgn.nev = {};
                                        node.sgn.nev.rep = {};
                                        node.sgn.nev.rep[rootnm] = noti_Obj;
                                    }

                                    cur_d = new Date();
                                    msec = (parseInt(cur_d.getMilliseconds(), 10)<10) ? ('00'+cur_d.getMilliseconds()) : ((parseInt(cur_d.getMilliseconds(), 10)<100) ? ('0'+cur_d.getMilliseconds()) : cur_d.getMilliseconds());
                                    xm2mri = 'rqi-' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec + randomValueBase64(4);

                                    var sub_bodytype = request.headers.usebodytype;
                                    if(sub_nu.query != null) {
                                        if (sub_nu.query.split('=')[0] == 'ct') {
                                            if (sub_nu.query.split('=')[1] == 'xml') {
                                                sub_bodytype = 'xml';
                                            }
                                            else {
                                                sub_bodytype = 'json';
                                            }
                                        }
                                    }

                                    if (sub_bodytype == 'xml') {
                                        if (sub_nu.protocol == 'http:') {
                                            node[Object.keys(node)[0]]['@'] = {
                                                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                                                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
                                            };

                                            var xmlString = js2xmlparser('m2m:'+Object.keys(node)[0], node[Object.keys(node)[0]]);
                                            request_noti_http(nu, results_ss[i].ri, xmlString, sub_bodytype, xm2mri);
                                        }
                                        else { // mqtt:
                                            //node['m2m:'+Object.keys(node)[0]] = node[Object.keys(node)[0]];
                                            //delete node[Object.keys(node)[0]];
                                            request_noti_mqtt(nu, results_ss[i].ri, JSON.stringify(node), sub_bodytype, xm2mri);
                                        }
                                    }
                                    else { // defaultbodytype == 'json')
                                        if (sub_nu.protocol == 'http:') {
                                            request_noti_http(nu, results_ss[i].ri, JSON.stringify(node), sub_bodytype, xm2mri);
                                        }
                                        else { // mqtt:
                                            //jsonString = {};
                                            //jsonString[(request.headers.nmtype == 'long') ? 'singleNotification' : 'sgn'] = node[(request.headers.nmtype == 'long') ? 'm2m:singleNotification' : 'm2m:sgn'];
                                            request_noti_mqtt(nu, results_ss[i].ri, JSON.stringify(node), sub_bodytype, xm2mri);
                                        }
                                    }
                                }
                                else {
                                    console.log('nct except 2 (All Attribute) do not support');
                                }
                            }
                            break;
                        }
                        //else {
                        //    console.log('enc-net except 3 do not support');
                        //}
                    }
                }
            }
        }
        else {
            console.log('query error: ' + results_ss.code);
        }
    });
};


function request_noti_http(nu, ri, xmlString, bodytype, xm2mri) {
    var options = {
        hostname: url.parse(nu).hostname,
        port: url.parse(nu).port,
        path: url.parse(nu).path,
        method: 'POST',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': xm2mri,
            'Accept': 'application/'+bodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/vnd.onem2m-ntfy+'+bodytype,
            'ri': ri
        }
    };

    var bodyStr = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            if(res.statusCode == 200 || res.statusCode == 201) {
                console.log('----> response for notification ' + res.headers['x-m2m-rsc'] + ' - ' + ri);
                ss_fail_count[res.req._headers.ri] = 0;
            }
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[request_noti_http] problem with request: ' + e.message);
        }
    });

    console.log('<---- request for notification');
    // write data to request body
    //NOPRINT == 'true' ? NOPRINT = 'true' : console.log(xmlString);
    req.write(xmlString);
    req.end();
}

function delete_sub(ri, xm2mri) {
    var options = {
        hostname: 'localhost',
        port: usecsebaseport,
        path: ri,
        method: 'delete',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': xm2mri,
            'Accept': 'application/'+defaultbodytype,
            'X-M2M-Origin': usecseid
        }
    };

    var bodyStr = '';
    var req = http.request(options, function(res) {
        NOPRINT == 'true' ? NOPRINT = 'true' : console.log('STATUS: ' + res.statusCode);
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            if(res.statusCode == 200 || res.statusCode == 201) {
                console.log('delete sgn of ' + ri + ' for no response');
            }
        });

    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[delete_sub] problem with request: ' + e.message);
        }
    });

    // write data to request body
    req.write('');
    req.end();
}

function request_noti_mqtt(nu, ri, xmlString, bodytype, xm2mri) {
    var options = {
        hostname: 'localhost',
        port: usepxymqttport,
        path: '/notification',
        method: 'POST',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': xm2mri,
            'Accept': 'application/'+bodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/vnd.onem2m-ntfy+'+bodytype,
            'nu': nu,
            'bodytype': bodytype,
            'ri': ri
        }
    };

    var bodyStr = '';
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            if(res.statusCode == 200 || res.statusCode == 201) {
                console.log('----> response for notification ' + res.headers['x-m2m-rsc']);
                ss_fail_count[res.req._headers.ri] = 0;
            }
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[request_noti_mqtt] problem with request: ' + e.message);
        }
    });

    req.write(xmlString);
    req.end();
}


