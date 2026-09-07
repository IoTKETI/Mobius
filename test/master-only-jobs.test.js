'use strict';
// The two periodic jobs (retention sweep, counter reconcile) run only in the master.
//
// Running in workers would make 25 workers clean the same container concurrently; counter reconcile writes absolute values (test/counter-increment) and produces wrong values under worker contention. Conversely the master must not handle requests.
//
// Checked through the structure of app.js: scheduled only inside the `if (cluster.isMaster) {` block, and neither name is called in the worker block or routes after it.

const test = require('node:test');
const assert = require('node:assert');
const sources = require('./lib/sources');

const APP = sources.code('app.js').split('\n');

function find(re, from, to) {
    const out = [];
    for (let i = from || 0; i < (to || APP.length); i++) { if (re.test(APP[i])) { out.push(i + 1); } }
    return out;
}

// Boundaries of the master block: `if (cluster.isMaster) {` and its matching `else {` at the same indentation.
const M = find(/^    if \(cluster\.isMaster\) \{/)[0];
const W = find(/^    else \{$/, M)[0];

test('마스터 블록이 하나 있고 그 짝 else(워커 블록)가 뒤따른다', () => {
    assert.ok(M > 0 && W > M, 'isMaster 블록 경계를 못 찾았다: ' + M + ', ' + W);
    assert.strictEqual(find(/cluster\.isMaster/).length, 1, 'isMaster 분기가 한 곳이 아니다');
    assert.ok(find(/backstop\.install\('master'\)/, M, W).length === 1, '마스터 블록에 backstop(master) 가 없다');
    assert.ok(find(/backstop\.install\('worker'\)/, W).length === 1, '워커 블록에 backstop(worker) 가 없다');
});

test('스윕과 정합의 setInterval 은 마스터 블록 안에 한 번씩이다', () => {
    const sweep = find(/setInterval\(\s*purge_sweep_tick/);
    const recon = find(/setInterval\(\s*reconcile_counters/);
    assert.deepStrictEqual([sweep.length, recon.length], [1, 1], 'setInterval 이 한 번씩이 아니다: ' + sweep + ' / ' + recon);
    [sweep[0], recon[0]].forEach((n) => assert.ok(n > M && n < W, n + '행의 setInterval 이 마스터 블록 밖이다 [' + M + ', ' + W + ']'));
});

test('워커 블록과 라우트에서는 스윕·정합을 부르지 않는다', () => {
    const names = /\b(purge_sweep_tick|reconcile_counters|db_sql\.purge_sweep|db_sql\.reconcile_cnt_counters)\s*\(/;
    const inWorker = find(names, W);
    assert.deepStrictEqual(inWorker, [], '워커 블록 뒤에서 주기 작업을 부른다 (행): ' + inWorker.join(','));
});

test('db_sql.purge_sweep / reconcile_cnt_counters 는 각자의 tick 함수 안에서만 불린다', () => {
    function owner(lineNo) {
        let f = '(top)';
        for (let i = 0; i < lineNo; i++) {
            const m = /^function ([A-Za-z_]+)\s*\(/.exec(APP[i]);
            if (m) { f = m[1]; }
        }
        return f;
    }
    // Matched as a method call regardless of the alias (db_sql., require('./sql_action')., or another name); matching `db_sql\.` alone lets a call through another alias survive.
    assert.deepStrictEqual([...new Set(find(/\.purge_sweep\s*\(/).map(owner))], ['purge_sweep_tick']);
    assert.deepStrictEqual([...new Set(find(/\.reconcile_cnt_counters\s*\(/).map(owner))], ['reconcile_counters']);
    // No other module calls them either; only sql_action.js, which holds the definitions and internal calls, is excluded.
    const elsewhere = sources.grep(/\.(purge_sweep|reconcile_cnt_counters)\s*\(/, { scope: 'core', allow: ['app.js', 'mobius/sql_action.js'] });
    assert.deepStrictEqual(elsewhere.map((h) => h.file + ':' + h.line), []);
});
