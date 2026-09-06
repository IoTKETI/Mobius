'use strict';
// 운영 DB 에서 핵심 질의의 실행 계획을 본다 — 읽기 전용 (요청 흐름 남은 일 §7.1).
//
//   node tools/explain-check.js [dbName]        기본 mobiusdb. conf.json 의 dbpass, localhost root.
//
// MySQL 시험 레인(npm run test:mysql)은 빈 시험 DB 에서 같은 것을 보지만 표가 수천 행이라
// 규모에서만 드러나는 것(통계로 뒤집히는 계획)은 못 본다. 이 도구는 **실제 데이터**로
// 같은 경로를 밟고 EXPLAIN 한다. 아무것도 쓰지 않는다 — 실제 AE 하나 아래를 작은 lim 으로
// 검색하고(discovery 는 원래 읽기다), 기록된 문장을 EXPLAIN 한다.
//
// 배포 절차: 재기동 **전에** 서버에서 돌린다. 계획에 lookup 풀스캔이 있으면 1 로 끝난다.
// 2026-09-06 의 콜레이션 캐스트(재귀 조인이 인덱스를 잃음)가 이 도구가 잡을 결함이다.

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const DB_NAME = process.argv[2] || 'mobiusdb';

global.NOPRINT = 'true';
global.usecsebase = 'Mobius'; global.usecseid = '/Mobius2'; global.usespid = '//explain.check'; global.uservi = '2a';
global.max_lim = 2000;

const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'conf.json'), 'utf8'));
// CSE 이름은 conf 가 안다 — 없으면 기본값
if (typeof conf.cseBase === 'string') { global.usecsebase = conf.cseBase; }
if (typeof conf.cseId === 'string') { global.usecseid = conf.cseId; }
if (typeof conf.spId === 'string') { global.usespid = conf.spId; }

global.usedb = 'mysql';
const db = require(path.join(ROOT, 'mobius', 'db'));
conf.dbName = DB_NAME;          // 어댑터가 읽는 키 — 인자로 준 DB 로 붙인다
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
    // type 이 null 인 행은 "맞는 행이 없다(const 표)" 다 — 풀스캔이 아니다
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

    // 실제 표본 — 자식이 가장 많은 AE 하나, 그 아래 CIN 이 있는 컨테이너 하나, 구독 하나
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
        // 자식 질의는 raw 문장이다(force index 가 붙는다) — `from lookup r`
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
