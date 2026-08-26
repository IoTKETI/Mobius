# DB 레이어 추상화 3차 — 부모 갱신 계열 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모 리소스 카운터를 갱신하는 4개 함수를 파사드로 옮겨, SQLite 모드에서 **조용히 유실되던 갱신**을 없애고 두 백엔드 모두에서 원자성을 확보한다.

**Architecture:** 이 함수들은 MySQL 전용 **다중 테이블 UPDATE**(`update cnt, lookup set ...`)를 쓴다. SQLite 는 이 문법이 없다. 게다가 `db_action.getResult` 는 `usesqlite` 와 무관하게 **항상 MySQL 풀**로 보내므로, SQLite 모드에서는 이 UPDATE 가 MySQL 의 0개 행에 적용되고 **에러 없이 성공 처리**된다. 한 문장을 두 문장(`cnt` UPDATE + `lookup` UPDATE)으로 쪼개 파사드로 보내고, `db.transaction()` 으로 감싼다.

**Tech Stack:** Node.js (CommonJS, 콜백), Knex 3.3.0(빌더 전용), node:test, sqlite3 5.1.7, mysql

**Spec:** `docs/superpowers/specs/2026-08-26-db-layer-abstraction-design.md`
(부속: `2026-08-26-db-layer-abstraction-decisions.md`, `2026-08-27-db-layer-part2-decisions.md`, 선행 정비 `docs/superpowers/plans/2026-08-27-db-layer-part3-prep.md`)

## Global Constraints

- **기준**: 브랜치 `worktree-db-layer-prep3` (선행 정비 `406db12` 위). 워크트리 `.claude/worktrees/db-layer-prep3`.
- **`global.usesqlite` 는 `mobius/db/index.js` 에서만 읽는다.** 이 계획은 새 분기를 추가하지 않고, 기존 분기를 **줄인다**.
- **콜백 규약**: 성공 `cb(null, result)`, 실패 `cb(true, err)` — 첫 인자는 리터럴 `true`.
- **SELECT 는 맨 배열**, 쓰기는 `{affectedRows, insertId}`.
- **값은 전부 바인딩으로** 넘긴다. `util.format` 으로 SQL 에 값을 끼워 넣지 않는다.
- **주석은 한국어**, 기존 스타일(`var`, 함수 선언, 4-space 들여쓰기)을 따른다.
- **금지**: `taskkill /IM node.exe`. 메인 체크아웃에서 브랜치 전환. `tools/equivalence/out/`, `tools/golden/out/` 기준선 덮어쓰기.
- **테스트**: `npm test` (= `node --test test/*.test.js`). 현재 기준선 **49 pass / 0 fail**.

---

## 배경: 실측으로 확인한 버그

SQLite 모드로 서버를 띄우고 AE → CNT → CIN 2개를 만든 뒤 CIN 하나를 지웠다.

| 관측 | 값 |
|------|-----|
| SQLite `cin` 실제 행 수 | 2 → **1** (삭제됨) |
| SQLite `cnt.cni` | 2 → **2** (안 줄어듦) |
| SQLite `cnt.cbs` | 8 → **8** (안 줄어듦) |
| SQLite `lookup.st` | 2 → **2** (안 늘어남) |
| MySQL `cnt` 의 해당 행 | **없음** (`ri like '%p3cnt%'` → `[]`) |

즉 `update cnt, lookup set ...` 이 MySQL 로 나가 **0개 행에 적용**되고, `affectedRows: 0` 은 에러가 아니므로 호출부는 성공으로 받았다. 삽입 경로만 멀쩡한 이유는 `update_parent_by_insert` 가 `usesqlite && ty=='3'` 일 때만 `update_cnt_cni` 로 우회하기 때문이다.

**영향**: SQLite 모드에서 CIN 삭제 시 컨테이너의 `cni`/`cbs` 가 영구히 부풀어 오른다. `mni`/`mbs` 상한 판정이 이 값을 쓰므로, 결국 실제로는 비어 있는 컨테이너가 "가득 참" 으로 취급된다.

### 관련 결함 3가지

1. **`update_parent_by_delete` 가 두 번 정의된다** — `sql_action.js:3427` 과 `:3459`. 두 정의는 **바이트 단위로 동일**하며 뒤가 앞을 덮는다 (`diff` 로 확인함).
2. **`update_cnt_cni` 의 SQLite 분기는 의미가 다르다.** MySQL 은 호출자가 넘긴 `obj.cni`/`obj.cbs` 를 쓰는데, SQLite 분기는 `select count(*), sum(cs) from cin where pi = ?` 로 **다시 계산**한다. 전환하면서 어느 쪽으로 통일할지 정해야 한다.
3. **`update_acp` / `update_sub` 는 두 문장이 원자적이지 않다.** 2차에서 파사드로 옮겼지만 `update_lookup` → 본문 UPDATE 가 각각 독립 실행된다.

---

## 설계 결정

### D1. 다중 테이블 UPDATE → 두 문장 + `db.transaction()`

MySQL 의 한 문장은 원자적이다. 두 문장으로 쪼개면 원자성을 잃으므로 **반드시** `db.transaction()` 으로 감싼다. MySQL 은 `capabilities.transaction === true` 라 실제 BEGIN/COMMIT 이 돌고, SQLite 는 `false` 라 트랜잭션 없이 본문만 돈다.

SQLite 에서 원자성이 없는 것은 **회귀가 아니다** — 기존 `update_cnt_cni` 의 SQLite 분기도 이미 3개 문장을 비원자적으로 실행하고 있었다. 이번 변경의 이득은 원자성이 아니라 **갱신이 실제로 SQLite 에 도달하는 것**이다.

### D2. `update_cnt_cni` 는 **호출자가 넘긴 값**으로 통일한다

SQLite 분기의 재계산(`select count(*) from cin`)을 버리고 MySQL 쪽 의미(`obj.cni`, `obj.cbs`)를 정본으로 삼는다.

이유: (a) 재계산은 CIN 이 많은 컨테이너에서 매 삽입마다 풀스캔을 돈다. (b) 두 백엔드가 다른 값을 쓰면 등가성을 검증할 수 없다. (c) `update_parent_by_insert` 가 `obj.cni` 를 이미 `mni` 상한으로 조정해 넘기는데, 재계산은 그 조정을 무시한다.

**대가**: 재계산이 가려 주던 드리프트(카운터가 실제와 어긋난 상태)가 더 이상 자동 교정되지 않는다. 다만 그 드리프트의 주원인이 바로 이 버그였으므로, 원인을 없애는 쪽이 맞다.

