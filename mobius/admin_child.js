'use strict';
/*
 * 관리 콘솔을 Mobius 마스터의 **자식 프로세스**로 띄운다 (conf.adminAutoStart = 'on').
 *
 * 왜 자식 프로세스인가 — 같은 프로세스가 아니라:
 *   마스터는 accept 루프다(리눅스 SCHED_RR — 마스터가 accept 한 뒤 fd 를 워커에 넘긴다).
 *   콘솔의 느린 요청(고아 스캔 조각 5,000행 · 구독 롤업 3,463건)이 마스터 이벤트 루프를
 *   잡으면 워커 24개가 멀쩡해도 **새 연결이 수락되지 않는다.** 그리고 콘솔은 마스터 키
 *   (adminOrigin 기본값 = superUser)를 쥔다 — 프로세스 경계가 곧 권한 경계다.
 *
 * 수명:
 *   - 콘솔이 죽으면 잠깐 뒤 다시 띄운다(워커 재기동과 같은 방어선).
 *   - **기동 직후** 죽으면 다시 띄우지 않는다. adminPassword 없음 · 포트 사용 중 · DB 연결
 *     실패는 다시 띄워도 같은 이유로 죽는다 — 재포크 루프가 곧 좀비다. Mobius 는 계속 돈다.
 *   - 마스터가 사라지면 IPC 채널이 닫히고, 콘솔은 자기 'disconnect' 핸들러로 끝난다
 *     (admin/server.js). pm2 stop 의 SIGINT 는 마스터의 'exit' 핸들러를 거치지 않으므로
 *     채널이 유일하게 믿을 수 있는 신호다. 여기의 'exit' 핸들러는 process.exit() 경로
 *     (포트 충돌·conf 소실로 마스터가 스스로 종료할 때)를 덮는다.
 *
 * fork 는 주입할 수 있다(시험) — 실제 프로세스 없이 종료 정책을 본다. Node 가 정말
 * 'disconnect' 를 주는지는 test/admin-autostart.test.js 의 실물 시험이 본다.
 */
var cp = require('child_process');

var STARTUP_GRACE_MS = 5000;   // 이 안에 죽으면 "설정 문제" 로 보고 다시 띄우지 않는다
var RESTART_DELAY_MS = 1000;   // 워커 재기동(app.js RESPAWN_DELAY_MS)과 같은 수준

exports.start = function (opts) {
    var fork = opts.fork || cp.fork;
    var log = opts.log || console;
    var grace = (opts.startupGraceMs > 0) ? opts.startupGraceMs : STARTUP_GRACE_MS;
    var delay = (opts.restartDelayMs >= 0) ? opts.restartDelayMs : RESTART_DELAY_MS;
    var args = opts.args || [];
    var state = { child: null, stopped: false, starts: 0 };

    function spawn() {
        if (state.stopped) { return; }
        var startedAt = Date.now();
        state.starts += 1;
        var child = fork(opts.script, args, { stdio: 'inherit', windowsHide: true });
        state.child = child;
        log.log('[admin] 관리 콘솔을 자식 프로세스로 띄운다 (pid=' + child.pid + ', backend=' + (args[0] || '-') + ')');

        child.on('error', function (err) {
            // fork 자체의 실패(ENOENT 등). 'exit' 는 안 올 수도 있다 — 여기서 끝낸다.
            state.child = null;
            log.error('[admin] 콘솔을 띄우지 못했다: ' + (err && err.message ? err.message : err) + ' — 다시 띄우지 않는다. Mobius 는 계속 돈다.');
        });
        child.on('exit', function (exitCode, signal) {
            state.child = null;
            if (state.stopped) { return; }
            var lived = Date.now() - startedAt;
            if (lived < grace) {
                log.error('[admin] 콘솔이 기동 직후 죽었다 (code=' + exitCode + ', signal=' + signal + ', ' + lived + 'ms) — ' +
                          '설정 문제다(adminPassword 없음 · 포트 사용 중 · DB 연결 실패). 다시 띄우지 않는다. Mobius 는 계속 돈다.');
                return;
            }
            log.error('[admin] 콘솔이 죽었다 (code=' + exitCode + ', signal=' + signal + ') — ' + delay + 'ms 뒤 다시 띄운다');
            var t = setTimeout(spawn, delay);
            if (t && typeof t.unref === 'function') { t.unref(); }
        });
    }

    function onExit() { if (state.child) { try { state.child.kill(); } catch (e) { /* 이미 죽었다 */ } } }
    process.on('exit', onExit);

    spawn();

    return {
        stop: function () {
            state.stopped = true;
            process.removeListener('exit', onExit);
            onExit();
        },
        current: function () { return state.child; },
        starts: function () { return state.starts; }
    };
};
