'use strict';
// SQLite 어댑터. 풀이 없고 워커당 핸들 하나를 공유한다.
//
// capabilities.transaction 이 false 인 이유:
//   핸들이 하나뿐이라 비동기 호출이 겹치면 서로 다른 논리적 트랜잭션이
//   같은 핸들에서 뒤섞인다. 현재 코드도 SQLite 경로에서는 트랜잭션을
//   쓰지 않으므로 false 선언이 곧 기존 동작 보존이다.
//   제대로 지원하려면 핸들 풀이나 직렬화 큐가 필요하다 — 후속 작업.
//
// capabilities.rowLock 이 false 인 이유:
//   SQLite 는 파일 단위 단일 라이터라 행 잠금 개념이 없다.
//   knex 는 forUpdate() 를 자동 생략하지만 noWait() 은 예외를 던지므로
//   호출부가 db.can('rowLock') 으로 검사해야 한다.

var sqlite3 = require('sqlite3').verbose();
var fs = require('fs');
var path = require('path');

var db = null;

// 테스트가 실제 개발 DB 를 건드리지 않도록 경로를 열어 둔다.
var DB_PATH = process.env.MOBIUS_SQLITE_PATH || './mobius.db';

exports.name = 'sqlite';
exports.knexClient = 'sqlite3';
exports.schemaFile = 'mobiusdb_sqlite.sql';

exports.capabilities = {
    transaction: false,
    rowLock: false,

    // SQLite 에는 문장 단위 시간 상한을 거는 힌트가 없다.
    // (sqlite3_progress_handler 로 중단시킬 수는 있으나 node-sqlite3 가
    //  노출하지 않고, 임베디드 규모라 필요하지도 않다.)
    statementTimeout: false
};

exports.statementTimeoutHint = function () { return null; };

// mobiusdb_sqlite.sql 은 pi / ri 를 같은(기본 BINARY) 콜레이션으로 만든다.
// 붙일 조각이 없다. MySQL 이 대소문자를 무시하는 것과 달리 SQLite 는
// 구분하지만, 이는 이 스키마가 원래 갖고 있던 성질이라 그대로 둔다.
exports.pathCollate = function () { return ''; };

// SQLite 에도 INDEXED BY 가 있으나 인덱스 이름이 MySQL 과 다르고,
// 임베디드 규모에서는 옵티마이저를 강제할 이유가 없다.
exports.indexHint = function () { return ''; };

// SQLite 에는 조인 알고리즘을 고르는 힌트가 없다 (중첩 루프만 쓴다).
exports.noHashJoinHint = function () { return null; };

exports.connect = function (conf, callback) {
    db = new sqlite3.Database(DB_PATH, function (err) {
        if (err) {
            console.error('[db/sqlite] ' + err.message);
            callback('0');
            return;
        }
        console.log('[db/sqlite] connected');
        db.configure('busyTimeout', 50000);
        db.run('PRAGMA foreign_keys = ON');

        try {
            var schema = fs.readFileSync(path.join(__dirname, '..', exports.schemaFile), 'utf8');
            db.exec(schema, function (e) {
                if (e) { console.error('[db/sqlite] schema init error: ' + e.message); }
                else { console.log('[db/sqlite] schema initialized'); }
                callback('1');
            });
        } catch (e) {
            console.error('[db/sqlite] cannot read schema: ' + e.message);
            callback('1');
        }
    });
};

exports.getConnection = function (callback) {
    if (db) { callback('200', db); }
    else { callback('500-5'); }
};

// 풀이 없으므로 반납할 것이 없다.
exports.release = function () { };

