'use strict';
// Short resource id (sri) generator, unique per host by construction.
// 
//   <prefix><YYYYMMDDHHmmssSSS><pid base36, 5+ chars><seq base36, 3 chars>
//   e.g. '4-' + 20260906031641123 + 00k3z + 001  ->  4-2026090603164112300k3z001 (27 chars)
// 
// pid is unique per host while the process lives; seq counts from 0 within each millisecond of a process. The clock is monotonic within the process, so (ms, seq) pairs never repeat. Sharing one database between hosts is not supported. The 17-digit timestamp keeps ids human-readable and time-ordered. The prefix comes from the caller ('4-', '5-', 'S', ...).

var SEQ_LIMIT = 36 * 36 * 36;                  // 3 base36 digits: 46,656 ids per process per millisecond
var PID36 = process.pid.toString(36).padStart(5, '0');

var last_ms = 0;
var seq = 0;

function pad(n, w) { return String(n).padStart(w, '0'); }

function ts17(ms) {
    var d = new Date(ms);
    return pad(d.getUTCFullYear(), 4) + pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2) +
           pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2) + pad(d.getUTCSeconds(), 2) +
           pad(d.getUTCMilliseconds(), 3);
}

// prefix  caller's prefix: resource types use '4-' style (dash included), AE uses 'S'/'C'
// now     clock for tests (defaults to Date.now)
function generate(prefix, now) {
    var t = (typeof now === 'function') ? now() : Date.now();
    if (t < last_ms) { t = last_ms; }             // monotonic: never repeat a timestamp even if the clock steps back
    if (t === last_ms) {
        seq += 1;
        if (seq >= SEQ_LIMIT) { t += 1; seq = 0; }  // more than 46,656 in one ms: borrow the next millisecond
    }
    else {
        seq = 0;
    }
    last_ms = t;
    return String(prefix) + ts17(t) + PID36 + seq.toString(36).padStart(3, '0');
}

module.exports = {
    generate: generate,
    ts17: ts17
};