### D3. `delete_lookup_et` 는 **이번 범위에서 제외**한다

선행 정비 계획은 3차에 포함할 것으로 적었으나, 별도 회차로 분리한다.

`delete_lookup_et` 는 파괴적 스윕이다. 현재 SQLite 모드에서는 SELECT 가 MySQL 을 보므로 아무것도 못 찾아 **휴면 상태**다. 파사드로 옮기는 순간 SQLite 의 실제 만료 행을 찾아 지우기 시작한다 — 2차에서 이것 때문에 전환을 되돌렸다. 상한(LIMIT) 부재와 `else` 누락까지 겹쳐 있어, 부모 갱신 전환과 같은 커밋에 묶으면 문제가 생겼을 때 원인을 가릴 수 없다.

이번 회차는 **비파괴적 갱신만** 다룬다.

---

## File Structure

| 파일 | 상태 | 책임 |
|------|------|------|
| `mobius/sql_action.js` | 수정 | 대상 4개 함수 전환 + 중복 정의 1개 삭제 |
| `test/parent-update.test.js` | **생성** | 전환된 함수가 드라이버에 넘기는 SQL/bindings 를 캡처해 검증 |

`tapAdapter` 패턴은 `test/sqli-regression.test.js` 와 `test/converted-queries.test.js` 에 이미 두 번 복사돼 있다. 세 번째 복사가 되지만, 공유 헬퍼로 빼는 것은 이번 범위 밖이다(2차에서 이미 유예한 항목).

---

### Task 1: `update_parent_by_delete` 중복 정의 제거

**Files:**
- Modify: `mobius/sql_action.js:3427-3441` (앞 정의 삭제)

**Interfaces:**
- Consumes: 없음
- Produces: `exports.update_parent_by_delete(connection, obj, cs, callback)` — 정의가 하나만 남는다. 동작은 그대로(뒤 정의가 이미 유효한 정의였다).

- [ ] **Step 1: 두 정의가 동일한지 다시 확인한다**

Run:
```bash
sed -n '3427,3441p' mobius/sql_action.js > /tmp/pbd1.txt
sed -n '3459,3473p' mobius/sql_action.js > /tmp/pbd2.txt
diff /tmp/pbd1.txt /tmp/pbd2.txt && echo "동일 — 삭제 안전"
```
Expected: `동일 — 삭제 안전`. **차이가 나오면 멈추고 보고한다.**

- [ ] **Step 2: 앞 정의(3427-3441)를 삭제한다**

아래 블록 전체를 지운다. 뒤따르는 빈 줄 하나도 함께 지워 `update_parent_by_insert` 와 `update_parent_st` 사이에 빈 줄이 하나만 남게 한다.

```js
exports.update_parent_by_delete = function (connection, obj, cs, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var cni_id = 'update_parent_by_insert ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);
    var sql = util.format('update %s, lookup set %s.cni = %s.cni-1, %s.cbs = %s.cbs-%s, lookup.st = lookup.st+1 where lookup.ri = \'%s\' and %s.ri = \'%s\'', tableName, tableName, tableName, tableName, tableName, cs, obj.ri, tableName, obj.ri);
    db.getResult(sql, connection, function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};
```

**주의**: 이 블록은 파일에 두 번 나온다. **앞의 것(3427행부터)** 만 지운다. `update_parent_st` 정의 **앞**에 있는 쪽이 지울 대상이고, **뒤**에 있는 쪽을 남긴다.

- [ ] **Step 3: 정의가 하나만 남았는지 확인한다**

Run:
```bash
grep -c "^exports.update_parent_by_delete" mobius/sql_action.js
node --check mobius/sql_action.js && echo "syntax OK"
```
Expected: `1`, `syntax OK`

- [ ] **Step 4: 테스트를 돌린다**

Run:
```bash
npm test
```
Expected: PASS, 49 pass / 0 fail (변화 없음 — 순수 중복 제거다)

- [ ] **Step 5: 커밋한다**

```bash
git add mobius/sql_action.js
git commit -m "refactor(sql): remove the duplicate update_parent_by_delete definition

같은 함수가 3427행과 3459행에 바이트 단위로 동일하게 두 번 정의돼 있었다.
뒤 정의가 앞을 덮으므로 동작 변화는 없다."
```

---

### Task 2: `update_parent_st` 전환

가장 단순한 대상부터 옮긴다. 이 함수는 `lookup.st` 하나만 올리는데도 MySQL 다중 테이블 UPDATE 문법을 쓰고 있다.

**Files:**
- Modify: `mobius/sql_action.js` (`exports.update_parent_st`)
- Test: `test/parent-update.test.js` (생성)

**Interfaces:**
- Consumes: Task 1 이 남긴 단일 `update_parent_by_delete` (직접 호출하지는 않는다)
- Produces: `exports.update_parent_st(connection, obj, callback)` — 시그니처 불변. 내부만 파사드로 바뀐다.

- [ ] **Step 1: 현재 SQL 을 확인한다**

Run:
```bash
sed -n '/^exports.update_parent_st/,/^};/p' mobius/sql_action.js
```
Expected: `update %s, lookup set lookup.st = lookup.st+1 where lookup.ri = '%s' and %s.ri = '%s'` 형태.

`tableName` 은 조건절에만 쓰이고 SET 절에는 안 쓰인다. 즉 **의미는 "해당 ri 가 그 타입 테이블에 존재할 때만 lookup.st 를 올린다"** 이다. 전환할 때 이 존재 조건을 유지해야 한다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`test/parent-update.test.js` 를 새로 만든다:

