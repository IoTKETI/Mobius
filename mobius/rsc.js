'use strict';
// Result code catalogue: the single source of truth for result codes.
//
// Each entry carries every binding value together (rsc, HTTP status, CoAP code); assertComplete() checks the table.
//
// One rsc maps to one HTTP status (oneM2M TS-0009). The only exception is CONTENT_TOO_LARGE (4000/413), explained at that entry; test/rsc-catalog.test.js enforces the invariant.

// coap: null means there is no CoAP mapping for the entry; toCoapCode falls back by class.

var RSC = {
    // success
    OK:        { name: 'OK',        rsc: '2000', http: 200, coap: '2.05' },
    CREATED:   { name: 'CREATED',   rsc: '2001', http: 201, coap: '2.01' },
    DELETED:   { name: 'DELETED',   rsc: '2002', http: 200, coap: '2.02' },
    UPDATED:   { name: 'UPDATED',   rsc: '2004', http: 200, coap: '2.04' },

    // Non-blocking request accepted: rt=1 is SYNC, rt=2 (+X-M2M-RTU) is ASYNC
    ACCEPTED_NONBLOCKING_SYNC:  { name: 'ACCEPTED_NONBLOCKING_SYNC',  rsc: '1001', http: 202, coap: null },
    ACCEPTED_NONBLOCKING_ASYNC: { name: 'ACCEPTED_NONBLOCKING_ASYNC', rsc: '1002', http: 202, coap: null },

    // 400
    BAD_REQUEST:                   { name: 'BAD_REQUEST',                   rsc: '4000', http: 400, coap: '4.00' },
    MAX_NUMBER_OF_MEMBER_EXCEEDED: { name: 'MAX_NUMBER_OF_MEMBER_EXCEEDED', rsc: '6010', http: 400, coap: '4.00' },
    MEMBER_TYPE_INCONSISTENT:      { name: 'MEMBER_TYPE_INCONSISTENT',      rsc: '6011', http: 400, coap: '4.00' },

    // 403
    ACCESS_DENIED:           { name: 'ACCESS_DENIED',           rsc: '4103', http: 403, coap: '4.03' },
    // Used for the allowed_ae_ids / allowed_app_ids allow-list rejections and fopt access denial.
    AE_NOT_ALLOWED:          { name: 'AE_NOT_ALLOWED',          rsc: '4107', http: 403, coap: null },
    NO_MEMBERS:              { name: 'NO_MEMBERS',              rsc: '4109', http: 403, coap: null },
    // The actual condition is 'ty cannot be created under this parent'; the rsc is subscription-related.
    TARGET_NOT_SUBSCRIBABLE: { name: 'TARGET_NOT_SUBSCRIBABLE', rsc: '5203', http: 403, coap: '4.03' },

    // 404 / 405 / 406
    NOT_FOUND:             { name: 'NOT_FOUND',             rsc: '4004', http: 404, coap: '4.04' },
    // Target not reachable: a remoteCSE without poa (404-9). TS-0009 maps 5103 to 404.
    TARGET_NOT_REACHABLE:  { name: 'TARGET_NOT_REACHABLE',  rsc: '5103', http: 404, coap: '4.04' },
    OPERATION_NOT_ALLOWED: { name: 'OPERATION_NOT_ALLOWED', rsc: '4005', http: 405, coap: '4.05' },
    NOT_ACCEPTABLE:        { name: 'NOT_ACCEPTABLE',        rsc: '5207', http: 406, coap: '4.06' },

    // 409
    ALREADY_EXISTS:     { name: 'ALREADY_EXISTS',     rsc: '4105', http: 409, coap: '4.03' },
    AEI_DUPLICATED:     { name: 'AEI_DUPLICATED',     rsc: '4106', http: 409, coap: null },

    // 413
    //
    // oneM2M has no rsc for 'body too large', so the rsc is 4000 like BAD_REQUEST and only the HTTP status is 413. This is the only exception to 'one rsc, one HTTP status'. coap is 4.00, not 4.13, because the table's invariant is 'same rsc, same coap' and 4000 is bound to 4.00.
    CONTENT_TOO_LARGE: { name: 'CONTENT_TOO_LARGE', rsc: '4000', http: 413, coap: '4.00' },

    // 423 / 500 / 501
    LOCKED:                { name: 'LOCKED',                rsc: '4230', http: 423, coap: null },
    INTERNAL_SERVER_ERROR: { name: 'INTERNAL_SERVER_ERROR', rsc: '5000', http: 500, coap: '5.00' },
    SUBSCRIPTION_VERIFICATION_INITIATION_FAILED:
        { name: 'SUBSCRIPTION_VERIFICATION_INITIATION_FAILED', rsc: '5204', http: 500, coap: '5.00' },
    NOT_IMPLEMENTED:       { name: 'NOT_IMPLEMENTED',       rsc: '5001', http: 501, coap: '5.01' }
};

