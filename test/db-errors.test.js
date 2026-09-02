'use strict';
const test = require('node:test');
const assert = require('node:assert');
const errors = require('../mobius/db/errors');

test('isDuplicateKey: 구 경로 어휘(ER_DUP_ENTRY)를 받는다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'ER_DUP_ENTRY' }), true);
});

test('isDuplicateKey: 파사드 어휘(DUPLICATE_KEY)를 받는다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'DUPLICATE_KEY' }), true);
});

test('isDuplicateKey: 다른 코드는 거른다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'ER_BAD_NULL_ERROR' }), false);
    assert.strictEqual(errors.isDuplicateKey({ code: 'NOT_NULL' }), false);
    assert.strictEqual(errors.isDuplicateKey({}), false);
});

test('isDuplicateKey: null/undefined 에 안 터진다', function () {
    assert.strictEqual(errors.isDuplicateKey(null), false);
    assert.strictEqual(errors.isDuplicateKey(undefined), false);
});

test('isAeiDuplicate: 파사드 constraint 힌트를 쓴다 (MySQL 8 접두사 제거 후)', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'aei_UNIQUE' }), true);
});

test('isAeiDuplicate: 파사드 constraint 힌트를 쓴다 (SQLite)', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'aei' }), true);
});

test('isAeiDuplicate: constraint 가 다른 제약이면 false', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'ri_UNIQUE' }), false);
});

test('isAeiDuplicate: 구 경로 MySQL 메시지로 판정한다', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry 'Sxxx' for key 'ae.aei_UNIQUE'"
    }), true);
});

// 기존 버그: SQLite 구 경로 메시지에는 'aei_UNIQUE' 가 없어 409-6 판정이 새고 있었다.
test('isAeiDuplicate: 구 경로 SQLite 메시지로도 판정한다', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: ae.aei'
    }), true);
});

test('isAeiDuplicate: 다른 제약의 구 경로 메시지는 false', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: lookup.ri'
    }), false);
});

test('isAeiDuplicate: null/undefined/빈 객체에 안 터진다', function () {
    assert.strictEqual(errors.isAeiDuplicate(null), false);
    assert.strictEqual(errors.isAeiDuplicate(undefined), false);
    assert.strictEqual(errors.isAeiDuplicate({}), false);
});

// --- 코어가 MySQL 어휘를 직접 보던 자리 --------------------------------------
//
// discovery 의 두 판별이 errno 3024 / 1176 과 ER_* 이름을 직접 보고 있었다.
// 그중 하나는 **드라이버에 없는 이름**이라 죽은 가지였다.
const mysql = require('../mobius/db/mysql');

test('normalizeError: 문장 타임아웃을 실제 드라이버 이름으로 잡는다', function () {
    // 코어가 보던 이름은 ER_MAX_EXECUTION_TIME_EXCEEDED 였는데 node-mysql 에는
    // 없다. 실제 이름은 ER_QUERY_TIMEOUT 이라, 그 가지는 한 번도 참이 된 적이
    // 없고 errno 3024 로만 걸리고 있었다.
    const byName = mysql.normalizeError(
        Object.assign(new Error('Query execution was interrupted'), { code: 'ER_QUERY_TIMEOUT' }));
    assert.strictEqual(byName.code, 'STATEMENT_TIMEOUT');
    assert.ok(errors.isStatementTimeout(byName));

    const byErrno = mysql.normalizeError(
        Object.assign(new Error('Query execution was interrupted'), { errno: 3024 }));
    assert.strictEqual(byErrno.code, 'STATEMENT_TIMEOUT');
    assert.ok(errors.isStatementTimeout(byErrno));

    // 원본 드라이버 코드는 보존한다 — 진단에서 필요하다.
    assert.strictEqual(byName.driverCode, 'ER_QUERY_TIMEOUT');
});

test('normalizeError: 인덱스 부재를 잡되 constraint 를 달지 않는다', function () {
    // 서버 메시지가 "Key 'idx_...' doesn't exist in table 'lookup'" 이라
    // 중복키용 정규식 /key '([^']+)'/ 에 그대로 걸린다. 그러면 인덱스 이름이
    // **제약 이름인 척** 달려서 코어로 간다.
    //
    // 지금은 isAeiDuplicate 가 isDuplicateKey 안쪽에만 있어 도달하지 않지만,
    // 그 가둠이 풀리면 곧바로 오진이 된다. 붙이지 않는 것이 맞다.
    const e = mysql.normalizeError(Object.assign(
        new Error("Key 'idx_lookup_pi_notcin' doesn't exist in table 'lookup'"),
        { code: 'ER_KEY_DOES_NOT_EXITS', errno: 1176 }));

    assert.strictEqual(e.code, 'MISSING_INDEX');
    assert.ok(errors.isMissingIndex(e));
    assert.strictEqual(e.constraint, null,
        '인덱스 부재에 제약 이름이 달렸다 — 중복키로 오진할 수 있다');
    assert.ok(!errors.isAeiDuplicate(e),
        '인덱스 부재가 aei 중복으로 읽힌다');
});

test('normalizeError: 중복키에는 constraint 를 그대로 단다', function () {
    // 위 변경이 원래 동작을 깨지 않았는지 본다.
    const e = mysql.normalizeError(Object.assign(
        new Error("Duplicate entry 'x' for key 'ae.aei_UNIQUE'"),
        { code: 'ER_DUP_ENTRY', errno: 1062 }));

    assert.strictEqual(e.code, 'DUPLICATE_KEY');
    assert.strictEqual(e.constraint, 'aei_UNIQUE');
    assert.ok(errors.isAeiDuplicate(e));
});

