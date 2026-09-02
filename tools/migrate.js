'use strict';
// 스키마 마이그레이션 러너.
//
//   node tools/migrate.js --check            무엇이 남았는지만 본다 (읽기 전용)
//   node tools/migrate.js --apply            남은 것을 적용한다
//   node tools/migrate.js --apply --only 001-...   하나만 적용한다
//
// 백엔드는 mobius.js 와 같은 방식으로 고른다:
//   node tools/migrate.js --check sqlite
//   node tools/migrate.js --check mysql
// 생략하면 conf.json 의 db 키를 따른다.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// 개발은 한 곳에서 하고 배포는 다른 서버에서 한다. 코드는 덮어쓰면 되지만
// 스키마는 그럴 수 없다. 그런데 이 저장소에는 마이그레이션 수단이 없었다:
//
//   SQLite  기동마다 스키마 재실행(IF NOT EXISTS) — 우연히 되는 것이지 설계가 아니다
//   MySQL   없음. mobiusdb.sql 은 최초 설치용이다
//
// ── 원칙 ────────────────────────────────────────────────────────────────
// 1. 자동 실행하지 않는다. 서버 기동과 무관하게 사람이 명시적으로 부른다.
// 2. 적용 이력을 schema_migrations 에 남긴다. 무엇이 적용됐는지 추측하지 않는다.
// 3. --check 는 아무것도 바꾸지 않는다. 배포 전에 먼저 이걸로 본다.
// 4. 파사드를 쓰므로 두 백엔드 모두 같은 방식으로 돈다.

var fs = require('fs');
var path = require('path');

var MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// ── 엔진 (테스트가 직접 쓴다) ─────────────────────────────────────────────

// 파일명 순으로 정렬해 읽는다. 번호 접두사가 곧 실행 순서다.
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

// 이 백엔드에 해당하고 아직 적용되지 않은 것.
exports.pending = function (all, appliedIds, backend) {
    return all.filter(function (m) {
        if (appliedIds.indexOf(m.id) !== -1) { return false; }
        if (m.backends && m.backends.indexOf(backend) === -1) { return false; }
        return true;
    });
};

// 이력 테이블. 두 백엔드에서 같은 문장이 통한다.
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

// 남은 것을 순서대로 적용한다. 하나라도 실패하면 거기서 멈춘다 —
// 이어지는 마이그레이션이 앞의 것을 전제할 수 있기 때문이다.
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

// ── CLI ──────────────────────────────────────────────────────────────────

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

    // mobius.js 와 같은 방식으로 백엔드를 정한다.
    var conf = {};
    try { conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'conf.json'), 'utf8')); }
    catch (e) { /* 없으면 기본값 */ }

    // 선택자는 db 키 하나다. 옛 usesqlite 는 읽지 않는다 — 조용히 번역해 주면
    // 설정 키가 둘인 상태가 끝나지 않는다. mobius.js 가 그 키를 보면 알려 준다.
    //
    // 도구에서는 인자가 먼저다. 마이그레이션은 "이 백엔드에 적용하겠다" 를
    // 사람이 명시적으로 말하는 자리라, 설정보다 손으로 준 것이 이긴다.
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

    db.connect('localhost', 3306, 'root', conf.dbpass || '', function (rsc) {
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
                try { db.release(conn); } catch (e) { /* 이미 닫혔으면 그만 */ }
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
