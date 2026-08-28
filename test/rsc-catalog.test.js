'use strict';
// mobius/rsc.js 카탈로그가 현재 코드베이스를 빠짐없이 덮는지 검증한다.
//
// 값을 손으로 옮겼으므로, 옮긴 값이 맞는지는 "현재 소스에서 다시 뽑아 대조"해야만
// 확인된다. 그래서 이 테스트는 app.js / pxy_coap.js 를 그때그때 파싱해서 비교한다.
// 표가 나중에 바뀌면 이 테스트가 먼저 깨진다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const rsc = require('../mobius/rsc');
const ROOT = path.join(__dirname, '..');

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

// ── 현재 소스에서 (http, rsc) 쌍을 뽑는다 ────────────────────────────────
function livePairs() {
    const app = read('app.js');
    const s = app.indexOf('var resultStatusCode');
    const tbl = app.slice(s, app.indexOf('function response_error_result', s));
    const ROW = /'(\d{3}-\d+)'\s*:\s*\[\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g;
    const pairs = new Map();
    let m;
    while ((m = ROW.exec(tbl)) !== null) {
        const key = m[2] + '|' + m[3];
        if (!pairs.has(key)) { pairs.set(key, []); }
        pairs.get(key).push(m[1]);
    }
    return pairs;
}

function liveSuccess() {
    const files = ['app.js'].concat(
        fs.readdirSync(path.join(ROOT, 'mobius'))
            .filter(function (f) { return f.endsWith('.js'); })
            .map(function (f) { return 'mobius/' + f; }));
    const CALL = /responder\.(?:response_result|response_rcn3_result|search_result|error_result)\s*\(\s*[^,]+,\s*[^,]+,\s*'(\d{3})'\s*,\s*'(\d{4})'/g;
    const out = new Map();
    files.forEach(function (f) {
        let src;
        try { src = read(f); } catch (e) { return; }
        let m;
        while ((m = CALL.exec(src)) !== null) {
            if (m[2][0] === '2' || m[2][0] === '1') { out.set(m[1] + '|' + m[2], true); }
        }
    });
    return out;
}

function liveCoap() {
    const src = read('pxy_coap.js');
    const s = src.indexOf('var coap_rsc_code');
    const tbl = src.slice(s, src.indexOf('}', s));
    const ROW = /'(\d{4})'\s*:\s*'([^']*)'/g;
    const out = {};
    let m;
    while ((m = ROW.exec(tbl)) !== null) { out[m[1]] = m[2]; }
    return out;
}

// ── 검증 ────────────────────────────────────────────────────────────────

test('카탈로그 자체 점검이 통과한다', function () {
    const problems = rsc.assertComplete();
    assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('resultStatusCode 의 모든 (http, rsc) 쌍이 카탈로그에 있다', function () {
    const pairs = livePairs();
    assert.ok(pairs.size > 0, 'resultStatusCode 를 파싱하지 못했다');

    const missing = [];
    pairs.forEach(function (keys, pair) {
        const parts = pair.split('|');
        if (!rsc.byPair(parts[0], parts[1])) {
            missing.push('http ' + parts[0] + ' / rsc ' + parts[1] + '  (' + keys.join(' ') + ')');
        }
    });
    assert.deepStrictEqual(missing, [], '카탈로그에 없는 쌍:\n  ' + missing.join('\n  '));
});

test('성공 코드의 (http, rsc) 쌍이 모두 카탈로그에 있다', function () {
    const missing = [];
    liveSuccess().forEach(function (_v, pair) {
        const parts = pair.split('|');
        if (!rsc.byPair(parts[0], parts[1])) {
            missing.push('http ' + parts[0] + ' / rsc ' + parts[1]);
        }
    });
    assert.deepStrictEqual(missing, [], '카탈로그에 없는 성공 코드:\n  ' + missing.join('\n  '));
});

test('카탈로그의 CoAP 값이 pxy_coap.js 의 현재 표와 일치한다', function () {
    const live = liveCoap();
    const mismatched = [];
    Object.keys(rsc.RSC).forEach(function (k) {
        const e = rsc.RSC[k];
        const expected = Object.prototype.hasOwnProperty.call(live, e.rsc) ? live[e.rsc] : null;
        if (e.coap !== expected) {
            mismatched.push(k + ' (rsc ' + e.rsc + '): 카탈로그 ' + e.coap + ' vs pxy_coap ' + expected);
        }
    });
    assert.deepStrictEqual(mismatched, [], mismatched.join('\n'));
});

test('COAP_ONLY 가 pxy_coap.js 의 나머지 항목을 그대로 보존한다', function () {
    const live = liveCoap();
    const used = new Set(Object.keys(rsc.RSC).map(function (k) { return rsc.RSC[k].rsc; }));
    const expected = {};
    Object.keys(live).forEach(function (r) { if (!used.has(r)) { expected[r] = live[r]; } });
    assert.deepStrictEqual(rsc.COAP_ONLY, expected);
});

test('CoAP 매핑이 없는 항목은 정확히 알려진 6개다 (D19)', function () {
    // 4106 4107 4109 4230 은 resultStatusCode 가 쓰고, 1001 1002 는 성공 코드다.
    // Task 5 가 폴백을 붙일 목록. 여기서 값을 채우지 않는다.
    assert.deepStrictEqual(rsc.missingCoap().sort(), [
        'ACCEPTED_NONBLOCKING_ASYNC',
        'ACCEPTED_NONBLOCKING_SYNC',
        'AEI_DUPLICATED',
        'AE_NOT_ALLOWED',
        'LOCKED',
        'NO_MEMBERS'
    ]);
});

test('coapFor 는 카탈로그와 COAP_ONLY 양쪽을 본다', function () {
    assert.strictEqual(rsc.coapFor('4000'), '4.00');   // 카탈로그
    assert.strictEqual(rsc.coapFor('6029'), '4.00');   // COAP_ONLY
    assert.strictEqual(rsc.coapFor('4230'), null);     // 매핑 없음 (D19)
    assert.strictEqual(rsc.coapFor('9999'), null);     // 모르는 코드
});

test('http 는 number 이고 rsc 는 문자열이다', function () {
    // responder.js 가 parseInt(status, 10) 으로 감싸던 이유가 표의 http 가
    // 문자열이었기 때문이다. 카탈로그는 number 로 준다 — Task 4 에서 래핑을 뺀다.
    Object.keys(rsc.RSC).forEach(function (k) {
        assert.strictEqual(typeof rsc.RSC[k].http, 'number', k + ' 의 http');
        assert.strictEqual(typeof rsc.RSC[k].rsc, 'string', k + ' 의 rsc');
    });
});

test('아직 아무도 카탈로그를 쓰지 않는다 (Task 2 범위)', function () {
    // Task 2 는 카탈로그만 세운다. 실제 배선은 Task 3·4 에서 한다.
    const files = ['app.js', 'pxy_coap.js', 'pxy_ws.js']
        .concat(fs.readdirSync(path.join(ROOT, 'mobius'))
            .filter(function (f) { return f.endsWith('.js') && f !== 'rsc.js'; })
            .map(function (f) { return 'mobius/' + f; }));
    const users = files.filter(function (f) {
        let s;
        try { s = read(f); } catch (e) { return false; }
        return /require\(['"]\.{1,2}\/(mobius\/)?rsc['"]\)/.test(s);
    });
    assert.deepStrictEqual(users, [], '아직 참조하면 안 된다: ' + users.join(', '));
});
