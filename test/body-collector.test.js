'use strict';
/*
 * Request body collector (mobius/body.js).
 *
 * Tested with a fake request stream (EventEmitter) and a fake response. Checks with real sockets are a separate script; there the chunk boundaries are decided by TCP and are not deterministic. Here the boundaries are chosen by the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const body = require('../mobius/body');

/* ── Fake request/response ── */

function make_req(headers) {
    const r = new EventEmitter();
    r.method = 'POST';
    r.url = '/Mobius/x';
    r.headers = headers || {};
    r.query = {};
    return r;
}

// Imitates only what responder.respond -> sendError uses.
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

// Feeds the pieces and ends. Pieces must be Buffers, as from a real socket.
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

/* ── 1. UTF-8 survives chunk boundaries ── */

test('멀티바이트 글자가 조각 경계에 걸려도 온전하다', function () {
    const text = '가나다';
    const buf = Buffer.from(text, 'utf8');   // 9 bytes

    // Splits the 3 bytes of the first Hangul syllable as 1 + 2; a byte-wise concatenation produces U+FFFD here.
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

    // A GET/DELETE without a body looks like this.
    const req2 = make_req();
    let b = null;
    body.collect(req2, make_res(), function () { b = req2.body; });
    feed(req2, []);
    assert.strictEqual(b, '', '빈 본문은 빈 **문자열**이어야 한다');
});

/* ── 2. request.body is a string ── */

test('request.body 는 Buffer 가 아니라 문자열이다', function () {
    // The empty-body gate in app.js compares with `request.body !== ""`. A Buffer would make that condition always true and turn 400-40 into 400-7. req.write in fopt.js and the logs assume a string too.
    const req = make_req();
    let got;
    body.collect(req, make_res(), function () { got = req.body; });
    feed(req, [Buffer.from('', 'utf8')]);

    assert.strictEqual(typeof got, 'string');
    assert.ok(!Buffer.isBuffer(got));
    assert.ok(got === '', '빈 본문 관문이 이 등치 비교에 걸려 있다');
});

/* ── 3. Size limit ── */

test('Content-Length 가 상한을 넘으면 본문을 받지 않고 즉시 413', function () {
    const req = make_req({ 'content-length': String(body.DEFAULT_LIMIT + 1) });
    const res = make_res();
    let nexted = false;

    silence(function () { body.collect(req, res, function () { nexted = true; }); });

    assert.strictEqual(nexted, false, 'next() 를 부르면 안 된다');
    assert.strictEqual(res._status, 413);
    assert.strictEqual(res._headers['x-m2m-rsc'], '4000');
    assert.match(String(res._body), /too large/);

    // No listener may have been attached at all; the body is not awaited.
    assert.strictEqual(req.listenerCount('data'), 0);
});

test('Content-Length 가 없어도 흘러온 바이트를 세다 413 을 낸다', function () {
    const req = make_req();                       // no Content-Length
    const res = make_res();
    let nexted = false;
    silence(function () { body.collect(req, res, function () { nexted = true; }); });

    // Feeds past the limit
    const piece = Buffer.alloc(1024 * 1024, 0x61);
    const pieces = [];
    for (let i = 0; i < 11; i++) { pieces.push(piece); }
    silence(function () { feed(req, pieces); });

    assert.strictEqual(nexted, false);
    assert.strictEqual(res._status, 413);
    assert.strictEqual(res._headers['x-m2m-rsc'], '4000');
});

