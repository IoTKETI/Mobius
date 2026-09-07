'use strict';
// A single broken subscription row must not kill a worker.
//
// sgn_action receives sub rows from select_subs_by_pi (sub_source.rows_for). insert_sub stores nu and enc as JSON strings, so the row has string-valued fields, and sub_entry.read unpacks them.
//
// A direct JSON.parse(JSON.stringify(enc.net)) on a string enc gives .net undefined, JSON.stringify(undefined) is undefined, and JSON.parse(undefined) is a SyntaxError. sgn_action runs inside a DB callback and all four sgn.check callers pass an empty callback, so the exception becomes an uncaughtException and backstop stops the worker; with the row still in the DB this repeats on every restart.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// mobius/sub_entry.js has no dependencies. sgn.js connects to MQTT through sgn_man and cannot be loaded in tests, which is why the contract lives in a separate module.
const sub_entry = require('../mobius/sub_entry');
const read_sub = sub_entry.read;

const ROOT = path.join(__dirname, '..');
const SGN = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn.js'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');

function entry(over) {
    return Object.assign({
        ri: '/Mobius/ae/cnt/s1',
        nu: ['mqtt://h/AE?ct=json'],
        enc: { net: ['1', '2', '3', '4'] },
        nct: '1', nec: '', cr: 'CAe'
    }, over || {});
}

/* Valid entries. */

test('정상 항목을 그대로 읽는다', function () {
    const r = read_sub(entry());
    assert.ok(r, '정상 항목을 못 읽었다');
    assert.strictEqual(r.ri, '/Mobius/ae/cnt/s1');
    assert.deepStrictEqual(r.net, ['1', '2', '3', '4']);
    assert.deepStrictEqual(r.nu, ['mqtt://h/AE?ct=json']);
    assert.strictEqual(r.nct, '1');
    assert.strictEqual(r.cr, 'CAe');
});

test('사본을 뜨지 않는다', function () {
    // Arrays consumed during sending are cloned by sgn_action.
    const e = entry();
    const r = read_sub(e);
    assert.strictEqual(r.nu, e.nu, 'nu 를 복제했다');
    assert.strictEqual(r.net, e.enc.net, 'net 을 복제했다');
});

/* Reads the sub table shape (strings): the normal path. */

test('nu 가 JSON 문자열이면 배열로 읽는다', function () {
    const r = read_sub(entry({ nu: '["mqtt://h/AE?ct=json","http://x/y"]' }));
    assert.ok(r, 'nu 가 문자열인 항목을 버렸다');
    assert.deepStrictEqual(r.nu, ['mqtt://h/AE?ct=json', 'http://x/y']);
});

test('enc 가 JSON 문자열이면 net 을 읽는다', function () {
    const r = read_sub(entry({ enc: '{"net":["3"]}' }));
    assert.ok(r, 'enc 가 문자열인 항목을 버렸다');
    assert.deepStrictEqual(r.net, ['3']);
});

test('sub 테이블 그대로의 모양을 읽는다 — select_subs_by_pi 가 주는 행', function () {
    // Exactly the form insert_sub stores.
    const r = read_sub({ ri: '/Mobius/a/s', nu: '["mqtt://h/A?ct=json"]',
                         enc: '{"net":["1","2","3","4"]}', nct: '1', nec: '', cr: 'CA' });
    assert.ok(r, 'sub 행 모양을 못 읽었다');
    assert.deepStrictEqual(r.nu, ['mqtt://h/A?ct=json']);
    assert.deepStrictEqual(r.net, ['1', '2', '3', '4']);
});

test('FIELDS 는 select_subs_by_pi 가 고르는 컬럼과 같다', function () {
    assert.deepStrictEqual(sub_entry.FIELDS, ['ri', 'nu', 'enc', 'nct', 'nec', 'cr']);
    const at = SQL.indexOf('exports.select_subs_by_pi = function');
    assert.ok(at > 0, 'select_subs_by_pi 가 없다');
    const body = SQL.slice(at, at + 400);
    assert.ok(/select\('ri', 'nu', 'enc', 'nct', 'nec', 'cr'\)/.test(body), 'select_subs_by_pi 의 컬럼이 FIELDS 와 다르다');
});

/* Unreadable input yields null. Never throws. */

const BROKEN = [
    ['null', null],
    ['undefined', undefined],
    ['문자열', '["not an entry"]'],
    ['숫자', 42],
    ['ri 없음', entry({ ri: undefined })],
    ['ri 가 빈 문자열', entry({ ri: '' })],
    ['ri 가 문자열이 아님', entry({ ri: 123 })],
    ['enc 없음', entry({ enc: undefined })],
    ['enc 가 null', entry({ enc: null })],
    ['enc 가 JSON 이 아닌 문자열', entry({ enc: 'net=3' })],
    ['enc 에 net 이 없음', entry({ enc: {} })],
    ['enc.net 이 배열이 아님', entry({ enc: { net: '3' } })],
    ['nu 없음', entry({ nu: undefined })],
    ['nu 가 JSON 이 아닌 문자열', entry({ nu: 'mqtt://h/AE' })],
    ['nu 가 배열이 아닌 JSON', entry({ nu: '{"a":1}' })],
    ['nu 가 숫자', entry({ nu: 7 })]
];

