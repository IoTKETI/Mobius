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
    statementTimeout: false,

    // 리소스 타입 제한은 capabilities 가 아니라 아래 supportedResourceTypes 가
    // 말한다. boolean 으로 두면 "제한이 있다" 와 "무엇을 받는가" 가 두 파일에
    // 나뉘어 어긋난다 — 실제로 목록이 resource.js 에 있었다.
};

// 이 백엔드가 **아직** 다룰 수 있는 리소스 타입.
//
// **이 목록은 임시다.** SQLite 백엔드는 개발 중이고, 최종적으로는 MySQL 과
// 같은 타입을 전부 받는 것이 목표다. 그때 이 값은 null 이 되고 아래
// 미지원 목록도 사라진다.
//
// 등록 조건은 둘이다 — mobiusdb_sqlite.sql 에 본문 테이블이 있을 것, 그리고
// 그 타입의 본문 insert 가 파사드를 탈 것. 지금은 후자가 전부 만족되므로
// (sql_action 의 손으로 쓴 SQL 이 0개다) **남은 것은 스키마뿐이다.**
//
// 아직 없는 테이블 9개 = 아직 못 받는 타입:
//   grp(9) lcp(10) mgo(13) nod(14) csr(16) smd(24) mms(27) fcnt(28)
//   그리고 sri (레거시, 어느 타입도 안 씀)
// mobiusdb.sql 과 대조해 하나씩 추가하면 그만큼 이 목록에 더하면 된다.
//
// **극성 주의**: 이 값을 **선언하지 않는 것**이 "제한 없음" 이다(MySQL 이
// 그렇다). 반대로 모든 백엔드가 지원 목록을 적게 하면, 하나만 빠뜨려도
// 정상 CREATE 가 501 로 나간다. 501 을 내보내는 게이트는 fail-open 이어야 한다.
//
// 예전에는 이 목록이 resource.js 에 SQLITE_SUPPORTED_TY 라는 이름으로 있었다.
// 코어에, 그것도 한 백엔드 이름을 달고 있었으므로 다른 백엔드가 다른
// 부분집합을 지원하려면 코어를 고쳐야 했다.
//
//   1=acp  2=ae  3=cnt  4=cin  5=cb  23=sub
exports.supportedResourceTypes = ['1', '2', '3', '4', '5', '23'];

exports.statementTimeoutHint = function () { return null; };

// SQLite 에는 옵티마이저 힌트를 넣는 문법이 없다. 조각도 없고 감쌀 것도 없다.
// 이 어댑터의 힌트 함수들이 전부 null 을 주므로 목록은 언제나 비지만,
// **함수는 있어야 한다** — 없으면 코어가 "이 백엔드는 힌트가 없다" 를 알아야 한다.
exports.optimizerHintBlock = function () { return ''; };

// mobiusdb_sqlite.sql 은 pi / ri 를 같은(기본 BINARY) 콜레이션으로 만든다.
// 붙일 조각이 없다. MySQL 이 대소문자를 무시하는 것과 달리 SQLite 는
// 구분하지만, 이는 이 스키마가 원래 갖고 있던 성질이라 그대로 둔다.
exports.pathCollate = function () { return ''; };

// SQLite 에도 INDEXED BY 가 있으나 인덱스 이름이 MySQL 과 다르고,
// 임베디드 규모에서는 옵티마이저를 강제할 이유가 없다.
exports.indexHint = function () { return ''; };

// SQLite 에는 조인 알고리즘을 고르는 힌트가 없다 (중첩 루프만 쓴다).
exports.noHashJoinHint = function () { return null; };

// SQLite 는 조건을 그대로 쓴다.
//
// MySQL 쪽은 재귀 CTE 안에서 range 접근이 안 되어 가상 생성 컬럼(not_cin)이
// 필요했지만, SQLite 는 임베디드 규모라 그럴 이유가 없다. 그리고 SQLite 에는
// INVISIBLE 컬럼이 없어서 컬럼을 만들면 `select *` 응답에 그대로 새어 나간다.
// 조건만 다르고 질의 모양은 두 백엔드가 같다.
exports.notCinPredicate = function (alias) {
    return alias + '.ty <> 4';
};

exports.notCinIndexName = function () { return null; };

// 수로 비교해야 하는 식을 감싼다.
//
// mobiusdb_sqlite.sql 은 cin.cs 를 TEXT 로 선언한다(MySQL 은 int 다).
// SQLite 에서 TEXT 컬럼과 정수 리터럴을 비교하면 어느 쪽에도 수치 affinity 가
// 없어 변환이 일어나지 않고, 정수는 늘 텍스트보다 작다고 판정된다 —
// `10 <= cs` 가 모든 행에서 참이 되어 필터가 아무 일도 안 한다.
// 스키마를 고쳐도 이미 만들어진 DB 는 TEXT 그대로이므로 캐스팅이 필요하다.
exports.numericExpr = function (expr) {
    return 'CAST(' + expr + ' AS INTEGER)';
};

