'use strict';
// 콜백 계약 — 콜백은 정확히 한 번 불려야 한다.
//
// Mobius 의 상위 콜백은 응답 전송과 DB 커넥션 반납을 함께 하고, 그 직후
// request/response 를 null 로 비운다. 그래서
//
//   두 번 불리면  -> null 을 역참조해 워커가 죽고, 커넥션이 두 번 반납된다
//   안 불리면     -> 요청이 영원히 매달리고 커넥션이 반납되지 않는다 (풀 고갈)
//
// 실제로 poa 가 2개인 remoteCSE 로 포워딩하면 워커가 죽었고,
// poa 가 비면(미지정 시 기본값이다) 요청이 매달렸다.

const test = require('node:test');
const assert = require('node:assert');

const once = require('../mobius/once');
const poa = require('../mobius/poa');

// ── once ─────────────────────────────────────────────────────────────

test('once 는 첫 호출만 통과시킨다', function () {
    let n = 0;
    const orig = console.error;
    console.error = function () { /* 억눌림 로그를 삼킨다 */ };
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
    // 조용히 삼키면 새로 생긴 이중 호출이 묻힌다.
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
    // 그 자체가 결함이다. 감추면 원인을 못 찾는다.
    assert.throws(function () { once(undefined, 'x'); }, TypeError);
    assert.throws(function () { once(null); }, TypeError);
});

test('once 로 감싼 것을 알아볼 수 있다', function () {
    const f = once(function () {});
    assert.ok(once.wrapped(f));
    assert.ok(!once.wrapped(function () {}));
});

// ── poa 파싱 ─────────────────────────────────────────────────────────

test('poa.parse 는 정상 JSON 배열을 읽는다', function () {
    assert.deepStrictEqual(poa.parse('["http://a","http://b"]', 'x'), ['http://a', 'http://b']);
});

test('poa.parse 는 미지정을 빈 배열로 본다', function () {
    // csr.js / ae.js 는 poa 미지정 시 [] 를 넣는다. 예외 상황이 아니다.
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
    // 여기서 던지면 DB 콜백 안이라 잡을 곳이 없어 워커가 죽는다.
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

// ── poa 선택 정책 ────────────────────────────────────────────────────
//
// check_csr / check_ae_notify 는 poa 배열을 순회하며 매 반복마다 콜백을 불렀다.
// 이제는 쓸 수 있는 첫 http poa 하나만 고른다. 아래는 그 선택 규칙을 떼어 둔 것으로,
// app.js 의 루프와 같은 형태다.

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

// ── sgn.js 의 nu 순회 인덱스 ─────────────────────────────────────────
//
// ID 형식 nu 를 풀어낸 URL 로 갈아 끼운다. 예전에는 pop() 이라 배열의
// *마지막* 항목을 지워, nu 가 2개 이상이면 엉뚱한 항목이 사라졌다.

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

// ── 재귀가 두 갈래로 갈라지던 곳 (R1 / R4-R5) ────────────────────────
//
// grp.js 의 check_member 는 응답 경로와 에러 경로가 **둘 다** ++req_count 로
// 재귀를 진행시킨다. 둘 다 발화하면 재귀가 갈라져 각자 끝까지 돌고 각자
// 콜백을 부른다 — 그룹 생성 응답이 두 번 나가고, 두 번째가 이미 반납된
// 커넥션과 null 이 된 request 를 만져 워커가 죽는다.
// outbound.arm 이 요청을 끊으면 응답 직후 error 가 뜰 수 있어 실제로 가능하다.
//
// 그리고 결과 분기에 else 가 없어 '200' 이 아니면 콜백이 사라지던 곳이 둘 있었다.
// 매달림은 크래시가 아니라 워커 재시작도 안 걸리는 조용한 고갈이다.

const fsR = require('node:fs');
const pathR = require('node:path');
const ROOT_R = pathR.join(__dirname, '..');

test('grp 의 멤버 확인이 once 로 감싸여 있다', function () {
    const src = fsR.readFileSync(pathR.join(ROOT_R, 'mobius', 'grp.js'), 'utf8');

    assert.ok(/require\('\.\/once'\)/.test(src), 'grp.js 가 once 를 쓰지 않는다');
    assert.ok(/callback = once\(callback, 'grp check_member/.test(src),
        'check_member 의 콜백이 once 로 감싸이지 않았다 — 재귀가 두 갈래로 갈라진다');

    // 응답 경로와 에러 경로가 둘 다 재귀한다는 사실 자체는 그대로다.
    // once 가 없으면 그것이 곧 결함이므로, 이 구조가 유지되는지도 본다.
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

    // check_member 결과가 '200' 이 아닐 때 콜백을 부르는 else 가 있어야 한다.
    assert.ok(/\}\s*\r?\n\s*else \{[\s\S]{0,400}?callback\(code\);/.test(body),
        'check_member 결과 분기에 else 가 없다 — 실패 시 요청이 매달린다');
});

test('sgn_action 이 nu 해석 뒤 언제나 다음 구독으로 간다', function () {
    const src = fsR.readFileSync(pathR.join(ROOT_R, 'mobius', 'sgn.js'), 'utf8');
    const at = src.indexOf('nu_resolve.resolve(connection, nu_arr, results_ss.ri, function (resolved) {');
    assert.ok(at > 0, 'sgn_action 의 nu_resolve.resolve 호출을 찾지 못했다');
    const body = src.slice(at, at + 1500);

    // resolve 는 코드를 주지 않고 언제나 부른다(못 푼 nu 는 빼고 로그). 그 콜백 안에서
    // nct 갈래와 무관하게 다음 구독 호출이 있어야 한다 — 없으면 사슬이 조용히 멈춘다.
    assert.ok(/sgn_action\(connection, rootnm, check_value, rows, \+\+req_count/.test(body),
        'nu 해석 뒤 다음 구독으로 넘어가지 않는다');
    // 옛 get_nu_arr 의 '200' 코드 계약은 없다 — 그것에 매달린 갈래가 남으면 죽은 코드다.
    assert.strictEqual(body.indexOf("code == '200'"), -1);
});
