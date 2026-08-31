'use strict';
// 본문 INSERT 20개를 표 + 공통 함수 하나로 바꿨다. 이 테스트는 그 표가
// **옛 SQL 과 같은 테이블·같은 컬럼**을 쓰는지 못박는다.
//
// 왜 필요한가: 표에 컬럼 이름 하나를 틀리게 적어도 코드는 멀쩡히 돌고,
// 그 리소스 타입을 실제로 만들어 봐야 드러난다. 그리고 이 스무 타입은
// 등가성 하네스가 다루지 않는다(SQLite 스키마에 테이블이 없어 MySQL 전용).
// 즉 사람이 손으로 안 만들어 보면 아무도 안 밟는 경로다.
//
// 기대값은 **전환 전 커밋의 소스에서 뽑았다.** 손으로 옮겨 적지 않는다 —
// 그러면 표를 옮겨 적을 때 낸 실수를 여기서 똑같이 반복하게 된다.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// 전환 전 커밋(e71622a)의 sql_action.js 에서 (함수 -> 테이블, 컬럼) 을 뽑는다.
function legacyShapes() {
    let src;
    try {
        src = execFileSync('git', ['show', 'e71622a:mobius/sql_action.js'],
            { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
        return null;      // 얕은 클론 등으로 그 커밋이 없으면 건너뛴다
    }

    const lines = src.split('\n');
    const heads = [];
    lines.forEach((l, i) => {
        const m = l.match(/^exports\.(insert_[a-zA-Z_0-9]+)\s*=\s*function/);
        if (m) heads.push({ name: m[1], start: i });
    });
    heads.forEach((h, i) => { h.end = (i + 1 < heads.length) ? heads[i + 1].start : lines.length; });

    const out = {};
    for (const h of heads) {
        const body = lines.slice(h.start, h.end).join('\n');
        const m = body.match(/insert into (\w+) \(([^)]*)\)/);
        if (!m) continue;                                   // 이미 파사드였던 것
        out[h.name] = {
            table: m[1],
            // fcnt.lock / mgo.mod / smd.or 처럼 테이블로 한정한 것은 컬럼만 남긴다
            cols: m[2].split(',').map((s) => s.trim().replace(/^\w+\./, ''))
        };
    }
    return out;
}

// 지금 코드가 내는 SQL 을 잡는다. 어댑터의 execute 를 갈아끼워 기록만 한다.
function capture(fnName, obj) {
    const DB = path.join(ROOT, 'mobius', 'db');
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(ROOT, 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    global.usesqlite = 'false';

    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    const realExecute = adapter.execute;

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    db.connect('h', 1, 'u', 'p', function () {});

    const sql_action = require(path.join(ROOT, 'mobius', 'sql_action.js'));
    try {
        sql_action[fnName]({}, obj, function () {});
    } finally {
        adapter.execute = realExecute;
    }
    return seen;
}

const LEGACY = legacyShapes();

test('전환 전 커밋에서 옛 모양을 읽을 수 있다', function (t) {
    if (LEGACY === null) {
        t.skip('e71622a 를 못 읽는다 (얕은 클론?) — 대조를 건너뛴다');
        return;
    }
    assert.strictEqual(Object.keys(LEGACY).length, 20,
        '옛 소스에서 손으로 쓴 insert 를 20개 찾아야 한다: ' +
        Object.keys(LEGACY).length + '개');
});

// 모든 컬럼에 값을 채운 obj. 값이 없으면 knex 가 바인딩을 거부해
// "컬럼이 빠졌다" 와 "값이 없다" 를 구분할 수 없다.
function objFor(cols) {
    const o = { ri: '/M/x', pi: '/M', ty: '9', ct: '20260101T000000' };
    cols.forEach(function (c) { o[c] = (o[c] === undefined) ? ('v_' + c) : o[c]; });
    return o;
}

if (LEGACY) {
    for (const [name, want] of Object.entries(LEGACY)) {
        test('표가 옛 SQL 과 같다: ' + name, function () {
            const seen = capture(name, objFor(want.cols));

            // insert_lookup 이 먼저 나가고, 그 다음이 본문이다.
            const body = seen.filter(function (s) {
                return new RegExp('insert into `' + want.table + '`').test(s.sql);
            });
            assert.strictEqual(body.length, 1,
                name + ' 이 ' + want.table + ' 에 insert 를 한 번 내야 한다. 실제 SQL:\n  ' +
                seen.map(function (s) { return s.sql; }).join('\n  '));

            const got = (body[0].sql.match(/\(([^)]*)\) values/) || [])[1] || '';
            const cols = got.split(',').map(function (s) {
                return s.trim().replace(/`/g, '');
            });

            assert.deepStrictEqual(cols.slice().sort(), want.cols.slice().sort(),
                name + ' 의 컬럼이 옛것과 다르다\n' +
                '  옛것: ' + want.cols.join(', ') + '\n' +
                '  지금: ' + cols.join(', '));
        });
    }
}

// --- UPDATE 쪽 ---------------------------------------------------------------

function legacyUpdateShapes() {
    let src;
    try {
        src = execFileSync('git', ['show', 'e71622a:mobius/sql_action.js'],
            { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (e) { return null; }

    const NAMES = ['update_fwr', 'update_bat', 'update_dvi', 'update_dvc', 'update_rbo',
                   'update_nod', 'update_csr', 'update_smd', 'update_mms'];
    const lines = src.split('\n');
    const heads = [];
    lines.forEach((l, i) => {
        const m = l.match(/^exports\.(update_[a-zA-Z_0-9]+)\s*=\s*function/);
        if (m) heads.push({ name: m[1], start: i });
    });
    heads.forEach((h, i) => { h.end = (i + 1 < heads.length) ? heads[i + 1].start : lines.length; });

    const out = {};
    for (const h of heads) {
        if (NAMES.indexOf(h.name) < 0) { continue; }
        const body = lines.slice(h.start, h.end).join('\n');
        const m = body.match(/update (\w+) set ([\s\S]*?) where ri = /);
        if (!m) { continue; }
        out[h.name] = {
            table: m[1],
            cols: m[2].split(',').map(function (s) {
                return s.trim().split(/\s*=/)[0].trim().replace(/^\w+\./, '');
            })
        };
    }
    return out;
}

const LEGACY_UPD = legacyUpdateShapes();

test('전환 전 커밋에서 옛 UPDATE 모양을 읽을 수 있다', function (t) {
    if (LEGACY_UPD === null) { t.skip('e71622a 를 못 읽는다'); return; }
    assert.strictEqual(Object.keys(LEGACY_UPD).length, 9,
        '옛 소스에서 손으로 쓴 update 를 9개 찾아야 한다: ' +
        Object.keys(LEGACY_UPD).length + '개');
});

if (LEGACY_UPD) {
    for (const [name, want] of Object.entries(LEGACY_UPD)) {
        test('표가 옛 UPDATE 와 같다: ' + name, function () {
            const seen = capture(name, objFor(want.cols.concat(['ri', 'lt', 'st'])));

            const body = seen.filter(function (s) {
                return new RegExp('update `' + want.table + '` set').test(s.sql);
            });
            assert.strictEqual(body.length, 1,
                name + ' 이 ' + want.table + ' 을 한 번 고쳐야 한다. 실제 SQL:\n  ' +
                seen.map(function (s) { return s.sql; }).join('\n  '));

            const setPart = (body[0].sql.match(/set ([\s\S]*?) where/) || [])[1] || '';
            const cols = setPart.split(',').map(function (s) {
                return s.trim().split(/\s*=/)[0].trim().replace(/`/g, '');
            });

            assert.deepStrictEqual(cols.slice().sort(), want.cols.slice().sort(),
                name + ' 의 set 컬럼이 옛것과 다르다\n' +
                '  옛것: ' + want.cols.join(', ') + '\n' +
                '  지금: ' + cols.join(', '));

            // where 는 반드시 ri 다. 빠지면 테이블 전체를 덮어쓴다.
            assert.ok(/where `ri` = \?/.test(body[0].sql),
                name + ' 에 where ri 가 없다 — 테이블 전체가 덮인다: ' + body[0].sql);
        });
    }
}

test('본문 insert 가 실패하면 lookup 행을 되돌린다', function () {
    // 고아 lookup 행은 이후 discovery 를 깨뜨린다. 옛 코드에도 있던 보호다.
    const DB = path.join(ROOT, 'mobius', 'db');
    for (const m of [DB, path.join(DB, 'mysql.js'), path.join(DB, 'sqlite.js'),
                     path.join(ROOT, 'mobius', 'sql_action.js')]) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    const real = adapter.execute;

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push(sql);
        // 본문(grp) insert 만 실패시킨다.
        if (/insert into `grp`/.test(sql)) { return cb(new Error('boom')); }
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    db.connect('h', 1, 'u', 'p', function () {});
    const sql_action = require(path.join(ROOT, 'mobius', 'sql_action.js'));

    let done = false;
    sql_action.insert_grp({}, objFor(['ri', 'cr', 'mt', 'cnm', 'mnm', 'mid', 'macp', 'mtv', 'csy', 'gn']),
        function (err) {
            done = true;
            assert.ok(err, '본문 실패가 호출자에게 전달돼야 한다');
        });
    adapter.execute = real;

    assert.ok(done, '콜백이 안 불렸다');
    const rollback = seen.filter(function (s) { return /delete from `lookup`/.test(s); });
    assert.strictEqual(rollback.length, 1,
        'lookup 되돌리기가 없다 — 고아 행이 남는다. 나간 SQL:\n  ' + seen.join('\n  '));
});

test('JSON 컬럼은 문자열로 바인딩된다', function () {
    const seen = capture('insert_csr', {
        ri: '/M/csr1', pi: '/M', ty: '16', ct: '20260101T000000',
        cst: '1', poa: ['http://a'], cb: '/M', csi: '/x', mei: '', tri: '',
        rr: 'true', nl: '', srv: ['2a']
    });
    const body = seen.filter(function (s) { return /insert into `csr`/.test(s.sql); })[0];
    assert.ok(body, 'csr insert 가 없다');
    assert.ok(body.bindings.indexOf('["http://a"]') >= 0,
        'poa 가 JSON 문자열로 안 들어갔다: ' + JSON.stringify(body.bindings));
    assert.ok(body.bindings.indexOf('["2a"]') >= 0,
        'srv 가 JSON 문자열로 안 들어갔다: ' + JSON.stringify(body.bindings));
});

test('값은 바인딩으로 나간다 — SQL 문자열에 인라인되지 않는다', function () {
    // 옛 코드는 값을 SQL 안에 넣고 JSON 컬럼마다 손으로 이스케이프했다.
    // 하나만 빠져도 Injection 이다 (이 저장소에서 3건 나왔다).
    const evil = "x' or '1'='1";
    const seen = capture('insert_nod', {
        ri: '/M/n1', pi: '/M', ty: '14', ct: '20260101T000000',
        ni: evil, hcl: '', mgca: ''
    });
    const body = seen.filter(function (s) { return /insert into `nod`/.test(s.sql); })[0];
    assert.ok(body, 'nod insert 가 없다');
    assert.strictEqual(body.sql.indexOf(evil), -1,
        '값이 SQL 문자열에 들어갔다: ' + body.sql);
    assert.ok(body.bindings.indexOf(evil) >= 0, '값이 바인딩에 없다');
});
