'use strict';
// Schema migration runner.
//
//   node tools/migrate.js --check            shows what is pending (read-only)
//   node tools/migrate.js --apply            applies what is pending
//   node tools/migrate.js --apply --only 001-...   applies one
//
// The backend is chosen as in mobius.js:
//   node tools/migrate.js --check sqlite
//   node tools/migrate.js --check mysql
// Without an argument the db key of conf.json is used.
//
// ── Principles ──
// 1. Nothing runs automatically; a person calls it, independent of server boot.
// 2. Applied migrations are recorded in schema_migrations; nothing is guessed.
// 3. --check changes nothing; run it before deploying.
// 4. The facade is used, so both backends run the same way.

var fs = require('fs');
var path = require('path');

var MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// ── Engine (used directly by tests) ──

// Read in file-name order; the numeric prefix is the execution order.
exports.loadMigrations = function (dir) {
    dir = dir || MIGRATIONS_DIR;
    if (!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir)
        .filter(function (f) { return /^\d+.*\.js$/.test(f); })
        .sort()
        .map(function (f) {
            var m = require(path.join(dir, f));
            if (!m.id) { throw new Error(f + ': id 가 없다'); }
            if (typeof m.up !== 'function') { throw new Error(m.id + ': up() 이 없다'); }
            return m;
        });
};

// Those for this backend that are not applied yet.
exports.pending = function (all, appliedIds, backend) {
    return all.filter(function (m) {
        if (appliedIds.indexOf(m.id) !== -1) { return false; }
        if (m.backends && m.backends.indexOf(backend) === -1) { return false; }
        return true;
    });
};

// Ledger table; the same statement works on both backends.
exports.ensureTable = function (ctx, cb) {
    ctx.db.run(ctx.db.raw(
        'CREATE TABLE IF NOT EXISTS schema_migrations (' +
        '  id VARCHAR(160) NOT NULL,' +
        '  applied_at VARCHAR(21) NOT NULL,' +
        '  duration_ms INTEGER,' +
        '  PRIMARY KEY (id)' +
        ')'), ctx.conn, cb);
};

exports.appliedIds = function (ctx, cb) {
    ctx.db.run(ctx.db.k('schema_migrations').select('id').orderBy('id', 'asc'), ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows || []).map(function (r) { return r.id; }));
        });
};

exports.record = function (ctx, id, durationMs, cb) {
    ctx.db.run(ctx.db.k('schema_migrations').insert({
        id: id,
        applied_at: new Date().toISOString().replace(/[-:]/g, '').slice(0, 15),
        duration_ms: durationMs
    }), ctx.conn, cb);
};

// Applies the pending ones in order and stops at the first failure, because a later migration may depend on an earlier one.
exports.apply = function (ctx, list, cb) {
    var done = [];
    (function next(i) {
        if (i >= list.length) { return cb(null, done); }
        var m = list[i];
        var t0 = Date.now();
        process.stdout.write('  ' + m.id + ' ... ');

        m.up(ctx, function (err, res) {
            if (err) {
                console.log('실패');
                console.error('    ' + ((res && (res.driverCode || res.code || res.message)) || res));
                return cb(err, done);
            }
            var ms = Date.now() - t0;
            exports.record(ctx, m.id, ms, function (rerr, rres) {
                if (rerr) {
                    console.log('적용은 됐으나 이력 기록 실패');
                    console.error('    ' + ((rres && (rres.driverCode || rres.code)) || rres));
                    return cb(rerr, done);
                }
                console.log((ms / 1000).toFixed(1) + '초');
                done.push(m.id);
                next(i + 1);
            });
        });
    })(0);
};

// ── CLI ──

function usage() {
    console.error('사용법: node tools/migrate.js --check|--apply [sqlite|mysql] [--only <id>]');
    process.exit(2);
}

