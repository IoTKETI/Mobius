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
    assert.ok(/request\.ty_hint != null && !ty_list\.includes\(String\(request\.ty_hint\)\)/.test(s),
        'ty_list 기반 관문이 없다');
    for (const ty of GONE_TY) {
        assert.ok(!new RegExp("request\\.ty == '" + ty + "'").test(s),
            'ty=' + ty + ' 를 위한 개별 분기가 남아 있다 — 목록으로 충분하다');
    }
    // ty=5(CSEBase)는 목록에 **있지만** 남이 만들 수 없다. 다른 사유라 따로 둔다.
    assert.ok(/request\.ty_hint == '5'[\s\S]{0,60}405-1/.test(s),
        'CSEBase 생성을 막는 분기가 사라졌다');
});

test('헤더 관문은 ty_hint 만 본다 — 센티널로 빈칸을 메우지 않는다', function () {
    // 알림 POST 와 WS/MQTT PUT 은 Content-Type 에 ty 를 안 붙인다. "안 줬다" 를
    // 값으로 표현하면(예전의 request.ty = '99') 그 값이 목록에 없어서 정상
    // 요청이 전부 막히거나, 목록에 넣으면 이번엔 typeRsrc 의 실제 키('rsp')와
    // 겹쳐 DELETE 의 headers.rootnm 까지 오염된다. "안 줬다" 는 null 이어야 한다.
    const s = src('app.js');
    assert.ok(!/request\.ty = '99'/.test(s),
        "센티널 request.ty = '99' 가 되살아났다 — typeRsrc['99'] 는 'rsp' 다");

    const gate = s.match(/ty 를 명시했으면[\s\S]{0,900}?\n        \}/);
    assert.ok(gate, '관문을 못 찾았다');
    assert.ok(!/!ty_list\.includes\(String\(request\.ty\)\)/.test(gate[0]),
        'request.ty 로 판단하면 ty 없는 알림 POST 가 전부 막힌다');

    // 헤더 구간(해석 전)에서 request.ty 를 읽으면 undefined 를 본다.
    // 그 구간의 판단은 전부 ty_hint 여야 한다.
    const head = s.slice(s.indexOf('function check_xm2m_headers'),
                         s.indexOf('function check_resource_supported'))
                  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/request\.ty[^_a-zA-Z]/.test(head),
        'check_xm2m_headers 가 아직 request.ty 를 읽는다 — 여기서는 ty_hint 다');
    assert.ok(/request\.ty_hint == '5'[\s\S]{0,60}405-1/.test(head),
        'CSEBase 생성을 막는 분기가 ty_hint 를 보지 않는다');
});

test('request.ty 대입은 해석 지점 두 곳뿐이다', function () {
    // request.ty 는 "서버가 본문까지 보고 확정한 타입" 이다. 확정 전에
    // 값을 넣어 두면 그 값이 곧 거짓말이 된다 — '99' 가 그랬다.
    const s = src('app.js');
    const writes = (s.match(/^\s*request\.ty = /gm) || []).length;
    assert.strictEqual(writes, 2,
        'request.ty 대입이 ' + writes + '곳이다 — check_resource_supported 와 ' +
        'check_type_update_resource 의 resolve 결과 두 곳이어야 한다');
});
