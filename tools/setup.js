#!/usr/bin/env node
'use strict';
/**
 * 첫 구동 설정. `npm run setup`.
 *
 *   npm run setup                 conf.json 이 없을 때만 — 일곱을 묻고 파일을 만든다
 *   npm run setup -- --dbpass     DB 비밀번호만 다시 받는다 (파일이 있어도)
 *   npm run setup -- --superuser  수퍼유저 Origin 만 다시 받는다 (파일이 있어도)
 *
 * 뒤의 둘이 "비밀 키는 CLI 로 변경 불가" 의 **유일한 예외**다. 명령줄 인자로 값을 받지
 * 않고 프롬프트로만 받으므로 셸 히스토리에 안 남는다. 콘솔의 비밀(adminPassword·
 * adminOrigin)은 여기서 다루지 않는다.
 *
 * 로드 순서가 mobius.js 와 다르다 — conf.json 이 없기 때문이다.
 *   1. require('./db').backends() 만 먼저 부른다 (pick() 을 부르지 않는다)
 *   2. 답을 받아 global.usedb = 고른 이름
 *   3. 그 뒤에야 conf_schema 와 conf_store 를 require 한다
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

// 비밀 하나를 다시 받는 길. 키마다 라벨과 검사가 다르다.
//   needsBackendKey  그 백엔드의 표에 키가 있어야 한다 (dbpass 는 mysql 만 쓴다)
//   allowEmpty       빈 입력을 그대로 쓸 것인가 (비밀번호 없는 MySQL 은 가능하다;
//                    수퍼유저가 비면 코어가 Sponde 로 떨어지므로 바꾸지 않는다)
var REENTRY = {
    '--dbpass':    { key: 'dbpass',    label: 'DB 비밀번호',    needsBackendKey: true,  allowEmpty: true },
    '--superuser': { key: 'superUser', label: '수퍼유저 Origin', needsBackendKey: false, allowEmpty: false }
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
    var store = new (require('./conf_store').ConfStore)(FILE);   // usedb 뒤에 require
    setup_prompt.askSecret(io, re.label, function (err, value) {
        if (err) { console.error(err.message); process.exit(1); }
        if (!re.allowEmpty && value.trim() === '') {
            console.error('값이 비었다 — 바꾸지 않았다. 봉인도 만들지 않았다.');
            process.exit(1);
        }
        var r = store.setSecret(re.key, value);
        if (!r.ok) { console.error(r.errors.join('\n')); process.exit(1); }
        console.log(re.key + ' 를 바꿨다. 재기동해야 반영된다.' +
                    (re.key === 'superUser'
                        ? ' 이 값으로 도는 운영 도구(관리 콘솔의 adminOrigin 기본값 포함)도 같이 바꿔야 한다 — 아니면 곧바로 403 을 받는다.'
                        : ''));
        process.exit(0);
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
    var store = new (require('./conf_store').ConfStore)(FILE);   // usedb 뒤에 require
    var r = store.create(answers);
    if (!r.ok) { console.error(r.errors.join('\n')); process.exit(1); }
    console.log('\nconf.json 을 만들었습니다: ' + FILE + '\n나머지 설정은 `npm run conf` 로 봅니다.');
    process.exit(0);
});
