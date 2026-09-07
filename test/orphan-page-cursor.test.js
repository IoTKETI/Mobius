'use strict';
/**
 * select_orphan_page continuation must not lose rows.
 *
 * The cursor must be the last returned row, not the (limit+1)th row that was discarded; otherwise the next page starts at `ri > discarded` and that row never appears.
 *
 * The admin console's orphan screen uses this function. A missing orphan is invisible to the operator, who then believes the cleanup is complete.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Uses its own DB file. Without this line the sqlite adapter's default ./mobius.db in the working directory would be opened. (test/acp-audit.test.js does the same.)
const os = require('os');
const fsx = require('fs');
const DBFILE = path.join(os.tmpdir(), 'mobius-orphan-page-test.db');
try { fsx.unlinkSync(DBFILE); } catch (e) { /* ignore if missing */ }
process.env.MOBIUS_SQLITE_PATH = DBFILE;

// The backend is selected by name (usedb) and the connection coordinates belong to the adapter. Setting global.usesqlite alone trips the watch test (test/usesqlite-single-reader.test.js).
global.usedb = 'sqlite';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//keti.re.kr';
global.usesuperuser = 'Sponde';

const db = require(path.join(ROOT, 'mobius', 'db'));
const q = require(path.join(ROOT, 'mobius', 'sql_action'));

const PREFIX = '/Mobius/__orphan_cursor_test';
const N = 7;

function connect() {
    return new Promise((resolve) => {
        // The facade takes a single callback; the coordinates belong to the adapter.
        db.connect(function () {
            db.getConnection(function (code, conn) { resolve(conn); });
        });
    });
}

function run(qb, conn) {
    return new Promise((resolve, reject) => {
        db.run(qb, conn, function (err, rows) { err ? reject(rows) : resolve(rows); });
    });
}

function page(conn, opts) {
    return new Promise((resolve, reject) => {
        q.select_orphan_page(conn, opts, function (err, p) { err ? reject(p) : resolve(p); });
    });
}

/** Follows the cursor to the end. */
async function collectAll(conn, limit) {
    const out = [];
    let after = null;
    // Loop guard: there are only N orphans, so the loop finishes well below this.
    for (let guard = 0; guard < 50; guard++) {
        const p = await page(conn, { limit, afterRi: after });
        p.rows.forEach((r) => { if (String(r.ri).startsWith(PREFIX)) out.push(r.ri); });
        if (!p.more) { break; }
        assert.ok(p.nextRi, 'more=true 면 nextRi 가 있어야 이어볼 수 있다');
        after = p.nextRi;
    }
    return [...new Set(out)].sort();
}

test('select_orphan_page: 이어보기가 페이지 경계에서 행을 잃지 않는다', async function () {
    const conn = await connect();
    await run(db.k('lookup').where('ri', 'like', PREFIX + '%').del(), conn);

    // N rows without a parent. pi does not exist, so all are orphans.
    for (let i = 0; i < N; i++) {
        await run(db.k('lookup').insert({
            ri: PREFIX + '/c' + String(i).padStart(2, '0'),
            pi: PREFIX + '/gone',
            ty: 3, rn: 'c' + i, st: 0,
            ct: '20250101T000000', lt: '20250101T000000', et: '20991231T000000',
            acpi: '[]'
        }), conn);
    }

    try {
        // One page holding everything is the reference.
        const full = await collectAll(conn, 500);
        assert.strictEqual(full.length, N, '기준: 큰 limit 이면 ' + N + '건이 다 나온다');

        // Small limits create several page boundaries.
        for (const limit of [1, 2, 3]) {
            const paged = await collectAll(conn, limit);
            const missing = full.filter((r) => !paged.includes(r));
            assert.deepStrictEqual(missing, [],
                'limit=' + limit + ' 로 이어봤을 때 빠진 행이 있다: ' + JSON.stringify(missing));
            assert.strictEqual(paged.length, N, 'limit=' + limit + ' 이어보기 총 건수');
        }
    } finally {
        await run(db.k('lookup').where('ri', 'like', PREFIX + '%').del(), conn);
        db.release(conn);
    }
});

test('select_orphan_page: more=true 면 nextRi 는 돌려준 마지막 행이다', async function () {
    const conn = await connect();
    await run(db.k('lookup').where('ri', 'like', PREFIX + '%').del(), conn);
    for (let i = 0; i < 4; i++) {
        await run(db.k('lookup').insert({
            ri: PREFIX + '/d' + i, pi: PREFIX + '/gone',
            ty: 3, rn: 'd' + i, st: 0,
            ct: '20250101T000000', lt: '20250101T000000', et: '20991231T000000',
            acpi: '[]'
        }), conn);
    }
    try {
        const p = await page(conn, { limit: 2, afterRi: PREFIX });
        assert.strictEqual(p.more, true);
        assert.ok(p.rows.length > 0);
        // If the cursor is the discarded row, the next page skips it. It must be the last returned row.
        assert.strictEqual(p.nextRi, p.rows[p.rows.length - 1].ri,
            'nextRi 가 돌려준 마지막 행이 아니다 — 그 사이 행이 유실된다');
    } finally {
        await run(db.k('lookup').where('ri', 'like', PREFIX + '%').del(), conn);
        db.release(conn);
    }
});
