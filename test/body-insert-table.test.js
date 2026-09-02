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
const fs = require('node:fs');
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
    global.usedb = 'mysql';

    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    const realExecute = adapter.execute;

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    db.connect(function () {});

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

// **옛 SQL 과 일부러 갈라지는 자리.** 옛것이 틀렸을 때만 여기 적는다.
//
// 이 파일의 나머지는 "전환이 동작을 안 바꿨다" 를 못박는다. 그 대조가
// 의미를 가지려면 예외가 **목록으로 드러나 있어야** 한다 — 대조를 느슨하게
// 고치면 다음 실수가 조용히 지나간다.
const LEGACY_DIVERGENCE = {
    // lcp.cr 은 NOT NULL 인데 기본값이 없다. 옛 코드도 이 컬럼을 안 넣었고,
    // 그래서 배포의 STRICT_TRANS_TABLES 아래에서 **lcp 생성이 언제나
    // 실패했다** (ER_NO_DEFAULT_FOR_FIELD). 로컬 MySQL 에 lcp 사본을 만들어
    // 실제로 거부되는 것을 확인했다.
    //
    // 즉 이것은 전환이 낸 회귀가 아니라 **원래 있던 버그**이고, 옛것과 같게
    // 두면 고칠 수가 없다. 형제들(grp, fcnt, hd_* 여덟)은 전부 cr 을 갖고
    // 있었고 lcp 만 없었다.
    insert_lcp: { added: ['cr'] }
};

