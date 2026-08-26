# `sql_action.js` usesqlite 분기 분류

- 기준 커밋: `24bbe03`
- 대상: `if (global.usesqlite === 'true')` 블록 33개
- 판정: `MERGE` = 파사드로 기계적 병합 가능 / `REVIEW` = 개별 처리 필요

`tools/audit_branches.js`의 자동 분류는 출발점이다. 아래 표의 판정은
각 분기를 직접 읽고 내린 것이며, 도구 분류와 다를 수 있다.

`행` 열은 `if (global.usesqlite === 'true')` 문이 위치한 소스 라인 번호다.

| 행 | 함수 | 도구 분류 | 판정 | 근거 |
|---:|---|---|---|---|
| 105 | `get_hit_all` | executor-only | MERGE | SQL은 if 앞에서 1회 생성, 두 분기 모두 동일 SQL. 실행자만 다름(`sqlite.getResult(sql, null, …)` vs `db.getResult(sql, connection, …)`). |
| 142 | `set_hit` | dialect | MERGE | INSERT 값은 동일, upsert 문법만 다름 (SQLite `ON CONFLICT(ct) DO UPDATE SET …` vs MySQL `ON DUPLICATE KEY UPDATE …`). knex `.onConflict().merge()` 로 흡수 가능. |
| 166 | `set_hit_n` | dialect | MERGE | `set_hit`과 완전히 동일한 패턴(같은 컬럼, 같은 upsert 문법 차이). |
| 212 | `insert_lookup` | real | REVIEW | (브리프 예시, 이미 확인됨) SQLite만 `select pv from acp where ri in (...)` 선행 쿼리 실행 후 `acpl` 컬럼 추가 삽입. 컬럼 16개 vs 15개. 파사드로 합치면 SQLite의 ACP 비정규화가 사라진다. 추가 확인: SQLite 분기는 `obj.acpi/lbl/at/aa/subl`에 `\|\| []` 폴백이 있으나 MySQL 분기는 폴백이 없어, 해당 필드가 `undefined`일 때도 두 백엔드의 동작이 다르다. |
| 275 | `insert_cb` | fake | MERGE | 컬럼/값 8개로 동일. 이스케이프 방식만 다름(`.replace(/'/g,"''")` vs `\"`/`\\'` 이스케이프 체인). |
| 324 | `insert_acp` | fake | MERGE | `insert_cb`와 동일 패턴. 컬럼 3개 동일, 이스케이프 방식만 다름. |
| 371 | `insert_ae` | real | MERGE | 컬럼 10개로 동일. 유일한 SQL 차이는 예약어 `or` 인용 방식(`"or"` vs `ae.or`)과 이스케이프, `values`/`value` 키워드(MySQL 동의어, 기능 동일). `update_ae`(브리프 예시)와 완전히 같은 패턴 — 도구가 real로 오분류. |
| 419 | `insert_cnt` | real | MERGE | 컬럼 10개로 동일. `or` 인용 방식만 다름(`"or"` vs `cnt.or`) + 이스케이프. `insert_ae`/`update_ae`와 동일 패턴. |
| 521 | `get_cni_count` | unparsed | REVIEW | 도구가 SQL을 못 찾은 이유: 이 분기는 SQL을 직접 만들지 않고 `select_count_ri` 호출 + `checkAndPurge` 위임만 한다. 두 분기의 실질 차이는 에러 체크 유무: SQLite 경로는 `if (!err && results.length == 1)`으로 err를 먼저 확인하지만, MySQL 경로는 `if (results.length == 1)`만 확인해 err가 있을 때 `results`가 undefined면 `TypeError`가 날 수 있다. SQL 차이가 아니라 방어 로직 차이이므로, 병합 시 SQLite의 안전한 에러 체크로 통일해야 한다. |
| 565 | `insert_cin` | real | MERGE | 컬럼 7개로 동일. `or` 인용 방식만 다름(`"or"` vs `cin.or`) + 이스케이프. |
| 1106 | `insert_sub` | real | MERGE | 컬럼 17개 완전히 동일, 예약어도 없음. 유일한 차이는 이스케이프 방식과 `values`/`value` 키워드. 도구가 real로 분류했으나 실제로는 `insert_cb`/`insert_acp`와 같은 "이스케이프만 다름" 패턴 — 도구 오분류. |
| 1255 | `select_resource_from_url` | executor-only | MERGE | SQL 2건(1차 lookup 조회, 2차 타입별 조회) 모두 if 앞/콜백 안에서 두 분기 동일하게 생성, 실행자만 다름. SQLite 경로에만 `spec_Obj.length > 0` 방어 분기가 있으나, 사용 중인 `merge()`(node_modules/merge/merge.js)는 두 번째 인자가 `undefined`면 그 인자를 무시하고 첫 인자를 그대로 반환하므로 MySQL 경로(`merge(comm_Obj[0], spec_Obj[0])`, spec_Obj가 비어 있어도 무조건 호출)와 결과가 동일함을 라이브러리 소스로 확인했다. 실질적으로 실행자 전용 분기. |
| 1341 | `select_ae` | executor-only | MERGE | SQL이 if 앞에서 생성, 두 분기 동일. 실행자만 다름. |
| 1649 | `search_parents_lookup` | sqlite-only | REVIEW | else 없음. SQLite는 무조건 `search_parents_lookup_all`(레벨 제한 없는 단일 재귀 CTE)로 위임하고 반환한다. MySQL(비-SQLite)은 `search_parents_lookup_action`으로 레벨 단위 반복 탐색을 수행하는 완전히 다른 알고리즘이다(주석: "무제한 CTE는 초대형 lookup에서 분 단위 회귀가 있었다"). 병합 시 SQLite가 쓰는 무제한 재귀 CTE 알고리즘과 MySQL이 쓰는 레벨 단위 페이지네이션 알고리즘 중 하나를 골라야 하며, 성능 특성이 다르므로 조사 없이 통일하면 안 된다. |
| 1722 | `select_spec_ri` | executor-only | MERGE | SQL이 if 앞에서 생성, 두 분기 완전히 동일(재귀 호출 로직 포함). 실행자만 다름. |
| 2053 | `search_lookup` | sqlite-only | REVIEW | else 없음. SQLite는 `search_lookup_sqlite`(단일 재귀 CTE + `build_search_query` 필터 빌더)로 위임. MySQL(비-SQLite)은 32개씩 배치 처리하는 `search_resource_action` 기반 반복 탐색(`loop_cnt`, `cur_d` 등 별도 상태)을 쓴다. 필터 구성 방식과 순회 알고리즘 자체가 다른 구현이라 병합 불가 — SQLite 쪽 재귀 CTE 필터 시맨틱(`build_search_query`)과 MySQL 쪽 배치 페이지네이션 시맨틱을 둘 다 보존해야 한다. |
| 2124 | `select_latest_resource` | executor-only | REVIEW | 도구 오분류: SQL이 if 앞이 아니라 **각 분기 안에서 따로** 생성된다. SQLite는 `order by ct desc limit 1`로 최신 1건을 즉시 선택. MySQL은 `order by ri desc limit 10`으로 최근 `5^loop_count`분 윈도우 내 후보를 가져온 뒤 그중 최대 `ri`를 고르고, 결과가 없으면 `loop_count`를 늘려 최대 10회(`loop_count > 9`) 재귀 재시도한다. 정렬 기준(`ct` vs `ri`)과 재시도/윈도잉 로직 자체가 다른 알고리즘이라 knex 빌더 하나로 흡수 불가. |
| 2180 | `select_oldest_resource` | executor-only | REVIEW | 도구 오분류: SQL이 각 분기 안에서 따로 생성된다. SQLite는 `order by ct asc limit 1`로 명시적으로 가장 오래된 행을 선택. MySQL은 `ORDER BY` 없이 `limit 1`만 사용해 어떤 행이 반환될지 SQL 표준상 보장되지 않는다(스토리지 엔진의 물리적 순서에 의존). 정렬 기준 유무 차이이며, 병합 시 어느 backend의 결과 시맨틱을 표준으로 삼을지 결정이 필요하다. |
| 2219 | `select_lookup` | executor-only | MERGE | SQL이 if 앞에서 생성, 두 분기 동일. 실행자만 다름. |
| 2237 | `select_ri_lookup` | executor-only | MERGE | SQL이 if 앞에서 생성, 두 분기 동일. 실행자만 다름(모듈 전역 `sqlite` 인스턴스를 `connection=null`로 호출). |
| 2269 | `select_acp` | executor-only | MERGE | SQL이 if 앞에서 생성, 두 분기 동일. 실행자만 다름. |
| 2296 | `select_acp_cnt` | executor-only | REVIEW | 도구 오분류: SQL 자체는 if 앞에서 생성되어 동일하지만, 결과 후처리가 다르다. SQLite 분기는 `results[0].acpi = JSON.parse(...)`를 `try/catch`로 감싸 파싱 실패 시 빈 배열로 폴백한다. MySQL 분기는 `try/catch` 없이 그대로 파싱해, 손상된 JSON 값이 들어오면 예외가 그대로 콜백 체인 밖으로 전파될 수 있다. SQL 문자열 비교만으로는 안 보이는 차이라 도구가 놓쳤다. 병합 시 이 방어 로직(try/catch 폴백)을 유지할지 결정해야 한다. |
| 2373 | `select_acp_in` | executor-only | MERGE | SQL이 if 앞에서 생성, 두 분기 동일. 실행자만 다름. |
| 2441 | `select_st`(도구 오기재) → 실제 `delete_oldest` | real | REVIEW | **함수명 정정**: 도구가 L2430의 `exports.select_st`(분기 없는 3줄짜리 함수)로 잘못 표시했다. 실제로 L2441의 분기는 L2438에서 시작하는 비-export 헬퍼 `delete_oldest` 내부에 있다. 차이도 매우 큼: SQLite 경로는 `pre_update_executor`로 자식 카운트를 재계산한 뒤 트랜잭션 없이 단순 `DELETE`만 실행한다. MySQL 경로는 `connection.beginTransaction` + `SELECT ... FOR UPDATE NOWAIT` 행 잠금 + 실측 재카운트(`COUNT(*)`, `SUM(cs)`) + `purge_plan` 기반 정밀 삭제 범위 계산 + `commit`/`rollback` 전체 흐름을 갖는다(2026-08-25 클러스터 레이스 컨디션 수정, 커밋 09477df 관련). 트랜잭션·락·재카운트 안전장치가 SQLite 경로에 전혀 없으므로 파사드로 기계적으로 못 합친다. **보존해야 할 것**: MySQL 경로의 트랜잭션 + `FOR UPDATE NOWAIT` 락 기반 동시성 안전 로직 전체(락 획득 실패 시 스킵, 재카운트 후 조건부 커밋/롤백). |
| 2664 | `select_count_ri` | executor-only | MERGE | SQL이 if 앞에서 생성, 두 분기 동일. 실행자만 다름. |
| 2698 | `update_lookup` | fake | MERGE | 8개 컬럼 UPDATE, 컬럼 목록과 구조는 동일. 이스케이프 방식만 다름 — 단, MySQL 분기는 `lbl` 컬럼만 이스케이프하고 `acpi`/`at`/`aa`/`subl`은 이스케이프를 아예 안 한다(SQLite 분기는 5개 전부 이스케이프). "이스케이프 방식 차이"보다는 "이스케이프 누락"에 가깝지만, knex 파라미터 바인딩으로 전환하면 양쪽 다 자동으로 안전하게 처리되어 결과적으로 흡수된다. 전환 시 이 수동 이스케이프 코드를 그대로 옮기지 않도록 주의(현재 MySQL 경로의 이스케이프 누락은 잠재적 SQL 인젝션 소지). |
| 2744 | `update_ae` | real | MERGE | (브리프 예시, 이미 확인됨) 도구 오탐. 차이는 예약어 `or` 인용뿐(`ae.or` vs `"or"`). knex가 `db.k('ae').update({or: ...})`로 흡수. |
| 2783 | `update_cnt` | real | MERGE | `update_ae`와 완전히 동일한 패턴. `or` 인용 방식만 다름(`cnt.or` vs `"or"`). |
| 2819 | `update_grp` | executor-only | MERGE | SQL(`sql2`)이 if 앞에서 생성, 두 분기 동일. 실행자만 다름. |
| 2853 | `update_lcp` | executor-only | MERGE | SQL(`sql2`)이 if 앞에서 생성, 두 분기 동일. 실행자만 다름. |
| 3371 | `update_cnt_cni` | real | REVIEW | SQLite 경로는 `cin` 테이블에서 `count(*)`/`sum(cs)`로 **실측 재계산**한 값을 `cnt`에 쓰고, `lookup.st`는 `obj.st`로 별도 UPDATE(순차 쿼리 3개, 트랜잭션 없음). MySQL 경로는 재계산 없이 **호출자가 넘긴 `obj.cni`/`obj.cbs`를 그대로** JOIN UPDATE(`update cnt, lookup set ...`)로 반영한다. 값의 출처(DB 재계산 vs 호출자 전달값)가 근본적으로 다르므로, 병합 시 하나를 고르면 다른 백엔드의 정합성 보장 로직이 사라진다. 보존 대상: SQLite의 `cin` 재계산 로직과 MySQL의 단일 JOIN UPDATE 원자성 둘 다. |
| 3493 | `delete_ri_lookup` | executor-only | MERGE | SQL이 if 앞에서 생성, 두 분기 동일. 실행자만 다름. SQLite 쪽에 디버그 `console.log` 2줄이 더 있으나 로직에 영향 없음. |
| 3525 | `delete_ri_lookup_in`(도구 오기재) → 실제 `delete_lookup_action` | executor-only | MERGE | **함수명 정정**: 도구가 L3510의 `exports.delete_ri_lookup_in`(분기 없는 함수)으로 잘못 표시했다. 실제로 L3525의 분기는 L3518에서 시작하는 비-export 재귀 헬퍼 `delete_lookup_action` 내부에 있다. SQL은 if 앞에서 생성되어 두 분기 동일, 실행자만 다름. 삭제 건수 로그에 쓰는 필드명만 다름(`deleted_Obj.changes \|\| deleted_Obj.affectedRows` vs `deleted_Obj.affectedRows`) — sqlite3/mysql 드라이버가 반환하는 필드명 차이일 뿐 로직에 영향 없음. |

