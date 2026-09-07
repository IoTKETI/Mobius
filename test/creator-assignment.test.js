'use strict';
// cr (creator) is assigned by the server.
//
// Since creator_bypasses in security.js, cr is authority. Taking cr from the CREATE body would let anyone create a resource under another's name.
//
// The resource builders are hard to call without request/DB, so the source is pinned; cheap, and a new resource type copying the same mistake is caught at once.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MOBIUS = path.join(__dirname, '..', 'mobius');

// Resource types with a cr column that clients can create.
// tm.js / tr.js were removed with the transaction resources (ty=38/39).
const BUILDERS = ['cnt.js', 'cin.js', 'fcnt.js', 'grp.js', 'smd.js', 'sub.js'];

function source(f) {
    return fs.readFileSync(path.join(MOBIUS, f), 'utf8');
}

test('빌더 여섯은 cr 을 x-m2m-origin 에서만 가져온다', function () {
    for (const f of BUILDERS) {
        const src = source(f);
        assert.ok(/\.cr = request\.headers\['x-m2m-origin'\]/.test(src),
            f + ' 가 cr 을 x-m2m-origin 에서 가져오지 않는다');
    }
});

test('빌더 어디에도 본문의 cr 을 쓰는 곳이 없다', function () {
    for (const f of BUILDERS) {
        const src = source(f);
        // Comments are stripped first; a comment explaining this rule contains body_Obj...cr.
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/body_Obj\[rootnm\]\.cr/.test(code),
            f + ' 가 아직 본문의 cr 을 읽는다 — 남의 이름으로 리소스를 만들 수 있다');
    }
});

// update_body copies every attribute in the body as is (not a whitelist), so the only thing that blocks cr is the attribute table in front. A table entry hands over ownership; resource.js cannot be required (sgn_man comes with it and dies without globals), so the table is read from the source.
function attrList(name, ty) {
    const src = fs.readFileSync(path.join(MOBIUS, 'resource.js'), 'utf8');
    const re = new RegExp(name + "(?:\\." + ty + "|\\['" + ty + "'\\])\\s*=\\s*\\[([^\\]]*)\\]");
    const m = src.match(re);
    return m === null ? null : m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

// Every type with a cr column and an UPDATE attribute table
const UPDATABLE_WITH_CR = ['cnt', 'sub', 'grp', 'smd', 'mms', 'fcnt', 'lcp', 'nod'];

test('cr 은 어느 타입에서도 UPDATE 로 통과하지 못한다', function () {
    for (const ty of UPDATABLE_WITH_CR) {
        const np = attrList('update_np_attr_list', ty);
        const opt = attrList('update_opt_attr_list', ty);
        const man = attrList('update_m_attr_list', ty);
        assert.ok(np !== null, ty + ' 의 update_np_attr_list 를 못 찾았다');
        // In the optional or mandatory list it would pass; absent, it is blocked with 400-22 (np) or 400-25.
        assert.ok(!(opt || []).includes('cr'), ty + ' 의 UPDATE 옵션 목록에 cr 이 있다');
        assert.ok(!(man || []).includes('cr'), ty + ' 의 UPDATE 필수 목록에 cr 이 있다');
    }
});

test('update_body 는 화이트리스트가 아니다 — 표가 유일한 방어선이다', function () {
    // The test above rests on this fact, so it is pinned with it.
    const src = fs.readFileSync(path.join(MOBIUS, 'resource.js'), 'utf8');
    const m = src.match(/global\.update_body = function[\s\S]*?\n\};/);
    assert.ok(m, 'update_body 를 찾지 못했다');
    assert.ok(/for \(var attr in body_Obj\[rootnm\]\)/.test(m[0]),
        'update_body 가 더는 본문 전체를 훑지 않는다 — 방어선이 바뀌었으니 이 파일을 다시 보라');
});
