'use strict';
// ACP reverse references: 'which resources use this ACP'.
//
// lookup.acpi has no index and holds a JSON string, so it cannot be reverse-queried in SQL; `acpi like '%...%'` is a leading wildcard and must never be used on a large lookup. Only the non-CIN rows are scanned by keyset.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-acp-refs-test.db');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//ketiabc.com';

function tap(useSqlite, pages) {
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(__dirname, '..', 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));
    const seen = [];
    let i = 0;
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        const rows = (pages && pages[i] !== undefined) ? pages[i] : [];
        i++;
        cb(null, rows);
    };
    db.connect(function () {});
    return { sql_action: require(path.join(__dirname, '..', 'mobius', 'sql_action.js')), seen: seen };
}

const row = (rn, acpi, ty) => ({ ri: '/Mobius/' + rn, ty: ty || 3, pi: '/Mobius', rn: rn,
                                 acpi: JSON.stringify(acpi) });

test('타입마다 ty 등치로 훑는다 — not_cin 술어는 인덱스를 못 탄다', function (t, done) {
    // A bare not_cin predicate would be a near-full range scan: idx_lookup_pi_notcin leads with pi and cannot serve a not_cin-only condition, and the PK (pi, ri, ty) cannot serve an ri range. ty equality uses idx_lookup_ty.
    const h = tap(false, [[]]);
    h.sql_action.scan_acpi_refs(null, {}, function (err) {
        assert.ok(!err);
        assert.ok(/`ty` = \?/.test(h.seen[0].sql), h.seen[0].sql);
        assert.ok(!/not_cin/.test(h.seen[0].sql), 'not_cin 술어는 쓰면 안 된다: ' + h.seen[0].sql);
        done();
    });
});

test('CIN(ty=4)은 타입 목록에서 빠진다', function (t, done) {
    const h = tap(false, [[]]);
    const list = h.sql_action._non_cin_ty_list();
    assert.ok(list.length > 0, '타입 목록이 비었다');
    assert.ok(list.indexOf(4) === -1, 'CIN 이 들어가 있다');
    assert.ok(list.indexOf(3) >= 0, '컨테이너가 빠졌다');
    // Every type must be asked at least once.
    h.sql_action.scan_acpi_refs(null, {}, function (err) {
        assert.ok(!err);
        assert.strictEqual(h.seen.length, list.length,
            '타입 ' + list.length + '개인데 질의는 ' + h.seen.length + '번');
        const asked = h.seen.map((s) => s.bindings[0]);
        assert.ok(asked.indexOf(4) === -1, 'CIN 을 물어봤다');
        done();
    });
});

test('tys 를 주면 그 타입만, CIN 은 빼고 훑는다', function (t, done) {
    const h = tap(false, [[], [], []]);
    h.sql_action.scan_acpi_refs(null, { tys: [3, 4, 2] }, function (err) {
        assert.ok(!err);
        assert.strictEqual(h.seen.length, 2, 'CIN 을 뺀 2개여야 한다');
        assert.deepStrictEqual(h.seen.map((s) => s.bindings[0]).sort(), [2, 3]);
        done();
    });
});

test('acpi 에 like 를 쓰지 않는다 — 선행 와일드카드는 풀스캔이다', function (t, done) {
    const h = tap(false, [[row('a', ['/Mobius/acp1'])], []]);
    h.sql_action.scan_acpi_refs(null, { acpRi: '/Mobius/acp1' }, function (err) {
        assert.ok(!err);
        h.seen.forEach(function (s) {
            assert.ok(!/acpi[^,]{0,20}like/i.test(s.sql), 'acpi 에 like 를 썼다: ' + s.sql);
        });
        done();
    });
});

test('소스 어디에도 acpi like 가 없다', function () {
    // The test above covers this path only; other places are blocked as well.
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/acpi'?\s*,\s*'like|like.{0,10}%.{0,10}acpi/i.test(code), 'acpi 에 like 를 쓰는 곳이 있다');
});

test('전역이 하나도 없어도 던지지 않는다 — 콘솔은 app.js 를 안 부른다', function (t, done) {
    // usespid is set only in app.js. The admin console is a separate process without that global, and a bare read throws ReferenceError synchronously, killing the function without a callback.
    const saved = ['usespid', 'usecseid', 'usecsebase'].map((n) => [n, global[n]]);
    saved.forEach(([n]) => { delete global[n]; });
    const h = tap(false, [[row('a', ['/Mobius/acp1'])], []]);
    assert.doesNotThrow(function () {
        h.sql_action.scan_acpi_refs(null, { acpRi: '/Mobius/acp1' }, function (err, res) {
            saved.forEach(([n, v]) => { if (v !== undefined) { global[n] = v; } });
            assert.ok(!err);
            assert.strictEqual(res.refs.length, 1);
            done();
        });
    });
});

