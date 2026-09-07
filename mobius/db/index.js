'use strict';
// DB facade: the only place that knows which backend is in use.
//
// knex is used as a builder only: qb.toSQL().toNative() gives {sql, bindings} and the adapter executes it with its own driver. knex's execution, pooling and migrations are not used.
//
// Callback contract:
//   success  cb(null, rows[])  or  cb(null, {affectedRows, insertId})
//   failure  cb(true, err)      (first argument true, second the error)

var knexFactory = require('knex');

// Lease ledger for connections that are not released; acquisition goes through this facade, so the ledger lives here too.
var lease = require('../lease');

// Adapters are the files in this directory: mobius/db/<name>.js. A new backend is registered by adding a file; test/db-adapter-contract.test.js lists what it must provide. index.js and errors.js are not adapters.
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

// Default backend when global.usedb is missing or unknown.
var DEFAULT_BACKEND = 'mysql';

function pick() {
    // The selector is a name, global.usedb, set from conf.json's db key (or the command-line argument). An unknown name falls back to the default with a log line so a typo does not block the boot.
    var name = global.usedb || DEFAULT_BACKEND;
    if (ADAPTERS[name]) { return ADAPTERS[name]; }

    console.error('[db] 모르는 백엔드 "' + name + '" — ' + DEFAULT_BACKEND +
                  ' 로 간다. 쓸 수 있는 것: ' + Object.keys(ADAPTERS).join(', '));
    return ADAPTERS[DEFAULT_BACKEND];
}

// Backend names this facade knows; used by tools and tests.
exports.backends = function () {
    return Object.keys(ADAPTERS).sort();
};

// knex is a pure SQL generator: knexFactory() opens no connection and only needs the dialect name, which pick() decides. So the builder can exist before connect(), and k()/raw() never throw synchronously (a throw there would bypass run()'s try and kill the worker).
function builder() {
    if (!knexInstance) {
        adapter = adapter || pick();
        knexInstance = knexFactory({ client: adapter.knexClient, useNullAsDefault: true });
    }
    return knexInstance;
}

// Used only where a real connection is required. builder() may already have filled adapter, so the connect() call itself is recorded.
function assertReady() {
    if (!connectCalled) {
        throw new Error('[db] connect() has not been called');
    }
}

// Connects. Takes no coordinates: host, port, user and password belong to the adapter, either as its constants or from the conf given by applyConf, so applyConf must run before connect (test/db-conf-wiring.test.js).
exports.connect = function (callback) {
    // A leftover five-argument call would pass a string as the callback; give the error a name here.
    if (typeof callback !== 'function') {
        throw new Error('[db] connect(callback) — 인자는 콜백 하나다');
    }

    adapter = pick();
    knexInstance = null;   // the backend may have changed; rebuild the builder
    builder();
    connectCalled = true;

    if (!adapter.capabilities.transaction) {
        console.log('[db] backend "' + adapter.name + '" does not support transactions; ' +
                    'db.transaction() runs the body without one');
    }

    adapter.connect(callback);
};

// Acquires a connection and wraps it in the lease ledger.
//
// The try covers only the acquisition itself. adapter.getConnection may call back synchronously (SQLite), which would put the whole request chain inside this try; an exception raised after entering the callback is re-thrown, not swallowed, because a swallowed exception would leave the request hanging without a response or a release.
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
            // The ledger only observes: release is wrapped to remove the entry and then calls the original release. A handle without release (the SQLite singleton) is skipped by lease.
            callback('200', lease.track(connection));
        });
    } catch (e) {
        if (entered) { throw e; }   // an exception from the request chain; must not be swallowed
        console.error('[db.getConnection] ' + ((e && e.message) || e));
        callback('500-5');
    }
};

exports.release = function (handle) {
    assertReady();
    adapter.release(handle);
};

// Builder entry point; sql_action.js builds queries as db.k('table')... assertReady() is not called here (see builder()); run() checks the connection.
exports.k = function (table) {
    return builder()(table);
};

exports.raw = function (sql, bindings) {
    var kx = builder();
    return bindings === undefined ? kx.raw(sql) : kx.raw(sql, bindings);
};

