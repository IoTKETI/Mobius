'use strict';
// SQLite adapter. No pool; one handle per worker is shared.
//
// capabilities.transaction is false: with a single handle, overlapping asynchronous calls would interleave different logical transactions. capabilities.rowLock is false: SQLite is a single-writer file database without row locks; knex omits forUpdate() silently but noWait() throws, so callers check db.can('rowLock').

var fs = require('fs');
var path = require('path');

// The driver is loaded at connect time, not at require time, so deployments on another backend do not load the native addon and a machine without a built sqlite3 can still run MySQL.
//
// verbose() stays on: without it error stacks shrink to one line without JS frames. For performance measurements it can be turned off with MOBIUS_SQLITE_VERBOSE=0 (the tracer adds work per query).
var sqlite3 = null;

function load_driver() {
    if (sqlite3) { return sqlite3; }
    var mod = require('sqlite3');
    // On by default; only an explicit '0' turns it off.
    sqlite3 = (process.env.MOBIUS_SQLITE_VERBOSE === '0') ? mod : mod.verbose();
    return sqlite3;
}

var db = null;

// The path is overridable so tests do not touch the development database.
var DB_PATH = process.env.MOBIUS_SQLITE_PATH || './mobius.db';

exports.name = 'sqlite';
exports.knexClient = 'sqlite3';

// Schema file of this backend, as an absolute path. Consumers read this value; the directory is known here only.
exports.schemaPath = path.join(__dirname, 'mobiusdb_sqlite.sql');

exports.capabilities = {
    transaction: false,
    rowLock: false,

    // SQLite has no hint to cut a single statement by time (sqlite3_progress_handler is not exposed by node-sqlite3, and the embedded scale does not need it).
    statementTimeout: false,

    // Resource type restriction is expressed by supportedResourceTypes below, not by a capability flag.
};

// Resource types this backend can handle for now. The list is temporary: the goal is parity with MySQL, at which point the value becomes null.
//
// A type is added when mobiusdb_sqlite.sql has its body table (every body insert already goes through the facade). Tables still missing: grp(9) lcp(10) mgo(13) nod(14) csr(16) smd(24) mms(27) fcnt(28), and sri (legacy).
//
// Polarity: not declaring this value means 'unrestricted' (MySQL). The 501 gate must be fail-open.
//
//   1=acp  2=ae  3=cnt  4=cin  5=cb  23=sub
exports.supportedResourceTypes = ['1', '2', '3', '4', '5', '23'];

exports.statementTimeoutHint = function () { return null; };

// SQLite has no optimizer hint syntax; every hint function returns null and the block is always empty. The functions must still exist so the core does not need to know.
exports.optimizerHintBlock = function () { return ''; };

// mobiusdb_sqlite.sql creates pi and ri with the same (BINARY) collation; nothing to add.
exports.pathCollate = function () { return ''; };

// Same collation for pi and ri, so nothing to add; same reason as pathCollate.
exports.riCollate = function () { return ''; };

// SQLite has INDEXED BY, but the index names differ from MySQL and the embedded scale gives no reason to force the optimizer.
exports.indexHint = function () { return ''; };

// SQLite has no join algorithm hints (nested loops only).
exports.noHashJoinHint = function () { return null; };

// SQLite uses the plain condition. The MySQL side needs a virtual generated column (not_cin) because range access is unavailable inside a recursive CTE; SQLite has no INVISIBLE columns, so a generated column would leak into `select *`. Only the predicate differs; the query shape is the same on both backends.
exports.notCinPredicate = function (alias) {
    return alias + '.ty <> 4';
};

exports.notCinIndexName = function () { return null; };

// Wraps an expression that must compare numerically. mobiusdb_sqlite.sql declares cin.cs as TEXT (MySQL: int); comparing a TEXT column with an integer literal applies no numeric affinity, so `10 <= cs` would be true for every row. Existing databases keep TEXT, so the cast is needed.
exports.numericExpr = function (expr) {
    return 'CAST(' + expr + ' AS INTEGER)';
};

