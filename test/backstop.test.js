'use strict';
// 마지막 방어선 — 마스터는 살리고 워커는 종료한다.
//
// 두 역할이 다른 이유:
//   마스터는 요청을 처리하지 않는다. 워커를 포크하고 프록시 3종을 돌린다.
//     프록시 핸들러가 던지면 마스터가 죽고 워커 재기동 로직까지 사라진다.
//     실측으로 확인했다 — WS 에 1바이트 0xF6 으로 리스닝 포트가 전부 없어졌다.
//   워커는 요청을 처리한다. 살려 두면 던진 요청이 응답 없이 매달리고
//     그 커넥션이 풀에서 영구히 빠진다. 죽으면 소켓이 닫혀 회수된다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

global.NOPRINT = 'true';

const backstop = require('../mobius/backstop');

function quiet(fn) {
    const orig = console.error;
    const lines = [];
    console.error = function () {
        lines.push(Array.prototype.join.call(arguments, ' '));
    };
    try { return fn(lines); }
    finally { console.error = orig; }
}

// 가짜 프로세스. install 이 여기에 핸들러를 건다.
function fakeProc() {
    const p = new EventEmitter();
    p.exit = function (code) { p.exited = code; };
    return p;
}

test('마스터는 예외를 받아도 종료하지 않는다', function () {
    backstop._reset();
    const proc = fakeProc();
    let fatal = null;

    const lines = quiet(function (out) {
        backstop.install('master', { proc: proc, onFatal: function (c) { fatal = c; } });
        proc.emit('uncaughtException', new Error('프록시가 던졌다'), 'uncaughtException');
        return out;
    });

    assert.strictEqual(fatal, null, '마스터는 종료하면 안 된다 — 재기동 로직까지 사라진다');
    assert.strictEqual(proc.exited, undefined);
    assert.ok(lines.some((l) => /프록시가 던졌다/.test(l)), '예외가 로그에 남아야 한다');
    assert.ok(lines.some((l) => /마스터는 계속 돈다/.test(l)));
});

test('워커는 예외를 받으면 종료한다', function () {
    backstop._reset();
    const proc = fakeProc();
    let fatal = null;

    const lines = quiet(function (out) {
        backstop.install('worker', { proc: proc, onFatal: function (c) { fatal = c; } });
        proc.emit('uncaughtException', new Error('요청 처리 중 던졌다'), 'uncaughtException');
        return out;
    });

    assert.strictEqual(fatal, 1, '워커는 종료해야 한다 — 살려 두면 커넥션이 샌다');
    assert.ok(lines.some((l) => /요청 처리 중 던졌다/.test(l)));
    assert.ok(lines.some((l) => /워커를 종료한다/.test(l)));
});

test('처리되지 않은 거부도 같은 규칙으로 다룬다', function () {
    // Node 15 부터 기본이 throw 다. 여기서 받지 않으면 uncaughtException 이 된다.
    backstop._reset();
    const proc = fakeProc();
    let fatal = null;

    const lines = quiet(function (out) {
        backstop.install('worker', { proc: proc, onFatal: function (c) { fatal = c; } });
        proc.emit('unhandledRejection', new Error('거부됐다'), Promise.resolve());
        return out;
    });

    assert.strictEqual(fatal, 1);
    assert.ok(lines.some((l) => /거부됐다/.test(l)));
    assert.ok(lines.some((l) => /unhandledRejection/.test(l)));
});

// ── 로그가 폭주하지 않아야 한다 ──────────────────────────────────────
//
// 마스터는 살아남으므로, 프록시가 매 메시지마다 던지면 같은 스택이 무한히
// 쌓인다. 운영 로그가 밀리면 장애 분석이 불가능해진다.

