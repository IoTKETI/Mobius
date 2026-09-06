'use strict';
// 구독 화면은 목록이 아니라 엔드포인트 묶음이다(백로그 §3-1). broken 과 suspect 를
// 같은 선택에 섞지 않는 것이 코어 감사 함수의 계약이고, 라우트는 그 결과를 그대로
// 전한다.
// audit_subscriptions 의 질의 순서: lookup(ty=23, ri 키셋 — 커서는 bindings[1]) →
// sub(ri whereIn 으로 nu 읽기) → nu 가 mqtt 면 ae(aei whereIn 으로 등록 확인). 이
// 대역은 그 순서에 맞춰 답해 감사가 실제로 판정까지 돌게 한다 — severity 를 대역이
// 직접 심지 않는다.
const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./admin_app_helper');

const sub = (ri, nus) => ({ ri: ri, pi: '/M/ae', nu: JSON.stringify(nus), enc: '{}', cr: 'Cae',
                             nct: null, nec: null, exc: null, su: null });

// 표본 둘: mqtt 쪽은 토픽의 AE 가 등록돼 있지 않다고 답해 감사가 스스로
// mqtt_topic_unregistered(suspect) 를 내게 하고, http 쪽은 URL 형이라 audit_subscriptions
// 가 애초에 도달성을 판정하지 않는다(코어의 계약 — 알림 결과로만 알 수 있다).
const SUBS = [
    sub('/M/ae/s1', ['mqtt://broker/A?ct=json']),
    sub('/M/ae/s2', ['http://10.0.0.5:8080/n'])
];

function execute(sql, bindings) {
    // 1단계 — lookup 을 ty=23 으로 ri 키셋 스캔한다. bindings = [23, cursor, limit] 라
    // 커서는 bindings[1]이다. 여기를 틀리면 같은 페이지를 계속 돌려줘 스캔이
    // scanCap(20000) 까지 무의미하게 반복된다.
    if (/from `lookup`/.test(sql) && /`ty`\s*=\s*\?/.test(sql)) {
        const after = bindings[1] || '';
        return SUBS.filter((r) => r.ri > after)
            .map((r) => ({ ri: r.ri, pi: r.pi, rn: '', ct: '', lt: '', et: '' }));
    }
    // 2단계 — 그 ri 목록으로 sub.nu 를 whereIn 으로 읽는다. 키셋 커서가 아니라
    // ri 목록 자체가 bindings 다.
    if (/from `sub`/.test(sql) && /\bin\s*\(/i.test(sql)) {
        return SUBS.filter((r) => bindings.indexOf(r.ri) >= 0);
    }
    // 롤업·표본(select_sub_endpoint_rollup / select_subs_by_endpoint)은 같은 sub 를
    // ri 키셋(> 커서, order by)으로 직접 읽는다 — 커서는 bindings[0].
    if (/from `sub`/.test(sql)) {
        const after = bindings[0] || '';
        return SUBS.filter((r) => r.ri > after);
    }
    // 3단계(mqtt 인 nu 만) — 토픽의 AE-ID 가 실제 등록돼 있는지 ae.aei 로 확인한다.
    // 'A' 를 등록 안 된 것으로 답해야 mqtt_topic_unregistered(suspect) 가 나온다.
    if (/from `ae`/.test(sql)) {
        return [];
    }
    return [];
}

test('엔드포인트로 묶고 코어 감사의 판정을 붙인다', async function () {
    const h = await boot({ execute });
    try {
        await h.login();
        const r = await h.request('GET', '/api/subs/endpoints');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.endpoints.map((e) => e.endpoint).sort(), ['http://10.0.0.5:8080', 'mqtt://broker']);
        const mq = r.body.endpoints.find((e) => e.endpoint === 'mqtt://broker');
        const http = r.body.endpoints.find((e) => e.endpoint === 'http://10.0.0.5:8080');
        assert.strictEqual(mq.total, 1);
        // 판정 병합 경로가 실제로 돈다 — mqtt 는 코어 감사가 suspect 하나를 내고,
        // http 는 URL 형이라 감사가 판정하지 않아 0/0 이다.
        assert.strictEqual(mq.suspect, 1);
        assert.strictEqual(mq.broken, 0);
        assert.strictEqual(http.broken, 0);
        assert.strictEqual(http.suspect, 0);
        assert.ok(r.body.audit && typeof r.body.audit.scanned === 'number', '감사 요약을 같이 준다');
        assert.strictEqual(r.body.audit.bySeverity.suspect, 1);
        assert.strictEqual(r.body.audit.byReason.mqtt_topic_unregistered, 1);
        assert.strictEqual(r.body.capped, false);
    } finally { await h.close(); }
});

