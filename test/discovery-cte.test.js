'use strict';
// Discovery runs as two statements on both MySQL and SQLite:
//   1) a recursive CTE selects the skeleton (nodes that can be parents)
//   2) the skeleton is split into batches of 4,000 and children are fetched with `pi in (:p0, ...)`
//
// Passing pi as a constant list lets MySQL use a range access over (pi, ty, ct); a join would limit the index to (pi, ty).
//
// This file guards:
//   1) the recursive member compares ty by equality (required for an index range)
//   2) round trips are 1 + ceil(parents / 4000), never proportional to parent count
//   3) lim / ofst act globally across batches
//   4) lvl is bounded by skeleton depth
//   5) dialect differences (collation / index forcing / statement timeout) come from the adapter
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-cte-test.db');

// The full result set. The adapter applies the SQL limit to this set, mimicking the DB, so the test only checks that search_lookup emits the right clauses. offset is no longer in the SQL: search_lookup drops the leading rows in JS.
const ALL = [];
for (let i = 0; i < 20; i++) {
    ALL.push({ ri: '/M/p' + Math.floor(i / 4) + '/c' + (i % 4), ty: 3, rn: 'c' + (i % 4) });
}

// Rows the skeleton query returns. sk_lvl is needed to exercise lvl handling.
const SKEL_ROWS = [
    { sk_ri: '/M', sk_lvl: 0 },
    { sk_ri: '/M/p0', sk_lvl: 1 },
    { sk_ri: '/M/p1', sk_lvl: 1 },
    { sk_ri: '/M/p2', sk_lvl: 2 },
    { sk_ri: '/M/p3', sk_lvl: 2 },
    { sk_ri: '/M/p4', sk_lvl: 3 }
];

// opts.skeleton  rows the skeleton query returns (default SKEL_ROWS)
// opts.children  function (bindings, sql) -> rows for the child query
function tap(backend, opts) {
    opts = opts || {};
    const skeleton = opts.skeleton || SKEL_ROWS;
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = backend;
    const db = require(DB);
    const adapter = require(path.join(DB, backend === 'sqlite' ? 'sqlite.js' : 'mysql.js'));

    const seen = [];
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        // Tells a skeleton-only statement from the legacy single statement that also fetches children. Both start with `with recursive skel`, so the projection is inspected: only the skeleton statement selects sk_ri / sk_lvl, and that holds even when a parent filter (left join cnt) is appended for sza / szb.
        if (/\bsk_ri,\s*sk_lvl\s+from\s+skel\b/i.test(sql)) { return cb(null, skeleton.slice()); }
        // Applies limit / offset the way the DB would. Ignoring offset would make page 2 equal page 1 and hide paging defects.
        const lim = /limit (\d+)/i.exec(sql);
        const off = /offset (\d+)/i.exec(sql);
        let rows = opts.children ? opts.children(bindings, sql) : ALL.slice();

        // Bounded count used to consume the offset. The inner limit is the bound.
        if (/count\(\*\) as n/i.test(sql)) {
            const cap = lim ? parseInt(lim[1], 10) : rows.length;
            return cb(null, [{ n: Math.min(rows.length, cap) }]);
        }

        // Gives the two paths different row orders, as the real DB does: the batch path is a range access in pi order, the legacy single statement follows join order. Identical orders would hide a paging mismatch between paths.
        if (/with recursive skel as/i.test(sql)) { rows = rows.slice().reverse(); }

        if (off) { rows = rows.slice(parseInt(off[1], 10)); }
        if (lim) { rows = rows.slice(0, parseInt(lim[1], 10)); }
        cb(null, rows);
    };
    adapter.connect = function (cb) { cb('1'); };

    db.connect(function () {});

    delete require.cache[require.resolve(path.join(ROOT, 'mobius', 'sql_action.js'))];
    return { sql_action: require(path.join(ROOT, 'mobius', 'sql_action.js')), seen: seen };
}

function guard(done, fn) {
    return function () {
        try { fn.apply(null, arguments); }
        catch (e) { done(e); }
    };
}

// Where the skeleton CTE's final select begins. Used to split the skeleton statement into recursive part and tail.
const SKEL_END = ')\nselect';

// Two paths, three statement shapes:
//
//   skeleton   `with recursive skel ... sk_ri, sk_lvl from skel`   (batch path)
//   child      `... where r.pi in (:p0, ...)`                      (batch path)
//   single     `with recursive skel ... join skel s on r.pi = ...` (legacy)
//
// The skeleton is identified by what it selects: only the skeleton projects sk_ri / sk_lvl. The single statement joins skel but selects `r.*`.
const isSkel = (s) => /\bsk_ri,\s*sk_lvl\s+from\s+skel\b/i.test(s.sql);
const isChild = (s) => /r\.pi in \(/i.test(s.sql);
const isOneShot = (s) => /with recursive skel as/i.test(s.sql) && !isSkel(s);
function skelStmt(seen) {
    const s = seen.filter(isSkel)[0];
    assert.ok(s, '골격 질의가 없다');
    return s;
}
function childStmt(seen) {
    const s = seen.filter(isChild)[0];
    assert.ok(s, '자식 질의가 없다');
    return s;
}
function oneShotStmt(seen) {
    const s = seen.filter(isOneShot)[0];
    assert.ok(s, '단일 문장 질의가 없다 (ofst / la 는 예전 경로를 써야 한다)');
    return s;
}
const allSql = (seen) => seen.map((s) => s.sql).join('\n');
const allBindings = (seen) => seen.reduce((a, s) => a.concat(s.bindings), []);

// Number of parents a child query received: counts the placeholders in the IN list.
function parentCount(sql) {
    const m = /r\.pi in \(([^)]*)\)/.exec(sql);
    assert.ok(m, 'r.pi in (...) 이 없다: ' + sql);
    return m[1].split(',').length;
}

// Uses the legacy signature, the same shape as the resource.js call site.
function run(t, query, cb, root) {
    const found = {};
    t.sql_action.search_lookup(null, root || '/M', query, query.lim, ['/M'], 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code) {
            cb(code, Object.keys(found), t.seen);
        });
}

// Discovery under the CSEBase builds no skeleton. The skeleton exists to restrict to a subtree; with the CSEBase as target every resource is below it, and a selective filter plus a parent restriction of 4,000 makes each batch scan all candidates.
function atRoot(t, query, cb) {
    const saved = global.usecsebase;
    global.usecsebase = 'Mobius';
    const found = {};
    t.sql_action.search_lookup(null, '/Mobius', query, query.lim, ['/Mobius'], 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code) {
            global.usecsebase = saved;
            cb(code, Object.keys(found), t.seen);
        });
}

test('CSEBase 전체 검색은 골격을 안 만들고 한 번만 던진다', function (t, done) {
    const h = tap('mysql');
    atRoot(h, { ty: '3', rn: 'Mission_Data', lim: 2000 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(seen.length, 1,
            '질의가 ' + seen.length + '개다 — 골격 없이 한 문장이어야 한다: ' +
            JSON.stringify(seen.map((s) => s.sql.slice(0, 40))));
        assert.ok(!/with recursive skel/i.test(seen[0].sql),
            '골격을 만들었다 — CSEBase 아래는 한정할 것이 없다');
        assert.ok(!/r\.pi in \(/i.test(seen[0].sql),
            '부모 제한이 붙었다 — 34,415개짜리 IN 목록이 아무것도 안 거른다');

        // The filters must still apply.
        assert.match(seen[0].sql, /ty = /, 'ty 필터가 사라졌다');
        assert.match(seen[0].sql, /rn = /, 'rn 필터가 사라졌다');
        done();
    }));
});

test('lvl 이 있으면 골격을 만든다 — 깊이를 알 방법이 그것뿐이다', function (t, done) {
    // lvl is enforced through the skeleton's sk_lvl. Without a skeleton the depth cannot be bounded.
    const h = tap('mysql');
    atRoot(h, { ty: '3', lvl: '2', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(/with recursive skel/i.test(seen[0].sql),
            'lvl 이 있는데 골격을 안 만들었다 — 깊이 제한이 사라진다');
        done();
    }));
});

test('cra / crb 가 있으면 루트에서도 골격을 만든다 — ct 인덱스를 살린다', function (t, done) {
    // The shortcut must not drop the (pi, ty, ct) index: ct is the third column and is only reachable with pi present. A root query with ty=4 & cra keeps the parent restriction and the index hint.
    const h = tap('mysql');
    atRoot(h, { ty: '4', cra: '20260902T154550', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(/with recursive skel/i.test(seen[0].sql),
            'cra 가 있는데 골격을 안 만들었다 — ct 가 인덱스 밖으로 밀린다');
        done();
    }));
});

test('crb 도 마찬가지다 — 시간 상한만 걸어도 ct 가 범위를 좁힌다', function (t, done) {
    const h = tap('mysql');
    atRoot(h, { ty: '4', crb: '20260902T154550', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(/with recursive skel/i.test(seen[0].sql),
            'crb 가 있는데 골격을 안 만들었다');
        done();
    }));
});

