'use strict';
// lookup 에 not_cin 가상 컬럼과 (pi, not_cin) 인덱스 — discovery 골격 재귀를
// 분기 20개에서 1개로 줄인다.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// discovery 는 재귀 CTE 로 "요청 경로 아래의 부모 골격" 을 만든다. 그런데
// **MySQL 의 재귀 CTE 안에서는 ref(등치) 접근만 되고 range 접근이 안 된다.**
// 배포 서버에서 네 가지로 확인했다 (2026-08-29, 전체 CSE 골격):
//
//   ty in (2,3,5)      인덱스는 pi 까지만, 나머지는 Filter        6,961ms
//   ty < 4 / ty > 4    인덱스를 고정해도 Filter 로 밀림         125,385ms
//   ty between ...     마찬가지                                 77,060ms
//   ty = 'N' 등치      (pi, ty) 범위                                434ms
//
// 그래서 "CIN 이 아닌 자식" 을 고르려고 타입마다 UNION 분기를 하나씩 만들었다.
// 비-리프 타입이 20개라 골격 노드 30,794개 × 20 = 616,000회 탐색이고, 이게
// 전체 CSE discovery 5초의 대부분이다. 그중 15개 타입은 이 배포에 행이
// 0개인데도 노드마다 찾아본다.
//
// (ty <> 4) 를 가상 컬럼으로 만들어 인덱스에 넣으면 "CIN 이 아니다" 가
// **등치 조건**이 되어 분기 하나로 끝난다. 탐색 616,000 -> 34,243 회.
//
// ── 왜 INVISIBLE 인가 ────────────────────────────────────────────────────
// 안 붙이면 `select *` 결과에 컬럼이 하나 늘어난다. Mobius 는 리소스 조회를
// `select * from lookup where ri = ?` 로 하고 그 행을 응답 본문에 그대로
// 싣기 때문에, not_cin 이 m2m:cnt 같은 응답에 섞여 나간다.
// 배포 서버에서 실제로 한 번 샜다 (2026-08-29, 이 마이그레이션을 만드는 중에).
// INVISIBLE 컬럼은 MySQL 8.0.23+ 이고 배포 서버는 8.0.46 이다.
//
// ── 왜 두 문장으로 나누는가 ──────────────────────────────────────────────
// 한 문장에 컬럼 추가와 인덱스 추가를 같이 넣으면 MySQL 이 거절한다:
//   ERROR 1846: LOCK=NONE is not supported.
//               Reason: ADD COLUMN col...VIRTUAL, ADD INDEX(col). Try LOCK=SHARED.
// 함수 인덱스(ADD INDEX (pi, (ty <> 4)))도 내부적으로 같은 조합이라 같은 이유로
// 막힌다. 두 문장으로 나누면 둘 다 ALGORITHM=INPLACE, LOCK=NONE 으로 돈다.
//
// ── 골격이 커지는 것은 괜찮은가 ──────────────────────────────────────────
// ty <> 4 는 SUB(23) / ACP(1) / GRP(9) 도 골격에 넣으므로 30,794 -> 34,243 이 된다.
// 배포 서버에서 자식을 가진 노드의 타입은 ty=3(16,708) / ty=2(444) / ty=5(1) /
// ty=14(1) 뿐이라 그 3,449개는 자식이 없다 — 결과는 같고 탐색만 1회씩 는다.
// 오히려 더 안전하다: 앞으로 어떤 타입이 자식을 갖게 되어도 목록을 고칠 필요가 없다.
//
// ── SQLite 는 왜 대상이 아닌가 ───────────────────────────────────────────
// SQLite 에는 INVISIBLE 컬럼이 없어서 만들면 `select *` 응답에 그대로 샌다.
// 그리고 임베디드 규모라 그럴 이유도 없다 — 파사드가 SQLite 쪽에는
// `ty <> 4` 를 그대로 내보낸다 (mobius/db/sqlite.js 의 notCinPredicate).
//
// 되돌리려면:
//   ALTER TABLE lookup DROP INDEX idx_lookup_pi_notcin;   (002 에서 2.5초 걸렸다)
//   ALTER TABLE lookup DROP COLUMN not_cin;

var INDEX_NAME = 'idx_lookup_pi_notcin';
var COL_NAME = 'not_cin';

