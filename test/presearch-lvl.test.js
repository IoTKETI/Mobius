'use strict';
// lvl 을 탐색 단계로 내려보낸다.
//
// 호출부(resource.js)는 lvl 이 있으면 훑고 나서 깊이로 걸러냈다. 즉 버릴 것을
// 다 읽고 있었다. 배포 서버 실측 (2026-08-29):
//
//   /Mobius?fu=1&ty=3&lim=100          -> 부모질의 25회 / 626ms
//   /Mobius?fu=1&ty=3&lim=100&lvl=1    -> 부모질의 25회 / 665ms  (결과 3건)
//   /Mobius?fu=1&ty=2&lim=100          -> 부모질의 25회 / 659ms  (lvl=1 강제)
//
// 왜 결과가 같은가: 필터는 depth(ri) <= cur_lvl + lvl 인 것만 남긴다.
// 탐색 레벨 k 의 노드는 depth >= cur_lvl + 1 + k 이므로(등호는 rn 에 '/' 가
// 없을 때 — 배포 데이터에 rn='P1/test' 인 AE 가 실제로 하나 있다),
// 남는 것은 반드시 k <= lvl - 1 이다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-presearch-lvl-test.db');

function tapAdapter(levels, useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));

    const seen = [];
    let n = 0;
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, levels[n++] || []);
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

// 빌더가 만든 SQL 은 백틱을 붙이고, CTE 는 raw 라 안 붙는다. 둘 다 잡는다.
const lookupQueries = (seen) => seen.filter((s) => /from\s+`?lookup`?/i.test(s.sql || ''));

// 세 레벨짜리 트리를 흉내낸다.
const TREE = [
    [{ pi: '/M', ri: '/M/a', ty: 2 }],
    [{ pi: '/M/a', ri: '/M/a/c', ty: 3 }],
    [{ pi: '/M/a/c', ri: '/M/a/c/d', ty: 3 }],
    []
];

// --- MySQL 경로 --------------------------------------------------------------

test('max_levels 0 이면 질의를 한 번도 안 던진다', function (t, done) {
    const tap = tapAdapter(TREE);
    const found = [];

    tap.sql_action.search_parents_lookup(null, ['/M'], [], found,
        guard(done, function (code) {
            assert.strictEqual(code, '200');
            assert.strictEqual(lookupQueries(tap.seen).length, 0,
                'lvl=1(=0레벨) 인데 질의를 던졌다');
            assert.deepStrictEqual(found, []);
            done();
        }), 0);
});

test('max_levels 1 이면 한 레벨만 내려간다', function (t, done) {
    const tap = tapAdapter(TREE);
    const found = [];

    tap.sql_action.search_parents_lookup(null, ['/M'], [], found,
        guard(done, function () {
            assert.strictEqual(lookupQueries(tap.seen).length, 1);
            assert.deepStrictEqual(found.map((f) => f.ri), ['/M/a']);
            done();
        }), 1);
});

test('max_levels 2 면 두 레벨까지 내려간다', function (t, done) {
    const tap = tapAdapter(TREE);
    const found = [];

    tap.sql_action.search_parents_lookup(null, ['/M'], [], found,
        guard(done, function () {
            assert.strictEqual(lookupQueries(tap.seen).length, 2);
            assert.deepStrictEqual(found.map((f) => f.ri), ['/M/a', '/M/a/c']);
            done();
        }), 2);
});

test('max_levels 를 안 주면 예전처럼 끝까지 내려간다', function (t, done) {
    const tap = tapAdapter(TREE);
    const found = [];

    tap.sql_action.search_parents_lookup(null, ['/M'], [], found,
        guard(done, function () {
            // 세 레벨 + 빈 결과 한 번
            assert.strictEqual(lookupQueries(tap.seen).length, 4);
            assert.deepStrictEqual(found.map((f) => f.ri), ['/M/a', '/M/a/c', '/M/a/c/d']);
            done();
        }));
});

test('상한이 있어도 트리가 먼저 끝나면 거기서 멈춘다', function (t, done) {
    const tap = tapAdapter([[{ pi: '/M', ri: '/M/a', ty: 2 }], []]);
    const found = [];

    tap.sql_action.search_parents_lookup(null, ['/M'], [], found,
        guard(done, function () {
            assert.strictEqual(lookupQueries(tap.seen).length, 2);
            assert.deepStrictEqual(found.map((f) => f.ri), ['/M/a']);
            done();
        }), 9);
});

// --- SQLite 경로 (재귀 CTE) --------------------------------------------------

test('SQLite CTE 도 깊이 상한을 받는다', function (t, done) {
    const tap = tapAdapter([[{ pi: '/M', ri: '/M/a', ty: 2 }]], true);

    tap.sql_action.search_parents_lookup(null, ['/M'], [], [],
        guard(done, function () {
            const q = lookupQueries(tap.seen)[0];
            assert.match(q.sql, /RECURSIVE/i, 'CTE 가 아니다');
            assert.match(q.sql, /depth/i, '깊이 컬럼이 없다: ' + q.sql);
            assert.ok(q.bindings.indexOf(2) !== -1,
                '상한값 2 가 바인딩에 없다: ' + JSON.stringify(q.bindings));
            done();
        }), 2);
});

test('SQLite CTE 는 상한이 없으면 깊이 컬럼을 안 만든다', function (t, done) {
    const tap = tapAdapter([[{ pi: '/M', ri: '/M/a', ty: 2 }]], true);

    tap.sql_action.search_parents_lookup(null, ['/M'], [], [],
        guard(done, function () {
            const q = lookupQueries(tap.seen)[0];
            assert.ok(!/depth/i.test(q.sql), '상한이 없는데 깊이 컬럼이 붙었다: ' + q.sql);
            done();
        }));
});

test('SQLite CTE 도 부모 경로를 바인딩으로 넘긴다', function (t, done) {
    const evil = "/M/x' or '1'='1";
    const tap = tapAdapter([[]], true);

    tap.sql_action.search_parents_lookup(null, [evil], [], [],
        guard(done, function () {
            const q = lookupQueries(tap.seen)[0];
            assert.strictEqual(q.sql.indexOf(evil), -1,
                '부모 경로가 SQL 에 그대로 들어갔다: ' + q.sql);
            assert.ok(q.bindings.indexOf(evil) !== -1, '바인딩에 없다');
            done();
        }));
});

// --- 호출부가 lvl 을 내려보내는가 -------------------------------------------

const RES = require('node:fs').readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');

test('resource.js 가 lvl 을 max_levels 로 바꿔 넘긴다', function () {
    assert.match(RES, /max_levels\s*=\s*Math\.max\(0,\s*parsed_lvl\s*-\s*1\)/,
        'lvl-1 을 계산하지 않는다');
    assert.match(RES, /\}\s*,\s*max_levels\)\s*;/,
        'search_parents_lookup 에 max_levels 를 넘기지 않는다');
});

test('resource.js 가 ty=2 의 lvl 강제를 미리 반영한다', function () {
    // lvl='1' 은 탐색이 끝난 뒤에 세팅되므로, 미리 같은 조건을 봐야 한다.
    assert.match(RES, /eff_lvl\s*=\s*\(request\.query\.ty\s*==\s*'2'\)\s*\?\s*'1'\s*:\s*request\.query\.lvl/,
        'ty=2 의 lvl=1 강제를 탐색 전에 반영하지 않는다');
});
