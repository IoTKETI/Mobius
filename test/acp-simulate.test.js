'use strict';
// Simulator: 'what happens when this originator performs this operation on this resource'.
//
// The console is a separate process whose write origin is the superuser, so an HTTP round trip cannot verify a policy; only the decision is returned.
//
// It uses security.js's decision function directly. A second copy would diverge eventually, and the preview could no longer be trusted; the last test pins that.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-acp-sim-test.db');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//ketiabc.com';
global.uservi = '2a';
global.usesuperuser = 'Sponde';
global.useaccesscontrolpolicy = 'disable';

const security = require('../mobius/security');

// An adapter that answers by the content of the query. The number of queries differs per originator (creator and superuser finish before acpi is resolved), so a fixed array would not line up.
function tapBy(answer) {
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(__dirname, '..', 'mobius', 'sql_action.js'),
                     path.join(__dirname, '..', 'mobius', 'acp_simulate.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, answer(sql, bindings) || []);
    };
    db.connect(function () {});
    return { sim: require(path.join(__dirname, '..', 'mobius', 'acp_simulate.js')), seen: seen };
}

function tap(pages) {
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(__dirname, '..', 'mobius', 'sql_action.js'),
                     path.join(__dirname, '..', 'mobius', 'acp_simulate.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    let i = 0;
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        const rows = (pages && pages[i] !== undefined) ? pages[i] : [];
        i++;
        cb(null, rows);
    };
    db.connect(function () {});
    return { sim: require(path.join(__dirname, '..', 'mobius', 'acp_simulate.js')), seen: seen };
}

const cnt = (rn, acpi, cr) => ({ ri: '/Mobius/' + rn, ty: 3, pi: '/Mobius', rn: rn,
                                 acpi: JSON.stringify(acpi || []), cr: cr || 'Cowner' });
const acpRow = (ri, who) => ({ ri: ri, pv: JSON.stringify({ acr: [{ acor: [who], acop: 63 }] }),
                                        pvs: JSON.stringify({ acr: [{ acor: ['Sponde'], acop: 63 }] }) });

// select_resource_from_url is two queries (lookup + type table).
const target = (row) => [[row], [row]];

test('없는 리소스는 found:false 다', function (t, done) {
    const h = tap([[]]);
    h.sim.simulate(null, { ri: '/Mobius/nope', origin: 'C', op: 'RETRIEVE' }, function (err, r) {
        assert.ok(!err);
        assert.strictEqual(r.found, false);
        done();
    });
});

test('허용될 때 어느 ACP 의 몇 번째 규칙인지 알려 준다', function (t, done) {
    const h = tap(target(cnt('c1', ['/Mobius/acp1'])).concat([[acpRow('/Mobius/acp1', 'Cteam')]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cteam', op: 'UPDATE' }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.decided_by, 'acr');
        assert.strictEqual(r.acp_ri, '/Mobius/acp1');
        assert.strictEqual(r.acr_index, 0);
        assert.strictEqual(r.source, 'own');
        done();
    });
});

test('거부될 때도 사유가 남는다', function (t, done) {
    const h = tap(target(cnt('c1', ['/Mobius/acp1'])).concat([[acpRow('/Mobius/acp1', 'Cteam')]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cother', op: 'UPDATE' }, function (err, r) {
        assert.ok(!err);
        assert.strictEqual(r.allowed, false);
        assert.strictEqual(r.decided_by, 'exhausted');
        done();
    });
});

test('생성자는 ACP 가 걸려 있어도 통과한다', function (t, done) {
    const h = tap(target(cnt('c1', ['/Mobius/acp1'], 'Cowner')));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cowner', op: 'DELETE' }, function (err, r) {
        assert.ok(!err);
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.decided_by, 'creator');
        // No acp query may be sent at all.
        assert.strictEqual(h.seen.length, 2, '질의가 ' + h.seen.length + '번 나갔다');
        done();
    });
});

