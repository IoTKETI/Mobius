'use strict';
// Safety rules for migrations applied automatically at startup.
//
// A fresh install must come up in the same state as the deployment. The schema is covered by mobiusdb.sql (test/schema-drift.test.js) and SQLite applies its PRAGMAs on every connect; what remains is MySQL server configuration, which is applied at startup.
//
// The one risk is a slow migration entering the startup path.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MIG = path.join(ROOT, 'migrations');

function migrations() {
    return fs.readdirSync(MIG)
        .filter((f) => /^\d+.*\.js$/.test(f))
        .sort()
        .map((f) => ({ file: f, mod: require(path.join(MIG, f)) }));
}

test('자동 적용 대상은 명시적으로 밝힌 것뿐이다', function () {
    // The default must be manual. Only migrations that explicitly opt in are automatic.
    const auto = migrations().filter((m) => m.mod.autoApply === true);
    const names = auto.map((m) => m.mod.id);

    // 011 is an ALTER but uses ALGORITHM=INSTANT, so it finishes immediately regardless of row count (metadata only, MySQL 8.0.12+). Backfills such as 012 must not be here.
    assert.deepStrictEqual(names, ['010-server-durability', '011-lookup-cin-attrs'],
        '자동 적용 목록이 바뀌었다: ' + names.join(', ') +
        '\n새로 추가하려면 그 마이그레이션이 **데이터 양과 무관하게 즉시** ' +
        '끝나는지 확인할 것. 001 은 배포에서 20.6분 걸렸다.');
});

test('DDL 을 내는 마이그레이션에는 autoApply 가 없다', function () {
    // Index creation/removal and table changes scale with data volume and must stay out of the startup path. Server-setting statements such as SET PERSIST are the exception.
    //
    // A second exception is an ALTER with ALGORITHM=INSTANT: it changes metadata only and finishes immediately. The exception is opened narrowly: algorithm=instant must appear in the same statement, so the server refuses instead of silently falling back to INPLACE/COPY.
    const DDL = /\b(create\s+(table|index)|alter\s+table|drop\s+(table|index))\b/i;
    const INSTANT = /algorithm\s*=\s*instant/i;

    for (const { file, mod } of migrations()) {
        if (mod.autoApply !== true) { continue; }
        const src = fs.readFileSync(path.join(MIG, file), 'utf8');
        // Comments are excluded; they quote DDL while explaining it.
        const code = src.split('\n')
            .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
            .join('\n');

        if (!DDL.test(code)) { continue; }

        // If DDL is present it must be ALTER only. CREATE and DROP have no exception.
        const heavy = /\b(create\s+(table|index)|drop\s+(table|index))\b/i;
        assert.ok(!heavy.test(code),
            file + ' 이 autoApply 인데 테이블·인덱스를 만들거나 지운다 —' +
            ' 데이터가 쌓이면 기동이 멈춘다 (001 은 배포에서 20.6분 걸렸다)');

        // Runs up() against a fake ctx and inspects the SQL that is actually emitted, rather than pattern-matching the source (an error-message string once satisfied the regex).
        const sqls = [];
        const ctx = {
            conn: {},
            db: {
                raw: (s) => s,
                run: (s, conn, cb) => {
                    sqls.push(String(s));
                    // Answers information_schema lookups with 'column missing' so up() proceeds to the real ALTER.
                    if (/information_schema/i.test(String(s))) { return cb(null, []); }
                    cb(null, { affectedRows: 1 });
                }
            }
        };
        mod.up(ctx, function () {});

        const alters = sqls.filter((s) => /\balter\s+table\b/i.test(s));
        assert.ok(alters.length > 0,
            file + ' 이 ALTER 를 낸다고 했는데 up() 에서 안 나왔다');
        for (const a of alters) {
            assert.ok(INSTANT.test(a),
                file + ' 의 ALTER 에 algorithm=instant 가 없다:\n  ' + a + '\n' +
                '명시하지 않으면 서버가 조용히 INPLACE/COPY 로 떨어져' +
                ' 6,190만 행 테이블을 통째로 다시 쓴다.');
        }
    }
});

