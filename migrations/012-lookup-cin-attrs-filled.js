'use strict';
// Confirms and records that the lookup.cs / lookup.cnf backfill is complete.
//
// ── This migration changes nothing ──
// The values are filled by tools/backfill-lookup-cin-attrs.js, a resumable multi-hour job with progress output; the migration runner assumes a job that finishes in one go. This migration only checks that the backfill is complete and, if so, records it. That record is the switch of the read path: mobius/db_bootstrap.js reads schema_migrations at boot and sets global.lookup_has_cin_attrs.
//
// ── The switch ──
// If discovery read lookup.cs before the backfill is complete, the unfilled old CINs (cs null) would silently disappear from size-filtered results. That is why the switch is not an operator flag: only a passed check writes the record, and only the record changes the read path.
//
// ── The check is slow ──
// 'No fillable row is left unfilled' requires scanning the ty=4 index entries and reading cs; when everything is filled, the scan runs to the end. Run it during a restart window under supervision. Hence no autoApply.
//
// Rollback:
//   delete from schema_migrations where id = '012-lookup-cin-attrs-filled';
// The next boot returns the read path to the cin join. Columns and values stay.

var TIMEOUT_HINT = '\n  * 몇 분 걸린다. 다 채워졌으면 끝까지 훑고 나서야 없다는 것을 안다.';

// Looks for a CIN that is not yet filled. One is enough (limit 1): it returns quickly while rows remain, and takes long only when none is left.
//
// cin is joined because of orphans: a ty=4 lookup row without a cin row has no source to fill from and would keep cs null forever, so the gate asks 'is everything fillable filled', not 'is nothing empty'. The cost is the same (idx_lookup_ty scan plus an eq_ref on ri_UNIQUE for the rare cs-null rows).
//
// Orphans themselves are not fixed here; they are an existing condition unrelated to this work, and the switch does not change how discovery treats them.
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

    // Never add autoApply: the check itself is a scan of several minutes, and passing it changes discovery's behaviour, which an operator must apply knowingly.

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
                // Refuses to apply: recording here would switch the read path and unfilled CINs would silently disappear from discovery results.
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
