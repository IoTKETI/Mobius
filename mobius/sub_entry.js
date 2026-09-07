'use strict';
// Contract for reading a subscription row as the sender sees it. Decodes the nu and enc JSON strings and filters out rows that cannot be used for sending. No dependencies.

/** Reads one subscription row. Returns null when the row cannot be used for sending (malformed nu/enc, missing ri). Arrays are returned without copying; callers clone what they consume. */
function read(entry) {
    if (!entry || typeof entry !== 'object') { return null; }
    if (typeof entry.ri !== 'string' || entry.ri === '') { return null; }

    var enc = entry.enc;
    if (typeof enc === 'string') {
        try { enc = JSON.parse(enc); } catch (e) { return null; }
    }
    if (!enc || typeof enc !== 'object' || !Array.isArray(enc.net)) { return null; }

    var nu = entry.nu;
    if (typeof nu === 'string') {
        try { nu = JSON.parse(nu); } catch (e) { return null; }
    }
    if (!Array.isArray(nu)) { return null; }

    return { ri: entry.ri, cr: entry.cr, exc: entry.exc,
             nct: entry.nct, nec: entry.nec, net: enc.net, nu: nu };
}

exports.read = read;

// Fields the sender reads. Must match the columns selected by select_subs_by_pi.
exports.FIELDS = ['ri', 'nu', 'enc', 'nct', 'nec', 'cr'];
