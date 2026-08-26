# DB 접근 계층 추상화 구현 계획 (1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sql_action.js`가 어느 DB를 쓰는지 모르게 만드는 기반을 세운다 — 분기 분류, 3층 검증 하네스, Knex 기반 파사드, 그리고 전환 패턴을 확립하는 첫 함수 변환.

**Architecture:** Knex 3.x를 **빌더로만** 사용해 `{sql, bindings}`를 만들고, 실행·커넥션 풀·콜백 구조는 기존 `mysql`/`sqlite3` 드라이버를 그대로 쓴다. `mobius/db/index.js` 파사드가 `global.usesqlite`를 읽는 유일한 지점이 되고, 백엔드별 어댑터는 실행과 결과/에러 정규화만 담당한다.

**Tech Stack:** Node.js v24 · knex 3.3.0 (신규) · mysql 2.x · sqlite3 5.x · `node:test` 내장 · 빌드 단계 없음

**Spec:** `docs/superpowers/specs/2026-08-26-db-layer-abstraction-design.md`

## Global Constraints

- **콜백 계약 보존.** 성공 `cb(null, result)`, 실패 `cb(true, err)` — 실패 시 첫 인자가 `true`이고 둘째가 에러 객체다. `resource.js` 29곳이 이 형태에 의존한다.
- **SELECT 결과는 배열 그대로.** 객체로 감싸지 않는다. 호출부가 `results[0]`, `results.length`, `results[i].pv`로 직접 다룬다.
- **INSERT/UPDATE/DELETE 결과는 `{ affectedRows, insertId }`.** MySQL 드라이버 원본 형태가 기준이고 다른 백엔드가 맞춘다.
- **`db.connect(host, port, user, password, callback)` 시그니처 유지.** `app.js` 3곳(149, 194, 237행)이 이 형태로 호출한다. 콜백은 성공 시 `'1'`.
- **`db.getConnection(cb)` → `cb('200', conn)` 또는 `cb('500-5')`.** `app.js`가 `if (code === '200')`으로 검사한다.
- **`sql_action.js`의 export 109개 시그니처 유지.** 의존 모듈 14개를 건드리지 않는다.
- **매 단계 배포 가능.** 전환된 함수는 파사드를, 안 된 함수는 기존 경로를 쓴다. 중간에 멈춰도 서버가 동작해야 한다.
- **Knex는 빌더로만.** `qb.toSQL().toNative()`까지만 쓴다. knex의 실행(`.then()`), 커넥션 풀, 마이그레이션은 쓰지 않는다.
- **최종 목표:** `grep -rn "global.usesqlite" --include="*.js" .`가 `mobius/db/index.js` 한 줄만 반환.
- **작업 브랜치:** `worktree-db-layer-abstraction` (worktree `.claude/worktrees/db-layer-abstraction`). 다른 세션이 메인 체크아웃을 쓰므로 이 디렉터리를 벗어나지 않는다.
- **테스트 프레임워크 없음.** `npm test`는 `exit 1` 스텁이다. 새 테스트는 `node --test`로 직접 돌린다.

---

## Task 1: 33개 분기 정밀 분류

`tools/audit_branches.js`는 휴리스틱이고 양방향 오차가 확인됐다. `insert_lookup`은 진짜 차이인데 놓칠 뻔했고, `update_ae`는 오탐이었다. 사람이 33개를 직접 읽고 판정해야 기계적 변환을 시작할 수 있다.

**Files:**
- Create: `docs/superpowers/specs/2026-08-26-branch-classification.md`
- Read: `mobius/sql_action.js`
- Use: `tools/audit_branches.js`

**Interfaces:**
- Consumes: 없음 (첫 작업)
- Produces: 분류 문서. Task 5 이후의 전환 작업이 이 문서의 `판정` 열을 근거로 진행한다. 판정값은 `MERGE`(기계적 병합 가능) 또는 `REVIEW`(개별 처리 필요) 둘 중 하나다.

- [ ] **Step 1: 도구를 돌려 출발점 목록을 만든다**

```bash
node tools/audit_branches.js mobius/sql_action.js > /tmp/audit.txt
node tools/audit_branches.js mobius/sql_action.js --detail >> /tmp/audit.txt
cat /tmp/audit.txt
```

기대 출력: `분기 총 33개`, 6개 분류 버킷의 개수와 함수 목록.

- [ ] **Step 2: 분류 문서의 뼈대를 만든다**

`docs/superpowers/specs/2026-08-26-branch-classification.md`:

```markdown
# `sql_action.js` usesqlite 분기 분류

- 기준 커밋: (여기에 `git rev-parse --short HEAD` 결과)
- 대상: `if (global.usesqlite === 'true')` 블록 33개
- 판정: `MERGE` = 파사드로 기계적 병합 가능 / `REVIEW` = 개별 처리 필요

`tools/audit_branches.js`의 자동 분류는 출발점이다. 아래 표의 판정은
각 분기를 직접 읽고 내린 것이며, 도구 분류와 다를 수 있다.

| 행 | 함수 | 도구 분류 | 판정 | 근거 |
|---:|---|---|---|---|
```

- [ ] **Step 3: 33개 분기를 하나씩 읽고 표를 채운다**

각 분기에 대해 이 순서로 확인한다.

1. `sed -n '<시작>,<끝>p' mobius/sql_action.js`로 분기 전체를 읽는다
2. **분기 밖에서** SQL이 만들어지는지 확인한다 (`var sql = ...`이 `if` 앞에 있는지)
3. 두 경로의 SQL을 나란히 비교한다
4. 차이가 다음 중 하나뿐이면 `MERGE`:
   - 이스케이프 방식 (`.replace(/'/g,"''")` vs `.replace(/\'/g,"\\'")`)
   - 실행자 (`sqlite.getResult(sql, null, …)` vs `db.getResult(sql, connection, …)`)
   - 식별자 인용 (`"or"` vs `ae.or` vs `` `or` ``)
   - upsert 문법 (`ON CONFLICT` vs `ON DUPLICATE KEY UPDATE`)
   - 행 잠금 유무 (`FOR UPDATE [NOWAIT]`)
5. 그 외 차이가 하나라도 있으면 `REVIEW`이고, 무엇이 다른지 근거 열에 적는다

`REVIEW` 판정의 근거 예시 (`insert_lookup`, 이미 확인됨):

```markdown
| 212 | `insert_lookup` | real | REVIEW | SQLite만 `select pv from acp where ri in (...)` 선행 쿼리 실행 후 `acpl` 컬럼 추가 삽입. 컬럼 16개 vs 15개. 파사드로 합치면 SQLite의 ACP 비정규화가 사라진다 |
```

`MERGE` 판정의 근거 예시 (`update_ae`, 이미 확인됨):

```markdown
| 2744 | `update_ae` | real | MERGE | 도구 오탐. 차이는 예약어 `or` 인용뿐 (`ae.or` vs `"or"`). knex가 `db.k('ae').update({or: ...})`로 흡수 |
```

- [ ] **Step 4: 표 아래에 요약과 미결 항목을 적는다**

```markdown
## 요약

| 판정 | 개수 |
|---|---:|
| MERGE | (실제 개수) |
| REVIEW | (실제 개수) |

## REVIEW 항목별 처리 방침

각 REVIEW 함수에 대해 "무엇을 보존해야 하는가"를 한 줄로 적는다.
전환 시 이 문장이 검증 기준이 된다.
```

- [ ] **Step 5: 검증 — 33개가 빠짐없이 판정됐는지 확인한다**

```bash
# 표의 데이터 행 수가 33인지 센다 (헤더 2줄 제외)
grep -c "^| [0-9]" docs/superpowers/specs/2026-08-26-branch-classification.md
```

기대: `33`

```bash
# 판정 열이 MERGE/REVIEW 둘 중 하나로만 채워졌는지
grep "^| [0-9]" docs/superpowers/specs/2026-08-26-branch-classification.md | grep -cv "MERGE\|REVIEW"
```

기대: `0`

- [ ] **Step 6: 커밋**

```bash
git add docs/superpowers/specs/2026-08-26-branch-classification.md
git commit -m "docs: usesqlite 분기 33개 정밀 분류

각 분기를 직접 읽고 MERGE/REVIEW 판정. 도구 자동 분류는 출발점으로만
사용하고 오탐/누락을 근거와 함께 바로잡았다."
```

---

## Task 2: HTTP 시나리오 동등성 하네스

리팩터링 전후의 **관측 가능한 동작**을 비교하는 안전망이다. SQL 텍스트가 바뀌어도 무관하다. 이걸 먼저 만들어야 이후 모든 전환에 안전망이 생긴다.

**Files:**
- Create: `tools/equivalence/run-scenarios.js`
- Create: `tools/equivalence/compare.js`
- Create: `tools/equivalence/README.md`
- Create: `tools/equivalence/out/.gitkeep`
- Modify: `.gitignore` (스냅샷 출력 제외)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `run-scenarios.js` — `node tools/equivalence/run-scenarios.js <out.json>`. 떠 있는 서버에 시나리오를 돌려 정규화된 스냅샷 JSON을 쓴다. 종료 코드 0=성공.
  - `compare.js` — `node tools/equivalence/compare.js <before.json> <after.json>`. 차이를 출력하고 차이가 있으면 종료 코드 1.

- [ ] **Step 1: 시나리오 러너를 작성한다**

`tools/equivalence/run-scenarios.js`:

```js
'use strict';
// 떠 있는 Mobius 에 고정 시나리오를 돌려 "관측 가능한 동작"의 스냅샷을 만든다.
// 리팩터링 전/후로 각각 돌리고 compare.js 로 비교한다.
//
//   node mobius.js sqlite &            # 서버를 먼저 띄운다
//   node tools/equivalence/run-scenarios.js tools/equivalence/out/before.json
//
// 실행마다 달라지는 값(생성된 ri, 타임스탬프)은 자리표시자로 치환해
// 두 스냅샷이 바이트 단위로 비교 가능하게 만든다.

const BASE = process.env.MOBIUS_BASE || 'http://127.0.0.1:7579';
const CSE = process.env.MOBIUS_CSE || 'Mobius';
const OUT = process.argv[2];

if (!OUT) {
    console.error('usage: node run-scenarios.js <output.json>');
    process.exit(1);
}

// 시나리오 전체에서 같은 이름을 쓴다. 시작할 때 지우고 시작하므로 재실행 가능하다.
const AE = 'eqv_ae';
const ORIGIN = 'C' + AE;

function headers(extra) {
    return Object.assign({
        'X-M2M-RI': 'eqv',
        'X-M2M-Origin': ORIGIN,
        'X-M2M-RVI': '2a',
        'Accept': 'application/json'
    }, extra || {});
}

async function call(method, path, opts) {
    opts = opts || {};
    const init = { method: method, headers: headers(opts.headers) };
    if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); }

    let res, text;
    try {
        res = await fetch(BASE + path, init);
        text = await res.text();
    } catch (e) {
        return { status: 0, rsc: null, body: { error: String(e.message) } };
    }

    let body;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }

    return {
        status: res.status,
        rsc: res.headers.get('x-m2m-rsc'),
        body: normalize(body)
    };
}

// 실행마다 달라지는 값을 자리표시자로 바꾼다.
//   생성된 ri:   "3-20260826034634188"  -> "<RI>"
//   타임스탬프:  "20260826T034634"      -> "<TS>"
//   AE 접두 ri:  "Ceqv_ae"              -> 그대로 (고정 이름이라 안정적)
const RI_RE = /^\d{1,2}-\d{15,}$/;
const TS_RE = /^\d{8}T\d{6}$/;

function normalize(v) {
    if (Array.isArray(v)) { return v.map(normalize); }
    if (v && typeof v === 'object') {
        const out = {};
        // 키 순서가 백엔드마다 다를 수 있으므로 정렬한다.
        Object.keys(v).sort().forEach(function (k) { out[k] = normalize(v[k]); });
        return out;
    }
    if (typeof v === 'string') {
        if (RI_RE.test(v)) { return '<RI>'; }
        if (TS_RE.test(v)) { return '<TS>'; }
        // uril 등 경로 안에 박힌 ri 도 치환한다
        return v.replace(/\b\d{1,2}-\d{15,}\b/g, '<RI>').replace(/\b\d{8}T\d{6}\b/g, '<TS>');
    }
    return v;
}

const CT_AE = 'application/vnd.onem2m-res+json;ty=2';
const CT_CNT = 'application/vnd.onem2m-res+json;ty=3';
const CT_CIN = 'application/vnd.onem2m-res+json;ty=4';
const CT_SUB = 'application/vnd.onem2m-res+json;ty=23';
const CT_ACP = 'application/vnd.onem2m-res+json;ty=1';
const CT_GRP = 'application/vnd.onem2m-res+json;ty=9';

async function main() {
    const snap = [];
    const step = async function (name, fn) { snap.push({ step: name, result: await fn() }); };

    // 0) 이전 실행 잔재 제거 (결과는 스냅샷에 넣지 않는다)
    await call('DELETE', '/' + CSE + '/' + AE);
    await call('DELETE', '/' + CSE + '/eqv_acp');

    await step('cse-retrieve', () => call('GET', '/' + CSE));

    await step('ae-create', () => call('POST', '/' + CSE, {
        headers: { 'Content-Type': CT_AE },
        body: { 'm2m:ae': { rn: AE, api: '0.2.481.2.0001.001.000111', rr: 'true' } }
    }));

    await step('ae-create-duplicate', () => call('POST', '/' + CSE, {
        headers: { 'Content-Type': CT_AE },
        body: { 'm2m:ae': { rn: AE, api: '0.2.481.2.0001.001.000111', rr: 'true' } }
    }));

    await step('ae-retrieve', () => call('GET', '/' + CSE + '/' + AE));

    await step('cnt-create', () => call('POST', '/' + CSE + '/' + AE, {
        headers: { 'Content-Type': CT_CNT },
        body: { 'm2m:cnt': { rn: 'c1' } }
    }));

    await step('cnt-create-mni', () => call('POST', '/' + CSE + '/' + AE, {
        headers: { 'Content-Type': CT_CNT },
        body: { 'm2m:cnt': { rn: 'c2', mni: 3 } }
    }));

    for (let i = 1; i <= 5; i++) {
        await step('cin-create-' + i, () => call('POST', '/' + CSE + '/' + AE + '/c2', {
            headers: { 'Content-Type': CT_CIN },
            body: { 'm2m:cin': { con: 'v' + i } }
        }));
    }

    // mni=3 이므로 오래된 것이 정리되어야 한다. 디바운스(1초) + 정리 대기.
    await new Promise(function (r) { setTimeout(r, 3000); });
    await step('cnt-after-purge', () => call('GET', '/' + CSE + '/' + AE + '/c2'));
    await step('cin-latest', () => call('GET', '/' + CSE + '/' + AE + '/c2/la'));
    await step('cin-oldest', () => call('GET', '/' + CSE + '/' + AE + '/c2/ol'));

    await step('sub-create', () => call('POST', '/' + CSE + '/' + AE + '/c1', {
        headers: { 'Content-Type': CT_SUB },
        body: { 'm2m:sub': { rn: 's1', nu: ['http://127.0.0.1:59999'], nct: 2 } }
    }));

    await step('acp-create', () => call('POST', '/' + CSE, {
        headers: { 'Content-Type': CT_ACP },
        body: {
            'm2m:acp': {
                rn: 'eqv_acp',
                pv: { acr: [{ acor: [ORIGIN], acop: 63 }] },
                pvs: { acr: [{ acor: [ORIGIN], acop: 63 }] }
            }
        }
    }));

    // SQLite 미지원 타입 — 501 이어야 한다
    await step('grp-create-unsupported', () => call('POST', '/' + CSE + '/' + AE, {
        headers: { 'Content-Type': CT_GRP },
        body: { 'm2m:grp': { rn: 'g1', mt: 3, mnm: 10, mid: ['/' + CSE + '/' + AE + '/c1'] } }
    }));

    await step('discovery-all', () => call('GET', '/' + CSE + '/' + AE + '?fu=1'));
    await step('discovery-ty4', () => call('GET', '/' + CSE + '/' + AE + '?fu=1&ty=4'));
    await step('discovery-limit', () => call('GET', '/' + CSE + '/' + AE + '?fu=1&lim=2'));
    await step('discovery-rn', () => call('GET', '/' + CSE + '/' + AE + '?fu=1&rn=c1'));

    await step('cnt-update', () => call('PUT', '/' + CSE + '/' + AE + '/c1', {
        headers: { 'Content-Type': 'application/vnd.onem2m-res+json' },
        body: { 'm2m:cnt': { lbl: ['tag1', 'tag2'] } }
    }));
    await step('cnt-after-update', () => call('GET', '/' + CSE + '/' + AE + '/c1'));

    await step('retrieve-missing', () => call('GET', '/' + CSE + '/' + AE + '/nope'));

    await step('cnt-delete', () => call('DELETE', '/' + CSE + '/' + AE + '/c1'));
    await new Promise(function (r) { setTimeout(r, 2000); });
    await step('cnt-after-delete', () => call('GET', '/' + CSE + '/' + AE + '/c1'));

    await step('ae-delete', () => call('DELETE', '/' + CSE + '/' + AE));
    await step('acp-delete', () => call('DELETE', '/' + CSE + '/eqv_acp'));

    require('fs').writeFileSync(OUT, JSON.stringify(snap, null, 2), 'utf8');
    console.log('스냅샷 ' + snap.length + '단계 -> ' + OUT);
}

main().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 비교기를 작성한다**

`tools/equivalence/compare.js`:

```js
'use strict';
// 두 스냅샷을 단계별로 비교한다. 차이가 있으면 종료 코드 1.
//   node tools/equivalence/compare.js before.json after.json

const fs = require('fs');

const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

if (a.length !== b.length) {
    console.error('단계 수가 다르다: ' + a.length + ' vs ' + b.length);
    process.exit(1);
}

let diffs = 0;
for (let i = 0; i < a.length; i++) {
    if (a[i].step !== b[i].step) {
        console.error('[' + i + '] 단계 이름 불일치: ' + a[i].step + ' vs ' + b[i].step);
        diffs++;
        continue;
    }
    const x = JSON.stringify(a[i].result);
    const y = JSON.stringify(b[i].result);
    if (x !== y) {
        console.error('\n[' + a[i].step + '] 결과가 다르다');
        console.error('  before: ' + x);
        console.error('  after : ' + y);
        diffs++;
    }
}

if (diffs === 0) {
    console.log('동일 — ' + a.length + '단계 모두 일치');
    process.exit(0);
}
console.error('\n' + diffs + '단계에서 차이 발견');
process.exit(1);
```

- [ ] **Step 3: 사용법 문서를 쓴다**

`tools/equivalence/README.md`:

```markdown
# 동작 동등성 하네스

리팩터링 전후로 Mobius 의 관측 가능한 동작이 같은지 확인한다.
SQL 텍스트가 바뀌어도 무관하다.

## 사용

    # 1) 기준선 (리팩터링 전)
    node mobius.js sqlite > /dev/null 2>&1 &
    sleep 12
    node tools/equivalence/run-scenarios.js tools/equivalence/out/before.json
    # 서버 종료

    # 2) 변경 후
    node mobius.js sqlite > /dev/null 2>&1 &
    sleep 12
    node tools/equivalence/run-scenarios.js tools/equivalence/out/after.json
    # 서버 종료

    # 3) 비교
    node tools/equivalence/compare.js \
        tools/equivalence/out/before.json tools/equivalence/out/after.json

## 주의

- 시나리오는 고정 이름(`eqv_ae`, `eqv_acp`)을 쓰고 시작할 때 지우므로
  재실행 가능하다.
- 생성된 `ri` 와 타임스탬프는 `<RI>` / `<TS>` 로 치환해 비교한다.
- MySQL 모드로도 같은 절차를 돌린다 (`node mobius.js mysql`).
  단 `before`/`after` 는 같은 백엔드끼리 비교해야 한다.
- `grp-create-unsupported` 단계는 SQLite 에서 501, MySQL 에서 201 이
  정상이다. 백엔드별로 기준선을 따로 뜬다.