```js
'use strict';
// 부모 갱신 계열이 파사드를 거쳐 드라이버에 어떤 SQL/bindings 를 넘기는지
// 캡처한다. 등가성 하네스는 이 함수들의 SQLite 경로를 밟지 못했다 —
// db_action.getResult 가 usesqlite 와 무관하게 MySQL 로만 보냈기 때문이다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-parent-update-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

// 어댑터의 execute 를 가로채 드라이버에 도달하는 sql/bindings 를 모은다.
// 실제 export 를 그대로 호출하므로 호출 경로 전체가 검증된다.
function tapAdapter(useSqlite) {
    const db = freshDb(useSqlite);
    const adapterPath = path.join(DB, useSqlite ? 'sqlite.js' : 'mysql.js');
    const adapter = require(adapterPath);
    const seen = [];

    adapter.execute = function (conn, sql, bindings, cb) {
        seen.push({ sql: sql, bindings: bindings });
        cb(null, { affectedRows: 1, insertId: 0 });
    };
    // 트랜잭션 능력이 있는 백엔드는 begin/commit 도 기록한다.
    adapter.begin = function (h, cb) { seen.push({ sql: 'BEGIN' }); cb(null); };
    adapter.commit = function (h, cb) { seen.push({ sql: 'COMMIT' }); cb(null); };
    adapter.rollback = function (h, cb) { seen.push({ sql: 'ROLLBACK' }); cb(null); };

    db.connect('h', 1, 'u', 'p', function () {});

    delete require.cache[require.resolve(path.join(__dirname, '..', 'mobius', 'sql_action.js'))];
    const sql_action = require(path.join(__dirname, '..', 'mobius', 'sql_action.js'));
    return { sql_action: sql_action, seen: seen };
}

test('update_parent_st: SQLite 에서도 파사드를 거친다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1, 'UPDATE 는 1개여야 한다');
        assert.match(updates[0].sql, /update `lookup` set `st`/i);
        // 값은 전부 바인딩으로 나가야 한다 — SQL 에 ri 가 박히면 안 된다.
        assert.ok(updates[0].sql.indexOf('/M/c1') === -1, 'ri 가 SQL 에 인라인되면 안 된다');
        assert.ok(updates[0].bindings.indexOf('/M/c1') !== -1, 'ri 는 바인딩으로 나가야 한다');
        done();
    });
});

test('update_parent_st: MySQL 에서도 같은 형태로 나간다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 1);
        assert.match(updates[0].sql, /update `lookup` set `st`/i);
        assert.ok(updates[0].bindings.indexOf('/M/c1') !== -1);
        done();
    });
});

test('update_parent_st: 타입 테이블 존재 조건을 유지한다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_st({}, { ri: '/M/c1', ty: '3' }, function () {
        const upd = seen.filter(function (s) { return /^update/i.test(s.sql); })[0];
        // 기존 MySQL SQL 은 "and cnt.ri = ?" 로 해당 타입 테이블에 행이 있을 때만
        // st 를 올렸다. 그 조건이 사라지면 고아 lookup 행의 st 까지 올라간다.
        assert.match(upd.sql, /select \* from `cnt`|exists/i,
            '타입 테이블 존재 조건이 사라졌다');
        done();
    });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: FAIL — 현재 구현은 `db.getResult` 로 나가므로 파사드 어댑터 tap 에 아무것도 안 잡힌다 (`UPDATE 는 1개여야 한다` 에서 `0 !== 1`).

- [ ] **Step 4: 구현한다**

`mobius/sql_action.js` 의 `exports.update_parent_st` 를 통째로 바꾼다.

변경 전:
```js
exports.update_parent_st = function (connection, obj, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var st_id = 'update_parent_st ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(st_id);
    var sql = util.format('update %s, lookup set lookup.st = lookup.st+1 where lookup.ri = \'%s\' and %s.ri = \'%s\'', tableName, obj.ri, tableName, obj.ri);
    db.getResult(sql, connection, function (err, results) {
        if (!err) {
            console.timeEnd(st_id);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};
```

변경 후:
```js
// 이전에는 MySQL 전용 다중 테이블 UPDATE(`update cnt, lookup set ...`)를
// db.getResult 로 보냈다. db_action.getResult 는 usesqlite 와 무관하게 항상
// MySQL 풀로 가므로, SQLite 모드에서는 MySQL 의 0개 행에 적용되고 에러 없이
// 성공 처리됐다 — st 증가가 조용히 유실됐다.
//
// tableName 은 SET 절이 아니라 조건절에만 쓰였다. "해당 ri 가 그 타입
// 테이블에 존재할 때만 올린다"는 의미이므로, EXISTS 서브쿼리로 그대로 옮긴다.
exports.update_parent_st = function (connection, obj, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var st_id = 'update_parent_st ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(st_id);

    var qb = facade.k('lookup')
        .update({ st: facade.raw('st + 1') })
        .where({ ri: obj.ri })
        .whereExists(facade.k(tableName).select('*').whereRaw('??.?? = ?', [tableName, 'ri', obj.ri]));

    facade.run(qb, connection, function (err, results) {
        if (!err) {
            console.timeEnd(st_id);
        }
        callback(err, results);
    });
};
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: PASS (3 tests)

생성된 SQL 을 눈으로도 확인한다:
```bash
node -e "
global.usesqlite='false';
var f=require('./mobius/db');
f.connect('h',1,'u','p',function(){});
var qb=f.k('lookup').update({st:f.raw('st + 1')}).where({ri:'/M/c1'})
  .whereExists(f.k('cnt').select('*').whereRaw('??.?? = ?',['cnt','ri','/M/c1']));
console.log(JSON.stringify(qb.toSQL().toNative(), null, 1));
"
```
Expected: `update \`lookup\` set \`st\` = st + 1 where \`ri\` = ? and exists (select * from \`cnt\` where \`cnt\`.\`ri\` = ?)` 와 bindings `['/M/c1','/M/c1']`.

- [ ] **Step 6: 전체 테스트 후 커밋한다**

```bash
npm test
git add mobius/sql_action.js test/parent-update.test.js
git commit -m "fix(sql): route update_parent_st through the facade

MySQL 전용 다중 테이블 UPDATE 를 db.getResult 로 보내고 있었다.
db_action.getResult 는 usesqlite 와 무관하게 항상 MySQL 풀로 가므로
SQLite 모드에서는 0개 행에 적용되고 에러 없이 성공 처리됐다.

조건절의 타입 테이블 참조는 EXISTS 서브쿼리로 옮겨 의미를 보존한다."
```

---

### Task 3: `update_parent_by_delete` 전환

**Files:**
- Modify: `mobius/sql_action.js` (`exports.update_parent_by_delete` — Task 1 이후 단 하나 남은 정의)
- Test: `test/parent-update.test.js` (추가)

**Interfaces:**
- Consumes: Task 2 의 `facade` 사용 패턴, `test/parent-update.test.js` 의 `tapAdapter(useSqlite) -> {sql_action, seen}`
- Produces: `exports.update_parent_by_delete(connection, obj, cs, callback)` — 시그니처 불변.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`test/parent-update.test.js` 끝에 붙인다:

```js
test('update_parent_by_delete: SQLite 에서 두 UPDATE 가 파사드로 나간다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 2, 'cnt 와 lookup 각각 1개씩이어야 한다');
        assert.match(updates[0].sql, /update `cnt` set/i);
        assert.match(updates[0].sql, /`cni`.*`cbs`|`cbs`.*`cni`/i);
        assert.match(updates[1].sql, /update `lookup` set `st`/i);
        // cs 는 바인딩으로 나가야 한다.
        assert.ok(updates[0].bindings.indexOf(4) !== -1 || updates[0].sql.indexOf('?') !== -1);
        done();
    });
});

test('update_parent_by_delete: SQLite 는 트랜잭션 없이 본문만 돈다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, function () {
        assert.strictEqual(seen.filter(function (s) { return s.sql === 'BEGIN'; }).length, 0,
            'SQLite 는 transaction 능력이 없다');
        done();
    });
});

test('update_parent_by_delete: MySQL 은 BEGIN/COMMIT 으로 감싼다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_parent_by_delete({}, { ri: '/M/c1', ty: '3' }, 4, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.deepStrictEqual(order, ['BEGIN', 'UPDATE', 'UPDATE', 'COMMIT'],
            '두 UPDATE 가 한 트랜잭션 안에 있어야 한다');
        done();
    });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: FAIL — 새 3개가 `0 !== 2` 등으로 실패. Task 2 의 3개는 계속 PASS.

- [ ] **Step 3: 구현한다**

Task 1 이후 남은 단 하나의 `exports.update_parent_by_delete` 를 통째로 바꾼다.

변경 전:
```js
exports.update_parent_by_delete = function (connection, obj, cs, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var cni_id = 'update_parent_by_insert ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);
    var sql = util.format('update %s, lookup set %s.cni = %s.cni-1, %s.cbs = %s.cbs-%s, lookup.st = lookup.st+1 where lookup.ri = \'%s\' and %s.ri = \'%s\'', tableName, tableName, tableName, tableName, tableName, cs, obj.ri, tableName, obj.ri);
    db.getResult(sql, connection, function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};
```

변경 후:
```js
// 이전에는 MySQL 전용 다중 테이블 UPDATE 를 db.getResult 로 보냈다.
// SQLite 모드에서는 MySQL 의 0개 행에 적용돼 cni/cbs 감소가 조용히 유실됐다
// (실측: cin 은 지워지는데 cnt.cni 는 그대로).
//
// 한 문장을 두 문장으로 쪼개면 원자성을 잃으므로 transaction 으로 감싼다.
// MySQL 은 실제 BEGIN/COMMIT 이 돌고, SQLite 는 능력이 없어 본문만 돈다
// (기존 SQLite 경로도 이미 비원자적이었으므로 회귀는 아니다).
//
// console.time 라벨이 'update_parent_by_insert' 였던 것은 복사 실수다.
exports.update_parent_by_delete = function (connection, obj, cs, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var cni_id = 'update_parent_by_delete ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);

    facade.transaction(connection, function (conn, finish) {
        var q1 = facade.k(tableName)
            .update({
                cni: facade.raw('cni - 1'),
                cbs: facade.raw('cbs - ?', [cs])
            })
            .where({ ri: obj.ri });

        facade.run(q1, conn, function (err1, r1) {
            if (err1) { return finish(err1, r1); }

            var q2 = facade.k('lookup')
                .update({ st: facade.raw('st + 1') })
                .where({ ri: obj.ri });

            facade.run(q2, conn, function (err2, r2) {
                finish(err2, err2 ? r2 : r1);
            });
        });
    }, function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
        }
        callback(err, results);
    });
};
```

**결과값 주의**: 호출부는 `results` 를 쓰지 않지만(`resource.js:2415`, `:2557` 모두 무시), 규약을 지키려고 성공 시 첫 UPDATE 의 결과(`r1`)를 돌려준다. 기존 다중 테이블 UPDATE 의 `affectedRows` 와 정확히 같지는 않다 — 기존은 두 테이블 합계였다.

- [ ] **Step 4: 테스트 통과를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: PASS (6 tests)

- [ ] **Step 5: 전체 테스트 후 커밋한다**

```bash
npm test
git add mobius/sql_action.js test/parent-update.test.js
git commit -m "fix(sql): route update_parent_by_delete through the facade

SQLite 모드에서 CIN 을 지워도 부모 cnt 의 cni/cbs 가 줄지 않았다.
다중 테이블 UPDATE 가 MySQL 풀로 나가 0개 행에 적용되고 에러 없이
성공 처리됐기 때문이다. 두 문장으로 쪼개 transaction 으로 감싼다.

console.time 라벨의 'by_insert' 오타도 함께 고친다."
```

---

### Task 4: `update_cnt_cni` 전환 (SQLite 분기 제거)

**Files:**
- Modify: `mobius/sql_action.js:3353-3393` (`exports.update_cnt_cni`)
- Test: `test/parent-update.test.js` (추가)

**Interfaces:**
- Consumes: `tapAdapter(useSqlite) -> {sql_action, seen}`
- Produces: `exports.update_cnt_cni(connection, obj, callback)` — 시그니처 불변. `obj.cni`, `obj.cbs`, `obj.st`, `obj.ri` 를 쓴다.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`test/parent-update.test.js` 끝에 붙인다:

```js
test('update_cnt_cni: 두 백엔드가 같은 값을 쓴다 (재계산 안 함)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_cnt_cni({}, { ri: '/M/c1', cni: 7, cbs: 28, st: 5 }, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        // 기존 SQLite 분기는 select count(*) from cin 으로 다시 계산했다.
        // 이제는 호출자가 넘긴 값을 그대로 쓴다.
        const selects = seen.filter(function (s) { return /^select/i.test(s.sql); });
        assert.strictEqual(selects.length, 0, 'cni 를 재계산하면 안 된다');

        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 2);
        assert.match(updates[0].sql, /update `cnt` set/i);
        assert.ok(updates[0].bindings.indexOf(7) !== -1, 'cni 는 넘겨받은 7 이어야 한다');
        assert.ok(updates[0].bindings.indexOf(28) !== -1, 'cbs 는 넘겨받은 28 이어야 한다');
        assert.match(updates[1].sql, /update `lookup` set `st`/i);
        assert.ok(updates[1].bindings.indexOf(5) !== -1, 'st 는 넘겨받은 5 이어야 한다');
        done();
    });
});

