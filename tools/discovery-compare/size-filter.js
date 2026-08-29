'use strict';
// sza / szb / cty 가 실제로 맞는 결과를 주는지 서버를 띄워 확인한다.
//
//   node tools/discovery-compare/size-filter.js [sqlite|mysql]
//
// 크기가 서로 다른 CIN 을 만들고, 각 필터가 정확히 몇 건을 골라야 하는지
// 계산해서 대조한다.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = process.argv[2] || '';
const HOST = '127.0.0.1', PORT = 7579, CB = '/Mobius';
const AE = 'size_ae';
const SU = 'Sponde';

function call(opt) {
    return new Promise(function (resolve) {
        const headers = {
            'X-M2M-Origin': SU,
            'X-M2M-RI': 's' + Math.floor(Math.random() * 1e9),
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

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitUp() {
    for (let i = 0; i < 120; i++) {
        const r = await call({ path: CB, method: 'GET' });
        if (r.status === 200) { return true; }
        await wait(500);
    }
    return false;
}

// con 의 길이가 곧 cs 다. 길이를 골고루 만든다.
// cnf 는 클라이언트가 준 contentInfo 를 그대로 저장한다.
const CINS = [
    { con: 'a',                cnf: 'text/plain:0' },        // cs 1
    { con: 'abcde',            cnf: 'text/plain:0' },        // cs 5
    { con: 'abcdefghij',       cnf: 'application/json:0' },  // cs 10
    { con: 'x'.repeat(50),     cnf: 'application/json:0' },  // cs 50
    { con: 'y'.repeat(200),    cnf: '' }                     // cs 200
];

async function build() {
    await call({ path: CB, method: 'POST', ty: 2,
        body: { 'm2m:ae': { rn: AE, api: 'a.b.c', rr: true } } });
    await call({ path: CB + '/' + AE, method: 'POST', ty: 3,
        body: { 'm2m:cnt': { rn: 'c1' } } });
    for (const c of CINS) {
        await call({ path: CB + '/' + AE + '/c1', method: 'POST', ty: 4,
            body: { 'm2m:cin': { con: c.con, cnf: c.cnf } } });
    }
}

const BASE = CB + '/' + AE;
// removeTree 가 먼저 지울 하위 경로 (깊은 것부터)
const SUBPATHS = ['/c1'];
const sizes = CINS.map((c) => c.con.length);

// [이름, 질의, 기대 건수]
const CASES = [
    ['필터 없음',            'fu=1&ty=4',                      sizes.length],
    ['sza=10 (10 이상)',     'fu=1&ty=4&sza=10',               sizes.filter((s) => s >= 10).length],
    ['sza=50',               'fu=1&ty=4&sza=50',               sizes.filter((s) => s >= 50).length],
    ['sza=1000 (없음)',      'fu=1&ty=4&sza=1000',             0],
    ['szb=10 (10 미만)',     'fu=1&ty=4&szb=10',               sizes.filter((s) => s < 10).length],
    ['szb=1000 (전부)',      'fu=1&ty=4&szb=1000',             sizes.length],
    ['sza=5 & szb=51',       'fu=1&ty=4&sza=5&szb=51',         sizes.filter((s) => s >= 5 && s < 51).length],
    ['cty=text/plain:0',     'fu=1&ty=4&cty=text/plain:0',     CINS.filter((c) => c.cnf === 'text/plain:0').length],
    ['cty=application/json:0', 'fu=1&ty=4&cty=application/json:0',
        CINS.filter((c) => c.cnf === 'application/json:0').length],
    ['cty 없는 형식',        'fu=1&ty=4&cty=image/png',        0],
    // ty 를 안 줘도 cin 만 걸러진다 (컨테이너는 cs 가 없다)
    ['ty 없이 sza=10',       'fu=1&sza=10',                    sizes.filter((s) => s >= 10).length],
    // 컨테이너를 찾으면서 크기 필터를 주면 아무것도 안 나온다
    ['ty=3 에 sza=1',        'fu=1&ty=3&sza=1',                0]
];


// subtree 삭제는 비동기다 — 지운 뒤 바로 다시 만들면 이전 실행의 자손이
// 남은 채 섞인다 (SQLite 에서 실제로 겪었다: 건수가 실행 횟수만큼 배가 됐다).
// 정말 사라질 때까지 기다린다.
async function removeTree() {
    // AE 가 이미 없어도 그 아래가 고아로 남아 있을 수 있다. 알려진 하위
    // 경로를 먼저 지워 이전 실행의 잔재를 확실히 걷어낸다.
    for (const sub of SUBPATHS) {
        await call({ path: BASE + sub, method: 'DELETE' });
    }
    await call({ path: BASE, method: 'DELETE' });
    for (let i = 0; i < 60; i++) {
        const r = await call({ path: BASE, method: 'GET' });
        if (r.status === 404) { return; }
        await wait(500);
    }
    throw new Error('이전 실행의 트리가 안 지워진다: ' + BASE);
}

async function main() {
    const args = [path.join(ROOT, 'mobius.js')];
    if (BACKEND) { args.push(BACKEND); }
    const logFd = fs.openSync(path.join(__dirname, 'size-filter.log'), 'w');
    const srv = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', logFd, logFd] });

    let fail = 0;
    try {
        if (!await waitUp()) { throw new Error('서버가 뜨지 않았다 (size-filter.log 확인)'); }
        await removeTree();
        await build();
        await wait(500);

        console.log('  CIN 크기: ' + sizes.join(', '));
        console.log('');
        for (const [name, q, want] of CASES) {
            const r = await call({ path: BASE + '?' + q, method: 'GET' });
            let n = -1;
            try { n = (JSON.parse(r.body)['m2m:uril'] || []).length; } catch (e) { /* 무시 */ }
            const ok = r.status === 200 && n === want;
            if (!ok) { fail++; }
            console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name.padEnd(24) +
                ' ' + q.padEnd(34) + ' HTTP ' + r.status + '  ' + n + '건' +
                (ok ? '' : '   (기대 ' + want + '건)'));
        }

        // 마지막 정리도 끝까지 기다린다. 자손 삭제는 백그라운드라, 여기서
        // 바로 서버를 죽이면 자손이 고아로 남아 **다음 실행에 섞인다**
        // (실제로 겪었다: 실행할 때마다 건수가 5 -> 15 -> 20 으로 늘었다).
        await removeTree();
        await wait(2000);
        console.log('');
        console.log(fail === 0 ? '전부 통과' : fail + '건 실패');
    } finally {
        srv.kill('SIGKILL');
    }
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error(e); process.exit(1); });
