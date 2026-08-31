'use strict';
/*
 * 상류(원격 CSE · AE)의 응답을 클라이언트로 옮길 때의 규칙.
 *
 * ── 이 자리가 왜 특별한가 ────────────────────────────────────────────────
 * Mobius 의 모든 응답은 responder.apply_headers 를 지나며 json 으로 고정된다.
 * 그런데 두 경로만 그것을 **우회**한다:
 *
 *     check_ae_notify -> notify_http    AE 알림 전달
 *     check_csr       -> forward_http   remoteCSE 포워딩
 *
 * 둘 다 settle.raw 로 응답을 직접 내보낸다. 그래서 "이 CSE 는 json 만
 * 만든다" 는 선언이 여기서는 안 걸렸고, 상류가 준 Content-Type 이 검증 없이
 * 그대로 클라이언트로 나갔다. **원격이 xml 을 주면 우리가 xml 을 내보냈다.**
 *
 * ── 왜 소스를 떼어다 시험하나 ───────────────────────────────────────────
 * app.js 는 require 하는 순간 cluster.fork() 와 listen 이 돈다. 함수를 직접
 * 부를 수 없다. 그래서 두 함수의 소스만 잘라 내어 평가한다.
 *
 * 소스가 옮겨지거나 이름이 바뀌면 이 시험이 "못 찾음" 으로 실패한다.
 * 그것도 신호다 — 이 규칙이 어디로 갔는지 다음 사람이 찾게 된다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');

// outbound_headers 는 이제 모듈이다. 그냥 부른다.
//
// 처음에는 app.js 의 지역 함수라 소스를 떼어다 평가했다. fopt.js 도 같은
// 규칙이 필요해지면서 mobius/outbound_headers.js 로 나왔다.
const outbound_headers = require('../mobius/outbound_headers');

// relay_headers 는 아직 app.js 안에 있다. app.js 는 require 하는 순간
// cluster.fork() 와 listen 이 돌아 부를 수 없어, 그 함수만 소스로 떼어 낸다.
//
// 소스가 옮겨지거나 이름이 바뀌면 이 시험이 "못 찾음" 으로 실패한다.
// 그것도 신호다 — 이 규칙이 어디로 갔는지 다음 사람이 찾게 된다.
const helpers = (function () {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const s = src.indexOf('function relay_headers(');
    assert.ok(s > 0, 'app.js 에서 relay_headers 를 못 찾았다');
    const e = src.indexOf('function check_ae_notify(', s);
    assert.ok(e > s, 'app.js 에서 check_ae_notify 를 못 찾았다 — 잘라 낼 끝을 모른다');

    // relay_headers 는 위에 선언된 RELAY_JSON_OK 를 쓴다. 함께 떼어 낸다.
    const reStart = src.indexOf('var RELAY_JSON_OK');
    assert.ok(reStart > 0 && reStart < s, 'RELAY_JSON_OK 를 못 찾았다');

    const tmp = path.join(os.tmpdir(), 'mobius-relay-extract-' + process.pid + '.js');
    fs.writeFileSync(tmp,
        src.slice(reStart, e) +
        '\nmodule.exports = { relay_headers };\n', 'utf8');
    try {
        const m = require(tmp);
        return { outbound_headers, relay_headers: m.relay_headers };
    }
    finally { try { fs.unlinkSync(tmp); } catch (x) { /* 지워지든 말든 */ } }
})();

function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { return { out: fn(), log: lines }; }
    finally { console.error = orig; }
}

function fake_response() {
    const set = {};
    return { _set: set, header(k, v) { set[k] = v; } };
}

function relay(contentType) {
    const resp = fake_response();
    const headers = contentType === null
        ? { 'x-m2m-rsc': '2000' }
        : { 'content-type': contentType, 'x-m2m-rsc': '2000', 'x-m2m-ri': 'r1' };
    const r = quiet(() => helpers.relay_headers(resp, { headers }, 'test'));
    return { ok: r.out, set: resp._set, log: r.log };
}

/* ── 나가는 요청: 우리가 다룰 수 있는 것을 묻는다 ────────────────────── */

test('나가는 요청의 Accept 를 json 으로 바꾼다 — 대소문자 무관', function () {
    // 두 경로 모두 **클라이언트의 헤더를 그대로** 상류에 넘긴다.
    // 클라이언트가 xml 을 요구했다고 상류에 그것을 물으면, 돌아온 xml 을
    // 다룰 방법이 없다. xml/cbor 처리를 전부 걷어냈기 때문이다.
    for (const key of ['accept', 'Accept', 'AcCePt']) {
        const h = helpers.outbound_headers({ [key]: 'application/xml' });
        assert.strictEqual(h['Accept'], 'application/json', key + ' 를 못 바꿨다');
        if (key !== 'Accept') {
            assert.strictEqual(h[key], undefined, key + ' 가 남아 두 개가 나간다');
        }
    }
});

test('Accept 가 없던 요청에도 붙인다', function () {
    assert.strictEqual(helpers.outbound_headers({})['Accept'], 'application/json');
});

test('나머지 헤더는 그대로 넘긴다', function () {
    const h = helpers.outbound_headers({ 'X-M2M-RI': 'keep', 'x-m2m-origin': 'A' });
    assert.strictEqual(h['X-M2M-RI'], 'keep');
    assert.strictEqual(h['x-m2m-origin'], 'A');
});

