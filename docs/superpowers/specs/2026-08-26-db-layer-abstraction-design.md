# DB 접근 계층 추상화 설계

- 작성일: 2026-08-26
- 대상 브랜치: `lite`
- 기준 커밋: `3d6c6e3`

## 배경

Mobius는 MySQL과 SQLite를 모두 지원하지만, 지원 방식이 함수마다 `global.usesqlite`를 직접 읽어 분기하는 형태다. 그 결과 세 가지 문제가 있다.

**1. 코어가 백엔드를 안다.** `sql_action.js` 3,662줄 안에 `usesqlite` 분기가 36곳 있고, 각 분기는 같은 SQL을 이스케이프 방식만 바꿔 두 번 쓴다.

```js
if (global.usesqlite === 'true') {
    var sql = util.format('insert into acp (ri, pv, pvs) values (\'%s\', \'%s\', \'%s\')',
        obj.ri, JSON.stringify(obj.pv).replace(/'/g, "''"), ...);
    sqlite.getResult(sql, null, cb);
} else {
    var sql = util.format('insert into acp (ri, pv, pvs) values (\'%s\', \'%s\', \'%s\')',
        obj.ri, JSON.stringify(obj.pv).replace(/\"/g,'\\"').replace(/\'/g,"\\'"), ...);
    db.getResult(sql, connection, cb);
}
```

**2. SQLite 모드가 MySQL에 의존한다.** `db_action.connect()`는 `usesqlite`와 무관하게 항상 MySQL 풀을 만들고, `getConnection()`은 항상 MySQL 커넥션을 체크아웃한다. SQLite 분기는 그 커넥션을 받아놓고 무시한다(`sqlite.getResult(sql, null, ...)`).

MySQL이 없으면 `getConnection`이 `'500-5'`를 반환하고, `app.js`의 요청 핸들러는 `if (code === '200')` 안에서만 동작하므로 **응답을 보내는 코드에 도달하지 못한다.** 격리 스크립트로 재현 확인함.

**3. 새 백엔드를 추가할 수 없다.** 에러 어휘가 MySQL 중심이다. `db_sqlite.js`는 `SQLITE_CONSTRAINT`를 `ER_DUP_ENTRY`로 바꿔 MySQL인 척한다. `resource.js`는 `ER_DUP_ENTRY`를 29곳에서 검사한다. 세 번째 DB도 똑같이 MySQL인 척해야 한다.

## 목표

1. `sql_action.js`와 그 위 코어가 어느 DB를 쓰는지 모르게 한다
2. 새 DB 추가를 최소 작업으로 만든다
3. **기존 동작을 보존한다.** 매 단계가 배포 가능해야 한다

## 비목표

- SQLite의 지원 리소스 타입 확대 (현행 6종 유지)
- discovery 순회 알고리즘 통일 → 후속 작업
- SQLite 트랜잭션 지원 → 후속 작업
- 성능 개선 (부수 효과는 환영하되 목표 아님)

## 현황 수치 (`3d6c6e3` 기준)

| 항목 | 값 |
|---|---:|
| `mobius/sql_action.js` 줄수 | 3,662 |
| `exports` 개수 | 109 |
| `usesqlite` 언급 | 36 |
| `if (global.usesqlite === 'true')` 분기 블록 | 33 |
| `sql_action.js` 의존 모듈 | 14 |
| `resource.js`의 `ER_DUP_ENTRY` | 29 |

**실제 방언 차이는 소수다.**

| 구문 | 개수 | 비고 |
|---|---:|---|
| `ON DUPLICATE KEY` ↔ `ON CONFLICT` | 3+3 | upsert, `hit` 테이블 전용 |
| `FOR UPDATE` / `NOWAIT` | 4 / 3 | `delete_oldest` |
| `beginTransaction` | 2 | MySQL 경로에만 존재 |
| `WITH RECURSIVE` | 2 | MySQL 8.0.45·SQLite 3.44.2 모두 지원 — 방언 차이 아님 |

### 분기 분류 — 대부분은 합칠 수 있으나 전부는 아니다

