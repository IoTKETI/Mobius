'use strict';
// responder 의 응답 함수를 **위치 인자로** 부르는 자리의 개수 계약.
//
// ── 왜 이 시험이 있나
//
// mobius/responder.js 의 응답 함수들은 위치 인자를 여섯 개 받는다:
//
//     response_result(request, response, status, rsc, cap, callback)
//
// 일곱 개를 넘기면 넷째부터 한 칸씩 당겨진다. 그러면 두 가지가 동시에 터진다.
//
//   1. rsc 자리에 객체가 간다 -> apply_headers 가
//      `response.header('X-M2M-RSC', rsc)` 를 하므로 **X-M2M-RSC: [object Object]**
//   2. callback 자리에 문자열이 간다 -> `callback()` 에서 **TypeError -> 워커 사망**
//
// **이 저장소에서 두 번 일어났다.**
//
//   (1) app.js 의 check_grp — 같은 밀림이었고, 게다가 response_result 가
//       읽는 request.resourceObj 를 세우지 않아 Object.keys(undefined) 로
//       워커가 죽었다. 재현: GET /Mobius/fopt. 호출부가 이미 응답하고
//       있었으므로 그 호출 자체가 중복이라 **지워서** 고쳤다.
//   (2) mobius/resource.js 의 create_resource — 같은 밀림이 네 곳.
//       그 함수는 아무도 안 부르는 죽은 코드였고 살아 있는 쌍둥이
//       (build_resource)가 카탈로그 코드를 콜백으로 돌려주는 옳은 형태였다.
//       2026-09-04 에 **함수째 지웠다.**
//
// 위치 인자가 여섯 개나 되는 한 이 부류는 계속 돌아온다. 개수를 세어 둔다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// **주석은 걷어낸다.** 안 걷어내면 설명 문장이 검사를 통과시킨다 —
// 이 저장소가 여섯 번 겪은 함정이고, 바로 위 주석에도 예시 호출이 적혀 있다.
function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// 한 줄로 적힌 호출의 인자 개수를 센다. 괄호 깊이 1 에서의 콤마만 센다 —
// 인자 안의 함수 호출이나 객체 리터럴에 든 콤마를 같이 세면 헛돈다.
function arity(call) {
    var depth = 0;
    var n = 1;
    var started = false;
    var closed = false;
    for (var i = 0; i < call.length; i++) {
        var c = call[i];
        if (c === '(' || c === '[' || c === '{') { depth++; started = true; continue; }
        if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { closed = true; break; } continue; }
        if (c === ',' && depth === 1) { n++; }
    }
    // 한 줄에서 닫히지 않은 호출(`respond(request, response, {` 처럼 객체 리터럴이
    // 다음 줄로 이어지는 것)은 이 검사의 대상이 아니다 — 세다 만 값을 돌려주면
    // 인자 3개짜리 호출로 잘못 잡힌다.
    return started && closed ? n : 0;
}

// responder 의 위치 인자 응답 함수들. 시그니처가 바뀌면 여기도 바꾼다.
// 1단계 3번에서 여섯째 인자 cap 을 뺐다 — 네 자리 전부에서 만들었다 버려지던
// 값이라 응답에 한 번도 안 나타났다. error_result 는 호출자 0 이라 같이 지웠다.
// 2단계 10번에서 response_result / response_rcn3_result / search_result 셋을
// 지웠다 — 정산기(settle.done)가 결과 객체를 받아 body_of 와 respond 로 간다.
// 남은 것은 배출구 respond 와 본문 조립 body_of 둘이고, 위치 인자가 넷 이하다.
const EXPECTED = {
    respond: 4,
    body_of: 2
};

test('responder 의 응답 함수는 선언한 인자 개수를 그대로 받는다', function () {
    const src = code('mobius/responder.js');
    Object.keys(EXPECTED).forEach(function (name) {
        const m = src.match(new RegExp('exports\\.' + name + '\\s*=\\s*function\\s*\\(([^)]*)\\)'));
        assert.ok(m, 'responder.' + name + ' 선언을 못 찾았다 — 이 시험의 전제가 바뀌었다');
        const n = m[1].split(',').filter(function (s) { return s.trim(); }).length;
        assert.strictEqual(n, EXPECTED[name],
            'responder.' + name + ' 이 인자 ' + n + '개를 받는다 — 아래 호출부 검사의 기준값도 같이 고칠 것');
    });
});