// 행을 돌려주는 문장인지 판별한다.
// sqlite3 는 db.all(행 반환)과 db.run(변경 건수)을 호출자가 골라야 하는데,
// 잘못 고르면 에러 없이 조용히 틀린 형태를 돌려준다(직전 문장의 changes 가 섞인다).
function isRowReturning(sql) {
    var s = String(sql);

    // 선행 공백과 주석을 걷어낸다
    var prev;
    do {
        prev = s;
        s = s.replace(/^\s+/, '')
             .replace(/^--[^\n]*\n?/, '')
             .replace(/^\/\*[\s\S]*?\*\//, '');
    } while (s !== prev);

    if (/^(select|with|pragma|explain|values)\b/i.test(s)) { return true; }

    // RETURNING 검사 전에 문자열 리터럴을 지운다.
    // 안 그러면 values ('returning home') 같은 데이터가 걸려 쓰기가 읽기로 오분류된다.
    var withoutLiterals = s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    if (/\breturning\b/i.test(withoutLiterals)) { return true; }
    return false;
}

exports.execute = function (handle, sql, bindings, callback) {
    // 이 어댑터는 넘어온 handle 을 쓰지 않고 모듈이 소유한 db 핸들만 쓴다.
    //
    // 이유: app.js 는 usesqlite 와 무관하게 항상 MySQL 풀 커넥션을 sql_action 에
    // 넘긴다. 그 핸들은 truthy 이므로 `handle || db` 로는 MySQL 커넥션이 선택되어
    // h.all()/h.run() 이 깨진다. 기존 db_sqlite.getResult 도 connection 인자를
    // 무시하고 모듈 핸들만 쓴다 — 여기서 그 동작을 그대로 따른다.
    // (SQLite 는 풀이 없고 워커당 핸들 하나를 공유한다.)

    // db 가 null 이면(연결 실패) 여기서 잡아야 한다. 안 그러면 TypeError 가
    // index.js 의 try 바깥에서 터져 워커가 죽는다. 구 db_sqlite.getResult 도
    // 같은 검사를 했다.
    if (db == null) {
        return callback(new Error('[db/sqlite] not connected'), null);
    }
    var h = db;

    if (isRowReturning(sql)) {
        h.all(sql, bindings, function (err, rows) {
            if (err) { return callback(err, null); }
            callback(null, rows);
        });
    } else {
        h.run(sql, bindings, function (err) {
            if (err) { return callback(err, null); }
            callback(null, { affectedRows: this.changes, insertId: this.lastID });
        });
    }
};

exports.normalizeResult = function (raw) {
    if (Array.isArray(raw)) { return raw; }
    return {
        affectedRows: raw && raw.affectedRows !== undefined ? raw.affectedRows : 0,
        insertId: raw ? raw.insertId : undefined
    };
};

exports.normalizeError = function (err) {
    if (!err) { return { code: 'UNKNOWN' }; }

    var driverCode = err.code;
    var raw = err.code || '';
    var msg = err.message || '';
    var code = 'UNKNOWN';

    // node-sqlite3 5.1.7 은 확장 코드(SQLITE_CONSTRAINT_*)를 내보내지 않는다 —
    // err.code 는 'SQLITE_CONSTRAINT'까지만 준다. 아래 SQLITE_CONSTRAINT_* 분기는
    // 실측으로는 도달하지 않으며(메시지 정규식이 실제 판별을 담당한다) 상위
    // 드라이버 버전이 확장 코드를 채워주기 시작할 때를 대비해 남겨둔다.
    if (raw === 'SQLITE_BUSY' || raw === 'SQLITE_LOCKED') {
        code = 'LOCK_CONFLICT';
    } else if (raw === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY constraint/i.test(msg)) {
        code = 'FK_VIOLATION';
    } else if (raw === 'SQLITE_CONSTRAINT_NOTNULL' || /NOT NULL constraint/i.test(msg)) {
        code = 'NOT_NULL';
    } else if (raw === 'SQLITE_CONSTRAINT' || raw === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
               raw === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint/i.test(msg)) {
        code = 'DUPLICATE_KEY';
    }

    // 부분 문자열 비교용 힌트. "UNIQUE constraint failed: ae.aei" -> "aei"
    var constraint = null;
    var m = /constraint failed:\s*([^\s,]+)/i.exec(msg);
    if (m) { constraint = m[1].replace(/^.*\./, ''); }

    err.driverCode = driverCode;
    err.code = code;
    err.constraint = constraint;
    return err;
};

// capabilities.transaction 이 false 이므로 파사드가 이 함수들을 부르지 않는다.
// 계약을 채우기 위해 두되, 실수로 호출되면 즉시 드러나도록 에러를 넘긴다.
function unsupported(handle, callback) {
    callback(new Error('[db/sqlite] transactions are not supported on this backend'));
}
exports.begin = unsupported;
exports.commit = unsupported;
exports.rollback = unsupported;
