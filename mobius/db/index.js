'use strict';
// DB 파사드. 어느 백엔드로 도는지 아는 유일한 지점이다.
//
// knex 는 빌더로만 쓴다 — qb.toSQL().toNative() 로 {sql, bindings} 를 얻고
// 실행은 어댑터가 기존 드라이버로 한다. knex 의 실행/풀/마이그레이션은 쓰지 않는다.
//
// 콜백 계약은 기존 db_action.getResult 를 그대로 따른다:
//   성공  cb(null, rows[])  또는  cb(null, {affectedRows, insertId})
//   실패  cb(true, err)      ← 첫 인자가 true, 둘째가 에러
// resource.js 29곳이 이 형태에 의존한다.

var knexFactory = require('knex');

// 임대 장부. 반납되지 않는 커넥션을 드러내는 유일한 수단이라, 취득처를
// 파사드로 모으면서 이것도 같이 옮겼다(예전에는 db_action 에 붙어 있었다).
var lease = require('../lease');

// 어댑터는 이 디렉터리의 파일이다 — mobius/db/<이름>.js.
// **새 백엔드는 파일 하나를 여기 두면 등록된다.** 이 목록을 고칠 필요가 없다.
// 무엇을 갖춰야 하는지는 test/db-adapter-contract.test.js 가 알려준다 —
// 파일을 두고 그 테스트를 돌리면 빠진 것이 이름으로 나온다.
//
// index.js 와 errors.js 는 어댑터가 아니다.
var ADAPTERS = (function () {
    var fs = require('fs');
    var path = require('path');
    var out = {};
    fs.readdirSync(__dirname).forEach(function (f) {
        if (!/\.js$/.test(f)) { return; }
        var name = f.replace(/\.js$/, '');
        if (name === 'index' || name === 'errors') { return; }
        out[name] = require('./' + name);
    });
    return out;
})();

var adapter = null;
var knexInstance = null;
var connectCalled = false;

// 기본 백엔드. global.usedb 가 없거나 모르는 이름이면 이것을 쓴다.
var DEFAULT_BACKEND = 'mysql';

function pick() {
    // 선택자는 **이름**이다. 그리고 이제 이름 하나뿐이다.
    //
    // 예전에는 global.usesqlite 라는 boolean 폴백이 여기 있었다. 그것을 지운
    // 이유는 편의가 아니라 정확성이다 — boolean 으로는 백엔드를 **둘까지만**
    // 말할 수 있고, 셋째가 붙는 순간 틀린 답을 낸다. usesqlite='false' 가
    // 'mysql' 을 뜻하도록 되어 있었으므로, postgres 로 도는 서버에서 그 값을
    // 읽으면 mysql 이라고 답한다. 무용지물이 아니라 거짓말을 하는 상태다.
    //
    // 폴백을 남겨 둘 실익도 없었다. 이 전역을 세우던 곳(테스트 25개 파일,
    // tools 2개, mobius.js 의 별칭)이 전부 usedb 로 옮겼기 때문에, 남겨 두면
    // "아무도 안 세우는 값을 읽는 죽은 갈래" 가 된다.
    //
    // **conf.json 의 usesqlite 키도 사라졌다.** 한때 옛 설정 파일 호환으로
    // 진입점에서 번역해 주었는데, 번역을 남기면 설정 키가 둘인 상태가 끝나지
    // 않는다 — 옛 이름이 계속 동작하는 한 새 코드가 그것을 보고 따라 쓴다.
    // 이제 선택자는 conf.json 의 db 키 하나다.
    //
    // 모르는 이름이면 기본값으로 간다 — 오타 하나로 기동이 막히는 것보다,
    // 로그를 남기고 아는 백엔드로 도는 편이 낫다.
    var name = global.usedb || DEFAULT_BACKEND;
    if (ADAPTERS[name]) { return ADAPTERS[name]; }

    console.error('[db] 모르는 백엔드 "' + name + '" — ' + DEFAULT_BACKEND +
                  ' 로 간다. 쓸 수 있는 것: ' + Object.keys(ADAPTERS).join(', '));
    return ADAPTERS[DEFAULT_BACKEND];
}

