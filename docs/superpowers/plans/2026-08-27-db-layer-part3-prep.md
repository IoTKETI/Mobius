# DB 레이어 추상화 3차 선행 작업 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3차(다중 테이블 UPDATE 원자성) 착수 전에, 전환이 진행될수록 **조용히 깨지는** 세 가지 구조적 결함을 제거한다.

**Architecture:** 세 결함 모두 "구 경로(`db_action`/`db_sqlite`)와 파사드(`mobius/db/`)가 공존하는 전환기"에서만 생기는 문제다. 각각 (1) 에러 어휘를 **양립**시키고, (2) SQLite 파일 경로를 **한 곳**에서 읽고, (3) 파사드 빌더가 **동기 throw 를 내지 않게** 만든다. 어느 것도 기존 동작을 바꾸지 않는다 — 전환된 함수와 전환 안 된 함수가 **같은** 결과를 내도록 맞추는 작업이다.

**Tech Stack:** Node.js (CommonJS, 콜백 스타일), Knex 3.3.0(빌더 전용), node:test, sqlite3 5.1.7, mysql

**Spec:** `docs/superpowers/specs/2026-08-26-db-layer-abstraction-design.md`
(부속 결정 문서: `docs/superpowers/specs/2026-08-26-db-layer-abstraction-decisions.md`, `docs/superpowers/specs/2026-08-27-db-layer-part2-decisions.md`)

## Global Constraints

- **기준 브랜치**: `lite` (`a602faa`). 작업 워크트리: `.claude/worktrees/db-layer-prep3`, 브랜치 `worktree-db-layer-prep3`.
- **`global.usesqlite` 는 `mobius/db/index.js` 에서만 읽는다.** 이 계획의 어떤 태스크도 새 `global.usesqlite` 분기를 추가하지 않는다. (현재 `sql_action.js` 에 34곳이 남아 있으나 이 계획의 범위가 아니다.)
- **콜백 규약**: 성공 `cb(null, result)`, 실패 `cb(true, err)` — 첫 인자는 리터럴 `true`.
- **SELECT 는 맨 배열**을 돌려준다. 쓰기는 `{affectedRows, insertId}`.
- **중립 에러 코드**: `DUPLICATE_KEY` / `FK_VIOLATION` / `NOT_NULL` / `LOCK_CONFLICT` / `LOCK_TIMEOUT` / `UNKNOWN`. 원본은 `err.driverCode` 에 보존. `err.constraint` 는 **부분 문자열 비교 전용**(동등 비교 금지).
- **주석은 한국어**, 기존 코드 스타일(`var`, 함수 선언, 2-space 들여쓰기)을 따른다.
- **금지 사항**: `taskkill /IM node.exe` 실행 금지(무관한 node 프로세스가 떠 있다). 메인 체크아웃(`C:\Users\ryeubi\Documents\Workspace\Mobius`)에서 브랜치 전환 금지(다른 세션이 사용 중). `tools/equivalence/out/`, `tools/golden/out/` 의 기준선 덮어쓰기 금지.
- **테스트 명령**: `npm test` (= `node --test test/*.test.js`).

---

## 배경: 왜 3차보다 먼저인가

3차는 `update_parent_by_delete` / `update_parent_st` / `update_cnt_cni` 를 파사드로 옮긴다. 이들은 **생성/삭제 경로의 핵심**이라 전환 즉시 `resource.js` 의 에러 처리와 부딪힌다. 세 결함을 먼저 없애지 않으면 3차의 실패가 어느 층에서 났는지 구분할 수 없다.

### 결함 1 — 에러 어휘가 갈라져 있다

| 경로 | 중복 키 에러의 `code` |
|------|----------------------|
| `mobius/db_action.js` (MySQL 구 경로) | `ER_DUP_ENTRY` |
| `mobius/db_sqlite.js:83` (SQLite 구 경로, shim) | `ER_DUP_ENTRY` |
| `mobius/db/mysql.js:75`, `mobius/db/sqlite.js` (파사드) | `DUPLICATE_KEY` |

`mobius/resource.js` 에는 `results.code == 'ER_DUP_ENTRY'` 검사가 **29곳**(전부 `create_action` 안, 324~906행) 있고 `DUPLICATE_KEY` 검사는 **0곳**이다.

**29곳을 `DUPLICATE_KEY` 로 "바꾸면" 지금 당장 깨진다.** `insert_lookup` 은 아직 미전환이라 구 경로로 `ER_DUP_ENTRY` 를 낸다. 바꿔 버리면 모든 중복 생성이 409 → 500 이 된다. **바꾸는 게 아니라 둘 다 받아야** 한다.

덤으로 발견된 기존 버그: 409-6(AE-ID 중복) 판정이 `results.message.includes('aei_UNIQUE')` 인데, SQLite 구 경로의 메시지는 `UNIQUE constraint failed: ae.aei` 라 `aei_UNIQUE` 를 포함하지 않는다. **SQLite 모드에서는 AE-ID 중복이 409-6 이 아니라 409-5 로 나간다.** Task 1 에서 함께 고친다.

### 결함 2 — SQLite 파일 경로가 두 곳에서 갈린다

| 파일 | 경로 결정 |
|------|-----------|
| `mobius/db/sqlite.js:22` | `process.env.MOBIUS_SQLITE_PATH \|\| './mobius.db'` |
| `mobius/db_sqlite.js:22` | `'./mobius.db'` **하드코딩** |