test('접기에 필요한 전역이 서 있는지 알려 준다', function (t, done) {
    const h = tap(false, []);
    const saved = global.usespid;
    delete global.usespid;
    const bad = h.sql_action.acp_ri_context();
    assert.strictEqual(bad.ok, false);
    assert.deepStrictEqual(bad.missing, ['usespid']);
    global.usespid = '//ketiabc.com';
    const good = h.sql_action.acp_ri_context();
    assert.strictEqual(good.ok, true);
    assert.deepStrictEqual(good.missing, []);
    if (saved !== undefined) { global.usespid = saved; }
    done();
});

test('키셋으로 전진하고 마지막 반환 행을 커서로 쓴다', function (t, done) {
    const p1 = [row('a', []), row('b', ['/Mobius/acp1'])];
    const h = tap(false, [p1, []]);
    h.sql_action.scan_acpi_refs(null, { batch: 2 }, function (err, res) {
        assert.ok(!err);
        assert.ok(/order by/i.test(h.seen[0].sql));
        // The cursor of the second query must be the ri of the last row of the first page.
        assert.ok(h.seen[1].bindings.indexOf('/Mobius/b') >= 0,
            '커서가 마지막 반환 행이 아니다: ' + JSON.stringify(h.seen[1].bindings));
        assert.strictEqual(res.scanned, 2);
        done();
    });
});

test('세 가지 표기를 같은 내부 ri 로 접는다', function (t, done) {
    const rows = [
        row('r1', ['/Mobius/acp1']),
        row('r2', ['//ketiabc.com/Mobius2/Mobius/acp1']),
        row('r3', ['/Mobius2/Mobius/acp1']),
        row('r4', ['Mobius/acp1'])
    ];
    const h = tap(false, [rows, []]);
    h.sql_action.scan_acpi_refs(null, { acpRi: '/Mobius/acp1' }, function (err, res) {
        assert.ok(!err);
        assert.strictEqual(res.refs.length, 4, JSON.stringify(res.refs.map((r) => r.acpi)));
        assert.strictEqual(res.byAcp['/Mobius/acp1'], 4);
        done();
    });
});

test('깨진 acpi 는 던지지 않고 broken 만 올린다', function (t, done) {
    const h = tap(false, [[{ ri: '/Mobius/x', ty: 3, pi: '/Mobius', rn: 'x', acpi: '{not json' },
                           row('y', ['/Mobius/acp1'])], []]);
    h.sql_action.scan_acpi_refs(null, {}, function (err, res) {
        assert.ok(!err);
        assert.strictEqual(res.broken, 1);
        assert.strictEqual(res.refs.length, 1, '뒤 행은 계속 봐야 한다');
        done();
    });
});

test('빈 acpi 행은 참조로 세지 않는다', function (t, done) {
    const h = tap(false, [[row('a', []), { ri: '/Mobius/b', ty: 3, pi: '/Mobius', rn: 'b', acpi: '' }], []]);
    h.sql_action.scan_acpi_refs(null, {}, function (err, res) {
        assert.ok(!err);
        assert.strictEqual(res.refs.length, 0);
        assert.strictEqual(res.scanned, 2);
        done();
    });
});

test('scanCap 을 넘기면 capped 로 멈추고 콜백이 한 번만 불린다', function (t, done) {
    const page = Array.from({ length: 5 }, (_, i) => row('r' + i, ['/Mobius/acp1']));
    const h = tap(false, [page, page, page]);
    let calls = 0;
    h.sql_action.scan_acpi_refs(null, { batch: 5, scanCap: 5 }, function (err, res) {
        calls++;
        assert.ok(!err);
        assert.strictEqual(res.capped, true);
        assert.ok(res.next, '이어서 훑을 커서를 줘야 한다');
        setTimeout(function () { assert.strictEqual(calls, 1); done(); }, 30);
    });
});

test('이어보기 커서는 타입과 ri 를 하나로 묶는다 — 쪼갤 수 없어야 한다', function (t, done) {
    // A splittable cursor would eventually be split, the type would reset to 0 and the same range would be rescanned forever: not a wrong result, but a loop that never closes.
    const page = Array.from({ length: 5 }, (_, i) => row('r' + i, ['/Mobius/acp1']));
    const h = tap(false, [page]);
    h.sql_action.scan_acpi_refs(null, { batch: 5, scanCap: 5 }, function (err, res) {
        assert.ok(!err);
        const c = h.sql_action._parse_scan_cursor(res.next);
        assert.ok(c, '커서를 읽을 수 없다: ' + res.next);
        assert.strictEqual(typeof c.ty, 'number');
        assert.strictEqual(c.ri, '/Mobius/r4');
        done();
    });
});

