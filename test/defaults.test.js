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

// et is ordered by string comparison. The expiry sweep selects `et < now`, so the default must sort after any realistic 'now'.
test('DEFAULT_ET 는 문자열 비교에서 현재보다 뒤다', function () {
    const now = require('moment')().utc().format('YYYYMMDDTHHmmss');
    assert.ok(defaults.DEFAULT_ET > now,
        'DEFAULT_ET(' + defaults.DEFAULT_ET + ') 가 현재(' + now + ') 보다 뒤여야 한다');
});

// The default et must not be a relative date (creation time + N years), or resources without an explicit et would expire silently.
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

// <request> (ty=17) was the temporary record of a non-blocking request. Non-blocking requests are unsupported, so no path creates this resource and no expiry rule for it remains. Rows left in existing deployments are removed by del_req_resource, which deletes ty=17 wholesale.
test('ty=17(<request>) 생성 경로가 없다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');
    assert.strictEqual(src.indexOf("add(1, 'days')"), -1,
        'ty=17 만료 규칙이 되살아났다 — req 는 더 이상 만들지 않는다');
    assert.strictEqual(src.indexOf('insert_req'), -1,
        'req 생성 경로가 되살아났다');
    assert.strictEqual(src.indexOf('build_req'), -1,
        'req 타입 핸들러 호출이 되살아났다');
});
