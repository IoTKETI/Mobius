'use strict';
//
// 사유 카탈로그 — 무엇이 잘못됐는가
//
// RSC 카탈로그(mobius/rsc.js)가 "어떤 결과 코드인가"를 담는다면, 여기는
// "왜 그 코드가 났는가"를 담는다. 한 결과 코드를 여러 사유가 공유한다
// (BAD_REQUEST 하나에 사유 48개).
//
// ─────────────────────────────────────────────────────────────────────────
// 키는 아직 '400-8' 같은 옛 이름 그대로다. 의미 있는 이름으로 바꾸는 것은
// 별도 단계에서 한다 — 구조 변경과 개명을 같이 하면 회귀가 났을 때 원인을
// 가릴 수 없다.
//
// 문구도 아직 손대지 않는다. 접두어('BAD REQUEST: ' 등)가 msg 에 그대로
// 들어 있고, 오타와 이스케이프 잔재도 원본 그대로다. 값 보존이 우선이다.
//
// 이 파일은 생성물이다:  node tools/response-golden/gen-reason.js > mobius/reason.js
// ─────────────────────────────────────────────────────────────────────────

var RSC = require('./rsc').RSC;

var REASON = {
    '301-3': { code: RSC.OPERATION_NOT_ALLOWED, msg: "forwarding with mqtt is not supported" },
    '301-4': { code: RSC.OPERATION_NOT_ALLOWED, msg: "protocol in poa of csr is not supported" },

    '400-1': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: X-M2M-RI is none" },
    '400-2': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: X-M2M-Origin header is Mandatory" },
    '400-3': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: not supported resource type requested" },
    '400-4': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: not parse your body" },
    '400-5': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: request body is not valid XML", detail: 'parse_to_json: xml' },
    '400-6': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: request body is not valid CBOR", detail: 'parse_to_json: cbor' },
    '400-7': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: root tag of body does not match a known resource type", detail: 'parse_to_json: rootnm' },
    '400-8': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (aa, at, poa, acpi, srt, nu, mid, macp, rels, rqps, srv) attribute should be json array format" },
    '400-9': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (lbl) attribute should be json array format" },
    '400-10': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (enc.net) attribute should be json array format" },
    '400-11': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (enc) attribute should have net key as child in json format" },
    '400-12': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (pv.acr, pvs.acr) attribute should be json array format" },
    '400-13': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (pv.acr.acor, pvs.acr.acor) attribute should be json array format" },
    '400-14': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (pv.acr.acco, pvs.acr.acco) attribute should be json array format" },
    '400-15': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (pv.acr.acco.acip.ipv4, pvs.acr.acco.acip.ipv4) attribute should be json array format" },
    '400-16': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (pv.acr.acco.acip.ipv6, pvs.acr.acco.acip.ipv6) attribute should be json array format" },
    '400-17': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (pv.acr.acco.actw, pvs.acr.acco.actw) attribute should be json array format" },
    '400-18': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: (uds, cas) attribute should be json array format" },
    '400-19': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: POST without ty in Content-Type must carry a notification body", detail: 'check_notification' },
    '400-20': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: Content-Type header is required", detail: 'check_notification' },
    '400-21': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: X-M2M-RTU is none" },
    '400-22': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: 'Not Present' attribute" },
    '400-23': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: .acr must have values" },
    '400-24': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: nu must have values" },
    '400-25': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: attribute is not defined" },
    '400-26': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: attribute is 'Mandatory' attribute" },
    '400-27': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: expiration time is before now" },
    '400-28': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: ASN CSE can not have child CSE (remoteCSE)" },
    '400-29': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: mni is negative value" },
    '400-30': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: mbs is negative valuee" },
    '400-31': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: mia is negative value" },
    '400-32': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: contentInfo(cnf) format is not match" },
    '400-33': { code: RSC.MAX_NUMBER_OF_MEMBER_EXCEEDED, msg: "MAX_NUMBER_OF_MEMBER_EXCEEDED" },
    '400-34': { code: RSC.MEMBER_TYPE_INCONSISTENT, msg: "can not create group because csy is ABANDON_GROUP when MEMBER_TYPE_INCONSISTENT" },
    '400-35': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: mgmtDefinition is not match with mgmtObj resource" },
    '400-36': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: ty does not supported" },
    '400-37': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: transaction resource could not create" },
    '400-40': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: body is empty" },
    '400-41': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST" },
    '400-42': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: ty is different with body" },
    '400-43': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: rcn or fu query is not supported at POST request" },
    '400-44': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: rcn or fu query is not supported at GET request" },
    '400-45': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: rcn or fu query is not supported at PUT request" },
    '400-46': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: rcn or fu query is not supported at DELETE request" },
    '400-47': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: protocol in poa of ae is not supported" },
    '400-50': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: state of transaction is mismatch" },
    '400-51': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: mgmtObj requested is not match with content type of body" },
    '400-52': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: ty does not supported" },
    '400-53': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: this resource of mgmtObj is not supported" },
    '400-54': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST: cdn of flexCotainer is not match with fcnt resource" },

    '403-1': { code: RSC.AE_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: AE-ID is not allowed" },
    '403-2': { code: RSC.TARGET_NOT_SUBSCRIBABLE, msg: "TARGET_NOT_SUBSCRIBABLE: request ty creating can not create under parent resource" },
    '403-3': { code: RSC.ACCESS_DENIED, msg: "ACCESS DENIED" },
    '403-4': { code: RSC.AE_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: APP-ID in AE is not allowed" },
    '403-5': { code: RSC.AE_NOT_ALLOWED, msg: "ACCESS DENIED (fanOutPoint)", detail: 'fopt: access check failed' },
    '403-6': { code: RSC.NO_MEMBERS, msg: "NO_MEMBERS: memberID in parent group is empty" },

    '404-1': { code: RSC.NOT_FOUND, msg: "resource does not exist (get_target_url)" },
    '404-2': { code: RSC.NOT_FOUND, msg: "RESOURCE DOES NOT FOUND" },
    '404-3': { code: RSC.NOT_FOUND, msg: "csebase is not found" },
    '404-4': { code: RSC.NOT_FOUND, msg: "group resource does not exist" },
    '404-5': { code: RSC.NOT_FOUND, msg: "response is not from fanOutPoint" },
    '404-6': { code: RSC.NOT_FOUND, msg: "AE for notify is not found" },
    '404-7': { code: RSC.NOT_FOUND, msg: "AE for notify does not exist" },

    '405-1': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: CSEBase can not be created by others" },
    '405-2': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: req is not supported when post request" },
    '405-3': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: we do not support resource type requested" },
    '405-4': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: rt query is not supported" },
    '405-5': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: we do not support to create resource" },
    '405-6': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION NOT ALLOWED: disr attribute is true" },
    '405-7': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION NOT ALLOWED: Update cin is not supported" },
    '405-8': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION NOT ALLOWED: req is not supported when put request" },
    '405-9': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: csebase is not supported when put request" },
    '405-10': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: notification with mqtt is not supported" },
    '405-11': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: notification with ws is not supported" },
    '405-12': { code: RSC.OPERATION_NOT_ALLOWED, msg: "OPERATION_NOT_ALLOWED: notification with coap is not supported" },

    '406-1': { code: RSC.NOT_ACCEPTABLE, msg: "NOT_ACCEPTABLE: can not create cin because mni value is zero" },
    '406-2': { code: RSC.NOT_ACCEPTABLE, msg: "NOT_ACCEPTABLE: can not create cin because mbs value is zero" },
    '406-3': { code: RSC.NOT_ACCEPTABLE, msg: "NOT_ACCEPTABLE: cs is exceed mbs" },

    '409-1': { code: RSC.CONFLICT_OPERATION, msg: "can not use post, put method at latest resource" },
    '409-2': { code: RSC.CONFLICT_OPERATION, msg: "can not use post, put method at oldest resource" },
    '409-3': { code: RSC.CONFLICT_OPERATION, msg: "resource name can not use that is keyword" },
    '409-4': { code: RSC.CONFLICT_OPERATION, msg: "resource requested is not supported" },
    '409-5': { code: RSC.ALREADY_EXISTS, msg: "resource is already exist" },
    '409-6': { code: RSC.AEI_DUPLICATED, msg: "aei is already registered", detail: 'create_action: aei duplicate' },

    '423-1': { code: RSC.LOCKED, msg: "LOCKED: this resource was occupied by others" },

    '500-1': { code: RSC.INTERNAL_SERVER_ERROR, msg: "database error" },
    '500-2': { code: RSC.SUBSCRIPTION_VERIFICATION_INITIATION_FAILED, msg: "SUBSCRIPTION_VERIFICATION_INITIATION_FAILED" },
    '500-4': { code: RSC.INTERNAL_SERVER_ERROR, msg: "resource could not be created", detail: 'create_action: insert failed' },
    '500-5': { code: RSC.INTERNAL_SERVER_ERROR, msg: "DB Error : No Connection Pool" },

    '501-1': { code: RSC.NOT_IMPLEMENTED, msg: "response with hierarchical resource structure mentioned in onem2m spec is not supported instead all the requested resources will be returned !" },
    '501-2': { code: RSC.NOT_IMPLEMENTED, msg: "NOT_IMPLEMENTED: this resource type is not supported by the SQLite backend" }
};

// app.js 가 쓰던 { key: [status, rsc, msg] } 형태를 그대로 만들어 준다.
// 호출부 60곳(직접 인덱싱 47 + 래퍼 13)이 바뀌지 않고 동작한다.
// status 는 문자열이어야 한다 — 기존 표가 '400' 처럼 문자열이었다.
function toLegacyTable() {
    var out = {};
    Object.keys(REASON).forEach(function (k) {
        var r = REASON[k];
        out[k] = [String(r.code.http), r.code.rsc, r.msg];
    });
    return out;
}

// 사유 하나를 꺼낸다. 없으면 null (호출부가 판단한다).
function get(key) {
    return Object.prototype.hasOwnProperty.call(REASON, key) ? REASON[key] : null;
}

module.exports = {
    REASON: REASON,
    toLegacyTable: toLegacyTable,
    get: get
};
