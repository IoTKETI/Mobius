'use strict';
/**
 * conf.json 을 안전하게 읽고 쓴다. CLI(tools/mobius-conf.js)와 마법사(tools/setup.js)가 쓴다.
 * 2026-09-05 까지는 admin/ 에 있었다 — 설정 편집이 CLI 의 일이 되면서 옮겼다.
 *
 * 지켜야 할 것 셋.
 *
 *   1. **모르는 키를 보존한다.** conf.json 은 여러 세션·사람이 동시에 고친다.
 *      읽고-고쳐-쓰기를 하면 그 사이 남이 넣은 키를 조용히 날린다.
 *   2. **원자적으로 쓴다.** 쓰기 자체는 mobius/conf_write.js 가 한다(tmp+rename).
 *      같은 파일을 Mobius 워커 25개가 기동 때 읽는다 — 반쪽 파일을 읽히면 안 된다.
 *   3. **비밀은 값을 내보내지 않는다.** 있는지 없는지만 말한다.
 *
 * **update() 를 우회하는 예외 API 는 create() 와 setSecret() 둘뿐이다.** 첫 구동
 * 마법사가 dbpass·csebaseport 를 반드시 써야 하는데 isWritable() 이 그것을 막기
 * 때문이다. 둘 다 화이트리스트로 좁힌다 — 아래 각 함수의 주석.
 *
 * **스키마는 코어가 준다**(`mobius/conf_schema`). 이 파일은 읽기/쓰기 기계만 맡는다.
 * **global.usedb 를 세운 뒤에 require 한다** — 표가 백엔드를 따라간다.
 */

var fs = require('fs');
var path = require('path');
var schema = require(path.join(__dirname, '..', 'mobius', 'conf_schema'));
var conf_write = require(path.join(__dirname, '..', 'mobius', 'conf_write'));

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

/**
 * 화면에 내보내는 키는 코어 스키마가 정한다. 여기서 목록을 다시 적지 않는다 —
 * 손으로 적은 표는 갈라지고, 그때 화면은 없는 설정을 그리거나 있는 설정을
 * 숨긴다.
 *
 * **쓰기 관문은 여기서도 세운다.** 코어의 validate() 가 이제 노출 여부를
 * 보지만(c19ca51 에서 고쳤다 — 그전에는 validate('dbpass','x') 가 ok 였다),
 * 그 하나에만 기대지 않는다. 비밀 키가 써지는 사고는 되돌릴 수 없고, 관문
 * 하나가 바뀌는 것은 남의 파일 한 줄이다. 두 겹으로 둔다.
 */
function isWritable(key) {
    return schema.exposed().indexOf(key) >= 0;
}

// 값을 절대 내보내지 않는 키. **표에서 뽑는다** — 손 목록은 새 비밀 키를 놓친다.
var SECRET = schema.all().filter(function (k) { return schema.get(k).secret === true; });

/**
 * 값을 바꾸면 특히 위험한 것. 화면이 눈에 띄게 표시한다.
 *
 * 스키마의 help 에도 설명이 있지만, 문장을 읽어야 알 수 있는 것과 색으로 바로
 * 보이는 것은 다르다. 여기 있는 것은 **켠 채로 두면 보안이 무력해지는** 값이다.
 */
var DANGER = {
    acpObserveMode: function (v) { return v === 'observe'; },
    acpDiscoveryFilter: function (v) { return v === 'off'; },
    defaultAccessPolicy: function (v) { return v === 'enable'; }
};

function ConfStore(file) {
    this.file = file;
}

// 파일이 없으면 빈 설정이다 — 읽기는 기본값으로 답하고, 쓰기만 파일을 만든다.
// 깨졌으면 던진다. 호출부(CLI)가 덮어쓰지 않고 종료한다.
ConfStore.prototype._read = function () {
    try {
        return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
        if (e && e.code === 'ENOENT') { return {}; }
        throw e;
    }
};

/**
 * 화면에 줄 것. **비밀은 값 없이 존재 여부만 나간다.**
 *
 * 항목의 모양은 코어 describe() 를 그대로 쓰고, 파일 상태(있는가·무엇인가)만
 * 얹는다. 라벨·도움말·유효값을 여기서 다시 쓰지 않는다.
 */
