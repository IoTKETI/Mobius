'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const MOD = path.join(__dirname, '..', 'mobius', 'hit_man.js');
const DB = path.join(__dirname, '..', 'mobius', 'db');
const SQL_ACTION = path.join(__dirname, '..', 'mobius', 'sql_action.js');

function fresh() {
    delete require.cache[require.resolve(MOD)];
    global.useadminorigin = 'AdminConsole';
    global.hit_ri_flush_sec = 10;
    return require(MOD);
}

// hit_man 의 기본(=주입 안 한) writer 는 db 파사드(mobius/db)로 커넥션을 얻어야
// 한다 — db_action(레거시 MySQL 풀)으로 가면 usesqlite='true' 여도 MySQL
// 가용성에 hit_ri 저장이 묶인다. 여기서는 실제 드라이버 I/O 없이 어댑터의
// getConnection/release/execute 를 탭(tap)해 호출 순서 — 특히 "성공이든
// 실패든 release 를 반드시 부르는가" — 를 백엔드 양쪽에서 확인한다.
// (test/sqli-regression.test.js 의 tapAdapter 와 같은 기법.)
function tapDefaultWriter(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    const db = require(DB);

    const adapterPath = path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js');
    const adapter = require(adapterPath);
    const calls = { getConnection: 0, release: 0, execute: 0 };
    let shouldFail = false;
    const fakeHandle = { tag: 'tapped-handle' };

    adapter.connect = function (conf, cb) { cb('1'); };           // 실제 접속 생략
    adapter.getConnection = function (cb) { calls.getConnection++; cb('200', fakeHandle); };
    adapter.release = function () { calls.release++; };
    adapter.execute = function (handle, sql, bindings, cb) {
        calls.execute++;
        if (shouldFail) { cb(new Error('boom')); return; }
        cb(null, { affectedRows: 1 });
    };

    db.connect('h', 1, 'u', 'p', function () {});

    delete require.cache[require.resolve(SQL_ACTION)];
    require(SQL_ACTION);

    const hm = fresh();
    return {
        hm: hm,
        calls: calls,
        setFail: function (v) { shouldFail = v; }
    };
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

test('attribute: ty 를 몰라도 경로로 CIN 을 판별한다', function () {
    const hm = fresh();
    assert.strictEqual(
        hm.attribute('/Mobius/ae1/cnt1/4-20260828010203456', null),
        '/Mobius/ae1/cnt1');
    // CIN 이 아닌 것을 CIN 으로 오인하면 안 된다
    assert.strictEqual(hm.attribute('/Mobius/ae1/4things', null), '/Mobius/ae1/4things');
});

// --- 리뷰 I5: 집계 키는 정규화된 경로여야 한다 ---
//
// app.js 는 이제 get_target_url 이 성공한 뒤에 record 를 부르고, 해석된
// 구조 ri 와 ty 를 함께 넘긴다(app.js 의 record_hit). 아래 두 테스트는 그
// 배선을 옮긴 이유를 고정한다.
test('attribute: 비구조 CIN 주소를 그대로 받으면 CSEBase 로 잘못 귀속된다 (배선을 옮긴 이유)', function () {
    const hm = fresh();
    // 라우터 진입 시점의 원본 경로. oneM2M 비구조 주소지정이다.
    assert.strictEqual(hm.attribute('/Mobius/4-20260828010203456', null), '/Mobius',
        "'4-\\d' 경로 규칙이 CIN 으로 보고 부모(=CSEBase)로 올려버린다");
});

test('attribute: get_target_url 이 해석한 구조 ri 를 받으면 올바른 부모 CNT 로 귀속된다', function () {
    const hm = fresh();
    assert.strictEqual(hm.attribute('/Mobius/ae1/cnt1/4-20260828010203456', 4),
        '/Mobius/ae1/cnt1');
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

test('flush 실패 시 되돌린 값과 write 진행 중 새로 기록된 값이 합쳐진다', function (t, done) {
    const hm = fresh();
    // writer 가 "동기적으로" 실패하면 buffer = {} 와 콜백 사이에 틈이 전혀
    // 없어서, 되돌리기(restore)만 확인될 뿐 병합(merge, mobius/hit_man.js 의
    // else { buffer[k].http += rows[j].http; ... } 분기)은 절대 실행되지
    // 않는다. setImmediate 로 실패를 미뤄 그 틈을 실제로 만든다.
    hm._set_writer(function (rows, cb) {
        setImmediate(function () { cb(new Error('db down')); });
    });
    hm.record('/Mobius/ae1', 2, 'H', 'x');   // 이 1건이 실패해 되돌아온다

    hm.flush(function (err) {
        assert.ok(err, '에러가 전달되어야 한다');
        const p = hm.pending();
        assert.strictEqual(Object.keys(p).length, 1, '유실되면 안 된다');
        assert.strictEqual(p[Object.keys(p)[0]].http, 3,
            '되돌린 1 + write 진행 중 새로 기록된 2 가 합쳐져야 한다(덮어쓰기면 1이나 2가 나온다)');
        done();
    });

    // writer 콜백이 아직 돌아오지 않은 동안(위 setImmediate 대기 중) 같은
    // 키로 두 번 더 기록한다 — 이 시점의 buffer 는 flush() 가 이미 비워
    // 놓은 새 객체이므로, 여기 기록은 되돌아올 1건과 별개로 쌓인다.
    hm.record('/Mobius/ae1', 2, 'H', 'x');
    hm.record('/Mobius/ae1', 2, 'H', 'x');
});

// --- 리뷰 I4: hit_ri 쓰기가 계속 실패할 때의 동작 ---

test('flush 실패가 반복돼도 버퍼가 상한을 넘지 않고, 오래된 ct 부터 버린다', function (t, done) {
    const hm = fresh();
    hm._set_max_buffer_keys(3);
    hm._set_writer(function (rows, cb) {
        setImmediate(function () { cb(new Error('db down')); });
    });

    // ct 를 직접 만들 수는 없으므로(record 는 오늘 날짜를 쓴다) 버퍼를 직접
    // 구성한다. pending() 은 살아있는 buffer 참조를 돌려준다.
    const buf = hm.pending();
    buf['/a|20260101'] = { ri: '/a', ct: '20260101', http: 1, mqtt: 0, coap: 0, ws: 0 };
    buf['/b|20260102'] = { ri: '/b', ct: '20260102', http: 1, mqtt: 0, coap: 0, ws: 0 };
    buf['/c|20260103'] = { ri: '/c', ct: '20260103', http: 1, mqtt: 0, coap: 0, ws: 0 };
    buf['/d|20260104'] = { ri: '/d', ct: '20260104', http: 1, mqtt: 0, coap: 0, ws: 0 };
    buf['/e|20260105'] = { ri: '/e', ct: '20260105', http: 1, mqtt: 0, coap: 0, ws: 0 };

    hm.flush(function (err) {
        assert.ok(err);
        const p = hm.pending();
        const keys = Object.keys(p);
        assert.strictEqual(keys.length, 3, '상한(3)을 넘어 자라면 안 된다');
        assert.ok(!p['/a|20260101'], '가장 오래된 ct 부터 버려야 한다');
        assert.ok(!p['/b|20260102']);
        assert.ok(p['/e|20260105'], '최근 ct 는 남아야 한다');
        done();
    });
});

test('flush 실패 로그에 파사드의 (true, err) 규약이 아니라 진짜 에러 메시지가 실린다', function (t, done) {
    const ctx = tapDefaultWriter(true);
    ctx.setFail(true);
    ctx.hm.record('/Mobius/ae1', 2, 'H', 'CDevice');
    ctx.hm.flush(function (err) {
        // 고치기 전에는 여기 err === true 가 와서 로그가
        // "[hit_man] flush failed, will retry: true" 였다.
        assert.notStrictEqual(err, true, "파사드의 err===true 를 그대로 흘리면 안 된다");
        assert.ok(err && typeof err.message === 'string' && err.message.length > 0,
            '진단 가능한 메시지가 있어야 한다');
        assert.match(err.message, /boom/, '드라이버가 준 원래 메시지가 보존되어야 한다');
        done();
    });
});

test('flush 실패 로그는 매 주기마다 찍지 않는다 (연속 실패 스로틀)', function (t, done) {
    const hm = fresh();
    hm._set_writer(function (rows, cb) {
        setImmediate(function () { cb(new Error('db down')); });
    });

    const lines = [];
    const orig = console.error;
    console.error = function (msg) { lines.push(String(msg)); };

    var round = 0;
    function next() {
        if (round === 20) {
            console.error = orig;
            const failLines = lines.filter(function (l) { return l.indexOf('flush failed') >= 0; });
            assert.strictEqual(failLines.length, 1,
                '20회 연속 실패에 실패 로그는 1줄이어야 한다 (8워커 x 10초면 하루 7만 줄이 된다)');
            done();
            return;
        }
        round++;
        hm.record('/Mobius/ae1', 2, 'H', 'x');
        hm.flush(function () { next(); });
    }
    next();
});

test('flush 가 복구되면 한 줄 남기고 실패 카운터를 리셋한다', function (t, done) {
    const hm = fresh();
    var fail = true;
    hm._set_writer(function (rows, cb) {
        setImmediate(function () { cb(fail ? new Error('db down') : null); });
    });

    const lines = [];
    const orig = console.log;
    console.log = function (msg) { lines.push(String(msg)); };

    hm.record('/Mobius/ae1', 2, 'H', 'x');
    hm.flush(function () {
        fail = false;
        hm.record('/Mobius/ae1', 2, 'H', 'x');
        hm.flush(function (err) {
            console.log = orig;
            assert.strictEqual(err, null);
            const rec = lines.filter(function (l) { return l.indexOf('recovered after') >= 0; });
            assert.strictEqual(rec.length, 1);
            done();
        });
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

// 아래 4개: 기본 writer 가 db_action(레거시 MySQL 풀)이 아니라 db 파사드로
// 커넥션을 얻고, 성공/실패 모두 반납하는지 백엔드 양쪽에서 확인한다.
test('flush: 기본 writer 는 파사드 커넥션으로 쓰고 성공 시 반납한다 (SQLite)', function (t, done) {
    const ctx = tapDefaultWriter(true);
    ctx.hm.record('/Mobius/ae1', 2, 'H', 'CDevice');
    ctx.hm.flush(function (err) {
        assert.strictEqual(err, null);
        assert.strictEqual(ctx.calls.getConnection, 1);
        assert.strictEqual(ctx.calls.execute, 1);
        assert.strictEqual(ctx.calls.release, 1, '성공 후 커넥션을 반납해야 한다');
        done();
    });
});

test('flush: 기본 writer 는 실패해도 파사드 커넥션을 반납한다 (SQLite)', function (t, done) {
    const ctx = tapDefaultWriter(true);
    ctx.setFail(true);
    ctx.hm.record('/Mobius/ae1', 2, 'H', 'CDevice');
    ctx.hm.flush(function (err) {
        assert.ok(err);
        assert.strictEqual(ctx.calls.release, 1, '실패해도 커넥션을 반납해야 한다(누수 방지)');
        done();
    });
});

test('flush: 기본 writer 는 파사드 커넥션으로 쓰고 성공 시 반납한다 (MySQL)', function (t, done) {
    const ctx = tapDefaultWriter(false);
    ctx.hm.record('/Mobius/ae1', 2, 'H', 'CDevice');
    ctx.hm.flush(function (err) {
        assert.strictEqual(err, null);
        assert.strictEqual(ctx.calls.getConnection, 1);
        assert.strictEqual(ctx.calls.execute, 1);
        assert.strictEqual(ctx.calls.release, 1, '성공 후 커넥션을 반납해야 한다');
        done();
    });
});

test('flush: 기본 writer 는 실패해도 파사드 커넥션을 반납한다 (MySQL)', function (t, done) {
    const ctx = tapDefaultWriter(false);
    ctx.setFail(true);
    ctx.hm.record('/Mobius/ae1', 2, 'H', 'CDevice');
    ctx.hm.flush(function (err) {
        assert.ok(err);
        assert.strictEqual(ctx.calls.release, 1, '실패해도 커넥션을 반납해야 한다(누수 방지, db_action 회귀 방지)');
        done();
    });
});
