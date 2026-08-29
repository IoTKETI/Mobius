'use strict';
// discovery 의 ofst 는 **전역** 오프셋이다.
//
// 예전에는 query_where 에 `offset N` 을 넣었는데, 그 조각을
// search_lookup_action 이 **부모 하나씩** 실행한다. 그래서 오프셋이 부모마다
// 적용됐고, 부모가 가진 자식보다 오프셋이 크면 그 부모는 아무것도 안
// 돌려줬다 — 결국 전체가 빈 결과가 된다.
//
// 배포 서버 실측 (2026-08-29, MySQL, 컨테이너 30,278개):
//   lim=200&ofst=1000 -> 0건
//   lim=300&ofst=10   -> 300건이지만 ofst=0 의 300건과 20건만 겹침
//                        (전역 오프셋이면 290건이 겹쳐야 한다)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-ofst-test.db');

// 부모별로 자식을 돌려주는 가짜 어댑터.
// childrenOf(pi) -> 그 부모의 자식 행 배열
function tapAdapter(childrenOf) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));

    const seen = [];
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        // search_lookup_action 의 질의: select * from lookup where pi = ? <조각>
        const m = /limit (\d+)/i.exec(sql);
        const lim = m ? parseInt(m[1], 10) : 1000;
        const pi = bindings && bindings[0];
        const kids = childrenOf(pi) || [];
        cb(null, kids.slice(0, lim));
    };
    adapter.begin = function (h, cb) { cb(null); };
    adapter.commit = function (h, cb) { cb(null); };
    adapter.rollback = function (h, cb) { cb(null); };
    db.connect('h', 1, 'u', 'p', function () {});

    require(path.join(ROOT, 'mobius', 'db_action.js')).getResult =
        function (sql, conn, cb) { seen.push({ sql: 'LEGACY', legacySql: sql }); cb(null, []); };
    require(path.join(ROOT, 'mobius', 'db_sqlite.js')).getResult =
        function (sql, conn, cb) { seen.push({ sql: 'LEGACY_SQLITE', legacySql: sql }); cb(null, []); };

    delete require.cache[require.resolve(path.join(ROOT, 'mobius', 'sql_action.js'))];
    return { sql_action: require(path.join(ROOT, 'mobius', 'sql_action.js')), seen: seen };
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

// 부모 5개, 각 부모가 자식 4개 -> 전체 20건
const PARENTS = ['/M/p0', '/M/p1', '/M/p2', '/M/p3', '/M/p4'];
function kidsOf(pi) {
    const i = PARENTS.indexOf(pi);
    if (i < 0) { return []; }
    const out = [];
    for (let k = 0; k < 4; k++) {
        out.push({ ri: pi + '/c' + k, ty: 3, ct: '20260101T00000' + k, rn: 'c' + k });
    }
    return out;
}

function run(tap, query, cb) {
    const found = {};
    tap.sql_action.search_lookup(null, '/M', query, query.lim, PARENTS, 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code) {
            cb(code, Object.keys(found));
        });
}

// --- 오프셋이 전역인가 -------------------------------------------------------

test('ofst 없이 전체를 받는다', function (t, done) {
    const tap = tapAdapter(kidsOf);
    run(tap, { ty: '3', lim: 20 }, guard(done, function (code, ris) {
        assert.strictEqual(code, '200');
        assert.strictEqual(ris.length, 20, '전체 20건이어야 한다: ' + ris.length);
        done();
    }));
});

test('ofst 는 부모별이 아니라 전역으로 건너뛴다', function (t, done) {
    const base = tapAdapter(kidsOf);
    run(base, { ty: '3', lim: 20 }, guard(done, function (c0, all) {
        const tap = tapAdapter(kidsOf);
        run(tap, { ty: '3', lim: 20, ofst: 6 }, guard(done, function (code, ris) {
            assert.strictEqual(code, '200');
            // 전역이면 20 - 6 = 14 건이 남는다.
            assert.strictEqual(ris.length, 14,
                'ofst=6 이면 14건이어야 한다 (부모별로 적용되면 다른 수가 나온다): ' + ris.length);
            assert.deepStrictEqual(ris, all.slice(6),
                'ofst=6 결과가 전체의 7번째부터가 아니다');
            done();
        }));
    }));
});

