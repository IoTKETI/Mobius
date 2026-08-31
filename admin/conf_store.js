'use strict';
/**
 * conf.json 을 안전하게 읽고 쓴다.
 *
 * 화면이 설정을 고칠 수 있게 하려면 세 가지가 먼저 성립해야 한다.
 *
 *   1. **모르는 키를 보존한다.** conf.json 은 여러 세션·사람이 동시에 고친다.
 *      읽고-고쳐-쓰기를 하면 그 사이 남이 넣은 키를 조용히 날린다.
 *   2. **원자적으로 쓴다.** 같은 파일을 Mobius 워커 25개가 기동 때 읽는다.
 *      쓰는 도중 워커가 되살아나 반쪽 파일을 읽으면 JSON.parse 가 던지고
 *      그 워커는 뜨지 못한다.
 *   3. **비밀은 값을 내보내지 않는다.** dbpass·superUser·adminPassword 는
 *      화면에 값이 뜨면 안 된다. 있는지 없는지만 말한다.
 *
 * **스키마는 잠정이다.** 코어가 설정 스키마 모듈(키·타입·기본값·유효값·
 * 적용시점)을 만들어 넘기기로 했다. 오면 SCHEMA 를 그것으로 갈아끼운다 —
 * 이 파일의 읽기/쓰기 기계는 스키마와 무관하게 그대로 쓴다.
 */

var fs = require('fs');
var path = require('path');

/**
 * 적용 시점.
 *
 *   runtime  요청마다 global 을 읽으므로 값만 바꾸면 즉시 먹는다
 *   reload   global 은 바꿔도 안 먹는다. 모듈이 값을 자기 안에 캐시하므로
 *            acp_observe.configure() 를 다시 불러야 한다
 *   restart  Mobius 를 재기동해야 한다
 *
 * 코어가 확인해 준 구분이다(2026-08-31). 화면은 이 값으로 "저장하면 언제
 * 반영되는가" 를 말한다 — 그것을 말하지 않는 설정 화면은 거짓말을 한다.
 */
var APPLY = { RUNTIME: 'runtime', RELOAD: 'reload', RESTART: 'restart' };

/** 화면에 내보내는 키. 여기 없는 키는 읽지도 쓰지도 않는다. */
var SCHEMA = {
    acpObserveMode: {
        type: 'enum', values: ['off', 'observe'], def: 'off', apply: APPLY.RELOAD,
        label: 'ACP 관찰 모드',
        help: 'observe 면 ACP 평가로 난 거부가 허용으로 나갑니다. 잠그기 전 하루만 켭니다.',
        danger: function (v) { return v === 'observe'; }
    },
    acpiAttachPolicy: {
        type: 'enum', values: ['open', 'creator'], def: 'open', apply: APPLY.RUNTIME,
        label: 'acpi 부착 정책',
        help: 'open 이면 인증된 아무나 남의 리소스에 자기 ACP 를 붙일 수 있습니다. creator 면 생성자와 수퍼유저만 가능합니다.'
    },
    acpDiscoveryFilter: {
        type: 'enum', values: ['on', 'off'], def: 'on', apply: APPLY.RUNTIME,
        label: '탐색 결과 ACP 필터',
        help: 'off 면 잠근 리소스의 경로가 상위 탐색 결과에 그대로 나옵니다(내용은 아니고 경로·이름·트리 구조).',
        danger: function (v) { return v === 'off'; }
    },
    acpAudit: {
        type: 'enum', values: ['on', 'off'], def: 'on', apply: APPLY.RUNTIME,
        label: 'ACP 변경 이력',
        help: 'off 면 누가 언제 무엇을 걸었는지 남지 않습니다. 이력 화면이 빈 목록이 됩니다.'
    },
    defaultAccessPolicy: {
        type: 'enum', values: ['disable', 'enable'], def: 'disable', apply: APPLY.RUNTIME,
        label: '기본 접근 정책',
        help: 'acpi 가 없는 리소스의 정책입니다. disable 이 대원칙(생성·조회는 누구나)과 일치합니다.',
        danger: function (v) { return v === 'enable'; }
    },
    acpDenyLog: {
        type: 'enum', values: ['off', 'sample', 'all'], def: 'sample', apply: APPLY.RELOAD,
        label: 'ACP 거부 로그',
        help: 'sample 은 워커당 초당 몇 줄만 남깁니다 — 기록이 전수가 아닙니다.'
    },
    acpDenyLogRate: {
        type: 'int', min: 0, max: 1000, def: 5, apply: APPLY.RELOAD,
        label: '거부 로그 초당 줄 수',
        help: '워커당입니다. 배포는 워커 25개라 전체는 이 값의 25배까지 납니다.'
    },
    db: {
        type: 'enum', values: null, def: 'mysql', apply: APPLY.RESTART,
        label: 'DB 백엔드',
        help: '유효값은 mobius/db 의 어댑터 목록에서 받습니다 — 어댑터를 추가하면 저절로 늘어납니다.',
        valuesFrom: 'db.backends'
    },
    outboundTimeoutMs: {
        type: 'int', min: 0, max: 600000, def: 0, apply: APPLY.RESTART,
        label: '외부 요청 타임아웃(ms)',
        help: '0 이면 끕니다. 켜려면 3000 이상 — 알림 발송과 원격 CSE 포워딩의 ' +
              '응답 대기 한도라, 낮추면 정상 알림이 실패로 기록되기 시작합니다.',
        // 0(끔) 아니면 3초 이상. 그 사이 값은 "켰는데 정상 응답을 못 기다리는"
        // 상태라 끄는 것보다 나쁘다 — 멀쩡한 알림이 실패로 쌓인다.
        check: function (v) {
            if (v === 0) { return null; }
            if (v < 3000) {
                return 'outboundTimeoutMs 는 0(끔) 이거나 3000 이상이어야 한다 — ' +
                       '그 사이 값은 정상 알림을 실패로 만든다';
            }
            return null;
        }
    },
    retentionPolicies: {
        type: 'json', def: [], apply: APPLY.RESTART,
        label: '보존 정책',
        help: '규칙 배열입니다. 형식은 mobius/cnt.js 상단 주석에 있습니다.',
        readonly: true   // 단순 필드가 아니다. 지금은 보여 주기만 한다
    }
};

