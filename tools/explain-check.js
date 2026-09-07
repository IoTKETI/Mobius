'use strict';
// Shows the execution plans of the core queries on the production DB; read-only.
//
//   node tools/explain-check.js [dbName]        default mobiusdb; dbpass from conf.json, localhost root.
//
// The MySQL test lane (npm run test:mysql) checks the same thing on an empty test DB, but with tables of a few thousand rows it cannot see what only appears at scale (plans flipped by statistics). This tool walks the same paths on real data and EXPLAINs them. Nothing is written: one real AE is searched with a small lim (discovery is a read), and the recorded statements are EXPLAINed.
//
// Deployment procedure: run on the server before restarting. A lookup full scan in any plan exits with 1.

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const DB_NAME = process.argv[2] || 'mobiusdb';

global.NOPRINT = 'true';
global.usecsebase = 'Mobius'; global.usecseid = '/Mobius2'; global.usespid = '//explain.check'; global.uservi = '2a';
global.max_lim = 2000;

const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'conf.json'), 'utf8'));
// The CSE name comes from conf; defaults otherwise
if (typeof conf.cseBase === 'string') { global.usecsebase = conf.cseBase; }
if (typeof conf.cseId === 'string') { global.usecseid = conf.cseId; }
if (typeof conf.spId === 'string') { global.usespid = conf.spId; }

global.usedb = 'mysql';
const db = require(path.join(ROOT, 'mobius', 'db'));
conf.dbName = DB_NAME;          // the key the adapter reads; connects to the DB given as argument
db.applyConf(conf);
const adapter = require(path.join(ROOT, 'mobius', 'db', 'mysql.js'));
const seen = [];
const realExec = adapter.execute;
adapter.execute = function (conn, sql, bindings, cb, opts) { seen.push({ sql, bindings }); return realExec.call(adapter, conn, sql, bindings, cb, opts); };

const p = (fn) => new Promise((res, rej) => fn((e, r) => (e ? rej(r instanceof Error ? r : new Error(JSON.stringify(r))) : res(r))));
let conn = null;
const raw = (s, a) => p((cb) => db.run(db.raw(s, a || []), conn, cb));
const problems = [];
function check(label, plan, tables) {
    // A row with type null means 'no matching row (const table)', not a full scan
    const bad = plan.filter((r) => tables.indexOf(String(r.table)) >= 0 && r.type === 'ALL');
    const line = '  ' + label.padEnd(34) + plan.map((r) => r.table + ':' + r.type + '/' + (r.key || '-')).join('  ');
    console.log((bad.length ? 'BAD ' : 'ok  ') + line);
    if (bad.length) { problems.push(label); }
}
async function explainMatching(re, label, tables) {
    const hits = seen.filter((s) => !/^\s*explain/i.test(s.sql) && re.test(s.sql));
    if (!hits.length) {
        console.log('??  ' + label + ' — 기록된 문장이 없다. 기록: ' + seen.filter((s) => !/^\s*explain/i.test(s.sql)).map((s) => s.sql.replace(/\s+/g, ' ').slice(0, 90)).join(' || '));
        problems.push(label + ' (문장 없음)'); return;
    }
    for (const h of hits.slice(-2)) {
        const rows = await raw('explain ' + h.sql, h.bindings);
        check(label, rows.map((r) => ({ table: r.table, type: r.type, key: r.key })), tables);
    }
}

(async () => {
    const t0 = Date.now();
    await p((cb) => db.connect((rsc) => cb(rsc === '1' ? null : new Error('connect ' + rsc))));
    conn = await p((cb) => db.getConnection((code, c) => cb(code === '200' ? null : new Error('getConnection ' + code), c)));
    const which = (await raw('select database() as d'))[0].d;
    console.log('DB ' + which + ' (' + DB_NAME + ')');
    const sql = require(path.join(ROOT, 'mobius', 'sql_action'));

    // Real samples: the AE with the most children, one container below it that has CINs, and one subscription
    const ae = (await raw("select l.ri from lookup l where l.ty = 2 order by (select count(*) from lookup c where c.pi = l.ri) desc limit 1"))[0];
    const cnt = (await raw('select pi from lookup where ty = 4 and pi like ? limit 1', [ae.ri + '/%']))[0];
    const sub = (await raw('select pi from sub limit 1'))[0];
    console.log('표본 AE ' + ae.ri + ' · 컨테이너 ' + (cnt ? cnt.pi : '-') + ' · 구독 부모 ' + (sub ? sub.pi : '-'));

    seen.length = 0;
    await p((cb) => sql.select_resource_from_url(conn, ae.ri, null, cb));
    await explainMatching(/from `lookup` where `ri` = \?/, '구조 주소 (ri)', ['lookup']);

    const sri = (await raw('select sri from lookup where ri = ?', [ae.ri]))[0].sri;
    seen.length = 0;
    await p((cb) => sql.select_resource_from_url(conn, null, sri, cb));
    await explainMatching(/from `lookup` where `sri` = \?/, '비구조 주소 (sri)', ['lookup']);

    if (cnt) {
        const parent = (await raw('select * from lookup where ri = ?', [cnt.pi]))[0];
        seen.length = 0;
        const latest = []; await p((cb) => sql.select_latest_resource(conn, parent, 0, latest, (code) => cb(code === '200' ? null : new Error(code))));
        await explainMatching(/from `lookup`.*order by/i, 'la (최신 CIN)', ['lookup']);

        seen.length = 0;
        const found = {};
        await p((cb) => sql.search_lookup(conn, cnt.pi, { fu: '1', ty: '4', lim: 20 }, 20, [cnt.pi], 0, found, 0, '0', '2026-01-02 00:00:00', 0, (code) => cb(code === '200' ? null : new Error(code))));
        // The children query is a raw statement (with force index): `from lookup r`
        await explainMatching(/from lookup r\b/i, 'discovery 자식 (ty=4, lim 20)', ['lookup', 'r']);
    }

    seen.length = 0;
    const found2 = {};
    await p((cb) => sql.search_lookup(conn, ae.ri, { fu: '1', ty: '3', lim: 50 }, 50, [ae.ri], 0, found2, 0, '0', '2026-01-02 00:00:00', 0, (code) => cb(code === '200' ? null : new Error(code))));
    await explainMatching(/with recursive skel/i, 'discovery 골격 (AE 아래, 재귀 CTE)', ['lookup', 'l', 'r']);
    console.log('  골격 검색 결과 ' + Object.keys(found2).length + '건');

    if (sub) {
        seen.length = 0;
        await p((cb) => sql.select_subs_by_pi(conn, sub.pi, cb));
        await explainMatching(/from `sub` where `pi` = \?/, '구독 조회 (pi)', ['sub']);
    }

    seen.length = 0;
    await p((cb) => sql.select_acp_in(conn, ['/Mobius/none'], cb));
    await explainMatching(/from `acp` where `ri` in/, 'ACP IN 조회', ['acp']);

    console.log((problems.length ? 'FAILED ' + problems.length + '건: ' + problems.join(', ') : 'ALL OK') + ' (' + (Date.now() - t0) + 'ms)');
    try { db.release(conn); } catch (e) { /* */ }
    adapter.end(() => process.exit(problems.length ? 1 : 0));
})().catch((e) => { console.error('ERR ' + (e && e.message)); try { db.release(conn); } catch (x) { /* */ } adapter.end(() => process.exit(2)); });
