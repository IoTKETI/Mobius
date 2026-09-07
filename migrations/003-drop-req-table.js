'use strict';
// Drops the req table.
//
// req (ty=17, <request>) held the temporary records of non-blocking requests (rt=1/2), which are not supported; app.js rejects rt with 405-4 and a direct ty=17 POST with 405-2, so no new rows arrive.
//
// ── Order matters ──
// req has an ON DELETE CASCADE foreign key on lookup(ri), so deleting lookup's ty=17 rows removes the req rows with them. Dropping the table first would leave ty=17 orphans in lookup that are still reachable by URI. Hence (1) clean lookup -> (2) DROP TABLE.
//
// ── Rollback ──
// The table structure is in the git history of mobiusdb.sql; the rows do not come back. This migration deletes data.
//
// SQLite is not a target: mobiusdb_sqlite.sql has no req table, and check_db_support in resource.js blocks ty=17 creation there.

// Rows deleted per statement, so row locks are not held for long on a large lookup.
var DELETE_BATCH = 1000;

// DROP TABLE takes an exclusive MDL. As in 002, one wait is kept short and retried; a long wait queues the table's incoming queries.
var LOCK_WAIT_SEC = 5;
var MAX_ATTEMPTS = 20;
var RETRY_WAIT_MS = 15000;

function tableExists(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.tables ' +
            'where table_schema = database() and table_name = ?', ['req']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

function countLookupRows(ctx, cb) {
    ctx.db.run(
        ctx.db.raw("select count(*) as n from lookup where ty = '17'"),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows && rows[0]) ? parseInt(rows[0].n, 10) : 0);
        });
}

module.exports = {
    id: '003-drop-req-table',
    description: 'req 테이블 제거 — 논블로킹 미지원으로 더 이상 쓰이지 않는다',
    backends: ['mysql'],

    // Read-only; the state shown by --check.
    inspect: function (ctx, cb) {
        tableExists(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            countLookupRows(ctx, function (err2, n) {
                if (err2) { return cb(err2, null); }
                if (!exists && n === 0) {
                    return cb(null, '이미 없음 — 적용하면 이력만 남긴다');
                }
                cb(null, (exists ? 'req 테이블 있음' : 'req 테이블 없음') +
                    ', lookup 의 ty=17 행 ' + n + '개' +
                    (n > 0 ? ' (지운다 — 되돌릴 수 없다)' : ''));
            });
        });
    },

    up: function (ctx, cb) {
        // (1) Delete lookup's ty=17 rows in batches; the req rows go with them by FK CASCADE.
        function purge(total) {
            ctx.db.run(
                ctx.db.raw("delete from lookup where ty = '17' limit " + DELETE_BATCH),
                ctx.conn,
                function (err, res) {
                    if (err) { return cb(err, res); }
                    var n = (res && res.affectedRows) || 0;
                    total += n;
                    if (n === DELETE_BATCH) {
                        console.log('    (lookup 의 ty=17 ' + total + '행 삭제, 계속)');
                        return purge(total);
                    }
                    if (total > 0) {
                        console.log('    lookup 의 ty=17 ' + total + '행 삭제 (req 행은 FK CASCADE 로 함께 삭제)');
                    }
                    dropTable(total);
                },
                { timeoutMs: 0 });
        }

        function dropTable(purged) {
            tableExists(ctx, function (err, exists) {
                if (err) { return cb(err, exists); }
                if (!exists) {
                    console.log('    (req 테이블이 이미 없다 — 이력만 남긴다)');
                    return cb(null, { affectedRows: purged });
                }
                ctx.db.run(ctx.db.raw('SET SESSION lock_wait_timeout = ' + LOCK_WAIT_SEC),
                    ctx.conn, function (serr, sres) {
                        if (serr) { return cb(serr, sres); }
                        attempt(1);
                    });
            });

            function attempt(n) {
                // The table name is a literal: test/schema-drift.test.js reads the migration source with a regex and compares it with mobiusdb.sql.
                ctx.db.run(
                    ctx.db.raw('DROP TABLE req'),
                    ctx.conn,
                    function (derr, dres) {
                        if (!derr) {
                            console.log('    req 테이블을 지웠다');
                            return cb(null, { affectedRows: purged });
                        }
                        var lockBusy = dres &&
                            (dres.driverCode === 'ER_LOCK_WAIT_TIMEOUT' || dres.errno === 1205);
                        if (!lockBusy) { return cb(derr, dres); }
                        if (n >= MAX_ATTEMPTS) {
                            console.log('    (' + MAX_ATTEMPTS + '번 모두 잠금 대기로 실패했다. ' +
                                        'lookup 정리는 이미 반영됐고 테이블만 남았다 — 다시 돌리면 된다)');
                            return cb(derr, dres);
                        }
                        console.log('    (잠금 대기 ' + n + '/' + MAX_ATTEMPTS + ' — ' +
                                    (RETRY_WAIT_MS / 1000) + '초 뒤 재시도)');
                        setTimeout(function () { attempt(n + 1); }, RETRY_WAIT_MS);
                    },
                    { timeoutMs: 0 });
            }
        }

        purge(0);
    }
};
