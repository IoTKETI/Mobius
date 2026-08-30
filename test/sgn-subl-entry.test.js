'use strict';
// subl 항목 하나가 깨져도 워커가 죽지 않아야 한다.
//
// subl 은 lookup 의 mediumtext 다. makeObject 가 컬럼 문자열을 배열로 풀어
// 주지만 **항목 안쪽은 아무도 정규화하지 않는다.** 반면 sub 테이블은 nu 와
// enc 를 JSON.stringify 해서 문자열로 들고 있다(sql_action 의 insert_sub).
// 그래서 subl 을 sub 에서 되만드는 도구를 짜면, 가장 자연스러운 구현이
// 정확히 "문자열이 든 항목" 을 만든다.
//
// 예전에는 sgn_action 이 곧바로 JSON.parse(JSON.stringify(enc.net)) 을 했다.
// enc 가 문자열이면 .net 은 undefined, JSON.stringify(undefined) 는 값
// undefined, JSON.parse(undefined) 는 SyntaxError 다. sgn_action 은 DB 콜백
// 안에서 돌고 sgn.check 호출부 네 곳이 전부 빈 콜백이라 예외가
// uncaughtException 이 되어 backstop 이 워커를 내린다. 그 항목이 DB 에 남아
// 있는 한 재기동할 때마다 반복된다 — 영구 재기동 루프다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// mobius/subl.js 는 의존성이 없다 — sgn.js 는 sgn_man 을 통해 MQTT 에 붙어서
// 테스트에서 로드할 수 없다. 계약을 별도 모듈에 둔 이유가 이것이다.
const read_sub = require('../mobius/subl').read;

const ROOT = path.join(__dirname, '..');
const SGN = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn.js'), 'utf8');

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
    // needs_connection 이 알림마다 도는 자리라 여기서 복제하면 그만큼이
    // 그대로 낭비다. 발송 중 소비되는 배열은 sgn_action 이 복제한다.
    const e = entry();
    const r = read_sub(e);
    assert.strictEqual(r.nu, e.nu, 'nu 를 복제했다');
    assert.strictEqual(r.net, e.enc.net, 'net 을 복제했다');
});

/* ── sub 테이블 모양(문자열)도 읽는다 ─────────────────────────────── */

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

test('sub 테이블 그대로의 모양을 읽는다', function () {
    // insert_sub 가 넣는 형태 그대로
    const r = read_sub({ ri: '/Mobius/a/s', nu: '["mqtt://h/A?ct=json"]',
                         enc: '{"net":["1","2","3","4"]}', nct: '1', nec: '', cr: 'CA' });
    assert.ok(r, 'sub 행 모양을 못 읽었다 — 재생성 도구가 이 모양을 만든다');
    assert.deepStrictEqual(r.nu, ['mqtt://h/A?ct=json']);
    assert.deepStrictEqual(r.net, ['1', '2', '3', '4']);
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
    test('깨진 항목을 버린다 — ' + pair[0], function () {
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

test('sgn_action 이 subl.read 를 거친다', function () {
    const at = SGN.indexOf('function sgn_action(');
    assert.ok(at > 0, 'sgn_action 이 사라졌다');
    const body = SGN.slice(at, SGN.indexOf('\nfunction ', at + 1));

    assert.ok(/subl_entry\.read\(subl\[req_count\]\)/.test(body),
        'sgn_action 이 subl 항목을 정규화 없이 쓴다');
    assert.ok(!/enc_Obj\.net/.test(body),
        'enc.net 을 직접 읽는 표현이 돌아왔다 — enc 가 문자열이면 워커가 죽는다');
    assert.ok(/if \(!results_ss\)/.test(body),
        '못 읽은 항목을 건너뛰는 분기가 없다');
});

test('needs_connection 도 같은 눈으로 읽는다', function () {
    // 예전에는 여기서만 Array.isArray 로 걸러서, nu 가 문자열인 항목은
    // 커넥션을 안 빌리고도 발송 경로로 들어갔다. ID 형식이면
    // get_ri_sri(null, ...) 에서 죽는다.
    const at = SGN.indexOf('function needs_connection(');
    assert.ok(at > 0, 'needs_connection 이 사라졌다');
    const body = SGN.slice(at, SGN.indexOf('\n}', at) + 2);
    assert.ok(/subl_entry\.read\(subl\[i\]\)/.test(body),
        'needs_connection 이 sgn_action 과 다른 눈으로 subl 을 읽는다');
});
