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

test('구 경로와 파사드가 같은 규칙으로 SQLite 경로를 정한다', function () {
    const facadeSrc = fs.readFileSync(
        pathmod.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'), 'utf8');
    const legacySrc = fs.readFileSync(
        pathmod.join(__dirname, '..', 'mobius', 'db_sqlite.js'), 'utf8');

    const RULE = /process\.env\.MOBIUS_SQLITE_PATH\s*\|\|\s*'\.\/mobius\.db'/;

    assert.match(facadeSrc, RULE, 'mobius/db/sqlite.js 가 규칙을 벗어났다');
    assert.match(legacySrc, RULE, 'mobius/db_sqlite.js 가 경로를 하드코딩하고 있다');

    // 하드코딩된 './mobius.db' 리터럴은 위 규칙 안에서만 나와야 한다.
    assert.strictEqual((legacySrc.match(/'\.\/mobius\.db'/g) || []).length, 1);
});
