/**
 * 남은 일 §4.1 — 응답을 정산한 뒤에도 요청 커넥션 위에서 도는 쓰기가 없어야 한다.
 *
 * resource.js 세 곳이 부모의 st 를 갱신하면서 **빈 콜백**을 주고 그것을 기다리지 않은
 * 채 상위 콜백('200')을 불렀다. 상위는 settle 로 이어져 응답을 보내고 커넥션을
 * 반납한다 — 아직 그 커넥션 위에서 UPDATE 가 돌고 있는데 반납한다. mysql2 는
 * 커넥션마다 명령 큐 하나라 다음 요청이 그 커넥션을 빌리면 남의 UPDATE 뒤에 선다.
 *
 * 규칙: `db_sql.update_parent_*(…, function (…) { … })` 의 콜백 본문 안에서
 * 상위 callback 을 불러야 한다. 빈 콜백 뒤에 바깥에서 부르는 모양이 되살아나면 실패한다.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');

// 호출 시작 위치에서 괄호가 닫히는 자리까지 잘라 준다
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
        // 콜백 본문(마지막 인자)에 상위 callback 호출이 있어야 한다
        if (!/function\s*\([^)]*\)\s*\{[\s\S]*callback\(/.test(call)) {
            bad.push('resource.js:' + line + ' ' + m[0] + ' 콜백 안에서 callback 을 부르지 않는다');
        }
        // 빈 콜백(function () { }) 은 그 자체로 금지
        if (/function\s*\([^)]*\)\s*\{\s*\}/.test(call)) {
            bad.push('resource.js:' + line + ' ' + m[0] + ' 빈 콜백');
        }
    }
    assert.ok(n >= 4, 'update_parent_* 호출을 ' + n + '곳만 찾았다 — 이 시험의 전제가 바뀌었다');
    assert.deepStrictEqual(bad, [], '응답 뒤 커넥션 위에서 도는 쓰기:\n  ' + bad.join('\n  '));
});

test("카탈로그에 없는 코드 '400' 을 올리는 자리가 없다 (§3.1)", () => {
    // reason.get('400') 은 null 이라 500 'unknown result code' 가 된다.
    // rcn=7 discovery 가 그렇게 500 을 받았다 — 그것도 discovery 를 다 돌린 뒤에.
    assert.strictEqual((src.match(/callback\('400'\)/g) || []).length, 0);
    assert.ok(/request\.query\.fu != 1 &&[\s\S]{0,200}callback\('400-44'\);\s*return;/.test(src),
              'retrieve 가 discovery 를 돌리기 전에 모양 없는 (fu, rcn) 을 400-44 로 거절해야 한다');
});
