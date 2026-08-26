# DB 접근 계층 추상화 구현 계획 (2/N) — SQLite 실버그 + SQL Injection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLite 모드에서 조용히 깨져 있던 함수 9개를 파사드로 전환해 실제로 동작하게 만들고, 그 과정에서 기존 SQL Injection 2건을 제거한다.

**Architecture:** 1차분이 만든 Knex 파사드(`mobius/db/`)로 대상 함수를 전환한다. 값은 전부 바인딩으로 가므로 수동 이스케이프가 사라지고, `db.run()`이 백엔드를 고르므로 SQLite 모드에서 MySQL로 새던 쿼리가 제 위치로 간다. 함수 시그니처와 콜백 계약은 그대로 둔다.

**Tech Stack:** Node.js v24 · knex 3.3.0 · mysql 2.x · sqlite3 5.x · `node:test`

**Spec:** `docs/superpowers/specs/2026-08-26-db-layer-abstraction-design.md`
**분류 근거:** `docs/superpowers/specs/2026-08-26-branch-classification.md`
**1차분 결정 기록:** `docs/superpowers/specs/2026-08-26-db-layer-abstraction-decisions.md` — **착수 전 Ruling 17·20·22·24를 읽을 것**

## Global Constraints

- **콜백 계약 보존.** 성공 `cb(null, result)`, 실패 `cb(true, err)` — 실패 시 첫 인자가 `true`, 둘째가 에러 객체.
- **SELECT 결과는 배열 그대로.** 객체로 감싸지 않는다.
- **함수 시그니처 유지.** 호출부를 건드리지 않는다 (에러 어휘 수정은 예외 — 아래 참조).
- **`console.time`/`console.timeEnd` 라벨 유지.**
- **에러 어휘를 같은 커밋에서 함께 고친다 (Ruling 17).** 파사드는 `err.code`를 중립 코드(`DUPLICATE_KEY` 등)로 덮어쓴다. 전환한 함수의 에러를 받는 `mobius/resource.js` 검사를 같은 커밋에서 함께 바꾼다. 원본은 `err.driverCode`, 제약 힌트는 `err.constraint`(**부분 문자열 비교**).
- **`SQLITE-DEAD` 전환은 동작 변경이다 (Ruling 20).** 동등성 스냅샷에 차이가 나타나는 것이 정상이다 — 깨져 있던 것이 고쳐지므로. 차이가 없으면 오히려 의심하라.
- **실패 경로를 최소 1회 밟는다 (Ruling 18).** 성공 경로만 도는 시나리오로는 새로 쓴 에러 분기가 검증되지 않는다.
- **매 단계 배포 가능.** 전환 안 된 함수는 기존 경로를 쓴다.
- **`db_action.js`/`db_sqlite.js`를 지우지 않는다.** 아직 다수 함수가 쓴다.
- **작업 브랜치:** `worktree-db-layer-part2` (worktree `.claude/worktrees/db-layer-part2`). 메인 체크아웃은 다른 세션이 쓰므로 **이 디렉터리를 벗어나지 않는다.** 브랜치 전환 금지.
- **`taskkill /IM node.exe` 금지.** 무관한 node 프로세스가 돌고 있다. `mobius`를 실행 중인 PID만 종료한다.

## 이번 범위에서 제외한 것

`update_parent_by_delete`(L3425·L3457 중복 정의), `update_parent_st`(L3441)는 `SQLITE-DEAD`지만 **다중 테이블 UPDATE**를 쓴다.

```sql
update cnt, lookup set cnt.cni = cnt.cni-1, ... where lookup.ri = '...' and cnt.ri = '...'
```

SQLite는 이 문법을 지원하지 않으므로 순차 문장으로 쪼개야 하고, 그건 **원자성 변경**이다. 같은 성격의 `update_cnt_cni`(REVIEW)와 함께 별도 계획에서 설계한다.

`delete_lookup_et`(L3568)는 이 계획에서 전환했다가 최종 리뷰에서 **되돌렸다(revert)**. 이유:

