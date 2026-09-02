# 관리자 UI 로 넘기는 것 — 인수인계

**날짜**: 2026-08-29
**대상**: 관리자 콘솔 작업 세션 (`feat/admin-console-part0`)
**작성 배경**: DB 레이어 작업(`worktree-db-layer-migrate`)에서 **관리자 판단이
필요해 코드가 일부러 손대지 않고 남긴 것**들이 생겼다. 그 목록과 쓸 수 있는
함수, 그리고 그렇게 남긴 근거를 여기 적는다.

이 문서는 [2026-08-28-phase2-charter.md](2026-08-28-phase2-charter.md) 의
후속이다. 그 문서의 현황표는 8/28 시점이라 지금과 다르다.

---

## 1. 왜 자동으로 처리하지 않는가

두 경우 모두 **자동으로 돌리면 되돌릴 수 없는 삭제나 대량 변경이 일어난다.**
그래서 코드는 "판정하고 목록을 돌려주는 것"까지만 하고 멈춘다.

| 항목 | 자동 실행하면 벌어지는 일 |
|------|--------------------------|
| 만료 리소스 스윕 | 지금까지 한 번도 안 지워진 만료 리소스가 한꺼번에 사라진다 |
| 대형 컨테이너 정합 보정 | 집계 자체가 20초를 넘겨 스윕 예산을 삼키고, 보정값이 맞는지 확인할 방법이 없다 |

---

## 2. 유예된 대형 컨테이너 7개 (이번에 새로 생긴 항목)

### 무슨 상황인가

`reconcile_cnt_counters` 는 저장된 `cnt.cni`/`cbs` 를 실제 `cin` 집계와 맞춘다.
2026-08-29 배포 서버에서 한 바퀴를 돌려 **컨테이너 30,278개 중 1,659개를
교정**했다 (다음 바퀴는 교정 0건 — 유지되고 있다).

그런데 `cni` 가 100만을 넘는 컨테이너는 **집계를 건너뛰고 목록만 남긴다**
(`opts.maxCni`, 기본 1,000,000). 실측 근거:

```
/Mobius/KETI_MUV/Mission_Data/KETI_AIoT_01/msw_lte_rc/SBUS/disarm  (cni 5,930,795)
  SELECT COUNT(*), SUM(cs) FROM cin WHERE pi = '<위 경로>'
  EXPLAIN: type=ref, key=cin_ri_idx, Using index, rows=11,372,914
  -> MAX_EXECUTION_TIME(20000) 에 걸려 강제 종료
```

커버링 인덱스를 쓰고도 20초를 넘긴다. 스윕 예산이 30초라 이 컨테이너 하나가
전체를 삼킨다. 그래서 빼는 편이 나머지 3만 개를 실제로 검사하게 한다.

### 대상 목록 (2026-08-29 배포 서버 기준)

| 컨테이너 | 저장 cni | 저장 cbs |
|----------|---------:|---------:|
| `/Mobius/KETI_MUV/Mission_Data/KETI_AIoT_01/msw_lte_rc/SBUS/disarm` | 5,930,795 | 1,478,104,467 |
| `/Mobius/KETI_MUV/Mission_Data/Dev_Tool_Test/msw_lte_rc/SBUS/disarm` | 5,650,053 | 1,183,227,157 |
| `/Mobius/PureunAir/PA1/status` | 5,493,895 | 1,591,217,733 |
| `/Mobius/KETI_MUV/Mission_Data/KETI_AIoT_01/msw_remote_gimbal/SBUS/disarm` | 2,100,032 | 389,460,871 |
| `/Mobius/KETI_MUV/Mission_Data/Web_Test/msw_timesync/TimeSync` | 1,919,521 | 232,821,823 |
| `/Mobius/KETI_GCS/GCS_Data/KETI_Simul_2` | 1,202,653 | 109,191,200 |
| `/Mobius/KETI_MUV/Mission_Data/KETI_Feb/msw_remote_gimbal/SBUS/disarm` | 1,092,736 | 203,248,896 |

**이 값들이 맞는지는 아무도 모른다.** 검증한 적이 없다. 다른 컨테이너에서
드리프트율이 5.5% 였고, 실제로 `cni 12,473 -> 0`, `cbs 215,237,653 -> 0` 처럼
CIN 은 지워졌는데 카운터만 남은 사례가 있었다. 이들도 그럴 수 있다.

### UI 가 할 일

1. **목록 보여주기** — 스윕 보고의 `deferredRis` 를 그대로 쓰면 된다.
2. **관리자가 고른 하나만 집계 실행** — 수십 초가 걸리므로 비동기로 돌리고
   진행 상태를 보여줘야 한다. 요청-응답 안에서 끝내려 하면 안 된다.
3. **결과를 보여주고 적용 여부를 관리자가 결정** — 저장값과 실측값의 차이를
   보여주고, 승인하면 `update_cnt_cni` 로 쓴다.

### 쓸 수 있는 함수

```js
// 스윕. maxCni: 0 을 주면 대형 컨테이너도 집계한다.
// aggTimeoutMs 는 서버 측 상한(MAX_EXECUTION_TIME)이다 — 0 이면 상한 없음.
db_sql.reconcile_cnt_counters(conn, {
    limit: 2000,          // 한 번에 읽을 컨테이너 수
    cursor: '',           // 이어서 돌 자리 (report.nextCursor)
    budgetMs: 30000,      // 이 호출의 시간 예산. null 이면 무제한
    aggTimeoutMs: 5000,   // 컨테이너 하나의 집계 상한
    maxCni: 1000000       // 이 값을 넘으면 집계 안 하고 유예
}, function (err, report) {
    // report = {
    //   checked, fixed,
    //   failed, failedRis,        집계가 실패한 것 (타임아웃 등)
    //   deferred, deferredRis,    maxCni 를 넘어 건너뛴 것  <-- UI 가 쓸 목록
    //   nextCursor, done
    // }
});

// 한 컨테이너만 강제로 집계하려면 그 컨테이너에 커서를 맞추고
// maxCni: 0, aggTimeoutMs: 0, budgetMs: null 로 부른다.

// 승인 후 실제로 쓰는 곳
db_sql.update_cnt_cni(conn, { ri: '<경로>', cni: <실측>, cbs: <실측> }, cb);
```

