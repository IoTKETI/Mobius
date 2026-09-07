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
var https = require('https');
var coap = require('coap');
var fs = require('fs');
// DB facade.
var db = require('./db');
var db_sql = require('./sql_action');
var merge = require('merge');

var responder = require('./responder');
// Single source of truth for the root-key prefix rule; the nev.rep key below is built with it.
var shape = require('./shape');
var poa_util = require('./poa');
var sub_entry = require('./sub_entry');
// Notification routing reads the sub table: sub_source picks the rows, nu_resolve turns ID-form nu entries into addresses. Neither loads sgn_man, so tests can load them.
var sub_source = require('./sub_source');
var nu_resolve = require('./nu_resolve');

var sgn_man = require('./sgn_man');

function make_json_noti_message(nu, pc, xm2mri, short_flag) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        noti_message['m2m:rqp'].rqi = xm2mri;

        if(short_flag == 1) {

        }
        else {
            noti_message['m2m:rqp'].to = nu;
            noti_message['m2m:rqp'].fr = usecseid;
        }

        noti_message['m2m:rqp'].pc = pc;

        var notiString = JSON.stringify(noti_message['m2m:rqp']);
        delete noti_message;
        noti_message = null;
        return notiString;
    }
    catch (e) {
        console.log('[make_json_noti_message] json parsing error');
    }
}

/** Builds the notification body string. Always JSON. */
function make_body_string_for_noti(protocol, nu, node, xm2mri, short_flag, callback) {
    // http / https / coap carry the notification body as is.
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'coap:') {
        callback(JSON.stringify(node));
        return;
    }

    // ws / mqtt wrap it in a oneM2M request primitive (m2m:rqp).
    if (protocol === 'ws:' || protocol === 'mqtt:') {
        callback(make_json_noti_message(nu, node, xm2mri, short_flag));
        return;
    }

    // Unknown scheme: an empty body makes the caller skip the send and log it.
    callback('');
}

