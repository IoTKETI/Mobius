'use strict';
// 구독 화면은 목록이 아니라 엔드포인트 묶음이다(백로그 §3-1). broken 과 suspect 를
// 같은 선택에 섞지 않는 것이 코어 감사 함수의 계약이고, 라우트는 그 결과를 그대로
// 전한다.
const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./admin_app_helper');

const sub = (ri, nus) => ({ ri: ri, pi: '/M/ae', nu: JSON.stringify(nus), enc: '{}', cr: 'Cae',
                             nct: null, nec: null, exc: null, su: null });

function execute(sql, bindings) {
    // 롤업·표본·감사가 모두 sub 를 ri 키셋으로 읽는다. 감사는 lookup 도 본다(대상 존재 확인) —
    // 빈 결과를 주면 mqtt 대상이 없어 'mqtt_topic_unregistered'(suspect) 로 판정된다.
    if (/from `sub`/.test(sql)) {
        const after = bindings[0] || '';
        return [sub('/M/ae/s1', ['mqtt://broker/A?ct=json']), sub('/M/ae/s2', ['http://10.0.0.5:8080/n'])]
            .filter((r) => r.ri > after);
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
        assert.strictEqual(mq.total, 1);
        assert.strictEqual(mq.broken + mq.suspect <= 1, true);
        assert.ok(r.body.audit && typeof r.body.audit.scanned === 'number', '감사 요약을 같이 준다');
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
        assert.ok('severity' in r.body.rows[0]);
        assert.ok('reason' in r.body.rows[0]);
        const bad = await h.request('GET', '/api/subs/sample');
        assert.strictEqual(bad.status, 400);
    } finally { await h.close(); }
});
