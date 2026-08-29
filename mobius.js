/**
 * Copyright (c) 2018, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var fs = require('fs');

var conf = {};
try {
    conf = JSON.parse(fs.readFileSync('conf.json', 'utf8'));
}
catch (e) {
    conf.csebaseport = "7579";
    conf.dbpass = "dksdlfduq2";
    conf.usesqlite = "false";
    fs.writeFileSync('conf.json', JSON.stringify(conf, null, 4), 'utf8');
}

global.defaultbodytype = 'json';

// my CSE information
global.usecsetype = 'in'; // select 'in' or 'mn' or asn'
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usecsebaseport = conf.csebaseport;

global.usedbhost = 'localhost';
global.usedbpass = conf.dbpass;

// 이 값을 X-M2M-Origin 에 넣으면 security.check 가 맨 앞에서 통과시켜
// 모든 ACP 검사를 건너뛴다. 사실상 마스터 키다.
//
// 예전에는 app.js 에 'Sponde' 로 박혀 있었다. 공개 저장소의 코드에 적혀
// 있으면 아는 사람은 누구나 쓸 수 있다는 뜻이라 설정으로 뺀다.
//
// 기본값은 바꾸지 않았다 — 값을 바꾸면 이 계정으로 도는 기존 운영 도구가
// 곧바로 403 을 받는다. 배포에서 실제로 바꿀 때는 그 도구들을 함께 옮겨야 한다.
// conf.json 에 "superUser": "..." 를 넣으면 그 값이 쓰인다.
global.usesuperuser = (typeof conf.superUser === 'string' && conf.superUser !== '')
    ? conf.superUser : 'Sponde';

if (process.argv[2] === 'sqlite') {
    global.usesqlite = 'true';
}
else if (process.argv[2] === 'mysql') {
    global.usesqlite = 'false';
}
else {
    global.usesqlite = conf.usesqlite;
}

// 컨테이너 경로별 기본 보관 정책 (선택). 형식은 mobius/cnt.js 상단 주석 참조.
// 정의하지 않으면 규칙 없이 Mobius 기본값이 쓰인다.
global.retention_policies = Array.isArray(conf.retentionPolicies) ? conf.retentionPolicies : [];

// 서버가 내보내는 요청(팬아웃·CSR 포워딩·알림 등)의 응답 대기 한도(ms).
// 지정하지 않으면 mobius/outbound.js 의 기본값(10초)을 쓴다.
// 이 값이 없으면 느린 상대 하나가 DB 풀 커넥션을 영구 점유한다.
global.outbound_timeout_ms = (typeof conf.outboundTimeoutMs === 'number' && conf.outboundTimeoutMs > 0)
    ? conf.outboundTimeoutMs : 0;

// 보조 포트도 conf 로 뺀다. csebaseport 만 옮겨서는 두 번째 인스턴스를 띄울 수
// 없다 — 이 다섯이 하드코딩이라 프록시가 EADDRINUSE 로 죽는다. 그러면 요청이
// 조용히 먼저 뜬 인스턴스로 가서, 고친 코드를 검증한다고 믿는 동안 남의
// 서버를 재고 있게 된다(실제로 겪었다). 기본값은 전부 지금 값 그대로다.
function port_of(v, dflt) {
    return (v === undefined || v === null || String(v) === '') ? dflt : String(v);
}

global.usepxywsport = port_of(conf.pxyWsPort, '7577');
global.usepxymqttport = port_of(conf.pxyMqttPort, '7578');

global.use_sgn_man_port = port_of(conf.sgnManPort, '7599');
global.use_cnt_man_port = port_of(conf.cntManPort, '7583');
global.use_hit_man_port = port_of(conf.hitManPort, '7594');

global.use_mqtt_broker = 'localhost'; // mqttbroker for mobius

global.use_secure = 'disable';
global.use_mqtt_port = '1883';
if (use_secure === 'enable') {
    use_mqtt_port = '8883';
}

// 이름과 달리 "ACP 를 쓰느냐" 가 아니라 **acpi 가 없는 리소스의 기본 정책**이다.
//   'disable' (지금 / 운영 대원칙) — 생성·조회·탐색은 누구나, 수정·삭제는 생성자만
//   'enable'                       — 전부 생성자만
// 대원칙대로면 'disable' 이 정답이라 바꿀 일이 없다. conf 로 빼되 기본값은 그대로.
global.useaccesscontrolpolicy = conf.defaultAccessPolicy || 'disable';

// ACP 관측. 기본값은 전부 현재 동작과 같다 — 늘어나는 것은 로그 줄뿐이다.
//   acpObserveMode 'observe' 로 켜면 **거부가 허용으로 나간다.** 잠그기 전에
//   무엇이 막힐지 하루쯤 보고 끄기 위한 것이고, 켠 채로 두면 ACP 가 무력해진다.
global.acp_observe_mode = conf.acpObserveMode || 'off';
require('./mobius/acp_observe').configure({
    mode: global.acp_observe_mode,
    denyLog: conf.acpDenyLog || 'sample',
    rate: (typeof conf.acpDenyLogRate === 'number') ? conf.acpDenyLogRate : 5
});
if (global.acp_observe_mode === 'observe') {
    console.log('[acp] 관찰 모드다 — ACP 거부가 허용으로 나간다. 확인이 끝나면 반드시 끈다.');
}

// ACP 가 안 걸린 리소스에 누가 처음 acpi 를 붙일 수 있는가.
//   'open'    (기본 / 현재 동작) 인증된 아무나. 붙는 순간 잠기고 로그만 남는다
//   'creator' 그 리소스의 생성자와 수퍼유저만
// 지금 바로 'creator' 로 켜면 acpi 를 붙이던 정상 요청이 거부되기 시작한다.
// acpi_attach 로그를 하루 본 뒤에 정한다.
global.acpi_attach_policy = (conf.acpiAttachPolicy === 'creator') ? 'creator' : 'open';

// ACP·acpi 변경 이력(acp_audit 테이블). acp 에 cr 컬럼이 없어 "누가 만들었는가"
// 를 답할 다른 근거가 없다. 마이그레이션 007 전에는 insert 가 실패하지만
// best-effort 라 요청은 정상 처리된다.
global.acp_audit = (conf.acpAudit === 'off') ? 'off' : 'on';

// discovery 결과를 리소스별 ACP 로 거를 것인가.
//
// 켜는 것이 기본이다 — 안 거르면 잠근 컨테이너의 **경로가 상위 탐색 결과에
// 그대로 나온다**(이름·구조·CIN 개수·생성 시각). 관리자는 잠갔다고 생각하는데
// 아니다. 배포에 acpi 가 채워진 리소스는 2개뿐이라 켜도 결과가 바뀌는 요청이
// 사실상 없다. 문제가 생기면 'off' 로 되돌린다.
global.acp_discovery_filter = (conf.acpDiscoveryFilter === 'off') ? 'off' : 'on';

global.wdt = require('./wdt');


global.allowed_ae_ids = [];
//allowed_ae_ids.push('ryeubi');

global.allowed_app_ids = [];
//allowed_app_ids.push('APP01');

global.usesemanticbroker = '10.10.202.114';

global.uservi = '2a';


// CSE core
require('./app');
