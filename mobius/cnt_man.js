/**
 * Copyright (c) 2019, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2019, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 * @date 2019.06.14
 */

var fs = require('fs');
var http = require('http');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var ip = require("ip");

const db_sql = require('./sql_action');
const db = require("./db_action");
const responder = require("./responder");
const util = require("util");

//
// global.NOPRINT = 'true';
//
// var cnt_app = express();
//
// var cnt_server = null;
//
// if(cnt_server == null) {
//     if(use_secure === 'disable') {
//         http.globalAgent.maxSockets = 10000;
//         cnt_server = http.createServer(cnt_app);
//     }
//     else {
//         var options = {
//             key: fs.readFileSync('server-key.pem'),
//             cert: fs.readFileSync('server-crt.pem'),
//             ca: fs.readFileSync('ca-crt.pem')
//         };
//         https.globalAgent.maxSockets = 10000;
//         cnt_server = https.createServer(options, cnt_app);
//     }
//
//     cnt_server.listen({port: use_cnt_man_port, agent: false}, function () {
//         console.log('cnt_man server (' + ip.address() + ') running at ' + use_cnt_man_port + ' port');
//     });
//
//     cnt_server.on('connection', function (socket) {
//         //console.log("A new connection was made by a client.");
//         // socket.setTimeout(5000, function () {
//         //     if(socket.hasOwnProperty('_httpMessage')) {
//         //         if (socket._httpMessage.hasOwnProperty('req')) {
//         //             if (ss_fail_count.hasOwnProperty(socket._httpMessage.req.headers.ri)) {
//         //                 ss_fail_count[socket._httpMessage.req.headers.ri]++;
//         //             }
//         //         }
//         //     }
//         // });
//     });
// }
//
// // for updating container
// var onem2mParser = bodyParser.text(
//     {
//         limit: '1mb',
//         type: 'application/onem2m-resource+xml;application/xml;application/json;application/vnd.onem2m-res+xml;application/vnd.onem2m-res+json'
//     }
// );
//
// cnt_app.put('/cnt', onem2mParser, function(request, response, next) {
//     var fullBody = '';
//     request.on('data', function(chunk) {
//         fullBody += chunk.toString();
//     });
//     request.on('end', function() {
//         request.body = fullBody;
//
//         var resource_Obj = JSON.parse(request.body);
//         setTimeout(updateAction, 0, resource_Obj);
//         response.status(200).end();
//     });
// });

let update_st_by_action = (obj, callback) => {
    db.getConnection((code, connection) => {
        if (code === '200') {
            let cni_id = 'update_st_by_action ' + obj.ri + ' - ' + require('shortid').generate();
            console.time(cni_id);
            let sql = util.format('update lookup set st = st+1 where ri = \'%s\'', obj.ri);    //var sql = util.format('update %s, lookup set %s.cni = %s, %s.cbs = %s, lookup.st = %s where lookup.ri = \'%s\' and %s.ri = \'%s\'', tableName, tableName, obj.cni+1, tableName, obj.cbs+cs, obj.st, obj.ri, tableName,  obj.ri);
            db.getResult(sql, connection, (err, results) => {
                console.timeEnd(cni_id);
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
                connection.release();
            });
        }
    });
};

let update_parent_by_action = (obj, callback) => {
    update_st_by_action(obj, (err, results) => {
        if (!err) {
            if (parseInt(obj.ty) === 3) {
                let tid = 'aggregate_cnt ' + obj.ri + ' - ' + require('shortid').generate();
                console.time(tid);
                db.getConnection((code, connection) => {
                    if (code === '200') {
                        db_sql.aggregate_cnt(connection, obj.ty, obj.ri, (code, cni, cbs) => {
                            if (code === '1') {
                                db_sql.delete_oldest_by_mni_mbs(connection, obj.ty, obj.ri, cni, cbs, obj.mni, obj.mbs, (code) => {
                                    console.timeEnd(tid);
                                    if (code === '0') {
                                        db_sql.aggregate_cnt(connection, obj.ty, obj.ri, (code, cni, cbs) => {
                                            connection.release();
                                        });
                                    }
                                    else {
                                        connection.release();
                                    }
                                });
                            }
                            else {
                                connection.release();
                            }
                        });
                    }
                });
            }
        }
        else {
            connection.release();
        }
    });
};

exports.update_st_by_action = update_st_by_action;
exports.update_parent_by_insert = update_parent_by_action;
exports.update_parent_by_delete = update_parent_by_action;

exports.put = function(connection, bodyString) {
    var resource_Obj = JSON.parse(bodyString);
    setTimeout((connection, resource_Obj) => {
        var rootnm = Object.keys(resource_Obj)[0];
        db_sql.get_cni_count(connection, resource_Obj[rootnm], (cni, cbs, st) => {
            var resBody = {};
            resBody[resource_Obj[rootnm].ri] = {
                cni: cni,
                cbs: cbs,
                st: st
            };
            console.log(resBody);
            resource_Obj = null;
            resBody = null;
        });
    }, 0, connection, resource_Obj);
};
//
// function updateAction(connection, resource_Obj) {
//     var rootnm = Object.keys(resource_Obj)[0];
//     db_sql.get_cni_count(connection, resource_Obj[rootnm], function (cni, cbs, st) {
//         var resBody = {};
//         resBody[resource_Obj[rootnm].ri] = {
//             cni: cni,
//             cbs: cbs,
//             st: st
//         };
//         console.log(resBody);
//         delete resource_Obj;
//         resource_Obj = null;
//         delete resBody;
//         resBody = null;
//     });
//
// }
