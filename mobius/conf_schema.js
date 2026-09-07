'use strict';
// Configuration table for conf.json: the single source of truth for which keys exist, their types, valid values, defaults, when they take effect, labels and help. The CLI renders describe() as is; test/conf-schema.test.js checks the table against the keys the code actually reads.
//
// apply: when a change takes effect
//   'runtime'  the global is read on every request
//   'reload'   the module caches the value; its reload function (reloadWith) must be called
//   'restart'  read once at boot
//
// Each worker reads the file on its own start, so after a worker respawn the applied value can differ between workers.

// Value validation: valid is either an array of allowed values or a function. Values decided at runtime (the backend list for db) use a function.
var SCHEMA = {
    // Exposed: operational policy
    acpObserveMode: {
        group: '권한',
        type: 'enum', valid: ['off', 'observe'], dflt: 'off',
        apply: 'reload', reloadWith: 'acp_observe.configure',
        label: 'ACP 관찰 모드',
        help: 'observe 로 두면 **ACP 거부가 허용으로 나간다.** 잠그기 전에 무엇이 ' +
              '막힐지 보기 위한 것이고, 켠 채로 두면 ACP 가 무력해진다.'
    },
    acpDenyLog: {
        group: '권한',
        type: 'enum', valid: ['off', 'sample', 'all'], dflt: 'sample',
        apply: 'reload', reloadWith: 'acp_observe.configure',
        label: 'ACP 거부 로그',
        help: 'all 은 거부마다 한 줄이다. 거부가 많으면 로그가 밀린다.'
    },
    acpDenyLogRate: {
        group: '권한',
        type: 'number', min: 0, integer: true, dflt: 5,
        apply: 'reload', reloadWith: 'acp_observe.configure',
        label: 'ACP 거부 로그 초당 상한',
        help: "acpDenyLog 가 'sample' 일 때만 쓴다."
    },
    acpiAttachPolicy: {
        group: '권한',
        type: 'enum', valid: ['open', 'creator'], dflt: 'open',
        apply: 'runtime',
        label: 'acpi 최초 부착 권한',
        help: 'ACP 가 안 걸린 리소스에 누가 처음 acpi 를 붙일 수 있는가. ' +
              "creator 로 바꾸면 acpi 를 붙이던 정상 요청이 거부되기 시작한다."
    },
    acpAudit: {
        group: '권한',
        type: 'enum', valid: ['on', 'off'], dflt: 'on',
        apply: 'runtime',
        label: 'ACP 변경 이력',
        help: 'acp 테이블에 cr 컬럼이 없어 "누가 만들었는가" 를 답할 다른 근거가 없다.'
    },
    acpDiscoveryFilter: {
        group: '권한',
        type: 'enum', valid: ['on', 'off'], dflt: 'on',
        apply: 'runtime',
        label: 'discovery ACP 필터',
        help: '끄면 잠근 컨테이너의 **경로가 상위 탐색 결과에 그대로 나온다** ' +
              '(이름·구조·CIN 개수·생성 시각). 관리자는 잠갔다고 생각하는데 아니다.'
    },
    defaultAccessPolicy: {
        group: '권한',
        type: 'enum', valid: ['disable', 'enable'], dflt: 'disable',
        apply: 'runtime',
        label: 'acpi 없는 리소스의 기본 정책',
        help: "이름과 달리 'ACP 를 쓰느냐' 가 아니다. disable = 생성·조회·탐색은 " +
              '누구나 / 수정·삭제는 생성자만. enable = 전부 생성자만.'
    },
    purgeSweepMs: {
        group: '저장소',
        type: 'number', integer: true, dflt: 10000,
        // Below 1 second is rejected.
        valid: function (v) { return v >= 1000; },
        validHint: '1000 이상 (ms)',
        apply: 'restart',
        label: '보존 정책 스윕 주기(ms)',
        help: '이 값이 곧 **한도를 얼마나 넘겨도 되는가** 다. mni/mbs 를 넘긴 ' +
              '컨테이너를 찾아 오래된 자식을 지우는 주기이고, 마스터에서만 돈다. ' +
              '찾는 질의는 배포 실측 13ms(컨테이너 30,284개 전수)라 짧게 잡아도 ' +
              '부담이 없다.'
    },
    latchStaleMs: {
        group: '저장소',
        type: 'number', integer: true, dflt: 900000,
        // 0 disables the check; negative values are typos.
        valid: function (v) { return v >= 0; },
        validHint: '0 이상 (ms). 0 이면 감시를 끈다',
        apply: 'runtime',
        label: '주기 작업 래치 정지 경고 임계(ms)',
        help: '마스터의 주기 작업 둘(보존 정책 스윕 · 카운터 정합)이 이 시간 동안 ' +
              '**진전이 없으면** 로그로 알린다. 재는 것은 한 바퀴 길이가 아니라 ' +
              '마지막 진전으로부터의 시간이다 — 한 바퀴는 데이터에 달려 몇 시간이 ' +
              '될 수 있어 임계값을 정할 수 없기 때문이다. 정상 진전 간격은 정합 ' +
              '쪽이 조각 30초 + 마지막 집계 5초 + 대기 60초 = 약 100초, 스윕 쪽은 ' +
              '컨테이너 하나 단위라 그보다 짧다. 기본 15분은 9배 여유다. ' +
              '**경고만 하고 래치를 풀지는 않는다** — 풀어도 이미 도는 흐름은 안 ' +
              '멈추고, 두 흐름이 겹치면 한도 밑으로 CIN 이 지워지거나(FK CASCADE 라 ' +
              '복구 불가) 커서 구간이 무음으로 건너뛰어진다. 경고가 나오면 마스터를 ' +
              '다시 띄운다. **읽는 것은 클러스터 마스터뿐이다** — 마스터는 워커와 ' +
              '달리 되살아나지 않으므로, 값을 바꾸면 Mobius 프로세스를 다시 띄워야 ' +
              '실제로 먹는다.'
    },
    outboundTimeoutMs: {
        group: '요청 처리',
        type: 'number', dflt: 0,
        // 0 means unset (the default in mobius/outbound.js, 10 s); otherwise a lower bound applies.
        valid: function (v) { return v === 0 || v >= 3000; },
        validHint: '0(기본값 사용) 이거나 3000 이상',
        apply: 'restart',
        label: '나가는 요청 응답 대기 한도(ms)',
        help: '알림·팬아웃·CSR 포워딩이 상대를 기다리는 한도. 이 값이 없으면 ' +
              '느린 상대 하나가 DB 풀 커넥션을 영구 점유한다.'
    },
    maxBodyBytes: {
        group: '요청 처리',
        // A byte count, so it must be an integer; the UI converts from MB.
        type: 'number', integer: true, dflt: 10 * 1024 * 1024,
        // Lower bound 4 MB, upper bound 100 MB. 0 is not accepted: the loader treats 0 as unset and would silently fall back to the default while the operator believes the limit is off.
        valid: function (v) { return v >= 4 * 1024 * 1024 && v <= 100 * 1024 * 1024; },
        validHint: '4194304(4MB) 이상 104857600(100MB) 이하. ' +
                   '배포 실측 최대 본문이 4,058,640 B 라 그보다 커야 한다',
        apply: 'runtime',
        label: '요청 본문 최대 크기(바이트)',
        help: '넘으면 본문을 다 받기 전에 413 으로 끊는다. cin.con 은 MySQL 에서 ' +
              'longtext 라 DB 는 상한 역할을 못 한다 — 여기가 유일한 방어선이다. ' +
              '값을 내려서 정상 쓰기가 막히면 [body_limit] 로그에 크기가 남는다.'
    },
    retentionPolicies: {
        group: '저장소',
        type: 'array', dflt: [],
        apply: 'restart', readOnly: true,
        label: '컨테이너 보관 정책',
        help: '규칙 배열이라 단순 필드가 아니다. 형식은 mobius/cnt.js 상단 주석 참고. ' +
              '지금은 보여 주기만 한다.'
    },
    db: {
        group: '저장소',
        type: 'enum', dflt: 'mysql',
        tier: 'user',
        // Valid values are not hard-coded: adding an adapter file (mobius/db/<name>.js) extends the list.
        valid: function () { return require('./db').backends(); },
        apply: 'restart',
        label: '데이터베이스',
        help: '어댑터는 mobius/db/<이름>.js 다. 파일을 두면 목록에 나타난다.'
    },

    dbConnectionLimit: {
        group: '저장소',
        type: 'number', integer: true, dflt: 25,
        // Below 1 no request can be served; the upper bound follows from the server's max_connections and the process count (see derived below).
        valid: function (v) { return v >= 1 && v <= 500; },
        validHint: '1 ~ 500',
        apply: 'restart',
        label: 'DB 커넥션 풀 크기 (프로세스당)',
        help: '**풀은 프로세스마다 하나씩 생긴다.** 배포는 워커 24 + 마스터 1 = 25 이므로 ' +
              '앱이 요구할 수 있는 총량은 이 값 x 25 다. ' +
              '실측 Max_used_connections 는 59 다 — 실제로는 근처도 안 간다. ' +
              '요청 하나가 최대 3개를 쥘 수 있다(POST 의 set_hit + 본 처리 + 알림). ' +
              '**MySQL 의 max_connections 는 이 값에서 따라온다** — 재기동 때 모자라면 ' +
              'Mobius 가 바닥까지 올린다(올리기만 한다. 이미 크면 안 건드린다).',
        // Material for the UI to show '-> max_connections at least N needed'. Only numbers are passed; the formula lives in mobius/pool_sizing.js.
        //
        // UI computation: ceil(v * processes * slack / roundTo) * roundTo
        derived: function () {
            var ps = require('./pool_sizing');
            return {
                of: 'max_connections',
                processes: ps.processCount(),
                slack: 1.2,
                roundTo: 100,
                floorNow: ps.currentFloor()
            };
        }
    },
    dbQueueLimit: {
        group: '저장소',
        type: 'number', integer: true, dflt: 50,
        valid: function (v) { return v >= 0 && v <= 10000; },
        validHint: '0 ~ 10000 (0 은 무제한 — 권장하지 않는다)',
        apply: 'restart',
        label: 'DB 커넥션 대기열 한도 (프로세스당)',
        help: '풀이 가득 찼을 때 몇 개까지 대기시킬 것인가. ' +
              '**0 은 무제한이고 그 큐에는 타임아웃이 없다** — 드라이버가 ' +
              '`if (queueLimit && ...)` 로 검사해 0 이면 한도 분기를 건너뛰고, ' +
              'acquireTimeout 은 큐 대기에 관여하지 않는다. 그래서 풀이 마르면 요청이 ' +
              '응답도 에러도 없이 영원히 매달리고 워커도 죽지 않는다 — ' +
              '이것이 "서버가 자주 멈춘다" 의 정체였다. ' +
              '유한값이면 즉시 500 이 나가 장치가 재시도할 수 있고 로그에 흔적이 남는다.'
    },

    // Backend-specific settings are not here. Each adapter exports its own confSchema and the merge below adds only the keys of the selected backend.


    // Not exposed: secrets
    superUser: {
        group: '권한',
        tier: 'user',
        type: 'string', dflt: 'Sponde', secret: true, exposed: false, apply: 'restart',
        label: '수퍼유저 Origin',
        help: '이 값을 X-M2M-Origin 에 넣으면 **모든 ACP 검사를 건너뛴다.** ' +
              '사실상 마스터 키라 화면에 올리지 않는다.'
    },

    // Network (HTTP). Gate grade: the CLI prints gateWarn and requires the key name to be typed.
    csebaseport: {
        group: '네트워크',
        tier: 'user',
        type: 'string', dflt: '7579', apply: 'restart',
        grade: 'gate',
        gateWarn: '⚠ csebaseport 를 바꾸면 등록된 AE 의 poa 가 전부 어긋난다.\n' +
                  '  · 그 AE 로 가는 알림이 실패한다 — AE 쪽에서 poa 를 다시 등록해야 한다',
        valid: function (v) { return /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535; },
        validHint: '1~65535',
        label: 'CSEBase 포트',
        help: 'HTTP(S) 가 듣는 포트. 마스터가 기동 전에 시험 바인드로 점유 여부를 본다.'
    },

    // Console. Keys read only by the admin console (admin/server.js); the core sets no globals for them, so they are not in the boot record and the CLI shows them as not compared.
    //
    // adminPassword and adminOrigin carry secret:true together with exposed:false; validate() gates on exposed.
    adminPort: {
        group: '콘솔',
        type: 'number', integer: true, min: 1, dflt: 7580, apply: 'restart',
        label: '콘솔 포트', help: '관리 콘솔이 듣는 포트.'
    },
    adminHost: {
        group: '콘솔',
        type: 'string', dflt: '127.0.0.1', apply: 'restart',
        valid: function (v) { return v.length > 0; }, validHint: '비울 수 없다',
        label: '콘솔 바인드 주소',
        help: '기본은 루프백이다. 조회만 해도 운영 리소스 트리를 그대로 보여 주므로 기본값이 외부 공개면 안 된다.'
    },
    adminCseHost: {
        group: '콘솔',
        type: 'string', dflt: '127.0.0.1', apply: 'restart',
        valid: function (v) { return v.length > 0; }, validHint: '비울 수 없다',
        label: '콘솔이 쓰기를 보낼 Mobius 주소', help: ''
    },
    adminCsePort: {
        group: '콘솔',
        type: 'number', integer: true, min: 0, dflt: 0, apply: 'restart',
        label: '콘솔이 쓰기를 보낼 Mobius 포트',
        help: '0 이면 csebaseport 를 따른다.'
    },
    adminPassword: {
        group: '콘솔',
        type: 'string', dflt: '', secret: true, exposed: false, apply: 'restart',
        label: '콘솔 비밀번호',
        help: '없으면 콘솔이 뜨지 않는다. 화면에도 CLI 에도 값을 내보내지 않는다.'
    },
    adminOrigin: {
        group: '콘솔',
        type: 'string', dflt: '', secret: true, exposed: false, apply: 'restart',
        label: '콘솔의 X-M2M-Origin',
        help: '비면 superUser 로 떨어진다 — 그러면 콘솔 비밀번호가 곧 마스터 키다. ACP 로 제한하려면 별도 AE-ID 를 넣는다.'
    },

    // CSE identity. Gate grade (grade:'gate'): the CLI prints gateWarn and requires the key name to be typed. The texts live here so the CLI carries no per-key policy.
    cseBase: {
        group: 'CSE 신원',
        tier: 'user',
        type: 'string', dflt: 'Mobius', apply: 'restart',
        grade: 'gate',
        gateWarn: '⚠ cseBase 를 바꾸면 다른 CSE 로 뜬다.\n' +
                  '  · 지금 이름으로 만든 리소스는 지워지지 않지만 /새이름/… 경로로는 404 다\n' +
                  '  · 그런데 루트 discovery 와 비구조 주소(/{sri})로는 여전히 나온다 — 절반만 가려진다\n' +
                  '  · 옛 경로를 mid 로 가진 그룹은 그 멤버를 조용히 건너뛴다\n' +
                  '  · 이름을 되돌리면 원래대로 돌아온다',
        // An empty string would make the CSEBase ri '/' and break the whole-tree check in sql_action; '/' inside the name breaks the depth of the tree; the five reserved words collide with the la/ol/fopt branches in app.js.
        valid: function (v) {
            return /^[A-Za-z0-9_-]{1,64}$/.test(v) &&
                   ['la', 'latest', 'ol', 'oldest', 'fopt'].indexOf(v) < 0;
        },
        validHint: '영문·숫자·_·- 1~64자. la/latest/ol/oldest/fopt 는 쓸 수 없다',
        label: 'CSE 이름',
        help: 'CSEBase 리소스 이름 — 경로의 첫 마디다(/Mobius/...). 기동 시 이 이름의 ' +
              'CSEBase 가 DB 에 있으면 이어받고 없으면 만든다.'
    },
    cseId: {
        group: 'CSE 신원',
        tier: 'user',
        type: 'string', dflt: '/Mobius2', apply: 'restart',
        grade: 'gate',
        gateWarn: '⚠ cseId 를 바꾸면 MQTT 알림 토픽과 acpi 절대 표기 접기가 끊긴다.\n' +
                  '  · 기존 구독자가 옛 CSE-ID 토픽을 듣고 있으면 알림을 못 받는다\n' +
                  '  · //spid/옛ID/... 로 적힌 acpi 는 더 이상 내부 ri 로 접히지 않는다',
        valid: function (v) { return /^\/\S+$/.test(v); },
        validHint: '/ 로 시작하고 공백이 없어야 한다 (예: /Mobius2)',
        label: 'CSE-ID',
        help: 'oneM2M CSE-ID. 절대 표기 //spid/cseid/... 의 두 번째 마디다.'
    },
    spId: {
        group: 'CSE 신원',
        tier: 'user',
        type: 'string', dflt: '//keti.re.kr', apply: 'restart',
        grade: 'gate',
        gateWarn: '⚠ spId 를 바꾸면 절대 표기(//spid/cseid/...) 접기가 안 된다.\n' +
                  '  · 그렇게 적힌 대상(acpi·구독 알림 주소)의 해석이 실패한다',
        valid: function (v) { return /^\/\/\S+$/.test(v); },
        validHint: '// 로 시작하고 공백이 없어야 한다 (예: //keti.re.kr)',
        label: 'SP-ID',
        help: 'oneM2M 서비스 제공자 ID. 예전에는 app.js 에 박혀 있었다.'
    },
    releaseVersion: {
        group: 'CSE 신원',
        type: 'enum', valid: ['1', '2', '2a'], dflt: '2a', apply: 'runtime',
        label: '릴리스 버전(rvi)',
        help: '응답과 알림의 X-M2M-RVI. mobius/cb.js 가 광고하는 srv 목록과 같아야 한다 — ' +
              'test/conf-schema.test.js 가 대조한다.'
    },

    // Network (MQTT, TLS)
    mqttBroker: {
        group: '네트워크',
        type: 'string', dflt: 'localhost', apply: 'restart',
        valid: function (v) { return v.length > 0; },
        validHint: '비울 수 없다',
        label: 'MQTT 브로커',
        help: '알림 발행에 쓰는 브로커 호스트. 남은 소비처는 알림 발행뿐이다.'
    },
    mqttPort: {
        group: '네트워크',
        type: 'string', dflt: '1883', apply: 'restart',
        valid: function (v) { return /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535; },
        validHint: '1~65535',
        // Basis for the CLI's 'derived' marker: a difference between the file value and the running value is not a pending restart.
        derivedFrom: function (applied) {
            return (applied && applied.useSecure === 'enable') ? 'useSecure=enable' : null;
        },
        label: 'MQTT 포트',
        help: 'useSecure 가 enable 이면 8883 으로 덮인다.'
    },
    useSecure: {
        group: '네트워크',
        type: 'enum', valid: ['disable', 'enable'], dflt: 'disable', apply: 'restart',
        grade: 'gate',
        gateWarn: '⚠ useSecure 를 켜면 HTTP 가 HTTPS 로, MQTT 알림이 mqtts(8883) 로 바뀐다.\n' +
                  '  · server-key.pem / server-crt.pem / ca-crt.pem 이 저장소 루트에 있어야 뜬다\n' +
                  '  · 기존 브로커가 TLS 를 안 받으면 알림이 전부 끊긴다',
        label: 'TLS',
        help: "'enable' 이 아닌 어떤 값도 disable 로 본다 — 오타로 HTTPS 분기에 들어가면 안 된다."
    },

    // Access restriction
    allowedAeIds: {
        group: '접근 제한',
        type: 'array', dflt: [], apply: 'runtime',
        grade: 'gate',
        gateWarn: '⚠ allowedAeIds 를 채우면 목록 밖의 X-M2M-Origin 은 전부 403-1 이다.\n' +
                  '  · 비어 있으면 제한하지 않는다',
        label: '허용 AE-ID 목록',
        help: '비어 있으면 전원 허용. CLI 에서는 쉼표로 구분한다.'
    },
    allowedAppIds: {
        group: '접근 제한',
        type: 'array', dflt: [], apply: 'runtime',
        grade: 'gate',
        gateWarn: '⚠ allowedAppIds 를 채우면 AE 생성 시 api 가 목록 밖이면 거절된다.\n' +
                  '  · 비어 있으면 제한하지 않는다',
        label: '허용 App-ID 목록',
        help: 'AE 생성 시 api 화이트리스트. 비어 있으면 전원 허용.'
    }

};

