/**
 * 콜백을 한 번만 통과시킨다.
 *
 * Mobius 의 상위 콜백은 응답 전송과 DB 커넥션 반납을 함께 한다. 게다가 반납
 * 직후 request 와 response 를 null 로 비운다. 그래서 콜백이 두 번 불리면
 *
 *   - 두 번째 호출이 null 이 된 request/response 를 역참조해 워커가 죽고
 *   - 커넥션이 풀에 두 번 반납돼, 그 사이 다른 요청이 빌려간 커넥션을 빼앗는다
 *
 * poa 가 2개인 remoteCSE 로 요청을 포워딩하면 실제로 이렇게 죽었다.
 * check_csr 이 poa 배열을 for 로 돌며 매 반복마다 콜백을 불렀기 때문이다.
 *
 *     TypeError: Cannot read properties of null (reading 'query')
 *         at sendError (mobius/responder.js)
 *         at response_error_result (app.js)
 *
 * once() 는 그 원인을 고치지 않는다 — 원인은 각 호출부에서 고쳐야 한다.
 * 다만 같은 실수가 다시 생겼을 때 워커를 죽이지 않게 막아 준다.
 *
 * 억눌린 호출은 반드시 로그로 남긴다. 조용히 삼키면 새 결함이 묻힌다.
 */

var util = require('util');

/**
 * fn 을 감싸 첫 호출만 통과시킨다.
 *
 * @param {Function} fn     원래 콜백
 * @param {string} [label]  로그에 남길 이름. 어느 경로인지 알 수 있게 적는다
 * @returns {Function}      감싼 콜백. 첫 호출의 반환값을 그대로 돌려준다
 */
function once(fn, label) {
    if (typeof fn !== 'function') {
        // 콜백 자리에 함수가 아닌 것이 오면 그 자체가 결함이다. 감추지 않는다.
        throw new TypeError('once: 콜백이 함수가 아니다 (' + (label || '이름 없음') + ')');
    }

    var called = false;
    var name = label || fn.name || '이름 없음';

    var wrapped = function () {
        if (called) {
            // 어디서 두 번째로 불렀는지가 유일한 단서다. 스택을 몇 줄 남긴다.
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

/**
 * 이미 감싼 콜백인지 확인한다. 이중으로 감싸도 무해하지만,
 * 호출부를 정리할 때 알아볼 수 있어야 한다.
 */
once.wrapped = function (fn) {
    return typeof fn === 'function' && fn.__once === true;
};

module.exports = once;