function main() {
    var argv = process.argv.slice(2);
    var mode = null;
    var backendArg = null;
    var only = null;

    for (var i = 0; i < argv.length; i++) {
        var a = argv[i];
        if (a === '--check' || a === '--apply') { mode = a.slice(2); }
        else if (a === '--only') { only = argv[++i]; }
        else if (a === 'sqlite' || a === 'mysql') { backendArg = a; }
        else { usage(); }
    }
    if (!mode) { usage(); }

    // The backend is chosen as in mobius.js.
    var conf = {};
    try { conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'conf.json'), 'utf8')); }
    catch (e) { /* defaults when absent */ }

    // The selector is the db key alone; the old usesqlite key is not read (a silent translation would keep two configuration keys alive; mobius.js reports it).
    //
    // In a tool the argument wins over the configuration: a migration is where a person states explicitly which backend to apply to.
    global.usedb = backendArg || conf.db || 'mysql';

    var db = require(path.join(__dirname, '..', 'mobius', 'db'));
    var backend = global.usedb;

    if (db.backends().indexOf(backend) < 0) {
        console.error('모르는 백엔드 "' + backend + '". 쓸 수 있는 것: ' +
                      db.backends().join(', '));
        process.exit(1);
    }

    console.log('백엔드: ' + backend);
    console.log('');

    // applyConf before connect: the adapter reads its coordinates (password included) from conf, so without this line the adapter's conf stays {} and it connects with an empty password. test/db-conf-wiring.test.js keeps this order.
    db.applyConf(conf);
    db.connect(function (rsc) {
        if (rsc !== '1') {
            console.error('DB 연결 실패: ' + rsc);
            process.exit(1);
        }
        db.getConnection(function (code, conn) {
            if (code !== '200') {
                console.error('커넥션 획득 실패: ' + code);
                process.exit(1);
            }
            var ctx = { db: db, conn: conn, backend: backend };
            run(ctx, mode, only, function (failed) {
                try { db.release(conn); } catch (e) { /* ignore if already closed */ }
                process.exit(failed ? 1 : 0);
            });
        });
    });
}

function run(ctx, mode, only, done) {
    exports.ensureTable(ctx, function (err, res) {
        if (err) {
            console.error('schema_migrations 준비 실패: ' +
                ((res && (res.driverCode || res.code)) || res));
            return done(true);
        }

        exports.appliedIds(ctx, function (err2, ids) {
            if (err2) {
                console.error('적용 이력 조회 실패: ' + JSON.stringify(ids));
                return done(true);
            }

            var all;
            try { all = exports.loadMigrations(); }
            catch (e) { console.error('마이그레이션 로드 실패: ' + e.message); return done(true); }

            var list = exports.pending(all, ids, ctx.backend);
            if (only) { list = list.filter(function (m) { return m.id === only; }); }

            console.log('전체 ' + all.length + '개 / 적용됨 ' + ids.length + '개 / 남음 ' + list.length + '개');
            console.log('');

            if (list.length === 0) {
                console.log('적용할 것이 없다.');
                return done(false);
            }

            if (mode === 'check') {
                inspectAll(ctx, list, function () {
                    console.log('');
                    console.log('지금은 아무것도 바꾸지 않았다.');
                    console.log('적용하려면: node tools/migrate.js --apply ' + ctx.backend);
                    done(false);
                });
                return;
            }

            console.log('=== 적용 ===');
            exports.apply(ctx, list, function (aerr, applied) {
                console.log('');
                console.log(applied.length + '개 적용됨' + (aerr ? ' (중단됨)' : ''));
                done(!!aerr);
            });
        });
    });
}

function inspectAll(ctx, list, cb) {
    (function next(i) {
        if (i >= list.length) { return cb(); }
        var m = list[i];
        console.log('  ' + m.id);
        console.log('    ' + m.description);
        if (typeof m.inspect !== 'function') { return next(i + 1); }
        m.inspect(ctx, function (err, note) {
            console.log('    상태: ' + (err ? '점검 실패 — ' + JSON.stringify(note) : note));
            next(i + 1);
        });
    })(0);
}

if (require.main === module) { main(); }
