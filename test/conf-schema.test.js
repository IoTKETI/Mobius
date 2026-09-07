'use strict';
// Keeps the configuration table from diverging from the code.
//
// mobius/conf_schema.js is a hand-written table, and hand-written lists drift; the consumer of the table (the admin console) draws that drift on the screen. So the table is compared with what the code actually reads.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const schema = require('../mobius/conf_schema');

// Every key mobius.js reads as conf.<key>; conf.json is a file name and is excluded. Comments are stripped, otherwise prose satisfies the guard.
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Every key read as conf.<key> in a source string; conf.json is a file name and is excluded. Comments are stripped, otherwise prose satisfies the guard.
function keysReadIn(src) {
    const out = new Set();
    const re = /conf\.([a-zA-Z_][\w]*)/g;
    let m;
    const code = stripComments(src);
    while ((m = re.exec(code)) !== null) {
        if (m[1] !== 'json') { out.add(m[1]); }
    }
    return [...out].sort();
}
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// What the core reads (mobius/conf_load.js).
function keysReadByCore() { return keysReadIn(readSrc('mobius/conf_load.js')); }

// Keys the adapter declares as its own; also a reader.
//
// mobius.js alone is not enough: the core passes the whole conf with db.applyConf(conf) and the adapter decides which keys it reads, so dbpass read by the mysql adapter never appears as conf.dbpass in the core source.
//
// Only the selected backend's keys are considered, because the table (schema.all()) carries only those; considering every adapter would break 'the table has everything' from the other side.
//
// Whether an adapter really reads the keys in its table is checked per adapter by test/db-adapter-contract.test.js.
function keysOwnedByAdapter() {
    delete require.cache[require.resolve('../mobius/db')];
    const keys = Object.keys(require('../mobius/db').confSchema() || {});
    delete require.cache[require.resolve('../mobius/db')];
    return keys.sort();
}

// The console's own keys. Only admin/server.js reads them, so neither the core source nor the adapter tables see them; on the table they would be caught by the 'in the table but nobody reads it' check. Added as a third reader. Comment stripping (keysReadIn) applies, so adminOrigin in a comment does not pass.
function keysReadByAdmin() { return keysReadIn(readSrc('admin/server.js')); }

function keysReadBySomeone() {
    return [...new Set(keysReadByCore().concat(keysOwnedByAdapter(), keysReadByAdmin()))].sort();
}

test('표가 코어와 어댑터가 읽는 키를 전부 담는다', function () {
    const read = keysReadBySomeone();
    const known = schema.all();
    const missing = read.filter((k) => known.indexOf(k) < 0);

    assert.deepStrictEqual(missing, [],
        'conf_load.js 가 읽는데 표에 없는 키가 있다: ' + missing.join(', ') +
        '\n' +
        '\n표에 없으면 관리 콘솔이 그 설정의 존재조차 모른다 — 콘솔은 자체 목록을' +
        '\n들지 않고 conf_schema.describe() 를 그대로 쓰므로, 표에 없는 키는' +
        '\n화면에 입력칸이 아예 안 생긴다.' +
        '\n' +
        '\n**conf 키를 추가하는 커밋이 표도 같이 채워야 한다.** 나중으로 미루면' +
        '\n그 사이에 이 테스트가 빨간 채로 남고, 다른 세션의 작업까지 막는다.' +
        '\nmobius/conf_schema.js 에 아래를 채워 넣을 것:' +
        '\n  type / dflt / valid / apply(runtime|reload|restart) / label / help' +
        '\n  화면에 안 띄울 것이면 exposed:false, 비밀이면 secret:true');
});

test('표에만 있고 아무도 안 읽는 키가 없다', function () {
    // The other direction is blocked too: a setting gone from the code but left in the table gives the screen an input field without effect.
    const read = keysReadBySomeone();
    const stale = schema.all().filter((k) => read.indexOf(k) < 0);

    assert.deepStrictEqual(stale, [],
        '표에 있는데 conf_load.js 가 안 읽는 키가 있다: ' + stale.join(', ') +
        '\n코드에서 없어졌으면 표에서도 지울 것');
});

