'use strict';
// idx_lookup_ct 를 INVISIBLE 로 — 지우기 전에 안전하게 관찰한다.
//
// ── 왜 지우려 하는가 ─────────────────────────────────────────────────────
// lookup 의 인덱스 총량이 61.4GB 다 (데이터는 22.2GB). 그중 idx_lookup_ct 가
// 15.6GB 인데 **한 번도 안 쓰인다**.
//
// 배포 서버 실측 (2026-08-29, MySQL 가동 40.6시간 누적,
// performance_schema.table_io_waits_summary_by_index_usage):
//
//   idx_lookup_pi_notcin   12,925,133 회   10.0GB
//   idx_lookup_pi_ty_ct     3,292,103 회   11.1GB
//   ri_UNIQUE                  98,317 회    9.7GB
//   idx_lookup_ty              37,561 회    9.7GB
//   (테이블 스캔)              16,171 회
//   idx_lookup_sri             15,883 회   15.5GB
//   PRIMARY                    14,584 회   22.2GB
//   idx_lookup_ct                   0 회   15.6GB   <- 이것
//
// 코드로도 교차 확인했다. lookup 을 ct 로 거르거나 정렬하는 곳은 전부 pi
// (대개 ty 까지)와 함께라 idx_lookup_pi_ty_ct 가 처리한다:
//   sql_action.js  discovery 의 la 정렬 (바깥 질의가 r.pi 로 조인한다)
//   sql_action.js  delete_oldest 의 `where pi = ? and ty = ? order by ct asc`
//   sql_action.js  select_edge_resource 의 `orderBy ct, ri` (pi/ty 로 좁힌 뒤)
// ct 단독으로 접근하는 질의는 없다. 만료 스윕은 et 를 쓴다(인덱스 없음).
//
// 마이그레이션 001 이 idx_lookup_pi_ty_ct 를 만들면서 이렇게 됐다. 그 주석이
// "옵티마이저가 idx_lookup_ct 를 역방향 스캔하며 pi 로 걸러낸다"를 문제로
// 지목했고, 그걸 고치려고 (pi, ty, ct) 를 만들었다. 그 뒤로 이 인덱스는 할
// 일이 없다.
//
// ── 왜 바로 안 지우고 INVISIBLE 인가 ─────────────────────────────────────
// INVISIBLE 인덱스는 유지는 되지만 옵티마이저가 안 쓴다. 즉 "지운 상태"를
// 위험 없이 흉내 낼 수 있고, 문제가 생기면 VISIBLE 로 되돌리는 데 1초면 된다.
// 지운 뒤 되돌리려면 20분짜리 인덱스 재생성이다(001 이 같은 규모에서 20.6분).
//
// 40.6시간치 0회는 충분한 근거지만, 그보다 드물게 도는 관리 작업이 있을 수
// 있다. 관찰 기간을 두고 나서 006 이 실제로 지운다.
//
// 되돌리려면:
//   ALTER TABLE lookup ALTER INDEX idx_lookup_ct VISIBLE;
//
// 관찰 방법 (이 마이그레이션 적용 뒤 하루 이상 두고):
//   select ifnull(index_name,'(TABLE SCAN)'), count_read
//     from performance_schema.table_io_waits_summary_by_index_usage
//    where object_schema='mobiusdb' and object_name='lookup'
//    order by count_read desc;
// idx_lookup_ct 가 여전히 0 이고 응답 시간에 변화가 없으면 006 을 적용한다.
//
// ── SQLite 는 왜 대상이 아닌가 ───────────────────────────────────────────
// mobiusdb_sqlite.sql 에는 ct 단독 인덱스가 없다. 만들 이유도 없었다.

var INDEX_NAME = 'idx_lookup_ct';

function indexState(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select is_visible from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ? limit 1',
            ['lookup', INDEX_NAME]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            if (!rows || !rows.length) { return cb(null, 'none'); }
            // MySQL 8 은 'YES' / 'NO' 를 준다
            cb(null, String(rows[0].IS_VISIBLE || rows[0].is_visible) === 'NO'
                ? 'invisible' : 'visible');
        });
}

module.exports = {
    id: '005-lookup-ct-index-invisible',
    description: 'idx_lookup_ct 를 INVISIBLE 로 — 40.6시간 동안 읽기 0회, 지우기 전 관찰',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        indexState(ctx, function (err, st) {
            if (err) { return cb(err, null); }
            if (st === 'none') { return cb(null, '인덱스가 이미 없다 — 적용하면 이력만 남긴다'); }
            if (st === 'invisible') { return cb(null, '이미 INVISIBLE — 적용하면 이력만 남긴다'); }

            ctx.db.run(
                ctx.db.raw(
                    'select count_read from performance_schema.table_io_waits_summary_by_index_usage ' +
                    'where object_schema = database() and object_name = ? and index_name = ?',
                    ['lookup', INDEX_NAME]),
                ctx.conn,
                function (err2, rows) {
                    // performance_schema 는 컬럼명을 대문자로 돌려줄 때가 있다.
                    var r = (!err2 && rows && rows[0]) ? rows[0] : {};
                    var reads = (r.count_read !== undefined) ? r.count_read : r.COUNT_READ;
                    cb(null, 'VISIBLE — 서버 기동 이후 읽기 ' +
                        (reads === null || reads === undefined ? '?' : reads) +
                        '회. INVISIBLE 로 바꾸면 옵티마이저가 안 쓴다 (즉시, 되돌리기 1초)');
                });
        });
    },

    up: function (ctx, cb) {
        indexState(ctx, function (err, st) {
            if (err) { return cb(err, st); }
            if (st === 'none') {
                console.log('    (인덱스가 이미 없다 — 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            if (st === 'invisible') {
                console.log('    (이미 INVISIBLE — 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            // 메타데이터만 바꾼다. 인덱스는 그대로 유지되므로 되돌리기가 즉시다.
            ctx.db.run(
                ctx.db.raw('ALTER TABLE lookup ALTER INDEX idx_lookup_ct INVISIBLE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
