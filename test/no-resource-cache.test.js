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
