'use strict';
// 전환된 함수가 값을 바인딩으로 넘기는지 확인한다.
// 문자열 보간이면 따옴표가 SQL 구조를 깨뜨리고, 바인딩이면 값으로만 남는다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-sqli-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

// ACP 정책에 따옴표가 섞여 들어와도 SQL 구조가 깨지지 않아야 한다.
const EVIL = '{"acr":[{"acor":["a\'); drop table acp; --"],"acop":63}]}';

test('update_acp 의 pv 는 바인딩으로 나간다 (MySQL)', function () {
    const db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    const n = db.k('acp').update({ pv: EVIL, pvs: '{}' }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0, 'SQL 본문에 값이 박히면 안 된다');
    assert.ok(n.bindings.indexOf(EVIL) >= 0, '값은 바인딩으로 가야 한다');
});

test('update_acp 의 pv 는 바인딩으로 나간다 (SQLite)', function () {
    const db = freshDb(true);
    db.connect('h', 1, 'u', 'p', function () {});
    const n = db.k('acp').update({ pv: EVIL, pvs: '{}' }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0);
    assert.ok(n.bindings.indexOf(EVIL) >= 0);
});

test('update_lookup 의 acpi/at/aa/subl 이 바인딩으로 나간다', function () {
    const db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    const n = db.k('lookup').update({
        lt: '20260826T000000', acpi: EVIL, et: '20280826T000000', st: 1,
        lbl: '[]', at: '[]', aa: '[]', subl: '[]'
    }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0);
    assert.ok(n.bindings.indexOf(EVIL) >= 0);
});
