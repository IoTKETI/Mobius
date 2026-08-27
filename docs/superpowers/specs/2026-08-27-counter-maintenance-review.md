# 카운터 유지와 만료 스윕 — 현황 조사 및 정리 방안

**날짜**: 2026-08-27
**대상**: `cnt_man` (cni/cbs 배치 갱신), `delete_lookup_et` (만료 리소스 스윕), `useCert` 제거로 잃은 것
**성격**: 조사 결과 + 방안 제시. **이 문서는 코드를 바꾸지 않는다.**

---

## 0. 요약

| 항목 | 결론 |
|------|------|
| `cnt_man` 이 쓰이고 있나 | **쓰인다. 그것도 삽입 측 유일한 경로다.** 지우면 `cni`/`cbs` 가 아예 안 올라간다. |
| "직접 업데이트" 로 기억하시던 것 | `cnt_man` 이 아니라 **CNT UPDATE 경로**(`resource.js:1613`)다. 클라이언트가 컨테이너를 갱신할 때만 `get_cni_count` 로 재계산해 덮어쓴다. |
| 삭제 시 `cni`/`cbs` 감소 | **아무도 안 한다.** 단건 DELETE 는 감소 경로가 없다. (`delete_oldest` 보존 정책 purge 만 감소시킨다.) |
| `delete_lookup_et` 이 용도대로 도나 | **아니다. 정반대로 돈다.** 만료된 행은 남기고 그 자식(만료 여부 무관)을 지운다. 실측 확인함. |

---

## 1. `cnt_man` — 쓰이고 있다

### 현재 구조

```
CIN 생성 (resource.js:395~)
  └─ db_sql.insert_cin(...)
       └─ cnt_man.schedule(parentObj, cs)        // resource.js:414 — 유일한 호출
            └─ pendingUpdates[pi] 에 delta 누적 (cni +1, cbs +cs, st +1)
            └─ setTimeout(flush, 1000ms)          // DEBOUNCE_MS
            └─ 단, 최초 누적으로부터 10초(MAX_WAIT_MS) 넘으면 타이머 리셋 안 함
       flush(pi)
         └─ UPDATE cnt SET cni = cni + delta, cbs = cbs + delta   // 상대값 증분
         └─ UPDATE lookup SET st = st + delta
         └─ db_sql.get_cni_count(...)             // 보존 정책 초과 시 purge 유발
```

**CIN 삽입 경로에는 `cnt_man` 말고 `cni`/`cbs` 를 건드리는 코드가 없다.** `resource.js:407-433`
전체를 확인했다. 따라서 `cnt_man` 은 제거 대상이 아니라 **핵심 경로**다.

### 실측

SQLite 모드에서 CIN 2건을 넣고 로그를 봤다.

```
$ grep -c "cnt_man.flush" /tmp/p3-verify.log
2
cnt_man.flush /Mobius/p3ae/p3cnt
cnt_man.flush /Mobius/p3ae/p3cnt
```

`cni` 는 0 → 2 로 정상 증가했다.

### "직접 업데이트 하게 되어서" 의 정체

기억하시는 직접 갱신은 `cnt_man` 을 대체하는 것이 아니라 **다른 시점의 다른 경로**다.

```js
// mobius/resource.js:1613 — 클라이언트가 CNT 를 UPDATE 할 때만
else if (ty == '3') {
    db_sql.get_cni_count(request.db_connection, resource_Obj[rootnm], function (cni, cbs, st) {
        resource_Obj[rootnm].cni = cni;      // 실제 데이터로 재계산한 값
        resource_Obj[rootnm].cbs = cbs;
        resource_Obj[rootnm].st = st + 1;
        db_sql.update_cnt(request.db_connection, resource_Obj[rootnm], ...);
```

`get_cni_count` 는 저장된 `cni` 를 믿지 않고 `SELECT COUNT(*)` 로 다시 센다
(`sql_action.js:504` 주석: *"SQLite: 저장된 cni 대신 실제 COUNT로 판단 (클러스터 환경에서
저장값 신뢰 불가)"*). 즉 **CNT UPDATE 는 자기 보정(self-heal) 지점**이다.

이것이 지금 시스템이 무너지지 않고 버티는 이유다. 저장된 `cni` 가 틀어져도
(a) purge 판정은 `get_cni_count` 가 실제 COUNT 로 하고, (b) CNT 를 한 번 UPDATE 하면 값이 교정된다.

### 진짜 문제 — 삭제 측에 감소 경로가 없다

