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

// conf.json 읽기.
//
// **읽기 실패를 쓰기로 갚지 않는다.** 예전에는 try 하나로 "없음" 과 "깨짐" 을
// 같이 잡아, 어느 쪽이든 기본값 3개로 파일을 **덮어썼다.** 그래서 파싱이 한 번
// 실패하면 운영 설정이 통째로 날아갔다. 실측(관리 콘솔 세션):
//
//   원본 8개 (csebaseport dbpass adminPassword superUser acpObserveMode
//             acpiAttachPolicy db retentionPolicies)
//   반쪽 파일을 한 번 읽힌 뒤 -> 3개만 남음
//   dbpass 가 하드코딩 기본값으로 바뀌고, adminPassword 소실로 콘솔도 못 뜬다
//
// 도달 경로가 실재한다. 워커 25개가 각자 기동 때 이 파일을 읽는데, backstop 이
// 예외에서 워커를 죽이면 cluster 가 다시 띄운다. 그 순간 누군가 conf.json 을
// 제자리에서 쓰고 있으면 그 워커가 반쪽 JSON 을 읽는다.
//
// 이제 둘을 가른다.
//   파일이 없다   최초 실행이다. 기본값으로 만들어 준다.
//   파싱이 깨졌다 **건드리지 않는다.** 크게 남기고 기본값으로 진행한다 —
//                 사람이 파일을 고쳐 다시 띄울 수 있어야 한다.
var conf = {};
var DEFAULT_CONF = {
    csebaseport: "7579",
    dbpass: "dksdlfduq2",
    db: "mysql"
};

if (!fs.existsSync('conf.json')) {
    conf = JSON.parse(JSON.stringify(DEFAULT_CONF));
    fs.writeFileSync('conf.json', JSON.stringify(conf, null, 4), 'utf8');
    console.log('[conf] conf.json 이 없어 기본값으로 만들었다');
}
else {
    try {
        conf = JSON.parse(fs.readFileSync('conf.json', 'utf8'));
    }
    catch (e) {
        // 덮어쓰지 않는다. 여기서 쓰면 남의 설정을 지운다.
        conf = JSON.parse(JSON.stringify(DEFAULT_CONF));
        console.error('[conf] conf.json 을 읽지 못했다: ' + ((e && e.message) || e));
        console.error('[conf] **파일은 그대로 둔다.** 기본값으로 진행하지만 ' +
                      'dbpass 가 달라 DB 연결이 실패할 가능성이 높다. ' +
                      '파일을 고치고 다시 띄울 것.');
    }
}

// my CSE information
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usecsebaseport = conf.csebaseport;

// global.usedbhost / global.usedbpass 가 여기 있었다. **둘 다 지웠다.**
//
// 'localhost' 와 conf.dbpass 는 DB 연결 좌표다. 코어가 그것을 들고 app.js 가
// connect(host, 3306, 'root', pass, cb) 로 넘기는 구조였는데, 3306 도 'root' 도
// MySQL 의 것이라 코어가 백엔드를 아는 자리였다.
//
// 지금은 좌표를 어댑터가 갖는다 — 안 바뀌는 것(host/port/user/database)은
// mobius/db/mysql.js 의 상수로, conf.json 에서 오는 것(dbpass)은 그 어댑터의
// confSchema 로. 아래 213행의 db.applyConf(conf) 가 그것을 전달한다.
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

// 쓸 DB 를 **이름**으로 고른다. 어댑터는 mobius/db/<이름>.js 다.
//
//   node mobius.js postgres        인자로
//   conf.json 의 "db": "postgres"  설정으로
//
// 예전에는 usesqlite 라는 boolean 이었다. boolean 으로는 세 번째 백엔드를
// 말할 방법이 아예 없다 — 그래서 DB 를 하나 더 붙이려면 선택자부터 고쳐야 했다.
// 모르는 이름이면 파사드가 로그를 남기고 mysql 로 간다(mobius/db/index.js).
//
// **usesqlite 는 완전히 사라졌다.** 그 자리를 db 키가 대신한다.
// 옛 이름을 읽는 코드도, 번역하는 코드도, 남았는지 확인하는 코드도 없다.
// 설정 표(mobius/conf_schema.js)에도 없으므로 모르는 키로 걸린다.
global.usedb = process.argv[2] || conf.db || 'mysql';

// global.usesqlite 별칭이 여기 있었다. 지웠다.
//
// 파생값이라 usedb 와 어긋날 수는 없었지만, 그 값이 **존재한다는 사실 자체가**
// 새 코드를 잘못된 길로 이끌었다. 불리언 하나로 백엔드를 물을 수 있다는
// 인상을 주기 때문이다. 실제로 007 마이그레이션과 tools 두 개가 그 길로 갔다.
//
// boolean 은 백엔드를 둘까지만 말할 수 있다. usesqlite='false' 가 'mysql' 을
// 뜻하도록 되어 있었으니, 세 번째 백엔드로 도는 서버에서 그 값을 읽으면
// 무용지물이 아니라 **틀린 답**을 낸다. 그런 값은 남겨 두지 않는다.