// Merges the settings of the selected backend into the table. Adapters export their keys as confSchema; only the selected backend's keys are added, and adapter keys never override core keys.
(function mergeBackendConf() {
    var own;
    try { own = require('./db').confSchema(); }
    catch (e) {
        // The table must load even when the facade cannot be read; only backend-specific keys are missing then.
        console.error('[conf_schema] 백엔드 설정을 못 읽었다: ' + ((e && e.message) || e));
        return;
    }
    Object.keys(own || {}).forEach(function (k) {
        if (SCHEMA[k]) {
            console.error('[conf_schema] 어댑터가 코어 키 ' + k + ' 를 덮으려 한다 — 무시한다');
            return;
        }
        SCHEMA[k] = own[k];
    });
})();

// Keys to render: everything not marked exposed:false.
exports.exposed = function () {
    return Object.keys(SCHEMA).filter(function (k) {
        return SCHEMA[k].exposed !== false;
    }).sort();
};

exports.all = function () {
    return Object.keys(SCHEMA).sort();
};

// User keys: the seven the first run asks for and the CLI shows by default. Everything else is advanced (--all). A key without tier is advanced.
exports.userKeys = function () {
    return exports.all().filter(function (k) { return SCHEMA[k].tier === 'user'; });
};

exports.get = function (key) {
    return SCHEMA[key] || null;
};