```

- [ ] **Step 4: 출력 디렉터리를 만들고 gitignore 에 넣는다**

```bash
mkdir -p tools/equivalence/out
touch tools/equivalence/out/.gitkeep
```

`.gitignore`의 `hit.json` 줄 **앞에** 다음을 추가한다:

```
# 동등성 스냅샷은 로컬 산출물이다 (.gitkeep 은 남긴다)
tools/equivalence/out/*
!tools/equivalence/out/.gitkeep
```

- [ ] **Step 5: 기준선을 뜬다 (SQLite)**

```bash
node mobius.js sqlite > /tmp/eqv-boot.log 2>&1 &
sleep 12
grep -c "running at" /tmp/eqv-boot.log
```

기대: 워커 수 (CPU 코어 수만큼, 예: 17)

```bash
node tools/equivalence/run-scenarios.js tools/equivalence/out/before-sqlite.json
```

기대: `스냅샷 28단계 -> tools/equivalence/out/before-sqlite.json`

- [ ] **Step 6: 하네스가 실제로 동작을 잡는지 확인한다 — 같은 조건 두 번은 동일해야 한다**

```bash
node tools/equivalence/run-scenarios.js tools/equivalence/out/before-sqlite-2.json
node tools/equivalence/compare.js \
    tools/equivalence/out/before-sqlite.json tools/equivalence/out/before-sqlite-2.json
```

기대: `동일 — 28단계 모두 일치`, 종료 코드 0

**여기서 차이가 나면 정규화가 부족한 것이다.** 어떤 필드가 흔들리는지 확인해 `normalize()`에 치환 규칙을 추가한 뒤 Step 5부터 다시 한다. 이 단계를 통과하지 못하면 이후 전환의 안전망이 없다.

- [ ] **Step 7: 서버를 내린다**

```bash
node -e "
const {execSync}=require('child_process');
const out=execSync('powershell -NoProfile -Command \"(Get-CimInstance Win32_Process -Filter \\\"Name=\\x27node.exe\\x27\\\" | Where-Object { \\\$_.CommandLine -like \\x27*mobius.js*\\x27 }).ProcessId -join \\x27,\\x27\"',{encoding:'utf8'}).trim();
if(out){ out.split(',').forEach(p=>{try{process.kill(Number(p),'SIGKILL')}catch(e){}}); console.log('종료: '+out); } else { console.log('실행 중인 Mobius 없음'); }
"
```

- [ ] **Step 8: 커밋**

```bash
git add tools/equivalence .gitignore
git commit -m "test: HTTP 시나리오 동등성 하네스 추가

리팩터링 전후의 관측 가능한 동작을 비교한다. SQL 텍스트가 바뀌어도
무관하도록 응답 스냅샷을 정규화(생성 ri/타임스탬프 치환)해 비교한다.
같은 조건 두 번 실행이 바이트 단위로 일치함을 확인했다."
```

---

## Task 3: SQL 탭 — 실제 실행되는 SQL 캡처

동등성 하네스가 "결과가 같은가"를 본다면, SQL 탭은 "무엇이 실행됐는가"를 본다. 시나리오가 도는 동안 드라이버 계층에서 SQL을 가로채 기록한다. 픽스처를 손으로 만들 필요가 없고, 커버리지가 시나리오가 실제로 밟는 경로와 정확히 일치한다.

**Files:**
- Create: `tools/golden/tap.js`
- Create: `tools/golden/mobius-tapped.js`
- Create: `tools/golden/collect.js`
- Create: `tools/golden/diff.js`
- Create: `tools/golden/out/.gitkeep`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 2의 `run-scenarios.js`
- Produces:
  - `mobius-tapped.js` — `node tools/golden/mobius-tapped.js sqlite`로 서버를 띄우면 실행된 SQL이 `tools/golden/out/sql-<pid>.jsonl`에 쌓인다.
  - `collect.js` — `node tools/golden/collect.js <out.json>`. jsonl 조각들을 모아 정규화·정렬한 요약(`{total, distinct, rows:[{stmt,count}]}`)을 만든다.
  - `diff.js` — `node tools/golden/diff.js <before.json> <after.json>`. 두 요약의 SQL 형태 변화를 사람이 읽도록 출력한다. 판정하지 않으므로 항상 종료 코드 0.

- [ ] **Step 1: 탭 모듈을 작성한다**

`tools/golden/tap.js`:

```js
'use strict';
// db_action.getResult / db_sqlite.getResult 를 감싸 실행되는 SQL 을 기록한다.
// 동작은 바꾸지 않는다 — 원본을 그대로 호출하고 기록만 덧붙인다.
//
// 워커마다 프로세스가 다르므로 pid 별 파일에 쓴다. collect.js 가 합친다.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

function install() {
    try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) { /* 이미 있음 */ }
    const file = path.join(OUT_DIR, 'sql-' + process.pid + '.jsonl');
    const stream = fs.createWriteStream(file, { flags: 'a' });

    function wrap(mod, backend) {
        if (!mod || typeof mod.getResult !== 'function' || mod.__tapped) { return; }
        const orig = mod.getResult;
        mod.getResult = function (query, connection, callback) {
            try {
                stream.write(JSON.stringify({ backend: backend, sql: String(query) }) + '\n');
            } catch (e) { /* 기록 실패가 요청을 막으면 안 된다 */ }
            return orig.call(mod, query, connection, callback);
        };
        mod.__tapped = true;
    }

    wrap(require('../../mobius/db_action'), 'mysql');
    wrap(require('../../mobius/db_sqlite'), 'sqlite');

    // 전환된 함수는 db.run -> mobius/db/<backend>.execute 로 간다.
    // 이 경로도 잡아야 전환 전후를 같은 기준으로 비교할 수 있다.
    function wrapExecute(mod, backend) {
        if (!mod || typeof mod.execute !== 'function' || mod.__tapped_execute) { return; }
        const orig = mod.execute;
        mod.execute = function (handle, sql, bindings, callback) {
            try {
                stream.write(JSON.stringify({ backend: backend, sql: String(sql) }) + '\n');
            } catch (e) { /* 기록 실패가 요청을 막으면 안 된다 */ }
            return orig.call(mod, handle, sql, bindings, callback);
        };
        mod.__tapped_execute = true;
    }

    // 파사드 어댑터는 Task 4 이후에만 존재한다. 아직 없으면 조용히 건너뛴다.
    ['mysql', 'sqlite'].forEach(function (name) {
        try {
            wrapExecute(require('../../mobius/db/' + name), name);
        } catch (e) {
            // 아직 파사드가 없음 — 정상
        }
    });

    console.log('[sql-tap] 기록 시작 -> ' + file);
}

module.exports = { install: install };
```

- [ ] **Step 2: 탭이 걸린 진입점을 작성한다**

`tools/golden/mobius-tapped.js`:

```js
'use strict';
// mobius.js 를 띄우되 그 전에 SQL 탭을 건다.
//
//   node tools/golden/mobius-tapped.js sqlite
//
// cluster.fork() 는 process.argv[1] 을 다시 실행하므로 워커도 이 파일을 거친다.
// 따라서 워커에서도 탭이 걸린다.

process.chdir(require('path').join(__dirname, '..', '..'));

require('./tap').install();
require('../../mobius.js');
```

- [ ] **Step 3: 수집기를 작성한다**

`tools/golden/collect.js`:

```js
'use strict';
// pid 별 jsonl 조각을 모아 정규화하고, 형태별로 세어 요약한다.
//   node tools/golden/collect.js tools/golden/out/before-sqlite.json

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');
const OUT = process.argv[2];

if (!OUT) {
    console.error('usage: node collect.js <output.json>');
    process.exit(1);
}

// 값 자리는 형태가 무엇이든(문자열 리터럴 / ? 바인딩 / 맨숫자) 같은 토큰으로 만든다.
// 그래야 파라미터 바인딩 전환 전후의 SQL 이 같은 형태로 비교된다.
function shape(sql) {
    return sql
        .replace(/'(?:[^'\\]|\\.)*'/g, 'V')   // 문자열 리터럴
        .replace(/\?/g, 'V')                   // 바인딩 자리
        .replace(/\b\d+\b/g, 'V')              // 숫자 리터럴
        .replace(/`/g, '')                     // 식별자 인용
        .replace(/"/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

const counts = new Map();
let total = 0;

fs.readdirSync(OUT_DIR)
    .filter(function (f) { return /^sql-\d+\.jsonl$/.test(f); })
    .forEach(function (f) {
        fs.readFileSync(path.join(OUT_DIR, f), 'utf8')
            .split('\n')
            .filter(Boolean)
            .forEach(function (line) {
                let rec;
                try { rec = JSON.parse(line); } catch (e) { return; }
                const key = rec.backend + ' :: ' + shape(rec.sql);
                counts.set(key, (counts.get(key) || 0) + 1);
                total++;
            });
    });

const rows = Array.from(counts.entries())
    .map(function (e) { return { stmt: e[0], count: e[1] }; })
    .sort(function (x, y) { return x.stmt < y.stmt ? -1 : x.stmt > y.stmt ? 1 : 0; });

fs.writeFileSync(OUT, JSON.stringify({ total: total, distinct: rows.length, rows: rows }, null, 2), 'utf8');
console.log('SQL ' + total + '건 / 고유 형태 ' + rows.length + '종 -> ' + OUT);
```

- [ ] **Step 4: 출력 디렉터리와 gitignore**

```bash
mkdir -p tools/golden/out
touch tools/golden/out/.gitkeep
```

`.gitignore`에 추가한다 (Task 2에서 넣은 블록 바로 아래):

```
tools/golden/out/*
!tools/golden/out/.gitkeep
```

- [ ] **Step 5: 탭을 걸고 시나리오를 돌려 기준선을 만든다**

```bash
rm -f tools/golden/out/sql-*.jsonl
node tools/golden/mobius-tapped.js sqlite > /tmp/tap-boot.log 2>&1 &
sleep 12
grep -c "sql-tap. 기록 시작" /tmp/tap-boot.log
```

기대: 워커 수 이상 (마스터 + 워커 각각 1줄)

```bash
node tools/equivalence/run-scenarios.js tools/golden/out/_scenario-during-tap.json
node tools/golden/collect.js tools/golden/out/before-sqlite-sql.json
```

기대: `SQL <N>건 / 고유 형태 <M>종 -> tools/golden/out/before-sqlite-sql.json` (N > 0)

- [ ] **Step 6: 탭이 동작을 바꾸지 않았는지 확인한다**

```bash
node tools/equivalence/compare.js \
    tools/equivalence/out/before-sqlite.json tools/golden/out/_scenario-during-tap.json
```

기대: `동일 — 28단계 모두 일치`

**차이가 나면 탭이 동작에 영향을 준 것이다.** `tap.js`의 `wrap()`이 원본 호출을 그대로 반환하는지, 인자를 변형하지 않는지 확인한다.

- [ ] **Step 7: SQL 요약 비교기를 작성한다**

`collect.js`는 요약을 만들 뿐 비교하지 않는다. 전환 전후의 SQL 형태 변화를 볼 도구가 필요하다.

`tools/golden/diff.js`:

```js
'use strict';
// 두 SQL 요약을 비교한다. 실패시키지 않고 "변화 목록"을 보여주는 것이 목적이다.
// 파라미터 바인딩 전환으로 SQL 이 바뀌는 것은 의도된 변화이므로,
// 사람이 읽고 의도한 변화인지 판단한다.
//
//   node tools/golden/diff.js before.json after.json

const fs = require('fs');

const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

const A = new Map(a.rows.map(function (r) { return [r.stmt, r.count]; }));
const B = new Map(b.rows.map(function (r) { return [r.stmt, r.count]; }));

const gone = [], added = [], changed = [];

A.forEach(function (cnt, stmt) {
    if (!B.has(stmt)) { gone.push(stmt); }
    else if (B.get(stmt) !== cnt) { changed.push({ stmt: stmt, before: cnt, after: B.get(stmt) }); }
});
B.forEach(function (cnt, stmt) { if (!A.has(stmt)) { added.push(stmt); } });

console.log('before: ' + a.total + '건 / ' + a.distinct + '종');
console.log('after : ' + b.total + '건 / ' + b.distinct + '종');

if (gone.length) {
    console.log('\n── 사라진 SQL 형태 (' + gone.length + ') ──');
    gone.forEach(function (s) { console.log('  - ' + s); });
}
if (added.length) {
    console.log('\n── 새로 생긴 SQL 형태 (' + added.length + ') ──');
    added.forEach(function (s) { console.log('  + ' + s); });
}
if (changed.length) {
    console.log('\n── 실행 횟수가 바뀐 형태 (' + changed.length + ') ──');
    changed.forEach(function (c) { console.log('  ~ ' + c.before + ' -> ' + c.after + '  ' + c.stmt); });
}
if (!gone.length && !added.length && !changed.length) {
    console.log('\nSQL 형태와 실행 횟수가 완전히 동일하다.');
}

console.log('\n※ 이 도구는 판정하지 않는다. 변화가 의도한 것인지는 사람이 본다.');
console.log('   특히 "실행 횟수가 바뀐 형태"는 쿼리가 늘거나 줄었다는 뜻이므로 반드시 확인한다.');
```

동작을 확인한다 — 같은 파일끼리 비교하면 차이가 없어야 한다.

```bash
node tools/golden/diff.js \
    tools/golden/out/before-sqlite-sql.json tools/golden/out/before-sqlite-sql.json
```

기대: `SQL 형태와 실행 횟수가 완전히 동일하다.`

- [ ] **Step 8: 서버를 내리고 커밋**

Task 2 Step 7의 종료 명령을 다시 쓴다.

```bash
git add tools/golden .gitignore
git commit -m "test: SQL 탭 — 실행되는 SQL 캡처 하네스

드라이버 계층에서 getResult 를 감싸 실행 SQL 을 pid 별 jsonl 로 기록한다.
픽스처 없이 시나리오가 밟는 실제 경로를 커버한다. 탭이 걸린 상태와
안 걸린 상태의 동등성 스냅샷이 일치함을 확인했다."
```

---

## Task 4: knex 설치와 파사드·어댑터 뼈대

아직 아무도 쓰지 않는다. 이 태스크가 끝나도 서버 동작은 한 글자도 바뀌지 않는다.

**Files:**
- Modify: `package.json` (knex 의존성)
- Create: `mobius/db/index.js`
- Create: `mobius/db/mysql.js`
- Create: `mobius/db/sqlite.js`
- Create: `test/db-facade.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `require('./db')` → `{ connect, getConnection, release, k, raw, run, transaction, can, _adapterName }`
  - `db.connect(host, port, user, password, cb)` — `cb('1')` on success
  - `db.getConnection(cb)` — `cb('200', handle)` | `cb('500-5')`
  - `db.release(handle)` — 반환값 없음
  - `db.k(table)` → knex QueryBuilder
  - `db.raw(sql, bindings)` → knex Raw
  - `db.run(qb, conn, cb)` — `cb(null, rows[])` (SELECT) / `cb(null, {affectedRows, insertId})` / `cb(true, err)`
  - `db.can(name)` → boolean (`'transaction'`, `'rowLock'`)
  - 어댑터 계약: `{ name, knexClient, connect, getConnection, release, execute, normalizeResult, normalizeError, begin, commit, rollback, capabilities, schemaFile }`

- [ ] **Step 1: knex 를 설치한다**

```bash
npm install knex@3.3.0 --save --no-audit --no-fund
node -e "console.log('knex', require('knex/package.json').version)"
```

기대: `knex 3.3.0`

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`test/` 디렉터리는 아직 없다. 먼저 만든다 (`.gitignore`의 `test_*` 패턴은 `test/`를 막지 않는다 — 확인함).

```bash
mkdir -p test
```

`test/db-facade.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const DB = path.join(__dirname, '..', 'mobius', 'db');

function freshDb(useSqlite) {
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    delete require.cache[require.resolve(path.join(DB, 'sqlite.js'))];
    global.usesqlite = useSqlite ? 'true' : 'false';
    return require(DB);
}

test('usesqlite 에 따라 어댑터를 고른다', function () {
    let db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {});
    assert.strictEqual(db._adapterName(), 'sqlite');

    db = freshDb(false);
    db.connect('localhost', 3306, 'root', 'x', function () {});
    assert.strictEqual(db._adapterName(), 'mysql');
});