`MOBIUS_SQLITE_PATH` 를 설정하면 **파사드는 새 파일, 구 경로는 `./mobius.db`** 를 열어 두 DB 가 동시에 살아 있게 된다. 전환된 함수와 안 된 함수가 서로 다른 파일을 보는 상태다. 테스트 격리(`test/db-facade.test.js:7`)가 이미 이 변수를 쓰고 있어 실제로 발생 가능하다.

### 결함 3 — 파사드 빌더가 동기 throw 를 낸다

호출부는 전부 이 모양이다:

```js
facade.run(facade.k('lookup').update({...}).where(...), conn, callback);
```

`facade.k(...)` 는 **인자로 먼저 평가**되므로 `exports.run` 의 `try` **밖**에서 실행된다. `mobius/db/index.js:56` 의 `assertReady()` 가 던지면 예외가 `sql_action.js` → `resource.js` 로 그대로 올라가 **워커가 죽는다**.

한편 `app.js:155-156` 의 주석은 이렇게 약속한다:

```js
// 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
// 전환 안 된 함수들은 구 경로로 계속 동작한다.
```

**이 약속은 지금 거짓이다.** 파사드 연결이 실패하면 서버는 뜨지만 전환된 함수를 타는 요청마다 워커가 죽는다.

**해결의 핵심 관찰**: Knex 는 **순수 SQL 생성기**다. `knexFactory({client: 'mysql'})` 는 DB 에 접속하지 않는다. `k()`/`raw()` 가 필요한 것은 **방언 이름뿐**이고, 방언은 `pick()`(= `global.usesqlite` 읽기)만으로 정해진다. 따라서 빌더는 **연결 없이도 만들 수 있다**. `k()`/`raw()` 를 지연 초기화로 바꾸면 동기 throw 가 사라지고, 연결 여부 검사는 `run()` 의 `try` **안**으로 들어가 콜백 에러가 된다. 그러면 `app.js` 의 주석이 **참**이 된다.

---

## File Structure

| 파일 | 상태 | 책임 |
|------|------|------|
| `mobius/db/errors.js` | **생성** | DB 에러 술어(predicate) 전용. 의존성 없는 순수 모듈. 전환기 동안 두 어휘를 흡수한다. |
| `test/db-errors.test.js` | **생성** | `mobius/db/errors.js` 단위 테스트. |
| `mobius/resource.js` | 수정 | 29곳의 중복 키 검사 + 1곳의 `aei_UNIQUE` 검사를 술어 호출로 교체. |
| `mobius/db_sqlite.js` | 수정 (22행 부근) | SQLite 파일 경로를 `MOBIUS_SQLITE_PATH` 에서 읽는다. |
| `mobius/db/index.js` | 수정 (20~63행) | 빌더 지연 초기화, `connectCalled` 플래그, `run()` 의 `try` 범위 확장. |
| `app.js` | 수정 (155-163 / 209-217 / 261-269) | 주석을 사실에 맞추고 로그를 명확하게. |
| `test/db-facade.test.js` | 수정 (추가) | 미연결 상태에서 `k()` 가 안 던지고 `run()` 이 콜백으로 실패하는지 검증. |

`mobius/db/errors.js` 를 새로 만드는 이유: 술어는 코드 상수(`error-codes.js` = oneM2M RSC 코드)와 성격이 다르고, `mobius/db/index.js` 에 넣으면 `resource.js` 가 Knex 전체를 끌어오게 된다. 의존성 없는 작은 모듈이 맞다.

---

### Task 1: 에러 어휘 양립 — `mobius/db/errors.js` + `resource.js` 29곳

**Files:**
- Create: `mobius/db/errors.js`
- Create: `test/db-errors.test.js`
- Modify: `mobius/resource.js` (29곳의 `results.code == 'ER_DUP_ENTRY'`, 1곳의 `results.message.includes('aei_UNIQUE')`)

**Interfaces:**
- Consumes: 없음 (이 계획의 첫 태스크)
- Produces:
  - `require('./db/errors').isDuplicateKey(err) -> boolean`
  - `require('./db/errors').isAeiDuplicate(err) -> boolean`
  - Task 3 은 이 모듈을 건드리지 않는다.

- [ ] **Step 1: 기준선 확인 — 현재 테스트가 통과하는지 본다**

Run:
```bash
npm test
```
Expected: PASS (실패 0). 통과 개수를 기록해 둔다 — 이후 단계에서 이 수보다 줄면 안 된다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`test/db-errors.test.js` 를 새로 만든다:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const errors = require('../mobius/db/errors');

test('isDuplicateKey: 구 경로 어휘(ER_DUP_ENTRY)를 받는다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'ER_DUP_ENTRY' }), true);
});

test('isDuplicateKey: 파사드 어휘(DUPLICATE_KEY)를 받는다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'DUPLICATE_KEY' }), true);
});

test('isDuplicateKey: 다른 코드는 거른다', function () {
    assert.strictEqual(errors.isDuplicateKey({ code: 'ER_BAD_NULL_ERROR' }), false);
    assert.strictEqual(errors.isDuplicateKey({ code: 'NOT_NULL' }), false);
    assert.strictEqual(errors.isDuplicateKey({}), false);
});

test('isDuplicateKey: null/undefined 에 안 터진다', function () {
    assert.strictEqual(errors.isDuplicateKey(null), false);
    assert.strictEqual(errors.isDuplicateKey(undefined), false);
});

test('isAeiDuplicate: 파사드 constraint 힌트를 쓴다 (MySQL 8 접두사 제거 후)', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'aei_UNIQUE' }), true);
});

