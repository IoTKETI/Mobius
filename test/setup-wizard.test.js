'use strict';
// 첫 구동 마법사 (W1 W2). 프롬프트는 mobius/setup_prompt.js, 코어 연결은 conf_load, 진입점은 tools/setup.js.
//
// **TTY 대역은 실물처럼 군다.** readline 이 terminal:true 로 열면 input.setRawMode(true) 를
// 부르고 close 때 false 로 되돌린다 — 실물 TTY 가 하는 그대로 isRaw 를 토글한다.
// 이 시험 파일은 백엔드를 sqlite 로도 고르므로 표가 굳는다. 다른 시험과 섞지 않는다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const setup_prompt = require('../mobius/setup_prompt');
const conf_load = require('../mobius/conf_load');
const db = require('../mobius/db');

class FakeTty extends PassThrough {
    constructor() { super(); this.isTTY = true; this.isRaw = false; this.columns = 80; }
    setRawMode(v) { this.isRaw = !!v; return this; }
}
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-')); }
function io() {
    const stdin = new FakeTty(), stdout = new FakeTty();
    let seen = '';
    stdout.on('data', (c) => { seen += String(c); });
    return { stdin, stdout, seen: () => seen };
}
// 프롬프트가 나올 때마다 답을 하나씩 준다. 답이 떨어지면 EOF.
function script(t, answers) {
    let i = 0, last = 0;
    t.stdout.on('data', () => {
        const s = t.seen();
        if (s.indexOf('> ', last) < 0) { return; }
        last = s.length;
        setImmediate(() => {
            if (i < answers.length) { t.stdin.write(answers[i++] + '\n'); }
            else { t.stdin.end(); }
        });
    });
}
// 표와 파사드는 require 시점의 global.usedb 로 굳는다(mergeBackendConf · pick 캐시).
// 이 파일은 백엔드를 번갈아 고르므로 고를 때마다 둘의 캐시를 비운다 — conf_load 의
// first_run 도 같은 require 를 지나므로 conf_load 시험 앞에서도 비운다(fresh).
function fresh() {
    delete require.cache[require.resolve('../mobius/db')];
    delete require.cache[require.resolve('../mobius/conf_schema')];
}
function onBackend(name) {
    global.usedb = name;
    fresh();
    const facade = require('../mobius/db');
    return { schema: require('../mobius/conf_schema'), needsDbpass: !!facade.confSchema().dbpass };
}

test('W2 답을 다 받으면 여섯 키 이하의 answers — sqlite 면 dbpass 를 묻지 않는다', function (t, done) {
    const backends = db.backends();
    const t1 = io();
    script(t1, [String(backends.indexOf('sqlite') + 1), 'Vita', '', '//example.com', '']);
    setup_prompt.run({ backends, onBackend, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err, answers) {
        assert.ifError(err);
        assert.deepStrictEqual(answers, { db: 'sqlite', cseBase: 'Vita', cseId: '/Mobius2', spId: '//example.com', csebaseport: '7579' });
        assert.ok(!('dbpass' in answers));
        assert.ok(t1.seen().indexOf('[1] ' + backends[0]) >= 0, '선택지가 backends() 에서 오지 않았다');
        assert.strictEqual(t1.stdin.isRaw, false, 'raw 모드가 안 돌아왔다');
        done();
    });
});

test('W2 유효하지 않은 답은 validHint 를 보이고 같은 항목을 다시 묻는다', function (t, done) {
    const backends = db.backends();
    const t1 = io();
    script(t1, [String(backends.indexOf('sqlite') + 1), 'la', 'Mo/bius', 'Vita', '', '', '99999', '7580']);
    setup_prompt.run({ backends, onBackend, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err, answers) {
        assert.ifError(err);
        assert.strictEqual(answers.cseBase, 'Vita');
        assert.strictEqual(answers.csebaseport, '7580');
        assert.ok(/la\/latest\/ol\/oldest\/fopt/.test(t1.seen()), 'validHint 가 안 보였다');
        done();
    });
});

