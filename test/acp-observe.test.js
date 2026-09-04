'use strict';
// 거부 관측과 관찰 모드.
//
// security.check 는 요청마다 도는 핫패스다. 관측이 던지면 요청이 죽고,
// 로그가 안 끊기면 잘못 걸린 ACP 하나가 25개 워커에서 디스크를 채운다.

const test = require('node:test');
const assert = require('node:assert');

const observe = require('../mobius/acp_observe');

function quiet(fn) {
    const orig = console.log;
    const lines = [];
    console.log = function (s) { lines.push(String(s)); };
    try { fn(); }
    finally { console.log = orig; }
    return lines;
}

function req(origin, url) {
    return { headers: { 'x-m2m-origin': origin }, url: url || '/Mobius/ae1/cnt1' };
}

function reset(cfg) {
    observe.reset();
    observe.configure(Object.assign({ mode: 'off', denyLog: 'sample', rate: 5, keep: 200 }, cfg || {}));
}

test('기본값은 현재 동작과 같다 — 판정을 바꾸지 않는다', function () {
    reset();
    quiet(function () {
        assert.strictEqual(observe.record_decision(req('C'), '0', { decided_by: 'exhausted' }), '0');
        assert.strictEqual(observe.record_decision(req('C'), '1', { decided_by: 'acr' }), '1');
        assert.strictEqual(observe.record_decision(req('C'), '500-1', { decided_by: 'eval_error' }), '500-1');
    });
});

test('거부는 사유별로 센다', function () {
    reset();
    quiet(function () {
        observe.record_decision(req('C'), '0', { decided_by: 'exhausted' });
        observe.record_decision(req('C'), '0', { decided_by: 'exhausted' });
        observe.record_decision(req('C'), '0', { decided_by: 'no_acr_cr' });
    });
    const s = observe.snapshot();
    assert.strictEqual(s.counts.deny, 3);
    assert.strictEqual(s.byReason.exhausted, 2);
    assert.strictEqual(s.byReason.no_acr_cr, 1);
});

test("denyLog 'off' 면 한 줄도 안 찍고 카운터만 오른다", function () {
    reset({ denyLog: 'off' });
    const lines = quiet(function () {
        for (let i = 0; i < 10; i++) { observe.record_decision(req('C'), '0', { decided_by: 'exhausted' }); }
    });
    assert.strictEqual(lines.length, 0);
    assert.strictEqual(observe.snapshot().counts.deny, 10);
});

test("denyLog 'sample' 은 초당 rate 줄로 끊고 나머지를 센다", function () {
    reset({ denyLog: 'sample', rate: 2 });
    const lines = quiet(function () {
        for (let i = 0; i < 10; i++) { observe.record_decision(req('C'), '0', { decided_by: 'exhausted' }); }
    });
    assert.ok(lines.length <= 2, '초당 2줄을 넘었다: ' + lines.length);
    const s = observe.snapshot();
    assert.strictEqual(s.counts.deny, 10);
    assert.strictEqual(s.counts.suppressed, 10 - lines.length);
});

test("denyLog 'all' 은 끊지 않는다", function () {
    reset({ denyLog: 'all' });
    const lines = quiet(function () {
        for (let i = 0; i < 10; i++) { observe.record_decision(req('C'), '0', { decided_by: 'exhausted' }); }
    });
    assert.strictEqual(lines.length, 10);
    assert.strictEqual(observe.snapshot().counts.suppressed, 0);
});

test('관찰 모드는 거부를 허용으로 내보내고 원래 사유를 남긴다', function () {
    reset({ mode: 'observe' });
    const trace = { decided_by: 'exhausted' };
    let code;
    quiet(function () { code = observe.record_decision(req('C'), '0', trace); });
    assert.strictEqual(code, '1');
    assert.strictEqual(trace.observed, true);
    assert.strictEqual(trace.decided_by, 'exhausted', '원래 사유가 지워지면 안 된다');
    const s = observe.snapshot();
    assert.strictEqual(s.counts.observe, 1);
    assert.strictEqual(s.counts.deny, 0);
});

