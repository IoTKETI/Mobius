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
 * @file Main code of Mobius. Role of flow router
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

process.env.NODE_ENV = 'production';
//process.env.NODE_ENV = 'development';

var fs = require('fs');
var http = require('node:http');
var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var util = require('util');
var xml2js = require('xml2js');
var url = require('url');
var ip = require('ip');
var crypto = require('node:crypto');
var fileStreamRotator = require('file-stream-rotator');
var https = require('node:https');
var cbor = require('cbor');
var moment = require('moment');

const cors = require('cors');

global.NOPRINT = 'true';
global.ONCE = 'true';

global.MYIP = ip.address();

var cb = require('./mobius/cb');
var responder = require('./mobius/responder');
var resource = require('./mobius/resource');
var security = require('./mobius/security');
var fopt = require('./mobius/fopt');
var tr = require('./mobius/tr');
var sgn = require('./mobius/sgn');

var db = require('./mobius/db_action');
var db_sql = require('./mobius/sql_action');

require('dotenv').config();

// ������ �����մϴ�.
var app = express();

global.cache_resource_url = {};
global.cache_security_check = {};

app.use(cors());

global.usespid = '//keti.re.kr';
global.usesuperuser = 'Sponde'; //'Superman';
global.useobserver = 'Sandwich';

var logDirectory = __dirname + '/log';

// ensure log directory exists
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

// create a rotating write stream
var accessLogStream = fileStreamRotator.getStream({
    date_format: 'YYYYMMDD',
    filename: logDirectory + '/access-%DATE%.log',
    frequency: 'daily',
    verbose: false
});

// setup the logger
app.use(morgan('combined', {stream: accessLogStream}));

//ts_app.use(morgan('short', {stream: accessLogStream}));

function del_req_resource() {
    db.getConnection((code, connection) => {
        if (code === '200') {
            db_sql.delete_req(connection, (err, delete_Obj) => {
                if (!err) {
                    console.log('deleted ' + delete_Obj.affectedRows + ' request resource(s).');
                }
                connection.release();
            });
        }
        else {
            console.log('[del_req_resource] No Connection');
        }
    });
}

function del_expired_resource() {
    db.getConnection((code, connection) => {
        if (code === '200') {
            // this routine is that delete resource expired time exceed et of resource
            var et = moment().utc().format('YYYYMMDDTHHmmss');
            db_sql.delete_lookup_et(connection, et, (err) => {
                if (!err) {
                    console.log('---------------');
                    console.log('delete resources expired et');
                    console.log('---------------');
                }
                connection.release();
            });
        }
        else {
            console.log('[del_expired_resource] No Connection');
        }
    });
}

let createMobius = (callback) => {
    if (use_secure === 'disable') {
        http.globalAgent.maxSockets = 1000000;
        http.createServer(app).listen({port: usecsebaseport, agent: false}, () => {
            callback();
        });
    }
    else {
        var options = {
            key: fs.readFileSync('server-key.pem'),
            cert: fs.readFileSync('server-crt.pem'),
            ca: fs.readFileSync('ca-crt.pem')
        };
        https.globalAgent.maxSockets = 1000000;
        https.createServer(options, app).listen({port: usecsebaseport, agent: false}, () => {
            callback();
        });
    }
}

let cluster = require('cluster');
let os= require('os');
let cpuCount = os.cpus().length;

var worker = [];
var use_clustering = 1;
var worker_init_count = 0;

if (use_clustering) {
    if (cluster.isMaster) {
        // 워커가 종료되었을 때 새로운 워커 생성
        cluster.on('exit', (worker, code, signal) => {
            console.log(`Worker ${worker.process.pid} died`);
            console.log('Creating a new worker...');
            cluster.fork();
        });

        db.connect((rsc) => {
            if (rsc === '1') {
                db.getConnection((code, connection) => {
                    if (code === '200') {
                        cb.create(connection, (rsp) => {
                            console.log(JSON.stringify(rsp));

                            setInterval(del_req_resource, (24) * (60) * (60) * (1000));
                            setInterval(del_expired_resource, (24) * (60) * (60) * (1000));

                            require('./pxy_mqtt');
                            require('./pxy_coap');
                            require('./pxy_ws');

                            if (usecsetype == 'mn' || usecsetype == 'asn') {
                                global.refreshIntervalId = setInterval(() => {
                                    csr_custom.emit('register_remoteCSE');
                                }, 5000);
                            }

                            connection.release();

                            const numWorkers = os.cpus().length;
                            console.log(`Master process is running with ${numWorkers} workers`);
                            // 워커 프로세스 생성
                            for (let i = 0; i < numWorkers; i++) {
                                cluster.fork();
                            }
                        });
                    }
                    else {
                        console.log('[db.connect] No Connection');
                    }
                });
            }
        });
    }
    else {
        createMobius(()=>{
            console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
        });
    }
}
else {
    db.connect((rsc) => {
        if (rsc === '1') {
            db.getConnection((code, connection) => {
                if (code === '200') {
                    cb.create(connection, (rsp) => {
                        console.log(JSON.stringify(rsp));

                        connection.release();

                        setInterval(del_req_resource, (24) * (60) * (60) * (1000));
                        setInterval(del_expired_resource, (24) * (60) * (60) * (1000));

                        require('./pxy_mqtt');
                        require('./pxy_coap');
                        require('./pxy_ws');

                        if (usecsetype === 'mn' || usecsetype === 'asn') {
                            global.refreshIntervalId = setInterval(() => {
                                csr_custom.emit('register_remoteCSE');
                            }, 5000);
                        }

                        createMobius(()=>{
                            console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                        });
                    });
                }
                else {
                    console.log('[db.connect] No Connection');
                }
            });
        }
    });
}

global.get_ri_list_sri = function (request, response, sri_list, ri_list, count, callback) {
    if (sri_list.length <= count) {
        callback('200');
    }
    else {
        db_sql.get_ri_sri(request.db_connection, sri_list[count], (err, results) => {
            if (!err) {
                ri_list[count] = ((results.length == 0) ? sri_list[count] : results[0].ri);
                results = null;

                get_ri_list_sri(request, response, sri_list, ri_list, ++count, (code) => {
                    callback(code);
                });
            }
            else {
                callback('500-1');
            }
        });
    }
};

global.update_route = function (connection, cse_poa, callback) {
    db_sql.select_csr_like(connection, usecsebase, (err, results_csr) => {
        if (!err) {
            for (let i = 0; i < results_csr.length; i++) {
                makeObject(results_csr[i]);
                let poa_arr = results_csr[i].poa;
                for (let j = 0; j < poa_arr.length; j++) {
                    let poa_url = new URL(poa_arr[j]);
                    if (poa_url.protocol == 'http:' || poa_url.protocol == 'https:') {
                        cse_poa[results_csr[i].ri.split('_')[2]] = poa_arr[j];
                    }
                }
            }
            results_csr = null;
            callback('200');
        }
        else {
            callback('500-1');
        }
    });
};

function make_short_nametype(body_Obj) {
    if (body_Obj[Object.keys(body_Obj)[0]]['$'] != null) {
        if (body_Obj[Object.keys(body_Obj)[0]]['$'].rn != null) {
            body_Obj[Object.keys(body_Obj)[0]].rn = body_Obj[Object.keys(body_Obj)[0]]['$'].rn;
        }
        delete body_Obj[Object.keys(body_Obj)[0]]['$'];
    }

    var arr_rootnm = Object.keys(body_Obj)[0].split(':');

    if(arr_rootnm[0] === 'hd') {
        var rootnm = Object.keys(body_Obj)[0].replace('hd:', 'hd_');
    }
    else {
        rootnm = Object.keys(body_Obj)[0].replace('m2m:', '');
    }

    body_Obj[rootnm] = body_Obj[Object.keys(body_Obj)[0]];
    delete body_Obj[Object.keys(body_Obj)[0]];

    for (var attr in body_Obj[rootnm]) {
        if (body_Obj[rootnm].hasOwnProperty(attr)) {
            if (typeof body_Obj[rootnm][attr] === 'boolean') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else if (typeof body_Obj[rootnm][attr] === 'string') {
            }
            else if (typeof body_Obj[rootnm][attr] === 'number') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else {
            }
        }
    }
}

global.make_json_obj = function (bodytype, str, callback) {
    try {
        if (bodytype === 'xml') {
            var message = str;
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(message.toString(), (err, result) => {
                if (err) {
                    console.log('[mqtt make json obj] xml2js parser error]');
                    callback('0');
                }
                else {
                    for (var prop in result) {
                        if (result.hasOwnProperty(prop)) {
                            for (var attr in result[prop]) {
                                if (result[prop].hasOwnProperty(attr)) {
                                    if (attr == '$') {
                                        delete result[prop][attr];
                                    }
                                    else if (attr == 'pc') {
                                        make_json_arraytype(result[prop][attr]);
                                    }
                                }
                            }
                        }
                    }
                    callback('1', result);
                }
            });
        }
        else if (bodytype === 'cbor') {
            cbor.decodeFirst(str, (err, result) => {
                if (err) {
                    console.log('cbor parser error]');
                }
                else {
                    callback('1', result);
                }
            });
        }
        else {
            var result = JSON.parse(str);
            callback('1', result);
        }
    }
    catch (e) {
        console.error(e.message);
        callback('0');
    }
};

