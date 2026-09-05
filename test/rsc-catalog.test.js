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

// ── 현재 쓰이는 (http, rsc) 쌍을 뽑는다 ──────────────────────────────────
// 표는 이제 app.js 리터럴이 아니라 mobius/reason.js 가 만든다.
function livePairs() {
    const table = require('../mobius/reason').toLegacyTable();
    const pairs = new Map();
    Object.keys(table).forEach(function (key) {
        const row = table[key];
        const k = row[0] + '|' + row[1];
        if (!pairs.has(k)) { pairs.set(k, []); }
        pairs.get(k).push(key);
    });
    return pairs;
}

// 성공 응답의 코드는 이제 생산자(resource.js · fopt.js)가 결과 객체의 `rsc: 'CREATED'`
// 같은 **카탈로그 이름**으로 올린다 — settle.done 이 그 이름으로 RSC 를 찾는다.
// 옛 판은 `responder.response_result(x, y, '200', '2000'` 형태를 찾았는데, 그 호출은
// fe1e694 에서 settle 로, 2단계 10번에서 responder 의 세 함수 자체가 사라져 **주석
// 한 줄만 맞히며 헛돌았다**(남은 일 §7.5). 지금 실물이 올리는 것을 본다.
function liveSuccess() {
    const files = ['app.js'].concat(
        fs.readdirSync(path.join(ROOT, 'mobius'))
            .filter(function (f) { return f.endsWith('.js'); })
            .map(function (f) { return 'mobius/' + f; }));
    const NAME = /\brsc:\s*'([A-Z][A-Z_]+)'/g;
    const out = new Map();     // 이름 -> 'file:line' 목록
    files.forEach(function (f) {
        let src;
        try { src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, ''); } catch (e) { return; }
        let m;
        while ((m = NAME.exec(src)) !== null) {
            const line = src.slice(0, m.index).split('\n').length;
            if (!out.has(m[1])) { out.set(m[1], []); }
            out.get(m[1]).push(f + ':' + line);
        }
    });
    return out;
}