test('표본은 그 엔드포인트의 구독만, 판정과 함께', async function () {
    const h = await boot({ execute });
    try {
        await h.login();
        const r = await h.request('GET', '/api/subs/sample?endpoint=' + encodeURIComponent('http://10.0.0.5:8080'));
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.rows.map((x) => x.ri), ['/M/ae/s2']);
        // URL 형은 감사가 판정하지 않는다 — severity/reason 이 null 이어야 한다.
        assert.strictEqual(r.body.rows[0].severity, null);
        assert.strictEqual(r.body.rows[0].reason, null);

        const mqr = await h.request('GET', '/api/subs/sample?endpoint=' + encodeURIComponent('mqtt://broker'));
        assert.strictEqual(mqr.status, 200);
        assert.deepStrictEqual(mqr.body.rows.map((x) => x.ri), ['/M/ae/s1']);
        // 코어 감사가 실제로 낸 판정이 그대로 붙어 있어야 한다.
        assert.strictEqual(mqr.body.rows[0].severity, 'suspect');
        assert.strictEqual(mqr.body.rows[0].reason, 'mqtt_topic_unregistered');

        const bad = await h.request('GET', '/api/subs/sample');
        assert.strictEqual(bad.status, 400);
    } finally { await h.close(); }
});

test('감사가 실패하면 사유를 담아 500 — {"error":"true"} 로 뭉개지 않는다', async function () {
    // audit_map 의 콜백은 (err, map, a) 이고 실패 때 map 은 그냥 빈 ri 맵({}) 이라
    // .message 가 없다 — 사유는 셋째 인자(audit_subscriptions 의 상세 객체)에 있다.
    // 감사의 첫 질의(lookup 의 ty=23 키셋 스캔)에서 던져 그 경로를 그대로 탄다.
    function throwingExecute(sql) {
        if (/from `lookup`/.test(sql)) { throw new Error('boom'); }
        return [];
    }

    const h = await boot({ execute: throwingExecute });
    try {
        await h.login();
        const r = await h.request('GET', '/api/subs/endpoints');
        assert.strictEqual(r.status, 500);
        assert.notStrictEqual(r.body.error, 'true');
        assert.ok(/boom/.test(r.body.error), 'error 에 실제 사유(boom)가 담겨야 한다: ' + JSON.stringify(r.body));

        const r2 = await h.request('GET', '/api/subs/sample?endpoint=x');
        assert.strictEqual(r2.status, 500);
        assert.notStrictEqual(r2.body.error, 'true');
        assert.ok(/boom/.test(r2.body.error), 'error 에 실제 사유(boom)가 담겨야 한다: ' + JSON.stringify(r2.body));
    } finally { await h.close(); }
});

test('sub-delete 는 구독만 지운다', async function () {
    const h = await boot({
        execute: function (sql, bindings) {
            if (/from `lookup`/.test(sql)) { return [{ ri: bindings[0], ty: bindings[0].endsWith('/s1') ? '23' : '3' }]; }
            return [];
        },
        cse: { status: 200, rsc: '2002', body: {} }
    });
    try {
        await h.login();
        const r = await h.request('POST', '/api/jobs/sub-delete', { ris: ['/M/ae/s1', '/M/ae/c'] });
        assert.strictEqual(r.status, 202);
        let job;
        for (let i = 0; i < 200; i++) {
            job = (await h.request('GET', '/api/jobs/' + r.body.id)).body;
            if (job.state !== 'running') { break; }
            await new Promise((res) => setTimeout(res, 10));
        }
        assert.strictEqual(job.ok, 1);
        assert.strictEqual(job.skipped, 1);
        assert.deepStrictEqual(h.cse.calls.filter((c) => c.method === 'DELETE').map((c) => c.path), ['/M/ae/s1']);
    } finally { await h.close(); }
});
