# DB 레이어 헌장 — 목표, 현황, 남은 일

**최초 작성**: 2026-08-28
**마지막 갱신**: 2026-08-31 (오후, `eea50ef` 운영 배포 직후)
**기준선**: `lite` = `c6c3bd7`
**현재**: `lite` = `eea50ef` — **운영 배포 완료**
**작업 브랜치**: `worktree-db-layer-migrate`

> 이 문서는 "지금 어디까지 왔고 다음에 무엇을 하나" 하나만 답한다.
> 숫자는 전부 실측이다. 재는 방법도 같이 적어 두었으니 갱신할 때 다시 재라.

---

## 1. 목표

### 진짜 목표 (사용자의 말)

> **"sqlite, mysql 외 다른 DB 를 추가하더라도 최소한의 수정으로 적용할 수 있게
> 구조를 만드는 것."**
>
> "공통함수로 랩핑만 해 두면 해당 db 드라이버만 갈아 끼우면 선택한 db로
> 구동되게 할 수 있지 않을까? 나머지 코드는 래핑이 되어 있으니 코드 수정은
> 아예 없고, if 같은 분기도 없어도 될 것 같은데"

**완료 조건**: `mobius/db/<이름>.js` 파일 하나를 쓰면 끝. 그 파일 밖은 안 건드린다.

### 목표가 **아닌** 것

**두 백엔드의 내부 동작이 같을 것** — 아니다. 사용자가 직접 바로잡았다:

> "내부 동작까지 동일해야 하는 건 아니고 sqlite만의 기능이 있어야 하면
> 그게 동작하면 돼. 느낌에는 너무 하나로 맞출려고 하는 것 같아서."

이것을 좇으면 등가성을 커밋마다 게이트로 걸게 되는데, **백엔드마다 동작이
다른 것은 정상**이고 그게 어댑터가 있는 이유다. 지켜야 할 것은 하나다 —
운영(MySQL)이 안 깨질 것. 다른 백엔드는 *돌면* 된다.

원래 완료 기준이던 "`global.usesqlite` 를 읽는 곳을 한 곳으로" 는 **대리
지표**였다. 달성했지만(아래) 그것이 목표는 아니다.

### 곁가지로 자란 목표 둘

**(가) 배포 서버에 안전하게 반영할 수 있을 것** — 달성. 마이그레이션 러너를
만들었고 9건이 운영에 적용돼 있다(4절).

**(나) 전환하며 드러나는 실제 결함을 고칠 것** — 진행 중. 지금까지 **20건**.
이건 부산물이 아니라 이 작업의 실질적 가치다(5절).

---

## 2. 현황 — 한 줄로

**구조는 섰고 배선은 끝났다. 질의 본문의 전환이 63% 지점이다.**

| 지표 | 최초 | 2026-08-31 오전 | **지금** |
|------|------|----------------|---------|
| `global.usesqlite` 를 읽는 코드 | 44+ | 2 | **1** (파사드의 하위호환 갈래뿐) |
| 파사드를 우회해 커넥션을 얻는 파일 | 8 | 5 | **4** (전부 파사드 위 껍데기) |
| SQL 을 내는 함수 중 파사드 전환 | 0 | — | **65 / 104 (63%)** |
| MySQL 전용 구문이 남은 함수 | 다수 | — | **1** (`set_tuning`, 능력 게이트로 차단됨) |
| 어댑터 등록 | 손으로 적은 표 | 디렉터리 자동 인식 | 동일 |
| 백엔드 선택자 | `usesqlite` boolean | 이름 (`usedb`) | 동일 |
| 단위 테스트 | 0 | 773 | **800 pass / 0 fail** (56파일) |
| 등가성 하네스 | 없음 | 32단계 | 32단계, 양쪽 백엔드 |
| 마이그레이션 | 없음 | 러너 + 9건 | 9건 전부 운영 적용 |

**재는 방법** (숫자를 갱신할 때 그대로 쓸 것):

```bash
# usesqlite 리더 (주석 제외)
grep -rn "global\.usesqlite" --include=*.js mobius app.js | grep -vE ":\s*(//|\*)"

# 파사드 우회
grep -rn "require(['\"][^'\"]*db_\(action\|sqlite\)['\"])" --include=*.js mobius app.js

# 함수별 전환율 + 방언 잔존   (스크립트는 아래 6절에 있다)
node tools/classify-sql.js mobius/sql_action.js

npm test
```

### 이미 달성한 것

**어댑터는 파일 하나다.** `mobius/db/<이름>.js` 를 두면 파사드가 자동 등록하고
`test/db-adapter-contract.test.js` 가 그 파일도 검사해 **빠진 것을 이름으로
알려준다.** 목록을 손으로 고칠 필요가 없다.

**선택자가 이름이다.** 예전 `usesqlite` boolean 으로는 **세 번째 백엔드를 말할
방법이 아예 없었다.** 이제 `node mobius.js <이름>` 또는 `conf.json` 의
`"db": "<이름>"` 이다.

**커넥션 원천이 파사드 하나다.** 예전에는 `db_action` 이 자기 MySQL 풀을 들고
있어서 어느 백엔드를 골랐든 요청 경로가 늘 MySQL 에서 커넥션을 받았다. 실측
증상 — MySQL 을 닿지 않는 주소에 두고 SQLite 로 띄우면 `listen` 에 도달조차
못 했다(`acquireTimeout` 50초라 조용히 매달렸다). 지금은 뜬다.