1. **SELECT 에 상한이 없다.** 형제 `delete_orphan_lookup`(L3595)은 `LIMIT 1000`을 쓰고 "라이브 트래픽 중 락 시간이 짧다"는 주석을 남겼는데, `delete_lookup_et`는 그 규율 없이 만료 행 전체를 SELECT한다.
2. **전환이 휴면 중이던 파괴적 경로를 깨운다.** 전환 전에는 SELECT가 무조건 MySQL로 나가 SQLite 배포에서 사실상 아무 것도 하지 않았다. 전환하면 SQLite에서 실제 만료 행을 가져오고, **미전환** 상태인 `delete_lookup`이 그 행들을 실제로 지운다 — 상한 없는 SELECT + 무제한 삭제 조합이 그대로 라이브에 나간다.
3. **행마다 순차 DELETE + `console.log`.** `delete_lookup`은 행 단위로 DELETE 1건과 로그 1줄을 순차 실행하므로, 단일 SQLite 쓰기 핸들에서 락 스톰을 일으킬 수 있다.
4. **작업 집합이 줄지 않는다.** `delete_lookup`은 만료된 lookup 행의 *자식*만 지우고 만료 행 자체는 지우지 않으므로, 다음 `setInterval` 주기에도 같은 SELECT가 같은(혹은 더 많은) 행을 다시 퍼올린다.
5. **SELECT 실패 시 콜백이 아예 호출되지 않는다.** `if (!err) { ... }`에 `else`가 없다. `app.js:112`의 `connection.release()`가 콜백 안에서만 실행되므로 SELECT 에러 시 커넥션이 샌다.
6. **성공 신호가 왜곡돼 있다.** `delete_lookup`이 성공을 `callback('200')`으로 알리는데 `'200'`은 truthy라 `app.js:107`의 `if (!err)`가 항상 거짓으로 평가된다.
7. **관측 창이 24시간이다.** 이 경로는 `setInterval` 24시간 주기로 돌아 **배포 24시간 뒤 마스터에서만** 처음 발화한다. 동등성 하네스나 수동 curl 검증 어느 것도 이 경로를 24시간 안에 건드리지 않으므로, 상한·`else`·`'200'` 정규화 없이 전환만 하면 문제가 있어도 드러나지 않는다.

상한(`LIMIT`) 추가, `else` 분기, `'200'` truthy 문제 정규화는 그 자체로 설계가 필요한 별도 수정이며 이 전환 작업에 끼워 넣을 것이 아니다. 3차 계획에서 `delete_orphan_lookup`과 같은 규율(배치 상한 + 에러 시 콜백 보장)로 다시 설계한다.

---

## Task 1: `update_lookup` + `update_acp` — SQL Injection 2건 + Critical 버그

두 함수는 호출로 엮여 있다(`update_acp`가 `update_lookup`을 부른다). 함께 전환한다.

**현재 결함:**
- `update_lookup`(L2679) MySQL 경로가 `lbl`만 이스케이프하고 **`acpi`/`at`/`aa`/`subl`은 날것**으로 SQL에 박는다 → SQL Injection
- `update_acp`(L2671)의 `sql2`가 `pv`/`pvs`를 **양쪽 경로 모두 이스케이프 없이** 박는다 → SQL Injection. `pv`는 클라이언트가 보내는 ACP 정책이다
- `update_acp`의 `sql2`가 `db.getResult`를 **무조건** 호출한다 → SQLite 모드에서 `update_lookup`은 SQLite에 쓰는데 `acp` 본문은 MySQL로 간다. `select_acp`는 SQLite에서 읽으므로 **ACP 정책 갱신이 조용히 유실된다**

**Files:**
- Modify: `mobius/sql_action.js` (`update_lookup` L2679, `update_acp` L2699 — 각 함수 전체를 교체)
- Test: `test/sqli-regression.test.js` (신규)

**Interfaces:**
- Consumes: `facade.k(table)`, `facade.run(qb, conn, cb)` — 1차분 `mobius/db/index.js`
- Produces: `exports.update_lookup(connection, obj, callback)`, `exports.update_acp(connection, obj, callback)` — 시그니처 불변

- [ ] **Step 1: SQL Injection 회귀 테스트를 먼저 쓴다**

`test/sqli-regression.test.js`:

```js
'use strict';
// 전환된 함수가 값을 바인딩으로 넘기는지 확인한다.
// 문자열 보간이면 따옴표가 SQL 구조를 깨뜨리고, 바인딩이면 값으로만 남는다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');
process.env.MOBIUS_SQLITE_PATH = path.join(require('node:os').tmpdir(), 'mobius-sqli-test.db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

// ACP 정책에 따옴표가 섞여 들어와도 SQL 구조가 깨지지 않아야 한다.
const EVIL = '{"acr":[{"acor":["a\'); drop table acp; --"],"acop":63}]}';

test('update_acp 의 pv 는 바인딩으로 나간다 (MySQL)', function () {
    const db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    const n = db.k('acp').update({ pv: EVIL, pvs: '{}' }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0, 'SQL 본문에 값이 박히면 안 된다');
    assert.ok(n.bindings.indexOf(EVIL) >= 0, '값은 바인딩으로 가야 한다');
});

test('update_acp 의 pv 는 바인딩으로 나간다 (SQLite)', function () {
    const db = freshDb(true);
    db.connect('h', 1, 'u', 'p', function () {});
    const n = db.k('acp').update({ pv: EVIL, pvs: '{}' }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0);
    assert.ok(n.bindings.indexOf(EVIL) >= 0);
});

test('update_lookup 의 acpi/at/aa/subl 이 바인딩으로 나간다', function () {
    const db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    const n = db.k('lookup').update({
        lt: '20260826T000000', acpi: EVIL, et: '20280826T000000', st: 1,
        lbl: '[]', at: '[]', aa: '[]', subl: '[]'
    }).where({ ri: '/M/a' }).toSQL().toNative();
    assert.ok(n.sql.indexOf('drop table') < 0);
    assert.ok(n.bindings.indexOf(EVIL) >= 0);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
node --test test/sqli-regression.test.js
```

