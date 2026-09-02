'use strict';
// discovery 는 MySQL / SQLite 모두 **문장 둘**로 처리한다:
//   1) 재귀 CTE 로 골격(부모가 될 수 있는 노드)을 뽑는다
//   2) 그 골격을 4,000개씩 잘라 `pi in (:p0, ...)` 로 자식을 뽑는다
//
// 예전에는 MySQL 만 2단계였다: 레벨별로 부모를 모으고(search_parents_lookup),
// 부모마다 'select * from lookup where pi = ?' 를 던졌다. 그 방식은
//   - 레벨당 2,000개 상한이 있어 큰 트리에서 결과가 조용히 잘렸고
//   - ofst 가 부모마다 적용돼 전역 오프셋이 아니었으며
//   - 부모 수만큼 왕복이 생겼다 (배포 서버 실측 4,080회 -> 묶어서 25회)
// SQLite 는 이미 CTE 였으므로 CTE 로 통일했다.
//
// 그 다음에 골격과 자식을 한 문장으로 붙였다가 **다시 갈랐다.** 붙여 두면
// pi 가 조인에서 오므로 MySQL 이 ref 접근을 골라 인덱스를 (pi, ty) 까지만
// 쓰고 ct 를 ICP 로 스캔하며 거른다 — /Mobius/KETI_MUV/Mission_Data 가
// 30초 상한에 걸려 하루 4건 500 이 났다. pi 를 상수 목록으로 주면 range 가
// 되어 key_len 이 671(pi, ty, ct)이 되고 같은 요청이 126ms 다
// (배포 실측 2026-09-01).
//
// 이 파일이 지키는 것:
//   1) 재귀항의 ty 는 반드시 **등치**다 (인덱스 범위를 타려면 필수)
//   2) 왕복은 1 + ceil(부모수 / 4000) 회다 — 부모 수에 비례하면 안 된다
//   3) lim / ofst 는 배치를 가로질러 **전역**으로 동작한다
//   4) lvl 은 골격 깊이로 내려간다
//   5) 방언 차이(콜레이션 / 인덱스 강제 / 문장 타임아웃)는 어댑터가 낸다
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-cte-test.db');

// 전체 결과 집합. 어댑터는 SQL 의 limit 을 이 집합에 적용한다 — DB 가 하는
// 일을 그대로 흉내 내서, search_lookup 이 절을 제대로 만들어 내보내는지만
// 검사한다. **offset 은 더 이상 SQL 에 없다** — 배치마다 건너뛰면 틀리므로
// search_lookup 이 JS 에서 앞부분을 버린다.
const ALL = [];
for (let i = 0; i < 20; i++) {
    ALL.push({ ri: '/M/p' + Math.floor(i / 4) + '/c' + (i % 4), ty: 3, rn: 'c' + (i % 4) });
}

// 골격 질의가 돌려주는 것. sk_lvl 이 있어야 lvl 처리를 볼 수 있다.
const SKEL_ROWS = [
    { sk_ri: '/M', sk_lvl: 0 },
    { sk_ri: '/M/p0', sk_lvl: 1 },
    { sk_ri: '/M/p1', sk_lvl: 1 },
    { sk_ri: '/M/p2', sk_lvl: 2 },
    { sk_ri: '/M/p3', sk_lvl: 2 },
    { sk_ri: '/M/p4', sk_lvl: 3 }
];

// opts.skeleton  골격 질의가 돌려줄 행 (기본 SKEL_ROWS)
// opts.children  자식 질의가 돌려줄 행을 만드는 함수 (bindings, sql) -> rows
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
        // 골격만 뽑는 문장인지, 자식까지 한 문장으로 끝내는 예전 경로인지
        // 가른다. 둘 다 `with recursive skel` 로 시작하므로 무엇을 뽑는지를 봐야 한다.
        //
        // 예전에는 `from skel` 로 **끝나는지**를 봤는데, sza / szb 요청에서
        // 골격 뒤에 부모 필터(left join cnt)가 붙으면서 그 패턴이 깨졌다.
        // 그러면 골격 문장이 자식 분기로 들어가 canned 자식 행을 받고,
        // 진짜 자식 질의는 골격 행을 부모로 못 받아 죽는다.
        //
        // 단일 문장은 skel 을 조인하되 `r.*` 를 뽑는다. 골격만이 sk_ri / sk_lvl 을
        // 뽑는다 — 그 차이가 필터가 붙어도 흔들리지 않는 기준이다.
        if (/\bsk_ri,\s*sk_lvl\s+from\s+skel\b/i.test(sql)) { return cb(null, skeleton.slice()); }
        // limit / offset 을 DB 가 하듯 적용한다. offset 을 무시하면 2페이지가
        // 1페이지와 같아져서 페이징 결함을 못 잡는다.
        const lim = /limit (\d+)/i.exec(sql);
        const off = /offset (\d+)/i.exec(sql);
        let rows = opts.children ? opts.children(bindings, sql) : ALL.slice();

        // 오프셋 소진용 경계 있는 count. 안쪽 limit 이 경계다.
        if (/count\(\*\) as n/i.test(sql)) {
            const cap = lim ? parseInt(lim[1], 10) : rows.length;
            return cb(null, [{ n: Math.min(rows.length, cap) }]);
        }

        // **두 경로에 서로 다른 순서를 준다.** 실제 DB 가 그렇기 때문이다 —
        // 배치 경로는 range 접근이라 pi 오름차순이고, 예전 한 문장은 조인
        // 순서다. 여기서 같은 순서를 주면 "경로가 갈려 페이지가 어긋나는"
        // 결함을 테스트가 못 잡는다. 실제로 그 결함이 배포까지 나갔다.
        if (/with recursive skel as/i.test(sql)) { rows = rows.slice().reverse(); }

        if (off) { rows = rows.slice(parseInt(off[1], 10)); }
        if (lim) { rows = rows.slice(0, parseInt(lim[1], 10)); }
        cb(null, rows);
    };
    adapter.connect = function (conf, cb) { cb('1'); };

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

// 골격 CTE 의 마지막 select 가 시작되는 지점. 골격 문장을 재귀부/꼬리로
// 가르는 데 쓴다.
const SKEL_END = ')\nselect';

