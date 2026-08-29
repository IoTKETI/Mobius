'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { EventEmitter } = require('events');

const MOD = path.join(__dirname, '..', 'mobius', 'cache_man.js');

function fresh(limit, invGenLimit) {
    delete require.cache[require.resolve(MOD)];
    global.cache_limit = limit;
    // 세대 기록 맵의 상한은 store 와 별개다. 지정하지 않으면 모듈 기본값(5만)을
    // 쓰게 두어, store 상한을 낮게 잡은 다른 테스트들이 영향받지 않게 한다.
    global.cache_inv_gen_limit = invGenLimit;
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

// keys_for/invalidate 가 호출 시점의 store 스냅샷을 다시 훑는다는 성질을
// 직접 고정한다. delete_descendants_background 의 캐스케이드 완료 후
// 재훑기(mobius/resource.js)가 기대는 성질이 바로 이것 -- 첫 invalidate
// 이후에 캐싱된 자손도 같은 prefix 로 두 번째 invalidate 를 부르면
// 걷힌다는 것. keys_for 가 언젠가 (첫 호출 시점의) 스냅샷을 기억해두는
// 식으로 바뀌면 이 테스트가 깨져서 캐스케이드용 재훑기가 조용히 무력화되는
// 것을 막아준다.
test('invalidate 는 호출될 때마다 그 시점의 store 를 다시 훑는다 (스냅샷을 기억하지 않는다)', function () {
    const cm = fresh(100);
    cm.invalidate('/Mobius/root');                 // 아직 자손 없음
    cm.set('/Mobius/root/child', {});               // 첫 invalidate 이후에 캐싱됨
    cm.invalidate('/Mobius/root');                  // 같은 prefix 로 다시 무효화
    assert.strictEqual(cm.get('/Mobius/root/child'), undefined,
        '두 번째 invalidate 는 그 사이 캐싱된 자손도 지금 store 를 다시 훑어 걷어내야 한다');
});

// --- 리뷰 Critical 1(a): CIN 삽입은 자손 스윕을 하지 않는다 ---

test('invalidate_self 는 자기 자신만 지우고 자손을 축출하지 않는다', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1/cnt1', {});
    cm.set('/Mobius/ae1/cnt1/4-20260828000000001', {});
    cm.set('/Mobius/ae1/cnt1/sub1', {});
    cm.set('/Mobius/ae1', {});

    const removed = cm.invalidate_self('/Mobius/ae1/cnt1');

    assert.strictEqual(removed, 1);
    assert.strictEqual(cm.get('/Mobius/ae1/cnt1'), undefined, '대상 자신은 지워져야 한다');
    assert.notStrictEqual(cm.get('/Mobius/ae1/cnt1/4-20260828000000001'), undefined,
        'CIN 삽입은 형제 CIN 행을 바꾸지 않는다 — 축출하면 안 된다');
    assert.notStrictEqual(cm.get('/Mobius/ae1/cnt1/sub1'), undefined,
        '자손 sub 도 바뀌지 않았으므로 남아 있어야 한다');
    assert.notStrictEqual(cm.get('/Mobius/ae1'), undefined, '조상도 건드리지 않는다');
});

test('invalidate_self 는 self:true 를 브로드캐스트하고, 받는 쪽도 자손을 남긴다', function () {
    const cm = fresh(100);
    const sent = [];
    cm._set_sender(function (msg) { sent.push(msg); });

    cm.invalidate_self('/Mobius/ae1/cnt1');
    assert.deepStrictEqual(sent, [
        { __mobius_cache_inv: true, ri: '/Mobius/ae1/cnt1', self: true }
    ]);

    // 수신 측(다른 워커)에서도 자손 스윕이 일어나면 안 된다.
    const rx = fresh(100);
    rx.set('/Mobius/ae1/cnt1', {});
    rx.set('/Mobius/ae1/cnt1/4-20260828000000001', {});
    rx._on_message(sent[0]);
    assert.strictEqual(rx.get('/Mobius/ae1/cnt1'), undefined);
    assert.notStrictEqual(rx.get('/Mobius/ae1/cnt1/4-20260828000000001'), undefined,
        'self:true 수신은 O(1) 삭제여야 한다');
});

