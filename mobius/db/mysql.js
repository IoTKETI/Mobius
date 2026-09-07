'use strict';
// MySQL adapter. Executes statements and normalises results and errors. Dialect details (placeholders, identifier quoting, upsert, row locks) are handled by knex.

// Driver: mysql2. Three places absorb driver differences: execute (once + destroy, because a timeout is no longer fatal), and createPool's decimalNumbers (SUM result type) and charset (default connection charset). test/db-mysql2-contract.test.js guards them.
var mysql = require('mysql2');
var once = require('../once');
var path = require('path');

var pool = null;

// Connection coordinates of this backend. Not configuration keys; to make them configurable, add keys to confSchema below.
var HOST = 'localhost';
var PORT = 3306;
var USER = 'root';

// Database name. README's install procedure imports the schema into a database of this name; mobiusdb.sql contains no CREATE DATABASE / USE.
var DATABASE = 'mobiusdb';

// filled by applyConf (same shape as mobius/db/sqlite.js)
var conf = {};

exports.name = 'mysql';
exports.knexClient = 'mysql';

// Schema file of this backend, as an absolute path. MySQL code never reads it; it is imported by hand at install time. The path is exported so tests can ask for it and so every adapter has the same export surface.
exports.schemaPath = path.join(__dirname, 'mobiusdb.sql');

exports.capabilities = {
    // Server tuning is not a capability flag: ensureConnectionCeiling below does the work and the adapter decides the statements.

    transaction: true,
    rowLock: true,         // SELECT ... FOR UPDATE [NOWAIT]

    // Whether the server can cut a single SELECT by time. MySQL does it with the MAX_EXECUTION_TIME hint: only that statement is aborted (ER_QUERY_TIMEOUT, 3024) and the connection stays alive. A driver timeout (execute's opts.timeoutMs) kills the connection instead.
    statementTimeout: true
};

// Resource types this backend restricts: null means no restriction (every body table exists in mobiusdb.sql). null is written explicitly so all adapters have the same export surface; the facade treats undefined as unrestricted too.
exports.supportedResourceTypes = null;

exports.statementTimeoutHint = function (ms) {
    var n = parseInt(ms, 10);
    if (!(n > 0)) { return null; }
    return 'MAX_EXECUTION_TIME(' + n + ')';
};

// Joins hint fragments into one block placed after SELECT; empty string when there is nothing to add. The /*+ */ wrapping is dialect and lives here. A trailing space is included because callers concatenate 'select ' + block + rest. Never throws, even for a non-array, because it runs while a query is being built.
exports.optimizerHintBlock = function (hints) {
    var live = Array.isArray(hints) ? hints.filter(Boolean) : [];
    return live.length ? '/*+ ' + live.join(' ') + ' */ ' : '';
};

// Configuration this adapter reads from conf.json as its own. dbpass lives here because a password is a connection coordinate and connection coordinates belong to the backend. Pool size (dbConnectionLimit) and queue (dbQueueLimit) remain core keys because pool_sizing needs them.
exports.confSchema = {
    dbpass: {
        group: '저장소',
        tier: 'user',
        type: 'string', dflt: '', secret: true, exposed: false, apply: 'restart',
        label: 'DB 비밀번호',
        help: '값을 화면으로 내보내지 않는다. 길이도 주지 않는다.'
    },
    // Database name; default mobiusdb. The MySQL test lane (test/mysql/, npm run test:mysql) uses mobiusdb_test on the same server.
    dbName: {
        group: '저장소',
        type: 'string', dflt: 'mobiusdb', apply: 'restart',
        label: 'DB 이름',
        help: '접속할 데이터베이스 이름. 시험 레인은 mobiusdb_test 를 쓴다.'
    }
};

// Receives the conf read by the core. Which keys are read is decided here.
exports.applyConf = function (c) {
    conf = c || {};
};

// Collation fragments for ri (riCollate) and path comparisons (pathCollate). Both are empty: the id and name columns share utf8mb3_bin (migration 018), so no cast is needed, and a cast on the skeleton column would prevent the (pi, not_cin) index from being used in the recursive CTE. test/discovery-cte.test.js checks that no cast is present.
exports.riCollate = function () {
    return '';
};

