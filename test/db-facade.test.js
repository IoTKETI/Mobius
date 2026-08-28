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

// conflictRef 는 UPSERT 절에서 "이번에 들어온 값"을 가리키는 방언 조각을
// 돌려준다. hit_ri 의 증분 UPSERT(mobius/sql_action.js)가 이걸로 절대값
// 대입이 아닌 누적 식(hit_ri.col + conflictRef(col))을 만든다 — 어댑터가
// 갈리는 지점을 여기 하나로 고정해 둔다.
test('conflictRef 가 백엔드별로 다른 방언 조각을 돌려준다', function () {
    let db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    assert.strictEqual(db.conflictRef('http'), 'values(http)');

    db = freshDb(true);
    db.connect('h', 1, 'u', 'p', function () {});
    assert.strictEqual(db.conflictRef('http'), 'excluded.http');
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
