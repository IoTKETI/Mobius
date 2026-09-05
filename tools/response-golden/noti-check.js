// 알림 수신 실측 골든. 정식 골든(run-scenarios / headers)에는 알림을 **받는** 케이스가 없다.
//
// sqlite 새 DB 로 서버를 띄우고, 로컬 HTTP 리스너를 열어 알림을 받는다.
//   AE(poa = 리스너/notify) → cnt → sub1(nu = 리스너/direct, net [1,3,4])
//   → sub2(nu = AE 의 ri 응답값 = ID 형식, net [3], su 설정)
//   → CIN 생성(기대: direct·notify) → cnt PUT(direct net=1) → CIN 삭제(direct net=4)
//   → sub2 삭제(구독 삭제 알림 128: 옛 코드는 형제 sub1 에도, 새 코드는 sub2 자신에게만 —
//     스펙 ③) → AE 삭제
//
//   node tools/response-golden/noti-check.js <tree-root> <out.json>
//   node tools/response-golden/noti-check.js --diff <a.json> <b.json>
//
// 실행마다 다른 값(AE 이름·ri·시각)은 정규화한다. 알림은 (단계, 경로, sur, net|sud) 로 정렬해
// 저장하므로 발송 순서(랜덤 지연)에 흔들리지 않는다.
// 스펙: docs/superpowers/specs/2026-09-05-notification-routing-source-design.md
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

if (process.argv[2] === '--diff') {
    const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
    let n = 0;
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    keys.forEach((k) => {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
            n++;
            const allowed = /sub2 삭제/.test(k) ? '  (스펙 ③ — 구독 삭제 알림은 지워진 구독 자신에게만)' : '';
            console.log('── ' + k + allowed + '\n   전= ' + JSON.stringify(a[k]) + '\n   후= ' + JSON.stringify(b[k]));
        }
    });
    console.log(n === 0 ? keys.length + '단계 전부 동일' : '차이 ' + n + '단계 / ' + keys.length);
    process.exit(0);
}

const ROOT = process.argv[2], OUT = process.argv[3];
if (!ROOT || !OUT) { console.error('usage: noti-check.js <tree-root> <out.json>'); process.exit(2); }
const PORT = 7579;
const DB = OUT + '.db';
try { fs.unlinkSync(DB); } catch (e) { /* none */ }
const LOG = OUT + '.server.log';
const fd = fs.openSync(LOG, 'w');
const server = spawn(process.execPath, ['mobius.js', 'sqlite'], {
    cwd: ROOT, stdio: ['ignore', fd, fd],
    env: Object.assign({}, process.env, { MOBIUS_SQLITE_PATH: DB })
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
const AE = 'Cnoti' + Date.now().toString(36);
const J = 'application/json';
function call(method, p, body, ct) {
    return new Promise((resolve) => {
        const d = body ? JSON.stringify(body) : null;
        const h = { 'X-M2M-RI': 'noti-' + Date.now(), 'X-M2M-Origin': AE, Accept: J };
        if (ct) h['Content-Type'] = ct;
        if (d) h['Content-Length'] = Buffer.byteLength(d);
        const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h }, (res) => {
            let x = '';
            res.on('data', (c) => { x += c; });
            res.on('end', () => resolve({ status: res.statusCode, rsc: res.headers['x-m2m-rsc'], body: x }));
        });
        r.on('error', (e) => resolve({ status: 0, rsc: null, body: 'ERR ' + e.message }));
        if (d) r.write(d);
        r.end();
    });
}

