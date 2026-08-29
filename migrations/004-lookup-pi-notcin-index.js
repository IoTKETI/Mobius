'use strict';
// lookup(pi, (ty <> 4)) 함수 인덱스 — discovery 골격 재귀를 분기 20개에서 1개로.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// discovery 는 재귀 CTE 로 "요청 경로 아래의 부모 골격" 을 만든다. 그런데
// **MySQL 의 재귀 CTE 안에서는 ref(등치) 접근만 되고 range 접근이 안 된다.**
// 배포 서버에서 세 가지로 확인했다 (2026-08-29, 전체 CSE 골격):
//
//   ty in (2,3,5)      -> 인덱스는 pi 까지만, 나머지는 Filter      6,961ms
//   ty < 4 / ty > 4    -> 인덱스 고정해도 Filter 로 밀림         125,385ms
//   ty between ...     -> 마찬가지                              77,060ms
//   ty = 'N' 등치      -> (pi, ty) 범위                             434ms
//
// 그래서 "CIN 이 아닌 자식" 을 고르려고 타입마다 UNION 분기를 하나씩 만들었다.
// 비-리프 타입이 20개이므로 골격 노드 30,794개 × 20 = 616,000회 탐색이고,
// 이게 전체 CSE discovery 5초의 대부분이다. 그중 15개 타입은 이 배포에 행이
// 0개인데도 노드마다 찾아본다.
//
// ── 왜 함수 인덱스인가 ───────────────────────────────────────────────────
// (ty <> 4) 를 인덱스 키로 만들면 "CIN 이 아니다" 가 **등치 조건**이 된다.
// 그러면 분기 하나로 끝난다: `where (l.ty <> 4) = 1`.
// 탐색이 616,000회 -> 34,243회로 18배 줄어든다.
//
// 로컬 MySQL 로 계획을 확인했다:
//   where (l.ty <> 4)          -> Filter 로 밀린다 (인덱스를 못 쓴다)
//   where (l.ty <> 4) = 1      -> Covering index lookup
//                                 (pi=s.sk_ri, (l.ty <> 4)=1)   <- 이게 목표다
// 코드는 반드시 `= 1` 형태로 써야 한다. sql_action.js 의 build_descendant_sql 참고.
//
// 생성 컬럼(ADD COLUMN not_cin ... VIRTUAL)으로도 같은 계획이 나오지만
// 그쪽은 `select *` 결과에 컬럼이 하나 늘어난다. discovery 는 `select r.*` 로
// 행을 통째로 읽어 rcn=4/5/6 응답에 그대로 싣기 때문에 응답 본문이 오염된다.
// 함수 인덱스는 숨은 가상 컬럼으로 구현되어 `select *` 에 나타나지 않는다
// (로컬에서 두 방식의 컬럼 목록을 비교해 확인).
//
// ── 골격이 커지는 것은 괜찮은가 ──────────────────────────────────────────
// ty <> 4 는 SUB(23) / ACP(1) / GRP(9) 도 골격에 넣으므로 30,794 -> 34,243 이 된다.
// 배포 서버에서 자식을 가진 노드의 타입은 ty=3(16,708) / ty=2(444) / ty=5(1) /
// ty=14(1) 뿐이라 그 3,449개는 자식이 없다 — 결과는 같고 탐색만 1회씩 는다.
// 오히려 더 안전하다: 앞으로 어떤 타입이 자식을 갖게 되어도 목록을 고칠 필요가 없다.
//
// ── SQLite 는 왜 대상이 아닌가 ───────────────────────────────────────────
// mobiusdb_sqlite.sql 이 같은 식(pi, (ty <> 4)) 인덱스를 IF NOT EXISTS 로 만든다.
// SQLite 도 표현식 인덱스를 지원하고, 지원하지 않더라도 `(ty <> 4) = 1` 은
// 의미가 같으므로 결과는 동일하다 (임베디드 규모라 성능도 문제되지 않는다).

var INDEX_NAME = 'idx_lookup_pi_notcin';

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

function createIndex(ctx, cb) {
    // ALGORITHM=INPLACE, LOCK=NONE 이면 만드는 동안에도 읽기/쓰기가 안 막힌다.
    //
    // timeoutMs: 0 — 드라이버 타임아웃을 걸지 않는다. 기본 60초면 드라이버가
    // 먼저 커넥션을 끊는데 MySQL 은 DDL 을 계속 진행한다. 그러면 러너는 실패로
    // 보고하고 이력도 안 남기는데 인덱스는 만들어지는 어긋난 상태가 된다.
    // (001 을 적용할 때 배포 서버에서 실제로 발생)
    //
    // 되돌리려면: DROP INDEX idx_lookup_pi_notcin ON lookup;  (002 에서 2.5초 걸렸다)
    ctx.db.run(
        ctx.db.raw('ALTER TABLE lookup ADD INDEX ' + INDEX_NAME + ' (pi, (ty <> 4)), ' +
                   'ALGORITHM=INPLACE, LOCK=NONE'),
        ctx.conn, cb, { timeoutMs: 0 });
}

module.exports = {
    id: '004-lookup-pi-notcin-index',
    description: 'lookup(pi, (ty <> 4)) 함수 인덱스 — discovery 골격 재귀가 분기 20개에서 1개로',
    backends: ['mysql'],

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
                        (t.mb || '?') + 'MB. ONLINE DDL(무중단)이지만 수십 분 걸릴 수 있다 ' +
                        '(001 은 같은 규모에서 20.6분)');
                });
        });
    },

    up: function (ctx, cb) {
        // 이미 있으면 조용히 넘어간다. MySQL 에는 CREATE INDEX IF NOT EXISTS 가 없고,
        // 클라이언트 타임아웃으로 러너는 실패했는데 서버는 DDL 을 끝낸 상황이 있었다.
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
