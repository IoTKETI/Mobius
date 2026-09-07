'use strict';
// Callback contract: a callback is called exactly once.
//
// Mobius's top-level callbacks send the response and return the DB connection together, then null request/response. So
//
//   called twice  -> null is dereferenced, the worker dies, the connection is returned twice
//   never called  -> the request hangs forever and the connection is never returned (pool exhaustion)

const test = require('node:test');
const assert = require('node:assert');

const once = require('../mobius/once');
const poa = require('../mobius/poa');

// ── once ─────────────────────────────────────────────────────────────

test('once 는 첫 호출만 통과시킨다', function () {
    let n = 0;
    const orig = console.error;
    console.error = function () { /* swallows the suppression log */ };
    try {
        const f = once(function () { n++; }, 'test');
        f(); f(); f();
    } finally {
        console.error = orig;
    }
    assert.strictEqual(n, 1);
});

test('once 는 첫 호출의 인자와 반환값을 그대로 전달한다', function () {
    let got = null;
    const f = once(function (a, b) { got = [a, b]; return a + b; });
    const r = f(2, 3);
    assert.strictEqual(r, 5);
    assert.deepStrictEqual(got, [2, 3]);
});

test('once 는 억눌린 호출을 반드시 로그로 남긴다', function () {
    // Swallowing silently would hide a newly introduced double call.
    const lines = [];
    const orig = console.error;
    console.error = function (s) { lines.push(String(s)); };
    try {
        const f = once(function () {}, '내가 붙인 이름');
        f();
        f();
    } finally {
        console.error = orig;
    }
    assert.strictEqual(lines.length, 1, '두 번째 호출에서 한 줄이 남아야 한다');
    assert.ok(/내가 붙인 이름/.test(lines[0]), '라벨이 로그에 있어야 한다: ' + lines[0]);
});

test('once 는 콜백 자리에 함수가 아닌 것이 오면 던진다', function () {
    // That is a defect in itself; hiding it hides the cause.
    assert.throws(function () { once(undefined, 'x'); }, TypeError);
    assert.throws(function () { once(null); }, TypeError);
});

test('once 로 감싼 것을 알아볼 수 있다', function () {
    const f = once(function () {});
    assert.ok(once.wrapped(f));
    assert.ok(!once.wrapped(function () {}));
});

// ── poa parsing ──

test('poa.parse 는 정상 JSON 배열을 읽는다', function () {
    assert.deepStrictEqual(poa.parse('["http://a","http://b"]', 'x'), ['http://a', 'http://b']);
});

test('poa.parse 는 미지정을 빈 배열로 본다', function () {
    // csr.js / ae.js store [] when poa is not given; not an exceptional situation.
    assert.deepStrictEqual(poa.parse(null, 'x'), []);
    assert.deepStrictEqual(poa.parse(undefined, 'x'), []);
    assert.deepStrictEqual(poa.parse('', 'x'), []);
    assert.deepStrictEqual(poa.parse('null', 'x'), []);
});

test('poa.parse 는 이미 배열이면 그대로 준다', function () {
    const a = ['http://a'];
    assert.strictEqual(poa.parse(a, 'x'), a);
});

test('poa.parse 는 깨진 값에 던지지 않고 null 을 준다', function () {
    // A throw here is inside a DB callback with nothing to catch it; the worker dies.
    const orig = console.error;
    console.error = function () {};
    try {
        assert.strictEqual(poa.parse('{깨진 json', 'x'), null);
        assert.strictEqual(poa.parse('"문자열"', 'x'), null);
        assert.strictEqual(poa.parse('42', 'x'), null);
    } finally {
        console.error = orig;
    }
});

test('poa.parse 는 읽을 수 없을 때 이유를 로그로 남긴다', function () {
    const lines = [];
    const orig = console.error;
    console.error = function (s) { lines.push(String(s)); };
    try {
        poa.parse('{깨진', '[어디서] ri');
    } finally {
        console.error = orig;
    }
    assert.strictEqual(lines.length, 1);
    assert.ok(/어디서/.test(lines[0]), '위치가 로그에 있어야 한다: ' + lines[0]);
});

// ── poa selection policy ──
//
// check_csr used to iterate over the poa array and call the callback on every iteration. Now only the first usable http poa is chosen. Below is that selection rule extracted, in the same form as the loop in app.js.

function choose_http(poa_arr) {
    const url = require('url');
    for (let i = 0; i < poa_arr.length; i++) {
        const p = url.parse(poa_arr[i]);
        if (p.protocol == 'http:') { return p; }
    }
    return null;
}

test('여러 poa 중 첫 http 를 고른다', function () {
    const c = choose_http(['mqtt://m', 'http://a:1', 'http://b:2']);
    assert.ok(c);
    assert.strictEqual(c.hostname, 'a');
    assert.strictEqual(c.port, '1');
});

test('http 가 없으면 아무것도 고르지 않는다', function () {
    assert.strictEqual(choose_http(['mqtt://m', 'ws://w']), null);
});

