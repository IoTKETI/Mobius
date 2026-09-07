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

// Entry point of fanOutPoint. Resolves the member list (one DB query) and decides where each member request goes; mobius/fanout.js sends the requests in bounded parallel.

var resource = require('./resource');   // sets the make_internal_ri global
var fanout = require('./fanout');
var once = require('./once');

exports.check = function(request, response, grp, body_Obj, callback) {
    // Top-level callback of the fan-out; it leads to the response and the connection release.
    callback = once(callback, 'fopt.check');

    request.headers.rootnm = 'agr';
    var cse_poa = {};
    update_route(request.db_connection, cse_poa, function (code) {
        if (code !== '200') {
            callback(code);
            return;
        }

        // Resolve the member list with a single query. lookup.ri is the structured path ('/Mobius/ae/cnt') and lookup.sri the short id ('3-2026…'); a member id may match either the raw value or its folded form, so both are looked up in one whereIn and picked in that order. grp.mid is left untouched; make_internal_ri folds in place.
        var raw = grp.mid.slice();
        var folded = raw.slice();
        make_internal_ri(folded);
        var resolved = [];
        get_ri_list_sri(request, response, raw.concat(folded), resolved, 0, function (code) {
            if (code !== '200') {
                callback(code);
                return;
            }

            var ri_list = raw.map(function (r, i) {
                // raw value matched as sri -> its ri; otherwise the folded value's match, or the folded value itself.
                return (resolved[i] !== r) ? resolved[i] : resolved[raw.length + i];
            });

            var targets = fanout.route(ri_list, cse_poa, { cb: usecsebase, port: usecsebaseport });
            fanout.run(request, targets, function (agr) {
                if (Object.keys(agr).length == 0) {
                    callback('404-5');
                    return;
                }
                request.resourceObj = agr;

                // The result goes up as an argument: rsc 'OK', grouped shape, root name 'agr'.
                callback(null, { rsc: 'OK', shape: 'grouped', rootnm: 'agr', body: request.resourceObj });
            });
        });
    });
};
