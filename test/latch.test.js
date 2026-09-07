'use strict';
// Latch ledger for the master's periodic jobs.
//
// All timestamps are injected; every entry point of latch.js takes now (same reason as mobius/lease.js).

const test = require('node:test');
const assert = require('node:assert');

const latch = require('../mobius/latch');

function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); }
    finally { console.error = orig; }
    return lines;
}

function fresh(staleMs) {
    latch._reset();
    global.latchStaleMs = staleMs;
}

const STALE = 15 * 60 * 1000;      // 15 minutes

test('잡히지 않은 래치는 알리지 않는다', function () {
    fresh(STALE);
    assert.deepStrictEqual(latch.sweep(1000000), []);
});

test('임계 안에서는 조용하다', function () {
    fresh(STALE);
    latch.enter('purge_sweep', 0);
    assert.deepStrictEqual(latch.sweep(STALE - 1), []);
});

test('임계를 넘으면 알린다 — 그리고 풀지 않는다', function () {
    fresh(STALE);
    latch.enter('purge_sweep', 0);

    let warned;
    const lines = quiet(function () { warned = latch.sweep(STALE); });

    assert.deepStrictEqual(warned, ['purge_sweep']);
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /\[latch\]/);
    assert.match(lines[0], /purge_sweep/);
    assert.match(lines[0], /master pid=/, 'pm2 가 마스터·워커 로그를 합치므로 pid 가 있어야 한다');
    assert.match(lines[0], /\d{4}-\d\d-\d\dT/, '이 저장소 로그에는 시각이 없다 — 이 줄에는 박혀야 한다');

    // Core policy: warn only, never remove from the ledger. Removing would make the next scan report 'not held' and lose the fact that it is stuck.
    assert.strictEqual(latch.stats().held, 1, '경고가 래치를 풀면 안 된다');
    assert.strictEqual(latch.describe(STALE)[0].warned, true);
});

test('해제 API 를 두지 않는다', function () {
    // Automatic release would admit a second writer into an unlocked critical section: two purge flows delete CINs below the limit (unrecoverable through FK CASCADE), two reconcile flows overwrite each other's cursor and silently skip ranges. No release API exists.
    ['reclaim', 'release', 'clear', 'force', 'unlock', 'breakLatch'].forEach(function (name) {
        assert.strictEqual(typeof latch[name], 'undefined',
            'latch.' + name + ' 이 생겼다 — 자동 해제는 하지 않기로 한 결정이다');
    });
});

test('같은 래치를 매 스캔 다시 알리지 않는다 — 재경고 간격이 있다', function () {
    fresh(STALE);
    latch.enter('purge_sweep', 0);

    quiet(function () { latch.sweep(STALE); });                    // first warning
    assert.deepStrictEqual(latch.sweep(STALE + 1000), [], '1초 뒤에 또 알리면 로그가 밀린다');
    assert.deepStrictEqual(latch.sweep(STALE + latch.REWARN_MS - 1), []);

    let again;
    quiet(function () { again = latch.sweep(STALE + latch.REWARN_MS); });
    assert.deepStrictEqual(again, ['purge_sweep'],
        '재경고가 없으면 로그 로테이션 뒤에 근거가 사라진다 (lease 가 그렇다)');
});

test('진전이 오면 시계가 다시 간다', function () {
    fresh(STALE);
    latch.enter('reconcile_counters', 0);
    latch.progress('reconcile_counters', STALE - 1000);
    assert.deepStrictEqual(latch.sweep(STALE), [], '진전이 있었으면 임계를 다시 잰다');
    quiet(function () {
        assert.deepStrictEqual(latch.sweep(2 * STALE), ['reconcile_counters']);
    });
});

test('경고 뒤에 진전이 오면 경고 상태가 풀린다', function () {
    fresh(STALE);
    latch.enter('purge_sweep', 0);
    quiet(function () { latch.sweep(STALE); });
    assert.strictEqual(latch.describe(STALE)[0].warned, true);

    latch.progress('purge_sweep', STALE + 100);
    assert.strictEqual(latch.describe(STALE + 100)[0].warned, false, '다시 돌기 시작했다');
});

test('latchStaleMs = 0 이면 감시를 끈다', function () {
    fresh(0);
    latch.enter('purge_sweep', 0);
    assert.deepStrictEqual(latch.sweep(999 * STALE), []);
});

// Core of the design: the length of one pass must be irrelevant to the threshold.

test('정상 이어돌기는 한 바퀴가 몇 시간이어도 안 걸린다', function () {
    // reconcile advances its cursor per slice (up to 30 seconds) and rests 60 seconds between slices, so one pass takes at least 15 minutes and can take hours. Staleness is therefore measured from the last progress, not from the start of the pass.
    fresh(STALE);
    latch.enter('reconcile_counters', 0);

    const SLICE = 30 * 1000;
    const GAP = 60 * 1000;
    let t = 0;
    const lines = quiet(function () {
        // 240 slices = a 6-hour pass
        for (let i = 0; i < 240; i++) {
            t += SLICE;
            latch.progress('reconcile_counters', t);   // the cursor advanced
            for (let m = 0; m < GAP; m += 60000) { latch.sweep(t + m); }
            t += GAP;
        }
    });

    assert.deepStrictEqual(lines, [],
        '6시간짜리 정상 한 바퀴에 경고가 났다 — 임계값이 한 바퀴 길이에 묶여 있다');
    assert.strictEqual(latch.stats().warned, 0);
});

