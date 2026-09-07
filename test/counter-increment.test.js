'use strict';
// Counter updates on the worker path are relative increments.
//
// With many workers, a worker that overwrites `cni = <read value + 1>` instead of `cni = cni + 1` drops the increments of other workers writing to the same container at the same time. Absolute overwrites are allowed only on the primary-only paths (retention sweep, counter reconciliation) where there is no competitor.
//
// The test finds every statement in sql_action.js that writes cni/cbs as an absolute value and checks that its enclosing function is in the primary-only list. The two worker paths (update_parent_counters, update_parent_by_delete) must use raw('cni + 1') / raw('cni - 1'). It also checks that the primary-only functions are not called from worker paths.

const test = require('node:test');
const assert = require('node:assert');
const sources = require('./lib/sources');

const SQL = sources.code('mobius/sql_action.js');
const LINES = SQL.split('\n');

// line number -> name of the function enclosing it (the last definition passed)
function owner(lineNo) {
    let f = '(top)';
    for (let i = 0; i < lineNo; i++) {
        const m = /^(?:exports\.([A-Za-z_]+)\s*=\s*function|function ([A-Za-z_]+)\s*\()/.exec(LINES[i]);
        if (m) { f = m[1] || m[2]; }
    }
    return f;
}
function linesMatching(re) {
    const out = [];
    LINES.forEach((l, i) => { if (re.test(l)) { out.push(i + 1); } });
    return out;
}

// Where cni/cbs are written as absolute values: primary-only paths only
const MASTER_ONLY = ['delete_oldest', 'update_cnt_cni', 'reconcile_cnt_counters'];

test('cni/cbs 절대값 덮어쓰기는 마스터 전용 함수 안에만 있다', () => {
    const abs = linesMatching(/\.update\(\s*\{\s*cni\s*:/).map((n) => ({ line: n, fn: owner(n) }));
    assert.ok(abs.length >= 3, '절대값 갱신을 ' + abs.length + '곳만 찾았다 — 정규식이 낡았다');
    const outside = abs.filter((a) => MASTER_ONLY.indexOf(a.fn) < 0);
    assert.deepStrictEqual(outside, [], '워커가 부를 수 있는 함수에서 카운터를 덮어쓴다 — 동시 증분이 사라진다');
});

test('워커 경로(CIN 생성·삭제)는 raw 상대 증분이다', () => {
    ['update_parent_counters', 'update_parent_by_delete'].forEach((fn) => {
        const start = linesMatching(new RegExp('^exports\\.' + fn + '\\s*=\\s*function'))[0];
        assert.ok(start, fn + ' 이 없다');
        // The body runs up to the next exports definition
        let end = LINES.length;
        for (let i = start; i < LINES.length; i++) { if (/^exports\.[A-Za-z_]+\s*=\s*function/.test(LINES[i])) { end = i; break; } }
        const body = LINES.slice(start, end).join('\n');
        assert.match(body, /raw\(\s*'cni [+-] 1'\s*\)/, fn + ' 의 cni 가 상대 증분이 아니다');
        assert.match(body, /raw\(\s*'cbs [+-] \?'/, fn + ' 의 cbs 가 상대 증분이 아니다');
        assert.doesNotMatch(body, /cni\s*:\s*(obj|new_|actual_|real_)/, fn + ' 이 절대값을 쓴다');
    });
});

test('마스터 전용 함수는 마스터 경로에서만 불린다', () => {
    // update_cnt_cni is called by reconcile only, delete_oldest by purge_sweep only. A call from app.js or another module would put an absolute update on a worker path.
    const callers = (name) => {
        const inSql = linesMatching(new RegExp('\\b' + name + '\\(')).map((n) => ({ file: 'mobius/sql_action.js', line: n, fn: owner(n) }))
            .filter((c) => c.fn !== name && !new RegExp('^(exports\\.)?' + name + '\\s*=|^function ' + name).test(LINES[c.line - 1]));
        const elsewhere = sources.grep(new RegExp('\\b' + name + '\\('), { scope: 'core', allow: ['mobius/sql_action.js'] });
        return { inSql: inSql.map((c) => c.fn), elsewhere: elsewhere.map((h) => h.file + ':' + h.line) };
    };
    const u = callers('update_cnt_cni');
    assert.deepStrictEqual(u.elsewhere, [], 'update_cnt_cni 를 sql_action 밖에서 부른다');
    assert.deepStrictEqual([...new Set(u.inSql)], ['reconcile_cnt_counters'], 'update_cnt_cni 의 호출부: ' + u.inSql.join(','));
    const d = callers('delete_oldest');
    assert.deepStrictEqual(d.elsewhere, [], 'delete_oldest 를 sql_action 밖에서 부른다');
    assert.ok(d.inSql.length > 0 && d.inSql.every((f) => /purge_sweep|delete_oldest/.test(f)),
        'delete_oldest 의 호출부가 purge_sweep 이 아니다: ' + d.inSql.join(','));
});
