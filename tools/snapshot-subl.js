'use strict';
/*
 * lookup.subl 을 파일로 떠 둔다. DB 는 읽기만 한다.
 *
 *   node tools/snapshot-subl.js --out <경로>        떠서 파일로 쓴다
 *   node tools/snapshot-subl.js --verify <경로>     파일을 읽어 DB 와 대조한다
 *
 * ── 왜 뜨나 ─────────────────────────────────────────────────────────────
 * subl 은 부모 리소스에 자식 <subscription> 들을 심어 둔 JSON 배열이고,
 * sgn_action 이 sub 테이블이 아니라 이 배열을 훑어 알림을 보낸다.
 * 그런데 둘이 크게 어긋나 있다 (배포 실측, CIN 을 뺀 lookup 34,313행 전수):
 *
 *     subl 항목 14,028   vs   sub 행 3,452
 *     유령 (subl 에만 있고 sub 행이 없다)   9,475건
 *     중복 (같은 subl 에 같은 ri)          1,481묶음
 *     낡은 nu                                194건
 *     침묵 (sub 은 있는데 어느 subl 에도 없다)  21건
 *
 * 유령의 라우팅 정보는 **여기 말고는 없다.** nu/enc/nct/nec/exc/su/bn 을
 * 가진 테이블은 sub 하나뿐이고 유령은 정의상 sub 행이 없다. 즉 "그 구독이
 * 어디로 무엇을 보내고 있었나" 를 아는 사본이 부모의 subl 문자열 하나다.
 *
 * 앞으로 subl 쓰기 경로를 손보면 배열을 통째로 되쓴다. 어떤 부모든 구독
 * 생성/수정/삭제가 한 번만 일어나면 그 부모의 유령은 그 순간 사라지고,
 * 사라진 뒤에는 "무엇이 끊겼나" 에 답할 데이터가 없다. 그래서 먼저 뜬다.
 *
 * ── 왜 테이블이 아니라 파일인가 ─────────────────────────────────────────
 * 이 사본은 사고가 났을 때 딱 한 번 볼 물건이다. 자주 조회할 게 아니라서
 * 배포 DB 에 테이블을 남길 이유가 없다. 파일이면 배포 DB 에 흔적이 0 이고
 * 정리도 파일 삭제 한 번이다.
 *
 * ── 형식 ────────────────────────────────────────────────────────────────
 * gzip 으로 압축한 NDJSON 이다. 첫 줄이 머리(meta), 그 뒤로 한 줄에 한 행씩.
 * 한 줄씩 읽고 쓰므로 7MB 든 700MB 든 메모리에 통째로 안 올린다.
 *
 *     {"kind":"subl-snapshot","version":1,"taken_at":"...","rows":9996,...}
 *     {"ri":"/Mobius/x","ty":"3","subl":"[{...}]"}
 *     ...
 *
 * ── 읽는 법 ─────────────────────────────────────────────────────────────
 *     zcat subl-2026....ndjson.gz | head -1              머리만
 *     zcat subl-....gz | grep '"/Mobius/KETI_GCS/'       그 부모의 행
 */

var fs   = require('fs');
var path = require('path');
var zlib = require('zlib');
var readline = require('readline');

// sub 이 붙을 수 있는 타입만 훑는다. CIN(ty=4)은 자식을 못 가지므로 제외한다.
// lookup 은 배포에서 5,740만 행이지만 idx_lookup_ty 로 34,313행만 읽는다.
var PARENT_TYPES = ['1', '2', '3', '5', '9', '14', '16', '23'];

// 한 번에 가져오는 행 수. subl 이 mediumtext 라 통째로 받으면 메모리가 튄다.
var PAGE = 500;

function usage() {
    console.log('사용법:');
    console.log('  node tools/snapshot-subl.js --out <경로> [mysql|sqlite]');
    console.log('  node tools/snapshot-subl.js --verify <경로> [mysql|sqlite]');
    console.log('');
    console.log('백엔드를 생략하면 conf.json 의 usesqlite 를 따른다 (migrate.js 와 같다).');
    console.log('경로가 .gz 로 끝나지 않으면 붙여 준다.');
    process.exit(2);
}

var backendArg = null;