test('ty 없이 lbl 만 주면 루트에서도 골격을 만든다 — not_cin 인덱스를 살린다', function (t, done) {
    // A lbl request without ty relies on idx_lookup_pi_notcin (pi, not_cin). pi leads that index, so without a parent restriction it cannot be used. The check must confirm that a skeleton is built and the child statement carries the parent restriction and hint; the ALL_PARENTS path has no hint either, so 'no hint' alone proves nothing.
    const h = tap('mysql');
    atRoot(h, { lbl: 'status', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(/with recursive skel/i.test(seen[0].sql),
            'lbl 만 주는 루트 요청이 골격을 안 만들었다 — not_cin 이 인덱스 밖으로 밀린다');

        const child = childStmt(seen);
        assert.ok(child, '자식 질의가 없다');
        assert.match(child.sql, /r\.pi in \(/i,
            '자식 질의에 부모 제한이 없다 — (pi, not_cin) 의 선두가 pi 다');
        assert.match(child.sql, /force index \(idx_lookup_pi_notcin\)/i,
            'not_cin 인덱스를 강제하지 않는다 — 옵티마이저가 PRIMARY 를 고른다');
        done();
    }));
});

test('시간 범위가 없으면 루트는 그대로 단축을 탄다', function (t, done) {
    // The exceptions above must not disable the shortcut itself. A request without a ct filter gains nothing from a skeleton.
    const h = tap('mysql');
    atRoot(h, { ty: '3', rn: 'Mission_Data', lim: 2000 }, guard(done, function (code, ris, seen) {
        assert.ok(!/with recursive skel/i.test(seen[0].sql),
            'ct 범위가 없는데 골격을 만들었다 — 단축이 죽었다');
        done();
    }));
});

test('CSEBase 가 아니면 예전대로 골격을 만든다', function (t, done) {
    // A subtree search does need the restriction.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(/with recursive skel/i.test(seen[0].sql),
            'subtree 인데 골격을 안 만들었다 — 다른 가지까지 나온다');
        assert.match(childStmt(seen).sql, /r\.pi in \(/i,
            'subtree 인데 부모 제한이 없다');
        done();
    }));
});

test('ALL_PARENTS 는 빈 목록과 다르다', function () {
    // 'no parents' (no answer) and 'no parent restriction' (everything answers) are opposites. Representing the latter as null or an empty array would hit the existing guard and yield 0 rows.
    const h = tap('mysql');
    const sql = h.sql_action;
    const q = { ty: '3' };
    const s = sql._build_search_query(q);

    assert.strictEqual(sql.build_children_sql([], q, s, 20, 30000, 0, null), null,
        '빈 배열이 질의를 만들었다 — in () 은 문법 오류다');
    assert.strictEqual(sql.build_children_sql(null, q, s, 20, 30000, 0, null), null,
        'null 이 질의를 만들었다');

    const all = sql.build_children_sql(sql.ALL_PARENTS, q, s, 20, 30000, 0, null);
    assert.ok(all && all.sql, 'ALL_PARENTS 가 질의를 안 만들었다 — 전부가 답인 경우다');
    assert.ok(!/r\.pi in \(/i.test(all.sql), 'ALL_PARENTS 인데 부모 제한이 붙었다');
    assert.match(all.sql, /ty = /, '필터까지 사라졌다');
});

test('ALL_PARENTS 는 pi 로 시작하는 인덱스를 강제하지 않는다', function () {
    // With the root shortcut removing pi IN, force index must go too: both forced candidates start with pi, so without a pi predicate MySQL abandons the forced index and falls back to a full table scan.
    const h = tap('mysql');
    const sql = h.sql_action;

    // Both with ty and without (lbl only). The latter takes the skip_cin path, whose forced candidate is idx_lookup_pi_notcin, which also starts with pi.
    const cases = [
        { name: 'ty 필터', q: { ty: '3', rn: 'Mission_Data' } },
        { name: 'lbl 만(skip_cin 경로)', q: { lbl: 'x*' } }
    ];

    for (const c of cases) {
        const s = sql._build_search_query(c.q);
        const all = sql.build_children_sql(sql.ALL_PARENTS, c.q, s, 20, 30000, 0, null);
        assert.ok(all && all.sql, c.name + ': 질의를 안 만들었다');
        assert.ok(!/force index/i.test(all.sql),
            c.name + ': ALL_PARENTS 인데 인덱스를 강제한다 — pi 술어가 없어 ' +
            '풀 테이블 스캔이 된다. SQL: ' + all.sql);
    }

    // On the ordinary path with a parent restriction the force index must remain; without it the optimizer picks PRIMARY and reads every CIN per parent.
    const q2 = { ty: '3' };
    const batch = sql.build_children_sql(['/Mobius/a'], q2, sql._build_search_query(q2),
        20, 30000, 0, null);
    assert.match(batch.sql, /force index \(idx_lookup_pi_ty_ct\)/i,
        '부모 제한이 있는데 강제가 사라졌다 — 이쪽은 강제가 필요하다');
});

// 1) Round trips do not scale with parent count: 1 (skeleton) + ceil(parents / 4000). A normal request is 2.

test('discovery 는 골격 1회 + 배치 수만큼만 던진다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        // 6 parents fit one batch: skeleton 1 + children 1.
        assert.strictEqual(seen.length, 2,
            '부모마다 던지던 시절로 돌아갔다: ' + seen.length + '회');
        assert.match(seen[0].sql, /with recursive skel as/i, '첫 질의가 골격이 아니다');
        assert.ok(!isSkel(seen[1]), '둘째 질의가 자식이 아니다');
        done();
    }));
});

// 2) The skeleton recursion has one branch with an equality condition. Inside a MySQL recursive CTE only ref (equality) access is available, not range, so the condition must be equality: no range, no IN.

test('골격 재귀는 UNION 분기를 하나만 만든다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        const skel = sql.slice(0, sql.indexOf(SKEL_END));
        assert.strictEqual((skel.match(/union/gi) || []).length, 1,
            '분기가 하나가 아니다 — 타입마다 분기하던 시절로 돌아갔다');
        done();
    }));
});

test('골격 조건에 범위나 IN 이 들어가지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        const skel = sql.slice(0, sql.indexOf(SKEL_END));
        assert.ok(!/l\.ty\s+in\s*\(/i.test(skel), '재귀항에 ty IN (...) 이 있다');
        assert.ok(!/l\.ty\s*[<>]\s*\d/.test(skel),
            '재귀항에 ty 범위 조건이 있다 — MySQL 은 재귀 안에서 range 를 못 쓴다');
        assert.match(skel, /where l\.not_cin = 1/, '등치 조건이 아니다');
        done();
    }));
});

test('골격은 sk_ri / sk_lvl 만 내보낸다', function (t, done) {
    // Children are fetched by a separate statement that receives this list as pi IN (...).
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        assert.match(sql, /\*\/ sk_ri, sk_lvl from skel$/,
            '골격 꼬리가 sk_ri, sk_lvl 이 아니다: ' + sql);
        assert.ok(!/from lookup r/.test(sql), '골격 문장에 자식 질의가 붙어 있다');
        assert.ok(!/limit/i.test(sql), '골격에 limit 이 붙었다 — 골격은 자르지 않는다');
        done();
    }));
});

test('SQLite 는 가상 컬럼 없이 조건을 그대로 쓴다', function (t, done) {
    const h = tap('sqlite');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        const skel = sql.slice(0, sql.indexOf(SKEL_END));
        // SQLite has no INVISIBLE columns; a not_cin column would leak through select *.
        assert.ok(!/not_cin/.test(allSql(seen)), 'SQLite 에 not_cin 이 들어갔다');
        assert.match(skel, /where l\.ty <> 4/);
        assert.strictEqual((skel.match(/union/gi) || []).length, 1);
        done();
    }));
});

// 3) lim / ofst are global.

test('ofst 없이 전체를 받는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris) {
        assert.strictEqual(ris.length, 20, ris.length + '건');
        done();
    }));
});

test('ofst 가 있어도 배치 경로를 쓴다 — 경로가 갈리면 페이지가 어긋난다', function (t, done) {
    // Page 1 (no ofst) and page 2 (ofst) must take the same path. The two paths order rows differently, so offset N would skip N rows other than those page 1 returned.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, ofst: 6 }, guard(done, function (code, ris, seen) {
        assert.ok(seen.some(isChild),
            'ofst 요청이 배치 경로를 안 썼다 — 페이지 순서가 갈린다');
        assert.ok(!seen.some(isOneShot),
            'ofst 요청이 예전 한 문장으로 갔다 — 1페이지와 순서가 어긋난다');
        // The DB skips the offset. Dropping rows in JS would fetch the skipped rows as well.
        assert.ok(!/limit 26/.test(allSql(seen)),
            '한도가 (오프셋 + 한도) 로 부풀었다: ' + allSql(seen));
        assert.strictEqual(ris.length, 14, 'ofst=6 이면 14건: ' + ris.length);
        assert.deepStrictEqual(ris, ALL.slice(6).map((r) => r.ri));
        done();
    }));
});

test('부모가 가진 자식보다 큰 ofst 도 정상 동작한다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, ofst: 10 }, guard(done, function (code, ris) {
        assert.strictEqual(ris.length, 10, 'ofst=10 이면 10건: ' + ris.length);
        assert.deepStrictEqual(ris, ALL.slice(10).map((r) => r.ri));
        done();
    }));
});

test('페이지가 겹치지 않는다', function (t, done) {
    const a = tap('mysql');
    run(a, { ty: '3', lim: 7 }, guard(done, function (c1, p1) {
        const b = tap('mysql');
        run(b, { ty: '3', lim: 7, ofst: 7 }, guard(done, function (c2, p2) {
            assert.deepStrictEqual(p1, ALL.slice(0, 7).map((r) => r.ri));
            assert.deepStrictEqual(p2, ALL.slice(7, 14).map((r) => r.ri));
            assert.strictEqual(p1.filter((x) => p2.indexOf(x) !== -1).length, 0,
                '두 페이지가 겹친다');
            done();
        }));
    }));
});

