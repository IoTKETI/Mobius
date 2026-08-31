'use strict';
// conf.json 의 설정 표. **관리 콘솔의 설정 화면이 이 표를 보고 화면을 그린다.**
//
// 왜 필요한가: mobius.js 가 conf 를 스무 곳 가까이 흩어져 읽는데, 어디에도
// "어떤 키가 있고, 무슨 값이 유효하고, 언제 반영되는가" 가 적혀 있지 않다.
// 그러면 화면을 그리는 쪽은 코드를 읽어 추측하는 수밖에 없고, 추측은 갈라진다.
//
// 이 표는 손으로 적은 목록이다. 손으로 적은 목록은 갈라진다 — 그래서
// test/conf-schema.test.js 가 mobius.js 가 실제로 읽는 키와 이 표를 대조한다.
// mobius.js 에 conf.무엇 이 새로 생기면 그 테스트가 먼저 걸린다.
//
// ── apply: 언제 반영되는가 ───────────────────────────────────────────────
//
//   'runtime'  요청마다 global 을 읽는다. 값만 바꾸면 즉시 먹는다.
//   'reload'   모듈이 값을 자기 안에 캐시한다. 값을 바꾼 뒤 그 모듈의
//              재설정 함수를 불러야 한다. **global 만 바꾸면 아무 일도 안 난다.**
//   'restart'  기동 시 한 번 읽는다. Mobius 를 다시 띄워야 한다.
//
// 이 구분이 화면에서 가장 중요하다. 'reload' 를 '즉시' 로 표시하면 관리자가
// 관찰 모드를 껐다고 믿고 넘어간다.
//
// ── 워커마다 값이 다를 수 있다 ───────────────────────────────────────────
//
// 배포는 워커 25개 클러스터이고 워커마다 이 파일을 따로 읽는다. backstop 이
// 예외에서 워커를 죽이면 cluster 가 다시 띄우는데, 그 워커만 새 conf 를 읽는다.
// 그래서 **"지금 적용된 값" 은 단일 값이 아니라 분포다.** 화면이 하나만
// 보여 주면 거짓말이 된다.

