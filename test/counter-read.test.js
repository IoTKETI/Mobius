'use strict';
// 카운터 읽기/정합 경로 검증.
//
// 배경: get_cni_count 는 매 flush 마다 컨테이너의 모든 CIN 을 세는 O(n) 집계를
// 돌렸다 (100k 기준 7.2ms). 저장된 cnt.cni/cbs 를 읽으면 0.13ms 다.
// 저장값을 못 믿던 이유는 감소 경로가 깨져 있었기 때문인데(ea40cbc 로 수정),
// 이제는 삽입/밀어내기/단건삭제가 전부 증분이라 믿을 수 있다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-counter-read-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

// rows 는 배열이거나 함수다. delete_oldest 가 파사드로 넘어오면서 select 가
// 두 종류(카운터 조회 / 후보 조회)가 됐고, 하나의 배열로는 둘 다 답할 수 없다.
// 함수를 주면 SQL 을 보고 골라 답할 수 있다.
function tapAdapter(useSqlite, rows) {
    const db = freshDb(useSqlite);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));
    const seen = [];

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        if (/^select/i.test(sql)) {
            const r = (typeof rows === 'function') ? rows(sql, bindings) : rows;
            return cb(null, r === undefined ? [] : r);
        }
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    adapter.begin = function (h, cb) { seen.push({ sql: 'BEGIN' }); cb(null); };
    adapter.commit = function (h, cb) { seen.push({ sql: 'COMMIT' }); cb(null); };
    adapter.rollback = function (h, cb) { seen.push({ sql: 'ROLLBACK' }); cb(null); };

    db.connect('h', 1, 'u', 'p', function () {});

    const legacyMysql = require(path.join(__dirname, '..', 'mobius', 'db_action.js'));
    legacyMysql.getResult = function (sql, conn, cb) {
        seen.push({ sql: 'LEGACY_MYSQL', legacySql: sql });
        cb(null, []);
    };
    const legacySqlite = require(path.join(__dirname, '..', 'mobius', 'db_sqlite.js'));
    legacySqlite.getResult = function (sql, conn, cb) {
        seen.push({ sql: 'LEGACY_SQLITE', legacySql: sql });
        cb(null, []);
    };

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    const sql_action = require(path.join(__dirname, '..', 'mobius', 'sql_action.js'));
    return { sql_action: sql_action, seen: seen };
}

function assertNoLegacy(seen) {
    const leaked = seen.filter(function (s) { return /^LEGACY_/.test(s.sql); });
    assert.deepStrictEqual(leaked.map(function (s) { return s.legacySql; }), [],
        '구 경로로 샌 쿼리가 있다');
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

// --- select_cni_parent -------------------------------------------------------

test('select_cni_parent: 파사드를 거치고 값을 바인딩한다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [{ cni: 7, cbs: 70, st: 3, mni: 100, mbs: 1000 }]);
    sql_action.select_cni_parent({}, '/M/c1', guard(done, function (err, rows) {
        assert.strictEqual(err, null, '실패하면 안 된다: ' + JSON.stringify(rows));
        assertNoLegacy(seen);
        assert.strictEqual(seen.length, 1, 'SQL 은 1개여야 한다 (O(1))');
        const q = seen[0];
        assert.ok(q.sql.indexOf('/M/c1') === -1, 'ri 가 SQL 에 인라인되면 안 된다');
        assert.ok(q.bindings.indexOf('/M/c1') !== -1, 'ri 는 바인딩이어야 한다');
        done();
    }));
});

test('select_cni_parent: cni/cbs/st/mni/mbs 5개를 모두 읽는다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [{ cni: 7, cbs: 70, st: 3, mni: 100, mbs: 1000 }]);
    sql_action.select_cni_parent({}, '/M/c1', guard(done, function () {
        const sql = seen[0].sql;
        ['cni', 'cbs', 'st', 'mni', 'mbs'].forEach(function (col) {
            assert.ok(new RegExp('`' + col + '`').test(sql), col + ' 를 읽지 않는다: ' + sql);
        });
        done();
    }));
});

test('select_cni_parent: cin 을 집계하지 않는다 (O(n) 이면 안 된다)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [{ cni: 7, cbs: 70, st: 3, mni: 100, mbs: 1000 }]);
    sql_action.select_cni_parent({}, '/M/c1', guard(done, function () {
        const sql = seen[0].sql.toLowerCase();
        assert.strictEqual(sql.indexOf('count('), -1, 'count() 를 쓰면 O(n) 이다: ' + sql);
        assert.strictEqual(sql.indexOf('sum('), -1, 'sum() 을 쓰면 O(n) 이다: ' + sql);
        assert.strictEqual(sql.indexOf('`cin`'), -1, 'cin 테이블을 건드리면 O(n) 이다: ' + sql);
        done();
    }));
});

