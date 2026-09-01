# DB 설정을 관리 UI 에서 — 계획

- 작성일: 2026-09-01
- 요청: `mobius-aa` 경유 사용자 지시. **계획만. 구현 착수는 사용자 확인 후.**
- 코어 준비: `origin/lite` — `conf_schema` 에 6개 키 추가
- 관련: [목표 재정의](2026-09-01-admin-console-purpose.md) §2.8 (MySQL 파라미터 검토), §8 (백업)

---

## 0. 결론 — 화면이 둘이고 성격이 다르다

| | 어디에 저장되나 | 지금 상태 | 이 계획 |
|---|---|---|---|
| **A. conf.json 키 6개** | `conf.json` | **이미 화면에 뜬다.** 코어가 표에 올렸고 내 설정 화면이 그 표를 읽는다 | 쓰기까지 **지금 된다.** 남은 일은 화면이 거짓말하지 않게 만드는 것 |
| **B. MySQL 서버 설정** | MySQL 인스턴스 | 화면 없음 | **읽기 전용부터.** 쓰기는 조건부 |

A 는 이미 동작하므로 이 계획의 대부분은 **"뜨는 것" 과 "맞는 것" 의 차이**를
메우는 데 있다.

---

## 1. A — conf.json 키 6개

### 이미 뜨는 것이 맞다 — 확인했다

`origin/lite` 의 `conf_schema.describe()` 를 실제로 불러 확인했다. 노출 키가
11 → **17개**가 됐고 6개가 전부 **저장소** 묶음으로 들어온다.

    [저장소] db, dbConnectionLimit, dbQueueLimit, purgeSweepMs,
             retentionPolicies, sqliteBusyTimeoutMs, sqliteJournalMode,
             sqliteSynchronous

내 `ConfView` 는 소속을 코어에서 받고(`describe().group`) 순서·설명만 화면이
갖는다. **저장소는 이미 설명이 있으므로 추가 작업 없이 뜬다.** 코어 쪽 주장이
맞다.

> `mobius-aa` 는 5개라고 했는데 실제로는 `purgeSweepMs` 를 포함해 6개다.

### 그런데 이대로 두면 화면이 나빠진다 — 고칠 것 셋

**① 저장소 묶음이 8개로 불었고, 그중 5개가 백엔드 전용이다.**

사용자가 분류를 요청한 이유가 *"11개가 한 줄로 늘어서 보이지 않는다"* 였다.
이제 한 묶음이 8개다. 게다가 섞여 있다:

    db, retentionPolicies, purgeSweepMs      양쪽 공통
    dbConnectionLimit, dbQueueLimit          MySQL 전용 (SQLite 는 풀이 없다)
    sqliteJournalMode, sqliteSynchronous,
    sqliteBusyTimeoutMs                      SQLite 전용

**SQLite 로 돌 때 `dbConnectionLimit` 을 고치면 아무 일도 안 일어난다.**
코어 help 도 그렇게 적었다. 화면이 그걸 말해야 한다.

콘솔은 지금 돌고 있는 백엔드를 안다. **해당 없는 키는 흐리게 하고 "이 백엔드에는
적용되지 않습니다" 를 붙인다.** 숨기지는 않는다 — 백엔드를 바꾸면 살아나는 값이라
숨기면 왜 없는지 알 수 없다.

**② `sqliteJournalMode` 는 conf 값이 곧 파일의 모드가 아니다.**

이 키만 성격이 다르다. 나머지는 프로세스 안에서만 쓰이는데 **`journal_mode` 는
DB 파일에 영속된다.** 그래서 값이 두 곳에 있고 어긋날 수 있다:

    conf.json 의 sqliteJournalMode     화면이 보여 주는 값
    DB 파일의 실제 journal_mode        진짜 값

코어는 매 기동 `PRAGMA journal_mode = <conf값>` 을 건다. 실측으로 확인했다:

- **다른 커넥션이 유휴로 열려 있어도 전환은 성공한다.** (콘솔이 파일을 연 채
  워커가 떠도 WAL 로 바뀐다 — 확인함)
- **다른 커넥션이 트랜잭션을 쥐고 있으면 `SQLITE_BUSY` 로 실패한다.**

문제는 실패했을 때다. 코어는 이렇게 쓴다:

    db.configure('busyTimeout', busy_timeout_ms());
    db.run('PRAGMA journal_mode = ' + journal_mode());     // 콜백 없음

콜백이 없고 Database 에 `'error'` 리스너도 없다. node-sqlite3 는 이때 에러를
`'error'` 이벤트로 뿜고, 듣는 이가 없으면 **미처리 예외**가 된다. 즉 실패가
로그로 남는 게 아니라 워커를 죽인다.

