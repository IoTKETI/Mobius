'use strict';
// mobius/shape.js — 응답 **본문**을 만드는 곳. 응답 구조 1단계.
//
// 이 모듈은 request 도 response 도 안 읽고 값을 받아 값을 낸다. 그래서 여기
// 시험은 HTTP 없이 돈다. 정규화 함수는 인자로 받으므로 가짜를 넘겨 **어느
// 깊이에 걸리는지**까지 본다 — 깊이를 한 칸 잘못 잡으면 응답은 200 이고 JSON
// 도 멀쩡한데 ty 가 문자열로, lbl 이 문자열로 나간다.
//
// 등가 자체는 차분 하네스(진짜 express + 진짜 소켓, 240 케이스, 바이트 비교)가
// 증명했다. 여기는 그 뒤에 **구조가 되돌아가지 않는지**를 지킨다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const shape = require('../mobius/shape');

function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// 정규화 대역: **무엇을 받았는지** 기록만 한다. 실물(typeCheckforJson)은
// 값을 바꾸는데, 여기서는 바뀌는 값이 아니라 **어느 객체에 걸렸는지**가 관심이다.
function spy() {
    const calls = [];
    const fn = function (obj) { calls.push(obj); };
    fn.calls = calls;
    return fn;
}

// ── 접두 규칙 ─────────────────────────────────────────────────────────────

test('root_key — 네 파일에 40번 적혀 있던 표와 같다', function () {
    // fcnt + moduleclass -> hd:<약칭>. 옛 else-if 여덟 갈래 그대로.
    const T = {
        doorlock: 'dooLk', battery: 'bat', temperature: 'tempe', binarySwitch: 'binSh',
        faultDetection: 'fauDn', colourSaturation: 'colSn', colour: 'color', brightness: 'brigs'
    };
    Object.keys(T).forEach(function (mc) {
        assert.strictEqual(shape.root_key('fcnt', { cnd: 'org.onem2m.home.moduleclass.' + mc }), 'hd:' + T[mc], mc);
    });
    assert.deepStrictEqual(Object.keys(shape.MODULE_CLASS).length, 8, '표는 여덟 행이다');
});

test('root_key — 네 갈래', function () {
    assert.strictEqual(shape.root_key('cnt', {}), 'm2m:cnt');
    assert.strictEqual(shape.root_key('mgo', { mgd: 1006 }), 'm2m:bat');
    assert.strictEqual(shape.root_key('hd_bat', {}), 'hd:bat');
    // device.* 는 moduleclass 가 아니다 — 표준 이름 그대로
    assert.strictEqual(shape.root_key('fcnt', { cnd: 'org.onem2m.home.device.x' }), 'm2m:fcnt');
    // 모르는 cnd / 없는 cnd -> m2m:fcnt (GET /…/{fcnt}#lbl 로 워커가 죽던 자리)
    assert.strictEqual(shape.root_key('fcnt', { cnd: 'x' }), 'm2m:fcnt');
    assert.strictEqual(shape.root_key('fcnt', {}), 'm2m:fcnt');
    // Object.prototype 의 키가 표에 잡히면 안 된다
    assert.strictEqual(shape.root_key('fcnt', { cnd: 'toString' }), 'm2m:fcnt');
    assert.strictEqual(shape.root_key('fcnt', { cnd: 'constructor' }), 'm2m:fcnt');
});

test('root_key — 옛 동작을 글자 그대로 보존한다 (고치려면 따로)', function () {
    // 모르는 mgd 는 가드 없이 'm2m:undefined' 다. 막으면 지금 나가는 응답이 바뀐다.
    assert.strictEqual(shape.root_key('mgo', { mgd: 9999 }), 'm2m:undefined');
    // hd_ 판정은 startsWith 가 아니라 includes 다.
    assert.strictEqual(shape.root_key('x_hd_bat', {}), 'hd:x_bat');
});

// ── 네 모양 ───────────────────────────────────────────────────────────────