33개 분기를 정적 분석으로 훑은 결과다. **이 수치는 확정이 아니라 출발점이다.** 도구가 휴리스틱이라 양방향 오차가 있음을 아래에 근거와 함께 적는다.

| 분류 | 개수 | 뜻 |
|---|---:|---|
| `executor-only` | 16 | SQL 은 분기 밖에서 만들고, 분기는 `sqlite.getResult` / `db.getResult` 만 고른다 |
| `fake` | 3 | 분기 안 SQL 이 동일하고 이스케이프만 다르다 |
| `dialect` | 2 | `ON CONFLICT` ↔ `ON DUPLICATE KEY` — knex 가 흡수한다 |
| `real` | 9 | SQL 자체가 다르다 |
| `sqlite-only` | 2 | `else` 가 없다 (`search_lookup`, `search_parents_lookup`) |
| `unparsed` | 1 | 도구가 판정하지 못했다 (`get_cni_count`) |

**진짜 차이가 존재한다는 근거** — `insert_lookup`은 두 경로가 구조적으로 다르다.

| | SQLite 경로 | MySQL 경로 |
|---|---|---|
| 선행 쿼리 | `select pv from acp where ri in (...)` **있음** | 없음 |
| `insert into lookup` 컬럼 | 16개 (`acpl` 포함) | 15개 (`acpl` 없음) |

SQLite 경로만 ACP 를 `lookup.acpl` 에 비정규화해 넣는다. 모르고 합치면 동작이 조용히 바뀐다.

**`real` 9개는 과다 계상이다** — `update_ae` 를 확인한 결과 실제 차이는 예약어 `or` 의 인용 방식뿐이었다.

```
MySQL : update ae set ..., ae.or = '%s', ...
SQLite: update ae set ..., "or"  = '%s', ...
```

식별자 인용이므로 knex 가 흡수한다. 같은 성격의 오탐이 `real` 안에 더 있을 수 있다.

**따라서 분류 확정은 구현 전 첫 작업으로 둔다.** 33개 분기를 하나씩 읽어 `합칠 수 있음 / 개별 처리 필요` 로 판정하고, 판정 결과를 근거와 함께 기록한 뒤에야 기계적 변환을 시작한다. 이 표는 그 작업의 시작점이지 결론이 아니다.

## 접근 방법

### 왜 Knex인가

파라미터 바인딩으로 전환하면 이스케이프 차이가 사라진다. `mysql`과 `sqlite3` 드라이버 모두 `?` 플레이스홀더를 지원한다. 남는 것은 방언별 SQL 생성인데, 이를 직접 구현하는 대신 검증된 라이브러리를 쓴다.

Knex 3.3.0 (MIT)을 **빌더로만** 사용한다. 실행·커넥션 풀·콜백 구조는 기존 드라이버를 그대로 유지한다.

**검증 결과** — Mobius의 SQL 패턴 7종을 드라이버 미설치 상태에서 3개 방언으로 생성 성공.

| 패턴 | MySQL | SQLite | PostgreSQL |
|---|---|---|---|
| INSERT | `` `acp` `` + `?` | 동일 | `"acp"` + `$1` |
| UPSERT | `on duplicate key update` | `on conflict (ct) do update` | `on conflict ("ct") do update` |
| FOR UPDATE | `for update` | **자동 생략** | `for update` |
| 상대증분 / LIKE / IN / LIMIT / 재귀 CTE / 서브쿼리 | ✅ | ✅ | ✅ |

**대안 검토** — Kysely(월 5,444만)와 Drizzle(7,437만)이 다운로드는 많지만 TypeScript 우선이고, 결정적으로 방언 차이를 흡수하지 못한다. 실제 DB로 확인:

| 검증 | Kysely 생성 SQL | Knex 생성 SQL |
|---|---|---|
| MySQL 8.0.45 UPSERT | ❌ `ER_PARSE_ERROR` | ✅ 성공 |
| SQLite 3.44.2 FOR UPDATE | ❌ `SQLITE_ERROR: near "for"` | ✅ 성공 |

Kysely는 MySQL에 `onDuplicateKeyUpdate()`를 **호출자가 골라 써야 한다.** 방언 차이가 호출부로 돌아오므로 이번 목표와 충돌한다.

