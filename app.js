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
 * @file Main code of Mobius. Role of flow router
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

process.env.NODE_ENV = 'production';

var fs = require('fs');
var http = require('http');
var express = require('express');
var morgan = require('morgan');
var util = require('util');
var url = require('url');
var ip = require('ip');
var crypto = require('crypto');
var fileStreamRotator = require('file-stream-rotator');
var https = require('https');
var moment = require('moment');

const cors = require('cors');

global.NOPRINT = 'true';
global.ONCE = 'true';

var cb = require('./mobius/cb');
var responder = require('./mobius/responder');
var resource = require('./mobius/resource');
var security = require('./mobius/security');
var fopt = require('./mobius/fopt');
var sgn = require('./mobius/sgn');

// Result codes and reasons live in the catalogues (mobius/rsc.js: codes and http/coap mapping; mobius/reason.js: messages). Every error response goes through response_error_result(request, response, code, cb). Required early because the primary's self-check uses them.
var reason = require('./mobius/reason');
var RSC = require('./mobius/rsc').RSC;

// Single source of truth for deciding ty.
var type_resolver = require('./mobius/type_resolver');

// Last line of defence for uncaught exceptions: the primary survives, a worker exits.
var backstop = require('./mobius/backstop');
var EXIT = require('./mobius/exit_codes');
var port_guard = require('./mobius/port_guard');

// Outbound request timeouts.
var outbound = require('./mobius/outbound');

// Lets a callback that sends the response and releases the connection run only once.
var once = require('./mobius/once');

// Settles a request: response and connection release, once.
var settle_mod = require('./mobius/settle');
var route_gate = require('./mobius/route_gate');

// Reads the poa column safely as an array.
var poa_util = require('./mobius/poa');

// DB facade.
var db = require('./mobius/db');
var db_sql = require('./mobius/sql_action');

// Applies at boot the migrations that finish immediately (primary only), so a fresh database starts in the deployed state.
var db_bootstrap = require('./mobius/db_bootstrap');


var app = express();

// There is no per-worker resource cache. A cache keyed by request URL cannot be invalidated across workers or across the aliases (ri, sri) a resource is reachable by, so deleted resources and revoked acpi would keep being served. If a cache is ever reintroduced it must hand out a copy per request, carry a TTL, and be invalidated by the same key it is filled with; test/no-resource-cache.test.js guards this.

// CORS in one place. Only Expose-Headers matters to browsers outside preflight; preflight echoes the request headers. The value is a plain string: an array would be joined differently and change the bytes on the wire.
app.use(cors({
    exposedHeaders: 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale'
}));


var logDirectory = __dirname + '/log';

// ensure log directory exists
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

// create a rotating write stream
var accessLogStream = fileStreamRotator.getStream({
    date_format: 'YYYYMMDD',
    filename: logDirectory + '/access-%DATE%.log',
    frequency: 'daily',
    verbose: false,

    // Flush and close the stream on the daily rotation; without end_stream the library destroys the stream and pending lines are lost.
    end_stream: true
});

// An 'error' event without a listener would throw and kill the worker (ENOSPC, lost permissions). Access-log failures are logged, rate-limited to one line per minute with the number of suppressed errors, and the server keeps serving.
//
// The stream is flushed before a worker exits (backstop.flushOnExit), so the last access-log line of a crashing request is not lost. app.js registers it because backstop does not know the stream.
backstop.flushOnExit(function (done) {
    // end() calls back after the buffer is written; backstop's timeout cuts a flush that never completes.
    try { accessLogStream.end(done); }
    catch (e) { done(); }
});

/*
 * A failed start must not be silent.
 *
 * Without a DB connection the primary forks no workers and a worker never listens, while the process stays alive and looks healthy to pm2. The MySQL adapter's connect only creates the pool and always succeeds; the real connection happens at the first getConnection, so a slow or misconfigured MySQL lands exactly here.
 *
 * The exit is delayed: pm2 counts a process that lived longer than min_uptime as a successful start and resets its restart counter, so the delay becomes the retry interval instead of pushing the app into the errored state.
 */
var START_FAIL_EXIT_MS = 3000;

function fail_start(role, why) {
    console.error('[기동 실패] ' + role + ' — ' + why);
    console.error('[기동 실패] 포트를 열지 못했다. ' + START_FAIL_EXIT_MS +
                  'ms 뒤 종료한다 — 감독 프로세스가 다시 띄운다.');
    setTimeout(function () {
        backstop.exitAfterFlush(1);
    }, START_FAIL_EXIT_MS);
}

var access_log_err = { at: 0, skipped: 0 };
accessLogStream.on('error', function (err) {
    var now = Date.now();
    if (access_log_err.at && (now - access_log_err.at) < 60000) {
        access_log_err.skipped++;
        return;
    }
    console.error('[access_log] 못 쓴다: ' + ((err && err.message) || err) +
                  (access_log_err.skipped ? ' (지난 1분간 ' + access_log_err.skipped + '건 더)' : '') +
                  ' — 요청은 계속 받는다. 요청별 소요시간이 그동안 안 남는다.');
    access_log_err.at = now;
    access_log_err.skipped = 0;
});

// Access log format: 'combined' plus the response time as the last field (no unit, so the last field is a plain number).
//
// Aborted requests have '-' in that field: morgan sets res._startAt in onHeaders, which never runs when no response header was written. awk reads '-' as 0, so slow and aborted requests must be counted separately:
//
//   # slow: requests that completed
//   awk '$NF != "-" && $NF+0 > 1000' log/access-*.log
//
//   # aborted: requests without a response time
//   awk '$NF == "-"' log/access-*.log
var ACCESS_FORMAT =
    ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" ' +
    ':status :res[content-length] ":referrer" ":user-agent" :response-time';

app.use(morgan(ACCESS_FORMAT, {stream: accessLogStream}));

// Expired resources are not deleted automatically. Functions for the admin UI:
//   db_sql.select_expired_resources(conn, et, limit, cb)  list (read-only)
//   db_sql.delete_lookup_et(conn, et, limit, cb)          delete after review
// Extending et is an ordinary oneM2M UPDATE.

// Reconciles the stored cnt.cni/cbs with the actual cin aggregates (at boot and once a day). Paths that do not decrement yet (background subtree delete, expiry sweep) make this necessary. The cursor lives in the process: each call works for a time budget and the next continues where it stopped; after a full pass the cursor rewinds.
var reconcile_cursor = '';
var reconcile_running = false;
// Containers that could not be aggregated during a pass are collected and reported once at the end of the pass.
var reconcile_deferred = [];
var reconcile_failed = [];

// Slices continue after this gap instead of waiting for the daily tick, so a full pass finishes within minutes rather than weeks.
var RECONCILE_GAP_MS = 60 * 1000;

// Retention sweep: deletes old children of containers over their mni/mbs. Runs in the primary only, so there is a single purger and no locking between workers is needed.
var purge_running = false;

// Latch watch.
//
// Both periodic jobs set a flag and clear it inside a DB callback. If the callback never comes or throws, the flag stays set and every later tick returns silently; a worker restart does not recover it. The ledger and the verdict live in mobius/latch.js; it only warns and never releases a latch (releasing would let two flows into the same critical section). Two clocks: started_at catches a callback that never comes, progress_at catches a flow that completes slices without moving the cursor.
var latch = require('./mobius/latch');

// A release that throws must not prevent the settlement; the current adapters do not throw, but that depends on the driver.
function release_quietly(connection, who) {
    try { db.release(connection); }
    catch (e) { console.error('[' + who + '] 커넥션 반납 실패: ' + e.message); }
}

function purge_sweep_tick() {
    if (purge_running) { return; }   // a pass is still running
    purge_running = true;
    // Enter the latch before the acquisition, so an acquisition that never calls back is visible too (lease records only successful acquisitions).
    latch.enter('purge_sweep');

    db.getConnection(once(function (code, connection) {
        if (code !== '200') {
            purge_running = false;
            latch.leave('purge_sweep');
            console.error('[purge_sweep] 커넥션을 못 빌렸다 — 다음 주기에 다시 한다');
            return;
        }

        // Settlement happens here only, as in settle.js on the response path.
        var settled = false;
        function settle_purge() {
            if (settled) { return; }
            settled = true;
            purge_running = false;
            latch.leave('purge_sweep');
            release_quietly(connection, 'purge_sweep');
        }

        try {
            db_sql.purge_sweep(connection, {
                limit: 100,
                // Each finished container counts as progress; purge has no budget, so a pass has no upper length.
                onProgress: function () { latch.progress('purge_sweep'); }
            }, once(function (err, report) {
                try {
                    if (err) {
                        console.error('[purge_sweep] 실패: ' + ((report && report.message) || report));
                        return;
                    }
                    // Silent when there is nothing to do.
                    if (report.scanned > 0) {
                        console.log('[purge_sweep] 초과 ' + report.scanned + '개 중 ' +
                                    report.purged + '개 정리, ' + report.deleted + '건 삭제' +
                                    (report.failed ? ', 실패 ' + report.failed : ''));
                    }
                }
                finally { settle_purge(); }
            }, 'purge_sweep'));
        }
        catch (e) {
            // The call threw synchronously; no callback will come. Settle here.
            settle_purge();
            throw e;   // not swallowed; backstop logs it
        }
    }, 'purge_sweep getConnection'));
}