test('responder 응답 함수를 인자 개수 맞게 부른다', function () {
    // **비었다. P2 3.2 가 끝났다.**
    //
    // 마지막 위반은 mgmtObj 의 mgd 분기 끝(create_action)에 있었고
    // 2026-09-04 에 callback('400-53') 으로 바꿨다. 형제 다섯이 이미 그
    // 형태였고, 카탈로그의 400-53 문구가 글자까지 같으며, mgmtObj update
    // 경로 두 곳이 이미 그 코드를 쓰고 있었다 — create 경로만 옛 방식으로
    // 남아 있었던 것이다.
    //
    // **개수만 세면 안 된다.** 이미 위반인 자리에 인자를 하나 더 붙여도
    // "위반 1곳" 은 그대로라 통과한다(변이로 확인했다). 그래서 어느
    // 함수를 **몇 개로** 부르고 있는지까지 못박는다.
    //
    // 목록은 **줄어들기만 해야 한다.**
    const KNOWN_BAD = [];

    const files = ['app.js', 'mobius/resource.js', 'mobius/responder.js',
                   'mobius/settle.js', 'mobius/fopt.js', 'mobius/sgn.js'];
    const bad = [];      // 'response_result:7' 형태
    const where = [];    // 사람이 읽을 위치

    files.forEach(function (rel) {
        const lines = code(rel).split(/\r?\n/);
        lines.forEach(function (l, i) {
            Object.keys(EXPECTED).forEach(function (name) {
                const at = l.indexOf('responder.' + name + '(');
                if (at < 0) { return; }
                const n = arity(l.slice(at));
                // 한 줄에 안 담긴 호출은 0 이 나온다 — 그건 이 검사의 대상이 아니다.
                if (n === 0 || n === EXPECTED[name]) { return; }
                bad.push(name + ':' + n);
                where.push(rel + ':' + (i + 1) + '  ' + name + ' 에 인자 ' + n + '개 (기대 ' + EXPECTED[name] + ')');
            });
        });
    });

    assert.deepStrictEqual(bad.sort(), KNOWN_BAD.slice().sort(),
        '인자 개수가 안 맞는 호출이 달라졌다:\n  ' + where.join('\n  ') +
        '\n  넷째 인자부터 한 칸씩 밀려 X-M2M-RSC 에 객체가 나가고 callback() 이 TypeError 를 낸다' +
        '\n  고쳤으면 KNOWN_BAD 에서 그 항목을 지울 것');
});

