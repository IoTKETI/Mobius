# ACP 관리 — 관리 콘솔 인수인계

**대상:** `feat/admin-console-part1` 을 만드는 세션
**만든 곳:** `worktree-db-layer-migrate` (lite 기반). 코어(`mobius/`)만 손댔고 `admin/` 은 건드리지 않았다.

ACP 설정을 관리 콘솔로 옮기기로 했다. 이 문서는 **코어 쪽에 이미 만들어 둔 것**과
**콘솔이 붙여 쓸 계약**이다. 화면은 콘솔 세션이 만든다.

---

## 왜 콘솔로 옮기는가

지금 ACP 는 사실상 안 쓰인다. 배포 실측(2026-08-29):

| | 수 |
|---|---|
| ACP 리소스 (`lookup` 의 `ty=1`) | **1개** |
| `acpi` 가 채워진 리소스 (비-CIN 34,313행 전수) | **2개** |
| 로그 22개 파일의 `ACCESS DENIED` / `403-3` | **0건** |

그리고 그 2개 중 하나가 깨져 있다 — `/Mobius/sch8` 이 존재하지 않는
`/Mobius/acp_sch1` 을 가리켜 수퍼유저 말고는 아무도 못 쓴다.

원인은 셋이다.

1. **잘못된 값이 그대로 저장된다.** 없는 ACP 를 가리켜도 200, `pv:{}` 도 201.
2. **왜 막혔는지 알 수 없다.** 거부는 `'0'` 한 글자였고 로그가 없었다.
3. **누가 걸었는지 알 수 없다.** `acp` 테이블에 `cr` 컬럼이 없다.

셋 다 코어에서 고쳤다. 콘솔은 그 위에 화면만 얹으면 된다.

---

## 대원칙과 달라진 판정

**생성·조회는 누구나 / 수정·삭제는 생성자만 / 잠글 곳만 명시적으로 잠근다.**

이 원칙에 맞춰 **생성자는 ACP 가 걸려 있어도 통과한다**(`security.js` 의
`creator_bypasses`). 예전에는 정상 ACP 가 걸리는 순간 생성자가 자기 리소스에서
밀려났다. 실측(컨테이너를 장치가 만들고 AE 를 팀 ACP 로 잠근 상태):

| 연산 | 팀 | 장치(전) | 장치(후) | 제3자 |
|---|---|---|---|---|
| CIN 올리기 | 201 | 403 | **201** | 403 |
| 컨테이너 조회 | 200 | 403 | **200** | 403 |

**콘솔 화면에 이 사실이 보여야 한다.** 어떤 ACP 를 걸어도 생성자는 남는다 —
"이 리소스를 완전히 잠갔다" 고 표시하면 거짓이 된다.

`ty=1`(ACP 자신)은 예외다. ACP 를 누가 고칠 수 있는지는 `pvs` 가 정한다.

---

## 콘솔이 부를 것

전부 `require` 해서 직접 부른다. 콘솔은 이미 `mobius/db` 파사드로 DB 를 직접
읽고 있으므로 방식이 같다. 콜백 규약도 같다 — **성공 `cb(null, result)` /
실패 `cb(true, errObj)`. 에러 객체가 두 번째 인자다.**

### 목록·상세 — `mobius/sql_action`

```js
db_sql.select_acp_list(conn, { limit: 100, afterRi: '' }, cb)
// -> { rows: [{ri, pi, rn, ct, lt, et, acpi}], more, nextRi }
```
`ty` 등치라 `idx_lookup_ty` 를 탄다. **`nextRi` 는 반환된 마지막 행의 `ri` 다** —
만료 페이지 방식이고, 고아 페이지(`select_orphan_page`)의 off-by-one 을
복제하지 말 것.

```js
db_sql.select_acp_detail(conn, ri, cb)
// -> { ri, rn, pi, ty, ct, lt, et, acpi, is_acp,
//      pv, pvs, pv_parsed, pvs_parsed, body_missing } | null
```
`is_acp: false` 면 그 `ri` 가 ACP 가 아니다(다른 리소스 경로를 넣은 것).
`body_missing: true` 는 **ACP 인데** `acp` 본문이 없는 반쪽일 때만 나온다 —
평가에서 "참조한 ACP 를 못 찾음" 이 되어 잠금이 조용히 풀리는 상태다.
`null` 은 그 `ri` 자체가 없다는 뜻이다.

