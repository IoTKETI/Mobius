'use strict';
// 부모 갱신 계열이 파사드를 거쳐 드라이버에 어떤 SQL/bindings 를 넘기는지
// 캡처한다. 등가성 하네스는 이 함수들의 SQLite 경로를 밟지 못했다 —
// db_action.getResult 가 usesqlite 와 무관하게 MySQL 로만 보냈기 때문이다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-parent-update-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

// 어댑터의 execute 를 가로채 드라이버에 도달하는 sql/bindings 를 모은다.
// 실제 export 를 그대로 호출하므로 호출 경로 전체가 검증된다.
function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapterPath = path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js');
    const adapter = require(adapterPath);
    const seen = [];

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    // 트랜잭션 능력이 있는 백엔드는 begin/commit 도 기록한다.
    adapter.begin = function (h, cb) { seen.push({ sql: 'BEGIN' }); cb(null); };
    adapter.commit = function (h, cb) { seen.push({ sql: 'COMMIT' }); cb(null); };
    adapter.rollback = function (h, cb) { seen.push({ sql: 'ROLLBACK' }); cb(null); };

    db.connect(function () {});

    // 구 경로도 막아 둔다. db_action.getResult 는 mysql_pool 이 null 이면
    // 콜백을 부르지 않고 그냥 return 해서 테스트가 영원히 멈춘다. 스텁을 두면
    // 미전환 함수가 "구 경로로 샜다"는 사실로 빠르게 드러난다.
    // 구 경로(db_action / db_sqlite)의 getResult 를 가로채 "그쪽으로 샜는가"
    // 를 보던 자리다. 두 파일을 지웠으므로(2026-09-01) 샐 곳이 없다.
    // 되살아나지 않았는지는 test/db-adapter-contract.test.js 가 본다.

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    const sql_action = require(path.join(__dirname, '..', 'mobius', 'sql_action.js'));
    return { sql_action: sql_action, seen: seen };
}

// 구 경로로 샌 호출이 없는지 확인한다.
function assertNoLegacy(seen) {
    const leaked = seen.filter(function (s) { return /^LEGACY_/.test(s.sql); });
    assert.deepStrictEqual(leaked.map(function (s) { return s.legacySql; }), [],
        '구 경로(db_action/db_sqlite)로 샌 쿼리가 있다');
}

// facade.transaction 은 "정산 후 본문에서 던진 예외" 를 잡아 로그만 남긴다
// (설계대로 — 콜백으로 보낼 곳이 없으니까). 그래서 콜백 안에서 assert 가
// 던지면 예외가 삼켜지고 done 이 안 불려 테스트가 멈춘다. 예외를 잡아
// done(e) 로 넘겨 실패로 드러나게 한다.
function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

test('update_parent_st: SQLite 에서도 파사드를 거친다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1, 'UPDATE 는 1개여야 한다');
        assert.match(updates[0].sql, /update `lookup` set `st`/i);
        // 값은 전부 바인딩으로 나가야 한다 — SQL 에 ri 가 박히면 안 된다.
        assert.ok(updates[0].sql.indexOf('/M/c1') === -1, 'ri 가 SQL 에 인라인되면 안 된다');
        assert.ok(updates[0].bindings.indexOf('/M/c1') !== -1, 'ri 는 바인딩으로 나가야 한다');
        done();
    }));
});

test('update_parent_st: MySQL 에서도 같은 형태로 나간다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1);
        assert.match(updates[0].sql, /update `lookup` set `st`/i);
        assert.ok(updates[0].bindings.indexOf('/M/c1') !== -1);
        done();
    }));
});

test('update_parent_st: 타입 테이블 존재 조건을 유지한다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, guard(done, function () {
        const upd = seen.filter(function (s) { return /^update/i.test(s.sql); })[0];
        // 기존 MySQL SQL 은 "and cnt.ri = ?" 로 해당 타입 테이블에 행이 있을 때만
        // st 를 올렸다. 그 조건이 사라지면 고아 lookup 행의 st 까지 올라간다.
        assert.match(upd.sql, /select \* from `cnt`|exists/i,
            '타입 테이블 존재 조건이 사라졌다');
        done();
    }));
});

test('update_parent_by_delete: SQLite 에서 두 UPDATE 가 파사드로 나간다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 2, 'cnt 와 lookup 각각 1개씩이어야 한다');
        assert.match(updates[0].sql, /update `cnt` set/i);
        assert.match(updates[0].sql, /`cni`[\s\S]*`cbs`|`cbs`[\s\S]*`cni`/i);
        assert.match(updates[1].sql, /update `lookup` set `st`/i);
        // cs 는 바인딩으로 나가야 한다.
        assert.ok(updates[0].bindings.indexOf(4) !== -1, 'cs 는 바인딩이어야 한다');
        done();
    }));
});

test('update_parent_by_delete: SQLite 는 트랜잭션 없이 본문만 돈다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, guard(done, function () {
        assert.strictEqual(seen.filter(function (s) { return s.sql === 'BEGIN'; }).length, 0,
            'SQLite 는 transaction 능력이 없다');
        done();
    }));
});

test('update_parent_by_delete: MySQL 은 BEGIN/COMMIT 으로 감싼다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.deepStrictEqual(order, ['BEGIN', 'UPDATE', 'UPDATE', 'COMMIT'],
            '두 UPDATE 가 한 트랜잭션 안에 있어야 한다');
        done();
    }));
});

// update_cnt_cni 의 테스트는 여기 있었으나 test/counter-reconcile.test.js 로 옮겼다.
// 계약이 바뀌었기 때문이다 — 예전에는 cnt(cni/cbs) + lookup(st) 두 UPDATE 였고,
// 지금은 정합 맞추기 전용이라 cnt 하나만 쓴다. st 는 실제 데이터에서 재계산할 수
// 없고, 정합 맞추기가 올리면 없던 구독 알림이 나가므로 일부러 건드리지 않는다.

// update_parent_by_insert 테스트는 여기 있었으나 함수와 함께 제거했다.
// 호출부가 하나도 없는 죽은 코드였다 — CIN 삽입 시 부모 카운터는
// cnt_man 이 debounce 배치로 올린다.

test('update_acp: MySQL 에서 lookup 과 acp 가 한 트랜잭션이다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_acp({}, {
        ri: '/M/a1', lbl: [], acpi: [], at: [], aa: [], subl: [],
        et: '20280101T000000', st: 1, pv: { acr: [] }, pvs: { acr: [] }
    }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.strictEqual(order[0], 'BEGIN', '트랜잭션으로 감싸야 한다');
        assert.strictEqual(order[order.length - 1], 'COMMIT');
        assert.strictEqual(order.filter(function (o) { return o === 'UPDATE'; }).length, 2);
        done();
    }));
});

test('update_sub: MySQL 에서 lookup 과 sub 가 한 트랜잭션이다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_sub({}, {
        ri: '/M/s1', lbl: [], acpi: [], at: [], aa: [], subl: [],
        et: '20280101T000000', st: 1, enc: {}, nu: [], nct: 1, pn: 1, exc: 0
    }, guard(done, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assertNoLegacy(seen);
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.strictEqual(order[0], 'BEGIN');
        assert.strictEqual(order[order.length - 1], 'COMMIT');
        done();
    }));
});
