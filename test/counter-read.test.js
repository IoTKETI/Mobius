'use strict';
// Counter read and reconciliation paths.
//
// get_cni_count reads the stored cnt.cni/cbs instead of re-aggregating every CIN of the container; insert, purge and single delete are all increments now, so the stored values can be trusted.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-counter-read-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

// rows is an array or a function. delete_oldest on the facade issues two kinds of select (counter read / candidate read) that one array cannot answer; a function can answer by the SQL.
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

    db.connect(function () {});

    // The former db_action / db_sqlite files are gone, so there is nothing to intercept for 'leaks'; assertNoLegacy below only checks that they have not returned.

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    const sql_action = require(path.join(__dirname, '..', 'mobius', 'sql_action.js'));
    return { sql_action: sql_action, seen: seen };
}

// Checks that the former path has not returned.
//
// The getResult of db_action / db_sqlite used to be intercepted to count queries that leaked there. With both files deleted, checking that the files do not exist is the same check and stronger: if either returns, the core can bypass the facade again.
function assertNoLegacy(seen) {
    const fs = require('node:fs');
    for (const f of ['db_action.js', 'db_sqlite.js']) {
        assert.strictEqual(
            fs.existsSync(path.join(__dirname, '..', 'mobius', f)), false,
            'mobius/' + f + ' 이 되살아났다 — 파사드를 우회하는 길이 다시 생겼다');
    }
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

// --- get_cni_count uses the stored values ---

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

// Tells a counter read from a purge candidate read by the SQL: the candidate read is the only query of delete_oldest that starts with `lookup as l`.
const isCandidateQuery = (sql) => /`lookup` as `l`/.test(sql);

// A router that answers the counter row with counters and 'none' for purge candidates.
function counterOnly(counters) {
    return function (sql) { return isCandidateQuery(sql) ? [] : counters; };
}

// --- get_cni_count never deletes ---
//
// Its only caller is update_action(ty=='3') in resource.js, a container PUT handled by the workers. delete_oldest dropped its transaction and SELECT ... FOR UPDATE NOWAIT on the premise that the primary is the single purger; a purge from here would make that premise false, and a worker holding a stale cni could delete the next batch right after the primary brought the container down to its limit (a lookup delete cascades to the cin body). The three tests below pin that.

test('get_cni_count: 한도를 크게 넘겨도 삭제 질의를 내지 않는다', function (t, done) {
    // cni=99 exceeds mni=5 twentyfold; the former implementation would delete here.
    const { sql_action, seen } = tapAdapter(true,
        [{ cni: 99, cbs: 990, st: 1, mni: 5, mbs: 50 }]);

    sql_action.get_cni_count({}, { ri: '/M/c1', ty: '3', mni: 5, mbs: 50 },
        guard(done, function (cni, cbs, st) {
            assertNoLegacy(seen);

            const deletes = seen.filter(function (s) { return /^delete/i.test(s.sql); });
            assert.deepStrictEqual(deletes, [],
                '한도 초과에서 삭제가 나갔다 — 정리는 마스터 스윕의 일이다');

            // Not even the candidate read may happen; that would mean delete_oldest was entered.
            const candidates = seen.filter(function (s) { return isCandidateQuery(s.sql); });
            assert.deepStrictEqual(candidates.map(function (s) { return s.sql; }), [],
                'delete_oldest 로 들어갔다 — get_cni_count 는 읽기만 해야 한다');

            assert.strictEqual(cni, 99, '읽은 값을 그대로 돌려준다');
            assert.strictEqual(cbs, 990);
            assert.strictEqual(st, 1);
            done();
        }));
});

test('get_cni_count: 질의는 딱 한 번이다', function (t, done) {
    // The former implementation re-read after the purge and recursed up to MAX_PURGE_ROUNDS times; code on the request path, so latency in itself.
    const { sql_action, seen } = tapAdapter(true,
        [{ cni: 99, cbs: 990, st: 1, mni: 5, mbs: 50 }]);

    sql_action.get_cni_count({}, { ri: '/M/c1', ty: '3', mni: 5, mbs: 50 },
        guard(done, function () {
            assert.strictEqual(seen.length, 1,
                '질의가 ' + seen.length + '개다 — O(1) 이어야 한다: ' +
                JSON.stringify(seen.map(function (s) { return s.sql; })));
            done();
        }));
});

test('delete_oldest 의 호출자는 purge_sweep 하나다', function () {
    // The executable form of 'the primary is the single purger'. Unless the locks return, this invariant must hold; if it breaks, workers delete without locks.
    const fs = require('node:fs');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');

    const callers = src.split('\n')
        .map(function (l, i) { return { n: i + 1, l: l }; })
        .filter(function (x) {
            return !/^\s*(\/\/|\*|\/\*)/.test(x.l) && /\bdelete_oldest\(/.test(x.l) &&
                   !/^function delete_oldest/.test(x.l.trim());
        });

    assert.strictEqual(callers.length, 1,
        'delete_oldest 호출부가 ' + callers.length + '곳이다 (1곳이어야 한다):\n  ' +
        callers.map(function (x) { return x.n + ': ' + x.l.trim(); }).join('\n  '));

    // That one call must be inside purge_sweep.
    const at_sweep = src.indexOf('exports.purge_sweep');
    const at_end = src.indexOf('\nexports.', at_sweep + 10);
    const line_at = src.slice(0, src.indexOf(callers[0].l)).split('\n').length;
    const sweep_start = src.slice(0, at_sweep).split('\n').length;
    const sweep_end = src.slice(0, at_end).split('\n').length;
    assert.ok(line_at > sweep_start && line_at < sweep_end,
        '유일한 호출부가 purge_sweep 밖에 있다 (줄 ' + line_at + ')');
});
