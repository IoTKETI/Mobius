'use strict';
// ACP decision observation: deny logging and observe mode.
//
// Deny logging records who was denied what and by which ACP rule. Observe mode evaluates ACPs but lets denied requests through, logging what would have been blocked. Both run on the security.check hot path, so nothing here throws and log output is rate-limited per second.

// The superuser origin is masked in log lines (mobius/log_safe.js).
var log_safe = require('./log_safe');

var DEFAULTS = { mode: 'off', denyLog: 'sample', rate: 5, keep: 200 };

var cfg = { mode: DEFAULTS.mode, denyLog: DEFAULTS.denyLog, rate: DEFAULTS.rate, keep: DEFAULTS.keep };
var stats = null;

function fresh() {
    return {
        since: new Date().toISOString(),
        counts: { deny: 0, observe: 0, error: 0, acpi_attach: 0, suppressed: 0 },
        byReason: {},
        recent: [],
        // Token bucket, counted per worker process.
        windowSec: 0,
        windowUsed: 0
    };
}

stats = fresh();

/**
 * @param opts.mode     'off' (default) | 'observe': observe turns denials into allows
 * @param opts.denyLog  'off' | 'sample' (default) | 'all'
 * @param opts.rate     max log lines per second when denyLog='sample'
 * @param opts.keep     number of recent entries kept for snapshot
 */
exports.configure = function (opts) {
    var o = opts || {};
    if (o.mode === 'off' || o.mode === 'observe') { cfg.mode = o.mode; }
    if (o.denyLog === 'off' || o.denyLog === 'sample' || o.denyLog === 'all') { cfg.denyLog = o.denyLog; }
    if (typeof o.rate === 'number' && o.rate >= 0) { cfg.rate = o.rate; }
    if (typeof o.keep === 'number' && o.keep > 0) { cfg.keep = o.keep; }
};

exports.config = function () {
    return { mode: cfg.mode, denyLog: cfg.denyLog, rate: cfg.rate, keep: cfg.keep };
};

exports.reset = function () {
    stats = fresh();
};

exports.snapshot = function () {
    return {
        since: stats.since,
        config: exports.config(),
        counts: {
            deny: stats.counts.deny,
            observe: stats.counts.observe,
            error: stats.counts.error,
            acpi_attach: stats.counts.acpi_attach,
            suppressed: stats.counts.suppressed
        },
        byReason: JSON.parse(JSON.stringify(stats.byReason)),
        recent: stats.recent.slice()
    };
};

// Logs at most cfg.rate lines per second; beyond that only suppressed is counted.
function may_log() {
    if (cfg.denyLog === 'off') { return false; }
    if (cfg.denyLog === 'all') { return true; }
    var sec = Math.floor(Date.now() / 1000);
    if (sec !== stats.windowSec) {
        stats.windowSec = sec;
        stats.windowUsed = 0;
    }
    if (stats.windowUsed < cfg.rate) {
        stats.windowUsed += 1;
        return true;
    }
    stats.counts.suppressed += 1;
    return false;
}

// Denial reasons observe mode may override: only denials produced by ACP evaluation. 'default_policy' (no ACP present) and 'superuser' are not included.
var OBSERVABLE = {
    acr: 1,           // all rules seen, none allowed
    exhausted: 1,     // ACP present but no rule matched
    no_acr_cr: 1,     // pv without acr; decided by creator comparison
    no_acp_row: 1     // referenced ACP not found (dangling)
};

/** Whether the decision concerns the ACP itself. security.check evaluates pvs (selfPrivileges) when the target is an ACP (ty=1): pv says who may read or write the resource, pvs who may change or delete the policy itself. The field name is carried in trace.field by evaluate_acp_rows and in trace.path by the ty=1 branch. */
function is_self_privilege(t) {
    return t.field === 'pvs' || t.path === 'pvs';
}

var OP_NAME = {
    '1': 'CREATE', '2': 'RETRIEVE', '3': 'CREATE_SUB', '4': 'UPDATE',
    '8': 'DELETE', '16': 'NOTIFY', '32': 'DISCOVERY'
};

function op_of(v) {
    return OP_NAME[String(v)] || ('op' + v);
}

function push_recent(entry) {
    stats.recent.push(entry);
    while (stats.recent.length > cfg.keep) {
        stats.recent.shift();
    }
}

