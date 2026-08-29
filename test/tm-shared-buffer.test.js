'use strict';
// tm 의 하위 요청들이 응답 본문 버퍼를 공유하던 것.
//
// request_lock / request_tctl 은 rqps 항목마다 HTTP 요청을 **동시에** 던진다.
// 그런데 응답 누적 버퍼가 함수 전체에 하나였다:
//
//     var resBody = '';                       // 함수당 하나
//     ...
//     for (idx in rqps) {
//         http.request(options, function (res) {
//             res.on('data', function (chunk) { resBody += chunk; });   // 전부 여기 붙는다
//             res.on('end',  function () { res.body = resBody; resBody = ''; });
//         });
//     }
//
// 응답이 겹치면 한쪽이 섞인 전체를 가져가고 다른 쪽은 빈 본문을 받는다.
// 그 본문은 read_pc 가 JSON 으로 파싱해 rsps[].pc 에 담기므로,
// 트랜잭션 참여자의 응답이 서로 뒤바뀌거나 사라진다.
// 크래시가 아니라 조용한 뒤섞임이라 로그에 아무것도 남지 않는다.
//
// request_count 와 rsps 배열은 **의도된 공유**다(완료 집계와 결과 수집).
// 버퍼만 요청별로 나눠야 한다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const ROOT = path.join(__dirname, '..');
const TM = fs.readFileSync(path.join(ROOT, 'mobius', 'tm.js'), 'utf8');

// ── 기제 자체를 보인다 ───────────────────────────────────────────────
//
// tm.js 는 서버를 띄워야 태울 수 있고, 로컬에서는 하위 요청 경로가
// 완결되지 않는 것을 확인했다(별개 사안). 그래서 섞임의 기제를 같은
// 모양으로 재현해 무엇이 문제였는지 고정한다.

function collect(shared) {
    // 응답 두 개가 번갈아 도착하는 상황
    const a = new EventEmitter();
    const b = new EventEmitter();
    const out = {};

    let resBody = '';                       // 공유 버퍼(옛 방식)

    [['a', a], ['b', b]].forEach(function (pair) {
        const name = pair[0], res = pair[1];
        let own = '';                       // 요청별 버퍼(새 방식)
        res.on('data', function (c) {
            if (shared) { resBody += c; } else { own += c; }
        });
        res.on('end', function () {
            if (shared) { out[name] = resBody; resBody = ''; }
            else { out[name] = own; }
        });
    });

    // 번갈아 도착시킨다 — 동시 요청에서 실제로 일어나는 순서다
    a.emit('data', 'AAA');
    b.emit('data', 'BBB');
    a.emit('data', 'AAA');
    b.emit('data', 'BBB');
    a.emit('end');
    b.emit('end');
    return out;
}

test('공유 버퍼는 두 응답을 섞는다', function () {
    const got = collect(true);
    // a 가 먼저 끝나면서 섞인 전체를 가져가고, b 는 빈다.
    assert.strictEqual(got.a, 'AAABBBAAABBB', '섞이지 않았다면 이 테스트의 전제가 틀린 것이다');
    assert.strictEqual(got.b, '', 'b 는 빈 본문을 받는다');
});

test('요청별 버퍼는 섞이지 않는다', function () {
    const got = collect(false);
    assert.strictEqual(got.a, 'AAAAAA');
    assert.strictEqual(got.b, 'BBBBBB');
});

// ── tm.js 가 요청별 버퍼를 쓰는가 ────────────────────────────────────

test('tm 의 응답 핸들러가 자기 버퍼를 만든다', function () {
    // 응답 핸들러 안에서 var body 를 선언해야 한다.
    const handlers = TM.split(/(?:http|https)\.request\(options, function \(res\) \{/).slice(1);
    assert.strictEqual(handlers.length, 4,
        '응답 핸들러가 ' + handlers.length + '개다 — request_lock/request_tctl 의 http/https 네 갈래여야 한다');

    handlers.forEach(function (h, i) {
        const head = h.slice(0, 500);
        assert.ok(/var body = '';/.test(head),
            (i + 1) + '번째 응답 핸들러가 자기 버퍼를 만들지 않는다');
        assert.ok(/body \+= chunk/.test(head),
            (i + 1) + '번째 핸들러가 자기 버퍼에 쌓지 않는다');
    });
});

test('함수 수준 공유 버퍼가 남아 있지 않다', function () {
    // 주석 안의 설명은 걸러야 한다 — 이 파일에도 옛 코드를 설명하는 주석이 있다.
    const code = TM
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter(function (l) { return !/^\s*\/\//.test(l); })
        .join('\n');

    assert.strictEqual(/var resBody = '';/.test(code), false,
        '함수 수준 resBody 가 되살아났다 — 동시 요청의 본문이 섞인다');
    assert.strictEqual(/resBody \+= chunk/.test(code), false,
        '공유 버퍼에 응답을 쌓는다');
});

test('완료 집계는 여전히 공유한다', function () {
    // request_count 와 rsps 는 나누면 안 된다. 모든 하위 요청이 끝났는지
    // 세는 장벽이고, 결과를 한데 모으는 자리다.
    const code = TM.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/var request_count = 0;/.test(code), '완료 카운터가 사라졌다');
    assert.ok(/var rsps = \[\];/.test(code), '결과 수집 배열이 사라졌다');
    assert.ok(/if\(request_count >= rqps\.length\)/.test(code),
        '모든 하위 요청 완료를 기다리는 장벽이 사라졌다');
});
