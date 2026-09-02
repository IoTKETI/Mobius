'use strict';
// 카운터 정합 맞추기.
//
// get_cni_count 가 저장값을 읽게 되면서 재집계라는 안전망이 사라졌다.
// 아직 감산하지 않는 경로(subtree 배경 삭제, 만료 스윕)가 남아 있으므로
// 주기적으로 실제 값과 맞춰 줘야 한다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-reconcile-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

// selectRows: SELECT 에 순서대로 돌려줄 결과 배열들
function tapAdapter(useSqlite, selectRows) {
    const db = freshDb(useSqlite);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));
    const seen = [];
    let sel = 0;

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        if (/^select/i.test(sql)) {
            const rows = selectRows[sel] === undefined ? [] : selectRows[sel];
            sel++;
            return cb(null, rows);
        }
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    adapter.begin = function (h, cb) { seen.push({ sql: 'BEGIN' }); cb(null); };
    adapter.commit = function (h, cb) { seen.push({ sql: 'COMMIT' }); cb(null); };
    adapter.rollback = function (h, cb) { seen.push({ sql: 'ROLLBACK' }); cb(null); };

    db.connect(function () {});

    // 구 경로(db_action / db_sqlite)의 getResult 를 가로채 "그쪽으로 샜는가"
    // 를 보던 자리다. 두 파일을 지웠으므로(2026-09-01) 샐 곳이 없다.
    // 되살아나지 않았는지는 test/db-adapter-contract.test.js 가 본다.

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    return { sql_action: require(path.join(__dirname, '..', 'mobius', 'sql_action.js')), seen: seen };
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

// --- update_cnt_cni 는 cni/cbs 만 쓴다 ---------------------------------------
// 정합 맞추기는 st 를 건드리면 안 된다. st 는 변경 카운터라 실제 데이터에서
// 다시 계산할 수 없고, 올리면 없던 구독 알림이 나간다.

test('update_cnt_cni: cnt 의 cni/cbs 만 쓰고 lookup.st 는 안 건드린다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, []);
    sql_action.update_cnt_cni({}, { ri: '/M/c1', cni: 7, cbs: 70 }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1, 'UPDATE 는 cnt 하나뿐이어야 한다');
        assert.match(updates[0].sql, /update `cnt` set/i);
        assert.strictEqual(updates[0].sql.toLowerCase().indexOf('lookup'), -1,
            'lookup 을 건드리면 안 된다: ' + updates[0].sql);
        assert.ok(updates[0].bindings.indexOf(7) !== -1, 'cni 는 바인딩이어야 한다');
        assert.ok(updates[0].bindings.indexOf(70) !== -1, 'cbs 는 바인딩이어야 한다');
        done();
    }));
});

// --- reconcile_cnt_counters --------------------------------------------------
//
// 운영 규모(컨테이너 30,279개 / CIN 1억 4558만)에 올릴 수 있어야 한다.
// 예전 구현의 두 가지 문제:
//
//   1. ORDER BY/커서가 없어 `limit N` 이 늘 같은 N개만 봤다.
//      컨테이너 30,279개 중 나머지는 영원히 검사되지 않았다 (정확성 버그).
//   2. 상관 하위질의를 컨테이너마다 두 번 돌았다. 593만 건짜리 컨테이너에서는
//      한 행에 1180만 인덱스 항목을 훑는다.
//
// 조인으로 바꾸는 것도 답이 아니다 — 운영 스키마는 ri 가 utf8mb3_bin,
// pi 가 utf8mb3_general_ci 라 부모↔자식 조인이 인덱스를 못 쓴다
// (실측: LEFT JOIN 형태는 컨테이너 50개에 20초 상한 초과).
// 리터럴 비교는 인덱스를 정상적으로 쓴다 (type: ref, Using index).

// 1번째 SELECT = cnt 커서 배치, 이후 = 컨테이너별 집계
function reconcileRows(cntRows, counts) {
    return [cntRows].concat(counts);
}

test('reconcile: cnt 를 커서로 훑고 컨테이너마다 집계한다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, reconcileRows(
        [{ ri: '/M/a', cni: 5, cbs: 50 }, { ri: '/M/b', cni: 9, cbs: 90 }],
        [[{ n: 5, s: 50 }], [{ n: 4, s: 40 }]]
    ));

    sql_action.reconcile_cnt_counters({}, { limit: 100 }, guard(done, function (err, report) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(report));
        assert.strictEqual(report.checked, 2);
        assert.strictEqual(report.fixed, 1, '어긋난 /M/b 만 고쳐야 한다');

        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1, '일치하는 건 UPDATE 하면 안 된다');
        assert.ok(updates[0].bindings.indexOf(4) !== -1, '실제 cni=4 로 고쳐야 한다');
        done();
    }));
});