기대: 3종 모두 PASS. **여기서 통과하는 것이 정상이다** — 파사드는 이미 바인딩을 쓰기 때문이다. 이 테스트는 전환 후에도 그 성질이 유지되는지 잠그는 회귀 테스트다. 실패하면 파사드가 깨진 것이니 멈추고 보고하라.

- [ ] **Step 3: `update_lookup` 을 전환한다**

`exports.update_lookup = function (...) { ... };` 전체를 교체:

```js
exports.update_lookup = function (connection, obj, callback) {
    facade.run(facade.k('lookup').update({
        lt: obj.lt,
        acpi: JSON.stringify(obj.acpi),
        et: obj.et,
        st: obj.st,
        lbl: JSON.stringify(obj.lbl),
        at: JSON.stringify(obj.at),
        aa: JSON.stringify(obj.aa),
        subl: JSON.stringify(obj.subl)
    }).where({ ri: obj.ri }), connection, function (err, results) {
        callback(err, results);
    });
};
```

`global.usesqlite` 분기와 두 이스케이프 체인이 모두 사라진다.

- [ ] **Step 4: `update_acp` 를 전환한다**

`exports.update_acp = function (...) { ... };` 전체를 교체:

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

- [ ] **Step 5: 문법 검사와 단위 테스트**

```bash
node --check mobius/sql_action.js
node --test test/
```

기대: 문법 통과, 테스트 18/18 (기존 15 + 신규 3)

- [ ] **Step 6: SQLite 모드에서 버그가 실제로 고쳐졌는지 확인한다**

이게 이 태스크의 핵심 증거다. **전환 전에는 실패하고 전환 후에는 성공해야 한다.**

포트가 비었는지 먼저 확인하고 서버를 띄운다:

```bash
node mobius.js sqlite > /tmp/t1.log 2>&1 &
sleep 12
grep -c "running at" /tmp/t1.log
```

ACP를 만들고 → 수정하고 → 다시 읽어 **수정이 반영됐는지** 본다:

```bash
AE=acpfix_$(date +%s)
B=http://127.0.0.1:7579

curl -s -o /dev/null -w "AE: %{http_code}\n" -X POST \
  -H "X-M2M-RI: a" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Content-Type: application/vnd.onem2m-res+json;ty=2" \
  -d "{\"m2m:ae\":{\"rn\":\"$AE\",\"api\":\"0.2.481.2.0001.001.000111\",\"rr\":\"true\"}}" "$B/Mobius"

curl -s -o /dev/null -w "ACP 생성: %{http_code}\n" -X POST \
  -H "X-M2M-RI: b" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Content-Type: application/vnd.onem2m-res+json;ty=1" \
  -d "{\"m2m:acp\":{\"rn\":\"acp_$AE\",\"pv\":{\"acr\":[{\"acor\":[\"C$AE\"],\"acop\":63}]},\"pvs\":{\"acr\":[{\"acor\":[\"C$AE\"],\"acop\":63}]}}}" "$B/Mobius"

echo "--- 수정 전 pv ---"
curl -s -H "X-M2M-RI: c" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Accept: application/json" "$B/Mobius/acp_$AE" | grep -o '"acop":[0-9]*'

curl -s -o /dev/null -w "ACP 수정(acop 63->51): %{http_code}\n" -X PUT \
  -H "X-M2M-RI: d" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Content-Type: application/vnd.onem2m-res+json" \
  -d "{\"m2m:acp\":{\"pv\":{\"acr\":[{\"acor\":[\"C$AE\"],\"acop\":51}]}}}" "$B/Mobius/acp_$AE"

echo "--- 수정 후 pv (51 이어야 함) ---"
curl -s -H "X-M2M-RI: e" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Accept: application/json" "$B/Mobius/acp_$AE" | grep -o '"acop":[0-9]*'
```

기대: 마지막 조회의 `pv` 쪽 `acop`이 **51**. 전환 전이면 63 그대로였을 것이다(갱신이 MySQL로 새서).

**63이 나오면 전환이 안 먹은 것이니 멈추고 보고하라.**