**성능** — SQL 생성 오버헤드만 측정(실행 제외).

| 쿼리 | 현재 | knex | 차이 |
|---|---:|---:|---:|
| INSERT | 0.62 us/건 | 1.39 us/건 | +0.78 us |
| SELECT (discovery) | 0.16 us/건 | 2.52 us/건 | +2.36 us |

DB 왕복 1회는 수백~수천 us다. 건당 최대 2.4us는 쿼리 비용의 1% 미만.

**공급망** — 취약점 0건. 빌더 용도에서 실제 로드되는 패키지는 7개(`colorette, debug, knex, lodash, ms, pg-connection-string, tarn`). CLI/마이그레이션 전용 9개(방치된 `esm` 포함)는 로드되지 않는다. 설치 6.1MB(`node_modules` +18%).

**리스크** — Knex는 신규 채택 점유율에서 밀린 이전 세대 도구이고, 마지막 릴리스가 2026-06-26이다. 완화책은 **빌더로만 쓰는 것**이다. 그러면 knex는 입력→SQL 문자열의 순수 함수로만 동작한다.

## 아키텍처

```
[코어] resource.js, security.js, sgn.js, cnt_man.js ... (14개 모듈)
   │  변경 최소. 기존처럼 db_sql.insert_acp(...) 호출
   ▼
[SQL 정의] mobius/sql_action.js
   │  export 109개 시그니처 유지
   │  내부만 교체: util.format → knex 빌더
   │  global.usesqlite 분기 36개 제거
   ▼
[파사드] mobius/db/index.js       ← usesqlite 를 읽는 유일한 지점
   ├──> mobius/db/mysql.js        실행 + 정규화
   └──> mobius/db/sqlite.js       실행 + 정규화
```

### 신규 파일

| 파일 | 책임 |
|---|---|
| `mobius/db/index.js` | 파사드. 어댑터 선택, knex 인스턴스 보유, `run`/`transaction`/`can` |
| `mobius/db/mysql.js` | `mysql` 드라이버 래핑 + 결과/에러 정규화 |
| `mobius/db/sqlite.js` | `sqlite3` 드라이버 래핑 + 결과/에러 정규화 |

`db_action.js`와 `db_sqlite.js`는 전환이 끝날 때까지 공존하고, 마지막 단계에서 삭제한다.

### 파사드 API

```js
var db = require('./db');

db.connect(conf, cb);            // 부팅 1회
db.getConnection(cb);            // cb('200', conn) | cb('500-5')
db.release(conn);
db.k                             // knex 인스턴스 (빌더 전용)
db.run(qb, conn, cb);            // 백엔드가 갈라지는 유일한 지점
db.transaction(conn, fn, cb);
db.can('rowLock');               // 능력 조회
```

`db.run()`이 `qb.toSQL().toNative()`로 `{sql, bindings}`를 뽑아 어댑터 실행기에 넘긴다.

### 빌더 노출 방식

knex 빌더를 `db.k`로 직접 노출한다. 자체 래퍼를 만들지 않는다.

```js
db.run(db.k('acp').insert({ ri: obj.ri, pv: ... }), connection, callback);
```

**트레이드오프** — 래퍼 100여 줄을 아끼는 대신 knex API가 109개 함수에 퍼진다. knex 교체가 필요해지면 기계적 치환이 필요하다. 지켜야 할 불변식(**백엔드 선택 지점은 한 곳**)은 `db.run()`이 보장하며, 이는 빌더 노출 방식과 무관하다.

### 어댑터 계약

새 DB를 추가하는 사람이 채울 파일은 이것 하나다.

```js
// mobius/db/<backend>.js
module.exports = {
    name: 'mysql',
    knexClient: 'mysql',              // knex 방언 이름

    connect(conf, cb),
    getConnection(cb),                // cb('200', handle) | cb('500-5')
    release(handle),
    execute(handle, sql, bindings, cb),

    normalizeResult(raw),             // SELECT -> rows[] 배열 그대로 / 그 외 -> {affectedRows, insertId}
    normalizeError(err),              // -> {code, constraint}

    begin(handle, cb), commit(handle, cb), rollback(handle, cb),

    capabilities: { transaction: true, rowLock: true },
    schemaFile: 'mobiusdb.sql'
};
```

