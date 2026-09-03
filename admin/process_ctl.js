'use strict';
/**
 * Mobius 를 띄우고 내린다.
 *
 * **콘솔은 Mobius 의 부모가 되지 않는다.** detached + unref 로 띄우므로 콘솔을
 * 재시작하거나 죽여도 Mobius 는 그대로 돈다. pm2 가 있으면 pm2 에 맡긴다 —
 * 감독은 감독자가 하는 것이 맞다.
 *
 * ── 지키는 것 넷 ──────────────────────────────────────────────────────────
 *
 * 1. **우리가 띄운 것만 내린다.** 포트를 쥔 프로세스를 찾아 죽이지 않는다.
 *    같은 포트에 남의 프로세스가 있을 수 있고, 그걸 죽이면 되돌릴 수 없다.
 *    pid 파일에 우리가 적은 것만 대상으로 하고, 내리기 전에 그 pid 가 살아
 *    있는지와 포트가 실제로 열려 있는지를 함께 본다.
 *
 * 2. **명령 문자열을 conf 에서 받지 않는다.** 콘솔은 conf 를 화면에서 고칠 수
 *    있게 되어 있다. 실행할 명령을 conf 에 두면 **콘솔 비밀번호 하나로 임의
 *    명령 실행**이 된다. 실행 파일은 process.execPath 로 고정하고, pm2 는
 *    이름만 받는다. 셸을 거치지 않는다(execFile/spawn).
 *
 * 3. **인자를 추측하지 않는다.** mobius.js 는 argv[2] 로 백엔드를 받는데,
 *    안 주면 conf.db 를 쓴다. 콘솔이 argv 를 만들면 화면이 보여 주는 설정과
 *    실제 기동이 갈릴 수 있다 — 안 준다.
 *
 * 4. **이미 떠 있으면 띄우지 않는다.** 포트가 열려 있는데 start 하면 새
 *    프로세스가 EADDRINUSE 로 죽고, 그동안 화면은 "시작했다" 고 말한다.
 */

var fs = require('fs');
var net = require('net');
var path = require('path');
var cp = require('child_process');

var PID_FILE = '.mobius-console.pid';
var PROBE_TIMEOUT_MS = 1200;
var STOP_WAIT_MS = 10000;
var STOP_POLL_MS = 250;

/**
 * @param opts.root     Mobius 저장소 경로 (mobius.js 가 있는 곳)
 * @param opts.host     CSE 주소 — 살아 있는지 볼 때 쓴다
 * @param opts.port     CSE 포트
 * @param opts.pm2Name  주어지고 pm2 가 있으면 pm2 에 맡긴다
 */
function ProcessCtl(opts) {
    opts = opts || {};
    this.root = opts.root;
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port;
    this.pm2Name = opts.pm2Name || null;
    this.pidFile = path.join(this.root, PID_FILE);
}

/** 포트가 열려 있는가. 이것이 "돌고 있는가" 의 1차 근거다. */
ProcessCtl.prototype._portOpen = function (cb) {
    if (!(this.port > 0)) { return cb(false); }
    var done = false;
    var sock = net.connect({ host: this.host, port: this.port });
    function finish(v) {
        if (done) { return; }
        done = true;
        try { sock.destroy(); } catch (e) { /* 이미 닫혔다 */ }
        cb(v);
    }
    sock.on('connect', function () { finish(true); });
    sock.on('error', function () { finish(false); });
    sock.setTimeout(PROBE_TIMEOUT_MS, function () { finish(false); });
};