정리하고 서버를 내린다:

```bash
curl -s -o /dev/null -X DELETE -H "X-M2M-RI: f" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" "$B/Mobius/acp_$AE"
curl -s -o /dev/null -X DELETE -H "X-M2M-RI: g" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" "$B/Mobius/$AE"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*mobius*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
```

- [ ] **Step 7: 커밋**

```bash
git add mobius/sql_action.js test/sqli-regression.test.js
git commit -m "fix: update_lookup/update_acp 파사드 전환 — SQL Injection 2건 제거 + SQLite ACP 갱신 유실 수정

update_lookup: MySQL 경로가 lbl 만 이스케이프하고 acpi/at/aa/subl 은
날것으로 SQL 에 박았다. 바인딩 전환으로 제거.

update_acp: pv/pvs 를 양쪽 경로 모두 이스케이프 없이 박았다(pv 는
클라이언트가 보내는 ACP 정책이다). 또한 sql2 가 db.getResult 를 무조건
호출해 SQLite 모드에서 acp 본문만 MySQL 로 나갔고, select_acp 는 SQLite
에서 읽으므로 정책 갱신이 조용히 유실됐다.

SQLite 모드에서 ACP 수정 후 재조회로 반영 확인."
```

---

## Task 2: `update_sub` — 구독 갱신 유실 수정

`update_acp`와 같은 패턴이다. `update_lookup`은 분기하는데 `sql2`가 항상 MySQL로 나가, **SQLite 모드에서 구독 갱신이 조용히 유실된다**.

**Files:**
- Modify: `mobius/sql_action.js` (`update_sub` L3212-3232)

**Interfaces:**
- Consumes: `facade.k`, `facade.run`, Task 1이 전환한 `_this.update_lookup`
- Produces: `exports.update_sub(connection, obj, callback)` — 시그니처 불변

- [ ] **Step 1: `update_sub` 를 전환한다**

`exports.update_sub = function (...) { ... };` 전체를 교체:

```js
exports.update_sub = function (connection, obj, callback) {
    console.time('update_sub ' + obj.ri);
    _this.update_lookup(connection, obj, function (err, results) {
        if (err) {
            callback(err, results);
            return;
        }

        // 이전에는 db.getResult 를 무조건 호출해 SQLite 모드에서 구독 갱신이 유실됐다.
        facade.run(facade.k('sub').update({
            enc: JSON.stringify(obj.enc),
            exc: obj.exc,
            nu: JSON.stringify(obj.nu),
            gpi: obj.gpi,
            nfu: obj.nfu,
            bn: JSON.stringify(obj.bn),
            rl: obj.rl,
            pn: obj.pn,
            nsp: obj.nsp,
            ln: obj.ln,
            nct: obj.nct,
            nec: obj.nec
        }).where({ ri: obj.ri }), connection, function (err2, results2) {
            if (!err2) {
                console.timeEnd('update_sub ' + obj.ri);
            }
            callback(err2, results2);
        });
    });
};
```

- [ ] **Step 2: 문법 검사**

```bash
node --check mobius/sql_action.js
```

기대: 출력 없음

- [ ] **Step 3: SQLite 모드에서 구독 갱신이 반영되는지 확인한다**

```bash
node mobius.js sqlite > /tmp/t2.log 2>&1 &
sleep 12
grep -c "running at" /tmp/t2.log

AE=subfix_$(date +%s)
B=http://127.0.0.1:7579

curl -s -o /dev/null -w "AE: %{http_code}\n" -X POST \
  -H "X-M2M-RI: a" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Content-Type: application/vnd.onem2m-res+json;ty=2" \
  -d "{\"m2m:ae\":{\"rn\":\"$AE\",\"api\":\"0.2.481.2.0001.001.000111\",\"rr\":\"true\"}}" "$B/Mobius"

curl -s -o /dev/null -w "CNT: %{http_code}\n" -X POST \
  -H "X-M2M-RI: b" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Content-Type: application/vnd.onem2m-res+json;ty=3" \
  -d '{"m2m:cnt":{"rn":"c1"}}' "$B/Mobius/$AE"

curl -s -o /dev/null -w "SUB 생성: %{http_code}\n" -X POST \
  -H "X-M2M-RI: c" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Content-Type: application/vnd.onem2m-res+json;ty=23" \
  -d '{"m2m:sub":{"rn":"s1","nu":["http://127.0.0.1:59991"],"nct":2}}' "$B/Mobius/$AE/c1"

echo "--- 수정 전 nu ---"
curl -s -H "X-M2M-RI: d" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Accept: application/json" "$B/Mobius/$AE/c1/s1" | grep -o '59991\|59992'

curl -s -o /dev/null -w "SUB 수정(nu 포트 59991->59992): %{http_code}\n" -X PUT \
  -H "X-M2M-RI: e" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Content-Type: application/vnd.onem2m-res+json" \
  -d '{"m2m:sub":{"nu":["http://127.0.0.1:59992"]}}' "$B/Mobius/$AE/c1/s1"

echo "--- 수정 후 nu (59992 여야 함) ---"
curl -s -H "X-M2M-RI: f" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" \
  -H "Accept: application/json" "$B/Mobius/$AE/c1/s1" | grep -o '59991\|59992'
```