**정리 주체가 하나다.** 보존 정책(mni/mbs) 정리를 마스터의 주기 스윕으로
옮겼다. 워커 25개가 동시에 정리하던 것이 `delete_oldest` 에 트랜잭션 + 행
잠금을 요구했고, **잠금이 없는 백엔드는 그 알고리즘을 못 써서 아예 다른 갈래를
들고 있었다.** 주체를 하나로 만들자 그 사슬이 통째로 사라졌다. 219줄 → 95줄.

---

## 3. 남은 거리 — 다음에 할 일

### 전체 작업 목록 (2026-08-31 확정)

| # | 작업 | 상태 |
|---|------|------|
| 1 | 공통 함수(파사드) — `mobius/db/index.js` | **완료** |
| 2 | 백엔드를 파일 하나로 — `mobius/db/<이름>.js` 자동 인식 | **완료** |
| 3 | 선택자를 이름으로 (`usedb`) | **완료** |
| 4 | 코어의 `if (usesqlite)` 제거 | **완료** (44+ → 1) |
| 5 | 커넥션 원천을 파사드 하나로 | **완료** |
| 6 | 어댑터 계약을 테스트로 못박기 | **완료** |
| 7 | 스키마 마이그레이션 수단 | **완료** (9건 운영 적용) |
| 8 | 회귀 검증 수단 | **완료** (테스트 800 / 등가성 32단계) |
| 9 | 질의를 공통 함수로 옮기기 | **완료** (97/97, 100%) |
| 10 | 스키마 두 벌의 어긋남 정리 | **완료** — 지원 타입 목록을 어댑터로 |
| 11 | `db_action.js`/`db_sqlite.js` 껍데기 제거 | **완료** — 임대 장부를 파사드로 |

## 전부 완료 (2026-09-01)

**요구를 만족한다. 새 백엔드는 `mobius/db/<이름>.js` 파일 하나로 붙는다.**

    손으로 쓴 SQL              39 -> 0
    파사드를 우회하는 파일       4 -> 0
    코어의 백엔드 이름 상수      1 -> 0
    global.usesqlite 리더        1 (파사드의 하위호환 갈래뿐)
    단위 테스트                869
    방언 종속 구문             없음

10번의 "어긋남" 은 재 보니 **SQLite 가 개발 중이라 아직 안 맞춘 상태**였다.
MySQL 18 테이블 / SQLite 9 테이블이고, 없는 9개(csr fcnt grp lcp mgo mms nod
smd sri)가 SQLite 가 아직 못 받는 타입들이다.

**목표는 MySQL 과 같게 맞추는 것이다** (사용자 확인, 2026-09-01). 그러니
`supportedResourceTypes` 목록은 임시이고, 스키마에 테이블을 추가할 때마다
줄어들다가 결국 `null`(제한 없음)이 된다.

진짜 문제는 그 목록이 `resource.js` 에 `SQLITE_SUPPORTED_TY` 라는 이름으로
있었다는 것이다 — 코어에, 한 백엔드 이름을 달고. 어댑터로 옮겼으니 이제
스키마와 목록을 같은 파일 근처에서 함께 고친다.

11번의 두 껍데기에 남아 있던 실제 로직은 **임대 장부** 하나였다. 취득처가
파사드인데 장부가 껍데기에 있으면, 코어가 파사드를 직접 부르는 순간 장부에서
빠진다. 파사드의 `getConnection` 으로 옮겼다.

`set_tuning` 은 옮기지 않고 **지웠다**(같은 날). MySQL 인스턴스의 전역 설정
넷을 기동마다 `SET GLOBAL` 로 바꾸던 함수인데, 배포의 `my.cnf` 와 정면으로
어긋나 있었다. 값은 그대로 두고 `SET PERSIST` 로 MySQL 자신의 설정에 옮겼다.

### 9번의 남은 39개 — 전부 `sql_action.js` 안에 있다

직접 SQL 은 이 파일 하나에만 있다(확인:
`grep -rn "util\.format(\s*[\"'](select|insert|update|delete)" --include=*.js .`
→ `sql_action.js` 외에는 테스트뿐).

**(가) 본문 INSERT 20개** — 기계적, 같은 모양의 반복

```
insert_grp  insert_lcp  insert_fcnt  insert_csr  insert_smd  insert_mms
insert_fwr  insert_bat  insert_dvi   insert_dvc  insert_rbo  insert_nod
insert_hd_bat  insert_hd_tempe  insert_hd_brigs  insert_hd_color
insert_hd_dooLK  insert_hd_binSh  insert_hd_fauDn  insert_hd_colSn
```

**(나) 본문 UPDATE 9개** — 같은 테이블들, 같은 모양

```
update_fwr  update_bat  update_dvi  update_dvc  update_rbo
update_nod  update_csr  update_smd  update_mms
```

**(다) SELECT 9개** — 난이도가 갈린다   ← **2026-09-01 완료**

```
살아 있어서 옮긴 것 (2):  select_csr  select_csr_like
호출부가 0이라 지운 것 (4): select_grp  select_grp_lookup  select_sub  select_st
남은 것 (3):  select_in_ri_list       IN 목록 동적 조립
             search_lookup_parents )  discovery 재귀 CTE — 가장 큰 덩어리
             build_search_query    )
```

여섯 중 넷이 죽은 코드였다. 옮기는 것보다 지우는 것이 맞다 — 죽은 코드를
옮기면 유지할 표면만 늘고 목표에는 보탬이 없다.

**(라) `set_tuning` 1개 — 옮기지 않는다.** `SET GLOBAL` 은 MySQL 서버 운영
튜닝이라 백엔드 중립이 아니다. 이미 `db.can('serverTuning')` 게이트 뒤에 있어
다른 백엔드로는 나가지 않는다. **어댑터 능력으로 처리된 정답 사례다.**