test('text: 드라이버 전용 필드를 코어 대신 여기서 읽는다', function () {
    // 코어 네 곳이 `err.sqlMessage || err.message` 라고 쓰고 있었다.
    // sqlMessage 는 node-mysql 전용이라 그 우선순위를 아는 것 자체가 드라이버 지식이다.
    assert.strictEqual(errors.text({ sqlMessage: 'from driver', message: 'generic' }),
        'from driver');
    assert.strictEqual(errors.text({ message: 'generic' }), 'generic');
    assert.strictEqual(errors.text('이미 문자열'), '이미 문자열');

    // **던지지 않는다.** 실패 경로는 cb(true, err) 규약이라 2번째 인자가
    // 에러인데, 호출부가 그 값을 그대로 넘겨 배열이나 undefined 가 오기도 한다.
    assert.strictEqual(errors.text(null), 'null');
    assert.strictEqual(errors.text(undefined), 'undefined');
    assert.strictEqual(typeof errors.text([]), 'string');
    assert.strictEqual(typeof errors.text({}), 'string');

    // 메시지가 빈 에러도 이름은 남긴다. 옛 코드는 '[object Object]' 대신
    // 'Error' 를 줬는데, JSON.stringify 는 message/stack 이 열거 불가라 {} 를 낸다.
    assert.strictEqual(errors.text(new Error('')), 'Error');
    assert.strictEqual(errors.text(new TypeError('')), 'TypeError');

    // 순환 참조에도 안 터진다.
    const cyc = {}; cyc.self = cyc;
    assert.strictEqual(typeof errors.text(cyc), 'string');
});

test('text: 로그를 폭주시키지 않는다', function () {
    // 마지막 수단인 JSON.stringify 가 큰 객체를 통째로 찍으면 로그가 폭주한다.
    // 이 저장소는 그 문제를 한 번 겪었다(09477df). 옛 코드는 '[object Object]'
    // 한 줄이라 그 위험이 없었으므로, 정보를 늘리면서 상한도 같이 둔다.
    const big = { rows: [] };
    for (let i = 0; i < 500; i++) { big.rows.push({ ri: 'ri-' + i, con: 'x'.repeat(50) }); }

    const out = errors.text(big);
    assert.ok(out.length < 600, '큰 객체가 잘리지 않았다: ' + out.length + '자');
    assert.ok(/잘림/.test(out), '잘렸다는 표시가 없다');

    // message 가 있으면 자르지 않는다 — 드라이버 에러의 본문은 짧고 그게 요점이다.
    const long = new Error('x'.repeat(2000));
    assert.strictEqual(errors.text(long).length, 2000);
});

test('새 술어들은 null 에 안 터진다', function () {
    for (const f of [errors.isStatementTimeout, errors.isMissingIndex]) {
        assert.strictEqual(f(null), false);
        assert.strictEqual(f(undefined), false);
        assert.strictEqual(f({}), false);
        assert.strictEqual(f({ code: 'UNKNOWN' }), false);
    }
});

// --- SQLite 파일 경로 일원화 -------------------------------------------------
// 파사드와 구 경로가 서로 다른 .db 파일을 열면, 전환된 함수와 안 된 함수가
// 다른 DB 를 보게 된다. 두 모듈이 같은 규칙으로 경로를 정해야 한다.
const fs = require('node:fs');
const pathmod = require('node:path');

test('SQLite 파일을 여는 곳은 어댑터 하나뿐이다', function () {
    // 예전에는 구 경로(db_sqlite.js)와 파사드 어댑터가 **각자 핸들을 열어**
    // 한 프로세스에 같은 파일 핸들이 둘 있었다. 스키마 초기화도 두 번 돌았고,
    // 전환된 함수와 안 된 함수가 서로 다른 핸들로 같은 파일에 썼다.
    // 그래서 그때는 "두 경로 규칙이 같은가" 를 확인해야 했다.
    //
    // 이제 구 경로는 파사드에 위임하는 껍데기라 여는 곳이 하나다.
    // 확인할 것도 하나로 줄었다 — 파일을 여는 곳이 어댑터뿐인가.
    const facadeSrc = fs.readFileSync(
        pathmod.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'), 'utf8');

    assert.match(facadeSrc, /process\.env\.MOBIUS_SQLITE_PATH\s*\|\|\s*'\.\/mobius\.db'/,
        'mobius/db/sqlite.js 가 경로 규칙을 벗어났다');

    // 예전에는 mobius/db_sqlite.js 가 자기 sqlite3 핸들을 여는지도 봤다.
    // 그 파일을 지웠으므로(2026-09-01) 파일이 없는 것이 곧 조건이다.
    assert.strictEqual(
        fs.existsSync(pathmod.join(__dirname, '..', 'mobius', 'db_sqlite.js')), false,
        'mobius/db_sqlite.js 가 되살아났다 — 같은 파일에 핸들이 둘이 될 수 있다');

    // 어댑터 말고 sqlite3 를 require 하는 코어 파일이 없어야 한다.
    const mobiusDir = pathmod.join(__dirname, '..', 'mobius');
    for (const f of fs.readdirSync(mobiusDir)) {
        if (!f.endsWith('.js')) { continue; }
        const src = fs.readFileSync(pathmod.join(mobiusDir, f), 'utf8');
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/require\(['"]sqlite3['"]\)/.test(code),
            'mobius/' + f + ' 이 sqlite3 를 직접 연다 — 여는 곳은 어댑터뿐이어야 한다');
    }
});