// 경로가 둘이라 문장 모양이 셋이다. 어느 것을 보는지 이름으로 밝힌다.
//
//   골격 문장    `with recursive skel ... sk_ri, sk_lvl from skel`   (배치 경로)
//   자식 문장    `... where r.pi in (:p0, ...)`                      (배치 경로)
//   단일 문장    `with recursive skel ... join skel s on r.pi = ...` (ofst / la)
//
// ofst 나 la 가 있으면 배치 경로를 쓰지 않으므로 골격/자식 문장이 아예 없다.
//
// 골격은 **무엇을 뽑는가**로 가린다. 예전에는 `from skel` 로 **끝나는지**를
// 봤는데, sza / szb 요청에서 골격 뒤에 부모 필터(left join cnt)가 붙으면서
// 그 패턴이 깨졌다 — 골격이 단일 문장으로 오분류돼 테스트 여섯이 한꺼번에
// "자식 질의가 없다" 로 죽었다.
//
// 단일 문장(build_descendant_sql)은 skel 을 조인하지만 `r.*` 를 뽑는다.
// 골격만이 sk_ri / sk_lvl 을 뽑는다. 그 차이가 안정적인 기준이다.
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

// 자식 질의 하나가 받은 부모 수. IN 목록의 자리표를 센다.
function parentCount(sql) {
    const m = /r\.pi in \(([^)]*)\)/.exec(sql);
    assert.ok(m, 'r.pi in (...) 이 없다: ' + sql);
    return m[1].split(',').length;
}

// 옛 시그니처를 그대로 쓴다 (resource.js 호출부와 같은 형태).
function run(t, query, cb, root) {
    const found = {};
    t.sql_action.search_lookup(null, root || '/M', query, query.lim, ['/M'], 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code) {
            cb(code, Object.keys(found), t.seen);
        });
}

// --- CSEBase 아래 전체는 골격을 만들지 않는다 --------------------------------
//
// 골격은 "이 subtree 로 한정한다" 를 위해 있다. 대상이 CSEBase 면 한정할 것이
// 없다 — 모든 리소스가 그 아래다. 배포 실측(2026-09-02, /Mobius, ty=3+rn):
//
//   골격 34,415개                        384ms
//   자식배치(부모 4,000, ty=3 + rn)    6,067ms -> 24행   x 9배치 = 54초
//   부모 제한 없이                     73~150ms -> 같은 24행
//
// 선택도 높은 필터가 붙으면 limit 이 조기 종료를 못 해서(맞는 것을 찾으려고
// 후보를 전부 훑는다) 배치마다 6초가 걸렸다. 모니터가 네 번 잡았다.
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

        // 필터는 그대로 걸려야 한다.
        assert.match(seen[0].sql, /ty = /, 'ty 필터가 사라졌다');
        assert.match(seen[0].sql, /rn = /, 'rn 필터가 사라졌다');
        done();
    }));
});

test('lvl 이 있으면 골격을 만든다 — 깊이를 알 방법이 그것뿐이다', function (t, done) {
    // lvl 은 골격이 sk_lvl 로 건다. 골격이 없으면 깊이를 제한할 수 없다.
    const h = tap('mysql');
    atRoot(h, { ty: '3', lvl: '2', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(/with recursive skel/i.test(seen[0].sql),
            'lvl 이 있는데 골격을 안 만들었다 — 깊이 제한이 사라진다');
        done();
    }));
});

test('CSEBase 가 아니면 예전대로 골격을 만든다', function (t, done) {
    // subtree 검색은 한정이 실제로 필요하다.
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
    // "부모가 없다"(답이 없다)와 "부모를 제한하지 않는다"(전부가 답이다)는
    // 정반대다. null 이나 빈 배열로 후자를 나타내면 기존 가드에 걸려
    // 조용히 0건이 된다.
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

// --- 1) 왕복은 부모 수에 비례하지 않는다 -------------------------------------
//
// 이 테스트는 "부모마다 던지던 시절" 로의 회귀를 막으려고 있다.
// 이제 왕복은 **1(골격) + ceil(부모수 / 4000)** 회다. 보통 요청은 2회다.

test('discovery 는 골격 1회 + 배치 수만큼만 던진다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        // 부모 6개는 배치 하나다 -> 골격 1 + 자식 1
        assert.strictEqual(seen.length, 2,
            '부모마다 던지던 시절로 돌아갔다: ' + seen.length + '회');
        assert.match(seen[0].sql, /with recursive skel as/i, '첫 질의가 골격이 아니다');
        assert.ok(!isSkel(seen[1]), '둘째 질의가 자식이 아니다');
        done();
    }));
});

// --- 2) 골격 재귀는 분기 하나로, 등치 조건으로 -------------------------------
//
// MySQL 의 재귀 CTE 안에서는 ref(등치) 접근만 되고 range 가 안 된다.
// 배포 서버 실측(2026-08-29, 전체 CSE 골격):
//   ty in (2,3,5)     인덱스는 pi 까지만, 나머지는 Filter      6,961ms
//   ty < 4 / ty > 4   인덱스를 고정해도 Filter 로 밀림       125,385ms
//   ty = 'N' 등치 20개                                        4,856ms
//   not_cin = 1 등치 1개 (지금)                          -> migrations/004
// 그래서 조건이 반드시 **등치**여야 하고, 범위나 IN 이 들어가면 안 된다.

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
    // 자식은 별도 문장이 이 목록을 pi IN (...) 으로 받는다.
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
        // SQLite 에는 INVISIBLE 컬럼이 없어 not_cin 을 만들면 select * 에 샌다.
        assert.ok(!/not_cin/.test(allSql(seen)), 'SQLite 에 not_cin 이 들어갔다');
        assert.match(skel, /where l\.ty <> 4/);
        assert.strictEqual((skel.match(/union/gi) || []).length, 1);
        done();
    }));
});

// --- 3) lim / ofst 는 전역이다 -----------------------------------------------
//
// 배포 서버 실측(2026-08-29, 컨테이너 30,278개)의 예전 동작:
//   lim=200&ofst=1000 -> 0건
//   lim=300&ofst=10   -> ofst=0 의 300건과 20건만 겹침

test('ofst 없이 전체를 받는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris) {
        assert.strictEqual(ris.length, 20, ris.length + '건');
        done();
    }));
});

