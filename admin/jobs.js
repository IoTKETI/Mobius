'use strict';
/**
 * Batch job engine.
 *
 * Deletions and et extensions may have thousands of targets and do not finish within one request; a job is created, its id returned at once, and the screen polls progress by id.
 *
 * State is in memory only. The console does not use the cluster (see admin/server.js), so one process knows everything. A restart loses running jobs but does not bring deleted resources back; only the job record is lost, and re-querying the list shows how far it got.
 *
 * One job runs at a time: two jobs touching the same subtree would count each other's 404 as failures, and the administrator must be able to see 'what is being deleted now' in one place.
 */

var crypto = require('crypto');

var MAX_FINISHED = 20;      // finished jobs kept
var MAX_FAILURES = 200;     // failure details kept per job
var DEFAULT_CONCURRENCY = 4;

/**
 * How long, after a cancel, to wait for the answers of items already in flight.
 *
 * Waiting is right (those deletes are really running and the answer records the result exactly); waiting forever is not. A worker that never calls back keeps running above 0, the job never ends and jobs.active() keeps returning it, so cancel must escape from that state.
 *
 * 45 seconds is comfortably above the CSE client's request timeout (30 s); a normal item answers within it, and the grace period firing is itself a sign of trouble.
 */
var CANCEL_GRACE_MS = 45000;

var active = null;          // the running job (only one)
var finished = [];          // most recent first

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
    this.failures = [];                 // {ri, reason}; cut at MAX_FAILURES
    this.failuresTruncated = false;
    this.skips = [];                    // skip reasons are evidence too
    this.skipsTruncated = false;
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.error = null;
    this.cancelRequested = false;
}

/** The representation for the screen; internal fields are not exposed as is. */
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
 * Starts a job.
 *
 * @param spec.targets   array of targets; the worker decides their shape.
 * @param spec.keyOf     extracts a log identifier from a target.
 * @param spec.worker    worker(target, cb) -> cb(outcome, reason)
 *                       outcome: 'ok' | 'skipped' | 'failed'
 *                       Must not throw: one failure must not stop the rest.
 * @returns {Job|null}   null when a job is already running
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
    // Left open so tests do not really wait 45 seconds; callers do not pass it.
    var graceMs = spec.cancelGraceMs > 0 ? spec.cancelGraceMs : CANCEL_GRACE_MS;

    var next = 0;
    var running = 0;
    var stopped = false;
    var inflight = [];          // targets not yet answered; recorded when the grace period ends.
    var graceTimer = null;

    function finishJob() {
        if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
        if (job.state === 'running') {
            job.state = job.cancelRequested ? 'cancelled' : 'done';
        }
        if (typeof spec.onFinish === 'function') {
            try { spec.onFinish(job); } catch (e) { /* a cleanup failure does not change the job result */ }
        }
        retire(job);
    }

    /** Items that did not answer within the grace period after a cancel. Unknown, not failed: the delete may or may not have finished on the server, and re-querying the list shows which. */
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

        // Cancelled while items are still running: wait for the answers, but not forever.
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
                    // A worker calling back twice would push the counters past total and the progress past 100%; blocked here.
                    if (settled) { return; }
                    settled = true;
                    // A late answer for a job that was already recorded and finished after the grace period is dropped; otherwise processed would exceed total.
                    if (stopped) { return; }
                    var at = inflight.indexOf(t);
                    if (at >= 0) { inflight.splice(at, 1); }
                    job._record(keyOf(t), outcome, reason);
                    running--;
                    // Next tick instead of recursion: when a worker finishes synchronously (e.g. an immediate skip in the preflight) the stack would grow with the number of targets.
                    setImmediate(pump);
                });
            }(target));
        }
    }

    // Kept so exports.cancel can run one pass right after a cancel; not part of view().
    job._poke = pump;

    // Starts after the caller has received the job and sent the response.
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

/** Requests a cancel. Requests already sent run to completion: cutting an HTTP request mid-way would leave it unknown whether the server deleted or not. Only targets not yet started are skipped. */
exports.cancel = function (id) {
    if (active && active.id === id) {
        active.cancelRequested = true;
        // One pass right after the cancel: if every worker is silent nobody would call pump, the grace timer would never be armed, and the cancel itself would be stuck.
        if (typeof active._poke === 'function') { active._poke(); }
        return true;
    }
    return false;
};

// For tests: clears the state without a new process.
exports._reset = function () {
    active = null;
    finished = [];
};

exports.MAX_FAILURES = MAX_FAILURES;
