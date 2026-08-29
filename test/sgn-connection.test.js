'use strict';
// 알림은 요청 커넥션을 쓰면 안 된다.
//
// sgn.check 를 부르는 네 곳이 전부 빈 콜백으로 부르고 곧바로 응답을 내보낸다.
// 정산이 connection.release() 를 하고 나서도 알림 질의가 계속 돌았다.
// 반납된 커넥션은 풀로 돌아가 다른 요청에 넘어가므로, 알림 질의가 남의
// 트랜잭션(checkAndPurge 의 SELECT ... FOR UPDATE) 안에서 실행될 수 있다.
// 크래시가 아니라 조용한 뒤섞임이라 로그에 아무것도 남지 않는다.
//
// 실측으로 확인했다 — nu 를 ID 형식으로 둔 구독에 CIN 3건을 넣으니 반납 후
// 질의가 6건 찍혔다(get_ri_sri, select_resource_from_url). 수정 후 0건이다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SGN = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn.js'), 'utf8');

test('sgn 이 요청 커넥션을 쓰지 않는다', function () {
    assert.strictEqual(/request\.db_connection/.test(SGN), false,
        'sgn.js 가 요청 커넥션을 다시 쓴다 — 응답·반납 뒤에도 질의가 돈다');
});

test('sgn 이 자기 커넥션을 빌리고 반납한다', function () {
    assert.ok(/db\.getConnection\(/.test(SGN), 'sgn 이 커넥션을 빌리지 않는다');
    assert.ok(/connection\.release\(\)/.test(SGN), 'sgn 이 커넥션을 반납하지 않는다');

    // 반납은 정확히 한 번이어야 한다. 두 번 반납하면 풀이 같은 커넥션을
    // 두 번 내주고, 두 요청이 같은 소켓을 공유하게 된다.
    assert.ok(/released\s*=\s*true/.test(SGN),
        '반납이 한 번인지 지키는 표식이 없다');
});

// ── DB 가 필요할 때만 빌린다 ────────────────────────────────────────
//
// get_nu_arr 은 nu 가 URL 이 아니라 ID 형식일 때만 조회한다.
// 대부분의 배포는 nu 에 URL 을 쓰므로, 알림마다 커넥션을 하나씩 더 빼면
// 워커당 100 인 한도가 이유 없이 빡빡해진다.

test('needs_connection 은 nu 형식으로 판정한다', function () {
    // sgn.js 는 export 하지 않으므로 같은 판정을 소스에서 확인한다.
    assert.ok(/function needs_connection\(/.test(SGN),
        'DB 필요 여부 판정이 없다 — 알림마다 커넥션을 빌리고 있는지 확인할 것');
    assert.ok(/url\.parse\(String\(nu_arr\[j\]\)\)\.protocol == null/.test(SGN),
        '판정 조건이 get_nu_arr 의 조건(protocol == null)과 어긋난다');
});

test('판정 조건이 get_nu_arr 의 실제 조건과 같다', function () {
    // 둘이 갈리면 "DB 가 필요 없다"고 판정해 놓고 null 커넥션으로 질의하게 된다.
    const at = SGN.indexOf('function get_nu_arr');
    assert.ok(at > 0);
    const body = SGN.slice(at, at + 1200);
    assert.ok(/sub_nu\.protocol == null/.test(body),
        'get_nu_arr 의 조건이 바뀌었다 — needs_connection 도 함께 고칠 것');
});

// ── 호출부가 여전히 fire-and-forget 인가 ────────────────────────────

test('sgn.check 호출부는 응답을 기다리지 않는다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    const calls = (src.match(/sgn\.check\(/g) || []).length;
    assert.strictEqual(calls, 4,
        'sgn.check 호출이 ' + calls + '곳이다 — 늘었다면 그 자리도 커넥션 계약을 확인할 것');

    // 빈 콜백으로 부르는 것 자체는 의도된 설계다(알림은 fire-and-forget).
    // 그래서 sgn 이 요청 커넥션을 쓰면 안 되는 것이다. 이 사실을 고정한다.
    assert.ok(/sgn\.check\(request, [^)]*, \d+, function \(code\) \{\s*\r?\n\s*\}\)/.test(src),
        'sgn.check 를 빈 콜백으로 부르는 형태가 사라졌다 — 정산과의 관계가 바뀌었는지 확인할 것');
});

// ── 요청마다 돌던 낭비 ──────────────────────────────────────────────

test('대상 객체 전체를 깊은 복제하지 않는다', function () {
    // ri 하나 읽으려고 targetObject 를 통째로 JSON 왕복시키고 있었다.
    // 쓰기 요청마다 도는 자리다.
    assert.strictEqual(/JSON\.parse\(JSON\.stringify\(request\.targetObject\)\)/.test(SGN), false,
        '요청마다 대상 객체를 깊은 복제한다');
});

test('요청마다 찍히던 디버그 배너가 없다', function () {
    assert.strictEqual(/#{10,}/.test(SGN), false,
        '디버그 배너가 되살아났다 — 운영 로그가 밀린다');
});