방언 코드(`placeholder`·`quoteIdent`·`upsert`·`forUpdate`·`limitOffset`)는 knex가 처리하므로 계약에 없다.

**새 DB 추가 절차**: ① `mobius/db/<name>.js` 작성(약 60줄) ② DDL 파일 추가 ③ 파사드 레지스트리에 1줄.

## 규약

### 커넥션

| | MySQL 어댑터 | SQLite 어댑터 |
|---|---|---|
| `connect()` | 풀 생성 (`connectionLimit: 100`) | `mobius.db` 열고 스키마 적용 |
| `getConnection(cb)` | 풀에서 체크아웃 | 공유 핸들 반환 (풀 없음) |
| `release(h)` | 풀에 반납 | no-op |

호출부 코드(`db.getConnection` → `connection.release()`)는 바뀌지 않는다. **SQLite 모드에서 MySQL 풀을 만들지 않는다** — 배경 2번 문제가 여기서 해소된다.

### 콜백 계약 (기존 관례 보존)

현재 `getResult`는 실패 시 **첫 인자가 `true`, 두 번째 인자가 에러 객체**다. `resource.js` 29곳이 이 형태에 의존하므로 그대로 유지한다.

```js
db.run(qb, conn, cb)
  // 성공: cb(null, rows[])  또는  cb(null, { affectedRows, insertId })
  // 실패: cb(true, err)       err.code 는 중립 어휘
```

### 에러 어휘 중립화

| 중립 코드 | MySQL | SQLite | (참고) PostgreSQL |
|---|---|---|---|
| `DUPLICATE_KEY` | `ER_DUP_ENTRY` | `SQLITE_CONSTRAINT` (UNIQUE/PK) | `23505` |
| `FK_VIOLATION` | `ER_NO_REFERENCED_ROW_2` | `SQLITE_CONSTRAINT_FOREIGNKEY` | `23503` |
| `NOT_NULL` | `ER_BAD_NULL_ERROR` | `SQLITE_CONSTRAINT_NOTNULL` | `23502` |
| `UNKNOWN` | 그 외 | 그 외 | 그 외 |

`resource.js`의 `ER_DUP_ENTRY` 29곳을 `DUPLICATE_KEY`로 바꾼다. `aei_UNIQUE` 제약 이름으로 분기하는 곳이 1곳(`409-6`) 있으므로 `normalizeError`는 `err.constraint`에 제약 이름을 담는다.

### 결과 형태 정규화

| | MySQL 원본 | SQLite 원본 | 정규화 결과 |
|---|---|---|---|
| SELECT | `rows[]` | `rows[]` | **`rows[]` — 배열 그대로** |
| INSERT | `{insertId, affectedRows}` | `{lastID, changes}` | `{ insertId, affectedRows }` |
| UPDATE/DELETE | `{affectedRows}` | `{changes}` | `{ affectedRows }` |

**SELECT 결과를 객체로 감싸면 안 된다.** 호출부가 배열로 직접 다룬다.

```js
// mobius/resource.js
db_sql.select_lookup(conn, pi, function (err, results_comm) {
    makeObject(results_comm[0]);          // ← 배열 인덱싱
// mobius/security.js
db_sql.select_acp_in(conn, ri_list, function (err, results_acp) {
    if (results_acp.length == 0) { ... }  // ← 배열 length
    ... results_acp[i].pv ...
```

즉 정규화의 기준은 **MySQL 드라이버가 원래 돌려주던 형태**이고, 다른 백엔드가 거기에 맞춘다. `db_sqlite.js` 가 이미 하고 있는 흉내내기를 어댑터의 명시적 의무로 승격시키는 것이다. 이는 에러 어휘 중립화와 방향이 반대로 보이지만, 결과 형태는 **호출부 109곳이 의존하는 기존 계약**이라 보존이 우선이다.

### 능력 선언

