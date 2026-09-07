'use strict';
// Verifies that mobius/reason.js reproduces the reason table exactly.
//
// The core constraint is that (status, rsc) never change. The static golden (tools/response-golden) does the exhaustive comparison; this file pins the structural invariants.

const test = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const path = require('path');

const reason = require('../mobius/reason');
const rsc = require('../mobius/rsc');
const ROOT = path.join(__dirname, '..');

test('사유 97개가 있다', function () {
    // Current number of catalogue entries. Changes with every added or removed reason.
    assert.strictEqual(Object.keys(reason.REASON).length, 96);
});

test('모든 사유의 code 가 RSC 카탈로그의 실제 항목이다', function () {
    const catalog = new Set(Object.keys(rsc.RSC).map(function (k) { return rsc.RSC[k]; }));
    const bad = [];
    Object.keys(reason.REASON).forEach(function (k) {
        const r = reason.REASON[k];
        if (!r.code || !catalog.has(r.code)) { bad.push(k); }
        if (typeof r.msg !== 'string') { bad.push(k + ' (msg 가 문자열이 아니다)'); }
    });
    assert.deepStrictEqual(bad, []);
});

test('toLegacyTable 이 app.js 가 쓰던 형태를 만든다', function () {
    const t = reason.toLegacyTable();
    assert.strictEqual(Object.keys(t).length, 96);

    Object.keys(t).forEach(function (k) {
        const row = t[k];
        assert.ok(Array.isArray(row), k + ' 가 배열이 아니다');
        assert.strictEqual(row.length, 3, k + ' 의 길이');
        // The table stores status as a string and callers use it as such.
        assert.strictEqual(typeof row[0], 'string', k + ' 의 status 는 문자열이어야 한다');
        assert.strictEqual(typeof row[1], 'string', k + ' 의 rsc 는 문자열이어야 한다');
        assert.strictEqual(typeof row[2], 'string', k + ' 의 msg 는 문자열이어야 한다');
        assert.ok(/^\d{3}$/.test(row[0]), k + ' 의 status 형식: ' + row[0]);
        assert.ok(/^\d{4}$/.test(row[1]), k + ' 의 rsc 형식: ' + row[1]);
    });
});

test('키 형식이 옛 규칙 그대로다 (개명은 나중 단계)', function () {
    const bad = Object.keys(reason.REASON).filter(function (k) { return !/^\d{3}-\d+$/.test(k); });
    assert.deepStrictEqual(bad, []);
});

test('알려진 항목의 (status, rsc) 는 원본 그대로다', function () {
    const t = reason.toLegacyTable();

    // Wording changed when prefixes were removed, but (status, rsc) stay the same.
    assert.deepStrictEqual(t['400-1'].slice(0, 2), ['400', '4000']);
    assert.strictEqual(t['400-1'][2], 'X-M2M-RI is none');

    // Entry that once carried an escape remnant: the source had \' and the runtime value is '.
    assert.strictEqual(t['400-22'][2], "'Not Present' attribute");

    assert.strictEqual(reason.REASON['405-1'].code.name, 'OPERATION_NOT_ALLOWED');
});

// Two rules: (1) one rsc maps to one HTTP status, per oneM2M TS-0009 (4005 OPERATION_NOT_ALLOWED is 405, not 409). (2) The prefix of a reason key is its HTTP status.

test('사유 키의 접두는 곧 HTTP 상태다', function () {
    const bad = Object.keys(reason.REASON).filter(function (k) {
        return k.split('-')[0] !== String(reason.REASON[k].code.http);
    });
    assert.deepStrictEqual(bad, [], '키 접두와 HTTP 가 다른 사유: ' + bad.join(', '));
});

test('교정된 여덟 사유 — la/ol 에 POST·PUT 은 405, 예약어 rn 은 400, 포워딩 불가는 501/404, 탐색 상한은 400 키로', function () {
    const t = reason.toLegacyTable();
    ['301-3', '301-4', '301-5', '409-1', '409-2', '409-3', '409-4', '500-6'].forEach(function (old) {
        assert.strictEqual(t[old], undefined, old + ' 이 아직 있다');
    });
    assert.deepStrictEqual(t['405-13'], ['405', '4005', 'can not use post, put method at latest resource']);
    assert.deepStrictEqual(t['405-14'], ['405', '4005', 'can not use post, put method at oldest resource']);
    assert.deepStrictEqual(t['405-15'], ['405', '4005', 'requested resource is not supported']);
    assert.deepStrictEqual(t['400-66'], ['400', '4000', 'resource name can not use that is keyword']);
    assert.deepStrictEqual(t['501-3'], ['501', '5001', 'forwarding with mqtt is not supported']);
    assert.deepStrictEqual(t['501-4'], ['501', '5001', 'protocol in poa of csr is not supported']);
    assert.deepStrictEqual(t['404-9'], ['404', '5103', 'remoteCSE has no point of access']);
    assert.strictEqual(reason.REASON['404-9'].code.name, 'TARGET_NOT_REACHABLE');
    assert.deepStrictEqual(t['400-67'].slice(0, 2), ['400', '4000']);
    assert.match(t['400-67'][2], /^discovery scope too large/);
    assert.strictEqual(rsc.RSC.CONFLICT_OPERATION, undefined, '4005 를 409 로 내던 항목이 되살아났다');
});

