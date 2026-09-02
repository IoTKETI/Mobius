'use strict';
// lookup.cs / lookup.cnf 백필이 **끝났다**는 것을 확인하고 기록한다.
//
// ── 이 마이그레이션은 아무것도 바꾸지 않는다 ────────────────────────────
// 값을 채우는 일은 tools/backfill-lookup-cin-attrs.js 가 한다. 1억 4,560만 행에
// 몇 시간이 걸려서 중단·재개와 진척 표시가 필요한데, 마이그레이션 러너는
// 한 번에 끝나는 것을 전제로 만들어져 있다.
//
// 여기가 하는 일은 하나다 — **끝났는지 확인하고, 끝났으면 기록한다.**
// 그 기록이 읽기 경로의 스위치다. mobius/db_bootstrap.js 가 기동 때
// schema_migrations 를 보고 global.lookup_has_cin_attrs 를 세운다.
//
// ── 왜 스위치가 필요한가 ────────────────────────────────────────────────
// 백필이 끝나기 전에 discovery 가 lookup.cs 를 보면 **조용히 틀린다.**
// 아직 안 채워진 옛 CIN 은 cs 가 null 이라, sza=100 이 그것들을 통째로
// 못 찾는다. 에러도 안 나고 결과만 줄어든다.
//
// 사람이 켜는 플래그로 두지 않는 이유가 이것이다 — 일찍 켜면 아무도 모른다.
// 확인을 통과해야만 기록이 남고, 기록이 있어야만 읽기 경로가 바뀐다.
//
// ── 확인이 오래 걸린다 ──────────────────────────────────────────────────
// "채울 수 있는데 아직 안 채워진 행이 하나도 없다" 를 보려면 인덱스를 훑어야
// 한다. idx_lookup_ty(ty) 로 ty=4 를 잡은 뒤 cs 를 봐야 하는데, **다
// 채워졌다면 끝까지 훑고 나서야 없다는 것을 안다.**
//
// 배포 실측: 인덱스 항목 약 3,000만 개. 각 항목마다 행을 읽어 cs 를 본다.
// 인덱스가 PK 순이라 행 접근이 대체로 순차이지만, 그래도 버퍼 풀을 크게
// 휘젓는다. 재기동 창에서 사람이 지켜보며 돌릴 일이다.
//
// 그래서 autoApply 가 없다. 기동 경로에 두면 재기동이 그만큼 멈춘다.
//
// ── 되돌리려면 ──────────────────────────────────────────────────────────
//   delete from schema_migrations where id = '012-lookup-cin-attrs-filled';
// 그러면 다음 기동에서 읽기 경로가 예전(cin 조인)으로 돌아간다.
// 컬럼과 값은 그대로 남으므로 안전하다.

var TIMEOUT_HINT = '\n  * 몇 분 걸린다. 다 채워졌으면 끝까지 훑고 나서야 없다는 것을 안다.';

// 아직 안 채워진 CIN 이 있는지 본다. **하나만 찾으면 된다** — limit 1 이라
// 남은 것이 있으면 금방 끝나고, 없을 때만 오래 걸린다.
//
// ── cin 을 조인하는 이유: 고아 ──────────────────────────────────────────
// 처음에는 'where ty = 4 and cs is null' 이었다. 그런데 배포에서 백필이
// 끝난 뒤에도 이 게이트가 거부했다. 걸린 행을 확인해 보니 **cin 에 대응
// 행이 없었다** — lookup 에만 남은 고아다.
//
//   표본 20건 전부 고아였다 (2026-09-03, 배포 서버 실측)
//
// 고아는 채울 원본이 없다. 백필을 몇 번 돌려도 영원히 cs 가 null 이고,
// 그러면 이 게이트는 영원히 안 열린다.
//
// 게이트가 물어야 하는 것은 "빈 것이 하나도 없나" 가 아니라
// **"채울 수 있는 것이 다 채워졌나"** 다. 그래서 cin 을 조인한다.
//
// 비용은 사실상 같다 (배포 EXPLAIN 실측):
//   r  ref  idx_lookup_ty  rows 29,993,764   ← 예전과 동일
//   c  eq_ref  ri_UNIQUE  Using index        ← cs is null 인 드문 행에만 걸린다
//
// ── 고아 자체는 여기서 안 고친다 ────────────────────────────────────────
// lookup 에 있는데 cin 에 없는 ty=4 행은 **이 작업과 무관한 기존 버그**다.
// 지금도 discovery 가 그 URI 를 결과에 넣는다(없는 리소스를 가리키는 채로).
// 읽기 경로가 바뀌어도 그 동작은 같다 — 예전에는 cin 조인이 떨궈서 크기
// 필터에서 빠졌고, 지금은 cs 가 null 이라 크기 필터에서 빠진다.
// 즉 이 스위치가 고아 문제를 악화시키지 않는다. 정리는 별도 작업이다.
function firstUnfilled(ctx, cb) {
    ctx.db.run(ctx.db.raw(
        'select r.ri from lookup r join cin c on c.ri = r.ri' +
        ' where r.ty = 4 and r.cs is null limit 1'),
        ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows && rows[0]) ? rows[0].ri : null);
        }, { timeoutMs: 0 });
}

module.exports = {
    id: '012-lookup-cin-attrs-filled',
    description: 'lookup.cs / cnf 백필 완료 확인 — 이 기록이 읽기 경로의 스위치다',
    backends: ['mysql'],

    // **절대 autoApply 를 붙이지 마라.** 확인 자체가 몇 분짜리 스캔이다.
    // (그리고 이것이 참이 되면 discovery 의 동작이 바뀐다 — 사람이 알고
    //  적용해야 하는 종류의 변화다.)

    inspect: function (ctx, cb) {
        firstUnfilled(ctx, function (err, ri) {
            if (err) { return cb(err, ri); }
            if (ri === null) {
                return cb(null, '\n  백필 완료 — 적용하면 discovery 가 lookup.cs / cnf 를 본다' +
                                '\n  (지금은 cin 을 조인한다. 적용 후 재기동해야 바뀐다)');
            }
            cb(null, '\n  **아직 안 끝났다.** 안 채워진 CIN 이 있다: ' + ri +
                     '\n  node tools/backfill-lookup-cin-attrs.js --run 으로 마저 채울 것' +
                     TIMEOUT_HINT);
        });
    },

    up: function (ctx, cb) {
        firstUnfilled(ctx, function (err, ri) {
            if (err) { return cb(err, ri); }

            if (ri !== null) {
                // **적용을 거부한다.** 여기서 기록을 남기면 읽기 경로가 바뀌고,
                // 안 채워진 CIN 이 discovery 결과에서 조용히 사라진다.
                console.error('    백필이 안 끝났다. 안 채워진 CIN: ' + ri);
                console.error('    node tools/backfill-lookup-cin-attrs.js --run 을 먼저 끝낼 것');
                return cb(true, {
                    code: 'UNKNOWN',
                    message: '백필 미완료 — lookup.cs 가 null 인 CIN 이 남아 있다 (' + ri + ')'
                });
            }

            console.log('    백필 완료 확인 — 안 채워진 CIN 없음');
            console.log('    재기동하면 discovery 가 lookup.cs / cnf 를 본다');
            cb(null, { affectedRows: 0 });
        });
    }
};