## 요약

| 판정 | 개수 |
|---|---:|
| MERGE | 24 |
| REVIEW | 9 |

도구 분류(6버킷) 대비 재분류 결과:

| 도구 분류 | 도구 개수 | 재검토 후 판정 |
|---|---:|---|
| executor-only | 16 | MERGE 13 / REVIEW 3 (`select_latest_resource`, `select_oldest_resource`, `select_acp_cnt` — SQL이 분기 안에서 따로 만들어지거나 후처리 로직이 다름을 도구가 못 봄) |
| fake | 3 | MERGE 3 (변경 없음) |
| dialect | 2 | MERGE 2 (변경 없음) |
| real | 9 | MERGE 6 (`insert_ae`, `insert_cnt`, `insert_cin`, `insert_sub`, `update_ae`, `update_cnt` — 전부 예약어 인용/이스케이프뿐인 오탐) / REVIEW 3 (`insert_lookup`, `delete_oldest`(도구 표시상 `select_st`), `update_cnt_cni`) |
| sqlite-only | 2 | REVIEW 2 (변경 없음) |
| unparsed | 1 | REVIEW 1 (변경 없음) |

## REVIEW 항목별 처리 방침

각 REVIEW 함수에 대해 "무엇을 보존해야 하는가"를 한 줄로 적는다.
전환 시 이 문장이 검증 기준이 된다.

