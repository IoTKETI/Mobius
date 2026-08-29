'use strict';
// discovery 결과를 리소스별 ACP 로 거른다.
//
// 예전에는 요청 대상 하나만 검사하고 결과를 그대로 냈다. AE 아래 컨테이너
// 하나만 잠가도 그 경로가 상위 탐색 결과에 나왔다 — 내용은 안 새고 이름·구조·
// CIN 개수·생성 시각이 샜다.
//
// 비용은 **행 수가 아니라 서로 다른 acpi 조합 수**에 비례해야 한다.
// 그 성질이 깨지면 배포 lim 2,000 에서 요청 하나가 수천 질의가 된다.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-acp-filter-test.db');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//ketiabc.com';
global.usesuperuser = 'Sponde';
global.useaccesscontrolpolicy = 'disable';
global.acp_discovery_filter = 'on';

const filter = require('../mobius/acp_filter');

function tapBy(answer) {
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(__dirname, '..', 'mobius', 'sql_action.js'),
                     path.join(__dirname, '..', 'mobius', 'acp_filter.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usesqlite = 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, answer(sql, bindings) || []);
    };
    db.connect('h', 1, 'u', 'p', function () {});
    return { f: require(path.join(__dirname, '..', 'mobius', 'acp_filter.js')), seen: seen };
}

const req = (origin) => ({ headers: { 'x-m2m-origin': origin },
                           connection: { remoteAddress: '127.0.0.1' }, url: '/Mobius/ae' });
const row = (ri, extra) => Object.assign({ ri: ri, ty: 3, pi: '/Mobius/ae', cr: 'Cteam', acpi: '[]' }, extra || {});
const allow = (who) => JSON.stringify({ acr: [{ acor: [who], acop: 63 }] });

// ── 순수 헬퍼 ─────────────────────────────────────────────────────────

test('조상은 가까운 것부터, 루트는 뺀다', function () {
    assert.deepStrictEqual(
        filter._ancestors_under('/Mobius/ae/a/b/c', '/Mobius/ae'),
        ['/Mobius/ae/a/b', '/Mobius/ae/a']);
    assert.deepStrictEqual(filter._ancestors_under('/Mobius/ae/a', '/Mobius/ae'), []);
});

test('acpi 는 문자열이든 배열이든 읽는다', function () {
    assert.deepStrictEqual(filter._parse_acpi('["/M/a"]'), ['/M/a']);
    assert.deepStrictEqual(filter._parse_acpi(['/M/a']), ['/M/a']);
    for (const v of ['', '[]', null, undefined, '{not json', '{"a":1}', 7]) {
        assert.deepStrictEqual(filter._parse_acpi(v), [], JSON.stringify(v));
    }
});

test('cr 은 타입마다 다르다 — ae 와 remoteCSE 에는 cr 컬럼이 없다', function () {
    assert.strictEqual(filter._cr_of({ ty: 3, cr: 'Cowner' }), 'Cowner');
    assert.strictEqual(filter._cr_of({ ty: '2', aei: 'Sxyz', cr: undefined }), 'Sxyz');
    assert.strictEqual(filter._cr_of({ ty: '16', csi: '/other' }), '/other');
});

// ── 거르기 ────────────────────────────────────────────────────────────

test('잠금이 없으면 아무것도 안 지운다', function (t, done) {
    const found = { '/Mobius/ae/a': row('/Mobius/ae/a'), '/Mobius/ae/b': row('/Mobius/ae/b') };
    const h = tapBy(() => []);
    h.f.filter_found(null, req('Cother'), '/Mobius/ae', found, function (err, st) {
        assert.ok(!err);
        assert.strictEqual(st.removed, 0);
        assert.strictEqual(Object.keys(found).length, 2);
        done();
    });
});

test('루트 바로 아래 행은 조상 조회조차 하지 않는다', function (t, done) {
    // 조상이 루트뿐이면 볼 것이 없다 — 루트는 이미 검사를 통과했다.
    const found = { '/Mobius/ae/a': row('/Mobius/ae/a') };
    const h = tapBy(() => []);
    h.f.filter_found(null, req('Cother'), '/Mobius/ae', found, function (err, st) {
        assert.ok(!err);
        assert.strictEqual(st.queries, 0, '질의가 ' + st.queries + '번 나갔다');
        done();
    });
});

test('잠긴 곳과 그 하위가 함께 빠진다', function (t, done) {
    const found = {
        '/Mobius/ae/open': row('/Mobius/ae/open'),
        '/Mobius/ae/secret': row('/Mobius/ae/secret', { acpi: '["/Mobius/ae/acp1"]' }),
        '/Mobius/ae/secret/inner': row('/Mobius/ae/secret/inner'),
        '/Mobius/ae/secret/cin1': row('/Mobius/ae/secret/cin1', { ty: 4 })
    };
    const h = tapBy(function (sql) {
        if (/from `acp`/.test(sql)) { return [{ ri: '/Mobius/ae/acp1', pv: allow('Cteam'), pvs: allow('Cteam') }]; }
        return [];
    });
    h.f.filter_found(null, req('Cother'), '/Mobius/ae', found, function (err, st) {
        assert.ok(!err, JSON.stringify(st));
        assert.deepStrictEqual(Object.keys(found), ['/Mobius/ae/open']);
        assert.strictEqual(st.removed, 3);
        done();
    });
});

