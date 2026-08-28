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

// acco[].acip 검사. acco 가 없거나 비면 제약 없음으로 통과한다.
function checkAcip(acco_entry, clientIp) {
    if (!acco_entry.hasOwnProperty('acip')) { return true; }
    var acip = acco_entry.acip;

    if (acip.hasOwnProperty('ipv4')) {
        var list4 = acip['ipv4'];
        for (var i in list4) {
            if (list4.hasOwnProperty(i) && list4[i] === clientIp) { return true; }
        }
        return false;
    }
    if (acip.hasOwnProperty('ipv6')) {
        var list6 = acip['ipv6'];
        for (var j in list6) {
            if (list6.hasOwnProperty(j) && list6[j] === clientIp) { return true; }
        }
        return false;
    }
    return true;
}

// KNOWN QUIRK: 원본(security.js)은 6개 필드 중 하나라도 일치하면 허용한다.
// 정상적인 시간창 의미(모든 필드가 맞아야 함)가 아니지만 동작을 보존한다.
// 필드 순서는 [초, 분, 시, 일, 월, 요일].
function checkActw(acco_entry, now) {
    if (!acco_entry.hasOwnProperty('actw')) { return true; }

    var cur = [
        now.getUTCSeconds(), now.getUTCMinutes(), now.getUTCHours(),
        now.getUTCDate(), now.getUTCMonth() + 1, now.getUTCDay()
    ];

    for (var idx in acco_entry.actw) {
        if (!acco_entry.actw.hasOwnProperty(idx)) { continue; }
        var parts = String(acco_entry.actw[idx]).split(' ');
        for (var d = 0; d < 6; d++) {
            if (parts[d] !== '*' && parts[d] === cur[d].toString()) { return true; }
        }
    }
    return false;
}

// acco 배열 전체를 본다. 배열이 비어 있으면 제약 없음으로 통과한다
// (원본의 acco_idx == 99 분기와 같은 결과).
function checkAcco(acr, ctx) {
    if (!acr.hasOwnProperty('acco')) { return true; }
    var acco = acr.acco;
    var sawEntry = false;

    for (var idx in acco) {
        if (!acco.hasOwnProperty(idx)) { continue; }
        sawEntry = true;
        if (checkAcip(acco[idx], ctx.clientIp) && checkActw(acco[idx], ctx.now)) {
            return true;
        }
    }
    return !sawEntry;
}

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
        if ((re && re.test(value)) || value === 'all' || value === '*') {
            return { ok: true, usedRegex: true };
        }
    }
    return { ok: false, usedRegex: true };
}

// pv 또는 pvs 객체들의 배열을 판정한다.
exports.evaluatePrivileges = function (privList, ctx) {
    var sawRegex = false;

    for (var p in privList) {
        if (!privList.hasOwnProperty(p)) { continue; }
        var priv = privList[p];
        if (!priv || !priv.hasOwnProperty('acr')) { continue; }

        for (var index in priv.acr) {
            if (!priv.acr.hasOwnProperty(index)) { continue; }
            var acr = priv.acr[index];

            if (!checkAcco(acr, ctx)) { continue; }

            var acorResult = checkAcor(acr, ctx.originator);
            if (acorResult.usedRegex) { sawRegex = true; }
            if (!acorResult.ok) { continue; }

            // 원본과 동일: 요청한 비트가 acop 에 전부 들어 있어야 한다.
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
