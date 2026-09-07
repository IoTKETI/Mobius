'use strict';
// Verifies that the mobius/rsc.js catalogue covers the current codebase completely.
//
// The values were transcribed by hand, so they are re-derived from the current sources and compared. If the table changes later, this test breaks first.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const rsc = require('../mobius/rsc');
const ROOT = path.join(__dirname, '..');

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

// Extracts the (http, rsc) pairs in use. The table is produced by mobius/reason.js.
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

// Success codes are raised by the producers (resource.js, fopt.js) as catalogue names in the result object, e.g. `rsc: 'CREATED'`; settle.done looks the RSC up by that name. This collects what the producers actually raise.
function liveSuccess() {
    const files = ['app.js'].concat(
        fs.readdirSync(path.join(ROOT, 'mobius'))
            .filter(function (f) { return f.endsWith('.js'); })
            .map(function (f) { return 'mobius/' + f; }));
    const NAME = /\brsc:\s*'([A-Z][A-Z_]+)'/g;
    const out = new Map();     // name -> list of 'file:line'
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

// The former pxy_coap.js table was the reference for the catalogue's coap values; its content is kept as a fixture and still compared, otherwise a changed coap value would go unnoticed.
//   generated from the original file by machine extraction
function liveCoap() {
    return JSON.parse(read('test/fixtures/coap-table-original.json'));
}

// Verification.

test('카탈로그 자체 점검이 통과한다', function () {
    const problems = rsc.assertComplete();
    assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('한 rsc 는 한 HTTP 다 — 예외는 CONTENT_TOO_LARGE 하나뿐', function () {
    // oneM2M TS-0009 maps each rsc to one HTTP status.
    //
    // One exception: CONTENT_TOO_LARGE (4000/413). oneM2M has no 'body too large', so the rsc is 4000 like BAD_REQUEST and only HTTP is 413, the one place HTTP says more than oneM2M (see the entry's comment in rsc.js). Additions need a reason here.
    const EXCEPTIONS = { CONTENT_TOO_LARGE: true };
    const httpOf = {};
    const bad = [];
    Object.keys(rsc.RSC).forEach(function (k) {
        if (EXCEPTIONS[k]) { return; }
        const e = rsc.RSC[k];
        if (httpOf[e.rsc] !== undefined && httpOf[e.rsc] !== e.http) {
            bad.push(e.rsc + ' -> ' + httpOf[e.rsc] + ' 와 ' + e.http + ' (' + k + ')');
        }
        httpOf[e.rsc] = e.http;
    });
    assert.deepStrictEqual(bad, [], '같은 rsc 가 다른 HTTP 로 나간다:\n  ' + bad.join('\n  '));
    assert.deepStrictEqual(rsc.RSC.TARGET_NOT_REACHABLE, { name: 'TARGET_NOT_REACHABLE', rsc: '5103', http: 404, coap: '4.04' });
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
    // Sanity: the five producers (create/retrieve/update/delete/fopt) raise at least OK, CREATED, UPDATED and DELETED.
    ['OK', 'CREATED', 'UPDATED', 'DELETED'].forEach(function (n) {
        assert.ok(live.has(n), n + ' 을 올리는 자리를 못 찾았다 — 이 시험의 전제가 바뀌었다');
    });
    const bad = [];
    live.forEach(function (where, name) {
        const e = rsc.RSC[name];
        if (!e) { bad.push(name + ' 은 카탈로그에 없다 (' + where.join(', ') + ')'); return; }
        // The result object carries success only; failures travel as reason code strings. A 4xx/5xx name here would be sent as success by settle.done.
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
    // 4106 4107 4109 4230 are used by resultStatusCode, 1001 1002 are success codes. The fallback list; values are not filled in here.
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
    assert.strictEqual(rsc.coapFor('4000'), '4.00');   // catalogue
    assert.strictEqual(rsc.coapFor('6029'), '4.00');   // COAP_ONLY
    assert.strictEqual(rsc.coapFor('4230'), null);     // no mapping
    assert.strictEqual(rsc.coapFor('9999'), null);     // unknown code
});

test('http 는 number 이고 rsc 는 문자열이다', function () {
    // The catalogue gives http as a number, so responder.js needs no parseInt wrapper.
    Object.keys(rsc.RSC).forEach(function (k) {
        assert.strictEqual(typeof rsc.RSC[k].http, 'number', k + ' 의 http');
        assert.strictEqual(typeof rsc.RSC[k].rsc, 'string', k + ' 의 rsc');
    });
});

test('app.js 는 코드 표도 호환 표도 들고 있지 않다', function () {
    // The literal table moved to the reason catalogue and the compatibility table (toLegacyTable) has no readers; app.js only references the catalogue.
    const app = read('app.js');
    assert.ok(app.indexOf('var resultStatusCode = {') < 0,
        'resultStatusCode 리터럴이 남아 있다');
    assert.ok(app.indexOf('var resultStatusCode = reason.toLegacyTable()') < 0,
        '호환 표가 남아 있다 — 읽는 곳이 없으면 걷어내야 한다');
    assert.ok(/require\(['"]\.\/mobius\/reason['"]\)/.test(app), 'reason 을 참조해야 한다');
    assert.ok(/require\(['"]\.\/mobius\/rsc['"]\)/.test(app), 'rsc 를 참조해야 한다');
});

test('에러 응답이 표를 직접 인덱싱하지 않는다', function () {
    // Call sites must not unpack resultStatusCode[code][0], [1], [2] directly.
    const app = read('app.js');
    const lines = app.split('\n').filter(function (l) {
        return l.indexOf('resultStatusCode[') >= 0 && l.trim().indexOf('//') !== 0;
    });
    assert.deepStrictEqual(lines, [], '직접 인덱싱이 남아 있다:\n' + lines.join('\n'));

    // Direct calls with the old signature must not exist either.
    assert.ok(app.indexOf('responder.error_result(') < 0,
        'responder.error_result 직접 호출이 남아 있다 — response_error_result 를 쓴다');
});


// Binding unification.

test('toCoapCode 는 어떤 rsc 에도 undefined 를 돌려주지 않는다 (D19)', function () {
    // Every rsc must map to a defined CoAP code; the six without a table entry (1001 1002 4106 4107 4109 4230) get a fallback.
    const all = Object.keys(rsc.RSC).map(function (k) { return rsc.RSC[k].rsc; })
        .concat(Object.keys(rsc.COAP_ONLY))
        .concat(['9999', '1234']);                 // codes not in the catalogue
    const bad = all.filter(function (r) {
        const c = rsc.toCoapCode(r);
        return typeof c !== 'string' || !/^\d\.\d\d$/.test(c);
    });
    assert.deepStrictEqual(bad, [], 'CoAP 코드를 못 만든 rsc: ' + bad.join(', '));
});

test('매핑이 있는 rsc 는 폴백이 아니라 그 값을 쓴다', function () {
    assert.strictEqual(rsc.toCoapCode('4000'), '4.00');   // catalogue
    assert.strictEqual(rsc.toCoapCode('5001'), '5.01');   // catalogue
    assert.strictEqual(rsc.toCoapCode('6029'), '4.00');   // COAP_ONLY
    assert.strictEqual(rsc.toCoapCode('5106'), '5.06');   // COAP_ONLY (the fallback would have given 5.00)
});

test('매핑이 없으면 rsc 첫 자리로 폴백한다', function () {
    // No invented values: a coarse class-level approximation.
    assert.strictEqual(rsc.toCoapCode('1001'), '2.05');   // non-blocking accepted = success class
    assert.strictEqual(rsc.toCoapCode('4230'), '4.00');   // LOCKED
    assert.strictEqual(rsc.toCoapCode('4107'), '4.00');   // AE_NOT_ALLOWED
    assert.strictEqual(rsc.toCoapCode('9999'), '5.00');   // unknown code
});


