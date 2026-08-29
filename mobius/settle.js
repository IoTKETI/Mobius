/**
 * 요청 하나의 정산기.
 *
 * 정산 = 응답을 보내고 connection.release() 를 하는 일. 라우트 하나에 이 일을
 * 하는 클로저가 열댓 개씩 흩어져 있었고, 전부 같은 다섯 줄이었다.
 *
 *     responder.response_result(request, response, '200', '2000', '', () => {
 *         connection.release();
 *         request = null;
 *         response = null;
 *     });
 *
 * app.js 에만 이 모양이 68곳이었다. 그중 54곳은 response_error_result 로
 * 완전히 같은 형태였다.
 *
 * ── request/response = null 은 어디로 갔나
 *
 * 그 두 줄은 라우트 클로저의 참조를 끊어 GC 를 돕자는 것이었는데, 안쪽
 * 콜백들이 같은 값을 따로 캡처하고 있어 실효가 크지 않았다. 대신 부작용이
 * 하나 있었다 — 정산이 두 번 일어나면 두 번째가 null 을 역참조해 워커가
 * 죽었고, **그 크래시가 이중 정산을 드러내는 유일한 신호**였다.
 *
 * 그 신호를 잃지 않으려고 두 번째 정산을 삼키지 않고 로그로 남긴다.
 * 워커는 죽지 않으면서 문제는 드러난다.
 *
 * ── 왜 release 를 여기서만 하나
 *
 * 반납이 한 곳으로 모이면 "응답은 했는데 반납을 빠뜨렸다" 가 구조적으로
 * 불가능해진다. 그 부류(정산 유실 -> 커넥션 고갈)를 여러 번 고쳤다.
 */

var responder = require('./responder');

/**
 * @param request
 * @param response
 * @param connection  db.getConnection 이 준 커넥션. 못 빌린 경로에서는 null 을
 *                    넘긴다 — 반납할 것이 없다는 뜻이고, 응답만 보낸다.
 * @param on_error    사유 코드로 에러 응답을 보내는 함수
 *                    (app.js 의 response_error_result). 그 함수가 reason 카탈로그와
 *                    responder.respond 를 엮고 있어 여기서 직접 만들지 않는다.
 */
exports.make = function (request, response, connection, on_error) {
    var settled = false;

    function claim(what) {
        if (settled) {
            // 어디서 두 번째로 정산하려 했는지가 유일한 단서다.
            var where = (new Error().stack || '').split('\n').slice(2, 5).join('\n');
            console.error('[settle] 이미 정산된 요청을 또 정산하려 했다 (' + what + ')\n' + where);
            return false;
        }
        settled = true;
        return true;
    }

    function finish() {
        if (connection) { connection.release(); }
    }

    return {
        /** 사유 코드로 에러 응답. app.js 에서 가장 흔한 정산이다. */
        error: function (code) {
            if (!claim('error ' + code)) { return; }
            on_error(request, response, code, finish);
        },

        /** 일반 성공 응답. */
        result: function (status, rsc, cap) {
            if (!claim('result ' + status + '/' + rsc)) { return; }
            responder.response_result(request, response, status, rsc, cap || '', finish);
        },

        /** discovery·fanOutPoint 결과 응답. */
        search: function (status, rsc, cap) {
            if (!claim('search ' + status + '/' + rsc)) { return; }
            responder.search_result(request, response, status, rsc, cap || '', finish);
        },

        /** rcn=3 응답. */
        rcn3: function (status, rsc, cap) {
            if (!claim('rcn3 ' + status + '/' + rsc)) { return; }
            responder.response_rcn3_result(request, response, status, rsc, cap || '', finish);
        },

        /**
         * 위 형태에 안 맞는 응답을 직접 보낸다 (원격 CSE 포워딩 결과 등).
         * fn 이 응답을 보내고 나면 반납한다.
         */
        raw: function (what, fn) {
            if (!claim('raw ' + what)) { return; }
            fn();
            finish();
        },

        /** 이미 정산됐는가. 테스트와 진단용. */
        isSettled: function () { return settled; }
    };
};
