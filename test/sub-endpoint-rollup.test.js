'use strict';
// 구독을 nu 의 엔드포인트로 묶어 센다. 배포는 구독 3,463건에 고유 nu 202개, 상위
// 3개가 57% 다 — 목록을 그대로 화면에 올리면 못 읽는다(백로그 §3-1). 전역 스캔이
// 아니라 ri 키셋 배치 + 상한이고, 판정(broken/suspect)은 코어의 audit 결과를
// 라우트가 severityOf 로 넘겨 준다 — 콘솔이 자기 기준을 만들지 않는다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-sub-rollup-test.db');
global.NOPRINT = 'true';
global.usecsebase = 'Mobius'; global.usecseid = '/Mobius2'; global.usespid = '//keti.re.kr';

// 심어 둔 SELECT 결과를 순서대로 돌려주는 어댑터 대역. sql 과 bindings 를 기록한다.
function tap(pages) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const seen = [];
    let i = 0;
    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        const rows = (pages && pages[i] !== undefined) ? pages[i] : [];
        i++;
        cb(null, rows);
    };
    db.connect(function () {});
    return { sa: require(path.join(__dirname, '..', 'mobius', 'sql_action.js')), seen: seen };
}

const sub = (ri, nus) => ({ ri: ri, pi: '/Mobius/ae', nu: JSON.stringify(nus), enc: '{}', cr: 'Cae' });

test('엔드포인트로 묶고 건수 순으로 낸다 — 판정은 severityOf 가 준다', function (t, done) {
    const { sa, seen } = tap([[
        sub('/Mobius/ae/s1', ['mqtt://broker.example/A?ct=json']),
        sub('/Mobius/ae/s2', ['mqtt://broker.example/B?ct=json']),
        sub('/Mobius/ae/s3', ['http://10.0.0.5:8080/noti']),
        sub('/Mobius/ae/s4', ['/Mobius/ae/other']),               // ID 형
        sub('/Mobius/ae/s5', ['mqtt://broker.example/C', 'http://10.0.0.5:8080/noti'])  // nu 둘
    ]]);
    const sev = { '/Mobius/ae/s2': 'suspect', '/Mobius/ae/s3': 'broken' };
    sa.select_sub_endpoint_rollup(null, { severityOf: (ri) => sev[ri] || null }, function (err, r) {
        assert.ifError(err);
        assert.deepStrictEqual(r.endpoints.map((e) => e.endpoint),
            ['mqtt://broker.example', 'http://10.0.0.5:8080', '(ID 형)']);
        const m = r.endpoints[0];
        assert.strictEqual(m.total, 3);
        assert.strictEqual(m.suspect, 1);
        assert.strictEqual(m.broken, 0);
        assert.deepStrictEqual(m.sample, ['/Mobius/ae/s1', '/Mobius/ae/s2', '/Mobius/ae/s5']);
        assert.strictEqual(r.endpoints[1].broken, 1);
        assert.strictEqual(r.scanned, 5);
        assert.strictEqual(r.capped, false);
        assert.strictEqual(r.next, null);
        // 키셋 배치: ri 로 정렬하고 상한 안에서만 읽는다. 전역 count 가 아니다.
        assert.match(seen[0].sql, /from `sub`/);
        assert.match(seen[0].sql, /order by `ri` asc/);
        assert.match(seen[0].sql, /limit/);
        assert.ok(!/count\(\*\)/i.test(seen[0].sql));
        done();
    });
});

test('상한에 닿으면 capped 와 next 를 준다 — 조용히 자르지 않는다', function (t, done) {
    const page = [];
    for (let i = 0; i < 500; i++) { page.push(sub('/M/s' + String(i).padStart(4, '0'), ['http://h/n'])); }
    const { sa } = tap([page, page.map((r) => ({ ...r, ri: r.ri + 'b' }))]);
    sa.select_sub_endpoint_rollup(null, { scanCap: 600 }, function (err, r) {
        assert.ifError(err);
        assert.strictEqual(r.capped, true);
        assert.strictEqual(r.scanned, 1000);
        assert.strictEqual(typeof r.next, 'string');
        done();
    });
});

