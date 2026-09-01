# DB 설정을 관리 콘솔에서 다루기 — 인수인계

**작성**: 2026-09-01
**대상**: 관리 콘솔 작업(`feat/admin-console-part1` 계열)
**기준**: `lite` @ `219098e`
**모든 수치는 배포 서버(`gcs.iotocean.org`) 실측이다.**

> 사용자 요청: "이 설정값을 저장할 수 있도록(편집할 수 있도록) 관리 UI 에서
> 설정해서 적용할 수 있게" — 그래서 코어 쪽에서 할 수 있는 것은 해 두고,
> 콘솔이 해야 할 것과 그때 걸리는 함정을 여기 적는다.

---

## 1. 설정이 두 종류다 — 다루는 법이 다르다

| | 앱 설정 | MySQL 서버 설정 |
|---|---|---|
| 무엇 | 커넥션 풀 크기·대기열 한도 | 내구성·격리수준·접속 상한 |
| 어디에 | `conf.json` | MySQL 자신 (`SET PERSIST`) |
| 반영 | Mobius 재기동 | 즉시(일부) / 재기동(일부) |
| 콘솔이 | **이미 하는 일** (설정 표) | **새로 만들어야 함** |

**앞의 것은 이 커밋으로 끝났다.** 뒤의 것이 이 문서의 본론이다.

---

## 2. 앱 설정 — 코어 쪽 준비 완료

`mobius/conf_schema.js` 에 두 항목을 올렸다. **콘솔의 기존 설정 화면이 이 표를
읽으므로 추가 작업 없이 화면에 나타난다.**

| 키 | 기본값 | 유효값 | 반영 |
|---|---|---|---|
| `dbConnectionLimit` | `100` | 1 ~ 500 | `restart` |
| `dbQueueLimit` | `0` | 0 ~ 10000 | `restart` |

**기본값은 지금 배포에서 도는 값 그대로다.** `conf.json` 에 값을 넣기 전까지
동작이 바뀌지 않는다.

### 화면이 반드시 계산해서 보여 줘야 할 것

풀은 **프로세스마다** 생긴다. 그래서 이 한 값이 서버 천장과 충돌할 수 있다.

    앱이 요구할 수 있는 총량 = dbConnectionLimit x (워커 수 + 1)

배포는 워커 24 + 마스터 1 = **25** 다. 지금 값 100 이면 **2,500** 인데
`max_connections` 는 2,000 이라 **이미 천장을 넘는다.**

화면은 값을 입력받을 때 이 곱을 계산해 `max_connections` 와 나란히 보여 주고,
넘으면 경고해야 한다. 숫자 하나만 받으면 관리자가 이 관계를 알 수 없다.

### `dbQueueLimit = 0` 은 경고를 띄워야 한다

`0` 은 "무제한" 이고 **그 큐에는 타임아웃이 없다.**

```
node_modules/mysql/lib/Pool.js:222
    if (this.config.queueLimit && ...) { ... }   // 0 은 falsy -> 검사 안 함
    this._connectionQueue.push(cb);              // 타이머 없음
```

`acquireTimeout` 은 `Pool.js` 의 `connect`(48) / `changeUser`(116) / `ping`(119)
에만 걸리고 **큐 대기에는 관여하지 않는다.** 그래서 풀이 마르면 요청이 응답도
에러도 없이 영원히 매달리고, 워커도 안 죽어 `cluster` 재기동도 안 걸린다.

**이것이 "서버가 자주 멈춘다" 의 정체다.** 화면에서 0 을 고를 수 있게 두되,
고르면 이 결과를 명시해야 한다.

---

## 3. MySQL 서버 설정 — 콘솔이 만들어야 할 것

### 3-1. 먼저: 값이 세 곳에 있고 서로 다르다

| 설정 | `mysqld.cnf` | `SET PERSIST` | **실제 적용값** |
|---|---|---|---|
| `innodb_flush_log_at_trx_commit` | `1` | `0` | **`0`** |
| `max_connections` | `300` | `2000` | **`2000`** |
| `sync_binlog` | (없음) | `0` | `0` |
| `transaction_isolation` | (없음) | `READ-UNCOMMITTED` | `READ-UNCOMMITTED` |
| `innodb_flush_method` | `O_DIRECT` | — | `O_DIRECT` |
| `innodb_buffer_pool_size` | `24G` | — | 24G |

MySQL 은 `mysqld-auto.cnf`(PERSIST)를 `my.cnf` **다음에** 읽으므로 PERSIST 가
항상 이긴다. 지금은 설정 파일만 봐서는 실제 동작을 알 수 없다.

**화면은 세 값을 모두 보여 줘야 한다.** 하나만 보여 주면 어느 것을 보여 주든
거짓말이 된다.

- 파일: 읽을 수 없다면(권한) "확인 불가" 로 표시. 추측하지 말 것
- PERSIST: `select * from performance_schema.persisted_variables`
- 적용값: `select * from performance_schema.global_variables`

### 3-2. 읽기 전용부터 만들 것

이전 검토(관리 UI 세션, 2026-08-31)의 결론을 그대로 따른다:

