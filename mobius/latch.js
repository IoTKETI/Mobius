/**
 * 마스터 주기 작업 래치 장부.
 *
 * ── 왜 필요한가
 *
 * 마스터에서 도는 주기 작업 둘(보존 정책 스윕 · 카운터 정합)은 플래그를 켜고
 * **DB 콜백 안에서만** 끈다. 콜백이 안 오거나 콜백 본문에서 던지면 플래그가
 * 켜진 채 남고, 그 뒤의 모든 틱이 `if (running) return` 으로 **로그 한 줄
 * 없이** 튕긴다.
 *
 * 마스터에서 도는 일이라 워커 재기동으로 회복되지 않는다. 프로세스를 다시
 * 띄우기 전까지 보존 정책과 카운터 정합이 멈춘 채로 있고, 그동안 아무 신호도
 * 없다. purge 는 특히 나쁘다 — "할 일이 없으면 조용하다" 가 **의도된** 설계라
 * 정지한 상태와 건강한 유휴 상태의 출력이 완전히 같다.
 *
 * ── 왜 풀지 않는가
 *
 * mobius/lease.js 는 오래된 커넥션을 강제 회수한다(옵션). 여기는 안 한다.
 *
 * 임대는 **자원**이라 되돌려도 데이터가 틀리지 않는다. 래치는 **상호배제**다.
 * 풀어도 이미 도는 흐름은 안 멈춘다 — 취소 경로가 없다. 그래서 푸는 것은
 * 잠금 없는 임계구역에 두 번째 쓰기 주체를 들여보내는 일이고,
 *
 *   purge 두 흐름     한도 밑으로 CIN 을 지운다 (FK CASCADE 라 복구 불가)
 *   reconcile 두 흐름 커서를 서로 덮어써 구간을 무음으로 건너뛴다
 *
 * **재기동으로 회복되는 정지를, 회복되지 않는 손상과 바꾸는 거래다.**
 * 그래서 알리기만 한다. 옵션으로도 두지 않는다 — 옵션이 있으면 켜진다.
 *
 * ── 왜 "마지막 진전" 으로 재는가
 *
 * 한 바퀴 길이로 재면 안 된다. reconcile 한 바퀴는 조각 16회 x 간격 60초 =
 * 최소 15분이고, 조각당 처리량이 떨어지면 몇 시간이 된다. purge 는 예산이
 * 아예 없어 상한 자체가 없다. **그 값들은 데이터에 달렸으므로 임계값을
 * 정할 수 없다.**
 *
 * 마지막 진전으로부터 재면 그 문제가 사라진다. 정상 진전 간격은 계산된다 —
 * reconcile 은 조각 30초 + 마지막 집계 5초 + 대기 60초 = 약 100초, purge 는
 * 컨테이너 하나 단위라 그보다 짧다. 기본 15분은 9배 여유이고, **한 바퀴가
 * 3시간이든 24시간이든 안 걸린다.**
 *
 * 그리고 진전의 정의가 중요하다. reconcile 은 "조각이 끝났다" 가 아니라
 * **"커서가 전진했다"** 여야 한다. 커서가 안 움직이는 자기영속 사슬(배치
 * SELECT 가 예산을 다 먹어 첫 컨테이너를 보기도 전에 끝나는 경우)은 조각을
 * 계속 정상 종료하므로, 조각 완료로 재면 60초마다 시계가 되감겨 영원히
 * 건강해 보인다. 그 판단은 호출부(app.js)가 한다 — 여기는 "진전이 있었다"
 * 는 사실만 받는다.
 *
 * ── 이 장부는 마스터 프로세스 메모리에만 있다
 *
 * **HTTP 로 노출하면 안 된다.** 리스닝은 워커가 하므로(app.js) 그 라우트는
 * 워커가 답하고, 워커의 장부는 **언제나 비어 있다** — 항상 "건강함" 을
 * 돌려주는 창구가 된다. 관리 콘솔에 띄우려면 마스터가 파일이나 IPC 로
 * 내보내야 하고, 지금 app.js 에는 마스터-워커 IPC 가 없다.
 *
 * 그래서 조회 창구가 없는 대신 **경고 줄 하나가 상태를 다 담는다** —
 * 진전 없는 시간, 총 보유 시간, entered/left 누계까지 같이 찍는다.
 */

var util = require('util');

var DEFAULT_STALE_MS = 15 * 60 * 1000;

// 같은 래치를 매 분 다시 알리면 로그가 밀린다. 반대로 lease 는 임대당 평생
// 한 줄이라 로그 로테이션 뒤에 근거가 사라진다 — 그 결함은 물려받지 않는다.
// 처음 한 번, 그 뒤로는 이 간격으로 다시 알린다.
var REWARN_MS = 10 * 60 * 1000;

// name -> { at, progressAt, warnedAt }
var held = {};
var stats = { entered: 0, left: 0, warned: 0, overlapped: 0 };

function staleMs() {
    return (typeof global.latchStaleMs === 'number' && global.latchStaleMs >= 0)
        ? global.latchStaleMs : DEFAULT_STALE_MS;
}

function nowOr(now) {
    return (typeof now === 'number') ? now : Date.now();
}

