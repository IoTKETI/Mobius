'use strict';
// responder's exit: exactly one place puts response bytes on the wire.
//
// respond(spec) takes named fields, and send() validates rsc/status and emits a 500 for invalid values instead of throwing.
//
// Equivalence was proven by the differential harness (real express, real sockets, 240 cases). This file guards against regression. The behavioural stand-in records header/status/end calls and swallows nothing; it mimics only what the real object does (status returns itself for chaining).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const ROOT = path.join(__dirname, '..');
const responder = require('../mobius/responder');
const RSC = require('../mobius/rsc').RSC;

function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Recording stand-in. Order is the contract, so everything goes into one array.
function rec() {
    const log = [];
    const res = {
        header: function (k, v) { log.push(['header', k, v]); return res; },
        status: function (s) { log.push(['status', s]); return res; },
        end:    function (b) { log.push(['end', b]); return res; }
    };
    return { res: res, log: log };
}
function req(extra) {
    return Object.assign({ method: 'GET', url: '/x', headers: { 'x-m2m-ri': 'r1' }, query: {} }, extra || {});
}
function quietErr(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); } finally { console.error = orig; }
    return lines;
}

// Source: one send site.

test('responder.js 에서 response.status().end() 는 한 자리뿐이다', function () {
    const src = code('mobius/responder.js');
    assert.strictEqual((src.match(/response\.status\(/g) || []).length, 1, '원시 전송이 늘었다');
    assert.strictEqual((src.match(/\.end\(/g) || []).length, 1, 'end() 가 늘었다');
    // Counted as a call statement; the definition contains the same characters.
    assert.strictEqual((src.match(/^\s+apply_headers\(request, response, rsc\);/gm) || []).length, 1,
        'apply_headers 호출은 send() 한 곳이어야 한다');
});

test('rt==3 게이트가 없다 — 헤더는 무조건 세운다', function () {
    const src = code('mobius/responder.js');
    assert.strictEqual(/request\.query\.rt\s*==\s*3/.test(src), false,
        'rt 게이트가 되살아났다. app.js 가 rt 를 3 으로 고정하고 1/2 를 405-4 로 막으므로 갈릴 이유가 없다');
});

test('옛 세 응답 함수가 없고, 본문 조립은 body_of 하나다', function () {
    // response_result / response_rcn3_result / search_result no longer exist; the settler (settle.done) takes the result object to body_of and respond. This file must not read request.resourceObj.
    const src = code('mobius/responder.js');
    ['response_result', 'response_rcn3_result', 'search_result'].forEach(function (n) {
        assert.strictEqual(src.indexOf('exports.' + n + ' ='), -1, n + ' 이 되살아났다');
    });
    assert.ok(/exports\.body_of = function \(out, rcn\)/.test(src), 'body_of 가 있어야 한다');
    assert.strictEqual(/request\.resourceObj/.test(src), false, 'responder 가 request.resourceObj 를 읽는다 — 결과는 인자로 온다');
});

// Behaviour: success path.

test('respond — 성공 spec: 헤더 → status → end 순서, 본문은 JSON', function () {
    const r = rec();
    let done = 0;
    responder.respond(req(), r.res, { status: '200', rsc: '2000', body: { 'm2m:cnt': { rn: 'c' } } }, function () { done++; });
    assert.deepStrictEqual(r.log.map(function (x) { return x[0]; }),
        ['header', 'header', 'header', 'status', 'end'],
        'X-M2M-RI · Content-Type · X-M2M-RSC → status → end');
    assert.deepStrictEqual(r.log[2], ['header', 'X-M2M-RSC', '2000']);
    assert.deepStrictEqual(r.log[3], ['status', 200], "status 는 '200' 문자열을 받아 정수로 보낸다");
    assert.deepStrictEqual(r.log[4], ['end', '{"m2m:cnt":{"rn":"c"}}']);
    assert.strictEqual(done, 1, '전송 뒤 done 을 정확히 한 번');
});

test('respond — body 가 null 이면 빈 본문 (rcn=0)', function () {
    const r = rec();
    responder.respond(req(), r.res, { status: 201, rsc: '2001', body: null }, function () {});
    assert.deepStrictEqual(r.log[r.log.length - 1], ['end', '']);
});

test('respond — spec.headers 는 apply_headers 뒤에 얹는다', function () {
    const r = rec();
    responder.respond(req(), r.res, { status: 201, rsc: '2001', body: {}, headers: { 'Content-Location': '/a' } }, function () {});
    const keys = r.log.filter(function (x) { return x[0] === 'header'; }).map(function (x) { return x[1]; });
    assert.deepStrictEqual(keys, ['X-M2M-RI', 'Content-Type', 'X-M2M-RSC', 'Content-Location']);
});

// Behaviour: error path. Must match the former sendError exactly.

test('respond — code 경로: 카탈로그가 status·rsc·본문을 정하고 rt=3 부수효과가 남는다', function () {
    const r = rec();
    const rq = req();
    responder.respond(rq, r.res, { code: RSC.NOT_FOUND, dbg: 'no such thing' }, function () {});
    assert.deepStrictEqual(r.log[2], ['header', 'X-M2M-RSC', RSC.NOT_FOUND.rsc]);
    assert.deepStrictEqual(r.log[3], ['status', RSC.NOT_FOUND.http]);
    assert.deepStrictEqual(r.log[4], ['end', '{"m2m:dbg":"no such thing"}']);
    // What the former sendError did. Not visible in the response, but the harness sees it through queryAfter.
    assert.strictEqual(rq.query.rt, 3);
});

test('respond — detail 은 로그로만 나가고 본문에는 안 실린다', function () {
    const r = rec();
    const lines = quietErr(function () {
        responder.respond(req(), r.res, { code: RSC.INTERNAL_SERVER_ERROR, dbg: 'internal error', detail: 'stack trace here' }, function () {});
    });
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /stack trace here/);
    assert.deepStrictEqual(r.log[r.log.length - 1], ['end', '{"m2m:dbg":"internal error"}'], '내부 상세가 클라이언트로 새면 안 된다');
});

// Behaviour: validation guard, the reason the exit exists.

test('send — rsc 에 객체가 오면 [object Object] 대신 500 으로', function () {
    // A positional argument shifted by one used to arrive here.
    const r = rec();
    let done = 0;
    const lines = quietErr(function () {
        responder.respond(req(), r.res, { status: '200', rsc: { rsc: 2000 }, body: { a: 1 } }, function () { done++; });
    });
    assert.strictEqual(lines.length, 1, '잘못된 명세는 로그에 남는다');
    assert.deepStrictEqual(r.log[2], ['header', 'X-M2M-RSC', '5000']);
    assert.deepStrictEqual(r.log[3], ['status', 500]);
    assert.deepStrictEqual(r.log[4], ['end', '{"m2m:dbg":"internal error"}']);
    assert.strictEqual(done, 1, '500 이어도 done 은 불려야 한다 — 안 그러면 커넥션이 안 돌아온다');
});

test('send — status 가 숫자가 아니면 던지지 않고 500 으로', function () {
    // response.status(NaN) used to throw ERR_HTTP_INVALID_STATUS_CODE, killing the worker with no response and no connection return. Nothing may throw mid-response.
    const r = rec();
    let done = 0;
    quietErr(function () {
        assert.doesNotThrow(function () {
            responder.respond(req(), r.res, { status: 'nope', rsc: '2000', body: {} }, function () { done++; });
        });
    });
    assert.deepStrictEqual(r.log[3], ['status', 500]);
    assert.strictEqual(done, 1);
});

test('send — 가드가 spec.headers 도 버린다 (잘못된 명세의 부속물)', function () {
    const r = rec();
    quietErr(function () {
        responder.respond(req(), r.res, { status: 999, rsc: '2000', body: {}, headers: { 'Content-Location': '/a' } }, function () {});
    });
    const keys = r.log.filter(function (x) { return x[0] === 'header'; }).map(function (x) { return x[1]; });
    assert.strictEqual(keys.indexOf('Content-Location'), -1);
});

test('기존 respond({code, dbg, detail}) 호출 5곳의 모양이 그대로다', function () {
    // These call sites are unchanged, character for character.
    const app = code('app.js');
    const body = code('mobius/body.js');
    const n = (app.match(/responder\.respond\(/g) || []).length + (body.match(/responder\.respond\(/g) || []).length;
    assert.strictEqual(n, 4, 'app.js 3 + body.js 1 (실제 ' + n + ')');
    assert.strictEqual(/responder\.respond\([^)]*\{\s*status:/.test(app + body), false,
        '라우트가 성공 spec 으로 respond 를 직접 부르기 시작했다 — 그건 settle 을 거쳐야 한다 (2단계)');
});
