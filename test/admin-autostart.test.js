'use strict';
// 관리 콘솔을 Mobius 와 한몸으로 — conf.adminAutoStart = 'on' 이면 마스터가 admin/server.js 를
// 자식 프로세스로 띄우고, 죽으면 다시 띄우고, 마스터가 사라지면 같이 죽는다(사용자 결정 2026-09-07).
//
// 같은 프로세스에 넣지 않는 이유: 마스터는 accept 루프다(SCHED_RR). 콘솔의 느린 요청(고아 스캔
// 조각·구독 롤업)이 마스터 이벤트 루프를 잡으면 워커가 멀쩡해도 새 연결이 안 받아진다.
//
// app.js 는 require 하면 fork 와 listen 이 돌아 직접 부를 수 없다 — 배선은 소스로 본다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');
const { fork } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const schema = require('../mobius/conf_schema');
const conf_load = require('../mobius/conf_load');
const admin_child = require('../mobius/admin_child');

function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function tmpConf(obj) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-'));
    const file = path.join(dir, 'conf.json');
    fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
    return file;
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── 키 ────────────────────────────────────────────────────────────────────
test('adminAutoStart 키 — 콘솔 그룹, on/off, 기본 off, restart, 고급', function () {
    const e = schema.get('adminAutoStart');
    assert.ok(e, '표에 adminAutoStart 가 없다');
    assert.strictEqual(e.group, '콘솔');
    assert.strictEqual(e.type, 'enum');
    assert.deepStrictEqual(e.valid, ['on', 'off']);
    assert.strictEqual(e.dflt, 'off');
    assert.strictEqual(e.apply, 'restart');
    assert.strictEqual(e.tier, undefined, '사용자 키(첫 실행 질문)가 아니다 — 고급 키다');
    assert.ok(e.help.indexOf('adminPassword') >= 0, '도움말이 adminPassword 없이는 안 뜬다는 것을 말해야 한다');
});

test('conf_load 가 adminAutoStart 를 전역과 applied 에 심는다 — 정확히 on 일 때만 on', function (t, done) {
    conf_load({ file: tmpConf({}) }, function (err, applied) {
        assert.ifError(err);
        assert.strictEqual(global.admin_auto_start, 'off');
        assert.strictEqual(applied.adminAutoStart, 'off');
        conf_load({ file: tmpConf({ adminAutoStart: 'on' }) }, function (err2, applied2) {
            assert.ifError(err2);
            assert.strictEqual(global.admin_auto_start, 'on');
            assert.strictEqual(applied2.adminAutoStart, 'on');
            conf_load({ file: tmpConf({ adminAutoStart: 'yes' }) }, function (err3, applied3) {
                assert.ifError(err3);
                assert.strictEqual(applied3.adminAutoStart, 'off', "'on' 이 아닌 값은 전부 off 다");
                done();
            });
        });
    });
});

// ── 자식 프로세스 관리 ────────────────────────────────────────────────────
// fork 를 주입한다 — 실제 프로세스 없이 종료 정책만 본다. 실제 Node 가 그 이벤트를
// 정말 주는지는 아래 '실물' 시험이 본다.
function fakeFork() {
    const calls = [];
    function fk(script, args, opts) {
        const child = new EventEmitter();
        child.pid = 1000 + calls.length;
        child.killed = false;
        child.kill = function () { child.killed = true; };
        calls.push({ script, args, opts, child });
        return child;
    }
    fk.calls = calls;
    return fk;
}
function quietLog() {
    const lines = [];
    return { lines, log: (s) => lines.push('L ' + s), error: (s) => lines.push('E ' + s) };
}

test('start — admin/server.js 를 백엔드 이름과 함께, 출력을 물려받게 띄운다', function () {
    const fk = fakeFork();
    const h = admin_child.start({ script: '/x/admin/server.js', args: ['sqlite'], fork: fk, log: quietLog() });
    try {
        assert.strictEqual(fk.calls.length, 1);
        assert.strictEqual(fk.calls[0].script, '/x/admin/server.js');
        assert.deepStrictEqual(fk.calls[0].args, ['sqlite']);
        assert.strictEqual(fk.calls[0].opts.stdio, 'inherit', '콘솔 로그는 마스터의 stdout(pm2 로그)으로 나가야 한다');
        assert.strictEqual(fk.calls[0].opts.windowsHide, true);
    } finally { h.stop(); }
});

