/**
 * 라우트의 (fu, rcn) 허용 조합 — 메서드마다 다르다.
 *
 * 3단계 13번(2026-09-05) 전에는 네 라우트가 각자 긴 조건식으로 갖고 있었다.
 *
 *     (request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1 || …)
 *
 * 표로 옮기면서 값이 지금과 같은지 시험(test/route-gate.test.js)이 옛 조건식과
 * 전수 대조한다 — 옮기다 조합 하나를 빠뜨리면 그 요청이 400 을 새로 받는다.
 *
 * **`==` 다.** 옛 조건이 느슨한 비교였다 — query 값은 문자열('1')이고 표는
 * 숫자다. '01' 이나 ' 1' 같은 값도 옛 코드처럼 통과한다. 엄격 비교로 바꾸는
 * 것은 동작 변경이고, 이 파일의 일이 아니다.
 *
 * 값→값이다. request 를 모른다 — 그래서 HTTP 없이 시험된다.
 */
'use strict';

var GATE = {
    POST:   { fu: [2],    rcn: [0, 1, 2, 3],    reject: '400-43' },
    GET:    { fu: [1, 2], rcn: [1, 4, 5, 6, 7], reject: '400-44' },
    PUT:    { fu: [2],    rcn: [0, 1],          reject: '400-45' },
    DELETE: { fu: [2],    rcn: [0, 1],          reject: '400-46' }
};

function loose_in(list, v) {
    for (var i = 0; i < list.length; i++) {
        if (v == list[i]) { return true; }   // eslint-disable-line eqeqeq — 옛 조건 그대로
    }
    return false;
}

/**
 * @param method  'POST' | 'GET' | 'PUT' | 'DELETE'
 * @param query   request.query — fu 와 rcn 을 본다
 * @returns {string|null}  거절 사유 코드. 허용이면 null
 */
exports.reject = function (method, query) {
    var g = GATE[method];
    if (!g) { throw new TypeError('route_gate: 모르는 메서드 ' + JSON.stringify(method)); }
    return (loose_in(g.fu, query.fu) && loose_in(g.rcn, query.rcn)) ? null : g.reject;
};

exports.GATE = GATE;
