'use strict';
/*
 * Startup failure must not be silent.
 *
 * When no DB connection can be obtained, the master's cluster.fork() sits inside the getConnection success branch, so no worker starts and no port opens; a worker does not listen, but does not die either, so cluster.on('exit') never fires and no re-fork happens. In both cases the process stays alive: the supervisor (pm2) shows 'online' and a process-only health check passes, while every request is refused.
 *
 * The MySQL adapter's connect only creates the pool and always reports success; the real connection happens on the first getConnection, so a briefly late MySQL or a wrong password produces exactly this state.
 *
 * The process therefore logs and exits so the supervisor restarts it. The access log is flushed before exit using the mechanism backstop already provides.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const backstop = require('../mobius/backstop');

function quiet(fn) {
    const log = console.log, err = console.error;
    console.log = function () {}; console.error = function () {};
    try { return fn(); } finally { console.log = log; console.error = err; }
}

test('exitAfterFlush 는 로그를 비운 뒤에 종료한다', function (t, done) {
    // In the opposite order the last line is lost; backstop hit the same problem on the crash path.
    backstop._resetFlushers();
    let flushed = false;

    backstop.flushOnExit(function (cb) {
        flushed = true;
        setImmediate(cb);              // asynchronous, like a real stream end()
    });

    quiet(function () {
        backstop.exitAfterFlush(1, {
            onFatal: function (code) {
                assert.strictEqual(flushed, true, '비우기 전에 종료했다');
                assert.strictEqual(code, 1, '종료 코드가 1 이어야 감독이 실패로 본다');
                backstop._resetFlushers();
                done();
            }
        });
    });
});

test('비우기가 안 끝나도 종료는 한다', function (t, done) {
    // A process that failed to start: its stream may not be set up, so the end() callback may never arrive. If exit then waited forever, the state this fix removes (alive without ports) would be back.
    backstop._resetFlushers();
    backstop.flushOnExit(function () { /* never calls done */ });

    quiet(function () {
        backstop.exitAfterFlush(1, {
            flushTimeoutMs: 40,
            onFatal: function (code) {
                assert.strictEqual(code, 1);
                backstop._resetFlushers();
                done();
            }
        });
    });
});

test('등록된 비우기가 없으면 곧바로 종료한다', function (t, done) {
    backstop._resetFlushers();
    quiet(function () {
        backstop.exitAfterFlush(1, {
            onFatal: function (code) { assert.strictEqual(code, 1); done(); }
        });
    });
});

/* Does the startup path actually use this. */

const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function liveLines(src) {
    return src.split(/\r?\n/).map(function (l, i) { return { n: i + 1, t: l }; })
        .filter(function (x) { return !/^\s*(\/\/|\*|\/\*)/.test(x.t); });
}

test('기동 실패 분기가 로그만 찍고 끝나지 않는다', function () {
    // Five sites: getConnection failure in master / worker / non-cluster, and connect failure. Any one that only logs keeps that path silently alive.
    const live = liveLines(APP);

    const silent = live.filter(function (x) {
        return /\[db\.connect\] No Connection/.test(x.t) ||
               /\[db\] connect 실패/.test(x.t);
    });

    // The line itself may remain; an exit must follow it.
    for (const s of silent) {
        const after = live.filter(function (x) { return x.n > s.n && x.n <= s.n + 6; })
                          .map(function (x) { return x.t; }).join('\n');
        assert.match(after, /fail_start\(/,
            'app.js:' + s.n + ' 이 실패를 로그로만 남기고 끝난다 — ' +
            '포트 없이 살아 있는 프로세스가 된다. fail_start() 로 종료할 것');
    }

    assert.ok(silent.length >= 5,
        '기동 실패 분기를 ' + silent.length + '개만 찾았다 — 5개여야 한다. ' +
        '문구가 바뀌었다면 이 시험도 같이 고칠 것');
});

test('fail_start 가 종료를 미룬다 — 감독의 재시작 폭주를 막는다', function () {
    // pm2 counts a process as started only after min_uptime (default 1 second); a process that dies faster is counted against max_restarts (default 15) and then left as errored. With a DB that is a few seconds late at boot, the service would never come up even after MySQL returns. So the process waits briefly before exiting, long enough for the supervisor to count it as alive and reset the restart counter.
    const m = APP.match(/var\s+START_FAIL_EXIT_MS\s*=\s*(\d+)/);
    assert.ok(m, 'START_FAIL_EXIT_MS 상수가 없다');
    assert.ok(Number(m[1]) >= 2000,
        '종료 지연이 ' + m[1] + 'ms 다 — pm2 의 min_uptime(1초)보다 넉넉해야 ' +
        '재시작 카운터가 안 튄다');
});
