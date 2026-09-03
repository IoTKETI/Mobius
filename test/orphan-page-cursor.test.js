'use strict';
/**
 * select_orphan_page 의 이어보기가 행을 잃지 않는가.
 *
 * 예전에는 (limit+1)번째 고아를 찾으면 그것을 버리면서 **버린 행의 ri** 를
 * 커서로 돌려줬다. 다음 쪽이 `ri > 버린행` 에서 시작하니 그 행은 영영 안 나왔다.
 * 실측: 고아 7건을 limit=2 로 이어보면 5건만 나왔다.
 *
 * 관리 콘솔의 고아 화면이 이 함수를 쓴다. 빠진 고아는 관리자가 존재 자체를
 * 모르므로 "정리했다" 고 판단하게 만든다 — 조용한 오답이라 테스트로 못박는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.usesqlite = 'true';
global.usedbhost = 'localhost';
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
        db.connect('localhost', 3306, 'root', '', function () {
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

/** 커서를 따라 끝까지 모은다. */
async function collectAll(conn, limit) {
    const out = [];
    let after = null;
    // 무한 루프 방지 — 고아가 N 개뿐이므로 넉넉히 잡아도 이보다 적게 돈다.
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

    // 부모가 없는 행 N 개. pi 가 실재하지 않으므로 전부 고아다.
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
        // 한 쪽에 다 담은 결과가 기준이다.
        const full = await collectAll(conn, 500);
        assert.strictEqual(full.length, N, '기준: 큰 limit 이면 ' + N + '건이 다 나온다');

        // 경계를 여러 번 만들도록 작은 limit 으로 이어본다.
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
        // 커서가 **버린 행**이면 다음 쪽이 그 행을 건너뛴다. 돌려준 마지막 행이어야 한다.
        assert.strictEqual(p.nextRi, p.rows[p.rows.length - 1].ri,
            'nextRi 가 돌려준 마지막 행이 아니다 — 그 사이 행이 유실된다');
    } finally {
        await run(db.k('lookup').where('ri', 'like', PREFIX + '%').del(), conn);
        db.release(conn);
    }
});
