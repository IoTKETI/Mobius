/**
 * @file Generator for auto-assigned resource names (rn).
 * 
 * rn becomes part of ri (= pi + '/' + rn), the primary key of lookup, so it must be unique. The name is a fixed-width millisecond timestamp followed by a worker tag and a per-millisecond sequence number, so lexical order equals creation order and names from different workers never collide.
 */

'use strict';

var moment = require('moment');
var cluster = require('cluster');

// cluster assigns distinct ids to live workers; resources made in the primary (CSEBase etc.) use 0.
var WORKER_TAG = String(
    ((cluster.worker && cluster.worker.id) ? cluster.worker.id : 0) % 1000
).padStart(3, '0');

var seq = 0;
var last_ts = '';

// Sequence within one millisecond; resets when the millisecond changes. Wraps after 1000.
function next_seq(ts) {
    if (ts === last_ts) {
        seq = (seq + 1) % 1000;
    }
    else {
        last_ts = ts;
        seq = 0;
    }
    return String(seq).padStart(3, '0');
}

// Auto-generated rn. Not used when the client supplies rn.
exports.next_rn = function (ty) {
    var ts = moment().utc().format('YYYYMMDDHHmmssSSS');
    return ty + '-' + ts + WORKER_TAG + next_seq(ts);
};

// For tests.
exports._worker_tag = function () { return WORKER_TAG; };
