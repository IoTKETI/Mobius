'use strict';
// idx_lookup_ct 를 지운다 — 15.6GB 회수 + 쓰기마다 드는 유지 비용 제거.
//
// **005 를 적용하고 관찰 기간을 둔 뒤에 적용할 것.**
//
// 005 가 이 인덱스를 INVISIBLE 로 만들어 "지운 상태"를 위험 없이 흉내 낸다.
// 그동안 응답 시간이 그대로고 아래 질의가 계속 0 이면 지워도 된다:
//
//   select ifnull(index_name,'(TABLE SCAN)'), count_read
//     from performance_schema.table_io_waits_summary_by_index_usage
//    where object_schema='mobiusdb' and object_name='lookup'
//    order by count_read desc;
//
// ── 근거 ─────────────────────────────────────────────────────────────────
// 배포 서버 실측 (2026-08-29, MySQL 가동 40.6시간 누적): idx_lookup_ct 읽기
// 0회 / 15.6GB. 같은 기간 idx_lookup_pi_notcin 은 1,292만회, idx_lookup_pi_ty_ct
// 는 329만회 읽혔다. 코드로도 lookup 을 ct 단독으로 접근하는 질의가 없음을
// 확인했다 — 자세한 내용은 005 의 주석 참고.
//
// ── 되돌리려면 ───────────────────────────────────────────────────────────
//   ALTER TABLE lookup ADD INDEX idx_lookup_ct (ct), ALGORITHM=INPLACE, LOCK=NONE;
// 무중단이지만 수십 분이 든다 (001 이 같은 규모에서 20.6분). 그래서 005 로
// 먼저 관찰하는 것이다.
//
// DROP 자체는 빠르다 — 002 에서 같은 규모의 인덱스를 2.5초에 지웠다.
// 다만 그때 MDL(메타데이터 잠금) 대기가 문제였으므로 같은 방식으로 재시도한다.

var INDEX_NAME = 'idx_lookup_ct';

function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['lookup', INDEX_NAME]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

module.exports = {
    id: '006-drop-lookup-ct-index',
    description: 'idx_lookup_ct 제거 — 15.6GB 회수 (005 로 관찰한 뒤 적용할 것)',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (!exists) { return cb(null, '이미 없음 — 적용하면 이력만 남긴다'); }

            ctx.db.run(
                ctx.db.raw(
                    'select ifnull((select is_visible from information_schema.statistics ' +
                    ' where table_schema = database() and table_name = ? and index_name = ? limit 1), ?) as vis, ' +
                    ' (select round(stat_value * @@innodb_page_size / 1024 / 1024 / 1024, 1) ' +
                    '    from mysql.innodb_index_stats ' +
                    '   where database_name = database() and table_name = ? and index_name = ? ' +
                    '     and stat_name = ?) as gb',
                    ['lookup', INDEX_NAME, '?', 'lookup', INDEX_NAME, 'size']),
                ctx.conn,
                function (err2, rows) {
                    var r = (!err2 && rows && rows[0]) ? rows[0] : {};
                    var vis = String(r.vis) === 'NO' ? 'INVISIBLE (005 적용됨)'
                                                     : 'VISIBLE (005 를 먼저 적용할 것)';
                    cb(null, '있음 — ' + vis + ', ' + (r.gb || '?') + 'GB. ' +
                        'DROP 은 빠르지만(002 에서 2.5초) 되돌리려면 수십 분이 든다');
                });
        });
    },

    up: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (!exists) {
                console.log('    (인덱스가 이미 없다 — 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            ctx.db.run(
                ctx.db.raw('ALTER TABLE lookup DROP INDEX idx_lookup_ct, ' +
                           'ALGORITHM=INPLACE, LOCK=NONE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
