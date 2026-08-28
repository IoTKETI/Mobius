'use strict';
// ACP 판정 순수 함수.
//
// security.js 의 security_check_action_pv / _pvs 에서 판정부만 뽑았다.
// DB, request, response 에 의존하지 않으므로 관리 콘솔이 같은 코드를 쓸 수 있다.
//
// 동작 보존이 이 모듈의 계약이다. 원본의 결함(아래 KNOWN 주석)까지 그대로 옮겼다.
// 고칠 때는 test/acp-eval.test.js 의 KNOWN 테스트를 함께 바꿔야 한다.

var ACOP = {
    CREATE: 1, RETRIEVE: 2, UPDATE: 4, DELETE: 8, NOTIFY: 16, DISCOVERY: 32
};

// KNOWN BUG (스펙 §1.8): 원본은 요청자의 originator 로 정규식을 만들고
// 저장된 acor 값을 그 패턴에 매칭한다 — 방향이 뒤집혀 있다.
// X-M2M-Origin: .* 로 보내면 모든 acor 를 통과한다.
// 이 모듈은 동작을 보존하며, 호출자가 알 수 있도록 acorWasRegex 를 돌려준다.
function checkAcor(acr, originator) {
    if (!acr.hasOwnProperty('acor')) { return { ok: true, usedRegex: false }; }

    var re = null;
    try {
        re = new RegExp('^' + originator + '$');
    } catch (e) {
        re = null; // 정규식으로 깨지는 originator 는 매칭 실패로 취급
    }

    for (var idx in acr.acor) {
        if (!acr.acor.hasOwnProperty(idx)) { continue; }
        var value = acr.acor[idx];
        // KNOWN DIFFERENCE: 원본은 value.match(re) 에서 non-string 이면 TypeError 를 던진다.
        // 이 모듈은 re.test(value) 를 사용하므로 type coercion 된다.
        // 원본에서는 이 path 가 '500-1' 을 반환했으나, 여기서는 불필요하다.
        if ((re && re.test(value)) || value === 'all' || value === '*') {
            return { ok: true, usedRegex: true };
        }
    }
    return { ok: false, usedRegex: true };
}

// KNOWN BUG: 원본(security.js:46-150)은 acip_permit/actw_permit 를 루프 밖에서
// 선언하고 절대 리셋하지 않는다. 따라서 OR-누적되는 "sticky latch" 의미를 갖는다.
// acco 배열의 첫 엔트리가 acip_permit=1 을 설정하면 두 번째 엔트리의 IP 검사는
// 매칭 실패해도 acip_permit 이 리셋되지 않아 값이 유지된다.
// 이는 복수 acco 규칙의 제약을 우회하게 만든다.
// 예: acco=[{actw: no match}, {acip: no match}] 에서 첫 엔트리가 acip_permit=1 을 설정하면
// 두 번째 엔트리의 실패한 acip 검사도 acip_permit=1 을 유지하게 된다.

function checkAcip(acco_entry, clientIp, ipv6_idx_ref) {
    if (!acco_entry.hasOwnProperty('acip')) { return true; }
    var acip = acco_entry.acip;

    if (acip.hasOwnProperty('ipv4')) {
        var list4 = acip['ipv4'];
        for (var i in list4) {
            if (list4.hasOwnProperty(i) && list4[i] === clientIp) { return true; }
        }
        // KNOWN BUG: 원본 line 76-78 의 ipv6_idx leak. ipv6_idx 는 함수 스코프로 호이스트되고,
        // 이전 acco 엔트리에서 ipv6 리스트를 처리할 때 설정한 값이 여기서 검사된다.
        // 따라서 이전에 빈 ipv6 리스트를 처리했다면 ipv6_idx=99 로 남아 있고,
        // 현재 ipv4 매칭이 실패해도 이 조건으로 인해 acip_permit=1 이 된다.
        if (ipv6_idx_ref.value === 99) {
            return true;
        }
        return false;
    }
    if (acip.hasOwnProperty('ipv6')) {
        // 원본 line 81: var ipv6_idx = 99; -- 이 분기에 들어올 때마다 매번 리셋된다.
        ipv6_idx_ref.value = 99;
        var list6 = acip['ipv6'];
        for (var j in list6) {
            // 원본의 for (ipv6_idx in list) 는 매 반복마다 -- 매치 여부와 무관하게 --
            // 인덱스를 즉시 대입한다(호이스트된 변수라 이 대입이 다음 acco 엔트리로 leak 된다).
            // 그래서 "매치되는" 반복이라도 sentinel 은 먼저 갱신되고 나서 break 한다.
            // 매치를 찾자마자 대입 전에 return 해버리면 이 leak-clearing 효과가 사라진다 —
            // 이전에 반복(round)에서 이 실수를 했었다.
            ipv6_idx_ref.value = j;
            if (list6.hasOwnProperty(j) && list6[j] === clientIp) { return true; }
        }
        // 원본 line 91: 루프가 끝난 뒤(매치 없이 끝났거나 리스트가 비어 있었던 경우)에만 검사한다.
        if (ipv6_idx_ref.value === 99) {
            return true;
        }
        return false;
    }
    return true;
}

