'use strict';
// Makes lookup.sri UNIQUE (ri/sri design note docs/superpowers/specs/2026-09-06-ri-sri-design.md §3 A1).
//
// sri is the outward resourceID. The generator (short_ri) keeps it unique, but without a DB constraint a conflicting row (a user-supplied aei is an sri too) would enter silently.
//
// ── Order ──
// Duplicates must be zero (017). A remaining duplicate would fail the ALTER at its end, so up counts first and refuses (a full group by, minutes). The non-unique idx_lookup_sri is dropped in the same statement. INPLACE, LOCK=NONE, so writes are not blocked during the build; a duplicate arriving during the build fails the ALTER (the generator prevents it).
//
// No autoApply (DDL). SQLite is not a target: a duplicate in an old development DB would make the schema's CREATE UNIQUE INDEX fail at boot, so development DBs keep the non-unique index, and the generator plus test/lookup-sri-dedupe keep uniqueness.
// Rollback: ALTER TABLE lookup ADD INDEX idx_lookup_sri (sri), DROP INDEX idx_lookup_sri_unique

function hasUnique(ctx, cb) {
    ctx.db.run(ctx.db.raw(
        'select count(*) as n from information_schema.statistics' +
        " where table_schema = database() and table_name = 'lookup' and index_name = 'idx_lookup_sri_unique'"),
        ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n || rows[0].N, 10) > 0));
        });
}

function duplicates(ctx, cb) {
    ctx.db.run(ctx.db.raw('select count(*) as n from (select sri from lookup group by sri having count(*) > 1) t'),
        ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, parseInt((rows && rows[0] && (rows[0].n || rows[0].N)) || 0, 10));
        }, { timeoutMs: 0 });
}

module.exports = {
    id: '019-lookup-sri-unique',
    description: 'lookup.sri UNIQUE — 017 뒤 중복 0 일 때만. 비유일 idx_lookup_sri 는 같은 문장에서 제거 (INPLACE, LOCK=NONE)',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        hasUnique(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (exists) { return cb(null, '이미 UNIQUE — 적용하면 이력만 남긴다'); }
            duplicates(ctx, function (derr, n) {
                if (derr) { return cb(derr, null); }
                cb(null, n > 0
                    ? '중복 sri 묶음 ' + n + ' — 먼저 017 을 적용해야 한다. 지금 걸면 ALTER 가 실패한다'
                    : '중복 0 — UNIQUE 를 걸 수 있다 (INPLACE, LOCK=NONE, 6,200만 행 빌드 수십 분)');
            });
        });
    },

    up: function (ctx, cb) {
        hasUnique(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (exists) {
                console.log('    (이미 UNIQUE — 만들지 않고 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            duplicates(ctx, function (derr, n) {
                if (derr) { return cb(derr, n); }
                if (n > 0) {
                    return cb(true, { code: 'DUPLICATES', message: '중복 sri 묶음 ' + n + ' — 017 을 먼저 적용하라' });
                }
                ctx.db.run(
                    ctx.db.raw('ALTER TABLE lookup ADD UNIQUE INDEX idx_lookup_sri_unique (sri), DROP INDEX idx_lookup_sri, ALGORITHM=INPLACE, LOCK=NONE'),
                    ctx.conn, function (aerr, ares) {
                        if (aerr) { return cb(aerr, ares); }
                        cb(null, { affectedRows: 1 });
                    }, { timeoutMs: 0 });
            });
        });
    }
};