**화면의 답:** conf 값을 "적용된 값" 처럼 보여 주지 않는다. **파일의 실제
`journal_mode` 를 읽어 나란히 보여 준다.** 어긋나면 그것 자체가 알림이다.
이건 MySQL 의 세 값 문제(§2)와 같은 모양이고, 내가 §8 백업 계획에서 세운
`blocksWrites` 프리플라이트가 읽는 값과도 같은 값이다 — 한 번 만들어 둘이 쓴다.

> 코어에 보고할 것: `PRAGMA` 셋에 콜백을 달아 실패를 로그로 남기는 것.
> 이건 코어 코드라 내가 안 고친다.

**③ `dbConnectionLimit` 은 혼자 정할 수 없는 값이다.** → §3

---

## 2. B — MySQL 서버 설정 화면

§2.8 검토 결론이 그대로 선다. 여기서는 그 위에 코어가 준 실측을 얹는다.

### 읽기 화면부터. 값은 셋을 나란히 보여 준다

    my.cnf 에 적힌 값        DBA 가 보는 값
    SET PERSIST 된 값        mysqld-auto.cnf. my.cnf 를 이긴다
    지금 도는 값             실제로 적용되고 있는 값

**하나만 보여 주면 어느 것이든 거짓말이 된다.** 배포 실측이 그 증거다 —
`my.cnf` 는 `max_connections = 300` 인데 실제는 `800` 이다.

읽기는 `SHOW VARIABLES` 와 `performance_schema.persisted_variables` 로 되고
**`SYSTEM_VARIABLES_ADMIN` 이 필요 없다.** 그래서 이 화면은 지금 만들 수 있고
위험이 0 이다.

### 쓰기 — §2.8 의 판단을 유지한다

| 파라미터 | 판단 |
|---|---|
| `innodb_flush_log_at_trx_commit`, `sync_binlog`, `transaction_isolation` | **읽기 전용.** 성능 손잡이가 아니라 "데이터를 잃어도 되는가" 결정이다 |
| `long_query_time`, `slow_query_log`, `innodb_io_capacity` | 쓰기 후보. 진단·성능이고 되돌리기 쉽다 |
| `max_connections` | **§3 의 바닥 계산 없이는 열지 않는다** |

그리고 §2.8 에서 세운 것 둘이 그대로 유효하다.

- **전용 DB 계정은 경계가 아니다.** 콘솔이 그 자격증명을 들고 있고 콘솔 인증은
  공유 비밀번호 하나다. `콘솔 비밀번호 하나 → SYSTEM_VARIABLES_ADMIN` 이 된다.
- 만든다면 **자격증명을 `conf.json` 밖에** 두고 **화이트리스트를 코어 스키마에**
  둔다.

### 되돌리기가 두 동작이라는 것을 화면이 말해야 한다

`RESET PERSIST` 는 `mysqld-auto.cnf` 에서 항목만 지우고 **도는 값은 안 되돌린다.**
바꾸기 전의 *도는 값*을 기록해 뒀다가 `SET GLOBAL` 로 되돌려야 한다.

### "적용됨" 을 함부로 쓰지 않는다

`SET GLOBAL transaction_isolation` 은 **이미 열린 커넥션에 안 먹는다.** 풀이
커넥션을 재사용하므로 며칠 갈 수도 있다. 화면은 "적용됨" 이 아니라 **"재기동
필요"** 로 표시한다.

---

## 3. A 와 B 가 서로를 잡는다 — 이 계획의 핵심

**`max_connections` 의 바닥은 `dbConnectionLimit × 프로세스 수` 다.**

    배포: 워커 24 + 마스터 1 = 25 프로세스
    dbConnectionLimit = 25  ->  바닥 625

두 값이 **다른 화면, 다른 저장소**에 있다. 따로 움직이면 Mobius 가 커넥션을 못
얻어 멈춘다. 이건 두 화면을 각각 잘 만들어서는 안 풀리는 문제다.

**설계:**

1. **두 값을 서로의 화면에 같이 보여 준다.** conf 화면의 `dbConnectionLimit`
   옆에 "× 25 프로세스 = 625 필요, 현재 `max_connections` 800" 을 띄운다.
   MySQL 화면의 `max_connections` 옆에 같은 계산을 띄운다.
2. **바닥 아래로는 못 내리게 막는다.** 경고가 아니라 거부다.
3. **프로세스 수를 추측하지 않는다.** 코어가 워커 수를 정한다(`app.js` 가 코어
   수만큼 포크). 콘솔이 `os.cpus().length` 로 다시 계산하면 배포와 갈린다 —
   **코어가 실제 워커 수를 알려 주는 값이 필요하다.** 없으면 화면은 계산을
   보여 주되 "프로세스 수는 확인되지 않음" 으로 두고 **막지 않는다.**
   근거 없이 막으면 정당한 변경을 막는다.

