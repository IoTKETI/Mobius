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
