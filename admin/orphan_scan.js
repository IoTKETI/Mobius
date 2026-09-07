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

/** 마지막 탐지 결과(깨진 파일은 건너뛴다). 이어서 훑기가 커서를 여기서 가져온다. */
function last_result(ctx) {
    var list = data_dir.listJson(ctx.dataDir, 'orphans').filter(function (x) { return !x.broken; });
    if (!list.length) { return null; }
    var r = data_dir.readJson(list[0].path);
    return (r && r.resume) ? r : null;
}
exports.lastResult = last_result;

exports.start = function (ctx, opts) {
    var o = opts || {};
    var scanCap = Math.min(parseInt(o.scanCap, 10) || 200000, 2000000);
    var chunk = Math.min(parseInt(o.chunk, 10) || 5000, 50000);
    var sampleCap = Math.min(parseInt(o.sampleCap, 10) || 1000, 5000);
    var chunks = Math.ceil(scanCap / chunk);

    /*
     * 이어서 훑기.
     *
     * 예전에는 누를 때마다 표의 맨 앞부터 다시 읽었다. 로컬(2,780행)에서는 한 번에 끝까지
     * 읽으니 티가 안 났지만, 배포는 lookup 이 5,740만 행이라 상한 20만 행이면 **앞의 0.35%
     * 만 보고 멈추고, 다시 눌러도 또 같은 0.35% 를 본다.** 나머지는 영영 못 본다
     * (사용자 지적 2026-09-07).
     *
     * 그래서 멈춘 자리(단계별 커서)를 결과 파일에 남기고, 다음 실행이 이어받는다. 표본과
     * 훑은 행 수도 물려받아 누적한다. 상한은 **이번 실행이 더 읽을 양**이다 — 누적이 아니다.
     */
    // 이어받을 수 있다고 **앞의 결과가 스스로 말할 때만** 이어받는다. 끝까지 다 본 결과를
    // 이어받으면 누적 카운터와 표본이 두 번 쌓여 표를 두 번 센 것처럼 보인다.
    var prevRaw = o.resume ? last_result(ctx) : null;
    var prev = (prevRaw && prevRaw.resumable) ? prevRaw : null;
    var seed = prev || {
        scanned: 0, orphans: [], sampleTruncated: false,
        lookupOnlyCin: { rows: [], scanned: 0, sampleTruncated: false },
        resume: { s1: { cursor: null, done: false }, s2: { cursor: null, done: false } },
        runs: 0
    };

    var runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15) + '-' + crypto.randomBytes(2).toString('hex');
    var result = {
        runId: runId, startedAt: new Date().toISOString(), endedAt: null, cancelled: false,
        scanCap: scanCap, sampleCap: sampleCap,
        // 이번 실행이 앞의 결과를 이어받았는가. runs 는 그 사슬의 길이다.
        continued: !!prev, runs: (seed.runs || 0) + 1,
        // scanned·orphans 는 **누적**이다. scanCapped 는 이번 실행이 상한에서 멈췄는가다.
        scanned: seed.scanned, scanCapped: false,
        orphans: seed.orphans.slice(), sampleTruncated: seed.sampleTruncated,
        lookupOnlyCin: {
            rows: seed.lookupOnlyCin.rows.slice(), scanned: seed.lookupOnlyCin.scanned,
            scanCapped: false, sampleTruncated: seed.lookupOnlyCin.sampleTruncated
        },
        resume: {
            s1: { cursor: seed.resume.s1.cursor, done: seed.resume.s1.done },
            s2: { cursor: seed.resume.s2.cursor, done: seed.resume.s2.done }
        },
        resumable: false, complete: false
    };

    var st = result.resume;
    // 아직 표 끝을 못 본 단계부터 시작한다(이어받지 않았으면 둘 다 처음이라 1단계다).
    var stage = st.s1.done ? 2 : 1;
    var cursor = (stage === 1) ? st.s1.cursor : st.s2.cursor;
    // 이번 실행이 읽은 행. 상한은 여기에 건다 — 누적에 걸면 이어서 훑기가 즉시 멈춘다.
    // **단계마다 따로 센다** — 1단계가 예산을 다 썼다고 2단계를 굶기지 않는다(검토 fix round 1).
    var runScanned = { s1: 0, s2: 0 };
    var exhausted = false;

    function borrow(fn) {
        ctx.db.getConnection(function (code, conn) {
            if (code !== '200') { return fn('database unavailable (' + code + ')', null, function () {}); }
            var released = false;
            fn(null, conn, function () { if (released) { return; } released = true; ctx.db.release(conn); });
        });
    }

    /**
     * 진행을 조각이 아니라 **훑은 행**으로 말한다. 조각 수는 상한을 조각 크기로 나눈
     * 최대치일 뿐이라 "2 / 2 · 처리 2" 가 무엇의 2인지 읽히지 않았다(사용자 지적).
     * 상한은 제목에 이미 있고 단계마다 따로 걸리므로 여기서는 합계만 말한다.
     */
    function bump() {
        if (job) { job.setProgress('훑은 행', result.scanned + result.lookupOnlyCin.scanned); }
    }

    /** 이 단계는 여기까지다. 아직 표 끝을 못 본 다음 단계로 넘어가고, 없으면 끝낸다. */
    function advance() {
        if (stage === 1 && !st.s2.done) { stage = 2; cursor = st.s2.cursor; return; }
        exhausted = true;
    }

    function worker(chunkNo, cb) {
        // 정상 경로에서는 여기 안 온다 — doneEarly 가 먼저 끝낸다(동시 실행 1). 방어선이다.
        if (exhausted) { return cb('skipped', '훑기가 이미 끝난 뒤였다', 'settled'); }
        borrow(function (err, conn, done) {
            if (err) { done(); return cb('failed', err); }
            if (stage === 1) {
                ctx.db_sql.select_orphan_page(conn, { limit: sampleCap, afterRi: cursor, scanCap: chunk }, function (e, page) {
                    done();
                    if (e) { return cb('failed', String((page && page.message) || e)); }
                    result.scanned += page.scanned;
                    runScanned.s1 += page.scanned;
                    page.rows.forEach(function (r) {
                        if (result.orphans.length < sampleCap) { result.orphans.push({ ri: r.ri, pi: r.pi, ty: r.ty, rn: r.rn, ct: r.ct }); }
                        else { result.sampleTruncated = true; }
                    });
                    // 어느 갈래든 커서를 남긴다 — 다음 실행이 여기서 이어받는다.
                    if (page.nextRi) { st.s1.cursor = page.nextRi; }
                    if (result.orphans.length >= sampleCap) {
                        result.sampleTruncated = true;
                        advance();
                    } else if (runScanned.s1 >= scanCap) {
                        result.scanCapped = true;
                        advance();
                    } else if (page.nextRi && (page.more || page.scanCapped)) {
                        cursor = page.nextRi;
                    } else {
                        // !page.more && !page.scanCapped — 정말 테이블 끝이다.
                        st.s1.done = true; st.s1.cursor = null;
                        advance();
                    }
                    bump();
                    cb('ok');
                });
                return;
            }
            ctx.db_sql.select_lookup_only_cin_page(conn, { limit: sampleCap, afterRi: cursor, scanCap: chunk }, function (e, page) {
                done();
                if (e) { return cb('failed', String((page && page.message) || e)); }
                var s = result.lookupOnlyCin;
                s.scanned += page.scanned;
                runScanned.s2 += page.scanned;
                page.rows.forEach(function (r) {
                    if (s.rows.length < sampleCap) { s.rows.push({ ri: r.ri, pi: r.pi, rn: r.rn, ct: r.ct }); }
                    else { s.sampleTruncated = true; }
                });
                if (page.nextRi) { st.s2.cursor = page.nextRi; }
                if (s.rows.length >= sampleCap) {
                    s.sampleTruncated = true;
                    exhausted = true;
                } else if (runScanned.s2 >= scanCap) {
                    s.scanCapped = true;
                    exhausted = true;
                } else if (page.nextRi && (page.more || page.scanCapped)) {
                    cursor = page.nextRi;
                } else {
                    // !page.more && !page.scanCapped — 정말 테이블 끝이다.
                    st.s2.done = true; st.s2.cursor = null;
                    exhausted = true;
                }
                bump();
                cb('ok');
            });
        });
    }

    var targets = [];
    for (var i = 0; i < chunks * 2; i++) { targets.push(i); }   // 두 단계 × 조각 수

    // worker·onFinish 가 이 변수를 본다. 둘 다 start 가 돌아온 뒤에 불린다(worker 는
    // setImmediate, onFinish 는 끝날 때) — 그래서 이 시점에 비어 있어도 된다.
    var job = ctx.jobs.start({
        kind: 'orphan-scan',
        title: (prev ? '미연결 이어서 훑기' : '미연결 탐지') +
               ' (상한 ' + scanCap.toLocaleString() + '행 · 표본 ' + sampleCap + ')',
        note: '전체 건수는 세지 않고 표본만 모읍니다(최대 ' + sampleCap.toLocaleString() + '건). ' +
              '이 작업은 아무것도 지우지 않습니다 — 결과에서 지울 것을 골라 삭제를 따로 시작하세요.',
        targets: targets,
        keyOf: function (t) { return 'chunk-' + t; },
        concurrency: 1,
        // 조각 수는 상한을 조각 크기로 나눈 **최대치**다. 표가 작거나 표본이 먼저 차면
        // 몇 조각 만에 끝난다. 남은 조각을 '건너뜀' 으로 세면 정리가 덜 된 것처럼 보이므로
        // (실측: 상한 100만 → 조각 400개 중 2개만 일하고 398 건너뜀) 세는 대신 여기서 끝낸다.
        doneEarly: function () { return exhausted; },
        worker: worker,
        onFinish: function (j) {
            result.endedAt = new Date().toISOString();
            result.cancelled = j.state === 'cancelled';

            // 이어서 훑을 수 있는가. 표본이 이미 찼으면 더 훑어도 담을 데가 없다 —
            // 그때는 찾은 것을 정리하는 것이 다음 할 일이지 더 훑는 것이 아니다.
            var sampleFull = result.sampleTruncated || result.lookupOnlyCin.sampleTruncated;
            result.complete = st.s1.done && st.s2.done;
            result.resumable = !result.complete && !sampleFull && !!(st.s1.cursor || st.s2.cursor);

            // 무엇을 찾았는지는 이 작업만 안다. 화면은 이 한 줄을 그대로 쓴다.
            var runRows = runScanned.s1 + runScanned.s2;
            var allRows = result.scanned + result.lookupOnlyCin.scanned;
            var found = '미연결 ' + result.orphans.length.toLocaleString() + '건, lookup 에만 남은 CIN ' +
                        result.lookupOnlyCin.rows.length.toLocaleString() + '건';
            var s = result.continued
                ? '이번에 ' + runRows.toLocaleString() + '행을 더 훑었습니다(누적 ' +
                  allRows.toLocaleString() + '행). ' + found + '을 찾았습니다.'
                : allRows.toLocaleString() + '행을 훑어 ' + found + '을 찾았습니다.';
            if (sampleFull) {
                s += ' 표본 상한에 걸렸습니다 — 찾은 것을 정리한 뒤 다시 훑으세요.';
            } else if (result.resumable) {
                s += ' 아직 남았습니다 — "이어서 훑기" 로 계속하세요.';
            } else if (result.complete) {
                s += ' 표를 끝까지 다 봤습니다.';
            }
            j.setSummary(s);

            var file = data_dir.file(ctx.dataDir, 'orphans', runId + '.json');
            data_dir.writeJson(file, result);
            data_dir.keepLatest(ctx.dataDir, 'orphans', 20);
        }
    });
    return job;
};
