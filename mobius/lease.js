/**
 * DB 커넥션 임대 장부.
 *
 * ── 왜 필요한가
 *
 * 요청 하나의 "정산"(응답 전송 + connection.release())은 라우트 최상단
 * 클로저에서만 일어난다. 그 사슬은 10~13단이고, 중간 어디서든 콜백이 사라지면
 * 응답도 반납도 없다. 크래시가 아니라 매달림이라 cluster 의 워커 재시작이
 * 걸리지 않는다 — 조용한 영구 고갈이다. 풀 한도는 워커당 100.
 *
 * 지금까지 이 부류를 여러 번 고쳤지만, 고칠 때마다 "또 어딘가 남아 있다"는
 * 것이 문제였다. 개별 분기를 아무리 채워도 다음 유실을 못 막는다.
 *
 * ── 왜 여기인가
 *
 * 커넥션 취득은 db_action.getConnection 한 곳을 지난다 — 라우트 4곳뿐 아니라
 * 기동·주기 작업까지 12곳 전부. 반면 정산 클로저는 app.js 에만 70곳이 넘게
 * 흩어져 있고, 그중 라우트가 아닌 취득 지점은 아예 덮지 못한다.
 *
 * ── 왜 응답을 쓰지 않는가
 *
 * 저장소에 process.on('uncaughtException') 핸들러가 없다. 백스톱이 두 번째
 * 응답을 쓰는 순간 ERR_HTTP_HEADERS_SENT 로 워커가 죽는다. 장부는 응답에
 * 손대지 않으므로 "정상 응답 가로채기"와 "이중 응답" 위험이 아예 없다.
 *
 * 이중 release 도 삼키지 않는다. 래퍼는 장부만 지우고 원래 release 를 그대로
 * 부른다 — 이중 정산이 지금처럼 드러나야 원인을 찾을 수 있다.
 *
 * ── 기본은 관측만
 *
 * 강제 회수(reclaim)는 global.leaseReclaimMs 를 설정했을 때만 한다. 기본은
 * 끔이다. 임계값은 배포 서버에서 실제 지연 분포를 보기 전에는 정할 수 없다 —
 * db_action 의 쿼리 타임아웃이 60초라 그보다 커야 하고, 대용량 discovery 가
 * 얼마나 걸리는지는 로컬 데이터로 판단이 안 선다.
 */

var util = require('util');

var DEFAULT_WARN_MS = 90000;

// 열려 있는 임대: id -> { at, where, conn, warned }
var open = {};
var next_id = 1;

var stats = { opened: 0, closed: 0, warned: 0, reclaimed: 0 };

function warnMs() {
    return (typeof global.leaseWarnMs === 'number' && global.leaseWarnMs > 0)
        ? global.leaseWarnMs : DEFAULT_WARN_MS;
}

function reclaimMs() {
    // 0 이나 미설정이면 회수하지 않는다.
    return (typeof global.leaseReclaimMs === 'number' && global.leaseReclaimMs > 0)
        ? global.leaseReclaimMs : 0;
}

/**
 * 커넥션을 장부에 올리고 release 를 감싼다.
 *
 * 풀은 같은 핸들을 재사용하므로 두 번 감싸지 않도록 표시를 남긴다.
 * 표시가 없으면 임대마다 래퍼가 쌓여 원래 release 를 찾지 못하게 된다.
 *
 * @param {Object} conn  풀에서 받은 커넥션 핸들
 * @param {number} now   현재 시각(ms). 테스트에서 주입할 수 있게 인자로 받는다
 * @returns {Object} 같은 핸들
 */
// 스캔 타이머. 첫 임대에서 켠다 — 커넥션을 한 번도 안 빌리는 프로세스
// (cluster 마스터 등)에는 타이머를 만들지 않는다.
var sweep_timer = null;

function start_sweeping() {
    if (sweep_timer !== null) { return; }
    sweep_timer = setInterval(function () { exports.sweep(); }, 1000);
    // 이 타이머 때문에 프로세스가 종료되지 못하면 안 된다.
    if (typeof sweep_timer.unref === 'function') { sweep_timer.unref(); }
}

exports.track = function (conn, now) {
    if (conn == null || typeof conn.release !== 'function') {
        return conn;                 // 감쌀 것이 없다
    }

    start_sweeping();

    var id = next_id++;
    var at = (typeof now === 'number') ? now : Date.now();
    // 어느 취득 지점인지가 유일한 단서다. 몇 프레임만 남긴다.
    var where = (new Error().stack || '').split('\n').slice(2, 5).join('\n');

    open[id] = { at: at, where: where, conn: conn, warned: false };
    stats.opened++;

    if (!conn.__lease_wrapped) {
        var original = conn.release;
        conn.__lease_wrapped = true;
        conn.release = function () {
            // 현재 임대만 장부에서 지운다. 이중 release 는 그대로 통과시킨다 —
            // 삼키면 이중 정산을 영영 못 찾는다.
            if (conn.__lease_id != null) {
                if (open[conn.__lease_id]) {
                    delete open[conn.__lease_id];
                    stats.closed++;
                }
                conn.__lease_id = null;
            }
            return original.apply(conn, arguments);
        };
    }
    conn.__lease_id = id;

    return conn;
};

/**
 * 장부를 훑어 오래된 임대를 알린다. wdt 의 1초 tick 에서 부른다.
 *
 * @param {number} now  현재 시각(ms). 테스트에서 주입한다
 * @returns {{warned: number, reclaimed: number}} 이번 스캔에서 처리한 수
 */
exports.sweep = function (now) {
    var t = (typeof now === 'number') ? now : Date.now();
    var warn_at = warnMs();
    var reclaim_at = reclaimMs();
    var result = { warned: 0, reclaimed: 0 };

    Object.keys(open).forEach(function (id) {
        var lease = open[id];
        if (!lease) { return; }
        var age = t - lease.at;

        if (!lease.warned && age >= warn_at) {
            // 같은 임대를 매 초 다시 알리면 로그가 밀린다. 한 번만 알린다.
            lease.warned = true;
            stats.warned++;
            result.warned++;
            console.error(util.format(
                '[lease] 커넥션이 %dms 째 반납되지 않았다 (임대 %s)\n%s', age, id, lease.where));
        }

        if (reclaim_at > 0 && age >= reclaim_at) {
            // 회수는 기본으로 꺼져 있다. 켰다면 그 요청은 이미 응답을 못 낸
            // 상태이므로, 커넥션이라도 풀에 돌려준다.
            console.error(util.format('[lease] %dms 째 반납되지 않아 강제로 회수한다 (임대 %s)', age, id));
            delete open[id];
            stats.reclaimed++;
            result.reclaimed++;
            try { lease.conn.release(); }
            catch (e) { console.error('[lease] 회수 중 오류: ' + e.message); }
        }
    });

    return result;
};

/** 현재 상태. 테스트와 운영 점검용. */
exports.stats = function () {
    return {
        open: Object.keys(open).length,
        opened: stats.opened,
        closed: stats.closed,
        warned: stats.warned,
        reclaimed: stats.reclaimed
    };
};

/** 테스트에서 장부를 비운다. */
exports._reset = function () {
    open = {};
    next_id = 1;
    stats = { opened: 0, closed: 0, warned: 0, reclaimed: 0 };
    if (sweep_timer !== null) {
        clearInterval(sweep_timer);
        sweep_timer = null;
    }
};

exports.DEFAULT_WARN_MS = DEFAULT_WARN_MS;
