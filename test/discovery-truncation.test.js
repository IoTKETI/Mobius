'use strict';
// A truncated result must be signalled to the client:
//   X-M2M-CTS: 1   partial result (more available)
//   X-M2M-CTO: N   offset to continue from
//
// search_lookup passes back the limit actually applied in SQL and the number of rows returned; the caller decides from those, not from the constant max_lim, and the la limit is query.la.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-trunc-test.db');

// Mimics the SQL limit in place of the DB.
//
// Discovery is two statements: skeleton (recursive CTE) and children (pi IN (...)). The skeleton query returns one parent; the child query returns the whole set under it. offset is not in the SQL: search_lookup drops leading rows in JS, so the child query's limit is (offset + limit).
function tap(total) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));

    const all = [];
    for (let i = 0; i < total; i++) { all.push({ ri: '/M/c' + i, ty: 3 }); }

    adapter.connect = function (cb) { cb('1'); };
    adapter.execute = function (conn, sql, bindings, cb) {
        // Tells the skeleton-only statement (batch path) from the legacy single statement (ofst / la). Both start with `with recursive skel`; the skeleton statement ends with `sk_ri, sk_lvl from skel`.
        if (/from skel\s*$/i.test(sql)) {
            return cb(null, [{ sk_ri: '/M', sk_lvl: 0 }]);
        }
        const lim = /limit (\d+)/i.exec(sql);
        const ofs = /offset (\d+)/i.exec(sql);

        // Bounded count used to consume the offset. The inner limit is the bound.
        if (/count\(\*\) as n/i.test(sql)) {
            const cap = lim ? parseInt(lim[1], 10) : all.length;
            return cb(null, [{ n: Math.min(all.length, cap) }]);
        }

        let rows = all.slice();
        if (ofs) { rows = rows.slice(parseInt(ofs[1], 10)); }
        if (lim) { rows = rows.slice(0, parseInt(lim[1], 10)); }
        cb(null, rows);
    };
    db.connect(function () {});

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

// search_lookup passes the material for the decision.

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
    // With lim=100 and more rows available the truncation signal must be present.
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
        // next offset = 300 + 100
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
    // The effective limit of a la request is query.la.
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
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    adapter.connect = function (cb) { cb('1'); };
    adapter.execute = function (conn, sql, bindings, cb) { cb(new Error('boom'), null); };
    db.connect(function () {});
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

// The caller attaches the headers from that material. resource.js cannot be loaded whole, so the decision expression is checked in source.

test('resource.js 가 상수가 아니라 search_info 로 판정한다', function () {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');

    // The CTS condition must look at search_info.
    const m = /if \(search_info && search_info\.limit > 0 &&\s*search_info\.rows >= search_info\.limit\)/
        .exec(src);
    assert.ok(m, 'CTS 판정이 search_info 를 안 본다');

    // Inside that block CTO must be offset + rows.
    const idx = src.indexOf("response.header('X-M2M-CTO'");
    assert.ok(idx > 0, 'CTO 헤더가 없다');
    const near = src.slice(idx, idx + 160);
    assert.match(near, /search_info\.offset \+ search_info\.rows/,
        'CTO 가 offset + rows 가 아니다 — 고아 행만큼 어긋난다');

    // The old decision expression must not remain.
    assert.ok(!/Object\.keys\(foundObj\)\.length >= max_lim/.test(src),
        '상수 max_lim 과 비교하던 판정식이 남아 있다');
    assert.ok(!/X-M2M-CTO'[\s\S]{0,120}Object\.keys\(foundObj\)\.length/.test(src),
        'CTO 를 응답 건수로 계산하던 코드가 남아 있다');
});

// la returns the container's direct CINs. presearch_action pins ty=4 / lvl=1 so the query becomes 'one parent + fixed ty' and the index provides the ordering; an ORDER BY across several parents cannot be served by the index on either backend.

test('presearch_action 이 la 요청에 ty=4 와 lvl=1 을 못박는다', function () {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');

    const at = src.indexOf('function presearch_action');
    assert.ok(at > 0, 'presearch_action 을 못 찾았다');
    const body = src.slice(at, src.indexOf('\nfunction ', at + 10));

    // Comments are excluded; they quote the same strings.
    const code = body.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    const at_la = code.indexOf('request.query.la != null');
    assert.ok(at_la > 0, 'la 분기가 없다');
    const la_block = code.slice(at_la, at_la + 400);

    assert.match(la_block, /request\.query\.ty\s*=\s*'4'/,
        'la 인데 ty=4 를 안 박는다 — CIN 이 아닌 것도 섞여 나온다');
    assert.match(la_block, /request\.query\.lvl\s*=\s*'1'/,
        'la 인데 lvl=1 을 안 박는다 — 골격 전체를 훑어 30초 상한에 걸린다');
});

test('la 는 lbl 가드를 통과한다 — 그리고 그게 맞다', function () {
    // Pinning ty has one side effect: the guard against lbl LIKE blow-up (`lbl != null && ty == null`) never fires for la, since ty is always set. That is correct: the guard excludes CINs, and la by definition looks for CINs, so firing would always yield 0 rows.
    const sql = require(path.join(ROOT, 'mobius', 'sql_action.js'));
    const like_without_ty = sql._like_filter_without_ty;

    // As sent by the client the guard fires.
    assert.strictEqual(like_without_ty({ lbl: 'x' }), true,
        'ty 없는 lbl 요청에 가드가 안 걸린다 — 1억4,560만 행을 훑는다');

    // After presearch_action it does not fire.
    assert.strictEqual(like_without_ty({ lbl: 'x', ty: '4', lvl: '1' }), false,
        'la 에서 가드가 발동한다 — CIN 을 빼면 la 가 언제나 0건이 된다');
});

test('la 를 묶는 것은 lbl 가드가 아니라 lvl 고정이다', function () {
    // lvl=1 confines candidates to one container's CINs: descendant_max_lvl returns 0, the skeleton builds no recursive branch, and there is always exactly one parent. If that chain breaks, la spans several parents and `order by ct desc` across parents becomes a filesort.
    const sql = require(path.join(ROOT, 'mobius', 'sql_action.js'));

    assert.strictEqual(sql.descendant_max_lvl({ lvl: '1' }), 0,
        'lvl=1 인데 최대 깊이가 0 이 아니다 — 골격이 재귀해 부모가 여럿이 된다');

    // Without lvl there is no depth limit, which is why la must set it.
    assert.strictEqual(sql.descendant_max_lvl({}), null,
        'lvl 없는 요청에 깊이 제한이 생겼다 — 일반 discovery 의 동작이 바뀐다');
});