test('원본 headers 객체를 변형하지 않는다', function () {
    // 인자로 오는 것은 request.headers 다. 그것을 고치면 이 요청의 다른
    // 경로(로그·팬아웃·정산)가 바뀐 값을 보게 된다.
    const orig = { 'accept': 'application/xml' };
    helpers.outbound_headers(orig);
    assert.strictEqual(orig['accept'], 'application/xml');
});

/* ── 들어온 응답: json 이 아니면 흘려보내지 않는다 ───────────────────── */

test('상류가 json 이면 헤더를 옮긴다', function () {
    const r = relay('application/json');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.set['Content-Type'], 'application/json');
    assert.strictEqual(r.set['X-M2M-RSC'], '2000');
    assert.strictEqual(r.set['X-M2M-RI'], 'r1');
});

test('oneM2M 의 json 변형도 통과한다', function () {
    assert.strictEqual(relay('application/vnd.onem2m-res+json;ty=2').ok, true);
});

test('Content-Type 이 없으면 통과한다 — 본문 없는 응답이다', function () {
    const r = relay(null);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.set['Content-Type'], undefined);
    assert.strictEqual(r.set['X-M2M-RSC'], '2000', '나머지 헤더는 옮겨야 한다');
});

test('json 이 아니면 false 를 주고 **아무것도 옮기지 않는다**', function () {
    // 헤더를 일부라도 옮겨 두면 호출자가 오류로 끝낼 때 그 잔재가 남는다.
    for (const ct of [
        'application/xml',
        'application/vnd.onem2m-res+xml',
        'application/cbor',
        'text/html'                      // 앞단 프록시의 오류 페이지
    ]) {
        const r = relay(ct);
        assert.strictEqual(r.ok, false, ct + ' 를 통과시켰다');
        assert.deepStrictEqual(Object.keys(r.set), [], ct + ' 인데 헤더를 옮겼다');
    }
});

test('무엇을 받았는지 로그에 남는다', function () {
    // 어느 상대가 규격을 안 지키는지 알아야 고칠 수 있다.
    const r = relay('application/xml');
    assert.ok(r.log.some((l) => /application\/xml/.test(l)),
        '받은 형식이 로그에 없다: ' + JSON.stringify(r.log));
});

/* ── 두 호출부가 실제로 이 함수를 쓰는지 ─────────────────────────────── */

test('두 경로가 상류 헤더를 직접 복사하지 않는다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

    // 예전 형태가 되살아나면 잡는다.
    assert.doesNotMatch(src, /response\.(setHeader|header)\('Content-Type',\s*res\.headers/,
        '상류의 Content-Type 을 검증 없이 복사하는 자리가 돌아왔다 — relay_headers 를 쓸 것');

    // 두 호출부가 살아 있는지. `function relay_headers(...)` 정의는 빼고 센다.
    const uses = (src.match(/(?<!function )relay_headers\(response, res/g) || []).length;
    assert.strictEqual(uses, 2,
        'relay_headers 호출부가 ' + uses + '곳이다 — ae notify 와 csr forward 둘이어야 한다');

    const outs = (src.match(/outbound_headers\(request\.headers\)/g) || []).length;
    assert.strictEqual(outs, 2,
        'app.js 의 outbound_headers 호출부가 ' + outs + '곳이다 — ae notify 와 csr forward 둘이어야 한다');
});

test('상대에게 나가는 요청은 전부 Accept 를 json 으로 고정한다', function () {
    // 이 시험이 없어서 fopt.js 한 자리가 빠진 채로 남았다.
    // app.js 두 곳만 고치고 "끝났다" 고 적었는데, 팬아웃도 원격 CSE 에
    // 요청을 보낸다는 것을 놓쳤다.
    //
    // 규격을 지키는 원격이 클라이언트의 Accept: application/xml 을 존중해
    // XML 을 주면, fopt 의 check_body 가 JSON.parse 에 실패하고 **그 멤버는
    // 집계에서 조용히 빠진다.** 받는 쪽은 빠진 것을 알 수 없다.
    const sites = [
        ['app.js',            /outbound_headers\(request\.headers\)/,        'notify_http · forward_http'],
        ['mobius/fopt.js',    /headers:\s*outbound_headers\(request\.headers\)/, 'request_to_member (팬아웃)'],
        // grp.js 는 헤더 객체를 새로 만들며 Accept 를 직접 적는다.
        // 형태는 다르지만 결과가 같으므로 그 형태를 그대로 인정한다.
        ['mobius/grp.js',     /'Accept':\s*'application\/json'/,             'check_member (그룹 검증)']
    ];

    for (const [f, pat, label] of sites) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert.match(src, pat,
            f + ' (' + label + ') 이 나가는 요청의 Accept 를 json 으로 고정하지 않는다');
    }

    // 클라이언트 헤더를 **통째로** 넘기는 자리가 남아 있으면 안 된다.
    for (const f of ['mobius/fopt.js', 'mobius/grp.js']) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert.doesNotMatch(src, /^\s*headers:\s*request\.headers\s*$/m,
            f + ' 이 클라이언트 헤더를 통째로 상대에게 넘긴다 — outbound_headers 를 거칠 것');
    }
});
