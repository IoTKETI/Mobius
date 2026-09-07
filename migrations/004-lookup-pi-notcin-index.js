'use strict';
// Adds the not_cin virtual column and the (pi, not_cin) index to lookup, reducing the discovery skeleton recursion from one UNION branch per type to a single branch.
//
// Inside a MySQL recursive CTE only ref (equality) access uses an index; IN, range and BETWEEN predicates on ty stop at pi and filter the rest. With (ty <> 4) as an indexed virtual column, 'not a CIN' becomes an equality and one branch suffices.
//
// ── INVISIBLE ──
// Without it `select *` returns one more column; resource reads use `select * from lookup where ri = ?` and put the row into the response body, so not_cin would appear in m2m:cnt responses. INVISIBLE columns need MySQL 8.0.23+.
//
// ── Two statements ──
// Adding the column and the index in one statement is refused with LOCK=NONE (ERROR 1846), and a functional index (pi, (ty <> 4)) is the same combination internally. As two statements both run with ALGORITHM=INPLACE, LOCK=NONE.
//
// ty <> 4 also admits SUB(23) / ACP(1) / GRP(9) into the skeleton; they have no children, so the result is unchanged and no type list has to be maintained.
//
// SQLite is not a target: it has no INVISIBLE column, and the facade emits `ty <> 4` for SQLite (notCinPredicate in mobius/db/sqlite.js).
//
// Rollback:
//   ALTER TABLE lookup DROP INDEX idx_lookup_pi_notcin;
//   ALTER TABLE lookup DROP COLUMN not_cin;

var INDEX_NAME = 'idx_lookup_pi_notcin';
var COL_NAME = 'not_cin';

function hasColumn(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.columns ' +
            'where table_schema = database() and table_name = ? and column_name = ?',
            ['lookup', COL_NAME]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

function isInvisible(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.columns ' +
            'where table_schema = database() and table_name = ? and column_name = ? ' +
            "and extra like '%INVISIBLE%'",
            ['lookup', COL_NAME]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

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

// timeoutMs: 0 disables the driver timeout: MySQL keeps running a DDL after the driver gives up, which would leave the index created but the ledger without a record.
function ddl(ctx, sql, cb) {
    ctx.db.run(ctx.db.raw(sql), ctx.conn, cb, { timeoutMs: 0 });
}

module.exports = {
    id: '004-lookup-pi-notcin-index',
    description: 'lookup(pi, not_cin) 인덱스 — discovery 골격 재귀가 분기 20개에서 1개로',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        hasColumn(ctx, function (err, col) {
            if (err) { return cb(err, null); }
            hasIndex(ctx, function (err2, idx) {
                if (err2) { return cb(err2, null); }
                if (col && idx) {
                    return isInvisible(ctx, function (err3, inv) {
                        if (err3) { return cb(err3, null); }
                        cb(null, inv ? '이미 있음 — 적용하면 이력만 남긴다'
                                     : '컬럼·인덱스는 있으나 not_cin 이 INVISIBLE 이 아니다 ' +
                                       '(응답에 샌다) — 적용하면 숨긴다');
                    });
                }

                ctx.db.run(
                    ctx.db.raw(
                        'select table_rows as n, round(data_length/1024/1024) as mb ' +
                        'from information_schema.tables ' +
                        'where table_schema = database() and table_name = ?', ['lookup']),
                    ctx.conn,
                    function (err3, trows) {
                        if (err3) { return cb(err3, trows); }
                        var t = (trows && trows[0]) || {};
                        var n = parseInt(t.n || 0, 10);
                        cb(null, (col ? '컬럼만 있음' : '없음') + ' — lookup 약 ' +
                            n.toLocaleString() + '행 / ' + (t.mb || '?') + 'MB. ' +
                            'ONLINE DDL(무중단)이지만 인덱스 빌드에 수십 분 걸릴 수 있다 ' +
                            '(001 은 같은 규모에서 20.6분)');
                    });
            });
        });
    },

    up: function (ctx, cb) {
        // 1) The virtual column. If it exists, only its INVISIBLE state is checked.
        hasColumn(ctx, function (err, col) {
            if (err) { return cb(err, col); }

            function step2() {
                // 2) The index. MySQL has no CREATE INDEX IF NOT EXISTS, and a re-run after a client timeout must not fail.
                hasIndex(ctx, function (err2, idx) {
                    if (err2) { return cb(err2, idx); }
                    if (idx) {
                        console.log('    (인덱스가 이미 있다 — 만들지 않는다)');
                        return cb(null, { affectedRows: 0 });
                    }
                    console.log('    인덱스 생성 중… 수십 분 걸릴 수 있다 (무중단)');
                    // The index name is a literal: the schema-drift test compares it with the declaration in mobiusdb.sql as a string.
                    ddl(ctx, 'ALTER TABLE lookup ADD INDEX idx_lookup_pi_notcin ' +
                             '(pi, not_cin), ALGORITHM=INPLACE, LOCK=NONE', cb);
                });
            }

            if (col) {
                // A column created visible is hidden.
                isInvisible(ctx, function (err2, inv) {
                    if (err2) { return cb(err2, inv); }
                    if (inv) { return step2(); }
                    console.log('    (not_cin 이 보이는 상태다 — INVISIBLE 로 바꾼다)');
                    ddl(ctx, 'ALTER TABLE lookup ALTER COLUMN not_cin SET INVISIBLE',
                        function (err3, r) {
                            if (err3) { return cb(err3, r); }
                            step2();
                        });
                });
                return;
            }

            // Column and index in one statement are refused with LOCK=NONE (ERROR 1846); they run separately.
            ddl(ctx, 'ALTER TABLE lookup ADD COLUMN not_cin ' +
                     'tinyint unsigned GENERATED ALWAYS AS (ty <> 4) VIRTUAL INVISIBLE, ' +
                     'ALGORITHM=INPLACE, LOCK=NONE',
                function (err2, r) {
                    if (err2) { return cb(err2, r); }
                    step2();
                });
        });
    }
};
