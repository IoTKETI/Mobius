'use strict';
// 서버를 띄우고 응답 코드를 폭넓게 밟은 뒤, 탭이 남긴 조각을 스냅샷으로 모은다.
//
//   node tools/response-golden/run-scenarios.js tools/response-golden/out/runtime-before.json [sqlite|mysql]
//
// 케이스마다 X-Golden-Case 헤더를 붙인다. 리소스 이름은 고정이라 경로가 실행마다
// 같고, 시작과 끝에서 정리하므로 반복 실행해도 같은 결과가 나온다.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'out');
const OUT = process.argv[2];
const BACKEND = process.argv[3] || '';

if (!OUT) {
    console.error('usage: node run-scenarios.js <output.json> [sqlite|mysql]');
    process.exit(1);
}

const HOST = '127.0.0.1', PORT = 7579, CB = '/Mobius';
const AE = 'golden_ae';                       // 고정 이름 — 실행마다 같은 경로
const SU = 'Sponde';                          // 슈퍼유저. ACP 때문에 시나리오가 막히지 않게

function call(opt) {
    return new Promise(function (resolve) {
        const headers = {};
        if (opt.ri !== false) headers['X-M2M-RI'] = 'golden-' + (opt.case || 'x');
        if (opt.origin !== false) headers['X-M2M-Origin'] = opt.origin || SU;
        if (opt.ct) headers['Content-Type'] = opt.ct;
        headers['Accept'] = 'application/json';
        if (opt.case) headers['X-Golden-Case'] = opt.case;

        const req = http.request(
            { hostname: HOST, port: PORT, path: opt.path, method: opt.method, headers: headers },
            function (res) {
                let buf = '';
                res.on('data', function (c) { buf += c; });
                res.on('end', function () {
                    resolve({ status: res.statusCode, rsc: res.headers['x-m2m-rsc'], body: buf });
                });
            });
        req.on('error', function (e) { resolve({ status: 0, rsc: null, body: 'ERR ' + e.message }); });
        req.setTimeout(10000, function () { req.destroy(new Error('timeout')); });
        if (opt.body != null) req.write(opt.body);
        req.end();
    });
}

// 라벨 없이 정리만 하는 호출 (탭에는 '(unlabeled)' 로 남고 collect 가 버린다)
function cleanup() {
    return call({ method: 'DELETE', path: CB + '/' + AE });
}