test('mgmtObj 의 mgd 분기가 형제와 같게 코드만 돌려준다', function () {
    // create_action 의 ty=13 분기는 mgd 다섯(1001 fwr · 1006 bat · 1007 dvi ·
    // 1008 dvc · 1009 rbo)을 각각 insert 로 보내고, 그 밖은 거절한다.
    // 형제 다섯은 전부 callback('200'/'409-5'/'500-4') 인데 마지막 else 만
    // 응답을 직접 보내고 있었다 — 그것도 인자가 밀린 채로.
    //
    // **지금 이 자리는 도달하지 않는다.** mgmtObj 구체 타입이 typeRsrc 에
    // 없어서 type_resolver 가 400-3 으로 먼저 끊는다(일부러 막아 둔 것).
    // 그래도 못박아 두는 이유는, mgmtObj 를 여는 날 이 자리가 처음 밟히는데
    // 그때 [object Object] 헤더와 워커 사망이 기다리고 있으면 안 되기 때문이다.
    const src = code('mobius/resource.js');

    // ty=13 분기만 잘라서 본다. 다른 분기의 문자열에 걸리면 헛돈다.
    const at = src.indexOf("else if (ty == '13')");
    assert.ok(at > 0, "create_action 의 ty=13 분기를 못 찾았다 — 이 시험의 전제가 바뀌었다");

    // 끝은 **다음 ty 분기가 무엇이든** 거기까지다. 특정 타입 번호를 경계로
    // 박아 두면 그 분기를 손대는 무관한 편집에 이 시험이 부서진다.
    const rest = src.slice(at + 1);
    const m = rest.match(/else if \(ty == '\d+'/);
    const end = m ? at + 1 + m.index : src.length;
    const branch = src.slice(at, end);

    assert.ok(branch.indexOf("callback('400-53')") >= 0,
        'mgmtObj 의 알 수 없는 mgd 갈래가 400-53 으로 답하지 않는다');
    assert.strictEqual(/responder\./.test(branch), false,
        'mgmtObj 분기가 responder 를 직접 부른다 — 응답은 라우트의 정산기가 한다');
    assert.strictEqual(/callback\('0'/.test(branch), false,
        "카탈로그에 없는 '0' 을 위로 올린다 — 그 코드는 reason.get 이 null 을 내고 500 이 된다");
});

test('resource.js 는 응답을 직접 보내지 않는다', function () {
    // **응답은 라우트의 정산기(settle)가 한 번만 한다.** 하위 모듈이 직접
    // 보내면 두 가지가 동시에 열린다 — 정산기의 이중 정산 방어가 안 걸리고
    // (첫 응답이 claim 되지 않았으므로), 하위가 코드까지 위로 올리면 라우트가
    // 이미 끝난 응답에 또 쓴다.
    //
    // 그 상태가 실제로 어땠는지는 mgmtObj 자리에서 확인됐다. 관문을 걷어낸
    // 사본에서 재현하니 `X-M2M-RSC: [object Object]` 와 워커 사망이 동시에
    // 났고, **커넥션 하나가 반납되지 않았다.**
    //
    // 그리고 인자 밀림만 고쳤다면 **없던 결함이 새로 생겼다** — TypeError 가
    // 사라지면서 그 다음 줄의 callback('0') 이 실행되고, 카탈로그에 없는
    // '0' 이 settle.error 까지 올라가 이미 끝난 응답에 500 을 또 보낸다.
    //
    // ── 허용목록을 쓰지 않는다
    //
    // "이 함수들만 금지" 로 적으면 목록에 없는 것이 뚫린다. 특히
    // responder.respond 는 CLAUDE.md 가 **단일 응답 진입점**이라 부르는
    // 바로 그것인데, 금지 목록에서 빠뜨리기 쉽다. 그래서 **응답을 만드는
    // 것이 아니라 데이터를 읽는 것만 허용**하는 반대 방향으로 잠근다.
    const src = code('mobius/resource.js');

    // 데이터 조회용 — 표를 읽을 뿐 응답을 만들지 않는다.
    const DATA_ONLY = ['typeRsrc', 'mgoType', 'typeCheckforJson'];

    const bad = [];
    src.split(/\r?\n/).forEach(function (l, i) {
        const m = l.match(/responder\.([A-Za-z0-9_]+)/g);
        if (!m) { return; }
        m.forEach(function (hit) {
            const name = hit.slice('responder.'.length);
            if (DATA_ONLY.indexOf(name) >= 0) { return; }
            bad.push('resource.js:' + (i + 1) + '  ' + hit);
        });
    });

    assert.deepStrictEqual(bad, [],
        'resource.js 가 responder 의 응답 함수를 직접 부른다:\n  ' + bad.join('\n  ') +
        '\n  코드만 callback 으로 올리고 응답은 라우트의 정산기에 맡길 것' +
        '\n  (표를 읽기만 하는 것이면 이 시험의 DATA_ONLY 에 추가할 것)');
});

test('죽은 create_resource 가 되살아나지 않았다', function () {
    // 53줄짜리 함수였고 아무도 안 불렀다. 같은 일을 하는 build_resource 가
    // 살아 있고, 그쪽은 응답을 직접 보내지 않고 카탈로그 코드를 콜백으로
    // 돌려준다 — 그것이 옳은 형태다.
    //
    // 죽은 코드로 남겨 두면 다음 사람이 옛 방식을 본보기로 삼는다.
    const src = code('mobius/resource.js');
    assert.strictEqual(/function\s+create_resource\s*\(/.test(src), false,
        'create_resource 가 돌아왔다 — 지운 이유는 그 자리 주석에 있다');

    // 살아 있는 쌍둥이는 그대로 있어야 한다. 이것까지 없어지면 검증이 통째로
    // 사라진 것이다.
    assert.match(src, /function\s+build_resource\s*\(/,
        'build_resource 가 없다 — 속성 검증이 통째로 사라졌는지 확인할 것');

    // build_resource 가 카탈로그 코드로 답하는지. 네 갈래가 지운 함수의
    // 네 갈래에 대응한다.
    ['400-22', '400-25', '400-26', '405-5'].forEach(function (k) {
        assert.ok(src.indexOf("'" + k + "'") >= 0,
            'build_resource 가 ' + k + ' 를 안 쓴다 — 지운 함수가 하던 검증이 빠졌는지 확인할 것');
    });
});
