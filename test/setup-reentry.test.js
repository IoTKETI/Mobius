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
 *
 * **정리.** 각 시험이 `t.after` 로 임시 디렉터리와 정션을 지운다(`cleanupSandbox`) —
 * 정션 자체를 먼저 끊고 나서야 나머지를 재귀 삭제한다. 순서를 바꾸면 재귀 삭제가 정션을
 * 따라 들어가 진짜 `mobius/` 를 지운다. 끊기가 둘 다 실패하면 재귀 삭제를 하지 않고
 * 넘어간다 — 임시 디렉터리 하나가 남는 편이 사고보다 낫다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const conf_seal = require('../mobius/conf_seal');

// 정션(T/mobius)을 먼저 끊고 나서야 T 를 재귀 삭제한다 — 순서를 바꾸면 재귀 삭제가
// 정션을 **따라 들어가** 진짜 mobius/ 를 지운다(대상이 이 저장소의 실제 코어다).
// Windows 디렉터리 정션은 rmdirSync 로, 리눅스 심링크는 unlinkSync 로 끊는다 — 하나를
// 먼저 시도하고 실패하면 다른 것. **둘 다 실패하면 T 를 지우지 않는다** — 임시 디렉터리
// 하나가 남는 게 실제 mobius/ 를 지우는 사고보다 훨씬 낫다.
function cleanupSandbox(T) {
    var link = path.join(T, 'mobius');
    var unlinked = false;
    try { fs.rmdirSync(link); unlinked = true; } catch (e) { /* 다음 것 시도 */ }
    if (!unlinked) {
        try { fs.unlinkSync(link); unlinked = true; } catch (e) { /* 아래서 포기 */ }
    }
    if (!unlinked) { return; }
    fs.rmSync(T, { recursive: true, force: true });
}

function sandbox(t) {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-reentry-'));
    fs.mkdirSync(path.join(T, 'tools'));
    fs.copyFileSync(path.join(ROOT, 'tools', 'setup.js'), path.join(T, 'tools', 'setup.js'));
    fs.copyFileSync(path.join(ROOT, 'tools', 'conf_store.js'), path.join(T, 'tools', 'conf_store.js'));
    fs.symlinkSync(path.join(ROOT, 'mobius'), path.join(T, 'mobius'), 'junction');
    t.after(function () {
        cleanupSandbox(T);
        // 정션 삭제가 진짜 mobius/ 안으로 재귀했다면 이 파일이 사라져 있을 것이다 —
        // 그 사고를 놓치지 않게 매번 직접 확인한다.
        assert.strictEqual(fs.existsSync(path.join(ROOT, 'mobius', 'conf_seal.js')), true,
            '정션 삭제 사고 — 실제 mobius/conf_seal.js 가 사라졌다');
    });
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

test('reentry --superuser 에 빈 답(Enter) — 값 그대로, 봉인이 생기고 통과, exit 0', function (t) {
    const T = sandbox(t);
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

test('reentry --superuser 를 두 번 빈 답으로 — key 재사용, "다시 만들었다"', function (t) {
    const T = sandbox(t);
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

test('reentry --dbpass 에 빈 답(Enter) — 빈 비밀번호로 바뀌지 않는다, 봉인이 생긴다', function (t) {
    const T = sandbox(t);
    writeConf(T, { db: 'mysql', dbpass: 'hunter2', superUser: 'Sponde' });

    const r = runSetup(T, ['--dbpass'], '\n');
    assert.strictEqual(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
    assert.strictEqual(readConf(T).dbpass, 'hunter2', 'Enter 가 빈 비밀번호를 썼다 — 예전 함정');
    assert.strictEqual(fs.existsSync(sealFile(T)), true, '봉인이 안 생겼다');
    assert.strictEqual(conf_seal.verify(path.join(T, 'conf.json'), readConf(T)).ok, true);
    assert.match(r.stdout, /봉인을 만들었다/);
});

test('reentry 값을 실제로 넣는 길은 그대로 통과한다 — setSecret 경로, 재기동 안내', function (t) {
    const T = sandbox(t);
    writeConf(T, { db: 'mysql', superUser: 'Sponde' });

    const r = runSetup(T, ['--superuser'], 'Vader\n');
    assert.strictEqual(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
    assert.strictEqual(readConf(T).superUser, 'Vader');
    assert.match(r.stdout, /superUser 를 바꿨다/);
    assert.match(r.stdout, /재기동해야 반영된다/);
    assert.strictEqual(conf_seal.verify(path.join(T, 'conf.json'), readConf(T)).ok, true, '값을 바꿨는데 봉인이 안 맞는다');
});
