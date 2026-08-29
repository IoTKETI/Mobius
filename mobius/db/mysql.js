'use strict';
// MySQL 어댑터. 실행과 결과/에러 정규화만 담당한다.
// 방언(플레이스홀더, 식별자 인용, upsert, 행 잠금)은 knex 가 처리하므로 여기 없다.

var mysql = require('mysql');

var pool = null;

exports.name = 'mysql';
exports.knexClient = 'mysql';
exports.schemaFile = 'mobiusdb.sql';

exports.capabilities = {
    transaction: true,
    rowLock: true,         // SELECT ... FOR UPDATE [NOWAIT]

    // 서버가 SELECT 하나를 시간으로 끊어 줄 수 있는가.
    // MySQL 은 MAX_EXECUTION_TIME 힌트로 된다 — 서버가 그 문장만 중단하고
    // ER_MAX_EXECUTION_TIME_EXCEEDED(3024) 를 돌려주며 커넥션은 살아 있다.
    //
    // 드라이버 타임아웃(execute 의 opts.timeoutMs)과 헷갈리면 안 된다. 그쪽은
    // 커넥션을 죽인다 — 한 번 걸리면 뒤이은 질의가 전부
    // PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR 로 연쇄 실패한다(로컬 실측).
    // 그래서 "한 문장만 끊고 계속 일한다" 는 용도에는 이 힌트를 쓴다.
    statementTimeout: true
};

// 문장 단위 시간 상한을 거는 힌트를 만든다. 능력이 없으면 null 을 준다.
// knex 의 .hintComment() 에 넣는다.
exports.statementTimeoutHint = function (ms) {
    var n = parseInt(ms, 10);
    if (!(n > 0)) { return null; }
    return 'MAX_EXECUTION_TIME(' + n + ')';
};

// 리소스 경로끼리 비교할 때 붙일 콜레이션 조각.
//
// mobiusdb.sql 에서 lookup.pi 는 utf8mb3_general_ci, lookup.ri 는 utf8mb3_bin
// 이다. 둘을 그냥 조인하면 ER_CANT_AGGREGATE_2COLLATIONS 로 죽는다.
// 기존 코드가 쓰던 'where pi = ?' 는 pi 쪽 콜레이션(대소문자 무시)으로
// 비교됐으므로, 조인으로 바꿔도 같은 결과가 나오도록 general_ci 를 쓴다.
exports.pathCollate = function () {
    return ' collate utf8mb3_general_ci';
};

// 옵티마이저에게 인덱스를 강제한다.
//
// 왜 필요한가: PRIMARY KEY 가 (pi, ri, ty) 라 pi 만 등치로 잡히고 ty 는
// 범위에 못 들어간다. lookup 밖의 컬럼(lbl 등)을 걸러야 하면 옵티마이저가
// 클러스터드 PRIMARY 를 골라 부모마다 CIN 을 전부 읽는다.
// 배포 서버 실측(2026-08-29): lbl 필터가 60초 초과 → 강제 시 840ms.
exports.indexHint = function (name) {
    if (!name) { return ''; }
    return ' force index (' + name + ')';
};

// 지정한 별칭 사이에 해시 조인을 쓰지 말라는 힌트. MySQL 8.0.18+.
//
// 재귀 CTE 에서 필요하다. 옵티마이저가 값이 희소한 분기에서 "작은 인덱스를
// 통째로 훑고 상대 쪽으로 해시를 만드는" 계획을 고르는데, 재귀는 반복마다
// 상대(새 행 집합)가 바뀌므로 그 해시를 매번 새로 만든다.
// 배포 서버 실측(2026-08-29): 골격 질의 15,584ms -> 4,856ms.
exports.noHashJoinHint = function (aliases) {
    if (!aliases || !aliases.length) { return null; }
    return 'NO_HASH_JOIN(' + aliases.join(', ') + ')';
};

// "이 행은 contentInstance(ty=4) 가 아니다" 를 재귀 CTE 가 인덱스로 탈 수 있는
// 형태로 돌려준다. discovery 골격이 트리를 넓힐 때 쓴다.
//
// 왜 ty <> 4 를 그대로 안 쓰는가: MySQL 의 재귀 CTE 안에서는 ref(등치) 접근만
// 되고 range 가 안 된다. `ty <> 4` 는 인덱스가 pi 까지만 잡히고 나머지가
// 필터로 밀려 부모마다 CIN 을 전부 읽는다 (배포 서버 실측 125,385ms).
// 그래서 lookup 에 가상 생성 컬럼 not_cin = (ty <> 4) 를 두고 등치로 묻는다.
//
// not_cin 은 INVISIBLE 이라 `select *` 에 나타나지 않는다. 눈에 보이면
// 리소스 조회 응답(m2m:cnt 등)에 그대로 실려 나간다 — 배포 서버에서 실제로
// 한 번 샜다. migrations/004 참고.
exports.notCinPredicate = function (alias) {
    return alias + '.not_cin = 1';
};

