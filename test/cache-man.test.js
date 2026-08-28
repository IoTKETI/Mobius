'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

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
