'use strict';
/**
 * `npm run setup -- --superuser` / `--dbpass` 재입력 — Enter(빈 답)는 값을 그대로
 * 두고 봉인을 만든다(있으면 다시 만든다). 사용자 결정(2026-09-05) — 예전엔
 * `--superuser` 의 Enter 는 거부, `--dbpass` 의 Enter 는 빈 비밀번호를 그대로
 * 썼다(2차 최종 검토 Important 4).
 *
 * **왜 실제 프로세스로 도는가.** `tools/setup.js` 는 최상위 스크립트라 `process.stdin`·
 * `process.stdout` 을 직접 읽고, `conf.json` 경로도 `path.join(__dirname, '..', 'conf.json')`
 * 로 자기 파일 위치 기준으로 고정한다 — 이 저장소 루트의 **실제** `conf.json`(개발용,
 * 이 워크트리에 이미 있다)을 건드릴 위험이 있다는 뜻이다. 그래서:
 *
 *   1. `tools/setup.js`·`tools/conf_store.js` 를 임시 디렉터리로 그대로 복사해 그 디렉터리를
 *      "가짜 저장소 루트" 로 만든다 — 복사본의 `__dirname` 이 임시 디렉터리를 가리키므로
 *      `conf.json`·`conf.seal.json` 도 임시 디렉터리 안에서만 생긴다.
 *   2. `mobius/` 는 실제 코어 로직을 그대로 써야 하므로(중복 구현을 두지 않는다) 임시
 *      디렉터리에 실제 `mobius/` 로 가는 디렉터리 접합점(junction, admin 권한 불필요)을 둔다.
 *   3. TTY 가 아니면 `tools/setup.js` 가 거부하므로, `-r` 프리로드 스크립트로 실제 자식
 *      프로세스의 `process.stdin.isTTY`·`setRawMode`·`process.stdout.isTTY` 를 흉내낸다.
 *      readline 의 `terminal:true` 는 이 흉내만으로 줄 단위 입력을 정상적으로 받는다
 *      (raw 모드 자체가 실제로 걸리지는 않지만, 파이프로 준 바이트는 그대로 들어온다).
 *
 * 이 저장소의 실제 `conf.json`/`conf.seal.json` 은 어떤 시험에서도 열리거나 쓰이지 않는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const conf_seal = require('../mobius/conf_seal');

function sandbox() {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-reentry-'));
    fs.mkdirSync(path.join(T, 'tools'));
    fs.copyFileSync(path.join(ROOT, 'tools', 'setup.js'), path.join(T, 'tools', 'setup.js'));
    fs.copyFileSync(path.join(ROOT, 'tools', 'conf_store.js'), path.join(T, 'tools', 'conf_store.js'));
    fs.symlinkSync(path.join(ROOT, 'mobius'), path.join(T, 'mobius'), 'junction');
    return T;
}
function writeConf(T, obj) {
    fs.writeFileSync(path.join(T, 'conf.json'), JSON.stringify(obj, null, 4), 'utf8');
}
function readConf(T) { return JSON.parse(fs.readFileSync(path.join(T, 'conf.json'), 'utf8')); }
function sealFile(T) { return path.join(T, 'conf.seal.json'); }

// process.stdin 이 진짜 TTY 가 아니면 tools/setup.js 가 최상단에서 거부한다. -r 프리로드로
// 자식 프로세스 자신의 stdin/stdout 을 흉내낸다 — readline 이 필요로 하는 것은 이 둘뿐이다
// (question() 의 output 은 mobius/setup_prompt.js 의 Prompter 가 자기 프록시로 감싸므로
// stdout.setRawMode 는 필요 없다).
function fakeTtyPreload(T) {
    const p = path.join(T, 'faketty.js');
    fs.writeFileSync(p,
        'process.stdin.isTTY = true;\n' +
        'process.stdin.setRawMode = function (v) { return this; };\n' +
        'process.stdout.isTTY = true;\n',
        'utf8');
    return p;
}
function runSetup(T, args, input) {
    return spawnSync(process.execPath,
        ['-r', fakeTtyPreload(T), path.join(T, 'tools', 'setup.js')].concat(args),
        { input: input, encoding: 'utf8', timeout: 10000 });
}

test('reentry --superuser 에 빈 답(Enter) — 값 그대로, 봉인이 생기고 통과, exit 0', function () {
    const T = sandbox();
    writeConf(T, { db: 'mysql', dbpass: 'x', superUser: 'Custom' });
    assert.strictEqual(fs.existsSync(sealFile(T)), false, '시작부터 봉인이 있으면 안 된다');

    const r = runSetup(T, ['--superuser'], '\n');
    assert.strictEqual(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
    assert.strictEqual(readConf(T).superUser, 'Custom', '빈 답인데 값이 바뀌었다');
    assert.strictEqual(readConf(T).dbpass, 'x', '건드리지 않아야 할 키가 바뀌었다');
    assert.strictEqual(fs.existsSync(sealFile(T)), true, '봉인이 안 생겼다');
    assert.strictEqual(conf_seal.verify(path.join(T, 'conf.json'), readConf(T)).ok, true, '봉인이 실제로는 안 맞는다');
    assert.match(r.stdout, /봉인을 만들었다/);
});

test('reentry --superuser 를 두 번 빈 답으로 — key 재사용, "다시 만들었다"', function () {
    const T = sandbox();
    writeConf(T, { db: 'mysql', superUser: 'Sponde' });

    const r1 = runSetup(T, ['--superuser'], '\n');
    assert.strictEqual(r1.status, 0, r1.stderr);
    assert.match(r1.stdout, /봉인을 만들었다/);
    const key1 = JSON.parse(fs.readFileSync(sealFile(T), 'utf8')).key;

    const r2 = runSetup(T, ['--superuser'], '\n');
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /봉인을 다시 만들었다/);
    assert.strictEqual(readConf(T).superUser, 'Sponde', '두 번째도 값이 그대로여야 한다');
    const key2 = JSON.parse(fs.readFileSync(sealFile(T), 'utf8')).key;
    assert.strictEqual(key2, key1, 'key 가 재사용되지 않았다');
    assert.strictEqual(conf_seal.verify(path.join(T, 'conf.json'), readConf(T)).ok, true);
});

test('reentry --dbpass 에 빈 답(Enter) — 빈 비밀번호로 바뀌지 않는다, 봉인이 생긴다', function () {
    const T = sandbox();
    writeConf(T, { db: 'mysql', dbpass: 'hunter2', superUser: 'Sponde' });

    const r = runSetup(T, ['--dbpass'], '\n');
    assert.strictEqual(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
    assert.strictEqual(readConf(T).dbpass, 'hunter2', 'Enter 가 빈 비밀번호를 썼다 — 예전 함정');
    assert.strictEqual(fs.existsSync(sealFile(T)), true, '봉인이 안 생겼다');
    assert.strictEqual(conf_seal.verify(path.join(T, 'conf.json'), readConf(T)).ok, true);
    assert.match(r.stdout, /봉인을 만들었다/);
});

test('reentry 값을 실제로 넣는 길은 그대로 통과한다 — setSecret 경로, 재기동 안내', function () {
    const T = sandbox();
    writeConf(T, { db: 'mysql', superUser: 'Sponde' });

    const r = runSetup(T, ['--superuser'], 'Vader\n');
    assert.strictEqual(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
    assert.strictEqual(readConf(T).superUser, 'Vader');
    assert.match(r.stdout, /superUser 를 바꿨다/);
    assert.match(r.stdout, /재기동해야 반영된다/);
    assert.strictEqual(conf_seal.verify(path.join(T, 'conf.json'), readConf(T)).ok, true, '값을 바꿨는데 봉인이 안 맞는다');
});
