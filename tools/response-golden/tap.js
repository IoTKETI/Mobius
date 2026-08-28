'use strict';
// responder 의 응답 함수 4개를 감싸 실제로 나간 (status, rsc, dbg) 를 기록한다.
// 동작은 바꾸지 않는다 — 원본을 그대로 호출하고 기록만 덧붙인다.
//
// 시나리오 러너가 X-Golden-Case 헤더로 케이스 이름을 붙여 준다. 리소스 이름에
// 타임스탬프가 들어가 경로가 실행마다 달라지므로, 경로가 아니라 이 이름으로 키를 잡는다.
//
// 워커마다 프로세스가 다르므로 pid 별 파일에 쓴다. collect.js 가 합친다.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

// 어떤 함수를 거쳤는지가 아니라 "어떤 채널로 나갔는지"를 기록한다.
// 함수 이름을 그대로 쓰면 내부 구현을 바꿀 때마다 골든이 깨진다. 실제로 에러
// 경로가 error_result 에서 respond 로 옮겨가자 24케이스 중 13이 사라졌다.
// 우리가 지키려는 것은 클라이언트가 받는 (status, rsc, dbg) 이지 함수 이름이 아니다.
const CHANNEL = {
    response_result:      'result',
    response_rcn3_result: 'rcn3',
    search_result:        'search',
    error_result:         'error',   // 옛 시그니처 어댑터
    respond:              'error'    // 새 진입점 — 같은 채널로 본다
};

function install() {
    try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) { /* 이미 있음 */ }

    const responder = require('../../mobius/responder');
    if (responder.__respTapped) { return; }
    responder.__respTapped = true;

    const stream = fs.createWriteStream(
        path.join(OUT_DIR, 'resp-' + process.pid + '.jsonl'), { flags: 'a' });

    let installed = 0;
    Object.keys(CHANNEL).forEach(function (name) {
        const orig = responder[name];
        if (typeof orig !== 'function') {
            // respond 는 아직 없을 수 있다(단일 진입점 도입 전). 조용히 넘어간다.
            return;
        }
        installed++;
        responder[name] = function (request, response, a3, a4) {
            try {
                const h = (request && request.headers) || {};
                let status, rsc, dbg;

                if (name === 'respond') {
                    // respond(request, response, result, callback)
                    const code = (a3 && a3.code) || {};
                    status = code.http;
                    rsc = code.rsc;
                    dbg = a3 ? a3.dbg : null;
                } else {
                    // (request, response, status, rsc, dbg|cap, callback)
                    status = a3;
                    rsc = a4;
                    // error_result 의 dbg 만 응답 본문에 실린다. cap 은 형태가 제각각이라
                    // 문자열일 때만 남긴다 (객체를 통째로 남기면 diff 가 흔들린다).
                    dbg = (typeof arguments[4] === 'string') ? arguments[4] : null;
                }

                stream.write(JSON.stringify({
                    case: h['x-golden-case'] || '(unlabeled)',
                    fn: CHANNEL[name],
                    status: String(status),
                    rsc: String(rsc),
                    arg5: (typeof dbg === 'string') ? dbg : null,
                    method: String((request && request.method) || '')
                }) + '\n');
            } catch (e) {
                // 기록 실패가 응답을 막아서는 안 된다
                console.error('[resp-tap] ' + e.message);
            }
            return orig.apply(this, arguments);
        };
    });

    console.error('[resp-tap] installed (' + installed + ' fns, pid ' + process.pid + ')');
}

module.exports = { install: install, OUT_DIR: OUT_DIR };
