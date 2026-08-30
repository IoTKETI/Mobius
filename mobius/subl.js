'use strict';
// lookup.subl — 발송 라우팅 색인의 계약.
//
// subl 은 부모 리소스에 자식 <subscription> 들을 심어 둔 JSON 배열이다.
// lookup 의 mediumtext 컬럼이고, responder 가 모든 응답에서 지우므로
// **클라이언트에는 절대 나가지 않는다**(responder.js 의 typeCheckAction).
// 순수 내부 자료구조다.
//
// sgn_action 은 sub 테이블이 아니라 이 배열을 훑어 알림을 보낸다. 즉 발송의
// 실제 근거가 여기다. 그래서 이 파일이 "무엇이 유효한 항목인가" 를 정한다.
//
// 이 모듈에는 의존성이 없다. sgn.js 는 sgn_man 을 통해 MQTT 에 붙으므로
// 테스트에서 로드할 수 없다 — 계약을 여기 두면 의존성 없이 시험할 수 있다.

/**
 * subl 항목 하나를 읽는다. 발송에 쓸 수 없으면 null 을 준다.
 *
 * makeObject(resource.js)가 subl 컬럼 문자열을 배열로 풀어 주지만
 * **항목 안쪽은 아무도 정규화하지 않는다.** 반면 sub 테이블은 nu 와 enc 를
 * JSON.stringify 해서 문자열로 들고 있다(sql_action 의 insert_sub). 그 값이
 * 어떤 경로로든 subl 에 들어오면 여기서 문자열인 채 만난다 — subl 을 sub
 * 에서 되만드는 도구를 짜면 가장 자연스러운 구현이 정확히 그 모양이다.
 *
 * 예전에는 sgn_action 이 곧바로 JSON.parse(JSON.stringify(enc.net)) 을 했다.
 * enc 가 문자열이면 .net 은 undefined, JSON.stringify(undefined) 는 값
 * undefined, JSON.parse(undefined) 는 SyntaxError 다. sgn_action 은 DB 콜백
 * 안에서 돌고 sgn.check 호출부 네 곳이 전부 빈 콜백이라, 예외가
 * uncaughtException 이 되어 backstop 이 워커를 내린다. 그 항목이 DB 에 남아
 * 있는 한 재기동할 때마다 같은 일이 반복된다 — 영구 재기동 루프다.
 *
 * nu 만 문자열인 경우는 더 조용히 나쁘다. needs_connection 이 Array.isArray
 * 검사에서 건너뛰어 커넥션을 안 빌리는데, 정작 발송기는 문자열을 배열처럼
 * 훑어 글자 하나씩을 nu 로 취급한다.
 *
 * 항목 하나가 깨졌다고 같은 부모의 다른 구독까지 못 받게 할 이유는 없다.
 * 읽을 수 없으면 그 항목만 건너뛴다.
 *
 * **사본을 뜨지 않는다.** needs_connection 이 알림마다 도는 자리다. 발송 중
 * 소비되는 배열(net, nu)은 호출부가 필요할 때 복제한다.
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
