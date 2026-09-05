/**
 * 2단계 6번 — settle.done(code, out): 정산의 단일 진입점.
 *
 * 옛 라우트 넷은 lookup_* 의 코드 문자열을 보고 settle.result / .search / .rcn3
 * 중 하나를 골랐다 — 모양 정보('200-1' 은 discovery)가 코드에 인코딩되어 세
 * 층을 관통했다. 6번에서 그 if-else 를 settle 안의 이행기 표(LEGACY)로 옮기고,
 * 8·9번에서 생산자가 out = { rsc, shape, rootnm, body } 를 주게 되면서 줄이
 * 빠졌고, 10번에서 표와 옛 세 갈래·responder 의 옛 세 함수를 지웠다.
 *
 * 지키는 것:
 *   1. done(code) 는 메서드·코드와 무관하게 언제나 on_error 다 — 옛 갈래가 없다
 *   2. out 이 오면 카탈로그(rsc.js)와 body_of 를 거쳐 respond 로
 *   3. 잘못된 out(모르는 rsc·shape)은 **던지지 않고** 500-8 — 던지면 커넥션
 *      반납을 못 한다
 *   4. 두 번 정산은 막힌다 (done 도 claim 을 거친다)
 *   5. 옛 갈래(settle.result/search/rcn3 · responder 의 세 함수)가 되살아나지 않는다
 *   6. app.js 라우트 넷과 run_fanout 이 done 을 부른다
 *   7. 생산자 다섯의 성공 종단이 코드가 아니라 결과 객체를 준다
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const settle_mod = require('../mobius/settle');
const responder = require('../mobius/responder');
const shape = require('../mobius/shape');
const RSC = require('../mobius/rsc').RSC;
const MOBIUS_DIR = path.join(__dirname, '..', 'mobius');

function fakeConn() {
    const c = { released: 0 };
    c.release = function () { c.released++; };
    return c;
}
function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); } finally { console.error = orig; }
    return lines;
}
// responder 의 배출구 respond 를 기록기로 바꿔 끼운다. settle 은 모듈 객체를
// 통해 부르므로 여기서 갈아끼운 것이 그대로 먹는다.
function spyResponder(log) {
    const orig = responder.respond;
    responder.respond = (rq, rs, spec, cb) => { log.push(['respond', spec]); cb(); };
    return function restore() { responder.respond = orig; };
}
function onError(log) {
    return function (rq, rs, code, cb) { log.push(['error', code]); cb(); };
}
function req(method, extra) {
    return Object.assign({ method: method, query: {}, headers: { rootnm: 'cnt' } }, extra || {});
}

test('옛 갈래가 없다 — settle 에 result/search/rcn3, responder 에 세 함수가 없다', () => {
    const s = settle_mod.make(req('GET'), {}, fakeConn(), onError([]));
    ['result', 'search', 'rcn3'].forEach((n) => assert.strictEqual(typeof s[n], 'undefined', 'settle.' + n));
    assert.strictEqual(typeof settle_mod.LEGACY, 'undefined', '이행기 표가 남아 있다');
    ['response_result', 'search_result', 'response_rcn3_result'].forEach((n) =>
        assert.strictEqual(typeof responder[n], 'undefined', 'responder.' + n));
    assert.strictEqual(typeof responder.body_of, 'function');
    assert.strictEqual(typeof responder.respond, 'function');
});

test('done(code): 메서드·코드와 무관하게 언제나 on_error 로 — 옛 성공 코드도 예외가 아니다', () => {
    // '200'/'200-1'/'201'/'201-3' 은 이행기에 옛 갈래로 가던 코드다. 이제 생산자가
    // 코드를 주면 그것은 실패이고, 옛 코드를 주는 생산자가 남아 있으면 여기서 드러난다.
    const CODES = ['200', '200-1', '201', '201-3', '400-1', '404-4', '500-1', '2000', '', undefined];
    ['POST', 'GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', undefined].forEach((method) => {
        CODES.forEach((code) => {
            const log = [];
            const restore = spyResponder(log);
            const conn = fakeConn();
            try {
                const s = settle_mod.make(req(method), {}, conn, onError(log));
                s.done(code);
            } finally { restore(); }
            assert.deepStrictEqual(log, [['error', code]], method + ' ' + JSON.stringify(code));
            assert.strictEqual(conn.released, 1, '반납은 한 번');
        });
    });
});

test('done(null, out): 카탈로그 status·rsc 와 body_of 본문으로 respond 를 부른다', () => {
    const cases = [
        { rsc: 'CREATED', shape: 'single', body: { 'm2m:cnt': { rn: 'a', ty: '3' } } },
        { rsc: 'OK', shape: 'grouped', rootnm: 'cnt', body: { 'm2m:cnt': [{ rn: 'a', ty: '3' }] } },
        // rce 는 생산자가 { rce: { uri, <rootnm>: {…} } } 로 준다 — shape.rce 가 접두를 붙인다
        { rsc: 'UPDATED', shape: 'rce', rootnm: 'cnt', body: { rce: { uri: 'Mobius/a', cnt: { rn: 'a', ty: '3' } } } },
        { rsc: 'DELETED', shape: 'uril', rootnm: 'uril', body: { uril: ['/Mobius/a'] } }
    ];
    // 기대값은 body_of 가 아니라 **shape 함수로 직접** 만든다 — body_of 로 만들면
    // body_of 가 모양을 바꿔 불러도(rce 가 grouped 로) 양쪽이 같이 틀려 못 잡는다.
    // 변이 시험에서 실제로 그렇게 놓쳤다. grouped 만은 정규화 함수
    // (typeCheckforJson2)가 responder 밖으로 안 나와 body_of 를 쓴다.
    const copy = (o) => JSON.parse(JSON.stringify(o));
    const EXPECT = {
        single:  (o) => shape.single(copy(o.body), '1', responder.typeCheckforJson),
        rce:     (o) => shape.rce(copy(o.body), o.rootnm, responder.typeCheckforJson),
        uril:    (o) => shape.uril(copy(o.body), o.rootnm),
        grouped: (o) => responder.body_of(copy(o), '1')
    };
    cases.forEach((out) => {
        const log = [];
        const restore = spyResponder(log);
        const conn = fakeConn();
        // body_of 는 본문을 제자리에서 고치므로 기대값은 사본으로 따로 만든다
        const want = EXPECT[out.shape](out);
        try {
            const s = settle_mod.make(req('POST', { query: { rcn: '1' } }), {}, conn, onError(log));
            s.done(null, out);
        } finally { restore(); }
        assert.strictEqual(log.length, 1, out.rsc);
        assert.strictEqual(log[0][0], 'respond', '옛 세 함수를 타지 않는다');
        assert.deepStrictEqual(log[0][1], { status: RSC[out.rsc].http, rsc: RSC[out.rsc].rsc, body: want });
        assert.strictEqual(conn.released, 1);
    });
});

test('잘못된 out 은 던지지 않고 500-8 로 정산하며 반납한다', () => {
    [{ rsc: 'NOPE', shape: 'single', body: {} },
     { rsc: 'OK', shape: 'nope', body: {} },
     { rsc: 'OK', shape: 'grouped', rootnm: 'cnt', body: null }].forEach((out) => {
        const log = [];
        const restore = spyResponder(log);
        const conn = fakeConn();
        let lines;
        try {
            const s = settle_mod.make(req('GET'), {}, conn, onError(log));
            lines = quiet(() => { s.done(null, out); });
        } finally { restore(); }
        assert.deepStrictEqual(log, [['error', '500-8']], JSON.stringify(out));
        assert.strictEqual(conn.released, 1);
        assert.ok(lines.length === 1 && /\[settle\] done/.test(lines[0]), '무엇이 틀렸는지 로그에 남는다');
    });
});

test('done 은 claim 을 거친다 — 두 번째는 막히고 로그로 남는다', () => {
    const log = [];
    const restore = spyResponder(log);
    const conn = fakeConn();
    try {
        // 옛 갈래에 기대지 않는다 — 8·9번을 거치며 전부 빠진다. out 으로 정산한 뒤 또 out 이 와도 막힌다
        // 본문은 진짜 모양이어야 한다 — {} 는 root_key 가 던져 500-8 로 간다
        const s = settle_mod.make(req('PUT', { query: { rcn: '1' } }), {}, conn, onError(log));
        s.done(null, { rsc: 'UPDATED', shape: 'single', body: { 'm2m:cnt': { rn: 'a', ty: '3' } } });
        const lines = quiet(() => { s.done(null, { rsc: 'OK', shape: 'single', body: { 'm2m:cnt': { rn: 'b', ty: '3' } } }); });
        assert.strictEqual(lines.length, 1);
        assert.ok(/settle/.test(lines[0]) && /done OK/.test(lines[0]), lines[0]);
    } finally { restore(); }
    assert.strictEqual(log.length, 1, '두 번째 응답은 나가면 안 된다');
    assert.strictEqual(log[0][0], 'respond');
    assert.strictEqual(log[0][1].rsc, '2004');
    assert.strictEqual(conn.released, 1);
});

test('body_of: 네 모양은 shape 의 같은 함수로, 모르는 모양은 TypeError', () => {
    const one = { 'm2m:cnt': { rn: 'a', ty: '3' } };
    assert.deepStrictEqual(responder.body_of({ shape: 'single', body: JSON.parse(JSON.stringify(one)) }, '1'),
                           shape.single(JSON.parse(JSON.stringify(one)), '1', responder.typeCheckforJson));
    assert.deepStrictEqual(responder.body_of({ shape: 'uril', rootnm: 'uril', body: { uril: ['/a'] } }),
                           shape.uril({ uril: ['/a'] }, 'uril'));
    const rce = () => ({ rce: { uri: 'Mobius/a', cnt: { rn: 'a', ty: '3' } } });
    assert.deepStrictEqual(responder.body_of({ shape: 'rce', rootnm: 'cnt', body: rce() }),
                           shape.rce(rce(), 'cnt', responder.typeCheckforJson));
    // grouped 는 원소 배열을 받는다 — rce 와 모양이 다르므로 서로 바꿔 부르면 여기서 갈린다
    const grouped = responder.body_of({ shape: 'grouped', rootnm: 'cnt', body: { 'm2m:cnt': [{ rn: 'a', ty: '3' }] } });
    assert.ok(grouped && !('m2m:rce' in grouped), 'grouped 결과에 m2m:rce 가 있으면 rce 로 갔다');
    assert.throws(() => responder.body_of({ shape: 'list', body: {} }), TypeError);
    assert.throws(() => responder.body_of({ body: {} }), TypeError);
});

test('app.js 라우트 넷이 settle.done 을 부르고 옛 세 함수를 직접 안 부른다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    const count = (n) => src.split(n).length - 1;
    assert.strictEqual(count('settle.done('), 2, 'run_operation 과 run_fanout 둘 (3단계 13번)');
    assert.strictEqual(count('settle.result('), 0);
    assert.strictEqual(count('settle.rcn3('), 0);
    assert.strictEqual(count('settle.search('), 0, 'run_fanout 도 done 을 쓴다 (2단계 9번)');
    ['lookup_create', 'lookup_retrieve', 'lookup_update', 'lookup_delete'].forEach((fn) => {
        assert.strictEqual(count('run_operation(request, response, settle, ' + fn + ')'), 1, fn + ' 은 run_operation 으로 간다 (3단계 13번)');
    });
    assert.ok(/lookup\(request, response, \(code, out\) => \{ settle\.done\(code, out\); \}\)/.test(src),
              'run_operation 이 (code, out) 을 done 으로 넘긴다');
});

test('resource 경로에 두 번째 인자를 버리는 통과 릴레이가 없다 (2단계 7번)', () => {
    // lookup_* → authorize_and_run → resource.* 사이에 `(code) => { callback(code); }`
    // 가 두 곳 있었다. 오늘은 무해하지만(생산자가 코드만 준다) 생산자가 (null, out)
    // 을 주는 순간 out 이 여기서 사라진다 — 모든 성공 요청이 500-8 이 된다.
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    assert.ok(src.includes('run(request, response, callback);'), 'authorize_and_run 이 콜백을 그대로 넘긴다');
    assert.ok(src.includes('resource.update(request, response, callback);'), 'acpi 전용 update 가 콜백을 그대로 넘긴다');
    const relays = src.match(/\b(run|resource\.\w+)\(request, response, \(code\) => \{\s*callback\(code\);\s*\}\);/g) || [];
    assert.deepStrictEqual(relays, [], 'resource 경로의 통과 릴레이');
});

test('resource.retrieve 의 성공 종단이 코드가 아니라 결과 객체를 준다 (2단계 8번)', () => {
    // 옛 종단 셋: fu=2&rcn=1 → '200', fu=1 → '200-1'(uril), rcn=4/5/6 → '200-1'(grouped).
    // '200-1' 은 discovery 에서만 나던 코드라 파일 전체에서 0 이어야 한다.
    const src = fs.readFileSync(path.join(MOBIUS_DIR, 'resource.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    const count = (n) => src.split(n).length - 1;
    assert.strictEqual(count("callback('200-1')"), 0, "discovery 종단에 '200-1' 이 남아 있다");
    assert.strictEqual(count("{ rsc: 'OK', shape: 'single', rootnm: request.headers.rootnm, body: request.resourceObj }"), 1);
    assert.strictEqual(count("{ rsc: 'OK', shape: 'uril', rootnm: 'uril', body: request.resourceObj }"), 1);
    assert.strictEqual(count("{ rsc: 'OK', shape: 'grouped', rootnm: request.headers.rootnm, body: request.resourceObj }"), 1);
    // shape 이름은 body_of 가 아는 넷 중 하나여야 한다 — 오타는 런타임 500-8 이다
    const shapes = (src.match(/shape: '([a-z]+)'/g) || []).map((s) => s.slice(8, -1));
    shapes.forEach((s) => assert.ok(['single', 'rce', 'uril', 'grouped'].indexOf(s) >= 0, s));
    // rsc 이름도 카탈로그에 있어야 한다
    const rscs = (src.match(/rsc: '([A-Z_]+)'/g) || []).map((s) => s.slice(6, -1));
    rscs.forEach((r) => assert.ok(Object.prototype.hasOwnProperty.call(RSC, r), r));
});

test('resource.create 의 성공 종단이 결과 객체를 준다 (2단계 9번)', () => {
    // 옛 종단 셋: rcn=2 → '201'(uri, single), rcn=3 → '201-3'(rce), 그 밖 → '201'(single)
    const src = fs.readFileSync(path.join(MOBIUS_DIR, 'resource.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    const count = (n) => src.split(n).length - 1;
    assert.strictEqual(count("callback('201')"), 0);
    assert.strictEqual(count("callback('201-3')"), 0);
    assert.strictEqual(count("{ rsc: 'CREATED', shape: 'single', rootnm: 'uri', body: request.resourceObj }"), 1);
    assert.strictEqual(count("{ rsc: 'CREATED', shape: 'rce', rootnm: rootnm, body: request.resourceObj }"), 1);
    assert.strictEqual(count("{ rsc: 'CREATED', shape: 'single', rootnm: rootnm, body: request.resourceObj }"), 1);
});

test('resource.update 의 성공 종단이 결과 객체를 준다 (2단계 9번)', () => {
    const src = fs.readFileSync(path.join(MOBIUS_DIR, 'resource.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    const count = (n) => src.split(n).length - 1;
    assert.strictEqual(count("{ rsc: 'UPDATED', shape: 'single', rootnm: rootnm, body: request.resourceObj }"), 1);
});

test('resource.delete 의 성공 종단이 결과 객체를 준다 (2단계 9번)', () => {
    const src = fs.readFileSync(path.join(MOBIUS_DIR, 'resource.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    const count = (n) => src.split(n).length - 1;
    assert.strictEqual(count("{ rsc: 'DELETED', shape: 'single', rootnm: rootnm, body: request.resourceObj }"), 1);
});

test('fopt.check 의 성공 종단이 결과 객체를 준다 (2단계 9번)', () => {
    const src = fs.readFileSync(path.join(MOBIUS_DIR, 'fopt.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    const count = (n) => src.split(n).length - 1;
    assert.strictEqual(count("{ rsc: 'OK', shape: 'grouped', rootnm: 'agr', body: request.resourceObj }"), 1);
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(/fopt\.check\(request, response, result_grp, body_Obj, \(code, out\) => \{\s*settle\.done\(code, out\);/.test(app),
              'run_fanout 이 (code, out) 을 done 으로 넘긴다');
});
