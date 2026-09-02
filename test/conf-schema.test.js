'use strict';
// 설정 표가 코드와 갈라지지 않게 묶는다.
//
// mobius/conf_schema.js 는 손으로 적은 표다. 손으로 적은 목록은 갈라진다 —
// 오늘만 해도 CSEBase 의 srt 가 ty_list 와 갈라져 있었고, 그래서 실제로 만들 수
// 있는 타입 절반을 광고하지 않고 있었다. 표를 믿는 쪽(관리 콘솔)은 그 거짓말을
// 그대로 화면에 그린다.
//
// 그래서 표가 아니라 **코드가 실제로 읽는 것**과 대조한다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const schema = require('../mobius/conf_schema');

// mobius.js 가 conf.<키> 로 읽는 것 전부. conf.json 은 파일 이름이라 뺀다.
// 주석을 걷어낸다. **이걸 안 하면 산문이 가드를 만족시킨다.**
//
// 실제로 그랬다 — dbpass 를 어댑터로 옮기면서 mobius.js 에 "conf.dbpass 는
// 연결 좌표다" 라고 설명을 적었더니, 이 정규식이 그 문장을 읽고 "mobius.js 가
// dbpass 를 읽는다" 고 판정해 아래 두 테스트가 **둘 다 통과했다.** 코드에서는
// 이미 사라진 뒤였다.
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function keysReadByMobius() {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'mobius.js'), 'utf8'));
    const out = new Set();
    const re = /conf\.([a-zA-Z_][\w]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m[1] !== 'json') { out.add(m[1]); }
    }
    return [...out].sort();
}

// 어댑터가 **자기 것으로** 선언한 키. 이것도 리더다.
//
// mobius.js 만 보면 안 되는 이유: 코어는 db.applyConf(conf) 로 conf 를 통째로
// 넘기고, 어느 키를 볼지는 어댑터가 정한다. 그래서 mysql 어댑터가 읽는
// dbpass 는 mobius.js 소스에 conf.dbpass 로 안 나타난다.
//
// **지금 고른 백엔드의 것만 본다.** 표(schema.all())가 고른 백엔드의 것만
// 싣기 때문이다. 모든 어댑터를 보면 비대칭이 생겨 아래 '표가 전부 담는다'
// 가 반대쪽에서 깨진다 — mysql 로 돌리는데 sqlite 의 세 키가 '읽히는데 표에
// 없다' 로 잡힌다(실제로 그렇게 실패했다).
//
// 어댑터가 자기 표에 실은 키를 정말로 읽는지는 이쪽이 아니라
// test/db-adapter-contract.test.js 가 어댑터별로 본다.
function keysOwnedByAdapter() {
    delete require.cache[require.resolve('../mobius/db')];
    const keys = Object.keys(require('../mobius/db').confSchema() || {});
    delete require.cache[require.resolve('../mobius/db')];
    return keys.sort();
}

function keysReadBySomeone() {
    return [...new Set(keysReadByMobius().concat(keysOwnedByAdapter()))].sort();
}

