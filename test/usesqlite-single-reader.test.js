'use strict';
// Executable statement of the completion criterion:
//
//   no file outside mobius/db/ knows which backend is in use.
//
// If the core knows the backend, every backend change requires a core change, and fixing one side lets the two paths diverge silently.
//
// The allow-lists may only shrink: a new file fails, and a listed file whose reader disappears fails too (remove it from the list).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');


// Sites that branch on the backend name. Besides usesqlite there are three more ways the core can know the backend:
//
//   reading global.usedb directly
//   comparing against name literals such as 'mysql' / 'sqlite'
//   using globals carrying a backend name, such as global.use_sqlite_*
//
// The known sites are listed as they are. A site missing from the list fails immediately, and a listed site that disappears fails too (remove it from the list).
const KNOWN_NAME_SITES = {
    // Two sites in mobius/conf_load.js:
    //   the db default in DEFAULT_CONF used when parsing fails
    //   the only place the backend selector is set (select_backend); it is the source, so a name is expected there
    //   the line that plants that value in global.usedb
    // Lengthening the header of conf_load.js shifts all three; that file adds explanations at the bottom.
    'mobius/conf_load.js': [36, 53, 54],

    // The default backend in the conf table: the second place with the same value as DEFAULT_BACKEND in mobius/db/index.js.
    // The line numbers shift whenever that file is edited. A failure of this test is usually the number, not a defect; the failure message gives the new line number.
    'mobius/conf_schema.js': [136]
};

// Sites where the core uses globals carrying a backend name (global.use_sqlite_* etc.).
//
// Empty. The adapter exports its keys through confSchema and reads them itself in applyConf; the core knows only db.applyConf(conf) and no key names.
const KNOWN_BACKEND_GLOBALS = {};

const NAME_LITERAL = /(['"])(mysql|sqlite|postgres|mariadb)\1/i;
const USEDB = /global\.usedb\b/;
const BACKEND_GLOBAL = /global\.use_(sqlite|mysql|postgres)_/;

// `backends: ['mysql']` in migrations is not a defect. That field declares which backend the migration is for, so the name is the value; the runner reads it to filter. Excluded from the predicate.
const BACKENDS_DECL = /^\s*backends\s*:\s*\[/;

function nameSites(rel, re) {
    // The adapters and the facade may know the backend; that is where it belongs.
    if (rel.startsWith('mobius/db/')) { return []; }

    // A migration knowing the name is normal as well: backends: ['mysql'] already declares it, and emitting different DDL per backend is that file's job. What matters is where the name comes from: ctx.backend from the runner is the facade's choice and is fine; reading the global directly is not. So name literals are exempt while the USEDB check below still applies.
    const migration = rel.startsWith('migrations/');
    if (migration && re === NAME_LITERAL) { return []; }

    const out = [];
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }   // comments are not counted
        if (BACKENDS_DECL.test(l)) { return; }
        if (re.test(l)) { out.push(i + 1); }
    });
    return out;
}

// Scope: the root entry points, mobius/, migrations/. mobius.js is excluded from the usesqlite predicate as the place that used to set it; tools/ is not production code (the backend is chosen by argument).
//
// migrations/ is included so a migration reading global.usesqlite is seen.
//
// Only files git tracks are scanned, not the directory: an untracked temporary file on a deployment server (dbq_tmp.js) once counted as core and failed this test there.
function sourceFiles() {
    const tracked = execFileSync('git', ['ls-files', '*.js'],
        { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean);

    const out = tracked.filter(function (f) {
        if (f === 'mobius.js') { return false; }
        if (f.indexOf('/') < 0) { return true; }                 // root entry points
        return f.indexOf('mobius/') === 0 || f.indexOf('migrations/') === 0;
    });

    // If git returns nothing the whole check is void.
    assert.ok(out.length > 20,
        '코어 파일을 ' + out.length + '개만 찾았다 — git ls-files 가 안 먹는다');
    return out;
}

// Comment lines are not counted; only code that reads is a reader.
function readsUsesqlite(rel) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    return lines.some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /global\.usesqlite/.test(l));
}