exports.pathCollate = function () {
    return '';
};

// Forces an index on the optimizer. The PRIMARY KEY is (pi, ri, ty), so with filters on columns outside lookup (lbl etc.) the optimizer may pick the clustered PRIMARY and read every CIN under each parent.
exports.indexHint = function (name) {
    if (!name) { return ''; }
    return ' force index (' + name + ')';
};

// Hint that forbids hash joins between the given aliases (MySQL 8.0.18+). Needed in the recursive CTE, where a hash built per iteration would be rebuilt every time.
exports.noHashJoinHint = function (aliases) {
    if (!aliases || !aliases.length) { return null; }
    return 'NO_HASH_JOIN(' + aliases.join(', ') + ')';
};

// The predicate 'this row is not a contentInstance (ty=4)' in the form the recursive CTE can serve from an index. Inside a recursive CTE MySQL uses ref (equality) access only, so `ty <> 4` would fall back to a filter; lookup has a virtual generated column not_cin = (ty <> 4) that is queried by equality. not_cin is INVISIBLE so it does not appear in `select *` (migrations/004).
exports.notCinPredicate = function (alias) {
    return alias + '.not_cin = 1';
};

// Index for the predicate above; null when there is none.
exports.notCinIndexName = function () {
    return 'idx_lookup_pi_notcin';
};

// Wraps an expression that must compare numerically. cin.cs is int in mobiusdb.sql, so no cast is needed (the SQLite schema declares it TEXT).
exports.numericExpr = function (expr) {
    return expr;
};

// Makes the server accept at least floor concurrent connections. Only raises: a higher value set by an operator is kept. Uses SET PERSIST so the value survives a restart (mysqld-auto.cnf).
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

            // SET PERSIST takes no bindings; floor is an integer computed by the core, and that is checked once more here.
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

