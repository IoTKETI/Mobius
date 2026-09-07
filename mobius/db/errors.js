/** @file Backend-neutral DB error predicates. Pure module without dependencies. Both the driver code ('ER_DUP_ENTRY') and the facade code ('DUPLICATE_KEY') are accepted. */

'use strict';

exports.isDuplicateKey = function (err) {
    if (!err) { return false; }
    return err.code === 'ER_DUP_ENTRY' || err.code === 'DUPLICATE_KEY';
};

// Whether the error is a duplicate AE-ID (aei). The constraint name differs per backend (MySQL 5.7 'aei_UNIQUE', MySQL 8 'ae.aei_UNIQUE', SQLite 'ae.aei'); the facade strips the prefix into err.constraint, which is checked first, and the raw message is the fallback.
exports.isAeiDuplicate = function (err) {
    if (!err) { return false; }
    if (err.constraint) { return /(^|[^a-z])aei([^a-z]|$)/i.test(err.constraint); }
    if (typeof err.message !== 'string') { return false; }
    return /(?:key '|failed:\s*)(?:[^'\s.]+\.)?aei(?:[^a-z]|$)/i.test(err.message);
};

// The server cut this single statement at its time limit. Not a database fault: the query scope is too large. The connection is still alive, unlike a driver timeout.
exports.isStatementTimeout = function (err) {
    if (!err) { return false; }
    return err.code === 'STATEMENT_TIMEOUT';
};

// An index named by the query does not exist on the server: code was deployed without running the migration. Discovery forces indexes, so one missing index fails every discovery.
exports.isMissingIndex = function (err) {
    if (!err) { return false; }
    return err.code === 'MISSING_INDEX';
};

// Human-readable text for the log. Accepts anything (error object, string, array, undefined) and never throws. The output is capped so a large object cannot flood the log. name is checked after message because an Error with an empty message serialises to {}.
var TEXT_CAP = 500;

exports.text = function (err) {
    if (err === null || err === undefined) { return String(err); }
    if (typeof err === 'string') { return err; }

    var s = err.sqlMessage || err.message || err.name;
    if (typeof s === 'string' && s.length > 0) { return s; }

    var out;
    try { out = JSON.stringify(err); } catch (e) { out = String(err); }
    if (typeof out !== 'string') { return String(err); }
    return out.length > TEXT_CAP ? out.slice(0, TEXT_CAP) + '…(잘림)' : out;
};
