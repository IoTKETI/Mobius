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
var merge = require('merge');
var moment = require('moment');

var db_sql = require('./sql_action');

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
    resource_Obj[rootnm].et = moment().utc().add(10, 'years').format('YYYYMMDDTHHmmss');
    resource_Obj[rootnm].acpi = [];
    resource_Obj[rootnm].lbl = [];
    resource_Obj[rootnm].lbl[0] = resource_Obj[rootnm].rn;
    resource_Obj[rootnm].at = [];
    resource_Obj[rootnm].aa = [];
    resource_Obj[rootnm].st = '0';

    //resource_Obj[rootnm].csi = '/0.2.481.1.' + randomIntInc(1, 10000000000);
    //resource_Obj[rootnm].csi = '/'+resource_Obj[rootnm].rn;
    resource_Obj[rootnm].csi = usecseid;

    resource_Obj[rootnm].srt = [];
    resource_Obj[rootnm].srt.push('1');
    resource_Obj[rootnm].srt.push('2');
    resource_Obj[rootnm].srt.push('3');
    resource_Obj[rootnm].srt.push('4');
    resource_Obj[rootnm].srt.push('9');
    resource_Obj[rootnm].srt.push('10');
    resource_Obj[rootnm].srt.push('16');
    resource_Obj[rootnm].srt.push('17');
    resource_Obj[rootnm].srt.push('23');
    resource_Obj[rootnm].srt.push('24');
    resource_Obj[rootnm].srt.push('29');
    resource_Obj[rootnm].srt.push('30');

    resource_Obj[rootnm].poa = [];
    resource_Obj[rootnm].poa[0] = 'http://' + ip.address() + ':' + usecsebaseport;
    //resource_Obj[rootnm].poa[1] = 'mqtt://' + ip.address() + '/' + resource_Obj[rootnm].csi.replace('/', ':');

    resource_Obj[rootnm].nl = '';
    resource_Obj[rootnm].ncp = '';
    resource_Obj[rootnm].cst = '1';
    resource_Obj[rootnm].mni = '3153600000';
    resource_Obj[rootnm].cs = '';

    db_sql.select_ri_lookup(resource_Obj[rootnm].ri, function (err, results_ri) {
        if(!err) {
            if(results_ri.length == 1) {
                db_sql.update_cb_poa_csi(JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].csi, resource_Obj[rootnm].ri, function (err, results) {
                    if (!err) {
                        usecseid = resource_Obj[rootnm].csi;
                        rspObj.rsc = '2004';
                        rspObj.ri = resource_Obj[rootnm].ri;
                        rspObj = '';
                        callback(rspObj);
                    }
                    else {
                        rspObj.rsc = '5000';
                        rspObj.ri = resource_Obj[rootnm].ri;
                        rspObj = results.message;
                        callback(rspObj);
                    }
                });
            }
            else {
                db_sql.get_sri_sri(resource_Obj[rootnm].pi, function (err, results) {
                    if (!err) {
                        resource_Obj[rootnm].spi = (results.length == 0) ? '' : results[0].sri;
                        resource_Obj[rootnm].sri = require('shortid').generate();
                        db_sql.insert_cb(resource_Obj[rootnm].ty, resource_Obj[rootnm].ri, resource_Obj[rootnm].rn, resource_Obj[rootnm].pi, resource_Obj[rootnm].ct,
                            resource_Obj[rootnm].lt, resource_Obj[rootnm].et, JSON.stringify(resource_Obj[rootnm].acpi), JSON.stringify(resource_Obj[rootnm].lbl), JSON.stringify(resource_Obj[rootnm].at),
                            JSON.stringify(resource_Obj[rootnm].aa), resource_Obj[rootnm].st, resource_Obj[rootnm].mni, resource_Obj[rootnm].cs, resource_Obj[rootnm].sri, resource_Obj[rootnm].spi, resource_Obj[rootnm].cst, resource_Obj[rootnm].csi, JSON.stringify(resource_Obj[rootnm].srt), JSON.stringify(resource_Obj[rootnm].poa),
                            resource_Obj[rootnm].nl, resource_Obj[rootnm].ncp, function (err, results) {
                            if (!err) {
                                rspObj.rsc = '2001';
                                rspObj.ri = resource_Obj[rootnm].ri;
                                rspObj = '';
                            }
                            else {
                                rspObj.rsc = '5000';
                                rspObj.ri = resource_Obj[rootnm].ri;
                                rspObj = results.message;
                            }
                            callback(rspObj);
                        });
                    }
                });
            }
        }
        else {
            rspObj.rsc = '5000';
            rspObj.ri = resource_Obj[rootnm].ri;
            rspObj = results_ri.message;
            callback(rspObj);
        }
    });
}

exports.create = function(callback) {
    parse_create_action(function(rspObj) {
        callback(rspObj);
    });
};

