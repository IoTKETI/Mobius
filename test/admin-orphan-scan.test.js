'use strict';
// 고아 탐지는 화면에서 라이브로 돌리지 않는다(설계 §명시적 비목표, 배포 lookup 5,740만 행).
// 작업으로 조각내어 상한까지만 훑고 결과 파일을 남긴다. 화면은 마지막 결과만 본다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { boot } = require('./admin_app_helper');

function settled(h, id) {
    return (async function poll() {
        for (let i = 0; i < 500; i++) {
            const j = (await h.request('GET', '/api/jobs/' + id)).body;
            if (j.state !== 'running') { return j; }
            await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error('작업이 끝나지 않는다');
    }());
}

test('조각으로 훑어 표본을 파일에 남기고 /api/orphans/last 가 그것을 준다', async function () {
    // lookup 을 ri 키셋으로 읽는다. 1~30 번 행 중 부모가 없는 것은 10, 20 이다.
    const rows = [];
    for (let i = 1; i <= 30; i++) { rows.push({ ri: '/M/r' + String(i).padStart(3, '0'), pi: (i % 10 === 0) ? '/M/gone' + i : '/M', ty: '3', rn: 'r' + i, ct: '20260901T000000', lt: '', et: '' }); }
    const h = await boot({
        execute: function (sql, bindings) {
            if (/from `lookup`/.test(sql) && /`ri` > \?/.test(sql)) {
                const after = bindings[bindings.length - 2] !== undefined && typeof bindings[0] === 'string' ? bindings[0] : '';
                return rows.filter((r) => r.ri > after).slice(0, 1000);
            }
            if (/from `lookup`/.test(sql) && /in \(/.test(sql)) {
                // 부모 존재 확인: '/M' 만 있다.
                return bindings.filter((b) => b === '/M').map((ri) => ({ ri }));
            }
            if (/from `cin`/.test(sql)) { return []; }
            return [];
        }
    });
    try {
        await h.login();
        const start = await h.request('POST', '/api/jobs/orphan-scan', { scanCap: 100, sampleCap: 50 });
        assert.strictEqual(start.status, 202, JSON.stringify(start.body));
        const job = await settled(h, start.body.id);
        assert.strictEqual(job.state, 'done');
        assert.strictEqual(job.kind, 'orphan-scan');

        const last = await h.request('GET', '/api/orphans/last');
        assert.strictEqual(last.status, 200);
        assert.deepStrictEqual(last.body.orphans.map((o) => o.ri), ['/M/r010', '/M/r020', '/M/r030']);
        assert.strictEqual(last.body.scanCapped, false);
        assert.ok(last.body.scanned >= 30);
        assert.ok('lookupOnlyCin' in last.body);
        assert.strictEqual(last.body.typeNames['3'], 'cnt');
        assert.ok(fs.existsSync(path.join(h.dataDir, 'orphans', last.body.runId + '.json')));

        // 옛 라이브 경로는 없다.
        assert.strictEqual((await h.request('GET', '/api/orphans')).status, 404);
        assert.strictEqual((await h.request('GET', '/api/orphans/summary')).status, 404);
    } finally { await h.close(); }
});

test('결과가 없으면 none', async function () {
    const h = await boot({});
    try {
        await h.login();
        const r = await h.request('GET', '/api/orphans/last');
        assert.deepStrictEqual(r.body, { none: true });
    } finally { await h.close(); }
});
