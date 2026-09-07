// Fan-out (fopt) golden: the formal goldens have no successful fan-out case (only the empty group 404).
// Starts the server, builds AE -> two cnt -> grp(mid = both), sends GET/POST/PUT/DELETE to /fopt and records (status, rsc, body key structure). Values that change per run (ri, time, names) are dropped.
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
// sqlite blocks grp (ty=9) with 501, so fan-out cannot be exercised there; the default is mysql (local development DB).
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
// A different name per run: with a fixed name, orphans (c1/c2/g1) left by a run whose worker died made the next run's creations fail with 409. Values are dropped anyway; only key structures are compared.
const AE = 'Cfopt' + Date.now().toString(36);
async function cleanupPrevious() { /* names differ per run, so nothing collides with remains */ }
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
// Folds the body into its key structure: values are dropped, arrays keep only their length and the structure of the first element
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
