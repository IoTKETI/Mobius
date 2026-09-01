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
// **목표 달성.** 이제 파사드 하나뿐이다.
//
// 마지막 둘(cnt_man 의 카운터 갱신, sql_action 의 delete_oldest)은 "백엔드마다
// 동작이 달라야 한다" 는 이유로 남아 있었는데, 다시 보니 그 차이는 백엔드가
// 아니라 **정리 주체가 여럿이라는 것**에서 나왔다. 워커 25개가 동시에 정리하니
// 행 잠금이 필요했고, 잠금이 없는 백엔드는 그 알고리즘을 못 써서 갈렸다.
// 정리를 마스터 하나로 옮기자 잠금이 필요 없어지고 갈래도 사라졌다.
const ALLOWED = [
    'mobius/db/index.js'       // 백엔드를 아는 유일한 곳
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
        for (const [backend, limited] of [['true', true], ['false', false]]) {
            delete require.cache[require.resolve('../mobius/db')];
            global.usesqlite = backend;
            const db = require('../mobius/db');
            const allowed = db.supportedResourceTypes();
            if (limited) {
                assert.ok(Array.isArray(allowed),
                    'usesqlite=' + backend + ' 이 지원 타입 목록을 안 준다');
            }
            else {
                assert.strictEqual(allowed, null,
                    'usesqlite=' + backend + ' 이 제한을 선언했다 — null 이어야 한다');
            }
            assert.strictEqual(db.can('없는_능력'), false, '없는 키는 false 여야 한다');
        }
    } finally {
        if (saved === undefined) { delete global.usesqlite; } else { global.usesqlite = saved; }
        delete require.cache[require.resolve('../mobius/db')];
    }
});

test('501 게이트는 fail-open 이다 — 제한을 선언한 백엔드만 거른다', function () {
    // 극성이 뒤집히면 정상 CREATE 가 501 로 나간다. **목록이 아닌 것**이
    // "제한 없음" 이다 — mysql 은 null 을 적고, 아예 빠뜨린 어댑터도 같다.
    const mysql = require('../mobius/db/mysql');
    const sqlite = require('../mobius/db/sqlite');
    assert.strictEqual(mysql.supportedResourceTypes, null,
        'mysql 이 지원 타입 목록을 선언했다 — 제한 없음은 null 이다');
    assert.ok(Array.isArray(sqlite.supportedResourceTypes),
        'sqlite 가 지원 타입 목록을 선언하지 않았다');

    // 값을 아예 안 적은 어댑터도 fail-open 이어야 한다.
    delete require.cache[require.resolve('../mobius/db')];
    const saved = global.usedb;
    try {
        global.usedb = 'mysql';
        const db = require('../mobius/db');
        const real = mysql.supportedResourceTypes;
        delete mysql.supportedResourceTypes;
        assert.strictEqual(db.supportedResourceTypes(), null,
            '선언을 빠뜨린 어댑터가 제한 있음으로 읽혔다 — 정상 CREATE 가 501 이 된다');
        mysql.supportedResourceTypes = real;
    } finally {
        global.usedb = saved;
        delete require.cache[require.resolve('../mobius/db')];
    }
});

test('지원 타입 목록은 어댑터가 갖는다 — 코어에 백엔드 이름이 없다', function () {
    // 예전에는 resource.js 에 SQLITE_SUPPORTED_TY 가 있었다. 코어에, 한 백엔드
    // 이름을 달고. 그러면 다른 백엔드가 다른 부분집합을 지원할 때 코어를
    // 고쳐야 하고, "어댑터 파일 하나로 붙는다" 가 깨진다.
    // **주석은 빼고 본다.** 왜 옮겼는지 설명하느라 옛 이름을 인용하기 때문이다.
    // (이 저장소에서 소스 스캔 테스트가 자기 주석에 걸린 적이 여러 번 있다.)
    const src = fs.readFileSync(path.join(ROOT, 'mobius/resource.js'), 'utf8');
    const core = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    assert.strictEqual(/SQLITE_SUPPORTED_TY/.test(core), false,
        'resource.js 에 SQLITE_SUPPORTED_TY 가 되살아났다 — 목록은 어댑터가 갖는다');
    assert.strictEqual(/\b(SQLITE|MYSQL|POSTGRES)_[A-Z_]+\s*=/.test(core), false,
        'resource.js 에 백엔드 이름이 붙은 상수가 있다');
});

