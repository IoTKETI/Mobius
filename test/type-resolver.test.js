'use strict';
// ty 결정 — 다섯 곳에 흩어져 있던 것을 한 곳으로 모았다.
//
// 흩어져 있던 탓에 Content-Type 의 ty 가 검증 없이 버려졌고(ty=3 에
// {"m2m:ae":...} 를 보내면 AE 가 201 로 생성됐다), 알고리즘이 두 벌이라
// 한쪽만 mgoType 을 아는 상태가 오래 남았다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const tr = require('../mobius/type_resolver');
const responder = require('../mobius/responder');

// ── 루트 이름 정규화 ─────────────────────────────────────────────────

test('네임스페이스 접두를 뗀다', function () {
    assert.strictEqual(tr.normalize_root_name('m2m:cnt'), 'cnt');
    assert.strictEqual(tr.normalize_root_name('m2m:ae'), 'ae');
    // hd 는 떼는 게 아니라 밑줄로 바꾼다 — typeRsrc 값이 'hd_dooLk' 다.
    assert.strictEqual(tr.normalize_root_name('hd:dooLk'), 'hd_dooLk');
    assert.strictEqual(tr.normalize_root_name('hd:bat'), 'hd_bat');
    // 접두가 없으면 그대로. app.js 의 옛 코드와 같은 동작이다.
    assert.strictEqual(tr.normalize_root_name('cnt'), 'cnt');
});

test('문자열이 아니면 빈 문자열이다 — 던지지 않는다', function () {
    // 본문이 배열이거나 비어 있으면 Object.keys()[0] 가 undefined 다.
    // 예전에는 여기서 .split 이 TypeError 를 냈다.
    assert.strictEqual(tr.normalize_root_name(undefined), '');
    assert.strictEqual(tr.normalize_root_name(null), '');
    assert.strictEqual(tr.normalize_root_name(3), '');
});

// ── 타입 해석 ────────────────────────────────────────────────────────

test('본문 루트로 ty 를 정한다', function () {
    assert.deepStrictEqual(tr.resolve('m2m:cnt', null), { rsc: '200', ty: '3', rootnm: 'cnt' });
    assert.deepStrictEqual(tr.resolve('m2m:ae', null), { rsc: '200', ty: '2', rootnm: 'ae' });
    assert.deepStrictEqual(tr.resolve('m2m:cin', null), { rsc: '200', ty: '4', rootnm: 'cin' });
    assert.deepStrictEqual(tr.resolve('m2m:sub', null), { rsc: '200', ty: '23', rootnm: 'sub' });
    assert.deepStrictEqual(tr.resolve('hd:dooLk', null), { rsc: '200', ty: '98', rootnm: 'hd_dooLk' });
});

test('ty 는 반드시 문자열이다', function () {
    // typeRsrc 의 키는 문자열이고, resource.js 가 rid.next_rn(request.ty) 로
    // ri 접두 문자열을 만든다. 숫자를 흘리면 ri 형식이 달라진다.
    const r = tr.resolve('m2m:cnt', null);
    assert.strictEqual(typeof r.ty, 'string');
});

test('모르는 루트 이름은 400-3', function () {
    assert.strictEqual(tr.resolve('m2m:zzz', null).rsc, '400-3');
    assert.strictEqual(tr.resolve('', null).rsc, '400-3');
    assert.strictEqual(tr.resolve(undefined, null).rsc, '400-3');
});

// ── Content-Type 의 ty 대조 ──────────────────────────────────────────
//
// 이것이 없어서 ty=3 에 {"m2m:ae":...} 를 보내면 AE 가 만들어졌다.

test('ty 와 본문이 어긋나면 400-42', function () {
    assert.strictEqual(tr.resolve('m2m:ae', '3').rsc, '400-42');
    assert.strictEqual(tr.resolve('m2m:cnt', '2').rsc, '400-42');
    assert.strictEqual(tr.resolve('m2m:cnt', '9').rsc, '400-42');
    assert.strictEqual(tr.resolve('m2m:cnt', '99').rsc, '400-42');
});

test('ty 와 본문이 맞으면 통과한다', function () {
    assert.strictEqual(tr.resolve('m2m:cnt', '3').rsc, '200');
    assert.strictEqual(tr.resolve('m2m:ae', '2').rsc, '200');
    assert.strictEqual(tr.resolve('m2m:sub', '23').rsc, '200');
});

test('Content-Type 에 ty 가 없으면 대조하지 않는다', function () {
    // WS·MQTT 프록시는 PUT 에 ty 를 붙이지 않는다. 여기서 거절하면
    // 두 바인딩의 모든 UPDATE 가 깨진다.
    assert.strictEqual(tr.resolve('m2m:cnt', null).rsc, '200');
    assert.strictEqual(tr.resolve('m2m:cnt', '').rsc, '200');
});

// ── 별칭 ────────────────────────────────────────────────────────────
//
// 91~98(hd_*)은 표준 타입이 아니라 flexContainer(28)의 내부 별칭이다.
// resource.js:939 가 저장 직전 '28' 로 되돌린다. 클라이언트가 Content-Type 에
// 넣을 수 있는 표준 값은 28 뿐이므로 이 '불일치' 는 정상 트래픽이다.
// 실측: POST ty=28 + {"hd:dooLk":...} 는 fcnt 부모 밑에서 201 로 생성된다.

