'use strict';
// 마스터 주기 작업 래치 장부.
//
// 시각을 전부 주입해서 잰다 — 실제 시계로 15분을 기다릴 수는 없고, 기다리는
// 시험은 그 자체가 느리고 불안정하다. latch.js 의 모든 진입점이 now 를 받는
// 것은 그래서다(mobius/lease.js 와 같은 이유).

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

const STALE = 15 * 60 * 1000;      // 15분

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

    // **핵심 방침.** 알리기만 하고 장부에서 지우지 않는다. 지우면 다음
    // 스캔에 "안 잡혀 있다" 가 되어 굳은 사실 자체가 사라진다.
    assert.strictEqual(latch.stats().held, 1, '경고가 래치를 풀면 안 된다');
    assert.strictEqual(latch.describe(STALE)[0].warned, true);
});

test('해제 API 를 두지 않는다', function () {
    // 자동 해제는 잠금 없는 임계구역에 두 번째 쓰기 주체를 들여보내는 일이다.
    // purge 두 흐름은 한도 밑으로 CIN 을 지우고(FK CASCADE 라 복구 불가)
    // reconcile 두 흐름은 커서를 서로 덮어써 구간을 무음으로 건너뛴다.
    // 되돌릴 수 있는 정지를 되돌릴 수 없는 손상과 바꾸는 거래다.
    ['reclaim', 'release', 'clear', 'force', 'unlock', 'breakLatch'].forEach(function (name) {
        assert.strictEqual(typeof latch[name], 'undefined',
            'latch.' + name + ' 이 생겼다 — 자동 해제는 하지 않기로 한 결정이다');
    });
});

