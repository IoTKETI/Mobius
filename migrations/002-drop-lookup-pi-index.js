'use strict';
// Drops lookup's idx_lookup_pi (pi).
//
// The optimizer does not use it, yet every INSERT maintains it. InnoDB appends the PK columns, so idx_lookup_pi (pi) is stored as (pi, ri, ty), the same composition as PRIMARY; narrowing by pi is served by PRIMARY alone.
//
// Rollback:
//   ALTER TABLE lookup ADD INDEX idx_lookup_pi (pi), ALGORITHM=INPLACE, LOCK=NONE;
// The DROP takes seconds; re-creating the index on a large table takes much longer.
//
// SQLite is not a target: mobiusdb_sqlite.sql has no idx_lookup_pi.

var INDEX = 'idx_lookup_pi';

// ── Lock strategy ──
// The DROP itself is instant; the cost is acquiring the exclusive metadata lock, which depends on what holds lookup at that moment. One wait is kept short (LOCK_WAIT_SEC) and retried several times: while an exclusive MDL request waits, new queries queue behind it, so a long wait stalls lookup for that long.
var LOCK_WAIT_SEC = 5;
var MAX_ATTEMPTS = 20;
var RETRY_WAIT_MS = 15000;

function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['lookup', INDEX]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

module.exports = {
    id: '002-drop-lookup-pi-index',
    description: 'lookup 의 미사용 인덱스 idx_lookup_pi 제거 — 9.49GB 와 INSERT 부담 회수',
    backends: ['mysql'],

    // Read-only; the state shown by --check.
    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (!exists) { return cb(null, '이미 없음 — 적용하면 이력만 남긴다'); }

            // Size and read count are shown together; a non-zero read count is the operator's cue to stop.
            ctx.db.run(
                ctx.db.raw(
                    'select ' +
                    ' (select round(stat_value*16384/1073741824, 2) from mysql.innodb_index_stats ' +
                    '   where database_name = database() and table_name = ? ' +
                    '     and index_name = ? and stat_name = ?) as gb, ' +
                    ' (select is_visible from information_schema.statistics ' +
                    '   where table_schema = database() and table_name = ? ' +
                    '     and index_name = ? limit 1) as visible, ' +
                    // The alias must not be `reads`: it is a MySQL 8 reserved word and gives ER_PARSE_ERROR.
                    ' (select count_read from performance_schema.table_io_waits_summary_by_index_usage ' +
                    '   where object_schema = database() and object_name = ? ' +
                    '     and index_name = ?) as read_count',
                    ['lookup', INDEX, 'size', 'lookup', INDEX, 'lookup', INDEX]),
                ctx.conn,
                function (err2, rows) {
                    if (err2) { return cb(err2, rows); }
                    var r = (rows && rows[0]) || {};
                    cb(null, '있음 — ' + (r.gb === null || r.gb === undefined ? '?' : r.gb) + 'GB, ' +
                        'visible=' + (r.visible || '?') + ', ' +
                        '읽기 ' + (r.read_count === null || r.read_count === undefined
                                    ? '?' : r.read_count) + '회' +
                        ' (읽기는 MySQL 기동 이후 누적이다. 0 이 아니면 멈추고 확인할 것)');
                });
        });
    },

    up: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (!exists) {
                console.log('    (인덱스가 이미 없다 — 지우지 않고 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            // Dropping a secondary index supports INPLACE/LOCK=NONE but takes a brief exclusive MDL at the start, so a long wait would queue new lookup queries behind it. The wait is kept short and retried: on a server with constant traffic, not getting the lock on the first try is normal, and a failure is clean (index and ledger unchanged), so retrying is safe.
            ctx.db.run(ctx.db.raw('SET SESSION lock_wait_timeout = ' + LOCK_WAIT_SEC),
                ctx.conn, function (serr, sres) {
                    if (serr) { return cb(serr, sres); }
                    attempt(1);
                });

            // When the lock could not be acquired, shows what holds it, so the operator has evidence instead of blind retries.
            function reportHolders(done) {
                ctx.db.run(
                    ctx.db.raw(
                        'select ml.lock_type, ml.lock_status, t.processlist_id as pid, ' +
                        ' t.processlist_command as cmd, t.processlist_time as secs, ' +
                        " left(coalesce(t.processlist_info, ''), 60) as info " +
                        'from performance_schema.metadata_locks ml ' +
                        'left join performance_schema.threads t on t.thread_id = ml.owner_thread_id ' +
                        'where ml.object_schema = database() and ml.object_name = ?', ['lookup']),
                    ctx.conn,
                    function (herr, rows) {
                        if (!herr && rows && rows.length) {
                            console.log('    lookup 을 붙잡고 있는 것:');
                            rows.forEach(function (h) {
                                console.log('      ' + h.lock_type + '/' + h.lock_status +
                                            ' pid=' + h.pid + ' cmd=' + h.cmd +
                                            ' ' + h.secs + 's ' + (h.info || ''));
                            });
                        }
                        done();
                    });
            }

            function attempt(n) {
                // The index name is a literal: test/schema-drift.test.js reads DROP INDEX targets from the migration source with a regex and compares them with mobiusdb.sql; a variable would silently defeat that comparison.
                ctx.db.run(
                    ctx.db.raw('ALTER TABLE lookup DROP INDEX idx_lookup_pi' +
                               ', ALGORITHM=INPLACE, LOCK=NONE'),
                    ctx.conn,
                    function (derr, dres) {
                        if (!derr) { return cb(null, dres); }

                        var lockBusy = dres &&
                            (dres.driverCode === 'ER_LOCK_WAIT_TIMEOUT' || dres.errno === 1205);
                        if (!lockBusy) { return cb(derr, dres); }
                        if (n >= MAX_ATTEMPTS) {
                            console.log('    (' + MAX_ATTEMPTS + '번 모두 잠금 대기로 실패했다. ' +
                                        '아무것도 바뀌지 않았으니 다시 돌려도 된다)');
                            return reportHolders(function () { cb(derr, dres); });
                        }
                        console.log('    (잠금 대기 ' + n + '/' + MAX_ATTEMPTS + ' — ' +
                                    (RETRY_WAIT_MS / 1000) + '초 뒤 재시도)');
                        setTimeout(function () { attempt(n + 1); }, RETRY_WAIT_MS);
                    },
                    { timeoutMs: 0 });
            }
        });
    }
};
