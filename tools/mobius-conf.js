#!/usr/bin/env node
'use strict';
/**
 * conf CLI 진입점. `npm run conf` / `npm run status`.
 *
 * 하는 일은 로드 순서를 지키고 deps 를 채우는 것뿐이다. 논리는 tools/conf_cli.js.
 *
 *   1. conf.json 을 읽는다 (없으면 {} — 읽기는 기본값으로 답한다. 깨졌으면 덮어쓰지 않고 종료)
 *   2. global.usedb 를 세운다 — **process.argv[2] 는 하위 명령이다. 읽지 않는다.**
 *   3. 그제서야 conf_schema · conf_store 를 require 한다 (표가 백엔드를 따라간다)
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var FILE = path.join(ROOT, 'conf.json');

var conf = {};
if (fs.existsSync(FILE)) {
    try {
        conf = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        console.error('[conf] conf.json 을 읽지 못했다: ' + ((e && e.message) || e));
        console.error('[conf] 덮어쓰지 않는다. 파일을 고칠 것: ' + FILE);
        process.exit(2);
    }
}

var argv = process.argv.slice(2);
var cli = require('./conf_cli');
global.usedb = cli.resolveBackend(argv, conf);

var schema = require(path.join(ROOT, 'mobius', 'conf_schema'));
var conf_store = require('./conf_store');
var boot_record = require(path.join(ROOT, 'mobius', 'boot_record'));

var args = argv.filter(function (a) { return a.indexOf('--db=') !== 0 && a !== '--all'; });

cli.main(args, {
    schema: schema,
    store: new conf_store.ConfStore(FILE),
    conf: conf,
    readRecord: function () { return boot_record.read(); },
    alive: function (pid) { try { process.kill(pid, 0); return true; } catch (e) { return false; } },
    probePort: cli.probePort,
    pm2List: cli.pm2List,
    sealStatus: function () { return fs.existsSync(FILE) ? require(path.join(ROOT, 'mobius', 'conf_seal')).verify(FILE, conf) : null; },
    io: { stdin: process.stdin, stdout: process.stdout, isTTY: !!(process.stdin.isTTY && process.stdout.isTTY) },
    all: argv.indexOf('--all') >= 0
}, function (err, code) {
    if (err) { console.error(err.message || err); process.exit(1); }
    process.exit(code);
});
