'use strict';
// Fills lookup.cs / lookup.cnf from cin (the columns 011 created empty).
//
//   node tools/backfill-lookup-cin-attrs.js --check        how much is left
//   node tools/backfill-lookup-cin-attrs.js --run          start / resume
//   node tools/backfill-lookup-cin-attrs.js --run --chunk 5000 --sleep 20
//
// ── A tool, not a migration ──
// Updating every CIN row takes hours on a large deployment. The migration runner assumes a job that finishes in one go and has no interrupt, resume or progress output, so the data movement is a tool and only the 'done' record is a migration (012), which switches the read path.
//
// ── Safety ──
// 1. Nothing to roll back: values are only filled, never deleted; the originals stay in cin.
// 2. The read path does not look yet: discovery still joins cin, so a half-filled column does not change answers.
// 3. Rows already filled are skipped (`and r.cs is null`), so an interrupted run resumes without starting over, even without the cursor file.
// 4. Non-CIN rows are untouched: without a cin partner the join does not match.
//
// ── Chunking by ri ──
// lookup and cin both have ri_UNIQUE, so range access works on both sides. Chunking by pi would make one chunk as large as the biggest container.
//
// ── The server is live ──
// Writes keep arriving, so each chunk is small and followed by a pause (--sleep). Ctrl+C stops at any time and progress is kept.

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var STATE = path.join(ROOT, '.backfill-lookup-cin-attrs.json');

var argv = process.argv.slice(2);
function flag(name) { return argv.indexOf(name) >= 0; }
function opt(name, dflt) {
    var i = argv.indexOf(name);
    if (i < 0 || i + 1 >= argv.length) { return dflt; }
    var n = parseInt(argv[i + 1], 10);
    return isNaN(n) ? dflt : n;
}

var CHUNK = opt('--chunk', 2000);      // cin rows updated per chunk
var SLEEP = opt('--sleep', 25);        // pause between chunks (ms)
var LIMIT = opt('--max-chunks', 0);    // 0 means run to the end

if (!flag('--check') && !flag('--run')) {
    console.log('사용법:');
    console.log('  node tools/backfill-lookup-cin-attrs.js --check');
    console.log('  node tools/backfill-lookup-cin-attrs.js --run [--chunk N] [--sleep MS] [--max-chunks N]');
    console.log('');
    console.log('--check  남은 양을 어림한다 (전수 count 를 안 낸다 — cin 이 1억4천만 행이다)');
    console.log('--run    채운다. 중단해도 진행분은 남고, 다시 돌리면 이어서 한다.');
    process.exit(2);
}

var conf = {};
try { conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'conf.json'), 'utf8')); }
catch (e) { /* defaults when absent */ }

global.usedb = conf.db || 'mysql';
var db = require(path.join(ROOT, 'mobius', 'db'));

if (db.backendName && db.backendName() !== 'mysql') {
    console.error('이 도구는 MySQL 전용이다 (지금 백엔드: ' + db.backendName() + ').');
    console.error('SQLite 는 새로 만들 때 스키마가 이미 컬럼을 갖고 있어 백필이 필요 없다.');
    process.exit(1);
}

function readState() {
    try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
    catch (e) { return { last_ri: '', done: 0, chunks: 0 }; }
}
function writeState(s) {
    try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); }
    catch (e) { console.error('  (진행 상황을 못 적었다: ' + e.message + ')'); }
}

var stopping = false;
process.on('SIGINT', function () {
    if (stopping) { process.exit(130); }
    stopping = true;
    console.log('\n중단 요청 — 지금 청크를 끝내고 멈춘다. 진행분은 남는다.');
});

