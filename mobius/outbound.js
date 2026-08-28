'use strict';
//
// 아웃바운드 요청 타임아웃
//
// 서버가 내보내는 HTTP/HTTPS/CoAP 요청에 타임아웃이 한 곳도 없었다.
// req.on('error') 는 있었지만 그건 연결 실패만 잡는다. 상대가 TCP 는 받아놓고
// 응답 바디를 안 주면 res 의 'end' 가 영원히 오지 않는다.
//
// 그게 왜 문제인가
//   응답을 기다리는 경로(팬아웃·CSR 포워딩·AE 알림)는 요청 핸들러가 그 자리에
//   멈춘다. 멈춘 요청은 connection.release() 에 도달하지 못하므로 DB 풀
//   커넥션을 함께 묶는다. 워커당 풀 한도가 100 이라 느린 상대 100 곳이면
//   워커가 정지한다.
//
//   알림처럼 응답을 안 기다리는 경로는 요청이 멈추지는 않지만 소켓과 파일
//   디스크립터가 쌓인다.
//
// 값은 어떻게 정했나
//   경로별로 다르게 줄 근거(상대별 응답시간 분포)가 없어서 하나의 기본값을
//   쓰고 conf.json 으로 뺐다. 근거 없이 경로마다 다른 숫자를 박아 두는 것보다
//   낫다. 실측이 쌓이면 arm() 의 세 번째 인자로 개별 조정한다.

var DEFAULT_MS = 10000;

function limitMs(override) {
    if (typeof override === 'number' && override > 0) { return override; }
    var g = global.outbound_timeout_ms;
    return (typeof g === 'number' && g > 0) ? g : DEFAULT_MS;
}

// 요청 객체에 타임아웃을 건다.
//
//   req    http/https 의 ClientRequest 또는 coap 의 요청 객체
//   label  로그에 남길 이름 (어느 경로가 멈췄는지 알아야 한다)
//   ms     생략하면 전역 기본값
//
// 타임아웃이 터지면 요청을 파기한다. 파기하면 'error' 가 발생하므로 각
// 호출부에 이미 있는 req.on('error') 핸들러가 그대로 뒷정리를 한다 —
// 호출부 흐름을 바꾸지 않으려고 이 방식을 골랐다.
function arm(req, label, ms) {
    if (!req) { return; }
    var limit = limitMs(ms);
    var fired = false;

    function onTimeout() {
        if (fired) { return; }
        fired = true;
        console.error('[outbound] ' + label + ' 응답이 ' + limit + 'ms 안에 오지 않아 끊는다');
        try {
            if (typeof req.destroy === 'function') { req.destroy(new Error('outbound timeout: ' + label)); }
            else if (typeof req.abort === 'function') { req.abort(); }
            else if (typeof req.emit === 'function') { req.emit('error', new Error('outbound timeout: ' + label)); }
        } catch (e) {
            console.error('[outbound] ' + label + ' 파기 실패: ' + e.message);
        }
    }

    // http/https 는 소켓 무응답 타이머를 직접 지원한다.
    if (typeof req.setTimeout === 'function') {
        req.setTimeout(limit, onTimeout);
        return;
    }

    // coap 등 setTimeout 이 없는 구현은 자체 타이머로 처리한다.
    var timer = setTimeout(onTimeout, limit);
    if (timer && typeof timer.unref === 'function') { timer.unref(); }

    function clear() { clearTimeout(timer); }
    if (typeof req.once === 'function') {
        req.once('response', clear);
        req.once('error', clear);
        req.once('close', clear);
    }
}

module.exports = {
    DEFAULT_MS: DEFAULT_MS,
    limitMs: limitMs,
    arm: arm
};
