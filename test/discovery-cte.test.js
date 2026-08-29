'use strict';
// discovery 는 MySQL / SQLite 모두 재귀 CTE **한 문장**으로 처리한다.
//
// 예전에는 MySQL 만 2단계였다: 레벨별로 부모를 모으고(search_parents_lookup),
// 부모마다 'select * from lookup where pi = ?' 를 던졌다. 그 방식은
//   - 레벨당 2,000개 상한이 있어 큰 트리에서 결과가 조용히 잘렸고
//   - ofst 가 부모마다 적용돼 전역 오프셋이 아니었으며
//   - 부모 수만큼 왕복이 생겼다 (배포 서버 실측 4,080회 -> 묶어서 25회)
// SQLite 는 이미 CTE 였으므로 CTE 로 통일했다.
//
// 이 파일이 지키는 것:
//   1) 재귀항의 ty 는 반드시 **등치**다 (인덱스 범위를 타려면 필수)
//   2) lim / ofst 는 SQL 에 한 번만, 전역으로 붙는다
//   3) lvl 은 골격 깊이로 내려간다
//   4) 방언 차이(콜레이션 / 인덱스 강제 / 문장 타임아웃)는 어댑터가 낸다
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH =
    path.join(require('node:os').tmpdir(), 'mobius-cte-test.db');

// 전체 결과 집합. 어댑터는 SQL 의 limit/offset 을 이 집합에 적용한다 —
// DB 가 하는 일을 그대로 흉내 내서, search_lookup 이 절을 제대로
// 만들어 내보내는지만 검사한다.
const ALL = [];
for (let i = 0; i < 20; i++) {
    ALL.push({ ri: '/M/p' + Math.floor(i / 4) + '/c' + (i % 4), ty: 3, rn: 'c' + (i % 4) });
}

function tap(backend) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = (backend === 'sqlite') ? 'true' : 'false';
    const db = require(DB);
    const adapter = require(path.join(DB, backend === 'sqlite' ? 'sqlite.js' : 'mysql.js'));

    const seen = [];
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        const lim = /limit (\d+)/i.exec(sql);
        const ofs = /offset (\d+)/i.exec(sql);
        let rows = ALL.slice();
        if (ofs) { rows = rows.slice(parseInt(ofs[1], 10)); }
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

// 옛 시그니처를 그대로 쓴다 (resource.js 호출부와 같은 형태).
function run(t, query, cb, root) {
    const found = {};
    t.sql_action.search_lookup(null, root || '/M', query, query.lim, ['/M'], 0, found, 0,
        '0', '2026-01-02 00:00:00', 0, function (code) {
            cb(code, Object.keys(found), t.seen);
        });
}

// --- 1) 왕복이 한 번인가 -----------------------------------------------------

test('discovery 는 질의를 한 번만 던진다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.strictEqual(code, '200');
        assert.strictEqual(seen.length, 1,
            '부모마다 던지던 시절로 돌아갔다: ' + seen.length + '회');
        assert.match(seen[0].sql, /with recursive skel as/i);
        done();
    }));
});

// --- 2) 재귀항의 ty 는 등치여야 한다 -----------------------------------------
//
// 배포 서버 실측(2026-08-29, lookup 6,620만행 / CIN 99.95%):
//   ty in (2,3,5) -> 인덱스가 pi 까지만 잡히고 나머지는 필터   6,961ms
//   ty < 4        -> 마찬가지                               77,387ms
//   ty = 3 (등치) -> (pi, ty) 범위                              434ms

test('재귀항은 타입마다 등치 분기를 만든다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = seen[0].sql;
        const NL = h.sql_action.NONLEAF_TY;
        assert.ok(NL.length > 0);
        NL.forEach(function (ty) {
            assert.ok(sql.indexOf("l.ty = '" + ty + "'") !== -1,
                'ty=' + ty + ' 분기가 없다');
        });
        // 골격 부분에 범위/집합 조건이 끼면 인덱스를 못 탄다.
        const skel = sql.slice(0, sql.indexOf(')\nselect'));
        assert.ok(!/l\.ty\s+in\s*\(/i.test(skel), '재귀항에 ty IN (...) 이 있다');
        assert.ok(!/l\.ty\s*[<>]/.test(skel), '재귀항에 ty 범위 조건이 있다');
        done();
    }));
});