// Paging through to the end must reproduce the full set exactly, with no overlap and no gap.
test('끝까지 페이지를 넘기면 전체와 정확히 일치한다 (겹침도 누락도 없다)', function (t, done) {
    const PAGE = 3;
    const expected = ALL.map((r) => r.ri);
    const got = [];
    const seenSet = new Set();
    let dup = 0;

    function page(ofst) {
        const h = tap('mysql');
        run(h, { ty: '3', lim: PAGE, ofst: ofst }, guard(done, function (code, ris) {
            assert.strictEqual(code, '200');
            ris.forEach((x) => {
                if (seenSet.has(x)) { dup++; }
                seenSet.add(x);
                got.push(x);
            });
            // A short page is the last page.
            if (ris.length < PAGE || ofst + ris.length >= expected.length + PAGE) {
                assert.strictEqual(dup, 0, '페이지가 겹친다: 중복 ' + dup + '건');
                assert.deepStrictEqual(got, expected,
                    '모은 결과가 전체와 다르다 — ' + got.length + '건 / 정답 ' +
                    expected.length + '건');
                return done();
            }
            page(ofst + ris.length);
        }));
    }
    page(0);
});

test('ofst 가 0 이면 배치 경로를 쓰고 한도가 그대로 lim 이다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, ofst: 0 }, guard(done, function (code, ris, seen) {
        assert.ok(!/offset/i.test(allSql(seen)), 'offset 절이 붙었다');
        assert.match(childStmt(seen).sql, /limit 20$/, childStmt(seen).sql);
        done();
    }));
});

// 4) lvl is bounded by skeleton depth.
//
// The skeleton root has sk_lvl=0 and its children are result depth 1. lvl=N means results down to depth N, so parents are needed only up to sk_lvl <= N-1.
//
// The bound is enforced in two places:
//   - `s.sk_lvl < max_lvl` in the recursive branch stops the skeleton from going deeper
//   - the last level is removed from the parent list in JS by search_lookup
// (The skeleton statement emits sk_lvl unchanged, with no outer where.)
// SKEL_ROWS has 1 / 2 / 2 / 1 rows per level.

test('lvl=1 이면 재귀 분기를 아예 만들지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '1' }, guard(done, function (code, ris, seen) {
        assert.ok(!/union/i.test(skelStmt(seen).sql), 'lvl=1 인데 재귀 분기가 있다');
        // max_lvl=0: only the root is a parent.
        assert.strictEqual(parentCount(childStmt(seen).sql), 1,
            'sk_lvl=0 만 남기지 않았다');
        done();
    }));
});

test('lvl=3 이면 골격을 2레벨까지만 훑는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '3' }, guard(done, function (code, ris, seen) {
        assert.ok(/s\.sk_lvl < 2/.test(skelStmt(seen).sql), '재귀 상한이 없다');
        // max_lvl=2: sk_lvl 0,1,1,2,2 are parents (sk_lvl=3 is excluded).
        assert.strictEqual(parentCount(childStmt(seen).sql), 5,
            '결과 깊이 상한이 부모 목록에 반영되지 않았다');
        done();
    }));
});

test('lvl 이 없으면 깊이 상한을 걸지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(!/sk_lvl </.test(skelStmt(seen).sql), 'lvl 없이 재귀 상한이 붙었다');
        assert.strictEqual(parentCount(childStmt(seen).sql), SKEL_ROWS.length,
            'lvl 없이 부모가 걸러졌다');
        done();
    }));
});

test('descendant_max_lvl 이 lvl-1 을 준다', function () {
    const h = tap('mysql');
    const f = h.sql_action.descendant_max_lvl;
    assert.strictEqual(f({}), null);
    assert.strictEqual(f({ lvl: '1' }), 0);
    assert.strictEqual(f({ lvl: '3' }), 2);
    assert.strictEqual(f({ lvl: '0' }), 0, '음수로 내려가면 안 된다');
    assert.strictEqual(f({ lvl: 'abc' }), null, '숫자가 아니면 무제한');
});

// 5) la selects the newest N rows by ordering. ct has second resolution, so ri is the tie-breaker.

test('la 는 ct desc, ri desc 로 정렬해 N건을 뽑는다', function (t, done) {
    // presearch_action sets ty=4 / lvl=1 for la requests, so there is one parent. The batch path is used and the ordering within the batch is the global ordering.
    const h = tap('mysql');
    run(h, { la: '5' }, guard(done, function (code, ris, seen) {
        const sql = childStmt(seen).sql;
        assert.match(sql, /order by r\.ct desc, r\.ri desc/i);
        assert.match(sql, /limit 5/i);
        assert.ok(!/[0-9]+ minutes|between/i.test(sql), '시간 창 재시도가 남아 있다');
        done();
    }));
});

test('la 는 인덱스를 강제하지 않는다 — 강제하면 정렬이 filesort 가 된다', function (t, done) {
    // With pi IN (...) and no force index the optimizer uses a range access without a sort; forcing the index brings back a filesort.
    const h = tap('mysql');
    run(h, { la: '5' }, guard(done, function (code, ris, seen) {
        const sql = childStmt(seen).sql;
        assert.ok(!/force index/i.test(sql),
            'la 질의에 force index 가 붙었다 — 정렬이 filesort 로 밀린다: ' + sql);
        done();
    }));
});

test('la 가 아니면 인덱스를 그대로 강제한다', function (t, done) {
    // On a query without ordering the force index is still needed to stop the optimizer from choosing PRIMARY and reading every CIN per parent.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.match(childStmt(seen).sql, /force index \(idx_lookup_pi_ty_ct\)/i,
            'la 가 아닌데 인덱스 강제가 사라졌다');
        done();
    }));
});

// 6) Dialect differences come from the adapter.

test('MySQL 은 콜레이션 / 인덱스 강제 / 문장 타임아웃을 붙인다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        // No collation cast on the skeleton. After migration 018 pi and ri share the bin collation; a cast would convert l.pi in the recursive join and lose the (pi, not_cin) index.
        assert.doesNotMatch(skelStmt(seen).sql, /collate/i, '골격에 콜레이션 캐스트가 되살아났다');
        // Choosing PRIMARY(pi, ri, ty) drops ty from the range and reads every CIN per parent.
        assert.match(childStmt(seen).sql, /force index \(idx_lookup_pi_ty_ct\)/);
        // The time limit must be on both statements; otherwise the other holds the connection without bound.
        assert.match(skelStmt(seen).sql, /MAX_EXECUTION_TIME\(\d+\)/);
        assert.match(childStmt(seen).sql, /MAX_EXECUTION_TIME\(\d+\)/);
        done();
    }));
});

// Without a fixed index on the recursive member the optimizer may choose the clustered PRIMARY(pi, ri, ty), look up by pi only and filter ty, reading every CIN of a container each time the skeleton widens. Plan choice flips with statistics and cache state, so it is pinned.

test('재귀항에도 인덱스를 고정한다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        const skel = sql.slice(0, sql.indexOf(SKEL_END));
        // The recursive member uses (pi, not_cin); the child query uses (pi, ty, ct).
        assert.match(skel, /from lookup l force index \(idx_lookup_pi_notcin\)/,
            '재귀항에 인덱스가 고정되지 않았다');
        assert.ok(!/from lookup l join/.test(skel), '힌트 없는 재귀 분기가 있다');
        assert.match(childStmt(seen).sql,
            /from lookup r force index \(idx_lookup_pi_ty_ct\)/,
            '자식 질의에 인덱스가 고정되지 않았다');
        done();
    }));
});

// Index and column names used by the skeleton must exist in the schema file, or every request fails with 500.
test('골격이 쓰는 인덱스와 컬럼이 스키마에 선언돼 있다', function () {
    const my = fs.readFileSync(require('../mobius/db/mysql').schemaPath, 'utf8');
    assert.match(my, /idx_lookup_pi_notcin/, 'mobiusdb.sql 에 인덱스 선언이 없다');
    assert.match(my, /`not_cin`[\s\S]{0,120}GENERATED ALWAYS AS \(`?ty`? <> 4\)/,
        'mobiusdb.sql 에 not_cin 생성 컬럼 선언이 없다');
    assert.match(my, /`not_cin`[\s\S]{0,160}INVISIBLE/,
        'not_cin 이 INVISIBLE 이 아니다 — select * 로 응답에 새어 나간다');

    // The migration must use the same name.
    const mig = fs.readFileSync(
        path.join(ROOT, 'migrations', '004-lookup-pi-notcin-index.js'), 'utf8');
    assert.match(mig, /idx_lookup_pi_notcin/);
    assert.match(mig, /not_cin/);
    assert.match(mig, /INVISIBLE/, '마이그레이션이 INVISIBLE 을 안 쓴다');
});

test('해시 조인 금지 힌트를 붙인다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        assert.match(sql, /NO_HASH_JOIN\(l, s\)/,
            '해시 조인 금지 힌트가 없다 — 희소 타입 분기에서 반복마다 해시를 새로 만든다');
        // Both hints go in one comment block.
        assert.match(sql, /\/\*\+ MAX_EXECUTION_TIME\(\d+\) NO_HASH_JOIN\(l, s\) \*\//);
        // l / s are aliases that exist only in the skeleton; on the child query the hint has no meaning.
        assert.ok(!/NO_HASH_JOIN/.test(childStmt(seen).sql),
            '자식 질의에 골격 별칭 힌트가 붙었다');
        done();
    }));
});