test('select_cni_parent: MySQL 에서도 같은 형태다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false, [{ cni: 1, cbs: 2, st: 3, mni: 4, mbs: 5 }]);
    sql_action.select_cni_parent({}, '/M/c1', guard(done, function (err) {
        assert.strictEqual(err, null);
        assertNoLegacy(seen);
        assert.strictEqual(seen.length, 1);
        done();
    }));
});

// --- get_cni_count 가 저장값을 쓴다 -------------------------------------------

test('get_cni_count: 재집계 대신 저장값을 읽는다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [{ cni: 7, cbs: 70, st: 3, mni: 100, mbs: 1000 }]);
    sql_action.get_cni_count({}, { ri: '/M/c1', ty: '3', mni: 100, mbs: 1000 },
        guard(done, function (cni, cbs, st) {
            assertNoLegacy(seen);
            assert.strictEqual(cni, 7, '저장된 cni 를 그대로 돌려줘야 한다');
            assert.strictEqual(cbs, 70);
            assert.strictEqual(st, 3);
            const agg = seen.filter(function (s) { return /count\(|sum\(/i.test(s.sql); });
            assert.deepStrictEqual(agg, [], '집계 쿼리가 남아 있다');
            done();
        }));
});

test('get_cni_count: 한도 안이면 purge 하지 않는다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [{ cni: 7, cbs: 70, st: 3, mni: 100, mbs: 1000 }]);
    sql_action.get_cni_count({}, { ri: '/M/c1', ty: '3', mni: 100, mbs: 1000 },
        guard(done, function () {
            const deletes = seen.filter(function (s) { return /^delete/i.test(s.sql); });
            assert.deepStrictEqual(deletes, [], '한도 안인데 삭제가 돌았다');
            done();
        }));
});

test('get_cni_count: cnt 행이 없으면 0 을 돌려준다', function (t, done) {
    const { sql_action } = tapAdapter(true, []);
    sql_action.get_cni_count({}, { ri: '/M/none', ty: '3', mni: 100, mbs: 1000 },
        guard(done, function (cni, cbs, st) {
            assert.strictEqual(cni, 0);
            assert.strictEqual(cbs, 0);
            assert.strictEqual(st, 0);
            done();
        }));
});

// 카운터 조회인지 purge 후보 조회인지 SQL 로 가른다.
// 후보 조회는 delete_oldest 가 `lookup as l` 로 시작하는 유일한 질의다.
const isCandidateQuery = (sql) => /`lookup` as `l`/.test(sql);

// 카운터 행은 counters 로 답하고, purge 후보는 없다고 답하는 라우터.
function counterOnly(counters) {
    return function (sql) { return isCandidateQuery(sql) ? [] : counters; };
}

// mni/mbs 는 예전에 호출자의 메모리 객체(obj.mni/obj.mbs)에서 왔다. cnt_man 은
// debounce 창의 첫 CIN 시점 사본을 들고 있으므로, 그 사이 클라이언트가 mni 를
// 낮추면 옛 값으로 한도를 판정했다. 이제 DB 최신값을 쓴다.
test('get_cni_count: mni/mbs 를 DB 최신값으로 판정한다', function (t, done) {
    // DB 는 mni=5 인데 호출자 객체는 낡은 mni=100 을 들고 있다.
    // cni(7) > mni(5) 이므로 purge 가 시도돼야 한다. obj.mni=100 을 썼다면 안 돈다.
    const { sql_action, seen } = tapAdapter(true,
        counterOnly([{ cni: 7, cbs: 70, st: 3, mni: 5, mbs: 1000 }]));

    sql_action.get_cni_count({}, { ri: '/M/c1', ty: '3', mni: 100, mbs: 1000 },
        guard(done, function (cni, cbs, st) {
            assertNoLegacy(seen);
            const purgeTried = seen.some(function (s) { return isCandidateQuery(s.sql); });
            assert.ok(purgeTried, 'DB 의 mni=5 를 썼다면 purge 가 시도돼야 한다: ' +
                JSON.stringify(seen.map(function (s) { return s.sql; })));

            // delete_oldest 가 아무것도 못 지웠으면(후보 0건) 재조회 없이
            // 방금 읽은 값을 그대로 돌려준다 — 배포본의 라이브락 수정(204f7a4).
            assert.strictEqual(cni, 7, '지운 게 없으면 읽은 값을 그대로 돌려준다');
            assert.strictEqual(cbs, 70);
            assert.strictEqual(st, 3);
            done();
        }));
});

