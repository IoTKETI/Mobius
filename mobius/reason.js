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
    '400-47': { code: RSC.BAD_REQUEST, msg: "protocol in poa of ae is not supported" },
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

    // 이 CSE 는 json 만 다룬다. 요청 본문이 xml/cbor 이면 여기서 끊는다.
    //
    // 응답 쪽은 거절하지 않는다 — Accept 로 무엇을 요구받든 json 으로 답한다.
    // 물어봤을 뿐이고 우리는 그것을 만들지 않는다. 브라우저 기본 Accept 에는
    // application/xml 이 들어 있으므로, 그것까지 거절하면 브라우저로 열기만
    // 해도 400 이 된다.
    //
    // detail 은 응답에 안 나가고 responder.respond 가 console.error 로 찍는다.
    // 어떤 형식이 왔는지가 거기 남으므로 이 사유의 로그가 곧 계측이다.
    '400-64': { code: RSC.BAD_REQUEST, msg: "only json is supported; send the request body as application/json", detail: 'json_only' },
    // cty(contentType) 필터는 받지 않는다.
    //
    // 이 필터는 cin.cnf 와 정확 일치로 견준다. 그런데 cnf 에 들어가는 값은
    // **클라이언트가 보낸 것뿐**이다 — 서버가 Content-Type 헤더에서 유추하지
    // 않고, 안 보내면 빈 문자열이 저장된다. 배포 표본에서 거의 전부 빈 값이다.
    //
    // 그래서 두 가지가 동시에 일어난다.
    //   답이 틀린다   값을 채운 소수를 빼면 무엇을 물어도 0건이다. 클라이언트는
    //                 "그런 형식의 CIN 이 없다" 로 읽지만 사실은 서버가 모른다.
    //   느리다        cnf 에 인덱스가 없어 후보를 건당 찾아간다. 배포 EXPLAIN 으로
    //                 한 subtree 에서 rows 27,084,214 / cost 60,898,288 이다
    //                 (같은 부모에 cty 를 빼면 rows 93 / cost 110).
    //
    // **기본값을 빈 문자열 말고 다른 것으로 바꿔도 안 빨라진다.** 배포에서
    // 재 봤다 — cnf 가 실제로 채워진 subtree(walwal/training, cnf='text')에서
    // 맞는 값 / 안 맞는 값 / 필터 없음의 계획이 **완전히 같다**(cost 1271.55,
    // 같은 접근, 같은 행 수). 조건이 attached_condition 이라 후보를 **먼저
    // 가져온 뒤에** 값을 보기 때문이다. 값이 무엇이든 가져오는 비용은 같다.
    // 게다가 임의의 기본값을 넣으면 답이 다르게 틀린다 — 그 값을 물으면
    // 전건이 나오고, 다른 값을 물으면 여전히 0건이다.
    //
    // 인덱스로 풀 문제도 아니다. 값이 없는데 인덱스를 만들어도 답은 그대로
    // 틀리고, cin 은 1억4,560만 행 / 249GB 라 인덱스 하나가 매우 비싸다.
    // 그래서 **지원하지 않는다고 말한다.** 30초를 태우고 400 을 내는 것보다,
    // 처음부터 "그 필터는 없다" 를 알려주는 편이 정직하다.
    //
    // 되살리려면 cnf 를 채우는 것부터다 — 생성 경로에서 Content-Type 을 넣든,
    // 클라이언트에게 요구하든. 그 다음이 인덱스이고, 그 다음이 이 게이트 제거다.
    '400-65': { code: RSC.BAD_REQUEST,
                msg: "the cty filter is not supported by this CSE",
                detail: 'cty: unsupported filter' },
    // 본문을 다 받기 전에 끊는다. 실제 상한값은 로그(detail)에만 남긴다 —
    // 응답에 적으면 "얼마까지 되는지" 를 물어보지 않고 알아낼 수 있게 된다.
    '413-1':  { code: RSC.CONTENT_TOO_LARGE, msg: "request body is too large", detail: 'body_limit' },

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
    '404-3': { code: RSC.NOT_FOUND, msg: "CSEBase was not found" },
    '404-4': { code: RSC.NOT_FOUND, msg: "group resource does not exist" },
    '404-5': { code: RSC.NOT_FOUND, msg: "response did not come from fanOutPoint" },
    '404-6': { code: RSC.NOT_FOUND, msg: "AE for notification was not found" },
    '404-7': { code: RSC.NOT_FOUND, msg: "AE for notification does not exist" },
    // AE 는 찾았는데 poa 가 비어 알림을 보낼 곳이 없는 경우.
    // 404-6 은 "AE 를 못 찾았다" 라서 원인을 반대로 짚게 한다.
    '404-8': { code: RSC.NOT_FOUND, msg: "AE for notification has no point of access" },

    '405-1': { code: RSC.OPERATION_NOT_ALLOWED, msg: "CSEBase can not be created by others" },
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


    '500-1': { code: RSC.INTERNAL_SERVER_ERROR, msg: "database error" },
    '500-2': { code: RSC.SUBSCRIPTION_VERIFICATION_INITIATION_FAILED, msg: "SUBSCRIPTION_VERIFICATION_INITIATION_FAILED" },
    '500-4': { code: RSC.INTERNAL_SERVER_ERROR, msg: "resource could not be created", detail: 'create_action: insert failed' },
    '500-5': { code: RSC.INTERNAL_SERVER_ERROR, msg: "DB Error : No Connection Pool" },
    // 탐색이 문장 상한에 걸린 경우. DB 고장이 아니라 "이 범위를 감당 못 한다" 다.
    // 예전에는 500 "database error" 로 뭉개져서 호출자가 무엇을 고쳐야 할지
    // 알 수 없었다 — 30초를 기다린 끝에 받는 응답이 그것뿐이었다.
    //
    // **BAD_REQUEST 다(예전에는 INTERNAL_SERVER_ERROR).** 서버가 고장난 것이
    // 아니라 요청의 범위가 감당 밖이다. 같은 요청을 다시 보내면 반드시 또
    // 실패하므로, "재시도하면 될 수도 있다" 를 뜻하는 5xx 는 호출자를
    // 오해시킨다 — 30초를 태우고 같은 응답을 받는 일이 반복된다.
    // 고칠 사람은 호출자이고, 무엇을 고쳐야 하는지는 msg 에 있다.
    //
    // 이 사유가 남은 자리(2026-09-02 기준): sza / szb 처럼 cin 을 조인하는 필터.
    //
    // **비용은 cty 와 같다.** 배포 EXPLAIN 으로 확인했다 — 옵티마이저가
    // cin_ri_idx(pi, ri, cs) 가 아니라 PRIMARY(ri, pi) 로 조인하고, InnoDB 에서
    // PRIMARY 는 곧 행이므로 cs 를 보든 cnf 를 보든 후보마다 클러스터드 인덱스를
    // 한 번씩 찾아간다. 세 계획의 cost 가 같았다(맞는 값/안 맞는 값/필터 없음
    // 모두 1271.55). 코드 주석이 "cs 는 인덱스에 담겨 끝난다" 고 말하던 것은
    // 사실과 다르다.
    //
    // 그런데도 sza / szb 는 받는다. cty 와 갈리는 것은 속도가 아니라 **정확성**이다.
    //   cs   서버가 채운다. 답이 맞다. 느릴 뿐이라 범위를 좁히면 된다.
    //   cnf  클라이언트가 준 것뿐이고 대부분 비어 있다. 범위를 좁혀도 답이 틀린다.
    // 그래서 하나는 상한으로 묶어 두고, 다른 하나는 아예 받지 않는다(아래 400-65).
    '500-6': { code: RSC.BAD_REQUEST,
               msg: "discovery scope too large — narrow the target path, " +
                    "add a ty filter, or use cra/crb to bound the time range",
               detail: 'search_lookup: statement timeout' },
    // 상류(원격 CSE 나 AE)가 json 이 아닌 것을 돌려준 경우.
    //
    // 이 CSE 는 json 만 만든다고 선언했다. 상류의 응답을 그대로 흘려보내면
    // **우리가 xml 을 내보낸 것**이 된다. 형식만 json 이라고 붙이면 더 나쁘다 —
    // 내용과 이름이 어긋난다. 그래서 흘려보내지 않고 여기서 끊는다.
    //
    // 나가는 요청에 Accept: application/json 을 붙이므로, 규격을 지키는
    // 상류라면 이 사유는 나지 않는다. 나면 상류가 그것을 무시한 것이다.
    // detail 에 실제로 받은 형식이 남는다 — 어느 상대가 그러는지 알아야 한다.
    '500-7': { code: RSC.INTERNAL_SERVER_ERROR,
               msg: "upstream returned a body this CSE cannot relay",
               detail: 'relay: non-json content-type' },
    // 백엔드 이름을 말하지 않는다. 여기 "the SQLite backend" 라고 적혀 있었는데
    // **틀린 문장이었다** — 이 사유는 SQLite 라서 나가는 것이 아니라, 어댑터가
    // supportedResourceTypes 목록을 선언했고 요청한 타입이 그 목록에 없어서
    // 나간다. 지금 그 목록을 선언한 어댑터가 sqlite 하나뿐이라 우연히 맞았을 뿐,
    // 부분 지원 상태의 새 백엔드를 붙이면 클라이언트가 쓰지도 않는 DB 이름을 듣는다.
    '501-2': { code: RSC.NOT_IMPLEMENTED,
               msg: "this resource type is not supported by the configured storage backend" }
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