test('db_bootstrap 은 autoApply 가 아닌 것을 절대 적용하지 않는다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // The filter must exist and must compare with === true; a truthy check would accept autoApply: 'later'.
    assert.match(code, /autoApply\s*===\s*true/,
        'autoApply 를 === true 로 거르지 않는다');

    // The unfiltered list must not be passed to apply.
    assert.ok(!/migrate\.apply\(\s*ctx\s*,\s*pending\b/.test(code),
        'pending 전체를 apply 에 넘긴다 — 느린 것까지 기동 시 돈다');
    assert.match(code, /migrate\.apply\(\s*ctx\s*,\s*auto\b/,
        '걸러낸 목록(auto)을 넘기지 않는다');
});

test('기동을 막지 않는다 — 실패해도 콜백은 불린다', function () {
    // The DB may not be up yet or permissions may be missing. Every failure path must end in callback(null) so startup is not blocked.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // Every callback invocation passes null (errors are not propagated).
    const calls = code.match(/callback\([^)]*\)/g) || [];
    assert.ok(calls.length >= 3, 'callback 호출이 너무 적다 — 경로를 빠뜨렸나');
    for (const c of calls) {
        assert.match(c, /callback\(null\)/,
            '기동을 막는 콜백이 있다: ' + c + ' — 실패해도 null 로 넘겨야 한다');
    }
});

