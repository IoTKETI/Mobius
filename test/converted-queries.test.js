'use strict';
// Task 3/4 에서 전환한 5개 함수(get_ri_sri, select_cb, select_sum_cbs,
// select_sum_ae, update_cb_poa_csi)가 실제로 파사드를 거쳐 드라이버에 올바른
// SQL/bindings 를 넘기는지 확인한다.
//
// delete_lookup_et 는 최종 리뷰(Critical)에서 전환을 되돌렸다 — 상한 없는
// SELECT 를 미전환 delete_lookup 이 그대로 지워 SQLite 배포에서 휴면 중이던
// 파괴적 경로를 깨웠기 때문이다(자세한 이유는 계획 문서 "이번 범위에서
// 제외한 것" 절 참조). 되돌린 뒤에는 legacy db_action.js(MySQL 전용 pool)를
// 직접 호출하므로 이 파일의 파사드 어댑터 tap(tapAdapter)으로는 관측할 수
// 없다 — 그래서 delete_lookup_et 테스트는 제거했다.
//
// 왜 필요한가: tools/equivalence 하네스의 시나리오는 남은 5개 함수 중 4개를
// 전혀 밟지 않는다 (select_sum_* 는 /total_ae, /total_cbs 라우트 전용,
// select_cb 는 mn/asn CSE 타입 전용, get_ri_sri 는 acpiList 가 있을 때만
// 진입). "동등성 28/28 일치"는 이 함수들의 정확성을 증명하지 못한다 —
// 증명하려면 sql_action.js 의 export 를 직접 호출해 드라이버에 도달하는
// SQL/bindings 를 캡처해야 한다. sqli-regression.test.js 의 freshDb/tapAdapter
// 패턴을 그대로 복사해 쓴다(모듈 간 공유는 이번 범위 밖).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-converted-queries-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usedb = useSqlite ? 'sqlite' : 'mysql';
    return require(DB);
}

// sqli-regression.test.js 의 tapAdapter 와 동일한 구조이되, execute 스텁이
// SELECT 문에는 배열을, 그 외(UPDATE 등)에는 {affectedRows, insertId} 를
// 돌려준다 — 실제 드라이버의 isRowReturning 분기와 같은 모양을 흉내낸다.
function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapterPath = path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js');
    const adapter = require(adapterPath);
    const calls = [];

    adapter.execute = function (handle, sql, bindings, callback) {
        calls.push({ sql: sql, bindings: bindings });
        if (/^\s*select\b/i.test(sql)) {
            callback(null, []);
        } else {
            callback(null, { affectedRows: 1, insertId: 0 });
        }
    };

    db.connect('h', 1, 'u', 'p', function () {});

    const SA = path.join(__dirname, '..', 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    const sql_action = require(SA);

    return { sql_action: sql_action, calls: calls };
}

test('get_ri_sri 가 lookup 에서 ri 를 sri 로 조회하고 값은 bindings 로 나간다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.get_ri_sri(null, 'S1', function (err, results) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'select `ri` from `lookup` where `sri` = ?');
        assert.ok(calls[0].sql.indexOf('S1') < 0, '값이 SQL 본문에 박혔다: ' + calls[0].sql);
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('S1') >= 0, '값이 bindings 에 없다');
        assert.ok(Array.isArray(results), 'SELECT 는 배열을 돌려줘야 한다');
        done();
    });
});

// SQLite 모드에서도 (MySQL 로 새지 않고) sqlite 어댑터가 실제로 호출을 받는지
// 확인한다. tapAdapter(true) 는 mobius/db/sqlite.js 의 execute 만 스텁하므로,
// calls 가 채워진다는 것 자체가 SQLite 라우팅의 증거다.
test('get_ri_sri 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.get_ri_sri(null, 'S1', function (err, results) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'select `ri` from `lookup` where `sri` = ?');
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('S1') >= 0, '값이 bindings 에 없다');
        assert.ok(Array.isArray(results), 'SELECT 는 배열을 돌려줘야 한다');
        done();
    });
});

test('select_cb 가 cb 를 ri 로 조회하고 값은 bindings 로 나간다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.select_cb(null, '/M/cb', function (err, results_cb) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'select * from `cb` where `ri` = ?');
        assert.ok(calls[0].sql.indexOf('/M/cb') < 0, '값이 SQL 본문에 박혔다: ' + calls[0].sql);
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('/M/cb') >= 0, '값이 bindings 에 없다');
        assert.ok(Array.isArray(results_cb), 'SELECT 는 배열을 돌려줘야 한다');
        done();
    });
});

test('select_cb 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.select_cb(null, '/M/cb', function (err, results_cb) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'select * from `cb` where `ri` = ?');
        assert.ok(JSON.stringify(calls[0].bindings).indexOf('/M/cb') >= 0, '값이 bindings 에 없다');
        assert.ok(Array.isArray(results_cb), 'SELECT 는 배열을 돌려줘야 한다');
        done();
    });
});

test('select_sum_cbs 는 집계 컬럼 이름을 보존한 SQL 을 그대로 실행한다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.select_sum_cbs(null, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'select sum(cbs) from cnt');
        assert.deepStrictEqual(calls[0].bindings, [], '바인딩할 값이 없어야 한다');
        done();
    });
});

test('select_sum_cbs 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.select_sum_cbs(null, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'select sum(cbs) from cnt');
        assert.deepStrictEqual(calls[0].bindings, [], '바인딩할 값이 없어야 한다');
        done();
    });
});

test('select_sum_ae 는 집계 컬럼 이름을 보존한 SQL 을 그대로 실행한다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.select_sum_ae(null, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'select count(*) from ae');
        assert.deepStrictEqual(calls[0].bindings, [], '바인딩할 값이 없어야 한다');
        done();
    });
});

test('select_sum_ae 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.select_sum_ae(null, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'select count(*) from ae');
        assert.deepStrictEqual(calls[0].bindings, [], '바인딩할 값이 없어야 한다');
        done();
    });
});

test('update_cb_poa_csi 가 cb 를 poa/csi/srt 로 갱신하고 4개 값 모두 bindings 로 나간다', function (t, done) {
    const { sql_action, calls } = tapAdapter(false);
    sql_action.update_cb_poa_csi(null, 'P', 'C', 'S', '/M/cb', function (err, results) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, '정확히 1회 실행되어야 한다');
        assert.strictEqual(calls[0].sql, 'update `cb` set `poa` = ?, `csi` = ?, `srt` = ? where `ri` = ?');
        ['P', 'C', 'S', '/M/cb'].forEach(function (v) {
            assert.ok(calls[0].sql.indexOf(v) < 0, '값 "' + v + '" 이 SQL 본문에 박혔다: ' + calls[0].sql);
        });
        assert.deepStrictEqual(calls[0].bindings, ['P', 'C', 'S', '/M/cb']);
        done();
    });
});

test('update_cb_poa_csi 가 SQLite 모드에서 sqlite 어댑터로 라우팅된다', function (t, done) {
    const { sql_action, calls } = tapAdapter(true);
    sql_action.update_cb_poa_csi(null, 'P', 'C', 'S', '/M/cb', function (err, results) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        assert.strictEqual(calls.length, 1, 'sqlite 어댑터가 정확히 1회 호출되어야 한다');
        assert.strictEqual(calls[0].sql, 'update `cb` set `poa` = ?, `csi` = ?, `srt` = ? where `ri` = ?');
        assert.deepStrictEqual(calls[0].bindings, ['P', 'C', 'S', '/M/cb']);
        done();
    });
});
