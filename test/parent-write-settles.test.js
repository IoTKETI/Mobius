/**
 * No write may still run on the request connection after the response has been settled.
 *
 * The three parent st updates in resource.js must call the upper callback inside the update callback. Calling it outside, after an empty callback, returns the connection while the UPDATE is still running; mysql2 has one command queue per connection, so the next borrower would queue behind it.
 *
 * Rule: the upper callback is called inside the callback body of `db_sql.update_parent_*(..., function (...) { ... })`.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');

// Slices from the call start to the closing parenthesis.
function callText(at) {
    let depth = 0, i = src.indexOf('(', at);
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '(' || c === '{' || c === '[') { depth++; }
        else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) { return src.slice(at, i + 1); } }
    }
    return src.slice(at);
}

test('부모 st/카운터 갱신의 콜백 안에서 응답한다 — 빈 콜백 뒤 즉시 응답 금지', () => {
    const re = /db_sql\.update_parent_(st|counters)\(/g;
    let m, n = 0;
    const bad = [];
    while ((m = re.exec(src)) !== null) {
        n++;
        const call = callText(m.index);
        const line = src.slice(0, m.index).split('\n').length;
        // The callback body (last argument) must call the upper callback.
        if (!/function\s*\([^)]*\)\s*\{[\s\S]*callback\(/.test(call)) {
            bad.push('resource.js:' + line + ' ' + m[0] + ' 콜백 안에서 callback 을 부르지 않는다');
        }
        // An empty callback (function () { }) is forbidden outright.
        if (/function\s*\([^)]*\)\s*\{\s*\}/.test(call)) {
            bad.push('resource.js:' + line + ' ' + m[0] + ' 빈 콜백');
        }
    }
    assert.ok(n >= 4, 'update_parent_* 호출을 ' + n + '곳만 찾았다 — 이 시험의 전제가 바뀌었다');
    assert.deepStrictEqual(bad, [], '응답 뒤 커넥션 위에서 도는 쓰기:\n  ' + bad.join('\n  '));
});

test("카탈로그에 없는 코드 '400' 을 올리는 자리가 없다 (§3.1)", () => {
    // reason.get('400') is null and would become a 500 'unknown result code'. rcn=7 discovery must reject with 400-44.
    assert.strictEqual((src.match(/callback\('400'\)/g) || []).length, 0);
    assert.ok(/request\.query\.fu != 1 &&[\s\S]{0,200}callback\('400-44'\);\s*return;/.test(src),
              'retrieve 가 discovery 를 돌리기 전에 모양 없는 (fu, rcn) 을 400-44 로 거절해야 한다');
});
