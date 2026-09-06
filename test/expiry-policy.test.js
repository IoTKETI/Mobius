'use strict';
// 만료 정책의 단일 진실원. 관리 콘솔이 "et 를 늘릴 수 있는 타입" 과 "만료되면
// 자동으로 지워지는 타입" 을 화면 상수로 들고 있다가 코어와 어긋났다(2026-09-01
// 목적 문서 §0층). 그 두 값을 코어 함수에서 받게 하고, 이 시험이 그 함수를 코어의
// 속성 목록·app.js 와 대조한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const policy = require(path.join(ROOT, 'mobius', 'expiry_policy'));
const attr = require(path.join(ROOT, 'mobius', 'attr_lists'));
const shape = require(path.join(ROOT, 'mobius', 'shape'));

function code_of(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

test('attr_lists 는 부수 효과 없이 require 되고 전역을 세운다', function () {
    // resource.js 는 sgn·responder 를 끌고 오므로 콘솔이 require 하면 안 된다.
    // 목록만 따로 둔 이유다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'attr_lists.js'), 'utf8');
    assert.ok(!/require\(/.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')),
        'attr_lists.js 가 무언가를 require 한다 — 목록만 있어야 한다');
    assert.deepStrictEqual(global.update_opt_attr_list.cnt, attr.update_opt_attr_list.cnt);
    assert.ok(attr.update_opt_attr_list.cnt.indexOf('et') >= 0);
    assert.ok(attr.create_m_attr_list.grp.indexOf('mid') >= 0);
});

test('resource.js 는 목록을 정의하지 않고 attr_lists 를 require 한다', function () {
    const code = code_of('mobius/resource.js');
    assert.ok(/require\('\.\/attr_lists'\)/.test(code), 'resource.js 가 attr_lists 를 안 읽는다');
    assert.ok(!/global\.create_m_attr_list\s*=/.test(code), '목록 정의가 resource.js 에 남아 있다');
    assert.ok(!/update_opt_attr_list\.cnt\s*=/.test(code), '목록 정의가 resource.js 에 남아 있다');
});

test('etExtendableTypes 는 update 목록에 et 가 있는 타입이다 — 이름을 ty 로 접는다', function () {
    const got = policy.etExtendableTypes();
    // 속성 목록에서 직접 다시 계산해 대조한다. 함수가 상수를 들고 있으면 여기서 갈린다.
    const expect = [];
    Object.keys(attr.update_opt_attr_list).forEach((name) => {
        if (attr.update_opt_attr_list[name].indexOf('et') < 0) { return; }
        let ty = null;
        Object.keys(shape.typeRsrc).forEach((k) => { if (shape.typeRsrc[k] === name) { ty = Number(k); } });
        if (ty === null) { return; }               // fwr/bat/… 은 mgo 하위라 ty 가 없다
        if (ty >= 91 && ty <= 98) { ty = 28; }     // hd_* 는 fcnt 의 별칭
        if (expect.indexOf(ty) < 0) { expect.push(ty); }
    });
    expect.sort((a, b) => a - b);
    assert.deepStrictEqual(got, expect);
    // 알려진 사실 몇 개는 이름으로도 못박는다 — 목록이 통째로 비면 위 대조도 빈 것끼리 같다.
    assert.ok(got.indexOf(2) >= 0 && got.indexOf(3) >= 0, 'AE·CNT 는 et 를 늘릴 수 있다');
    assert.ok(got.indexOf(4) < 0, 'CIN 은 oneM2M 상 UPDATE 가 안 된다');
    assert.ok(got.indexOf(5) < 0, 'CSEBase 는 수정할 수 없다');
    assert.ok(got.indexOf(13) < 0, 'mgo 는 갱신 목록에 없다');
    assert.ok(got.indexOf(28) >= 0, 'fcnt 는 et 를 늘릴 수 있다 — 예전 화면 상수가 이것을 막고 있었다');
});

test('autoDeletedTypes 는 app.js 의 만료 스윕과 같다 — 지금은 스윕이 없다', function () {
    assert.deepStrictEqual(policy.autoDeletedTypes(), []);
    // 스윕이 되살아나면 이 단정이 먼저 깨져야 한다. 주석은 제외하고 본다.
    const code = code_of('app.js');
    assert.ok(!/del_expired_resource\(/.test(code), 'app.js 가 del_expired_resource 를 부른다 — autoDeletedTypes 를 그 타입으로 바꿀 것');
    assert.ok(!/select_expired_resources\(/.test(code), 'app.js 가 만료 스윕을 돌린다 — autoDeletedTypes 를 맞출 것');
});
