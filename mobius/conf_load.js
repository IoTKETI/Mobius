'use strict';
/**
 * conf.json 을 읽어 global.* 을 세운다. mobius.js 에서 떼어 냈다.
 *
 * 왜 떼어 냈나 — mobius.js 의 마지막 줄이 require('./app') 이고, app.js 는
 * 로드만으로 DB 에 붙고 CPU 코어 수만큼 fork 하고 포트를 연다. 그래서
 * "빈 conf 로도 지금 동작이 그대로다" 를 시험할 방법이 없었다.
 *
 * 계약
 *   conf_load(opts, callback)     opts 는 생략할 수 있다
 *     opts.file    읽을 conf.json 경로. 기본은 **저장소 루트**의 conf.json 이다 —
 *                  cwd 가 아니다. admin/server.js 와 CLI 가 루트 기준이므로
 *                  셋을 같게 맞춘다.
 *   callback(err, applied)
 *     applied      conf 키 → 방금 전역에 심은 값. 부팅 기록이 쓴다.
 *                  코어가 전역을 세우는 키만 담는다 — 어댑터 키·콘솔 키는 없다.
 *
 * **어떤 경로에서도 process.exit 을 하지 않는다.** 실패는 callback(err) 로
 * 돌려주고 종료는 mobius.js 가 한다 — 모듈이 exit 하면 평면 글롭으로 도는
 * 시험 파일이 통째로 죽는다.
 *
 * **이 머리말을 늘리지 않는다.** test/usesqlite-single-reader.test.js 가 아래
 * DEFAULT_CONF 와 select_backend 의 줄 번호를 허용 목록으로 든다. 설명은 아래에 더한다.
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DEFAULT_FILE = path.join(ROOT, 'conf.json');

// 기본 경로에 파일이 없을 때 만들어 주는 최소 conf. 파싱이 깨졌을 때도
// 이 값으로 진행한다 — 파일은 건드리지 않는다(아래 read_conf 참고).
var DEFAULT_CONF = {
    csebaseport: "7579",
    dbpass: "dksdlfduq2",
    db: "mysql"
};

// 문자열 포트 값. 비어 있으면 기본값.
function port_of(v, dflt) {
    return (v === undefined || v === null || String(v) === '') ? dflt : String(v);
}

// 백엔드 선택자를 세우는 **유일한** 곳. 어댑터는 mobius/db/<이름>.js 다.
//   node mobius.js postgres        인자로
//   conf.json 의 "db": "postgres"  설정으로
// 모르는 이름이면 파사드가 로그를 남기고 mysql 로 간다(mobius/db/index.js).
// usesqlite 는 완전히 사라졌다 — 그 자리를 db 키가 대신한다.
//
// **conf_schema 를 require 하는 어떤 코드보다 앞이어야 한다.** 그 표가
// require 시점에 고른 백엔드의 키를 합치고, 파사드가 그 선택을 캐시한다.
function select_backend(conf) {
    var usedb = process.argv[2] || conf.db || 'mysql';
    global.usedb = usedb;
    return usedb;
}

// 전역을 세운다. **세우면서 같은 자리에서 applied 에 쌓는다** — 대응표를
// 따로 두지 않는다. conf 키와 전역 이름은 규칙 변환으로 못 만들고
// (maxBodyBytes → max_body_bytes, csebaseport → usecsebaseport), 손 목록은
// 새 키가 빠졌을 때 undefined 를 기록해 그 키가 영구히 "재기동 대기" 로 뜬다.
//
// 기본값을 쓰는 모양은 셋 중 하나여야 한다 — test/conf-schema.test.js 가 그
// 모양으로 표의 dflt 와 대조한다. 다른 모양이면 대조가 조용히 건너뛰어진다.
//     ? conf.K : 리터럴;     conf.K || 리터럴;     함수(conf.K, 리터럴)
function apply_conf(conf) {
    var applied = {};
    applied.db = select_backend(conf);

    // ── CSE 신원 ─────────────────────────────────────────────────────
    // 예전에는 여기(usecsebase·usecseid·uservi)와 app.js(usespid)에 박혀 있었다.
    // 바꾸면 무슨 일이 나는지는 mobius/conf_schema.js 의 gateWarn 에 있다.
    global.usecsebase = conf.cseBase || 'Mobius';
    applied.cseBase = global.usecsebase;
    global.usecseid = conf.cseId || '/Mobius2';
    applied.cseId = global.usecseid;
    global.usespid = conf.spId || '//keti.re.kr';
    applied.spId = global.usespid;
    // 유효값(1/2/2a)은 표가 저장 때 막는다. 손으로 고친 파일의 이상한 값은 그대로 헤더에 실린다.
    global.uservi = conf.releaseVersion || '2a';
    applied.releaseVersion = global.uservi;
    // 예전에는 conf.csebaseport 를 그대로 심어 파일에 키가 없으면 undefined 였다
    // (listen 이 임의 포트를 잡는다). 표의 dflt 와 같은 7579 로 떨어뜨린다.
    global.usecsebaseport = port_of(conf.csebaseport, '7579');
    applied.csebaseport = global.usecsebaseport;

    // 이 값을 X-M2M-Origin 에 넣으면 security.check 가 맨 앞에서 통과시켜
    // 모든 ACP 검사를 건너뛴다. 사실상 마스터 키다. 기본값은 바꾸지 않았다 —
    // 바꾸면 이 계정으로 도는 기존 운영 도구가 곧바로 403 을 받는다.
    global.usesuperuser = (typeof conf.superUser === 'string' && conf.superUser !== '')
        ? conf.superUser : 'Sponde';
    applied.superUser = global.usesuperuser;

    // 컨테이너 경로별 기본 보관 정책 (선택). 형식은 mobius/cnt.js 상단 주석 참조.
    global.retention_policies = Array.isArray(conf.retentionPolicies) ? conf.retentionPolicies : [];
    applied.retentionPolicies = global.retention_policies;

    // 서버가 내보내는 요청(팬아웃·CSR 포워딩·알림 등)의 응답 대기 한도(ms).
    // 지정하지 않으면 mobius/outbound.js 의 기본값(10초)을 쓴다.
    global.outbound_timeout_ms = (typeof conf.outboundTimeoutMs === 'number' && conf.outboundTimeoutMs > 0)
        ? conf.outboundTimeoutMs : 0;
    applied.outboundTimeoutMs = global.outbound_timeout_ms;

    // 요청 본문의 최대 바이트. 넘으면 본문을 다 받기 전에 413 으로 끊는다.
    // 10MB 의 근거(배포 실측 최대 본문 4.06MB 의 2.5배)는 mobius/conf_schema.js 의 help 에.
    global.max_body_bytes = (typeof conf.maxBodyBytes === 'number' && conf.maxBodyBytes > 0)
        ? conf.maxBodyBytes : 10 * 1024 * 1024;
    applied.maxBodyBytes = global.max_body_bytes;

    // use_sgn_man_port(7599) / use_hit_man_port(7594) 가 여기 있었다. 읽는 코드가 0건이라 지웠다.

    // 보존 정책 스윕 주기(ms). 마스터에서만 도는 타이머다.
    global.purge_sweep_ms = (typeof conf.purgeSweepMs === 'number' && conf.purgeSweepMs >= 1000)
        ? conf.purgeSweepMs : 10000;
    applied.purgeSweepMs = global.purge_sweep_ms;

    // 주기 작업 래치가 굳었다고 볼 시간(ms). 0 이면 감시를 끈다.
    global.latchStaleMs = (typeof conf.latchStaleMs === 'number' && conf.latchStaleMs >= 0)
        ? conf.latchStaleMs : 900000;
    applied.latchStaleMs = global.latchStaleMs;

    // ── DB 커넥션 풀 ────────────────────────────────────────────────────
    // 풀은 프로세스마다 하나다. 배포는 워커 24 + 마스터 1 = 25 이므로 총량은
    // dbConnectionLimit x 25 다. 25 면 625 로 max_connections 800 안에 든다.
    global.use_db_connection_limit =
        (typeof conf.dbConnectionLimit === 'number' && conf.dbConnectionLimit >= 1)
            ? conf.dbConnectionLimit : 25;
    applied.dbConnectionLimit = global.use_db_connection_limit;

    // 0 은 "무제한" 이고 그 큐에는 타임아웃이 없다 — 풀이 마르면 요청이
    // 응답도 에러도 없이 영원히 매달린다. 유한값이면 드라이버가 즉시 거절한다.
    global.use_db_queue_limit =
        (typeof conf.dbQueueLimit === 'number' && conf.dbQueueLimit >= 0)
            ? conf.dbQueueLimit : 50;
    applied.dbQueueLimit = global.use_db_queue_limit;

    // 백엔드 고유 설정은 **어댑터가 읽는다.** conf 를 통째로 넘기고 어느 키를
    // 볼지는 어댑터가 정한다. 코어는 키 이름을 하나도 모른다.
    require('./db').applyConf(conf);

    // ── 네트워크 ─────────────────────────────────────────────────────
    global.use_mqtt_broker = conf.mqttBroker || 'localhost';
    applied.mqttBroker = global.use_mqtt_broker;
    // 'enable' 이 아닌 어떤 값도 disable 이다 — 파일의 오타로 HTTPS 분기에 들어가
    // 인증서를 찾다 죽는 일이 없게. (표의 dflt 대조가 이 모양은 못 본다 — acpiAttachPolicy 와 같다)
    global.use_secure = (conf.useSecure === 'enable') ? 'enable' : 'disable';
    applied.useSecure = global.use_secure;
    global.use_mqtt_port = port_of(conf.mqttPort, '1883');
    if (global.use_secure === 'enable') {
        // 예전에는 global. 접두 없는 암묵 전역 대입이었다. 명시한다.
        global.use_mqtt_port = '8883';
    }
    applied.mqttPort = global.use_mqtt_port;   // enable 이면 유도값 8883 이 기록된다 — CLI 는 "유도됨" 으로 보인다

    // 이름과 달리 "ACP 를 쓰느냐" 가 아니라 **acpi 가 없는 리소스의 기본 정책**이다.
    global.useaccesscontrolpolicy = conf.defaultAccessPolicy || 'disable';
    applied.defaultAccessPolicy = global.useaccesscontrolpolicy;

    // ACP 관측. acpObserveMode 'observe' 로 켜면 **거부가 허용으로 나간다.**
    global.acp_observe_mode = conf.acpObserveMode || 'off';
    applied.acpObserveMode = global.acp_observe_mode;
    // 변수로 뺐다 — 객체 리터럴 안에 있으면 표의 dflt 대조가 이 둘을 못 본다.
    var deny_log = conf.acpDenyLog || 'sample';
    var deny_rate = (typeof conf.acpDenyLogRate === 'number') ? conf.acpDenyLogRate : 5;
    applied.acpDenyLog = deny_log;
    applied.acpDenyLogRate = deny_rate;
    require('./acp_observe').configure({
        mode: global.acp_observe_mode,
        denyLog: deny_log,
        rate: deny_rate
    });
    if (global.acp_observe_mode === 'observe') {
        console.log('[acp] 관찰 모드다 — ACP 거부가 허용으로 나간다. 확인이 끝나면 반드시 끈다.');
    }

    // ACP 가 안 걸린 리소스에 누가 처음 acpi 를 붙일 수 있는가.
    global.acpi_attach_policy = (conf.acpiAttachPolicy === 'creator') ? 'creator' : 'open';
    applied.acpiAttachPolicy = global.acpi_attach_policy;

    // ACP·acpi 변경 이력(acp_audit 테이블).
    global.acp_audit = (conf.acpAudit === 'off') ? 'off' : 'on';
    applied.acpAudit = global.acp_audit;

    // discovery 결과를 리소스별 ACP 로 거를 것인가. 안 거르면 잠근 컨테이너의
    // 경로가 상위 탐색 결과에 그대로 나온다.
    global.acp_discovery_filter = (conf.acpDiscoveryFilter === 'off') ? 'off' : 'on';
    applied.acpDiscoveryFilter = global.acp_discovery_filter;

    // ── 접근 제한 ─────────────────────────────────────────────────────
    // 비면 전원 허용. 채우면 목록 밖 전부 403-1 (app.js 의 검사).
    global.allowed_ae_ids = Array.isArray(conf.allowedAeIds) ? conf.allowedAeIds : [];
    applied.allowedAeIds = global.allowed_ae_ids;
    global.allowed_app_ids = Array.isArray(conf.allowedAppIds) ? conf.allowedAppIds : [];
    applied.allowedAppIds = global.allowed_app_ids;

    return applied;
}

// conf.json 읽기.
//
// **읽기 실패를 쓰기로 갚지 않는다.** 예전에는 try 하나로 "없음" 과 "깨짐" 을
// 같이 잡아, 어느 쪽이든 기본값 3개로 파일을 **덮어썼다.** 실측(관리 콘솔 세션):
// 원본 8개 키가 반쪽 파일을 한 번 읽힌 뒤 3개만 남았고, dbpass 가 하드코딩
// 기본값으로 바뀌고 adminPassword 소실로 콘솔도 못 떴다.
//
// 도달 경로가 실재한다. 워커 25개가 각자 기동 때 이 파일을 읽는데, backstop 이
// 예외에서 워커를 죽이면 cluster 가 다시 띄운다. 그 순간 누군가 conf.json 을
// 제자리에서 쓰고 있으면 그 워커가 반쪽 JSON 을 읽는다.
//
//   파일이 없다   기본 경로면 최초 실행이다 — 기본값으로 만들어 준다.
//                 opts.file 이 주어졌으면 만들지 않고 오류다.
//   파싱이 깨졌다 **건드리지 않는다.** 크게 남기고 기본값으로 진행한다.
function read_conf(file, is_default_path, callback) {
    var conf;
    if (!fs.existsSync(file)) {
        if (!is_default_path) {
            return callback(new Error('[설정] conf.json 이 없다: ' + file));
        }
        conf = JSON.parse(JSON.stringify(DEFAULT_CONF));
        fs.writeFileSync(file, JSON.stringify(conf, null, 4), 'utf8');
        console.log('[conf] conf.json 이 없어 기본값으로 만들었다: ' + file);
        return callback(null, conf);
    }
    try {
        conf = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (e) {
        // 덮어쓰지 않는다. 여기서 쓰면 남의 설정을 지운다.
        conf = JSON.parse(JSON.stringify(DEFAULT_CONF));
        console.error('[conf] conf.json 을 읽지 못했다: ' + ((e && e.message) || e));
        console.error('[conf] **파일은 그대로 둔다.** 기본값으로 진행하지만 ' +
                      'dbpass 가 달라 DB 연결이 실패할 가능성이 높다. ' +
                      '파일을 고치고 다시 띄울 것.');
    }
    callback(null, conf);
}

module.exports = function conf_load(opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    opts = opts || {};
    var file = opts.file || DEFAULT_FILE;
    var is_default_path = !opts.file;

    read_conf(file, is_default_path, function (err, conf) {
        if (err) { return callback(err); }
        var applied;
        try {
            applied = apply_conf(conf);
        }
        catch (e) {
            return callback(e);
        }
        callback(null, applied);
    });
};

module.exports.DEFAULT_FILE = DEFAULT_FILE;