test('update_cnt_cni: MySQL 도 같은 두 UPDATE 를 낸다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_cnt_cni({}, { ri: '/M/c1', cni: 7, cbs: 28, st: 5 }, function (err) {
        assert.ok(!err);
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.deepStrictEqual(order, ['BEGIN', 'UPDATE', 'UPDATE', 'COMMIT']);
        done();
    });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: FAIL — SQLite 경로가 `db_sqlite` 를 직접 부르므로 파사드 tap 에 안 잡힌다.

- [ ] **Step 3: 구현한다**

`exports.update_cnt_cni` (3353-3393) 를 통째로 바꾼다.

변경 후:
```js
// 이전에는 백엔드마다 의미가 달랐다. MySQL 은 호출자가 넘긴 obj.cni/obj.cbs 를
// 썼고, SQLite 분기는 select count(*), sum(cs) from cin 으로 다시 계산했다.
// 재계산은 (a) CIN 이 많은 컨테이너에서 매번 풀스캔이고, (b) 두 백엔드의
// 동작을 비교 불가능하게 만들며, (c) update_parent_by_insert 가 mni 상한으로
// 이미 조정해 넘긴 값을 무시한다. 넘겨받은 값으로 통일한다.
exports.update_cnt_cni = function (connection, obj, callback) {
    var cni_id = 'update_cnt_cni ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);

    facade.transaction(connection, function (conn, finish) {
        var q1 = facade.k('cnt')
            .update({ cni: obj.cni, cbs: obj.cbs })
            .where({ ri: obj.ri });

        facade.run(q1, conn, function (err1, r1) {
            if (err1) { return finish(err1, r1); }

            var q2 = facade.k('lookup')
                .update({ st: obj.st })
                .where({ ri: obj.ri });

            facade.run(q2, conn, function (err2, r2) {
                finish(err2, err2 ? r2 : r1);
            });
        });
    }, function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
        }
        callback(err, results);
    });
};
```

