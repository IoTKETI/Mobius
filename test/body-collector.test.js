'use strict';
/*
 * 요청 본문 수집기(mobius/body.js).
 *
 * 이 테스트가 없어서 D13 이 8년 동안 살아 있었다. 수집기가 app.js 안의
 * 지역 코드였고, app.js 는 require 만 해도 cluster 워커를 띄우고 포트를
 * 열어서 단위 테스트가 부를 수 없었다.
 *
 * 여기서는 가짜 요청 스트림(EventEmitter)과 가짜 응답으로 시험한다.
 * 실제 소켓을 쓰는 확인은 별도 스크립트로 한다 — 그쪽은 청크 경계를 TCP 가
 * 정하므로 결정적이지 않다. 여기서는 경계를 내가 정한다.
 */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const body = require('../mobius/body');

/* ── 가짜 요청/응답 ──────────────────────────────────────────────────── */

function make_req(headers) {
    const r = new EventEmitter();
    r.method = 'POST';
    r.url = '/Mobius/x';
    r.headers = headers || {};
    r.query = {};
    return r;
}

// responder.respond -> sendError 가 쓰는 것만 흉내 낸다.
function make_res() {
    const res = {
        _headers: {},
        _status: null,
        _body: null,
        header(k, v) { this._headers[k.toLowerCase()] = v; return this; },
        set(k, v) { return this.header(k, v); },
        status(n) { this._status = n; return this; },
        end(b) { this._body = b; return this; }
    };
    return res;
}

// 조각들을 흘리고 끝낸다. 조각은 Buffer 여야 한다 — 실제 소켓이 그렇다.
function feed(req, pieces, opts) {
    pieces.forEach(function (p) { req.emit('data', p); });
    if (!opts || opts.end !== false) { req.emit('end'); }
}

function silence(fn) {
    const orig = console.error;
    console.error = function () {};
    try { return fn(); }
    finally { console.error = orig; }
}

/* ── 1. 청크 경계에서 UTF-8 이 안 깨진다 ─────────────────────────────── */

test('멀티바이트 글자가 조각 경계에 걸려도 온전하다', function () {
    const text = '가나다';
    const buf = Buffer.from(text, 'utf8');   // 9바이트

    // '가' 의 3바이트를 1 + 2 로 가른다. 예전 코드는 여기서 U+FFFD 를 만들었다.
    const req = make_req();
    let got = null;
    body.collect(req, make_res(), function () { got = req.body; });

    feed(req, [buf.slice(0, 1), buf.slice(1)]);

    assert.strictEqual(got, text,
        '조각마다 따로 디코드하면 "���나다" 가 된다');
});

test('바이트 하나씩 흘려도 온전하다 — 가장 나쁜 경우', function () {
    const text = '한글과 emoji 🚀 그리고 ascii';
    const buf = Buffer.from(text, 'utf8');
    const pieces = [];
    for (let i = 0; i < buf.length; i++) { pieces.push(buf.slice(i, i + 1)); }

    const req = make_req();
    let got = null;
    body.collect(req, make_res(), function () { got = req.body; });
    feed(req, pieces);

    assert.strictEqual(got, text);
});

test('조각이 하나여도, 없어도 동작한다', function () {
    const req1 = make_req();
    let a = null;
    body.collect(req1, make_res(), function () { a = req1.body; });
    feed(req1, [Buffer.from('{"a":1}', 'utf8')]);
    assert.strictEqual(a, '{"a":1}');

    // 본문 없는 GET/DELETE 가 이 모양이다.
    const req2 = make_req();
    let b = null;
    body.collect(req2, make_res(), function () { b = req2.body; });
    feed(req2, []);
    assert.strictEqual(b, '', '빈 본문은 빈 **문자열**이어야 한다');
});

/* ── 2. request.body 는 문자열이다 ───────────────────────────────────── */

test('request.body 는 Buffer 가 아니라 문자열이다', function () {
    // app.js 의 빈 본문 관문이 `request.body !== ""` 로 등치 비교를 한다.
    // Buffer 를 넣으면 그 조건이 언제나 참이 되어 400-40 이 400-7 로 바뀐다.
    // fopt.js 의 req.write 와 로그도 문자열을 전제한다.
    const req = make_req();
    let got;
    body.collect(req, make_res(), function () { got = req.body; });
    feed(req, [Buffer.from('', 'utf8')]);

    assert.strictEqual(typeof got, 'string');
    assert.ok(!Buffer.isBuffer(got));
    assert.ok(got === '', '빈 본문 관문이 이 등치 비교에 걸려 있다');
});

/* ── 3. 크기 상한 ────────────────────────────────────────────────────── */

test('Content-Length 가 상한을 넘으면 본문을 받지 않고 즉시 413', function () {
    const req = make_req({ 'content-length': String(body.DEFAULT_LIMIT + 1) });
    const res = make_res();
    let nexted = false;

    silence(function () { body.collect(req, res, function () { nexted = true; }); });

    assert.strictEqual(nexted, false, 'next() 를 부르면 안 된다');
    assert.strictEqual(res._status, 413);
    assert.strictEqual(res._headers['x-m2m-rsc'], '4000');
    assert.match(String(res._body), /too large/);

    // 리스너를 아예 안 달았어야 한다 — 본문을 기다리지 않는다.
    assert.strictEqual(req.listenerCount('data'), 0);
});

