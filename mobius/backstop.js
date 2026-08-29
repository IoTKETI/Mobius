'use strict';
// 마지막 방어선 — 아무도 잡지 않은 예외를 받는다.
//
// 이것을 넣기 전에 실제 결함들을 먼저 닫았다. 순서가 반대였다면 그 결함들이
// 로그에 묻혀 발견이 늦어졌을 것이다. 백스톱은 원인을 고치는 것이 아니라
// 원인이 남아 있을 때의 피해 범위를 줄이는 것이다.
//
// ── 마스터와 워커를 다르게 다룬다
//
// 마스터(app.js 의 cluster.isMaster 블록)는 요청을 처리하지 않는다.
// 워커를 포크하고, 워커가 죽으면 다시 띄우고, 프로토콜 프록시 3종을
// require 한다. 프록시의 메시지 핸들러가 던지면 **마스터가 죽고 재기동
// 로직까지 함께 사라진다** — 리스닝 포트가 전부 없어진다.
// 실측으로 확인했다: WS 에 1바이트 0xF6.
// 그래서 마스터는 살린다. 요청 상태를 들고 있지 않으므로 살아남는 쪽이
// 명백히 낫다.
//
// 워커는 반대다. 살려 두면 던진 요청이 응답 없이 영원히 매달리고, 그 요청이
// 빌린 DB 커넥션이 풀(워커당 100)에서 영구히 빠진다. 지금은 워커가 죽으면서
// 소켓이 닫혀 MySQL 쪽이 커넥션을 회수하고 cluster 가 다시 띄운다.
// 그 회복 경로가 더 낫다. 그래서 워커는 **진단 정보를 남기고 종료한다** —
// 오늘과 같은 회복, 더 나은 진단.
//
// ── 응답은 쓰지 않는다
//
// 이미 응답한 요청에 두 번째 응답을 쓰면 ERR_HTTP_HEADERS_SENT 로 또 죽는다.
// 여기서는 요청 객체에 접근하지 않는다. mobius/lease.js 의 주석이 같은 이유로
// 장부만 두고 응답에 손대지 않는다고 적고 있다.

var util = require('util');

// 같은 예외가 반복될 때 로그를 덮어쓰지 않도록 접는다.
// 프록시 핸들러가 매 메시지마다 던지면 마스터는 살아남지만 로그가 폭주한다.
var FULL_LOG_LIMIT = 3;          // 같은 메시지를 몇 번까지 스택째 남기는가
var SUMMARY_INTERVAL_MS = 60000; // 그 뒤로는 이 간격마다 한 줄로

var seen = Object.create(null);
var installed = null;

function key(err) {
    if (err == null) { return 'null'; }
    return String(err && err.message ? err.message : err).slice(0, 200);
}

function describe(err) {
    if (err == null) { return 'null (던진 값이 없다)'; }
    if (err.stack) { return err.stack; }
    // throw 'string' 처럼 Error 가 아닌 것을 던진 경우
    return util.inspect(err, { depth: 2 });
}

/**
 * 예외 하나를 기록한다. 로그를 남겼으면 true, 접었으면 false.
 * 종료 여부는 부르는 쪽이 정한다 — 이 함수는 로그만 남긴다.
 */
exports.report = function (role, err, origin, now) {
    var t = (typeof now === 'number') ? now : Date.now();
    var k = key(err);
    var rec = seen[k];

    if (!rec) {
        rec = seen[k] = { count: 0, firstAt: t, lastSummaryAt: 0 };
    }
    rec.count++;

    var head = '[backstop] ' + role + ' pid=' + process.pid +
               ' 잡히지 않은 예외' + (origin ? ' (' + origin + ')' : '');

    if (rec.count <= FULL_LOG_LIMIT) {
        console.error(head + ' — ' + rec.count + '번째\n' + describe(err));
        if (rec.count === FULL_LOG_LIMIT) {
            console.error('[backstop] 같은 예외가 반복된다. 이후로는 ' +
                          (SUMMARY_INTERVAL_MS / 1000) + '초마다 한 줄로만 남긴다: ' + k);
        }
        return true;
    }

    if (t - rec.lastSummaryAt >= SUMMARY_INTERVAL_MS) {
        rec.lastSummaryAt = t;
        console.error(head + ' — 누적 ' + rec.count + '회: ' + k);
        return true;
    }

    return false;
};

/**
 * 프로세스에 백스톱을 건다.
 *
 * @param {string} role   'master' 또는 'worker'
 * @param {object} [deps] 테스트용 주입: { proc, onFatal }
 */
exports.install = function (role, deps) {
    var d = deps || {};
    var proc = d.proc || process;

    if (installed === role && !deps) { return false; }
    installed = role;

    function handle(err, origin) {
        exports.report(role, err, origin);

        if (role === 'worker') {
            // 빌려 둔 커넥션이 무엇이었는지 남긴다. 재기동하면 소켓이 닫혀
            // 회수되지만, 어느 요청이 물고 있었는지는 여기서만 알 수 있다.
            try {
                var lease = require('./lease');
                var s = lease.stats();
                if (s && s.open > 0) {
                    console.error('[backstop] 종료 시점에 빌려 둔 커넥션 ' + s.open + '개 ' +
                                  '(누적 취득 ' + s.opened + ' / 반납 ' + s.closed + ')');
                }
            }
            catch (e) { /* 장부를 못 읽어도 종료는 해야 한다 */ }

            console.error('[backstop] 워커를 종료한다 — cluster 가 다시 띄운다. ' +
                          '살려 두면 이 요청이 응답 없이 매달리고 커넥션이 풀에서 빠진다.');

            if (d.onFatal) { d.onFatal(1); }
            else { proc.exit(1); }
            return;
        }

        // 마스터는 계속 돈다. 죽으면 워커 재기동 로직까지 사라진다.
        console.error('[backstop] 마스터는 계속 돈다. 위 예외는 고쳐야 할 결함이다.');
    }

    proc.on('uncaughtException', function (err, origin) { handle(err, origin); });

    // Node 15 부터 처리되지 않은 거부는 기본이 throw 다 — 위 핸들러로 오기 전에
    // 여기서 받아 같은 규칙으로 다룬다.
    proc.on('unhandledRejection', function (reason) { handle(reason, 'unhandledRejection'); });

    return true;
};

// 테스트용
exports._reset = function () { seen = Object.create(null); installed = null; };
exports._FULL_LOG_LIMIT = FULL_LOG_LIMIT;
exports._SUMMARY_INTERVAL_MS = SUMMARY_INTERVAL_MS;
