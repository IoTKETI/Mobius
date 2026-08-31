/**
 * 요청 본문 수집기. Express 미들웨어 하나만 내보낸다.
 *
 * app.js 에서 떼어 낸 이유는 **시험하기 위해서**다. app.js 는 require 하는
 * 순간 cluster 워커를 띄우고 포트를 연다 — 단위 테스트가 부를 수 없다.
 * 그래서 이 결함(D13)은 8년 동안 테스트 한 줄 없이 살아 있었다.
 *
 * 여기 있는 것은 순수 함수에 가깝다. 가짜 요청 스트림만 있으면 시험된다.
 * test/body-collector.test.js 를 보라.
 */
'use strict';

var responder = require('./responder');
var reason = require('./reason');
/**
 * 요청 본문을 모아 request.body 에 **문자열**로 넣는다.
 *
 * ── 여기 있던 것 ────────────────────────────────────────────────────────
 * 예전에는 두 벌이었다:
 *
 *   1) bodyParser.text({limit:'5mb', type:'a;b;c;d;e'})  — 네 라우트의 미들웨어
 *   2) 각 라우트 안의 `fullBody += chunk.toString()`      — 실제로 동작하던 것
 *
 * 1) 은 **한 번도 동작한 적이 없다.** type 에 넘긴 것이 세미콜론으로 이어붙인
 * 한 덩이 문자열인데, type-is 는 그것을 목록으로 쪼개지 않고 통째로 하나의
 * MIME 으로 본다. 슬래시로 갈랐을 때 2조각이 아니면 즉시 false 다. 그래서
 * 어떤 Content-Type 도 매칭되지 않았고, body-parser 는 스트림을 건드리지 않고
 * next() 만 했다. 선언된 5mb 상한도 같이 죽어 있었다.
 *
 * 실측(배포 서버): 6MB 본문이 201 로 통과했다.
 *
 * ── 2) 가 만들던 두 번째 결함 ───────────────────────────────────────────
 * `fullBody += chunk.toString()` 은 **청크마다 따로 디코드**한다. 멀티바이트
 * 글자가 청크 경계에 걸리면 그 조각은 U+FFFD 로 바뀌고 되돌릴 수 없다.
 *
 * 소켓을 직접 갈라 재현했다 — "가" 3바이트 중 1바이트만 첫 조각에 넣으면:
 *
 *     보낸 con : "가나다"
 *     받은 con : "���나다"
 *
 * 에러가 나지 않는다. **깨진 채로 DB 에 저장된다.** cs(contentSize)도 손상된
 * 값 기준으로 계산된다. 게다가 U+FFFD 는 UTF-8 로 3바이트라 원래 조각과
 * 바이트 수가 다르다 — fopt.js:112 가 원본 Content-Length 를 그대로 넘기고
 * fopt.js:151 이 이 문자열을 쓰므로, 팬아웃 멤버로 나가는 요청의 길이가
 * 선언값과 어긋난다.
 *
 * 큰 본문이 대부분 base64 JPEG(순수 ASCII)이라 지금까지 드러나지 않았다.
 *
 * ── 왜 body-parser 를 제대로 고치지 않았나 ──────────────────────────────
 * type 만 올바른 배열로 바꾸면 body-parser 가 스트림을 **끝까지 소비한다.**
 * 그러면 뒤에서 request.on('end') 를 다는 수동 수집기는 이미 끝난 스트림에
 * 리스너를 다는 셈이라 'end' 를 영영 못 받는다 — 본문 있는 모든 요청이
 * 매달린다. 즉 "type 한 줄 수정" 은 그 자체로 서버를 멈추게 하는 변경이고,
 * 수집기 네 곳 삭제·에러 처리·Content-Type 없는 요청 처리를 **같은 커밋에서**
 * 전부 해야 성립한다.
 *
 * 대신 수집기 쪽을 고쳤다. request.body 가 계속 문자열이므로 소비자
 * (app.js 의 `!== ""` 관문 둘, JSON.parse, fopt 의 req.write, 로그)를
 * 하나도 건드리지 않는다.
 *
 * ── 무엇을 하는가 ───────────────────────────────────────────────────────
 * 1. 조각을 Buffer 로 모아 **마지막에 한 번** 디코드한다 → 경계 손상이 없다
 * 2. 상한을 넘으면 413 으로 끊는다
 * 3. aborted / error 에서 모은 것을 버린다 → 끊긴 요청이 메모리를 붙들지 않는다
 *
 * 상한 초과와 중단은 둘 다 여기서 끝난다. next() 를 부르지 않으므로 라우트
 * 핸들러는 시작조차 안 하고, DB 커넥션도 빌리지 않는다.
 *
 * ── 상한을 넘겼을 때 소켓을 어떻게 다루나 ───────────────────────────────
 * 처음에는 넘긴 즉시 `request.destroy()` 를 했다. **틀렸다.** 클라이언트는
 * 아직 본문을 쓰는 중이라, 소켓이 죽으면 413 을 읽기 전에 write 에서
 * ECONNRESET 을 받는다. 실측에서 그렇게 나왔다:
 *
 *     HTTP 0  rsc=undefined  본문: ERR read ECONNRESET
 *
 * 지금은 두 갈래다:
 *
 *   (1) Content-Length 가 이미 상한을 넘는다
 *       -> 본문을 한 바이트도 안 받고 바로 413. 클라이언트가 아직 쓰기를
 *          시작하지 않았으므로 응답이 확실히 닿는다. 흔한 경우(실수로 큰
 *          파일을 올림)가 전부 여기로 떨어진다.
 *
 *   (2) Content-Length 가 없거나(chunked) 거짓말을 한다
 *       -> 모은 것을 버리고, 남은 것은 **읽어서 버리며 끝까지 기다린다.**
 *          다 받은 뒤 413 을 낸다. 대역폭은 쓰지만 클라이언트가 이유를 안다.
 *          메모리는 상한에 묶여 있다 — 버리는 것은 쌓지 않는다.
 *          무한정 흘리는 상대는 Node 의 requestTimeout(기본 300초)이 끊는다.
 */