- [ ] **Step 4: `update_parent_by_insert` 의 분기가 여전히 맞는지 확인한다**

`update_parent_by_insert` 는 `usesqlite === 'true' && obj.ty == '3'` 일 때 `update_cnt_cni` 로 우회한다. 이제 `update_cnt_cni` 가 백엔드 무관이 되었으므로 **이 분기의 `usesqlite` 조건은 불필요**하다. 하지만 MySQL 경로는 `cbs` 를 `cbs + cs` 로 **증분**하는 반면 `update_cnt_cni` 는 `obj.cbs` 를 **대입**한다 — 의미가 달라 지금 합치면 안 된다.

이번 태스크에서는 **건드리지 않는다.** Task 5 에서 다룬다.

Run (현재 상태 확인용):
```bash
sed -n '/^exports.update_parent_by_insert/,/^};/p' mobius/sql_action.js | head -20
```
Expected: `if (global.usesqlite === 'true' && obj.ty == '3')` 분기가 그대로 있다.

- [ ] **Step 5: 테스트 통과를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: PASS (8 tests)

- [ ] **Step 6: 전체 테스트 후 커밋한다**

```bash
npm test
git add mobius/sql_action.js test/parent-update.test.js
git commit -m "fix(sql): unify update_cnt_cni across backends

SQLite 분기가 cni/cbs 를 select count(*) 로 다시 계산해 MySQL 과 의미가
달랐다. 호출자가 넘긴 값으로 통일하고 파사드 + transaction 으로 옮긴다.

재계산은 CIN 이 많은 컨테이너에서 매 삽입마다 풀스캔이었고,
update_parent_by_insert 가 mni 상한으로 조정한 값을 무시했다."
```

---

### Task 5: `update_parent_by_insert` 전환

**Files:**
- Modify: `mobius/sql_action.js:3395-3425` (`exports.update_parent_by_insert`)
- Test: `test/parent-update.test.js` (추가)

**Interfaces:**
- Consumes: `tapAdapter(useSqlite) -> {sql_action, seen}`, Task 4 의 `update_cnt_cni`
- Produces: `exports.update_parent_by_insert(connection, obj, cs, callback)` — 시그니처 불변. `usesqlite` 분기가 사라진다.

- [ ] **Step 1: 현재 두 경로의 의미 차이를 확인한다**

Run:
```bash
sed -n '/^exports.update_parent_by_insert/,/^};/p' mobius/sql_action.js
```

두 경로의 의미:

| | `cni` | `cbs` | `st` |
|---|---|---|---|
| SQLite (`ty=='3'`) → `update_cnt_cni` | `obj.cni` **대입** | `obj.cbs` **대입** | `obj.st + 1` **대입** |
| MySQL | `obj.cni` **대입** | `cbs + cs` **증분** | `st + 1` **증분** |

`cni` 는 이미 양쪽 다 대입이다(함수 앞부분에서 `obj.cni += 1` 하고 `mni` 상한을 적용한다). 차이는 `cbs` 와 `st` 뿐이다.

**증분(MySQL) 쪽을 정본으로 삼는다.** 동시 삽입이 있을 때 대입은 서로를 덮어쓰지만 증분은 안 덮는다. `update_cnt_cni` 는 삭제/정정 경로에서 절대값을 써야 하므로 대입인 채로 둔다 — 두 함수의 의미가 다른 게 맞다.

- [ ] **Step 2: 실패하는 테스트를 추가한다**

`test/parent-update.test.js` 끝에 붙인다:

```js
test('update_parent_by_insert: SQLite 에서도 파사드로 나간다 (ty=3)', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_by_insert({}, { ri: '/M/c1', ty: '3', cni: 2, mni: 10, cbs: 8, st: 4 }, 4, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.strictEqual(updates.length, 2);
        assert.match(updates[0].sql, /update `cnt` set/i);
        assert.match(updates[1].sql, /update `lookup` set `st`/i);
        done();
    });
});

test('update_parent_by_insert: cbs 와 st 는 증분이다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    sql_action.update_parent_by_insert({}, { ri: '/M/c1', ty: '3', cni: 2, mni: 10, cbs: 8, st: 4 }, 4, function () {
        const updates = seen.filter(function (s) { return /^update/i.test(s.sql); });
        assert.match(updates[0].sql, /`cbs`\s*=\s*cbs \+/i, 'cbs 는 증분이어야 한다');
        assert.match(updates[1].sql, /`st`\s*=\s*st \+ 1/i, 'st 는 증분이어야 한다');
        done();
    });
});

test('update_parent_by_insert: cni 는 mni 상한을 넘지 않는다', function (t, done) {
    const { sql_action, seen } = tapAdapter(true);
    // cni=9 에서 1 늘면 10, mni=10 이므로 그대로 10.
    sql_action.update_parent_by_insert({}, { ri: '/M/c1', ty: '3', cni: 9, mni: 10, cbs: 8, st: 4 }, 4, function () {
        const upd = seen.filter(function (s) { return /^update/i.test(s.sql); })[0];
        assert.ok(upd.bindings.indexOf(10) !== -1, 'cni 는 10 으로 묶여야 한다');
        done();
    });
});

test('update_parent_by_insert: usesqlite 분기가 사라졌다', function () {
    const fs = require('node:fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');
    const body = src.slice(src.indexOf('exports.update_parent_by_insert'));
    const end = body.indexOf('\nexports.');
    assert.strictEqual(body.slice(0, end).indexOf('global.usesqlite'), -1,
        'update_parent_by_insert 안에 usesqlite 분기가 남아 있다');
});
```

