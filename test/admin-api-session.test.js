'use strict';
// 콘솔 라우트를 실제 express 앱으로 띄워 검사한다. 이전에는 server.js 가 conf 를
// 읽고 DB 에 붙고 listen 까지 한 파일에서 해서 라우트를 시험할 수 없었다 —
// api.js 로 가른 이유다.
const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./admin_app_helper');

test('세션 없이는 401, 로그인 뒤에는 세션 정보 — discoveryFilter 까지', async function () {
    const h = await boot({ conf: { adminPassword: 'pw', acpDiscoveryFilter: 'off', acpObserveMode: 'observe' } });
    try {
        const anon = await h.request('GET', '/api/session');
        assert.strictEqual(anon.status, 401);

        const bad = await h.login('nope');
        assert.strictEqual(bad.status, 401);

        const ok = await h.login('pw');
        assert.strictEqual(ok.status, 200);
        const s = await h.request('GET', '/api/session');
        assert.strictEqual(s.status, 200);
        assert.strictEqual(s.body.backend, 'mysql');
        assert.strictEqual(s.body.write.enabled, true);
        assert.strictEqual(s.body.write.superuser, true);
        assert.strictEqual(s.body.acp.observeMode, 'observe');
        // 위반 4 — 'off' 면 잠근 경로가 discovery 에 새서 시뮬레이터가 보호를 과장한다.
        assert.strictEqual(s.body.acp.discoveryFilter, 'off');
        assert.ok(!('origin' in s.body.write), 'origin 값은 내려보내지 않는다 — superUser 는 공유 비밀이다');
    } finally { await h.close(); }
});

test('로그아웃하면 같은 쿠키로 401', async function () {
    const h = await boot({});
    try {
        await h.login();
        await h.request('POST', '/api/logout');
        const s = await h.request('GET', '/api/session');
        assert.strictEqual(s.status, 401);
    } finally { await h.close(); }
});

test('기존 라우트가 살아 있다 — 작업 목록·ACP 검사·만료 요약', async function () {
    const h = await boot({
        execute: function (sql) {
            // 만료 요약: count_expired_by_type 의 배치 SELECT → 빈 결과면 0건으로 끝난다.
            return [];
        }
    });
    try {
        await h.login();
        const jobs = await h.request('GET', '/api/jobs');
        assert.deepStrictEqual(jobs.body, { jobs: [] });
        const sum = await h.request('GET', '/api/expired/summary');
        assert.strictEqual(sum.status, 200);
        assert.strictEqual(sum.body.counted, 0);
        assert.ok(h.calls.length > 0, '어댑터 대역이 질의를 받았다');
        const nojob = await h.request('GET', '/api/jobs/nope');
        assert.strictEqual(nojob.status, 404);
    } finally { await h.close(); }
});

test('쓰기 주소가 없으면 조회 전용이다 — 삭제 작업은 503', async function () {
    const h = await boot({ cse: null });
    try {
        await h.login();
        const s = await h.request('GET', '/api/session');
        assert.strictEqual(s.body.write.enabled, false);
        const r = await h.request('POST', '/api/jobs/expired-delete', { ris: ['/M/a'] });
        assert.strictEqual(r.status, 503);
    } finally { await h.close(); }
});
