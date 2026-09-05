// 검증 공백 실측 — (A) fcnt/hd_* 여덟 moduleclass 를 실제 DB 에서 생성·조회·갱신·탐색하고
// 구독 알림의 접두(nev.rep 키)까지 받아 본다, (B) AE notify 경로(POST 본문 sgn → AE poa 로 중계).
// 실행마다 다른 AE 이름. 값은 지우고 (status, rsc, 루트 키, 키 구조·타입) 만 남긴다.
//
//   node gap-check.js <tree-root> <out.json> [backend]
//   node gap-check.js --diff <a.json> <b.json>
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

if (process.argv[2] === '--diff') {
    const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
    let n = 0;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) { n++; console.log('── ' + ((a[i] || b[i]).label) + '\n   전= ' + JSON.stringify(a[i]) + '\n   후= ' + JSON.stringify(b[i])); }
    }
    console.log(n === 0 ? a.length + '건 전부 동일' : '차이 ' + n + '건 / ' + max);
    process.exit(n === 0 ? 0 : 1);
}

const ROOT = process.argv[2], OUT = process.argv[3];
const BACKEND = process.argv[4] || 'mysql';
if (!ROOT || !OUT) { console.error('usage: gap-check.js <tree-root> <out.json> [backend]'); process.exit(2); }
const PORT = 7579, NOTI = 7591, AEPOA = 7592;
// GAP_NOSPAWN=1 이면 이미 떠 있는 서버(127.0.0.1:7579)를 겨냥한다 — 운영 서버(pm2)에서 쓴다.
// 새 프로세스를 띄우면 포트가 겹친다.
const NOSPAWN = !!process.env.GAP_NOSPAWN;
const LOG = OUT + '.server.log';
const fd = NOSPAWN ? null : fs.openSync(LOG, 'w');
const server = NOSPAWN ? null : spawn(process.execPath, ['mobius.js', BACKEND], {
    cwd: ROOT, stdio: ['ignore', fd, fd],
    env: Object.assign({}, process.env, BACKEND === 'sqlite' ? { MOBIUS_SQLITE_PATH: OUT + '.db' } : {})
});