test('빌더가 백엔드에 맞는 SQL 을 만든다', function () {
    let db = freshDb(false);
    db.connect('localhost', 3306, 'root', 'x', function () {});
    let n = db.k('acp').insert({ ri: 'x', pv: 'p' }).toSQL().toNative();
    assert.match(n.sql, /^insert into `acp`/);
    assert.deepStrictEqual(n.bindings, ['p', 'x']);

    db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {});
    n = db.k('acp').insert({ ri: 'x', pv: 'p' }).toSQL().toNative();
    assert.match(n.sql, /^insert into `acp`/);
});

test('upsert 가 백엔드별로 갈린다', function () {
    let db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    let sql = db.k('hit').insert({ ct: '1', http: 1 })
        .onConflict('ct').merge({ http: db.raw('http + ?', [1]) })
        .toSQL().toNative().sql;
    assert.match(sql, /on duplicate key update/i);

    db = freshDb(true);
    db.connect('h', 1, 'u', 'p', function () {});
    sql = db.k('hit').insert({ ct: '1', http: 1 })
        .onConflict('ct').merge({ http: db.raw('http + ?', [1]) })
        .toSQL().toNative().sql;
    assert.match(sql, /on conflict/i);
});

test('rowLock 능력이 백엔드별로 다르다', function () {
    let db = freshDb(false);
    db.connect('h', 1, 'u', 'p', function () {});
    assert.strictEqual(db.can('rowLock'), true);
    assert.strictEqual(db.can('transaction'), true);

    db = freshDb(true);
    db.connect('h', 1, 'u', 'p', function () {});
    assert.strictEqual(db.can('rowLock'), false);
    assert.strictEqual(db.can('transaction'), false);
});

test('SQLite 에서 SELECT 는 배열, 쓰기는 객체를 돌려준다', function (t, done) {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function (rsc) {
        assert.strictEqual(rsc, '1');
        db.getConnection(function (code, conn) {
            assert.strictEqual(code, '200');
            db.run(db.raw('create table if not exists t_facade (a text)'), conn, function (err) {
                assert.ok(!err, 'create 실패: ' + JSON.stringify(err));
                db.run(db.k('t_facade').insert({ a: 'hello' }), conn, function (err2, ins) {
                    assert.ok(!err2);
                    assert.strictEqual(typeof ins, 'object');
                    assert.ok(!Array.isArray(ins), '쓰기 결과는 배열이면 안 된다');
                    assert.strictEqual(ins.affectedRows, 1);
                    db.run(db.k('t_facade').select('*'), conn, function (err3, rows) {
                        assert.ok(!err3);
                        assert.ok(Array.isArray(rows), 'SELECT 결과는 배열이어야 한다');
                        assert.strictEqual(rows[0].a, 'hello');
                        db.run(db.raw('drop table t_facade'), conn, function () {
                            db.release(conn);
                            done();
                        });
                    });
                });
            });
        });
    });
});

test('제약 위반 에러가 중립 코드로 정규화된다', function (t, done) {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {
        db.getConnection(function (code, conn) {
            db.run(db.raw('create table if not exists t_dup (a text primary key)'), conn, function () {
                db.run(db.k('t_dup').insert({ a: 'k' }), conn, function () {
                    db.run(db.k('t_dup').insert({ a: 'k' }), conn, function (err, e) {
                        assert.strictEqual(err, true, '실패 시 첫 인자는 true 여야 한다');
                        assert.strictEqual(e.code, 'DUPLICATE_KEY');
                        db.run(db.raw('drop table t_dup'), conn, function () {
                            db.release(conn);
                            done();
                        });
                    });
                });
            });
        });
    });
});

test('transaction: 능력이 없으면 트랜잭션 없이 본문을 실행한다', function (t, done) {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {
        let ran = false;
        db.transaction(null, function (conn, finish) {
            ran = true;
            finish(null, 'ok');
        }, function (err, result) {
            assert.strictEqual(err, null);
            assert.strictEqual(result, 'ok');
            assert.strictEqual(ran, true);
            done();
        });
    });
});

test('transaction: 본문의 에러 객체가 보존된다', function (t, done) {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {
        const boom = { code: 'DUPLICATE_KEY', message: 'boom' };
        db.transaction(null, function (conn, finish) {
            finish(true, boom);
        }, function (err, result) {
            assert.strictEqual(err, true, '실패 시 첫 인자는 true');
            assert.strictEqual(result, boom, '에러 객체가 소멸하면 안 된다');
            done();
        });
    });
});

test('transaction: 본문의 동기 예외를 잡아 콜백으로 넘긴다', function (t, done) {
    const db = freshDb(true);
    db.connect('localhost', 3306, 'root', 'x', function () {
        db.transaction(null, function () {
            throw new Error('sync boom');
        }, function (err, e) {
            assert.strictEqual(err, true);
            assert.match(e.message, /sync boom/);
            done();
        });
    });
});

// capable 경로(트랜잭션 지원 백엔드)는 실제 MySQL 서버 없이도 검증할 수 있다.
// 어댑터의 begin/commit/rollback 을 스텁으로 갈아끼우면 파사드가 그것들을
// 어떤 순서로 부르고 콜백을 몇 번 정산하는지 그대로 드러난다.
function capableDb(stubs) {
    const db = freshDb(false);                       // mysql 어댑터 선택
    const mysql = require(path.join(DB, 'mysql.js'));
    const ops = [];

    mysql.capabilities = { transaction: true, rowLock: true };
    mysql.begin = function (h, cb) { ops.push('begin'); cb(stubs.beginErr || null); };
    mysql.commit = function (h, cb) { ops.push('commit'); cb(stubs.commitErr || null); };
    mysql.rollback = function (h, cb) { ops.push('rollback'); cb(stubs.rollbackErr || null); };

    db.connect('h', 1, 'u', 'p', function () {});
    return { db: db, ops: ops };
}

test('transaction(capable): 성공하면 begin -> commit, 정산 1회', function (t, done) {
    const { db, ops } = capableDb({});
    let calls = 0;
    db.transaction({}, function (conn, finish) { finish(null, 'r'); }, function (err, result) {
        calls++;
        assert.strictEqual(err, null);
        assert.strictEqual(result, 'r');
        assert.deepStrictEqual(ops, ['begin', 'commit']);
        setTimeout(function () { assert.strictEqual(calls, 1); done(); }, 10);
    });
});