// 컨테이너 경로별 기본 보관 정책 (선택). 형식은 mobius/cnt.js 상단 주석 참조.
// 정의하지 않으면 규칙 없이 Mobius 기본값이 쓰인다.
global.retention_policies = Array.isArray(conf.retentionPolicies) ? conf.retentionPolicies : [];

// 서버가 내보내는 요청(팬아웃·CSR 포워딩·알림 등)의 응답 대기 한도(ms).
// 지정하지 않으면 mobius/outbound.js 의 기본값(10초)을 쓴다.
// 이 값이 없으면 느린 상대 하나가 DB 풀 커넥션을 영구 점유한다.
global.outbound_timeout_ms = (typeof conf.outboundTimeoutMs === 'number' && conf.outboundTimeoutMs > 0)
    ? conf.outboundTimeoutMs : 0;

// 요청 본문의 최대 바이트. 넘으면 본문을 다 받기 전에 413 으로 끊는다.
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────
// 상한이 **하나도 없었다.** app.js 와 pxy_mqtt.js 에 bodyParser 로 5mb / 1mb 를
// 선언해 뒀지만, 둘 다 type 문자열이 어떤 MIME 과도 매칭되지 않아 죽어 있었다.
// 실측: 6MB 본문이 201 로 통과한다. 보내는 쪽이 원하는 만큼 워커 메모리를 쓴다.
//
// ── 기본값을 10MB 로 잡은 근거 ──────────────────────────────────────────
// 배포 DB 의 cin.con 을 키 공간 양끝에서 400만 행 표본했다:
//
//     뒤쪽 200만 행   평균 1,285 B   최대 4,058,640 B   5MB 초과 0건
//     앞쪽 200만 행   평균 6,889 B   최대 2,311,121 B   5MB 초과 0건
//
// 1MB 를 넘는 것은 전부 base64 JPEG 이었다(/Mobius/plat4_1/img 등).
// 최대 실측치가 4.06MB 라 원래 의도값이던 5MB 는 여유가 23% 뿐이다 —
// 그 컨테이너가 이미지를 계속 넣고 있어 조금만 커져도 걸린다. 2.5배를 둔다.
//
// con 컬럼은 MySQL 에서 longtext 라 DB 는 상한 역할을 못 한다. 여기가 유일한
// 방어선이다.
global.max_body_bytes = (typeof conf.maxBodyBytes === 'number' && conf.maxBodyBytes > 0)
    ? conf.maxBodyBytes : 10 * 1024 * 1024;

// 보조 포트도 conf 로 뺀다. csebaseport 만 옮겨서는 두 번째 인스턴스를 띄울 수
// 없다 — 이 다섯이 하드코딩이라 프록시가 EADDRINUSE 로 죽는다. 그러면 요청이
// 조용히 먼저 뜬 인스턴스로 가서, 고친 코드를 검증한다고 믿는 동안 남의
// 서버를 재고 있게 된다(실제로 겪었다). 기본값은 전부 지금 값 그대로다.
function port_of(v, dflt) {
    return (v === undefined || v === null || String(v) === '') ? dflt : String(v);
}

// global.usepxywsport / usepxymqttport 가 여기 있었다.
// 프로토콜 프록시와 함께 지웠다 — 읽는 곳이 pxy_ws/pxy_mqtt 뿐이었다.
// conf 키 pxyWsPort/pxyMqttPort 도 mobius/conf_schema.js 에서 함께 뺐다.
// **둘은 원자적으로 움직여야 한다** — test/conf-schema.test.js 가 양방향으로
// 강제해서, 한쪽만 지우면 실패한다.

// cntManPort 는 여기 있었다. 2019년의 cnt_man 은 그 포트에서 도는 별도 HTTP
// 마이크로서비스였는데, 그 코드는 오래전에 주석 처리됐고 자기 자신에게
// PUT /cnt 를 보내던 호출부도 제거됐다. 읽는 코드가 0건인 죽은 설정이었다.

// 보존 정책 스윕 주기(ms). 마스터에서만 도는 타이머다.
//
// 이 값이 곧 **"한도를 얼마나 넘겨도 되는가"** 다. 짧으면 초과가 줄고 스윕이
// 자주 돌지만, 찾는 질의가 배포 실측 13ms(cnt 30,284행)라 1초로 잡아도 부담이
// 없다. 예전 debounce 방식도 최대 10초를 허용했으므로 같은 수준에서 시작한다.
global.purge_sweep_ms = (typeof conf.purgeSweepMs === 'number' && conf.purgeSweepMs >= 1000)
    ? conf.purgeSweepMs : 10000;