function checkActw(acco_entry, now) {
    if (!acco_entry.hasOwnProperty('actw')) { return true; }

    var cur = [
        now.getUTCSeconds(), now.getUTCMinutes(), now.getUTCHours(),
        now.getUTCDate(), now.getUTCMonth() + 1, now.getUTCDay()
    ];

    // KNOWN QUIRK: 원본(security.js)은 6개 필드 중 하나라도 일치하면 허용한다.
    // 정상적인 시간창 의미(모든 필드가 맞아야 함)가 아니지만 동작을 보존한다.
    //
    // KNOWN BUG: 원본 line 111 의 var actw_idx = 99; 는 이 분기(actw 필드가 있는 경우)에
    // 들어올 때마다 매번 리셋된다. 이어지는 for (actw_idx in actw) 가 한 번도 안 돌면
    // (= actw 배열이 비어 있으면) actw_idx 는 99 로 남고, line 128 의 if (actw_idx == 99)
    // 가 actw_permit=1 로 자동 허용한다 — actw 필드가 아예 없는 경우(else 분기)와 결과가
    // 같다. 이 리셋과 그 유일한 읽기 지점(line 128)은 같은 분기 실행 안에 있어서, 다른
    // acco 엔트리나 다른 acr 에서 넘어온 값이 여기 영향을 주는 leak 은 아니다
    // (ipv6_idx 의 line 76 처럼 다른 분기에서 읽는 경우와 다르다 — 직접 시뮬레이션으로 확인함).
    var sawEntry = false;
    for (var idx in acco_entry.actw) {
        if (!acco_entry.actw.hasOwnProperty(idx)) { continue; }
        sawEntry = true;
        var parts = String(acco_entry.actw[idx]).split(' ');
        for (var d = 0; d < 6; d++) {
            if (parts[d] !== '*' && parts[d] === cur[d].toString()) { return true; }
        }
    }
    return !sawEntry;
}

// acco 배열을 검사한다. acipPermit 와 actwPermit 는 sticky latch: OR-누적되며 절대 리셋되지 않는다.
// 원본 line 46-48 에서 acip_permit/actw_permit 를 루프 밖에 선언한 것과 같은 효과를 낸다.
function checkAcco(acr, ctx, acipPermit, actwPermit, ipv6_idx_ref) {
    if (!acr.hasOwnProperty('acco')) {
        acipPermit.v = 1;
        actwPermit.v = 1;
        return true;
    }
    var acco = acr.acco;
    var sawEntry = false;

    for (var idx in acco) {
        if (!acco.hasOwnProperty(idx)) { continue; }
        sawEntry = true;

        // acipPermit 과 actwPermit 는 리셋되지 않고 OR-누적된다.
        // 각 엔트리에서 true 를 반환하면 해당 플래그가 1 로 설정되고 유지된다.
        if (checkAcip(acco[idx], ctx.clientIp, ipv6_idx_ref)) {
            acipPermit.v = 1;
        }
        if (checkActw(acco[idx], ctx.now)) {
            actwPermit.v = 1;
        }

        // 원본 line 136-138: 두 플래그가 모두 1 이면 루프 탈출
        if (acipPermit.v === 1 && actwPermit.v === 1) {
            return true;
        }
    }
    // 엔트리가 없으면 (acco 배열이 비어 있으면) 원본 line 142-145 로 디폴트 허용.
    //
    // sawEntry 는 원본의 acco_idx 센티널(line 51, 142)을 대신한다: var acco_idx = 99; 는
    // acr 에 acco 필드가 있을 때마다 매번 리셋되고, 유일한 읽기(line 142)도 같은 분기
    // 실행 안에서 그 직후에 일어난다 -- ipv6_idx 의 line 76 처럼 "다른" 분기에서 읽는
    // 구조가 아니다. 그래서 acco_idx 는 acr 을 건너 leak 되지 않는다: 실제로 원본 로직을
    // 그대로 옮겨 직접 시뮬레이션해서 확인했다 -- 앞선 acr 의 acco 루프가 (99 가 아닌)
    // 실제 인덱스로 끝나도, 다음 acr 이 자신의 acco_idx 를 99 로 다시 리셋하므로 그 acr
    // 자신의 빈 배열 여부만으로 결과가 정해진다. sawEntry 는 이 자기완결적(self-contained)
    // 동작을 정확히 재현하며, acr 간에 상태를 끌고 다닐 필요가 없다.
    if (!sawEntry) {
        acipPermit.v = 1;
        actwPermit.v = 1;
        return true;
    }
    return acipPermit.v === 1 && actwPermit.v === 1;
}

