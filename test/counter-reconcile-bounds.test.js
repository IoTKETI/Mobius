'use strict';
// Bounds of the reconciliation sweep.
//
// The budget (budgetMs) is checked only between containers, so one aggregate that takes longer than the budget swallowed the whole sweep, and a failure was only logged and skipped silently so the caller could not know.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-reconcile-bounds-test.db');

// steps: what SELECT returns in order. An array is rows, {error} is a failure.
function tapAdapter(steps, useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));

    const seen = [];
    let sel = 0;

    adapter.execute = function (conn, sql, bindings, cb, opts) {
        const rec = { sql: sql, bindings: bindings, opts: opts };
        seen.push(rec);
        if (/^select/i.test(sql)) {
            const step = steps[sel];
            sel++;
            if (step && step.error) { return cb(step.error, null); }
            return cb(null, step === undefined ? [] : step);
        }
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    adapter.begin = function (h, cb) { cb(null); };
    adapter.commit = function (h, cb) { cb(null); };
    adapter.rollback = function (h, cb) { cb(null); };

    db.connect(function () {});

    // The getResult of the former db_action / db_sqlite used to be intercepted here for leaks. With both files deleted there is nowhere to leak to; test/db-adapter-contract.test.js checks that they have not returned.

    delete require.cache[require.resolve(path.join(ROOT, 'mobius', 'sql_action.js'))];
    return { sql_action: require(path.join(ROOT, 'mobius', 'sql_action.js')), seen: seen };
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

const aggregates = (seen) => seen.filter((s) => /from `cin`/i.test(s.sql || ''));

// --- Large containers are deferred, not aggregated ---

test('maxCni 를 넘는 컨테이너는 집계하지 않고 deferredRis 에 담긴다', function (t, done) {
    const cntRows = [
        { ri: '/a', cni: 10, cbs: 100 },
        { ri: '/big', cni: 5930795, cbs: 1478104467 },
        { ri: '/c', cni: 3, cbs: 30 }
    ];
    // Only two aggregates may go out, /a and /c.
    const tap = tapAdapter([cntRows, [{ n: 10, s: 100 }], [{ n: 3, s: 30 }]]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10, maxCni: 1000000 },
        guard(done, function (err, report) {
            assert.strictEqual(err, null);
            assert.deepStrictEqual(report.deferredRis, ['/big']);
            assert.strictEqual(report.deferred, 1);
            assert.strictEqual(report.checked, 3, '유예한 것도 확인 건수에는 센다');
            assert.strictEqual(report.failed, 0);

            const aggs = aggregates(tap.seen);
            assert.strictEqual(aggs.length, 2, '대형 컨테이너에는 집계를 안 보낸다');
            assert.deepStrictEqual(aggs.map((a) => a.bindings[0]), ['/a', '/c']);
            done();
        }));
});

test('maxCni: 0 이면 크기와 무관하게 전부 집계한다', function (t, done) {
    const cntRows = [{ ri: '/big', cni: 99999999, cbs: 1 }];
    const tap = tapAdapter([cntRows, [{ n: 99999999, s: 1 }]]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10, maxCni: 0 },
        guard(done, function (err, report) {
            assert.strictEqual(report.deferred, 0);
            assert.strictEqual(aggregates(tap.seen).length, 1);
            done();
        }));
});

// --- An aggregate failure is reported ---

test('집계가 실패하면 failedRis 에 담기고 스윕은 계속 돈다', function (t, done) {
    const cntRows = [
        { ri: '/a', cni: 1, cbs: 10 },
        { ri: '/slow', cni: 5, cbs: 50 },
        { ri: '/c', cni: 2, cbs: 20 }
    ];
    const timeout = { code: 'PROTOCOL_SEQUENCE_TIMEOUT', message: 'timeout' };
    const tap = tapAdapter([
        cntRows,
        [{ n: 1, s: 10 }],
        { error: timeout },
        [{ n: 2, s: 20 }]
    ]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10 },
        guard(done, function (err, report) {
            assert.strictEqual(err, null, '한 건 실패로 스윕 전체가 실패하면 안 된다');
            assert.deepStrictEqual(report.failedRis, ['/slow']);
            assert.strictEqual(report.failed, 1);
            assert.strictEqual(report.checked, 3, '실패 뒤에도 다음 컨테이너를 본다');
            assert.strictEqual(report.nextCursor, '/c');
            done();
        }));
});

// --- Every aggregate gets a time limit ---
//
// The limit must be server-side. A driver timeout (run's opts.timeoutMs) kills the connection the moment it fires, and every remaining container fails in a chain with PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR.

const hintMs = (sql) => {
    const m = /MAX_EXECUTION_TIME\((\d+)\)/.exec(sql || '');
    return m ? Number(m[1]) : null;
};

