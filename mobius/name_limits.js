'use strict';
// Length limits for rn, structured path and caller-supplied AE-ID at creation time.
// 
// oneM2M defines no maximum; these are this CSE's storage widths (lookup.rn / lookup.ri / lookup.sri are varchar(200)). Values over the limit are rejected with 400-68/400-69/400-70; reason.js builds the messages from these constants. The AE-ID format (S/C prefix) is not checked.

var RN_MAX = 200;
var PATH_MAX = 200;
var ID_MAX = 200;

// Returns a reason code when a limit is exceeded, else null. When both exceed, the name wins.
function check(rn, ri) {
    if (typeof rn === 'string' && rn.length > RN_MAX) { return '400-68'; }
    if (typeof ri === 'string' && ri.length > PATH_MAX) { return '400-69'; }
    return null;
}

// Caller-supplied AE-ID: length only.
function check_id(aei) {
    if (typeof aei === 'string' && aei.length > ID_MAX) { return '400-70'; }
    return null;
}

module.exports = {
    RN_MAX: RN_MAX,
    PATH_MAX: PATH_MAX,
    ID_MAX: ID_MAX,
    check: check,
    check_id: check_id
};
