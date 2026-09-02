'use strict';
// usesqlite 분기가 "실행자만 다른" 함수들의 전환 검증.
//
// 이 함수들은 SQL 을 분기 밖에서 한 번 만들고, 분기 안에서는 sqlite.getResult /
// db.getResult 중 어느 쪽으로 보낼지만 골랐다. 파사드가 그 선택을 대신하므로
// 분기가 통째로 사라진다.
//
// 함께 확인하는 것:
//   - 값이 전부 바인딩으로 나가는가 (기존 SQL 은 util.format 문자열 보간이었다)
//   - 구 경로(db_action/db_sqlite)로 새지 않는가
//   - 두 백엔드가 같은 형태를 내는가
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-merged-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

function tapAdapter(useSqlite, selectRows) {
    const db = freshDb(useSqlite);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));
    const seen = [];
    let sel = 0;

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        if (/^select/i.test(sql)) {
            const rows = (selectRows && selectRows[sel] !== undefined) ? selectRows[sel] : [];
            sel++;
            return cb(null, rows);
        }
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    adapter.begin = function (h, cb) { seen.push({ sql: 'BEGIN' }); cb(null); };
    adapter.commit = function (h, cb) { seen.push({ sql: 'COMMIT' }); cb(null); };
    adapter.rollback = function (h, cb) { seen.push({ sql: 'ROLLBACK' }); cb(null); };

    db.connect(function () {});

    // 구 경로(db_action / db_sqlite)의 getResult 를 가로채 "그쪽으로 샜는가"
    // 를 보던 자리다. 두 파일을 지웠으므로(2026-09-01) 샐 곳이 없다.
    // 되살아나지 않았는지는 test/db-adapter-contract.test.js 가 본다.

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    return { sql_action: require(path.join(__dirname, '..', 'mobius', 'sql_action.js')), seen: seen };
}

function assertNoLegacy(seen) {
    const leaked = seen.filter(function (s) { return /^LEGACY_/.test(s.sql); });
    assert.deepStrictEqual(leaked.map(function (s) { return s.legacySql; }), [],
        '구 경로로 샌 쿼리가 있다');
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

const EVIL = "x'); drop table lookup; --";

// 두 백엔드에서 같은 함수를 돌려, 파사드를 거치고 값을 바인딩하는지 본다.
function bothBackends(name, run) {
    [true, false].forEach(function (useSqlite) {
        const label = useSqlite ? 'SQLite' : 'MySQL';
        test(name + ' (' + label + ')', function (t, done) {
            const ctx = tapAdapter(useSqlite, run.rows);
            run.call(ctx, ctx.sql_action, guard(done, function () {
                assertNoLegacy(ctx.seen);
                assert.ok(ctx.seen.length > 0, 'SQL 이 하나도 안 나갔다');
                ctx.seen.forEach(function (q, i) {
                    assert.strictEqual(q.sql.indexOf('drop table'), -1,
                        i + '번째 SQL 본문에 값이 박혔다: ' + q.sql);
                });
                done();
            }));
        });
    });
}

bothBackends('select_lookup', function (sa, cb) {
    sa.select_lookup({}, EVIL, cb);
});

bothBackends('select_ri_lookup', function (sa, cb) {
    sa.select_ri_lookup({}, EVIL, cb);
});

bothBackends('select_ae', function (sa, cb) {
    sa.select_ae({}, EVIL, cb);
});

bothBackends('select_acp', function (sa, cb) {
    sa.select_acp({}, EVIL, cb);
});

bothBackends('select_acp_in', function (sa, cb) {
    sa.select_acp_in({}, [EVIL, 'other'], cb);
});

bothBackends('get_hit_all', function (sa, cb) {
    sa.get_hit_all({}, cb);
});

bothBackends('delete_ri_lookup', function (sa, cb) {
    sa.delete_ri_lookup({}, EVIL, cb);
});

bothBackends('update_grp', function (sa, cb) {
    sa.update_grp({}, {
        ri: EVIL, lt: 'L', acpi: [], et: 'E', st: 1, lbl: [], at: [], aa: [], subl: [],
        mnm: 10, mid: [], macp: [], gn: 'g'
    }, cb);
});

bothBackends('update_lcp', function (sa, cb) {
    sa.update_lcp({}, {
        ri: EVIL, lt: 'L', acpi: [], et: 'E', st: 1, lbl: [], at: [], aa: [], subl: [],
        lou: 'u', lon: 'n'
    }, cb);
});

// --- upsert: 방언 차이는 knex 가 흡수한다 -------------------------------------
// 예전에는 SQLite 가 ON CONFLICT(ct) DO UPDATE, MySQL 이 ON DUPLICATE KEY UPDATE
// 로 갈라져 있었다. 같은 문장을 두 번 쓰던 것이라 knex 가 대신 고른다.

test('set_hit: SQLite 는 ON CONFLICT 를 낸다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.set_hit({}, 'H', guard(done, function (err) {
        assert.ok(!err, JSON.stringify(err));
        assertNoLegacy(seen);
        assert.match(seen[0].sql, /on conflict/i, seen[0].sql);
        done();
    }));
});

test('set_hit: MySQL 은 ON DUPLICATE KEY 를 낸다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.set_hit({}, 'H', guard(done, function (err) {
        assert.ok(!err, JSON.stringify(err));
        assertNoLegacy(seen);
        assert.match(seen[0].sql, /on duplicate key/i, seen[0].sql);
        done();
    }));
});