test('비-리프 타입 목록이 resource.js 의 ty_list - leaf_ty_list 와 같다', function () {
    const h = tap('mysql');
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'resource.js'), 'utf8');
    const all = /global\.ty_list\s*=\s*\[([^\]]*)\]/.exec(src);
    const leaf = /var leaf_ty_list\s*=\s*\[([^\]]*)\]/.exec(src);
    assert.ok(all && leaf, 'resource.js 에서 타입 목록을 못 찾았다');
    const parse = (m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
    const expected = parse(all).filter((t) => parse(leaf).indexOf(t) < 0);
    assert.deepStrictEqual(h.sql_action.NONLEAF_TY, expected,
        'resource.js 의 타입 목록과 어긋난다 — 한쪽만 고쳤다');
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

test('ofst 는 SQL 에 한 번만, 전역으로 붙는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, ofst: 6 }, guard(done, function (code, ris, seen) {
        assert.strictEqual((seen[0].sql.match(/offset/gi) || []).length, 1);
        assert.strictEqual(ris.length, 14, 'ofst=6 이면 14건: ' + ris.length);
        assert.deepStrictEqual(ris, ALL.slice(6).map((r) => r.ri));
        done();
    }));
});

test('부모가 가진 자식보다 큰 ofst 도 정상 동작한다', function (t, done) {
    // 부모당 자식은 4개뿐이다. 예전 구현에서 ofst=10 은 전부 0건을 만들었다.
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, ofst: 10 }, guard(done, function (code, ris) {
        assert.strictEqual(ris.length, 10, 'ofst=10 이면 10건 (예전엔 0건): ' + ris.length);
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
            assert.strictEqual(p1.filter((x) => p2.indexOf(x) !== -1).length, 0, '두 페이지가 겹친다');
            done();
        }));
    }));
});

test('ofst 가 0 이면 offset 절을 붙이지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, ofst: 0 }, guard(done, function (code, ris, seen) {
        assert.ok(!/offset/i.test(seen[0].sql), 'ofst=0 에 offset 절이 붙었다');
        done();
    }));
});

// --- 4) lvl 은 골격 깊이로 내려간다 ------------------------------------------
//
// 골격 루트가 sk_lvl=0 이고 그 자식이 결과 depth 1 이다.
// lvl=N 이면 결과는 depth N 까지 -> 부모는 sk_lvl <= N-1 까지만 필요하다.

test('lvl=1 이면 재귀 분기를 아예 만들지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '1' }, guard(done, function (code, ris, seen) {
        assert.ok(!/union/i.test(seen[0].sql), 'lvl=1 인데 재귀 분기가 있다');
        assert.ok(/s\.sk_lvl <= 0/.test(seen[0].sql), 'sk_lvl <= 0 이 없다');
        done();
    }));
});

test('lvl=3 이면 골격을 2레벨까지만 훑는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '3' }, guard(done, function (code, ris, seen) {
        assert.ok(/s\.sk_lvl < 2/.test(seen[0].sql), '재귀 상한이 없다');
        assert.ok(/s\.sk_lvl <= 2/.test(seen[0].sql), '결과 깊이 상한이 없다');
        done();
    }));
});

