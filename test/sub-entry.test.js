'use strict';
// 구독 행 하나가 깨져도 워커가 죽지 않아야 한다.
//
// sgn_action 이 받는 것은 select_subs_by_pi 가 준 sub 행이다(sub_source.rows_for).
// insert_sub 는 nu 와 enc 를 JSON.stringify 해서 **문자열**로 넣는다. 그래서 행은
// 정확히 "항목 안쪽이 문자열인" 모양이고, sub_entry.read 가 그것을 푼다.
//
// 예전에는 sgn_action 이 곧바로 JSON.parse(JSON.stringify(enc.net)) 을 했다.
// enc 가 문자열이면 .net 은 undefined, JSON.stringify(undefined) 는 값
// undefined, JSON.parse(undefined) 는 SyntaxError 다. sgn_action 은 DB 콜백
// 안에서 돌고 sgn.check 호출부 네 곳이 전부 빈 콜백이라 예외가
// uncaughtException 이 되어 backstop 이 워커를 내린다. 그 행이 DB 에 남아
// 있는 한 재기동할 때마다 반복된다 — 영구 재기동 루프다.
//
// 이 파일은 test/sgn-subl-entry.test.js 였다. lookup.subl 사본(pack/upsert/without ·
// update_subl 의 잠금)을 지키던 시험은 사본과 함께 지웠다(2026-09-05, 스펙
// docs/superpowers/specs/2026-09-05-notification-routing-source-design.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// mobius/sub_entry.js 는 의존성이 없다 — sgn.js 는 sgn_man 을 통해 MQTT 에 붙어서
// 테스트에서 로드할 수 없다. 계약을 별도 모듈에 둔 이유가 이것이다.
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

/* ── 정상 항목 ───────────────────────────────────────────────────── */

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
    // 발송 중 소비되는 배열은 sgn_action 이 복제한다.
    const e = entry();
    const r = read_sub(e);
    assert.strictEqual(r.nu, e.nu, 'nu 를 복제했다');
    assert.strictEqual(r.net, e.enc.net, 'net 을 복제했다');
});

/* ── sub 테이블 모양(문자열)을 읽는다 — 이것이 정상 경로다 ────────── */

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
    // insert_sub 가 넣는 형태 그대로
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

/* ── 못 읽는 것은 null. 절대 던지지 않는다 ────────────────────────── */

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
    // enc 가 문자열 -> .net 은 undefined -> JSON.parse(undefined) 는 SyntaxError
    const broken = entry({ enc: '{"net":["3"]}' });
    assert.throws(function () {
        JSON.parse(JSON.stringify(broken.enc.net));       // 옛 코드 그대로
    }, 'enc 가 문자열일 때 옛 표현이 더는 안 던진다 — 이 테스트의 전제를 확인할 것');

    // 새 경로는 같은 입력을 정상으로 읽는다
    assert.ok(read_sub(broken), '새 경로가 이 입력을 못 읽는다');
});

/* ── sgn_action 이 실제로 이 관문을 쓰는가 ────────────────────────── */

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

/* ── 사본 장치가 되살아나지 않는다 ─────────────────────────────────── */

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