test('single — 접두를 붙인 뒤 한 겹에 정규화', function () {
    const n = spy();
    const obj = { cnt: { rn: 'c', ty: '3' } };
    const out = shape.single(obj, 1, n);
    assert.strictEqual(out, obj, '제자리에서 고친다 (호출부가 그 부수효과에 기댄다)');
    assert.deepStrictEqual(Object.keys(out), ['m2m:cnt']);
    assert.strictEqual(n.calls.length, 1);
    assert.strictEqual(n.calls[0], obj, '**접두를 붙인 본문 그 자체**에 건다 — typeCheckAction 이 키로 갈리기 때문');
});

test('single — rcn=0 은 본문 없음 (== 비교, dbg 화석 그대로)', function () {
    const n = spy();
    assert.strictEqual(shape.single({ cnt: {} }, 0, n), null);
    assert.strictEqual(shape.single({ cnt: {} }, '0', n), null, "문자열 '0' 도 0 이다 — 옛 == 그대로");
    assert.strictEqual(n.calls.length, 0, '본문이 없으면 정규화도 없다');
    // 2017년 시그니처의 화석 — 루트가 dbg 면 rcn=0 이어도 본문을 낸다. 도달
    // 불가지만 판정은 안 바꾼다.
    assert.notStrictEqual(shape.single({ dbg: 'x' }, 0, n), null);
});

test('rce — m2m:rce 안쪽 한 겹에만 정규화, 붙이고 나서 지운다', function () {
    const n = spy();
    const obj = { rce: { uri: 'Mobius2/x', cnt: { rn: 'c' } } };
    const out = shape.rce(obj, 'cnt', n);
    assert.deepStrictEqual(Object.keys(out), ['m2m:rce']);
    assert.deepStrictEqual(Object.keys(out['m2m:rce']), ['uri', 'm2m:cnt'], '키 순서는 바이트의 일부다');
    assert.strictEqual(n.calls[0], out['m2m:rce'], '본문이 아니라 **rce 안쪽**에 건다');
    // 접두 규칙을 안 탄다 — hd_bat 도 m2m:hd_bat. 지금 배포된 동작이다.
    const hd = shape.rce({ rce: { uri: 'u', hd_bat: {} } }, 'hd_bat', spy());
    assert.ok('m2m:hd_bat' in hd['m2m:rce']);
});

test('rce — rce 가 없으면 옛 코드와 같은 자리에서 던진다 (삼키지 않는다)', function () {
    assert.throws(function () { shape.rce({ cnt: {} }, 'cnt', spy()); }, TypeError,
        '조용히 빈 본문을 만들면 결함이 200 뒤에 숨는다. 진짜 방어는 배출구 한 곳이다');
});

test('uril — 네 갈래 중 유일하게 정규화를 안 한다', function () {
    assert.strictEqual(shape.uril.length, 2, '정규화 인자가 **없는** 것이 그 표시다');
    const out = shape.uril({ uril: ['', '[]', 'undefined', '""', 'Mobius2/a'] }, 'uril');
    assert.deepStrictEqual(out['m2m:uril'], ['', '[]', 'undefined', '""', 'Mobius2/a'],
        'typeCheckAction 이 이런 값을 빈 값으로 보고 delete 한다 — 걸면 배열에 구멍이 난다');
});

test('grouped — ty 별로 뭉치고 두 겹 정규화. ty 없으면 99(rsp)', function () {
    const n = spy();
    const obj = { '/a': { ty: '3', rn: 'a' }, '/b': { ty: '4', rn: 'b' }, '/c': { ty: '3', rn: 'c' } };
    const out = shape.grouped(obj, 'rsp', n);
    assert.deepStrictEqual(Object.keys(out), ['m2m:rsp'], '원소는 전부 지워지고 바깥 키 하나만 남는다');
    assert.deepStrictEqual(Object.keys(out['m2m:rsp']), ['m2m:cnt', 'm2m:cin']);
    assert.strictEqual(out['m2m:rsp']['m2m:cnt'].length, 2);
    assert.strictEqual(n.calls[0], out['m2m:rsp'], '그룹 객체에 건다 (두 겹)');

    // 팬아웃 원소는 {fr, rsc, rqi, rvi, pc} 라 ty 가 없다 — 언제나 99 -> rsp.
    // 팬아웃 응답의 안쪽 키 m2m:rsp 는 typeRsrc['99'] 하나에 매달려 있다.
    const fan = shape.grouped({ 'm1': { fr: 'x', rsc: 2000 }, 'm2': { fr: 'y', rsc: 2000 } }, 'agr', spy());
    assert.deepStrictEqual(Object.keys(fan['m2m:agr']), ['m2m:rsp']);
    assert.strictEqual(fan['m2m:agr']['m2m:rsp'].length, 2);
    // mgo 는 mgd 로 한 겹 더
    const mg = shape.grouped({ '/m': { ty: '13', mgd: 1001 } }, 'rsp', spy());
    assert.deepStrictEqual(Object.keys(mg['m2m:rsp']), ['m2m:fwr']);
});

