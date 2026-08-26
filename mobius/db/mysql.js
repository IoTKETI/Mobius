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
    rowLock: true          // SELECT ... FOR UPDATE [NOWAIT]
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

exports.execute = function (handle, sql, bindings, callback) {
    handle.query({ sql: sql, values: bindings, timeout: 60000 }, function (err, rows) {
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
    var code = 'UNKNOWN';
    if (err.code === 'ER_DUP_ENTRY') { code = 'DUPLICATE_KEY'; }
    else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') { code = 'FK_VIOLATION'; }
    else if (err.code === 'ER_BAD_NULL_ERROR') { code = 'NOT_NULL'; }

    // 409-6(aei 중복)처럼 제약 이름으로 갈리는 곳이 있어 이름을 실어 보낸다.
    var constraint = null;
    var m = /key '([^']+)'/i.exec(err.sqlMessage || err.message || '');
    if (m) { constraint = m[1]; }

    err.code = code;
    err.constraint = constraint;
    return err;
};

exports.begin = function (handle, callback) { handle.beginTransaction(callback); };
exports.commit = function (handle, callback) { handle.commit(callback); };
exports.rollback = function (handle, callback) { handle.rollback(callback); };
