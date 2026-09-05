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

// **자기 DB 파일을 쓴다.** 아래에 global.usedb='sqlite' 로 db.connect() 를
// 부르는 테스트가 있는데, 이 줄이 없으면 sqlite 어댑터의 기본값인
// ./mobius.db — 즉 **저장소 루트의 실제 개발 DB** — 를 연다. connect() 는
// PRAGMA journal_mode(파일에 영속된다)와 스키마 exec 를 실제로 돌린다.
//
// usedb='sqlite' 를 쓰는 테스트 넷 중 이 파일만 경로를 안 세우고 있었다.
// (배포에서 orphan-page-cursor 가 같은 이유로 SQLITE_CORRUPT 를 냈고,
//  그 수정에서 이 파일이 빠졌다.)
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-sgn-subl-test.db');
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

test('sub 테이블 행도 같은 눈(read)으로 읽는다 — nu·enc 가 JSON 문자열이라서', function () {
    // 원천이 sub 테이블로 옮겨진 뒤(2026-09-05)로 sgn_action 이 받는 것은 subl 사본이
    // 아니라 select_subs_by_pi 가 준 행이다. insert_sub 는 nu·enc 를 JSON.stringify 해서
    // 넣으므로 그 행은 정확히 "항목 안쪽이 문자열인" 모양이다 — read 가 그것을 푼다.
    // 예전에는 needs_connection 이 여기서만 Array.isArray 로 걸러 nu 가 문자열인
    // 항목을 커넥션 없이 발송 경로로 들여보냈다. 그 함수는 없어졌다(언제나 빌린다).
    const at = SGN.indexOf('function sgn_action(');
    assert.ok(at > 0);
    const body = SGN.slice(at, at + 800);
    assert.ok(/subl_entry\.read\(subl\[req_count\]\)/.test(body),
        'sgn_action 이 행을 read 로 읽지 않는다 — 문자열 nu/enc 를 못 푼다');
    const row = { ri: '/M/p/s1', nu: '["mqtt://b/t"]', enc: '{"net":[3]}', nct: '2', nec: null, cr: 'C' };
    assert.deepStrictEqual(subl.read(row), { ri: '/M/p/s1', cr: 'C', exc: undefined, nct: '2', nec: null, net: [3], nu: ['mqtt://b/t'] });
});

/* ── 배열 조작: 같은 ri 는 하나만 ─────────────────────────────────── */
//
// 세 경로가 각자 다르게 배열을 만지다가 전부 다른 방식으로 틀렸다.
//   생성  push 만 하고 같은 ri 가 있는지 안 봤다        -> 중복이 생긴다
//   수정  첫 항목만 갈아 끼우고 break 했다              -> 나머지는 옛 nu 로 발송
//   삭제  for-in 중 splice 라 뒤 원소를 건너뛰었다       -> 중복이 안 지워진다
// 이제 셋 다 아래 두 함수만 쓴다.

const subl = require('../mobius/subl');

function e(ri, nu) {
    return { ri: ri, nu: [nu || ('http://x/' + ri)], enc: { net: ['3'] }, nct: '1' };
}
function ris(list) { return list.map(function (x) { return x.ri; }); }

test('upsert — 없던 ri 는 끝에 붙는다', function () {
    const out = subl.upsert([e('a'), e('b')], e('c'));
    assert.deepStrictEqual(ris(out), ['a', 'b', 'c']);
});

test('upsert — 있던 ri 는 그 자리에서 갈린다 (순서 유지)', function () {
    // sgn_action 이 이 순서대로 발송한다. 이유 없이 순서를 바꾸지 않는다.
    const out = subl.upsert([e('a'), e('b'), e('c')], e('b', 'http://new/b'));
    assert.deepStrictEqual(ris(out), ['a', 'b', 'c']);
    assert.deepStrictEqual(out[1].nu, ['http://new/b']);
});

test('upsert — 중복이 있으면 하나로 접힌다', function () {
    // 삭제 실패로 유령이 남은 위에 다시 만드는 상황이다.
    const out = subl.upsert([e('a'), e('b'), e('c'), e('b')], e('b', 'http://new/b'));
    assert.deepStrictEqual(ris(out), ['a', 'b', 'c']);
    assert.deepStrictEqual(out[1].nu, ['http://new/b'],
        '남은 하나가 새 값이어야 한다 — 옛 nu 가 남으면 그리로 계속 보낸다');
});

