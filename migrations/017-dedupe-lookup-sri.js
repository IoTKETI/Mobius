'use strict';
// Deduplicates lookup.sri (ri/sri design note docs/superpowers/specs/2026-09-06-ri-sri-design.md §3 A1).
//
// The former sri generator appended three random digits to `ty-YYYYMMDDHHmmssSSS`, and workers generating in the same millisecond could collide; the non-unique idx_lookup_sri did not prevent it, and two resources then exposed the same resourceID. The generator is now mobius/short_ri.js; this cleans up the remaining rows.
//
// ── What it does ──
// In each group the first row in (ct, ri) order keeps its sri and the others get a new one. Children of a re-keyed row have their spi (the parent's short id) updated as well: `pi = that row.ri and spi = old sri`, which uses the PK prefix. AE (ty=2) rows are not touched, because their sri is the aei, which has its own UNIQUE constraint in ae; CSEBase (ty=5) likewise. Both are reported only.
//
// The full `group by sri` uses only the index but takes minutes on a large table (timeoutMs 0). A data-changing migration, so no autoApply. The UNIQUE index is added by a separate DDL (019) once this reports zero groups.

var short_ri = require('../mobius/short_ri');

var UNTOUCHED = { 2: 'AE', 5: 'CSEBase' };

function groups(ctx, cb) {
    ctx.db.run(ctx.db.raw('select sri, count(*) as n from lookup group by sri having count(*) > 1'), ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows || []).map(function (r) { return { sri: r.sri || r.SRI, n: parseInt(r.n || r.N, 10) }; }));
        }, { timeoutMs: 0 });
}

function members(ctx, sri, cb) {
    ctx.db.run(ctx.db.raw('select ri, ty, ct from lookup where sri = ? order by ct asc, ri asc', [sri]), ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows || []).map(function (r) {
                return { ri: r.ri || r.RI, ty: parseInt(r.ty || r.TY, 10), ct: r.ct || r.CT };
            }));
        });
}

// Classifies the groups: to re-key, or to report only.
function classify(ctx, list, cb) {
    var out = { rekey: [], untouched: [] };
    (function next(i) {
        if (i >= list.length) { return cb(null, out); }
        members(ctx, list[i].sri, function (err, rows) {
            if (err) { return cb(err, rows); }
            var kind = null;
            rows.forEach(function (r) { if (UNTOUCHED[r.ty]) { kind = UNTOUCHED[r.ty]; } });
            if (kind) { out.untouched.push({ sri: list[i].sri, kind: kind, n: rows.length }); }
            else { out.rekey.push({ sri: list[i].sri, rows: rows }); }
            next(i + 1);
        });
    })(0);
}

module.exports = {
    id: '017-dedupe-lookup-sri',
    description: 'lookup.sri 중복 정리 — 묶음마다 (ct, ri) 순 첫 행을 남기고 나머지에 새 sri, 자식 spi 도 따라감',
    backends: ['mysql', 'sqlite'],

    inspect: function (ctx, cb) {
        groups(ctx, function (err, list) {
            if (err) { return cb(err, null); }
            if (list.length === 0) { return cb(null, '중복 sri 없음 — 적용하면 이력만 남긴다'); }
            classify(ctx, list, function (err2, c) {
                if (err2) { return cb(err2, null); }
                var rows = list.reduce(function (s, g) { return s + g.n; }, 0);
                var lines = ['중복 sri 묶음 ' + list.length + ' (행 ' + rows + ') — 다시 매길 묶음 ' + c.rekey.length +
                             ', 손대지 않을 AE·CSEBase 묶음 ' + c.untouched.length];
                c.rekey.slice(0, 5).forEach(function (g) {
                    lines.push('  ' + g.sri + ' x' + g.rows.length + ' — 남김 ' + g.rows[0].ri);
                });
                c.untouched.forEach(function (u) { lines.push('  ' + u.sri + ' x' + u.n + ' — ' + u.kind + ', 손대지 않는다'); });
                cb(null, '\n' + lines.join('\n'));
            });
        });
    },

    up: function (ctx, cb) {
        groups(ctx, function (err, list) {
            if (err) { return cb(err, list); }
            classify(ctx, list, function (err2, c) {
                if (err2) { return cb(err2, c); }
                c.untouched.forEach(function (u) {
                    console.log('    손대지 않는다: ' + u.sri + ' x' + u.n + ' (' + u.kind + ' — sri 가 aei/CSEBase id)');
                });
                var rekeyed = 0, children = 0;
                var work = [];
                c.rekey.forEach(function (g) {
                    g.rows.slice(1).forEach(function (r) { work.push({ row: r, old: g.sri }); });
                });
                (function next(i) {
                    if (i >= work.length) {
                        if (rekeyed) { console.log('    sri 다시 매김 ' + rekeyed + '행, 자식 spi 갱신 ' + children + '행'); }
                        return cb(null, { affectedRows: rekeyed, children: children, untouched: c.untouched.length });
                    }
                    var w = work[i];
                    var fresh = short_ri.generate(w.row.ty + '-');
                    ctx.db.run(ctx.db.raw('update lookup set sri = ? where ri = ? and sri = ?', [fresh, w.row.ri, w.old]), ctx.conn,
                        function (uerr, ures) {
                            if (uerr) { return cb(uerr, ures); }
                            rekeyed += (ures && ures.affectedRows) || 0;
                            ctx.db.run(ctx.db.raw('update lookup set spi = ? where pi = ? and spi = ?', [fresh, w.row.ri, w.old]), ctx.conn,
                                function (cerr, cres) {
                                    if (cerr) { return cb(cerr, cres); }
                                    children += (cres && cres.affectedRows) || 0;
                                    next(i + 1);
                                });
                        });
                })(0);
            });
        });
    }
};
