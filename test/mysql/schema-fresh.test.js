'use strict';
// A fresh install is the schema file import, and nothing else may remain pending.
//
// The schema file is the truth for new installs and the migrations are the truth for existing deployments; test/schema-drift compares names only, this test installs for real.
//
// The file also fills the history table (schema_migrations), so data switches such as 012 are on right after import (db_bootstrap.readDataSwitches reads that table). The one exception is 010: SET PERSIST is server configuration that a dump cannot carry, and it is autoApply, so the first start (db_bootstrap.run) applies it. This test performs that first-start step (autoApply only) with the same runner function and then checks that nothing remains.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const lane = require('./_lane');
const migrate = require(path.join(lane.ROOT, 'tools', 'migrate.js'));

let tables = null;
let f = null;
test.before(async () => { tables = await lane.fresh(); f = await lane.facade(); });
test.after(async () => { if (f) { await f.close(); } });

const ctx = () => ({ db: f.db, conn: f.conn, backend: 'mysql' });
const p = (fn) => new Promise((res, rej) => fn((e, r) => (e ? rej(r) : res(r))));

test('스키마 파일이 표를 만든다 — lookup · cin · ae · sub, 그리고 이력 표', () => {
    ['lookup', 'cin', 'ae', 'cnt', 'sub', 'acp', 'csr', 'hit', 'schema_migrations']
        .forEach((t) => assert.ok(tables.indexOf(t) >= 0, t + ' 표가 없다'));
});

test('import 만으로 남은 것은 010 뿐이다 — 데이터 스위치 012 는 이미 기록돼 있다', async () => {
    await p((cb) => migrate.ensureTable(ctx(), cb));   // already exists; IF NOT EXISTS makes this a no-op
    const all = migrate.loadMigrations();
    const ids = await p((cb) => migrate.appliedIds(ctx(), cb));
    assert.ok(ids.indexOf('012-lookup-cin-attrs-filled') >= 0, '012 가 이력에 없다 — discovery 가 옛 경로로 돈다');
    const pending = migrate.pending(all, ids, 'mysql');
    assert.deepStrictEqual(pending.map((m) => m.id), ['010-server-durability'],
        'import 직후 남은 것이 010 만이어야 한다 — 다른 것이 남으면 mobiusdb.sql 의 이력 INSERT 가 빠졌다');
    assert.strictEqual(pending[0].autoApply, true, '010 은 첫 기동이 대신 해야 하므로 autoApply 여야 한다');
});

test('데이터 스위치가 import 직후부터 켜진다 — db_bootstrap.readDataSwitches', async () => {
    // lane.facade() rebuilt the facade against the test DB; requiring after that sees the same instance.
    const bootstrap = require(path.join(lane.ROOT, 'mobius', 'db_bootstrap.js'));
    global.lookup_has_cin_attrs = false;
    const quiet = console.log; console.log = () => {};
    try { await new Promise((res) => bootstrap.readDataSwitches(res)); }
    finally { console.log = quiet; }
    assert.strictEqual(global.lookup_has_cin_attrs, true, 'import 만으로는 lookup.cs 를 읽지 않는다');
});

test('첫 기동이 하는 일(autoApply 적용)까지 밟으면 남은 것이 0 이다', async () => {
    const all = migrate.loadMigrations();
    const ids = await p((cb) => migrate.appliedIds(ctx(), cb));
    const auto = migrate.pending(all, ids, 'mysql').filter((m) => m.autoApply === true);
    const quiet = console.log; console.log = () => {};
    let applied;
    try { applied = await p((cb) => migrate.apply(ctx(), auto, cb)); }
    finally { console.log = quiet; }
    assert.deepStrictEqual(applied, ['010-server-durability']);
    const after = await p((cb) => migrate.appliedIds(ctx(), cb));
    assert.deepStrictEqual(migrate.pending(all, after, 'mysql').map((m) => m.id), []);
});

test('모든 inspect 가 "이미 맞다 / 할 일 없음" 이다 — 파일이 마이그레이션의 결과 모양이다', async () => {
    const all = migrate.loadMigrations();
    const notes = [];
    for (const m of all.filter((x) => (x.backends || ['mysql']).indexOf('mysql') >= 0)) {
        const note = await p((cb) => m.inspect(ctx(), cb));
        notes.push(m.id + ': ' + String(note).replace(/\s+/g, ' ').slice(0, 120));
    }
    // Phrases meaning 'nothing to do'. Add here when a new migration uses different wording. 012 is a data switch, so 'backfill complete' means nothing to do.
    const DONE = /이미|없음|없다|맞다|적용하면 이력만|전부 utf8mb3_bin|중복 0|백필 완료/;
    assert.deepStrictEqual(notes.filter((n) => !DONE.test(n)), [], '스키마 파일에 반영되지 않은 마이그레이션이 있다');
});

test('식별자 컬럼이 전부 utf8mb3_bin 이고 rn·sri·spi 는 200 이다 (018 의 새 설치 모양)', async () => {
    const c = lane.rawConnection(lane.DB_NAME);
    try {
        const cols = await lane.q(c, "select table_name t, column_name col, column_type ty, collation_name coll from information_schema.columns where table_schema = ? and data_type = 'varchar' and ((table_name = 'lookup' and column_name in ('ri','pi','sri','spi','rn','lbl','acpi')) or (table_name = 'ae' and column_name = 'aei') or column_name = 'cr' or (table_name in ('cin','sub') and column_name = 'pi'))", [lane.DB_NAME]);
        const bad = cols.filter((x) => x.coll !== 'utf8mb3_bin').map((x) => x.t + '.' + x.col + ' ' + x.coll);
        assert.deepStrictEqual(bad, []);
        const widths = {}; cols.filter((x) => x.t === 'lookup').forEach((x) => { widths[x.col] = x.ty; });
        assert.deepStrictEqual([widths.rn, widths.sri, widths.spi], ['varchar(200)', 'varchar(200)', 'varchar(200)']);
        const idx = await lane.q(c, "select index_name i, non_unique nu from information_schema.statistics where table_schema = ? and table_name = 'lookup' and column_name = 'sri'", [lane.DB_NAME]);
        assert.deepStrictEqual(idx.map((x) => x.i + ':' + (x.nu == 0 ? 'unique' : 'dup')), ['idx_lookup_sri_unique:unique']);
    } finally { c.end(); }
});