// 값의 유효성. valid 가 배열이면 그중 하나, 함수면 그 함수가 판정한다.
// 유효값이 실행 중에 정해지는 것(db 의 백엔드 목록)은 함수로 둔다.
var SCHEMA = {
    // ── 노출: 운영 정책 ──────────────────────────────────────────────
    acpObserveMode: {
        type: 'enum', valid: ['off', 'observe'], dflt: 'off',
        apply: 'reload', reloadWith: 'acp_observe.configure',
        label: 'ACP 관찰 모드',
        help: 'observe 로 두면 **ACP 거부가 허용으로 나간다.** 잠그기 전에 무엇이 ' +
              '막힐지 보기 위한 것이고, 켠 채로 두면 ACP 가 무력해진다.'
    },
    acpDenyLog: {
        type: 'enum', valid: ['off', 'sample', 'all'], dflt: 'sample',
        apply: 'reload', reloadWith: 'acp_observe.configure',
        label: 'ACP 거부 로그',
        help: 'all 은 거부마다 한 줄이다. 거부가 많으면 로그가 밀린다.'
    },
    acpDenyLogRate: {
        type: 'number', min: 0, integer: true, dflt: 5,
        apply: 'reload', reloadWith: 'acp_observe.configure',
        label: 'ACP 거부 로그 초당 상한',
        help: "acpDenyLog 가 'sample' 일 때만 쓴다."
    },
    acpiAttachPolicy: {
        type: 'enum', valid: ['open', 'creator'], dflt: 'open',
        apply: 'runtime',
        label: 'acpi 최초 부착 권한',
        help: 'ACP 가 안 걸린 리소스에 누가 처음 acpi 를 붙일 수 있는가. ' +
              "creator 로 바꾸면 acpi 를 붙이던 정상 요청이 거부되기 시작한다."
    },
    acpAudit: {
        type: 'enum', valid: ['on', 'off'], dflt: 'on',
        apply: 'runtime',
        label: 'ACP 변경 이력',
        help: 'acp 테이블에 cr 컬럼이 없어 "누가 만들었는가" 를 답할 다른 근거가 없다.'
    },
    acpDiscoveryFilter: {
        type: 'enum', valid: ['on', 'off'], dflt: 'on',
        apply: 'runtime',
        label: 'discovery ACP 필터',
        help: '끄면 잠근 컨테이너의 **경로가 상위 탐색 결과에 그대로 나온다** ' +
              '(이름·구조·CIN 개수·생성 시각). 관리자는 잠갔다고 생각하는데 아니다.'
    },
    defaultAccessPolicy: {
        type: 'enum', valid: ['disable', 'enable'], dflt: 'disable',
        apply: 'runtime',
        label: 'acpi 없는 리소스의 기본 정책',
        help: "이름과 달리 'ACP 를 쓰느냐' 가 아니다. disable = 생성·조회·탐색은 " +
              '누구나 / 수정·삭제는 생성자만. enable = 전부 생성자만.'
    },
    outboundTimeoutMs: {
        type: 'number', dflt: 0,
        // 0 은 "지정 안 함"(mobius/outbound.js 의 기본 10초를 쓴다) 이다.
        // 그 외에는 하한을 둔다 — 낮추면 **정상 알림이 실패로 기록되기 시작한다.**
        valid: function (v) { return v === 0 || v >= 3000; },
        validHint: '0(기본값 사용) 이거나 3000 이상',
        apply: 'restart',
        label: '나가는 요청 응답 대기 한도(ms)',
        help: '알림·팬아웃·CSR 포워딩이 상대를 기다리는 한도. 이 값이 없으면 ' +
              '느린 상대 하나가 DB 풀 커넥션을 영구 점유한다.'
    },
    maxBodyBytes: {
        type: 'number', dflt: 10 * 1024 * 1024,
        // 하한은 감이 아니라 실측이다. 배포 DB 의 cin.con 을 키 공간 양끝에서
        // 400만 행 표본했다:
        //
        //     뒤쪽 200만   평균 1,285 B   최대 4,058,640 B
        //     앞쪽 200만   평균 6,889 B   최대 2,311,121 B
        //
        // **최대 실측치가 4,058,640 바이트**다. 그보다 낮게 잡으면
        // /Mobius/plat4_1/img 같은 컨테이너의 정상 쓰기가 그 순간부터 413 이
        // 된다 — 1MB 넘는 것은 전부 base64 JPEG 이었다.
        //
        // 0 을 받지 않는 이유: mobius.js 가 `> 0` 으로 거르므로 0 을 넣으면
        // 조용히 기본값 10MB 로 간다. 관리자는 "상한을 껐다" 고 믿는데 실제로는
        // 걸려 있는 상태다. 그 착각이 바로 지금까지의 문제였다 —
        // bodyParser 의 5mb 가 8년간 매칭되지 않아 죽어 있었고 아무도 몰랐다.
        //
        // 상한 100MB 는 **실측 근거가 없다.** 배포 메모리 여유를 재 본 적이
        // 없다. 워커 하나가 요청 하나에 쓸 수 있는 메모리이므로 동시 요청수만큼
        // 곱해진다는 것만 근거다. 실측이 나오면 이 숫자를 고칠 것.
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
        type: 'array', dflt: [],
        apply: 'restart', readOnly: true,
        label: '컨테이너 보관 정책',
        help: '규칙 배열이라 단순 필드가 아니다. 형식은 mobius/cnt.js 상단 주석 참고. ' +
              '지금은 보여 주기만 한다.'
    },
    db: {
        type: 'enum', dflt: 'mysql',
        // 유효값을 하드코딩하지 않는다. 어댑터 파일(mobius/db/<이름>.js)을 두면
        // 이 목록이 자동으로 늘어난다 — 화면 선택지도 같이 늘어난다.
        valid: function () { return require('./db').backends(); },
        apply: 'restart',
        label: '데이터베이스',
        help: '어댑터는 mobius/db/<이름>.js 다. 파일을 두면 목록에 나타난다.'
    },

    // ── 노출 안 함: 비밀 ─────────────────────────────────────────────
    dbpass: {
        type: 'string', dflt: '', secret: true, exposed: false, apply: 'restart',
        label: 'DB 비밀번호',
        help: '값을 화면으로 내보내지 않는다. 길이도 주지 않는다.'
    },
    superUser: {
        type: 'string', dflt: 'Sponde', secret: true, exposed: false, apply: 'restart',
        label: '수퍼유저 Origin',
        help: '이 값을 X-M2M-Origin 에 넣으면 **모든 ACP 검사를 건너뛴다.** ' +
              '사실상 마스터 키라 화면에 올리지 않는다.'
    },

    // ── 노출 안 함: 바꾸면 깨진다 ────────────────────────────────────
    csebaseport: { type: 'string', dflt: '7579', exposed: false, apply: 'restart',
        label: 'CSEBase 포트', help: '바꾸면 등록된 AE 의 poa 가 전부 어긋난다.' },
    pxyWsPort:   { type: 'string', dflt: '7577', exposed: false, apply: 'restart', label: 'WS 프록시 포트' },
    pxyMqttPort: { type: 'string', dflt: '7578', exposed: false, apply: 'restart', label: 'MQTT 프록시 포트' },
    sgnManPort:  { type: 'string', dflt: '7599', exposed: false, apply: 'restart', label: '알림 관리 포트' },
    cntManPort:  { type: 'string', dflt: '7583', exposed: false, apply: 'restart', label: '컨테이너 관리 포트' },
    hitManPort:  { type: 'string', dflt: '7594', exposed: false, apply: 'restart', label: '히트 관리 포트' },

    // ── 노출 안 함: 곧 사라진다 ──────────────────────────────────────
    usesqlite: {
        type: 'string', dflt: 'false', exposed: false, deprecated: true, apply: 'restart',
        label: '(구) SQLite 사용 여부',
        help: "db 키로 대체되었다. boolean 이라 세 번째 백엔드를 말할 수 없어 " +
              '이름 기반 선택자(db)로 옮겼다. 남아 있는 것은 옛 conf 호환뿐이고 ' +
              '곧 지운다 — 화면에 올리면 지울 때 같이 깨진다.'
    }
};

