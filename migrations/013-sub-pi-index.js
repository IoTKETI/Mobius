'use strict';
// sub(pi) 인덱스.
//
// 알림 라우팅의 원천을 lookup.subl 사본에서 sub 테이블로 옮긴다
// (docs/superpowers/specs/2026-09-05-notification-routing-source-design.md).
// 그러면 쓰기마다 `select ... from sub where pi = ?` 가 한 번 돈다.
// 배포 실측(2026-09-05): sub 3,463행, pi 인덱스 없이는 풀스캔 2.48ms, PK 조회 0.35ms.
//
// autoApply 를 붙이지 않는다 — 인덱스 생성은 DDL 종류로 기동 경로에서 금지된다
// (test/db-bootstrap.test.js). 3,463행이라 즉시 끝나지만 규칙은 행 수가 아니라
// 종류로 정한다. 배포 때 손으로 적용한다: node tools/migrate.js --apply
//
// SQLite 는 mobiusdb_sqlite.sql 의 CREATE INDEX IF NOT EXISTS 가 기동 때 만든다.
// 되돌리려면 DROP INDEX idx_sub_pi ON sub;
function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['sub', 'idx_sub_pi']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

module.exports = {
    id: '013-sub-pi-index',
    description: 'sub(pi) 인덱스 — 알림이 부모 ri 로 구독 행을 읽는다',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            cb(null, exists ? '이미 있음 — 적용하면 이력만 남긴다'
                            : '없음 — sub 는 수천 행이라 즉시 끝난다 (INPLACE, LOCK=NONE)');
        });
    },

    up: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (exists) {
                console.log('    (인덱스가 이미 있다 — 만들지 않고 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            // timeoutMs: 0 — 001 과 같은 관례. 드라이버가 먼저 끊으면 러너는 실패로
            // 보고하는데 서버는 DDL 을 끝내는 어긋난 상태가 된다.
            ctx.db.run(
                ctx.db.raw('ALTER TABLE sub ADD INDEX idx_sub_pi (pi), ALGORITHM=INPLACE, LOCK=NONE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
