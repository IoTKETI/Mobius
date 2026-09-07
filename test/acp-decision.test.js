'use strict';
// ACP decisions: a silently wrong decision is invisible.
//
// Neither a crash nor a hang, so nothing appears in the log. Granting too much is a security hole; granting too little rejects valid requests.

const test = require('node:test');
const assert = require('node:assert');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const security = require('../mobius/security');

// Swallows the log and returns the lines.
function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); }
    finally { console.error = orig; }
    return lines;
}

// ── actw (accessControlWindow) ──
//
// A time window in crontab form (second minute hour day month weekday). A window matches only when all six fields match, and '*' means unrestricted.

// 12:15:30, June 5th, Wednesday (3)
const NOW = [30, 15, 12, 5, 6, 3];

test("'* * * * * *' 는 항상 허용이다 — 예전에는 항상 거부였다", function () {
    // The actw_arr[d] != '*' condition would leave no field matchable.
    assert.strictEqual(security._actw_matches('* * * * * *', NOW), true);
});

test('여섯 자리가 전부 맞아야 허용이다', function () {
    assert.strictEqual(security._actw_matches('30 15 12 5 6 3', NOW), true);
});

test('한 자리만 맞으면 허용하지 않는다 — 예전에는 허용했다', function () {
    // '0 0 3 * * *' is 03:00 every day. Now is 12:15:30; the window below matches only the minute (15).
    assert.strictEqual(security._actw_matches('0 15 3 1 1 1', NOW), false,
        '분만 맞는 창이 통과하면 권한을 과하게 내주는 것이다');
});

test('새벽 3시 창은 낮 12시에 열리지 않는다', function () {
    assert.strictEqual(security._actw_matches('0 0 3 * * *', NOW), false);
});

test("'*' 자리는 언제나 맞는 것으로 친다", function () {
    assert.strictEqual(security._actw_matches('* * 12 * * *', NOW), true, '매일 12시대');
    assert.strictEqual(security._actw_matches('* * 13 * * *', NOW), false, '매일 13시대');
    assert.strictEqual(security._actw_matches('30 * * * * *', NOW), true, '매분 30초');
});

test('요일과 월도 자리대로 본다', function () {
    // The array order is [second, minute, hour, day, month, weekday].
    assert.strictEqual(security._actw_matches('* * * * 6 *', NOW), true, '6월');
    assert.strictEqual(security._actw_matches('* * * * 7 *', NOW), false, '7월');
    assert.strictEqual(security._actw_matches('* * * * * 3', NOW), true, '수요일');
    assert.strictEqual(security._actw_matches('* * * * * 4', NOW), false, '목요일');
});

test('여섯 자리가 아니면 허용하지 않고 이유를 남긴다', function () {
    // A window that cannot be evaluated must not pass.
    const lines = quiet(function () {
        assert.strictEqual(security._actw_matches('0 0 3 * *', NOW), false, '5자리');
        assert.strictEqual(security._actw_matches('', NOW), false, '빈 문자열');
        assert.strictEqual(security._actw_matches('0 0 0 0 0 0 0', NOW), false, '7자리');
    });
    assert.strictEqual(lines.length, 3, '세 건 모두 로그가 남아야 한다');
});

test('자리 사이 공백이 여러 개여도 읽는다', function () {
    assert.strictEqual(security._actw_matches('  *   *  12 *  * *  ', NOW), true);
});

// ── acip's 'empty list allows' default ──
//
// It sits inside security_check_action_pv and cannot be called directly; this pins the decision it makes.

test('빈 목록을 for-in 하면 인덱스 변수가 그대로 남는다', function () {
    // This is how 'the list is empty, so allow' is decided.
    var idx = 99;
    for (idx in []) { /* does not run */ }
    assert.strictEqual(idx, 99);

    var idx2 = 99;
    for (idx2 in ['10.0.0.1']) { /* runs */ }
    assert.notStrictEqual(idx2, 99);
    assert.strictEqual(idx2, '0', 'for-in 은 문자열 인덱스를 준다');
});

test('선언 전 var 참조는 undefined 다 — 기본 허용이 죽어 있던 이유', function () {
    // With the index variable declared in another branch and hoisted, the reference resolves but the value is undefined, so undefined == 99 is false.
    assert.strictEqual(undefined == 99, false);
});

