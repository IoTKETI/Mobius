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
var connectCalled = false;

function pick() {
    return global.usesqlite === 'true' ? ADAPTERS.sqlite : ADAPTERS.mysql;
}

// Knex 는 순수 SQL 생성기다 — knexFactory() 는 DB 에 접속하지 않는다.
// 빌더에 필요한 건 방언 이름뿐이고, 방언은 pick() 만으로 정해진다.
// 그래서 connect() 전에도 빌더는 만들 수 있다. 이렇게 해야 k()/raw() 가
// 동기 throw 를 내지 않는다 — 호출부가 facade.run(facade.k(...), ...) 형태라
// k() 의 예외는 run() 의 try 를 우회해 워커를 죽인다.
function builder() {
    if (!knexInstance) {
        adapter = adapter || pick();
        knexInstance = knexFactory({ client: adapter.knexClient, useNullAsDefault: true });
    }
    return knexInstance;
}

// 실제 연결이 필요한 지점에서만 쓴다. builder() 가 adapter 를 채울 수 있으므로
// adapter 존재 여부로는 판단할 수 없다 — connect() 호출 자체를 기록한다.
function assertReady() {
    if (!connectCalled) {
        throw new Error('[db] connect() has not been called');
    }
}

exports.connect = function (host, port, user, password, callback) {
    adapter = pick();
    knexInstance = null;   // 백엔드가 바뀌었을 수 있으니 빌더를 다시 만든다
    builder();
    connectCalled = true;

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
// assertReady() 를 부르지 않는다 — builder() 의 주석 참고. 연결 검사는 run() 이 한다.
exports.k = function (table) {
    return builder()(table);
};

exports.raw = function (sql, bindings) {
    var kx = builder();
    return bindings === undefined ? kx.raw(sql) : kx.raw(sql, bindings);
};

// opts 는 선택이다. 지금은 { timeoutMs } 하나만 쓴다 —
// 0 을 주면 드라이버 타임아웃을 걸지 않는다. 스키마 마이그레이션처럼
// 수십 분 걸리는 문장에만 쓴다 (mobius/db/mysql.js 의 execute 주석 참고).
exports.run = function (qb, conn, callback, opts) {
    var native;
    try {
        assertReady();
        native = qb.toSQL().toNative();
    } catch (e) {
        // adapter 가 없을 수도 있다(connect() 전 + k() 도 안 불린 경우).
        return callback(true, adapter ? adapter.normalizeError(e)
                                      : { code: 'UNKNOWN', message: e.message });
    }

    adapter.execute(conn, native.sql, native.bindings, function (err, raw) {
        if (err) { return callback(true, adapter.normalizeError(err)); }
        callback(null, adapter.normalizeResult(raw));
    }, opts);
};

// 트랜잭션 본문을 실행한다. 능력이 없는 백엔드에서는 트랜잭션 없이 본문만 돈다
// (조용한 no-op 이 아니라 connect() 에서 이미 경고를 남겼다).
//
// 콜백 규약은 이 레이어의 나머지와 같다: 성공 cb(null, result), 실패 cb(true, err).
// 본문은 finish(err, result) 로 2인자를 넘겨야 에러 객체가 보존된다.
// finish 는 몇 번 불러도 한 번만 정산된다 — 두 경로 모두 그렇다.
exports.transaction = function (conn, body, callback) {
    assertReady();

    var capable = adapter.capabilities.transaction;
    var settled = false;

    function settle(err, result) {
        if (settled) { return false; }
        settled = true;
        callback(err || null, result);
        return true;
    }

    // 본문이 이미 정산한 뒤 던진 예외는 콜백으로 갈 곳이 없다.
    // 조용히 삼키면 원인 불명이 되므로 로그로 남긴다.
    function reportLate(e) {
        console.error('[db] transaction body threw after settling: ' + ((e && e.message) || e));
    }

    if (!capable) {
        try {
            body(conn, function (err, result) { settle(err, result); });
        } catch (e) {
            if (!settle(true, adapter.normalizeError(e))) { reportLate(e); }
        }
        return;
    }

    adapter.begin(conn, function (beginErr) {
        if (beginErr) { return settle(true, adapter.normalizeError(beginErr)); }

        var finishing = false;

        function finish(err, result) {
            if (finishing || settled) { return false; }
            finishing = true;

            if (err) {
                adapter.rollback(conn, function (rbErr) {
                    if (rbErr) { console.error('[db] rollback failed: ' + ((rbErr.message) || rbErr)); }
                    settle(err, result);
                });
                return true;
            }

            adapter.commit(conn, function (commitErr) {
                if (!commitErr) { return settle(null, result); }
                // commit 실패 시에도 커넥션을 깨끗한 상태로 돌려놓아야 한다.
                adapter.rollback(conn, function (rbErr) {
                    if (rbErr) { console.error('[db] rollback after failed commit also failed: ' + ((rbErr.message) || rbErr)); }
                    settle(true, adapter.normalizeError(commitErr));
                });
            });
            return true;
        }

        // 본문이 동기 throw 하면 rollback 없이 빠져나가 커넥션이 열린 트랜잭션
        // 상태로 풀에 반납된다. 다음 요청이 남의 트랜잭션 안에서 돌게 된다.
        try {
            body(conn, finish);
        } catch (e) {
            if (!finish(true, adapter.normalizeError(e))) { reportLate(e); }
        }
    });
};

// capabilities 는 어댑터의 **정적 데이터**다. 연결이 필요 없고, 어느 어댑터인지는
// pick() 만으로 정해진다. 그래서 connect() 전에도 옳게 답할 수 있다.
//
// assertReady() 도 builder() 도 부르지 않는다. 둘 다 던질 수 있기 때문이다 —
// assertReady 는 connect 전이면 무조건, builder 는 knexFactory 가 실패하면.
// 이 함수의 호출부는 요청마다 도는 동기 게이트(resource.js 의 check_db_support)라,
// 여기서 던지면 그 예외가 db.getConnection 콜백 안에서 터져 워커가 죽고
// 빌린 커넥션이 샌다. capabilities 를 읽는 데 knex 인스턴스는 필요 없다.
//
// **계약: 이 함수는 던지지 않는다.**
exports.can = function (name) {
    adapter = adapter || pick();
    return adapter.capabilities[name] === true;
};

// 문장 하나에 시간 상한을 거는 힌트를 돌려준다. 능력이 없는 백엔드에서는 null.
// 쓰는 쪽은 knex 의 .hintComment() 에 넣고, null 이면 그냥 붙이지 않는다.
//
//   var hint = db.statementTimeoutHint(5000);
//   var qb = db.k('cin').count('* as n');
//   if (hint) { qb = qb.hintComment(hint); }
//
// run() 의 opts.timeoutMs 와 용도가 다르다. 그쪽은 **드라이버**가 기다리다
// 포기하면서 커넥션을 죽이므로, 뒤이은 질의가 전부 실패한다. 한 문장만 끊고
// 계속 일해야 하면 이 힌트를 써야 한다.
exports.statementTimeoutHint = function (ms) {
    assertReady();
    if (!adapter.capabilities.statementTimeout) { return null; }
    return adapter.statementTimeoutHint(ms);
};

// 리소스 경로(pi/ri)끼리 비교할 때 붙일 콜레이션 조각. 필요 없으면 빈 문자열.
// 스키마가 두 컬럼을 다른 콜레이션으로 만든 백엔드(MySQL)에서만 값이 있다.
//
//   var C = db.pathCollate();
//   'join skel s on l.pi = s.sk_ri' + C
exports.pathCollate = function () {
    builder();   // adapter 를 채운다 (connect() 전에도 방언은 정해진다)
    return adapter.pathCollate ? adapter.pathCollate() : '';
};

// 옵티마이저에게 인덱스를 강제하는 조각. 지원하지 않는 백엔드는 빈 문자열.
// 이름은 MySQL 스키마의 인덱스명을 그대로 쓴다 — 다른 백엔드는 무시한다.
exports.indexHint = function (name) {
    builder();
    return adapter.indexHint ? adapter.indexHint(name) : '';
};

// 지정한 별칭 사이에 해시 조인을 쓰지 말라는 힌트 조각. 없으면 null.
// 쓰는 쪽은 다른 힌트와 함께 /*+ ... */ 안에 넣는다.
exports.noHashJoinHint = function (aliases) {
    builder();
    return adapter.noHashJoinHint ? adapter.noHashJoinHint(aliases) : null;
};

// "이 행은 contentInstance(ty=4) 가 아니다" 를 그 백엔드에서 가장 잘 도는
// 형태로 돌려준다. discovery 골격이 트리를 넓힐 때 쓴다.
//   MySQL   'l.not_cin = 1'   (가상 생성 컬럼 — 재귀 CTE 는 등치만 인덱스를 탄다)
//   SQLite  'l.ty <> 4'
exports.notCinPredicate = function (alias) {
    builder();
    return adapter.notCinPredicate ? adapter.notCinPredicate(alias) : (alias + '.ty <> 4');
};

// 위 조건을 태울 인덱스 이름. 없으면 null (힌트를 붙이지 않는다).
exports.notCinIndexName = function () {
    builder();
    return adapter.notCinIndexName ? adapter.notCinIndexName() : null;
};

// 수로 비교해야 하는 식을 그 백엔드에 맞게 감싼다.
// cin.cs 가 MySQL 은 int, SQLite 는 TEXT 라 그대로 비교하면 결과가 다르다.
exports.numericExpr = function (expr) {
    builder();
    return adapter.numericExpr ? adapter.numericExpr(expr) : expr;
};

// 테스트용. 운영 코드는 어느 백엔드인지 알 필요가 없다.
exports._adapterName = function () {
    return adapter ? adapter.name : null;
};
