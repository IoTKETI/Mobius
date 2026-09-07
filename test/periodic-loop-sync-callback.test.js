'use strict';
// The batch loops of the master's periodic jobs must survive callbacks that return synchronously.
//
// When a mysql2 connection dies, addCommand is replaced by _addCommandClosedState, which calls cmd.onResult(err) in place without process.nextTick. The execute -> facade.run -> sql_action callbacks then all return on one stack, and a loop that recurses per row grows the stack by a dozen frames per row until RangeError.
//
// That RangeError is thrown from a driver frame, so no try at the call site catches it; the app.js callback never starts and the latch (reconcile_running / purge_running) stays set. The master survives through backstop, and every later tick bounces on `if (running) return` without a log line.
//
// Guarded here: the trampoline receives synchronous returns as a flag only, keeping the stack constant; and if the loop still throws, the callback receives LOOP_THREW instead of being lost, so the caller can release the latch.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');

process.env.MOBIUS_SQLITE_PATH = path.join(os.tmpdir(), 'mobius-sync-callback-test.db');
global.NOPRINT = 'true';

// Mimics a dead connection: only the first SELECT succeeds, everything after fails synchronously. The stand-in must not be more lenient than the real driver: wrapping the failure in setImmediate would make the test lie.
function deadConnAdapter(rows, firstMatches) {
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(ROOT, 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));

    let first = true;
    adapter.execute = function (conn, sql, bindings, cb) {
        if (first && firstMatches(sql)) {
            first = false;
            return cb(null, rows);
        }
        const err = new Error("Can't add new command when connection is in closed state");
        err.fatal = true;
        err.code = 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR';
        return cb(err, null);          // synchronous; this is the core of the reproduction
    };
    adapter.begin = function (h, cb) { cb(new Error('dead')); };
    adapter.commit = function (h, cb) { cb(null); };
    adapter.rollback = function (h, cb) { cb(null); };

    db.connect(function () {});
    return require(path.join(ROOT, 'mobius', 'sql_action.js'));
}

function quiet(fn) {
    const l = console.log, e = console.error, t = console.time, te = console.timeEnd;
    console.log = console.error = console.time = console.timeEnd = function () {};
    try { return fn(); }
    finally { console.log = l; console.error = e; console.time = t; console.timeEnd = te; }
}

function cntRows(n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        // ri must be sorted for the cursor to advance. cni must stay below maxCni (1,000,000) so the row takes the aggregation branch, not the deferral branch (setImmediate), which already breaks the stack.
        rows.push({ ri: 'ri' + String(i).padStart(6, '0'), cni: 5, cbs: 50 });
    }
    return rows;
}

function cntOverLimitRows(n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        rows.push({ ri: 'ri' + String(i).padStart(6, '0'), ty: 3,
                    cni: 100, cbs: 1000, mni: 10, mbs: 100 });
    }
    return rows;
}

// The values app.js actually uses. When they change, the test changes with them.
const RECONCILE_LIMIT = 2000;
const PURGE_LIMIT = 100;

test('reconcile: 죽은 커넥션이 동기로 실패해도 콜백이 온다 (app.js 의 limit 2000)', function (t, done) {
    const sql_action = deadConnAdapter(cntRows(RECONCILE_LIMIT), s => /from `cnt`/i.test(s));

    quiet(function () {
        sql_action.reconcile_cnt_counters({}, { limit: RECONCILE_LIMIT, cursor: '', budgetMs: 30000 },
            function (err, report) {
                // Before the fix this point was never reached (RangeError).
                assert.strictEqual(err, null, '에러 없이 끝나야 한다');
                assert.strictEqual(report.checked, RECONCILE_LIMIT, '모든 행을 봐야 한다');
                assert.strictEqual(report.failed, RECONCILE_LIMIT, '전부 집계 실패로 기록돼야 한다');
                // The cursor must have advanced; otherwise the continuation repeats the same position forever.
                assert.strictEqual(report.nextCursor, 'ri001999');
                done();
            });
    });
});

