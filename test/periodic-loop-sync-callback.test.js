'use strict';
// 마스터 주기 작업의 배치 루프가 **동기로 돌아온 콜백**에 무너지지 않는가.
//
// ── 무슨 일이 있었나 ──────────────────────────────────────────────────────
//
// mysql2 는 커넥션이 죽으면 addCommand 를 _addCommandClosedState 로 갈아끼운다
// (node_modules/mysql2/lib/base/connection.js:960-968 의 close, :219-229 의
// _handleFatalError). 그리고 그것은 cmd.onResult(err) 를 process.nextTick 없이
// **그 자리에서** 부른다(:207-217).
//
// 그러면 execute -> facade.run -> sql_action 의 콜백이 전부 한 스택 위에서
// 돌아오고, 루프가 다음 행으로 가면서 행마다 열 몇 프레임씩 쌓인다. 실측:
//
//     reconcile  행 1,000  콜백 도착
//     reconcile  행 1,500  RangeError — **콜백 없음**
//     reconcile  행 2,000  RangeError — **콜백 없음**   <- app.js 가 주는 값
//     purge      행   100  콜백 도착                     <- app.js 가 주는 값
//     purge      행   500  콜백 도착
//     purge      행 1,000  RangeError — **콜백 없음**
//
// 즉 reconcile 은 오늘 열려 있었고, purge 는 하드코딩된 limit 100 덕분에
// 우연히 살아 있었다(여유 5~10배).
//
// ── 왜 치명적인가 ────────────────────────────────────────────────────────
//
// 그 RangeError 는 드라이버 프레임에서 터져 나오므로 호출부의 어떤 try 로도
// 못 잡는다. app.js 의 콜백은 시작조차 못 하고, 그래서 래치(reconcile_running /
// purge_running)가 켜진 채 남는다. 마스터는 backstop 이 살려 두므로 프로세스는
// 멀쩡하고, 그 뒤의 모든 틱이 `if (running) return` 으로 **로그 한 줄 없이**
// 튕긴다. 마스터에서 도는 일이라 워커 재기동으로도 안 낫는다.
//
// ── 무엇을 지키는가 ──────────────────────────────────────────────────────
//
// 트램펄린이 동기로 돌아온 호출을 깃발로만 받아 스택을 상수로 유지한다.
// 그리고 루프가 그래도 던지면 콜백을 잃는 대신 LOOP_THREW 로 돌려준다 —
// 호출부가 래치를 놓을 기회를 얻는다.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');

process.env.MOBIUS_SQLITE_PATH = path.join(os.tmpdir(), 'mobius-sync-callback-test.db');
global.NOPRINT = 'true';

// 죽은 커넥션을 흉내낸다: 첫 SELECT 만 성공하고 그 뒤는 **동기로** 실패한다.
//
// 대역이 실물보다 관대하면 안 된다 — mysql2 가 실제로 하는 일이 정확히
// 이것이다(_addCommandClosedState 가 onResult 를 그 자리에서 부른다).
// setImmediate 로 감싸면 시험이 거짓말을 한다.
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
        return cb(err, null);          // <- **동기**. 이것이 재현의 핵심이다
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
        // ri 는 정렬되어야 커서가 전진한다. cni 는 maxCni(100만) 아래여야
        // 유예 갈래(setImmediate)로 새지 않고 집계 갈래로 간다 — 유예 갈래는
        // 원래부터 스택을 끊고 있었으므로 그쪽으로 새면 시험이 헛돈다.
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

// app.js 가 실제로 주는 값. 이 숫자가 바뀌면 시험도 같이 바뀌어야 한다.
const RECONCILE_LIMIT = 2000;
const PURGE_LIMIT = 100;

test('reconcile: 죽은 커넥션이 동기로 실패해도 콜백이 온다 (app.js 의 limit 2000)', function (t, done) {
    const sql_action = deadConnAdapter(cntRows(RECONCILE_LIMIT), s => /from `cnt`/i.test(s));

    quiet(function () {
        sql_action.reconcile_cnt_counters({}, { limit: RECONCILE_LIMIT, cursor: '', budgetMs: 30000 },
            function (err, report) {
                // 고치기 전에는 여기 **도달하지 못했다** — RangeError 가 났다.
                assert.strictEqual(err, null, '에러 없이 끝나야 한다');
                assert.strictEqual(report.checked, RECONCILE_LIMIT, '모든 행을 봐야 한다');
                assert.strictEqual(report.failed, RECONCILE_LIMIT, '전부 집계 실패로 기록돼야 한다');
                // 커서는 전진해 있어야 한다. 안 그러면 이어 돌기가 같은 자리를
                // 영원히 다시 돈다.
                assert.strictEqual(report.nextCursor, 'ri001999');
                done();
            });
    });
});