// ── The former decision, reproduced to pin what it did ──
//
// _actw_matches is a new function, so on the old code the test would fail with 'no such function', which does not record what was wrong. The old expression is copied here and compared.

function actw_matches_old(window, now) {
    const parts = String(window).split(' ');
    for (let d = 0; d < 6; d++) {
        if (parts[d] != '*' && parts[d] == now[d].toString()) {
            return true;              // any single matching field allows at once
        }
    }
    return false;
}

test('옛 식은 항상-허용 창을 거부했다', function () {
    assert.strictEqual(actw_matches_old('* * * * * *', NOW), false, '이것이 옛 동작이다');
    assert.strictEqual(security._actw_matches('* * * * * *', NOW), true, '고친 뒤');
});

test('옛 식은 한 자리만 맞아도 허용했다 — 권한 과다 부여', function () {
    // A window where only the minute (15) matches and every other field differs.
    const window = '0 15 3 1 1 1';
    assert.strictEqual(actw_matches_old(window, NOW), true, '이것이 옛 동작이다 — 통과시켰다');
    assert.strictEqual(security._actw_matches(window, NOW), false, '고친 뒤 — 거부한다');
});

test('두 식이 갈리는 지점을 표로 남긴다', function () {
    const CASES = [
        // [window, old result, new result]
        ['* * * * * *',    false, true ],   // always allow -> the old expression refuses
        ['30 15 12 5 6 3', true,  true ],   // full match -> both allow
        ['0 15 3 1 1 1',   true,  false],   // minute only -> only the old expression allows
        ['0 0 3 1 1 1',    false, false],   // nothing matches
        ['* * 12 * * *',   true,  true ],   // hour only
        ['* * 13 * * *',   false, false]    // a different hour
    ];
    CASES.forEach(function (c) {
        assert.strictEqual(actw_matches_old(c[0], NOW), c[1], '옛 식: ' + c[0]);
        assert.strictEqual(security._actw_matches(c[0], NOW), c[2], '새 식: ' + c[0]);
    });
});

// ── Unified evaluator ──
//
// pv and pvs share one evaluator; the decision is made in evaluate_acr only.

function req(opts) {
    opts = opts || {};
    return {
        headers: opts.headers || {},
        connection: { remoteAddress: opts.addr || '127.0.0.1' }
    };
}

// ── acip ─────────────────────────────────────────────────────────────

test('acip 이 없으면 IP 제한이 없다', function () {
    assert.strictEqual(security._acip_allows(undefined, req(), false), true);
    assert.strictEqual(security._acip_allows(null, req(), false), true);
});

test('ipv4 목록이 비면 허용한다 — 예전에 죽어 있던 기본 분기', function () {
    assert.strictEqual(security._acip_allows({ ipv4: [] }, req(), false), true);
});

test('ipv4 가 일치하면 허용, 아니면 거부', function () {
    const r = req({ addr: '::ffff:10.0.0.5' });
    assert.strictEqual(security._acip_allows({ ipv4: ['10.0.0.5'] }, r, false), true);
    assert.strictEqual(security._acip_allows({ ipv4: ['10.0.0.9'] }, r, false), false);
});

test('use_ra 면 remoteaddress 헤더를 먼저 본다 — pv 만 그렇다', function () {
    // This header is set by a CoAP proxy. pvs does not look at it; that is the current behaviour.
    const r = req({ addr: '::ffff:1.1.1.1', headers: { remoteaddress: '10.0.0.5' } });
    assert.strictEqual(security._acip_allows({ ipv4: ['10.0.0.5'] }, r, true), true);
    assert.strictEqual(security._acip_allows({ ipv4: ['10.0.0.5'] }, r, false), false,
        'use_ra 가 false 면 소켓 주소를 본다');
});

test('ipv6 목록이 비면 허용한다', function () {
    assert.strictEqual(security._acip_allows({ ipv6: [] }, req(), false), true);
});

test('ipv4 도 ipv6 도 없는 acip 은 제한이 없다', function () {
    assert.strictEqual(security._acip_allows({}, req(), false), true);
});

// ── actw ─────────────────────────────────────────────────────────────

