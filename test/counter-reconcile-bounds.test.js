'use strict';
// 정합 맞추기 스윕의 상한.
//
// 예산(budgetMs)은 컨테이너 *사이*에서만 검사한다. 그래서 집계 하나가
// 예산보다 오래 걸리면 그 컨테이너가 스윕 전체를 삼켰고, 게다가 실패하면
// 로그만 찍고 조용히 다음으로 넘어가서 호출자는 알 수 없었다.
//
// 배포 서버 실측 (2026-08-28): cni 5,930,795 짜리 컨테이너의 집계는
// 커버링 인덱스를 쓰고도 20초 상한에 걸려 강제 종료됐다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-reconcile-bounds-test.db');

// steps: SELECT 에 순서대로 돌려줄 것들. 배열이면 행, {error} 면 실패.
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

    // db_action / db_sqlite 는 이 경로에서 안 쓰지만, 모듈 로드시 풀이 없으면
    // 콜백을 안 부르고 멈추는 함수가 있어 미리 막아 둔다.
    // 구 경로(db_action / db_sqlite)의 getResult 를 가로채 "그쪽으로 샜는가"
    // 를 보던 자리다. 두 파일을 지웠으므로(2026-09-01) 샐 곳이 없다.
    // 되살아나지 않았는지는 test/db-adapter-contract.test.js 가 본다.

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

// --- 대형 컨테이너는 집계하지 않고 미룬다 ------------------------------------

test('maxCni 를 넘는 컨테이너는 집계하지 않고 deferredRis 에 담긴다', function (t, done) {
    const cntRows = [
        { ri: '/a', cni: 10, cbs: 100 },
        { ri: '/big', cni: 5930795, cbs: 1478104467 },
        { ri: '/c', cni: 3, cbs: 30 }
    ];
    // 집계는 /a 와 /c 두 번만 나가야 한다.
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

// --- 집계 실패는 보고에 남는다 -----------------------------------------------

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

// --- 집계마다 시간 상한을 건다 -----------------------------------------------
//
// 상한은 반드시 **서버 측**이어야 한다. 드라이버 타임아웃(run 의 opts.timeoutMs)
// 으로 걸면 걸리는 순간 커넥션이 죽어서, 남은 컨테이너가 전부
// PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR 로 연쇄 실패한다 (로컬 MySQL 실측:
// 첫 건이 PROTOCOL_SEQUENCE_TIMEOUT 으로 죽자 뒤의 4건이 그대로 무너졌다).

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

    // budgetMs 를 aggTimeoutMs 보다 작게 준다. 남은 예산이 상한이 돼야 한다.
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
    // 남은 예산이 몇 ms 뿐인데 집계를 걸면 멀쩡한 컨테이너가 타임아웃으로
    // '실패' 로 기록된다. 관리자 UI 에 가짜 후보를 올리게 되므로 시작을 미룬다.
    const tap = tapAdapter([[{ ri: '/a', cni: 1, cbs: 10 }], [{ n: 1, s: 10 }]]);

    tap.sql_action.reconcile_cnt_counters(null, { limit: 10, budgetMs: 200 },
        guard(done, function (err, report) {
            assert.strictEqual(aggregates(tap.seen).length, 0, '집계를 시작해 버렸다');
            assert.strictEqual(report.failed, 0, '시간이 없던 것을 실패로 세면 안 된다');
            assert.strictEqual(report.done, false, '예산 소진은 완료가 아니다');
            done();
        }));
});

// --- 보고 형태 ---------------------------------------------------------------

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

// --- app.js 의 이어 돌기 -----------------------------------------------------
// app.js 는 서버를 띄우므로 단독 로드가 안 된다. 소스 수준으로 확인한다.
//
// 커서는 "다음 호출이 멈춘 자리에서 계속한다" 를 전제로 만들었는데, 예전에는
// 그 다음 호출이 24시간 뒤뿐이었다. 배포 기준 컨테이너 30,220개를 조각당
// 2000개로 나누면 한 바퀴에 16일이 걸려 드리프트 교정이 사실상 멈춰 있었다.
const APP = require('node:fs').readFileSync(path.join(ROOT, 'app.js'), 'utf8');

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
    // 이어 돌기 중에는 플래그가 켜져 있어야 한다. done 일 때만 내린다.
    assert.match(APP, /reconcile_running\s*=\s*false;\s*\/\/\s*한 바퀴 끝/,
        '한 바퀴가 끝날 때 플래그를 내리지 않는다');
});

test('app.js: 손대지 못한 컨테이너를 바퀴 끝에 한 번만 보고한다', function () {
    assert.match(APP, /report\.deferredRis/, 'deferredRis 를 안 읽는다');
    assert.match(APP, /report\.failedRis/, 'failedRis 를 안 읽는다');
    assert.match(APP, /관리자 UI 에서 개별 처리 필요/, '유예/실패를 알리지 않는다');
});