test('모든 항목이 분류를 밝힌다', function () {
    // Classification written on the screen side would be a second table and would drift; it must come from the same place as label, help and valid values.
    for (const k of schema.all()) {
        const g = schema.get(k).group;
        assert.ok(typeof g === 'string' && g.length > 0, k + ' 에 group 이 없다');
    }
});

test('분류 이름이 늘어나는 것은 의도된 선택이어야 한다', function () {
    // A typo in a group name (for example a trailing space) would create a new group and an extra empty box on the screen. When a new group is really added, this list grows with it.
    const KNOWN = ['권한', '요청 처리', '저장소', '네트워크', 'CSE 신원', '접근 제한', '콘솔'];
    const used = [...new Set(schema.all().map((k) => schema.get(k).group))].sort();
    const unknown = used.filter((g) => KNOWN.indexOf(g) < 0);
    assert.deepStrictEqual(unknown, [],
        '모르는 분류가 생겼다: ' + unknown.join(', ') +
        '\n오타가 아니라 정말 새 분류라면 이 테스트의 KNOWN 에도 더할 것');
});

test('모든 항목이 적용 시점을 밝힌다', function () {
    // The most important distinction on the screen: showing 'reload' as 'immediate' makes an administrator believe observe mode is off.
    for (const k of schema.all()) {
        const s = schema.get(k);
        assert.ok(['runtime', 'reload', 'restart'].indexOf(s.apply) >= 0,
            k + ' 의 apply 가 없거나 모르는 값이다: ' + s.apply);
    }
});

test("'reload' 는 무엇을 다시 불러야 하는지 밝힌다", function () {
    // 'reload' means 'changing the global alone does nothing'; without what to call, the information is useless.
    //
    // Checked through describe(), which is what the screen uses; the internal table (_SCHEMA) could carry reloadWith while describe() does not copy it.
    const d = schema.describe();
    for (const [k, v] of Object.entries(d)) {
        if (v.apply !== 'reload') { continue; }
        assert.ok(typeof v.reloadWith === 'string' && v.reloadWith.length > 0,
            k + ' 가 reload 인데 describe() 가 reloadWith 를 안 준다');
    }
    assert.strictEqual(d.acpObserveMode.reloadWith, 'acp_observe.configure');
});

test('describe() 가 소비자에게 필요한 필드를 전부 준다', function () {
    // The only entry point the screen uses; a field only in the internal table is as good as absent.
    const NEED = ['type', 'dflt', 'choices', 'validHint', 'integer', 'group',
                  'apply', 'reloadWith', 'readOnly', 'label', 'help', 'grade', 'gateWarn', 'tier'];
    for (const [k, v] of Object.entries(schema.describe())) {
        for (const f of NEED) {
            assert.ok(f in v, 'describe().' + k + ' 에 ' + f + ' 가 없다');
        }
    }
});

test('acp_observe 계열이 reload 로 분류돼 있다', function () {
    // These three do not read globals. mobius.js passes them at boot with acp_observe.configure(), and the module reads only its own cfg afterwards, so changing the value alone does nothing.
    const observe = fs.readFileSync(path.join(ROOT, 'mobius', 'acp_observe.js'), 'utf8');
    assert.ok(/exports\.configure = function/.test(observe),
        'acp_observe.configure 가 없어졌다 — reload 분류의 근거가 사라졌다');

    for (const k of ['acpObserveMode', 'acpDenyLog', 'acpDenyLogRate']) {
        assert.strictEqual(schema.get(k).apply, 'reload',
            k + ' 는 reload 여야 한다 (global 을 읽지 않는다)');
    }
});