// SQLite 에는 동시 접속 상한이라는 개념이 없다. 서버가 없고 프로세스가 파일을
// 직접 여니 "몇 개까지 받는가" 를 물을 대상이 없다. 그래서 아무것도 하지 않는다.
//
// **그래도 함수는 있다.** 없으면 파사드가 "이 어댑터는 이 기능이 없다" 를
// 알아야 하고, 그것을 알려면 다시 백엔드를 구분해야 한다. 두 어댑터의 export
// 표면이 같아야 코어가 조건 없이 부를 수 있다 —
// test/db-adapter-contract.test.js 가 그 표면을 대조한다.
// supportedResourceTypes 에 mysql 이 null 을 명시적으로 적는 것과 같은 이유다.
//
// 대응하는 손잡이가 아주 없는 것은 아니다. SQLite 에서 "동시에 여럿이 쓸 때
// 어떻게 하는가" 는 잠금 대기로 다루고, 그것은 connect 에서 busy_timeout 으로
// 이미 건다(sqliteBusyTimeoutMs). 성격이 달라 여기에 묶지 않는다.
exports.ensureConnectionCeiling = function (floor, handle, callback) {
    callback(null, { applied: false, reason: 'SQLite 에는 동시 접속 상한이 없다' });
};

// 설정값을 읽는다. 전역이 없으면(테스트 등) 기본값을 쓴다.
//
// 값은 PRAGMA 문에 **그대로 들어가므로** 반드시 허용 목록으로 거른다.
// PRAGMA 는 바인딩을 받지 않는다 — 자리표를 쓸 수 없다.
var JOURNAL_MODES = ['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF'];
var SYNC_MODES = ['FULL', 'NORMAL', 'OFF', 'EXTRA'];

function pick_mode(value, allowed, fallback) {
    var v = String(value == null ? '' : value).toUpperCase();
    return allowed.indexOf(v) >= 0 ? v : fallback;
}

// 기본 WAL. 여러 프로세스가 한 파일을 여는 것이 이 배포의 전제다.
function journal_mode() {
    return pick_mode(global.use_sqlite_journal_mode, JOURNAL_MODES, 'WAL');
}

// 기본 FULL. MySQL 쪽에서 innodb_flush_log_at_trx_commit = 1 을 고른 것과
// 같은 판단이다 — 이 코드에는 커밋 유실을 흡수할 장치가 없다.
// WAL + NORMAL 은 응용 프로그램 충돌에는 안전하지만 전원 장애에서 꼬리를
// 잃는다. 그 차이를 감수할 이유가 아직 없다.
function synchronous() {
    return pick_mode(global.use_sqlite_synchronous, SYNC_MODES, 'FULL');
}

// 잠긴 동안 얼마나 기다릴 것인가. MySQL 의 커넥션 대기에 해당한다.
function busy_timeout_ms() {
    var v = global.use_sqlite_busy_timeout_ms;
    return (typeof v === 'number' && v >= 0) ? v : 50000;
}

exports.connect = function (conf, callback) {
    db = new sqlite3.Database(DB_PATH, function (err) {
        if (err) {
            console.error('[db/sqlite] ' + err.message);
            callback('0');
            return;
        }
        console.log('[db/sqlite] connected');

        // ── MySQL 튜닝 네 값에 대응하는 SQLite 설정 ──────────────────────
        //
        //   MySQL                             SQLite
        //   innodb_flush_log_at_trx_commit    PRAGMA synchronous
        //   sync_binlog                       (없다 — binlog 가 없다)
        //   transaction_isolation             (없다 — 언제나 직렬화다)
        //   max_connections / 풀 크기         busyTimeout (핸들이 하나뿐)
        //
        // journal_mode 는 MySQL 에 대응이 없지만 **여기서 가장 중요하다.**
        // 기본값 rollback journal 은 쓰는 동안 읽는 쪽을 전부 막는다.
        // app.js 가 백엔드와 무관하게 코어 수만큼 워커를 포크하므로
        // (배포 기준 24개) 한 파일을 여러 프로세스가 여는 전제가 그대로다 —
        // MySQL 쪽에서 커넥션 풀이 말라 멈추던 것과 같은 자리다.
        // WAL 이면 읽기와 쓰기가 서로를 막지 않는다.
        //
        // **journal_mode 는 DB 파일에 영속된다.** 한 번 WAL 로 바꾸면 그
        // 파일은 계속 WAL 이고, 반대로 이미 만들어진 파일은 이 코드를 넣어도
        // 여기서 바꿔 주지 않으면 옛 모드 그대로다. 그래서 매 기동 건다.
        // **콜백을 반드시 준다.** 콜백 없는 db.run 이 실패하면 node-sqlite3 가
        // Database 에 'error' 를 뿜는데, 듣는 이가 없으면 EventEmitter 규약대로
        // **미처리 예외**가 되어 워커가 죽는다(실측 확인). 로그 한 줄로 끝날
        // 일이 프로세스 사망이 된다.
        //
        // journal_mode 는 실제로 실패할 수 있다 — 다른 커넥션이 트랜잭션을
        // 쥐고 있으면 전환이 거부된다. (유휴로 열려 있는 것만으로는 안 막힌다.)
        // 그때도 기동은 계속해야 한다. 모드가 안 바뀐 것뿐이고, 다음 기동에
        // 다시 시도한다.
        function pragma(sql) {
            db.run(sql, function (e) {
                if (e) {
                    console.error('[db/sqlite] ' + sql + ' 실패: ' + e.message);
                }
            });
        }

        db.configure('busyTimeout', busy_timeout_ms());
        pragma('PRAGMA foreign_keys = ON');
        pragma('PRAGMA journal_mode = ' + journal_mode());
        pragma('PRAGMA synchronous = ' + synchronous());

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
