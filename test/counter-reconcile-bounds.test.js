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
// **주석은 걷어낸다.** 안 걷어내면 설명 문장이 검사를 통과시킨다 — 이 저장소가
// 여러 번 겪은 함정이고, 바로 아래 시험이 실제로 그렇게 되어 있었다:
// `/reconcile_running = false;\s*\/\/\s*한 바퀴 끝/` 은 **주석 글자**를 봤다.
// 정산을 settle_reconcile 한 곳으로 모으면서 그 주석이 사라지자, 동작은 더
// 정확해졌는데 시험이 깨졌다. 시험이 구조가 아니라 글자를 보고 있었다는 뜻이다.
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

    // 이어 돌기 중에는 플래그가 켜져 있어야 하고, 한 바퀴가 끝나면 내려가야
    // 한다. 그 판단은 **정산기 한 곳**에 있다 — `chained` 가 "이어 돌기를
    // 예약했다" 이고, 그때만 켠 채로 둔다.
    // 불리언과 장부는 **같은 가드 안에서 함께** 움직여야 한다. 갈라지면
    // 감시가 보는 상태와 실제 배타 상태가 어긋난다 — 그러면 굳었는데
    // 조용하거나, 멀쩡한데 경고가 난다.
    assert.match(APP,
        /if\s*\(!chained\)\s*\{\s*reconcile_running\s*=\s*false;\s*latch\.leave\('reconcile_counters'\);\s*\}/,
        'reconcile 의 래치 해제와 장부 반납이 chained 판단 한 곳에 모여 있지 않다');

    // 정산이 다시 흩어지면 "콜백 본문에서 던지면 래치가 영구히 켜진다" 가
    // 돌아온다. reconcile 의 해제는 정산기 안의 그 한 줄과, 커넥션을 못
    // 빌린 갈래 하나뿐이어야 한다.
    // `var reconcile_running = false;` 선언은 빼고 센다.
    const drops = (APP.match(/(?<!var )reconcile_running\s*=\s*false/g) || []).length;
    assert.strictEqual(drops, 2,
        'reconcile_running 해제가 ' + drops + '곳이다 — 정산이 다시 흩어졌는지 볼 것 ' +
        '(정산기 1곳 + 커넥션 취득 실패 1곳)');
});

test('app.js: 두 주기 작업의 정산이 대칭이다', function () {
    // purge 는 예전에 "정산 세 문장을 콜백 첫머리에 둔다" 는 **문장 순서**로만
    // 지켜져 있었다. 그 앞에 줄 하나만 붙으면 창이 다시 열린다.
    // reconcile 만 구조로 닫고 purge 는 관행으로 닫은 비대칭이었다.
    assert.match(APP, /function\s+settle_purge\s*\(\s*\)/, 'purge 에 정산기가 없다');
    assert.match(APP, /function\s+settle_reconcile\s*\(\s*\)/, 'reconcile 에 정산기가 없다');

    // 콜백 본문 어디서 던져도 정산이 돌아야 한다.
    const finallies = (APP.match(/finally\s*\{\s*settle_(purge|reconcile)\(\);\s*\}/g) || []).length;
    assert.strictEqual(finallies, 2,
        'finally 로 정산하는 자리가 ' + finallies + '곳이다 — 둘이어야 한다');

    // db_sql 호출 **자체**가 동기로 던지면 콜백은 오지 않는다. 그 갈래도
    // 정산해야 하고, 예외는 삼키지 않고 되던져야 한다 — backstop 이 찍어야
    // 원인을 고칠 수 있다.
    const rethrows = (APP.match(/settle_(purge|reconcile)\(\);\s*throw\s+e;/g) || []).length;
    assert.strictEqual(rethrows, 2,
        '동기 throw 갈래에서 정산하고 되던지는 자리가 ' + rethrows + '곳이다 — 둘이어야 한다');

    // 반납을 하는 콜백은 once 로 감싼다(저장소 규약). 마스터 주기 작업 두
    // 자리에서만 안 지켜져 있었다. **둘 다** 세야 한다 — 하나만 보면 다른
    // 하나에서 걷어내도 통과한다.
    const wrapped = (APP.match(/once\(function\s*\(err,\s*report\)/g) || []).length;
    assert.strictEqual(wrapped, 2,
        '주기 작업 콜백 중 ' + wrapped + '곳만 once 로 감싸여 있다 — 둘이어야 한다');

    // 커넥션 취득 콜백도 마찬가지다. mysql2 는 타임아웃 뒤에 콜백을 두 번
    // 부를 수 있고, reconcile 은 is_continuation 이 래치 검사를 우회하도록
    // 설계돼 있어 콜백이 두 번 불리면 래치가 잠기는 게 아니라 **무력화된다**.
    const acquired = (APP.match(/db\.getConnection\(once\(/g) || []).length;
    assert.strictEqual(acquired, 2,
        '주기 작업의 커넥션 취득 콜백 중 ' + acquired + '곳만 once 로 감싸여 있다');
});

test('app.js: 손대지 못한 컨테이너를 바퀴 끝에 한 번만 보고한다', function () {
    assert.match(APP, /report\.deferredRis/, 'deferredRis 를 안 읽는다');
    assert.match(APP, /report\.failedRis/, 'failedRis 를 안 읽는다');
    assert.match(APP, /관리자 UI 에서 개별 처리 필요/, '유예/실패를 알리지 않는다');
});
