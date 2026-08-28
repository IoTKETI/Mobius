'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { EventEmitter } = require('events');

const MOD = path.join(__dirname, '..', 'mobius', 'cache_man.js');

function fresh(limit) {
    delete require.cache[require.resolve(MOD)];
    global.cache_limit = limit;
    return require(MOD);
}

test('keys_for 는 자기 자신, 부모의 /la, 자손 접두어를 모은다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', { ri: '/Mobius/ae1', pi: '/Mobius' });
    cm.set('/Mobius/ae1/cnt1', { ri: '/Mobius/ae1/cnt1', pi: '/Mobius/ae1' });
    cm.set('/Mobius/ae1/cnt1/la', { ri: 'x' });
    cm.set('/Mobius/ae2', { ri: '/Mobius/ae2', pi: '/Mobius' });

    const keys = cm.keys_for('/Mobius/ae1').sort();
    assert.deepStrictEqual(keys, [
        '/Mobius/ae1', '/Mobius/ae1/cnt1', '/Mobius/ae1/cnt1/la', '/Mobius/la'
    ].sort());
});

test('keys_for 는 접두어가 겹치는 형제를 잘못 포함하지 않는다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    cm.set('/Mobius/ae12', {});          // ae1 의 자손이 아니다
    cm.set('/Mobius/ae1/cnt', {});
    const keys = cm.keys_for('/Mobius/ae1');
    assert.ok(!keys.includes('/Mobius/ae12'), 'ae12 는 ae1 의 자손이 아니다');
    assert.ok(keys.includes('/Mobius/ae1/cnt'));
});

test('invalidate_local 이 대상 키를 전부 지운다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    cm.set('/Mobius/ae1/cnt1', {});
    cm.invalidate_local('/Mobius/ae1');
    assert.strictEqual(cm.get('/Mobius/ae1'), undefined);
    assert.strictEqual(cm.get('/Mobius/ae1/cnt1'), undefined);
});

test('상한을 넘으면 가장 오래 전에 넣은 항목이 축출된다', function () {
    const cm = fresh(3);
    cm.set('a', {}); cm.set('b', {}); cm.set('c', {});
    assert.strictEqual(cm.size(), 3);
    cm.set('d', {});
    assert.strictEqual(cm.size(), 3);
    assert.strictEqual(cm.get('a'), undefined, 'a 가 축출되어야 한다');
    assert.notStrictEqual(cm.get('d'), undefined);
});

test('get 은 항목을 최신으로 끌어올린다 (LRU)', function () {
    const cm = fresh(3);
    cm.set('a', {}); cm.set('b', {}); cm.set('c', {});
    cm.get('a');            // a 를 최신으로
    cm.set('d', {});        // b 가 축출되어야 한다
    assert.notStrictEqual(cm.get('a'), undefined);
    assert.strictEqual(cm.get('b'), undefined);
});

test('IPC 메시지를 받으면 로컬만 무효화하고 되쏘지 않는다', function () {
    const cm = fresh(100);
    let sent = 0;
    cm._set_sender(function () { sent++; });
    cm.set('/Mobius/ae1', {});

    cm._on_message({ __mobius_cache_inv: true, ri: '/Mobius/ae1' });

    assert.strictEqual(cm.get('/Mobius/ae1'), undefined);
    assert.strictEqual(sent, 0, 'IPC 수신은 다시 브로드캐스트하지 않는다');
});

test('invalidate 는 로컬 무효화 후 브로드캐스트를 요청한다', function () {
    const cm = fresh(100);
    const sent = [];
    cm._set_sender(function (msg) { sent.push(msg); });
    cm.set('/Mobius/ae1', {});

    cm.invalidate('/Mobius/ae1');

    assert.strictEqual(cm.get('/Mobius/ae1'), undefined);
    assert.deepStrictEqual(sent, [{ __mobius_cache_inv: true, ri: '/Mobius/ae1' }]);
});

test('관계없는 IPC 메시지는 무시한다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    cm._on_message({ some: 'other message' });
    assert.notStrictEqual(cm.get('/Mobius/ae1'), undefined);
});

// --- 리뷰 MUST FIX 2: 잘못된 메시지가 워커를 죽이지 않는다 ---

