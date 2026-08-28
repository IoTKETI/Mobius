'use strict';
// 고아 lookup 행 정리.
//
// 실행자만 갈라져 있었다 (db_sqlite.getResult vs db.getResult) — SQL 은 한 벌을
// 공유했다. 파사드로 옮기면서 수동 이스케이프도 걷어냈다. `\` 와 `'` 만 다루는
// 불완전한 것이었고, ri/pi 는 클라이언트가 정한 rn 을 담으므로 2차 주입
// 통로였다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-orphan-test.db');

// answer(sql, bindings) -> 행 배열 또는 쓰기 결과
function tapAdapter(answer, useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));

    const seen = [];
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        const r = answer(sql, bindings, seen.length);
        if (r && r.error) { return cb(r.error, null); }
        cb(null, r === undefined ? [] : r);
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

const isScan = (s) => /select `ri`, `pi` from `lookup`/i.test(s);
const isParentCheck = (s) => /select `ri` from `lookup` where `ri` in/i.test(s);
const isDelete = (s) => /^delete from `lookup`/i.test(s);

// --- 고아를 찾아 지운다 -------------------------------------------------------

test('부모가 없는 행만 지운다', function (t, done) {
    // /M/a 의 부모 /M 은 있다. /M/gone/x 의 부모 /M/gone 은 없다.
    const scanRows = [
        { ri: '/M/a', pi: '/M' },
        { ri: '/M/gone/x', pi: '/M/gone' }
    ];
    let scans = 0;
    const tap = tapAdapter(function (sql) {
        if (isScan(sql)) { return (scans++ === 0) ? scanRows : []; }
        if (isParentCheck(sql)) { return [{ ri: '/M' }]; }   // /M/gone 은 없다
        if (isDelete(sql)) { return { affectedRows: 1, insertId: 0 }; }
        return [];
    });

    tap.sql_action.delete_orphan_lookup(null, guard(done, function (err) {
        assert.ok(!err, '오류: ' + JSON.stringify(err));
        const del = tap.seen.filter((s) => isDelete(s.sql));
        assert.strictEqual(del.length, 1, '삭제 질의가 ' + del.length + '번');
        assert.deepStrictEqual(del[0].bindings, ['/M/gone/x'],
            '지운 대상이 다르다: ' + JSON.stringify(del[0].bindings));
        done();
    }));
});

test('고아가 없으면 삭제하지 않는다', function (t, done) {
    let scans = 0;
    const tap = tapAdapter(function (sql) {
        if (isScan(sql)) { return (scans++ === 0) ? [{ ri: '/M/a', pi: '/M' }] : []; }
        if (isParentCheck(sql)) { return [{ ri: '/M' }]; }
        return [];
    });

    tap.sql_action.delete_orphan_lookup(null, guard(done, function (err) {
        assert.ok(!err);
        assert.strictEqual(tap.seen.filter((s) => isDelete(s.sql)).length, 0,
            '고아가 없는데 삭제했다');
        done();
    }));
});

// --- 커서와 패스 --------------------------------------------------------------

test('마지막 ri 를 커서로 이어서 훑는다', function (t, done) {
    let scans = 0;
    const tap = tapAdapter(function (sql) {
        if (isScan(sql)) {
            scans++;
            if (scans === 1) { return [{ ri: '/M/a', pi: '/M' }]; }
            return [];
        }
        if (isParentCheck(sql)) { return [{ ri: '/M' }]; }
        return [];
    });

    tap.sql_action.delete_orphan_lookup(null, guard(done, function () {
        const s = tap.seen.filter((x) => isScan(x.sql));
        assert.strictEqual(s.length, 2, '스캔이 ' + s.length + '번');
        assert.strictEqual(s[0].bindings[0], '', '첫 스캔은 빈 커서로 시작해야 한다');
        assert.strictEqual(s[1].bindings[0], '/M/a', '두 번째 스캔의 커서가 틀렸다');
        done();
    }));
});

test('삭제가 있었으면 패스를 한 번 더 돈다 (다단계 고아)', function (t, done) {
    // 1패스: 고아 1건 삭제 -> 2패스: 아무것도 없음 -> 종료
    let scans = 0;
    const tap = tapAdapter(function (sql) {
        if (isScan(sql)) {
            scans++;
            if (scans === 1) { return [{ ri: '/M/gone/x', pi: '/M/gone' }]; }
            return [];
        }
        if (isParentCheck(sql)) { return []; }
        if (isDelete(sql)) { return { affectedRows: 1, insertId: 0 }; }
        return [];
    });

    tap.sql_action.delete_orphan_lookup(null, guard(done, function () {
        // 1패스 스캔 -> 삭제 -> 1패스 두번째 스캔(빈) -> 2패스 스캔(빈)
        assert.ok(scans >= 3, '삭제 후 패스를 다시 돌지 않았다 (스캔 ' + scans + '회)');
        done();
    }));
});

// --- 주입 방어와 백엔드 중립 --------------------------------------------------

test('ri/pi 를 SQL 에 끼워 넣지 않고 바인딩으로 넘긴다', function (t, done) {
    const evil = "/M/x' or '1'='1";
    let scans = 0;
    const tap = tapAdapter(function (sql) {
        if (isScan(sql)) { return (scans++ === 0) ? [{ ri: evil, pi: evil }] : []; }
        if (isParentCheck(sql)) { return []; }
        if (isDelete(sql)) { return { affectedRows: 1, insertId: 0 }; }
        return [];
    });

    tap.sql_action.delete_orphan_lookup(null, guard(done, function () {
        tap.seen.forEach(function (s) {
            assert.strictEqual(s.sql.indexOf(evil), -1,
                '값이 SQL 문자열에 들어갔다: ' + s.sql);
        });
        const del = tap.seen.filter((s) => isDelete(s.sql))[0];
        assert.ok(del.bindings.indexOf(evil) !== -1, '삭제 바인딩에 없다');
        done();
    }));
});

test('구 경로(db_action / db_sqlite)로 새지 않는다', function (t, done) {
    const tap = tapAdapter(() => []);

    tap.sql_action.delete_orphan_lookup(null, guard(done, function () {
        const leaked = tap.seen.filter((s) => /^LEGACY/.test(s.sql));
        assert.deepStrictEqual(leaked, [], '구 경로로 샜다');
        done();
    }));
});

test('SQLite 에서도 같은 질의를 쓴다', function (t, done) {
    const my = tapAdapter(() => [], false);
    my.sql_action.delete_orphan_lookup(null, guard(done, function () {
        const lite = tapAdapter(() => [], true);
        lite.sql_action.delete_orphan_lookup(null, guard(done, function () {
            assert.strictEqual(my.seen[0].sql, lite.seen[0].sql,
                '백엔드마다 스캔 질의가 다르다:\n  MySQL : ' + my.seen[0].sql +
                '\n  SQLite: ' + lite.seen[0].sql);
            done();
        }));
    }));
});

// --- 오류 전파 ---------------------------------------------------------------

test('스캔이 실패하면 오류를 올린다', function (t, done) {
    const tap = tapAdapter(function (sql) {
        if (isScan(sql)) { return { error: { code: 'ER_X' } }; }
        return [];
    });

    tap.sql_action.delete_orphan_lookup(null, guard(done, function (err) {
        assert.ok(err, '오류를 올리지 않았다');
        done();
    }));
});