test('정규화가 필요한 세 모양은 인자가 없으면 던진다', function () {
    // 선택 인자로 두면 언젠가 빠뜨린다 — 그러면 subl 이 남고 정수가 문자열로 나간다.
    assert.throws(function () { shape.single({ cnt: {} }, 1); }, TypeError);
    assert.throws(function () { shape.rce({ rce: { cnt: {} } }, 'cnt'); }, TypeError);
    assert.throws(function () { shape.grouped({}, 'rsp'); }, TypeError);
});

// ── 구조가 되돌아가지 않는지 (responder.js 원문, 주석 제거) ───────────────

test('responder.js 는 본문 조립을 shape 에 위임한다', function () {
    const src = code('mobius/responder.js');
    assert.strictEqual((src.match(/require\('\.\/shape'\)/g) || []).length, 1, 'shape require 는 정확히 하나');
    ['shape.single(', 'shape.rce(', 'shape.uril(', 'shape.grouped('].forEach(function (c) {
        assert.strictEqual(src.split(c).length - 1, 1, c + ' 호출은 정확히 하나');
    });
    // 리소스 타입 표의 본체는 shape 에만 있다. responder 는 재export 한다 —
    // app.js·admin/server.js·resource.js·sql_action.js 가 responder.typeRsrc 로 부른다.
    assert.strictEqual(/var typeRsrc = \{/.test(src), false, '표 본체가 responder 에 되살아났다');
    assert.match(src, /var typeRsrc = shape\.typeRsrc;/);
    assert.match(src, /exports\.typeRsrc = typeRsrc;/);
    // 옛 접두 사슬이 responder 에 되살아나면 표가 다시 두 벌이 된다.
    assert.strictEqual(/org\.onem2m\.home\.moduleclass/.test(src), false, '접두 규칙이 responder 에 되살아났다');
});

test('responder.js 에 죽은 rspObj 가 없다', function () {
    // 만들자마자 cap 으로 덮어쓰고 null 로 버리던 것. 세 응답 함수와 sendError
    // 네 자리에 있었다. uril 갈래의 var 를 호이스팅으로 빌려 쓰던 그룹 갈래의
    // 대입이 남으면 암묵적 전역이 된다.
    //
    // 처음엔 "세 함수 구간(~ sendError 앞)" 만 봤는데 1단계 3번이 sendError 를
    // 지우면서 구간 끝 표식이 사라졌다. 파일 전체로 본다 — 배출구 블록에도
    // 없어야 하므로 그쪽이 맞다.
    const src = code('mobius/responder.js');
    assert.ok(src.indexOf('exports.response_result = function') > 0, '이 시험의 전제가 바뀌었다');
    assert.strictEqual(src.indexOf('rspObj'), -1, 'rspObj 가 되살아났다');
    // cap 도 같은 운명이다 — 여섯째 인자로 받아 rspObj 에 넣었다 버리던 것.
    const words = src.split(/[^A-Za-z0-9_$]+/);
    assert.strictEqual(words.filter(function (w) { return w === 'cap'; }).length, 0, 'cap 인자가 되살아났다');
});

test('shape.js 는 request/response/responder 를 모른다', function () {
    // 값 -> 값이어야 HTTP 없이 시험되고, 순환 require 가 없고, sgn.js 도 쓸 수 있다.
    const src = code('mobius/shape.js');
    assert.strictEqual(/require\(/.test(src), false, 'shape.js 가 무언가를 require 한다');
    assert.strictEqual(/\brequest\.|\bresponse\./.test(src), false, 'shape.js 가 request/response 를 읽는다');
});