test('관찰 모드는 기본 정책 거부를 뒤집지 않는다', function () {
    // 배포에 acpi 가 채워진 행은 2개뿐이라 실제로 나는 거부는 사실상 전부
    // default_policy 다. 사유를 안 보고 다 뒤집으면 관찰 모드가
    // "ACP 로 뭐가 막힐지 본다" 가 아니라 **5,740만 행 전부를 임의 원본의
    // UPDATE·DELETE 에 여는 것**이 된다. 그 창에서 지워진 것은 안 돌아온다.
    reset({ mode: 'observe', denyLog: 'off' });
    const t = { decided_by: 'default_policy', op_value: '8' };
    let code;
    quiet(function () { code = observe.record_decision(req('attacker'), '0', t); });
    assert.strictEqual(code, '0', '기본 정책 거부는 그대로 막아야 한다');
    assert.notStrictEqual(t.observed, true);
    const s = observe.snapshot();
    assert.strictEqual(s.counts.deny, 1);
    assert.strictEqual(s.counts.observe, 0);
});

test('관찰 모드는 ACP 평가로 난 거부만 뒤집는다', function () {
    for (const reason of ['acr', 'exhausted', 'no_acr_cr', 'no_acp_row']) {
        reset({ mode: 'observe', denyLog: 'off' });
        let code;
        quiet(function () { code = observe.record_decision(req('C'), '0', { decided_by: reason }); });
        assert.strictEqual(code, '1', reason + ' 는 뒤집혀야 한다');
    }
    for (const reason of ['default_policy', 'db_error', 'lookup_error', 'unknown']) {
        reset({ mode: 'observe', denyLog: 'off' });
        let code;
        quiet(function () { code = observe.record_decision(req('C'), '0', { decided_by: reason }); });
        assert.strictEqual(code, '0', reason + ' 는 뒤집으면 안 된다');
    }
});

test('관찰 모드가 500 을 감추지 않는다', function () {
    reset({ mode: 'observe' });
    let code;
    quiet(function () { code = observe.record_decision(req('C'), '500-1', { decided_by: 'eval_error' }); });
    assert.strictEqual(code, '500-1');
    assert.strictEqual(observe.snapshot().counts.error, 1);
});

test('로그 한 줄에 판정 근거가 들어간다', function () {
    reset({ denyLog: 'all' });
    const lines = quiet(function () {
        observe.record_decision(req('Cother', '/Mobius/ae1/cnt1'), '0', {
            decided_by: 'no_acr_cr', field: 'pv', acp_ri: '/Mobius/acp1',
            op_value: '4', ty: 3, source: 'inherited', inherited_from: '/Mobius/ae1',
            stopped_early: true, not_evaluated: ['/Mobius/acp2']
        });
    });
    assert.strictEqual(lines.length, 1);
    const l = lines[0];
    for (const part of ['op=UPDATE', 'ty=3', 'origin=Cother', 'url=/Mobius/ae1/cnt1',
                        'by=no_acr_cr', 'acp=/Mobius/acp1', 'source=inherited',
                        'from=/Mobius/ae1', 'skipped=/Mobius/acp2']) {
        assert.ok(l.includes(part), part + ' 가 없다: ' + l);
    }
});

test('망가진 입력에도 던지지 않는다', function () {
    reset({ denyLog: 'all' });
    quiet(function () {
        assert.strictEqual(observe.record_decision(undefined, '0', undefined), '0');
        assert.strictEqual(observe.record_decision(null, '0', null), '0');
        assert.strictEqual(observe.record_decision({}, '0', {}), '0');
        observe.record('acpi_attach', undefined);
        observe.record(undefined, undefined);
    });
});

test('recent 는 keep 개를 넘지 않는다', function () {
    reset({ denyLog: 'off', keep: 3 });
    quiet(function () {
        for (let i = 0; i < 10; i++) { observe.record_decision(req('C' + i), '0', { decided_by: 'exhausted' }); }
    });
    const s = observe.snapshot();
    assert.strictEqual(s.recent.length, 3);
    assert.strictEqual(s.recent[2].info.origin, 'C9', '가장 최근 것이 남아야 한다');
});

test('acpi 부착은 옛 값과 새 값을 함께 남긴다', function () {
    reset({ denyLog: 'all' });
    const lines = quiet(function () {
        observe.record('acpi_attach', { ri: '/Mobius/ae1/c1', ty: 3, origin: 'Cother',
                                        cr: 'Cowner', before: [], after: ['/Mobius/acp1'] });
    });
    assert.strictEqual(observe.snapshot().counts.acpi_attach, 1);
    assert.ok(lines[0].includes('before=[]'));
    assert.ok(lines[0].includes('after=["/Mobius/acp1"]'));
});

