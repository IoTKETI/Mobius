'use strict';
// Reason catalogue: why a result code was produced.
//
// The RSC catalogue (mobius/rsc.js) holds the result codes; each entry here binds a reason key to one of them with a message. Several reasons share one code (BAD_REQUEST alone has dozens).
//
// Keys are 'HTTP status-number', e.g. '400-8'. detail is attached only where the code alone would not tell where the reason came from; it is not sent in the response, responder.respond logs it with console.error.

var RSC = require('./rsc').RSC;
var LIMITS = require('./name_limits');   // the numbers in the length messages; change in one place when the schema widens

// Key rule: the key prefix is the HTTP status of the code. test/reason-catalog.test.js enforces it.

var REASON = {
    '400-1': { code: RSC.BAD_REQUEST, msg: "X-M2M-RI is none" },
    '400-2': { code: RSC.BAD_REQUEST, msg: "X-M2M-Origin header is Mandatory" },
    '400-3': { code: RSC.BAD_REQUEST, msg: "not supported resource type requested" },
    '400-7': { code: RSC.BAD_REQUEST, msg: "root tag of body does not match a known resource type", detail: 'parse_to_json: rootnm' },
    '400-8': { code: RSC.BAD_REQUEST, msg: "(aa, at, poa, acpi, srt, nu, mid, macp, rels, rqps, srv) attribute should be json array format" },
    '400-9': { code: RSC.BAD_REQUEST, msg: "(lbl) attribute should be json array format" },
    '400-10': { code: RSC.BAD_REQUEST, msg: "(enc.net) attribute should be json array format" },
    '400-11': { code: RSC.BAD_REQUEST, msg: "(enc) attribute should have net key as child in json format" },
    '400-12': { code: RSC.BAD_REQUEST, msg: "(pv.acr, pvs.acr) attribute should be json array format" },
    '400-13': { code: RSC.BAD_REQUEST, msg: "(pv.acr.acor, pvs.acr.acor) attribute should be json array format" },
    '400-14': { code: RSC.BAD_REQUEST, msg: "(pv.acr.acco, pvs.acr.acco) attribute should be json array format" },
    '400-15': { code: RSC.BAD_REQUEST, msg: "(pv.acr.acco.acip.ipv4, pvs.acr.acco.acip.ipv4) attribute should be json array format" },
    '400-16': { code: RSC.BAD_REQUEST, msg: "(pv.acr.acco.acip.ipv6, pvs.acr.acco.acip.ipv6) attribute should be json array format" },
    '400-17': { code: RSC.BAD_REQUEST, msg: "(pv.acr.acco.actw, pvs.acr.acco.actw) attribute should be json array format" },
    '400-18': { code: RSC.BAD_REQUEST, msg: "(uds, cas) attribute should be json array format" },
    // POST without ty in Content-Type.
    '400-19': { code: RSC.BAD_REQUEST, msg: "POST must carry ty in Content-Type", detail: 'check_post_content_type' },
    '400-20': { code: RSC.BAD_REQUEST, msg: "Content-Type header is required", detail: 'check_notification' },
    '400-21': { code: RSC.BAD_REQUEST, msg: "X-M2M-RTU is none" },
    '400-22': { code: RSC.BAD_REQUEST, msg: "'Not Present' attribute" },
    '400-23': { code: RSC.BAD_REQUEST, msg: ".acr must have values" },
    '400-24': { code: RSC.BAD_REQUEST, msg: "nu must have values" },
    '400-25': { code: RSC.BAD_REQUEST, msg: "attribute is not defined" },
    '400-26': { code: RSC.BAD_REQUEST, msg: "attribute is 'Mandatory' attribute" },
    '400-27': { code: RSC.BAD_REQUEST, msg: "expiration time is in the past" },
    '400-29': { code: RSC.BAD_REQUEST, msg: "mni is a negative value" },
    '400-30': { code: RSC.BAD_REQUEST, msg: "mbs is a negative value" },
    '400-31': { code: RSC.BAD_REQUEST, msg: "mia is a negative value" },
    '400-32': { code: RSC.BAD_REQUEST, msg: "contentInfo(cnf) format does not match" },
    '400-33': { code: RSC.MAX_NUMBER_OF_MEMBER_EXCEEDED, msg: "MAX_NUMBER_OF_MEMBER_EXCEEDED" },
    '400-34': { code: RSC.MEMBER_TYPE_INCONSISTENT, msg: "can not create group because csy is ABANDON_GROUP when MEMBER_TYPE_INCONSISTENT" },
    '400-35': { code: RSC.BAD_REQUEST, msg: "mgmtDefinition does not match the mgmtObj resource" },
    '400-36': { code: RSC.BAD_REQUEST, msg: "resource type is not supported for create" },
    '400-40': { code: RSC.BAD_REQUEST, msg: "body is empty" },
    '400-42': { code: RSC.BAD_REQUEST, msg: "ty does not match the body" },
    '400-43': { code: RSC.BAD_REQUEST, msg: "rcn or fu query is not supported at POST request" },
    '400-44': { code: RSC.BAD_REQUEST, msg: "rcn or fu query is not supported at GET request" },
    '400-45': { code: RSC.BAD_REQUEST, msg: "rcn or fu query is not supported at PUT request" },
    '400-46': { code: RSC.BAD_REQUEST, msg: "rcn or fu query is not supported at DELETE request" },
    '400-51': { code: RSC.BAD_REQUEST, msg: "requested mgmtObj does not match the body content type" },
    '400-52': { code: RSC.BAD_REQUEST, msg: "resource type is not supported for update" },
    '400-53': { code: RSC.BAD_REQUEST, msg: "this resource of mgmtObj is not supported" },
    '400-54': { code: RSC.BAD_REQUEST, msg: "cdn of flexContainer does not match the fcnt resource" },
    // Content-Type: application/json;ty with no value after ty.
    '400-55': { code: RSC.BAD_REQUEST, msg: "ty parameter of Content-Type has no value" },

    // ACP guards. Invalid ACP values are rejected at write time; msg is static, the offending position goes to detail (the admin console calls acp.validate_privileges directly for it).
    '400-56': { code: RSC.BAD_REQUEST, msg: "privileges must be a JSON object", detail: 'acp: privileges shape' },
    '400-57': { code: RSC.BAD_REQUEST, msg: "acop must be an integer from 0 to 63", detail: 'acp: acop' },
    '400-58': { code: RSC.BAD_REQUEST, msg: "acor entries must be strings", detail: 'acp: acor' },
    '400-59': { code: RSC.BAD_REQUEST, msg: "actw must have six cron fields (sec min hour day month weekday)", detail: 'acp: actw' },
    '400-60': { code: RSC.BAD_REQUEST, msg: "acip cannot carry both ipv4 and ipv6", detail: 'acp: acip' },
    '400-61': { code: RSC.BAD_REQUEST, msg: "acpi entries must be strings", detail: 'acpi: element type' },
    '400-62': { code: RSC.BAD_REQUEST, msg: "acpi is too long to store (200 characters when serialized)", detail: 'acpi: length' },
    '400-63': { code: RSC.BAD_REQUEST, msg: "acpi refers to an accessControlPolicy that does not exist", detail: 'acpi: dangling' },

    // This CSE handles JSON only; an xml/cbor request body is rejected here. Responses are always JSON regardless of Accept. detail records the format that was sent.
    '400-64': { code: RSC.BAD_REQUEST, msg: "only json is supported; send the request body as application/json", detail: 'json_only' },
    // The cty (contentType) filter is not supported. It compares against cin.cnf, which holds only what clients sent (mostly empty) and has no index, so the answer would be wrong and slow. Restoring it requires filling cnf first, then an index, then removing this gate.
    '400-65': { code: RSC.BAD_REQUEST,
                msg: "the cty filter is not supported by this CSE",
                detail: 'cty: unsupported filter' },
    // rn is a reserved word (la, ol, latest, oldest); an invalid attribute value, hence BAD_REQUEST.
    '400-66': { code: RSC.BAD_REQUEST, msg: "resource name can not use that is keyword" },
    // The body is cut before it is fully received. The actual limit is logged (detail) but not sent in the response.
    '413-1':  { code: RSC.CONTENT_TOO_LARGE, msg: "request body is too large", detail: 'body_limit' },

    '403-1': { code: RSC.AE_NOT_ALLOWED, msg: "AE-ID is not allowed" },
    '403-2': { code: RSC.TARGET_NOT_SUBSCRIBABLE, msg: "this resource type cannot be created under the parent resource" },
    '403-3': { code: RSC.ACCESS_DENIED, msg: "ACCESS DENIED" },
    '403-4': { code: RSC.AE_NOT_ALLOWED, msg: "APP-ID in AE is not allowed" },
    '403-5': { code: RSC.AE_NOT_ALLOWED, msg: "ACCESS DENIED (fanOutPoint)", detail: 'fopt: access check failed' },
    '403-6': { code: RSC.NO_MEMBERS, msg: "memberID in parent group is empty" },

    // No detail on purpose: this is the most common 404 in normal operation and detail would log every one of them.
    '404-1': { code: RSC.NOT_FOUND, msg: "resource does not exist" },
    '404-3': { code: RSC.NOT_FOUND, msg: "CSEBase was not found" },
    '404-4': { code: RSC.NOT_FOUND, msg: "group resource does not exist" },
    '404-5': { code: RSC.NOT_FOUND, msg: "response did not come from fanOutPoint" },
    // remoteCSE has an empty poa, so there is nowhere to forward to (TS-0009: 5103/404).
    '404-9': { code: RSC.TARGET_NOT_REACHABLE, msg: "remoteCSE has no point of access" },
    // Upstream did not answer during remoteCSE forwarding (connection failure, timeout, body not received).
    '404-10': { code: RSC.TARGET_NOT_REACHABLE, msg: "remoteCSE did not respond" },

    '405-1': { code: RSC.OPERATION_NOT_ALLOWED, msg: "CSEBase can not be created by others" },
    '405-3': { code: RSC.OPERATION_NOT_ALLOWED, msg: "requested resource type is not supported" },
    '405-4': { code: RSC.OPERATION_NOT_ALLOWED, msg: "rt query is not supported" },
    '405-5': { code: RSC.OPERATION_NOT_ALLOWED, msg: "creating this resource is not supported" },
    '405-6': { code: RSC.OPERATION_NOT_ALLOWED, msg: "disr attribute is true" },
    '405-7': { code: RSC.OPERATION_NOT_ALLOWED, msg: "Update cin is not supported" },
    '405-8': { code: RSC.OPERATION_NOT_ALLOWED, msg: "req is not supported when put request" },
    '405-9': { code: RSC.OPERATION_NOT_ALLOWED, msg: "csebase is not supported when put request" },
    // la/ol cannot be the target of POST/PUT; unsupported resource.
    '405-13': { code: RSC.OPERATION_NOT_ALLOWED, msg: "can not use post, put method at latest resource" },
    '405-14': { code: RSC.OPERATION_NOT_ALLOWED, msg: "can not use post, put method at oldest resource" },
    '405-15': { code: RSC.OPERATION_NOT_ALLOWED, msg: "requested resource is not supported" },

    '406-1': { code: RSC.NOT_ACCEPTABLE, msg: "can not create cin because mni value is zero" },
    '406-2': { code: RSC.NOT_ACCEPTABLE, msg: "can not create cin because mbs value is zero" },
    '406-3': { code: RSC.NOT_ACCEPTABLE, msg: "cs is exceed mbs" },

    '409-5': { code: RSC.ALREADY_EXISTS, msg: "resource already exists" },
    '409-6': { code: RSC.AEI_DUPLICATED, msg: "aei is already registered", detail: 'create_action: aei duplicate' },


    '500-1': { code: RSC.INTERNAL_SERVER_ERROR, msg: "database error" },
    '500-2': { code: RSC.SUBSCRIPTION_VERIFICATION_INITIATION_FAILED, msg: "SUBSCRIPTION_VERIFICATION_INITIATION_FAILED" },
    '500-4': { code: RSC.INTERNAL_SERVER_ERROR, msg: "resource could not be created", detail: 'create_action: insert failed' },
    '500-5': { code: RSC.INTERNAL_SERVER_ERROR, msg: "DB Error : No Connection Pool" },
    // Discovery hit the statement time limit. Not a server fault but a request scope the server cannot handle; the same request would fail again, so it is a 4xx and msg says what to narrow. Filters that join cin (sza / szb) can reach this.
    '400-67': { code: RSC.BAD_REQUEST,
                msg: "discovery scope too large — narrow the target path, " +
                     "add a ty filter, or use cra/crb to bound the time range",
                detail: 'search_lookup: statement timeout' },
    // Length limits at creation: this CSE's storage widths for lookup.rn, ri and sri. Messages are built from the constants (mobius/name_limits.js).
    '400-68': { code: RSC.BAD_REQUEST,
                msg: "resource name exceeds " + LIMITS.RN_MAX + " characters (this CSE stores names up to " + LIMITS.RN_MAX + ")" },
    '400-69': { code: RSC.BAD_REQUEST,
                msg: "resource path exceeds " + LIMITS.PATH_MAX + " characters (this CSE stores structured paths up to " +
                     LIMITS.PATH_MAX + " — the tree is too deep or the names too long)" },
    '400-70': { code: RSC.BAD_REQUEST,
                msg: "AE-ID exceeds " + LIMITS.ID_MAX + " characters (this CSE stores identifiers up to " + LIMITS.ID_MAX + ")" },
    // Upstream (remote CSE or AE) returned a non-JSON body. This CSE only emits JSON, so the body is not relayed; detail records the received content type.
    '500-7': { code: RSC.INTERNAL_SERVER_ERROR,
               msg: "upstream returned a body this CSE cannot relay",
               detail: 'relay: non-json content-type' },
    // The result object (out) handed to the settler is malformed: unknown rsc name or shape, or body assembly threw. A programming error in the producer, confined to a 500 for this request; details are in the [settle] log.
    '500-8': { code: RSC.INTERNAL_SERVER_ERROR,
               msg: "internal error",
               detail: 'settle.done: bad result object' },
    // The message does not name a backend: the reason is that the configured adapter declares supportedResourceTypes and the requested type is not in it.
    '501-2': { code: RSC.NOT_IMPLEMENTED,
               msg: "this resource type is not supported by the configured storage backend" },
    // remoteCSE forwarding with a scheme this CSE does not implement.
    '501-3': { code: RSC.NOT_IMPLEMENTED, msg: "forwarding with mqtt is not supported" },
    '501-4': { code: RSC.NOT_IMPLEMENTED, msg: "protocol in poa of csr is not supported" }
};

