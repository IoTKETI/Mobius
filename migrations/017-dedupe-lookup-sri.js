'use strict';
// lookup.sri 중복 정리 (ri/sri 설계 메모 docs/superpowers/specs/2026-09-06-ri-sri-design.md §3 A1).
//
// ── 왜 ──────────────────────────────────────────────────────────────────
// 옛 sri 생성기는 `ty-YYYYMMDDHHmmssSSS` 뒤에 난수 세 자리를 붙였다. 워커 24개가 각자
// 만드니 같은 ms 에 두 건이 나면 1/1000 로 겹친다. 배포 실측(2026-09-06): 중복 sri 가
// 7월 9 · 8월 16 · 9월 1~6일 14 묶음(각 2행). idx_lookup_sri 가 비유일이라 DB 도 막지
// 못했고, 겹친 두 리소스는 밖으로 같은 ri(resourceID) 를 내보낸다 — id 로 찾으면
// 먼저 오는 행이 이긴다. 생성기는 mobius/short_ri.js 로 바꿨다. 이것은 남은 행의 정리다.
//
// ── 무엇을 하나 ─────────────────────────────────────────────────────────
// 묶음마다 (ct, ri) 순 첫 행을 남기고 나머지에 새 sri 를 매긴다. 그 행에 자식이 있으면
// 자식의 spi(부모의 짧은 id)도 같이 바꾼다 — `pi = 그 행.ri and spi = 옛 sri`, PK 접두라
// 인덱스를 탄다. AE(ty=2) 는 sri 가 aei 이고 ae.aei 가 따로 UNIQUE 라 손대지 않고
// 보고만 한다. CSEBase(ty=5) 도 마찬가지다.
//
// 전수 `group by sri` 는 인덱스만 타지만 6,200만 행이라 분 단위다 — timeoutMs 0.
// 데이터를 바꾸는 마이그레이션이라 autoApply 는 없다. UNIQUE 인덱스는 이것이 0 이 된
// 뒤 별도 DDL(점검 창)로 건다.

var short_ri = require('../mobius/short_ri');

var UNTOUCHED = { 2: 'AE', 5: 'CSEBase' };

function groups(ctx, cb) {
    ctx.db.run(ctx.db.raw('select sri, count(*) as n from lookup group by sri having count(*) > 1'), ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows || []).map(function (r) { return { sri: r.sri || r.SRI, n: parseInt(r.n || r.N, 10) }; }));
        }, { timeoutMs: 0 });
}

function members(ctx, sri, cb) {
    ctx.db.run(ctx.db.raw('select ri, ty, ct from lookup where sri = ? order by ct asc, ri asc', [sri]), ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows || []).map(function (r) {
                return { ri: r.ri || r.RI, ty: parseInt(r.ty || r.TY, 10), ct: r.ct || r.CT };
            }));
        });
}

// 묶음을 분류한다 — 손댈 것과 보고만 할 것
function classify(ctx, list, cb) {
    var out = { rekey: [], untouched: [] };
    (function next(i) {
        if (i >= list.length) { return cb(null, out); }
        members(ctx, list[i].sri, function (err, rows) {
            if (err) { return cb(err, rows); }
            var kind = null;
            rows.forEach(function (r) { if (UNTOUCHED[r.ty]) { kind = UNTOUCHED[r.ty]; } });
            if (kind) { out.untouched.push({ sri: list[i].sri, kind: kind, n: rows.length }); }
            else { out.rekey.push({ sri: list[i].sri, rows: rows }); }
            next(i + 1);
        });
    })(0);
}

module.exports = {
    id: '017-dedupe-lookup-sri',
    description: 'lookup.sri 중복 정리 — 묶음마다 (ct, ri) 순 첫 행을 남기고 나머지에 새 sri, 자식 spi 도 따라감',
    backends: ['mysql', 'sqlite'],

    inspect: function (ctx, cb) {
        groups(ctx, function (err, list) {
            if (err) { return cb(err, null); }
            if (list.length === 0) { return cb(null, '중복 sri 없음 — 적용하면 이력만 남긴다'); }
            classify(ctx, list, function (err2, c) {
                if (err2) { return cb(err2, null); }
                var rows = list.reduce(function (s, g) { return s + g.n; }, 0);
                var lines = ['중복 sri 묶음 ' + list.length + ' (행 ' + rows + ') — 다시 매길 묶음 ' + c.rekey.length +
                             ', 손대지 않을 AE·CSEBase 묶음 ' + c.untouched.length];
                c.rekey.slice(0, 5).forEach(function (g) {
                    lines.push('  ' + g.sri + ' x' + g.rows.length + ' — 남김 ' + g.rows[0].ri);
                });
                c.untouched.forEach(function (u) { lines.push('  ' + u.sri + ' x' + u.n + ' — ' + u.kind + ', 손대지 않는다'); });
                cb(null, '\n' + lines.join('\n'));
            });
        });
    },

    up: function (ctx, cb) {
        groups(ctx, function (err, list) {
            if (err) { return cb(err, list); }
            classify(ctx, list, function (err2, c) {
                if (err2) { return cb(err2, c); }
                c.untouched.forEach(function (u) {
                    console.log('    손대지 않는다: ' + u.sri + ' x' + u.n + ' (' + u.kind + ' — sri 가 aei/CSEBase id)');
                });
                var rekeyed = 0, children = 0;
                var work = [];
                c.rekey.forEach(function (g) {
                    g.rows.slice(1).forEach(function (r) { work.push({ row: r, old: g.sri }); });
                });
                (function next(i) {
                    if (i >= work.length) {
                        if (rekeyed) { console.log('    sri 다시 매김 ' + rekeyed + '행, 자식 spi 갱신 ' + children + '행'); }
                        return cb(null, { affectedRows: rekeyed, children: children, untouched: c.untouched.length });
                    }
                    var w = work[i];
                    var fresh = short_ri.generate(w.row.ty + '-');
                    ctx.db.run(ctx.db.raw('update lookup set sri = ? where ri = ? and sri = ?', [fresh, w.row.ri, w.old]), ctx.conn,
                        function (uerr, ures) {
                            if (uerr) { return cb(uerr, ures); }
                            rekeyed += (ures && ures.affectedRows) || 0;
                            ctx.db.run(ctx.db.raw('update lookup set spi = ? where pi = ? and spi = ?', [fresh, w.row.ri, w.old]), ctx.conn,
                                function (cerr, cres) {
                                    if (cerr) { return cb(cerr, cres); }
                                    children += (cres && cres.affectedRows) || 0;
                                    next(i + 1);
                                });
                        });
                })(0);
            });
        });
    }
};