test('010 은 SET PERSIST 만 하고 값이 배포와 같다', function () {
    const m = require(path.join(MIG, '010-server-durability.js'));
    assert.strictEqual(m.autoApply, true);
    assert.deepStrictEqual(m.backends, ['mysql'],
        'SET PERSIST 는 MySQL 전용이다 — SQLite 에 나가면 구문 오류다');

    const src = fs.readFileSync(path.join(MIG, '010-server-durability.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // Must match the values applied to the deployment so a fresh install does not diverge.
    assert.match(code, /innodb_flush_log_at_trx_commit:\s*'1'/);
    assert.match(code, /transaction_isolation:\s*'REPEATABLE-READ'/);

    // sync_binlog is left untouched.
    assert.ok(!/SET PERSIST sync_binlog/i.test(code),
        'sync_binlog 를 건드린다 — 유지하기로 한 값이다');
});

test('접속 상한의 주인은 기동 검사 하나뿐이다', function () {
    // Only one owner sets max_connections. 010 runs once and is recorded, so it cannot repair a lost setting; the startup check owns it.
    const src = fs.readFileSync(path.join(MIG, '010-server-durability.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // 010 may read the value (inspect shows the state) but must not set it; a WANT entry would make up() emit SET PERSIST.
    assert.ok(!/max_connections\s*:/.test(code),
        '010 의 WANT 에 max_connections 가 다시 들어갔다 — 주인이 둘이 됐다');

    const m = require(path.join(MIG, '010-server-durability.js'));
    assert.ok(Object.keys(m._WANT || {}).indexOf('max_connections') < 0,
        '010 이 max_connections 를 건다 — 기동 검사와 어느 쪽이 이겼는지 알 수 없다');

    const boot = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    assert.match(boot, /ensureConnectionCeiling/,
        '기동 검사가 접속 상한을 다루지 않는다');
});

test('코어는 접속 상한을 거는 SQL 을 모른다', function () {
    // The core must not build MySQL statements itself. The adapter owns them.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.ok(!/SET PERSIST|SET GLOBAL|@@global|information_schema|performance_schema/i.test(code),
        '코어가 서버 설정 SQL 을 직접 만든다 — 그 문장은 어댑터가 갖는다');
    assert.ok(!/can\(\s*['"]serverTuning['"]\s*\)/.test(code),
        "can('serverTuning') 이 되살아났다 — 불리언은 '어떻게' 를 말하지 못한다");

    // The core only does arithmetic: it computes the required number and hands it over.
    assert.match(code, /pool_sizing\.currentFloor\(\)/,
        'pool_sizing 으로 필요한 수를 계산하지 않는다');
    assert.match(code, /db\.ensureConnectionCeiling\(\s*floor/,
        '계산한 수를 어댑터에 넘기지 않는다');
});

test('올리기만 하는 규칙은 어댑터가 지킨다', function () {
    // Lowering the ceiling would disconnect other clients using that headroom. Values an operator set above the floor (admin UI, my.cnf) stay as they are. The rule lives in the adapter because how to read and raise the value differs per backend.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db', 'mysql.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.match(code, /now\s*>=\s*floor/,
        '지금 값과 필요한 수를 견주지 않는다 — 무조건 덮어쓰면 옛 set_tuning 과 같다');

    // The adapter uses only the value the core passed in; a local constant would diverge from what the screen shows.
    assert.ok(!/max_connections\s*=\s*'?\d/.test(code),
        '어댑터가 상수를 적는다 — 코어가 넘긴 floor 만 써야 한다');
});

test('기동 검사는 백엔드를 구분하지 않는다 — 이름으로도 능력으로도', function () {
    // The core does not ask which backend it is talking to. It always calls the adapter, and a backend without the concept answers as a no-op.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.ok(!/backend\s*[!=]==?\s*['"]/.test(code),
        '백엔드 이름을 문자열과 견준다 — 코어는 어느 DB 인지 몰라야 한다');
    assert.ok(!/\.can\(/.test(code),
        '능력을 물어 갈라진다 — 어댑터에 시키고 결과만 받아라');

    // The one place a backend name is still used is migration filtering, where the name is data. It must come from the facade's pick(), not from global.usedb directly.
    assert.ok(!/global\.usedb/.test(code),
        'global.usedb 를 직접 읽는다 — pick() 과 규칙이 다른 두 번째 기본값이 생긴다');
    assert.match(code, /db\.backendName\(\)/,
        '파사드가 고른 백엔드 이름을 받지 않는다');
});

test('상한 개념이 없는 백엔드에서도 기동은 그대로 끝난다', function (t, done) {
    // The core always calls ensureConnectionCeiling; an adapter that answers applied:false ends the matter.
    runBootstrap({ now: 10, pending: [], ceilingUnsupported: true }, function (ran) {
        assert.ok(ran.some((s) => /ensureConnectionCeiling/.test(s)),
            '어댑터에 물어보지도 않았다 — 구분은 어댑터가 한다');
        done();
    });
});

test('어댑터가 실패해도 기동은 계속한다', function (t, done) {
    // Some installations lack permission to change server settings. The failure is logged and startup continues.
    let finished = false;
    runBootstrap({ now: 10, pending: [], ceilingError: true }, function () {
        finished = true;
        assert.ok(finished, '어댑터 실패에 기동이 막혔다');
        done();
    });
});

test('바닥은 풀 크기와 프로세스 수에서 계산된다', function () {
    const ps = require(path.join(ROOT, 'mobius', 'pool_sizing.js'));

    // Pool 25 x processes 25 = 625, x1.2 = 750, rounded up to the next 100 = 800.
    assert.strictEqual(ps.appDemand(25, 25), 625);
    assert.strictEqual(ps.floorFor(25, 25), 800);

    // Changing the pool size moves the floor with it.
    assert.strictEqual(ps.floorFor(10, 25), 300);   // 250 -> 300
    assert.strictEqual(ps.floorFor(50, 25), 1500);  // 1500 -> 1500

    // The MySQL default of 151 is below the floor for any realistic setup.
    assert.ok(ps.floorFor(25, 25) > 151);

    // Process count is workers + master. Leaving out the master under-counts by one pool.
    assert.strictEqual(ps.processCount(), require('node:os').cpus().length + 1);
});

// Runs db_bootstrap on a fake facade so the harness sees when the ceiling check runs, not only that it exists in source.
function runBootstrap(opts, done) {
    const ROOTM = require('node:module');
    const dbPath = require.resolve(path.join(ROOT, 'mobius', 'db', 'index.js'));
    const migPath = require.resolve(path.join(ROOT, 'tools', 'migrate.js'));
    const bootPath = require.resolve(path.join(ROOT, 'mobius', 'db_bootstrap.js'));

    const saved = {};
    for (const p of [dbPath, migPath, bootPath]) { saved[p] = require.cache[p]; }

    const ran = [];
    require.cache[dbPath] = new ROOTM.Module(dbPath);
    require.cache[dbPath].loaded = true;
    require.cache[dbPath].exports = {
        getConnection: (cb) => cb('200', { fake: true }),
        release: () => {},
        raw: (sql) => sql,
        backendName: () => opts.backend || 'mysql',

        // The core calls only this function. What SQL to emit is the adapter's job, so it is mocked here; the harness checks the number the core computes and when it calls.
        //
        // opts.ceilingUnsupported mimics a backend without the concept (sqlite).
        ensureConnectionCeiling: (floor, conn, cb) => {
            ran.push('ensureConnectionCeiling(' + floor + ')');
            if (opts.ceilingUnsupported) {
                return cb(null, { applied: false, reason: '상한 개념이 없다' });
            }
            if (opts.ceilingError) { return cb(true, { message: '권한 없음' }); }
            if (opts.now >= floor) {
                return cb(null, { applied: false, before: opts.now, after: opts.now });
            }
            return cb(null, { applied: true, before: opts.now, after: floor });
        },

        run: (sql, conn, cb) => {
            ran.push(String(sql));
            cb(null, []);
        }
    };

    require.cache[migPath] = new ROOTM.Module(migPath);
    require.cache[migPath].loaded = true;
    require.cache[migPath].exports = {
        loadMigrations: () => [],
        ensureTable: (ctx, cb) => cb(null),
        appliedIds: (ctx, cb) => cb(null, []),
        pending: () => opts.pending || [],       // default 0: the state of a deployed server
        apply: (ctx, list, cb) => cb(null)
    };

    delete require.cache[bootPath];
    const boot = require(bootPath);

    const savedLimit = global.use_db_connection_limit;
    const savedDb = global.usedb;
    global.use_db_connection_limit = 25;
    global.usedb = 'mysql';

    boot.run(function () {
        global.use_db_connection_limit = savedLimit;
        global.usedb = savedDb;
        for (const p of [dbPath, migPath, bootPath]) {
            if (saved[p]) { require.cache[p] = saved[p]; } else { delete require.cache[p]; }
        }
        done(ran);
    });
}

test('적용할 마이그레이션이 없어도 상한 검사는 돈다', function (t, done) {
    // Every deployed server is in this state; the check must run here.
    runBootstrap({ now: 151, pending: [] }, function (ran) {
        const calls = ran.filter((s) => /ensureConnectionCeiling/.test(s));
        assert.strictEqual(calls.length, 1,
            'pending 이 0 인데 상한 검사가 안 돌았다 — 배포된 서버에서는 이 경로뿐이다\n' +
            '실행된 것: ' + JSON.stringify(ran));
        done();
    });
});

test('코어가 넘기는 수는 pool_sizing 이 계산한 값이다', function (t, done) {
    // The core's part is arithmetic only; the number must be right.
    const ps = require(path.join(ROOT, 'mobius', 'pool_sizing.js'));
    runBootstrap({ now: 151, pending: [] }, function (ran) {
        const call = ran.find((s) => /ensureConnectionCeiling/.test(s));
        assert.strictEqual(call, 'ensureConnectionCeiling(' + ps.currentFloor() + ')',
            '넘긴 수가 pool_sizing 의 계산과 다르다: ' + call);
        done();
    });
});

test('설정 화면이 바닥을 그릴 재료를 받는다', function () {
    // The screen receives a number, not a formula, so it cannot diverge from what the server applies.
    const d = require(path.join(ROOT, 'mobius', 'conf_schema.js')).describe();
    const got = d.dbConnectionLimit.derived;

    assert.ok(got, 'dbConnectionLimit 이 derived 를 안 준다 — 화면이 바닥을 못 그린다');
    assert.strictEqual(got.of, 'max_connections');
    assert.strictEqual(got.slack, 1.2);
    assert.strictEqual(got.roundTo, 100);

    // The screen's calculation must agree with the server's.
    const ps = require(path.join(ROOT, 'mobius', 'pool_sizing.js'));
    const v = d.dbConnectionLimit.dflt;
    const onScreen = Math.ceil(v * got.processes * got.slack / got.roundTo) * got.roundTo;
    assert.strictEqual(onScreen, ps.floorFor(v, got.processes),
        '화면이 계산한 값과 서버가 거는 값이 다르다');
});
