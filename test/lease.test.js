'use strict';
// 커넥션 임대 장부.
//
// 요청 정산(응답 + connection.release())이 유실되면 크래시가 아니라 매달림이다.
// cluster 워커 재시작이 안 걸리고 커넥션이 영영 안 돌아온다 — 조용한 영구 고갈.
//
// 개별 분기를 채우는 것만으로는 "다음 유실"을 못 막는다. 장부는 그것을 드러내는
// 계기판이다. 동작은 바꾸지 않는다: release 를 감싸 장부만 지우고 원래 release 를
// 그대로 부른다.

const test = require('node:test');
const assert = require('node:assert');

const lease = require('../mobius/lease');

function fakeConn() {
    const c = { released: 0 };
    c.release = function () { c.released++; };
    return c;
}

function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); }
    finally { console.error = orig; }
    return lines;
}

test.beforeEach(function () { lease._reset(); });

test('취득하고 반납하면 장부가 빈다', function () {
    const c = fakeConn();
    lease.track(c, 1000);
    assert.strictEqual(lease.stats().open, 1);
    c.release();
    assert.strictEqual(lease.stats().open, 0);
    assert.strictEqual(lease.stats().opened, 1);
    assert.strictEqual(lease.stats().closed, 1);
    assert.strictEqual(c.released, 1, '원래 release 가 그대로 불려야 한다');
});

test('반납하지 않으면 임계를 넘을 때 한 번만 알린다', function () {
    const c = fakeConn();
    lease.track(c, 1000);

    let lines = quiet(function () { lease.sweep(1000 + lease.DEFAULT_WARN_MS - 1); });
    assert.strictEqual(lines.length, 0, '임계 전에는 조용해야 한다');

    lines = quiet(function () { lease.sweep(1000 + lease.DEFAULT_WARN_MS); });
    assert.strictEqual(lines.length, 1);
    assert.ok(/lease/.test(lines[0]));

    // 매 초 다시 알리면 로그가 밀린다
    lines = quiet(function () { lease.sweep(1000 + lease.DEFAULT_WARN_MS + 60000); });
    assert.strictEqual(lines.length, 0, '같은 임대를 다시 알리면 안 된다');
    assert.strictEqual(lease.stats().warned, 1);
});

test('경고만 하고 회수는 하지 않는다 (기본)', function () {
    const c = fakeConn();
    lease.track(c, 1000);
    quiet(function () { lease.sweep(1000 + 10 * 60 * 1000); });
    assert.strictEqual(c.released, 0, '기본은 관측 전용이다');
    assert.strictEqual(lease.stats().open, 1);
});

test('leaseReclaimMs 를 켜면 회수한다', function () {
    const saved = global.leaseReclaimMs;
    try {
        global.leaseReclaimMs = 5000;
        const c = fakeConn();
        lease.track(c, 1000);
        quiet(function () { lease.sweep(1000 + 5000); });
        assert.strictEqual(c.released, 1, '회수는 원래 release 를 부른다');
        assert.strictEqual(lease.stats().open, 0);
        assert.strictEqual(lease.stats().reclaimed, 1);
    } finally {
        global.leaseReclaimMs = saved;
    }
});

test('이중 release 를 삼키지 않는다', function () {
    // 삼키면 이중 정산을 영영 못 찾는다. 지금처럼 드러나야 한다.
    const c = fakeConn();
    lease.track(c, 1000);
    c.release();
    c.release();
    assert.strictEqual(c.released, 2, '두 번 다 원래 release 로 가야 한다');
    assert.strictEqual(lease.stats().closed, 1, '장부는 한 번만 센다');
});

test('풀이 같은 핸들을 재사용해도 래퍼가 겹치지 않는다', function () {
    // 임대마다 래퍼를 덧씌우면 원래 release 를 못 찾게 된다.
    const c = fakeConn();
    lease.track(c, 1000);
    c.release();
    const wrapped_once = c.release;

    lease.track(c, 2000);            // 같은 핸들을 다시 빌린다
    assert.strictEqual(c.release, wrapped_once, '래퍼는 한 번만 씌운다');

    c.release();
    assert.strictEqual(c.released, 2);
    assert.strictEqual(lease.stats().open, 0);
    assert.strictEqual(lease.stats().closed, 2);
});

test('여러 임대를 따로 센다', function () {
    const a = fakeConn(), b = fakeConn();
    lease.track(a, 1000);
    lease.track(b, 1000);
    assert.strictEqual(lease.stats().open, 2);
    a.release();
    assert.strictEqual(lease.stats().open, 1);
    b.release();
    assert.strictEqual(lease.stats().open, 0);
});

test('release 가 없는 것은 그대로 돌려준다', function () {
    assert.strictEqual(lease.track(null), null);
    const x = {};
    assert.strictEqual(lease.track(x), x);
    assert.strictEqual(lease.stats().open, 0);
});

test('경고 임계는 global.leaseWarnMs 로 바꿀 수 있다', function () {
    const saved = global.leaseWarnMs;
    try {
        global.leaseWarnMs = 100;
        const c = fakeConn();
        lease.track(c, 1000);
        const lines = quiet(function () { lease.sweep(1150); });
        assert.strictEqual(lines.length, 1);
    } finally {
        global.leaseWarnMs = saved;
    }
});
