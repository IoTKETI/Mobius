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

var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var ip = require('ip');
var http = require('http');
var js2xmlparser = require("js2xmlparser");
var merge = require('merge');

var db = require('./db_action');


function parse_create_action(callback) {
    var rootnm = 'cb';
    var rspObj = {};
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    var cur_d = new Date();

    resource_Obj[rootnm].ty = '5';
    resource_Obj[rootnm].rn = usecsebase;
    resource_Obj[rootnm].pi = '';
    resource_Obj[rootnm].ri = resource_Obj[rootnm].pi + '/' + resource_Obj[rootnm].rn;
    resource_Obj[rootnm].ct = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;
    resource_Obj[rootnm].et = '';
    resource_Obj[rootnm].acpi = [];
    resource_Obj[rootnm].lbl = [];
    resource_Obj[rootnm].lbl[0] = resource_Obj[rootnm].rn;
    resource_Obj[rootnm].at = [];
    resource_Obj[rootnm].aa = [];
    resource_Obj[rootnm].st = '0';

    //resource_Obj[rootnm].csi = '/0.2.481.1.' + randomIntInc(1, 10000000000);
    resource_Obj[rootnm].csi = '/'+resource_Obj[rootnm].rn;

    resource_Obj[rootnm].srt = [];
    resource_Obj[rootnm].srt.push('1');
    resource_Obj[rootnm].srt.push('2');
    resource_Obj[rootnm].srt.push('3');
    resource_Obj[rootnm].srt.push('4');
    resource_Obj[rootnm].srt.push('10');
    resource_Obj[rootnm].srt.push('16');
    resource_Obj[rootnm].srt.push('23');
    resource_Obj[rootnm].srt.push('25');
    resource_Obj[rootnm].srt.push('26');
    resource_Obj[rootnm].srt.push('28');

    resource_Obj[rootnm].poa = [];
    resource_Obj[rootnm].poa.push('http://' + ip.address() + ':' + usecsebaseport);
    resource_Obj[rootnm].poa.push('mqtt://' + ip.address() + '/' + resource_Obj[rootnm].csi.replace('/', ':'));

    resource_Obj[rootnm].nl = '';
    resource_Obj[rootnm].ncp = '';
    resource_Obj[rootnm].cst = '1';
    resource_Obj[rootnm].mni = '';
    resource_Obj[rootnm].cs = '';

    // for mongodb
    var queryJson = {};
    var lookupJson = {};
    var resourceJson = {};
    queryJson.type = 'select';
    lookupJson.ri = resource_Obj[rootnm].ri;
    queryJson.table = 'lookup';
    queryJson.values = lookupJson;

    var sql = util.format('SELECT ri FROM lookup where ri=\'%s\'', resource_Obj[rootnm].ri);
    db.getResult(sql, queryJson, function (err, results_comm) {
        if(!err) {
            if(results_comm.length == 1) {
                lookupJson.ri = resource_Obj[rootnm].ri;
                queryJson.table = 'cb';
                queryJson.values = lookupJson;
                sql = util.format('SELECT csi FROM cb where ri=\'%s\'', resource_Obj[rootnm].ri);
                db.getResult(sql, queryJson, function (err, results_cb) {
                    if (!err) {
                        if (results_cb.length == 1) {
                            usecseid = results_cb[0].csi;

                            lookupJson.ri = resource_Obj[rootnm].ri;
                            queryJson.table = 'cb';
                            queryJson.values = lookupJson;

                            sql = util.format('update cb set poa = \'%s\', csi = \'%s\' where ri=\'%s\'', JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].csi, resource_Obj[rootnm].ri);
                            db.getResult(sql, queryJson, function (err, results) {
                                if (!err) {
                                    rspObj.rsc = '2004';
                                    rspObj.ri = resource_Obj[rootnm].ri;
                                    rspObj.sts = '';
                                    callback(rspObj);
                                }
                            });
                        }
                    }
                    else {
                        rspObj.rsc = '5000';
                        rspObj.ri = resource_Obj[rootnm].ri;
                        rspObj.sts = results_comm.code;
                        callback(rspObj);
                    }
                });
            }
            else {
                queryJson.type = 'insert';
                lookupJson.ty = resource_Obj[rootnm].ty;
                lookupJson.ri = resource_Obj[rootnm].ri;
                lookupJson.rn = resource_Obj[rootnm].rn;
                lookupJson.pi = resource_Obj[rootnm].pi;
                lookupJson.ct = resource_Obj[rootnm].ct;
                lookupJson.lt = resource_Obj[rootnm].lt;
                lookupJson.et = resource_Obj[rootnm].et;
                lookupJson.acpi = resource_Obj[rootnm].acpi;
                lookupJson.lbl = resource_Obj[rootnm].lbl;
                lookupJson.at = resource_Obj[rootnm].at;
                lookupJson.aa = resource_Obj[rootnm].aa;
                lookupJson.st = resource_Obj[rootnm].st;
                lookupJson.mni = resource_Obj[rootnm].mni;
                lookupJson.cs = resource_Obj[rootnm].cs;
                queryJson.table = 'lookup';
                queryJson.values = lookupJson;

                sql = util.format('INSERT INTO lookup (' +
                    'ty, ri, rn, pi, ct, lt, et, acpi, lbl, at, aa, st, mni, cs) ' +
                    'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                    resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                    resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                    JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs);
                db.getResult(sql, queryJson, function (err, results) {
                    if(!err) {
                        resourceJson.ri = resource_Obj[rootnm].ri;
                        resourceJson.cst = resource_Obj[rootnm].cst;
                        resourceJson.csi = resource_Obj[rootnm].csi;
                        resourceJson.srt = resource_Obj[rootnm].srt;
                        resourceJson.poa = resource_Obj[rootnm].poa;
                        resourceJson.nl = resource_Obj[rootnm].nl;
                        resourceJson.ncp = resource_Obj[rootnm].ncp;
                        queryJson.table = 'cb';
                        queryJson.values = resourceJson;

                        sql = util.format('INSERT INTO cb (' +
                            'ri, cst, csi, srt, poa, nl, ncp) ' +
                            'VALUE (\'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\', \'%s\')',
                            resource_Obj[rootnm].ri, resource_Obj[rootnm].cst, resource_Obj[rootnm].csi, JSON.stringify(resource_Obj[rootnm].srt), JSON.stringify(resource_Obj[rootnm].poa),
                            resource_Obj[rootnm].nl, resource_Obj[rootnm].ncp);
                        db.getResult(sql, queryJson, function (err, results) {
                            if(!err) {
                                rspObj.rsc = '2001';
                                rspObj.ri = resource_Obj[rootnm].ri;
                                rspObj.sts = '';
                            }
                            else {
                                rspObj.rsc = '5000';
                                rspObj.ri = resource_Obj[rootnm].ri;
                                rspObj.sts = results.code;
                            }
                            callback(rspObj);
                        });
                    }
                    else {
                        rspObj.rsc = '5000';
                        rspObj.ri = resource_Obj[rootnm].ri;
                        rspObj.sts = results.code;
                        callback(rspObj);
                    }
                });
            }
        }
        else {
            rspObj.rsc = '5000';
            rspObj.ri = resource_Obj[rootnm].ri;
            rspObj.sts = results_comm.code;
            callback(rspObj);
        }
    });
}

exports.create = function(callback) {
    parse_create_action(function(rspObj) {
        callback(rspObj);
    });
};

