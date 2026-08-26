'use strict';
// DB 파사드. global.usesqlite 를 읽는 유일한 지점이다.
//
// knex 는 빌더로만 쓴다 — qb.toSQL().toNative() 로 {sql, bindings} 를 얻고
// 실행은 어댑터가 기존 드라이버로 한다. knex 의 실행/풀/마이그레이션은 쓰지 않는다.
//
// 콜백 계약은 기존 db_action.getResult 를 그대로 따른다:
//   성공  cb(null, rows[])  또는  cb(null, {affectedRows, insertId})
//   실패  cb(true, err)      ← 첫 인자가 true, 둘째가 에러
// resource.js 29곳이 이 형태에 의존한다.

var knexFactory = require('knex');

var ADAPTERS = {
    mysql: require('./mysql'),
    sqlite: require('./sqlite')
};

var adapter = null;
var knexInstance = null;

function pick() {
    return global.usesqlite === 'true' ? ADAPTERS.sqlite : ADAPTERS.mysql;
}

function assertReady() {
    if (!adapter || !knexInstance) {
        throw new Error('[db] connect() has not been called');
    }
}

exports.connect = function (host, port, user, password, callback) {
    adapter = pick();
    knexInstance = knexFactory({ client: adapter.knexClient, useNullAsDefault: true });

    if (!adapter.capabilities.transaction) {
        console.log('[db] backend "' + adapter.name + '" does not support transactions; ' +
                    'db.transaction() runs the body without one');
    }

    adapter.connect({ host: host, port: port, user: user, password: password }, callback);
};

exports.getConnection = function (callback) {
    assertReady();
    adapter.getConnection(callback);
};

exports.release = function (handle) {
    assertReady();
    adapter.release(handle);
};

// 빌더 진입점. sql_action.js 는 db.k('table')... 로 쿼리를 만든다.
exports.k = function (table) {
    assertReady();
    return knexInstance(table);
};

exports.raw = function (sql, bindings) {
    assertReady();
    return bindings === undefined ? knexInstance.raw(sql) : knexInstance.raw(sql, bindings);
};

exports.run = function (qb, conn, callback) {
    assertReady();

    var native;
    try {
        native = qb.toSQL().toNative();
    } catch (e) {
        return callback(true, adapter.normalizeError(e));
    }

    adapter.execute(conn, native.sql, native.bindings, function (err, raw) {
        if (err) { return callback(true, adapter.normalizeError(err)); }
        callback(null, adapter.normalizeResult(raw));
    });
};

// 능력이 없으면 트랜잭션 없이 본문을 실행한다. 조용한 no-op 이 아니라
// connect() 에서 이미 경고를 남겼다.
exports.transaction = function (conn, body, callback) {
    assertReady();

    if (!adapter.capabilities.transaction) {
        return body(conn, function (err) { callback(err); });
    }

    adapter.begin(conn, function (beginErr) {
        if (beginErr) { return callback(beginErr); }
        body(conn, function (bodyErr) {
            if (bodyErr) {
                return adapter.rollback(conn, function () { callback(bodyErr); });
            }
            adapter.commit(conn, function (commitErr) { callback(commitErr || null); });
        });
    });
};

exports.can = function (name) {
    assertReady();
    return adapter.capabilities[name] === true;
};

// 테스트용. 운영 코드는 어느 백엔드인지 알 필요가 없다.
exports._adapterName = function () {
    return adapter ? adapter.name : null;
};