BROKEN.forEach(function (pair) {
    test('깨진 행을 버린다 — ' + pair[0], function () {
        let r;
        assert.doesNotThrow(function () { r = read_sub(pair[1]); },
            pair[0] + ' 에서 던졌다 — DB 콜백 안이라 워커가 죽는다');
        assert.strictEqual(r, null, pair[0] + ' 을 쓸 수 있다고 판정했다');
    });
});

test('옛 코드가 죽던 입력을 재현한다', function () {
    // enc as a string -> .net is undefined -> JSON.parse(undefined) is a SyntaxError
    const broken = entry({ enc: '{"net":["3"]}' });
    assert.throws(function () {
        JSON.parse(JSON.stringify(broken.enc.net));       // the old code verbatim
    }, 'enc 가 문자열일 때 옛 표현이 더는 안 던진다 — 이 테스트의 전제를 확인할 것');

    // The new path reads the same input normally.
    assert.ok(read_sub(broken), '새 경로가 이 입력을 못 읽는다');
});

/* sgn_action actually goes through this gate. */

test('sgn_action 이 sub_entry.read 를 거친다', function () {
    const at = SGN.indexOf('function sgn_action(');
    assert.ok(at > 0, 'sgn_action 이 사라졌다');
    const body = SGN.slice(at, SGN.indexOf('\nfunction ', at + 1));

    assert.ok(/sub_entry\.read\(rows\[req_count\]\)/.test(body),
        'sgn_action 이 구독 행을 정규화 없이 쓴다');
    assert.ok(!/enc_Obj\.net/.test(body),
        'enc.net 을 직접 읽는 표현이 돌아왔다 — enc 가 문자열이면 워커가 죽는다');
    assert.ok(/if \(!results_ss\)/.test(body),
        '못 읽은 행을 건너뛰는 분기가 없다');
});

/* The copy mechanism does not return. */

test('lookup.subl 사본을 쓰는 코드가 없다 — update_subl · pack/upsert/without · 도구 둘', function () {
    const live = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.strictEqual(live('mobius/sql_action.js').indexOf('update_subl'), -1, 'update_subl 이 되살아났다');
    assert.strictEqual(live('mobius/resource.js').indexOf('subl_entry'), -1, 'resource.js 가 사본 계약을 다시 쓴다');
    assert.strictEqual(live('mobius/resource.js').indexOf('update_subl'), -1);
    assert.ok(!fs.existsSync(path.join(ROOT, 'mobius', 'subl.js')), 'mobius/subl.js 가 되살아났다');
    ['tools/rebuild-subl.js', 'tools/snapshot-subl.js'].forEach((t) => {
        assert.ok(!fs.existsSync(path.join(ROOT, t)), t + ' 가 되살아났다 — 사본이 없으니 되만들 것도 없다');
    });
    assert.deepStrictEqual(Object.keys(sub_entry).sort(), ['FIELDS', 'read'], '사본을 고치는 함수가 되살아났다');
});

test('lookup.subl 컬럼은 스키마에도 코드에도 없다 (015, 2026-09-06)', function () {
    // After the column was dropped, leftover subl handling fails two ways: in an insert it makes every creation a 500 with 'Unknown column'; in response stripping it is dead code.
    const live = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*--/.test(l)).join('\n');
    ['mobius/db/mobiusdb.sql', 'mobius/db/mobiusdb_sqlite.sql'].forEach((f) => {
        // Only subl as an identifier is forbidden. 'subl' inside quotes is data: the history condition in mobiusdb_sqlite.sql asks pragma_table_info whether 015 was already applied and holds the column name as a string.
        assert.ok(!/(?<!')\bsubl\b(?!')/.test(live(f)), f + ' 에 subl 컬럼이 남아 있다');
    });
    fs.readdirSync(path.join(ROOT, 'mobius')).filter((f) => /\.js$/.test(f)).forEach((f) => {
        const src = live('mobius/' + f);
        assert.ok(!/\bsubl\b(?!_)/.test(src), 'mobius/' + f + ' 의 실행 코드에 subl 이 남아 있다');
    });
    const m = require(path.join(ROOT, 'migrations', '015-drop-lookup-subl.js'));
    assert.deepStrictEqual(m.backends.sort(), ['mysql', 'sqlite']);
    assert.notStrictEqual(m.autoApply, true, 'DDL 은 기동 경로에서 돌지 않는다');
});
