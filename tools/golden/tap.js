'use strict';
// db_action.getResult / db_sqlite.getResult 를 감싸 실행되는 SQL 을 기록한다.
// 동작은 바꾸지 않는다 — 원본을 그대로 호출하고 기록만 덧붙인다.
//
// 워커마다 프로세스가 다르므로 pid 별 파일에 쓴다. collect.js 가 합친다.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

function install() {
    try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) { /* 이미 있음 */ }
    const file = path.join(OUT_DIR, 'sql-' + process.pid + '.jsonl');
    const stream = fs.createWriteStream(file, { flags: 'a' });

    function wrap(mod, backend) {
        if (!mod || typeof mod.getResult !== 'function' || mod.__tapped) { return; }
        const orig = mod.getResult;
        mod.getResult = function (query, connection, callback) {
            try {
                stream.write(JSON.stringify({ backend: backend, sql: String(query) }) + '\n');
            } catch (e) { /* 기록 실패가 요청을 막으면 안 된다 */ }
            return orig.call(mod, query, connection, callback);
        };
        mod.__tapped = true;
    }

    wrap(require('../../mobius/db_action'), 'mysql');
    wrap(require('../../mobius/db_sqlite'), 'sqlite');

    console.log('[sql-tap] 기록 시작 -> ' + file);
}

module.exports = { install: install };
