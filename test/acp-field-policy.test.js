/**
 * 남은 일 §5.4 — pv/pvs 정책이 한 곳(security.js)에만 있다.
 *
 * 평가 루프(evaluate_acp_rows)는 이미 하나였다. 남아 있던 것은 (1) 인자 순서가 서로 다른
 * 래퍼 둘(security_check_action_pv/pvs), (2) 시뮬레이터(acp_simulate.js)가 ty 로부터
 * 필드·use_ra·cr_fallback·상속 타입을 **자기가 다시 계산하던 사본**이다. 그 사본은 실제로
 * 갈라져 있었다 — security.js 에서 없는 타입 '33' 을 뺀 뒤에도 시뮬레이터의 INHERITS 에는
 * 남아 있었다(CLAUDE.md "코어의 정책을 베껴 적지 않는다" 가 경고한 바로 그 형태).
 *
 * 이제 security.js 가 표(FIELD · INHERITS_ACPI)와 field_of 를 내보내고, check() 와
 * 시뮬레이터가 그것만 본다. 아래 check() 케이스들은 고치기 **전** 동작을 그대로 적은
 * 특성화다 — 이 항목은 판정을 한 건도 바꾸지 않는다.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius';
global.usespid = '//mobius.test';
global.uservi = '2a';
global.usesuperuser = 'Ssuper';
global.useaccesscontrolpolicy = 'disable';

const security = require('../mobius/security');
const db_sql = require('../mobius/sql_action');

function live(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

// ── 정책 표 ──────────────────────────────────────────────────────────────

test('FIELD — pv 는 remoteaddress 를 보고 acr 없는 규칙에서 생성자로 끝내며, pvs 는 둘 다 아니다', () => {
    // 옛 래퍼 둘의 리터럴 그대로다. 값을 바꾸면 판정이 바뀐다 — 그건 별건이다.
    assert.deepStrictEqual(security.FIELD, {
        pv: { use_ra: true, cr_fallback: true },
        pvs: { use_ra: false, cr_fallback: false }
    });
    assert.ok(Object.isFrozen(security.FIELD) && Object.isFrozen(security.FIELD.pv) && Object.isFrozen(security.FIELD.pvs));
});

test('field_of — ACP 자신(ty 1)만 pvs, 나머지는 pv', () => {
    assert.strictEqual(security.field_of('1'), 'pvs');
    assert.strictEqual(security.field_of(1), 'pvs');
    ['2', '3', '4', '9', '23', '28', undefined].forEach((ty) => assert.strictEqual(security.field_of(ty), 'pv', String(ty)));
});

test('INHERITS_ACPI — 빈 acpi 면 조상으로 올라가는 타입은 cnt·cin·sub 셋이고, 없는 타입 33 은 없다', () => {
    assert.deepStrictEqual(Object.keys(security.INHERITS_ACPI).sort(), ['23', '3', '4']);
    assert.ok(Object.isFrozen(security.INHERITS_ACPI));
    assert.strictEqual(security.INHERITS_ACPI['33'], undefined);
});

// ── 사본 금지 ─────────────────────────────────────────────────────────────

test('security.js 에 pv/pvs 래퍼가 없고 check() 는 표를 본다', () => {
    const src = live('mobius/security.js');
    assert.strictEqual(src.indexOf('security_check_action_pv'), -1, '래퍼가 되살아났다');
    assert.strictEqual(src.indexOf("ty == '23' || ty == '4' || ty == '3'"), -1, '상속 타입 조건식이 표 밖에 남아 있다');
    assert.match(src, /INHERITS_ACPI\[/, 'check() 가 INHERITS_ACPI 를 본다');
    assert.match(src, /FIELD\[field\]/, 'security_check_action 이 표에서 use_ra·cr_fallback 을 꺼낸다');
});

test('시뮬레이터는 자기 정책을 갖지 않는다 — field·use_ra·cr_fallback·상속 타입 전부 security 것', () => {
    const src = live('mobius/acp_simulate.js');
    assert.strictEqual(src.indexOf("? 'pvs'"), -1, '필드를 ty 로 직접 정한다');
    assert.strictEqual(src.indexOf("ty !== '1'"), -1, 'use_ra/cr_fallback 을 ty 로 직접 정한다');
    assert.doesNotMatch(src, /var INHERITS\s*=/, '상속 타입 사본이 있다');
    assert.match(src, /security\.field_of\(/);
    assert.match(src, /security\.FIELD\[/);
    assert.match(src, /security\.INHERITS_ACPI\[/);
});

test('mobius/acp_eval.js 는 없고, 평가기 정의는 security.js 에만 있다', () => {
    // 한때 판정을 그 파일로 추출했다가 대체·삭제됐고, 2차 병합에서 되살아나 ACP 시험
    // 3벌이 죽었다. 통합은 security.js 안에서 한다.
    assert.ok(!fs.existsSync(path.join(ROOT, 'mobius', 'acp_eval.js')), 'mobius/acp_eval.js 가 되살아났다');
    const defs = [];
    fs.readdirSync(path.join(ROOT, 'mobius')).filter((f) => /\.js$/.test(f)).forEach((f) => {
        const src = live('mobius/' + f);
        if (/function (evaluate_acp_rows|evaluate_acr|evaluate_acr_traced)\(/.test(src)) { defs.push(f); }
    });
    assert.deepStrictEqual(defs, ['security.js']);
});

// ── check() 끝단 특성화 — DB 를 스텁으로 ───────────────────────────────────

const RULE = (who, extra) => JSON.stringify({ acr: [Object.assign({ acor: [who], acop: 63 }, extra || {})] });
const ROWS = {
    '/Mobius/acp1': { ri: '/Mobius/acp1', pv: RULE('Reader'), pvs: RULE('Admin') },
    '/M/a1':        { ri: '/M/a1',        pv: RULE('Reader'), pvs: RULE('Admin') },
    '/M/noacr':     { ri: '/M/noacr',     pv: '{}',           pvs: '{}' },
    '/M/ip':        { ri: '/M/ip', pv: RULE('Reader', { acco: [{ acip: { ipv4: ['10.0.0.5'] } }] }),
                                   pvs: RULE('Reader', { acco: [{ acip: { ipv4: ['10.0.0.5'] } }] }) }
};
const calls = { acp_in: [], acp_cnt: [] };
db_sql.select_acp_in = function (conn, list, cb) { calls.acp_in.push(list.slice()); setImmediate(() => cb(null, list.filter((r) => ROWS[r]).map((r) => ROWS[r]))); };
db_sql.select_acp_cnt = function (conn, loop, uri_arr, cb) { calls.acp_cnt.push(uri_arr.slice()); setImmediate(() => (uri_arr.indexOf('inh') >= 0 ? cb(null, ['/M/a1'], '/Mobius/inh') : cb(null, [], null))); };
global.get_ri_list_sri = function (request, response, list, out, count, cb) { list.forEach((v, i) => { out[i] = v; }); cb('200'); };
global.make_internal_ri = function () { /* 시험 입력은 이미 내부형이다 */ };