test('isAeiDuplicate: 파사드 constraint 힌트를 쓴다 (SQLite)', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'aei' }), true);
});

test('isAeiDuplicate: constraint 가 다른 제약이면 false', function () {
    assert.strictEqual(errors.isAeiDuplicate({ code: 'DUPLICATE_KEY', constraint: 'ri_UNIQUE' }), false);
});

test('isAeiDuplicate: 구 경로 MySQL 메시지로 판정한다', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry 'Sxxx' for key 'ae.aei_UNIQUE'"
    }), true);
});

// 기존 버그: SQLite 구 경로 메시지에는 'aei_UNIQUE' 가 없어 409-6 판정이 새고 있었다.
test('isAeiDuplicate: 구 경로 SQLite 메시지로도 판정한다', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: ae.aei'
    }), true);
});

test('isAeiDuplicate: 다른 제약의 구 경로 메시지는 false', function () {
    assert.strictEqual(errors.isAeiDuplicate({
        code: 'ER_DUP_ENTRY',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: lookup.ri'
    }), false);
});

test('isAeiDuplicate: null/undefined/빈 객체에 안 터진다', function () {
    assert.strictEqual(errors.isAeiDuplicate(null), false);
    assert.strictEqual(errors.isAeiDuplicate(undefined), false);
    assert.strictEqual(errors.isAeiDuplicate({}), false);
});
```

- [ ] **Step 3: 실패를 확인한다**

Run:
```bash
node --test test/db-errors.test.js
```
Expected: FAIL — `Cannot find module '../mobius/db/errors'`

- [ ] **Step 4: 최소 구현을 쓴다**

`mobius/db/errors.js` 를 새로 만든다:

```js
/**
 * @file DB 에러 술어. 의존성 없는 순수 모듈이다.
 *
 * 전환기 동안 두 어휘가 공존한다.
 *   - 구 경로(db_action.js / db_sqlite.js) : 'ER_DUP_ENTRY'
 *   - 파사드(mobius/db/*.js)               : 'DUPLICATE_KEY'
 * 코어(resource.js)는 어느 쪽이 와도 같게 다뤄야 하므로 여기서 흡수한다.
 * 전환이 끝나면 ER_DUP_ENTRY 가지만 지우면 된다.
 */

'use strict';

exports.isDuplicateKey = function (err) {
    if (!err) { return false; }
    return err.code === 'ER_DUP_ENTRY' || err.code === 'DUPLICATE_KEY';
};

// AE-ID(aei) 중복인지 가린다. 제약 이름은 백엔드마다 다르다 —
// MySQL 5.7 'aei_UNIQUE', MySQL 8 'ae.aei_UNIQUE', SQLite 'ae.aei'.
// 파사드는 접두사를 떼어 err.constraint 에 담아 주므로 그걸 먼저 본다.
// 구 경로는 constraint 가 없어 원본 메시지로 판정한다. 이때 SQLite 메시지는
// 'UNIQUE constraint failed: ae.aei' 라 'aei_UNIQUE' 를 포함하지 않으므로,
// 'aei' 를 제약 이름 경계에서 찾아야 한다.
exports.isAeiDuplicate = function (err) {
    if (!err) { return false; }
    if (err.constraint) { return /(^|[^a-z])aei([^a-z]|$)/i.test(err.constraint); }
    if (typeof err.message !== 'string') { return false; }
    return /(?:key '|failed:\s*)(?:[^'\s.]+\.)?aei(?:[^a-z]|$)/i.test(err.message);
};
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run:
```bash
node --test test/db-errors.test.js
```
Expected: PASS (12 tests)

- [ ] **Step 6: 커밋한다**

```bash
git add mobius/db/errors.js test/db-errors.test.js
git commit -m "feat(db): add neutral duplicate-key predicates for the transition period"
```

- [ ] **Step 7: `resource.js` 의 검사 지점을 세어 둔다**

Run:
```bash
grep -c "results.code == 'ER_DUP_ENTRY'" mobius/resource.js
grep -c "aei_UNIQUE" mobius/resource.js
```
Expected: 각각 `29`, `1`. **다른 수가 나오면 멈추고 보고한다** — 계획이 전제한 코드 상태가 아니다.

- [ ] **Step 8: `resource.js` 에 술어를 들여온다**

`mobius/resource.js` 상단 require 블록의 마지막 `require` 줄 **바로 아래**에 추가한다 (기존 require 들과 같은 스타일):

```js
var db_errors = require('./db/errors');
```

- [ ] **Step 9: 29곳을 일괄 치환한다**

29곳은 **전부 동일한 문자열**이다. 전체 치환:

- 찾을 문자열: `results.code == 'ER_DUP_ENTRY'`
- 바꿀 문자열: `db_errors.isDuplicateKey(results)`

(Edit 도구의 `replace_all: true` 를 쓴다.)

- [ ] **Step 10: `aei_UNIQUE` 검사 1곳을 바꾼다 (359-361행 부근)**

치환 전:
```js
                if (db_errors.isDuplicateKey(results)) {
                    if(results.message.includes('aei_UNIQUE')) {
                        callback('409-6');
                    }
```

치환 후:
```js
                if (db_errors.isDuplicateKey(results)) {
                    if(db_errors.isAeiDuplicate(results)) {
                        callback('409-6');
                    }
```

(Step 9 를 먼저 했으므로 바깥 `if` 는 이미 `db_errors.isDuplicateKey(results)` 형태다.)

