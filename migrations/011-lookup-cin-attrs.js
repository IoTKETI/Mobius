'use strict';
// Adds the cs / cnf columns to lookup. Values are not filled here; 012 confirms the backfill.
//
// Discovery's sza / szb / cty read cin's columns (cs, cnf) while discovery itself filters by scanning lookup indexes, so these filters had to probe cin once per candidate. With the copies in lookup, filtering is a CPU check on a row that is already being read.
//
// ── INSTANT ──
// From MySQL 8.0.12, adding a column at the end of the row does not rewrite the table. ALGORITHM=INSTANT is stated explicitly: without it the server silently falls back to INPLACE or COPY when the conditions are not met and rewrites the whole table; with it that case is an error.
//
// ── Values are not filled here ──
// Filling every CIN row is a different kind of job; on the boot path it would stall a restart for hours. 012 handles it and has no autoApply.
//
// Rollback:
//   ALTER TABLE lookup DROP COLUMN cs, DROP COLUMN cnf;
// (DROP is not INSTANT and rewrites the table.)

var COLS = [
    { name: 'cs',  ddl: 'add column `cs` int default null' },
    { name: 'cnf', ddl: 'add column `cnf` varchar(45) default null' }
];

function missing(ctx, cb) {
    ctx.db.run(ctx.db.raw(
        'select column_name as n from information_schema.columns' +
        " where table_schema = database() and table_name = 'lookup'" +
        " and column_name in ('cs','cnf')"),
        ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            var have = {};
            (rows || []).forEach(function (r) { have[r.n || r.N] = true; });
            cb(null, COLS.filter(function (c) { return !have[c.name]; }));
        });
}

module.exports = {
    id: '011-lookup-cin-attrs',
    description: 'lookup 에 cs / cnf 컬럼 추가 (INSTANT). 값은 012 가 채운다',
    backends: ['mysql'],

    // Safe to apply automatically at boot: INSTANT ADD COLUMN completes at once regardless of data volume (metadata only), like 010 (SET PERSIST). 012 (the backfill check) must never carry this flag.
    autoApply: true,

    inspect: function (ctx, cb) {
        missing(ctx, function (err, need) {
            if (err) { return cb(err, need); }
            if (need.length === 0) {
                return cb(null, '\n  cs / cnf 둘 다 이미 있다');
            }
            cb(null, '\n  더할 컬럼: ' + need.map(function (c) { return c.name; }).join(', ') +
                     '\n  INSTANT 라 즉시 끝난다 (테이블을 다시 쓰지 않는다)' +
                     '\n  * 값은 비어 있다 — 012 가 채우기 전까지 discovery 는 이 컬럼을 쓰지 않는다');
        });
    },

    up: function (ctx, cb) {
        missing(ctx, function (err, need) {
            if (err) { return cb(err, need); }
            if (need.length === 0) { return cb(null, { affectedRows: 0 }); }

            // Both columns in one statement: INSTANT is per statement, and two statements would allow a half-applied state.
            var sql = 'alter table `lookup` ' +
                need.map(function (c) { return c.ddl; }).join(', ') +
                ', algorithm=instant';

            // timeoutMs: 0, as in 001 and 004: the driver must not give up before the server finishes the DDL. INSTANT completes at once; the convention is kept.
            ctx.db.run(ctx.db.raw(sql), ctx.conn, function (aerr, ares) {
                if (aerr) {
                    console.error('    ALTER 실패: ' +
                        ((ares && (ares.sqlMessage || ares.message)) || ares));
                    console.error('    ALGORITHM=INSTANT 를 못 쓰면 서버가 거절한다 —' +
                                  ' MySQL 8.0.12 이상인지 확인할 것');
                    return cb(aerr, ares);
                }
                console.log('    lookup 에 ' + need.map(function (c) { return c.name; }).join(', ') +
                            ' 추가 (INSTANT)');
                cb(null, { affectedRows: need.length });
            });
        });
    }
};
