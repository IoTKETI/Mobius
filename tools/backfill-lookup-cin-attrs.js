'use strict';
// lookup.cs / lookup.cnf 를 cin 에서 채운다 (011 이 만든 빈 컬럼).
//
//   node tools/backfill-lookup-cin-attrs.js --check        얼마나 남았나
//   node tools/backfill-lookup-cin-attrs.js --run          시작 / 이어서
//   node tools/backfill-lookup-cin-attrs.js --run --chunk 5000 --sleep 20
//
// ── 왜 도구인가 (마이그레이션이 아니라) ──────────────────────────────────
// 배포에서 1억 4,560만 행을 갱신하는 일이라 몇 시간이 걸린다. 마이그레이션
// 러너는 한 번에 끝나는 것을 전제로 만들어져 있고, 중단·재개·진척 표시가 없다.
// 그래서 데이터 이동은 도구가 맡고, "끝났다" 를 기록하는 것만 마이그레이션
// (012)이 맡는다. 읽기 경로는 그 기록을 보고 전환한다.
//
// ── 왜 안전한가 ─────────────────────────────────────────────────────────
// 1. **되돌릴 필요가 없다.** 값을 채우기만 하고 지우지 않는다. 원본은 cin 에
//    그대로 있다. 틀리면 다시 돌리면 된다.
// 2. **읽는 쪽이 아직 안 본다.** discovery 는 여전히 cin 을 조인한다.
//    이 컬럼이 반쯤 채워져 있어도 답이 바뀌지 않는다. 3단계가 되어야 본다.
// 3. **이미 채운 행은 건너뛴다** (`and r.cs is null`). 그래서 중단하고 다시
//    돌려도 처음부터 하지 않는다. 커서 파일이 없어도 진도가 유지된다.
// 4. **CIN 이 아닌 행은 안 건드린다.** cin 에 짝이 없으면 조인이 안 걸린다.
//
// ── 왜 ri 로 자르는가 ───────────────────────────────────────────────────
// lookup 과 cin 둘 다 ri_UNIQUE 를 갖고 있어 양쪽에서 범위 접근이 된다.
// pi 로 자르면 한 부모에 590만 건이 몰린 컨테이너에서 청크가 통째로 커진다.
//
// ── 운영 중인 서버다 ────────────────────────────────────────────────────
// 초당 25.9건이 계속 들어온다. 청크마다 쉬어 주고(--sleep), 한 청크를
// 작게 잡는다. Ctrl+C 로 언제든 멈출 수 있고 진행분은 그대로 남는다.

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

var CHUNK = opt('--chunk', 2000);      // 한 번에 갱신할 cin 행 수
var SLEEP = opt('--sleep', 25);        // 청크 사이 쉬는 시간(ms)
var LIMIT = opt('--max-chunks', 0);    // 0 이면 끝까지

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
catch (e) { /* 없으면 기본값 */ }

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

db.connect('localhost', 3306, 'root', conf.dbpass || '', function (rsc) {
    if (rsc !== '1') { console.error('DB 연결 실패: ' + rsc); process.exit(1); }
    db.getConnection(function (code, conn) {
        if (code !== '200') { console.error('커넥션 획득 실패: ' + code); process.exit(1); }
        if (flag('--check')) { return check(conn); }
        run(conn);
    });
});

// 남은 양을 **어림한다.** 전수 count 는 내지 않는다 — cin 1억4,560만 행이다.
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

            // 표본으로 남은 비율을 본다. 상한을 걸어 무겁지 않게.
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

        // 다음 경계를 찾는다. cin.ri_UNIQUE 를 타는 범위 접근이다.
        db.run(db.raw(
            "select /*+ MAX_EXECUTION_TIME(30000) */ ri from cin" +
            " where ri > ? order by ri limit 1 offset " + (CHUNK - 1),
            [s.last_ri]),
            conn, function (err, rows) {
                if (err) { return fail('경계 조회', rows); }

                var bound = (rows && rows[0]) ? rows[0].ri : null;
                var tail = (bound === null);   // 남은 것이 CHUNK 보다 적다 = 마지막

                // r.cs is null 로 이미 채운 행을 건너뛴다. 그래서 다시 돌려도
                // 처음부터 하지 않고, 새로 만들어진 CIN(쓰기 경로가 이미 채운다)도
                // 건드리지 않는다.
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
        try { db.release(conn); } catch (e) { /* 이미 닫혔으면 그만 */ }
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
        try { db.release(conn); } catch (e) { /* 이미 닫혔으면 그만 */ }
        process.exit(0);
    }
}