// pxy_coap.js 의 자체 표를 걷어냈다(Task 5). 그 표가 카탈로그 값의 검증
// 기준이었으므로, 걷어내기 직전(6914182)의 내용을 픽스처로 고정해 계속 대조한다.
// 이 대조가 없으면 카탈로그의 coap 값이 바뀌어도 아무도 모른다.
//   생성: git show 6914182:pxy_coap.js 에서 기계 추출
function liveCoap() {
    return JSON.parse(read('test/fixtures/coap-table-original.json'));
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

test('생산자가 올리는 성공 rsc 이름이 전부 카탈로그의 성공 항목이다', function () {
    const live = liveSuccess();
    // 헛돌지 않는지 — 생산자 다섯(create/retrieve/update/delete/fopt)이 올리는 이름은
    // 최소 OK · CREATED · UPDATED · DELETED 넷이다.
    ['OK', 'CREATED', 'UPDATED', 'DELETED'].forEach(function (n) {
        assert.ok(live.has(n), n + ' 을 올리는 자리를 못 찾았다 — 이 시험의 전제가 바뀌었다');
    });
    const bad = [];
    live.forEach(function (where, name) {
        const e = rsc.RSC[name];
        if (!e) { bad.push(name + ' 은 카탈로그에 없다 (' + where.join(', ') + ')'); return; }
        // 결과 객체는 성공만 담는다 — 실패는 사유 코드 문자열로 간다. 4xx/5xx 이름이
        // 여기 오면 settle.done 이 그것을 성공으로 보낸다.
        if (!/^[12]/.test(e.rsc)) { bad.push(name + ' 은 성공 계열이 아니다 rsc=' + e.rsc + ' (' + where.join(', ') + ')'); }
    });
    assert.deepStrictEqual(bad, [], '결과 객체의 rsc 이름:\n  ' + bad.join('\n  '));
});

test('카탈로그의 CoAP 값이 원본 표(픽스처)와 일치한다', function () {
    const live = liveCoap();
    const mismatched = [];
    Object.keys(rsc.RSC).forEach(function (k) {
        const e = rsc.RSC[k];
        const expected = Object.prototype.hasOwnProperty.call(live, e.rsc) ? live[e.rsc] : null;
        if (e.coap !== expected) {
            mismatched.push(k + ' (rsc ' + e.rsc + '): 카탈로그 ' + e.coap + ' vs 원본 ' + expected);
        }
    });
    assert.deepStrictEqual(mismatched, [], mismatched.join('\n'));
});

test('COAP_ONLY 가 원본 표의 나머지 항목을 그대로 보존한다', function () {
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

test('app.js 는 코드 표도 호환 표도 들고 있지 않다', function () {
    // 리터럴 93행은 사유 카탈로그로 옮겼고, 호환 표(toLegacyTable)도 읽는 곳이
    // 없어져 걷어냈다. app.js 는 이제 카탈로그를 참조만 한다.
    const app = read('app.js');
    assert.ok(app.indexOf('var resultStatusCode = {') < 0,
        'resultStatusCode 리터럴이 남아 있다');
    assert.ok(app.indexOf('var resultStatusCode = reason.toLegacyTable()') < 0,
        '호환 표가 남아 있다 — 읽는 곳이 없으면 걷어내야 한다');
    assert.ok(/require\(['"]\.\/mobius\/reason['"]\)/.test(app), 'reason 을 참조해야 한다');
    assert.ok(/require\(['"]\.\/mobius\/rsc['"]\)/.test(app), 'rsc 를 참조해야 한다');
});

test('에러 응답이 표를 직접 인덱싱하지 않는다', function () {
    // 예전에는 호출부 47곳이 resultStatusCode[code][0], [1], [2] 를 직접 펼쳤다.
    // 표의 3원소 배열 구조가 그만큼 새어 나가 있었다.
    const app = read('app.js');
    const lines = app.split('\n').filter(function (l) {
        return l.indexOf('resultStatusCode[') >= 0 && l.trim().indexOf('//') !== 0;
    });
    assert.deepStrictEqual(lines, [], '직접 인덱싱이 남아 있다:\n' + lines.join('\n'));

    // 옛 시그니처 직접 호출도 없어야 한다
    assert.ok(app.indexOf('responder.error_result(') < 0,
        'responder.error_result 직접 호출이 남아 있다 — response_error_result 를 쓴다');
});


// ── Task 5: 바인딩 통합 ──────────────────────────────────────────────────

test('toCoapCode 는 어떤 rsc 에도 undefined 를 돌려주지 않는다 (D19)', function () {
    // 예전에는 pxy_coap.js 가 자체 표를 조회해 매핑이 없으면 response.code 에
    // undefined 를 넣었다. 6종(1001 1002 4106 4107 4109 4230)이 그랬다.
    const all = Object.keys(rsc.RSC).map(function (k) { return rsc.RSC[k].rsc; })
        .concat(Object.keys(rsc.COAP_ONLY))
        .concat(['9999', '1234']);                 // 카탈로그에 없는 코드
    const bad = all.filter(function (r) {
        const c = rsc.toCoapCode(r);
        return typeof c !== 'string' || !/^\d\.\d\d$/.test(c);
    });
    assert.deepStrictEqual(bad, [], 'CoAP 코드를 못 만든 rsc: ' + bad.join(', '));
});

test('매핑이 있는 rsc 는 폴백이 아니라 그 값을 쓴다', function () {
    assert.strictEqual(rsc.toCoapCode('4000'), '4.00');   // 카탈로그
    assert.strictEqual(rsc.toCoapCode('5001'), '5.01');   // 카탈로그
    assert.strictEqual(rsc.toCoapCode('6029'), '4.00');   // COAP_ONLY
    assert.strictEqual(rsc.toCoapCode('5106'), '5.06');   // COAP_ONLY (폴백이면 5.00 이 됐을 것)
});

test('매핑이 없으면 rsc 첫 자리로 폴백한다', function () {
    // 값을 지어내지 않는다 — 클래스 단위의 거친 근사다.
    assert.strictEqual(rsc.toCoapCode('1001'), '2.05');   // 논블로킹 접수 = 성공 계열
    assert.strictEqual(rsc.toCoapCode('4230'), '4.00');   // LOCKED
    assert.strictEqual(rsc.toCoapCode('4107'), '4.00');   // AE_NOT_ALLOWED
    assert.strictEqual(rsc.toCoapCode('9999'), '5.00');   // 모르는 코드
});


