'use strict';
// 결과가 잘렸으면 클라이언트에게 알려야 한다.
//   X-M2M-CTS: 1   부분 결과 (더 있다)
//   X-M2M-CTO: N   이어받을 오프셋
//
// 예전에는 세 가지가 틀렸다 (mobius/resource.js 의 retrieve):
//   1. 상수 max_lim(2000)과 비교했다 — lim=100 요청은 결과가 잘려도 신호가 없었다
//   2. la 요청의 실효 한도는 query.la 인데 그걸 안 봤다
//   3. select_spec_ri 가 고아 행을 걷어낸 **뒤**의 건수를 CTO 에 썼다.
//      DB 는 그만큼을 이미 건너뛰었으므로 다음 오프셋이 모자라고,
//      클라이언트가 다음 페이지에서 앞부분을 다시 읽는다.
//
// 이제 search_lookup 이 SQL 에 실제로 건 한도와 돌려준 행 수를 넘겨준다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-trunc-test.db');

// SQL 의 limit 을 그대로 흉내 낸다 — DB 가 하는 일을 대신한다.
//
// discovery 는 문장이 둘이다: 골격(재귀 CTE)과 자식(pi IN (...)). 골격 질의는
// 부모 하나만 돌려주면 되고, 자식 질의는 그 부모 아래 전체 집합을 준다.
// **offset 은 SQL 에 없다** — 배치마다 건너뛰면 틀리므로 search_lookup 이
// JS 에서 앞부분을 버린다. 그래서 자식 질의의 limit 은 (오프셋 + 한도) 다.
function tap(total) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));

    const all = [];
    for (let i = 0; i < total; i++) { all.push({ ri: '/M/c' + i, ty: 3 }); }

    adapter.connect = function (conf, cb) { cb('1'); };
    adapter.execute = function (conn, sql, bindings, cb) {
        // 골격만 뽑는 문장(배치 경로)과 자식까지 한 문장으로 끝내는 예전
        // 경로(ofst / la)를 가른다. 둘 다 `with recursive skel` 로 시작하므로
        // 꼬리를 봐야 한다 — 골격 문장은 `sk_ri, sk_lvl from skel` 로 끝난다.
        if (/from skel\s*$/i.test(sql)) {
            return cb(null, [{ sk_ri: '/M', sk_lvl: 0 }]);
        }
        const lim = /limit (\d+)/i.exec(sql);
        const ofs = /offset (\d+)/i.exec(sql);

        // 오프셋 소진용 경계 있는 count. 안쪽 limit 이 경계다.
        if (/count\(\*\) as n/i.test(sql)) {
            const cap = lim ? parseInt(lim[1], 10) : all.length;
            return cb(null, [{ n: Math.min(all.length, cap) }]);
        }

        let rows = all.slice();
        if (ofs) { rows = rows.slice(parseInt(ofs[1], 10)); }
        if (lim) { rows = rows.slice(0, parseInt(lim[1], 10)); }
        cb(null, rows);
    };
    db.connect('h', 1, 'u', 'p', function () {});

    delete require.cache[require.resolve(path.join(ROOT, 'mobius', 'sql_action.js'))];
    return require(path.join(ROOT, 'mobius', 'sql_action.js'));
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

function run(sa, query, cb) {
    const found = {};
    sa.search_lookup(null, '/M', query, query.lim, ['/M'], 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code, info) {
            cb(code, info, Object.keys(found));
        });
}

// --- search_lookup 이 판정 재료를 넘기는가 -----------------------------------

test('성공하면 rows / limit / offset 을 넘긴다', function (t, done) {
    const sa = tap(500);
    run(sa, { ty: '3', lim: 100 }, guard(done, function (code, info) {
        assert.strictEqual(code, '200');
        assert.ok(info, 'info 를 안 넘겼다');
        assert.strictEqual(info.rows, 100);
        assert.strictEqual(info.limit, 100);
        assert.strictEqual(info.offset, 0);
        done();
    }));
});

test('한도를 못 채우면 rows 가 limit 보다 작다', function (t, done) {
    const sa = tap(30);
    run(sa, { ty: '3', lim: 100 }, guard(done, function (code, info) {
        assert.strictEqual(info.rows, 30);
        assert.strictEqual(info.limit, 100);
        assert.ok(info.rows < info.limit, '잘리지 않았는데 잘린 것으로 보인다');
        done();
    }));
});

test('lim 이 2000 보다 작아도 판정이 된다', function (t, done) {
    // 예전에는 상수 2000 과 비교해서 이 경우 신호가 아예 없었다.
    const sa = tap(5000);
    run(sa, { ty: '3', lim: 100 }, guard(done, function (code, info) {
        assert.strictEqual(info.limit, 100, '실효 한도가 요청 값이 아니다');
        assert.ok(info.rows >= info.limit, '잘렸는데 안 잘린 것으로 보인다');
        done();
    }));
});

