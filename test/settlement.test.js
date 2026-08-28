'use strict';
// 요청은 반드시 "정산"되어야 한다 — 응답을 보내고 커넥션을 반납하는 일이
// 정확히 한 번 일어나야 한다.
//
// 정산이 유실되면 크래시가 아니라 매달림이다. cluster 의 워커 재시작이 걸리지
// 않고, connection.release() 는 정산 클로저 안에만 있어 커넥션이 영영 안 돌아온다.
// 워커당 풀 한도는 100. 즉 조용한 영구 고갈이다.
//
// 여기서 고정하는 것은 그 유실을 만들던 구체적 지점들이다.

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

// ── req 리소스의 pc ──────────────────────────────────────────────────
//
// req 의 pc 는 그 요청의 결과다. 아직 결과가 없으면 비어 있는데,
// 예전에는 방어 없이 JSON.parse 를 불러 '"undefined" is not valid JSON' 으로
// 터졌다. 응답 전송 전이라 워커가 죽고 커넥션이 샜다.
//
// 논블로킹 POST 가 만든 req 를 조회하면 정확히 이 상태다 —
// 평범한 요청 두 번으로 워커를 죽일 수 있었다.
//
// 아래는 실제 exports.response_result 를 태운다. request/response 는 최소 스텁이다.

function fakeReq(resourceObj) {
    return {
        headers: { 'x-m2m-ri': 'ri1', rootnm: 'req', accept: 'application/json' },
        query: { rt: 3 },
        method: 'get',
        url: '/Mobius/17-x',
        usebodytype: 'json',
        resourceObj: resourceObj
    };
}

function fakeRes() {
    const sent = {};
    const res = {
        header: function () { return res; },
        setHeader: function () { return res; },
        status: function (s) { sent.status = s; return res; },
        end: function (b) { sent.body = b; return res; },
        send: function (b) { sent.body = b; return res; }
    };
    res._sent = sent;
    return res;
}

// response_result 를 태우고, 실제로 나간 본문을 돌려준다
function respond(resourceObj) {
    const req = fakeReq(resourceObj);
    const res = fakeRes();
    let settled = 0;
    responder.response_result(req, res, '200', '2000', '', function () { settled++; });
    return { body: res._sent.body, status: res._sent.status, settled: settled };
}

test('결과가 아직 없는 req 를 응답해도 던지지 않는다', function () {
    // JSON.parse(undefined) 는 String(undefined) 를 파싱해 반드시 던진다.
    assert.throws(function () { JSON.parse(undefined); }, SyntaxError);

    const r = quiet(function () { return respond({ req: { rn: 'r', ty: 17 } }); });
    assert.strictEqual(r.settled, 1, '정산은 정확히 한 번');
    const out = JSON.parse(r.body);
    assert.ok(!('pc' in out['m2m:req']),
        'pc 는 선택 속성이다. 빈 객체를 넣으면 "결과가 비었다" 는 거짓말이 된다');
});

test('pc 가 빈 문자열이어도 응답이 나간다', function () {
    const r = quiet(function () { return respond({ req: { rn: 'r', ty: 17, pc: '' } }); });
    assert.strictEqual(r.settled, 1);
    assert.ok(!('pc' in JSON.parse(r.body)['m2m:req']));
});

test('pc 가 깨진 JSON 이어도 응답이 나가고 이유를 남긴다', function () {
    const lines = [];
    const orig = console.error;
    console.error = function (s) { lines.push(String(s)); };
    let r;
    try { r = respond({ req: { rn: 'r', ty: 17, pc: '{"잘린' } }); }
    finally { console.error = orig; }
    assert.strictEqual(r.settled, 1);
    assert.ok(!('pc' in JSON.parse(r.body)['m2m:req']));
    assert.ok(lines.length >= 1, '조용히 넘기면 깨진 행을 못 찾는다');
});

test('정상 pc 는 객체로 파싱되어 나간다', function () {
    const r = respond({ req: { rn: 'r', ty: 17, pc: '{"m2m:cnt":{"rn":"x"}}' } });
    assert.deepStrictEqual(JSON.parse(r.body)['m2m:req'].pc, { 'm2m:cnt': { rn: 'x' } });
});

test('uril 은 공백으로 쪼개져 나간다', function () {
    const r = respond({ req: { rn: 'r', ty: 17, pc: '{"m2m:uril":"/a /b /c"}' } });
    assert.deepStrictEqual(JSON.parse(r.body)['m2m:req'].pc['m2m:uril'], ['/a', '/b', '/c']);
});

// ── cbor 디코드 실패 ─────────────────────────────────────────────────
//
// make_json_obj 의 cbor 분기는 디코드 에러에서 로그만 찍고 콜백을 부르지 않았다.
// xml/json 분기는 실패를 '0' 으로 알린다. 여기만 빠져 있었다.

test('cbor 디코드가 실패해도 콜백은 불려야 한다', function () {
    const cbor = require('cbor');
    return new Promise(function (resolve, reject) {
        let called = 0;
        // 고쳐진 뒤의 형태 — err 분기에서도 콜백을 부른다
        cbor.decodeFirst(Buffer.from('이건 cbor 가 아니다', 'utf8'), function (err) {
            called++;
            if (err) {
                assert.strictEqual(called, 1, '콜백은 정확히 한 번');
                resolve();
            }
            else {
                reject(new Error('이 입력은 디코드에 실패해야 한다 — 테스트 전제가 깨졌다'));
            }
        });
    });
});

// ── 배열 컬럼과 pv/pvs (P2 에서 고친 것의 재확인) ────────────────────
//
// 정산 경로에서 던지는 것이 하나라도 남으면 같은 고갈이 되풀이된다.

test('응답 직렬화는 어떤 깨진 값에도 던지지 않는다', function () {
    const BROKEN = [
        { 'm2m:cnt': { rn: 'x', ty: 3, lbl: '["잘린' } },
        { 'm2m:cnt': { rn: 'x', ty: 3, acpi: '["/Mob' } },
        { 'm2m:sub': { rn: 'x', ty: 23, nu: '<html>' } },
        { 'm2m:acp': { rn: 'x', ty: 1, pv: '{"acr":[' } },
        { 'm2m:ae':  { rn: 'x', ty: 2, poa: 'null' } }
    ];
    BROKEN.forEach(function (o) {
        quiet(function () { responder.typeCheckforJson(o); });   // 던지면 실패한다
    });
});