방언 종속 구문은 (라) 하나뿐. 나머지 38개는 **표준 SQL 을 문자열로 조립**할
뿐이라 옮기는 작업 자체는 위험하지 않다. 다만 파사드를 안 거치므로 바인딩·
에러 정규화·타임아웃이 적용되지 않고, 다음에 누가 방언 구문을 하나 넣으면
조용히 갈라진다.

### 진행 순서

1. ~~**(가)+(나) 29개를 한 묶음으로**~~ — **완료 2026-09-01** (`2cc44cc`).
   표 2개 + 생성자 2개. 733줄 -> 158줄.
2. ~~**(다)의 쉬운 6개**~~ — **완료 2026-09-01** (`baf88db`). 2개 전환, 4개 삭제.
3. **(다)의 discovery 3개** — 재귀 CTE. 별도 회차 크기. ← **다음**
4. 그 뒤 10·11번은 정리 성격.

**현재 96/100 (96%).** `node tools/classify-sql.js mobius/sql_action.js` 로 재라.
(그 도구는 한때 표로 대입된 29개를 세지 못해 전환율을 부풀렸다. 고쳤다.)

### 왜 이 작업이 가치 있나

지금까지 65개를 옮기며 **결함이 20건** 나왔다(5절). 옮기는 작업은 부수적으로
버그를 드러낸다 — 함수를 열어 보면 대개 뭔가 깨져 있었다.

---

### 참고: 옮기는 방법

이것이 목표까지 남은 **거의 전부**다.

```
SQL 을 내는 함수 104개
  파사드 전환 완료   65   <- 새 백엔드에서 그대로 돈다
  손으로 쓴 SQL      39   <- 여기서 걸린다
```

다만 **막힌 정도는 생각보다 얕다.** 그 39개를 실제로 들여다보면:

- 백틱 식별자: **0건**
- MySQL 전용 `LIMIT n, m`: **0건**
- MySQL 전용 구문이 남은 함수: **1개** (`set_tuning` 의 `SET GLOBAL`, 이미
  `db.can('serverTuning')` 게이트 뒤에 있어 다른 백엔드로는 안 나간다)

즉 39개 대부분은 **표준 SQL 을 문자열로 조립**하고 있을 뿐이다. 그래서
`postgres.js` 같은 걸 붙여도 상당 부분은 그냥 돈다. 문제는 "돈다는 보장이
없다" 는 것 — 파사드를 안 거치므로 바인딩·에러 정규화·타임아웃이 적용되지
않고, 다음에 누가 방언 구문을 하나 넣으면 조용히 갈라진다.

**하는 법**: 함수 하나씩 `facade.k()` 로 옮기고 등가성 하네스를 돌린다.
지금까지 65개를 그렇게 옮겼고 매번 결함이 하나씩 나왔다(5절).

### 우선순위 2. 스키마 두 벌의 어긋남

`mobius/mobiusdb.sql`(MySQL)과 `mobius/mobiusdb_sqlite.sql`(SQLite)이 서로
다르다. 오늘 그 어긋남이 실제로 새는 것을 확인했다 — SQLite 에 `csr` 테이블이
없어서 `grp` 생성이 501 대신 500 "database error" 로 나갔다.

게이트를 앞으로 옮겨 막았지만(`resource.js` 의 `check_db_support`), 근본은
**스키마가 어댑터의 일부로 관리되지 않는다**는 것이다. 새 백엔드를 붙이는
사람은 세 번째 `.sql` 을 써야 하고, 그것이 코어의 `SQLITE_SUPPORTED_TY`
같은 목록과 어떻게 맞물리는지가 문서화돼 있지 않다.

### 우선순위 3. `db_action.js` / `db_sqlite.js` 이름 정리

둘 다 이미 파사드 위 껍데기라 **기능적으로는 문제가 없다.** 다만
`db_sqlite.js` 라는 이름이 MySQL 커넥션을 돌려주는 상황이라 읽는 사람을
오도한다. 4개 파일(`resource.js`, `sgn.js`, `sql_action.js`, `app.js`)의
require 를 파사드 직접 호출로 바꾸면 두 파일을 지울 수 있다.

**우선순위가 낮은 이유**: 이름만의 문제다. 1번을 하다 보면 자연히 사라진다.

---

## 3.5 다음 작업 — SQLite 를 MySQL 과 같게

**이 헌장의 원래 범위(1~11번)는 끝났다.** 여기부터는 다음 회차다.

사용자 확인(2026-09-01): SQLite 는 개발 중이고 **MySQL 과 같은 리소스를
지원하는 것이 목표**다. 지금의 부분집합은 임시 상태다.

### 남은 것은 스키마뿐이다 — 타입 16개, 테이블 8개

본문 insert 는 전부 파사드를 탄다(손으로 쓴 SQL 0개). 그러니 SQLite 가 못 받는
이유는 **테이블이 없어서** 하나다. `mobiusdb.sql` 과 대조한 결과:

| 없는 테이블 | 타입 | 비고 |
|---|---|---|
| `grp` | 9 | `update_route` 가 `csr` 을 읽으므로 `csr` 과 함께 필요 |
| `lcp` | 10 | **생성이 원래 깨져 있다** — `cr` 이 NOT NULL 인데 INSERT 목록에 없다 |
| `mgo` | 13 | fwr/bat/dvi/dvc/rbo 공용. `type_resolver` 가 아직 400 으로 막는다 |
| `nod` | 14 | |
| `csr` | 16 | 원격 CSE 등록 |
| `smd` | 24 | |
| `mms` | 27 | |
| `fcnt` | 28 | hd_*(91~98)도 이 테이블을 쓴다 |
| `sri` | — | 레거시. 어느 타입도 안 쓴다 — **만들지 말 것** |