test('501 게이트는 타입별 빌더보다 먼저 선다', function () {
    // create_action 안의 게이트만으로는 늦다. build_resource 아래의 타입별
    // 빌더(build_grp 등)가 먼저 DB 를 치고, 그 실패가 500 "database error" 로
    // 뭉개져 나간다. 실측: SQLite 에서 grp 생성이 501 대신 500 이었다
    // (build_grp -> update_route -> `select * from csr`, 그 테이블이 없다).
    const src = fs.readFileSync(path.join(ROOT, 'mobius/resource.js'), 'utf8');
    const at_create = src.indexOf('exports.create = function');
    assert.ok(at_create > 0, 'exports.create 를 못 찾았다');

    const body = src.slice(at_create, src.indexOf('\nexports.', at_create + 10));
    const at_gate = body.indexOf('check_db_support');
    const at_build = body.indexOf('build_resource(');

    assert.ok(at_gate >= 0, 'exports.create 가 check_db_support 를 부르지 않는다');
    assert.ok(at_build >= 0, 'exports.create 에서 build_resource 를 못 찾았다');
    assert.ok(at_gate < at_build,
        '게이트가 build_resource 뒤에 있다 — 타입별 빌더가 먼저 DB 를 친다');
});

test('어댑터의 지원 타입 목록은 그 어댑터 스키마에 테이블이 있는 것만 담는다', function () {
    // 어댑터가 선언한 목록과 그 어댑터의 스키마 파일을 대조한다.
    // 목록에 있는데 테이블이 없으면 CREATE 가 501 이 아니라 500 으로 깨진다.
    const responder = require('../mobius/responder');
    const dir = path.join(ROOT, 'mobius', 'db');

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js') || f === 'index.js' || f === 'errors.js') { continue; }
        const adapter = require(path.join(dir, f));
        const list = adapter.supportedResourceTypes;
        if (!Array.isArray(list)) { continue; }   // 제한 없음

        const schema = fs.readFileSync(path.join(ROOT, 'mobius', adapter.schemaFile), 'utf8');
        for (const ty of list) {
            const table = responder.typeRsrc[ty];
            assert.ok(table, adapter.name + ': ty=' + ty + ' 가 typeRsrc 에 없다');
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + table + '`?\\s*\\(', 'i');
            assert.ok(re.test(schema),
                adapter.name + ': ty=' + ty + '(' + table + ') 가 지원 목록에 있는데 ' +
                adapter.schemaFile + ' 에 테이블이 없다');
        }
    }
});

// ty -> **본문 테이블** 이름.
//
// responder.typeRsrc 는 테이블이 아니라 **루트 이름**을 준다. 대부분 같지만
// (ae -> ae, cnt -> cnt) 둘이 갈리는 데가 있다:
//   hd_*(91~98)  전부 fcnt 테이블을 쓴다 (sql_action 의 BODY_TABLES 참고)
//   rsp(99)      리소스가 아니라 응답 봉투다 — 테이블이 없다
//   mgo(13)      fwr/bat/dvi/dvc/rbo 가 공유하는 추상 타입
function bodyTable(ty, rootnm) {
    if (Number(ty) >= 91 && Number(ty) <= 98) { return 'fcnt'; }
    if (String(ty) === '99') { return null; }
    return rootnm;
}

test('제한 없는 백엔드는 스키마에 모든 타입의 테이블이 있다', function () {
    // 제한을 선언하지 않았다는 것은 "다 받는다" 는 뜻이다. 그런데 스키마에
    // 테이블이 없으면 CREATE 가 500 으로 깨진다 — 501 로 거절되지도 않는다.
    // (SQLite 의 grp 가 그랬다: 목록에 없어 501 이 맞는데, 게이트가 늦어
    //  csr 조회가 먼저 돌아 500 이 나갔다.)
    const responder = require('../mobius/responder');
    const dir = path.join(ROOT, 'mobius', 'db');

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js') || f === 'index.js' || f === 'errors.js') { continue; }
        const adapter = require(path.join(dir, f));
        if (Array.isArray(adapter.supportedResourceTypes)) { continue; }   // 제한 있음

        const schema = fs.readFileSync(path.join(ROOT, 'mobius', adapter.schemaFile), 'utf8');
        const missing = [];
        // responder.typeRsrc 에서 뽑는다. global.ty_list 는 app.js 가 세우는데
        // 이 테스트는 app.js 를 로드하지 않아 언제나 비어 있다 — 그러면 아무것도
        // 검사하지 않고 통과한다.
        for (const ty of Object.keys(responder.typeRsrc)) {
            const table = bodyTable(ty, responder.typeRsrc[ty]);
            if (!table) { continue; }   // 추상 타입(mgo 등)은 본문 테이블이 없다
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + table + '`?\\s*\\(', 'i');
            if (!re.test(schema)) { missing.push(ty + '(' + table + ')'); }
        }
        assert.deepStrictEqual(missing, [],
            adapter.name + ' 이 제한을 선언하지 않았는데 ' + adapter.schemaFile +
            ' 에 테이블이 없는 타입이 있다: ' + missing.join(', '));
    }
});