if (LEGACY) {
    for (const [name, want] of Object.entries(LEGACY)) {
        test('표가 옛 SQL 과 같다: ' + name, function () {
            const div = LEGACY_DIVERGENCE[name];
            const expect = want.cols.concat(div ? div.added : []);
            const seen = capture(name, objFor(expect));

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

            assert.deepStrictEqual(cols.slice().sort(), expect.slice().sort(),
                name + ' 의 컬럼이 기대와 다르다\n' +
                '  옛것: ' + want.cols.join(', ') +
                (div ? '\n  일부러 더한 것: ' + div.added.join(', ') : '') + '\n' +
                '  지금: ' + cols.join(', '));
        });
    }

    test('옛것과 갈라지는 자리는 목록에 적힌 것뿐이다', function () {
        // 예외 목록이 낡으면(고친 뒤 안 지우면) 대조가 그만큼 헐거워진다.
        const stale = Object.keys(LEGACY_DIVERGENCE).filter(function (n) { return !LEGACY[n]; });
        assert.deepStrictEqual(stale, [],
            'LEGACY_DIVERGENCE 에 옛 소스에 없는 이름이 있다: ' + stale.join(', '));
    });
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
    db.connect(function () {});
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

// 실측으로 잡은 회귀. 이 테스트가 없었으면 배포에 나갔다.
//
// lcp 의 loi/lost 는 create_np_attr_list 에 있어 **클라이언트가 보낼 수 없고**,
// build_lcp 도 채우지 않아 언제나 undefined 다. 빌더는 undefined 를 NULL 로
// 보내는데 그 컬럼들이 NOT NULL 이라 insert 가 통째로 실패했다 — 옛 코드는
// util.format('%s') 로 문자열 "undefined" 를 저장하며 성공하던 자리다.
//
// 로컬 MySQL 에 실제로 만들어 보고서야 드러났다(500 "resource could not be
// created"). SQL 모양만 대조하는 위 테스트들은 이것을 못 잡는다 — 컬럼은
// 맞고 **값**이 틀렸기 때문이다.
test('안 채운 속성이 있어도 insert 가 나간다 (NOT NULL 컬럼)', function () {
    // loi / lost 를 일부러 뺀다.
    const seen = capture('insert_lcp', {
        ri: '/M/lcp1', pi: '/M', ty: '10', ct: '20260101T000000',
        los: '1', lou: 'u', lot: '1', lor: 'r', lon: 'n'
    });
    const body = seen.filter(function (s) { return /insert into `lcp`/.test(s.sql); })[0];
    assert.ok(body, 'lcp insert 가 안 나갔다');

    assert.strictEqual(body.bindings.indexOf(undefined), -1,
        'undefined 가 바인딩에 들어갔다 — NOT NULL 컬럼에서 실패한다: ' +
        JSON.stringify(body.bindings));
    assert.strictEqual(body.bindings.indexOf(null), -1,
        'null 이 바인딩에 들어갔다 — NOT NULL 컬럼에서 실패한다: ' +
        JSON.stringify(body.bindings));
});

test('UPDATE 도 안 채운 속성을 NULL 로 보내지 않는다', function () {
    const seen = capture('update_csr', {
        ri: '/M/csr1', lt: '20260101T000000', st: 1,
        poa: ['http://a']            // mei/tri/rr/nl 을 뺀다
    });
    const body = seen.filter(function (s) { return /update `csr` set/.test(s.sql); })[0];
    assert.ok(body, 'csr update 가 안 나갔다');
    assert.strictEqual(body.bindings.indexOf(undefined), -1,
        'undefined 가 바인딩에 들어갔다: ' + JSON.stringify(body.bindings));
    assert.strictEqual(body.bindings.indexOf(null), -1,
        'null 이 바인딩에 들어갔다: ' + JSON.stringify(body.bindings));
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

// --- 호출부 시그니처 -----------------------------------------------------------
//
// 표에서 만들어지는 빌더는 전부 (connection, obj, callback) 3인자다.
// 옛 코드는 컬럼마다 위치인자를 받았고, 표로 옮기면서 호출부를 같이 고쳤다.
//
// **한 곳을 빠뜨렸었다.** mobius/resource.js 의 update_dvc 가 옛 모양 그대로
// 16인자를 넘기고 있었다. 그러면 obj 자리에 lt 문자열이, callback 자리에
// acpi JSON 문자열이 들어간다. 재현 결과:
//
//     update_dvc undefined: 11ms          <- obj.ri 가 undefined
//     TypeError: callback is not a function
//
// 그 throw 는 update_lookup 의 콜백 안에서 난다. 실제 DB 는 비동기라
// 미처리 예외가 되어 **워커가 죽는다.** 테스트 956개가 전부 초록이었다 —
// mgd=1008(dvc) PUT 을 아무도 안 돌려 봤기 때문이다.
//
// 이름 목록을 손으로 적지 않는다. 소스의 표에서 뽑아야 새 빌더가 늘어도
// 같이 검사된다.
function generatedBuilderNames() {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const out = [];
    for (const t of ['BODY_UPDATES', 'BODY_TABLES']) {
        const m = src.match(new RegExp('var ' + t + ' = \\{([\\s\\S]*?)\\n\\};'));
        if (!m) { continue; }
        const re = /^\s{4}(\w+):/gm;
        let x;
        while ((x = re.exec(m[1])) !== null) { out.push(x[1]); }
    }
    return out;
}

// 괄호 짝을 세어 호출 하나를 통째로 잘라낸다. 정규식은 중첩을 못 센다 —
// 인자 안에 JSON.stringify(...) 같은 호출이 들어 있어서 반드시 필요하다.
function sliceCall(src, from) {
    const open = src.indexOf('(', from);
    let depth = 0, i = open;
    for (; i < src.length; i++) {
        if (src[i] === '(') { depth++; }
        else if (src[i] === ')') { depth--; if (depth === 0) { break; } }
    }
    return src.slice(open + 1, i);
}

// 최상위 콤마만 센다. 문자열 안의 콤마와 중첩 괄호는 빼야 한다.
function countArgs(s) {
    let depth = 0, n = 1, inStr = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (c === '\\') { i++; } else if (c === inStr) { inStr = null; } continue; }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if ('([{'.indexOf(c) >= 0) { depth++; }
        else if (')]}'.indexOf(c) >= 0) { depth--; }
        else if (c === ',' && depth === 0) { n++; }
    }
    return n;
}

test('표에서 만들어지는 빌더의 호출부는 전부 3인자다', function () {
    const names = generatedBuilderNames();
    assert.ok(names.length >= 20,
        '빌더를 ' + names.length + '개만 찾았다 — 표를 읽는 정규식이 낡았을 수 있다');

    const FILES = ['mobius/resource.js', 'app.js', 'mobius/ae.js', 'mobius/cb.js',
                   'mobius/grp.js', 'mobius/sgn.js'];
    const bad = [];
    let calls = 0;

    for (const f of FILES) {
        const p = path.join(ROOT, f);
        if (!fs.existsSync(p)) { continue; }
        const src = fs.readFileSync(p, 'utf8');
        for (const name of names) {
            const re = new RegExp('db_sql\\.' + name + '\\s*\\(', 'g');
            let m;
            while ((m = re.exec(src)) !== null) {
                calls++;
                const n = countArgs(sliceCall(src, m.index));
                if (n !== 3) {
                    const line = src.slice(0, m.index).split('\n').length;
                    bad.push(f + ':' + line + ' ' + name + ' 이 인자 ' + n + '개');
                }
            }
        }
    }

    assert.ok(calls > 0, '호출부를 하나도 못 찾았다 — 검사가 헛돈다');
    assert.deepStrictEqual(bad, [],
        '표에서 만들어지는 빌더는 (connection, obj, callback) 3인자다. ' +
        '옛 위치인자로 부르면 callback 자리에 문자열이 들어가고, ' +
        '그 TypeError 가 비동기 콜백 안에서 나 **워커가 죽는다**:\n  ' + bad.join('\n  '));
});

// --- NOT NULL 컬럼 누락 -------------------------------------------------------
//
// insert 빌더가 그 테이블의 NOT NULL 컬럼을 안 채우면, 배포의
// STRICT_TRANS_TABLES 아래에서 **그 타입의 생성이 언제나 실패한다.**
//
// 실제로 그랬다 — insert_lcp 가 cr 을 빼먹어서 lcp(ty=10) 생성이 항상
// ER_NO_DEFAULT_FOR_FIELD 였다. 로컬 MySQL 에 lcp 사본을 만들어 거부되는
// 것을 확인했다:
//
//     insert into lcp_probe (loi,lon,lor,los,lost,lot,lou,ri) values (...)
//     -> ER_NO_DEFAULT_FOR_FIELD: Field 'cr' doesn't have a default value
//     cr 을 넣으면 통과
//
// 표와 스키마를 둘 다 소스에서 읽는다. 손으로 적은 목록은 갈라진다.
function bodyTableEntries() {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const m = src.match(/var BODY_TABLES = \{([\s\S]*?)\n\};/);
    assert.ok(m, 'BODY_TABLES 를 못 찾았다 — 정규식이 낡았다');
    const out = [];
    const re = /^\s{4}(\w+):\s*\[\s*'([^']+)',\s*'([^']*)'/gm;
    let x;
    while ((x = re.exec(m[1])) !== null) {
        out.push({ name: x[1], table: x[2], cols: x[3].split(/\s+/).filter(Boolean) });
    }
    return out;
}

// 채워야 하는 컬럼: NOT NULL 이면서 기본값이 없는 것.
// DEFAULT / AUTO_INCREMENT / 생성 컬럼은 DB 가 알아서 채운다.
function mustFillCols(schema, table) {
    const t = schema.match(new RegExp('CREATE TABLE `' + table + '` \\(([\\s\\S]*?)\\n\\) ENGINE'));
    if (!t) { return null; }
    const out = [];
    const re = /^\s+`(\w+)`\s+([^,\n]*)/gm;
    let y;
    while ((y = re.exec(t[1])) !== null) {
        const decl = y[2];
        if (!/NOT NULL/i.test(decl)) { continue; }
        if (/DEFAULT/i.test(decl)) { continue; }
        if (/AUTO_INCREMENT/i.test(decl)) { continue; }
        if (/GENERATED ALWAYS/i.test(decl)) { continue; }
        out.push(y[1]);
    }
    return out;
}

test('insert 빌더는 NOT NULL 컬럼을 전부 채운다', function () {
    const schema = fs.readFileSync(require('../mobius/db/mysql').schemaPath, 'utf8');
    const entries = bodyTableEntries();
    assert.ok(entries.length >= 15,
        '빌더를 ' + entries.length + '개만 찾았다 — 표를 읽는 정규식이 낡았다');

    const bad = [];
    let checked = 0;
    for (const e of entries) {
        const need = mustFillCols(schema, e.table);
        assert.ok(need !== null, e.name + ': 스키마에서 테이블 ' + e.table + ' 을 못 찾았다');
        assert.ok(need.length > 0, e.name + ': ' + e.table + ' 에 NOT NULL 컬럼이 하나도 없다 — 파서가 헛돈다');
        checked++;
        const missing = need.filter((c) => e.cols.indexOf(c) < 0);
        if (missing.length) { bad.push(e.name + ' (' + e.table + '): ' + missing.join(' ')); }
    }

    assert.ok(checked === entries.length, '검사 못 한 빌더가 있다');
    assert.deepStrictEqual(bad, [],
        'NOT NULL 인데 기본값이 없는 컬럼을 빌더가 안 채운다. ' +
        'STRICT_TRANS_TABLES 에서 그 타입의 생성이 **언제나** 실패한다:\n  ' + bad.join('\n  '));
});

test('cr 은 본문이 아니라 요청 Origin 에서 온다', function () {
    // cr 은 security.js 의 creator_bypasses 가 접근 허용에 쓰는 값이다.
    // 본문 값을 그대로 쓰면 남의 이름으로 리소스를 만들어 권한을 위조할 수 있다
    // (실측: 201 로 통과하고 cr 이 피해자 ID 로 저장됐다).
    //
    // lcp 에 cr 을 새로 넣으면서 이 규약을 같이 못 박는다.
    const FILES = ['cnt.js', 'grp.js', 'lcp.js'];
    for (const f of FILES) {
        const src = fs.readFileSync(path.join(ROOT, 'mobius', f), 'utf8')
            // 주석이 검사를 만족시키면 안 된다 — 이 저장소가 세 번 겪은 함정이다.
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

        assert.match(src, /\.cr = request\.headers\['x-m2m-origin'\]/,
            'mobius/' + f + ' 가 cr 을 요청 Origin 에서 안 가져온다');
        assert.ok(!/\.cr = body_Obj/.test(src),
            'mobius/' + f + ' 가 cr 을 본문에서 받는다 — 권한 위조가 된다');
    }
});
