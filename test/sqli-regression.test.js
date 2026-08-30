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

// ── update_hd_* — WHERE 가 통째로 빠져 있었다 ────────────────────────
//
// 8벌 전부가 이랬다:
//
//     util.format('update fcnt set fcnt.lock = \'%s\'', obj.lock)
//                                                     ^ where 가 없다
//
// 도어록 하나에 PUT 을 보내면 fcnt 테이블의 모든 행이 그 값으로 바뀌었다.
// 실측으로 확인했다 — 컨테이너 두 개를 만들고 한쪽만 PUT 했더니 다른 쪽
// lock 도 함께 true 가 됐다. 배포 규모(5,740만 행)에서는 되돌릴 수 없다.
//
// 값도 이스케이프 없이 조립하고 있어서 인젝션 표면이기도 했다.
// 파사드 바인딩으로 옮겨 둘을 함께 없앴다.

test('fcnt 갱신은 ri 로 대상을 한정한다', function () {
    const db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    const n = db.k('fcnt').update({ lock: 'true' }).where({ ri: '/M/x/d' }).toSQL().toNative();
    assert.ok(/where/i.test(n.sql), 'where 절이 없으면 테이블 전체가 바뀐다: ' + n.sql);
    assert.ok(n.bindings.indexOf('/M/x/d') >= 0, 'ri 가 바인딩으로 가야 한다');
});

test('예약어 lock 도 빌더가 인용한다', function () {
    // 예전에 fcnt.lock 으로 테이블 접두를 붙였던 이유다. 빌더가 방언별로
    // 인용하므로 컬럼명만 넘기면 된다.
    for (const sqlite of [false, true]) {
        const db = freshDb(sqlite);
        db.connect('h', 1, 'u', 'p', function () {});
        const n = db.k('fcnt').update({ lock: 'x' }).where({ ri: '/r' }).toSQL().toNative();
        assert.ok(/["`]lock["`]/.test(n.sql),
            (sqlite ? 'SQLite' : 'MySQL') + ': lock 이 인용되지 않았다 — ' + n.sql);
    }
});

// ── cnt_man 의 카운터 갱신 ────────────────────────────────────────────

test('cnt_man 이 pi 를 문자열로 박지 않는다', function () {
    // pi 는 대상 컨테이너의 ri 이고, 그 ri 는 클라이언트가 준 rn 에서 만들어진다
    // (resource.js 의 build_resource). 따옴표가 든 rn 으로 컨테이너를 만들고
    // 그 아래 cin 을 넣으면, flush 가 그 ri 를 SQL 에 박던 2차 주입이었다.
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'cnt_man.js'), 'utf8');
    // 주석은 세지 않는다 — 왜 이렇게 바꿨는지 설명하느라 옛 형태를 인용한다.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    assert.ok(!/util\.format/.test(code),
        'cnt_man 에 util.format 이 남아 있다 — 값은 바인딩으로 넘길 것');
    assert.ok(!/%s/.test(code),
        'cnt_man 에 %s 문자열 결합이 남아 있다');
    assert.ok(/db_facade\.raw\(/.test(code),
        'cnt_man 이 파사드 raw + 바인딩을 쓰지 않는다');
});

test('cnt_man 의 문장 모양이 백엔드별로 유지된다', function () {
    // MySQL 은 다중 테이블 UPDATE 한 문장이라 두 행이 **다 있을 때만** 갱신된다.
    // 두 문장으로 쪼개면 cnt 행 없는 lookup 고아에서 st 만 올라, 그 컨테이너의
    // 조회 응답과 알림에 실리는 st 가 달라진다. 모양을 바꾸지 않는 것이 계약이다.
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'cnt_man.js'), 'utf8');

    assert.ok(/update cnt, lookup set/.test(src),
        'MySQL 쪽 다중 테이블 UPDATE 가 사라졌다 — 고아 lookup 에서 st 만 오르게 된다');
    assert.ok(/update cnt set cni = cni \+ \?/.test(src),
        'SQLite 쪽 cnt UPDATE 가 사라졌다');
    assert.ok(/update lookup set st = st \+ \?/.test(src),
        'SQLite 쪽 lookup UPDATE 가 사라졌다');
});

test('cnt_man 의 raw 가 바인딩으로 나간다 (양쪽 백엔드)', function () {
    // 따옴표가 든 ri 를 넣어도 SQL 구조가 안 깨지는지 빌더 수준에서 확인한다.
    const EVIL_RI = "/Mobius/x'); drop table cnt; --";
    for (const sqlite of [true, false]) {
        const db = freshDb(sqlite);
        db.connect('h', 1, 'u', 'p', function () {});
        const n = db.raw('update cnt set cni = cni + ?, cbs = cbs + ? where ri = ?',
            [1, 2, EVIL_RI]).toSQL().toNative();
        assert.ok(n.sql.indexOf('drop table') < 0,
            (sqlite ? 'SQLite' : 'MySQL') + ': SQL 본문에 값이 박혔다 — ' + n.sql);
        assert.ok(n.bindings.indexOf(EVIL_RI) >= 0, '값이 바인딩에 없다');
    }
});

test('cnt_man 이 NaN 델타를 걸러낸다', function () {
    // resource.js 가 parseInt(cs) 로 넘기므로 cs 가 없으면 NaN 이다. 그대로
    // 누적되면 entry.cbs 가 영구히 NaN 이고, 그 pi 의 flush 가 매번 통째로
    // 실패해 cni/st 증가까지 잃는다.
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'cnt_man.js'), 'utf8');
    assert.ok(/isFinite\(cs\)/.test(src),
        'schedule 이 cs 를 수로 검사하지 않는다 — NaN 하나가 그 컨테이너의 카운터를 영구히 멈춘다');
});

test('sql_action 에 WHERE 없는 update 가 없다', function () {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');

    // 문자열로 조립하는 update 문 중 where 가 없는 것을 찾는다.
    const bad = [];
    const lines = src.split(/\r?\n/);
    lines.forEach(function (l, i) {
        const m = l.match(/'(update\s+\w+\s+set\s[^']*)'/i);
        if (m && !/where/i.test(m[1])) {
            // 여러 줄로 이어 붙이는 경우가 있으므로 다음 두 줄까지 본다.
            const around = lines.slice(i, i + 3).join(' ');
            if (!/where/i.test(around)) { bad.push((i + 1) + ': ' + l.trim().slice(0, 80)); }
        }
    });
    assert.deepStrictEqual(bad, [],
        'WHERE 없는 update 가 남아 있다 — 테이블 전체를 덮어쓴다:\n  ' + bad.join('\n  '));
});