test('ofst 가 있어도 배치 경로를 쓴다 — 경로가 갈리면 페이지가 어긋난다', function (t, done) {
    // **이 테스트가 막는 결함.** 한때 ofst 가 있으면 예전 한 문장으로 보냈다.
    // 그러면 같은 페이징의 1페이지(ofst 없음)와 2페이지(ofst 있음)가 서로 다른
    // 경로를 타고, 두 경로는 행 순서가 다르다 — 배치는 range 접근이라 pi
    // 오름차순이고 예전 경로는 조인 순서다. offset N 이 1페이지가 준 것과 다른
    // N 건을 건너뛴다.
    //
    // 배포 실측(2026-09-01): ty=3 자손 2,806건을 페이징으로 모으니 2,558건에
    // 중복 248건이었다. 248건이 조용히 빠졌다.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, ofst: 6 }, guard(done, function (code, ris, seen) {
        assert.ok(seen.some(isChild),
            'ofst 요청이 배치 경로를 안 썼다 — 페이지 순서가 갈린다');
        assert.ok(!seen.some(isOneShot),
            'ofst 요청이 예전 한 문장으로 갔다 — 1페이지와 순서가 어긋난다');
        // 오프셋은 DB 가 건너뛴다. JS 가 앞을 버리면 버릴 행까지 실어 온다.
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

// **이 테스트가 배포에서 터진 결함을 잡는다.**
//
// 페이지를 끝까지 넘겨 모은 결과가 전체 집합과 정확히 같아야 한다. 한 건이라도
// 겹치거나 빠지면 실패한다. 배포 실측(2026-09-01)으로 ty=3 자손 2,806건이
// 2,558건 + 중복 248건으로 나왔던 것이 바로 이 조건 위반이다.
//
// 원인은 ofst 유무로 경로가 갈린 것이었다. 경로마다 행 순서가 달라
// offset N 이 앞 페이지가 준 것과 다른 N 건을 건너뛰었다.
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
            // 한도를 못 채웠으면 마지막 페이지다.
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

// --- 4) lvl 은 골격 깊이로 내려간다 ------------------------------------------
//
// 골격 루트가 sk_lvl=0 이고 그 자식이 결과 depth 1 이다.
// lvl=N 이면 결과는 depth N 까지 -> 부모는 sk_lvl <= N-1 까지만 필요하다.
//
// 이제 상한은 두 곳에서 걸린다:
//   - 재귀 분기의 `s.sk_lvl < max_lvl` 가 골격이 더 깊이 내려가는 것을 막고
//   - 마지막 한 레벨은 search_lookup 이 부모 목록에서 JS 로 걷어낸다
// (골격 문장은 sk_lvl 을 그대로 내보내므로 바깥 where 가 없다.)
// SKEL_ROWS 는 레벨별로 1 / 2 / 2 / 1 개다.

test('lvl=1 이면 재귀 분기를 아예 만들지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '1' }, guard(done, function (code, ris, seen) {
        assert.ok(!/union/i.test(skelStmt(seen).sql), 'lvl=1 인데 재귀 분기가 있다');
        // max_lvl=0 -> 루트만 부모다
        assert.strictEqual(parentCount(childStmt(seen).sql), 1,
            'sk_lvl=0 만 남기지 않았다');
        done();
    }));
});

test('lvl=3 이면 골격을 2레벨까지만 훑는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '3' }, guard(done, function (code, ris, seen) {
        assert.ok(/s\.sk_lvl < 2/.test(skelStmt(seen).sql), '재귀 상한이 없다');
        // max_lvl=2 -> sk_lvl 0,1,1,2,2 다섯 개가 부모다 (sk_lvl=3 은 빠진다)
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

// --- 5) la 는 정렬로 최신 N건을 고른다 ---------------------------------------
//
// 예전 MySQL 경로는 2^n 분 창을 넓혀 가며 20번까지 재시도했다. 마지막 CIN 이
// 오래된 컨테이너에서는 창이 모자라 404 가 났다 (배포 서버 실측: 3.7년 된
// 컨테이너가 404 -> 수정 후 200). ct 는 초 단위라 ri 를 타이브레이커로 쓴다.

test('la 는 ct desc, ri desc 로 정렬해 N건을 뽑는다', function (t, done) {
    // presearch_action 이 la 요청에 ty=4 / lvl=1 을 박으므로 부모는 하나다.
    // 배치 경로를 타고, 배치 안의 정렬이 곧 전역 정렬이다.
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
    // 배포 실측(부모 하나, CIN 593만):
    //   pi IN (...) + force index   ref     filesort   30초 상한 초과
    //   pi IN (...) 강제 없음       range   정렬 없음  즉시
    // 강제를 도로 넣으면 la 가 다시 30초 500 이 된다.
    const h = tap('mysql');
    run(h, { la: '5' }, guard(done, function (code, ris, seen) {
        const sql = childStmt(seen).sql;
        assert.ok(!/force index/i.test(sql),
            'la 질의에 force index 가 붙었다 — 정렬이 filesort 로 밀린다: ' + sql);
        done();
    }));
});

test('la 가 아니면 인덱스를 그대로 강제한다', function (t, done) {
    // 강제가 필요한 이유는 그대로다 — 정렬 없는 질의에서 옵티마이저가
    // PRIMARY 를 골라 부모마다 CIN 을 전부 읽는 것을 막는다.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.match(childStmt(seen).sql, /force index \(idx_lookup_pi_ty_ct\)/i,
            'la 가 아닌데 인덱스 강제가 사라졌다');
        done();
    }));
});

// --- 6) 방언 차이는 어댑터가 낸다 --------------------------------------------

test('MySQL 은 콜레이션 / 인덱스 강제 / 문장 타임아웃을 붙인다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        // lookup.pi 는 utf8mb3_general_ci, lookup.ri 는 utf8mb3_bin 이다.
        // 명시하지 않으면 ER_CANT_AGGREGATE_2COLLATIONS 로 죽는다.
        assert.match(skelStmt(seen).sql, /collate utf8mb3_general_ci/);
        // PRIMARY(pi, ri, ty) 를 고르면 ty 가 범위에서 빠져 부모마다 CIN 을
        // 전부 읽는다 (배포 서버 실측: lbl 필터가 60초 초과 -> 강제 시 840ms).
        assert.match(childStmt(seen).sql, /force index \(idx_lookup_pi_ty_ct\)/);
        // 상한은 **두 문장 모두** 걸려야 한다. 하나만 걸면 나머지가 커넥션을
        // 무제한으로 붙잡는다.
        assert.match(skelStmt(seen).sql, /MAX_EXECUTION_TIME\(\d+\)/);
        assert.match(childStmt(seen).sql, /MAX_EXECUTION_TIME\(\d+\)/);
        done();
    }));
});

