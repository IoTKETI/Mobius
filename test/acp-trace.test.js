'use strict';
// 판정근거(trace) — 왜 403 인지 답할 수 있어야 한다.
//
// 지금까지 거부는 '0' 한 글자였다. 어느 ACP 의 어느 규칙이 막았는지, 뒤에
// 평가되지 못한 ACP 가 있는지 알 수 없어서 "일단 걸고 터지면 푼다" 가 됐다.
//
// evaluate_acp_rows 는 DB 도 콜백도 없는 순수 함수다. 그래야 시뮬레이터가
// 요청을 실제로 보내지 않고 같은 코드로 답할 수 있다.

const test = require('node:test');
const assert = require('node:assert');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const security = require('../mobius/security');

// 로그를 삼키고 남은 줄을 돌려준다.
function quiet(fn) {
    const origErr = console.error;
    const origLog = console.log;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    console.log = function (s) { lines.push(String(s)); };
    try { return fn(); }
    finally { console.error = origErr; console.log = origLog; }
}

function req(origin) {
    return {
        headers: { 'x-m2m-origin': origin },
        connection: { remoteAddress: '127.0.0.1' },
        url: '/Mobius/ae1/cnt1'
    };
}

const allow = (who) => JSON.stringify({ acr: [{ acor: [who], acop: 63 }] });
const rows = (...pairs) => pairs.map(([ri, pv]) => ({ ri: ri, pv: pv, pvs: pv }));

function evalPv(rowList, origin, cr, access) {
    return security._evaluate_acp_rows(rowList, req(origin), cr, access || '2', 'pv', true, true);
}

test('허용되면 어느 ACP 의 몇 번째 규칙이었는지 남는다', function () {
    const r = evalPv(rows(['/M/a1', allow('Reader')]), 'Reader', 'Cowner');
    assert.strictEqual(r.code, '1');
    assert.strictEqual(r.trace.decided_by, 'acr');
    assert.strictEqual(r.trace.acp_ri, '/M/a1');
    assert.strictEqual(r.trace.acr_index, 0);
});

test('전부 소진하면 exhausted 이고 평가한 ACP 가 전부 남는다', function () {
    const r = evalPv(rows(['/M/a1', allow('Reader')], ['/M/a2', allow('Other')]), 'Nobody', 'Cowner');
    assert.strictEqual(r.code, '0');
    assert.strictEqual(r.trace.decided_by, 'exhausted');
    assert.deepStrictEqual(r.trace.evaluated.map((e) => e.ri), ['/M/a1', '/M/a2']);
    assert.deepStrictEqual(r.trace.not_evaluated, []);
});

test('행이 하나도 없으면 no_acp_row 이고 생성자만 통과한다', function () {
    // 잠금이 조용히 풀리는 자리다. 배포의 /Mobius/sch8 이 이 상태다.
    const yes = evalPv([], 'Cowner', 'Cowner');
    assert.strictEqual(yes.code, '1');
    assert.strictEqual(yes.trace.decided_by, 'no_acp_row');
    const no = evalPv([], 'Cother', 'Cowner');
    assert.strictEqual(no.code, '0');
    assert.strictEqual(no.trace.decided_by, 'no_acp_row');
});

test('pv 에 acr 이 없는 ACP 를 만나면 거기서 끝나고 뒤 ACP 를 안 본다', function () {
    // 이름이 앞서는 빈 ACP 하나가 나머지 권한을 통째로 가린다.
    const r = evalPv(rows(['/M/a_empty', '{}'], ['/M/z_dev', allow('Dev')]), 'Dev', 'Cowner');
    assert.strictEqual(r.code, '0');
    assert.strictEqual(r.trace.decided_by, 'no_acr_cr');
    assert.strictEqual(r.trace.acp_ri, '/M/a_empty');
    assert.strictEqual(r.trace.stopped_early, true);
    assert.deepStrictEqual(r.trace.not_evaluated, ['/M/z_dev']);
});

test('순서만 바꾸면 같은 구성이 통과한다 — 순서가 결과를 바꾼다는 증거', function () {
    const r = evalPv(rows(['/M/a_dev', allow('Dev')], ['/M/z_empty', '{}']), 'Dev', 'Cowner');
    assert.strictEqual(r.code, '1');
    assert.strictEqual(r.trace.decided_by, 'acr');
});