test('SQLite 가 MySQL 과 같아지기까지 남은 타입을 센다', function () {
    // SQLite 백엔드는 개발 중이고 **MySQL 과 같은 타입을 전부 받는 것이
    // 목표**다(사용자 확인 2026-09-01). 지금의 부분집합은 임시 상태다.
    //
    // 이 테스트는 막지 않는다 — 남은 것을 **보여 준다.** 목록이 줄어드는 것이
    // 진척이고, 0 이 되면 sqlite 의 supportedResourceTypes 를 null 로 바꾸면
    // 된다(그러면 위의 '제한 없는 백엔드는...' 테스트가 스키마를 검사한다).
    const responder = require('../mobius/responder');
    const sqlite = require('../mobius/db/sqlite');
    const schema = fs.readFileSync(path.join(ROOT, 'mobius/mobiusdb_sqlite.sql'), 'utf8');
    const mysqlSchema = fs.readFileSync(path.join(ROOT, 'mobius/mobiusdb.sql'), 'utf8');

    const has = (s, t) =>
        new RegExp('CREATE TABLE (IF NOT EXISTS )?\`?' + t + '\`?\\s*\\(', 'i').test(s);

    // 타입 목록은 responder.typeRsrc 에서 뽑는다. global.ty_list 는 app.js 가
    // 세우는데 이 테스트는 app.js 를 로드하지 않아 언제나 비어 있었다 —
    // 그래서 "남은 것 0개" 라는 거짓 결과가 나왔다.
    const missing = [];
    const tables = new Set();
    for (const ty of Object.keys(responder.typeRsrc)) {
        if (sqlite.supportedResourceTypes.indexOf(String(ty)) >= 0) { continue; }
        const table = bodyTable(ty, responder.typeRsrc[ty]);
        if (!table) { continue; }                    // 응답 봉투 등 리소스가 아닌 것
        if (!has(mysqlSchema, table)) { continue; }  // MySQL 에도 없으면 대상이 아니다
        missing.push(ty + '(' + table + ')' + (has(schema, table) ? ' [테이블 있음]' : ''));
        tables.add(table);
    }

    // 지금 알고 있는 상태. 줄면 이 두 수를 같이 내린다.
    //
    // 타입 수와 테이블 수가 다른 것은 hd_*(91~98) 여덟이 전부 fcnt 를 쓰기
    // 때문이다 — fcnt 하나를 추가하면 아홉 타입이 한꺼번에 열린다.
    const KNOWN_TYPES = 16;
    const KNOWN_TABLES = 8;

    assert.ok(missing.length <= KNOWN_TYPES,
        'SQLite 미지원 타입이 늘었다 (' + missing.length + ' > ' + KNOWN_TYPES + '): ' +
        missing.join(', '));

    if (missing.length < KNOWN_TYPES) {
        assert.fail('진척이다 — SQLite 미지원이 타입 ' + missing.length + '개 / 테이블 ' +
            tables.size + '개로 줄었다. KNOWN_TYPES 를 ' + missing.length +
            ', KNOWN_TABLES 를 ' + tables.size + ' 로 내려라.\n  남은 타입: ' +
            missing.join(', ') + '\n  남은 테이블: ' + [...tables].sort().join(', '));
    }
    assert.strictEqual(tables.size, KNOWN_TABLES,
        '추가해야 할 테이블 수가 ' + tables.size + ' 다 (알고 있던 값 ' + KNOWN_TABLES + '): ' +
        [...tables].sort().join(', '));
});