test('lvl=1 이면 재귀항이 없으니 힌트도 골격에 없다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '1' }, guard(done, function (code, ris, seen) {
        assert.ok(!/force index/.test(skelStmt(seen).sql), 'lvl=1 인데 골격에 힌트가 붙었다');
        // The child query must still carry the force index.
        assert.match(childStmt(seen).sql, /force index \(idx_lookup_pi_ty_ct\)/);
        done();
    }));
});

test('SQLite 는 MySQL 전용 문법을 붙이지 않는다', function (t, done) {
    const h = tap('sqlite');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = allSql(seen);
        assert.ok(!/collate/i.test(sql), 'SQLite 에 콜레이션이 붙었다: ' + sql);
        assert.ok(!/force index/i.test(sql), 'SQLite 에 force index 가 붙었다');
        assert.ok(!/MAX_EXECUTION_TIME/i.test(sql), 'SQLite 에 MySQL 힌트가 붙었다');
        assert.match(sql, /with recursive skel as/i, 'CTE 모양은 같아야 한다');
        done();
    }));
});

test('두 백엔드가 같은 문장 두 개를 만든다', function (t, done) {
    const m = tap('mysql');
    run(m, { ty: '3', lim: 20 }, guard(done, function (c1, r1, s1) {
        const q = tap('sqlite');
        run(q, { ty: '3', lim: 20 }, guard(done, function (c2, r2, s2) {
            // Only the adapter-provided fragments differ; the frame must be identical:
            //   collation / index forcing / optimizer hints / the 'not a CIN' expression
            const strip = (s) => s
                .replace(/ collate utf8mb3_general_ci/g, '')
                .replace(/ force index \([^)]*\)/g, '')
                .replace(/\/\*\+ [^*]*\*\/ /g, '')
                .replace(/l\.not_cin = 1|l\.ty <> 4/g, '<NOT_CIN>');
            assert.strictEqual(s1.length, s2.length, '문장 수가 다르다');
            assert.strictEqual(strip(allSql(s1)), strip(allSql(s2)),
                '방언 조각을 뺀 SQL 이 서로 다르다');
            done();
        }));
    }));
});

// 6.5) lbl filter. lbl is stored as indented JSON ('[\n    "tagX"\n]'), so the pattern must not be anchored to the brackets.

test('lbl 패턴이 대괄호에 붙어 있지 않다', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: 'tagX', lim: 20 }, guard(done, function (code, ris, seen) {
        // The pattern is a binding value; only a placeholder remains in the SQL.
        const c = childStmt(seen);
        assert.match(c.sql, /lbl like \?/, 'lbl 이 바인딩이 아니다: ' + c.sql);
        const pat = c.bindings.filter(function (v) {
            return typeof v === 'string' && v.indexOf('tagX') >= 0;
        })[0];
        assert.ok(pat, 'lbl 패턴이 바인딩에 없다: ' + JSON.stringify(c.bindings));
        assert.ok(pat.indexOf('[') !== 0,
            'lbl 패턴이 대괄호로 시작한다 — 들여쓴 JSON 을 못 맞춘다: ' + pat);
        assert.strictEqual(pat, '%"%tagX%"%');
        done();
    }));
});

// AND binds tighter than OR; without parentheses `lbl~a or lbl~b and ty=3` becomes `(lbl~a) or ((lbl~b) and ty=3)` and the first label matches regardless of type.

test('라벨이 여러 개면 OR 그룹을 괄호로 묶는다', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: ['a', 'b'], ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = childStmt(seen).sql;
        const m = /and\s+\(([^)]*lbl like[^)]*)\)/i.exec(sql);
        assert.ok(m, '라벨 OR 그룹에 괄호가 없다: ' + sql);
        assert.ok(/ or /.test(m[1]), '괄호 안에 or 가 없다: ' + m[1]);
        assert.ok(!/ty =/.test(m[1]), 'ty 가 라벨 괄호 안에 들어갔다: ' + m[1]);
        done();
    }));
});

test('라벨이 하나면 괄호를 만들지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: 'a', ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const c = childStmt(seen);
        assert.match(c.sql, /and lbl like \?/, c.sql);
        assert.ok(c.bindings.indexOf('%"%a%"%') >= 0,
            '라벨 패턴이 바인딩에 없다: ' + JSON.stringify(c.bindings));
        done();
    }));
});

// 6.7) sza / szb join cin. cs (contentSize) and cnf (contentInfo) live in cin, not lookup, so the comparison must use the alias c.cs.

test('sza 를 주면 cin 을 조인하고 c.cs 로 비교한다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '4', sza: 10, lim: 20 }, guard(done, function (code, ris, seen) {
        const c = childStmt(seen);
        assert.match(c.sql, /join cin c on c\.pi = r\.pi and c\.ri = r\.ri/,
            'cin 조인이 없다');
        // The size is a binding and the comparison target must be the aliased c.cs; lookup has no cs column.
        assert.match(c.sql, /\? <= c\.cs/, 'cs 를 별칭 없이 쓰거나 값을 인라인했다: ' + c.sql);
        assert.ok(c.bindings.indexOf(10) >= 0,
            'sza 가 수로 바인딩되지 않았다: ' + JSON.stringify(c.bindings));
        done();
    }));
});

test('szb 도 마찬가지다 — cty 는 이제 여기 오지 않는다', function (t, done) {
    // cty is unsupported: presearch_action rejects it with 400-65 before any SQL is built. See 'cty builds no SQL' below.
    const h = tap('mysql');
    run(h, { ty: '4', szb: 100, lim: 20 },
        guard(done, function (code, ris, seen) {
            const c = childStmt(seen);
            assert.strictEqual((c.sql.match(/join cin c/g) || []).length, 1,
                'cin 을 두 번 조인한다');
            assert.match(c.sql, /c\.cs < \?/, c.sql);
            assert.ok(c.bindings.indexOf(100) >= 0, 'szb 가 수로 안 왔다');
            done();
        }));
});

test('셋 다 없으면 cin 을 조인하지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lbl: 'x', rn: 'y', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(!/join cin/.test(allSql(seen)), '필요 없는데 cin 을 조인한다');
        done();
    }));
});

// cin.cs is int on MySQL and TEXT on SQLite. Comparing a TEXT column with an integer in SQLite has no numeric affinity on either side and the integer always compares lower, so `10 <= cs` is true for every row.

test('SQLite 는 cs 를 수로 캐스팅한다', function (t, done) {
    const h = tap('sqlite');
    run(h, { ty: '4', sza: 10, lim: 20 }, guard(done, function (code, ris, seen) {
        const c = childStmt(seen);
        assert.match(c.sql, /\? <= CAST\(c\.cs AS INTEGER\)/,
            'SQLite 에서 캐스팅 없이 비교하면 필터가 아무 일도 안 한다');
        assert.ok(c.bindings.indexOf(10) >= 0,
            'sza 가 수로 바인딩되지 않았다 — 문자열이면 캐스팅해도 비교가 어긋난다: ' +
            JSON.stringify(c.bindings));
        done();
    }));
});

test('MySQL 은 캐스팅하지 않는다 (이미 int 다)', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '4', sza: 10, lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(!/CAST\(c\.cs/.test(allSql(seen)), '불필요한 캐스팅이 붙었다');
        done();
    }));
});

test('cty 는 SQL 을 만들지 않는다 — 지원하지 않는 필터다', function () {
    // It is not enough that the value stays out of the SQL: the clause must not be built at all, or removing the gate would revive it.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.ok(!/query\.cty/.test(code),
        'sql_action 이 cty 를 다시 읽는다 — 지원하지 않기로 한 필터다');
    assert.ok(!/c\.cnf/.test(code),
        'cnf 비교가 되살아났다.\n' +
        '값이 클라이언트가 준 것뿐이라 답이 틀리고, 인덱스가 없어 후보를\n' +
        '건당 찾아간다. 배포 EXPLAIN 으로 값이 무엇이든 계획이 같다\n' +
        '(맞는 값/안 맞는 값/필터 없음 모두 cost 1271.55) — 값을 채워도 안 빨라진다.');

    // The gate must be present.
    const res = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    const rcode = res.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
    assert.match(rcode, /query\.cty != null/,
        'cty 게이트가 사라졌다 — 30초를 태우고 500-6 이 나가던 시절로 돌아간다');
    assert.match(rcode, /'400-65'/,
        'cty 게이트가 400-65 를 안 쓴다');
});

test('크기 필터가 있으면 골격이 CIN 없는 부모를 뺀다', function (t, done) {
    // The skeleton's recursive condition is `ty <> 4` ('widen through non-CIN children'), not 'parents that have CINs'. For sza / szb the parent list is filtered to containers with CINs, because the child query's cost is linear in the number of parents (range accesses).
    const h = tap('mysql');
    run(h, { sza: 100, lim: 20 }, guard(done, function (code, ris, seen) {
        const sk = skelStmt(seen).sql;
        assert.match(sk, /left join cnt\b/i,
            '골격이 부모를 안 거른다 — CIN 없는 부모까지 자식 질의로 간다');
        assert.match(sk, /n\.cni > 0/,
            'cni 로 거르지 않는다');

        // Must not be an inner join. Containers with CINs but no cnt row exist; an inner join would drop them silently.
        assert.match(sk, /n\.ri is null or/i,
            'cnt 에 행이 없는 부모를 버린다 — CIN 을 가진 컨테이너가 사라진다');
        assert.ok(!/(?<!left )join cnt\b/i.test(sk),
            'inner join 이다 — cnt 행이 없는 부모가 조용히 사라진다');
        done();
    }));
});