// List of valid values. Values decided at runtime (db) are resolved here too. null when the key is not list-typed.
exports.choices = function (key) {
    var s = SCHEMA[key];
    if (!s) { return null; }
    if (typeof s.valid === 'function' && s.type === 'enum') {
        try { return s.valid(); } catch (e) { return null; }
    }
    return Array.isArray(s.valid) ? s.valid.slice() : null;
};

/** Checks the type and the valid values of one value only; the exposure and read-only gates are not applied. Used by the first-run wizard, which must write dbpass and csebaseport. The save path gate is validate(). */
exports.checkValue = function (key, value) {
    var s = SCHEMA[key];
    if (!s) { return { ok: false, reason: '모르는 키다' }; }

    if (s.type === 'number') {
        if (typeof value !== 'number' || !isFinite(value)) {
            return { ok: false, reason: '수가 아니다' };
        }
        if (s.integer && Math.floor(value) !== value) {
            return { ok: false, reason: '정수여야 한다' };
        }
        if (typeof s.min === 'number' && value < s.min) {
            return { ok: false, reason: s.min + ' 이상이어야 한다' };
        }
    }
    else if (s.type === 'array') {
        if (!Array.isArray(value)) { return { ok: false, reason: '배열이 아니다' }; }
    }
    else if (typeof value !== 'string') {
        return { ok: false, reason: '문자열이 아니다' };
    }

    if (typeof s.valid === 'function') {
        var r = s.valid(value);
        if (Array.isArray(r)) {
            if (r.indexOf(value) < 0) {
                return { ok: false, reason: r.join(' / ') + ' 중 하나여야 한다' };
            }
        }
        else if (!r) {
            return { ok: false, reason: s.validHint || '허용되지 않는 값이다' };
        }
    }
    else if (Array.isArray(s.valid) && s.valid.indexOf(value) < 0) {
        return { ok: false, reason: s.valid.join(' / ') + ' 중 하나여야 한다' };
    }

    return { ok: true, reason: '' };
};

