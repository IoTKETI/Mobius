'use strict';
// 하위 요청(transaction / semantic discovery / ws 알림)의 응답 처리.
//
// 이 경로들은 전부 상대가 준 본문을 다룬다. 형식을 신뢰할 수 없는데
// res.on('end') 안에서 방어 없이 파싱하고 있었다 — 던지면 잡을 곳이 없어
// 워커가 죽고, 그 워커가 처리 중이던 다른 요청까지 함께 날아간다.
//
// 몇 곳은 반대로 콜백을 아예 안 불러(빈 블록, 빈 배열) 요청이 매달렸다.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//spid';
global.uservi = '2a';
global.usecsebaseport = '7579';
global.use_secure = 'disable';
global.usesemanticbroker = '127.0.0.1';

function quiet(fn) {
    const orig = { log: console.log, error: console.error };
    const lines = [];
    console.log = function (s) { lines.push(String(s)); };
    console.error = function (s) { lines.push(String(s)); };
    try { return fn(lines); }
    finally { console.log = orig.log; console.error = orig.error; }
}

// ── tm.request_lock / request_tctl 의 빈 rqps ────────────────────────
//
// 콜백을 부르는 지점이 전부 for 루프 안에서 등록되는 응답 핸들러에만 있어,
// rqps 가 비면 콜백이 영영 안 불렸다. rqps 는 필수 속성이지만 생성 검증이
// "존재하는가" 만 보므로 rqps: [] 가 그대로 통과한다.

const tm = require('../mobius/tm');

test('rqps 가 비어도 request_lock 은 콜백을 부른다', function () {
    return new Promise(function (resolve, reject) {
        let called = 0;
        const timer = setTimeout(function () {
            reject(new Error('콜백이 불리지 않았다 — 요청이 매달린다'));
        }, 1000);

        quiet(function () {
            tm.request_lock({ tm: { ri: '38-x', rqps: [], tmr: '0' } }, 0, function (rsc) {
                called++;
                clearTimeout(timer);
                // 이 함수의 규약은 rsc == '1' 만 성공이다.
                assert.notStrictEqual(rsc, '1', '잠글 요청이 없으면 성공이 아니다');
                assert.strictEqual(called, 1, '콜백은 정확히 한 번');
                resolve();
            });
        });
    });
});

test('rqps 가 undefined 여도 request_lock 은 콜백을 부른다', function () {
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () { reject(new Error('콜백 미호출')); }, 1000);
        quiet(function () {
            tm.request_lock({ tm: { ri: '38-y', tmr: '0' } }, 0, function () {
                clearTimeout(timer);
                resolve();
            });
        });
    });
});

// ── tr.trsp_action 의 세 바디타입 ────────────────────────────────────
//
// xml  : JSON.parse(body_Obj.toString()) — 파싱된 객체라 '[object Object]' 가 되어
//        *언제나* 던졌다. catch 는 같은 본문을 또 JSON 으로 파싱해 다시 던졌다.
// cbor : 블록이 비어 있어 콜백이 아예 안 불렸다.
// json : catch 가 방금 던진 것과 글자 그대로 같은 파싱을 반복했다.
//
// trsp_action 은 모듈 밖으로 안 나가므로 request_commit 을 통해 태운다.
// 여기서는 상대 CSE 역할을 하는 서버를 세워 실제 응답을 흘려보낸다.

function fakeCse(body, contentType) {
    return new Promise(function (resolve) {
        const srv = http.createServer(function (rq, rs) {
            rq.on('data', function () {});
            rq.on('end', function () {
                rs.setHeader('X-M2M-RSC', '2001');
                rs.setHeader('X-M2M-RI', 'sub-ri');
                if (contentType) { rs.setHeader('Content-Type', contentType); }
                rs.end(body);
            });
        });
        srv.listen(0, '127.0.0.1', function () {
            resolve({ port: srv.address().port, close: function () { srv.close(); } });
        });
    });
}

const tr = require('../mobius/tr');

function commitAgainst(srv, bodytype) {
    // request_commit 은 obj.tr.trqp.to 로 대상을 정한다.
    const obj = { tr: {
        ri: '39-x',
        trqp: { to: 'http://127.0.0.1:' + srv.port + '/x', fr: 'S', op: 1, pc: {} },
        tst: 0
    }};
    global.usecsebaseport = String(srv.port);
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
            reject(new Error(bodytype + ': 콜백이 불리지 않았다 — 요청이 매달린다'));
        }, 3000);
        let called = 0;
        quiet(function () {
            tr.request_commit(obj, function (rsc, out) {
                called++;
                clearTimeout(timer);
                resolve({ rsc: rsc, out: out, called: called });
            });
        });
    });
}

