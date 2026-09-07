'use strict';
/*
 * Contract the mysql2 driver must satisfy.
 *
 * `npm test` runs on SQLite, so driver differences on the MySQL path are not exercised by the regular suite. The tests here check the adapter's contract against a fake handle, without a real DB.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADAPTER_SRC = fs.readFileSync(path.join(ROOT, 'mobius', 'db', 'mysql.js'), 'utf8');

// The adapter loads the driver at require time. Source-only tests and tests that call execute are kept separate.
function loadAdapter() {
    delete require.cache[require.resolve('../mobius/db/mysql')];
    return require('../mobius/db/mysql');
}

/* Keeps executable lines only, so option names quoted in comments are ignored. */
function liveLines(src) {
    return src.split(/\r?\n/).filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    });
}

test('질의 콜백은 드라이버가 두 번 불러도 한 번만 통과한다', function (t, done) {
    // mysql2 does not mark driver timeout errors fatal and does not dequeue the command, so the callback fires twice: once for the timeout and again when the real response arrives. The second call would reach db.release(connection) a second time. The adapter wraps the callback with once().
    const adapter = loadAdapter();

    let calls = 0;
    const handle = {
        query: function (q, cb) {
            // Mimics mysql2: calls the callback twice.
            const timeoutErr = new Error('Query inactivity timeout');
            timeoutErr.code = 'PROTOCOL_SEQUENCE_TIMEOUT';
            cb(timeoutErr, null);
            cb(null, [{ ri: 'late' }]);
        },
        destroy: function () {}
    };

    adapter.execute(handle, 'select 1', [], function () {
        calls++;
    });

    setTimeout(function () {
        assert.strictEqual(calls, 1,
            '콜백이 ' + calls + '번 불렸다 — 두 번 불리면 커넥션이 두 번 반납되고 워커가 죽는다');
        done();
    }, 30);
});

test('드라이버 타임아웃이면 커넥션을 파기한다', function (t, done) {
    // once() is the net, not the cause fix. mysql2 leaves the command queued after a timeout, so if the connection went back to the pool the next borrower's query would wait behind the earlier statement. The adapter destroys the connection itself; destroy also removes the PoolConnection from the pool, so a later release is harmless.
    const adapter = loadAdapter();

    let destroyed = false;
    const handle = {
        query: function (q, cb) {
            const e = new Error('Query inactivity timeout');
            e.code = 'PROTOCOL_SEQUENCE_TIMEOUT';
            cb(e, null);
        },
        destroy: function () { destroyed = true; }
    };

    adapter.execute(handle, 'select 1', [], function (err) {
        assert.ok(err, '타임아웃은 에러로 올라와야 한다');
        setTimeout(function () {
            assert.ok(destroyed,
                '타임아웃인데 커넥션을 파기하지 않았다 — 명령이 남은 커넥션이 풀로 돌아간다');
            done();
        }, 10);
    });
});

test('타임아웃이 아닌 에러는 커넥션을 파기하지 않는다', function (t, done) {
    // Ordinary errors such as duplicate keys must not destroy the connection, or the pool would keep reconnecting.
    const adapter = loadAdapter();

    let destroyed = false;
    const handle = {
        query: function (q, cb) {
            const e = new Error('Duplicate entry');
            e.code = 'ER_DUP_ENTRY';
            cb(e, null);
        },
        destroy: function () { destroyed = true; }
    };

    adapter.execute(handle, 'insert', [], function (err) {
        assert.ok(err);
        setTimeout(function () {
            assert.strictEqual(destroyed, false,
                '평범한 질의 에러에 커넥션을 버렸다 — 풀이 매번 새로 맺게 된다');
            done();
        }, 10);
    });
});

test('정상 응답은 그대로 통과한다', function (t, done) {
    const adapter = loadAdapter();
    const rows = [{ ri: 'x' }];
    const handle = {
        query: function (q, cb) { cb(null, rows); },
        destroy: function () { assert.fail('정상인데 커넥션을 파기했다'); }
    };
    adapter.execute(handle, 'select 1', [], function (err, out) {
        assert.strictEqual(err, null);
        assert.deepStrictEqual(out, rows);
        done();
    });
});

test('풀 설정이 드라이버 기본값에 기대지 않는다', function () {
    const live = liveLines(ADAPTER_SRC).join('\n');

    // decimalNumbers: MySQL returns SUM() of integer columns as NEWDECIMAL, which mysql2 emits as a string unless decimalNumbers is true. The schema has no DECIMAL columns, but SUM() is the path.
    assert.ok(/decimalNumbers\s*:\s*true/.test(live),
        'decimalNumbers: true 가 없다 — SUM() 결과가 숫자에서 문자열로 바뀐다');

    // charset: the driver's default connection charset is utf8mb4 while the schema is utf8mb3. A 4-byte character in a binding compared against a utf8mb3 column raises ER_CANT_AGGREGATE_2COLLATIONS instead of matching 0 rows. Discovery query strings reach this path (Express decodes percent-encoding).
    assert.ok(/charset\s*:/.test(live),
        'charset 을 명시하지 않았다 — 드라이버 기본값이 바뀌면 커넥션 콜레이션이 따라 바뀐다');

    // acquireTimeout is not a mysql2 option; the driver warns on stderr for every connection and discards it.
    assert.strictEqual(/acquireTimeout\s*:/.test(live), false,
        'acquireTimeout 이 남아 있다 — mysql2 는 이 키를 버리면서 경고를 찍는다');
});

test('어댑터가 mysql2 를 쓴다', function () {
    const live = liveLines(ADAPTER_SRC).join('\n');
    assert.ok(/require\(['"]mysql2['"]\)/.test(live),
        "어댑터가 mysql2 를 require 하지 않는다");
    assert.strictEqual(/require\(['"]mysql['"]\)/.test(live), false,
        "옛 mysql 드라이버 require 가 남아 있다");
});