// 받은 것을 기록하고 json 으로 답하는 가짜 상대 둘 — 알림 수신자와 AE 의 poa
function mock(port, list) {
    return http.createServer((req, res) => {
        let buf = '';
        req.on('data', (c) => { buf += c; });
        req.on('end', () => {
            let body = null; try { body = JSON.parse(buf); } catch (e) { body = buf ? '(json 아님)' : null; }
            list.push({ method: req.method, path: req.url, ct: req.headers['content-type'] || null, body: body });
            res.writeHead(200, { 'Content-Type': 'application/json', 'X-M2M-RSC': '2000', 'X-M2M-RI': req.headers['x-m2m-ri'] || 'x' });
            res.end(JSON.stringify({ 'm2m:dbg': 'ok from ' + port }));
        });
    });
}
const notis = [], aecalls = [];
const notiSrv = mock(NOTI, notis), aeSrv = mock(AEPOA, aecalls);

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
const AE = 'Cgap' + Date.now().toString(36);
const AE2 = AE + 'n';
function call(method, p, body, ct, origin) {
    return new Promise((resolve) => {
        const d = body ? JSON.stringify(body) : null;
        const h = { 'X-M2M-RI': 'gap-' + Date.now() + Math.random().toString(36).slice(2, 6), 'X-M2M-Origin': origin || AE, Accept: 'application/json' };
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
// 값은 버리고 키 구조와 타입만 — 배열은 길이와 첫 원소 구조
function shapeOf(v) {
    if (Array.isArray(v)) return { len: v.length, first: v.length ? shapeOf(v[0]) : null };
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = shapeOf(v[k]); }); return o; }
    return typeof v;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MC = {
    dooLk: ['org.onem2m.home.moduleclass.doorlock',        { lock: true },              { lock: false }],
    bat:   ['org.onem2m.home.moduleclass.battery',         { lvl: 80 },                 { lvl: 55 }],
    tempe: ['org.onem2m.home.moduleclass.temperature',     { curT0: 21.5 },             { curT0: 19 }],
    binSh: ['org.onem2m.home.moduleclass.binarySwitch',    { powerSe: true },           { powerSe: false }],
    fauDn: ['org.onem2m.home.moduleclass.faultDetection',  { sus: false },              { sus: true }],
    colSn: ['org.onem2m.home.moduleclass.colourSaturation', { colSn: 50 },              { colSn: 60 }],
    color: ['org.onem2m.home.moduleclass.colour',          { red: 1, green: 2, blue: 3 }, { red: 4, green: 5, blue: 6 }],
    brigs: ['org.onem2m.home.moduleclass.brightness',      { brigs: 70 },               { brigs: 30 }]
};

(async () => {
    const rows = [];
    let failed = null;
    await new Promise((r) => notiSrv.listen(NOTI, '127.0.0.1', r));
    await new Promise((r) => aeSrv.listen(AEPOA, '127.0.0.1', r));
    const J = 'application/json';
    const B = '/Mobius/' + AE, D = B + '/dev1';
    async function step(label, method, p, body, ct, origin) {
        const r = await call(method, p, body, ct, origin);
        let parsed = null; try { parsed = JSON.parse(r.body); } catch (e) { parsed = r.body ? '(json 아님)' : null; }
        const root = parsed && typeof parsed === 'object' ? Object.keys(parsed)[0] : null;
        rows.push({ label, method, status: r.status, rsc: r.rsc, root, shape: shapeOf(parsed) });
        console.error('  ' + label.padEnd(26) + ' -> ' + r.status + '/' + r.rsc + '  ' + (root || '') + '  ' + r.body.slice(0, 90).replace(/\s+/g, ' '));
        return r;
    }
    function snapNotis(label) {
        const seen = notis.splice(0);
        rows.push({ label, notifications: seen.map((n) => ({ method: n.method, path: n.path, repKeys: (n.body && n.body['m2m:sgn'] && n.body['m2m:sgn'].nev && n.body['m2m:sgn'].nev.rep) ? Object.keys(n.body['m2m:sgn'].nev.rep) : null, shape: shapeOf(n.body) })) });
        console.error('  ' + label.padEnd(26) + ' -> ' + seen.length + '건 ' + seen.map((n) => n.body && n.body['m2m:sgn'] && n.body['m2m:sgn'].nev ? Object.keys(n.body['m2m:sgn'].nev.rep || {}).join(',') : '(rep 없음)').join(' | '));
    }
    try {
        if (!NOSPAWN) { await waitListen(Date.now() + 40000); await sleep(1500); }
        // ── A. fcnt / hd_* ──
        await step('AE 생성', 'POST', '/Mobius', { 'm2m:ae': { rn: AE, api: 'Ngap', rr: true } }, J + ';ty=2');
        await step('fcnt 디바이스 생성', 'POST', B, { 'm2m:fcnt': { rn: 'dev1', cnd: 'org.onem2m.home.device.deviceLight' } }, J + ';ty=28');
        for (const s of Object.keys(MC)) {
            await step('hd:' + s + ' 생성', 'POST', D, { ['hd:' + s]: Object.assign({ rn: s, cnd: MC[s][0] }, MC[s][1]) }, J + ';ty=28');
        }
        await step('hd:bat 구독 생성', 'POST', D + '/bat', { 'm2m:sub': { rn: 's1', nu: ['http://127.0.0.1:' + NOTI + '/noti'], enc: { net: [1] } } }, J + ';ty=23');
        await sleep(800); snapNotis('구독 직후 알림(검증 요청 등)');
        for (const s of Object.keys(MC)) { await step('hd:' + s + ' 조회', 'GET', D + '/' + s); }
        await step('fcnt 디바이스 조회', 'GET', D);
        for (const s of Object.keys(MC)) { await step('hd:' + s + ' 갱신(hd 루트)', 'PUT', D + '/' + s, { ['hd:' + s]: MC[s][2] }, J); }
        await sleep(1200); snapNotis('hd 루트 갱신 뒤 알림');
        // hd:* 루트의 PUT 은 관문(ty 대조)이 400-42 로 막는다 — 변경 전에도 그랬다. 실제 갱신
        // 경로는 m2m:fcnt 루트다: update_action 이 저장된 cnd 로 HD_UPDATE 를 고른다.
        for (const s of Object.keys(MC)) { await step('hd:' + s + ' 갱신(m2m:fcnt 루트)', 'PUT', D + '/' + s, { 'm2m:fcnt': MC[s][2] }, J); }
        await sleep(1500); snapNotis('m2m:fcnt 루트 갱신 뒤 알림(hd:bat 구독)');
        // moduleclass 속성(lvl 등)은 fcnt 속성 목록에 없어 400 이다(변경 전에도). HD_UPDATE 는
        // fcnt 공통 속성(lbl) 갱신으로 닿는다 — update_action 이 저장된 cnd 로 update_hd_* 를 고른다.
        // 응답 루트는 root_key(fcnt + cnd) 라 'hd:<약칭>' 이어야 하고, hd:bat 구독의 알림 rep 키도 같다.
        for (const s of Object.keys(MC)) { await step('hd:' + s + ' lbl 갱신(HD_UPDATE)', 'PUT', D + '/' + s, { 'm2m:fcnt': { lbl: ['u-' + s] } }, J); }
        await sleep(1500); snapNotis('lbl 갱신 뒤 알림(hd:bat 구독)');
        for (const s of Object.keys(MC)) { await step('hd:' + s + ' 재조회', 'GET', D + '/' + s); }
        await step('짝 안 맞는 생성(hd:bat + doorlock)', 'POST', D, { 'hd:bat': { rn: 'bad', cnd: 'org.onem2m.home.moduleclass.doorlock', lvl: 1 } }, J + ';ty=28');
        await step('모르는 moduleclass 생성', 'POST', D, { 'hd:bat': { rn: 'bad2', cnd: 'org.onem2m.home.moduleclass.nope', lvl: 1 } }, J + ';ty=28');
        await step('탐색 fu=1 (uril)', 'GET', D + '?fu=1');
        await step('탐색 fu=2&rcn=4 (grouped)', 'GET', D + '?fu=2&rcn=4');
        await step('fcnt 디바이스 갱신', 'PUT', D, { 'm2m:fcnt': { lbl: ['x'] } }, J);
        // ── B. AE notify 경로 ──
        await step('AE2 생성 (poa=가짜 AE)', 'POST', '/Mobius', { 'm2m:ae': { rn: AE2, api: 'Ngap2', rr: true, poa: ['http://127.0.0.1:' + AEPOA + '/ae'] } }, J + ';ty=2', AE2);
        await step('AE2 에 알림 POST (중계)', 'POST', '/Mobius/' + AE2, { 'm2m:sgn': { nev: { rep: { 'm2m:cin': { con: 'x' } }, net: 3 }, sur: '/Mobius/x' } }, J, AE2);
        await sleep(500);
        rows.push({ label: 'AE poa 가 받은 것', calls: aecalls.map((c) => ({ method: c.method, path: c.path, ct: c.ct, shape: shapeOf(c.body) })) });
        console.error('  AE poa 가 받은 것          -> ' + JSON.stringify(aecalls.map((c) => c.method + ' ' + c.path)));
        // ── 정리 ──
        await step('AE 삭제', 'DELETE', B);
        await step('AE2 삭제', 'DELETE', '/Mobius/' + AE2, null, null, AE2);
    } catch (e) { failed = e; }
    finally {
        if (server) { server.kill(); }
        notiSrv.close(); aeSrv.close();
        await sleep(1200);
        if (fd !== null) { fs.closeSync(fd); }
    }
    if (failed) { console.error(String(failed.stack || failed.message)); process.exit(1); }
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
    const log = NOSPAWN ? '' : fs.readFileSync(LOG, 'utf8');
    const bad = log.split('\n').filter((l) => /^(TypeError|ReferenceError|RangeError|SyntaxError):/.test(l.trim()) || /\[settle\]|\[once\]|backstop/.test(l));
    console.log((bad.length ? '!! crash/settle/once lines ' + bad.length + ':\n' + bad.slice(0, 5).join('\n') : 'no worker crash, no [settle]/[once] warnings') + '\n' + rows.length + '건 -> ' + OUT);
    process.exit(bad.length ? 3 : 0);
})();
