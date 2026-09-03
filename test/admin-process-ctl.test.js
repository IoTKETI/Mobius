'use strict';
/**
 * Mobius 기동·정지에서 지켜야 할 것들.
 *
 * 되돌릴 수 없는 연산이라 "된다" 보다 **"하지 않는다"** 를 더 많이 못박는다.
 * 특히 남의 프로세스를 죽이지 않는 것.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const cp = require('child_process');

const { ProcessCtl, PID_FILE } = require(path.join(__dirname, '..', 'admin', 'process_ctl.js'));

/** 빈 포트 하나. 실제 Mobius 포트는 절대 쓰지 않는다. */
function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
            const p = s.address().port;
            s.close(() => resolve(p));
        });
    });
}

/** 그 포트를 잡고 버티는 가짜 서버. "남이 띄운 Mobius" 역할이다. */
function fakeServer(port) {
    return new Promise((resolve) => {
        const child = cp.spawn(process.execPath, [
            '-e',
            `require('net').createServer(()=>{}).listen(${port},'127.0.0.1');setInterval(()=>{},1e9);`
        ], { detached: true, stdio: 'ignore' });
        child.unref();
        // 실제로 열릴 때까지 기다린다
        const t0 = Date.now();
        (function wait() {
            const s = net.connect({ host: '127.0.0.1', port });
            s.on('connect', () => { s.destroy(); resolve(child); });
            s.on('error', () => {
                s.destroy();
                if (Date.now() - t0 > 5000) return resolve(child);
                setTimeout(wait, 60);
            });
        }());
    });
}

function tempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'procctl-'));
}
function ctlFor(root, port) {
    return new ProcessCtl({ root, host: '127.0.0.1', port });
}
function status(c) {
    return new Promise((res) => c.status((e, s) => res(s)));
}
function call(c, name) {
    return new Promise((res) => c[name]((err, r) => res({ err, r })));
}

test('돌고 있지 않으면 running=false', async function () {
    const port = await freePort();
    const st = await status(ctlFor(tempRoot(), port));
    assert.strictEqual(st.running, false);
    assert.strictEqual(st.ours, false);
});

test('**남이 띄운 것은 내리지 않는다** — 포트를 쥔 프로세스를 찾아 죽이지 않는다', async function () {
    const port = await freePort();
    const srv = await fakeServer(port);
    const root = tempRoot();
    const c = ctlFor(root, port);
    try {
        const st = await status(c);
        assert.strictEqual(st.running, true, '포트가 열린 것은 본다');
        assert.strictEqual(st.ours, false, '우리가 띄운 것은 아니다');
        assert.strictEqual(st.foreign, true, '남의 것이라고 말한다');

        const { err } = await call(c, 'stop');
        assert.ok(err, '남의 프로세스를 내리려 했다');
        assert.strictEqual(err.code, 'NOT_OURS');

        // 정말 살아 있는지 확인 — 죽였으면 큰일이다
        assert.strictEqual((await status(c)).running, true, '남의 프로세스를 죽였다');
    } finally {
        try { process.kill(srv.pid, 'SIGKILL'); } catch (e) { /* 이미 죽었다 */ }
    }
});

test('이미 떠 있으면 start 하지 않는다', async function () {
    const port = await freePort();
    const srv = await fakeServer(port);
    const c = ctlFor(tempRoot(), port);
    try {
        const { err } = await call(c, 'start');
        assert.ok(err, '이미 떠 있는데 또 띄웠다');
        assert.strictEqual(err.code, 'ALREADY_RUNNING');
    } finally {
        try { process.kill(srv.pid, 'SIGKILL'); } catch (e) { /* */ }
    }
});

test('돌고 있지 않으면 stop 은 NOT_RUNNING', async function () {
    const port = await freePort();
    const { err } = await call(ctlFor(tempRoot(), port), 'stop');
    assert.ok(err);
    assert.strictEqual(err.code, 'NOT_RUNNING');
});