> 예전에는 `ty` 를 안 봐서 컨테이너 경로를 넣으면 `body_missing: true` 가
> 나갔다. 화면이 "본문이 없는 깨진 ACP" 로 그려 없는 문제를 만들어 냈다.

### 역참조 — 이 ACP 를 누가 쓰는가

```js
db_sql.scan_acpi_refs(conn, { acpRi, tys, batch, scanCap, maxRefs, after }, cb)
// -> { refs:[{ri, ty, rn, pi, acpi, raw, normalized}], refsTruncated,
//      byAcp, scanned, capped, broken, unresolved, next }
```

**`lookup.acpi` 에는 인덱스가 없다.** JSON 문자열이라 SQL 역질의도 안 되고,
`acpi like '%..%'` 는 선행 와일드카드라 인덱스를 못 탄다 — 배포 `lookup` 은
5,740만 행이므로 **절대 쓰지 말 것**(소스 스캔 테스트가 막고 있다).

대신 **타입마다 `ty` 등치로 훑는다.** `not_cin` 술어를 쓰면 인덱스를 하나도
못 탄다 — `idx_lookup_pi_notcin` 은 선행 컬럼이 `pi` 라 `not_cin` 단독 조건에
쓸 수 없고, PK 는 `(pi, ri, ty)` 라 `ri` 범위에도 못 쓴다. 배포 EXPLAIN:

| 질의 | 접근 | 비용 |
|---|---|---|
| `where not_cin = 1 and ri > ''` | range `ri_UNIQUE` | **rows=30,972,714** |
| `where ty = 3 and ri > ''` | ref `idx_lookup_ty` | 119ms / 2,000행 |
| `where ty = 2 and ri > ''` | ref `idx_lookup_ty` | 0.9ms / 568행 |

**이어보기는 `result.next` 를 `after` 로 그대로 넘긴다.** 쪼개지 말 것 —
커서 안에 타입과 `ri` 가 함께 들어 있다.

```js
var out = [], after = null;
(function step() {
    db_sql.scan_acpi_refs(conn, { acpRi: ri, after: after }, function (err, res) {
        if (err) { return fail(res); }        // { code: 'BAD_CURSOR', ... }
        out = out.concat(res.refs);
        if (!res.next) { return finish(out); }   // next 가 없으면 다 훑은 것이다
        after = res.next;
        step();
    });
})();
```

> 예전에는 `nextTy` / `nextRi` 를 따로 줬는데, `ri` 만 넘기면 타입이 0 으로
> 돌아가 **같은 자리를 무한히 다시 훑었다** — 결과가 틀린 것이 아니라 루프가
> 닫히지 않았다(콘솔에서 패스 201 강제 중단으로 실측). 쪼갤 수 있는 커서를
> 주면 언젠가 쪼개지므로 하나로 묶었고, 쪼갠 인자(`afterTy`/`afterRi`)를
> 넘기면 조용히 처음부터 훑는 대신 `BAD_CURSOR` 로 거부한다.

`lint_acpi_refs` 도 같은 `after` / `next` 를 쓴다.

`unresolved` 는 표기 접기만으로 내부 `ri` 가 되지 않은 원소다. 스캔 중에 DB 를
더 부르면 N+1 이 되므로 그대로 올려보낸다 — `resolve_acpi_entries` 로 푼다.

```js
db_sql.resolve_acpi_entries(conn, entries, cb)   // -> { map: { given: ri|null } }
db_sql.scan_macp_refs(conn, { acpRi }, cb)       // -> { refs:[{ri, macp}], byAcp, broken }
```

**`scan_macp_refs` 를 빠뜨리지 말 것.** fanOutPoint 는 `acpi` 가 아니라
`grp.macp` 로 판정한다. ACP 삭제 전 영향 분석에서 이걸 놓치면 그룹 팬아웃이
조용히 잠긴다.

### 시뮬레이터 — `mobius/acp_simulate`

