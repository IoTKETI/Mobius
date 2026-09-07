'use strict';
/**
 * fanOutPoint member requests with bounded parallelism.
 *
 * fopt.check resolves the member list; this module knows nothing about the DB or globals (it uses body, outbound_headers, outbound and once), so tests run it against real HTTP member servers. At most MAX_INFLIGHT requests are outstanding at once; results are collected in member order so the aggregated body (agr) keeps the mid order. A member that times out, returns non-JSON or fails to connect is dropped from the result; remote CSE members without a known route are skipped without a request.
 */
var url = require('url');
var http = require('http');

var body = require('./body');
var outbound_headers = require('./outbound_headers');
var outbound = require('./outbound');
var once = require('./once');

// Upper bound on concurrent member requests. Members are usually this CSE itself, so N concurrent requests occupy N workers and N DB connections. Not a conf key.
var MAX_INFLIGHT = 8;

/**
 * Resolves an ri list into targets.
 *
 *   resource of this CSE   -> { ri, hostname: 'localhost', port: self.port }
 *   known remote CSE       -> hostname and port from the csr's poa (cse_poa)
 *   unknown remote CSE     -> { ri, hostname: null, port: null }; run() skips it without a request
 *
 * @param {string[]} ri_list   list after folding to internal form and resolving sri
 * @param {object}   cse_poa   { cseName: poa URL } filled by update_route
 * @param {object}   self      { cb: usecsebase, port: usecsebaseport }
 */
exports.route = function (ri_list, cse_poa, self) {
    return ri_list.map(function (ri) {
        var target_cb = ri.split('/')[1];
        if (target_cb == self.cb) {
            return { ri: ri, hostname: 'localhost', port: self.port };
        }
        if (cse_poa[target_cb]) {
            var u = url.parse(cse_poa[target_cb]);
            return { ri: ri, hostname: u.hostname, port: u.port };
        }
        return { ri: ri, hostname: null, port: null };
    });
};

function check_body(res, res_body, callback) {
    var retrieve_Obj = {};

    // The member's response body may not be JSON (proxy error page, empty or truncated body). This runs inside res.on('end'), so a throw would be uncaught.
    var result;
    try {
        result = JSON.parse(res_body);
    }
    catch (e) {
        console.error('[fopt check_body] 멤버 응답이 JSON 이 아니다 (' + res.req.path + '): ' + e.message);
        callback('0');
        return '0';
    }

    if(res.req.path.charAt(0) == '/') {
        retrieve_Obj.fr = res.req.path.replace('/', '');
    }
    else {
        retrieve_Obj.fr = res.req.path;
    }

    if(res.headers.hasOwnProperty('x-m2m-rsc')) {
        retrieve_Obj.rsc = res.headers['x-m2m-rsc'];
    }

    if(res.headers.hasOwnProperty('x-m2m-ri')) {
        retrieve_Obj.rqi = res.headers['x-m2m-ri'];
    }

    if(res.headers.hasOwnProperty('x-m2m-rvi')) {
        retrieve_Obj.rvi = res.headers['x-m2m-rvi'];
    }

    retrieve_Obj.pc = result;
    callback('1', retrieve_Obj);
    return '1';
}

// Sends the request to one member. The callback receives the result object ({fr, rsc, rqi, rvi, pc}) or null when the member is excluded.
function request_to_member(request, target, callback) {
    // The callback can be reached from both the response path (body.read) and the error path (req.on('error')); it must run once or the inflight count drifts.
    callback = once(callback, 'fanout request_to_member ' + target.ri);

    var ri_prefix = request.url.split('/fopt')[1];

    var options = {
        hostname: target.hostname,
        port: target.port,
        path: target.ri + ri_prefix,
        method: request.method,
        // The client's Accept is not forwarded; Accept is forced to application/json so a standards-compliant member does not answer with XML.
        headers: outbound_headers(request.headers)
    };

    var req = http.request(options, function (res) {
        // body.read decodes the whole body as UTF-8 so multi-byte characters are not split across chunks.
        body.read(res, function (err, responseBody) {
            if (err) {
                // Size limit exceeded, connection cut or stream error: only this member is dropped.
                console.error('[fopt_member] 멤버 응답을 받지 못해 결과에서 제외한다: ' +
                              target.ri + ' — ' + err.message);
                callback(null);
                return;
            }
            check_body(res, responseBody, function (rsc, retrieve_Obj) {
                if (rsc == '1') {
                    callback(retrieve_Obj);
                    return;
                }
                // Unparseable member response: drop this member and continue, like the error handler.
                console.error('[fopt_member] 멤버 응답을 읽지 못해 결과에서 제외한다: ' + target.ri);
                callback(null);
            });
        });
    });

    // Cut the request when no response arrives; destroying it triggers the error handler below.
    outbound.arm(req, 'fopt member');
    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[fopt_member] problem with request: ' + e.message);
        }

        callback(null);
    });

    req.write(request.body);
    req.end();
}

/**
 * Sends the request to every member and returns the aggregate.
 *
 * @param {object}   request   the original request; url (suffix after /fopt), method, headers and body are used
 * @param {object[]} targets   result of route(); order is the key order of the response
 * @param {function} callback  callback(agr): { [fr]: {fr, rsc, rqi, rvi, pc} }, failed members omitted
 */
exports.run = function (request, targets, callback) {
    callback = once(callback, 'fanout.run');

    var results = new Array(targets.length);   // in member order; excluded members are null
    var next = 0;                               // next member to launch
    var inflight = 0;                           // requests currently outstanding

    function finish() {
        var agr = {};
        for (var i = 0; i < results.length; i++) {
            if (results[i]) {
                agr[results[i].fr] = results[i];
            }
        }
        callback(agr);
    }

    function settle(i) {
        return function (retrieve_Obj) {
            results[i] = retrieve_Obj || null;
            inflight--;
            launch();
        };
    }

    function launch() {
        while (next < targets.length && inflight < MAX_INFLIGHT) {
            var i = next++;
            var target = targets[i];
            if (!target.hostname) {
                console.log('[fanout] 경로를 모르는 원격 CSE 멤버라 건너뛴다: ' + target.ri);
                results[i] = null;
                continue;
            }
            inflight++;
            request_to_member(request, target, settle(i));
        }
        if (inflight === 0 && next >= targets.length) {
            finish();
        }
    }

    launch();
};

exports.MAX_INFLIGHT = MAX_INFLIGHT;
