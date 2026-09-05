'use strict';
// responder 의 **배출구 하나**(respond)를 감싸 실제로 나간 (status, rsc, dbg) 를 기록한다.
// 동작은 바꾸지 않는다 — 원본을 그대로 호출하고 기록만 덧붙인다.
//
// 시나리오 러너가 X-Golden-Case 헤더로 케이스 이름을 붙여 준다. 리소스 이름에
// 타임스탬프가 들어가 경로가 실행마다 달라지므로, 경로가 아니라 이 이름으로 키를 잡는다.
//
// 워커마다 프로세스가 다르므로 pid 별 파일에 쓴다. collect.js 가 합친다.
//
// ── 왜 respond 하나만 감싸나 ──────────────────────────────────────────────
// 예전에는 response_result / response_rcn3_result / search_result / error_result /
// respond 다섯을 감쌌다. 1단계 2번(85dcc6c) 뒤로 응답 바이트가 전선에 실리는 자리는
// respond 하나고, 옛 세 함수도 respond 를 거친다 — 그래서 한 응답이 **두 줄**로
// 남았고(옛 함수 한 줄 + respond 한 줄), respond 쪽은 성공 spec 에 code 가 없어
// status 가 'undefined' 로 찍혔다. 2단계에서 생산자가 out 을 주어 옛 함수를
// 안 거치면 줄 수가 달라져 **같은 바이트인데 diff 가 뜬다.** 우리가 지키려는 것은
// 클라이언트가 받는 (status, rsc, dbg) 이지 어느 함수를 거쳤는가가 아니다.
//
// respond(request, response, spec, done) 의 spec 은
//   에러  { code: <rsc.js 카탈로그 항목>, dbg, detail }
//   성공  { status, rsc, body, headers }
// 둘 중 하나다. code 가 있으면 에러다.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

function install() {
    try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) { /* 이미 있음 */ }

    const responder = require('../../mobius/responder');
    if (responder.__respTapped) { return; }
    responder.__respTapped = true;

    const orig = responder.respond;
    if (typeof orig !== 'function') {
        console.error('[resp-tap] responder.respond 가 없다 — 기록하지 않는다');
        return;
    }

    const stream = fs.createWriteStream(
        path.join(OUT_DIR, 'resp-' + process.pid + '.jsonl'), { flags: 'a' });

    responder.respond = function (request, response, spec) {
        try {
            const h = (request && request.headers) || {};
            const err = spec && spec.code;
            stream.write(JSON.stringify({
                case: h['x-golden-case'] || '(unlabeled)',
                fn: err ? 'error' : 'ok',
                status: String(err ? err.http : (spec && spec.status)),
                rsc: String(err ? err.rsc : (spec && spec.rsc)),
                arg5: (spec && typeof spec.dbg === 'string') ? spec.dbg : null,
                method: String((request && request.method) || '')
            }) + '\n');
        } catch (e) {
            // 기록 실패가 응답을 막아서는 안 된다
            console.error('[resp-tap] ' + e.message);
        }
        return orig.apply(this, arguments);
    };

    console.error('[resp-tap] installed (respond, pid ' + process.pid + ')');
}

module.exports = { install: install, OUT_DIR: OUT_DIR };
