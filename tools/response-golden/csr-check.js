// remoteCSE 포워딩(301-1 → check_csr → settle.raw) 실측 골든. 정식 골든에는 없다.
// 가짜 상류 CSE 를 7590 에 띄우고, poa 가 그것을 가리키는 csr 을 만든 뒤 /csr1/... 로
// GET·POST·PUT·DELETE 를 보내 (status, rsc, content-type, 본문 키) 와 상류가 받은
// (method, path) 를 기록한다. poa 없는 csr(301-5)과 없는 csr(404-3)도 밟는다.
//
//   node csr-check.js <tree-root> <out.json> [backend]
//   node csr-check.js --diff <a.json> <b.json>
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
const BACKEND = process.argv[4] || 'mysql';
if (!ROOT || !OUT) { console.error('usage: csr-check.js <tree-root> <out.json> [backend]'); process.exit(2); }
const PORT = 7579, UP = 7590;
const LOG = OUT + '.server.log';
const fd = fs.openSync(LOG, 'w');
const server = spawn(process.execPath, ['mobius.js', BACKEND], {
    cwd: ROOT, stdio: ['ignore', fd, fd],
    env: Object.assign({}, process.env, BACKEND === 'sqlite' ? { MOBIUS_SQLITE_PATH: OUT + '.db' } : {})
});

// 가짜 상류 — 받은 것을 기록하고 json 으로 답한다
const seen = [];
const upstream = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
        seen.push({ method: req.method, path: req.url, ct: req.headers['content-type'] || null, accept: req.headers.accept || null, bodyLen: buf.length });
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-M2M-RSC': '2000', 'X-M2M-RI': req.headers['x-m2m-ri'] || 'x' });
        res.end(JSON.stringify({ 'm2m:cnt': { rn: 'from-upstream', ty: 3, echo: req.method } }));
    });
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
// 수퍼유저 — csr 은 생성자 origin 으로도 못 지워(403) 잔여물이 남아 다음 실행이 409 가 된다
const ORIGIN = 'Sponde';
function call(method, p, body, ct) {
    return new Promise((resolve) => {
        const d = body ? JSON.stringify(body) : null;
        const h = { 'X-M2M-RI': 'csr-' + Date.now(), 'X-M2M-Origin': ORIGIN, Accept: 'application/json' };
        if (ct) h['Content-Type'] = ct;
        if (d) h['Content-Length'] = Buffer.byteLength(d);
        const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h }, (res) => {
            let x = '';
            res.on('data', (c) => { x += c; });
            res.on('end', () => resolve({ status: res.statusCode, rsc: res.headers['x-m2m-rsc'] || null, ct: res.headers['content-type'] || null, body: x }));
        });
        r.on('error', (e) => resolve({ status: 0, rsc: null, ct: null, body: 'ERR ' + e.message }));
        r.setTimeout(15000, () => r.destroy(new Error('timeout')));
        if (d) r.write(d);
        r.end();
    });
}
function shapeOf(v) {
    if (Array.isArray(v)) return { len: v.length, first: v.length ? shapeOf(v[0]) : null };
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = shapeOf(v[k]); }); return o; }
    return typeof v;
}
(async () => {
    const rows = [];
    let failed = null;
    await new Promise((r) => upstream.listen(UP, '127.0.0.1', r));
    try {
        await waitListen(Date.now() + 40000);
        await new Promise((r) => setTimeout(r, 1500));
        const J = 'application/json';
        // 이전 실행 잔여물
        await call('DELETE', '/Mobius/csr1'); await call('DELETE', '/Mobius/csr2');
        const steps = [
            ['csr1 생성 (poa=상류)', 'POST', '/Mobius', { 'm2m:csr': { rn: 'csr1', csi: '/csr1', cb: '/csr1/cb', poa: ['http://127.0.0.1:' + UP], rr: true, srv: ['3'] } }, J + ';ty=16'],
            ['csr2 생성 (poa 없음)', 'POST', '/Mobius', { 'm2m:csr': { rn: 'csr2', csi: '/csr2', cb: '/csr2/cb', rr: true, srv: ['3'] } }, J + ';ty=16'],
            ['GET 포워딩',    'GET',    '/csr1/cb/x', null, null],
            ['POST 포워딩',   'POST',   '/csr1/cb', { 'm2m:cnt': { rn: 'y' } }, J + ';ty=3'],
            ['PUT 포워딩',    'PUT',    '/csr1/cb/x', { 'm2m:cnt': { lbl: ['z'] } }, J],
            ['DELETE 포워딩', 'DELETE', '/csr1/cb/x', null, null],
            ['poa 없는 csr',  'GET',    '/csr2/cb/x', null, null],
            ['없는 csr',      'GET',    '/nocsr/cb/x', null, null],
            ['csr1 삭제', 'DELETE', '/Mobius/csr1', null, null],
            ['csr2 삭제', 'DELETE', '/Mobius/csr2', null, null]
        ];
        for (const s of steps) {
            const before = seen.length;
            const r = await call(s[1], s[2], s[3], s[4]);
            let parsed = null;
            try { parsed = JSON.parse(r.body); } catch (e) { parsed = '(json 아님)'; }
            rows.push({ label: s[0], method: s[1], status: r.status, rsc: r.rsc, ct: r.ct, shape: shapeOf(parsed), upstream: seen.slice(before) });
            console.error('  ' + s[0].padEnd(20) + ' -> ' + r.status + '/' + r.rsc + '  up=' + JSON.stringify(seen.slice(before)) + '  ' + r.body.slice(0, 70));
        }
    } catch (e) { failed = e; }
    finally {
        server.kill();
        upstream.close();
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
