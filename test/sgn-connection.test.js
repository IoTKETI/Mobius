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
    // 핸들에 직접 부르는 형태(connection.release())와 파사드에 맡기는 형태
    // (db.release(connection)) 둘 다 받는다. 뒤쪽이 지금 형태다 — 핸들에 직접
    // 부르는 것은 "MySQL 풀 커넥션" 이라는 가정이고, 커넥션 원천이 파사드로
    // 옮겨진 뒤로는 다른 백엔드의 핸들이 올 수 있다(SQLite 싱글턴에는 release 가 없다).
    assert.ok(/connection\.release\(\)|db\.release\(connection\)/.test(SGN),
        'sgn 이 커넥션을 반납하지 않는다');

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
    const at = SGN.indexOf('function needs_connection(');
    assert.ok(at > 0,
        'DB 필요 여부 판정이 없다 — 알림마다 커넥션을 빌리고 있는지 확인할 것');

    // 변수 이름이 아니라 판정 자체를 본다. 이름은 바뀔 수 있다
    // (nu_arr -> subl.read 가 돌려주는 ss.nu 로 옮긴 적이 있다).
    const body = SGN.slice(at, SGN.indexOf('\n}', at) + 2);
    assert.ok(/url\.parse\(String\([^)]+\)\)\.protocol == null/.test(body),
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

// ── nu 순회 중 공유 객체를 변형하던 것 (SGN-SHARED-NODE) ─────────────
//
// sgn_action_send 는 nu 하나를 처리하며 node / sub_bodytype / short_flag 를
// 고친 뒤 **같은 값을 다음 nu 로 넘겼다**. 앞선 nu 의 옵션이 뒤에 전부 번졌다.
//
// 실측 (수정 전):
//   nu = ['http://a/?rcn=9', 'http://b/']
//     a: 속성=[con,cs]                          <- 요청한 축약본
//     b: 속성=[con,cs]                          <- 요청하지 않았는데 축약본
//   nu = ['http://a/?ct=xml', 'http://b/']
//     a: xml,  b: xml                           <- b 는 json 이어야 한다
//
// 수정 후 b 는 각각 온전한 본문과 json 을 받는다.
// 로그에는 아무것도 남지 않으므로 구독자가 신고하기 전에는 알 수 없다.

