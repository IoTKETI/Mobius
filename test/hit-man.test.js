'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const MOD = path.join(__dirname, '..', 'mobius', 'hit_man.js');

function fresh() {
    delete require.cache[require.resolve(MOD)];
    global.useadminorigin = 'AdminConsole';
    global.hit_ri_flush_sec = 10;
    return require(MOD);
}

test('attribute: CIN(ty=4) 은 부모 CNT 로 귀속된다', function () {
    const hm = fresh();
    assert.strictEqual(
        hm.attribute('/Mobius/ae1/cnt1/4-20260828010203456', 4),
        '/Mobius/ae1/cnt1');
});

test('attribute: /la 와 /ol 은 컨테이너로 귀속된다', function () {
    const hm = fresh();
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/la', 3), '/Mobius/ae1/cnt1');
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/ol', 3), '/Mobius/ae1/cnt1');
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/latest', 3), '/Mobius/ae1/cnt1');
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/oldest', 3), '/Mobius/ae1/cnt1');
});

test('attribute: AE 와 CNT 는 그대로', function () {
    const hm = fresh();
    assert.strictEqual(hm.attribute('/Mobius/ae1', 2), '/Mobius/ae1');
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1', 3), '/Mobius/ae1/cnt1');
});

test('attribute: 이름이 la/ol 로 끝나도 접미사가 아니면 잘리지 않는다', function () {
    const hm = fresh();
    // "/Mobius/ae1/cola" 는 컨테이너 이름이 우연히 "la" 로 끝날 뿐,
    // "/la" 접미사가 아니다. 그대로 반환되어야 한다.
    assert.strictEqual(hm.attribute('/Mobius/ae1/cola', 3), '/Mobius/ae1/cola');
});

test('record: 프로토콜별로 누적된다', function () {
    const hm = fresh();
    hm.record('/Mobius/ae1', 2, 'H', 'CSomeone');
    hm.record('/Mobius/ae1', 2, 'H', 'CSomeone');
    hm.record('/Mobius/ae1', 2, 'M', 'CSomeone');

    const p = hm.pending();
    const key = Object.keys(p)[0];
    assert.strictEqual(p[key].http, 2);
    assert.strictEqual(p[key].mqtt, 1);
    assert.strictEqual(p[key].ri, '/Mobius/ae1');
});

test('record: 콘솔 origin 의 요청은 집계하지 않는다', function () {
    const hm = fresh();
    hm.record('/Mobius/ae1', 2, 'H', 'AdminConsole');
    assert.deepStrictEqual(hm.pending(), {},
        '콘솔이 조회한 것을 사용 이력으로 세면 판정 신호가 오염된다');
});

test('record: CIN 등록이 부모 CNT 한 키로 합쳐진다', function () {
    const hm = fresh();
    hm.record('/Mobius/ae1/cnt1/4-2026082801', 4, 'H', 'CDevice');
    hm.record('/Mobius/ae1/cnt1/4-2026082802', 4, 'H', 'CDevice');
    const p = hm.pending();
    assert.strictEqual(Object.keys(p).length, 1);
    assert.strictEqual(p[Object.keys(p)[0]].ri, '/Mobius/ae1/cnt1');
    assert.strictEqual(p[Object.keys(p)[0]].http, 2);
});

test('record: 빈 ri 나 없는 ri 는 무시한다', function () {
    const hm = fresh();
    hm.record('', 2, 'H', 'x');
    hm.record(null, 2, 'H', 'x');
    assert.deepStrictEqual(hm.pending(), {});
});

test('flush: 버퍼를 비우고 writer 에 배열을 넘긴다', function (t, done) {
    const hm = fresh();
    let got = null;
    hm._set_writer(function (rows, cb) { got = rows; cb(null); });

    hm.record('/Mobius/ae1', 2, 'H', 'CSomeone');
    hm.record('/Mobius/ae2', 2, 'C', 'CSomeone');

    hm.flush(function (err) {
        assert.strictEqual(err, null);
        assert.strictEqual(got.length, 2);
        assert.ok(got.every(r => r.ct && r.ct.length === 8), 'ct 는 YYYYMMDD 8자');
        assert.deepStrictEqual(hm.pending(), {}, 'flush 후 버퍼는 비어야 한다');
        done();
    });
});

test('flush: 버퍼가 비면 writer 를 부르지 않는다', function (t, done) {
    const hm = fresh();
    let called = 0;
    hm._set_writer(function (rows, cb) { called++; cb(null); });
    hm.flush(function () {
        assert.strictEqual(called, 0);
        done();
    });
});

test('flush 실패 시 버퍼를 되돌려 다음 주기에 재시도한다', function (t, done) {
    const hm = fresh();
    hm._set_writer(function (rows, cb) { cb(new Error('db down')); });
    hm.record('/Mobius/ae1', 2, 'H', 'x');

    hm.flush(function (err) {
        assert.ok(err, '에러가 전달되어야 한다');
        const p = hm.pending();
        assert.strictEqual(Object.keys(p).length, 1, '유실되면 안 된다');
        assert.strictEqual(p[Object.keys(p)[0]].http, 1);
        done();
    });
});

// Task 6 의 upsert_hit_ri_batch 는 같은 (ri, ct) 가 한 배치 안에 두 번
// 나오면(INSERT ... UNION ALL ... ON CONFLICT) SQLite 에서 정의되지 않은
// 동작을 낸다. hit_man 의 버퍼가 ri+'|'+ct 를 키로 메모리에서 먼저
// 합산하기 때문에 flush 가 만드는 배치에는 같은 키가 구조적으로 한 번만
// 나타난다. 이 계약을 명시적으로 검증한다.
test('flush: 같은 (ri, ct) 에 대한 여러 record 호출은 배치에서 한 행으로 합쳐진다', function (t, done) {
    const hm = fresh();
    let got = null;
    hm._set_writer(function (rows, cb) { got = rows; cb(null); });

    // 서로 다른 CIN 세 개가 같은 부모 컨테이너로 귀속되고,
    // 프로토콜도 섞여 있다 — 그래도 배치에는 (ri, ct) 당 한 행만 있어야 한다.
    hm.record('/Mobius/ae1/cnt1/4-2026082801', 4, 'H', 'CDevice');
    hm.record('/Mobius/ae1/cnt1/4-2026082802', 4, 'M', 'CDevice');
    hm.record('/Mobius/ae1/cnt1/4-2026082803', 4, 'H', 'CDevice');

    hm.flush(function (err) {
        assert.strictEqual(err, null);
        const rowsForCnt1 = got.filter(function (r) { return r.ri === '/Mobius/ae1/cnt1'; });
        assert.strictEqual(rowsForCnt1.length, 1,
            '같은 (ri, ct) 는 upsert_hit_ri_batch 에 정확히 한 행으로 도착해야 한다');
        assert.strictEqual(rowsForCnt1[0].http, 2);
        assert.strictEqual(rowsForCnt1[0].mqtt, 1);
        done();
    });
});