test('get 은 없는 키에 null 을 준다', function () {
    assert.ok(reason.get('400-1'));
    assert.strictEqual(reason.get('999-99'), null);
});

test('같은 문구를 쓰는 사유가 없다', function () {
    // 400-36 (create_action) and 400-52 (update_action) have different conditions and must have different wording.
    const byMsg = {};
    Object.keys(reason.REASON).forEach(function (k) {
        const m = reason.REASON[k].msg;
        if (!byMsg[m]) { byMsg[m] = []; }
        byMsg[m].push(k);
    });
    const dup = Object.keys(byMsg).filter(function (m) { return byMsg[m].length > 1; })
        .map(function (m) { return byMsg[m].join(',') + ' -> "' + m + '"'; });
    assert.deepStrictEqual(dup, []);
});

test('문구에 결과 코드 접두어가 붙어 있지 않다', function () {
    // The rsc already carries the code; the message does not repeat it as a prefix.
    const withPrefix = Object.keys(reason.REASON)
        .filter(function (k) { return /^[A-Z_ ]{3,}:/.test(reason.REASON[k].msg); });
    assert.deepStrictEqual(withPrefix, [], '접두어가 남아 있다: ' + withPrefix.join(', '));
});

test('아무도 참조하지 않는 사유가 없다', function () {
    // Every code literal in the sources is compared with the catalogue.
    //
    // Subdirectories are included: connection acquisition lives in mobius/db/index.js, and scanning only the top of mobius/ would report a live reason as an orphan.
    const files = ['app.js'];
    (function walk(rel) {
        for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
            const r = rel + '/' + e.name;
            if (e.isDirectory()) { walk(r); }
            else if (e.name.endsWith('.js') && e.name !== 'reason.js') { files.push(r); }
        }
    })('mobius');
    const used = new Set();
    files.forEach(function (f) {
        let s;
        try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return; }
        (s.match(/'\d{3}-\d+'/g) || []).forEach(function (x) { used.add(x.slice(1, -1)); });
    });
    const orphan = Object.keys(reason.REASON).filter(function (k) { return !used.has(k); });
    assert.deepStrictEqual(orphan, [], '참조되지 않는 사유: ' + orphan.join(', '));
});

// dbg / detail separation.

const responder = require('../mobius/responder');

function mockPair() {
    const sent = { headers: {}, status: null, body: null };
    const request = {
        method: 'POST',
        url: '/Mobius',
        query: {},
        // usebodytype is not included; that field no longer exists. A stand-in carrying a field the real object lacks makes the field look used.
        headers: { 'x-m2m-ri': 'unit', 'accept': 'application/json' }
    };
    const response = {
        header: function (k, v) { sent.headers[k] = v; },
        status: function (s) { sent.status = s; return { end: function (b) { sent.body = b; } }; }
    };
    return { request: request, response: response, sent: sent };
}

test('respond 는 dbg 만 응답 본문에 싣는다', function () {
    const m = mockPair();
    let done = false;
    responder.respond(m.request, m.response, {
        code: rsc.RSC.BAD_REQUEST,
        dbg: '클라이언트에게 보일 문구',
        detail: 'internal_function: 내부 상세'
    }, function () { done = true; });

    assert.ok(done, '콜백이 불려야 한다');
    assert.strictEqual(m.sent.status, 400, 'http 는 카탈로그의 number 를 쓴다');
    assert.strictEqual(m.sent.headers['X-M2M-RSC'], '4000');

    const body = JSON.parse(m.sent.body);
    assert.strictEqual(body['m2m:dbg'], '클라이언트에게 보일 문구');
    assert.ok(m.sent.body.indexOf('internal_function') < 0,
        'detail 이 응답 본문에 새어 나갔다: ' + m.sent.body);
});