ProcessCtl.prototype._hasPm2 = function () {
    if (!this.pm2Name) { return false; }
    try {
        cp.execFileSync(process.platform === 'win32' ? 'where' : 'which', ['pm2'],
            { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
};

ProcessCtl.prototype.mode = function () {
    return this._hasPm2() ? 'pm2' : 'detached';
};

ProcessCtl.prototype._readPid = function () {
    try {
        var o = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
        return (o && o.pid > 0) ? o : null;
    } catch (e) {
        return null;
    }
};

ProcessCtl.prototype._alive = function (pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return false; }
};

/**
 * 지금 상태.
 *
 * **"우리가 띄웠는가" 와 "돌고 있는가" 를 나눠서 준다.** 포트는 열렸는데
 * 우리 pid 가 아니면 남이 띄운 것이고, 그때는 내리기를 막아야 한다.
 */
ProcessCtl.prototype.status = function (cb) {
    var self = this;
    var rec = this._readPid();
    var ours = !!(rec && this._alive(rec.pid) && rec.port === this.port);
    this._portOpen(function (up) {
        cb(null, {
            running: up,
            port: self.port,
            mode: self.mode(),
            pm2Name: self.pm2Name,
            // 우리가 띄운 것으로 기록돼 있고 그 pid 가 아직 살아 있는가
            ours: ours,
            pid: ours ? rec.pid : null,
            startedAt: ours ? rec.startedAt : null,
            // 포트는 열렸는데 우리 것이 아니다 — 남이 띄웠거나 콘솔이 재시작됐다
            foreign: up && !ours && self.mode() !== 'pm2'
        });
    });
};

ProcessCtl.prototype.start = function (cb) {
    var self = this;
    this.status(function (e, st) {
        if (st.running) {
            return cb({ code: 'ALREADY_RUNNING',
                        message: '이미 떠 있다 (' + self.host + ':' + self.port + ')' });
        }
        if (self.mode() === 'pm2') {
            return self._pm2(['start', self.pm2Name], cb);
        }
        var child;
        try {
            // 콘솔의 자식이 아니다 — detached + unref 로 독립시킨다.
            // 인자를 주지 않는다: mobius.js 가 conf.db 를 보게 둔다.
            child = cp.spawn(process.execPath, ['mobius.js'], {
                cwd: self.root,
                detached: true,
                stdio: 'ignore'
            });
        } catch (err) {
            return cb({ code: 'SPAWN_FAILED', message: String(err.message || err) });
        }
        child.unref();
        try {
            fs.writeFileSync(self.pidFile, JSON.stringify({
                pid: child.pid, port: self.port, startedAt: new Date().toISOString()
            }, null, 2), 'utf8');
        } catch (err) {
            // 기록에 실패하면 나중에 내릴 수 없다. 띄운 것은 사실대로 알린다.
            return cb(null, { started: true, pid: child.pid,
                              warning: 'pid 파일을 쓰지 못했다 — 이 콘솔에서 내릴 수 없다: ' +
                                       String(err.message || err) });
        }
        cb(null, { started: true, pid: child.pid });
    });
};

ProcessCtl.prototype.stop = function (cb) {
    var self = this;
    this.status(function (e, st) {
        if (self.mode() === 'pm2') {
            return self._pm2(['stop', self.pm2Name], cb);
        }
        if (!st.running) {
            return cb({ code: 'NOT_RUNNING', message: '돌고 있지 않다' });
        }
        // **우리가 띄운 것만 내린다.** 포트를 쥔 프로세스를 찾아 죽이지 않는다.
        if (!st.ours) {
            return cb({ code: 'NOT_OURS',
                        message: '이 콘솔이 띄운 프로세스가 아니다. ' +
                                 '포트를 쥔 프로세스를 찾아 죽이지는 않는다 — ' +
                                 '띄운 쪽에서 내려야 한다.' });
        }
        try {
            process.kill(st.pid, 'SIGTERM');
        } catch (err) {
            return cb({ code: 'KILL_FAILED', message: String(err.message || err) });
        }
        // 정말 내려갔는지 확인하고 답한다. SIGTERM 을 보낸 것과 내려간 것은 다르다.
        var waited = 0;
        (function poll() {
            self._portOpen(function (up) {
                if (!up) {
                    try { fs.unlinkSync(self.pidFile); } catch (e2) { /* 없으면 그만 */ }
                    return cb(null, { stopped: true, pid: st.pid, waitedMs: waited });
                }
                waited += STOP_POLL_MS;
                if (waited >= STOP_WAIT_MS) {
                    return cb({ code: 'STILL_UP',
                                message: 'SIGTERM 을 보냈지만 ' + (STOP_WAIT_MS / 1000) +
                                         '초 안에 내려가지 않았다. 강제 종료는 하지 않는다.' });
                }
                setTimeout(poll, STOP_POLL_MS);
            });
        }());
    });
};

/**
 * 내렸다가 띄운다. pm2 는 자기 restart 를 쓴다.
 *
 * 내리기가 실패하면 **띄우지 않는다.** 실패한 채로 start 하면 EADDRINUSE 로
 * 죽고 화면은 "재기동했다" 고 말하게 된다.
 */
ProcessCtl.prototype.restart = function (cb) {
    var self = this;
    if (this.mode() === 'pm2') {
        return this._pm2(['restart', this.pm2Name], cb);
    }
    this.status(function (e, st) {
        if (!st.running) {
            return self.start(function (err, r) {
                if (err) { return cb(err); }
                cb(null, { restarted: true, wasRunning: false, pid: r.pid });
            });
        }
        self.stop(function (err) {
            if (err) { return cb(err); }
            self.start(function (err2, r) {
                if (err2) { return cb(err2); }
                cb(null, { restarted: true, wasRunning: true, pid: r.pid });
            });
        });
    });
};

/** pm2 는 이름만 받는다. 셸을 거치지 않는다. */
ProcessCtl.prototype._pm2 = function (args, cb) {
    cp.execFile('pm2', args, { cwd: this.root, timeout: 30000 }, function (err, stdout, stderr) {
        if (err) {
            return cb({ code: 'PM2_FAILED',
                        message: String((stderr || err.message || err)).slice(0, 500) });
        }
        cb(null, { via: 'pm2', args: args, out: String(stdout).slice(0, 500) });
    });
};

exports.ProcessCtl = ProcessCtl;
exports.PID_FILE = PID_FILE;
