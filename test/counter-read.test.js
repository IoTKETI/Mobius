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
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
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

    db.connect(function () {});

    // 구 경로(db_action.getResult / db_sqlite.getResult)를 가로채 "샜는지" 를
    // 보던 자리다. 그 두 파일이 없어졌으므로 가로챌 것도 없다 —
    // 아래 assertNoLegacy 는 이제 그 파일들이 되살아나지 않았는지만 본다.

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    const sql_action = require(path.join(__dirname, '..', 'mobius', 'sql_action.js'));
    return { sql_action: sql_action, seen: seen };
}

// 구 경로가 되살아나지 않았는지 본다.
//
// 예전에는 db_action / db_sqlite 의 getResult 를 가로채 "그쪽으로 샌 질의"를
// 셌다. 두 파일을 지운 지금은 파일 자체가 없는지를 확인하는 것이 같은 일이고
// 더 강하다 — 하나라도 되살아나면 코어가 다시 파사드를 우회할 수 있다.
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

// --- get_cni_count 는 절대 지우지 않는다 --------------------------------------
//
// 이 함수의 유일한 호출부는 resource.js 의 update_action(ty=='3'), 즉 컨테이너
// PUT 이고 **워커 25개**가 처리한다. 예전에는 여기서 한도 정리까지 했다.
//
// 그런데 delete_oldest 는 "정리 주체가 마스터 하나" 라는 전제로 트랜잭션과
// SELECT ... FOR UPDATE NOWAIT 를 걷어냈다. 이 호출이 남아 있으면 전제가
// 거짓이고, 마스터가 한도까지 내려놓은 직후 낡은 cni 를 든 워커가 재확인 없이
// 다음 100건을 더 지운다 — lookup 삭제는 FK CASCADE 라 cin 본문까지 사라진다.
//
// 그래서 정리를 뺐다. 아래 셋이 그것을 못박는다.

test('get_cni_count: 한도를 크게 넘겨도 삭제 질의를 내지 않는다', function (t, done) {
    // cni=99 가 mni=5 를 스무 배 넘긴다. 예전 구현이라면 여기서 지웠다.
    const { sql_action, seen } = tapAdapter(true,
        [{ cni: 99, cbs: 990, st: 1, mni: 5, mbs: 50 }]);

    sql_action.get_cni_count({}, { ri: '/M/c1', ty: '3', mni: 5, mbs: 50 },
        guard(done, function (cni, cbs, st) {
            assertNoLegacy(seen);

            const deletes = seen.filter(function (s) { return /^delete/i.test(s.sql); });
            assert.deepStrictEqual(deletes, [],
                '한도 초과에서 삭제가 나갔다 — 정리는 마스터 스윕의 일이다');

            // 후보 조회조차 하면 안 된다. 그것이 delete_oldest 로 들어갔다는 뜻이다.
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
    // 예전에는 purge 후 재조회하며 최대 MAX_PURGE_ROUNDS(10) 회 재귀했다.
    // 요청 경로에서 도는 코드라 그 자체가 지연이었다.
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
    // 이것이 "정리 주체는 마스터 하나" 의 실행 가능한 형태다. 잠금을 되돌리지
    // 않는 한 이 불변식이 깨지면 안 된다 — 깨지면 워커가 잠금 없이 지운다.
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

    // 그 하나가 purge_sweep 안에 있어야 한다.
    const at_sweep = src.indexOf('exports.purge_sweep');
    const at_end = src.indexOf('\nexports.', at_sweep + 10);
    const line_at = src.slice(0, src.indexOf(callers[0].l)).split('\n').length;
    const sweep_start = src.slice(0, at_sweep).split('\n').length;
    const sweep_end = src.slice(0, at_end).split('\n').length;
    assert.ok(line_at > sweep_start && line_at < sweep_end,
        '유일한 호출부가 purge_sweep 밖에 있다 (줄 ' + line_at + ')');
});