exports.connect = function (callback) {
    var limit = (typeof global.use_db_connection_limit === 'number')
        ? global.use_db_connection_limit : 100;
    var queue = (typeof global.use_db_queue_limit === 'number')
        ? global.use_db_queue_limit : 0;

    pool = mysql.createPool({
        host: HOST,
        port: PORT,
        user: USER,
        // The password comes from the conf object handed over by applyConf; undefined and '' mean the same to the driver.
        password: (typeof conf.dbpass === 'string') ? conf.dbpass : '',
        database: (typeof conf.dbName === 'string' && conf.dbName) ? conf.dbName : DATABASE,
        // Pool size and queue limit come from conf.json (mobius/conf_schema.js). queueLimit 0 is unbounded and has no timeout: when the pool is dry, requests wait forever without a response or an error.
        connectionLimit: limit,
        waitForConnections: true,
        debug: false,
        queueLimit: queue,

        // Driver defaults are not relied on.
        //
        // acquireTimeout is not set: mysql2 does not know the option and would warn per connection.
        //
        // decimalNumbers: MySQL returns SUM() of integer columns as NEWDECIMAL, which mysql2 emits as a string by default; with decimalNumbers the value is a Number.
        decimalNumbers: true,

        // charset: the drivers' default connection charsets differ (mysqljs utf8mb3, mysql2 utf8mb4). The schema is utf8mb3 (DEFAULT CHARSET=utf8); a utf8mb4 connection would make a 4-byte character in a discovery filter fail with ER_CANT_AGGREGATE_2COLLATIONS instead of matching nothing. Remove this line when the schema moves to utf8mb4.
        charset: 'UTF8_GENERAL_CI'
    });

    // One log line saying where the pool will connect; the password is not logged. createPool opens no socket, so this says 'will connect', not 'connected'; a real failure surfaces at the first getConnection.
    console.log('[db/mysql] pool ' + USER + '@' + HOST + ':' + PORT + '/' + ((typeof conf.dbName === 'string' && conf.dbName) ? conf.dbName : DATABASE) +
                ' (풀 ' + limit + ', 대기열 ' + queue + ')');

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

// Default timeout for request processing, so one request cannot hold a connection indefinitely.
var DEFAULT_TIMEOUT_MS = 60000;

exports.execute = function (handle, sql, bindings, callback, opts) {
    var q = { sql: sql, values: bindings };

    // opts.timeoutMs === 0 disables the timeout. Schema migrations (ALTER TABLE ADD INDEX) need it: the driver would drop the connection after 60 s while MySQL keeps running the DDL.
    var t = (opts && opts.timeoutMs !== undefined) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    if (t) { q.timeout = t; }

    // The callback runs once. mysql2 does not mark a driver timeout as fatal and does not dequeue the command, so it would call back twice (once on timeout, again when the real answer arrives); a second call would release the connection twice.
    callback = once(callback, 'db/mysql execute');

    handle.query(q, function (err, rows) {
        if (err) {
            // Restore the fatal meaning of a timeout: mysql2 leaves the command queued, so a connection returned to the pool would make the next borrower wait for the previous statement. destroy removes the PoolConnection from the pool; a later release() on it is harmless.
            if (err.code === 'PROTOCOL_SEQUENCE_TIMEOUT' &&
                handle && typeof handle.destroy === 'function') {
                try { handle.destroy(); }
                catch (e) { console.error('[db/mysql] 타임아웃 커넥션 파기 실패: ' + e.message); }
            }
            return callback(err, null);
        }
        callback(null, rows);
    });
};

// SELECT returns the array as is; writes return {affectedRows, insertId}.
exports.normalizeResult = function (raw) {
    if (Array.isArray(raw)) { return raw; }
    return {
        affectedRows: raw && raw.affectedRows !== undefined ? raw.affectedRows : 0,
        insertId: raw ? raw.insertId : undefined
    };
};

exports.normalizeError = function (err) {
    if (!err) { return { code: 'UNKNOWN' }; }

    // The original driver code is preserved in driverCode; overwriting it with the neutral code would hide backend-specific conditions (lock conflicts etc.) from upper layers.
    var driverCode = err.code;

    var code = 'UNKNOWN';
    if (err.code === 'ER_DUP_ENTRY') { code = 'DUPLICATE_KEY'; }
    else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') { code = 'FK_VIOLATION'; }
    else if (err.code === 'ER_BAD_NULL_ERROR') { code = 'NOT_NULL'; }
    else if (err.code === 'ER_LOCK_NOWAIT' || err.errno === 3572) { code = 'LOCK_CONFLICT'; }
    else if (err.code === 'ER_LOCK_DEADLOCK' || err.errno === 1213) { code = 'LOCK_CONFLICT'; }
    else if (err.code === 'ER_LOCK_WAIT_TIMEOUT' || err.errno === 1205) { code = 'LOCK_TIMEOUT'; }

    // The statement hit its time limit (MAX_EXECUTION_TIME hint). The driver's name for it is ER_QUERY_TIMEOUT; errno 3024.
    else if (err.code === 'ER_QUERY_TIMEOUT' || err.errno === 3024) { code = 'STATEMENT_TIMEOUT'; }

    // Missing index: code deployed without running the migration. The driver's constant name contains a typo (EXITS), as in MySQL itself.
    else if (err.code === 'ER_KEY_DOES_NOT_EXITS' || err.errno === 1176 ||
             /Key '[^']*' doesn't exist/i.test(err.sqlMessage || err.message || '')) {
        code = 'MISSING_INDEX';
    }

    // err.constraint is a hint for substring comparison, not equality: MySQL 5.7 gives 'aei_UNIQUE', MySQL 8 'ae.aei_UNIQUE', SQLite 'aei'; the table prefix is stripped. Not set for a missing index, whose message also matches the regex.
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

// Closes the pool. Production code never calls it; the MySQL test lane (test/mysql/) uses it so the test process can exit.
exports.end = function (callback) {
    var p = pool; pool = null;
    if (!p) { return callback && callback(null); }
    p.end(function (err) { if (callback) { callback(err || null); } });
};