function connect(cb) {
    var conf = {};
    try { conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'conf.json'), 'utf8')); }
    catch (e) { /* 없으면 기본값 */ }

    // mobius.js·migrate.js 와 같은 방식으로 백엔드를 정한다.
    global.usesqlite = backendArg ? String(backendArg === 'sqlite')
                                  : (conf.usesqlite || 'false');
    console.log('백엔드: ' + (global.usesqlite === 'true' ? 'sqlite' : 'mysql'));

    var db = require(path.join(__dirname, '..', 'mobius', 'db'));

    db.connect('localhost', 3306, 'root', conf.dbpass || '', function (rsc) {
        if (rsc !== '1') { console.error('DB 연결 실패: ' + rsc); process.exit(1); }
        db.getConnection(function (code, conn) {
            if (code !== '200') { console.error('커넥션 획득 실패: ' + code); process.exit(1); }
            cb(db, conn);
        });
    });
}

function stamp() {
    // 마이그레이션·리소스와 같은 형식: 20260830T101112
    var d = new Date();
    function p(n, w) { return String(n).padStart(w || 2, '0'); }
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
           p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}

/* ── 뜨기 ──────────────────────────────────────────────────────────── */

function take(outPath) {
    if (!/\.gz$/.test(outPath)) { outPath += '.gz'; }

    connect(function (db, conn) {
        var gz  = zlib.createGzip({ level: 9 });
        var out = fs.createWriteStream(outPath);
        gz.pipe(out);

        var taken = stamp();
        var rows = 0, entries = 0, bytes = 0, pages = 0;
        var byTy = {};

        gz.write(JSON.stringify({
            kind: 'subl-snapshot', version: 1, taken_at: taken,
            source: 'lookup.subl', types: PARENT_TYPES
        }) + '\n');

        // ri 로 이어보기 한다. PK 라 정렬·재개가 싸다.
        function page(after) {
            var qb = db.k('lookup')
                .select('ri', 'ty', 'subl')
                .whereIn('ty', PARENT_TYPES)
                .whereNotNull('subl')
                .whereNot({ subl: '' })
                .whereNot({ subl: '[]' })
                .orderBy('ri', 'asc')
                .limit(PAGE);
            if (after !== null) { qb = qb.where('ri', '>', after); }

            db.run(qb, conn, function (err, res) {
                if (err) {
                    console.error('조회 실패: ' + ((res && (res.sqlMessage || res.message)) || res));
                    gz.end();
                    return finish(1);
                }
                res = res || [];
                pages++;

                for (var i = 0; i < res.length; i++) {
                    var r = res[i];
                    var s = String(r.subl);
                    rows++;
                    bytes += Buffer.byteLength(s);
                    byTy[r.ty] = (byTy[r.ty] || 0) + 1;
                    try {
                        var a = JSON.parse(s);
                        if (Array.isArray(a)) { entries += a.length; }
                    } catch (e) { /* 못 읽어도 원문 그대로 뜬다 — 그게 요점이다 */ }

                    gz.write(JSON.stringify({ ri: r.ri, ty: r.ty, subl: s }) + '\n');
                }

                if (res.length < PAGE) {
                    // 머리를 다시 못 쓰므로 꼬리에 집계를 붙인다.
                    gz.write(JSON.stringify({
                        kind: 'subl-snapshot-end', rows: rows, entries: entries,
                        bytes: bytes, by_ty: byTy, taken_at: taken
                    }) + '\n');
                    gz.end();
                    out.on('close', function () {
                        var size = fs.statSync(outPath).size;
                        console.log('떴다: ' + outPath);
                        console.log('  부모 행       ' + rows.toLocaleString());
                        console.log('  구독 항목     ' + entries.toLocaleString());
                        console.log('  원본 크기     ' + (bytes / 1048576).toFixed(2) + ' MB');
                        console.log('  파일 크기     ' + (size / 1048576).toFixed(2) + ' MB (gzip)');
                        console.log('  타입별        ' + Object.keys(byTy).sort()
                            .map(function (t) { return 'ty=' + t + ' ' + byTy[t]; }).join(', '));
                        console.log('');
                        console.log('대조: node tools/snapshot-subl.js --verify ' + outPath);
                        finish(0);
                    });
                    return;
                }
                page(res[res.length - 1].ri);
            });
        }

        function finish(code) {
            try { db.release(conn); } catch (e) { /* 이미 닫혔으면 그만 */ }
            process.exit(code);
        }

        page(null);
    });
}

/* ── 대조 ──────────────────────────────────────────────────────────── */

