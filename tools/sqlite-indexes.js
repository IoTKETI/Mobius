'use strict';
// SQLite index check/apply tool.
//
//   node tools/sqlite-indexes.js --check [DB path]     shows the current state (read-only)
//   node tools/sqlite-indexes.js --apply [DB path]     creates the missing indexes
//
// Without a DB path, MOBIUS_SQLITE_PATH is used, then ./mobius.db.
//
// The CREATE INDEX statements of mobius/db/mobiusdb_sqlite.sql run at every server boot (IF NOT EXISTS). With the indexes present they return at once, but the first time they are really built and the DB is write-locked meanwhile. The master and every worker each run the schema, so the same DDL arrives once per process and the others wait up to busyTimeout while SQLite serialises them. On a large DB the boot is delayed accordingly.
//
// ── Recommended procedure ──
//   1. Stop the server before deploying the new code.
//   2. Run this tool with --check to see the size and the estimated time.
//   3. Create the indexes with --apply (copy the DB file first if desired).
//   4. Start the server; the schema run returns at once.
//
// --apply also works with the server running (SQLite serialises), but writes are blocked meanwhile, so a quiet period is better.

var fs = require('fs');
var path = require('path');
var sqlite3 = require('sqlite3');

// Must match the declarations in mobiusdb_sqlite.sql.
var INDEXES = [
    { name: 'idx_lookup_pi_ty_ct', table: 'lookup',
      sql: 'CREATE INDEX IF NOT EXISTS idx_lookup_pi_ty_ct ON lookup (pi, ty, ct, ri)',
      why: '부모로 자식 찾기 + la/ol/delete_oldest 의 정렬' },
    { name: 'idx_lookup_sri', table: 'lookup',
      sql: 'CREATE INDEX IF NOT EXISTS idx_lookup_sri ON lookup (sri)',
      why: 'select_resource_from_url 의 or (sri = ?) 쪽 — 매 요청' },
    { name: 'idx_lookup_et', table: 'lookup',
      sql: 'CREATE INDEX IF NOT EXISTS idx_lookup_et ON lookup (et)',
      why: '만료 리소스 조회' },
    { name: 'idx_cin_pi', table: 'cin',
      sql: 'CREATE INDEX IF NOT EXISTS idx_cin_pi ON cin (pi, ri, cs)',
      why: 'cin 을 부모로 묶어 세기 (정합 맞추기, delete_oldest)' }
];

// Reference point: four indexes on lookup plus cin at 2 million rows in total take about 3.6 seconds. The estimate below multiplies the summed row count of both tables, so the constant is per million rows of that sum.
var SECONDS_PER_MILLION_ROWS = 3.6 / 2;

var mode = null;
var dbPath = null;

process.argv.slice(2).forEach(function (a) {
    if (a === '--check' || a === '--apply') { mode = a; }
    else if (a.charAt(0) !== '-') { dbPath = a; }
});

if (!mode) {
    console.error('사용법: node tools/sqlite-indexes.js --check|--apply [DB경로]');
    process.exit(2);
}

dbPath = dbPath || process.env.MOBIUS_SQLITE_PATH || './mobius.db';

if (!fs.existsSync(dbPath)) {
    console.error('DB 파일이 없다: ' + path.resolve(dbPath));
    process.exit(1);
}

var sizeMB = fs.statSync(dbPath).size / 1024 / 1024;
var db = new sqlite3.Database(dbPath, function (err) {
    if (err) { console.error('열기 실패: ' + err.message); process.exit(1); }
    db.configure('busyTimeout', 60000);
    start();
});

function all(sql, cb) {
    db.all(sql, [], function (err, rows) {
        if (err) { console.error('질의 실패: ' + sql + '\n  ' + err.message); process.exit(1); }
        cb(rows);
    });
}

function start() {
    console.log('DB: ' + path.resolve(dbPath));
    console.log('크기: ' + sizeMB.toFixed(1) + ' MB');
    console.log('');

    all("select name from sqlite_master where type='index' and sql is not null",
        function (rows) {
            var have = rows.map(function (r) { return r.name; });
            var missing = INDEXES.filter(function (x) { return have.indexOf(x.name) === -1; });

            console.log('인덱스 상태');
            INDEXES.forEach(function (x) {
                var ok = have.indexOf(x.name) !== -1;
                console.log('  ' + (ok ? '있음' : '없음') + '  ' + x.name + '   (' + x.why + ')');
            });
            console.log('');

            countRows(function (counts) {
                console.log('행 수');
                Object.keys(counts).forEach(function (t) {
                    console.log('  ' + t + ': ' + counts[t].toLocaleString());
                });

                var totalRows = Object.keys(counts).reduce(function (a, t) { return a + counts[t]; }, 0);
                var est = (totalRows / 1000000) * SECONDS_PER_MILLION_ROWS;
                console.log('');

                if (missing.length === 0) {
                    console.log('빠진 인덱스가 없다. 서버 기동 시 스키마 실행은 즉시 끝난다.');
                    db.close();
                    return;
                }

                console.log('빠진 인덱스: ' + missing.length + '개');
                console.log('예상 생성 시간: 약 ' + est.toFixed(1) + '초');
                console.log('  (실측: lookup 100만 + cin 100만 = 합계 200만 행에 3.6초. 디스크에 따라 달라진다)');
                console.log('');

                if (mode === '--check') {
                    console.log('지금은 아무것도 바꾸지 않았다.');
                    console.log('만들려면: node tools/sqlite-indexes.js --apply ' + dbPath);
                    console.log('');
                    console.log('서버를 멈추고 돌리는 것을 권한다. 만드는 동안 DB 가 쓰기 잠금 상태가 되고,');
                    console.log('그대로 서버를 올리면 마스터와 워커가 같은 DDL 을 동시에 쳐서 기동이 그만큼 늦어진다.');
                    db.close();
                    return;
                }

                apply(missing);
            });
        });
}

function countRows(cb) {
    var tables = ['lookup', 'cin'];
    var counts = {};
    (function next(i) {
        if (i >= tables.length) { return cb(counts); }
        db.get('select count(*) as n from ' + tables[i], function (err, row) {
            counts[tables[i]] = err ? 0 : row.n;
            next(i + 1);
        });
    })(0);
}

function apply(missing) {
    console.log('=== 생성 시작 ===');
    var t0 = Date.now();

    (function next(i) {
        if (i >= missing.length) {
            console.log('---');
            console.log('완료: ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
            console.log('');
            console.log('이제 서버를 올려도 스키마 실행은 즉시 끝난다.');
            db.close();
            return;
        }
        var x = missing[i];
        var s = Date.now();
        process.stdout.write('  ' + x.name + ' ... ');
        db.run(x.sql, function (err) {
            if (err) {
                console.log('실패: ' + err.message);
                db.close();
                process.exit(1);
            }
            console.log(((Date.now() - s) / 1000).toFixed(1) + '초');
            next(i + 1);
        });
    })(0);
}
