'use strict';
// ACP 판정 — 조용히 틀리면 아무도 모른다.
//
// 크래시도 매달림도 아니라서 로그에 아무것도 안 남는다. 권한을 과하게 내주는
// 쪽으로 틀리면 그대로 보안 구멍이고, 반대로 틀리면 정상 요청이 거부된다.

const test = require('node:test');
const assert = require('node:assert');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';

const security = require('../mobius/security');

// 로그를 삼키고 남은 줄을 돌려준다.
function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    try { fn(); }
    finally { console.error = orig; }
    return lines;
}

// ── actw (accessControlWindow) ───────────────────────────────────────
//
// crontab 형식(초 분 시 일 월 요일)의 허용 시간창이다.
// 창 하나가 성립하려면 여섯 자리가 *전부* 맞아야 하고, '*' 는 제한 없음이다.
//
// 예전 코드는 두 가지가 반대였다.
//   - 한 자리라도 맞으면 허용했다 (AND 가 아니라 OR)
//   - '*' 자리는 맞는 것으로 칠 수 없었다

// 12:15:30, 6월 5일, 수요일(3)
const NOW = [30, 15, 12, 5, 6, 3];

test("'* * * * * *' 는 항상 허용이다 — 예전에는 항상 거부였다", function () {
    // actw_arr[d] != '*' 조건 때문에 한 자리도 못 맞춰 거부됐다.
    assert.strictEqual(security._actw_matches('* * * * * *', NOW), true);
});

test('여섯 자리가 전부 맞아야 허용이다', function () {
    assert.strictEqual(security._actw_matches('30 15 12 5 6 3', NOW), true);
});

test('한 자리만 맞으면 허용하지 않는다 — 예전에는 허용했다', function () {
    // '0 0 3 * * *' 는 매일 새벽 3시다. 지금은 12시 15분 30초인데,
    // 예전 코드는 초(30)... 가 아니라 어느 한 자리라도 맞으면 통과시켰다.
    // 아래 창은 분(15)만 맞는다.
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
    // 배열은 [초, 분, 시, 일, 월, 요일] 순이다.
    assert.strictEqual(security._actw_matches('* * * * 6 *', NOW), true, '6월');
    assert.strictEqual(security._actw_matches('* * * * 7 *', NOW), false, '7월');
    assert.strictEqual(security._actw_matches('* * * * * 3', NOW), true, '수요일');
    assert.strictEqual(security._actw_matches('* * * * * 4', NOW), false, '목요일');
});