const CASES = [
    // --- 성공 경로 ---
    { case: 'get-cse',        method: 'GET',    path: CB },
    // Express 4 는 HEAD 를 app.get('*') 로 태우고 request.method 는 'HEAD' 그대로다.
    // 라우트가 request.method 를 게이트 표에 넣었다가 워커가 죽은 적이 있다(066c550).
    // 옛 코드처럼 GET 과 같이 200 이어야 하고, 무엇보다 워커가 죽으면 안 된다.
    { case: 'head-cse',       method: 'HEAD',   path: CB },
    { case: 'create-ae',      method: 'POST',   path: CB, ct: 'application/json;ty=2',
      body: JSON.stringify({ 'm2m:ae': { rn: AE, api: 'Ngolden', rr: true, srv: ['3'] } }) },
    { case: 'get-ae',         method: 'GET',    path: CB + '/' + AE },
    { case: 'create-cnt',     method: 'POST',   path: CB + '/' + AE, ct: 'application/json;ty=3',
      body: JSON.stringify({ 'm2m:cnt': { rn: 'c1' } }) },
    { case: 'create-cin',     method: 'POST',   path: CB + '/' + AE + '/c1', ct: 'application/json;ty=4',
      body: JSON.stringify({ 'm2m:cin': { con: 'golden' } }) },
    { case: 'get-la',         method: 'GET',    path: CB + '/' + AE + '/c1/la' },
    { case: 'discovery',      method: 'GET',    path: CB + '/' + AE + '?fu=1' },
    { case: 'update-cnt',     method: 'PUT',    path: CB + '/' + AE + '/c1', ct: 'application/json',
      body: JSON.stringify({ 'm2m:cnt': { lbl: ['g'] } }) },
    { case: 'rcn0-create',    method: 'POST',   path: CB + '/' + AE + '?rcn=0', ct: 'application/json;ty=3',
      body: JSON.stringify({ 'm2m:cnt': { rn: 'c2' } }) },
    // 생산자가 모양 이름을 직접 주는 종단 중 골든에 없던 둘 (독립 검토 지적)
    { case: 'rcn2-create',    method: 'POST',   path: CB + '/' + AE + '?rcn=2', ct: 'application/json;ty=3',
      body: JSON.stringify({ 'm2m:cnt': { rn: 'c3' } }) },
    { case: 'discovery-rcn4', method: 'GET',    path: CB + '/' + AE + '?fu=2&rcn=4' },

    // --- 실패 경로 ---
    { case: 'dup-ae',         method: 'POST',   path: CB, ct: 'application/json;ty=2',
      body: JSON.stringify({ 'm2m:ae': { rn: AE, api: 'Ngolden', rr: true, srv: ['3'] } }) },
    { case: 'missing-ri',     method: 'GET',    path: CB, ri: false },
    { case: 'missing-origin', method: 'GET',    path: CB, origin: false },
    { case: 'not-found',      method: 'GET',    path: CB + '/no_such_resource_zzz' },
    { case: 'bad-body',       method: 'POST',   path: CB, ct: 'application/json;ty=2', body: 'not-json' },
    { case: 'empty-body',     method: 'POST',   path: CB, ct: 'application/json;ty=2', body: '' },
    { case: 'ty-cb',          method: 'POST',   path: CB, ct: 'application/json;ty=5',
      body: JSON.stringify({ 'm2m:cb': { rn: 'x' } }) },
    { case: 'ty-req',         method: 'POST',   path: CB, ct: 'application/json;ty=17',
      body: JSON.stringify({ 'm2m:req': {} }) },
    { case: 'ty-unknown',     method: 'POST',   path: CB, ct: 'application/json;ty=7777',
      body: JSON.stringify({ 'm2m:ae': { rn: 'x' } }) },
    { case: 'delete-cse',     method: 'DELETE', path: CB },
    { case: 'bad-rcn-get',    method: 'GET',    path: CB + '/' + AE + '?rcn=0' },

    // mni=0 컨테이너에 CIN 을 넣으면 406 이 난다 (406-1)
    { case: 'mni-zero-cnt',   method: 'POST',   path: CB + '/' + AE, ct: 'application/json;ty=3',
      body: JSON.stringify({ 'm2m:cnt': { rn: 'c0', mni: 0 } }) },
    { case: 'mni-zero-cin',   method: 'POST',   path: CB + '/' + AE + '/c0', ct: 'application/json;ty=4',
      body: JSON.stringify({ 'm2m:cin': { con: 'x' } }) },

    // check_grp 의 다른 분기: 그룹이지만 mid 가 비었다 -> 호출부가 403-6 으로 응답
    // (AE 를 지우기 전에 와야 한다)
    { case: 'create-grp-empty', method: 'POST', path: CB + '/' + AE, ct: 'application/json;ty=9',
      body: JSON.stringify({ 'm2m:grp': { rn: 'g0', mt: 3, mnm: 10, mid: [] } }) },
    { case: 'fopt-empty-grp',   method: 'GET',  path: CB + '/' + AE + '/g0/fopt' },

    // --- 정리 ---
    { case: 'delete-ae',      method: 'DELETE', path: CB + '/' + AE },

    // D22: 그룹이 아닌 리소스에 /fopt — check_grp 가 응답을 직접 보내는데 인자가
    // 밀려 있고 request.resourceObj 도 없어 워커가 죽었다. 호출부가 이미 404-4 로
    // 응답하므로 check_grp 의 응답 자체가 중복이었다.
    { case: 'fopt-non-group', method: 'GET', path: CB + '/fopt' },

    // Content-Type 없는 POST / 깨진 XML 본문.
    // 400-20 · 400-5 를 노렸으나 실제로는 둘 다 400-4 가 난다 — 본문을 두 번
    // 파싱하는데(§4.3) 앞선 check_resource_supported 가 먼저 걸러내기 때문이다.
    // 그 사실 자체를 기록으로 남긴다.
    { case: 'no-content-type', method: 'POST', path: CB, body: '{}' },
    { case: 'broken-xml',      method: 'POST', path: CB, ct: 'application/xml;ty=2', body: 'not-xml' },

    // --- 워커를 죽이는 케이스는 반드시 맨 뒤 ---
    // D21: get_target_url 의 la/ol 분기가 callback() 후 return 하지 않아 콜백이 두 번
    // 불린다. 두 번째 호출은 request 가 null 이 된 뒤라 error_result 에서 TypeError 로
    // 워커가 죽는다. 앞에 두면 뒤따르는 케이스가 응답을 못 받아 기준선이 흔들린다.
    { case: 'put-la',         method: 'PUT',    path: CB + '/' + AE + '/c1/la', ct: 'application/json',
      body: JSON.stringify({ 'm2m:cin': { con: 'x' } }) }
];