// 주기 작업 래치가 굳었다고 볼 시간(ms). 0 이면 감시를 끈다.
//
// 재는 것은 **한 바퀴 길이가 아니라 마지막 진전으로부터의 시간**이다.
// 한 바퀴는 데이터에 달려 몇 시간이 될 수 있어 임계값을 정할 수 없다.
// 자세한 근거는 app.js 의 래치 감시 주석에 있다.
global.latchStaleMs = (typeof conf.latchStaleMs === 'number' && conf.latchStaleMs >= 0)
    ? conf.latchStaleMs : 900000;

// ── DB 커넥션 풀 ────────────────────────────────────────────────────────
//
// **기본값이 곧 권장값이다** — conf.json 이 없어도 이 값으로 뜬다.
// 관리 콘솔 설정 화면은 mobius/conf_schema.js 의 표를 읽어 그린다.
// **여기 기본값과 표의 dflt 는 반드시 같아야 한다** — 다르면 화면이 거짓말을
// 한다. test/conf-schema.test.js 가 그 둘을 대조한다(실제로 25/100 으로
// 갈라져 있던 것을 그 테스트가 잡았다).
//
// 풀은 **프로세스마다** 하나씩 생긴다. 배포는 워커 24 + 마스터 1 = 25 이므로
// 앱이 요구할 수 있는 총량은 dbConnectionLimit x 25 다. 25 면 625 이고
// 배포의 max_connections 800 안에 들어온다. 예전 값 100 은 2,500 이라
// 천장(당시 2,000)을 이미 넘고 있었다.
// (배포 실측 Max_used_connections = 59 — 실제로는 근처도 안 간다.)
global.use_db_connection_limit =
    (typeof conf.dbConnectionLimit === 'number' && conf.dbConnectionLimit >= 1)
        ? conf.dbConnectionLimit : 25;

// 풀이 가득 찼을 때 대기열에 몇 개까지 쌓을 것인가.
//
// **0 은 "무제한" 이다 — 그리고 그 큐에는 타임아웃이 없다.**
// 드라이버가 `if (queueLimit && 대기수 >= queueLimit)` 로 검사하므로 0 은
// falsy 가 되어 한도 분기를 통째로 건너뛴다. 그래서 풀이 마르면 요청이
// **응답도 에러도 없이 영원히 매달린다** — 워커도 죽지 않아 cluster 재기동도
// 안 걸린다.
//
// 유한값으로 두면 드라이버가 즉시 거절하고, 그 에러가
// mobius/db/mysql.js 의 getConnection 을 지나 500-5 로 나간다. 관측 불가능한
// 매달림이 관측 가능한 실패로 바뀐다.
//
// mysql2 로 옮기면서 실측했다 — 거절은 그대로인데 **에러의 code 가 없어졌다.**
//     mysql   code="POOL_ENQUEUELIMIT"  msg="Queue limit reached."
//     mysql2  code=undefined            msg="Queue limit reached."
// getConnection 이 code 를 안 보고 무조건 500-5 를 내므로 동작은 같다.
// 다만 code 문자열로 이 상황을 가려내려 하면 안 된다.
global.use_db_queue_limit =
    (typeof conf.dbQueueLimit === 'number' && conf.dbQueueLimit >= 0)
        ? conf.dbQueueLimit : 50;

// ── SQLite ──────────────────────────────────────────────────────────────
//
// MySQL 의 네 값에 대응하는 것은 둘뿐이다. binlog 가 없어 sync_binlog 에
// 대응이 없고, SQLite 는 언제나 직렬화라 격리수준을 고를 일이 없다.
//
// 백엔드 고유 설정은 **어댑터가 읽는다.**
//
// 여기 global.use_sqlite_journal_mode / _synchronous / _busy_timeout_ms 세 줄이
// 있었다. 코어가 SQLite 전용 키 이름을 아는 자리였고, 설정 표
// (mobius/conf_schema.js)도 같은 세 키를 직접 들고 있었다. 그래서 튜닝 값을
// 갖는 세 번째 백엔드를 붙이려면 코어 두 파일을 열어야 했다 —
// "mobius/db/<이름>.js 파일 하나를 두면 붙는다" 가 거기서 깨졌다.
//
// 지금은 conf 를 통째로 넘기고, **어느 키를 읽을지는 어댑터가 정한다.**
// 코어는 키 이름을 하나도 모른다.
require('./mobius/db').applyConf(conf);

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

// global.wdt = require('./wdt') 가 여기 있었다. wdt.js 는 2026-09-04 에
// 프로토콜 프록시와 함께 지웠다 — set_wdt 등록자 4개가 전부 그 셋 안이었다.
// 주기 작업이 필요하면 setInterval 을 직접 쓴다(mobius/lease.js 가 그렇게 한다).


global.allowed_ae_ids = [];
//allowed_ae_ids.push('ryeubi');

global.allowed_app_ids = [];
//allowed_app_ids.push('APP01');


global.uservi = '2a';


// CSE core
require('./app');
