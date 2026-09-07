'use strict';
// A single row with a broken value must not kill a worker.
//
// Array and object attributes are stored as JSON strings. Normal writes go through JSON.stringify, but broken values can arrive when a varchar(200) column truncates a long value under a non-strict sql_mode, or through migrations and manual edits.
//
// Every reader of these values runs inside a DB callback or response serialisation, where a throw cannot be caught; the worker would crash on every read of that resource.

const test = require('node:test');
const assert = require('node:assert');

// responder reads globals; they are set before require.
global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const responder = require('../mobius/responder');

// Swallows log output and returns the captured lines.
function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); }
    finally { console.error = orig; }
    return lines;
}

// Array columns.

const BROKEN_ARRAYS = [
    { attr: 'lbl',  raw: '["긴 라벨", "여기서 잘',  why: 'varchar 잘림' },
    { attr: 'acpi', raw: '["/Mobius/ac',            why: 'varchar 잘림' },
    { attr: 'nu',   raw: '<html>error</html>',      why: '엉뚱한 값' },
    { attr: 'poa',  raw: '{"객체":1}',               why: '배열이 아님' },
    { attr: 'mid',  raw: 'null',                    why: 'null 문자열' }
];

BROKEN_ARRAYS.forEach(function (c) {
    test('깨진 ' + c.attr + ' (' + c.why + ') 로 응답을 만들어도 던지지 않는다', function () {
        const obj = { 'm2m:cnt': { rn: 'x', ty: 3 } };
        obj['m2m:cnt'][c.attr] = c.raw;
        quiet(function () {
            responder.typeCheckforJson(obj);       // a throw fails here
        });
        assert.ok(Array.isArray(obj['m2m:cnt'][c.attr]),
            c.attr + ' 는 배열이어야 한다: ' + JSON.stringify(obj['m2m:cnt'][c.attr]));
    });
});

test('깨진 값은 조용히 넘어가지 않고 로그를 남긴다', function () {
    // Silently replacing with an empty array would hide the broken row from the operator; a log line is required.
    const obj = { 'm2m:cnt': { rn: 'x', ty: 3, lbl: '["잘린' } };
    const lines = quiet(function () { responder.typeCheckforJson(obj); });
    assert.strictEqual(lines.length, 1, '한 줄이 남아야 한다');
    assert.ok(/lbl/.test(lines[0]), '어느 속성인지 적혀야 한다: ' + lines[0]);
});

test('정상 배열 문자열은 그대로 파싱된다', function () {
    const obj = { 'm2m:cnt': { rn: 'x', ty: 3, lbl: '["정상","둘"]' } };
    const lines = quiet(function () { responder.typeCheckforJson(obj); });
    assert.deepStrictEqual(obj['m2m:cnt'].lbl, ['정상', '둘']);
    assert.strictEqual(lines.length, 0, '정상 값에는 로그가 없어야 한다');
});

test('이미 배열이면 건드리지 않는다', function () {
    const obj = { 'm2m:cnt': { rn: 'x', ty: 3, lbl: ['그대로'] } };
    quiet(function () { responder.typeCheckforJson(obj); });
    assert.deepStrictEqual(obj['m2m:cnt'].lbl, ['그대로']);
});

// ── pv / pvs ─────────────────────────────────────────────────────────

test('깨진 pv / pvs 로 응답을 만들어도 던지지 않는다', function () {
    const obj = { 'm2m:acp': { rn: 'x', ty: 1, pv: '{"acr":[{"acor":', pvs: '{"acr":[{"acor":' } };
    const lines = quiet(function () { responder.typeCheckforJson(obj); });
    // Replacing with an empty object would invent permissions that do not exist, so the original is kept and only logged.
    assert.strictEqual(typeof obj['m2m:acp'].pv, 'string', '읽을 수 없는 pv 는 원본 그대로 둔다');
    assert.strictEqual(lines.length, 2, 'pv 와 pvs 각각 한 줄');
});

test('정상 pv 문자열은 객체로 파싱된다 — 가드가 뒤집혀 있었다', function () {
    // getType returns 'string_object' when parsing succeeds and 'string' when it fails. The guard must let the parsed value through.
    const obj = { 'm2m:acp': { rn: 'x', ty: 1, pv: '{"acr":[{"acor":["A"],"acop":63}]}' } };
    quiet(function () { responder.typeCheckforJson(obj); });
    assert.deepStrictEqual(obj['m2m:acp'].pv, { acr: [{ acor: ['A'], acop: 63 }] });
});

test('이미 객체인 pv 는 건드리지 않는다', function () {
    // On the real retrieve path makeObject parses first, so the value arriving here is an object; the response for valid data is unchanged.
    const pv = { acr: [{ acor: ['A'], acop: 63 }] };
    const obj = { 'm2m:acp': { rn: 'x', ty: 1, pv: pv } };
    quiet(function () { responder.typeCheckforJson(obj); });
    assert.deepStrictEqual(obj['m2m:acp'].pv, { acr: [{ acor: ['A'], acop: 63 }] });
});

