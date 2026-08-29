'use strict';
// 구독 도달성 감사 — "구독은 잔뜩 있는데 받을 놈이 사라진" 상태를 찾는다.
//
// 알림 경로는 이 판정을 이미 매번 하고 있다. 다만 로그로만 남기고 버리고,
// 알림이 실제로 발생해야(= 부모에 CIN 이 들어와야) 드러난다.
// 감사는 같은 판정을 전송 시도 없이 오프라인으로 재현한다.
//
// 실측 (로컬 DB, 구독 18건):
//   nu_no_poa      5건 — 대상 AE 는 있는데 poa 가 "[]" (DB 로 확인)
//   nu_unresolved  1건 — 대상 리소스가 lookup 에 없음 (DB 로 확인)
//   오탐 0건

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'mobius', 'sql_action.js'), 'utf8');
const SGN = fs.readFileSync(path.join(ROOT, 'mobius', 'sgn.js'), 'utf8');

function auditBody() {
    const at = SQL.indexOf('exports.audit_subscriptions');
    assert.ok(at > 0, 'audit_subscriptions 가 없다');
    return SQL.slice(at);
}

// 주석을 걷어낸 본문. 주석에 적어 둔 "COUNT(*) 는 쓰지 않는다" 같은 설명이
// 검사에 걸리면 안 된다 — 실제 코드만 본다.
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
    // 배포 lookup 은 5,740만 행이다. 전역 집계나 선행 와일드카드 LIKE 는
    // 풀스캔이라 운영 중에 쓸 수 없다.
    assert.strictEqual(/count\(\*\)/i.test(code), false, '전역 집계를 쓴다');
    assert.strictEqual(/like\s*\(?\s*['"]%/i.test(code), false, '선행 와일드카드 LIKE 를 쓴다');

    // ty 등치라야 idx_lookup_ty 를 탄다.
    assert.ok(/\.where\(\{ ty: 23 \}\)/.test(code),
        'ty 를 등치로 걸지 않는다 — 인덱스를 못 탄다');
});

test('상한에 걸리면 조용히 자르지 않고 알린다', function () {
    const body = auditBody();
    assert.ok(/capped:/.test(body), 'capped 를 돌려주지 않는다');
    assert.ok(/findingsTruncated/.test(body), '발견 목록이 잘렸는지 알리지 않는다');

    // 커서는 반환된 마지막 행이다. 계산해서 만들면 한 칸씩 어긋난다
    // (select_orphan_page 의 off-by-one 이 그랬다).
    assert.ok(/var last = rows\[rows\.length - 1\]\.ri/.test(body),
        '커서를 반환된 마지막 행에서 잡지 않는다');

    // 상한에 안 걸렸으면 next 는 null 이어야 한다. 그래야 호출부 루프가 닫힌다.
    assert.ok(/next: capped \? next : null/.test(body),
        '다 훑었는데도 이어보기 커서를 준다 — 호출부 루프가 안 닫힌다');
});

test('et 를 삭제 후보로 분류하지 않는다', function () {
    const body = auditBody();
    // et 는 런타임 어디에서도 강제되지 않는다. 만료 스윕은 주기 실행이 없고
    // 알림 경로에도 et 비교가 없다. 즉 et 가 지난 구독의 대다수는 지금도
    // 정상적으로 알림을 보내고 있다. 배포 표본에서 et 의 약 81% 가 이미
    // 과거이므로 이것을 넣으면 목록이 통째로 오염된다.
    assert.strictEqual(/where\('et'/.test(body), false,
        '감사가 et 로 거른다 — 정상 동작 중인 구독이 삭제 후보로 올라온다');
    assert.strictEqual(/SUB_AUDIT_REASON\.\w*EXPIRED/.test(body), false,
        '만료를 감사 사유로 넣었다 — 만료는 select_expired_resources 가 따로 다룬다');
});

// ── 판정이 알림 경로와 갈리지 않아야 한다 ────────────────────────────
//
// 감사와 알림이 다른 답을 내면 관리 UI 가 신뢰를 잃는다.
// "감사는 죽었다는데 알림은 잘 간다" 가 되면 아무도 안 쓴다.

test('ID 형식 nu 해석이 sgn.js 와 같은 두 단계다', function () {
    const body = auditBody();

    // sgn.js 의 get_nu_arr 은 (1) 첫 조각의 ri 를 찾아 (2) 경로를 치환한 뒤
    // 전체 경로로 대상을 찾는다. 한 단계만 하면 첫 조각(대개 CSEBase 이름)을
    // 대상으로 착각해 **살아 있는 구독을 죽었다고 판정한다** — 실제로 그랬다.
    assert.ok(/function split_id_nu/.test(body), 'nu 분해 함수가 없다');
    assert.ok(/head_ri\[p\.head\]/.test(body), '첫 조각의 ri 를 쓰지 않는다');
    assert.ok(/p\.abs\.replace\('\/' \+ p\.head, hr\)/.test(body),
        '경로 치환이 없다 — 한 단계만 해서는 대상을 못 찾는다');

    // 접두 제거 규칙이 sgn.js 와 같아야 한다.
    for (const src of [body, SGN]) {
        assert.ok(/replace\(usespid \+ usecseid \+ '\/', '\/'\)/.test(src),
            'usespid+usecseid 접두 제거가 없다');
        assert.ok(/replace\(usecseid \+ '\/', '\/'\)/.test(src),
            'usecseid 접두 제거가 없다');
    }
});

test('poa 를 타입별 테이블에서 읽는다', function () {
    const body = auditBody();
    // poa 는 lookup 에 없다. ae/cb/csr 에만 있다.
    // lookup 에서 읽으려 하면 Unknown column 으로 감사가 통째로 실패한다.
    assert.strictEqual(/select\('ri', 'sri', 'ty', 'poa'\)/.test(body), false,
        'lookup 에서 poa 를 읽으려 한다 — 그 컬럼은 lookup 에 없다');
    assert.ok(/POA_TABLE = \{ '2': 'ae', '5': 'cb', '16': 'csr' \}/.test(body),
        'poa 를 가진 타입 표가 없다');
});

test('구독마다 따로 조회하지 않는다', function () {
    const body = auditBody();
    // 구독 수만큼 왕복하면 배포에서 못 쓴다. 페이지 단위로 모아 whereIn 한다.
    const whereIns = (body.match(/\.whereIn\(/g) || []).length;
    assert.ok(whereIns >= 3,
        'whereIn 이 ' + whereIns + '곳이다 — 페이지 단위 배치 조회가 아닌지 확인할 것');
});

test('판정 사유가 코드로 나온다', function () {
    // 관리 UI 가 그룹으로 묶어 보여줄 수 있어야 한다.
    const db_sql_src = SQL;
    for (const r of ['no_sub_row', 'nu_empty', 'nu_unresolved', 'nu_no_poa', 'nu_bad_scheme']) {
        assert.ok(db_sql_src.indexOf("'" + r + "'") > 0, '사유 ' + r + ' 이 없다');
    }
    assert.ok(/exports\.SUB_AUDIT_REASON/.test(db_sql_src),
        '사유 표를 export 하지 않는다 — 관리 UI 가 문자열을 복제하게 된다');
});