test('reconcile: 한도를 열 배로 올려도 스택이 상수다', function (t, done) {
    // 트램펄린이 없으면 limit 을 올리는 커밋 하나가 곧 영구 정지다.
    // "지금 값이 우연히 안전하다" 에 기대지 않는다는 것을 못박는다.
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
    // 고치기 전 실측: 행 500 은 통과, 행 1,000 에서 RangeError.
    // 여유가 5~10배뿐이었고 그 사실이 코드 어디에도 안 적혀 있었다.
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
    // 트램펄린이 정상 경로에 tick 을 늘리거나 결과를 바꾸면 안 된다.
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
        // 저장값(cni 5 / cbs 50)과 같은 집계를 돌려준다 -> 교정할 것이 없다
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
    // 배열이 아닌 결과를 주면 예전에는 rows[0].ri 에서 던졌고, 그 예외는
    // 콜백보다 **앞**이라 호출부의 어떤 try 로도 못 잡았다 — 곧 영구 래치다.
    //
    // 지금은 Array.isArray 가드가 그 갈래를 닫고, 그래도 루프가 던지는
    // 새 갈래가 생기면 LOOP_THREW 가 받아 낸다. "콜백이 안 온다" 를
    // "한 주기 실패" 로 바꾸는 것이 이 계약의 전부다.
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(ROOT, 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    adapter.execute = function (conn, sql, bindings, cb) {
        // 배열이 아닌 것을 준다.
        return cb(null, { nope: true });
    };
    db.connect(function () {});
    const sql_action = require(path.join(ROOT, 'mobius', 'sql_action.js'));

    quiet(function () {
        sql_action.reconcile_cnt_counters({}, { limit: 2000, cursor: '', budgetMs: 30000 },
            function (err, report) {
                // 던지지 않고 콜백이 온다는 것이 요점이다.
                assert.strictEqual(err, null, 'Array.isArray 가드가 이 갈래를 닫는다');
                assert.strictEqual(report.checked, 0);
                assert.strictEqual(report.done, true, '볼 것이 없으면 한 바퀴가 끝난 것이다');
                done();
            });
    });
});

test('purge: onProgress 를 컨테이너마다 부른다 (실패 갈래 포함)', function (t, done) {
    // 감시가 "한 바퀴가 얼마나 걸렸나" 가 아니라 "마지막 진전이 언제였나" 를
    // 재려면 이 훅이 실제로 불려야 한다. 배선 검사만으로는 모른다 —
    // 훅이 안 불리면 정상 백로그 스윕이 "멈춰 있다" 로 오탐된다.
    const N = 5;
    const sql_action = deadConnAdapter(cntOverLimitRows(N),
        s => /from `cnt`/i.test(s) && /join/i.test(s));

    const seen = [];
    quiet(function () {
        sql_action.purge_sweep({}, { limit: N, onProgress: function (ri) { seen.push(ri); } },
            function (err, report) {
                assert.strictEqual(err, null);
                // 죽은 커넥션이라 전부 실패 갈래로 간다. 그래도 진전은 진전이다 —
                // 컨테이너 하나를 처리하려고 시도했고 다음으로 넘어갔다.
                assert.strictEqual(report.failed, N);
                assert.strictEqual(seen.length, N,
                    'onProgress 가 ' + seen.length + '회 불렸다 — 컨테이너마다 한 번이어야 한다');
                done();
            });
    });
});

test('purge: onProgress 가 던져도 콜백은 온다', function (t, done) {
    // **이 훅은 트램펄린의 try 도, app.js 의 try 도 닿지 않는 자리에서
    // 불린다** — delete_oldest 콜백 안이라 step() 은 이미 반환한 뒤다.
    // 거기서 던지면 콜백이 0회가 되어, 이 수정이 막으려던 영구 래치가
    // 그대로 재현된다.
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
    // 위 비배열 시험은 Array.isArray 가드가 먼저 닫아 버려서 thrown 갈래를
    // 한 번도 안 태운다. 여기서는 **행이 던지게** 만들어 그 갈래를 태운다.
    //
    // 이것이 계약의 전부다: sql_action 이 던지면 예전에는 콜백이 0회였고
    // (호출부의 어떤 try 로도 못 잡는다 — 그래서 래치가 영구히 켜졌다),
    // 지금은 err=true 로 와서 호출부가 래치를 놓을 기회를 얻는다.
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
    // 위 시험은 알려진 한 갈래(비배열)만 태운다. 계약 자체가 사라지면
    // 다음에 생기는 갈래는 다시 콜백을 잃는다.
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    const hits = (src.match(/code:\s*'LOOP_THREW'/g) || []).length;
    assert.strictEqual(hits, 2,
        "LOOP_THREW 로 돌려주는 자리가 " + hits + '곳이다 — reconcile 과 purge 둘이어야 한다');

    // 트램펄린이 걷혀 나가면 동기 재귀가 돌아온다.
    const pumps = (src.match(/if\s*\(pumping\)\s*\{\s*again\s*=\s*true;\s*return;\s*\}/g) || []).length;
    assert.strictEqual(pumps, 2,
        '트램펄린이 ' + pumps + '곳이다 — 두 배치 루프 모두에 있어야 한다');
});
