'use strict';
// Changes the collation of identifier and name columns to utf8mb3_bin and widens rn, sri and spi to 200 (ri/sri design note §3 A3, A4).
//
// lookup.ri is utf8mb3_bin (case-sensitive) while pi, sri, spi, rn, lbl, acpi, ae.aei, the CSE-ID (csi) and the creator (cr) were utf8mb3_general_ci. Per oneM2M, identifiers and names compare byte for byte: children of siblings differing only in case no longer mix under `pi = ?`, `?rn=` filters match exactly, and `pi = ri` joins need no collation conversion. poa and nu are addresses (hostnames are case-insensitive) and stay; every table's cr is found via information_schema.
//
// ── Widening ──
// rn, sri and spi go from 45 to 200. oneM2M defines no length; the limit is this CSE's storage. ri stays at 200 (PK/FK width). The code limit (mobius/name_limits.js) is raised to 200 only after this is applied; code ahead of the schema produces DB errors.
//
// ── Cost ──
// lookup.pi is the leading column of PRIMARY KEY (pi, ri, ty), so the MODIFY rewrites the whole table; cin is rewritten as well (pi is in its PK, and cr rides in the same statement). The other tables are instant. Hence no autoApply, and --apply only by the user's decision in a maintenance window. A fresh install already has this shape from mobius/db/mobiusdb.sql (test/schema-drift.test.js).
//
// Type (varchar width) and nullability are read from information_schema and kept, except for the three widened columns.

var WANT = 'utf8mb3_bin';
var LOOKUP_COLS = ['acpi', 'lbl', 'pi', 'rn', 'spi', 'sri'];
var WIDEN = { 'lookup.rn': 'varchar(200)', 'lookup.sri': 'varchar(200)', 'lookup.spi': 'varchar(200)' };

function columns(ctx, cb) {
    var where = "(table_name = 'lookup' and column_name in (" + LOOKUP_COLS.map(function (c) { return "'" + c + "'"; }).join(', ') + '))' +
                " or (table_name = 'ae' and column_name = 'aei')" +
                " or (table_name = 'cb' and column_name = 'csi')" +
                " or (table_name = 'csr' and column_name in ('csi', 'cb'))" +
                " or (table_name = 'cin' and column_name = 'pi')" +
                " or (table_name = 'sub' and column_name = 'pi')" +
                " or column_name = 'cr'";
    ctx.db.run(ctx.db.raw(
        'select table_name as t, column_name as c, column_type as ty, is_nullable as nul, collation_name as coll' +
        " from information_schema.columns where table_schema = database() and data_type = 'varchar' and (" + where + ')' +
        ' order by table_name, column_name'), ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows || []).map(function (r) {
                return { table: r.t || r.T, col: r.c || r.C, type: String(r.ty || r.TY).toLowerCase(),
                         nullable: String(r.nul || r.NUL).toUpperCase() === 'YES', coll: String(r.coll || r.COLL || '') };
            }));
        });
}

function wanted_type(c) { return WIDEN[c.table + '.' + c.col] || c.type; }
function needs_change(c) { return c.coll !== WANT || wanted_type(c) !== c.type; }

function plan(cols) {
    var order = [], by = {};
    cols.forEach(function (c) {
        if (!needs_change(c)) { return; }
        if (!by[c.table]) { by[c.table] = []; order.push(c.table); }
        by[c.table].push(c);
    });
    return order.map(function (t) {
        return { table: t, sql: 'ALTER TABLE ' + t + ' ' + by[t].map(function (c) {
            return 'MODIFY ' + c.col + ' ' + wanted_type(c) + ' CHARACTER SET utf8mb3 COLLATE ' + WANT + (c.nullable ? ' NULL' : ' NOT NULL');
        }).join(', ') };
    });
}

module.exports = {
    id: '018-id-columns-collation-bin',
    description: '식별자·이름 컬럼(lookup pi/sri/spi/rn/lbl/acpi · ae.aei · csi · 모든 cr · cin.pi · sub.pi)을 utf8mb3_bin 으로, rn·sri·spi 는 200 으로 (표 재작성, 점검 창)',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        columns(ctx, function (err, cols) {
            if (err) { return cb(err, null); }
            var todo = plan(cols);
            if (todo.length === 0) { return cb(null, '전부 ' + WANT + ' 이고 rn·sri·spi 가 200 — 이미 맞다'); }
            var lines = cols.map(function (c) {
                var s = '  ' + c.table + '.' + c.col + ' ' + c.coll;
                if (c.coll !== WANT) { s += ' → ' + WANT; }
                if (wanted_type(c) !== c.type) { s += ' · ' + c.type + ' → ' + wanted_type(c); }
                return s;
            });
            lines.push('  바꿀 표 ' + todo.length + ' — lookup · cin 은 표 전체를 다시 쓴다(시간 단위). 점검 창에서 --apply');
            cb(null, '\n' + lines.join('\n'));
        });
    },

    up: function (ctx, cb) {
        columns(ctx, function (err, cols) {
            if (err) { return cb(err, cols); }
            var todo = plan(cols);
            (function next(i, done) {
                if (i >= todo.length) { return cb(null, { affectedRows: done }); }
                console.log('    ' + todo[i].sql);
                ctx.db.run(ctx.db.raw(todo[i].sql), ctx.conn, function (aerr, ares) {
                    if (aerr) { return cb(aerr, ares); }
                    next(i + 1, done + 1);
                }, { timeoutMs: 0 });
            })(0, 0);
        });
    }
};
