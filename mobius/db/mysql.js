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