test('표가 코어와 어댑터가 읽는 키를 전부 담는다', function () {
    const read = keysReadBySomeone();
    const known = schema.all();
    const missing = read.filter((k) => known.indexOf(k) < 0);

    assert.deepStrictEqual(missing, [],
        'mobius.js 가 읽는데 표에 없는 키가 있다: ' + missing.join(', ') +
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
    // 반대 방향도 막는다. 코드에서 사라진 설정이 표에 남아 있으면 화면이
    // 아무 효과도 없는 입력칸을 보여 준다.
    const read = keysReadBySomeone();
    const stale = schema.all().filter((k) => read.indexOf(k) < 0);

    assert.deepStrictEqual(stale, [],
        '표에 있는데 mobius.js 가 안 읽는 키가 있다: ' + stale.join(', ') +
        '\n코드에서 없어졌으면 표에서도 지울 것');
});

test('모든 항목이 분류를 밝힌다', function () {
    // 분류를 화면 쪽에 적으면 표를 두 벌 드는 셈이라 결국 갈라진다.
    // 라벨·도움말·유효값과 같은 곳에서 와야 한다.
    for (const k of schema.all()) {
        const g = schema.get(k).group;
        assert.ok(typeof g === 'string' && g.length > 0, k + ' 에 group 이 없다');
    }
});

test('분류 이름이 늘어나는 것은 의도된 선택이어야 한다', function () {
    // 오타로 '권한 ' 같은 새 묶음이 생기면 화면에 빈 칸이 하나 더 뜬다.
    // 새 분류를 정말 만들 때는 이 목록도 같이 늘린다.
    const KNOWN = ['권한', '요청 처리', '저장소', '네트워크'];
    const used = [...new Set(schema.all().map((k) => schema.get(k).group))].sort();
    const unknown = used.filter((g) => KNOWN.indexOf(g) < 0);
    assert.deepStrictEqual(unknown, [],
        '모르는 분류가 생겼다: ' + unknown.join(', ') +
        '\n오타가 아니라 정말 새 분류라면 이 테스트의 KNOWN 에도 더할 것');
});

test('모든 항목이 적용 시점을 밝힌다', function () {
    // 이 구분이 화면에서 가장 중요하다. 'reload' 를 '즉시' 로 표시하면
    // 관리자가 관찰 모드를 껐다고 믿고 넘어간다.
    for (const k of schema.all()) {
        const s = schema.get(k);
        assert.ok(['runtime', 'reload', 'restart'].indexOf(s.apply) >= 0,
            k + ' 의 apply 가 없거나 모르는 값이다: ' + s.apply);
    }
});

test("'reload' 는 무엇을 다시 불러야 하는지 밝힌다", function () {
    // 'reload' 는 "global 만 바꾸면 아무 일도 안 난다" 는 뜻이다.
    // 무엇을 불러야 하는지 없으면 그 정보가 쓸모없다.
    //
    // **describe() 로 확인한다.** 화면이 쓰는 것은 그쪽이다. 예전에는 이 테스트가
    // 내부 표(_SCHEMA)를 봐서 통과했는데, describe() 는 reloadWith 를 복사하지
    // 않고 있었다 — 테스트는 초록인데 소비자는 못 받는 상태였다.
    const d = schema.describe();
    for (const [k, v] of Object.entries(d)) {
        if (v.apply !== 'reload') { continue; }
        assert.ok(typeof v.reloadWith === 'string' && v.reloadWith.length > 0,
            k + ' 가 reload 인데 describe() 가 reloadWith 를 안 준다');
    }
    assert.strictEqual(d.acpObserveMode.reloadWith, 'acp_observe.configure');
});

test('describe() 가 소비자에게 필요한 필드를 전부 준다', function () {
    // 화면이 쓰는 유일한 진입점이다. 내부 표에만 있고 여기 없으면 없는 것과 같다.
    const NEED = ['type', 'dflt', 'choices', 'validHint', 'integer', 'group',
                  'apply', 'reloadWith', 'readOnly', 'label', 'help'];
    for (const [k, v] of Object.entries(schema.describe())) {
        for (const f of NEED) {
            assert.ok(f in v, 'describe().' + k + ' 에 ' + f + ' 가 없다');
        }
    }
});

test('acp_observe 계열이 reload 로 분류돼 있다', function () {
    // 이 셋은 global 을 읽지 않는다. mobius.js 가 기동 시 acp_observe.configure()
    // 로 넣고, 그 뒤로 모듈이 자기 cfg 만 본다. 그래서 값만 바꾸면 안 먹는다.
    const observe = fs.readFileSync(path.join(ROOT, 'mobius', 'acp_observe.js'), 'utf8');
    assert.ok(/exports\.configure = function/.test(observe),
        'acp_observe.configure 가 없어졌다 — reload 분류의 근거가 사라졌다');

    for (const k of ['acpObserveMode', 'acpDenyLog', 'acpDenyLogRate']) {
        assert.strictEqual(schema.get(k).apply, 'reload',
            k + ' 는 reload 여야 한다 (global 을 읽지 않는다)');
    }
});

test("'runtime' 로 분류한 것은 코드가 실제로 global 을 읽는다", function () {
    // 표가 "즉시 적용" 이라고 했는데 코드가 global 을 안 읽으면 그것도 거짓말이다.
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
    // 이 함수를 "설정 저장 경로의 관문" 이라고 설명했으면 그 하나가 전부 막아야
    // 한다. 노출 여부를 안 보면, validate 만 믿고 위임한 호출부에서 비밀 키가
    // 그냥 써진다. superUser 는 그 값으로 모든 ACP 검사를 건너뛰는 값이다 —
    // 콘솔이 그것을 쓸 수 있으면 콘솔이 곧 마스터 키다.
    for (const k of ['dbpass', 'superUser', 'csebaseport', 'pxyWsPort']) {
        const r = schema.validate(k, 'x');
        assert.strictEqual(r.ok, false, k + ' 가 통과했다 — 노출 대상이 아닌데 써진다');
        assert.ok(r.reason.length > 0);
    }
    // 노출 대상은 그대로 통과해야 한다.
    assert.strictEqual(schema.validate('acpObserveMode', 'observe').ok, true);
});

test('비밀은 노출 목록에 없다', function () {
    for (const k of ['dbpass', 'superUser']) {
        assert.strictEqual(schema.get(k).secret, true, k + ' 가 secret 이 아니다');
        assert.ok(schema.exposed().indexOf(k) < 0, k + ' 가 노출 목록에 있다');
    }
    // describe() 가 비밀 항목을 통째로 빼는지 — 라벨조차 안 나가야 한다.
    const d = JSON.stringify(schema.describe());
    assert.ok(d.indexOf('dbpass') < 0 && d.indexOf('superUser') < 0,
        'describe() 에 비밀 키 이름이 들어 있다');
});

test('db 는 노출하고, 유효값을 어댑터에서 받는다', function () {
    // 사용자가 명시적으로 요청한 항목이다. 그리고 유효값을 하드코딩하면
    // 어댑터를 하나 추가한 날 화면이 따라오지 않는다.
    assert.ok(schema.exposed().indexOf('db') >= 0, 'db 가 노출 목록에 없다');
    assert.strictEqual(schema.get('db').apply, 'restart');

    const facade = require('../mobius/db');
    assert.deepStrictEqual(schema.choices('db'), facade.backends(),
        'db 의 유효값이 파사드의 백엔드 목록과 다르다 — 하드코딩했는지 확인할 것');
});

test('usesqlite 는 표에서 사라졌다 — 되살아나면 안 된다', function () {
    // 이 자리에 "노출하지 않는다 (곧 사라진다)" 가 있었다. 사라졌다.
    //
    // 표에 다시 넣으면 관리 콘솔이 그것을 아는 설정으로 취급하고, 지웠다는
    // 사실이 흐려진다. boolean 으로는 백엔드를 둘까지밖에 못 말하므로
    // 되돌릴 값이 아니다 — db 키가 대신한다.
    assert.strictEqual(schema.get('usesqlite'), null,
        'usesqlite 가 설정 표에 되살아났다 — 선택자는 db 키 하나다');
    assert.ok(schema.all().indexOf('usesqlite') < 0);

    // 모르는 키라 저장도 막힌다. 옛 이름으로 값을 밀어 넣을 수 없어야 한다.
    const r = schema.validate('usesqlite', 'true');
    assert.strictEqual(r.ok, false);
});

test('validate 는 던지지 않고 이유를 돌려준다', function () {
    // 설정 저장 경로에서 도는 함수다. 여기서 던지면 화면이 이유 없이 500 을 받는다.
    const cases = [
        ['acpObserveMode', 'observe', true],
        ['acpObserveMode', 'on', false],
        ['acpObserveMode', 123, false],
        ['acpDenyLogRate', 5, true],
        ['acpDenyLogRate', -1, false],
        ['acpDenyLogRate', '5', false],
        ['outboundTimeoutMs', 0, true],
        ['outboundTimeoutMs', 3000, true],
        ['outboundTimeoutMs', 2999, false],   // 낮추면 정상 알림이 실패로 기록된다
        ['retentionPolicies', [], false],     // 읽기 전용
        ['acpDenyLogRate', 1.5, false],       // 정수여야 한다
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
    // 예전에는 try 하나로 "없음" 과 "깨짐" 을 같이 잡아 어느 쪽이든 기본값
    // 3개로 파일을 덮어썼다. 그래서 파싱이 한 번 실패하면 운영 설정이 통째로
    // 날아갔다 — dbpass 가 하드코딩 기본값으로 바뀌고 adminPassword 는 소실됐다.
    //
    // 도달 경로가 실재한다: 워커 25개가 각자 기동 때 이 파일을 읽는데,
    // backstop 이 워커를 죽이면 cluster 가 다시 띄운다. 그 순간 누군가
    // conf.json 을 제자리에서 쓰고 있으면 반쪽 JSON 을 읽는다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius.js'), 'utf8');

    // "없음" 과 "깨짐" 을 가른다. 없을 때만 만들어 준다.
    assert.ok(/existsSync\('conf\.json'\)/.test(src),
        '파일 존재 여부를 안 가른다 — "없음" 과 "깨짐" 을 같이 잡으면 안 된다');

    // 파싱 실패 catch 안에서 파일을 쓰면 안 된다.
    const at = src.indexOf("JSON.parse(fs.readFileSync('conf.json'");
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

// --- 표의 기본값과 코드의 기본값이 같은가 ------------------------------------
//
// 표는 **콘솔 설정 화면의 계약**이다. 화면이 "기본값 25" 라고 보여 주는데
// mobius.js 가 실제로는 100 으로 떨어지면, 관리자는 설정을 안 넣은 서버가
// 25 로 돈다고 믿는다. 키 존재만 대조해서는 이 어긋남을 못 잡는다 —
// 실제로 dbConnectionLimit 이 표 25 / 코드 100 으로 갈라져 있었다.
//
// mobius.js 가 기본값을 쓰는 모양은 둘이다:
//     ? conf.<키> : <기본값>;      (타입 검사가 붙은 경우)
//     conf.<키> || <기본값>;       (문자열)

test('표의 dflt 와 mobius.js 의 기본값이 같다', function () {
    // 표는 **콘솔 설정 화면의 계약**이다. 화면이 '기본값 25' 라고 보여 주는데
    // mobius.js 가 실제로는 100 으로 떨어지면, 관리자는 설정을 안 넣은 서버가
    // 25 로 돈다고 믿는다. 키 존재만 대조해서는 이 어긋남을 못 잡는다 —
    // 실제로 dbConnectionLimit 이 표 25 / 코드 100 으로 갈라져 있었다.
    const table = schema._SCHEMA;
    const src = fs.readFileSync(path.join(ROOT, 'mobius.js'), 'utf8');

    // 주석은 뺀다 — 근거를 적느라 같은 숫자를 인용한다.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    // mobius.js 가 기본값을 쓰는 세 가지 모양. 셋 다 정확히 이 키여야 하므로
    // 키 뒤에 \\b 를 붙인다 — 안 그러면 conf.db 가 conf.dbConnectionLimit 에 걸린다.
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
        if (got === undefined) { continue; }   // 이 모양이 아니면 못 본다
        checked.push(key);
        if (String(got) !== String(dflt)) {
            bad.push(key + ': 표 ' + JSON.stringify(dflt) + ' vs 코드 ' + JSON.stringify(got));
        }
    }

    assert.deepStrictEqual(bad, [],
        '표와 코드의 기본값이 다르다 — 화면이 거짓말을 한다:\n  ' + bad.join('\n  '));

    // 이 검사가 조용히 아무것도 안 보게 되는 것을 막는다.
    //
    // sqlite* 세 키가 여기 있었다. 지금은 mobius.js 가 아니라 어댑터가 읽으므로
    // 여기서 볼 수 없다 — 드리프트 위험도 그쪽으로 옮겨갔고, 아래 테스트가 본다.
    const must = ['dbConnectionLimit', 'dbQueueLimit'];
    const missed = must.filter((k) => checked.indexOf(k) < 0);
    assert.deepStrictEqual(missed, [],
        '이 키들의 기본값을 대조하지 못했다 — mobius.js 의 작성 모양이 바뀌었다: ' +
        missed.join(', '));
});

test('어댑터가 선언한 기본값과 어댑터 코드의 폴백이 같다', function () {
    // 백엔드 고유 설정은 어댑터가 갖는다(confSchema + applyConf). 그래서
    // "표가 말하는 기본값" 과 "코드가 실제로 쓰는 폴백" 이 갈릴 자리도
    // 어댑터 안으로 옮겨왔다. 갈리면 화면이 거짓말을 한다 —
    // 값을 안 넣은 사용자에게 화면은 WAL 이라 하고 서버는 다른 것을 건다.
    const sqlite = require('../mobius/db/sqlite');
    const src = fs.readFileSync(
        path.join(ROOT, 'mobius', 'db', 'sqlite.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    // 각 키의 폴백이 코드에 어떻게 적혀 있는지.
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
    // 전부 합치면 MySQL 로 도는 배포의 관리 콘솔에 SQLite 칸이 뜬다.
    // 실제로 그랬다 — sqliteJournalMode / sqliteSynchronous / sqliteBusyTimeoutMs.
    const keys = schema.all();
    const saved = global.usedb;
    try {
        // 지금 테스트 환경의 백엔드가 무엇이든, 다른 백엔드의 키는 없어야 한다.
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
