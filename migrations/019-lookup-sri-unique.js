'use strict';
// lookup.sri 를 UNIQUE 로 (ri/sri 설계 메모 docs/superpowers/specs/2026-09-06-ri-sri-design.md §3 A1).
//
// ── 왜 ──────────────────────────────────────────────────────────────────
// sri 는 밖으로 나가는 ri(resourceID)다. 옛 생성기가 워커끼리 겹쳐 배포에 중복이 1,041행
// 있었고(017 이 정리), 인덱스가 비유일이라 DB 는 막지 못했다. 생성기(short_ri)가 이제
// 유일성을 지키지만, DB 가 막지 않으면 어긋난 행이 조용히 들어온다 — 사용자가 지정한
// aei 도 sri 다. 그래서 UNIQUE 로 건다.
//
// ── 순서 ────────────────────────────────────────────────────────────────
// 017 로 중복이 0 이어야 한다. 남아 있으면 ALTER 가 끝에서 실패하므로 up 이 먼저 세어
// 보고 거부한다(전수 group by — 분 단위). 비유일 idx_lookup_sri(15.8GB)는 같은 문장에서
// 지운다. INPLACE · LOCK=NONE 이라 쓰기를 막지 않는다 — 6,200만 행 인덱스 빌드는 수십 분.
// 빌드 중에 중복이 들어오면 ALTER 가 실패한다(생성기가 막는다).
//
// autoApply 없음(DDL). SQLite 는 대상이 아니다 — 옛 개발 DB 에 중복이 있으면 기동 때
// 스키마의 CREATE UNIQUE INDEX 가 실패해 뜨지 못하므로, 개발 DB 는 비유일 인덱스 그대로
// 두고 생성기와 test/lookup-sri-dedupe 가 유일성을 지킨다.
// 되돌리려면: ALTER TABLE lookup ADD INDEX idx_lookup_sri (sri), DROP INDEX idx_lookup_sri_unique

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