test('쪼갠 커서는 조용히 처음부터 훑지 않고 거부한다', function (t, done) {
    const h = tap(false, [[]]);
    h.sql_action.scan_acpi_refs(null, { afterRi: '/Mobius/x' }, function (err, out) {
        assert.strictEqual(err, true);
        assert.strictEqual(out.code, 'BAD_CURSOR');
        h.sql_action.scan_acpi_refs(null, { afterTy: 3 }, function (err2, out2) {
            assert.strictEqual(err2, true);
            assert.strictEqual(out2.code, 'BAD_CURSOR');
            done();
        });
    });
});

test('읽을 수 없는 커서도 거부한다', function (t, done) {
    const h = tap(false, [[]]);
    h.sql_action.scan_acpi_refs(null, { after: '쓰레기' }, function (err, out) {
        assert.strictEqual(err, true);
        assert.strictEqual(out.code, 'BAD_CURSOR');
        done();
    });
});

test('커서의 타입이 이번 대상에 없으면 거부한다', function (t, done) {
    // Continuing with a changed tys would silently rescan from the start and the loop would not close.
    const h = tap(false, [[]]);
    h.sql_action.scan_acpi_refs(null, { tys: [3], after: '9|/Mobius/x' }, function (err, out) {
        assert.strictEqual(err, true);
        assert.strictEqual(out.code, 'BAD_CURSOR');
        done();
    });
});

test('커서로 이어보면 그 타입 그 자리에서 시작한다', function (t, done) {
    const h = tap(false, [[row('z', ['/Mobius/acp1'])], []]);
    h.sql_action.scan_acpi_refs(null, { tys: [2, 3], after: '3|/Mobius/m' }, function (err, res) {
        assert.ok(!err, JSON.stringify(res));
        // The first query must be ty=3, ri > '/Mobius/m' (not back to ty=2)
        assert.strictEqual(h.seen[0].bindings[0], 3);
        assert.strictEqual(h.seen[0].bindings[1], '/Mobius/m');
        done();
    });
});

test('maxRefs 를 넘으면 목록만 자르고 개수는 계속 센다', function (t, done) {
    const page = Array.from({ length: 5 }, (_, i) => row('r' + i, ['/Mobius/acp1']));
    const h = tap(false, [page, []]);
    h.sql_action.scan_acpi_refs(null, { maxRefs: 2 }, function (err, res) {
        assert.ok(!err);
        assert.strictEqual(res.refs.length, 2);
        assert.strictEqual(res.refsTruncated, true);
        assert.strictEqual(res.byAcp['/Mobius/acp1'], 5, '개수는 전부 세야 한다');
        done();
    });
});

test('내부 ri 로 접히지 않은 원소는 unresolved 로 올린다', function (t, done) {
    // Extra DB calls during the scan would be N+1; the caller decides.
    const h = tap(false, [[row('a', ['acp_short'])], []]);
    h.sql_action.scan_acpi_refs(null, {}, function (err, res) {
        assert.ok(!err);
        assert.deepStrictEqual(res.unresolved, ['acp_short']);
        done();
    });
});

test('select_acp_list 의 nextRi 는 반환된 마지막 행이다', function (t, done) {
    // Using the limit+1th row as the cursor would hide that row forever.
    const rows = ['a', 'b', 'c'].map((rn) => ({ ri: '/Mobius/' + rn, pi: '/Mobius', rn: rn,
                                                ct: '', lt: '', et: '', acpi: '[]' }));
    const h = tap(false, [rows]);
    h.sql_action.select_acp_list(null, { limit: 2 }, function (err, res) {
        assert.ok(!err);
        assert.strictEqual(res.rows.length, 2);
        assert.strictEqual(res.more, true);
        assert.strictEqual(res.nextRi, '/Mobius/b');
        done();
    });
});

test('scan_macp_refs 는 grp 를 본다 — fanOutPoint 가 macp 로 판정한다', function (t, done) {
    const h = tap(false, [[{ ri: '/Mobius/g1', macp: JSON.stringify(['/Mobius/acp1']) },
                           { ri: '/Mobius/g2', macp: '[]' }]]);
    h.sql_action.scan_macp_refs(null, { acpRi: '/Mobius/acp1' }, function (err, res) {
        assert.ok(!err);
        assert.strictEqual(res.refs.length, 1);
        assert.strictEqual(res.refs[0].ri, '/Mobius/g1');
        assert.ok(/from `grp`|from "grp"/.test(h.seen[0].sql), h.seen[0].sql);
        done();
    });
});
