'use strict';
/*
 * The superuser origin is never written to the log.
 *
 * A request whose `X-M2M-Origin` equals the superuser value passes security.js at the top and skips every ACP check; it is effectively a master key. conf_schema declares the value secret: true, exposed: false so it cannot reach the admin screen, and logs are usually more widely readable than screens.
 *
 * origin is useful in diagnostics, so the temptation to log it recurs. This test scans the source and blocks only unmasked logging.
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
        // security.js accepts both `from == su` and `from == '/'+su`; the mask must cover both.
        assert.strictEqual(log_safe.origin('Sponde'), log_safe.MASK);
        assert.strictEqual(log_safe.origin('/Sponde'), log_safe.MASK);
    });
});

test('평범한 origin 은 그대로 둔다 — 전부 가리면 로그의 값이 사라진다', function () {
    withSuperUser('Sponde', function () {
        assert.strictEqual(log_safe.origin('Cae123'), 'Cae123');
        assert.strictEqual(log_safe.origin('/Mobius/ae1'), '/Mobius/ae1');
        // Similar but different values are not masked; a partial match would hide legitimate AE names from diagnostics.
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
        // Loaded without mobius.js (tests): there is no real key, so nothing is masked.
        assert.strictEqual(log_safe.origin('Sponde'), 'Sponde');
    }
    finally { if (saved !== undefined) { global.usesuperuser = saved; } }
});

test('설정으로 바뀐 수퍼유저 값을 따라간다', function () {
    // When the deployment changes the value, the masked value follows.
    withSuperUser('MyMasterKey', function () {
        assert.strictEqual(log_safe.origin('MyMasterKey'), log_safe.MASK);
        assert.strictEqual(log_safe.origin('Sponde'), 'Sponde',
            '옛 기본값을 계속 가리면 안 된다 — 그건 이제 평범한 값이다');
    });
});

/* Source gate. */

test('origin 을 로그에 넣는 자리는 반드시 log_safe 를 거친다', function () {
    const files = cp.execSync('git ls-files "*.js"', { cwd: ROOT }).toString()
        .split(/\r?\n/).filter(Boolean)
        .filter((f) => f.indexOf('test/') !== 0 && f.indexOf('tools/') !== 0);

    const bad = [];
    for (const f of files) {
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
        lines.forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            // Does a console call line contain x-m2m-origin.
            if (!/console\.(log|error)\(/.test(l)) { return; }
            // Many log statements span lines, so the next two lines are included.
            const win = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');
            if (!/x-m2m-origin/i.test(win)) { return; }
            if (/log_safe\.origin\(/.test(win)) { return; }   // masked
            bad.push(f + ':' + (i + 1) + '  ' + l.trim().slice(0, 100));
        });
    }

    assert.deepStrictEqual(bad, [],
        'X-M2M-Origin 을 가리지 않고 로그에 넣는 자리가 있다. ' +
        '그 값이 수퍼유저면 마스터 키가 로그 파일에 남는다. ' +
        "log_safe.origin(...) 을 거칠 것:\n  " + bad.join('\n  '));
});

test('네 자리가 실제로 log_safe 를 쓰고 있다', function () {
    // The gate above only checks that nothing is unmasked; it passes if the masking site disappears altogether. Existence is pinned as well.
    for (const [f, label] of [
        ['app.js',                  'json_only 관문'],
        ['mobius/body.js',          'body_limit 상한'],
        ['mobius/resource.js',      'discovery ACP 필터'],
        ['mobius/acp_observe.js',   'acpi attach 관측']
    ]) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert.match(src, /log_safe\.origin\(/, f + ' (' + label + ') 이 log_safe 를 안 쓴다');
        // app.js requires './mobius/log_safe'; files under mobius/ require './log_safe'.
        assert.match(src, /require\('\.\/(mobius\/)?log_safe'\)/,
            f + ' 에 log_safe require 가 없다');
    }
});