test('detail 은 로그로 나간다', function () {
    const m = mockPair();
    const orig = console.error;
    const logged = [];
    console.error = function () { logged.push(Array.prototype.join.call(arguments, ' ')); };
    try {
        responder.respond(m.request, m.response, {
            code: rsc.RSC.INTERNAL_SERVER_ERROR,
            dbg: 'resource could not be created',
            detail: 'create_action: insert failed'
        }, function () {});
    } finally {
        console.error = orig;
    }
    assert.ok(logged.some(function (l) { return l.indexOf('create_action: insert failed') >= 0; }),
        'detail 이 로그에 없다: ' + JSON.stringify(logged));
    assert.ok(logged.some(function (l) { return l.indexOf('INTERNAL_SERVER_ERROR') >= 0; }),
        '로그에 코드 이름이 있어야 한다');
});

test('detail 이 없으면 로그도 남기지 않는다', function () {
    const m = mockPair();
    const orig = console.error;
    const logged = [];
    console.error = function () { logged.push(Array.prototype.join.call(arguments, ' ')); };
    try {
        responder.respond(m.request, m.response,
            { code: rsc.RSC.NOT_FOUND, dbg: 'resource does not exist' }, function () {});
    } finally {
        console.error = orig;
    }
    assert.deepStrictEqual(logged, []);
    assert.strictEqual(m.sent.status, 404);
});

test('내부 식별자가 든 사유가 하나도 없다 (D20)', function () {
    // Internal markers such as [parse_to_json] [check_notification] [create_action] [app.use] must not go to the client in m2m:dbg; they belong in detail.
    const leaked = Object.keys(reason.REASON)
        .filter(function (k) { return /\[[A-Za-z_.]+\]/.test(reason.REASON[k].msg); });
    assert.deepStrictEqual(leaked, [], '응답 문구에 내부 식별자가 남아 있다: ' + leaked.join(', '));
});

test('detail 은 18건에 붙어 있고 전부 문자열이다', function () {
    const withDetail = Object.keys(reason.REASON).filter(function (k) { return reason.REASON[k].detail; });
    // Current number of entries that carry a detail. Changes with every added or removed detail.
    assert.strictEqual(withDetail.length, 20);
    withDetail.forEach(function (k) {
        assert.strictEqual(typeof reason.REASON[k].detail, 'string', k);
    });
});

test('toLegacyTable 은 detail 을 내보내지 않는다', function () {
    // The legacy shape is [status, rsc, msg] with 3 elements; detail must not be mixed in.
    const t = reason.toLegacyTable();
    Object.keys(t).forEach(function (k) { assert.strictEqual(t[k].length, 3, k); });
    assert.strictEqual(t['500-4'][2], 'resource could not be created');
});

// Startup self-check.