test('수퍼유저는 ACP 를 하나도 보지 않는다 — 경고를 함께 준다', function (t, done) {
    const h = tap(target(cnt('c1', ['/Mobius/acp1'])));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Sponde', op: 'DELETE' }, function (err, r) {
        assert.ok(!err);
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.decided_by, 'superuser');
        assert.ok(r.warnings.some((w) => w.rule === 'superuser'));
        assert.strictEqual(h.seen.length, 2, 'acp 질의가 나가면 안 된다');
        done();
    });
});

test('절대 표기로 저장된 정상 참조를 dangling 으로 보지 않는다', function (t, done) {
    // The real decision path folds with make_internal_ri. Skipping that step would show every valid reference stored in absolute or SP-relative notation as dangling, and the console's first screen would claim 'this ACP does not exist'.
    const abs = '//ketiabc.com/Mobius2/Mobius/acp1';
    const h = tap(target(cnt('c1', [abs], 'Cowner')).concat([[acpRow('/Mobius/acp1', 'Cteam')]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cteam', op: 'RETRIEVE' }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.allowed, true);
        assert.deepStrictEqual(r.warnings, [], '경고가 있으면 안 된다: ' + JSON.stringify(r.warnings));
        assert.deepStrictEqual(r.resolved,
            [{ given: abs, ri: '/Mobius/acp1', exists: true }],
            '원문과 푼 값을 둘 다 보여 줘야 한다');
        done();
    });
});

test('sri 로 저장된 참조는 풀지 않는다 — 실제 판정과 같이 dangling 이다 (§5.3)', function (t, done) {
    // sri-form acpi entries are not resolved, because the real decision path (security_check_action) does not resolve them either; resolving them here would make the console report as valid a reference that is actually refused. Query 3 goes straight to select_acp_in and returns no row.
    const h = tap(target(cnt('c1', ['acp1short'], 'Cowner')).concat([[]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cteam', op: 'RETRIEVE' }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.allowed, false);
        assert.strictEqual(r.decided_by, 'no_acp_row');
        assert.ok(r.warnings.some((w) => w.rule === 'dangling'), JSON.stringify(r.warnings));
        assert.deepStrictEqual(r.resolved, [{ given: 'acp1short', ri: 'acp1short', exists: false }]);
        // resolve_acpi_entries was `where sri in (...)`; no query of that shape may be sent
        assert.ok(!h.seen.some((s) => /`sri`\s+in\s*\(/i.test(s.sql)), 'sri 를 푸는 질의가 나갔다: ' + h.seen.map((s) => s.sql).join(' | '));
        done();
    });
});

test('없는 ACP 를 가리키면 dangling 경고를 준다', function (t, done) {
    const h = tap(target(cnt('c1', ['/Mobius/gone'], 'Cowner')).concat([[]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cother', op: 'RETRIEVE' }, function (err, r) {
        assert.ok(!err);
        assert.strictEqual(r.decided_by, 'no_acp_row');
        assert.ok(r.warnings.some((w) => w.rule === 'dangling'));
        assert.deepStrictEqual(r.resolved, [{ given: '/Mobius/gone', ri: '/Mobius/gone', exists: false }]);
        done();
    });
});

test('acpi 가 없으면 기본 정책으로 답한다', function (t, done) {
    const h = tap(target(cnt('c1', [], 'Cowner')).concat([[]]));
    // ty=3 with empty acpi walks the ancestors (select_acp_cnt) -> empty result
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cother', op: 'RETRIEVE' }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.decided_by, 'default_policy');
        assert.strictEqual(r.allowed, true, "'disable' 에서 조회는 누구나다");
        done();
    });
});

test("기본 정책에서 UPDATE 는 생성자만이다", function (t, done) {
    const h = tap(target(cnt('c1', [], 'Cowner')).concat([[]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cother', op: 'UPDATE' }, function (err, r) {
        assert.ok(!err);
        assert.strictEqual(r.decided_by, 'default_policy');
        assert.strictEqual(r.allowed, false);
        done();
    });
});

test('acpiOverride 는 저장값을 무시한다 — 잠그기 전에 미리 본다', function (t, done) {
    const h = tap(target(cnt('c1', [], 'Cowner')).concat([[acpRow('/Mobius/acpX', 'Cteam')]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cteam', op: 'RETRIEVE',
                           acpiOverride: ['/Mobius/acpX'] }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.source, 'override');
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.acp_ri, '/Mobius/acpX');
        done();
    });
});

test('acpiOverride:[] 는 "떼면 어떻게 되나" 다 — 저장값이 빈 것과 같아야 한다', function (t, done) {
    // An empty array must not take the override branch: select_acp_in with an empty list returns no row and answered no_acp_row (creator only), while the real answer is the default policy, open to everyone. The preview said 'all locked'; wrong towards the unsafe side.
    const h = tap(target(cnt('c1', ['/Mobius/acp1'], 'Cowner')).concat([[]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cother', op: 'RETRIEVE',
                           acpiOverride: [] }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.decided_by, 'default_policy',
            "빈 override 는 기본 정책으로 떨어져야 한다 (받은 값: " + r.decided_by + ")");
        assert.strictEqual(r.allowed, true, "'disable' 에서 조회는 누구나다");
        assert.strictEqual(r.source, 'override', '뗐다고 가정한 결과임이 남아야 한다');
        done();
    });
});

