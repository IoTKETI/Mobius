'use strict';
// 이 작업의 완료 기준을 실행 가능한 형태로 못박는다.
//
//   **global.usesqlite 를 읽는 곳이 mobius/db/index.js 한 곳뿐일 것.**
//
// 코어가 어느 백엔드인지 알면, 백엔드를 바꿀 때마다 코어를 고쳐야 하고
// 한쪽만 고치면 두 경로가 조용히 갈라진다. 실제로 그렇게 갈라진 것을
// 여럿 고쳤다(discovery 재귀 CTE, cin.cs 의 타입, delete_oldest 의 알고리즘).
//
// 허용 목록은 **줄어들기만 해야 한다.** 새 파일이 늘면 실패하고, 목록에
// 적힌 파일에서 리더가 사라지면 그것도 실패한다(목록을 같이 지우라는 뜻).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// 아직 usesqlite 를 읽어도 되는 파일. 커밋이 하나 지울 때마다 여기서도 지운다.
//
// 커넥션 원천이 파사드로 옮겨가면서 넷이 한꺼번에 사라졌다 — db_action(기동),
// cnt_man(취득), resource(취득), sgn(취득). 넷 다 "내가 sqlite 인가" 를 묻고
// 있었지만 진짜 질문은 "커넥션을 누가 주나" 하나였다.
//
// 남은 둘은 성격이 다르다. **진짜로 백엔드마다 동작이 다른 곳**이고, 없앨 것이
// 아니라 어댑터 메서드로 옮길 것이다. 그러면 코어에는 분기가 없고 각 어댑터가
// 자기 방식대로 구현한다 — 세 번째 백엔드가 와도 if 가 늘지 않는다.
const ALLOWED = [
    'mobius/db/index.js',      // 최종 목적지 — 여기 하나만 남아야 한다
    'mobius/cnt_man.js',       // 카운터 갱신: MySQL 은 한 문장, SQLite 는 두 문장
    'mobius/sql_action.js'     // delete_oldest: 알고리즘 자체가 다르다
];

// mobius.js 는 usesqlite 를 **세팅**하는 곳이라 대상이 아니다.
// tools/ 와 migrations/ 는 운영 코드가 아니다(백엔드를 인자로 고른다).
function sourceFiles() {
    const out = [];
    // 루트의 진입점들. 프록시(pxy_*)와 wdt 도 코어다 — 지금은 리더가 없지만
    // 범위에서 빼면 나중에 거기로 새 리더가 들어와도 안 걸린다.
    for (const f of fs.readdirSync(ROOT)) {
        if (f.endsWith('.js') && f !== 'mobius.js') { out.push(f); }
    }
    // mobius/ 아래 전부 (한 단계 하위 디렉터리 포함)
    const walk = (rel) => {
        for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
            const r = rel + '/' + e.name;
            if (e.isDirectory()) { walk(r); }
            else if (e.name.endsWith('.js')) { out.push(r); }
        }
    };
    walk('mobius');
    return out;
}

// 주석 줄은 세지 않는다. 코드가 읽는 것만 리더다.
function readsUsesqlite(rel) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    return lines.some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /global\.usesqlite/.test(l));
}

test('global.usesqlite 를 읽는 파일은 허용 목록과 정확히 같다', function () {
    const actual = sourceFiles().filter(readsUsesqlite).sort();
    const allowed = ALLOWED.slice().sort();

    const added = actual.filter((f) => allowed.indexOf(f) < 0);
    const gone = allowed.filter((f) => actual.indexOf(f) < 0);

    assert.deepStrictEqual(added, [],
        '허용 목록에 없는 파일이 global.usesqlite 를 읽는다 — 코어는 백엔드를 몰라야 한다');
    assert.deepStrictEqual(gone, [],
        '이 파일들에서 리더가 사라졌다. 허용 목록에서도 지워라: ' + gone.join(', '));
});

test('파사드는 언제나 목록에 있다 — 여기가 유일한 리더가 되는 것이 목표다', function () {
    assert.ok(ALLOWED.indexOf('mobius/db/index.js') >= 0);
    assert.ok(readsUsesqlite('mobius/db/index.js'),
        '파사드가 usesqlite 를 안 읽는다 — 백엔드를 어떻게 고르는지 확인할 것');
});

test('can() 은 connect() 전에도 던지지 않는다', function () {
    // check_db_support 는 CREATE 요청마다 도는 동기 게이트다. 여기서 던지면
    // 그 예외가 db.getConnection 콜백 안에서 터져 워커가 죽고 빌린 커넥션이 샌다.
    // (app.js 는 파사드 connect 의 실패를 삼키고 기동을 계속시킨다.)
    delete require.cache[require.resolve('../mobius/db')];
    delete require.cache[require.resolve('../mobius/db/mysql')];
    delete require.cache[require.resolve('../mobius/db/sqlite')];

    const saved = global.usesqlite;
    try {
        for (const [backend, expected] of [['true', true], ['false', false]]) {
            delete require.cache[require.resolve('../mobius/db')];
            global.usesqlite = backend;
            const db = require('../mobius/db');
            assert.strictEqual(db.can('limitedResourceTypes'), expected,
                'usesqlite=' + backend + ' 에서 limitedResourceTypes 가 틀렸다');
            assert.strictEqual(db.can('없는_능력'), false, '없는 키는 false 여야 한다');
        }
    } finally {
        if (saved === undefined) { delete global.usesqlite; } else { global.usesqlite = saved; }
        delete require.cache[require.resolve('../mobius/db')];
    }
});

test('501 게이트는 fail-open 이다 — 제한을 선언한 백엔드만 거른다', function () {
    // 극성이 뒤집히면 정상 CREATE 가 501 로 나간다. mysql 어댑터는 이 키를
    // 적지 않는 것으로 "제한 없음" 을 표현한다.
    const mysql = require('../mobius/db/mysql');
    const sqlite = require('../mobius/db/sqlite');
    assert.strictEqual(mysql.capabilities.limitedResourceTypes, undefined,
        'mysql 이 limitedResourceTypes 를 선언했다 — 제한 없음은 키가 없는 것이다');
    assert.strictEqual(sqlite.capabilities.limitedResourceTypes, true);
});

test('SQLITE_SUPPORTED_TY 는 스키마에 테이블이 있는 타입만 담는다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'mobius/resource.js'), 'utf8');
    const m = src.match(/var SQLITE_SUPPORTED_TY = \[([^\]]*)\]/);
    assert.ok(m, 'SQLITE_SUPPORTED_TY 를 못 찾았다');
    const list = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);

    const responder = require('../mobius/responder');
    const schema = fs.readFileSync(path.join(ROOT, 'mobius/mobiusdb_sqlite.sql'), 'utf8');

    for (const ty of list) {
        const table = responder.typeRsrc[ty];
        assert.ok(table, 'ty=' + ty + ' 가 typeRsrc 에 없다');
        const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + table + '`?\\s*\\(', 'i');
        assert.ok(re.test(schema),
            'ty=' + ty + '(' + table + ') 가 목록에 있는데 mobiusdb_sqlite.sql 에 테이블이 없다');
    }
});
