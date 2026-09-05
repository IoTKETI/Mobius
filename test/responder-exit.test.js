'use strict';
// responder 의 배출구 — 응답 바이트가 전선에 실리는 자리는 하나다.
//
// 응답 구조 1단계 2번. 예전에는 세 응답 함수와 sendError 가 각자
// apply_headers 를 자기 조건으로 부르고(무조건 2 · rt==3 게이트 2) 각자
// response.status().end() 를 했다 — 여섯 자리. 위치 인자 여섯 개짜리
// 시그니처라 한 칸만 밀려도 rsc 자리에 객체가 가서 `X-M2M-RSC: [object Object]`
// 가 나갔고, callback 자리에 문자열이 가서 워커가 죽었다. 두 번 일어났다.
//
// 지금은 respond(spec) 이 **이름 있는 필드**로 받고, send() 가 rsc/status 를
// 검사해 잘못된 것은 던지지 않고 500 으로 내보낸다.
//
// 등가는 차분 하네스(진짜 express + 진짜 소켓, 240 케이스)가 증명했다.
// 여기는 **되돌아가지 않는지**를 지킨다. 행위 검사의 대역은 header/status/end
// 호출을 **기록만** 하고 아무것도 삼키지 않는다 — 실물이 하는 일(status 가
// 체이닝을 위해 자기를 돌려주는 것)만 흉내낸다.

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

// 기록형 대역. 순서가 계약이라 한 배열에 전부 적는다.
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

// ── 원문: 전송 자리는 하나 ────────────────────────────────────────────────

test('responder.js 에서 response.status().end() 는 한 자리뿐이다', function () {
    const src = code('mobius/responder.js');
    assert.strictEqual((src.match(/response\.status\(/g) || []).length, 1, '원시 전송이 늘었다');
    assert.strictEqual((src.match(/\.end\(/g) || []).length, 1, 'end() 가 늘었다');
    // 호출문 형태로 센다 — 정의문도 같은 글자를 품는다.
    assert.strictEqual((src.match(/^\s+apply_headers\(request, response, rsc\);/gm) || []).length, 1,
        'apply_headers 호출은 send() 한 곳이어야 한다');
});

test('rt==3 게이트가 없다 — 헤더는 무조건 세운다', function () {
    const src = code('mobius/responder.js');
    assert.strictEqual(/request\.query\.rt\s*==\s*3/.test(src), false,
        'rt 게이트가 되살아났다. app.js 가 rt 를 3 으로 고정하고 1/2 를 405-4 로 막으므로 갈릴 이유가 없다');
});

test('옛 세 응답 함수가 없고, 본문 조립은 body_of 하나다', function () {
    // 1단계 2번에서 셋이 전송을 respond 에 위임했고, 2단계 10번에서 셋을 지웠다 —
    // 정산기(settle.done)가 결과 객체를 받아 body_of 와 respond 로 간다.
    // request.resourceObj 를 읽는 자리가 이 파일에 없어야 한다.
    const src = code('mobius/responder.js');
    ['response_result', 'response_rcn3_result', 'search_result'].forEach(function (n) {
        assert.strictEqual(src.indexOf('exports.' + n + ' ='), -1, n + ' 이 되살아났다');
    });
    assert.ok(/exports\.body_of = function \(out, rcn\)/.test(src), 'body_of 가 있어야 한다');
    assert.strictEqual(/request\.resourceObj/.test(src), false, 'responder 가 request.resourceObj 를 읽는다 — 결과는 인자로 온다');
});

// ── 행위: 성공 경로 ───────────────────────────────────────────────────────

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

// ── 행위: 에러 경로 — 옛 sendError 와 글자 그대로 같아야 한다 ─────────────

test('respond — code 경로: 카탈로그가 status·rsc·본문을 정하고 rt=3 부수효과가 남는다', function () {
    const r = rec();
    const rq = req();
    responder.respond(rq, r.res, { code: RSC.NOT_FOUND, dbg: 'no such thing' }, function () {});
    assert.deepStrictEqual(r.log[2], ['header', 'X-M2M-RSC', RSC.NOT_FOUND.rsc]);
    assert.deepStrictEqual(r.log[3], ['status', RSC.NOT_FOUND.http]);
    assert.deepStrictEqual(r.log[4], ['end', '{"m2m:dbg":"no such thing"}']);
    // 옛 sendError 가 하던 것. 응답에 안 나타나지만 하네스가 queryAfter 로 본다.
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

// ── 행위: 검증 가드 — 배출구가 존재하는 이유 ─────────────────────────────

test('send — rsc 에 객체가 오면 [object Object] 대신 500 으로', function () {
    // 이 저장소가 배포에서 실제로 겪은 결함. 위치 인자가 한 칸 밀리면 여기로 왔다.
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
    // 옛 코드는 response.status(NaN) 에서 ERR_HTTP_INVALID_STATUS_CODE 를 던져
    // 응답도 커넥션 반납도 없이 워커가 죽었다. 응답 도중에 던지면 안 된다.
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
    // 1단계 2번의 무중단 조건 — 이 호출부는 한 글자도 안 고친다.
    const app = code('app.js');
    const body = code('mobius/body.js');
    const n = (app.match(/responder\.respond\(/g) || []).length + (body.match(/responder\.respond\(/g) || []).length;
    assert.strictEqual(n, 4, 'app.js 3 + body.js 1 (실제 ' + n + ')');
    assert.strictEqual(/responder\.respond\([^)]*\{\s*status:/.test(app + body), false,
        '라우트가 성공 spec 으로 respond 를 직접 부르기 시작했다 — 그건 settle 을 거쳐야 한다 (2단계)');
});
