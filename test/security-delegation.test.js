'use strict';
// security.js 가 acp_eval 에 위임하도록 바뀐 뒤, 리뷰에서 지적된 두 회귀를 잠근다.
// security_check_action_pv/_pvs 는 모듈 비공개 함수이므로 exports.check 를 통해
// 구동한다. security.js 는 make_internal_ri/get_ri_list_sri 를 전역으로 참조하고
// db_sql.select_acp_in 으로 DB 를 조회하므로, 셋 다 여기서 스텁해 순수 위임
// 로직(acp_eval 호출과 그 결과 매핑)만 관측한다.
//
// Finding A (IP 헤더 오버라이드가 _pvs 로 샌 회귀): mobius/security.js 의
// client_ip_of/ctx_of 가 _pv 전용 헤더 오버라이드를 _pvs 에도 적용하면 실패한다.
// Finding B (_pv 의 "acr 없는 행" 즉시 단락 소실): mobius/security.js 의
// security_check_action_pv 가 privList 를 한 번에 모아 evaluatePrivileges 를
// 호출하기만 하면(행 단위 단락 처리 없이) 실패한다.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SQL_ACTION_PATH = path.join(__dirname, '..', 'mobius', 'sql_action.js');
const SECURITY_PATH = path.join(__dirname, '..', 'mobius', 'security.js');

// 매 테스트마다 security.js/sql_action.js 를 새로 require 해서 스텁이 서로
// 새지 않게 한다. make_internal_ri/get_ri_list_sri 는 리소스 경로 정규화 및
// sri->ri 해석을 담당하는데, 여기서는 acp 판정 로직만 보면 되므로 항등
// 스텁으로 대체한다(둘 다 app.js/resource.js 가 global 에 실제로 붙이는
// 것과 같은 시그니처를 유지한다).
function freshSecurity(acpRows) {
    delete require.cache[require.resolve(SQL_ACTION_PATH)];
    delete require.cache[require.resolve(SECURITY_PATH)];

    const sql_action = require(SQL_ACTION_PATH);
    sql_action.select_acp_in = function (connection, ri_list, callback) {
        callback(null, acpRows);
    };

    global.make_internal_ri = function () { /* no-op: 테스트 acpiList 는 이미 절대경로 */ };
    global.get_ri_list_sri = function (request, response, sri_list, ri_list, count, callback) {
        for (var i = 0; i < sri_list.length; i++) { ri_list[i] = sri_list[i]; }
        callback('200');
    };
    global.usesuperuser = 'CNeverMatchesSuperuser';
    global.useadminorigin = ''; // 비활성: 실제 부팅(mobius.js)에서 항상 설정되는 값을 재현
    global.useaccesscontrolpolicy = 'disable';

    return require(SECURITY_PATH);
}

function fakeRequest(headerOverrides, remoteAddress) {
    return {
        headers: Object.assign({ 'x-m2m-origin': 'CRequester' }, headerOverrides || {}),
        connection: { remoteAddress: remoteAddress || '203.0.113.9' },
        url: '/Mobius/eqv_ae/c1',
        db_connection: {}
    };
}

// ---------------------------------------------------------------------------
// Finding A: remoteaddress 헤더 오버라이드가 _pvs 로 새는 회귀.
//
// acp 의 pv/pvs 는 동일하게 acco.acip.ipv4 를 ['10.0.0.5'] 로 제한한다. 요청의
// 실제 TCP 소스는 203.0.113.9(fakeRequest 기본값) 이고, remoteaddress 헤더로
// 10.0.0.5 를 스푸핑한다.
//   - _pv 경로(원본이 헤더 오버라이드를 허용하던 경로): 허용되어야 한다.
//   - _pvs 경로(원본은 헤더를 전혀 보지 않던 경로): 거부되어야 한다.
// 고정 전에는 security.js 의 security_check_action_pvs 안 `var ctx =
// ctx_of(request, access_value, cr);` (client_ip_of_pvs 분리 이전, 헤더를
// 그대로 보는 client_ip_of 를 재사용하던 줄) 때문에 두 번째 assert 가 실패했다
// — _pvs 도 스푸핑된 10.0.0.5 를 클라이언트 IP 로 봐서 허용해버렸다.
// ---------------------------------------------------------------------------

