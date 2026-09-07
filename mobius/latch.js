/**
 * Ledger of the latches held by the primary's periodic jobs (retention sweep, counter reconcile).
 *
 * Each job sets a flag while it runs and clears it in a DB callback. This ledger records enter/progress/leave and logs a warning when a latch shows no progress for latchStaleMs (default 15 minutes). It never releases a latch: releasing would let a second flow into an unguarded critical section. Time is measured from the last progress, not from the start of a cycle, because cycle length depends on the data; what counts as progress is decided by the caller. The ledger lives in the primary's memory only.
 */

var util = require('util');

var DEFAULT_STALE_MS = 15 * 60 * 1000;

// Re-warn interval. The first warning is immediate; later ones repeat at this interval so the evidence survives log rotation.
var REWARN_MS = 10 * 60 * 1000;

// name -> { at, progressAt, warnedAt }
var held = {};
var stats = { entered: 0, left: 0, warned: 0, overlapped: 0 };

function staleMs() {
    return (typeof global.latchStaleMs === 'number' && global.latchStaleMs >= 0)
        ? global.latchStaleMs : DEFAULT_STALE_MS;
}

function nowOr(now) {
    return (typeof now === 'number') ? now : Date.now();
}

/**
 * Records that a latch was taken. This is observation only; mutual exclusion is the caller's boolean. Taking a latch that is already held is reported as a defect.
 *
 * Call it before db.getConnection so that an acquisition that never returns is also visible.
 *
 * @param {string} name  job name
 * @param {number} [now] current time (ms); injectable for tests
 * @returns {boolean} true when newly taken, false when it was already held
 */
exports.enter = function (name, now) {
    var t = nowOr(now);
    if (held[name]) {
        stats.overlapped++;
        console.error(util.format(
            '[latch] %s 이 이미 잡혀 있는데 또 시작했다 — 두 흐름이 겹친다 (master pid=%d)',
            name, process.pid));
        // On overlap the original clock is kept; rewinding would hide a stuck latch.
        return false;
    }
    held[name] = { at: t, progressAt: t, warnedAt: 0 };
    stats.entered++;
    return true;
};

/** Records progress. The caller decides what progress means (reconcile: the cursor moved). */
exports.progress = function (name, now) {
    var h = held[name];
    if (!h) { return false; }
    h.progressAt = nowOr(now);
    // Progress after a warning means the job is running again; clear the warning state.
    h.warnedAt = 0;
    return true;
};

/** Records that the latch was released. */
exports.leave = function (name) {
    if (!held[name]) { return false; }
    delete held[name];
    stats.left++;
    return true;
};

/**
 * Scans the ledger and logs stale latches. Releases nothing.
 *
 * @param {number} [now] current time (ms); injectable for tests
 * @returns {Array} names warned in this scan
 */
exports.sweep = function (now) {
    var t = nowOr(now);
    var stale = staleMs();
    if (!(stale > 0)) { return []; }        // 0 disables the check

    var warned = [];
    Object.keys(held).forEach(function (name) {
        var h = held[name];
        if (!h) { return; }

        var idle = t - h.progressAt;
        if (idle < stale) { return; }
        if (h.warnedAt && (t - h.warnedAt) < REWARN_MS) { return; }
        h.warnedAt = t;
        stats.warned++;
        warned.push(name);

        // The line carries pid and time (pm2 merges primary and worker stdout) and states the impact first: these jobs are not on the request path.
        console.error(util.format(
            '[latch] %s 이 %d초째 진전이 없다 (총 보유 %d초). 이 주기 작업은 ' +
            '멈춰 있다. **요청 처리에는 영향이 없다** — 이 작업은 보존 한도 ' +
            '적용과 cnt 카운터 정합만 한다. 다음 점검 창에 Mobius 를 재기동하면 ' +
            '처음부터 다시 돈다(마스터만 따로 띄울 수는 없다). 자동으로 풀지 ' +
            '않는 이유는 mobius/latch.js 머리주석. master pid=%d at=%s ' +
            'entered=%d left=%d',
            name, Math.round(idle / 1000), Math.round((t - h.at) / 1000),
            process.pid, new Date(t).toISOString(), stats.entered, stats.left));
    });
    return warned;
};

/** What is currently held; for tests and operations. */
exports.describe = function (now) {
    var t = nowOr(now);
    return Object.keys(held).map(function (name) {
        var h = held[name];
        return {
            name: name,
            heldMs: t - h.at,
            idleMs: t - h.progressAt,
            warned: h.warnedAt > 0
        };
    });
};

exports.stats = function () {
    return {
        held: Object.keys(held).length,
        entered: stats.entered,
        left: stats.left,
        warned: stats.warned,
        overlapped: stats.overlapped
    };
};

/** Clears the ledger (tests). */
exports._reset = function () {
    held = {};
    stats = { entered: 0, left: 0, warned: 0, overlapped: 0 };
};

exports.DEFAULT_STALE_MS = DEFAULT_STALE_MS;
exports.REWARN_MS = REWARN_MS;