test('Content-Length 가 없어도 흘러온 바이트를 세다 413 을 낸다', function () {
    const req = make_req();                       // Content-Length 없음
    const res = make_res();
    let nexted = false;
    silence(function () { body.collect(req, res, function () { nexted = true; }); });

    // 상한을 넘게 흘린다
    const piece = Buffer.alloc(1024 * 1024, 0x61);
    const pieces = [];
    for (let i = 0; i < 11; i++) { pieces.push(piece); }
    silence(function () { feed(req, pieces); });

    assert.strictEqual(nexted, false);
    assert.strictEqual(res._status, 413);
    assert.strictEqual(res._headers['x-m2m-rsc'], '4000');
});

test('상한을 넘긴 뒤에도 end 까지 기다린다 — 스트림을 죽이지 않는다', function () {
    // 넘긴 즉시 소켓을 죽이면 상대가 413 을 읽기 전에 ECONNRESET 을 받는다.
    // 실제 서버로 재현했던 결함이다.
    const req = make_req();
    const res = make_res();
    req.destroy = function () { throw new Error('destroy 를 부르면 안 된다'); };

    silence(function () { body.collect(req, res, function () {}); });

    const piece = Buffer.alloc(1024 * 1024, 0x61);
    silence(function () {
        for (let i = 0; i < 11; i++) { req.emit('data', piece); }
    });

    // 아직 end 가 안 왔으므로 응답도 아직이다
    assert.strictEqual(res._status, null, 'end 전에 답하면 안 된다');

    silence(function () { req.emit('end'); });
    assert.strictEqual(res._status, 413);
});

test('상한 바로 아래는 통과한다', function () {
    const req = make_req();
    let got = null;
    body.collect(req, make_res(), function () { got = req.body; });
    feed(req, [Buffer.alloc(body.DEFAULT_LIMIT, 0x62)]);
    assert.strictEqual(got.length, body.DEFAULT_LIMIT);
});

test('상한은 global.max_body_bytes 로 바뀐다 — 요청마다 읽는다', function () {
    const saved = global.max_body_bytes;
    try {
        global.max_body_bytes = 16;
        const req = make_req();
        const res = make_res();
        let nexted = false;
        silence(function () { body.collect(req, res, function () { nexted = true; }); });
        silence(function () { feed(req, [Buffer.alloc(17, 0x63)]); });
        assert.strictEqual(nexted, false);
        assert.strictEqual(res._status, 413);

        // 같은 모듈이 다음 요청에서 새 값을 본다 (require 시점에 굳지 않는다)
        global.max_body_bytes = 1024;
        const req2 = make_req();
        let ok = false;
        body.collect(req2, make_res(), function () { ok = true; });
        feed(req2, [Buffer.alloc(17, 0x63)]);
        assert.strictEqual(ok, true);
    }
    finally {
        if (saved === undefined) { delete global.max_body_bytes; }
        else { global.max_body_bytes = saved; }
    }
});

/* ── 4. 중단된 요청 ──────────────────────────────────────────────────── */

test("aborted 면 next 를 안 부르고 리스너를 뗀다", function () {
    const req = make_req();
    let nexted = false;
    body.collect(req, make_res(), function () { nexted = true; });

    req.emit('data', Buffer.from('절반만', 'utf8'));
    req.emit('aborted');

    assert.strictEqual(nexted, false);
    assert.strictEqual(req.listenerCount('data'), 0, '모아 둔 조각이 붙들려 있으면 안 된다');
    assert.strictEqual(req.listenerCount('end'), 0);

    // 중단 뒤에 늦게 end 가 와도 아무 일이 없어야 한다
    req.emit('end');
    assert.strictEqual(nexted, false);
});

test('error 도 같은 방식으로 끝난다', function () {
    const req = make_req();
    let nexted = false;
    body.collect(req, make_res(), function () { nexted = true; });
    req.emit('error', new Error('ECONNRESET'));
    assert.strictEqual(nexted, false);
    assert.strictEqual(req.listenerCount('data'), 0);
});

test('end 는 두 번 와도 next 를 한 번만 부른다', function () {
    const req = make_req();
    let n = 0;
    body.collect(req, make_res(), function () { n++; });
    req.emit('end');
    req.emit('end');
    assert.strictEqual(n, 1);
});

/* ── 5. app.js 가 이 모듈만 쓰는지 ───────────────────────────────────── */

test('app.js 에 수동 본문 수집기가 남아 있지 않다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // 라우트 안에서 다시 모으기 시작하면 이 모듈이 이미 스트림을 끝냈으므로
    // 'end' 가 영영 안 온다 — 요청이 매달린다. 되살아나지 못하게 막는다.
    const collectors = src.match(/^\s*request\.on\('data'/gm) || [];
    assert.strictEqual(collectors.length, 0,
        'app.js 가 요청 본문을 직접 모으고 있다 — mobius/body 로 보내라');

    assert.match(src, /require\('\.\/mobius\/body'\)\.collect/,
        'app.js 가 수집기를 mobius/body 에서 가져와야 한다');

    // body-parser 는 이제 안 쓴다. 되살리면 type 문자열 함정이 그대로 돌아온다.
    assert.doesNotMatch(src, /require\('body-parser'\)/,
        "body-parser 가 돌아왔다 — type 에 세미콜론 문자열을 주면 아무것도 매칭되지 않는다");
});