const acpForFindingA = [{
    pv: JSON.stringify({ acr: [{ acor: ['CRequester'], acop: 63, acco: [{ acip: { ipv4: ['10.0.0.5'] } }] }] }),
    pvs: JSON.stringify({ acr: [{ acor: ['CRequester'], acop: 63, acco: [{ acip: { ipv4: ['10.0.0.5'] } }] }] })
}];

test('Finding A: _pv 는 remoteaddress 헤더 오버라이드로 acip 를 통과한다 (기존 동작)', function (t, done) {
    const security = freshSecurity(acpForFindingA);
    const request = fakeRequest({ remoteaddress: '10.0.0.5' });
    // ty 를 '1'/'33'/'23'/'4'/'3' 이 아닌 값으로 주면 acpiList 가 비어있지 않은 한
    // exports.check 는 곧장 security_check_action_pv 로 간다.
    security.check(request, {}, '2', ['/Mobius/eqv_acp'], '2', 'CCreator', function (code) {
        assert.strictEqual(code, '1', '헤더로 스푸핑된 IP 가 acip 목록과 일치하므로 _pv 는 허용해야 한다');
        done();
    });
});

test('Finding A: _pvs 는 remoteaddress 헤더를 보지 않으므로 실제 TCP 소스로 acip 검사를 해 거부한다', function (t, done) {
    const security = freshSecurity(acpForFindingA);
    const request = fakeRequest({ remoteaddress: '10.0.0.5' });
    // ty=='1' 은 selfPrivileges 검사 경로 -> security_check_action_pvs.
    security.check(request, {}, '1', ['/Mobius/eqv_acp'], '2', 'CCreator', function (code) {
        assert.strictEqual(code, '0',
            '_pvs 는 원본처럼 헤더를 무시하고 실제 TCP 소스(203.0.113.9)로 검사해야 하므로 거부해야 한다');
        done();
    });
});

// ---------------------------------------------------------------------------
// Critical 2: ipv4 분기 ↔ ipv6 분기의 IP 출처 비대칭.
//
// Finding A 는 _pv ↔ _pvs 사이의 헤더 비대칭이었고, 이건 각 함수 "안"의
// ipv4 ↔ ipv6 비대칭이다. 원본(bad4d4c:mobius/security.js:84, :268)은 두
// 함수 모두 ipv6 분기에서 request.connection.remoteAddress 를 그대로 쓴다.
// 추출이 ctx.clientIp 하나만 넘기면서 아래 두 행이 원본과 어긋났다:
//
//   케이스                                        bad4d4c   합쳤을 때
//   루프백 + acip.ipv6:['::1']                     '1'       '0'
//   헤더 스푸핑 2001:db8::5 + acip.ipv6:[같은 값]   '0'       '1'  <- 권한 상승
// ---------------------------------------------------------------------------

const acpIpv6Loopback = [{
    pv: JSON.stringify({ acr: [{ acor: ['CRequester'], acop: 63, acco: [{ acip: { ipv6: ['::1'] } }] }] }),
    pvs: JSON.stringify({ acr: [{ acor: ['CRequester'], acop: 63, acco: [{ acip: { ipv6: ['::1'] } }] }] })
}];

test('Critical 2: _pv 의 ipv6 분기는 루프백 소켓 주소(::1)를 그대로 보고 허용한다', function (t, done) {
    const security = freshSecurity(acpIpv6Loopback);
    // 헤더 없음, 실제 소켓 주소가 ::1. ipv4 분기라면 ip.address() 로 치환되지만
    // ipv6 분기는 원본 그대로를 본다.
    const request = fakeRequest({}, '::1');
    security.check(request, {}, '2', ['/Mobius/eqv_acp'], '2', 'CCreator', function (code) {
        assert.strictEqual(code, '1',
            "bad4d4c 는 acip.ipv6:['::1'] 로 루프백 클라이언트를 허용했다");
        done();
    });
});

