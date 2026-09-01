'use strict';
// SQLite 스키마의 인덱스.
//
// 예전에는 SQLite 스키마에 인덱스가 하나도 없었다 (MySQL 쪽엔 27개).
// `where pi = ?` 같은 질의가 전부 풀 테이블 스캔이라, 비용이 컨테이너 크기가
// 아니라 테이블 전체 크기에 비례했다.
//
// 실측 (10만 행): select_resource_from_url 14.19ms -> 0.18ms,
// la 11.26 -> 0.20, cin 집계 25.74 -> 0.18.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const SCHEMA = path.join(__dirname, '..', 'mobius', 'mobiusdb_sqlite.sql');

const REQUIRED = [
    'idx_lookup_pi_ty_ct',
    'idx_lookup_sri',
    'idx_lookup_et',
    'idx_cin_pi'
];

test('스키마가 인덱스를 IF NOT EXISTS 로 선언한다', function () {
    const src = fs.readFileSync(SCHEMA, 'utf8');
    REQUIRED.forEach(function (name) {
        assert.match(src, new RegExp('CREATE INDEX IF NOT EXISTS ' + name + '\\b'),
            name + ' 선언이 없다');
    });
});

// IF NOT EXISTS 여야 기존 DB 에도 다음 기동에서 자동으로 붙는다.
test('인덱스 선언에 IF NOT EXISTS 가 빠진 것이 없다', function () {
    // 주석(-- ...) 은 뺀다. 설명에 적힌 'CREATE INDEX' 까지 세면 안 된다.
    const src = fs.readFileSync(SCHEMA, 'utf8')
        .split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n');
    const bare = src.match(/CREATE INDEX (?!IF NOT EXISTS)/g) || [];
    assert.deepStrictEqual(bare, [], 'IF NOT EXISTS 없는 CREATE INDEX 가 있다');
});

// 스키마를 실제로 실행해 인덱스가 생기고, 옵티마이저가 그걸 쓰는지 본다.
test('스키마를 실행하면 인덱스가 생기고 질의가 그걸 쓴다', function (t, done) {
    const file = path.join(os.tmpdir(), 'mobius-index-test-' + process.pid + '.db');
    try { fs.unlinkSync(file); } catch (e) { /* 없으면 그만 */ }

    const db = new sqlite3.Database(file, function (err) {
        assert.ok(!err, String(err));
        db.exec(fs.readFileSync(SCHEMA, 'utf8'), function (err2) {
            assert.ok(!err2, '스키마 실행 실패: ' + String(err2));

            db.all("select name from sqlite_master where type='index'", function (err3, rows) {
                assert.ok(!err3, String(err3));
                const names = rows.map(function (r) { return r.name; });
                REQUIRED.forEach(function (n) {
                    assert.ok(names.indexOf(n) !== -1, n + ' 이 생기지 않았다: ' + JSON.stringify(names));
                });

                // 실행 계획에 SCAN 이 남아 있으면 인덱스를 못 쓰는 것이다.
                const plans = [
                    ["la", "select * from lookup where pi = '/M/c' and ty = '4' order by ct desc, ri desc limit 1"],
                    ["부모로 자식 찾기", "select * from lookup where pi = '/M/c'"],
                    ["cin 집계", "select count(*), sum(cs) from cin where pi = '/M/c'"]
                ];

                let i = 0;
                (function next() {
                    if (i >= plans.length) {
                        db.close(function () {
                            try { fs.unlinkSync(file); } catch (e) { /* 지워졌으면 그만 */ }
                            done();
                        });
                        return;
                    }
                    const [label, sql] = plans[i++];
                    db.all('explain query plan ' + sql, function (e, r) {
                        const detail = r.map(function (x) { return x.detail; }).join(' | ');
                        assert.ok(/USING INDEX|USING COVERING INDEX/.test(detail),
                            label + ' 이 인덱스를 안 쓴다: ' + detail);
                        assert.ok(!/SCAN lookup\b(?! USING)/.test(detail),
                            label + ' 이 풀스캔이다: ' + detail);
                        next();
                    });
                })();
            });
        });
    });
});

// --- 두 스키마의 인덱스 선언이 다른 것은 의도다 ------------------------------
//
// 6번 작업(SQLite 를 MySQL 과 같게)에서 이 차이를 "맞춰야 할 불일치" 로
// 오인하기 쉬워 못박는다. **선언만 다르고 실제 구성은 같다.**
//
//   MySQL   (pi, ty, ct)       + PK 컬럼 ri  (PK = pi, ri, ty)  -> (pi,ty,ct,ri)
//   SQLite  (pi, ty, ct, ri)   + rowid (ri 가 아니다)           -> (pi,ty,ct,ri)
//
// InnoDB 는 보조 인덱스에 PK 컬럼을 자동으로 붙인다. SQLite 는 rowid 를 붙이는데
// ri 는 TEXT PRIMARY KEY 라 rowid 가 아니다 — 그래서 SQLite 만 명시해야 한다.
//
// 배포/로컬 실측(2026-09-01), `order by ct desc, ri desc`:
//   SQLite (pi,ty,ct,ri)   SEARCH USING COVERING INDEX                 정렬 없음
//   SQLite (pi,ty,ct)      USE TEMP B-TREE FOR RIGHT PART OF ORDER BY  부분 정렬
//   MySQL  (pi,ty,ct)      range, Using index                          정렬 없음
//
// SQLite 에서 ri 를 빼면 부분 정렬이 생기고 커버링도 잃는다.
// MySQL 에 ri 를 더하면 이미 있는 것을 중복으로 넣어 84GB 인덱스만 커진다.