// How many times a failed slice is retried before the pass is abandoned. Without retries one transient failure would abandon the pass until the daily tick; the cap prevents permanent retrying.
var RECONCILE_MAX_RETRY = 5;
var reconcile_retry = 0;

/**
 * Re-arms the continuation after a failure mid-pass.
 *
 * Outside a pass (empty cursor) nothing happens; the daily tick will start the next pass. Beyond the retry cap it returns false and the caller releases the latch; the cursor is kept so the next pass continues from it.
 *
 * @returns {boolean} true when re-armed (the caller keeps the latch)
 */
function rearm_or_give_up(why) {
    if (reconcile_cursor === '') { return false; }   // outside a pass
    reconcile_retry++;
    if (reconcile_retry > RECONCILE_MAX_RETRY) {
        console.error('[reconcile_counters] ' + why + ' — ' + RECONCILE_MAX_RETRY +
                      '회 재시도했으나 이어가지 못했다. 이 바퀴를 놓고 다음 24시간 ' +
                      '틱에 맡긴다. 커서는 ' + reconcile_cursor + ' 에 남겨 둔다');
        return false;
    }
    // Back off progressively: a transient DB hiccup recovers on the first attempts; a persistent failure is not hammered.
    var wait = RECONCILE_GAP_MS * reconcile_retry;
    console.log('[reconcile_counters] ' + why + ' — ' + Math.round(wait / 1000) +
                '초 뒤 이어서 다시 시도한다 (' + reconcile_retry + '/' +
                RECONCILE_MAX_RETRY + ')');
    setTimeout(function () { reconcile_counters(true); }, wait);
    return true;
}

// is_continuation is true only when the continuation calls itself. The daily timer skips while a pass is running, otherwise two flows would advance the same cursor.
function reconcile_counters(is_continuation) {
    if (reconcile_running && !is_continuation) { return; }
    reconcile_running = true;
    // A continuation does not re-enter the latch: the whole pass is one lease.
    if (!is_continuation) {
        latch.enter('reconcile_counters');
        reconcile_retry = 0;
    }

    db.getConnection(once(function (code, connection) {
        if (code !== '200') {
            console.log('[reconcile_counters] No Connection');
            if (rearm_or_give_up('커넥션을 못 빌렸다')) { return; }
            reconcile_running = false;
            latch.leave('reconcile_counters');
            return;
        }

        // Settlement happens here only. The latch is kept only when a continuation was scheduled.
        var settled = false;
        var chained = false;
        function settle_reconcile() {
            if (settled) { return; }
            settled = true;
            if (!chained) {
                reconcile_running = false;
                latch.leave('reconcile_counters');
            }
            release_quietly(connection, 'reconcile_counters');
        }

        try {
            db_sql.reconcile_cnt_counters(connection,
                // limit is the number of containers read at once; the real bound is budgetMs.
                { limit: 2000, cursor: reconcile_cursor, budgetMs: 30000 },
                once(function (err, report) {
                    try {
                        if (err) {
                            console.log('[reconcile_counters] error', report);
                            // Mid-pass: re-arm instead of abandoning.
                            if (rearm_or_give_up('조각이 실패했다')) { chained = true; }
                            return;
                        }

                        if (report.fixed > 0) {
                            console.log('[reconcile_counters] ' + report.checked + '건 확인, ' +
                                        report.fixed + '건 교정');
                        }
                        reconcile_deferred = reconcile_deferred.concat(report.deferredRis || []);
                        reconcile_failed = reconcile_failed.concat(report.failedRis || []);

                        // Count progress only when the cursor actually advanced. A slice can end normally without moving the cursor (the batch SELECT ate the whole budget), and a continuation would loop on the same cursor forever.
                        if (report.nextCursor !== reconcile_cursor) {
                            latch.progress('reconcile_counters');
                            // Reset the retry budget on progress; the cap measures consecutive failures.
                            reconcile_retry = 0;
                        }

                        if (report.done) {
                            // Pass complete. Rewind the state first and report afterwards, so a throw in the report cannot leave the cursor at the end of the table.
                            var stuck = reconcile_deferred.concat(reconcile_failed);
                            var n_deferred = reconcile_deferred.length;
                            var n_failed = reconcile_failed.length;
                            reconcile_cursor = '';
                            reconcile_deferred = [];
                            reconcile_failed = [];
                            if (stuck.length > 0) {
                                console.log('[reconcile_counters] 한 바퀴 완료 — 유예(대형) ' +
                                            n_deferred + '건, 실패 ' + n_failed +
                                            '건. 관리자 UI 에서 개별 처리 필요: ' +
                                            stuck.slice(0, 10).join(', ') +
                                            (stuck.length > 10 ? ' 외 ' + (stuck.length - 10) + '건' : ''));
                            }
                            // The latch is released by settle_reconcile (chained is false).
                        }
                        else {
                            // Still running: keep reconcile_running set so the daily tick does not interfere.
                            reconcile_cursor = report.nextCursor;
                            setTimeout(function () { reconcile_counters(true); }, RECONCILE_GAP_MS);
                            // Set chained only after the timer is actually scheduled.
                            chained = true;
                        }
                    }
                    finally { settle_reconcile(); }
                }, 'reconcile_counters'));
        }
        catch (e) {
            // The call threw synchronously; no callback will come.
            settle_reconcile();
            throw e;   // not swallowed
        }
    }, 'reconcile_counters getConnection'));
}

// Orphan row cleanup is not run automatically: delete_orphan_lookup scans the whole lookup table in batches and holds a connection for the duration. Functions for the admin UI:
//   db_sql.count_orphan_lookup(conn, cb)          count (read-only)
//   db_sql.delete_orphan_lookup(conn, cb)         delete after review

var cluster = require('cluster');
var os = require('os');
var cpuCount = os.cpus().length;

