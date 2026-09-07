/** Request body collector. Exports one Express middleware (collect) and a response reader (read). Both work on plain streams, so they are testable without HTTP (test/body-collector.test.js). */
'use strict';

var responder = require('./responder');
var reason = require('./reason');
var log_safe = require('./log_safe');
/**
 * Collects the request body into request.body as a string.
 *
 * 1. Chunks are collected as Buffers and decoded once at the end, so multi-byte characters cannot be split across chunk boundaries.
 * 2. Bodies over the limit are answered with 413.
 * 3. On aborted / error the collected chunks are dropped.
 *
 * On limit excess and abort, next() is not called: the route handler never starts and no DB connection is leased.
 *
 * Two cases for the limit:
 *   (1) Content-Length already exceeds the limit: 413 immediately, before any body byte is read.
 *   (2) No Content-Length (chunked) or a false one: the collected chunks are dropped, the rest is read and discarded, and 413 is sent at the end so the client sees the response instead of ECONNRESET. Memory stays bounded by the limit; a peer that never stops is cut by Node's requestTimeout.
 */
// The limit comes from global.max_body_bytes (conf maxBodyBytes). The default here keeps the limit active when the global is absent (tests). Read per request, not at require time.
var BODY_LIMIT_DEFAULT = 10 * 1024 * 1024;
function limit() {
    return (typeof global.max_body_bytes === 'number' && global.max_body_bytes > 0)
        ? global.max_body_bytes : BODY_LIMIT_DEFAULT;
}

function too_large(request, response, size) {
    console.error('[body_limit] ' + request.method + ' ' + request.url +
                  '  ' + size + ' > ' + limit() + ' bytes' +
                  '  origin=' + log_safe.origin(request.headers['x-m2m-origin']));
    var r = reason.get('413-1');
    responder.respond(request, response, { code: r.code, dbg: r.msg }, function () {});
}

function collect(request, response, next) {
    // (1) The declared size already exceeds the limit: answer without waiting for the body.
    var declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit()) {
        too_large(request, response, declared);
        return;
    }

    var chunks = [];
    var size = 0;
    var over = false;      // over the limit; the rest is read and discarded
    var done = false;

    function on_data(chunk) {
        if (done) { return; }
        size += chunk.length;
        if (over) { return; }                       // discarding; only counting
        if (size > limit()) {
            // (2) No or false Content-Length: drop what was collected, keep reading to the end, then answer. Destroying the socket here would give the client ECONNRESET before it reads the 413.
            over = true;
            chunks = null;
            return;
        }
        chunks.push(chunk);
    }

    function on_end() {
        if (done) { return; }
        done = true;
        detach();
        if (over) {
            too_large(request, response, size);
            return;
        }
        // The only decode point; chunk boundaries cannot split a character.
        request.body = Buffer.concat(chunks, size).toString('utf8');
        chunks = null;
        next();
    }

    // A request cut mid-way never emits 'end'; without this the collected chunks would live until the socket timeout.
    function on_gone() {
        if (done) { return; }
        done = true;
        chunks = null;
        detach();
    }

    // Only data and end are detached; the error listener stays. An 'error' event without a listener throws, and a late socket error after the body was read would kill the worker. The remaining listeners return immediately because done is set, so next() cannot run twice.
    function detach() {
        request.removeListener('data', on_data);
        request.removeListener('end', on_end);
    }

    request.on('data', on_data);
    request.on('end', on_end);
    request.on('aborted', on_gone);
    request.on('error', on_gone);
}
/**
 * Collects a response body into a string; used to read the answer of requests the server sends.
 *
 *     read(res, function (err, text) { ... })
 *
 * Chunks are concatenated as Buffers and decoded once, equivalent to res.setEncoding('utf8'). The same size limit as the request side (global.max_body_bytes) applies, because the outbound timeout is an idle timer and a slowly dripping peer would otherwise grow the body without bound.
 *
 * Contract: cb(err, text) is called exactly once. err is null and text the complete string on success; on limit excess, stream error or abort err carries an Error and text is undefined.
 */
function read(res, cb) {
    var chunks = [];
    var size = 0;
    var done = false;

    function finish(err, text) {
        if (done) { return; }
        done = true;
        chunks = null;
        // Only data and end are detached; the error listener stays so a late socket error cannot throw. The remaining listeners return immediately because done is set.
        res.removeListener('data', on_data);
        res.removeListener('end', on_end);
        cb(err, text);
    }

    function on_data(chunk) {
        if (done) { return; }
        size += chunk.length;
        if (size > limit()) {
            chunks = null;
            // Order matters: settle first, then destroy. res.destroy() emits 'aborted' synchronously, so destroying first would report 'response aborted' instead of the size limit.
            finish(new Error('response body exceeds ' + limit() + ' bytes'));

            // Destroy after settling; the 'aborted' it emits is blocked by done.
            try { res.destroy(); } catch (e) { /* may already be closed */ }
            return;
        }
        chunks.push(chunk);
    }

    function on_end() {
        if (done) { return; }
        // Decode once after all chunks are collected.
        finish(null, Buffer.concat(chunks, size).toString('utf8'));
    }

    function on_gone() { finish(new Error('response aborted')); }
    function on_err(e) { finish(e instanceof Error ? e : new Error(String(e))); }

    res.on('data', on_data);
    res.on('end', on_end);
    res.on('aborted', on_gone);
    res.on('error', on_err);
}

// Express middleware; the four routes in app.js use it.
exports.collect = collect;

// Outbound response reader; see read() above.
exports.read = read;

// Exposed for tests; not used at runtime.
exports.DEFAULT_LIMIT = BODY_LIMIT_DEFAULT;
