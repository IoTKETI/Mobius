'use strict';
// A successful parse does not guarantee an object at the top level. JSON.parse('null') returns null without an error; passing it on as success makes the caller dereference null inside a DB callback or response serialisation, where nothing catches it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

// Premise for the whole file: a parser can succeed and still return a non-object.

test('JSON.parse 는 오류 없이 객체가 아닌 것을 준다', function () {
    // None of the three throws. Object.keys on the result throws later, in a place with no catch.
    assert.strictEqual(JSON.parse('null'), null, '이 null 이 호출부로 흘러갔다');
    assert.strictEqual(JSON.parse('3'), 3);
    assert.strictEqual(JSON.parse('"문자열"'), '문자열');

    assert.throws(function () { return Object.keys(JSON.parse('null')); }, TypeError);
});

test('빈 Buffer 는 isBuffer 를 통과하고 [0] 이 undefined 다', function () {
    // An empty Buffer is still a Buffer.
    const empty = Buffer.alloc(0);
    assert.strictEqual(Buffer.isBuffer(empty), true);
    assert.strictEqual(empty[0], undefined);
    assert.throws(function () { return empty[0].toString(); }, TypeError);
});

// Is the guard in place. app.js forks and listens on require, so its functions cannot be called directly; the source is checked for the guard.

// parse_to_json is the core's only body-parsing path and carries the guard: a top-level non-object is rejected.

test('parse_to_json 의 settle 이 최상위 객체 여부를 본다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

    const start = src.indexOf('function parse_to_json');
    assert.ok(start > 0);
    const body = src.slice(start, src.indexOf('\nfunction parse_body_format', start));

    assert.ok(/function settle\(result\) \{\s*\r?\n\s*if \(!usable_object\(result\)\)/.test(body),
        'settle 이 Object.keys 앞에서 결과를 검사하지 않는다 — 워커가 죽던 자리다');

    // The json branch handles a settle failure with its own code, 400-7.
    assert.ok(body.indexOf("callback('400-7')") > 0,
        'json 분기가 settle 실패를 400-7 로 받지 않는다');

    // settle returns a boolean and the caller must inspect it.
    assert.ok(/if \(!settle\(/.test(body),
        'settle 의 반환값을 보지 않는 호출부가 있다');

    // 400-5 and 400-6 were removed from the reason catalogue; reason.get returns null for them and respond would fail.
    for (const gone of ['400-5', '400-6']) {
        assert.strictEqual(body.indexOf("callback('" + gone + "')"), -1,
            gone + ' 이 되살아났다 — 그 사유는 카탈로그에 없어 respond 가 터진다');
    }
});