function req(from, url, opts) {
    opts = opts || {};
    return { headers: Object.assign({ 'x-m2m-origin': from }, opts.headers || {}), url: url || '/Mobius/ae1/c1',
             connection: { remoteAddress: opts.addr || '127.0.0.1' }, db_connection: {} };
}
function check(ty, acpi, access, cr, r) {
    return new Promise((resolve) => security.check(r, {}, ty, acpi, access, cr, (code, trace) => resolve({ code, trace })));
}
function quiet(fn) {
    const e = console.error, l = console.log; console.error = () => {}; console.log = () => {};
    return Promise.resolve().then(fn).finally(() => { console.error = e; console.log = l; });
}

test('수퍼유저와 생성자는 ACP 를 보지 않는다', async () => {
    const s = await check('3', ['/M/a1'], '8', 'Cowner', req('Ssuper'));
    assert.deepStrictEqual([s.code, s.trace.decided_by], ['1', 'superuser']);
    const c = await check('3', ['/M/a1'], '8', 'Cowner', req('Cowner'));
    assert.deepStrictEqual([c.code, c.trace.decided_by], ['1', 'creator']);
    const a = await check('1', [], '8', 'Cowner', req('Cowner', '/Mobius/acp1'));
    assert.notStrictEqual(a.trace.decided_by, 'creator', 'ACP 자신(ty 1)에는 생성자 우회가 없다');
});

