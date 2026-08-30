'use strict';
// Accept 헤더로 응답 형식을 정하는 규칙.
//
// 예전에는 responder 가 `accept.includes('xml')` 한 줄로 정했다. 부분 문자열
// 검사라 두 가지가 어긋나 있었고, 실측으로 확인했다(2026-08-31, 로컬 MySQL):
//
//   Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
//     -> XML.  **브라우저로 Mobius 를 열면 XML 이 나왔다.**
//              application/xhtml+xml 의 'xml' 에 걸린 것이다.
//   Accept: application/json, application/xml
//     -> XML.  json 을 먼저 적었는데도. 순서도 q값도 보지 않았다.
//   Accept: application/cbor
//     -> 헤더는 application/cbor 인데 본문은 JSON 이었다.
//
// 이것을 안 고치고 "Accept 에 xml 이 있으면 400" 을 넣으면 **브라우저가 전부
// 400 을 받는다.** 막으려는 것은 일부러 XML 을 요청하는 클라이언트다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const accept = require('../mobius/accept');
const ROOT = path.join(__dirname, '..');

/* ── 형식 선택 ────────────────────────────────────────────────────── */

const PICK = [
    // [Accept 헤더, 기대 형식, 설명]
    [undefined, 'json', '헤더 없음'],
    ['', 'json', '빈 문자열'],
    ['application/json', 'json', 'json 만'],
    ['application/vnd.onem2m-res+json', 'json', 'oneM2M json'],
    ['*/*', 'json', '와일드카드'],
    ['application/*', 'json', 'application 와일드카드'],
    ['text/html', 'json', '아는 타입이 하나도 없음'],

    // 여기가 브라우저 문제였다
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'json', '브라우저 기본값'],

    // 순서·q 를 무시하던 문제
    ['application/json, application/xml', 'json', 'json 이 먼저'],
    ['application/xml, application/json', 'json', 'xml 이 먼저여도 json'],
    ['application/json;q=0.1, application/xml;q=0.9', 'json', 'xml 의 q 가 높아도 json'],

    // json 이 정말로 안 될 때만 다른 형식
    ['application/xml', 'xml', 'xml 만'],
    ['text/xml', 'xml', 'text/xml'],
    ['application/vnd.onem2m-res+xml', 'xml', 'oneM2M xml'],
    ['application/cbor', 'cbor', 'cbor 만'],
    ['application/vnd.onem2m-res+cbor', 'cbor', 'oneM2M cbor'],
    ['application/xml, application/cbor', 'xml', 'xml 과 cbor 중에는 xml']
];

PICK.forEach(function (c) {
    test('형식 선택 — ' + c[2], function () {
        assert.strictEqual(accept.pick(c[0]), c[1],
            'Accept: ' + (c[0] === undefined ? '(없음)' : c[0]));
    });
});

test('application/xhtml+xml 을 xml 로 보지 않는다', function () {
    // 이것이 브라우저 문제의 뿌리였다. XHTML 문서 타입이지 oneM2M 의 XML
    // 직렬화가 아니다.
    assert.strictEqual(accept.pick('application/xhtml+xml'), 'json',
        'application/xhtml+xml 을 xml 로 본다 — 브라우저가 다시 XML 을 받는다');
});

test('q=0 은 거부로 읽는다', function () {
    // q=0 은 "이건 싫다" 다. 목록에서 뺀다.
    const list = accept.parse('application/xml;q=0, application/json');
    assert.deepStrictEqual(list.map(function (x) { return x.kind; }), ['json']);
});

test('문법이 깨진 조각은 버리고 나머지를 읽는다', function () {
    // 헤더 하나 때문에 요청을 죽이지 않는다.
    assert.doesNotThrow(function () { accept.pick(',,;;, application/json ,,'); });
    assert.strictEqual(accept.pick(',,;;, application/json ,,'), 'json');
    assert.strictEqual(accept.pick('application/xml;q=abc'), 'xml', 'q 가 숫자가 아니면 기본 1');
});

test('숫자·객체를 줘도 던지지 않는다', function () {
    [null, undefined, 0, 42, {}, [], true].forEach(function (v) {
        assert.doesNotThrow(function () { accept.pick(v); }, String(v) + ' 에서 던졌다');
        assert.strictEqual(accept.pick(v), 'json');
    });
});

/* ── json 을 받아들이는가 (앞으로 세울 거절 관문이 쓴다) ───────────── */

test('accepts_json — 브라우저와 와일드카드는 통과시킨다', function () {
    // 거절 관문이 이 함수를 쓴다. 여기서 true 인 요청은 400 을 받지 않는다.
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
     '*/*', 'application/json', 'application/json, application/xml',
     'text/html', '', undefined].forEach(function (h) {
        assert.strictEqual(accept.accepts_json(h), true,
            'Accept: ' + (h === undefined ? '(없음)' : h) + ' 이 걸린다 — 브라우저가 400 을 받는다');
    });
});

test('accepts_json — xml·cbor 만 요구하는 것은 false', function () {
    ['application/xml', 'text/xml', 'application/cbor',
     'application/vnd.onem2m-res+xml', 'application/xml, application/cbor'].forEach(function (h) {
        assert.strictEqual(accept.accepts_json(h), false, 'Accept: ' + h);
    });
});

/* ── responder 가 이 판정을 쓰는가 ────────────────────────────────── */

// 주석은 빼고 코드만 본다 — 설명 주석에는 옛 표현이 예시로 남아 있다.
function code_only(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter(function (l) { return l.trim().indexOf('//') !== 0; })
        .map(function (l) { return l.replace(/\/\/.*$/, ''); })
        .join('\n');
}

test('responder 가 accept.pick 을 거친다', function () {
    const RES = fs.readFileSync(path.join(ROOT, 'mobius', 'responder.js'), 'utf8');
    const at = RES.indexOf('function apply_headers');
    assert.ok(at > 0, 'apply_headers 가 사라졌다');
    const body = code_only(RES.slice(at, RES.indexOf('\n}', at) + 2));

    assert.ok(/accept_hdr\.pick\(/.test(body),
        'apply_headers 가 Accept 를 스스로 판정한다 — 관문과 갈린다');
    assert.ok(!/\.includes\('xml'\)/.test(body),
        '부분 문자열 검사가 돌아왔다 — 브라우저가 다시 XML 을 받는다');
});

test('판정이 한 곳에만 있다', function () {
    // 두 곳에서 판정하면 갈린다. 그게 mobius/accept.js 가 생긴 이유다.
    ['app.js', 'mobius/responder.js'].forEach(function (f) {
        const src = code_only(fs.readFileSync(path.join(ROOT, f), 'utf8'));
        assert.ok(!/accept[^\n]*\.includes\('xml'\)/.test(src),
            f + ' 에 Accept 부분 문자열 검사가 있다 — mobius/accept.js 를 쓸 것');
    });
});
