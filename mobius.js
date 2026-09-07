/**
 * Copyright (c) 2018, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

// Entry point. Loads the configuration, probes the HTTP port (primary only), writes the boot record and starts the CSE core. Process exit happens only in this file.
var cluster = require('cluster');
var conf_load = require('./mobius/conf_load');
var boot_record = require('./mobius/boot_record');
var port_guard = require('./mobius/port_guard');
var EXIT = require('./mobius/exit_codes');

// Workers exit with a dedicated code when conf.json is missing or the seal does not match.
var WORKER_EXIT = { NO_CONF: EXIT.NO_CONF, BAD_SEAL: EXIT.BAD_SEAL };

conf_load(function (err, applied) {
    if (err) {
        console.error(err.message);
        // A worker exiting with one of these codes makes the primary exit with the same code instead of re-forking (app.js cluster.on('exit')). The primary itself exits with 1.
        process.exit((!cluster.isPrimary && WORKER_EXIT[err.code]) ? WORKER_EXIT[err.code] : 1);
        return;
    }
    if (!cluster.isPrimary) { return boot(applied); }

    // Probe the port once, in the primary only, before the boot record is written.
    port_guard.probe(applied.csebaseport, function (state) {
        if (state === 'taken') {
            console.error('[포트] ' + applied.csebaseport + ' 을 이미 누가 쥐고 있다. 종료한다 (code=' + EXIT.PORT_TAKEN + ')');
            process.exit(EXIT.PORT_TAKEN);
            return;
        }
        // 'unknown' (EACCES etc.) is left to the real listen(); port_guard.onListenError handles that error.
        boot(applied);
    });
});

function boot(applied) {
    // Record the applied configuration. Failures are logged and do not stop the boot. The primary truncates the file.
    boot_record.write(applied, { confPath: conf_load.DEFAULT_FILE });
    // CSE core
    require('./app');
}