/**
 * 값을 절대 내보내지 않는 키. **있는지 없는지만** 말한다.
 *
 * superUser 는 아는 사람이 ACP 를 전부 우회한다(security.js 가 그 origin 을
 * 무조건 통과시킨다). adminPassword 는 콘솔 자신의 인증이라, 화면에서 고치게
 * 두면 스스로 잠근다. adminOrigin 은 콘솔의 쓰기 권한을 정한다.
 */
var SECRET = ['dbpass', 'superUser', 'adminPassword', 'adminOrigin'];

/**
 * 화면에 아예 올리지 않는 키.
 *
 * 포트·주소는 바꾸면 콘솔이 자기 발밑을 무너뜨린다. usesqlite 는 곧 사라진다 —
 * db 키가 진실원이 되면서 파생된 한시적 별칭이라, 화면에 올리면 지울 때 같이
 * 깨진다.
 */
var HIDDEN = ['usesqlite', 'csebaseport', 'adminPort', 'adminHost',
              'adminCseHost', 'adminCsePort', 'pxyWsPort', 'pxyMqttPort',
              'sgnManPort', 'cntManPort', 'hitManPort'];

function ConfStore(file, opts) {
    this.file = file;
    this.backends = (opts && opts.backends) || function () { return []; };
}

ConfStore.prototype._read = function () {
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
};

/** 이 키의 유효값. db 처럼 코어에서 받아야 하는 것이 있다. */
ConfStore.prototype._valuesOf = function (key) {
    var s = SCHEMA[key];
    if (!s) { return null; }
    if (s.valuesFrom === 'db.backends') { return this.backends(); }
    return s.values;
};

/**
 * 화면에 줄 것. **비밀은 값 없이 존재 여부만 나간다.**
 */
ConfStore.prototype.view = function () {
    var conf = this._read();
    var self = this;
    var items = Object.keys(SCHEMA).map(function (key) {
        var s = SCHEMA[key];
        var raw = conf[key];
        var set = Object.prototype.hasOwnProperty.call(conf, key);
        return {
            key: key,
            label: s.label,
            help: s.help,
            type: s.type,
            apply: s.apply,
            readonly: !!s.readonly,
            values: self._valuesOf(key),
            min: s.min, max: s.max,
            def: s.def,
            // 파일에 없으면 기본값이 쓰인다. 그 사실을 화면이 구분해야 한다.
            fileValue: set ? raw : null,
            usingDefault: !set,
            effective: set ? raw : s.def,
            danger: typeof s.danger === 'function'
                ? !!s.danger(set ? raw : s.def) : false
        };
    });

    var secrets = SECRET.map(function (key) {
        return {
            key: key,
            // 값은 절대 나가지 않는다. 길이도 주지 않는다.
            present: Object.prototype.hasOwnProperty.call(conf, key) &&
                     conf[key] !== '' && conf[key] !== null && conf[key] !== undefined
        };
    });

    // 스키마에도 비밀에도 숨김에도 없는 키. 다른 세션이 넣은 것일 수 있다.
    var known = Object.keys(SCHEMA).concat(SECRET, HIDDEN);
    var unknown = Object.keys(conf).filter(function (k) { return known.indexOf(k) < 0; });

    return { items: items, secrets: secrets, unknownKeys: unknown, file: this.file };
};