test('삭제 경로의 invalidate 는 여전히 자손을 걷어낸다 (invalidate_self 로 바뀌지 않았다)', function () {
    const cm = fresh(100);
    cm.set('/Mobius/ae1', {});
    cm.set('/Mobius/ae1/cnt1', {});
    cm.set('/Mobius/ae1/cnt1/4-20260828000000001', {});

    cm.invalidate('/Mobius/ae1');

    assert.strictEqual(cm.get('/Mobius/ae1/cnt1'), undefined);
    assert.strictEqual(cm.get('/Mobius/ae1/cnt1/4-20260828000000001'), undefined);
});

// --- 리뷰 Critical 1(b): 세대 검사는 키별이다 ---

test('set_if_unchanged: 관계없는 리소스의 무효화는 채움을 막지 않는다', function () {
    const cm = fresh(100);
    const gen = cm.generation();              // GET /Mobius/ae1/cnt1 의 DB 조회 시작
    cm.invalidate_self('/Mobius/ae9/cntX');   // 그 사이 다른 컨테이너에 CIN 이 들어왔다
    cm.invalidate_self('/Mobius/ae8/cntY');

    assert.strictEqual(cm.set_if_unchanged('/Mobius/ae1/cnt1', { ri: 'x' }, gen), true,
        '전역 카운터 비교였다면 여기서 캐시가 영원히 채워지지 않는다');
    assert.notStrictEqual(cm.get('/Mobius/ae1/cnt1'), undefined);
});

test('set_if_unchanged: 그 키 자신이 무효화됐으면 채우지 않는다', function () {
    const cm = fresh(100);
    const gen = cm.generation();
    cm.invalidate('/Mobius/ae1/cnt1');

    assert.strictEqual(cm.set_if_unchanged('/Mobius/ae1/cnt1', { ri: 'x' }, gen), false);
    assert.strictEqual(cm.get('/Mobius/ae1/cnt1'), undefined);
});

test('set_if_unchanged: 조상이 무효화됐으면 in-flight 자손 채움을 막는다', function () {
    const cm = fresh(100);
    // GET /Mobius/ae1/cnt1 이 DB 를 읽는 중 — 아직 store 에 없으므로 keys_for 가
    // 이 키를 찾을 수 없다. 조상 접두어 검사가 없으면 그대로 캐싱되어 버린다.
    const gen = cm.generation();
    cm.invalidate('/Mobius/ae1');            // DELETE /Mobius/ae1

    assert.strictEqual(cm.set_if_unchanged('/Mobius/ae1/cnt1', { ri: 'x' }, gen), false,
        '조상이 지워졌으므로 방금 읽은 자손 행은 이미 stale 이다');
    assert.strictEqual(cm.get('/Mobius/ae1/cnt1'), undefined);
});

test('set_if_unchanged: 무효화가 조회 시작 *전* 이었으면 채운다', function () {
    const cm = fresh(100);
    cm.invalidate('/Mobius/ae1');
    const gen = cm.generation();             // 무효화 이후에 조회를 시작했다

    assert.strictEqual(cm.set_if_unchanged('/Mobius/ae1/cnt1', { ri: 'x' }, gen), true);
});

test('set_if_unchanged: invalidate_all 이후에는 그 전에 시작된 채움을 전부 막는다', function () {
    const cm = fresh(100);
    const gen = cm.generation();
    cm.invalidate_all();
    assert.strictEqual(cm.set_if_unchanged('/Mobius/ae1/cnt1', { ri: 'x' }, gen), false);
    // 이후에 시작된 조회는 정상적으로 채운다
    assert.strictEqual(cm.set_if_unchanged('/Mobius/ae1/cnt1', { ri: 'x' }, cm.generation()), true);
});