test('_on_message: __mobius_cache_inv 만 true 이고 ri 가 없으면 던지지 않고 무시한다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    assert.doesNotThrow(function () {
        cm._on_message({ __mobius_cache_inv: true });
    });
    // ri 가 없는 메시지는 아무 것도 건드리지 않는다
    assert.notStrictEqual(cm.get('/Mobius/ae1'), undefined);
});

test('_on_message: ri 가 문자열이 아니면 던지지 않고 무시한다', function () {
    const cm = fresh(100);
    assert.doesNotThrow(function () {
        cm._on_message({ __mobius_cache_inv: true, ri: 42 });
        cm._on_message({ __mobius_cache_inv: true, ri: null });
    });
});

test('keys_for: ri 가 문자열이 아니면 빈 배열을 돌려주고 던지지 않는다', function () {
    const cm = fresh(100);
    assert.deepStrictEqual(cm.keys_for(undefined), []);
    assert.deepStrictEqual(cm.keys_for(null), []);
    assert.deepStrictEqual(cm.keys_for(''), []);
});

test('invalidate: ri 가 유효하지 않으면 브로드캐스트하지 않고 0 을 돌려준다', function () {
    const cm = fresh(100);
    const sent = [];
    cm._set_sender(function (msg) { sent.push(msg); });
    assert.doesNotThrow(function () {
        assert.strictEqual(cm.invalidate(undefined), 0);
    });
    assert.strictEqual(sent.length, 0);
});

// --- 리뷰 MUST FIX 4: 캐시 오염을 막기 위한 세대 카운터 ---

test('generation: invalidate_local 은 무언가 있었는지와 무관하게 세대를 올린다', function () {
    const cm = fresh(100);
    const g0 = cm.generation();
    cm.invalidate_local('/Mobius/never-cached');   // 캐시에 없던 ri
    assert.strictEqual(cm.generation(), g0 + 1);
});

test('generation: invalidate() 도 세대를 올린다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    const g0 = cm.generation();
    cm.invalidate('/Mobius/ae1');
    assert.strictEqual(cm.generation(), g0 + 1);
});

test('generation: 무효화가 아닌 IPC 메시지는 세대를 올리지 않는다', function () {
    const cm = fresh(100);
    const g0 = cm.generation();
    cm._on_message({ some: 'other message' });
    cm._on_message({ __mobius_cache_inv: true, ri: 42 });   // 잘못된 ri, 무시됨
    assert.strictEqual(cm.generation(), g0);
});

test('generation: set() 은 세대를 올리지 않는다 (무효화가 아니라 채움이므로)', function () {
    const cm = fresh(100);
    const g0 = cm.generation();
    cm.set('/Mobius/ae1', {});
    assert.strictEqual(cm.generation(), g0);
});

// --- 리뷰 MUST FIX 5: 대량 삭제용 전체 비우기 ---

test('invalidate_all: 로컬 스토어를 비우고 세대를 올리고 all:true 를 브로드캐스트한다', function () {
    const cm = fresh(100);
    const sent = [];
    cm._set_sender(function (msg) { sent.push(msg); });
    cm.set('/Mobius/ae1', {});
    cm.set('/Mobius/ae2', {});
    const g0 = cm.generation();

    cm.invalidate_all();

    assert.strictEqual(cm.size(), 0);
    assert.strictEqual(cm.generation(), g0 + 1);
    assert.deepStrictEqual(sent, [{ __mobius_cache_inv: true, all: true }]);
});

test('_on_message: all:true 를 받으면 로컬을 전부 비우고 되쏘지 않는다', function () {
    const cm = fresh(100);
    let sent = 0;
    cm._set_sender(function () { sent++; });
    cm.set('/Mobius/ae1', {});
    cm.set('/Mobius/ae2', {});

    const handled = cm._on_message({ __mobius_cache_inv: true, all: true });

    assert.strictEqual(handled, true);
    assert.strictEqual(cm.size(), 0);
    assert.strictEqual(sent, 0, 'IPC 수신은 다시 브로드캐스트하지 않는다');
});

