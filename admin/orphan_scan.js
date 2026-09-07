'use strict';
/**
 * 미연결 리소스 탐지 작업(화면 말은 "미연결", 코드 이름은 orphan).
 *
 * 화면이 열릴 때 lookup 을 훑던 것(라이브 스캔)을 없앴다 — 설계의 명시적 비목표였고
 * 배포 lookup 은 5,740만 행이다. 대신 관리자가 "탐지 시작" 을 누르면 jobs.js 작업
 * 하나가 조각(chunk 행)으로 전진하며 scanCap 까지만 훑고, 표본(sampleCap)을 파일로
 * 남긴다. 화면은 마지막 파일만 본다.
 *
 * 두 단계다: (1) 부모가 lookup 에 없는 행(select_orphan_page) (2) cin 에 없는데
 * lookup 에 ty=4 로 남은 행(select_lookup_only_cin_page, 인수인계 §6). 둘 다 세지
 * 않는다 — 표본만.
 *
 * 단계 전환 규칙(검토 fix round 1). `page.more:false` 는 "테이블 끝" 이 아니다 —
 * 조각의 scanCap 에 걸려 페이지가 안 찼을 때도 more:false 이고 그때는
 * page.scanCapped:true 다. 그래서 세 조건을 이 순서로 본다:
 *   1) 표본이 찼다(누적 개수가 sampleCap 이상) — 표본만 뽑는 작업이니 더 훑을
 *      이유가 없다. sampleTruncated 를 세우고 다음 단계로.
 *   2) 이 단계의 예산(scanCap)을 다 썼다 — scanCapped 를 세우고 다음 단계로.
 *      **다음 단계는 자기 예산으로 새로 돈다** — 1 단계가 예산을 다 썼다고
 *      2 단계를 굶기지 않는다(exhausted 로 끝내지 않는다).
 *   3) 그 외에는 코어의 신호를 그대로 따른다 — nextRi 가 있고 (more 이거나
 *      scanCapped) 인 동안 커서를 전진해 같은 단계를 계속한다. 아니면(!more
 *      && !scanCapped) 정말 테이블 끝이니 다음 단계로 넘어간다.
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
                    if (result.orphans.length >= sampleCap) {
                        result.sampleTruncated = true;
                        stage = 2; cursor = null;
                    } else if (result.scanned >= scanCap) {
                        result.scanCapped = true;
                        stage = 2; cursor = null;
                    } else if (page.nextRi && (page.more || page.scanCapped)) {
                        cursor = page.nextRi;
                    } else {
                        // !page.more && !page.scanCapped — 정말 테이블 끝이다.
                        stage = 2; cursor = null;
                    }
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
                if (s.rows.length >= sampleCap) {
                    s.sampleTruncated = true;
                    exhausted = true;
                } else if (s.scanned >= scanCap) {
                    s.scanCapped = true;
                    exhausted = true;
                } else if (page.nextRi && (page.more || page.scanCapped)) {
                    cursor = page.nextRi;
                } else {
                    // !page.more && !page.scanCapped — 정말 테이블 끝이다.
                    exhausted = true;
                }
                cb('ok');
            });
        });
    }

    var targets = [];
    for (var i = 0; i < chunks * 2; i++) { targets.push(i); }   // 두 단계 × 조각 수

    return ctx.jobs.start({
        kind: 'orphan-scan',
        title: '미연결 탐지 (상한 ' + scanCap.toLocaleString() + '행 · 표본 ' + sampleCap + ')',
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