test('커서 무진전 자기영속 사슬은 걸린다', function () {
    // Slices can keep finishing normally while nextCursor stays the same: the batch SELECT has no statement limit, and if it consumes the whole budget (30 seconds) the slice ends with idx=0 and lastRi===cursor before seeing the first container. The continuation then repeats with the same cursor forever.
    //
    // Counting slice completion as progress would make that state look healthy, so app.js calls latch.progress only when `report.nextCursor !== reconcile_cursor`; here the absence of progress calls mimics that state.
    fresh(STALE);
    latch.enter('reconcile_counters', 0);

    let warned = [];
    quiet(function () {
        let t = 0;
        for (let i = 0; i < 30; i++) {          // slices keep running for 30 minutes
            t += 60 * 1000;                      // but the cursor does not move
            warned = warned.concat(latch.sweep(t));
        }
    });

    assert.ok(warned.length >= 1,
        '커서가 안 움직이는데 경고가 없다 — 이어돌기가 시계를 되감고 있는지 볼 것');
    assert.strictEqual(warned[0], 'reconcile_counters');
});

test('이어돌기가 enter 를 다시 부르면 감시가 무력해진다', function () {
    // The other side of the test above: enter rewinds the clock, so calling it on every continuation would hide a no-progress chain forever. app.js calls enter only at the start of a new pass.
    fresh(STALE);
    latch.enter('reconcile_counters', 0);

    const lines = quiet(function () {
        let t = 0;
        for (let i = 0; i < 30; i++) {
            t += 60 * 1000;
            latch.enter('reconcile_counters', t);   // re-entered on every continuation
            latch.sweep(t);
        }
    });

    // enter reports the overlap (that is a signal too) but does not rewind the clock; rewinding would lose a stuck job for good.
    assert.ok(lines.some(function (l) { return /이미 잡혀 있는데 또 시작했다/.test(l); }),
        '겹친 enter 를 알리지 않는다');
    assert.ok(lines.some(function (l) { return /진전이 없다/.test(l); }),
        'enter 가 시계를 되감았다 — 그러면 무진전 사슬을 영영 못 본다');
});

test('두 래치를 따로 센다', function () {
    fresh(STALE);
    latch.enter('purge_sweep', 0);
    latch.enter('reconcile_counters', 0);
    latch.progress('reconcile_counters', STALE);

    let warned;
    quiet(function () { warned = latch.sweep(STALE); });
    assert.deepStrictEqual(warned, ['purge_sweep'],
        '진전이 있던 쪽까지 같이 알리면 어느 것이 멈췄는지 못 짚는다');
});

test('leave 하면 장부에서 빠진다', function () {
    fresh(STALE);
    latch.enter('purge_sweep', 0);
    assert.strictEqual(latch.leave('purge_sweep'), true);
    assert.strictEqual(latch.stats().held, 0);
    assert.deepStrictEqual(latch.sweep(999 * STALE), []);
    assert.strictEqual(latch.leave('purge_sweep'), false, '두 번 놓는 것은 결함이다');
});

// app.js wiring. A correct module with missing wiring does nothing in deployment, and the symptom ('still silent') is indistinguishable from before.

