'use strict';
// 주기 작업 둘(보존 정책 스윕 · 카운터 정합)은 마스터에서만 돈다 (요청 흐름 남은 일 §7.4).
//
// CLAUDE.md 가 명시한 역할 분담인데 시험이 없었다. 워커에서 돌기 시작하면 워커 25개가
// 같은 컨테이너를 동시에 정리한다 — 카운터 정합은 절대값 덮어쓰기라(test/counter-increment)
// 워커 경쟁 아래서는 틀린 값을 쓴다. 반대로 마스터에서 요청을 처리하기 시작해도 안 된다.
//
// app.js 의 구조로 본다: `if (cluster.isMaster) {` 블록 안에서만 스케줄되고, 그 뒤의
// 워커 블록·라우트에서는 어느 이름도 부르지 않는다.

const test = require('node:test');
const assert = require('node:assert');
const sources = require('./lib/sources');

const APP = sources.code('app.js').split('\n');

function find(re, from, to) {
    const out = [];
    for (let i = from || 0; i < (to || APP.length); i++) { if (re.test(APP[i])) { out.push(i + 1); } }
    return out;
}

// 마스터 블록의 경계 — 같은 들여쓰기의 `if (cluster.isMaster) {` 와 그 짝 `else {`
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
    // 별칭이 무엇이든(db_sql. · require('./sql_action'). · 다른 이름) 메서드 호출 모양으로 본다 —
    // `db_sql\.` 만 보면 다른 별칭으로 부르는 변이가 살아남았다(2026-09-06 변이로 확인).
    assert.deepStrictEqual([...new Set(find(/\.purge_sweep\s*\(/).map(owner))], ['purge_sweep_tick']);
    assert.deepStrictEqual([...new Set(find(/\.reconcile_cnt_counters\s*\(/).map(owner))], ['reconcile_counters']);
    // 다른 모듈도 부르지 않는다 — 정의와 내부 호출이 있는 sql_action.js 만 뺀다
    const elsewhere = sources.grep(/\.(purge_sweep|reconcile_cnt_counters)\s*\(/, { scope: 'core', allow: ['app.js', 'mobius/sql_action.js'] });
    assert.deepStrictEqual(elsewhere.map((h) => h.file + ':' + h.line), []);
});
