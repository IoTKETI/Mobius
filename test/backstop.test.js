'use strict';
// Last line of defence: the master survives, the worker exits.
//
// The roles differ: the master handles no requests; it forks workers, and a throw in the master would take the respawn logic with it. A worker handles requests; kept alive, the request that threw would hang without a response and its connection would leave the pool for good, whereas exiting closes the socket and reclaims it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

global.NOPRINT = 'true';

const backstop = require('../mobius/backstop');

function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function () {
        lines.push(Array.prototype.join.call(arguments, ' '));
    };
    try { return fn(lines); }
    finally { console.error = orig; }
}

// A fake process; install hooks its handlers onto it.
function fakeProc() {
    const p = new EventEmitter();
    p.exit = function (code) { p.exited = code; };
    return p;
}

test('마스터는 예외를 받아도 종료하지 않는다', function () {
    backstop._reset();
    const proc = fakeProc();
    let fatal = null;

    const lines = quiet(function (out) {
        backstop.install('master', { proc: proc, onFatal: function (c) { fatal = c; } });
        proc.emit('uncaughtException', new Error('프록시가 던졌다'), 'uncaughtException');
        return out;
    });

    assert.strictEqual(fatal, null, '마스터는 종료하면 안 된다 — 재기동 로직까지 사라진다');
    assert.strictEqual(proc.exited, undefined);
    assert.ok(lines.some((l) => /프록시가 던졌다/.test(l)), '예외가 로그에 남아야 한다');
    assert.ok(lines.some((l) => /마스터는 계속 돈다/.test(l)));
});

test('워커는 예외를 받으면 종료한다', function () {
    backstop._reset();
    const proc = fakeProc();
    let fatal = null;

    const lines = quiet(function (out) {
        backstop.install('worker', { proc: proc, onFatal: function (c) { fatal = c; } });
        proc.emit('uncaughtException', new Error('요청 처리 중 던졌다'), 'uncaughtException');
        return out;
    });

    assert.strictEqual(fatal, 1, '워커는 종료해야 한다 — 살려 두면 커넥션이 샌다');
    assert.ok(lines.some((l) => /요청 처리 중 던졌다/.test(l)));
    assert.ok(lines.some((l) => /워커를 종료한다/.test(l)));
});

test('처리되지 않은 거부도 같은 규칙으로 다룬다', function () {
    // From Node 15 the default is throw; without a handler this becomes an uncaughtException.
    backstop._reset();
    const proc = fakeProc();
    let fatal = null;

    const lines = quiet(function (out) {
        backstop.install('worker', { proc: proc, onFatal: function (c) { fatal = c; } });
        proc.emit('unhandledRejection', new Error('거부됐다'), Promise.resolve());
        return out;
    });

    assert.strictEqual(fatal, 1);
    assert.ok(lines.some((l) => /거부됐다/.test(l)));
    assert.ok(lines.some((l) => /unhandledRejection/.test(l)));
});

// ── The log must not flood ──
//
// The master survives, so a handler that throws on every message would stack the same trace endlessly and swamp the production log.

test('같은 예외가 반복되면 로그를 접는다', function () {
    backstop._reset();
    const err = new Error('같은 것');

    const lines = quiet(function (out) {
        for (let i = 0; i < 50; i++) { backstop.report('master', err, null, 1000); }
        return out;
    });

    // The first 3 with full stacks, then one line saying the rest is folded; afterwards silence within the same millisecond.
    assert.ok(lines.length <= backstop._FULL_LOG_LIMIT + 1,
        '반복 예외가 ' + lines.length + '줄을 남겼다 — 로그가 밀린다');
    assert.ok(lines.some((l) => /이후로는/.test(l)), '접는다는 사실을 알려야 한다');
});

test('시간이 지나면 누적 횟수를 한 줄로 남긴다', function () {
    backstop._reset();
    const err = new Error('오래 반복');

    const lines = quiet(function (out) {
        for (let i = 0; i < 10; i++) { backstop.report('master', err, null, 1000); }
        // after the summary interval
        backstop.report('master', err, null, 1000 + backstop._SUMMARY_INTERVAL_MS);
        return out;
    });

    assert.ok(lines.some((l) => /누적 11회/.test(l)),
        '조용해지기만 하면 문제가 계속되는지 알 수 없다');
});

test('다른 예외는 각자 세어 서로를 가리지 않는다', function () {
    backstop._reset();

    const lines = quiet(function (out) {
        for (let i = 0; i < 10; i++) { backstop.report('master', new Error('A'), null, 1000); }
        backstop.report('master', new Error('B'), null, 1000);
        return out;
    });

    assert.ok(lines.some((l) => /Error: B/.test(l)),
        'A 가 접혔다고 B 까지 묻히면 안 된다');
});

// ── Throwing a non-Error must not kill ──

test('Error 가 아닌 값을 던져도 백스톱 자신이 던지지 않는다', function () {
    backstop._reset();
    const proc = fakeProc();

    quiet(function () {
        backstop.install('master', { proc: proc, onFatal: function () {} });
        // throw 'string' / throw null / throw undefined are all possible.
        assert.doesNotThrow(function () {
            proc.emit('uncaughtException', 'string 을 던졌다');
            proc.emit('uncaughtException', null);
            proc.emit('uncaughtException', undefined);
            proc.emit('uncaughtException', { code: 42 });
        });
    });
});

