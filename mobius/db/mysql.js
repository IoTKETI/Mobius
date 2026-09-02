'use strict';
// MySQL 어댑터. 실행과 결과/에러 정규화만 담당한다.
// 방언(플레이스홀더, 식별자 인용, upsert, 행 잠금)은 knex 가 처리하므로 여기 없다.

var mysql = require('mysql');

var pool = null;

exports.name = 'mysql';
exports.knexClient = 'mysql';
exports.schemaFile = 'mobiusdb.sql';

exports.capabilities = {
    // serverTuning: true 가 여기 있었다. **불리언을 지우고 메서드로 바꿨다.**
    //
    // 불리언은 "할 수 있다" 만 말하고 "어떻게" 는 말하지 못한다. 그래서 코어가
    // 그 뒤에 무슨 SQL 을 낼지 알아야 했고, mobius/db_bootstrap.js 가
    // `SET PERSIST max_connections = N` 을 코어에서 문자열로 만들고 있었다.
    // 능력이 참인 다른 백엔드가 붙으면 그 문장이 그대로 그쪽으로 날아간다 —
    // 이름 비교보다 더 나쁘다. 이름 비교는 조용히 건너뛰기라도 했다.
    //
    // 지금은 아래 ensureConnectionCeiling 이 그 자리다. 코어는 필요한 수만
    // 넘기고, 무슨 문장을 낼지는 어댑터가 정한다.

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
// 이 백엔드는 리소스 타입을 가리지 않는다. mobiusdb.sql 에 모든 본문 테이블이
// 있다(test/usesqlite-single-reader.test.js 가 대조한다).
//
// **null 이 "제한 없음" 이다.** 목록을 적으면 그 목록에 없는 타입의 CREATE 가
// 501 로 나간다. 501 을 내보내는 게이트는 fail-open 이어야 하므로, 새 어댑터가
// 이 값을 아예 빠뜨려도(undefined) 파사드는 제한 없음으로 읽는다.
// 여기서 굳이 null 을 적는 것은 어댑터들의 export 표면을 같게 두기 위해서다 —
// 한쪽에만 있는 export 가 생기면 코어가 "이 백엔드면 이것도 있다" 를 알게 된다.
exports.supportedResourceTypes = null;

exports.statementTimeoutHint = function (ms) {
    var n = parseInt(ms, 10);
    if (!(n > 0)) { return null; }
    return 'MAX_EXECUTION_TIME(' + n + ')';
};

// 힌트 조각들을 SELECT 뒤에 넣을 한 덩어리로 만든다. 붙일 것이 없으면 빈 문자열.
//
// **감싸는 문법도 방언이다.** 코어가 `'/*+ ' + hints.join(' ') + ' */ '` 를 직접
// 만들고 있었는데, 그 `/*+ */` 는 MySQL(과 Oracle) 표기다. 힌트 조각은 이미
// 어댑터가 주고 있었으므로 코어에 남은 것은 감싸는 법 하나였고, 그것 때문에
// `[a, b].filter(Boolean)` 과 `hints ? ... : ''` 라는 갈래가 코어에 있었다.
//
// 뒤에 공백을 하나 붙여 돌려준다 — 호출부가 'select ' + block + 나머지 로
// 이어 붙이기 때문이다. 빈 문자열일 때 공백을 붙이면 SQL 에 이중 공백이 남는다.
// 배열이 아닌 것이 와도 던지지 않는다. 이 값은 질의를 **만드는** 동안 불리는데,
// 거기서 던지면 그 예외가 facade.run 의 try 를 우회해 워커를 죽인다
// (mobius/db/index.js 의 builder() 주석 참고).
exports.optimizerHintBlock = function (hints) {
    var live = Array.isArray(hints) ? hints.filter(Boolean) : [];
    return live.length ? '/*+ ' + live.join(' ') + ' */ ' : '';
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

// 서버가 동시 접속을 최소 floor 개까지 받게 한다. **올리기만 한다.**
//
// ── 왜 어댑터가 갖는가 ──────────────────────────────────────────────────
// 코어는 "몇 개가 필요한가" 만 안다(mobius/pool_sizing.js 가 풀 크기 x 프로세스
// 수로 계산한다). 그 수를 어떤 문장으로 서버에 거는지는 백엔드마다 다르다 —
// MySQL 은 SET PERSIST, PostgreSQL 은 ALTER SYSTEM SET, SQLite 는 그런 개념이
// 아예 없다. 코어가 그중 하나를 알면 다른 백엔드에서 틀린 문장을 낸다.
//
// 예전에는 capabilities.serverTuning 불리언이었고, 코어가 그 뒤에서 직접
// SET PERSIST 를 만들었다. 능력이 참인 두 번째 백엔드가 붙는 순간 MySQL 문장이
// 그쪽으로 날아가는 구조였다.
//
// ── 왜 올리기만 하는가 ──────────────────────────────────────────────────
// 높은 것은 해가 없다. MySQL 은 실제 접속만큼만 자원을 쓴다. 반대로 내리면
// 그 여유를 쓰던 다른 클라이언트를 끊는다 — 운영자나 관리 UI 가 바닥 위로
// 올려 둔 값을 앱이 되돌리면 안 된다.
//
// ── 왜 SET PERSIST 인가 ────────────────────────────────────────────────
// mysqld-auto.cnf 에 적혀 재기동을 넘어 살아남는다. SET GLOBAL 은 재기동하면
// 사라지고, my.cnf 는 root 로 파일을 고쳐야 한다.
//
// callback(null, {applied, before, after}) / callback(true, err)
exports.ensureConnectionCeiling = function (floor, handle, callback) {
    exports.execute(handle, 'select @@global.max_connections as n', [],
        function (err, rows) {
            if (err) { return callback(true, exports.normalizeError(err)); }

            var now = (rows && rows[0]) ? Number(rows[0].n) : 0;
            if (now >= floor) {
                return callback(null, { applied: false, before: now, after: now });
            }

            // SET PERSIST 는 바인딩을 받지 않는다 — 변수 이름도 값도 자리표가
            // 될 수 없다. floor 는 코어가 계산한 정수라 클라이언트 입력이
            // 섞이지 않지만, 그 전제를 여기서 한 번 더 못박는다.
            var n = parseInt(floor, 10);
            if (!(n > 0)) {
                return callback(true, { code: 'UNKNOWN', message: '바닥값이 양의 정수가 아니다: ' + floor });
            }

            exports.execute(handle, 'SET PERSIST max_connections = ' + n, [],
                function (serr) {
                    if (serr) { return callback(true, exports.normalizeError(serr)); }
                    callback(null, { applied: true, before: now, after: n });
                });
        });
};

exports.connect = function (conf, callback) {
    pool = mysql.createPool({
        host: conf.host,
        port: conf.port,
        user: conf.user,
        password: conf.password,
        database: 'mobiusdb',
        // 풀 크기와 대기열 한도는 conf.json 으로 뺐다(mobius/conf_schema.js).
        // 기본값은 예전에 박혀 있던 값 그대로라 설정을 안 넣으면 동작이 같다.
        //
        // **queueLimit 0 은 무제한이고 그 큐에는 타임아웃이 없다.**
        // 아래 Pool.js:222 가 `if (this.config.queueLimit && ...)` 로 검사해
        // 0 이면 한도 분기를 건너뛰고, acquireTimeout 은 connect/changeUser/ping
        // 에만 걸려 큐 대기에는 관여하지 않는다. 풀이 마르면 요청이 응답도
        // 에러도 없이 영원히 매달린다 — mobius.js 의 use_db_queue_limit 주석 참고.
        connectionLimit: (typeof global.use_db_connection_limit === 'number')
            ? global.use_db_connection_limit : 100,
        waitForConnections: true,
        debug: false,
        acquireTimeout: 50000,
        queueLimit: (typeof global.use_db_queue_limit === 'number')
            ? global.use_db_queue_limit : 0
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

    // 문장 시간 상한에 걸렸다(MAX_EXECUTION_TIME 힌트).
    //
    // **이름은 ER_QUERY_TIMEOUT 이다.** 코어가 ER_MAX_EXECUTION_TIME_EXCEEDED
    // 라고 쓰고 있었는데 이 드라이버에는 없는 이름이라 죽은 가지였다.
    // errno 3024 로만 걸리고 있었다.
    else if (err.code === 'ER_QUERY_TIMEOUT' || err.errno === 3024) { code = 'STATEMENT_TIMEOUT'; }

    // 인덱스가 없다. 코드만 올리고 마이그레이션을 안 돌린 경우다.
    // 드라이버의 상수 이름에 오타가 있다(EXITS) — MySQL 쪽 표기 그대로다.
    else if (err.code === 'ER_KEY_DOES_NOT_EXITS' || err.errno === 1176 ||
             /Key '[^']*' doesn't exist/i.test(err.sqlMessage || err.message || '')) {
        code = 'MISSING_INDEX';
    }

    // err.constraint 는 부분 문자열 비교용 힌트다. 동등 비교하면 안 된다 —
    // MySQL 5.7 은 "aei_UNIQUE", MySQL 8 은 "ae.aei_UNIQUE", SQLite 는 "aei" 를 준다.
    // 테이블 접두사를 떼어 최소한의 공통 형태로 맞춘다.
    //
    // **인덱스 부재에는 붙이지 않는다.** 1176 의 서버 메시지가
    // "Key 'idx_lookup_pi_notcin' doesn't exist in table 'lookup'" 이라 아래
    // 정규식에 그대로 걸린다. 그러면 인덱스 이름이 **중복키 제약 이름인 척**
    // 달려서 코어로 간다. 지금은 isAeiDuplicate 가 isDuplicateKey 안쪽에만
    // 있어 도달하지 않지만, 그 가둠이 풀리면 곧바로 오진이 된다.
    var constraint = null;
    if (code !== 'MISSING_INDEX') {
        var m = /key '([^']+)'/i.exec(err.sqlMessage || err.message || '');
        if (m) { constraint = m[1].replace(/^.*\./, ''); }
    }

    err.driverCode = driverCode;
    err.code = code;
    err.constraint = constraint;
    return err;
};

exports.begin = function (handle, callback) { handle.beginTransaction(callback); };
exports.commit = function (handle, callback) { handle.commit(callback); };
exports.rollback = function (handle, callback) { handle.rollback(callback); };
