/**
 * settle.done(code, out): the single entry point of settlement.
 *
 * Guarded here:
 *   1. done(code) is always on_error, regardless of method or code; no legacy branches
 *   2. with out, the result goes through the catalogue (rsc.js) and body_of to respond
 *   3. an invalid out (unknown rsc or shape) does not throw but yields 500-8; a throw would skip the connection return
 *   4. double settlement is blocked (done goes through claim too)
 *   5. the legacy branches (settle.result/search/rcn3, responder's three functions) do not return
 *   6. the four app.js routes and run_fanout call done
 *   7. the success terminals of the five producers pass a result object, not a code
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
// Replaces responder's exit respond with a recorder. settle calls it through the module object, so the replacement takes effect.
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
    // '200'/'200-1'/'201'/'201-3' were success codes in the old contract. A producer passing a code is now a failure, so a producer still using the old codes shows up here.
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
        // rce is given by the producer as { rce: { uri, <rootnm>: {...} } }; shape.rce adds the prefix.
        { rsc: 'UPDATED', shape: 'rce', rootnm: 'cnt', body: { rce: { uri: 'Mobius/a', cnt: { rn: 'a', ty: '3' } } } },
        { rsc: 'DELETED', shape: 'uril', rootnm: 'uril', body: { uril: ['/Mobius/a'] } }
    ];
    // Expected values are built with the shape functions directly, not body_of. Built with body_of, a shape mix-up (rce called as grouped) would change both sides and go unnoticed. The same holds for grouped: without the normaliser (typeCheckforJson2) in the expectation, removing grouped's normalisation entirely would still pass.
    const copy = (o) => JSON.parse(JSON.stringify(o));
    const EXPECT = {
        single:  (o) => shape.single(copy(o.body), '1', responder.typeCheckforJson),
        rce:     (o) => shape.rce(copy(o.body), o.rootnm, responder.typeCheckforJson),
        uril:    (o) => shape.uril(copy(o.body), o.rootnm),
        grouped: (o) => shape.grouped(copy(o.body), o.rootnm, responder.typeCheckforJson2)
    };
    cases.forEach((out) => {
        const log = [];
        const restore = spyResponder(log);
        const conn = fakeConn();
        // body_of modifies the body in place, so the expectation is built from a copy.
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
        // A second out after an out settlement is blocked as well. The body must be a real shape: {} makes root_key throw and yields 500-8.
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
    // grouped takes an element array; its shape differs from rce, so calling one as the other diverges here.
    const grouped = responder.body_of({ shape: 'grouped', rootnm: 'cnt', body: { 'm2m:cnt': [{ rn: 'a', ty: '3' }] } });
    assert.ok(grouped && !('m2m:rce' in grouped), 'grouped 결과에 m2m:rce 가 있으면 rce 로 갔다');
    // grouped's normalisation is pinned by value: a discovery (fu=2&rcn=4) result is a row map keyed by ri, and body_of applies typeCheckforJson2 one level in, restoring ty, st and cni to numbers and lbl to an array. A missing or one-level normalisation diverges here.
    assert.deepStrictEqual(
        responder.body_of({ shape: 'grouped', rootnm: 'rsp',
            body: { '/Mobius/ae/c1': { rn: 'c1', ty: '3', pi: '/Mobius/ae', lbl: '["l"]', st: '0', cni: '5', cr: 'Cx' } } }, '4'),
        { 'm2m:rsp': { 'm2m:cnt': [{ rn: 'c1', ty: 3, pi: '/Mobius/ae', lbl: ['l'], st: 0, cni: 5, cr: 'Cx' }] } });
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
    // The method is passed as the literal name the route knows. Passing request.method would hand over HEAD, which Express 4 routes through app.get; HEAD is not in the table, the gate throws and the worker dies.
    const METHOD = { lookup_create: 'POST', lookup_retrieve: 'GET', lookup_update: 'PUT', lookup_delete: 'DELETE' };
    Object.keys(METHOD).forEach((fn) => {
        assert.strictEqual(count("run_operation(request, response, settle, '" + METHOD[fn] + "', " + fn + ')'), 1,
                           fn + ' 은 run_operation 으로 간다 — 메서드 리터럴과 함께 (3단계 13번)');
    });
    assert.strictEqual(count('route_gate.reject(request.method'), 0, '게이트에 request.method 를 넘기면 HEAD 가 던진다');
    assert.strictEqual(count('route_gate.reject(method, request.query)'), 1);
    assert.ok(/lookup\(request, response, \(code, out\) => \{ settle\.done\(code, out\); \}\)/.test(src),
              'run_operation 이 (code, out) 을 done 으로 넘긴다');
});

test('resource 경로에 두 번째 인자를 버리는 통과 릴레이가 없다 (2단계 7번)', () => {
    // Between lookup_* -> authorize_and_run -> resource.* there must be no `(code) => { callback(code); }` pass-through: it drops out the moment a producer calls (null, out), turning every successful request into 500-8.
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    assert.ok(src.includes('run(request, response, callback);'), 'authorize_and_run 이 콜백을 그대로 넘긴다');
    assert.ok(src.includes('resource.update(request, response, callback);'), 'acpi 전용 update 가 콜백을 그대로 넘긴다');
    const relays = src.match(/\b(run|resource\.\w+)\(request, response, \(code\) => \{\s*callback\(code\);\s*\}\);/g) || [];
    assert.deepStrictEqual(relays, [], 'resource 경로의 통과 릴레이');
});

test('resource.retrieve 의 성공 종단이 코드가 아니라 결과 객체를 준다 (2단계 8번)', () => {
    // The three former terminals: fu=2&rcn=1 -> '200', fu=1 -> '200-1' (uril), rcn=4/5/6 -> '200-1' (grouped). '200-1' occurred only in discovery and must not appear anywhere in the file.
    const src = fs.readFileSync(path.join(MOBIUS_DIR, 'resource.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
    const count = (n) => src.split(n).length - 1;
    assert.strictEqual(count("callback('200-1')"), 0, "discovery 종단에 '200-1' 이 남아 있다");
    assert.strictEqual(count("{ rsc: 'OK', shape: 'single', rootnm: request.headers.rootnm, body: request.resourceObj }"), 1);
    assert.strictEqual(count("{ rsc: 'OK', shape: 'uril', rootnm: 'uril', body: request.resourceObj }"), 1);
    assert.strictEqual(count("{ rsc: 'OK', shape: 'grouped', rootnm: request.headers.rootnm, body: request.resourceObj }"), 1);
    // The shape name must be one of the four body_of knows; a typo is a runtime 500-8.
    const shapes = (src.match(/shape: '([a-z]+)'/g) || []).map((s) => s.slice(8, -1));
    shapes.forEach((s) => assert.ok(['single', 'rce', 'uril', 'grouped'].indexOf(s) >= 0, s));
    // rsc names must be in the catalogue as well.
    const rscs = (src.match(/rsc: '([A-Z_]+)'/g) || []).map((s) => s.slice(6, -1));
    rscs.forEach((r) => assert.ok(Object.prototype.hasOwnProperty.call(RSC, r), r));
});

test('resource.create 의 성공 종단이 결과 객체를 준다 (2단계 9번)', () => {
    // The three former terminals: rcn=2 -> '201' (uri, single), rcn=3 -> '201-3' (rce), otherwise '201' (single).
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