// 재귀항에 인덱스를 고정하지 않으면 옵티마이저가 클러스터드 PRIMARY(pi, ri, ty)
// 를 골라 pi 로만 찾고 ty 를 필터로 처리한다. 그러면 골격을 넓힐 때마다 그
// 컨테이너의 CIN 을 전부 읽는다.
//
// 배포 서버 실측(2026-08-29, 전체 CSE 골격 30,794노드):
//   고정 없음                    80,421ms (30초 상한에 걸려 HTTP 500)
//   force index 만               15,584ms
//   force index + NO_HASH_JOIN    4,856ms
//
// 어느 계획을 고르는지는 통계·캐시 상태로 뒤집힌다 — 같은 질의가 아침에는
// 751ms, 오후에는 80초였다. 고정하지 않으면 재현되지 않는 장애가 된다.

test('재귀항에도 인덱스를 고정한다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        const skel = sql.slice(0, sql.indexOf(SKEL_END));
        // 재귀항은 (pi, not_cin), 자식 질의는 (pi, ty, ct) 를 쓴다
        assert.match(skel, /from lookup l force index \(idx_lookup_pi_notcin\)/,
            '재귀항에 인덱스가 고정되지 않았다');
        assert.ok(!/from lookup l join/.test(skel), '힌트 없는 재귀 분기가 있다');
        assert.match(childStmt(seen).sql,
            /from lookup r force index \(idx_lookup_pi_ty_ct\)/,
            '자식 질의에 인덱스가 고정되지 않았다');
        done();
    }));
});

// 스키마와 질의가 어긋나면 전부 500 이 난다. 인덱스 이름과 컬럼 이름이
// 스키마 파일에 실재하는지 검사한다.
test('골격이 쓰는 인덱스와 컬럼이 스키마에 선언돼 있다', function () {
    const my = fs.readFileSync(require('../mobius/db/mysql').schemaPath, 'utf8');
    assert.match(my, /idx_lookup_pi_notcin/, 'mobiusdb.sql 에 인덱스 선언이 없다');
    assert.match(my, /`not_cin`[\s\S]{0,120}GENERATED ALWAYS AS \(`?ty`? <> 4\)/,
        'mobiusdb.sql 에 not_cin 생성 컬럼 선언이 없다');
    assert.match(my, /`not_cin`[\s\S]{0,160}INVISIBLE/,
        'not_cin 이 INVISIBLE 이 아니다 — select * 로 응답에 새어 나간다');

    // 마이그레이션도 같은 이름을 써야 한다
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
        // 힌트 두 개가 한 주석 안에 들어가야 한다
        assert.match(sql, /\/\*\+ MAX_EXECUTION_TIME\(\d+\) NO_HASH_JOIN\(l, s\) \*\//);
        // l / s 는 골격에만 있는 별칭이다. 자식 질의에 붙이면 뜻이 없다.
        assert.ok(!/NO_HASH_JOIN/.test(childStmt(seen).sql),
            '자식 질의에 골격 별칭 힌트가 붙었다');
        done();
    }));
});

test('lvl=1 이면 재귀항이 없으니 힌트도 골격에 없다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '1' }, guard(done, function (code, ris, seen) {
        assert.ok(!/force index/.test(skelStmt(seen).sql), 'lvl=1 인데 골격에 힌트가 붙었다');
        // 자식 질의에는 여전히 붙어야 한다
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
            // 어댑터가 내는 조각만 다르고 뼈대는 같아야 한다:
            //   콜레이션 / 인덱스 강제 / 옵티마이저 힌트 / "CIN 이 아니다" 표현
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

// --- 6.5) lbl 필터 ----------------------------------------------------------
//
// Mobius 는 lbl 을 '[\n    "tagX"\n]' 처럼 들여쓴 JSON 으로 저장한다.
// 예전 MySQL 경로는 lbl like '["%tagX%"]' 를 썼는데, 여는 대괄호 바로 뒤
// 개행 때문에 아무것도 못 맞췄다 (로컬 실측: 같은 트리에서 fu=1 은 1건,
// fu=1&lbl=tagX 는 0건). SQLite 가 쓰던 느슨한 패턴으로 통일한다.

test('lbl 패턴이 대괄호에 붙어 있지 않다', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: 'tagX', lim: 20 }, guard(done, function (code, ris, seen) {
        // 패턴은 이제 **바인딩 값**이다. SQL 에는 자리표만 남는다.
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

// AND 가 OR 보다 세므로 괄호가 없으면
//   and lbl~a or lbl~b and ty=3  ->  (lbl~a) or ((lbl~b) and ty=3)
// 이 되어 첫 라벨은 타입 상관없이 전부 딸려 나온다.

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

// --- 6.7) sza / szb / cty 는 cin 을 조인한다 ---------------------------------
//
// 이 셋은 contentInstance 의 속성을 본다 — cs(contentSize) / cnf(contentInfo).
// 그 둘은 lookup 이 아니라 cin 에 있다. 예전에는 별칭 없이 cs / cnf 라고 써서
// lookup 에 붙였고, 컬럼이 없으니 SQL 준비 단계에서 깨져 **항상 HTTP 500**
// 이었다 (8년 전 mobiusdb.sql 에서 두 컬럼을 뺄 때 이쪽을 안 고쳤다).

test('sza 를 주면 cin 을 조인하고 c.cs 로 비교한다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '4', sza: 10, lim: 20 }, guard(done, function (code, ris, seen) {
        const c = childStmt(seen);
        assert.match(c.sql, /join cin c on c\.pi = r\.pi and c\.ri = r\.ri/,
            'cin 조인이 없다');
        // 크기는 바인딩이고, 비교 대상은 반드시 **별칭 붙은** c.cs 여야 한다.
        // lookup 에는 cs 컬럼이 없어 별칭을 빼면 SQL 준비 단계에서 깨진다.
        assert.match(c.sql, /\? <= c\.cs/, 'cs 를 별칭 없이 쓰거나 값을 인라인했다: ' + c.sql);
        assert.ok(c.bindings.indexOf(10) >= 0,
            'sza 가 수로 바인딩되지 않았다: ' + JSON.stringify(c.bindings));
        done();
    }));
});