test('acpiOverride:[] 여도 조상 상속은 그대로 걸린다', function (t, done) {
    // select_acp_cnt returns the ancestor's acpi: only the resource's own acpi was detached, not the ancestor's.
    const h = tap(target(cnt('c1', ['/Mobius/acp1'], 'Cowner'))
        .concat([[{ acpi: JSON.stringify(['/Mobius/acpP']), ty: 2 }],
                 [acpRow('/Mobius/acpP', 'Cteam')]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cteam', op: 'RETRIEVE',
                           acpiOverride: [] }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.source, 'override_inherited');
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.acp_ri, '/Mobius/acpP');
        done();
    });
});

test('acpRowsOverride 로 아직 저장하지 않은 본문을 물어볼 수 있다', function (t, done) {
    const h = tap(target(cnt('c1', [], 'Cowner')).concat([[]]));
    h.sim.simulate(null, {
        ri: '/Mobius/c1', origin: 'Cnew', op: 'RETRIEVE',
        acpiOverride: ['/Mobius/draft'],
        acpRowsOverride: [acpRow('/Mobius/draft', 'Cnew')]
    }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.allowed, true);
        assert.strictEqual(r.decided_by, 'acr');
        done();
    });
});

test('pv 에 acr 이 없는 ACP 는 경고로 알려 준다', function (t, done) {
    const h = tap(target(cnt('c1', [], 'Cowner')).concat([[]]));
    h.sim.simulate(null, {
        ri: '/Mobius/c1', origin: 'Cx', op: 'RETRIEVE',
        acpiOverride: ['/Mobius/draft'],
        acpRowsOverride: [{ ri: '/Mobius/draft', pv: '{}', pvs: '{}' }]
    }, function (err, r) {
        assert.ok(!err);
        assert.strictEqual(r.decided_by, 'no_acr_cr');
        assert.ok(r.warnings.some((w) => w.rule === 'pv_no_acr'));
        done();
    });
});

test('연산 이름과 acop 비트를 둘 다 받는다', function (t, done) {
    const h = tap([]);
    assert.strictEqual(h.sim._access_value_of('DELETE'), '8');
    assert.strictEqual(h.sim._access_value_of('discovery'), '32');
    assert.strictEqual(h.sim._access_value_of('4'), '4');
    assert.strictEqual(h.sim._access_value_of('없는연산'), null);
    // sub creation is CREATE+RETRIEVE, hence '3'.
    assert.strictEqual(h.sim._access_value_of('CREATE_SUB'), '3');
    done();
});

test('모르는 연산은 거부한다', function (t, done) {
    const h = tap([]);
    h.sim.simulate(null, { ri: '/M/x', origin: 'C', op: '먹기' }, function (err, out) {
        assert.strictEqual(err, true);
        assert.strictEqual(out.code, 'BAD_PARAMS');
        done();
    });
});