// Once the backfill is complete the join disappears. lookup carries a copy of cs (011 + backfill); when 012 confirms no unfilled CIN remains, db_bootstrap sets global.lookup_has_cin_attrs and discovery stops joining cin.
function withBackfilled(fn) {
    const saved = global.lookup_has_cin_attrs;
    global.lookup_has_cin_attrs = true;
    try { return fn(); } finally { global.lookup_has_cin_attrs = saved; }
}

test('백필이 끝나면 cin 을 조인하지 않고 r.cs 로 거른다', function (t, done) {
    withBackfilled(() => {
        const h = tap('mysql');
        run(h, { sza: 100, lim: 20 }, guard(done, function (code, ris, seen) {
            const c = childStmt(seen).sql;
            assert.ok(!/join cin\b/i.test(c),
                '백필이 끝났는데 여전히 cin 을 조인한다: ' + c);
            assert.match(c, /r\.cs/,
                'lookup 의 사본(r.cs)을 안 본다');
            assert.ok(!/c\.cs/.test(c),
                'cin 의 원본(c.cs)을 본다 — 조인이 없으므로 별칭 c 가 없다');

            // ty=4 must remain. After the join is gone this clause is the only one narrowing candidates to CINs.
            assert.match(c, /r\.ty = '4'/,
                "조인이 사라지면서 ty=4 도 같이 사라졌다 — 후보가 안 좁혀진다");
            done();
        }));
    });
});

test('백필이 끝나도 부모 필터는 남는다', function (t, done) {
    // Filtering parents pays off regardless of the join, since the cost is linear in parent count. Deciding by needs_cin_join would silently switch it off after the backfill.
    withBackfilled(() => {
        const h = tap('mysql');
        run(h, { sza: 100, lim: 20 }, guard(done, function (code, ris, seen) {
            assert.match(skelStmt(seen).sql, /left join cnt\b/i,
                '백필이 끝나자 부모 필터가 꺼졌다 — 헛부모가 다시 들어온다');
            done();
        }));
    });
});

test('백필이 끝나도 답 없는 조합은 여전히 질의를 안 던진다', function (t, done) {
    // 'cs exists only on CINs, so searching other types has no answer' holds whichever table the value is read from. Asking needs_cin_join would silently disable this gate after the backfill.
    withBackfilled(() => {
        const h = tap('mysql');
        run(h, { ty: '3', sza: 100, lim: 20 }, guard(done, function (code, ris, seen) {
            assert.strictEqual(seen.length, 0,
                'ty=3 + sza 인데 질의를 던졌다 — 답이 있을 수 없는 조합이다');
            done();
        }));
    });
});

test('스위치의 기본값은 꺼짐이다 — 안전한 쪽', function () {
    // When enabled, rows not yet backfilled silently disappear from results, with no error. The default must therefore be the old path.
    const sql = require(path.join(ROOT, 'mobius', 'sql_action.js'));
    const saved = global.lookup_has_cin_attrs;
    try {
        delete global.lookup_has_cin_attrs;
        assert.strictEqual(sql._lookup_has_cin_attrs(), false,
            '전역이 없는데 참이다 — 백필 전에 켜지면 답이 조용히 줄어든다');

        // Truthy does not enable it; the value must be === true.
        global.lookup_has_cin_attrs = 'true';
        assert.strictEqual(sql._lookup_has_cin_attrs(), false,
            "문자열 'true' 에 켜진다 — 실수로 켜질 여지를 두면 안 된다");
        global.lookup_has_cin_attrs = 1;
        assert.strictEqual(sql._lookup_has_cin_attrs(), false, '1 에 켜진다');
    } finally {
        if (saved === undefined) { delete global.lookup_has_cin_attrs; }
        else { global.lookup_has_cin_attrs = saved; }
    }
});

test('크기 필터가 없으면 골격을 건드리지 않는다', function (t, done) {
    // The skeleton of ordinary discovery is unchanged. Filtering parents only matters for requests that look at CIN attributes; elsewhere the cnt join is pure cost.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(!/join cnt\b/i.test(skelStmt(seen).sql),
            '크기 필터가 없는데 골격이 cnt 를 조인한다');
        done();
    }));
});

test('부모 필터의 콜레이션은 어댑터가 정한다', function () {
    // sk_ri is cast with pathCollate while cnt.ri keeps its original collation. The fragment that reconciles them is dialect and must not be a string literal in the core.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.match(code, /facade\.riCollate\(\)/,
        '부모 필터가 riCollate 를 안 쓴다');
    assert.ok(!/collate utf8mb3/i.test(code),
        '코어가 콜레이션 이름을 직접 적는다 — 어댑터가 줘야 한다');

    // SQLite has no fragment; one would be a syntax error.
    assert.strictEqual(require(path.join(DB, 'sqlite.js')).riCollate(), '',
        'SQLite 에 콜레이션 조각이 붙는다 — 구문 오류가 난다');
    // MySQL's fragment is empty as well: after 018 lookup.ri, cnt.ri and the skeleton columns are all bin. A revived fragment would cost the recursive join its index (see test 6 above).
    assert.strictEqual(require(path.join(DB, 'mysql.js')).riCollate(), '',
        'MySQL 에 콜레이션 조각이 되살아났다 — 018 뒤에는 필요 없고 인덱스를 죽인다');
    assert.strictEqual(require(path.join(DB, 'mysql.js')).pathCollate(), '');
});

test('needs_cin_join 이 둘을 정확히 가린다', function () {
    const h = tap('mysql');
    const f = h.sql_action.needs_cin_join;
    assert.strictEqual(f({ sza: 1 }), true);
    assert.strictEqual(f({ szb: 1 }), true);
    assert.strictEqual(f({ sza: 0 }), true, '0 도 값이다');
    assert.strictEqual(f({ ty: '3', lbl: 'x' }), false);
    assert.strictEqual(f({}), false);

    // cty is unsupported; returning true here would prepare a join for a request presearch_action has already rejected.
    assert.strictEqual(f({ cty: 'x' }), false,
        'cty 가 다시 조인을 부른다 — 지원하지 않기로 한 필터다');
});

// cs / cnf exist only on contentInstance, so results are necessarily ty=4. Stating it lets the optimizer narrow candidates instead of probing cin for every skeleton child.

test('크기·형식 필터가 있으면 ty=4 를 명시한다', function (t, done) {
    const h = tap('mysql');
    run(h, { sza: 10, lim: 20 }, guard(done, function (code, ris, seen) {
        assert.match(childStmt(seen).sql, /\) and r\.ty = '4'/,
            "ty=4 를 안 박으면 인덱스가 CIN 만 집어내지 못한다");
        done();
    }));
});

test('필터가 없으면 ty=4 를 박지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(!/r\.ty = '4'/.test(allSql(seen)), '엉뚱하게 ty=4 가 붙었다');
        done();
    }));
});

// A combination that cannot have an answer does not touch the DB.

test('ty 가 4 를 안 포함하면 질의를 던지지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', sza: 10, lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        assert.strictEqual(ris.length, 0);
        assert.strictEqual(seen.length, 0,
            '답이 없는 게 확실한데 DB 를 훑었다');
        done();
    }));
});

test('ty 에 4 가 섞여 있으면 질의를 던진다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: ['3', '4'], sza: 10, lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(seen.length, 2, 'ty 에 4 가 있는데 건너뛰었다');
        done();
    }));
});

test('ty 를 안 주면 질의를 던진다 (CIN 도 후보다)', function (t, done) {
    const h = tap('mysql');
    run(h, { sza: 10, lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(seen.length, 2);
        done();
    }));
});

test('size_filter_excludes_all 판정', function () {
    const h = tap('mysql');
    const f = h.sql_action.size_filter_excludes_all;
    assert.strictEqual(f({ ty: '3', sza: 1 }), true);
    assert.strictEqual(f({ ty: '4', sza: 1 }), false);
    assert.strictEqual(f({ ty: '3,4', sza: 1 }), false, '쉼표로 여러 개');
    assert.strictEqual(f({ ty: ['2', '3'], szb: 1 }), true, '배열로 여러 개');
    assert.strictEqual(f({ ty: ['2', '4'], cty: 'x' }), false);
    assert.strictEqual(f({ sza: 1 }), false, 'ty 를 안 주면 CIN 도 후보다');
    assert.strictEqual(f({ ty: '3' }), false, '필터가 없으면 상관없다');
});

// 7) Injection defence.

test('루트 ri 는 바인딩으로 넘어간다', function (t, done) {
    const h = tap('mysql');
    const evil = "/M' or 1=1 --";
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        // The root is the skeleton query's only binding.
        assert.strictEqual(skelStmt(seen).bindings[0], evil, '루트 ri 가 첫 바인딩이 아니다');
        assert.strictEqual(allSql(seen).indexOf(evil), -1, 'ri 가 SQL 에 박혔다');
        done();
    }), evil);
});

test('lim / ofst 는 정수로만 들어간다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: '20; drop table lookup', ofst: '5 union select' },
        guard(done, function (code, ris, seen) {
            // union is legitimately present in the skeleton CTE; only the child query is inspected.
            assert.ok(!/drop table|union select/i.test(childStmt(seen).sql),
                '문자열이 그대로 들어갔다: ' + childStmt(seen).sql);
            assert.match(childStmt(seen).sql, /limit 20$/,
                'lim 이 정수로 잘리지 않았다: ' + childStmt(seen).sql);
            done();
        }));
});

