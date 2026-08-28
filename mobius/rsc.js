'use strict';
//
// 결과 코드 카탈로그 — 단일 진실원
//
// 지금까지 결과 코드는 다섯 곳에 흩어져 있었다.
//   app.js  resultStatusCode      키 -> [http, rsc, 문구]      93행
//   pxy_coap.js  coap_rsc_code    rsc -> CoAP 코드             36행
//   responder.* 호출부 리터럴      (http, rsc) 쌍               12곳
//   *.rsc = '5000' 인라인 대입                                  23곳
//   dbg 인라인 문자열                                           다수
//
// HTTP 표와 CoAP 표가 서로를 몰라서 매핑이 어긋나 있었다. 여기서는 한 항목에
// 모든 바인딩 값을 함께 둔다. 새 코드를 추가하면 두 바인딩을 동시에 채우게 되고,
// 빠뜨리면 assertComplete() 가 잡는다.
//
// ─────────────────────────────────────────────────────────────────────────
// 이 파일의 값은 전부 현재 코드에서 기계적으로 옮긴 것이다. 값을 바꾸지 않는다.
//   추출 근거:  node tools/response-golden/extract-codes.js
//
// 이름은 코드베이스가 이미 쓰던 어휘에서 가져왔다(대부분 메시지 접두어).
// oneM2M TS-0004 원문과 대조하지 않았다 — 값 교정은 별도 작업이다.
// (docs/superpowers/specs/2026-08-26-request-flow-perf-analysis.md §8.3)
//
// 같은 rsc 가 서로 다른 http 로 나가는 경우가 있다(4005 -> 405 와 409).
// 규격상 이상하지만 현재 동작이므로 두 항목으로 나눠 보존한다. 값 교정 대상이다.
// ─────────────────────────────────────────────────────────────────────────

// coap 이 null 인 항목은 현재 CoAP 매핑이 없다는 뜻이다. pxy_coap.js 가
// coap_rsc_code[rsc] 로 조회해 undefined 를 응답 코드에 넣던 결함(D19)의 원인이다.
// Task 5 에서 폴백으로 처리한다 — 여기서 값을 지어내지 않는다.

var RSC = {
    // ── 성공 ─────────────────────────────────────────────────────────────
    OK:        { name: 'OK',        rsc: '2000', http: 200, coap: '2.05' },
    CREATED:   { name: 'CREATED',   rsc: '2001', http: 201, coap: '2.01' },
    DELETED:   { name: 'DELETED',   rsc: '2002', http: 200, coap: '2.02' },
    UPDATED:   { name: 'UPDATED',   rsc: '2004', http: 200, coap: '2.04' },

    // 논블로킹 요청 접수. rt=1 이면 SYNC, rt=2(+X-M2M-RTU)면 ASYNC
    ACCEPTED_NONBLOCKING_SYNC:  { name: 'ACCEPTED_NONBLOCKING_SYNC',  rsc: '1001', http: 202, coap: null },
    ACCEPTED_NONBLOCKING_ASYNC: { name: 'ACCEPTED_NONBLOCKING_ASYNC', rsc: '1002', http: 202, coap: null },

    // ── 400 ──────────────────────────────────────────────────────────────
    BAD_REQUEST:                   { name: 'BAD_REQUEST',                   rsc: '4000', http: 400, coap: '4.00' },
    MAX_NUMBER_OF_MEMBER_EXCEEDED: { name: 'MAX_NUMBER_OF_MEMBER_EXCEEDED', rsc: '6010', http: 400, coap: '4.00' },
    MEMBER_TYPE_INCONSISTENT:      { name: 'MEMBER_TYPE_INCONSISTENT',      rsc: '6011', http: 400, coap: '4.00' },

    // ── 403 ──────────────────────────────────────────────────────────────
    ACCESS_DENIED:           { name: 'ACCESS_DENIED',           rsc: '4103', http: 403, coap: '4.03' },
    // 메시지는 "AE-ID is not allowed" / "APP-ID in AE is not allowed" / fopt 접근 거부.
    // allowed_ae_ids / allowed_app_ids 화이트리스트 거부에 쓰인다.
    AE_NOT_ALLOWED:          { name: 'AE_NOT_ALLOWED',          rsc: '4107', http: 403, coap: null },
    NO_MEMBERS:              { name: 'NO_MEMBERS',              rsc: '4109', http: 403, coap: null },
    // 실제 조건은 "부모 밑에 만들 수 없는 ty" 인데 rsc 는 구독 관련이다. §8.3 참조
    TARGET_NOT_SUBSCRIBABLE: { name: 'TARGET_NOT_SUBSCRIBABLE', rsc: '5203', http: 403, coap: '4.03' },

    // ── 404 / 405 / 406 ──────────────────────────────────────────────────
    NOT_FOUND:             { name: 'NOT_FOUND',             rsc: '4004', http: 404, coap: '4.04' },
    OPERATION_NOT_ALLOWED: { name: 'OPERATION_NOT_ALLOWED', rsc: '4005', http: 405, coap: '4.05' },
    NOT_ACCEPTABLE:        { name: 'NOT_ACCEPTABLE',        rsc: '5207', http: 406, coap: '4.06' },

    // ── 409 ──────────────────────────────────────────────────────────────
    // OPERATION_NOT_ALLOWED 와 rsc 가 같은데 http 만 다르다. 409-1~409-4 가 쓴다.
    // (la/ol 에 POST·PUT, 예약어 rn, 미지원 리소스) — 값 교정 대상이다.
    CONFLICT_OPERATION: { name: 'CONFLICT_OPERATION', rsc: '4005', http: 409, coap: '4.05' },
    ALREADY_EXISTS:     { name: 'ALREADY_EXISTS',     rsc: '4105', http: 409, coap: '4.03' },
    AEI_DUPLICATED:     { name: 'AEI_DUPLICATED',     rsc: '4106', http: 409, coap: null },

    // ── 423 / 500 / 501 ──────────────────────────────────────────────────
    LOCKED:                { name: 'LOCKED',                rsc: '4230', http: 423, coap: null },
    INTERNAL_SERVER_ERROR: { name: 'INTERNAL_SERVER_ERROR', rsc: '5000', http: 500, coap: '5.00' },
    SUBSCRIPTION_VERIFICATION_INITIATION_FAILED:
        { name: 'SUBSCRIPTION_VERIFICATION_INITIATION_FAILED', rsc: '5204', http: 500, coap: '5.00' },
    NOT_IMPLEMENTED:       { name: 'NOT_IMPLEMENTED',       rsc: '5001', http: 501, coap: '5.01' }
};

