'use strict';
// Index sub(pi).
//
// Notification routing reads the sub table by the parent ri (`select ... from sub where pi = ?`) on every write (docs/superpowers/specs/2026-09-05-notification-routing-source-design.md).
//
// No autoApply: index creation is DDL, which the boot path forbids (test/db-bootstrap.test.js) by kind, not by row count. Applied by hand at deployment: node tools/migrate.js --apply
//
// SQLite gets the index from mobiusdb_sqlite.sql's CREATE INDEX IF NOT EXISTS at boot.
// Rollback: DROP INDEX idx_sub_pi ON sub;
function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['sub', 'idx_sub_pi']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

module.exports = {
    id: '013-sub-pi-index',
    description: 'sub(pi) 인덱스 — 알림이 부모 ri 로 구독 행을 읽는다',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            cb(null, exists ? '이미 있음 — 적용하면 이력만 남긴다'
                            : '없음 — sub 는 수천 행이라 즉시 끝난다 (INPLACE, LOCK=NONE)');
        });
    },

    up: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (exists) {
                console.log('    (인덱스가 이미 있다 — 만들지 않고 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            // timeoutMs: 0, the convention of 001: the driver must not give up before the server finishes the DDL.
            ctx.db.run(
                ctx.db.raw('ALTER TABLE sub ADD INDEX idx_sub_pi (pi), ALGORITHM=INPLACE, LOCK=NONE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
