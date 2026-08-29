'use strict';
// ACP 변경 이력.
//
// acp 테이블에는 cr 컬럼이 없어 ACP 를 누가 만들었는지 어디에도 남지 않고,
// acpi 를 바꾸면 옛 값이 사라진다. 삭제와 달리 "목록을 다시 조회하면 드러난다"
// 가 성립하지 않아 되돌릴 근거가 없다.
//
// 쓰기는 best-effort 다 — 이력 저장이 실패해도 본 요청을 실패시키지 않는다.
// 감사 때문에 운영이 멈추면 감사부터 꺼진다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DBFILE = path.join(os.tmpdir(), 'mobius-acp-audit-test.db');
try { fs.unlinkSync(DBFILE); } catch (e) { /* 없으면 그만 */ }
process.env.MOBIUS_SQLITE_PATH = DBFILE;

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//ketiabc.com';
global.usesqlite = 'true';

const db = require('../mobius/db');
const db_sql = require('../mobius/sql_action');

let conn = null;

test.before(function (t, done) {
    db.connect('h', 1, 'u', 'p', function (rsc) {
        assert.strictEqual(rsc, '1', 'SQLite 연결 실패 ' + rsc);
        db.getConnection(function (code, c) {
            assert.strictEqual(code, '200');
            conn = c;
            done();
        });
    });
});

function insert(entry) {
    return new Promise(function (res) {
        db_sql.insert_acp_audit(conn, entry, function () { res(); });
    });
}
function read(opts) {
    return new Promise(function (res, rej) {
        db_sql.select_acp_audit(conn, opts || {}, function (err, out) {
            if (err) { return rej(new Error(JSON.stringify(out))); }
            res(out);
        });
    });
}
function clear() {
    return new Promise(function (res) {
        db.run(db.k('acp_audit').del(), conn, function () { res(); });
    });
}

test('만든 사람과 내용이 남는다 — acp 에는 cr 컬럼이 없다', async function () {
    await clear();
    await insert({ op: 'acp_create', ri: '/Mobius/acp1', ty: 1, origin: 'Cowner',
                   before: null, after: { pv: { acr: [] } } });
    const out = await read({});
    assert.strictEqual(out.rows.length, 1);
    assert.strictEqual(out.rows[0].op, 'acp_create');
    assert.strictEqual(out.rows[0].origin, 'Cowner');
    assert.deepStrictEqual(out.rows[0].after, { pv: { acr: [] } });
});

test('acpi 의 옛 값과 새 값을 함께 남긴다', async function () {
    await clear();
    await insert({ op: 'acpi_set', ri: '/Mobius/c1', ty: 3, origin: 'Sponde', cr: 'Cowner',
                   before: ['/Mobius/acp1'], after: [] });
    const out = await read({});
    assert.deepStrictEqual(out.rows[0].before, ['/Mobius/acp1']);
    assert.deepStrictEqual(out.rows[0].after, []);
    assert.strictEqual(out.rows[0].cr, 'Cowner');
});

test('최신순으로 돌려주고 커서로 이어 읽는다', async function () {
    await clear();
    for (let i = 0; i < 5; i++) {
        await insert({ op: 'acpi_set', ri: '/Mobius/c' + i, ty: 3, origin: 'C', after: [] });
    }
    const p1 = await read({ limit: 2 });
    assert.strictEqual(p1.rows.length, 2);
    assert.strictEqual(p1.more, true);
    assert.strictEqual(p1.rows[0].ri, '/Mobius/c4', '최신이 먼저다');
    // nextId 는 **반환된 마지막 행**이다. limit+1 번째를 쓰면 한 줄이 샌다.
    const p2 = await read({ limit: 2, afterId: p1.nextId });
    assert.strictEqual(p2.rows[0].ri, '/Mobius/c2');
    const ids = p1.rows.concat(p2.rows).map((r) => r.id);
    assert.strictEqual(new Set(ids).size, 4, '겹치거나 빠진 행이 있다');
});

test('ri 와 op 로 거를 수 있다', async function () {
    await clear();
    await insert({ op: 'acpi_set', ri: '/Mobius/c1', ty: 3, origin: 'C', after: [] });
    await insert({ op: 'acp_create', ri: '/Mobius/acp1', ty: 1, origin: 'C', after: {} });
    await insert({ op: 'acpi_set', ri: '/Mobius/c2', ty: 3, origin: 'C', after: [] });

    assert.strictEqual((await read({ ri: '/Mobius/c1' })).rows.length, 1);
    assert.strictEqual((await read({ op: 'acpi_set' })).rows.length, 2);
    assert.strictEqual((await read({ op: 'acp_create' })).rows.length, 1);
});