global.make_array_type = function (obj) {
    for (var attr in obj) {
        if (obj.hasOwnProperty(attr)) {
            if (attr == 'srv' || attr == 'aa' || attr == 'at' || attr == 'poa' || attr == 'lbl' || attr == 'acpi' || attr == 'srt' ||
                attr == 'nu' || attr == 'mid' || attr == 'macp' || attr == 'rels' || attr == 'subl' || attr === 'bn') {
                if((typeof obj[attr]) === 'string') {
                    try {
                        obj[attr] = JSON.parse(obj[attr]);
                    }
                    catch (e) {
                        obj[attr] = obj[attr].split(' ');
                    }
                    // if (obj[attr] === '') {
                    //     obj[attr] = [];
                    // }
                    // if (obj[attr] === '[]') {
                    //     obj[attr] = [];
                    // }
                }
                // else {
                //
                // }
                // if (obj[attr]) {
                //     obj[attr] = obj[attr].split(' ');
                // }
                // if (obj[attr] == '') {
                //     obj[attr] = [];
                // }
                // if (obj[attr] == '[]') {
                //     obj[attr] = [];
                // }
            }
            else if (attr == 'rqps') {
                var rqps_type = getType(obj[attr]);
                if (rqps_type === 'array') {

                }
                else if (rqps_type === 'object') {
                    var temp = obj[attr];
                    obj[attr] = [];
                    obj[attr].push(temp);
                }
                else {

                }
            }
            else if (attr == 'enc') {
                if((typeof obj[attr]) === 'string') {
                    try {
                        obj[attr] = JSON.parse(obj[attr]);
                    }
                    catch (e) {
                        obj[attr] = obj[attr].split(' ');
                    }
                }
                else {
                    if (obj[attr]) {
                        if (obj[attr].net) {
                            if (!Array.isArray(obj[attr].net)) {
                                obj[attr].net = obj[attr].net.split(' ');
                            }
                        }
                    }
                }
            }
            else if (attr == 'pv' || attr == 'pvs') {
                if (obj[attr]) {
                    if (obj[attr].acr) {
                        if (!Array.isArray(obj[attr].acr)) {
                            temp = obj[attr].acr;
                            obj[attr].acr = [];
                            obj[attr].acr[0] = temp;
                        }

                        for (var acr_idx in obj[attr].acr) {
                            if (obj[attr].acr.hasOwnProperty(acr_idx)) {
                                if (obj[attr].acr[acr_idx].acor) {
                                    obj[attr].acr[acr_idx].acor = obj[attr].acr[acr_idx].acor.split(' ');
                                }

                                if (obj[attr].acr[acr_idx].hasOwnProperty('acco')) {
                                    if (!Array.isArray(obj[attr].acr[acr_idx].acco)) {
                                        temp = obj[attr].acr[acr_idx].acco;
                                        obj[attr].acr[acr_idx].acco = [];
                                        obj[attr].acr[acr_idx].acco[0] = temp;
                                    }

                                    var acco = obj[attr].acr[acr_idx].acco;
                                    for (var acco_idx in acco) {
                                        if (acco.hasOwnProperty(acco_idx)) {
                                            if (acco[acco_idx].hasOwnProperty('acip')) {
                                                if (acco[acco_idx].acip.hasOwnProperty('ipv4')) {
                                                    if (getType(acco[acco_idx].acip['ipv4']) == 'string') {
                                                        acco[acco_idx].acip['ipv4'] = acco[acco_idx].acip.ipv4.split(' ');
                                                    }
                                                }
                                                else if (acco[acco_idx].acip.hasOwnProperty('ipv6')) {
                                                    if (getType(acco[acco_idx].acip['ipv6']) == 'string') {
                                                        acco[acco_idx].acip['ipv6'] = acco[acco_idx].acip.ipv6.split(' ');
                                                    }
                                                }
                                            }
                                            if (acco[acco_idx].hasOwnProperty('actw')) {
                                                if (getType(acco[acco_idx].actw) == 'string') {
                                                    temp = acco[acco_idx].actw;
                                                    acco[acco_idx]['actw'] = [];
                                                    acco[acco_idx].actw[0] = temp;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (obj[attr].acr == '') {
                        obj[attr].acr = [];
                    }

                    if (obj[attr].acr == '[]') {
                        obj[attr].acr = [];
                    }
                }
            }
        }
    }
};

global.make_json_arraytype = function (body_Obj) {
    for (var prop in body_Obj) {
        if (body_Obj.hasOwnProperty(prop)) {
            make_array_type(body_Obj[prop]);
        }
    }
};

function parse_to_json(request, response, callback) {
    if (request.usebodytype === 'xml') {
        try {
            var parser = new xml2js.Parser({explicitArray: false});
            parser.parseString(request.body.toString(), (err, result) => {
                if (err) {
                    callback('400-5');
                }
                else {
                    request.bodyObj = result;
                    make_short_nametype(request.bodyObj);
                    make_json_arraytype(request.bodyObj);

                    request.headers.rootnm = Object.keys(request.bodyObj)[0];
                    callback('200');
                }
            });
        }
        catch (e) {
            callback('400-5');
        }
    }
    else if (request.usebodytype === 'cbor') {
        try {
            var encoded = request.body;
            cbor.decodeFirst(encoded, (err, result) => {
                if (err) {
                    callback('400-6');
                }
                else {
                    request.bodyObj = result;
                    make_short_nametype(request.bodyObj);
                    //make_json_arraytype(request.bodyObj);

                    request.headers.rootnm = Object.keys(request.bodyObj)[0];
                    callback('200');
                }
            });
        }
        catch (e) {
            callback('400-6');
        }
    }
    else {
        try {
            request.bodyObj = JSON.parse(request.body.toString());
            make_short_nametype(request.bodyObj);

            if (Object.keys(request.bodyObj)[0] == 'undefined') {
                callback('400-7');
            }
            else {
                request.headers.rootnm = Object.keys(request.bodyObj)[0];
                callback('200');
            }
        }
        catch (e) {
            callback('400-7');
        }
    }
}

function parse_body_format(request) {
    try {
        request.bodyObj = JSON.parse(request.body.toString());
        make_short_nametype(request.bodyObj);

        if (Object.keys(request.bodyObj)[0] === 'undefined') {
            return ('400-7');
        }
        else {
            request.headers.rootnm = Object.keys(request.bodyObj)[0];
            let body_Obj = request.bodyObj;
            for (let prop in body_Obj) {
                if (body_Obj.hasOwnProperty(prop)) {
                    for (let attr in body_Obj[prop]) {
                        if (body_Obj[prop].hasOwnProperty(attr)) {
                            if (attr === 'aa' || attr === 'at' || attr === 'poa' || attr === 'acpi' || attr === 'srt' ||
                                attr === 'nu' || attr === 'mid' || attr === 'macp' || attr === 'rels' || attr === 'rqps' || attr === 'srv') {
                                if (!Array.isArray(body_Obj[prop][attr])) {
                                    return ('400-8');
                                }
                            }
                            else if (attr === 'lbl') {
                                if (body_Obj[prop][attr] == null) {
                                    body_Obj[prop][attr] = [];
                                }
                                else if (!Array.isArray(body_Obj[prop][attr])) {
                                    return ('400-9');
                                }
                            }
                            else if (attr === 'enc') {
                                if (body_Obj[prop][attr].net) {
                                    if (!Array.isArray(body_Obj[prop][attr].net)) {
                                        return ('400-10');
                                    }
                                }
                                else {
                                    return ('400-11');
                                }
                            }
                            else if (attr === 'pv' || attr === 'pvs') {
                                if (body_Obj[prop][attr].hasOwnProperty('acr')) {
                                    if (!Array.isArray(body_Obj[prop][attr].acr)) {
                                        return ('400-12');
                                    }
                                    let acr = body_Obj[prop][attr].acr;
                                    for (let acr_idx in acr) {
                                        if (acr.hasOwnProperty(acr_idx)) {
                                            if (acr[acr_idx].acor) {
                                                if (!Array.isArray(acr[acr_idx].acor)) {
                                                    return ('400-13');
                                                }
                                            }
                                            if (acr[acr_idx].acco) {
                                                if (!Array.isArray(acr[acr_idx].acco)) {
                                                    return ('400-14');
                                                }
                                                for (let acco_idx in acr[acr_idx].acco) {
                                                    if (acr[acr_idx].acco.hasOwnProperty(acco_idx)) {
                                                        let acco = acr[acr_idx].acco[acco_idx];
                                                        if (acco.acip) {
                                                            if (acco.acip['ipv4']) {
                                                                if (!Array.isArray(acco.acip['ipv4'])) {
                                                                    return ('400-15');
                                                                }
                                                            }
                                                            else if (acco.acip['ipv6']) {
                                                                if (!Array.isArray(acco.acip['ipv6'])) {
                                                                    return ('400-16');
                                                                }
                                                            }
                                                        }
                                                        if (acco.actw) {
                                                            if (!Array.isArray(acco.actw)) {
                                                                return ('400-17');
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            else if (attr === 'uds') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    return ('400-18');
                                }
                            }
                            else if (attr === 'cas') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    return ('400-18');
                                }
                            }
                            else {
                            }
                        }
                    }
                }
            }

            if (responder.typeRsrc[request.ty] != Object.keys(request.bodyObj)[0]) {
                if (responder.typeRsrc[request.ty] == 'mgo') {
                    var support_mgo = 0;
                    for (var prop in responder.mgoType) {
                        if (responder.mgoType.hasOwnProperty(prop)) {
                            if (responder.mgoType[prop] == Object.keys(request.bodyObj)[0]) {
                                support_mgo = 1;
                                break;
                            }
                        }
                    }

                    if (support_mgo == 0) {
                        return ('400-42');
                    }
                }
                else {
                    return ('400-42');
                }
            }

            return ('200');
        }
    }
    catch (e) {
        return ('400-7');
    }
}

function check_resource(request, response, callback) {
    let req_url = url.parse(request.url);
    var ri = req_url.pathname.replace(/\//g, '_');

    var arr_chk_fopt = req_url.pathname.split('/');
    let flag_fopt = 0;

    for(let i in arr_chk_fopt) {
        if(arr_chk_fopt.hasOwnProperty(i)) {
            if(arr_chk_fopt[i] === 'fopt') {
                flag_fopt = 1;
                break;
            }
        }
    }

    if (flag_fopt === 1) {
        let _url = '/' + arr_chk_fopt.join('/').replace('/fopt', '');
        ri = _url.replace(/\//g, '_');
        db_sql.select_grp_lookup(request.db_connection, ri, (err, result_Obj) => {
            if (!err) {
                if (result_Obj.length == 1) {
                    result_Obj[0].acpi = JSON.parse(result_Obj[0].acpi);
                    result_Obj[0].lbl = JSON.parse(result_Obj[0].lbl);
                    result_Obj[0].aa = JSON.parse(result_Obj[0].aa);
                    result_Obj[0].at = JSON.parse(result_Obj[0].at);

                    request.targetObj = JSON.parse(JSON.stringify(result_Obj[0]));
                    result_Obj = null;

                    callback('200');
                }
                else {
                    callback('404-4');
                }
            }
            else {
                callback('500-3');
            }
        });
    }
    else {
        console.log('X-M2M-Origin: ' + request.headers['x-m2m-origin']);
        callback('200');
    }
}

function check_request_query_rt(request, response, callback) {
    if (request.query.rt == 3) { // default, blocking
        return ('200');
    }
    else if (request.query.rt == 1 || request.query.rt == 2) { // nonblocking
        if (request.query.rt == 2 && request.headers['x-m2m-rtu'] == null && request.headers['x-m2m-rtu'] == '') {
            return ('400-21');
        }
        else {
            // first create request resource under CSEBase
            let temp_rootnm = request.headers.rootnm;
            let temp_body_Obj = JSON.parse(JSON.stringify(request.bodyObj));
            let temp_ty = request.ty;

            request.ty = '17';
            var rt_body_Obj = {req: {}};
            request.headers.rootnm = 'req';
            request.bodyObj = rt_body_Obj;
            request.query.rt = 3;

            resource.create(request, response, (code) => {
                if (code === '200') {
                    request.ty = temp_ty;
                    request.headers.rootnm = temp_rootnm;
                    request.bodyObj = temp_body_Obj;
                    request.query.rt = 1;
                }
                return (code);
            });
        }
    }
    else {
        return ('405-4');
    }
}

function check_grp(result_Obj) {
    let rootnm = Object.keys(result_Obj)[0];

    if (result_Obj[rootnm].ty == 9) {
        if (result_Obj[rootnm].mid.length == 0) {
            return ('403-6');
        }
        else {
            return ('200');
        }
    }
    else {
        return ('404-4');
    }
}

var resultStatusCode = {
    '301-3': ['405', '4005', "forwarding with mqtt is not supported"],
    '301-4': ['405', '4005', "protocol in poa of csr is not supported"],

    '400-1': ['400', '4000', "BAD REQUEST: X-M2M-RI is none"],
    '400-2': ['400', '4000', "BAD REQUEST: X-M2M-Origin header is Mandatory"],
    '400-3': ['400', '4000', "BAD REQUEST: not supported resource type requested"],
    '400-4': ['400', '4000', "BAD REQUEST: not parse your body"],
    '400-5': ['400', '4000', "BAD REQUEST: [parse_to_json] do not parse xml body"],
    '400-6': ['400', '4000', "BAD REQUEST: [parse_to_json] do not parse cbor body"],
    '400-7': ['400', '4000', "BAD REQUEST: [parse_to_json] root tag of body is not matched"],
    '400-8': ['400', '4000', "BAD REQUEST: (aa, at, poa, acpi, srt, nu, mid, macp, rels, rqps, srv) attribute should be json array format"],
    '400-9': ['400', '4000', "BAD REQUEST: (lbl) attribute should be json array format"],
    '400-10': ['400', '4000', "BAD REQUEST: (enc.net) attribute should be json array format"],
    '400-11': ['400', '4000', "BAD REQUEST: (enc) attribute should have net key as child in json format"],
    '400-12': ['400', '4000', "BAD REQUEST: (pv.acr, pvs.acr) attribute should be json array format"],
    '400-13': ['400', '4000', "BAD REQUEST: (pv.acr.acor, pvs.acr.acor) attribute should be json array format"],
    '400-14': ['400', '4000', "BAD REQUEST: (pv.acr.acco, pvs.acr.acco) attribute should be json array format"],
    '400-15': ['400', '4000', "BAD REQUEST: (pv.acr.acco.acip.ipv4, pvs.acr.acco.acip.ipv4) attribute should be json array format"],
    '400-16': ['400', '4000', "BAD REQUEST: (pv.acr.acco.acip.ipv6, pvs.acr.acco.acip.ipv6) attribute should be json array format"],
    '400-17': ['400', '4000', "BAD REQUEST: (pv.acr.acco.actw, pvs.acr.acco.actw) attribute should be json array format"],
    '400-18': ['400', '4000', "BAD REQUEST: (uds, cas) attribute should be json array format"],
    '400-19': ['400', '4000', "BAD REQUEST: [check_notification] post request without ty value is but body is not for notification"],
    '400-20': ['400', '4000', "BAD REQUEST: [check_notification] content-type is none"],
    '400-21': ['400', '4000', "BAD REQUEST: X-M2M-RTU is none"],
    '400-22': ['400', '4000', "BAD REQUEST: \'Not Present\' attribute"],
    '400-23': ['400', '4000', "BAD REQUEST: .acr must have values"],
    '400-24': ['400', '4000', "BAD REQUEST: nu must have values"],
    '400-25': ['400', '4000', "BAD REQUEST: attribute is not defined"],
    '400-26': ['400', '4000', "BAD REQUEST: attribute is \'Mandatory\' attribute"],
    '400-27': ['400', '4000', "BAD REQUEST: expiration time is before now"],
    '400-28': ['400', '4000', "BAD REQUEST: ASN CSE can not have child CSE (remoteCSE)"],
    '400-29': ['400', '4000', "BAD REQUEST: mni is negative value"],
    '400-30': ['400', '4000', "BAD REQUEST: mbs is negative valuee"],
    '400-31': ['400', '4000', "BAD REQUEST: mia is negative value"],
    '400-32': ['400', '4000', "BAD REQUEST: contentInfo(cnf) format is not match"],
    '400-33': ['400', '6010', "MAX_NUMBER_OF_MEMBER_EXCEEDED"],
    '400-34': ['400', '6011', "can not create group because csy is ABANDON_GROUP when MEMBER_TYPE_INCONSISTENT"],
    '400-35': ['400', '4000', "BAD REQUEST: mgmtDefinition is not match with mgmtObj resource"],
    '400-36': ['400', '4000', "BAD REQUEST: ty does not supported"],
    '400-37': ['400', '4000', "BAD REQUEST: transaction resource could not create"],
    '400-40': ['400', '4000', "BAD REQUEST: body is empty"],
    '400-41': ['400', '4000', "BAD REQUEST"],
    '400-42': ['400', '4000', "BAD REQUEST: ty is different with body"],
    '400-43': ['400', '4000', "BAD REQUEST: rcn or fu query is not supported at POST request"],
    '400-44': ['400', '4000', "BAD REQUEST: rcn or fu query is not supported at GET request"],
    '400-45': ['400', '4000', "BAD REQUEST: rcn or fu query is not supported at PUT request"],
    '400-46': ['400', '4000', "BAD REQUEST: rcn or fu query is not supported at DELETE request"],
    '400-47': ['400', '4000', "BAD REQUEST: protocol in poa of ae is not supported"],
    '400-50': ['400', '4000', "BAD REQUEST: state of transaction is mismatch"],
    '400-51': ['400', '4000', "BAD REQUEST: mgmtObj requested is not match with content type of body"],
    '400-52': ['400', '4000', "BAD REQUEST: ty does not supported"],
    '400-53': ['400', '4000', "BAD REQUEST: this resource of mgmtObj is not supported"],
    '400-54': ['400', '4000', "BAD REQUEST: cdn of flexCotainer is not match with fcnt resource"],
    '400-61': ['400', '4000', "BAD REQUEST: loc - typ is illegal format"],
    '400-62': ['400', '4000', "BAD REQUEST: loc - crd is illegal format"],
    '400-63': ['400', '4000', "BAD REQUEST: loc - crd is not array"],
    '400-64': ['400', '4000', "BAD REQUEST: doesn't support content type except json"],
    '400-65': ['400', '4000', "BAD REQUEST: doesn't exist api on ae in body of request when checking allowed appid"],

    '403-1': ['403', '4107', "OPERATION_NOT_ALLOWED: AE-ID is not allowed"],
    '403-2': ['403', '5203', "TARGET_NOT_SUBSCRIBABLE: request ty creating can not create under parent resource"],
    '403-3': ['403', '4103', "ACCESS DENIED"],
    '403-4': ['403', '4107', "OPERATION_NOT_ALLOWED: APP-ID in AE is not allowed"],
    '403-5': ['403', '4107', "[app.use] ACCESS DENIED (fopt)"],
    '403-6': ['403', '4109', "NO_MEMBERS: memberID in parent group is empty"],

    '404-1': ['404', '4004', "resource does not exist (get_target_url)"],
    '404-2': ['404', '4004', "RESOURCE DOES NOT FOUND"],
    '404-3': ['404', '4004', "csebase is not found"],
    '404-4': ['404', '4004', "group resource does not exist"],
    '404-5': ['404', '4004', "response is not from fanOutPoint"],
    '404-6': ['404', '4004', "AE for notify is not found"],
    '404-7': ['404', '4004', "AE for notify does not exist"],

    '405-1': ['405', '4005', "OPERATION_NOT_ALLOWED: CSEBase can not be created by others"],
    '405-2': ['405', '4005', "OPERATION_NOT_ALLOWED: req is not supported when post request"],
    '405-3': ['405', '4005', "OPERATION_NOT_ALLOWED: we do not support resource type requested"],
    '405-4': ['405', '4005', "OPERATION_NOT_ALLOWED: rt query is not supported"],
    '405-5': ['405', '4005', "OPERATION_NOT_ALLOWED: we do not support to create resource"],
    '405-6': ['405', '4005', "OPERATION NOT ALLOWED: disr attribute is true"],
    '405-7': ['405', '4005', "OPERATION NOT ALLOWED: Update cin is not supported"],
    '405-8': ['405', '4005', "OPERATION NOT ALLOWED: req is not supported when put request"],
    '405-9': ['405', '4005', "OPERATION_NOT_ALLOWED: csebase is not supported when put request"],
    '405-10': ['405', '4005', "OPERATION_NOT_ALLOWED: notification with mqtt is not supported"],
    '405-11': ['405', '4005', "OPERATION_NOT_ALLOWED: notification with ws is not supported"],
    '405-12': ['405', '4005', "OPERATION_NOT_ALLOWED: notification with coap is not supported"],

    '406-1': ['406', '5207', "NOT_ACCEPTABLE: can not create cin because mni value is zero"],
    '406-2': ['406', '5207', "NOT_ACCEPTABLE: can not create cin because mbs value is zero"],
    '406-3': ['406', '5207', "NOT_ACCEPTABLE: cs is exceed mbs"],

    '409-1': ['409', '4005', "can not use post, put method at latest resource"],
    '409-2': ['409', '4005', "can not use post, put method at oldest resource"],
    '409-3': ['409', '4005', "resource name can not use that is keyword"],
    '409-4': ['409', '4005', "resource requested is not supported"],
    '409-5': ['409', '4105', "resource is already exist"],
    '409-6': ['409', '4106', "[create_action] aei is duplicated"],

    '423-1': ['423', '4230', "LOCKED: this resource was occupied by others"],

    '500-1': ['500', '5000', "database error"],
    '500-2': ['500', '5204', "SUBSCRIPTION_VERIFICATION_INITIATION_FAILED"],
    '500-4': ['500', '5000', "[create_action] create resource error"],
    '500-5': ['500', '5000', "DB Error : No Connection Pool"],

    '501-1': ['501', '5001', "response with hierarchical resource structure mentioned in onem2m spec is not supported instead all the requested resources will be returned !"]

};

function response_error_result(request, response, code, callback) {
    responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
        callback();
    });
}

const lookup_create = async (request, response, callback) => {
    let rcode = check_request_query_rt(request, response);
    if (rcode === '200') {
        let parentObj = request.targetObject[Object.keys(request.targetObject)[0]];

        rcode = await tr.check(request);
        if (rcode === '200') {
            if ((request.ty == 1) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // accessControlPolicy
            }
            else if ((request.ty == 9) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // group
            }
            else if ((request.ty == 16) && (parentObj.ty == 5)) { // remoteCSE
                if (usecsetype == 'asn' && request.headers.csr == null) {
                    callback('400-28');
                    return;
                }
            }
            else if ((request.ty == 10) && (parentObj.ty == 5)) { // locationPolicy
            }
            else if ((request.ty == 2) && (parentObj.ty == 5)) { // ae
            }
            else if ((request.ty == 3) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3)) { // container
            }
            else if ((request.ty == 23) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 29 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27 || parentObj.ty == 28)) { // sub
            }
            else if (((request.ty == 4) && (parentObj.ty == 3)) || ((request.ty == 30) && (parentObj.ty == 29))) { // contentInstance
                if (parseInt(parentObj.mni) == 0) {
                    callback('406-1');
                    return;
                }
                else if (parseInt(parentObj.mbs) == 0) {
                    callback('406-2');
                    return;
                }
                else if (parentObj.disr == true) {
                    callback('405-6');
                    return;
                }

                request.headers.mni = parentObj.mni;
                request.headers.mbs = parentObj.mbs;
                request.headers.cni = parentObj.cni;
                request.headers.cbs = parentObj.cbs;
                request.headers.st = parentObj.st;
            }
            else if ((request.ty == 24) && (parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 4 || parentObj.ty == 29)) { // semanticDescriptor
            }
            else if ((request.ty == 29) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // timeSeries
            }
            else if ((request.ty == 30) && (parentObj.ty == 29)) { // timeSeriesInstance
            }
            else if ((request.ty == 27) && (parentObj.ty == 2 || parentObj.ty == 16)) { // multimediaSession
            }
            else if ((request.ty == 14) && (parentObj.ty == 5)) { // node
            }
            else if ((request.ty == 13) && (parentObj.ty == 14)) { // mgmtObj
            }
            else if ((request.ty == 38) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 29 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27)) { // transaction
            }
            else if ((request.ty == 39) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 29 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27)) { // transaction
            }
            else if ((request.ty == 28) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 28)) { // flexcontainer
            }
            else if ((request.ty == 98 || request.ty == 97 || request.ty == 96 || request.ty == 95 || request.ty == 94 || request.ty == 93 || request.ty == 92 || request.ty == 91) && (parentObj.ty == 28)) { // flexcontainer
            }
            else {
                callback('403-2');
                return;
            }

            if (parentObj.length == 0) {
                parentObj = {};
                parentObj.cr = '';
                console.log('no creator');
            }
            else {
                if (parentObj.ty == 2) {
                    parentObj.cr = parentObj.aei;
                }
            }

            if (request.ty == 23) {
                var access_value = '3';
            }
            else {
                access_value = '1';
            }

            var tid = 'security.check - ' + require('shortid').generate();
            console.time(tid);
            security.check(request, response, parentObj.ty, parentObj.acpi, access_value, parentObj.cr, (code) => {
                console.timeEnd(tid);

                if (!cache_security_check.hasOwnProperty(request.headers['x-m2m-origin'])) {
                    cache_security_check[request.headers['x-m2m-origin']] = {};
                }

                if (!cache_security_check[request.headers['x-m2m-origin']].hasOwnProperty(parentObj.ri)) {
                    cache_security_check[request.headers['x-m2m-origin']][parentObj.ri] = {}
                }

                cache_security_check[request.headers['x-m2m-origin']][parentObj.ri][access_value] = code;

                if (code === '1') {
                    resource.create(request, response, (code) => {
                        callback(code);
                    });
                }
                else if (code === '0') {
                    callback('403-3');

                }
                else {
                    callback(code);
                }
            });
        }
        else {
            callback(rcode);
        }
    }
    else {
        callback(rcode);
    }

}

const lookup_retrieve = async (request, response, callback) => {
    let rcode = check_request_query_rt(request, response);
    if (rcode === '200') {
        let resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        if(!resultObj.hasOwnProperty('acpi')) {
            resultObj.acpi = [];
        }

        rcode = await tr.check(request);
        if (rcode === '200') {
            if (resultObj.ty === 2) {
                resultObj.cr = resultObj.aei;
            }
            else if (resultObj.ty === 16) {
                resultObj.cr = resultObj.csi;
            }

            let access_val = '2';
            if (request.query.fu === 1) {
                access_val = '32';
            }

            security.check(request, response, resultObj.ty, resultObj.acpi, access_val, resultObj.cr, (code) => {
                if (code === '1') {
                    resource.retrieve(request, response, (code) => {
                        callback(code);
                    });
                }
                else if (code === '0') {
                    callback('403-3');
                }
                else {
                    callback(code);
                }
            });
        }
        else {
            callback(rcode);
        }
    }
    else {
        callback(rcode);
    }
}

const lookup_update = async (request, response, callback) => {
    let rcode = check_request_query_rt(request, response);
    if (rcode === '200') {
        var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        rcode = await tr.check(request);
        if (rcode === '200') {
            if (resultObj.ty == 2) {
                resultObj.cr = resultObj.aei;
            }
            else if (resultObj.ty == 16) {
                resultObj.cr = resultObj.csi;
            }

            var acpi_check = 0;
            var other_check = 0;
            for (var rootnm in request.bodyObj) {
                if (request.bodyObj.hasOwnProperty(rootnm)) {
                    for (var attr in request.bodyObj[rootnm]) {
                        if (request.bodyObj[rootnm].hasOwnProperty(attr)) {
                            if (attr == 'acpi') {
                                acpi_check++;
                            }
                            else {
                                other_check++;
                            }
                        }
                    }
                }
            }

            if (other_check > 0) {
                security.check(request, response, resultObj.ty, resultObj.acpi, '4', resultObj.cr, (code) => {
                    if (code === '1') {
                        resource.update(request, response, (code) => {
                            callback(code)
                        });
                    }
                    else if (code === '0') {
                        callback('403-3');
                    }
                    else {
                        callback(code);
                    }
                });
            }
            else {
                resource.update(request, response, (code) => {
                    callback(code)
                });
            }
        }
        else {
            callback(rcode);
        }
    }
    else {
        callback(rcode);
    }
}

const lookup_delete = async (request, response, callback) => {
    let rcode = check_request_query_rt(request, response);
    if (rcode === '200') {
        var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        rcode = await tr.check(request);
        if (rcode === '200') {
            if (resultObj.ty == 2) {
                resultObj.cr = resultObj.aei;
            }
            else if (resultObj.ty == 16) {
                resultObj.cr = resultObj.csi;
            }

            security.check(request, response, resultObj.ty, resultObj.acpi, '8', resultObj.cr, (code) => {
                if (code === '1') {
                    resource.delete(request, response, (code) => {
                        callback(code);
                    });
                }
                else if (code === '0') {
                    callback('403-3');
                }
                else {
                    callback(code);
                }
            });
        }
        else {
            callback(rcode);
        }
    }
    else {
        callback(rcode);
    }
}

function check_resource_from_url(connection, ri, callback) {
    if(cache_resource_url.hasOwnProperty(ri.replace(/_/g, '\/'))) {
        callback(cache_resource_url[ri.replace(/_/g, '\/')], 200);
    }
    else {
        db_sql.select_resource_from_url(connection, ri, (err, results) => {
            if (err) {
                callback(null, 500);
            }
            else {
                if (results.length === 0) {
                    callback(null, 404);
                }
                else {
                    cache_resource_url[ri.replace(/_/g, '\/')] = JSON.parse(JSON.stringify(results[0]));
                    callback(results[0], 200);
                }
            }
        });
    }
}

function get_resource_from_url(connection, ri, option, callback) {
    let targetObject = {};
    check_resource_from_url(connection, ri, (result, code) => {
        if(code === 200) {
            var ty = result.ty;
            targetObject[responder.typeRsrc[ty]] = result;
            var rootnm = Object.keys(targetObject)[0];
            makeObject(targetObject[rootnm]);

            if (option == '/latest') {
                var la_id = 'select_latest_resources ' + targetObject[rootnm].ri + ' - ' + require('shortid').generate();
                console.time(la_id);
                var latestObj = [];
                db_sql.select_latest_resources(connection, targetObject[rootnm], 1, latestObj, (code) => {
                    console.timeEnd(la_id);
                    if (code === '200') {
                        if (latestObj.length == 1) {
                            let strLatestObj = JSON.stringify(latestObj[0]).replace('RowDataPacket ', '');
                            latestObj[0] = JSON.parse(strLatestObj);

                            targetObject = {};
                            targetObject[responder.typeRsrc[latestObj[0].ty]] = latestObj[0];
                            makeObject(targetObject[Object.keys(targetObject)[0]]);

                            callback(targetObject);
                        }
                        else {
                            callback(null, 404);
                            return '0';
                        }
                    }
                    else {
                        callback(null, 500);
                        return '0';
                    }
                });
            }
            else if (option == '/oldest') {
                var ol_id = 'select_oldest_resources ' + targetObject[rootnm].ri + ' - ' + require('shortid').generate();
                console.time(ol_id);
                var oldestObj = [];
                db_sql.select_oldest_resources(connection, targetObject[rootnm], 1, oldestObj, (code) => {
                    console.timeEnd(ol_id);
                    if (code === '200') {
                        if (oldestObj.length == 1) {
                            let strOldestObj = JSON.stringify(oldestObj[0]).replace('RowDataPacket ', '');
                            oldestObj[0] = JSON.parse(strOldestObj);

                            targetObject = {};
                            targetObject[responder.typeRsrc[oldestObj[0].ty]] = oldestObj[0];
                            makeObject(targetObject[Object.keys(targetObject)[0]]);
                            callback(targetObject);
                        }
                        else {
                            callback(null, 404);
                            return '0';
                        }
                    }
                    else {
                        callback(null, 500);
                        return '0';
                    }
                });
            }
            else if (option.includes('/fopt')) {
                callback(targetObject, 200);
            }
            else {
                callback(targetObject, 200);
            }
        }
        else {
            callback(result, code);
        }
    });
}

function extra_api_action(connection, url, callback) {
    if (url === '/hit') {
        // for backup hit count
        if (0) {
            var _hit_old = JSON.parse(fs.readFileSync('hit.json', 'utf-8'));
            var _http = 0;
            var _mqtt = 0;
            var _coap = 0;
            var _ws = 0;

            for (var dd in _hit_old) {
                if (_hit_old.hasOwnProperty(dd)) {
                    for (var ff in _hit_old[dd]) {
                        if (_hit_old[dd].hasOwnProperty(ff)) {
                            if (Object.keys(_hit_old[dd][ff]).length > 0) {
                                for (var gg in _hit_old[dd][ff]) {
                                    if (_hit_old[dd][ff].hasOwnProperty(gg)) {
                                        if (_hit_old[dd][ff][gg] == null) {
                                            _hit_old[dd][ff][gg] = 0;
                                        }
                                        if (gg === 'H') {
                                            _http = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg === 'M') {
                                            _mqtt = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg === 'C') {
                                            _coap = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg === 'W') {
                                            _ws = _hit_old[dd][ff][gg];
                                        }
                                    }
                                }

                                db_sql.set_hit_n(connection, dd, _http, _mqtt, _coap, _ws, (err, results) => {
                                    results = null;
                                });
                            }
                        }
                    }
                }
            }
        }

        if (0) {
            var count = 0;
            setTimeout((count) => {
                if (count > 250) {
                    return;
                }
                var dd = moment().utc().subtract(count, 'days').format('YYYYMMDD');
                var _http = 5000 + Math.random() * 50000;
                var _mqtt = 1000 + Math.random() * 9000;
                var _coap = 0;
                var _ws = 0;

                db_sql.set_hit_n(connection, dd, _http, _mqtt, _coap, _ws, (err, results) => {
                    results = null;
                    console.log(count);
                    setTimeout(random_hit, 100, ++count);
                });
            }, 100, count);
        }

        db_sql.get_hit_all(connection, (err, result) => {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else if (url === '/total_ae') {
        db_sql.select_sum_ae(connection, function (err, result) {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else if (url === '/total_cbs') {
        db_sql.select_sum_cbs(connection, function (err, result) {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else {
        callback('200');
    }
}

let check_xm2m_headers = (request) => {
    if (!request.query.hasOwnProperty('fu')) {
        request.query.fu = 2;
    }

    if (!request.query.hasOwnProperty('rcn')) {
        request.query.rcn = 1;
    }

    if (!request.query.hasOwnProperty('rt')) {
        request.query.rt = 3;
    }

    // Check X-M2M-RVI Header
    if (!request.headers.hasOwnProperty('x-m2m-rvi')) {
        request.headers['x-m2m-rvi'] = uservi;
    }

    // Check X-M2M-RI Header
    if (request.headers.hasOwnProperty('x-m2m-ri')) {
        if (request.headers['x-m2m-ri'] === '') {
            return ('400-1');
        }
    }
    else {
        return ('400-1');
    }

    request.ty = '99';
    request.usebodytype = 'json';

    if (request.method === 'POST' || request.method === 'PUT') {
        if (request.body === "") {
            return ('400-40');
        }

        if (request.headers.hasOwnProperty('content-type')) {
            if (request.headers['content-type'].includes('json')) {
                request.usebodytype = 'json';
            }
            else {
                return ('400-64');
            }

            if (request.method === 'POST') {
                if (!request.headers['content-type'].includes('ty')) {
                    return ('400-19');
                }

                let content_type = request.headers['content-type'].split(';');
                for (var i in content_type) {
                    if (content_type.hasOwnProperty(i)) {
                        var ty_arr = content_type[i].replace(/ /g, '').split('=');
                        if (ty_arr[0].replace(/ /g, '') == 'ty') {
                            request.ty = ty_arr[1].replace(' ', '');
                            content_type = null;
                            break;
                        }
                    }
                }
            }

            let rcode = check_resource_supported(request);
            if (rcode === '200') {
                rcode = parse_body_format(request);
                if (rcode === '200') {
                    if (request.headers.rootnm === 'sgn') {
                        return ('notify');
                    }
                }
                else {
                    return rcode;
                }
            }
            else {
                return rcode;
            }
        }
        else {
            return ('400-20');
        }
    }

    if (request.ty === '5') {
        return ('405-1');
    }

    if (request.ty === '17') {
        return ('405-2');
    }

    if (request.ty === '2') {
        var allow = 1;
        if (allowed_app_ids.length > 0) {
            if(request.bodyObj.ae.hasOwnProperty('api')) {
                allow = 0;
                for (var idx in allowed_app_ids) {
                    if (allowed_app_ids.hasOwnProperty(idx)) {
                        if (allowed_app_ids[idx] == request.bodyObj.ae.api) {
                            allow = 1;
                            break;
                        }
                    }
                }
                if (allow == 0) {
                    return ('403-4');
                }
            }
            else {
                return ('400-65');
            }
        }
    }

    if (allowed_ae_ids.length > 0) {
        let allow = 0;
        if (usecseid === request.headers['x-m2m-origin']) {
            allow = 1;
        }
        else {
            for (var idx in allowed_ae_ids) {
                if (allowed_ae_ids.hasOwnProperty(idx)) {
                    if (allowed_ae_ids[idx] === request.headers['x-m2m-origin']) {
                        allow = 1;
                        break;
                    }
                }
            }
        }

        if (allow === 0) {
            return ('403-1');
        }
    }

    if (!responder.typeRsrc.hasOwnProperty(request.ty)) {
        return ('405-3');
    }

    return ('200');
}

const check_resource_supported = (request) => {
    try {
        request.headers.rootnm = '';
        let body = JSON.parse(request.body);
        let arr_rootnm = Object.keys(body)[0].split(':');
        let rootnm = '';
        if (arr_rootnm[0] === 'hd') {
            rootnm = Object.keys(body)[0].replace('hd:', 'hd_');
        }
        else {
            rootnm = Object.keys(body)[0].replace('m2m:', '');
        }

        let checkCount = 0;
        for (var key in responder.typeRsrc) {
            if (responder.typeRsrc.hasOwnProperty(key)) {
                if (responder.typeRsrc[key] === rootnm) {
                    request.ty = key;
                    break;
                }
                checkCount++;
            }
        }

        if (checkCount >= Object.keys(responder.typeRsrc).length) {
            return ('400-3');
        }
        else {
            request.headers.rootnm = rootnm;
            return ('200');
        }
    }
    catch (e) {
        return ('400-4');
    }
}

let getAbsoluteUrl = (request, response) => {
    request.url = request.url.replace('%23', '#'); // convert '%23' to '#' of url
    let req_url = url.parse(request.url);
    request.hash = req_url.hash;

    let absolute_url = request.url.replace('\/_\/', '\/\/').split('#')[0];
    absolute_url = absolute_url.replace(usespid, '/~');
    absolute_url = absolute_url.replace(/\/~\/[^\/]+\/?/, '/');
    let absolute_url_arr = absolute_url.split('/');

    console.log('\n' + request.method + ' : ' + request.url);

    request.option = '';

    let flag_fopt = 0;
    let _absolute_url_arr = absolute_url_arr.slice(1);
    for(let i in _absolute_url_arr) {
        if(_absolute_url_arr.hasOwnProperty(i)) {
            if(_absolute_url_arr[i] === 'fopt') {
                flag_fopt = i;
                break;
            }
        }
    }

    if (flag_fopt !== 0) {
        request.ri = '/' + _absolute_url_arr.slice(0, flag_fopt).join('/').replace('/fopt', '');
        request.ri = request.ri.replace(/\//g, '_')
        request.option = '/' + _absolute_url_arr.slice(flag_fopt).join('/');
    }
    else {
        if (absolute_url_arr[absolute_url_arr.length - 1] === 'la') {
            if (request.method.toLowerCase() === 'get' || request.method.toLowerCase() === 'delete') {
                request.ri = absolute_url.split('?')[0];
                request.ri = request.ri.substr(0, request.ri.length - 3);
                request.ri = request.ri.replace(/\//g, '_')
                request.option = '/latest';
            }
            else {
                return ('409-1');
            }
        }
        else if (absolute_url_arr[absolute_url_arr.length - 1] === 'latest') {
            if (request.method.toLowerCase() === 'get' || request.method.toLowerCase() === 'delete') {
                request.ri = absolute_url.split('?')[0];
                request.ri = request.ri.substr(0, request.ri.length - 7);
                request.ri = request.ri.replace(/\//g, '_')
                request.option = '/latest';
            }
            else {
                return ('409-1');
            }
        }
        else if (absolute_url_arr[absolute_url_arr.length - 1] === 'ol') {
            if (request.method.toLowerCase() === 'get' || request.method.toLowerCase() === 'delete') {
                request.ri = absolute_url.split('?')[0];
                request.ri = request.ri.substr(0, request.ri.length - 3);
                request.ri = request.ri.replace(/\//g, '_')
                request.option = '/oldest';
            }
            else {
                return ('409-2')
            }
        }
        else if (absolute_url_arr[absolute_url_arr.length - 1] === 'oldest') {
            if (request.method.toLowerCase() === 'get' || request.method.toLowerCase() === 'delete') {
                request.ri = absolute_url.split('?')[0];
                request.ri = request.ri.substr(0, request.ri.length - 7);
                request.ri = request.ri.replace(/\//g, '_')
                request.option = '/oldest';
            }
            else {
                return ('409-2')
            }
        }
        else {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.replace(/\//g, '_')
            request.option = '';
        }
    }

    request.absolute_url = absolute_url;
    absolute_url = null;

    return ('200');
}

let get_target_url = (request, response, callback) => {
    let code = getAbsoluteUrl(request);
    if (code === '200') {
        var tid = require('shortid').generate();
        console.time('get_resource_from_url' + ' (' + tid + ') - ' + request.absolute_url);
        get_resource_from_url(request.db_connection, request.ri, request.option, (targetObject, status) => {
            console.timeEnd('get_resource_from_url' + ' (' + tid + ') - ' + request.absolute_url);
            if (status === 404) {
                let req_url = url.parse(request.absolute_url);
                if (req_url.pathname.split('/')[1] === process.env.CB_NAME) {
                    callback('404-1');
                }
                else {
                    callback('301-1');
                }
            }
            else if (status === 500) {
                callback('500-1');
            }
            else {
                if (targetObject) {
                    request.targetObject = JSON.parse(JSON.stringify(targetObject));
                    targetObject = null;

                    callback('200');
                }
                else {
                    callback('404-1');
                }
            }
        });
    }
    else {
        callback(code);
    }
}

function check_type_update_resource(request) {
    for (var ty_idx in responder.typeRsrc) {
        if (responder.typeRsrc.hasOwnProperty(ty_idx)) {
            if ((ty_idx == 4) && (responder.typeRsrc[ty_idx] == Object.keys(request.bodyObj)[0])) {
                return ('405-7');
            }
            else if ((ty_idx != 4) && (responder.typeRsrc[ty_idx] == Object.keys(request.bodyObj)[0])) {
                if ((ty_idx == 17) && (responder.typeRsrc[ty_idx] == Object.keys(request.bodyObj)[0])) {
                    return ('405-8');
                }
                else {
                    request.ty = ty_idx;
                    break;
                }
            }
            else if (ty_idx == 13) {
                for (var mgo_idx in responder.mgoType) {
                    if (responder.mgoType.hasOwnProperty(mgo_idx)) {
                        if ((responder.mgoType[mgo_idx] == Object.keys(request.bodyObj)[0])) {
                            request.ty = ty_idx;
                            break;
                        }
                    }
                }
            }
        }
    }

    let _url = url.parse(request.targetObject[Object.keys(request.targetObject)[0]].ri.replace(/_/g, '\/'));
    if (_url.pathname == ('/' + usecsebase)) {
        return ('405-9');
    }

    return ('200');
}

function check_type_delete_resource(request) {
    let _url = url.parse(request.targetObject[Object.keys(request.targetObject)[0]].ri.replace(/_/g, '\/'));
    if (_url.pathname == ('/' + usecsebase)) {
        return ('405-9');
    }
    else {
        return ('200');
    }
}

var onem2mParser = bodyParser.text(
    {
        limit: '5mb',
        type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
    }
);

//////// contribution code
// Kevin Lee, Executive Director, Unibest INC, Owner of Howchip.com
// Process for CORS problem
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
    res.header('Access-Control-Expose-Headers', 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
    (req.method == 'OPTIONS') ? res.sendStatus(200) : next();
});

app.use((req, res, next) => {
    var fullBody = '';
    req.on('data', (chunk) => {
        fullBody += chunk.toString();
    });

    req.on('end', () => {
        req.body = fullBody;

        if (req.hasOwnProperty('headers')) {
            if (!req.hasOwnProperty('binding')) {
                req.headers['binding'] = 'H';
            }

            db.getConnection((code, connection) => {
                if (code === '200') {
                    db_sql.set_hit(connection, request.headers['binding'], (err, results) => {
                        results = null;

                        connection.release();
                    });
                }
            });
        }
        else {
            req.rawHeaders = ["Accept", "application/json"];
        }

        let rcode = check_xm2m_headers(req);
        if (rcode === '200') {
            next();
        }
        else if(rcode === 'notify') {
            // check_ae_notify(req, res, (code, res) => {
            //     if (code === '200') {
            //         connection.release();
            //
            //         if (res.headers['content-type']) {
            //             response.header('Content-Type', res.headers['content-type']);
            //         }
            //         if (res.headers['x-m2m-ri']) {
            //             response.header('X-M2M-RI', res.headers['x-m2m-ri']);
            //         }
            //         if (res.headers['x-m2m-rvi']) {
            //             response.header('X-M2M-RVI', res.headers['x-m2m-rvi']);
            //         }
            //         if (res.headers['x-m2m-rsc']) {
            //             response.header('X-M2M-RSC', res.headers['x-m2m-rsc']);
            //         }
            //         if (res.headers['content-location']) {
            //             response.header('Content-Location', res.headers['content-location']);
            //         }
            //
            //         response.statusCode = res.statusCode;
            //         response.send(res.body);
            //
            //         res = null;
            //         request = null;
            //         response = null;
            //     }
            //     else {
            //         responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
            //             connection.release();
            //             request = null;
            //             response = null;
            //         });
            //     }
            // });
        }
        else {
            responder.error_result(req, res, resultStatusCode[rcode][0], resultStatusCode[rcode][1], resultStatusCode[rcode][2], () => {
                req = null;
                res = null;
            });
        }
    });
});
// var heapdump = require('heapdump');
// app.use('/heapdump',function(req,res,next){
//     var filename = Date.now() + '.heapsnapshot';
//     heapdump.writeSnapshot(filename);
//     res.send('Heapdump has been generated in '+filename);
// });

// var graphqlHTTP = require('express-graphql');
// var { buildSchema } = require('graphql');
//
// var schema = buildSchema(`
//     type Query {
//         hello: String
//     }
// `);
//
// var root = { hello: () => 'Hello world!' };
//
// app.use('/' + usecsebase + '/discovery', graphqlHTTP({
//     schema: schema,
//     rootValue: root,
//     graphiql: true,
// }));

// remoteCSE, ae, cnt
app.post(onem2mParser, (request, response) => {
    db.getConnection((code, connection) => {
        if (code === '200') {
            request.db_connection = connection;
            get_target_url(request, response, (code) => {
                if (code === '200') {
                    if (request.option !== '/fopt') {
                        var rootnm = Object.keys(request.targetObject)[0];
                        var absolute_url = request.targetObject[rootnm].ri.replace(/_/g, '\/');
                        request.url = absolute_url;
                        if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1 || request.query.rcn == 2 || request.query.rcn == 3)) {
                            lookup_create(request, response, (code) => {
                                if (code === '201') {
                                    responder.response_result(request, response, '201', '2001', '', () => {
                                        connection.release();
                                        request = null;
                                        response = null;
                                    });
                                }
                                else if (code === '201-3') {
                                    responder.response_rcn3_result(request, response, '201', '2001', '', () => {
                                        connection.release();
                                        request = null;
                                        response = null;
                                    });
                                }
                                else if (code === '202-1') {
                                    responder.response_result(request, response, '202', '1001', '', () => {
                                        connection.release();
                                        request = null;
                                        response = null;
                                    });
                                }
                                else if (code === '202-2') {
                                    responder.response_result(request, response, '202', '1002', '', () => {
                                        connection.release();
                                        request = null;
                                        response = null;
                                    });
                                }
                                else {
                                    responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                        connection.release();
                                        request = null;
                                        response = null;
                                    });
                                }
                            });
                        }
                        else {
                            let rcode = '400-43';
                            responder.error_result(request, response, resultStatusCode[rcode][0], resultStatusCode[rcode][1], resultStatusCode[rcode][2], () => {
                                connection.release();
                                request = null;
                                response = null;
                            });
                        }
                    }
                    else { // if (request.option === '/fopt') {
                        check_grp(request, response, (rsc, result_grp) => { // check access right for fanoutpoint
                            if (rsc == '1') {
                                var access_value = '1';
                                var body_Obj = {};
                                security.check(request, response, request.targetObject[Object.keys(request.targetObject)[0]].ty, result_grp.macp, access_value, result_grp.cr, (code) => {
                                    if (code === '1') {
                                        fopt.check(request, response, result_grp, body_Obj, (code) => {
                                            if (code === '200') {
                                                responder.search_result(request, response, '200', '2000', '', () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                            else {
                                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                        });
                                    }
                                    else if (code === '0') {
                                        response_error_result(request, response, '403-5', () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                    else {
                                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else if (rsc == '2') {
                                code = '403-6';
                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                            else {
                                code = '404-4';
                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        });
                    }
                }
                else if (code === '301-1') {
                    check_csr(request, response, (code) => {
                        if (code === '301-2') {
                            response.status(response.statusCode).end(response.body);
                            connection.release();
                            request = null;
                            response = null;
                        }
                        else {
                            responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                connection.release();
                                request = null;
                                response = null;
                            });
                        }
                    });
                }
                else {
                    responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                        connection.release();
                        request = null;
                        response = null;
                    });
                }
            });
        }
        else {
            responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                request = null;
                response = null;
            });
        }
    });
});

const extra_api_list = [
    '/hit', '/total_ae', '/total_cbs'
];

app.get(onem2mParser, (request, response) => {
    if(extra_api_list.includes(request.url)) {
        db.getConnection((code, connection) => {
            if (code === '200') {
                extra_api_action(connection, request.url, (code, result) => {
                    if (code === '200') {
                    }
                    else if (code === '201') {
                        connection.release();
                        response.header('Content-Type', 'application/json');
                        response.status(200).end(JSON.stringify(result, null, 4));
                        result = null;
                    }
                    else {
                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                            connection.release();
                            request = null;
                            response = null;
                        });
                    }
                });
            }
            else {
                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                    request = null;
                    response = null;
                });
            }
        });
    }
    else {
        db.getConnection((code, connection) => {
            if (code === '200') {
                request.db_connection = connection;
                get_target_url(request, response, (code) => {
                    if (code === '200') {
                        //if (request.option !== '/fopt') {
                        if (!request.option.includes('/fopt')) {
                            var rootnm = Object.keys(request.targetObject)[0];
                            request.url = request.targetObject[rootnm].ri.replace(/_/g, '\/');
                            if ((request.query.fu == 1 || request.query.fu == 2) && (request.query.rcn == 1 || request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6 || request.query.rcn == 8)) {
                                lookup_retrieve(request, response, (code) => {
                                    if (code === '200') {
                                        responder.response_result(request, response, '200', '2000', '', () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                    else if (code === '200-1') {
                                        responder.search_result(request, response, '200', '2000', '', () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                    else {
                                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else {
                                response_error_result(request, response, '400-44', () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        }
                        else { //if (request.option === '/fopt') {
                            let rcode = check_grp(request.targetObject);
                            if (rcode == '200') {
                                let access_value = (request.query.fu == 1) ? '32' : '2';
                                let body_Obj = {};
                                let rootnm = Object.keys(request.targetObject)[0];
                                let result_grp = request.targetObject[rootnm];
                                security.check(request, response, result_grp.ty, result_grp.macp, access_value, result_grp.cr, (code) => {
                                    if (code === '1') {
                                        fopt.check(request, response, result_grp, body_Obj, (code) => {
                                            if (code === '200') {
                                                responder.search_result(request, response, '200', '2000', '', () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                            else {
                                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                        });
                                    }
                                    else if (code === '0') {
                                        code = '403-5';
                                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                    else {
                                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else {
                                responder.error_result(request, response, resultStatusCode[rcode][0], resultStatusCode[rcode][1], resultStatusCode[rcode][2], () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        }
                    }
                    else if (code === '301-1') {
                        check_csr(request, response, (code) => {
                            if (code === '301-2') {
                                connection.release();
                                response.status(response.statusCode).end(response.body);
                                request = null;
                                response = null;
                            }
                            else {
                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        });
                    }
                    else {
                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                            connection.release();
                            request = null;
                            response = null;
                        });
                    }
                });
            }
            else {
                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                    request = null;
                    response = null;
                });
            }
        });
    }
});


app.put(onem2mParser, (request, response) => {
    db.getConnection((code, connection) => {
        if (code === '200') {
            request.db_connection = connection;
            get_target_url(request, response, (code) => {
                if (code === '200') {
                    if (request.option !== '/fopt') {
                        rcode = check_type_update_resource(request);
                        if (rcode === '200') {
                            let rootnm = Object.keys(request.targetObject)[0];
                            request.url = request.targetObject[rootnm].ri.replace(/_/g, '\/');
                            if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1)) {
                                lookup_update(request, response, (code) => {
                                    if (code === '200') {
                                        if (cache_resource_url.hasOwnProperty(request.url)) {
                                            delete cache_resource_url[request.url];
                                        }

                                        responder.response_result(request, response, '200', '2004', '', () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                    else {
                                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else {
                                response_error_result(request, response, '400-45', () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        }
                        else {
                            responder.error_result(request, response, resultStatusCode[rcode][0], resultStatusCode[rcode][1], resultStatusCode[rcode][2], () => {
                                connection.release();
                                request = null;
                                response = null;
                            });
                        }
                    }
                    else { // if (request.option === '/fopt') {
                        check_grp(request, response, (rsc, result_grp) => { // check access right for fanoutpoint
                            if (rsc == '1') {
                                var access_value = '4';
                                var body_Obj = {};
                                security.check(request, response, request.targetObject[Object.keys(request.targetObject)[0]].ty, result_grp.macp, access_value, result_grp.cr, (code) => {
                                    if (code === '1') {
                                        fopt.check(request, response, result_grp, body_Obj, (code) => {
                                            if (code === '200') {
                                                responder.search_result(request, response, '200', '2000', '', () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                            else {
                                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                        });
                                    }
                                    else if (code === '0') {
                                        response_error_result(request, response, '403-5', () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                    else {
                                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else if (rsc == '2') {
                                code = '403-6';
                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                            else {
                                response_error_result(request, response, '404-4', () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        });
                    }
                }
                else if (code === '301-1') {
                    check_csr(request, response, (code) => {
                        if (code === '301-2') {
                            connection.release();
                            response.status(response.statusCode).end(response.body);
                            request = null;
                            response = null;
                        }
                        else {
                            responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                connection.release();
                                request = null;
                                response = null;
                            });
                        }
                    });
                }
                else {
                    responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                        connection.release();
                        request = null;
                        response = null;
                    });
                }
            });
        }
        else {
            responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                request = null;
                response = null;
            });
        }
    });
});

app.delete(onem2mParser, (request, response) => {
    db.getConnection((code, connection) => {
        if (code === '200') {
            request.db_connection = connection;
            get_target_url(request, response, (code) => {
                if (code === '200') {
                    if (request.option !== '/fopt') {
                        let rcode = check_type_delete_resource(request);
                        if (rcode === '200') {
                            var rootnm = Object.keys(request.targetObject)[0];
                            request.url = request.targetObject[rootnm].ri.replace(/_/g, '\/');
                            request.pi = request.targetObject[rootnm].pi;
                            if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1)) {
                                lookup_delete(request, response, (code) => {
                                    if (code === '200') {
                                        if(cache_resource_url.hasOwnProperty(request.url)) {
                                            delete cache_resource_url[request.url];
                                        }

                                        if(cache_resource_url.hasOwnProperty(request.pi.replace(/_/g, '\/') + '/la')) {
                                            delete cache_resource_url[request.pi.replace(/_/g, '\/') + '/la'];
                                        }

                                        Object.keys(cache_resource_url).forEach((_url) => {
                                            if(_url.includes(request.url+'/')) {
                                                delete cache_resource_url[_url];
                                            }
                                        });

                                        responder.response_result(request, response, '200', '2002', '', () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                    else {
                                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else {
                                response_error_result(request, response, '400-46', () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        }
                        else {
                            responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                connection.release();
                                request = null;
                                response = null;
                            });
                        }
                    }
                    else { // if (request.option === '/fopt') {
                        check_grp(request, response, (rsc, result_grp) => { // check access right for fanoutpoint
                            if (rsc == '1') {
                                var access_value = '8';
                                var body_Obj = {};
                                security.check(request, response, request.targetObject[Object.keys(request.targetObject)[0]].ty, result_grp.macp, access_value, result_grp.cr, (code) => {
                                    if (code === '1') {
                                        fopt.check(request, response, result_grp, body_Obj, (code) => {
                                            if (code === '200') {
                                                responder.search_result(request, response, '200', '2000', '', () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                            else {
                                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                                    connection.release();
                                                    request = null;
                                                    response = null;
                                                });
                                            }
                                        });
                                    }
                                    else if (code === '0') {
                                        response_error_result(request, response, '403-5', () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                    else {
                                        responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                            connection.release();
                                            request = null;
                                            response = null;
                                        });
                                    }
                                });
                            }
                            else if (rsc == '2') {
                                code = '403-6';
                                responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                            else {
                                response_error_result(request, response, '404-4', () => {
                                    connection.release();
                                    request = null;
                                    response = null;
                                });
                            }
                        });
                    }
                }
                else if (code === '301-1') {
                    check_csr(request, response, (code) => {
                        if (code === '301-2') {
                            connection.release();
                            response.status(response.statusCode).end(response.body);
                            request = null;
                            response = null;
                        }
                        else {
                            responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                                connection.release();
                                request = null;
                                response = null;
                            });
                        }
                    });
                }
                else {
                    responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                        connection.release();
                        request = null;
                        response = null;
                    });
                }
            });
        }
        else {
            responder.error_result(request, response, resultStatusCode[code][0], resultStatusCode[code][1], resultStatusCode[code][2], () => {
                request = null;
                response = null;
            });
        }
    });
});

const check_notification = (request) => {
    if (request.headers.hasOwnProperty('content-type')) {
        if (request.headers.rootnm === 'sgn') {
            return ('notify');
        }
        else {
            return ('400-19');
        }
    }
    else {
        return ('400-20');
    }
}

function check_ae_notify(request, response, callback) {
    var ri = request.targetObject[Object.keys(request.targetObject)[0]].ri;
    console.log('[check_ae_notify] : ' + ri);
    db_sql.select_ae(ri, (err, result_ae) => {
        if (!err) {
            if (result_ae.length == 1) {
                var point = {};
                var poa_arr = JSON.parse(result_ae[0].poa);
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = new URL(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        console.log('send notification to ' + poa_arr[i]);
                        notify_http(poa.hostname, poa.port, poa.path, request.method, request.headers, request.body, (code, res) => {
                            callback(code, res)
                        });
                    }
                    else if (poa.protocol == 'coap:') {
                        console.log('send notification to ' + poa_arr[i]);
                        callback('405-12');
                    }
                    else if (poa.protocol == 'mqtt:') {
                        callback('405-10');
                    }
                    else if (poa.protocol == 'ws:') {
                        callback('405-11');
                    }
                    else {
                        callback('400-47');
                    }
                }
            }
            else {
                callback('404-6');
            }
        }
        else {
            console.log('[check_ae_notify] query error: ' + result_ae.message);
            callback('500-1');
        }
    });
}

function check_csr(request, response, callback) {
    let _url = url.parse(request.absolute_url);
    var ri = util.format('_%s_%s', usecsebase, _url.pathname.split('/')[1]);
    console.log('[check_csr] : ' + ri);
    db_sql.select_csr(request.db_connection, ri, (err, result_csr) => {
        if (!err) {
            if (result_csr.length == 1) {
                var point = {};
                point.forwardcbname = result_csr[0].cb.replace('/', '');
                var poa_arr = JSON.parse(result_csr[0].poa);
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = new URL(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        point.forwardcbhost = poa.hostname;
                        point.forwardcbport = poa.port;

                        console.log('csebase forwarding to ' + point.forwardcbname);

                        forward_http(point.forwardcbhost, point.forwardcbport, request.url, request.method, request.headers, request.body, (code, _res) => {
                            if (code === '200') {
                                var res = JSON.parse(JSON.stringify(_res));
                                _res = null;
                                if (res.headers.hasOwnProperty('content-type')) {
                                    response.setHeader('Content-Type', res.headers['content-type']);
                                }

                                if (res.headers.hasOwnProperty('x-m2m-ri')) {
                                    response.setHeader('X-M2M-RI', res.headers['x-m2m-ri']);
                                }

                                if (res.headers.hasOwnProperty('x-m2m-rvi')) {
                                    response.setHeader('X-M2M-RVI', res.headers['x-m2m-rvi']);
                                }

                                if (res.headers.hasOwnProperty('x-m2m-rsc')) {
                                    response.setHeader('X-M2M-RSC', res.headers['x-m2m-rsc']);
                                }

                                if (res.headers.hasOwnProperty('content-location')) {
                                    response.setHeader('Content-Location', res.headers['content-location']);
                                }

                                response.body = res.body;
                                response.statusCode = res.statusCode;

                                callback('301-2');
                            }
                            else {
                                callback(code);
                            }
                        });
                    }
                    else if (poa.protocol == 'mqtt:') {
                        point.forwardcbmqtt = poa.hostname;
                        console.log('forwarding with mqtt is not supported');

                        callback('301-3');
                    }
                    else {
                        console.log('protocol in poa of csr is not supported');

                        callback('301-4');
                    }
                }
                result_csr = null;
            }
            else {
                result_csr = null;
                callback('404-3');
            }
        }
        else {
            console.log('[check_csr] query error: ' + result_csr.message);
            callback('404-3');
        }
    });
}


function notify_http(hostname, port, path, method, headers, bodyString, callback) {
    var options = {
        hostname: hostname,
        port: port,
        path: path,
        method: method,
        headers: headers
    };

    var req = http.request(options, (res) => {
        var fullBody = '';
        res.on('data', (chunk) => {
            fullBody += chunk.toString();
        });

        res.on('end', () => {
            console.log('--------------------------------------------------------------------------');
            console.log(fullBody);
            console.log('[notify_http response : ' + res.statusCode + ']');

            callback('200', res);
        });
    });

    req.on('error', (e) => {
        console.log('[forward_http] problem with request: ' + e.message);

        callback('404-7');
    });

    console.log(method + ' - ' + path);
    console.log(bodyString);

    // write data to request body
    if ((method.toLowerCase() == 'get') || (method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(bodyString);
    }
    req.end();
}

function forward_http(forwardcbhost, forwardcbport, f_url, f_method, f_headers, f_body, callback) {
    var options = {
        hostname: forwardcbhost,
        port: forwardcbport,
        path: f_url,
        method: f_method,
        headers: f_headers
    };

    var req = http.request(options, (res) => {
        var fullBody = '';

        res.on('data', (chunk) => {
            fullBody += chunk.toString();
        });

        res.on('end', () => {
            res.body = fullBody;

            console.log('--------------------------------------------------------------------------');
            console.log(res.url);
            console.log(res.headers);
            console.log(res.body);
            console.log('[Forward response : ' + res.statusCode + ']');

            callback('200', res);
        });
    });

    req.on('error', (e) => {
        console.log('[forward_http] problem with request: ' + e.message);

        callback('404-3');
    });

    console.log(f_method + ' - ' + f_url);
    console.log(f_headers);
    console.log(f_body);

    // write data to request body
    if ((f_method.toLowerCase() == 'get') || (f_method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(f_body);
    }
    req.end();
}

if (process.env.NODE_ENV == 'production') {
    console.log("Production Mode");
}
else if (process.env.NODE_ENV == 'development') {
    console.log("Development Mode");
}

function scheduleGc() {
    if (!global.gc) {
        console.log('Garbage collection is not exposed');
        return;
    }

    // schedule next gc within a random interval (e.g. 15-45 minutes)
    // tweak this based on your app's memory usage
    var nextMinutes = Math.random() * 30 + 15;

    setTimeout(() => {
        global.gc();
        console.log('Manual gc', process.memoryUsage());
        scheduleGc();
    }, nextMinutes * 60 * 60 * 1000);
}

// call this in the startup script of your app (once per process)
scheduleGc();
