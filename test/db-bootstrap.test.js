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

    assert.deepStrictEqual(names, ['010-server-durability'],
        '자동 적용 목록이 바뀌었다: ' + names.join(', ') +
        '\n새로 추가하려면 그 마이그레이션이 **데이터 양과 무관하게 즉시** ' +
        '끝나는지 확인할 것. 001 은 배포에서 20.6분 걸렸다.');
});

test('DDL 을 내는 마이그레이션에는 autoApply 가 없다', function () {
    // 인덱스 생성·삭제, 테이블 변경은 데이터 양에 비례한다. 기동 경로에
    // 두면 안 된다. SET PERSIST 처럼 서버 설정만 바꾸는 것은 예외다.
    const DDL = /\b(create\s+(table|index)|alter\s+table|drop\s+(table|index))\b/i;

    for (const { file, mod } of migrations()) {
        if (mod.autoApply !== true) { continue; }
        const src = fs.readFileSync(path.join(MIG, file), 'utf8');
        // 주석은 뺀다 — 왜 이렇게 하는지 설명하느라 DDL 을 인용한다.
        const code = src.split('\n')
            .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
            .join('\n');

        assert.ok(!DDL.test(code),
            file + ' 이 autoApply 인데 DDL 을 낸다 — 데이터가 쌓이면 기동이 멈춘다');
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

test('max_connections 의 주인은 기동 검사 하나뿐이다', function () {
    // 둘이 쓰면 어느 쪽이 이겼는지 알 수 없다. 010 은 한 번 돌고 기록되므로
    // SET PERSIST 유실(151 로 복귀)을 못 고친다 — 그래서 기동 검사가 갖는다.
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
    assert.match(boot, /SET PERSIST max_connections/,
        '기동 검사가 max_connections 를 걸지 않는다');
});

test('기동 검사는 올리기만 한다', function () {
    // 내리면 그 여유를 쓰던 다른 클라이언트를 끊는다. 운영자가 바닥 위로
    // 올려 둔 값(관리 UI, my.cnf)은 그대로 둬야 한다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db_bootstrap.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // 지금 값이 바닥 이상이면 SET 에 닿기 전에 빠져나가야 한다.
    assert.match(code, /now\s*>=\s*floor/,
        '지금 값과 바닥을 견주지 않는다 — 무조건 덮어쓰면 옛 set_tuning 과 같다');

    // 바닥 계산은 pool_sizing 에서만 온다. 여기서 숫자를 적으면 화면이
    // 말하는 값과 서버가 거는 값이 갈린다.
    assert.ok(!/max_connections\s*=\s*'?\d/.test(code),
        '기동 검사가 max_connections 에 상수를 적는다 — pool_sizing 을 써야 한다');
    assert.match(code, /pool_sizing\.currentFloor\(\)/,
        'pool_sizing.currentFloor() 로 바닥을 구하지 않는다');
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