test("'runtime' 로 분류한 것은 코드가 실제로 global 을 읽는다", function () {
    // If the table says 'applies immediately' but the code does not read the global, that is a lie too.
    const readers = {
        acpiAttachPolicy:   ['mobius/resource.js', 'global.acpi_attach_policy'],
        acpAudit:           ['mobius/resource.js', 'global.acp_audit'],
        acpDiscoveryFilter: ['mobius/acp_filter.js', 'global.acp_discovery_filter'],
        defaultAccessPolicy: ['mobius/security.js', 'useaccesscontrolpolicy']
    };
    for (const [key, [file, needle]] of Object.entries(readers)) {
        assert.strictEqual(schema.get(key).apply, 'runtime', key + ' 가 runtime 이 아니다');
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(code.indexOf(needle) >= 0,
            key + ' 를 runtime 이라 했는데 ' + file + ' 이 ' + needle + ' 를 안 읽는다');
    }
});

test('validate 가 노출 대상이 아닌 키를 거절한다', function () {
    // If this function is 'the gate of the configuration save path', it alone must block everything. Without checking exposure, a caller that trusts validate writes a secret key; superUser skips every ACP check, and a console that could write it would be the master key.
    for (const k of ['dbpass', 'superUser']) {
        const r = schema.validate(k, 'x');
        assert.strictEqual(r.ok, false, k + ' 가 통과했다 — 노출 대상이 아닌데 써진다');
        assert.ok(r.reason.length > 0);
    }
    // Exposed keys must pass as before.
    assert.strictEqual(schema.validate('acpObserveMode', 'observe').ok, true);
    // csebaseport is open (gate grade). The former list contained pxyWsPort, which had been removed from the table and passed by accident as an 'unknown key'.
    assert.strictEqual(schema.validate('csebaseport', '7580').ok, true, 'csebaseport 가 닫혀 있다');
    assert.strictEqual(schema.validate('csebaseport', '99999').ok, false, '포트 범위를 안 본다');
});

test('비밀은 노출 목록에 없다', function () {
    for (const k of ['dbpass', 'superUser']) {
        assert.strictEqual(schema.get(k).secret, true, k + ' 가 secret 이 아니다');
        assert.ok(schema.exposed().indexOf(k) < 0, k + ' 가 노출 목록에 있다');
    }
    // describe() must omit secret entries entirely; not even the label may go out.
    const d = JSON.stringify(schema.describe());
    assert.ok(d.indexOf('dbpass') < 0 && d.indexOf('superUser') < 0,
        'describe() 에 비밀 키 이름이 들어 있다');
});

test('db 는 노출하고, 유효값을 어댑터에서 받는다', function () {
    // Explicitly requested by the user; and hard-coded valid values would not follow when an adapter is added.
    assert.ok(schema.exposed().indexOf('db') >= 0, 'db 가 노출 목록에 없다');
    assert.strictEqual(schema.get('db').apply, 'restart');

    const facade = require('../mobius/db');
    assert.deepStrictEqual(schema.choices('db'), facade.backends(),
        'db 의 유효값이 파사드의 백엔드 목록과 다르다 — 하드코딩했는지 확인할 것');
});

test('usesqlite 는 표에서 사라졌다 — 되살아나면 안 된다', function () {
    // usesqlite must not return to the table: the admin console would treat it as a known setting, and a boolean can only name two backends; the db key replaces it.
    assert.strictEqual(schema.get('usesqlite'), null,
        'usesqlite 가 설정 표에 되살아났다 — 선택자는 db 키 하나다');
    assert.ok(schema.all().indexOf('usesqlite') < 0);

    // An unknown key, so saving is blocked too; a value must not be pushed in under the old name.
    const r = schema.validate('usesqlite', 'true');
    assert.strictEqual(r.ok, false);
});

test('validate 는 던지지 않고 이유를 돌려준다', function () {
    // A function on the configuration save path; a throw here gives the screen a 500 without a reason.
    const cases = [
        ['acpObserveMode', 'observe', true],
        ['acpObserveMode', 'on', false],
        ['acpObserveMode', 123, false],
        ['acpDenyLogRate', 5, true],
        ['acpDenyLogRate', -1, false],
        ['acpDenyLogRate', '5', false],
        ['outboundTimeoutMs', 0, true],
        ['outboundTimeoutMs', 3000, true],
        ['outboundTimeoutMs', 2999, false],   // lowering it records normal notifications as failures
        ['retentionPolicies', [], false],     // read-only
        ['acpDenyLogRate', 1.5, false],       // must be an integer
        ['없는키', 'x', false]
    ];
    for (const [k, v, want] of cases) {
        const r = schema.validate(k, v);
        assert.strictEqual(r.ok, want,
            k + ' = ' + JSON.stringify(v) + ' 가 ' + (want ? '통과' : '거절') +
            ' 여야 하는데 반대다 (' + r.reason + ')');
        if (!r.ok) { assert.ok(r.reason.length > 0, k + ' 의 거절 이유가 비었다'); }
    }
});

