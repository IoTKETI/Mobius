'use strict';
// Adapter contract. Lists what the facade requires from every backend adapter, so a new backend (mobius/db/<name>.js) can be checked against it.
//
// Everything here is verified without a live connection. Connection-dependent behaviour (execute/begin/commit/rollback) is covered by the equivalence harness (tools/equivalence).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Discovers every adapter in the directory rather than listing them by hand, so a new adapter file is checked automatically.
const ADAPTERS = (function () {
    const dir = path.join(ROOT, 'mobius', 'db');
    const out = {};
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js')) { continue; }
        const name = f.replace(/\.js$/, '');
        if (name === 'index' || name === 'errors') { continue; }
        out[name] = require(path.join(dir, name));
    }
    return out;
})();

// Everything the facade (mobius/db/index.js) calls as adapter.<name>. The 'list matches what the facade actually uses' test below re-derives this from source.
const REQUIRED_FUNCTIONS = [
    'connect', 'getConnection', 'release',
    'execute', 'normalizeError', 'normalizeResult',
    'begin', 'commit', 'rollback',
    'statementTimeoutHint', 'pathCollate', 'riCollate', 'indexHint',
    'noHashJoinHint', 'notCinPredicate', 'notCinIndexName', 'numericExpr',

    // Raises the server's concurrent-connection ceiling to at least N. Backends without that concept still expose the function (sqlite is a no-op that reports so in its result).
    'ensureConnectionCeiling',

    // Wraps hint fragments into the block placed after SELECT. The wrapper syntax (`/*+ */`) is dialect-specific. Backends without hints return an empty string.
    'optimizerHintBlock',

    // Receives the conf the core has read. The adapter decides which keys it looks at.
    'applyConf'
];

// supportedResourceTypes: resource types this backend accepts, or null (no restriction). The facade treats undefined as null (the 501 gate is fail-open).
// confSchema: the table of conf.json keys this backend reads as its own. mobius/conf_schema.js merges only the selected backend's table. Empty object when none.
// schemaPath: the install schema file for this backend. Absolute path, next to the adapter.
const REQUIRED_VALUES = ['name', 'knexClient', 'capabilities', 'supportedResourceTypes',
    'confSchema', 'schemaPath'];

// Capabilities the facade asks for with db.can(...). Adapters list only what they support; can() returns false for unknown keys.
const KNOWN_CAPABILITIES = [
    'transaction',           // begin/commit/rollback are real
    'rowLock',               // SELECT ... FOR UPDATE is available
    'statementTimeout',      // A single statement can be given a time limit
    'limitedResourceTypes'   // Only some resource types are accepted (absent = no restriction)

];

