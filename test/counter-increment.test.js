'use strict';
// 워커 경로의 카운터 갱신은 상대 증분이다 (요청 흐름 남은 일 §7.4 — CLAUDE.md 의 불변식인데 시험이 없었다).
//
// 워커가 24개다. CIN 을 만들거나 지운 워커가 `cni = cni + 1` 이 아니라 `cni = <읽은 값 + 1>`
// 로 덮어쓰면, 같은 컨테이너에 동시에 쓴 다른 워커의 증분이 사라진다. 절대값 덮어쓰기는
// 경쟁자가 없는 **마스터 단독** 경로(보존 정책 스윕 · 카운터 정합)에서만 허용된다.
//
// 이 시험은 sql_action.js 에서 cni/cbs 를 절대값으로 쓰는 문장을 전부 찾아, 그 소속 함수가
// 마스터 전용 목록 안인지 본다. 워커 경로 둘(update_parent_counters · update_parent_by_delete)
// 은 raw('cni + 1') / raw('cni - 1') 꼴이어야 한다. 마스터 전용 함수가 워커 경로에서
// 불리지 않는지(호출부의 소속)도 본다.

const test = require('node:test');
const assert = require('node:assert');
const sources = require('./lib/sources');

const SQL = sources.code('mobius/sql_action.js');
const LINES = SQL.split('\n');

// 줄 번호 → 그 줄을 감싸는 함수 이름 (마지막으로 지나온 정의)
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

// 절대값으로 cni/cbs 를 쓰는 곳 — 마스터 단독 경로만
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
        // 다음 exports 정의 전까지가 몸통
        let end = LINES.length;
        for (let i = start; i < LINES.length; i++) { if (/^exports\.[A-Za-z_]+\s*=\s*function/.test(LINES[i])) { end = i; break; } }
        const body = LINES.slice(start, end).join('\n');
        assert.match(body, /raw\(\s*'cni [+-] 1'\s*\)/, fn + ' 의 cni 가 상대 증분이 아니다');
        assert.match(body, /raw\(\s*'cbs [+-] \?'/, fn + ' 의 cbs 가 상대 증분이 아니다');
        assert.doesNotMatch(body, /cni\s*:\s*(obj|new_|actual_|real_)/, fn + ' 이 절대값을 쓴다');
    });
});

test('마스터 전용 함수는 마스터 경로에서만 불린다', () => {
    // update_cnt_cni 는 reconcile 만, delete_oldest 는 purge_sweep 만 부른다.
    // app.js 나 다른 모듈이 부르면 워커 경로에 절대값 갱신이 생긴다.
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