/**
 * 래치를 켰다고 장부에 올린다.
 *
 * **상호배제가 아니다** — 배타는 호출부의 불리언이 한다. 여기는 관측만
 * 한다. 이미 잡혀 있는데 또 들어오면 그것이 곧 결함이므로 알린다.
 *
 * 호출부는 이것을 `db.getConnection` **앞에서** 부른다. 취득이 영영 안
 * 돌아오는 경로도 장부에 잡혀야 하기 때문이다 — mysql2 에는 acquireTimeout
 * 이 없고 queueLimit 은 큐가 꽉 찼을 때만 에러를 낸다. mobius/lease.js 는
 * 취득에 **성공한 뒤**에야 장부에 올리므로 그 경로를 원리적으로 못 본다.
 *
 * @param {string} name  주기 작업 이름
 * @param {number} [now] 현재 시각(ms). 시험에서 주입한다
 * @returns {boolean} 새로 잡았으면 true, 이미 잡혀 있었으면 false
 */
exports.enter = function (name, now) {
    var t = nowOr(now);
    if (held[name]) {
        stats.overlapped++;
        console.error(util.format(
            '[latch] %s 이 이미 잡혀 있는데 또 시작했다 — 두 흐름이 겹친다 (master pid=%d)',
            name, process.pid));
        // 겹쳤어도 시계는 앞의 것을 유지한다. 되감으면 굳은 것을 놓친다.
        return false;
    }
    held[name] = { at: t, progressAt: t, warnedAt: 0 };
    stats.entered++;
    return true;
};

/**
 * 진전이 있었다. **무엇이 진전인지는 호출부가 정한다** — reconcile 은
 * 커서가 실제로 전진했을 때만 부른다(위 주석 참고).
 */
exports.progress = function (name, now) {
    var h = held[name];
    if (!h) { return false; }
    h.progressAt = nowOr(now);
    // 경고 뒤에 진전이 오면 다시 도는 것이다. 경고 상태를 푼다.
    h.warnedAt = 0;
    return true;
};

/** 래치를 놓았다. */
exports.leave = function (name) {
    if (!held[name]) { return false; }
    delete held[name];
    stats.left++;
    return true;
};

/**
 * 장부를 훑어 굳은 래치를 알린다. **아무것도 풀지 않는다** (위 주석 참고).
 *
 * @param {number} [now] 현재 시각(ms). 시험에서 주입한다
 * @returns {Array} 이번 스캔에서 알린 이름들
 */
exports.sweep = function (now) {
    var t = nowOr(now);
    var stale = staleMs();
    if (!(stale > 0)) { return []; }        // 0 이면 감시를 끈다

    var warned = [];
    Object.keys(held).forEach(function (name) {
        var h = held[name];
        if (!h) { return; }

        var idle = t - h.progressAt;
        if (idle < stale) { return; }
        if (h.warnedAt && (t - h.warnedAt) < REWARN_MS) { return; }
        h.warnedAt = t;
        stats.warned++;
        warned.push(name);

        // pm2 가 마스터와 워커 stdout 을 한 파일로 합치므로 pid 가 있어야
        // 마스터의 주기 작업이라는 것이 가려진다. 이 저장소에는 로거 래퍼가
        // 없어 stdout 줄에 시각이 없다 — 이 줄에서만은 박아 둔다.
        // **영향과 긴급도를 먼저 적는다.** 새벽 3시에 이 줄만 보고 판단한다.
        // 이 두 작업은 요청 처리 경로가 아니다 — 보존 한도 적용과 cnt 카운터
        // 정합만 한다. 그것을 안 적으면 뒷정리 작업 때문에 25워커 전체
        // 재기동으로 몰린다.
        console.error(util.format(
            '[latch] %s 이 %d초째 진전이 없다 (총 보유 %d초). 이 주기 작업은 ' +
            '멈춰 있다. **요청 처리에는 영향이 없다** — 이 작업은 보존 한도 ' +
            '적용과 cnt 카운터 정합만 한다. 다음 점검 창에 Mobius 를 재기동하면 ' +
            '처음부터 다시 돈다(마스터만 따로 띄울 수는 없다). 자동으로 풀지 ' +
            '않는 이유는 mobius/latch.js 머리주석. master pid=%d at=%s ' +
            'entered=%d left=%d',
            name, Math.round(idle / 1000), Math.round((t - h.at) / 1000),
            process.pid, new Date(t).toISOString(), stats.entered, stats.left));
    });
    return warned;
};

/** 지금 무엇이 잡혀 있나. 시험과 운영 점검용. */
exports.describe = function (now) {
    var t = nowOr(now);
    return Object.keys(held).map(function (name) {
        var h = held[name];
        return {
            name: name,
            heldMs: t - h.at,
            idleMs: t - h.progressAt,
            warned: h.warnedAt > 0
        };
    });
};

exports.stats = function () {
    return {
        held: Object.keys(held).length,
        entered: stats.entered,
        left: stats.left,
        warned: stats.warned,
        overlapped: stats.overlapped
    };
};

/** 시험에서 장부를 비운다. */
exports._reset = function () {
    held = {};
    stats = { entered: 0, left: 0, warned: 0, overlapped: 0 };
};

exports.DEFAULT_STALE_MS = DEFAULT_STALE_MS;
exports.REWARN_MS = REWARN_MS;
