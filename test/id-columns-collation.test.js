'use strict';
// 마이그레이션 018 — id 컬럼 콜레이션을 utf8mb3_bin 으로 (ri/sri 설계 메모 §3 A3).
//
// 표 전체를 다시 쓰는 DDL 이라 실제로 돌려 볼 수 없다. test/migrate.test.js 처럼
// 어댑터를 가로채 **무슨 문장을 어떤 순서로 내는지**만 본다. 형과 NULL 여부는
// information_schema 에서 읽어 그대로 두는 것이 계약이다.

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(os.tmpdir(), 'mobius-collation-test.db');
global.NOPRINT = 'true';
global.usedb = 'mysql';

const db = require(DB);
const adapter = require(path.join(DB, 'mysql.js'));
const m = require('../migrations/018-id-columns-collation-bin.js');

function tap(selectRows) {
    const seen = [];
    let sel = 0;
    adapter.execute = function (conn, sql, bindings, cb, opts) {
        seen.push({ sql: sql, opts: opts });
        if (/^select/i.test(sql)) { return cb(null, selectRows[sel++] || []); }
        cb(null, { affectedRows: 0 });
    };
    db.connect(function () {});
    return { ctx: { db: db, conn: {}, backend: 'mysql' }, seen: seen };
}

// 배포 실측 모양 — lookup.ri 만 bin 이고 나머지는 general_ci
const DEPLOY = [
    { t: 'cin', c: 'pi', ty: 'varchar(200)', nul: 'NO', coll: 'utf8mb3_general_ci' },
    { t: 'lookup', c: 'pi', ty: 'varchar(200)', nul: 'NO', coll: 'utf8mb3_general_ci' },
    { t: 'lookup', c: 'spi', ty: 'varchar(45)', nul: 'NO', coll: 'utf8mb3_general_ci' },
    { t: 'lookup', c: 'sri', ty: 'varchar(45)', nul: 'NO', coll: 'utf8mb3_general_ci' },
    { t: 'sub', c: 'pi', ty: 'varchar(400)', nul: 'YES', coll: 'utf8mb3_general_ci' }
];

test('선언 — MySQL 만, 수동', () => {
    assert.strictEqual(m.id, '018-id-columns-collation-bin');
    assert.deepStrictEqual(m.backends, ['mysql']);
    assert.strictEqual(m.autoApply, undefined, '표를 다시 쓰는 DDL 이 기동 때 돌면 안 된다');
});

test('inspect — 컬럼마다 지금 콜레이션과 바꿀 것을 말한다', (t, done) => {
    const { ctx } = tap([DEPLOY]);
    m.inspect(ctx, (err, note) => {
        assert.ifError(err);
        assert.match(note, /lookup\.pi utf8mb3_general_ci → utf8mb3_bin/);
        assert.match(note, /sub\.pi utf8mb3_general_ci → utf8mb3_bin/);
        assert.match(note, /바꿀 표 3/);
        assert.match(note, /점검 창/);
        done();
    });
});

test('up — 표마다 ALTER 한 문장, 형·NULL 여부는 읽은 그대로, 타임아웃 없음', (t, done) => {
    const { ctx, seen } = tap([DEPLOY]);
    m.up(ctx, (err, out) => {
        assert.ifError(err);
        const alters = seen.filter((s) => /^ALTER/.test(s.sql));
        assert.deepStrictEqual(alters.map((s) => s.sql), [
            'ALTER TABLE cin MODIFY pi varchar(200) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL',
            'ALTER TABLE lookup MODIFY pi varchar(200) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL, ' +
                'MODIFY spi varchar(45) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL, ' +
                'MODIFY sri varchar(45) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL',
            'ALTER TABLE sub MODIFY pi varchar(400) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NULL'
        ]);
        alters.forEach((s) => assert.deepStrictEqual(s.opts, { timeoutMs: 0 }, '표 재작성에 드라이버 타임아웃이 걸리면 안 된다'));
        assert.strictEqual(out.affectedRows, 3);
        done();
    });
});

test('이미 bin 인 컬럼은 건너뛴다 — 전부 맞으면 문장이 없다', (t, done) => {
    const half = DEPLOY.map((c) => Object.assign({}, c, { coll: (c.t === 'lookup') ? 'utf8mb3_bin' : c.coll }));
    const { ctx, seen } = tap([half]);
    m.up(ctx, (err, out) => {
        assert.ifError(err);
        const alters = seen.filter((s) => /^ALTER/.test(s.sql)).map((s) => s.sql);
        assert.strictEqual(alters.length, 2);
        assert.ok(alters.every((s) => !/lookup/.test(s)), 'lookup 은 이미 bin 인데 또 바꾼다');
        assert.strictEqual(out.affectedRows, 2);
        const all = DEPLOY.map((c) => Object.assign({}, c, { coll: 'utf8mb3_bin' }));
        const again = tap([all]);
        m.inspect(again.ctx, (e2, note) => {
            assert.ifError(e2);
            assert.match(note, /이미 맞다/);
            done();
        });
    });
});
