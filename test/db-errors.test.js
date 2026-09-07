'use strict';
const test = require('node:test');
const assert = require('node:assert');
const errors = require('../mobius/db/errors');

test('isDuplicateKey: 구 경로 어휘(ER_DUP_ENTRY)를 받는다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'ER_DUP_ENTRY' }), true);
});

test('isDuplicateKey: 파사드 어휘(DUPLICATE_KEY)를 받는다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'DUPLICATE_KEY' }), true);
});

test('isDuplicateKey: 다른 코드는 거른다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'ER_BAD_NULL_ERROR' }), false);
    assert.strictEqual(errors.isDuplicateKey({ code: 'NOT_NULL' }), false);
    assert.strictEqual(errors.isDuplicateKey({}), false);
});

test('isDuplicateKey: null/undefined 에 안 터진다', function () {
    assert.strictEqual(errors.isDuplicateKey(null), false);
    assert.strictEqual(errors.isDuplicateKey(undefined), false);
});

test('isAeiDuplicate: 파사드 constraint 힌트를 쓴다 (MySQL 8 접두사 제거 후)', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'aei_UNIQUE' }), true);
});

test('isAeiDuplicate: 파사드 constraint 힌트를 쓴다 (SQLite)', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'aei' }), true);
});

test('isAeiDuplicate: constraint 가 다른 제약이면 false', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'ri_UNIQUE' }), false);
});

test('isAeiDuplicate: 구 경로 MySQL 메시지로 판정한다', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry 'Sxxx' for key 'ae.aei_UNIQUE'"
    }), true);
});

// The legacy SQLite message lacks 'aei_UNIQUE'; the 409-6 classification must still hold.
test('isAeiDuplicate: 구 경로 SQLite 메시지로도 판정한다', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: ae.aei'
    }), true);
});

test('isAeiDuplicate: 다른 제약의 구 경로 메시지는 false', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: lookup.ri'
    }), false);
});

test('isAeiDuplicate: null/undefined/빈 객체에 안 터진다', function () {
    assert.strictEqual(errors.isAeiDuplicate(null), false);
    assert.strictEqual(errors.isAeiDuplicate(undefined), false);
    assert.strictEqual(errors.isAeiDuplicate({}), false);
});

// Core code must not inspect MySQL vocabulary (errno 3024 / 1176, ER_* names) directly.
const mysql = require('../mobius/db/mysql');

test('normalizeError: 문장 타임아웃을 실제 드라이버 이름으로 잡는다', function () {
    // The driver's real name for a statement timeout is ER_QUERY_TIMEOUT (ER_MAX_EXECUTION_TIME_EXCEEDED does not exist in the driver).
    const byName = mysql.normalizeError(
        Object.assign(new Error('Query execution was interrupted'), { code: 'ER_QUERY_TIMEOUT' }));
    assert.strictEqual(byName.code, 'STATEMENT_TIMEOUT');
    assert.ok(errors.isStatementTimeout(byName));

    const byErrno = mysql.normalizeError(
        Object.assign(new Error('Query execution was interrupted'), { errno: 3024 }));
    assert.strictEqual(byErrno.code, 'STATEMENT_TIMEOUT');
    assert.ok(errors.isStatementTimeout(byErrno));

    // The original driver code is preserved for diagnostics.
    assert.strictEqual(byName.driverCode, 'ER_QUERY_TIMEOUT');
});

test('normalizeError: 인덱스 부재를 잡되 constraint 를 달지 않는다', function () {
    // The server message "Key 'idx_...' doesn't exist in table 'lookup'" matches the duplicate-key regex /key '([^']+)'/; an index name must not be attached as if it were a constraint name.
    const e = mysql.normalizeError(Object.assign(
        new Error("Key 'idx_lookup_pi_notcin' doesn't exist in table 'lookup'"),
        { code: 'ER_KEY_DOES_NOT_EXITS', errno: 1176 }));

    assert.strictEqual(e.code, 'MISSING_INDEX');
    assert.ok(errors.isMissingIndex(e));
    assert.strictEqual(e.constraint, null,
        '인덱스 부재에 제약 이름이 달렸다 — 중복키로 오진할 수 있다');
    assert.ok(!errors.isAeiDuplicate(e),
        '인덱스 부재가 aei 중복으로 읽힌다');
});