test('szb 도 마찬가지다 — cty 는 이제 여기 오지 않는다', function (t, done) {
    // 이 테스트에 cty 가 함께 있었다. cty 를 지원하지 않기로 하면서 뺐다 —
    // presearch_action 이 400-65 로 먼저 끊으므로 SQL 을 만드는 자리까지
    // 도달하지 않는다. 아래 'cty 는 SQL 을 만들지 않는다' 가 그것을 못박는다.
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

// cin.cs 는 MySQL 이 int, SQLite 가 TEXT 다. SQLite 에서 TEXT 컬럼과 정수를
// 그냥 비교하면 어느 쪽에도 수치 affinity 가 없어 정수가 늘 더 작다고
// 판정된다 — `10 <= cs` 가 모든 행에서 참이 되어 필터가 무력해진다.

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
    // 값이 SQL 에 안 들어가는 것으로는 부족하다. 아예 **절이 만들어지지
    // 않아야** 한다. 절이 남아 있으면 게이트를 지우는 순간 되살아난다.
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

    // 게이트가 살아 있어야 한다.
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
    // 골격의 재귀 조건은 `ty <> 4` 하나다 — "CIN 이 아닌 자식을 따라 넓힌다" 는
    // 뜻이지 "CIN 을 가진 부모만 고른다" 가 아니다. 그래서 sza / szb 요청에도
    // CIN 이 하나도 없는 컨테이너가 전부 부모 목록에 들어갔다.
    //
    // 배포 실측 (/Mobius/KETI_MUV/Mission_Data): 골격 2,900개 중 cni>0 은
    // 642개뿐이고 나머지 2,258개(78%)가 헛부모다. 자식 질의가 59ms -> 13ms 다.
    // 비용이 스캔 행 수가 아니라 부모(range) 개수에 선형이라 그렇다.
    const h = tap('mysql');
    run(h, { sza: 100, lim: 20 }, guard(done, function (code, ris, seen) {
        const sk = skelStmt(seen).sql;
        assert.match(sk, /left join cnt\b/i,
            '골격이 부모를 안 거른다 — CIN 없는 부모까지 자식 질의로 간다');
        assert.match(sk, /n\.cni > 0/,
            'cni 로 거르지 않는다');

        // **inner join 이면 안 된다.** cnt 에 행이 없는데 CIN 을 가진
        // 컨테이너가 실재한다 — 배포에서 한 컨테이너가 cnt 0행 / cin 475건이다.
        // inner 면 그 부모가 조용히 사라져 답이 줄어든다. 모르면 남긴다.
        assert.match(sk, /n\.ri is null or/i,
            'cnt 에 행이 없는 부모를 버린다 — CIN 을 가진 컨테이너가 사라진다');
        assert.ok(!/(?<!left )join cnt\b/i.test(sk),
            'inner join 이다 — cnt 행이 없는 부모가 조용히 사라진다');
        done();
    }));
});

// ── 백필이 끝나면 조인이 사라진다 ────────────────────────────────────────
//
// lookup 에 cs 사본을 두었고(011 + 백필), 012 가 "안 채워진 CIN 이 하나도
// 없다" 를 확인하면 db_bootstrap 이 global.lookup_has_cin_attrs 를 세운다.
// 그때부터 discovery 는 cin 을 조인하지 않는다 — 배포 실측 3배 차이다.
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

            // ty=4 는 남아야 한다. 조인이 없어진 뒤에는 이 절이 **유일하게**
            // 후보를 CIN 으로 좁힌다.
            assert.match(c, /r\.ty = '4'/,
                "조인이 사라지면서 ty=4 도 같이 사라졌다 — 후보가 안 좁혀진다");
            done();
        }));
    });
});

test('백필이 끝나도 부모 필터는 남는다', function (t, done) {
    // 부모를 거르는 이득은 조인 여부와 무관하다 — 비용이 부모 개수에
    // 선형이라 그렇다. needs_cin_join 으로 판단하면 여기서 조용히 꺼진다.
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
    // "cs 는 CIN 에만 있으니 다른 타입만 찾으면 답이 없다" 는 사실은
    // 그 값을 어느 테이블에서 읽든 같다. needs_cin_join 으로 물으면
    // 백필 뒤 이 관문이 조용히 꺼진다.
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
    // 켜져 있으면 아직 안 채워진 행이 결과에서 조용히 사라진다.
    // 에러도 안 나고 답만 줄어든다. 그래서 기본이 예전 경로여야 한다.
    const sql = require(path.join(ROOT, 'mobius', 'sql_action.js'));
    const saved = global.lookup_has_cin_attrs;
    try {
        delete global.lookup_has_cin_attrs;
        assert.strictEqual(sql._lookup_has_cin_attrs(), false,
            '전역이 없는데 참이다 — 백필 전에 켜지면 답이 조용히 줄어든다');

        // truthy 로는 안 켜진다. === true 여야 한다.
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
    // 일반 discovery 의 골격은 그대로여야 한다. 부모를 거르는 것은
    // CIN 속성을 보는 요청에서만 의미가 있고, 다른 요청에서는 cnt 조인이
    // 순수한 추가 비용이다.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(!/join cnt\b/i.test(skelStmt(seen).sql),
            '크기 필터가 없는데 골격이 cnt 를 조인한다');
        done();
    }));
});

test('부모 필터의 콜레이션은 어댑터가 정한다', function () {
    // sk_ri 는 pathCollate 로 캐스트돼 있고 cnt.ri 는 원래 콜레이션이다.
    // 그대로 조인하면 콜레이션이 섞여 죽는다. 되돌리는 조각은 방언이라
    // 코어가 문자열로 적으면 안 된다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    const code = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    assert.match(code, /facade\.riCollate\(\)/,
        '부모 필터가 riCollate 를 안 쓴다');
    assert.ok(!/collate utf8mb3/i.test(code),
        '코어가 콜레이션 이름을 직접 적는다 — 어댑터가 줘야 한다');

    // SQLite 는 붙일 조각이 없다. 붙으면 구문 오류다.
    // MySQL 은 반대로 반드시 있어야 한다 — 없으면 콜레이션이 섞여 죽는다.
    assert.strictEqual(require(path.join(DB, 'sqlite.js')).riCollate(), '',
        'SQLite 에 콜레이션 조각이 붙는다 — 구문 오류가 난다');
    assert.match(require(path.join(DB, 'mysql.js')).riCollate(), /collate/i,
        'MySQL 에 콜레이션 조각이 없다 — cnt 와 조인할 때 죽는다');
});

test('needs_cin_join 이 둘을 정확히 가린다', function () {
    const h = tap('mysql');
    const f = h.sql_action.needs_cin_join;
    assert.strictEqual(f({ sza: 1 }), true);
    assert.strictEqual(f({ szb: 1 }), true);
    assert.strictEqual(f({ sza: 0 }), true, '0 도 값이다');
    assert.strictEqual(f({ ty: '3', lbl: 'x' }), false);
    assert.strictEqual(f({}), false);

    // cty 는 셋째였다. 지원하지 않기로 해서 뺐다 — 여기서 참을 주면
    // presearch_action 이 이미 끊은 요청에 대해 조인을 준비하는 셈이다.
    assert.strictEqual(f({ cty: 'x' }), false,
        'cty 가 다시 조인을 부른다 — 지원하지 않기로 한 필터다');
});

