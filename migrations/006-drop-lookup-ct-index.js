'use strict';
// Drops idx_lookup_ct, reclaiming its space and the maintenance cost on every write.
//
// Apply after 005 and an observation period. 005 makes the index INVISIBLE to imitate the dropped state; when response times stay the same and the query below keeps returning 0 for it, it can be dropped:
//
//   select ifnull(index_name,'(TABLE SCAN)'), count_read
//     from performance_schema.table_io_waits_summary_by_index_usage
//    where object_schema='mobiusdb' and object_name='lookup'
//    order by count_read desc;
//
// No query accesses lookup by ct alone (see 005).
//
// Rollback:
//   ALTER TABLE lookup ADD INDEX idx_lookup_ct (ct), ALGORITHM=INPLACE, LOCK=NONE;
// Online, but a long rebuild; that is why 005 observes first.
//
// The DROP itself is fast; the MDL wait is handled with the same retry as 002.

var INDEX_NAME = 'idx_lookup_ct';

function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['lookup', INDEX_NAME]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

module.exports = {
    id: '006-drop-lookup-ct-index',
    description: 'idx_lookup_ct 제거 — 15.6GB 회수 (005 로 관찰한 뒤 적용할 것)',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (!exists) { return cb(null, '이미 없음 — 적용하면 이력만 남긴다'); }

            ctx.db.run(
                ctx.db.raw(
                    'select ifnull((select is_visible from information_schema.statistics ' +
                    ' where table_schema = database() and table_name = ? and index_name = ? limit 1), ?) as vis, ' +
                    ' (select round(stat_value * @@innodb_page_size / 1024 / 1024 / 1024, 1) ' +
                    '    from mysql.innodb_index_stats ' +
                    '   where database_name = database() and table_name = ? and index_name = ? ' +
                    '     and stat_name = ?) as gb',
                    ['lookup', INDEX_NAME, '?', 'lookup', INDEX_NAME, 'size']),
                ctx.conn,
                function (err2, rows) {
                    var r = (!err2 && rows && rows[0]) ? rows[0] : {};
                    var vis = String(r.vis) === 'NO' ? 'INVISIBLE (005 적용됨)'
                                                     : 'VISIBLE (005 를 먼저 적용할 것)';
                    cb(null, '있음 — ' + vis + ', ' + (r.gb || '?') + 'GB. ' +
                        'DROP 은 빠르지만(002 에서 2.5초) 되돌리려면 수십 분이 든다');
                });
        });
    },

    up: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (!exists) {
                console.log('    (인덱스가 이미 없다 — 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            ctx.db.run(
                ctx.db.raw('ALTER TABLE lookup DROP INDEX idx_lookup_ct, ' +
                           'ALGORITHM=INPLACE, LOCK=NONE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
