'use strict';
// Every index a migration added to the deployed DB must also be in the install schema file.
//
// Migrations are not run automatically, so an index missing from mobiusdb.sql would make new installs start with the old schema and diverge from the deployment permanently.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
// The adapter names the path; no directory is prepended here, so moving the schema file does not require editing this file.
const MYSQL_SCHEMA = require('../mobius/db/mysql').schemaPath;
const SQLITE_SCHEMA = require('../mobius/db/sqlite').schemaPath;

// Extracts index names that migration sources create (`ADD INDEX <name> (`) or drop (`DROP INDEX <name>`).
//
// Comment lines are stripped first so a rollback example in a comment ("to revert, ADD INDEX ...") is not matched.
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
    // UNIQUE is included: 019 uses `ADD UNIQUE INDEX`.
    return scanMigrations(/ADD\s+(?:UNIQUE\s+)?INDEX\s+([A-Za-z0-9_]+)\s*\(/gi);
}

function indexesDroppedByMigrations() {
    return scanMigrations(/DROP\s+INDEX\s+([A-Za-z0-9_]+)/gi);
}

// This test comes first. The two comparisons below assume index names appear as literals in the source; if that assumption breaks, the regex finds nothing or mistakes a variable name for an index name and passes silently.
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

    // And each name found must look like an index name.
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
    // 001 restricts backends to mysql on the grounds that mobiusdb_sqlite.sql already creates the index. That premise is checked.
    const sqlite = fs.readFileSync(SQLITE_SCHEMA, 'utf8');
    assert.ok(sqlite.indexOf('idx_lookup_pi_ty_ct') !== -1,
        'mobiusdb_sqlite.sql 에 idx_lookup_pi_ty_ct 가 없다 — ' +
        '001 이 backends:[mysql] 로 한정한 근거가 무너진다');
});

test('식별자·이름 컬럼은 모든 표에서 utf8_bin 을 명시한다 — oneM2M 대로 대소문자를 구분한다', function () {
    // Identifier and name columns are compared byte for byte (utf8mb3_bin); migration 018 applies it to deployments and this file to new installs. If only one side changes, this catches it.
    const schema = fs.readFileSync(MYSQL_SCHEMA, 'utf8');
    const ID_COLS = new Set(['ri', 'pi', 'sri', 'spi', 'rn', 'lbl', 'acpi', 'aei', 'csi', 'cb', 'cr']);
    const bad = [];
    const blocks = schema.split(/CREATE TABLE `/).slice(1);
    blocks.forEach(function (b) {
        const table = b.slice(0, b.indexOf('`'));
        const body = b.slice(0, b.indexOf('ENGINE=InnoDB'));
        // The file is CRLF. Splitting on '\n' alone leaves '\r' at line ends, and JS `.` does not match '\r', so `(.*)$` would match no line at all.
        body.split(/\r?\n/).forEach(function (l) {
            const m = /^\s*`(\w+)` varchar\((\d+)\)(.*)$/.exec(l);
            if (!m || !ID_COLS.has(m[1])) { return; }
            if (!/COLLATE utf8_bin/.test(m[3])) { bad.push(table + '.' + m[1] + ' (' + l.trim() + ')'); }
        });
    });
    assert.deepStrictEqual(bad, [], 'utf8_bin 을 명시하지 않는 식별자 컬럼');

    // rn, sri and spi are 200 (subscription names already reach 40 characters; aei matches ae.aei's 200).
    const lookup = schema.slice(schema.indexOf('CREATE TABLE `lookup`'));
    ['rn', 'sri', 'spi'].forEach(function (c) {
        assert.match(lookup, new RegExp('`' + c + '` varchar\\(200\\)'), 'lookup.' + c + ' 가 200 이 아니다');
    });
    const m = require('../migrations/018-id-columns-collation-bin.js');
    assert.strictEqual(m.id, '018-id-columns-collation-bin');
});

// History table. A new install is complete with the schema file alone, so the file also fills schema_migrations; otherwise data switches such as 012 start off (db_bootstrap.readDataSwitches), every start reports unapplied migrations, and the install procedure needs an extra `migrate --apply`.

const migrate = require('../tools/migrate.js');

// Migrations the schema file cannot carry: server settings (SET PERSIST) are outside a dump. The first start applies them, so they must be autoApply. Additions here require proof that a dump cannot carry them.
const NOT_IN_DUMP = ['010-server-durability'];

// Ids listed in the schema file's schema_migrations INSERT. Comment lines are stripped first (they mention ids).
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

// Columns of the history table DDL; the runner (ensureTable) and both schema files must create the same set.
function ledgerColumns(ddl) {
    // No trailing \b: after the `)` of `VARCHAR(160)` there is no word boundary and nothing would match.
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

    // The exceptions must be applied by the first start; otherwise a new install has to apply them by hand.
    const all = migrate.loadMigrations();
    NOT_IN_DUMP.forEach(function (id) {
        const m = all.find((x) => x.id === id);
        assert.ok(m, id + ' 가 migrations/ 에 없다 — NOT_IN_DUMP 에서 지운다');
        assert.strictEqual(m.autoApply, true, id + ' 는 덤프에 없는데 autoApply 도 아니다 — 새 설치가 손으로 적용해야 한다');
    });

    // applied_at must be in the runner's format (YYYYMMDDTHHmmss); there is one reader.
    const src = fs.readFileSync(MYSQL_SCHEMA, 'utf8');
    const tuples = src.match(/\('\d{3}-[a-z0-9-]+',\s*'[^']*',\s*(?:NULL|\d+)\)/g) || [];
    assert.strictEqual(tuples.length, expected.length, 'INSERT 의 튜플 수가 id 수와 다르다');
    tuples.forEach((t) => assert.match(t, /,\s*'\d{8}T\d{6}',/, t + ' 의 applied_at 이 러너의 꼴이 아니다'));
});

test('mobiusdb_sqlite.sql 은 SQLite 마이그레이션을 조건부로 적어 둔다 — 기동마다 도는 파일이라 이미 된 것만', function () {
    // Whether the conditions really hold is checked by test/sqlite-fresh-ledger.test.js against real files.
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