기대: 마지막 조회가 **59992**. 전환 전이면 59991 그대로였을 것이다.

**59991이 나오면 멈추고 보고하라.**

정리하고 서버를 내린다:

```bash
curl -s -o /dev/null -X DELETE -H "X-M2M-RI: g" -H "X-M2M-Origin: C$AE" -H "X-M2M-RVI: 2a" "$B/Mobius/$AE"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*mobius*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
```

- [ ] **Step 4: 커밋**

```bash
git add mobius/sql_action.js
git commit -m "fix: update_sub 파사드 전환 — SQLite 구독 갱신 유실 수정

update_acp 와 동일한 패턴. update_lookup 은 분기하는데 sub 본문 UPDATE 는
db.getResult 를 무조건 호출해 SQLite 모드에서 MySQL 로 나갔다.

SQLite 모드에서 구독 nu 수정 후 재조회로 반영 확인."
```

---

## Task 3: 단순 조회 4개 전환

전부 단일 테이블 SELECT이고 사용자 입력이 값으로만 들어간다. 기계적 전환이다.

**Files:**
- Modify: `mobius/sql_action.js` — `get_ri_sri`(L196), `select_cb`(L2398), `select_sum_cbs`(L3627), `select_sum_ae`(L3637)

**Interfaces:**
- Consumes: `facade.k`, `facade.raw`, `facade.run`
- Produces: 네 함수 모두 시그니처·반환 형태 불변. SELECT이므로 **배열**을 돌려준다.

- [ ] **Step 1: `get_ri_sri` 를 전환한다**

```js
exports.get_ri_sri = function (connection, sri, callback) {
    var tid = require('shortid').generate();
    console.time('get_ri_sri' + ' (' + tid + ')');
    facade.run(facade.k('lookup').select('ri').where({ sri: sri }), connection, function (err, results) {
        console.timeEnd('get_ri_sri' + ' (' + tid + ')');
        callback(err, results);
    });
};
```

- [ ] **Step 2: `select_cb` 를 전환한다**

```js
exports.select_cb = function (connection, ri, callback) {
    facade.run(facade.k('cb').select('*').where({ ri: ri }), connection, function (err, results_cb) {
        callback(err, results_cb);
    });
};
```

- [ ] **Step 3: `select_sum_cbs` 와 `select_sum_ae` 를 전환한다**

이 둘은 집계 컬럼 이름(`sum(cbs)`, `count(*)`)이 그대로 HTTP 응답에 실려 나간다. 빌더의 `.sum()`/`.count()`를 쓰면 컬럼 이름이 바뀌므로 **`facade.raw` 로 SQL 문자열을 그대로 유지**한다. 사용자 입력이 없어 바인딩이 필요 없다.

```js
exports.select_sum_cbs = function (connection, callback) {
    var tid = require('shortid').generate();
    console.time('select_sum_cbs ' + tid);
    // 집계 컬럼 이름(sum(cbs))이 응답에 그대로 나가므로 빌더 대신 raw 로 SQL 을 유지한다.
    facade.run(facade.raw('select sum(cbs) from cnt'), connection, function (err, result_Obj) {
        console.timeEnd('select_sum_cbs ' + tid);
        callback(err, result_Obj);
    });
};

exports.select_sum_ae = function (connection, callback) {
    var tid = require('shortid').generate();
    console.time('select_sum_ae ' + tid);
    // 집계 컬럼 이름(count(*))이 응답에 그대로 나가므로 빌더 대신 raw 로 SQL 을 유지한다.
    facade.run(facade.raw('select count(*) from ae'), connection, function (err, result_Obj) {
        console.timeEnd('select_sum_ae ' + tid);
        callback(err, result_Obj);
    });
};
```

- [ ] **Step 4: 문법 검사와 SELECT 반환 형태 확인**

```bash
node --check mobius/sql_action.js
node --test test/
```

기대: 문법 통과, 18/18

SELECT가 배열을 돌려주는지 직접 확인한다 (전역 제약):

