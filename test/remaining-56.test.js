/**
 * 남은 일 §5.6(잡동사니) — 2026-09-05. (§5.3 의 get_ri_list_sri 는 test/ri-sri-batch.test.js)
 *
 *   - access_value 리터럴 → security.ACOP 상수. 값은 oneM2M acop 비트 그대로다
 *   - 죽은 것: global.useobserver · security.js 의 ty '33' · check_allowed_app_ids 의 mgo 갈래
 *     · conf 의 sgnManPort/hitManPort(읽기만 하고 아무도 안 듣던 포트)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/mg, '');
}

// ── ACOP 상수 ─────────────────────────────────────────────────────────────

test('security.ACOP 는 oneM2M acop 비트이고 문자열이다', () => {
    const security = require('../mobius/security');
    assert.deepStrictEqual(security.ACOP, {
        CREATE: '1', RETRIEVE: '2', UPDATE: '4', DELETE: '8', NOTIFY: '16', DISCOVERY: '32', SUB_CREATE: '3'
    });
    assert.ok(Object.isFrozen(security.ACOP));
    // acop_allows 는 문자열 & 로 비교한다 — 숫자로 바꾸면 그 자리를 같이 봐야 한다
    assert.strictEqual(security._acor_allows({ acop: 63 }, 'anyone', security.ACOP.DISCOVERY), true);
    assert.strictEqual(security._acor_allows({ acop: 2 }, 'anyone', security.ACOP.DELETE), false);
});

test('app.js 의 접근 판정 호출에 acop 리터럴이 없다', () => {
    const src = code('app.js');
    const lits = src.match(/(run_fanout|authorize_and_run)\(request, response, [^\n]*'(1|2|3|4|8|32)'/g) || [];
    assert.deepStrictEqual(lits, [], 'acop 리터럴이 되살아났다');
    assert.strictEqual((src.match(/var access_value = [^\n]*'(1|2|3|32)'/g) || []).length, 0);
    assert.ok((src.match(/security\.ACOP\./g) || []).length >= 6, 'ACOP 상수를 쓰는 자리가 여섯 이상');
});

// ── 죽은 것 ───────────────────────────────────────────────────────────────

test('죽은 코드가 되살아나지 않는다', () => {
    assert.strictEqual(code('app.js').indexOf('useobserver'), -1, 'global.useobserver — 읽는 곳이 없었다');
    assert.strictEqual(code('mobius/security.js').indexOf("ty == '33'"), -1, "ty 33 은 없는 타입이다");
    const app = code('app.js');
    const at = app.indexOf('function check_allowed_app_ids');
    const body = app.slice(at, app.indexOf('\n}\n', at));
    assert.strictEqual(body.indexOf('mgoType'), -1, 'check_allowed_app_ids 의 mgo 갈래 — type_resolver 가 먼저 끊어 도달하지 않는다');
    assert.ok(/callback\('400-42'\)/.test(body), '타입 불일치 방어는 남긴다');
});

test('sgnManPort / hitManPort 는 conf 표에도 mobius.js 에도 없다', () => {
    const schema = require('../mobius/conf_schema');
    const keys = Object.keys(schema.describe ? schema.describe() : schema.KEYS || schema);
    ['sgnManPort', 'hitManPort'].forEach((k) => {
        assert.ok(keys.indexOf(k) < 0, k + ' 가 conf 표에 남아 있다');
        assert.strictEqual(code('mobius.js').indexOf(k), -1, k + ' 를 mobius.js 가 읽는다');
    });
    assert.strictEqual(code('mobius.js').indexOf('use_sgn_man_port'), -1);
    assert.strictEqual(code('mobius.js').indexOf('use_hit_man_port'), -1);
});

test('CORS 는 cors() 한 곳이고 Expose-Headers 에 X-M2M-RSC 가 있다', () => {
    // 수동 미들웨어가 되살아나면 다시 이중이 된다. 브라우저 클라이언트가 응답의
    // X-M2M-RSC 를 읽으려면 Expose-Headers 가 반드시 있어야 한다.
    const src = code('app.js');
    assert.strictEqual((src.match(/app\.use\(cors\(/g) || []).length, 1);
    assert.strictEqual((src.match(/res\.header\('Access-Control-/g) || []).length, 0, '수동 CORS 헤더가 되살아났다');
    const m = src.match(/app\.use\(cors\(\{([\s\S]*?)\}\)\)/);
    assert.ok(m, 'cors 옵션 블록을 못 찾았다');
    assert.match(m[1], /exposedHeaders/);
    // 문자열 그대로 — 배열로 바꾸면 cors 가 ',' 로 이어 붙여 옛 값과 바이트가 달라진다
    const v = m[1].match(/exposedHeaders:\s*'([^']*)'/);
    assert.ok(v, 'exposedHeaders 는 문자열이어야 한다(바이트 보존)');
    assert.strictEqual(v[1], 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
});