function hasColumn(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.columns ' +
            'where table_schema = database() and table_name = ? and column_name = ?',
            ['lookup', COL_NAME]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

function isInvisible(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.columns ' +
            'where table_schema = database() and table_name = ? and column_name = ? ' +
            "and extra like '%INVISIBLE%'",
            ['lookup', COL_NAME]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

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

// timeoutMs: 0 — 드라이버 타임아웃을 걸지 않는다. 기본 60초면 드라이버가 먼저
// 커넥션을 끊는데 MySQL 은 DDL 을 계속 진행한다. 그러면 러너는 실패로 보고하고
// 이력도 안 남기는데 인덱스는 만들어지는 어긋난 상태가 된다.
// (001 을 적용할 때 배포 서버에서 실제로 발생)
function ddl(ctx, sql, cb) {
    ctx.db.run(ctx.db.raw(sql), ctx.conn, cb, { timeoutMs: 0 });
}

module.exports = {
    id: '004-lookup-pi-notcin-index',
    description: 'lookup(pi, not_cin) 인덱스 — discovery 골격 재귀가 분기 20개에서 1개로',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        hasColumn(ctx, function (err, col) {
            if (err) { return cb(err, null); }
            hasIndex(ctx, function (err2, idx) {
                if (err2) { return cb(err2, null); }
                if (col && idx) {
                    return isInvisible(ctx, function (err3, inv) {
                        if (err3) { return cb(err3, null); }
                        cb(null, inv ? '이미 있음 — 적용하면 이력만 남긴다'
                                     : '컬럼·인덱스는 있으나 not_cin 이 INVISIBLE 이 아니다 ' +
                                       '(응답에 샌다) — 적용하면 숨긴다');
                    });
                }

                ctx.db.run(
                    ctx.db.raw(
                        'select table_rows as n, round(data_length/1024/1024) as mb ' +
                        'from information_schema.tables ' +
                        'where table_schema = database() and table_name = ?', ['lookup']),
                    ctx.conn,
                    function (err3, trows) {
                        if (err3) { return cb(err3, trows); }
                        var t = (trows && trows[0]) || {};
                        var n = parseInt(t.n || 0, 10);
                        cb(null, (col ? '컬럼만 있음' : '없음') + ' — lookup 약 ' +
                            n.toLocaleString() + '행 / ' + (t.mb || '?') + 'MB. ' +
                            'ONLINE DDL(무중단)이지만 인덱스 빌드에 수십 분 걸릴 수 있다 ' +
                            '(001 은 같은 규모에서 20.6분)');
                    });
            });
        });
    },

    up: function (ctx, cb) {
        // 1) 가상 컬럼. 이미 있으면 INVISIBLE 인지만 확인하고 넘어간다.
        hasColumn(ctx, function (err, col) {
            if (err) { return cb(err, col); }

            function step2() {
                // 2) 인덱스. MySQL 에는 CREATE INDEX IF NOT EXISTS 가 없고,
                //    클라이언트 타임아웃으로 러너는 실패했는데 서버는 DDL 을
                //    끝낸 상황이 실제로 있었다. 재실행이 막히면 안 된다.
                hasIndex(ctx, function (err2, idx) {
                    if (err2) { return cb(err2, idx); }
                    if (idx) {
                        console.log('    (인덱스가 이미 있다 — 만들지 않는다)');
                        return cb(null, { affectedRows: 0 });
                    }
                    console.log('    인덱스 생성 중… 수십 분 걸릴 수 있다 (무중단)');
                    // 인덱스 이름은 리터럴로 쓴다 — schema-drift 테스트가
                    // mobiusdb.sql 의 선언과 문자열로 대조하기 때문이다.
                    ddl(ctx, 'ALTER TABLE lookup ADD INDEX idx_lookup_pi_notcin ' +
                             '(pi, not_cin), ALGORITHM=INPLACE, LOCK=NONE', cb);
                });
            }

            if (col) {
                // 눈에 보이는 상태로 만들어진 적이 있으면 숨긴다.
                isInvisible(ctx, function (err2, inv) {
                    if (err2) { return cb(err2, inv); }
                    if (inv) { return step2(); }
                    console.log('    (not_cin 이 보이는 상태다 — INVISIBLE 로 바꾼다)');
                    ddl(ctx, 'ALTER TABLE lookup ALTER COLUMN not_cin SET INVISIBLE',
                        function (err3, r) {
                            if (err3) { return cb(err3, r); }
                            step2();
                        });
                });
                return;
            }

            // 컬럼과 인덱스를 한 문장에 넣으면 LOCK=NONE 이 거절된다(ERROR 1846).
            // 반드시 나눠서 실행한다.
            ddl(ctx, 'ALTER TABLE lookup ADD COLUMN not_cin ' +
                     'tinyint unsigned GENERATED ALWAYS AS (ty <> 4) VIRTUAL INVISIBLE, ' +
                     'ALGORITHM=INPLACE, LOCK=NONE',
                function (err2, r) {
                    if (err2) { return cb(err2, r); }
                    step2();
                });
        });
    }
};