// 7.5) A question mark in a filter value must not break the query. Filter values go out as named bindings (:qN); positional bindings (?) would make knex count a literal question mark as a placeholder and fail with 'Expected N bindings, saw N+1'. knex finally emits positional placeholders and a value array; the value must not remain in the SQL.

test('rn 값에 물음표가 있어도 질의가 나간다', function (t, done) {
    const h = tap('mysql');
    run(h, { rn: 'what?', lim: 10 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200', '물음표 하나에 500 이 났다');
        assert.strictEqual(seen.length, 2, '질의가 안 나갔다');
        const c = childStmt(seen);
        assert.match(c.sql, /rn = \?/, '필터가 빠졌다: ' + c.sql);
        assert.strictEqual(skelStmt(seen).bindings[0], '/M', '루트 ri 가 첫 바인딩이 아니다');
        assert.ok(c.bindings.indexOf('what?') >= 0,
            'rn 값이 바인딩에 없다: ' + JSON.stringify(c.bindings));
        assert.strictEqual(allSql(seen).indexOf('what?'), -1,
            'rn 값이 SQL 에 인라인됐다: ' + c.sql);
        done();
    }));
});

test('lbl 값에 물음표가 여러 개 있어도 된다', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: 'a?b?c', ty: '3', lim: 10 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        assert.strictEqual(skelStmt(seen).bindings[0], '/M');
        assert.ok(childStmt(seen).bindings.indexOf('%"%a?b?c%"%') >= 0,
            '라벨 패턴이 바인딩에 없다: ' + JSON.stringify(childStmt(seen).bindings));
        assert.strictEqual(allSql(seen).indexOf('a?b?c'), -1,
            '라벨 값이 SQL 에 인라인됐다: ' + childStmt(seen).sql);
        done();
    }));
});

test('루트 ri 는 이름 바인딩으로 넘어간다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 10 }, guard(done, function (code, ris, seen) {
        // knex replaces :root_ri / :pN / :qN with positional placeholders.
        const sql = allSql(seen);
        assert.ok(sql.indexOf(':root_ri') === -1, ':root_ri 가 치환되지 않았다');
        assert.ok(!/:q\d/.test(sql), '필터 이름 바인딩이 치환되지 않았다: ' + sql);
        assert.ok(!/:p\d/.test(sql), '부모 이름 바인딩이 치환되지 않았다: ' + sql);
        // The skeleton binds the root only; the child binds the parents plus ty.
        assert.deepStrictEqual(skelStmt(seen).bindings, ['/M']);
        assert.deepStrictEqual(childStmt(seen).bindings,
            SKEL_ROWS.map((r) => r.sk_ri).concat(['3']));
        done();
    }));
});

// 7.6) DB errors must be recognisable in the log. The facade contract on failure is cb(true, errObj): the error object is the second argument. Treating the first as the error logs only 'true'.

test('문장 타임아웃을 다른 DB 오류와 구분해 남긴다', function (t, done) {
    const h = tap('mysql');
    const adapter = require(path.join(DB, 'mysql.js'));
    adapter.execute = function (conn, sql, bindings, cb) {
        const e = new Error('Query execution was interrupted');
        e.code = 'ER_MAX_EXECUTION_TIME_EXCEEDED';
        e.errno = 3024;
        cb(e, null);
    };
    const logs = [];
    const orig = console.error;
    console.error = function () { logs.push([].slice.call(arguments).join(' ')); };
    run(h, { ty: '3', lim: 10 }, function (code) {
        console.error = orig;
        try {
            // Hitting the time limit is not a DB failure but 'this scope is too large'. It must not be flattened into 500-1 (database error).
            assert.strictEqual(code, '400-67');   // formerly 500-6; the key prefix now matches the HTTP status (400)
            assert.ok(logs.some((l) => /statement timeout/.test(l)),
                '타임아웃이 구분되지 않았다: ' + JSON.stringify(logs));
            assert.ok(logs.some((l) => /ty 를 함께 준다/.test(l)),
                '무엇을 고쳐야 할지 로그에 없다: ' + JSON.stringify(logs));
            assert.ok(!logs.some((l) => /^\[search_lookup\] true$/.test(l)),
                '에러 객체를 첫 인자로 착각했다');
            done();
        } catch (e) { done(e); }
    });
});

test('그 밖의 DB 오류는 메시지를 남긴다', function (t, done) {
    const h = tap('mysql');
    const adapter = require(path.join(DB, 'mysql.js'));
    adapter.execute = function (conn, sql, bindings, cb) {
        const e = new Error('Unknown column');
        e.code = 'ER_BAD_FIELD_ERROR';
        e.sqlMessage = "Unknown column 'cs' in 'where clause'";
        cb(e, null);
    };
    const logs = [];
    const orig = console.error;
    console.error = function () { logs.push([].slice.call(arguments).join(' ')); };
    run(h, { ty: '3', lim: 10 }, function (code) {
        console.error = orig;
        try {
            assert.strictEqual(code, '500-1');
            assert.ok(logs.some((l) => /Unknown column/.test(l)),
                '오류 메시지가 안 남았다: ' + JSON.stringify(logs));
            done();
        } catch (e) { done(e); }
    });
});

// 8) Skeleton column names do not collide with filter fragments. build_search_query names columns without an alias (lbl, ty, ct ...); a skeleton exporting ri / ty would make the outer where ambiguous.

test('골격 컬럼 이름은 sk_ 접두사를 쓴다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lbl: 'status', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.match(skelStmt(seen).sql, /select ri.* as sk_ri, 0 as sk_lvl/);
        assert.ok(/lbl like/.test(childStmt(seen).sql), 'lbl 필터가 빠졌다');
        // The child query does not join the skeleton; it receives parents as values.
        assert.ok(!/join skel/.test(childStmt(seen).sql),
            '자식 질의가 아직 골격을 조인한다 — 그러면 ct 가 키 범위에서 빠진다');
        done();
    }));
});

// 11) Skeleton columns and join conditions keep their original collation. With lookup.ri as utf8mb3_bin, casting the skeleton column would make UNION treat case-variant paths as distinct rows, and casting in the join would lose the (pi, not_cin) index.

test('MySQL 골격은 어디에도 콜레이션을 붙이지 않는다 — 018 뒤 pi · ri 가 같은 bin 이다', function (t, done) {
    // After 018 pi and ri share the bin collation. Any cast in the recursive join converts l.pi and loses the (pi, not_cin) index, so neither the skeleton columns nor the join condition carries a collation.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        assert.match(sql, /select ri as sk_ri/, '앵커의 골격 컬럼이 원래 콜레이션이 아니다: ' + sql.slice(0, 120));
        assert.match(sql, /select l\.ri, s\.sk_lvl/, '재귀항의 골격 컬럼에 캐스트가 있다');
        assert.doesNotMatch(sql, /collate/i, '골격 어딘가에 콜레이션 캐스트가 있다');
        done();
    }));
});

// A lbl search without ty excludes CINs. lbl is a JSON array string matched with like '%..%', which no index serves; without a type the candidates are every child under the skeleton, most of them CINs. The (pi, not_cin) index restricts the candidates.

test('lbl 만 주면 CIN 을 빼고 (pi, not_cin) 을 쓴다', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: 'status', lim: 10 }, guard(done, function (code, ris, seen) {
        const child = childStmt(seen).sql;
        assert.ok(/idx_lookup_pi_notcin/.test(child),
            '자식 질의가 (pi, not_cin) 을 안 쓴다: ' + child);
        assert.ok(/r\.not_cin = 1/.test(child), 'CIN 을 빼는 조건이 없다: ' + child);
        assert.ok(!/idx_lookup_pi_ty_ct/.test(child),
            'ty 인덱스를 쓰면 부모마다 CIN 을 전부 읽는다');
        done();
    }));
});

test('ty 를 함께 주면 예전 그대로 (pi, ty, ct) 를 쓴다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lbl: 'status', lim: 10 }, guard(done, function (code, ris, seen) {
        const child = childStmt(seen).sql;
        assert.ok(/idx_lookup_pi_ty_ct/.test(child), child);
        assert.ok(!/r\.not_cin = 1/.test(child), 'ty 를 줬는데 CIN 을 뺐다');
        done();
    }));
});

test('lbl 이 없으면 CIN 을 빼지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { lim: 10 }, guard(done, function (code, ris, seen) {
        const child = childStmt(seen).sql;
        assert.ok(!/r\.not_cin = 1/.test(child), 'lbl 도 없는데 CIN 을 뺐다: ' + child);
        done();
    }));
});

test('CIN 을 뺐다는 사실을 호출부에 알린다 — 조용히 좁히지 않는다', function (t, done) {
    // CIN labels are used in practice. 'not found' and 'not searched' must be distinguishable.
    const h = tap('mysql');
    const found = {};
    h.sql_action.search_lookup(null, '/M', { lbl: 'status', lim: 10 }, 10, ['/M'], 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code, info) {
            try {
                assert.strictEqual(code, '200');
                assert.strictEqual(info.skippedCin, true);
                done();
            } catch (e) { done(e); }
        });
});

test('ty 를 주면 skippedCin 이 서지 않는다', function (t, done) {
    const h = tap('mysql');
    const found = {};
    h.sql_action.search_lookup(null, '/M', { ty: '3', lbl: 'x', lim: 10 }, 10, ['/M'], 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code, info) {
            try {
                assert.strictEqual(info.skippedCin, false);
                done();
            } catch (e) { done(e); }
        });
});

test('SQLite 도 같은 뜻을 낸다 (ty <> 4)', function (t, done) {
    const h = tap('sqlite');
    run(h, { lbl: 'status', lim: 10 }, guard(done, function (code, ris, seen) {
        const child = childStmt(seen).sql;
        assert.ok(/r\.ty.{0,3}<>.{0,3}4/.test(child), child);
        done();
    }));
});