test('빈 poa 는 아무것도 고르지 않는다 — 예전에는 여기서 콜백이 사라졌다', function () {
    assert.strictEqual(choose_http([]), null);
});

// ── The nu iteration index in sgn.js ──
//
// Replaces an ID-form nu with the resolved URLs. pop() would remove the last element of the array, so with two or more nu the wrong entry disappeared.

function replace_at(nu_arr, idx, resolved) {
    Array.prototype.splice.apply(nu_arr, [idx, 1].concat(resolved));
    return idx + resolved.length;
}

test('nu 치환은 그 자리를 바꾸고 다음 항목을 가리킨다', function () {
    const a = ['id1'];
    assert.strictEqual(replace_at(a, 0, ['http://r1']), 1);
    assert.deepStrictEqual(a, ['http://r1']);
});

test('nu 가 2개면 뒤 항목이 살아남는다 (pop 은 이것을 지웠다)', function () {
    const a = ['id1', 'id2'];
    const next = replace_at(a, 0, ['http://r1']);
    assert.deepStrictEqual(a, ['http://r1', 'id2']);
    assert.strictEqual(a[next], 'id2', '다음 인덱스가 미처리 항목을 가리켜야 한다');
});

test('하나가 여러 poa 로 늘어나도 인덱스가 어긋나지 않는다', function () {
    const a = ['id1', 'id2'];
    const next = replace_at(a, 0, ['http://a', 'http://b']);
    assert.deepStrictEqual(a, ['http://a', 'http://b', 'id2']);
    assert.strictEqual(a[next], 'id2');
});

// ── Where the recursion forked (R1 / R4-R5) ──
//
// check_member in grp.js advances the recursion with ++req_count on both the response path and the error path. If both fire, the recursion forks, each branch runs to the end and calls the callback: the group creation response goes out twice, and the second touches a returned connection and a nulled request, killing the worker. outbound.arm cutting a request can raise error right after the response, so this is real.
//
// And two result branches had no else, so the callback vanished on anything but '200'; a hang is not a crash, and no worker restart catches that silent exhaustion.

const fsR = require('node:fs');
const pathR = require('node:path');
const ROOT_R = pathR.join(__dirname, '..');

test('grp 의 멤버 확인이 once 로 감싸여 있다', function () {
    const src = fsR.readFileSync(pathR.join(ROOT_R, 'mobius', 'grp.js'), 'utf8');

    assert.ok(/require\('\.\/once'\)/.test(src), 'grp.js 가 once 를 쓰지 않는다');
    assert.ok(/callback = once\(callback, 'grp check_member/.test(src),
        'check_member 의 콜백이 once 로 감싸이지 않았다 — 재귀가 두 갈래로 갈라진다');

    // That both the response path and the error path recurse is unchanged; without once that would be the defect, so the structure is checked too.
    const at = src.indexOf('function check_member');
    const body = src.slice(at, src.indexOf('\nfunction ', at + 10));
    const recur = (body.match(/check_member\(request, response, \+\+req_count/g) || []).length;
    assert.ok(recur >= 3,
        '재귀 지점이 ' + recur + '곳이다 — 구조가 바뀌었으면 once 의 필요성을 다시 판단할 것');
});

test('check_mtv 가 멤버 확인 실패를 흘려보낸다', function () {
    const src = fsR.readFileSync(pathR.join(ROOT_R, 'mobius', 'grp.js'), 'utf8');
    const at = src.indexOf('function check_mtv');
    const body = src.slice(at, src.indexOf('\nfunction ', at + 10) > 0
        ? src.indexOf('\nfunction ', at + 10) : src.length);

    // An else that calls the callback must exist when check_member's result is not '200'.
    assert.ok(/\}\s*\r?\n\s*else \{[\s\S]{0,400}?callback\(code\);/.test(body),
        'check_member 결과 분기에 else 가 없다 — 실패 시 요청이 매달린다');
});

test('sgn_action 이 nu 해석 뒤 언제나 다음 구독으로 간다', function () {
    const src = fsR.readFileSync(pathR.join(ROOT_R, 'mobius', 'sgn.js'), 'utf8');
    const at = src.indexOf('nu_resolve.resolve(connection, nu_arr, results_ss.ri, function (resolved) {');
    assert.ok(at > 0, 'sgn_action 의 nu_resolve.resolve 호출을 찾지 못했다');
    const body = src.slice(at, at + 1500);

    // resolve always calls back without a code (unresolvable nu are dropped and logged). Inside that callback the next subscription must be called regardless of the nct branch, or the chain stops silently.
    assert.ok(/sgn_action\(connection, rootnm, check_value, rows, \+\+req_count/.test(body),
        'nu 해석 뒤 다음 구독으로 넘어가지 않는다');
    // The old get_nu_arr '200' code contract is gone; a branch still hanging on it is dead code.
    assert.strictEqual(body.indexOf("code == '200'"), -1);
});
