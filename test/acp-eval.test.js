'use strict';
const test = require('node:test');
const assert = require('node:assert');
const acp = require('../mobius/acp_eval');

const NOW = new Date(Date.UTC(2026, 7, 28, 10, 30, 45)); // 2026-08-28 10:30:45 UTC (금요일)

function ctx(over) {
    return Object.assign({
        originator: 'CAdmin',
        acop: acp.ACOP.RETRIEVE,
        clientIp: '10.0.0.5',
        now: NOW,
        creator: 'CCreator'
    }, over || {});
}

test('acor 가 정확히 일치하고 acop 비트를 포함하면 허용', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: 63 }] }];
    const r = acp.evaluatePrivileges(pv, ctx());
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.reason, 'acr-match');
    assert.strictEqual(r.matchedIndex, 0);
});

test('acop 비트가 모자라면 거부', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: acp.ACOP.RETRIEVE }] }];
    const r = acp.evaluatePrivileges(pv, ctx({ acop: acp.ACOP.DELETE }));
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.reason, 'no-acr-matched');
});

test('acor 가 다르면 거부', function () {
    const pv = [{ acr: [{ acor: ['SomeoneElse'], acop: 63 }] }];
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, false);
});

test("acor 'all' 과 '*' 는 누구에게나 허용", function () {
    assert.strictEqual(acp.evaluatePrivileges([{ acr: [{ acor: ['all'], acop: 63 }] }], ctx()).allowed, true);
    assert.strictEqual(acp.evaluatePrivileges([{ acr: [{ acor: ['*'], acop: 63 }] }], ctx()).allowed, true);
});

test('acr 에 acor 가 아예 없으면 무조건 허용 (기존 동작)', function () {
    const pv = [{ acr: [{ acop: 63 }] }];
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, true);
});

// 스펙 §1.8 — 알려진 결함. 이 테스트는 결함이 "보존되었음"을 잠근다.
// 별건 보안 수정에서 이 테스트가 깨지면 그게 의도된 변경이다.
test('KNOWN BUG: originator 가 정규식으로 쓰여 .* 가 모든 acor 를 매칭한다', function () {
    const pv = [{ acr: [{ acor: ['OnlyThisAE'], acop: 63 }] }];
    const r = acp.evaluatePrivileges(pv, ctx({ originator: '.*' }));
    assert.strictEqual(r.allowed, true, '현재 서버는 이걸 허용한다');
    assert.strictEqual(r.acorWasRegex, true);
});

test('정규식으로 깨지는 originator 는 예외를 던지지 않고 거부', function () {
    const pv = [{ acr: [{ acor: ['x'], acop: 63 }] }];
    const r = acp.evaluatePrivileges(pv, ctx({ originator: '[' }));
    assert.strictEqual(r.allowed, false);
});

test('acco.acip.ipv4 목록에 있으면 허용, 없으면 거부', function () {
    const mk = (ips) => [{ acr: [{ acor: ['CAdmin'], acop: 63, acco: [{ acip: { ipv4: ips } }] }] }];
    assert.strictEqual(acp.evaluatePrivileges(mk(['10.0.0.5']), ctx()).allowed, true);
    assert.strictEqual(acp.evaluatePrivileges(mk(['10.0.0.9']), ctx()).allowed, false);
});

test('acco 가 빈 배열이면 제약 없음으로 통과 (기존 동작)', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: 63, acco: [] }] }];
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, true);
});

// KNOWN QUIRK: 원본은 6개 필드 중 하나만 맞아도 허용한다 (AND 가 아니라 OR).
// actw 필드 순서는 [초, 분, 시, 일, 월, 요일] 이다.
test('KNOWN QUIRK: actw 는 6개 필드 중 하나만 일치해도 허용', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: 63, acco: [{ actw: ['* * 10 * * *'] }] }] }];
    // now 의 hour = 10, 세 번째 필드(index 2)가 시(hour)
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, true);
});

test('evaluateDefault: 생성자는 enforcement 와 무관하게 전권', function () {
    const c = ctx({ originator: 'CCreator', acop: acp.ACOP.DELETE });
    assert.deepStrictEqual(acp.evaluateDefault(c, 'disable'), { allowed: true, reason: 'creator' });
    assert.deepStrictEqual(acp.evaluateDefault(c, 'enable'), { allowed: true, reason: 'creator' });
});

test('evaluateDefault: disable 이면 그 외 origin 은 C/R/Discovery 만 허용', function () {
    for (const op of [acp.ACOP.CREATE, acp.ACOP.RETRIEVE, acp.ACOP.DISCOVERY]) {
        assert.strictEqual(acp.evaluateDefault(ctx({ acop: op }), 'disable').allowed, true);
    }
    for (const op of [acp.ACOP.UPDATE, acp.ACOP.DELETE, acp.ACOP.NOTIFY]) {
        assert.strictEqual(acp.evaluateDefault(ctx({ acop: op }), 'disable').allowed, false);
    }
});

test('evaluateDefault: enable 이면 그 외 origin 은 전부 거부', function () {
    assert.strictEqual(acp.evaluateDefault(ctx({ acop: acp.ACOP.RETRIEVE }), 'enable').allowed, false);
});

test('evaluateBrokenAcpi: ACP 를 못 찾으면 생성자만 허용', function () {
    assert.strictEqual(acp.evaluateBrokenAcpi(ctx({ originator: 'CCreator' })).allowed, true);
    assert.strictEqual(acp.evaluateBrokenAcpi(ctx({ originator: 'Other' })).allowed, false);
});
