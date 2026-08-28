'use strict';
// lookup(pi, ty, ct) 복합 인덱스.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// la(최신 1건) / ol(최고참 1건) / discovery 는 전부 "부모 아래에서 타입으로
// 거른 뒤 생성순 정렬" 이다. 그런데 MySQL 의 lookup 인덱스는
//   PRIMARY (pi, ri, ty) / idx_lookup_ty (ty) / idx_lookup_ct (ct) / idx_lookup_sri (sri)
// 뿐이라 (pi, ty) 로 좁힌 뒤 ct 로 정렬하는 조합이 없다.
//
// 그래서 옵티마이저가 idx_lookup_ct 를 역방향 스캔하며 pi 로 걸러낸다.
// 컨테이너가 크고 최근 데이터가 없으면 다른 컨테이너 데이터를 수백만 행
// 훑고 나서야 10건을 찾는다.
//
// 실측 (배포 서버, /Mobius/PureunAir/PA1/status — CIN 549만 건):
//   최근 1시간 창  ->      16ms   (활성 컨테이너는 금방 찾는다)
//   1년 창         ->  15초 초과, 강제 종료
//   옵티마이저 비용 1,091,760 / rows 22,269,440 / filtered 1.87%
//
// select_latest_resource 는 창을 5^n 분으로 넓혀 가며 최대 10회 재귀하므로,
// 조용해진 큰 컨테이너의 la 는 사실상 응답하지 못한다.
//
// ── 왜 (pi, ty, ct) 인가 ─────────────────────────────────────────────────
// InnoDB 보조 인덱스는 PK 컬럼을 뒤에 자동으로 붙인다. PK 가 (pi, ri, ty) 이므로
// 이 인덱스는 실제로 (pi, ty, ct, ri) 로 저장되고, `order by ct desc, ri desc`
// 까지 정렬 없이 처리된다. ri 를 명시할 필요가 없다.
//
// ── SQLite 는 왜 대상이 아닌가 ───────────────────────────────────────────
// mobiusdb_sqlite.sql 이 idx_lookup_pi_ty_ct 를 이미 만든다 (IF NOT EXISTS).
// 기존 SQLite DB 가 크면 tools/sqlite-indexes.js 로 미리 만들면 된다.

// lookup 에 idx_lookup_pi_ty_ct 가 있는가.
function hasIndex(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.statistics ' +
            'where table_schema = database() and table_name = ? and index_name = ?',
            ['lookup', 'idx_lookup_pi_ty_ct']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

function createIndex(ctx, cb) {
    // ALGORITHM=INPLACE, LOCK=NONE 이면 만드는 동안에도 읽기/쓰기가 막히지 않는다.
    // MySQL 8 은 보조 인덱스 추가를 이 방식으로 지원한다.
    // 되돌리려면 DROP INDEX idx_lookup_pi_ty_ct ON lookup;
    //
    // timeoutMs: 0 — 드라이버 타임아웃을 걸지 않는다. 기본 60초를 그대로 두면
    // 5740만 행 테이블에서 드라이버가 먼저 커넥션을 끊는데, MySQL 은 DDL 을
    // 계속 진행한다. 그러면 러너는 실패로 보고하고 이력도 안 남기는데 인덱스는
    // 만들어지는 어긋난 상태가 된다. (2026-08-28 배포 서버에서 실제로 발생)
    ctx.db.run(
        ctx.db.raw('ALTER TABLE lookup ADD INDEX idx_lookup_pi_ty_ct (pi, ty, ct), ' +
                   'ALGORITHM=INPLACE, LOCK=NONE'),
        ctx.conn, cb, { timeoutMs: 0 });
}

module.exports = {
    id: '001-lookup-pi-ty-ct-index',
    description: 'lookup(pi, ty, ct) 복합 인덱스 — la/ol/discovery 가 ct 역스캔에서 벗어난다',
    backends: ['mysql'],

    // 읽기 전용. --check 가 보여 줄 현재 상태.
    inspect: function (ctx, cb) {
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            if (exists) { return cb(null, '이미 있음 — 적용하면 이력만 남긴다'); }

            ctx.db.run(
                ctx.db.raw(
                    'select table_rows as n, round(data_length/1024/1024) as mb ' +
                    'from information_schema.tables ' +
                    'where table_schema = database() and table_name = ?', ['lookup']),
                ctx.conn,
                function (err2, trows) {
                    if (err2) { return cb(err2, trows); }
                    var t = (trows && trows[0]) || {};
                    var n = parseInt(t.n || 0, 10);
                    cb(null, '없음 — lookup 약 ' + n.toLocaleString() + '행 / ' +
                        (t.mb || '?') + 'MB. ONLINE DDL(무중단)이지만 수십 분 걸릴 수 있다');
                });
        });
    },

    up: function (ctx, cb) {
        // 인덱스가 이미 있으면 조용히 넘어간다.
        // MySQL 에는 CREATE INDEX IF NOT EXISTS 가 없고, 클라이언트 타임아웃으로
        // 러너는 실패했는데 서버는 DDL 을 끝낸 상황이 실제로 있었다.
        // 그 뒤 재실행이 "Duplicate key name" 으로 막히면 안 된다.
        hasIndex(ctx, function (err, exists) {
            if (err) { return cb(err, exists); }
            if (exists) {
                console.log('    (인덱스가 이미 있다 — 만들지 않고 이력만 남긴다)');
                return cb(null, { affectedRows: 0 });
            }
            createIndex(ctx, cb);
        });
    }
};