for (const [name, a] of Object.entries(ADAPTERS)) {
    test(name + ': 파사드가 부르는 함수를 전부 갖췄다', function () {
        const missing = REQUIRED_FUNCTIONS.filter((f) => typeof a[f] !== 'function');
        assert.deepStrictEqual(missing, [],
            name + ' 어댑터에 없는 함수: ' + missing.join(', '));
    });

    test(name + ': 이름과 방언을 밝힌다', function () {
        for (const v of REQUIRED_VALUES) {
            assert.ok(a[v] !== undefined, name + ' 어댑터에 ' + v + ' 가 없다');
        }
        assert.strictEqual(typeof a.name, 'string');
        assert.strictEqual(a.name, name, 'exports.name 이 파일 이름과 다르다');
        assert.strictEqual(typeof a.knexClient, 'string');
        assert.ok(a.knexClient.length > 0, 'knexClient 가 비었다 — knex 가 방언을 못 고른다');
    });

    test(name + ': confSchema 에 실은 키를 자기 소스에서 실제로 읽는다', function () {
        // A key listed in confSchema must actually be read by the adapter, otherwise the console shows an input with no effect. The core side is covered by test/conf-schema.test.js, which accepts adapter keys on declaration alone; this test closes that gap.
        const src = fs.readFileSync(path.join(ROOT, 'mobius', 'db', name + '.js'), 'utf8')
            // Comments must not satisfy the check, so they are stripped first.
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        const unread = Object.keys(a.confSchema || {}).filter(function (k) {
            // The confSchema declaration itself (`  key: {`) does not count as a read. There must be a conf.<key> access.
            return src.indexOf('conf.' + k) < 0;
        });

        assert.deepStrictEqual(unread, [],
            name + ' 어댑터가 confSchema 에 실었는데 conf.<키> 로 안 읽는 키: ' +
            unread.join(', ') +
            '\n표에 실으면 콘솔에 입력칸이 생긴다 — 안 읽으면 아무 효과 없는 칸이다.');
    });

    test(name + ': capabilities 는 아는 키만 true/false 로 적는다', function () {
        assert.strictEqual(typeof a.capabilities, 'object');
        assert.ok(a.capabilities !== null);
        for (const [k, v] of Object.entries(a.capabilities)) {
            assert.ok(KNOWN_CAPABILITIES.indexOf(k) >= 0,
                name + ' 이 모르는 능력 "' + k + '" 을 선언했다 — ' +
                '이 목록과 db.can() 호출부를 함께 늘릴 것');
            assert.strictEqual(typeof v, 'boolean',
                name + '.capabilities.' + k + ' 가 boolean 이 아니다');
        }
    });

    test(name + ': SQL 조각 함수는 연결 없이도 문자열을 준다', function () {
        // These are called while building queries and must answer before a connection exists; the facade calls these five without assertReady.
        assert.strictEqual(typeof a.pathCollate(), 'string');
        assert.strictEqual(typeof a.indexHint('idx_lookup_ty'), 'string');
        assert.strictEqual(typeof a.notCinPredicate('l'), 'string');
        assert.ok(a.notCinPredicate('l').indexOf('l') >= 0,
            'notCinPredicate 가 넘긴 별칭을 안 쓴다');
        assert.strictEqual(typeof a.numericExpr('c.cs'), 'string');

        // Must be a string. The core appends the value directly after 'select ' in the three discovery builders; a null would produce 'select null'.
        assert.strictEqual(typeof a.optimizerHintBlock([]), 'string');
        assert.strictEqual(typeof a.optimizerHintBlock([null, null]), 'string');

        // Must be an empty string when there is nothing to append; a single space would leave a double space in the SQL.
        assert.strictEqual(a.optimizerHintBlock([]), '',
            '붙일 힌트가 없는데 빈 문자열이 아니다');
    });

    test(name + ': 없는 능력은 null 로 답한다 (빈 문자열이 아니라)', function () {
        // The two values the caller uses to tell 'nothing to append' apart.
        const hint = a.statementTimeoutHint(5000);
        if (a.capabilities.statementTimeout) {
            assert.strictEqual(typeof hint, 'string');
            assert.ok(hint.length > 0);
        } else {
            assert.strictEqual(hint, null,
                'statementTimeout 이 없으면 힌트는 null 이어야 한다');
        }

        const nhj = a.noHashJoinHint(['l', 's']);
        assert.ok(nhj === null || typeof nhj === 'string');

        const idx = a.notCinIndexName();
        assert.ok(idx === null || typeof idx === 'string');
    });

    test(name + ': normalizeError 는 code 와 message 를 가진 객체를 준다', function () {
        const e = a.normalizeError(new Error('boom'));
        assert.ok(e && typeof e === 'object', 'normalizeError 가 객체를 안 준다');
        assert.ok('message' in e, 'normalizeError 결과에 message 가 없다');
        // The facade callback contract is cb(true, err), so callers read err.message.
        assert.strictEqual(typeof e.message, 'string');
    });

    test(name + ': 스키마 파일을 밝히고 그 파일이 실제로 있다', function () {
        assert.strictEqual(typeof a.schemaPath, 'string');
        assert.ok(fs.existsSync(a.schemaPath), a.schemaPath + ' 이 없다');
    });

    test(name + ': 스키마 경로가 절대경로이고 어댑터 옆에 있다', function () {
        // A bare filename would make every reader prepend its own directory; the path must be absolute.
        assert.ok(path.isAbsolute(a.schemaPath),
            name + ' 의 schemaPath 가 절대경로가 아니다: ' + a.schemaPath);

        // Must live in the same directory as the adapter, not in the core directory.
        assert.strictEqual(path.dirname(a.schemaPath), path.join(ROOT, 'mobius', 'db'),
            name + ' 의 스키마가 어댑터 디렉터리 밖에 있다: ' + a.schemaPath);
    });
}

