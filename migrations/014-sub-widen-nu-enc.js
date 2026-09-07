'use strict';
// sub.nu / sub.enc become text.
//
// With sub as the source of notification routing (see 013) these two columns are the delivery addresses and the event conditions. varchar(200) overflows with a few URLs and varchar(45) with atr/om filters in enc; under STRICT mode an overflow fails the creation. The source columns get no width limit.
//
// COPY algorithm (table rewrite); sub is small, so it completes at once. No autoApply (DDL rule, test/db-bootstrap.test.js); applied at deployment with node tools/migrate.js --apply
// SQLite does not enforce VARCHAR widths, so there is nothing to do.
// Rollback: ALTER TABLE sub MODIFY nu varchar(200), MODIFY enc varchar(45);
function types(ctx, cb) {
    ctx.db.run(ctx.db.raw(
        'select column_name as n, data_type as t from information_schema.columns' +
        " where table_schema = database() and table_name = 'sub' and column_name in ('nu','enc')"),
        ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            var t = {};
            (rows || []).forEach(function (r) { t[r.n || r.N] = String(r.t || r.T).toLowerCase(); });
            cb(null, t);
        });
}

module.exports = {
    id: '014-sub-widen-nu-enc',
    description: 'sub.nu / sub.enc 를 text 로 — 원천 컬럼에 폭 상한을 두지 않는다',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        types(ctx, function (err, t) {
            if (err) { return cb(err, null); }
            cb(null, 'nu=' + (t.nu || '?') + ' enc=' + (t.enc || '?') +
                     ((t.nu === 'text' && t.enc === 'text') ? ' — 이미 text' : ' — text 로 바꾼다 (수천 행, 즉시)'));
        });
    },

    up: function (ctx, cb) {
        types(ctx, function (err, t) {
            if (err) { return cb(err, t); }
            if (t.nu === 'text' && t.enc === 'text') { return cb(null, { affectedRows: 0 }); }
            ctx.db.run(ctx.db.raw('ALTER TABLE sub MODIFY nu text, MODIFY enc text'),
                       ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