// 상한은 mobius.js 가 conf 에서 정해 global.max_body_bytes 에 넣는다.
//
// 여기서 한 번 더 기본값을 두는 이유: 전역이 없으면 `size > undefined` 가
// 언제나 거짓이라 **상한이 조용히 꺼진다.** 꺼진 줄 아무도 모르는 상태가
// 바로 지금까지의 문제였다(bodyParser 의 5mb 가 8년 동안 그랬다).
//
// 요청마다 읽는다. require 시점에 한 번 읽으면, 이 모듈이 mobius.js 보다
// 먼저 로드되는 경우(테스트가 그렇다) 전역을 못 본 채로 굳는다.
var BODY_LIMIT_DEFAULT = 10 * 1024 * 1024;
function limit() {
    return (typeof global.max_body_bytes === 'number' && global.max_body_bytes > 0)
        ? global.max_body_bytes : BODY_LIMIT_DEFAULT;
}

function too_large(request, response, size) {
    console.error('[body_limit] ' + request.method + ' ' + request.url +
                  '  ' + size + ' > ' + limit() + ' bytes' +
                  '  origin=' + (request.headers['x-m2m-origin'] || '?'));
    var r = reason.get('413-1');
    responder.respond(request, response, { code: r.code, dbg: r.msg }, function () {});
}

function collect(request, response, next) {
    // (1) 보낸 쪽이 스스로 밝힌 크기가 이미 상한을 넘으면 여기서 끝낸다.
    //     본문을 기다리지 않으므로 응답이 확실히 닿는다.
    var declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit()) {
        too_large(request, response, declared);
        return;
    }

    var chunks = [];
    var size = 0;
    var over = false;      // 상한을 넘겼다. 남은 것은 읽어서 버린다.
    var done = false;

    function on_data(chunk) {
        if (done) { return; }
        size += chunk.length;
        if (over) { return; }                       // 버리는 중 — 세기만 한다
        if (size > limit()) {
            // (2) Content-Length 가 없거나 거짓이었다. 모은 것을 버리고
            //     끝까지 읽어 준 뒤에 답한다. 여기서 소켓을 죽이면 상대가
            //     413 을 읽기 전에 ECONNRESET 을 받는다(실측).
            over = true;
            chunks = null;
            return;
        }
        chunks.push(chunk);
    }

    function on_end() {
        if (done) { return; }
        done = true;
        detach();
        if (over) {
            too_large(request, response, size);
            return;
        }
        // 여기가 유일한 디코드 지점이다. 조각 경계가 글자를 가르지 못한다.
        request.body = Buffer.concat(chunks, size).toString('utf8');
        chunks = null;
        next();
    }

    // 요청이 중간에 끊기면 'end' 는 오지 않는다. 여기서 정리하지 않으면
    // 모아 둔 조각이 소켓 타임아웃까지 살아 있다.
    function on_gone() {
        if (done) { return; }
        done = true;
        chunks = null;
        detach();
    }

    function detach() {
        request.removeListener('data', on_data);
        request.removeListener('end', on_end);
        request.removeListener('aborted', on_gone);
        request.removeListener('error', on_gone);
    }

    request.on('data', on_data);
    request.on('end', on_end);
    request.on('aborted', on_gone);
    request.on('error', on_gone);
}
// Express 미들웨어. app.js 의 네 라우트가 이것 하나를 쓴다.
exports.collect = collect;

// 테스트가 기본값을 확인할 수 있게 열어 둔다. 런타임에는 안 쓴다.
exports.DEFAULT_LIMIT = BODY_LIMIT_DEFAULT;
