'use strict';
// Composite index lookup(pi, ty, ct).
//
// la / ol / discovery all select 'children of a parent, filtered by type, ordered by creation time'. InnoDB appends the PK columns to a secondary index, and the PK is (pi, ri, ty), so the index is stored as (pi, ty, ct, ri) and `order by ct desc, ri desc` is served without a sort.
//
// SQLite is not a target: mobiusdb_sqlite.sql creates idx_lookup_pi_ty_ct itself (IF NOT EXISTS); for a large existing SQLite DB, tools/sqlite-indexes.js creates it in advance.

// Whether lookup has idx_lookup_pi_ty_ct.
function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['lookup', 'idx_lookup_pi_ty_ct']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

function createIndex(ctx, cb) {
    // ALGORITHM=INPLACE, LOCK=NONE keeps reads and writes open while the index is built. Rollback: DROP INDEX idx_lookup_pi_ty_ct ON lookup;
    //
    // timeoutMs: 0 disables the driver timeout: MySQL keeps running a DDL after the driver gives up, which would leave the index created but the ledger without a record.
    ctx.db.run(
        ctx.db.raw('ALTER TABLE lookup ADD INDEX idx_lookup_pi_ty_ct (pi, ty, ct), ' +
                   'ALGORITHM=INPLACE, LOCK=NONE'),
        ctx.conn, cb, { timeoutMs: 0 });
}

module.exports = {
    id: '001-lookup-pi-ty-ct-index',
    description: 'lookup(pi, ty, ct) 복합 인덱스 — la/ol/discovery 가 ct 역스캔에서 벗어난다',
    backends: ['mysql'],

    // Read-only; the state shown by --check.
    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (exists) { return cb(null, '이미 있음 — 적용하면 이력만 남긴다'); }

            ctx.db.run(
                ctx.db.raw(
                    'select table_rows as n, round(data_length/1024/1024) as mb ' +
                    'from information_schema.tables ' +
                    'where table_schema = database() and table_name = ?', ['lookup']),
                ctx.conn,
                function (err2, trows) {
                    if (err2) { return cb(err2, trows); }
                    var t = (trows && trows[0]) || {};
                    var n = parseInt(t.n || 0, 10);
                    cb(null, '없음 — lookup 약 ' + n.toLocaleString() + '행 / ' +
                        (t.mb || '?') + 'MB. ONLINE DDL(무중단)이지만 수십 분 걸릴 수 있다');
                });
        });
    },

    up: function (ctx, cb) {
        // An existing index is skipped silently. MySQL has no CREATE INDEX IF NOT EXISTS, and a re-run after a client timeout must not fail with 'Duplicate key name'.
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (exists) {
                console.log('    (인덱스가 이미 있다 — 만들지 않고 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            createIndex(ctx, cb);
        });
    }
};
