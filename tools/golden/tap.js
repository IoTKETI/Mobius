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

    // 전환된 함수는 db.run -> mobius/db/<backend>.execute 로 간다.
    // 이 경로도 잡아야 전환 전후를 같은 기준으로 비교할 수 있다.
    function wrapExecute(mod, backend) {
        if (!mod || typeof mod.execute !== 'function' || mod.__tapped_execute) { return; }
        const orig = mod.execute;
        mod.execute = function (handle, sql, bindings, callback) {
            try {
                stream.write(JSON.stringify({ backend: backend, sql: String(sql) }) + '\n');
            } catch (e) { /* 기록 실패가 요청을 막으면 안 된다 */ }
            return orig.call(mod, handle, sql, bindings, callback);
        };
        mod.__tapped_execute = true;
    }

    // 파사드 어댑터는 Task 4 이후에만 존재한다. 아직 없으면 조용히 건너뛴다.
    ['mysql', 'sqlite'].forEach(function (name) {
        try {
            wrapExecute(require('../../mobius/db/' + name), name);
        } catch (e) {
            // 아직 파사드가 없음 — 정상
        }
    });

    console.log('[sql-tap] 기록 시작 -> ' + file);
}

module.exports = { install: install };
