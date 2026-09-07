'use strict';
// mobius/shape.js builds the response body.
//
// The module reads neither request nor response; it maps values to values, so these tests run without HTTP. The normaliser is passed as an argument, so a fake one shows at which depth it is applied; one level off leaves ty and lbl as strings while the response is still 200 with valid JSON.
//
// Equivalence was proven by the differential harness (real express, real sockets, 240 cases, byte comparison). This file guards the structure against regression.

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

// Normaliser stand-in: records what it received. The real one (typeCheckforJson) changes values; here the point is which object it was applied to.
function spy() {
    const calls = [];
    const fn = function (obj) { calls.push(obj); };
    fn.calls = calls;
    return fn;
}

// Prefix rule.

test('root_key — 네 파일에 40번 적혀 있던 표와 같다', function () {
    // fcnt + moduleclass -> hd:<short name>, the former eight else-if branches.
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
    // device.* is not a moduleclass: the standard name is kept.
    assert.strictEqual(shape.root_key('fcnt', { cnd: 'org.onem2m.home.device.x' }), 'm2m:fcnt');
    // Unknown or missing cnd -> m2m:fcnt (GET /.../{fcnt}#lbl used to kill the worker here).
    assert.strictEqual(shape.root_key('fcnt', { cnd: 'x' }), 'm2m:fcnt');
    assert.strictEqual(shape.root_key('fcnt', {}), 'm2m:fcnt');
    // Object.prototype keys must not be matched by the table.
    assert.strictEqual(shape.root_key('fcnt', { cnd: 'toString' }), 'm2m:fcnt');
    assert.strictEqual(shape.root_key('fcnt', { cnd: 'constructor' }), 'm2m:fcnt');
});

test('root_key — 옛 동작을 글자 그대로 보존한다 (고치려면 따로)', function () {
    // An unknown mgd yields 'm2m:undefined' without a guard. Blocking it would change responses currently sent.
    assert.strictEqual(shape.root_key('mgo', { mgd: 9999 }), 'm2m:undefined');
    // The hd_ test uses includes, not startsWith.
    assert.strictEqual(shape.root_key('x_hd_bat', {}), 'hd:x_bat');
});

// The four shapes.

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
    // Fossil of the 2017 signature: a root of dbg produces a body even with rcn=0. Unreachable, but the decision is kept.
    assert.notStrictEqual(shape.single({ dbg: 'x' }, 0, n), null);
});

test('rce — m2m:rce 안쪽 한 겹에만 정규화, 붙이고 나서 지운다', function () {
    const n = spy();
    const obj = { rce: { uri: 'Mobius2/x', cnt: { rn: 'c' } } };
    const out = shape.rce(obj, 'cnt', n);
    assert.deepStrictEqual(Object.keys(out), ['m2m:rce']);
    assert.deepStrictEqual(Object.keys(out['m2m:rce']), ['uri', 'm2m:cnt'], '키 순서는 바이트의 일부다');
    assert.strictEqual(n.calls[0], out['m2m:rce'], '본문이 아니라 **rce 안쪽**에 건다');
    // Does not go through the prefix rule: hd_bat becomes m2m:hd_bat. This is the deployed behaviour.
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

    // Fan-out elements are {fr, rsc, rqi, rvi, pc} without ty, so always 99 -> rsp. The inner key m2m:rsp of a fan-out response hangs on typeRsrc['99'] alone.
    const fan = shape.grouped({ 'm1': { fr: 'x', rsc: 2000 }, 'm2': { fr: 'y', rsc: 2000 } }, 'agr', spy());
    assert.deepStrictEqual(Object.keys(fan['m2m:agr']), ['m2m:rsp']);
    assert.strictEqual(fan['m2m:agr']['m2m:rsp'].length, 2);
    // mgo goes one level deeper by mgd.
    const mg = shape.grouped({ '/m': { ty: '13', mgd: 1001 } }, 'rsp', spy());
    assert.deepStrictEqual(Object.keys(mg['m2m:rsp']), ['m2m:fwr']);
});