test('normalizeError: 중복키에는 constraint 를 그대로 단다', function () {
    // Checks that the change above keeps the original behaviour.
    const e = mysql.normalizeError(Object.assign(
        new Error("Duplicate entry 'x' for key 'ae.aei_UNIQUE'"),
        { code: 'ER_DUP_ENTRY', errno: 1062 }));

    assert.strictEqual(e.code, 'DUPLICATE_KEY');
    assert.strictEqual(e.constraint, 'aei_UNIQUE');
    assert.ok(errors.isAeiDuplicate(e));
});

test('text: 드라이버 전용 필드를 코어 대신 여기서 읽는다', function () {
    // The `err.sqlMessage || err.message` priority is driver knowledge and lives here only.
    assert.strictEqual(errors.text({ sqlMessage: 'from driver', message: 'generic' }),
        'from driver');
    assert.strictEqual(errors.text({ message: 'generic' }), 'generic');
    assert.strictEqual(errors.text('이미 문자열'), '이미 문자열');

    // Never throws. The failure path is cb(true, err) and callers pass the second argument through unchanged, so arrays or undefined arrive here.
    assert.strictEqual(errors.text(null), 'null');
    assert.strictEqual(errors.text(undefined), 'undefined');
    assert.strictEqual(typeof errors.text([]), 'string');
    assert.strictEqual(typeof errors.text({}), 'string');

    // An error with an empty message still yields its name. JSON.stringify would give {} because message/stack are non-enumerable.
    assert.strictEqual(errors.text(new Error('')), 'Error');
    assert.strictEqual(errors.text(new TypeError('')), 'TypeError');

    // Does not throw on circular references.
    const cyc = {}; cyc.self = cyc;
    assert.strictEqual(typeof errors.text(cyc), 'string');
});

test('text: 로그를 폭주시키지 않는다', function () {
    // The JSON.stringify fallback is capped so a large object cannot flood the log.
    const big = { rows: [] };
    for (let i = 0; i < 500; i++) { big.rows.push({ ri: 'ri-' + i, con: 'x'.repeat(50) }); }

    const out = errors.text(big);
    assert.ok(out.length < 600, '큰 객체가 잘리지 않았다: ' + out.length + '자');
    assert.ok(/잘림/.test(out), '잘렸다는 표시가 없다');

    // A message is never truncated; driver error bodies are short and are the point.
    const long = new Error('x'.repeat(2000));
    assert.strictEqual(errors.text(long).length, 2000);
});

test('새 술어들은 null 에 안 터진다', function () {
    for (const f of [errors.isStatementTimeout, errors.isMissingIndex]) {
        assert.strictEqual(f(null), false);
        assert.strictEqual(f(undefined), false);
        assert.strictEqual(f({}), false);
        assert.strictEqual(f({ code: 'UNKNOWN' }), false);
    }
});

// SQLite file path: only one module may decide which .db file is opened.
const fs = require('node:fs');
const pathmod = require('node:path');