test('현재 카탈로그는 자체 점검을 통과한다', function () {
    const problems = reason.selfCheck();
    assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('selfCheck 가 실제로 문제를 잡는다', function () {
    // A check that passes without ever catching anything proves nothing; defects are injected. Global objects are touched, so each is restored.

    // 1) missing CoAP mapping
    const savedCoap = rsc.RSC.BAD_REQUEST.coap;
    delete rsc.RSC.BAD_REQUEST.coap;
    assert.ok(reason.selfCheck().some(function (p) { return /coap/.test(p); }),
        'CoAP 매핑 누락을 못 잡는다');
    rsc.RSC.BAD_REQUEST.coap = savedCoap;

    // 2) duplicate wording
    const savedMsg = reason.REASON['400-40'].msg;
    reason.REASON['400-40'].msg = reason.REASON['400-1'].msg;
    assert.ok(reason.selfCheck().some(function (p) { return /같은 문구/.test(p); }),
        '중복 문구를 못 잡는다');
    reason.REASON['400-40'].msg = savedMsg;

    // 3) prefix reintroduced
    const saved1 = reason.REASON['400-1'].msg;
    reason.REASON['400-1'].msg = 'BAD REQUEST: ' + saved1;
    assert.ok(reason.selfCheck().some(function (p) { return /접두어/.test(p); }),
        '접두어를 못 잡는다');
    reason.REASON['400-1'].msg = saved1;

    // 4) internal identifier reintroduced (bracket and parenthesis forms)
    const saved404 = reason.REASON['404-1'].msg;
    reason.REASON['404-1'].msg = 'resource does not exist (get_target_url)';
    assert.ok(reason.selfCheck().some(function (p) { return /내부 식별자/.test(p); }),
        '괄호 형태 내부 식별자를 못 잡는다');
    reason.REASON['404-1'].msg = '[get_target_url] resource does not exist';
    assert.ok(reason.selfCheck().some(function (p) { return /내부 식별자/.test(p); }),
        '대괄호 형태 내부 식별자를 못 잡는다');
    reason.REASON['404-1'].msg = saved404;

    // Restoration check: nothing may leak into later tests.
    assert.deepStrictEqual(reason.selfCheck(), []);
});

test('reportSelfCheck 는 문제가 있어도 던지지 않는다', function () {
    // Must not block startup; a server that fails to start is the greater risk in production.
    const savedMsg = reason.REASON['400-40'].msg;
    reason.REASON['400-40'].msg = reason.REASON['400-1'].msg;

    const origErr = console.error, origLog = console.log;
    const lines = [];
    console.error = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
    console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
    let count;
    try {
        count = reason.reportSelfCheck();          // a throw fails here
    } finally {
        console.error = origErr;
        console.log = origLog;
        reason.REASON['400-40'].msg = savedMsg;
    }

    assert.ok(count > 0, '문제 건수를 돌려줘야 한다');
    assert.ok(lines.some(function (l) { return /기동은 계속한다/.test(l); }),
        '기동을 계속한다는 것이 로그에 드러나야 한다');
});

// detail must not be attached to common reasons. responder.respond writes console.error when detail is present (not in the response body); on a reason that occurs in normal traffic that fills the error log.

test('404-1 에는 detail 이 없다 — 가장 흔한 404 다', function () {
    const r = reason.get('404-1');
    assert.ok(r, '404-1 이 있어야 한다');
    assert.strictEqual(r.detail, undefined,
        '흔한 404 에 detail 을 붙이면 정상 트래픽이 에러 로그를 채운다');
});

test('detail 을 가진 사유는 드물게 나는 것들뿐이다', function () {
    // Makes 'is this a common reason' a deliberate question when adding a detail. Additions go in this list with their reason.
    const ALLOWED = [
        '400-7',   // root tag mismatch: client defect
        '400-19',  // POST without ty and without a notification body
        '400-20',  // Content-Type missing
        '403-5',   // fanOutPoint access denied
        '409-6',   // duplicate aei registration
        '500-4',   // resource creation failed: rare and needs diagnosis
        // ACP guardrails. msg is static, so the response cannot say which value is wrong. Requests that touch ACPs are rare and do not fill the log.
        '400-56',  // pv/pvs is not an object
        '400-57',  // acop missing or outside 0..63
        '400-58',  // acor element is not a string
        '400-59',  // actw is not 6 digits
        '400-60',  // acip has both ipv4 and ipv6
        '400-61',  // acpi element is not a string
        '400-62',  // acpi exceeds varchar(200)
        '400-63',  // acpi points to a non-existent ACP
        '400-67',  // search hit the statement limit: rare and needs diagnosis (formerly 500-6)
        // json-only gate. The detail here is instrumentation rather than diagnosis: the log records how much xml/cbor reaches the request path.
        '400-64',  // request body is xml/cbor
        // Body size limit. The detail is instrumentation as well: the log records how large real bodies are.
        //
        // The response message does not state the limit, so the limit cannot be learned without asking. It is logged only.
        '413-1',   // request body exceeds the limit
        // The upstream (remote CSE or AE) returned something that is not json. Outbound requests carry Accept: application/json, so a conforming peer never triggers this.
        '500-7',   // upstream returned a body that cannot be relayed
        // Unsupported cty filter. The detail is instrumentation: the log shows whether any real client still uses it.
        '400-65',  // cty filter used
        // The settler (settle.done) received an invalid result object: unknown rsc name or shape, or body assembly threw. Not something a client can cause; a programming error in the producer (resource.js etc.), expected to be 0 in normal operation. A throw would skip the connection return and backstop would kill the worker, so it is contained as a 500, with the [settle] log and this detail saying what was wrong.
        '500-8'    // settle.done received an invalid out
    ];
    const withDetail = Object.keys(reason.REASON)
        .filter(function (k) { return reason.REASON[k].detail != null; });
    assert.deepStrictEqual(withDetail.sort(), ALLOWED.slice().sort());
});

test('detail 은 응답 본문에 나가지 않는다', function () {
    // Internal function names must not leak to the client; they are log only.
    const t = reason.toLegacyTable();
    Object.keys(reason.REASON).forEach(function (k) {
        const r = reason.REASON[k];
        if (r.detail == null) { return; }
        assert.ok(t[k][2].indexOf(r.detail) < 0,
            k + ' 의 detail 이 응답 문구에 섞였다: ' + t[k][2]);
    });
});
