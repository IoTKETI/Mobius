'use strict';
// select_spec_ri 는 discovery 로 찾은 lookup 행에 타입 테이블(cnt / cin / ae ...)의
// 속성을 채우고, 타입 테이블에 짝이 없는 행은 응답에서 뺀다.
//
// 예전에는 결과 **한 건마다 질의 하나**를 순차로 던졌다. resource.js 의 retrieve 가
// fu / rcn 과 무관하게 이 함수를 부르므로 lim=2000 이면 CTE 1회 + 단건 조회
// 2,000회였고, 그동안 커넥션 하나를 계속 쥐고 있었다.
//
// 이 파일이 지키는 것:
//   1) 질의 횟수가 결과 건수가 아니라 **타입 수**에 비례한다
//   2) 응답 순서가 보존된다
//   3) 타입 테이블에 없는 행은 빠진다 (lookup 에만 남은 고아)
//   4) 오류와 알 수 없는 ty 는 '500-1' 이고 원인이 로그에 남는다
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-spec-test.db');

// sql_action 은 makeObject 를 전역으로 부른다 (resource.js 가 선언한다).
// 여기서는 행을 건드리지 않는 최소 구현을 둔다.
global.makeObject = global.makeObject || function () { };

// rowsFor(table, ris) -> 그 테이블이 돌려줄 행 배열
function tap(rowsFor) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));

    const seen = [];
    adapter.connect = function (conf, cb) { cb('1'); };
    adapter.execute = function (conn, sql, bindings, cb) {
        // select * from `cnt` where `ri` in (?, ?, ...)
        const m = /from `([^`]+)`/i.exec(sql);
        const table = m ? m[1] : '?';
        seen.push({ table: table, sql: sql, bindings: bindings });
        const rows = rowsFor(table, bindings || []);
        if (rows instanceof Error) { return cb(rows, null); }
        cb(null, rows);
    };
    db.connect('h', 1, 'u', 'p', function () {});

    delete require.cache[require.resolve(path.join(ROOT, 'mobius', 'sql_action.js'))];
    return { sql_action: require(path.join(ROOT, 'mobius', 'sql_action.js')), seen: seen };
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

// lookup 행 흉내. ty 3 = cnt, 4 = cin, 2 = ae
function lookupRows(specs) {
    const o = {};
    specs.forEach(function (s) { o[s.ri] = { ri: s.ri, ty: s.ty, rn: s.rn || 'r' }; });
    return o;
}

// --- 1) 질의 횟수가 타입 수에 비례한다 ---------------------------------------

test('같은 타입 100건이면 질의는 한 번이다', function (t, done) {
    const h = tap((table, ris) => ris.map((ri) => ({ ri: ri, cni: 1 })));
    const found = lookupRows(Array.from({ length: 100 }, (_, i) => ({ ri: '/M/c' + i, ty: 3 })));
    h.sql_action.select_spec_ri(null, found, 0, guard(done, function (code) {
        assert.strictEqual(code, '200');
        assert.strictEqual(h.seen.length, 1,
            '건마다 던지던 시절로 돌아갔다: ' + h.seen.length + '회');
        assert.strictEqual(h.seen[0].table, 'cnt');
        assert.strictEqual(Object.keys(found).length, 100);
        done();
    }));
});

test('타입이 세 종이면 질의는 세 번이다', function (t, done) {
    const h = tap((table, ris) => ris.map((ri) => ({ ri: ri })));
    const found = lookupRows([
        { ri: '/M/a', ty: 2 }, { ri: '/M/c', ty: 3 }, { ri: '/M/c/i', ty: 4 },
        { ri: '/M/c2', ty: 3 }, { ri: '/M/a2', ty: 2 }
    ]);
    h.sql_action.select_spec_ri(null, found, 0, guard(done, function (code) {
        assert.strictEqual(code, '200');
        assert.strictEqual(h.seen.length, 3, h.seen.length + '회');
        assert.deepStrictEqual(h.seen.map((s) => s.table).sort(), ['ae', 'cin', 'cnt']);
        done();
    }));
});

test('500건을 넘으면 청크로 나눈다', function (t, done) {
    const h = tap((table, ris) => ris.map((ri) => ({ ri: ri })));
    const found = lookupRows(Array.from({ length: 1200 }, (_, i) => ({ ri: '/M/c' + i, ty: 3 })));
    h.sql_action.select_spec_ri(null, found, 0, guard(done, function (code) {
        assert.strictEqual(code, '200');
        assert.strictEqual(h.seen.length, 3, '1200건이면 500씩 3회: ' + h.seen.length);
        assert.strictEqual(h.seen[0].bindings.length, 500);
        assert.strictEqual(h.seen[2].bindings.length, 200);
        assert.strictEqual(Object.keys(found).length, 1200, '한 건도 잃으면 안 된다');
        done();
    }));
});

test('결과가 없으면 질의를 안 던진다', function (t, done) {
    const h = tap(() => []);
    const found = {};
    h.sql_action.select_spec_ri(null, found, 0, guard(done, function (code) {
        assert.strictEqual(code, '200');
        assert.strictEqual(h.seen.length, 0);
        done();
    }));
});

// --- 2) 순서가 보존된다 ------------------------------------------------------
//
// 키 순서가 곧 응답 순서다. 이미 있는 키에만 대입해야 자리가 유지된다 —
// 지웠다 다시 넣으면 그 키가 맨 뒤로 간다.

test('타입이 섞여 있어도 원래 순서가 유지된다', function (t, done) {
    const h = tap((table, ris) => ris.map((ri) => ({ ri: ri })));
    const order = ['/M/a', '/M/c', '/M/c/i', '/M/c2', '/M/a2'];
    const found = lookupRows([
        { ri: '/M/a', ty: 2 }, { ri: '/M/c', ty: 3 }, { ri: '/M/c/i', ty: 4 },
        { ri: '/M/c2', ty: 3 }, { ri: '/M/a2', ty: 2 }
    ]);
    h.sql_action.select_spec_ri(null, found, 0, guard(done, function () {
        assert.deepStrictEqual(Object.keys(found), order,
            '타입별로 묶어 던지면서 순서가 뒤섞였다');
        done();
    }));
});

// --- 3) 타입 테이블에 없는 행은 응답에서 뺀다 --------------------------------
//
// lookup 에만 남은 고아다. 배포 서버에 ty=3 기준 2건 있다.

test('타입 테이블에 짝이 없는 행은 빠진다', function (t, done) {
    // /M/c1 만 cnt 에 있다
    const h = tap((table, ris) => ris.filter((ri) => ri === '/M/c1').map((ri) => ({ ri: ri })));
    const found = lookupRows([
        { ri: '/M/c0', ty: 3 }, { ri: '/M/c1', ty: 3 }, { ri: '/M/c2', ty: 3 }
    ]);
    h.sql_action.select_spec_ri(null, found, 0, guard(done, function (code) {
        assert.strictEqual(code, '200');
        assert.deepStrictEqual(Object.keys(found), ['/M/c1'],
            '고아 행이 응답에 남았거나 멀쩡한 행이 빠졌다');
        done();
    }));
});

test('전부 고아면 빈 결과가 된다', function (t, done) {
    const h = tap(() => []);
    const found = lookupRows([{ ri: '/M/c0', ty: 3 }, { ri: '/M/c1', ty: 3 }]);
    h.sql_action.select_spec_ri(null, found, 0, guard(done, function (code) {
        assert.strictEqual(code, '200');
        assert.deepStrictEqual(Object.keys(found), []);
        done();
    }));
});

// --- 4) 속성이 실제로 합쳐진다 -----------------------------------------------

test('타입 테이블의 속성이 lookup 행에 합쳐진다', function (t, done) {
    const h = tap((table, ris) => ris.map((ri) => ({ ri: ri, cni: 7, cbs: 42 })));
    const found = lookupRows([{ ri: '/M/c', ty: 3, rn: 'mycnt' }]);
    h.sql_action.select_spec_ri(null, found, 0, guard(done, function () {
        assert.strictEqual(found['/M/c'].cni, 7, '타입 테이블 속성이 안 합쳐졌다');
        assert.strictEqual(found['/M/c'].cbs, 42);
        assert.strictEqual(found['/M/c'].rn, 'mycnt', 'lookup 쪽 속성이 사라졌다');
        done();
    }));
});

// --- 5) 오류 처리 ------------------------------------------------------------

test('질의가 실패하면 500-1 이고 원인이 로그에 남는다', function (t, done) {
    const h = tap(() => {
        const e = new Error('boom');
        e.sqlMessage = "Table 'mobiusdb.cnt' doesn't exist";
        return e;
    });
    const found = lookupRows([{ ri: '/M/c', ty: 3 }]);
    const logs = [];
    const orig = console.error;
    console.error = function () { logs.push([].slice.call(arguments).join(' ')); };
    h.sql_action.select_spec_ri(null, found, 0, function (code) {
        console.error = orig;
        try {
            assert.strictEqual(code, '500-1');
            assert.ok(logs.some((l) => /doesn't exist/.test(l)),
                '원인이 안 남았다: ' + JSON.stringify(logs));
            assert.ok(!logs.some((l) => /^\[select_spec_ri\] true$/.test(l)),
                '에러 객체를 첫 인자로 착각했다 — 파사드는 cb(true, errObj) 다');
            done();
        } catch (e) { done(e); }
    });
});

test('typeRsrc 에 없는 ty 는 500-1 이고 어느 ri 인지 남는다', function (t, done) {
    const h = tap((table, ris) => ris.map((ri) => ({ ri: ri })));
    const found = lookupRows([{ ri: '/M/x', ty: 777 }]);
    const logs = [];
    const orig = console.error;
    console.error = function () { logs.push([].slice.call(arguments).join(' ')); };
    h.sql_action.select_spec_ri(null, found, 0, function (code) {
        console.error = orig;
        try {
            assert.strictEqual(code, '500-1');
            assert.ok(logs.some((l) => /ty=777/.test(l) && /\/M\/x/.test(l)),
                '어느 ri 의 어떤 ty 인지 안 남았다: ' + JSON.stringify(logs));
            done();
        } catch (e) { done(e); }
    });
});
