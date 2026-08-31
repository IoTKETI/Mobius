'use strict';
//
// 서버가 내보내는 요청의 헤더를 다듬는다.
//
// ── 왜 있나 ──────────────────────────────────────────────────────────────
// Mobius 가 상대에게 요청을 보내는 자리가 넷이다:
//
//     app.js       notify_http          AE 알림 전달
//     app.js       forward_http         remoteCSE 포워딩
//     mobius/fopt.js request_to_member  팬아웃 멤버 조회
//     mobius/grp.js  check_member       그룹 멤버 검증
//
// 앞의 셋은 **클라이언트의 헤더를 그대로** 상대에게 넘긴다. 거기에는
// 클라이언트의 Accept 도 들어 있다.
//
// 그런데 이 CSE 는 json 만 읽고 json 만 만든다 — xml/cbor 처리를 전부
// 걷어냈다(2026-08-31). 클라이언트가 `Accept: application/xml` 을 보냈다고
// 상대에게 그것을 그대로 물어보면, 규격을 지키는 상대는 XML 을 돌려주고
// 우리는 그것을 다룰 방법이 없다.
//
// **우리가 감당할 수 있는 것을 묻는다.**
//
// ── 어쩌다 파일로 나왔나 ─────────────────────────────────────────────────
// 처음에는 app.js 의 지역 함수였다(534e298). 그때는 그 파일의 두 자리만
// 고쳤는데, 나중 감사에서 fopt.js 가 같은 패턴으로 남아 있는 것이 나왔다.
// grp.js 는 헤더 객체를 새로 만들며 'Accept': 'application/json' 을 직접
// 적어 두어 이미 안전했다.
//
// 세 자리가 같은 규칙을 쓰게 하려고 파일로 뺐다.

var JSON_ACCEPT = 'application/json';

/**
 * 나가는 요청의 헤더를 돌려준다.
 *
 *   headers: outbound_headers(request.headers)
 *
 * Accept 만 json 으로 바꾸고 나머지는 그대로 넘긴다.
 *
 * **원본을 변형하지 않는다.** 인자로 오는 것은 request.headers 이고,
 * 그것을 고치면 이 요청의 다른 경로(로그·정산·다음 멤버)가 바뀐 값을 본다.
 */
module.exports = function outbound_headers(headers) {
    var h = {};
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });

    // 대소문자가 섞여 들어올 수 있다(accept / Accept / AcCePt).
    // 지우지 않고 덧붙이면 Accept 가 둘 나간다.
    Object.keys(h).forEach(function (k) {
        if (k.toLowerCase() === 'accept') { delete h[k]; }
    });

    h['Accept'] = JSON_ACCEPT;
    return h;
};
