'use strict';
// 요청 주소 해석 — 구조 주소는 ri(PK) 한 번으로 찾는다 (ri/sri 설계 메모 §3 A2).
//
// 옛 코드는 모든 요청에 `ri = ? OR sri = ?` 를 던졌다. 배포 EXPLAIN 은 index_merge
// union — 인덱스 둘(ri_UNIQUE · idx_lookup_sri 15.8GB)을 요청마다 찌른다. 그런데
// 접근 로그 이틀 390,877건 중 구조 주소가 390,872건이다. 첫 조각이 CSE base 이름이면
// sri 로 볼 것이 없으므로 ri 만 묻는다. 비구조 주소(`/~/<cseid>/<id>` · `/<id>`)는
// 지금처럼 둘 다 본다 — 동작이 같다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.MOBIUS_SQLITE_PATH = path.join(os.tmpdir(), 'mobius-address-resolve-test.db');
global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//ketiabc.com';
global.usedb = 'sqlite';

const db = require('../mobius/db');
const adapter = require('../mobius/db/sqlite.js');
const db_sql = require('../mobius/sql_action');

// 어댑터를 가로채 만들어진 SQL 만 본다 (test/migrate.test.js 의 tapCtx 와 같은 방식)
const seen = [];
adapter.execute = function (conn, sql, bindings, cb) {
    seen.push({ sql: sql, bindings: bindings });
    if (/^select/i.test(sql)) { return cb(null, []); }
    cb(null, { affectedRows: 0 });
};
db.connect(function () {});

function resolve(ri, sri) {
    seen.length = 0;
    return new Promise((res) => db_sql.select_resource_from_url({}, ri, sri, () => res(seen[0])));
}

test('구조 주소(sri 없음) — ri 만 묻는다', async () => {
    const q = await resolve('/Mobius/ae/cnt', null);
    assert.match(q.sql, /where `ri` = \?/, q.sql);
    assert.doesNotMatch(q.sql, /sri/, 'sri 를 헛묻는다: ' + q.sql);
    assert.deepStrictEqual(q.bindings, ['/Mobius/ae/cnt']);
});

test('비구조 주소 — 지금처럼 ri 와 sri 둘 다 본다', async () => {
    const q = await resolve('/4-20260906031641123', '4-20260906031641123');
    // knex 는 orWhere 의 객체 조건을 괄호로 감싼다
    assert.match(q.sql, /where `ri` = \? or \(?`sri` = \?\)?/, q.sql);
    assert.deepStrictEqual(q.bindings, ['/4-20260906031641123', '4-20260906031641123']);
});

test('sri 만 있으면 sri 만 묻는다', async () => {
    const q = await resolve(null, 'SkzbCasUs6s');
    assert.match(q.sql, /where `sri` = \?/, q.sql);
    assert.doesNotMatch(q.sql, /`ri`/, q.sql);
});

test('get_target_url 은 첫 조각이 CSE base 이름이면 sri 를 넘기지 않는다', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const at = app.indexOf('function get_target_url(');
    assert.ok(at > 0);
    const body = app.slice(at, at + 4000);
    assert.match(body, /request\.sri = \(head === usecsebase\) \? null : head;/, '구조 주소에서 sri 를 비우지 않는다');
    assert.doesNotMatch(body, /request\.sri = absolute_url_arr\[1\]\.split\('\?'\)\[0\];/, '옛 대입이 남아 있다');
});
