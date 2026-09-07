'use strict';
// Log helpers that keep credentials out of log lines.
// 
// The X-M2M-Origin header may carry the superuser value, which bypasses every ACP check; it is masked before logging. Ordinary AE names pass through unchanged. The leading-slash form ('/' + superuser) is masked as well.

var MASK = '<superuser>';

/**
 * Returns the origin value to put in a log line.
 * 
 *   log_safe.origin(request.headers['x-m2m-origin'])
 * 
 * The superuser becomes '<superuser>', an empty value becomes '?', anything else is returned as is.
 */
exports.origin = function (v) {
    if (v === undefined || v === null || v === '') { return '?'; }
    var s = String(v);

    // Without the global (module loaded without mobius.js) there is nothing to mask; return the value as is.
    var su = global.usesuperuser;
    if (typeof su !== 'string' || su === '') { return s; }

    if (s === su || s === '/' + su) { return MASK; }
    return s;
};

// Exposed so tests can check the exact mask text.
exports.MASK = MASK;