test('lvl 이 없으면 깊이 상한을 걸지 않는다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.ok(!/sk_lvl <=/.test(seen[0].sql), 'lvl 없이 깊이 상한이 붙었다');
        assert.ok(!/sk_lvl </.test(seen[0].sql), 'lvl 없이 재귀 상한이 붙었다');
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
    const h = tap('mysql');
    run(h, { la: '5' }, guard(done, function (code, ris, seen) {
        assert.match(seen[0].sql, /order by r\.ct desc, r\.ri desc/i);
        assert.match(seen[0].sql, /limit 5/i);
        assert.ok(!/[0-9]+ minutes|between/i.test(seen[0].sql), '시간 창 재시도가 남아 있다');
        assert.strictEqual(seen.length, 1, 'la 가 여러 번 질의한다: ' + seen.length);
        done();
    }));
});

// --- 6) 방언 차이는 어댑터가 낸다 --------------------------------------------

test('MySQL 은 콜레이션 / 인덱스 강제 / 문장 타임아웃을 붙인다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = seen[0].sql;
        // lookup.pi 는 utf8mb3_general_ci, lookup.ri 는 utf8mb3_bin 이다.
        // 명시하지 않으면 ER_CANT_AGGREGATE_2COLLATIONS 로 죽는다.
        assert.match(sql, /collate utf8mb3_general_ci/);
        // PRIMARY(pi, ri, ty) 를 고르면 ty 가 범위에서 빠져 부모마다 CIN 을
        // 전부 읽는다 (배포 서버 실측: lbl 필터가 60초 초과 -> 강제 시 840ms).
        assert.match(sql, /force index \(idx_lookup_pi_ty_ct\)/);
        assert.match(sql, /MAX_EXECUTION_TIME\(\d+\)/);
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
        const sql = seen[0].sql;
        const skel = sql.slice(0, sql.indexOf(')\nselect'));
        const NL = h.sql_action.NONLEAF_TY;
        const hinted = (skel.match(/from lookup l force index \(idx_lookup_pi_ty_ct\)/g) || []).length;
        assert.strictEqual(hinted, NL.length,
            '재귀 분기 ' + NL.length + '개 중 ' + hinted + '개만 인덱스가 고정됐다');
        // 힌트가 join 앞에 와야 문법이 성립한다
        assert.ok(!/from lookup l join/.test(skel), '힌트 없는 재귀 분기가 있다');
        done();
    }));
});

test('해시 조인 금지 힌트를 붙인다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.match(seen[0].sql, /NO_HASH_JOIN\(l, s\)/,
            '해시 조인 금지 힌트가 없다 — 희소 타입 분기에서 반복마다 해시를 새로 만든다');
        // 힌트 두 개가 한 주석 안에 들어가야 한다
        assert.match(seen[0].sql, /\/\*\+ MAX_EXECUTION_TIME\(\d+\) NO_HASH_JOIN\(l, s\) \*\//);
        done();
    }));
});

test('lvl=1 이면 재귀항이 없으니 힌트도 골격에 없다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: 20, lvl: '1' }, guard(done, function (code, ris, seen) {
        const sql = seen[0].sql;
        const skel = sql.slice(0, sql.indexOf(')\nselect'));
        assert.ok(!/force index/.test(skel), 'lvl=1 인데 골격에 힌트가 붙었다');
        // 바깥 질의에는 여전히 붙어야 한다
        assert.match(sql.slice(sql.indexOf(')\nselect')), /force index \(idx_lookup_pi_ty_ct\)/);
        done();
    }));
});

test('SQLite 는 MySQL 전용 문법을 붙이지 않는다', function (t, done) {
    const h = tap('sqlite');
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = seen[0].sql;
        assert.ok(!/collate/i.test(sql), 'SQLite 에 콜레이션이 붙었다: ' + sql);
        assert.ok(!/force index/i.test(sql), 'SQLite 에 force index 가 붙었다');
        assert.ok(!/MAX_EXECUTION_TIME/i.test(sql), 'SQLite 에 MySQL 힌트가 붙었다');
        assert.match(sql, /with recursive skel as/i, 'CTE 모양은 같아야 한다');
        done();
    }));
});