```bash
node -e "
global.usesqlite='true';
process.env.MOBIUS_SQLITE_PATH=require('path').join(require('os').tmpdir(),'p2-check.db');
var db=require('./mobius/db');
db.connect('localhost',3306,'root','x',function(){
  db.getConnection(function(code,conn){
    db.run(db.raw('select count(*) from ae'), conn, function(err,rows){
      console.log('err:', err, '/ 배열인가:', Array.isArray(rows), '/ 값:', JSON.stringify(rows));
      process.exit(0);
    });
  });
});
"
```

기대: `err: null / 배열인가: true`

- [ ] **Step 5: 동등성 확인 — SQLite**

이 4개는 `SQLITE-DEAD`지만 **읽기 전용**이라 관측 동작이 바뀌지 않을 수도 있다(빈 결과 → 빈 결과). 차이가 나면 그것도 정상이니 무엇이 바뀌었는지 기록하라.

```bash
node mobius.js sqlite > /tmp/t3.log 2>&1 &
sleep 12
node tools/equivalence/run-scenarios.js tools/equivalence/out/after-t3.json
node tools/equivalence/compare.js tools/equivalence/out/before-sqlite.json tools/equivalence/out/after-t3.json
```

`before-sqlite.json`이 없으면 전환 전 코드로 먼저 떠야 한다 — 그 경우 `git stash` 대신 이 태스크를 시작하기 전에 떠 두라.

서버를 내린다 (Task 1 Step 6의 종료 명령).

- [ ] **Step 6: 커밋**

```bash
git add mobius/sql_action.js
git commit -m "refactor: 단순 조회 4개 파사드 전환 (get_ri_sri, select_cb, select_sum_cbs, select_sum_ae)

전부 분기 없이 db.getResult 를 호출해 SQLite 모드에서도 MySQL 로 나가던
함수들이다. select_sum_* 는 집계 컬럼 이름이 응답에 실려 나가므로 빌더 대신
raw 로 SQL 문자열을 유지했다."
```

---

## Task 4: 단순 갱신 2개 전환

**Files:**
- Modify: `mobius/sql_action.js` — `update_cb_poa_csi`(L2660), `delete_lookup_et`(L3566)

**Interfaces:**
- Consumes: `facade.k`, `facade.run`
- Produces: 두 함수 시그니처 불변. `delete_lookup_et`의 내부 SELECT는 배열을 돌려준다.

- [ ] **Step 1: `update_cb_poa_csi` 를 전환한다**

```js
exports.update_cb_poa_csi = function (connection, poa, csi, srt, ri, callback) {
    console.time('update_cb_poa_csi ' + ri);
    facade.run(facade.k('cb').update({ poa: poa, csi: csi, srt: srt }).where({ ri: ri }),
        connection, function (err, results) {
            console.timeEnd('update_cb_poa_csi ' + ri);
            callback(err, results);
        });
};
```

- [ ] **Step 2: `delete_lookup_et` 의 SELECT 를 전환한다**

이 함수는 만료 리소스를 찾는 SELECT 뒤에 기존 `_this.delete_lookup`을 부른다. **SELECT만 전환하고 뒤 로직은 건드리지 않는다.**

`var sql = util.format(...)` 와 `db.getResult(sql, connection, function (err, delete_Obj) {` 두 줄을 다음으로 교체:

```js
    facade.run(facade.k('lookup')
        .select('ri')
        .where('et', '<', et)
        .andWhere('ty', '<>', '2')
        .andWhere('ty', '<>', '3')
        .andWhere('ty', '<>', '5'), connection, function (err, delete_Obj) {
```

나머지 본문(`if (!err) { ... }`)은 그대로 둔다.

- [ ] **Step 3: 생성 SQL 이 기존과 같은 의미인지 확인한다**

```bash
node -e "
global.usesqlite='false';
var db=require('./mobius/db');
db.connect('h',1,'u','p',function(){
  var n=db.k('lookup').select('ri')
    .where('et','<','20260101T000000')
    .andWhere('ty','<>','2').andWhere('ty','<>','3').andWhere('ty','<>','5')
    .toSQL().toNative();
  console.log('SQL :', n.sql);
  console.log('bind:', JSON.stringify(n.bindings));
  process.exit(0);
});
"
```

기대: `select \`ri\` from \`lookup\` where \`et\` < ? and \`ty\` <> ? and \`ty\` <> ? and \`ty\` <> ?`, bindings 4개

원본 `select ri from lookup where et < '%s' and ty <> '2' and ty <> '3' and ty <> '5'` 와 조건이 같은지 눈으로 대조하라.

- [ ] **Step 4: 문법 검사와 테스트**

```bash
node --check mobius/sql_action.js
node --test test/
```

기대: 문법 통과, 18/18

- [ ] **Step 5: 동등성 확인 — SQLite + MySQL**

