'use strict';
// Starts the server, exercises a broad set of response codes and collects the tap's fragments into a snapshot.
//
//   node tools/response-golden/run-scenarios.js tools/response-golden/out/runtime-before.json [sqlite|mysql]
//
// Each case carries an X-Golden-Case header. Resource names are fixed, so paths are the same on every run, and cleanup at start and end makes repeated runs give the same result.

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
const AE = 'golden_ae';                       // fixed name: the same path on every run
const SU = 'Sponde';                          // superuser, so ACPs cannot block the scenarios

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

// Cleanup call without a label (recorded by the tap as '(unlabeled)' and dropped by collect)
function cleanup() {
    return call({ method: 'DELETE', path: CB + '/' + AE });
}

const CASES = [
    // --- Success paths ---
    { case: 'get-cse',        method: 'GET',    path: CB },
    // Express 4 routes HEAD through app.get('*') with request.method still 'HEAD'. It must return 200 like GET, and above all must not kill the worker.
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
    // The two endpoints where the producer names the shape directly.
    { case: 'rcn2-create',    method: 'POST',   path: CB + '/' + AE + '?rcn=2', ct: 'application/json;ty=3',
      body: JSON.stringify({ 'm2m:cnt': { rn: 'c3' } }) },
    { case: 'discovery-rcn4', method: 'GET',    path: CB + '/' + AE + '?fu=2&rcn=4' },

    // --- Failure paths ---
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
    // The gate lets rcn=7 through but retrieve has no shape for it; rejected with a catalogue code.
    { case: 'bad-rcn7-get',   method: 'GET',    path: CB + '/' + AE + '?fu=2&rcn=7' },

    // A CIN into an mni=0 container gives 406 (406-1)
    { case: 'mni-zero-cnt',   method: 'POST',   path: CB + '/' + AE, ct: 'application/json;ty=3',
      body: JSON.stringify({ 'm2m:cnt': { rn: 'c0', mni: 0 } }) },
    { case: 'mni-zero-cin',   method: 'POST',   path: CB + '/' + AE + '/c0', ct: 'application/json;ty=4',
      body: JSON.stringify({ 'm2m:cin': { con: 'x' } }) },

    // The other branch of check_grp: a group whose mid is empty -> the caller answers 403-6 (must come before the AE is deleted)
    { case: 'create-grp-empty', method: 'POST', path: CB + '/' + AE, ct: 'application/json;ty=9',
      body: JSON.stringify({ 'm2m:grp': { rn: 'g0', mt: 3, mnm: 10, mid: [] } }) },
    { case: 'fopt-empty-grp',   method: 'GET',  path: CB + '/' + AE + '/g0/fopt' },

    // --- Cleanup ---
    { case: 'delete-ae',      method: 'DELETE', path: CB + '/' + AE },

    // /fopt on a resource that is not a group: the caller answers 404-4.
    { case: 'fopt-non-group', method: 'GET', path: CB + '/fopt' },

    // POST without Content-Type / broken XML body. Both give 400-4, because check_resource_supported filters first; recorded as such.
    { case: 'no-content-type', method: 'POST', path: CB, body: '{}' },
    { case: 'broken-xml',      method: 'POST', path: CB, ct: 'application/xml;ty=2', body: 'not-xml' },

    // --- Cases that may kill a worker come last ---
    // A case that crashes a worker would leave the following cases without responses and disturb the baseline.
    { case: 'put-la',         method: 'PUT',    path: CB + '/' + AE + '/c1/la', ct: 'application/json',
      body: JSON.stringify({ 'm2m:cin': { con: 'x' } }) }
];

function waitForListen(logFile, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve, reject) {
        (function poll() {
            let log = '';
            try { log = fs.readFileSync(logFile, 'utf8'); } catch (e) { /* not yet */ }
            if (log.indexOf('running at ' + PORT + ' port') >= 0) return resolve();
            if (/Error: listen EADDRINUSE|ECONNREFUSED/.test(log)) return reject(new Error('기동 실패\n' + log.slice(-800)));
            if (Date.now() > deadline) return reject(new Error('기동 타임아웃\n' + log.slice(-800)));
            setTimeout(poll, 300);
        })();
    });
}

(async function () {
    // Clear the tap fragments and the server log
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

        await cleanup();                       // remains of a previous run
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

    // Worker crash detection. The cluster master respawns a dead worker, so requests look successful; only the log reveals a silent crash.
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