```js
acp_simulate.simulate(conn, {
    ri, origin, op,          // op: CREATE|CREATE_SUB|RETRIEVE|UPDATE|DELETE|NOTIFY|DISCOVERY
    ip, acpiOverride, acpRowsOverride
}, cb)
// -> { found, ri, ty, rn, cr, origin, op, access_value,
//      source: 'own'|'inherited'|'override'|'none', inherited_from,
//      acpi, resolved:[{given, ri, exists}],
//      allowed, code, decided_by, acp_ri, field, acr_index, trace, warnings }

acp_simulate.simulate_many(conn, { ri, origins, ops, ip, acpiOverride, acpRowsOverride }, cb)
// -> { ri, ty, cr, found,
//      source, inherited_from, acpi, resolved,   // 리소스의 성질 — 원본과 무관
//      matrix:[{origin, op, allowed, code, decided_by, acp_ri}], warnings }
```

**`source` / `acpi` / `inherited_from` 은 리소스의 성질이지 원본의 성질이
아니다.** `acpi` 를 **실제로 푼** 결과에서만 읽는다 — 수퍼유저와 생성자는
`acpi` 를 풀기 전에 단축 판정되므로 그 결과를 쓰면 안 된다.

모든 조합이 그렇게 단축되면 `source` / `acpi` / `resolved` 가 **`null`** 이고
`warnings` 에 `source_unknown` 이 들어간다. `'none'`(= ACP 가 없다)으로
적으면 거짓이 되고, 그러면 상속 경고가 통째로 사라진다 — 컨테이너 `acpi` 가
조상을 덮어쓴다는 사실을 알리는 것이 그 경고인데, 관리자가 자기 장치 ID 를
첫 칸에 적었다는 이유만으로 없어지면 안 된다.

**이게 핵심이다.** 콘솔은 별도 프로세스이고 쓰기 origin 이 수퍼유저라, HTTP 로
왕복해도 정책을 원리적으로 검증할 수 없다 — `security.js` 가 수퍼유저를 무조건
통과시킨다. 시뮬레이터는 `security.js` 의 `evaluate_acp_rows` 를 **그대로** 쓴다
(사본을 만들면 언젠가 갈라지고, 그러면 미리 본 결과를 믿을 수 없다).

`acpiOverride` / `acpRowsOverride` 가 **"잠그기 전에 미리 본다"** 를 성립시킨다.
아직 저장하지 않은 ACP 본문으로도 물어볼 수 있다.

`simulate_many` 는 상한(origins 20, ops 7, 곱 120)을 **조용히 자르지 않고
거부한다**(`{code:'TOO_MANY'}`). 화면이 물어본 것보다 적은 결과를 보여 주면서
그 사실을 말하지 않는 것이 권한 판정에서 가장 나쁜 실패다.

`decided_by` 값: `superuser` / `creator` / `acr` / `no_acr_cr` / `no_acp_row` /
`exhausted` / `eval_error` / `default_policy`.

### 린터 — `mobius/acp_lint`

```js
acp_lint.lint_acp(conn, { limit: 200, afterRi: '' }, cb)
// -> { rows:[{ri, rn, ct, lt, et, problems:[{severity, rule, path, message}]}],
//      more, nextRi, counts:{error, warn, clean} }

acp_lint.lint_acpi_refs(conn, { batch, scanCap, maxRefs, after }, cb)
// -> { rows:[{ri, ty, rn, acpi, problems}], counts, scanned, capped, broken,
//      unresolved, next }
```

가드레일은 **새로 쓰는 값만** 막는다. 이미 저장된 잘못된 값은 그대로 남아 500 이나
조용한 거부를 계속 낸다. **콘솔의 첫 화면이 이 목록이어야 한다.**

`error` 규칙: `parse_error` `body_missing` `acr_missing_or_empty` `acr_not_array`
`acop_invalid` `acor_not_array` `acor_not_string` `acco_not_array` `actw_bad_arity`
`acip_both_families` / `dangling`
`warn` 규칙: `actw_second_pinned` `acor_looks_like_regex` `acor_not_normalized`
`pvs_no_admin` `acop_zero` / `not_normalized` `raw_not_canonical` `over_length` `count_at_limit`

로컬 실측(깨진 ACP 5개 + 참조 3개를 심음): `lint_acp` 가 error 4·clean 1,
`lint_acpi_refs` 가 dangling 1·not_normalized 1 을 정확히 집어냈다.

### 저장 전 검사 — `mobius/acp`

