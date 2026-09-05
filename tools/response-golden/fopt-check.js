// 팬아웃(fopt) 실측 골든. 정식 골든에는 **성공하는** 팬아웃 케이스가 없다(빈 그룹 404 만).
// 서버를 sqlite 로 띄우고 AE → cnt 둘 → grp(mid 둘) 을 만든 뒤 /fopt 로 GET·POST·PUT·DELETE
// 를 보내 (status, rsc, 본문 키 구조) 를 기록한다. 실행마다 다른 값(ri·시각·이름)은 지운다.
//
//   node fopt-check.js <tree-root> <out.json>
//   node fopt-check.js --diff <a.json> <b.json>
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

if (process.argv[2] === '--diff') {
    const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
    let n = 0;
    a.forEach((x, i) => {
        if (JSON.stringify(x) !== JSON.stringify(b[i])) { n++; console.log('── ' + x.label + '\n   전= ' + JSON.stringify(x) + '\n   후= ' + JSON.stringify(b[i])); }
    });
    console.log(n === 0 ? a.length + '건 전부 동일' : '차이 ' + n + '건 / ' + a.length);
    process.exit(n === 0 ? 0 : 1);
}

const ROOT = process.argv[2], OUT = process.argv[3];
// sqlite 는 grp(ty=9) 를 501 로 막아 팬아웃을 못 밟는다 — 기본은 mysql(로컬 개발 DB) 이다.
const BACKEND = process.argv[4] || process.env.FOPT_BACKEND || 'mysql';
if (!ROOT || !OUT) { console.error('usage: fopt-check.js <tree-root> <out.json> [backend]'); process.exit(2); }
const PORT = 7579;
const DB = OUT + '.db';
try { fs.unlinkSync(DB); } catch (e) { /* none */ }
const LOG = OUT + '.server.log';
const fd = fs.openSync(LOG, 'w');
const server = spawn(process.execPath, ['mobius.js', BACKEND], {
    cwd: ROOT, stdio: ['ignore', fd, fd],
    env: Object.assign({}, process.env, BACKEND === 'sqlite' ? { MOBIUS_SQLITE_PATH: DB } : {})
});
function waitListen(deadline) {
    return new Promise((resolve, reject) => {
        (function poll() {
            let log = '';
            try { log = fs.readFileSync(LOG, 'utf8'); } catch (e) { /* not yet */ }
            if (log.indexOf('running at ' + PORT + ' port') >= 0) return resolve();
            if (Date.now() > deadline) return reject(new Error('boot timeout\n' + log.slice(-600)));
            setTimeout(poll, 300);
        })();
    });
}
// 실행마다 다른 이름 — 고정 이름을 쓰다가, 워커가 죽은 실행이 남긴 고아 c1/c2/g1 때문에
// 다음 실행의 생성이 409 로 갈린 적이 있다. 값은 어차피 지우고 키 구조만 비교한다.
const AE = 'Cfopt' + Date.now().toString(36);
async function cleanupPrevious() { /* 이름이 매번 달라 잔여물과 부딪히지 않는다 */ }
function call(method, p, body, ct, extra) {
    return new Promise((resolve) => {
        const d = body ? JSON.stringify(body) : null;
        const h = Object.assign({ 'X-M2M-RI': 'fopt-' + Date.now(), 'X-M2M-Origin': AE, Accept: 'application/json' }, extra || {});
        if (ct) h['Content-Type'] = ct;
        if (d) h['Content-Length'] = Buffer.byteLength(d);
        const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h }, (res) => {
            let x = '';
            res.on('data', (c) => { x += c; });
            res.on('end', () => resolve({ status: res.statusCode, rsc: res.headers['x-m2m-rsc'], ct: res.headers['content-type'], body: x }));
        });
        r.on('error', (e) => resolve({ status: 0, rsc: null, body: 'ERR ' + e.message }));
        if (d) r.write(d);
        r.end();
    });
}
// 본문을 "키 구조" 로 접는다 — 값은 버리고, 배열은 길이와 첫 원소 구조만 남긴다
function shapeOf(v) {
    if (Array.isArray(v)) return { len: v.length, first: v.length ? shapeOf(v[0]) : null };
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = shapeOf(v[k]); }); return o; }
    return typeof v;
}
(async () => {
    const rows = [];
    let failed = null;
    try {
        await waitListen(Date.now() + 40000);
        await new Promise((r) => setTimeout(r, 1500));
        await cleanupPrevious();
        const J = 'application/json';
        const G = '/Mobius/' + AE + '/g1/fopt';
        const steps = [
            ['AE 생성',   'POST', '/Mobius', { 'm2m:ae': { rn: AE, api: 'Nfopt', rr: true } }, J + ';ty=2'],
            ['cnt1',      'POST', '/Mobius/' + AE, { 'm2m:cnt': { rn: 'c1' } }, J + ';ty=3'],
            ['cnt2',      'POST', '/Mobius/' + AE, { 'm2m:cnt': { rn: 'c2' } }, J + ';ty=3'],
            ['grp',       'POST', '/Mobius/' + AE, { 'm2m:grp': { rn: 'g1', mt: 3, mnm: 10, mid: ['/Mobius/' + AE + '/c1', '/Mobius/' + AE + '/c2'] } }, J + ';ty=9'],
            ['fopt GET',  'GET',  G, null, null],
            ['fopt POST', 'POST', G, { 'm2m:cin': { con: 'fan' } }, J + ';ty=4'],
            ['fopt PUT',  'PUT',  G, { 'm2m:cnt': { lbl: ['fan'] } }, J],
            ['fopt GET la', 'GET', G + '/la', null, null],
            ['fopt DELETE la', 'DELETE', G + '/la', null, null],
            ['fopt 없는 그룹', 'GET', '/Mobius/' + AE + '/c1/fopt', null, null],
            ['AE 삭제',   'DELETE', '/Mobius/' + AE, null, null]
        ];
        for (const s of steps) {
            const r = await call(s[1], s[2], s[3], s[4]);
            let parsed = null;
            try { parsed = JSON.parse(r.body); } catch (e) { parsed = '(json 아님)'; }
            rows.push({ label: s[0], method: s[1], status: r.status, rsc: r.rsc, ct: r.ct, shape: shapeOf(parsed) });
            console.error('  ' + s[0].padEnd(16) + ' -> ' + r.status + '/' + r.rsc + '  ' + r.body.slice(0, 90).replace(/\s+/g, ' '));
        }
    } catch (e) { failed = e; }
    finally {
        server.kill();
        await new Promise((r) => setTimeout(r, 1200));
        fs.closeSync(fd);
    }
    if (failed) { console.error(String(failed.message)); process.exit(1); }
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
    const log = fs.readFileSync(LOG, 'utf8');
    const bad = log.split('\n').filter((l) => /^(TypeError|ReferenceError|RangeError|SyntaxError):/.test(l.trim()) || /\[settle\]|\[once\]/.test(l));
    console.log((bad.length ? '!! crash/settle/once lines ' + bad.length + ':\n' + bad.slice(0, 5).join('\n') : 'no worker crash, no [settle]/[once] warnings') + '\n' + rows.length + '건 -> ' + OUT);
    process.exit(bad.length ? 3 : 0);
})();
