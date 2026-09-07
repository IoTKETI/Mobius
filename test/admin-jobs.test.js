'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const jobs = require(path.join(__dirname, '..', 'admin', 'jobs.js'));

/** 작업이 끝날 때까지 기다린다. state 는 running 에서만 벗어난다. */
function settled(job) {
    return new Promise(function (resolve) {
        (function poll() {
            if (job.state !== 'running') { return resolve(job); }
            setTimeout(poll, 5);
        }());
    });
}

test.beforeEach(function () { jobs._reset(); });

test('전 항목을 처리하고 결과를 분류한다', async function () {
    const job = jobs.start({
        kind: 'test', title: 't',
        targets: ['/a', '/b', '/c', '/d'],
        worker: function (ri, cb) {
            setImmediate(function () {
                if (ri === '/b') { return cb('skipped', '이미 없음'); }
                if (ri === '/c') { return cb('failed', 'HTTP 403'); }
                cb('ok');
            });
        }
    });
    await settled(job);

    assert.strictEqual(job.state, 'done');
    assert.strictEqual(job.total, 4);
    assert.strictEqual(job.processed, 4);
    assert.strictEqual(job.ok, 2);
    assert.strictEqual(job.skipped, 1);
    assert.strictEqual(job.failed, 1);
    assert.deepStrictEqual(job.failures, [{ ri: '/c', reason: 'HTTP 403' }]);
    // 갈래를 안 주면 unresolved 다 — 모르는 것을 "끝났다" 로 세지 않는다.
    assert.deepStrictEqual(job.skips, [{ ri: '/b', reason: '이미 없음', category: 'unresolved' }]);
    assert.strictEqual(job.unresolved, 1);
    assert.strictEqual(job.settled, 0);
    assert.strictEqual(job.excluded, 0);
});

test('건너뛴 것을 갈래로 나눠 센다 — skipped 는 셋의 합이다', async function () {
    // 전부 '건너뜀' 한 덩어리면 화면이 "정리가 덜 됐다" 로 읽힌다. 실제로 다시 봐야
    // 하는 것은 unresolved 뿐이다.
    const job = jobs.start({
        kind: 'test', title: 't',
        targets: ['/gone', '/keep', '/dunno', '/ok'],
        worker: function (ri, cb) {
            setImmediate(function () {
                if (ri === '/gone') { return cb('skipped', '이미 없음', 'settled'); }
                if (ri === '/keep') { return cb('skipped', '부모가 다시 생김', 'excluded'); }
                if (ri === '/dunno') { return cb('skipped', '부모 확인 실패', 'unresolved'); }
                cb('ok');
            });
        }
    });
    await settled(job);

    assert.strictEqual(job.ok, 1);
    assert.strictEqual(job.settled, 1);
    assert.strictEqual(job.excluded, 1);
    assert.strictEqual(job.unresolved, 1);
    assert.strictEqual(job.skipped, 3, 'skipped 는 셋의 합이어야 한다(옛 화면·시험이 쓴다)');
    assert.strictEqual(job.processed, 4);
    const v = job.view();
    assert.strictEqual(v.settled, 1);
    assert.strictEqual(v.excluded, 1);
    assert.strictEqual(v.unresolved, 1);
    assert.deepStrictEqual(job.skips.map((s) => s.category).sort(), ['excluded', 'settled', 'unresolved']);
});

test('모르는 갈래 이름은 unresolved 로 떨어진다', async function () {
    const job = jobs.start({
        kind: 'test', title: 't',
        targets: ['/x'],
        worker: function (ri, cb) { setImmediate(function () { cb('skipped', '?', 'whatever'); }); }
    });
    await settled(job);
    assert.strictEqual(job.unresolved, 1);
    assert.strictEqual(job.skips[0].category, 'unresolved');
    assert.strictEqual(job.whatever, undefined, '모르는 이름으로 카운터를 새로 만들면 안 된다');
});

