'use strict';
// Indexes in the SQLite schema. Without them every `where pi = ?` is a full table scan whose cost scales with the whole table rather than the container.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

// The adapter names the path; no directory is prepended here.
const SCHEMA = require('../mobius/db/sqlite').schemaPath;

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

// IF NOT EXISTS is required so existing DBs get the index on the next start.
test('인덱스 선언에 IF NOT EXISTS 가 빠진 것이 없다', function () {
    // Comments (-- ...) are excluded; a 'CREATE INDEX' in explanatory text must not be counted.
    const src = fs.readFileSync(SCHEMA, 'utf8')
        .split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n');
    const bare = src.match(/CREATE INDEX (?!IF NOT EXISTS)/g) || [];
    assert.deepStrictEqual(bare, [], 'IF NOT EXISTS 없는 CREATE INDEX 가 있다');
});

// Executes the schema for real and checks that the indexes exist and the optimizer uses them.
test('스키마를 실행하면 인덱스가 생기고 질의가 그걸 쓴다', function (t, done) {
    const file = path.join(os.tmpdir(), 'mobius-index-test-' + process.pid + '.db');
    try { fs.unlinkSync(file); } catch (e) { /* ignore if missing */ }

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

                // A SCAN left in the plan means the index is not used.
                const plans = [
                    ["la", "select * from lookup where pi = '/M/c' and ty = '4' order by ct desc, ri desc limit 1"],
                    ["부모로 자식 찾기", "select * from lookup where pi = '/M/c'"],
                    ["cin 집계", "select count(*), sum(cs) from cin where pi = '/M/c'"]
                ];

                let i = 0;
                (function next() {
                    if (i >= plans.length) {
                        db.close(function () {
                            try { fs.unlinkSync(file); } catch (e) { /* ignore if already removed */ }
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

// The two schemas declare the index differently by design. The declarations differ; the effective composition is the same:
//
//   MySQL   (pi, ty, ct)       + PK column ri  (PK = pi, ri, ty)  -> (pi,ty,ct,ri)
//   SQLite  (pi, ty, ct, ri)   + rowid (not ri)                   -> (pi,ty,ct,ri)
//
// InnoDB appends the PK columns to secondary indexes. SQLite appends the rowid, and ri is a TEXT PRIMARY KEY, not the rowid, so SQLite must list ri explicitly. Without ri SQLite needs a partial sort and loses the covering index; adding ri on MySQL would only duplicate what is already there.

test('SQLite 는 idx_lookup_pi_ty_ct 에 ri 를 명시한다 (rowid 가 ri 가 아니다)', function () {
    const sql = fs.readFileSync(SCHEMA, 'utf8');
    const m = /CREATE INDEX[^;]*idx_lookup_pi_ty_ct[^;]*ON\s+lookup\s*\(([^)]*)\)/i.exec(sql);
    assert.ok(m, 'SQLite 에 idx_lookup_pi_ty_ct 가 없다');
    const cols = m[1].split(',').map((c) => c.trim());
    assert.deepStrictEqual(cols, ['pi', 'ty', 'ct', 'ri'],
        'SQLite 인덱스에서 ri 가 빠지면 order by ct,ri 가 부분 정렬이 된다: ' + m[1]);
});

test('MySQL 은 ri 를 명시하지 않는다 (PK 가 자동으로 붙인다)', function () {
    const sql = fs.readFileSync(require('../mobius/db/mysql').schemaPath, 'utf8');
    const m = /KEY\s+`?idx_lookup_pi_ty_ct`?\s*\(([^)]*)\)/i.exec(sql);
    assert.ok(m, 'MySQL 에 idx_lookup_pi_ty_ct 가 없다');
    const cols = m[1].split(',').map((c) => c.trim().replace(/`/g, ''));
    assert.deepStrictEqual(cols, ['pi', 'ty', 'ct'],
        'MySQL 인덱스에 ri 를 더했다 — PK(pi,ri,ty)가 이미 붙이므로 중복이다: ' + m[1]);

    // That automatic append requires ri in the PK.
    const pk = /PRIMARY KEY\s*\(([^)]*)\)/i.exec(sql);
    assert.ok(pk, 'lookup 의 PRIMARY KEY 를 못 찾았다');
    assert.match(pk[1], /`?ri`?/,
        'PK 에 ri 가 없다 — 그러면 MySQL 인덱스에도 ri 를 명시해야 한다');
});

// A failed PRAGMA must not kill the worker. node-sqlite3 emits 'error' on the Database when a db.run without callback fails; with no listener that is an unhandled exception. journal_mode can really fail (the switch is refused while another connection holds a transaction), and startup must continue; the mode is retried on the next start.

test('connect 의 PRAGMA 는 전부 콜백을 준다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    // No db.run without a callback: the form `db.run('...')` closed immediately by `)`.
    const bare = code.match(/db\.run\(\s*'[^']*'\s*\)/g) || [];
    assert.deepStrictEqual(bare, [],
        '콜백 없는 db.run 이 있다 — 실패하면 미처리 예외로 워커가 죽는다: ' +
        bare.join(' / '));

    // All three PRAGMAs must be present.
    for (const p of ['foreign_keys', 'journal_mode', 'synchronous']) {
        assert.ok(code.indexOf('PRAGMA ' + p) >= 0, 'PRAGMA ' + p + ' 가 없다');
    }
});

test('PRAGMA 값은 허용 목록으로 거른다 (바인딩을 못 쓴다)', function () {
    // PRAGMA takes no placeholders, so the value goes into the statement verbatim. Concatenating a conf value unchecked makes that spot an injection point.
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

        // The allow-lists must exist in the code.
        assert.match(code, /JOURNAL_MODES\s*=\s*\[/, '저널 모드 허용 목록이 없다');
        assert.match(code, /SYNC_MODES\s*=\s*\[/, '동기화 모드 허용 목록이 없다');

        // And the PRAGMA statement uses only the result of the function that applies the list.
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
