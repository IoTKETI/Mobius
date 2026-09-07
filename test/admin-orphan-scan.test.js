'use strict';
// 고아 탐지는 화면에서 라이브로 돌리지 않는다(설계 §명시적 비목표, 배포 lookup 5,740만 행).
// 작업으로 조각내어 상한까지만 훑고 결과 파일을 남긴다. 화면은 마지막 결과만 본다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { boot } = require('./admin_app_helper');
const orphan_scan = require('../admin/orphan_scan');

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
    // lookup 을 ri 키셋으로 읽는다. 1~30 번 행 중 부모가 없는 것은 10, 20, 30 이다.
    const rows = [];
    for (let i = 1; i <= 30; i++) { rows.push({ ri: '/M/r' + String(i).padStart(3, '0'), pi: (i % 10 === 0) ? '/M/gone' + i : '/M', ty: '3', rn: 'r' + i, ct: '20260901T000000', lt: '', et: '' }); }
    // 2단계(lookupOnlyCin) fixture — ty=4 행 4개 중 cin 에 2개만 있다.
    const cinRows = [];
    for (let i = 1; i <= 4; i++) { cinRows.push({ ri: '/M/c' + String(i).padStart(2, '0'), pi: '/M', rn: 'c' + i, ct: '20260901T000000', ty: '4' }); }
    const cinPresent = new Set(['/M/c01', '/M/c03']);
    const h = await boot({
        execute: function (sql, bindings) {
            // 2단계 질의를 먼저 가른다 — 그러지 않으면 아래 1단계 분기(`ri` > ? 만 본다)가
            // 이 질의도 잘못 삼킨다. 2단계는 ty 를 SQL 에 안 두므로(옵티마이저가 idx_lookup_ty 를
            // 고르던 결함, 2026-09-07) 선택 열 모양(`ri`,`pi`,`rn`,`ct`,`ty`)으로 가른다.
            if (/select `ri`, `pi`, `rn`, `ct`, `ty` from `lookup`/.test(sql)) {
                const after = bindings[0];
                return cinRows.filter((r) => r.ri > after);
            }
            if (/from `lookup`/.test(sql) && /`ri` > \?/.test(sql)) {
                const after = bindings[0];
                return rows.filter((r) => r.ri > after).slice(0, 1000);
            }
            if (/from `lookup`/.test(sql) && /in \(/.test(sql)) {
                // 부모 존재 확인: '/M' 만 있다.
                return bindings.filter((b) => b === '/M').map((ri) => ({ ri }));
            }
            if (/from `cin`/.test(sql)) {
                return bindings.filter((b) => cinPresent.has(b)).map((ri) => ({ ri }));
            }
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

        // 진행은 조각이 아니라 훑은 행으로 말한다 — 대상이 조각이라 "2 / 2 · 처리 2" 는
        // 무엇의 2인지 읽히지 않았다(사용자 지적 2026-09-07).
        assert.ok(job.progress, '진행 단위를 안 채웠다');
        assert.strictEqual(job.progress.label, '훑은 행');
        assert.strictEqual(job.progress.done, 34, '1단계 30행 + 2단계 4행');
        assert.strictEqual(job.progress.total, null, '단계마다 상한이 따로라 합계 상한은 말하지 않는다');
        // 무엇을 찾았는지는 작업이 자기 말로 적는다. 화면은 이 문장을 그대로 쓴다.
        assert.match(job.summary, /^34행을 훑어 미연결 3건, lookup 에만 남은 CIN 2건을 찾았습니다\. 표를 끝까지 다 봤습니다\.$/);

        const last = await h.request('GET', '/api/orphans/last');
        assert.strictEqual(last.status, 200);
        assert.deepStrictEqual(last.body.orphans.map((o) => o.ri), ['/M/r010', '/M/r020', '/M/r030']);
        assert.strictEqual(last.body.scanCapped, false);
        assert.ok(last.body.scanned >= 30);
        assert.ok('lookupOnlyCin' in last.body);
        // 2단계 본문: cin 에 없는 c02, c04 만 남는다.
        assert.deepStrictEqual(last.body.lookupOnlyCin.rows.map((r) => r.ri), ['/M/c02', '/M/c04']);
        assert.strictEqual(last.body.lookupOnlyCin.scanned, 4);
        assert.strictEqual(last.body.lookupOnlyCin.scanCapped, false);
        assert.strictEqual(last.body.typeNames['3'], 'cnt');
        assert.ok(fs.existsSync(path.join(h.dataDir, 'orphans', last.body.runId + '.json')));

        // 옛 라이브 경로는 없다.
        assert.strictEqual((await h.request('GET', '/api/orphans')).status, 404);
        assert.strictEqual((await h.request('GET', '/api/orphans/summary')).status, 404);
    } finally { await h.close(); }
});

test('조각 경계를 여러 번 넘어도 고아를 다 찾고 scanCapped 는 false (검토 fix round 1)', async function () {
    // page.more:false 는 "테이블 끝" 이 아니다 — 조각(chunk)에 걸려 페이지가 안
    // 찼을 때도 more:false 이면서 scanCapped:true 로 온다. 실제 BATCH(5000) 보다
    // 훨씬 작은 페이지(25행)로 잘라 돌려줘서, 조각(chunk:20) 경계를 여러 번
    // 넘어야만 100행을 다 훑을 수 있게 강제한다.
    const N = 100;
    const MOCK_PAGE = 25;
    const rows = [];
    for (let i = 1; i <= N; i++) {
        const orphan = (i % 20 === 0);
        rows.push({ ri: '/D/r' + String(i).padStart(3, '0'), pi: orphan ? '/D/gone' + i : '/M', ty: '3', rn: 'r' + i, ct: '20260901T000000', lt: '', et: '' });
    }
    const h = await boot({
        execute: function (sql, bindings) {
            if (/select `ri`, `pi`, `rn`, `ct`, `ty` from `lookup`/.test(sql)) { return []; }   // 2단계 fixture 없음
            if (/from `lookup`/.test(sql) && /`ri` > \?/.test(sql)) {
                const after = bindings[0];
                return rows.filter((r) => r.ri > after).slice(0, MOCK_PAGE);
            }
            if (/from `lookup`/.test(sql) && /in \(/.test(sql)) {
                return bindings.filter((b) => b === '/M').map((ri) => ({ ri }));
            }
            if (/from `cin`/.test(sql)) { return []; }
            return [];
        }
    });
    try {
        await h.login();
        const job = orphan_scan.start(h.ctx, { scanCap: 1000, chunk: 20, sampleCap: 100 });
        assert.ok(job, '이미 도는 작업이 있으면 안 된다');
        const done = await settled(h, job.id);
        assert.strictEqual(done.state, 'done');

        const last = await h.request('GET', '/api/orphans/last');
        assert.strictEqual(last.status, 200);
        const expected = [20, 40, 60, 80, 100].map((i) => '/D/r' + String(i).padStart(3, '0'));
        assert.deepStrictEqual(last.body.orphans.map((o) => o.ri), expected);
        assert.strictEqual(last.body.scanCapped, false);
        assert.ok(last.body.scanned >= N);
    } finally { await h.close(); }
});

test('1단계가 예산에 걸리면 scanCapped:true 로 접되 2단계는 굶지 않는다 (검토 fix round 1)', async function () {
    // 1단계 fixture(200행)가 예산(scanCap:50)보다 훨씬 크다 — 옛 코드는 1단계가
    // 예산에 걸리면 exhausted 를 세워 2단계 자체를 건너뛰었다. 2단계가 실제로
    // 돌았는지는 lookupOnlyCin 이 진짜 값(0이 아닌 scanned·rows)을 갖는지로만
    // 구분된다 — "안 돌았다" 와 "돌았는데 없었다" 를 가르는 유일한 방법이다.
    const MOCK_PAGE = 25;
    const rows = [];
    for (let i = 1; i <= 200; i++) { rows.push({ ri: '/E/r' + String(i).padStart(3, '0'), pi: '/M', ty: '3', rn: 'r' + i, ct: '20260901T000000', lt: '', et: '' }); }
    const cinRows = [];
    for (let i = 1; i <= 10; i++) { cinRows.push({ ri: '/E/c' + String(i).padStart(2, '0'), pi: '/M', rn: 'c' + i, ct: '20260901T000000', ty: '4' }); }
    const present = new Set(['/E/c01', '/E/c02', '/E/c03', '/E/c04']);   // 4개는 cin 에 있다 — 나머지 6개가 lookup 에만 남은 것
    const h = await boot({
        execute: function (sql, bindings) {
            if (/select `ri`, `pi`, `rn`, `ct`, `ty` from `lookup`/.test(sql)) {
                const after = bindings[0];
                return cinRows.filter((r) => r.ri > after);
            }
            if (/from `lookup`/.test(sql) && /`ri` > \?/.test(sql)) {
                const after = bindings[0];
                return rows.filter((r) => r.ri > after).slice(0, MOCK_PAGE);
            }
            if (/from `lookup`/.test(sql) && /in \(/.test(sql)) {
                return bindings.filter((b) => b === '/M').map((ri) => ({ ri }));
            }
            if (/from `cin`/.test(sql)) {
                return bindings.filter((b) => present.has(b)).map((ri) => ({ ri }));
            }
            return [];
        }
    });
    try {
        await h.login();
        const job = orphan_scan.start(h.ctx, { scanCap: 50, chunk: 20, sampleCap: 100 });
        assert.ok(job);
        const done = await settled(h, job.id);
        assert.strictEqual(done.state, 'done');

        const last = await h.request('GET', '/api/orphans/last');
        assert.strictEqual(last.status, 200);
        assert.strictEqual(last.body.scanCapped, true);
        assert.strictEqual(last.body.scanned, 50);
        // 1단계가 예산에 걸려도 2단계는 자기 예산으로 따로 돈다 — 굶지 않는다.
        assert.strictEqual(last.body.lookupOnlyCin.scanned, 10);
        assert.strictEqual(last.body.lookupOnlyCin.rows.length, 6);
        assert.strictEqual(last.body.lookupOnlyCin.scanCapped, false);
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

// ── 이어서 훑기 ──────────────────────────────────────────────────────────────
//
// 예전에는 누를 때마다 표 맨 앞부터 다시 읽었다. 로컬(2,780행)은 한 번에 끝까지 읽으니
// 티가 안 났지만, 배포는 lookup 5,740만 행이라 상한 20만 행이면 앞의 0.35% 만 보고 멈추고
// 다시 눌러도 또 같은 0.35% 를 봤다 — 나머지는 영영 못 본다(사용자 지적 2026-09-07).

function bigTable(prefix, n, every) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
        const orphan = (i % every === 0);
        rows.push({ ri: prefix + String(i).padStart(3, '0'), pi: orphan ? prefix + 'gone' + i : '/M', ty: '3', rn: 'r' + i, ct: '20260901T000000', lt: '', et: '' });
    }
    return rows;
}

/** 1단계만 데이터가 있는 대역. 2단계(lookup 전용 CIN)는 곧바로 표 끝이다. */
function stage1Only(rows, pageSize) {
    return function (sql, bindings) {
        if (/select `ri`, `pi`, `rn`, `ct`, `ty` from `lookup`/.test(sql)) { return []; }
        if (/from `lookup`/.test(sql) && /`ri` > \?/.test(sql)) {
            return rows.filter((r) => r.ri > bindings[0]).slice(0, pageSize);
        }
        if (/from `lookup`/.test(sql) && /in \(/.test(sql)) {
            return bindings.filter((b) => b === '/M').map((ri) => ({ ri }));
        }
        return [];
    };
}

test('상한에서 멈추면 커서를 남기고, 이어서 훑기가 그 다음부터 읽는다', async function () {
    const h = await boot({ execute: stage1Only(bigTable('/R/r', 100, 10), 10) });
    try {
        await h.login();
        const last = async () => (await h.request('GET', '/api/orphans/last')).body;

        // 1회차 — 1단계 예산 30행에서 멈춘다.
        const j1 = orphan_scan.start(h.ctx, { scanCap: 30, chunk: 10, sampleCap: 50 });
        await settled(h, j1.id);
        const r1 = await last();
        assert.deepStrictEqual(r1.orphans.map((o) => o.ri), ['/R/r010', '/R/r020', '/R/r030']);
        assert.strictEqual(r1.scanned, 30);
        assert.strictEqual(r1.scanCapped, true);
        assert.strictEqual(r1.complete, false);
        assert.strictEqual(r1.resumable, true, '멈췄는데 이어갈 수 없다고 한다');
        assert.strictEqual(r1.resume.s1.cursor, '/R/r030', '멈춘 자리를 안 남겼다');
        assert.strictEqual(r1.resume.s1.done, false);
        assert.strictEqual(r1.continued, false);
        assert.strictEqual(r1.runs, 1);

        // 2회차 — 이어서. 앞의 30행을 다시 읽지 않는다.
        const j2 = orphan_scan.start(h.ctx, { scanCap: 30, chunk: 10, sampleCap: 50, resume: true });
        await settled(h, j2.id);
        assert.match(j2.title, /^미연결 이어서 훑기/);
        const r2 = await last();
        assert.strictEqual(r2.continued, true);
        assert.strictEqual(r2.runs, 2);
        assert.strictEqual(r2.scanned, 60, '앞부분을 다시 읽었거나 누적을 안 했다');
        assert.deepStrictEqual(r2.orphans.map((o) => o.ri),
            ['/R/r010', '/R/r020', '/R/r030', '/R/r040', '/R/r050', '/R/r060'],
            '앞 회차의 표본을 물려받아 누적해야 한다');
        assert.strictEqual(r2.resume.s1.cursor, '/R/r060');
        assert.strictEqual(r2.resumable, true);
        assert.match(j2.summary, /이번에 30행을 더 훑었습니다\(누적 60행\)/);

        // 3회차 — **라우트로** 이어간다(화면이 쓰는 길). 남은 40행을 다 읽고 끝난다.
        const c = await h.request('POST', '/api/jobs/orphan-scan', { sampleCap: 50, resume: true });
        assert.strictEqual(c.status, 202, JSON.stringify(c.body));
        const j3 = await settled(h, c.body.id);
        assert.match(j3.title, /^미연결 이어서 훑기/, '라우트가 resume 를 안 넘겼다');
        const r3 = await last();
        assert.strictEqual(r3.runs, 3);
        assert.strictEqual(r3.scanned, 100);
        assert.strictEqual(r3.orphans.length, 10, '10 의 배수 10개를 다 찾아야 한다');
        assert.strictEqual(r3.resume.s1.done, true);
        assert.strictEqual(r3.complete, true);
        assert.strictEqual(r3.resumable, false);
        assert.match(j3.summary, /표를 끝까지 다 봤습니다\.$/);
    } finally { await h.close(); }
});

test('이어갈 것이 없으면 resume:true 여도 처음부터 훑는다 — 누적이 두 배가 되지 않는다', async function () {
    const h = await boot({ execute: stage1Only(bigTable('/S/r', 3, 3), 10) });
    try {
        await h.login();
        const last = async () => (await h.request('GET', '/api/orphans/last')).body;

        const j1 = orphan_scan.start(h.ctx, { scanCap: 1000, chunk: 10, sampleCap: 50 });
        await settled(h, j1.id);
        const r1 = await last();
        assert.strictEqual(r1.complete, true);
        assert.strictEqual(r1.resumable, false);
        assert.strictEqual(r1.scanned, 3);

        const j2 = orphan_scan.start(h.ctx, { scanCap: 1000, chunk: 10, sampleCap: 50, resume: true });
        await settled(h, j2.id);
        const r2 = await last();
        assert.strictEqual(r2.scanned, 3, '끝난 결과를 물려받아 표를 두 번 센 것처럼 보인다');
        assert.deepStrictEqual(r2.orphans.map((o) => o.ri), ['/S/r003']);
        assert.strictEqual(r2.continued, false, '이어갈 것이 없었으므로 이어받은 것이 아니다');
        assert.strictEqual(r2.runs, 1);
    } finally { await h.close(); }
});
