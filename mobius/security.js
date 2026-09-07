/**
 * Copyright (c) 2018, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var db_sql = require('./sql_action');
var ip = require("ip");
var acp_observe = require('./acp_observe');

var moment = require('moment');

/**
 * Parses the pv / pvs column of an acp row into a privilege object. Never throws.
 *
 * @returns {Object|null} the rule object, or null when it cannot be read; the caller skips that row.
 */
function parse_acp_rule(raw, attr, ri) {
    var obj = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        }
        catch (e) {
            console.error('[security] ' + attr + ' 를 읽을 수 없어 이 acp 를 건너뛴다 (' + ri + '): ' + e.message);
            return null;
        }
    }
    // JSON.parse('null') returns null without throwing; an array is not a rule object either.
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        console.error('[security] ' + attr + ' 가 권한 규칙 객체가 아니어서 이 acp 를 건너뛴다 (' + ri + ')');
        return null;
    }
    return obj;
}

// Exported for tests; the public entry point is exports.check.
/**
 * Whether now is inside an accessControlWindow.
 *
 * actw is a list of crontab-style windows (sec min hour day month weekday). A window matches only when all six fields match; '*' matches anything. Lists, ranges and steps (1,3 or 1-5) are not supported; only exact matches.
 *
 * @param {string} window  one window, e.g. '0 0 3 * * *'
 * @param {Array}  now     [sec, min, hour, day, month, weekday]
 * @returns {boolean} true when inside the window; false when the format is not six fields
 */
function actw_matches(window, now) {
    var parts = String(window).trim().split(/\s+/);
    if (parts.length !== 6) {
        // A window that cannot be evaluated does not allow.
        console.error('[security] actw 형식이 6자리가 아니다: ' + window);
        return false;
    }
    for (var d = 0; d < 6; d++) {
        if (parts[d] === '*') {
            continue;                       // unrestricted field
        }
        if (parts[d] !== String(now[d])) {
            return false;
        }
    }
    return true;
}

exports._parse_acp_rule = parse_acp_rule;
// Exported for tests; the public entry point is exports.check.
exports._actw_matches = actw_matches;
exports._acip_allows = acip_allows;
exports._actw_allows = actw_allows;
/**
 * oneM2M accessControlOperations bits as strings; acop_allows compares with a string `&` and the default policy uses `access_value & '1'`.
 *
 * SUB_CREATE is '3' (CREATE|RETRIEVE).
 */
exports.ACOP = Object.freeze({
    CREATE: '1', RETRIEVE: '2', UPDATE: '4', DELETE: '8', NOTIFY: '16', DISCOVERY: '32',
    SUB_CREATE: '3'
});

exports._acor_allows = acor_allows;
exports._acor_matches = acor_matches;
exports._acop_allows = acop_allows;
exports._evaluate_acr = evaluate_acr;
exports._evaluate_acr_traced = evaluate_acr_traced;
// The simulator (acp_simulate) uses this function directly so there is a single copy of the decision logic.
exports._evaluate_acp_rows = evaluate_acp_rows;

// Privilege evaluation.
//
// Evaluation happens in evaluate_acr() only. The two evaluation paths differ in three things, held in the FIELD table:
//   field        'pv' for ordinary resources, 'pvs' for access to the ACP itself
//   use_ra       whether the client IPv4 is read from the remoteaddress header first
//   cr_fallback  whether a rule without acr ends the decision with a creator comparison (pv only; pvs moves on to the next ACP)
//
// FIELD, field_of and INHERITS_ACPI live only here; other modules (acp_simulate) read them from this module.

var FIELD = Object.freeze({
    pv:  Object.freeze({ use_ra: true,  cr_fallback: true }),
    pvs: Object.freeze({ use_ra: false, cr_fallback: false })
});

// Which field decides: the ACP itself (ty 1) is judged by its own pvs (selfPrivileges), everything else by pv.
function field_of(ty) {
    return (String(ty) === '1') ? 'pvs' : 'pv';
}

// Types that inherit the ancestors' acpi when their own is empty: cnt, cin, sub. select_acp_cnt walks up. Other types go straight to the default policy.
var INHERITS_ACPI = Object.freeze({ '3': true, '4': true, '23': true });

exports.FIELD = FIELD;
exports.field_of = field_of;
exports.INHERITS_ACPI = INHERITS_ACPI;

/**
 * IPv4 address of the requester.
 *
 * @param use_ra  whether to read the remoteaddress header first
 */
function client_ipv4_of(request, use_ra) {
    if (use_ra && request.headers.hasOwnProperty('remoteaddress')) {
        return request.headers.remoteaddress;
    }
    if (request.connection.remoteAddress == '::1') {
        return ip.address();
    }
    return request.connection.remoteAddress.replace('::ffff:', '');
}

