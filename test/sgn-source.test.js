'use strict';
/**
 * 알림 라우팅의 원천은 sub 테이블이다.
 * 스펙: docs/superpowers/specs/2026-09-05-notification-routing-source-design.md
 *
 * 예전에는 부모 lookup 행의 subl(구독 사본 JSON)을 읽었다. 사본을 지키는 장치가
 * 통째로 있었고 그래도 어긋났다(유령 9,475건). 이제 sgn.check 가 쓰기마다 자기
 * 커넥션으로 `sub where pi = 구독이 붙은 리소스.ri` 를 한 번 읽는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// converted-queries 의 tapAdapter 와 같은 방식으로 실제 나가는 SQL 을 본다.
function tapSql() {
    const DB = path.join(ROOT, 'mobius', 'db');
    process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-sgn-source-test.db');
    ['', 'mysql.js', 'sqlite.js'].forEach((f) => { delete require.cache[require.resolve(path.join(DB, f))]; });
    global.usedb = 'mysql';
    const db = require(DB);
    const adapter = require(path.join(DB, 'mysql.js'));
    const calls = [];
    calls.rows = [];
    adapter.execute = function (h, sql, bindings, cb) { calls.push({ sql, bindings }); cb(null, calls.rows.length ? calls.rows.shift() : []); };
    db.connect(function () {});
    const SA = path.join(ROOT, 'mobius', 'sql_action.js');
    delete require.cache[require.resolve(SA)];
    return { sql_action: require(SA), calls };
}
function quiet(fn) {
    const e = console.error, lines = [];
    console.error = (m) => lines.push(String(m));
    return Promise.resolve().then(fn).then((v) => { console.error = e; return { v, lines }; }, (x) => { console.error = e; throw x; });
}

// ── SQL 모양 ──────────────────────────────────────────────────────────────

test('select_subs_by_pi — sub 에서 발송 6필드를 부모 ri 로, ri 오름차순', (t, done) => {
    const { sql_action, calls } = tapSql();
    sql_action.select_subs_by_pi(null, '/Mobius/ae1/c1', (err, rows) => {
        assert.ok(!err);
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].sql, 'select `ri`, `nu`, `enc`, `nct`, `nec`, `cr` from `sub` where `pi` = ? order by `ri` asc');
        assert.deepStrictEqual(calls[0].bindings, ['/Mobius/ae1/c1']);
        assert.ok(Array.isArray(rows));
        done();
    });
});

test('select_resources_in — lookup 한 번(ri in … or sri in …) 뒤 타입별 테이블 한 번씩, merge', (t, done) => {
    const { sql_action, calls } = tapSql();
    calls.rows = [
        // ty 29(timeSeries)는 지원을 걷어낸 타입이라 typeRsrc 에 없다 — '99' 는 rsp 로 있어 미지원이 아니다
        [{ ri: '/M/ae1', sri: 'Cae1', ty: '2' }, { ri: '/M/ae2', sri: 'Cae2', ty: '2' }, { ri: '/M/x', sri: 'X', ty: '29' }],
        [{ ri: '/M/ae1', poa: '["http://a"]' }, { ri: '/M/ae2', poa: '["http://b"]' }]
    ];
    quiet(() => new Promise((resolve) => {
        sql_action.select_resources_in(null, ['/M/ae1', '/M/ae2', '/M/x'], ['Cae1', 'Cae2', 'X'], (err, rows) => resolve({ err, rows }));
    })).then(({ v, lines }) => {
        assert.ok(!v.err);
        assert.strictEqual(calls.length, 2, 'lookup 1 + ae 1');
        assert.strictEqual(calls[0].sql, 'select * from `lookup` where (`ri` in (?, ?, ?) or `sri` in (?, ?, ?))');
        assert.deepStrictEqual(calls[0].bindings, ['/M/ae1', '/M/ae2', '/M/x', 'Cae1', 'Cae2', 'X']);
        assert.strictEqual(calls[1].sql, 'select * from `ae` where `ri` in (?, ?)');
        assert.deepStrictEqual(v.rows.map((r) => [r.ri, r.poa]), [['/M/ae1', '["http://a"]'], ['/M/ae2', '["http://b"]'], ['/M/x', undefined]]);
        assert.ok(lines.some((l) => /지원하지 않는 타입/.test(l)), '미지원 타입은 단건과 같이 로그를 남긴다');
        done();
    }).catch(done);
});

test('select_resources_in — 빈 목록이면 질의 없이 빈 배열', (t, done) => {
    const { sql_action, calls } = tapSql();
    sql_action.select_resources_in(null, [], [], (err, rows) => {
        assert.ok(!err); assert.strictEqual(calls.length, 0); assert.deepStrictEqual(rows, []); done();
    });
});

// ── 어느 행으로 발송하나 (sub_source) ─────────────────────────────────────

const db_sql = require('../mobius/sql_action');
const sub_source = require('../mobius/sub_source');
function rowsFor(parentObj, notiObj, cv) { return new Promise((r) => sub_source.rows_for({}, parentObj, notiObj, cv, r)); }

test('rows_for — 생성(3)·갱신(1)·자식 삭제(4)는 구독이 붙은 리소스의 ri 로 sub 를 읽는다', async () => {
    const calls = [];
    db_sql.select_subs_by_pi = (c, pi, cb) => { calls.push(pi); setImmediate(() => cb(null, [{ ri: '/M/p/s1', nu: '["mqtt://x"]', enc: '{"net":[3]}', nct: 2, nec: null, cr: 'C' }])); };
    for (const cv of [3, 1, 4]) {
        const rows = await rowsFor({ ri: '/M/p' }, { ri: '/M/p/child' }, cv);
        assert.deepStrictEqual(rows.map((r) => r.ri), ['/M/p/s1']);
    }
    assert.deepStrictEqual(calls, ['/M/p', '/M/p', '/M/p']);
});

test('rows_for — 구독 삭제(128)는 지워진 구독 자신이다 (FK 로 행이 이미 없다)', async () => {
    db_sql.select_subs_by_pi = () => { throw new Error('128 은 질의하지 않는다'); };
    const gone = { ri: '/M/p/s2', nu: ['http://h'], enc: { net: [3] }, nct: 2, cr: 'C', su: 'http://h' };
    assert.deepStrictEqual(await rowsFor({ ri: '/M/p' }, gone, 128), [gone]);
});

test('rows_for — DB 오류면 로그 한 줄과 빈 목록 (알림은 fire-and-forget)', async () => {
    db_sql.select_subs_by_pi = (c, pi, cb) => setImmediate(() => cb(new Error('boom'), { message: 'boom', code: 'ER_X' }));
    // 콜백이 영영 안 오면 시험이 매달리기만 하고 실패로 안 잡힌다 — 상한을 건다.
    // 오류 갈래에서 callback 을 빠뜨리면 release 도 안 되어 커넥션이 새는 부류다.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('rows_for 가 DB 오류 뒤 콜백을 부르지 않았다')), 2000).unref());
    const { v, lines } = await quiet(() => Promise.race([rowsFor({ ri: '/M/p' }, { ri: '/M/p/c' }, 3), timeout]));
    assert.deepStrictEqual(v, []);
    assert.ok(lines.some((l) => /\[sgn\] 구독 조회 실패.*\/M\/p/.test(l)), lines.join('\n'));
});

// ── sgn.js 소스 규칙 ───────────────────────────────────────────────────────

test('sgn.js 는 subl 사본을 읽지 않고, 언제나 자기 커넥션으로 sub_source 를 묻는다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.strictEqual(src.indexOf('parentObj.subl'), -1, 'subl 사본을 다시 읽는다');
    assert.strictEqual(src.indexOf('needs_connection'), -1, '"DB 가 필요할 때만" 판정이 되살아났다 — 이제 언제나 필요하다');
    assert.strictEqual(src.indexOf('request.db_connection'), -1, '요청 커넥션을 쓴다 — 응답·반납 뒤에도 질의가 돈다');
    assert.match(src, /sub_source\.rows_for\(connection, parentObj, notiObj, check_value, function \(rows\)/);
    assert.match(src, /db\.getConnection\(/);
    assert.match(src, /released\s*=\s*true/);
});
