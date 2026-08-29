'use strict';
// cr(생성자)은 서버가 정한다.
//
// security.js 의 creator_bypasses 가 들어온 뒤로 cr 은 곧 권한이다. 예전에는
// CREATE 본문의 cr 을 그대로 받아서, 아무나 남의 이름으로 리소스를 만들 수
// 있었다 — 실측으로 HTTP 201 이 나오고 cr 이 피해자 ID 로 저장됐다.
//
// 리소스 빌더는 request/DB 없이 부르기 어려우므로 소스를 읽어 못박는다.
// 값싸고, 새 리소스 타입이 같은 실수를 복사해 올 때 바로 걸린다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MOBIUS = path.join(__dirname, '..', 'mobius');

// cr 컬럼을 가진, 클라이언트가 만들 수 있는 리소스 타입들
const BUILDERS = ['cnt.js', 'cin.js', 'fcnt.js', 'grp.js', 'smd.js', 'sub.js', 'tm.js', 'tr.js'];

function source(f) {
    return fs.readFileSync(path.join(MOBIUS, f), 'utf8');
}

test('빌더 여덟은 cr 을 x-m2m-origin 에서만 가져온다', function () {
    for (const f of BUILDERS) {
        const src = source(f);
        assert.ok(/\.cr = request\.headers\['x-m2m-origin'\]/.test(src),
            f + ' 가 cr 을 x-m2m-origin 에서 가져오지 않는다');
    }
});

test('빌더 어디에도 본문의 cr 을 쓰는 곳이 없다', function () {
    for (const f of BUILDERS) {
        const src = source(f);
        // 주석은 걷어내고 본다 — 이 규칙을 설명하는 주석에 body_Obj…cr 이 나온다.
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/body_Obj\[rootnm\]\.cr/.test(code),
            f + ' 가 아직 본문의 cr 을 읽는다 — 남의 이름으로 리소스를 만들 수 있다');
    }
});

// update_body 는 본문에 실린 속성을 **전부** 그대로 옮긴다(화이트리스트가 아니다).
// 그래서 cr 을 막는 것은 오직 앞단의 속성표뿐이다. 표에서 빠지면 그 순간
// 소유권이 넘어간다 — resource.js 를 require 하면 sgn_man 까지 딸려 와
// 전역이 없다고 죽으므로, 표를 소스에서 읽는다.
function attrList(name, ty) {
    const src = fs.readFileSync(path.join(MOBIUS, 'resource.js'), 'utf8');
    const re = new RegExp(name + "(?:\\." + ty + "|\\['" + ty + "'\\])\\s*=\\s*\\[([^\\]]*)\\]");
    const m = src.match(re);
    return m === null ? null : m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

// cr 컬럼이 있으면서 UPDATE 속성표를 가진 타입 전부
const UPDATABLE_WITH_CR = ['cnt', 'sub', 'grp', 'smd', 'mms', 'tm', 'tr', 'fcnt', 'lcp', 'nod'];

test('cr 은 어느 타입에서도 UPDATE 로 통과하지 못한다', function () {
    for (const ty of UPDATABLE_WITH_CR) {
        const np = attrList('update_np_attr_list', ty);
        const opt = attrList('update_opt_attr_list', ty);
        const man = attrList('update_m_attr_list', ty);
        assert.ok(np !== null, ty + ' 의 update_np_attr_list 를 못 찾았다');
        // 옵션·필수에 있으면 통과해 버린다. 없으면 400-22(np) 또는 400-25 로 막힌다.
        assert.ok(!(opt || []).includes('cr'), ty + ' 의 UPDATE 옵션 목록에 cr 이 있다');
        assert.ok(!(man || []).includes('cr'), ty + ' 의 UPDATE 필수 목록에 cr 이 있다');
    }
});

test('update_body 는 화이트리스트가 아니다 — 표가 유일한 방어선이다', function () {
    // 이 사실이 바뀌면 위 테스트의 전제가 무너지므로 함께 못박는다.
    const src = fs.readFileSync(path.join(MOBIUS, 'resource.js'), 'utf8');
    const m = src.match(/global\.update_body = function[\s\S]*?\n\};/);
    assert.ok(m, 'update_body 를 찾지 못했다');
    assert.ok(/for \(var attr in body_Obj\[rootnm\]\)/.test(m[0]),
        'update_body 가 더는 본문 전체를 훑지 않는다 — 방어선이 바뀌었으니 이 파일을 다시 보라');
});
