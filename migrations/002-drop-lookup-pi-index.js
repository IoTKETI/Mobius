'use strict';
// lookup 의 idx_lookup_pi (pi) 제거.
//
// ── 왜 지우나 ────────────────────────────────────────────────────────────
// 옵티마이저가 쓰지 않는데 INSERT 마다 갱신되고 디스크를 먹는다.
//
// 배포 서버 실측 (2026-08-28, 관측 창 18.9시간):
//   information_schema.statistics            -> IS_VISIBLE = NO
//   table_io_waits_summary_by_index_usage    -> count_read = 0
//   mysql.innodb_index_stats                 -> 9.49 GB
//
// INVISIBLE 이므로 읽기 0 은 당연한 결과다. 판단 근거는 "INVISIBLE 인 채로
// 운영이 멀쩡했다" 쪽이다 — mobiusdb.sql 이 애초에 /*!80000 INVISIBLE */ 로
// 선언하고 있었으니 이 인덱스는 처음부터 옵티마이저 밖에 있었다.
//
// ── 왜 중복인가 ──────────────────────────────────────────────────────────
// InnoDB 보조 인덱스는 PK 컬럼을 뒤에 자동으로 붙인다. PK 가 (pi, ri, ty) 이므로
//   idx_lookup_pi (pi)          -> 실제 저장은 (pi, ri, ty)  = PRIMARY 와 동일 구성
//   idx_lookup_pi_ty_ct (pi,ty,ct) -> 실제 저장은 (pi, ty, ct, ri)
// PRIMARY 가 pi 로 시작하므로 "pi 로 좁히기" 는 PRIMARY 만으로 된다.
// idx_lookup_pi 가 단독으로 답할 수 있는 질의는 없다.
//
// ── 되돌리기 ─────────────────────────────────────────────────────────────
//   ALTER TABLE lookup ADD INDEX idx_lookup_pi (pi), ALGORITHM=INPLACE, LOCK=NONE;
// 비대칭에 주의할 것. DROP 은 초 단위지만 재생성은 5,740만 행에서 수십 분이다
// (001 이 같은 테이블에서 20.6분 걸렸다).
//
// ── SQLite 는 왜 대상이 아닌가 ───────────────────────────────────────────
// mobiusdb_sqlite.sql 에 idx_lookup_pi 가 애초에 없다.

var INDEX = 'idx_lookup_pi';

function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['lookup', INDEX]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

module.exports = {
    id: '002-drop-lookup-pi-index',
    description: 'lookup 의 미사용 인덱스 idx_lookup_pi 제거 — 9.49GB 와 INSERT 부담 회수',
    backends: ['mysql'],

    // 읽기 전용. --check 가 보여 줄 현재 상태.
    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (!exists) { return cb(null, '이미 없음 — 적용하면 이력만 남긴다'); }

            // 크기와 읽기 횟수를 함께 보여 준다. 읽기가 0 이 아니면
            // 사람이 멈출 수 있어야 한다.
            ctx.db.run(
                ctx.db.raw(
                    'select ' +
                    ' (select round(stat_value*16384/1073741824, 2) from mysql.innodb_index_stats ' +
                    '   where database_name = database() and table_name = ? ' +
                    '     and index_name = ? and stat_name = ?) as gb, ' +
                    ' (select is_visible from information_schema.statistics ' +
                    '   where table_schema = database() and table_name = ? ' +
                    '     and index_name = ? limit 1) as visible, ' +
                    ' (select count_read from performance_schema.table_io_waits_summary_by_index_usage ' +
                    '   where object_schema = database() and object_name = ? ' +
                    '     and index_name = ?) as reads',
                    ['lookup', INDEX, 'size', 'lookup', INDEX, 'lookup', INDEX]),
                ctx.conn,
                function (err2, rows) {
                    if (err2) { return cb(err2, rows); }
                    var r = (rows && rows[0]) || {};
                    cb(null, '있음 — ' + (r.gb === null || r.gb === undefined ? '?' : r.gb) + 'GB, ' +
                        'visible=' + (r.visible || '?') + ', ' +
                        '읽기 ' + (r.reads === null || r.reads === undefined ? '?' : r.reads) + '회' +
                        ' (읽기는 MySQL 기동 이후 누적이다. 0 이 아니면 멈추고 확인할 것)');
                });
        });
    },

    up: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (!exists) {
                console.log('    (인덱스가 이미 없다 — 지우지 않고 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            // 보조 인덱스 DROP 은 INPLACE/LOCK=NONE 을 지원한다. 다만 시작할 때
            // 배타 MDL 을 잠깐 잡으므로, 대기가 길어지면 lookup 에 들어오는
            // 신규 질의가 그 뒤에 줄을 선다. 짧게 끊고 사람이 재시도하게 한다.
            ctx.db.run(ctx.db.raw('SET SESSION lock_wait_timeout = 5'), ctx.conn, function (serr, sres) {
                if (serr) { return cb(serr, sres); }
                // 인덱스 이름은 리터럴로 쓴다. test/schema-drift.test.js 가
                // 마이그레이션 소스에서 DROP INDEX 대상을 정규식으로 읽어
                // mobiusdb.sql 과 대조하는데, 변수로 쓰면 그 대조가 조용히
                // 빗나가 거짓 통과한다 (실제로 한 번 그랬다).
                ctx.db.run(
                    ctx.db.raw('ALTER TABLE lookup DROP INDEX idx_lookup_pi' +
                               ', ALGORITHM=INPLACE, LOCK=NONE'),
                    ctx.conn, cb, { timeoutMs: 0 });
            });
        });
    }
};
