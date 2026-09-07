'use strict';
/*
 * Rules for relaying an upstream (remote CSE or AE) response to the client.
 *
 * Every Mobius response passes responder.apply_headers and is fixed to json, except the remoteCSE forwarding path (check_csr -> forward_http), which writes the response directly through settle.raw. The upstream Content-Type must be validated there instead of copied.
 *
 * app.js forks and listens on require, so the function cannot be called directly; its source is cut out and evaluated. If the source moves or is renamed the test fails with 'not found', which points the next reader to where the rule went.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');

// outbound_headers is a module (mobius/outbound_headers.js) and is called directly.
const outbound_headers = require('../mobius/outbound_headers');

// relay_headers still lives in app.js, which cannot be required (cluster.fork() and listen run on require), so that function alone is cut out of the source.
//
// If the source moves or is renamed the test fails with 'not found'.
const helpers = (function () {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const s = src.indexOf('function relay_headers(');
    assert.ok(s > 0, 'app.js 에서 relay_headers 를 못 찾았다');
    // The end marker is check_csr.
    const e = src.indexOf('function check_csr(', s);
    assert.ok(e > s, 'app.js 에서 check_csr 을 못 찾았다 — 잘라 낼 끝을 모른다');

    // relay_headers uses RELAY_JSON_OK declared above it; both are cut out together.
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
    finally { try { fs.unlinkSync(tmp); } catch (x) { /* ignore removal failure */ } }
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

/* Outbound requests ask for what this CSE can handle. */

test('나가는 요청의 Accept 를 json 으로 바꾼다 — 대소문자 무관', function () {
    // Both paths forward the client's headers to the upstream. Asking the upstream for xml because the client asked for it leaves no way to handle the xml that comes back; xml/cbor handling no longer exists.
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
    // The argument is request.headers. Modifying it would change what the other paths of this request (logging, fan-out, settlement) see.
    const orig = { 'accept': 'application/xml' };
    helpers.outbound_headers(orig);
    assert.strictEqual(orig['accept'], 'application/xml');
});

/* Incoming responses: anything that is not json is not relayed. */

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
    // Copying even part of the headers leaves remnants when the caller ends with an error.
    for (const ct of [
        'application/xml',
        'application/vnd.onem2m-res+xml',
        'application/cbor',
        'text/html'                      // error page from a front proxy
    ]) {
        const r = relay(ct);
        assert.strictEqual(r.ok, false, ct + ' 를 통과시켰다');
        assert.deepStrictEqual(Object.keys(r.set), [], ct + ' 인데 헤더를 옮겼다');
    }
});

test('무엇을 받았는지 로그에 남는다', function () {
    // The log must name the non-conforming peer.
    const r = relay('application/xml');
    assert.ok(r.log.some((l) => /application\/xml/.test(l)),
        '받은 형식이 로그에 없다: ' + JSON.stringify(r.log));
});

/* The call sites actually use this function. */

test('두 경로가 상류 헤더를 직접 복사하지 않는다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

    // Catches the old form if it returns.
    assert.doesNotMatch(src, /response\.(setHeader|header)\('Content-Type',\s*res\.headers/,
        '상류의 Content-Type 을 검증 없이 복사하는 자리가 돌아왔다 — relay_headers 를 쓸 것');

    // The call site must be alive. The `function relay_headers(...)` definition is excluded from the count. One call site: csr forward.
    const uses = (src.match(/(?<!function )relay_headers\(response, res/g) || []).length;
    assert.strictEqual(uses, 1,
        'relay_headers 호출부가 ' + uses + '곳이다 — csr forward 하나여야 한다');

    const outs = (src.match(/outbound_headers\(request\.headers\)/g) || []).length;
    assert.strictEqual(outs, 1,
        'app.js 의 outbound_headers 호출부가 ' + outs + '곳이다 — csr forward 하나여야 한다');
});

test('상대에게 나가는 요청은 전부 Accept 를 json 으로 고정한다', function () {
    // Fan-out also sends requests to remote CSEs. If a conforming remote honours the client's Accept: application/xml and returns XML, fopt's check_body fails JSON.parse and that member silently drops out of the aggregate.
    const sites = [
        ['app.js',            /outbound_headers\(request\.headers\)/,        'notify_http · forward_http'],
        ['mobius/fanout.js',  /headers:\s*outbound_headers\(request\.headers\)/, 'request_to_member (팬아웃 — 2026-09-05 에 fopt.js 에서 옮김)'],
        // grp.js builds a new header object and writes Accept directly. The form differs but the result is the same, so that form is accepted.
        ['mobius/grp.js',     /'Accept':\s*'application\/json'/,             'check_member (그룹 검증)']
    ];

    for (const [f, pat, label] of sites) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert.match(src, pat,
            f + ' (' + label + ') 이 나가는 요청의 Accept 를 json 으로 고정하지 않는다');
    }

    // No site may pass the client headers through whole.
    for (const f of ['mobius/fanout.js', 'mobius/fopt.js', 'mobius/grp.js']) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert.doesNotMatch(src, /^\s*headers:\s*request\.headers\s*$/m,
            f + ' 이 클라이언트 헤더를 통째로 상대에게 넘긴다 — outbound_headers 를 거칠 것');
    }
});

test('요청 객체에 응답 형식을 담는 자리가 없다 — usebodytype', function () {
    // `request.usebodytype` is a remnant of the xml/cbor era, when the response format had to travel on the request object. With json only its value was always 'json' and no code read it. A variable with a single value must go: it makes the format look selectable and invites a new branch.
    //
    // The format is decided in exactly two places: the json_only gate for incoming and responder.apply_headers' Content-Type for outgoing.
    const files = ['app.js', 'mobius/responder.js', 'mobius/resource.js',
                   'mobius/sgn.js', 'mobius/fanout.js', 'mobius/fopt.js', 'mobius/grp.js'];

    for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');

        // Comments are exempt; only executable lines are searched.
        const live = src.split(/\r?\n/).filter(function (l) {
            return !/^\s*(\/\/|\*|\/\*)/.test(l) && /usebodytype/.test(l);
        });

        assert.deepStrictEqual(live, [],
            f + ' 이 usebodytype 을 실행 코드에서 쓴다: ' + live.join(' | ') +
            '\n  형식은 요청 객체에 실어 옮기지 않는다 — json_only 관문과 ' +
            'responder.apply_headers 두 곳에서만 정한다');
    }
});
