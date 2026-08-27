# `cni`/`cbs`/`st` 유지 함수 전수 분석과 통합 방안

**날짜**: 2026-08-27
**질문**: `update_cnt_by_delete`·`update_parent_by_insert` 계열과 `cnt_man` 은 어떤 관계인가.
중복이면 통합해야 하지 않나.

---

## 0. 먼저 — 지난 답변에서 제가 헷갈리게 쓴 것

"`delete_oldest` 가 이미 하고 있다" 고 썼는데 설명 없이 이름만 던졌습니다. 그 얘기부터 합니다.

### `delete_oldest` 가 뭔가

컨테이너에는 보관 한도가 두 개 있습니다.

- `mni` (maxNrOfInstances) — CIN 최대 **개수**
- `mbs` (maxByteSize) — CIN 최대 **총 바이트**

CIN 을 넣다 이 한도를 넘으면 **오래된 CIN 부터 지워서** 한도 안으로 되돌려야 합니다.
그 일을 하는 것이 `delete_oldest` (`sql_action.js:2419`) 입니다.

```
CIN 삽입
  └─ cnt_man.schedule → (1초 debounce) → flush
       ├─ UPDATE cnt SET cni = cni + delta, cbs = cbs + delta
       └─ get_cni_count(부모)
            ├─ select_count_ri  ← 실제 COUNT(*), SUM(cs) 재조회
            └─ checkAndPurge
                 └─ cni > mni 또는 cbs > mbs 이면
                      └─ delete_oldest(count)     ← 여기
                           ├─ 오래된 CIN 을 count 건 골라 지우고
                           └─ UPDATE cnt SET cni = cni - N, cbs = cbs - M   ← 일괄 감산
```

**핵심**: `delete_oldest` 는 CIN 을 여러 건 지우면서 `cni`/`cbs` 를 **한 문장으로 한꺼번에**
줄입니다 (`sql_action.js:2435` SQLite / `:2561` MySQL). 건당 UPDATE 를 돌지 않습니다.

### 그래서 제가 하려던 말

지난번 "안 A (`cnt_man` 을 삭제에도 쓰자)" 는 **삭제할 때마다 UPDATE 1회씩 도는 걸
모아서 한 번에 하자**는 제안이었습니다. 그런데:

- **대량 삭제**(보관 한도 초과로 오래된 것 밀어내기)는 이미 `delete_oldest` 가 일괄로 합니다.
  여기는 모을 게 없습니다.
- **단건 삭제**(사용자가 CIN 하나를 DELETE)는 IoT 환경에서 드뭅니다.

즉 **안 A 가 모아 줄 대상이 별로 없습니다.** 그래서 "지금은 안 해도 된다" 고 한 것입니다.

### 결론 — 2단계는 이렇게 하자

**하지 맙시다.** 대신 필요해지면 판단할 수 있게 근거만 남깁니다.

- 지금 상태로 둔다 (단건 삭제 시 즉시 UPDATE 2회, 트랜잭션 안).
- 운영 로그에 이미 `update_parent_by_delete <ri> - <id>: N ms` 가 찍힙니다.
  이게 초당 수십 건씩 나오면 그때 안 A 를 합니다.
- 그 전까지는 코드를 늘리지 않습니다.

---

## 1. 전수 지도 — `cni`/`cbs`/`st` 를 건드리는 모든 것

### 살아 있는 것 (5개)

| # | 주체 | 무엇을 | 어떻게 | 언제 |
|---|------|-------|-------|------|
| L1 | `insert_cnt` (`sql_action.js:397`) | `cni`, `cbs` 초기값 | INSERT (0) | 컨테이너 생성 |
| L2 | `cnt_man` flush (`cnt_man.js:94`/`116`) | `cni +δ`, `cbs +δ`, `st +δ` | **증분**, 1초 debounce 배치 | CIN 생성 |
| L3 | `delete_oldest` (`sql_action.js:2435`/`2561`) | `cni −N`, `cbs −M` | **증분**, 한 문장 일괄 | 보관 한도 초과 |
| L4 | `update_parent_by_delete` (`sql_action.js:3427`) | `cni −1`, `cbs −cs`, `st +1` | **증분**, 트랜잭션 2문장 | CIN 단건 DELETE |
| L5 | `update_cnt` (`sql_action.js:2755`) | `cni`, `cbs`, `st` | **대입** (재계산값) | 클라이언트가 CNT UPDATE |

읽기 전용 보조:

| # | 주체 | 역할 |
|---|------|------|
| R1 | `get_cni_count` (`:477`) | 저장값 대신 **실제 COUNT/SUM 재조회** → 한도 초과면 `delete_oldest` 호출 |
| R2 | `select_count_ri` (`:2643`) | R1 이 쓰는 재조회 쿼리 |
| R3 | `purge_plan` (`:47`) | 초과량에서 "몇 건 지울지" 계산 |

### 죽어 있는 것 (5개) — 호출부가 하나도 없다

| # | 함수 | 위치 | 상태 |
|---|------|------|------|
| D1 | `update_st` | `sql_action.js:2667` | 호출부 0. `update lookup set st = <값>` 대입식 |
| D2 | `select_cni_parent` | `sql_action.js:2403` | 호출부 0 |
| D3 | `update_cnt_cni` | `sql_action.js:3364` | 호출부 0 (3차에서 유일한 호출부 제거) |
| D4 | `update_parent_by_insert` | `sql_action.js:3386` | 호출부 0 |
| D5 | `update_parent_st` | `sql_action.js:3443` | 호출부 0 (`useCert` 제거로 마지막 호출부 소멸) |
| D6 | `request_update_cnt` | `resource.js:2562` | 호출부 0 |

**`update_cnt_by_insert` 라는 함수는 없습니다.** 대응되는 것이 `update_parent_by_insert`
인데, 이건 D4 — 죽은 코드입니다. 삽입 측은 `cnt_man` 이 완전히 대체했습니다.

---

## 2. 중복 분석 — 실제로 겹치는 게 뭔가

### 겹치지 않는다: L2 / L3 / L4 는 서로 다른 사건을 담당한다

| | 사건 | 건수 | 전략 |
|---|------|------|------|
| L2 | CIN 삽입 | 매우 많음 (초당 수십~수백) | **모아서** 1초마다 |
| L3 | 한도 초과 밀어내기 | 중간, 여러 건 동시 | **한 문장 일괄** |
| L4 | CIN 단건 삭제 | 드묾 | **즉시** |

셋 다 **증분(`cni = cni ± N`)** 이라 서로 안 덮어씁니다. 클러스터에서 워커가 동시에 돌아도
안전합니다. 지금 구조는 **의도된 분업**이지 중복이 아닙니다.

### 진짜 중복: 죽은 함수 5개가 살아 있는 것들과 같은 일을 한다

| 죽은 함수 | 같은 일을 하는 살아 있는 것 |
|----------|------------------------|
| D4 `update_parent_by_insert` (`cni` 대입 + `cbs` 증분 + `st` 증분) | **L2 `cnt_man`** — 같은 일을 배치로 |
| D3 `update_cnt_cni` (`cni`/`cbs`/`st` 대입) | **L5 `update_cnt`** — 같은 일을 더 넓게 (mni/mbs/mia/li 까지) |
| D5 `update_parent_st` (`st +1`) | **L2/L4 안에 포함**되어 있음 |
| D1 `update_st` (`st` 대입) | 위와 동일. 게다가 대입식이라 동시성에 취약 |
| D2 `select_cni_parent` | **R2 `select_count_ri`** |
| D6 `request_update_cnt` | 흔적 없음. HTTP 로 자기 자신에게 CNT UPDATE 를 보내는 옛 구조 |

**즉 통합할 대상은 "살아 있는 것끼리" 가 아니라 "죽은 것을 지우는 것" 입니다.**

### 위험한 중복 하나 — 대입식과 증분식이 섞여 있다

| 방식 | 함수 | 동시성 |
|------|------|-------|
| 증분 `cni = cni + N` | L2, L3, L4 | **안전** — 두 워커가 동시에 해도 합쳐진다 |
| 대입 `cni = <값>` | L5 `update_cnt`, D1, D3 | **위험** — 나중 것이 먼저 것을 덮는다 |

L5 `update_cnt` 는 살아 있고 대입식입니다. 다만 바로 앞에서 `get_cni_count` 가
**실제 COUNT 를 재조회**해 그 값을 넣으므로, 덮어써도 결과가 실제와 같습니다.
**재조회와 대입 사이에 CIN 이 들어오면 그 1건을 잃지만**, 다음 `get_cni_count` 가
다시 재조회하므로 자가 치유됩니다.

죽은 D1/D3 은 그런 보호가 없습니다. 되살리면 안 되는 이유입니다.

---

## 3. 통합 방안

### 방안 1 — 죽은 함수 6개 삭제 (권장, 즉시)

D1~D6 을 지웁니다. 호출부가 하나도 없으므로 **동작 변화 0** 입니다.