- [ ] **Step 3: 실패를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: FAIL — 마지막 테스트가 `usesqlite` 분기를 찾아내고, 나머지는 MySQL 경로가 `db.getResult` 로 빠져 tap 에 안 잡힌다.

- [ ] **Step 4: 구현한다**

`exports.update_parent_by_insert` 를 통째로 바꾼다.

변경 후:
```js
// 이전에는 usesqlite && ty=='3' 일 때만 update_cnt_cni 로 우회하고, 나머지는
// MySQL 전용 다중 테이블 UPDATE 로 갔다. 그 경로는 SQLite 모드에서 MySQL 의
// 0개 행에 적용돼 조용히 유실됐다.
//
// cbs 와 st 는 대입이 아니라 증분이다 — 동시 삽입이 서로를 덮어쓰지 않게
// 하려면 증분이어야 한다. (절대값 정정은 update_cnt_cni 가 담당한다.)
exports.update_parent_by_insert = function (connection, obj, cs, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];
    var cni_id = 'update_parent_by_insert ' + obj.ri + ' - ' + require('shortid').generate();
    console.time(cni_id);

    obj.cni += 1;
    if (obj.cni > obj.mni) {
        obj.cni = obj.mni;
    }

    facade.transaction(connection, function (conn, finish) {
        var q1 = facade.k(tableName)
            .update({
                cni: obj.cni,
                cbs: facade.raw('cbs + ?', [cs])
            })
            .where({ ri: obj.ri });

        facade.run(q1, conn, function (err1, r1) {
            if (err1) { return finish(err1, r1); }

            var q2 = facade.k('lookup')
                .update({ st: facade.raw('st + 1') })
                .where({ ri: obj.ri });

            facade.run(q2, conn, function (err2, r2) {
                finish(err2, err2 ? r2 : r1);
            });
        });
    }, function (err, results) {
        if (!err) {
            console.timeEnd(cni_id);
        }
        callback(err, results);
    });
};
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: PASS (12 tests)

- [ ] **Step 6: `usesqlite` 잔여 수를 센다**

Run:
```bash
grep -c "global.usesqlite" mobius/sql_action.js
```
Expected: 3차 시작 전보다 **2 줄어든** 값 (`update_cnt_cni` 1개, `update_parent_by_insert` 1개). 시작 전 값은 Task 1 착수 시점에 기록해 둔다.

- [ ] **Step 7: 전체 테스트 후 커밋한다**

```bash
npm test
git add mobius/sql_action.js test/parent-update.test.js
git commit -m "fix(sql): route update_parent_by_insert through the facade

usesqlite && ty=='3' 일 때만 update_cnt_cni 로 우회하고 나머지는 MySQL
전용 다중 테이블 UPDATE 로 갔다. SQLite 모드에서 그 경로는 0개 행에
적용돼 조용히 유실됐다. 분기를 없애고 두 UPDATE + transaction 으로 통일한다.

cbs/st 는 증분을 유지한다 — 동시 삽입이 서로를 덮어쓰면 안 된다."
```

---

### Task 6: `update_acp` / `update_sub` 원자성

두 함수는 2차에서 파사드로 옮겼지만 `update_lookup` 과 본문 UPDATE 가 각각 독립 실행된다. 하나가 실패하면 반쪽만 반영된다.

**Files:**
- Modify: `mobius/sql_action.js` (`exports.update_acp`, `exports.update_sub`)
- Test: `test/parent-update.test.js` (추가)

**Interfaces:**
- Consumes: `tapAdapter(useSqlite) -> {sql_action, seen}`
- Produces: `exports.update_acp(connection, obj, callback)`, `exports.update_sub(connection, obj, callback)` — 시그니처 불변.

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`test/parent-update.test.js` 끝에 붙인다:

```js
test('update_acp: MySQL 에서 lookup 과 acp 가 한 트랜잭션이다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_acp({}, {
        ri: '/M/a1', lbl: [], acpi: [], at: [], aa: [], subl: [],
        et: '20280101T000000', st: 1, pv: { acr: [] }, pvs: { acr: [] }
    }, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.strictEqual(order[0], 'BEGIN', '트랜잭션으로 감싸야 한다');
        assert.strictEqual(order[order.length - 1], 'COMMIT');
        assert.strictEqual(order.filter(function (o) { return o === 'UPDATE'; }).length, 2);
        done();
    });
});

