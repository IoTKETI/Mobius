'use strict';
/**
 * `npm run setup -- --superuser` / `--dbpass` re-entry: Enter (empty answer) keeps the value and creates the seal (recreates it if present).
 *
 * Runs a real process because `tools/setup.js` is a top-level script that reads `process.stdin` / `process.stdout` directly and fixes the `conf.json` path relative to its own file, which would touch the real `conf.json` of this repository. Therefore:
 *
 *   1. `tools/setup.js` and `tools/conf_store.js` are copied into a temporary directory that acts as a fake repository root, so `conf.json` / `conf.seal.json` are created only there.
 *   2. `mobius/` must be the real core logic (no duplicate implementation), so the temporary directory gets a directory junction (no admin rights needed) pointing at the real `mobius/`.
 *   3. `tools/setup.js` refuses without a TTY, so a `-r` preload script fakes `process.stdin.isTTY`, `setRawMode` and `process.stdout.isTTY` in the child. readline with `terminal:true` accepts line input with that alone (raw mode is not really engaged, but piped bytes arrive unchanged).
 *
 * The repository's real `conf.json` / `conf.seal.json` are never opened or written by any test.
 *
 * Cleanup: each test removes the temporary directory and the junction in `t.after` (`cleanupSandbox`). The junction is unlinked first, then the rest is removed recursively; in the other order the recursive delete would follow the junction into the real `mobius/`. If both unlink attempts fail, the recursive delete is skipped: a leftover temporary directory is better than the accident.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const conf_seal = require('../mobius/conf_seal');

// Unlinks the junction (T/mobius) before deleting T recursively; in the other order the recursive delete follows the junction into the real mobius/. A Windows directory junction is removed with rmdirSync, a Linux symlink with unlinkSync: try one, then the other. If both fail, T is not deleted.
function cleanupSandbox(T) {
    var link = path.join(T, 'mobius');
    var unlinked = false;
    try { fs.rmdirSync(link); unlinked = true; } catch (e) { /* try the next one */ }
    if (!unlinked) {
        try { fs.unlinkSync(link); unlinked = true; } catch (e) { /* give up below */ }
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
        // If the junction removal recursed into the real mobius/, this file would be gone. Checked every time.
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

// tools/setup.js refuses at the top unless process.stdin is a real TTY. The -r preload fakes the child's own stdin/stdout; readline needs only these two (question()'s output is wrapped by mobius/setup_prompt.js's Prompter in its own proxy, so stdout.setRawMode is not needed).
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
