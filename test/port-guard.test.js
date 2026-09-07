'use strict';
// A port conflict does not create a zombie: unit level. Wiring is in test/cluster-respawn.test.js.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

const EXIT = require('../mobius/exit_codes');
const port_guard = require('../mobius/port_guard');

function hold(cb) {   // holds an arbitrary port
    const srv = net.createServer();
    srv.listen({ port: 0 }, function () { cb(srv, srv.address().port); });
}

test('종료 코드는 1 이 아니다 — backstop 과 fail_start 가 1 을 쓴다', function () {
    assert.strictEqual(EXIT.PORT_TAKEN, 12);
    assert.strictEqual(EXIT.NO_CONF, 13);
});

test('onListenError 의 기본 종료 경로가 실재한다 — 그 이름이 사라지면 핸들러가 던져 exit 1 → 재포크 루프(좀비)가 되살아난다', function () {
    // The two onListenError tests inject deps.exit, so they do not pass through the production path (backstop.exitAfterFlush).
    assert.strictEqual(typeof require('../mobius/backstop').exitAfterFlush, 'function');
});

test('C9 probe — 남이 쥔 포트는 taken, 빈 포트는 free', function (t, done) {
    hold(function (srv, port) {
        port_guard.probe(port, function (state) {
            assert.strictEqual(state, 'taken');
            srv.close(function () {
                port_guard.probe(port, function (state2) {
                    assert.strictEqual(state2, 'free');
                    // The probe bind must not keep the port; it must be bindable again immediately.
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