**주의 — 드라이버 타임아웃을 쓰지 말 것.** `db.run()` 의 `opts.timeoutMs` 로
상한을 걸면 걸리는 순간 **커넥션이 죽는다.** 로컬 MySQL 실측:

```
MAX_EXECUTION_TIME(300)  -> ER_QUERY_TIMEOUT(3024), 커넥션 생존
opts.timeoutMs = 300     -> PROTOCOL_SEQUENCE_TIMEOUT, 커넥션 사망
                            이후 질의는 PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR
```

한 문장만 끊고 계속 일해야 하면 `db.statementTimeoutHint(ms)` 를 쓰고
knex 의 `.hintComment()` 에 넣는다. SQLite 에서는 `null` 을 돌려준다.

### 참고 — 왜 이 컨테이너들이 이렇게 커졌나

`mni`/`mbs` 기본값이 **3,153,600,000** 이라 보존 정책이 사실상 동작하지 않는다.
위 표에서 보듯 7개 전부 그 값이다. 카운터를 고치는 것과 별개로, **보존 정책을
어떻게 할지는 관리자 판단**이다. `mni` 를 낮추면 다음 CIN 삽입 때
`delete_oldest` 가 즉시 정리를 시작한다 — 수백만 건이 지워질 수 있다.

---

## 3. 만료 리소스 (이전부터 있던 항목)

`app.js` 주석에 이미 적혀 있지만 여기 모아 둔다.

만료 스윕은 **주기 실행을 걸지 않았다.** 예전 구현이 만료된 `ri` 를 `pi` 자리에
넣어 "만료 리소스의 자식"을 지우고 정작 대상은 남기는 no-op 이었다. 고쳐서
제대로 지우게 만드는 순간, 지금까지 한 번도 안 지워진 만료 리소스가 한꺼번에
사라진다.

배포 서버 표본에서 **`et` 값의 약 81% 가 이미 과거**였다.

```js
db_sql.select_expired_resources(conn, et, limit, cb);  // 목록 조회 (읽기 전용)
db_sql.delete_lookup_et(conn, et, limit, cb);          // 선택 후 삭제
// et 를 늘리는 것은 일반 oneM2M UPDATE 로 하면 된다.
```

`et` 를 지정하지 않은 신규 리소스는 `mobius/defaults.js` 의
`DEFAULT_ET = '20991231T235959'` 를 받는다. 즉 **앞으로 만들어지는 것은 이
문제에 걸리지 않는다.** 기존 데이터만 정리 대상이다.

---

## 4. 알아 두면 좋은 것

### 배포 DB 조회 시 주의

`lookup.pi` 는 `utf8mb3_general_ci`, `lookup.ri`/`cnt.ri` 는 `utf8mb3_bin` 이다.
**부모↔자식을 콜레이션이 다른 컬럼끼리 조인하면 인덱스를 못 탄다.**

```sql
-- 이러면 5,740만 행 풀스캔이 된다 (실제로 두 번 걸려 kill query 했다)
SELECT l.ri FROM cnt c JOIN lookup l ON l.sri = c.ri WHERE ...
```

두 단계 리터럴 등치로 쪼갤 것. 컬럼 의미도 헷갈리기 쉽다:

| 컬럼 | 담는 것 |
|------|---------|
| `lookup.ri`, `cnt.ri`, `cin.ri`, `cin.pi`, `lookup.pi` | **구조화 경로** (`/Mobius/AE/CNT`) |
| `lookup.sri`, `lookup.spi` | **짧은 리소스 ID** (`3-2026...`) |

### 스키마 변경이 필요하면

마이그레이션 러너를 쓴다. **자동 실행되지 않는다** — 사람이 명시적으로 부른다.

```
node tools/migrate.js --check     # 읽기 전용, 현재 상태만 보여줌
node tools/migrate.js --apply
```

`migrations/` 에 번호순으로 넣고 멱등하게 쓴다.
적용 이력은 `schema_migrations` 테이블에 남는다.

`test/schema-drift.test.js` 가 **마이그레이션이 추가/삭제하는 인덱스가
`mobius/db/mobiusdb.sql` 과 어긋나지 않는지** 검사한다. 마이그레이션은 자동
실행되지 않으므로, 스키마 파일에 반영을 빠뜨리면 신규 설치만 옛 스키마로
생성되어 조용히 갈라진다 (실제로 001 이 그랬다).

---

## 5. 현재 배포 상태 (2026-08-29)

| 항목 | 값 |
|------|-----|
| 배포 서버 | `gcs.iotocean.org` (ssh 27579), MySQL 8.0.46, 워커 25 |
| 적용된 마이그레이션 | `001-lookup-pi-ty-ct-index`, `002-drop-lookup-pi-index` |
| 정합 스윕 | 기동 시 + 일 1회, 조각 사이 1분 간격으로 이어 돎 (한 바퀴 약 20분) |
| 만료 스윕 | **주기 실행 없음** (관리자 UI 대기) |
| 대형 컨테이너 | **7개 유예 중** (2절) |