test('global.usesqlite 전역은 아무도 읽지 않는다 — 목표 달성', function () {
    // The criterion is 0, not 'at most one': the facade's fallback is gone as well, and 'at most one' would not catch a revival.
    const actual = sourceFiles().filter(readsUsesqlite).sort();

    assert.deepStrictEqual(actual, [],
        'global.usesqlite 전역이 되살아났다: ' + actual.join(', ') + '\n' +
        'boolean 은 백엔드를 둘까지만 말할 수 있다 — 셋째가 붙으면 무용지물이\n' +
        '아니라 틀린 답을 낸다(usesqlite=false 가 mysql 을 뜻하게 되어 있었다).\n' +
        '백엔드를 물어야 하면 global.usedb 를 세우거나 db.backendName() 을 받아라.');
});

test('전역을 세우는 곳도 없다 — 읽는 이가 없으면 세우는 이도 없어야 한다', function () {
    // A value that is set but never read is dead, and a dead value invites the next reader to use it for backend questions.
    const writers = [];
    const scan = sourceFiles().concat(['mobius.js', 'tools/migrate.js']);
    for (const rel of scan) {
        fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            if (/global\.usesqlite\s*=/.test(l)) { writers.push(rel + ':' + (i + 1)); }
        });
    }
    assert.deepStrictEqual(writers, [],
        'global.usesqlite 를 세우는 곳이 있다: ' + writers.join(', '));
});

test('conf.json 의 usesqlite 키도 아무도 읽지 않는다', function () {
    // No translation from the old conf key is kept. Keeping one leaves two conf keys alive indefinitely, since new code copies what still works. The db key replaces it completely; a conf.json with the old key hits 'unknown key' instead of passing silently.
    const bad = [];
    const scan = sourceFiles().concat(['mobius.js', 'tools/migrate.js']);

    for (const rel of scan) {
        fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            if (/conf\.usesqlite/.test(l)) { bad.push(rel + ':' + (i + 1)); }
        });
    }

    assert.deepStrictEqual(bad, [],
        'conf.usesqlite 를 읽는 코드가 되살아났다: ' + bad.join(', ') + '\n' +
        '선택자는 conf.json 의 db 키 하나다.');
});

test('백엔드 이름으로 갈라지는 자리는 알려진 것뿐이다', function () {
    // mobius.js is included. A blanket exemption as 'the place that sets usesqlite' once covered the three use_sqlite_* lines as well. Exemptions are given narrowly, per predicate.
    const scan = sourceFiles().concat(['mobius.js']);
    const bad = [];

    for (const rel of scan) {
        const known = KNOWN_NAME_SITES[rel] || [];
        const hits = nameSites(rel, NAME_LITERAL).concat(nameSites(rel, USEDB))
            .filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b);

        for (const line of hits) {
            if (known.indexOf(line) < 0) { bad.push(rel + ':' + line); }
        }
        for (const line of known) {
            if (hits.indexOf(line) < 0) {
                bad.push(rel + ':' + line + ' (목록이 낡았다 — 고쳤으면 목록에서 지워라)');
            }
        }
    }

    assert.deepStrictEqual(bad, [],
        '코어가 백엔드 이름으로 갈라진다. 동작을 가르는 판단이면 db.can() 으로 묻고,\n' +
        '이름 자체가 데이터인 자리면 db.backendName() 으로 파사드가 고른 것을 받아라.\n' +
        '아직 고칠 수 없는 자리면 KNOWN_NAME_SITES 에 이유와 함께 적어라:\n  ' +
        bad.join('\n  '));
});

test('백엔드 이름이 붙은 전역을 쓰는 자리도 알려진 것뿐이다', function () {
    const scan = sourceFiles().concat(['mobius.js']);
    const bad = [];

    for (const rel of scan) {
        const known = KNOWN_BACKEND_GLOBALS[rel] || [];
        const hits = nameSites(rel, BACKEND_GLOBAL);

        for (const line of hits) {
            if (known.indexOf(line) < 0) { bad.push(rel + ':' + line); }
        }
        for (const line of known) {
            if (hits.indexOf(line) < 0) {
                bad.push(rel + ':' + line + ' (목록이 낡았다 — 고쳤으면 목록에서 지워라)');
            }
        }
    }

    assert.deepStrictEqual(bad, [],
        '코어가 백엔드 이름이 붙은 전역을 쓴다. 튜닝 값은 어댑터가 갖고,\n' +
        '설정 표는 어댑터가 내보낸 항목을 모으는 쪽이 맞다:\n  ' + bad.join('\n  '));
});