```bash
node mobius.js sqlite > /tmp/t4s.log 2>&1 &
sleep 12
node tools/equivalence/run-scenarios.js tools/equivalence/out/after-t4-sqlite.json
node tools/equivalence/compare.js tools/equivalence/out/before-sqlite.json tools/equivalence/out/after-t4-sqlite.json
```
서버를 내리고 MySQL로 반복:
```bash
node mobius.js mysql > /tmp/t4m.log 2>&1 &
sleep 12
node tools/equivalence/run-scenarios.js tools/equivalence/out/after-t4-mysql.json
node tools/equivalence/compare.js tools/equivalence/out/before-mysql.json tools/equivalence/out/after-t4-mysql.json
```
`before-mysql.json`이 없으면 전환 전 코드로 먼저 떠 두라. 서버를 내린다.

- [ ] **Step 6: 커밋**

```bash
git add mobius/sql_action.js
git commit -m "refactor: update_cb_poa_csi / delete_lookup_et 파사드 전환

둘 다 분기 없이 db.getResult 를 호출하던 함수다. delete_lookup_et 는
만료 리소스를 찾는 SELECT 만 전환하고 뒤의 delete_lookup 위임은 그대로 뒀다."
```

---

## Task 5: 에러 어휘 동반 수정 (Ruling 17)

전환한 함수들의 에러가 `mobius/resource.js`의 `ER_DUP_ENTRY` 검사에 닿는지 확인하고, 닿는다면 중립 코드로 바꾼다.

**Files:**
- Modify: `mobius/resource.js` (해당하는 경우에만)

**Interfaces:**
- Consumes: 파사드의 중립 에러 코드 — `DUPLICATE_KEY`/`FK_VIOLATION`/`NOT_NULL`/`LOCK_CONFLICT`/`LOCK_TIMEOUT`/`UNKNOWN`, 원본은 `err.driverCode`, 제약은 `err.constraint`
- Produces: 없음 (호출부 수정)

- [ ] **Step 1: 전환한 함수의 에러가 어디로 가는지 조사한다**

전환한 9개 함수(`update_lookup`, `update_acp`, `update_sub`, `get_ri_sri`, `select_cb`, `select_sum_cbs`, `select_sum_ae`, `update_cb_poa_csi`, `delete_lookup_et`) 각각에 대해 호출부를 찾는다:

```bash
for f in update_lookup update_acp update_sub get_ri_sri select_cb select_sum_cbs select_sum_ae update_cb_poa_csi delete_lookup_et; do
  echo "=== $f ==="
  grep -rn "db_sql\.$f(" --include="*.js" . | grep -v node_modules
done
```

각 호출부의 콜백 안에서 `results.code` 를 검사하는 곳이 있는지 확인하라. **`update_action` 경로(`resource.js`)가 주 대상이다.**

- [ ] **Step 2: `ER_DUP_ENTRY` 검사가 걸리는 곳을 바꾼다**

걸리는 곳이 있으면 이 형태로 바꾼다:

```js
// 전환 전
if (results.code == 'ER_DUP_ENTRY') {
    callback('409-5');
}

// 전환 후 — 중립 코드를 보고, 진단은 원본을 남긴다
if (results.code == 'DUPLICATE_KEY') {
    callback('409-5');
}
```

에러 로그가 `results.code` 만 찍고 있으면 함께 고친다 (중립화 후 대부분 `UNKNOWN` 이 되어 진단이 불가능해진다):

```js
console.log('[update_action] update resource error ======== ' +
            (results.driverCode || results.code) + ' / ' + results.message);
```

**걸리는 곳이 하나도 없으면 코드를 바꾸지 말고 그 사실을 리포트에 적어라.** 전환한 9개가 전부 `update`/`select` 경로이고 `ER_DUP_ENTRY` 검사 29곳은 전부 `create_action` 의 insert 경로에 있으므로, 실제로 없을 가능성이 높다.

- [ ] **Step 3: 실패 경로를 실제로 밟는다 (Ruling 18)**

전환한 함수 중 하나의 실패 경로를 실제로 실행해 콜백 계약이 유지되는지 본다. 존재하지 않는 리소스를 수정해 본다:

```bash
node mobius.js sqlite > /tmp/t5.log 2>&1 &
sleep 12
B=http://127.0.0.1:7579
curl -s -w "\n없는 ACP 수정: HTTP %{http_code}\n" -X PUT \
  -H "X-M2M-RI: x" -H "X-M2M-Origin: Cnobody" -H "X-M2M-RVI: 2a" \
  -H "Content-Type: application/vnd.onem2m-res+json" \
  -d '{"m2m:acp":{"pv":{"acr":[{"acor":["Cnobody"],"acop":51}]}}}' "$B/Mobius/no_such_acp" | head -c 200
```