/** Whether the acip (allowed IP) condition passes. An empty list means unrestricted. */
function acip_allows(acip, request, use_ra) {
    if (acip == null) {
        return true;                    // no acip at all: no IP restriction
    }
    if (acip.hasOwnProperty('ipv4')) {
        var list4 = acip['ipv4'] || [];
        var keys4 = Object.keys(list4);
        if (keys4.length === 0) {
            return true;                // empty list = unrestricted
        }
        var mine = client_ipv4_of(request, use_ra);
        for (var i = 0; i < keys4.length; i++) {
            if (list4[keys4[i]] == mine) { return true; }
        }
        return false;
    }
    if (acip.hasOwnProperty('ipv6')) {
        var list6 = acip['ipv6'] || [];
        var keys6 = Object.keys(list6);
        if (keys6.length === 0) {
            return true;
        }
        for (var j = 0; j < keys6.length; j++) {
            if (list6[keys6[j]] == request.connection.remoteAddress) { return true; }
        }
        return false;
    }
    return true;                        // neither ipv4 nor ipv6: unrestricted
}

/** Whether the actw (allowed time window) condition passes. An empty list means unrestricted. */
function actw_allows(actw) {
    var keys = Object.keys(actw || {});
    if (keys.length === 0) {
        return true;
    }
    var now = [];
    now[5] = moment().utc().day();
    now[4] = moment().utc().month() + 1;
    now[3] = moment().utc().date();
    now[2] = moment().utc().hour();
    now[1] = moment().utc().minute();
    now[0] = moment().utc().second();

    for (var i = 0; i < keys.length; i++) {
        if (actw_matches(actw[keys[i]], now)) { return true; }
    }
    return false;
}

/**
 * Whether the acor (allowed originators) and acop (allowed operations) conditions pass.
 *
 * Without acor there is no originator restriction. With acor the originator must equal an entry or the entry must be 'all' / '*'; on top of that the acop bits must include the requested operation.
 */
function acor_allows(rule, from, access_value) {
    // A missing acor means no originator restriction, not no operation restriction; the acop bits are still checked. Evaluation order is kept: when acor does not match, acop is not touched.
    return acor_matches(rule, from) && acop_allows(rule, access_value);
}

/** Originator (acor) only. A missing acor key means no originator restriction. */
function acor_matches(rule, from) {
    if (!rule.hasOwnProperty('acor')) {
        return true;
    }

    // The originator is compared as a plain string, never as a regular expression. To allow several originators use 'all' or '*'.
    var keys = Object.keys(rule.acor || {});
    for (var i = 0; i < keys.length; i++) {
        var who = rule.acor[keys[i]];
        if (String(who) === String(from) || who === 'all' || who === '*') {
            return true;
        }
    }
    return false;
}

/** Operation bits (acop) only. A rule without acop throws a TypeError here, which becomes HTTP 500 rather than 403; acp_lint finds such ACPs and acp.validate_privileges rejects new ones. */
function acop_allows(rule, access_value) {
    return (rule.acop.toString() & access_value) == access_value;
}

/** Evaluates one privilege rule (acr entry). With several acco (context constraints) it is enough that one of them satisfies acip and actw together; no acco or an empty one means no context constraint. */
function evaluate_acr(rule, request, from, access_value, use_ra) {
    return evaluate_acr_traced(rule, request, from, access_value, use_ra).allow;
}

/** Same decision as evaluate_acr, plus which condition failed. The three gates are checked in order: a failure at acco or acor leaves acop untouched. Gates not reached are null, not false. */
function evaluate_acr_traced(rule, request, from, access_value, use_ra) {
    var acco_ok = true;

    if (rule.hasOwnProperty('acco')) {
        var acco = rule.acco;
        var keys = Object.keys(acco || {});
        if (keys.length === 0) {
            acco_ok = true;             // empty acco = no constraint
        }
        else {
            acco_ok = false;
            for (var i = 0; i < keys.length; i++) {
                var one = acco[keys[i]];
                if (acip_allows(one.acip, request, use_ra) && actw_allows(one.actw)) {
                    acco_ok = true;
                    break;
                }
            }
        }
    }

    if (!acco_ok) {
        return { allow: false, acco_ok: false, acor_ok: null, acop_ok: null };
    }

    var acor_ok = acor_matches(rule, from);
    if (!acor_ok) {
        return { allow: false, acco_ok: true, acor_ok: false, acop_ok: null };
    }

    var acop_ok = acop_allows(rule, access_value);
    return { allow: acop_ok, acco_ok: true, acor_ok: true, acop_ok: acop_ok };
}

