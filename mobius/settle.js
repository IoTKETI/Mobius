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
var RSC = require('./rsc').RSC;

/**
 * ── 옛 세 갈래(result / search / rcn3)는 어디로 갔나
 *
 * 2단계(2026-09-05) 전에는 lookup_* 이 **코드 문자열만** 돌려줬다 — '200' 은
 * 일반, '200-1' 은 discovery, '201-3' 은 rcn=3. 모양 정보가 코드에 인코딩되어
 * 라우트가 그것을 보고 settle.result / .search / .rcn3 중 하나를 골랐고,
 * 그것이 responder 의 세 함수 중 하나를 골랐다. 세 층을 관통하는 암묵 계약이었다.
 *
 * 이제 생산자(resource.create/retrieve/update/delete · fopt.check)가 결과
 * 객체 out 을 인자로 올리고, 정산은 done 하나다. 옛 갈래로 돌리던 이행기
 * 표(LEGACY)는 생산자가 하나씩 옮겨가며 줄이 빠졌고 10번에서 표째 지웠다.
 * 옛 코드를 주는 생산자가 남아 있었다면 on_error 로 500 이 나서 드러났을 것이다
 * — 골든이 그것을 확인했다.
 */

/**
 * @param request
 * @param response
 * @param connection  db.getConnection 이 준 커넥션. 못 빌린 경로에서는 null 을
 *                    넘긴다 — 반납할 것이 없다는 뜻이고, 응답만 보낸다.
 * @param on_error    사유 코드로 에러 응답을 보내는 함수
 *                    (app.js 의 response_error_result). 그 함수가 reason 카탈로그와
 *                    responder.respond 를 엮고 있어 여기서 직접 만들지 않는다.
 */
exports.make = function (request, response, connection, on_error, release) {
    var settled = false;

    // 반납하는 법을 **주입받는다.** 이 모듈이 db_action 을 require 하면
    // 파사드를 우회하는 파일이 하나 늘고, test/db-adapter-contract.test.js 가
    // 그 수를 세고 있다. 정산기는 "반납한다" 만 알면 되고 "무엇으로 반납하는지"
    // 는 몰라야 한다 — 그게 백엔드를 바꿔 끼울 수 있게 하는 조건이다.
    //
    // 기본값은 지금과 같은 덕타이핑이다. 인자를 안 주는 호출부(테스트 포함)가
    // 그대로 돈다.
    release = release || function (c) {
        if (c && typeof c.release === 'function') { c.release(); }
    };

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
        if (connection) { release(connection); }
    }

    var api = {
        /**
         * 연산 결과로 정산한다 — 2단계의 단일 진입점.
         *
         *   done(code)        실패. 사유 코드로 에러 응답 (error 와 같다)
         *   done(null, out)   성공. out = { rsc, shape, rootnm, body }
         *                     rsc 는 rsc.js 카탈로그 이름('CREATED'), shape 는
         *                     shape.js 의 네 모양 이름. 본문이 **인자**로 온다 —
         *                     request.resourceObj 에 숨지 않는다.
         *
         * out 이 잘못됐으면(모르는 rsc·shape, 본문 조립이 던짐) **던지지 않고**
         * 500 으로 낸다. 응답 전에 던지면 반납을 못 하고 backstop 이 워커를
         * 죽인다 — 프로그래밍 오류를 요청 하나의 500 으로 가두는 것이다.
         */
        done: function (code, out) {
            if (out) {
                if (!claim('done ' + out.rsc)) { return; }
                var c = Object.prototype.hasOwnProperty.call(RSC, out.rsc) ? RSC[out.rsc] : null;
                var body;
                try {
                    if (!c) { throw new TypeError('unknown rsc ' + JSON.stringify(out.rsc)); }
                    body = responder.body_of(out, request.query.rcn);
                }
                catch (e) {
                    console.error('[settle] done: ' + e.message);
                    on_error(request, response, '500-8', finish);
                    return;
                }
                responder.respond(request, response, { status: c.http, rsc: c.rsc, body: body }, finish);
                return;
            }
            api.error(code);
        },

        /** 사유 코드로 에러 응답. app.js 에서 가장 흔한 정산이다. */
        error: function (code) {
            if (!claim('error ' + code)) { return; }
            on_error(request, response, code, finish);
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
    return api;
};