test('코어는 백엔드 능력을 묻지 않는다', function () {
    // The core asks neither for names nor for capabilities. The facade has 'the function that does the job' and the adapter implements it its own way. A capability boolean says only 'can' and not 'how', and once db_bootstrap built SET PERSIST behind can('serverTuning'), a second capable backend would have received MySQL statements.
    const bad = [];
    for (const rel of sourceFiles()) {
        if (rel.startsWith('mobius/db/')) { continue; }   // the facade and adapters may know
        fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            if (/\.can\(\s*['"]/.test(l)) { bad.push(rel + ':' + (i + 1)); }
        });
    }

    assert.deepStrictEqual(bad, [],
        '코어가 백엔드 능력을 물어 갈라진다: ' + bad.join(', ') + '\n' +
        '파사드에 그 일을 해 주는 함수를 만들고 어댑터가 구현하게 해라.\n' +
        '예: can(\'rowLock\') -> lockRow(qb), can(\'serverTuning\') -> ensureConnectionCeiling(n, conn, cb)');
});

test('코어는 드라이버 어휘를 모른다', function () {
    // Removing capability queries is not enough while the vocabulary remains: discovery once inspected errno 3024 / 1176 directly, and one of the names (ER_MAX_EXECUTION_TIME_EXCEEDED) does not exist in the driver.
    //
    // The pattern is narrow. ER_[A-Z_]+ alone would match oneM2M response code names (INTERNAL_SERVER_ERROR, MAX_NUMBER_OF_MEMBER_EXCEEDED).
    const FORBIDDEN = [
        [/\.errno\b/, 'MySQL errno 를 직접 본다 — db/errors 의 술어를 써라'],
        [/\.sqlMessage\b/, 'node-mysql 전용 필드를 읽는다 — db_errors.text() 를 써라'],
        [/['"]ER_[A-Z_]+['"]/, '드라이버 에러 이름을 직접 견준다 — 중립 코드를 써라'],
        [/\/\*\+/, '옵티마이저 힌트 표기를 직접 만든다 — db.optimizerHints() 를 써라'],
        [/\.hintComment\(/, '힌트를 직접 붙인다 — db.withStatementTimeout() 을 써라']
    ];

    const bad = [];
    for (const rel of sourceFiles()) {
        // The adapter must know; that is where the vocabulary is translated.
        if (rel.startsWith('mobius/db/')) { continue; }

        // A migration declares its backend itself (backends: ['mysql']). Using that backend's vocabulary is of the same nature as using its name and is normal: the lock retries (ER_LOCK_WAIT_TIMEOUT) in 002/003/008 and the SET PERSIST diagnostics in 010. nameSites above exempts name literals for the same reason.
        if (rel.startsWith('migrations/')) { continue; }

        fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((l, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return; }
            for (const [re, why] of FORBIDDEN) {
                if (re.test(l)) { bad.push(rel + ':' + (i + 1) + ' — ' + why); }
            }
        });
    }

    assert.deepStrictEqual(bad, [],
        '코어가 드라이버 어휘를 안다:\n  ' + bad.join('\n  '));
});

test('선언된 능력은 누군가 실제로 묻는다', function () {
    // A declared capability must have a consumer; serverTuning was declared and never asked for, and the gap was filled with a backend name comparison. The consumer is the facade, not the core: the check above blocks the core, so a new capability must be used inside a facade absorption function.
    const mysql = require('../mobius/db/mysql');
    const sqlite = require('../mobius/db/sqlite');
    const declared = new Set(Object.keys(mysql.capabilities)
        .concat(Object.keys(sqlite.capabilities)));

    const scan = sourceFiles().concat(['mobius.js']);
    const asked = new Set();
    for (const rel of scan) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        let m;
        const re = /\.can\(\s*['"]([a-zA-Z]+)['"]\s*\)/g;
        while ((m = re.exec(code)) !== null) { asked.add(m[1]); }
        // Use inside the facade itself counts as consumption (statementTimeoutHint etc.).
        for (const cap of declared) {
            if (new RegExp('capabilities\\.' + cap + '\\b').test(code)) { asked.add(cap); }
        }
    }
    // The facade is outside the scan scope and is read separately.
    const facade = fs.readFileSync(path.join(ROOT, 'mobius/db/index.js'), 'utf8');
    for (const cap of declared) {
        if (new RegExp('capabilities\\.' + cap + '\\b').test(facade)) { asked.add(cap); }
    }

    const orphan = [...declared].filter((c) => !asked.has(c)).sort();
    assert.deepStrictEqual(orphan, [],
        '어댑터가 선언했는데 아무도 묻지 않는 능력이 있다: ' + orphan.join(', ') +
        '\n선언만 있고 소비자가 없으면, 그 판단이 다른 곳에서 백엔드 이름 비교로 채워진다.');
});

test('파사드가 백엔드를 고르는 방법은 이름 하나뿐이다', function () {
    // The facade no longer reads usesqlite either, so the criterion is not what is read but whether there is a single selection path.
    const src = fs.readFileSync(path.join(ROOT, 'mobius/db/index.js'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    assert.match(code, /global\.usedb/,
        '파사드가 이름으로 백엔드를 고르지 않는다');
    assert.ok(!/global\.usesqlite/.test(code),
        '파사드에 boolean 폴백이 되살아났다 — 선택 경로가 둘이면 갈린다');

    // An unknown name falls back to the default. A typo must not block startup.
    assert.match(code, /DEFAULT_BACKEND/,
        '모르는 이름일 때의 기본값이 없다');
});

test('can() 은 connect() 전에도 던지지 않는다', function () {
    // check_db_support is a synchronous gate on every CREATE. A throw here would surface inside the db.getConnection callback, kill the worker and leak the borrowed connection. (app.js swallows facade connect failures and continues starting.)
    delete require.cache[require.resolve('../mobius/db')];
    delete require.cache[require.resolve('../mobius/db/mysql')];
    delete require.cache[require.resolve('../mobius/db/sqlite')];

    const saved = global.usedb;
    try {
        for (const [backend, limited] of [['sqlite', true], ['mysql', false]]) {
            delete require.cache[require.resolve('../mobius/db')];
            global.usedb = backend;
            const db = require('../mobius/db');
            const allowed = db.supportedResourceTypes();
            if (limited) {
                assert.ok(Array.isArray(allowed),
                    backend + ' 이 지원 타입 목록을 안 준다');
            }
            else {
                assert.strictEqual(allowed, null,
                    backend + ' 이 제한을 선언했다 — null 이어야 한다');
            }
            assert.strictEqual(db.can('없는_능력'), false, '없는 키는 false 여야 한다');
        }
    } finally {
        if (saved === undefined) { delete global.usedb; } else { global.usedb = saved; }
        delete require.cache[require.resolve('../mobius/db')];
    }
});

test('501 게이트는 fail-open 이다 — 제한을 선언한 백엔드만 거른다', function () {
    // Inverted polarity would send normal CREATEs out as 501. 'Not a list' means no restriction: mysql writes null, and an adapter that omits the value is the same.
    const mysql = require('../mobius/db/mysql');
    const sqlite = require('../mobius/db/sqlite');
    assert.strictEqual(mysql.supportedResourceTypes, null,
        'mysql 이 지원 타입 목록을 선언했다 — 제한 없음은 null 이다');
    assert.ok(Array.isArray(sqlite.supportedResourceTypes),
        'sqlite 가 지원 타입 목록을 선언하지 않았다');

    // An adapter without the value at all must be fail-open as well.
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
    // SQLITE_SUPPORTED_TY must not exist in resource.js: a backend name in the core would require a core change whenever another backend supports a different subset. Comments are excluded, since they quote the old name.
    const src = fs.readFileSync(path.join(ROOT, 'mobius/resource.js'), 'utf8');
    const core = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    assert.strictEqual(/SQLITE_SUPPORTED_TY/.test(core), false,
        'resource.js 에 SQLITE_SUPPORTED_TY 가 되살아났다 — 목록은 어댑터가 갖는다');
    assert.strictEqual(/\b(SQLITE|MYSQL|POSTGRES)_[A-Z_]+\s*=/.test(core), false,
        'resource.js 에 백엔드 이름이 붙은 상수가 있다');
});

test('501 게이트는 타입별 빌더보다 먼저 선다', function () {
    // The gate inside create_action alone is too late. The per-type builders under build_resource (build_grp etc.) hit the DB first, and that failure comes out as 500 'database error' (build_grp -> update_route -> `select * from csr`, a table SQLite lacks).
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
    // Compares the list an adapter declares with that adapter's schema file. A listed type without a table breaks CREATE with 500 instead of 501.
    const responder = require('../mobius/responder');
    const dir = path.join(ROOT, 'mobius', 'db');

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js') || f === 'index.js' || f === 'errors.js') { continue; }
        const adapter = require(path.join(dir, f));
        const list = adapter.supportedResourceTypes;
        if (!Array.isArray(list)) { continue; }   // no restriction

        const schema = fs.readFileSync(adapter.schemaPath, 'utf8');
        for (const ty of list) {
            const table = responder.typeRsrc[ty];
            assert.ok(table, adapter.name + ': ty=' + ty + ' 가 typeRsrc 에 없다');
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + table + '`?\\s*\\(', 'i');
            assert.ok(re.test(schema),
                adapter.name + ': ty=' + ty + '(' + table + ') 가 지원 목록에 있는데 ' +
                adapter.schemaPath + ' 에 테이블이 없다');
        }
    }
});

// ty -> body table name.
//
// responder.typeRsrc gives the root name, not the table. Mostly the same (ae -> ae, cnt -> cnt), with exceptions:
//   hd_* (91..98)  all use the fcnt table (see BODY_TABLES in sql_action)
//   rsp (99)       a response envelope, not a resource: no table
//   mgo (13)       abstract type shared by fwr/bat/dvi/dvc/rbo
function bodyTable(ty, rootnm) {
    if (Number(ty) >= 91 && Number(ty) <= 98) { return 'fcnt'; }
    if (String(ty) === '99') { return null; }
    return rootnm;
}

test('제한 없는 백엔드는 스키마에 모든 타입의 테이블이 있다', function () {
    // No declared restriction means 'accepts everything'. If the schema lacks a table, CREATE breaks with 500 rather than being refused with 501 (SQLite's grp did that: absent from the list, so 501 would be right, but the late gate let the csr query run first).
    const responder = require('../mobius/responder');
    const dir = path.join(ROOT, 'mobius', 'db');

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js') || f === 'index.js' || f === 'errors.js') { continue; }
        const adapter = require(path.join(dir, f));
        if (Array.isArray(adapter.supportedResourceTypes)) { continue; }   // restricted

        const schema = fs.readFileSync(adapter.schemaPath, 'utf8');
        const missing = [];
        // Taken from responder.typeRsrc. global.ty_list is set by app.js, which this test does not load, so it would always be empty and the test would check nothing.
        for (const ty of Object.keys(responder.typeRsrc)) {
            const table = bodyTable(ty, responder.typeRsrc[ty]);
            if (!table) { continue; }   // abstract types (mgo etc.) have no body table
            const re = new RegExp('CREATE TABLE (IF NOT EXISTS )?`?' + table + '`?\\s*\\(', 'i');
            if (!re.test(schema)) { missing.push(ty + '(' + table + ')'); }
        }
        assert.deepStrictEqual(missing, [],
            adapter.name + ' 이 제한을 선언하지 않았는데 ' + adapter.schemaPath +
            ' 에 테이블이 없는 타입이 있다: ' + missing.join(', '));
    }
});

test('SQLite 가 MySQL 과 같아지기까지 남은 타입을 센다', function () {
    // The SQLite backend is meant to accept the same types as MySQL; the current subset is a transitional state.
    //
    // This test does not block; it shows what remains. A shrinking list is progress, and at 0 sqlite's supportedResourceTypes becomes null (the 'unrestricted backend' test above then checks the schema).
    const responder = require('../mobius/responder');
    const sqlite = require('../mobius/db/sqlite');
    const schema = fs.readFileSync(sqlite.schemaPath, 'utf8');
    const mysqlSchema = fs.readFileSync(require('../mobius/db/mysql').schemaPath, 'utf8');

    const has = (s, t) =>
        new RegExp('CREATE TABLE (IF NOT EXISTS )?\`?' + t + '\`?\\s*\\(', 'i').test(s);

    // The type list comes from responder.typeRsrc. global.ty_list is set by app.js, which this test does not load, so it would be empty and report a false '0 remaining'.
    const missing = [];
    const tables = new Set();
    for (const ty of Object.keys(responder.typeRsrc)) {
        if (sqlite.supportedResourceTypes.indexOf(String(ty)) >= 0) { continue; }
        const table = bodyTable(ty, responder.typeRsrc[ty]);
        if (!table) { continue; }                    // not a resource (response envelope etc.)
        if (!has(mysqlSchema, table)) { continue; }  // absent from MySQL as well: not a target
        missing.push(ty + '(' + table + ')' + (has(schema, table) ? ' [테이블 있음]' : ''));
        tables.add(table);
    }

    // The currently known state. Lower both numbers together as the list shrinks.
    //
    // The type count and table count differ because the eight hd_* (91..98) all use fcnt; adding fcnt opens nine types at once.
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