test('집계에는 서버 측 상한이 걸린다 (기본 5초)', function (t, done) {
    const tap = tapAdapter([[{ ri: '/a', cni: 1, cbs: 10 }], [{ n: 1, s: 10 }]]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10 },
        guard(done, function () {
            const agg = aggregates(tap.seen)[0];
            assert.strictEqual(hintMs(agg.sql), 5000, '힌트가 없거나 값이 다르다: ' + agg.sql);
            done();
        }));
});

test('집계에 드라이버 타임아웃을 걸지 않는다 (커넥션이 죽는다)', function (t, done) {
    const tap = tapAdapter([[{ ri: '/a', cni: 1, cbs: 10 }], [{ n: 1, s: 10 }]]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10 },
        guard(done, function () {
            const agg = aggregates(tap.seen)[0];
            assert.ok(!agg.opts || agg.opts.timeoutMs === undefined,
                '드라이버 타임아웃이 걸렸다 — 한 번 걸리면 남은 스윕이 통째로 무너진다');
            done();
        }));
});

test('남은 예산이 aggTimeoutMs 보다 작으면 남은 예산으로 조인다', function (t, done) {
    const tap = tapAdapter([[{ ri: '/a', cni: 1, cbs: 10 }], [{ n: 1, s: 10 }]]);

    // budgetMs is smaller than aggTimeoutMs; the remaining budget must become the limit.
    tap.sql_action.reconcile_cnt_counters(null,
        { limit: 10, budgetMs: 1000, aggTimeoutMs: 5000 },
        guard(done, function () {
            const ms = hintMs(aggregates(tap.seen)[0].sql);
            assert.ok(ms !== null && ms <= 1000, '남은 예산보다 큰 상한이 걸렸다: ' + ms);
            assert.ok(ms > 0);
            done();
        }));
});

test('aggTimeoutMs: 0 이면 상한을 걸지 않는다', function (t, done) {
    const tap = tapAdapter([[{ ri: '/a', cni: 1, cbs: 10 }], [{ n: 1, s: 10 }]]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10, aggTimeoutMs: 0 },
        guard(done, function () {
            assert.strictEqual(hintMs(aggregates(tap.seen)[0].sql), null);
            done();
        }));
});

test('SQLite 에는 힌트를 붙이지 않는다 (지원 안 함)', function (t, done) {
    const tap = tapAdapter([[{ ri: '/a', cni: 1, cbs: 10 }], [{ n: 1, s: 10 }]], true);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10 },
        guard(done, function () {
            const agg = aggregates(tap.seen)[0];
            assert.strictEqual(hintMs(agg.sql), null,
                'SQLite 인데 MySQL 힌트가 붙었다: ' + agg.sql);
            done();
        }));
});

test('예산이 한 건 볼 만큼 안 남았으면 집계를 시작하지 않는다', function (t, done) {
    // Starting an aggregate with a few ms of budget left would record a healthy container as 'failed' by timeout and put a false candidate on the admin UI, so the start is deferred.
    const tap = tapAdapter([[{ ri: '/a', cni: 1, cbs: 10 }], [{ n: 1, s: 10 }]]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10, budgetMs: 200 },
        guard(done, function (err, report) {
            assert.strictEqual(aggregates(tap.seen).length, 0, '집계를 시작해 버렸다');
            assert.strictEqual(report.failed, 0, '시간이 없던 것을 실패로 세면 안 된다');
            assert.strictEqual(report.done, false, '예산 소진은 완료가 아니다');
            done();
        }));
});

// --- Report shape ---

test('보고에 failed/deferred 가 항상 들어간다', function (t, done) {
    const tap = tapAdapter([[{ ri: '/a', cni: 1, cbs: 10 }], [{ n: 1, s: 10 }]]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10 },
        guard(done, function (err, report) {
            ['checked', 'fixed', 'failed', 'failedRis', 'deferred', 'deferredRis',
             'nextCursor', 'done'].forEach(function (k) {
                assert.ok(Object.prototype.hasOwnProperty.call(report, k),
                    '보고에 ' + k + ' 가 없다');
            });
            assert.deepStrictEqual(report.failedRis, []);
            assert.deepStrictEqual(report.deferredRis, []);
            done();
        }));
});