- **`insert_lookup`(L212)**: SQLite 경로만의 `acp` 선행 조회 + `acpl` 컬럼(16번째) 삽입을 보존해야 한다. MySQL 경로는 `acpl` 컬럼 자체가 없다(15컬럼). 또한 SQLite 경로의 `obj.필드 || []` undefined 폴백을 MySQL 경로에도 부여할지 결정해야 한다.
- **`get_cni_count`(L521)**: `select_count_ri` 에러 발생 시 크래시하지 않도록 SQLite 경로의 `!err &&` 방어 체크를 두 백엔드 공통으로 적용해야 한다.
- **`search_parents_lookup`(L1649)**: SQLite가 쓰는 무제한 재귀 CTE(`search_parents_lookup_all`) 알고리즘과, MySQL이 쓰는 레벨 단위 반복(`search_parents_lookup_action`) 알고리즘 중 어느 것을 두 백엔드 공통으로 쓸지 성능 검증 후 결정해야 한다(주석에 무제한 CTE의 대형 lookup 성능 회귀 이력이 명시돼 있음).
- **`search_lookup`(L2053)**: SQLite의 재귀 CTE 기반 discovery(`search_lookup_sqlite`, `build_search_query` 필터)와 MySQL의 배치 페이지네이션 기반 discovery(`search_resource_action`, 32건 단위) 중 하나로 통일하거나 두 경로를 유지할지 결정해야 한다. 필터 정규화(`sanitize_discovery_query`)는 공통이므로 유지.
- **`select_latest_resource`(L2124)**: SQLite의 `ct desc limit 1`(단순 최신값)과 MySQL의 시간 윈도우 기반 `ri desc limit 10` + 최대 9회 재시도 로직 중 어느 시맨틱을 표준으로 할지 결정해야 한다. 정렬 기준이 다르므로 실제 반환되는 "최신" 리소스가 달라질 수 있다.
- **`select_oldest_resource`(L2180)**: SQLite의 `ORDER BY ct ASC`(결정적 최오래된 행) 시맨틱을 MySQL 경로에도 적용할지, 아니면 MySQL의 무정렬 `LIMIT 1`(비결정적) 현재 동작을 그대로 둘지 결정해야 한다.
- **`select_acp_cnt`(L2296)**: SQLite 경로의 `JSON.parse` `try/catch` 폴백(파싱 실패 시 빈 배열)을 MySQL 경로에도 적용해 손상된 `acpi` 값에서 예외가 전파되지 않도록 해야 한다.
- **`delete_oldest`(L2441, 도구는 `select_st`로 오기재)**: MySQL 경로의 트랜잭션(`beginTransaction`/`commit`/`rollback`) + `FOR UPDATE NOWAIT` 행 잠금 + 실측 재카운트 기반 동시성 안전 로직(2026-08-25 레이스 컨디션 수정)을 보존해야 한다. SQLite 경로는 이 안전장치가 없는 단순 delete이며, 두 경로를 그대로 합치면 MySQL의 락 기반 레이스 방지가 사라진다.
- **`update_cnt_cni`(L3371)**: SQLite의 `cin` 테이블 실측 재계산 값 사용과, MySQL의 호출자 전달값(`obj.cni`/`obj.cbs`) 직접 사용 중 어느 쪽을 정합성 기준으로 삼을지 결정해야 한다. 값의 출처가 다르면 클러스터 환경에서 두 백엔드의 카운트 정확도가 달라진다.