// SQLite has no concurrent-connection ceiling: there is no server. The function exists so both adapters have the same export surface (test/db-adapter-contract.test.js). Lock waiting is handled by busy_timeout in connect (sqliteBusyTimeoutMs).
exports.ensureConnectionCeiling = function (floor, handle, callback) {
    callback(null, { applied: false, reason: 'SQLite 에는 동시 접속 상한이 없다' });
};

// Reads configuration values; defaults apply when the global is absent (tests). The values go into PRAGMA statements verbatim (PRAGMA takes no bindings), so they are filtered through allow lists.
var JOURNAL_MODES = ['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF'];
var SYNC_MODES = ['FULL', 'NORMAL', 'OFF', 'EXTRA'];

function pick_mode(value, allowed, fallback) {
    var v = String(value == null ? '' : value).toUpperCase();
    return allowed.indexOf(v) >= 0 ? v : fallback;
}

// Configuration this adapter reads from conf.json. The adapter puts these keys into the configuration table itself; the facade merges only the selected backend's keys.
var conf = {};

exports.confSchema = {
    sqliteJournalMode: {
        group: '저장소',
        type: 'enum', dflt: 'WAL', valid: ['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF'],
        apply: 'restart',
        label: 'SQLite 저널 모드',
        help: '기본값인 rollback journal(DELETE)은 쓰는 동안 읽는 쪽을 전부 막는다. ' +
              '워커를 코어 수만큼 포크하므로 한 파일을 여러 프로세스가 연다. ' +
              'WAL 이면 읽기와 쓰기가 서로를 막지 않는다. ' +
              '**DB 파일에 영속되므로 이미 만든 파일도 매 기동 다시 건다.**'
    },
    sqliteSynchronous: {
        group: '저장소',
        type: 'enum', dflt: 'FULL', valid: ['FULL', 'NORMAL', 'OFF', 'EXTRA'],
        apply: 'restart',
        label: 'SQLite 디스크 동기화',
        help: 'MySQL 의 innodb_flush_log_at_trx_commit 에 해당한다. FULL 은 그것을 ' +
              '1 로 둔 것과 같은 판단이다 — 이 코드에는 커밋 유실을 흡수할 장치가 없다. ' +
              'WAL + NORMAL 은 응용 프로그램 충돌에는 안전하지만 전원 장애에서 꼬리를 잃는다.'
    },
    sqliteBusyTimeoutMs: {
        group: '저장소',
        type: 'number', integer: true, dflt: 50000,
        valid: function (v) { return v >= 0 && v <= 600000; },
        validHint: '0 ~ 600000 (ms)',
        apply: 'restart',
        label: 'SQLite 잠금 대기 한도(ms)',
        help: '다른 프로세스가 쓰는 중이면 얼마나 기다릴 것인가. ' +
              'MySQL 의 커넥션 대기에 해당한다.'
    }
};

// Receives the conf handed over by the core. Which keys are read is decided here.
exports.applyConf = function (c) {
    conf = c || {};
};

// Default WAL. Several processes open one file in this deployment.
function journal_mode() {
    return pick_mode(conf.sqliteJournalMode, JOURNAL_MODES, 'WAL');
}

// Default FULL, the same judgement as innodb_flush_log_at_trx_commit = 1 on the MySQL side: nothing here absorbs a lost commit. WAL + NORMAL survives an application crash but loses the tail on power failure.
function synchronous() {
    return pick_mode(conf.sqliteSynchronous, SYNC_MODES, 'FULL');
}

// How long to wait while the file is locked; the counterpart of MySQL's connection wait.
function busy_timeout_ms() {
    var v = conf.sqliteBusyTimeoutMs;
    return (typeof v === 'number' && v >= 0) ? v : 50000;
}

