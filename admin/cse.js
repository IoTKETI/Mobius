'use strict';
/**
 * oneM2M HTTP client towards Mobius (the CSE).
 *
 * All console writes pass through this file. The DB is not modified directly because:
 *
 *   - worker caches: Mobius caches resource rows per worker and broadcasts invalidation over cluster IPC on delete; the console is a separate process and cannot join that IPC. Deleting in the DB directly would leave workers returning 200 for deleted resources.
 *   - subscription notifications: a delete notifies subscribers via sgn.check(..., 4, ...).
 *   - parent counters: deleting a CIN must roll back the parent CNT's cni/cbs.
 *   - subtrees: descendant deletion continues as a background job.
 *
 * All of that lives in the application layer and is used as is.
 */

var http = require('http');
var url = require('url');

var DEFAULT_TIMEOUT_MS = 30000;

/**
 * Response body limit, kept at the same number as the default that read() in the core's mobius/body.js uses without the global, so switching to read() later does not change behaviour (the console does not set global.max_body_bytes).
 *
 * The limit itself bounds buf against a peer that never stops sending.
 */
var MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * @param opts.host / opts.port  Mobius address
 * @param opts.origin            X-M2M-Origin; must pass ACP.
 * @param opts.rvi               X-M2M-RVI (default '2a')
 * @param opts.timeoutMs
 */
function Client(opts) {
    this.host = opts.host || 'localhost';
    this.port = opts.port;
    this.origin = opts.origin;
    this.rvi = opts.rvi || '2a';
    this.timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.seq = 0;
}

Client.prototype._ri = function () {
    this.seq++;
    return 'adm-' + Date.now().toString(36) + '-' + this.seq;
};

/**
 * Sends one request. Never throws: a failure is one kind of result, and in a batch job one failure must not stop the rest.
 *
 * @returns callback({ ok, status, rsc, body, error })
 *   rsc is the string Mobius returns ('2002', '4004' ...), not reinterpreted, so it can be matched against the server console log.
 */
Client.prototype.request = function (method, path, body, callback) {
    var self = this;
    var payload = body ? JSON.stringify(body.content) : null;

    var headers = {
        'X-M2M-RI': this._ri(),
        'X-M2M-Origin': this.origin,
        'X-M2M-RVI': this.rvi,
        'Accept': 'application/json'
    };
    if (payload) {
        headers['Content-Type'] = 'application/json' + (body.ty ? ';ty=' + body.ty : '');
        headers['Content-Length'] = Buffer.byteLength(payload);
    }

    var settled = false;
    function settle(result) {
        if (settled) { return; }
        settled = true;
        callback(result);
    }

    var req = http.request({
        host: this.host, port: this.port, method: method,
        path: url.parse(path).path, headers: headers
    }, function (res) {
        var buf = '';
        var size = 0;
        res.setEncoding('utf8');
        res.on('data', function (c) {
            if (settled) { return; }
            size += Buffer.byteLength(c);
            if (size > MAX_BODY_BYTES) {
                buf = '';
                // The result is settled first, then the stream is cut: res.destroy() emits 'aborted' synchronously, and cutting first would let cut() below win with 'truncated' and hide the limit overrun. The two need different actions (network problem vs our own limit).
                settle({
                    ok: false, status: res.statusCode,
                    rsc: res.headers['x-m2m-rsc'] || null,
                    error: '응답 본문이 상한을 넘었다 (' + MAX_BODY_BYTES + ' 바이트)'
                });
                // This is the answer to our own request and there is no response to relay, so the stream may be cut.
                try { res.destroy(); } catch (e) { /* may already be closed */ }
                return;
            }
            buf += c;
        });
        res.on('end', function () {
            var parsed = null;
            if (buf) { try { parsed = JSON.parse(buf); } catch (e) { parsed = buf; } }
            settle({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                rsc: res.headers['x-m2m-rsc'] || null,
                body: parsed
            });
        });

        // A body truncated mid-way never emits 'end', and that error arrives on res, not req; without this handler the callback would never be called. req.setTimeout does not help either: the socket is already destroyed and the timer never fires.
        //
        // The job engine (jobs.js) guards against a callback arriving twice but not against one never arriving: running would not decrease, pump() would not run again and the job would stay 'running' forever.
        function cut(reason) {
            // Same nature as a timeout: not 'failed' but unknown. Whether the server finished the delete cannot be known here; the status line already received is returned with it.
            var rsc = res.headers['x-m2m-rsc'] || null;
            settle({
                ok: false,
                status: res.statusCode,
                rsc: rsc,
                error: '응답 본문이 중간에 끊겼다 (' + reason + '). 서버는 ' +
                       res.statusCode + (rsc ? '/' + rsc : '') +
                       ' 까지 답했으나 처리가 끝났는지는 알 수 없다'
            });
        }
        res.on('aborted', function () { cut('aborted'); });
        res.on('error', function (e) { cut(e.message || String(e)); });
    });

    req.setTimeout(this.timeoutMs, function () {
        // Cut, but keep the result. A timeout is 'unknown', not 'failed': whether the server finished the delete cannot be known here.
        req.destroy();
        settle({ ok: false, status: 0, rsc: null, error: 'timeout after ' + self.timeoutMs + 'ms' });
    });

    req.on('error', function (e) {
        settle({ ok: false, status: 0, rsc: null, error: e.message || String(e) });
    });

    if (payload) { req.write(payload); }
    req.end();
};

/** Deletes one resource. */
Client.prototype.remove = function (ri, callback) {
    this.request('DELETE', ri, null, callback);
};

/** Reads one resource; used for the preflight right before execution. */
Client.prototype.retrieve = function (ri, callback) {
    this.request('GET', ri, null, callback);
};

/**
 * Changes a few attributes. The root name differs per resource type, so the caller passes it (e.g. 'm2m:ae', 'm2m:cnt', 'm2m:acp').
 *
 * oneM2M UPDATE changes only the attributes sent; sending pv alone leaves pvs as it is.
 */
Client.prototype.update = function (ri, rootName, attrs, callback) {
    var content = {};
    content[rootName] = attrs;
    this.request('PUT', ri, { content: content }, callback);
};

/** Changes et. */
Client.prototype.setExpiry = function (ri, rootName, et, callback) {
    this.update(ri, rootName, { et: et }, callback);
};

exports.Client = Client;