// 이 파사드가 아는 백엔드 이름들. 도구와 테스트가 쓴다.
exports.backends = function () {
    return Object.keys(ADAPTERS).sort();
};

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

// 커넥션 취득. **임대 장부를 여기서 씌운다.**
//
// 예전에는 db_action.getConnection 이 이 일을 했다. 그 파일이 파사드 위의
// 껍데기가 되면서 남은 실제 로직이 이 둘뿐이었고, 취득처가 파사드인 이상
// 장부도 여기 있는 것이 맞다 — 코어가 파사드를 직접 부르기 시작하면
// 껍데기를 지나지 않아 장부에서 빠지기 때문이다.
//
// **try 범위에 주의.** adapter.getConnection 은 백엔드에 따라 콜백을
// **동기로** 부른다(SQLite 어댑터가 그렇다). 그러면 요청 처리 사슬 전체가
// 이 try 안에서 돌게 되는데, 거기서 난 예외까지 삼키면 응답도 정산도 없이
// 요청이 영구히 매달린다 — 크래시보다 나쁘다. 지금은 워커가 죽으면
// backstop 이 소켓을 닫아 커넥션이 회수되고 cluster 가 다시 띄운다.
//
// 그래서 **콜백에 들어간 뒤의 예외는 그대로 올려보낸다.** 여기서 정규화할
// 것은 취득 자체가 동기로 던지는 경우(연결 전 호출)뿐이다.
exports.getConnection = function (callback) {
    var entered = false;
    try {
        assertReady();
        adapter.getConnection(function (code, connection) {
            entered = true;
            if (code !== '200' || !connection) {
                callback('500-5');
                return;
            }
            // 반납되지 않는 커넥션을 드러내기 위한 장부다. 동작은 바꾸지
            // 않는다 — release 를 감싸 장부만 지우고 원래 release 를 그대로
            // 부른다. 핸들에 release 가 없으면(SQLite 싱글턴) lease 가 알아서
            // 비켜간다. 그쪽은 풀이 없어 고갈될 것도 없다. mobius/lease.js 참고.
            callback('200', lease.track(connection));
        });
    } catch (e) {
        if (entered) { throw e; }   // 요청 사슬의 예외다 — 삼키면 안 된다
        console.error('[db.getConnection] ' + ((e && e.message) || e));
        callback('500-5');
    }
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

// **한시적 진입점.** 이미 완성된 SQL 문자열을 그 백엔드의 어댑터로 보낸다.
//
// knex 를 거치지 않는다. raw() 를 쓰면 knex 가 문자열의 '?' 를 바인딩 자리로
// 해석하는데, 이 경로로 오는 SQL 은 값이 이미 문자열에 박혀 있다(옛 util.format
// 조립). 지금 두 백엔드는 그 해석이 항등이라 무해하지만, 다른 방언은 '?' 를
// 자기 자리표시자로 바꾼다 — 그러면 데이터 안의 물음표가 변조된다.
// 이 작업의 목적이 "다른 DB 붙이기" 라 그 함정을 아예 피한다.
//
// **새 코드는 쓰지 마라.** k() / run() 을 써라. 이 함수의 호출부는
// db_action.getResult 하나여야 하고, 그 위의 생 SQL 이 빌더로 옮겨가면 지운다.
exports.execRaw = function (sql, conn, callback, opts) {
    try {
        assertReady();
    } catch (e) {
        return callback(true, adapter ? adapter.normalizeError(e)
                                      : { code: 'UNKNOWN', message: e.message });
    }
    adapter.execute(conn, sql, [], function (err, raw) {
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
        // **사용자 콜백은 try 밖에서 부른다.**
        //
        // 예전에는 body(conn, cb) 를 통째로 try 로 감쌌다. 그런데 body 가
        // **동기로** 정산하면(run() 은 assertReady/toSQL 실패 때 콜백을 동기로
        // 부른다) 그 뒤 사용자 콜백이 던진 예외까지 이 catch 에 걸린다.
        // settled 가 이미 참이라 reportLate 로 로그만 남고 예외는 사라진다 —
        // 트랜잭션과 무관한 하류의 버그를 파사드가 삼키는 셈이다.
        //
        // 이 차이 때문에 호출부가 `if (can('transaction'))` 로 갈라져 있었다.
        // 능력 없는 백엔드에서는 파사드를 안 거쳐야 예외가 올라갔기 때문이다.
        // 여기를 고쳐야 그 분기를 지울 수 있다.
        //
        // 동기 정산이면 결과를 담아 두었다가 try 를 빠져나온 뒤 전달한다.
        // 비동기 정산이면 애초에 try 의 동적 범위 밖이라 그대로 부른다.
        var inBody = true;
        var pending = null;

        try {
            body(conn, function (err, result) {
                if (settled) { return; }
                settled = true;
                if (inBody) { pending = { err: err || null, result: result }; }
                else { callback(err || null, result); }
            });
        } catch (e) {
            inBody = false;
            if (!settled) {
                settled = true;
                return callback(true, adapter.normalizeError(e));
            }
            // 이미 정산한 뒤 body 가 던졌다. 그 예외는 갈 곳이 없으니 남긴다.
            // 아래에서 정산 결과는 그대로 전달한다 — 삼키면 요청이 매달린다.
            reportLate(e);
        }

        inBody = false;
        if (pending) { callback(pending.err, pending.result); }
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
// 이 백엔드가 받는 리소스 타입. **제한이 없으면 null 이다.**
//
// 어댑터가 supportedResourceTypes 를 선언하지 않는 것이 "제한 없음" 이다.
// 코어의 게이트(resource.js 의 check_db_support)가 501 을 내보내므로 반드시
// fail-open 이어야 한다 — 모든 백엔드가 목록을 적게 하면 하나만 빠뜨려도
// 정상 CREATE 가 501 이 된다.
//
// can() 과 같은 이유로 던지지 않는다. CREATE 요청마다 도는 동기 게이트라
// 여기서 던지면 그 예외가 db.getConnection 콜백 안에서 터져 워커가 죽고
// 빌린 커넥션이 샌다.
exports.supportedResourceTypes = function () {
    adapter = adapter || pick();
    var list = adapter.supportedResourceTypes;
    return Array.isArray(list) ? list : null;
};

// **계약: 이 함수는 던지지 않는다.**
//
// **새 코드에서 이 함수를 쓰지 마라.** 능력을 물어서 코어가 갈라지면, 그 갈래는
// 코어가 백엔드를 아는 자리다. 대신 파사드에 "그 일을 해 주는 함수" 를 만들고
// 어댑터가 자기 방식으로 구현하게 한다 — 아래 lockRow, ensureConnectionCeiling 이
// 그 모양이다. 그러면 백엔드가 늘어도 코어의 if 는 늘지 않는다.
//
// 남겨 두는 이유는 테스트와 진단이다. 실제로 이 함수로 갈라지는 코어 코드는 없다.
exports.can = function (name) {
    adapter = adapter || pick();
    return adapter.capabilities[name] === true;
};

// 이 읽기를 다른 트랜잭션이 못 건드리게 잠근다. 잠금이 없는 백엔드에서는
// 빌더를 그대로 돌려준다.
//
// 호출부가 `if (db.can('rowLock')) { qb = qb.forUpdate(); }` 라고 쓰던 자리다.
// 그러면 코어가 "이 백엔드에 행 잠금이 있는가" 를 아는 셈이고, 잠금 개념이
// 다른 백엔드(낙관적 버전 컬럼, SELECT FOR SHARE 등)가 붙으면 코어를 고쳐야 한다.
//
// 이 형태면 **의도는 코드에 남고 방법은 어댑터가 정한다.** "이 읽기는 잠그려던
// 것" 이 호출부에서 읽히는 것이 중요하다 — knex 가 SQLite 에서 forUpdate() 를
// 조용히 빈 문자열로 만든다는 사실에 기대면, 코드만 봐서는 잠금이 없다는 것을
// 알 수 없다.
exports.lockRow = function (qb) {
    adapter = adapter || pick();
    return adapter.capabilities.rowLock === true ? qb.forUpdate() : qb;
};

// 서버가 동시 접속을 최소 floor 개까지 받게 한다. 올리기만 하고, 그 개념이
// 없는 백엔드에서는 아무것도 하지 않는다.
//
// 코어는 필요한 수만 계산해서 넘긴다(mobius/pool_sizing.js). 무슨 문장을
// 낼지는 어댑터가 정한다 — MySQL 은 SET PERSIST, SQLite 는 no-op 이다.
exports.ensureConnectionCeiling = function (floor, conn, callback) {
    try {
        assertReady();
    } catch (e) {
        return callback(true, adapter ? adapter.normalizeError(e)
                                      : { code: 'UNKNOWN', message: e.message });
    }
    adapter.ensureConnectionCeiling(floor, conn, callback);
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

// SELECT 뒤에 넣을 힌트 덩어리. 붙일 것이 없으면 빈 문자열이다.
//
//   var lead = 'select ' + db.optimizerHints([
//       db.statementTimeoutHint(30000),
//       db.noHashJoinHint(['l', 's'])
//   ]);
//
// 호출부가 null 을 걸러 내거나 `/*+ */` 로 감쌀 필요가 없다. 그 두 가지가
// 코어에 있던 마지막 방언 지식이었다 — 감싸는 표기 자체가 MySQL 것이다.
exports.optimizerHints = function (hints) {
    builder();
    return adapter.optimizerHintBlock(hints);
};

// 이 질의 하나에 서버 측 시간 상한을 건다. 그 능력이 없는 백엔드에서는
// 빌더를 그대로 돌려준다.
//
// 호출부가 `var h = hint(ms); if (h) { qb = qb.hintComment(h); }` 라고 쓰던
// 자리다. null 검사가 곧 "이 백엔드에 상한 힌트가 있는가" 를 코어가 아는 것이다.
//
// **드라이버 타임아웃(run 의 opts.timeoutMs)과 다르다.** 그쪽은 커넥션을
// 죽여서 뒤이은 질의가 전부 연쇄 실패한다. 이것은 그 문장만 중단한다.
exports.withStatementTimeout = function (qb, ms) {
    builder();
    if (!adapter.capabilities.statementTimeout) { return qb; }
    var hint = adapter.statementTimeoutHint(ms);
    return hint ? qb.hintComment(hint) : qb;
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

// ri 컬럼 **자체**의 콜레이션. pathCollate 와 반대쪽이다.
//
//   pathCollate  pi 와 ri 를 견주려고 대소문자를 무시하는 쪽에 맞춘다
//   riCollate    ri 를 다른 테이블의 ri 와 조인할 때 원래 쪽으로 되돌린다
//
// 골격의 sk_ri 는 pathCollate 로 캐스트돼 있으므로, 그것을 cnt.ri 같은 다른
// ri 와 조인하려면 이것으로 되돌려야 한다. 안 그러면 콜레이션이 섞여 죽는다.
exports.riCollate = function () {
    builder();
    return adapter.riCollate ? adapter.riCollate() : '';
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

// 지금 고른 백엔드의 이름.
//
// **동작을 가르는 데 쓰지 마라.** 그 자리는 can() 이다. 이름으로 갈라 놓으면
// 새 백엔드가 붙을 때 그 갈래가 조용히 틀린 쪽으로 간다 — 능력으로 물으면
// 어댑터가 스스로 답하므로 그런 일이 없다.
//
// 이름 **자체가 데이터**인 자리에만 쓴다. 지금은 둘뿐이다.
//
//   마이그레이션 필터링   migrations 의 backends: ['mysql'] 과 대조한다.
//                         여기서는 이름이 곧 값이라 피할 방법이 없다.
//   진단 로그·에러 메시지  운영자에게 어느 백엔드로 돌고 있는지 알려준다.
//
// 호출부가 global.usedb 를 직접 읽으면 안 되는 이유가 여기 있다. pick() 은
// 모르는 이름을 기본값으로 되돌리므로(오타 하나로 기동이 막히지 않게), conf 에
// "mysq1" 이라고 적혀 있으면 앱은 mysql 로 도는데 global.usedb 는 "mysq1" 이다.
// 그 둘을 따로 읽으면 판단이 갈린다.
exports.backendName = function () {
    adapter = adapter || pick();
    return adapter.name;
};

// 옛 이름. 테스트가 쓰고 있어 남겨 둔다.
exports._adapterName = function () {
    return adapter ? adapter.name : null;
};
