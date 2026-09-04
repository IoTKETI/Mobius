'use strict';
/**
 * 포트 충돌을 좀비 대신 깨끗한 실패로.
 *
 * 이미 포트를 누가 쥔 상태에서 또 띄우면: 워커가 EADDRINUSE 로 uncaught 를 던지고,
 * backstop 이 워커만 죽이고, 마스터가 1초 뒤 재포크해 **무한 반복**한다(실측 12초에
 * 20회 이상). pm2 는 마스터가 안 죽으니 online·재시작 0 으로 본다.
 *
 * 둘로 막는다.
 *   probe()          마스터가 기동 전에 한 번 시험 바인드. **워커가 각자 하면 안 된다** —
 *                    cluster 는 리스닝 소켓을 마스터가 만들어 넘기므로 두 번째 워커부터
 *                    자기 인스턴스가 연 포트를 점유자로 본다.
 *   onListenError()  listen 네 곳의 'error'. EADDRINUSE 만 전용 코드로 나가고 나머지
 *                    (EACCES·EADDRNOTAVAIL)는 다시 던져 지금처럼 backstop 에 맡긴다 —
 *                    backstop 은 워커만 죽이고 마스터를 살린다. 포트 점유가 아닌데
 *                    마스터 분기가 발화하면 없애려던 좀비보다 나쁜 상태가 된다.
 */
var net = require('net');
var backstop = require('./backstop');
var EXIT = require('./exit_codes');

/**
 * 시험 바인드. host 를 주지 않는다 — 실제 listen 이 와일드카드에 바인드하므로
 * 같은 주소를 봐야 한다. cb('free' | 'taken' | 'unknown').
 * 'unknown' 은 EADDRINUSE 가 아닌 오류다 — 판단을 실제 listen 에 맡긴다.
 */
exports.probe = function (port, cb) {
    var done = false;
    function finish(v) { if (done) { return; } done = true; cb(v); }
    var srv = net.createServer();
    srv.once('error', function (err) {
        finish((err && err.code === 'EADDRINUSE') ? 'taken' : 'unknown');
    });
    srv.listen({ port: Number(port) }, function () {
        srv.close(function () { finish('free'); });
    });
};

/**
 * listen 의 'error' 핸들러를 만든다. deps.exit 은 시험용 주입(기본 backstop.exitAfterFlush).
 * fail_start() 를 쓰지 않는다 — 그 3초 지연은 DB 가 늦게 뜨는 경우의 재시도 주기다.
 */
exports.onListenError = function (port, deps) {
    var d = deps || {};
    var exit = d.exit || function (code) { backstop.exitAfterFlush(code); };
    return function (err) {
        if (err && err.code === 'EADDRINUSE') {
            console.error('[포트] ' + port + ' 을 이미 누가 쥐고 있다 — 종료한다 (code=' + EXIT.PORT_TAKEN + ')');
            exit(EXIT.PORT_TAKEN);
            return;
        }
        throw err;
    };
};