// pxy_coap.js 의 표에는 있으나 이 서버가 실제로 내보내지 않는 rsc 들.
// 어디서도 생성되지 않으므로 죽은 매핑으로 보이지만, 확인 전까지 버리지 않는다.
// Task 5 에서 pxy_coap.js 를 카탈로그로 옮길 때 함께 판단한다.
var COAP_ONLY = {
    '4008': '4.04', '4101': '4.03', '4102': '4.00', '4104': '4.00',
    '5103': '4.04', '5105': '4.03', '5106': '5.06', '5205': '4.03', '5206': '5.00',
    '6003': '4.04', '6005': '4.04', '6020': '5.00', '6021': '5.00', '6022': '4.00',
    '6023': '4.00', '6024': '4.00', '6025': '5.00', '6026': '5.00',
    '6028': '4.00', '6029': '4.00'
};

// (http, rsc) 쌍으로 카탈로그 항목을 찾는다. 기존 resultStatusCode 항목을
// 카탈로그에 붙일 때 쓴다 — rsc 만으로는 4005 를 가릴 수 없기 때문이다.
function byPair(http, rsc) {
    var want = String(http);
    for (var k in RSC) {
        if (Object.prototype.hasOwnProperty.call(RSC, k)) {
            if (RSC[k].rsc === String(rsc) && String(RSC[k].http) === want) { return RSC[k]; }
        }
    }
    return null;
}

// rsc 로 CoAP 코드를 찾는다. 없으면 null 을 돌려준다 (호출부가 폴백을 정한다).
function coapFor(rsc) {
    for (var k in RSC) {
        if (Object.prototype.hasOwnProperty.call(RSC, k)) {
            if (RSC[k].rsc === String(rsc)) { return RSC[k].coap; }
        }
    }
    return Object.prototype.hasOwnProperty.call(COAP_ONLY, String(rsc))
        ? COAP_ONLY[String(rsc)] : null;
}

// 카탈로그 자체 점검. 기동 시 1회 부르며, 실패해도 서버를 막지 않고 경고만 남긴다.
// 운영 배포에서 서버가 안 뜨는 것이 매핑 누락보다 위험하다.
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

    // (http, rsc) 쌍은 유일해야 한다. 겹치면 byPair 가 어느 쪽을 줄지 알 수 없다.
    var seen = {};
    Object.keys(RSC).forEach(function (k) {
        var p = RSC[k].http + '|' + RSC[k].rsc;
        if (seen[p]) { problems.push('(http,rsc) 중복: ' + p + ' -> ' + seen[p] + ', ' + k); }
        seen[p] = k;
    });

    return problems;
}

// CoAP 매핑이 없는 항목 — D19 의 대상. Task 5 가 폴백을 붙일 목록이다.
function missingCoap() {
    return Object.keys(RSC).filter(function (k) { return RSC[k].coap === null; });
}

module.exports = {
    RSC: RSC,
    COAP_ONLY: COAP_ONLY,
    byPair: byPair,
    coapFor: coapFor,
    assertComplete: assertComplete,
    missingCoap: missingCoap
};
