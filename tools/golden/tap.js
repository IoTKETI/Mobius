'use strict';
// Records the SQL that is executed. Behaviour is unchanged: the original is called as is and only the record is added.
//
// Every SQL passes through the adapter's execute, so only that one place is wrapped.
//
// Every worker is a separate process, so each writes its own pid file; collect.js merges them.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

function install() {
    try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) { /* already exists */ }
    const file = path.join(OUT_DIR, 'sql-' + process.pid + '.jsonl');
    const stream = fs.createWriteStream(file, { flags: 'a' });

    // db.run / db.execRaw all go to mobius/db/<backend>.execute.
    function wrapExecute(mod, backend) {
        if (!mod || typeof mod.execute !== 'function' || mod.__tapped_execute) { return; }
        const orig = mod.execute;
        mod.execute = function (handle, sql, bindings, callback) {
            try {
                stream.write(JSON.stringify({ backend: backend, sql: String(sql) }) + '\n');
            } catch (e) { /* a recording failure must not block the request */ }
            return orig.call(mod, handle, sql, bindings, callback);
        };
        mod.__tapped_execute = true;
    }

    // An adapter that does not exist is skipped silently.
    ['mysql', 'sqlite'].forEach(function (name) {
        try {
            wrapExecute(require('../../mobius/db/' + name), name);
        } catch (e) {
            // no such adapter: normal
        }
    });

    console.log('[sql-tap] 기록 시작 -> ' + file);
}

module.exports = { install: install };