기대: `404` 계열 응답. **500 이나 무응답이면 콜백 계약이 깨진 것이니 멈추고 보고하라.**

서버 로그에 워커 크래시(`TypeError` 등)가 없는지도 확인한다:

```bash
grep -i "TypeError\|not a function\|cannot read" /tmp/t5.log | head -5
```

기대: 출력 없음. 서버를 내린다.

- [ ] **Step 4: 커밋**

변경이 있으면:
```bash
git add mobius/resource.js
git commit -m "fix: 전환된 함수의 에러 어휘를 중립 코드로 맞춤 (Ruling 17)"
```
변경이 없으면 커밋하지 말고 리포트에 "해당 없음 — 전환한 9개는 전부 update/select 경로이고 ER_DUP_ENTRY 검사는 create_action 에만 있다"고 적어라.

---

## Task 6: 최종 통합 검증

**Files:** 없음 (검증 전용)

**Interfaces:**
- Consumes: Task 1~5의 모든 변경
- Produces: 검증 리포트

- [ ] **Step 1: 전체 단위 테스트**

```bash
npm test
```

기대: 18/18 통과, 출력에 경고 없음

- [ ] **Step 2: `usesqlite` 분기가 줄었는지 확인**

```bash
grep -c "global.usesqlite" mobius/sql_action.js
```

기대: 35 → **34** (`update_lookup` 의 분기 1개가 사라졌다). 나머지 8개는 원래 분기가 없던 함수라 숫자가 안 줄어든다.

- [ ] **Step 3: 전환된 함수 수 확인**

```bash
grep -c "facade.run" mobius/sql_action.js
```

기대: 2 → **11** 이상 (`insert_acp` 2 + 이번 9개, `update_acp`/`update_sub` 는 각 1개)

- [ ] **Step 4: SQLite 모드 전체 시나리오**

```bash
node mobius.js sqlite > /tmp/final-s.log 2>&1 &
sleep 12
grep -c "running at" /tmp/final-s.log
node tools/equivalence/run-scenarios.js tools/equivalence/out/final-sqlite.json
node tools/equivalence/compare.js tools/equivalence/out/before-sqlite.json tools/equivalence/out/final-sqlite.json
grep -i "TypeError\|not a function\|cannot read\|UNKNOWN" /tmp/final-s.log | head -10
```

차이가 나오면 **각각이 의도된 것인지 판단해 리포트에 적어라.** `SQLITE-DEAD` 전환은 차이가 정상이다.

서버를 내린다.

- [ ] **Step 5: MySQL 모드 전체 시나리오**

```bash
node mobius.js mysql > /tmp/final-m.log 2>&1 &
sleep 12
node tools/equivalence/run-scenarios.js tools/equivalence/out/final-mysql.json
node tools/equivalence/compare.js tools/equivalence/out/before-mysql.json tools/equivalence/out/final-mysql.json
```

기대: **28단계 일치.** MySQL 모드는 원래 정상 동작했으므로 차이가 나면 회귀다. **차이가 나면 멈추고 보고하라.**

서버를 내린다.

- [ ] **Step 6: SQL 관측**

```bash
rm -f tools/golden/out/sql-*.jsonl
node tools/golden/mobius-tapped.js sqlite > /tmp/final-tap.log 2>&1 &
sleep 12
node tools/equivalence/run-scenarios.js tools/golden/out/_final.json
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*mobius*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
node tools/golden/collect.js tools/golden/out/final-sql.json
node tools/golden/diff.js tools/golden/out/before-sqlite-sql.json tools/golden/out/final-sql.json
```

출력을 읽고 **바뀐 SQL 형태가 전환한 함수의 것뿐인지** 판단하라. 리포트에 diff 출력 전문을 넣어라.

- [ ] **Step 7: 리포트 작성**

담을 것:
- 각 태스크의 검증 출력 (특히 Task 1 Step 6 의 `acop 51`, Task 2 Step 3 의 `59992`)
- SQLite/MySQL 동등성 결과와 차이 항목별 판단
- SQL 관측 diff 와 판단
- `usesqlite` 분기 수, `facade.run` 수
- 발견한 문제

---

## 이 계획의 범위와 다음

전환 대상 9개. 남은 것:

| 대상 | 개수 | 계획 |
|---|---:|---|
| 다중 테이블 UPDATE (`update_parent_by_delete` ×2, `update_parent_st`, `update_cnt_cni`) | 4 | 3차 — 원자성 설계 필요 |
| MERGE 판정 분기 | 23 | 4차 — 기계적 |
| MYSQL-ONLY 무분기 | 52 | 5차 — 관측 동작 불변 |
| REVIEW 판정 (`insert_lookup`, `delete_oldest`, `search_lookup` 등) | 8 | 6차 — 개별 설계 |
