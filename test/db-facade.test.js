'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// 실제 개발 DB 를 건드리지 않는다.
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-facade-test.db');

const DB = path.join(__dirname, '..', 'mobius', 'db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

test('usesqlite 에 따라 어댑터를 고른다', function () {
    let db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {});
    assert.strictEqual(db._adapterName(), 'sqlite');

    db = freshDb(false);
    db.connect('localhost', 3306, 'root', 'x', function () {});
    assert.strictEqual(db._adapterName(), 'mysql');
});

test('빌더가 백엔드에 맞는 SQL 을 만든다', function () {
    let db = freshDb(false);
    db.connect('localhost', 3306, 'root', 'x', function () {});
    let n = db.k('acp').insert({ ri: 'x', pv: 'p' }).toSQL().toNative();
    assert.match(n.sql, /^insert into `acp`/);
    assert.deepStrictEqual(n.bindings, ['p', 'x']);

    db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {});
    n = db.k('acp').insert({ ri: 'x', pv: 'p' }).toSQL().toNative();
    assert.match(n.sql, /^insert into `acp`/);
});

test('upsert 가 백엔드별로 갈린다', function () {
    let db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    let sql = db.k('hit').insert({ ct: '1', http: 1 })
        .onConflict('ct').merge({ http: db.raw('http + ?', [1]) })
        .toSQL().toNative().sql;
    assert.match(sql, /on duplicate key update/i);

    db = freshDb(true);
    db.connect('h', 1, 'u', 'p', function () {});
    sql = db.k('hit').insert({ ct: '1', http: 1 })
        .onConflict('ct').merge({ http: db.raw('http + ?', [1]) })
        .toSQL().toNative().sql;
    assert.match(sql, /on conflict/i);
});

test('rowLock 능력이 백엔드별로 다르다', function () {
    let db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    assert.strictEqual(db.can('rowLock'), true);
    assert.strictEqual(db.can('transaction'), true);

    db = freshDb(true);
    db.connect('h', 1, 'u', 'p', function () {});
    assert.strictEqual(db.can('rowLock'), false);
    assert.strictEqual(db.can('transaction'), false);
});

test('SQLite 에서 SELECT 는 배열, 쓰기는 객체를 돌려준다', function (t, done) {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function (rsc) {
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
    db.connect('localhost', 3306, 'root', 'x', function () {
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
    db.connect('localhost', 3306, 'root', 'x', function () {
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
    db.connect('localhost', 3306, 'root', 'x', function () {
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
    db.connect('localhost', 3306, 'root', 'x', function () {
        db.transaction(null, function () {
            throw new Error('sync boom');
        }, function (err, e) {
            assert.strictEqual(err, true);
            assert.match(e.message, /sync boom/);
            done();
        });
    });
});

// capable 경로(트랜잭션 지원 백엔드)는 실제 MySQL 서버 없이도 검증할 수 있다.
// 어댑터의 begin/commit/rollback 을 스텁으로 갈아끼우면 파사드가 그것들을
// 어떤 순서로 부르고 콜백을 몇 번 정산하는지 그대로 드러난다.
function capableDb(stubs) {
    const db = freshDb(false);                       // mysql 어댑터 선택
    const mysql = require(path.join(DB, 'mysql.js'));
    const ops = [];

    mysql.capabilities = { transaction: true, rowLock: true };
    mysql.begin = function (h, cb) { ops.push('begin'); cb(stubs.beginErr || null); };
    mysql.commit = function (h, cb) { ops.push('commit'); cb(stubs.commitErr || null); };
    mysql.rollback = function (h, cb) { ops.push('rollback'); cb(stubs.rollbackErr || null); };

    db.connect('h', 1, 'u', 'p', function () {});
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

        const sdb = freshDb(true);                    // sqlite = 무능력 경로
        sdb.connect('localhost', 3306, 'root', 'x', function () {
            let n = 0;
            sdb.transaction(null, function (conn, finish) {
                finish(null, 'a');
                finish(null, 'b');
                throw new Error('late throw');        // 정산 후 예외도 재정산하면 안 된다
            }, function () { n++; });
            setTimeout(function () {
                assert.strictEqual(n, 1, '무능력 경로 정산도 1회여야 한다');
                done();
            }, 10);
        });
    }, 20);
});

// --- 미연결 상태 방어 --------------------------------------------------------
// 호출부는 facade.run(facade.k('t')..., conn, cb) 형태다. k() 는 인자로 먼저
// 평가되므로 run() 의 try 밖에서 실행된다. 여기서 동기 throw 가 나면 예외가
// sql_action -> resource 로 올라가 워커를 죽인다. 콜백 에러가 되어야 한다.

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
    db.k('t');   // 지연 초기화를 깨운다
    assert.strictEqual(db._adapterName(), 'mysql');

    db = freshDb(true);
    db.k('t');
    assert.strictEqual(db._adapterName(), 'sqlite');
});

test('연결 후에는 run() 이 정상 동작한다 (회귀 방지)', function (t, done) {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function (rsc) {
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

// --- 문장 단위 시간 상한 ------------------------------------------------------
//
// run() 의 opts.timeoutMs 와 반드시 구분해야 한다. 로컬 MySQL 실측:
//   MAX_EXECUTION_TIME(300)  -> ER_QUERY_TIMEOUT(3024), 커넥션 생존
//   opts.timeoutMs = 300     -> PROTOCOL_SEQUENCE_TIMEOUT, 커넥션 사망
//                               (이후 질의는 PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR)
// 그래서 "한 문장만 끊고 계속 일한다" 는 용도에는 힌트를 써야 한다.

test('MySQL 은 문장 단위 상한을 힌트로 제공한다', function () {
    const db = freshDb(false);
    db.connect('localhost', 3306, 'root', 'x', function () {});

    assert.strictEqual(db.can('statementTimeout'), true);
    assert.strictEqual(db.statementTimeoutHint(5000), 'MAX_EXECUTION_TIME(5000)');
});

test('SQLite 는 문장 단위 상한이 없다 — null 을 준다', function () {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {});

    assert.strictEqual(db.can('statementTimeout'), false);
    assert.strictEqual(db.statementTimeoutHint(5000), null);
});

test('상한이 0 이하이거나 숫자가 아니면 힌트를 안 만든다', function () {
    const db = freshDb(false);
    db.connect('localhost', 3306, 'root', 'x', function () {});

    [0, -1, null, undefined, 'x'].forEach(function (v) {
        assert.strictEqual(db.statementTimeoutHint(v), null, '입력 ' + v);
    });
});

test('힌트를 붙이면 SELECT 바로 뒤에 들어간다', function () {
    const db = freshDb(false);
    db.connect('localhost', 3306, 'root', 'x', function () {});

    const sql = db.k('cin').count('* as n')
        .where({ pi: '/x' })
        .hintComment(db.statementTimeoutHint(5000))
        .toSQL().toNative().sql;

    assert.match(sql, /^select \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\//,
        '힌트는 select 바로 뒤에 와야 옵티마이저가 읽는다: ' + sql);
});
