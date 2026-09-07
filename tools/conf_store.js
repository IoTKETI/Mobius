'use strict';
/**
 * Reads and writes conf.json safely. Used by the CLI (tools/mobius-conf.js) and the wizard (tools/setup.js).
 *
 * Three rules.
 *
 *   1. Unknown keys are preserved: conf.json is edited by several sessions and people, and a read-modify-write must not drop keys others added.
 *   2. Writes are atomic: mobius/conf_write.js does the write (tmp+rename), because every Mobius worker reads the file at boot and must never see a half-written file.
 *   3. Secrets are never exported: only whether they are present.
 *
 * Only create() and setSecret() bypass update(): the first-run wizard must write dbpass and csebaseport, which isWritable() blocks. Both are narrowed by a whitelist (see each function) and both seal after writing (mobius/conf_seal).
 *
 * The schema comes from the core (mobius/conf_schema); this file is only the read/write machinery. Require it after global.usedb is set, because the key table follows the backend.
 */

var fs = require('fs');
var path = require('path');
var schema = require(path.join(__dirname, '..', 'mobius', 'conf_schema'));
var conf_write = require(path.join(__dirname, '..', 'mobius', 'conf_write'));
var conf_seal = require(path.join(__dirname, '..', 'mobius', 'conf_seal'));

/**
 * Apply timing.
 *
 *   runtime  the global is read per request, so changing the value takes effect at once
 *   reload   changing the global is not enough; the module caches the value and acp_observe.configure() must be called again
 *   restart  Mobius must be restarted
 */
var APPLY = { RUNTIME: 'runtime', RELOAD: 'reload', RESTART: 'restart' };

/**
 * Which keys are exposed is decided by the core schema; no list is repeated here.
 *
 * The write gate is duplicated here on purpose: the core's validate() also checks exposure, but a secret key written to the file cannot be undone, so two layers guard it.
 */
function isWritable(key) {
    return schema.exposed().indexOf(key) >= 0;
}

// Keys whose value is never exported, taken from the table so a new secret key is not missed.
var SECRET = schema.all().filter(function (k) { return schema.get(k).secret === true; });

/** Values that are especially dangerous to change; the screen marks them visibly. These are the values that disable security when left on. */
var DANGER = {
    acpObserveMode: function (v) { return v === 'observe'; },
    acpDiscoveryFilter: function (v) { return v === 'off'; },
    defaultAccessPolicy: function (v) { return v === 'enable'; }
};

function ConfStore(file) {
    this.file = file;
}

// A missing file is an empty configuration: reads answer with defaults, and only writes create the file. A broken file throws; the caller (CLI) exits without overwriting.
ConfStore.prototype._read = function () {
    try {
        return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
        if (e && e.code === 'ENOENT') { return {}; }
        throw e;
    }
};

/**
 * What the screen receives. Secrets are exported as presence only, without the value.
 *
 * Items use the core's describe() as is, with the file state (present, value) added; labels, help and valid values are not restated here.
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
            // A reload key carries what has to be reloaded.
            reloadWith: s.reloadWith || null,
            integer: !!s.integer,
            // The group is decided by the core; the screen decides only order and description.
            group: s.group || null,
            readOnly: !!s.readOnly,
            choices: schema.choices(key),
            validHint: s.validHint,
            dflt: s.dflt,
            // A key absent from the file uses its default; the screen must show the difference.
            fileValue: set ? conf[key] : null,
            usingDefault: !set,
            effective: eff,
            danger: isDanger
        };
    });

    var secrets = SECRET.map(function (key) {
        return {
            key: key,
            // The value is never exported, not even its length.
            present: Object.prototype.hasOwnProperty.call(conf, key) &&
                     conf[key] !== '' && conf[key] !== null && conf[key] !== undefined
        };
    });

    // Keys known neither to the core nor as secrets; another session may have added them.
    var known = schema.all();
    var unknown = Object.keys(conf).filter(function (k) { return known.indexOf(k) < 0; });

    return { items: items, secrets: secrets, unknownKeys: unknown, file: this.file };
};

/**
 * Whether this key may be set to this value: null when allowed, otherwise the reason.
 *
 * Two gates: exposure first, then the schema validates the value. The core also checks exposure; the duplication stays because a secret written to the file cannot be undone.
 */