test('set_if_unchanged: 세대 기록 맵은 상한을 넘지 않고, 축출분은 fail-closed 로 막힌다', function () {
    const cm = fresh(100, 4);                // store 100, 세대 기록 맵 4
    const gen = cm.generation();
    for (var i = 0; i < 40; i++) {
        cm.invalidate_self('/Mobius/ae' + i);
    }
    const st = cm._inv_gen_state();
    assert.ok(st.size <= 4, '세대 기록 맵이 상한을 넘어 자라면 안 된다 (size=' + st.size + ')');
    assert.ok(st.floor > gen, '축출된 기록의 세대는 floor 로 올라가야 한다');

    // 축출되어 개별 기록이 사라진 키라도, 조회 시작이 그 무효화보다 앞섰다면 막는다.
    assert.strictEqual(cm.set_if_unchanged('/Mobius/ae0', { ri: 'x' }, gen), false,
        '기록이 축출된 구간은 보수적으로(fail-closed) 거부해야 한다');
});

// store 상한과 세대 기록 맵 상한을 겸하게 두면, 메모리를 아끼려고 cache_limit 을
// 낮추는 순간 세대 기록이 잦게 축출되고 floor_gen 이 올라가 정상 채움까지
// fail-closed 로 막힌다 — 캐시를 아끼려던 조정이 캐시를 꺼 버린다.
test('세대 기록 맵 상한은 store 상한과 분리돼 있다 (cache_limit 을 낮춰도 좁아지지 않는다)', function () {
    const cm = fresh(4);                     // store 는 4 로 아주 작게, inv_gen 은 기본값
    const gen = cm.generation();

    // store 상한(4)을 훌쩍 넘는 수의 무효화를 낸다.
    for (var i = 0; i < 200; i++) {
        cm.invalidate_self('/Mobius/other' + i);
    }

    const st = cm._inv_gen_state();
    assert.ok(st.size > 4,
        'store 상한이 세대 기록 맵을 좁히면 안 된다 (size=' + st.size + ')');
    assert.strictEqual(st.floor, gen,
        '축출이 없었으므로 floor 는 그대로여야 한다 (floor=' + st.floor + ', gen=' + gen + ')');

    // 그리고 무관한 리소스의 in-flight 채움이 계속 허용되어야 한다.
    assert.strictEqual(cm.set_if_unchanged('/Mobius/untouched', { ri: 'x' }, gen), true,
        '무관한 무효화 200건 뒤에도 정상 채움은 막히면 안 된다');
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

// 발신 워커는 보내기 전에 이미 자기 store 를 지웠다. 되쏘면 하는 일 없이
// IPC 왕복만 늘어난다 — 배포는 워커 25개라 CIN 삽입 하나가 26회가 되고,
// 그 마스터는 pxy_mqtt/coap/ws 가 함께 도는 단일 프로세스다.
test('install_master: 중계할 때 발신 워커에게는 되쏘지 않는다', function () {
    const cm = fresh(100);
    const c = fakeCluster();
    const got = { '1': [], '2': [], '3': [] };
    ['1', '2', '3'].forEach(function (id) {
        c.workers[id] = {
            id: id,
            isConnected: function () { return true; },
            send: function (msg, cb) { got[id].push(msg); if (cb) { cb(); } }
        };
    });

    cm.install_master(c);
    c.emit('message', c.workers['2'], { __mobius_cache_inv: true, ri: '/Mobius/x' });

    assert.strictEqual(got['2'].length, 0, '발신 워커에게 되쏘면 안 된다');
    assert.strictEqual(got['1'].length, 1, '다른 워커에는 가야 한다');
    assert.strictEqual(got['3'].length, 1, '다른 워커에는 가야 한다');
});

test('install_master: 마스터 자신이 낸 무효화는 전 워커에 간다 (건너뛸 발신자가 없다)', function () {
    const cm = fresh(100);
    const c = fakeCluster();
    const got = { '1': [], '2': [] };
    ['1', '2'].forEach(function (id) {
        c.workers[id] = {
            id: id,
            isConnected: function () { return true; },
            send: function (msg, cb) { got[id].push(msg); if (cb) { cb(); } }
        };
    });

    cm.install_master(c);
    cm.invalidate_all();

    assert.strictEqual(got['1'].length, 1);
    assert.strictEqual(got['2'].length, 1);
});
