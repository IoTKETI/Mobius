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
