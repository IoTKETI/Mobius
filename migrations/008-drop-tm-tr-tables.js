'use strict';
// Drops the tm / tr tables.
//
// tm (ty=38, <transactionMgmt>) and tr (ty=39, <transaction>) implement the oneM2M distributed transaction (two-phase commit): tm coordinates the requests in rqps through LOCK -> EXECUTE -> COMMIT and a tr is attached per target. The feature is not supported, and the tr.check query every CRUD request used to make is gone with it.
//
// ── Order matters ──
// Both tables have an ON DELETE CASCADE foreign key on lookup(ri), so deleting lookup's ty=38/39 rows removes the tm/tr rows with them. Dropping the tables first would leave orphans in lookup that are still reachable by URI. Hence (1) clean lookup -> (2) DROP TABLE, as in 003.
//
// ── Rollback ──
// The table structure is in the git history of mobiusdb.sql; the rows do not come back. This migration deletes data.
//
// SQLite is not a target: mobiusdb_sqlite.sql has no tm/tr tables, and check_db_support in resource.js blocks ty=38/39 creation there.

// Rows deleted per statement, so row locks are not held for long on a large lookup.
var DELETE_BATCH = 1000;

// DROP TABLE takes an exclusive MDL. One wait is kept short and retried; a long wait queues the table's incoming queries.
var LOCK_WAIT_SEC = 5;
var MAX_ATTEMPTS = 20;
var RETRY_WAIT_MS = 15000;

function tableExists(ctx, name, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.tables ' +
            'where table_schema = database() and table_name = ?', [name]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

function countLookupRows(ctx, cb) {
    ctx.db.run(
        ctx.db.raw("select count(*) as n from lookup where ty in ('38', '39')"),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows && rows[0]) ? parseInt(rows[0].n, 10) : 0);
        });
}

module.exports = {
    id: '008-drop-tm-tr-tables',
    description: 'tm / tr 테이블 제거 — 트랜잭션 리소스를 지원하지 않는다',
    backends: ['mysql'],

    // Read-only; the state shown by --check.
    inspect: function (ctx, cb) {
        tableExists(ctx, 'tm', function (err, hasTm) {
            if (err) { return cb(err, null); }
            tableExists(ctx, 'tr', function (err2, hasTr) {
                if (err2) { return cb(err2, null); }
                countLookupRows(ctx, function (err3, n) {
                    if (err3) { return cb(err3, null); }
                    if (!hasTm && !hasTr && n === 0) {
                        return cb(null, '이미 없음 — 적용하면 이력만 남긴다');
                    }
                    var t = [];
                    if (hasTm) { t.push('tm'); }
                    if (hasTr) { t.push('tr'); }
                    cb(null, (t.length ? t.join('/') + ' 테이블 있음' : '테이블 없음') +
                        ', lookup 의 ty=38/39 행 ' + n + '개' +
                        (n > 0 ? ' (지운다 — 되돌릴 수 없다)' : ''));
                });
            });
        });
    },

    up: function (ctx, cb) {
        // (1) Delete lookup's ty=38/39 rows in batches; the tm/tr rows go with them by FK CASCADE.
        function purge(total) {
            ctx.db.run(
                ctx.db.raw("delete from lookup where ty in ('38', '39') limit " + DELETE_BATCH),
                ctx.conn,
                function (err, res) {
                    if (err) { return cb(err, res); }
                    var n = (res && res.affectedRows) || 0;
                    total += n;
                    if (n === DELETE_BATCH) {
                        console.log('    (lookup 의 ty=38/39 ' + total + '행 삭제, 계속)');
                        return purge(total);
                    }
                    if (total > 0) {
                        console.log('    lookup 의 ty=38/39 ' + total +
                                    '행 삭제 (tm/tr 행은 FK CASCADE 로 함께 삭제)');
                    }
                    dropNext(0, total);
                },
                { timeoutMs: 0 });
        }

        // (2) Drop the two tables in turn.
        var TABLES = ['tr', 'tm'];

        function dropNext(at, purged) {
            if (at >= TABLES.length) {
                return cb(null, { affectedRows: purged });
            }
            var name = TABLES[at];

            tableExists(ctx, name, function (err, exists) {
                if (err) { return cb(err, exists); }
                if (!exists) {
                    console.log('    (' + name + ' 테이블이 이미 없다 — 넘어간다)');
                    return dropNext(at + 1, purged);
                }
                ctx.db.run(ctx.db.raw('SET SESSION lock_wait_timeout = ' + LOCK_WAIT_SEC),
                    ctx.conn, function (serr, sres) {
                        if (serr) { return cb(serr, sres); }
                        attempt(1);
                    });
            });

            function attempt(n) {
                // The table names are literals: test/schema-drift.test.js reads the migration source with a regex and compares it with mobiusdb.sql.
                var sql = (name === 'tr') ? 'DROP TABLE tr' : 'DROP TABLE tm';
                ctx.db.run(
                    ctx.db.raw(sql),
                    ctx.conn,
                    function (derr, dres) {
                        if (!derr) {
                            console.log('    ' + name + ' 테이블을 지웠다');
                            return dropNext(at + 1, purged);
                        }
                        var lockBusy = dres &&
                            (dres.driverCode === 'ER_LOCK_WAIT_TIMEOUT' || dres.errno === 1205);
                        if (!lockBusy) { return cb(derr, dres); }
                        if (n >= MAX_ATTEMPTS) {
                            console.log('    (' + MAX_ATTEMPTS + '번 모두 잠금 대기로 실패했다. ' +
                                        'lookup 정리는 이미 반영됐고 테이블만 남았다 — 다시 돌리면 된다)');
                            return cb(derr, dres);
                        }
                        console.log('    (' + name + ' 잠금 대기 ' + n + '/' + MAX_ATTEMPTS + ' — ' +
                                    (RETRY_WAIT_MS / 1000) + '초 뒤 재시도)');
                        setTimeout(function () { attempt(n + 1); }, RETRY_WAIT_MS);
                    },
                    { timeoutMs: 0 });
            }
        }

        purge(0);
    }
};