// Builds the { key: [status, rsc, msg] } table shape used by app.js callers. status is a string.
function toLegacyTable() {
    var out = {};
    Object.keys(REASON).forEach(function (k) {
        var r = REASON[k];
        out[k] = [String(r.code.http), r.code.rsc, r.msg];
    });
    return out;
}

// Returns one reason, or null when the key is unknown (the caller decides).
function get(key) {
    return Object.prototype.hasOwnProperty.call(REASON, key) ? REASON[key] : null;
}

// Self-check run once at boot. Returns the list of problems (empty when fine). Only in-memory invariants; filesystem-wide checks belong to test/reason-catalog.test.js.
function selfCheck() {
    var problems = require('./rsc').assertComplete();
    var catalog = require('./rsc').RSC;

    var byMsg = {};
    Object.keys(REASON).forEach(function (k) {
        var r = REASON[k];

        // code must be an actual catalogue entry
        var known = false;
        for (var c in catalog) {
            if (Object.prototype.hasOwnProperty.call(catalog, c) && catalog[c] === r.code) {
                known = true;
                break;
            }
        }
        if (!known) { problems.push(k + ': code 가 RSC 카탈로그 항목이 아니다'); }

        if (typeof r.msg !== 'string' || r.msg === '') {
            problems.push(k + ': msg 가 비었거나 문자열이 아니다');
        }
        else {
            // The result code prefix is carried by rsc; the message must not repeat it.
            if (/^[A-Z_ ]{3,}:/.test(r.msg)) { problems.push(k + ': 문구에 접두어가 있다 — ' + r.msg); }
            // Internal identifiers must not reach the client; they belong in detail.
            if (/\[[A-Za-z_.]+\]/.test(r.msg) || /\([a-z]+_[a-z_]+\)/.test(r.msg)) {
                problems.push(k + ': 문구에 내부 식별자가 있다 — ' + r.msg);
            }
            if (!byMsg[r.msg]) { byMsg[r.msg] = []; }
            byMsg[r.msg].push(k);
        }

        if (r.detail !== undefined && typeof r.detail !== 'string') {
            problems.push(k + ': detail 이 문자열이 아니다');
        }
    });

    Object.keys(byMsg).forEach(function (m) {
        if (byMsg[m].length > 1) {
            problems.push('같은 문구를 쓰는 사유가 여럿이다: ' + byMsg[m].join(', ') + ' — ' + m);
        }
    });

    return problems;
}

// Logs the self-check result. Problems never stop the boot. Called once in the cluster primary.
function reportSelfCheck() {
    var problems = selfCheck();
    if (problems.length === 0) {
        console.log('[reason] 자체 점검 통과 — 사유 ' + Object.keys(REASON).length + '개');
        return 0;
    }
    console.error('[reason] 자체 점검에서 문제 ' + problems.length + '건 (기동은 계속한다)');
    problems.forEach(function (p) { console.error('  - ' + p); });
    return problems.length;
}

module.exports = {
    REASON: REASON,
    toLegacyTable: toLegacyTable,
    get: get,
    selfCheck: selfCheck,
    reportSelfCheck: reportSelfCheck
};