// opts is optional; only { timeoutMs } is used. 0 disables the driver timeout, for statements that take minutes such as schema migrations (see execute in mobius/db/mysql.js).
exports.run = function (qb, conn, callback, opts) {
    var native;
    try {
        assertReady();
        native = qb.toSQL().toNative();
    } catch (e) {
        // adapter may be null (before connect() and before any k()).
        return callback(true, adapter ? adapter.normalizeError(e)
                                      : { code: 'UNKNOWN', message: e.message });
    }

    adapter.execute(conn, native.sql, native.bindings, function (err, raw) {
        if (err) { return callback(true, adapter.normalizeError(err)); }
        callback(null, adapter.normalizeResult(raw));
    }, opts);
};

// Transitional entry point: sends an already complete SQL string to the adapter without knex. raw() would interpret '?' in the string as a binding placeholder, and other dialects rewrite '?' into their own placeholder, which would corrupt question marks inside data. New code uses k() / run(); the only caller is db_action.getResult.
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

// Runs a transaction body. On a backend without transactions the body runs without one (connect() logged a warning).
//
// Callback contract as elsewhere in this layer: success cb(null, result), failure cb(true, err). The body calls finish(err, result) with two arguments so the error object is preserved; finish settles once no matter how often it is called.
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

    // An exception thrown by the body after it already settled has nowhere to go; it is logged instead of swallowed silently.
    function reportLate(e) {
        console.error('[db] transaction body threw after settling: ' + ((e && e.message) || e));
    }

    if (!capable) {
        // The user callback is called outside the try. When the body settles synchronously, an exception thrown by the user's callback must not be caught here as if it were the body's; the result is kept in pending and delivered after the try.
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
            // The body threw after settling; the exception is logged and the settled result is still delivered below.
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
                // After a failed commit the connection must still be returned in a clean state.
                adapter.rollback(conn, function (rbErr) {
                    if (rbErr) { console.error('[db] rollback after failed commit also failed: ' + ((rbErr.message) || rbErr)); }
                    settle(true, adapter.normalizeError(commitErr));
                });
            });
            return true;
        }

        // A synchronous throw from the body would otherwise leave the connection in the pool with an open transaction, so the next request would run inside it.
        try {
            body(conn, finish);
        } catch (e) {
            if (!finish(true, adapter.normalizeError(e))) { reportLate(e); }
        }
    });
};

// capabilities is static adapter data: no connection is needed and pick() alone decides the adapter, so this answers correctly before connect(). Neither assertReady() nor builder() is called because both can throw, and this runs in a synchronous gate on every request (check_db_support in resource.js).
//
// Resource types this backend accepts; null means unrestricted. An adapter that declares no supportedResourceTypes is unrestricted (fail-open), because the gate in resource.js answers 501.
exports.supportedResourceTypes = function () {
    adapter = adapter || pick();
    var list = adapter.supportedResourceTypes;
    return Array.isArray(list) ? list : null;
};

// Contract: never throws.
//
// Not for new code: branching the core on a capability is the core knowing the backend. Add a facade function that does the job and let the adapter implement it (lockRow, ensureConnectionCeiling below). Kept for tests and diagnostics.
exports.can = function (name) {
    adapter = adapter || pick();
    return adapter.capabilities[name] === true;
};

// Locks the row(s) read by qb against other transactions; on a backend without row locks the builder is returned unchanged. The intent (this read is meant to be locked) stays visible at the call site; the method is the adapter's.
exports.lockRow = function (qb) {
    adapter = adapter || pick();
    return adapter.capabilities.rowLock === true ? qb.forUpdate() : qb;
};

// Makes the server accept at least floor concurrent connections. Only raises; a no-op on backends without the concept. The core computes the number (mobius/pool_sizing.js); the adapter decides the statement.
exports.ensureConnectionCeiling = function (floor, conn, callback) {
    try {
        assertReady();
    } catch (e) {
        return callback(true, adapter ? adapter.normalizeError(e)
                                      : { code: 'UNKNOWN', message: e.message });
    }
    adapter.ensureConnectionCeiling(floor, conn, callback);
};

// Returns the hint that limits one statement's execution time; null on a backend without it. Callers pass it to knex's .hintComment() and skip it when null.
//
//   var hint = db.statementTimeoutHint(5000);
//   var qb = db.k('cin').count('* as n');
//   if (hint) { qb = qb.hintComment(hint); }
//
// Different from run()'s opts.timeoutMs: that one is the driver giving up and killing the connection, which fails every following query.
exports.statementTimeoutHint = function (ms) {
    assertReady();
    if (!adapter.capabilities.statementTimeout) { return null; }
    return adapter.statementTimeoutHint(ms);
};