> 코어에 요청할 것: 실제 워커 수. `/api/conf` 가 쓰는 값이면 충분하다.

---

## 4. 자동 적용(migration 010)과 화면 편집이 부딪히는가

`mobius/db_bootstrap.js` 가 기동 시 `migrations/010-server-durability.js` 를
**한 번만** 적용하고 `schema_migrations` 에 기록한다. 그래서:

- 신규 설치는 권장값으로 뜬다.
- **이미 적용된 시스템에서는 다시 안 돈다.** 운영자가 화면에서 바꾼 값을
  덮어쓰지 않는다. 코어가 배포에서 `max_connections` 1200 으로 바꾸고 재기동해
  유지되는 것을 확인했다고 한다.

**충돌하지 않는다.** 다만 화면에 남길 것 하나 — MySQL 화면의 각 값 옆에
**"이 값은 설치 시 migration 010 이 세운 값이다 / 그 뒤 사람이 바꾼 값이다"** 를
구분해 보여 주면 좋다. `performance_schema.persisted_variables` 에 있으면
누군가 `SET PERSIST` 한 것이고, 없으면 `my.cnf` 나 기본값이다.

**주의 하나.** `schema_migrations` 를 잃거나 DB 를 새로 복구하면 010 이 다시
돈다. §8 백업 계획의 복구 절차에 **"복구 후 migration 이 값을 되돌릴 수 있다"**
를 적어 둔다.

---

## 5. SQLite 쪽 대응

    innodb_flush_log_at_trx_commit  ->  PRAGMA synchronous
    max_connections / 풀 크기        ->  busyTimeout (핸들이 하나뿐)
    sync_binlog                      ->  대응 없음
    transaction_isolation            ->  대응 없음 (언제나 직렬화)
    (대응 없음)                      <-  journal_mode  ★ SQLite 에서 가장 중요

**SQLite 에는 "서버 설정 화면" 이 없다.** 서버가 없기 때문이다. 세 값이 전부
conf.json 에 있으므로 **A 화면 하나로 끝난다.** 이게 B 와의 큰 차이다.

다만 §1-② 때문에 `journal_mode` 만은 **파일의 실제 값을 읽어 나란히 보여야**
한다. 즉 SQLite 도 "두 값을 나란히" 가 필요하다 — 형태만 다르지 MySQL 의 세 값과
같은 문제다.

---

## 6. 단계

    0  이 계획을 사용자가 확인한다                        ← 지금 여기
    1  conf 화면 개선 (A) — 백엔드에 해당 없는 키 흐리게,
       journal_mode 실제값 나란히, dbConnectionLimit 바닥 계산 표시
       ※ 코어 워커 수 값이 오기 전에는 계산만 보여 주고 막지 않는다
    2  MySQL 읽기 전용 화면 (B) — 세 값 나란히. SYSTEM_VARIABLES_ADMIN 불필요
    3  사용자가 2 를 보고 나서 쓰기 범위를 정한다
    4  (승인되면) 쓰기 — 진단·성능 계열부터. 내구성 3종은 읽기 전용 유지

**2 를 먼저 만들고 3 에서 정하는 순서가 §2.8 의 결론이다.** 지금은 무엇이
어긋나 있는지 목록으로만 아는데, 화면으로 보면 "이건 UI 에서 바꾸고 싶다 /
이건 손대면 안 되겠다" 가 훨씬 분명해진다.

---

## 7. 이 계획이 안 하는 것

- **`my.cnf` 편집.** root 파일 접근이 필요하고, "콘솔은 실행할 명령·경로를
  설정에서 받지 않는다" 와 같은 이유로 막는다.
- **"누가 바꿨는가" 기록.** 콘솔 인증이 공유 비밀번호 하나라 **적을 수 없다.**
  적으려면 사용자별 인증이 먼저다(목표 재정의 §7 ②).
- **SQLite `journal_mode` 를 콘솔이 직접 전환하는 것.** conf 를 바꾸고 Mobius 를
  재기동하면 코어가 건다. 콘솔이 따로 걸면 거는 주체가 둘이 된다.
- **MySQL 내구성 3종의 쓰기.** 현재 값이 이미 유실을 허용하는 상태라, 손잡이가
  있으면 되돌릴 때보다 더 낮출 때 눌린다.

---

## 8. 코어에 요청할 것 (내가 못 고치는 것)

1. **`PRAGMA` 셋에 콜백을 달아 실패를 로그로 남긴다.** 지금은 `'error'` 리스너가
   없어 실패가 미처리 예외가 된다 — 로그가 아니라 워커 종료다.
2. **실제 워커 수를 알려 주는 값.** `max_connections` 바닥 계산의 전제다.
   없으면 화면이 계산을 보여 주되 막지 못한다.
