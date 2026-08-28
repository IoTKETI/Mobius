'use strict';
// mobius/reason.js 가 app.js 가 쓰던 표를 정확히 재현하는지 검증한다.
//
// 핵심 제약은 (status, rsc) 를 바꾸지 않는 것이다. 문구는 정리 단계에서
// 접두어 제거·오타 수정으로 바뀌었지만 코드 값은 그대로여야 한다.
// 정적 골든(tools/response-golden)이 전수 비교를 담당하고, 여기서는
// 구조적 불변식을 잠근다.

const test = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const path = require('path');

const reason = require('../mobius/reason');
const rsc = require('../mobius/rsc');
const ROOT = path.join(__dirname, '..');

test('사유 92개가 있다', function () {
    assert.strictEqual(Object.keys(reason.REASON).length, 92);   // 501-1 은 아무도 안 써서 걷어냈다
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
    assert.strictEqual(Object.keys(t).length, 92);

    Object.keys(t).forEach(function (k) {
        const row = t[k];
        assert.ok(Array.isArray(row), k + ' 가 배열이 아니다');
        assert.strictEqual(row.length, 3, k + ' 의 길이');
        // 기존 표는 status 를 문자열로 담았다. 호출부가 그대로 쓰므로 유지해야 한다.
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

    // 문구는 접두어를 걷어내며 바뀌었지만 (status, rsc) 는 그대로여야 한다.
    assert.deepStrictEqual(t['400-1'].slice(0, 2), ['400', '4000']);
    assert.strictEqual(t['400-1'][2], 'X-M2M-RI is none');

    // 이스케이프 잔재가 있던 항목 — 소스에는 \' 였고 런타임 값은 ' 이다
    assert.strictEqual(t['400-22'][2], "'Not Present' attribute");

    // 키 접두는 301 인데 실제 http 는 405 인 항목 (키 규칙 위반, 값은 보존)
    assert.deepStrictEqual(t['301-3'], ['405', '4005', 'forwarding with mqtt is not supported']);

    // 같은 rsc 4005 인데 http 가 409 인 항목 — CONFLICT_OPERATION 으로 갈렸다
    assert.deepStrictEqual(t['409-1'], ['409', '4005', 'can not use post, put method at latest resource']);
    assert.strictEqual(reason.REASON['409-1'].code.name, 'CONFLICT_OPERATION');
    assert.strictEqual(reason.REASON['405-1'].code.name, 'OPERATION_NOT_ALLOWED');
});

test('get 은 없는 키에 null 을 준다', function () {
    assert.ok(reason.get('400-1'));
    assert.strictEqual(reason.get('999-99'), null);
});

test('같은 문구를 쓰는 사유가 없다', function () {
    // 400-36(create_action) 과 400-52(update_action) 가 둘 다
    // "ty does not supported" 였다. 조건이 다르므로 문구도 달라야 한다.
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
    // rsc 가 이미 코드를 나른다. 문구에 되풀이할 이유가 없고, 실제로 47건은
    // 'BAD REQUEST: ' 를 달고 25건은 아무것도 없어 일관성이 없었다.
    const withPrefix = Object.keys(reason.REASON)
        .filter(function (k) { return /^[A-Z_ ]{3,}:/.test(reason.REASON[k].msg); });
    assert.deepStrictEqual(withPrefix, [], '접두어가 남아 있다: ' + withPrefix.join(', '));
});

test('아무도 참조하지 않는 사유가 없다', function () {
    // 501-1 이 그랬다. 코드 리터럴을 전수 조사해 대조한다.
    const files = ['app.js'].concat(
        fs.readdirSync(path.join(ROOT, 'mobius'))
            .filter(function (f) { return f.endsWith('.js') && f !== 'reason.js'; })
            .map(function (f) { return 'mobius/' + f; }));
    const used = new Set();
    files.forEach(function (f) {
        let s;
        try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return; }
        (s.match(/'\d{3}-\d+'/g) || []).forEach(function (x) { used.add(x.slice(1, -1)); });
    });
    const orphan = Object.keys(reason.REASON).filter(function (k) { return !used.has(k); });
    assert.deepStrictEqual(orphan, [], '참조되지 않는 사유: ' + orphan.join(', '));
});

// ── dbg / detail 분리 ────────────────────────────────────────────────────

const responder = require('../mobius/responder');

function mockPair() {
    const sent = { headers: {}, status: null, body: null };
    const request = {
        method: 'POST',
        url: '/Mobius',
        query: {},
        headers: { 'x-m2m-ri': 'unit', 'accept': 'application/json' },
        usebodytype: 'json'
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
    // [parse_to_json] [check_notification] [create_action] [app.use] 같은 것이
    // m2m:dbg 로 클라이언트에 나가고 있었다. detail 로 옮겼다.
    const leaked = Object.keys(reason.REASON)
        .filter(function (k) { return /\[[A-Za-z_.]+\]/.test(reason.REASON[k].msg); });
    assert.deepStrictEqual(leaked, [], '응답 문구에 내부 식별자가 남아 있다: ' + leaked.join(', '));
});

test('detail 은 8건에 붙어 있고 전부 문자열이다', function () {
    const withDetail = Object.keys(reason.REASON).filter(function (k) { return reason.REASON[k].detail; });
    assert.strictEqual(withDetail.length, 9);
    withDetail.forEach(function (k) {
        assert.strictEqual(typeof reason.REASON[k].detail, 'string', k);
    });
});

test('toLegacyTable 은 detail 을 내보내지 않는다', function () {
    // 옛 형태는 [status, rsc, msg] 3원소다. detail 이 섞이면 안 된다.
    const t = reason.toLegacyTable();
    Object.keys(t).forEach(function (k) { assert.strictEqual(t[k].length, 3, k); });
    assert.strictEqual(t['500-4'][2], 'resource could not be created');
});