test('reset 은 설정이 아니라 통계만 지운다', function () {
    reset({ mode: 'observe', rate: 9 });
    observe.reset();
    const c = observe.config();
    assert.strictEqual(c.mode, 'observe');
    assert.strictEqual(c.rate, 9);
    assert.strictEqual(observe.snapshot().counts.deny, 0);
});

test('configure 는 모르는 값을 무시한다 — 오타로 ACP 가 무력화되면 안 된다', function () {
    reset();
    observe.configure({ mode: 'observ', denyLog: 'evrything', rate: -1 });
    const c = observe.config();
    assert.strictEqual(c.mode, 'off');
    assert.strictEqual(c.denyLog, 'sample');
    assert.strictEqual(c.rate, 5);
});

/* ── pvs — ACP 자신에 대한 접근 ────────────────────────────────────────────
 *
 * security.check 는 대상이 ACP(ty=1)면 pv 가 아니라 **pvs**(selfPrivileges)로
 * 판정한다. 그 자리는 성격이 다르다 — pv 는 "이 리소스를 읽고 쓸 수 있나" 인데
 * pvs 는 **"이 접근 정책 자체를 고치거나 지울 수 있나"** 다.
 *
 * 관찰 모드의 전제는 "막지 않고 보되, 되돌릴 수 있다" 이다. 그런데 pvs 를
 * 뒤집으면 그 전제가 깨진다:
 *
 *   - 관찰 창 동안 인증된 아무나 ACP 본문을 고칠 수 있다
 *   - ACP 를 **지울** 수도 있다
 *   - 모드를 꺼도 **그 변경은 돌아오지 않는다**
 *
 * 게다가 ACP 를 고치면 그 ACP 를 참조하는 모든 리소스의 권한이 함께 바뀐다.
 * 관찰 창 하나가 영구적인 권한 변경으로 남는다.
 */

test('관찰 모드가 pvs 거부는 뒤집지 않는다 — ACP 자신을 열면 되돌릴 수 없다', function () {
    reset({ mode: 'observe' });
    quiet(function () {
        for (const reason of ['acr', 'exhausted', 'no_acr_cr', 'no_acp_row']) {
            assert.strictEqual(
                observe.record_decision(req('AE-X', '/Mobius/acp1'), '0',
                    { decided_by: reason, field: 'pvs' }),
                '0',
                'pvs 거부(' + reason + ')를 관찰 모드가 허용으로 바꿨다 — ' +
                '관찰 창 동안 아무나 ACP 를 고치거나 지울 수 있다');
        }
    });
});

test('pvs 는 path 로 와도 막는다 — security.js 가 두 이름을 쓴다', function () {
    // evaluate_acp_rows 는 trace.field 에 담고(security.js:336),
    // ty=1 분기는 trace.path 에 담는다(security.js:578). 둘 다 봐야 한다.
    reset({ mode: 'observe' });
    quiet(function () {
        assert.strictEqual(
            observe.record_decision(req('AE-X', '/Mobius/acp1'), '0',
                { decided_by: 'acr', path: 'pvs' }),
            '0',
            'trace.path 로 온 pvs 를 못 걸렀다');
    });
});

test('pv 거부는 여전히 뒤집는다 — 관찰 모드의 본래 목적', function () {
    reset({ mode: 'observe' });
    quiet(function () {
        assert.strictEqual(
            observe.record_decision(req('AE-X'), '0', { decided_by: 'acr', field: 'pv' }),
            '1',
            'pv 거부까지 막으면 관찰 모드가 아무것도 못 본다');
    });
});

test('막은 pvs 는 deny 로 센다 — 관찰 통계가 거짓말하지 않게', function () {
    reset({ mode: 'observe' });
    quiet(function () {
        observe.record_decision(req('AE-X', '/Mobius/acp1'), '0',
            { decided_by: 'acr', field: 'pvs' });
    });
    const s = observe.snapshot();
    assert.strictEqual(s.counts.deny, 1, 'pvs 를 막았으면 deny 로 세야 한다');
    assert.strictEqual(s.counts.observe, 0, 'observe 로 세면 "뒤집었다" 는 뜻이 된다');
});
