'use strict';
// Widens cb.srt from varchar(100) to varchar(255).
//
// srt (supportedResourceType) is the list the CSEBase advertises. It is now the full ty_list, whose serialised form exceeds 100 characters; with STRICT_TRANS_TABLES the CSEBase update would fail instead of truncating. 255 leaves room for more types. test/removed-types.test.js compares the declared width with the serialised ty_list length.
//
// cb has one row, so the change completes at once; widening keeps existing values.
//
// Rollback:
//   ALTER TABLE cb MODIFY srt varchar(100) NOT NULL;
//   (after checking that the stored srt is at most 100 characters)

var TARGET = 'varchar(255)';

function currentType(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select column_type as t from information_schema.columns ' +
            'where table_schema = database() and table_name = ? and column_name = ?',
            ['cb', 'srt']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows && rows[0]) ? String(rows[0].t) : null);
        });
}

module.exports = {
    id: '009-widen-cb-srt',
    description: 'cb.srt 를 varchar(255) 로 넓힌다 — srt 를 ty_list 로 통일하면 105자가 된다',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        currentType(ctx, function (err, t) {
            if (err) { return cb(err, null); }
            if (t === null) { return cb(null, 'cb.srt 컬럼이 없다'); }
            if (t.toLowerCase() === TARGET) {
                return cb(null, '이미 ' + TARGET + ' — 적용하면 이력만 남긴다');
            }
            ctx.db.run(ctx.db.raw('select char_length(srt) as n from cb'), ctx.conn,
                function (err2, rows) {
                    if (err2) { return cb(err2, rows); }
                    var n = (rows && rows[0]) ? rows[0].n : '?';
                    cb(null, '지금 ' + t + ', 저장된 값 ' + n + '자 — ' + TARGET +
                        ' 로 넓힌다 (cb 는 1행이라 즉시 끝난다)');
                });
        });
    },

    up: function (ctx, cb) {
        currentType(ctx, function (err, t) {
            if (err) { return cb(err, t); }
            if (t !== null && t.toLowerCase() === TARGET) {
                console.log('    (이미 ' + TARGET + ' 이다 — 넘어간다)');
                return cb(null, { affectedRows: 0 });
            }
            // A widening change runs as INPLACE / LOCK=NONE. timeoutMs: 0, as in 004 (the driver must not give up before the server finishes the DDL); this one completes at once.
            ctx.db.run(
                ctx.db.raw('ALTER TABLE cb MODIFY srt varchar(255) NOT NULL, ' +
                           'ALGORITHM=INPLACE, LOCK=NONE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
