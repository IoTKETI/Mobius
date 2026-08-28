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

// KNOWN BUG: Critical #1 - sticky latch bug 보존 확인.
// 첫 엔트리가 acip_permit=1 을 설정하면 두 번째 엔트리는 그 값을 유지한 채 자신의 acip 검사를 생략할 수 있다.
test('KNOWN BUG: acco 의 여러 엔트리에 걸친 sticky latch 현상', function () {
    const pv = [{
        acr: [{
            acor: ['CAdmin'],
            acop: 63,
            acco: [
                { actw: ['* * 99 * * *'] },  // actw 는 매칭 실패 (hour != 99), acip 없으므로 acip_permit=1
                { acip: { ipv4: ['10.0.0.9'] } }  // ipv4 는 non-matching (10.0.0.9 != 10.0.0.5)
            ]
        }]
    }];
    // 두 엔트리 모두 실패했지만, 첫 엔트리가 설정한 acip_permit=1 이 유지되고,
    // 두 번째 엔트리도 acip_permit=1 을 갖고 있다 (sticky latch). actw_permit 는 여전히 0 이지만,
    // 첫 엔트리가 actw_permit=1 을 남긴다면... 아니다. 다시 읽어보자.
    // 첫 엔트리: acip 없으므로 acip_permit=1, actw 있지만 매칭 실패이므로 actw_permit=0
    // 두 엔트리 모두 acip_permit==1 && actw_permit==1 을 만족하지 못하므로 continue
    // 루프 끝까지 도달. 이건 거부되어야 한다.
    // 아, 원본을 다시 보니 acip 필드가 없으면 acip_permit=1, actw 필드가 없으면 actw_permit=1 이다.
    // 그래서 수정된 테스트:
    const pv2 = [{
        acr: [{
            acor: ['CAdmin'],
            acop: 63,
            acco: [
                { actw: ['* * 99 * * *'] },  // actw 있지만 매칭 실패 (hour != 99), 다른 필드도 모두 안 맞음. acip 없으므로 acip_permit=1
                { acip: { ipv4: ['10.0.0.9'] } }  // acip 있지만 매칭 실패, actw 없으므로 actw_permit=1
            ]
        }]
    }];
    // 첫 엔트리: acip_permit=1 (no acip field), actw_permit=0 (no match)
    // 브레이크하지 않음 (둘 다 1이 아니므로)
    // 두 엔트리: acip_permit=0 (ipv4 no match), but wait... acip_permit 는 sticky이므로 여전히 1?
    // 아니다. 원본을 다시 읽어야 한다.
    // 원본 line 136-138: if (actw_permit == 1 && acip_permit == 1) { break; }
    // 즉, 두 플래그가 모두 1 이면 루프를 탈출한다.
    // 아, 내가 잘못 이해했다. sticky latch 는 "한 번 1 이 되면 리셋되지 않는다"는 뜻이다.
    // 따라서:
    // 첫 엔트리: acip_permit 1 (no acip), actw_permit 0 (no match in actw)
    // 두 번째 엔트리: acip_permit 는 이미 1 이므로 리셋 안 됨, acip 검사 실패해도 1 유지. actw_permit 1 (no actw)
    // 결과: acip_permit==1 && actw_permit==1 → 허용!
    // 이게 버그다. 각 엔트리가 독립적으로 평가되어야 하는데, 플래그가 sticky 하므로 이전 엔트리의 영향을 받는다.
    const pv3 = [{
        acr: [{
            acor: ['CAdmin'],
            acop: 63,
            acco: [
                // 첫 엔트리: acip 없음 → acip_permit=1, actw 있지만 매칭 실패 → actw_permit=0
                { actw: ['* * 99 * * *'] },
                // 두 엔트리: acip 있지만 매칭 실패, actw 없음 → actw_permit=1 로 설정
                // 하지만 acip_permit 는 이미 1 로 설정되었고 리셋 안 됨
                { acip: { ipv4: ['10.0.0.9'] } }
            ]
        }]
    }];
    // 첫 엔트리 후: acip_permit=1, actw_permit=0
    // 두 엔트리 후: acip_permit=1 (유지), actw_permit=1 (설정)
    // 결과: 허용
    assert.strictEqual(acp.evaluatePrivileges(pv3, ctx()).allowed, true,
        '원본은 sticky latch 로 인해 복수 acco 규칙의 제약을 우회한다');
});

// KNOWN BUG: Critical #2 - acor 가 없으면 acop 검사를 생략하고 무조건 허용.
test('KNOWN BUG: acr 에 acor 가 없으면 acop 비트 검사를 하지 않고 무조건 허용', function () {
    const pv = [{
        acr: [{
            // acor 필드가 없음! (not provided at all)
            acop: acp.ACOP.RETRIEVE  // RETRIEVE 만 허용한다고 선언했지만...
        }]
    }];
    // DELETE 를 요청하면 normally 거부되어야 하는데, acor 필드가 없으므로 acop 검사가 생략된다.
    const r = acp.evaluatePrivileges(pv, ctx({ acop: acp.ACOP.DELETE }));
    assert.strictEqual(r.allowed, true,
        '원본은 acor 가 없으면 acop 검사를 건너뛰고 무조건 허용한다');
});

// KNOWN BUG: Important #3 - ipv6_idx leak 보존 확인.
test('KNOWN BUG: ipv6_idx 변수 누수로 인한 acip 검사 우회', function () {
    const pv = [{
        acr: [{
            acor: ['CAdmin'],
            acop: 63,
            acco: [
                // 첫 엔트리: 빈 ipv6 리스트. 루프 실행 안 됨 → ipv6_idx 는 99 로 유지
                { acip: { ipv6: [] } },
                // 두 엔트리: ipv4 리스트가 있지만 IP 매칭 실패.
                // 하지만 line 76 의 if (ipv6_idx == 99) 조건이 true 가 되므로
                // acip_permit=1 로 설정된다 (leaked ipv6_idx 때문).
                { acip: { ipv4: ['10.0.0.9'] } }
            ]
        }]
    }];
    const r = acp.evaluatePrivileges(pv, ctx());
    assert.strictEqual(r.allowed, true,
        '원본은 ipv6_idx leak 으로 인해 두 번째 엔트리의 ipv4 검사가 우회된다');
});