// Takes no coordinates; the module-level conf filled by applyConf is the only configuration source.
exports.connect = function (callback) {
    // The driver is loaded here, so a load failure occurs only when this backend is selected. The original message is logged so the cause (a native addon not built for this machine) is visible.
    try {
        load_driver();
    } catch (e) {
        console.error('[db/sqlite] sqlite3 를 못 불러왔다: ' + ((e && e.message) || e));
        console.error('    네이티브 애드온이 이 장비에 빌드돼 있는지 확인할 것' +
                      ' (npm rebuild sqlite3)');
        callback('0');
        return;
    }

    db = new sqlite3.Database(DB_PATH, function (err) {
        if (err) {
            console.error('[db/sqlite] ' + err.message);
            callback('0');
            return;
        }
        console.log('[db/sqlite] connected');

        // SQLite settings corresponding to the MySQL tuning values:
        //
        //   MySQL                             SQLite
        //   innodb_flush_log_at_trx_commit    PRAGMA synchronous
        //   sync_binlog                       (none: no binlog)
        //   transaction_isolation             (none: always serialised)
        //   max_connections / pool size       busyTimeout (one handle)
        //
        // journal_mode has no MySQL counterpart but matters most here: the default rollback journal blocks every reader while a writer runs, and app.js forks one worker per core, all opening the same file. WAL lets readers and writers proceed. journal_mode is persisted in the file, so it is set at every boot. Every db.run gets a callback: a failed db.run without one emits 'error' on the Database, which is an uncaught exception without a listener. A failed journal_mode switch (another connection holds a transaction) is logged and retried at the next boot.
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
            var schema = fs.readFileSync(exports.schemaPath, 'utf8');
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

// No pool, so nothing to release.
exports.release = function () { };

// Whether the statement returns rows. sqlite3 needs the caller to choose db.all (rows) or db.run (change counts); the wrong choice returns the wrong shape without an error.
function isRowReturning(sql) {
    var s = String(sql);

    // strip leading whitespace and comments
    var prev;
    do {
        prev = s;
        s = s.replace(/^\s+/, '')
             .replace(/^--[^\n]*\n?/, '')
             .replace(/^\/\*[\s\S]*?\*\//, '');
    } while (s !== prev);

    if (/^(select|with|pragma|explain|values)\b/i.test(s)) { return true; }

    // String literals are removed before the RETURNING check so data such as values ('returning home') is not misclassified as a read.
    var withoutLiterals = s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    if (/\breturning\b/i.test(withoutLiterals)) { return true; }
    return false;
}

exports.execute = function (handle, sql, bindings, callback) {
    // This adapter ignores the handle argument and uses the module-owned db handle only (there is no pool; one handle per worker).

    // A null db (connection failed) must be caught here; otherwise the TypeError would escape the facade's try and kill the worker.
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

    // node-sqlite3 5.1.7 does not expose extended codes (SQLITE_CONSTRAINT_*); err.code stops at 'SQLITE_CONSTRAINT'. The message regexes do the actual classification; the extended-code branches are kept for newer drivers.
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

    // Hint for substring comparison: "UNIQUE constraint failed: ae.aei" -> "aei"
    var constraint = null;
    var m = /constraint failed:\s*([^\s,]+)/i.exec(msg);
    if (m) { constraint = m[1].replace(/^.*\./, ''); }

    err.driverCode = driverCode;
    err.code = code;
    err.constraint = constraint;
    return err;
};

// capabilities.transaction is false, so the facade never calls these. They exist to complete the contract and report an error if called by mistake.
function unsupported(handle, callback) {
    callback(new Error('[db/sqlite] transactions are not supported on this backend'));
}
exports.begin = unsupported;
exports.commit = unsupported;
exports.rollback = unsupported;

// Closes the handle. Production code never calls it; it exists so the adapter surface matches mysql (test/db-adapter-contract) and tests can end the process. A connect() after end() reopens.
exports.end = function (callback) {
    var h = db; db = null;
    if (!h || typeof h.close !== 'function') { return callback && callback(null); }
    h.close(function (err) { if (callback) { callback(err || null); } });
};
