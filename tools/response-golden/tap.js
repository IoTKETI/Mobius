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

// (request, response, status, rsc, <5번째>, callback)
// error_result 만 5번째가 dbg_string 이고 나머지는 cap 이다.
const TARGETS = ['response_result', 'response_rcn3_result', 'search_result', 'error_result'];

function install() {
    try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) { /* 이미 있음 */ }

    const responder = require('../../mobius/responder');
    if (responder.__respTapped) { return; }
    responder.__respTapped = true;

    const stream = fs.createWriteStream(
        path.join(OUT_DIR, 'resp-' + process.pid + '.jsonl'), { flags: 'a' });

    TARGETS.forEach(function (name) {
        const orig = responder[name];
        if (typeof orig !== 'function') {
            console.error('[resp-tap] ' + name + ' 이 함수가 아니다 — 건너뛴다');
            return;
        }
        responder[name] = function (request, response, status, rsc, arg5) {
            try {
                const h = (request && request.headers) || {};
                stream.write(JSON.stringify({
                    case: h['x-golden-case'] || '(unlabeled)',
                    fn: name,
                    status: String(status),
                    rsc: String(rsc),
                    // error_result 의 dbg 만 응답 본문에 실린다. cap 은 형태가 제각각이라
                    // 문자열일 때만 남긴다 (객체를 통째로 남기면 diff 가 흔들린다).
                    arg5: (typeof arg5 === 'string') ? arg5 : null,
                    method: String((request && request.method) || '')
                }) + '\n');
            } catch (e) {
                // 기록 실패가 응답을 막아서는 안 된다
                console.error('[resp-tap] ' + e.message);
            }
            return orig.apply(this, arguments);
        };
    });

    console.error('[resp-tap] installed (' + TARGETS.length + ' fns, pid ' + process.pid + ')');
}

module.exports = { install: install, OUT_DIR: OUT_DIR };
