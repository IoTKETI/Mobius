'use strict';
// Runs the core queries on real MySQL and checks index use with EXPLAIN.
//
// Stub tests only inspect statement shapes. Here a tree is planted in an empty test DB with the builders (CSEBase -> AE -> four containers x 400 CINs + 3-level nested containers + subscription + ACP), the request-path queries are executed as-is, and the recorded statements are EXPLAINed.
//
// The tables are small (thousands of rows). Effects that only appear at scale (plans flipping with statistics, timing) are covered by the deployment procedure's read-only EXPLAIN on the production DB.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const lane = require('./_lane');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius'; global.usecseid = '/Mobius2'; global.usespid = '//lane.test'; global.uservi = '2a';
global.max_lim = 2000;

const short_ri = require(path.join(lane.ROOT, 'mobius', 'short_ri'));
const NOW = '20260906T120000';
let f = null, sql = null, tap = null;
const p = (fn) => new Promise((res, rej) => fn((e, r) => (e ? rej(r instanceof Error ? r : new Error(JSON.stringify(r))) : res(r))));
const run = (qb) => p((cb) => f.db.run(qb, f.conn, cb));
const raw = (s, a) => run(f.db.raw(s, a || []));

function base(ri, ty, extra) {
    const pi = ri.replace(/\/[^/]+$/, '');
    return Object.assign({ ri, pi, ty: String(ty), rn: ri.split('/').pop(), ct: NOW, lt: NOW, et: '99991231T235959', st: 0,
        acpi: [], lbl: [], at: [], aa: [], sri: short_ri.generate(ty + '-'), spi: '', cr: 'Cowner', or: '' }, extra || {});
}
const CNT = { cbs: 0, cni: 0, disr: '', li: '', mbs: 3153600000, mia: 0, mni: 3153600000 };

async function seed() {
    await p((cb) => sql.insert_cb(f.conn, base('/Mobius', 5, { pi: '', csi: '/Mobius2', cst: '1', ncp: '', nl: '', poa: [], pv: {}, pvs: {}, srt: '', srv: [] }), cb));
    await p((cb) => sql.insert_ae(f.conn, base('/Mobius/ae1', 2, { aei: 'Slane1', api: 'Nlane', apn: '', csz: '', nl: '', poa: [], rr: false, srv: [] }), cb));
    await p((cb) => sql.insert_acp(f.conn, base('/Mobius/acp1', 1, { pv: { acr: [{ acor: ['Reader'], acop: 63 }] }, pvs: { acr: [{ acor: ['Admin'], acop: 63 }] } }), cb));
    for (const c of ['c1', 'c2', 'c3', 'c4']) {
        await p((cb) => sql.insert_cnt(f.conn, base('/Mobius/ae1/' + c, 3, Object.assign({}, CNT, c === 'c1' ? { acpi: ['/Mobius/acp1'] } : {})), cb));
        for (let i = 0; i < 400; i++) {
            const ct = '20260906T' + String(100000 + i).slice(1);
            await p((cb) => sql.insert_cin(f.conn, base('/Mobius/ae1/' + c + '/i' + i, 4, { ct, lt: ct, cnf: 'text/plain:0', con: 'v' + i, cs: 2 }), cb));
        }
    }
    await p((cb) => sql.insert_cnt(f.conn, base('/Mobius/ae1/c1/d1', 3, CNT), cb));
    await p((cb) => sql.insert_cnt(f.conn, base('/Mobius/ae1/c1/d1/e1', 3, CNT), cb));
    for (let i = 0; i < 50; i++) {
        await p((cb) => sql.insert_cin(f.conn, base('/Mobius/ae1/c1/d1/e1/j' + i, 4, { cnf: 'text/plain:0', con: 'w', cs: 1 }), cb));
    }
    await p((cb) => sql.insert_sub(f.conn, base('/Mobius/ae1/c1/s1', 23, { nu: ['http://127.0.0.1:1/x'], enc: { net: [3] }, nct: 2, exc: '', gpi: '', ln: false, nec: '', nfu: '', nsp: '', pn: '', psn: '', rl: '', su: '', bn: '' }), cb));
    await raw('analyze table lookup, cin, cnt, sub, acp');
}