ConfStore.prototype.view = function () {
    var conf = this._read();
    var desc = schema.describe();

    var items = Object.keys(desc).map(function (key) {
        var s = desc[key];
        var set = Object.prototype.hasOwnProperty.call(conf, key);
        var eff = set ? conf[key] : s.dflt;
        var isDanger = typeof DANGER[key] === 'function' && !!DANGER[key](eff);
        return {
            key: key,
            label: s.label,
            help: s.help,
            type: s.type,
            apply: s.apply,
            // reload 인 키는 무엇을 다시 불러야 하는지 함께 온다.
            reloadWith: s.reloadWith || null,
            integer: !!s.integer,
            // 소속은 코어가 정한다. 화면은 순서와 설명만 정한다.
            group: s.group || null,
            readOnly: !!s.readOnly,
            choices: schema.choices(key),
            validHint: s.validHint,
            dflt: s.dflt,
            // 파일에 없으면 기본값이 쓰인다. 그 사실을 화면이 구분해야 한다.
            fileValue: set ? conf[key] : null,
            usingDefault: !set,
            effective: eff,
            danger: isDanger
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

    // 코어가 아는 키에도, 비밀에도 없는 것. 다른 세션이 넣었을 수 있다.
    var known = schema.all();
    var unknown = Object.keys(conf).filter(function (k) { return known.indexOf(k) < 0; });

    return { items: items, secrets: secrets, unknownKeys: unknown, file: this.file };
};

/**
 * 이 키를 이 값으로 고쳐도 되는가. 되면 null, 아니면 사유.
 *
 * **관문이 둘이다.** 먼저 노출 키인지 보고, 그 다음 값을 스키마에 맡긴다.
 * 코어도 노출 여부를 보게 됐지만 겹쳐 둔다 — 잘못 통과하면 비밀이 파일에
 * 써지고, 그건 되돌릴 수 없다.
 */
ConfStore.prototype.validate = function (key, value) {
    if (!isWritable(key)) { return '고칠 수 없는 키다 (노출 대상이 아니다): ' + key; }
    var v = schema.validate(key, value);
    return v.ok ? null : (key + ': ' + v.reason);
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

ConfStore.prototype._writeAtomic = function (obj) {
    conf_write.writeAtomic(this.file, obj);
};

/**
 * 키를 지워 기본값으로 되돌린다.
 *
 * **update 와 같은 관문을 지난다** — 노출 여부(isWritable)와 읽기 전용. 값이 없는
 * 경로라 schema.validate 를 그대로 못 쓴다(타입 검사가 undefined 를 거절한다).
 * 값 없는 경로로 관문을 빼먹으면 `unset dbpass` 가 통하고, 읽기 전용을 안 보면
 * `unset retentionPolicies` 가 규칙 배열을 날린다 — unset 도 값을 바꾸는 저장이다.
 */
ConfStore.prototype.removeKey = function (key) {
    if (!isWritable(key)) {
        return { ok: false, changed: [], errors: ['고칠 수 없는 키다 (노출 대상이 아니다): ' + key] };
    }
    var s = schema.get(key);
    if (s && s.readOnly) {
        return { ok: false, changed: [], errors: ['고칠 수 없는 키다 (읽기 전용이다): ' + key] };
    }
    var conf = this._read();
    if (!Object.prototype.hasOwnProperty.call(conf, key)) { return { ok: true, changed: [], errors: [] }; }
    var before = conf[key];
    delete conf[key];
    this._writeAtomic(conf);
    return { ok: true, changed: [{ key: key, from: before, to: null }], errors: [] };
};

/**
 * 첫 구동 마법사가 묻는 일곱 키(순서대로). create() 는 이 밖의 키를 거부한다.
 * dbpass 는 db 가 그것을 쓰는 백엔드일 때만 온다.
 */
var WIZARD_KEYS = ['db', 'dbpass', 'cseBase', 'cseId', 'spId', 'superUser', 'csebaseport'];

/**
 * 파일이 **없을 때만** 만든다 — 첫 구동 마법사 전용. update() 를 우회하는 둘 중 하나.
 *
 * isWritable() 대신 WIZARD_KEYS 화이트리스트로 거르고, 값은 checkValue() 의
 * 타입·유효값 검사만 지난다(validate() 는 dbpass·csebaseport 를 막는다 — 그래서
 * 이 API 가 있다). 존재 확인과 쓰기 사이의 경합은 wx 플래그가 막는다.
 */
ConfStore.prototype.create = function (obj) {
    var keys = Object.keys(obj || {});
    var outside = keys.filter(function (k) { return WIZARD_KEYS.indexOf(k) < 0; });
    if (outside.length) {
        return { ok: false, errors: ['처음 만들 때 쓸 수 없는 키다: ' + outside.join(', ')] };
    }
    var errors = [];
    keys.forEach(function (k) {
        var r = schema.checkValue(k, obj[k]);
        if (!r.ok) { errors.push(k + ': ' + r.reason); }
    });
    if (errors.length) { return { ok: false, errors: errors }; }
    if (fs.existsSync(this.file)) { return { ok: false, errors: ['이미 있다: ' + this.file] }; }
    try {
        conf_write.createExclusive(this.file, obj);
    } catch (e) {
        if (e && e.code === 'EEXIST') { return { ok: false, errors: ['이미 있다: ' + this.file] }; }
        throw e;
    }
    return { ok: true, errors: [] };
};

/**
 * `npm run setup -- --dbpass` 전용. update() 를 우회하는 둘 중 나머지 하나.
 * 대상 키를 dbpass 하나로 못박는다. 파일이 있어야 한다(없으면 _read 가 {} 를 주지만
 * 그 경로로 파일을 만들면 안 되므로 먼저 확인한다 — ENOENT 를 던진다).
 */
ConfStore.prototype.setSecret = function (key, value) {
    if (key !== 'dbpass') { return { ok: false, errors: ['이 경로로 바꿀 수 있는 것은 dbpass 뿐이다'] }; }
    if (typeof value !== 'string') { return { ok: false, errors: ['문자열이 아니다'] }; }
    fs.readFileSync(this.file, 'utf8');   // 없으면 ENOENT
    var conf = this._read();
    conf[key] = value;
    this._writeAtomic(conf);
    return { ok: true, errors: [] };
};

exports.ConfStore = ConfStore;
exports.APPLY = APPLY;
exports.SECRET = SECRET;
exports.DANGER = DANGER;
exports.WIZARD_KEYS = WIZARD_KEYS;
