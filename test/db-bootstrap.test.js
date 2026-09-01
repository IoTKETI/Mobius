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
    assert.match(code, /max_connections:\s*'800'/);

    // sync_binlog 는 건드리지 않기로 했다 — 기준 백업이 없어 지킬 대상이 없다.
    assert.ok(!/SET PERSIST sync_binlog/i.test(code),
        'sync_binlog 를 건드린다 — 유지하기로 한 값이다');
});
