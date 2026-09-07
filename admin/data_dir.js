'use strict';
/**
 * 콘솔의 결과 파일 자리 — admin/data/<하위>/. gitignore 다.
 *
 * 미연결 탐지 결과(Task 9)와 종합 테스트 이력(2/2 계획)이 쓴다. 쓰기는 tmp + rename
 * 이라 반쯤 쓰인 파일이 목록에 올라오지 않고, 깨진 파일은 목록에서 broken 으로
 * 표시만 한다 — 조용히 건너뛰지 않는다.
 */
var fs = require('fs');
var path = require('path');
var conf_write = require('../mobius/conf_write');

exports.file = function (dataDir, sub, name) {
    var dir = path.join(dataDir, sub);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, name);
};

exports.writeJson = function (file, obj) {
    conf_write.writeAtomic(file, obj);
};

exports.listJson = function (dataDir, sub) {
    var dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir)
        .filter(function (f) { return /\.json$/.test(f); })
        .map(function (f) {
            var p = path.join(dir, f);
            var st = fs.statSync(p);
            var item = { name: f, path: p, mtime: st.mtimeMs };
            try { JSON.parse(fs.readFileSync(p, 'utf8')); }
            catch (e) { item.broken = true; }
            return item;
        })
        // 최신순. **이름으로 동점을 깬다** — 같은 밀리초에 쓰인 두 파일은 mtime 이 같아
        // 순서가 뒤집힌다(배포 리눅스에서 시험이 그렇게 깨졌다, 2026-09-07). 파일 이름은
        // runId 라 앞이 UTC 타임스탬프이므로 이름 내림차순이 곧 최신순이다.
        .sort(function (a, b) { return (b.mtime - a.mtime) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0); });
};

exports.readJson = function (file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
};

exports.keepLatest = function (dataDir, sub, n) {
    exports.listJson(dataDir, sub).slice(n).forEach(function (item) {
        try { fs.unlinkSync(item.path); } catch (e) { /* 이미 없으면 그만 */ }
    });
};