// pv 또는 pvs 객체들의 배열을 판정한다.
exports.evaluatePrivileges = function (privList, ctx) {
    var sawRegex = false;
    // KNOWN BUG: ipv6_idx leak. 함수 스코프에서 여러 acco 엔트리를 거치며 누적된다.
    // 원본처럼 var 호이스팅으로 undefined 로 시작하되, checkAcip 에서 업데이트된다.
    var ipv6_idx_ref = { value: undefined };

    for (var p in privList) {
        if (!privList.hasOwnProperty(p)) { continue; }
        var priv = privList[p];
        if (!priv || !priv.hasOwnProperty('acr')) { continue; }

        for (var index in priv.acr) {
            if (!priv.acr.hasOwnProperty(index)) { continue; }
            var acr = priv.acr[index];

            // 원본 line 46-48: var acip_permit = 0; var actw_permit = 0; 은 acr 루프 안,
            // try 블록의 맨 앞에서 매 acr 마다 다시 실행된다 -- 즉 acr 마다 새로 0 으로
            // 리셋된다(누적되지 않는다). 여기서도 매 acr 마다 새 { v: 0 } 객체를 만들어
            // 같은 리셋을 재현한다. acco 배열 "안"의 여러 엔트리를 거치며 OR-누적(sticky
            // latch, checkAcco 참고)되는 것과는 다른 스코프이니 혼동하지 말 것.
            var acipPermit = { v: 0 };
            var actwPermit = { v: 0 };

            if (!checkAcco(acr, ctx, acipPermit, actwPermit, ipv6_idx_ref)) { continue; }

            var acorResult = checkAcor(acr, ctx.originator);
            if (acorResult.usedRegex) { sawRegex = true; }

            // KNOWN BUG: 원본 line 152-170. acip_permit==1 && actw_permit==1 이면:
            // - acor 필드가 있으면 acor 검사와 acop 비트 검사를 함께 한다.
            // - acor 필드가 없으면 acor_permit=1 로 설정하고 acop 검사는 생략한다 (unconditional grant).
            if (!(acipPermit.v === 1 && actwPermit.v === 1)) { continue; }

            if (!acorResult.ok) { continue; }

            // KNOWN BUG: 원본은 acor 필드가 없으면 acop 검사를 하지 않고 무조건 허용한다.
            // 이는 acr 에 acor 가 없으면 어떤 acop 비트를 요청해도 통과시킨다는 뜻이다.
            if (!acr.hasOwnProperty('acor')) {
                return {
                    allowed: true, reason: 'acr-match',
                    matchedIndex: Number(index), acorWasRegex: sawRegex
                };
            }

            // acor 필드가 있을 때만 acop 비트를 검사한다.
            if ((Number(acr.acop) & ctx.acop) === ctx.acop) {
                return {
                    allowed: true, reason: 'acr-match',
                    matchedIndex: Number(index), acorWasRegex: sawRegex
                };
            }
        }
    }

    return { allowed: false, reason: 'no-acr-matched', matchedIndex: null, acorWasRegex: sawRegex };
};

// acpi 를 하나도 못 찾았을 때의 폴백.
// security.js:384 security_default_check_action 을 그대로 옮겼다.
exports.evaluateDefault = function (ctx, enforcement) {
    if (ctx.originator === ctx.creator) {
        return { allowed: true, reason: 'creator' };
    }
    if (enforcement === 'enable') {
        return { allowed: false, reason: 'denied' };
    }
    var open = ACOP.CREATE | ACOP.RETRIEVE | ACOP.DISCOVERY;
    if (ctx.acop & open) {
        return { allowed: true, reason: 'default-open' };
    }
    return { allowed: false, reason: 'denied' };
};

// acpi 가 가리키는 ACP 행이 조회되지 않을 때 (깨진 참조).
// security.js:30-37 과 동일 — 거부가 아니라 생성자 폴백이다.
exports.evaluateBrokenAcpi = function (ctx) {
    if (ctx.originator === ctx.creator) {
        return { allowed: true, reason: 'creator' };
    }
    return { allowed: false, reason: 'denied' };
};

exports.ACOP = ACOP;