- **읽기 전용 화면이 먼저다.** 위험이 0 이고 `SYSTEM_VARIABLES_ADMIN` 권한도 필요 없다
- 쓰기는 그 화면이 자리를 잡은 뒤

### 3-3. 쓰기를 만들 때의 함정 (전부 실측·검토로 확인된 것)

**(가) "적용됨" 이 거짓말이 되는 경우가 있다.**
`SET GLOBAL transaction_isolation` 은 **이미 열려 있는 커넥션에 영향을 주지
않는다.** 풀이 커넥션을 재사용하므로, 화면이 "적용됨" 이라고 표시해도 실제
요청은 옛 값으로 돈다. 이 설정은 재기동이 필요하다고 표시해야 한다.

**(나) `RESET PERSIST` 는 실행 중인 값을 되돌리지 않는다.**
`mysqld-auto.cnf` 에서 항목만 지울 뿐이다. 되돌리려면 `SET GLOBAL` 을 따로
불러야 하고, 그것도 (가)의 제약을 받는다.

**(다) 누가 바꿨는지 기록할 수 없다.**
콘솔 인증이 `conf.json` 의 공유 비밀번호 하나라 사용자를 구분하지 못한다.
"변경 이력" 화면을 만들면 그 이력이 누구를 가리키는지 말할 수 없다.

**(라) `max_connections` 에는 바닥이 있다.**
`dbConnectionLimit x 프로세스 수` 아래로 내리면 앱이 커넥션을 못 얻는다.
화면이 그 바닥을 계산해 입력을 막아야 한다.

**(마) 내구성 3종은 읽기 전용으로 둘 것을 권한다.**
`innodb_flush_log_at_trx_commit` / `sync_binlog` / `transaction_isolation` 은
잘못 만지면 데이터 유실로 이어지고, 되돌려도 (가)·(나) 때문에 즉시 복구되지
않는다. 화면에서 바꾸는 것보다 근거를 남기고 `SET PERSIST` 로 다루는 편이 낫다.

**(바) 쓰기 가능한 것으로 시작하기 좋은 후보**
`long_query_time`, `innodb_io_capacity` — 즉시 반영되고 되돌리기 쉽고
잘못 잡아도 데이터에 영향이 없다.

---

## 4. 왜 이 값들이 지금 이렇게 되어 있는가

배경을 모르면 다음 사람이 같은 판단을 반복한다.

네 값은 **애플리케이션이 기동마다 `SET GLOBAL` 로 덮어쓰던 것**이다
(`sql_action.js` 의 `set_tuning`, `f4e26ec` 로 제거). 운영자가 `my.cnf` 에
적어 둔 값을 앱이 조용히 뒤집고 있었다. 제거하면서 값이 사라지지 않도록
`SET PERSIST` 로 옮겼고, 그래서 지금의 불일치가 남았다.

**넣은 이유**(사용자, 2026-09-01): DB 응답이 너무 늦고 커넥션 풀이 계속 말라
서버가 자주 멈춰서, 안정성과 성능을 얻으려고 넣었다.

**그런데 멈춤의 원인은 이 네 값 어디에도 없었다** — 위 2절의 `queueLimit: 0` 이다.
그리고 풀이 마르던 원인들(커넥션 누수, discovery N+1, 30초 점유 질의)은
그동안 고쳐졌다. 배포 실측 `Max_used_connections = 59` 다.

---

## 5. 권고 값 (사용자 검토 대기)

| 설정 | 지금 | 권고 | 근거 |
|---|---|---|---|
| `dbQueueLimit` | `0` | **`50`** | 무한 매달림을 즉시 실패로. 멈춤의 직접 원인 |
| `dbConnectionLimit` | `100` | **`25`** | 25 x 25 = 625. 실측 최대 59 대비 10배 |
| `innodb_flush_log_at_trx_commit` | `0` | **`1`** | 유실 흡수 장치가 하나도 없다. 비용 약 130 커밋/초 |
| `transaction_isolation` | `READ-UNCOMMITTED` | **`REPEATABLE-READ`** | 되돌리는 비용을 코드에서 못 찾았다 |
| `sync_binlog` | `0` | **`0` 유지** | 기준 백업이 없어 지킬 대상이 없다 |
| `max_connections` | `2000` | **`800`** | 앱 요구 625 + 여유. 2·3번을 먼저 한 뒤 |

착수 순서와 측정 항목은 별도 문서에 정리했다 —
헌장(`2026-08-28-phase2-charter.md`)의 작업 목록 참고.

---

## 6. 이 커밋이 한 것 / 하지 않은 것

**한 것**
- `dbConnectionLimit` / `dbQueueLimit` 을 `conf_schema.js` 표에 올림
- `mobius.js` 가 읽어 전역으로, `mobius/db/mysql.js` 가 그 전역을 사용
- 기본값 = 지금 값이라 **동작 변화 없음**

**하지 않은 것**
- 권고 값 적용 (사용자 검토 대기)
- MySQL 서버 설정 화면 (콘솔 작업)
- `my.cnf` 정리 (root 권한 필요)
