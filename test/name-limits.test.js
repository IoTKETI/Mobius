'use strict';
// Length checks for names and paths at creation.
//
// Values wider than the schema columns were rejected by MySQL strict mode with 'Data too long' as a 500. The limit belongs to the schema, so the request side rejects with 400 first.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const limits = require('../mobius/name_limits');
const reason = require('../mobius/reason');
const rsc = require('../mobius/rsc');

test('한계값은 MySQL 스키마의 컬럼 폭을 넘지 않는다', () => {
    // The constant must not exceed the schema width (it need not be equal). The code's limit follows the deployed DB; a value larger than the schema produces a 500 from the DB.
    const ddl = fs.readFileSync(path.join(ROOT, 'mobius', 'db', 'mobiusdb.sql'), 'utf8');
    const lookup = ddl.slice(ddl.indexOf('CREATE TABLE `lookup`'));
    const ae = ddl.slice(ddl.indexOf('CREATE TABLE `ae`'));
    const w = (block, c) => parseInt(new RegExp('`' + c + '` varchar\\((\\d+)\\)').exec(block)[1], 10);
    assert.ok(limits.RN_MAX <= w(lookup, 'rn'), 'RN_MAX ' + limits.RN_MAX + ' > lookup.rn');
    assert.ok(limits.PATH_MAX <= w(lookup, 'ri'), 'PATH_MAX ' + limits.PATH_MAX + ' > lookup.ri');
    assert.ok(limits.ID_MAX <= Math.min(w(lookup, 'sri'), w(ae, 'aei')), 'ID_MAX ' + limits.ID_MAX + ' > lookup.sri/ae.aei');
    // Width of the deployed schema after 018 widened rn, sri and spi to 200.
    assert.strictEqual(limits.RN_MAX, 200);
    assert.strictEqual(limits.ID_MAX, 200);
    assert.strictEqual(limits.PATH_MAX, 200);
});

test('AE-ID — 200자는 통과, 201자는 400-70. 형식(S/C)은 보지 않는다', () => {
    assert.strictEqual(limits.check_id('S'.repeat(200)), null);
    assert.strictEqual(limits.check_id('myDevice-01'), null, 'S/C 로 시작하지 않아도 받는다 — 사용자 결정');
    assert.strictEqual(limits.check_id('x'.repeat(201)), '400-70');
});

test('사유 문구는 상수에서 만들어져 한계값과 "this CSE" 를 담는다', () => {
    assert.match(reason.REASON['400-68'].msg, /200/);
    assert.match(reason.REASON['400-69'].msg, /200/);
    assert.match(reason.REASON['400-70'].msg, /200/);
    ['400-68', '400-69', '400-70'].forEach((k) => {
        assert.match(reason.REASON[k].msg, /this CSE/, k + ' — oneM2M 의 한계가 아니라 이 CSE 의 저장 한계라고 말해야 한다');
        assert.strictEqual(reason.REASON[k].code, rsc.RSC.BAD_REQUEST, k);
    });
});

test('build_ae 가 aei 를 정한 직후 길이를 검사한다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'ae.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const at = src.indexOf("resource_Obj[rootnm].aei = request.headers['x-m2m-origin'];");
    assert.ok(at > 0, '지정한 aei 를 그대로 쓰는 줄이 없다');
    const after = src.slice(at, at + 500);
    assert.match(after, /name_limits\.check_id\(resource_Obj\[rootnm\]\.aei\)/);
    assert.match(after, /callback\(too_long\);\s*\n\s*return;/);
});

test('rn — 200자는 통과, 201자는 400-68', () => {
    // The path is kept short so the path check (200) does not fire first; only the name is checked here.
    assert.strictEqual(limits.check('a'.repeat(200), '/M/x'), null);
    assert.strictEqual(limits.check('a'.repeat(201), '/M/x'), '400-68');
});

test('경로 — 200자는 통과, 201자는 400-69', () => {
    const deep = '/Mobius/' + 'x'.repeat(40) + '/' + 'y'.repeat(40) + '/' + 'z'.repeat(40) + '/' + 'w'.repeat(40) + '/';
    const ok = deep + 'q'.repeat(200 - deep.length);
    assert.strictEqual(ok.length, 200);
    assert.strictEqual(limits.check('q'.repeat(200 - deep.length), ok), null);
    assert.strictEqual(limits.check('q'.repeat(201 - deep.length), ok + 'q'), '400-69');
});

test('둘 다 넘으면 이름 쪽(400-68)이 먼저다 — 고칠 것이 이름이다', () => {
    assert.strictEqual(limits.check('a'.repeat(201), '/'.repeat(300)), '400-68');
});

test('세 사유가 카탈로그에 있고 BAD_REQUEST 다', () => {
    ['400-68', '400-69', '400-70'].forEach((k) => {
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