test('상대가 비JSON 을 줘도 트랜잭션 커밋이 던지지 않는다', async function () {
    const srv = await fakeCse('<html>gateway error</html>');
    try {
        const r = await commitAgainst(srv, 'json');
        assert.strictEqual(r.called, 1, '콜백은 정확히 한 번');
    } finally {
        srv.close();
    }
});

test('상대가 빈 본문을 줘도 커밋이 매달리지 않는다', async function () {
    const srv = await fakeCse('');
    try {
        const r = await commitAgainst(srv, 'json');
        assert.strictEqual(r.called, 1);
    } finally {
        srv.close();
    }
});

test('정상 JSON 응답은 pc 로 실린다', async function () {
    const srv = await fakeCse(JSON.stringify({ 'm2m:cnt': { rn: 'x' } }));
    try {
        const r = await commitAgainst(srv, 'json');
        assert.strictEqual(r.called, 1);
        assert.ok(r.out && r.out.tr && r.out.tr.trsp, 'trsp 가 실려야 한다');
        assert.deepStrictEqual(r.out.tr.trsp.pc, { 'm2m:cnt': { rn: 'x' } });
    } finally {
        srv.close();
    }
});

// ── 에러 경로 — 응답이 아예 오지 않을 때 ─────────────────────────────
//
// 예전에는 req.on('error') 가 로그만 남기고 콜백을 부르지 않았다.
// 그러면 호출부(resource.js 의 update_action)가 영원히 기다린다 —
// update_action -> resource.update -> authorize_and_run -> settle 이
// 통째로 멈추므로 응답도 안 나가고 커넥션도 반납되지 않는다.
// 크래시가 아니라 cluster 재시작도 안 걸리는 조용한 고갈이다.
//
// outbound.arm 이 응답 없는 요청을 끊으면 곧바로 이 경로로 온다.
// tm.js 는 같은 자리에서 '0' 으로 실패를 알린다.

test('상대가 접속을 거절해도 커밋이 콜백을 부른다', async function () {
    // 아무도 듣지 않는 포트. connect 가 곧바로 ECONNREFUSED 를 낸다.
    const dead = await fakeCse('');
    const port = dead.port;
    dead.close();
    await new Promise(function (r) { setTimeout(r, 50); });

    const r = await commitAgainst({ port: port }, 'json');
    assert.strictEqual(r.called, 1, '에러 경로에서도 콜백은 정확히 한 번');
    assert.strictEqual(r.rsc, '0', 'tm.js 와 같은 관례로 실패를 알린다');
});

test('상대가 접속을 거절해도 실행이 콜백을 부른다', async function () {
    const dead = await fakeCse('');
    const port = dead.port;
    dead.close();
    await new Promise(function (r) { setTimeout(r, 50); });

    const obj = { tr: {
        ri: '39-e',
        trqp: { to: 'http://127.0.0.1:' + port + '/x', fr: 'S', op: 1, pc: {} },
        tst: 0
    }};
    global.usecsebaseport = String(port);

    const out = await new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
            reject(new Error('콜백이 불리지 않았다 — 요청이 매달린다'));
        }, 3000);
        let called = 0;
        quiet(function () {
            tr.request_execute(obj, function (rsc) {
                called++;
                clearTimeout(timer);
                resolve({ rsc: rsc, called: called });
            });
        });
    });
    assert.strictEqual(out.called, 1);
    assert.strictEqual(out.rsc, '0');
});

test('tr.js 의 error 핸들러가 전부 콜백을 부른다', function () {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'tr.js'), 'utf8');

    // 핸들러 시작부터 그 뒤 req.write( 까지 사이에 callback 호출이 있어야 한다.
    // 핸들러 안에 if 가 들어 있어서 첫 '});' 로 자르면 안 된다.
    // 주석에도 같은 문구가 있으므로 function 까지 붙여 실제 핸들러만 고른다.
    const handlers = src.split("req.on('error', function").slice(1);
    assert.strictEqual(handlers.length, 2,
        "req.on('error') 핸들러가 " + handlers.length + '개다 — 늘었다면 그것도 콜백을 부르는지 확인할 것');
    handlers.forEach(function (h, i) {
        const end = h.indexOf('req.write(');
        const block = h.slice(0, end > 0 ? end : 800);
        assert.ok(/callback\(/.test(block),
            (i + 1) + '번째 error 핸들러가 콜백을 부르지 않는다 — 요청이 매달린다');
    });
});
