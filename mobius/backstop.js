'use strict';
// Last line of defence: handles exceptions nobody caught.
//
// The primary (cluster management only) keeps running and logs the exception. A worker logs diagnostics, flushes registered streams and exits so that cluster respawns it and the pool recovers its connection. The HTTP response is never touched here.

var util = require('util');

// Streams to flush before exit. app.js registers the access log stream; this module does not know what they are.
var flushers = [];

// Registers fn(done) to be called before exit; done() signals the flush is complete. The timeout below cuts a flush that never completes.
exports.flushOnExit = function (fn) {
    if (typeof fn === 'function') { flushers.push(fn); }
};

// For tests; registrations accumulate across files.
exports._resetFlushers = function () { flushers = []; };

/**
 * Exits the process for a reason other than an uncaught exception (e.g. a failed start), flushing registered streams first so the last log lines are not lost.
 *
 *   code  exit code; non-zero so a supervisor sees a failure
 *   deps  injection for tests: onFatal, flushTimeoutMs, proc
 */
exports.exitAfterFlush = function (code, deps) {
    var d = deps || {};
    var proc = d.proc || process;
    flush_then(function () {
        if (d.onFatal) { d.onFatal(code); }
        else { proc.exit(code); }
    }, d);
};

// Upper bound for the flush. A dying worker may have a broken stream whose end() callback never comes; the exit must not hang.
var FLUSH_TIMEOUT_MS = 500;

function flush_then(exit, d) {
    var pending = flushers.length;
    if (pending === 0) { return exit(); }

    var settled = false;
    function finish() {
        if (settled) { return; }
        settled = true;
        if (timer && timer.unref) { timer.unref(); }
        clearTimeout(timer);
        exit();
    }

    var timer = setTimeout(function () {
        if (settled) { return; }
        console.error('[backstop] 로그를 다 비우지 못하고 종료한다 (' +
                      FLUSH_TIMEOUT_MS + 'ms 초과) — 마지막 줄 몇 개가 빌 수 있다.');
        finish();
    }, (d && d.flushTimeoutMs) || FLUSH_TIMEOUT_MS);

    flushers.forEach(function (fn) {
        var called = false;
        try {
            fn(function () {
                // Count a registration once even if it calls done twice.
                if (called) { return; }
                called = true;
                if (--pending === 0) { finish(); }
            });
        }
        catch (e) {
            // A flush failure must not prevent the exit.
            if (!called) { called = true; if (--pending === 0) { finish(); } }
        }
    });
}

// Repeated identical exceptions are folded so the log does not flood.
var FULL_LOG_LIMIT = 3;          // how many times the same message is logged with its stack
var SUMMARY_INTERVAL_MS = 60000; // afterwards one summary line per interval

var seen = Object.create(null);
var installed = null;

function key(err) {
    if (err == null) { return 'null'; }
    return String(err && err.message ? err.message : err).slice(0, 200);
}

function describe(err) {
    if (err == null) { return 'null (던진 값이 없다)'; }
    if (err.stack) { return err.stack; }
    // Something other than an Error was thrown (throw 'string')
    return util.inspect(err, { depth: 2 });
}

/** Logs one exception. Returns true when a line was written, false when it was folded. Whether to exit is the caller's decision. */
exports.report = function (role, err, origin, now) {
    var t = (typeof now === 'number') ? now : Date.now();
    var k = key(err);
    var rec = seen[k];

    if (!rec) {
        rec = seen[k] = { count: 0, firstAt: t, lastSummaryAt: 0 };
    }
    rec.count++;

    var head = '[backstop] ' + role + ' pid=' + process.pid +
               ' 잡히지 않은 예외' + (origin ? ' (' + origin + ')' : '');

    if (rec.count <= FULL_LOG_LIMIT) {
        console.error(head + ' — ' + rec.count + '번째\n' + describe(err));
        if (rec.count === FULL_LOG_LIMIT) {
            console.error('[backstop] 같은 예외가 반복된다. 이후로는 ' +
                          (SUMMARY_INTERVAL_MS / 1000) + '초마다 한 줄로만 남긴다: ' + k);
        }
        return true;
    }

    if (t - rec.lastSummaryAt >= SUMMARY_INTERVAL_MS) {
        rec.lastSummaryAt = t;
        console.error(head + ' — 누적 ' + rec.count + '회: ' + k);
        return true;
    }

    return false;
};

/**
 * Installs the backstop on the process.
 *
 * @param {string} role   'master' or 'worker'
 * @param {object} [deps] injection for tests: { proc, onFatal }
 */
exports.install = function (role, deps) {
    var d = deps || {};
    var proc = d.proc || process;

    if (installed === role && !deps) { return false; }
    installed = role;

    function handle(err, origin) {
        exports.report(role, err, origin);

        if (role === 'worker') {
            // Log which connections were still leased; only this point knows which request held them.
            try {
                var lease = require('./lease');
                var s = lease.stats();
                if (s && s.open > 0) {
                    console.error('[backstop] 종료 시점에 빌려 둔 커넥션 ' + s.open + '개 ' +
                                  '(누적 취득 ' + s.opened + ' / 반납 ' + s.closed + ')');
                }
            }
            catch (e) { /* exit even if the ledger cannot be read */ }

            console.error('[backstop] 워커를 종료한다 — cluster 가 다시 띄운다. ' +
                          '살려 두면 이 요청이 응답 없이 매달리고 커넥션이 풀에서 빠진다.');

            // Flush before exit: proc.exit does not wait for pending asynchronous I/O, so a buffered access-log line would be lost. What to flush is registered by app.js via flushOnExit.
            flush_then(function () {
                if (d.onFatal) { d.onFatal(1); }
                else { proc.exit(1); }
            }, d);
            return;
        }

        // The primary keeps running; if it died the worker respawn logic would go with it.
        console.error('[backstop] 마스터는 계속 돈다. 위 예외는 고쳐야 할 결함이다.');
    }

    proc.on('uncaughtException', function (err, origin) { handle(err, origin); });

    // Unhandled rejections throw by default since Node 15; handle them with the same rule.
    proc.on('unhandledRejection', function (reason) { handle(reason, 'unhandledRejection'); });

    return true;
};

// for tests
exports._reset = function () { seen = Object.create(null); installed = null; };
exports._FULL_LOG_LIMIT = FULL_LOG_LIMIT;
exports._SUMMARY_INTERVAL_MS = SUMMARY_INTERVAL_MS;
