'use strict';
// 포트 충돌이 좀비를 만들지 않는다(C9) — 단위. 배선은 test/cluster-respawn.test.js.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

const EXIT = require('../mobius/exit_codes');
const port_guard = require('../mobius/port_guard');

function hold(cb) {   // 아무 포트나 잡아 둔다
    const srv = net.createServer();
    srv.listen({ port: 0 }, function () { cb(srv, srv.address().port); });
}

test('종료 코드는 1 이 아니다 — backstop 과 fail_start 가 1 을 쓴다', function () {
    assert.strictEqual(EXIT.PORT_TAKEN, 12);
    assert.strictEqual(EXIT.NO_CONF, 13);
});

test('onListenError 의 기본 종료 경로가 실재한다 — 그 이름이 사라지면 핸들러가 던져 exit 1 → 재포크 루프(좀비)가 되살아난다', function () {
    // 두 onListenError 시험은 deps.exit 을 주입하므로 운영 경로(backstop.exitAfterFlush)를 지나지 않는다.
    assert.strictEqual(typeof require('../mobius/backstop').exitAfterFlush, 'function');
});

test('C9 probe — 남이 쥔 포트는 taken, 빈 포트는 free', function (t, done) {
    hold(function (srv, port) {
        port_guard.probe(port, function (state) {
            assert.strictEqual(state, 'taken');
            srv.close(function () {
                port_guard.probe(port, function (state2) {
                    assert.strictEqual(state2, 'free');
                    // 시험 바인드가 포트를 물고 있으면 안 된다 — 바로 다시 잡힌다
                    const again = net.createServer();
                    again.listen({ port: port }, function () { again.close(done); });
                    again.on('error', done);
                });
            });
        });
    });
});

test('C9 onListenError — EADDRINUSE 만 전용 코드로 나간다', function () {
    const exits = [];
    const h = port_guard.onListenError(7579, { exit: function (c) { exits.push(c); } });
    const e = new Error('listen EADDRINUSE'); e.code = 'EADDRINUSE';
    h(e);
    assert.deepStrictEqual(exits, [EXIT.PORT_TAKEN]);
});

test('C9 onListenError — EACCES 는 다시 던져 backstop 에 맡긴다 (워커만 죽고 마스터는 재포크를 잇는다)', function () {
    const exits = [];
    const h = port_guard.onListenError(80, { exit: function (c) { exits.push(c); } });
    const e = new Error('listen EACCES'); e.code = 'EACCES';
    assert.throws(function () { h(e); }, /EACCES/);
    assert.deepStrictEqual(exits, []);
});
