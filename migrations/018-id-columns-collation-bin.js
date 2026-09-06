'use strict';
// 식별자·이름 컬럼의 콜레이션을 utf8mb3_bin 으로, rn·sri·spi 는 200 으로 (ri/sri 설계 메모 §3 A3·A4).
//
// ── 왜 ──────────────────────────────────────────────────────────────────
// lookup.ri 는 utf8mb3_bin(대소문자 구분)인데 pi · sri · spi · rn · lbl · acpi, ae.aei,
// CSE-ID(csi), 생성자(cr) 는 utf8mb3_general_ci(구분 안 함)였다. 배포 실측(2026-09-06):
//   - 만드는 것은 구분한다(ri 가 PK) — 대소문자만 다른 형제 컨테이너 51쌍 · AE 9쌍이 있다
//   - 찾는 것은 안 가린다 — 그 쌍의 자식이 `pi = ?` 로 섞인다(한 쌍 실측 8 + 1 = 9),
//     `?rn=` 필터가 대소문자를 안 가리고(이틀 115회), SmyAE 가 있으면 SMYAE 가 409
//   - `pi = ri` 조인마다 콜레이션 변환이 낀다(재귀 CTE 가 ty 등치만 인덱스를 타던 함정)
// 사용자 결정: oneM2M 대로 식별자·이름은 바이트 그대로 비교한다. poa · nu 는 주소라
// (호스트명은 원래 대소문자를 안 가린다) 두고, 모든 표의 cr 은 information_schema 로 찾는다
// (fcnt.cr 만 이미 bin 이었다).
//
// ── 넓히는 것 ───────────────────────────────────────────────────────────
// rn · sri · spi 는 45 → 200. oneM2M 은 길이를 정하지 않고 한계는 이 CSE 의 저장소다.
// 구독 이름이 이미 40자(30자 초과 2,023개)이고, 사용자가 지정한 aei(ae.aei 는 200)가
// lookup.sri 45 에서 잘려 500 이 났다. 같은 재작성 안이라 비용이 늘지 않는다. ri 는
// PK·FK 폭이라 200 을 둔다. 코드의 한계(mobius/name_limits.js)는 **이것을 적용한 뒤**
// 200 으로 올린다 — 코드가 스키마보다 앞서면 DB 가 500 을 낸다.
//
// ── 비용 ────────────────────────────────────────────────────────────────
// lookup.pi 는 PRIMARY KEY(pi, ri, ty) 의 앞 컬럼이라 MODIFY 가 표 전체(6,200만 행 ·
// 데이터 22GB + 인덱스 57GB)를 다시 쓴다 — **시간 단위, 점검 창에서만**. cin 도 PK(ri, pi)
// 안이라 249GB 를 다시 쓴다(cr 도 같은 문장에 탄다). 나머지 표는 즉시.
// 그래서 autoApply 가 없고, --apply 는 사용자 결정 뒤에만 친다. 새 설치는
// mobius/db/mobiusdb.sql 이 이미 이 모양이다(test/schema-drift.test.js).
//
// 형(varchar 폭)과 NULL 여부는 information_schema 에서 읽어 그대로 둔다 — 넓히는 셋만 빼고.

var WANT = 'utf8mb3_bin';
var LOOKUP_COLS = ['acpi', 'lbl', 'pi', 'rn', 'spi', 'sri'];
var WIDEN = { 'lookup.rn': 'varchar(200)', 'lookup.sri': 'varchar(200)', 'lookup.spi': 'varchar(200)' };

function columns(ctx, cb) {
    var where = "(table_name = 'lookup' and column_name in (" + LOOKUP_COLS.map(function (c) { return "'" + c + "'"; }).join(', ') + '))' +
                " or (table_name = 'ae' and column_name = 'aei')" +
                " or (table_name = 'cb' and column_name = 'csi')" +
                " or (table_name = 'csr' and column_name in ('csi', 'cb'))" +
                " or (table_name = 'cin' and column_name = 'pi')" +
                " or (table_name = 'sub' and column_name = 'pi')" +
                " or column_name = 'cr'";
    ctx.db.run(ctx.db.raw(
        'select table_name as t, column_name as c, column_type as ty, is_nullable as nul, collation_name as coll' +
        " from information_schema.columns where table_schema = database() and data_type = 'varchar' and (" + where + ')' +
        ' order by table_name, column_name'), ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows || []).map(function (r) {
                return { table: r.t || r.T, col: r.c || r.C, type: String(r.ty || r.TY).toLowerCase(),
                         nullable: String(r.nul || r.NUL).toUpperCase() === 'YES', coll: String(r.coll || r.COLL || '') };
            }));
        });
}

function wanted_type(c) { return WIDEN[c.table + '.' + c.col] || c.type; }
function needs_change(c) { return c.coll !== WANT || wanted_type(c) !== c.type; }

function plan(cols) {
    var order = [], by = {};
    cols.forEach(function (c) {
        if (!needs_change(c)) { return; }
        if (!by[c.table]) { by[c.table] = []; order.push(c.table); }
        by[c.table].push(c);
    });
    return order.map(function (t) {
        return { table: t, sql: 'ALTER TABLE ' + t + ' ' + by[t].map(function (c) {
            return 'MODIFY ' + c.col + ' ' + wanted_type(c) + ' CHARACTER SET utf8mb3 COLLATE ' + WANT + (c.nullable ? ' NULL' : ' NOT NULL');
        }).join(', ') };
    });
}

module.exports = {
    id: '018-id-columns-collation-bin',
    description: '식별자·이름 컬럼(lookup pi/sri/spi/rn/lbl/acpi · ae.aei · csi · 모든 cr · cin.pi · sub.pi)을 utf8mb3_bin 으로, rn·sri·spi 는 200 으로 (표 재작성, 점검 창)',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        columns(ctx, function (err, cols) {
            if (err) { return cb(err, null); }
            var todo = plan(cols);
            if (todo.length === 0) { return cb(null, '전부 ' + WANT + ' 이고 rn·sri·spi 가 200 — 이미 맞다'); }
            var lines = cols.map(function (c) {
                var s = '  ' + c.table + '.' + c.col + ' ' + c.coll;
                if (c.coll !== WANT) { s += ' → ' + WANT; }
                if (wanted_type(c) !== c.type) { s += ' · ' + c.type + ' → ' + wanted_type(c); }
                return s;
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