/** Records an arbitrary observation entry (currently acpi attachment). Never throws. */
exports.record = function (kind, info) {
    try {
        var i = info || {};
        if (stats.counts.hasOwnProperty(kind)) { stats.counts[kind] += 1; }
        push_recent({ at: new Date().toISOString(), kind: kind, info: i });
        if (kind === 'acpi_attach' && may_log()) {
            console.log('[acp] attach ri=' + (i.ri || '-') + ' ty=' + (i.ty || '-') +
                ' origin=' + log_safe.origin(i.origin) + ' cr=' + (i.cr || '-') +
                ' before=' + JSON.stringify(i.before || []) +
                ' after=' + JSON.stringify(i.after || []));
        }
    }
    catch (e) {
        // Observation must not kill the request.
    }
};

/** Observes the final decision of security.check and returns the code to actually emit. In observe mode '0' (deny) becomes '1' (allow); '500-1' and the superuser pass-through are left alone. */
exports.record_decision = function (request, code, trace) {
    try {
        var t = trace || {};
        var reason = t.decided_by || 'unknown';

        if (code === '500-1' && reason === 'eval_error') {
            stats.counts.error += 1;
            stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
            push_recent({ at: new Date().toISOString(), kind: 'error', info: line_info(request, t) });
            if (may_log()) {
                console.log('[acp] error ' + format(request, t) + ' err=' + (t.error || '-'));
            }
            return code;
        }

        if (code !== '0') {
            return code;
        }

        stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;

        if (cfg.mode === 'observe' && (!OBSERVABLE[reason] || is_self_privilege(t))) {
            // Observe mode overrides only denials caused by ACP evaluation. The default policy (applies when no ACP is present) is not overridden; use defaultAccessPolicy for that. Denials on the ACP's own pvs are not overridden either, because a change to an ACP outlives the observation window.
            push_recent({ at: new Date().toISOString(), kind: 'deny', info: line_info(request, t) });
            stats.counts.deny += 1;
            if (may_log()) {
                var why = is_self_privilege(t)
                    ? '관찰 모드지만 ACP 자신(pvs)에 대한 접근이라 그대로 막는다'
                    : '관찰 모드지만 ACP 거부가 아니라 그대로 막는다';
                console.log('[acp] deny ' + format(request, t) + ' (' + why + ')');
            }
            return code;
        }

        if (cfg.mode === 'observe') {
            t.observed = true;
            stats.counts.observe += 1;
            push_recent({ at: new Date().toISOString(), kind: 'observe', info: line_info(request, t) });
            if (may_log()) {
                console.log('[acp] observe ' + format(request, t));
            }
            return '1';
        }

        stats.counts.deny += 1;
        push_recent({ at: new Date().toISOString(), kind: 'deny', info: line_info(request, t) });
        if (may_log()) {
            console.log('[acp] deny ' + format(request, t));
        }
        return code;
    }
    catch (e) {
        // Observation must not change the decision; return the original code.
        return code;
    }
};

function line_info(request, t) {
    return {
        op: op_of(t.op_value),
        ty: t.ty,
        origin: request && request.headers ? request.headers['x-m2m-origin'] : undefined,
        url: request ? request.url : undefined,
        acp: t.acp_ri || null,
        acr: t.acr_index === undefined ? null : t.acr_index,
        field: t.field || null,
        source: t.source || null,
        inherited_from: t.inherited_from || null,
        by: t.decided_by || 'unknown',
        stopped_early: !!t.stopped_early,
        not_evaluated: t.not_evaluated || []
    };
}

// One line in a fixed, parseable format; '-' fills values that would otherwise be blank.
function format(request, t) {
    var i = line_info(request, t);
    var s = 'op=' + i.op + ' ty=' + (i.ty === undefined ? '-' : i.ty) +
        ' origin=' + log_safe.origin(i.origin) + ' url=' + (i.url || '-') +
        ' by=' + i.by;
    if (i.acp) { s += ' acp=' + i.acp + ' field=' + (i.field || '-') + ' acr=' + (i.acr === null ? '-' : i.acr); }
    if (i.source) { s += ' source=' + i.source; }
    if (i.inherited_from) { s += ' from=' + i.inherited_from; }
    if (i.stopped_early && i.not_evaluated.length > 0) {
        s += ' skipped=' + i.not_evaluated.join(',');
    }
    return s;
}