test('같은 예외가 반복되면 로그를 접는다', function () {
    backstop._reset();
    const err = new Error('같은 것');

    const lines = quiet(function (out) {
        for (let i = 0; i < 50; i++) { backstop.report('master', err, null, 1000); }
        return out;
    });

    // 처음 3회는 스택째, 3회째에 접는다는 안내 1줄. 그 뒤는 같은 밀리초라 침묵.
    assert.ok(lines.length <= backstop._FULL_LOG_LIMIT + 1,
        '반복 예외가 ' + lines.length + '줄을 남겼다 — 로그가 밀린다');
    assert.ok(lines.some((l) => /이후로는/.test(l)), '접는다는 사실을 알려야 한다');
});

test('시간이 지나면 누적 횟수를 한 줄로 남긴다', function () {
    backstop._reset();
    const err = new Error('오래 반복');

    const lines = quiet(function (out) {
        for (let i = 0; i < 10; i++) { backstop.report('master', err, null, 1000); }
        // 요약 간격 뒤
        backstop.report('master', err, null, 1000 + backstop._SUMMARY_INTERVAL_MS);
        return out;
    });

    assert.ok(lines.some((l) => /누적 11회/.test(l)),
        '조용해지기만 하면 문제가 계속되는지 알 수 없다');
});

test('다른 예외는 각자 세어 서로를 가리지 않는다', function () {
    backstop._reset();

    const lines = quiet(function (out) {
        for (let i = 0; i < 10; i++) { backstop.report('master', new Error('A'), null, 1000); }
        backstop.report('master', new Error('B'), null, 1000);
        return out;
    });

    assert.ok(lines.some((l) => /Error: B/.test(l)),
        'A 가 접혔다고 B 까지 묻히면 안 된다');
});

// ── Error 가 아닌 것을 던져도 죽지 않아야 한다 ──────────────────────

test('Error 가 아닌 값을 던져도 백스톱 자신이 던지지 않는다', function () {
    backstop._reset();
    const proc = fakeProc();

    quiet(function () {
        backstop.install('master', { proc: proc, onFatal: function () {} });
        // throw 'string' / throw null / throw undefined 전부 가능하다.
        assert.doesNotThrow(function () {
            proc.emit('uncaughtException', 'string 을 던졌다');
            proc.emit('uncaughtException', null);
            proc.emit('uncaughtException', undefined);
            proc.emit('uncaughtException', { code: 42 });
        });
    });
});

// ── app.js 가 두 역할을 각자 걸었는지 ───────────────────────────────

test('app.js 가 마스터와 워커에 각각 백스톱을 건다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    assert.ok(/backstop\.install\('master'\)/.test(src), '마스터 백스톱이 없다');
    assert.ok(/backstop\.install\('worker'\)/.test(src), '워커 백스톱이 없다');

    // 마스터 쪽이 cluster.isMaster 블록 안에 있어야 한다.
    const master_at = src.indexOf("backstop.install('master')");
    const branch_at = src.indexOf('if (cluster.isMaster)');
    const worker_at = src.indexOf("backstop.install('worker')");
    assert.ok(branch_at > 0 && master_at > branch_at,
        '마스터 백스톱이 cluster.isMaster 블록 밖에 있다');
    assert.ok(worker_at > master_at,
        '워커 백스톱이 마스터 블록보다 앞에 있다 — 역할이 뒤바뀌었는지 확인할 것');
});

test('백스톱은 응답을 쓰지 않는다', function () {
    // 이미 응답한 요청에 두 번째 응답을 쓰면 ERR_HTTP_HEADERS_SENT 로 또 죽는다.
    // lease.js 가 같은 이유로 장부만 두고 응답에 손대지 않는다.
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'backstop.js'), 'utf8');

    for (const forbidden of ['response.', 'res.end', 'writeHead', 'response_error_result']) {
        assert.strictEqual(src.indexOf(forbidden), -1,
            'backstop 이 응답에 손댄다(' + forbidden + ') — 이중 응답으로 새 사망 경로가 생긴다');
    }
});