/**
 * Decides from a list of ACP rows; a pure function without DB or callbacks, so the simulator can use the same code. The trace records why the decision was made: which ACP and rule decided, and which ACPs were not evaluated.
 *
 * @param rows         [{ri, pv, pvs}] as returned by select_acp_in
 * @param field        'pv' or 'pvs'
 * @param use_ra       whether the client IPv4 is read from the remoteaddress header first
 * @param cr_fallback  whether a rule without acr ends the decision with a creator comparison
 * @returns { code: '1'|'0'|'500-1', trace: {...} }
 */
function evaluate_acp_rows(rows, request, cr, access_value, field, use_ra, cr_fallback) {
    var from = request.headers['x-m2m-origin'];
    var trace = {
        decided_by: null,
        field: field,
        acp_ri: null,
        acr_index: null,
        cr: cr,
        from: from,
        access_value: access_value,
        order: (rows || []).map(function (r) { return r.ri; }),
        evaluated: [],
        stopped_early: false,
        not_evaluated: [],
        error: null
    };

    function rest_of(i) {
        return trace.order.slice(i + 1);
    }

    if (!rows || rows.length === 0) {
        // None of the referenced ACPs was found; only the creator passes.
        trace.decided_by = 'no_acp_row';
        return { code: (from == cr ? '1' : '0'), trace: trace };
    }

    for (var i = 0; i < rows.length; i++) {
        var ruleObj = parse_acp_rule(rows[i][field], field, rows[i].ri);
        if (ruleObj === null) {
            // One broken acp row must not fail every request that references that ACP.
            trace.evaluated.push({ ri: rows[i].ri, skipped: true, reason: 'parse_error', rules: [] });
            continue;
        }

        if (!ruleObj.hasOwnProperty('acr')) {
            trace.evaluated.push({ ri: rows[i].ri, skipped: true, reason: 'no_acr', rules: [] });
            // pv ends here with a creator comparison; pvs moves on to the next ACP.
            if (cr_fallback) {
                trace.decided_by = 'no_acr_cr';
                trace.acp_ri = rows[i].ri;
                trace.stopped_early = true;
                trace.not_evaluated = rest_of(i);
                return { code: (from == cr ? '1' : '0'), trace: trace };
            }
            continue;
        }

        var seen = { ri: rows[i].ri, skipped: false, reason: null, rules: [] };
        trace.evaluated.push(seen);

        var acr_keys = Object.keys(ruleObj.acr || {});
        for (var j = 0; j < acr_keys.length; j++) {
            var rule = ruleObj.acr[acr_keys[j]];
            try {
                var detail = evaluate_acr_traced(rule, request, from, access_value, use_ra);
                seen.rules.push({
                    i: j,
                    acor_ok: detail.acor_ok,
                    acop_ok: detail.acop_ok,
                    acco_ok: detail.acco_ok,
                    allow: detail.allow
                });
                if (detail.allow) {
                    trace.decided_by = 'acr';
                    trace.acp_ri = rows[i].ri;
                    trace.acr_index = j;
                    trace.stopped_early = i < rows.length - 1;
                    trace.not_evaluated = rest_of(i);
                    return { code: '1', trace: trace };
                }
            }
            catch (e) {
                // A rule without acop lands here; the result is 500, not 403.
                console.log('[security_check_action ' + field + '] ' + e);
                trace.decided_by = 'eval_error';
                trace.acp_ri = rows[i].ri;
                trace.acr_index = j;
                trace.error = e && e.message ? e.message : String(e);
                trace.stopped_early = true;
                trace.not_evaluated = rest_of(i);
                return { code: '500-1', trace: trace };
            }
        }
    }

    trace.decided_by = 'exhausted';
    return { code: '0', trace: trace };
}

/**
 * Decides access through the ACPs listed in acpiList, using field (pv|pvs). use_ra and cr_fallback come from FIELD[field].
 *
 * @param field  'pv' or 'pvs', from field_of(ty)
 */
function security_check_action(request, response, acpiList, cr, access_value, field, callback) {
    var use_ra = FIELD[field].use_ra;
    var cr_fallback = FIELD[field].cr_fallback;
    make_internal_ri(acpiList);
    // Stored acpi entries are already in ri form (validate_acpi normalises them at write time) and make_internal_ri folds absolute and SP-relative notations, so the list is used as is. An sri-form entry finds no row and is denied.
    var ri_list = acpiList.slice();
    db_sql.select_acp_in(request.db_connection, ri_list, function (err, results_acp) {
        if (err) {
            console.log('query error: ' + results_acp.message);
            callback('500-1', { decided_by: 'db_error', field: field, acpi: ri_list });
            return;
        }
        var verdict = evaluate_acp_rows(results_acp, request, cr, access_value,
                                        field, use_ra, cr_fallback);
        verdict.trace.acpi = ri_list;
        results_acp = null;
        callback(verdict.code, verdict.trace);
    });
}