test('파싱 실패가 conf.json 을 덮어쓰지 않는다', function () {
    // One try that caught 'missing' and 'broken' together used to overwrite the file with three defaults either way, so one parse failure wiped the production configuration. The path is real: every worker reads the file at boot, and a worker respawned by the cluster may read a half-written JSON while someone writes conf.json in place.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'conf_load.js'), 'utf8');

    // 'Missing' and 'broken' are told apart; the file is created only when missing.
    assert.ok(/existsSync\(file\)/.test(src),
        '파일 존재 여부를 안 가른다 — "없음" 과 "깨짐" 을 같이 잡으면 안 된다');

    // Nothing may be written inside the parse-failure catch.
    const at = src.indexOf("JSON.parse(fs.readFileSync(file, 'utf8'))");
    assert.ok(at > 0, 'conf.json 파싱 지점을 못 찾았다');
    const after = src.slice(at, at + 900);
    const catchAt = after.indexOf('catch (e) {');
    assert.ok(catchAt > 0, '파싱 실패 catch 를 못 찾았다');
    const catchBody = after.slice(catchAt, after.indexOf('\n    }', catchAt));
    assert.ok(!/writeFileSync/.test(catchBody),
        '파싱 실패 catch 가 여전히 파일을 쓴다 — 읽기 실패를 쓰기로 갚으면 안 된다');
});

test('db 의 유효값 검사가 실제 어댑터를 따른다', function () {
    const facade = require('../mobius/db');
    for (const b of facade.backends()) {
        assert.strictEqual(schema.validate('db', b).ok, true, b + ' 가 거절됐다');
    }
    assert.strictEqual(schema.validate('db', 'oracle').ok, false,
        '없는 백엔드가 통과했다');
});

// --- The table's defaults equal the code's defaults ---
//
// The table is the contract of the console's settings screen. If the screen shows 'default 25' while conf_load.js falls back to 100, the administrator believes a server without the setting runs at 25. Comparing key existence alone cannot catch this.
//
// conf_load.js writes defaults in two shapes:
//     ? conf.<key> : <default>;      (with a type check)
//     conf.<key> || <default>;       (strings)

test('표의 dflt 와 conf_load.js 의 기본값이 같다', function () {
    // The table is the contract of the console's settings screen; if the code falls back to another value, the administrator is misled. Comparing key existence alone cannot catch this.
    const table = schema._SCHEMA;
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'conf_load.js'), 'utf8');

    // Comments are excluded; they quote the same numbers as evidence.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    // The three shapes in which defaults are written. Each must be exactly this key, so \b follows the key; otherwise conf.db matches conf.dbConnectionLimit.
    const LIT = "('([^']*)'|\"([^\"]*)\"|-?\\d+(?:\\.\\d+)?)";
    function shapes(key) {
        const k = 'conf\\.' + key + '\\b';
        return [
            new RegExp('\\?\\s*' + k + '\\s*:\\s*' + LIT + '\\s*;'),   // ? conf.K : L;
            new RegExp(k + '\\s*\\|\\|\\s*' + LIT + '\\s*;'),          // conf.K || L;
            new RegExp('\\(\\s*' + k + '\\s*,\\s*' + LIT + '\\s*\\)')  // f(conf.K, L)
        ];
    }
    function literalFor(key) {
        for (const re of shapes(key)) {
            const m = re.exec(code);
            if (!m) { continue; }
            if (m[2] !== undefined) { return m[2]; }
            if (m[3] !== undefined) { return m[3]; }
            return Number(m[1]);
        }
        return undefined;
    }

    const checked = [];
    const bad = [];
    for (const key of Object.keys(table)) {
        const dflt = table[key].dflt;
        if (dflt === undefined || dflt === null || typeof dflt === 'object') { continue; }
        const got = literalFor(key);
        if (got === undefined) { continue; }   // not visible in another shape
        checked.push(key);
        if (String(got) !== String(dflt)) {
            bad.push(key + ': 표 ' + JSON.stringify(dflt) + ' vs 코드 ' + JSON.stringify(got));
        }
    }

    assert.deepStrictEqual(bad, [],
        '표와 코드의 기본값이 다르다 — 화면이 거짓말을 한다:\n  ' + bad.join('\n  '));

    // Keeps this check from silently checking nothing.
    //
    // The sqlite* keys used to be here; they are read by the adapter now and cannot be seen here, and the test below covers that side.
    const must = ['dbConnectionLimit', 'dbQueueLimit'];
    const missed = must.filter((k) => checked.indexOf(k) < 0);
    assert.deepStrictEqual(missed, [],
        '이 키들의 기본값을 대조하지 못했다 — conf_load.js 의 작성 모양이 바뀌었다: ' +
        missed.join(', '));
});