test('offset 을 그대로 넘긴다 (다음 오프셋 계산용)', function (t, done) {
    const sa = tap(5000);
    run(sa, { ty: '3', lim: 100, ofst: 300 }, guard(done, function (code, info) {
        assert.strictEqual(info.offset, 300);
        assert.strictEqual(info.rows, 100);
        // 다음 오프셋 = 300 + 100
        assert.strictEqual(info.offset + info.rows, 400);
        done();
    }));
});

test('ofst 가 없으면 offset 은 0 이다', function (t, done) {
    const sa = tap(500);
    run(sa, { ty: '3', lim: 100 }, guard(done, function (code, info) {
        assert.strictEqual(info.offset, 0);
        done();
    }));
});

test('la 요청의 실효 한도는 la 값이다', function (t, done) {
    // 예전에는 la 를 안 봐서 실효 한도를 잘못 잡았다.
    const sa = tap(500);
    run(sa, { la: '5' }, guard(done, function (code, info) {
        assert.strictEqual(info.limit, 5, 'la 값이 실효 한도가 아니다');
        assert.strictEqual(info.rows, 5);
        done();
    }));
});

test('실패하면 info 를 안 넘긴다', function (t, done) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    global.usesqlite = 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    adapter.connect = function (conf, cb) { cb('1'); };
    adapter.execute = function (conn, sql, bindings, cb) { cb(new Error('boom'), null); };
    db.connect('h', 1, 'u', 'p', function () {});
    delete require.cache[require.resolve(path.join(ROOT, 'mobius', 'sql_action.js'))];
    const sa = require(path.join(ROOT, 'mobius', 'sql_action.js'));

    const orig = console.error;
    console.error = function () { };
    run(sa, { ty: '3', lim: 100 }, function (code, info) {
        console.error = orig;
        try {
            assert.strictEqual(code, '500-1');
            assert.strictEqual(info, undefined);
            done();
        } catch (e) { done(e); }
    });
});

// --- 호출부가 그 재료로 헤더를 붙이는가 --------------------------------------
//
// resource.js 를 통째로 띄우기는 어렵다. 판정식을 소스에서 직접 확인한다.

test('resource.js 가 상수가 아니라 search_info 로 판정한다', function () {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');

    // CTS 를 붙이는 조건이 search_info 를 봐야 한다
    const m = /if \(search_info && search_info\.limit > 0 &&\s*search_info\.rows >= search_info\.limit\)/
        .exec(src);
    assert.ok(m, 'CTS 판정이 search_info 를 안 본다');

    // 그 블록 안에서 CTO 는 offset + rows 여야 한다
    const idx = src.indexOf("response.header('X-M2M-CTO'");
    assert.ok(idx > 0, 'CTO 헤더가 없다');
    const near = src.slice(idx, idx + 160);
    assert.match(near, /search_info\.offset \+ search_info\.rows/,
        'CTO 가 offset + rows 가 아니다 — 고아 행만큼 어긋난다');

    // 예전 판정식이 남아 있으면 안 된다
    assert.ok(!/Object\.keys\(foundObj\)\.length >= max_lim/.test(src),
        '상수 max_lim 과 비교하던 판정식이 남아 있다');
    assert.ok(!/X-M2M-CTO'[\s\S]{0,120}Object\.keys\(foundObj\)\.length/.test(src),
        'CTO 를 응답 건수로 계산하던 코드가 남아 있다');
});

// --- la 는 컨테이너의 직속 CIN 이다 ------------------------------------------
//
// 배포 실측(2026-09-01)으로 두 결함이 있었다:
//   - 골격 전체(컨테이너 2,806개)를 훑어 여러 부모에 걸친 전역 정렬이 되고,
//     filesort 로 30초 상한에 걸려 500 이 나갔다
//   - ty 를 제한하지 않아 CIN 이 아닌 리소스(구독 등)도 결과에 섞였다
//
// presearch_action 이 ty=4 / lvl=1 을 못박으면 질의가 "부모 하나 + ty 고정"
// 이 되어 인덱스가 정렬을 그대로 준다(MySQL Backward index scan, 0.00초).
// 여러 부모에 걸친 ORDER BY 는 인덱스로 못 푼다 — MySQL/SQLite 둘 다.

test('presearch_action 이 la 요청에 ty=4 와 lvl=1 을 못박는다', function () {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');

    const at = src.indexOf('function presearch_action');
    assert.ok(at > 0, 'presearch_action 을 못 찾았다');
    const body = src.slice(at, src.indexOf('\nfunction ', at + 10));

    // 주석은 빼고 본다 — 왜 이렇게 하는지 설명하느라 같은 문자열을 인용한다.
    const code = body.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    const at_la = code.indexOf('request.query.la != null');
    assert.ok(at_la > 0, 'la 분기가 없다');
    const la_block = code.slice(at_la, at_la + 400);

    assert.match(la_block, /request\.query\.ty\s*=\s*'4'/,
        'la 인데 ty=4 를 안 박는다 — CIN 이 아닌 것도 섞여 나온다');
    assert.match(la_block, /request\.query\.lvl\s*=\s*'1'/,
        'la 인데 lvl=1 을 안 박는다 — 골격 전체를 훑어 30초 상한에 걸린다');
});
