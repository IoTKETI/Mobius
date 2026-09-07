'use strict';
// Notifications must not use the request connection.
//
// The four callers of sgn.check pass an empty callback and send the response immediately, so notification queries would keep running after settlement released the connection. A released connection returns to the pool and is handed to another request, so the notification query could run inside someone else's transaction (checkAndPurge's SELECT ... FOR UPDATE). No crash, no log line: silent interleaving.

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
    // Both forms are accepted: calling the handle directly (connection.release()) and delegating to the facade (db.release(connection)). The latter is the current form; calling the handle assumes a MySQL pool connection, while the facade may hand out another backend's handle (the SQLite singleton has no release).
    assert.ok(/connection\.release\(\)|db\.release\(connection\)/.test(SGN),
        'sgn 이 커넥션을 반납하지 않는다');

    // Release must happen exactly once. Releasing twice makes the pool hand the same connection out twice, and two requests share one socket.
    assert.ok(/released\s*=\s*true/.test(SGN),
        '반납이 한 번인지 지키는 표식이 없다');
});

// Always borrows. The source of notifications is the sub table, so every write reads `sub where pi = ?` and a connection is always needed.

// Comments are excluded; historical notes there are worth keeping.
const SGN_CODE = SGN.replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('알림은 언제나 자기 커넥션을 빌린다 — 원천이 sub 테이블이라 DB 가 필요하다', function () {
    assert.strictEqual(SGN_CODE.indexOf('needs_connection'), -1,
        '"DB 가 필요할 때만" 판정이 되살아났다 — 이제 언제나 필요하다');
    assert.ok(/function with_connection\(body, on_giveup\)/.test(SGN_CODE), '커넥션 대여 함수가 없다');
    assert.ok(/sub_source\.rows_for\(connection, parentObj, notiObj, check_value/.test(SGN_CODE),
        '빌린 커넥션으로 sub_source 를 묻지 않는다');
    assert.strictEqual(SGN_CODE.indexOf('parentObj.subl'), -1, 'subl 사본을 다시 읽는다');
});

// The callers are still fire-and-forget.

test('sgn.check 호출부는 응답을 기다리지 않는다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    const calls = (src.match(/sgn\.check\(/g) || []).length;
    assert.strictEqual(calls, 4,
        'sgn.check 호출이 ' + calls + '곳이다 — 늘었다면 그 자리도 커넥션 계약을 확인할 것');

    // Calling with an empty callback is the intended design (notifications are fire-and-forget), which is exactly why sgn must not use the request connection. Pinned here.
    assert.ok(/sgn\.check\(request, [^)]*, \d+, function \(code\) \{\s*\r?\n\s*\}\)/.test(src),
        'sgn.check 를 빈 콜백으로 부르는 형태가 사라졌다 — 정산과의 관계가 바뀌었는지 확인할 것');
});

// Per-request waste.

test('대상 객체 전체를 깊은 복제하지 않는다', function () {
    // The whole targetObject must not be round-tripped through JSON just to read one ri; this runs on every write request.
    assert.strictEqual(/JSON\.parse\(JSON\.stringify\(request\.targetObject\)\)/.test(SGN), false,
        '요청마다 대상 객체를 깊은 복제한다');
});

test('요청마다 찍히던 디버그 배너가 없다', function () {
    assert.strictEqual(/#{10,}/.test(SGN), false,
        '디버그 배너가 되살아났다 — 운영 로그가 밀린다');
});

// Shared objects must not be mutated while iterating over nu. sgn_action_send once modified node / sub_bodytype / short_flag for one nu and passed the same values to the next, so an earlier nu's options (rcn=9 abbreviated body, ct=xml) leaked into all following ones. Nothing is logged, so subscribers would only notice on their own.