test('부모가 가진 자식보다 큰 ofst 도 정상 동작한다', function (t, done) {
    // 부모당 자식은 4개뿐이다. ofst=10 은 예전 구현에서 전부 0건을 만들었다.
    const base = tapAdapter(kidsOf);
    run(base, { ty: '3', lim: 20 }, guard(done, function (c0, all) {
        const tap = tapAdapter(kidsOf);
        run(tap, { ty: '3', lim: 20, ofst: 10 }, guard(done, function (code, ris) {
            assert.strictEqual(ris.length, 10,
                'ofst=10 이면 10건이어야 한다 (예전엔 0건이었다): ' + ris.length);
            assert.deepStrictEqual(ris, all.slice(10));
            done();
        }));
    }));
});

test('전체보다 큰 ofst 는 빈 결과다', function (t, done) {
    const tap = tapAdapter(kidsOf);
    run(tap, { ty: '3', lim: 20, ofst: 100 }, guard(done, function (code, ris) {
        assert.strictEqual(code, '200');
        assert.strictEqual(ris.length, 0, '전체 20건인데 ofst=100 이면 0건: ' + ris.length);
        done();
    }));
});

test('ofst 와 lim 이 함께 동작한다 (페이지 나누기)', function (t, done) {
    const base = tapAdapter(kidsOf);
    run(base, { ty: '3', lim: 20 }, guard(done, function (c0, all) {
        const p1 = tapAdapter(kidsOf);
        run(p1, { ty: '3', lim: 7 }, guard(done, function (c1, page1) {
            const p2 = tapAdapter(kidsOf);
            run(p2, { ty: '3', lim: 7, ofst: 7 }, guard(done, function (c2, page2) {
                assert.deepStrictEqual(page1, all.slice(0, 7), '1페이지가 다르다');
                assert.deepStrictEqual(page2, all.slice(7, 14), '2페이지가 다르다');
                assert.strictEqual(page1.filter((x) => page2.indexOf(x) !== -1).length, 0,
                    '두 페이지가 겹친다');
                done();
            }));
        }));
    }));
});

// --- SQL 에 offset 이 남아 있지 않다 -----------------------------------------

test('부모별 질의에 offset 절을 넣지 않는다', function (t, done) {
    const tap = tapAdapter(kidsOf);
    run(tap, { ty: '3', lim: 20, ofst: 6 }, guard(done, function () {
        const q = tap.seen.filter((s) => /from lookup where pi/i.test(s.sql || ''));
        assert.ok(q.length > 0, '부모별 질의를 못 찾았다');
        q.forEach(function (s) {
            assert.ok(!/offset/i.test(s.sql),
                'offset 이 부모별 질의에 남아 있다: ' + s.sql);
        });
        done();
    }));
});

test('건너뛸 몫까지 더해서 가져온다', function (t, done) {
    const tap = tapAdapter(kidsOf);
    run(tap, { ty: '3', lim: 5, ofst: 6 }, guard(done, function (code, ris) {
        const q = tap.seen.filter((s) => /from lookup where pi/i.test(s.sql || ''));
        const lim = /limit (\d+)/i.exec(q[0].sql);
        assert.ok(lim, 'limit 이 없다: ' + q[0].sql);
        assert.ok(parseInt(lim[1], 10) >= 11,
            'lim(5) + ofst(6) = 11 이상을 가져와야 한다: ' + lim[1]);
        assert.strictEqual(ris.length, 5, '결과는 lim 만큼: ' + ris.length);
        done();
    }));
});

// --- la 는 영향받지 않는다 ---------------------------------------------------

test('la 조회에는 전역 오프셋을 적용하지 않는다', function (t, done) {
    const tap = tapAdapter(kidsOf);
    run(tap, { ty: '3', lim: 20, la: 3, ofst: 6 }, guard(done, function () {
        const q = tap.seen.filter((s) => /from lookup where pi/i.test(s.sql || ''));
        // la 갈래는 ct 시간창을 쓰고 limit/offset 을 안 붙인다.
        q.forEach(function (s) {
            assert.ok(!/offset/i.test(s.sql), 'la 질의에 offset 이 붙었다: ' + s.sql);
        });
        done();
    }));
});
