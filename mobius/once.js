/** Wraps a callback so that only its first invocation runs. Later invocations are ignored and logged with a short stack trace. */

var util = require('util');

/**
 * Wraps fn so that only the first call goes through.
 * 
 * @param {Function} fn     the original callback
 * @param {string} [label]  name used in the log line
 * @returns {Function}      the wrapped callback; returns the first call's return value
 */
function once(fn, label) {
    if (typeof fn !== 'function') {
        // A non-function callback is a programming error; fail loudly.
        throw new TypeError('once: 콜백이 함수가 아니다 (' + (label || '이름 없음') + ')');
    }

    var called = false;
    var name = label || fn.name || '이름 없음';

    var wrapped = function () {
        if (called) {
            // Log a few stack frames so the second call site can be found.
            var where = new Error().stack.split('\n').slice(1, 5).join('\n');
            console.error(util.format('[once] 콜백이 두 번 이상 호출됐다 — 무시한다: %s\n%s', name, where));
            return undefined;
        }
        called = true;
        return fn.apply(this, arguments);
    };

    wrapped.__once = true;
    return wrapped;
}

/** Returns true when fn has already been wrapped by once(). */
once.wrapped = function (fn) {
    return typeof fn === 'function' && fn.__once === true;
};

module.exports = once;