```js
acp.validate_privileges(obj, 'pv'|'pvs')
// -> { code: null, path: null, warnings: [{rule, path, message}] }        통과
// -> { code: '400-57', path: 'pv.acr[1].acop', warnings: [...] }          거부
```
DB 를 보지 않는 동기 순수 함수다. **콘솔의 편집 화면이 저장 버튼을 누르기 전에
이걸 불러야 한다** — 서버도 같은 함수로 막지만, 응답의 `msg` 는 정적이라 어느
값이 문제인지 담지 못한다. `path` 는 이 함수만 준다.

### 이력 — `mobius/sql_action`

```js
db_sql.select_acp_audit(conn, { ri, op, limit: 50, afterId }, cb)
// -> { rows:[{id, ts, op, ri, ty, origin, cr, before, after}], more, nextId }
```
`op`: `acp_create` / `acp_update` / `acp_delete` / `acpi_set`. 최신순이라
커서는 "이 id 보다 작은 것" 이다.

**`migrations/007-acp-audit-table.js` 를 먼저 적용해야 한다.** 적용 전에는 쓰기가
실패하지만 best-effort 라 요청은 정상 처리된다(이력만 안 남는다).

```
node tools/migrate.js --check mysql
node tools/migrate.js --apply mysql --only 007-acp-audit-table
```

로컬 실측(생성 → 걸기 → 바꾸기 → 풀기 → 수정 → 삭제):

```
14 acp_delete  /Mobius/au_ae/acp_a  by=Sponde
13 acp_delete  /Mobius/au_ae/acp_b  by=Cowner
12 acp_update  /Mobius/au_ae/acp_a  by=Cowner
11 acpi_set    /Mobius/au_ae/c1     by=Sponde   ["...acp_b"] -> []
10 acpi_set    /Mobius/au_ae/c1     by=Sponde   ["...acp_a"] -> ["...acp_b"]
 9 acpi_set    /Mobius/au_ae/c1     by=Cowner   [] -> ["...acp_a"]
 8 acp_create  /Mobius/au_ae/acp_b  by=Cowner
 7 acp_create  /Mobius/au_ae/acp_a  by=Cowner
```
`lbl` 만 바꾸는 PUT 은 행을 남기지 않았다.

### 워커 안의 관측 — `mobius/acp_observe`

```js
acp_observe.snapshot()
// -> { since, config, counts:{deny, observe, error, acpi_attach, suppressed},
//      byReason, recent:[…최대 200] }
```

> **콘솔은 이걸 못 읽는다.** 별도 프로세스라 워커 메모리에 닿지 않는다.
> 콘솔이 볼 수 있는 이력은 `acp_audit` 테이블뿐이다. 거부 로그는 워커의
> stdout 으로 나가므로 로그 파일을 봐야 한다:
> ```
> [acp] deny op=RETRIEVE ty=3 origin=Cother url=/Mobius/q_ae/open
>       by=exhausted source=inherited from=/Mobius/q_ae
> ```
> 형식이 고정이라 파싱할 수 있다. 콘솔이 로그를 읽는 화면을 만들 생각이면
> 이 형식에 맞추면 된다.

---

## 콘솔이 알아야 할 함정

**① 콘솔은 자기 자신을 검증받지 않는다.**
`adminOrigin` 기본값이 `superUser` 이고, `security.js` 가 그 값을 무조건
통과시킨다. 즉 콘솔이 만든 잠금을 콘솔 자신은 한 번도 통과 검사받지 않는다.
**그래서 저장 전에 `simulate` 를 반드시 돌려야 한다.** 화면에 "이 설정으로
누가 무엇을 할 수 있는지" 를 보여 주고 나서 저장하게 하라.

**② `acpi` 는 최대 7개다.** `lookup.acpi` 가 `varchar(200)` 이라 `ri` 22자 기준
7개(176자)까지다. 8개(201자)는 `400-62` 로 거부된다(예전에는 HTTP 500 이었다).

**③ 여러 ACP 는 OR 이고, 평가 순서는 `ri` 오름차순이다.**
`select_acp_in` 에 `ORDER BY ri` 를 넣었다. 화면에서도 그 순서로 보여 줘야
`pv` 에 `acr` 이 없는 ACP 가 뒤를 가리는 상황을 설명할 수 있다.

