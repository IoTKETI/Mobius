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
// 경로는 어댑터가 밝힌다 — 여기서 디렉터리를 붙이지 않는다.
// 붙이면 스키마 파일을 옮길 때 이 파일도 같이 고쳐야 한다.
const MYSQL_SCHEMA = require('../mobius/db/mysql').schemaPath;
const SQLITE_SCHEMA = require('../mobius/db/sqlite').schemaPath;

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
            a.migration + ' 이 ' + a.index + ' 를 만드는데 ' + MYSQL_SCHEMA + ' 에 없다. ' +
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
            d.migration + ' 이 ' + d.index + ' 를 지우는데 ' + MYSQL_SCHEMA + ' 에 아직 있다. ' +
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

test('식별자·이름 컬럼은 모든 표에서 utf8_bin 을 명시한다 — oneM2M 대로 대소문자를 구분한다', function () {
    // 예전에는 ri 만 bin 이고 pi·sri·spi·rn·aei·cr 은 general_ci 였다. 만드는 것은 구분하는데
    // 찾는 것은 안 가렸다 — 배포 실측(2026-09-06): 대소문자만 다른 형제 컨테이너 51쌍의 자식이
    // `pi = ?` 로 섞이고(8 + 1 = 9), `?rn=` 필터가 대소문자를 안 가리며, SmyAE 가 있으면 SMYAE 가 409.
    // 사용자 결정(2026-09-06): 식별자·이름은 바이트 그대로 비교한다(마이그레이션 018).
    // 새 설치는 이 파일이, 배포는 018 이 맞춘다. 한쪽만 바뀌면 여기서 걸린다.
    const schema = fs.readFileSync(MYSQL_SCHEMA, 'utf8');
    const ID_COLS = new Set(['ri', 'pi', 'sri', 'spi', 'rn', 'lbl', 'acpi', 'aei', 'csi', 'cb', 'cr']);
    const bad = [];
    const blocks = schema.split(/CREATE TABLE `/).slice(1);
    blocks.forEach(function (b) {
        const table = b.slice(0, b.indexOf('`'));
        const body = b.slice(0, b.indexOf('ENGINE=InnoDB'));
        // 파일은 CRLF 다. '\n' 으로만 자르면 줄 끝에 '\r' 이 남고, JS 의 `.` 은 '\r' 을 안 먹어
        // `(.*)$` 가 한 줄도 못 맞힌다 — 검사가 통째로 헛돌았다(변이로 잡았다).
        body.split(/\r?\n/).forEach(function (l) {
            const m = /^\s*`(\w+)` varchar\((\d+)\)(.*)$/.exec(l);
            if (!m || !ID_COLS.has(m[1])) { return; }
            if (!/COLLATE utf8_bin/.test(m[3])) { bad.push(table + '.' + m[1] + ' (' + l.trim() + ')'); }
        });
    });
    assert.deepStrictEqual(bad, [], 'utf8_bin 을 명시하지 않는 식별자 컬럼');

    // rn · sri · spi 는 45 → 200 (구독 이름이 이미 40자, aei 는 ae.aei 의 200 과 맞춘다)
    const lookup = schema.slice(schema.indexOf('CREATE TABLE `lookup`'));
    ['rn', 'sri', 'spi'].forEach(function (c) {
        assert.match(lookup, new RegExp('`' + c + '` varchar\\(200\\)'), 'lookup.' + c + ' 가 200 이 아니다');
    });
    const m = require('../migrations/018-id-columns-collation-bin.js');
    assert.strictEqual(m.id, '018-id-columns-collation-bin');
});