test('어댑터가 선언한 기본값과 어댑터 코드의 폴백이 같다', function () {
    // Backend-specific settings belong to the adapter (confSchema + applyConf), so the place where 'the table's default' and 'the code's fallback' could diverge moved into the adapter as well. A divergence makes the screen lie: it tells a user without the setting WAL while the server uses something else.
    const sqlite = require('../mobius/db/sqlite');
    const src = fs.readFileSync(
        path.join(ROOT, 'mobius', 'db', 'sqlite.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // How each key's fallback is written in the code.
    const FALLBACK = {
        sqliteJournalMode:  /pick_mode\(conf\.sqliteJournalMode,\s*\w+,\s*'([^']+)'\)/,
        sqliteSynchronous:  /pick_mode\(conf\.sqliteSynchronous,\s*\w+,\s*'([^']+)'\)/,
        sqliteBusyTimeoutMs: /v\s*>=\s*0\)\s*\?\s*v\s*:\s*(\d+)/
    };

    const bad = [];
    const checked = [];
    for (const key of Object.keys(FALLBACK)) {
        const decl = sqlite.confSchema[key];
        assert.ok(decl, 'sqlite 어댑터가 ' + key + ' 를 선언하지 않는다');
        const m = FALLBACK[key].exec(code);
        if (!m) {
            bad.push(key + ': 코드에서 폴백을 못 찾았다 — 작성 모양이 바뀌었다');
            continue;
        }
        checked.push(key);
        if (String(m[1]) !== String(decl.dflt)) {
            bad.push(key + ': 선언 ' + JSON.stringify(decl.dflt) +
                     ' vs 폴백 ' + JSON.stringify(m[1]));
        }
    }

    assert.deepStrictEqual(bad, [],
        '어댑터의 선언과 폴백이 다르다 — 화면이 거짓말을 한다:\n  ' + bad.join('\n  '));
    assert.strictEqual(checked.length, 3, '세 키를 전부 대조하지 못했다');
});

test('설정 표가 지금 고른 백엔드의 키만 싣는다', function () {
    // Merging everything would show SQLite fields on the admin console of a MySQL deployment.
    const keys = schema.all();
    const saved = global.usedb;
    try {
        // Whatever backend the test environment uses, the other backend's keys must be absent.
        const sqliteKeys = Object.keys(require('../mobius/db/sqlite').confSchema);
        const mysqlKeys = Object.keys(require('../mobius/db/mysql').confSchema);
        const backend = require('../mobius/db').backendName();

        const foreign = (backend === 'sqlite' ? mysqlKeys : sqliteKeys)
            .filter((k) => keys.indexOf(k) >= 0);
        assert.deepStrictEqual(foreign, [],
            '지금 백엔드(' + backend + ')가 아닌 키가 표에 있다: ' + foreign.join(', ') +
            '\n관리 콘솔이 쓰지도 않는 설정 칸을 보여주게 된다');
    } finally {
        global.usedb = saved;
    }
});

