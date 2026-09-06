'use strict';
// AE-ID(aei) 정책 — 형식은 검사하지 않고, 길이만 이 CSE 의 저장 한계로 막는다.
//
// 사용자 결정(2026-09-06). oneM2M 은 AE-ID 가 S/C 로 시작한다고 하지만, 사용자들은
// oneM2M 을 모르므로 "S/C 로 시작하지 않는다" 는 오류를 받아도 대처하지 못했다. 그리고
// S/C 형식을 강제하면 사용자가 만들 수 있는 id 가 제한된다. 배포에도 S/C 로 시작하지 않는
// aei 가 13개 있다. 그래서 X-M2M-Origin 이 정확히 'S' 나 'C' 일 때만 CSE 가 만들고, 그 밖의
// 값은 **그대로** aei 로 받는다. 이 시험은 그 결정이 조용히 "고쳐지는" 것을 막는다.
//
// 길이는 다르다 — oneM2M 이 정한 것이 없어도 저장소(lookup.sri · ae.aei)에 폭이 있다.
// 넘으면 DB 의 500 이 아니라 400 으로, 문구에 이 CSE 의 한계라고 적어 준다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
global.NOPRINT = 'true';
const ae = require('../mobius/ae');

function build(origin) {
    return new Promise((resolve) => {
        const request = { headers: { rootnm: 'ae', 'x-m2m-origin': origin } };
        const resource_Obj = { ae: {} };
        ae.build_ae(request, {}, resource_Obj, { ae: {} }, (code) => resolve({ code, aei: request.resourceObj && request.resourceObj.ae.aei }));
    });
}

test("정확히 'S' / 'C' 면 CSE 가 만든다 — short_ri 모양", async () => {
    const s = await build('S');
    assert.strictEqual(s.code, '200');
    assert.match(s.aei, /^S\d{17}[0-9a-z]+$/, s.aei);
    const c = await build('C');
    assert.match(c.aei, /^C\d{17}[0-9a-z]+$/, c.aei);
});

test('그 밖의 값은 형식을 보지 않고 그대로 aei 다 — S/C 로 시작하지 않아도, 슬래시가 있어도', async () => {
    for (const id of ['myDevice-01', 'admin', '/Mobius/gateway', 'demo.keti.re.kr', 'Sabc', 'CmyApp']) {
        const r = await build(id);
        assert.strictEqual(r.code, '200', id);
        assert.strictEqual(r.aei, id);
    }
});

test('길이만 막는다 — 46자는 400-70', async () => {
    assert.strictEqual((await build('S'.repeat(45))).code, '200');
    const r = await build('x'.repeat(46));
    assert.strictEqual(r.code, '400-70');
});

test('소스에 형식 검사가 되살아나지 않는다 — 결정이 주석으로 적혀 있다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'ae.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /charAt\(0\)|startsWith\(|\/\^\[SC\]|\[SC\]\//, 'origin 의 첫 글자를 검사한다 — 형식 검사는 안 하기로 했다');
    assert.match(src, /형식(은|을) 검사하지 않는다/, '결정과 이유가 ae.js 에 적혀 있어야 한다');
});