test('update_sub: MySQL 에서 lookup 과 sub 가 한 트랜잭션이다', function (t, done) {
    const { sql_action, seen } = tapAdapter(false);
    sql_action.update_sub({}, {
        ri: '/M/s1', lbl: [], acpi: [], at: [], aa: [], subl: [],
        et: '20280101T000000', st: 1, enc: {}, nu: [], nct: 1, pn: 1, exc: 0
    }, function (err) {
        assert.ok(!err, '실패하면 안 된다: ' + JSON.stringify(err));
        const order = seen.map(function (s) { return /^update/i.test(s.sql) ? 'UPDATE' : s.sql; });
        assert.strictEqual(order[0], 'BEGIN');
        assert.strictEqual(order[order.length - 1], 'COMMIT');
        done();
    });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: FAIL — `order[0]` 이 `'UPDATE'` 라 `'BEGIN'` 과 다르다.

- [ ] **Step 3: `update_acp` 를 트랜잭션으로 감싼다**

변경 전:
```js
exports.update_acp = function (connection, obj, callback) {
    console.time('update_acp ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (err) {
            callback(err, results);
            return;
        }

        // 이전에는 db.getResult 를 무조건 호출해 SQLite 모드에서도 MySQL 로 나갔다.
        // select_acp 는 SQLite 에서 읽으므로 정책 갱신이 조용히 유실됐다.
        facade.run(facade.k('acp').update({
            pv: JSON.stringify(obj.pv),
            pvs: JSON.stringify(obj.pvs)
        }).where({ ri: obj.ri }), connection, function (err2, results2) {
            if (!err2) {
                console.timeEnd('update_acp ' + obj.ri);
            }
            callback(err2, results2);
        });
    });
};
```

변경 후:
```js
// 이전에는 db.getResult 를 무조건 호출해 SQLite 모드에서도 MySQL 로 나갔다.
// select_acp 는 SQLite 에서 읽으므로 정책 갱신이 조용히 유실됐다(2차에서 수정).
// 여기서는 lookup 과 acp 두 문장을 한 트랜잭션으로 묶는다 — 반쪽만 반영되면
// 리소스 메타데이터와 접근 정책이 어긋난다.
exports.update_acp = function (connection, obj, callback) {
    console.time('update_acp ' + obj.ri);
    facade.transaction(connection, function (conn, finish) {
        _this.update_lookup(conn, obj, function (err, results) {
            if (err) { return finish(err, results); }

            facade.run(facade.k('acp').update({
                pv: JSON.stringify(obj.pv),
                pvs: JSON.stringify(obj.pvs)
            }).where({ ri: obj.ri }), conn, function (err2, results2) {
                finish(err2, err2 ? results2 : results);
            });
        });
    }, function (err, results) {
        if (!err) {
            console.timeEnd('update_acp ' + obj.ri);
        }
        callback(err, results);
    });
};
```

- [ ] **Step 4: `update_sub` 도 같은 모양으로 감싼다**

Run 으로 현재 모양을 먼저 확인한다:
```bash
sed -n '/^exports.update_sub/,/^};/p' mobius/sql_action.js
```

`update_acp` 와 동일한 변환을 적용한다:
1. 바깥을 `facade.transaction(connection, function (conn, finish) { ... }, function (err, results) { ... })` 로 감싼다.
2. 안쪽의 `connection` 인자를 전부 `conn` 으로 바꾼다.
3. 안쪽의 `callback(...)` 을 `finish(...)` 로 바꾼다.
4. `console.timeEnd` 를 바깥 콜백으로 옮긴다.
5. 성공 시 `finish(err2, err2 ? results2 : results)` 로 첫 문장의 결과를 보존한다.

- [ ] **Step 5: 테스트 통과를 확인한다**

Run:
```bash
node --test test/parent-update.test.js
```
Expected: PASS (14 tests)

- [ ] **Step 6: 전체 테스트 후 커밋한다**

```bash
npm test
git add mobius/sql_action.js test/parent-update.test.js
git commit -m "fix(sql): make update_acp and update_sub atomic

lookup 갱신과 본문 갱신이 각각 독립 실행돼 하나가 실패하면 반쪽만
반영됐다. 두 문장을 한 트랜잭션으로 묶는다."
```

---

### Task 7: 통합 검증

**Files:** 수정 없음 (검증 전용)

**Interfaces:**
- Consumes: Task 1~6 전부
- Produces: 없음

- [ ] **Step 1: 전체 단위 테스트**

Run:
```bash
npm test
```
Expected: PASS, 실패 0. 통과 수 = 49 + 14 = 63

- [ ] **Step 2: 실측 재현 — 3차 착수 전의 버그가 사라졌는지 본다**

이것이 이번 회차의 **핵심 검증**이다. 배경 절의 실측을 그대로 되풀이한다.

SQLite 모드로 깨끗한 DB 에서 띄운다:
```bash
rm -f ./mobius.db
node mobius.js sqlite
```

준비되면 AE → CNT → CIN 2개를 만든다:
```bash
curl -s -o /dev/null -w "AE -> %{http_code}\n" -X POST \
  -H 'X-M2M-Origin: Cp3ae' -H 'X-M2M-RI: p1' -H 'Content-Type: application/json;ty=2' \
  -d '{"m2m:ae":{"rn":"p3ae","api":"0.2.481.2.0001.001.000111","rr":true}}' \
  http://127.0.0.1:7579/Mobius

curl -s -o /dev/null -w "CNT -> %{http_code}\n" -X POST \
  -H 'X-M2M-Origin: Cp3ae' -H 'X-M2M-RI: p2' -H 'Content-Type: application/json;ty=3' \
  -d '{"m2m:cnt":{"rn":"p3cnt"}}' \
  http://127.0.0.1:7579/Mobius/p3ae

curl -s -o /dev/null -w "CIN1 -> %{http_code}\n" -X POST \
  -H 'X-M2M-Origin: Cp3ae' -H 'X-M2M-RI: c1' -H 'Content-Type: application/json;ty=4' \
  -d '{"m2m:cin":{"con":"val1"}}' \
  http://127.0.0.1:7579/Mobius/p3ae/p3cnt

curl -s -o /dev/null -w "CIN2 -> %{http_code}\n" -X POST \
  -H 'X-M2M-Origin: Cp3ae' -H 'X-M2M-RI: c2' -H 'Content-Type: application/json;ty=4' \
  -d '{"m2m:cin":{"con":"val2"}}' \
  http://127.0.0.1:7579/Mobius/p3ae/p3cnt
```

삭제 전 상태를 기록한다:
```bash
node -e "
var s=require('sqlite3');
var d=new s.Database('./mobius.db');
d.all(\"select ri, cni, cbs from cnt\", function(e,r){
  console.log('삭제 전 cnt:', JSON.stringify(r));
  process.exit(0);
});
"
```
Expected: `cni: '2'`, `cbs: '8'`

CIN 하나를 지운다:
```bash
curl -s -o /dev/null -w "DELETE -> %{http_code}\n" -X DELETE \
  -H 'X-M2M-Origin: Cp3ae' -H 'X-M2M-RI: dl' \
  http://127.0.0.1:7579/Mobius/p3ae/p3cnt/la
```

삭제 후 상태를 본다:
```bash
node -e "
var s=require('sqlite3');
var d=new s.Database('./mobius.db');
d.all(\"select ri, cni, cbs from cnt\", function(e,r){
  console.log('삭제 후 cnt:', JSON.stringify(r), ' <- cni=1, cbs=4 여야 한다');
  d.all(\"select count(*) as n from cin\", function(e2,r2){
    console.log('실제 cin 수:', JSON.stringify(r2));
    process.exit(0);
  });
});
"
```
Expected: **`cni: '1'`, `cbs: '4'`, `cin` 수 1** — 카운터와 실제가 일치한다.

**여전히 `cni: '2'` 라면 전환이 안 먹은 것이다.** 멈추고 보고한다.

- [ ] **Step 3: 등가성 — SQLite 변경 전/후 비교**

3차 착수 시점 커밋(Task 1 직전 HEAD)을 `BASE3` 로 잡는다.

```bash
BASE3=$(git rev-parse HEAD)   # Task 1 착수 전에 미리 기록해 둔 값을 쓴다
```

양쪽 모두 **깨끗한 DB, 기본 경로**로 돌린다:

1. `git checkout $BASE3` → `rm -f ./mobius.db` → `node mobius.js sqlite` → 하네스 → `before.json` → 서버 종료
2. `git checkout worktree-db-layer-prep3` → `rm -f ./mobius.db` → `node mobius.js sqlite` → 하네스 → `after.json` → 서버 종료
3. 비교

```bash
node tools/equivalence/run-scenarios.js <스크래치패드>/p3-before-sqlite.json
node tools/equivalence/run-scenarios.js <스크래치패드>/p3-after-sqlite.json
node tools/equivalence/compare.js <스크래치패드>/p3-before-sqlite.json <스크래치패드>/p3-after-sqlite.json
```

Expected: **차이가 있을 수 있다.** 이번 회차는 버그를 고치는 것이므로 `cni`/`cbs`/`st` 관련 단계가 달라지는 것이 **정상**이다. 차이가 나오면 각각이 "고쳐진 것"인지 "깨진 것"인지 판정해 보고한다. 그 외 단계는 동일해야 한다.

**주의**: `tools/equivalence/out/` 의 기준선을 덮어쓰지 않는다. 출력은 스크래치패드로 보낸다.

- [ ] **Step 4: 등가성 — MySQL 변경 전/후 비교**

같은 절차를 `node mobius.js mysql` 로 되풀이한다.

Expected: **32단계 모두 일치.** MySQL 은 한 문장이 두 문장 + 트랜잭션으로 바뀌었을 뿐 의미가 같아야 한다. **차이가 나오면 회귀다** — 멈추고 보고한다.

- [ ] **Step 5: 정리한다**

**`taskkill /IM node.exe` 금지.** 커맨드라인에 `mobius` 가 든 PID 만 종료한다:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*mobius*' } |
  Select-Object -First 1 |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

(마스터를 죽이면 워커가 함께 내려간다. `-First 1` 로 마스터만 잡고, 이후 남은 프로세스가 없는지 확인한다.)

그다음:
```bash
rm -f ./mobius.db
git status --porcelain
```
Expected: `git status` 가 깨끗하다.

- [ ] **Step 6: 결과를 정리해 보고한다**

```bash
echo "=== usesqlite 잔여 (sql_action.js) ==="
grep -c "global.usesqlite" mobius/sql_action.js
echo "=== facade.run 사용처 ==="
grep -c "facade.run" mobius/sql_action.js
echo "=== facade.transaction 사용처 (5 기대: by_delete, cnt_cni, by_insert, acp, sub) ==="
grep -c "facade.transaction" mobius/sql_action.js
echo "=== update_parent_by_delete 정의 수 (1 기대) ==="
grep -c "^exports.update_parent_by_delete" mobius/sql_action.js
echo "=== global.usesqlite 는 여전히 index.js 에서만 ==="
grep -rn "global.usesqlite" mobius/db/
```

---

## 이번 범위에서 제외한 것

| 항목 | 이유 |
|------|------|
| `delete_lookup_et` 전환 | 파괴적 스윕이다. 현재 SQLite 모드에서 SELECT 가 MySQL 을 봐서 휴면 중인데, 전환하면 실제 만료 행을 지우기 시작한다. LIMIT 부재·`else` 누락과 겹쳐 있어 별도 회차에서 자체 위험 분석과 함께 다룬다 (2차에서 이것 때문에 전환을 되돌린 이력이 있다). |
| `insert_lookup` 의 `usesqlite` 분기 | **진짜** 분기다 — SQLite 는 `acp` 사전 조회 후 16컬럼, MySQL 은 15컬럼을 넣는다. 스키마 차이를 먼저 정리해야 한다. |
| SQLite 스키마의 `ae.aei` UNIQUE 누락 | 선행 정비에서 발견해 기록했다. 인덱스 추가는 마이그레이션이며, 이미 중복 행을 가진 기존 DB 에서는 실패한다. |
| `tapAdapter` 헬퍼 중복 (이제 3곳) | 공유 모듈로 빼는 것은 2차에서 이미 유예한 항목이다. |
| `update_dvc` 인자 개수 불일치 | 3-파라미터 시그니처에 16개 인자로 호출한다. 죽은 코드이며 master 부터 있던 문제다. |
| `ty=='23'` 분기의 콜백 유실 | 실패 시 콜백을 안 부른다. 별도 항목. |

---

## Self-Review

**1. 결함 커버리지**
- 다중 테이블 UPDATE → SQLite 유실: Task 2(`update_parent_st`), Task 3(`update_parent_by_delete`), Task 5(`update_parent_by_insert`). Task 7 Step 2 가 실측으로 확인한다.
- 중복 정의: Task 1.
- 백엔드 간 의미 불일치: Task 4(`update_cnt_cni` 재계산 제거).
- 비원자성: Task 3·4·5 는 `transaction` 으로 감싸고, Task 6 이 `update_acp`/`update_sub` 를 마저 감싼다.

**2. 플레이스홀더 스캔** — Task 6 Step 4 만 변환 절차를 서술로 적었다. `update_sub` 의 현재 본문이 길고(3205행~) 2차 이후 형태를 그대로 옮겨 적으면 오히려 실제 파일과 어긋날 위험이 커서, 같은 태스크 Step 3 의 `update_acp` 변환을 **완전한 코드로** 보여 주고 5단계 절차로 대응시켰다. 실행자는 Step 4 의 `sed` 로 현재 본문을 먼저 확인한다.

**3. 타입 정합성**
- `tapAdapter(useSqlite)` 는 Task 2 Step 2 에서 정의하고 Task 3·4·5·6 이 그대로 쓴다. 반환은 `{sql_action, seen}`, `seen` 원소는 `{sql, bindings}` (BEGIN/COMMIT 은 `bindings` 없음 — 테스트가 `s.sql` 만 본다).
- `facade` 는 `sql_action.js` 상단에 이미 있는 이름이다(2차에서 도입). 새로 require 하지 않는다 — Task 2 Step 4 착수 전에 `grep -n "require('./db')" mobius/sql_action.js` 로 확인할 것.
- `facade.transaction(conn, body, callback)` 에서 `body(conn, finish)`, `finish(err, result)`. 성공은 `finish(null, r)`, 실패는 `finish(true, err)` — 파사드가 `settled` 로 1회만 정산한다.

**4. 태스크 독립성** — Task 1 은 순수 삭제라 어디서든 먼저 할 수 있다. Task 2 가 `tapAdapter` 를 만들므로 Task 3~6 은 Task 2 뒤에 와야 한다. Task 4 와 5 는 `update_parent_by_insert` → `update_cnt_cni` 호출 관계 때문에 이 순서를 지킨다. Task 6 은 나머지와 독립이다.