| 사건 | `cni`/`cbs` 를 조정하는 주체 |
|------|---------------------------|
| CIN 생성 | `cnt_man` (배치 증분) |
| 보존 정책 초과 purge (`delete_oldest`) | `sql_action.js:2435`(SQLite) / `:2560`(MySQL) 이 일괄 감산 |
| **CIN 단건 DELETE** | **없음** |
| CNT UPDATE | `get_cni_count` 재계산으로 교정 |

실측 (두 백엔드 모두):

| 모드 | 실제 CIN | 조회된 `cni` | 조회된 `cbs` |
|------|---------|------------|------------|
| SQLite | 1 | **2** | **8** |
| MySQL | 1 | **2** | **4** |

`RETRIEVE /Mobius/<ae>/<cnt>` 응답에 그대로 나가므로 **사용자에게 보이는 값이 틀린다.**
다만 `mni`/`mbs` 강제는 `get_cni_count` 덕에 깨지지 않는다 — **표시 오류이지 기능 파손은 아니다.**

### 방안

세 가지를 놓고 비교한다.

#### 안 A — `cnt_man` 을 삭제에도 쓴다 (권장)

`schedule` 에 부호를 허용해 삭제 시 음수 delta 를 넣는다.

```js
// cnt_man.js
exports.schedule = function (parentObj, cs, delta) {
    delta = (delta === undefined) ? 1 : delta;   // +1 = 삽입, -1 = 삭제
    ...
    existing.cni += delta;
    existing.cbs += cs * delta;
    existing.st  += 1;      // st 는 삭제도 '변경'이므로 항상 +1
```

호출부는 삭제 경로에 한 줄 추가한다 (`resource.js` 의 `exports.delete` 안,
`useCert` 제거로 비워 둔 자리).

```js
if (request.resourceObj[rootnm].ty == 4) {
    // targetObject 는 삭제 대상 자신이다. 부모는 pi 로 찾아야 한다.
    cnt_man.schedule({ ri: request.resourceObj[rootnm].pi, ... },
                     parseInt(request.resourceObj[rootnm].cs, 10), -1);
}
```

| 장점 | 단점 |
|------|------|
| 삽입과 삭제가 **같은 배치·같은 상대값 증분**을 탄다. 경쟁 조건이 새로 안 생긴다 | `parentObj` 를 구성해야 한다 — `schedule` 은 `get_cni_count` 에 넘길 `mni`/`mbs`/`ty` 가 필요해서 `ri` 만으로는 부족하다 |
| 삭제가 몰려도 debounce 로 UPDATE 횟수가 줄어든다 | 같은 컨테이너에 삽입과 삭제가 섞이면 delta 가 상쇄되는데, 이건 **의도한 동작**이다 |
| 부하 이유로 배치를 만드신 취지와 일치한다 | |

**`parentObj` 조달 방법**: 삭제 경로에는 이미 부모 정보가 없다. `resource.js:2397` 의
`update_cnt_by_delete` 가 `select_resource_from_url(pi)` 로 부모를 조회하는 헬퍼인데,
`:2519` 에서 **인자 3개로 호출**되고 있어(정의는 4개) 지금도 깨져 있다. 이걸 고쳐 재사용하면 된다.

#### 안 B — 삭제 시 즉시 UPDATE

3차에서 파사드로 전환해 둔 `update_parent_by_delete` 를 그대로 쓴다. 단 **부모 객체**를 넘겨야 한다.

| 장점 | 단점 |
|------|------|
| 이미 전환·테스트된 코드가 있다 (`facade.transaction` + 두 UPDATE) | 삭제마다 UPDATE 2회 — 배치를 만드신 이유와 반대 방향 |
| 즉시 반영이라 조회 값이 항상 정확하다 | 대량 삭제 시 락 경합 |

#### 안 C — 아무것도 안 하고 주기적 정합만 맞춘다

`get_cni_count` 로 하는 재계산을 배치로 돌려 저장 값을 주기적으로 교정한다.

| 장점 | 단점 |
|------|------|
| 삭제 경로를 안 건드린다 | 주기 사이에는 계속 틀린 값이 조회된다 |
| 다른 원인의 드리프트도 함께 잡힌다 | 컨테이너가 많으면 스캔 비용이 크다 |

#### 권장

**안 A**. 배치를 만드신 원래 취지(삽입마다 UPDATE 하면 부하)가 삭제에도 똑같이 적용되고,
상대값 증분이라 클러스터에서 안전하기 때문이다. 선행 작업으로 `update_cnt_by_delete` 의
인자 개수 버그를 고쳐 부모 조회 헬퍼로 쓴다.

안 C 는 A 와 배타적이지 않다 — A 를 넣은 뒤에도 안전망으로 둘 만하다.

### 곁들여 — `useCert` 제거로 비워 둔 자리

`useCert` 를 지우면서 두 곳의 호출을 함께 지웠다. **둘 다 실행된 적 없는 코드**다
(`mobius.js:85` 가 `'disable'` 하드코딩이었다).

