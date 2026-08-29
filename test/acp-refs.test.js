'use strict';
// ACP 역참조 조회 — "어떤 리소스가 이 ACP 를 쓰는가".
//
// lookup.acpi 에는 인덱스가 없고 JSON 문자열이라 SQL 로 역질의가 안 된다.
// `acpi like '%...%'` 는 선행 와일드카드라 인덱스를 못 탄다 — 배포 lookup 은
// 5,740만 행이므로 절대 쓰면 안 된다. not_cin 술어로 CIN 3,400만 행을 빼고
// 남는 34,313 행만 키셋으로 훑는다.

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
    global.usesqlite = useSqlite ? 'true' : 'false';
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
    db.connect('h', 1, 'u', 'p', function () {});
    return { sql_action: require(path.join(__dirname, '..', 'mobius', 'sql_action.js')), seen: seen };
}

const row = (rn, acpi, ty) => ({ ri: '/Mobius/' + rn, ty: ty || 3, pi: '/Mobius', rn: rn,
                                 acpi: JSON.stringify(acpi) });

test('타입마다 ty 등치로 훑는다 — not_cin 술어는 인덱스를 못 탄다', function (t, done) {
    // 배포 EXPLAIN: `where not_cin = 1 and ri > ''` 는 ri_UNIQUE 범위 스캔으로
    // **3,097만 행** 추정이다. idx_lookup_pi_notcin 은 선행 컬럼이 pi 라
    // not_cin 단독 조건에 못 쓰고, PK 는 (pi, ri, ty) 라 ri 범위에도 못 쓴다.
    // ty 등치는 idx_lookup_ty 를 탄다(ref, rows=1).
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
    // 타입마다 한 번씩은 물어봐야 한다.
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
    // 위 테스트는 이 경로만 본다. 다른 곳에 생기는 것도 막는다.
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/acpi'?\s*,\s*'like|like.{0,10}%.{0,10}acpi/i.test(code), 'acpi 에 like 를 쓰는 곳이 있다');
});

test('전역이 하나도 없어도 던지지 않는다 — 콘솔은 app.js 를 안 부른다', function (t, done) {
    // usespid 는 app.js 에서만 세운다. 관리 콘솔은 별도 프로세스라 그 전역이
    // 없고, 이름으로 바로 읽으면 ReferenceError 로 **동기 throw** 한다 —
    // 콜백으로도 안 나오고 함수가 통째로 죽는다.
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
        // 두 번째 질의의 커서가 첫 페이지 마지막 행의 ri 여야 한다.
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
        assert.ok(res.nextRi, '이어서 훑을 커서를 줘야 한다');
        setTimeout(function () { assert.strictEqual(calls, 1); done(); }, 30);
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
    // 스캔 중에 DB 를 더 부르면 N+1 이 된다. 판단은 호출부가 한다.
    const h = tap(false, [[row('a', ['acp_short'])], []]);
    h.sql_action.scan_acpi_refs(null, {}, function (err, res) {
        assert.ok(!err);
        assert.deepStrictEqual(res.unresolved, ['acp_short']);
        done();
    });
});

test('select_acp_list 의 nextRi 는 반환된 마지막 행이다', function (t, done) {
    // limit+1 번째를 커서로 쓰면 그 한 줄이 영영 안 나온다.
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