test('reconcile: 한도를 열 배로 올려도 스택이 상수다', function (t, done) {
    // Without the trampoline a single commit that raises the limit is a permanent stall. The test does not rely on the current value happening to be safe.
    const N = 20000;
    const sql_action = deadConnAdapter(cntRows(N), s => /from `cnt`/i.test(s));

    quiet(function () {
        sql_action.reconcile_cnt_counters({}, { limit: N, cursor: '', budgetMs: 300000 },
            function (err, report) {
                assert.strictEqual(err, null);
                assert.strictEqual(report.checked, N);
                done();
            });
    });
});

test('purge: 죽은 커넥션이 동기로 실패해도 콜백이 온다 (app.js 의 limit 100)', function (t, done) {
    const sql_action = deadConnAdapter(cntOverLimitRows(PURGE_LIMIT),
        s => /from `cnt`/i.test(s) && /join/i.test(s));

    quiet(function () {
        sql_action.purge_sweep({}, { limit: PURGE_LIMIT }, function (err, report) {
            assert.strictEqual(err, null);
            assert.strictEqual(report.scanned, PURGE_LIMIT);
            assert.strictEqual(report.failed, PURGE_LIMIT);
            done();
        });
    });
});

test('purge: 한도가 100 이라는 우연에 기대지 않는다', function (t, done) {
    // A larger limit is exercised so the margin is not left to chance.
    const N = 5000;
    const sql_action = deadConnAdapter(cntOverLimitRows(N),
        s => /from `cnt`/i.test(s) && /join/i.test(s));

    quiet(function () {
        sql_action.purge_sweep({}, { limit: N }, function (err, report) {
            assert.strictEqual(err, null);
            assert.strictEqual(report.scanned, N);
            done();
        });
    });
});

test('정상(비동기) 경로는 그대로다', function (t, done) {
    // The trampoline must not add ticks or change results on the normal path.
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(ROOT, 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));

    let first = true;
    adapter.execute = function (conn, sql, bindings, cb) {
        if (first && /from `cnt`/i.test(sql)) {
            first = false;
            return setImmediate(function () { cb(null, cntRows(500)); });
        }
        // Returns an aggregate equal to the stored values (cni 5 / cbs 50): nothing to correct.
        return setImmediate(function () { cb(null, [{ n: 5, s: 50 }]); });
    };
    adapter.begin = function (h, cb) { cb(null); };
    adapter.commit = function (h, cb) { cb(null); };
    adapter.rollback = function (h, cb) { cb(null); };
    db.connect(function () {});
    const sql_action = require(path.join(ROOT, 'mobius', 'sql_action.js'));

    quiet(function () {
        sql_action.reconcile_cnt_counters({}, { limit: 500, cursor: '', budgetMs: 30000 },
            function (err, report) {
                assert.strictEqual(err, null);
                assert.strictEqual(report.checked, 500);
                assert.strictEqual(report.failed, 0, '정상 경로에서 실패가 나면 안 된다');
                assert.strictEqual(report.fixed, 0, '드리프트가 없으니 교정도 없어야 한다');
                done();
            });
    });
});