test('SQLite 파일을 여는 곳은 어댑터 하나뿐이다', function () {
    // Only the adapter opens the SQLite file. The former second handle (db_sqlite.js) is gone.
    const facadeSrc = fs.readFileSync(
        pathmod.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'), 'utf8');

    assert.match(facadeSrc, /process\.env\.MOBIUS_SQLITE_PATH\s*\|\|\s*'\.\/mobius\.db'/,
        'mobius/db/sqlite.js 가 경로 규칙을 벗어났다');

    // mobius/db_sqlite.js must not exist.
    assert.strictEqual(
        fs.existsSync(pathmod.join(__dirname, '..', 'mobius', 'db_sqlite.js')), false,
        'mobius/db_sqlite.js 가 되살아났다 — 같은 파일에 핸들이 둘이 될 수 있다');

    // No core file other than the adapter requires sqlite3.
    const mobiusDir = pathmod.join(__dirname, '..', 'mobius');
    for (const f of fs.readdirSync(mobiusDir)) {
        if (!f.endsWith('.js')) { continue; }
        const src = fs.readFileSync(pathmod.join(mobiusDir, f), 'utf8');
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/require\(['"]sqlite3['"]\)/.test(code),
            'mobius/' + f + ' 이 sqlite3 를 직접 연다 — 여는 곳은 어댑터뿐이어야 한다');
    }
});

// The sqlite3 native addon is loaded only when used.
//
// The facade requires every adapter in the directory. If sqlite.js loaded sqlite3 at the top level, every process of a MySQL deployment would load the native addon without ever using it.

const SQLITE_ADAPTER = pathmod.join(__dirname, '..', 'mobius', 'db', 'sqlite.js');
function adapterCode() {
    return fs.readFileSync(SQLITE_ADAPTER, 'utf8').split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

test('sqlite.js 는 최상단에서 sqlite3 를 적재하지 않는다', function () {
    const code = adapterCode();

    // Only unindented lines are checked, i.e. the top level. `^\s*` would also match the load inside load_driver.
    assert.ok(!/^var\s+\w+\s*=\s*require\(['"]sqlite3['"]\)/m.test(code),
        'sqlite3 를 파일 최상단에서 적재한다 — MySQL 배포도 애드온을 싣게 된다');
    assert.match(code, /function load_driver\(\)/,
        '지연 적재 함수가 없다');

    // The driver is loaded in that one function only; a second require elsewhere defeats the laziness.
    const requires = (code.match(/require\(['"]sqlite3['"]\)/g) || []).length;
    assert.strictEqual(requires, 1,
        'sqlite3 를 ' + requires + '곳에서 적재한다 — load_driver 하나여야 한다');
});

test('MySQL 로 파사드를 로드하면 sqlite3 가 안 실린다', function () {
    const inCache = () => Object.keys(require.cache).filter((k) => /sqlite3/.test(k)).length;
    const wipe = () => {
        for (const p of Object.keys(require.cache)) {
            if (/mobius[\\/]db[\\/]|sqlite3/.test(p)) { delete require.cache[p]; }
        }
    };

    wipe();
    const saved = global.usedb;
    try {
        global.usedb = 'mysql';
        require(pathmod.join(__dirname, '..', 'mobius', 'db'));
        assert.strictEqual(inCache(), 0,
            'MySQL 인데 sqlite3 가 실렸다 — 25개 프로세스가 안 쓰는 애드온을 든다');
    } finally {
        global.usedb = saved;
        wipe();
    }
});

test('verbose 는 기본으로 켜 둔다 — 끄면 스택이 사라진다', function () {
    // With verbose off the error stack collapses to a single line with no JS frames. SQLite is the development backend, so the stack stays on by default; it is switched off only for performance measurement (the tracer creates 3 Errors per query).
    const code = adapterCode();

    assert.match(code, /MOBIUS_SQLITE_VERBOSE/,
        '성능 측정용으로 끌 방법이 없다');
    // Switching off must be explicit. A truthy check would switch it off whenever the variable is merely empty.
    assert.match(code, /MOBIUS_SQLITE_VERBOSE\s*===\s*'0'/,
        "'0' 과 엄격 비교하지 않는다 — 실수로 꺼지면 스택이 조용히 사라진다");
    assert.match(code, /\.verbose\(\)/,
        '기본 경로에서 verbose() 를 안 부른다');
});
