'use strict';
// Functions whose backend branches differed only in the executor.
//
// These build the SQL once and then chose between sqlite.getResult / db.getResult. The facade makes that choice, so the branch is gone.
//
// Also checked:
//   - every value goes out as a binding
//   - nothing leaks to the legacy path (db_action/db_sqlite)
//   - both backends produce the same shape
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

    // The legacy path (db_action / db_sqlite) no longer exists; test/db-adapter-contract.test.js checks that it does not return.

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

// Runs the same function on both backends and checks that it goes through the facade and binds its values.
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
        ri: EVIL, lt: 'L', acpi: [], et: 'E', st: 1, lbl: [], at: [], aa: [],
        mnm: 10, mid: [], macp: [], gn: 'g'
    }, cb);
});

bothBackends('update_lcp', function (sa, cb) {
    sa.update_lcp({}, {
        ri: EVIL, lt: 'L', acpi: [], et: 'E', st: 1, lbl: [], at: [], aa: [],
        lou: 'u', lon: 'n'
    }, cb);
});

// upsert: knex absorbs the dialect difference (SQLite ON CONFLICT(ct) DO UPDATE, MySQL ON DUPLICATE KEY UPDATE).

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

// insert_cb calls insert_lookup first; only the cb insert itself is checked here.
[true, false].forEach(function (useSqlite) {
    test('insert_cb: cb 삽입이 파사드를 거치고 값을 바인딩한다 (' +
        (useSqlite ? 'SQLite' : 'MySQL') + ')', function (t, done) {
        const { sql_action, seen } = tapAdapter(useSqlite);
        sql_action.insert_cb({}, {
            ri: '/M/cb', ty: '5', ct: 'C', st: 0, rn: 'r', lt: 'L', et: 'E',
            acpi: [], lbl: [], at: [], aa: [], sri: 's', spi: 'p',
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

// The branch is actually gone.

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

    // Functions found dead during the facade migration; deleted rather than moved.
    const gone = {
        select_count_ri: '호출부 0',
        delete_ri_lookup_in: '호출부 0, MySQL 전용 DELETE ... LIMIT',
        select_grp_lookup: '호출부 0 — 그룹 조회는 select_resource_from_url 이 한다',
        select_grp: '호출부 0',
        select_sub: '호출부 0 — 알림은 select_subs_by_pi 로 sub 를 부모 ri 로 읽는다 (2026-09-05, 옛 subl 캐시 아님)',
        select_st: '호출부 0 — st 는 select_cni_parent 가 함께 읽는다'
    };

    for (const [name, why] of Object.entries(gone)) {
        assert.strictEqual(new RegExp('^exports\\.' + name + '\\s*=', 'm').test(src), false,
            name + ' 가 남아 있다 (' + why + ')');
    }
});

test('살아 있는 csr 조회 둘은 파사드를 쓴다', function () {
    // These two are called by update_route (app.js) for every fanOutPoint and group creation. The SQLite schema has no csr table, so this path made grp creation fail with 500 on SQLite; the gate now rejects earlier.
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

    // The LIKE pattern must be a binding as well.
    delete require.cache[require.resolve('../mobius/db')];
    global.usedb = 'mysql';
    const facade = require('../mobius/db');
    const q = facade.k('csr').select('*').where('ri', 'like', '/Mobius/%').toSQL().toNative();
    assert.ok(/like \?/.test(q.sql), 'LIKE 값이 SQL 에 인라인됐다: ' + q.sql);
    assert.deepStrictEqual(q.bindings, ['/Mobius/%']);
    delete require.cache[require.resolve('../mobius/db')];
});
