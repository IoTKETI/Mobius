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
    const legacySrc = fs.readFileSync(
        pathmod.join(__dirname, '..', 'mobius', 'db_sqlite.js'), 'utf8');

    assert.match(facadeSrc, /process\.env\.MOBIUS_SQLITE_PATH\s*\|\|\s*'\.\/mobius\.db'/,
        'mobius/db/sqlite.js 가 경로 규칙을 벗어났다');

    // 주석은 세지 않는다 — 왜 이렇게 바꿨는지 설명하느라 옛 형태를 인용한다.
    const legacyCode = legacySrc.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    assert.ok(!/sqlite3/.test(legacyCode),
        'mobius/db_sqlite.js 가 다시 자기 핸들을 연다 — 같은 파일에 핸들이 둘이 된다');
    assert.ok(!/mobius\.db/.test(legacyCode),
        'mobius/db_sqlite.js 가 경로를 다시 안다 — 여는 곳은 어댑터뿐이어야 한다');
});
