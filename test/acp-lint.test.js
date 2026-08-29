'use strict';
// 이미 저장된 ACP 와 acpi 를 점검한다.
//
// 가드레일은 새로 쓰는 값만 막는다. 이미 저장된 잘못된 값은 그대로 남아
// HTTP 500 이나 조용한 거부를 계속 낸다 — 배포에도 dangling 이 한 건 있다.
// 린터는 아무것도 고치지 않는다. 목록만 돌려준다.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-acp-lint-test.db');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//ketiabc.com';
global.usesuperuser = 'Sponde';
global.useaccesscontrolpolicy = 'disable';

const acp_lint = require('../mobius/acp_lint');

// 심어 둔 select 결과를 순서대로 돌려주는 어댑터.
function tap(selectRows) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'acp_lint.js'))];

    global.usesqlite = 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    let i = 0;
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        const rows = (selectRows && selectRows[i] !== undefined) ? selectRows[i] : [];
        i++;
        cb(null, rows);
    };
    db.connect('h', 1, 'u', 'p', function () {});
    return { lint: require(path.join(__dirname, '..', 'mobius', 'acp_lint.js')), seen: seen };
}

const lookupRow = (rn) => ({ ri: '/Mobius/' + rn, pi: '/Mobius', rn: rn,
                             ct: '20260829T000000', lt: '20260829T000000', et: '20991231T000000', acpi: '[]' });

// ── 규칙 판정 (순수) ──────────────────────────────────────────────────

function rules(raw, attr) {
    return acp_lint._problems_of(raw, attr || 'pv', '/M/x').map((p) => p.rule);
}

test('읽을 수 없는 pv 는 parse_error 다', function () {
    assert.deepStrictEqual(rules('{not json'), ['parse_error']);
});

test('pv:{} 는 acr_missing_or_empty 다 — 뒤 ACP 를 가린다', function () {
    assert.deepStrictEqual(rules('{}'), ['acr_missing_or_empty']);
});

test('acop 이 없으면 acop_invalid — 요청이 HTTP 500 이 된다', function () {
    assert.deepStrictEqual(rules(JSON.stringify({ acr: [{ acor: ['C'] }] })), ['acop_invalid']);
});

test('actw 가 6자리가 아니면 actw_bad_arity 다', function () {
    const v = JSON.stringify({ acr: [{ acor: ['C'], acop: 63, acco: [{ actw: ['* * * * *'] }] }] });
    assert.deepStrictEqual(rules(v), ['actw_bad_arity']);
});

test('정상 pv 는 문제가 없다', function () {
    assert.deepStrictEqual(rules(JSON.stringify({ acr: [{ acor: ['C'], acop: 63 }] })), []);
});

test('경고는 severity 가 warn 이고 거부 사유와 섞이지 않는다', function () {
    const v = JSON.stringify({ acr: [{ acor: ['S.*'], acop: 0 }] });
    const p = acp_lint._problems_of(v, 'pv', '/M/x');
    assert.deepStrictEqual(p.map((x) => x.severity), ['warn', 'warn']);
    assert.deepStrictEqual(p.map((x) => x.rule).sort(), ['acop_zero', 'acor_looks_like_regex']);
});

test('pvs 에 관리자가 없으면 경고한다', function () {
    const v = JSON.stringify({ acr: [{ acor: ['Cteam'], acop: 63 }] });
    assert.ok(rules(v, 'pvs').includes('pvs_no_admin'));
    assert.ok(!rules(v, 'pv').includes('pvs_no_admin'));
});

test('본문이 없으면 body_missing 이다', function () {
    assert.deepStrictEqual(rules(null), ['body_missing']);
    assert.deepStrictEqual(rules(undefined), ['body_missing']);
});

test('절대 던지지 않는다', function () {
    for (const v of [0, '', [], '[]', '{"acr":null}', '"문자열"']) {
        assert.doesNotThrow(() => acp_lint._problems_of(v, 'pv', '/M/x'));
    }
});

// ── lint_acp (DB) ─────────────────────────────────────────────────────

test('acp 행이 없는 ACP 를 잡는다 — 잠금이 조용히 풀린다', function (t, done) {
    // 질의 1: select_acp_list, 질의 2: select_acp_in
    const h = tap([[lookupRow('a_half')], []]);
    h.lint.lint_acp(null, {}, function (err, res) {
        assert.ok(!err, JSON.stringify(res));
        assert.strictEqual(res.counts.error, 1);
        assert.deepStrictEqual(res.rows[0].problems.map((p) => p.rule), ['body_missing']);
        done();
    });
});

test('정상 ACP 만 있으면 clean 이다', function (t, done) {
    const good = JSON.stringify({ acr: [{ acor: ['Cteam', 'Sponde'], acop: 63 }] });
    const h = tap([[lookupRow('a_ok')], [{ ri: '/Mobius/a_ok', pv: good, pvs: good }]]);
    h.lint.lint_acp(null, {}, function (err, res) {
        assert.ok(!err);
        assert.deepStrictEqual(res.counts, { error: 0, warn: 0, clean: 1 });
        done();
    });
});

test('배치마다 질의 두 번이다 — N+1 이 아니다', function (t, done) {
    const good = JSON.stringify({ acr: [{ acor: ['Cteam', 'Sponde'], acop: 63 }] });
    const rows = ['a', 'b', 'c'].map(lookupRow);
    const bodies = rows.map((r) => ({ ri: r.ri, pv: good, pvs: good }));
    const h = tap([rows, bodies]);
    h.lint.lint_acp(null, {}, function (err, res) {
        assert.ok(!err);
        assert.strictEqual(res.rows.length, 3);
        assert.strictEqual(h.seen.length, 2, '질의가 ' + h.seen.length + '번 나갔다');
        done();
    });
});

test('ACP 목록 질의는 ty 등치를 쓴다 — idx_lookup_ty 를 타야 한다', function (t, done) {
    const h = tap([[], []]);
    h.lint.lint_acp(null, {}, function (err) {
        assert.ok(!err);
        assert.ok(/`ty` = \?|"ty" = \?/.test(h.seen[0].sql), h.seen[0].sql);
        assert.ok(/order by/i.test(h.seen[0].sql), 'ORDER BY 가 없으면 키셋 페이징이 성립하지 않는다');
        done();
    });
});

test('빈 목록에서는 acp 본문 질의를 하지 않는다', function (t, done) {
    const h = tap([[]]);
    h.lint.lint_acp(null, {}, function (err, res) {
        assert.ok(!err);
        assert.strictEqual(h.seen.length, 1);
        assert.deepStrictEqual(res.rows, []);
        done();
    });
});