```js
// mysql.js   capabilities: { transaction: true,  rowLock: true  }
// sqlite.js  capabilities: { transaction: false, rowLock: false }
```

**`rowLock`** — knex는 `forUpdate()`를 SQLite에서 자동 생략하지만, **`noWait()`은 예외를 던진다**(`.noWait() is currently only supported on MySQL 8.0+...`). 현재 `delete_oldest`가 `FOR UPDATE NOWAIT`을 쓰므로 호출부에서 능력을 검사해야 한다.

```js
var qb = db.k('cnt').select('cni', 'cbs').where({ ri: obj.ri });
if (db.can('rowLock')) { qb = qb.forUpdate().noWait(); }
```

**`transaction: false` (SQLite)** — 현재 `delete_oldest`의 SQLite 경로는 트랜잭션을 쓰지 않는다(MySQL 경로만 `beginTransaction`). `false` 선언은 **현재 동작의 보존**이다. SQLite 핸들이 워커당 하나로 공유되어 비동기 호출이 겹치면 논리적 트랜잭션이 뒤섞이므로, 제대로 하려면 핸들 풀이나 직렬화 큐가 필요하다 → 후속 작업.

`db.transaction()`은 `capabilities.transaction`이 `false`면 트랜잭션 없이 콜백을 실행하고 **시작 시 1회 경고 로그를 남긴다.** 조용한 no-op을 금지한다.

## 검증 전략

파라미터 바인딩 전환으로 SQL 문자열이 바뀌므로 단순 diff로는 검증할 수 없다. 확인된 차이가 두 가지다.

```
현재: insert into acp (ri, pv, pvs) values ('/Mobius/ap1', '{}', 'it''s quoted')
이후: insert into `acp` (`pv`, `pvs`, `ri`) values (?, ?, ?)   bindings: [...]
                          ↑ knex는 컬럼을 알파벳순으로 정렬한다
```

### 1층 — 골든 SQL (전수, 변화 탐지)

리팩터링 **전에** 기준선을 캡처한다. `db_action.getResult`와 `db_sqlite.getResult`를 가로채 SQL만 기록하고 준비된 결과를 즉시 콜백한다. 이후 `db.run`을 가로채 `{sql, bindings}`를 받아 바인딩을 되꽂고 정규화(식별자 인용 제거, 공백 축약, INSERT 컬럼 정렬)한 뒤 비교한다.

목적은 "통과"가 아니라 **차이 목록 확보**다. 차이가 나오면 의도한 것인지 사람이 판단한다.

**한계** — 109개 전수 자동화는 불가능하다. 함수마다 진행에 필요한 결과 모양이 달라 픽스처를 손으로 만들어야 한다. 기계적으로 닿는 것부터 덮고 **커버리지를 매 단계 보고**한다. 안 덮인 함수는 2·3층에 의존한다.

### 2층 — 동작 동등성 (의미 검증)

SQLite `:memory:`와 MySQL 임시 스키마에 대해 대표 시나리오를 리팩터링 전/후 실행하고 결과를 비교한다. SQL 텍스트가 달라도 무관하다. `node:test` 내장 사용(의존성 추가 없음).

- 리소스 생성 → 조회 → 수정 → 삭제
- CIN 대량 삽입 후 `cni`/`cbs` 일치
- `mni` 초과 시 오래된 것부터 삭제
- discovery 필터(`lbl`, `ty`, `cra`, `lim`, `ofst`) 결과 집합 일치
- 중복 생성 시 `DUPLICATE_KEY`, FK 위반 시 `FK_VIOLATION`

### 3층 — 스모크 (배선 검증)

서버를 띄워 HTTP CRUD를 돌린다. **매 단계마다** 실행한다. 1·2층이 못 잡는 배선 오류(엉뚱한 실행자 호출, 커넥션 미반납)를 잡는다.

## 전환 순서

매 단계가 배포 가능해야 한다.