## 기타 참고 (33개 범위 밖)

`grep -n "global.usesqlite"`로 확인한 전체 36건 중 아래 3건은 `if (global.usesqlite === 'true') {` 블록 형태가 아니라서 도구의 33개 집계에서 제외되어 있다. 이번 Task 범위 밖이지만, 이후 전환 작업자가 알아야 해서 남긴다.

- **L1699** (`search_parents_lookup_all` 내부): `var exec = (global.usesqlite === 'true') ? require('./db_sqlite').getResult : db.getResult;` 삼항 연산자. SQL은 위에서 공통 생성, 순수 실행자 선택뿐이라 있었다면 MERGE.
- **L3608** (`delete_orphan_lookup` 내부): 위와 동일한 삼항 실행자 선택 패턴. MERGE.
- **L3420** (`update_parent_by_insert` 내부): `if (global.usesqlite === 'true' && obj.ty == '3') {` — `usesqlite`와 `obj.ty=='3'` 복합 조건이라 도구의 정확한 패턴 매칭에서 빠졌다. SQLite+ty=='3' 조합일 때만 `update_cnt_cni`(REVIEW 대상, L3371)로 위임하고, 그 외 모든 경우(MySQL 전체, 또는 SQLite의 ty!=3)는 공통 `update %s, lookup set ...cni=cni+1...` 문을 쓴다. `update_cnt_cni` 자체가 REVIEW이므로 이 위임 분기도 같은 보존 요구사항을 물려받는다.

## 분기 없이 MySQL 로만 나가는 export (68개)

Task 1 은 `if (global.usesqlite === 'true')` 블록 33개만 분류했다. 그러나
`sql_action.js` 의 export 108개 중 68개는 **분기 자체가 없이** `db.getResult` 를
호출한다 — SQLite 모드에서도 MySQL 로 나간다.

이들의 전환은 "동작 보존"이 아니라 **동작 변경**이다. Plan 2 는 이 사실을 알고
착수해야 한다.

추출 명령 (기준 커밋 이 리포트 작성 시점 HEAD):

```bash
node -e "
const fs=require('fs');
const src=fs.readFileSync('mobius/sql_action.js','utf8');
const lines=src.split('\n');
const fns=[];
lines.forEach((l,i)=>{ const m=l.match(/^exports\.([A-Za-z0-9_]+)\s*=/); if(m) fns.push({name:m[1],line:i}); });
fns.forEach((f,idx)=>{
  const end = idx+1<fns.length ? fns[idx+1].line : lines.length;
  const body = lines.slice(f.line,end).join('\n');
  const hasBranch = /global\.usesqlite/.test(body);
  const usesMysql = /\bdb\.getResult\s*\(/.test(body);
  const usesSqlite = /sqlite\.getResult\s*\(/.test(body);
  if(!hasBranch && usesMysql && !usesSqlite) console.log((f.line+1)+'\t'+f.name);
});
" > .superpowers/sdd/2026-08-26-db-layer-abstraction-part1/no-branch.txt
```

68줄이 나온다.

