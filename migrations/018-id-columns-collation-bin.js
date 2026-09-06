'use strict';
// id 컬럼의 콜레이션을 utf8mb3_bin 으로 (ri/sri 설계 메모 §3 A3).
//
// ── 왜 ──────────────────────────────────────────────────────────────────
// lookup.ri 는 utf8mb3_bin(대소문자 구분)인데 pi · sri · spi 와 자식 표의 pi 는
// utf8mb3_general_ci(구분 안 함)다. 배포 실측(2026-09-06). 그래서
//   - `pi = ri` 조인마다 콜레이션 변환이 낀다(재귀 CTE 가 ty 등치만 인덱스를 타던 함정)
//   - `/Mobius/Abc` 와 `/Mobius/abc` 가 따로 생기는데(ri 는 bin) 자식 조회는 한 부모로 본다
//   - AE 의 aei 는 대소문자가 섞였는데 sri 비교는 구분 없이 한다
// 식별자는 바이트 그대로 비교해야 한다. rn · lbl 은 discovery 필터 의미가 걸려 있어
// 이번엔 두지 않는다.
//
// ── 비용 ────────────────────────────────────────────────────────────────
// lookup.pi 는 PRIMARY KEY(pi, ri, ty) 의 앞 컬럼이라 MODIFY 가 표 전체(6,200만 행 ·
// 데이터 22GB + 인덱스 57GB)를 다시 쓴다 — **시간 단위, 점검 창에서만**. cin.pi 도
// PK(ri, pi) 안이라 249GB 를 다시 쓴다. sub 는 수천 행이라 즉시.
// 그래서 autoApply 가 없고, --apply 는 사용자 결정 뒤에만 친다. inspect 가 표별로
// "바꿀 것 / 이미 bin" 을 보여 준다. 새 설치는 mobius/db/mobiusdb.sql 이 이미 bin 이다.
//
// 형(varchar 폭)과 NULL 여부는 information_schema 에서 읽어 그대로 둔다 — 여기 적어
// 두면 스키마가 바뀔 때 어긋난다.

var TARGETS = [
    { table: 'lookup', cols: ['pi', 'sri', 'spi'] },
    { table: 'cin',    cols: ['pi'] },
    { table: 'sub',    cols: ['pi'] }
];
var WANT = 'utf8mb3_bin';

function columns(ctx, cb) {
    var where = TARGETS.map(function (t) {
        return "(table_name = '" + t.table + "' and column_name in (" + t.cols.map(function (c) { return "'" + c + "'"; }).join(', ') + '))';
    }).join(' or ');
    ctx.db.run(ctx.db.raw(
        'select table_name as t, column_name as c, column_type as ty, is_nullable as nul, collation_name as coll' +
        ' from information_schema.columns where table_schema = database() and (' + where + ')' +
        ' order by table_name, column_name'), ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows || []).map(function (r) {
                return { table: r.t || r.T, col: r.c || r.C, type: String(r.ty || r.TY),
                         nullable: String(r.nul || r.NUL).toUpperCase() === 'YES', coll: String(r.coll || r.COLL || '') };
            }));
        });
}

function plan(cols) {
    var by = {};
    cols.forEach(function (c) {
        if (c.coll === WANT) { return; }
        (by[c.table] = by[c.table] || []).push(c);
    });
    return Object.keys(by).map(function (t) {
        return { table: t, sql: 'ALTER TABLE ' + t + ' ' + by[t].map(function (c) {
            return 'MODIFY ' + c.col + ' ' + c.type + ' CHARACTER SET utf8mb3 COLLATE ' + WANT + (c.nullable ? ' NULL' : ' NOT NULL');
        }).join(', ') };
    });
}

module.exports = {
    id: '018-id-columns-collation-bin',
    description: 'lookup.pi/sri/spi · cin.pi · sub.pi 를 utf8mb3_bin 으로 — 식별자는 바이트 그대로 비교한다 (표 재작성, 점검 창)',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        columns(ctx, function (err, cols) {
            if (err) { return cb(err, null); }
            var todo = plan(cols);
            if (todo.length === 0) { return cb(null, '전부 ' + WANT + ' — 이미 맞다'); }
            var lines = cols.map(function (c) {
                return '  ' + c.table + '.' + c.col + ' ' + c.coll + (c.coll === WANT ? '' : ' → ' + WANT);
            });
            lines.push('  바꿀 표 ' + todo.length + ' — lookup · cin 은 표 전체를 다시 쓴다(시간 단위). 점검 창에서 --apply');
            cb(null, '\n' + lines.join('\n'));
        });
    },

    up: function (ctx, cb) {
        columns(ctx, function (err, cols) {
            if (err) { return cb(err, cols); }
            var todo = plan(cols);
            (function next(i, done) {
                if (i >= todo.length) { return cb(null, { affectedRows: done }); }
                console.log('    ' + todo[i].sql);
                ctx.db.run(ctx.db.raw(todo[i].sql), ctx.conn, function (aerr, ares) {
                    if (aerr) { return cb(aerr, ares); }
                    next(i + 1, done + 1);
                }, { timeoutMs: 0 });
            })(0, 0);
        });
    }
};