// 9) Discovery filter values never enter the SQL text. Every value goes out as a named binding, so no per-value escaping exists; a new filter that concatenates its value into the string fails here.

// cty is unsupported and is rejected by presearch_action with 400-65 before SQL is built. 'Unsupported filters build no SQL' below covers it.
const FILTERS = [
    ['lbl', "a'b"], ['rn', "x' or '1'='1"],
    ['cra', "2026' or 1=1 --"], ['crb', "2026'"], ['ms', "2026'"], ['us', "2026'"],
    ['exa', "2026'"], ['exb', "2026'"], ['sts', "1'"], ['stb', "1'"]
];

for (const [key, evil] of FILTERS) {
    test('필터 값이 SQL 에 안 들어간다: ' + key, function (t, done) {
        const h = tap('mysql');
        const q = { lim: 10 };
        q[key] = evil;
        run(h, q, guard(done, function (code, ris, seen) {
            assert.strictEqual(code, '200', key + ' 에 500 이 났다');
            assert.strictEqual(seen.length, 2, '질의가 안 나갔다');

            assert.strictEqual(allSql(seen).indexOf(evil), -1,
                key + ' 값이 SQL 에 들어갔다: ' + allSql(seen));

            // The value must appear in the bindings unchanged. A leftover escape would be applied twice and change the searched string (it's -> it''s).
            const found = allBindings(seen).some(function (v) {
                return typeof v === 'string' && v.indexOf(evil) >= 0;
            });
            assert.ok(found, key + ' 값이 바인딩에 원본 그대로 없다 (이중 이스케이프?): ' +
                JSON.stringify(allBindings(seen)));
            done();
        }));
    });
}

test('sanitize 는 문자열 값을 더 이상 건드리지 않는다', function () {
    // A leftover escape would be applied on top of the binding, so a search for `it's` would look for `it''s`.
    delete require.cache[require.resolve('../mobius/sql_action')];
    const sql_action = require('../mobius/sql_action');

    const q = { lbl: "it's", rn: 'a\\b', cty: 'x\ny' };
    sql_action.sanitize_discovery_query(q);

    assert.strictEqual(q.lbl, "it's", 'lbl 이 변형됐다: ' + q.lbl);
    assert.strictEqual(q.rn, 'a\\b', 'rn 이 변형됐다: ' + q.rn);
    assert.strictEqual(q.cty, 'x\ny', 'cty 가 변형됐다: ' + JSON.stringify(q.cty));
});

test('sanitize 는 숫자 파라미터를 여전히 거른다', function () {
    // These are not bindings (limit/offset/sk_lvl literals) or are used for branch decisions.
    delete require.cache[require.resolve('../mobius/sql_action')];
    const sql_action = require('../mobius/sql_action');

    const q = { sza: '1 or 1=1', szb: 'x', la: '5;drop', ofst: '-1', lvl: 'a',
                ty: "3' or '1'='1" };
    sql_action.sanitize_discovery_query(q);

    for (const k of ['sza', 'szb', 'la', 'ofst', 'lvl', 'ty']) {
        assert.strictEqual(q[k], undefined, k + ' 가 안 걸러졌다: ' + q[k]);
    }

    const ok = { sza: '10', ty: '3,4' };
    sql_action.sanitize_discovery_query(ok);
    assert.strictEqual(ok.sza, '10', '정상 값이 걸러졌다');
    assert.strictEqual(ok.ty, '3,4', '정상 ty 목록이 걸러졌다');
});

// 10) ty list splitting. ty arrives as an array (ty=3&ty=4) or a comma string (ty=3,4). The values are iterated from split(','), never by character index.

test('ty 가 콤마 문자열이어도 값만 분해한다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3,4', lim: 10 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        const b = childStmt(seen).bindings;
        // Parents plus two ty values. The comma must not become a value.
        assert.ok(b.indexOf('3') >= 0, "ty '3' 이 바인딩에 없다: " + JSON.stringify(b));
        assert.ok(b.indexOf('4') >= 0, "ty '4' 가 바인딩에 없다: " + JSON.stringify(b));
        assert.strictEqual(b.indexOf(','), -1,
            '쉼표가 ty 값으로 들어갔다 — 글자 단위로 돌고 있다: ' + JSON.stringify(b));

        // Exactly two ty clauses.
        const child = childStmt(seen).sql;
        assert.strictEqual((child.match(/ty = \?/g) || []).length, 2,
            'ty 절 개수가 2가 아니다: ' + child);
        done();
    }));
});

test('ty 가 배열이면 그대로 분해한다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: ['3', '4'], lim: 10 }, guard(done, function (code, ris, seen) {
        const b = childStmt(seen).bindings;
        assert.ok(b.indexOf('3') >= 0 && b.indexOf('4') >= 0, JSON.stringify(b));
        assert.strictEqual(b.indexOf(','), -1);
        done();
    }));
});

test('ty 하나면 괄호를 만들지 않는다', function (t, done) {
    // A single equality lets the index use the (pi, ty) range. A single value does not produce an OR group.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 10 }, guard(done, function (code, ris, seen) {
        const child = childStmt(seen).sql;
        assert.match(child, /and ty = \?/, child);
        assert.ok(!/\(ty = \? or/.test(child), '하나인데 OR 그룹을 만들었다: ' + child);
        done();
    }));
});

// 11) Non-scalar filter values are dropped. Express's default query parser ('extended', qs) turns ?cra[x]=1 into the object { x: '1' }. Binding an object makes the driver expand it into backtick identifiers:
//
//   ?rn[x]=1   ->  and rn = `x` = '1'      ER_BAD_FIELD_ERROR -> 500
//   ?cra[x]=1  ->  and `x` = '1' <= ct     valid syntax, 0 <= ct is true, filter disabled

test('객체형 필터 값은 버린다 (필터 무력화 방지)', function (t, done) {
    const h = tap('mysql');
    // An object-valued cra must drop that filter; otherwise an identifier lands in the SQL.
    run(h, { cra: { x: '1' }, ty: '3', lim: 10 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        const sql = allSql(seen);
        assert.ok(!/<= ct/.test(sql), 'cra 필터가 살아남았다: ' + sql);
        assert.ok(!/`x`/.test(sql), '객체 키가 식별자로 SQL 에 박혔다: ' + sql);
        allBindings(seen).forEach(function (v) {
            assert.notStrictEqual(typeof v, 'object', '객체가 바인딩됐다: ' + JSON.stringify(v));
        });
        done();
    }));
});

test('객체형 rn 도 버린다', function (t, done) {
    const h = tap('mysql');
    run(h, { rn: { x: '1' }, ty: '3', lim: 10 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200', '500 이 났다');
        assert.ok(!/rn = /.test(allSql(seen)), 'rn 필터가 살아남았다: ' + allSql(seen));
        done();
    }));
});

test('lbl 은 배열을 허용한다 (라벨 여럿은 정상 요청)', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: ['a', 'b'], ty: '3', lim: 10 }, guard(done, function (code, ris, seen) {
        const b = childStmt(seen).bindings;
        assert.ok(b.indexOf('%"%a%"%') >= 0 && b.indexOf('%"%b%"%') >= 0,
            '라벨 배열이 버려졌다: ' + JSON.stringify(b));
        done();
    }));
});

test('lbl 배열 안에 객체가 섞이면 버린다', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: ['a', { x: 1 }], ty: '3', lim: 10 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        assert.ok(!/lbl like/.test(allSql(seen)), 'lbl 필터가 살아남았다: ' + allSql(seen));
        done();
    }));
});

test('정상 스칼라 값은 그대로 통과한다', function (t, done) {
    const h = tap('mysql');
    run(h, { rn: 'abc', cra: '20260101T000000', ty: '3', lim: 10 },
        guard(done, function (code, ris, seen) {
            const b = childStmt(seen).bindings;
            assert.ok(b.indexOf('abc') >= 0, 'rn 이 버려졌다: ' + JSON.stringify(b));
            assert.ok(b.indexOf('20260101T000000') >= 0, 'cra 가 버려졌다: ' + JSON.stringify(b));
            done();
        }));
});

// 12) Parents are split into batches and passed as an IN list.
//
// Why IN: a join makes MySQL choose ref access, using the index only to (pi, ty) and scanning ct via ICP. A constant list gives a range access with key_len 671 (pi, ty, ct).
//
// Why batches: range_optimizer_max_mem_size is 8MB; an IN list beyond that budget makes MySQL abandon range and fall back to a full index scan, with no warning. The turning point depends on path string length, so the batch size is 4,000 for a 2x margin.

// Builds a skeleton with n parents.
function bigSkeleton(n) {
    const out = [];
    for (let i = 0; i < n; i++) { out.push({ sk_ri: '/M/x' + i, sk_lvl: 1 }); }
    return out;
}

test('자식 질의는 부모를 IN 목록으로 받고 값은 전부 바인딩이다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const c = childStmt(seen);
        assert.match(c.sql, /where r\.pi in \(\?(, \?)*\)/,
            '부모가 IN 목록이 아니다: ' + c.sql);
        // Paths must not enter the SQL text; a path may contain a question mark.
        SKEL_ROWS.forEach(function (r) {
            assert.strictEqual(c.sql.indexOf(r.sk_ri), -1,
                '부모 경로가 SQL 에 인라인됐다: ' + c.sql);
        });
        assert.deepStrictEqual(c.bindings.slice(0, SKEL_ROWS.length),
            SKEL_ROWS.map((r) => r.sk_ri), '부모가 바인딩 앞자리에 오지 않았다');
        done();
    }));
});