| 지울 것 | 파일 | 근거 |
|--------|------|------|
| `update_st` | `sql_action.js:2667-2675` | 호출부 0, 대입식이라 되살리면 위험 |
| `select_cni_parent` | `sql_action.js:2403-2410` | 호출부 0 |
| `update_cnt_cni` | `sql_action.js:3364-3384` | 호출부 0, L5 와 중복 |
| `update_parent_by_insert` | `sql_action.js:3386-3425` | 호출부 0, L2 가 대체 |
| `update_parent_st` | `sql_action.js:3443-3457` | 호출부 0, L2/L4 에 포함 |
| `request_update_cnt` | `resource.js:2562-2622` | 호출부 0, 옛 HTTP 자기호출 구조 |

**얻는 것**: `sql_action.js` 에서 약 150줄, 남은 DB 레이어 전환 대상 5개 감소.
"이게 왜 안 불리지" 를 다음 사람이 다시 추적하지 않아도 됩니다.

**주의**: `update_parent_by_insert` / `update_parent_st` / `update_cnt_cni` 는 제가 3차에서
파사드로 전환해 둔 것들입니다. 전환 작업이 아까워 보일 수 있으나, **죽은 코드를 전환한 것**
이므로 지우는 편이 맞습니다. 관련 테스트(`test/parent-update.test.js`)도 함께 정리합니다.

**되살릴 일이 생기면**: `update_parent_st` 만은 쓸 데가 있습니다 — 아래 방안 3 참고.

### 방안 2 — `update_cnt_by_delete` 를 `sql_action` 으로 옮긴다 (선택)

지금 `update_cnt_by_delete` 는 `resource.js` 안의 **모듈 사설 함수**입니다.
하는 일은 "부모를 `pi` 로 찾아 `update_parent_by_delete` 를 부른다" 로 순수 DB 작업입니다.

```
resource.js  delete_action
    └─ update_cnt_by_delete(conn, pi, cs, cb)      ← resource.js 사설
         ├─ db_sql.select_resource_from_url(pi)
         └─ db_sql.update_parent_by_delete(...)
```

두 번의 DB 왕복이 `resource.js` 에 노출돼 있습니다. `sql_action.js` 로 옮겨
`db_sql.decrease_parent_counters(conn, pi, cs, cb)` 같은 이름 하나로 묶으면
호출부가 한 줄이 되고, DB 레이어 전환 대상이 명확해집니다.

**하지만 지금 할 필요는 없습니다.** 동작이 막 고쳐진 참이라 그대로 두고 관찰하는 편이
낫습니다. DB 레이어 4~6차에서 자연스럽게 다룰 대상입니다.

### 방안 3 — `st` 갱신의 구멍을 메운다 (판단 필요)

`st`(stateTag)는 리소스가 바뀔 때마다 올라가야 합니다. 현재:

| 사건 | 부모 `st` 오르나 |
|------|----------------|
| CIN 생성 | **예** (L2 `cnt_man`) |
| CIN 단건 삭제 | **예** (L4) |
| 한도 초과 밀어내기 | **아니오** — `delete_oldest` 는 `cni`/`cbs` 만 건드린다 |
| CNT 생성 | **아니오** — `useCert` 뒤에 있던 `update_parent_st` 가 유일한 경로였다 |
| SUB/ACP 등 생성·삭제 | **아니오** |

즉 `st` 는 **CIN 사건에만** 반응합니다. oneM2M 규격상 자식 생성/삭제는 부모 `st` 를
올려야 하지만, 이건 알림(subscription) 동작에 영향을 주는 **정책 판단**이라
제안만 하고 결정은 남깁니다.

메우려면 `delete_oldest` 의 감산 문장에 `lookup.st` 를 함께 올리고
(`cnt_man.js:116` 의 MySQL 문장이 이미 그런 형태입니다), CNT/SUB 생성 경로에
`update_parent_st` 를 되살리면 됩니다. **그때는 D5 를 지우지 말아야 합니다.**

---

## 4. 권장 순서

| 순서 | 작업 | 위험 |
|------|------|------|
| 1 | **방안 1** — 죽은 함수 6개 삭제 | 없음 (호출부 0, 동작 변화 0) |
| 2 | 만료 스윕 수정 (별도 문서 1~3단계) | 있음 — 만료 리소스가 실제로 지워지기 시작 |
| 3 | 방안 3 `st` 정책 결정 | 판단 필요 |
| 4 | 방안 2 — `update_cnt_by_delete` 이동 | 없음, 급하지 않음 |

**2단계(`cnt_man` delta 확장)는 목록에서 뺐습니다.** 위 0절의 이유로 지금은 불필요합니다.

방안 3 을 할 생각이 있으면 **방안 1 에서 `update_parent_st` 는 남겨 두는 편이** 낫습니다.
결정해 주시면 그에 맞춰 지우겠습니다.