// ── app.js installs both roles ──

test('app.js 가 마스터와 워커에 각각 백스톱을 건다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    assert.ok(/backstop\.install\('master'\)/.test(src), '마스터 백스톱이 없다');
    assert.ok(/backstop\.install\('worker'\)/.test(src), '워커 백스톱이 없다');

    // The master side must be inside the cluster.isMaster block.
    const master_at = src.indexOf("backstop.install('master')");
    const branch_at = src.indexOf('if (cluster.isMaster)');
    const worker_at = src.indexOf("backstop.install('worker')");
    assert.ok(branch_at > 0 && master_at > branch_at,
        '마스터 백스톱이 cluster.isMaster 블록 밖에 있다');
    assert.ok(worker_at > master_at,
        '워커 백스톱이 마스터 블록보다 앞에 있다 — 역할이 뒤바뀌었는지 확인할 것');
});

test('백스톱은 응답을 쓰지 않는다', function () {
    // Writing a second response to an answered request dies again with ERR_HTTP_HEADERS_SENT. lease.js keeps only a ledger for the same reason.
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'backstop.js'), 'utf8');

    for (const forbidden of ['response.', 'res.end', 'writeHead', 'response_error_result']) {
        assert.strictEqual(src.indexOf(forbidden), -1,
            'backstop 이 응답에 손댄다(' + forbidden + ') — 이중 응답으로 새 사망 경로가 생긴다');
    }
});

/* ── Flushing logs before exit ── */
// proc.exit does not wait for pending asynchronous I/O, so a line written to the access log could stay in the buffer and vanish with the process; that line is the record of the request just before the crash.

test('워커가 죽기 전에 등록된 것을 비운다', function (t, done) {
    backstop._reset();
    backstop._resetFlushers();
    const proc = fakeProc();
    let flushed = false;
    let fatal = null;

    backstop.flushOnExit(function (cb) {
        flushed = true;
        setImmediate(cb);          // asynchronous, like a real stream end()
    });

    quiet(function () {
        backstop.install('worker', {
            proc: proc,
            onFatal: function (c) {
                fatal = c;
                // Exit only after flushing; the reverse order is pointless.
                assert.strictEqual(flushed, true, '비우기 전에 종료했다');
                assert.strictEqual(fatal, 1);
                backstop._resetFlushers();
                done();
            }
        });
        proc.emit('uncaughtException', new Error('던졌다'), 'uncaughtException');
    });
});

test('비우기가 안 끝나도 종료는 한다 — 상한이 끊는다', function (t, done) {
    // A worker that is dying: the stream may already be broken and end()'s callback may never come. If exit hung on it, requests would hang without responses with connections out of the pool while the process stays alive, the opposite of why the worker is killed.
    backstop._reset();
    backstop._resetFlushers();
    const proc = fakeProc();

    backstop.flushOnExit(function () { /* never calls done */ });

    const t0 = Date.now();
    quiet(function () {
        backstop.install('worker', {
            proc: proc,
            flushTimeoutMs: 40,
            onFatal: function (c) {
                assert.strictEqual(c, 1);
                assert.ok(Date.now() - t0 >= 35, '상한을 안 기다렸다');
                backstop._resetFlushers();
                done();
            }
        });
        proc.emit('uncaughtException', new Error('던졌다'), 'uncaughtException');
    });
});

test('비우다 던져도 종료는 한다', function (t, done) {
    backstop._reset();
    backstop._resetFlushers();
    const proc = fakeProc();

    backstop.flushOnExit(function () { throw new Error('스트림이 이미 망가졌다'); });

    quiet(function () {
        backstop.install('worker', {
            proc: proc,
            onFatal: function (c) {
                assert.strictEqual(c, 1, '비우기가 던지면 종료를 못 한다');
                backstop._resetFlushers();
                done();
            }
        });
        proc.emit('uncaughtException', new Error('던졌다'), 'uncaughtException');
    });
});

test('등록이 없으면 예전처럼 곧장 종료한다', function () {
    // No waiting for a cap; must finish synchronously.
    backstop._reset();
    backstop._resetFlushers();
    const proc = fakeProc();
    let fatal = null;

    quiet(function () {
        backstop.install('worker', { proc: proc, onFatal: function (c) { fatal = c; } });
        proc.emit('uncaughtException', new Error('던졌다'), 'uncaughtException');
    });

    assert.strictEqual(fatal, 1, '등록이 없는데 종료가 미뤄졌다');
});

test('app.js 가 액세스 로그 스트림을 등록한다', function () {
    // backstop does not know what to flush; the registering side knows its own. Without this line the device above flushes nothing.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    assert.match(src, /backstop\.flushOnExit\(/,
        'app.js 가 액세스 로그 스트림을 backstop 에 등록하지 않는다 — ' +
        '워커가 죽을 때 마지막 요청의 기록이 사라진다');
    assert.match(src, /accessLogStream\.end\(/,
        '등록은 했는데 스트림을 안 닫는다 — end() 가 버퍼를 내보낸다');
});
