'use strict';
//
// 생성 시 이름·경로·AE-ID 길이 검사 (ri/sri 설계 메모 §3 A4).
//
// oneM2M 은 길이를 정하지 않는다. 한계는 **이 CSE 의 저장소**다 — lookup.rn 이 varchar(45),
// lookup.ri(구조 경로 `pi/rn`)가 varchar(200), lookup.sri(짧은 id · AE 는 aei)가 varchar(45).
// 넘는 값은 MySQL strict 모드가 "Data too long" 으로 거절해 요청이 500 으로 끝났다.
// 사용자는 oneM2M 을 모르므로 "왜 안 되는지" 를 말해 줘야 대처한다 — 500 은 그것을 숨긴다.
// 그래서 받는 쪽에서 400 으로 끊고, 사유 문구에 이 CSE 의 한계라고 적는다(reason.js 가
// 여기 상수로 문구를 만든다).
//
// 값은 배포 스키마의 것이다. 처음엔 rn·sri 가 45 였고, 마이그레이션 018(2026-09-06 적용)이
// rn·sri·spi 를 200 으로 넓힌 뒤 RN_MAX·ID_MAX 를 200 으로 올렸다 — 코드가 스키마보다
// 앞서면 DB 가 500 을 낸다. test/name-limits.test.js 가 mobius/db/mobiusdb.sql 의 폭을
// **넘지 않는지** 대조한다. 경로(ri)는 PK·FK 폭이라 200 그대로다.
//
// AE-ID 의 형식(S/C 로 시작)은 검사하지 않는다 — 사용자 결정, mobius/ae.js 참고.

var RN_MAX = 200;
var PATH_MAX = 200;
var ID_MAX = 200;

// 넘으면 사유 코드, 아니면 null. 둘 다 넘으면 이름 쪽이다 — 고칠 것이 이름이다.
function check(rn, ri) {
    if (typeof rn === 'string' && rn.length > RN_MAX) { return '400-68'; }
    if (typeof ri === 'string' && ri.length > PATH_MAX) { return '400-69'; }
    return null;
}

// 사용자가 지정한 AE-ID. 길이만 본다.
function check_id(aei) {
    if (typeof aei === 'string' && aei.length > ID_MAX) { return '400-70'; }
    return null;
}

module.exports = {
    RN_MAX: RN_MAX,
    PATH_MAX: PATH_MAX,
    ID_MAX: ID_MAX,
    check: check,
    check_id: check_id
};
