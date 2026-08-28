'use strict';
// presearch 의 부모 탐색(BFS)을 레벨마다 묶어서 묻는다.
//
// 예전에는 부모 하나당 질의 하나였다. 부모가 가진 자식은 몇 개뿐이라
// 비용의 대부분이 왕복이었다 — 배포 서버 실측으로 루트 discovery 1건이
// 부모별 조회를 4,080회 던지는데 검사한 행은 13,437개(쿼리당 3.3행)뿐이었다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-presearch-test.db');

// answer(bindings, sql) -> 돌려줄 행 배열
function tapAdapter(answer) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));

    const seen = [];
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, answer(bindings, sql) || []);
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

// lookup 을 도는 SELECT 만 센다.
const lookupQueries = (seen) => seen.filter((s) => /from `lookup`/i.test(s.sql || ''));

// --- 묶어서 묻는다 -----------------------------------------------------------

test('부모 여럿을 한 번의 질의로 묻는다', function (t, done) {
    const parents = [];
    for (let i = 0; i < 150; i++) { parents.push('/M/p' + i); }

    // 자식은 없다 — 한 레벨만 돌고 끝난다.
    const tap = tapAdapter(() => []);
    const found = [];

    tap.sql_action.search_parents_lookup(null, parents, [], found,
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            const qs = lookupQueries(tap.seen);
            assert.strictEqual(qs.length, 1,
                '부모 150개를 ' + qs.length + '번에 나눠 물었다 — 한 번이어야 한다');
            // 부모 150개가 모두 한 질의의 바인딩에 들어가야 한다
            parents.forEach((p) => assert.ok(qs[0].bindings.indexOf(p) !== -1,
                p + ' 가 바인딩에 없다'));
            done();
        }));
});

test('부모가 배치 크기를 넘으면 나눠 묻되 부모당 하나씩은 아니다', function (t, done) {
    const parents = [];
    for (let i = 0; i < 500; i++) { parents.push('/M/p' + i); }

    const tap = tapAdapter(() => []);
    tap.sql_action.search_parents_lookup(null, parents, [], [],
        guard(done, function () {
            const qs = lookupQueries(tap.seen);
            assert.ok(qs.length >= 2 && qs.length <= 5,
                '부모 500개에 질의 ' + qs.length + '번 — 2~5번이어야 한다 (예전엔 500번)');
            done();
        }));
});

// --- 순서 보존 ---------------------------------------------------------------

test('결과 순서는 pi_list 순서를 따른다 (DB 가 인덱스 순서로 줘도)', function (t, done) {
    // DB 는 pi 오름차순으로 돌려준다고 가정한다: /M/a, /M/b, /M/c
    // 그런데 pi_list 는 c, a, b 순서다. 결과는 c, a, b 순서여야 한다.
    const rows = [
        { pi: '/M/a', ri: '/M/a/1', ty: 3 },
        { pi: '/M/b', ri: '/M/b/1', ty: 3 },
        { pi: '/M/c', ri: '/M/c/1', ty: 3 }
    ];
    let first = true;
    const tap = tapAdapter(function () {
        if (first) { first = false; return rows; }
        return [];   // 다음 레벨은 없다
    });

    const found = [];
    tap.sql_action.search_parents_lookup(null, ['/M/c', '/M/a', '/M/b'], [], found,
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            assert.deepStrictEqual(found.map((f) => f.ri),
                ['/M/c/1', '/M/a/1', '/M/b/1'],
                'pi_list 순서(c, a, b)가 아니라 DB 순서(a, b, c)로 나왔다');
            done();
        }));
});

test('결과 객체는 ri 와 ty 만 담는다 (pi 는 묶는 데만 쓴다)', function (t, done) {
    let first = true;
    const tap = tapAdapter(function () {
        if (first) { first = false; return [{ pi: '/M/a', ri: '/M/a/1', ty: 3 }]; }
        return [];
    });

    const found = [];
    tap.sql_action.search_parents_lookup(null, ['/M/a'], [], found,
        guard(done, function () {
            assert.deepStrictEqual(Object.keys(found[0]).sort(), ['ri', 'ty'],
                '호출부가 안 쓰는 필드가 섞였다: ' + JSON.stringify(found[0]));
            done();
        }));
});

// --- 주입 방어 ---------------------------------------------------------------

