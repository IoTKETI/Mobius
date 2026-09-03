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

/**
 * 취소한 뒤 진행 중이던 항목의 답을 기다려 주는 시간.
 *
 * 기다리는 것 자체는 옳다 — 그 삭제는 실제로 진행 중이고, 답을 받으면 결과를
 * 정확히 기록할 수 있다. 문제는 **무한정** 기다리는 것이다.
 *
 * worker 가 콜백을 영영 안 부르면 running 이 0 이 되지 않아 작업이 끝나지
 * 않고, `jobs.active()` 가 계속 그 작업을 돌려준다. 그러면 서버 제어의
 * guard_busy 가 Mobius 정지·재기동을 **영구히** 막는다. 취소는 그 상황의
 * 탈출구인데, 지금까지는 취소도 같은 카운터를 기다려 함께 갇혔다.
 *
 * 45초는 CSE 클라이언트의 요청 타임아웃(30초)보다 넉넉하다. 정상적인 항목은
 * 그 안에 반드시 답한다 — 유예가 발동하면 그것 자체가 비정상 신호다.
 */
var CANCEL_GRACE_MS = 45000;

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
    // 시험이 45초를 실제로 기다리지 않게 열어 둔다. 호출부는 넘기지 않는다.
    var graceMs = spec.cancelGraceMs > 0 ? spec.cancelGraceMs : CANCEL_GRACE_MS;

    var next = 0;
    var running = 0;
    var stopped = false;
    var inflight = [];          // 아직 답이 안 온 대상. 유예가 끝나면 이들을 기록한다.
    var graceTimer = null;

    function finishJob() {
        if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
        if (job.state === 'running') {
            job.state = job.cancelRequested ? 'cancelled' : 'done';
        }
        if (typeof spec.onFinish === 'function') {
            try { spec.onFinish(job); } catch (e) { /* 정리 실패가 작업 결과를 바꾸지 않는다 */ }
        }
        retire(job);
    }

    /**
     * 취소했는데 유예 안에 답하지 않은 항목들. **실패가 아니라 모름이다** —
     * 그 삭제는 서버에서 끝났을 수도, 안 끝났을 수도 있다. 관리자가 목록을
     * 다시 조회하면 어느 쪽인지 드러난다.
     */
    function abandonInflight() {
        graceTimer = null;
        if (stopped) { return; }
        stopped = true;
        inflight.forEach(function (t) {
            job._record(keyOf(t), 'skipped',
                        '취소 시점에 응답을 기다리던 중이었다 (' + (graceMs / 1000) +
                        '초 유예 초과) — 처리됐는지 알 수 없다');
        });
        inflight = [];
        finishJob();
    }

    function pump() {
        if (stopped) { return; }

        if (job.cancelRequested && running === 0) { stopped = true; return finishJob(); }
        if (next >= targets.length && running === 0) { stopped = true; return finishJob(); }

        // 취소했는데 아직 도는 항목이 있다. 답을 기다리되 영원히는 아니다.
        if (job.cancelRequested && running > 0 && graceTimer === null) {
            graceTimer = setTimeout(abandonInflight, graceMs);
            if (typeof graceTimer.unref === 'function') { graceTimer.unref(); }
        }

        while (!job.cancelRequested && running < concurrency && next < targets.length) {
            var target = targets[next++];
            running++;
            inflight.push(target);
            (function (t) {
                var settled = false;
                worker(t, function (outcome, reason) {
                    // worker 가 콜백을 두 번 부르면 카운터가 total 을 넘어 진행률이
                    // 100% 를 넘는다. 여기서 막는다.
                    if (settled) { return; }
                    settled = true;
                    // 유예가 끝나 이미 기록하고 끝낸 작업에 늦게 온 답은 버린다.
                    // 여기서 안 막으면 processed 가 total 을 넘는다.
                    if (stopped) { return; }
                    var at = inflight.indexOf(t);
                    if (at >= 0) { inflight.splice(at, 1); }
                    job._record(keyOf(t), outcome, reason);
                    running--;
                    // 재귀 대신 다음 틱으로 넘긴다. worker 가 동기로 끝나는 경우
                    // (예: 프리플라이트에서 즉시 skip) 스택이 대상 수만큼 쌓인다.
                    setImmediate(pump);
                });
            }(target));
        }
    }

    // exports.cancel 이 취소 직후 한 번 돌리기 위해 잡는다. view() 에는 안 나간다.
    job._poke = pump;

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
        // 취소 즉시 한 번 돌린다. worker 들이 전부 답을 안 주고 있으면 pump 를
        // 부를 사람이 아무도 없어 유예 타이머가 무장되지 않는다 — 그러면
        // **취소 자체가 같이 갇힌다.** 탈출구가 갇히면 탈출구가 아니다.
        if (typeof active._poke === 'function') { active._poke(); }
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