// --- 리뷰 MUST FIX 1: 마스터 릴레이가 연결이 끊긴 워커에 안전하다 ---
//
// 실제 cluster.fork() 로 죽는 중인 워커를 재현하는 대신, install_master 가
// 받는 "cluster" 는 { on, workers } 만 있으면 되는 덕타이핑 인터페이스이므로
// 페이크로 결정적으로 재현한다. 이게 리뷰가 지적한 버그의 정확한 경로다:
// isConnected() 가 false 인 워커에는 절대 send 를 호출하면 안 되고, send 가
// 콜백으로 비동기 에러를 돌려줘도(ERR_IPC_CHANNEL_CLOSED 흉내) 마스터
// 프로세스로 새 나가면 안 된다.

function fakeCluster() {
    const c = new EventEmitter();
    c.workers = {};
    return c;
}

test('install_master: isConnected() 가 false 인 워커에는 send 를 호출하지 않는다', function () {
    const cm = fresh(100);
    const c = fakeCluster();
    const sentTo = [];
    c.workers['1'] = {
        isConnected: function () { return true; },
        send: function (msg, cb) { sentTo.push('1'); if (cb) { cb(); } }
    };
    c.workers['2'] = {
        // 죽는 중(또는 죽은) 워커: cluster.workers 에는 여전히 남아있지만
        // 연결은 이미 끊겼다.
        isConnected: function () { return false; },
        send: function () { throw new Error('연결이 끊긴 워커에 send 하면 안 된다'); }
    };

    cm.install_master(c);
    c.emit('message', c.workers['1'], { __mobius_cache_inv: true, ri: '/Mobius/x' });

    assert.deepStrictEqual(sentTo, ['1']);
});

test('install_master: send 콜백이 ERR_IPC_CHANNEL_CLOSED 를 돌려줘도 마스터 프로세스로 새 나가지 않는다', function (t, done) {
    const cm = fresh(100);
    const c = fakeCluster();
    c.workers['1'] = {
        isConnected: function () { return true; },
        send: function (msg, cb) {
            // 실제 Node IPC 처럼 비동기로, 에러를 콜백에 전달한다.
            setImmediate(function () { cb(new Error('ERR_IPC_CHANNEL_CLOSED')); });
        }
    };

    cm.install_master(c);

    var caught = null;
    function onUncaught(e) { caught = e; }
    process.on('uncaughtException', onUncaught);

    c.emit('message', c.workers['1'], { __mobius_cache_inv: true, ri: '/Mobius/x' });

    // 콜백의 setImmediate 가 실행되고도 다시 한 틱이 지나도록 기다린다.
    setImmediate(function () {
        setImmediate(function () {
            process.removeListener('uncaughtException', onUncaught);
            assert.strictEqual(caught, null, '연결 종료 에러가 uncaughtException 으로 새면 안 된다');
            done();
        });
    });
});

test('install_master: sender 를 설치해 마스터가 직접 invalidate_all 을 브로드캐스트할 수 있다', function () {
    const cm = fresh(100);
    const c = fakeCluster();
    const received = [];
    c.workers['1'] = {
        isConnected: function () { return true; },
        send: function (msg, cb) { received.push(msg); if (cb) { cb(); } }
    };

    cm.install_master(c);
    // del_expired_resource/del_orphan_resource 같은 마스터 전용 경로가
    // 하는 일: 릴레이를 거치지 않고 마스터가 직접 부른다.
    cm.invalidate_all();

    assert.deepStrictEqual(received, [{ __mobius_cache_inv: true, all: true }]);
});

test('install_master: 워커가 보낸 무효화를 다른 워커에 중계한다', function () {
    const cm = fresh(100);
    const c = fakeCluster();
    const receivedBy2 = [];
    c.workers['1'] = { isConnected: function () { return true; }, send: function () {} };
    c.workers['2'] = {
        isConnected: function () { return true; },
        send: function (msg, cb) { receivedBy2.push(msg); if (cb) { cb(); } }
    };

    cm.install_master(c);
    c.emit('message', c.workers['1'], { __mobius_cache_inv: true, ri: '/Mobius/relayed' });

    assert.deepStrictEqual(receivedBy2, [{ __mobius_cache_inv: true, ri: '/Mobius/relayed' }]);
});