test('transaction(capable): 본문 실패하면 rollback 하고 에러를 보존한다', function (t, done) {
    const { db, ops } = capableDb({});
    const boom = { code: 'DUPLICATE_KEY' };
    db.transaction({}, function (conn, finish) { finish(true, boom); }, function (err, result) {
        assert.strictEqual(err, true);
        assert.strictEqual(result, boom);
        assert.deepStrictEqual(ops, ['begin', 'rollback']);
        done();
    });
});

test('transaction(capable): 본문 동기 예외도 rollback 한다', function (t, done) {
    const { db, ops } = capableDb({});
    db.transaction({}, function () { throw new Error('sync boom'); }, function (err, e) {
        assert.strictEqual(err, true);
        assert.match(e.message, /sync boom/);
        assert.deepStrictEqual(ops, ['begin', 'rollback']);
        done();
    });
});

test('transaction(capable): commit 실패하면 rollback 까지 간다', function (t, done) {
    const { db, ops } = capableDb({ commitErr: new Error('commit-fail') });
    db.transaction({}, function (conn, finish) { finish(null, 'r'); }, function (err, e) {
        assert.strictEqual(err, true);
        assert.match(e.message, /commit-fail/);
        assert.deepStrictEqual(ops, ['begin', 'commit', 'rollback']);
        done();
    });
});

test('transaction(capable): begin 실패하면 본문을 실행하지 않는다', function (t, done) {
    const { db, ops } = capableDb({ beginErr: new Error('begin-fail') });
    let ran = false;
    db.transaction({}, function () { ran = true; }, function (err, e) {
        assert.strictEqual(err, true);
        assert.match(e.message, /begin-fail/);
        assert.strictEqual(ran, false);
        assert.deepStrictEqual(ops, ['begin']);
        done();
    });
});

test('transaction: finish 를 두 번 불러도 한 번만 정산한다 (양쪽 경로)', function (t, done) {
    const { db, ops } = capableDb({});
    let capableCalls = 0;
    db.transaction({}, function (conn, finish) { finish(null, 'a'); finish(null, 'b'); }, function () {
        capableCalls++;
    });

    setTimeout(function () {
        assert.strictEqual(capableCalls, 1, 'capable 경로 정산은 1회여야 한다');
        assert.deepStrictEqual(ops, ['begin', 'commit'], 'commit 도 1회여야 한다');

        const sdb = freshDb(true);                    // sqlite = 무능력 경로
        sdb.connect('localhost', 3306, 'root', 'x', function () {
            let n = 0;
            sdb.transaction(null, function (conn, finish) {
                finish(null, 'a');
                finish(null, 'b');
                throw new Error('late throw');        // 정산 후 예외도 재정산하면 안 된다
            }, function () { n++; });
            setTimeout(function () {
                assert.strictEqual(n, 1, '무능력 경로 정산도 1회여야 한다');
                done();
            }, 10);
        });
    }, 20);
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
node --test test/db-facade.test.js
```

기대: 실패. `Cannot find module '.../mobius/db'`

- [ ] **Step 4: MySQL 어댑터를 쓴다**

`mobius/db/mysql.js`:

```js
'use strict';
// MySQL 어댑터. 실행과 결과/에러 정규화만 담당한다.
// 방언(플레이스홀더, 식별자 인용, upsert, 행 잠금)은 knex 가 처리하므로 여기 없다.

var mysql = require('mysql');

var pool = null;

exports.name = 'mysql';
exports.knexClient = 'mysql';
exports.schemaFile = 'mobiusdb.sql';

exports.capabilities = {
    transaction: true,
    rowLock: true          // SELECT ... FOR UPDATE [NOWAIT]
};

exports.connect = function (conf, callback) {
    pool = mysql.createPool({
        host: conf.host,
        port: conf.port,
        user: conf.user,
        password: conf.password,
        database: 'mobiusdb',
        connectionLimit: 100,
        waitForConnections: true,
        debug: false,
        acquireTimeout: 50000,
        queueLimit: 0
    });
    callback('1');
};

exports.getConnection = function (callback) {
    if (pool == null) {
        console.error('[db/mysql] not connected');
        callback('500-5');
        return;
    }
    pool.getConnection(function (err, connection) {
        if (err || !connection) { callback('500-5'); }
        else { callback('200', connection); }
    });
};

exports.release = function (handle) {
    if (handle && typeof handle.release === 'function') { handle.release(); }
};

exports.execute = function (handle, sql, bindings, callback) {
    handle.query({ sql: sql, values: bindings, timeout: 60000 }, function (err, rows) {
        if (err) { return callback(err, null); }
        callback(null, rows);
    });
};

// SELECT 는 배열 그대로, 쓰기는 {affectedRows, insertId}.
// mysql 드라이버가 이미 이 형태라 통과시키되 계약을 명시적으로 고정한다.
exports.normalizeResult = function (raw) {
    if (Array.isArray(raw)) { return raw; }
    return {
        affectedRows: raw && raw.affectedRows !== undefined ? raw.affectedRows : 0,
        insertId: raw ? raw.insertId : undefined
    };
};

exports.normalizeError = function (err) {
    if (!err) { return { code: 'UNKNOWN' }; }

    // 원본 드라이버 코드를 보존한다. 중립 코드로 덮어쓰면 백엔드 고유
    // 조건(락 충돌 등)을 상위에서 복구할 방법이 사라진다.
    var driverCode = err.code;

    var code = 'UNKNOWN';
    if (err.code === 'ER_DUP_ENTRY') { code = 'DUPLICATE_KEY'; }
    else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') { code = 'FK_VIOLATION'; }
    else if (err.code === 'ER_BAD_NULL_ERROR') { code = 'NOT_NULL'; }
    else if (err.code === 'ER_LOCK_NOWAIT' || err.errno === 3572) { code = 'LOCK_CONFLICT'; }
    else if (err.code === 'ER_LOCK_DEADLOCK' || err.errno === 1213) { code = 'LOCK_CONFLICT'; }
    else if (err.code === 'ER_LOCK_WAIT_TIMEOUT' || err.errno === 1205) { code = 'LOCK_TIMEOUT'; }

    // err.constraint 는 부분 문자열 비교용 힌트다. 동등 비교하면 안 된다 —
    // MySQL 5.7 은 "aei_UNIQUE", MySQL 8 은 "ae.aei_UNIQUE", SQLite 는 "aei" 를 준다.
    // 테이블 접두사를 떼어 최소한의 공통 형태로 맞춘다.
    var constraint = null;
    var m = /key '([^']+)'/i.exec(err.sqlMessage || err.message || '');
    if (m) { constraint = m[1].replace(/^.*\./, ''); }

    err.driverCode = driverCode;
    err.code = code;
    err.constraint = constraint;
    return err;
};

exports.begin = function (handle, callback) { handle.beginTransaction(callback); };
exports.commit = function (handle, callback) { handle.commit(callback); };
exports.rollback = function (handle, callback) { handle.rollback(callback); };
```

- [ ] **Step 5: SQLite 어댑터를 쓴다**

`mobius/db/sqlite.js`:

```js
'use strict';
// SQLite 어댑터. 풀이 없고 워커당 핸들 하나를 공유한다.
//
// capabilities.transaction 이 false 인 이유:
//   핸들이 하나뿐이라 비동기 호출이 겹치면 서로 다른 논리적 트랜잭션이
//   같은 핸들에서 뒤섞인다. 현재 코드도 SQLite 경로에서는 트랜잭션을
//   쓰지 않으므로 false 선언이 곧 기존 동작 보존이다.
//   제대로 지원하려면 핸들 풀이나 직렬화 큐가 필요하다 — 후속 작업.
//
// capabilities.rowLock 이 false 인 이유:
//   SQLite 는 파일 단위 단일 라이터라 행 잠금 개념이 없다.
//   knex 는 forUpdate() 를 자동 생략하지만 noWait() 은 예외를 던지므로
//   호출부가 db.can('rowLock') 으로 검사해야 한다.

var sqlite3 = require('sqlite3').verbose();
var fs = require('fs');
var path = require('path');

var db = null;

exports.name = 'sqlite';
exports.knexClient = 'sqlite3';
exports.schemaFile = 'mobiusdb_sqlite.sql';

exports.capabilities = {
    transaction: false,
    rowLock: false
};

exports.connect = function (conf, callback) {
    db = new sqlite3.Database('./mobius.db', function (err) {
        if (err) {
            console.error('[db/sqlite] ' + err.message);
            callback('0');
            return;
        }
        console.log('[db/sqlite] connected');
        db.configure('busyTimeout', 50000);
        db.run('PRAGMA foreign_keys = ON');

        try {
            var schema = fs.readFileSync(path.join(__dirname, '..', exports.schemaFile), 'utf8');
            db.exec(schema, function (e) {
                if (e) { console.error('[db/sqlite] schema init error: ' + e.message); }
                else { console.log('[db/sqlite] schema initialized'); }
                callback('1');
            });
        } catch (e) {
            console.error('[db/sqlite] cannot read schema: ' + e.message);
            callback('1');
        }
    });
};

exports.getConnection = function (callback) {
    if (db) { callback('200', db); }
    else { callback('500-5'); }
};

// 풀이 없으므로 반납할 것이 없다.
exports.release = function () { };