// --- Lowering conf keys ---

test('관문 등급이면 문구가 있다 — grade:gate 인데 gateWarn 이 비면 CLI 가 빈 경고를 띄운다', function () {
    const bad = schema.all().filter((k) => {
        const s = schema.get(k);
        return s.grade === 'gate' && !(typeof s.gateWarn === 'string' && s.gateWarn.length > 0);
    });
    assert.deepStrictEqual(bad, [], 'gate 인데 gateWarn 이 없다: ' + bad.join(', '));
    // grade is 'gate' or absent; 'edit' is not written out
    const odd = schema.all().filter((k) => schema.get(k).grade !== undefined && schema.get(k).grade !== 'gate');
    assert.deepStrictEqual(odd, [], '모르는 grade: ' + odd.join(', '));
});

test('describe() 가 grade 와 gateWarn 을 준다 — 화이트리스트 복사라 안 더하면 CLI 에 안 온다', function () {
    const d = schema.describe();
    assert.strictEqual(d.cseBase.grade, 'gate');
    assert.ok(d.cseBase.gateWarn.indexOf('cseBase') >= 0);
    assert.strictEqual(d.mqttBroker.grade, 'edit');
    assert.strictEqual(d.mqttBroker.gateWarn, null);
});

test('C13 cseBase 유효성 — 빈 값·슬래시·예약어·65자를 거부한다', function () {
    for (const v of ['', 'Mo/bius', 'la', 'latest', 'ol', 'oldest', 'fopt', 'a'.repeat(65), 'Mo bius']) {
        const r = schema.validate('cseBase', v);
        assert.strictEqual(r.ok, false, JSON.stringify(v) + ' 가 통과했다');
        assert.ok(r.reason.length > 0);
    }
    for (const v of ['Mobius', 'Vita', 'cse-1', 'a'.repeat(64)]) {
        assert.strictEqual(schema.validate('cseBase', v).ok, true, v + ' 가 거절됐다');
    }
});

test('releaseVersion 의 유효값은 cb.js 가 광고하는 srv 와 같다', function () {
    // cb.js pushes srv entries one by one. A different value in the table would let configuration choose a version the CSE does not advertise.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'cb.js'), 'utf8');
    const srv = [];
    const re = /srv\.push\('([^']+)'\)/g;
    let m;
    while ((m = re.exec(src)) !== null) { srv.push(m[1]); }
    assert.ok(srv.length > 0, 'cb.js 의 srv.push 를 못 찾았다');
    assert.deepStrictEqual(schema.choices('releaseVersion'), srv);
});

test('새로 내린 키의 등급이 스펙 §2.3 과 같다', function () {
    const GATE = ['cseBase', 'cseId', 'spId', 'useSecure', 'allowedAeIds', 'allowedAppIds'];
    const EDIT = ['releaseVersion', 'mqttBroker', 'mqttPort'];
    GATE.forEach((k) => assert.strictEqual(schema.get(k).grade, 'gate', k + ' 가 관문이 아니다'));
    EDIT.forEach((k) => assert.strictEqual(schema.get(k).grade, undefined, k + ' 가 관문이다'));
    assert.strictEqual(schema.get('releaseVersion').apply, 'runtime');
    assert.strictEqual(schema.get('allowedAeIds').apply, 'runtime');
    assert.strictEqual(schema.get('cseBase').apply, 'restart');
});

test('C6 secret 과 exposed 가 어긋난 키가 0건이다 — 전수', function () {
    // validate()'s gate is exposed === false; secret is not consulted. A key with secret:true but without exposed:false is simply written; adminOrigin decides the console's CSE write authority, so that hole is authority.
    const bad = schema.all().filter((k) => schema.get(k).secret === true && schema.get(k).exposed !== false);
    assert.deepStrictEqual(bad, [], 'secret 인데 exposed:false 가 아니다: ' + bad.join(', '));
    // Conversely, everything exposed:false must be a secret; 'hidden but not secret' keys (the old csebaseport) are gone.
    const hidden = schema.all().filter((k) => schema.get(k).exposed === false && schema.get(k).secret !== true);
    assert.deepStrictEqual(hidden, [], 'exposed:false 인데 secret 이 아니다: ' + hidden.join(', '));
});