**주의 — 이 스크립트는 함수 경계를 텍스트로만 자른다.** 다음 `exports.` 줄까지를
"본문"으로 보기 때문에, export 사이에 낀 비-export 헬퍼 함수(예: `delete_oldest`,
`update_parent_by_insert`)의 분기·`sqlite.getResult` 호출이 **앞선 export 의
본문으로 잘못 합산**될 수 있다. 예: `select_st`(L2413)는 분기가 전혀 없는
3줄짜리 함수인데도, 다음 export(`select_in_ri_list`, L2600)까지의 구간에
`delete_oldest`(분기 있음, SQLite 실행자 사용)가 끼어 있어 68개 목록에서
누락됐다. 또한 정규식은 `/* ... */` 주석을 인식하지 못한다 — 아래 표의
`search_lookup_parents` 항목 참조. 따라서 68개는 **하한이 아니라 근사치**이며,
아래 표의 판정은 스크립트 출력이 아니라 각 함수 본문을 직접 읽고 내렸다.

판정 기준: **"SQLite 모드에서 이 함수가 실제로 호출되는가? 호출된다면 MySQL 로
나가는 것이 관측 가능한 오동작인가?"** 이를 위해 각 함수의 SQL 이 어느 테이블을
건드리는지, 그리고 저장소 전체에서 실제 호출부가 있는지(`grep`)를 확인했다.

- **`SQLITE-DEAD`** — SQLite 가 지원하는 리소스 타입(acp/ae/cnt/cin/cb/sub, 또는
  타입 무관 `lookup` 조작이 그 타입들에도 적용됨)을 다루며 **실제로 라이브
  호출부가 있다.** SQLite 모드에서 실제로 깨져 있다. 전환은 동작 변경이자
  **버그 수정**이다.
- **`MYSQL-ONLY`** — SQLite 미지원 타입(grp/fcnt/nod/csr/req/smd/mms/tm/tr/mgo 등,
  `SQLITE_SUPPORTED_TY = ['1','2','3','4','5','23']` 밖)만 다룬다.
  `resource.js` 의 `check_db_support()` 가 생성 자체를 막으므로(`501-2`) 그
  타입의 행이 SQLite DB 에 존재할 수 없고, 따라서 이 함수도 SQLite 모드에서
  도달 불가하다. 전환해도 관측 동작이 안 바뀐다. 일부는 호출부 자체가
  저장소 전체에 없는 완전한 사문(死文)이기도 하다 — 근거 열에 표기했다.
- **`SHARED`** — 백엔드 무관한 공용 테이블(`lookup`, `hit`)만 다루거나 리소스
  타입과 무관하다. 판단 근거를 적어라.

**중요 — 브리프가 예시로 든 함수 중 4개는 실제로 호출부가 없는 사문(死文)이다.**
`select_sub`, `select_cni_parent`, `update_st` 는 `sql_action.js` 밖에서
호출하는 곳이 저장소 전체에 **하나도 없다**(`update_st` 는 `resource.js:402`
의 주석 처리된 줄이 유일한 흔적). `search_lookup_parents` 는 함수 전체가
`/* ... */` 주석 블록(L1507-1583) 안에 있어 애초에 `exports` 에 정의되지도
않는다. 넷 다 아래 표에서 `판정 보류` 로 남기고 근거에 이유를 적었다 —
"핫패스"라는 브리프의 표현과 실측이 다르므로 추측 대신 그대로 보고한다.
나머지 10개(update_acp, select_cb, update_cb_poa_csi, update_sub,
update_parent_by_delete, update_parent_st, delete_lookup_et, select_sum_cbs,
select_sum_ae, get_ri_sri)는 라이브 호출부를 확인했고 `SQLITE-DEAD` 로 판정했다.