test('같은 래치를 매 스캔 다시 알리지 않는다 — 재경고 간격이 있다', function () {
    fresh(STALE);
    latch.enter('purge_sweep', 0);

    quiet(function () { latch.sweep(STALE); });                    // 첫 경고
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

// ── 이 설계의 핵심: 한 바퀴 길이와 임계값이 무관해야 한다 ──────────────

test('정상 이어돌기는 한 바퀴가 몇 시간이어도 안 걸린다', function () {
    // reconcile 은 조각(최대 30초)마다 커서가 전진하고 조각 사이 60초를 쉰다.
    // 배포 기준 컨테이너 30,220 / 조각당 2,000 = 16조각이라 한 바퀴가 최소
    // 15분이고, 조각당 처리량이 떨어지면 몇 시간이 된다.
    //
    // **한 바퀴 길이로 재면 이 정상 동작이 그대로 오탐이 된다.** 그래서
    // 마지막 진전으로부터 잰다.
    fresh(STALE);
    latch.enter('reconcile_counters', 0);

    const SLICE = 30 * 1000;
    const GAP = 60 * 1000;
    let t = 0;
    const lines = quiet(function () {
        // 240조각 = 6시간짜리 한 바퀴
        for (let i = 0; i < 240; i++) {
            t += SLICE;
            latch.progress('reconcile_counters', t);   // 커서가 전진했다
            for (let m = 0; m < GAP; m += 60000) { latch.sweep(t + m); }
            t += GAP;
        }
    });

    assert.deepStrictEqual(lines, [],
        '6시간짜리 정상 한 바퀴에 경고가 났다 — 임계값이 한 바퀴 길이에 묶여 있다');
    assert.strictEqual(latch.stats().warned, 0);
});

test('커서 무진전 자기영속 사슬은 걸린다', function () {
    // 조각은 계속 정상 종료하는데 nextCursor 가 그대로인 상태가 있다.
    // 배치 SELECT 에는 문장 상한이 없어서, 그것이 예산(30초)을 다 먹으면
    // 첫 컨테이너를 보기도 전에 idx=0 · lastRi===cursor 로 끝난다.
    // 그러면 이어돌기가 같은 커서로 **영원히** 다시 돈다.
    //
    // 조각 완료를 진전으로 세면 이 상태가 영원히 건강해 보인다. 그래서
    // app.js 는 `report.nextCursor !== reconcile_cursor` 일 때만
    // latch.progress 를 부른다 — 여기서는 progress 가 안 오는 것으로
    // 그 상태를 흉내낸다.
    fresh(STALE);
    latch.enter('reconcile_counters', 0);

    let warned = [];
    quiet(function () {
        let t = 0;
        for (let i = 0; i < 30; i++) {          // 30분 동안 조각은 계속 도는데
            t += 60 * 1000;                      // 커서는 안 움직인다
            warned = warned.concat(latch.sweep(t));
        }
    });

    assert.ok(warned.length >= 1,
        '커서가 안 움직이는데 경고가 없다 — 이어돌기가 시계를 되감고 있는지 볼 것');
    assert.strictEqual(warned[0], 'reconcile_counters');
});

test('이어돌기가 enter 를 다시 부르면 감시가 무력해진다', function () {
    // 위 시험의 반대편. enter 는 시계를 되감으므로 이어돌기마다 부르면
    // 무진전 사슬이 영원히 안 걸린다. 그래서 app.js 는 새 바퀴에서만
    // enter 를 부른다. 그 규칙이 깨지면 어떻게 되는지를 못박아 둔다.
    fresh(STALE);
    latch.enter('reconcile_counters', 0);

    const lines = quiet(function () {
        let t = 0;
        for (let i = 0; i < 30; i++) {
            t += 60 * 1000;
            latch.enter('reconcile_counters', t);   // <- 이어돌기마다 다시 올린다
            latch.sweep(t);
        }
    });

    // enter 는 겹침을 알리지만(그것도 신호다) 시계는 **되감지 않는다**.
    // 되감으면 굳은 것을 영영 놓친다.
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

// ── app.js 배선 ──────────────────────────────────────────────────────────
//
// 모듈이 아무리 옳아도 배선이 빠지면 배포에서는 아무 일도 안 일어난다.
// 그 상태의 증상은 "여전히 무음" 이라 고치기 전과 구분되지 않는다.

test('app.js 가 감시를 걸고, 두 작업을 장부에 올린다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    // 주석은 걷어낸다 — 안 그러면 설명 문장이 검사를 통과시킨다.
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    assert.match(src, /setInterval\(function\s*\(\)\s*\{\s*latch\.sweep\(\);\s*\}\s*,\s*60\s*\*\s*1000\)/,
        '감시 타이머 배선이 없다 — 모듈이 통째로 죽은 코드가 된다');

    // **단순 부분문자열 검색으로는 부족하다.** 한 작업에서 호출을 지워도
    // 다른 작업의 같은 호출이 검사를 만족시킨다 — 실제로 settle_purge 의
    // latch.leave 를 지웠을 때 1,068건이 전부 통과했다. 개수로 센다.
    ['enter', 'progress'].forEach(function (op) {
        ['purge_sweep', 'reconcile_counters'].forEach(function (name) {
            const n = (src.match(new RegExp("latch\\." + op + "\\('" + name + "'\\)", 'g')) || []).length;
            assert.strictEqual(n, 1, name + ' 의 latch.' + op + ' 호출이 ' + n + '곳이다 — 하나여야 한다');
        });
    });

    // **leave 는 갈래마다 있어야 한다.** 장부에 올린 뒤 내려오는 길이 둘이다:
    //   (1) 정산기 — 일을 하고 끝났다
    //   (2) 커넥션 취득 실패 — 시작도 못 했다
    // (2)에서 빠지면 DB 가 한 번 흔들릴 때마다 장부에 유령이 남고, 15분 뒤
    // "멈춰 있다" 는 거짓 경고가 난다. 그리고 그 유령 때문에 다음 enter 가
    // "겹친다" 를 또 찍는다.
    ['purge_sweep', 'reconcile_counters'].forEach(function (name) {
        const n = (src.match(new RegExp("latch\\.leave\\('" + name + "'\\)", 'g')) || []).length;
        assert.strictEqual(n, 2,
            name + ' 의 latch.leave 가 ' + n + '곳이다 — 정산기 1 + 취득 실패 1 이어야 한다');
    });

    // 정산기 안에서 불리언과 장부가 **함께** 움직여야 한다. 갈라지면
    // 감시가 보는 상태와 실제 배타 상태가 어긋난다.
    assert.match(src, /purge_running = false;\s*latch\.leave\('purge_sweep'\);\s*release_quietly\(connection, 'purge_sweep'\);/,
        'purge 의 정산이 구조로 고정돼 있지 않다 — reconcile 만 대칭이면 대칭이 아니다');

    // **진전의 정의.** 조각 완료가 아니라 커서 전진이어야 한다. 이 가드를
    // 지우면 이 래치가 잡으려고 만들어진 결함(커서 무진전 자기영속 사슬)이
    // 다시 안 보이게 되는데, 지우고도 전부 초록이었다.
    assert.match(src,
        /if \(report\.nextCursor !== reconcile_cursor\) \{\s*latch\.progress\('reconcile_counters'\);/,
        '조각 완료를 진전으로 세면 무진전 사슬이 영원히 건강해 보인다');

    // 이어돌기는 장부를 새로 올리지 않는다. 한 바퀴 전체가 하나의 임대다.
    assert.match(src, /if \(!is_continuation\) \{\s*latch\.enter\('reconcile_counters'\);/,
        '이어돌기마다 장부를 새로 올리면 "이 바퀴가 언제 시작했나" 를 잃는다');

    // purge 의 진전 훅은 **양쪽 끝**을 다 봐야 한다. 키 이름 오타 하나로
    // 훅이 조용히 끊기면, 정상 백로그 스윕이 "멈춰 있다" 로 오탐된다.
    assert.match(src, /onProgress:\s*function\s*\(\)\s*\{\s*latch\.progress\('purge_sweep'\);\s*\}/,
        'purge 의 onProgress 배선이 끊겼다 — 정상 스윕이 오탐된다');

    // 감시는 주기 작업 배선 사슬 **밖**, 마스터 블록 최상단에 있어야 한다.
    // 그 사슬은 db.connect -> getConnection -> db_bootstrap.run -> cb.create
    // 네 겹이고, 하나라도 콜백을 안 주면 주기 작업이 아예 등록되지 않는다.
    // 감시까지 같이 잃으면 그 사고가 영영 안 보인다.
    const watch_at = src.indexOf('latch.sweep()');
    const install_at = src.indexOf("backstop.install('master')");
    const connect_at = src.indexOf('db.connect(');
    assert.ok(watch_at > install_at && watch_at < connect_at,
        '감시 배선이 db.connect 사슬 안에 있다 — 그 사슬이 끊기면 감시도 같이 사라진다');

    // 주기 작업 등록도 즉시 호출보다 앞이어야 한다. 즉시 호출이 던지면
    // 그 뒤의 setInterval 이 하나도 등록되지 않는다.
    const first_tick = src.indexOf('reconcile_counters();');
    const reg_purge = src.indexOf('setInterval(purge_sweep_tick');
    const reg_recon = src.indexOf('setInterval(reconcile_counters,');
    assert.ok(reg_purge > 0 && reg_purge < first_tick,
        'purge 틱 등록이 즉시 호출보다 뒤다 — 즉시 호출이 던지면 영영 안 돈다');
    assert.ok(reg_recon > 0 && reg_recon < first_tick,
        'reconcile 틱 등록이 즉시 호출보다 뒤다');

    // latch.enter 는 db.getConnection **앞**이어야 한다. 취득이 영영 안
    // 돌아오는 경로(mysql2 에 acquireTimeout 이 없다)를 장부가 보려면
    // 그래야 한다 — lease 는 취득 성공 뒤에만 올려서 원리적으로 못 본다.
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

    // 조각 하나가 실패하면 예전에는 래치를 **정상 반납**하고 끝났다.
    // 커서는 중간에 멈춰 있는데 감시는 조용하고, 다음 재개는 24시간 뒤다 —
    // RECONCILE_GAP_MS 가 없애려던 "한 바퀴에 16일" 이 그대로 돌아온다.
    assert.match(src, /function rearm_or_give_up\s*\(/, '중단된 바퀴를 다시 잡는 경로가 없다');
    assert.match(src, /if \(reconcile_cursor === ''\) \{ return false; \}/,
        '바퀴 밖에서도 재시도하면 24시간 틱을 방해한다');

    // 두 실패 갈래 모두에서 불려야 한다 — 취득 실패와 질의 실패.
    const calls = (src.match(/rearm_or_give_up\(/g) || []).length;
    assert.strictEqual(calls, 3,
        'rearm_or_give_up 호출이 ' + calls + '곳이다 — 정의 1 + 취득 실패 1 + 질의 실패 1');

    // 영구 재시도는 영구 점유다. 상한이 있어야 한다.
    assert.match(src, /RECONCILE_MAX_RETRY\s*=\s*\d+/, '재시도 상한이 없다');
    assert.match(src, /reconcile_retry > RECONCILE_MAX_RETRY/, '상한을 검사하지 않는다');

    // 전진하면 예산도 되돌린다. 안 그러면 긴 바퀴에 흩어진 실패 다섯 번으로
    // 예산이 마른다 — 상한은 "연속으로 못 이어간다" 를 재야 한다.
    assert.match(src, /latch\.progress\('reconcile_counters'\);\s*reconcile_retry = 0;/,
        '전진했을 때 재시도 예산을 안 되돌린다');
});
