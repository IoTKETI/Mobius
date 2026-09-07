'use strict';
// AE-ID (aei) policy: the format is not checked; only the length is limited to this CSE's storage.
//
// The CSE assigns an aei only when X-M2M-Origin is exactly 'S' or 'C'; any other value is taken as the aei as is. This test keeps that decision from being 'fixed' silently.
//
// Length is different: the storage (lookup.sri, ae.aei) has a width, and exceeding it is a 400 whose message names this CSE's limit, not a DB 500.

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

test('길이만 막는다 — 200자는 통과, 201자는 400-70', async () => {
    assert.strictEqual((await build('S'.repeat(200))).code, '200');
    const r = await build('x'.repeat(201));
    assert.strictEqual(r.code, '400-70');
});

test('소스에 형식 검사가 되살아나지 않는다 — 결정이 주석으로 적혀 있다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'ae.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /charAt\(0\)|startsWith\(|\/\^\[SC\]|\[SC\]\//, 'origin 의 첫 글자를 검사한다 — 형식 검사는 안 하기로 했다');
    assert.match(src, /format is not checked/, '결정과 이유가 ae.js 에 적혀 있어야 한다');
});
