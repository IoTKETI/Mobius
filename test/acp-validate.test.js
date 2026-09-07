'use strict';
// pv / pvs write guardrails.
//
// An invalid ACP is stored silently and appears later as 403 or 500, when the offending value can no longer be identified, so it is blocked at write time.
//
// Refusals and warnings are separate: refusals are 'cannot be fixed later if left like this', warnings are 'is this intended'. Refusing on a warning would break the principle 'lock only what must be locked' and existing clients.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

global.usesuperuser = 'Sponde';
const acp = require('../mobius/acp');

const ok = (acr) => ({ acr: acr });
const rule = (extra) => Object.assign({ acor: ['Cteam'], acop: 63 }, extra || {});

// ── Refusals ──

const DENY = [
    ['객체가 아니다',            'nope',                             '400-56', 'pv'],
    ['배열이다',                 [],                                 '400-56', 'pv'],
    ['null 이다',                null,                               '400-56', 'pv'],
    ['acr 키가 없다 (pv:{})',    {},                                 '400-23', 'pv.acr'],
    ['acr 이 배열이 아니다',      { acr: 'x' },                       '400-12', 'pv.acr'],
    ['acr 이 비었다',            ok([]),                             '400-23', 'pv.acr'],
    ['규칙이 객체가 아니다',      ok(['x']),                          '400-56', 'pv.acr[0]'],
    ['acop 이 없다',             ok([{ acor: ['C'] }]),              '400-57', 'pv.acr[0].acop'],
    ['acop 이 64 다',            ok([rule({ acop: 64 })]),           '400-57', 'pv.acr[0].acop'],
    ['acop 이 음수다',           ok([rule({ acop: -1 })]),           '400-57', 'pv.acr[0].acop'],
    ['acop 이 소수다',           ok([rule({ acop: 1.5 })]),          '400-57', 'pv.acr[0].acop'],
    ['acop 이 숫자가 아니다',     ok([rule({ acop: 'all' })]),        '400-57', 'pv.acr[0].acop'],
    ['acor 이 배열이 아니다',     ok([rule({ acor: 'C' })]),          '400-13', 'pv.acr[0].acor'],
    ['acor 원소가 숫자다',        ok([rule({ acor: [7] })]),          '400-58', 'pv.acr[0].acor[0]'],
    ['acco 가 배열이 아니다',     ok([rule({ acco: {} })]),           '400-14', 'pv.acr[0].acco'],
    ['actw 가 5자리다',          ok([rule({ acco: [{ actw: ['* * * * *'] }] })]),
                                                                     '400-59', 'pv.acr[0].acco[0].actw[0]'],
    ['actw 가 배열이 아니다',     ok([rule({ acco: [{ actw: '* * * * * *' }] })]),
                                                                     '400-59', 'pv.acr[0].acco[0].actw'],
    ['acip 에 두 계열이 동시에',  ok([rule({ acco: [{ acip: { ipv4: ['1.2.3.4'], ipv6: ['::1'] } }] })]),
                                                                     '400-60', 'pv.acr[0].acco[0].acip']
];

DENY.forEach(function ([label, value, code, at]) {
    test('거부: ' + label, function () {
        const r = acp.validate_privileges(value, 'pv');
        assert.strictEqual(r.code, code, label);
        assert.strictEqual(r.path, at, label + ' 의 위치');
    });
});

// ── Pass ──

test('정상 pv 는 경고 없이 통과한다', function () {
    const r = acp.validate_privileges(ok([rule()]), 'pv');
    assert.strictEqual(r.code, null);
    assert.deepStrictEqual(r.warnings, []);
});

test("acop 을 문자열 '63' 으로 줘도 통과한다 — 기존 클라이언트가 그렇게 보낸다", function () {
    const r = acp.validate_privileges(ok([rule({ acop: '63' })]), 'pv');
    assert.strictEqual(r.code, null);
});

test('acor 이 없는 규칙도 통과한다 — 발신자 제한이 없다는 뜻이다', function () {
    const r = acp.validate_privileges(ok([{ acop: 2 }]), 'pv');
    assert.strictEqual(r.code, null);
});

test('acco 가 없거나 비어도 통과한다', function () {
    assert.strictEqual(acp.validate_privileges(ok([rule({ acco: [] })]), 'pv').code, null);
});