test('doneEarly 가 true 면 남은 대상을 돌리지 않고 총량을 실제 처리한 만큼으로 줄인다', async function () {
    // 미연결 탐지가 이것을 쓴다. 조각 수는 상한을 조각 크기로 나눈 **최대치**라,
    // 표가 작으면 몇 조각 만에 끝난다. 남은 조각을 건너뜀으로 세면 실측처럼
    // "처리 2 · 건너뜀 398" 이 되어 정리가 덜 된 것처럼 보인다.
    const targets = [];
    for (let i = 0; i < 400; i++) { targets.push(i); }
    let worked = 0;
    let over = false;
    const job = jobs.start({
        kind: 'test', title: 't',
        targets: targets,
        concurrency: 1,
        doneEarly: function () { return over; },
        worker: function (t, cb) {
            setImmediate(function () {
                worked++;
                if (worked >= 2) { over = true; }
                cb('ok');
            });
        }
    });
    await settled(job);

    assert.strictEqual(worked, 2, '끝난 뒤에도 worker 를 불렀다');
    assert.strictEqual(job.state, 'done');
    assert.strictEqual(job.processed, 2);
    assert.strictEqual(job.total, 2, '총량이 400 으로 남으면 진행률이 0.5% 에서 멈춘 것처럼 보인다');
    assert.strictEqual(job.skipped, 0, '남은 조각을 건너뜀으로 세면 안 된다');
    assert.strictEqual(job.ok, 2);
});

test('doneEarly 는 도는 항목이 있으면 끝내지 않는다', async function () {
    // 진행 중인 항목의 결과가 아직 안 왔는데 끝내면 그 결과가 기록되지 않는다.
    // /a 가 끝나면서 doneEarly 를 세우지만 /b 는 아직 답이 없다.
    let release = null;
    let over = false;
    const job = jobs.start({
        kind: 'test', title: 't',
        targets: ['/a', '/b'],
        concurrency: 2,
        doneEarly: function () { return over; },
        worker: function (ri, cb) {
            if (ri === '/a') { return setImmediate(function () { over = true; cb('ok'); }); }
            release = function () { cb('ok'); };
        }
    });
    await new Promise(function (r) { setTimeout(r, 30); });
    assert.strictEqual(job.state, 'running', '도는 항목이 있는데 끝냈다');
    release();
    await settled(job);
    assert.strictEqual(job.processed, 2);
    assert.strictEqual(job.ok, 2);
});

test('한 건이 실패해도 나머지를 계속 처리한다', async function () {
    const job = jobs.start({
        kind: 'test', title: 't',
        targets: Array.from({ length: 50 }, (_, i) => '/r' + i),
        worker: function (ri, cb) { setImmediate(function () { cb('failed', 'boom'); }); }
    });
    await settled(job);
    assert.strictEqual(job.processed, 50);
    assert.strictEqual(job.failed, 50);
});

test('동시 실행 수를 넘기지 않는다', async function () {
    let live = 0, peak = 0;
    const job = jobs.start({
        kind: 'test', title: 't',
        concurrency: 3,
        targets: Array.from({ length: 30 }, (_, i) => '/r' + i),
        worker: function (ri, cb) {
            live++;
            if (live > peak) { peak = live; }
            setTimeout(function () { live--; cb('ok'); }, 3);
        }
    });
    await settled(job);
    assert.strictEqual(peak, 3, '동시 실행이 상한을 넘었다: ' + peak);
    assert.strictEqual(job.ok, 30);
});

test('한 번에 한 작업만 돈다', async function () {
    const first = jobs.start({
        kind: 'test', title: 'first',
        targets: ['/a'],
        worker: function (ri, cb) { setTimeout(function () { cb('ok'); }, 30); }
    });
    const second = jobs.start({ kind: 'test', title: 'second', targets: ['/b'], worker: function () {} });
    assert.ok(first);
    assert.strictEqual(second, null, '두 번째 작업이 시작되면 안 된다');

    await settled(first);
    // 끝난 뒤에는 다시 시작할 수 있다.
    const third = jobs.start({
        kind: 'test', title: 'third', targets: ['/c'],
        worker: function (ri, cb) { cb('ok'); }
    });
    assert.ok(third, '앞 작업이 끝나면 새 작업을 시작할 수 있어야 한다');
    await settled(third);
});