ConfStore.prototype.validate = function (key, value) {
    if (!isWritable(key)) { return '고칠 수 없는 키다 (노출 대상이 아니다): ' + key; }
    var v = schema.validate(key, value);
    return v.ok ? null : (key + ': ' + v.reason);
};

/**
 * Applies a patch. Unknown keys are kept.
 *
 * The file is not rewritten wholesale: the read object is modified for the given keys only and written back, so keys added by others survive. The window between read and write is not locked (one administrator, rare changes); the write itself is atomic.
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
    // One invalid key means nothing is written; a partial update would leave the file out of step with what the screen showed.
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
 * Removes a key, returning it to its default.
 *
 * Passes the same gates as update (exposure via isWritable, and read-only); schema.validate cannot be used on a valueless path because the type check rejects undefined. Without the gates `unset dbpass` would pass and `unset retentionPolicies` would drop the rule array.
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

/** The seven keys the first-run wizard asks, in order. create() rejects any other key. dbpass is included only when the chosen db backend uses it. */
var WIZARD_KEYS = ['db', 'dbpass', 'cseBase', 'cseId', 'spId', 'superUser', 'csebaseport'];

/**
 * Creates the file only when it does not exist; first-run wizard only. One of the two APIs that bypass update().
 *
 * Keys are filtered by the WIZARD_KEYS whitelist instead of isWritable(), and values pass only checkValue()'s type and valid-value checks (validate() blocks dbpass and csebaseport, which is why this API exists). The race between the existence check and the write is closed by the wx flag.
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
    // Sealing is separated from file creation: inside the same try, a seal failure would take the EEXIST branch and report 'already exists' for a file that was just created.
    try {
        conf_seal.seal(this.file, obj);
    } catch (e) {
        throw new Error('[설정] conf.json 은 만들었지만 봉인에 실패했다: ' + ((e && e.message) || e) +
                        ' — npm run setup -- --superuser 로 봉인을 다시 만들 것');
    }
    return { ok: true, errors: [] };
};

/** For `npm run setup -- --dbpass` / `-- --superuser` only; the other API that bypasses update(). The target key is limited to the two REENTRY_KEYS; the console's secrets (adminPassword, adminOrigin) cannot be changed here. The file must exist (a missing file must not be created on this path, so ENOENT is thrown first). */
var REENTRY_KEYS = ['dbpass', 'superUser'];

ConfStore.prototype.setSecret = function (key, value) {
    if (REENTRY_KEYS.indexOf(key) < 0) {
        return { ok: false, errors: ['이 경로로 바꿀 수 있는 것은 ' + REENTRY_KEYS.join('·') + ' 뿐이다'] };
    }
    if (typeof value !== 'string') { return { ok: false, errors: ['문자열이 아니다'] }; }
    fs.readFileSync(this.file, 'utf8');   // ENOENT when missing
    var conf = this._read();
    conf[key] = value;
    this._writeAtomic(conf);
    conf_seal.seal(this.file, conf);
    return { ok: true, errors: [] };
};

/**
 * Keeps the values and (re)creates the seal only. Used when Enter (an empty answer) is given at the `npm run setup -- --dbpass`/`--superuser` prompt. No validation and no write: the HMAC is recomputed from the dbpass and superUser currently in the file. conf_seal.seal reuses the existing key when there is one.
 *
 * The file must exist (ENOENT otherwise, as in setSecret).
 *
 * @returns { ok:true, created }  created is whether the seal file did not exist before (was created by this call)
 */
ConfStore.prototype.reseal = function () {
    fs.readFileSync(this.file, 'utf8');   // ENOENT when missing
    var conf = this._read();
    var created = !fs.existsSync(conf_seal.sealPath(this.file));
    try {
        conf_seal.seal(this.file, conf);
    } catch (e) {
        throw new Error('[설정] 봉인에 실패했다: ' + ((e && e.message) || e) +
                        ' — npm run setup -- --superuser 로 봉인을 다시 만들 것');
    }
    return { ok: true, created: created };
};

exports.ConfStore = ConfStore;
exports.APPLY = APPLY;
exports.SECRET = SECRET;
exports.DANGER = DANGER;
exports.WIZARD_KEYS = WIZARD_KEYS;
exports.REENTRY_KEYS = REENTRY_KEYS;
