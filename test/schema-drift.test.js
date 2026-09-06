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
    // UNIQUE 도 잡는다 — 019 가 `ADD UNIQUE INDEX` 로 만든다. 빠뜨리면 그 인덱스는 대조 밖이다.
    return scanMigrations(/ADD\s+(?:UNIQUE\s+)?INDEX\s+([A-Za-z0-9_]+)\s*\(/gi);
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

test('019 의 UNIQUE 는 mobiusdb.sql 에 UNIQUE 로 선언돼 있다 — 이름만 맞고 유일성이 빠지면 안 된다', function () {
    const schema = fs.readFileSync(MYSQL_SCHEMA, 'utf8');
    const added = indexesAddedByMigrations().filter((a) => a.index === 'idx_lookup_sri_unique');
    assert.strictEqual(added.length, 1, '019 가 idx_lookup_sri_unique 를 만들어야 한다 (정규식이 UNIQUE 를 못 보면 0)');
    assert.match(schema, /UNIQUE KEY `idx_lookup_sri_unique` \(`sri`\)/);
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

// ── 이력 표 ────────────────────────────────────────────────────────────────
// 새 설치는 스키마 파일만으로 끝나야 한다(사용자 결정 2026-09-06). 파일이 마이그레이션이 만든
// 모양을 이미 담고 있으니 이력(schema_migrations)도 파일이 적는다 — 적지 않으면 012 같은 데이터
// 스위치가 꺼진 채 뜨고(db_bootstrap.readDataSwitches), 기동마다 "적용되지 않은 마이그레이션" 이
// 찍히며, 설치 절차에 `migrate --apply` 가 한 줄 더 붙는다. 실제로 그렇게 적혀 있었다.

const migrate = require('../tools/migrate.js');

// 스키마 파일이 담을 수 없는 마이그레이션 — 서버 설정(SET PERSIST)이라 덤프 밖이다. 첫 기동이
// 대신 하므로 autoApply 여야 한다. 여기 더하는 것은 "덤프가 못 담는다" 가 증명될 때뿐이다.
const NOT_IN_DUMP = ['010-server-durability'];

// 스키마 파일의 schema_migrations INSERT 에 적힌 id. 주석 줄은 먼저 걷는다(id 를 언급한다).
function ledgerIds(file) {
    const src = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
    const ids = new Set();
    const stmt = /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+`?schema_migrations`?[\s\S]*?;/gi;
    let s;
    while ((s = stmt.exec(src)) !== null) {
        const idRe = /'(\d{3}-[a-z0-9-]+)'/g;
        let m;
        while ((m = idRe.exec(s[0])) !== null) { ids.add(m[1]); }
    }
    return Array.from(ids).sort();
}

function migrationIds(backend) {
    return migrate.loadMigrations()
        .filter((m) => !m.backends || m.backends.indexOf(backend) !== -1)
        .map((m) => m.id).sort();
}

// 이력 표 DDL 의 컬럼 — 러너(ensureTable)와 두 스키마 파일이 같은 것을 만들어야 한다
function ledgerColumns(ddl) {
    // 끝에 \b 를 두면 안 된다 — `VARCHAR(160)` 의 `)` 뒤는 단어 경계가 아니라 한 줄도 못 맞힌다
    const re = /`?\b(id|applied_at|duration_ms)`?\s+(VARCHAR\(\d+\)|INTEGER|INT)(?![A-Za-z])/gi;
    const out = []; let m;
    while ((m = re.exec(ddl)) !== null) { out.push(m[1] + ' ' + m[2].toLowerCase().replace('integer', 'int')); }
    return out;
}
function ledgerDdlIn(file) {
    const src = fs.readFileSync(file, 'utf8');
    const m = /CREATE TABLE (?:IF NOT EXISTS )?`?schema_migrations`?\s*\(([\s\S]*?)\)\s*(?:ENGINE|;)/i.exec(src);
    return m ? m[0] : '';
}

test('mobiusdb.sql 은 이력 표에 MySQL 마이그레이션을 전부 적어 둔다 — 새 설치는 import 만으로 끝난다', function () {
    const inDump = ledgerIds(MYSQL_SCHEMA);
    const expected = migrationIds('mysql').filter((id) => NOT_IN_DUMP.indexOf(id) === -1);
    assert.ok(expected.length >= 18, 'MySQL 마이그레이션이 ' + expected.length + '개뿐이다 — loadMigrations 가 낡았을 수 있다');
    assert.deepStrictEqual(inDump, expected,
        'mobiusdb.sql 의 schema_migrations INSERT 와 migrations/ 가 다르다. 마이그레이션을 더했으면 ' +
        '그 모양을 파일에 반영하고 INSERT 에 id 도 더한다(덤프가 못 담는 것이면 NOT_IN_DUMP 에 근거와 함께).');

    // 예외는 첫 기동이 대신 해야 한다 — 아니면 새 설치가 손으로 적용해야 한다
    const all = migrate.loadMigrations();
    NOT_IN_DUMP.forEach(function (id) {
        const m = all.find((x) => x.id === id);
        assert.ok(m, id + ' 가 migrations/ 에 없다 — NOT_IN_DUMP 에서 지운다');
        assert.strictEqual(m.autoApply, true, id + ' 는 덤프에 없는데 autoApply 도 아니다 — 새 설치가 손으로 적용해야 한다');
    });

    // applied_at 은 러너가 적는 꼴(YYYYMMDDTHHmmss)이어야 한다 — 읽는 쪽이 하나다
    const src = fs.readFileSync(MYSQL_SCHEMA, 'utf8');
    const tuples = src.match(/\('\d{3}-[a-z0-9-]+',\s*'[^']*',\s*(?:NULL|\d+)\)/g) || [];
    assert.strictEqual(tuples.length, expected.length, 'INSERT 의 튜플 수가 id 수와 다르다');
    tuples.forEach((t) => assert.match(t, /,\s*'\d{8}T\d{6}',/, t + ' 의 applied_at 이 러너의 꼴이 아니다'));
});

test('mobiusdb_sqlite.sql 은 SQLite 마이그레이션을 조건부로 적어 둔다 — 기동마다 도는 파일이라 이미 된 것만', function () {
    // 조건이 정말 지켜지는지는 test/sqlite-fresh-ledger.test.js 가 실제 파일로 본다
    assert.deepStrictEqual(ledgerIds(SQLITE_SCHEMA), migrationIds('sqlite'),
        'mobiusdb_sqlite.sql 의 schema_migrations INSERT 와 backends 에 sqlite 를 둔 마이그레이션이 다르다');
});

test('이력 표의 DDL 은 세 곳이 같다 — tools/migrate.js · mobiusdb.sql · mobiusdb_sqlite.sql', function () {
    let runner = '';
    migrate.ensureTable({ db: { raw: (s) => s, run: (s, c, cb) => { runner = s; cb(null); } }, conn: null }, function () {});
    const want = ledgerColumns(runner);
    assert.deepStrictEqual(want, ['id varchar(160)', 'applied_at varchar(21)', 'duration_ms int'], '러너의 DDL 을 못 읽었다: ' + runner);
    assert.deepStrictEqual(ledgerColumns(ledgerDdlIn(MYSQL_SCHEMA)), want, 'mobiusdb.sql 의 schema_migrations 컬럼이 러너와 다르다');
    assert.deepStrictEqual(ledgerColumns(ledgerDdlIn(SQLITE_SCHEMA)), want, 'mobiusdb_sqlite.sql 의 schema_migrations 컬럼이 러너와 다르다');
});
