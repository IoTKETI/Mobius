'use strict';
// sub.nu / sub.enc 를 text 로.
//
// sub 테이블이 알림 라우팅의 원천이 되면(013 참조) 이 두 컬럼이 곧 발송 주소와
// 이벤트 조건이다. varchar(200) 은 URL 두세 개면 넘치고, varchar(45) 는 enc 에
// atr/om 필터를 넣으면 넘친다. 배포는 STRICT 라 넘치면 생성이 실패하지 조용히
// 잘리지는 않는다(실측 최대 nu 91 / enc 25). 원천 컬럼에 그런 상한을 둘 이유가 없다.
//
// COPY 알고리즘이라 테이블을 다시 쓴다 — sub 는 수천 행이라 즉시 끝난다.
// autoApply 는 붙이지 않는다(DDL 규칙, test/db-bootstrap.test.js). 배포 때
// node tools/migrate.js --apply
// SQLite 는 VARCHAR 폭을 강제하지 않아 할 일이 없다.
// 되돌리려면 ALTER TABLE sub MODIFY nu varchar(200), MODIFY enc varchar(45);
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