| 행 | 함수 | 판정 | 근거 |
|---:|---|---|---|
| 67 | `set_tuning` | SHARED | `set global max_connections/innodb_flush_log_at_trx_commit/sync_binlog/transaction_isolation` — MySQL 세션 튜닝 전용, 리소스 타입/데이터와 무관. `app.js` 의 두 마스터 부팅 경로에서 usesqlite 무관하게 호출되지만, `db_action.js` 는 usesqlite 와 무관하게 항상 `mysql_pool` 을 생성한다(이 브랜치와 무관한 기존 아키텍처) — 대상 커넥션이 SQLite 모드에서도 실존하므로 MySQL 로 나가는 것이 맞는 동작이다. SQLite 에는 대응 개념 자체가 없다. |
| 196 | `get_ri_sri` | SQLITE-DEAD | `select ri from lookup where sri = ?` — 타입 무관 `lookup` 조회. `app.js`(`get_ri_list_sri`), `fopt.js`, `grp.js`, `sgn.js`, `sub.js` 에서 라이브 호출되며 AE/CNT/CIN 등 SQLite 지원 타입의 sri 경로 해석에도 쓰인다. SQLite 모드에서 sri 기반 주소 해석이 깨진다(SQLite 쪽 lookup 에는 있어도 MySQL 쪽엔 없어 결과 0건). |
| 591 | `insert_grp` | MYSQL-ONLY | grp, ty=9. `SQLITE_SUPPORTED_TY` 밖 — `check_db_support` 가 생성을 막는다(`resource.js:434`). |
| 617 | `insert_lcp` | MYSQL-ONLY | lcp(locationPolicy), ty=10. 미지원 타입. |
| 643 | `insert_fcnt` | MYSQL-ONLY | flexContainer, ty=28/9x 계열. 미지원 타입. |
| 669 | `insert_hd_dooLK` | MYSQL-ONLY | mgmtObj 홈디바이스 특수화(도어락), ty=28/9x 계열. 미지원 타입. |
| 695 | `insert_hd_bat` | MYSQL-ONLY | 홈디바이스 배터리 모듈. 미지원 타입. |
| 721 | `insert_hd_tempe` | MYSQL-ONLY | 홈디바이스 온도 모듈. 미지원 타입. |
| 747 | `insert_hd_binSh` | MYSQL-ONLY | 홈디바이스 바이너리 스위치 모듈. 미지원 타입. |
| 773 | `insert_hd_fauDn` | MYSQL-ONLY | 홈디바이스 결함감지 모듈. 미지원 타입. |
| 799 | `insert_hd_colSn` | MYSQL-ONLY | 홈디바이스 색채도 모듈. 미지원 타입. |
| 825 | `insert_hd_brigs` | MYSQL-ONLY | 홈디바이스 밝기 모듈. 미지원 타입. |
| 851 | `insert_hd_color` | MYSQL-ONLY | 홈디바이스 색상 모듈. 미지원 타입. |
| 877 | `insert_fwr` | MYSQL-ONLY | mgmtObj, ty=13/mgd=1001(firmware). 미지원 타입. |
| 903 | `insert_bat` | MYSQL-ONLY | mgmtObj, ty=13/mgd=1006(battery). 미지원 타입. |
| 929 | `insert_dvi` | MYSQL-ONLY | mgmtObj, ty=13/mgd=1007(deviceInfo). 미지원 타입. |
| 955 | `insert_dvc` | MYSQL-ONLY | mgmtObj, ty=13/mgd=1008(deviceCapability). 미지원 타입. |
| 981 | `insert_rbo` | MYSQL-ONLY | mgmtObj, ty=13/mgd=1009(reboot). 미지원 타입. |
| 1007 | `insert_nod` | MYSQL-ONLY | node, ty=14. 미지원 타입. |
| 1033 | `insert_csr` | MYSQL-ONLY | remoteCSE, ty=16. 미지원 타입. |
| 1059 | `insert_req` | MYSQL-ONLY | request, ty=17. 미지원 타입. |
| 1131 | `insert_smd` | MYSQL-ONLY | semanticDescriptor, ty=24. 미지원 타입. |
| 1157 | `insert_mms` | MYSQL-ONLY | mms, ty=27. 미지원 타입. |
| 1183 | `insert_tr` | MYSQL-ONLY | transaction, ty=39. 미지원 타입. |
| 1209 | `insert_tm` | MYSQL-ONLY | transactionMgmt, ty=38. 미지원 타입. |
| 1305 | `select_csr_like` | MYSQL-ONLY | csr, ty=16. `app.js:342` 에서 라이브 호출되나 csr 자체가 SQLite 에 존재 불가. |
| 1315 | `select_csr` | MYSQL-ONLY | csr, ty=16. `app.js:2777` 에서 라이브 호출되나 동일 이유로 불가. |
| 1508 | `search_lookup_parents` | 판정 보류 — 사문(死文) | 함수 전체가 `/* ... */` 주석 블록(L1507-1583) 안에 있다. `exports.search_lookup_parents` 는 런타임에 정의되지 않는다(주석이므로). 저장소 전체에 외부 호출부가 없다(자기 재귀 호출도 주석 안). 기계적 스크립트가 주석을 인식 못 해 오탐했다. 실제 활성 함수는 이름이 비슷한 `search_parents_lookup`(L1649, Task1 문서에서 REVIEW 로 이미 분류됨) — 혼동 주의. |
| 2234 | `select_grp_lookup` | MYSQL-ONLY | grp, ty=9. `app.js:736` 에서 라이브 호출되나 grp 자체가 SQLite 에 존재 불가. |
| 2243 | `select_grp` | MYSQL-ONLY | grp, ty=9, 미지원 타입. 추가로 저장소 전체에서 호출부가 전혀 없는 사문이기도 하다(`select_grp_lookup` 과 이름이 비슷한 별개 함수이니 혼동 주의). |
| 2369 | `select_sub` | 판정 보류 — 사문(死文) | sub 테이블(ty=23, SQLite 지원)이라 브리프가 "핫패스"로 지목했으나, 저장소 전체에서 `select_sub(` 호출부가 전혀 없다(정의만 존재). SUB 조회는 범용 함수(`select_resource_from_url`, Task1 문서 MERGE) 경로로 이뤄지는 것으로 보인다. 호출부가 없으므로 SQLite 모드에서 관측 가능한 오동작이 없다 — 다만 브리프의 지목과 실측이 다르므로 추측하지 않고 보류로 남긴다. |
| 2378 | `select_tr` | MYSQL-ONLY | tr, ty=39. `mobius/tr.js:388` 에서 라이브 호출되나 tr 자체가 SQLite 에 존재 불가. |
| 2398 | `select_cb` | SQLITE-DEAD | cb 테이블(ty=5, SQLite 지원). `mobius/asn.js:222`, `mobius/mn.js:221` 에서 라이브 호출(등록 CSE 에 등록하는 MN/ASN CSE 타입 기동 시). SQLite 모드에서 CB 조회가 MySQL 의 데이터를 반환한다. |
| 2405 | `select_cni_parent` | 판정 보류 — 사문(死文) | `cnt, lookup` 조인(ty=3, SQLite 지원)이라 브리프가 지목했으나, 저장소 전체에서 호출부가 전혀 없다(정의만 존재). |
| 2600 | `select_in_ri_list` | MYSQL-ONLY(사실상 사문) | 유일한 외부 호출부(`resource.js:1317`, `search_action` 내부)가 `search_resource`/`get_resource` 를 통해서만 도달 가능한데, 이 두 함수 자체가 저장소 전체에서 호출부가 없다(정의만 존재, dead code 체인). 실제 discovery 는 `search_lookup`(L2053, 분기 있음, Task1 REVIEW)이 담당한다. 전환해도 관측 가능한 차이 없음. |
| 2660 | `update_cb_poa_csi` | SQLITE-DEAD | cb 테이블(ty=5). `mobius/cb.js:73` 에서 **서버 기동마다**(csetype 무관, CB 가 이미 존재하면 매번) 호출된다. 재기동 시 poa/csi/srt 갱신이 MySQL 의 cb 행에만 적용되고 SQLite 의 cb 행은 갱신되지 않는다. |
| 2669 | `update_st` | 판정 보류 — 사문(死文) | `lookup.st` 갱신, 타입 무관이라 브리프가 지목했으나 저장소 전체에서 유일한 참조가 `resource.js:402` 의 **주석 처리된** 줄뿐이다(실제 호출 없음). |
| 2699 | `update_acp` | SQLITE-DEAD (Critical) | 이미 확인된 버그(FIX 1 문서 참조). `update_lookup` 은 분기해 SQLite 에 쓰지만, 이어지는 `acp.pv`/`pvs` UPDATE(`sql2`)는 항상 MySQL 로 나간다. `select_acp`(L2269, MERGE)는 SQLite 에서 읽으므로 ACP 정책 갱신이 조용히 유실된다. |
| 2877 | `update_hd_dooLk` | MYSQL-ONLY | 홈디바이스 도어락 모듈. `insert_hd_dooLK` 와 동일 이유로 미지원. |
| 2898 | `update_hd_bat` | MYSQL-ONLY | 홈디바이스 배터리 모듈. 미지원 타입. |
| 2919 | `update_hd_tempe` | MYSQL-ONLY | 홈디바이스 온도 모듈. 미지원 타입. |
| 2940 | `update_hd_binSh` | MYSQL-ONLY | 홈디바이스 바이너리 스위치 모듈. 미지원 타입. |
| 2961 | `update_hd_fauDn` | MYSQL-ONLY | 홈디바이스 결함감지 모듈. 미지원 타입. |
| 2982 | `update_hd_colSn` | MYSQL-ONLY | 홈디바이스 색채도 모듈. 미지원 타입. |
| 3003 | `update_hd_brigs` | MYSQL-ONLY | 홈디바이스 밝기 모듈. 미지원 타입. |
| 3024 | `update_hd_color` | MYSQL-ONLY | 홈디바이스 색상 모듈. 미지원 타입. |
| 3045 | `update_fwr` | MYSQL-ONLY | mgmtObj mgd=1001. 미지원 타입. |
| 3067 | `update_bat` | MYSQL-ONLY | mgmtObj mgd=1006. 미지원 타입. |
| 3088 | `update_dvi` | MYSQL-ONLY | mgmtObj mgd=1007. 미지원 타입. |
| 3110 | `update_dvc` | MYSQL-ONLY | mgmtObj mgd=1008. 미지원 타입. |
| 3132 | `update_rbo` | MYSQL-ONLY | mgmtObj mgd=1009. 미지원 타입. |
| 3154 | `update_nod` | MYSQL-ONLY | node, ty=14. 미지원 타입. |
| 3175 | `update_csr` | MYSQL-ONLY | remoteCSE, ty=16. 미지원 타입. |
| 3197 | `update_req` | MYSQL-ONLY | request, ty=17. 미지원 타입. |
| 3212 | `update_sub` | SQLITE-DEAD | sub 테이블(ty=23). `resource.js:1822` 에서 라이브 호출(구독 갱신, update_action 경로). `update_lookup` 은 분기하나 `sql2`(enc/exc/nu/... UPDATE)는 항상 MySQL. `update_acp` 와 동일한 패턴의 버그 — SQLite 모드에서 구독 갱신이 조용히 유실된다. |
| 3234 | `update_smd` | MYSQL-ONLY | semanticDescriptor, ty=24. 미지원 타입. |
| 3256 | `update_mms` | MYSQL-ONLY | mms, ty=27. 미지원 타입. |
| 3278 | `update_tm` | MYSQL-ONLY | transactionMgmt, ty=38. 미지원 타입. |
| 3301 | `update_tr` | MYSQL-ONLY | transaction, ty=39. 미지원 타입. |
| 3323 | `update_tr_trsp` | MYSQL-ONLY | transaction, ty=39. 미지원 타입. |
| 3337 | `update_tr_tst` | MYSQL-ONLY | transaction, ty=39. 미지원 타입. |
| 3425 | `update_parent_by_delete` | SQLITE-DEAD | 동적 `tableName = responder.typeRsrc[obj.ty]` 로 부모의 `cni`/`cbs` 감소 + `lookup.st` 증가. `resource.js:2348`, `resource.js:2490` 에서 자식 삭제 시 호출되며 부모가 cnt(ty3)/ae(ty2) 등 SQLite 지원 타입일 때도 실행된다. 부모 카운터가 SQLite 에서 갱신되지 않는다. **중복 정의 주의**: 이 이름의 export 가 소스에 **완전히 동일한 본문으로 L3457 에 다시 정의**되어 있다(아래 참조) — JS 재대입 규칙상 L3457 이 최종 유효본이고 이 L3425 정의는 죽은 코드다. 전환 시 중복 제거가 함께 필요하다. |
| 3441 | `update_parent_st` | SQLITE-DEAD | 동적 `tableName`, `lookup.st` 만 증가. `resource.js:378`(cnt 생성 시 useCert 분기), `resource.js:2494`(자식 삭제 후)에서 호출. 부모가 SQLite 지원 타입일 때 상태 태그 증가가 유실된다. |
| 3457 | `update_parent_by_delete` | SQLITE-DEAD | L3425 와 완전히 동일한 본문의 **중복 정의**(같은 함수명으로 두 번째 `exports.update_parent_by_delete = ...`). JS 는 재대입이므로 이 정의가 실제로 쓰이는 유효본이다. 판정/근거는 L3425 항목과 동일. |
| 3566 | `delete_lookup_et` | SQLITE-DEAD | `select ri from lookup where et < ? and ty<>'2' and ty<>'3' and ty<>'5'` — ae/cnt/cb 는 제외하지만 acp(1)/cin(4)/sub(23) 는 포함되며 셋 다 SQLite 지원 타입이다. `app.js` 의 `del_expired_resource()` 가 24시간마다 usesqlite 무관하게 호출한다. SQLite 모드에서 만료된 ACP/CIN/SUB 가 정리되지 않는다. |
| 3617 | `delete_req` | MYSQL-ONLY | req, ty=17. `app.js:88` 에서 매일 호출되나 req 자체가 SQLite 에 존재 불가. |
| 3627 | `select_sum_cbs` | SQLITE-DEAD | `select sum(cbs) from cnt`(ty=3, SQLite 지원). `app.js` 의 `/total_cbs` HTTP 엔드포인트에서 usesqlite 무관하게 라우팅된다. SQLite 모드에서 실제 컨테이너 총 바이트 수 대신 MySQL 의 값을 반환한다. |
| 3637 | `select_sum_ae` | SQLITE-DEAD | `select count(*) from ae`(ty=2, SQLite 지원). `/total_ae` 엔드포인트, 위와 동일한 문제. |

