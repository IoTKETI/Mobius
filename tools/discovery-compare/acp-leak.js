'use strict';
// Does a discovery result respect the access rights of each resource?
//
//   node tools/discovery-compare/acp-leak.js [sqlite|mysql]
//
// In oneM2M DISCOVERY is an operation of its own (acop bit 32). Two checks are required:
//   1) does the addressed resource grant DISCOVERY -> otherwise the request is refused
//   2) does each found resource grant DISCOVERY -> those that do not are dropped from the result
// Without 2) the existence and the name (path) of inaccessible resources leak.
//
// This script builds that situation and checks whether anything leaks.
//
//   acp_probe_ae            acpi=[acp_all]    discoverable by anyone
//     ├ acp_all             acop 63 for everyone
//     ├ acp_deny            acop 63 for Sponde only
//     ├ open                acpi=[acp_all]    may be seen
//     │   └ cin x1
//     └ secret              acpi=[acp_deny]   must not be seen
//         └ cin x1
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = process.argv[2] || '';
const HOST = '127.0.0.1', PORT = 7579, CB = '/Mobius';
const AE = 'acp_probe_ae';
const SU = 'Sponde';                 // superuser: passes everything
const STRANGER = 'Cstranger';        // a third party without rights

function call(opt) {
    return new Promise(function (resolve) {
        const headers = {
            'X-M2M-Origin': opt.org || SU,
            'X-M2M-RI': 'a' + Math.floor(Math.random() * 1e9),
            'Accept': 'application/json'
        };
        let body = null;
        if (opt.body != null) {
            body = JSON.stringify(opt.body);
            headers['Content-Type'] = 'application/json' + (opt.ty ? ';ty=' + opt.ty : '');
            headers['Content-Length'] = Buffer.byteLength(body);
        }
        const req = http.request(
            { host: HOST, port: PORT, path: opt.path, method: opt.method, headers: headers },
            function (res) {
                let buf = '';
                res.on('data', function (c) { buf += c; });
                res.on('end', function () { resolve({ status: res.statusCode, body: buf }); });
            });
        req.on('error', function (e) { resolve({ status: 0, body: String(e.message) }); });
        if (body) { req.write(body); }
        req.end();
    });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = CB + '/' + AE;
const SUBPATHS = ['/open', '/secret', '/acp_all', '/acp_deny'];

async function waitUp() {
    for (let i = 0; i < 120; i++) {
        const r = await call({ path: CB, method: 'GET' });
        if (r.status === 200) { return true; }
        await wait(500);
    }
    return false;
}

async function removeTree() {
    for (const sub of SUBPATHS) { await call({ path: BASE + sub, method: 'DELETE' }); }
    await call({ path: BASE, method: 'DELETE' });
    for (let i = 0; i < 60; i++) {
        const r = await call({ path: BASE, method: 'GET' });
        if (r.status === 404) { return; }
        await wait(500);
    }
    throw new Error('이전 실행의 트리가 안 지워진다: ' + BASE);
}

// acop 63 = CREATE|RETRIEVE|UPDATE|DELETE|NOTIFY|DISCOVERY
function acp(rn, acor) {
    return { 'm2m:acp': {
        rn: rn,
        pv: { acr: [{ acor: acor, acop: 63 }] },
        pvs: { acr: [{ acor: [SU], acop: 63 }] }
    } };
}

async function build() {
    await call({ path: CB, method: 'POST', ty: 2,
        body: { 'm2m:ae': { rn: AE, api: 'a.b.c', rr: true } } });
    // Two ACPs
    const r1 = await call({ path: BASE, method: 'POST', ty: 1, body: acp('acp_all', ['*']) });
    const r2 = await call({ path: BASE, method: 'POST', ty: 1, body: acp('acp_deny', [SU]) });
    const riOf = (r) => { try { return JSON.parse(r.body)['m2m:acp'].ri; } catch (e) { return null; } };
    const allRi = riOf(r1), denyRi = riOf(r2);
    if (!allRi || !denyRi) { throw new Error('ACP 생성 실패: ' + r1.body.slice(0, 120)); }

    // Let anyone discover the AE (gate 1 must pass to observe gate 2)
    await call({ path: BASE, method: 'PUT', ty: 2, body: { 'm2m:ae': { acpi: [allRi] } } });

    await call({ path: BASE, method: 'POST', ty: 3,
        body: { 'm2m:cnt': { rn: 'open', acpi: [allRi] } } });
    await call({ path: BASE, method: 'POST', ty: 3,
        body: { 'm2m:cnt': { rn: 'secret', acpi: [denyRi] } } });
    for (const c of ['open', 'secret']) {
        await call({ path: BASE + '/' + c, method: 'POST', ty: 4,
            body: { 'm2m:cin': { con: 'x' } } });
    }
    return { allRi, denyRi };
}

async function main() {
    const args = [path.join(ROOT, 'mobius.js')];
    if (BACKEND) { args.push(BACKEND); }
    const logFd = fs.openSync(path.join(__dirname, 'acp-leak.log'), 'w');
    const srv = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', logFd, logFd] });

    let leaked = false;
    try {
        if (!await waitUp()) { throw new Error('서버가 뜨지 않았다 (acp-leak.log 확인)'); }
        await removeTree();
        const { denyRi } = await build();
        await wait(500);

        console.log('  트리: open(누구나) / secret(수퍼유저만)  ACP=' + denyRi);
        console.log('');

        // Gate 1: reading secret directly
        const direct = await call({ path: BASE + '/secret', method: 'GET', org: STRANGER });
        console.log('  [직접 조회] GET ' + BASE + '/secret  as ' + STRANGER +
            '  -> HTTP ' + direct.status +
            (direct.status === 403 ? '  (막힘 — 올바르다)' : '  (!! 막히지 않았다)'));

        // Gate 2: does secret appear in the discovery result?
        const disc = await call({ path: BASE + '?fu=1', method: 'GET', org: STRANGER });
        let uril = [];
        try { uril = JSON.parse(disc.body)['m2m:uril'] || []; } catch (e) { /* ignore */ }
        console.log('  [탐색]     GET ' + BASE + '?fu=1     as ' + STRANGER +
            '  -> HTTP ' + disc.status + '  ' + uril.length + '건');
        uril.forEach((u) => console.log('               ' + u));

        const secretSeen = uril.filter((u) => u.indexOf('/secret') !== -1);
        console.log('');
        if (secretSeen.length) {
            leaked = true;
            console.log('  결과: 접근할 수 없는 리소스가 ' + secretSeen.length + '건 새어 나왔다.');
            console.log('        직접 조회는 403 인데 탐색 결과에는 경로가 그대로 들어 있다.');
        } else {
            console.log('  결과: 새지 않았다 — 개별 리소스 권한이 지켜진다.');
        }

        // The superuser must see everything
        const su = await call({ path: BASE + '?fu=1', method: 'GET', org: SU });
        let suUril = [];
        try { suUril = JSON.parse(su.body)['m2m:uril'] || []; } catch (e) { /* ignore */ }
        console.log('');
        console.log('  (참고) 수퍼유저로 탐색: ' + suUril.length + '건 — 전부 보이는 게 정상이다');

        await removeTree();
        await wait(2000);
    } finally {
        srv.kill('SIGKILL');
    }
    process.exit(leaked ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(2); });