**④ 컨테이너 `acpi` 는 조상과 합쳐지지 않고 덮어쓴다.**
`select_acp_cnt` 는 가장 가까운 비어 있지 않은 `acpi` 하나만 쓴다. 그래서 AE 의
ACP 를 고쳐도 중간 컨테이너에 `acpi` 가 있으면 안 먹는다. **화면에 "이 컨테이너는
AE 와 다른 ACP 를 쓴다" 를 눈에 띄게 표시해야 한다** — 장애 대응 지연의 주범이다.
`simulate` 의 `source: 'inherited'` / `inherited_from` 이 그 근거를 준다.

**⑤ CSE 전역 ACP 는 불가능하다.** `/Mobius` 에 `acpi` PUT 은 HTTP 405 이고,
상속 체인도 `ty == '3'` 동안만 올라가 AE 에서 멈춘다. AE 마다 걸어야 한다.

**⑥ 지금은 아무나 남의 리소스를 잠글 수 있다.**
ACP 가 안 걸린 리소스에는 인증된 아무나 자기 ACP 를 붙일 수 있다(실측 200,
그 뒤 생성자 조회가 403). `conf.acpiAttachPolicy: 'creator'` 로 막을 수 있지만
기본값은 현재 동작(`'open'`)이다 — 바로 켜면 정상 요청이 거부되기 시작한다.
`[acp] attach …` 로그를 하루 본 뒤에 정한다. **콘솔이 이 로그를 보여 주면
켤 시점을 판단할 수 있다.**

---

## 새 conf 키 (전부 기본값이 현재 동작)

| 키 | 기본 | 뜻 |
|---|---|---|
| `defaultAccessPolicy` | `'disable'` | `acpi` 가 없는 리소스의 기본 정책. 대원칙대로면 바꿀 일이 없다 |
| `acpObserveMode` | `'off'` | `'observe'` 면 **ACP 거부를 허용으로 내보낸다.** 기본 정책 거부는 그대로 막는다 |
| `acpDenyLog` | `'sample'` | `'off'` / `'sample'`(초당 rate 줄) / `'all'` |
| `acpDenyLogRate` | `5` | 워커당 초당 로그 줄 수 |
| `acpiAttachPolicy` | `'open'` | `'creator'` 면 생성자와 수퍼유저만 처음 `acpi` 를 붙일 수 있다 |
| `acpAudit` | `'on'` | `'off'` 면 이력을 남기지 않는다 |
| `pxyWsPort` `pxyMqttPort` `sgnManPort` `cntManPort` `hitManPort` | 7577/7578/7599/7583/7594 | 한 머신에 두 인스턴스를 띄우려면 필요하다 |

`acpObserveMode` 를 켜면 기동 시 경고 한 줄을 찍는다. **콘솔 화면 어딘가에
"관찰 모드가 켜져 있음" 배지가 있어야 한다** — 켠 채로 두면 ACP 가 무력해진다.

---

## 화면 제안

| 화면 | 쓸 함수 | 비고 |
|---|---|---|
| ACP 목록 | `select_acp_list` + `lint_acp` | 문제 개수를 배지로 |
| ACP 상세 | `select_acp_detail` + `scan_acpi_refs(acpRi)` + `scan_macp_refs` | 참조 수를 보여 주고, 지우기 전에 경고 |
| 문제 목록 | `lint_acp` + `lint_acpi_refs` | **첫 화면.** dangling 부터 |
| 시뮬레이터 | `simulate_many` | 원본 × 연산 표. `acpiOverride` 로 미리 보기 |
| 리소스의 실효 권한 | `simulate` 의 `source`/`inherited_from` | 상속을 풀어 보여 준다 |
| 편집 | `validate_privileges` (저장 전) → oneM2M PUT | `path` 로 어느 필드가 문제인지 표시 |
| 이력 | `select_acp_audit` | 누가 언제 무엇을 |
| 잠금 해제 | oneM2M PUT `{"acpi":[]}` (수퍼유저) | `acp_audit` 에 남는다 |

---

## 관련 문서

- `docs/superpowers/specs/2026-08-29-acp-operating-model.md` — 운영 방안, 템플릿, 실측 표
- `docs/superpowers/specs/2026-08-29-acp-survey.md` — 배포 현황 조사
- `docs/superpowers/specs/2026-08-29-admin-ui-handoff.md` — 만료·고아 인수인계 (선행)
