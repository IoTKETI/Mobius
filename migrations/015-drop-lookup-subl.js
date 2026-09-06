'use strict';
// lookup.subl 컬럼 제거.
//
// ── 왜 지우나 ────────────────────────────────────────────────────────────
// subl 은 부모 행에 자식 <subscription> 들을 심어 둔 JSON 사본이었고, 알림 발송
// 목록의 원천이었다. 사본을 지키는 장치(트랜잭션 잠금 갱신 · 되만드는 도구)가
// 통째로 있었는데도 어긋났다 — 유령 9,475건. 2026-09-05 에 원천을 sub 테이블로
// 옮겼고(013·014, sgn.js) 2026-09-06 에 사본 장치를 걷었다. 이제 이 컬럼은 읽는
// 이도 쓰는 이도 없다. 배포 기준 7.79MB 가 lookup 행마다 실려 다닐 이유가 없다.
// 스펙: docs/superpowers/specs/2026-09-05-notification-routing-source-design.md
//
// ── 왜 INSTANT 인가 ─────────────────────────────────────────────────────
// MySQL 8.0.29 부터 DROP COLUMN 도 INSTANT 다 — 테이블을 다시 쓰지 않고 메타데이터만
// 바꾼다(행 버전을 하나 올린다). 배포는 8.0.46, lookup 은 5,740만 행 / 22GB 라
// 재작성은 수십 분이고 그동안 CIN 쓰기가 막힌다. **ALGORITHM=INSTANT 를 명시한다** —
// 조건이 안 맞으면(FULLTEXT · COMPRESSED · 인덱스에 든 컬럼 등) 서버가 거절하므로
// 우리가 모르는 사이에 재작성이 시작되지 않는다. 배포 실측: Dynamic 행 형식,
// 단독 테이블스페이스, FULLTEXT 없음, subl 은 인덱스에 없음, 누적 INSTANT 1회.
//
// autoApply 는 붙이지 않는다 — DDL 규칙(test/db-bootstrap.test.js). 배포 때
// node tools/migrate.js --check → --apply. 되돌리려면
//   ALTER TABLE lookup ADD COLUMN subl mediumtext, ALGORITHM=INSTANT;
// 값은 돌아오지 않는다 — 사본이므로 sub 테이블에서 되만들 수 있지만 되만드는 도구는
// 이미 지웠다(git 이력의 tools/rebuild-subl.js).
//
// ── SQLite ──────────────────────────────────────────────────────────────
// 새 DB 는 mobiusdb_sqlite.sql 이 컬럼 없이 만든다. 이미 있는 DB 는 여기서 지운다 —
// SQLite 3.35+ 의 DROP COLUMN(번들 3.44). 코드가 컬럼을 더는 걸러 내지 않으므로
// 옛 DB 를 안 지우면 `select *` 의 subl 이 응답으로 새어 나간다. 개발 DB 는
// node tools/migrate.js --apply sqlite.

function hasColumn(ctx, cb) {
    var sql = (ctx.backend === 'sqlite')
        ? "select count(*) as n from pragma_table_info('lookup') where name = 'subl'"
        : "select count(*) as n from information_schema.columns" +
          " where table_schema = database() and table_name = 'lookup' and column_name = 'subl'";
    ctx.db.run(ctx.db.raw(sql), ctx.conn, function (err, rows) {
        if (err) { return cb(err, rows); }
        cb(null, !!(rows && rows[0] && parseInt(rows[0].n || rows[0].N, 10) > 0));
    });
}

module.exports = {
    id: '015-drop-lookup-subl',
    description: 'lookup.subl 컬럼 제거 — 알림 원천이 sub 테이블로 옮겨져 아무도 읽지 않는다 (INSTANT)',
    backends: ['mysql', 'sqlite'],

    inspect: function (ctx, cb) {
        hasColumn(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (!exists) { return cb(null, '이미 없음 — 적용하면 이력만 남긴다'); }
            cb(null, (ctx.backend === 'sqlite')
                ? '있음 — DROP COLUMN (SQLite 3.35+, 작은 DB 라 즉시)'
                : '있음 — ALGORITHM=INSTANT 라 행 수와 무관하게 즉시 끝난다. 조건이 안 맞으면 서버가 거절한다(재작성하지 않는다)');
        });
    },

    up: function (ctx, cb) {
        hasColumn(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (!exists) {
                console.log('    (컬럼이 이미 없다 — 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            var sql = (ctx.backend === 'sqlite')
                ? 'ALTER TABLE lookup DROP COLUMN subl'
                : 'ALTER TABLE lookup DROP COLUMN subl, ALGORITHM=INSTANT';
            // timeoutMs: 0 — 001·011 과 같은 관례. INSTANT 라 즉시 끝나지만 드라이버가
            // 먼저 끊고 서버는 계속 가는 어긋난 상태를 원천 차단한다.
            ctx.db.run(ctx.db.raw(sql), ctx.conn, function (aerr, ares) {
                if (aerr) {
                    console.error('    ALTER 실패: ' + ((ares && (ares.sqlMessage || ares.message)) || ares));
                    if (ctx.backend !== 'sqlite') {
                        console.error('    ALGORITHM=INSTANT 를 못 쓰면 서버가 거절한다 — 재작성(COPY/INPLACE)으로 ' +
                                      '떨어뜨리지 않는다. 조건(8.0.29+, FULLTEXT 없음, 인덱스 밖 컬럼)을 확인할 것');
                    }
                    return cb(aerr, ares);
                }
                console.log('    lookup.subl 제거 (' + (ctx.backend === 'sqlite' ? 'SQLite' : 'INSTANT') + ')');
                cb(null, { affectedRows: 1 });
            }, { timeoutMs: 0 });
        });
    }
};
