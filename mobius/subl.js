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

/**
 * 항목을 넣거나 갈아 끼운다. **같은 ri 는 하나만 남는다.**
 *
 * 세 경로가 각자 다르게 배열을 만지다가 전부 다른 방식으로 틀렸다.
 *
 *   생성  push 만 하고 같은 ri 가 이미 있는지 안 봤다. 삭제가 실패해 남은
 *         유령 위에 새로 만들면 같은 ri 가 두 개가 된다.
 *   수정  첫 항목만 갈아 끼우고 break 했다. 중복이 있으면 나머지는 옛 nu 를
 *         그대로 들고 계속 발송한다 — 배포의 "낡은 nu 194건" 이 이것이다.
 *   삭제  for-in 으로 돌면서 splice 했다. 뒤 원소가 앞으로 당겨지며 건너뛰어
 *         같은 ri 가 두 개면 하나만 지워진다 — "중복 1,481묶음" 이 안 없어지는
 *         이유다.
 *
 * 자리는 지킨다. 이미 있던 ri 면 그 첫 자리에 새 것을 놓고 나머지 같은 ri 는
 * 버린다. 없던 ri 만 끝에 붙인다. sgn_action 이 이 순서대로 발송하므로
 * 이유 없이 순서를 바꾸지 않는다.
 *
 * 원본을 건드리지 않고 새 배열을 준다.
 */
function upsert(list, entry) {
    var src = Array.isArray(list) ? list : [];
    if (!entry || typeof entry !== 'object' || typeof entry.ri !== 'string') {
        return src.slice();
    }

    var out = [];
    var placed = false;
    for (var i = 0; i < src.length; i++) {
        var it = src[i];
        if (it && it.ri === entry.ri) {
            if (!placed) { out.push(entry); placed = true; }
            continue;                       // 같은 ri 의 나머지는 버린다
        }
        out.push(it);
    }
    if (!placed) { out.push(entry); }
    return out;
}

/**
 * 이 ri 의 항목을 **전부** 뺀다. 하나만 빼면 중복이 남는다.
 * 원본을 건드리지 않고 새 배열을 준다.
 */
function without(list, ri) {
    var src = Array.isArray(list) ? list : [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
        var it = src[i];
        if (it && it.ri === ri) { continue; }
        out.push(it);
    }
    return out;
}

exports.read = read;
exports.upsert = upsert;
exports.without = without;
