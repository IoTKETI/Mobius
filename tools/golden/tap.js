'use strict';
// 실행되는 SQL 을 기록한다. 동작은 바꾸지 않는다 — 원본을 그대로 호출하고
// 기록만 덧붙인다.
//
// 예전에는 두 곳을 감쌌다: 구 경로(db_action.getResult / db_sqlite.getResult)와
// 어댑터의 execute. 전환이 끝나 **모든 SQL 이 어댑터의 execute 를 지나므로**
// 한 곳만 감싼다. 구 경로 두 파일은 삭제됐다.
//
// 워커마다 프로세스가 다르므로 pid 별 파일에 쓴다. collect.js 가 합친다.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

function install() {
    try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) { /* 이미 있음 */ }
    const file = path.join(OUT_DIR, 'sql-' + process.pid + '.jsonl');
    const stream = fs.createWriteStream(file, { flags: 'a' });

    // db.run / db.execRaw 는 전부 mobius/db/<backend>.execute 로 간다.
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
