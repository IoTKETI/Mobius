/**
 * 3단계 13번 — (fu, rcn) 게이트 표가 옛 네 조건식과 정확히 같다.
 *
 * 옛 조건식을 글자 그대로 옮겨 적고(아래 OLD), 표 기반 판정과 fu × rcn 값의
 * 격자에서 전수 대조한다. 격자에는 숫자·문자열·'01'·' 1'·''·undefined·null·
 * true·NaN 처럼 느슨한 비교(`==`)에서 갈릴 수 있는 값을 넣는다 — 표로 옮기며
 * 비교를 엄격하게 바꾸면 여기서 드러난다.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const gate = require('../mobius/route_gate');

// app.js 3단계 13번 전의 네 조건식 — 글자 그대로
const OLD = {
    POST:   (q) => (q.fu == 2) && (q.rcn == 0 || q.rcn == 1 || q.rcn == 2 || q.rcn == 3),
    GET:    (q) => (q.fu == 1 || q.fu == 2) && (q.rcn == 1 || q.rcn == 4 || q.rcn == 5 || q.rcn == 6 || q.rcn == 7),
    PUT:    (q) => (q.fu == 2) && (q.rcn == 0 || q.rcn == 1),
    DELETE: (q) => (q.fu == 2) && (q.rcn == 0 || q.rcn == 1)
};
const REJECT = { POST: '400-43', GET: '400-44', PUT: '400-45', DELETE: '400-46' };

const VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 32, -1, 1.5, NaN, Infinity,
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '01', ' 1', '1 ', '1.0', '2.0', '', ' ', 'a', '1a',
    undefined, null, true, false, [], [1], {}, ['2']];

test('표 판정이 옛 조건식과 fu × rcn 격자에서 전부 같다', () => {
    let n = 0;
    Object.keys(OLD).forEach((m) => {
        VALUES.forEach((fu) => {
            VALUES.forEach((rcn) => {
                const q = { fu: fu, rcn: rcn };
                const want = OLD[m](q) ? null : REJECT[m];
                assert.strictEqual(gate.reject(m, q), want, m + ' fu=' + String(fu) + ' rcn=' + String(rcn));
                n++;
            });
        });
    });
    assert.ok(n >= 4 * VALUES.length * VALUES.length);
});

test('표의 값이 설계 그대로다 — POST 의 rcn 에는 2 도 있다', () => {
    // 설계 문서의 표는 POST rcn 을 [0,1,3] 으로 적었는데 실제 코드는 2 도 허용한다.
    // 코드가 진실이다 — 옮기면서 문서를 믿으면 rcn=2 요청이 400 을 새로 받는다.
    assert.deepStrictEqual(gate.GATE.POST, { fu: [2], rcn: [0, 1, 2, 3], reject: '400-43' });
    assert.deepStrictEqual(gate.GATE.GET, { fu: [1, 2], rcn: [1, 4, 5, 6, 7], reject: '400-44' });
    assert.deepStrictEqual(gate.GATE.PUT, { fu: [2], rcn: [0, 1], reject: '400-45' });
    assert.deepStrictEqual(gate.GATE.DELETE, { fu: [2], rcn: [0, 1], reject: '400-46' });
});

test('모르는 메서드는 던진다 — 표에 없는 라우트가 조용히 통과하면 안 된다', () => {
    assert.throws(() => gate.reject('PATCH', { fu: 2, rcn: 1 }), TypeError);
});

test('app.js 라우트에 옛 조건식이 남아 있지 않다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    assert.strictEqual((src.match(/request\.query\.rcn == \d/g) || []).length, 0, '라우트의 rcn 조건식이 되살아났다');
    assert.strictEqual((src.match(/route_gate\.reject\(/g) || []).length, 1, '게이트 판정은 run_operation 한 곳');
});
