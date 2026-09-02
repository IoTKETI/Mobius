'use strict';
// 기동 시 자동 적용되는 마이그레이션의 안전 규칙.
//
// 목적은 "새로 설치한 DB 가 지금 배포와 같은 상태로 뜨게" 하는 것이다.
// 스키마는 mobiusdb.sql 이 이미 맞춰 주고(test/schema-drift.test.js),
// SQLite 는 PRAGMA 를 connect 마다 건다. 남는 것이 MySQL 서버 설정 하나라
// 그것만 기동 시 적용한다.
//
// **위험은 하나뿐이다: 느린 마이그레이션이 기동 경로에 들어오는 것.**
// 001 은 배포에서 20.6분 걸렸다(lookup 5,740만 행에 인덱스). 그런 것에
// autoApply 가 붙으면 재기동이 20분 멈춘다.

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
    // 기본값이 "자동" 이면 새 마이그레이션이 실수로 기동 경로에 들어온다.
    // 밝히지 않은 것은 전부 수동이어야 한다.
    const auto = migrations().filter((m) => m.mod.autoApply === true);
    const names = auto.map((m) => m.mod.id);

    // 011 은 ALTER 지만 ALGORITHM=INSTANT 라 행 수와 무관하게 즉시 끝난다.
    // 테이블을 다시 쓰지 않고 메타데이터만 바꾼다(MySQL 8.0.12+).
    // 값을 채우는 일(012)은 성격이 완전히 달라 여기 들어오면 안 된다.
    assert.deepStrictEqual(names, ['010-server-durability', '011-lookup-cin-attrs'],
        '자동 적용 목록이 바뀌었다: ' + names.join(', ') +
        '\n새로 추가하려면 그 마이그레이션이 **데이터 양과 무관하게 즉시** ' +
        '끝나는지 확인할 것. 001 은 배포에서 20.6분 걸렸다.');
});