test('actw 목록이 비면 시간 제한이 없다', function () {
    assert.strictEqual(security._actw_allows([]), true);
    assert.strictEqual(security._actw_allows(undefined), true);
});

test("actw 에 '* * * * * *' 가 있으면 언제나 허용", function () {
    assert.strictEqual(security._actw_allows(['* * * * * *']), true);
});

test('맞는 창이 하나도 없으면 거부', function () {
    const lines = quiet(function () {
        assert.strictEqual(security._actw_allows(['0 0 0 1 1 1']), false);
    });
    assert.strictEqual(lines.length, 0, '형식이 맞으면 로그는 없다');
});

// ── acor / acop ──────────────────────────────────────────────────────

test('acor 이 없으면 발신자 제한이 없다', function () {
    assert.strictEqual(security._acor_allows({ acop: 63 }, 'anyone', '2'), true);
});

// A missing acor means 'no originator restriction', not 'no operation restriction': the acop bits are still enforced.
test('acor 이 없어도 acop 비트는 지켜진다', function () {
    // A rule granting RETRIEVE only must refuse DELETE
    assert.strictEqual(security._acor_allows({ acop: 2 }, 'anyone', '8'), false);
    assert.strictEqual(security._acor_allows({ acop: 2 }, 'anyone', '2'), true);
    // A rule granting no permission must pass nothing
    assert.strictEqual(security._acor_allows({ acop: 0 }, 'anyone', '8'), false);
    assert.strictEqual(security._acor_allows({ acop: 0 }, 'anyone', '2'), false);
});

test('acor 이 일치하고 acop 비트가 맞아야 허용', function () {
    const rule = { acor: ['Reader'], acop: 63 };
    assert.strictEqual(security._acor_allows(rule, 'Reader', '2'), true);
    assert.strictEqual(security._acor_allows(rule, 'Other', '2'), false);
});

test('acop 비트가 요청한 연산을 포함하지 않으면 거부', function () {
    // acop 1 = CREATE only. RETRIEVE (2) is refused.
    assert.strictEqual(security._acor_allows({ acor: ['Reader'], acop: 1 }, 'Reader', '2'), false);
});

test("acor 의 'all' 과 '*' 는 누구나 통과시킨다", function () {
    assert.strictEqual(security._acor_allows({ acor: ['all'], acop: 63 }, 'anyone', '2'), true);
    assert.strictEqual(security._acor_allows({ acor: ['*'], acop: 63 }, 'anyone', '2'), true);
});

// ── The originator must never be turned into a regular expression ──
//
// The header sent by the requester is compared as a string against the policy entries; a regex built from the header would let one header line bypass the ACP.

test('발신자에 정규식을 넣어도 우회되지 않는다', function () {
    const rule = { acor: ['SAE1'], acop: 63 };
    for (const evil of ['.*', '.+', 'S.*', '.', '[sS]AE1', 'SAE.', '^SAE1$', 'SAE1|x']) {
        assert.strictEqual(security._acor_allows(rule, evil, '2'), false,
            'X-M2M-Origin: ' + evil + ' 이 통과했다 — 정규식으로 해석되고 있다');
    }
});

test('정규식 주입으로 DELETE 까지 얻을 수 없다', function () {
    // The same holds for an ACP that grants everything to the superuser only.
    assert.strictEqual(security._acor_allows({ acor: ['Sponde'], acop: 63 }, '.*', '8'), false);
    assert.strictEqual(security._acor_allows({ acor: ['Owner'], acop: 63 }, '.+', '8'), false);
});

test('깨진 정규식 문자를 보내도 던지지 않는다', function () {
    // Metacharacters in the originator must not throw.
    const rule = { acor: ['Reader'], acop: 63 };
    for (const s of ['[', '(', '\\', '*', '+', '?', '{2,']) {
        // '*' is the wildcard on the acor side and has no meaning in the originator position
        assert.doesNotThrow(function () { security._acor_allows(rule, s, '2'); },
            'from=' + JSON.stringify(s) + ' 에서 던졌다');
        assert.strictEqual(security._acor_allows(rule, s, '2'), false);
    }
});

