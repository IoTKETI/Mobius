'use strict';
// 마이그레이션 019 — lookup.sri 를 UNIQUE 로 (ri/sri 설계 메모 §3 A1 의 마지막 단계).
//
// 생성기(short_ri)가 유일성을 지키지만 DB 가 막지 않으면 어긋난 행이 조용히 들어온다.
// 017 로 중복을 0 으로 만든 뒤에만 걸 수 있다 — 중복이 남아 있으면 ALTER 가 실패하므로
// up 은 먼저 세어 보고 거부한다. 비유일 idx_lookup_sri(15.8GB)는 같은 문장에서 지운다.
// INPLACE · LOCK=NONE 이라 쓰기를 막지 않는다(6,200만 행 인덱스 빌드 — 수십 분).
//
// SQLite 는 대상이 아니다 — 옛 개발 DB 에 중복이 있으면 기동 때 스키마의 CREATE UNIQUE
// INDEX 가 실패해 뜨지 못한다. 개발 DB 의 유일성은 생성기와 test/lookup-sri-dedupe 가 지킨다.

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
    // 1) 인덱스 조회: 없음  2) 중복 묶음 수
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
