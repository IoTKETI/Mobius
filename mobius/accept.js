'use strict';
// Accept 헤더를 읽어 응답 형식을 정한다.
//
// ── 왜 따로 있나 ────────────────────────────────────────────────────────
// 예전에는 responder 가 `accept.includes('xml')` 한 줄로 정했다. 부분 문자열
// 검사라 두 가지가 어긋났다. 실측한 그대로다:
//
//   Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
//     -> XML.  브라우저 기본값이다. application/xhtml+xml 의 'xml' 에 걸린다.
//        즉 **브라우저로 Mobius 를 열면 XML 이 나왔다.**
//
//   Accept: application/json, application/xml
//     -> XML.  json 을 먼저 적었는데도 그렇다. 순서도 q값도 보지 않는다.
//
//   Accept: application/cbor
//     -> 헤더는 application/cbor 인데 본문은 JSON 이었다.
//
// 앞으로 xml·cbor 요청을 400 으로 거절할 계획인데, 그 판정을 위 방식으로 하면
// **브라우저가 전부 400 을 받는다.** 막으려는 것은 일부러 XML 을 요청하는
// 클라이언트이지 기본 Accept 를 보내는 브라우저가 아니다. 그래서 거절보다
// 파싱을 먼저 고친다.
//
// 판정을 여기 한 곳에 둔다. 응답(responder)과 앞으로 세울 거절 관문(app.js)이
// 서로 다른 눈으로 보면, 지금 고치는 병이 그대로 재발한다.
//
// ── 규칙 ────────────────────────────────────────────────────────────────
// **서버가 json 을 선호한다.** json 이 조금이라도 받아들여지면(명시했든
// 와일드카드든) json 으로 답한다. json 이 정말로 안 되는 요청만 xml·cbor 로
// 간다. RFC 9110 은 서버가 받아들여지는 표현 중에서 고르는 것을 허용한다.
//
// 이 규칙이 나중 거절을 정확하게 만든다 — "json 이 안 되는 요청" 만 400 이
// 되므로, 브라우저나 */* 를 보내는 클라이언트는 걸리지 않는다.

// 미디어 타입 -> 우리가 만드는 형식. 여기 없는 것은 무시한다.
//
// application/xhtml+xml 이 없는 것이 핵심이다. 그것은 XHTML 문서 타입이지
// oneM2M 의 XML 직렬화가 아니다. 그것을 xml 로 본 것이 위 브라우저 문제였다.
var TYPE = {
    'application/json':                 'json',
    'text/json':                        'json',
    'application/vnd.onem2m-res+json':  'json',

    'application/xml':                  'xml',
    'text/xml':                         'xml',
    'application/vnd.onem2m-res+xml':   'xml',

    'application/cbor':                 'cbor',
    'application/vnd.onem2m-res+cbor':  'cbor'
};

// 이 서버가 만들 수 있는 형식. 선호 순서다.
var SUPPORTED = ['json', 'xml', 'cbor'];

/**
 * Accept 헤더를 (형식, q) 목록으로 읽는다.
 *
 * 와일드카드(*&#47;* 와 application&#47;*)는 "아무거나 좋다" 는 뜻이므로 서버
 * 선호인 json 으로 친다.
 *
 * 문법이 깨진 조각은 조용히 버린다 — 헤더 하나 때문에 요청을 죽이지 않는다.
 */
function parse(header) {
    if (typeof header !== 'string' || header === '') { return []; }

    var out = [];
    header.split(',').forEach(function (piece) {
        var parts = piece.split(';');
        var mime = String(parts[0] || '').trim().toLowerCase();
        if (mime === '') { return; }

        var q = 1;
        for (var i = 1; i < parts.length; i++) {
            var p = String(parts[i]).trim();
            if (p.slice(0, 2).toLowerCase() === 'q=') {
                var v = parseFloat(p.slice(2));
                if (isFinite(v)) { q = v; }
            }
        }
        if (!(q > 0)) { return; }   // q=0 은 "이건 싫다" 다

        var kind = (mime === '*/*' || mime === 'application/*') ? 'json' : TYPE[mime];
        if (kind) { out.push({ kind: kind, q: q }); }
    });
    return out;
}

/**
 * 이 요청에 어떤 형식으로 답할 것인가. 언제나 SUPPORTED 중 하나를 준다.
 *
 * Accept 가 없거나 아는 타입이 하나도 없으면 json 이다 — 기존 동작 그대로다.
 */
function pick(header) {
    var list = parse(header);
    if (list.length === 0) { return 'json'; }

    // **서버 선호 순서로 고른다. q 값으로 겨루지 않는다.**
    //
    // q 를 따르면 브라우저 기본값에서 xml 이 이긴다 —
    // application/xml;q=0.9 가 */*;q=0.8 보다 높기 때문이다. 그런데 브라우저는
    // xml 을 원해서가 아니라 그냥 기본 헤더를 보낸 것이다. 그걸 받아 주면
    // 브라우저로 Mobius 를 여는 사람이 계속 XML 을 받는다.
    //
    // RFC 9110 은 서버가 받아들여지는 표현 중에서 고르는 것을 허용한다.
    // 우리는 json 을 만든다 — 받아들여지기만 하면 json 이다.
    for (var i = 0; i < SUPPORTED.length; i++) {
        for (var j = 0; j < list.length; j++) {
            if (list[j].kind === SUPPORTED[i]) { return SUPPORTED[i]; }
        }
    }
    return 'json';
}

// 이 요청이 json 을 받아들이는가.
//
// 앞으로 세울 거절 관문이 쓴다 — false 인 요청만 "json 을 쓰라" 고 400 을
// 돌려주면, 브라우저나 와일드카드를 보내는 클라이언트는 걸리지 않는다.
function accepts_json(header) {
    var list = parse(header);
    if (list.length === 0) { return true; }
    for (var i = 0; i < list.length; i++) {
        if (list[i].kind === 'json') { return true; }
    }
    return false;
}

exports.parse = parse;
exports.pick = pick;
exports.accepts_json = accepts_json;
exports.SUPPORTED = SUPPORTED;
