'use strict';
// 마이그레이션이 배포 DB 에 추가한 인덱스가 설치용 스키마 파일에도 있는가.
//
// tools/migrate.js 원칙 1 에 따라 마이그레이션은 자동 실행되지 않는다. 그래서
// mobiusdb.sql 에 반영을 빠뜨리면 **신규 설치만 옛 스키마로 생성**되고, 아무도
// 눈치채지 못한 채 배포본과 영구히 갈라진다. 실제로 001 이 그랬다 —
// 배포 서버에는 idx_lookup_pi_ty_ct 가 있는데 mobiusdb.sql 에는 없어서, 오늘
// 새 서버를 세우면 001 이 고친 ct 역스캔 회귀를 그대로 안고 시작할 뻔했다.
// (2026-08-28 발견)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const MYSQL_SCHEMA = path.join(ROOT, 'mobius', 'mobiusdb.sql');
const SQLITE_SCHEMA = path.join(ROOT, 'mobius', 'mobiusdb_sqlite.sql');

// 마이그레이션 소스에서 인덱스를 만들거나(`ADD INDEX <이름> (`)
// 지우는(`DROP INDEX <이름>`) 이름을 뽑는다.
//
// 주의: 주석에 적힌 되돌리기 예시("되돌리려면 ADD INDEX ...")까지 잡히면
// 안 되므로, 주석 줄은 먼저 걷어낸다.
function scanMigrations(re) {
    const found = [];
    fs.readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith('.js'))
        .forEach(function (f) {
            const src = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
                .split('\n')
                .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
                .join('\n');
            let m;
            re.lastIndex = 0;
            while ((m = re.exec(src)) !== null) {
                found.push({ migration: f, index: m[1] });
            }
        });
    return found;
}

function indexesAddedByMigrations() {
    return scanMigrations(/ADD\s+INDEX\s+([A-Za-z0-9_]+)\s*\(/gi);
}

function indexesDroppedByMigrations() {
    return scanMigrations(/DROP\s+INDEX\s+([A-Za-z0-9_]+)/gi);
}

// 이 테스트가 먼저다. 아래 두 대조는 "인덱스 이름이 소스에 리터럴로 있다" 를
// 전제하는데, 그 전제가 깨지면 정규식이 아무것도 못 찾거나 변수 이름을
// 인덱스 이름으로 착각해 **조용히 통과**한다 (2026-08-28 실제로 그랬다).
test('마이그레이션은 인덱스 이름을 리터럴로 쓴다', function () {
    fs.readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith('.js'))
        .forEach(function (f) {
            const src = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
                .split('\n')
                .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
                .join('\n');
            assert.ok(!/(ADD|DROP)\s+INDEX\s*(['"]\s*\+|\$\{)/i.test(src),
                f + ' 가 인덱스 이름을 변수로 이어 붙인다. ' +
                'schema-drift 대조가 빗나가므로 리터럴로 쓸 것.');
        });

    // 그리고 찾아낸 이름이 실제로 인덱스 이름꼴이어야 한다.
    indexesAddedByMigrations().concat(indexesDroppedByMigrations()).forEach(function (d) {
        assert.match(d.index, /^(idx_|PRIMARY$|ri_UNIQUE$)/,
            d.migration + ' 에서 읽어 낸 "' + d.index + '" 는 인덱스 이름 같지 않다 — ' +
            '정규식이 엉뚱한 것을 잡았다.');
    });
});

test('마이그레이션이 만드는 인덱스는 mobiusdb.sql 에도 선언돼 있다', function () {
    const schema = fs.readFileSync(MYSQL_SCHEMA, 'utf8');
    const added = indexesAddedByMigrations();

    assert.ok(added.length > 0,
        'ADD INDEX 를 하는 마이그레이션을 하나도 못 찾았다 — 이 테스트의 정규식이 낡았을 수 있다');

    added.forEach(function (a) {
        assert.ok(schema.indexOf('`' + a.index + '`') !== -1,
            a.migration + ' 이 ' + a.index + ' 를 만드는데 mobius/mobiusdb.sql 에 없다. ' +
            '마이그레이션은 자동 실행되지 않으므로 신규 설치가 이 인덱스 없이 생성된다.');
    });
});

test('마이그레이션이 지우는 인덱스는 mobiusdb.sql 에서도 빠져 있다', function () {
    const schema = fs.readFileSync(MYSQL_SCHEMA, 'utf8');
    const dropped = indexesDroppedByMigrations();

    assert.ok(dropped.length > 0,
        'DROP INDEX 를 하는 마이그레이션을 하나도 못 찾았다 — 이 테스트의 정규식이 낡았을 수 있다');

    dropped.forEach(function (d) {
        assert.strictEqual(schema.indexOf('`' + d.index + '`'), -1,
            d.migration + ' 이 ' + d.index + ' 를 지우는데 mobius/mobiusdb.sql 에 아직 있다. ' +
            '신규 설치가 이 인덱스를 다시 만들어 버린다.');
    });
});

test('001 이 만드는 인덱스는 SQLite 스키마에도 있다', function () {
    // 001 주석이 "SQLite 는 mobiusdb_sqlite.sql 이 이미 만든다" 를 근거로
    // backends 를 mysql 로 한정한다. 그 전제가 유지되는지 확인한다.
    const sqlite = fs.readFileSync(SQLITE_SCHEMA, 'utf8');
    assert.ok(sqlite.indexOf('idx_lookup_pi_ty_ct') !== -1,
        'mobiusdb_sqlite.sql 에 idx_lookup_pi_ty_ct 가 없다 — ' +
        '001 이 backends:[mysql] 로 한정한 근거가 무너진다');
});

test('lookup 의 pi 는 콜레이션을 명시하지 않고 ri 는 utf8_bin 을 명시한다', function () {
    // 이 비대칭이 재귀 CTE(sql_action.js 의 search_parents_lookup_all)에서
    // `l.pi = p.ri` 를 교차 콜레이션 비교로 만든다. 배포 DB 실측으로는
    // 그 경로가 18.9시간에 10회 / 검사행 0 이라 비용이 없어 그대로 두기로
    // 했다 (2026-08-28 판단). 누군가 한쪽만 바꾸면 이 테스트가 알려 준다.
    const schema = fs.readFileSync(MYSQL_SCHEMA, 'utf8');
    const lookup = schema.slice(schema.indexOf('CREATE TABLE `lookup`'));
    const body = lookup.slice(0, lookup.indexOf('ENGINE=InnoDB'));

    const riLine = body.split('\n').find((l) => l.trim().startsWith('`ri`'));
    const piLine = body.split('\n').find((l) => l.trim().startsWith('`pi`'));

    assert.ok(riLine && /COLLATE\s+utf8_bin/.test(riLine),
        'lookup.ri 가 utf8_bin 을 명시하지 않는다: ' + riLine);
    assert.ok(piLine && !/COLLATE/.test(piLine),
        'lookup.pi 에 COLLATE 가 생겼다 — 콜레이션 판단을 다시 해야 한다: ' + piLine);
});