test('W2 mysql 이면 dbpass 를 묻고 화면에 안 보인다', function (t, done) {
    const backends = db.backends();
    const t1 = io();
    script(t1, [String(backends.indexOf('mysql') + 1), 'hunter2', '', '', '', '']);
    setup_prompt.run({ backends, onBackend, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err, answers) {
        assert.ifError(err);
        assert.strictEqual(answers.dbpass, 'hunter2');
        assert.ok(t1.seen().indexOf('hunter2') < 0, '비밀번호가 화면에 찍혔다');
        assert.ok(t1.seen().indexOf('DB 비밀번호') >= 0, '프롬프트까지 삼켰다 — 음소거를 question() 앞에 켰다');
        done();
    });
});

test('W2 preset(db) 이 있으면 DB 를 묻지 않는다 — node mobius.js <이름> 으로 띄운 경우', function (t, done) {
    const backends = db.backends();
    const t1 = io();
    script(t1, ['', '', '', '']);
    setup_prompt.run({ backends, preset: { db: 'sqlite' }, onBackend, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err, answers) {
        assert.ifError(err);
        assert.strictEqual(answers.db, 'sqlite');
        assert.ok(t1.seen().indexOf('[1]') < 0, 'DB 선택지를 보였다');
        done();
    });
});

test('W1 취소(EOF) — CANCELLED, raw 모드가 돌아온다', function (t, done) {
    const backends = db.backends();
    const t1 = io();
    script(t1, [String(backends.indexOf('sqlite') + 1)]);   // 한 답 뒤 EOF
    setup_prompt.run({ backends, onBackend, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err) {
        assert.ok(err && err.code === 'CANCELLED', '취소가 오류로 오지 않았다');
        assert.strictEqual(t1.stdin.isRaw, false, 'raw 모드가 안 돌아왔다 — 뒤이어 뜬 서버가 Ctrl-C 를 못 받는다');
        done();
    });
});

test('W2 conf_load 가 마법사를 돌려 파일을 만들고 그대로 읽는다', function (t, done) {
    const backends = db.backends();
    const file = path.join(tmpDir(), 'conf.json');
    const t1 = io();
    script(t1, [String(backends.indexOf('sqlite') + 1), 'Vita', '', '', '']);
    fresh();
    conf_load({ file, wizard: true, isPrimary: true, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err, applied) {
        assert.ifError(err);
        assert.ok(fs.existsSync(file), '파일이 안 생겼다');
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.strictEqual(saved.db, 'sqlite');
        assert.strictEqual(saved.cseBase, 'Vita');
        assert.ok(!('dbpass' in saved));
        assert.strictEqual(global.usecsebase, 'Vita');
        assert.strictEqual(applied.cseBase, 'Vita');
        assert.ok(/conf\.json 을 만들었습니다/.test(t1.seen()));
        // 두 번째 기동은 묻지 않는다
        conf_load({ file, wizard: true, isPrimary: true, io: { stdin: new FakeTty(), stdout: new FakeTty() } }, function (err2) {
            assert.ifError(err2);
            done();
        });
    });
});

test('W2 취소하면 파일이 안 생긴다 — 부분 저장 금지', function (t, done) {
    const backends = db.backends();
    const file = path.join(tmpDir(), 'conf.json');
    const t1 = io();
    script(t1, [String(backends.indexOf('sqlite') + 1), 'Vita']);
    fresh();
    conf_load({ file, wizard: true, isPrimary: true, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err) {
        assert.ok(err && err.code === 'CANCELLED');
        assert.strictEqual(fs.existsSync(file), false);
        done();
    });
});

