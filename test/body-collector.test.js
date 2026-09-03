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

test('끝난 뒤 늦게 오는 error 가 워커를 죽이지 않는다', function () {
    // EventEmitter 는 'error' 를 듣는 이가 없으면 **던진다.**
    // 본문을 다 읽은 뒤에도 소켓은 살아 있으므로(응답을 아직 안 보냈다)
    // 늦은 오류가 올 수 있다. 리스너를 전부 떼면 그 하나가 uncaught 가 된다.
    const req = make_req();
    body.collect(req, make_res(), function () {});
    req.emit('data', Buffer.from('{}', 'utf8'));
    req.emit('end');

    assert.ok(req.listenerCount('error') > 0,
        'error 리스너를 떼면 늦은 소켓 오류가 워커를 죽인다');
    assert.doesNotThrow(function () { req.emit('error', new Error('늦게 온 오류')); });
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

/* ── 5. 응답 본문 읽기 (body.read) ───────────────────────────────────── */

// 아웃바운드 응답 스트림 흉내. 요청 스트림과 이벤트 이름이 같다.
//
// **destroy() 는 'aborted' 를 동기로 뿜는다.** Node 가 그렇게 하기 때문이다.
//
// 처음에는 이 스텁이 destroyed 플래그만 세웠다. 그래서 read() 의 상한 초과
// 사유가 도달 불가능한 상태였는데도 이 파일의 시험이 전부 통과했다 —
// 진짜 소켓에서는 destroy() 가 뿜은 'aborted' 가 먼저 done 을 잡아
// 'response aborted' 가 나가고 있었다. 관리 콘솔 세션이 자기 코드에서
// 같은 것을 발견해 알려 줬다.
//
// 가짜가 진짜보다 순한 순간 시험은 거짓말을 한다. 진짜에 맞춘다.
function make_res_stream() {
    const s = new EventEmitter();
    s.destroyed = false;
    s.destroy = function () {
        if (this.destroyed) { return; }
        this.destroyed = true;
        this.emit('aborted');
    };
    return s;
}

test('read: 멀티바이트가 조각 경계에 걸려도 온전하다', function () {
    // fopt.js / grp.js 가 이 결함을 갖고 있었다 — setEncoding 이 주석이었다.
    const text = '온도 25도';
    const buf = Buffer.from(text, 'utf8');
    const res = make_res_stream();
    let got, err;
    body.read(res, function (e, t) { err = e; got = t; });

    res.emit('data', buf.slice(0, 1));      // '온' 3바이트 중 1바이트만
    res.emit('data', buf.slice(1));
    res.emit('end');

    assert.strictEqual(err, null);
    assert.strictEqual(got, text);
});

test('read: 바이트 하나씩 흘려도 온전하다', function () {
    const text = '팬아웃 멤버 응답 🚀';
    const buf = Buffer.from(text, 'utf8');
    const res = make_res_stream();
    let got;
    body.read(res, function (e, t) { got = t; });
    for (let i = 0; i < buf.length; i++) { res.emit('data', buf.slice(i, i + 1)); }
    res.emit('end');
    assert.strictEqual(got, text);
});

test('read: 본문이 없으면 빈 문자열이다', function () {
    const res = make_res_stream();
    let err = 'unset', got;
    body.read(res, function (e, t) { err = e; got = t; });
    res.emit('end');
    assert.strictEqual(err, null);
    assert.strictEqual(got, '');
});

test('read: 상한을 넘으면 err 를 주고 스트림을 파기한다', function () {
    // 요청 쪽과 달리 여기서는 파기해도 된다 — 우리가 보낸 요청의 답이고
    // 상대에게 돌려줄 응답이 없다.
    const res = make_res_stream();
    let err, got = 'unset';
    silence(function () { body.read(res, function (e, t) { err = e; got = t; }); });

    const piece = Buffer.alloc(1024 * 1024, 0x61);
    silence(function () {
        for (let i = 0; i < 11; i++) { res.emit('data', piece); }
    });

    assert.ok(err instanceof Error, '상한 초과가 err 로 와야 한다');
    assert.match(err.message, /exceeds/);
    assert.strictEqual(got, undefined, '실패했으면 본문을 주면 안 된다');
    assert.strictEqual(res.destroyed, true, '스트림을 파기해야 한다');
});

test('read: 중간에 끊기면 err 를 준다 — 빈 문자열로 덮지 않는다', function () {
    // 조용히 '' 로 덮으면 "멤버 응답을 못 읽었다" 와 "빈 응답을 받았다" 가
    // 구분되지 않는다. 팬아웃 집계가 그 차이를 알아야 한다.
    const res = make_res_stream();
    let err, got = 'unset';
    body.read(res, function (e, t) { err = e; got = t; });
    res.emit('data', Buffer.from('절반만', 'utf8'));
    res.emit('aborted');

    assert.ok(err instanceof Error);
    assert.strictEqual(got, undefined);
});

test('read: 스트림 오류도 err 로 온다', function () {
    const res = make_res_stream();
    let err;
    body.read(res, function (e) { err = e; });
    res.emit('error', new Error('ECONNRESET'));
    assert.ok(err instanceof Error);
    assert.strictEqual(err.message, 'ECONNRESET');
});

test('read: 콜백은 정확히 한 번만 불린다', function () {
    const res = make_res_stream();
    let n = 0;
    body.read(res, function () { n++; });
    res.emit('end');
    res.emit('end');
    res.emit('error', new Error('늦게 온 오류'));
    res.emit('aborted');
    assert.strictEqual(n, 1);
});

test('read: 상한은 요청 쪽과 같은 손잡이를 쓴다', function () {
    const saved = global.max_body_bytes;
    try {
        global.max_body_bytes = 8;
        const res = make_res_stream();
        let err;
        silence(function () { body.read(res, function (e) { err = e; }); });
        silence(function () { res.emit('data', Buffer.alloc(9, 0x61)); });
        assert.ok(err instanceof Error, 'global.max_body_bytes 를 안 본다');
    }
    finally {
        if (saved === undefined) { delete global.max_body_bytes; }
        else { global.max_body_bytes = saved; }
    }
});

/* ── 5-2. 진짜 소켓으로 끊어 본다 ────────────────────────────────────── */

// 위의 가짜 스트림 시험은 내가 'aborted' 를 직접 emit 한다. 실제 Node 가
// 그 이벤트를 정말 주는지는 확인하지 못한다.
//
// 이 세 경우는 관리 콘솔 세션(mobius-fd)이 **자기 코드에서 실제로 당한** 것이다.
// 그쪽은 res 에 'data'/'end' 만 달아 두었고, 응답이 이미 성립한 뒤의 오류는
// req 가 아니라 **res 로 가기** 때문에 콜백이 영영 안 왔다. 작업 엔진의
// running 이 안 줄어 서버 제어가 통째로 잠겼다.
//
// 팬아웃도 같은 모양이다 — 콜백이 안 오면 그 멤버에서 사슬이 멈추고
// DB 커넥션이 묶인다. 그래서 raw TCP 로 진짜 끊어 본다.
function truncating_server(cb) {
    const net = require('node:net');
    const srv = net.createServer(function (sock) {
        let buf = '';
        sock.on('error', function () {});
        sock.on('data', function (c) {
            buf += c.toString();
            if (buf.indexOf('\r\n\r\n') < 0) { return; }
            const path = (buf.match(/^GET (\S+)/) || [])[1] || '/';
            if (path === '/half') {
                // 100바이트를 약속하고 30바이트만 준다
                sock.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n' + 'x'.repeat(30));
            }
            else if (path === '/chunked') {
                // 종료 청크(0\r\n\r\n) 없이 끊는다
                sock.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n');
            }
            else {
                sock.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n');
            }
            setTimeout(function () { sock.destroy(); }, 30);
        });
    });
    srv.listen(0, '127.0.0.1', function () { cb(srv, srv.address().port); });
}

function read_from(port, path) {
    const http = require('node:http');
    return new Promise(function (resolve) {
        const req = http.request({ host: '127.0.0.1', port: port, path: path }, function (res) {
            body.read(res, function (err, text) { resolve({ err: err, text: text }); });
        });
        // 응답이 성립한 뒤의 오류는 여기로 오지 않는다. 그래도 달아 둔다 —
        // 안 달면 EventEmitter 가 던진다.
        req.on('error', function (e) { resolve({ err: e, text: undefined, viaReq: true }); });
        req.end();
    });
}

test('read: 중간에 끊긴 응답에서 콜백이 반드시 온다 (진짜 소켓)', async function () {
    const { promisify } = require('node:util');
    const srv = await new Promise(function (r) { truncating_server(function (s, p) { r({ s, p }); }); });

    try {
        for (const [path, label] of [
            ['/half',         'Content-Length 를 약속하고 절반만 보내고 끊음'],
            ['/chunked',      'chunked 를 종료 청크 없이 끊음'],
            ['/headers-only', '헤더만 보내고 끊음']
        ]) {
            const out = await Promise.race([
                read_from(srv.p, path),
                new Promise(function (r) { setTimeout(function () { r({ timedOut: true }); }, 4000); })
            ]);
            assert.ok(!out.timedOut,
                label + ' — 콜백이 안 왔다. 부르는 쪽이 영영 매달린다');
            assert.ok(out.err instanceof Error, label + ' — err 로 알려야 한다');
            assert.strictEqual(out.text, undefined,
                label + ' — 잘린 본문을 정상처럼 주면 안 된다');
        }
    }
    finally {
        await new Promise(function (r) { srv.s.close(r); });
    }
});

test('read: 상한 초과 사유가 진짜 소켓에서도 상한 초과라고 나온다', async function () {
    // 위 스텁 시험과 별개로 진짜 소켓으로 한 번 더 본다.
    // 이 결함은 "가짜가 진짜보다 순해서" 숨었던 것이라, 진짜로도 확인해 둔다.
    const http = require('node:http');
    const saved = global.max_body_bytes;
    global.max_body_bytes = 128 * 1024;

    const piece = Buffer.alloc(64 * 1024, 0x61);
    const srv = http.createServer(function (req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        let n = 0;
        (function push() {
            if (n++ > 20 || res.destroyed || res.writableEnded) { try { res.end(); } catch (e) {} return; }
            if (!res.write(piece)) { res.once('drain', push); }
            else { setImmediate(push); }
        })();
        res.on('error', function () {});
    });

    try {
        const port = await new Promise(function (r) {
            srv.listen(0, '127.0.0.1', function () { r(srv.address().port); });
        });
        const out = await new Promise(function (resolve) {
            const req = http.request({ host: '127.0.0.1', port: port, path: '/' }, function (res) {
                body.read(res, function (err, text) { resolve({ err: err, text: text }); });
            });
            req.on('error', function (e) { resolve({ err: e, text: undefined }); });
            req.end();
        });

        assert.ok(out.err instanceof Error);
        assert.match(out.err.message, /exceeds/,
            '상한 초과인데 "' + out.err.message + '" 이라고 한다 — ' +
            'res.destroy() 를 finish() 보다 먼저 부르면 aborted 가 사유를 덮는다');
        assert.strictEqual(out.text, undefined);
    }
    finally {
        await new Promise(function (r) { srv.close(r); });
        if (saved === undefined) { delete global.max_body_bytes; }
        else { global.max_body_bytes = saved; }
    }
});

/* ── 6. 아웃바운드 응답을 직접 모으는 자리가 남아 있지 않은지 ───────── */

test('응답 본문을 직접 모으는 자리가 남아 있지 않다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const cp = require('node:child_process');
    const ROOT = path.join(__dirname, '..');

    const files = cp.execSync('git ls-files "*.js"', { cwd: ROOT }).toString()
        .split(/\r?\n/).filter(Boolean)
        .filter((f) => f.indexOf('test/') !== 0 && f.indexOf('tools/') !== 0);

    const bad = [];
    for (const f of files) {
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
        lines.forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }          // 주석
            if (!/\+=\s*(chunk|c|data|d)\b/.test(l)) { return; }
            if (/\.length\s*;?\s*$/.test(l)) { return; }           // size += chunk.length
            // setEncoding 이 **주석이 아닌 상태로** 위에 있는가.
            // fopt.js / grp.js 는 그 줄이 `//res.setEncoding(...)` 이라 안 걸렸고,
            // 그래서 8년 동안 조용히 깨지고 있었다. 주석은 세지 않는다.
            //
            // **어디를 볼 것인가.** 예전에는 이어붙이는 줄의 바로 위 7줄만 봤다.
            // 그런데 setEncoding 은 핸들러를 **붙이기 전에** 부르는 것이지
            // 이어붙이는 줄 근처에 있는 것이 아니다. 핸들러 본문이 길면
            // (주석이 길면) 창을 벗어나 오탐이 난다 — admin/cse.js 가 그랬다.
            // setEncoding 은 91행, 이어붙이기는 114행이었다.
            //
            // 그래서 이어붙이는 줄에서 위로 올라가 **이 핸들러를 붙인 줄**을
            // 찾고, 그 앞을 본다. 검사의 뜻이 그것이다 — "이 스트림에
            // setEncoding 을 걸고 나서 붙였는가".
            let open = -1;
            for (let k = i; k >= 0 && k > i - 200; k--) {
                if (/\.on\(\s*'data'/.test(lines[k])) { open = k; break; }
            }
            if (open < 0) { bad.push(f + ':' + (i + 1) + '  ' + l.trim() + '  (data 핸들러를 못 찾음)'); return; }

            const near = lines.slice(Math.max(0, open - 7), open);
            const guarded = near.some((w) => /^\s*res\.setEncoding\(/.test(w));
            if (!guarded) { bad.push(f + ':' + (i + 1) + '  ' + l.trim()); }
        });
    }

    assert.deepStrictEqual(bad, [],
        '스트림 조각을 직접 이어붙이는 자리가 있다 — mobius/body 의 read() 를 쓸 것:\n  ' +
        bad.join('\n  '));
});

