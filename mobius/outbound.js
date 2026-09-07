'use strict';
// Timeouts for outbound HTTP/HTTPS/CoAP requests.
// 
// Every request the server sends (fan-out, CSR forwarding, notifications) is armed with a timeout. The default comes from conf.json (outboundTimeoutMs, 10 s when unset); arm() accepts a per-call override.

var DEFAULT_MS = 10000;

function limitMs(override) {
    if (typeof override === 'number' && override > 0) { return override; }
    var g = global.outbound_timeout_ms;
    return (typeof g === 'number' && g > 0) ? g : DEFAULT_MS;
}

// Arms a timeout on a request object.
// 
//   req    http/https ClientRequest or a coap request
//   label  name used in the log line
//   ms     override; defaults to the global limit
// 
// On timeout the request is destroyed, which emits 'error' so the caller's existing error handler cleans up.
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

    // http/https: use the socket idle timer. It measures idle time only, not total elapsed time, so a peer that keeps sending bytes is not cut off.
    if (typeof req.setTimeout === 'function') {
        req.setTimeout(limit, onTimeout);
        return;
    }

    // coap and other implementations without setTimeout(): use a private timer.
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