test('W1 (가) 대화형 터미널이 아니면 파일을 만들지 않는다 — stdin·stdout 둘 다 본다', function (t, done) {
    const file = path.join(tmpDir(), 'conf.json');
    const stdinTty = new FakeTty(), stdoutPipe = new PassThrough();   // npm start > log
    conf_load({ file, wizard: true, isPrimary: true, io: { stdin: stdinTty, stdout: stdoutPipe } }, function (err) {
        assert.ok(err && err.code === 'NO_CONF');
        assert.match(err.message, /npm run setup/);
        assert.strictEqual(fs.existsSync(file), false);
        done();
    });
});

test('C10 (나) 워커는 묻지 않는다 — conf.json 이 없으면 NO_CONF', function (t, done) {
    const file = path.join(tmpDir(), 'conf.json');
    const t1 = io();
    conf_load({ file, wizard: true, isPrimary: false, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err) {
        assert.ok(err && err.code === 'NO_CONF');
        assert.strictEqual(t1.seen(), '', '워커가 프롬프트를 냈다');
        assert.strictEqual(fs.existsSync(file), false);
        done();
    });
});

test('C10 mobius.js 는 워커의 NO_CONF 를 EXIT.NO_CONF 로 내고, app.js 마스터가 그것을 보면 재포크하지 않는다', function () {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const m = strip(fs.readFileSync(path.join(ROOT, 'mobius.js'), 'utf8'));
    assert.match(m, /err\.code === 'NO_CONF'/);
    assert.match(m, /EXIT\.NO_CONF/);
    const a = strip(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
    const handler = /cluster\.on\(\s*'exit'[\s\S]{0,1600}?\n\s{8}\}\);/.exec(a)[0];
    assert.match(handler, /EXIT\.NO_CONF/);
});

test('W1 프로세스 수준 — 파이프로 띄우면 매달리지 않고 파일 없이 1 로 끝난다', function () {
    const file = path.join(tmpDir(), 'conf.json');
    const code = 'require(' + JSON.stringify(path.join(ROOT, 'mobius', 'conf_load.js')) + ')({file:' + JSON.stringify(file) +
                 ', wizard:true}, function (err) { if (err) { console.error(err.message); } process.exit(err ? 1 : 0); });';
    const r = spawnSync(process.execPath, ['-e', code], { input: '', encoding: 'utf8', timeout: 10000 });
    assert.strictEqual(r.status, 1, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
    assert.strictEqual(fs.existsSync(file), false);
    assert.match(r.stderr + r.stdout, /npm run setup|conf\.json 이 없/);
});

test('tools/setup.js 는 대화형이 아니면 1 로 끝난다', function () {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'setup.js')], { input: '', encoding: 'utf8', timeout: 10000 });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /대화형/);
});

test('npm 스크립트 — setup', function () {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.scripts.setup, 'node tools/setup.js');
});

test('모르는 argv[2] 로 첫 기동하면 묻기 전에 거부한다 — 마법사의 답을 argv 가 이기는 자기모순을 막는다', function (t, done) {
    const saved = process.argv.slice();
    process.argv[2] = 'postgre';
    const file = path.join(tmpDir(), 'conf.json');
    const t1 = io();
    fresh();
    conf_load({ file, wizard: true, isPrimary: true, io: { stdin: t1.stdin, stdout: t1.stdout } }, function (err) {
        process.argv = saved;
        assert.ok(err && err.code === 'BAD_BACKEND', String(err && err.message));
        assert.match(err.message, /postgre/);
        assert.strictEqual(t1.seen(), '', '묻기 전에 거부해야 한다');
        assert.strictEqual(fs.existsSync(file), false);
        done();
    });
});

test('마법사가 백엔드 이름 리터럴을 들지 않는다 — 선택지는 backends() 가 준다', function () {
    for (const f of ['mobius/setup_prompt.js', 'tools/setup.js']) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')
            .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/['"](mysql|sqlite)['"]/.test(src), f + ' 가 백엔드 이름을 안다');
    }
});