test('루프가 던지면 콜백을 잃는 대신 LOOP_THREW 로 돌려준다', function (t, done) {
    // A non-array result used to throw at rows[0].ri, before the callback, where no try at the call site could catch it: a permanent latch. The Array.isArray guard closes that branch, and any new branch where the loop throws is caught as LOOP_THREW. The contract turns 'no callback' into 'one failed cycle'.
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(ROOT, 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    adapter.execute = function (conn, sql, bindings, cb) {
        // Returns a non-array.
        return cb(null, { nope: true });
    };
    db.connect(function () {});
    const sql_action = require(path.join(ROOT, 'mobius', 'sql_action.js'));

    quiet(function () {
        sql_action.reconcile_cnt_counters({}, { limit: 2000, cursor: '', budgetMs: 30000 },
            function (err, report) {
                // The point is that the callback arrives without a throw.
                assert.strictEqual(err, null, 'Array.isArray 가드가 이 갈래를 닫는다');
                assert.strictEqual(report.checked, 0);
                assert.strictEqual(report.done, true, '볼 것이 없으면 한 바퀴가 끝난 것이다');
                done();
            });
    });
});

test('purge: onProgress 를 컨테이너마다 부른다 (실패 갈래 포함)', function (t, done) {
    // For the watch to measure 'time since last progress' rather than 'duration of one pass', this hook must actually be called. A wiring check alone cannot tell; if the hook is not called a normal backlog sweep is reported as stuck.
    const N = 5;
    const sql_action = deadConnAdapter(cntOverLimitRows(N),
        s => /from `cnt`/i.test(s) && /join/i.test(s));

    const seen = [];
    quiet(function () {
        sql_action.purge_sweep({}, { limit: N, onProgress: function (ri) { seen.push(ri); } },
            function (err, report) {
                assert.strictEqual(err, null);
                // With a dead connection everything takes the failure branch, but that is still progress: one container was attempted and the loop moved on.
                assert.strictEqual(report.failed, N);
                assert.strictEqual(seen.length, N,
                    'onProgress 가 ' + seen.length + '회 불렸다 — 컨테이너마다 한 번이어야 한다');
                done();
            });
    });
});

test('purge: onProgress 가 던져도 콜백은 온다', function (t, done) {
    // This hook is called where neither the trampoline's try nor app.js's try reaches: inside the delete_oldest callback, after step() has returned. A throw there means zero callbacks, reproducing the permanent latch this fix prevents.
    const N = 3;
    const sql_action = deadConnAdapter(cntOverLimitRows(N),
        s => /from `cnt`/i.test(s) && /join/i.test(s));

    quiet(function () {
        sql_action.purge_sweep({}, {
            limit: N,
            onProgress: function () { throw new Error('훅이 던졌다'); }
        }, function (err, report) {
            assert.strictEqual(err, null, '훅이 던져도 스윕은 끝나야 한다');
            assert.strictEqual(report.scanned, N);
            done();
        });
    });
});

test('step 이 실제로 던지면 LOOP_THREW 로 온다 (콜백을 잃지 않는다)', function (t, done) {
    // The non-array test above is closed by the Array.isArray guard first and never exercises the thrown branch. Here a row throws so that branch runs.
    //
    // The contract: when sql_action throws, the callback arrives with err=true instead of never arriving, so the caller can release the latch.
    const rows = cntRows(3);
    Object.defineProperty(rows[1], 'ri', {
        get: function () { throw new Error('행이 던졌다'); },
        enumerable: true
    });
    const sql_action = deadConnAdapter(rows, s => /from `cnt`/i.test(s));

    quiet(function () {
        sql_action.reconcile_cnt_counters({}, { limit: 2000, cursor: '', budgetMs: 30000 },
            function (err, report) {
                assert.strictEqual(err, true, '던진 것을 에러로 돌려줘야 한다');
                assert.strictEqual(report.code, 'LOOP_THREW');
                assert.match(report.message, /행이 던졌다/);
                done();
            });
    });
});

test('LOOP_THREW 계약이 코드에 있다', function () {
    // The test above exercises one known branch (non-array). If the contract itself disappears, the next branch loses the callback again.
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    const hits = (src.match(/code:\s*'LOOP_THREW'/g) || []).length;
    assert.strictEqual(hits, 2,
        "LOOP_THREW 로 돌려주는 자리가 " + hits + '곳이다 — reconcile 과 purge 둘이어야 한다');

    // Removing the trampoline brings back synchronous recursion.
    const pumps = (src.match(/if\s*\(pumping\)\s*\{\s*again\s*=\s*true;\s*return;\s*\}/g) || []).length;
    assert.strictEqual(pumps, 2,
        '트램펄린이 ' + pumps + '곳이다 — 두 배치 루프 모두에 있어야 한다');
});
