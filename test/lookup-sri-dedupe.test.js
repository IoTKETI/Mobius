'use strict';
// Migration 017: removes duplicate lookup.sri values.
//
// The old generator could produce the same sri in several workers, leaving pairs of rows that expose the same ri externally. For each duplicate group the migration keeps the first row in (ct, ri) order and assigns new sri values to the rest; children of a renumbered row have their spi (parent's short id) updated. AEs (ty=2) are reported only, since their sri is the aei.
//
// Runs up against a real SQLite file seeded with groups shaped like the deployment.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DBFILE = path.join(os.tmpdir(), 'mobius-sri-dedupe-test.db');
try { fs.unlinkSync(DBFILE); } catch (e) { /* ignore if missing */ }
process.env.MOBIUS_SQLITE_PATH = DBFILE;

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//ketiabc.com';
global.usedb = 'sqlite';

const db = require('../mobius/db');
const m = require('../migrations/017-dedupe-lookup-sri.js');

let ctx = null;
function run(sql, args) {
    return new Promise((res, rej) => db.run(db.raw(sql, args || []), ctx.conn, (err, rows) => (err ? rej(rows) : res(rows))));
}
function row(ri, ty, sri, ct, spi) {
    const pi = ri.replace(/\/[^/]+$/, '');
    const rn = ri.split('/').pop();
    return run('insert into lookup (pi, ri, ty, ct, st, rn, lt, et, sri, spi) values (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
        [pi, ri, ty, ct, rn, ct, '99991231T235959', sri, spi || '5-cb']);
}
function sri_of(ri) { return run('select sri from lookup where ri = ?', [ri]).then((r) => r[0].sri); }
function spi_of(ri) { return run('select spi from lookup where ri = ?', [ri]).then((r) => r[0].spi); }

test.before((t, done) => {
    db.connect((rsc) => {
        assert.strictEqual(rsc, '1', 'SQLite 연결 실패 ' + rsc);
        db.getConnection(async (code, c) => {
            assert.strictEqual(code, '200');
            ctx = { db: db, conn: c, backend: 'sqlite' };
            // Group 1: two CINs in different containers share the same sri from the same millisecond.
            await row('/Mobius/a/c1/x1', 4, '4-DUP1', '20260904T013656');
            await row('/Mobius/a/c2/x2', 4, '4-DUP1', '20260904T013656');
            // Group 2: two containers share an sri. Both have children whose spi is that sri. k2 with the earlier ct is kept (ri order would keep k1; the mutation tells them apart), k1 with the later ct receives a new sri, and only k1's children have their spi updated.
            await row('/Mobius/a/k1', 3, '3-DUP2', '20260102T000000');
            await row('/Mobius/a/k2', 3, '3-DUP2', '20260101T000000');
            await row('/Mobius/a/k1/c', 4, '4-U1', '20260103T000000', '3-DUP2');
            await row('/Mobius/a/k2/c', 4, '4-U2', '20260103T000000', '3-DUP2');
            // Group 3: two AEs share an sri; untouched because the sri is the aei.
            await row('/Mobius/ae1', 2, 'Sdup', '20260101T000000');
            await row('/Mobius/ae2', 2, 'Sdup', '20260101T000000');
            // Non-duplicate row.
            await row('/Mobius/a', 3, '3-OK', '20250101T000000');
            done();
        });
    });
});

test('선언 — 수동 적용, 두 백엔드', () => {
    assert.strictEqual(m.id, '017-dedupe-lookup-sri');
    assert.deepStrictEqual(m.backends.slice().sort(), ['mysql', 'sqlite']);
    assert.strictEqual(m.autoApply, undefined, '데이터를 바꾸는 마이그레이션은 기동 때 자동으로 돌지 않는다');
});

test('inspect 가 묶음 수와 손대지 않을 AE 묶음을 말한다', async () => {
    const note = await new Promise((res, rej) => m.inspect(ctx, (err, n) => (err ? rej(n) : res(n))));
    assert.match(note, /묶음 3/, note);
    assert.match(note, /AE.*1/, note);
});

test('up — (ct, ri) 순 첫 행은 남고 나머지는 새 sri 를 받는다. 자식 spi 도 따라간다', async () => {
    const out = await new Promise((res, rej) => m.up(ctx, (err, o) => (err ? rej(o) : res(o))));
    assert.strictEqual(out.affectedRows, 2, JSON.stringify(out));

    assert.strictEqual(await sri_of('/Mobius/a/c1/x1'), '4-DUP1', 'ri 순으로 앞선 행이 남아야 한다');
    const x2 = await sri_of('/Mobius/a/c2/x2');
    assert.match(x2, /^4-\d{17}[0-9a-z]+$/, '새 생성기 모양이어야 한다: ' + x2);

    assert.strictEqual(await sri_of('/Mobius/a/k2'), '3-DUP2', 'ct 가 앞선 행이 남아야 한다 (ri 순이 아니다)');
    const k1 = await sri_of('/Mobius/a/k1');
    assert.match(k1, /^3-\d{17}[0-9a-z]+$/, k1);
    assert.strictEqual(await spi_of('/Mobius/a/k1/c'), k1, '바뀐 부모의 자식은 spi 가 따라가야 한다');
    assert.strictEqual(await spi_of('/Mobius/a/k2/c'), '3-DUP2', '남은 부모의 자식은 그대로다');

    // Only the AE group remains.
    const dups = await run('select sri from lookup group by sri having count(*) > 1');
    assert.deepStrictEqual(dups.map((d) => d.sri), ['Sdup']);
    assert.strictEqual(await sri_of('/Mobius/ae2'), 'Sdup');
});

test('두 번 돌리면 아무것도 바꾸지 않는다', async () => {
    const out = await new Promise((res, rej) => m.up(ctx, (err, o) => (err ? rej(o) : res(o))));
    assert.strictEqual(out.affectedRows, 0);
});
