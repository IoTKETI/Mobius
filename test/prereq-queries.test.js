'use strict';
// hit_ri 관련 신규 SQL 이 파사드를 거쳐 드라이버에 올바른 SQL/bindings 를
// 넘기는지 확인한다. converted-queries.test.js 의 tapAdapter 패턴을 그대로 쓴다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-prereq-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));
    const calls = [];
    adapter.execute = function (handle, sql, bindings, callback) {
        calls.push({ sql: sql, bindings: bindings });
        if (/^\s*select\b/i.test(sql)) { callback(null, []); }
        else { callback(null, { affectedRows: 1, insertId: 0 }); }
    };
    db.connect('h', 1, 'u', 'p', function () {});
    const SA = path.join(__dirname, '..', 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    return { sql_action: require(SA), calls: calls };
}

test('upsert_hit_ri_batch 는 MySQL 에서 증분 ON DUPLICATE KEY UPDATE 를 만든다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.upsert_hit_ri_batch(null, [
        { ri: '/Mobius/ae1', ct: '20260828', http: 3, mqtt: 0, coap: 0, ws: 0 }
    ], function (err) {
        assert.strictEqual(err, null);
        assert.strictEqual(calls.length, 1);
        assert.match(calls[0].sql, /insert into `hit_ri`/i);
        assert.match(calls[0].sql, /on duplicate key update/i);
        assert.match(calls[0].sql, /http`?\s*\+/i, '절대값이 아니라 증분이어야 한다');
        assert.ok(calls[0].bindings.includes('/Mobius/ae1'));
        assert.ok(calls[0].bindings.includes('20260828'));
        done();
    });
});

test('upsert_hit_ri_batch 는 SQLite 에서 ON CONFLICT 를 만든다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.upsert_hit_ri_batch(null, [
        { ri: '/Mobius/ae1', ct: '20260828', http: 1, mqtt: 0, coap: 0, ws: 0 }
    ], function () {
        assert.match(calls[0].sql, /on conflict/i);
        assert.match(calls[0].sql, /http`?\s*\+/i);
        done();
    });
});

test('upsert_hit_ri_batch 는 여러 행을 한 문장으로 보낸다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.upsert_hit_ri_batch(null, [
        { ri: '/a', ct: '20260828', http: 1, mqtt: 0, coap: 0, ws: 0 },
        { ri: '/b', ct: '20260828', http: 0, mqtt: 2, coap: 0, ws: 0 }
    ], function () {
        assert.strictEqual(calls.length, 1, '행마다 쿼리를 날리면 안 된다');
        assert.ok(calls[0].bindings.includes('/a'));
        assert.ok(calls[0].bindings.includes('/b'));
        done();
    });
});

test('빈 배열이면 쿼리를 아예 날리지 않는다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.upsert_hit_ri_batch(null, [], function (err) {
        assert.strictEqual(err, null);
        assert.strictEqual(calls.length, 0);
        done();
    });
});

