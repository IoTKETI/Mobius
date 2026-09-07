'use strict';
// Drops the lookup.subl column.
//
// subl was a JSON copy of the child <subscription>s kept on the parent row and the source of the notification delivery list. The source is now the sub table (013, 014, sgn.js) and the copy machinery is gone, so nothing reads or writes this column. Spec: docs/superpowers/specs/2026-09-05-notification-routing-source-design.md
//
// ── INSTANT ──
// From MySQL 8.0.29 DROP COLUMN is INSTANT: metadata only, no table rewrite. ALGORITHM=INSTANT is stated explicitly so the server refuses when the conditions are not met (FULLTEXT, COMPRESSED, a column in an index) instead of silently rewriting the table.
//
// No autoApply (DDL rule, test/db-bootstrap.test.js). At deployment: node tools/migrate.js --check, then --apply. Rollback:
//   ALTER TABLE lookup ADD COLUMN subl mediumtext, ALGORITHM=INSTANT;
// The values do not come back.
//
// ── SQLite ──
// A new DB is created without the column by mobiusdb_sqlite.sql. An existing DB is altered here with SQLite 3.35+ DROP COLUMN; the code no longer filters the column out, so on an old DB `select *` would leak subl into responses. Development DBs: node tools/migrate.js --apply sqlite.

function hasColumn(ctx, cb) {
    var sql = (ctx.backend === 'sqlite')
        ? "select count(*) as n from pragma_table_info('lookup') where name = 'subl'"
        : "select count(*) as n from information_schema.columns" +
          " where table_schema = database() and table_name = 'lookup' and column_name = 'subl'";
    ctx.db.run(ctx.db.raw(sql), ctx.conn, function (err, rows) {
        if (err) { return cb(err, rows); }
        cb(null, !!(rows && rows[0] && parseInt(rows[0].n || rows[0].N, 10) > 0));
    });
}

module.exports = {
    id: '015-drop-lookup-subl',
    description: 'lookup.subl 컬럼 제거 — 알림 원천이 sub 테이블로 옮겨져 아무도 읽지 않는다 (INSTANT)',
    backends: ['mysql', 'sqlite'],

    inspect: function (ctx, cb) {
        hasColumn(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (!exists) { return cb(null, '이미 없음 — 적용하면 이력만 남긴다'); }
            cb(null, (ctx.backend === 'sqlite')
                ? '있음 — DROP COLUMN (SQLite 3.35+, 작은 DB 라 즉시)'
                : '있음 — ALGORITHM=INSTANT 라 행 수와 무관하게 즉시 끝난다. 조건이 안 맞으면 서버가 거절한다(재작성하지 않는다)');
        });
    },

    up: function (ctx, cb) {
        hasColumn(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (!exists) {
                console.log('    (컬럼이 이미 없다 — 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            var sql = (ctx.backend === 'sqlite')
                ? 'ALTER TABLE lookup DROP COLUMN subl'
                : 'ALTER TABLE lookup DROP COLUMN subl, ALGORITHM=INSTANT';
            // timeoutMs: 0, the convention of 001 and 011: INSTANT completes at once, but the driver must never give up before the server finishes.
            ctx.db.run(ctx.db.raw(sql), ctx.conn, function (aerr, ares) {
                if (aerr) {
                    console.error('    ALTER 실패: ' + ((ares && (ares.sqlMessage || ares.message)) || ares));
                    if (ctx.backend !== 'sqlite') {
                        console.error('    ALGORITHM=INSTANT 를 못 쓰면 서버가 거절한다 — 재작성(COPY/INPLACE)으로 ' +
                                      '떨어뜨리지 않는다. 조건(8.0.29+, FULLTEXT 없음, 인덱스 밖 컬럼)을 확인할 것');
                    }
                    return cb(aerr, ares);
                }
                console.log('    lookup.subl 제거 (' + (ctx.backend === 'sqlite' ? 'SQLite' : 'INSTANT') + ')');
                cb(null, { affectedRows: 1 });
            }, { timeoutMs: 0 });
        });
    }
};
