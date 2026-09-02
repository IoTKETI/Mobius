/**
 * @file DB 에러 술어. 의존성 없는 순수 모듈이다.
 *
 * 전환기 동안 두 어휘가 공존한다.
 *   - 구 경로(db_action.js / db_sqlite.js) : 'ER_DUP_ENTRY'
 *   - 파사드(mobius/db/*.js)               : 'DUPLICATE_KEY'
 * 코어(resource.js)는 어느 쪽이 와도 같게 다뤄야 하므로 여기서 흡수한다.
 * 전환이 끝나면 ER_DUP_ENTRY 가지만 지우면 된다.
 */

'use strict';

exports.isDuplicateKey = function (err) {
    if (!err) { return false; }
    return err.code === 'ER_DUP_ENTRY' || err.code === 'DUPLICATE_KEY';
};

// AE-ID(aei) 중복인지 가린다. 제약 이름은 백엔드마다 다르다 —
// MySQL 5.7 'aei_UNIQUE', MySQL 8 'ae.aei_UNIQUE', SQLite 'ae.aei'.
// 파사드는 접두사를 떼어 err.constraint 에 담아 주므로 그걸 먼저 본다.
// 구 경로는 constraint 가 없어 원본 메시지로 판정한다. 이때 SQLite 메시지는
// 'UNIQUE constraint failed: ae.aei' 라 'aei_UNIQUE' 를 포함하지 않으므로,
// 'aei' 를 제약 이름 경계에서 찾아야 한다.
exports.isAeiDuplicate = function (err) {
    if (!err) { return false; }
    if (err.constraint) { return /(^|[^a-z])aei([^a-z]|$)/i.test(err.constraint); }
    if (typeof err.message !== 'string') { return false; }
    return /(?:key '|failed:\s*)(?:[^'\s.]+\.)?aei(?:[^a-z]|$)/i.test(err.message);
};

// 서버가 이 문장 하나를 시간 상한으로 끊었다.
//
// **DB 고장이 아니다.** "이 질의가 감당 못 할 범위" 라는 뜻이라 응답도 달라야
// 한다 — 500 "database error" 로 뭉개면 호출자가 무엇을 고쳐야 할지 모른다.
// 커넥션은 살아 있다(드라이버 타임아웃과 다른 점이다).
//
// 코어가 errno 3024 와 ER_MAX_EXECUTION_TIME_EXCEEDED 를 직접 보고 있었다.
// 그 이름은 드라이버에 없어서 죽은 가지였고(실제 이름은 ER_QUERY_TIMEOUT),
// 숫자는 MySQL 것이라 다른 백엔드에서는 뜻이 없다.
exports.isStatementTimeout = function (err) {
    if (!err) { return false; }
    return err.code === 'STATEMENT_TIMEOUT';
};

// 질의가 이름으로 지목한 인덱스가 서버에 없다.
//
// 코드만 올리고 마이그레이션을 안 돌린 경우다. discovery 는 인덱스를 강제하므로
// 하나가 없으면 **전부** 실패한다 — 원인을 바로 알려줘야 한다.
exports.isMissingIndex = function (err) {
    if (!err) { return false; }
    return err.code === 'MISSING_INDEX';
};

// 로그에 남길 사람 읽을 문장.
//
// 코어가 `err.sqlMessage || err.message` 라고 쓰던 자리다. sqlMessage 는
// **node-mysql 전용 필드**라 코어가 그것을 아는 것 자체가 드라이버 지식이다.
// 폴백이 붙어 있어 다른 백엔드에서도 문장은 나왔지만, 우선순위를 아는 것이
// 이미 "이 드라이버가 더 나은 문장을 어디에 담는지" 를 아는 것이다.
//
// 문자열이 아닌 것이 올 수 있다. 실패 경로는 cb(true, err) 규약이라 2번째
// 인자가 에러인데, 호출부가 그 값을 그대로 넘겨 주는 곳이 있어서 배열이나
// undefined 가 오기도 한다. 던지지 않고 무엇이든 문장으로 만든다.
//
// **길이를 자른다.** 마지막 수단인 JSON.stringify 가 큰 객체를 통째로 찍으면
// 로그가 폭주한다 — 이 저장소는 그 문제를 한 번 겪었다(09477df). 옛 코드는
// '[object Object]' 한 줄로 끝나서 그 위험이 없었으므로, 정보를 늘리면서
// 상한도 같이 둔다.
//
// name 을 message 다음에 보는 이유: `new Error('')` 처럼 메시지가 빈 에러는
// JSON.stringify 가 {} 를 낸다(message 와 stack 이 열거 불가라서). 그러면
// 옛 코드가 주던 'Error' 보다 못하다.
var TEXT_CAP = 500;

exports.text = function (err) {
    if (err === null || err === undefined) { return String(err); }
    if (typeof err === 'string') { return err; }

    var s = err.sqlMessage || err.message || err.name;
    if (typeof s === 'string' && s.length > 0) { return s; }

    var out;
    try { out = JSON.stringify(err); } catch (e) { out = String(err); }
    if (typeof out !== 'string') { return String(err); }
    return out.length > TEXT_CAP ? out.slice(0, TEXT_CAP) + '…(잘림)' : out;
};
