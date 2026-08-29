'use strict';
// pv / pvs 쓰기 가드레일.
//
// 잘못된 ACP 는 조용히 저장됐다가 나중에 403 이나 500 으로 나타난다. 그때는
// 어느 값이 문제였는지 알 방법이 없으므로 쓰는 시점에 막는다.
//
// 거부와 경고를 나눈다. 거부는 "이대로 두면 나중에 못 고친다" 인 것들이고,
// 경고는 "의도한 게 맞는지" 인 것들이다. 경고로 거부하면 대원칙("잠글 곳만
// 명시적으로 잠근다")을 어기고 기존 클라이언트를 깨뜨린다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

global.usesuperuser = 'Sponde';
const acp = require('../mobius/acp');

const ok = (acr) => ({ acr: acr });
const rule = (extra) => Object.assign({ acor: ['Cteam'], acop: 63 }, extra || {});

// ── 거부 ──────────────────────────────────────────────────────────────

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

// ── 통과 ──────────────────────────────────────────────────────────────

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

// ── 경고 (거부하지 않는다) ────────────────────────────────────────────

function warnRules(value, attr) {
    const r = acp.validate_privileges(value, attr || 'pv');
    assert.strictEqual(r.code, null, '경고는 거부하면 안 된다');
    return r.warnings.map((w) => w.rule);
}

test('정규식처럼 보이는 acor 은 경고만 한다', function () {
    // 예전 코드가 발신자를 정규식으로 만들었던 잔재다. 지금은 문자열 등치라
    // 'S.*' 는 아무와도 맞지 않는다. 배포의 유일한 ACP 가 acor:["S"] 다.
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
    // acp 테이블에 cr 컬럼이 없어 생성자로 되돌릴 수도 없다.
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

// ── 배선 ──────────────────────────────────────────────────────────────

test('build_acp 이 pv 와 pvs 를 검증한다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'acp.js'), 'utf8');
    const m = src.match(/exports\.build_acp = function[\s\S]*?\n\};/);
    assert.ok(m, 'build_acp 를 찾지 못했다');
    assert.ok(/validate_privileges/.test(m[0]), 'build_acp 이 검증을 부르지 않는다');
});

test('UPDATE 경로가 pv 와 pvs 를 검증한다', function () {
    // acp 의 pv/pvs 는 **옵션** 속성이라, mandatory 분기의 pvs 검사에
    // 영영 닿지 않았다(update_m_attr_list.acp 가 []). 옵션 분기에 있어야 한다.
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');
    const m = src.match(/if \(update_opt_attr_list\[rootnm\]\.includes\(attr\)\)[\s\S]{0,1400}/);
    assert.ok(m, '옵션 분기를 찾지 못했다');
    assert.ok(/attr === 'pv' \|\| attr === 'pvs'/.test(m[0]), 'UPDATE 옵션 분기에 pv/pvs 검증이 없다');
    assert.ok(/validate_privileges/.test(m[0]), 'UPDATE 분기가 검증을 부르지 않는다');
});