test('스키마 .sql 은 mobius/db/ 밖에 없다', function () {
    // The check above only covers registered adapters. This scans the whole repository so a .sql dropped into the core directory is caught. --others includes untracked files; --exclude-standard keeps .gitignore'd dumps out.
    const files = execFileSync(
        'git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.sql'],
        { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map(s => s.trim()).filter(Boolean);

    assert.ok(files.length > 0, 'git 이 .sql 을 하나도 안 돌려줬다 — 검사가 헛돈다');

    const stray = files.filter(f => path.posix.dirname(f) !== 'mobius/db');
    assert.deepStrictEqual(stray, [],
        '스키마 파일이 mobius/db/ 밖에 있다. 어댑터 옆에 둬라: ' + stray.join(', '));
});

test('어댑터들의 표면이 같다 — 한쪽에만 있는 export 가 없다', function () {
    // All adapters expose the same set of property names. Values may differ per backend; only the name set must match.
    const names = Object.keys(ADAPTERS);
    const base = Object.keys(ADAPTERS[names[0]]).sort();
    for (const n of names.slice(1)) {
        assert.deepStrictEqual(Object.keys(ADAPTERS[n]).sort(), base,
            n + ' 어댑터가 내보내는 것이 ' + names[0] + ' 와 다르다');
    }
});

test('파사드가 디렉터리의 어댑터를 전부 등록한다', function () {
    // Registration comes from the directory listing, not a hand-written list.
    delete require.cache[require.resolve('../mobius/db')];
    const db = require('../mobius/db');
    assert.deepStrictEqual(db.backends(), Object.keys(ADAPTERS).sort(),
        '디렉터리의 어댑터와 파사드가 아는 백엔드가 다르다');
    delete require.cache[require.resolve('../mobius/db')];
});

test('백엔드는 이름으로 고른다 — boolean 이 아니다', function () {
    // The selector is a name (global.usedb), not a boolean, so a third backend can be added as a file.
    const src = fs.readFileSync(path.join(ROOT, 'mobius/db/index.js'), 'utf8');
    assert.ok(/global\.usedb/.test(src), '파사드가 이름으로 백엔드를 고르지 않는다');

    const m = fs.readFileSync(path.join(ROOT, 'mobius', 'conf_load.js'), 'utf8');
    assert.ok(/global\.usedb\s*=/.test(m), 'conf_load.js 가 global.usedb 를 정하지 않는다');

    // global.usesqlite must not exist anywhere, including as a derived alias.
    const mCode = m.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/global\.usesqlite\s*=/.test(mCode),
        'global.usesqlite 별칭이 되살아났다 — 선택자는 이름 하나여야 한다');

    // conf.usesqlite must not be read, translated, or checked for; the selector is the db key alone.
    assert.ok(!/conf\.usesqlite/.test(mCode),
        'conf.usesqlite 를 읽는 코드가 되살아났다 — 선택자는 db 키 하나다');
});

test('모르는 이름은 기동을 막지 않는다', function () {
    // An unknown backend name logs and falls back to the default backend instead of preventing startup.
    const saved = global.usedb;
    delete require.cache[require.resolve('../mobius/db')];
    try {
        global.usedb = '없는디비';
        const db = require('../mobius/db');
        assert.strictEqual(db.can('없는_능력'), false, '모르는 백엔드에서 can() 이 던졌다');
        assert.strictEqual(typeof db.pathCollate(), 'string', '기본 백엔드로 안 떨어졌다');
    } finally {
        global.usedb = saved;
        delete require.cache[require.resolve('../mobius/db')];
    }
});

test('파사드가 실제로 쓰는 것과 위 목록이 일치한다', function () {
    // When the facade starts calling adapter.<new>, this test fails first; then REQUIRED_FUNCTIONS grows and every adapter must provide it.
    const src = fs.readFileSync(path.join(ROOT, 'mobius/db/index.js'), 'utf8');
    const used = new Set();
    const re = /adapter\.([a-zA-Z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) { used.add(m[1]); }

    const declared = new Set(REQUIRED_FUNCTIONS.concat(REQUIRED_VALUES));
    const undeclared = [...used].filter((u) => !declared.has(u)).sort();

    assert.deepStrictEqual(undeclared, [],
        '파사드가 쓰는데 계약 목록에 없다: ' + undeclared.join(', '));
});

test('파사드를 우회하는 길이 아예 없다', function () {
    // The only path to a connection is the facade. db_action.js / db_sqlite.js were the second path and must not return.
    for (const f of ['db_action.js', 'db_sqlite.js']) {
        assert.strictEqual(fs.existsSync(path.join(ROOT, 'mobius', f)), false,
            'mobius/' + f + ' 이 되살아났다');
    }
});

test('새 백엔드를 붙이려면 코어를 몇 군데 고쳐야 하는가', function () {
    // Counts files that obtain a connection by bypassing the facade. The count must only go down.
    const files = [];
    const walk = (rel) => {
        for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
            const r = rel + '/' + e.name;
            if (e.isDirectory()) { walk(r); }
            else if (e.name.endsWith('.js')) { files.push(r); }
        }
    };
    walk('mobius');
    files.push('app.js');

    const bypass = files.filter((f) => {
        if (f.indexOf('mobius/db/') === 0) { return false; }   // the adapters themselves
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
        return lines.some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) &&
            /require\(['"][^'"]*db_(action|sqlite)['"]\)/.test(l));
    }).sort();

    // Current count. Lower it together with the code; raising it fails.
    assert.strictEqual(bypass.length, 0,
        '파사드를 우회해 커넥션을 얻는 파일이 ' + bypass.length + '개다:\n  ' +
        bypass.join('\n  ') + '\n(줄었으면 이 숫자를 내리고, 늘었으면 되돌릴 것)');
});