function waitForListen(logFile, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve, reject) {
        (function poll() {
            let log = '';
            try { log = fs.readFileSync(logFile, 'utf8'); } catch (e) { /* 아직 없음 */ }
            if (log.indexOf('running at ' + PORT + ' port') >= 0) return resolve();
            if (/Error: listen EADDRINUSE|ECONNREFUSED/.test(log)) return reject(new Error('기동 실패\n' + log.slice(-800)));
            if (Date.now() > deadline) return reject(new Error('기동 타임아웃\n' + log.slice(-800)));
            setTimeout(poll, 300);
        })();
    });
}

(async function () {
    // 탭 조각과 서버 로그를 비운다
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.readdirSync(OUT_DIR).filter(function (f) { return /^resp-\d+\.jsonl$/.test(f); })
        .forEach(function (f) { fs.unlinkSync(path.join(OUT_DIR, f)); });

    const logFile = path.join(OUT_DIR, 'server.log');
    const logFd = fs.openSync(logFile, 'w');

    const args = [path.join(__dirname, 'mobius-tapped.js')];
    if (BACKEND) args.push(BACKEND);
    const server = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', logFd, logFd] });

    let failed = null;
    try {
        await waitForListen(logFile, 40000);
        console.error('서버 기동 확인');

        await cleanup();                       // 이전 실행 잔여물
        for (const c of CASES) {
            const r = await call(c);
            console.error('  ' + String(c.case).padEnd(16) + ' -> HTTP ' + r.status + ' rsc ' + (r.rsc || '-'));
        }
        await cleanup();
    } catch (e) {
        failed = e;
    } finally {
        server.kill();
        await new Promise(function (r) { setTimeout(r, 1200); });
        fs.closeSync(logFd);
    }

    if (failed) { console.error(String(failed.message)); process.exit(1); }

    require('./collect').collect(OUT);

    // 워커 크래시 검출. 클러스터 마스터가 죽은 워커를 되살리므로 요청은 성공한 것처럼
    // 보인다. 로그를 봐야만 드러난다 — 조용한 크래시를 놓치지 않으려고 여기서 본다.
    const log = fs.readFileSync(logFile, 'utf8');
    const crashes = log.split('\n').filter(function (l) {
        return /^(TypeError|ReferenceError|RangeError|SyntaxError):/.test(l.trim())
            || /Rethrow non-MySQL errors/.test(l);
    });
    if (crashes.length) {
        console.error('');
        console.error('!! 워커 크래시 ' + crashes.length + '건 (로그: ' + logFile + ')');
        crashes.slice(0, 5).forEach(function (l) { console.error('   ' + l.trim()); });
        process.exitCode = 3;
    } else {
        console.error('워커 크래시 없음');
    }
})();