test('Critical 2: _pvs 의 ipv6 분기도 루프백 소켓 주소를 그대로 보고 허용한다', function (t, done) {
    const security = freshSecurity(acpIpv6Loopback);
    const request = fakeRequest({}, '::1');
    // ty=='1' -> security_check_action_pvs. ctx_of_pvs 도 rawRemoteAddress 를 실어야 한다.
    security.check(request, {}, '1', ['/Mobius/eqv_acp'], '2', 'CCreator', function (code) {
        assert.strictEqual(code, '1',
            '원본의 _pvs ipv6 분기(bad4d4c:security.js:268)도 소켓 주소 원본을 비교한다');
        done();
    });
});

const acpIpv6Spoof = [{
    pv: JSON.stringify({ acr: [{ acor: ['CRequester'], acop: 63, acco: [{ acip: { ipv6: ['2001:db8::5'] } }] }] }),
    pvs: JSON.stringify({ acr: [{ acor: ['CRequester'], acop: 63, acco: [{ acip: { ipv6: ['2001:db8::5'] } }] }] })
}];

test('Critical 2: remoteaddress 헤더로는 ipv6 제약을 우회할 수 없다', function (t, done) {
    const security = freshSecurity(acpIpv6Spoof);
    // 클라이언트가 스스로 붙인 헤더. 실제 TCP 소스는 fakeRequest 기본값 203.0.113.9.
    const request = fakeRequest({ remoteaddress: '2001:db8::5' });
    security.check(request, {}, '2', ['/Mobius/eqv_acp'], '2', 'CCreator', function (code) {
        assert.strictEqual(code, '0',
            'ipv6 분기는 헤더를 보지 않는다 — 통과시키면 클라이언트가 스스로 권한을 올릴 수 있다');
        done();
    });
});

// ---------------------------------------------------------------------------
// Finding B: _pv 의 "acr 없는 행" 즉시 단락(short-circuit) 소실.
//
// acpi 행 0 은 acr 이 아예 없는 pv({})고, 요청자는 creator 가 아니다. 행 1 은
// 누구에게나(acor:'*') 전권을 주는 acr 을 가진다. 원본은 행 0 에서 즉시
// creator 검사로 응답하고 행 1 은 절대 보지 않으므로 거부해야 한다.
// 고정 전에는 security_check_action_pv 가 두 행을 모두 privList 에 밀어넣고
// evaluatePrivileges 를 한 번만 호출했다 — acr 없는 행은 (acp_eval.js 의
// `if (!priv || !priv.hasOwnProperty('acr')) { continue; }` 에 의해) 그냥
// 건너뛰어지고 행 1 이 매치되어 허용으로 뒤집혔다.
// ---------------------------------------------------------------------------

const acpForFindingB = [
    { pv: JSON.stringify({}) },
    { pv: JSON.stringify({ acr: [{ acor: ['*'], acop: 63 }] }) }
];

test('Finding B: _pv 는 acr 없는 첫 행에서 즉시 단락해 이후 행을 보지 않고 거부한다', function (t, done) {
    const security = freshSecurity(acpForFindingB);
    const request = fakeRequest();
    // cr(생성자)을 요청자와 다르게 줘서 creator 폴백도 거부로 떨어지게 한다.
    security.check(request, {}, '2', ['/Mobius/eqv_ae/c1'], '2', 'CCreator', function (code) {
        assert.strictEqual(code, '0',
            '행 0 에 acr 이 없으므로 creator 검사로 즉시 응답해야 하고, 행 1 의 전권 부여는 보면 안 된다');
        done();
    });
});

test('Finding B 대조군: acr 없는 행이 없으면 이후 행이 정상적으로 매치되어 허용된다', function (t, done) {
    const security = freshSecurity([acpForFindingB[1]]);
    const request = fakeRequest();
    security.check(request, {}, '2', ['/Mobius/eqv_ae/c1'], '2', 'CCreator', function (code) {
        assert.strictEqual(code, '1', 'acr 이 있는 행만 있으면 정상적으로 매치되어 허용되어야 한다');
        done();
    });
});