test('부모가 4,000을 넘으면 배치를 나눈다', function (t, done) {
    // 4,001 parents give two child queries (4,000 + 1).
    const h = tap('mysql', { skeleton: bigSkeleton(4001), children: () => [] });
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        assert.strictEqual(seen.length, 3, '골격 1 + 자식 2 가 아니다: ' + seen.length);
        assert.strictEqual(parentCount(seen[1].sql), 4000);
        assert.strictEqual(parentCount(seen[2].sql), 1);
        done();
    }));
});

test('배치 크기는 4,000을 넘지 않는다', function (t, done) {
    // Raising this bound would one day drop range to a full index scan merely because paths grew longer, so it is pinned.
    const h = tap('mysql', { skeleton: bigSkeleton(9000), children: () => [] });
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(seen.length, 4, '골격 1 + 자식 3 이 아니다: ' + seen.length);
        seen.slice(1).forEach(function (s) {
            assert.ok(parentCount(s.sql) <= 4000,
                '배치가 4,000을 넘었다: ' + parentCount(s.sql));
        });
        assert.strictEqual(parentCount(seen[1].sql), 4000, '배치를 덜 채웠다');
        done();
    }));
});

test('배치 상수는 소스에 근거와 함께 4,000으로 박혀 있다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    assert.match(src, /const DISCOVERY_PARENT_BATCH = 4000;/,
        '배치 상수가 4,000이 아니다 — 8,000~10,000 사이에서 range 가 무너진다');
    assert.match(src, /range_optimizer_max_mem_size/,
        '왜 4,000인지의 근거가 사라졌다');
});

test('lim 을 채우면 남은 배치를 던지지 않는다', function (t, done) {
    const h = tap('mysql', { skeleton: bigSkeleton(4001) });
    run(h, { ty: '3', lim: 5 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(ris.length, 5);
        assert.strictEqual(seen.length, 2,
            '한도를 채웠는데 남은 배치를 던졌다: ' + seen.length);
        done();
    }));
});

// ofst / la never bypass the batch path, however large the skeleton. ofst is the value the server advertises in X-M2M-CTO, so normal paging goes through it.

test('오프셋은 경계 있는 count 로 소진한다 — 경계 없는 count 는 금지', function (t, done) {
    // An unbounded `select count(*)` scans every candidate; the bounded count returns as soon as the bound is reached.
    const h = tap('mysql', { skeleton: bigSkeleton(9001) });
    run(h, { ty: '3', lim: 3, ofst: 2 }, guard(done, function (code, ris, seen) {
        const counts = seen.filter((s) => /count\(\*\) as n/i.test(s.sql));
        assert.ok(counts.length > 0, '오프셋이 있는데 count 질의가 없다');
        counts.forEach((c) => {
            assert.match(c.sql, /limit \d+\) t$/,
                '경계 없는 count 다 — 후보를 전부 훑는다: ' + c.sql);
            const cap = parseInt(/limit (\d+)\) t$/.exec(c.sql)[1], 10);
            assert.strictEqual(cap, 3, '경계가 (남은오프셋 + 1) 이 아니다: ' + cap);
        });
        done();
    }));
});

test('오프셋 안쪽 배치는 행을 하나도 받지 않는다', function (t, done) {
    // Each batch yields 4 rows. With ofst=6 the first batch (4 rows) is skipped entirely and 2 rows are skipped in the second.
    const h = tap('mysql', {
        skeleton: bigSkeleton(4001),
        children: () => [{ ri: '/a' }, { ri: '/b' }, { ri: '/c' }, { ri: '/d' }]
    });
    run(h, { ty: '3', lim: 10, ofst: 6 }, guard(done, function (code, ris, seen) {
        const fetches = seen.filter((s) => isChild(s) && !/count\(\*\) as n/i.test(s.sql));
        assert.strictEqual(fetches.length, 1,
            '오프셋 안쪽 배치에서도 행을 받았다: ' + fetches.length + '회');
        assert.match(fetches[0].sql, /offset 2$/,
            '남은 오프셋이 아니라 전역 오프셋을 그대로 걸었다: ' + fetches[0].sql);
        done();
    }));
});

test('la 도 배치 경로를 탄다 — 골격을 조인하면 pi 가 상수가 아니다', function (t, done) {
    // The legacy single statement joins the skeleton, so pi is not a constant and the sort becomes a filesort even without index forcing. pi as constants in an IN list lets the optimizer use a reverse index range.
    const h = tap('mysql');
    run(h, { la: '2' }, guard(done, function (code, ris, seen) {
        assert.ok(seen.some(isChild),
            'la 가 배치 경로를 안 썼다 — pi 가 상수가 아니면 filesort 다');
        assert.ok(!seen.some(isOneShot),
            'la 가 예전 한 문장으로 갔다 — 그 모양은 filesort 를 피할 수 없다');
        assert.match(childStmt(seen).sql, /r\.pi in \(/i, 'pi 가 상수 목록이 아니다');
        done();
    }));
});

test('예전 한 문장 경로는 배선돼 있지 않다', function () {
    // build_descendant_sql remains but has zero callers; it is kept as reference for what the batch path replaced. Re-wiring it would bring back the la filesort and the ofst path split.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    // Comments are excluded; they quote the name while explaining it.
    const lines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));

    // Definition and export must exist (it is kept as reference code).
    assert.ok(lines.some((l) => /function build_descendant_sql\s*\(/.test(l)),
        'build_descendant_sql 이 사라졌다 — 배치 경로가 무엇을 대체했는지 알 수 없게 된다');

    // Counts call sites, not name occurrences: `exports.build_descendant_sql = build_descendant_sql;` mentions it twice.
    const calls = lines.filter((l) =>
        /build_descendant_sql\s*\(/.test(l) && !/function\s+build_descendant_sql/.test(l));

    assert.deepStrictEqual(calls.map((l) => l.trim()), [],
        'build_descendant_sql 이 다시 배선됐다.\n' +
        'la 는 filesort 로, ofst 는 페이징 어긋남으로 돌아간다.');
});

test('부모가 0개면 자식 질의를 던지지 않는다', function (t, done) {
    // An unknown ri yields an empty skeleton and no further queries.
    const h = tap('mysql', { skeleton: [] });
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        assert.strictEqual(ris.length, 0);
        assert.strictEqual(seen.length, 1, '부모가 없는데 자식을 찾았다: ' + seen.length);
        done();
    }));
});

test('배치가 실패하면 그 코드로 한 번만 콜백한다', function (t, done) {
    const h = tap('mysql', { skeleton: bigSkeleton(4001), children: () => [] });
    const adapter = require(path.join(DB, 'mysql.js'));
    const orig = adapter.execute;
    let n = 0;
    adapter.execute = function (conn, sql, bindings, cb) {
        n++;
        if (n === 2) {   // fails on the first batch
            const e = new Error('boom');
            e.sqlMessage = 'batch failed';
            return cb(e, null);
        }
        return orig.call(adapter, conn, sql, bindings, cb);
    };
    const logs = [];
    const cerr = console.error;
    console.error = function () { logs.push([].slice.call(arguments).join(' ')); };

    let calls = 0;
    const found = {};
    h.sql_action.search_lookup(null, '/M', { ty: '3', lim: 20 }, 20, ['/M'], 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code) {
            calls++;
            console.error = cerr;
            try {
                assert.strictEqual(code, '500-1');
                assert.strictEqual(calls, 1, '콜백이 여러 번 불렸다');
                assert.strictEqual(n, 2, '실패 뒤에도 남은 배치를 던졌다: ' + n);
                assert.ok(logs.some((l) => /batch failed/.test(l)),
                    '오류 메시지가 안 남았다: ' + JSON.stringify(logs));
                done();
            } catch (e) { done(e); }
        });
});

// Exceeding the search scope is a 4xx. The server is not broken; the request's scope is beyond capacity, and the same request will fail again, so a 5xx ('retry may succeed') would mislead the caller.

test('탐색 범위 초과(400-67, 옛 500-6)는 BAD_REQUEST 로 나간다', function () {
    const reason = require(path.join(ROOT, 'mobius', 'reason.js'));
    const rsc = require(path.join(ROOT, 'mobius', 'rsc.js'));

    const r = reason.of ? reason.of('400-67') : null;
    // Looks the entry up in the catalogue text directly, independent of the reason module's accessor name.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'reason.js'), 'utf8');
    const at = src.indexOf("'400-67':");
    assert.ok(at > 0, '400-67 이 카탈로그에 없다');
    const entry = src.slice(at, at + 300);

    assert.match(entry, /code:\s*RSC\.BAD_REQUEST/,
        '500-6 이 BAD_REQUEST 가 아니다 — 재시도해도 안 되는 요청에 5xx 를 주면 안 된다');
    assert.ok(!/code:\s*RSC\.INTERNAL_SERVER_ERROR/.test(entry),
        '500-6 이 INTERNAL_SERVER_ERROR 로 되돌아갔다');

    // The message must say what to change.
    assert.match(entry, /narrow the target/i, '무엇을 좁히라는 안내가 없다');
    assert.match(entry, /ty filter/i, 'ty 필터 안내가 없다');
    assert.match(entry, /cra|crb/i, '시간 범위 안내가 없다');

    assert.strictEqual(rsc.RSC.BAD_REQUEST.http, 400, 'BAD_REQUEST 가 400 이 아니다');
});
