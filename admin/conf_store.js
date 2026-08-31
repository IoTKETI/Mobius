'use strict';
/**
 * conf.json 을 안전하게 읽고 쓴다.
 *
 * 화면이 설정을 고칠 수 있게 하려면 세 가지가 먼저 성립해야 한다.
 *
 *   1. **모르는 키를 보존한다.** conf.json 은 여러 세션·사람이 동시에 고친다.
 *      읽고-고쳐-쓰기를 하면 그 사이 남이 넣은 키를 조용히 날린다.
 *   2. **원자적으로 쓴다.** 같은 파일을 Mobius 워커 25개가 기동 때 읽는다.
 *      쓰는 도중 워커가 되살아나 반쪽 파일을 읽으면 그 워커가 못 뜨는 데서
 *      끝나지 않는다 — mobius.js:20-28 의 catch 가 **설정 전체를 버리고
 *      csebaseport/dbpass/usesqlite 세 개만 남긴 conf.json 을 덮어쓴다.**
 *      게다가 그 dbpass 는 하드코딩된 기본값이다. 즉 반쪽 파일을 한 번 읽히면
 *      adminPassword·superUser·acp* 설정이 통째로 사라지고 DB 비밀번호가
 *      기본값으로 바뀐다. 콘솔도 adminPassword 가 없으면 뜨지 않으므로 같이
 *      죽는다. 원자적 쓰기는 편의가 아니라 이 파괴를 막는 장치다.
 *   3. **비밀은 값을 내보내지 않는다.** dbpass·superUser·adminPassword 는
 *      화면에 값이 뜨면 안 된다. 있는지 없는지만 말한다.
 *
 * **스키마는 코어가 준다**(`mobius/conf_schema`). 그 표는 mobius.js 가 실제로
 * 읽는 것과 양방향으로 대조되므로(코어의 test/conf-schema.test.js) 손으로 적은
 * 표처럼 갈라지지 않는다. 이 파일은 읽기/쓰기 기계만 맡는다.
 */

var fs = require('fs');
var path = require('path');
var schema = require(path.join(__dirname, '..', 'mobius', 'conf_schema'));

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
 * **다만 쓰기 관문은 여기서 다시 세운다.** conf_schema.validate() 는 노출
 * 목록에 없는 키에 대해 {ok:true} 를 돌려준다(실측: validate('dbpass','x')
 * -> ok:true). 검증을 통째로 위임하면 비밀 키가 그대로 써진다. 그래서
 * exposed() 에 있는 키인지 먼저 보고, 값 검증만 스키마에 맡긴다.
 */
function isWritable(key) {
    return schema.exposed().indexOf(key) >= 0;
}

/**
 * 값을 절대 내보내지 않는 키. **있는지 없는지만** 말한다.
 *
 * superUser 는 아는 사람이 ACP 를 전부 우회한다(security.js 가 그 origin 을
 * 무조건 통과시킨다). adminPassword 는 콘솔 자신의 인증이라, 화면에서 고치게
 * 두면 스스로 잠근다. adminOrigin 은 콘솔의 쓰기 권한을 정한다.
 */
var SECRET = ['dbpass', 'superUser', 'adminPassword', 'adminOrigin'];

/**
 * 콘솔 자신의 설정 키.
 *
 * conf.json 하나에 Mobius 것과 콘솔 것이 같이 산다. 코어 스키마는 **mobius.js 가
 * 읽는 것**만 알므로 이 키들을 모른다 — 넣어 주지 않으면 화면이 "모르는 키"
 * 라고 표시한다(다른 세션이 넣은 것처럼 보인다).
 *
 * 화면에서 고치지는 않는다. adminPort/adminHost 를 바꾸면 콘솔이 자기가 듣던
 * 자리를 옮기는 것이고, adminCsePort 를 바꾸면 쓰기 대상이 바뀐다 — 잘못 넣으면
 * 다음 재기동에 화면으로 돌아올 길이 없다.
 */
var CONSOLE_KEYS = ['adminPort', 'adminHost', 'adminCseHost', 'adminCsePort'];

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

ConfStore.prototype._read = function () {
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
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
            // describe() 가 reloadWith 를 안 실어 준다. _SCHEMA 에는 있으므로
            // 여기서 집어 온다 — 화면이 "무엇을 다시 불러야 하는가" 를
            // 말하려면 필요하다. describe() 에 들어오면 이 줄을 지운다.
            reloadWith: (schema._SCHEMA[key] || {}).reloadWith || null,
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

    // 코어가 아는 키에도, 비밀에도, 콘솔 자신의 키에도 없는 것.
    // 다른 세션이 넣었을 수 있다.
    var known = schema.all().concat(SECRET, CONSOLE_KEYS);
    var unknown = Object.keys(conf).filter(function (k) { return known.indexOf(k) < 0; });

    return { items: items, secrets: secrets, unknownKeys: unknown, file: this.file };
};

/**
 * 이 키를 이 값으로 고쳐도 되는가. 되면 null, 아니면 사유.
 *
 * **관문이 둘이다.** 먼저 노출 키인지 보고, 그 다음 값을 스키마에 맡긴다.
 * 스키마의 validate() 는 모르는 키에 {ok:true} 를 주므로(실측) 첫 관문이
 * 없으면 dbpass 가 그대로 써진다.
 */
ConfStore.prototype.validate = function (key, value) {
    if (!isWritable(key)) { return '화면에서 고칠 수 없는 키다: ' + key; }
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
exports.SECRET = SECRET;
exports.CONSOLE_KEYS = CONSOLE_KEYS;
exports.DANGER = DANGER;