- [ ] **Step 11: 잔여물이 없는지 확인한다**

Run:
```bash
grep -n "ER_DUP_ENTRY\|aei_UNIQUE" mobius/resource.js
grep -c "db_errors.isDuplicateKey(results)" mobius/resource.js
node --check mobius/resource.js && echo "syntax OK"
```
Expected: 첫 명령은 **아무것도 출력하지 않는다**. 두 번째는 `29`. 세 번째는 `syntax OK`.

`require('./mobius/resource.js')` 로 로드를 시도하면 안 된다 — `resource.js` 는
`use_secure` / `use_mqtt_broker` 등 `app.js` 가 부팅 시 세팅하는 전역에 의존해서
단독 require 는 기존부터 실패한다. 구문 검사가 올바른 등가물이다.

- [ ] **Step 12: 전체 테스트를 돌린다**

Run:
```bash
npm test
```
Expected: PASS, 통과 개수 = Step 1 의 개수 + 12

- [ ] **Step 13: 커밋한다**

```bash
git add mobius/resource.js
git commit -m "fix(resource): accept both error vocabularies for duplicate keys

전환기에는 구 경로가 ER_DUP_ENTRY, 파사드가 DUPLICATE_KEY 를 낸다.
29곳을 둘 다 받도록 바꿔, insert_lookup 전환 전후 어느 쪽이든 409 를 유지한다.

부수 수정: SQLite 모드에서 AE-ID 중복이 409-6 대신 409-5 로 나가던 문제.
SQLite 의 제약 위반 메시지는 'aei_UNIQUE' 가 아니라 'ae.aei' 형태다."
```

---

### Task 2: SQLite 파일 경로 일원화

**Files:**
- Modify: `mobius/db_sqlite.js:17-22`

**Interfaces:**
- Consumes: 없음 (Task 1 과 독립)
- Produces: 없음 (외부 시그니처 변화 없음). `mobius/db/sqlite.js:22` 와 **같은** 규칙을 쓴다.

- [ ] **Step 1: 두 파일이 실제로 갈라져 있는지 확인한다**

Run:
```bash
grep -n "MOBIUS_SQLITE_PATH\|mobius.db" mobius/db/sqlite.js mobius/db_sqlite.js
```
Expected: `mobius/db/sqlite.js` 는 `MOBIUS_SQLITE_PATH` 를 읽고, `mobius/db_sqlite.js` 는 `'./mobius.db'` 를 하드코딩하고 있다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`test/db-errors.test.js` **아래에 이어서** 추가한다 (별도 파일을 만들지 않는다 — 같은 "전환기 정합성" 주제다):

```js
// --- SQLite 파일 경로 일원화 -------------------------------------------------
// 파사드와 구 경로가 서로 다른 .db 파일을 열면, 전환된 함수와 안 된 함수가
// 다른 DB 를 보게 된다. 두 모듈이 같은 규칙으로 경로를 정해야 한다.
const fs = require('node:fs');
const pathmod = require('node:path');

test('구 경로와 파사드가 같은 규칙으로 SQLite 경로를 정한다', function () {
    const facadeSrc = fs.readFileSync(
        pathmod.join(__dirname, '..', 'mobius', 'db', 'sqlite.js'), 'utf8');
    const legacySrc = fs.readFileSync(
        pathmod.join(__dirname, '..', 'mobius', 'db_sqlite.js'), 'utf8');

    const RULE = /process\.env\.MOBIUS_SQLITE_PATH\s*\|\|\s*'\.\/mobius\.db'/;

    assert.match(facadeSrc, RULE, 'mobius/db/sqlite.js 가 규칙을 벗어났다');
    assert.match(legacySrc, RULE, 'mobius/db_sqlite.js 가 경로를 하드코딩하고 있다');

    // 하드코딩된 './mobius.db' 리터럴은 위 규칙 안에서만 나와야 한다.
    assert.strictEqual((legacySrc.match(/'\.\/mobius\.db'/g) || []).length, 1);
});
```

- [ ] **Step 3: 실패를 확인한다**

Run:
```bash
node --test test/db-errors.test.js
```
Expected: FAIL — `mobius/db_sqlite.js 가 경로를 하드코딩하고 있다`

- [ ] **Step 4: 구현한다**

`mobius/db_sqlite.js` 에서 아래 두 곳을 고친다.

(a) 17-19행의 모듈 상단:

변경 전:
```js
var sqlite3 = require('sqlite3').verbose();

var db = null;
```

변경 후:
```js
var sqlite3 = require('sqlite3').verbose();

// 파사드(mobius/db/sqlite.js)와 반드시 같은 규칙으로 경로를 정해야 한다.
// 서로 다른 파일을 열면 전환된 함수와 안 된 함수가 다른 DB 를 보게 된다.
var DB_PATH = process.env.MOBIUS_SQLITE_PATH || './mobius.db';

var db = null;
```

(b) 22행의 `connect`:

변경 전:
```js
    db = new sqlite3.Database('./mobius.db', (err) => {
```

