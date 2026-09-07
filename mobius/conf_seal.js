'use strict';
/**
 * Seal for the secret keys: conf.seal.json
 *
 * dbpass and superUser may only be changed through the tools. Editing them by hand in conf.json makes the next boot refuse to start. The values are not hidden (conf.json is plain text); only hand edits are detected.
 *
 *   { "key": <32 random bytes, hex>, "keys": ["dbpass","superUser"],
 *     "seal": HMAC-SHA256(key, JSON.stringify({dbpass: value|null, superUser: value|null})) hex, "at": … }
 *
 * Written by the first-run wizard (conf_load.first_run), ConfStore.create/setSecret and ConfStore.reseal; read by conf_load. The console secrets (adminPassword, adminOrigin) are not sealed.
 */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var conf_write = require('./conf_write');

var KEYS = ['dbpass', 'superUser'];

function seal_path(confFile) { return path.join(path.dirname(confFile), 'conf.seal.json'); }

// Only the sealed keys; a missing key is recorded as null so adding or removing it by hand is detected. Values are taken as they are, whatever their type.
function payload(conf) {
    var o = {};
    KEYS.forEach(function (k) { o[k] = (conf && conf[k] !== undefined) ? conf[k] : null; });
    return JSON.stringify(o);
}
function hmac(keyHex, conf) {
    return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(payload(conf)).digest('hex');
}
// Distinguishes a read failure (e.g. EACCES) from broken content: an fs error code is passed on, a JSON parse error is reported as broken by verify().
function read_seal(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return { error: (e && e.code) || null }; }
}

exports.seal = function (confFile, conf) {
    var file = seal_path(confFile);
    var prev = read_seal(file);
    var key = (prev && typeof prev.key === 'string' && /^[0-9a-f]{64}$/.test(prev.key))
        ? prev.key : crypto.randomBytes(32).toString('hex');
    var rec = { key: key, keys: KEYS.slice(), seal: hmac(key, conf), at: new Date().toISOString() };
    conf_write.writeAtomic(file, rec);
    try { fs.chmodSync(file, 0o600); } catch (e) { /* no file modes on Windows */ }
    return rec;
};

exports.verify = function (confFile, conf) {
    var file = seal_path(confFile);
    if (!fs.existsSync(file)) { return { ok: false, reason: '봉인이 없다 (' + file + ')' }; }
    var rec = read_seal(file);
    if (rec && rec.error) {
        return { ok: false, reason: '봉인 파일을 읽지 못했다(' + rec.error + ') (' + file + ')' };
    }
    if (!rec || typeof rec.key !== 'string' || !/^[0-9a-f]{64}$/.test(rec.key) || typeof rec.seal !== 'string') {
        return { ok: false, reason: '봉인 파일이 깨졌다 (' + file + ')' };
    }
    // A different sealed key set is reported as stale, not as a mismatch.
    if (!Array.isArray(rec.keys) || rec.keys.length !== KEYS.length || rec.keys.some(function (k, i) { return k !== KEYS[i]; })) {
        return { ok: false, reason: '봉인이 낡았다(봉인 대상 키가 바뀌었다) — npm run setup -- --superuser 로 다시 만들 것' };
    }
    if (hmac(rec.key, conf) !== rec.seal) { return { ok: false, reason: 'dbpass·superUser 가 도구 밖에서 바뀌었다' }; }
    return { ok: true };
};

exports.sealPath = seal_path;
exports.KEYS = KEYS;
