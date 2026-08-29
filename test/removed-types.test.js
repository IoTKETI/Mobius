'use strict';
// 지원하지 않기로 한 리소스 타입이 목록에 되살아나지 않게 못박는다.
//
//   17 req  논블로킹 미지원으로 만드는 경로가 없다 (migrations/003 이 테이블 제거)
//   38 tm   분산 트랜잭션 조정자      (migrations/008 이 테이블 제거)
//   39 tr   분산 트랜잭션 대상        (migrations/008 이 테이블 제거)
//
// 목록 하나만 되살아나도 조용히 나쁘다. typeRsrc 에 다시 들어가면 discovery 가
// 없는 테이블을 읽고, 속성표만 남으면 "만들 수 있는 타입" 으로 읽힌다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const GONE_TY = ['17', '38', '39'];
const GONE_NM = ['req', 'tm', 'tr'];

test('typeRsrc 에 17 / 38 / 39 가 없다', function () {
    const responder = require('../mobius/responder');
    for (const ty of GONE_TY) {
        assert.ok(!responder.typeRsrc.hasOwnProperty(ty),
            'typeRsrc 에 ' + ty + ' 가 있다 -> ' + responder.typeRsrc[ty]);
    }
    // 반대로 살아 있어야 하는 것들
    assert.strictEqual(responder.typeRsrc['3'], 'cnt');
    assert.strictEqual(responder.typeRsrc['4'], 'cin');
});

test('ty_list 에 17 / 38 / 39 가 없다', function () {
    // discovery 가 타입마다 테이블을 읽는다. 없는 테이블이 들어가면 깨진다.
    const m = src('mobius/resource.js').match(/global\.ty_list = \[([^\]]*)\]/);
    assert.ok(m, 'ty_list 를 못 찾았다');
    const list = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    for (const ty of GONE_TY) {
        assert.ok(list.indexOf(ty) < 0, 'ty_list 에 ' + ty + ' 가 있다');
    }
});

test('속성표에 req / tm / tr 이 없다', function () {
    // 표만 남으면 "만들 수 있는 타입" 으로 읽힌다.
    const s = src('mobius/resource.js');
    for (const nm of GONE_NM) {
        for (const tbl of ['create_np_attr_list', 'create_m_attr_list', 'create_opt_attr_list',
                           'update_np_attr_list', 'update_m_attr_list', 'update_opt_attr_list']) {
            const re = new RegExp(tbl + '\\.' + nm + '\\s*=|' + tbl + "\\['" + nm + "'\\]\\s*=");
            assert.ok(!re.test(s), tbl + '.' + nm + ' 이 남아 있다');
        }
    }
});

test('CSEBase 가 광고하는 srt 에 17 / 38 / 39 가 없다', function () {
    const m = src('mobius/cb.js').match(/\.srt = \[([^\]]*)\]/);
    assert.ok(m, 'srt 를 못 찾았다');
    const list = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    for (const ty of GONE_TY) {
        assert.ok(list.indexOf(ty) < 0, 'srt 에 ' + ty + ' 가 있다');
    }
});

test('tm.js / tr.js 를 부르는 곳이 없다', function () {
    const files = ['app.js'].concat(
        fs.readdirSync(path.join(ROOT, 'mobius'))
            .filter((f) => f.endsWith('.js')).map((f) => 'mobius/' + f));
    const bad = [];
    for (const f of files) {
        const code = src(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        if (/require\(['"]\.\/(tm|tr)['"]\)/.test(code)) { bad.push(f); }
    }
    assert.deepStrictEqual(bad, []);
});

test('스키마 파일에 req / tm / tr 테이블이 없다', function () {
    for (const f of ['mobius/mobiusdb.sql', 'mobius/mobiusdb_sqlite.sql']) {
        const s = src(f);
        for (const nm of GONE_NM) {
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + nm + '`?\\s*\\(', 'i');
            assert.ok(!re.test(s), f + ' 에 ' + nm + ' 테이블이 있다');
        }
    }
});

test('ty=17 요청은 여전히 막는다', function () {
    // 목록에서 뺐다고 요청이 통과하면 안 된다. app.js 가 405-2 로 막는다.
    assert.ok(/request\.ty == '17'[\s\S]{0,80}405-2/.test(src('app.js')),
        'ty=17 을 막는 분기가 사라졌다');
});