// cs / cnf 는 contentInstance 에만 있으므로 결과는 반드시 ty=4 다.
// 명시하지 않으면 옵티마이저가 골격의 모든 자식을 후보로 놓고 cin(249GB)을
// 하나씩 찾아본다 — 배포 서버에서 fu=1&ty=3&sza=10 이 30초 상한에 걸렸다.

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

// 답이 있을 수 없는 조합이면 DB 를 아예 안 건드린다.

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

// --- 7) 주입 방어 -----------------------------------------------------------

test('루트 ri 는 바인딩으로 넘어간다', function (t, done) {
    const h = tap('mysql');
    const evil = "/M' or 1=1 --";
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        // 루트는 골격 질의의 유일한 바인딩이다.
        assert.strictEqual(skelStmt(seen).bindings[0], evil, '루트 ri 가 첫 바인딩이 아니다');
        assert.strictEqual(allSql(seen).indexOf(evil), -1, 'ri 가 SQL 에 박혔다');
        done();
    }), evil);
});

test('lim / ofst 는 정수로만 들어간다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: '20; drop table lookup', ofst: '5 union select' },
        guard(done, function (code, ris, seen) {
            // union 은 골격 CTE 에 정상적으로 있다. 자식 질의만 본다.
            assert.ok(!/drop table|union select/i.test(childStmt(seen).sql),
                '문자열이 그대로 들어갔다: ' + childStmt(seen).sql);
            assert.match(childStmt(seen).sql, /limit 20$/,
                'lim 이 정수로 잘리지 않았다: ' + childStmt(seen).sql);
            done();
        }));
});

// --- 7.5) 필터 값에 물음표가 있어도 죽지 않는다 ------------------------------
//
// 필터 값은 전부 **이름 바인딩**(:qN)으로 나간다. 위치 바인딩(?)을 쓰면
// knex 가 값 안의 물음표까지 자리표로 세어 "Expected N bindings, saw N+1" 로
// 죽는다. 물음표는 리소스 이름·라벨에 얼마든지 들어갈 수 있는 평범한 글자다.
// 이름 바인딩은 :name 만 찾으므로 리터럴 물음표를 건드리지 않는다.
//
// knex 가 최종적으로 내보내는 것은 위치 자리표 ? 와 값 배열이다.
// 값이 SQL 에 남아 있지 않은지까지 본다.

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
        // knex 가 :root_ri / :pN / :qN 을 위치 자리표로 바꿔 내보낸다
        const sql = allSql(seen);
        assert.ok(sql.indexOf(':root_ri') === -1, ':root_ri 가 치환되지 않았다');
        assert.ok(!/:q\d/.test(sql), '필터 이름 바인딩이 치환되지 않았다: ' + sql);
        assert.ok(!/:p\d/.test(sql), '부모 이름 바인딩이 치환되지 않았다: ' + sql);
        // 골격은 루트 하나, 자식은 부모들 + ty 다.
        assert.deepStrictEqual(skelStmt(seen).bindings, ['/M']);
        assert.deepStrictEqual(childStmt(seen).bindings,
            SKEL_ROWS.map((r) => r.sk_ri).concat(['3']));
        done();
    }));
});

// --- 7.6) DB 오류를 로그에서 알아볼 수 있어야 한다 ---------------------------
//
// 파사드 규약은 실패 시 cb(true, errObj) 다 — 에러 객체는 **둘째** 인자다.
// 첫 인자를 에러로 착각하면 err 는 boolean true 라서 로그에
// '[search_lookup] true' 한 줄만 남고 원인을 알 수 없게 된다.

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
            // 상한에 걸린 것은 DB 고장이 아니라 "이 범위를 감당 못 한다" 다.
            // 500-1("database error")로 뭉개면 호출자가 무엇을 고쳐야 할지 모른다.
            assert.strictEqual(code, '500-6');
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

// --- 8) 골격 컬럼은 필터 조각과 이름이 겹치지 않는다 -------------------------
//
// build_search_query 는 컬럼을 alias 없이 부른다 (lbl, ty, ct ...).
// 골격이 ri / ty 같은 이름을 내보내면 바깥 where 가 모호해진다.

test('골격 컬럼 이름은 sk_ 접두사를 쓴다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lbl: 'status', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.match(skelStmt(seen).sql, /select ri.* as sk_ri, 0 as sk_lvl/);
        assert.ok(/lbl like/.test(childStmt(seen).sql), 'lbl 필터가 빠졌다');
        // 자식 질의는 골격을 조인하지 않는다 — 부모를 값으로 받는다.
        assert.ok(!/join skel/.test(childStmt(seen).sql),
            '자식 질의가 아직 골격을 조인한다 — 그러면 ct 가 키 범위에서 빠진다');
        done();
    }));
});

// --- 11) 골격 컬럼은 비교용 콜레이션으로 만들어진다 --------------------------
//
// 조인할 때만 콜레이션을 붙이면 골격 안에 대소문자만 다른 경로가 그대로 남는다
// (lookup.ri 는 utf8mb3_bin 이라 UNION 이 서로 다른 행으로 본다). 그러면 같은
// 자식이 중복으로 나오고 호출부가 found_Obj[ri] 로 합치면서 응답이 lim 보다
// 적어진다. 배포 서버 실측(2026-08-29): 골격 30,855행 중 61행이 중복이었고
// ty=3 lim=2000 이 1,960건만 돌려줬다. 골격 컬럼을 ci 로 선언하면 2,000건이다.

test('MySQL 은 골격 컬럼에 콜레이션을 붙이고 조인 조건에는 안 붙인다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = skelStmt(seen).sql;
        assert.match(sql, /select ri collate utf8mb3_general_ci as sk_ri/,
            '앵커의 골격 컬럼에 콜레이션이 없다');
        assert.match(sql, /select l\.ri collate utf8mb3_general_ci, s\.sk_lvl/,
            '재귀항의 골격 컬럼에 콜레이션이 없다');
        assert.ok(!/s\.sk_ri collate/.test(sql),
            '조인 조건에 콜레이션이 남아 있다 - 그러면 UNION 이 중복을 못 지운다');
        done();
    }));
});

