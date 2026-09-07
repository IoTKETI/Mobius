'use strict';
/*
 * Keeps operational logs free of whole bodies.
 *
 * Logging rule: never dump a whole response body or DB row per request.
 *
 * Two concerns:
 *   volume    the deployment serves hundreds of thousands of HTTP requests per day; whole bodies bury real errors and exhaust rotation within days.
 *   content   bodies carry sensor values and personal data; headers carry X-M2M-Origin, which may be the superuser (the master key that skips every ACP check).
 *
 * The rule is 'do not log the whole body', not 'do not log'. Status code, length and target address are fine for diagnosis.
 *
 * Fix when caught:
 *     console.log(responseBody)
 *  -> console.log('<----- [pxy_coap] rsc=' + rsc + '  ' + responseBody.length + ' chars')
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Things that must not be passed whole; the names refer to bodies, headers and result sets.
//
// Only the `console.log(x)` form with a single variable is caught. Concatenations (`'... ' + x.length`) pass; that is the recommended form.
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
        // test/ and tools/ are run by people and are excluded.
        .filter((f) => f.indexOf('test/') !== 0 && f.indexOf('tools/') !== 0);
}

test('요청·응답 본문을 통째로 로그에 찍는 자리가 없다', function () {
    const hits = [];
    for (const f of sourceFiles()) {
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
        lines.forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }   // comments are not counted
            if (WHOLE_DUMP.test(l)) { hits.push(f + ':' + (i + 1) + '  ' + l.trim()); }
        });
    }
    assert.deepStrictEqual(hits, [],
        '본문·헤더를 통째로 찍는 자리가 있다. 길이와 식별자만 남길 것:\n  ' +
        hits.join('\n  '));
});

test('나가는 요청·응답 로그에 길이가 남는다 — 진단을 없애자는 것이 아니다', function () {
    // Checks what remains after the body was removed. Removing everything makes 'response arrived empty' indistinguishable from 'no response'.
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

    // A long log line may be split over two lines, so the marker is searched within the following 200 characters (newlines included).
    for (const [name, src, marker] of [
        ['app.js  forward_http', app,  '\\[forward_http\\]']
    ]) {
        assert.ok(new RegExp(marker + '[\\s\\S]{0,200}?length').test(src),
            name + ' 의 로그에 길이가 없다 — 본문을 지우면서 진단까지 지웠다');
    }
});