test('ty 1 에 acpi 가 없으면 요청 경로의 ACP 자신의 pvs 로 본다', async () => {
    calls.acp_in.length = 0;
    const r = await check('1', [], '4', 'Cowner', req('Admin', '/Mobius/acp1?rcn=1'));
    assert.deepStrictEqual([r.code, r.trace.decided_by, r.trace.field, r.trace.path, r.trace.self, r.trace.acp_ri],
                           ['1', 'acr', 'pvs', 'pvs', true, '/Mobius/acp1']);
    assert.deepStrictEqual(calls.acp_in, [['/Mobius/acp1']]);
});

test('pvs 는 acr 없는 규칙을 건너뛰고 다음 ACP 로 간다', async () => {
    const r = await check('1', ['/M/noacr', '/M/a1'], '4', 'Cowner', req('Admin', '/Mobius/x'));
    assert.deepStrictEqual([r.code, r.trace.decided_by, r.trace.acp_ri, r.trace.self], ['1', 'acr', '/M/a1', false]);
    assert.deepStrictEqual(r.trace.evaluated[0], { ri: '/M/noacr', skipped: true, reason: 'no_acr', rules: [] });
});

test('pv 는 acr 없는 규칙에서 생성자와 비교하고 즉시 끝낸다 — 뒤 ACP 가 허용해도 보지 않는다', async () => {
    const r = await check('3', ['/M/noacr', '/M/a1'], '2', 'Cowner', req('Reader'));
    assert.deepStrictEqual([r.code, r.trace.decided_by, r.trace.source, r.trace.stopped_early, r.trace.not_evaluated],
                           ['0', 'no_acr_cr', 'own', true, ['/M/a1']]);
});

test('cnt·cin·sub 는 acpi 가 비면 조상의 acpi 로 판정하고 그 사실을 남긴다', async () => {
    calls.acp_cnt.length = 0;
    const r = await check('3', [], '2', 'Cowner', req('Reader', '/Mobius/inh/c1'));
    assert.deepStrictEqual([r.code, r.trace.decided_by, r.trace.source, r.trace.inherited_from], ['1', 'acr', 'inherited', '/Mobius/inh']);
    assert.strictEqual(calls.acp_cnt.length, 1);
    const none = await check('4', [], '2', 'Cowner', req('Nobody', '/Mobius/plain/c1/cin1'));
    assert.deepStrictEqual([none.code, none.trace.decided_by, none.trace.policy], ['1', 'default_policy', 'disable']);
});

test('그 밖의 타입은 acpi 가 비면 조상을 찾지 않고 곧장 기본 정책이다', async () => {
    calls.acp_cnt.length = 0;
    const ok = await check('9', [], '2', 'Cowner', req('Nobody'));
    const no = await check('2', [], '8', 'Cowner', req('Nobody'));
    assert.deepStrictEqual([ok.code, ok.trace.decided_by, no.code], ['1', 'default_policy', '0']);
    assert.strictEqual(calls.acp_cnt.length, 0, '조상 탐색 질의가 나가면 안 된다');
    global.useaccesscontrolpolicy = 'enable';
    try { assert.strictEqual((await check('2', [], '2', 'Cowner', req('Nobody'))).code, '0'); }
    finally { global.useaccesscontrolpolicy = 'disable'; }
});

test('remoteaddress 헤더는 pv 만 본다 — 같은 acip 규칙이 pvs 에서는 소켓 주소로 판정된다', async () => {
    const o = { addr: '::ffff:1.1.1.1', headers: { remoteaddress: '10.0.0.5' } };
    const pv = await check('3', ['/M/ip'], '2', 'Cowner', req('Reader', '/Mobius/x', o));
    const pvs = await check('1', ['/M/ip'], '2', 'Cowner', req('Reader', '/Mobius/x', o));
    assert.strictEqual(pv.code, '1', 'pv: 헤더의 10.0.0.5 가 맞아 허용');
    assert.strictEqual(pvs.code, '0', 'pvs: 소켓 1.1.1.1 이라 거부');
    assert.deepStrictEqual(pvs.trace.evaluated[0].rules[0].acco_ok, false);
});

test('acop 없는 규칙은 500-1 — 예전부터 그랬고 고치지 않는다', async () => {
    ROWS['/M/bad'] = { ri: '/M/bad', pv: JSON.stringify({ acr: [{ acor: ['Reader'] }] }), pvs: '{}' };
    const r = await quiet(() => check('3', ['/M/bad'], '2', 'Cowner', req('Reader')));
    assert.deepStrictEqual([r.code, r.trace.decided_by], ['500-1', 'eval_error']);
});