// 위 테스트들은 전부 adapter.execute 를 가로채 SQL 텍스트만 본다. 그러면
// SQLite 가 그 SQL 을 실제로 파싱/실행할 수 있는지는 전혀 검증되지 않는다 —
// SQLite 는 "INSERT ... SELECT ... UNION ALL ... ON CONFLICT" 를 모호하다는
// 이유로 거부하므로, 여러 행 UPSERT 는 정말로 깨질 수 있는 조합이다.
// (실제로는 knex 가 ON CONFLICT 앞에 'where true' 를 넣어 이 제약을 비껴간다.)
// 여기서는 가로채지 않고 진짜 sqlite3 드라이버로 왕복시킨다.
test('SQLite 실엔진 왕복: 여러 행 UPSERT 가 파싱되고 증분이 누적된다', function (t, done) {
    const fs = require('node:fs');
    const os = require('node:os');
    const REAL_DB = path.join(os.tmpdir(), 'mobius-prereq-roundtrip-' + process.pid + '.db');
    try { fs.unlinkSync(REAL_DB); } catch (e) { /* 없으면 그만 */ }

    const prevPath = process.env.MOBIUS_SQLITE_PATH;
    process.env.MOBIUS_SQLITE_PATH = REAL_DB;

    // execute 를 갈아끼우지 않는다 = 실제 드라이버로 나간다.
    const db = freshDb(true);
    const SA = path.join(__dirname, '..', 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    const sql_action = require(SA);

    function cleanup() {
        process.env.MOBIUS_SQLITE_PATH = prevPath;
        try { fs.unlinkSync(REAL_DB); } catch (e) { /* 열려 있으면 다음 실행이 지운다 */ }
    }

    db.connect('h', 1, 'u', 'p', function (rsc) {
        assert.strictEqual(rsc, '1', 'SQLite 연결과 스키마 적용이 되어야 한다');
        db.getConnection(function (code, conn) {
            assert.strictEqual(code, '200');

            const batch = [
                { ri: '/Mobius/rt_a', ct: '20260828', http: 1, mqtt: 0, coap: 0, ws: 0 },
                { ri: '/Mobius/rt_b', ct: '20260828', http: 0, mqtt: 2, coap: 0, ws: 0 }
            ];

            // 1회차: 신규 INSERT. 여러 행이 한 문장으로 나가는 그 조합이다.
            sql_action.upsert_hit_ri_batch(conn, batch, function (err1) {
                assert.strictEqual(err1, null, '여러 행 UPSERT 가 SQLite 에서 파싱되어야 한다');

                // 2회차: 같은 키 → ON CONFLICT 로 누적(덮어쓰기가 아니라 +).
                sql_action.upsert_hit_ri_batch(conn, batch, function (err2) {
                    assert.strictEqual(err2, null);

                    sql_action.select_hit_ri(conn, '/Mobius/rt_a', '20260101', function (err3, rows) {
                        assert.strictEqual(err3, null);
                        assert.strictEqual(rows.length, 1);
                        assert.strictEqual(rows[0].http, 2, '1 -> 2 로 누적되어야 한다 (덮어쓰기면 1)');

                        // 3회차: 값을 키워 한 번 더. 2 -> 4.
                        sql_action.upsert_hit_ri_batch(conn, [
                            { ri: '/Mobius/rt_a', ct: '20260828', http: 2, mqtt: 0, coap: 0, ws: 0 }
                        ], function (err4) {
                            assert.strictEqual(err4, null);
                            sql_action.select_hit_ri(conn, '/Mobius/rt_a', '20260101', function (err5, rows2) {
                                assert.strictEqual(err5, null);
                                assert.strictEqual(rows2[0].http, 4, '2 -> 4 로 누적되어야 한다');

                                sql_action.select_hit_ri(conn, '/Mobius/rt_b', '20260101', function (err6, rowsB) {
                                    assert.strictEqual(err6, null);
                                    assert.strictEqual(rowsB[0].mqtt, 4,
                                        '같은 배치의 두 번째 행도 독립적으로 누적되어야 한다');
                                    cleanup();
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

test('select_hit_ri 는 ri 와 ct 범위로 조회한다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.select_hit_ri(null, '/Mobius/ae1', '20260601', function () {
        assert.match(calls[0].sql, /^select .* from `hit_ri`/i);
        assert.deepStrictEqual(calls[0].bindings, ['/Mobius/ae1', '20260601']);
        done();
    });
});

test('delete_hit_ri_old 는 ct 기준으로 지운다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.delete_hit_ri_old(null, '20260401', function () {
        assert.match(calls[0].sql, /^delete from `hit_ri`/i);
        assert.deepStrictEqual(calls[0].bindings, ['20260401']);
        done();
    });
});

// 스펙 §3 P0-2 "리소스 삭제 시 해당 ri 의 행도 정리한다".
// 나이 기준 정리만으로는 삭제된 리소스의 이력이 보관 기간 내내 남고, 같은 rn 으로
// 재생성하면 이전 생애의 카운터가 되살아나 합쳐진다.
test('delete_hit_ri_orphan 은 lookup 에 없는 ri 를 안티조인으로 고른다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.delete_hit_ri_orphan(null, function () {
        assert.match(calls[0].sql, /left join `lookup`/i, 'LEFT JOIN 안티조인이어야 한다');
        assert.match(calls[0].sql, /`l`\.`ri` is null/i);
        assert.match(calls[0].sql, /limit/i, '한 번에 다 지우면 락 시간이 길어진다');
        done();
    });
});

test('delete_hit_ri_orphan 은 고아가 없으면 DELETE 를 날리지 않는다', function (t, done) {
    // tapAdapter 의 execute 스텁은 SELECT 에 빈 배열을 돌려준다.
    const { sql_action, calls } = tapAdapter(false);
    sql_action.delete_hit_ri_orphan(null, function (err, result) {
        assert.strictEqual(err, null);
        assert.strictEqual(result.affectedRows, 0);
        assert.strictEqual(calls.length, 1, 'SELECT 한 번뿐이어야 한다');
        done();
    });
});

// 안티조인은 SQL 텍스트만 봐서는 맞는지 알 수 없다 — 조인 방향이 뒤집혀도
// 문법은 통과한다. 실제 드라이버로 왕복시켜 "고아만" 지워지는지 확인한다.
test('SQLite 실엔진 왕복: delete_hit_ri_orphan 이 고아만 지우고 살아있는 행은 남긴다', function (t, done) {
    const fs = require('node:fs');
    const os = require('node:os');
    const REAL_DB = path.join(os.tmpdir(), 'mobius-orphan-roundtrip-' + process.pid + '.db');
    try { fs.unlinkSync(REAL_DB); } catch (e) { /* 없으면 그만 */ }

    const prevPath = process.env.MOBIUS_SQLITE_PATH;
    process.env.MOBIUS_SQLITE_PATH = REAL_DB;

    const db = freshDb(true);
    const SA = path.join(__dirname, '..', 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    const sql_action = require(SA);

    function cleanup() {
        process.env.MOBIUS_SQLITE_PATH = prevPath;
        try { fs.unlinkSync(REAL_DB); } catch (e) { /* 열려 있으면 다음 실행이 지운다 */ }
    }

    const alive = '/Mobius/alive_ae';
    const orphan = '/Mobius/deleted_ae';

    db.connect('h', 1, 'u', 'p', function (rsc) {
        assert.strictEqual(rsc, '1');
        db.getConnection(function (code, conn) {
            assert.strictEqual(code, '200');

            // alive 만 lookup 에 넣는다. orphan 은 넣지 않는다 = 삭제된 리소스.
            const insLookup = db.k('lookup').insert({
                pi: '/Mobius', ri: alive, ty: 2, ct: '20260828T000000', st: 0,
                rn: 'alive_ae', lt: '20260828T000000', et: '20280828T000000'
            });
            db.run(insLookup, conn, function (e0) {
                assert.strictEqual(e0, null, 'lookup 행 삽입이 되어야 한다');

                sql_action.upsert_hit_ri_batch(conn, [
                    { ri: alive, ct: '20260828', http: 1, mqtt: 0, coap: 0, ws: 0 },
                    { ri: orphan, ct: '20260828', http: 1, mqtt: 0, coap: 0, ws: 0 },
                    { ri: orphan, ct: '20260827', http: 1, mqtt: 0, coap: 0, ws: 0 }
                ], function (e1) {
                    assert.strictEqual(e1, null);

                    sql_action.delete_hit_ri_orphan(conn, function (e2, result) {
                        assert.strictEqual(e2, null);
                        assert.strictEqual(result.affectedRows, 2,
                            '고아 ri 하나가 가진 두 날짜 행이 지워져야 한다');

                        sql_action.select_hit_ri(conn, orphan, '20260101', function (e3, gone) {
                            assert.strictEqual(e3, null);
                            assert.strictEqual(gone.length, 0, '고아 행은 전부 사라져야 한다');

                            sql_action.select_hit_ri(conn, alive, '20260101', function (e4, kept) {
                                assert.strictEqual(e4, null);
                                assert.strictEqual(kept.length, 1,
                                    '살아있는 리소스의 행은 남아야 한다 — 조인 방향이 뒤집히면 여기서 깨진다');
                                cleanup();
                                done();
                            });
                        });
                    });
                });
            });
        });
    });
});
