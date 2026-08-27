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
    global.usesqlite = useSqlite ? 'true' : 'false';
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

test('reconcile_cnt_counters: 어긋난 컨테이너만 고친다', function (t, done) {
    // 1번째 SELECT = 대상 컨테이너 목록 (저장값과 실제값이 함께 온다)
    const { sql_action, seen } = tapAdapter(true, [[
        { ri: '/M/ok',    cni: 5, cbs: 50, real_cni: 5, real_cbs: 50 },   // 일치
        { ri: '/M/drift', cni: 9, cbs: 90, real_cni: 4, real_cbs: 40 }    // 어긋남
    ]]);

    sql_action.reconcile_cnt_counters({}, 100, guard(done, function (err, report) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(report.checked, 2);
        assert.strictEqual(report.fixed, 1, '어긋난 1건만 고쳐야 한다');

        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1, '일치하는 건 UPDATE 하면 안 된다');
        assert.ok(updates[0].bindings.indexOf(4) !== -1, '실제 cni=4 로 고쳐야 한다');
        assert.ok(updates[0].bindings.indexOf(40) !== -1, '실제 cbs=40 으로 고쳐야 한다');
        done();
    }));
});

test('reconcile_cnt_counters: 전부 맞으면 UPDATE 가 없다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[
        { ri: '/M/a', cni: 1, cbs: 10, real_cni: 1, real_cbs: 10 },
        { ri: '/M/b', cni: 2, cbs: 20, real_cni: 2, real_cbs: 20 }
    ]]);
    sql_action.reconcile_cnt_counters({}, 100, guard(done, function (err, report) {
        assert.ok(!err);
        assert.strictEqual(report.fixed, 0);
        assert.deepStrictEqual(seen.filter(function (s) { return /^update/i.test(s.sql); }), []);
        done();
    }));
});

test('reconcile_cnt_counters: 대상이 없어도 안 터진다', function (t, done) {
    const { sql_action } = tapAdapter(true, [[]]);
    sql_action.reconcile_cnt_counters({}, 100, guard(done, function (err, report) {
        assert.ok(!err);
        assert.strictEqual(report.checked, 0);
        assert.strictEqual(report.fixed, 0);
        done();
    }));
});

test('reconcile_cnt_counters: LIMIT 을 건다 (전수 스캔 금지)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true, [[]]);
    sql_action.reconcile_cnt_counters({}, 250, guard(done, function () {
        const sel = seen.filter(function (s) { return /^select/i.test(s.sql); })[0];
        assert.ok(sel, 'SELECT 이 있어야 한다');
        assert.match(sel.sql.toLowerCase(), /limit/, 'LIMIT 이 없다: ' + sel.sql);
        assert.ok(sel.bindings.indexOf(250) !== -1, 'limit 은 바인딩이어야 한다');
        done();
    }));
});

test('reconcile_cnt_counters: MySQL 에서도 파사드를 거친다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false, [[
        { ri: '/M/d', cni: 3, cbs: 30, real_cni: 1, real_cbs: 10 }
    ]]);
    sql_action.reconcile_cnt_counters({}, 100, guard(done, function (err, report) {
        assert.ok(!err);
        assert.strictEqual(report.fixed, 1);
        const leaked = seen.filter(function (s) { return /^LEGACY_/.test(s.sql); });
        assert.deepStrictEqual(leaked, [], '구 경로로 샜다');
        done();
    }));
});
