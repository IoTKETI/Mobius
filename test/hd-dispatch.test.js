/**
 * flexContainer (ty=28) moduleclass dispatch goes through tables. cnd -> short name lives in shape.MODULE_CLASS alone; fcnt.js and resource.js hold only short name -> (attributes / DB function name) tables.
 *
 * Guarded here:
 *   1. the values of shape.cnd_short / hd_short, including rejection of mismatched pairs
 *   2. no moduleclass strings return to the two files (comments are stripped before counting)
 *   3. the keys of the three tables equal the short-name set of MODULE_CLASS; a missing key is a runtime TypeError via `db_sql[undefined]`
 *   4. every name in the tables is actually exported by sql_action.js (`db_sql[name]` binds late, so a typo is not caught at startup)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const shape = require('../mobius/shape');
const MOBIUS = path.join(__dirname, '..', 'mobius');

function src(name) { return fs.readFileSync(path.join(MOBIUS, name), 'utf8'); }
function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
}
function count(hay, needle) { return hay.split(needle).length - 1; }
function tableOf(file, name) {
    const m = src(file).match(new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\});'));
    assert.ok(m, name + ' 표가 ' + file + ' 에 있어야 한다');
    return new Function('return ' + m[1])();
}

const SHORTS = Object.keys(shape.MODULE_CLASS).map((k) => shape.MODULE_CLASS[k]).sort();

test('cnd_short: 여덟 moduleclass 는 약칭, 그 밖은 null (프로토타입 키 포함)', () => {
    Object.keys(shape.MODULE_CLASS).forEach((cnd) => {
        assert.strictEqual(shape.cnd_short(cnd), shape.MODULE_CLASS[cnd]);
    });
    ['toString', 'constructor', '__proto__', 'hasOwnProperty',
     'org.onem2m.home.moduleclass.doorLock', 'org.onem2m.home.moduleclass.', '', undefined, null, 0]
        .forEach((cnd) => assert.strictEqual(shape.cnd_short(cnd), null, JSON.stringify(cnd)));
});

test('hd_short: rootnm 과 cnd 가 짝이어야 약칭이다', () => {
    assert.strictEqual(shape.hd_short('hd_bat', 'org.onem2m.home.moduleclass.battery'), 'bat');
    assert.strictEqual(shape.hd_short('hd_dooLk', 'org.onem2m.home.moduleclass.doorlock'), 'dooLk');
    // A mismatched pair yields null, as the old chain fell through to else.
    assert.strictEqual(shape.hd_short('hd_bat', 'org.onem2m.home.moduleclass.doorlock'), null);
    assert.strictEqual(shape.hd_short('fcnt', 'org.onem2m.home.moduleclass.battery'), null);
    assert.strictEqual(shape.hd_short(undefined, 'org.onem2m.home.moduleclass.battery'), null);
    assert.strictEqual(shape.hd_short('hd_bat', undefined), null);
});

test('fcnt.js / resource.js 에 moduleclass 문자열이 없다 — 판정은 shape 로 간다', () => {
    const f = stripComments(src('fcnt.js'));
    const r = stripComments(src('resource.js'));
    assert.strictEqual(count(f, 'org.onem2m.home.moduleclass'), 0, 'fcnt.js');
    assert.strictEqual(count(r, 'org.onem2m.home.moduleclass'), 0, 'resource.js');
    assert.ok(count(f, 'shape.hd_short(') >= 1, 'fcnt.js 가 hd_short 를 쓴다');
    assert.ok(count(r, 'shape.hd_short(') >= 1, 'resource.js 생성이 hd_short 를 쓴다');
    assert.ok(count(r, 'shape.cnd_short(') >= 1, 'resource.js 갱신이 cnd_short 를 쓴다');
    // The eight direct calls do not return.
    assert.strictEqual(count(r, 'db_sql.insert_hd_'), 0);
    assert.strictEqual(count(r, 'db_sql.update_hd_'), 0);
    assert.strictEqual(count(r, 'db_sql[HD_INSERT['), 1);
    assert.strictEqual(count(r, 'db_sql[HD_UPDATE['), 1);
});

test('세 표의 키가 MODULE_CLASS 의 약칭 집합과 같다', () => {
    assert.deepStrictEqual(Object.keys(tableOf('resource.js', 'HD_INSERT')).sort(), SHORTS);
    assert.deepStrictEqual(Object.keys(tableOf('resource.js', 'HD_UPDATE')).sort(), SHORTS);
    assert.deepStrictEqual(Object.keys(tableOf('fcnt.js', 'HD_ATTRS')).sort(), SHORTS);
    assert.strictEqual(SHORTS.length, 8);
});

test('표에 적힌 함수 이름이 sql_action.js 에 export 된다', () => {
    const sql = stripComments(src('sql_action.js'));
    const ins = tableOf('resource.js', 'HD_INSERT');
    const upd = tableOf('resource.js', 'HD_UPDATE');
    Object.keys(ins).forEach((k) => {
        // For insert_hd_* the BODY_TABLES key is the export name.
        assert.ok(count(sql, '    ' + ins[k] + ':') === 1, ins[k] + ' 이 BODY_TABLES 에 한 번 있어야 한다');
        assert.strictEqual(ins[k], 'insert_hd_' + k);
    });
    Object.keys(upd).forEach((k) => {
        assert.ok(count(sql, 'exports.' + upd[k] + ' =') === 1, upd[k] + ' 이 export 돼야 한다');
        assert.strictEqual(upd[k], 'update_hd_' + k);
    });
    // The name whose case once diverged exists nowhere in the repository.
    fs.readdirSync(MOBIUS).filter((n) => n.endsWith('.js')).forEach((n) => {
        assert.strictEqual(count(src(n), 'insert_hd_dooLK'), 0, n);
    });
});

test('HD_ATTRS 가 옛 여덟 갈래와 같은 속성을 같은 순서로 옮긴다', () => {
    assert.deepStrictEqual(tableOf('fcnt.js', 'HD_ATTRS'), {
        dooLk: ['lock'], bat: ['lvl'], tempe: ['curT0'], binSh: ['powerSe'],
        fauDn: ['sus'], colSn: ['colSn'], color: ['red', 'green', 'blue'], brigs: ['brigs']
    });
});
