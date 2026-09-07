'use strict';
// Makes idx_lookup_ct INVISIBLE: an observation step before dropping it.
//
// Every query that filters or sorts lookup by ct also has pi (usually ty) and is served by idx_lookup_pi_ty_ct (discovery's la sort, delete_oldest, select_edge_resource); nothing accesses ct alone. The expiry sweep uses et.
//
// An INVISIBLE index is maintained but not used by the optimizer, so it imitates the dropped state without risk and can be made VISIBLE again in a second, whereas re-creating a dropped index takes a long rebuild. After an observation period 006 drops it.
//
// Rollback:
//   ALTER TABLE lookup ALTER INDEX idx_lookup_ct VISIBLE;
//
// Observation (a day or more after applying):
//   select ifnull(index_name,'(TABLE SCAN)'), count_read
//     from performance_schema.table_io_waits_summary_by_index_usage
//    where object_schema='mobiusdb' and object_name='lookup'
//    order by count_read desc;
// When idx_lookup_ct stays at 0 and response times are unchanged, apply 006.
//
// SQLite is not a target: mobiusdb_sqlite.sql has no ct-only index.

var INDEX_NAME = 'idx_lookup_ct';

function indexState(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select is_visible from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ? limit 1',
            ['lookup', INDEX_NAME]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            if (!rows || !rows.length) { return cb(null, 'none'); }
            // MySQL 8 returns 'YES' / 'NO'
            cb(null, String(rows[0].IS_VISIBLE || rows[0].is_visible) === 'NO'
                ? 'invisible' : 'visible');
        });
}

module.exports = {
    id: '005-lookup-ct-index-invisible',
    description: 'idx_lookup_ct 를 INVISIBLE 로 — 40.6시간 동안 읽기 0회, 지우기 전 관찰',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        indexState(ctx, function (err, st) {
            if (err) { return cb(err, null); }
            if (st === 'none') { return cb(null, '인덱스가 이미 없다 — 적용하면 이력만 남긴다'); }
            if (st === 'invisible') { return cb(null, '이미 INVISIBLE — 적용하면 이력만 남긴다'); }

            ctx.db.run(
                ctx.db.raw(
                    'select count_read from performance_schema.table_io_waits_summary_by_index_usage ' +
                    'where object_schema = database() and object_name = ? and index_name = ?',
                    ['lookup', INDEX_NAME]),
                ctx.conn,
                function (err2, rows) {
                    // performance_schema may return column names in upper case.
                    var r = (!err2 && rows && rows[0]) ? rows[0] : {};
                    var reads = (r.count_read !== undefined) ? r.count_read : r.COUNT_READ;
                    cb(null, 'VISIBLE — 서버 기동 이후 읽기 ' +
                        (reads === null || reads === undefined ? '?' : reads) +
                        '회. INVISIBLE 로 바꾸면 옵티마이저가 안 쓴다 (즉시, 되돌리기 1초)');
                });
        });
    },

    up: function (ctx, cb) {
        indexState(ctx, function (err, st) {
            if (err) { return cb(err, st); }
            if (st === 'none') {
                console.log('    (인덱스가 이미 없다 — 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            if (st === 'invisible') {
                console.log('    (이미 INVISIBLE — 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            // Metadata only; the index is kept, so the rollback is instant.
            ctx.db.run(
                ctx.db.raw('ALTER TABLE lookup ALTER INDEX idx_lookup_ct INVISIBLE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