var worker = [];
var use_clustering = 1;
var worker_init_count = 0;
if (use_clustering) {
    if (cluster.isMaster) {
        // Last line of defence for the primary: it keeps running on an uncaught exception, because it holds no request state and the worker respawn logic lives here.
        backstop.install('master');

        // Windows: prevents a console window per worker. The window is created by cluster.fork(), so windowsHide on spawn has no effect. Ignored on Linux.
        cluster.setupPrimary({ windowsHide: true });

        // The latch watch is armed first, outside the db.connect -> getConnection -> db_bootstrap.run -> cb.create chain, so it can report that the periodic jobs never started if that chain breaks.
        setInterval(function () { latch.sweep(); }, 60 * 1000);

        // Self-check of the result code and reason catalogues, once in the primary. Problems are logged and never block the boot.
        reason.reportSelfCheck();

        // Respawn a worker that died. The event is 'exit'; the old 'death' event never fires on current Node.
        var RESPAWN_DELAY_MS = 1000;
        cluster.on('exit', (dead, code, signal) => {
            // An intended exit (kill/disconnect by the parent) is not respawned.
            if (dead.exitedAfterDisconnect) {
                console.log('worker ' + dead.process.pid + ' 정상 종료');
                return;
            }
            // Port conflict, missing conf.json and seal mismatch would die again for the same reason; a re-fork loop is a zombie. The primary exits with the same code so the supervisor sees the failure.
            if (code === EXIT.PORT_TAKEN || code === EXIT.NO_CONF || code === EXIT.BAD_SEAL) {
                console.error('worker ' + dead.process.pid + ' 가 code=' + code + ' 로 죽었다 — ' +
                    (code === EXIT.PORT_TAKEN ? '포트를 남이 쥐고 있다' : code === EXIT.NO_CONF ? 'conf.json 이 없다' : '비밀 봉인이 어긋났다(손편집)') +
                    '. 다시 띄우지 않고 마스터도 종료한다.');
                process.exit(code);
                return;
            }
            console.error('worker ' + dead.process.pid + ' 죽음 (code=' + code +
                          ', signal=' + signal + ') --> 다시 띄운다');
            // A short pause prevents a fork storm when workers die in quick succession right after boot.
            setTimeout(() => { cluster.fork(); }, RESPAWN_DELAY_MS);
        });

        db.connect((rsc) => {
            if (rsc == '1') {
                db.getConnection((code, connection) => {
                    if (code === '200') {
                        // Server tuning is not done here at every boot. innodb_flush_log_at_trx_commit and transaction_isolation are set once by migrations/010 (SET PERSIST, recorded in schema_migrations); max_connections is checked at every boot by db_bootstrap, which only raises it. Only migrations that finish immediately run here (autoApply).
                        db_bootstrap.run(() => {
                            console.log('CPU Count:', cpuCount);
                            for (var i = 0; i < cpuCount; i++) {
                                worker[i] = cluster.fork();
                            }

                            cb.create(connection, (rsp) => {
                                console.log(JSON.stringify(rsp));


                                // Register the timers before the immediate call: if reconcile_counters() threw, the setInterval calls after it would never run.

                                // Retention sweep; the interval is how far over the limit a container may go.
                                setInterval(purge_sweep_tick, global.purge_sweep_ms);
                                setInterval(reconcile_counters, (24) * (60) * (60) * (1000));

                                reconcile_counters();

                                // There are no protocol proxies (MQTT/CoAP/WS bindings); HTTP is the only binding. Notifications are separate: mobius/sgn_man.js opens its own mqtt/coap clients.

                                db.release(connection);
                            });
                        });
                    }
                    else {
                        console.log('[db.connect] No Connection');
                        fail_start('마스터', '커넥션을 못 얻어 워커를 하나도 못 띄운다');
                    }
                });
            }
            else {
                // A failed connection is not silent: the failure is logged next to the adapter's [db/mysql] pool line and the process exits after a delay (fail_start).
                console.error('[db] connect 실패 (' + rsc + ') — DB 를 쓰는 요청은 전부 실패한다');
                fail_start('마스터', 'DB 연결 자체가 실패했다');
            }
        });
    }
    else {
        // A worker exits on an uncaught exception, unlike the primary: keeping it alive would leave the throwing request hanging with its connection lost from the pool. cluster.on('exit') above respawns it.
        backstop.install('worker');

        db.connect((rsc) => {
            if (rsc === '1') {
                // Read the data-state switches. Workers need them too: db_bootstrap.run is primary-only, but discovery runs in workers. A single select; a failure leaves the switches false and never blocks the boot.
                db_bootstrap.readDataSwitches(() => {
                db.getConnection((code, connection) => {
                    if (code === '200') {
                        if (use_secure === 'disable') {
                            http.createServer(app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                cb.create(connection, (rsp) => {
                                    console.log(JSON.stringify(rsp));

                                    db.release(connection);
                                });
                            }).on('error', port_guard.onListenError(usecsebaseport));
                        }
                        else {
                            var options = {
                                key: fs.readFileSync('server-key.pem'),
                                cert: fs.readFileSync('server-crt.pem'),
                                ca: fs.readFileSync('ca-crt.pem')
                            };
                            https.createServer(options, app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                cb.create(connection, (rsp) => {
                                    console.log(JSON.stringify(rsp));

                                    db.release(connection);
                                });
                            }).on('error', port_guard.onListenError(usecsebaseport));
                        }
                    }
                    else {
                        console.log('[db.connect] No Connection');
                        fail_start('워커', '커넥션을 못 얻어 listen 을 못 한다');
                    }
                });
                });   // db_bootstrap.readDataSwitches
            }
            else {
                // A failed connection is not silent: the failure is logged next to the adapter's [db/mysql] pool line and the process exits after a delay (fail_start).
                console.error('[db] connect 실패 (' + rsc + ') — DB 를 쓰는 요청은 전부 실패한다');
                fail_start('워커', 'DB 연결 자체가 실패했다');
            }
        });
    }
}
else {
    db.connect((rsc) => {
        if (rsc == '1') {
            db.getConnection((code, connection) => {
                if (code === '200') {
                    cb.create(connection, (rsp) => {
                        console.log(JSON.stringify(rsp));

                        if (use_secure === 'disable') {
                            http.createServer(app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                            }).on('error', port_guard.onListenError(usecsebaseport));
                        }
                        else {
                            var options = {
                                key: fs.readFileSync('server-key.pem'),
                                cert: fs.readFileSync('server-crt.pem'),
                                ca: fs.readFileSync('ca-crt.pem')
                            };
                            https.createServer(options, app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                            }).on('error', port_guard.onListenError(usecsebaseport));
                        }

                        db.release(connection);
                    });
                }
                else {
                    console.log('[db.connect] No Connection');
                    fail_start('단일 프로세스', '커넥션을 못 얻어 listen 을 못 한다');
                }
            });
        }
        else {
            // A failed connection is not silent: the failure is logged next to the adapter's [db/mysql] pool line and the process exits after a delay (fail_start).
            console.error('[db] connect 실패 (' + rsc + ') — DB 를 쓰는 요청은 전부 실패한다');
            fail_start('단일 프로세스', 'DB 연결 자체가 실패했다');
        }
    });
}

/** sri list -> ri list: an entry that matches lookup.sri becomes that row's ri, otherwise it stays as is. Used by the acpi validation (resource.js) and group members (fopt.js). One query for the whole list; a substitution that actually happens is logged. */
global.get_ri_list_sri = function (request, response, sri_list, ri_list, count, callback) {
    var todo = sri_list.slice(count);
    if (todo.length === 0) {
        callback('200');
        return;
    }
    db_sql.get_ri_sri_in(request.db_connection, todo, (err, rows) => {
        if (err) {
            callback('500-1');
            return;
        }
        // With duplicate sri rows the first one wins.
        var map = Object.create(null);
        for (var i = 0; i < rows.length; i++) {
            if (!(rows[i].sri in map)) { map[rows[i].sri] = rows[i].ri; }
        }
        var resolved = 0;
        for (var j = 0; j < todo.length; j++) {
            var v = (todo[j] in map) ? map[todo[j]] : todo[j];
            if (v !== todo[j]) { resolved++; }
            ri_list[count + j] = v;
        }
        rows = null;
        if (resolved > 0) {
            console.log('[get_ri_list_sri] sri→ri 치환 ' + resolved + '/' + todo.length + ' — ' + request.method + ' ' + request.url);
        }
        callback('200');
    });
};

global.update_route = function (connection, cse_poa, callback) {
    db_sql.select_csr_like(connection, usecsebase, (err, results_csr) => {
        if (!err) {
            for (var i = 0; i < results_csr.length; i++) {
                // csr.poa may hold broken JSON (truncated by a non-strict sql_mode); one broken row must not lose the routes of the other CSEs, and a throw here (inside a DB callback) would kill the worker. Skip it.
                var poa_arr = poa_util.parse(results_csr[i].poa, '[update_route] ' + results_csr[i].ri);
                if (poa_arr === null) {
                    continue;
                }
                for (var j = 0; j < poa_arr.length; j++) {
                    if (url.parse(poa_arr[j]).protocol == 'http:' || url.parse(poa_arr[j]).protocol == 'https:') {
                        cse_poa[results_csr[i].ri.split('/')[2]] = poa_arr[j];
                    }
                }
            }
            results_csr = null;
            callback('200');
        }
        else {
            callback('500-1');
        }
    });
};

function make_short_nametype(body_Obj) {
    if (body_Obj[Object.keys(body_Obj)[0]]['$'] != null) {
        if (body_Obj[Object.keys(body_Obj)[0]]['$'].rn != null) {
            body_Obj[Object.keys(body_Obj)[0]].rn = body_Obj[Object.keys(body_Obj)[0]]['$'].rn;
        }
        delete body_Obj[Object.keys(body_Obj)[0]]['$'];
    }

    var arr_rootnm = Object.keys(body_Obj)[0].split(':');

    if(arr_rootnm[0] === 'hd') {
        var rootnm = Object.keys(body_Obj)[0].replace('hd:', 'hd_');
    }
    else {
        rootnm = Object.keys(body_Obj)[0].replace('m2m:', '');
    }

    body_Obj[rootnm] = body_Obj[Object.keys(body_Obj)[0]];
    delete body_Obj[Object.keys(body_Obj)[0]];

    for (var attr in body_Obj[rootnm]) {
        if (body_Obj[rootnm].hasOwnProperty(attr)) {
            if (typeof body_Obj[rootnm][attr] === 'boolean') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else if (typeof body_Obj[rootnm][attr] === 'string') {
            }
            else if (typeof body_Obj[rootnm][attr] === 'number') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else {
            }
        }
    }
}