// --- lbl 검색에 ty 가 없으면 CIN 을 뺀다 ------------------------------------
//
// lbl 은 JSON 배열 문자열이라 like '%..%' 로 찾는다. 선행 와일드카드라 어떤
// 인덱스도 못 탄다. 타입을 안 고르면 후보가 골격 아래 모든 자식이 되고 그
// 대부분이 CIN 이다(배포 1억4,560만 행).
//
// 배포 실측:
//   ?fu=1&lbl=status         30초 상한 -> 500 (0건)
//   ?fu=1&ty=3&lbl=status    774ms            (96건)
//   CIN 을 뺀 같은 질의       1,020ms          (96건)   <- 기존 (pi, not_cin) 인덱스

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
    // CIN 의 레이블은 실제로 쓰인다(배포의 /Mobius/Arthall/DAQ_1/IR-UWB 가
    // ["signal","only"]). "없다" 와 "안 찾아봤다" 를 구별할 수 있어야 한다.
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

// --- 9) discovery 필터 값은 SQL 에 들어가지 않는다 ---------------------------
//
// 예전에는 util.format 으로 값을 SQL 문자열에 이어 붙였고, 그래서
// sanitize_discovery_query 가 값마다 손으로 이스케이프해야 했다
// (한국전자기술연구원 취약점 보고, Mobius <=2.5.15).
//
// 이스케이프는 **하나만 빠져도 뚫리고** 방언마다 규칙이 다르다. 이제 값이
// 전부 이름 바인딩으로 나가므로 그 문제 자체가 없다. 이 테스트가 그것을
// 못박는다 — 필터를 하나 더 만들 때 값을 문자열로 붙이면 여기서 걸린다.

// cty 가 여기 있었다. 지원하지 않기로 해서 뺐다 — presearch_action 이
// 400-65 로 먼저 끊으므로 SQL 을 만드는 자리까지 도달하지 않는다.
// 그 대신 '지원하지 않는 필터는 SQL 을 만들지 않는다' 가 아래에 있다.
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

            // 값은 바인딩에 **그대로** 있어야 한다. 이스케이프가 남아 있으면
            // 이중 적용이라 찾는 문자열이 달라진다 (it's -> it''s).
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
    // 이스케이프를 남겨 두면 바인딩에 이중으로 걸려 `it's` 를 찾는 요청이
    // `it''s` 를 찾게 된다.
    delete require.cache[require.resolve('../mobius/sql_action')];
    const sql_action = require('../mobius/sql_action');

    const q = { lbl: "it's", rn: 'a\\b', cty: 'x\ny' };
    sql_action.sanitize_discovery_query(q);

    assert.strictEqual(q.lbl, "it's", 'lbl 이 변형됐다: ' + q.lbl);
    assert.strictEqual(q.rn, 'a\\b', 'rn 이 변형됐다: ' + q.rn);
    assert.strictEqual(q.cty, 'x\ny', 'cty 가 변형됐다: ' + JSON.stringify(q.cty));
});

test('sanitize 는 숫자 파라미터를 여전히 거른다', function () {
    // 이쪽은 바인딩이 아니거나(limit/offset/sk_lvl 리터럴) 분기 판단에 쓰인다.
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

// --- 10) ty 목록 분해 ---------------------------------------------------------
//
// ty 는 배열(ty=3&ty=4)로도 콤마 문자열(ty=3,4)로도 온다.
//
// 예전 코드는 query.ty.toString().split(',').length 로 분기해 놓고
// query.ty[i] 로 돌았다. 문자열이면 그게 **글자 인덱스**라
//   ty = '3' or ty = ',' or ty = '4'
// 가 나왔다. 쉼표 절은 int 컬럼에서 0 으로 변환돼 아무것도 안 맞았으므로
// 결과는 우연히 맞았지만, 쓸모없는 절이 하나 붙어 있었다.
//
// 지금은 split(',') 결과로 돈다. **결과는 같고 절만 없어진다.**
// 이 테스트가 그 상태를 못박는다.

test('ty 가 콤마 문자열이어도 값만 분해한다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3,4', lim: 10 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        const b = childStmt(seen).bindings;
        // 부모들 + ty 두 개. 쉼표가 값으로 들어가면 안 된다.
        assert.ok(b.indexOf('3') >= 0, "ty '3' 이 바인딩에 없다: " + JSON.stringify(b));
        assert.ok(b.indexOf('4') >= 0, "ty '4' 가 바인딩에 없다: " + JSON.stringify(b));
        assert.strictEqual(b.indexOf(','), -1,
            '쉼표가 ty 값으로 들어갔다 — 글자 단위로 돌고 있다: ' + JSON.stringify(b));

        // ty 절은 정확히 두 개여야 한다.
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
    // 등치 하나여야 인덱스가 (pi, ty) 범위를 탄다. 괄호가 붙어도 계획은
    // 같지만, 하나일 때 OR 그룹을 만들지 않는 것이 예전 동작이다.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 10 }, guard(done, function (code, ris, seen) {
        const child = childStmt(seen).sql;
        assert.match(child, /and ty = \?/, child);
        assert.ok(!/\(ty = \? or/.test(child), '하나인데 OR 그룹을 만들었다: ' + child);
        done();
    }));
});

// --- 11) 스칼라가 아닌 필터 값은 버린다 --------------------------------------
//
// 배포 직전 검토가 잡은 회귀. 이스케이프를 없애면서 옛 esc_sql_str 이
// **겸하고 있던 String(v) 강제**까지 같이 사라졌다.
//
// express 는 query parser 기본값이 'extended'(qs)라 ?cra[x]=1 이 객체
// { x: '1' } 가 된다. 그 객체를 바인딩하면 node-mysql 의 SqlString 이
// objectToValues 로 펼쳐 백틱 식별자를 SQL 에 써 넣는다:
//
//   ?rn[x]=1   ->  and rn = `x` = '1'      ER_BAD_FIELD_ERROR -> 500
//   ?cra[x]=1  ->  and `x` = '1' <= ct     문법은 맞고 0 <= ct 가 참이라
//                                          **필터가 통째로 무력화**된다
//
// 두 번째가 더 나쁘다 — 에러 없이 전건이 나간다.

