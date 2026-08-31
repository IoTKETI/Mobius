'use strict';
// ACP 판정 관측 — 거부 로그와 관찰 모드.
//
// 지금 가장 큰 고통은 **켜 보기 전에는 뭐가 막힐지 모른다**는 것이다.
// 배포 로그 22개 파일에 'ACCESS DENIED' 도 '403-3' 도 한 줄이 없다. 거부가
// 나도 응답 본문은 {"m2m:dbg":"ACCESS DENIED"} 뿐이라, 어느 ACP 의 어느
// 규칙이 막았는지 알 방법이 없다. 그래서 "일단 걸고 터지면 푼다" 가 되고,
// 그 경험이 쌓여 ACP 를 아예 안 쓰게 됐다.
//
// 순서를 이렇게 되돌린다.
//
//   1) 거부 로그를 먼저 켠다      누가·무엇을·어느 ACP 때문에 막혔는지 남긴다
//   2) 관찰 모드로 ACP 를 건다     판정은 하되 막지 않고 로그만 남긴다
//   3) 하루~이틀 로그를 본다       막힐 뻔한 것이 의도한 것뿐인지 확인
//   4) 관찰 모드를 끈다            그때부터 실제로 막는다
//
// security.check 는 요청마다 도는 핫패스다. 그래서 두 가지를 지킨다.
//   - **절대 던지지 않는다.** 관측이 요청을 죽이면 안 된다.
//   - **로그를 초당 몇 줄로 끊는다.** 잘못 걸린 ACP 하나가 25개 워커에서
//     초당 수천 줄을 쏟으면 디스크가 먼저 죽는다.

// 로그에 수퍼유저 origin 을 적지 않는다. mobius/log_safe.js 머리말 참조.
var log_safe = require('./log_safe');

var DEFAULTS = { mode: 'off', denyLog: 'sample', rate: 5, keep: 200 };

var cfg = { mode: DEFAULTS.mode, denyLog: DEFAULTS.denyLog, rate: DEFAULTS.rate, keep: DEFAULTS.keep };
var stats = null;

function fresh() {
    return {
        since: new Date().toISOString(),
        counts: { deny: 0, observe: 0, error: 0, acpi_attach: 0, suppressed: 0 },
        byReason: {},
        recent: [],
        // 토큰 버킷 — 워커 프로세스 안에서만 센다.
        windowSec: 0,
        windowUsed: 0
    };
}

stats = fresh();

/**
 * @param opts.mode     'off'(기본) | 'observe' — observe 면 거부를 허용으로 내보낸다
 * @param opts.denyLog  'off' | 'sample'(기본) | 'all'
 * @param opts.rate     denyLog='sample' 일 때 초당 최대 줄 수
 * @param opts.keep     snapshot 에 남길 최근 건수
 */
exports.configure = function (opts) {
    var o = opts || {};
    if (o.mode === 'off' || o.mode === 'observe') { cfg.mode = o.mode; }
    if (o.denyLog === 'off' || o.denyLog === 'sample' || o.denyLog === 'all') { cfg.denyLog = o.denyLog; }
    if (typeof o.rate === 'number' && o.rate >= 0) { cfg.rate = o.rate; }
    if (typeof o.keep === 'number' && o.keep > 0) { cfg.keep = o.keep; }
};

exports.config = function () {
    return { mode: cfg.mode, denyLog: cfg.denyLog, rate: cfg.rate, keep: cfg.keep };
};

exports.reset = function () {
    stats = fresh();
};

exports.snapshot = function () {
    return {
        since: stats.since,
        config: exports.config(),
        counts: {
            deny: stats.counts.deny,
            observe: stats.counts.observe,
            error: stats.counts.error,
            acpi_attach: stats.counts.acpi_attach,
            suppressed: stats.counts.suppressed
        },
        byReason: JSON.parse(JSON.stringify(stats.byReason)),
        recent: stats.recent.slice()
    };
};

// 초당 cfg.rate 줄까지만 찍는다. 넘으면 suppressed 만 올린다.
function may_log() {
    if (cfg.denyLog === 'off') { return false; }
    if (cfg.denyLog === 'all') { return true; }
    var sec = Math.floor(Date.now() / 1000);
    if (sec !== stats.windowSec) {
        stats.windowSec = sec;
        stats.windowUsed = 0;
    }
    if (stats.windowUsed < cfg.rate) {
        stats.windowUsed += 1;
        return true;
    }
    stats.counts.suppressed += 1;
    return false;
}

// 관찰 모드가 뒤집어도 되는 거부 사유. **ACP 평가로 난 거부만** 들어간다.
// 'default_policy'(ACP 가 없을 때의 기본 정책)와 'superuser' 는 여기 없다.
var OBSERVABLE = {
    acr: 1,           // 규칙을 다 봤는데 통과가 없다
    exhausted: 1,     // ACP 는 있는데 아무 규칙도 안 맞았다
    no_acr_cr: 1,     // pv 에 acr 이 없어 생성자 비교로 끝났다
    no_acp_row: 1     // 참조한 ACP 를 못 찾았다 (dangling)
};

var OP_NAME = {
    '1': 'CREATE', '2': 'RETRIEVE', '3': 'CREATE_SUB', '4': 'UPDATE',
    '8': 'DELETE', '16': 'NOTIFY', '32': 'DISCOVERY'
};

function op_of(v) {
    return OP_NAME[String(v)] || ('op' + v);
}