변경 후:
```js
    db = new sqlite3.Database(DB_PATH, (err) => {
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run:
```bash
node --test test/db-errors.test.js
```
Expected: PASS (13 tests)

- [ ] **Step 6: 실제로 같은 파일을 여는지 눈으로 확인한다**

Run:
```bash
MOBIUS_SQLITE_PATH=./tmp-prep3.db node -e "
var legacy = require('./mobius/db_sqlite.js');
legacy.connect(function (rsc) {
  console.log('legacy connect rsc =', rsc);
  var fs = require('fs');
  console.log('tmp-prep3.db 생성됨 =', fs.existsSync('./tmp-prep3.db'));
  console.log('mobius.db 새로 생기지 않음 =', !fs.existsSync('./mobius.db'));
  process.exit(0);
});
"
rm -f ./tmp-prep3.db
```
Expected: `tmp-prep3.db 생성됨 = true`, `mobius.db 새로 생기지 않음 = true`

(워크트리에 `mobius.db` 가 이미 있다면 마지막 줄은 `false` 가 정상이다 — 그 경우 `tmp-prep3.db 생성됨 = true` 만 확인하면 된다.)

- [ ] **Step 7: 전체 테스트 후 커밋한다**

```bash
npm test
git add mobius/db_sqlite.js test/db-errors.test.js
git commit -m "fix(db): read MOBIUS_SQLITE_PATH in the legacy sqlite module too

구 경로가 './mobius.db' 를 하드코딩하고 있어, MOBIUS_SQLITE_PATH 를 주면
파사드와 서로 다른 DB 파일을 열었다. 전환된 함수와 안 된 함수가 같은
파일을 보도록 규칙을 일원화한다."
```

---

### Task 3: 파사드 빌더의 동기 throw 제거

**Files:**
- Modify: `mobius/db/index.js:20-63` (+ `exports.run`)
- Modify: `app.js:155-163`, `app.js:209-217`, `app.js:261-269`
- Test: `test/db-facade.test.js` (기존 파일에 추가)

**Interfaces:**
- Consumes: 없음 (Task 1, 2 와 독립)
- Produces:
  - `db.k(table)` — **`connect()` 호출 전에도 던지지 않는다.** 방언은 `global.usesqlite` 로 정해진다.
  - `db.raw(sql, bindings)` — 동일.
  - `db.run(qb, conn, callback)` — 미연결 상태면 `callback(true, {code:'UNKNOWN', message:'[db] connect() has not been called'})`. **던지지 않는다.**
  - `db.getConnection(cb)`, `db.release(h)` — 기존대로 미연결 시 동기 throw(호출부는 `app.js` 기동 경로뿐이고 거기서 잡는다).
  - `db._adapterName()` — 기존 테스트가 쓰는 헬퍼. 시그니처 유지.

- [ ] **Step 1: 문제를 재현하는 테스트를 쓴다**

`test/db-facade.test.js` **맨 끝에** 추가한다 (파일 상단의 `freshDb()` 헬퍼를 그대로 쓴다):

```js
// --- 미연결 상태 방어 --------------------------------------------------------
// 호출부는 facade.run(facade.k('t')..., conn, cb) 형태다. k() 는 인자로 먼저
// 평가되므로 run() 의 try 밖에서 실행된다. 여기서 동기 throw 가 나면 예외가
// sql_action -> resource 로 올라가 워커를 죽인다. 콜백 에러가 되어야 한다.

test('미연결: k() 는 던지지 않고 빌더를 준다', function () {
    const db = freshDb(false);
    assert.doesNotThrow(function () {
        const n = db.k('lookup').select('ri').where('sri', 'x').toSQL().toNative();
        assert.match(n.sql, /^select `ri` from `lookup`/);
    });
});

test('미연결: raw() 도 던지지 않는다', function () {
    const db = freshDb(true);
    assert.doesNotThrow(function () { db.raw('select 1'); });
});

test('미연결: run() 은 던지지 않고 콜백으로 실패를 알린다', function (t, done) {
    const db = freshDb(false);
    let threw = false;
    try {
        db.run(db.k('lookup').select('ri'), {}, function (err, res) {
            assert.strictEqual(err, true);
            assert.ok(res);
            assert.match(String(res.message), /connect\(\) has not been called/);
            assert.strictEqual(threw, false);
            done();
        });
    } catch (e) {
        threw = true;
        done(e);
    }
});

test('미연결이어도 방언은 usesqlite 를 따른다', function () {
    let db = freshDb(false);
    assert.strictEqual(db._adapterName(), 'mysql');
    db = freshDb(true);
    assert.strictEqual(db._adapterName(), 'sqlite');
});