// Whether a parsed body is usable as a oneM2M request: a plain object, not null, not an array.
function usable_object(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Parses the request body once. The raw root key before normalisation is kept in request.rawRootKey; ty is decided from it.
function parse_to_json(request, response, callback) {
    if (request.bodyParsed) {
        callback('200');
        return;
    }

    // A successful parse does not mean the top level is an object (JSON.parse('3') gives a number); such bodies are rejected as 400-7.
    function settle(result) {
        if (!usable_object(result)) {
            return false;
        }
        request.rawRootKey = Object.keys(result)[0];
        request.bodyObj = result;
        make_short_nametype(request.bodyObj);
        return true;
    }

    try {
        if (!settle(JSON.parse(request.body.toString()))) {
            callback('400-7');
            return;
        }

        if (Object.keys(request.bodyObj)[0] == 'undefined') {
            callback('400-7');
        }
        else {
            request.headers.rootnm = Object.keys(request.bodyObj)[0];
            request.bodyParsed = true;
            callback('200');
        }
    }
    catch (e) {
        callback('400-7');
    }
}

function parse_body_format(request, response, callback) {
    parse_to_json(request, response, (code) => {
        if (code === '200') {
            var body_Obj = request.bodyObj;
            for (var prop in body_Obj) {
                if (body_Obj.hasOwnProperty(prop)) {
                    for (var attr in body_Obj[prop]) {
                        if (body_Obj[prop].hasOwnProperty(attr)) {
                            if (attr == 'aa' || attr == 'at' || attr == 'poa' || attr == 'acpi' || attr == 'srt' ||
                                attr == 'nu' || attr == 'mid' || attr == 'macp' || attr == 'rels' || attr == 'srv') {
                                if (!Array.isArray(body_Obj[prop][attr])) {
                                    callback('400-8');
                                    return;
                                }
                            }
                            else if (attr == 'lbl') {
                                if (body_Obj[prop][attr] == null) {
                                    body_Obj[prop][attr] = [];
                                }
                                else if (!Array.isArray(body_Obj[prop][attr])) {
                                    callback('400-9');
                                    return;
                                }
                            }
                            else if (attr == 'enc') {
                                if (body_Obj[prop][attr].net) {
                                    if (!Array.isArray(body_Obj[prop][attr].net)) {
                                        callback('400-10');
                                        return;
                                    }
                                }
                                else {
                                    callback('400-11');
                                    return;
                                }
                            }
                            else if (attr == 'pv' || attr == 'pvs') {
                                if (body_Obj[prop][attr].hasOwnProperty('acr')) {
                                    if (!Array.isArray(body_Obj[prop][attr].acr)) {
                                        callback('400-12');
                                        return;
                                    }
                                    var acr = body_Obj[prop][attr].acr;
                                    for (var acr_idx in acr) {
                                        if (acr.hasOwnProperty(acr_idx)) {
                                            if (acr[acr_idx].acor) {
                                                if (!Array.isArray(acr[acr_idx].acor)) {
                                                    callback('400-13');
                                                    return;
                                                }
                                            }
                                            if (acr[acr_idx].acco) {
                                                if (!Array.isArray(acr[acr_idx].acco)) {
                                                    callback('400-14');
                                                    return;
                                                }
                                                for (var acco_idx in acr[acr_idx].acco) {
                                                    if (acr[acr_idx].acco.hasOwnProperty(acco_idx)) {
                                                        var acco = acr[acr_idx].acco[acco_idx];
                                                        if (acco.acip) {
                                                            if (acco.acip['ipv4']) {
                                                                if (!Array.isArray(acco.acip['ipv4'])) {
                                                                    callback('400-15');
                                                                    return;
                                                                }
                                                            }
                                                            else if (acco.acip['ipv6']) {
                                                                if (!Array.isArray(acco.acip['ipv6'])) {
                                                                    callback('400-16');
                                                                    return;
                                                                }
                                                            }
                                                        }
                                                        if (acco.actw) {
                                                            if (!Array.isArray(acco.actw)) {
                                                                callback('400-17');
                                                                return;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            else if (attr == 'uds') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    callback('400-18');
                                    return;
                                }
                            }
                            else if (attr == 'cas') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    callback('400-18');
                                    return;
                                }
                            }
                            else {
                            }
                        }
                    }
                }
            }
            callback(code);
        }
        else {
            callback(code);
        }
    });
}

function check_request_query_rt(request, response, callback) {


    if (request.query.rt == 3) { // default, blocking
        callback('200');
    }
    else if (request.query.rt == 1 || request.query.rt == 2) { // nonblocking
        // rt=2 must carry the address for the result in X-M2M-RTU.
        var rtu = request.headers['x-m2m-rtu'];
        if (request.query.rt == 2 && (rtu == null || rtu === '')) {
            callback('400-21');
            return;
        }

        // Non-blocking requests are not supported.
        console.log('[check_request_query_rt] 논블로킹(rt=' + request.query.rt + ')은 지원하지 않는다');
        callback('405-4');
    }
    else {
        callback('405-4');
    }
}

// Decides only whether the fanOutPoint target is a group with members; it sends no response.
//   '1' -> group with members; the group resource is the second argument
//   '2' -> group with empty mid   -> the caller answers 403-6
//   '0' -> not a group            -> the caller answers 404-4
/**
 * Handles a fanOutPoint (/fopt) request; the four methods share this flow.
 *
 *   access_value  POST '1' / GET '2' ('32' for discovery) / PUT '4' / DELETE '8'
 *   parse_body    whether the body must be read (POST and PUT)
 *
 *   1. check that the target is a group with members (check_grp)
 *   2. check access with the group's macp, not an ordinary acpi
 *   3. read the body if needed
 *   4. send the request to every member (fopt.check)
 *
 * Access denial is 403-5 here, not 403-3.
 */
function run_fanout(request, response, settle, access_value, parse_body) {
    check_grp(request, response, (rsc, result_grp) => {
        if (rsc !== '1') {
            // '2' means a group with an empty mid; anything else is not a group.
            settle.error(rsc === '2' ? '403-6' : '404-4');
            return;
        }

        var body_Obj = {};
        var target_ty = request.targetObject[Object.keys(request.targetObject)[0]].ty;

        security.check(request, response, target_ty, result_grp.macp, access_value, result_grp.cr, (code) => {
            if (code === '0') { settle.error('403-5'); return; }
            if (code !== '1') { settle.error(code); return; }

            function fan_out() {
                fopt.check(request, response, result_grp, body_Obj, (code, out) => {
                    settle.done(code, out);
                });
            }

            if (!parse_body) { fan_out(); return; }

            parse_body_format(request, response, (code) => {
                if (code !== '200') { settle.error(code); return; }
                fan_out();
            });
        });
    });
}

function check_grp(request, response, callback) {
    var result_Obj = request.targetObject;
    var rootnm = Object.keys(result_Obj)[0];

    if (result_Obj[rootnm].ty == 9) {
        if (result_Obj[rootnm].mid.length == 0) {
            callback('2');
            return '0';
        }
        else {
            callback('1', result_Obj[rootnm]);
            return '1';
        }
    }
    else {
        callback('0');
        return '0';
    }
}

/** The target is not under this CSE (get_target_url returned 301-1): forward to the remoteCSE. check_csr sends the request to the csr's poa and puts the answer in response.body / response.statusCode with code '301-2', which settle.raw sends as is (the body was made upstream). */
function forward_to_csr(request, response, settle) {
    check_csr(request, response, (code) => {
        if (code === '301-2') {
            settle.raw('csr forward', function () {
                response.status(response.statusCode).end(response.body);
            });
        }
        else {
            settle.error(code);
        }
    });
}

/** Leases a connection for one request and builds its settler. When no connection can be leased, a settler without a connection answers with the reason. fn receives only the settler; the connection goes to request.db_connection and the settler releases it. */
function with_connection(request, response, fn) {
    db.getConnection((code, connection) => {
        if (code !== '200') {
            // no connection was leased; nothing to release, so null
            make_settler(request, response, null).error(code);
            return;
        }
        request.db_connection = connection;
        fn(make_settler(request, response, connection));
    });
}

/** Common tail once the target is known: the target ri becomes request.url, the (fu, rcn) gate is applied (mobius/route_gate.js), lookup_* runs and the result is settled. request.url is set before the gate; DELETE also sets request.pi (resource.delete finds the parent by it). */
// method is the name the route knows, not request.method: Express 4 routes HEAD through app.get('*') with request.method 'HEAD', which the gate table does not know. HEAD is treated as GET; Node discards the body.
function run_operation(request, response, settle, method, lookup) {
    var rootnm = Object.keys(request.targetObject)[0];
    request.url = request.targetObject[rootnm].ri;
    if (method === 'DELETE') { request.pi = request.targetObject[rootnm].pi; }

    var reject = route_gate.reject(method, request.query);
    if (reject) { settle.error(reject); return; }

    lookup(request, response, (code, out) => { settle.done(code, out); });
}

/** Counts one request in the hit table on a connection of its own, released by itself; the response does not wait for it. Counting happens after check_xm2m_headers passed and, for GET, after the extra API paths were excluded (test/hit-after-validation.test.js). */
function count_hit(binding) {
    db.getConnection((code, connection) => {
        if (code !== '200') { return; }
        db_sql.set_hit(connection, binding, (err, results) => {
            results = null;
            db.release(connection);
        });
    });
}

// Builds the settler for one request; response_error_result ties the reason catalogue to responder.respond.
function make_settler(request, response, connection) {
    // The release function is injected so settle.js does not depend on the DB facade.
    return settle_mod.make(request, response, connection, response_error_result, db.release);
}

function response_error_result(request, response, code, callback) {
    var r = reason.get(code);
    if (!r) {
        // A code that is not in the catalogue is answered with 500 and logged.
        console.error('[response_error_result] 정의되지 않은 코드: ' + code);
        responder.respond(request, response, {
            code: RSC.INTERNAL_SERVER_ERROR,
            dbg: 'internal error',
            detail: 'unknown result code: ' + code
        }, callback);
        return;
    }
    // dbg goes to the client body (m2m:dbg); detail goes to the log only.
    responder.respond(request, response, { code: r.code, dbg: r.msg, detail: r.detail }, callback);
}

/** Decides the cr (creator) of the resource being checked: aei for an AE, csi for a remoteCSE. Resources without any ACP are judged by 'requester == cr', so this value decides the outcome. create does not use it: a remoteCSE parent keeps its cr. */
function resolve_cr(target) {
    if (target.ty == 2) {
        target.cr = target.aei;
    }
    else if (target.ty == 16) {
        target.cr = target.csi;
    }
}

/**
 * Common tail of the four lookup_* functions: check access, then run the operation.
 *
 *   1. security.check
 *   2. '1' runs the operation, '0' is 403-3, anything else is passed up as is.
 *
 * cr is prepared by the caller because create and the others differ.
 *
 * @param target        the resource checked: the parent for create, the resource itself otherwise
 * @param access_value  oneM2M acop bit: create '1' (sub '3') / retrieve '2' (discovery '32') / update '4' / delete '8'
 * @param run           the operation to run when access is granted (resource.create etc.)
 */
function authorize_and_run(request, response, target, access_value, run, callback) {
    security.check(request, response, target.ty, target.acpi, access_value, target.cr, (code) => {
        if (code === '1') {
            // The callback is passed through unchanged so the (null, out) result of resource.* reaches the settler.
            run(request, response, callback);
        }
        else if (code === '0') {
            callback('403-3');
        }
        else {
            callback(code);
        }
    });
}

function lookup_create(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code === '200') {
            var parentObj = request.targetObject[Object.keys(request.targetObject)[0]];

                if ((request.ty == 1) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // accessControlPolicy
                }
                else if ((request.ty == 9) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // group
                }
                else if ((request.ty == 16) && (parentObj.ty == 5)) { // remoteCSE
                }
                else if ((request.ty == 10) && (parentObj.ty == 5)) { // locationPolicy
                }
                else if ((request.ty == 2) && (parentObj.ty == 5)) { // ae
                }
                else if ((request.ty == 3) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3)) { // container
                }
                else if ((request.ty == 23) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27 || parentObj.ty == 28)) { // sub
                }
                else if ((request.ty == 4) && (parentObj.ty == 3)) { // contentInstance
                }
                else if ((request.ty == 24) && (parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 4)) { // semanticDescriptor
                }
                else if ((request.ty == 27) && (parentObj.ty == 2 || parentObj.ty == 16)) { // multimediaSession
                }
                else if ((request.ty == 14) && (parentObj.ty == 5)) { // node
                }
                else if ((request.ty == 13) && (parentObj.ty == 14)) { // mgmtObj
                }
                else if ((request.ty == 28) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 28)) { // flexcontainer
                }
                else if ((request.ty == 98 || request.ty == 97 || request.ty == 96 || request.ty == 95 || request.ty == 94 || request.ty == 93 || request.ty == 92 || request.ty == 91) && (parentObj.ty == 28)) { // flexcontainer
                }
                else {
                    callback('403-2');
                    return;
                }

                if ((request.ty == 4) && (parentObj.ty == 3)) { // contentInstance
                    if (parseInt(parentObj.mni) == 0) {
                        callback('406-1');
                        return;
                    }
                    else if (parseInt(parentObj.mbs) == 0) {
                        callback('406-2');
                        return;
                    }
                    else if (parentObj.disr == true) {
                        callback('405-6');
                        return;
                    }

                    request.headers.mni = parentObj.mni;
                    request.headers.mbs = parentObj.mbs;
                    request.headers.cni = parentObj.cni;
                    request.headers.cbs = parentObj.cbs;
                    request.headers.st = parentObj.st;
                }

                if (parentObj.length == 0) {
                    parentObj = {};
                    parentObj.cr = '';
                    console.log('no creator');
                }
                else {
                    if (parentObj.ty == 2) {
                        parentObj.cr = parentObj.aei;
                    }
                }

                // Subscription creation checks '3' (CREATE|RETRIEVE), not CREATE alone.
                var access_value = (request.ty == 23) ? security.ACOP.SUB_CREATE : security.ACOP.CREATE;

                authorize_and_run(request, response, parentObj, access_value, resource.create, callback);
        }
        else {
            callback(code);
        }
    });
}