test('부모 경로를 SQL 에 끼워 넣지 않고 바인딩으로 넘긴다', function (t, done) {
    const evil = "/M/x' or '1'='1";
    const tap = tapAdapter(() => []);

    tap.sql_action.search_parents_lookup(null, [evil], [], [],
        guard(done, function () {
            const q = lookupQueries(tap.seen)[0];
            assert.strictEqual(q.sql.indexOf(evil), -1,
                '부모 경로가 SQL 문자열에 그대로 들어갔다: ' + q.sql);
            assert.ok(q.bindings.indexOf(evil) !== -1, '바인딩에 없다');
            done();
        }));
});

// --- 레벨 상한 ---------------------------------------------------------------

test('레벨당 2000개 상한에서 멈춘다', function (t, done) {
    // 부모 하나가 자식 3000개를 준다.
    const kids = [];
    for (let i = 0; i < 3000; i++) { kids.push({ pi: '/M/a', ri: '/M/a/' + i, ty: 3 }); }

    let calls = 0;
    const tap = tapAdapter(function () {
        calls++;
        return calls === 1 ? kids : [];
    });

    const found = [];
    tap.sql_action.search_parents_lookup(null, ['/M/a'], [], found,
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            assert.strictEqual(found.length, 2001,
                '상한(2000)을 넘어선 지점에서 멈춰야 한다: ' + found.length);
            done();
        }));
});

test('남은 여유만큼만 limit 을 건다', function (t, done) {
    // 부모를 배치 크기보다 많이 줘서 두 번째 질의가 나가게 한다.
    const parents = [];
    for (let i = 0; i < 400; i++) { parents.push('/M/p' + i); }

    // 첫 묶음이 500개를 돌려준다 -> 두 번째 묶음의 여유는 2001-500 = 1501
    const firstRows = [];
    for (let i = 0; i < 500; i++) { firstRows.push({ pi: '/M/p0', ri: '/M/p0/' + i, ty: 3 }); }

    let n = 0;
    const tap = tapAdapter(function () { n++; return n === 1 ? firstRows : []; });

    tap.sql_action.search_parents_lookup(null, parents, [], [],
        guard(done, function () {
            const qs = lookupQueries(tap.seen);
            const limitOf = (q) => q.bindings[q.bindings.length - 1];
            assert.strictEqual(limitOf(qs[0]), 2001, '첫 질의의 limit: ' + limitOf(qs[0]));
            assert.strictEqual(limitOf(qs[1]), 1501,
                '두 번째 질의는 남은 여유(1501)만 가져와야 한다: ' + limitOf(qs[1]));
            done();
        }));
});

// --- 제외 타입 ---------------------------------------------------------------

test('리프·별도경로 타입(1,9,23,4,17)을 제외한다', function (t, done) {
    const tap = tapAdapter(() => []);

    tap.sql_action.search_parents_lookup(null, ['/M/a'], [], [],
        guard(done, function () {
            const q = lookupQueries(tap.seen)[0];
            ['1', '9', '23', '4', '17'].forEach(function (ty) {
                assert.ok(q.bindings.indexOf(ty) !== -1, 'ty ' + ty + ' 제외가 빠졌다');
            });
            assert.match(q.sql, /not in/i, 'ty 제외 절이 없다: ' + q.sql);
            done();
        }));
});

// --- 레벨 재귀 ---------------------------------------------------------------

test('자식이 있으면 다음 레벨로 내려간다', function (t, done) {
    const levels = [
        [{ pi: '/M', ri: '/M/a', ty: 2 }],
        [{ pi: '/M/a', ri: '/M/a/c1', ty: 3 }],
        []
    ];
    let n = 0;
    const tap = tapAdapter(function () { return levels[n++] || []; });

    const found = [];
    tap.sql_action.search_parents_lookup(null, ['/M'], [], found,
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            assert.deepStrictEqual(found.map((f) => f.ri), ['/M/a', '/M/a/c1']);
            assert.strictEqual(lookupQueries(tap.seen).length, 3,
                '레벨 3개(마지막은 빈 결과)를 돌아야 한다');
            done();
        }));
});

test('DB 오류는 500-1 로 올린다', function (t, done) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    global.usesqlite = 'false';
    const db = require(DB);
    require(path.join(DB, 'mysql.js')).execute =
        function (conn, sql, bindings, cb) { cb({ code: 'ER_X' }, null); };
    db.connect('h', 1, 'u', 'p', function () {});
    delete require.cache[require.resolve(path.join(ROOT, 'mobius', 'sql_action.js'))];
    const sql_action = require(path.join(ROOT, 'mobius', 'sql_action.js'));

    sql_action.search_parents_lookup(null, ['/M/a'], [], [],
        guard(done, function (code) {
            assert.strictEqual(code, '500-1');
            done();
        }));
});