test('연결 후에는 run() 이 정상 동작한다 (회귀 방지)', function (t, done) {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function (rsc) {
        assert.strictEqual(rsc, '1');
        db.getConnection(function (code, conn) {
            assert.strictEqual(code, '200');
            db.run(db.raw('select 1 as one'), conn, function (err, rows) {
                assert.strictEqual(err, null);
                assert.ok(Array.isArray(rows));
                assert.strictEqual(rows[0].one, 1);
                db.release(conn);
                done();
            });
        });
    });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run:
```bash
node --test test/db-facade.test.js
```
Expected: FAIL — `미연결: k() 는 던지지 않고 빌더를 준다` 에서 `[db] connect() has not been called` 로 throw. `미연결이어도 방언은 usesqlite 를 따른다` 도 실패(`_adapterName()` 이 `null` 계열을 반환).

- [ ] **Step 3: 파사드를 고친다 — 지연 초기화**

`mobius/db/index.js` 의 20-30행을 바꾼다.

변경 전:
```js
var knexInstance = null;

function pick() {
    return global.usesqlite === 'true' ? ADAPTERS.sqlite : ADAPTERS.mysql;
}

function assertReady() {
    if (!adapter || !knexInstance) {
        throw new Error('[db] connect() has not been called');
    }
}
```

변경 후:
```js
var knexInstance = null;
var connectCalled = false;

function pick() {
    return global.usesqlite === 'true' ? ADAPTERS.sqlite : ADAPTERS.mysql;
}

// Knex 는 순수 SQL 생성기다 — knexFactory() 는 DB 에 접속하지 않는다.
// 빌더에 필요한 건 방언 이름뿐이고, 방언은 pick() 만으로 정해진다.
// 그래서 connect() 전에도 빌더는 만들 수 있다. 이렇게 해야 k()/raw() 가
// 동기 throw 를 내지 않는다 — 호출부가 facade.run(facade.k(...), ...) 형태라
// k() 의 예외는 run() 의 try 를 우회해 워커를 죽인다.
function builder() {
    if (!knexInstance) {
        adapter = adapter || pick();
        knexInstance = knexFactory({ client: adapter.knexClient, useNullAsDefault: true });
    }
    return knexInstance;
}

// 실제 연결이 필요한 지점에서만 쓴다. builder() 가 adapter 를 채울 수 있으므로
// adapter 존재 여부로는 판단할 수 없다 — connect() 호출 자체를 기록한다.
function assertReady() {
    if (!connectCalled) {
        throw new Error('[db] connect() has not been called');
    }
}
```

- [ ] **Step 4: `connect` / `k` / `raw` 를 고친다**

`mobius/db/index.js` 의 32-63행을 바꾼다.

변경 전:
```js
exports.connect = function (host, port, user, password, callback) {
    adapter = pick();
    knexInstance = knexFactory({ client: adapter.knexClient, useNullAsDefault: true });
```

변경 후:
```js
exports.connect = function (host, port, user, password, callback) {
    adapter = pick();
    knexInstance = null;   // 백엔드가 바뀌었을 수 있으니 빌더를 다시 만든다
    builder();
    connectCalled = true;
```

(같은 함수의 나머지 — `if (!adapter.capabilities.transaction) {...}` 부터 `adapter.connect(...)` 까지 — 는 그대로 둔다.)

이어서 `k` 와 `raw` 를 바꾼다.

변경 전:
```js
// 빌더 진입점. sql_action.js 는 db.k('table')... 로 쿼리를 만든다.
exports.k = function (table) {
    assertReady();
    return knexInstance(table);
};

exports.raw = function (sql, bindings) {
    assertReady();
    return bindings === undefined ? knexInstance.raw(sql) : knexInstance.raw(sql, bindings);
};
```

변경 후:
```js
// 빌더 진입점. sql_action.js 는 db.k('table')... 로 쿼리를 만든다.
// assertReady() 를 부르지 않는다 — Step 3 의 주석 참고. 연결 검사는 run() 이 한다.
exports.k = function (table) {
    return builder()(table);
};

exports.raw = function (sql, bindings) {
    var kx = builder();
    return bindings === undefined ? kx.raw(sql) : kx.raw(sql, bindings);
};
```

`exports.getConnection` 과 `exports.release` 의 `assertReady()` 는 **그대로 둔다** — 호출부가 `app.js` 기동 경로뿐이고 거기서 예외를 잡는다.

- [ ] **Step 5: `run()` 의 `try` 범위를 넓힌다**

`mobius/db/index.js` 의 `exports.run` 을 바꾼다.

변경 전:
```js
exports.run = function (qb, conn, callback) {
    assertReady();
    var native;
    try {
        native = qb.toSQL().toNative();
    } catch (e) {
        return callback(true, adapter.normalizeError(e));
    }
```

변경 후:
```js
exports.run = function (qb, conn, callback) {
    var native;
    try {
        assertReady();
        native = qb.toSQL().toNative();
    } catch (e) {
        // adapter 가 없을 수도 있다(connect() 전 + k() 도 안 불린 경우).
        return callback(true, adapter ? adapter.normalizeError(e)
                                      : { code: 'UNKNOWN', message: e.message });
    }
```

(`adapter.execute(...)` 이하는 그대로 둔다.)

- [ ] **Step 6: 테스트 통과를 확인한다**

Run:
```bash
node --test test/db-facade.test.js
```
Expected: PASS — 새로 넣은 5개 포함 전부 통과

- [ ] **Step 7: `app.js` 의 주석을 사실에 맞춘다 (3곳)**

이제 파사드 연결이 실패해도 워커가 죽지 않고 요청이 에러 응답을 받는다. 주석의 약속이 참이 되었으므로 문구를 정확하게 고치고 로그를 눈에 띄게 만든다.

**세 곳 모두** 아래 블록을 찾는다 (`app.js:155-163`, `209-217`, `261-269` — 완전히 동일한 7줄):

변경 전:
```js
                // 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
                // 전환 안 된 함수들은 구 경로로 계속 동작한다.
                try {
                    db_facade.connect(usedbhost, 3306, 'root', usedbpass, (rsc2) => {
                        if (rsc2 !== '1') { console.error('[db_facade] connect failed: ' + rsc2); }
                    });
                } catch (e) {
                    console.error('[db_facade] connect threw: ' + (e.message || e));
                }
```

변경 후:
```js
                // 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
                // 전환 안 된 함수들은 구 경로로 계속 동작하고, 전환된 함수는
                // db.run() 이 콜백으로 에러를 돌려준다(워커는 죽지 않는다).
                try {
                    db_facade.connect(usedbhost, 3306, 'root', usedbpass, (rsc2) => {
                        if (rsc2 !== '1') {
                            console.error('[db_facade] connect failed (' + rsc2 +
                                ') — 전환된 DB 함수는 전부 실패한다');
                        }
                    });
                } catch (e) {
                    console.error('[db_facade] connect threw (' + (e.message || e) +
                        ') — 전환된 DB 함수는 전부 실패한다');
                }
```

들여쓰기는 각 위치의 기존 들여쓰기를 그대로 따른다 (261-269행 블록은 한 단계 얕다 — 실제 파일을 보고 맞춘다).

- [ ] **Step 8: 세 곳이 다 바뀌었는지 확인한다**

Run:
```bash
grep -c "전환된 DB 함수는 전부 실패한다" app.js
node -e "require('./app.js')" 2>&1 | head -5 || true
```
Expected: 첫 명령은 `6` (3곳 × 2줄). 두 번째는 문법 오류가 없어야 한다(DB 연결 실패 로그는 정상).

- [ ] **Step 9: 전체 테스트를 돌린다**

Run:
```bash
npm test
```
Expected: PASS, 실패 0

- [ ] **Step 10: 커밋한다**

```bash
git add mobius/db/index.js app.js test/db-facade.test.js
git commit -m "fix(db): stop the facade builder from throwing synchronously

호출부는 facade.run(facade.k(...), conn, cb) 형태라 k() 가 인자로 먼저
평가된다. k() 의 assertReady() 예외는 run() 의 try 를 우회해 resource.js 까지
올라가 워커를 죽였다.

Knex 는 순수 SQL 생성기라 연결 없이도 빌더를 만들 수 있다. k()/raw() 를
지연 초기화로 바꾸고, 연결 검사를 run() 의 try 안으로 옮겨 콜백 에러로
만든다. 이제 app.js 의 '기동을 막지 않는다' 주석이 실제로 참이다."
```

---

### Task 4: 통합 검증

**Files:**
- Modify: 없음 (검증 전용). 실패가 나오면 해당 태스크로 돌아간다.

**Interfaces:**
- Consumes: Task 1 의 `db_errors.isDuplicateKey` / `isAeiDuplicate`, Task 2 의 `DB_PATH`, Task 3 의 지연 빌더
- Produces: 없음

- [ ] **Step 1: 전체 단위 테스트**

Run:
```bash
npm test
```
Expected: PASS, 실패 0

- [ ] **Step 2: SQLite 모드로 서버를 띄운다**

SQLite 모드는 환경변수가 아니라 **`mobius.js` 의 첫 인자**로 켠다 (`mobius.js:41`).

Run (백그라운드):
```bash
MOBIUS_SQLITE_PATH=./prep3-verify.db node mobius.js sqlite
```

30초 안에 `http://127.0.0.1:7579/Mobius` 가 응답해야 한다. 확인:
```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'X-M2M-Origin: SOrigin' -H 'X-M2M-RI: rdy' -H 'Accept: application/json' \
  http://127.0.0.1:7579/Mobius
```
Expected: `200`

- [ ] **Step 3: 중복 생성이 409 를 유지하는지 본다 (Task 1 의 핵심)**

Run:
```bash
AE=prep3ae$$
for i in 1 2; do
  curl -s -o /dev/null -w "try$i -> %{http_code}\n" -X POST \
    -H 'X-M2M-Origin: SOrigin' -H 'X-M2M-RI: dup'$i \
    -H 'Content-Type: application/json;ty=2' \
    -d '{"m2m:ae":{"rn":"'$AE'","api":"0.2.481.2.0001.001.000111","rr":true}}' \
    http://127.0.0.1:7579/Mobius
done
```
Expected:
```
try1 -> 201
try2 -> 409
```
**`try2` 가 500 이면 Task 1 이 깨진 것이다** — 멈추고 보고한다.

- [ ] **Step 4: AE-ID 중복이 409-6 으로 나가는지 본다 (Task 1 의 부수 수정)**

같은 `api`/`rn` 이 아니라 **같은 AE-ID** 로 두 번 만든다:

```bash
for i in 1 2; do
  curl -s -X POST \
    -H 'X-M2M-Origin: Sprep3aei' -H 'X-M2M-RI: aei'$i \
    -H 'Content-Type: application/json;ty=2' \
    -d '{"m2m:ae":{"rn":"prep3aei'$i'","api":"0.2.481.2.0001.001.000111","rr":true}}' \
    http://127.0.0.1:7579/Mobius | head -c 200
  echo
done
```
Expected: 두 번째 응답의 `rsc` 가 **`4105`**(CONFLICT / 409-6 계열). 수정 전 SQLite 모드에서는 409-5 계열이 나갔다. `rsc` 가 무엇이든 **HTTP 409** 이면 최소 요건은 충족이다 — 실제 값을 기록해 보고한다.

- [ ] **Step 5: 등가성 시나리오 하네스를 돌린다**

Run:
```bash
node tools/equivalence/run-scenarios.js
```
Expected: 32단계 전부 통과, 종료 코드 0.

**주의**: `tools/equivalence/out/` 의 기존 기준선을 덮어쓰지 않는다. 하네스가 기준선을 쓰려 하면 출력 경로를 스크래치패드로 돌린다.

- [ ] **Step 6: 서버를 내리고 산출물을 지운다**

**`taskkill /IM node.exe` 금지.** 커맨드라인에 `mobius` 가 들어간 PID 만 종료한다:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*mobius*' } |
  ForEach-Object { Write-Host "kill $($_.ProcessId): $($_.CommandLine)"; Stop-Process -Id $_.ProcessId -Force }
```

그다음:
```bash
rm -f ./prep3-verify.db
git status --porcelain
```
Expected: `git status` 가 깨끗하다(추적되지 않는 `.db` 파일이 남지 않았다).

- [ ] **Step 7: 결과를 정리해 보고한다**

세 결함이 실제로 해소되었는지 한 줄씩 확인한다:

```bash
echo "1. resource.js ER_DUP_ENTRY 잔여:"; grep -c "ER_DUP_ENTRY" mobius/resource.js || echo 0
echo "2. db_sqlite.js 하드코딩 경로:"; grep -c "sqlite3.Database('./mobius.db'" mobius/db_sqlite.js || echo 0
echo "3. index.js k() 의 assertReady:"; sed -n '/^exports.k = /,/^};/p' mobius/db/index.js
echo "--- global.usesqlite 는 여전히 index.js 에서만 ---"
grep -rn "global.usesqlite" mobius/db/
```
Expected: `1.` 은 `0`, `2.` 는 `0`, `3.` 의 본문에 `assertReady` 가 없다, 마지막은 `mobius/db/index.js` 한 파일만 나온다.

---

## 검증 중 발견 — SQLite 스키마에 `aei` UNIQUE 제약이 없다

Task 4 Step 4 를 실측하다 **기존 스키마 분기**를 찾았다. 이 계획의 범위 밖이지만
기록해 둔다.

| 스키마 | `ae.aei` 제약 |
|--------|---------------|
| `mobius/mobiusdb.sql:55` | `UNIQUE KEY aei_UNIQUE (aei)` |
| `mobius/mobiusdb_sqlite.sql:55` | `aei TEXT NOT NULL` — **UNIQUE 없음** |

실측: SQLite 모드에서 같은 `X-M2M-Origin` 으로 AE 를 두 번 만들면 **둘 다 201** 이고
`ae` 테이블에 `aei='Sprep3aei'` 행이 2개 공존한다. MySQL 모드라면 409 다.

즉 **SQLite 모드에서는 409-6 경로 자체가 도달 불가능**하다. Task 1 의
`isAeiDuplicate` 수정이 틀린 게 아니라, SQLite 에서는 제약이 없어 에러가
애초에 발생하지 않는다. 그래서 Step 4 는 MySQL 모드에서 검증한다.

**고치지 않은 이유**: UNIQUE 인덱스 추가는 스키마 마이그레이션이다. 이미 중복
`aei` 행을 갖고 있는 기존 SQLite DB 에서는 인덱스 생성이 실패한다. 선행 정비의
범위를 넘고, 별도 판단이 필요하다.

---

## 3차에 넘기는 항목 (이 계획의 범위 밖)

이 계획은 **선행 정비만** 한다. 아래는 3차 계획에서 다룬다:

- `update_parent_by_delete` (**중복 정의 2개**), `update_parent_st`, `update_cnt_cni` 의 다중 테이블 UPDATE 원자성
- `delete_lookup_et` — 전환 **전에** `LIMIT` 누락, `else` 누락, `'200'` 정규화를 먼저 고쳐야 한다 (2차에서 전환했다가 휴면 상태이던 파괴적 스윕을 깨워 되돌린 이력이 있다)
- `update_acp` / `update_sub` 의 비원자성
- `insert_lookup` 의 `global.usesqlite` 분기 (SQLite 가 `acp` 사전 조회 후 16컬럼, MySQL 이 15컬럼 — **진짜** 분기다)
- 3차 계획을 쓸 때 낡은 "28단계" 기대치를 고칠 것: 하네스는 이제 **32단계**다. `test/converted-queries.test.js:16` 도 같이 본다.

---

## Self-Review

**1. 결함 커버리지**
- 결함 1(에러 어휘) → Task 1. 29곳 + `aei_UNIQUE` 1곳 + 단위 테스트 12개 + Task 4 Step 3/4 의 실측 검증.
- 결함 2(SQLite 경로) → Task 2. 소스 검사 테스트 + Task 2 Step 6 의 실제 파일 생성 확인.
- 결함 3(동기 throw) → Task 3. 미연결 상태 테스트 5개 + `app.js` 주석 정합.

**2. 플레이스홀더 스캔** — "TBD"/"적절히 처리"류 없음. 모든 코드 단계에 실제 코드가 들어 있다.

**3. 타입 정합성**
- Task 1 이 만드는 이름: `isDuplicateKey`, `isAeiDuplicate`. Task 1 Step 9/10 과 Task 4 Step 7 에서 같은 이름을 쓴다.
- Task 3 이 만드는 이름: `builder()`, `connectCalled`. `assertReady()` 는 이름을 유지하되 의미가 "connect() 가 불렸는가"로 좁아진다 — `getConnection`/`release` 의 기존 호출은 그대로 유효하다.
- `db._adapterName()` 은 기존 테스트가 쓰므로 시그니처를 건드리지 않는다. Task 3 Step 3 의 `builder()` 가 `adapter` 를 채우므로 미연결 상태에서도 올바른 이름을 돌려준다 — Task 3 Step 1 의 네 번째 테스트가 이를 고정한다.

**4. 태스크 독립성** — Task 1/2/3 은 서로 다른 파일을 건드리며 의존이 없다. 순서대로 하되, 리뷰어가 하나만 반려해도 나머지는 유효하다. Task 4 만 셋 다에 의존한다.
