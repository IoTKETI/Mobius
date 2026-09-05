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
 * 옛 라우트의 if-else — lookup_* 이 **코드 문자열만** 주는 동안 done(code) 가
 * 이 표로 옛 세 갈래(result / search / rcn3)를 고른다.
 *
 * 2단계 6번(2026-09-05)에서 app.js 라우트 넷의 갈래를 여기로 옮겼다. 모양
 * 정보('200' 은 일반, '200-1' 은 discovery, '201-3' 은 rcn=3)가 코드 문자열에
 * 인코딩되어 세 층을 관통하던 것이 이 표 하나로 좁혀진 상태다. 생산자가
 * out 을 주기 시작하면(8~9번) 줄이 빠지고, 다 빠지면 표째 지운다(10번).
 *
 * 메서드가 키다 — 같은 '200' 이 GET 은 2000, PUT 은 2004, DELETE 는 2002 다.
 */
var LEGACY = {
    POST:   { '201': ['result', '201', '2001'], '201-3': ['rcn3', '201', '2001'] },
    // GET 은 빠졌다 — resource.retrieve 가 (null, out) 을 준다(2단계 8번).
    // '200' → result 200/2000, '200-1' → search 200/2000 이었다. GET 에 코드가
    // 오면 이제 on_error 로 간다 — 옛 코드를 주는 생산자가 남아 있으면 드러난다.
    PUT:    { '200': ['result', '200', '2004'] },
    DELETE: { '200': ['result', '200', '2002'] }
};

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
         * 이행기에는 옛 성공 코드('201', '200-1' …)도 code 로 온다 — 위 LEGACY.
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
            var m = Object.prototype.hasOwnProperty.call(LEGACY, request.method) ? LEGACY[request.method] : {};
            var leg = Object.prototype.hasOwnProperty.call(m, code) ? m[code] : null;
            if (leg) { api[leg[0]](leg[1], leg[2]); return; }
            api.error(code);
        },

        /** 사유 코드로 에러 응답. app.js 에서 가장 흔한 정산이다. */
        error: function (code) {
            if (!claim('error ' + code)) { return; }
            on_error(request, response, code, finish);
        },

        // 세 함수의 여섯째 인자 cap 은 1단계 3번에서 없앴다. 네 자리 전부에서
        // 만들었다 버려지던 값이라 응답에 한 번도 안 나타났다 — 차분 하네스의
        // cap/string|object|number|null 네 건이 같은 바이트를 낸 것으로 확인했다.
        // 호출부(app.js 7곳)가 넘기던 '' 도 같이 걷어냈다.

        /** 일반 성공 응답. */
        result: function (status, rsc) {
            if (!claim('result ' + status + '/' + rsc)) { return; }
            responder.response_result(request, response, status, rsc, finish);
        },

        /** discovery·fanOutPoint 결과 응답. */
        search: function (status, rsc) {
            if (!claim('search ' + status + '/' + rsc)) { return; }
            responder.search_result(request, response, status, rsc, finish);
        },

        /** rcn=3 응답. */
        rcn3: function (status, rsc) {
            if (!claim('rcn3 ' + status + '/' + rsc)) { return; }
            responder.response_rcn3_result(request, response, status, rsc, finish);
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

/** 이행기 표. 시험이 라우트의 옛 if-else 와 같은지 대조한다. */
exports.LEGACY = LEGACY;