// 배포본 204f7a4 의 핵심: delete_oldest 가 진행 없이 성공처럼 반환하는 경로
// (예전엔 NOWAIT 스킵 / 이미 정리됨 / 후보 0건, 지금은 후보 0건 하나)에서
// 재귀하면 라이브락이 된다.
// 실측 장애: load 1085, 동시 쿼리 1243건, 락 타임아웃 3330건.
test('get_cni_count: 지운 게 없으면 재조회하지 않는다 (라이브락 방지)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true,
        counterOnly([{ cni: 99, cbs: 990, st: 1, mni: 5, mbs: 50 }]));

    sql_action.get_cni_count({}, { ri: '/M/c1', ty: '3', mni: 5, mbs: 50 },
        guard(done, function () {
            // 저장값 조회(select_cni_parent)는 딱 한 번이어야 한다.
            const reads = seen.filter(function (s) { return /^select .*`cni`/i.test(s.sql); });
            assert.strictEqual(reads.length, 1,
                '지운 게 없는데 재조회했다 (' + reads.length + '회)');
            // 후보가 0건이면 삭제도 안 나가야 한다.
            const deletes = seen.filter(function (s) { return /^delete/i.test(s.sql); });
            assert.deepStrictEqual(deletes, [], '후보 0건인데 삭제가 나갔다');
            done();
        }));
});

// delete_oldest 가 실제로 지웠을 때는 재조회한다 — 위 테스트의 반대편이다.
// 둘 다 있어야 "지웠으면 재조회, 아니면 안 함" 이 고정된다.
test('get_cni_count: 지운 게 있으면 재조회한다', function (t, done) {
    // 첫 조회는 한도 초과(cni=7 > mni=5), 재조회는 한도 안(cni=4).
    // 후보 조회는 1건을 주고, 삭제 후 재집계는 cin 집계 질의로 답한다.
    let reads = 0;
    const { sql_action, seen } = tapAdapter(true, function (sql) {
        if (isCandidateQuery(sql)) { return [{ ri: '/M/c1/cin1', cs: 30 }]; }
        if (/count\(/i.test(sql)) { return [{ n: 4, s: 40 }]; }   // 삭제 후 실측
        reads += 1;
        return reads === 1
            ? [{ cni: 7, cbs: 70, st: 3, mni: 5, mbs: 1000 }]
            : [{ cni: 4, cbs: 40, st: 4, mni: 5, mbs: 1000 }];
    });

    sql_action.get_cni_count({}, { ri: '/M/c1', ty: '3', mni: 5, mbs: 1000 },
        guard(done, function (cni, cbs, st) {
            assertNoLegacy(seen);
            assert.strictEqual(reads, 2, '지웠는데 재조회하지 않았다');
            assert.strictEqual(cni, 4, '재조회한 값을 돌려줘야 한다');
            assert.strictEqual(cbs, 40);
            assert.strictEqual(st, 4);

            // 지운 집합을 그대로 지워야 한다 — 다시 고르면 센 것과 갈린다.
            const del = seen.find(function (s) { return /^delete/i.test(s.sql); });
            assert.ok(del, '삭제가 안 나갔다');
            assert.ok(del.bindings.indexOf('/M/c1/cin1') >= 0,
                '고른 ri 를 바인딩으로 지워야 한다: ' + JSON.stringify(del.bindings));
            done();
        }));
});

test('get_cni_count: purge 가 수렴하지 않아도 무한 재귀하지 않는다', function (t, done) {
    // 후보는 늘 있고(= 지웠다고 보고) 카운터는 안 줄어드는 상황.
    // 실제로는 카운터 드리프트나 다른 워커와의 경합에서 나온다.
    const { sql_action } = tapAdapter(true, function (sql) {
        if (isCandidateQuery(sql)) { return [{ ri: '/M/stuck/cin1', cs: 10 }]; }
        if (/count\(/i.test(sql)) { return [{ n: 99, s: 990 }]; }
        return [{ cni: 99, cbs: 990, st: 1, mni: 5, mbs: 50 }];
    });
    const t0 = Date.now();
    sql_action.get_cni_count({}, { ri: '/M/stuck', ty: '3', mni: 5, mbs: 50 },
        guard(done, function (cni, cbs, st) {
            assert.ok(Date.now() - t0 < 5000, '상한 안에서 끝나야 한다');
            assert.strictEqual(cni, 99, '수렴 실패 시 마지막으로 읽은 값을 돌려준다');
            assert.strictEqual(cbs, 990);
            assert.strictEqual(st, 1);
            done();
        }));
});