function lookup_retrieve(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code !== '200') { callback(code); return; }

        var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        if(!resultObj.hasOwnProperty('acpi')) {
            resultObj.acpi = [];
        }

        // discovery (fu=1) checks DISCOVERY (32), an ordinary retrieve RETRIEVE (2).
        var access_value = (request.query.fu == 1) ? security.ACOP.DISCOVERY : security.ACOP.RETRIEVE;
        resolve_cr(resultObj);
        authorize_and_run(request, response, resultObj, access_value, resource.retrieve, callback);
    });
}

/** Whether the body changes anything besides acpi. An UPDATE that only changes acpi skips the access check: which ACP applies to the resource is governed by the ACP's selfPrivileges (pvs). */
function updates_beyond_acpi(bodyObj) {
    for (var rootnm in bodyObj) {
        if (!bodyObj.hasOwnProperty(rootnm)) { continue; }
        for (var attr in bodyObj[rootnm]) {
            if (bodyObj[rootnm].hasOwnProperty(attr) && attr !== 'acpi') {
                return true;
            }
        }
    }
    return false;
}

function lookup_update(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code !== '200') { callback(code); return; }

        var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        if (!updates_beyond_acpi(request.bodyObj)) {
            // Only acpi changes: proceed without the access check. The callback is passed through unchanged.
            resource.update(request, response, callback);
            return;
        }

        resolve_cr(resultObj);
        authorize_and_run(request, response, resultObj, security.ACOP.UPDATE, resource.update, callback);
    });
}

function lookup_delete(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code !== '200') { callback(code); return; }

        var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        resolve_cr(resultObj);
        authorize_and_run(request, response, resultObj, security.ACOP.DELETE, resource.delete, callback);
    });
}

function check_resource_from_url(connection, ri, sri, callback) {
    db_sql.select_resource_from_url(connection, ri, sri, (err, results) => {
        if (err) {
            callback(null, 500);
        }
        else if (results.length === 0) {
            callback(null, 404);
        }
        else if (!responder.typeRsrc.hasOwnProperty(String(results[0].ty))) {
            // A row exists in lookup but its type is not handled by this CSE (a leftover row of a removed type such as req/ty=17): answered as unsupported (501 here, 405-3 at the caller) instead of a broken query.
            console.log('[check_resource_from_url] 지원하지 않는 타입의 행: ty=' +
                        results[0].ty + ' ' + ri);
            callback(null, 501);
        }
        else {
            // Not cached: the object returned here belongs to this request only; the caller's makeObject modifies it in place.
            callback(results[0], 200);
        }
    });
}

function get_resource_from_url(connection, ri, sri, option, callback) {
    var targetObject = {};

    check_resource_from_url(connection, ri, sri, (result, code) => {
        if(code === 200) {
            var ty = result.ty;
            targetObject[responder.typeRsrc[ty]] = result;
            var rootnm = Object.keys(targetObject)[0];
            makeObject(targetObject[rootnm]);

            if (option == '/latest') {
                var latestObj = [];
                db_sql.select_latest_resource(connection, targetObject[rootnm], 0, latestObj, (code) => {
                    if (code === '200') {
                        if (latestObj.length == 1) {

                            // The JSON round trip strips the driver's row prototype (RowDataPacket on MySQL); the object is re-wrapped and sent as the response, so it must be a plain object.
                            latestObj[0] = JSON.parse(JSON.stringify(latestObj[0]));

                            targetObject = {};
                            targetObject[responder.typeRsrc[latestObj[0].ty]] = latestObj[0];
                            makeObject(targetObject[Object.keys(targetObject)[0]]);

                            callback(targetObject);
                        }
                        else {
                            callback(null, 404);
                            return '0';
                        }
                    }
                    else {
                        callback(null, 500);
                        return '0';
                    }
                });
            }
            else if (option == '/oldest') {
                var oldestObj = [];
                db_sql.select_oldest_resource(connection, parseInt(ty, 10) + 1, ri, oldestObj, (code) => {
                    if (code === '200') {
                        if (oldestObj.length == 1) {
                            targetObject = {};
                            targetObject[responder.typeRsrc[oldestObj[0].ty]] = oldestObj[0];
                            makeObject(targetObject[Object.keys(targetObject)[0]]);
                            callback(targetObject);
                        }
                        else {
                            callback(null, 404);
                            return '0';
                        }
                    }
                    else {
                        callback(null, 500);
                        return '0';
                    }
                });
            }
            else if (option == '/fopt') {
                callback(targetObject, 200);
            }
            else {
                callback(targetObject, 200);
            }
        }
        else {
            callback(result, code);
        }
    });
}