// --- Continuation in app.js ---
// app.js starts the server and cannot be loaded alone; checked at source level.
//
// The cursor assumes 'the next call continues where this one stopped', and the next call must not be a day away. Comments are stripped: otherwise an explanatory sentence satisfies the check, a trap this repository has hit more than once; a previous version of this test matched comment text and broke when the comment moved while the behaviour got more exact.
const APP_RAW = require('node:fs').readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const APP = APP_RAW
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('app.js: 한 바퀴가 안 끝났으면 24시간을 기다리지 않고 이어서 돈다', function () {
    assert.match(APP, /RECONCILE_GAP_MS\s*=\s*60\s*\*\s*1000/,
        '조각 사이 간격 상수가 없다');
    assert.match(APP,
        /setTimeout\(\s*function\s*\(\)\s*\{\s*reconcile_counters\(true\);\s*\}\s*,\s*RECONCILE_GAP_MS\s*\)/,
        'done=false 일 때 이어 돌기를 예약하지 않는다');
});

test('app.js: 24시간 틱은 한 바퀴가 도는 중이면 끼어들지 않는다', function () {
    assert.match(APP, /if\s*\(reconcile_running\s*&&\s*!is_continuation\)\s*\{\s*return;\s*\}/,
        '겹침 방어가 없다 — 두 흐름이 같은 커서를 각자 전진시켜 컨테이너를 건너뛴다');

    // During continuation the flag must stay set, and it must drop when a round ends. That decision lives in the settler: `chained` means 'a continuation is scheduled', and only then does the flag stay up. The boolean and the ledger must move together inside the same guard; if they diverge, what the watchdog sees and the actual exclusive state disagree.
    assert.match(APP,
        /if\s*\(!chained\)\s*\{\s*reconcile_running\s*=\s*false;\s*latch\.leave\('reconcile_counters'\);\s*\}/,
        'reconcile 의 래치 해제와 장부 반납이 chained 판단 한 곳에 모여 있지 않다');

    // If settlement scatters again, 'a throw in the callback body leaves the latch set forever' returns. reconcile's release must be that one line in the settler plus the branch where no connection could be borrowed.
    // The `var reconcile_running = false;` declaration is excluded from the count.
    const drops = (APP.match(/(?<!var )reconcile_running\s*=\s*false/g) || []).length;
    assert.strictEqual(drops, 2,
        'reconcile_running 해제가 ' + drops + '곳이다 — 정산이 다시 흩어졌는지 볼 것 ' +
        '(정산기 1곳 + 커넥션 취득 실패 1곳)');
});

test('app.js: 두 주기 작업의 정산이 대칭이다', function () {
    // purge used to be protected only by statement order ('the three settlement statements at the top of the callback'); one line inserted before them reopens the window. reconcile was closed structurally and purge by convention; the asymmetry is removed.
    assert.match(APP, /function\s+settle_purge\s*\(\s*\)/, 'purge 에 정산기가 없다');
    assert.match(APP, /function\s+settle_reconcile\s*\(\s*\)/, 'reconcile 에 정산기가 없다');

    // Settlement must run wherever the callback body throws.
    const finallies = (APP.match(/finally\s*\{\s*settle_(purge|reconcile)\(\);\s*\}/g) || []).length;
    assert.strictEqual(finallies, 2,
        'finally 로 정산하는 자리가 ' + finallies + '곳이다 — 둘이어야 한다');

    // When the db_sql call itself throws synchronously the callback never comes; that branch must settle too, and the exception must be rethrown rather than swallowed so backstop logs it.
    const rethrows = (APP.match(/settle_(purge|reconcile)\(\);\s*throw\s+e;/g) || []).length;
    assert.strictEqual(rethrows, 2,
        '동기 throw 갈래에서 정산하고 되던지는 자리가 ' + rethrows + '곳이다 — 둘이어야 한다');

    // A callback that releases is wrapped in once (repository convention). Both primary periodic jobs must be counted; counting one would pass when the wrapper is removed from the other.
    const wrapped = (APP.match(/once\(function\s*\(err,\s*report\)/g) || []).length;
    assert.strictEqual(wrapped, 2,
        '주기 작업 콜백 중 ' + wrapped + '곳만 once 로 감싸여 있다 — 둘이어야 한다');

    // The connection acquisition callback likewise: mysql2 can call back twice after a timeout, and reconcile is designed to let is_continuation bypass the latch check, so a double callback would not lock the latch but disable it.
    const acquired = (APP.match(/db\.getConnection\(once\(/g) || []).length;
    assert.strictEqual(acquired, 2,
        '주기 작업의 커넥션 취득 콜백 중 ' + acquired + '곳만 once 로 감싸여 있다');
});

test('app.js: 손대지 못한 컨테이너를 바퀴 끝에 한 번만 보고한다', function () {
    assert.match(APP, /report\.deferredRis/, 'deferredRis 를 안 읽는다');
    assert.match(APP, /report\.failedRis/, 'failedRis 를 안 읽는다');
    assert.match(APP, /관리자 UI 에서 개별 처리 필요/, '유예/실패를 알리지 않는다');
});
