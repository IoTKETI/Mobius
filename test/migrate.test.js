'use strict';
// 마이그레이션 러너.
//
// 개발은 한 곳, 배포는 다른 서버. 코드는 덮어쓰면 되지만 스키마는 아니다.
// 이 저장소에는 그 수단이 없었다 — MySQL 은 아예 경로가 없었고, SQLite 는
// 기동마다 스키마를 재실행하는 우연에 기대고 있었다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const migrate = require('../tools/migrate.js');
const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(os.tmpdir(), 'mobius-migrate-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

function tapCtx(useSqlite, selectRows) {
    const db = freshDb(useSqlite);
    const adapter = require(path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js'));
    const seen = [];
    let sel = 0;

    adapter.execute = function (conn, sql, bindings, cb, opts) {
        seen.push({ sql: sql, bindings: bindings, opts: opts });
        if (/^select/i.test(sql)) {
            const rows = (selectRows && selectRows[sel] !== undefined) ? selectRows[sel] : [];
            sel++;
            return cb(null, rows);
        }
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    adapter.begin = function (h, cb) { cb(null); };
    adapter.commit = function (h, cb) { cb(null); };
    adapter.rollback = function (h, cb) { cb(null); };

    db.connect('h', 1, 'u', 'p', function () {});
    return { ctx: { db: db, conn: {}, backend: useSqlite ? 'sqlite' : 'mysql' }, seen: seen };
}

// --- 마이그레이션 로드 --------------------------------------------------------

test('migrations 디렉터리를 번호순으로 읽는다', function () {
    const list = migrate.loadMigrations();
    assert.ok(list.length >= 1, '마이그레이션이 하나도 없다');
    const ids = list.map(function (m) { return m.id; });
    assert.deepStrictEqual(ids.slice().sort(), ids, '번호순이 아니다: ' + JSON.stringify(ids));
});

test('모든 마이그레이션이 id/description/up 을 갖는다', function () {
    migrate.loadMigrations().forEach(function (m) {
        assert.ok(m.id, 'id 없음');
        assert.ok(m.description, m.id + ': description 없음');
        assert.strictEqual(typeof m.up, 'function', m.id + ': up 이 함수가 아니다');
    });
});

test('id 가 없거나 up 이 없으면 로드가 실패한다', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-bad-'));
    fs.writeFileSync(path.join(dir, '001-noid.js'), 'module.exports = { up: function(){} };');
    assert.throws(function () { migrate.loadMigrations(dir); }, /id 가 없다/);

    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-bad2-'));
    fs.writeFileSync(path.join(dir2, '001-noup.js'), "module.exports = { id: 'x' };");
    assert.throws(function () { migrate.loadMigrations(dir2); }, /up\(\) 이 없다/);
});

test('없는 디렉터리는 빈 배열이다', function () {
    assert.deepStrictEqual(migrate.loadMigrations(path.join(os.tmpdir(), 'no-such-dir-xyz')), []);
});

// --- 남은 것 고르기 -----------------------------------------------------------

const A = { id: '001-a', description: 'a', up: function () {} };
const B = { id: '002-b', description: 'b', backends: ['mysql'], up: function () {} };
const C = { id: '003-c', description: 'c', backends: ['sqlite'], up: function () {} };

test('적용된 것은 빠진다', function () {
    assert.deepStrictEqual(
        migrate.pending([A, B, C], ['001-a'], 'mysql').map(function (m) { return m.id; }),
        ['002-b']);
});

test('backends 가 다르면 빠진다', function () {
    assert.deepStrictEqual(
        migrate.pending([A, B, C], [], 'sqlite').map(function (m) { return m.id; }),
        ['001-a', '003-c']);
});

test('backends 가 없으면 두 백엔드 모두 대상이다', function () {
    ['mysql', 'sqlite'].forEach(function (b) {
        assert.ok(migrate.pending([A], [], b).length === 1, b + ' 에서 빠졌다');
    });
});

// --- 이력 테이블 --------------------------------------------------------------

test('schema_migrations 를 IF NOT EXISTS 로 만든다', function (t, done) {
    const { ctx, seen } = tapCtx(true);
    migrate.ensureTable(ctx, function (err) {
        try {
            assert.ok(!err, JSON.stringify(err));
            assert.match(seen[0].sql, /create table if not exists schema_migrations/i);
            done();
        } catch (e) { done(e); }
    });
});

test('적용 이력을 id 순으로 읽는다', function (t, done) {
    const { ctx, seen } = tapCtx(true, [[{ id: '001-a' }, { id: '002-b' }]]);
    migrate.appliedIds(ctx, function (err, ids) {
        try {
            assert.ok(!err);
            assert.deepStrictEqual(ids, ['001-a', '002-b']);
            assert.match(seen[0].sql.toLowerCase(), /order by/);
            done();
        } catch (e) { done(e); }
    });
});

// --- 적용 --------------------------------------------------------------------

test('적용하면 이력에 기록한다', function (t, done) {
    const { ctx, seen } = tapCtx(true);
    let ran = false;
    const m = { id: '009-x', description: 'x', up: function (c, cb) { ran = true; cb(null, {}); } };

    migrate.apply(ctx, [m], function (err, applied) {
        try {
            assert.ok(!err, JSON.stringify(err));
            assert.strictEqual(ran, true, 'up 이 안 불렸다');
            assert.deepStrictEqual(applied, ['009-x']);
            const ins = seen.filter(function (s) { return /^insert into `schema_migrations`/i.test(s.sql); });
            assert.strictEqual(ins.length, 1, '이력 기록이 없다');
            assert.ok(ins[0].bindings.indexOf('009-x') !== -1, 'id 가 안 들어갔다');
            done();
        } catch (e) { done(e); }
    });
});

// 이어지는 마이그레이션이 앞의 것을 전제할 수 있으므로 중간에 멈춰야 한다.
test('하나가 실패하면 뒤엣것을 실행하지 않는다', function (t, done) {
    const { ctx } = tapCtx(true);
    let secondRan = false;
    const bad = { id: '010-bad', description: 'bad', up: function (c, cb) { cb(true, { code: 'BOOM' }); } };
    const after = { id: '011-after', description: 'after', up: function (c, cb) { secondRan = true; cb(null, {}); } };

    migrate.apply(ctx, [bad, after], function (err, applied) {
        try {
            assert.ok(err, '실패를 알려야 한다');
            assert.strictEqual(secondRan, false, '실패 후에도 다음이 돌았다');
            assert.deepStrictEqual(applied, []);
            done();
        } catch (e) { done(e); }
    });
});

test('실패한 마이그레이션은 이력에 남지 않는다', function (t, done) {
    const { ctx, seen } = tapCtx(true);
    const bad = { id: '012-bad', description: 'bad', up: function (c, cb) { cb(true, { code: 'BOOM' }); } };
    migrate.apply(ctx, [bad], function () {
        try {
            const ins = seen.filter(function (s) { return /^insert into `schema_migrations`/i.test(s.sql); });
            assert.deepStrictEqual(ins, [], '실패했는데 이력에 남았다');
            done();
        } catch (e) { done(e); }
    });
});

// --- 자동 실행 금지 -----------------------------------------------------------

test('app.js / mobius.js 가 마이그레이션을 자동 실행하지 않는다', function () {
    ['app.js', 'mobius.js'].forEach(function (f) {
        const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        assert.strictEqual(/require\([^)]*tools\/migrate/.test(src), false,
            f + ' 가 마이그레이션 러너를 부른다 — 기동 시 자동 실행은 금지다');
    });
});

// --- 001 마이그레이션 ---------------------------------------------------------

test('001: MySQL 전용이고 ONLINE DDL 을 쓴다', function () {
    const m = migrate.loadMigrations().filter(function (x) {
        return x.id === '001-lookup-pi-ty-ct-index';
    })[0];
    assert.ok(m, '001 을 못 찾았다');
    assert.deepStrictEqual(m.backends, ['mysql'],
        'SQLite 는 스키마 파일이 이미 만든다');
    assert.strictEqual(typeof m.inspect, 'function', '--check 용 inspect 가 필요하다');
});

test('001: up 이 ALGORITHM=INPLACE, LOCK=NONE 으로 만든다', function (t, done) {
    const { ctx, seen } = tapCtx(false);
    const m = migrate.loadMigrations().filter(function (x) {
        return x.id === '001-lookup-pi-ty-ct-index';
    })[0];

    m.up(ctx, function (err) {
        try {
            assert.ok(!err, JSON.stringify(err));
            const ddl = seen.filter(function (s) { return /alter table/i.test(s.sql); })[0];
            assert.ok(ddl, 'ALTER 가 안 나갔다');
            assert.match(ddl.sql, /idx_lookup_pi_ty_ct \(pi, ty, ct\)/,
                '인덱스 정의가 다르다: ' + ddl.sql);
            assert.match(ddl.sql, /ALGORITHM=INPLACE/, '무중단 옵션이 없다: ' + ddl.sql);
            assert.match(ddl.sql, /LOCK=NONE/, '무중단 옵션이 없다: ' + ddl.sql);
            done();
        } catch (e) { done(e); }
    });
});

test('001: inspect 는 읽기만 한다', function (t, done) {
    const { ctx, seen } = tapCtx(false, [[{ n: 0 }], [{ n: 57400339, mb: 21850 }]]);
    const m = migrate.loadMigrations().filter(function (x) {
        return x.id === '001-lookup-pi-ty-ct-index';
    })[0];

    m.inspect(ctx, function (err, note) {
        try {
            assert.ok(!err, JSON.stringify(note));
            const writes = seen.filter(function (s) { return /^(alter|create|insert|update|delete)/i.test(s.sql); });
            assert.deepStrictEqual(writes, [], 'inspect 가 쓰기를 했다');
            assert.match(note, /없음/, '상태 설명이 이상하다: ' + note);
            done();
        } catch (e) { done(e); }
    });
});

// 2026-08-28 배포 서버 실측: 기본 60초 타임아웃 때문에 드라이버가 커넥션을
// 먼저 끊었는데 MySQL 은 DDL 을 계속 진행했다. 러너는 실패로 보고하고 이력도
// 안 남기는데 인덱스는 만들어지는 어긋난 상태가 된다.
test('001: DDL 은 드라이버 타임아웃 없이 실행한다', function (t, done) {
    const { ctx, seen } = tapCtx(false, [[{ n: 0 }]]);
    const m = migrate.loadMigrations().filter(function (x) {
        return x.id === '001-lookup-pi-ty-ct-index';
    })[0];

    m.up(ctx, function (err) {
        try {
            assert.ok(!err, JSON.stringify(err));
            const ddl = seen.filter(function (s) { return /alter table/i.test(s.sql); })[0];
            assert.ok(ddl, 'ALTER 가 안 나갔다');
            assert.ok(ddl.opts && ddl.opts.timeoutMs === 0,
                'DDL 에 timeoutMs: 0 이 안 붙었다: ' + JSON.stringify(ddl.opts));
            done();
        } catch (e) { done(e); }
    });
});

// MySQL 에는 CREATE INDEX IF NOT EXISTS 가 없다. 위 상황(타임아웃 후 서버는 완료)
// 뒤 재실행이 "Duplicate key name" 으로 막히면 안 된다.
test('001: 인덱스가 이미 있으면 만들지 않는다', function (t, done) {
    const { ctx, seen } = tapCtx(false, [[{ n: 1 }]]);
    const m = migrate.loadMigrations().filter(function (x) {
        return x.id === '001-lookup-pi-ty-ct-index';
    })[0];

    m.up(ctx, function (err) {
        try {
            assert.ok(!err, JSON.stringify(err));
            const ddl = seen.filter(function (s) { return /alter table/i.test(s.sql); });
            assert.deepStrictEqual(ddl, [], '이미 있는데 ALTER 를 또 쳤다');
            done();
        } catch (e) { done(e); }
    });
});

// 파사드가 opts 를 어댑터까지 그대로 넘겨야 위 두 가지가 성립한다.
test('facade.run 이 opts 를 어댑터에 전달한다', function (t, done) {
    const { ctx, seen } = tapCtx(false);
    ctx.db.run(ctx.db.raw('select 1'), ctx.conn, function () {
        try {
            assert.ok(seen[0].opts && seen[0].opts.timeoutMs === 0,
                'opts 가 전달되지 않았다: ' + JSON.stringify(seen[0].opts));
            done();
        } catch (e) { done(e); }
    }, { timeoutMs: 0 });
});