test.before(async () => {
    await lane.fresh();
    f = await lane.facade();
    tap = lane.recordingTap();
    sql = require(path.join(lane.ROOT, 'mobius', 'sql_action'));
    await seed();
});
test.after(async () => { if (tap) { tap.restore(); } if (f) { await f.close(); } });

// EXPLAINs the last recorded statement matching re.
const notExplain = (s) => !/^\s*explain\b/i.test(s.sql);   // our own EXPLAINs are not re-examined
async function explainLast(re) {
    const hit = tap.seen.filter(notExplain).reverse().find((s) => re.test(s.sql));
    assert.ok(hit, '기록된 문장 중 ' + re + ' 에 맞는 것이 없다');
    const rows = await raw('explain ' + hit.sql, hit.bindings);
    return { sql: hit.sql, plan: rows.map((r) => ({ table: r.table, type: r.type, key: r.key, extra: r.Extra || '' })) };
}
function noFullScan(plan, tables) {
    const bad = plan.filter((r) => tables.indexOf(String(r.table)) >= 0 && r.type === 'ALL');
    assert.deepStrictEqual(bad, [], '풀스캔이 있다');
}

test('씨앗 — lookup 1,660행, 컨테이너 여섯, CIN 1,650', async () => {
    const n = await raw('select ty, count(*) n from lookup group by ty order by ty');
    const by = {}; n.forEach((r) => { by[r.ty] = r.n; });
    assert.deepStrictEqual(by, { 1: 1, 2: 1, 3: 6, 4: 1650, 5: 1, 23: 1 });
});

test('구조 주소 조회 — ri_UNIQUE 로 const', async () => {
    tap.seen.length = 0;
    const rows = await p((cb) => sql.select_resource_from_url(f.conn, '/Mobius/ae1/c1', null, cb));
    assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].ty, 3);
    const e = await explainLast(/from `lookup` where `ri` = \?/);
    assert.deepStrictEqual([e.plan[0].type, e.plan[0].key], ['const', 'ri_UNIQUE'], JSON.stringify(e));
});

test('비구조 주소(sri) 조회 — idx_lookup_sri_unique', async () => {
    const c1 = (await raw('select sri from lookup where ri = ?', ['/Mobius/ae1/c1']))[0].sri;
    tap.seen.length = 0;
    const rows = await p((cb) => sql.select_resource_from_url(f.conn, null, c1, cb));
    assert.strictEqual(rows[0].ri, '/Mobius/ae1/c1');
    const e = await explainLast(/from `lookup` where `sri` = \?/);
    assert.strictEqual(e.plan[0].key, 'idx_lookup_sri_unique', JSON.stringify(e));
});

test('la / ol — (pi, ty, ct) 인덱스, 풀스캔 없음', async () => {
    const parent = (await raw('select * from lookup where ri = ?', ['/Mobius/ae1/c2']))[0];
    tap.seen.length = 0;
    const latest = []; await p((cb) => sql.select_latest_resource(f.conn, parent, 0, latest, (code) => cb(code === '200' ? null : code, latest)));
    assert.strictEqual(latest[0].rn, 'i399');
    const e = await explainLast(/from `lookup`.*order by/i);
    noFullScan(e.plan, ['lookup']);
    const lk = e.plan.find((r) => r.table === 'lookup');
    assert.ok(lk && /idx_lookup_pi_ty_ct/.test(String(lk.key)), '(pi, ty, ct) 인덱스를 안 탄다: ' + JSON.stringify(e));
    const oldest = []; await p((cb) => sql.select_oldest_resource(f.conn, 4, '/Mobius/ae1/c2', oldest, (code) => cb(code === '200' ? null : code, oldest)));
    assert.strictEqual(oldest[0].rn, 'i0');
});