test('허용된 원본에게는 그대로 다 보인다', function (t, done) {
    const found = {
        '/Mobius/ae/open': row('/Mobius/ae/open'),
        '/Mobius/ae/secret': row('/Mobius/ae/secret', { acpi: '["/Mobius/ae/acp1"]' }),
        '/Mobius/ae/secret/inner': row('/Mobius/ae/secret/inner')
    };
    const h = tapBy(function (sql) {
        if (/from `acp`/.test(sql)) { return [{ ri: '/Mobius/ae/acp1', pv: allow('Cteam'), pvs: allow('Cteam') }]; }
        return [];
    });
    h.f.filter_found(null, req('Cteam'), '/Mobius/ae', found, function (err, st) {
        assert.ok(!err);
        assert.strictEqual(st.removed, 0);
        assert.strictEqual(Object.keys(found).length, 3);
        done();
    });
});

test('생성자는 잠긴 곳도 본다 — 직접 조회와 같아야 한다', function (t, done) {
    const found = {
        '/Mobius/ae/secret': row('/Mobius/ae/secret', { acpi: '["/Mobius/ae/acp1"]', cr: 'Cdevice' })
    };
    const h = tapBy(function (sql) {
        if (/from `acp`/.test(sql)) { return [{ ri: '/Mobius/ae/acp1', pv: allow('Cteam'), pvs: allow('Cteam') }]; }
        return [];
    });
    h.f.filter_found(null, req('Cdevice'), '/Mobius/ae', found, function (err, st) {
        assert.ok(!err);
        assert.strictEqual(st.removed, 0);
        assert.strictEqual(st.evaluated, 0, '생성자는 평가까지 갈 것도 없다');
        done();
    });
});

test('수퍼유저에게는 거르지 않고 질의도 안 한다', function (t, done) {
    const found = { '/Mobius/ae/secret': row('/Mobius/ae/secret', { acpi: '["/Mobius/ae/acp1"]' }) };
    const h = tapBy(() => []);
    h.f.filter_found(null, req('Sponde'), '/Mobius/ae', found, function (err, st) {
        assert.ok(!err);
        assert.strictEqual(st.removed, 0);
        assert.strictEqual(st.queries, 0);
        done();
    });
});

test('비용은 행 수가 아니라 서로 다른 acpi 조합 수에 비례한다', function (t, done) {
    // 같은 acpi 를 가진 행 500개 -> acp 질의는 1회여야 한다.
    const found = {};
    for (let i = 0; i < 500; i++) {
        found['/Mobius/ae/secret/c' + i] = row('/Mobius/ae/secret/c' + i, { ty: 4 });
    }
    const h = tapBy(function (sql) {
        if (/from `acp`/.test(sql)) { return [{ ri: '/Mobius/ae/acp1', pv: allow('Cteam'), pvs: allow('Cteam') }]; }
        // 조상 조회: secret 하나만 돌려준다
        return [{ ri: '/Mobius/ae/secret', acpi: '["/Mobius/ae/acp1"]' }];
    });
    h.f.filter_found(null, req('Cother'), '/Mobius/ae', found, function (err, st) {
        assert.ok(!err, JSON.stringify(st));
        assert.strictEqual(st.removed, 500);
        assert.strictEqual(st.queries, 2, '조상 1회 + acp 1회여야 한다 (실제 ' + st.queries + ')');
        assert.strictEqual(st.evaluated, 500, '판정은 행마다 하되 DB 는 안 친다');
        done();
    });
});

test('조상 조회는 서로 다른 조상 수만큼만 묻는다', function (t, done) {
    // CIN 2,000건이 한 컨테이너 아래면 조상은 하나다.
    const found = {};
    for (let i = 0; i < 300; i++) {
        found['/Mobius/ae/c1/cin' + i] = row('/Mobius/ae/c1/cin' + i, { ty: 4 });
    }
    let asked = null;
    const h = tapBy(function (sql, b) {
        if (/from `lookup`/.test(sql)) { asked = b; }
        return [];
    });
    h.f.filter_found(null, req('Cother'), '/Mobius/ae', found, function (err, st) {
        assert.ok(!err);
        assert.strictEqual(st.queries, 1);
        assert.deepStrictEqual(asked.slice(0, 1), ['/Mobius/ae/c1'],
            '조상 목록이 ' + (asked || []).length + '개다');
        done();
    });
});

test("acpDiscoveryFilter='off' 면 아무것도 하지 않는다", function (t, done) {
    const found = { '/Mobius/ae/secret': row('/Mobius/ae/secret', { acpi: '["/Mobius/ae/acp1"]' }) };
    const h = tapBy(() => []);
    global.acp_discovery_filter = 'off';
    h.f.filter_found(null, req('Cother'), '/Mobius/ae', found, function (err, st) {
        global.acp_discovery_filter = 'on';
        assert.ok(!err);
        assert.strictEqual(st.queries, 0);
        assert.strictEqual(Object.keys(found).length, 1);
        done();
    });
});

test('DB 오류는 삼키지 않는다 — 거르지 못한 결과를 내보내면 안 된다', function (t, done) {
    const found = { '/Mobius/ae/a/b': row('/Mobius/ae/a/b') };
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(__dirname, '..', 'mobius', 'sql_action.js'),
                     path.join(__dirname, '..', 'mobius', 'acp_filter.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usesqlite = 'false';
    const db = require(DB);
    require(path.join(DB, 'mysql.js')).execute = function (c, s, b, cb) { cb(new Error('boom')); };
    db.connect('h', 1, 'u', 'p', function () {});
    const f = require(path.join(__dirname, '..', 'mobius', 'acp_filter.js'));
    f.filter_found(null, req('Cother'), '/Mobius/ae', found, function (err) {
        assert.ok(err, '오류를 올려야 한다');
        done();
    });
});
