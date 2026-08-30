'use strict';
// 어댑터 계약. **새 백엔드를 붙일 때 무엇을 써야 하는지 알려주는 문서이자 관문이다.**
//
// 이 작업의 목적은 "usesqlite 를 없애는 것" 이 아니라 그 위에 있다 —
// **MySQL·SQLite 말고 다른 DB 를 붙일 때 최소한만 고쳐도 되게 하는 것.**
// 그러려면 코어가 백엔드를 몰라야 하고, 백엔드를 아는 곳은 어댑터 하나여야 한다.
//
// 그 구조가 실제로 서 있는지는 "파사드가 어댑터에게 무엇을 요구하는가" 가
// 한 곳에 적혀 있고 모든 어댑터가 그것을 만족하는지로 확인된다. 이 파일이
// 그 목록이다. mobius/db/postgres.js 를 새로 쓰는 사람은 ADAPTERS 에 한 줄
// 더하고 이 테스트를 돌리면, 무엇이 비었는지 즉시 안다.
//
// 여기 있는 것은 전부 **연결 없이** 확인할 수 있는 것들이다. 연결이 필요한
// 동작(execute/begin/commit/rollback 의 의미)은 등가성 하네스가 본다
// (tools/equivalence).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const ADAPTERS = {
    mysql: require('../mobius/db/mysql'),
    sqlite: require('../mobius/db/sqlite')
};

// 파사드(mobius/db/index.js)가 adapter.<이름> 으로 부르는 것 전부.
// 아래 '파사드가 실제로 쓰는 것과 목록이 일치한다' 테스트가 이 목록을
// 소스에서 다시 뽑아 대조하므로, 파사드가 새 요구를 추가하면 여기서 걸린다.
const REQUIRED_FUNCTIONS = [
    'connect', 'getConnection', 'release',
    'execute', 'normalizeError', 'normalizeResult',
    'begin', 'commit', 'rollback',
    'statementTimeoutHint', 'pathCollate', 'indexHint',
    'noHashJoinHint', 'notCinPredicate', 'notCinIndexName', 'numericExpr'
];

const REQUIRED_VALUES = ['name', 'knexClient', 'capabilities'];

// 파사드가 db.can(...) 으로 묻는 능력. 어댑터는 아는 것만 true 로 적고,
// 모르는 것은 **적지 않는다** — can() 이 없는 키를 false 로 준다.
const KNOWN_CAPABILITIES = [
    'transaction',           // begin/commit/rollback 이 진짜인가
    'rowLock',               // SELECT ... FOR UPDATE 가 되는가
    'statementTimeout',      // 문장 하나에 시간 상한을 걸 수 있는가
    'limitedResourceTypes'   // 일부 리소스 타입만 받는가 (없으면 = 제한 없음)
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
        // 이것들은 질의를 **만드는** 동안 불린다. 연결 전에도 답해야 한다 —
        // 파사드가 이 다섯을 assertReady 없이 부르는 이유다.
        assert.strictEqual(typeof a.pathCollate(), 'string');
        assert.strictEqual(typeof a.indexHint('idx_lookup_ty'), 'string');
        assert.strictEqual(typeof a.notCinPredicate('l'), 'string');
        assert.ok(a.notCinPredicate('l').indexOf('l') >= 0,
            'notCinPredicate 가 넘긴 별칭을 안 쓴다');
        assert.strictEqual(typeof a.numericExpr('c.cs'), 'string');
    });

    test(name + ': 없는 능력은 null 로 답한다 (빈 문자열이 아니라)', function () {
        // 호출부가 "붙일 조각이 없다" 를 구분해야 하는 둘.
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
        // 파사드 콜백 계약이 cb(true, err) 라 호출부가 err.message 를 읽는다.
        assert.strictEqual(typeof e.message, 'string');
    });

    test(name + ': 스키마 파일을 밝히고 그 파일이 실제로 있다', function () {
        assert.strictEqual(typeof a.schemaFile, 'string');
        const p = path.join(ROOT, 'mobius', a.schemaFile);
        assert.ok(fs.existsSync(p), a.schemaFile + ' 이 없다');
    });
}

test('두 어댑터의 표면이 같다 — 한쪽에만 있는 export 가 없다', function () {
    // 표면이 갈리면 코어가 "이 백엔드면 이것도 있다" 를 알아야 한다.
    // 그 순간 코어가 백엔드를 아는 것이고, 목적이 깨진다.
    const keys = (a) => Object.keys(a).sort();
    assert.deepStrictEqual(keys(ADAPTERS.mysql), keys(ADAPTERS.sqlite),
        '두 어댑터가 내보내는 것이 다르다');
});

test('파사드가 실제로 쓰는 것과 위 목록이 일치한다', function () {
    // 파사드에 adapter.새것 이 생기면 이 테스트가 먼저 걸린다.
    // 그러면 REQUIRED_FUNCTIONS 를 늘리고, 모든 어댑터가 그것을 채우게 된다.
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

test('새 백엔드를 붙이려면 코어를 몇 군데 고쳐야 하는가', function () {
    // 목적은 "어댑터 하나만 쓰면 되는 것" 이다. 코어가 백엔드 이름을 알면
    // 그만큼 더 고쳐야 한다. 지금 남은 곳을 세어 둔다 — 줄어들기만 해야 한다.
    //
    // 여기 잡히는 것은 전부 파사드를 **우회**하는 자리다:
    //   db_action.js   MySQL 풀 전용 커넥션 원천 (코어 7개 파일이 여기서 얻는다)
    //   db_sqlite.js   레거시 두 번째 sqlite 핸들
    // 이 둘이 사라지면 새 백엔드는 mobius/db/<이름>.js 하나로 끝난다.
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
        if (f.indexOf('mobius/db/') === 0) { return false; }   // 어댑터 자신
        const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
        return lines.some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) &&
            /require\(['"][^'"]*db_(action|sqlite)['"]\)/.test(l));
    }).sort();

    // 오늘의 수. 줄이면 이 숫자를 함께 내린다. 늘리면 실패한다.
    assert.strictEqual(bypass.length, 8,
        '파사드를 우회해 커넥션을 얻는 파일이 ' + bypass.length + '개다:\n  ' +
        bypass.join('\n  ') + '\n(줄었으면 이 숫자를 내리고, 늘었으면 되돌릴 것)');
});