function extra_api_action(connection, url, callback) {
    if (url == '/hit') {
        // for backup hit count
        if (0) {
            var _hit_old = JSON.parse(fs.readFileSync('hit.json', 'utf-8'));
            var _http = 0;
            var _mqtt = 0;
            var _coap = 0;
            var _ws = 0;

            for (var dd in _hit_old) {
                if (_hit_old.hasOwnProperty(dd)) {
                    for (var ff in _hit_old[dd]) {
                        if (_hit_old[dd].hasOwnProperty(ff)) {
                            if (Object.keys(_hit_old[dd][ff]).length > 0) {
                                for (var gg in _hit_old[dd][ff]) {
                                    if (_hit_old[dd][ff].hasOwnProperty(gg)) {
                                        if (_hit_old[dd][ff][gg] == null) {
                                            _hit_old[dd][ff][gg] = 0;
                                        }
                                        if (gg == 'H') {
                                            _http = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'M') {
                                            _mqtt = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'C') {
                                            _coap = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'W') {
                                            _ws = _hit_old[dd][ff][gg];
                                        }
                                    }
                                }

                                db_sql.set_hit_n(connection, dd, _http, _mqtt, _coap, _ws, (err, results) => {
                                    results = null;
                                });
                            }
                        }
                    }
                }
            }
        }

        if (0) {
            var count = 0;
            setTimeout((count) => {
                if (count > 250) {
                    return;
                }
                var dd = moment().utc().subtract(count, 'days').format('YYYYMMDD');
                var _http = 5000 + Math.random() * 50000;
                var _mqtt = 1000 + Math.random() * 9000;
                var _coap = 0;
                var _ws = 0;

                db_sql.set_hit_n(connection, dd, _http, _mqtt, _coap, _ws, (err, results) => {
                    results = null;
                    console.log(count);
                    setTimeout(random_hit, 100, ++count);
                });
            }, 100, count);
        }

        db_sql.get_hit_all(connection, (err, result) => {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else if (url == '/total_ae') {
        db_sql.select_sum_ae(connection, function (err, result) {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else if (url == '/total_cbs') {
        db_sql.select_sum_cbs(connection, function (err, result) {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else {
        callback('200');
    }
}

function check_xm2m_headers(request, callback) {
    // Check X-M2M-RI Header
    if (request.headers.hasOwnProperty('x-m2m-ri')) {
        if (request.headers['x-m2m-ri'] === '') {
            callback('400-1');
            return;
        }
    }
    else {
        callback('400-1');
        return;
    }

    // Check X-M2M-RVI Header
    if (!request.headers.hasOwnProperty('x-m2m-rvi')) {
        request.headers['x-m2m-rvi'] = uservi;
    }

    // request.ty: the type of the resource this request creates or updates; null when not given.
    //
    // Decided in this order and never overturned:
    //   1. ty=N in Content-Type (right below)
    //   2. the body root name (type_resolver.resolve)
    // A mismatch is rejected with 400-42; a match only refines (ty=28 + hd:dooLk -> 98).
    //
    // null means 'not given' and collides with no type value. GET and DELETE have no body and keep null; they read the type from the target row.
    request.ty = null;

    if (request.headers.hasOwnProperty('content-type')) {
        var content_type = request.headers['content-type'].split(';');
        for (var i in content_type) {
            if (content_type.hasOwnProperty(i)) {
                var ty_arr = content_type[i].replace(/ /g, '').split('=');
                if (ty_arr[0].replace(/ /g, '') == 'ty') {
                    // 'ty' without a value (Content-Type: application/json;ty): ty_arr[1] is undefined; rejected with 400-55.
                    if (ty_arr[1] == null || ty_arr[1] === '') {
                        console.log('[check_xm2m_headers] Content-Type 의 ty 에 값이 없다: ' +
                                    request.headers['content-type']);
                        content_type = null;
                        callback('400-55');
                        return;
                    }
                    request.ty = ty_arr[1].replace(' ', '');
                    content_type = null;
                    break;
                }
            }
        }

        // ty=5 (CSEBase) is in the list but cannot be created by clients; a different reason from 'unsupported'.
        if (request.ty == '5') {
            callback('405-1');
            return;
        }

        // An explicit ty must be a type this CSE handles; ty_list is the single criterion. null (no ty in the header) is not filtered here; the body decides later (resolve).
        if (request.ty != null && !ty_list.includes(String(request.ty))) {
            console.log('[check_xm2m_headers] 지원하지 않는 ty: ' + request.ty);
            callback('400-3');
            return;
        }
    }


    // Check X-M2M-Origin Header
    if (request.headers.hasOwnProperty('x-m2m-origin')) {
        if (request.headers['x-m2m-origin'] === '') {
            // The body has not been read yet; the decision uses only what the header declared.
            if (request.ty == '2' || request.ty == '16') {
                request.headers['x-m2m-origin'] = 'S';
            }
            else {
                callback('400-2');
                return;
            }
        }
    }
    else {
        callback('400-2');
        return;
    }

    if (!request.query.hasOwnProperty('fu')) {
        request.query.fu = 2;
    }

    if (!request.query.hasOwnProperty('rcn')) {
        request.query.rcn = 1;
    }

    if (!request.query.hasOwnProperty('rt')) {
        request.query.rt = 3;
    }

    var allow = 1;
    if (allowed_ae_ids.length > 0) {
        allow = 0;
        for (var idx in allowed_ae_ids) {
            if (allowed_ae_ids.hasOwnProperty(idx)) {
                if (usecseid == request.headers['x-m2m-origin']) {
                    allow = 1;
                    break;
                }
                else if (allowed_ae_ids[idx] == request.headers['x-m2m-origin']) {
                    allow = 1;
                    break;
                }
            }
        }

        if (allow == 0) {
            callback('403-1');
            return;
        }
    }

    callback('200');
}

// Decides the resource type from the body: the ty decision point for CREATE and UPDATE. Parsing happens in parse_to_json, the decision in type_resolver.
function check_resource_supported(request, response, callback) {
    parse_to_json(request, response, (code) => {
        if (code !== '200') {
            callback(code);
            return;
        }

        // The raw root key before normalisation is used. request.ty holds the header value (or null); resolve compares it with the body and returns the final value, or 400-42 on mismatch.
        var resolved = type_resolver.resolve(request.rawRootKey, request.ty);
        if (resolved.rsc !== '200') {
            callback(resolved.rsc);
            return;
        }

        request.ty = resolved.ty;
        callback('200');
    });
}

function get_target_url(request, response, callback) {
    request.url = request.url.replace('%23', '#'); // convert '%23' to '#' of url
    request.hash = url.parse(request.url).hash;

    var absolute_url = request.url.replace('\/_\/', '\/\/').split('#')[0];
    absolute_url = absolute_url.replace(usespid, '/~');
    absolute_url = absolute_url.replace(/\/~\/[^\/]+\/?/, '/');
    var absolute_url_arr = absolute_url.split('/');

    // GET/DELETE have no body, so this is the only place that sets bodyObj for them. POST/PUT already parsed it in check_resource_supported and must not be overwritten.
    if (!request.bodyParsed) {
        request.bodyObj = {};
    }

    request.option = '';
    // A structured address (first segment is the CSEBase name) is looked up by ri (the primary key) only. Only an unstructured address (/~/<cseid>/<id> folded to /<id>) uses the second segment as sri.
    var head = absolute_url_arr[1].split('?')[0];
    request.sri = (head === usecsebase) ? null : head;
    if (absolute_url_arr[absolute_url_arr.length - 1] == 'la') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-3);
            request.option = '/latest';
        }
        else {
            // Without the return the flow would continue into get_resource_from_url and the callback would run twice.
            callback('405-13');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'latest') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-7);
            request.option = '/latest';
        }
        else {
            // Without the return the flow would continue into get_resource_from_url and the callback would run twice.
            callback('405-13');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'ol') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-3);
            request.option = '/oldest';
        }
        else {
            // return is required for the same reason (a duplicate callback kills the worker)
            callback('405-14');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'oldest') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-7);
            request.option = '/oldest';
        }
        else {
            // return is required for the same reason (a duplicate callback kills the worker)
            callback('405-14');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'fopt') {
        request.ri = absolute_url.split('?')[0].replace('/fopt', '');
        request.option = '/fopt';
    }
    else {
        request.ri = absolute_url.split('?')[0];
        request.option = '';
    }

    request.absolute_url = absolute_url;
    absolute_url = null;
    get_resource_from_url(request.db_connection, request.ri, request.sri, request.option, (targetObject, status) => {
        if (status == 404) {
            if (url.parse(request.absolute_url).pathname.split('/')[1] == usecsebase) {
                callback('404-1');
            }
            else {
                callback('301-1');
            }
        }
        else if (status == 500) {
            callback('500-1');
        }
        else if (status == 501) {
            // A row of a type this CSE does not handle; see check_resource_from_url.
            callback('405-3');
        }
        else {
            if (targetObject) {
                request.targetObject = JSON.parse(JSON.stringify(targetObject));
                targetObject = null;

                callback('200');
            }
            else {
                callback('404-1');
            }
        }
    });
}

function check_allowed_app_ids(request, callback) {
    // request.ty was fixed from the body root by check_resource_supported, so this cannot mismatch; kept as a guard.
    if (responder.typeRsrc[request.ty] != Object.keys(request.bodyObj)[0]) {
        callback('400-42');
        return;
    }

    if (request.ty == '2') {
        var allow = 1;
        if (allowed_app_ids.length > 0) {
            allow = 0;
            for (var idx in allowed_app_ids) {
                if (allowed_app_ids.hasOwnProperty(idx)) {
                    if (allowed_app_ids[idx] == request.bodyObj.ae.api) {
                        allow = 1;
                        break;
                    }
                }
            }
            if (allow == 0) {
                callback('403-4');
                return;
            }
        }
    }

    callback('200');
}

function check_type_update_resource(request, callback) {
    // Both CREATE and UPDATE decide ty through type_resolver.
    var body_root = Object.keys(request.bodyObj)[0];
    var resolved = type_resolver.resolve(body_root, null);

    if (resolved.rsc === '200') {
        if (resolved.ty === '4') {
            callback('405-7');      // contentInstance cannot be updated
            return;
        }
        if (resolved.ty === '17') {
            // Unreachable since 17 (req) left typeRsrc; kept in case the req resource returns.
            callback('405-8');
            return;
        }
        request.ty = resolved.ty;
    }

    // Body root and ty must agree. POST checks this in check_allowed_app_ids; PUT checks it here so an unprefixed body ({"cnt":...}) or a type without an attribute table ({"m2m:cb":...}) does not reach resource.update.
    if (responder.typeRsrc[request.ty] != body_root) {
        callback('400-42');
        return;
    }

    if (url.parse(request.targetObject[Object.keys(request.targetObject)[0]].ri).pathname == ('/' + usecsebase)) {
        callback('405-9');
        return;
    }

    callback('200');
}

function check_type_delete_resource(request, callback) {
    if (url.parse(request.targetObject[Object.keys(request.targetObject)[0]].ri).pathname == ('/' + usecsebase)) {
        callback('405-9');
    }
    else {
        callback('200');
    }
}

// Request body collector; see mobius/body.js.
var body = require('./mobius/body');
var log_safe = require('./mobius/log_safe');
var onem2mParser = body.collect;


/**
 * This CSE handles JSON only; a request body in xml/cbor is rejected here, before any DB connection is leased.
 *
 * Accept is not checked: responses are always JSON (responder.apply_headers), and a browser's default Accept includes application/xml.
 *
 * Only the MIME type before the semicolon is compared, so parameters such as ;ty=2;note=xmlish cannot cause a false match. The detail of 400-64 is logged with console.error, so the log shows how much xml/cbor arrives.
 */
var JSON_ONLY_DENY = /^(application|text)\/(.*\+)?(xml|cbor)$/;

app.use((req, res, next) => {
    var ct = req.headers['content-type'];
    if (typeof ct !== 'string' || ct === '') { return next(); }

    // Only the MIME type before the semicolon is compared; the regex is anchored so parameters cannot match.
    var mime = ct.split(';')[0].trim().toLowerCase();
    if (!JSON_ONLY_DENY.test(mime)) { return next(); }

    console.error('[json_only] ' + req.method + ' ' + req.url +
                  '  Content-Type: ' + mime +
                  '  origin=' + log_safe.origin(req.headers['x-m2m-origin']));

    // The response goes through the same outlet as every other error: reason entries carry the rsc.js catalogue object, and respond() sets RI/RVI/Locale, Content-Type, RSC and the body. detail is not passed because the line above already logged more.
    var r = reason.get('400-64');
    responder.respond(req, res, { code: r.code, dbg: r.msg }, function () {});
});

// remoteCSE, ae, cnt
app.post('*', onem2mParser, (request, response) => {
    with_connection(request, response, (settle) => {
        check_xm2m_headers(request, (code) => {
            if (code === '200') {
                // Count only requests that passed header validation.
                count_hit(request.headers['binding'] || 'H');

                if (request.body !== "") {
                    check_resource_supported(request, response, (code) => {
                        if (code === '200') {
                            get_target_url(request, response, (code) => {
                                if (code === '200') {
                                    if (request.option !== '/fopt') {
                                        parse_body_format(request, response, (code) => {
                                            if (code === '200') {
                                                check_allowed_app_ids(request, (code) => {
                                                    if (code === '200') {
                                                        check_post_content_type(request, (code) => {
                                                            if (code === '200') {
                                                                run_operation(request, response, settle, 'POST', lookup_create);
                                                            }
                                                            else {
                                                                settle.error(code);
                                                            }
                                                        });
                                                    }
                                                    else {
                                                        settle.error(code);
                                                    }
                                                });
                                            }
                                            else {
                                                settle.error(code);
                                            }
                                        });
                                    }
                                    else {
                                        run_fanout(request, response, settle, security.ACOP.CREATE, true);
                                    }
                                }
                                else if (code === '301-1') {
                                    forward_to_csr(request, response, settle);
                                }
                                else {
                                    settle.error(code);
                                }
                            });
                        }
                        else {
                            settle.error(code);
                        }
                    });
                }
                else {
                    settle.error('400-40');
                }
            }
            else {
                settle.error(code);
            }
        });
    });
});

app.get('*', onem2mParser, (request, response) => {
    with_connection(request, response, (settle) => {
        extra_api_action(request.db_connection, request.url, (code, result) => {
            if (code === '200') {
                check_xm2m_headers(request, (code) => {
                    if (code === '200') {
                        // Count only requests that passed header validation; the extra API paths were excluded above.
                        count_hit(request.headers['binding'] || 'H');

                        get_target_url(request, response, (code) => {
                            if (code === '200') {
                                if (request.option !== '/fopt') {
                                    run_operation(request, response, settle, 'GET', lookup_retrieve);
                                }
                                else {
                                    run_fanout(request, response, settle, (request.query.fu == 1) ? security.ACOP.DISCOVERY : security.ACOP.RETRIEVE, false);
                                }
                            }
                            else if (code === '301-1') {
                                forward_to_csr(request, response, settle);
                            }
                            else {
                                settle.error(code);
                            }
                        });
                    }
                    else {
                        settle.error(code);
                    }
                });
            }
            else if (code === '201') {
                // Response of /hit, /total_ae and /total_cbs: server statistics, not oneM2M resources, so they do not fit the responder shape and are sent with settle.raw, which releases the connection after the response and goes through claim().
                settle.raw('extra api ' + request.url, function () {
                    response.header('Content-Type', 'application/json');
                    response.status(200).end(JSON.stringify(result, null, 4));
                    result = null;
                });
            }
            else {
                settle.error(code);
            }
        });
    });
});


app.put('*', onem2mParser, (request, response) => {
    with_connection(request, response, (settle) => {
        check_xm2m_headers(request, (code) => {
            if (code === '200') {
                // Count only requests that passed header validation.
                count_hit(request.headers['binding'] || 'H');

                if (request.body !== "") {
                    check_resource_supported(request, response, (code) => {
                        if (code === '200') {
                            get_target_url(request, response, (code) => {
                                if (code === '200') {
                                    if (request.option !== '/fopt') {
                                        parse_body_format(request, response, (code) => {
                                            if (code === '200') {
                                                check_type_update_resource(request, (code) => {
                                                    if (code === '200') {
                                                        run_operation(request, response, settle, 'PUT', lookup_update);
                                                    }
                                                    else {
                                                        settle.error(code);
                                                    }
                                                });
                                            }
                                            else {
                                                settle.error(code);
                                            }
                                        });
                                    }
                                    else {
                                        run_fanout(request, response, settle, security.ACOP.UPDATE, true);
                                    }
                                }
                                else if (code === '301-1') {
                                    forward_to_csr(request, response, settle);
                                }
                                else {
                                    settle.error(code);
                                }
                            });
                        }
                        else {
                            settle.error(code);
                        }
                    });
                }
                else {
                    settle.error('400-40');
                }
            }
            else {
                settle.error(code);
            }
        });
    });
});

app.delete('*', onem2mParser, (request, response) => {
    with_connection(request, response, (settle) => {
        check_xm2m_headers(request, (code) => {
            if (code === '200') {
                // Count only requests that passed header validation.
                count_hit(request.headers['binding'] || 'H');

                get_target_url(request, response, (code) => {
                    if (code === '200') {
                        if (request.option !== '/fopt') {
                            check_type_delete_resource(request, (code) => {
                                if (code === '200') {
                                    run_operation(request, response, settle, 'DELETE', lookup_delete);
                                }
                                else {
                                    settle.error(code);
                                }
                            });
                        }
                        else {
                            run_fanout(request, response, settle, security.ACOP.DELETE, false);
                        }
                    }
                    else if (code === '301-1') {
                        forward_to_csr(request, response, settle);
                    }
                    else {
                        settle.error(code);
                    }
                });
            }
            else {
                settle.error(code);
            }
        });
    });
});

// POST must carry ty in Content-Type (oneM2M HTTP binding CREATE).
function check_post_content_type(request, callback) {
    if (!request.headers.hasOwnProperty('content-type')) {
        callback('400-20');
        return;
    }
    if (!request.headers['content-type'].includes('ty')) {
        callback('400-19');
        return;
    }
    callback('200');
}

/** Headers for requests sent upstream (remote CSE). check_csr -> forward_http would otherwise pass the client's headers, including its Accept, to the upstream; this CSE only handles JSON, so Accept is forced to application/json (mobius/outbound_headers.js). */
var outbound_headers = require('./mobius/outbound_headers');


/**
 * Copies the upstream response headers into our response.
 *
 * Content-Type is treated specially: this path (csr forward) uses settle.raw and bypasses responder.apply_headers, so a non-JSON upstream body would go out as our response. A non-JSON Content-Type is therefore not relayed; the request fails and the upstream's behaviour is logged. Outbound requests send Accept: application/json, so a compliant upstream never triggers this.
 *
 * @returns true when relayed; false when the caller must fail the request.
 */
var RELAY_JSON_OK = /^(application|text)\/(.*\+)?json\b/;

function relay_headers(response, res, label) {
    var ct = res.headers['content-type'];

    if (ct) {
        var mime = String(ct).split(';')[0].trim().toLowerCase();
        if (!RELAY_JSON_OK.test(mime)) {
            console.error('[' + label + '] 상류가 json 이 아닌 것을 보냈다: ' + mime +
                          ' — 흘려보내지 않는다');
            return false;
        }
        response.header('Content-Type', ct);
    }
    // No Content-Type means no body; proceed. Only a present but non-JSON type fails.

    // Incoming names are lower-case (Node), outgoing names keep their canonical spelling; the table keeps the names stable for logs and golden files.
    var RELAY = {
        'x-m2m-ri':         'X-M2M-RI',
        'x-m2m-rvi':        'X-M2M-RVI',
        'x-m2m-rsc':        'X-M2M-RSC',
        'content-location': 'Content-Location'
    };
    Object.keys(RELAY).forEach(function (k) {
        if (res.headers[k]) { response.header(RELAY[k], res.headers[k]); }
    });
    return true;
}

function check_csr(request, response, callback) {
    // This callback sends the response and releases the connection; it must run once.
    callback = once(callback, 'check_csr');

    var ri = util.format('/%s/%s', usecsebase, url.parse(request.absolute_url).pathname.split('/')[1]);
    console.log('[check_csr] : ' + ri);
    db_sql.select_csr(request.db_connection, ri, (err, result_csr) => {
        if (!err) {
            if (result_csr.length == 1) {
                var point = {};
                point.forwardcbname = result_csr[0].cb.replace('/', '');

                // poa is stored in the DB and may be broken; a throw here would kill the worker.
                var poa_arr = poa_util.parse(result_csr[0].poa, '[check_csr] ' + ri);
                if (poa_arr === null) {
                    result_csr = null;
                    callback('500-1');
                    return;
                }

                // poa is a list of candidate points of access; the first usable http one is chosen. Iterating all of them called the callback once per entry.
                var chosen = null;
                var saw_mqtt = false;
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = url.parse(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        chosen = poa;
                        break;
                    }
                    else if (poa.protocol == 'mqtt:') {
                        saw_mqtt = true;
                    }
                }

                if (chosen === null) {
                    // An empty poa is not rare (the default is []); without this branch the loop ran zero times and the callback was never called.
                    var why;
                    if (poa_arr.length === 0) {
                        console.log('[check_csr] poa 가 비어 있어 포워딩할 곳이 없다: ' + ri);
                        why = '404-9';    // TARGET_NOT_REACHABLE
                    }
                    else if (saw_mqtt) {
                        console.log('forwarding with mqtt is not supported');
                        why = '501-3';    // NOT_IMPLEMENTED
                    }
                    else {
                        console.log('protocol in poa of csr is not supported');
                        why = '501-4';    // NOT_IMPLEMENTED
                    }
                    result_csr = null;
                    callback(why);
                    return;
                }

                point.forwardcbhost = chosen.hostname;
                point.forwardcbport = chosen.port;
                result_csr = null;

                console.log('csebase forwarding to ' + point.forwardcbname);

                // Accept is forced to json; see outbound_headers.
                forward_http(point.forwardcbhost, point.forwardcbport, request.url, request.method, outbound_headers(request.headers), request.body, (code, _res) => {
                    if (code === '200') {
                        // _res is an http.IncomingMessage with circular references (socket -> _httpMessage -> agent), so it cannot be serialised; only the headers, body and status code are copied.
                        var res = {
                            headers: _res.headers || {},
                            body: _res.body,
                            statusCode: _res.statusCode
                        };
                        _res = null;

                        // A non-JSON upstream body is not relayed. This path answers through settle.raw and bypasses responder.apply_headers.
                        if (!relay_headers(response, res, 'csr forward')) {
                            callback('500-7');
                            return;
                        }

                        response.body = res.body;
                        response.statusCode = res.statusCode;

                        callback('301-2');
                    }
                    else {
                        callback(code);
                    }
                });
            }
            else {
                result_csr = null;
                callback('404-3');
            }
        }
        else {
            // On error the facade calls callback(true, err), so the error object is the second argument.
            console.log('[check_csr] query error: ' + result_csr.message);
            callback('404-3');
        }
    });
}


