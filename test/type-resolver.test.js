'use strict';
// ty resolution in one place. With it scattered, the Content-Type ty was discarded unchecked (ty=3 with {"m2m:ae":...} created an AE) and two copies of the algorithm drifted apart.

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

// Root name normalisation.

test('네임스페이스 접두를 뗀다', function () {
    assert.strictEqual(tr.normalize_root_name('m2m:cnt'), 'cnt');
    assert.strictEqual(tr.normalize_root_name('m2m:ae'), 'ae');
    // hd is not stripped but turned into an underscore; the typeRsrc value is 'hd_dooLk'.
    assert.strictEqual(tr.normalize_root_name('hd:dooLk'), 'hd_dooLk');
    assert.strictEqual(tr.normalize_root_name('hd:bat'), 'hd_bat');
    // Without a prefix the name is unchanged, as in the old app.js code.
    assert.strictEqual(tr.normalize_root_name('cnt'), 'cnt');
});

test('문자열이 아니면 빈 문자열이다 — 던지지 않는다', function () {
    // With an array or empty body, Object.keys()[0] is undefined. .split used to throw a TypeError here.
    assert.strictEqual(tr.normalize_root_name(undefined), '');
    assert.strictEqual(tr.normalize_root_name(null), '');
    assert.strictEqual(tr.normalize_root_name(3), '');
});

// Type resolution.

test('본문 루트로 ty 를 정한다', function () {
    assert.deepStrictEqual(tr.resolve('m2m:cnt', null), { rsc: '200', ty: '3', rootnm: 'cnt' });
    assert.deepStrictEqual(tr.resolve('m2m:ae', null), { rsc: '200', ty: '2', rootnm: 'ae' });
    assert.deepStrictEqual(tr.resolve('m2m:cin', null), { rsc: '200', ty: '4', rootnm: 'cin' });
    assert.deepStrictEqual(tr.resolve('m2m:sub', null), { rsc: '200', ty: '23', rootnm: 'sub' });
    assert.deepStrictEqual(tr.resolve('hd:dooLk', null), { rsc: '200', ty: '98', rootnm: 'hd_dooLk' });
});

test('ty 는 반드시 문자열이다', function () {
    // typeRsrc keys are strings, and resource.js builds the ri prefix string with rid.next_rn(request.ty). A number would change the ri format.
    const r = tr.resolve('m2m:cnt', null);
    assert.strictEqual(typeof r.ty, 'string');
});

test('모르는 루트 이름은 400-3', function () {
    assert.strictEqual(tr.resolve('m2m:zzz', null).rsc, '400-3');
    assert.strictEqual(tr.resolve('', null).rsc, '400-3');
    assert.strictEqual(tr.resolve(undefined, null).rsc, '400-3');
});

// Content-Type ty is compared with the body. Without this, ty=3 with {"m2m:ae":...} created an AE.

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
    // PUT may carry no ty. Rejecting here would break every UPDATE without one.
    assert.strictEqual(tr.resolve('m2m:cnt', null).rsc, '200');
    assert.strictEqual(tr.resolve('m2m:cnt', '').rsc, '200');
});

// Aliases. 91..98 (hd_*) are not standard types but internal aliases of flexContainer (28); resource.js restores '28' before storing. The only standard value a client can put in Content-Type is 28, so this 'mismatch' is normal traffic: POST ty=28 + {"hd:dooLk":...} creates under an fcnt parent.

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
    // Passing anything as a 28 relative would make the comparison meaningless.
    assert.strictEqual(tr.resolve('m2m:cnt', '28').rsc, '400-42');
    assert.strictEqual(tr.resolve('hd:dooLk', '3').rsc, '400-42');
    assert.strictEqual(tr.resolve('m2m:fcnt', '3').rsc, '400-42');
    // fcnt itself is 28 and passes.
    assert.strictEqual(tr.resolve('m2m:fcnt', '28').rsc, '200');
});

// Gaps in the attribute tables kill workers: a type in ty_list with no key in the attribute table makes create_np_attr_list[rootnm].includes(attr) fail with undefined.includes, and one request kills the worker (POST {"m2m:mgo":...} under nod, PUT {"m2m:cb":...}). The source is read and compared directly.

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

    // Types absent from the table are caught by the guard branch in resource.js with 409-4. That branch must exist first; without it this test is meaningless.
    assert.ok(/create_np_attr_list\.hasOwnProperty\(rootnm\)/.test(src) ||
              /has_attr_table/.test(src),
        'resource.js 의 속성표 부재 방어가 사라졌다 — 요청 하나로 워커가 죽는 상태로 돌아갔다');

    // The actual gaps are recorded so growth is noticed.
    const known_gaps = {
        create: ['5', '13'],          // cb (parent-child check rejects first), mgo (abstract type)
        update: ['4', '5', '13']      // cin is rejected by 405-7 first
    };
    for (const phase of ['create', 'update']) {
        const keys = attr_list_keys(src, phase + '_np_attr_list');
        const gaps = ty_list.filter((t) => !keys.has(responder.typeRsrc[t]));
        assert.deepStrictEqual(gaps, known_gaps[phase],
            phase + ' 속성표의 공백이 달라졌다: ' + gaps.map((t) => t + '(' + responder.typeRsrc[t] + ')').join(' ') +
            ' — 늘었다면 그 타입으로 워커를 죽일 수 있는지 확인할 것');
    }
});

// app.js has not reverted to the old form.

test('ty 결정이 다시 흩어지지 않았다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    // Assignments to request.ty. Only the place reading Content-Type and the place receiving the resolveType result should remain.
    const writes = (src.match(/^\s*request\.ty = /gm) || []).length;
    assert.ok(writes <= 4,
        'request.ty 대입이 ' + writes + '곳이다 — ty 결정이 다시 흩어졌는지 확인할 것');

    // The loop that reverse-searched typeRsrc directly must not return.
    assert.strictEqual(/for \(var key in responder\.typeRsrc\)/.test(src), false,
        'app.js 가 typeRsrc 를 다시 직접 역탐색한다 — type_resolver 를 쓸 것');
});