test('기동 직후 죽으면(설정 문제) 다시 띄우지 않는다 — Mobius 는 계속 돈다', async function () {
    const fk = fakeFork();
    const lg = quietLog();
    const h = admin_child.start({ script: 's', args: [], fork: fk, log: lg, startupGraceMs: 200, restartDelayMs: 5 });
    try {
        fk.calls[0].child.emit('exit', 1, null);
        await wait(40);
        assert.strictEqual(fk.calls.length, 1, '다시 띄웠다');
        assert.ok(lg.lines.some((l) => /다시 띄우지 않는다/.test(l)), '사유를 찍어야 한다: ' + lg.lines.join(' | '));
        assert.ok(lg.lines.some((l) => /adminPassword|포트/.test(l)), '무엇을 볼지 알려 줘야 한다');
    } finally { h.stop(); }
});

test('돌다가 죽으면 잠깐 뒤 다시 띄운다', async function () {
    const fk = fakeFork();
    const lg = quietLog();
    const h = admin_child.start({ script: 's', args: ['mysql'], fork: fk, log: lg, startupGraceMs: 10, restartDelayMs: 5 });
    try {
        await wait(30);                       // 유예를 넘긴다
        fk.calls[0].child.emit('exit', null, 'SIGSEGV');
        await wait(40);
        assert.strictEqual(fk.calls.length, 2, '다시 띄우지 않았다');
        assert.deepStrictEqual(fk.calls[1].args, ['mysql']);
        assert.ok(lg.lines.some((l) => /다시 띄운다/.test(l)), lg.lines.join(' | '));
    } finally { h.stop(); }
});

test('stop 은 자식을 죽이고 그 뒤로는 다시 띄우지 않는다', async function () {
    const fk = fakeFork();
    const h = admin_child.start({ script: 's', args: [], fork: fk, log: quietLog(), startupGraceMs: 10, restartDelayMs: 5 });
    await wait(30);
    h.stop();
    assert.strictEqual(fk.calls[0].child.killed, true);
    fk.calls[0].child.emit('exit', null, 'SIGTERM');
    await wait(30);
    assert.strictEqual(fk.calls.length, 1);
});

test('fork 자체가 실패하면(error) 사유를 찍고 다시 띄우지 않는다', async function () {
    const fk = fakeFork();
    const lg = quietLog();
    const h = admin_child.start({ script: 's', args: [], fork: fk, log: lg, startupGraceMs: 10, restartDelayMs: 5 });
    try {
        fk.calls[0].child.emit('error', new Error('spawn ENOENT'));
        await wait(30);
        assert.strictEqual(fk.calls.length, 1);
        assert.ok(lg.lines.some((l) => /ENOENT/.test(l)), lg.lines.join(' | '));
    } finally { h.stop(); }
});

// ── 실물: 부모의 IPC 채널이 닫히면 자식이 스스로 끝난다 ─────────────────────
// admin/server.js 가 거는 것과 같은 한 줄이다. pm2 stop 이 SIGINT 를 보내면 마스터는
// 'exit' 핸들러 없이 죽는다(신호 기본 동작) — 그래도 채널은 닫히므로 이 길이 유일한 정리다.
test('실물 — IPC disconnect 를 받은 자식은 리스너가 있어도 끝난다', async function () {
    const script = "if (process.send) { process.on('disconnect', function () { process.exit(0); }); }\n" +
                   'setInterval(function () {}, 1000);\n' +
                   "process.send('up');\n";
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-child-')), 'child.js');
    fs.writeFileSync(file, script, 'utf8');
    const child = fork(file, [], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
    await new Promise((res) => child.once('message', res));
    const exited = new Promise((res) => child.once('exit', (c) => res(c)));
    child.disconnect();
    const code = await Promise.race([exited, wait(3000).then(() => 'timeout')]);
    assert.strictEqual(code, 0, 'disconnect 뒤 3초 안에 끝나지 않았다');
});

// ── 배선 ──────────────────────────────────────────────────────────────────
test('app.js — 워커를 띄운 뒤, adminAutoStart 가 on 일 때만 콘솔을 띄운다', function () {
    const src = code('app.js');
    const forkLoop = src.indexOf('worker[i] = cluster.fork()');
    const start = src.indexOf('admin_child.start(');
    assert.ok(forkLoop > 0 && start > forkLoop, '콘솔은 워커 다음에 띄운다');
    assert.ok(/global\.admin_auto_start === 'on'/.test(src), 'on 일 때만');
    assert.ok(/admin_child\.start\(\{[\s\S]*?args:\s*\[db\.backendName\(\)\]/.test(src),
        '백엔드 이름을 argv 로 넘긴다(콘솔의 argv[2] 가 conf 를 이긴다) — global.usedb 가 아니라 파사드에게 묻는다');
});

test('admin/server.js — 마스터의 채널이 닫히면 따라 죽는다 (고아 콘솔 금지)', function () {
    const src = code('admin/server.js');
    assert.ok(/process\.send[\s\S]{0,120}process\.on\('disconnect'/.test(src), 'process.send 가 있을 때(자식으로 떴을 때)만 disconnect 를 듣는다');
});