test('pvs 경로는 acr 없는 행에서 끝내지 않고 다음으로 넘어간다', function () {
    const r = security._evaluate_acp_rows(
        rows(['/M/a_empty', '{}'], ['/M/z_dev', allow('Dev')]),
        req('Dev'), 'Cowner', '2', 'pvs', false, false);
    assert.strictEqual(r.code, '1');
    assert.strictEqual(r.trace.decided_by, 'acr');
    assert.strictEqual(r.trace.acp_ri, '/M/z_dev');
});

test('깨진 pv 는 그 행만 건너뛰고 뒤 행을 계속 본다', function () {
    const r = quiet(() => evalPv(rows(['/M/a1', '{not json'], ['/M/a2', allow('Reader')]), 'Reader', 'Cowner'));
    assert.strictEqual(r.code, '1');
    const skipped = r.trace.evaluated.find((e) => e.ri === '/M/a1');
    assert.strictEqual(skipped.skipped, true);
    assert.strictEqual(skipped.reason, 'parse_error');
});

test('acop 이 없는 규칙은 500-1 이고 사유가 남는다', function () {
    // 403 이 아니라 HTTP 500 이 나간다. 지금까지 로그 한 줄로만 남았다.
    const bad = JSON.stringify({ acr: [{ acor: ['Reader'] }] });
    const r = quiet(() => evalPv(rows(['/M/a1', bad]), 'Reader', 'Cowner'));
    assert.strictEqual(r.code, '500-1');
    assert.strictEqual(r.trace.decided_by, 'eval_error');
    assert.strictEqual(r.trace.acp_ri, '/M/a1');
    assert.ok(r.trace.error, '오류 메시지가 남아야 한다');
});

test('acor 이 안 맞으면 acop 을 건드리지 않는다 — 던지지 않아야 한다', function () {
    // 평가 순서를 지키는지 본다. acop 이 없어도 acor 에서 걸리면 500 이 아니다.
    const bad = JSON.stringify({ acr: [{ acor: ['Someone'] }] });
    const r = quiet(() => evalPv(rows(['/M/a1', bad]), 'Reader', 'Cowner'));
    assert.strictEqual(r.code, '0');
    assert.strictEqual(r.trace.decided_by, 'exhausted');
});

test('trace.order 는 입력 순서 그대로다', function () {
    const r = evalPv(rows(['/M/z', allow('X')], ['/M/a', allow('Y')]), 'Nobody', 'Cowner');
    assert.deepStrictEqual(r.trace.order, ['/M/z', '/M/a']);
});

test('규칙별로 acor 과 acop 중 무엇이 막았는지 구분된다', function () {
    const mixed = JSON.stringify({ acr: [
        { acor: ['Someone'], acop: 63 },     // acor 이 안 맞음
        { acor: ['Reader'], acop: 2 }        // acor 은 맞고 acop 이 모자람
    ]});
    const r = evalPv(rows(['/M/a1', mixed]), 'Reader', 'Cowner', '4');
    assert.strictEqual(r.code, '0');
    const seen = r.trace.evaluated[0].rules;
    assert.deepStrictEqual(
        seen.map((x) => [x.acor_ok, x.acop_ok]),
        [[false, null], [true, false]]);
});

test('acco 에서 막히면 acor 도 acop 도 보지 않는다', function () {
    const rule = { acor: ['Reader'], acop: 63, acco: [{ acip: { ipv4: ['10.9.9.9'] } }] };
    const d = security._evaluate_acr_traced(rule, req('Reader'), 'Reader', '2', false);
    assert.deepStrictEqual(d, { allow: false, acco_ok: false, acor_ok: null, acop_ok: null });
});

test('acor_matches 와 acop_allows 를 합치면 예전 acor_allows 와 같다', function () {
    const rule = { acor: ['Reader'], acop: 2 };
    assert.strictEqual(security._acor_matches(rule, 'Reader'), true);
    assert.strictEqual(security._acop_allows(rule, '2'), true);
    assert.strictEqual(security._acop_allows(rule, '4'), false);
    assert.strictEqual(security._acor_allows(rule, 'Reader', '2'), true);
    assert.strictEqual(security._acor_allows(rule, 'Reader', '4'), false);
    assert.strictEqual(security._acor_allows(rule, 'Nobody', '2'), false);
});

test('acor 이 없는 규칙은 발신자 제한이 없지만 acop 은 그대로 본다', function () {
    const rule = { acop: 2 };
    assert.strictEqual(security._acor_matches(rule, '아무나'), true);
    assert.strictEqual(security._acor_allows(rule, '아무나', '2'), true);
    assert.strictEqual(security._acor_allows(rule, '아무나', '8'), false);
});
