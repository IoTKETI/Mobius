'use strict';
/** Safe writes for conf.json (atomic replace and exclusive create). Lives in the core because the first-run wizard needs it. */
var fs = require('fs');
var path = require('path');

/** Writes to a temporary file in the same directory and renames it over the target, so readers always see a complete file. */
exports.writeAtomic = function (file, obj) {
    var dir = path.dirname(file);
    var tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.' + Date.now() + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 4) + '\n', 'utf8');
    try {
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* cleanup failure must not hide the original error */ }
        throw e;
    }
};

/** Creates the file only when it does not exist yet; the wx flag makes the check and the write atomic (EEXIST otherwise). */
exports.createExclusive = function (file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 4) + '\n', { encoding: 'utf8', flag: 'wx' });
};