test('상한을 넘긴 뒤에도 end 까지 기다린다 — 스트림을 죽이지 않는다', function () {
    // Killing the socket right away would give the peer ECONNRESET before it can read the 413.
    const req = make_req();
    const res = make_res();
    req.destroy = function () { throw new Error('destroy 를 부르면 안 된다'); };

    silence(function () { body.collect(req, res, function () {}); });

    const piece = Buffer.alloc(1024 * 1024, 0x61);
    silence(function () {
        for (let i = 0; i < 11; i++) { req.emit('data', piece); }
    });

    // end has not arrived yet, so no response yet
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

        // The same module sees the new value on the next request (not frozen at require time)
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

/* ── 4. Aborted requests ── */

test("aborted 면 next 를 안 부르고 리스너를 뗀다", function () {
    const req = make_req();
    let nexted = false;
    body.collect(req, make_res(), function () { nexted = true; });

    req.emit('data', Buffer.from('절반만', 'utf8'));
    req.emit('aborted');

    assert.strictEqual(nexted, false);
    assert.strictEqual(req.listenerCount('data'), 0, '모아 둔 조각이 붙들려 있으면 안 된다');
    assert.strictEqual(req.listenerCount('end'), 0);

    // A late end after the abort must do nothing
    req.emit('end');
    assert.strictEqual(nexted, false);
});

test('끝난 뒤 늦게 오는 error 가 워커를 죽이지 않는다', function () {
    // EventEmitter throws when nobody listens for 'error'. The socket is still alive after the body is read (the response has not been sent), so a late error can arrive; with every listener removed that one becomes uncaught.
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

/* ── 5. Reading a response body (body.read) ── */

// Imitates an outbound response stream; the event names are the same as for a request stream.
//
// destroy() emits 'aborted' synchronously, because Node does. A stub that only set a destroyed flag let every test here pass while read()'s limit-overrun reason was unreachable; on a real socket the 'aborted' emitted by destroy() reached done first. A fake milder than the real thing makes the test lie, so the fake matches the real behaviour.
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
    // fopt.js / grp.js had this defect: setEncoding was commented out.
    const text = '온도 25도';
    const buf = Buffer.from(text, 'utf8');
    const res = make_res_stream();
    let got, err;
    body.read(res, function (e, t) { err = e; got = t; });

    res.emit('data', buf.slice(0, 1));      // only 1 of the 3 bytes of '온'
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
    // Unlike the request side, destroying is fine here: it is the answer to our own request and there is no response to relay.
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
    // Silently substituting '' would make 'could not read the member response' indistinguishable from 'received an empty response'; the fan-out aggregation needs that difference.
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

/* ── 5-2. Cutting with a real socket ── */

// The fake-stream tests above emit 'aborted' themselves and cannot confirm that real Node emits it.
//
// These three cases are ones where only 'data'/'end' were attached to res, and an error after the response was established goes to res, not req, so the callback never came. The fan-out has the same shape: without a callback the chain stops at that member and the DB connection stays bound. So the cut is done with raw TCP.
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
                // Promises 100 bytes and sends 30
                sock.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n' + 'x'.repeat(30));
            }
            else if (path === '/chunked') {
                // Cuts without the terminating chunk (0\r\n\r\n)
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
        // Errors after the response is established do not arrive here; attached anyway, otherwise EventEmitter throws.
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
    // Checked once more with a real socket, separately from the stub test above; this defect hid behind a fake milder than the real thing.
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

/* ── 6. No place left that collects an outbound response by hand ── */

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
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }          // comment
            if (!/\+=\s*(chunk|c|data|d)\b/.test(l)) { return; }
            if (/\.length\s*;?\s*$/.test(l)) { return; }           // size += chunk.length
            // Whether setEncoding sits above as a non-comment line. Comments are not counted.
            //
            // Where to look: setEncoding is called before the handler is attached, not near the concatenating line, and a long handler body would push it out of a small window. So the check walks up from the concatenating line to the line that attached this handler and looks before it; that is what the check means: 'was setEncoding set on this stream before attaching'.
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

/* ── 7. app.js uses this module only ── */

test('app.js 에 수동 본문 수집기가 남아 있지 않다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // Collecting again inside a route would never see 'end', because this module already ended the stream, and the request would hang; blocked from returning.
    const collectors = src.match(/^\s*request\.on\('data'/gm) || [];
    assert.strictEqual(collectors.length, 0,
        'app.js 가 요청 본문을 직접 모으고 있다 — mobius/body 로 보내라');

    // The form is free (`.collect` taken directly, or the whole module), but the source must be mobius/body. app.js takes the whole module because it also uses body.read on the response side.
    assert.match(src, /require\('\.\/mobius\/body'\)/,
        'app.js 가 수집기를 mobius/body 에서 가져와야 한다');
    assert.match(src, /body\.collect/,
        'app.js 의 라우트가 body.collect 를 미들웨어로 써야 한다');

    // body-parser is no longer used; reviving it brings back the type-string trap.
    assert.doesNotMatch(src, /require\('body-parser'\)/,
        "body-parser 가 돌아왔다 — type 에 세미콜론 문자열을 주면 아무것도 매칭되지 않는다");
});