test('nu 옵션이 뒤따르는 nu 로 번지지 않는다', function () {
    const at = SGN.indexOf('function sgn_action_send');
    assert.ok(at > 0);
    const end = SGN.indexOf('\nfunction ', at + 10);
    const body = SGN.slice(at, end > 0 ? end : SGN.length);

    // nu 마다 자기 값을 써야 한다.
    for (const local of ['this_bodytype', 'this_node', 'this_short']) {
        assert.ok(body.indexOf('var ' + local) > 0,
            local + ' 이 없다 — nu 별 값을 쓰지 않고 파라미터를 덮어쓰는지 확인할 것');
    }

    // 재귀에는 원래 값을 넘겨야 한다. this_* 를 넘기면 다시 번진다.
    assert.ok(/sgn_action_send\(nu_arr, \+\+req_count, sub_bodytype, node, short_flag,/.test(body),
        '재귀가 이 nu 의 값을 다음으로 넘긴다 — 옵션이 번진다');
});

test('rcn=9 일 때만 node 를 복제한다', function () {
    const at = SGN.indexOf('function sgn_action_send');
    const end = SGN.indexOf('\nfunction ', at + 10);
    const body = SGN.slice(at, end > 0 ? end : SGN.length);

    // 매번 복제하면 알림마다 그만큼이 그대로 낭비다.
    const clones = (body.match(/JSON\.parse\(JSON\.stringify\(node\)\)/g) || []).length;
    assert.strictEqual(clones, 1,
        'node 복제가 ' + clones + '곳이다 — rcn=9 분기 안에서 한 번만 해야 한다');

    // 그 복제가 rcn 분기 안에 있어야 한다.
    const rcn_at = body.indexOf("== 'rcn'");
    const clone_at = body.indexOf('JSON.parse(JSON.stringify(node))');
    assert.ok(rcn_at > 0 && clone_at > rcn_at,
        'node 복제가 rcn 분기 밖에 있다 — 옵션 없는 알림까지 복제한다');
});

test('본문 조립과 발송이 nu 별 값을 쓴다', function () {
    const at = SGN.indexOf('function sgn_action_send');
    const end = SGN.indexOf('\nfunction ', at + 10);
    const body = SGN.slice(at, end > 0 ? end : SGN.length);

    assert.ok(/make_body_string_for_noti\(sub_nu\.protocol, nu, this_node, this_bodytype, xm2mri, this_short,/.test(body),
        '본문 조립이 공유 값을 쓴다');
    // ri 는 구독 ri 다. 알림 로그에 어느 구독인지가 없어서 실패를 역추적할 수
    // 없었다 — 관리 UI 가 물어볼 첫 질문이 그것이다. ss_ri 가 이미 인자로
    // 들어와 있던 값이라 추가 조회는 없다.
    assert.ok(/sgn_man\.post\(nu, bodytype, xm2mri, bodyString, ri\)/.test(body),
        '발송이 nu 별 bodytype 과 구독 ri 를 함께 넘겨야 한다');
});

// ── 알림 결과 판정 (관측 신호) ───────────────────────────────────────
//
// 여기까지는 "알림이 나갔는지" 를 판정하는 코드가 한 줄도 없었다.
// HTTP 는 'response' 리스너가 없어 수신자가 500 을 줘도 성공과 같았고,
// 실패 로그에는 어느 구독인지가 없어 역추적조차 안 됐다.
// 그래서 "안 쓰는 구독 / 못 보내는 구독" 을 물어도 답할 데이터가 없었다.
//
// 이 단계는 판정만 한다 — 저장도, 정책도, 자동 삭제도 없다.
//
// 실측 (구독 5개에 CIN 1건):
//   ok     http  sub=.../ns_ok      (rsc=2000)
//   reject http  sub=.../ns_reject  (rsc=4004)     받았지만 거부 — 삭제 후보 아님
//   fail   http  sub=.../ns_err500  (status=500)
//   fail   http  sub=.../ns_dead    (ECONNREFUSED)
//   fail   -     sub=.../ns_goneAE  (받을 리소스가 없다)   ← 수신자가 사라진 구독

const SGN_MAN = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn_man.js'), 'utf8');

test('HTTP 알림이 응답을 읽고 본문을 소비한다', function () {
    assert.ok(/req\.on\('response'/.test(SGN_MAN),
        "'response' 리스너가 없다 — 수신자가 500 을 줘도 성공과 구분되지 않는다");

    // res.resume() 이 이 코드의 유일한 함정이다. 리스너만 붙이고 본문을
    // 소비하지 않으면 정상 응답을 받은 요청도 arm 타임아웃까지 소켓을
    // 붙잡고 가짜 '응답이 오지 않는다' 로그를 남긴다 — 개선이 아니라 장애다.
    // 주석이 아니라 실제 문장이어야 한다. 문자열만 찾으면 주석 처리해도 통과한다.
    assert.ok(/^\s*res\.resume\(\);\s*$/m.test(SGN_MAN),
        'res.resume() 이 문장으로 없다 — 소켓이 타임아웃까지 안 풀린다');
});

test('결과를 네 갈래로 가른다', function () {
    for (const kind of ['NOTI_OK', 'NOTI_REJECT', 'NOTI_FAIL', 'NOTI_UNKNOWN']) {
        assert.ok(SGN_MAN.indexOf(kind) > 0, kind + ' 이 없다');
    }
    // 2xx + RSC 4xxx/5xxx 는 '받았지만 거부' 다. 실패로 뭉뚱그리면
    // 설정이 어긋난 구독이 삭제 후보로 올라온다.
    const at = SGN_MAN.indexOf("req.on('response'");
    const block = SGN_MAN.slice(at, at + 900);
    assert.ok(block.indexOf('NOTI_REJECT') > 0,
        '2xx 인데 RSC 가 거부인 경우를 가르지 않는다');
    assert.ok(/rsc && !\/\^2/.test(block),
        'RSC 가 2xxx 인지 보는 판정이 없다');
});

test('판정 불가를 실패로 세지 않는다', function () {
    // MQTT 는 QoS0 라 브로커 도달조차 알 수 없고, WS 는 보내자마자 닫는다.
    // 이들을 '실패' 로 세면 멀쩡한 구독이 죽은 것으로 보인다.
    const mqtt = SGN_MAN.slice(SGN_MAN.indexOf('function request_noti_mqtt'), SGN_MAN.indexOf('function request_noti_ws'));
    assert.ok(/NOTI_UNKNOWN/.test(mqtt), 'MQTT 를 판정 불가로 두지 않았다');

    // keep-alive 재사용 소켓의 정상 종료도 실패가 아니다.
    // Node 의 globalAgent 는 keepAlive 가 기본 true 라(실측) 수신자가 자기
    // idle 타임아웃으로 먼저 닫으면 다음 알림이 ECONNRESET 으로 떨어진다.
    assert.ok(/req\.reusedSocket/.test(SGN_MAN),
        'keep-alive 재사용 소켓 실패를 구분하지 않는다 — 멀쩡한 수신자가 실패로 쌓인다');
});

test('모든 신호에 구독 ri 가 붙는다', function () {
    // 로그에 어느 구독인지가 없으면 관리 UI 가 아무것도 못 한다.
    assert.ok(/function noti_result\(kind, proto, nu, ri/.test(SGN_MAN),
        '판정 로그가 구독 ri 를 받지 않는다');
    assert.ok(/sub=' \+ \(ri \|\| '\?'\)/.test(SGN_MAN),
        '로그에 sub= 이 없다');

    // outbound 타임아웃 로그도 어느 구독인지 알아야 한다.
    assert.ok(/outbound\.arm\(req, 'notify http ' \+ \(ri \|\| nu\)\)/.test(SGN_MAN),
        'arm label 에 구독 ri 가 없다 — 타임아웃 로그를 역추적할 수 없다');
});

test('못 푼 nu 는 배열에서 빼고 순회를 이어 간다', function () {
    // 예전에는 주석이 '순회만 이어 간다' 인데 코드는 callback 후 return 이라
    // 거기서 끝났다. 그러면 뒤에 오는 ID 형식 nu 가 영영 안 풀린다.
    // 그리고 못 푼 문자열을 배열에 남기면 발송 단계가 그것을 주소로 착각해
    // 엉뚱한 두 번째 실패 로그를 낸다 — 구독 하나가 두 줄로 보인다.
    const at = SGN.indexOf('function get_nu_arr');
    const body = SGN.slice(at, SGN.indexOf('function sgn_action', at));

    const splices = (body.match(/nu_arr\.splice\(req_count, 1\)/g) || []).length;
    assert.strictEqual(splices, 4,
        '못 푼 nu 를 빼는 곳이 ' + splices + '곳이다 — 해석 실패 분기 4곳 전부여야 한다');

    // splice 로 한 칸 줄었으므로 재귀는 req_count 그대로다(+1 이 아니다).
    assert.strictEqual(/splice\(req_count, 1\);\s*\r?\n\s*get_nu_arr\(connection, nu_arr, req_count \+ 1,/.test(body), false,
        'splice 후 req_count + 1 로 재귀하면 한 항목을 건너뛴다');
});