test('set_hit: 카운터를 대입이 아니라 증분한다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.set_hit({}, 'M', guard(done, function () {
        assert.match(seen[0].sql, /mqtt\s*\+/i, '증분이 아니다: ' + seen[0].sql);
        done();
    }));
});

test('set_hit_n: 두 백엔드 모두 파사드를 거친다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.set_hit_n({}, '20260828', 1, 0, 0, 0, guard(done, function (err) {
        assert.ok(!err, JSON.stringify(err));
        assertNoLegacy(seen);
        assert.match(seen[0].sql, /on conflict/i);
        done();
    }));
});

// insert_cb 는 먼저 insert_lookup 을 부르는데 그건 아직 미전환(real 분기)이라
// 구 경로로 나간다. 여기서는 cb 삽입 자체만 본다.
[true, false].forEach(function (useSqlite) {
    test('insert_cb: cb 삽입이 파사드를 거치고 값을 바인딩한다 (' +
        (useSqlite ? 'SQLite' : 'MySQL') + ')', function (t, done) {
        const { sql_action, seen } = tapAdapter(useSqlite);
        sql_action.insert_cb({}, {
            ri: '/M/cb', ty: '5', ct: 'C', st: 0, rn: 'r', lt: 'L', et: 'E',
            acpi: [], lbl: [], at: [], aa: [], sri: 's', spi: 'p', subl: [],
            cst: 1, csi: '/x', srt: [1, 2], poa: [EVIL], nl: '', ncp: '', srv: ['2a']
        }, guard(done, function () {
            const cbIns = seen.filter(function (s) { return /^insert into `cb`/i.test(s.sql); });
            assert.strictEqual(cbIns.length, 1, 'cb 삽입이 파사드로 안 나갔다');
            assert.strictEqual(cbIns[0].sql.indexOf('drop table'), -1,
                'SQL 본문에 값이 박혔다: ' + cbIns[0].sql);
            assert.ok(JSON.stringify(cbIns[0].bindings).indexOf('drop table') >= 0,
                '값이 바인딩으로 가야 한다');
            done();
        }));
    });
});

// --- 분기가 실제로 사라졌는지 ------------------------------------------------

test('전환한 함수들에 usesqlite 분기가 남아 있지 않다', function () {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');
    const names = ['select_lookup', 'select_ri_lookup', 'select_ae', 'select_acp',
        'select_acp_in', 'get_hit_all', 'delete_ri_lookup', 'update_grp', 'update_lcp',
        'select_spec_ri', 'select_resource_from_url', 'select_acp_cnt',
        'set_hit', 'set_hit_n', 'insert_cb'];

    names.forEach(function (n) {
        const i = src.indexOf('exports.' + n + ' = function');
        assert.ok(i >= 0, n + ' 를 못 찾았다');
        const body = src.slice(i);
        const end = body.indexOf('\nexports.');
        assert.strictEqual(body.slice(0, end).indexOf('global.usesqlite'), -1,
            n + ' 안에 usesqlite 분기가 남아 있다');
    });
});

test('호출부 없는 함수들이 제거되었다', function () {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');

    // 파사드 전환 중에 발견한 것들. 옮기는 것보다 지우는 것이 맞다 —
    // 죽은 코드를 옮기면 유지할 표면만 늘고 목표에는 보탬이 없다.
    const gone = {
        select_count_ri: '호출부 0',
        delete_ri_lookup_in: '호출부 0, MySQL 전용 DELETE ... LIMIT',
        select_grp_lookup: '호출부 0 — 그룹 조회는 select_resource_from_url 이 한다',
        select_grp: '호출부 0',
        select_sub: '호출부 0 — 알림은 lookup.subl 캐시를 읽는다',
        select_st: '호출부 0 — st 는 select_cni_parent 가 함께 읽는다'
    };

    for (const [name, why] of Object.entries(gone)) {
        assert.strictEqual(new RegExp('^exports\\.' + name + '\\s*=', 'm').test(src), false,
            name + ' 가 남아 있다 (' + why + ')');
    }
});

test('살아 있는 csr 조회 둘은 파사드를 쓴다', function () {
    // 이 둘은 update_route(app.js)가 fanOutPoint 와 그룹 생성마다 부른다.
    // SQLite 스키마에는 csr 테이블이 아예 없어서, 이 경로가 SQLite 에서
    // grp 생성을 500 으로 만들었다(게이트를 앞당겨 막았다).
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');

    for (const n of ['select_csr_like', 'select_csr']) {
        const i = src.indexOf('exports.' + n + ' = function');
        assert.ok(i >= 0, n + ' 를 못 찾았다');
        const body = src.slice(i, src.indexOf('\nexports.', i + 10));
        assert.ok(/facade\.k\('csr'\)/.test(body), n + ' 가 파사드를 안 쓴다');
        assert.strictEqual(body.indexOf('util.format'), -1,
            n + ' 에 문자열 조립이 남아 있다');
    }

    // LIKE 패턴도 바인딩이어야 한다. 예전에는 cb 를 패턴에 이어 붙였다.
    delete require.cache[require.resolve('../mobius/db')];
    global.usedb = 'mysql';
    const facade = require('../mobius/db');
    const q = facade.k('csr').select('*').where('ri', 'like', '/Mobius/%').toSQL().toNative();
    assert.ok(/like \?/.test(q.sql), 'LIKE 값이 SQL 에 인라인됐다: ' + q.sql);
    assert.deepStrictEqual(q.bindings, ['/Mobius/%']);
    delete require.cache[require.resolve('../mobius/db')];
});
