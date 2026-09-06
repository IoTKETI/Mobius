'use strict';
//
// 생성 시 이름·경로 길이 검사 (ri/sri 설계 메모 §3 A4).
//
// 한계는 스키마의 것이다 — lookup.rn 이 varchar(45), lookup.ri(구조 경로 `pi/rn`)가
// varchar(200). 넘는 값은 MySQL strict 모드가 "Data too long" 으로 거절해 요청이 500 으로
// 끝났다. 클라이언트 입력이 원인이니 받는 쪽에서 400 으로 먼저 끊는다. 배포 실측
// (2026-09-06) 최대 경로는 92자·깊이 7 이라 지금 걸리는 것은 없다.
//
// test/name-limits.test.js 가 두 상수를 mobius/db/mobiusdb.sql 의 컬럼 폭과 대조한다 —
// 스키마를 넓히면 여기도 같이 바꾼다.

var RN_MAX = 45;
var PATH_MAX = 200;

// 넘으면 사유 코드, 아니면 null. 둘 다 넘으면 이름 쪽이다 — 고칠 것이 이름이다.
function check(rn, ri) {
    if (typeof rn === 'string' && rn.length > RN_MAX) { return '400-68'; }
    if (typeof ri === 'string' && ri.length > PATH_MAX) { return '400-69'; }
    return null;
}

module.exports = {
    RN_MAX: RN_MAX,
    PATH_MAX: PATH_MAX,
    check: check
};
