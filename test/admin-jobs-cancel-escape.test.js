'use strict';
/**
 * 답을 안 주는 worker 에서 빠져나오기.
 *
 * worker 가 콜백을 영영 안 부르면 running 이 0 이 되지 않아 작업이 끝나지
 * 않는다. 그러면 `jobs.active()` 가 계속 그 작업을 돌려주고, 서버 제어의
 * `guard_busy` 가 Mobius 정지·재기동을 **영구히** 막는다.
 *
 * 취소가 그 상황의 탈출구인데, 취소도 같은 카운터(running === 0)를 기다리면
 * 함께 갇힌다. **탈출구가 갇히면 탈출구가 아니다.**
 *
 * 이 부류는 admin/cse.js 에서 실제로 났다 — 응답 본문이 중간에 끊기면
 * 콜백이 안 왔다(`ed776f6`). 그 원인은 고쳤지만 부류 자체는 남으므로
 * 엔진 쪽에도 바닥을 깐다.
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
        worker: function () { /* 영영 부르지 않는다 */ }
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
    // 기다려 주는 것 자체는 옳다 — 진행 중이던 삭제의 결과를 정확히 기록한다.
    // 고친 것은 "무한정" 기다리던 부분뿐이다.
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

    await wait(300);   // 늦은 콜백이 도착할 시간을 준다
    assert.strictEqual(job.processed, processedAtFinish,
                       'total 을 넘으면 진행률이 100% 를 넘는다');
    assert.strictEqual(job.ok, 0);
});

test('취소가 즉시 pump 를 깨운다 — worker 가 전부 멈춰 있어도', async function () {
    // 취소는 플래그만 세운다. worker 가 전부 침묵하면 pump 를 부를 사람이
    // 아무도 없어 유예 타이머가 무장조차 되지 않는다.
    const job = jobs.start({
        kind: 'test', title: '전부 멈춤',
        targets: ['/a'],
        concurrency: 1,
        cancelGraceMs: 40,
        worker: function () { /* 침묵 */ }
    });
    await wait(15);
    jobs.cancel(job.id);

    // 유예의 세 배를 기다린다. 타이머가 안 걸렸으면 여기서 여전히 running 이다.
    await wait(140);
    assert.strictEqual(job.state, 'cancelled', '유예 타이머가 무장되지 않았다');
});

test('정상 작업은 유예 타이머를 만들지 않는다', async function () {
    // 취소하지 않은 작업까지 타이머가 붙으면 조용히 동작이 바뀐다.
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