| 위치 | 지운 것 | 상태 |
|------|--------|------|
| `resource.js:378` (CNT 생성) | `update_parent_st(부모)` | **올바른 코드였다.** 복원하면 컨테이너 생성 시 부모 `st` 가 오른다 |
| `resource.js:2521` (삭제) | `update_parent_by_delete` / `update_parent_st` | **깨진 코드였다.** `targetObject` 는 삭제 대상 자신이라 `ty=4` 면 `update cin set cni = ...` 이 되고 `cin` 에 그 컬럼이 없다 |

안 A 또는 B 를 적용할 때 이 두 자리를 함께 정리하면 된다.

---

## 2. `delete_lookup_et` — 용도대로 돌지 않는다

### 등록 상태

```js
// app.js:185 (마스터 프로세스)
setInterval(del_expired_resource, (24) * (60) * (60) * (1000));
```

등록은 되어 있다. 다만 **기동 직후 1회 실행이 없다** — `del_orphan_resource` 는 `app.js:187`
에서 즉시 1회 부르고 인터벌을 거는데, `del_expired_resource` 는 인터벌만 건다.
**매일 재시작하는 서버라면 영원히 안 돈다.**

### 실측 — 정반대로 동작한다

MySQL 개발 DB 에 통제된 행 2개를 넣고 실제 `delete_lookup_et` 을 앱과 같은 방식으로 호출했다.

| 행 | `ty` | `et` | 만료? |
|----|------|------|------|
| `SWEEPTEST_PARENT` | 23 (sub) | `20200101T000000` | **만료됨** |
| `SWEEPTEST_CHILD` (pi=PARENT) | 4 (cin) | `20991231T000000` | 안 됨 |

실행 결과:

```
스윕 실행, 기준 et = 20260827T080019
deleted 1 resource(s) of SWEEPTEST_PARENT
delete_lookup_et 콜백: err = "200"

스윕 후 남은 행: [ { "ri": "SWEEPTEST_PARENT", "ty": 23, "et": "20200101T000000" } ]
```

**만료된 부모는 살아남고, 만료되지 않은 자식이 지워졌다.**

### 원인

```js
// sql_action.js:3594
exports.delete_lookup_et = function (connection, et, callback) {
    var pi_list = [];
    var sql = "select ri from lookup where et < '<et>' and ty <> '2' and ty <> '3' and ty <> '5'";
    db.getResult(sql, connection, function (err, delete_Obj) {
        if (!err) {
            for (var i = 0; i < delete_Obj.length; i++) {
                pi_list.push(delete_Obj[i].ri);      // ri 를 담는데 이름은 pi_list
            }
            _this.delete_lookup(connection, pi_list, 0, ...);
```

`delete_lookup` → `delete_lookup_action` 이 실제로 실행하는 문장:

```js
var sql = 'delete from lookup where pi = \'' + pi_list[req_count] + '\'';
//                                 ^^ pi 로 쓴다
```

**만료된 `ri` 를 `pi` 자리에 넣는다.** 그래서 만료 리소스의 *자식*이 지워지고 만료 리소스 자신은 남는다.

게다가 SELECT 가 `ty <> '2' and ty <> '3' and ty <> '5'` 로 AE·CNT·CSE 를 제외하므로,
선택되는 것은 대부분 **자식이 없는 리프 타입**(cin, sub, acp, grp)이다.
따라서 실운영에서는 지울 자식조차 없어 **완전한 no-op** 이 된다.

### 그 밖의 결함

| # | 결함 | 결과 |
|---|------|------|
| 1 | `ri` 를 `pi` 로 쓴다 | 대상이 아니라 그 자식을 지운다 (위) |
| 2 | SELECT 에 `LIMIT` 없음 | 만료 행이 수백만이면 한 번에 다 읽는다 |
| 3 | `if (!err)` 에 `else` 없음 | 에러 시 콜백 미호출 → `app.js:112` 의 `connection.release()` 미실행 → **커넥션 누수** |
| 4 | 성공 시 `callback('200')` | 호출부는 `if (!err)` 로 보므로 `'200'` 이 truthy → 성공 로그가 안 찍힌다 |
| 5 | SELECT 가 `db.getResult` (항상 MySQL) | SQLite 모드에서는 **MySQL 을 읽고 SQLite 를 지우는** 스플릿브레인 |
| 6 | 기동 시 1회 실행 없음 | 매일 재시작하면 영원히 안 돈다 |
| 7 | AE(2)·CNT(3) 제외 | 만료된 컨테이너/AE 는 영원히 안 지워진다 (의도인지 확인 필요) |

### 방안

