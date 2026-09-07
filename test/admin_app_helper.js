'use strict';
/**
 * 콘솔 라우트 시험용 부팅.
 *
 * 실제 express 앱을 임시 포트에 띄운다. DB 는 어댑터 대역(execute 를 가로채
 * SQL·bindings 를 기록하고 시험이 준 행을 돌려준다), CSE 는 가짜 HTTP 서버다.
 *
 * 가짜 CSE 는 **관대하지 않다** — X-M2M-RI·X-M2M-Origin·X-M2M-RVI 가 없으면 400, POST 에
 * Content-Type 의 ;ty= 가 없으면 400 을 낸다. 콘솔이 헤더를 빠뜨려도 시험이
 * 초록이면 시험이 거짓말을 하는 것이다.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');

function listen(srv) {
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

function fakeCse(dflt) {
    const calls = [];
    let reply = (dflt === null) ? null : Object.assign({ status: 200, rsc: '2000', body: {} }, dflt || {});
    const srv = http.createServer((req, res) => {
        let s = '';
        req.on('data', (c) => { s += c; });
        req.on('end', () => {
            let body = null;
            try { body = s ? JSON.parse(s) : null; } catch (e) { body = s; }
            const rec = { method: req.method, path: req.url, headers: req.headers, body: body, rejected: false };
            calls.push(rec);
            function refuse(msg) {
                rec.rejected = true;
                res.statusCode = 400; res.setHeader('X-M2M-RSC', '4000'); res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 'm2m:dbg': msg }));
            }
            if (!req.headers['x-m2m-ri'] || !req.headers['x-m2m-origin']) { return refuse('X-M2M-RI / X-M2M-Origin 없음'); }
            if (!req.headers['x-m2m-rvi']) { return refuse('X-M2M-RVI 없음'); }
            if (req.method === 'POST' && !/;ty=\d+/.test(req.headers['content-type'] || '')) { return refuse('Content-Type 에 ty 없음'); }
            const r = (typeof reply === 'function') ? reply(rec) : reply;
            res.statusCode = r.status; res.setHeader('X-M2M-RSC', r.rsc); res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(r.body === undefined ? {} : r.body));
        });
    });
    return { srv, calls, set(r) { reply = r; } };
}

/**
 * @param opts.conf     conf.json 값 (adminPassword 기본 'pw')
 * @param opts.execute  (sql, bindings) → SELECT 행 배열 | { affectedRows } . 던지면 DB 오류가 된다
 * @param opts.cse      가짜 CSE 기본 응답 { status, rsc, body } 또는 (rec) → 그것. null 이면 조회 전용
 * @param opts.dataDir  admin/data 대신 쓸 디렉터리 (기본: 임시)
 */
async function boot(opts) {
    opts = opts || {};
    global.NOPRINT = 'true';
    global.usedb = 'mysql';
    global.usecsebase = 'Mobius'; global.usecseid = '/Mobius2'; global.usespid = '//keti.re.kr';
    global.usesuperuser = 'Sponde';

    ['mobius/db/index.js', 'mobius/db/mysql.js', 'mobius/db/sqlite.js', 'mobius/sql_action.js',
     'mobius/acp_lint.js', 'mobius/acp_simulate.js', 'admin/jobs.js', 'admin/api.js']
        .forEach((p) => { delete require.cache[require.resolve(path.join(ROOT, p))]; });

    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const calls = [];
    adapter.connect = function (cb) { cb('1'); };
    adapter.getConnection = function (cb) { cb('200', { fake: true }); };
    adapter.release = function () {};
    adapter.execute = function (conn, sql, bindings, cb) {
        calls.push({ sql: sql, bindings: bindings });
        let out;
        try { out = opts.execute ? opts.execute(sql, bindings) : []; }
        catch (e) { return cb(e); }
        if (out === undefined) { out = /^\s*select\b/i.test(sql) ? [] : { affectedRows: 0 }; }
        cb(null, out);
    };
    db.connect(function () {});

    const jobs = require(path.join(ROOT, 'admin', 'jobs.js'));
    jobs._reset();

    const conf = Object.assign({ adminPassword: 'pw' }, opts.conf || {});
    let fc = null, cse = null, csePort = 0;
    if (opts.cse !== null) {
        fc = fakeCse(opts.cse);
        csePort = await listen(fc.srv);
        const { Client } = require(path.join(ROOT, 'admin', 'cse.js'));
        cse = new Client({ host: '127.0.0.1', port: csePort, origin: conf.adminOrigin || 'Sponde', timeoutMs: 2000 });
    }
    const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'admin-data-'));

    const ctx = {
        conf: conf,
        password: conf.adminPassword,
        db: db,
        db_sql: require(path.join(ROOT, 'mobius', 'sql_action')),
        responder: require(path.join(ROOT, 'mobius', 'responder')),
        acp_simulate: require(path.join(ROOT, 'mobius', 'acp_simulate')),
        acp_lint: require(path.join(ROOT, 'mobius', 'acp_lint')),
        acp_rules: require(path.join(ROOT, 'mobius', 'acp')),
        expiry_policy: require(path.join(ROOT, 'mobius', 'expiry_policy')),
        jobs: jobs,
        cse: cse,
        cseHost: '127.0.0.1', csePort: csePort, cseOrigin: conf.adminOrigin || 'Sponde', superUser: 'Sponde',
        dataDir: dataDir
    };

    const app = express();
    require(path.join(ROOT, 'admin', 'api.js')).install(app, ctx);
    const srv = http.createServer(app);
    const port = await listen(srv);

    let cookie = '';
    function request(method, p, body) {
        return new Promise((resolve, reject) => {
            const payload = body === undefined ? null : JSON.stringify(body);
            const headers = {};
            if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
            if (cookie) { headers.Cookie = cookie; }
            const req = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: headers }, (res) => {
                let s = '';
                res.on('data', (c) => { s += c; });
                res.on('end', () => {
                    const sc = res.headers['set-cookie'];
                    if (sc && sc.length) { cookie = sc[0].split(';')[0]; }
                    let parsed = s;
                    try { parsed = JSON.parse(s); } catch (e) { /* 텍스트 응답 */ }
                    resolve({ status: res.statusCode, headers: res.headers, body: parsed });
                });
            });
            req.on('error', reject);
            if (payload) { req.write(payload); }
            req.end();
        });
    }

    return {
        app, ctx, calls, cse: fc, dataDir,
        request,
        login: (pw) => request('POST', '/api/login', { password: pw === undefined ? conf.adminPassword : pw }),
        close: () => new Promise((resolve) => { srv.close(() => { if (fc) { fc.srv.close(() => resolve()); } else { resolve(); } }); })
    };
}

module.exports = { boot, fakeCse };