test('객체형 필터 값은 버린다 (필터 무력화 방지)', function (t, done) {
    const h = tap('mysql');
    // cra 가 객체면 그 필터를 버려야 한다. 남으면 SQL 에 식별자가 박힌다.
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

// --- 12) 부모는 배치로 나눠 IN 목록으로 넘긴다 --------------------------------
//
// 왜 IN 이어야 하는가: 조인으로 주면 MySQL 이 ref 접근을 골라 인덱스를
// (pi, ty) 까지만 쓰고 ct 를 ICP 로 스캔하며 거른다. 상수 목록이면 range 가
// 되어 key_len 이 671(pi, ty, ct)이 된다 — 배포 실측 30초 타임아웃 -> 126ms.
//
// 왜 나눠야 하는가: range_optimizer_max_mem_size 가 8MB 라, IN 목록이 그
// 예산을 넘으면 MySQL 이 range 를 **포기하고** 전체 인덱스 스캔으로 떨어진다.
// 경고도 에러도 없다.
//   부모 2,000 / 5,000 / 8,000  -> range (추정 행 2,015 / 5,015 / 8,015)
//   부모 10,000                 -> index 전체 스캔 (추정 행 61,947,616)
// 전환점은 경로 문자열 길이에 따라 움직이므로 여유 2배를 두고 4,000 이다.

// 부모를 n 개 가진 골격을 만든다.
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
        // 경로가 SQL 문자열에 들어가면 안 된다 — 경로에 물음표가 들어간
        // 실제 500 사례가 있다.
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
    // 4,001개면 자식 질의가 2회다 (4,000 + 1).
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
    // 이 상한을 올리면 어느 날 경로가 길어졌다는 이유만으로 range 가
    // 전체 인덱스 스캔으로 떨어진다 (위 표 참고). 그래서 못박는다.
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

// ofst / la 는 골격이 아무리 커도 배치로 가지 않는다. 배치 경로가 그 둘을
// 감당하려면 (ofst + lim) 만큼을 배치마다 실어 와야 하는데, ofst 는 서버가
// X-M2M-CTO 로 광고하는 값이라 정상 페이징이 그대로 그 경로를 밟는다.

test('오프셋은 경계 있는 count 로 소진한다 — 경계 없는 count 는 금지', function (t, done) {
    // 경계 없는 `select count(*)` 는 후보를 전부 훑는다. 배포 실측:
    // ty=4(후보 2,282만)에서 경계 없음 25초 상한 초과 / 경계 있음 0.05초.
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
    // 배치마다 4건씩 준다. ofst=6 이면 첫 배치(4건)는 통째로 건너뛰고,
    // 둘째 배치에서 2건을 건너뛴 뒤 받는다.
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
    // 예전 한 문장 경로는 골격을 조인하므로 pi 가 상수가 아니고, 그러면
    // 인덱스 강제를 빼도 정렬이 filesort 로 밀린다(배포 실측).
    // pi 를 IN 목록의 상수로 줘야 옵티마이저가 인덱스 역방향 range 를 쓴다.
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
    // build_descendant_sql 은 남아 있지만 **호출부가 0개**다. 배치 경로가
    // 무엇을 대체했는지 보여주려고 두는 참고 코드다.
    //
    // 실수로 다시 배선하면 두 가지가 돌아온다.
    //   la    골격을 조인하므로 pi 가 상수가 아니고, 그러면 filesort 다.
    //         배포의 590만 건 컨테이너에서 30초 상한을 넘겼다(2026-09-01).
    //   ofst  1페이지와 2페이지가 다른 경로를 타면 행 순서가 달라
    //         offset 이 어긋난다. 배포에서 2,806건 중 248건이 사라졌다.
    //
    // 이 함수가 안 불린다는 사실이 주석에서 여러 번 갈렸다 — 두 자리가
    // "ofst 나 la 가 있으면 이쪽을 쓴다" 라고 **거짓을** 말하고 있었고,
    // 그 때문에 조사가 한 번 헛짚었다. 그래서 사실 쪽을 테스트로 못박는다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
    // 주석은 뺀다 — 왜 안 쓰는지 설명하느라 이름을 여러 번 인용한다.
    const lines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));

    // 정의와 export 는 있어야 한다(참고 코드로 두는 것이 목적이다).
    assert.ok(lines.some((l) => /function build_descendant_sql\s*\(/.test(l)),
        'build_descendant_sql 이 사라졌다 — 배치 경로가 무엇을 대체했는지 알 수 없게 된다');

    // **호출 형태**를 센다. 이름 개수를 세면 안 된다 —
    // `exports.build_descendant_sql = build_descendant_sql;` 한 줄에 두 번 나온다.
    const calls = lines.filter((l) =>
        /build_descendant_sql\s*\(/.test(l) && !/function\s+build_descendant_sql/.test(l));

    assert.deepStrictEqual(calls.map((l) => l.trim()), [],
        'build_descendant_sql 이 다시 배선됐다.\n' +
        'la 는 filesort 로, ofst 는 페이징 어긋남으로 돌아간다.');
});

test('부모가 0개면 자식 질의를 던지지 않는다', function (t, done) {
    // 없는 ri 를 주면 골격이 비고, 더 칠 이유가 없다.
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
        if (n === 2) {   // 첫 배치에서 깨진다
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

// --- 탐색 범위 초과는 4xx 다 -------------------------------------------------
//
// 서버가 고장난 것이 아니라 요청의 범위가 감당 밖이다. 같은 요청을 다시
// 보내면 반드시 또 실패하므로, "재시도하면 될 수도 있다" 를 뜻하는 5xx 는
// 호출자를 오해시킨다 — 30초를 태우고 같은 응답을 받는 일이 반복된다.

test('탐색 범위 초과(500-6)는 BAD_REQUEST 로 나간다', function () {
    const reason = require(path.join(ROOT, 'mobius', 'reason.js'));
    const rsc = require(path.join(ROOT, 'mobius', 'rsc.js'));

    const r = reason.of ? reason.of('500-6') : null;
    // reason 모듈의 조회 함수 이름이 무엇이든, 카탈로그에서 직접 찾는다.
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'reason.js'), 'utf8');
    const at = src.indexOf("'500-6':");
    assert.ok(at > 0, '500-6 이 카탈로그에 없다');
    const entry = src.slice(at, at + 300);

    assert.match(entry, /code:\s*RSC\.BAD_REQUEST/,
        '500-6 이 BAD_REQUEST 가 아니다 — 재시도해도 안 되는 요청에 5xx 를 주면 안 된다');
    assert.ok(!/code:\s*RSC\.INTERNAL_SERVER_ERROR/.test(entry),
        '500-6 이 INTERNAL_SERVER_ERROR 로 되돌아갔다');

    // 무엇을 고쳐야 하는지가 메시지에 있어야 한다.
    assert.match(entry, /narrow the target/i, '무엇을 좁히라는 안내가 없다');
    assert.match(entry, /ty filter/i, 'ty 필터 안내가 없다');
    assert.match(entry, /cra|crb/i, '시간 범위 안내가 없다');

    assert.strictEqual(rsc.RSC.BAD_REQUEST.http, 400, 'BAD_REQUEST 가 400 이 아니다');
});