hd_*(91~98) 여덟은 전부 `fcnt` 를 쓴다 — 그 테이블 하나로 아홉 타입이 열린다.
`test/usesqlite-single-reader.test.js` 가 남은 수를 세고, 줄면 실패하며 새 수를 알려준다.

### 순서 제안

1. **`fcnt`** — hd_* 여덟 타입이 한꺼번에 열린다. 컬럼이 많아 가장 크지만
   효과도 가장 크다.
2. **`nod` + `csr` + `grp`** — `grp` 는 `csr` 없이는 500 이 난다.
3. **`smd` + `mms`** — 단순하다.
4. **`lcp`** — 넣기 전에 `cr` 결함을 먼저 고친다(아래).
5. **`mgo`** — `type_resolver` 의 400 게이트를 여는 판단이 함께 필요하다.

각 단계는 세 곳을 같이 고친다:

    mobius/mobiusdb_sqlite.sql            테이블 (+ 필요한 인덱스)
    mobius/db/sqlite.js                   supportedResourceTypes 에 타입 추가
    tools/sqlite-indexes.js               인덱스를 늘렸다면

`test/usesqlite-single-reader.test.js` 가 목록과 스키마를 대조하므로, 목록에만
추가하고 테이블을 빠뜨리면 실패한다. 반대(테이블만 추가)는 안 걸리니 주의.

### 함께 고쳐야 할 결함

- **`lcp` 생성은 어느 백엔드에서도 안 된다.** `lcp` 테이블의 `cr` 이 NOT NULL
  인데 `BODY_TABLES.insert_lcp` 의 컬럼 목록에 `cr` 이 없고, `build_lcp` 도
  `cr` 을 설정하지 않는다(`cnt.js`/`grp.js` 는 한다). 옛 SQL 을 글자 그대로
  돌려도 `ER_NO_DEFAULT_FOR_FIELD` 다 — 전환 이전부터 깨져 있었다.
- **`update_dvc` 는 호출되는 순간 워커가 죽는다.** `resource.js` 가 16개
  위치인자로 부르는데 서명은 `(connection, obj, callback)` 이다. 지금은
  `type_resolver` 가 mgo 를 막아 도달 불가지만, 5번에서 문을 열면 즉시 터진다.
