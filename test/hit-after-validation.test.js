/**
 * 남은 일 §5.1 — hit 집계는 헤더 검증을 통과한 요청만 센다.
 *
 * 네 라우트 다 count_hit 이 check_xm2m_headers 의 성공 갈래 안에 있어야 한다.
 * 예전에는 검증 앞에서 세어 X-M2M-RI·Origin 이 없어 400 으로 거절될 요청도
 * 들어갔다. GET 은 extra api(/hit 등)를 뺀 뒤이기도 하다.
 *
 * 소스 순서로 잠근다 — 라우트 블록 안에서 count_hit( 의 위치가
 * check_xm2m_headers( 뒤이고, 그 사이에 성공 판정 `if (code === '200')` 이 있어야 한다.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');

function routeBlock(method) {
    const start = src.indexOf("app." + method + "('*', onem2mParser,");
    assert.ok(start > 0, 'app.' + method + " 라우트를 못 찾았다 — 이 시험의 전제가 바뀌었다");
    // 다음 라우트 정의 또는 파일 끝까지
    const rest = src.slice(start + 1);
    const m = rest.match(/\napp\.(post|get|put|delete)\('\*'/);
    return src.slice(start, m ? start + 1 + m.index : src.length);
}

test('네 라우트 다 count_hit 이 check_xm2m_headers 성공 갈래 안에 있다', () => {
    ['post', 'get', 'put', 'delete'].forEach((method) => {
        const block = routeBlock(method);
        const hits = block.match(/count_hit\(/g) || [];
        assert.strictEqual(hits.length, 1, method + ': count_hit 호출은 하나');
        const hit = block.indexOf('count_hit(');
        const check = block.indexOf('check_xm2m_headers(request, (code) => {');
        assert.ok(check >= 0, method + ': check_xm2m_headers 호출을 못 찾았다');
        assert.ok(hit > check, method + ': count_hit 이 check_xm2m_headers 앞에 있다 — 거절될 요청도 센다');
        const between = block.slice(check, hit);
        assert.ok(/if \(code === '200'\) \{\s*$/.test(between.replace(/count_hit.*$/, '').trimEnd()) || /if \(code === '200'\) \{/.test(between),
                  method + ': count_hit 이 성공 판정 안에 있어야 한다');
        // 검증과 집계 사이에 다른 판정이 끼어들지 않는다 (거절 갈래로 새지 않는다)
        assert.strictEqual((between.match(/if \(code === '200'\)/g) || []).length, 1, method + ': 검증 판정 하나 바로 안');
    });
});

test('set_hit 는 count_hit 안에서만 부른다', () => {
    assert.strictEqual((src.match(/db_sql\.set_hit\(/g) || []).length, 1);
    assert.ok(/function count_hit\(binding\)[\s\S]{0,400}db_sql\.set_hit\(connection, binding/.test(src));
});