/** 한 값이 스키마에 맞는가. 맞으면 null, 아니면 사유 문자열. */
ConfStore.prototype.validate = function (key, value) {
    var s = SCHEMA[key];
    if (!s) { return '고칠 수 없는 키다: ' + key; }
    if (s.readonly) { return '이 키는 화면에서 고치지 않는다: ' + key; }

    if (s.type === 'enum') {
        var vals = this._valuesOf(key);
        if (!Array.isArray(vals) || vals.length === 0) {
            return '유효값 목록을 얻지 못했다: ' + key;
        }
        if (vals.indexOf(value) < 0) {
            return key + ' 의 값이 아니다 (' + vals.join(' / ') + ')';
        }
        return null;
    }
    if (s.type === 'int') {
        if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value) {
            return key + ' 는 정수여야 한다';
        }
        if (s.min !== undefined && value < s.min) { return key + ' 는 ' + s.min + ' 이상이어야 한다'; }
        if (s.max !== undefined && value > s.max) { return key + ' 는 ' + s.max + ' 이하여야 한다'; }
        // 범위만으로 못 거르는 것이 있다. outboundTimeoutMs 처럼 "끄거나, 켜려면
        // 충분히 크거나" 인 값이 그렇다.
        if (typeof s.check === 'function') { return s.check(value); }
        return null;
    }
    return '지원하지 않는 타입: ' + s.type;
};

/**
 * 고친다. **모르는 키는 그대로 둔다.**
 *
 * 파일을 통째로 다시 쓰지 않고, 읽은 객체에서 주어진 키만 바꾼 뒤 다시 쓴다.
 * 그래서 그사이 남이 넣은 키가 살아남는다. 다만 읽기와 쓰기 사이의 창은
 * 남는다 — 콘솔은 관리자 한 명이 쓰고 설정 변경이 드물어 잠금까지는 두지
 * 않는다. 대신 쓰기 자체는 원자적이다.
 *
 * @param patch { key: value }
 * @returns { ok, changed:[{key, from, to}], errors:[string] }
 */
ConfStore.prototype.update = function (patch) {
    var self = this;
    var keys = Object.keys(patch || {});
    if (keys.length === 0) { return { ok: false, changed: [], errors: ['바꿀 것이 없다'] }; }

    var errors = [];
    keys.forEach(function (k) {
        var why = self.validate(k, patch[k]);
        if (why) { errors.push(why); }
    });
    // 하나라도 틀리면 아무것도 쓰지 않는다. 일부만 적용되면 화면이 보여 준
    // 상태와 파일이 어긋난다.
    if (errors.length) { return { ok: false, changed: [], errors: errors }; }

    var conf = this._read();
    var changed = [];
    keys.forEach(function (k) {
        var before = Object.prototype.hasOwnProperty.call(conf, k) ? conf[k] : null;
        if (before === patch[k]) { return; }
        changed.push({ key: k, from: before, to: patch[k] });
        conf[k] = patch[k];
    });
    if (changed.length === 0) { return { ok: true, changed: [], errors: [] }; }

    this._writeAtomic(conf);
    return { ok: true, changed: changed, errors: [] };
};

/**
 * 같은 디렉터리에 임시 파일로 쓰고 rename 한다.
 *
 * 워커 25개가 기동 때 이 파일을 읽는다. 제자리에서 고치면 쓰는 도중에 뜬
 * 워커가 반쪽 JSON 을 읽고 parse 에서 던져 못 뜬다. rename 은 같은 볼륨에서
 * 원자적이라 워커는 언제 읽어도 온전한 파일을 본다.
 */
ConfStore.prototype._writeAtomic = function (obj) {
    var dir = path.dirname(this.file);
    var tmp = path.join(dir, '.conf.json.' + process.pid + '.' + Date.now() + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 4) + '\n', 'utf8');
    try {
        fs.renameSync(tmp, this.file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* 정리 실패가 원인을 가리지 않게 */ }
        throw e;
    }
};

exports.ConfStore = ConfStore;
exports.APPLY = APPLY;
exports.SCHEMA = SCHEMA;
exports.SECRET = SECRET;
exports.HIDDEN = HIDDEN;
