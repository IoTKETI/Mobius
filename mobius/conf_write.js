'use strict';
/**
 * conf.json 을 안전하게 쓴다. admin/conf_store.js 의 _writeAtomic 을 코어로 내렸다 —
 * 첫 구동 마법사(코어)도 파일을 만들어야 하는데 코어는 tools/ 를 require 하지 않는다.
 */
var fs = require('fs');
var path = require('path');

/**
 * 같은 디렉터리에 임시 파일로 쓰고 rename 한다.
 *
 * 워커 25개가 기동 때 이 파일을 읽는다. 제자리에서 고치면 쓰는 도중에 뜬
 * 워커가 반쪽 JSON 을 읽고 parse 에서 던져 못 뜬다. rename 은 같은 볼륨에서
 * 원자적이라 워커는 언제 읽어도 온전한 파일을 본다.
 */
exports.writeAtomic = function (file, obj) {
    var dir = path.dirname(file);
    var tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.' + Date.now() + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 4) + '\n', 'utf8');
    try {
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* 정리 실패가 원인을 가리지 않게 */ }
        throw e;
    }
};

/**
 * 파일이 **없을 때만** 만든다. 존재 확인과 쓰기 사이의 경합은 rename 이 아니라
 * wx 플래그가 막는다 — 그 사이 누가 만들었으면 EEXIST 로 던진다.
 */
exports.createExclusive = function (file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 4) + '\n', { encoding: 'utf8', flag: 'wx' });
};