용도(주기적 만료 리소스 삭제)대로 만들려면 다음 순서를 권한다. **1~3 은 필수, 4~6 은 선택.**

#### 1단계 — 대상을 올바로 지운다 (필수)

`ri` 를 `pi` 로 쓰는 것을 멈춘다. 만료 리소스 **자신**을 지우고, 자식은 이미 있는 메커니즘에 맡긴다.

- `lookup` 삭제 시 `ae`/`cnt`/`cin` 등 하위 테이블은 **FK `ON DELETE CASCADE`** 로 함께 지워진다
  (`mobiusdb.sql:56`, `mobiusdb_sqlite.sql:62`).
- `lookup` 자체의 자손(subtree)은 `delete_descendants_background`(`resource.js:2427`)와
  `delete_orphan_lookup`(`sql_action.js:3591`)이 이미 담당한다. 스윕이 직접 재귀할 필요가 없다.

즉 `delete from lookup where ri in (...)` 한 문장이면 되고, 남는 고아는 기존 고아 정리기가 걷는다.

#### 2단계 — 상한을 건다 (필수)

`delete_orphan_lookup` 이 쓰는 패턴을 그대로 따른다.

```js
"SELECT ri FROM lookup WHERE et < ? AND ty NOT IN (2,3,5) LIMIT 1000"
```

1000건씩 지우고, 지운 건수가 상한과 같으면 다음 배치를 이어서 돈다. 라이브 트래픽 중
락 시간을 짧게 유지하려는 기존 설계와 일치한다.

#### 3단계 — 콜백과 커넥션을 정상화한다 (필수)

- `if (!err)` 에 `else` 를 붙여 어떤 경로로도 콜백이 반드시 한 번 불리게 한다.
- 성공 신호를 `'200'` 이 아니라 `null` 로 통일한다 (파사드 규약: 성공 `cb(null, result)`).
  `app.js:106` 의 `if (!err)` 가 그제서야 의미를 갖는다.

#### 4단계 — 파사드로 전환한다 (선택, 3단계 이후)

SELECT 가 `db.getResult` 로 항상 MySQL 을 보는 스플릿브레인을 없앤다.
**단, 1~3단계를 먼저 끝낸 뒤에 한다.** 전환하는 순간 SQLite 배포에서 휴면 중이던 스윕이
실제로 깨어나기 때문이다 (2차에서 이것 때문에 전환을 되돌린 이력이 있다).

#### 5단계 — 기동 시 1회 실행 (선택)

`del_orphan_resource` 와 같은 형태로 맞춘다.

```js
del_expired_resource();                                        // 추가
setInterval(del_expired_resource, 24 * 60 * 60 * 1000);
```

#### 6단계 — 제외 타입 재검토 (선택, 판단 필요)

`ty <> '2' and ty <> '3' and ty <> '5'` 로 AE·CNT·CSE 를 제외하는 것이 의도인지 확인이 필요하다.
oneM2M 상 `et` 는 모든 리소스에 있고 만료되면 삭제 대상이다. 다만 AE/CNT 를 자동 삭제하면
그 아래 데이터가 통째로 사라지므로, 보수적으로 두는 것도 합리적이다. **이건 정책 결정이라
제안하지 않고 판단을 남긴다.**

### 위험 고지

1~3단계를 적용하는 순간 **지금까지 한 번도 지워지지 않은 만료 리소스가 실제로 지워지기
시작한다.** 운영 DB 에 만료 상태로 누적된 행이 얼마나 되는지 먼저 세어 보는 것을 권한다.

```sql
SELECT ty, COUNT(*) FROM lookup
WHERE et < DATE_FORMAT(UTC_TIMESTAMP(), '%Y%m%dT%H%i%s')
  AND ty NOT IN (2,3,5)
GROUP BY ty;
```

(조사 시점 개발 DB 에서는 0건이었다.)

---

## 3. 권장 순서

| 순서 | 작업 | 성격 |
|------|------|------|
| 1 | `update_cnt_by_delete` 인자 개수 버그 수정 (`resource.js:2397` vs `:2519`) | 선행, 소규모 |
| 2 | 카운터 **안 A** — `cnt_man.schedule` 에 delta 부호 도입 + 삭제 경로 연결 | 본 작업 |
| 3 | 만료 스윕 **1~3단계** (대상 수정 · LIMIT · 콜백/커넥션) | 본 작업, 별도 커밋 |
| 4 | 만료 스윕 **4~5단계** (파사드 전환 · 기동 시 1회) | 후속 |
| 5 | 제외 타입 정책 결정 | 판단 필요 |

2 와 3 은 서로 독립이라 순서를 바꿔도 되고, 각각 별도 커밋으로 두는 편이 문제 추적에 낫다.