test('취소하면 남은 대상을 시작하지 않는다', async function () {
    const seen = [];
    const job = jobs.start({
        kind: 'test', title: 't',
        concurrency: 1,
        targets: Array.from({ length: 100 }, (_, i) => '/r' + i),
        worker: function (ri, cb) {
            seen.push(ri);
            setTimeout(function () { cb('ok'); }, 2);
        }
    });
    setTimeout(function () { jobs.cancel(job.id); }, 20);
    await settled(job);

    assert.strictEqual(job.state, 'cancelled');
    assert.ok(seen.length < 100, '취소 뒤에도 전부 돌았다: ' + seen.length);
    // 이미 시작한 건 끝까지 간다 — 중간에 끊으면 서버가 지웠는지 알 수 없다.
    assert.strictEqual(job.processed, seen.length);
});

test('worker 가 콜백을 두 번 불러도 카운터가 total 을 넘지 않는다', async function () {
    const job = jobs.start({
        kind: 'test', title: 't',
        targets: ['/a', '/b'],
        worker: function (ri, cb) {
            setImmediate(function () { cb('ok'); cb('failed', '두 번째 호출'); });
        }
    });
    await settled(job);
    assert.strictEqual(job.processed, 2);
    assert.strictEqual(job.ok, 2);
    assert.strictEqual(job.failed, 0);
});

test('실패 상세는 상한에서 끊고 잘렸다고 알린다', async function () {
    const n = jobs.MAX_FAILURES + 40;
    const job = jobs.start({
        kind: 'test', title: 't',
        concurrency: 16,
        targets: Array.from({ length: n }, (_, i) => '/r' + i),
        worker: function (ri, cb) { setImmediate(function () { cb('failed', 'x'); }); }
    });
    await settled(job);
    assert.strictEqual(job.failed, n, '개수는 전부 세어야 한다');
    assert.strictEqual(job.failures.length, jobs.MAX_FAILURES);
    assert.strictEqual(job.failuresTruncated, true);
});

test('동기로 끝나는 worker 도 스택을 넘기지 않는다', async function () {
    // setImmediate 없이 곧바로 콜백하는 worker(예: 프리플라이트에서 즉시 skip)를
    // 재귀로 펌프하면 대상 수만큼 스택이 쌓인다.
    const job = jobs.start({
        kind: 'test', title: 't',
        concurrency: 1,
        targets: Array.from({ length: 20000 }, (_, i) => '/r' + i),
        worker: function (ri, cb) { cb('skipped', 'sync'); }
    });
    await settled(job);
    assert.strictEqual(job.processed, 20000);
    assert.strictEqual(job.state, 'done');
});

test('빈 대상 목록도 정상 종료한다', async function () {
    const job = jobs.start({ kind: 'test', title: 't', targets: [], worker: function () {} });
    await settled(job);
    assert.strictEqual(job.state, 'done');
    assert.strictEqual(job.total, 0);
});

test('끝난 작업은 목록에 남고 id 로 다시 찾을 수 있다', async function () {
    const job = jobs.start({
        kind: 'test', title: 't', targets: ['/a'],
        worker: function (ri, cb) { cb('ok'); }
    });
    const id = job.id;
    await settled(job);
    assert.strictEqual(jobs.active(), null);
    assert.ok(jobs.get(id), '끝난 작업을 id 로 찾을 수 있어야 한다');
    assert.strictEqual(jobs.list()[0].id, id);
});

test('view 는 화면이 쓰는 필드를 전부 담는다', async function () {
    const job = jobs.start({
        kind: 'expired-delete', title: '삭제 1건', note: '주의',
        targets: ['/a'],
        worker: function (ri, cb) { cb('ok'); }
    });
    await settled(job);
    const v = job.view();
    ['id', 'kind', 'title', 'note', 'state', 'total', 'processed',
     'ok', 'skipped', 'failed', 'failures', 'skips', 'startedAt', 'finishedAt'
    ].forEach(function (k) {
        assert.ok(Object.prototype.hasOwnProperty.call(v, k), 'view 에 ' + k + ' 가 없다');
    });
});