function verify(filePath) {
    if (!fs.existsSync(filePath)) { console.error('파일이 없다: ' + filePath); process.exit(1); }

    var head = null, tail = null;
    var seen = {}, n = 0, entries = 0;

    var rl = readline.createInterface({
        input: fs.createReadStream(filePath).pipe(zlib.createGunzip())
    });

    rl.on('line', function (line) {
        if (!line) { return; }
        var o;
        try { o = JSON.parse(line); } catch (e) { console.error('깨진 줄: ' + line.slice(0, 80)); return; }
        if (o.kind === 'subl-snapshot')     { head = o; return; }
        if (o.kind === 'subl-snapshot-end') { tail = o; return; }
        n++;
        seen[o.ri] = String(o.subl);
        try { var a = JSON.parse(o.subl); if (Array.isArray(a)) { entries += a.length; } } catch (e) {}
    });

    rl.on('close', function () {
        if (!head) { console.error('머리가 없다 — 이 파일은 스냅샷이 아니다'); process.exit(1); }
        console.log('파일: ' + filePath);
        console.log('  뜬 시각   ' + head.taken_at);
        console.log('  부모 행   ' + n.toLocaleString() +
                    (tail ? (n === tail.rows ? '  (꼬리와 일치)' : '  <<< 꼬리는 ' + tail.rows) : '  <<< 꼬리가 없다(중간에 끊겼다)'));
        console.log('  구독 항목 ' + entries.toLocaleString());
        console.log('');

        connect(function (db, conn) {
            var missing = 0, changed = 0, added = 0, checked = 0;
            var samples = [];

            function page(after) {
                var qb = db.k('lookup')
                    .select('ri', 'subl')
                    .whereIn('ty', PARENT_TYPES)
                    .whereNotNull('subl')
                    .whereNot({ subl: '' })
                    .whereNot({ subl: '[]' })
                    .orderBy('ri', 'asc')
                    .limit(PAGE);
                if (after !== null) { qb = qb.where('ri', '>', after); }

                db.run(qb, conn, function (err, res) {
                    if (err) {
                        console.error('조회 실패: ' + ((res && (res.sqlMessage || res.message)) || res));
                        return done(1);
                    }
                    res = res || [];
                    for (var i = 0; i < res.length; i++) {
                        checked++;
                        var r = res[i];
                        if (!Object.prototype.hasOwnProperty.call(seen, r.ri)) {
                            added++;
                            if (samples.length < 3) { samples.push('파일에 없음: ' + r.ri); }
                            continue;
                        }
                        if (seen[r.ri] !== String(r.subl)) {
                            changed++;
                            if (samples.length < 3) { samples.push('내용이 달라짐: ' + r.ri); }
                        }
                        delete seen[r.ri];
                    }
                    if (res.length < PAGE) { return report(); }
                    page(res[res.length - 1].ri);
                });
            }

            function report() {
                missing = Object.keys(seen).length;
                console.log('DB 와 대조 (지금 시점):');
                console.log('  DB 의 대상 행  ' + checked.toLocaleString());
                console.log('  파일에만 있음  ' + missing + '  (뜬 뒤 지워졌거나 비워진 것)');
                console.log('  DB 에만 있음   ' + added + '  (뜬 뒤 새로 생긴 것)');
                console.log('  내용이 달라짐  ' + changed);
                samples.forEach(function (s) { console.log('    ' + s); });
                console.log('');
                var drift = missing + added + changed;
                if (drift === 0) {
                    console.log('뜬 시점 이후 subl 이 하나도 안 바뀌었다.');
                }
                else {
                    console.log('뜬 시점 이후 ' + drift + '행이 움직였다. 스냅샷은 그 시점의 사실이다.');
                }
                done(0);
            }

            function done(code) {
                try { db.release(conn); } catch (e) { /* 이미 닫혔으면 그만 */ }
                process.exit(code);
            }

            page(null);
        });
    });
}

/* ── 진입 ──────────────────────────────────────────────────────────── */

function main() {
    var argv = process.argv.slice(2);
    if (argv.indexOf('sqlite') >= 0) { backendArg = 'sqlite'; }
    else if (argv.indexOf('mysql') >= 0) { backendArg = 'mysql'; }

    var i = argv.indexOf('--out');
    if (i >= 0 && argv[i + 1]) { return take(argv[i + 1]); }
    i = argv.indexOf('--verify');
    if (i >= 0 && argv[i + 1]) { return verify(argv[i + 1]); }
    usage();
}

if (require.main === module) { main(); }
