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
        var ipv6_idx_local = 99;
        for (var j in acip['ipv6']) {
            ipv6_idx_local = j;
            if (acip['ipv6'].hasOwnProperty(j) && acip['ipv6'][j] === clientIp) { return true; }
        }
        // ipv6_idx 를 호출자에게 반환 (다음 acco 엔트리에 영향을 미치도록)
        ipv6_idx_ref.value = ipv6_idx_local;
        if (ipv6_idx_local === 99) {
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
    for (var idx in acco_entry.actw) {
        if (!acco_entry.actw.hasOwnProperty(idx)) { continue; }
        var parts = String(acco_entry.actw[idx]).split(' ');
        for (var d = 0; d < 6; d++) {
            if (parts[d] !== '*' && parts[d] === cur[d].toString()) { return true; }
        }
    }
    return false;
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
    // 엔트리가 없으면 (acco 배열이 비어 있으면) 원본 line 142-145 로 디폴트 허용
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

            // KNOWN BUG: acip_permit/actw_permit 는 loop 밖에서 선언되고 여러 acr 을 거치며 누적된다.
            // 각 acr 마다 새로 초기화하지 않으므로 이전 acr 의 값이 영향을 미친다.
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