test('두 백엔드가 같은 CTE 골격을 만든다', function (t, done) {
    const m = tap('mysql');
    run(m, { ty: '3', lim: 20 }, guard(done, function (c1, r1, s1) {
        const q = tap('sqlite');
        run(q, { ty: '3', lim: 20 }, guard(done, function (c2, r2, s2) {
            const strip = (s) => s
                .replace(/ collate utf8mb3_general_ci/g, '')
                .replace(/ force index \([^)]*\)/g, '')
                .replace(/\/\*\+ [^*]*\*\/ /g, '');
            assert.strictEqual(strip(s1[0].sql), strip(s2[0].sql),
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
        assert.ok(!/lbl like '\[/.test(seen[0].sql),
            'lbl 패턴이 대괄호로 시작한다 - 들여쓴 JSON 을 못 맞춘다: ' + seen[0].sql);
        assert.match(seen[0].sql, /lbl like '%"%tagX%"%'/);
        done();
    }));
});

// AND 가 OR 보다 세므로 괄호가 없으면
//   and lbl~a or lbl~b and ty=3  ->  (lbl~a) or ((lbl~b) and ty=3)
// 이 되어 첫 라벨은 타입 상관없이 전부 딸려 나온다.

test('라벨이 여러 개면 OR 그룹을 괄호로 묶는다', function (t, done) {
    const h = tap('mysql');
    run(h, { lbl: ['a', 'b'], ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = seen[0].sql;
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
        assert.match(seen[0].sql, /and\s+lbl like '%"%a%"%'/);
        done();
    }));
});

// --- 7) 주입 방어 -----------------------------------------------------------

test('루트 ri 는 바인딩으로 넘어간다', function (t, done) {
    const h = tap('mysql');
    const evil = "/M' or 1=1 --";
    run(h, { ty: '3', lim: 20 }, guard(done, function (code, ris, seen) {
        assert.deepStrictEqual(seen[0].bindings, [evil], '루트 ri 가 바인딩이 아니다');
        assert.ok(seen[0].sql.indexOf(evil) === -1, 'ri 가 SQL 에 박혔다');
        done();
    }), evil);
});

test('lim / ofst 는 정수로만 들어간다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lim: '20; drop table lookup', ofst: '5 union select' },
        guard(done, function (code, ris, seen) {
            assert.ok(!/drop table|union select/i.test(seen[0].sql),
                '문자열이 그대로 들어갔다: ' + seen[0].sql);
            done();
        }));
});

// --- 8) 골격 컬럼은 필터 조각과 이름이 겹치지 않는다 -------------------------
//
// build_search_query 는 컬럼을 alias 없이 부른다 (lbl, ty, ct ...).
// 골격이 ri / ty 같은 이름을 내보내면 바깥 where 가 모호해진다.

test('골격 컬럼 이름은 sk_ 접두사를 쓴다', function (t, done) {
    const h = tap('mysql');
    run(h, { ty: '3', lbl: 'status', lim: 20 }, guard(done, function (code, ris, seen) {
        const sql = seen[0].sql;
        assert.match(sql, /select ri.* as sk_ri, 0 as sk_lvl/);
        assert.ok(/lbl like/.test(sql), 'lbl 필터가 빠졌다');
        // 골격이 내보내는 이름은 sk_ri / sk_lvl 둘뿐이어야 한다.
        assert.ok(!/skel s on r\.pi = s\.ri\b/.test(sql), '골격이 ri 를 그대로 내보낸다');
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
        const sql = seen[0].sql;
        assert.match(sql, /select ri collate utf8mb3_general_ci as sk_ri/,
            '앵커의 골격 컬럼에 콜레이션이 없다');
        assert.match(sql, /select l\.ri collate utf8mb3_general_ci, s\.sk_lvl/,
            '재귀항의 골격 컬럼에 콜레이션이 없다');
        assert.ok(!/s\.sk_ri collate/.test(sql),
            '조인 조건에 콜레이션이 남아 있다 - 그러면 UNION 이 중복을 못 지운다');
        done();
    }));
});
