'use strict';
// SQLite 의 새 설치 = 첫 기동. 스키마 파일(mobiusdb_sqlite.sql)이 기동마다 다시 실행되므로(IF NOT
// EXISTS) 이력 행은 "그 마이그레이션이 이미 된 상태" 일 때만 들어가야 한다 — 옛 DB 에서 거짓 이력을
// 적으면 015 가 안 됐는데 됐다고 믿고(`select *` 에 subl 이 샌다) 017 의 중복이 영영 남는다.
//
// 여기서는 진짜 파일로 본다. 새 DB → 남은 것 0. subl 이 남은 옛 DB → 015 는 남음. 중복 sri → 017 은 남음.
// 스텁이 아니라 어댑터가 정말 여는 것으로 — 스키마 파일의 문장이 실제로 돌아야 증명이 된다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const migrate = require('../tools/migrate.js');

const DB = path.join(__dirname, '..', 'mobius', 'db');
const FILE = path.join(os.tmpdir(), 'mobius-fresh-ledger-' + process.pid + '.db');
process.env.MOBIUS_SQLITE_PATH = FILE;
global.usedb = 'sqlite';

function wipe() {
    [FILE, FILE + '-wal', FILE + '-shm', FILE + '-journal'].forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* 없으면 그만 */ } });
}

// 어댑터로 연다(= 기동. 스키마 파일이 실행된다). 이력을 읽고 닫는다.
function boot() {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    const db = require(DB);
    const adapter = require(path.join(DB, 'sqlite.js'));
    const quiet = console.log; console.log = () => {};
    return new Promise((resolve, reject) => {
        db.connect((rsc) => {
            if (rsc !== '1') { console.log = quiet; return reject(new Error('connect ' + rsc)); }
            db.getConnection((code, conn) => {
                if (code !== '200') { console.log = quiet; return reject(new Error('getConnection ' + code)); }
                const ctx = { db, conn, backend: 'sqlite' };
                migrate.ensureTable(ctx, (e1) => {
                    if (e1) { console.log = quiet; return reject(e1); }
                    migrate.appliedIds(ctx, (e2, ids) => {
                        try { db.release(conn); } catch (x) { /* */ }
                        adapter.end(() => {
                            console.log = quiet;
                            if (e2) { return reject(e2); }
                            resolve({ applied: ids, pending: migrate.pending(migrate.loadMigrations(), ids, 'sqlite').map((m) => m.id) });
                        });
                    });
                });
            });
        });
    });
}

// 어댑터를 거치지 않고 파일을 직접 만진다 — 옛 DB 를 흉내 낸다
function direct(fn) {
    return new Promise((resolve, reject) => {
        const d = new sqlite3.Database(FILE);
        d.serialize(() => { fn(d); d.close((e) => (e ? reject(e) : resolve())); });
    });
}

const sqliteIds = () => migrate.loadMigrations().filter((m) => m.backends && m.backends.indexOf('sqlite') !== -1).map((m) => m.id).sort();

test.before(wipe);
test.after(wipe);

test('새 SQLite DB 는 첫 기동만으로 남은 마이그레이션이 0 이다', async () => {
    wipe();
    const r = await boot();
    assert.deepStrictEqual(r.pending, [], '첫 기동 뒤에도 남은 것이 있다 — mobiusdb_sqlite.sql 이 이력을 안 적는다');
    assert.deepStrictEqual(r.applied.slice().sort(), sqliteIds());
});

test('두 번째 기동도 같다 — 이력이 중복되거나 지워지지 않는다', async () => {
    const r = await boot();
    assert.deepStrictEqual(r.pending, []);
    assert.deepStrictEqual(r.applied.slice().sort(), sqliteIds());
});

test('subl 컬럼이 남은 옛 DB 에서는 015 를 적지 않는다 — 컬럼이 진짜로 없을 때만 이력이다', async () => {
    wipe();
    // 옛 모양의 lookup 을 먼저 만든다 — 스키마 파일의 CREATE TABLE IF NOT EXISTS 가 건너뛴다
    await direct((d) => d.run('CREATE TABLE lookup (pi TEXT NOT NULL, ri TEXT PRIMARY KEY, ty INTEGER NOT NULL, ct TEXT NOT NULL, ' +
        'st INTEGER NOT NULL, rn TEXT NOT NULL, lt TEXT NOT NULL, et TEXT NOT NULL, acpi TEXT, lbl TEXT, at TEXT, aa TEXT, ' +
        'sri TEXT, spi TEXT, subl TEXT, cs INTEGER, cnf TEXT)'));
    const r = await boot();
    assert.deepStrictEqual(r.pending, ['015-drop-lookup-subl']);
});

test('중복 sri 가 있는 옛 DB 에서는 017 을 적지 않는다 — 017 의 groups() 와 같은 조건', async () => {
    wipe();
    await boot();   // 새 모양으로 깐다(017 이 기록된다)
    await direct((d) => {
        d.run("DELETE FROM schema_migrations WHERE id = '017-dedupe-lookup-sri'");   // 옛 DB 는 017 을 모른다
        d.run("INSERT INTO lookup (pi, ri, ty, ct, st, rn, lt, et, sri) VALUES " +
              "('/M', '/M/a', 3, '1', 0, 'a', '1', '1', 'dup'), ('/M', '/M/b', 3, '1', 0, 'b', '1', '1', 'dup')");
    });
    const r = await boot();
    assert.deepStrictEqual(r.pending, ['017-dedupe-lookup-sri']);
});