function human(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// applyConf before connect: the adapter reads its coordinates (password included) from conf, so without this line the adapter's conf stays {} and it connects with an empty password. test/db-conf-wiring.test.js keeps this order.
db.applyConf(conf);
db.connect(function (rsc) {
    if (rsc !== '1') { console.error('DB 연결 실패: ' + rsc); process.exit(1); }
    db.getConnection(function (code, conn) {
        if (code !== '200') { console.error('커넥션 획득 실패: ' + code); process.exit(1); }
        if (flag('--check')) { return check(conn); }
        run(conn);
    });
});

// Estimates what is left; no full count on a very large cin.
function check(conn) {
    db.run(db.raw(
        "select table_rows as n from information_schema.tables" +
        " where table_schema = database() and table_name = 'cin'"),
        conn, function (err, rows) {
            var total = (rows && rows[0]) ? Number(rows[0].n) : 0;
            var s = readState();
            console.log('cin 총 행수(근사)   ' + human(total));
            console.log('지금까지 갱신       ' + human(s.done) + ' (청크 ' + human(s.chunks) + ')');
            console.log('마지막 ri           ' + (s.last_ri || '(처음부터)'));

            // A sample shows the remaining ratio, bounded so it stays cheap.
            db.run(db.raw(
                "select /*+ MAX_EXECUTION_TIME(10000) */" +
                " sum(cs is null) as empty_n, count(*) as n from" +
                " (select cs from lookup where ty = 4 order by ri desc limit 20000) t"),
                conn, function (e2, r2) {
                    if (!e2 && r2 && r2[0]) {
                        console.log('표본 2만건 중 빈 값  ' + human(r2[0].empty_n) + ' / ' + human(r2[0].n) +
                                    '  (ri 내림차순 = 최근 것)');
                    }
                    db.release(conn);
                    process.exit(0);
                });
        });
}

function run(conn) {
    var s = readState();
    var started = Date.now();
    var startedDone = s.done;

    console.log('백필 시작 — 청크 ' + human(CHUNK) + '행, 청크 사이 ' + SLEEP + 'ms 휴식');
    console.log('이어서 시작할 ri: ' + (s.last_ri || '(처음부터)'));
    console.log('멈추려면 Ctrl+C — 진행분은 남는다.\n');

    var chunkCount = 0;

    (function next() {
        if (stopping) { return finish(); }
        if (LIMIT && chunkCount >= LIMIT) { return finish('--max-chunks 도달'); }

        // Finds the next boundary: a range access on cin.ri_UNIQUE.
        db.run(db.raw(
            "select /*+ MAX_EXECUTION_TIME(30000) */ ri from cin" +
            " where ri > ? order by ri limit 1 offset " + (CHUNK - 1),
            [s.last_ri]),
            conn, function (err, rows) {
                if (err) { return fail('경계 조회', rows); }

                var bound = (rows && rows[0]) ? rows[0].ri : null;
                var tail = (bound === null);   // fewer than CHUNK left = the last chunk

                // r.cs is null skips rows already filled, so a re-run does not start over and CINs created since (the write path fills them) are not touched.
                var where = tail
                    ? ' where r.ri > ? and r.cs is null'
                    : ' where r.ri > ? and r.ri <= ? and r.cs is null';
                var binds = tail ? [s.last_ri] : [s.last_ri, bound];

                db.run(db.raw(
                    'update lookup r join cin c on c.ri = r.ri' +
                    ' set r.cs = c.cs, r.cnf = c.cnf' + where, binds),
                    conn, function (uerr, ures) {
                        if (uerr) { return fail('갱신', ures); }

                        var n = (ures && ures.affectedRows) || 0;
                        s.done += n;
                        s.chunks += 1;
                        chunkCount += 1;
                        if (!tail) { s.last_ri = bound; }
                        writeState(s);

                        if (s.chunks % 20 === 0 || tail) {
                            var secs = (Date.now() - started) / 1000;
                            var rate = secs > 0 ? Math.round((s.done - startedDone) / secs) : 0;
                            console.log('  청크 ' + human(s.chunks) +
                                        '  누적 ' + human(s.done) + '행' +
                                        '  ' + human(rate) + '행/초' +
                                        '  ri=' + String(s.last_ri).slice(0, 46));
                        }

                        if (tail) { return finish('끝까지 갔다'); }
                        setTimeout(next, SLEEP);
                    }, { timeoutMs: 0 });
            }, { timeoutMs: 0 });
    })();

    function fail(what, res) {
        console.error('\n' + what + ' 실패: ' + ((res && (res.sqlMessage || res.message)) || res));
        console.error('진행분은 남아 있다. 고친 뒤 --run 으로 다시 돌리면 이어서 한다.');
        writeState(s);
        try { db.release(conn); } catch (e) { /* ignore if already closed */ }
        process.exit(1);
    }

    function finish(why) {
        var secs = (Date.now() - started) / 1000;
        console.log('\n멈춤' + (why ? ' (' + why + ')' : '') +
                    ' — 이번에 ' + human(s.done - startedDone) + '행, ' +
                    Math.round(secs) + '초');
        console.log('누적 ' + human(s.done) + '행 / 청크 ' + human(s.chunks));
        console.log('마지막 ri: ' + s.last_ri);
        writeState(s);
        try { db.release(conn); } catch (e) { /* ignore if already closed */ }
        process.exit(0);
    }
}