test('upsert — 중복 세 개도 하나로 접힌다', function () {
    const out = subl.upsert([e('b'), e('b'), e('b')], e('b', 'http://new/b'));
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0].nu, ['http://new/b']);
});

test('upsert — 원본을 건드리지 않는다', function () {
    const src = [e('a'), e('b')];
    const out = subl.upsert(src, e('b', 'http://new/b'));
    assert.strictEqual(src.length, 2);
    assert.deepStrictEqual(src[1].nu, ['http://x/b'], '원본이 바뀌었다');
    assert.notStrictEqual(out, src);
});

test('upsert — 배열이 아니면 빈 것으로 본다', function () {
    assert.deepStrictEqual(ris(subl.upsert(null, e('a'))), ['a']);
    assert.deepStrictEqual(ris(subl.upsert('[]', e('a'))), ['a']);
    assert.deepStrictEqual(ris(subl.upsert(undefined, e('a'))), ['a']);
});

test('upsert — ri 없는 항목은 넣지 않는다', function () {
    const src = [e('a')];
    assert.deepStrictEqual(ris(subl.upsert(src, null)), ['a']);
    assert.deepStrictEqual(ris(subl.upsert(src, { nu: ['http://x'] })), ['a']);
});

test('without — 같은 ri 를 전부 뺀다', function () {
    // 옛 코드는 for-in 중 splice 라 하나만 지웠다. 그게 배포의
    // "중복 1,481묶음" 이 계속 남아 있는 이유다.
    const out = subl.without([e('a'), e('b'), e('b'), e('c'), e('b')], 'b');
    assert.deepStrictEqual(ris(out), ['a', 'c']);
});

test('without — 연달아 붙은 중복도 전부 뺀다', function () {
    // splice 로 건너뛰는 실패가 가장 잘 드러나는 배치다.
    assert.deepStrictEqual(ris(subl.without([e('b'), e('b')], 'b')), []);
    assert.deepStrictEqual(ris(subl.without([e('a'), e('b'), e('b'), e('b')], 'b')), ['a']);
});

test('without — 옛 splice 방식과 결과가 다르다', function () {
    // 이 테스트가 통과하는 한, 옛 코드로 되돌리면 위 테스트들이 깨진다.
    const src = [e('b'), e('b'), e('c')];
    const legacy = src.slice();
    for (var idx in legacy) {                       // 옛 코드 그대로
        if (legacy.hasOwnProperty(idx)) {
            if (legacy[idx].ri === 'b') { legacy.splice(idx, 1); }
        }
    }
    assert.deepStrictEqual(ris(legacy), ['b', 'c'], '옛 방식이 더는 건너뛰지 않는다면 전제를 확인할 것');
    assert.deepStrictEqual(ris(subl.without(src, 'b')), ['c']);
});

test('without — 없는 ri 면 그대로', function () {
    assert.deepStrictEqual(ris(subl.without([e('a'), e('b')], 'zz')), ['a', 'b']);
});

test('without — 원본을 건드리지 않는다', function () {
    const src = [e('a'), e('b')];
    const out = subl.without(src, 'b');
    assert.strictEqual(src.length, 2);
    assert.strictEqual(out.length, 1);
});

/* ── 쓰기 경로가 실제로 이 함수들만 쓰는가 ────────────────────────── */

