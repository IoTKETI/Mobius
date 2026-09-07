'use strict';
// Every request must be settled: send the response and return the connection exactly once.
//
// A lost settlement is a hang, not a crash: the cluster worker is not restarted, and connection.release() lives only in the settlement closure, so the connection never returns. Quiet permanent exhaustion.
//
// The specific points that used to lose settlements are pinned here.

const test = require('node:test');
const assert = require('node:assert');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const responder = require('../mobius/responder');

function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { return fn(); }
    finally { console.error = orig; }
}

// req (ty=17) no longer exists. It was the temporary record of a non-blocking request; the resource and the table are gone (migrations/003-drop-req-table.js). The special-case branch in response_result that parsed its pc without a guard is gone with it.

test('req 특별 취급 분기가 되살아나지 않았다', function () {
    const fsx = require('node:fs');
    const pathx = require('node:path');
    const src = fsx.readFileSync(pathx.join(__dirname, '..', 'mobius', 'responder.js'), 'utf8');
    assert.strictEqual(src.indexOf("rootnm === 'req'"), -1,
        'req 특별 취급 분기가 되살아났다');
    assert.strictEqual(src.indexOf('store_to_req_resource'), -1,
        'req 기록 함수가 되살아났다');
});

test('typeRsrc 에 17 이 없다', function () {
    assert.strictEqual(responder.typeRsrc['17'], undefined,
        'req 타입이 되살아났다 — 만들 수 없는 타입은 표에 두지 않는다');
});


// Array columns and pv/pvs. A single remaining throw on the settlement path repeats the same exhaustion.

test('응답 직렬화는 어떤 깨진 값에도 던지지 않는다', function () {
    const BROKEN = [
        { 'm2m:cnt': { rn: 'x', ty: 3, lbl: '["잘린' } },
        { 'm2m:cnt': { rn: 'x', ty: 3, acpi: '["/Mob' } },
        { 'm2m:sub': { rn: 'x', ty: 23, nu: '<html>' } },
        { 'm2m:acp': { rn: 'x', ty: 1, pv: '{"acr":[' } },
        { 'm2m:ae':  { rn: 'x', ty: 2, poa: 'null' } }
    ];
    BROKEN.forEach(function (o) {
        quiet(function () { responder.typeCheckforJson(o); });   // a throw fails here
    });
});

// rt (responseType) decision. Non-blocking (rt=1/2) is unsupported.
//
// check_request_query_rt is a private function in app.js, so only the decision rule is reproduced here. End-to-end behaviour is covered by the tools/response-golden harness.

function decide_rt(rt, rtu, hasRtKey) {
    // app.js default: 3 is filled in only when the rt key is absent (not a correction).
    if (!hasRtKey) { rt = 3; }

    if (rt == 3) { return '200'; }
    if (rt == 1 || rt == 2) {
        // rt=2 must come with an address for the result.
        if (rt == 2 && (rtu == null || rtu === '')) { return '400-21'; }
        return '405-4';                 // non-blocking unsupported
    }
    return '405-4';                     // rt is not 1/2/3
}

test('rt 를 안 주면 블로킹으로 친다', function () {
    assert.strictEqual(decide_rt(undefined, undefined, false), '200');
});

test('rt=3 은 블로킹이다', function () {
    assert.strictEqual(decide_rt('3', undefined, true), '200');
});

test('rt=2 인데 RTU 가 없으면 400 이다 — 예전에는 한 번도 안 나갔다', function () {
    // `rtu == null && rtu == ''` can never be true at the same time.
    assert.strictEqual(undefined == null && undefined == '', false, '옛 조건은 언제나 거짓');
    assert.strictEqual(decide_rt('2', undefined, true), '400-21');
    assert.strictEqual(decide_rt('2', '', true), '400-21');
});

test('논블로킹은 메서드와 무관하게 미지원이다', function () {
    assert.strictEqual(decide_rt('1', undefined, true), '405-4');
    assert.strictEqual(decide_rt('2', 'http://x/y', true), '405-4');
});

test('rt 가 1/2/3 이 아니면 미지원이다', function () {
    ['99', 'abc', '', '-1', '0'].forEach(function (v) {
        assert.strictEqual(decide_rt(v, undefined, true), '405-4', 'rt=' + JSON.stringify(v));
    });
});

test('RTU 검사가 미지원 판정보다 먼저다', function () {
    // When bad request (400) and unsupported (405) overlap, the more specific one wins.
    assert.strictEqual(decide_rt('2', undefined, true), '400-21');
    assert.strictEqual(decide_rt('2', 'http://x', true), '405-4');
});