test("actw 6자리는 통과한다", function () {
    const r = acp.validate_privileges(ok([rule({ acco: [{ actw: ['* * * * * *'] }] })]), 'pv');
    assert.strictEqual(r.code, null);
    assert.deepStrictEqual(r.warnings, []);
});

// ── Warnings (not refused) ──

function warnRules(value, attr) {
    const r = acp.validate_privileges(value, attr || 'pv');
    assert.strictEqual(r.code, null, '경고는 거부하면 안 된다');
    return r.warnings.map((w) => w.rule);
}

test('정규식처럼 보이는 acor 은 경고만 한다', function () {
    // A remnant of the time the originator was turned into a regex. Comparison is string equality now, so 'S.*' matches nobody.
    assert.ok(warnRules(ok([rule({ acor: ['S.*'] })])).includes('acor_looks_like_regex'));
    assert.ok(!warnRules(ok([rule({ acor: ['all'] })])).includes('acor_looks_like_regex'));
    assert.ok(!warnRules(ok([rule({ acor: ['*'] })])).includes('acor_looks_like_regex'));
});

test("'/' 로 시작하는 acor 은 경고만 한다", function () {
    assert.ok(warnRules(ok([rule({ acor: ['/Cteam'] })])).includes('acor_not_normalized'));
});

test('초·분이 고정된 actw 는 경고만 한다 — 하루 한 순간만 열린다', function () {
    assert.ok(warnRules(ok([rule({ acco: [{ actw: ['0 0 * * * *'] }] })])).includes('actw_second_pinned'));
    assert.ok(!warnRules(ok([rule({ acco: [{ actw: ['* * 9 * * *'] }] })])).includes('actw_second_pinned'));
});

test('acop 0 은 경고만 한다', function () {
    assert.ok(warnRules(ok([rule({ acop: 0 })])).includes('acop_zero'));
});

test('pvs 에 관리자가 없으면 경고한다 — 그러면 수퍼유저 말고는 못 고친다', function () {
    // The acp table has no cr column, so there is no creator to fall back to.
    assert.ok(warnRules(ok([rule()]), 'pvs').includes('pvs_no_admin'));
    assert.ok(!warnRules(ok([rule({ acor: ['Cteam', 'Sponde'] })]), 'pvs').includes('pvs_no_admin'));
});

test('pv 에는 관리자 경고를 하지 않는다', function () {
    assert.ok(!warnRules(ok([rule()]), 'pv').includes('pvs_no_admin'));
});

test('거부하면서도 그때까지 모은 경고를 함께 준다', function () {
    const r = acp.validate_privileges(ok([rule({ acop: 0 }), { acor: ['C'] }]), 'pv');
    assert.strictEqual(r.code, '400-57');
    assert.deepStrictEqual(r.warnings.map((w) => w.rule), ['acop_zero']);
});

test('절대 던지지 않는다', function () {
    for (const v of [undefined, null, 0, '', [], { acr: [null] }, { acr: [{ acop: {} }] }]) {
        assert.doesNotThrow(() => acp.validate_privileges(v, 'pv'));
    }
});

// ── Wiring ──

test('build_acp 이 pv 와 pvs 를 검증한다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'acp.js'), 'utf8');
    const m = src.match(/exports\.build_acp = function[\s\S]*?\n\};/);
    assert.ok(m, 'build_acp 를 찾지 못했다');
    assert.ok(/validate_privileges/.test(m[0]), 'build_acp 이 검증을 부르지 않는다');
});

test('UPDATE 경로가 pv 와 pvs 를 검증한다', function () {
    // pv/pvs are optional attributes of acp, so the pvs check in the mandatory branch was never reached (update_m_attr_list.acp is []); it must be in the optional branch.
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');
    const m = src.match(/if \(update_opt_attr_list\[rootnm\]\.includes\(attr\)\)[\s\S]{0,1400}/);
    assert.ok(m, '옵션 분기를 찾지 못했다');
    assert.ok(/attr === 'pv' \|\| attr === 'pvs'/.test(m[0]), 'UPDATE 옵션 분기에 pv/pvs 검증이 없다');
    assert.ok(/validate_privileges/.test(m[0]), 'UPDATE 분기가 검증을 부르지 않는다');
});
