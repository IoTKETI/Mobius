'use strict';
// 생성 시 이름·경로 길이 검사 (ri/sri 설계 메모 §3 A4).
//
// lookup.rn 은 varchar(45), lookup.ri(구조 경로)는 varchar(200) 이다. 넘는 값은
// MySQL strict 모드가 "Data too long" 으로 거절해 500 이 나갔다. 한계는 스키마의
// 것이니 요청을 받는 쪽에서 400 으로 먼저 끊는다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const limits = require('../mobius/name_limits');
const reason = require('../mobius/reason');
const rsc = require('../mobius/rsc');

test('한계값은 MySQL 스키마의 컬럼 폭과 같다', () => {
    const ddl = fs.readFileSync(path.join(ROOT, 'mobius', 'db', 'mobiusdb.sql'), 'utf8');
    const lookup = ddl.slice(ddl.indexOf('CREATE TABLE `lookup`'));
    assert.strictEqual(limits.RN_MAX, parseInt(/`rn` varchar\((\d+)\)/.exec(lookup)[1], 10));
    assert.strictEqual(limits.PATH_MAX, parseInt(/`ri` varchar\((\d+)\)/.exec(lookup)[1], 10));
});

test('rn — 45자는 통과, 46자는 400-68', () => {
    assert.strictEqual(limits.check('a'.repeat(45), '/Mobius/' + 'a'.repeat(45)), null);
    assert.strictEqual(limits.check('a'.repeat(46), '/Mobius/' + 'a'.repeat(46)), '400-68');
});

test('경로 — 200자는 통과, 201자는 400-69', () => {
    const deep = '/Mobius/' + 'x'.repeat(40) + '/' + 'y'.repeat(40) + '/' + 'z'.repeat(40) + '/' + 'w'.repeat(40) + '/';
    const ok = deep + 'q'.repeat(200 - deep.length);
    assert.strictEqual(ok.length, 200);
    assert.strictEqual(limits.check('q'.repeat(200 - deep.length), ok), null);
    assert.strictEqual(limits.check('q'.repeat(201 - deep.length), ok + 'q'), '400-69');
});

test('둘 다 넘으면 이름 쪽(400-68)이 먼저다 — 고칠 것이 이름이다', () => {
    assert.strictEqual(limits.check('a'.repeat(46), '/'.repeat(300)), '400-68');
});

test('두 사유가 카탈로그에 있고 BAD_REQUEST 다', () => {
    ['400-68', '400-69'].forEach((k) => {
        assert.ok(reason.REASON[k], k + ' 가 없다');
        assert.strictEqual(reason.REASON[k].code, rsc.RSC.BAD_REQUEST, k);
        assert.match(reason.REASON[k].msg, /45|200/, k + ' 문구에 한계값이 있어야 한다');
    });
});

test('build_resource 가 ri 를 만든 직후 검사하고, 넘으면 그 사유로 끝낸다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const at = src.indexOf("resource_Obj[rootnm].ri = resource_Obj[rootnm].pi + '/' + resource_Obj[rootnm].rn;");
    assert.ok(at > 0, 'ri 조립 줄이 없다');
    const after = src.slice(at, at + 600);
    assert.match(after, /name_limits\.check\(resource_Obj\[rootnm\]\.rn, resource_Obj\[rootnm\]\.ri\)/, 'ri 를 만든 직후 검사하지 않는다');
    assert.match(after, /callback\(too_long\);\s*\n\s*return;/, '넘었을 때 그 사유로 끝내지 않는다');
});
