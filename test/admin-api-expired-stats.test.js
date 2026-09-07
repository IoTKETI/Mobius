'use strict';
// 만료 화면의 정책 상수 두 개(AUTO_DELETED_RISKY·ET_EXTENDABLE)가 코어와 어긋나
// 있었다(목적 문서 §0층). 이제 화면은 이 라우트만 본다. 통계는 코어의 공개 경로
// (/hit·/total_*)를 지운 자리다 — 세션 뒤에서만 나간다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { boot } = require('./admin_app_helper');
const policy = require(path.join(__dirname, '..', 'mobius', 'expiry_policy'));

test('/api/expired/policy 는 코어 함수의 값 그대로다', async function () {
    const h = await boot({});
    try {
        await h.login();
        const r = await h.request('GET', '/api/expired/policy');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.etExtendableTypes, policy.etExtendableTypes());
        assert.deepStrictEqual(r.body.autoDeletedTypes, policy.autoDeletedTypes());
        assert.deepStrictEqual(r.body.undeletableTypes, [5]);
        assert.strictEqual(r.body.typeNames['2'], 'ae');
    } finally { await h.close(); }
});

test('et 연장 작업은 정책 함수로 타입을 가른다 — fcnt 는 되고 cin 은 건너뛴다', async function () {
    const h = await boot({
        execute: function (sql, bindings) {
            // select_lookup(ri) — 대상의 타입을 돌려준다.
            if (/from `lookup`/.test(sql)) {
                const ri = bindings[0];
                return [{ ri: ri, ty: ri.endsWith('/f') ? '28' : '4', et: '20990101T000000' }];
            }
            return [];
        },
        cse: { status: 200, rsc: '2004', body: {} }
    });
    try {
        await h.login();
        const r = await h.request('POST', '/api/jobs/expired-extend', { ris: ['/M/a/f', '/M/a/c/4-1'], et: '20991231T000000' });
        assert.strictEqual(r.status, 202);
        const id = r.body.id;
        let job;
        for (let i = 0; i < 200; i++) {
            job = (await h.request('GET', '/api/jobs/' + id)).body;
            if (job.state !== 'running') { break; }
            await new Promise((res) => setTimeout(res, 10));
        }
        assert.strictEqual(job.state, 'done');
        assert.strictEqual(job.ok, 1, 'fcnt 는 연장된다 — 예전 상수는 이것을 막았다');
        assert.strictEqual(job.skipped, 1, 'cin 은 건너뛴다');
        assert.match(job.skips[0].reason, /CIN/);
        const put = h.cse.calls.find((c) => c.method === 'PUT');
        assert.strictEqual(put.path, '/M/a/f');
        assert.deepStrictEqual(put.body, { 'm2m:fcnt': { et: '20991231T000000' } });
    } finally { await h.close(); }
});

test('/api/stats/* 는 세션 뒤에서 hit·AE 수·CIN 바이트 총합을 준다', async function () {
    const h = await boot({
        execute: function (sql) {
            if (/from `hit`/.test(sql)) { return [{ ct: '20260905', http: 100, mqtt: 5, coap: 0, ws: 0 }]; }
            if (/count\(\*\) from ae/.test(sql)) { return [{ 'count(*)': 42 }]; }
            if (/sum\(cbs\) from cnt/.test(sql)) { return [{ 'sum(cbs)': 123456 }]; }
            return [];
        }
    });
    try {
        assert.strictEqual((await h.request('GET', '/api/stats/hit')).status, 401);
        await h.login();
        const hit = await h.request('GET', '/api/stats/hit');
        assert.strictEqual(hit.status, 200);
        assert.deepStrictEqual(hit.body.rows, [{ ct: '20260905', http: 100, mqtt: 5, coap: 0, ws: 0 }]);
        assert.match(hit.body.asOf, /^\d{8}T\d{6}$/);
        assert.deepStrictEqual((await h.request('GET', '/api/stats/total-ae')).body, { total: 42 });
        assert.deepStrictEqual((await h.request('GET', '/api/stats/total-cbs')).body, { total: 123456 });
    } finally { await h.close(); }
});