test('nu 옵션이 뒤따르는 nu 로 번지지 않는다', function () {
    const at = SGN.indexOf('function sgn_action_send');
    assert.ok(at > 0);
    const end = SGN.indexOf('\nfunction ', at + 10);
    const body = SGN.slice(at, end > 0 ? end : SGN.length);

    // Each nu uses its own values.
    //
    // this_bodytype no longer exists: notifications are always json and nu's ct= is not read (see make_body_string_for_noti). The leak affected rcn=9 (abbreviated body) as well, and that part is still guarded.
    for (const local of ['this_node', 'this_short']) {
        assert.ok(body.indexOf('var ' + local) > 0,
            local + ' 이 없다 — nu 별 값을 쓰지 않고 파라미터를 덮어쓰는지 확인할 것');
    }

    // The recursion must pass the original values. Passing this_* leaks again.
    assert.ok(/sgn_action_send\(nu_arr, \+\+req_count, node, short_flag,/.test(body),
        '재귀가 이 nu 의 값을 다음으로 넘긴다 — 옵션이 번진다');
});

test('rcn=9 일 때만 node 를 복제한다', function () {
    const at = SGN.indexOf('function sgn_action_send');
    const end = SGN.indexOf('\nfunction ', at + 10);
    const body = SGN.slice(at, end > 0 ? end : SGN.length);

    // Cloning every time wastes that much per notification.
    const clones = (body.match(/JSON\.parse\(JSON\.stringify\(node\)\)/g) || []).length;
    assert.strictEqual(clones, 1,
        'node 복제가 ' + clones + '곳이다 — rcn=9 분기 안에서 한 번만 해야 한다');

    // That clone must sit inside the rcn branch.
    const rcn_at = body.indexOf("== 'rcn'");
    const clone_at = body.indexOf('JSON.parse(JSON.stringify(node))');
    assert.ok(rcn_at > 0 && clone_at > rcn_at,
        'node 복제가 rcn 분기 밖에 있다 — 옵션 없는 알림까지 복제한다');
});

test('본문 조립과 발송이 nu 별 값을 쓴다', function () {
    const at = SGN.indexOf('function sgn_action_send');
    const end = SGN.indexOf('\nfunction ', at + 10);
    const body = SGN.slice(at, end > 0 ? end : SGN.length);

    assert.ok(/make_body_string_for_noti\(sub_nu\.protocol, nu, this_node, xm2mri, this_short,/.test(body),
        '본문 조립이 공유 값을 쓴다');
    // ri is the subscription ri, so the notification log can be traced back to a subscription (the first question the admin UI asks). ss_ri is already an argument, so no extra lookup.
    assert.ok(/sgn_man\.post\(nu, xm2mri, bodyString, ss_ri\)/.test(body),
        '발송이 nu 와 구독 ri 를 함께 넘겨야 한다');

    // Catches a format argument if it returns. Notifications are always json.
    assert.doesNotMatch(body, /sgn_man\.post\([^)]*bodytype/,
        'bodytype 인자가 되살아났다 — 알림 형식은 선택 가능한 것이 아니다');
});

// Notification outcome classification (observation signal).
//
// HTTP reads the response, so a receiver returning 500 is not counted as success, and the failure log names the subscription.
//
// This stage classifies only: no storage, no policy, no automatic deletion.
//
//   ok     http  (rsc=2000)
//   reject http  (rsc=4004)     received but rejected: not a deletion candidate
//   fail   http  (status=500)
//   fail   http  (ECONNREFUSED)
//   fail   -     (no resource to receive)   <- the receiver is gone

const SGN_MAN = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn_man.js'), 'utf8');

test('HTTP 알림이 응답을 읽고 본문을 소비한다', function () {
    assert.ok(/req\.on\('response'/.test(SGN_MAN),
        "'response' 리스너가 없다 — 수신자가 500 을 줘도 성공과 구분되지 않는다");

    // res.resume() is the one trap in this code. Attaching a listener without consuming the body holds the socket until the arm timeout even on a normal response and logs a false 'no response'. It must be a real statement, not a comment; searching for the string alone would pass a commented-out line.
    assert.ok(/^\s*res\.resume\(\);\s*$/m.test(SGN_MAN),
        'res.resume() 이 문장으로 없다 — 소켓이 타임아웃까지 안 풀린다');
});

test('결과를 네 갈래로 가른다', function () {
    for (const kind of ['NOTI_OK', 'NOTI_REJECT', 'NOTI_FAIL', 'NOTI_UNKNOWN']) {
        assert.ok(SGN_MAN.indexOf(kind) > 0, kind + ' 이 없다');
    }
    // 2xx with RSC 4xxx/5xxx is 'received but rejected'. Lumping it with failures would put mis-configured subscriptions on the deletion list.
    const at = SGN_MAN.indexOf("req.on('response'");
    const block = SGN_MAN.slice(at, at + 900);
    assert.ok(block.indexOf('NOTI_REJECT') > 0,
        '2xx 인데 RSC 가 거부인 경우를 가르지 않는다');
    assert.ok(/rsc && !\/\^2/.test(block),
        'RSC 가 2xxx 인지 보는 판정이 없다');
});

test('판정 불가를 실패로 세지 않는다', function () {
    // MQTT is QoS 0, so even broker delivery is unknown, and WS closes right after sending. Counting these as failures makes healthy subscriptions look dead.
    const mqtt = SGN_MAN.slice(SGN_MAN.indexOf('function request_noti_mqtt'), SGN_MAN.indexOf('function request_noti_ws'));
    assert.ok(/NOTI_UNKNOWN/.test(mqtt), 'MQTT 를 판정 불가로 두지 않았다');

    // A normal close of a reused keep-alive socket is not a failure either. Node's globalAgent has keepAlive on by default, so when the receiver closes on its idle timeout first, the next notification fails with ECONNRESET.
    assert.ok(/req\.reusedSocket/.test(SGN_MAN),
        'keep-alive 재사용 소켓 실패를 구분하지 않는다 — 멀쩡한 수신자가 실패로 쌓인다');
});

test('모든 신호에 구독 ri 가 붙는다', function () {
    // Without the subscription in the log the admin UI can do nothing.
    assert.ok(/function noti_result\(kind, proto, nu, ri/.test(SGN_MAN),
        '판정 로그가 구독 ri 를 받지 않는다');
    assert.ok(/sub=' \+ \(ri \|\| '\?'\)/.test(SGN_MAN),
        '로그에 sub= 이 없다');

    // The outbound timeout log must also name the subscription.
    assert.ok(/outbound\.arm\(req, 'notify http ' \+ \(ri \|\| nu\)\)/.test(SGN_MAN),
        'arm label 에 구독 ri 가 없다 — 타임아웃 로그를 역추적할 수 없다');
});

test('못 푼 nu 는 빼고 이어 간다 — 해석 실패 갈래 넷 전부', function () {
    // Resolving ID-form nu entries is done by mobius/nu_resolve.js; its behaviour is exercised by test/sgn-resolve-nu.test.js. Here the source is checked for the rule that all four failure reasons go through 'drop and continue' (fail): a return in any of them would leave that nu in the array, and the sender would then mistake the unresolved string for an address and log a second failure.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'nu_resolve.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const reasons = ['nu 해석 중 DB 오류', '받을 리소스 조회 중 DB 오류', '받을 리소스가 없다: ', '받을 리소스에 poa 가 없다: '];
    reasons.forEach(function (r) {
        assert.ok(new RegExp("fail\\(it, '" + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(src),
            '실패 사유가 fail() 로 가지 않는다: ' + r);
    });
    // Counts calls only: the `function fail(it, why)` definition is not followed by a quote.
    assert.strictEqual((src.match(/fail\(it, '/g) || []).length, 4, '실패 갈래는 정확히 넷이다');
    // The sender uses only the array finish() reassembles; unresolved entries have out = [] and disappear.
    assert.ok(/else if \(it\.out\) \{ Array\.prototype\.push\.apply\(out, it\.out\); \}/.test(src));
});

test('MQTT 알림이 브로커 단절 때 메모리에 무한히 쌓이지 않는다', function () {
    // mqtt.js buffers QoS 0 publishes in an unbounded array while disconnected; no version has a queueLimit option:
    //
    //   MqttClient.prototype._sendPacket: if (!this.connected) {
    //       if ((qos === 0 && this.queueQoSZero) || cmd !== 'publish') this.queue.push(...)
    //
    // Notifications are fire-and-forget (no ACK, retry or timeout); with QoS 0 a subscriber cannot tell a dropped notification from a lost one, and late sensor data has no value. So they are dropped, not queued.
    //
    // Only executable lines are checked: the explanatory comment mentions 'queueQoSZero: false', so a whole-file regex passed even with the value flipped to true.
    const live = SGN_MAN.split(/\r?\n/).filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    });

    assert.ok(live.some(function (l) { return /^\s*queueQoSZero\s*:\s*false\s*,?\s*$/.test(l); }),
        'queueQoSZero: false 가 실행 코드에 없다 — 브로커가 끊기면 발행이 메모리에 무한히 쌓인다');

    assert.strictEqual(live.some(function (l) { return /queueQoSZero\s*:\s*true/.test(l); }), false,
        'queueQoSZero 가 true 다 — 끊긴 동안 발행이 상한 없이 쌓인다');
});

test('브로커 단절을 로그로 알 수 있다', function () {
    // The listeners were connect and error only, but a broker disconnect emits 'offline' / 'close', not error, so the disconnected period left no trace in the log.
    for (const ev of ['offline', 'close', 'reconnect']) {
        assert.ok(new RegExp("sgn_mqtt_client\\.on\\('" + ev + "'").test(SGN_MAN),
            "'" + ev + "' 리스너가 없다 — 브로커가 끊긴 것을 로그로 알 수 없다");
    }
});

test('발행 실패를 세지 않고 넘어가지 않는다', function () {
    // Without a publish callback, failures vanish silently. Pairs with queueQoSZero: false, where the callback returns err('No connection to broker') while disconnected.
    assert.ok(/publish\(noti_topic, bodyString, function/.test(SGN_MAN),
        'publish 에 콜백이 없다 — 브로커가 끊겨 버려진 알림을 셀 수 없다');
});

test('두 use_secure 분기가 같은 연결 옵션을 쓴다', function () {
    // Connection options (keepalive, reconnectPeriod, connectTimeout) must exist in the branch that is actually used. The option object is built once and shared by both branches.
    const at = SGN_MAN.indexOf('MQTT client (singleton)');
    const head = SGN_MAN.slice(at, SGN_MAN.indexOf('Notification result classification', at));

    // Only executable lines are counted. Explanatory comments legitimately mention option names.
    const live = head.split(/\r?\n/).filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');

    // There must be one option object; building one per branch lets them diverge again.
    const bare = /mqtt\.connect\('mqtt:\/\/'\s*\+\s*use_mqtt_broker\s*\+\s*':'\s*\+\s*use_mqtt_port\)/;
    assert.strictEqual(bare.test(live), false,
        '옵션 없이 URL 만으로 connect 하는 분기가 남아 있다 — 기본값(keepalive 60s)이 적용된다');

    for (const opt of ['keepalive', 'reconnectPeriod', 'connectTimeout', 'queueQoSZero']) {
        const n = (live.match(new RegExp('^\\s*' + opt + '\\s*:', 'gm')) || []).length;
        assert.strictEqual(n, 1,
            opt + ' 이 실행 코드 ' + n + '곳에 있다 — 공유 객체 한 곳에만 있어야 두 분기가 안 갈라진다');
    }

    // And connect must be called exactly once.
    const connects = (live.match(/mqtt\.connect\(/g) || []).length;
    assert.strictEqual(connects, 1,
        'mqtt.connect 가 ' + connects + '번 불린다 — 분기마다 부르면 옵션이 다시 갈라진다');
});