test('낡은 pid 파일이 남의 프로세스를 가리켜도 죽이지 않는다', async function () {
    // 콘솔이 띄웠다가 그 프로세스가 죽고, 같은 포트를 남이 잡은 상황.
    // pid 파일만 믿고 죽이면 엉뚱한 것을 죽인다.
    const port = await freePort();
    const root = tempRoot();
    // 살아 있지 않은 pid 를 적어 둔다
    fs.writeFileSync(path.join(root, PID_FILE), JSON.stringify({
        pid: 999999, port, startedAt: new Date().toISOString()
    }), 'utf8');

    const srv = await fakeServer(port);
    const c = ctlFor(root, port);
    try {
        const st = await status(c);
        assert.strictEqual(st.ours, false, '죽은 pid 를 우리 것이라고 하면 안 된다');
        const { err } = await call(c, 'stop');
        assert.strictEqual(err.code, 'NOT_OURS');
        assert.strictEqual((await status(c)).running, true);
    } finally {
        try { process.kill(srv.pid, 'SIGKILL'); } catch (e) { /* */ }
    }
});

test('pid 파일의 포트가 지금 설정과 다르면 우리 것으로 보지 않는다', async function () {
    // 설정을 바꿔 다른 포트를 보게 됐는데, 옛 pid 파일이 남아 있는 경우.
    const port = await freePort();
    const other = await freePort();
    const root = tempRoot();
    fs.writeFileSync(path.join(root, PID_FILE), JSON.stringify({
        pid: process.pid, port: other, startedAt: new Date().toISOString()
    }), 'utf8');
    const st = await status(ctlFor(root, port));
    assert.strictEqual(st.ours, false, '다른 포트로 기록된 것을 우리 것이라고 했다');
});

test('명령을 conf 에서 받지 않는다 — 실행 파일이 고정이다', function () {
    // 콘솔은 conf 를 화면에서 고칠 수 있다. 실행할 명령을 conf 에 두면
    // 콘솔 비밀번호 하나가 임의 명령 실행이 된다.
    const src = fs.readFileSync(path.join(__dirname, '..', 'admin', 'process_ctl.js'), 'utf8');
    assert.ok(/process\.execPath/.test(src), '실행 파일이 고정이 아니다');
    assert.ok(!/exec\s*\(/.test(src.replace(/execFile|execFileSync/g, '')),
        '셸을 거치는 exec 를 쓰고 있다');
    assert.ok(!/shell\s*:\s*true/.test(src), 'shell:true 를 쓰고 있다');
});

test('pm2 이름이 없으면 detached 모드다', function () {
    const c = new ProcessCtl({ root: tempRoot(), host: '127.0.0.1', port: 1 });
    assert.strictEqual(c.mode(), 'detached');
});

test('띄우고 내리는 한 바퀴 — 콘솔의 자식이 아니다', async function () {
    // 진짜 mobius.js 는 DB 를 잡으므로, 같은 모양의 최소 서버로 확인한다.
    const port = await freePort();
    const root = tempRoot();
    fs.writeFileSync(path.join(root, 'mobius.js'),
        `require('net').createServer(()=>{}).listen(${port},'127.0.0.1');` +
        `setInterval(()=>{},1e9);`, 'utf8');

    const c = ctlFor(root, port);
    const started = await call(c, 'start');
    assert.ok(!started.err, '띄우지 못했다: ' + JSON.stringify(started.err));
    assert.ok(started.r.pid > 0);

    // 실제로 열릴 때까지 잠깐 기다린다
    for (let i = 0; i < 40; i++) {
        if ((await status(c)).running) break;
        await new Promise((r) => setTimeout(r, 100));
    }
    const up = await status(c);
    assert.strictEqual(up.running, true, '띄웠는데 포트가 안 열렸다');
    assert.strictEqual(up.ours, true, '우리가 띄운 것으로 기록돼야 한다');

    // 콘솔의 자식이 아니어야 한다 — detached 로 띄웠으므로 부모는 우리가 아니다
    assert.ok(fs.existsSync(path.join(root, PID_FILE)), 'pid 파일을 남겨야 내릴 수 있다');

    const stopped = await call(c, 'stop');
    assert.ok(!stopped.err, '내리지 못했다: ' + JSON.stringify(stopped.err));
    assert.strictEqual(stopped.r.stopped, true);
    assert.strictEqual((await status(c)).running, false, '내렸는데 포트가 열려 있다');
    assert.ok(!fs.existsSync(path.join(root, PID_FILE)), '내린 뒤 pid 파일을 지워야 한다');
});
