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
// 처음에는 app.js 의 resultStatusCode 리터럴에서 기계로 만들었다
// (tools/response-golden/gen-reason.js). 그 리터럴은 이제 없으므로 생성기는
// 더 이상 돌지 않는다 — 이 파일이 원본이고, 손으로 유지한다.
// 생성기는 값이 어디서 왔는지 남기는 근거로만 남겨 둔다.
//
// detail 은 "코드만 봐서는 어디서 났는지 모를 때" 만 붙인다. 응답 본문에는
// 나가지 않고 responder.respond 가 console.error 로 찍는다. 흔한 사유에 붙이면
// 정상 트래픽이 에러 로그를 채운다 — 404-1 이 실제로 그랬다.
// ─────────────────────────────────────────────────────────────────────────

var RSC = require('./rsc').RSC;

var REASON = {
    '301-3': { code: RSC.OPERATION_NOT_ALLOWED, msg: "forwarding with mqtt is not supported" },
    '301-4': { code: RSC.OPERATION_NOT_ALLOWED, msg: "protocol in poa of csr is not supported" },
    // poa 가 비어 있는 경우. 예전에는 이 상황에서 콜백이 아예 불리지 않아
    // 요청이 매달렸다. 301-4 로 뭉뚱그리면 "프로토콜이 뭐길래" 를 찾게 되므로
    // 사유를 따로 둔다. poa 는 미지정 시 [] 가 기본값이라 드물지 않다.
    '301-5': { code: RSC.OPERATION_NOT_ALLOWED, msg: "remoteCSE has no point of access" },

    '400-1': { code: RSC.BAD_REQUEST, msg: "X-M2M-RI is none" },
    '400-2': { code: RSC.BAD_REQUEST, msg: "X-M2M-Origin header is Mandatory" },
    '400-3': { code: RSC.BAD_REQUEST, msg: "not supported resource type requested" },
    '400-5': { code: RSC.BAD_REQUEST, msg: "request body is not valid XML", detail: 'parse_to_json: xml' },
    '400-6': { code: RSC.BAD_REQUEST, msg: "request body is not valid CBOR", detail: 'parse_to_json: cbor' },
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
    '400-19': { code: RSC.BAD_REQUEST, msg: "POST without ty in Content-Type must carry a notification body", detail: 'check_notification' },
    '400-20': { code: RSC.BAD_REQUEST, msg: "Content-Type header is required", detail: 'check_notification' },
    '400-21': { code: RSC.BAD_REQUEST, msg: "X-M2M-RTU is none" },
    '400-22': { code: RSC.BAD_REQUEST, msg: "'Not Present' attribute" },
    '400-23': { code: RSC.BAD_REQUEST, msg: ".acr must have values" },
    '400-24': { code: RSC.BAD_REQUEST, msg: "nu must have values" },
    '400-25': { code: RSC.BAD_REQUEST, msg: "attribute is not defined" },
    '400-26': { code: RSC.BAD_REQUEST, msg: "attribute is 'Mandatory' attribute" },
    '400-27': { code: RSC.BAD_REQUEST, msg: "expiration time is in the past" },
    '400-28': { code: RSC.BAD_REQUEST, msg: "ASN CSE can not have child CSE (remoteCSE)" },
    '400-29': { code: RSC.BAD_REQUEST, msg: "mni is a negative value" },
    '400-30': { code: RSC.BAD_REQUEST, msg: "mbs is a negative value" },
    '400-31': { code: RSC.BAD_REQUEST, msg: "mia is a negative value" },
    '400-32': { code: RSC.BAD_REQUEST, msg: "contentInfo(cnf) format does not match" },
    '400-33': { code: RSC.MAX_NUMBER_OF_MEMBER_EXCEEDED, msg: "MAX_NUMBER_OF_MEMBER_EXCEEDED" },
    '400-34': { code: RSC.MEMBER_TYPE_INCONSISTENT, msg: "can not create group because csy is ABANDON_GROUP when MEMBER_TYPE_INCONSISTENT" },
    '400-35': { code: RSC.BAD_REQUEST, msg: "mgmtDefinition does not match the mgmtObj resource" },
    '400-36': { code: RSC.BAD_REQUEST, msg: "resource type is not supported for create" },
    '400-37': { code: RSC.BAD_REQUEST, msg: "transaction resource could not be created" },
    '400-40': { code: RSC.BAD_REQUEST, msg: "body is empty" },
    '400-41': { code: RSC.BAD_REQUEST, msg: "BAD REQUEST" },
    '400-42': { code: RSC.BAD_REQUEST, msg: "ty does not match the body" },
    '400-43': { code: RSC.BAD_REQUEST, msg: "rcn or fu query is not supported at POST request" },
    '400-44': { code: RSC.BAD_REQUEST, msg: "rcn or fu query is not supported at GET request" },
    '400-45': { code: RSC.BAD_REQUEST, msg: "rcn or fu query is not supported at PUT request" },
    '400-46': { code: RSC.BAD_REQUEST, msg: "rcn or fu query is not supported at DELETE request" },
    '400-47': { code: RSC.BAD_REQUEST, msg: "protocol in poa of ae is not supported" },
    '400-50': { code: RSC.BAD_REQUEST, msg: "transaction state does not match" },
    '400-51': { code: RSC.BAD_REQUEST, msg: "requested mgmtObj does not match the body content type" },
    '400-52': { code: RSC.BAD_REQUEST, msg: "resource type is not supported for update" },
    '400-53': { code: RSC.BAD_REQUEST, msg: "this resource of mgmtObj is not supported" },
    '400-54': { code: RSC.BAD_REQUEST, msg: "cdn of flexContainer does not match the fcnt resource" },
    // Content-Type: application/json;ty 처럼 ty 에 값이 없는 경우.
    // 예전에는 ty_arr[1] 이 undefined 인 채 .replace 를 불러 워커가 죽었다.
    '400-55': { code: RSC.BAD_REQUEST, msg: "ty parameter of Content-Type has no value" },

    // ── ACP 가드레일 ──────────────────────────────────────────────────
    // 잘못된 ACP 는 조용히 저장됐다가 나중에 403 이나 500 으로 나타난다.
    // 그때는 어느 값이 문제였는지 알 방법이 없으므로 쓰는 시점에 막는다.
    // msg 는 정적이라 어느 원소가 문제인지 담지 못한다 — 그건 detail 로
    // 로그에만 남고, 관리 콘솔은 acp.validate_privileges 를 직접 불러 위치를 얻는다.
    '400-56': { code: RSC.BAD_REQUEST, msg: "privileges must be a JSON object", detail: 'acp: privileges shape' },
    '400-57': { code: RSC.BAD_REQUEST, msg: "acop must be an integer from 0 to 63", detail: 'acp: acop' },
    '400-58': { code: RSC.BAD_REQUEST, msg: "acor entries must be strings", detail: 'acp: acor' },
    '400-59': { code: RSC.BAD_REQUEST, msg: "actw must have six cron fields (sec min hour day month weekday)", detail: 'acp: actw' },
    '400-60': { code: RSC.BAD_REQUEST, msg: "acip cannot carry both ipv4 and ipv6", detail: 'acp: acip' },
    '400-61': { code: RSC.BAD_REQUEST, msg: "acpi entries must be strings", detail: 'acpi: element type' },
    '400-62': { code: RSC.BAD_REQUEST, msg: "acpi is too long to store (200 characters when serialized)", detail: 'acpi: length' },
    '400-63': { code: RSC.BAD_REQUEST, msg: "acpi refers to an accessControlPolicy that does not exist", detail: 'acpi: dangling' },

    '403-1': { code: RSC.AE_NOT_ALLOWED, msg: "AE-ID is not allowed" },
    '403-2': { code: RSC.TARGET_NOT_SUBSCRIBABLE, msg: "this resource type cannot be created under the parent resource" },
    '403-3': { code: RSC.ACCESS_DENIED, msg: "ACCESS DENIED" },
    '403-4': { code: RSC.AE_NOT_ALLOWED, msg: "APP-ID in AE is not allowed" },
    '403-5': { code: RSC.AE_NOT_ALLOWED, msg: "ACCESS DENIED (fanOutPoint)", detail: 'fopt: access check failed' },
    '403-6': { code: RSC.NO_MEMBERS, msg: "memberID in parent group is empty" },

    // detail 을 일부러 두지 않는다. 이 사유는 정상 운영에서 가장 흔한 404 이고,
    // responder.respond 가 detail 이 있으면 console.error 를 찍기 때문에
    // 평범한 404 마다 에러 로그가 쌓였다. 어느 함수가 냈는지는 코드를 보면
    // 바로 알 수 있어(get_target_url 한 곳뿐) 진단에 detail 이 필요 없다.
    '404-1': { code: RSC.NOT_FOUND, msg: "resource does not exist" },
    '404-2': { code: RSC.NOT_FOUND, msg: "RESOURCE DOES NOT FOUND" },
    '404-3': { code: RSC.NOT_FOUND, msg: "CSEBase was not found" },
    '404-4': { code: RSC.NOT_FOUND, msg: "group resource does not exist" },
    '404-5': { code: RSC.NOT_FOUND, msg: "response did not come from fanOutPoint" },
    '404-6': { code: RSC.NOT_FOUND, msg: "AE for notification was not found" },
    '404-7': { code: RSC.NOT_FOUND, msg: "AE for notification does not exist" },
    // AE 는 찾았는데 poa 가 비어 알림을 보낼 곳이 없는 경우.
    // 404-6 은 "AE 를 못 찾았다" 라서 원인을 반대로 짚게 한다.
    '404-8': { code: RSC.NOT_FOUND, msg: "AE for notification has no point of access" },

    '405-1': { code: RSC.OPERATION_NOT_ALLOWED, msg: "CSEBase can not be created by others" },
    '405-2': { code: RSC.OPERATION_NOT_ALLOWED, msg: "req is not supported when post request" },
    '405-3': { code: RSC.OPERATION_NOT_ALLOWED, msg: "requested resource type is not supported" },
    '405-4': { code: RSC.OPERATION_NOT_ALLOWED, msg: "rt query is not supported" },
    '405-5': { code: RSC.OPERATION_NOT_ALLOWED, msg: "creating this resource is not supported" },
    '405-6': { code: RSC.OPERATION_NOT_ALLOWED, msg: "disr attribute is true" },
    '405-7': { code: RSC.OPERATION_NOT_ALLOWED, msg: "Update cin is not supported" },
    '405-8': { code: RSC.OPERATION_NOT_ALLOWED, msg: "req is not supported when put request" },
    '405-9': { code: RSC.OPERATION_NOT_ALLOWED, msg: "csebase is not supported when put request" },
    '405-10': { code: RSC.OPERATION_NOT_ALLOWED, msg: "notification with mqtt is not supported" },
    '405-11': { code: RSC.OPERATION_NOT_ALLOWED, msg: "notification with ws is not supported" },
    '405-12': { code: RSC.OPERATION_NOT_ALLOWED, msg: "notification with coap is not supported" },

    '406-1': { code: RSC.NOT_ACCEPTABLE, msg: "can not create cin because mni value is zero" },
    '406-2': { code: RSC.NOT_ACCEPTABLE, msg: "can not create cin because mbs value is zero" },
    '406-3': { code: RSC.NOT_ACCEPTABLE, msg: "cs is exceed mbs" },

    '409-1': { code: RSC.CONFLICT_OPERATION, msg: "can not use post, put method at latest resource" },
    '409-2': { code: RSC.CONFLICT_OPERATION, msg: "can not use post, put method at oldest resource" },
    '409-3': { code: RSC.CONFLICT_OPERATION, msg: "resource name can not use that is keyword" },
    '409-4': { code: RSC.CONFLICT_OPERATION, msg: "requested resource is not supported" },
    '409-5': { code: RSC.ALREADY_EXISTS, msg: "resource already exists" },
    '409-6': { code: RSC.AEI_DUPLICATED, msg: "aei is already registered", detail: 'create_action: aei duplicate' },

    '423-1': { code: RSC.LOCKED, msg: "resource is locked by another request" },

    '500-1': { code: RSC.INTERNAL_SERVER_ERROR, msg: "database error" },
    '500-2': { code: RSC.SUBSCRIPTION_VERIFICATION_INITIATION_FAILED, msg: "SUBSCRIPTION_VERIFICATION_INITIATION_FAILED" },
    '500-4': { code: RSC.INTERNAL_SERVER_ERROR, msg: "resource could not be created", detail: 'create_action: insert failed' },
    '500-5': { code: RSC.INTERNAL_SERVER_ERROR, msg: "DB Error : No Connection Pool" },
    // 탐색이 문장 상한에 걸린 경우. DB 고장이 아니라 "이 범위를 감당 못 한다" 다.
    // 예전에는 500 "database error" 로 뭉개져서 호출자가 무엇을 고쳐야 할지
    // 알 수 없었다 — 30초를 기다린 끝에 받는 응답이 그것뿐이었다.
    '500-6': { code: RSC.INTERNAL_SERVER_ERROR,
               msg: "discovery took too long — narrow the target or add a ty filter",
               detail: 'search_lookup: statement timeout' },
    '501-2': { code: RSC.NOT_IMPLEMENTED, msg: "this resource type is not supported by the SQLite backend" }
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

// 기동 시 1회 도는 자체 점검. 문제 목록을 돌려준다 (빈 배열이면 정상).
//
// 파일시스템을 훑는 검사(아무도 참조하지 않는 사유가 있는가 등)는 여기 넣지
// 않는다 — 기동 경로에서 소스 16개를 읽는 비용이 아깝고, 그런 검사는
// test/reason-catalog.test.js 가 이미 한다. 여기서는 메모리 안에서 끝나는
// 불변식만 본다.
function selfCheck() {
    var problems = require('./rsc').assertComplete();
    var catalog = require('./rsc').RSC;

    var byMsg = {};
    Object.keys(REASON).forEach(function (k) {
        var r = REASON[k];

        // code 가 카탈로그의 실제 항목인가
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
            // 결과 코드 접두어는 rsc 가 이미 나른다. 문구에 되풀이하지 않는다.
            if (/^[A-Z_ ]{3,}:/.test(r.msg)) { problems.push(k + ': 문구에 접두어가 있다 — ' + r.msg); }
            // 내부 식별자가 클라이언트 응답으로 나가면 안 된다. detail 로 옮긴다.
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

// 점검 결과를 로그로 남긴다. 문제가 있어도 기동을 막지 않는다 —
// 운영 배포에서 서버가 안 뜨는 쪽이 카탈로그 흠결보다 위험하다.
// 클러스터 마스터에서 한 번만 부른다 (워커마다 부르면 같은 줄이 16번 찍힌다).
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