test('acpi 출처는 원본을 적은 순서에 좌우되지 않는다', function (t, done) {
    // Superuser and creator are short-circuited before acpi is resolved. Using that result as the top-level source/acpi would make the source 'none' and drop the inheritance warning merely because the creator was listed first, which is a natural order for an administrator.
    const target_row = cnt('c1', ['/Mobius/acp1'], 'Cdevice');
    function run(origins, cb) {
        // The number of queries differs per originator (the creator does not resolve acpi), so the answer is chosen by the SQL.
        const h = tapBy(function (sql) {
            if (/from `acp`/.test(sql)) { return [acpRow('/Mobius/acp1', 'Cteam')]; }
            return [target_row];
        });
        h.sim.simulate_many(null, { ri: '/Mobius/c1', origins: origins, ops: ['RETRIEVE'] }, cb);
    }
    run(['Cteam', 'Cdevice'], function (e1, a) {
        assert.ok(!e1, JSON.stringify(a));
        run(['Cdevice', 'Cteam'], function (e2, b) {
            assert.ok(!e2, JSON.stringify(b));
            assert.strictEqual(a.source, b.source, '순서만 바꿨는데 출처가 달라진다');
            assert.deepStrictEqual(a.acpi, b.acpi, '순서만 바꿨는데 acpi 가 달라진다');
            assert.strictEqual(b.source, 'own');
            done();
        });
    });
});

test('전부 단축 판정되면 출처를 모른다고 말한다', function (t, done) {
    // Writing 'none' (= no ACP) would be false.
    const h = tap(target(cnt('c1', ['/Mobius/acp1'], 'Cowner')));
    h.sim.simulate_many(null, { ri: '/Mobius/c1', origins: ['Cowner'], ops: ['RETRIEVE'] },
        function (err, r) {
            assert.ok(!err, JSON.stringify(r));
            assert.strictEqual(r.source, null);
            assert.strictEqual(r.acpi, null);
            assert.ok(r.warnings.some((w) => w.rule === 'source_unknown'));
            // Values describing the resource itself must remain.
            assert.strictEqual(r.cr, 'Cowner');
            assert.strictEqual(String(r.ty), '3');
            done();
        });
});

test('조합이 너무 많으면 거부한다 — 조용히 자르지 않는다', function (t, done) {
    // Truncating would show fewer results than asked without saying so; the worst failure in a permission decision.
    const h = tap([]);
    h.sim.simulate_many(null, { ri: '/M/x', origins: Array(21).fill('C'), ops: ['RETRIEVE'] },
        function (err, out) {
            assert.strictEqual(err, true);
            assert.strictEqual(out.code, 'TOO_MANY');
            h.sim.simulate_many(null, { ri: '/M/x', origins: Array(20).fill('C'),
                                        ops: ['RETRIEVE', 'UPDATE', 'DELETE', 'CREATE', 'NOTIFY',
                                              'DISCOVERY', 'CREATE_SUB'] },
                function (err2, out2) {
                    assert.strictEqual(err2, true, '20 x 7 = 140 은 상한을 넘는다');
                    assert.strictEqual(out2.code, 'TOO_MANY');
                    done();
                });
        });
});

test('simulate 와 security 의 판정이 같다 — 사본이 아니라는 회귀', function (t, done) {
    const rows = [acpRow('/Mobius/acp1', 'Cteam')];
    const req = { headers: { 'x-m2m-origin': 'Cother' }, connection: { remoteAddress: '127.0.0.1' },
                  url: '/Mobius/c1' };
    const direct = security._evaluate_acp_rows(rows, req, 'Cowner', '4', 'pv', true, true);

    const h = tap(target(cnt('c1', ['/Mobius/acp1'], 'Cowner')).concat([rows]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cother', op: 'UPDATE' }, function (err, r) {
        assert.ok(!err);
        assert.strictEqual(r.code, direct.code);
        assert.strictEqual(r.decided_by, direct.trace.decided_by);
        done();
    });
});