// 위 조건을 태울 인덱스 이름. 없으면 null.
exports.notCinIndexName = function () {
    return 'idx_lookup_pi_notcin';
};

// 수로 비교해야 하는 식을 감싼다.
//
// cin.cs 는 mobiusdb.sql 에서 int 라 그대로 비교하면 된다.
// (mobiusdb_sqlite.sql 은 TEXT 라 캐스팅이 필요하다 — 그쪽 어댑터 참고)
exports.numericExpr = function (expr) {
    return expr;
};

exports.connect = function (conf, callback) {
    pool = mysql.createPool({
        host: conf.host,
        port: conf.port,
        user: conf.user,
        password: conf.password,
        database: 'mobiusdb',
        connectionLimit: 100,
        waitForConnections: true,
        debug: false,
        acquireTimeout: 50000,
        queueLimit: 0
    });
    callback('1');
};

exports.getConnection = function (callback) {
    if (pool == null) {
        console.error('[db/mysql] not connected');
        callback('500-5');
        return;
    }
    pool.getConnection(function (err, connection) {
        if (err || !connection) { callback('500-5'); }
        else { callback('200', connection); }
    });
};

exports.release = function (handle) {
    if (handle && typeof handle.release === 'function') { handle.release(); }
};

// 요청 처리용 기본 타임아웃. 한 요청이 커넥션을 무한정 붙잡지 못하게 한다.
var DEFAULT_TIMEOUT_MS = 60000;

exports.execute = function (handle, sql, bindings, callback, opts) {
    var q = { sql: sql, values: bindings };

    // opts.timeoutMs === 0 이면 타임아웃을 걸지 않는다.
    // 스키마 마이그레이션(ALTER TABLE ADD INDEX)이 그런 경우다 — 5740만 행
    // 테이블에서는 수십 분이 걸리는데, 60초에 드라이버가 커넥션을 끊어도
    // MySQL 은 DDL 을 계속 진행한다. 그러면 러너는 실패로 보고하고 이력도
    // 안 남기는데 인덱스는 만들어지는, 최악의 어긋난 상태가 된다.
    // (2026-08-28 배포 서버에서 실제로 발생)
    var t = (opts && opts.timeoutMs !== undefined) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    if (t) { q.timeout = t; }

    handle.query(q, function (err, rows) {
        if (err) { return callback(err, null); }
        callback(null, rows);
    });
};

// SELECT 는 배열 그대로, 쓰기는 {affectedRows, insertId}.
// mysql 드라이버가 이미 이 형태라 통과시키되 계약을 명시적으로 고정한다.
exports.normalizeResult = function (raw) {
    if (Array.isArray(raw)) { return raw; }
    return {
        affectedRows: raw && raw.affectedRows !== undefined ? raw.affectedRows : 0,
        insertId: raw ? raw.insertId : undefined
    };
};

exports.normalizeError = function (err) {
    if (!err) { return { code: 'UNKNOWN' }; }

    // 원본 드라이버 코드를 보존한다. 중립 코드로 덮어쓰면 백엔드 고유
    // 조건(락 충돌 등)을 상위에서 복구할 방법이 사라진다.
    var driverCode = err.code;

    var code = 'UNKNOWN';
    if (err.code === 'ER_DUP_ENTRY') { code = 'DUPLICATE_KEY'; }
    else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') { code = 'FK_VIOLATION'; }
    else if (err.code === 'ER_BAD_NULL_ERROR') { code = 'NOT_NULL'; }
    else if (err.code === 'ER_LOCK_NOWAIT' || err.errno === 3572) { code = 'LOCK_CONFLICT'; }
    else if (err.code === 'ER_LOCK_DEADLOCK' || err.errno === 1213) { code = 'LOCK_CONFLICT'; }
    else if (err.code === 'ER_LOCK_WAIT_TIMEOUT' || err.errno === 1205) { code = 'LOCK_TIMEOUT'; }

    // err.constraint 는 부분 문자열 비교용 힌트다. 동등 비교하면 안 된다 —
    // MySQL 5.7 은 "aei_UNIQUE", MySQL 8 은 "ae.aei_UNIQUE", SQLite 는 "aei" 를 준다.
    // 테이블 접두사를 떼어 최소한의 공통 형태로 맞춘다.
    var constraint = null;
    var m = /key '([^']+)'/i.exec(err.sqlMessage || err.message || '');
    if (m) { constraint = m[1].replace(/^.*\./, ''); }

    err.driverCode = driverCode;
    err.code = code;
    err.constraint = constraint;
    return err;
};

exports.begin = function (handle, callback) { handle.beginTransaction(callback); };
exports.commit = function (handle, callback) { handle.commit(callback); };
exports.rollback = function (handle, callback) { handle.rollback(callback); };
