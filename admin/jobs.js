'use strict';
/**
 * 일괄 작업 엔진.
 *
 * 삭제·et 연장은 대상이 수천 건이 될 수 있어 요청-응답 안에서 끝나지 않는다.
 * 작업을 만들어 즉시 id 를 돌려주고, 화면이 그 id 로 진행률을 폴링한다.
 *
 * 상태는 메모리에만 둔다. 콘솔은 클러스터를 쓰지 않으므로(admin/server.js 주석
 * 참고) 프로세스 하나가 전부를 안다. 재시작하면 진행 중이던 작업은 사라지지만
 * **이미 삭제된 것이 되살아나지는 않는다** — 작업 기록만 잃는다. 어디까지
 * 지웠는지는 목록을 다시 조회하면 그 자체로 드러난다.
 *
 * 동시에 한 건만 돈다. 두 작업이 같은 서브트리를 건드리면 서로의 404 를 실패로
 * 세게 되고, 무엇보다 관리자가 "지금 무엇이 지워지는 중인가" 를 하나로 볼 수
 * 있어야 한다.
 */

var crypto = require('crypto');

var MAX_FINISHED = 20;      // 끝난 작업 보관 개수
var MAX_FAILURES = 200;     // 작업당 보관할 실패 상세 개수
var DEFAULT_CONCURRENCY = 4;

var active = null;          // 지금 도는 작업 (하나뿐)
var finished = [];          // 최근 것이 앞

function new_id() {
    return crypto.randomBytes(6).toString('hex');
}

function Job(spec) {
    this.id = new_id();
    this.kind = spec.kind;              // 'expired-delete' | 'expired-extend' | 'orphan-delete'
    this.title = spec.title;
    this.note = spec.note || '';
    this.total = spec.total;
    this.state = 'running';             // running | done | cancelled | failed
    this.processed = 0;
    this.ok = 0;
    this.skipped = 0;
    this.failed = 0;
    this.failures = [];                 // {ri, reason} — MAX_FAILURES 에서 끊는다
    this.failuresTruncated = false;
    this.skips = [];                    // 건너뛴 이유도 판단 재료다
    this.skipsTruncated = false;
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.error = null;
    this.cancelRequested = false;
}

/** 화면에 넘길 표현. 내부 필드를 그대로 노출하지 않는다. */
Job.prototype.view = function () {
    return {
        id: this.id,
        kind: this.kind,
        title: this.title,
        note: this.note,
        state: this.state,
        total: this.total,
        processed: this.processed,
        ok: this.ok,
        skipped: this.skipped,
        failed: this.failed,
        failures: this.failures,
        failuresTruncated: this.failuresTruncated,
        skips: this.skips,
        skipsTruncated: this.skipsTruncated,
        startedAt: this.startedAt,
        finishedAt: this.finishedAt,
        error: this.error,
        cancelRequested: this.cancelRequested
    };
};

Job.prototype._record = function (ri, outcome, reason) {
    this.processed++;
    if (outcome === 'ok') {
        this.ok++;
        return;
    }
    if (outcome === 'skipped') {
        this.skipped++;
        if (this.skips.length < MAX_FAILURES) { this.skips.push({ ri: ri, reason: reason }); }
        else { this.skipsTruncated = true; }
        return;
    }
    this.failed++;
    if (this.failures.length < MAX_FAILURES) { this.failures.push({ ri: ri, reason: reason }); }
    else { this.failuresTruncated = true; }
};

function retire(job) {
    job.finishedAt = new Date().toISOString();
    active = null;
    finished.unshift(job);
    if (finished.length > MAX_FINISHED) { finished.length = MAX_FINISHED; }
}

/**
 * 작업을 시작한다.
 *
 * @param spec.targets   대상 배열. 원소의 모양은 worker 가 정한다.
 * @param spec.keyOf     원소에서 로그용 식별자를 뽑는 함수.
 * @param spec.worker    worker(target, cb) → cb(outcome, reason)
 *                       outcome: 'ok' | 'skipped' | 'failed'
 *                       **던지지 않아야 한다.** 한 건의 실패가 나머지를 멈추면 안 된다.
 * @returns {Job|null}   이미 도는 작업이 있으면 null
 */
exports.start = function (spec) {
    if (active) { return null; }

    var job = new Job({
        kind: spec.kind,
        title: spec.title,
        note: spec.note,
        total: spec.targets.length
    });
    active = job;

    var targets = spec.targets;
    var keyOf = spec.keyOf || function (t) { return String(t); };
    var worker = spec.worker;
    var concurrency = spec.concurrency > 0 ? spec.concurrency : DEFAULT_CONCURRENCY;

    var next = 0;
    var running = 0;
    var stopped = false;

    function finishJob() {
        if (job.state === 'running') {
            job.state = job.cancelRequested ? 'cancelled' : 'done';
        }
        if (typeof spec.onFinish === 'function') {
            try { spec.onFinish(job); } catch (e) { /* 정리 실패가 작업 결과를 바꾸지 않는다 */ }
        }
        retire(job);
    }

    function pump() {
        if (stopped) { return; }

        if (job.cancelRequested && running === 0) { stopped = true; return finishJob(); }
        if (next >= targets.length && running === 0) { stopped = true; return finishJob(); }

        while (!job.cancelRequested && running < concurrency && next < targets.length) {
            var target = targets[next++];
            running++;
            (function (t) {
                var settled = false;
                worker(t, function (outcome, reason) {
                    // worker 가 콜백을 두 번 부르면 카운터가 total 을 넘어 진행률이
                    // 100% 를 넘는다. 여기서 막는다.
                    if (settled) { return; }
                    settled = true;
                    job._record(keyOf(t), outcome, reason);
                    running--;
                    // 재귀 대신 다음 틱으로 넘긴다. worker 가 동기로 끝나는 경우
                    // (예: 프리플라이트에서 즉시 skip) 스택이 대상 수만큼 쌓인다.
                    setImmediate(pump);
                });
            }(target));
        }
    }

    // 호출자가 job 을 받아 응답을 보낸 뒤에 돌기 시작한다.
    setImmediate(pump);
    return job;
};

exports.active = function () { return active; };

exports.get = function (id) {
    if (active && active.id === id) { return active; }
    for (var i = 0; i < finished.length; i++) {
        if (finished[i].id === id) { return finished[i]; }
    }
    return null;
};

exports.list = function () {
    var out = [];
    if (active) { out.push(active.view()); }
    for (var i = 0; i < finished.length; i++) { out.push(finished[i].view()); }
    return out;
};

/**
 * 취소를 요청한다. 이미 나간 요청은 끝까지 간다 — HTTP 요청을 중간에 끊으면
 * 서버가 삭제를 했는지 안 했는지 알 수 없게 된다. 아직 시작하지 않은 대상만
 * 건너뛴다.
 */
exports.cancel = function (id) {
    if (active && active.id === id) {
        active.cancelRequested = true;
        return true;
    }
    return false;
};

// 테스트용. 프로세스를 새로 띄우지 않고 상태를 비운다.
exports._reset = function () {
    active = null;
    finished = [];
};

exports.MAX_FAILURES = MAX_FAILURES;