// 화면에 그릴 것만. 비밀·잠금 위험·폐기 예정은 뺀다.
exports.exposed = function () {
    return Object.keys(SCHEMA).filter(function (k) {
        return SCHEMA[k].exposed !== false;
    }).sort();
};

exports.all = function () {
    return Object.keys(SCHEMA).sort();
};

exports.get = function (key) {
    return SCHEMA[key] || null;
};

// 유효값 목록. 실행 중에 정해지는 것(db)도 여기서 풀어 준다.
// 목록형이 아니면 null.
exports.choices = function (key) {
    var s = SCHEMA[key];
    if (!s) { return null; }
    if (typeof s.valid === 'function' && s.type === 'enum') {
        try { return s.valid(); } catch (e) { return null; }
    }
    return Array.isArray(s.valid) ? s.valid.slice() : null;
};

/**
 * 값 하나를 검사한다.
 * @returns {{ok: boolean, reason: string}}
 *
 * **던지지 않는다.** 설정 저장 경로에서 도는 함수라, 여기서 던지면
 * 화면이 이유 없이 500 을 받는다.
 */
exports.validate = function (key, value) {
    var s = SCHEMA[key];
    if (!s) { return { ok: false, reason: '모르는 키다' }; }

    // **노출 대상이 아니면 여기서 끊는다.**
    //
    // 이 함수를 "설정 저장 경로의 관문" 이라고 설명해 놓고 노출 여부는 안 보고
    // 있었다. 그러면 validate 만 믿고 위임한 호출부에서 dbpass / superUser 가
    // 그냥 써진다. superUser 는 그 값을 X-M2M-Origin 에 넣으면 모든 ACP 검사를
    // 건너뛰는 값이다 — 콘솔이 그것을 쓸 수 있으면 콘솔이 곧 마스터 키다.
    //
    // 관문이 하나뿐이라고 말했으면 그 하나가 전부 막아야 한다.
    if (s.exposed === false) { return { ok: false, reason: '노출 대상이 아니다' }; }
    if (s.readOnly) { return { ok: false, reason: '읽기 전용이다' }; }

    if (s.type === 'number') {
        if (typeof value !== 'number' || !isFinite(value)) {
            return { ok: false, reason: '수가 아니다' };
        }
        // 정수여야 하는 값에 소수가 들어가면 당장 안 깨져도 다음에 읽는
        // 사람이 헷갈린다. 화면은 정수 입력칸을 그려 놓고 저장은 1.5 를 받는다.
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
        // enum 은 valid() 가 목록을 돌려준다. 그 외에는 참/거짓이다.
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

// 화면이 그대로 쓸 수 있는 형태. 비밀은 값을 담지 않는다.
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
            apply: s.apply,
            // apply === 'reload' 일 때 무엇을 다시 불러야 하는지. 이게 없으면
            // 화면이 "재기동 없이 반영된다" 까지만 말하고 그 방법은 못 말한다.
            reloadWith: s.reloadWith || null,
            readOnly: s.readOnly === true,
            label: s.label,
            help: s.help || ''
        };
    });
    return out;
};

exports._SCHEMA = SCHEMA;