test('SQLite 는 idx_lookup_pi_ty_ct 에 ri 를 명시한다 (rowid 가 ri 가 아니다)', function () {
    const sql = fs.readFileSync(SCHEMA, 'utf8');
    const m = /CREATE INDEX[^;]*idx_lookup_pi_ty_ct[^;]*ON\s+lookup\s*\(([^)]*)\)/i.exec(sql);
    assert.ok(m, 'SQLite 에 idx_lookup_pi_ty_ct 가 없다');
    const cols = m[1].split(',').map((c) => c.trim());
    assert.deepStrictEqual(cols, ['pi', 'ty', 'ct', 'ri'],
        'SQLite 인덱스에서 ri 가 빠지면 order by ct,ri 가 부분 정렬이 된다: ' + m[1]);
});

test('MySQL 은 ri 를 명시하지 않는다 (PK 가 자동으로 붙인다)', function () {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'mobiusdb.sql'), 'utf8');
    const m = /KEY\s+`?idx_lookup_pi_ty_ct`?\s*\(([^)]*)\)/i.exec(sql);
    assert.ok(m, 'MySQL 에 idx_lookup_pi_ty_ct 가 없다');
    const cols = m[1].split(',').map((c) => c.trim().replace(/`/g, ''));
    assert.deepStrictEqual(cols, ['pi', 'ty', 'ct'],
        'MySQL 인덱스에 ri 를 더했다 — PK(pi,ri,ty)가 이미 붙이므로 중복이다: ' + m[1]);

    // 그 자동 부착이 성립하려면 PK 에 ri 가 있어야 한다.
    const pk = /PRIMARY KEY\s*\(([^)]*)\)/i.exec(sql);
    assert.ok(pk, 'lookup 의 PRIMARY KEY 를 못 찾았다');
    assert.match(pk[1], /`?ri`?/,
        'PK 에 ri 가 없다 — 그러면 MySQL 인덱스에도 ri 를 명시해야 한다');
});

// --- PRAGMA 실패가 워커를 죽이면 안 된다 --------------------------------------
//
// node-sqlite3 는 콜백 없는 db.run 이 실패하면 Database 에 'error' 를 뿜는다.
// 듣는 이가 없으면 EventEmitter 규약대로 **미처리 예외**가 되어 프로세스가
// 죽는다. 실측으로 확인했다 — 로그 한 줄로 끝날 일이 워커 사망이 된다.
//
// journal_mode 는 실제로 실패할 수 있다. 다른 커넥션이 트랜잭션을 쥐고 있으면
// 전환이 거부된다(유휴로 열려 있는 것만으로는 안 막힌다). 그때도 기동은
// 계속돼야 한다 — 모드가 안 바뀐 것뿐이고 다음 기동에 다시 시도한다.

test('connect 의 PRAGMA 는 전부 콜백을 준다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    // 콜백 없이 부르는 db.run 이 하나라도 있으면 안 된다.
    // `db.run('...')` 뒤가 곧바로 `)` 로 닫히는 모양을 찾는다.
    const bare = code.match(/db\.run\(\s*'[^']*'\s*\)/g) || [];
    assert.deepStrictEqual(bare, [],
        '콜백 없는 db.run 이 있다 — 실패하면 미처리 예외로 워커가 죽는다: ' +
        bare.join(' / '));

    // PRAGMA 세 개가 다 있어야 한다.
    for (const p of ['foreign_keys', 'journal_mode', 'synchronous']) {
        assert.ok(code.indexOf('PRAGMA ' + p) >= 0, 'PRAGMA ' + p + ' 가 없다');
    }
});

test('PRAGMA 값은 허용 목록으로 거른다 (바인딩을 못 쓴다)', function () {
    // PRAGMA 는 자리표를 받지 않아 값이 문에 그대로 들어간다.
    // conf 에서 온 값을 그대로 이으면 그 자리가 주입 지점이 된다.
    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'))];

    const saved = {
        j: global.use_sqlite_journal_mode,
        s: global.use_sqlite_synchronous,
        b: global.use_sqlite_busy_timeout_ms
    };
    try {
        global.use_sqlite_journal_mode = 'WAL; drop table lookup; --';
        global.use_sqlite_synchronous = 'nonsense';
        global.use_sqlite_busy_timeout_ms = -1;

        const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'), 'utf8');
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

        // 허용 목록이 코드에 실재해야 한다.
        assert.match(code, /JOURNAL_MODES\s*=\s*\[/, '저널 모드 허용 목록이 없다');
        assert.match(code, /SYNC_MODES\s*=\s*\[/, '동기화 모드 허용 목록이 없다');

        // 그리고 PRAGMA 문이 그 목록을 지난 함수의 결과만 쓴다.
        assert.match(code, /PRAGMA journal_mode = ' \+ journal_mode\(\)/,
            'journal_mode() 를 안 거치고 값을 잇는다');
        assert.match(code, /PRAGMA synchronous = ' \+ synchronous\(\)/,
            'synchronous() 를 안 거치고 값을 잇는다');
    }
    finally {
        global.use_sqlite_journal_mode = saved.j;
        global.use_sqlite_synchronous = saved.s;
        global.use_sqlite_busy_timeout_ms = saved.b;
        delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'))];
    }
});
