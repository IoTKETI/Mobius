'use strict';
/**
 * 응답 본문이 중간에 끊겼을 때.
 *
 * 여기서 지키는 것은 "정확한 결과" 가 아니라 **콜백이 반드시 한 번은 불린다**
 * 이다. 안 불리면 jobs.js 의 running 이 안 줄어 작업이 영영 끝나지 않고,
 * 그러면 guard_busy 가 Mobius 정지·재기동을 영구히 막는다.
 *
 * 고치기 전 실측: Content-Length 절반 / chunked 미종료 두 경우 모두 5초를
 * 기다려도 콜백이 없었다. req.setTimeout 은 소켓이 이미 파괴돼 울리지 않고,
 * 에러는 req 가 아니라 res 로 온다.
 */
var test = require('node:test');
var assert = require('node:assert');
var http = require('http');

var cse = require('../admin/cse.js');

/** 서버를 하나 띄우고 클라이언트로 한 번 찔러 결과를 돌려준다. */
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
            // 두 번째 호출을 잡으려면 조금 기다렸다 끝낸다.
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
    // 삭제가 실제로 끝났는지 관리자가 판단하려면 서버가 뭐라고 답했는지
    // 알아야 한다. "모름" 이라고만 하고 200/2000 을 버리면 판단할 근거가 없다.
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

test('끊긴 응답이 와도 일괄 작업이 끝난다', function (t, done) {
    // 이 결함이 비쌌던 진짜 이유. cse 가 콜백을 안 부르면 jobs 의 running 이
    // 안 줄고 pump() 가 다시 돌지 않는다 — 작업이 영영 'running' 이다.
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
