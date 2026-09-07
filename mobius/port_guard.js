'use strict';
/**
 * Turns a port conflict into a clean failure instead of a re-fork loop.
 * 
 *   probe()          test bind done once by the primary before workers start
 *   onListenError()  'error' handler for listen(): EADDRINUSE exits with a dedicated code, every other error is re-thrown to backstop
 */
var net = require('net');
var backstop = require('./backstop');
var EXIT = require('./exit_codes');

/** Test bind on the port. No host is given so the same wildcard address as the real listen() is checked. cb('free' | 'taken' | 'unknown'); 'unknown' is any error other than EADDRINUSE. */
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

/** Builds the 'error' handler for listen(). deps.exit is injectable for tests (default backstop.exitAfterFlush). */
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