test('정규화가 필요한 세 모양은 인자가 없으면 던진다', function () {
    // An optional argument would eventually be omitted, and then integers would go out as strings.
    assert.throws(function () { shape.single({ cnt: {} }, 1); }, TypeError);
    assert.throws(function () { shape.rce({ rce: { cnt: {} } }, 'cnt'); }, TypeError);
    assert.throws(function () { shape.grouped({}, 'rsp'); }, TypeError);
});

// Structure has not regressed (responder.js source, comments removed).

test('responder.js 는 본문 조립을 shape 에 위임한다', function () {
    const src = code('mobius/responder.js');
    assert.strictEqual((src.match(/require\('\.\/shape'\)/g) || []).length, 1, 'shape require 는 정확히 하나');
    ['shape.single(', 'shape.rce(', 'shape.uril(', 'shape.grouped('].forEach(function (c) {
        assert.strictEqual(src.split(c).length - 1, 1, c + ' 호출은 정확히 하나');
    });
    // The resource type table lives in shape only. responder re-exports it; app.js, admin/server.js, resource.js and sql_action.js call responder.typeRsrc.
    assert.strictEqual(/var typeRsrc = \{/.test(src), false, '표 본체가 responder 에 되살아났다');
    assert.match(src, /var typeRsrc = shape\.typeRsrc;/);
    assert.match(src, /exports\.typeRsrc = typeRsrc;/);
    // If the old prefix chain returns to responder, the table exists twice again.
    assert.strictEqual(/org\.onem2m\.home\.moduleclass/.test(src), false, '접두 규칙이 responder 에 되살아났다');
});

test('responder.js 에 죽은 rspObj 가 없다', function () {
    // rspObj was created, overwritten with cap and discarded in four places. A leftover assignment in the group branch, which borrowed the uril branch's var through hoisting, would become an implicit global. The whole file is checked, including the exit block.
    const src = code('mobius/responder.js');
    // The three response functions are gone; body assembly is body_of alone.
    assert.ok(src.indexOf('exports.body_of = function') > 0, '이 시험의 전제가 바뀌었다');
    assert.strictEqual(src.indexOf('rspObj'), -1, 'rspObj 가 되살아났다');
    // cap, the former sixth argument that was stored in rspObj and discarded, must not return either.
    const words = src.split(/[^A-Za-z0-9_$]+/);
    assert.strictEqual(words.filter(function (w) { return w === 'cap'; }).length, 0, 'cap 인자가 되살아났다');
});

test('sgn.js 는 알림 본문의 접두를 shape.root_key 로 만든다', function () {
    // The same four branches (mgo / eight fcnt+moduleclass / hd_ / other) were duplicated in responder.js and sgn.js; fixing one side made the same resource go out under different names in responses and notifications. sgn.js uses root_key.
    const sgn = code('mobius/sgn.js');
    assert.strictEqual((sgn.match(/org\.onem2m\.home\.moduleclass/g) || []).length, 0,
        'sgn.js 에 moduleclass 갈래가 되살아났다 — 표가 다시 두 벌이 된다');
    assert.strictEqual((sgn.match(/shape\.root_key\(/g) || []).length, 1, 'sgn.js 의 root_key 호출은 하나');
    assert.strictEqual(/responder\.mgoType/.test(sgn), false, 'mgo 갈래도 root_key 안이다');
    // responder must stay empty as well; both look at shape.
    assert.strictEqual((code('mobius/responder.js').match(/org\.onem2m\.home\.moduleclass/g) || []).length, 0);
});

test('shape.js 는 request/response/responder 를 모른다', function () {
    // Value to value: testable without HTTP, no circular require, usable from sgn.js.
    const src = code('mobius/shape.js');
    assert.strictEqual(/require\(/.test(src), false, 'shape.js 가 무언가를 require 한다');
    assert.strictEqual(/\brequest\.|\bresponse\./.test(src), false, 'shape.js 가 request/response 를 읽는다');
});