/* ── 7. app.js 가 이 모듈만 쓰는지 ───────────────────────────────────── */

test('app.js 에 수동 본문 수집기가 남아 있지 않다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // 라우트 안에서 다시 모으기 시작하면 이 모듈이 이미 스트림을 끝냈으므로
    // 'end' 가 영영 안 온다 — 요청이 매달린다. 되살아나지 못하게 막는다.
    const collectors = src.match(/^\s*request\.on\('data'/gm) || [];
    assert.strictEqual(collectors.length, 0,
        'app.js 가 요청 본문을 직접 모으고 있다 — mobius/body 로 보내라');

    // 형태는 자유롭게 두되(`.collect` 를 바로 떼든, 모듈을 통째로 받든)
    // **출처가 mobius/body 여야 한다**는 것만 잠근다. app.js 가 응답 쪽에서도
    // body.read 를 쓰게 되면서 모듈 전체를 받는 형태로 바뀌었다.
    assert.match(src, /require\('\.\/mobius\/body'\)/,
        'app.js 가 수집기를 mobius/body 에서 가져와야 한다');
    assert.match(src, /body\.collect/,
        'app.js 의 라우트가 body.collect 를 미들웨어로 써야 한다');

    // body-parser 는 이제 안 쓴다. 되살리면 type 문자열 함정이 그대로 돌아온다.
    assert.doesNotMatch(src, /require\('body-parser'\)/,
        "body-parser 가 돌아왔다 — type 에 세미콜론 문자열을 주면 아무것도 매칭되지 않는다");
});
