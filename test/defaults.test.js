'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const defaults = require('../mobius/defaults');

test('DEFAULT_ET 는 2099-12-31 23:59:59 (UTC) 다', function () {
    assert.strictEqual(defaults.DEFAULT_ET, '20991231T235959');
});

test('DEFAULT_ET 는 oneM2M et 형식이다', function () {
    assert.match(defaults.DEFAULT_ET, /^\d{8}T\d{6}$/);
});

// et 는 문자열 비교로 대소를 가린다. 만료 스윕이 `et < now` 로 고르므로
// 기본값이 어떤 현실적인 "지금" 보다도 뒤여야 스윕에 걸리지 않는다.
test('DEFAULT_ET 는 문자열 비교에서 현재보다 뒤다', function () {
    const now = require('moment')().utc().format('YYYYMMDDTHHmmss');
    assert.ok(defaults.DEFAULT_ET > now,
        'DEFAULT_ET(' + defaults.DEFAULT_ET + ') 가 현재(' + now + ') 보다 뒤여야 한다');
});

// 예전 기본값은 "생성 시각 + 2년" 이었다. 스윕이 제대로 돌기 시작하면
// et 를 명시하지 않은 리소스가 2년 뒤 조용히 사라진다. 그 패턴이 다시
// 들어오지 않는지 지킨다.
test('resource.js 의 기본 et 가 상대 날짜로 되돌아가지 않았다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');
    assert.ok(src.indexOf("defaults.DEFAULT_ET") !== -1,
        'resource.js 가 DEFAULT_ET 를 쓰지 않는다');
    assert.strictEqual(src.indexOf("add(2, 'years')"), -1,
        "기본 et 가 add(2, 'years') 로 되돌아갔다");
});

test('cb.js(CSEBase) 의 기본 et 도 DEFAULT_ET 를 쓴다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'cb.js'), 'utf8');
    assert.ok(src.indexOf("defaults.DEFAULT_ET") !== -1,
        'cb.js 가 DEFAULT_ET 를 쓰지 않는다');
    assert.strictEqual(src.indexOf("add(10, 'years')"), -1,
        "CSEBase 의 et 가 add(10, 'years') 로 되돌아갔다");
});

// <request>(ty=17) 는 논블로킹 요청의 임시 기록이라 짧게 만료시킨다.
// 별도 정리기(del_req_resource -> delete_req)와 짝을 이루므로 기본값을 따르면 안 된다.
test('ty=17(<request>) 의 1일 만료는 유지된다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');
    assert.ok(src.indexOf("add(1, 'days')") !== -1,
        '<request> 의 1일 만료가 사라졌다 — del_req_resource 와 짝을 이루는 값이다');
});
