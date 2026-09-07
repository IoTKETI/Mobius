'use strict';
// /hit · /total_ae · /total_cbs 는 X-M2M 헤더 검사와 ACP 앞에서 200 을 내던 경로다.
// 외부에서 닿고(인수인계 §7 실측) 호출 건수·AE 수·CIN 바이트 총합을 인증 없이
// 내보냈다. 2026-09-06 에 관리 콘솔의 /api/stats/* 로 옮기고 코어에서 걷어냈다.
// 되살아나면 이 시험이 잡는다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('app.js 에 extra_api_action 이 없다', function () {
    assert.ok(!/extra_api_action/.test(code));
});

test("app.js 가 '/hit' · '/total_ae' · '/total_cbs' 를 URL 로 갈라 보지 않는다", function () {
    assert.ok(!/['"]\/hit['"]/.test(code));
    assert.ok(!/['"]\/total_ae['"]/.test(code));
    assert.ok(!/['"]\/total_cbs['"]/.test(code));
});

test('GET 라우트는 헤더 검사부터 시작한다 — 그 앞에 응답하는 갈래가 없다', function () {
    const at = code.indexOf("app.get('*'");
    assert.ok(at >= 0);
    const handler = code.slice(at, at + 1500);
    assert.match(handler, /with_connection\(request, response, \(settle\) => \{\s*check_xm2m_headers\(request/);
});

test('hit 집계 질의는 남아 있다 — 콘솔이 쓴다', function () {
    const sa = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');
    ['get_hit_all', 'select_sum_ae', 'select_sum_cbs'].forEach((fn) => {
        assert.ok(new RegExp('exports\\.' + fn + ' = function').test(sa), fn + ' 이 사라졌다');
    });
});
