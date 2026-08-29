'use strict';
// discovery 응답을 스냅샷으로 뜬다. 같은 트리를 만들고 같은 질의를 던져
// 두 리비전의 결과를 그대로 비교하기 위한 것이다.
//
//   node tools/discovery-compare/run.js out.json [sqlite|mysql]
//
// 리소스 이름이 고정이라 실행마다 같은 경로가 나오고, 시작과 끝에서
// 지우므로 반복 실행해도 같은 결과가 나온다.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2];
const BACKEND = process.argv[3] || '';
if (!OUT) {
    console.error('usage: node run.js <output.json> [sqlite|mysql]');
    process.exit(1);
}

const HOST = '127.0.0.1', PORT = 7579, CB = '/Mobius';
const AE = 'disc_ae';
const SU = 'Sponde';

function call(opt) {
    return new Promise(function (resolve) {
        const headers = {
            'X-M2M-Origin': opt.org || SU,
            'X-M2M-RI': 'd' + Math.floor(Math.random() * 1e9),
            'Accept': 'application/json'
        };
        let body = null;
        if (opt.body != null) {
            body = typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body);
            headers['Content-Type'] = 'application/json' + (opt.ty ? ';ty=' + opt.ty : '');
            headers['Content-Length'] = Buffer.byteLength(body);
        }
        const req = http.request(
            { host: HOST, port: PORT, path: opt.path, method: opt.method, headers: headers },
            function (res) {
                let buf = '';
                res.on('data', function (c) { buf += c; });
                res.on('end', function () {
                    resolve({ status: res.statusCode, body: buf });
                });
            });
        req.on('error', function (e) { resolve({ status: 0, body: String(e.message) }); });
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

// ── 만들 트리 ────────────────────────────────────────────────────────────────
// disc_ae
//   ├ cntA        lbl ["tagX"]
//   │   ├ cin x3
//   │   └ cntA1                lbl ["tagY"]
//   │        ├ cin x2
//   │        └ cntA2           lbl ["tagX"]
//   │             └ cin x2
//   └ cntB        lbl ["tagY"]
//        └ cin x1
async function build() {
    await call({ path: CB, method: 'POST', ty: 2,
        body: { 'm2m:ae': { rn: AE, api: 'a.b.c', rr: true } } });

    const mk = async function (parent, rn, lbl) {
        await call({ path: parent, method: 'POST', ty: 3,
            body: { 'm2m:cnt': { rn: rn, lbl: lbl } } });
        return parent + '/' + rn;
    };
    const cin = async function (parent, n) {
        for (let i = 0; i < n; i++) {
            await call({ path: parent, method: 'POST', ty: 4,
                body: { 'm2m:cin': { con: 'v' + i } } });
        }
    };

    const a = await mk(CB + '/' + AE, 'cntA', ['tagX']);
    await cin(a, 3);
    const a1 = await mk(a, 'cntA1', ['tagY']);
    await cin(a1, 2);
    const a2 = await mk(a1, 'cntA2', ['tagX']);
    await cin(a2, 2);
    const b = await mk(CB + '/' + AE, 'cntB', ['tagY']);
    await cin(b, 1);
}

const BASE = CB + '/' + AE;
const CASES = [
    ['all',              BASE + '?fu=1'],
    ['ty3',              BASE + '?fu=1&ty=3'],
    ['ty4',              BASE + '?fu=1&ty=4'],
    ['ty3-lvl1',         BASE + '?fu=1&ty=3&lvl=1'],
    ['ty3-lvl2',         BASE + '?fu=1&ty=3&lvl=2'],
    ['ty3-lvl3',         BASE + '?fu=1&ty=3&lvl=3'],
    ['lvl1',             BASE + '?fu=1&lvl=1'],
    ['lvl2',             BASE + '?fu=1&lvl=2'],
    ['ty3-lim2',         BASE + '?fu=1&ty=3&lim=2'],
    ['ty3-lim2-ofst1',   BASE + '?fu=1&ty=3&lim=2&ofst=1'],
    ['ty3-lim2-ofst2',   BASE + '?fu=1&ty=3&lim=2&ofst=2'],
    ['ty3-ofst99',       BASE + '?fu=1&ty=3&ofst=99'],
    ['ty4-lim3',         BASE + '?fu=1&ty=4&lim=3'],
    ['ty4-lim3-ofst3',   BASE + '?fu=1&ty=4&lim=3&ofst=3'],
    ['lbl-tagX',         BASE + '?fu=1&lbl=tagX'],
    ['lbl-tagY',         BASE + '?fu=1&lbl=tagY'],
    ['ty3-lbl-tagX',     BASE + '?fu=1&ty=3&lbl=tagX'],
    ['rn-cntA1',         BASE + '?fu=1&rn=cntA1'],
    ['ty3-rn-cntB',      BASE + '?fu=1&ty=3&rn=cntB'],
    ['cra-past',         BASE + '?fu=1&ty=3&cra=20000101T000000'],
    ['crb-future',       BASE + '?fu=1&ty=3&crb=20990101T000000'],
    ['crb-past',         BASE + '?fu=1&ty=3&crb=20000101T000000'],
    ['rcn4',             BASE + '?fu=1&rcn=4&ty=3'],
    ['from-cnt',         BASE + '/cntA?fu=1&ty=3'],
    ['from-cnt-ty4',     BASE + '/cntA?fu=1&ty=4'],
    ['from-cnt-lvl1',    BASE + '/cntA?fu=1&ty=3&lvl=1'],
    ['cse-ty2',          CB + '?fu=1&ty=2'],
    ['la-cnt',           BASE + '/cntA/la'],
    ['ol-cnt',           BASE + '/cntA/ol']
];

function normalize(status, body) {
    let j;
    try { j = JSON.parse(body); } catch (e) { return { status: status, raw: body.slice(0, 200) }; }
    if (j['m2m:uril']) {
        // 순서는 보장 대상이 아니다 — 집합으로 비교한다.
        return { status: status, uril: j['m2m:uril'].slice().sort() };
    }
    if (j['m2m:agr'] || j['m2m:rsp']) {
        const arr = j['m2m:agr'] || j['m2m:rsp'];
        return { status: status, kind: 'agr', n: Array.isArray(arr) ? arr.length : 1 };
    }
    if (j['m2m:cin']) { return { status: status, cin_rn: j['m2m:cin'].rn, con: j['m2m:cin'].con }; }
    if (j['m2m:dbg']) { return { status: status, dbg: j['m2m:dbg'] }; }
    return { status: status, keys: Object.keys(j) };
}

async function main() {
    // 진입점은 mobius.js 다. 백엔드는 argv[2] 로 넘긴다
    // (tools/response-golden/run-scenarios.js 와 같은 방식).
    const args = [path.join(ROOT, 'mobius.js')];
    if (BACKEND) { args.push(BACKEND); }
    const logFd = fs.openSync(path.join(__dirname, 'server.log'), 'w');
    const srv = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', logFd, logFd] });

    let crashed = 0;
    srv.on('exit', function () { crashed++; });

    try {
        if (!await waitUp()) { throw new Error('서버가 뜨지 않았다 (server.log 확인)'); }
        await call({ path: BASE, method: 'DELETE' });
        await wait(1500);
        await build();
        await wait(500);

        const out = {};
        for (const [name, url] of CASES) {
            const r = await call({ path: url, method: 'GET' });
            out[name] = normalize(r.status, r.body);
            const n = out[name].uril ? out[name].uril.length : '-';
            console.log('  ' + name.padEnd(18) + ' HTTP ' + r.status + '  ' + n + '건');
        }

        await call({ path: BASE, method: 'DELETE' });
        fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
        console.log('케이스 ' + CASES.length + '개 -> ' + OUT);
        console.log(crashed ? '워커 크래시 ' + crashed : '워커 크래시 없음');
    } finally {
        srv.kill('SIGKILL');
    }
}

main().catch(function (e) { console.error(e); process.exit(1); });
