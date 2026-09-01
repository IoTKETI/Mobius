'use strict';
// 커넥션 풀 크기와 MySQL max_connections 의 관계를 한 곳에서 계산한다.
//
// ── 왜 한 곳인가 ────────────────────────────────────────────────────────
// 이 계산을 세 곳이 쓴다 — 기동 시 바닥 검사(mobius/db_bootstrap.js),
// 그리고 관리 콘솔의 설정 화면. 각자 계산하면 화면이 말하는 값과 서버가
// 거는 값이 갈린다.
//
// ── 왜 max_connections 만 특별한가 ─────────────────────────────────────
// 네 튜닝 값 중 **이것만 기본값이 위험하다.**
//
//     innodb_flush_log_at_trx_commit  기본 1  = 우리가 원하는 값
//     transaction_isolation           기본 REPEATABLE-READ = 원하는 값
//     sync_binlog                     기본 1  = 느릴 뿐 안전
//     max_connections                 기본 151 <- 앱이 625 를 쓰면 즉시 고갈
//
// 그래서 나머지 셋은 한 번 넣으면 되지만(migrations/010), max_connections 는
// **기동마다 바닥을 확인**한다. SET PERSIST 가 유실되면(DB 복구, RESET PERSIST,
// 파일 손상) 151 로 떨어지는데, 그때 마이그레이션은 이미 기록돼 있어 다시
// 돌지 않기 때문이다.

var os = require('os');

// 프로세스 수 = 워커 + 마스터.
// app.js 가 os.cpus().length 만큼 포크하고 마스터가 하나 더 있다.
exports.processCount = function () {
    return os.cpus().length + 1;
};

// 앱이 요구할 수 있는 커넥션 총량. 풀은 프로세스마다 하나씩 생긴다.
exports.appDemand = function (connectionLimit, processes) {
    return connectionLimit * processes;
};

// max_connections 의 바닥.
//
// 요구량에 20% 여유를 두고 100 단위로 올린다. 여유는 앱 밖의 접속(관리 콘솔,
// mysql CLI, 모니터링) 몫이고, 100 단위 반올림은 사람이 읽기 쉬우라고 둔다.
//
//   지금 배포: 25 x 25 = 625 -> 750 -> 800
exports.floorFor = function (connectionLimit, processes) {
    var demand = exports.appDemand(connectionLimit, processes);
    return Math.ceil(demand * 1.2 / 100) * 100;
};

// 지금 설정으로 계산한 바닥. 인자를 안 주면 전역과 실제 CPU 수를 쓴다.
exports.currentFloor = function () {
    var limit = (typeof global.use_db_connection_limit === 'number')
        ? global.use_db_connection_limit : 25;
    return exports.floorFor(limit, exports.processCount());
};
