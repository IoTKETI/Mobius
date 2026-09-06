'use strict';
// lookup 의 remoteCSE(ty=16) 고아 행 제거.
//
// ── 왜 ──────────────────────────────────────────────────────────────────
// csr 테이블은 lookup(ri) 에 ON DELETE CASCADE 외래키가 걸려 있어 lookup 행을
// 지우면 csr 행이 따라 사라진다. 반대 방향은 없다 — csr 행만 사라지면 lookup 에
// ty=16 행이 남는다. 배포 실측(2026-09-06): csr 0행, lookup ty=16 4행(2023년 등록:
// /Mobius/IN-CSE · mn_kyj · rosemary · test_kyj), 자식 0.
//
// 그 행을 조회하면 csr 행이 없어 반쪽 행이 나오고, update_route(fanOutPoint · 그룹
// 생성마다) 가 csr 을 읽을 때는 애초에 안 보인다. 남겨 둘 이유가 없다.
//
// ── 무엇을 지우나 ─────────────────────────────────────────────────────
// ty=16 인데 csr 행이 없고 **자식이 없는** lookup 행만. 자식이 있으면 지우지 않고
// 남긴다(inspect 가 보여 준다) — 부모를 지우면 자식이 또 고아가 된다.
// 이름을 박아 두지 않는다 — 같은 원인으로 또 생기면 다시 돌리면 된다.
//
// 데이터를 지우는 마이그레이션이라 autoApply 는 없다. 되돌릴 수 없지만 잃는 것은
// 2023년 등록의 껍데기뿐이다(csr 본문은 이미 없다).
// SQLite 스키마에는 csr 테이블이 없어 대상이 아니다.

// 세 단계 전부 인덱스만 탄다 — ty=16 은 idx_lookup_ty, csr 은 PK, 자식 수는 PK 접두(pi).
// 처음엔 한 문장(lookup LEFT JOIN csr + 상관 서브쿼리)이었는데 배포에서 드라이버
// 타임아웃에 걸렸다(2026-09-06) — 5,740만 행 테이블을 빈 csr 과 조인하며 옵티마이저가
// 풀스캔을 택한 것으로 보인다. 행 수가 몇 개뿐이니 단순한 질의 셋이 낫다.
function orphans(ctx, cb) {
    ctx.db.run(ctx.db.raw('select ri, ct from lookup where ty = 16'), ctx.conn, function (err, rows) {
        if (err) { return cb(err, rows); }
        var cands = (rows || []).map(function (r) { return { ri: r.ri || r.RI, ct: r.ct || r.CT, kids: 0 }; });
        if (cands.length === 0) { return cb(null, []); }
        ctx.db.run(ctx.db.raw('select ri from csr where ri in (' + cands.map(function () { return '?'; }).join(', ') + ')',
                              cands.map(function (c) { return c.ri; })),
            ctx.conn, function (err2, have) {
                if (err2) { return cb(err2, have); }
                var has = {};
                (have || []).forEach(function (h) { has[h.ri || h.RI] = true; });
                var orphan = cands.filter(function (c) { return !has[c.ri]; });
                (function next(i) {
                    if (i >= orphan.length) { return cb(null, orphan); }
                    ctx.db.run(ctx.db.raw('select count(*) as n from lookup where pi = ?', [orphan[i].ri]), ctx.conn,
                        function (err3, k) {
                            if (err3) { return cb(err3, k); }
                            orphan[i].kids = parseInt((k && k[0] && (k[0].n || k[0].N)) || 0, 10);
                            next(i + 1);
                        });
                })(0);
            });
    });
}

module.exports = {
    id: '016-drop-orphan-csr-lookup',
    description: 'lookup 의 remoteCSE(ty=16) 고아 행 제거 — csr 행이 없고 자식이 없는 것만',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        orphans(ctx, function (err, list) {
            if (err) { return cb(err, null); }
            if (list.length === 0) { return cb(null, '고아 없음 — 적용하면 이력만 남긴다'); }
            cb(null, '\n' + list.map(function (o) {
                return '  ' + o.ri + ' (등록 ' + o.ct + ', 자식 ' + o.kids + (o.kids ? ' — 남긴다' : ' — 지운다') + ')';
            }).join('\n'));
        });
    },

    up: function (ctx, cb) {
        orphans(ctx, function (err, list) {
            if (err) { return cb(err, list); }
            var targets = list.filter(function (o) { return o.kids === 0; });
            var kept = list.filter(function (o) { return o.kids > 0; });
            kept.forEach(function (o) { console.log('    자식이 있어 남긴다: ' + o.ri + ' (자식 ' + o.kids + ')'); });
            if (targets.length === 0) { return cb(null, { affectedRows: 0 }); }
            (function next(i, done) {
                if (i >= targets.length) {
                    console.log('    lookup 의 ty=16 고아 ' + done + '행 삭제');
                    return cb(null, { affectedRows: done });
                }
                ctx.db.run(ctx.db.raw('delete from lookup where ri = ? and ty = 16', [targets[i].ri]), ctx.conn,
                    function (derr, dres) {
                        if (derr) { return cb(derr, dres); }
                        next(i + 1, done + ((dres && dres.affectedRows) || 0));
                    });
            })(0, 0);
        });
    }
};
