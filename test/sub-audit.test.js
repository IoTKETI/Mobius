'use strict';
// Subscription reachability audit: finds subscriptions whose receiver is gone.
//
// The notification path already makes this decision on every send but only logs it, and only when a notification actually occurs. The audit reproduces the same decision offline without sending.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
// ID-form nu resolution lives in mobius/nu_resolve.js; the prefix rule is aligned with it.
const NU_RESOLVE = fs.readFileSync(path.join(ROOT, 'mobius', 'nu_resolve.js'), 'utf8');

function auditBody() {
    const at = SQL.indexOf('exports.audit_subscriptions');
    assert.ok(at > 0, 'audit_subscriptions 가 없다');
    return SQL.slice(at);
}

// Body with comments removed. A comment such as 'COUNT(*) is not used' must not trip the check; only real code is inspected.
function auditCode() {
    return auditBody()
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter(function (l) { return !/^\s*\/\//.test(l); })
        .join('\n');
}

test('감사는 읽기만 한다', function () {
    const body = auditBody();
    for (const write of ['.insert(', '.update(', '.del(', '.delete(']) {
        assert.strictEqual(body.indexOf(write), -1,
            '감사가 DB 를 쓴다(' + write + ') — 관리 UI 가 확인 전에 상태를 바꾸면 안 된다');
    }
});

test('풀스캔을 부르는 형태가 없다', function () {
    const code = auditCode();
    // Global aggregates and leading-wildcard LIKE are full scans and cannot be used on the production lookup table.
    assert.strictEqual(/count\(\*\)/i.test(code), false, '전역 집계를 쓴다');
    assert.strictEqual(/like\s*\(?\s*['"]%/i.test(code), false, '선행 와일드카드 LIKE 를 쓴다');

    // ty must be an equality to use idx_lookup_ty.
    assert.ok(/\.where\(\{ ty: 23 \}\)/.test(code),
        'ty 를 등치로 걸지 않는다 — 인덱스를 못 탄다');
});

test('상한에 걸리면 조용히 자르지 않고 알린다', function () {
    const body = auditBody();
    assert.ok(/capped:/.test(body), 'capped 를 돌려주지 않는다');
    assert.ok(/findingsTruncated/.test(body), '발견 목록이 잘렸는지 알리지 않는다');

    // The cursor is the last returned row. A computed cursor is off by one (as select_orphan_page once was).
    assert.ok(/var last = rows\[rows\.length - 1\]\.ri/.test(body),
        '커서를 반환된 마지막 행에서 잡지 않는다');

    // When the cap was not reached, next must be null so the caller's loop terminates.
    assert.ok(/next: capped \? next : null/.test(body),
        '다 훑었는데도 이어보기 커서를 준다 — 호출부 루프가 안 닫힌다');
});

test('et 를 삭제 후보로 분류하지 않는다', function () {
    const body = auditBody();
    // et is not enforced anywhere at runtime: the expiry sweep has no periodic execution and the notification path does not compare et. Most subscriptions with a past et still deliver normally, so filtering by et would flood the list.
    assert.strictEqual(/where\('et'/.test(body), false,
        '감사가 et 로 거른다 — 정상 동작 중인 구독이 삭제 후보로 올라온다');
    assert.strictEqual(/SUB_AUDIT_REASON\.\w*EXPIRED/.test(body), false,
        '만료를 감사 사유로 넣었다 — 만료는 select_expired_resources 가 따로 다룬다');
});

// The decision must not diverge from the notification path; if the audit says dead while notifications arrive, the admin UI loses trust.

test('ID 형식 nu 해석이 sgn.js 와 같은 두 단계다', function () {
    const body = auditBody();

    // nu_resolve.js resolves in two steps: (1) find the ri of the first segment, (2) substitute the path and look the target up by full path. A single step would mistake the first segment (usually the CSEBase name) for the target and declare a live subscription dead.
    assert.ok(/function split_id_nu/.test(body), 'nu 분해 함수가 없다');
    assert.ok(/head_ri\[p\.head\]/.test(body), '첫 조각의 ri 를 쓰지 않는다');
    assert.ok(/p\.abs\.replace\('\/' \+ p\.head, hr\)/.test(body),
        '경로 치환이 없다 — 한 단계만 해서는 대상을 못 찾는다');

    // The prefix-stripping rule must equal the sending path's (nu_resolve.js).
    for (const src of [body, NU_RESOLVE]) {
        assert.ok(/replace\(usespid \+ usecseid \+ '\/', '\/'\)/.test(src),
            'usespid+usecseid 접두 제거가 없다');
        assert.ok(/replace\(usecseid \+ '\/', '\/'\)/.test(src),
            'usecseid 접두 제거가 없다');
    }
});

test('poa 를 타입별 테이블에서 읽는다', function () {
    const body = auditBody();
    // poa is not in lookup; only ae/cb/csr have it. Reading it from lookup fails the whole audit with Unknown column.
    assert.strictEqual(/select\('ri', 'sri', 'ty', 'poa'\)/.test(body), false,
        'lookup 에서 poa 를 읽으려 한다 — 그 컬럼은 lookup 에 없다');
    assert.ok(/POA_TABLE = \{ '2': 'ae', '5': 'cb', '16': 'csr' \}/.test(body),
        'poa 를 가진 타입 표가 없다');
});

test('구독마다 따로 조회하지 않는다', function () {
    const body = auditBody();
    // One round trip per subscription is unusable in production; pages are collected and queried with whereIn.
    const whereIns = (body.match(/\.whereIn\(/g) || []).length;
    assert.ok(whereIns >= 3,
        'whereIn 이 ' + whereIns + '곳이다 — 페이지 단위 배치 조회가 아닌지 확인할 것');
});

test('판정 사유가 코드로 나온다', function () {
    // The admin UI groups by these reasons.
    const db_sql_src = SQL;
    for (const r of ['no_sub_row', 'nu_empty', 'nu_unresolved', 'nu_no_poa', 'nu_bad_scheme']) {
        assert.ok(db_sql_src.indexOf("'" + r + "'") > 0, '사유 ' + r + ' 이 없다');
    }
    assert.ok(/exports\.SUB_AUDIT_REASON/.test(db_sql_src),
        '사유 표를 export 하지 않는다 — 관리 UI 가 문자열을 복제하게 된다');
});
