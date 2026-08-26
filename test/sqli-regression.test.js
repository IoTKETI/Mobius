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

// 위 테스트들은 파사드가 바인딩한다는 것만 증명한다. 전환된 함수가 파사드를
// 그렇게 쓰는지는 별개 문제다 — sql_action.js 안에 util.format 이 다시 들어와도
// 위 테스트는 통과한다. 그래서 실제 export 를 호출해 드라이버에 무엇이 도달하는지 본다.
function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapterPath = path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js');
    const adapter = require(adapterPath);
    const calls = [];

    adapter.execute = function (handle, sql, bindings, callback) {
        calls.push({ sql: sql, bindings: bindings });
        callback(null, { affectedRows: 1, insertId: 0 });
    };

    // update_acp / update_sub 는 이제 db.transaction() 안에서 돈다. MySQL 어댑터의
    // begin/commit 은 실제 핸들의 메서드를 부르는데, 이 테스트는 connection 으로
    // null 을 넘기므로 스텁이 필요하다. (운영에서는 request.db_connection 이 온다.)
    adapter.begin = function (handle, callback) { callback(null); };
    adapter.commit = function (handle, callback) { callback(null); };
    adapter.rollback = function (handle, callback) { callback(null); };

    db.connect('h', 1, 'u', 'p', function () {});

    // sql_action 이 파사드를 재사용하도록 캐시에서 지운 뒤 다시 로드한다.
    const SA = path.join(__dirname, '..', 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    const sql_action = require(SA);

    return { sql_action: sql_action, calls: calls };
}

// obj 는 update_acp 가 실제로 받는 형태를 흉내낸다.
function acpObj(evil) {
    return {
        ri: '/Mobius/acp1', lt: '20260826T000000', et: '20280826T000000', st: 1,
        acpi: [], lbl: [], at: [], aa: [], subl: [],
        pv: { acr: [{ acor: [evil], acop: 63 }] },
        pvs: { acr: [{ acor: ['S'], acop: 63 }] }
    };
}

test('exports.update_acp 이 드라이버에 값을 바인딩으로 넘긴다 (SQLite)', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.update_acp(null, acpObj("a'); drop table acp; --"), function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.ok(calls.length >= 2, 'lookup 과 acp 두 번 실행되어야 한다, 실제: ' + calls.length);
        calls.forEach(function (c, i) {
            assert.ok(c.sql.indexOf('drop table') < 0,
                i + '번째 SQL 본문에 값이 박혔다: ' + c.sql);
        });
        const bound = calls.map(function (c) { return JSON.stringify(c.bindings); }).join(' ');
        assert.ok(bound.indexOf('drop table') >= 0, '값이 바인딩으로 가야 한다');
        done();
    });
});

test('exports.update_acp 이 드라이버에 값을 바인딩으로 넘긴다 (MySQL)', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.update_acp(null, acpObj("b'); drop table acp; --"), function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        calls.forEach(function (c, i) {
            assert.ok(c.sql.indexOf('drop table') < 0,
                i + '번째 SQL 본문에 값이 박혔다: ' + c.sql);
        });
        const bound = calls.map(function (c) { return JSON.stringify(c.bindings); }).join(' ');
        assert.ok(bound.indexOf('drop table') >= 0);
        done();
    });
});

test('exports.update_lookup 이 acpi/at/aa/subl 을 바인딩으로 넘긴다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    const evil = "c'); drop table lookup; --";
    sql_action.update_lookup(null, {
        ri: '/Mobius/x', lt: '20260826T000000', et: '20280826T000000', st: 1,
        acpi: [evil], lbl: [], at: [evil], aa: [evil], subl: [evil]
    }, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1);
        assert.ok(calls[0].sql.indexOf('drop table') < 0, 'SQL 본문에 값이 박혔다: ' + calls[0].sql);
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('drop table') >= 0);
        done();
    });
});

// obj 는 update_sub 가 실제로 받는 형태를 흉내낸다.
function subObj(evil) {
    return {
        ri: '/Mobius/sub1', lt: '20260826T000000', et: '20280826T000000', st: 1,
        acpi: [], lbl: [], at: [], aa: [], subl: [],
        enc: { net: [1] }, exc: 10, nu: [evil], gpi: 'g1', nfu: 'nfu1',
        bn: 1, rl: 1, pn: 1, nsp: 1, ln: 1, nct: 2, nec: 1
    };
}

// 전환 전에는 update_lookup 은 분기하지만 sub 본문 UPDATE 는 db.getResult 를
// 무조건 호출해 MySQL 드라이버로 나갔다 — SQLite 모드에서 구독 갱신이 조용히 유실됐다.
// 이 테스트는 SQLite 모드에서 sub UPDATE 가 실제로 SQLite 드라이버에 도달하는지,
// 그리고 값이 바인딩으로 나가는지를 함께 확인한다.
test('exports.update_sub 이 드라이버에 값을 바인딩으로 넘긴다 (SQLite)', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.update_sub(null, subObj("d'); drop table sub; --"), function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.ok(calls.length >= 2, 'lookup 과 sub 두 번 실행되어야 한다, 실제: ' + calls.length);
        calls.forEach(function (c, i) {
            assert.ok(c.sql.indexOf('drop table') < 0,
                i + '번째 SQL 본문에 값이 박혔다: ' + c.sql);
        });
        const bound = calls.map(function (c) { return JSON.stringify(c.bindings); }).join(' ');
        assert.ok(bound.indexOf('drop table') >= 0, '값이 바인딩으로 가야 한다');
        done();
    });
});
