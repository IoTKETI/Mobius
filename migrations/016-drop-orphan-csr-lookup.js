'use strict';
// Removes orphan remoteCSE (ty=16) rows from lookup.
//
// The csr table has an ON DELETE CASCADE foreign key on lookup(ri), so deleting a lookup row removes its csr row, but not the other way round: a csr row deleted alone leaves a ty=16 row in lookup. Reading such a row yields a half row, and update_route (fanOutPoint, group creation) never sees it because it reads csr.
//
// ── What is deleted ──
// Only ty=16 lookup rows that have no csr row and no children. Rows with children are kept and reported by inspect (deleting a parent would orphan its children). No names are hard-coded; the migration can be re-run if the same cause recurs.
//
// A data-deleting migration, so no autoApply. The SQLite schema has no csr table, so SQLite is not a target.

// All three steps use indexes only: ty=16 via idx_lookup_ty, csr via its PK, and the child count via the PK prefix (pi). A single statement (lookup LEFT JOIN csr with a correlated subquery) tends to a full scan on a large lookup; three simple queries are cheaper for a handful of rows.
function orphans(ctx, cb) {
    ctx.db.run(ctx.db.raw('select ri, ct from lookup where ty = 16'), ctx.conn, function (err, rows) {
        if (err) { return cb(err, rows); }
        var cands = (rows || []).map(function (r) { return { ri: r.ri || r.RI, ct: r.ct || r.CT, kids: 0 }; });
        if (cands.length === 0) { return cb(null, []); }
        ctx.db.run(ctx.db.raw('select ri from csr where ri in (' + cands.map(function () { return '?'; }).join(', ') + ')',
                              cands.map(function (c) { return c.ri; })),
            ctx.conn, function (err2, have) {
                if (err2) { return cb(err2, have); }
                var has = {};
                (have || []).forEach(function (h) { has[h.ri || h.RI] = true; });
                var orphan = cands.filter(function (c) { return !has[c.ri]; });
                (function next(i) {
                    if (i >= orphan.length) { return cb(null, orphan); }
                    ctx.db.run(ctx.db.raw('select count(*) as n from lookup where pi = ?', [orphan[i].ri]), ctx.conn,
                        function (err3, k) {
                            if (err3) { return cb(err3, k); }
                            orphan[i].kids = parseInt((k && k[0] && (k[0].n || k[0].N)) || 0, 10);
                            next(i + 1);
                        });
                })(0);
            });
    });
}

module.exports = {
    id: '016-drop-orphan-csr-lookup',
    description: 'lookup 의 remoteCSE(ty=16) 고아 행 제거 — csr 행이 없고 자식이 없는 것만',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        orphans(ctx, function (err, list) {
            if (err) { return cb(err, null); }
            if (list.length === 0) { return cb(null, '고아 없음 — 적용하면 이력만 남긴다'); }
            cb(null, '\n' + list.map(function (o) {
                return '  ' + o.ri + ' (등록 ' + o.ct + ', 자식 ' + o.kids + (o.kids ? ' — 남긴다' : ' — 지운다') + ')';
            }).join('\n'));
        });
    },

    up: function (ctx, cb) {
        orphans(ctx, function (err, list) {
            if (err) { return cb(err, list); }
            var targets = list.filter(function (o) { return o.kids === 0; });
            var kept = list.filter(function (o) { return o.kids > 0; });
            kept.forEach(function (o) { console.log('    자식이 있어 남긴다: ' + o.ri + ' (자식 ' + o.kids + ')'); });
            if (targets.length === 0) { return cb(null, { affectedRows: 0 }); }
            (function next(i, done) {
                if (i >= targets.length) {
                    console.log('    lookup 의 ty=16 고아 ' + done + '행 삭제');
                    return cb(null, { affectedRows: done });
                }
                ctx.db.run(ctx.db.raw('delete from lookup where ri = ? and ty = 16', [targets[i].ri]), ctx.conn,
                    function (derr, dres) {
                        if (derr) { return cb(derr, dres); }
                        next(i + 1, done + ((dres && dres.affectedRows) || 0));
                    });
            })(0, 0);
        });
    }
};