// rsc values that appear in the CoAP table but are never produced by this server. Kept until confirmed dead.
var COAP_ONLY = {
    '4008': '4.04', '4101': '4.03', '4102': '4.00', '4104': '4.00',
    '5105': '4.03', '5106': '5.06', '5205': '4.03', '5206': '5.00',
    '6003': '4.04', '6005': '4.04', '6020': '5.00', '6021': '5.00', '6022': '4.00',
    '6023': '4.00', '6024': '4.00', '6025': '5.00', '6026': '5.00',
    '6028': '4.00', '6029': '4.00'
};

// Finds a catalogue entry by (http, rsc) pair; the pair is needed because of CONTENT_TOO_LARGE (4000/413).
function byPair(http, rsc) {
    var want = String(http);
    for (var k in RSC) {
        if (Object.prototype.hasOwnProperty.call(RSC, k)) {
            if (RSC[k].rsc === String(rsc) && String(RSC[k].http) === want) { return RSC[k]; }
        }
    }
    return null;
}

// Finds the CoAP code for an rsc; null when there is none (the caller decides the fallback).
function coapFor(rsc) {
    for (var k in RSC) {
        if (Object.prototype.hasOwnProperty.call(RSC, k)) {
            if (RSC[k].rsc === String(rsc)) { return RSC[k].coap; }
        }
    }
    return Object.prototype.hasOwnProperty.call(COAP_ONLY, String(rsc))
        ? COAP_ONLY[String(rsc)] : null;
}

// Self-check of the catalogue. Called once at boot; problems are reported as warnings and never stop the server.
function assertComplete() {
    var problems = [];
    Object.keys(RSC).forEach(function (k) {
        var e = RSC[k];
        if (e.name !== k) { problems.push(k + ': name 이 키와 다르다 (' + e.name + ')'); }
        if (!/^\d{4}$/.test(e.rsc)) { problems.push(k + ': rsc 형식이 아니다 (' + e.rsc + ')'); }
        if (typeof e.http !== 'number') { problems.push(k + ': http 가 number 가 아니다 (' + typeof e.http + ')'); }
        if (e.coap !== null && !/^\d\.\d\d$/.test(e.coap)) {
            problems.push(k + ': coap 형식이 아니다 (' + e.coap + ')');
        }
    });

    // (http, rsc) pairs must be unique or byPair is ambiguous.
    var seen = {};
    Object.keys(RSC).forEach(function (k) {
        var p = RSC[k].http + '|' + RSC[k].rsc;
        if (seen[p]) { problems.push('(http,rsc) 중복: ' + p + ' -> ' + seen[p] + ', ' + k); }
        seen[p] = k;
    });

    return problems;
}

// Entries without a CoAP mapping; toCoapCode's fallback applies to them.
function missingCoap() {
    return Object.keys(RSC).filter(function (k) { return RSC[k].coap === null; });
}

// rsc -> CoAP response code. Never returns undefined: a known mapping is used, otherwise a coarse class-level fallback derived from the first digit of the rsc.
function toCoapCode(rsc) {
    var known = coapFor(rsc);
    if (known) { return known; }

    switch (String(rsc).charAt(0)) {
        case '1':  // 1xxx is a non-blocking accept, a success class in oneM2M
        case '2':
            return '2.05';
        case '4':
            return '4.00';
        default:   // 5xxx, 6xxx and anything else
            return '5.00';
    }
}

module.exports = {
    RSC: RSC,
    COAP_ONLY: COAP_ONLY,
    byPair: byPair,
    coapFor: coapFor,
    toCoapCode: toCoapCode,
    assertComplete: assertComplete,
    missingCoap: missingCoap
};