// ACP permission rules (security.js): pv/pvs of an acp row are parsed inside a guard so a broken row cannot fail every request that references the ACP.

const security = require('../mobius/security');

test('정상 pv 문자열은 규칙 객체로 읽힌다', function () {
    const r = security._parse_acp_rule('{"acr":[{"acor":["A"],"acop":63}]}', 'pv', 'ri1');
    assert.deepStrictEqual(r, { acr: [{ acor: ['A'], acop: 63 }] });
});

test('이미 객체면 그대로 준다', function () {
    const o = { acr: [] };
    assert.strictEqual(security._parse_acp_rule(o, 'pv', 'ri1'), o);
});

test("JSON.parse('null') 은 던지지 않고 null 을 준다 — 이쪽이 더 찾기 어려웠다", function () {
    // 'null' parses successfully and must be rejected before pvObj.hasOwnProperty.
    const lines = quiet(function () {
        assert.strictEqual(security._parse_acp_rule('null', 'pv', 'ri1'), null);
    });
    assert.strictEqual(lines.length, 1);
});

test('깨진 pv 는 null 을 주고 던지지 않는다', function () {
    quiet(function () {
        assert.strictEqual(security._parse_acp_rule('{"acr":[{"acor":', 'pv', 'ri1'), null);
        assert.strictEqual(security._parse_acp_rule('', 'pv', 'ri1'), null);
    });
});

test('배열은 권한 규칙 객체가 아니다', function () {
    // pv has no type check at creation, so pv: [] can exist.
    quiet(function () {
        assert.strictEqual(security._parse_acp_rule('[]', 'pv', 'ri1'), null);
    });
});

test('읽을 수 없는 규칙은 어느 acp 인지 로그에 남긴다', function () {
    const lines = quiet(function () { security._parse_acp_rule('깨짐', 'pvs', '1-abc'); });
    assert.strictEqual(lines.length, 1);
    assert.ok(/1-abc/.test(lines[0]), 'ri 가 있어야 한다: ' + lines[0]);
    assert.ok(/pvs/.test(lines[0]), '어느 속성인지 있어야 한다: ' + lines[0]);
});

// get_ri_sri error handling in grp.js. The db layer calls callback(true, err) on failure, so the results slot holds an error object; err must be checked before results.length.

function resolve_ri(err, results, fallback) {
    return (err || results.length == 0) ? fallback : results[0].ri;
}

test('조회 실패 시 입력한 ri 를 그대로 쓴다', function () {
    // With err set, the fallback is returned.
    const errObj = { code: 'ER_LOCK_WAIT_TIMEOUT', message: 'lock timeout' };
    assert.strictEqual(resolve_ri(true, errObj, '/Mobius/x'), '/Mobius/x');
});

test('예전 식이 왜 죽었는지 고정해 둔다', function () {
    const errObj = { code: 'X', message: 'y' };
    assert.strictEqual(errObj.length, undefined);
    assert.strictEqual(errObj.length == 0, false, 'undefined == 0 은 false 다');
    assert.throws(function () { return errObj[0].ri; }, TypeError);
});

test('결과가 비면 입력한 ri 를, 있으면 찾은 ri 를 쓴다', function () {
    assert.strictEqual(resolve_ri(null, [], '/Mobius/x'), '/Mobius/x');
    assert.strictEqual(resolve_ri(null, [{ ri: '/Mobius/찾음' }], '/Mobius/x'), '/Mobius/찾음');
});

// Hidden dependency in responder: its `require('./sql_action')` is never referenced by name, but loading sql_action installs `global.getType` and `global.max_lim`, which responder's typeCheckAction uses for ACP pv/pvs. The require must stay.
test('responder 를 로드하면 global.getType 이 설치된다 (db_sql require 의 부수효과)', function () {
    assert.strictEqual(typeof global.getType, 'function',
        'mobius/responder.js 의 sql_action require 를 지웠는가? ' +
        '그 줄이 global.getType 을 설치한다 — 이름이 안 쓰인다고 지우면 ' +
        'typeCheckAction 의 pv/pvs 처리가 TypeError 로 죽는다');

    // The installed function must also work.
    assert.strictEqual(global.getType('{"a":1}'), 'string_object');
    assert.strictEqual(global.getType({ a: 1 }), 'object');
});

test('responder 소스에 sql_action require 가 남아 있다', function () {
    // The test above would pass if another test loaded sql_action first; the source is checked directly.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'responder.js'), 'utf8');
    assert.match(src, /require\('\.\/sql_action'\)/,
        'responder.js 에서 sql_action require 가 사라졌다 — global.getType 이 안 설치된다');
});
