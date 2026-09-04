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
    for (var i = 0; i < call.length; i++) {
        var c = call[i];
        if (c === '(' || c === '[' || c === '{') { depth++; started = true; continue; }
        if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { break; } continue; }
        if (c === ',' && depth === 1) { n++; }
    }
    return started ? n : 0;
}

// responder 의 위치 인자 응답 함수들. 시그니처가 바뀌면 여기도 바꾼다.
const EXPECTED = {
    response_result: 6,
    response_rcn3_result: 6,
    search_result: 6,
    error_result: 6
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
    // 하나가 아직 일곱 개를 넘긴다. **알려진 위반이고 P2 3.2 로 따로
    // 처리한다** — ty=13(mgmtObj) 에 지원하지 않는 mgd 로 POST 했을 때
    // 닿는 자리다.
    //
    // **개수만 세면 안 된다.** 이미 위반인 자리에 인자를 하나 더 붙여도
    // "위반 1곳" 은 그대로라 통과한다(변이로 확인했다). 그래서 어느
    // 함수를 **몇 개로** 부르고 있는지까지 못박는다.
    //
    // 목록은 **줄어들기만 해야 한다.**
    const KNOWN_BAD = ['response_result:7'];

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
