'use strict';
// 시뮬레이터 — "이 원본이 이 리소스에 이 연산을 하면 어떻게 되나".
//
// 콘솔은 별도 프로세스이고 쓰기 origin 이 수퍼유저라, HTTP 로 왕복해도 정책을
// 원리적으로 검증할 수 없다. 그래서 판정만 돌려준다.
//
// **security.js 의 판정 함수를 그대로 쓴다.** 두 번째 사본을 만들면 언젠가
// 갈라지고, 그러면 "미리 본 결과" 를 믿을 수 없다 — 마지막 테스트가 그걸 못박는다.

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

// 질의 **내용**을 보고 답하는 어댑터. 원본마다 질의 수가 다를 때
// (생성자·수퍼유저는 acpi 를 풀기 전에 끝난다) 고정 배열로는 줄이 안 맞는다.
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
    db.connect('h', 1, 'u', 'p', function () {});
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
    db.connect('h', 1, 'u', 'p', function () {});
    return { sim: require(path.join(__dirname, '..', 'mobius', 'acp_simulate.js')), seen: seen };
}

const cnt = (rn, acpi, cr) => ({ ri: '/Mobius/' + rn, ty: 3, pi: '/Mobius', rn: rn,
                                 acpi: JSON.stringify(acpi || []), cr: cr || 'Cowner' });
const acpRow = (ri, who) => ({ ri: ri, pv: JSON.stringify({ acr: [{ acor: [who], acop: 63 }] }),
                                        pvs: JSON.stringify({ acr: [{ acor: ['Sponde'], acop: 63 }] }) });

// select_resource_from_url 은 질의 두 번이다(lookup + 타입 테이블).
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
        // acp 쪽 질의가 아예 안 나가야 한다.
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
    // 실제 판정 경로는 make_internal_ri 로 접고 get_ri_list_sri 로 sri 를 푼다.
    // 그 단계를 건너뛰면 절대·SP상대 표기로 저장된 정상 참조가 전부
    // dangling 으로 보여, 콘솔 첫 화면이 "이 ACP 가 없다" 고 거짓말을 한다.
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

test('sri 로 저장된 참조는 풀어서 본다', function (t, done) {
    // 질의 3: resolve_acpi_entries, 질의 4: select_acp_in
    const h = tap(target(cnt('c1', ['acp1short'], 'Cowner'))
        .concat([[{ ri: '/Mobius/acp1', sri: 'acp1short' }],
                 [acpRow('/Mobius/acp1', 'Cteam')]]));
    h.sim.simulate(null, { ri: '/Mobius/c1', origin: 'Cteam', op: 'RETRIEVE' }, function (err, r) {
        assert.ok(!err, JSON.stringify(r));
        assert.strictEqual(r.allowed, true);
        assert.deepStrictEqual(r.warnings, []);
        assert.strictEqual(r.resolved[0].given, 'acp1short');
        assert.strictEqual(r.resolved[0].ri, '/Mobius/acp1');
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
    // ty=3 이고 acpi 가 비면 조상 탐색(select_acp_cnt)이 돈다 -> 빈 결과
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
    // 예전에는 빈 배열도 override 갈래로 가서 select_acp_in 에 빈 목록을
    // 넘겼고, 행이 없으니 no_acp_row(생성자만 통과)로 답했다. 실제로는 기본
    // 정책이라 전원에게 열리는데 미리보기는 "다 잠긴다" 고 했다 —
    // **안전한 쪽이 아니라 위험한 쪽으로** 틀렸다.
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
    // select_acp_cnt 가 조상의 acpi 를 돌려주는 경우. 자기 것만 뗀 것이지
    // 조상 것까지 뗀 것이 아니다.
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
    // sub 생성은 CREATE+RETRIEVE 라 '3' 이다.
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
    // 수퍼유저·생성자는 acpi 를 풀기 전에 단축 판정된다. 그 결과를 최상위
    // source/acpi 로 쓰면 **생성자를 첫 칸에 적었다는 이유만으로** 출처가
    // 'none' 이 되고 상속 경고가 통째로 사라진다. 관리자가 자기 장치 ID 를
    // 먼저 적는 것은 아주 자연스러운 순서다.
    const target_row = cnt('c1', ['/Mobius/acp1'], 'Cdevice');
    function run(origins, cb) {
        // 원본마다 질의 수가 다르므로(생성자는 acpi 를 안 푼다) SQL 을 보고 답한다.
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
    // 'none'(= ACP 가 없다) 으로 적으면 거짓이 된다.
    const h = tap(target(cnt('c1', ['/Mobius/acp1'], 'Cowner')));
    h.sim.simulate_many(null, { ri: '/Mobius/c1', origins: ['Cowner'], ops: ['RETRIEVE'] },
        function (err, r) {
            assert.ok(!err, JSON.stringify(r));
            assert.strictEqual(r.source, null);
            assert.strictEqual(r.acpi, null);
            assert.ok(r.warnings.some((w) => w.rule === 'source_unknown'));
            // 리소스 자체를 말하는 값은 그대로 있어야 한다.
            assert.strictEqual(r.cr, 'Cowner');
            assert.strictEqual(String(r.ty), '3');
            done();
        });
});

test('조합이 너무 많으면 거부한다 — 조용히 자르지 않는다', function (t, done) {
    // 잘라내면 화면이 물어본 것보다 적은 결과를 보여 주면서 그 사실을 말하지
    // 않는다. 권한 판정에서 가장 나쁜 실패다.
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
