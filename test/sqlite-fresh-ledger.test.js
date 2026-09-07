'use strict';
// For SQLite a fresh install is the first start. The schema file (mobiusdb_sqlite.sql) runs on every start (IF NOT EXISTS), so a history row may only be inserted when that migration's state already holds; a false history row on an old DB would make 015 look applied (subl leaks through `select *`) and leave 017's duplicates forever.
//
// Checked with real files: new DB -> nothing pending; old DB with subl -> 015 pending; duplicate sri -> 017 pending. The adapter really opens the file, so the schema file's statements actually run.
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
    [FILE, FILE + '-wal', FILE + '-shm', FILE + '-journal'].forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* ignore if missing */ } });
}

// Opens through the adapter (= a start; the schema file runs). Reads the history and closes.
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

// Touches the file directly, bypassing the adapter: mimics an old DB.
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
    // Creates the old-shape lookup first, so the schema file's CREATE TABLE IF NOT EXISTS skips it.
    await direct((d) => d.run('CREATE TABLE lookup (pi TEXT NOT NULL, ri TEXT PRIMARY KEY, ty INTEGER NOT NULL, ct TEXT NOT NULL, ' +
        'st INTEGER NOT NULL, rn TEXT NOT NULL, lt TEXT NOT NULL, et TEXT NOT NULL, acpi TEXT, lbl TEXT, at TEXT, aa TEXT, ' +
        'sri TEXT, spi TEXT, subl TEXT, cs INTEGER, cnf TEXT)'));
    const r = await boot();
    assert.deepStrictEqual(r.pending, ['015-drop-lookup-subl']);
});

test('중복 sri 가 있는 옛 DB 에서는 017 을 적지 않는다 — 017 의 groups() 와 같은 조건', async () => {
    wipe();
    await boot();   // installs the new shape (017 is recorded)
    await direct((d) => {
        d.run("DELETE FROM schema_migrations WHERE id = '017-dedupe-lookup-sri'");   // an old DB does not know 017
        d.run("INSERT INTO lookup (pi, ri, ty, ct, st, rn, lt, et, sri) VALUES " +
              "('/M', '/M/a', 3, '1', 0, 'a', '1', '1', 'dup'), ('/M', '/M/b', 3, '1', 0, 'b', '1', '1', 'dup')");
    });
    const r = await boot();
    assert.deepStrictEqual(r.pending, ['017-dedupe-lookup-sri']);
});
