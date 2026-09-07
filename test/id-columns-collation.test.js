'use strict';
// Migration 018: identifier and name columns become utf8mb3_bin, and rn / sri / spi widen to 200.
//
// The DDL rewrites whole tables, so it is not executed; as in test/migrate.test.js the adapter is intercepted and only the emitted statements and their order are checked. Type and NULL-ness are read from information_schema and preserved; only rn / sri / spi widen to 200.
//
// Targets (identifiers are case-sensitive per oneM2M):
//   lookup.pi/sri/spi/rn/lbl/acpi, ae.aei, cb.csi, csr.csi/cb, cr on every table, cin.pi, sub.pi
//   poa and nu are addresses and stay; rn / sri / spi widen from 45 to 200.

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

const BIN = 'utf8mb3_bin', CI = 'utf8mb3_general_ci';
function col(t, c, ty, nul, coll) { return { t: t, c: c, ty: ty, nul: nul, coll: coll }; }

// Shape of a deployed schema; the query returns rows ordered by table_name, column_name.
const DEPLOY = [
    col('ae', 'aei', 'varchar(200)', 'NO', CI),
    col('cb', 'csi', 'varchar(45)', 'NO', CI),
    col('cin', 'cr', 'varchar(45)', 'NO', CI),
    col('cin', 'pi', 'varchar(200)', 'NO', CI),
    col('csr', 'cb', 'varchar(200)', 'NO', CI),
    col('csr', 'csi', 'varchar(200)', 'NO', CI),
    col('fcnt', 'cr', 'varchar(45)', 'YES', BIN),          // already bin
    col('lookup', 'acpi', 'varchar(200)', 'NO', CI),
    col('lookup', 'lbl', 'varchar(200)', 'NO', CI),
    col('lookup', 'pi', 'varchar(200)', 'NO', CI),
    col('lookup', 'rn', 'varchar(45)', 'NO', CI),
    col('lookup', 'spi', 'varchar(45)', 'NO', CI),
    col('lookup', 'sri', 'varchar(45)', 'NO', CI),
    col('sub', 'cr', 'varchar(45)', 'YES', CI),
    col('sub', 'pi', 'varchar(400)', 'YES', CI)
];
const MOD = (c, ty, nul) => 'MODIFY ' + c + ' ' + ty + ' CHARACTER SET utf8mb3 COLLATE utf8mb3_bin ' + nul;

test('선언 — MySQL 만, 수동', () => {
    assert.strictEqual(m.id, '018-id-columns-collation-bin');
    assert.deepStrictEqual(m.backends, ['mysql']);
    assert.strictEqual(m.autoApply, undefined, '표를 다시 쓰는 DDL 이 기동 때 돌면 안 된다');
});

test('대상 질의 — 모든 표의 cr 과 lookup 의 여섯 컬럼, varchar 만', (t, done) => {
    const { ctx, seen } = tap([DEPLOY]);
    m.inspect(ctx, (err) => {
        assert.ifError(err);
        const q = seen[0].sql;
        assert.match(q, /information_schema\.columns/);
        assert.match(q, /column_name = 'cr'/, '모든 표의 cr 을 잡아야 한다');
        assert.match(q, /data_type = 'varchar'/);
        ['acpi', 'lbl', 'pi', 'rn', 'spi', 'sri'].forEach((c) => assert.match(q, new RegExp("'" + c + "'"), 'lookup.' + c));
        assert.match(q, /'aei'/); assert.match(q, /'csi'/); assert.match(q, /'cb'/);
        done();
    });
});

test('inspect — 컬럼마다 지금 콜레이션과 바꿀 것, 넓힐 것을 말한다', (t, done) => {
    const { ctx } = tap([DEPLOY]);
    m.inspect(ctx, (err, note) => {
        assert.ifError(err);
        assert.match(note, /lookup\.pi utf8mb3_general_ci → utf8mb3_bin/);
        assert.match(note, /lookup\.rn .*varchar\(45\) → varchar\(200\)/);
        assert.match(note, /fcnt\.cr utf8mb3_bin$/m, '이미 bin 인 것은 화살표가 없다');
        assert.match(note, /바꿀 표 6/);
        assert.match(note, /점검 창/);
        done();
    });
});

test('up — 표마다 ALTER 한 문장, 형·NULL 여부는 읽은 그대로, rn·sri·spi 는 200, 타임아웃 없음', (t, done) => {
    const { ctx, seen } = tap([DEPLOY]);
    m.up(ctx, (err, out) => {
        assert.ifError(err);
        const alters = seen.filter((s) => /^ALTER/.test(s.sql));
        assert.deepStrictEqual(alters.map((s) => s.sql), [
            'ALTER TABLE ae ' + MOD('aei', 'varchar(200)', 'NOT NULL'),
            'ALTER TABLE cb ' + MOD('csi', 'varchar(45)', 'NOT NULL'),
            'ALTER TABLE cin ' + MOD('cr', 'varchar(45)', 'NOT NULL') + ', ' + MOD('pi', 'varchar(200)', 'NOT NULL'),
            'ALTER TABLE csr ' + MOD('cb', 'varchar(200)', 'NOT NULL') + ', ' + MOD('csi', 'varchar(200)', 'NOT NULL'),
            'ALTER TABLE lookup ' + [MOD('acpi', 'varchar(200)', 'NOT NULL'), MOD('lbl', 'varchar(200)', 'NOT NULL'),
                MOD('pi', 'varchar(200)', 'NOT NULL'), MOD('rn', 'varchar(200)', 'NOT NULL'),
                MOD('spi', 'varchar(200)', 'NOT NULL'), MOD('sri', 'varchar(200)', 'NOT NULL')].join(', '),
            'ALTER TABLE sub ' + MOD('cr', 'varchar(45)', 'NULL') + ', ' + MOD('pi', 'varchar(400)', 'NULL')
        ]);
        alters.forEach((s) => assert.deepStrictEqual(s.opts, { timeoutMs: 0 }, '표 재작성에 드라이버 타임아웃이 걸리면 안 된다'));
        assert.strictEqual(out.affectedRows, 6);
        done();
    });
});

test('이미 bin 이어도 좁으면 넓힌다 — lookup.sri bin varchar(45) 는 200 으로', (t, done) => {
    const rows = [col('lookup', 'sri', 'varchar(45)', 'NO', BIN), col('lookup', 'pi', 'varchar(200)', 'NO', BIN)];
    const { ctx, seen } = tap([rows]);
    m.up(ctx, (err, out) => {
        assert.ifError(err);
        const alters = seen.filter((s) => /^ALTER/.test(s.sql)).map((s) => s.sql);
        assert.deepStrictEqual(alters, ['ALTER TABLE lookup ' + MOD('sri', 'varchar(200)', 'NOT NULL')]);
        assert.strictEqual(out.affectedRows, 1);
        done();
    });
});

test('전부 맞으면 문장이 없고 inspect 가 그렇게 말한다', (t, done) => {
    const all = DEPLOY.map((c) => Object.assign({}, c, { coll: BIN, ty: (/^(rn|sri|spi)$/.test(c.c) && c.t === 'lookup') ? 'varchar(200)' : c.ty }));
    const { ctx, seen } = tap([all]);
    m.up(ctx, (err, out) => {
        assert.ifError(err);
        assert.strictEqual(seen.filter((s) => /^ALTER/.test(s.sql)).length, 0);
        assert.strictEqual(out.affectedRows, 0);
        const again = tap([all]);
        m.inspect(again.ctx, (e2, note) => {
            assert.ifError(e2);
            assert.match(note, /이미 맞다/);
            done();
        });
    });
});