test('여섯 자리가 아니면 허용하지 않고 이유를 남긴다', function () {
    // 판단할 수 없는 창을 통과시키면 안 된다.
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

// ── acip 의 "목록이 비면 허용" 기본값 ────────────────────────────────
//
// security_check_action_pv 안에 있어 직접 부를 수 없다. 여기서는 그 판정이
// 무엇이었는지를 고정해 둔다 — ipv4 분기가 ipv6_idx 를 보고 있었고,
// var 호이스팅 때문에 첫 평가에서 undefined 라 기본 허용이 죽어 있었다.

test('빈 목록을 for-in 하면 인덱스 변수가 그대로 남는다', function () {
    // 이것이 "목록이 비면 허용" 을 판정하는 방식이다.
    var idx = 99;
    for (idx in []) { /* 돌지 않는다 */ }
    assert.strictEqual(idx, 99);

    var idx2 = 99;
    for (idx2 in ['10.0.0.1']) { /* 돈다 */ }
    assert.notStrictEqual(idx2, 99);
    assert.strictEqual(idx2, '0', 'for-in 은 문자열 인덱스를 준다');
});

test('선언 전 var 참조는 undefined 다 — 기본 허용이 죽어 있던 이유', function () {
    // 예전 코드는 ipv4 분기에서 ipv6_idx 를 봤는데, 그 선언은 아래 분기에 있다.
    // 호이스팅으로 참조는 되지만 값이 없어 undefined == 99 가 거짓이었다.
    assert.strictEqual(undefined == 99, false);
});

// ── 옛 판정식을 그대로 재현해 무엇이 틀렸는지 고정한다 ───────────────
//
// _actw_matches 는 이번에 뺀 함수라, 수정 전 코드로는 테스트가
// "함수가 없다" 로 실패한다. 그것만으로는 무엇이 어떻게 틀렸는지 남지 않는다.
// 그래서 옛 식을 여기에 그대로 옮겨 두고 결과를 대조한다.

function actw_matches_old(window, now) {
    const parts = String(window).split(' ');
    for (let d = 0; d < 6; d++) {
        if (parts[d] != '*' && parts[d] == now[d].toString()) {
            return true;              // 한 자리만 맞아도 곧바로 허용
        }
    }
    return false;
}

test('옛 식은 항상-허용 창을 거부했다', function () {
    assert.strictEqual(actw_matches_old('* * * * * *', NOW), false, '이것이 옛 동작이다');
    assert.strictEqual(security._actw_matches('* * * * * *', NOW), true, '고친 뒤');
});

test('옛 식은 한 자리만 맞아도 허용했다 — 권한 과다 부여', function () {
    // 분(15)만 맞고 나머지는 전부 어긋나는 창.
    const window = '0 15 3 1 1 1';
    assert.strictEqual(actw_matches_old(window, NOW), true, '이것이 옛 동작이다 — 통과시켰다');
    assert.strictEqual(security._actw_matches(window, NOW), false, '고친 뒤 — 거부한다');
});

test('두 식이 갈리는 지점을 표로 남긴다', function () {
    const CASES = [
        // [창, 옛 결과, 새 결과]
        ['* * * * * *',    false, true ],   // 항상 허용 -> 옛 식은 거부
        ['30 15 12 5 6 3', true,  true ],   // 전부 일치 -> 둘 다 허용
        ['0 15 3 1 1 1',   true,  false],   // 분만 일치 -> 옛 식만 허용
        ['0 0 3 1 1 1',    false, false],   // 아무것도 안 맞음
        ['* * 12 * * *',   true,  true ],   // 시만 지정
        ['* * 13 * * *',   false, false]    // 다른 시간대
    ];
    CASES.forEach(function (c) {
        assert.strictEqual(actw_matches_old(c[0], NOW), c[1], '옛 식: ' + c[0]);
        assert.strictEqual(security._actw_matches(c[0], NOW), c[2], '새 식: ' + c[0]);
    });
});

// ── 통합 평가기 (§9.4) ───────────────────────────────────────────────
//
// pv 와 pvs 는 거의 같은 200줄을 두 벌 들고 있었다. 그 중복이 실제로 사고를
// 냈다 — ipv4 오참조와 actw 반전을 pv 쪽만 고치고 pvs 를 놓쳐, 한동안
// 절반만 고쳐진 채로 있었다. 이제 판정은 evaluate_acr 한 곳에서만 한다.

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
    // 이 헤더는 CoAP 프록시가 넣는다. pvs 는 보지 않는 것이 현재 동작이다.
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

test('acor 이 일치하고 acop 비트가 맞아야 허용', function () {
    const rule = { acor: ['Reader'], acop: 63 };
    assert.strictEqual(security._acor_allows(rule, 'Reader', '2'), true);
    assert.strictEqual(security._acor_allows(rule, 'Other', '2'), false);
});

test('acop 비트가 요청한 연산을 포함하지 않으면 거부', function () {
    // acop 1 = CREATE 만. RETRIEVE(2) 를 요청하면 거부다.
    assert.strictEqual(security._acor_allows({ acor: ['Reader'], acop: 1 }, 'Reader', '2'), false);
});

test("acor 의 'all' 과 '*' 는 누구나 통과시킨다", function () {
    assert.strictEqual(security._acor_allows({ acor: ['all'], acop: 63 }, 'anyone', '2'), true);
    assert.strictEqual(security._acor_allows({ acor: ['*'], acop: 63 }, 'anyone', '2'), true);
});

// ── 규칙 전체 ────────────────────────────────────────────────────────

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
        { acip: { ipv4: ['10.9.9.9'] } },     // 안 맞음
        { actw: ['* * * * * *'] }             // 맞음
    ]};
    assert.strictEqual(security._evaluate_acr(rule, req(), 'Reader', '2', false), true);
});

test('acco 안에서는 acip 과 actw 를 함께 만족해야 한다 (AND)', function () {
    const rule = { acor: ['Reader'], acop: 63, acco: [
        { acip: { ipv4: ['10.9.9.9'] }, actw: ['* * * * * *'] }   // ip 가 안 맞음
    ]};
    assert.strictEqual(security._evaluate_acr(rule, req(), 'Reader', '2', false), false);
});

test('컨텍스트를 통과해도 acor 이 막으면 거부', function () {
    const rule = { acor: ['Other'], acop: 63, acco: [{ actw: ['* * * * * *'] }] };
    assert.strictEqual(security._evaluate_acr(rule, req(), 'Reader', '2', false), false);
});
