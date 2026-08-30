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

test('사유 99개가 있다', function () {
    // 501-1 과 400-4 를 걷어내고, 301-5 / 404-8 을 더했다.
    // 400-4("not parse your body")는 check_resource_supported 가 파싱 실패를
    // 전부 이 하나로 뭉개던 코드였다. 파싱이 한 곳으로 모이면서
    // 400-5(XML) / 400-6(CBOR) / 400-7(JSON) 이 그대로 나가게 되어 쓰이지 않는다.
    // ACP 가드레일 8건(400-56 ~ 400-63)과 탐색 타임아웃(500-6)을 더해 103 이 됐다.
    // 트랜잭션 리소스(tm/tr)를 걷어내며 400-37 / 400-50 / 423-1 이
    // 참조를 잃어 함께 빠져 100 이 됐다.
    // ty 관문을 ty_list 기반으로 바꾸며 405-2("req is not supported when post
    // request")가 참조를 잃어 99 가 됐다 — 타입별 사유가 아니라 목록으로 막는다.
    assert.strictEqual(Object.keys(reason.REASON).length, 99);
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
    assert.strictEqual(Object.keys(t).length, 99);

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

test('detail 은 17건에 붙어 있고 전부 문자열이다', function () {
    const withDetail = Object.keys(reason.REASON).filter(function (k) { return reason.REASON[k].detail; });
    // 404-1 에서 걷어내 8건이 됐고, ACP 가드레일 8건을 더해 16건이다.
    assert.strictEqual(withDetail.length, 17);
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

// ── 기동 자체 점검 ───────────────────────────────────────────────────────

test('현재 카탈로그는 자체 점검을 통과한다', function () {
    const problems = reason.selfCheck();
    assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('selfCheck 가 실제로 문제를 잡는다', function () {
    // 점검이 통과만 하고 아무것도 못 잡으면 있으나 마나다. 결함을 넣어 확인한다.
    // 전역 객체를 건드리므로 매번 원복한다.

    // 1) CoAP 매핑 누락
    const savedCoap = rsc.RSC.BAD_REQUEST.coap;
    delete rsc.RSC.BAD_REQUEST.coap;
    assert.ok(reason.selfCheck().some(function (p) { return /coap/.test(p); }),
        'CoAP 매핑 누락을 못 잡는다');
    rsc.RSC.BAD_REQUEST.coap = savedCoap;

    // 2) 중복 문구
    const savedMsg = reason.REASON['400-40'].msg;
    reason.REASON['400-40'].msg = reason.REASON['400-41'].msg;
    assert.ok(reason.selfCheck().some(function (p) { return /같은 문구/.test(p); }),
        '중복 문구를 못 잡는다');
    reason.REASON['400-40'].msg = savedMsg;

    // 3) 접두어 재유입
    const saved1 = reason.REASON['400-1'].msg;
    reason.REASON['400-1'].msg = 'BAD REQUEST: ' + saved1;
    assert.ok(reason.selfCheck().some(function (p) { return /접두어/.test(p); }),
        '접두어를 못 잡는다');
    reason.REASON['400-1'].msg = saved1;

    // 4) 내부 식별자 재유입 (대괄호·괄호 두 형태)
    const saved404 = reason.REASON['404-1'].msg;
    reason.REASON['404-1'].msg = 'resource does not exist (get_target_url)';
    assert.ok(reason.selfCheck().some(function (p) { return /내부 식별자/.test(p); }),
        '괄호 형태 내부 식별자를 못 잡는다');
    reason.REASON['404-1'].msg = '[get_target_url] resource does not exist';
    assert.ok(reason.selfCheck().some(function (p) { return /내부 식별자/.test(p); }),
        '대괄호 형태 내부 식별자를 못 잡는다');
    reason.REASON['404-1'].msg = saved404;

    // 원복 확인 — 뒤 테스트에 오염을 남기면 안 된다
    assert.deepStrictEqual(reason.selfCheck(), []);
});

test('reportSelfCheck 는 문제가 있어도 던지지 않는다', function () {
    // 기동을 막으면 안 된다. 운영 배포에서 서버가 안 뜨는 쪽이 더 위험하다.
    const savedMsg = reason.REASON['400-40'].msg;
    reason.REASON['400-40'].msg = reason.REASON['400-41'].msg;

    const origErr = console.error, origLog = console.log;
    const lines = [];
    console.error = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
    console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
    let count;
    try {
        count = reason.reportSelfCheck();          // 던지면 여기서 실패한다
    } finally {
        console.error = origErr;
        console.log = origLog;
        reason.REASON['400-40'].msg = savedMsg;
    }

    assert.ok(count > 0, '문제 건수를 돌려줘야 한다');
    assert.ok(lines.some(function (l) { return /기동은 계속한다/.test(l); }),
        '기동을 계속한다는 것이 로그에 드러나야 한다');
});

// ── detail 은 흔한 사유에 붙이면 안 된다 ─────────────────────────────
//
// responder.respond 는 detail 이 있으면 console.error 를 찍는다(응답 본문에는
// 안 나간다). 정상 운영에서 흔히 나는 사유에 붙이면 평범한 트래픽이 에러
// 로그를 채운다. 404-1("resource does not exist")이 실제로 그랬다 —
// 존재하지 않는 리소스를 조회할 때마다 [NOT_FOUND] get_target_url 이 쌓였다.

test('404-1 에는 detail 이 없다 — 가장 흔한 404 다', function () {
    const r = reason.get('404-1');
    assert.ok(r, '404-1 이 있어야 한다');
    assert.strictEqual(r.detail, undefined,
        '흔한 404 에 detail 을 붙이면 정상 트래픽이 에러 로그를 채운다');
});

test('detail 을 가진 사유는 드물게 나는 것들뿐이다', function () {
    // 새로 detail 을 붙일 때 "이게 흔한 사유인가"를 한 번 더 생각하게 한다.
    // 늘리려면 이 목록에 근거와 함께 추가한다.
    const ALLOWED = [
        '400-5',   // 본문이 XML 이 아님 — 클라이언트 결함
        '400-6',   // 본문이 CBOR 이 아님 — 클라이언트 결함
        '400-7',   // 루트 태그 불일치 — 클라이언트 결함
        '400-19',  // ty 없는 POST 에 알림 본문이 없음
        '400-20',  // Content-Type 누락
        '403-5',   // fanOutPoint 접근 거부
        '409-6',   // aei 중복 등록
        '500-4',   // 리소스 생성 실패 — 드물고 진단이 필요하다
        // ACP 가드레일. msg 가 정적이라 어느 값이 문제인지 응답에 담지 못한다.
        // ACP 를 손대는 요청 자체가 드물어(배포에 ACP 1개) 로그를 채우지 않는다.
        '400-56',  // pv/pvs 가 객체가 아님
        '400-57',  // acop 이 없거나 0~63 밖
        '400-58',  // acor 원소가 문자열이 아님
        '400-59',  // actw 가 6자리가 아님
        '400-60',  // acip 에 ipv4 와 ipv6 가 동시에
        '400-61',  // acpi 원소가 문자열이 아님
        '400-62',  // acpi 가 varchar(200) 을 넘김
        '400-63',  // acpi 가 없는 ACP 를 가리킴
        '500-6'    // 탐색이 문장 상한에 걸림 — 드물고 진단이 필요하다
    ];
    const withDetail = Object.keys(reason.REASON)
        .filter(function (k) { return reason.REASON[k].detail != null; });
    assert.deepStrictEqual(withDetail.sort(), ALLOWED.slice().sort());
});

test('detail 은 응답 본문에 나가지 않는다', function () {
    // 내부 함수명이 클라이언트로 새면 안 된다. 로그 전용이다.
    const t = reason.toLegacyTable();
    Object.keys(reason.REASON).forEach(function (k) {
        const r = reason.REASON[k];
        if (r.detail == null) { return; }
        assert.ok(t[k][2].indexOf(r.detail) < 0,
            k + ' 의 detail 이 응답 문구에 섞였다: ' + t[k][2]);
    });
});
