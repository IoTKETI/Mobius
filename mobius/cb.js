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

var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var ip = require('ip');
var http = require('http');
var merge = require('merge');
var moment = require('moment');

var db_sql = require('./sql_action');

function cb_create_action(connection, callback) {
    var rootnm = 'cb';
    var rspObj = {};
    var resource_Obj = {};
    resource_Obj[rootnm] = {};

    var cur_d = new Date();

    resource_Obj[rootnm].ty = '5';
    resource_Obj[rootnm].rn = usecsebase;
    resource_Obj[rootnm].pi = '';
    resource_Obj[rootnm].ri = resource_Obj[rootnm].pi + '/' + resource_Obj[rootnm].rn;
    resource_Obj[rootnm].ct = moment().utc().format('YYYYMMDDTHHmmss');
    resource_Obj[rootnm].lt = resource_Obj[rootnm].ct;
    resource_Obj[rootnm].et = moment().utc().add(10, 'years').format('YYYYMMDDTHHmmss');
    resource_Obj[rootnm].acpi = [];
    resource_Obj[rootnm].lbl = [];
    resource_Obj[rootnm].lbl[0] = resource_Obj[rootnm].rn;
    resource_Obj[rootnm].at = [];
    resource_Obj[rootnm].aa = [];
    resource_Obj[rootnm].st = '0';
    resource_Obj[rootnm].srv = [];
    resource_Obj[rootnm].subl = [];

    resource_Obj[rootnm].srv.push('1');
    resource_Obj[rootnm].srv.push('2');
    resource_Obj[rootnm].srv.push('2a');

    resource_Obj[rootnm].csi = usecseid;

    //resource_Obj[rootnm].srt = ty_list;
    resource_Obj[rootnm].srt = ['1', '2', '3', '4', '5', '9', '10', '13', '14', '16', '17', '23'];

    resource_Obj[rootnm].poa = [];
    resource_Obj[rootnm].poa.push('http://' + ip.address() + ':' + usecsebaseport);
//    resource_Obj[rootnm].poa.push('mqtt://' + ip.address() + ':' + use_mqtt_port + '/' + resource_Obj[rootnm].csi.replace('/', ''));
//    resource_Obj[rootnm].poa.push('coap://' + ip.address() + ':' + usecsebaseport);
//    resource_Obj[rootnm].poa.push('ws://' + ip.address() + ':' + usepxywsport);

    resource_Obj[rootnm].nl = '';
    resource_Obj[rootnm].ncp = '';
    resource_Obj[rootnm].cst = '1';

    db_sql.select_ri_lookup(connection, resource_Obj[rootnm].ri, function (err, results_ri) {
        if(!err) {
            if(results_ri.length == 1) {
                db_sql.update_cb_poa_csi(connection, JSON.stringify(resource_Obj[rootnm].poa), resource_Obj[rootnm].csi, JSON.stringify(resource_Obj[rootnm].srt), resource_Obj[rootnm].ri, function (err, results) {
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
                // db_sql.get_sri_sri(connection, resource_Obj[rootnm].pi, function (err, results) {
                //     if (!err) {
                        resource_Obj[rootnm].spi = '';
                        //resource_Obj[rootnm].sri = require('shortid').generate();
                        resource_Obj[rootnm].sri = '5-' + moment().utc().format('YYYYMMDDHHmmssSSS') + (Math.random() * 999).toFixed(0).padStart(3, '0');
                            db_sql.insert_cb(connection, resource_Obj[rootnm], function (err, results) {
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
                //     }
                // });
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

exports.create = function(connection, callback) {
    db_sql.set_hit(connection, '', function (err, results) {
        cb_create_action(connection, function(rspObj) {
            callback(rspObj);
        });
    });


};

