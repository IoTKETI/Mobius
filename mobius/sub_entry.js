'use strict';
// 발송기가 구독 행을 읽는 계약.
//
// sgn_action 은 select_subs_by_pi 가 준 sub 행(sub_source.rows_for)을 훑어 알림을
// 보낸다. 행의 nu 와 enc 는 insert_sub 가 JSON.stringify 해서 넣은 **문자열**이다.
// 여기서 그것을 풀고, 발송에 쓸 수 없는 행은 null 로 걸러 낸다.
//
// 이 파일은 mobius/subl.js 였다 — lookup.subl(부모 행에 심어 둔 구독 사본)의 계약
// 이었고 pack/upsert/without 으로 사본을 지켰다. 2026-09-05 에 알림 라우팅의 원천이
// sub 테이블로 옮겨지면서 사본과 그 장치는 없어졌고 read 만 남았다.
// 스펙: docs/superpowers/specs/2026-09-05-notification-routing-source-design.md
//
// 이 모듈에는 의존성이 없다. sgn.js 는 sgn_man 을 통해 MQTT 에 붙으므로
// 테스트에서 로드할 수 없다 — 계약을 여기 두면 의존성 없이 시험할 수 있다.

/**
 * 구독 행 하나를 읽는다. 발송에 쓸 수 없으면 null 을 준다.
 *
 * 예전에는 sgn_action 이 곧바로 JSON.parse(JSON.stringify(enc.net)) 을 했다.
 * enc 가 문자열이면 .net 은 undefined, JSON.stringify(undefined) 는 값
 * undefined, JSON.parse(undefined) 는 SyntaxError 다. sgn_action 은 DB 콜백
 * 안에서 돌고 sgn.check 호출부 네 곳이 전부 빈 콜백이라, 예외가
 * uncaughtException 이 되어 backstop 이 워커를 내린다. 그 행이 DB 에 남아
 * 있는 한 재기동할 때마다 같은 일이 반복된다 — 영구 재기동 루프다.
 *
 * 행 하나가 깨졌다고 같은 부모의 다른 구독까지 못 받게 할 이유는 없다.
 * 읽을 수 없으면 그 행만 건너뛴다.
 *
 * **사본을 뜨지 않는다.** 발송 중 소비되는 배열(net, nu)은 호출부가 필요할 때 복제한다.
 */
function read(entry) {
    if (!entry || typeof entry !== 'object') { return null; }
    if (typeof entry.ri !== 'string' || entry.ri === '') { return null; }

    var enc = entry.enc;
    if (typeof enc === 'string') {
        try { enc = JSON.parse(enc); } catch (e) { return null; }
    }
    if (!enc || typeof enc !== 'object' || !Array.isArray(enc.net)) { return null; }

    var nu = entry.nu;
    if (typeof nu === 'string') {
        try { nu = JSON.parse(nu); } catch (e) { return null; }
    }
    if (!Array.isArray(nu)) { return null; }

    return { ri: entry.ri, cr: entry.cr, exc: entry.exc,
             nct: entry.nct, nec: entry.nec, net: enc.net, nu: nu };
}

exports.read = read;

// 발송기가 읽는 필드. select_subs_by_pi 가 고르는 컬럼과 같아야 한다(sub_source 시험이 본다).
exports.FIELDS = ['ri', 'nu', 'enc', 'nct', 'nec', 'cr'];
