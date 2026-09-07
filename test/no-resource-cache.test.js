'use strict';
// Keeps cache_resource_url from returning.
//
// That cache stored resources found by URL in a per-worker object without bound and returned the cached object by reference, so request.targetObject was shared by every request in the worker and one request's changes leaked into the next. Invalidation only cleared the local worker, so a stale copy could never be corrected.
//
// A cache that is reintroduced must hand out a copy per request and carry a TTL. Returning a reference reproduces the same defects.
var test   = require('node:test');
var assert = require('node:assert');
var fs     = require('fs');
var path   = require('path');

var ROOT = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Strips comments from the source; a name in an explanatory comment is fine.
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

    // Looks at the function body only.
    var body = src.slice(at, src.indexOf('\nfunction ', at + 1));
    assert.ok(body.indexOf('db_sql.select_resource_from_url') > 0,
        'check_resource_from_url 이 DB 를 안 부른다');
    assert.ok(!/hasOwnProperty\s*\(\s*ri\s*\)/.test(body),
        'check_resource_from_url 에 캐시 조회 같은 분기가 생겼다');
});

test('/la 캐시 적재가 없다', function () {
    // resource.js used to accumulate CIN objects per parent on every CIN creation, with the reading code commented out: a pure leak.
    var src = code_only(read('mobius/resource.js'));
    assert.ok(!/\+\s*['"]\/la['"]\s*\]\s*=/.test(src),
        "resource.js 에 '/la' 캐시 적재가 다시 생겼다");
});

/* Alias keys escaped invalidation. */
// Required knowledge for anyone reintroducing a cache.
//
//     cache key         request.ri     the URL as the client sent it
//     invalidation key  request.url    the canonical ri from the DB row
//
// responder puts the sri (unstructured id) in the ri slot of every response, so a re-fetch by the address the server announced creates an alias cache key that no invalidation clears. The same happens when an acpi is revoked: authorization is decided on the stale value.

test('응답이 ri 자리에 sri 를 넣는다 (별칭 주소가 생기는 이유)', function () {
    // If this property disappears, the premise of the hole above disappears with it; reassess then.
    const RES = read('mobius/responder.js');
    assert.ok(/index2 == 'sri'[\s\S]{0,120}body_Obj\.ri = body_Obj\[index2\]/.test(RES),
        'responder 가 더는 ri 자리에 sri 를 넣지 않는다 — ' +
        'app.js 의 캐시 주석과 이 테스트의 전제를 다시 볼 것');
});

test('무효화 키가 요청 URL 이 아니라 행의 ri 였다', function () {
    // Without a cache there is no invalidation call site. If one returns, its key must match the cache key.
    const APP = code_only(read('app.js'));
    const setsUrlFromRow = /request\.url = request\.targetObject\[[^\]]+\]\.ri/.test(APP);
    assert.ok(setsUrlFromRow,
        'request.url 을 행의 ri 로 채우는 자리가 사라졌다 — 캐시 주석의 전제를 확인할 것');

    // Code that uses that value for cache invalidation would let aliases leak.
    assert.ok(!/invalidate\(request\.url\)/.test(APP),
        '행의 ri 로 캐시를 무효화하는 코드가 생겼다 — ' +
        '캐시 키는 request.ri(요청 URL)이므로 별칭은 안 지워진다. ' +
        'app.js 상단의 "다시 넣으려면" 을 읽을 것');
});

test('캐시를 다시 넣을 때 지켜야 할 것이 문서로 남아 있다', function () {
    const APP = read('app.js');
    assert.ok(/reintroduced/.test(APP),
        'app.js 의 캐시 재도입 조건 설명이 사라졌다 — 재현 근거가 함께 사라진다');
    assert.ok(/alias/.test(APP),
        '별칭 키 문제 설명이 사라졌다');
});