## 요약 (68개 no-branch export)

| 판정 | 개수 |
|---|---:|
| SQLITE-DEAD | 11 |
| MYSQL-ONLY | 52 |
| SHARED | 1 |
| 판정 보류(사문) | 4 |

### Plan 2 에 주는 함의

- `SQLITE-DEAD` 함수의 전환은 동등성 스냅샷에 **차이로 나타난다.** 그것이 정상이다 —
  깨져 있던 것이 고쳐지는 것이므로. 전환 전에 "무엇이 어떻게 바뀔지"를 먼저 적고
  차이를 대조하라. 차이가 없으면 오히려 의심하라.
- `MYSQL-ONLY` 함수는 SQLite 모드 동등성에 영향이 없어야 한다. 차이가 나면 판정이
  틀린 것이다.
- Global Constraint "기존 동작을 보존한다"는 `SQLITE-DEAD` 함수에는 적용되지 않는다.
  그 함수들의 기존 동작은 **버그**다.
- `update_parent_by_delete` 의 중복 정의(L3425/L3457)는 이 브랜치가 만든 문제가
  아니라 기존 코드의 결함이다. 전환 작업(Step 4) 중 자연스럽게 하나로 합쳐지므로
  별도 태스크로 뺄 필요는 없지만, 합칠 때 "두 정의가 완전히 동일했다"는 사실을
  커밋 메시지에 남겨 향후 git blame 조사에서 헷갈리지 않게 하라.