// The hint block to place after SELECT; empty string when there is nothing to add.
//
//   var lead = 'select ' + db.optimizerHints([
//       db.statementTimeoutHint(30000),
//       db.noHashJoinHint(['l', 's'])
//   ]);
//
// Callers neither filter nulls nor wrap in /*+ */; both are dialect and live in the adapter.
exports.optimizerHints = function (hints) {
    builder();
    return adapter.optimizerHintBlock(hints);
};

// Applies a server-side time limit to this one query; on a backend without the capability the builder is returned unchanged. Unlike the driver timeout (run's opts.timeoutMs), only this statement is aborted.
exports.withStatementTimeout = function (qb, ms) {
    builder();
    if (!adapter.capabilities.statementTimeout) { return qb; }
    var hint = adapter.statementTimeoutHint(ms);
    return hint ? qb.hintComment(hint) : qb;
};

// Collation fragment for comparing resource paths (pi/ri); empty when not needed.
//
//   var C = db.pathCollate();
//   'join skel s on l.pi = s.sk_ri' + C
exports.pathCollate = function () {
    builder();   // fills adapter (the dialect is known before connect())
    return adapter.pathCollate ? adapter.pathCollate() : '';
};

// Configuration keys the selected backend reads from conf.json. The configuration table (mobius/conf_schema.js) merges them, so the core does not know which backend uses which key. Only the selected backend's keys are returned.
exports.confSchema = function () {
    adapter = adapter || pick();
    return adapter.confSchema || {};
};

// Hands the conf read by the core to the adapter; the adapter decides which keys it reads.
exports.applyConf = function (conf) {
    adapter = adapter || pick();
    if (adapter.applyConf) { adapter.applyConf(conf); }
};

// Absolute path of the selected backend's schema file. The file lives next to the adapter (mobius/db/). Only the SQLite adapter reads it at boot; the MySQL file is imported by hand and the path serves tests and tools.
exports.schemaPath = function () {
    adapter = adapter || pick();
    return adapter.schemaPath;
};

// Collation fragment for the ri column itself, the counterpart of pathCollate: used when joining the skeleton's sk_ri with another table's ri.
exports.riCollate = function () {
    builder();
    return adapter.riCollate ? adapter.riCollate() : '';
};

// Fragment that forces an index on the optimizer; empty on backends without it. The name is the MySQL index name.
exports.indexHint = function (name) {
    builder();
    return adapter.indexHint ? adapter.indexHint(name) : '';
};

// Hint fragment forbidding hash joins between the given aliases; null when absent. Placed with other hints inside /*+ ... */.
exports.noHashJoinHint = function (aliases) {
    builder();
    return adapter.noHashJoinHint ? adapter.noHashJoinHint(aliases) : null;
};

// The predicate 'this row is not a contentInstance (ty=4)' in the form that runs best on the backend; used when the discovery skeleton widens the tree.
//   MySQL   'l.not_cin = 1'   (virtual generated column: a recursive CTE uses indexes for equality only)
//   SQLite  'l.ty <> 4'
exports.notCinPredicate = function (alias) {
    builder();
    return adapter.notCinPredicate ? adapter.notCinPredicate(alias) : (alias + '.ty <> 4');
};

// Index for the predicate above; null when there is none (no hint is added).
exports.notCinIndexName = function () {
    builder();
    return adapter.notCinIndexName ? adapter.notCinIndexName() : null;
};

// Wraps an expression that must compare numerically. cin.cs is int on MySQL and TEXT on SQLite, so a plain comparison differs.
exports.numericExpr = function (expr) {
    builder();
    return adapter.numericExpr ? adapter.numericExpr(expr) : expr;
};

// Name of the selected backend.
//
// Not for branching behaviour; use the facade functions. It is used only where the name itself is data: migration filtering (migrations declare backends: ['mysql']) and diagnostics. Callers must not read global.usedb directly: pick() maps an unknown name to the default, so the two can differ.
exports.backendName = function () {
    adapter = adapter || pick();
    return adapter.name;
};

// Old name; still used by tests.
exports._adapterName = function () {
    return adapter ? adapter.name : null;
};
