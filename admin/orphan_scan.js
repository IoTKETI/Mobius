'use strict';
/**
 * 고아 탐지 작업.
 *
 * 화면이 열릴 때 lookup 을 훑던 것(라이브 스캔)을 없앴다 — 설계의 명시적 비목표였고
 * 배포 lookup 은 5,740만 행이다. 대신 관리자가 "탐지 시작" 을 누르면 jobs.js 작업
 * 하나가 조각(chunk 행)으로 전진하며 scanCap 까지만 훑고, 표본(sampleCap)을 파일로
 * 남긴다. 화면은 마지막 파일만 본다.
 *
 * 두 단계다: (1) 부모가 lookup 에 없는 행(select_orphan_page) (2) cin 에 없는데
 * lookup 에 ty=4 로 남은 행(select_lookup_only_cin_page, 인수인계 §6). 둘 다 세지
 * 않는다 — 표본만.
 */
var crypto = require('crypto');
var data_dir = require('./data_dir');

exports.start = function (ctx, opts) {
    var o = opts || {};
    var scanCap = Math.min(parseInt(o.scanCap, 10) || 200000, 2000000);
    var chunk = Math.min(parseInt(o.chunk, 10) || 5000, 50000);
    var sampleCap = Math.min(parseInt(o.sampleCap, 10) || 1000, 5000);
    var chunks = Math.ceil(scanCap / chunk);

    var runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15) + '-' + crypto.randomBytes(2).toString('hex');
    var result = {
        runId: runId, startedAt: new Date().toISOString(), endedAt: null, cancelled: false,
        scanCap: scanCap, sampleCap: sampleCap,
        scanned: 0, scanCapped: false, orphans: [], sampleTruncated: false,
        lookupOnlyCin: { rows: [], scanned: 0, scanCapped: false, sampleTruncated: false }
    };
    // 단계마다 커서 하나. stage 1 이 끝나면(더 없음) stage 2 로 넘어간다.
    var stage = 1;
    var cursor = null;
    var exhausted = false;

    function borrow(fn) {
        ctx.db.getConnection(function (code, conn) {
            if (code !== '200') { return fn('database unavailable (' + code + ')', null, function () {}); }
            var released = false;
            fn(null, conn, function () { if (released) { return; } released = true; ctx.db.release(conn); });
        });
    }

    function worker(chunkNo, cb) {
        if (exhausted) { return cb('skipped', '끝'); }
        borrow(function (err, conn, done) {
            if (err) { done(); return cb('failed', err); }
            if (stage === 1) {
                ctx.db_sql.select_orphan_page(conn, { limit: sampleCap, afterRi: cursor, scanCap: chunk }, function (e, page) {
                    done();
                    if (e) { return cb('failed', String((page && page.message) || e)); }
                    result.scanned += page.scanned;
                    page.rows.forEach(function (r) {
                        if (result.orphans.length < sampleCap) { result.orphans.push({ ri: r.ri, pi: r.pi, ty: r.ty, rn: r.rn, ct: r.ct }); }
                        else { result.sampleTruncated = true; }
                    });
                    if (page.more && page.nextRi) { cursor = page.nextRi; }
                    else { stage = 2; cursor = null; }
                    if (result.scanned >= scanCap && stage === 1) { result.scanCapped = true; exhausted = true; }
                    cb('ok');
                });
                return;
            }
            ctx.db_sql.select_lookup_only_cin_page(conn, { limit: sampleCap, afterRi: cursor, scanCap: chunk }, function (e, page) {
                done();
                if (e) { return cb('failed', String((page && page.message) || e)); }
                var s = result.lookupOnlyCin;
                s.scanned += page.scanned;
                page.rows.forEach(function (r) {
                    if (s.rows.length < sampleCap) { s.rows.push({ ri: r.ri, pi: r.pi, rn: r.rn, ct: r.ct }); }
                    else { s.sampleTruncated = true; }
                });
                if (page.more && page.nextRi) { cursor = page.nextRi; } else { exhausted = true; }
                if (s.scanned >= scanCap) { s.scanCapped = true; exhausted = true; }
                cb('ok');
            });
        });
    }

    var targets = [];
    for (var i = 0; i < chunks * 2; i++) { targets.push(i); }   // 두 단계 × 조각 수

    return ctx.jobs.start({
        kind: 'orphan-scan',
        title: '고아 탐지 (상한 ' + scanCap.toLocaleString() + '행 · 표본 ' + sampleCap + ')',
        note: '세지 않고 표본만 뽑는다. 삭제는 결과에서 골라 따로 시작한다.',
        targets: targets,
        keyOf: function (t) { return 'chunk-' + t; },
        concurrency: 1,
        worker: worker,
        onFinish: function (job) {
            result.endedAt = new Date().toISOString();
            result.cancelled = job.state === 'cancelled';
            var file = data_dir.file(ctx.dataDir, 'orphans', runId + '.json');
            data_dir.writeJson(file, result);
            data_dir.keepLatest(ctx.dataDir, 'orphans', 20);
        }
    });
};
