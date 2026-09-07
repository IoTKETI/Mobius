#!/usr/bin/env node
'use strict';
/**
 * First-run setup. `npm run setup`.
 *
 *   npm run setup                 only without conf.json: asks the seven values and creates the file
 *   npm run setup -- --dbpass     re-enters the DB password only (with an existing file)
 *   npm run setup -- --superuser  re-enters the superuser Origin only (with an existing file)
 *
 * The latter two are the only exception to 'secret keys cannot be changed from the CLI'. Values are taken from a prompt, never from command-line arguments, so they do not land in the shell history. The console's secrets (adminPassword, adminOrigin) are not handled here.
 *
 * The load order differs from mobius.js because conf.json does not exist yet:
 *   1. only require('./db').backends() is called first (pick() is not)
 *   2. the answer sets global.usedb = chosen name
 *   3. only then conf_schema and conf_store are required
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var FILE = path.join(ROOT, 'conf.json');
var io = { stdin: process.stdin, stdout: process.stdout };

if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    console.error('대화형 터미널에서 실행할 것 — 파이프로는 값을 받을 수 없다.');
    process.exit(1);
}

var setup_prompt = require(path.join(ROOT, 'mobius', 'setup_prompt'));
var db = require(path.join(ROOT, 'mobius', 'db'));

// Re-entering one secret. Label and check differ per key.
//   needsBackendKey  the key must exist in that backend's table (dbpass is used by mysql only)
//
// Enter (empty input) keeps the value and only creates the seal (or recreates it); both flags follow the same rule. Setting up a MySQL without a password is possible only in the first-run wizard; on re-entry Enter means keep.
var REENTRY = {
    '--dbpass':    { key: 'dbpass',    label: 'DB 비밀번호',    needsBackendKey: true },
    '--superuser': { key: 'superUser', label: '수퍼유저 Origin', needsBackendKey: false }
};
var flags = Object.keys(REENTRY).filter(function (f) { return process.argv.indexOf(f) >= 0; });
if (flags.length > 1) {
    console.error('한 번에 하나만: ' + flags.join(', '));
    process.exit(1);
}

if (flags.length === 1) {
    var re = REENTRY[flags[0]];
    if (!fs.existsSync(FILE)) {
        console.error('conf.json 이 없다. 먼저 터미널에서 `node mobius.js`(또는 `npm run setup`)로 만들 것.');
        process.exit(1);
    }
    var conf;
    try {
        conf = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        console.error('conf.json 을 읽지 못했다: ' + e.message + '\n덮어쓰지 않는다. 파일을 고칠 것: ' + FILE);
        process.exit(2);
    }
    global.usedb = conf.db || db.backends()[0];
    if (re.needsBackendKey && !db.confSchema()[re.key]) {
        console.error('지금 백엔드(' + global.usedb + ')는 ' + re.key + ' 를 쓰지 않는다.');
        process.exit(1);
    }
    var store = new (require('./conf_store').ConfStore)(FILE);   // required after usedb
    setup_prompt.askSecret(io, re.label, function (err, value) {
        if (err) { console.error(err.message); return process.exit(1); }
        if (value.trim() === '') {
            // Keeps the value and only creates the seal: reseal() re-seals from the values currently in the file, without validation or write.
            var rr;
            try { rr = store.reseal(); }
            catch (e) { console.error(e.message); return process.exit(1); }
            console.log(re.key + ' 는 그대로 두었다. 봉인을 ' + (rr.created ? '만들었다.' : '다시 만들었다.'));
            return process.exit(0);
        }
        var r = store.setSecret(re.key, value);
        if (!r.ok) { console.error(r.errors.join('\n')); return process.exit(1); }
        console.log(re.key + ' 를 바꿨다. 재기동해야 반영된다.' +
                    (re.key === 'superUser'
                        ? ' 이 값으로 도는 운영 도구(관리 콘솔의 adminOrigin 기본값 포함)도 같이 바꿔야 한다 — 아니면 곧바로 403 을 받는다.'
                        : ''));
        return process.exit(0);
    });
    return;
}

if (fs.existsSync(FILE)) {
    console.error('conf.json 이 이미 있다: ' + FILE);
    console.error('나머지 설정은 `npm run conf` 로 본다. 비밀만 다시 넣으려면 `npm run setup -- --dbpass` / `npm run setup -- --superuser`.');
    process.exit(1);
}

setup_prompt.run({
    backends: db.backends(),
    onBackend: function (name) {
        global.usedb = name;
        return { schema: require(path.join(ROOT, 'mobius', 'conf_schema')), needsDbpass: !!db.confSchema().dbpass };
    },
    io: io
}, function (err, answers) {
    if (err) { console.error(err.message); process.exit(1); }
    var store = new (require('./conf_store').ConfStore)(FILE);   // required after usedb
    var r = store.create(answers);
    if (!r.ok) { console.error(r.errors.join('\n')); process.exit(1); }
    console.log('\nconf.json 을 만들었습니다: ' + FILE + '\n나머지 설정은 `npm run conf` 로 봅니다.');
    process.exit(0);
});