test('resource.js 의 세 경로가 직접 push/splice 하지 않는다', function () {
    const RES = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    assert.ok(!/\.subl\.push\(/.test(RES),
        'subl 에 직접 push 하는 자리가 생겼다 — 같은 ri 검사가 빠진다');
    assert.ok(!/\.subl\.splice\(/.test(RES),
        'subl 에 직접 splice 하는 자리가 생겼다 — 순회 중 splice 는 건너뛴다');
    assert.strictEqual((RES.match(/subl_entry\.upsert\(/g) || []).length, 2,
        'upsert 호출부는 생성·수정 두 곳이다');
    assert.strictEqual((RES.match(/subl_entry\.without\(/g) || []).length, 1,
        'without 호출부는 삭제 한 곳이다');
});

test('update_lookup 은 subl 을 쓰지 않는다', function () {
    // 이 함수를 부르는 래퍼가 20여 개다. subl 을 여기 두면 부모 컨테이너에
    // PUT 한 번만 해도 요청 시작 시점의 목록으로 되감긴다.
    const SQL = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const at = SQL.indexOf('exports.update_lookup = function');
    assert.ok(at > 0, 'update_lookup 이 사라졌다');
    const body = SQL.slice(at, SQL.indexOf('\n};', at) + 3);
    assert.ok(!/subl:/.test(body),
        'update_lookup 이 다시 subl 을 쓴다 — 구독과 무관한 갱신이 목록을 덮는다');

    assert.ok(/exports\.update_subl = function/.test(SQL),
        'update_subl 이 없다');
});

test('update_subl 호출부는 세 곳뿐이다', function () {
    const RES = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    assert.strictEqual((RES.match(/db_sql\.update_subl\(/g) || []).length, 3,
        'update_subl 호출부가 늘었다 — 늘리지 말 것. 여러 곳에서 목록을 ' +
        '절대값으로 덮는 것이 배포의 어긋남을 만든 구조다');
});

/* ── 6필드 축약 ───────────────────────────────────────────────────── */
//
// 예전에는 sub 리소스를 통째로 심었다 — 항목당 약 30개 필드. 그런데 발송기가
// 읽는 것은 6개뿐이고 나머지 24개는 저장소 어디에서도 subl 항목으로부터
// 읽히지 않는다. 배포 기준 subl 이 7.79MB 다.

// insert_sub 가 받는 것과 같은 모양의 완전한 sub 리소스
function fullSub() {
    return {
        rn: 's1', ty: '23', pi: '/Mobius/ae/cnt', ri: '/Mobius/ae/cnt/s1',
        ct: '20260830T101112', lt: '20260830T101112', st: 0, et: '20280830T101112',
        nu: ['mqtt://h/AE?ct=json'], acpi: [], lbl: [], at: [], aa: [], subl: [],
        enc: { net: ['1', '2', '3', '4'] }, exc: '100', gpi: '', nfu: '', bn: {},
        rl: '', psn: '', pn: '', nsp: '', ln: '', nct: '1', nec: '', su: '',
        cr: 'Sip3jTShhxs', spi: '3-2024', sri: '23-2026'
    };
}

test('pack — 6개 필드만 남는다', function () {
    const p = subl.pack(fullSub());
    assert.deepStrictEqual(Object.keys(p).sort(), subl.FIELDS.slice().sort());
});

test('pack — 남긴 값이 원본과 같다', function () {
    const f = fullSub();
    const p = subl.pack(f);
    assert.strictEqual(p.ri, f.ri);
    assert.deepStrictEqual(p.nu, f.nu);
    assert.deepStrictEqual(p.enc, f.enc);
    assert.strictEqual(p.nct, f.nct);
    assert.strictEqual(p.nec, f.nec);
    assert.strictEqual(p.cr, f.cr);
});

test('pack — 결과를 read 가 읽는다', function () {
    // 이게 깨지면 저장은 되는데 발송이 안 된다. 조용히 사라지는 부류다.
    const r = read_sub(subl.pack(fullSub()));
    assert.ok(r, 'pack 한 것을 read 가 못 읽는다');
    assert.deepStrictEqual(r.nu, ['mqtt://h/AE?ct=json']);
    assert.deepStrictEqual(r.net, ['1', '2', '3', '4']);
    assert.strictEqual(r.ri, '/Mobius/ae/cnt/s1');
    assert.strictEqual(r.cr, 'Sip3jTShhxs');
});

test('pack — 발송기가 읽는 값이 통째 심을 때와 같다', function () {
    // 축약 전후로 발송 판단이 달라지면 안 된다.
    const f = fullSub();
    const before = read_sub(f);
    const after  = read_sub(subl.pack(f));
    assert.deepStrictEqual(after.nu, before.nu);
    assert.deepStrictEqual(after.net, before.net);
    assert.strictEqual(after.ri, before.ri);
    assert.strictEqual(after.nct, before.nct);
    assert.strictEqual(after.nec, before.nec);
    assert.strictEqual(after.cr, before.cr);
});

test('pack — 크기가 실제로 준다', function () {
    const f = fullSub();
    const big = JSON.stringify(f).length;
    const small = JSON.stringify(subl.pack(f)).length;
    assert.ok(small < big / 2,
        '축약이 절반도 못 줄인다: ' + big + ' -> ' + small);
});

test('pack — 객체가 아니면 null', function () {
    assert.strictEqual(subl.pack(null), null);
    assert.strictEqual(subl.pack(undefined), null);
    assert.strictEqual(subl.pack('x'), null);
    assert.strictEqual(subl.pack(7), null);
});

test('두 형식이 한 배열에 섞여도 둘 다 읽힌다', function () {
    // 롤링 배포 중 옛 워커는 통째로, 새 워커는 6필드로 쓴다.
    const mixed = [fullSub(), subl.pack(fullSub())];
    mixed[1].ri = '/Mobius/ae/cnt/s2';
    const read = mixed.map(read_sub);
    assert.ok(read[0] && read[1], '섞인 배열에서 못 읽는 항목이 있다');
    assert.deepStrictEqual(read[0].nu, read[1].nu);
    assert.deepStrictEqual(read[0].net, read[1].net);
});

test('upsert 는 형식을 가리지 않고 같은 ri 를 접는다', function () {
    // 옛 워커가 통째로 심어 둔 것 위에 새 워커가 6필드로 갈아 끼우는 상황
    const out = subl.upsert([fullSub()], subl.pack(
        Object.assign(fullSub(), { nu: ['http://new/x'] })));
    assert.strictEqual(out.length, 1, '형식이 다르면 같은 ri 를 못 알아본다');
    assert.deepStrictEqual(out[0].nu, ['http://new/x']);
    assert.deepStrictEqual(Object.keys(out[0]).sort(), subl.FIELDS.slice().sort());
});

test('쓰기 경로가 pack 을 거친다', function () {
    const RES = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    assert.strictEqual((RES.match(/subl_entry\.pack\(/g) || []).length, 2,
        'pack 호출부는 생성·수정 두 곳이다 — 안 거치면 30필드가 그대로 실린다');
    assert.ok(!/subl_entry\.upsert\(parentObj\.subl,\s*resource_Obj\[rootnm\]\)/.test(RES),
        'pack 없이 리소스를 통째로 넣는 자리가 남아 있다');
});

/* ── 읽기-고치기-쓰기가 한 자리에서 일어나는가 ──────────────────── */
//
// 예전에는 호출부가 **완성된 배열**을 넘겼다. 그 배열은 요청이 시작될 때 읽은
// 부모 사본에서 나온 것이라, 읽은 뒤 쓰기까지 사이에 다른 요청이 같은 부모를
// 고치면 절대값 UPDATE 가 그것을 통째로 지웠다.
//
// 두 방향으로 샌다:
//   같은 부모에 구독 둘을 동시에 만들면 나중 UPDATE 가 앞의 것을 지운다.
//   sub 행은 남고 응답도 201 인데 발송기는 subl 만 보므로 먼저 만든 구독이
//   영원히 알림을 못 받는다 — 배포의 "침묵 21건".
//
//   삭제와 겹치면 낡은 사본이 지워진 구독을 되살린다 — "유령".
//
// 워커 16개라서 생기는 문제가 아니다. 읽기와 쓰기가 DB 콜백 경계로 쪼개져
// 있어 워커 하나 안에서도 두 요청이 교차하면 난다.

test('update_subl 은 배열이 아니라 함수를 받는다', function () {
    const SQL = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const at = SQL.indexOf('exports.update_subl = function');
    assert.ok(at > 0, 'update_subl 이 사라졌다');
    const sig = SQL.slice(at, SQL.indexOf('\n', at));
    assert.ok(/\(connection, ri, mutate, callback\)/.test(sig),
        'update_subl 이 완성된 배열을 받는 형태로 돌아갔다 — 낡은 사본을 쓰게 된다: ' + sig.trim());
});

test('update_subl 이 락 안에서 읽는다', function () {
    const SQL = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const at = SQL.indexOf('exports.update_subl = function');
    // **주석은 걷어낸다.** 왜 이렇게 바꿨는지 설명하느라 옛 코드를 그대로
    // 인용하기 때문이다. 이 저장소에서 소스 스캔 테스트가 자기 주석에 걸린
    // 적이 여러 번 있다 — 이번에도 `facade.can('rowLock')` 인용에 걸렸다.
    const body = SQL.slice(at, SQL.indexOf('\n};', at) + 3)
        .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    assert.ok(/\.select\('subl'\)/.test(body),
        'update_subl 이 현재 목록을 읽지 않는다');
    // **의도는 코드에 남고 방법은 어댑터가 정한다.**
    //
    // 예전에는 `if (facade.can('rowLock')) { qb = qb.forUpdate(); }` 와
    // `if (facade.can('transaction'))` 두 갈래가 있었다. 그러면 코어가 "이
    // 백엔드에 행 잠금이 있는가 / 트랜잭션이 있는가" 를 아는 셈이고, 잠금 개념이
    // 다른 백엔드(낙관적 버전 컬럼, SELECT FOR SHARE)가 붙으면 코어를 고쳐야 한다.
    //
    // forUpdate() 를 조건 없이 붙이는 방법도 있었다 — knex 가 SQLite 에서
    // 조용히 빈 문자열로 만든다. 그러나 그러면 **잠금이 없다는 사실이 knex
    // 내부에만** 있어서 코드만 봐서는 알 수 없다. lockRow 는 둘 다 해결한다.
    assert.ok(/facade\.lockRow\(/.test(body),
        '이 읽기를 잠그려는 의도가 코드에 없다 — 동시 생성에서 하나가 사라진다');
    assert.ok(!/facade\.can\(/.test(body),
        '코어가 능력을 물어 갈라진다 — 파사드가 흡수해야 한다');
    assert.ok(/mutate\(list\)/.test(body),
        '읽은 목록에 mutate 를 적용하지 않는다');
});

test('세 호출부가 전부 함수를 넘긴다', function () {
    const RES = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    const calls = RES.match(/db_sql\.update_subl\([^,]+,[^,]+,\s*function\s*\(list\)/g) || [];
    assert.strictEqual(calls.length, 3,
        'update_subl 에 함수를 넘기는 호출부가 3곳이 아니다 (' + calls.length + '곳) — ' +
        '배열을 넘기는 자리가 남아 있으면 그 경로만 낡은 사본을 쓴다');

    // 넘기는 함수는 upsert / without 만 쓴다
    assert.strictEqual((RES.match(/return subl_entry\.upsert\(list,/g) || []).length, 2,
        'upsert 를 쓰는 호출부는 생성·수정 두 곳이다');
    assert.strictEqual((RES.match(/return subl_entry\.without\(list,/g) || []).length, 1,
        'without 을 쓰는 호출부는 삭제 한 곳이다');

    // 호출부가 부모 사본의 subl 을 직접 만지지 않는다
    assert.ok(!/parentObj\.subl\s*=\s*subl_entry\./.test(RES),
        '호출부가 부모 사본의 subl 을 미리 만든다 — 그 사본은 낡았을 수 있다');
});

test('삭제는 subl 갱신을 기다린 뒤 응답한다', function () {
    // update_subl 이 MySQL 에서 트랜잭션을 연다. 던져 놓고 곧바로 응답하면
    // 응답에서 connection.release() 까지가 한 tick 안이라 커넥션이 열린
    // 트랜잭션째 풀로 돌아간다. 다음 요청이 남의 트랜잭션 안에서 돈다.
    const RES = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    const at = RES.indexOf("return subl_entry.without(list,");
    assert.ok(at > 0, '삭제 경로의 update_subl 호출을 못 찾았다');

    // 그 호출의 콜백 안에서 callback('200') 이 불려야 한다
    const after = RES.slice(at, at + 2200);
    const cbAt = after.indexOf("callback('200')");
    assert.ok(cbAt > 0,
        "삭제 경로가 update_subl 콜백 밖에서 응답한다 — 열린 트랜잭션째 커넥션이 반납된다");
    assert.ok(after.indexOf('update_parent_st') > 0 && after.indexOf('update_parent_st') < cbAt,
        'update_parent_st 가 응답보다 뒤로 밀렸다');
});

/* ── SQLite 의 알려진 한계를 못박는다 ─────────────────────────────── */
//
// update_subl 은 MySQL 에서 트랜잭션 + FOR UPDATE 로 부모 행을 잡고 읽는다.
// SQLite 는 그 둘을 다 지원하지 않아 잠금 없이 읽고 쓴다 — 같은 부모에
// 구독을 동시에 만들면 하나가 사라진다.
//
// 실측 (같은 부모에 구독 12개 동시 생성 x 6회):
//     MySQL  잠그기 전  sub 72 / subl 9   -> 63 침묵
//     MySQL  잠근 뒤    sub 72 / subl 72  -> 0
//     SQLite 잠금 없음  sub 72 / subl 20  -> 52 침묵
//
// 이 테스트는 "고쳤다" 가 아니라 "알고 있다" 를 지킨다. 어댑터가 나중에
// transaction 을 지원하게 되면 이 테스트가 깨지고, 그때 위 주석과 함께
// 다시 판단하면 된다.

test('sqlite 어댑터는 아직 트랜잭션·행잠금을 선언하지 않는다', function () {
    const cap = require('../mobius/db/sqlite').capabilities;
    assert.strictEqual(cap.transaction, false,
        'sqlite 가 트랜잭션을 지원하게 됐다 — update_subl 의 SQLite 한계 주석과 ' +
        '이 테스트를 다시 볼 것. 지원한다면 동시 생성 유실이 사라진다');
    assert.strictEqual(cap.rowLock, false,
        'sqlite 가 행잠금을 지원하게 됐다 — 같은 곳을 다시 볼 것');
});

test('update_subl 이 능력 없는 백엔드에서도 돈다 — 파사드가 흡수한다', function () {
    // 능력이 없으면 트랜잭션 없이 그냥 읽고 쓴다. 던지지 않는 것이 중요하다 —
    // 여기서 던지면 SQLite 배포의 구독 생성이 통째로 막힌다.
    //
    // 그 분기가 **코어에서 파사드로 옮겨갔다.** 코어는 조건 없이 부르고,
    // 능력 없는 백엔드에서는 파사드가 본문만 돌린다. 같은 파일의 update_acp /
    // update_sub / update_parent_by_delete 는 이미 그렇게 부르고 있었다 —
    // 이 함수만 갈라져 있었다.
    const SQL = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const at = SQL.indexOf('exports.update_subl = function');
    const body = SQL.slice(at, SQL.indexOf('\n};', at) + 3);

    assert.ok(/facade\.transaction\(connection, apply, callback\)/.test(body),
        '파사드 트랜잭션을 조건 없이 부르지 않는다');
    assert.ok(!/apply\(connection, callback\)/.test(body),
        '능력 없는 백엔드용 우회 경로가 코어에 남아 있다 — 파사드가 그 일을 한다');

    // 파사드가 실제로 흡수하는지 확인한다. 소스만 보면 "코어에 분기가 없다" 는
    // 알아도 "그래서 SQLite 에서 도는가" 는 모른다.
    const FACADE = fs.readFileSync(path.join(ROOT, 'mobius', 'db', 'index.js'), 'utf8');
    assert.ok(/if \(!capable\)/.test(FACADE),
        '파사드에 능력 없는 백엔드용 경로가 없다 — SQLite 에서 구독 생성이 막힌다');
});

test('파사드의 무능력 경로가 하류 예외를 삼키지 않는다', function () {
    // 이 성질 때문에 코어가 갈라져 있었다. 파사드가 본문을 try 로 감싸는데,
    // 본문이 **동기로** 정산하면 그 뒤 사용자 콜백이 던진 예외까지 잡혀
    // 로그만 남고 사라졌다. 트랜잭션과 무관한 하류 버그를 파사드가 삼킨 것이다.
    //
    // 그래서 사용자 콜백을 try 밖에서 부른다. 이걸 고쳐야 코어의 if 를 지울 수 있었다.
    delete require.cache[require.resolve('../mobius/db')];
    const savedDb = global.usedb;
    try {
        global.usedb = 'sqlite';              // transaction 능력이 없는 백엔드
        const db = require('../mobius/db');
        db.connect(function () {});

        let threw = null;
        try {
            db.transaction({}, function (conn, finish) {
                finish(null, 'ok');           // 동기 정산
            }, function () {
                throw new Error('하류 폭발');  // 정산 뒤 사용자 콜백이 던진다
            });
        } catch (e) { threw = e; }

        assert.ok(threw && /하류 폭발/.test(threw.message),
            '파사드가 하류 예외를 삼켰다 — 트랜잭션과 무관한 버그가 로그로만 남는다');
    } finally {
        global.usedb = savedDb;
        delete require.cache[require.resolve('../mobius/db')];
    }
});

test('SQLite 한계가 문서에 남아 있다', function () {
    // 주석이 사라지면 다음 사람이 "고쳐졌다" 고 오해한다.
    const SQL = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const at = SQL.indexOf('exports.update_subl = function');
    const doc = SQL.slice(Math.max(0, at - 3000), at);
    assert.ok(/SQLite 는 아직 막지 못한다/.test(doc),
        'update_subl 의 SQLite 한계 설명이 사라졌다');
});