// EXPLAINs every lookup query the search left behind; none may full-scan lookup.
async function explainAllLookup() {
    const out = [];
    for (const s of tap.seen.filter(notExplain).filter((x) => /from `lookup`|join lookup|from lookup/i.test(x.sql))) {
        const rows = await raw('explain ' + s.sql, s.bindings);
        out.push({ sql: s.sql.slice(0, 160), plan: rows.map((r) => ({ table: r.table, type: r.type, key: r.key })) });
    }
    return out;
}

test('discovery 골격(재귀 CTE) — AE 아래 컨테이너 여섯, 재귀항이 (pi, not_cin) 을 타고 풀스캔이 없다', async () => {
    // With the CSEBase as target no skeleton is built (nothing to restrict). The query targets the AE.
    tap.seen.length = 0;
    const found = {};
    await p((cb) => sql.search_lookup(f.conn, '/Mobius/ae1', { fu: '1', ty: '3', lim: 2000 }, 2000, ['/Mobius/ae1'], 0, found, 0, '0', '2026-01-02 00:00:00', 0,
        (code) => cb(code === '200' ? null : code, found)));
    assert.strictEqual(Object.keys(found).length, 6, '컨테이너 여섯이어야 한다: ' + Object.keys(found).join(','));
    const e = await explainLast(/with recursive skel/i);
    noFullScan(e.plan, ['lookup', 'l', 'r']);
    const recur = e.plan.find((r) => r.table === 'l');
    assert.ok(recur && /idx_lookup_pi_notcin/.test(String(recur.key)), '재귀항이 (pi, not_cin) 을 안 탄다: ' + JSON.stringify(e.plan));
    const all = await explainAllLookup();
    all.forEach((x) => noFullScan(x.plan, ['lookup', 'l', 'r']));
});

test('discovery 자식 질의(ty=4 + 시간 필터, 100건) — lookup 풀스캔 없음, (pi, ty, ct) 사용', async () => {
    tap.seen.length = 0;
    const found = {};
    await p((cb) => sql.search_lookup(f.conn, '/Mobius/ae1/c3', { fu: '1', ty: '4', cra: '20260906T000100', lim: 100 }, 100, ['/Mobius/ae1/c3'], 0, found, 0, '0', '2026-01-02 00:00:00', 0,
        (code) => cb(code === '200' ? null : code, found)));
    assert.strictEqual(Object.keys(found).length, 100);
    const all = await explainAllLookup();
    assert.ok(all.length > 0, 'lookup 질의가 기록되지 않았다');
    all.forEach((x) => noFullScan(x.plan, ['lookup', 'l', 'r']));
    assert.ok(all.some((x) => x.plan.some((r) => /idx_lookup_pi_ty_ct/.test(String(r.key)))), '(pi, ty, ct) 를 쓰는 질의가 없다: ' + JSON.stringify(all));
});

test('구독 조회 — idx_sub_pi', async () => {
    tap.seen.length = 0;
    const subs = await p((cb) => sql.select_subs_by_pi(f.conn, '/Mobius/ae1/c1', cb));
    assert.strictEqual(subs.length, 1);
    const e = await explainLast(/from `sub` where `pi` = \?/);
    assert.strictEqual(e.plan[0].key, 'idx_sub_pi', JSON.stringify(e));
});

test('ACP 조회 둘 — 부모 재귀(select_acp_cnt)와 IN(select_acp_in)', async () => {
    // Real call shape: the request URL split on '/', loop from 0 over parent -> grandparent ... up to the AE.
    const list = await p((cb) => sql.select_acp_cnt(f.conn, 0, '/Mobius/ae1/c1/d1/e1/j0'.split('/'), (err, acpi, from) => cb(err, { acpi, from })));
    assert.deepStrictEqual(list.acpi, ['/Mobius/acp1'], 'c1 의 acpi 를 자손이 물려받아야 한다');
    assert.strictEqual(list.from, '/Mobius/ae1/c1');
    tap.seen.length = 0;
    const rows = await p((cb) => sql.select_acp_in(f.conn, ['/Mobius/acp1'], cb));
    assert.strictEqual(rows.length, 1); assert.match(String(rows[0].pv), /Reader/);
    const e = await explainLast(/from `acp` where `ri` in/);
    noFullScan(e.plan, ['acp']);
});