- **`type_resolver` 의 mgo 400 게이트** — 막아 둔 근거("문자열 조립이라
  주입이 된다")는 해소됐다. 여는 것은 별도 판단이고, 그 아래 경로
  (`build_mgo` 의 mgd 분기, mgo 조회·수정·삭제)는 한 번도 밟힌 적이 없다.

### 그 밖에 남은 것

- **`my.cnf` 정리** — `innodb_flush_log_at_trx_commit = 1` / `max_connections = 300`
  이 `mysqld-auto.cnf` 에 덮여 무의미하다. root 권한이 필요해 못 고쳤다.
- **관리 UI 의 DB 설정 화면** — 이 작업들이 끝나면 착수(사용자 판단).
  검토 결과는 `mobius-fd` 가 냈다: 읽기 화면(세 값의 어긋남 표시)을 먼저,
  쓰기는 내구성 셋을 빼고, 감사 로그는 콘솔 인증이 먼저.

---

## 4. 인프라 — 이미 갖춰진 것

### 마이그레이션 러너

```
migrations/001-…  ~  009-…     번호순, 멱등
tools/migrate.js  --check      읽기 전용 점검
                  --apply      사람이 명시적으로 호출 (자동 실행 없음)
```

`schema_migrations` 테이블에 이력을 남긴다. **운영에 9건 전부 적용됨**
(최신 `009-widen-cb-srt`, 2026-08-30).

### 등가성 하네스

```bash
node mobius.js <백엔드>
MOBIUS_BASE=http://127.0.0.1:<포트> node tools/equivalence/run-scenarios.js out/A.json
node tools/equivalence/compare.js out/A.json out/B.json
```

32단계. **주의**: 보존 정책 정리는 스윕 주기(기본 10초) 안의 최종적 정리라
`cnt-after-purge` 단계는 그보다 오래 기다려야 한다(현재 13초).

백엔드 간 차이로 **정상**인 것: `grp-create-unsupported` 가 SQLite 501 /
MySQL 201, 그리고 그로 인한 discovery 목록 차이.

### 테스트

800건 / 56파일. 목표를 지키는 것 셋:

| 파일 | 무엇을 못박나 |
|------|--------------|
| `test/usesqlite-single-reader.test.js` | `usesqlite` 리더가 파사드 하나뿐일 것 |
| `test/db-adapter-contract.test.js` | 어댑터가 갖출 것 + 파사드 우회 파일 수(4) |
| `test/purge-sweep.test.js` | **진짜 SQLite 파일**에 대고 도는 스윕 |

마지막 것이 왜 중요한지: 모킹 tap 은 SQL 을 기록만 하고 실행하지 않아서
`select_over_limit` 이 `cnt` 에 없는 `ty` 를 읽는 것을 못 잡았다. 배포에
올라가서야 드러났을 것이다.

---

## 5. 지금까지 고친 실제 결함 (전부 실측 확인)

| # | 결함 | 영향 |
|---|------|------|
| 1 | ACP 정책 갱신이 SQLite 에서 유실 | 접근 제어가 안 바뀜 |
| 2 | 구독(SUB) 갱신이 SQLite 에서 유실 | 알림 설정이 안 바뀜 |
| 3 | SQL Injection 2건 (`update_lookup`, `update_acp`) | `pv` 는 클라이언트 입력 |
| 4 | `update_cnt_by_delete` 인자 누락 | CIN 을 지워도 `cni`/`cbs` 가 안 줄었다 |
| 5 | `get_cni_count` 가 매번 O(n) 재집계 | 100k 기준 7.2ms → 0.13ms (**56배**) |
| 6 | `st` 가 CIN 사건에만 반응 | purge·CNT생성·SUB삭제 시 안 올랐다 |
| 7 | CNT 생성 시 부모 캐시 미무효화 | 조회가 낡은 `st` 를 돌려줌 |
| 8 | 만료 스윕이 **정반대로** 동작 | 만료 대상은 남기고 그 자식을 지웠다 |
| 9 | `et` 기본값이 생성+2년 | 스윕이 고쳐지면 조용히 사라질 뻔했다 |
| 10 | `useCert` 뒤 10억회 busy-wait 스핀 | 죽은 코드였으나 되살아났으면 장애 |
| 11 | 파사드 빌더의 동기 throw | 워커가 죽었다 |
| 12 | **동시 CIN 생성 시 57% 유실** | 40건 동시 → 17건만 성공 (`rn` 충돌) |
| 13 | `la`/`ol`/`delete_oldest` 가 틀린 대상 선택 | `ct` 초 단위 동점 |
| 14 | **SQLite 스키마에 인덱스 0개** | 매 요청이 풀스캔 (14.19ms → 0.18ms, **77배**) |
| 15 | `cnt_man` 의 2차 SQL Injection | 운영에서 `ER_PARSE_ERROR` 재현 |
| 16 | `conf.json` 을 기동 때 파괴 | 8키 → 3키, `adminPassword` 소실 (6절) |
| 17 | `select_over_limit` 이 `cnt` 에 없는 `ty` 를 읽음 | SQLite 에서 스윕이 통째로 실패 |
| 18 | SQLite 에서 한도 비교가 사전순 | `'9' > '10'` 이 참 — 멀쩡한 컨테이너를 정리 대상으로 |
| 19 | **삭제 전 실측 관문 소실** | 저장값이 부풀면 **한도 안의 CIN 을 지운다** |
| 20 | `parseInt(mni \|\| 0)` 이 NULL 한도를 0으로 | `mni=0` = "전부 지워라" |

17~20 은 **이번 회차에 내가 만든 것을 배포 직전 검토로 잡은 것**이다.
19는 구 코드에 있던 안전장치를 트랜잭션 걷어내며 같이 지운 경우다 —
리팩터링 중 안전장치가 딸려 나가는 전형이라 기록해 둔다.

정합 작업은 운영 DB 에서 **실제 드리프트 3건**을 찾아 교정했다.

---

## 6. 운영 배포 시 지켜야 할 것

- 배포는 `gcs.iotocean.org`, **MySQL** (`conf.json` 의 `usesqlite: "false"`).
  규모: `cin` 1억 4559만 행 / 265GB, `lookup` 6194만 행 / 84GB, `cnt` 30,376행.
  요청 초당 3.6건.
- 스키마 변경은 **마이그레이션을 먼저 돌리고** 코드를 올린다. 자동 실행 없다.
- `pm2 restart Mobius`. pm2 는 `/home/keti/.nvm/versions/node/v22.22.2/bin` 에 있다.
- **배포 DB 에 무거운 질의를 던지지 말 것.** 상관 서브쿼리 한 방
  (`count(*)` per row over 1억 4천만 행)이 5분을 넘겨 두 번 죽였다.
  컨테이너별로 쪼개면 개당 0.008~0.114초다.
- **`conf.json` 의 키가 3개뿐이다** (`csebaseport`, `dbpass`, `usesqlite`).
  16번 결함으로 `adminPassword` 등이 소실된 상태 그대로다. 파괴는 막았지만
  잃은 값은 복구되지 않았다 — 관리 UI 작업과 함께 볼 것.

### 보존 정책(mni/mbs) — 이제 실제로 돈다

2026-08-31 배포로 마스터의 주기 스윕이 켜졌다. 그날 **CIN 310,502건(약 6.4GB)을
약 4시간에 걸쳐 정리**했다. 전부 휴면 컨테이너(마지막 입력 08-19)였다.

- 한 바퀴에 컨테이너당 최대 `MAX_PURGE_PER_PASS`(=100)건. 주기는
  `conf.purgeSweepMs`(기본 10000).
- **소요 시간은 가장 큰 컨테이너가 지배한다.** 총량 ÷ 처리량이 아니다.
  118,041건 초과 = 1,181바퀴 = 약 4시간.
- 삭제 비용 실측: 100건에 0.263초(행당 **2.6ms**). 코드 주석의 40ms/행은
  워커들이 락을 두고 다투던 시절 값이다.
- `[purge_sweep] 초과 N개 중 …` 로그가 몇 시간 계속 나오는 것이 정상이다.

**데이터를 남기고 싶으면 삭제를 막는 게 아니라 그 컨테이너의 `mni` 를 올린다.**
스윕은 `mni` 를 그대로 따른다.

---

## 7. 이 작업의 동작 변화 — 클라이언트가 보는 것

| 무엇 | 전 | 후 |
|------|----|----|
| `mni` 강제 시점 | CIN 삽입과 동기 | 스윕 주기 안의 최종적 정리 (기본 ≤10초) |
| CIN 응답의 `st` | 연속 생성 시 전부 같은 값 | 매 건 증가 (부모 `lookup.st + 1`) |
| 컨테이너 PUT 응답의 `cni`/`cbs` | 정리 후 값 | 정리 전 저장값 |
| `grp` 생성 (SQLite) | 500 "database error" | 501 "not supported" |

첫 줄이 가장 중요하다 — **CIN 을 넣고 바로 GET 하면 `cni > mni` 를 볼 수 있다.**
이것은 결함이 아니라 이 설계가 받아들인 것이다. 잠금을 없애는 대가다.

---

## 8. 참고 문서

| 문서 | 내용 |
|------|------|
| `2026-08-29-admin-ui-handoff.md` | 만료 스윕·대형 컨테이너를 자동 실행하지 않는 이유 |
| `2026-08-29-acp-console-contract.md` | ACP 콘솔 계약 |
| `2026-08-29-acp-operating-model.md` | ACP 운영 모델 |
| `2026-08-29-discovery-remaining.md` | discovery 재귀 CTE 남은 항목 |
| `2026-08-29-acp-survey.md` | 운영 ACP 실태 조사 |

---

## 9. 작업 목록 (2026-09-01 갱신)

원래 11개 항목은 전부 완료·배포됐다(2절). 그 뒤 배포 검증과 브랜치 조사에서
드러난 것들을 여기 모은다. **순서는 아래 제안 순이다.**

### 0. discovery 자식 조회 range 전환 — **완료 (`fa8250d`, 배포됨)**

배포 실측 11.74초 → 0.22초. 페이징 정합 2,806건 / 중복 0.
중간에 한 번 되돌렸다(`3eda078`) — `ofst` 유무로 경로가 갈려 페이지가
어긋났고, 2,806건이 2,558건 + 중복 248건으로 나왔다. 지금은 경로가 하나다.

### 1. superUser 기본값 — **바꾸지 않기로 결정 (2026-09-01)**

`mobius.js` 의 `usesuperuser` 기본값 `Sponde` 가 공개 소스에 있는 것은
**의도된 설계다.** 사용자 확인:

- `Sponde` 는 사용자가 정한 디폴트이고, 배포 시 바꿀지는 **배포자가 결정**한다
- 클라이언트는 이 값을 아는 사람이 필요할 때 쓴다 — 아무에게나 알리지 않는다
- **conf 로 빼지 않고 소스에 둔 이유가 “필요한 사람이 찾아서 알 수 있게”** 다
- 새 값으로 바꿀 계획이 없다

보안 항목으로 다시 올리지 말 것. 배포자가 값을 바꾸겠다고 먼저 말한 경우에만
이전 작업(쓰는 클라이언트 식별 → conf.json 에 값 추가 → 도구 이전 → 재기동)을
돕는다. `mobius.js:78` 주석도 같은 이유로 기본값을 유지한다고 적고 있다.

### 2. `la` 타임아웃 — **완료 (`e932e66` + `47340da`, 배포됨)**

`?fu=1&la=N` 이 큰 컨테이너에서 30초 500 이었다. 배포 실측 30초 → **0.065초**.

**정의(사용자 확인 2026-09-01): discovery 의 `la` 는 컨테이너에만 적용되고,
그 컨테이너의 직속 CIN 중 최신 N 건을 준다.**

구현이 그 정의와 달랐다. `presearch_action` 이 `ty` 도 `lvl` 도 안 박아서
골격 전체(컨테이너 2,806개)를 훑었고, CIN 이 아닌 리소스도 섞여 나왔다.

고친 것은 둘이다.

1. `presearch_action` 이 `la` 요청에 `ty=4` / `lvl=1` 을 못박는다 → 부모가 하나
2. 그것만으로는 여전히 filesort 였다. 배포에서 모양을 갈라 재 보니 **두 조건이
   동시에** 필요했다:

   | 모양 | 접근 | 정렬 |
   |---|---|---|
   | CTE + join (+force 여부 무관) | const/ref | filesort |
   | `pi IN (...)` + force index | ref | filesort |
   | **`pi IN (...)`, 강제 없음** | **range** | **정렬 없음** |

   `pi` 가 조인이 아니라 **상수**여야 하고, **인덱스를 강제하면 안 된다.**
   강제가 필요했던 원래 이유(옵티마이저가 PRIMARY 를 골라 CIN 을 전부 읽는 것)는
   *정렬이 없는* 질의의 이야기라 `la` 에는 해당하지 않는다.

#### 검토했다가 기각한 것 — 인덱스 확장

`(pi, ty, ct)` 를 `(pi, ty, ct, ri)` 로 넓히는 안을 검토했다. **기각.**
두 가지가 드러났다.

**(1) 그걸로는 안 고쳐진다.** 부모가 둘 이상이면 어떤 인덱스로도 filesort 다.
인덱스는 한 `pi` 안에서만 순서를 알고, 여러 `pi` 범위를 병합하는 것은 인덱스가
하는 일이 아니다. MySQL/SQLite 동일.

**(2) 애초에 두 스키마는 이미 같은 인덱스다.** "비대칭" 이라고 적었던 것을
바로잡는다 — 선언만 다르고 실제 구성은 같다.

| | 선언 | 엔진이 덧붙이는 것 | 실제 구성 |
|---|---|---|---|
| MySQL | `(pi, ty, ct)` | PK 컬럼 `ri` (PK = `pi, ri, ty`) | `(pi, ty, ct, ri)` |
| SQLite | `(pi, ty, ct, ri)` | rowid (`ri` 가 아니다) | `(pi, ty, ct, ri)` |

InnoDB 는 보조 인덱스에 PK 컬럼을 자동으로 붙인다. SQLite 는 rowid 를 붙이는데
`ri` 는 `TEXT PRIMARY KEY` 라 rowid 가 아니다. **그래서 SQLite 만 `ri` 를
명시해야 같아진다.** 실측:

    SQLite (pi, ty, ct, ri)   SEARCH USING COVERING INDEX               정렬 없음
    SQLite (pi, ty, ct)       USE TEMP B-TREE FOR RIGHT PART OF ORDER BY  부분 정렬
    MySQL  (pi, ty, ct)       range, Using index                        정렬 없음

**어느 쪽도 바꾸지 말 것.** SQLite 에서 `ri` 를 빼면 부분 정렬이 생기고
커버링도 잃는다. MySQL 에 `ri` 를 더하면 이미 있는 것을 중복으로 넣는 셈이라
84GB 인덱스만 커진다.

### 3. discovery 안내 응답 — **완료 (`522cd66`, 배포됨)**

`500-6`(탐색이 문장 상한에 걸림)을 `INTERNAL_SERVER_ERROR`(5000/HTTP 500)에서
`BAD_REQUEST`(4000/HTTP 400)로 바꿨다. 서버가 고장난 것이 아니라 요청의 범위가
감당 밖이고, 같은 요청을 다시 보내면 반드시 또 실패한다 — "재시도하면 될 수도
있다" 를 뜻하는 5xx 는 30초를 태우는 재시도를 부른다.

메시지도 할 수 있는 일을 다 적는다:

    "discovery scope too large — narrow the target path,
     add a ty filter, or use cra/crb to bound the time range"

**이 사유가 남은 자리는 하나뿐이다** — `cty` / `sza` / `szb` 처럼 cin 을
조인하는 필터. 원인은 `cnf` 컬럼이다: 인덱스가 없고 **배포에서는 값이 비어
있다**(표본 확인). 아무것도 못 맞춘 채 후보 2,282만 건을 전부 훑고 빈 결과를
낸다 — `cra` 에서 본 "매칭 0건이 최악" 과 같은 패턴이다. 값이 비어 있으니
인덱스로 풀 문제가 아니고 범위를 좁히는 것이 유일한 답이라, 안내가 맞다.

#### 후속 후보 (별개 작업)

지금은 30초를 태운 **뒤에** 안내한다. 골격 질의가 0.32초로 끝나므로 부모 수를
미리 알 수 있고, 경계 있는 count(0.05초)로 후보 규모도 싸게 잴 수 있다.
`needs_cin_join` 이면서 후보가 크면 **즉시** 거절할 수 있다. 실익은
30초 커넥션 점유를 없애는 것이다.

### 4. 브랜치 통합 — 결정 완료, 실행은 part1 대기

`lite` 에 미병합 4개. **넷 다 지금 병합하지 않는다**(`git merge-tree` 실측).

| 브랜치 | 텍스트 충돌 | 처분 |
|---|---|---|
| `perf/request-flow-analysis` | 1 (`.gitignore`) | **폐기** — 병합 결과가 lite 와 동일(순이득 0). 내용은 아래에서 건졌다 |
| `tmp-confonly` | 3 | **폐기** — lite 의 하위집합. 병합하면 16줄 추가 / 126줄 삭제(회귀) |
| `feat/admin-console-part0` | 10 | **통째 병합 안 함.** 남는 값만 lite 위에서 새로 만든다 |
| `feat/admin-console-part1` | **0 (깨끗)** | **대기.** 그래서 더 위험 — `git merge` 가 조용히 성공한다 |

#### 선행 결정 3건 — **사용자 결정 완료 (2026-09-01)**

**결정 1. 인덱스 셋은 lite 를 유지한다.**
`part0` 이 되살리려는 `idx_lookup_pi(pi)`·`idx_lookup_ct(ct)` 는 lite 가 배포
실측으로 지운 것이다(각각 읽기 0회 / 9.49GB, 40.6시간 0회 / 15.6GB). `part0`
쪽을 채택하면 `test/schema-drift.test.js` 가 즉시 실패한다 — `part0` 에는
`migrations/` 디렉터리 자체가 없어 반대 근거도 없다.

**결정 2. 관리 콘솔은 기존 `superUser` 를 그대로 쓴다 — `adminOrigin` 은 안 만든다.**
`part0` 은 `security.js` 에 `is_admin` 분기를 넣어 수퍼유저와 **동급의 마스터
키를 하나 더** 만들었다. 키는 하나로 유지한다.

> **관리 콘솔 작업(`feat/admin-console-part1`)에 영향이 있다.** 그쪽은 지금
> `admin/conf_store.js` 와 `admin/cse.js` 가 `adminOrigin` 을 전제로 만들어져
> 있다. 병합 전에 `superUser` 를 쓰도록 바꿔야 한다.

또한 `part0` 의 `conf.superuser`(소문자)는 어느 쪽이든 버린다 — 운영 설정 키는
`superUser` 이고, 소문자로 읽으면 설정값을 못 보고 기본값으로 조용히 떨어진다.

**결정 3. 리소스 경로 캐시는 되살리지 않는다.**
lite 가 배포 실측으로 제거한 것이다 — `subl` 항목 14,028 vs 실제 `sub` 행
3,452(유령 9,475건). `part0` 의 `cache_man.js` 는 LRU + 클러스터 IPC 무효화까지
갖췄지만 `get` 이 저장된 객체를 **참조로** 돌려줘 같은 실패 모드가 재현된다.
(정정: 실제 원인은 참조 공유가 아니라 캐시 키와 무효화 키의 불일치로 인한
낡은 읽기였다 — `app.js:84-137` 참고. 되살릴 때의 조건도 거기 있다.)

#### 실행 순서

1. `perf/request-flow-analysis` · `tmp-confonly` 폐기 (삭제는 사용자 판단)
2. `part1` 세션이 손을 뗄 때까지 대기 → 그쪽에서 `origin/lite` 를 먼저 머지하고
   `adminOrigin` 을 `superUser` 로 바꾼 뒤 → `part1` 병합
3. `part0` 은 병합하지 않고 남는 값만 lite 위에서 새로 만든다:
   `hit_ri` + `hit_man`, `mobius/db/index.js` 의 `conflictRef` 노출,
   `acp_eval` 재추출(lite 의 creator 우회·trace·acp_observe 를 보존하는 형태)

### 5. `my.cnf` 정리 — root 필요

`mysqld.cnf:100` 이 `innodb_flush_log_at_trx_commit = 1` 인데 실제 적용값은
`SET PERSIST` 의 `0` 이다. 파일이 현실과 반대라 읽는 사람이 속는다.

### 6. SQLite → MySQL 리소스 파리티

타입 16개 / 테이블 8개. `fcnt` 먼저(28 + `hd_*` 여덟 = 아홉 타입이 한 번에).
진척은 `test/usesqlite-single-reader.test.js` 가 자동 계측한다.
가는 길에 기존 결함 3건(`lcp` 의 `cr` 누락 / `update_dvc` 시그니처 /
`mgo` 400 게이트)을 함께 처리한다.

### 7. 추상화 잔여 — 원래 목표 기준

- `app.js` 의 포트 `3306`·사용자 `'root'` 하드코딩 3곳
- `migrations/` 가 백엔드 종속 (9개 중 8개 `backends:['mysql']`, 007 은
  `usesqlite` 를 직접 읽는다 — 단일리더 테스트 범위 밖이라 안 걸린다)
- 스키마 `.sql` 이 어댑터 옆이 아님 → 실제로는 파일 두 개
- 코어의 능력 분기 2개 (`sql_action.js` 의 rowLock / transaction — 후자는 중복)
- MySQL errno(3024, 1176)를 코어가 직접 매칭

---

## 10. 2026-08-26 성능 분석 문서 분류 (2026-09-01)

`perf/request-flow-analysis` 를 폐기하기 전에 그 안의 12개 항목을 현재 코드와
대조했다. **7개는 완전히 해소**, 5개는 곁가지만 남았다.

**문서 자체는 저장소에 넣지 않는다.** 전제 구조가 사라진 항목이 절반이고,
틀린 내용이 남아 있다 — 위치가 틀렸고(`db_action.js:32` 는 파일 자체가 없다),
캐시 문제의 진단이 틀렸고, `while(count--)` 스핀은 `useCert` 하드코딩 때문에
실행된 적 없는 죽은 코드였으며, "`disable` 이면 ACP 조회를 건너뛴다" 는 그대로
적용하면 **지금 통과하는 요청을 거부로 바꾸는 잘못된 처방**이다.
사유는 이미 코드와 테스트가 더 정확하게 갖고 있다.

### 살아남은 5건

| 항목 | 크기 | 근거 |
|---|---|---|
| MySQL 풀 `connectionLimit` 100 → 10~20 | 작음 | 아래 참조 |
| POST 의 여분 커넥션 취득 제거 | 작음 | `app.js:1918-1927` 만 `getConnection` 을 따로 부른다. GET/PUT/DELETE 는 이미 `request.db_connection` 재사용 |
| 요청당 stdout 3줄 + `shortid` 1회 제거 | 작음 | `app.js:1624`, `app.js:1697-1700`. morgan 이 이미 회전 파일로 access 로그를 남겨 중복이다. `sql_action` 의 타이머 30여 쌍은 배포 진단에 쓰이므로 삭제가 아니라 환경변수 게이트 |
| SQLite `PRAGMA journal_mode=WAL` / `synchronous=NORMAL`, `verbose()` 제거 | 작음 | 저장소 전체에 `journal_mode` 가 0건. `app.js:335` 가 백엔드 무관하게 코어 수만큼 포크하므로 한 파일을 여러 프로세스가 여는 전제가 살아 있다 |
| `select_acp_cnt` 재귀를 접두사 `IN (...)` 한 번으로 | 중간 | `sql_action.js:1919-1948`. 조상 단계마다 왕복 1회. creator 우회가 흔한 경로를 이미 걷어내 우선순위는 낮다 |

#### 커넥션 풀 — 배포 실측 (2026-09-01)

    max_connections        2,000      (MySQL 천장)
    앱이 시도 가능한 최대   2,500      (25 프로세스 x connectionLimit 100)
    Max_used_connections      59      (지금까지의 실제 최대)
    Threads_connected         29      (측정 시점)

워커는 싱글 스레드라 in-flight 요청당 최대 2개(POST 의 `set_hit` + 본 처리)밖에
못 쥔다. 100 은 실제로 쓸 수 없는 수이고, 이론상 최대가 천장을 넘는다.
`set_tuning` 이 `max_connections` 를 올리던 것도 사라져(`f4e26ec`) 이제
애플리케이션이 천장을 통제하지 않는다.

착수 순서: (1) POST 여분 커넥션 제거 → (2) 배포에서 `lease.stats()` 로 동시
임대 최대치 측정 → (3) `connectionLimit` 하향. 이 셋이 한 묶음이다.
`mobius/lease.js:8` 의 "풀 한도는 워커당 100" 주석도 함께 고쳐야 한다.