// 행을 돌려주는 문장인지 판별한다.
// sqlite3 는 db.all(행 반환)과 db.run(변경 건수)을 호출자가 골라야 하는데,
// 잘못 고르면 에러 없이 조용히 틀린 형태를 돌려준다(직전 문장의 changes 가 섞인다).
function isRowReturning(sql) {
    var s = String(sql);

    // 선행 공백과 주석을 걷어낸다
    var prev;
    do {
        prev = s;
        s = s.replace(/^\s+/, '')
             .replace(/^--[^\n]*\n?/, '')
             .replace(/^\/\*[\s\S]*?\*\//, '');
    } while (s !== prev);

    if (/^(select|with|pragma|explain|values)\b/i.test(s)) { return true; }

    // RETURNING 검사 전에 문자열 리터럴을 지운다.
    // 안 그러면 values ('returning home') 같은 데이터가 걸려 쓰기가 읽기로 오분류된다.
    var withoutLiterals = s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    if (/\breturning\b/i.test(withoutLiterals)) { return true; }
    return false;
}

exports.execute = function (handle, sql, bindings, callback) {
    // 이 어댑터는 넘어온 handle 을 쓰지 않고 모듈이 소유한 db 핸들만 쓴다.
    //
    // 이유: app.js 는 usesqlite 와 무관하게 항상 MySQL 풀 커넥션을 sql_action 에
    // 넘긴다. 그 핸들은 truthy 이므로 `handle || db` 로는 MySQL 커넥션이 선택되어
    // h.all()/h.run() 이 깨진다. 기존 db_sqlite.getResult 도 connection 인자를
    // 무시하고 모듈 핸들만 쓴다 — 여기서 그 동작을 그대로 따른다.
    // (SQLite 는 풀이 없고 워커당 핸들 하나를 공유한다.)
    var h = db;

    if (isRowReturning(sql)) {
        h.all(sql, bindings, function (err, rows) {
            if (err) { return callback(err, null); }
            callback(null, rows);
        });
    } else {
        h.run(sql, bindings, function (err) {
            if (err) { return callback(err, null); }
            callback(null, { affectedRows: this.changes, insertId: this.lastID });
        });
    }
};

exports.normalizeResult = function (raw) {
    if (Array.isArray(raw)) { return raw; }
    return {
        affectedRows: raw && raw.affectedRows !== undefined ? raw.affectedRows : 0,
        insertId: raw ? raw.insertId : undefined
    };
};

// (Task 5 사후 수정, 2026-08-26) 최초 구현은 `handle || db` 였다. 하지만
// app.js 는 usesqlite 값과 무관하게 항상 db_action.js 의 MySQL 풀 커넥션을
// sql_action 함수에 넘긴다 — 그 객체는 truthy 라서 `handle || db` 로는 항상
// MySQL 커넥션이 선택돼 h.all()/h.run() 호출이 깨진다. Task 5 에서 insert_acp
// 를 실서버(SQLite 모드)로 검증하다 이 결함이 드러났다. handle 파라미터는
// Task 3 SQL 탭이 이 시그니처를 감싸므로 유지하되, 실제로는 쓰지 않는다.

exports.normalizeError = function (err) {
    if (!err) { return { code: 'UNKNOWN' }; }

    var driverCode = err.code;
    var raw = err.code || '';
    var msg = err.message || '';
    var code = 'UNKNOWN';

    // node-sqlite3 5.1.7 은 확장 코드(SQLITE_CONSTRAINT_*)를 내보내지 않는다 —
    // err.code 는 'SQLITE_CONSTRAINT'까지만 준다. 아래 SQLITE_CONSTRAINT_* 분기는
    // 실측으로는 도달하지 않으며(메시지 정규식이 실제 판별을 담당한다) 상위
    // 드라이버 버전이 확장 코드를 채워주기 시작할 때를 대비해 남겨둔다.
    if (raw === 'SQLITE_BUSY' || raw === 'SQLITE_LOCKED') {
        code = 'LOCK_CONFLICT';
    } else if (raw === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY constraint/i.test(msg)) {
        code = 'FK_VIOLATION';
    } else if (raw === 'SQLITE_CONSTRAINT_NOTNULL' || /NOT NULL constraint/i.test(msg)) {
        code = 'NOT_NULL';
    } else if (raw === 'SQLITE_CONSTRAINT' || raw === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
               raw === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint/i.test(msg)) {
        code = 'DUPLICATE_KEY';
    }

    // 부분 문자열 비교용 힌트. "UNIQUE constraint failed: ae.aei" -> "aei"
    var constraint = null;
    var m = /constraint failed:\s*([^\s,]+)/i.exec(msg);
    if (m) { constraint = m[1].replace(/^.*\./, ''); }

    err.driverCode = driverCode;
    err.code = code;
    err.constraint = constraint;
    return err;
};

// capabilities.transaction 이 false 이므로 파사드가 이 함수들을 부르지 않는다.
// 계약을 채우기 위해 두되, 실수로 호출되면 즉시 드러나도록 에러를 넘긴다.
function unsupported(handle, callback) {
    callback(new Error('[db/sqlite] transactions are not supported on this backend'));
}
exports.begin = unsupported;
exports.commit = unsupported;
exports.rollback = unsupported;
```

- [ ] **Step 6: 파사드를 쓴다**

`mobius/db/index.js`:

```js
'use strict';
// DB 파사드. global.usesqlite 를 읽는 유일한 지점이다.
//
// knex 는 빌더로만 쓴다 — qb.toSQL().toNative() 로 {sql, bindings} 를 얻고
// 실행은 어댑터가 기존 드라이버로 한다. knex 의 실행/풀/마이그레이션은 쓰지 않는다.
//
// 콜백 계약은 기존 db_action.getResult 를 그대로 따른다:
//   성공  cb(null, rows[])  또는  cb(null, {affectedRows, insertId})
//   실패  cb(true, err)      ← 첫 인자가 true, 둘째가 에러
// resource.js 29곳이 이 형태에 의존한다.

var knexFactory = require('knex');

var ADAPTERS = {
    mysql: require('./mysql'),
    sqlite: require('./sqlite')
};

var adapter = null;
var knexInstance = null;

function pick() {
    return global.usesqlite === 'true' ? ADAPTERS.sqlite : ADAPTERS.mysql;
}

function assertReady() {
    if (!adapter || !knexInstance) {
        throw new Error('[db] connect() has not been called');
    }
}

exports.connect = function (host, port, user, password, callback) {
    adapter = pick();
    knexInstance = knexFactory({ client: adapter.knexClient, useNullAsDefault: true });

    if (!adapter.capabilities.transaction) {
        console.log('[db] backend "' + adapter.name + '" does not support transactions; ' +
                    'db.transaction() runs the body without one');
    }

    adapter.connect({ host: host, port: port, user: user, password: password }, callback);
};

exports.getConnection = function (callback) {
    assertReady();
    adapter.getConnection(callback);
};

exports.release = function (handle) {
    assertReady();
    adapter.release(handle);
};

// 빌더 진입점. sql_action.js 는 db.k('table')... 로 쿼리를 만든다.
exports.k = function (table) {
    assertReady();
    return knexInstance(table);
};

exports.raw = function (sql, bindings) {
    assertReady();
    return bindings === undefined ? knexInstance.raw(sql) : knexInstance.raw(sql, bindings);
};

exports.run = function (qb, conn, callback) {
    assertReady();

    var native;
    try {
        native = qb.toSQL().toNative();
    } catch (e) {
        return callback(true, adapter.normalizeError(e));
    }

    adapter.execute(conn, native.sql, native.bindings, function (err, raw) {
        if (err) { return callback(true, adapter.normalizeError(err)); }
        callback(null, adapter.normalizeResult(raw));
    });
};

// 트랜잭션 본문을 실행한다. 능력이 없는 백엔드에서는 트랜잭션 없이 본문만 돈다
// (조용한 no-op 이 아니라 connect() 에서 이미 경고를 남겼다).
//
// 콜백 규약은 이 레이어의 나머지와 같다: 성공 cb(null, result), 실패 cb(true, err).
// 본문은 finish(err, result) 로 2인자를 넘겨야 에러 객체가 보존된다.
// finish 는 몇 번 불러도 한 번만 정산된다 — 두 경로 모두 그렇다.
exports.transaction = function (conn, body, callback) {
    assertReady();

    var capable = adapter.capabilities.transaction;
    var settled = false;

    function settle(err, result) {
        if (settled) { return false; }
        settled = true;
        callback(err || null, result);
        return true;
    }

    // 본문이 이미 정산한 뒤 던진 예외는 콜백으로 갈 곳이 없다.
    // 조용히 삼키면 원인 불명이 되므로 로그로 남긴다.
    function reportLate(e) {
        console.error('[db] transaction body threw after settling: ' + ((e && e.message) || e));
    }

    if (!capable) {
        try {
            body(conn, function (err, result) { settle(err, result); });
        } catch (e) {
            if (!settle(true, adapter.normalizeError(e))) { reportLate(e); }
        }
        return;
    }

    adapter.begin(conn, function (beginErr) {
        if (beginErr) { return settle(true, adapter.normalizeError(beginErr)); }

        var finishing = false;

        function finish(err, result) {
            if (finishing || settled) { return false; }
            finishing = true;

            if (err) {
                adapter.rollback(conn, function (rbErr) {
                    if (rbErr) { console.error('[db] rollback failed: ' + ((rbErr.message) || rbErr)); }
                    settle(err, result);
                });
                return true;
            }

            adapter.commit(conn, function (commitErr) {
                if (!commitErr) { return settle(null, result); }
                // commit 실패 시에도 커넥션을 깨끗한 상태로 돌려놓아야 한다.
                adapter.rollback(conn, function (rbErr) {
                    if (rbErr) { console.error('[db] rollback after failed commit also failed: ' + ((rbErr.message) || rbErr)); }
                    settle(true, adapter.normalizeError(commitErr));
                });
            });
            return true;
        }

        // 본문이 동기 throw 하면 rollback 없이 빠져나가 커넥션이 열린 트랜잭션
        // 상태로 풀에 반납된다. 다음 요청이 남의 트랜잭션 안에서 돌게 된다.
        try {
            body(conn, finish);
        } catch (e) {
            if (!finish(true, adapter.normalizeError(e))) { reportLate(e); }
        }
    });
};

exports.can = function (name) {
    assertReady();
    return adapter.capabilities[name] === true;
};

// 테스트용. 운영 코드는 어느 백엔드인지 알 필요가 없다.
exports._adapterName = function () {
    return adapter ? adapter.name : null;
};
```

- [ ] **Step 7: 테스트가 통과하는지 확인한다**

```bash
node --test test/db-facade.test.js
```

기대: 15개 테스트 모두 PASS

실패하면 실패 메시지를 읽고 고친다. 특히 `bindings` 순서는 knex가 컬럼을 알파벳순으로 정렬하므로 `{ri, pv}` → `['p', 'x']`가 맞다.

- [ ] **Step 8: 서버가 여전히 정상인지 확인한다 (파사드는 아직 아무도 안 쓴다)**

추적 파일에 더해 **아직 커밋 안 된 새 파일**도 함께 검사한다. 이 시점에 `git ls-files`는 새 파일을 모른다.

```bash
node -e "
const {execFileSync}=require('child_process');
const tracked=execFileSync('git',['ls-files','*.js'],{encoding:'utf8'}).trim().split('\n');
const added=['mobius/db/index.js','mobius/db/mysql.js','mobius/db/sqlite.js','test/db-facade.test.js'];
const files=tracked.concat(added);
let fail=0;
for(const f of files){ try{ execFileSync(process.execPath,['--check',f],{stdio:'pipe'}); }catch(e){ console.log('FAIL: '+f); fail++; } }
console.log(fail===0 ? '문법 통과 ('+files.length+'개)' : fail+'개 실패');
"
```

기대: `문법 통과 (40개)` — 추적 36 + 신규 4. 추적 개수가 다르면 그 수 + 4가 나오면 된다.

```bash
node mobius.js sqlite > /tmp/t4-boot.log 2>&1 &
sleep 12
grep -c "running at" /tmp/t4-boot.log
node tools/equivalence/run-scenarios.js tools/equivalence/out/after-task4.json
node tools/equivalence/compare.js \
    tools/equivalence/out/before-sqlite.json tools/equivalence/out/after-task4.json
```

기대: `동일 — 28단계 모두 일치`. 서버를 내린다.

- [ ] **Step 9: 커밋**

```bash
git add package.json package-lock.json mobius/db test/db-facade.test.js
git commit -m "feat: DB 파사드와 MySQL/SQLite 어댑터 추가

knex 3.3.0 을 빌더로만 사용한다. 파사드가 global.usesqlite 를 읽는
유일한 지점이 되고, 어댑터는 실행과 결과/에러 정규화만 담당한다.

- SELECT 는 배열 그대로, 쓰기는 {affectedRows, insertId}
- 실패는 cb(true, err) 로 기존 계약 유지
- 에러 코드는 DUPLICATE_KEY/FK_VIOLATION/NOT_NULL 로 중립화
- SQLite 는 transaction/rowLock 능력을 false 로 선언 (현재 동작 보존)

아직 아무도 이 모듈을 쓰지 않는다. 동등성 스냅샷이 기준선과 일치함을
확인했다."
```

**주의:** `package-lock.json`은 `.gitignore`에 있다. 위 `git add`에서 무시되면 그대로 두고 `package.json`만 커밋한다.

---

## Task 5: `insert_acp` 전환 — 패턴 확립

가장 단순한 `MERGE` 후보 하나를 실제로 전환해 패턴을 굳힌다. 이후 대량 전환은 이 패턴을 반복한다.

**Files:**
- Modify: `mobius/sql_action.js` (`insert_acp` 함수만)
- Modify: `app.js` (파사드 `connect()` 배선 — 아래 Step 2a. 실서버 검증에서 드러난 Task 4 잔여 결함을 메운다)
- Modify: `mobius/db/sqlite.js` (`execute()` 의 핸들 선택 — 아래 Step 2b. 같은 이유)

**Interfaces:**
- Consumes: Task 4의 `db.k`, `db.run`
- Produces: `exports.insert_acp(connection, obj, callback)` — 시그니처 불변. 전환 패턴의 참조 구현.

**주의 (사후 반영, 2026-08-26):** 최초 버전의 이 태스크는 `sql_action.js` 한 파일만
건드리는 것으로 범위를 잡았다. 실제로 전환을 실서버(SQLite/MySQL)로 검증하는
과정에서 두 가지 통합 결함이 드러났고, 둘 다 이 태스크 범위로 끌어와 함께
고쳤다 — 아래 Step 2a/2b. 원인은 Task 4 를 "아무도 실서버에서 안 쓴다"는
전제로 설계해 놓고, 이 태스크(첫 실사용자)에 배선 단계를 넣지 않은 것이다.

- [ ] **Step 1: 전환 전 SQL 기준선을 확인한다**

```bash
grep -n "exports.insert_acp" mobius/sql_action.js
```

현재 구현을 읽어 둔다. 두 분기 모두 `insert into acp (ri, pv, pvs)`이고, 실패 시 `delete from lookup where ri = ...`로 보상한다. 차이는 이스케이프와 실행자뿐이다 (Task 1에서 `MERGE`로 판정된 항목이어야 한다).

- [ ] **Step 2: `sql_action.js` 상단에 파사드를 추가한다**

기존 require 블록:

```js
var db = require('./db_action');
var sqlite = require('./db_sqlite');
```

바로 아래에 추가한다 (기존 두 줄은 아직 지우지 않는다 — 전환 안 된 함수들이 쓴다):

```js
// 전환된 함수는 이 파사드를 쓴다. 전환이 끝나면 위 두 줄은 삭제한다.
var facade = require('./db');
```

- [ ] **Step 2a: `app.js` 에 파사드 `connect()` 를 배선한다 (필수 선행 조건)**

**Task 4 의 신파사드(`mobius/db/index.js`)는 `connect()` 를 부르기 전까지 `db.k()`
호출 시 무조건 예외를 던진다.** 그런데 실서버 기동 경로(`app.js`)는 구파사드
(`db_action.js`)의 `connect()` 만 부른다 — 신파사드는 `test/db-facade.test.js`
안에서만 연결됐다. 이 배선 없이 Step 3 을 실서버로 검증하면 `insert_acp` 가
처음 불리는 순간 워커가 **100% 크래시**한다 (클러스터가 자동으로 워커를
재기동하므로 서버 자체는 안 죽지만, `acp` 생성은 항상 실패한다).

`app.js` 상단, 기존 `var db = require('./mobius/db_action');` 아래에 추가한다:

```js
// 전환된 sql_action 함수들이 쓰는 새 DB 파사드.
// 전환이 끝나면(구 db_action/db_sqlite 삭제 시) 위 db 를 이것으로 대체한다.
var db_facade = require('./mobius/db');
```

서버 기동 경로는 세 갈래다(클러스터 마스터, 클러스터 워커, 비클러스터). 세 곳
모두 `db.connect(usedbhost, 3306, 'root', usedbpass, (rsc) => { if (rsc == '1') { ... } })`
형태인데, 그 `if (rsc == '1') {` 블록 **맨 앞**에 파사드도 같은 설정으로 연결한다:

```js
db.connect(usedbhost, 3306, 'root', usedbpass, (rsc) => {
    if (rsc == '1') {
        // 전환된 함수들이 쓰는 파사드도 같은 설정으로 연결한다.
        // 전환 기간 동안 구/신 두 경로가 공존한다.
        db_facade.connect(usedbhost, 3306, 'root', usedbpass, () => {});
        db.getConnection((code, connection) => {
            ...
```

파사드의 `connect()` 는 동기적으로 knex 인스턴스를 만들고 어댑터 연결만
시작하므로(`mobius/db/index.js` 의 `assertReady()` 는 knex 인스턴스 존재
여부만 본다), 콜백을 기다리지 않아도 이후 `db.k()` 호출은 즉시 안전하다.

**주의:** SQLite 모드에서는 워커당 `mobius.db` 핸들이 2개가 된다(구파사드 1개
+ 신파사드 1개). SQLite 는 다중 커넥션을 지원하고 양쪽에 `busyTimeout 50s` 가
걸려 있어 전환 기간 동안은 감당 가능하다. 전환이 끝나 구 모듈(`db_action.js`/
`db_sqlite.js`)을 지우면 다시 1개로 돌아간다(Plan 2 Step 8 참조).

- [ ] **Step 2b: SQLite 어댑터의 커넥션 핸들 선택을 고친다 (필수 선행 조건)**

`mobius/db/sqlite.js` 의 `execute(handle, sql, bindings, callback)` 최초 구현은
`var h = handle || db;` 였다. 문제는 `app.js` 가 `usesqlite` 값과 **무관하게**
항상 구파사드(`db_action.js`)의 MySQL 풀 커넥션을 `sql_action.js` 함수들에
넘긴다는 점이다(`db_action.js` 의 `connect()` 가 `usesqlite` 와 무관하게 매번
`mysql.createPool(...)` 을 만들고, `getConnection` 도 항상 그 풀에서 커넥션을
꺼낸다). 그 커넥션 객체는 truthy 이므로 `handle || db` 로는 SQLite 자신의
핸들로 폴백하지 않고 MySQL 커넥션이 선택돼 `h.all()`/`h.run()` 호출이 깨진다
(MySQL 커넥션엔 `.query()` 만 있다).

기존(전환 전) `db_sqlite.js` 의 `getResult` 는 이 사실을 이미 알고 있었다 —
`connection` 인자를 아예 무시하고 모듈 자신의 `db` 핸들만 썼다. 새 어댑터는
그 동작을 그대로 따라야 한다:

```js
exports.execute = function (handle, sql, bindings, callback) {
    // 이 어댑터는 넘어온 handle 을 쓰지 않고 모듈이 소유한 db 핸들만 쓴다.
    //
    // 이유: app.js 는 usesqlite 와 무관하게 항상 MySQL 풀 커넥션을 sql_action 에
    // 넘긴다. 그 핸들은 truthy 이므로 `handle || db` 로는 MySQL 커넥션이 선택되어
    // h.all()/h.run() 이 깨진다. 기존 db_sqlite.getResult 도 connection 인자를
    // 무시하고 모듈 핸들만 쓴다 — 여기서 그 동작을 그대로 따른다.
    // (SQLite 는 풀이 없고 워커당 핸들 하나를 공유한다.)
    var h = db;

    if (isRowReturning(sql)) {
        ...
```

`handle` 파라미터는 시그니처 계약(Task 3 SQL 탭이 이 시그니처를 감싼다) 때문에
남기되, 실제로는 쓰지 않는다. MySQL 어댑터(`mobius/db/mysql.js`)는 이 문제가
없다 — 구파사드와 신파사드 둘 다 같은 `mysql` 패키지의 풀 커넥션을 쓰므로
타입이 맞는다.

- [ ] **Step 3: `insert_acp` 를 전환한다**

기존 `exports.insert_acp = function (...) { ... };` 전체를 다음으로 교체한다:

```js
exports.insert_acp = function (connection, obj, callback) {
    console.time('insert_acp ' + obj.ri);
    _this.insert_lookup(connection, obj, function (err, results) {
        if (err) {
            callback(err, results);
            return;
        }

        facade.run(facade.k('acp').insert({
            ri: obj.ri,
            pv: JSON.stringify(obj.pv),
            pvs: JSON.stringify(obj.pvs)
        }), connection, function (err2, results2) {
            if (!err2) {
                console.timeEnd('insert_acp ' + obj.ri);
                callback(err2, results2);
                return;
            }

            // 본문 insert 가 실패하면 lookup 행이 고아로 남는다. 되돌린다.
            facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection, function () {
                callback(err2, results2);
            });
        });
    });
};
```

- [ ] **Step 4: 문법과 파사드 초기화 순서를 확인한다**

```bash
node --check mobius/sql_action.js
```

기대: 출력 없음 (통과)

```bash
node -e "
global.usesqlite='true';
var db=require('./mobius/db');
db.connect('localhost',3306,'root','x',function(rsc){
  var n=db.k('acp').insert({ri:'/M/a',pv:'{}',pvs:'{}'}).toSQL().toNative();
  console.log('SQL :', n.sql);
  console.log('bind:', JSON.stringify(n.bindings));
  process.exit(0);
});
"
```

기대: `insert into \`acp\` (\`pv\`, \`pvs\`, \`ri\`) values (?, ?, ?)`, bindings 3개

- [ ] **Step 5: 동등성 검증 — SQLite**

```bash
node mobius.js sqlite > /tmp/t5-sqlite.log 2>&1 &
sleep 12
node tools/equivalence/run-scenarios.js tools/equivalence/out/after-task5-sqlite.json
node tools/equivalence/compare.js \
    tools/equivalence/out/before-sqlite.json tools/equivalence/out/after-task5-sqlite.json
```

기대: `동일 — 28단계 모두 일치`

시나리오의 `acp-create` 단계가 `insert_acp`를 실제로 밟는다. 서버를 내린다.

- [ ] **Step 6: 동등성 검증 — MySQL**

MySQL 기준선이 아직 없다면 전환 **전** 코드로 먼저 뜬다.

```bash
git stash push -u -m "task5-wip-$(date +%s)"
git stash list --format='%H %gs' | head -1
```

기준선을 뜬다:

```bash
node mobius.js mysql > /tmp/t5-my-base.log 2>&1 &
sleep 12
node tools/equivalence/run-scenarios.js tools/equivalence/out/before-mysql.json
```

서버를 내리고 작업을 되살린다 (위에서 받은 SHA 사용):

```bash
git stash apply <SHA>
git stash list --format='%H %gs' | grep task5-wip
git stash drop stash@{0}
```

전환 후 MySQL 스냅샷:

```bash
node mobius.js mysql > /tmp/t5-my-after.log 2>&1 &
sleep 12
node tools/equivalence/run-scenarios.js tools/equivalence/out/after-task5-mysql.json
node tools/equivalence/compare.js \
    tools/equivalence/out/before-mysql.json tools/equivalence/out/after-task5-mysql.json
```

기대: `동일 — 28단계 모두 일치`. 서버를 내린다.

- [ ] **Step 7: 파사드 단위 테스트가 여전히 통과하는지 확인한다**

```bash
node --test test/db-facade.test.js
```

기대: 6개 PASS

- [ ] **Step 8: 커밋**

```bash
git add mobius/sql_action.js
git commit -m "refactor: insert_acp 를 DB 파사드로 전환

전환 패턴의 참조 구현이다. usesqlite 분기와 이스케이프가 사라지고
값은 바인딩으로 간다. 함수 시그니처와 보상 로직(본문 실패 시
lookup 행 삭제)은 그대로다.

SQLite/MySQL 양쪽에서 동등성 스냅샷 28단계 일치 확인."
```

- [ ] **Step 9: 전환 패턴을 문서로 남긴다**

`docs/superpowers/specs/2026-08-26-branch-classification.md` 끝에 추가한다:

```markdown
## 전환 패턴 (참조 구현: `insert_acp`)

**선행 조건 (한 번만, Task 5 에서 이미 완료됨):** 파사드(`mobius/db/index.js`)의
`connect()` 가 `app.js` 의 세 기동 경로 모두에 배선돼 있어야 하고, SQLite
어댑터(`mobius/db/sqlite.js`)의 `execute()` 는 넘어온 `handle` 을 무시하고
모듈 자신의 `db` 핸들만 써야 한다(`app.js` 가 usesqlite 값과 무관하게 항상
MySQL 풀 커넥션을 넘기기 때문). 둘 다 이미 되어 있다면 아래 패턴만 반복하면
된다 — 함수마다 다시 배선할 필요는 없다. **아직 안 돼 있는 상태에서 전환한
함수를 실서버로 검증하면, SQLite 모드에서는 100% 재현되는 크래시 또는 잘못된
핸들 호출로 막힌다.** (Task 5 최초 시도가 이 함정에 걸렸다 — 자세한 경위는
`.superpowers/sdd/2026-08-26-db-layer-abstraction-part1/task-5-report.md` 참조.)

MERGE 판정 함수는 이 순서로 바꾼다.

1. `if (global.usesqlite === 'true') { … } else { … }` 를 지우고 한 갈래로 만든다
2. `util.format` + `.replace()` 이스케이프를 `facade.k(table)` 빌더 호출로 바꾼다
3. `db.getResult(sql, connection, cb)` / `sqlite.getResult(sql, null, cb)` 를
   `facade.run(qb, connection, cb)` 로 바꾼다
4. 콜백 안의 **분기 구조는 가드 절로 정리해도 되지만, 조건과 보상 로직의 의미는
   그대로 둔다.** 중첩 콜백에서 `err`/`results` 가 바깥을 섀도잉하고 있으면
   `err2`/`results2` 로 풀어 쓴다 (참조 구현이 그렇게 했다).
5. `console.time` / `console.timeEnd` 라벨도 그대로 둔다
6. 행 잠금이 있으면 `if (facade.can('rowLock')) { qb = qb.forUpdate().noWait(); }` 로 감싼다
7. **에러 어휘가 바뀐다 — 같은 커밋에서 호출부를 함께 고친다.**

   파사드는 실패 시 `err.code` 를 중립 코드로 덮어쓴다:
   `DUPLICATE_KEY` / `FK_VIOLATION` / `NOT_NULL` / `LOCK_CONFLICT` / `LOCK_TIMEOUT` / `UNKNOWN`.
   원본 드라이버 코드는 `err.driverCode`, 제약 이름 힌트는 `err.constraint` 에 있다
   (`constraint` 는 **부분 문자열 비교용**이다 — 동등 비교하면 백엔드/버전에 따라 빗나간다).

   `mobius/resource.js` 에는 `results.code == 'ER_DUP_ENTRY'` 검사가 29곳 있다.
   전환한 함수의 에러가 그중 하나에 닿으면 조건이 빗나가 `409-5`/`409-6` 대신
   `500-4` 가 나간다.

   **따라서 함수를 전환할 때, 그 함수의 에러를 받는 `resource.js` 검사를 같은
   커밋에서 함께 고친다.** 전환을 다 끝낸 뒤 일괄로 미루면 그 사이 기간 내내
   응답 코드가 틀린다.

   예 — `insert_ae` 전환 시 `resource.js:359` 를 이렇게 바꿔야 한다:

       // 전환 전
       if (results.code == 'ER_DUP_ENTRY') {
           if (results.message.includes('aei_UNIQUE')) { callback('409-6'); }
           else { callback('409-5'); }
       }

       // 전환 후
       if (results.code == 'DUPLICATE_KEY') {
           // constraint 는 부분 문자열로 비교한다 (MySQL "aei_UNIQUE" / SQLite "aei")
           if (results.constraint && results.constraint.indexOf('aei') >= 0) { callback('409-6'); }
           else { callback('409-5'); }
       }

   주의: `insert_acp` 는 이 문제를 겪지 않았다. `insert_lookup`(미전환)이 `lookup.ri`
   PK 로 중복을 먼저 잡아 구경로 에러 코드를 돌려주기 때문이다. 즉 **참조 구현이
   안전했던 것은 우연이며, 다음 함수부터는 그렇지 않다.**

### 검증 — 실패 경로를 반드시 한 번은 밟는다

동등성 스냅샷은 성공 경로만 밟는다. 전환에서 손으로 다시 쓰는 부분은
대개 **실패 경로(보상 로직, 에러 분기)** 이므로, 그것만으로는 부족하다.
(`insert_acp` 자체가 그 사례다 — 보상 블록은 이번 태스크 어떤 시나리오
단계로도 실행된 적이 없다. 아래에서 실패 경로를 최소 1회 밟도록 요구하는
이유다.)

전환한 함수마다 실패 경로를 최소 1회 실제로 밟아야 한다. 방법 둘 중 하나:

- 시나리오에 실패 단계를 추가한다 (중복 생성 등)
- 일회성으로 실패를 주입해 보상 로직이 도는지 확인하고, 그 출력을 리포트에 남긴다

현재 `tools/equivalence/run-scenarios.js` 에서 에러 경로를 밟는 단계는
`ae-create-duplicate` **하나뿐이다.** 나머지 27단계는 전부 성공 경로다.

검증은 매번 SQLite + MySQL 양쪽으로 동등성 스냅샷을 비교한다(실서버 기동 →
`run-scenarios.js` → `compare.js`). 유닛테스트(`test/db-facade.test.js`)만으로는
부족하다 — 그 테스트들은 각자 `db.connect()` 를 직접 부르므로 위 선행 조건이
빠져 있어도 통과한다.

**알려진 흔들림:** `cin-latest` 단계는 알려진 흔들림이 있다 (`ct` 가 초 단위라
같은 초에 들어간 CIN 사이에서 "latest" 판정이 모호하다). **차이가 이 단계
하나뿐이면 재실행으로 확인한다.** 다른 단계가 함께 틀렸다면 진짜 회귀다.

**SQLite 의 `connection` 인자는 무시된다:** `facade.run(qb, connection, cb)` 를
SQLite 백엔드로 부를 때 `connection` 인자는 실제로 안 쓰인다 —
`mobius/db/sqlite.js` 의 `execute()` 는 넘어온 handle 을 버리고 모듈이 소유한
`db` 핸들만 쓴다(`app.js` 가 usesqlite 값과 무관하게 항상 MySQL 풀 커넥션을
넘기기 때문 — 위 "선행 조건" 참조). MySQL 백엔드에서는 `connection` 이 실제로
쓰인다.
```

```bash
git add docs/superpowers/specs/2026-08-26-branch-classification.md
git commit -m "docs: 전환 패턴 기록 (참조 구현 insert_acp)"
```

---

## 이 계획의 범위와 다음 계획

1차 계획은 여기까지다. 남은 함수 대량 전환은 **2차 계획**으로 쓴다.

**왜 지금 쓸 수 없는가** — 어떤 함수를 기계적으로 합칠 수 있고 어떤 것이 개별 처리가 필요한지는 Task 1의 산출물이 정해준다. 그 문서가 없는 상태에서 전환 태스크를 쓰면 "MERGE 로 판정된 것들을 변환한다" 같은 빈 지시가 된다.

**2차 계획이 다룰 것**

| 단계 | 내용 |
|---|---|
| 2 | `insert_*` 나머지 전환 — **각 함수의 에러를 받는 resource.js 검사를 같은 커밋에서 함께 중립 코드로 전환** |
| 3 | `select_*` 전환 |
| 4 | `update_*` / `delete_*` 전환 |
| 5 | `REVIEW` 판정 함수 개별 처리 (`insert_lookup`, `search_lookup`, `delete_oldest` 등) |
| 6 | 남은 `ER_DUP_ENTRY` 검사 정리 및 누락 확인 |
| 7 | `asn.js`·`mn.js`·`cnt_man.js` 직접 require 정리 |
| 8 | `db_action.js`·`db_sqlite.js` 삭제, 완료 판정 |

**순서 결함 수정 (사후 반영, 2026-08-26):** 최초 버전은 "에러 어휘 중립화 —
`resource.js` 29곳"을 별도 Step 6 으로 두어 전환 Step 2~4 **뒤에** 놓았다.
이러면 전환이 끝난 시점부터 Step 6 이 끝날 때까지 응답 코드가 계속 틀린
채로 배포된다(예: `insert_ae` 전환 직후 AE 중복 생성이 `409-6` 대신
`500-4` 를 낸다). 위 표가 이미 반영한 대로, 에러 어휘 전환은 **별도
단계가 아니라 각 전환 단계(Step 2~4)에 동반되는 작업**이다 — 전환 패턴
7번(위) 참조. Step 6 은 일괄 전환이 아니라 누락 확인용으로 남긴다.

Task 1이 끝나면 그 문서를 근거로 2차 계획을 작성한다.
