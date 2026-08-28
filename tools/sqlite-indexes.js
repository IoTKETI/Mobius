'use strict';
// SQLite 인덱스 점검/적용 도구.
//
//   node tools/sqlite-indexes.js --check [DB경로]     현재 상태만 본다 (읽기 전용)
//   node tools/sqlite-indexes.js --apply [DB경로]     빠진 인덱스를 만든다
//
// DB 경로를 안 주면 MOBIUS_SQLITE_PATH, 없으면 ./mobius.db 를 쓴다.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// mobius/mobiusdb_sqlite.sql 의 CREATE INDEX 는 서버가 기동할 때마다 실행된다
// (IF NOT EXISTS). 인덱스가 이미 있으면 즉시 지나가지만, **처음 한 번**은
// 실제로 만들어야 하고 그동안 DB 가 쓰기 잠금 상태가 된다.
//
// 게다가 마스터와 워커가 각자 스키마를 실행한다 (app.js 의 cluster.isMaster
// 분기와 else 분기 양쪽). 워커 수만큼 같은 DDL 이 동시에 날아가고, SQLite 가
// 직렬화하는 동안 나머지는 busyTimeout(50초)까지 기다린다.
//
// 실측 (이 저장소에서 만든 합성 데이터):
//   lookup 10만  + cin 10만   -> 4개 생성에 약 0.34초
//   lookup 100만 + cin 100만  -> 4개 생성에 약 3.6초 (DB 파일 422MB)
//   동시 8개 프로세스로 같은 DDL 을 쳐도 전부 성공 (각 3.1초, 총 3.2초)
//
// 즉 데이터가 커질수록 기동이 그만큼 늦어진다. 1000만 행대에서는 30초를
// 넘길 수 있고, busyTimeout 50초에 근접하면 워커 기동이 실패할 수 있다.
//
// ── 권장 절차 ────────────────────────────────────────────────────────────
//   1. 새 코드를 배포하기 **전에** 서버를 멈춘다.
//   2. 이 도구를 --check 로 돌려 규모와 예상 시간을 본다.
//   3. --apply 로 인덱스를 만든다. (원하면 DB 파일을 복사해 두고 한다)
//   4. 서버를 올린다. 인덱스가 이미 있으므로 스키마 실행은 즉시 끝난다.
//
// 서버를 멈추지 않고 --apply 를 돌려도 SQLite 가 알아서 직렬화하지만,
// 그동안 쓰기가 막히므로 한가한 시간대를 고르는 편이 낫다.

var fs = require('fs');
var path = require('path');
var sqlite3 = require('sqlite3');

// mobiusdb_sqlite.sql 에 선언된 것과 같아야 한다.
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

// 실측 기준점: lookup 100만 + cin 100만 = 합계 200만 행에 4개 합쳐 약 3.6초.
// 아래 계산은 두 테이블의 행을 더한 값에 곱하므로 200만으로 나눈 값을 쓴다.
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