// 알림 리스너 — 받은 것을 (경로, sur, net|sud, rep 키) 로 적는다.
const received = [];
const listener = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
        let sgn = null;
        try { sgn = JSON.parse(b)['m2m:sgn'] || null; } catch (e) { sgn = { parse_error: true }; }
        received.push({
            path: req.url,
            sur: sgn && sgn.sur ? String(sgn.sur).split(AE).join('AE') : null,
            net: sgn && sgn.nev ? sgn.nev.net : null,
            sud: !!(sgn && sgn.sud),
            rep: sgn && sgn.nev && sgn.nev.rep ? Object.keys(sgn.nev.rep).join(',') : null
        });
        res.setHeader('X-M2M-RSC', '2000');
        res.statusCode = 200;
        res.end();
    });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function drain() { const out = received.splice(0).sort((x, y) => JSON.stringify(x) < JSON.stringify(y) ? -1 : 1); return out; }

(async () => {
    const rows = {};
    let failed = null;
    try {
        await new Promise((r) => listener.listen(0, '127.0.0.1', r));
        const L = 'http://127.0.0.1:' + listener.address().port;
        await waitListen(Date.now() + 40000);
        await sleep(1500);
        const B = '/Mobius/' + AE;
        const ae = await call('POST', '/Mobius', { 'm2m:ae': { rn: AE, api: 'Nnoti', rr: true, poa: [L + '/notify'] } }, J + ';ty=2');
        const aeRi = JSON.parse(ae.body)['m2m:ae'].ri;       // 짧은 id — ID 형식 nu 로 쓴다
        const steps = [
            ['1 AE·cnt·sub 생성', async () => {
                const a = await call('POST', B, { 'm2m:cnt': { rn: 'c1' } }, J + ';ty=3');
                const s1 = await call('POST', B + '/c1', { 'm2m:sub': { rn: 's1', nu: [L + '/direct'], enc: { net: [1, 3, 4] }, nct: 2 } }, J + ';ty=23');
                const s2 = await call('POST', B + '/c1', { 'm2m:sub': { rn: 's2', nu: [aeRi], enc: { net: [3] }, nct: 2, su: L + '/su' } }, J + ';ty=23');
                return [ae.status, a.status, s1.status, s2.status].join('/');
            }],
            ['2 CIN 생성 (기대 direct·notify net=3)', async () => (await call('POST', B + '/c1', { 'm2m:cin': { con: 'v1', rn: 'i1' } }, J + ';ty=4')).status],
            ['3 cnt PUT (기대 direct net=1)', async () => (await call('PUT', B + '/c1', { 'm2m:cnt': { lbl: ['x'] } }, J)).status],
            ['4 CIN 삭제 (기대 direct net=4)', async () => (await call('DELETE', B + '/c1/i1', null, null)).status],
            ['5 sub2 삭제 (128 + 자식 삭제 net=4)', async () => (await call('DELETE', B + '/c1/s2', null, null)).status],
            ['6 AE 삭제', async () => (await call('DELETE', B, null, null)).status]
        ];
        for (const [label, fn] of steps) {
            const status = await fn();
            await sleep(900);
            const got = drain();
            rows[label] = { status: status, received: got };
            console.error('  ' + label.padEnd(36) + status + '  알림 ' + got.length + '건 ' + got.map((g) => g.path + (g.sud ? ' sud' : ' net=' + g.net)).join(', '));
        }
    } catch (e) { failed = e; }
    finally {
        server.kill();
        listener.close();
        await sleep(1200);
        fs.closeSync(fd);
    }
    if (failed) { console.error(String(failed.message)); process.exit(1); }
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
    const log = fs.readFileSync(LOG, 'utf8');
    const bad = log.split('\n').filter((l) => /^(TypeError|ReferenceError|RangeError|SyntaxError):/.test(l.trim()) || /\[settle\]|\[once\]/.test(l));
    const notiFail = log.split('\n').filter((l) => /\[noti\] fail|\[sgn\] /.test(l));
    console.log((bad.length ? '!! crash/settle/once lines ' + bad.length : 'no worker crash, no [settle]/[once] warnings') +
                (notiFail.length ? '\n[noti]/[sgn] lines ' + notiFail.length + ':\n' + notiFail.slice(0, 5).join('\n') : '') +
                '\n' + Object.keys(rows).length + '단계 -> ' + OUT);
    process.exit(bad.length ? 3 : 0);
})();
