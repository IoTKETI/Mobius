'use strict';
/*
 * 로그에 수퍼유저 origin 이 적히지 않는다.
 *
 * ── 왜 있나 ──────────────────────────────────────────────────────────────
 * `X-M2M-Origin` 에 수퍼유저 값을 넣으면 security.js 가 맨 앞에서 통과시켜
 * **모든 ACP 검사를 건너뛴다.** 사실상 마스터 키다.
 *
 * conf_schema 는 그 값을 secret: true, exposed: false 로 선언해 관리 화면에
 * 못 올리게 막아 두었는데, 운영 로그에는 평문으로 적히고 있었다.
 * 로그는 보통 화면보다 열람 범위가 넓다.
 *
 * ── 어쩌다 그랬나 (이 시험이 있는 진짜 이유) ─────────────────────────────
 * 2026-08-31 에 `console.log(f_headers)` 를 걷어냈다. 헤더 객체를 통째로
 * 찍어 X-M2M-Origin 이 남는다는 것이 이유였다. **그러면서 같은 작업 묶음에서
 * `[json_only]` 와 `[body_limit]` 로그에 `origin=` 을 새로 넣었다.**
 * 지운 이유와 넣은 것이 정면으로 어긋났고, 배포 로그에서 실제로 확인됐다:
 *
 *     [json_only] POST /Mobius  Content-Type: ...+xml  origin=Sponde
 *
 * 진단에 origin 이 유용한 것은 사실이라 또 넣고 싶어진다. 그래서 소스를
 * 훑어 **가리지 않은 채 넣는 것**만 막는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const log_safe = require('../mobius/log_safe');

function withSuperUser(v, fn) {
    const saved = global.usesuperuser;
    global.usesuperuser = v;
    try { return fn(); }
    finally {
        if (saved === undefined) { delete global.usesuperuser; }
        else { global.usesuperuser = saved; }
    }
}

test('수퍼유저 origin 을 가린다 — 앞 슬래시가 붙은 형태도', function () {
    withSuperUser('Sponde', function () {
        // security.js 가 `from == su || from == '/'+su` 로 **둘 다** 통과시킨다.
        // 가리는 쪽도 둘 다 가려야 한다.
        assert.strictEqual(log_safe.origin('Sponde'), log_safe.MASK);
        assert.strictEqual(log_safe.origin('/Sponde'), log_safe.MASK);
    });
});

test('평범한 origin 은 그대로 둔다 — 전부 가리면 로그의 값이 사라진다', function () {
    withSuperUser('Sponde', function () {
        assert.strictEqual(log_safe.origin('Cae123'), 'Cae123');
        assert.strictEqual(log_safe.origin('/Mobius/ae1'), '/Mobius/ae1');
        // 비슷하지만 다른 값은 가리지 않는다 — 부분 일치로 넓히면
        // 멀쩡한 AE 이름이 진단에서 사라진다.
        assert.strictEqual(log_safe.origin('SpondeX'), 'SpondeX');
        assert.strictEqual(log_safe.origin('Spond'), 'Spond');
    });
});

test('비어 있으면 ? 를 준다', function () {
    withSuperUser('Sponde', function () {
        assert.strictEqual(log_safe.origin(''), '?');
        assert.strictEqual(log_safe.origin(undefined), '?');
        assert.strictEqual(log_safe.origin(null), '?');
    });
});

test('전역이 없으면 가리지 않는다 — 가릴 대상을 모른다', function () {
    const saved = global.usesuperuser;
    delete global.usesuperuser;
    try {
        // mobius.js 없이 로드되는 상황(테스트)이다. 그때는 진짜 키도 없다.
        assert.strictEqual(log_safe.origin('Sponde'), 'Sponde');
    }
    finally { if (saved !== undefined) { global.usesuperuser = saved; } }
});

test('설정으로 바뀐 수퍼유저 값을 따라간다', function () {
    // 배포에서 이 값을 바꾸면 가리는 대상도 함께 바뀌어야 한다.
    withSuperUser('MyMasterKey', function () {
        assert.strictEqual(log_safe.origin('MyMasterKey'), log_safe.MASK);
        assert.strictEqual(log_safe.origin('Sponde'), 'Sponde',
            '옛 기본값을 계속 가리면 안 된다 — 그건 이제 평범한 값이다');
    });
});

/* ── 소스 관문 ───────────────────────────────────────────────────────────── */

test('origin 을 로그에 넣는 자리는 반드시 log_safe 를 거친다', function () {
    const files = cp.execSync('git ls-files "*.js"', { cwd: ROOT }).toString()
        .split(/\r?\n/).filter(Boolean)
        .filter((f) => f.indexOf('test/') !== 0 && f.indexOf('tools/') !== 0);

    const bad = [];
    for (const f of files) {
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
        lines.forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            // console 호출 한 줄 안에 x-m2m-origin 이 들어가는가
            if (!/console\.(log|error)\(/.test(l)) { return; }
            // 한 줄로 안 끝나는 로그가 많아 뒤 두 줄까지 함께 본다
            const win = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');
            if (!/x-m2m-origin/i.test(win)) { return; }
            if (/log_safe\.origin\(/.test(win)) { return; }   // 거쳤다
            bad.push(f + ':' + (i + 1) + '  ' + l.trim().slice(0, 100));
        });
    }

    assert.deepStrictEqual(bad, [],
        'X-M2M-Origin 을 가리지 않고 로그에 넣는 자리가 있다. ' +
        '그 값이 수퍼유저면 마스터 키가 로그 파일에 남는다. ' +
        "log_safe.origin(...) 을 거칠 것:\n  " + bad.join('\n  '));
});

test('네 자리가 실제로 log_safe 를 쓰고 있다', function () {
    // 위 관문은 "안 가린 것이 없다" 만 본다. 가리는 자리가 통째로
    // 사라져도 통과한다. 그래서 존재도 함께 못박는다.
    for (const [f, label] of [
        ['app.js',                  'json_only 관문'],
        ['mobius/body.js',          'body_limit 상한'],
        ['mobius/resource.js',      'discovery ACP 필터'],
        ['mobius/acp_observe.js',   'acpi attach 관측']
    ]) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert.match(src, /log_safe\.origin\(/, f + ' (' + label + ') 이 log_safe 를 안 쓴다');
        // app.js 는 './mobius/log_safe', mobius/ 안은 './log_safe' 다.
        assert.match(src, /require\('\.\/(mobius\/)?log_safe'\)/,
            f + ' 에 log_safe require 가 없다');
    }
});
