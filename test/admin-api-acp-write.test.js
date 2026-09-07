'use strict';
// ACP 를 만들고 AE 에 붙이는 두 쓰기. 둘 다 CSE HTTP 한 번이고 DB 는 프리플라이트로만
// 읽는다. 잠금 단위는 AE 하나다 — 컨테이너·CIN 에는 붙이지 않는다(이전 결정).
const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./admin_app_helper');

function lookup_rows(byRi) {
    return function (sql, bindings) {
        if (/from `lookup`/.test(sql)) {
            const row = byRi[bindings[0]];
            return row ? [row] : [];
        }
        return [];
    };
}

test('create: AE 아래에 ty=1 POST 한 번, 검사에 걸리면 CSE 를 부르지 않는다', async function () {
    const h = await boot({
        execute: lookup_rows({ '/M/ae': { ri: '/M/ae', ty: '2' }, '/M/ae/c': { ri: '/M/ae/c', ty: '3' } }),
        cse: { status: 201, rsc: '2001', body: { 'm2m:acp': { ri: '/M/ae/acp1' } } }
    });
    try {
        await h.login();
        const pv = { acr: [{ acor: ['Cdev'], acop: 63 }] };
        const pvs = { acr: [{ acor: ['Cadmin'], acop: 63 }] };
        const ok = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae', rn: 'acp1', pv, pvs });
        assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
        assert.strictEqual(ok.body.ri, '/M/ae/acp1');
        const post = h.cse.calls[0];
        assert.strictEqual(post.method, 'POST');
        assert.strictEqual(post.path, '/M/ae');
        assert.match(post.headers['content-type'], /;ty=1$/);
        assert.deepStrictEqual(post.body, { 'm2m:acp': { rn: 'acp1', pv, pvs } });

        const n = h.cse.calls.length;
        const badRn = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae', rn: 'a b', pv, pvs });
        assert.strictEqual(badRn.status, 400);
        const badParent = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae/c', rn: 'x', pv, pvs });
        assert.strictEqual(badParent.status, 400);
        assert.match(badParent.body.error, /AE/);
        const badPv = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae', rn: 'x', pv: { acr: [{ acor: ['a'] }] }, pvs });
        assert.strictEqual(badPv.status, 400);
        assert.ok(badPv.body.problems && badPv.body.problems.length);
        assert.strictEqual(h.cse.calls.length, n, '검사에 걸린 요청은 CSE 로 가지 않는다');
    } finally { await h.close(); }
});

test('attach: AE 에 acpi 배열을 PUT 한 번 — 대상·ACP 존재를 먼저 본다', async function () {
    const h = await boot({
        execute: lookup_rows({
            '/M/ae': { ri: '/M/ae', ty: '2' },
            '/M/ae/c': { ri: '/M/ae/c', ty: '3' },
            '/M/ae/acp1': { ri: '/M/ae/acp1', ty: '1' },
            '/M/other/acp9': { ri: '/M/other/acp9', ty: '1' }
        }),
        cse: { status: 200, rsc: '2004', body: {} }
    });
    try {
        await h.login();
        const ok = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae', acpi: ['/M/ae/acp1', '/M/other/acp9'] });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
        const put = h.cse.calls[0];
        assert.strictEqual(put.method, 'PUT');
        assert.strictEqual(put.path, '/M/ae');
        assert.deepStrictEqual(put.body, { 'm2m:ae': { acpi: ['/M/ae/acp1', '/M/other/acp9'] } });

        const n = h.cse.calls.length;
        const notAe = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae/c', acpi: ['/M/ae/acp1'] });
        assert.strictEqual(notAe.status, 400);
        const missing = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae', acpi: ['/M/nope'] });
        assert.strictEqual(missing.status, 400);
        assert.match(missing.body.error, /nope/);
        const tooMany = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae', acpi: Array.from({ length: 8 }, (_, i) => '/M/ae/acp' + i) });
        assert.strictEqual(tooMany.status, 400);
        assert.strictEqual(h.cse.calls.length, n);

        // 빈 배열은 전부 해제다.
        const clear = await h.request('POST', '/api/acp/attach', { targetRi: '/M/ae', acpi: [] });
        assert.strictEqual(clear.status, 200);
        assert.deepStrictEqual(h.cse.calls[h.cse.calls.length - 1].body, { 'm2m:ae': { acpi: [] } });
    } finally { await h.close(); }
});

test('CSE 가 거절하면 그 rsc 를 그대로 전한다', async function () {
    const h = await boot({
        execute: lookup_rows({ '/M/ae': { ri: '/M/ae', ty: '2' } }),
        cse: { status: 403, rsc: '4103', body: { 'm2m:dbg': 'no privilege' } }
    });
    try {
        await h.login();
        // acr:[] 는 validate_privileges 자체가 400-23 으로 막는다(빈 acr — mobius/acp.js:59-61) —
        // 이 시험이 보려는 것은 그 검사가 아니라 CSE 가 거절했을 때의 전달이므로, 검사를
        // 통과하는 최소 pv/pvs 를 쓴다.
        const pv = { acr: [{ acor: ['Cdev'], acop: 2 }] };
        const r = await h.request('POST', '/api/acp/create', { parentRi: '/M/ae', rn: 'x', pv: pv, pvs: pv });
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.body.rsc, '4103');
    } finally { await h.close(); }
});