function security_default_check_action(request, response, cr, access_value, callback) {
    // Default policy for resources without any acpi. useaccesscontrolpolicy decides what happens when no ACP applies, not whether ACP is used.
    var trace = {
        decided_by: 'default_policy',
        source: 'none',
        policy: useaccesscontrolpolicy,
        cr: cr,
        from: request.headers['x-m2m-origin'],
        cr_match: request.headers['x-m2m-origin'] == cr,
        access_value: access_value
    };

    if(useaccesscontrolpolicy == 'enable') {
        if (request.headers['x-m2m-origin'] == cr) {
            callback('1', trace);
        }
        else {
            callback('0', trace);
        }
    }
    else {
        if (request.headers['x-m2m-origin'] == cr) {
            callback('1', trace);
        }
        else {
            if (access_value & '1' || access_value & '2' || access_value & '32') {
                callback('1', trace);
            }
            else {
                callback('0', trace);
            }
        }
    }
}

/** Whether the creator passes regardless of ACP. ACPs add permissions; they never lock the creator out of its own resource. ty=1 (the ACP itself) is excluded: who may change an ACP is decided by its pvs, and the cr passed here is the target resource's creator. */
function creator_bypasses(ty, cr, from) {
    if (ty == '1') {
        return false;
    }
    // Some resources have an empty or undefined cr (acp and ae have no cr column); an empty from must not pass.
    if (!cr || !from) {
        return false;
    }
    return String(from) === String(cr);
}

exports._creator_bypasses = creator_bypasses;

/**
 * Decides access.
 *
 * callback(code, trace): the trace carries the reasoning (which ACP, which rule, what was skipped).
 *
 * ty is the target resource's type and decides three things: the creator bypass exclusion (ty 1), the field (field_of: only ty 1 uses pvs) and ancestor lookup for an empty acpi (INHERITS_ACPI).
 */
exports.check = function(request, response, ty, acpiList, access_value, cr, callback) {
    var from = request.headers['x-m2m-origin'];
    var field = field_of(ty);

    function done(code, trace) {
        var t = trace || {};
        t.ty = ty;
        t.op_value = access_value;
        // In observe mode '0' becomes '1' here; the decision itself and the trace are unchanged.
        callback(acp_observe.record_decision(request, code, t), t);
    }

    if(from == usesuperuser || from == ('/'+usesuperuser)) {
        // The superuser sees no ACP at all; this pass is not a policy check.
        done('1', { decided_by: 'superuser', from: from, cr: cr });
    }
    else if (creator_bypasses(ty, cr, from)) {
        done('1', { decided_by: 'creator', from: from, cr: cr });
    }
    else {
        if (field === 'pvs') { // the ACP itself: selfPrivileges
            var self_acp = false;
            if (acpiList.length == 0) {
                acpiList = [url.parse(request.url).pathname.split('?')[0]];
                self_acp = true;
            }
            security_check_action(request, response, acpiList, cr, access_value, field, function (code, trace) {
                var t = trace || {};
                t.path = 'pvs';
                t.self = self_acp;
                done(code, t);
            });
        }
        else if (INHERITS_ACPI[ty]) { // cnt, cin, sub: an empty acpi uses the ancestors' acpi (up to the AE)
            if (acpiList.length == 0) {
                var targetUri = request.url.split('?')[0];
                var targetUri_arr = targetUri.split('/');

                var loop_cnt = 0;
                db_sql.select_acp_cnt(request.db_connection, loop_cnt, targetUri_arr, function (err, results_acpi, found_ri) {
                    if (!err) {
                        if (results_acpi.length == 0) {
                            security_default_check_action(request, response, cr, access_value, done);
                        }
                        else {
                            security_check_action(request, response, results_acpi, cr, access_value, field, function (code, trace) {
                                var t = trace || {};
                                // Record that the decision came from an ancestor's acpi, and from which one.
                                t.source = 'inherited';
                                t.inherited_from = found_ri || null;
                                done(code, t);
                            });
                        }
                    }
                    else {
                        done('500-1', { decided_by: 'db_error', source: 'inherited' });
                    }
                });
            }
            else {
                security_check_action(request, response, acpiList, cr, access_value, field, function (code, trace) {
                    var t = trace || {};
                    t.source = 'own';
                    done(code, t);
                });
            }
        }
        else {
            if (acpiList.length == 0) {
                security_default_check_action(request, response, cr, access_value, done);
            }
            else {
                security_check_action(request, response, acpiList, cr, access_value, field, function (code, trace) {
                    var t = trace || {};
                    t.source = 'own';
                    done(code, t);
                });
            }
        }
    }
};