/** Gate of the save path. Never throws. Rejects keys that are not exposed or are read-only, then applies checkValue. */
exports.validate = function (key, value) {
    var s = SCHEMA[key];
    if (!s) { return { ok: false, reason: '모르는 키다' }; }
    if (s.exposed === false) { return { ok: false, reason: '노출 대상이 아니다' }; }
    if (s.readOnly) { return { ok: false, reason: '읽기 전용이다' }; }
    return exports.checkValue(key, value);
};

// Group names in table declaration order; the CLI lists groups in this order.
exports.groups = function () {
    var seen = [];
    Object.keys(SCHEMA).forEach(function (k) {
        var g = SCHEMA[k].group;
        if (seen.indexOf(g) < 0) { seen.push(g); }
    });
    return seen;
};

// The table in the form the UI consumes. Secrets carry no value.
exports.describe = function () {
    var out = {};
    exports.exposed().forEach(function (k) {
        var s = SCHEMA[k];
        out[k] = {
            type: s.type,
            dflt: s.dflt,
            choices: exports.choices(k),
            validHint: s.validHint || null,
            integer: s.integer === true,
            // The grouping key of the UI; it comes from the same place as label and help.
            group: s.group,
            apply: s.apply,
            // For apply === 'reload': what to call so the value takes effect.
            reloadWith: s.reloadWith || null,
            readOnly: s.readOnly === true,
            label: s.label,
            help: s.help || '',
            // user / advanced tier; unset means advanced.
            tier: s.tier === 'user' ? 'user' : 'advanced',
            // Gate grade and its text; the CLI prints it before saving.
            grade: s.grade === 'gate' ? 'gate' : 'edit',
            gateWarn: s.gateWarn || null,
            // Relation to a server-side value that follows this one, passed as numbers. Errors are swallowed so one field cannot break the whole settings view.
            derived: (function () {
                if (typeof s.derived !== 'function') { return null; }
                try { return s.derived(); } catch (e) { return null; }
            })()
        };
    });
    return out;
};

exports._SCHEMA = SCHEMA;
