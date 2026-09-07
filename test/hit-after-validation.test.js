/**
 * hit counting includes only requests that passed header validation.
 *
 * In all four routes count_hit must sit inside the success branch of check_xm2m_headers. For GET it also follows the removal of the extra APIs (/hit etc.).
 *
 * Pinned by source order: inside a route block count_hit( appears after check_xm2m_headers( with the success test `if (code === '200')` between them.
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
    // Up to the next route definition or end of file.
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
        // No other decision sits between validation and counting (no leak into the reject branch).
        assert.strictEqual((between.match(/if \(code === '200'\)/g) || []).length, 1, method + ': 검증 판정 하나 바로 안');
    });
});

test('set_hit 는 count_hit 안에서만 부른다', () => {
    assert.strictEqual((src.match(/db_sql\.set_hit\(/g) || []).length, 1);
    assert.ok(/function count_hit\(binding\)[\s\S]{0,400}db_sql\.set_hit\(connection, binding/.test(src));
});
