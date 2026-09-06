'use strict';
// 마이그레이션 017 — lookup.sri 중복 정리 (ri/sri 설계 메모 §3 A1).
//
// 옛 생성기(ms + 난수 3자리)가 워커 24개에서 겹쳐 배포 lookup 에 같은 sri 를 가진
// 행이 쌍으로 남아 있다(7월 9 · 8월 16 · 9월 1~6일 14 묶음). 밖으로 같은 ri 를
// 내보내는 두 리소스다. 이 마이그레이션은 묶음마다 (ct, ri) 순 첫 행을 남기고
// 나머지에 새 sri 를 매긴다. 그 행에 자식이 있으면 자식의 spi(부모의 짧은 id)도
// 따라간다. AE(ty=2)는 sri 가 aei 라 손대지 않고 보고만 한다.
//
// 실제 SQLite 파일에 배포와 같은 모양의 묶음을 넣고 up 을 돌린다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DBFILE = path.join(os.tmpdir(), 'mobius-sri-dedupe-test.db');
try { fs.unlinkSync(DBFILE); } catch (e) { /* 없으면 그만 */ }
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
            // 묶음 1: 서로 다른 컨테이너의 CIN 둘이 같은 ms 의 같은 sri (배포 실측 모양)
            await row('/Mobius/a/c1/x1', 4, '4-DUP1', '20260904T013656');
            await row('/Mobius/a/c2/x2', 4, '4-DUP1', '20260904T013656');
            // 묶음 2: 컨테이너 둘이 같은 sri. 둘 다 자식이 있고 자식의 spi 가 그 sri 다.
            //         ct 가 앞선 k2 가 남고(ri 순이면 k1 이 남는다 — 변이로 가른다) 뒤 ct 인 k1 이
            //         새 sri 를 받으며 k1 의 자식만 spi 가 따라간다.
            await row('/Mobius/a/k1', 3, '3-DUP2', '20260102T000000');
            await row('/Mobius/a/k2', 3, '3-DUP2', '20260101T000000');
            await row('/Mobius/a/k1/c', 4, '4-U1', '20260103T000000', '3-DUP2');
            await row('/Mobius/a/k2/c', 4, '4-U2', '20260103T000000', '3-DUP2');
            // 묶음 3: AE 둘이 같은 sri — sri 가 aei 라 손대지 않는다
            await row('/Mobius/ae1', 2, 'Sdup', '20260101T000000');
            await row('/Mobius/ae2', 2, 'Sdup', '20260101T000000');
            // 중복 아닌 행
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

    // AE 묶음만 남는다
    const dups = await run('select sri from lookup group by sri having count(*) > 1');
    assert.deepStrictEqual(dups.map((d) => d.sri), ['Sdup']);
    assert.strictEqual(await sri_of('/Mobius/ae2'), 'Sdup');
});

test('두 번 돌리면 아무것도 바꾸지 않는다', async () => {
    const out = await new Promise((res, rej) => m.up(ctx, (err, o) => (err ? rej(o) : res(o))));
    assert.strictEqual(out.affectedRows, 0);
});
