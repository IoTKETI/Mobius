'use strict';
// cache_resource_url 이 되살아나지 않게 막는다.
//
// 이 캐시는 URL 로 찾은 리소스를 워커별 객체에 무한히 쌓아 두면서
// **캐시된 객체를 참조로** 돌려줬다. 그래서 request.targetObject 가
// 워커 안의 모든 요청이 공유하는 객체였고, 한 요청이 건드린 것이
// 다음 요청에 남았다.
//
// 부모의 subl 이 대표적이다. 낡은 subl 을 든 워커가 거기에 새 구독을
// 얹어 쓰면서 지워진 구독이 되살아났다. 배포 실측(2026-08-30):
//   subl 항목 14,028  vs  sub 행 3,452
//   유령 9,475 / 중복 1,481묶음 / 침묵 21 / 낡은 nu 194
// 워커가 16개인데 무효화는 자기 것만 지우므로 구조적으로 못 고친다.
//
// 없앤 값도 실측했다: 요청 최대 26/초, 캐시 미스 1.5/초(적중률 94%).
// 전부 DB 로 보내면 질의 253.8 -> 302.8/초(+19%), 요청당 0.6~1.2ms.
// 그 값을 내고 정합성을 산다. 성능이 아쉬워 되살리고 싶어지면,
// **요청마다 사본을 주고 TTL 을 두는** 캐시여야 한다. 참조를 주면
// 위 실측이 그대로 재현된다.
var test   = require('node:test');
var assert = require('node:assert');
var fs     = require('fs');
var path   = require('path');

var ROOT = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 소스에서 주석을 걷어낸다 — 설명 주석에 이름이 나오는 것은 괜찮다.
function code_only(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter(function (l) { return l.trim().indexOf('//') !== 0; })
        .map(function (l) { return l.replace(/\/\/.*$/, ''); })
        .join('\n');
}

var FILES = ['app.js', 'mobius/resource.js', 'mobius/sql_action.js', 'mobius/sgn.js'];

test('cache_resource_url 이 코드에 없다', function () {
    FILES.forEach(function (f) {
        var hits = code_only(read(f)).split('cache_resource_url').length - 1;
        assert.strictEqual(hits, 0,
            f + ' 에 cache_resource_url 이 ' + hits + '번 나온다 — ' +
            '되살리려면 요청마다 사본을 주고 TTL 을 둘 것. ' +
            '참조를 돌려주면 subl 유령 9,475건이 그대로 재현된다');
    });
});

test('check_resource_from_url 은 언제나 DB 를 본다', function () {
    var src = read('app.js');
    var at = src.indexOf('function check_resource_from_url');
    assert.ok(at > 0, 'check_resource_from_url 이 사라졌다 — 이 테스트의 전제를 확인할 것');

    // 함수 본문만 잘라 본다
    var body = src.slice(at, src.indexOf('\nfunction ', at + 1));
    assert.ok(body.indexOf('db_sql.select_resource_from_url') > 0,
        'check_resource_from_url 이 DB 를 안 부른다');
    assert.ok(!/hasOwnProperty\s*\(\s*ri\s*\)/.test(body),
        'check_resource_from_url 에 캐시 조회 같은 분기가 생겼다');
});

test('/la 캐시 적재가 없다', function () {
    // resource.js 가 CIN 생성마다 부모별로 CIN 객체를 쌓던 자리다.
    // 읽는 코드는 주석 처리되어 있어 쓰고 지우기만 했다 — 순수 누수였다.
    var src = code_only(read('mobius/resource.js'));
    assert.ok(!/\+\s*['"]\/la['"]\s*\]\s*=/.test(src),
        "resource.js 에 '/la' 캐시 적재가 다시 생겼다");
});

/* ── 별칭 키가 무효화를 빠져나가던 구멍 ──────────────────────────── */
//
// 캐시를 다시 넣으려는 사람이 반드시 알아야 할 것이다.
//
//     캐시 키    request.ri     클라이언트가 보낸 URL 그대로
//     무효화 키  request.url    DB 행의 정규 ri
//
// 그리고 responder 가 모든 응답의 ri 자리에 sri(비구조 ID)를 넣으므로,
// **서버가 알려준 주소**로 다시 조회하면 캐시 키가 별칭이 된다. 그 별칭은
// 어떤 무효화로도 지워지지 않는다.
//
// origin/lite 를 그대로 띄워 재현했다 (2026-08-31, 로컬 MySQL, 워커 16개):
//     캐시 있음   컨테이너 삭제 후 별칭 GET x40 -> 200 이 40/40
//     캐시 없음   같은 시험                      -> 404 가 40/40
// acpi 를 회수해도 같은 일이 난다 — 낡은 값으로 인가를 판정한다.

test('응답이 ri 자리에 sri 를 넣는다 (별칭 주소가 생기는 이유)', function () {
    // 이 성질이 없어지면 위 구멍의 전제도 사라진다. 그때 다시 판단할 것.
    const RES = read('mobius/responder.js');
    assert.ok(/index2 == 'sri'[\s\S]{0,120}body_Obj\.ri = body_Obj\[index2\]/.test(RES),
        'responder 가 더는 ri 자리에 sri 를 넣지 않는다 — ' +
        'app.js 의 캐시 주석과 이 테스트의 전제를 다시 볼 것');
});

test('무효화 키가 요청 URL 이 아니라 행의 ri 였다', function () {
    // 캐시가 없는 지금은 무효화 호출부 자체가 없다. 다시 생긴다면
    // 캐시 키와 같은 것으로 맞춰야 한다.
    const APP = code_only(read('app.js'));
    const setsUrlFromRow = /request\.url = request\.targetObject\[[^\]]+\]\.ri/.test(APP);
    assert.ok(setsUrlFromRow,
        'request.url 을 행의 ri 로 채우는 자리가 사라졌다 — 캐시 주석의 전제를 확인할 것');

    // 그 값을 캐시 무효화에 쓰는 코드가 다시 생기면 별칭이 새어 나간다.
    assert.ok(!/invalidate\(request\.url\)/.test(APP),
        '행의 ri 로 캐시를 무효화하는 코드가 생겼다 — ' +
        '캐시 키는 request.ri(요청 URL)이므로 별칭은 안 지워진다. ' +
        'app.js 상단의 "다시 넣으려면" 을 읽을 것');
});

test('캐시를 다시 넣을 때 지켜야 할 것이 문서로 남아 있다', function () {
    const APP = read('app.js');
    assert.ok(/다시 넣으려면/.test(APP),
        'app.js 의 캐시 재도입 조건 설명이 사라졌다 — 재현 근거가 함께 사라진다');
    assert.ok(/별칭/.test(APP),
        '별칭 키 문제 설명이 사라졌다');
});