test('limit 은 상한을 넘지 않는다', async function () {
    await clear();
    await insert({ op: 'acpi_set', ri: '/Mobius/c1', ty: 3, origin: 'C', after: [] });
    const out = await read({ limit: 99999 });
    assert.ok(out.rows.length <= 200);
});

test('insert 가 실패해도 콜백은 오류 없이 돌아온다', function (t, done) {
    // 마이그레이션 007 전이면 테이블이 없다. 그래도 요청은 정상 처리돼야 한다.
    const orig = console.error;
    console.error = function () {};
    db_sql.insert_acp_audit({ broken: true }, { op: 'acpi_set', ri: '/M/x', ty: 3 },
        function (err) {
            console.error = orig;
            assert.ok(!err, '이력 실패가 요청을 실패시키면 안 된다');
            done();
        });
});

test('직렬화할 수 없는 값에도 던지지 않는다', function (t, done) {
    const cyc = {};
    cyc.self = cyc;
    const orig = console.error;
    console.error = function () {};
    assert.doesNotThrow(function () {
        db_sql.insert_acp_audit(conn, { op: 'acpi_set', ri: '/M/x', ty: 3, after: cyc },
            function (err) {
                console.error = orig;
                assert.ok(!err);
                done();
            });
    });
});

test("acp_audit 이 'off' 면 아무것도 쓰지 않는다", async function () {
    await clear();
    global.acp_audit = 'off';
    await insert({ op: 'acpi_set', ri: '/Mobius/c1', ty: 3, origin: 'C', after: [] });
    global.acp_audit = 'on';
    assert.strictEqual((await read({})).rows.length, 0);
});

test('prune 은 beforeTs 없이는 아무것도 지우지 않는다', function (t, done) {
    // 전체 삭제를 실수로 부르는 일을 막는다.
    db_sql.prune_acp_audit(conn, {}, function (err, out) {
        assert.strictEqual(err, true);
        assert.ok(/beforeTs/.test(out.message));
        done();
    });
});

test('acpi 를 안 바꾸는 수정은 이력을 남기지 않는다', function () {
    // resource.js 의 record_acp_change 가 값이 같으면 건너뛴다.
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');
    const m = src.match(/function record_acp_change[\s\S]*?\n\}/);
    assert.ok(m, 'record_acp_change 를 찾지 못했다');
    assert.ok(/JSON\.stringify\(before\) === JSON\.stringify\(after\)/.test(m[0]),
        '값이 같으면 건너뛰어야 한다 — 안 그러면 모든 PUT 이 이력을 남긴다');
});

test('이력은 커넥션이 살아 있는 동안 남긴다 — 미루면 안 된다', function () {
    // setImmediate 로 미루면 그 사이 응답이 나가고 request.db_connection 이
    // 풀에 반납된다. 반납된 핸들로 질의하면 그 커넥션을 이미 빌려 간 다른
    // 요청의 트랜잭션 안으로 INSERT 가 섞이고, 그쪽이 롤백하면 이력이
    // 조용히 사라진다. 최악은 남의 트랜잭션을 방해하는 것이다.
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');
    const m = src.match(/function record_acp_change[\s\S]*?\n\}/);
    assert.ok(!/setImmediate/.test(m[0]),
        '미루면 반납된 커넥션에서 돈다');
    assert.ok(/db_sql\.insert_acp_audit\(request\.db_connection/.test(m[0]),
        '요청 커넥션을 그 자리에서 써야 한다');
    // 호출부가 콜백을 받아 순서를 지키는지도 본다.
    assert.ok(/record_acp_change\(request, 'acpi_set'[\s\S]{0,200}function \(\) \{/.test(src),
        '호출부가 이력 저장을 기다린 뒤 응답해야 한다');
});

test('마이그레이션과 두 스키마 파일이 같은 테이블을 만든다', function () {
    const ROOT = path.join(__dirname, '..');
    const mig = fs.readFileSync(path.join(ROOT, 'migrations', '007-acp-audit-table.js'), 'utf8');
    const my = fs.readFileSync(path.join(ROOT, 'mobius', 'mobiusdb.sql'), 'utf8');
    const lite = fs.readFileSync(path.join(ROOT, 'mobius', 'mobiusdb_sqlite.sql'), 'utf8');
    for (const [name, src] of [['migration', mig], ['mobiusdb.sql', my], ['sqlite', lite]]) {
        assert.ok(/acp_audit/.test(src), name + ' 에 acp_audit 이 없다');
        for (const col of ['ts', 'op', 'ri', 'ty', 'origin', 'cr', 'before_val', 'after_val']) {
            assert.ok(new RegExp('\\b' + col + '\\b').test(src), name + ' 에 ' + col + ' 이 없다');
        }
    }
});
