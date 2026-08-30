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

test('CSEBase 가 광고하는 srt 는 ty_list 그대로다', function () {
    // 손으로 적은 부분집합이었다. smd(24) / mms(27) / fcnt(28) / hd_*(91~98) 를
    // 실제로는 만들 수 있는데 광고하지 않아, 목록을 믿는 클라이언트는 쓸 수
    // 있는 것을 안 썼다. 두 목록이 갈라지면 어느 쪽이든 거짓말이 된다.
    const s = src('mobius/cb.js');
    assert.ok(/\.srt = ty_list\.slice\(\)/.test(s),
        'srt 가 ty_list 를 그대로 쓰지 않는다 — 손으로 적은 목록은 갈라진다');
    assert.ok(!/\.srt = \[/.test(s), 'srt 에 리터럴 목록이 남아 있다');
    // GONE_TY 는 ty_list 에 없으므로(위 테스트) srt 에도 자동으로 없다.
});

test('srt 직렬화 길이가 cb.srt 컬럼 폭 안에 들어간다', function () {
    // 넘치면 STRICT_TRANS_TABLES 에서 CSEBase 갱신이 실패한다. 타입을 더
    // 넣다가 넘기면 배포가 아니라 여기서 먼저 걸려야 한다.
    // (csr.poa 가 varchar(200) 을 넘겨 깨진 JSON 이 됐던 것과 같은 종류다.)
    const m = src('mobius/mobiusdb.sql').match(/`srt` varchar\((\d+)\)/);
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
    for (const f of ['mobius/mobiusdb.sql', 'mobius/mobiusdb_sqlite.sql']) {
        const s = src(f);
        for (const nm of GONE_NM) {
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + nm + '`?\\s*\\(', 'i');
            assert.ok(!re.test(s), f + ' 에 ' + nm + ' 테이블이 있다');
        }
    }
});

test('목록에 없는 ty 는 목록만 보고 막는다 — 타입별 분기가 아니다', function () {
    // 목록에서 뺐다고 요청이 통과하면 안 된다. 예전에는 타입마다 분기를 하나씩
    // 더했는데(ty=17 -> 405-2), 그러면 타입을 뺄 때마다 여기도 고쳐야 하고
    // 빠뜨리면 build_resource 까지 내려가서야 걸린다.
    const s = src('app.js');
    assert.ok(/request\.ty != null && !ty_list\.includes\(String\(request\.ty\)\)/.test(s),
        'ty_list 기반 관문이 없다');
    for (const ty of GONE_TY) {
        assert.ok(!new RegExp("request\\.ty == '" + ty + "'").test(s),
            'ty=' + ty + ' 를 위한 개별 분기가 남아 있다 — 목록으로 충분하다');
    }
    // ty=5(CSEBase)는 목록에 **있지만** 남이 만들 수 없다. 다른 사유라 따로 둔다.
    assert.ok(/request\.ty == '5'[\s\S]{0,60}405-1/.test(s),
        'CSEBase 생성을 막는 분기가 사라졌다');
});

test('"ty 를 안 줬다" 는 null 이다 — 타입 값으로 표시하지 않는다', function () {
    // WS/MQTT 의 PUT 은 Content-Type 에 ty 를 안 붙인다. "안 줬다" 를 타입
    // 값으로 표시하면 둘 중 하나가 된다. 목록 밖 값('99')이면 관문이 정상
    // 요청을 막고, 목록 안 값이면 그 타입인 척한다. 실제로 '99' 는 typeRsrc 의
    // 키('rsp')여서 DELETE 의 headers.rootnm 이 'rsp' 로 새어 나갔다.
    // null 은 어떤 타입 값과도 겹치지 않는다.
    const s = src('app.js');
    assert.ok(/^\s*request\.ty = null;/m.test(s),
        '기본값이 null 이 아니다 — "안 줬다" 는 값이 아니라 null 이어야 한다');
    assert.ok(!/request\.ty = '\d/.test(s),
        'request.ty 에 리터럴 타입 값을 미리 넣는 곳이 있다 — 센티널이 되살아났다');

    // 관문은 null 검사로 "안 줬다" 를 걸러야 한다. 그냥 목록 대조만 하면
    // ty 없는 요청이 전부 막힌다.
    const gate = s.match(/ty 를 명시했으면[\s\S]{0,900}?\n        \}/);
    assert.ok(gate, '관문을 못 찾았다');
    assert.ok(/request\.ty != null &&/.test(gate[0]),
        '관문에 null 검사가 없다 — ty 없는 PUT 이 전부 막힌다');
});

test('ty 를 담는 필드는 request.ty 하나뿐이다', function () {
    // 헤더가 말한 ty 와 확정된 ty 를 따로 들 이유가 없다. type_resolver 가
    // 헤더 값을 뒤집지 않기 때문이다 — 어긋나면 400-42 로 끊고, 맞으면 본문
    // 쪽으로 정밀해질 뿐이다(ty=28 + hd:dooLk -> 98). 필드를 둘로 나누면
    // "지금 어느 쪽을 읽어야 하나" 를 매번 따져야 한다.
    for (const f of ['app.js', 'mobius/resource.js', 'mobius/type_resolver.js',
                     'mobius/responder.js', 'mobius/sgn.js']) {
        assert.ok(!/request\.ty_hint/.test(src(f)),
            f + ' 에 request.ty_hint 가 남아 있다 — 필드는 request.ty 하나다');
    }

    // resolve 에 넘기는 것은 그 시점의 request.ty(= 헤더가 말한 값)여야 한다.
    const s = src('app.js');
    assert.ok(/type_resolver\.resolve\(request\.rawRootKey, request\.ty\)/.test(s),
        'resolve 에 헤더 유래 ty 를 안 넘긴다 — 불일치 대조가 사라진다');
});
