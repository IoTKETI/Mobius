'use strict';
// Pins that unsupported resource types do not return to the lists.
//
//   17 req  no path creates it since non-blocking requests are unsupported (migrations/003 removed the table)
//   38 tm   distributed transaction coordinator (migrations/008 removed the table)
//   39 tr   distributed transaction target       (migrations/008 removed the table)
//
// Reviving even one list is silently harmful: back in typeRsrc, discovery reads a missing table; an attribute table alone advertises a creatable type.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The adapter names the schema file path; no directory is prepended here.
const schema = (backend) => fs.readFileSync(require('../mobius/db/' + backend).schemaPath, 'utf8');

const GONE_TY = ['17', '38', '39'];
const GONE_NM = ['req', 'tm', 'tr'];

test('typeRsrc 에 17 / 38 / 39 가 없다', function () {
    const responder = require('../mobius/responder');
    for (const ty of GONE_TY) {
        assert.ok(!responder.typeRsrc.hasOwnProperty(ty),
            'typeRsrc 에 ' + ty + ' 가 있다 -> ' + responder.typeRsrc[ty]);
    }
    // Conversely, these must be present.
    assert.strictEqual(responder.typeRsrc['3'], 'cnt');
    assert.strictEqual(responder.typeRsrc['4'], 'cin');
});

test('ty_list 에 17 / 38 / 39 가 없다', function () {
    // Discovery reads a table per type. A missing table breaks it.
    const m = src('mobius/resource.js').match(/global\.ty_list = \[([^\]]*)\]/);
    assert.ok(m, 'ty_list 를 못 찾았다');
    const list = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    for (const ty of GONE_TY) {
        assert.ok(list.indexOf(ty) < 0, 'ty_list 에 ' + ty + ' 가 있다');
    }
});

test('속성표에 req / tm / tr 이 없다', function () {
    // An attribute table alone reads as a creatable type.
    const s = src('mobius/resource.js');
    for (const nm of GONE_NM) {
        for (const tbl of ['create_np_attr_list', 'create_m_attr_list', 'create_opt_attr_list',
                           'update_np_attr_list', 'update_m_attr_list', 'update_opt_attr_list']) {
            const re = new RegExp(tbl + '\\.' + nm + '\\s*=|' + tbl + "\\['" + nm + "'\\]\\s*=");
            assert.ok(!re.test(s), tbl + '.' + nm + ' 이 남아 있다');
        }
    }
});

test('CSEBase 가 광고하는 srt 는 ty_list 그대로다', function () {
    // The list must not be a hand-written subset. smd(24) / mms(27) / fcnt(28) / hd_*(91..98) are creatable and must be advertised; two diverging lists make one of them a lie.
    const s = src('mobius/cb.js');
    assert.ok(/\.srt = ty_list\.slice\(\)/.test(s),
        'srt 가 ty_list 를 그대로 쓰지 않는다 — 손으로 적은 목록은 갈라진다');
    assert.ok(!/\.srt = \[/.test(s), 'srt 에 리터럴 목록이 남아 있다');
    // GONE_TY is not in ty_list (test above), so it is automatically absent from srt.
});

test('srt 직렬화 길이가 cb.srt 컬럼 폭 안에 들어간다', function () {
    // Overflow fails the CSEBase update under STRICT_TRANS_TABLES. Adding types must be caught here, not in deployment.
    const m = schema('mysql').match(/`srt` varchar\((\d+)\)/);
    assert.ok(m, 'cb.srt 선언을 못 찾았다');
    const width = parseInt(m[1], 10);

    const t = src('mobius/resource.js').match(/global\.ty_list = \[([^\]]*)\]/);
    const list = t[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    const len = JSON.stringify(list).length;

    assert.ok(len <= width,
        'srt 직렬화가 ' + len + '자인데 컬럼은 varchar(' + width + ') 다 — ' +
        '마이그레이션으로 넓혀야 한다');
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
    for (const backend of ['mysql', 'sqlite']) {
        const s = schema(backend);
        for (const nm of GONE_NM) {
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + nm + '`?\\s*\\(', 'i');
            assert.ok(!re.test(s), backend + ' 스키마에 ' + nm + ' 테이블이 있다');
        }
    }
});

test('목록에 없는 ty 는 목록만 보고 막는다 — 타입별 분기가 아니다', function () {
    // Removing a type from the list must reject the request. A per-type branch (ty=17 -> 405-2) would have to be edited on every removal and, if forgotten, the request would only fail down in build_resource.
    const s = src('app.js');
    assert.ok(/request\.ty != null && !ty_list\.includes\(String\(request\.ty\)\)/.test(s),
        'ty_list 기반 관문이 없다');
    for (const ty of GONE_TY) {
        assert.ok(!new RegExp("request\\.ty == '" + ty + "'").test(s),
            'ty=' + ty + ' 를 위한 개별 분기가 남아 있다 — 목록으로 충분하다');
    }
    // ty=5 (CSEBase) is in the list but cannot be created by others. Different reason, kept separate.
    assert.ok(/request\.ty == '5'[\s\S]{0,60}405-1/.test(s),
        'CSEBase 생성을 막는 분기가 사라졌다');
});

test('"ty 를 안 줬다" 는 null 이다 — 타입 값으로 표시하지 않는다', function () {
    // A PUT without ty in Content-Type must be represented as null. A value outside the list ('99') would make the gate block normal requests; a value inside the list would impersonate that type. '99' is actually a typeRsrc key ('rsp'), which leaked into DELETE's headers.rootnm. null collides with no type value.
    const s = src('app.js');
    assert.ok(/^\s*request\.ty = null;/m.test(s),
        '기본값이 null 이 아니다 — "안 줬다" 는 값이 아니라 null 이어야 한다');
    assert.ok(!/request\.ty = '\d/.test(s),
        'request.ty 에 리터럴 타입 값을 미리 넣는 곳이 있다 — 센티널이 되살아났다');

    // The gate must detect 'not given' with a null check. A plain list comparison would block every request without ty.
    const gate = s.match(/An explicit ty must be a type this CSE handles[\s\S]{0,900}?\n        \}/);
    assert.ok(gate, '관문을 못 찾았다');
    assert.ok(/request\.ty != null &&/.test(gate[0]),
        '관문에 null 검사가 없다 — ty 없는 PUT 이 전부 막힌다');
});

test('ty 를 담는 필드는 request.ty 하나뿐이다', function () {
    // There is no reason to hold the header's ty and the resolved ty separately: type_resolver never overrides the header value (mismatch -> 400-42, match -> refined from the body, e.g. ty=28 + hd:dooLk -> 98). Two fields would require deciding which one to read every time.
    for (const f of ['app.js', 'mobius/resource.js', 'mobius/type_resolver.js',
                     'mobius/responder.js', 'mobius/sgn.js']) {
        assert.ok(!/request\.ty_hint/.test(src(f)),
            f + ' 에 request.ty_hint 가 남아 있다 — 필드는 request.ty 하나다');
    }

    // What is passed to resolve is request.ty at that point (the header's value).
    const s = src('app.js');
    assert.ok(/type_resolver\.resolve\(request\.rawRootKey, request\.ty\)/.test(s),
        'resolve 에 헤더 유래 ty 를 안 넘긴다 — 불일치 대조가 사라진다');
});