test('app.js 가 감시를 걸고, 두 작업을 장부에 올린다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    // Comments are stripped so explanatory text cannot satisfy the check.
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    assert.match(src, /setInterval\(function\s*\(\)\s*\{\s*latch\.sweep\(\);\s*\}\s*,\s*60\s*\*\s*1000\)/,
        '감시 타이머 배선이 없다 — 모듈이 통째로 죽은 코드가 된다');

    // A substring search is not enough: a call removed from one job is masked by the same call in the other job. The calls are counted.
    ['enter', 'progress'].forEach(function (op) {
        ['purge_sweep', 'reconcile_counters'].forEach(function (name) {
            const n = (src.match(new RegExp("latch\\." + op + "\\('" + name + "'\\)", 'g')) || []).length;
            assert.strictEqual(n, 1, name + ' 의 latch.' + op + ' 호출이 ' + n + '곳이다 — 하나여야 한다');
        });
    });

    // leave must exist on every branch. After entering the ledger there are two ways out:
    //   (1) the settler: the work finished
    //   (2) connection acquisition failed: the work never started
    // Missing (2) leaves a ghost entry whenever the DB hiccups, a false 'stuck' warning 15 minutes later, and an 'overlap' report on the next enter.
    ['purge_sweep', 'reconcile_counters'].forEach(function (name) {
        const n = (src.match(new RegExp("latch\\.leave\\('" + name + "'\\)", 'g')) || []).length;
        assert.strictEqual(n, 2,
            name + ' 의 latch.leave 가 ' + n + '곳이다 — 정산기 1 + 취득 실패 1 이어야 한다');
    });

    // Inside the settler the boolean and the ledger move together; otherwise the watched state and the real exclusion state diverge.
    assert.match(src, /purge_running = false;\s*latch\.leave\('purge_sweep'\);\s*release_quietly\(connection, 'purge_sweep'\);/,
        'purge 의 정산이 구조로 고정돼 있지 않다 — reconcile 만 대칭이면 대칭이 아니다');

    // Definition of progress: cursor advance, not slice completion. Removing this guard hides the self-perpetuating no-progress chain the latch exists to catch.
    assert.match(src,
        /if \(report\.nextCursor !== reconcile_cursor\) \{\s*latch\.progress\('reconcile_counters'\);/,
        '조각 완료를 진전으로 세면 무진전 사슬이 영원히 건강해 보인다');

    // A continuation does not re-enter the ledger; one whole pass is one lease.
    assert.match(src, /if \(!is_continuation\) \{\s*latch\.enter\('reconcile_counters'\);/,
        '이어돌기마다 장부를 새로 올리면 "이 바퀴가 언제 시작했나" 를 잃는다');

    // The purge progress hook must be checked at both ends; a typo in the key name would silently disconnect it and a normal backlog sweep would be reported as stuck.
    assert.match(src, /onProgress:\s*function\s*\(\)\s*\{\s*latch\.progress\('purge_sweep'\);\s*\}/,
        'purge 의 onProgress 배선이 끊겼다 — 정상 스윕이 오탐된다');

    // The watch must sit outside the periodic-job wiring chain, at the top of the master block. That chain is four callbacks deep (db.connect -> getConnection -> db_bootstrap.run -> cb.create); if any of them never calls back, the periodic jobs are never registered, and the watch must survive that.
    const watch_at = src.indexOf('latch.sweep()');
    const install_at = src.indexOf("backstop.install('master')");
    const connect_at = src.indexOf('db.connect(');
    assert.ok(watch_at > install_at && watch_at < connect_at,
        '감시 배선이 db.connect 사슬 안에 있다 — 그 사슬이 끊기면 감시도 같이 사라진다');

    // Periodic-job registration must precede the immediate call; if the immediate call throws, no setInterval after it is registered.
    const first_tick = src.indexOf('reconcile_counters();');
    const reg_purge = src.indexOf('setInterval(purge_sweep_tick');
    const reg_recon = src.indexOf('setInterval(reconcile_counters,');
    assert.ok(reg_purge > 0 && reg_purge < first_tick,
        'purge 틱 등록이 즉시 호출보다 뒤다 — 즉시 호출이 던지면 영영 안 돈다');
    assert.ok(reg_recon > 0 && reg_recon < first_tick,
        'reconcile 틱 등록이 즉시 호출보다 뒤다');

    // latch.enter must precede db.getConnection so the ledger sees an acquisition that never returns (mysql2 has no acquireTimeout). lease is recorded only after a successful acquisition and cannot see that case.
    const purge_body = src.slice(src.indexOf('function purge_sweep_tick'),
                                 src.indexOf('function rearm_or_give_up'));
    assert.ok(purge_body.indexOf("latch.enter('purge_sweep')") <
              purge_body.indexOf('db.getConnection('),
        'latch.enter 가 취득 뒤에 있다 — 취득이 매달리는 경로를 장부가 못 본다');
});

test('app.js: 바퀴 중간에 실패하면 24시간을 기다리지 않는다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    // A failed slice must not return the latch normally and stop: the cursor would sit mid-pass with the watch silent until the next 24-hour restart.
    assert.match(src, /function rearm_or_give_up\s*\(/, '중단된 바퀴를 다시 잡는 경로가 없다');
    assert.match(src, /if \(reconcile_cursor === ''\) \{ return false; \}/,
        '바퀴 밖에서도 재시도하면 24시간 틱을 방해한다');

    // Called on both failure branches: acquisition failure and query failure.
    const calls = (src.match(/rearm_or_give_up\(/g) || []).length;
    assert.strictEqual(calls, 3,
        'rearm_or_give_up 호출이 ' + calls + '곳이다 — 정의 1 + 취득 실패 1 + 질의 실패 1');

    // Permanent retry is permanent occupation; there must be an upper bound.
    assert.match(src, /RECONCILE_MAX_RETRY\s*=\s*\d+/, '재시도 상한이 없다');
    assert.match(src, /reconcile_retry > RECONCILE_MAX_RETRY/, '상한을 검사하지 않는다');

    // Progress resets the budget. Otherwise five failures scattered over a long pass exhaust it; the bound measures consecutive failures.
    assert.match(src, /latch\.progress\('reconcile_counters'\);\s*reconcile_retry = 0;/,
        '전진했을 때 재시도 예산을 안 되돌린다');
});