| 단계 | 내용 | 되돌리기 |
|---|---|---|
| 0a | **33개 분기 정밀 분류.** 하나씩 읽어 `합칠 수 있음 / 개별 처리 필요` 판정, 근거 기록 | 코드 변경 없음 |
| 0b | 골든 기준선 캡처 + 2층 테스트 작성 | 코드 변경 없음 |
| 1 | `mobius/db/` 뼈대(파사드·어댑터 2종). 아무도 안 씀 | 파일 삭제 |
| 2 | `insert_*` 전환 | 함수 단위 revert |
| 3 | `select_*` 전환 | 〃 |
| 4 | `update_*` / `delete_*` 전환 | 〃 |
| 5 | 복잡한 것: `search_lookup`, `delete_oldest`, `select_acp_cnt`, `delete_orphan_lookup` | 〃 |
| 6 | 에러 어휘 중립화 (`resource.js` 29곳 + 어댑터) | 일괄 revert |
| 7 | `asn.js`·`mn.js`·`cnt_man.js`의 `db_action`/`db_sqlite` 직접 require 정리 | 〃 |
| 8 | `db_action.js`·`db_sqlite.js` 삭제 | 〃 |

2~5단계는 함수 하나씩 전환한다. 중간에 멈춰도 전환된 함수는 파사드를, 안 된 함수는 기존 경로를 쓰므로 서버는 정상 동작한다.

## 완료 판정 기준

```bash
grep -rn "global.usesqlite" --include="*.js" . | grep -v node_modules
# → mobius/db/index.js 한 줄만 남아야 함
```

추가로 `db_action.js`·`db_sqlite.js` 부재, 3층 검증 통과.

## 이번 작업으로 함께 해소되는 것

**SQLite 모드의 고아 `lookup` 행.** `insert_*`는 30개이고, `insert_lookup` 자신을 제외한 **29개 전부에 이미 보상 코드**(본문 insert 실패 시 `delete from lookup`)가 있다. 보상 횟수를 세면 원인이 드러난다.

| 보상 개수 | 함수 | 의미 |
|---|---|---|
| 2개 | `insert_cb`, `acp`, `ae`, `cnt`, `cin`, `sub` | SQLite 분기가 있어 양쪽에 보상 |
| 1개 | 나머지 23개 | MySQL 경로에만 보상 |

고아 행은 보상이 없어서가 아니라 **보상이 엉뚱한 DB를 지웠기** 때문이다. `insert_lookup`은 SQLite에 쓰고, 본문 insert는 MySQL에서 실패하고, 보상은 MySQL의 `lookup`을 지웠다. 파사드가 둘을 같은 백엔드로 보내면 보상이 정상 작동한다.

## 후속 작업 (이번 범위 밖)

1. **discovery 재귀 CTE 통일** — `search_lookup`(MySQL 배치 반복문)과 SQLite 재귀 CTE의 이원화 해소. MySQL 8.0.45·SQLite 3.44.2 모두 재귀 CTE를 지원하므로 통일 가능하나, MySQL 성능 특성이 달라지므로 대용량 트리 실측 비교가 선행되어야 한다.
2. **SQLite 트랜잭션 지원** — 핸들 풀 또는 직렬화 큐 도입 후 `capabilities.transaction: true`. 현재 SQLite 클러스터 환경의 `delete_oldest` 동시성은 보호되지 않는다.

## 위험 요소

| 위험 | 완화 |
|---|---|
| **분기 분류 오판으로 동작이 조용히 바뀜** | 정적 분석 도구는 양방향 오차가 있다(`insert_lookup` 은 진짜 차이, `update_ae` 는 오탐). 0a 단계에서 33개를 사람이 직접 판정하고 근거를 남긴다 |
| 109개 함수 전환 중 회귀 | 3층 검증 + 함수 단위 전환 + 매 단계 배포 가능 |
| 골든 테스트 커버리지 부족 | 커버리지를 매 단계 보고, 미커버 함수는 2·3층에 의존 |
| 동시 작업과의 충돌 | `sql_action.js`는 활발히 수정되는 파일이다. 착수 전 다른 작업 일정 확인 필요 |
| knex 유지보수 둔화 | 빌더로만 사용해 의존을 격리 |
| knex `noWait()` 예외 | `db.can('rowLock')` 검사 의무화 |