test('ty=28 과 hd:* 본문은 같은 것으로 본다', function () {
    const r = tr.resolve('hd:dooLk', '28');
    assert.strictEqual(r.rsc, '200', 'ty=28 + hd:dooLk 는 운영 중인 정상 경로다');
    assert.strictEqual(r.ty, '98', '본문 유래 ty 를 채택한다 — 저장 시 resource.js 가 28 로 되돌린다');
});

test('hd_* 여덟 종 전부 28 과 동치다', function () {
    for (const ty of ['91', '92', '93', '94', '95', '96', '97', '98']) {
        const root = 'hd:' + responder.typeRsrc[ty].replace('hd_', '');
        assert.strictEqual(tr.resolve(root, '28').rsc, '200', root + ' 가 ty=28 과 어긋난다고 판정됐다');
        assert.strictEqual(tr.resolve(root, ty).rsc, '200', root + ' 가 ty=' + ty + ' 와 어긋난다고 판정됐다');
    }
});

test('별칭족이 아닌 조합은 여전히 어긋난다', function () {
    // 28 계열이라고 아무거나 통과시키면 대조가 무의미해진다.
    assert.strictEqual(tr.resolve('m2m:cnt', '28').rsc, '400-42');
    assert.strictEqual(tr.resolve('hd:dooLk', '3').rsc, '400-42');
    assert.strictEqual(tr.resolve('m2m:fcnt', '3').rsc, '400-42');
    // fcnt 자신은 28 이므로 통과한다.
    assert.strictEqual(tr.resolve('m2m:fcnt', '28').rsc, '200');
});

// ── 속성표 공백 — 워커를 죽이던 부류 ─────────────────────────────────
//
// ty_list 에는 있는데 속성표에 키가 없는 타입이 있으면
// resource.js 의 create_np_attr_list[rootnm].includes(attr) 가
// undefined.includes 로 터진다. 요청 하나로 워커가 죽는다.
//
// 실측으로 확인한 것:
//   POST {"m2m:mgo":...}  (부모=nod)  -> 워커 사망
//   PUT  {"m2m:cb":...}              -> 워커 사망
//
// 표를 늘릴 때 짝을 빠뜨리면 같은 일이 반복된다. 소스를 직접 읽어 대조한다.

function attr_list_keys(src, name) {
    const dot = [...src.matchAll(new RegExp(name + '\\.([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*\\[', 'g'))].map((m) => m[1]);
    const brk = [...src.matchAll(new RegExp(name + '\\[[\'"]([^\'"]+)[\'"]\\]\\s*=\\s*\\[', 'g'))].map((m) => m[1]);
    return new Set([...dot, ...brk]);
}

test('속성표가 없는 타입은 리소스 생성/수정에 도달하지 못한다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');

    const ty_list = (src.match(/global\.ty_list = \[([^\]]*)\]/) || [, ''])[1]
        .split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
    assert.ok(ty_list.length > 0, 'ty_list 를 읽지 못했다 — 선언 형태가 바뀌었는지 확인할 것');

    // 표에 없는 것은 resource.js 의 방어 분기가 409-4 로 받는다.
    // 그 분기가 살아 있는지부터 본다 — 없으면 이 테스트는 무의미하다.
    assert.ok(/create_np_attr_list\.hasOwnProperty\(rootnm\)/.test(src) ||
              /has_attr_table/.test(src),
        'resource.js 의 속성표 부재 방어가 사라졌다 — 요청 하나로 워커가 죽는 상태로 돌아갔다');

    // 그리고 실제 공백이 어디인지 기록해 둔다. 늘어나면 알아차려야 한다.
    const known_gaps = {
        create: ['5', '13'],          // cb(부모-자식이 먼저 막는다), mgo(추상 타입)
        update: ['4', '5', '13']      // cin 은 405-7 이 먼저 막는다
    };
    for (const phase of ['create', 'update']) {
        const keys = attr_list_keys(src, phase + '_np_attr_list');
        const gaps = ty_list.filter((t) => !keys.has(responder.typeRsrc[t]));
        assert.deepStrictEqual(gaps, known_gaps[phase],
            phase + ' 속성표의 공백이 달라졌다: ' + gaps.map((t) => t + '(' + responder.typeRsrc[t] + ')').join(' ') +
            ' — 늘었다면 그 타입으로 워커를 죽일 수 있는지 확인할 것');
    }
});

// ── app.js 가 옛 형태로 되돌아가지 않았는지 ──────────────────────────

test('ty 결정이 다시 흩어지지 않았다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // request.ty 에 대입하는 곳. 옛날에는 결정 로직이 다섯 군데였다.
    // 지금은 Content-Type 을 읽는 한 곳과 resolveType 결과를 받는 곳뿐이어야 한다.
    const writes = (src.match(/^\s*request\.ty = /gm) || []).length;
    assert.ok(writes <= 4,
        'request.ty 대입이 ' + writes + '곳이다 — ty 결정이 다시 흩어졌는지 확인할 것');

    // typeRsrc 를 직접 역탐색하는 루프가 되살아나지 않았는지.
    assert.strictEqual(/for \(var key in responder\.typeRsrc\)/.test(src), false,
        'app.js 가 typeRsrc 를 다시 직접 역탐색한다 — type_resolver 를 쓸 것');
});