test('reconcile: cnt 조회에 커서와 정렬이 있다 (전수 반복 금지)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, reconcileRows([], []));
    sql_action.reconcile_cnt_counters({}, { limit: 250, cursor: '/M/x' },
        guard(done, function () {
            const first = seen.filter(function (s) { return /^select/i.test(s.sql); })[0];
            assert.ok(first, 'SELECT 이 있어야 한다');
            assert.match(first.sql.toLowerCase(), /order by/, '정렬이 없다: ' + first.sql);
            assert.match(first.sql.toLowerCase(), /limit/, 'LIMIT 이 없다: ' + first.sql);
            assert.ok(first.bindings.indexOf('/M/x') !== -1, '커서가 바인딩으로 안 갔다');
            assert.ok(first.bindings.indexOf(250) !== -1, 'limit 이 바인딩으로 안 갔다');
            done();
        }));
});

test('reconcile: 다음 커서를 돌려줘 이어서 돌 수 있다', function (t, done) {
    const { sql_action } = tapAdapter(true, reconcileRows(
        [{ ri: '/M/a', cni: 1, cbs: 10 }, { ri: '/M/z', cni: 2, cbs: 20 }],
        [[{ n: 1, s: 10 }], [{ n: 2, s: 20 }]]
    ));
    sql_action.reconcile_cnt_counters({}, { limit: 2 }, guard(done, function (err, report) {
        assert.ok(!err);
        assert.strictEqual(report.nextCursor, '/M/z', '마지막 ri 를 커서로 돌려줘야 한다');
        assert.strictEqual(report.done, false, '배치가 꽉 찼으면 아직 안 끝난 것');
        done();
    }));
});

test('reconcile: 배치가 덜 찼으면 done 이다', function (t, done) {
    const { sql_action } = tapAdapter(true, reconcileRows(
        [{ ri: '/M/a', cni: 1, cbs: 10 }],
        [[{ n: 1, s: 10 }]]
    ));
    sql_action.reconcile_cnt_counters({}, { limit: 100 }, guard(done, function (err, report) {
        assert.ok(!err);
        assert.strictEqual(report.done, true);
        done();
    }));
});

test('reconcile: 집계에 조인을 쓰지 않는다 (콜레이션 함정)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, reconcileRows(
        [{ ri: '/M/a', cni: 1, cbs: 10 }],
        [[{ n: 1, s: 10 }]]
    ));
    sql_action.reconcile_cnt_counters({}, { limit: 10 }, guard(done, function () {
        seen.filter(function (s) { return /^select/i.test(s.sql); }).forEach(function (q) {
            assert.strictEqual(/\bjoin\b/i.test(q.sql), false,
                '조인은 콜레이션 불일치로 인덱스를 못 쓴다: ' + q.sql);
        });
        done();
    }));
});

test('reconcile: CIN 이 하나도 없는 컨테이너도 0 으로 맞춘다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, reconcileRows(
        [{ ri: '/M/empty', cni: 7, cbs: 70 }],
        [[{ n: 0, s: null }]]
    ));
    sql_action.reconcile_cnt_counters({}, { limit: 10 }, guard(done, function (err, report) {
        assert.ok(!err);
        assert.strictEqual(report.fixed, 1);
        const upd = seen.filter(function (s) { return /^update/i.test(s.sql); })[0];
        assert.ok(upd.bindings.indexOf(0) !== -1, 'cni 를 0 으로 고쳐야 한다');
        done();
    }));
});

test('reconcile: 대상이 없어도 안 터진다', function (t, done) {
    const { sql_action } = tapAdapter(true, reconcileRows([], []));
    sql_action.reconcile_cnt_counters({}, { limit: 100 }, guard(done, function (err, report) {
        assert.ok(!err);
        assert.strictEqual(report.checked, 0);
        assert.strictEqual(report.fixed, 0);
        assert.strictEqual(report.done, true);
        done();
    }));
});

test('reconcile: 시간 예산을 넘기면 중단하고 커서를 돌려준다', function (t, done) {
    const { sql_action } = tapAdapter(true, reconcileRows(
        [{ ri: '/M/a', cni: 1, cbs: 10 }, { ri: '/M/b', cni: 2, cbs: 20 }],
        [[{ n: 1, s: 10 }], [{ n: 2, s: 20 }]]
    ));
    // 예산 0 이면 첫 컨테이너를 처리하기 전에 멈춘다.
    sql_action.reconcile_cnt_counters({}, { limit: 100, budgetMs: 0 },
        guard(done, function (err, report) {
            assert.ok(!err);
            assert.strictEqual(report.done, false, '예산 소진은 완료가 아니다');
            assert.ok(report.nextCursor !== undefined, '이어서 돌 커서를 줘야 한다');
            done();
        }));
});

test('reconcile: MySQL 에서도 파사드를 거친다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false, reconcileRows(
        [{ ri: '/M/d', cni: 3, cbs: 30 }],
        [[{ n: 1, s: 10 }]]
    ));
    sql_action.reconcile_cnt_counters({}, { limit: 100 }, guard(done, function (err, report) {
        assert.ok(!err);
        assert.strictEqual(report.fixed, 1);
        const leaked = seen.filter(function (s) { return /^LEGACY_/.test(s.sql); });
        assert.deepStrictEqual(leaked, [], '구 경로로 샜다');
        done();
    }));
});

