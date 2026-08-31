'use strict';
// DB 에 깨진 값이 든 행 하나가 워커를 죽이면 안 된다.
//
// Mobius 는 배열·객체 속성을 JSON 문자열로 컬럼에 넣는다. 정상 경로는 전부
// JSON.stringify 로 쓰지만, 다음 경우에 깨진 값이 들어올 수 있다.
//
//   - lookup.lbl / csr.poa 등이 varchar(200) 이라, 긴 값이 비-strict sql_mode 에서 잘린다
//   - 마이그레이션이나 수동 편집으로 들어온 행
//
// 이 값을 읽는 곳은 전부 DB 콜백이나 응답 직렬화 도중이라 던지면 잡을 곳이 없다.
// 그러면 그 리소스를 읽는 모든 요청이 워커를 죽이는 크래시 루프가 된다.
// 크래시라서 cluster 가 워커를 다시 띄우지만, 같은 행을 또 읽으면 또 죽는다.

const test = require('node:test');
const assert = require('node:assert');

// responder 는 전역을 읽는다. require 전에 채워 둔다.
global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const responder = require('../mobius/responder');

// 로그를 삼키고 몇 줄이 남았는지 돌려준다
function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); }
    finally { console.error = orig; }
    return lines;
}

// ── 배열 컬럼 ────────────────────────────────────────────────────────

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
            responder.typeCheckforJson(obj);       // 던지면 여기서 실패한다
        });
        assert.ok(Array.isArray(obj['m2m:cnt'][c.attr]),
            c.attr + ' 는 배열이어야 한다: ' + JSON.stringify(obj['m2m:cnt'][c.attr]));
    });
});

test('깨진 값은 조용히 넘어가지 않고 로그를 남긴다', function () {
    // 조용히 빈 배열로 바꾸면 운영자가 깨진 행을 영영 못 찾는다.
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
    // 빈 객체로 바꾸면 없는 권한을 지어내는 셈이라, 원본을 그대로 두고 로그만 남긴다.
    assert.strictEqual(typeof obj['m2m:acp'].pv, 'string', '읽을 수 없는 pv 는 원본 그대로 둔다');
    assert.strictEqual(lines.length, 2, 'pv 와 pvs 각각 한 줄');
});

test('정상 pv 문자열은 객체로 파싱된다 — 가드가 뒤집혀 있었다', function () {
    // getType 은 파싱에 성공하면 'string_object', *실패하면* 'string' 을 준다.
    // 예전 가드는 === 'string' 이라 정상 값을 걸러내고 던질 값만 통과시켰다.
    const obj = { 'm2m:acp': { rn: 'x', ty: 1, pv: '{"acr":[{"acor":["A"],"acop":63}]}' } };
    quiet(function () { responder.typeCheckforJson(obj); });
    assert.deepStrictEqual(obj['m2m:acp'].pv, { acr: [{ acor: ['A'], acop: 63 }] });
});

test('이미 객체인 pv 는 건드리지 않는다', function () {
    // 실제 조회 경로에서는 makeObject 가 먼저 파싱하므로 여기 오는 것은 객체다.
    // 즉 정상 데이터의 응답 표현은 이 수정으로 달라지지 않는다.
    const pv = { acr: [{ acor: ['A'], acop: 63 }] };
    const obj = { 'm2m:acp': { rn: 'x', ty: 1, pv: pv } };
    quiet(function () { responder.typeCheckforJson(obj); });
    assert.deepStrictEqual(obj['m2m:acp'].pv, { acr: [{ acor: ['A'], acop: 63 }] });
});

// ── acp 권한 규칙 (security.js) ──────────────────────────────────────
//
// security_check_action_pv/pvs 는 acp 행의 pv/pvs 를 try 밖에서 파싱했다.
// 깨진 acp 행 하나가 그 ACP 를 참조하는 모든 요청을 죽였다.

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
    // 예전에는 파싱은 통과하고 다음 줄 pvObj.hasOwnProperty 에서 터졌다.
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
    // pv 는 생성 시 타입 검사가 없어 pv: [] 로 만들 수 있다.
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

// ── grp.js 의 get_ri_sri 에러 처리 ───────────────────────────────────
//
// db 계층은 실패할 때 callback(true, err) 로 부른다. 즉 results 자리에
// 에러 객체가 온다. err 를 안 보면 results.length 가 undefined 라
// `undefined == 0` 이 false 가 되고 results[0].ri 에서 워커가 죽는다.

function resolve_ri(err, results, fallback) {
    return (err || results.length == 0) ? fallback : results[0].ri;
}

test('조회 실패 시 입력한 ri 를 그대로 쓴다', function () {
    // 예전 식은 `(results.length == 0) ? ri : results[0].ri` 였다.
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

// ── responder 의 숨은 의존 ────────────────────────────────────────────────
//
// mobius/responder.js 의 require 는 `var db_sql = require('./sql_action');`
// 하나뿐인데, **db_sql 이라는 이름은 그 파일 어디에도 안 나온다.**
// 죽은 require 로 보여서 정리하다 지우기 쉽다.
//
// 그런데 그 require 에는 부수효과가 있다 — sql_action.js 가 로드되면서
// `global.getType` 과 `global.max_lim` 을 설치한다. responder 의
// typeCheckAction 이 ACP 의 pv/pvs 를 다룰 때 getType 을 부른다.
//
// XML 직렬화 514줄을 걷어내면서 responder 의 require 열 개가 진짜로 죽어
// 함께 지웠다. 그때 이 줄까지 쓸어담을 뻔했다. 실측으로 확인했다 —
// 그 줄을 빼고 responder 만 로드하면 global.getType 이 undefined 다.
//
// 이 시험은 "왜 안 쓰는 require 가 있느냐" 는 다음 질문에 대한 답이다.
test('responder 를 로드하면 global.getType 이 설치된다 (db_sql require 의 부수효과)', function () {
    assert.strictEqual(typeof global.getType, 'function',
        'mobius/responder.js 의 sql_action require 를 지웠는가? ' +
        '그 줄이 global.getType 을 설치한다 — 이름이 안 쓰인다고 지우면 ' +
        'typeCheckAction 의 pv/pvs 처리가 TypeError 로 죽는다');

    // 실제로 동작하는지도 본다. 설치만 되고 망가져 있으면 의미가 없다.
    assert.strictEqual(global.getType('{"a":1}'), 'string_object');
    assert.strictEqual(global.getType({ a: 1 }), 'object');
});

test('responder 소스에 sql_action require 가 남아 있다', function () {
    // 위 시험은 다른 테스트가 먼저 sql_action 을 로드하면 통과해 버린다.
    // 소스를 직접 봐서 그 우연에 기대지 않게 한다.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'responder.js'), 'utf8');
    assert.match(src, /require\('\.\/sql_action'\)/,
        'responder.js 에서 sql_action require 가 사라졌다 — global.getType 이 안 설치된다');
});