test('C5 콘솔 키의 리더가 스캐너에 잡힌다 — 실행 코드에서 지우면 빠지고, 주석의 언급은 리더가 아니다', function () {
    const src = readSrc('admin/server.js');
    assert.ok(keysReadByAdmin().indexOf('adminPassword') >= 0, 'admin/server.js 가 adminPassword 를 읽는다고 안 나온다');

    // Deletes the code line that reads conf.adminPassword and plants the same name as a comment in its place. admin/server.js itself has no such comment, so the file content alone cannot prove that comment stripping works.
    const code = src.split('\n')
        .map((l) => (/conf\.adminPassword/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
            ? '// 예전에는 여기서 conf.adminPassword 를 읽었다 — 주석의 언급은 리더가 아니다'
            : l)
        .join('\n');
    assert.ok(/conf\.adminPassword/.test(code), '심어 둔 주석이 없다 — 시험이 헛돈다');
    assert.ok(keysReadIn(code).indexOf('adminPassword') < 0,
        '코드에서 지웠는데도 읽는다고 나온다 — 주석이 가드를 통과한다');

    // Whether it is really caught without comment stripping: proof that this test checks the stripping.
    const naive = new Set();
    const re = /conf\.([a-zA-Z_][\w]*)/g;
    let m;
    while ((m = re.exec(code)) !== null) { naive.add(m[1]); }
    assert.ok(naive.has('adminPassword'), '주석을 안 걷어도 안 잡힌다 — 이 시험이 주석 제거를 검사하지 못한다');
});

test('C4 키 표가 백엔드를 따라간다 — 자식 프로세스에서 db:sqlite 로 conf_load 를 부른다', function () {
    // This process's table is already frozen (mergeBackendConf runs at require time), so a child process is used. argv is left empty; conf.db must be the selector.
    const { execFileSync } = require('node:child_process');
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'confschema-'));
    const file = path.join(dir, 'conf.json');
    fs.writeFileSync(file, JSON.stringify({ db: 'sqlite' }), 'utf8');
    const script = "require(" + JSON.stringify(path.join(ROOT, 'mobius', 'conf_load.js')) + ")({file:" +
        JSON.stringify(file) + "}, function (err) { if (err) { throw err; }" +
        " var s = require(" + JSON.stringify(path.join(ROOT, 'mobius', 'conf_schema.js')) + ");" +
        " process.stdout.write(JSON.stringify(s.all())); });";
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: Object.assign({}, process.env, { MOBIUS_SQLITE_PATH: path.join(dir, 'x.db') }) });
    const keys = JSON.parse(out);
    assert.ok(keys.indexOf('sqliteJournalMode') >= 0, 'sqlite 키가 없다: ' + keys.join(','));
    assert.ok(keys.indexOf('dbpass') < 0, 'mysql 의 dbpass 가 sqlite 표에 있다');
});

// --- User keys / advanced keys ---

test('T1 사용자 키는 일곱이고 마법사 화이트리스트와 같은 집합이다', function () {
    assert.deepStrictEqual(schema.userKeys(), ['cseBase', 'cseId', 'csebaseport', 'db', 'dbpass', 'spId', 'superUser']);
    const { WIZARD_KEYS } = require('../tools/conf_store');
    assert.deepStrictEqual(WIZARD_KEYS.slice().sort(), schema.userKeys());
});
test('T3 새 키의 기본 등급은 고급이다 — tier 를 안 적으면 사용자에게 안 보인다', function () {
    assert.strictEqual(schema.get('mqttBroker').tier, undefined);
    assert.strictEqual(schema.describe().mqttBroker.tier, 'advanced');
    assert.strictEqual(schema.describe().cseBase.tier, 'user');
    assert.ok(schema.userKeys().indexOf('superUser') >= 0, '비밀도 사용자 키일 수 있다');
});