function forward_http(forwardcbhost, forwardcbport, f_url, f_method, f_headers, f_body, callback) {
    var options = {
        hostname: forwardcbhost,
        port: forwardcbport,
        path: f_url,
        method: f_method,
        headers: f_headers
    };

    var req = http.request(options, (res) => {
        body.read(res, (err, fullBody) => {
            if (err) {
                console.error('[forward_http] 원격 응답을 받지 못했다: ' + err.message);
                callback('404-10');   // upstream did not answer: TARGET_NOT_REACHABLE
                return;
            }
            res.body = fullBody;

            // Only what diagnosis needs is logged: status, body length and URL. The headers are not dumped because X-M2M-Origin may be the superuser value.
            console.log('[forward_http] ' + res.statusCode + '  ' + fullBody.length + '자  ' + f_url);

            callback('200', res);
        });
    });

    // Cut the request when no response arrives; destroying it triggers the error handler below.
    outbound.arm(req, 'csr forward');
    req.on('error', (e) => {
        console.log('[forward_http] problem with request: ' + e.message);

        callback('404-3');
    });

    // Only method, URL and body length are logged; the outgoing headers carry X-M2M-Origin, which may be the superuser value.
    console.log('[forward_http] -----> ' + f_method + ' ' + f_url +
                '  ' + (f_body ? f_body.length : 0) + '자');

    // write data to request body
    if ((f_method.toLowerCase() == 'get') || (f_method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(f_body);
    }
    req.end();
}

if (process.env.NODE_ENV == 'production') {
    console.log("Production Mode");
}
else if (process.env.NODE_ENV == 'development') {
    console.log("Development Mode");
}

function scheduleGc() {
    if (!global.gc) {
        console.log('Garbage collection is not exposed');
        return;
    }

    // schedule next gc within a random interval (e.g. 15-45 minutes)
    // tweak this based on your app's memory usage
    var nextMinutes = Math.random() * 30 + 15;

    setTimeout(() => {
        global.gc();
        console.log('Manual gc', process.memoryUsage());
        scheduleGc();
    }, nextMinutes * 60 * 1000);
}

// call this in the startup script of your app (once per process)
scheduleGc();
