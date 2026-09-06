'use strict';
// 새 설치 = 스키마 파일 import. 그것만으로 남은 마이그레이션이 없어야 한다 (§7.1 · 사용자 결정 2026-09-06).
//
// 스키마 파일은 새 설치의 진실이고 마이그레이션은 기존 배포의 진실이다. 둘이 어긋나면 새 서버가
// 배포와 다른 스키마로 시작한다(001 이 실제로 그랬다 — test/schema-drift 는 이름만 대조한다).
// 여기서는 진짜로 깐다.
//
// 파일은 이력 표(schema_migrations)까지 적어 두므로 012 같은 **데이터 스위치**가 import 직후부터
// 켜진다(db_bootstrap.readDataSwitches 가 이 표를 본다). 예외는 010 하나 — SET PERSIST 는 서버
// 설정이라 덤프가 담을 수 없고, autoApply 라 첫 기동(db_bootstrap.run)이 한다. 여기서는 그 첫 기동이
// 하는 일(autoApply 만 적용)을 같은 러너 함수로 밟고, 그 뒤 남은 것이 0 임을 본다.

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
    await p((cb) => migrate.ensureTable(ctx(), cb));   // 이미 있다 — IF NOT EXISTS 라 아무 일도 없다
    const all = migrate.loadMigrations();
    const ids = await p((cb) => migrate.appliedIds(ctx(), cb));
    assert.ok(ids.indexOf('012-lookup-cin-attrs-filled') >= 0, '012 가 이력에 없다 — discovery 가 옛 경로로 돈다');
    const pending = migrate.pending(all, ids, 'mysql');
    assert.deepStrictEqual(pending.map((m) => m.id), ['010-server-durability'],
        'import 직후 남은 것이 010 만이어야 한다 — 다른 것이 남으면 mobiusdb.sql 의 이력 INSERT 가 빠졌다');
    assert.strictEqual(pending[0].autoApply, true, '010 은 첫 기동이 대신 해야 하므로 autoApply 여야 한다');
});

test('데이터 스위치가 import 직후부터 켜진다 — db_bootstrap.readDataSwitches', async () => {
    // 파사드는 lane.facade() 가 시험 DB 로 다시 만들었다. 그 뒤에 require 하므로 같은 인스턴스를 본다.
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
    // "할 일 없음" 을 뜻하는 말들 — 새 마이그레이션이 다른 말을 쓰면 여기 더한다.
    // 012 는 데이터 스위치라 "백필 완료" 가 곧 할 일 없음이다.
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
