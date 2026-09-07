'use strict';
// Migration 019: lookup.sri becomes UNIQUE.
//
// The generator (short_ri) keeps sri unique, but without a DB constraint a diverging row enters silently. The constraint can only be added after 017 has brought duplicates to 0; up counts first and refuses otherwise. The non-unique idx_lookup_sri is dropped in the same statement. INPLACE, LOCK=NONE: writes are not blocked.
//
// SQLite is not a target: an old development DB with duplicates would fail the schema's CREATE UNIQUE INDEX at startup. The generator and test/lookup-sri-dedupe keep development DBs unique.

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(os.tmpdir(), 'mobius-sri-unique-test.db');
global.NOPRINT = 'true';
global.usedb = 'mysql';

const db = require(DB);
const adapter = require(path.join(DB, 'mysql.js'));
const m = require('../migrations/019-lookup-sri-unique.js');

function tap(selectRows) {
    const seen = [];
    let sel = 0;
    adapter.execute = function (conn, sql, bindings, cb, opts) {
        seen.push({ sql: sql, bindings: bindings, opts: opts });
        if (/^select/i.test(sql)) { return cb(null, selectRows[sel++] || []); }
        cb(null, { affectedRows: 0 });
    };
    db.connect(function () {});
    return { ctx: { db: db, conn: {}, backend: 'mysql' }, seen: seen };
}

test('선언 — MySQL 만, 수동', () => {
    assert.strictEqual(m.id, '019-lookup-sri-unique');
    assert.deepStrictEqual(m.backends, ['mysql']);
    assert.strictEqual(m.autoApply, undefined, '인덱스 빌드가 기동 때 돌면 안 된다');
});

test('inspect — 유일 인덱스 유무와 중복 묶음 수를 말한다', (t, done) => {
    // 1) index lookup: none  2) duplicate group count
    const { ctx, seen } = tap([[{ n: 0 }], [{ n: 0 }]]);
    m.inspect(ctx, (err, note) => {
        assert.ifError(err);
        assert.match(seen[0].sql, /information_schema\.statistics/);
        assert.match(seen[1].sql, /group by sri having count\(\*\) > 1/);
        assert.match(note, /중복 0/);
        assert.match(note, /INPLACE/);
        done();
    });
});

test('up — 중복이 0 이면 UNIQUE 를 만들고 비유일 인덱스를 같은 문장에서 지운다, 타임아웃 없음', (t, done) => {
    const { ctx, seen } = tap([[{ n: 0 }], [{ n: 0 }]]);
    m.up(ctx, (err, out) => {
        assert.ifError(err);
        const alters = seen.filter((s) => /^ALTER/.test(s.sql));
        assert.deepStrictEqual(alters.map((s) => s.sql), [
            'ALTER TABLE lookup ADD UNIQUE INDEX idx_lookup_sri_unique (sri), DROP INDEX idx_lookup_sri, ALGORITHM=INPLACE, LOCK=NONE'
        ]);
        assert.deepStrictEqual(alters[0].opts, { timeoutMs: 0 });
        assert.strictEqual(out.affectedRows, 1);
        done();
    });
});

test('up — 중복이 남아 있으면 거부하고 아무것도 바꾸지 않는다', (t, done) => {
    const { ctx, seen } = tap([[{ n: 0 }], [{ n: 3 }]]);
    m.up(ctx, (err, out) => {
        assert.ok(err, '중복이 있는데 진행했다');
        assert.match(String(out && (out.message || out)), /중복.*3/, JSON.stringify(out));
        assert.strictEqual(seen.filter((s) => /^ALTER/.test(s.sql)).length, 0);
        done();
    });
});

test('up — 이미 유일 인덱스가 있으면 이력만 남긴다', (t, done) => {
    const { ctx, seen } = tap([[{ n: 1 }]]);
    m.up(ctx, (err, out) => {
        assert.ifError(err);
        assert.strictEqual(seen.filter((s) => /^ALTER/.test(s.sql)).length, 0);
        assert.strictEqual(out.affectedRows, 0);
        done();
    });
});
