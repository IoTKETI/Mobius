'use strict';
/**
 * Mobius(CSE)로 나가는 oneM2M HTTP 클라이언트.
 *
 * 콘솔의 **쓰기는 전부 이 파일을 지난다.** DB 를 직접 고치지 않는 이유:
 *
 *   - 워커 캐시. Mobius 는 워커마다 리소스 행을 캐시하고 삭제 시 cluster IPC 로
 *     무효화를 브로드캐스트한다. 콘솔은 별도 프로세스라 그 IPC 에 낄 수 없다.
 *     DB 를 직접 지우면 워커들이 지워진 리소스를 계속 200 으로 돌려준다.
 *   - 구독 알림. 삭제는 sgn.check(..., 4, ...) 로 구독자에게 알린다.
 *   - 부모 카운터. CIN 삭제는 부모 CNT 의 cni/cbs 를 되돌려야 한다.
 *   - 하위 트리. 자손 삭제가 배경 작업으로 이어진다.
 *
 * 이 전부가 앱 레이어에 있다. 재구현하지 않고 그대로 쓴다.
 */

var http = require('http');
var url = require('url');

var DEFAULT_TIMEOUT_MS = 30000;

/**
 * @param opts.host / opts.port  Mobius 주소
 * @param opts.origin            X-M2M-Origin. ACP 를 통과할 수 있어야 한다.
 * @param opts.rvi               X-M2M-RVI (기본 '2a')
 * @param opts.timeoutMs
 */
function Client(opts) {
    this.host = opts.host || 'localhost';
    this.port = opts.port;
    this.origin = opts.origin;
    this.rvi = opts.rvi || '2a';
    this.timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.seq = 0;
}

Client.prototype._ri = function () {
    this.seq++;
    return 'adm-' + Date.now().toString(36) + '-' + this.seq;
};

/**
 * 한 건 요청한다. **예외를 던지지 않는다** — 실패도 결과의 한 종류다.
 * 일괄 작업에서 한 건의 실패가 나머지를 멈추면 안 된다.
 *
 * @returns callback({ ok, status, rsc, body, error })
 *   rsc 는 Mobius 가 돌려주는 문자열 그대로다('2002', '4004' 등).
 *   서버 콘솔 로그와 대조할 수 있어야 하므로 재해석하지 않는다.
 */
Client.prototype.request = function (method, path, body, callback) {
    var self = this;
    var payload = body ? JSON.stringify(body.content) : null;

    var headers = {
        'X-M2M-RI': this._ri(),
        'X-M2M-Origin': this.origin,
        'X-M2M-RVI': this.rvi,
        'Accept': 'application/json'
    };
    if (payload) {
        headers['Content-Type'] = 'application/json' + (body.ty ? ';ty=' + body.ty : '');
        headers['Content-Length'] = Buffer.byteLength(payload);
    }

    var settled = false;
    function settle(result) {
        if (settled) { return; }
        settled = true;
        callback(result);
    }

    var req = http.request({
        host: this.host, port: this.port, method: method,
        path: url.parse(path).path, headers: headers
    }, function (res) {
        var buf = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
            var parsed = null;
            if (buf) { try { parsed = JSON.parse(buf); } catch (e) { parsed = buf; } }
            settle({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                rsc: res.headers['x-m2m-rsc'] || null,
                body: parsed
            });
        });
    });

    req.setTimeout(this.timeoutMs, function () {
        // 끊되 결과는 남긴다. 타임아웃은 "실패" 가 아니라 "모름" 이다 —
        // 서버가 삭제를 끝냈는지 아닌지 여기서는 알 수 없다.
        req.destroy();
        settle({ ok: false, status: 0, rsc: null, error: 'timeout after ' + self.timeoutMs + 'ms' });
    });

    req.on('error', function (e) {
        settle({ ok: false, status: 0, rsc: null, error: e.message || String(e) });
    });

    if (payload) { req.write(payload); }
    req.end();
};

/** 리소스 하나 삭제. */
Client.prototype.remove = function (ri, callback) {
    this.request('DELETE', ri, null, callback);
};

/** 리소스 하나 조회. 실행 직전 프리플라이트에 쓴다. */
Client.prototype.retrieve = function (ri, callback) {
    this.request('GET', ri, null, callback);
};

/**
 * et 를 바꾼다. 리소스 타입마다 루트 이름이 달라 호출자가 넘겨야 한다
 * (예: 'm2m:ae', 'm2m:cnt').
 */
Client.prototype.setExpiry = function (ri, rootName, et, callback) {
    var content = {};
    content[rootName] = { et: et };
    this.request('PUT', ri, { content: content }, callback);
};

exports.Client = Client;
