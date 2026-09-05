'use strict';
/**
 * 구독 nu 의 ID 형 항목 해석 — 옛 get_nu_arr(nu 마다 질의 2, 순차 재귀)를 질의 3번
 * (sri 풀기 · lookup · 타입 테이블)으로. 판정과 로그 문구는 옛것 그대로다.
 * 남은 일 §5.6-1 · 스펙 docs/superpowers/specs/2026-09-05-notification-routing-source-design.md §3.2
 *
 * 배포에는 ID 형 nu 가 0 이라 오늘 실익은 없다. 구조적 정확성(구독당 2M 왕복을
 * 3 으로)과 "못 푼 nu 는 빼고 이어 간다" 의 규칙을 시험으로 고정하는 것이 목적이다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.usespid = '//sp.test';
global.usecseid = '/Mobius';
global.usecsebase = 'Mobius';

const db_sql = require('../mobius/sql_action');
const nu_resolve = require('../mobius/nu_resolve');

function stub(lookupRows, opts) {
    opts = opts || {};
    const s = { sri_calls: [], res_calls: [] };
    db_sql.get_ri_sri_in = (c, list, cb) => { s.sri_calls.push(list.slice()); setImmediate(() => cb(opts.sriErr || null, opts.sriErr ? { message: 'x' } : (opts.sriRows || []))); };
    db_sql.select_resources_in = (c, ris, sris, cb) => { s.res_calls.push([ris.slice(), sris.slice()]); setImmediate(() => cb(opts.resErr || null, opts.resErr ? { message: 'y' } : lookupRows)); };
    return s;
}
function run(nu_arr, sub_ri) { return new Promise((r) => nu_resolve.resolve({}, nu_arr, sub_ri || '/M/s1', r)); }
function quiet(fn) {
    const e = console.error, lines = [];
    console.error = (m) => lines.push(String(m));
    return Promise.resolve().then(fn).then((v) => { console.error = e; return { v, lines }; }, (x) => { console.error = e; throw x; });
}

test('전부 URL 이면 질의 없이 그대로', async () => {
    const s = stub([]);
    const out = await run(['mqtt://b/t', 'http://h/p']);
    assert.deepStrictEqual(out, ['mqtt://b/t', 'http://h/p']);
    assert.strictEqual(s.sri_calls.length + s.res_calls.length, 0);
});

test('ID 형은 한 번에 풀린다 — 질의 1+1, 순서 보존, poa 가 여럿이면 여럿으로, 끝 / 는 뗀다', async () => {
    const s = stub([{ ri: '/Mobius/ae1', sri: 'Cae1', ty: '2', poa: '["http://a:1/n/","http://b:2"]' }]);
    const out = await run(['mqtt://first', 'Cae1', 'http://last']);
    assert.deepStrictEqual(out, ['mqtt://first', 'http://a:1/n', 'http://b:2', 'http://last']);
    assert.deepStrictEqual(s.sri_calls, [['Cae1']]);
    assert.deepStrictEqual(s.res_calls, [[['/Cae1'], ['Cae1']]]);
});

test('sri 가 풀리면 그 ri 로 lookup 을 묻는다 (옛 replace 규칙 — 쿼리는 버려진다)', async () => {
    const s = stub([{ ri: '/Mobius/ae1', sri: 'Cae1', ty: '2', poa: '["http://a"]' }], { sriRows: [{ sri: 'Cae1', ri: '/Mobius/ae1' }] });
    const out = await run(['Cae1?rcn=9']);
    assert.deepStrictEqual(out, ['http://a']);
    assert.deepStrictEqual(s.res_calls, [[['/Mobius/ae1'], ['Cae1']]]);
});

test('프로토콜 없는 poa 는 localhost 로, sp/cse 상대 표기는 접힌다', async () => {
    stub([{ ri: '/Mobius/ae1', sri: 'Cae1', ty: '2', poa: '["Mobius/ae1"]' }]);
    const out = await run(['//sp.test/Mobius/Cae1', '/Mobius/Cae1']);
    assert.deepStrictEqual(out, ['http://localhost:7579/Cae1', 'http://localhost:7579/Cae1']);
});

test('받을 리소스가 없으면 그 nu 만 빠지고 옛 문구가 남는다', async () => {
    stub([]);
    const { v, lines } = await quiet(() => run(['Cnone', 'mqtt://ok'], '/M/s9'));
    assert.deepStrictEqual(v, ['mqtt://ok']);
    assert.ok(lines.some((l) => l === '[noti] fail - sub=/M/s9 nu=Cnone (받을 리소스가 없다: /Cnone)'), lines.join('\n'));
});

test('poa 가 비면 빠진다', async () => {
    stub([{ ri: '/Mobius/ae1', sri: 'Cae1', ty: '2', poa: '[]' }]);
    const { v, lines } = await quiet(() => run(['Cae1']));
    assert.deepStrictEqual(v, []);
    assert.ok(lines.some((l) => /받을 리소스에 poa 가 없다: \/Cae1/.test(l)), lines.join('\n'));
});

test('ri 매치가 sri 매치보다 먼저다 (옛 코드에서 미정의였던 순서를 고정)', async () => {
    stub([{ ri: '/other', sri: 'Cae1', ty: '2', poa: '["http://by-sri"]' }, { ri: '/Cae1', sri: 'zzz', ty: '2', poa: '["http://by-ri"]' }]);
    assert.deepStrictEqual(await run(['Cae1']), ['http://by-ri']);
});

test('DB 오류면 ID 항목은 전부 빠지고 URL 항목은 남는다', async () => {
    stub([], { sriErr: new Error('x') });
    const a = await quiet(() => run(['Cae1', 'mqtt://ok', 'Cae2']));
    assert.deepStrictEqual(a.v, ['mqtt://ok']);
    assert.strictEqual(a.lines.filter((l) => /nu 해석 중 DB 오류/.test(l)).length, 2);
    stub([], { resErr: new Error('y') });
    const b = await quiet(() => run(['Cae1', 'mqtt://ok']));
    assert.deepStrictEqual(b.v, ['mqtt://ok']);
    assert.ok(b.lines.some((l) => /받을 리소스 조회 중 DB 오류/.test(l)));
});

test('sgn.js 는 옛 get_nu_arr 이 없고 nu_resolve 를 쓴다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.strictEqual(src.indexOf('function get_nu_arr'), -1, '직렬 재귀가 되살아났다');
    assert.strictEqual(src.indexOf('get_ri_sri('), -1, 'nu 별 조회가 되살아났다');
    assert.strictEqual(src.indexOf('select_resource_from_url('), -1, 'nu 별 조회가 되살아났다');
    assert.match(src, /nu_resolve\.resolve\(connection, nu_arr, results_ss\.ri, function \(resolved\)/);
});
