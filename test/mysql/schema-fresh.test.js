'use strict';
// 새 설치 = 스키마 파일 + `migrate --apply`. 그 뒤 남은 마이그레이션이 없어야 한다 (§7.1).
//
// 스키마 파일은 새 설치의 진실이고 마이그레이션은 기존 배포의 진실이다. 둘이 어긋나면 새 서버가
// 배포와 다른 스키마로 시작한다(001 이 실제로 그랬다 — test/schema-drift 는 인덱스 이름만 대조한다).
// 여기서는 진짜로 깔고 진짜로 적용한다.
//
// 스키마 파일만으로 "전부 적용된 상태" 가 되지는 않는다 — 012 같은 **데이터 스위치**는 이력 표에
// 기록돼야 코어가 동작을 바꾼다(db_bootstrap.readDataSwitches). 그래서 새 설치 절차는
// "스키마 import → node tools/migrate.js --apply" 다. 이 시험은 그 절차를 그대로 밟는다:
// 빈 DB 에 스키마를 깔고 → 남은 것 전부를 적용하고(DDL 은 "이미 있음" 으로 0행) → 남은 것 0.

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

test('스키마 파일이 표를 만든다 — lookup · cin · ae · sub, 이력 표는 없다(새 설치)', () => {
    ['lookup', 'cin', 'ae', 'cnt', 'sub', 'acp', 'csr', 'hit'].forEach((t) => assert.ok(tables.indexOf(t) >= 0, t + ' 표가 없다'));
    assert.ok(tables.indexOf('schema_migrations') < 0, '스키마 파일에 이력 표가 들어 있다 — 러너가 만드는 표다');
});

test('빈 DB 에 남은 마이그레이션을 전부 적용하면 DDL 은 "이미 있음"(0행)이고 실패가 없다', async () => {
    await p((cb) => migrate.ensureTable(ctx(), cb));
    const all = migrate.loadMigrations();
    const ids = await p((cb) => migrate.appliedIds(ctx(), cb));
    const pending = migrate.pending(all, ids, 'mysql');
    assert.ok(pending.length >= 19, '남은 마이그레이션이 ' + pending.length + '개뿐이다');
    const quiet = console.log; console.log = () => {};
    let applied;
    try { applied = await p((cb) => migrate.apply(ctx(), pending, cb)); }
    finally { console.log = quiet; }
    assert.strictEqual(applied.length, pending.length, '적용된 수가 다르다: ' + JSON.stringify(applied));
});

test('적용 뒤 남은 것이 0 이고 모든 inspect 가 "이미 맞다 / 할 일 없음" 이다', async () => {
    const all = migrate.loadMigrations();
    const ids = await p((cb) => migrate.appliedIds(ctx(), cb));
    assert.deepStrictEqual(migrate.pending(all, ids, 'mysql').map((m) => m.id), []);
    const notes = [];
    for (const m of all.filter((x) => (x.backends || ['mysql']).indexOf('mysql') >= 0)) {
        const note = await p((cb) => m.inspect(ctx(), cb));
        notes.push(m.id + ': ' + String(note).replace(/\s+/g, ' ').slice(0, 120));
    }
    // "할 일 없음" 을 뜻하는 말들 — 새 마이그레이션이 다른 말을 쓰면 여기 더한다.
    // 012 는 데이터 스위치라 "백필 완료" 가 곧 할 일 없음이다(이력에는 위에서 기록됐다).
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
