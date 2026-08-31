'use strict';
/*
 * 운영 로그가 본문으로 뒤덮이지 않게 한다.
 *
 * CLAUDE.md 의 로깅 규약:
 *
 *   **요청마다 응답 본문이나 DB 행 전체를 덤프하지 않는다** — 운영 로그가
 *   밀려 장애 분석이 불가능해진 전례가 있다
 *
 * 두 가지가 걸린다.
 *
 *   로그량   배포는 하루 HTTP 요청 30만 건대다. 본문을 통째로 찍으면 실제
 *            오류가 그 사이에 묻힌다. 로테이션이 돌면 며칠 못 간다.
 *   내용     본문에는 센서 값·개인정보가 들어간다. 헤더에는 X-M2M-Origin 이
 *            들어가고, 그 값이 수퍼유저(모든 ACP 를 건너뛰는 마스터 키)일 수 있다.
 *
 * 이 시험은 "찍지 마라" 가 아니라 **"본문을 통째로 찍지 마라"** 다.
 * 상태코드·길이·대상 주소는 얼마든지 남겨도 된다 — 진단은 그것으로 된다.
 *
 * 걸렸을 때 고치는 법:
 *     console.log(responseBody)
 *  -> console.log('<----- [pxy_coap] rsc=' + rsc + '  ' + responseBody.length + '자')
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// 통째로 넘기면 안 되는 것들. 이름이 본문·헤더·결과셋을 가리킨다.
//
// `console.log(x)` 처럼 **변수 하나만** 넘기는 형태만 잡는다.
// 문자열과 이어 붙인 것(`'... ' + x.length`)은 통과한다 — 그게 권장 형태다.
const WHOLE_DUMP = new RegExp(
    'console\\.(log|error)\\(\\s*(' +
    [
        'fullBody', 'responseBody', 'bodyString', 'f_body', 'f_headers',
        'res\\.body', 'res\\.headers', 'request\\.body', 'req\\.body',
        'body_Obj', 'rsp_message', 'req_message',
        'message\\.utf8Data', 'message\\.binaryData',
        '[a-zA-Z_]*[Bb]ody', '[a-zA-Z_]*[Hh]eaders'
    ].join('|') +
    ')\\s*\\)'
);

function sourceFiles() {
    return cp.execSync('git ls-files "*.js"', { cwd: ROOT }).toString()
        .split(/\r?\n/).filter(Boolean)
        // test/ 와 tools/ 는 사람이 보려고 돌리는 것이라 제외한다.
        .filter((f) => f.indexOf('test/') !== 0 && f.indexOf('tools/') !== 0);
}

test('요청·응답 본문을 통째로 로그에 찍는 자리가 없다', function () {
    const hits = [];
    for (const f of sourceFiles()) {
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
        lines.forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }   // 주석은 세지 않는다
            if (WHOLE_DUMP.test(l)) { hits.push(f + ':' + (i + 1) + '  ' + l.trim()); }
        });
    }
    assert.deepStrictEqual(hits, [],
        '본문·헤더를 통째로 찍는 자리가 있다. 길이와 식별자만 남길 것:\n  ' +
        hits.join('\n  '));
});

test('나가는 요청·응답 로그에 길이가 남는다 — 진단을 없애자는 것이 아니다', function () {
    // 본문을 뺀 대신 무엇이 남았는지 확인한다. 전부 지워 버리면
    // "응답이 왔는데 비어 있었다" 와 "응답이 안 왔다" 를 구분할 수 없다.
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const coap = fs.readFileSync(path.join(ROOT, 'pxy_coap.js'), 'utf8');
    const ws = fs.readFileSync(path.join(ROOT, 'pxy_ws.js'), 'utf8');

    // 로그 한 줄이 길어 두 줄로 나뉘는 경우가 있다. 줄 단위로 보면 놓치므로
    // 표지 뒤 200자 안에서 찾는다(줄바꿈 포함).
    for (const [name, src, marker] of [
        ['app.js  notify_http',  app,  '\\[notify_http\\]'],
        ['app.js  forward_http', app,  '\\[forward_http\\]'],
        ['pxy_coap.js',          coap, '\\[pxy_coap\\]'],
        ['pxy_ws.js',            ws,   '\\[pxy_ws\\]']
    ]) {
        assert.ok(new RegExp(marker + '[\\s\\S]{0,200}?length').test(src),
            name + ' 의 로그에 길이가 없다 — 본문을 지우면서 진단까지 지웠다');
    }
});

test('pxy_ws 가 프레임을 hex 로 통째로 찍지 않는다', function () {
    // 바이너리 프레임을 hex 로 찍으면 바이트당 두 글자라 **본문의 두 배**가 된다.
    const src = fs.readFileSync(path.join(ROOT, 'pxy_ws.js'), 'utf8');
    const lines = src.split(/\r?\n/);
    const bad = [];
    lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
        if (/console\.(log|error)\([^)]*toString\('hex'\)/.test(l)) {
            bad.push('pxy_ws.js:' + (i + 1) + '  ' + l.trim());
        }
    });
    assert.deepStrictEqual(bad, [], bad.join('\n  '));
});