function push_recent(entry) {
    stats.recent.push(entry);
    while (stats.recent.length > cfg.keep) {
        stats.recent.shift();
    }
}

/**
 * 임의의 관측 항목을 남긴다. 지금은 acpi 부착에 쓴다.
 * 절대 던지지 않는다.
 */
exports.record = function (kind, info) {
    try {
        var i = info || {};
        if (stats.counts.hasOwnProperty(kind)) { stats.counts[kind] += 1; }
        push_recent({ at: new Date().toISOString(), kind: kind, info: i });
        if (kind === 'acpi_attach' && may_log()) {
            console.log('[acp] attach ri=' + (i.ri || '-') + ' ty=' + (i.ty || '-') +
                ' origin=' + log_safe.origin(i.origin) + ' cr=' + (i.cr || '-') +
                ' before=' + JSON.stringify(i.before || []) +
                ' after=' + JSON.stringify(i.after || []));
        }
    }
    catch (e) {
        // 관측이 요청을 죽이면 안 된다.
    }
};

/**
 * security.check 의 최종 판정을 관측하고 **실제로 내보낼 코드**를 돌려준다.
 *
 * 관찰 모드면 '0'(거부)을 '1'(허용)로 바꾼다. '500-1' 과 수퍼유저 통과는
 * 건드리지 않는다 — 관찰 모드는 "막지 않고 본다" 지 "오류를 감춘다" 가 아니다.
 */
exports.record_decision = function (request, code, trace) {
    try {
        var t = trace || {};
        var reason = t.decided_by || 'unknown';

        if (code === '500-1' && reason === 'eval_error') {
            stats.counts.error += 1;
            stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
            push_recent({ at: new Date().toISOString(), kind: 'error', info: line_info(request, t) });
            if (may_log()) {
                console.log('[acp] error ' + format(request, t) + ' err=' + (t.error || '-'));
            }
            return code;
        }

        if (code !== '0') {
            return code;
        }

        stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;

        if (cfg.mode === 'observe' && !OBSERVABLE[reason]) {
            // 관찰 모드는 **ACP 때문에 막힌 것**만 뒤집는다.
            //
            // 예전에는 사유를 안 보고 모든 '0' 을 '1' 로 바꿨다. 그런데 배포에
            // acpi 가 채워진 행은 2개뿐이라 실제로 나는 거부는 사실상 전부
            // default_policy 다 — "수정·삭제는 생성자만" 이라는 기본 정책이다.
            // 그러면 관찰 모드를 하루 켜는 것이 "ACP 로 뭐가 막힐지 본다" 가
            // 아니라 **5,740만 행 전부를 임의 원본의 UPDATE·DELETE 에 여는 것**이
            // 된다. 그 창에서 지워진 리소스는 돌아오지 않으므로 "관찰은 되돌릴
            // 수 있다" 는 전제가 깨진다.
            //
            // 기본 정책은 ACP 가 아니라 ACP 가 **없을 때**의 정책이라 관찰
            // 대상이 아니다. 그것을 바꾸려면 defaultAccessPolicy 를 쓴다.
            push_recent({ at: new Date().toISOString(), kind: 'deny', info: line_info(request, t) });
            stats.counts.deny += 1;
            if (may_log()) {
                console.log('[acp] deny ' + format(request, t) + ' (관찰 모드지만 ACP 거부가 아니라 그대로 막는다)');
            }
            return code;
        }

        if (cfg.mode === 'observe') {
            t.observed = true;
            stats.counts.observe += 1;
            push_recent({ at: new Date().toISOString(), kind: 'observe', info: line_info(request, t) });
            if (may_log()) {
                console.log('[acp] observe ' + format(request, t));
            }
            return '1';
        }

        stats.counts.deny += 1;
        push_recent({ at: new Date().toISOString(), kind: 'deny', info: line_info(request, t) });
        if (may_log()) {
            console.log('[acp] deny ' + format(request, t));
        }
        return code;
    }
    catch (e) {
        // 관측이 판정을 바꾸면 안 된다. 원래 코드를 그대로 돌려준다.
        return code;
    }
};

function line_info(request, t) {
    return {
        op: op_of(t.op_value),
        ty: t.ty,
        origin: request && request.headers ? request.headers['x-m2m-origin'] : undefined,
        url: request ? request.url : undefined,
        acp: t.acp_ri || null,
        acr: t.acr_index === undefined ? null : t.acr_index,
        field: t.field || null,
        source: t.source || null,
        inherited_from: t.inherited_from || null,
        by: t.decided_by || 'unknown',
        stopped_early: !!t.stopped_early,
        not_evaluated: t.not_evaluated || []
    };
}

// 파싱 가능한 고정 형식으로 한 줄. 값에 공백이 섞이지 않게 '-' 로 채운다.
function format(request, t) {
    var i = line_info(request, t);
    var s = 'op=' + i.op + ' ty=' + (i.ty === undefined ? '-' : i.ty) +
        ' origin=' + log_safe.origin(i.origin) + ' url=' + (i.url || '-') +
        ' by=' + i.by;
    if (i.acp) { s += ' acp=' + i.acp + ' field=' + (i.field || '-') + ' acr=' + (i.acr === null ? '-' : i.acr); }
    if (i.source) { s += ' source=' + i.source; }
    if (i.inherited_from) { s += ' from=' + i.inherited_from; }
    if (i.stopped_early && i.not_evaluated.length > 0) {
        s += ' skipped=' + i.not_evaluated.join(',');
    }
    return s;
}