test('워커 카운터 — 상대 증분이 실제로 더해지고 빼진다', async () => {
    const before = (await raw('select cni, cbs from cnt where ri = ?', ['/Mobius/ae1/c4']))[0];
    await p((cb) => sql.update_parent_counters(f.conn, '/Mobius/ae1/c4', 7, cb));
    const mid = (await raw('select cni, cbs from cnt where ri = ?', ['/Mobius/ae1/c4']))[0];
    assert.deepStrictEqual([mid.cni - before.cni, mid.cbs - before.cbs], [1, 7]);
    await p((cb) => sql.update_parent_by_delete(f.conn, { ri: '/Mobius/ae1/c4', ty: '3' }, 7, cb));
    const after = (await raw('select cni, cbs from cnt where ri = ?', ['/Mobius/ae1/c4']))[0];
    assert.deepStrictEqual([after.cni, after.cbs], [before.cni, before.cbs]);
});

test('카운터 정합(마스터 작업) — 실측으로 cni/cbs 를 맞춘다', async () => {
    await raw('update cnt set cni = 0, cbs = 0 where ri = ?', ['/Mobius/ae1/c2']);
    const quiet = console.log; console.log = () => {};
    try { await p((cb) => sql.reconcile_cnt_counters(f.conn, { limit: 100, budgetMs: 20000, aggTimeoutMs: 10000, maxCni: 1e9, cursor: null }, cb)); }
    finally { console.log = quiet; }
    const c2 = (await raw('select cni, cbs from cnt where ri = ?', ['/Mobius/ae1/c2']))[0];
    assert.deepStrictEqual([c2.cni, c2.cbs], [400, 800]);
});

test('보존 정책 스윕(마스터 작업) — mni 를 넘긴 만큼 오래된 것부터 지운다', async () => {
    await raw('update cnt set mni = 350 where ri = ?', ['/Mobius/ae1/c3']);
    const quiet = console.log; console.log = () => {};
    try { await p((cb) => sql.purge_sweep(f.conn, { limit: 10 }, cb)); }
    finally { console.log = quiet; }
    const left = await raw('select count(*) n, min(rn) oldest from lookup where pi = ? and ty = 4', ['/Mobius/ae1/c3']);
    assert.strictEqual(left[0].n, 350);
    assert.strictEqual((await raw('select count(*) n from lookup where pi = ? and rn = ?', ['/Mobius/ae1/c3', 'i0']))[0].n, 0, '가장 오래된 i0 가 남아 있다');
    const c3 = (await raw('select cni from cnt where ri = ?', ['/Mobius/ae1/c3']))[0];
    assert.strictEqual(c3.cni, 350);
});

test('삭제 — lookup 행을 지우면 본문 표가 FK 로 따라 지워진다', async () => {
    await p((cb) => sql.delete_ri_lookup(f.conn, '/Mobius/ae1/c4/i5', cb));
    assert.strictEqual((await raw('select count(*) n from cin where ri = ?', ['/Mobius/ae1/c4/i5']))[0].n, 0);
    assert.strictEqual((await raw('select count(*) n from lookup where ri = ?', ['/Mobius/ae1/c4/i5']))[0].n, 0);
});

test('id 묶음 조회 — get_ri_sri_in · select_resources_in 이 실제로 돈다', async () => {
    const rows = await raw('select ri, sri from lookup where ty = 3 order by ri limit 3');
    const pairs = await p((cb) => sql.get_ri_sri_in(f.conn, rows.map((r) => r.sri), cb));
    assert.strictEqual(pairs.length, 3);
    const res = await p((cb) => sql.select_resources_in(f.conn, [rows[0].ri], [rows[1].sri], cb));
    assert.ok(res.length >= 2, JSON.stringify(res).slice(0, 200));
});
