'use strict';
/**
 * 비밀 봉인 — conf.seal.json (스펙 §13.2)
 *
 * dbpass·superUser 를 **도구로만** 바꾸게 한다. 권한이 아니라 경로다: conf.json 을 편집기로
 * 열어 이 둘을 고치면 다음 기동이 거부된다. 값을 숨기는 것이 아니다(conf.json 은 평문).
 *
 *   { "key": <난수 32바이트 hex>, "keys": ["dbpass","superUser"],
 *     "seal": HMAC-SHA256(key, JSON.stringify({dbpass: 값|null, superUser: 값|null})) hex, "at": … }
 *
 * 쓰는 곳은 둘뿐 — 마법사(conf_load.first_run)와 ConfStore.create/setSecret. "지금 값을 봉인"
 * 하는 명령은 두지 않는다(손으로 고치고 봉인하는 뒷문이 된다). 읽는 곳은 conf_load 다.
 *
 * 한계: 같은 계정이 key 로 HMAC 을 계산하면 우회할 수 있다. 소유자·사용자를 나누지 않기로
 * 했으므로 막지 않는다. 콘솔의 비밀(adminPassword·adminOrigin)은 대상이 아니다 — 고급 키라
 * 손편집이 설계다.
 */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var conf_write = require('./conf_write');

var KEYS = ['dbpass', 'superUser'];

function seal_path(confFile) { return path.join(path.dirname(confFile), 'conf.seal.json'); }

// 대상 키만, 없으면 null — 키가 없다는 사실도 봉인에 들어가야 손으로 지우거나 넣은 것을 잡는다.
// 값을 문자열로만 좁히지 않는다 — 숫자·불리언으로 손편집해도(예: "superUser": 123) 값이 그대로
// 봉인에 실려야 불일치로 잡힌다. 스키마는 둘 다 string 이지만 그 강제는 여기 일이 아니다.
function payload(conf) {
    var o = {};
    KEYS.forEach(function (k) { o[k] = (conf && conf[k] !== undefined) ? conf[k] : null; });
    return JSON.stringify(o);
}
function hmac(keyHex, conf) {
    return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(payload(conf)).digest('hex');
}
function read_seal(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

exports.seal = function (confFile, conf) {
    var file = seal_path(confFile);
    var prev = read_seal(file);
    var key = (prev && typeof prev.key === 'string' && /^[0-9a-f]{64}$/.test(prev.key))
        ? prev.key : crypto.randomBytes(32).toString('hex');
    var rec = { key: key, keys: KEYS.slice(), seal: hmac(key, conf), at: new Date().toISOString() };
    conf_write.writeAtomic(file, rec);
    try { fs.chmodSync(file, 0o600); } catch (e) { /* Windows 는 모드가 없다 */ }
    return rec;
};

exports.verify = function (confFile, conf) {
    var file = seal_path(confFile);
    if (!fs.existsSync(file)) { return { ok: false, reason: '봉인이 없다 (' + file + ')' }; }
    var rec = read_seal(file);
    if (!rec || typeof rec.key !== 'string' || !/^[0-9a-f]{64}$/.test(rec.key) || typeof rec.seal !== 'string') {
        return { ok: false, reason: '봉인 파일이 깨졌다 (' + file + ')' };
    }
    // 봉인 대상 키 집합이 지금 KEYS 와 다르면 불일치가 아니라 "낡음" 이다 — 훗날 대상이 늘어도
    // 옛 봉인 파일이 틀린 사유("도구 밖에서 바뀌었다")로 나가면 안 된다.
    if (!Array.isArray(rec.keys) || rec.keys.length !== KEYS.length || rec.keys.some(function (k, i) { return k !== KEYS[i]; })) {
        return { ok: false, reason: '봉인이 낡았다(봉인 대상 키가 바뀌었다) — npm run setup -- --superuser 로 다시 만들 것' };
    }
    if (hmac(rec.key, conf) !== rec.seal) { return { ok: false, reason: 'dbpass·superUser 가 도구 밖에서 바뀌었다' }; }
    return { ok: true };
};

exports.sealPath = seal_path;
exports.KEYS = KEYS;
