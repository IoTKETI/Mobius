'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

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