test('DDL 을 내는 마이그레이션에는 autoApply 가 없다', function () {
    // 인덱스 생성·삭제, 테이블 변경은 데이터 양에 비례한다. 기동 경로에
    // 두면 안 된다. SET PERSIST 처럼 서버 설정만 바꾸는 것은 예외다.
    //
    // **예외가 하나 더 있다: ALGORITHM=INSTANT 인 ALTER.**
    //
    // MySQL 8.0.12 부터 행 끝에 컬럼을 더하는 것은 테이블을 다시 쓰지 않고
    // 메타데이터만 바꾼다. 행 수와 무관하게 즉시 끝나므로 이 가드가 막으려는
    // 것(데이터가 쌓이면 기동이 멈춘다)에 해당하지 않는다.
    //
    // 예외를 **좁게** 연다 — 같은 문장에 algorithm=instant 가 적혀 있을 때만이다.
    // 그것을 명시하면 조건이 안 맞을 때 서버가 거절하므로, 우리가 모르는 사이에
    // 테이블 재작성이 시작되지 않는다. 안 적으면 조용히 INPLACE/COPY 로 떨어진다.
    const DDL = /\b(create\s+(table|index)|alter\s+table|drop\s+(table|index))\b/i;
    const INSTANT = /algorithm\s*=\s*instant/i;

    for (const { file, mod } of migrations()) {
        if (mod.autoApply !== true) { continue; }
        const src = fs.readFileSync(path.join(MIG, file), 'utf8');
        // 주석은 뺀다 — 왜 이렇게 하는지 설명하느라 DDL 을 인용한다.
        const code = src.split('\n')
            .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
            .join('\n');

        if (!DDL.test(code)) { continue; }

        // DDL 이 있다면 ALTER 뿐이어야 한다. 만들고 지우는 것은 예외가 없다.
        const heavy = /\b(create\s+(table|index)|drop\s+(table|index))\b/i;
        assert.ok(!heavy.test(code),
            file + ' 이 autoApply 인데 테이블·인덱스를 만들거나 지운다 —' +
            ' 데이터가 쌓이면 기동이 멈춘다 (001 은 배포에서 20.6분 걸렸다)');

        // **소스를 정규식으로 보면 안 된다.** 처음에 그렇게 썼다가
        // `'ALGORITHM=INSTANT 를 못 쓰면...'` 이라는 **에러 메시지 문자열**에
        // 걸려서, algorithm 절을 빼도 통과했다. 실제로 확인해 보고 알았다.
        //
        // 그래서 up() 을 가짜 ctx 로 돌려 **진짜로 나가는 SQL** 을 본다.
        const sqls = [];
        const ctx = {
            conn: {},
            db: {
                raw: (s) => s,
                run: (s, conn, cb) => {
                    sqls.push(String(s));
                    // information_schema 조회면 "컬럼이 없다" 로 답해 up() 이
                    // 실제 ALTER 까지 가게 한다.
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

    // 거르는 조건이 있어야 하고, 그것이 === true 여야 한다.
    // truthy 검사면 autoApply: 'later' 같은 값이 통과한다.
    assert.match(code, /autoApply\s*===\s*true/,
        'autoApply 를 === true 로 거르지 않는다');

    // 거르지 않은 목록을 apply 에 넘기면 안 된다.
    assert.ok(!/migrate\.apply\(\s*ctx\s*,\s*pending\b/.test(code),
        'pending 전체를 apply 에 넘긴다 — 느린 것까지 기동 시 돈다');
    assert.match(code, /migrate\.apply\(\s*ctx\s*,\s*auto\b/,
        '걸러낸 목록(auto)을 넘기지 않는다');
});

test('기동을 막지 않는다 — 실패해도 콜백은 불린다', function () {
    // DB 가 아직 안 떠 있거나 권한이 모자랄 수 있다. 그때 기동이 멈추면
    // 원인이 가려진다. 모든 실패 경로가 callback(null) 로 끝나야 한다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // callback 을 부르는 곳은 전부 null 로 부른다 (에러를 위로 올리지 않는다).
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

    // 배포에 적용한 값과 같아야 한다. 다르면 새 설치가 배포와 갈라진다.
    assert.match(code, /innodb_flush_log_at_trx_commit:\s*'1'/);
    assert.match(code, /transaction_isolation:\s*'REPEATABLE-READ'/);

    // sync_binlog 는 건드리지 않기로 했다 — 기준 백업이 없어 지킬 대상이 없다.
    assert.ok(!/SET PERSIST sync_binlog/i.test(code),
        'sync_binlog 를 건드린다 — 유지하기로 한 값이다');
});

test('접속 상한의 주인은 기동 검사 하나뿐이다', function () {
    // 둘이 쓰면 어느 쪽이 이겼는지 알 수 없다. 010 은 한 번 돌고 기록되므로
    // 설정 유실(151 로 복귀)을 못 고친다 — 그래서 기동 검사가 갖는다.
    const src = fs.readFileSync(path.join(MIG, '010-server-durability.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // 010 이 값을 **읽는** 것은 괜찮다(inspect 가 상태를 보여 준다).
    // 거는 것이 문제다 — WANT 에 들어가면 up() 이 SET PERSIST 를 낸다.
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
    // **이 테스트가 이 회차의 요점이다.**
    //
    // 예전 db_bootstrap 은 게이트만 백엔드 중립이었고 본문은 MySQL SQL 이었다.
    // 처음에는 `ctx.backend !== 'mysql'`, 그다음에는 `can('serverTuning')` 로
    // 게이트를 바꿨지만 그 뒤에서 select @@global.max_connections 와
    // SET PERSIST 를 코어가 문자열로 만들고 있었다.
    //
    // 능력 질의는 오히려 더 나빴다. 이름 비교는 다른 백엔드에서 조용히
    // 건너뛰기라도 했는데, 능력이 참인 백엔드가 붙으면 MySQL 문장이 그대로
    // 그쪽으로 날아간다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.ok(!/SET PERSIST|SET GLOBAL|@@global|information_schema|performance_schema/i.test(code),
        '코어가 서버 설정 SQL 을 직접 만든다 — 그 문장은 어댑터가 갖는다');
    assert.ok(!/can\(\s*['"]serverTuning['"]\s*\)/.test(code),
        "can('serverTuning') 이 되살아났다 — 불리언은 '어떻게' 를 말하지 못한다");

    // 코어가 아는 것은 산수뿐이다. 필요한 수를 계산해 넘기는 것까지가 코어 몫이다.
    assert.match(code, /pool_sizing\.currentFloor\(\)/,
        'pool_sizing 으로 필요한 수를 계산하지 않는다');
    assert.match(code, /db\.ensureConnectionCeiling\(\s*floor/,
        '계산한 수를 어댑터에 넘기지 않는다');
});

test('올리기만 하는 규칙은 어댑터가 지킨다', function () {
    // 내리면 그 여유를 쓰던 다른 클라이언트를 끊는다. 운영자가 바닥 위로
    // 올려 둔 값(관리 UI, my.cnf)은 그대로 둬야 한다.
    //
    // 이 규칙이 어댑터로 옮겨간 것이 맞다 — "올린다" 가 무엇인지가 백엔드마다
    // 다르기 때문이다. 지금 값을 어떻게 읽고 어떻게 거는지가 전부 다르다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db', 'mysql.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.match(code, /now\s*>=\s*floor/,
        '지금 값과 필요한 수를 견주지 않는다 — 무조건 덮어쓰면 옛 set_tuning 과 같다');

    // 값은 코어가 준 것만 쓴다. 어댑터가 자기 상수를 적으면 화면이 말하는 값과
    // 서버가 거는 값이 갈린다.
    assert.ok(!/max_connections\s*=\s*'?\d/.test(code),
        '어댑터가 상수를 적는다 — 코어가 넘긴 floor 만 써야 한다');
});

test('기동 검사는 백엔드를 구분하지 않는다 — 이름으로도 능력으로도', function () {
    // 처음에는 `ctx.backend !== 'mysql'`, 그다음에는 `can('serverTuning')`,
    // 지금은 **아무것도 묻지 않는다.** 조건 없이 어댑터에 시키고, 그 개념이
    // 없는 백엔드는 어댑터가 no-op 으로 답한다.
    //
    // 묻지 않는 것이 왜 나은가: 물으려면 물을 대상의 목록을 코어가 알아야
    // 한다. 백엔드가 늘 때마다 그 목록이 맞는지 다시 봐야 하고, 아무도 안 본다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.ok(!/backend\s*[!=]==?\s*['"]/.test(code),
        '백엔드 이름을 문자열과 견준다 — 코어는 어느 DB 인지 몰라야 한다');
    assert.ok(!/\.can\(/.test(code),
        '능력을 물어 갈라진다 — 어댑터에 시키고 결과만 받아라');

    // 이름을 쓰는 자리가 하나 남는다: 마이그레이션 필터링이다. 거기서는
    // 이름이 곧 데이터라 피할 수 없지만, global 을 직접 읽으면 파사드와
    // 판단이 갈리므로 파사드가 고른 이름을 받아야 한다.
    assert.ok(!/global\.usedb/.test(code),
        'global.usedb 를 직접 읽는다 — pick() 과 규칙이 다른 두 번째 기본값이 생긴다');
    assert.match(code, /db\.backendName\(\)/,
        '파사드가 고른 백엔드 이름을 받지 않는다');
});

test('상한 개념이 없는 백엔드에서도 기동은 그대로 끝난다', function (t, done) {
    // 코어는 백엔드를 구분하지 않고 **언제나** 부른다. 그 개념이 없는 어댑터가
    // applied:false 로 답하면 끝이다 — 코어에 그 갈래가 없다.
    runBootstrap({ now: 10, pending: [], ceilingUnsupported: true }, function (ran) {
        assert.ok(ran.some((s) => /ensureConnectionCeiling/.test(s)),
            '어댑터에 물어보지도 않았다 — 구분은 어댑터가 한다');
        done();
    });
});

test('어댑터가 실패해도 기동은 계속한다', function (t, done) {
    // 서버 설정을 바꿀 권한이 없는 설치가 있을 수 있다. 그때 기동이 멈추면
    // 원인이 가려진다 — 로그만 남기고 진행한다.
    let finished = false;
    runBootstrap({ now: 10, pending: [], ceilingError: true }, function () {
        finished = true;
        assert.ok(finished, '어댑터 실패에 기동이 막혔다');
        done();
    });
});

test('바닥은 풀 크기와 프로세스 수에서 계산된다', function () {
    const ps = require(path.join(ROOT, 'mobius', 'pool_sizing.js'));

    // 지금 배포: 풀 25 x 프로세스 25 = 625, x1.2 = 750, 100 단위로 올려 800.
    assert.strictEqual(ps.appDemand(25, 25), 625);
    assert.strictEqual(ps.floorFor(25, 25), 800);

    // 풀을 바꾸면 바닥도 따라간다 — 이것이 800 을 박아 두지 않은 이유다.
    assert.strictEqual(ps.floorFor(10, 25), 300);   // 250 -> 300
    assert.strictEqual(ps.floorFor(50, 25), 1500);  // 1500 -> 1500

    // MySQL 기본값 151 은 어떤 현실적인 설정에서도 바닥에 못 미친다.
    assert.ok(ps.floorFor(25, 25) > 151);

    // 프로세스 수는 워커 + 마스터다. 마스터를 빼면 풀 하나만큼 모자란다.
    assert.strictEqual(ps.processCount(), require('node:os').cpus().length + 1);
});

// db_bootstrap 을 가짜 파사드 위에서 실제로 돌린다.
//
// 소스를 정규식으로 보는 검사는 "검사가 **언제** 도는가" 를 못 본다.
// 실제로 한 번 이런 식으로 놓쳤다: 바닥 검사를 "적용할 마이그레이션이
// 있을 때" 안에 두는 바람에, 이미 다 적용된 서버(=배포된 모든 서버)에서는
// pending 이 0 이라 그 분기에 들어가지도 못했다. 배포 로그가 조용해서
// 드러났다 — 그전까지 900개 테스트가 전부 통과했다.
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

        // 코어가 부르는 것은 이 함수 하나다. 무슨 SQL 을 낼지는 어댑터 몫이라
        // 여기서는 흉내만 낸다 — 코어가 **필요한 수를 제대로 계산해서 넘기는지**,
        // 그리고 **언제 부르는지**가 이 하네스가 보는 것이다.
        //
        // opts.ceilingUnsupported 를 주면 그 개념이 없는 백엔드(sqlite)를 흉내낸다.
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
        pending: () => opts.pending || [],       // 기본은 0개 — 배포된 서버의 상태
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
    // 배포된 모든 서버가 이 상태다. 여기서 안 돌면 검사가 영영 안 도는 것과 같다.
    runBootstrap({ now: 151, pending: [] }, function (ran) {
        const calls = ran.filter((s) => /ensureConnectionCeiling/.test(s));
        assert.strictEqual(calls.length, 1,
            'pending 이 0 인데 상한 검사가 안 돌았다 — 배포된 서버에서는 이 경로뿐이다\n' +
            '실행된 것: ' + JSON.stringify(ran));
        done();
    });
});

test('코어가 넘기는 수는 pool_sizing 이 계산한 값이다', function (t, done) {
    // 코어 몫은 산수뿐이다. 그 수가 틀리면 어댑터가 아무리 옳아도 소용없다.
    const ps = require(path.join(ROOT, 'mobius', 'pool_sizing.js'));
    runBootstrap({ now: 151, pending: [] }, function (ran) {
        const call = ran.find((s) => /ensureConnectionCeiling/.test(s));
        assert.strictEqual(call, 'ensureConnectionCeiling(' + ps.currentFloor() + ')',
            '넘긴 수가 pool_sizing 의 계산과 다르다: ' + call);
        done();
    });
});

test('설정 화면이 바닥을 그릴 재료를 받는다', function () {
    // 화면에 계산식을 적으면 서버가 실제로 거는 값과 갈린다. 숫자만 넘긴다.
    const d = require(path.join(ROOT, 'mobius', 'conf_schema.js')).describe();
    const got = d.dbConnectionLimit.derived;

    assert.ok(got, 'dbConnectionLimit 이 derived 를 안 준다 — 화면이 바닥을 못 그린다');
    assert.strictEqual(got.of, 'max_connections');
    assert.strictEqual(got.slack, 1.2);
    assert.strictEqual(got.roundTo, 100);

    // 화면 계산이 서버 계산과 같은 답을 내야 한다.
    const ps = require(path.join(ROOT, 'mobius', 'pool_sizing.js'));
    const v = d.dbConnectionLimit.dflt;
    const onScreen = Math.ceil(v * got.processes * got.slack / got.roundTo) * got.roundTo;
    assert.strictEqual(onScreen, ps.floorFor(v, got.processes),
        '화면이 계산한 값과 서버가 거는 값이 다르다');
});
