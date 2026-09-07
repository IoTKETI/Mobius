'use strict';
/**
 * A response body truncated mid-way.
 *
 * What is protected here is not 'the exact result' but 'the callback is called exactly once'. Without it, running in jobs.js never decreases, the job never ends and guard_busy blocks Mobius stop/restart permanently.
 *
 * req.setTimeout does not fire because the socket is already destroyed, and the error arrives on res, not req.
 */
var test = require('node:test');
var assert = require('node:assert');
var http = require('http');

var cse = require('../admin/cse.js');

/** Starts one server, makes one client call and returns the result. */
function probe(handler, callback) {
    var srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', function () {
        var client = new cse.Client({
            host: '127.0.0.1', port: srv.address().port,
            origin: 'test', timeoutMs: 2000
        });
        var calls = 0, first = null;
        client.retrieve('/Mobius/probe', function (r) {
            calls++;
            if (calls === 1) { first = r; }
            // Waits a moment before finishing, to catch a second call.
            if (calls > 1) { return; }
            setTimeout(function () {
                srv.close(function () { callback(first, calls); });
            }, 120);
        });
    });
}

test('Content-Length 를 약속하고 절반만 보내고 끊어도 콜백이 온다', function (t, done) {
    probe(function (req, res) {
        var full = JSON.stringify({ 'm2m:cnt': { rn: '한글이름', cbs: 12345 } });
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(full),
            'X-M2M-RSC': '2000'
        });
        res.write(full.slice(0, Math.floor(full.length / 2)));
        setTimeout(function () { res.socket.destroy(); }, 10);
    }, function (r, calls) {
        assert.strictEqual(calls, 1, '콜백은 정확히 한 번');
        assert.strictEqual(r.ok, false, '본문이 없으면 성공이 아니다');
        assert.match(r.error, /중간에 끊겼다/);
        done();
    });
});

test('chunked 를 종료 청크 없이 끊어도 콜백이 온다', function (t, done) {
    probe(function (req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-M2M-RSC': '2000' });
        res.write('{"m2m:cnt":{"rn":"한글');
        setTimeout(function () { res.socket.destroy(); }, 10);
    }, function (r, calls) {
        assert.strictEqual(calls, 1);
        assert.strictEqual(r.ok, false);
        assert.match(r.error, /중간에 끊겼다/);
        done();
    });
});

test('서버가 이미 보낸 상태줄은 버리지 않는다', function (t, done) {
    // To judge whether the delete really finished, the administrator needs the server's answer; saying only 'unknown' and dropping the 200/2000 leaves nothing to judge by.
    probe(function (req, res) {
        res.writeHead(200, { 'Content-Length': '999', 'X-M2M-RSC': '2002' });
        res.write('{"partial"');
        setTimeout(function () { res.socket.destroy(); }, 10);
    }, function (r) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.rsc, '2002');
        assert.match(r.error, /처리가 끝났는지는 알 수 없다/);
        done();
    });
});

test('헤더만 보내고 끊으면 연결 실패로 잡힌다', function (t, done) {
    probe(function (req, res) {
        res.writeHead(200, { 'X-M2M-RSC': '2000' });
        setTimeout(function () { res.socket.destroy(); }, 10);
    }, function (r, calls) {
        assert.strictEqual(calls, 1);
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.status, 0, '응답이 성립하지 않았으므로 상태가 없다');
        done();
    });
});

test('정상 응답은 그대로 통과한다 — 대조군', function (t, done) {
    probe(function (req, res) {
        var full = JSON.stringify({ 'm2m:cnt': { rn: '한글이름' } });
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(full),
            'X-M2M-RSC': '2000'
        });
        res.end(full);
    }, function (r, calls) {
        assert.strictEqual(calls, 1);
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.rsc, '2000');
        assert.deepStrictEqual(r.body, { 'm2m:cnt': { rn: '한글이름' } });
        done();
    });
});

test('상한을 넘는 응답은 끊고 콜백을 준다', function (t, done) {
    // The same 10MB as the core's read(), so a later switch does not change behaviour. This is where buf used to grow without bound.
    probe(function (req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-M2M-RSC': '2000' });
        var mb = Buffer.alloc(1024 * 1024, 'x').toString();
        var sent = 0;
        (function push() {
            if (res.writableEnded || sent > 12) { return; }
            sent++;
            if (res.write(mb)) { setImmediate(push); }
            else { res.once('drain', push); }
        })();
    }, function (r, calls) {
        assert.strictEqual(calls, 1, '콜백은 정확히 한 번');
        assert.strictEqual(r.ok, false);
        assert.match(r.error, /상한을 넘었다/);
        done();
    });
});

test('끊긴 응답이 와도 일괄 작업이 끝난다', function (t, done) {
    // The real cost of this defect: when cse does not call back, running in jobs does not decrease and pump() never runs again; the job stays 'running' forever.
    var jobs = require('../admin/jobs.js');
    var srv = http.createServer(function (req, res) {
        res.writeHead(200, { 'Content-Length': '999', 'X-M2M-RSC': '2002' });
        res.write('{"cut"');
        setTimeout(function () { res.socket.destroy(); }, 5);
    });
    srv.listen(0, '127.0.0.1', function () {
        var client = new cse.Client({
            host: '127.0.0.1', port: srv.address().port,
            origin: 'test', timeoutMs: 2000
        });
        var job = jobs.start({
            title: '끊긴 응답 3건',
            targets: ['/a', '/b', '/c'],
            keyOf: function (t2) { return t2; },
            worker: function (ri, cb) {
                client.remove(ri, function (r) {
                    cb(r.ok ? 'ok' : 'failed', r.error);
                });
            },
            onFinish: function (j) {
                assert.strictEqual(j.state, 'done', '작업이 끝나야 한다');
                assert.strictEqual(j.processed, 3, '세 건 모두 처리됐다');
                assert.strictEqual(j.failed, 3);
                srv.close(function () { done(); });
            }
        });
        assert.ok(job, '작업이 시작돼야 한다');
    });
});
