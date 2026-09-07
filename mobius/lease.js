/**
 * Ledger of leased DB connections.
 *
 * Every connection handed out by db.getConnection is recorded here together with its call site; a periodic sweep logs leases that have not been released within leaseWarnMs (default 90 s). Forced reclaim runs only when global.leaseReclaimMs is set; it is off by default. The ledger never touches the HTTP response, and a double release passes through to the pool untouched.
 */

var util = require('util');

var DEFAULT_WARN_MS = 90000;

// open leases: id -> { at, where, conn, warned }
var open = {};
var next_id = 1;

var stats = { opened: 0, closed: 0, warned: 0, reclaimed: 0 };

function warnMs() {
    return (typeof global.leaseWarnMs === 'number' && global.leaseWarnMs > 0)
        ? global.leaseWarnMs : DEFAULT_WARN_MS;
}

function reclaimMs() {
    // 0 or unset disables reclaim.
    return (typeof global.leaseReclaimMs === 'number' && global.leaseReclaimMs > 0)
        ? global.leaseReclaimMs : 0;
}

/**
 * Records a connection in the ledger and wraps its release(). The pool reuses handles, so a handle is wrapped only once.
 *
 * @param {Object} conn  connection handle from the pool
 * @param {number} now   current time (ms); injectable for tests
 * @returns {Object} the same handle
 */
// Sweep timer. Started by the first lease, so processes that never lease a connection (the cluster primary) create no timer.
var sweep_timer = null;

function start_sweeping() {
    if (sweep_timer !== null) { return; }
    sweep_timer = setInterval(function () { exports.sweep(); }, 1000);
    // The timer must not keep the process alive.
    if (typeof sweep_timer.unref === 'function') { sweep_timer.unref(); }
}

exports.track = function (conn, now) {
    if (conn == null || typeof conn.release !== 'function') {
        return conn;                 // nothing to wrap
    }

    start_sweeping();

    var id = next_id++;
    var at = (typeof now === 'number') ? now : Date.now();
    // Keep a few stack frames so the acquisition site can be found.
    var where = (new Error().stack || '').split('\n').slice(2, 5).join('\n');

    open[id] = { at: at, where: where, conn: conn, warned: false };
    stats.opened++;

    if (!conn.__lease_wrapped) {
        var original = conn.release;
        conn.__lease_wrapped = true;
        conn.release = function () {
            // Only the current lease is removed. A double release passes through to the pool.
            if (conn.__lease_id != null) {
                if (open[conn.__lease_id]) {
                    delete open[conn.__lease_id];
                    stats.closed++;
                }
                conn.__lease_id = null;
            }
            return original.apply(conn, arguments);
        };
    }
    conn.__lease_id = id;

    return conn;
};

/**
 * Scans the ledger and logs leases older than the warning threshold.
 *
 * @param {number} now  current time (ms); injectable for tests
 * @returns {{warned: number, reclaimed: number}} counts for this scan
 */
exports.sweep = function (now) {
    var t = (typeof now === 'number') ? now : Date.now();
    var warn_at = warnMs();
    var reclaim_at = reclaimMs();
    var result = { warned: 0, reclaimed: 0 };

    Object.keys(open).forEach(function (id) {
        var lease = open[id];
        if (!lease) { return; }
        var age = t - lease.at;

        if (!lease.warned && age >= warn_at) {
            // Warn once per lease.
            lease.warned = true;
            stats.warned++;
            result.warned++;
            console.error(util.format(
                '[lease] 커넥션이 %dms 째 반납되지 않았다 (임대 %s)\n%s', age, id, lease.where));
        }

        if (reclaim_at > 0 && age >= reclaim_at) {
            // Reclaim is off by default. When enabled, the connection is returned to the pool.
            console.error(util.format('[lease] %dms 째 반납되지 않아 강제로 회수한다 (임대 %s)', age, id));
            delete open[id];
            stats.reclaimed++;
            result.reclaimed++;
            try { lease.conn.release(); }
            catch (e) { console.error('[lease] 회수 중 오류: ' + e.message); }
        }
    });

    return result;
};

/** Current counters, for tests and operations. */
exports.stats = function () {
    return {
        open: Object.keys(open).length,
        opened: stats.opened,
        closed: stats.closed,
        warned: stats.warned,
        reclaimed: stats.reclaimed
    };
};

/** Clears the ledger (tests). */
exports._reset = function () {
    open = {};
    next_id = 1;
    stats = { opened: 0, closed: 0, warned: 0, reclaimed: 0 };
    if (sweep_timer !== null) {
        clearInterval(sweep_timer);
        sweep_timer = null;
    }
};

exports.DEFAULT_WARN_MS = DEFAULT_WARN_MS;
