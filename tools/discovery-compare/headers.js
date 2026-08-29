'use strict';
// X-M2M-CTS / X-M2M-CTO 가 실제로 맞게 나가는지 서버를 띄워 확인한다.
//
//   node tools/discovery-compare/headers.js [sqlite|mysql]
//
// 트리는 run.js 와 같다 (컨테이너 4개 / CIN 8개).
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = process.argv[2] || '';
const HOST = '127.0.0.1', PORT = 7579, CB = '/Mobius';
const AE = 'hdr_ae';
const SU = 'Sponde';

function call(opt) {
    return new Promise(function (resolve) {
        const headers = {
            'X-M2M-Origin': SU,
            'X-M2M-RI': 'h' + Math.floor(Math.random() * 1e9),
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
                res.on('end', function () {
                    resolve({ status: res.statusCode, headers: res.headers, body: buf });
                });
            });
        req.on('error', function (e) { resolve({ status: 0, headers: {}, body: String(e.message) }); });
        if (body) { req.write(body); }
        req.end();
    });
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitUp() {
    for (let i = 0; i < 120; i++) {
        const r = await call({ path: CB, method: 'GET' });
        if (r.status === 200) { return true; }
        await wait(500);
    }
    return false;
}

async function build() {
    await call({ path: CB, method: 'POST', ty: 2,
        body: { 'm2m:ae': { rn: AE, api: 'a.b.c', rr: true } } });
    const mk = async function (parent, rn) {
        await call({ path: parent, method: 'POST', ty: 3, body: { 'm2m:cnt': { rn: rn } } });
        return parent + '/' + rn;
    };
    const cin = async function (parent, n) {
        for (let i = 0; i < n; i++) {
            await call({ path: parent, method: 'POST', ty: 4, body: { 'm2m:cin': { con: 'v' + i } } });
        }
    };
    const a = await mk(CB + '/' + AE, 'cntA');
    await cin(a, 3);
    const a1 = await mk(a, 'cntA1');
    await cin(a1, 2);
    const a2 = await mk(a1, 'cntA2');
    await cin(a2, 2);
    const b = await mk(CB + '/' + AE, 'cntB');
    await cin(b, 1);
}

const BASE = CB + '/' + AE;
// [이름, 질의, 기대 CTS, 기대 CTO]  — null 이면 헤더가 없어야 한다
const CASES = [
    ['컨테이너 4개 중 2개만',      'fu=1&ty=3&lim=2',            '1', '2'],
    // 컨테이너가 정확히 4개라 2페이지가 한도를 채운다. 오프셋 페이징에서는
    // 한도를 채웠으면 더 있는지 알 수 없으므로 CTS=1 이 맞다.
    ['이어받기(한도를 채움)',      'fu=1&ty=3&lim=2&ofst=2',     '1', '4'],
    ['한 페이지에 다 들어감',      'fu=1&ty=3&lim=100',          null, null],
    ['딱 맞게 채움',               'fu=1&ty=3&lim=4',            '1', '4'],
    ['CIN 8개 중 3개',             'fu=1&ty=4&lim=3',            '1', '3'],
    ['CIN 이어받기',               'fu=1&ty=4&lim=3&ofst=3',     '1', '6'],
    ['CIN 마지막 페이지',          'fu=1&ty=4&lim=3&ofst=6',     null, null],
    ['오프셋이 전체보다 큼',       'fu=1&ty=3&lim=2&ofst=99',    null, null],
    ['rcn=4 도 같다',              'fu=1&rcn=4&ty=3&lim=2',      '1', '2']
];

async function main() {
    const args = [path.join(ROOT, 'mobius.js')];
    if (BACKEND) { args.push(BACKEND); }
    const logFd = fs.openSync(path.join(__dirname, 'headers.log'), 'w');
    const srv = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', logFd, logFd] });

    let fail = 0;
    try {
        if (!await waitUp()) { throw new Error('서버가 뜨지 않았다 (headers.log 확인)'); }
        await call({ path: BASE, method: 'DELETE' });
        await wait(1500);
        await build();
        await wait(500);

        for (const [name, q, wantCts, wantCto] of CASES) {
            const r = await call({ path: BASE + '?' + q, method: 'GET' });
            const cts = r.headers['x-m2m-cts'];
            const cto = r.headers['x-m2m-cto'];
            let n = '-';
            try {
                const j = JSON.parse(r.body);
                n = (j['m2m:uril'] || []).length;
                if (j['m2m:rsp']) { n = 'rsp'; }
            } catch (e) { /* 무시 */ }
            // 기대가 null 이면 헤더가 아예 없어야 한다 (undefined)
            const eq = (got, want) => (want === null) ? (got === undefined) : (String(got) === String(want));
            const ok = eq(cts, wantCts) && eq(cto, wantCto);
            if (!ok) { fail++; }
            console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name.padEnd(24) +
                ' ' + q.padEnd(28) +
                ' ' + String(n).padStart(4) + '건  CTS=' + cts + ' CTO=' + cto +
                (ok ? '' : '   (기대 CTS=' + wantCts + ' CTO=' + wantCto + ')'));
        }

        await call({ path: BASE, method: 'DELETE' });
        console.log('');
        console.log(fail === 0 ? '전부 통과' : fail + '건 실패');
    } finally {
        srv.kill('SIGKILL');
    }
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error(e); process.exit(1); });