test('acor 쪽 패턴은 원래도 동작하지 않았고 지금도 안 한다', function () {
    // acor:['S.*'] does not match from='SAE1' either; to allow several originators, use 'all' / '*'.
    assert.strictEqual(security._acor_allows({ acor: ['S.*'], acop: 63 }, 'SAE1', '2'), false);
    assert.strictEqual(security._acor_allows({ acor: ['S.*'], acop: 63 }, 'S.*', '2'), true,
        '리터럴로는 자기 자신과 일치해야 한다');
});

// ── Whole rules ──

test('acco 가 없으면 컨텍스트 제약이 없다', function () {
    const rule = { acor: ['Reader'], acop: 63 };
    assert.strictEqual(security._evaluate_acr(rule, req(), 'Reader', '2', false), true);
});

test('acco 가 빈 배열이어도 제약이 없다', function () {
    const rule = { acor: ['Reader'], acop: 63, acco: [] };
    assert.strictEqual(security._evaluate_acr(rule, req(), 'Reader', '2', false), true);
});

test('acco 는 하나라도 만족하면 통과 (OR)', function () {
    const rule = { acor: ['Reader'], acop: 63, acco: [
        { acip: { ipv4: ['10.9.9.9'] } },     // no match
        { actw: ['* * * * * *'] }             // match
    ]};
    assert.strictEqual(security._evaluate_acr(rule, req(), 'Reader', '2', false), true);
});

test('acco 안에서는 acip 과 actw 를 함께 만족해야 한다 (AND)', function () {
    const rule = { acor: ['Reader'], acop: 63, acco: [
        { acip: { ipv4: ['10.9.9.9'] }, actw: ['* * * * * *'] }   // ip does not match
    ]};
    assert.strictEqual(security._evaluate_acr(rule, req(), 'Reader', '2', false), false);
});

test('컨텍스트를 통과해도 acor 이 막으면 거부', function () {
    const rule = { acor: ['Other'], acop: 63, acco: [{ actw: ['* * * * * *'] }] };
    assert.strictEqual(security._evaluate_acr(rule, req(), 'Reader', '2', false), false);
});

// ── Creator bypass (creator_bypasses) ──
//
// An ACP adds permissions; it does not push the creator out of its own resource.

test('생성자는 통과한다', function () {
    assert.strictEqual(security._creator_bypasses('3', 'Cowner', 'Cowner'), true);
});

test('생성자가 아니면 통과하지 않는다', function () {
    assert.strictEqual(security._creator_bypasses('3', 'Cowner', 'Cother'), false);
});

test('ty=1(ACP 자신)은 생성자 우회에서 빠진다 — pvs 가 정한다', function () {
    // check_acp_update_acpi passes the target resource's cr. Without the exclusion the target's creator could attach any ACP regardless of its pvs.
    assert.strictEqual(security._creator_bypasses('1', 'Cowner', 'Cowner'), false);
    assert.strictEqual(security._creator_bypasses(1, 'Cowner', 'Cowner'), false);
});

test('cr 이 없는 리소스는 우회가 없다 — acp 와 ae 에는 cr 컬럼이 없다', function () {
    assert.strictEqual(security._creator_bypasses('3', undefined, 'Cowner'), false);
    assert.strictEqual(security._creator_bypasses('3', '', ''), false);
    assert.strictEqual(security._creator_bypasses('3', null, null), false);
});

test('빈 원본이 빈 cr 과 맞아떨어지지 않는다', function () {
    // Two empty values compare equal with ==; nobody may pass through that hole.
    assert.strictEqual(security._creator_bypasses('3', '', 'anything'), false);
    assert.strictEqual(security._creator_bypasses('3', 'Cowner', ''), false);
    assert.strictEqual(security._creator_bypasses('3', 'Cowner', undefined), false);
});

test('생성자 비교는 문자열 등치다 — 접두사나 정규식이 아니다', function () {
    assert.strictEqual(security._creator_bypasses('3', 'Cowner', 'Cowner2'), false);
    assert.strictEqual(security._creator_bypasses('3', 'Cowner', 'Cown'), false);
    assert.strictEqual(security._creator_bypasses('3', 'C.*', 'Cowner'), false);
});

test('ty 는 숫자로 와도 문자열로 와도 같게 판정한다', function () {
    assert.strictEqual(security._creator_bypasses(3, 'Cowner', 'Cowner'), true);
    assert.strictEqual(security._creator_bypasses('3', 'Cowner', 'Cowner'), true);
});