test('select_subs_by_endpoint 는 그 엔드포인트의 구독만 돌려준다', function (t, done) {
    const { sa } = tap([[
        sub('/M/s1', ['mqtt://broker.example/A']),
        sub('/M/s2', ['http://h/n']),
        sub('/M/s3', ['mqtt://broker.example/B'])
    ]]);
    sa.select_subs_by_endpoint(null, { endpoint: 'mqtt://broker.example', limit: 10 }, function (err, r) {
        assert.ifError(err);
        assert.deepStrictEqual(r.rows.map((x) => x.ri), ['/M/s1', '/M/s3']);
        assert.deepStrictEqual(r.rows[0].nu, ['mqtt://broker.example/A']);
        assert.strictEqual(r.more, false);
        done();
    });
});

test('select_lookup_only_cin_page 는 cin 에 짝이 없는 lookup ty=4 행만 돌려준다', function (t, done) {
    // 1쪽: lookup 의 ty=4 행 3개, 2쪽: cin 에 있는 ri (whereIn 로 확인)
    const { sa, seen } = tap([
        [{ ri: '/M/c/4-1', pi: '/M/c', rn: '4-1', ct: '20260901T000000' },
         { ri: '/M/c/4-2', pi: '/M/c', rn: '4-2', ct: '20260901T000000' },
         { ri: '/M/c/4-3', pi: '/M/c', rn: '4-3', ct: '20260901T000000' }],
        [{ ri: '/M/c/4-2' }]
    ]);
    sa.select_lookup_only_cin_page(null, { limit: 10, scanCap: 100 }, function (err, r) {
        assert.ifError(err);
        assert.deepStrictEqual(r.rows.map((x) => x.ri), ['/M/c/4-1', '/M/c/4-3']);
        assert.strictEqual(r.scanned, 3);
        assert.strictEqual(r.more, false);
        assert.match(seen[0].sql, /`ty` = \?/);
        assert.match(seen[1].sql, /from `cin`/);
        assert.match(seen[1].sql, /in \(/);
        done();
    });
});

test('빈 테이블에서는 빈 결과를 준다', function (t, done) {
    const { sa: sa1 } = tap([[]]);
    sa1.select_sub_endpoint_rollup(null, {}, function (err, r) {
        assert.ifError(err);
        assert.deepStrictEqual(r, { endpoints: [], endpointsTruncated: false, scanned: 0, capped: false, next: null });

        const { sa: sa2 } = tap([[]]);
        sa2.select_subs_by_endpoint(null, { endpoint: 'http://h' }, function (err2, r2) {
            assert.ifError(err2);
            assert.deepStrictEqual(r2, { rows: [], more: false, scanned: 0, capped: false });

            const { sa: sa3 } = tap([[]]);
            sa3.select_lookup_only_cin_page(null, {}, function (err3, r3) {
                assert.ifError(err3);
                assert.deepStrictEqual(r3, { rows: [], more: false, nextRi: null, scanned: 0, scanCapped: false });
                done();
            });
        });
    });
});

test('JSON 이 아닌 nu 는 그 행을 건너뛰되 scanned 에는 센다', function (t, done) {
    const bad = { ri: '/M/bad', pi: '/Mobius/ae', nu: 'not json', enc: '{}', cr: 'Cae' };
    const { sa } = tap([[
        bad,
        sub('/M/good', ['http://h/n'])
    ]]);
    sa.select_sub_endpoint_rollup(null, {}, function (err, r) {
        assert.ifError(err);
        assert.strictEqual(r.scanned, 2);
        assert.deepStrictEqual(r.endpoints.map((e) => e.endpoint), ['http://h']);
        assert.strictEqual(r.endpoints[0].total, 1);
        done();
    });
});