function sgn_action_send(nu_arr, req_count, node, short_flag, check_value, ss_cr, ss_ri, xm2mri, exc, parentObj, callback) {
    if(nu_arr.length <= req_count) {
        callback('200');
        return;
    }

    var nu = nu_arr[req_count];
    var sub_nu = url.parse(nu);

    // Each nu uses its own copy of the options; options of one nu must not leak into the next.
    var this_node = node;
    var this_short = short_flag;

    if (sub_nu.query != null) {
        var sub_nu_query_arr = sub_nu.query.split('&');
        for (var prop in sub_nu_query_arr) {
            if (sub_nu_query_arr.hasOwnProperty(prop)) {
                // ct= is no longer read; notifications are always JSON.
                if (sub_nu_query_arr[prop].split('=')[0] == 'rcn') {
                    if (sub_nu_query_arr[prop].split('=')[1] == '9') {
                        // Clone only here; most nu have no options.
                        this_node = JSON.parse(JSON.stringify(node));

                        for (var index in this_node['m2m:sgn'].nev.rep) {
                            if (this_node['m2m:sgn'].nev.rep.hasOwnProperty(index)) {
                                if (this_node['m2m:sgn'].nev.rep[index].cr) {
                                    delete this_node['m2m:sgn'].nev.rep[index].cr;
                                }

                                if (this_node['m2m:sgn'].nev.rep[index].st) {
                                    delete this_node['m2m:sgn'].nev.rep[index].st;
                                }

                                delete this_node['m2m:sgn'].nev.rep[index].ct;
                                delete this_node['m2m:sgn'].nev.rep[index].lt;
                                delete this_node['m2m:sgn'].nev.rep[index].et;
                                delete this_node['m2m:sgn'].nev.rep[index].ri;
                                delete this_node['m2m:sgn'].nev.rep[index].pi;
                                delete this_node['m2m:sgn'].nev.rep[index].rn;
                                delete this_node['m2m:sgn'].nev.rep[index].ty;
                                delete this_node['m2m:sgn'].nev.rep[index].fr;

                                this_short = 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // Applies to every receiver regardless of nu, and is idempotent, so the shared object is modified in place.
    if(check_value == 128) {
        this_node['m2m:sgn'].sud = true;
        delete this_node['m2m:sgn'].nev;
    }

    this_node['m2m:sgn'].rvi = uservi;

    make_body_string_for_noti(sub_nu.protocol, nu, this_node, xm2mri, this_short, function (bodyString) {
        if (bodyString === '') { // parse error
            // The subscription ri is the only handle for this log line.
            console.error('[noti] fail - sub=' + (ss_ri || '?') + ' nu=' + nu +
                          ' (본문을 만들지 못했다)');
        }
        else {
            // Send immediately; within one worker the nu order and event order are the send order.
            sgn_man.post(nu, xm2mri, bodyString, ss_ri);
        }

        // Pass the original values to the next nu.
        sgn_action_send(nu_arr, ++req_count, node, short_flag, check_value, ss_cr, ss_ri, xm2mri, exc, parentObj, function (code) {
            callback(code);
        });
    });
}

// rows are the sub rows returned by sub_source.rows_for.
function sgn_action(connection, rootnm, check_value, rows, req_count, noti_Obj, parentObj, callback) {
    if(rows.length <= req_count) {
        callback('200');
        return;
    }

    var results_ss = sub_entry.read(rows[req_count]);
    if (!results_ss) {
        var broken = rows[req_count];
        console.error('[sgn] 구독 행을 읽을 수 없어 건너뛴다 — 부모=' +
                      ((parentObj && parentObj.ri) || '?') + ' 항목 ' + req_count +
                      ' sub=' + ((broken && broken.ri) || '?'));
        sgn_action(connection, rootnm, check_value, rows, ++req_count, noti_Obj, parentObj, function (code) {
            callback(code);
        });
        return;
    }

    var notiObj = merge({}, noti_Obj);

    var nct = results_ss.nct;
    var net_arr = JSON.parse(JSON.stringify(results_ss.net));
    var nu_arr = JSON.parse(JSON.stringify(results_ss.nu));

    var xm2mri = require('shortid').generate();
    var short_flag = 0;

    var node = {};
    node['m2m:sgn'] = {};

    if(results_ss.ri.charAt(0) == '/') {
        node['m2m:sgn'].sur = results_ss.ri.replace('/', '');
    }
    else {
        node['m2m:sgn'].sur = results_ss.ri;
    }

    if (results_ss.nec) {
        node['m2m:sgn'].nec = results_ss.nec;
    }
    node['m2m:sgn'].nev = {};
    node['m2m:sgn'].nev.rep = {};

    // The nev.rep key is built by shape.root_key, the same rule the response body uses.
    node['m2m:sgn'].nev.rep[shape.root_key(rootnm, notiObj)] = JSON.parse(JSON.stringify(notiObj));

    responder.typeCheckforJson(node['m2m:sgn'].nev.rep);

    notiObj = null;

    var matched = false;
    for (var j = 0; j < net_arr.length; j++) {
        if (net_arr[j] == check_value || check_value == 128) { // 1: Update_of_Subscribed_Resource, 3: Create_of_Direct_Child_Resource, 4: Delete_of_Direct_Child_Resource, 128: subscription deleted
            matched = true;
            node['m2m:sgn'].nev.net = parseInt(net_arr[j].toString());

            // ID-form nu entries are resolved in one batch (three queries). resolve always calls back; unresolved entries are dropped with a log line.
            nu_resolve.resolve(connection, nu_arr, results_ss.ri, function (resolved) {
                if (nct == 2 || nct == 1) {
                    // Send without delay; within one worker the event order is the send order.
                    sgn_action_send(resolved, 0, node, short_flag, check_value, results_ss.cr, results_ss.ri, xm2mri, results_ss.exc, parentObj, function (code) {
                        console.log('[sgn_action_send] - ' + code);
                    });
                }
                else {
                    console.log('nct except 2 (All Attribute) do not support');
                }
                sgn_action(connection, rootnm, check_value, rows, ++req_count, noti_Obj, parentObj, function (code) {
                    callback(code);
                });
            });
            break;
        }
    }

    // check_value not in net_arr: continue with the next subscription
    if (!matched) {
        sgn_action(connection, rootnm, check_value, rows, ++req_count, noti_Obj, parentObj, function (code) {
            callback(code);
        });
    }
}

exports.check = function(request, notiObj, check_value, callback) {
    var rootnm = request.headers.rootnm;

    if((request.method.toLowerCase() == "put" && check_value == 1)) {
        var pi = notiObj.ri;
    }
    else if ((request.method.toLowerCase() == "post" && check_value == 3) || (request.method.toLowerCase() == "delete" && check_value == 4)) {
        pi = notiObj.pi;
    }

    var ri = notiObj.ri;

    var noti_Str = JSON.stringify(notiObj);
    var noti_Obj = JSON.parse(noti_Str);

    // The subscribed resource itself: the POST target for create, the PUT target for update, and the parent set by delete_action for delete. sgn_action only reads parentObj, so it is passed without cloning.
    var target_root = Object.keys(request.targetObject)[0];
    var parentObj = request.targetObject[target_root];

    if(check_value != 128) {
        var noti_ri = noti_Obj.ri;
        noti_Obj.ri = noti_Obj.sri;
        delete noti_Obj.sri;
        noti_Obj.pi = noti_Obj.spi;
        delete noti_Obj.spi;
    }

    // Never use the request's connection: the callers pass an empty callback and respond immediately, so the request connection may already be released and reused by another request. The sub table is read on a connection of our own.
    with_connection(function (connection, release) {
        sub_source.rows_for(connection, parentObj, notiObj, check_value, function (rows) {
            sgn_action(connection, rootnm, check_value, rows, 0, noti_Obj, parentObj, function (code) {
                release();
                callback(code);
            });
        });
    }, callback);
};

// Leases a connection of our own and hands it to body; release is idempotent. When the pool is exhausted the notification is skipped and logged.
function with_connection(body, on_giveup) {
    db.getConnection(function (code, connection) {
        if (code !== '200') {
            // Notifications are fire-and-forget; no waiting or retrying when the pool is exhausted.
            console.error('[sgn] 커넥션을 못 빌려 알림의 ID 해석을 건너뛴다 (풀 고갈?)');
            on_giveup('200');
            return;
        }

        var released = false;
        body(connection, function () {
            if (released) { return; }
            released = true;
            // Release through the facade, not the handle: a backend's handle may have no release() of its own.
            db.release(connection);
        });
    });
}

