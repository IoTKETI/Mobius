'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Keeps the real development DB untouched.
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-facade-test.db');

const DB = path.join(__dirname, '..', 'mobius', 'db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

test('usesqlite 에 따라 어댑터를 고른다', function () {
    let db = freshDb(true);
    db.connect(function () {});
    assert.strictEqual(db._adapterName(), 'sqlite');

    db = freshDb(false);
    db.connect(function () {});
    assert.strictEqual(db._adapterName(), 'mysql');
});

test('빌더가 백엔드에 맞는 SQL 을 만든다', function () {
    let db = freshDb(false);
    db.connect(function () {});
    let n = db.k('acp').insert({ ri: 'x', pv: 'p' }).toSQL().toNative();
    assert.match(n.sql, /^insert into `acp`/);
    assert.deepStrictEqual(n.bindings, ['p', 'x']);

    db = freshDb(true);
    db.connect(function () {});
    n = db.k('acp').insert({ ri: 'x', pv: 'p' }).toSQL().toNative();
    assert.match(n.sql, /^insert into `acp`/);
});

test('upsert 가 백엔드별로 갈린다', function () {
    let db = freshDb(false);
    db.connect(function () {});
    let sql = db.k('hit').insert({ ct: '1', http: 1 })
        .onConflict('ct').merge({ http: db.raw('http + ?', [1]) })
        .toSQL().toNative().sql;
    assert.match(sql, /on duplicate key update/i);

    db = freshDb(true);
    db.connect(function () {});
    sql = db.k('hit').insert({ ct: '1', http: 1 })
        .onConflict('ct').merge({ http: db.raw('http + ?', [1]) })
        .toSQL().toNative().sql;
    assert.match(sql, /on conflict/i);
});

test('rowLock 능력이 백엔드별로 다르다', function () {
    let db = freshDb(false);
    db.connect(function () {});
    assert.strictEqual(db.can('rowLock'), true);
    assert.strictEqual(db.can('transaction'), true);

    db = freshDb(true);
    db.connect(function () {});
    assert.strictEqual(db.can('rowLock'), false);
    assert.strictEqual(db.can('transaction'), false);
});

test('SQLite 에서 SELECT 는 배열, 쓰기는 객체를 돌려준다', function (t, done) {
    const db = freshDb(true);
    db.connect(function (rsc) {
        assert.strictEqual(rsc, '1');
        db.getConnection(function (code, conn) {
            assert.strictEqual(code, '200');
            db.run(db.raw('create table if not exists t_facade (a text)'), conn, function (err) {
                assert.ok(!err, 'create 실패: ' + JSON.stringify(err));
                db.run(db.k('t_facade').insert({ a: 'hello' }), conn, function (err2, ins) {
                    assert.ok(!err2);
                    assert.strictEqual(typeof ins, 'object');
                    assert.ok(!Array.isArray(ins), '쓰기 결과는 배열이면 안 된다');
                    assert.strictEqual(ins.affectedRows, 1);
                    db.run(db.k('t_facade').select('*'), conn, function (err3, rows) {
                        assert.ok(!err3);
                        assert.ok(Array.isArray(rows), 'SELECT 결과는 배열이어야 한다');
                        assert.strictEqual(rows[0].a, 'hello');
                        db.run(db.raw('drop table t_facade'), conn, function () {
                            db.release(conn);
                            done();
                        });
                    });
                });
            });
        });
    });
});

test('제약 위반 에러가 중립 코드로 정규화된다', function (t, done) {
    const db = freshDb(true);
    db.connect(function () {
        db.getConnection(function (code, conn) {
            db.run(db.raw('create table if not exists t_dup (a text primary key)'), conn, function () {
                db.run(db.k('t_dup').insert({ a: 'k' }), conn, function () {
                    db.run(db.k('t_dup').insert({ a: 'k' }), conn, function (err, e) {
                        assert.strictEqual(err, true, '실패 시 첫 인자는 true 여야 한다');
                        assert.strictEqual(e.code, 'DUPLICATE_KEY');
                        db.run(db.raw('drop table t_dup'), conn, function () {
                            db.release(conn);
                            done();
                        });
                    });
                });
            });
        });
    });
});

test('transaction: 능력이 없으면 트랜잭션 없이 본문을 실행한다', function (t, done) {
    const db = freshDb(true);
    db.connect(function () {
        let ran = false;
        db.transaction(null, function (conn, finish) {
            ran = true;
            finish(null, 'ok');
        }, function (err, result) {
            assert.strictEqual(err, null);
            assert.strictEqual(result, 'ok');
            assert.strictEqual(ran, true);
            done();
        });
    });
});

test('transaction: 본문의 에러 객체가 보존된다', function (t, done) {
    const db = freshDb(true);
    db.connect(function () {
        const boom = { code: 'DUPLICATE_KEY', message: 'boom' };
        db.transaction(null, function (conn, finish) {
            finish(true, boom);
        }, function (err, result) {
            assert.strictEqual(err, true, '실패 시 첫 인자는 true');
            assert.strictEqual(result, boom, '에러 객체가 소멸하면 안 된다');
            done();
        });
    });
});

test('transaction: 본문의 동기 예외를 잡아 콜백으로 넘긴다', function (t, done) {
    const db = freshDb(true);
    db.connect(function () {
        db.transaction(null, function () {
            throw new Error('sync boom');
        }, function (err, e) {
            assert.strictEqual(err, true);
            assert.match(e.message, /sync boom/);
            done();
        });
    });
});

// The capable path (a backend with transactions) can be verified without a MySQL server: replacing the adapter's begin/commit/rollback with stubs exposes the order the facade calls them in and how many times it settles the callback.
function capableDb(stubs) {
    const db = freshDb(false);                       // selects the mysql adapter
    const mysql = require(path.join(DB, 'mysql.js'));
    const ops = [];

    mysql.capabilities = { transaction: true, rowLock: true };
    mysql.begin = function (h, cb) { ops.push('begin'); cb(stubs.beginErr || null); };
    mysql.commit = function (h, cb) { ops.push('commit'); cb(stubs.commitErr || null); };
    mysql.rollback = function (h, cb) { ops.push('rollback'); cb(stubs.rollbackErr || null); };

    db.connect(function () {});
    return { db: db, ops: ops };
}

test('transaction(capable): 성공하면 begin -> commit, 정산 1회', function (t, done) {
    const { db, ops } = capableDb({});
    let calls = 0;
    db.transaction({}, function (conn, finish) { finish(null, 'r'); }, function (err, result) {
        calls++;
        assert.strictEqual(err, null);
        assert.strictEqual(result, 'r');
        assert.deepStrictEqual(ops, ['begin', 'commit']);
        setTimeout(function () { assert.strictEqual(calls, 1); done(); }, 10);
    });
});

test('transaction(capable): 본문 실패하면 rollback 하고 에러를 보존한다', function (t, done) {
    const { db, ops } = capableDb({});
    const boom = { code: 'DUPLICATE_KEY' };
    db.transaction({}, function (conn, finish) { finish(true, boom); }, function (err, result) {
        assert.strictEqual(err, true);
        assert.strictEqual(result, boom);
        assert.deepStrictEqual(ops, ['begin', 'rollback']);
        done();
    });
});

test('transaction(capable): 본문 동기 예외도 rollback 한다', function (t, done) {
    const { db, ops } = capableDb({});
    db.transaction({}, function () { throw new Error('sync boom'); }, function (err, e) {
        assert.strictEqual(err, true);
        assert.match(e.message, /sync boom/);
        assert.deepStrictEqual(ops, ['begin', 'rollback']);
        done();
    });
});

test('transaction(capable): commit 실패하면 rollback 까지 간다', function (t, done) {
    const { db, ops } = capableDb({ commitErr: new Error('commit-fail') });
    db.transaction({}, function (conn, finish) { finish(null, 'r'); }, function (err, e) {
        assert.strictEqual(err, true);
        assert.match(e.message, /commit-fail/);
        assert.deepStrictEqual(ops, ['begin', 'commit', 'rollback']);
        done();
    });
});

test('transaction(capable): begin 실패하면 본문을 실행하지 않는다', function (t, done) {
    const { db, ops } = capableDb({ beginErr: new Error('begin-fail') });
    let ran = false;
    db.transaction({}, function () { ran = true; }, function (err, e) {
        assert.strictEqual(err, true);
        assert.match(e.message, /begin-fail/);
        assert.strictEqual(ran, false);
        assert.deepStrictEqual(ops, ['begin']);
        done();
    });
});

test('transaction: finish 를 두 번 불러도 한 번만 정산한다 (양쪽 경로)', function (t, done) {
    const { db, ops } = capableDb({});
    let capableCalls = 0;
    db.transaction({}, function (conn, finish) { finish(null, 'a'); finish(null, 'b'); }, function () {
        capableCalls++;
    });

    setTimeout(function () {
        assert.strictEqual(capableCalls, 1, 'capable 경로 정산은 1회여야 한다');
        assert.deepStrictEqual(ops, ['begin', 'commit'], 'commit 도 1회여야 한다');

        const sdb = freshDb(true);                    // sqlite = the incapable path
        sdb.connect(function () {
            let n = 0;
            sdb.transaction(null, function (conn, finish) {
                finish(null, 'a');
                finish(null, 'b');
                throw new Error('late throw');        // a throw after settlement must not settle again
            }, function () { n++; });
            setTimeout(function () {
                assert.strictEqual(n, 1, '무능력 경로 정산도 1회여야 한다');
                done();
            }, 10);
        });
    }, 20);
});

// Not-connected guard. Callers write facade.run(facade.k('t')..., conn, cb); k() is evaluated as an argument, outside run()'s try. A synchronous throw there would propagate through sql_action to resource and kill the worker; it must become a callback error.

test('미연결: k() 는 던지지 않고 빌더를 준다', function () {
    const db = freshDb(false);
    assert.doesNotThrow(function () {
        const n = db.k('lookup').select('ri').where('sri', 'x').toSQL().toNative();
        assert.match(n.sql, /^select `ri` from `lookup`/);
    });
});

test('미연결: raw() 도 던지지 않는다', function () {
    const db = freshDb(true);
    assert.doesNotThrow(function () { db.raw('select 1'); });
});

test('미연결: run() 은 던지지 않고 콜백으로 실패를 알린다', function (t, done) {
    const db = freshDb(false);
    let threw = false;
    try {
        db.run(db.k('lookup').select('ri'), {}, function (err, res) {
            assert.strictEqual(err, true);
            assert.ok(res);
            assert.match(String(res.message), /connect\(\) has not been called/);
            assert.strictEqual(threw, false);
            done();
        });
    } catch (e) {
        threw = true;
        done(e);
    }
});

test('미연결이어도 방언은 usesqlite 를 따른다', function () {
    let db = freshDb(false);
    db.k('t');   // wakes the lazy initialisation
    assert.strictEqual(db._adapterName(), 'mysql');

    db = freshDb(true);
    db.k('t');
    assert.strictEqual(db._adapterName(), 'sqlite');
});

test('연결 후에는 run() 이 정상 동작한다 (회귀 방지)', function (t, done) {
    const db = freshDb(true);
    db.connect(function (rsc) {
        assert.strictEqual(rsc, '1');
        db.getConnection(function (code, conn) {
            assert.strictEqual(code, '200');
            db.run(db.raw('select 1 as one'), conn, function (err, rows) {
                assert.strictEqual(err, null);
                assert.ok(Array.isArray(rows));
                assert.strictEqual(rows[0].one, 1);
                db.release(conn);
                done();
            });
        });
    });
});

// Per-statement time limit, distinct from run()'s opts.timeoutMs. MAX_EXECUTION_TIME ends one statement and keeps the connection alive; opts.timeoutMs ends the connection. The hint is the tool for 'cut one statement and keep working'.

test('MySQL 은 문장 단위 상한을 힌트로 제공한다', function () {
    const db = freshDb(false);
    db.connect(function () {});

    assert.strictEqual(db.can('statementTimeout'), true);
    assert.strictEqual(db.statementTimeoutHint(5000), 'MAX_EXECUTION_TIME(5000)');
});

test('SQLite 는 문장 단위 상한이 없다 — null 을 준다', function () {
    const db = freshDb(true);
    db.connect(function () {});

    assert.strictEqual(db.can('statementTimeout'), false);
    assert.strictEqual(db.statementTimeoutHint(5000), null);
});

test('상한이 0 이하이거나 숫자가 아니면 힌트를 안 만든다', function () {
    const db = freshDb(false);
    db.connect(function () {});

    [0, -1, null, undefined, 'x'].forEach(function (v) {
        assert.strictEqual(db.statementTimeoutHint(v), null, '입력 ' + v);
    });
});

test('힌트를 붙이면 SELECT 바로 뒤에 들어간다', function () {
    const db = freshDb(false);
    db.connect(function () {});

    const sql = db.k('cin').count('* as n')
        .where({ pi: '/x' })
        .hintComment(db.statementTimeoutHint(5000))
        .toSQL().toNative().sql;

    assert.match(sql, /^select \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\//,
        '힌트는 select 바로 뒤에 와야 옵티마이저가 읽는다: ' + sql);
});
