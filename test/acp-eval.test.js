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
// 첫 엔트리: acip 필드 없음 → acip_permit=1. actw 있지만 매칭 실패(hour!=99) → actw_permit=0.
// 두 번째 엔트리: acip 있지만 매칭 실패(10.0.0.9 != clientIp) → 원본은 acip_permit 을 리셋하지
// 않으므로 1 로 유지된다(sticky latch). actw 필드 없음 → actw_permit=1.
// 결과: acip_permit==1 && actw_permit==1 → 허용. 각 엔트리가 독립적으로 평가되어야 정상이지만
// 플래그가 sticky 하므로 이전 엔트리의 영향을 받는다.
test('KNOWN BUG: acco 의 여러 엔트리에 걸친 sticky latch 현상', function () {
    const pv = [{
        acr: [{
            acor: ['CAdmin'],
            acop: 63,
            acco: [
                { actw: ['* * 99 * * *'] },
                { acip: { ipv4: ['10.0.0.9'] } }
            ]
        }]
    }];
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, true,
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

// KNOWN BUG: ipv6_idx leak 은 "매치되면 사라진다" -- 원본의 for (ipv6_idx in list) 는
// 매치되는 반복에서도 매치 여부와 무관하게 sentinel 을 먼저 갱신하고 나서 break 하기
// 때문이다. acr 을 3개로 나눠서 이 순서를 드러낸다 (acor 를 일부러 안 맞춰서 acip/actw
// 판정만으로는 다음 acr 로 넘어가게 만든다):
//   ACR0: acco.acip.ipv6 = [] (빈 리스트) → 루프 0회 → sentinel 99 유지 (leak 발생)
//   ACR1: acco.acip.ipv6 = ['10.0.0.5'] (clientIp 와 매치) → sentinel 이 매치된 인덱스로
//         갱신되어 leak 이 해소된다
//   ACR2: acor 매치, acco.acip.ipv4 = ['10.0.0.9'] (non-match) → ACR1 이 leak 을 지웠으므로
//         line 76 의 (leak) 자동 허용이 발동하지 않아 거부되어야 한다
// 현재 코드는 ipv6 분기에서 매치 시 ipv6_idx_ref 갱신 전에 return 해버려 ACR1 이 leak 을
// 지우지 못하고, ACR2 가 (mobius/acp_eval.js 의 checkAcip ipv4 분기, "if (ipv6_idx_ref.value
// === 99)") 잘못 허용된다 -- allowed:true, matchedIndex:2 로 나온다 (직접 확인함).
// 원본을 그대로 옮긴 시뮬레이션(scratchpad/trace_sim.js Test C)은 allowed:false 를 낸다.
test('KNOWN BUG: ipv6_idx leak 은 뒤따르는 acr 의 ipv6 매치로 해소된다 (3-ACR 시퀀스)', function () {
    const pv = [{
        acr: [
            { acor: ['Nobody0'], acop: 63, acco: [{ acip: { ipv6: [] } }] },
            { acor: ['Nobody1'], acop: 63, acco: [{ acip: { ipv6: ['10.0.0.5'] } }] },
            { acor: ['CAdmin'], acop: 63, acco: [{ acip: { ipv4: ['10.0.0.9'] } }] }
        ]
    }];
    const r = acp.evaluatePrivileges(pv, ctx());
    assert.strictEqual(r.allowed, false,
        'ACR1 의 ipv6 매치가 leak 을 지우므로 ACR2 는 ipv4 불일치로 거부되어야 한다');
});

// KNOWN BUG: actw_idx 의 유일한 읽기(원본 security.js:128)는 실제로는 "leak" 이 아니라
// (원본 line 111 의 var actw_idx = 99; 가 이 분기에 들어올 때마다 매번 리셋하고, 그 직후
// 같은 분기 안에서 바로 읽으므로) 자기완결적인 "빈 actw 배열은 자동 허용" 규칙이다.
// 이 규칙 자체는 checkActw 가 빠뜨리고 있었다 (빈 배열이면 무조건 false 를 반환했다).
test('KNOWN BUG: acco 엔트리의 actw 가 빈 배열이면 시간창 제약 없이 허용', function () {
    const pv = [{ acr: [{ acor: ['CAdmin'], acop: 63, acco: [{ actw: [] }] }] }];
    assert.strictEqual(acp.evaluatePrivileges(pv, ctx()).allowed, true,
        '원본은 actw 배열이 비어 있으면 actw_idx 가 99 로 남아 자동 허용한다');
});

// 확인 테스트 (버그 아님): acco_idx(원본 security.js:51, 142)는 ipv6_idx 와 달리 leak 되지
// 않는다. var acco_idx = 99; 는 acr 에 acco 필드가 있을 때마다 매번 리셋되고, 유일한 읽기
// (line 142)도 같은 분기 실행 안에서 바로 이어진다 -- ipv6_idx 의 line 76 처럼 "다른"
// 분기에서 읽는 구조가 아니다. 원본을 그대로 옮겨 직접 시뮬레이션해서 확인했다
// (scratchpad/trace_sim.js Test B): 앞선 acr 의 (비어 있지 않은) acco 루프가 실제 인덱스로
// 끝나도, 다음 acr 은 자신의 acco_idx 를 99 로 다시 리셋하므로 자신의 빈 배열 여부만으로
// 결과가 정해진다. mobius/acp_eval.js 의 sawEntry 는 acr 마다 새로 만들어지므로 이미
// 이 동작과 일치한다 -- 아래 테스트는 그 사실을 고정한다. acco_idx 를 "누수시키는" 방향으로
// (예: ipv6_idx_ref 처럼 evaluatePrivileges 전체 수명의 참조로) "고치면" 오히려 원본과
// 어긋나게 되므로, 이 테스트가 그런 회귀를 잡아준다.
test('acco_idx 는 acr 을 건너 leak 되지 않는다 -- 앞선 acr 의 실제 인덱스가 남아도 뒤 acr 의 빈 acco 는 그대로 자동 허용', function () {
    const pv = [{
        acr: [
            {
                acor: ['Nobody'], acop: 63,
                acco: [{ acip: { ipv4: ['10.0.0.9'] }, actw: ['1 2 3 4 5 6'] }]
            },
            { acor: ['CAdmin'], acop: 63, acco: [] }
        ]
    }];
    const r = acp.evaluatePrivileges(pv, ctx());
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.matchedIndex, 1,
        '두 번째 acr 의 빈 acco 가 앞선 acr 의 acco_idx 잔여값과 무관하게 자동 허용되어야 한다');
});