- `판정 보류(사문)` 4개(`search_lookup_parents`, `select_sub`, `select_cni_parent`,
  `update_st`)는 전환 우선순위에서 제외해도 된다 — 호출부가 없으므로 전환의
  이익이 없다. 다만 정말 죽은 코드인지 Plan 2 시작 시점에 한 번 더 확인하라
  (다른 브랜치가 그사이 호출부를 추가했을 수 있다).
- 위 판정은 정적 분석(grep)에 기반한다. 동적으로 조립되는 함수명(문자열 결합 후
  `db_sql[name]()` 같은 호출)이 있다면 이 표에서 놓쳤을 수 있다 — 그런 패턴은
  이 코드베이스에서 발견되지 않았다.

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

   **로그도 함께 고친다.** `resource.js` 의 에러 로그가 `results.code` 만 찍으면
   중립화 후에는 대부분 `UNKNOWN` 이 된다. 원본 코드와 메시지를 함께 남겨라:

       console.log('[create_action] create resource error ======== ' +
                   (results.driverCode || results.code) + ' / ' + results.message);

   특히 knex 빌더 실수(`Undefined binding(s) detected when compiling …`)가
   `UNKNOWN` 으로만 찍히면 원인 추적이 불가능하다. 이게 전환 중 가장 흔한 실패다.

8. **`undefined` 값의 저장 결과가 바뀐다 — 검증 3층 전부가 못 잡는다.**

   구 코드의 `util.format('%s', undefined)` 는 문자열 `'undefined'` 를 저장했다.
   knex 는 `useNullAsDefault: true` 라 `undefined` 바인딩을 `NULL` 로 컴파일한다.
   즉 선택적 컬럼(`lbl`, `acpi`, `at`, `aa`, `subl`, `daci`)에서
   `'undefined'` -> `NULL` 로 **저장 값이 바뀐다.** NOT NULL 컬럼이면 조용한
   손상이 `NOT_NULL` 에러로 바뀐다. downstream 의 `JSON.parse(results[0].acpi)` 가
   각각 다르게 동작한다.

   **검증 3층이 전부 이걸 못 본다:**
   - 골든 SQL(`collect.js`)은 모든 값을 `V` 로 지운다. `tap.js` 는 bindings 를
     기록하지도 않는다.
   - 동등성 시나리오는 항상 필드를 채워 보낸다.

   따라서 선택적 필드를 **생략한** 요청을 시나리오에 추가해야 이 변화가 드러난다
   (예: `lbl` 없는 AE, `acpi` 없는 CNT). 전환하는 함수가 선택적 컬럼을 쓰면
   그 단계를 먼저 추가하라.

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
