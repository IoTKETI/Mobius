'use strict';
// Applies at start-up only the migrations that finish immediately (autoApply), records them in schema_migrations, and reports the rest in the log. This covers what a schema file cannot express: MySQL server settings. Long-running migrations are never run here.

var migrate = require('../tools/migrate');
var db = require('./db');
var db_errors = require('./db/errors');
var pool_sizing = require('./pool_sizing');

// Checks that max_connections covers the application's demand and raises it when it does not. It only raises; a value an operator set above the floor is left alone. Runs at every boot because a lost SET PERSIST (restore, RESET PERSIST) is not caught by the one-time migration record.
function ensure_connection_ceiling(ctx, cb) {
    // The core only knows the number it needs; which statements to run is the adapter's business.
    var floor = pool_sizing.currentFloor();

    db.ensureConnectionCeiling(floor, ctx.conn, function (err, res) {
        if (err) {
            console.error('[db_bootstrap] 동시 접속 상한을 올리지 못했다: ' +
                db_errors.text(res));
            console.error('    서버 설정을 바꿀 권한이 있는지 확인할 것');
            return cb(null);
        }
        if (res && res.applied) {
            console.log('[db_bootstrap] 동시 접속 상한 ' + res.before + ' -> ' + res.after +
                        ' (풀 ' + (global.use_db_connection_limit || 25) +
                        ' x 프로세스 ' + pool_sizing.processCount() + ' = 필요 ' + floor + ')');
        }
        cb(null);
    });
}

// Sets the data-state switches from the migration record. This is not a backend branch: it describes what state the data is in, which the core must know. Read once at boot. Workers call readDataSwitches (below) because run() is primary-only while discovery runs in workers. An unreadable record leaves the switches false, which selects the slower but correct path.
function set_data_switches(applied) {
    var has = function (id) { return applied.indexOf(id) >= 0; };

    // Whether lookup.cs / lookup.cnf are filled for every row. Migration 012 is recorded only when no CIN row is left unfilled, so its presence means discovery may trust those two columns; without it discovery joins cin.
    global.lookup_has_cin_attrs = has('012-lookup-cin-attrs-filled');

    if (global.lookup_has_cin_attrs) {
        console.log('[db_bootstrap] lookup.cs / cnf 백필 완료 — discovery 가 조인 없이 거른다');
    }
}

// Reads only the data-state switches; called by workers. A single select, safe to run concurrently. Never blocks the boot: a failed read leaves the switches false.
exports.readDataSwitches = function (callback) {
    var done = function () { if (callback) { callback(null); } };

    db.getConnection(function (code, connection) {
        if (code !== '200' || !connection) { return done(); }

        var ctx = { db: db, conn: connection, backend: db.backendName() };
        migrate.ensureTable(ctx, function (terr) {
            if (terr) { db.release(connection); return done(); }
            migrate.appliedIds(ctx, function (aerr, applied) {
                if (!aerr) { set_data_switches(applied || []); }
                db.release(connection);
                done();
            });
        });
    });
};

// Primary only. Concurrent workers applying the same migration would collide on the schema_migrations primary key.
exports.run = function (callback) {
    var all;
    try {
        all = migrate.loadMigrations();
    }
    catch (e) {
        console.error('[db_bootstrap] 마이그레이션을 읽지 못했다: ' + ((e && e.message) || e));
        return callback(null);   // never block the boot
    }

    db.getConnection(function (code, connection) {
        if (code !== '200' || !connection) {
            // No connection: skip. A DB connection failure is handled by app.js.
            console.error('[db_bootstrap] 커넥션을 못 얻어 건너뛴다');
            return callback(null);
        }

        // backend is the name the facade actually picked; migrate.pending() matches it against each migration's backends list.
        var ctx = { db: db, conn: connection, backend: db.backendName() };

        // Always finish through the ceiling check, whatever happened to the migrations, so a lost server setting is repaired even when nothing is pending.
        function finish(err) {
            if (err) {
                console.error('[db_bootstrap] ' + ((err && err.message) || err));
            }
            ensure_connection_ceiling(ctx, function () {
                db.release(connection);
                callback(null);   // the boot continues in every case
            });
        }

        migrate.ensureTable(ctx, function (terr) {
            if (terr) { return finish(terr); }

            migrate.appliedIds(ctx, function (aerr, applied) {
                if (aerr) { return finish(aerr); }

                set_data_switches(applied || []);

                var pending = migrate.pending(all, applied || [], ctx.backend);
                if (pending.length === 0) { return finish(null); }

                var auto = pending.filter(function (m) { return m.autoApply === true; });
                var manual = pending.filter(function (m) { return m.autoApply !== true; });

                if (manual.length > 0) {
                    // These may take long; they are never run automatically.
                    console.log('[db_bootstrap] 적용되지 않은 마이그레이션 ' +
                                manual.length + '개 — 자동 적용 대상이 아니다:');
                    manual.forEach(function (m) { console.log('    ' + m.id); });
                    console.log('    적용하려면: node tools/migrate.js --apply ' + ctx.backend);
                }

                if (auto.length === 0) { return finish(null); }

                console.log('[db_bootstrap] 즉시 끝나는 마이그레이션 ' +
                            auto.length + '개를 적용한다');
                migrate.apply(ctx, auto, finish);
            });
        });
    });
};
