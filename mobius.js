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
    usesqlite: "false"
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

// 쓸 DB 를 **이름**으로 고른다. 어댑터는 mobius/db/<이름>.js 다.
//
//   node mobius.js postgres        인자로
//   conf.json 의 "db": "postgres"  설정으로
//
// 예전에는 usesqlite 라는 boolean 이었다. boolean 으로는 세 번째 백엔드를
// 말할 방법이 아예 없다 — 그래서 DB 를 하나 더 붙이려면 선택자부터 고쳐야 했다.
// 모르는 이름이면 파사드가 로그를 남기고 mysql 로 간다(mobius/db/index.js).
global.usedb = process.argv[2] || conf.db ||
    ((conf.usesqlite === 'true' || conf.usesqlite === true) ? 'sqlite' : 'mysql');

// **한시적 별칭.** 아직 usesqlite 를 직접 읽는 곳이 코어에 두 군데 남아 있다 —
// cnt_man 의 카운터 갱신과 sql_action 의 delete_oldest. 둘 다 **진짜로 백엔드마다
// 동작이 다른 곳**이라 없앨 것이 아니라 어댑터 메서드로 옮길 것이다. 그러면
// 코어에는 분기가 없고 각 어댑터가 자기 방식대로 구현한다.
// 그때 이 줄을 지운다 — test/usesqlite-single-reader.test.js 가 남은 수를 센다.
//
// 파생값이라 usedb 와 어긋날 수 없다. 진실원은 usedb 하나다.
global.usesqlite = (global.usedb === 'sqlite') ? 'true' : 'false';

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

global.usepxywsport = port_of(conf.pxyWsPort, '7577');
global.usepxymqttport = port_of(conf.pxyMqttPort, '7578');

global.use_sgn_man_port = port_of(conf.sgnManPort, '7599');
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
global.use_hit_man_port = port_of(conf.hitManPort, '7594');

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
// node_modules/mysql/lib/Pool.js:222 가 `if (this.config.queueLimit && ...)`
// 로 검사하므로 0 은 falsy 가 되어 한도 분기를 통째로 건너뛰고,
// acquireTimeout 은 Pool.js 의 connect/changeUser/ping 에만 걸려 큐 대기에는
// 관여하지 않는다. 그래서 풀이 마르면 요청이 **응답도 에러도 없이 영원히
// 매달린다** — 워커도 죽지 않아 cluster 재기동도 안 걸린다.
//
// 유한값으로 두면 드라이버가 POOL_ENQUEUELIMIT 를 즉시 던지고 그 에러가
// mobius/db/mysql.js 의 getConnection 을 지나 500-5 로 나간다. 관측 불가능한
// 매달림이 관측 가능한 실패로 바뀐다.
global.use_db_queue_limit =
    (typeof conf.dbQueueLimit === 'number' && conf.dbQueueLimit >= 0)
        ? conf.dbQueueLimit : 50;

// ── SQLite ──────────────────────────────────────────────────────────────
//
// MySQL 의 네 값에 대응하는 것은 둘뿐이다. binlog 가 없어 sync_binlog 에
// 대응이 없고, SQLite 는 언제나 직렬화라 격리수준을 고를 일이 없다.
//
// journal_mode 는 MySQL 에 대응이 없지만 여기서 가장 중요하다 — 기본값인
// rollback journal 은 쓰는 동안 읽는 쪽을 전부 막는다. 워커를 코어 수만큼
// 포크하므로 한 파일을 여러 프로세스가 연다. WAL 이면 읽기와 쓰기가 서로를
// 막지 않는다. **DB 파일에 영속되므로 이미 만든 파일은 매 기동 다시 건다.**
global.use_sqlite_journal_mode = conf.sqliteJournalMode || 'WAL';

// FULL 은 innodb_flush_log_at_trx_commit = 1 과 같은 판단이다.
global.use_sqlite_synchronous = conf.sqliteSynchronous || 'FULL';

// 잠긴 동안 얼마나 기다리나. MySQL 의 커넥션 대기에 해당한다.
global.use_sqlite_busy_timeout_ms =
    (typeof conf.sqliteBusyTimeoutMs === 'number' && conf.sqliteBusyTimeoutMs >= 0)
        ? conf.sqliteBusyTimeoutMs : 50000;

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


global.uservi = '2a';


// CSE core
require('./app');
