'use strict';
/**
 * Escaping from a worker that never answers.
 *
 * A worker that never calls back keeps running above 0 and the job never ends; jobs.active() keeps returning it and guard_busy blocks Mobius stop/restart permanently.
 *
 * Cancel is the escape, but a cancel that waits for the same counter (running === 0) is stuck with it. The engine gets a floor for this class of failure.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const jobs = require(path.join(__dirname, '..', 'admin', 'jobs.js'));

function settled(job) {
    return new Promise(function (resolve) {
        (function poll() {
            if (job.state !== 'running') { return resolve(job); }
            setTimeout(poll, 5);
        }());
    });
}

function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

test.beforeEach(function () { jobs._reset(); });

test('답을 안 주는 worker 를 취소하면 유예 뒤에 끝난다', async function () {
    const job = jobs.start({
        kind: 'test', title: '멈춘 작업',
        targets: ['/a', '/b'],
        concurrency: 2,
        cancelGraceMs: 60,
        worker: function () { /* never calls back */ }
    });
    await wait(20);
    assert.strictEqual(job.state, 'running', '아직 도는 중이어야 한다');

    assert.ok(jobs.cancel(job.id), '취소가 받아들여져야 한다');
    await settled(job);

    assert.strictEqual(job.state, 'cancelled');
    assert.strictEqual(jobs.active(), null, '갇혀 있으면 안 된다 — 서버 제어가 풀린다');
    assert.strictEqual(job.processed, 2, '두 건 다 기록돼야 한다');
    assert.strictEqual(job.skipped, 2, '실패가 아니라 모름이다');
    assert.match(job.skips[0].reason, /처리됐는지 알 수 없다/);
});

test('취소는 유예 안에 답한 항목의 결과를 그대로 쓴다', async function () {
    // Waiting is right in itself (the result of a delete in flight is recorded exactly); only the unbounded waiting is fixed.
    const job = jobs.start({
        kind: 'test', title: '느린 작업',
        targets: ['/a'],
        concurrency: 1,
        cancelGraceMs: 5000,
        worker: function (ri, cb) { setTimeout(function () { cb('ok'); }, 40); }
    });
    await wait(10);
    jobs.cancel(job.id);
    await settled(job);

    assert.strictEqual(job.state, 'cancelled');
    assert.strictEqual(job.ok, 1, '유예 안에 온 답은 버리지 않는다');
    assert.strictEqual(job.skipped, 0);
});

test('유예가 끝난 뒤 늦게 온 답은 카운터를 흔들지 않는다', async function () {
    const job = jobs.start({
        kind: 'test', title: '늦는 작업',
        targets: ['/a'],
        concurrency: 1,
        cancelGraceMs: 30,
        worker: function (ri, cb) { setTimeout(function () { cb('ok'); }, 200); }
    });
    await wait(10);
    jobs.cancel(job.id);
    await settled(job);

    const processedAtFinish = job.processed;
    assert.strictEqual(processedAtFinish, 1);
    assert.strictEqual(job.skipped, 1);

    await wait(300);   // gives a late callback time to arrive
    assert.strictEqual(job.processed, processedAtFinish,
                       'total 을 넘으면 진행률이 100% 를 넘는다');
    assert.strictEqual(job.ok, 0);
});

test('취소가 즉시 pump 를 깨운다 — worker 가 전부 멈춰 있어도', async function () {
    // Cancel only raises a flag. If every worker is silent nobody calls pump, and the grace timer is never even armed.
    const job = jobs.start({
        kind: 'test', title: '전부 멈춤',
        targets: ['/a'],
        concurrency: 1,
        cancelGraceMs: 40,
        worker: function () { /* silence */ }
    });
    await wait(15);
    jobs.cancel(job.id);

    // Waits three times the grace period; without the timer the job would still be running here.
    await wait(140);
    assert.strictEqual(job.state, 'cancelled', '유예 타이머가 무장되지 않았다');
});

test('정상 작업은 유예 타이머를 만들지 않는다', async function () {
    // A timer on a job that was not cancelled would change behaviour silently.
    const job = jobs.start({
        kind: 'test', title: '정상',
        targets: ['/a', '/b', '/c'],
        cancelGraceMs: 30,
        worker: function (ri, cb) { setTimeout(function () { cb('ok'); }, 50); }
    });
    await settled(job);
    assert.strictEqual(job.state, 'done');
    assert.strictEqual(job.ok, 3, '유예가 멀쩡한 항목을 가로채면 안 된다');
    assert.strictEqual(job.skipped, 0);
});
