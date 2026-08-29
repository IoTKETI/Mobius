'use strict';
// acpi 쓰기 가드레일.
//
// 지금까지 acpi 는 존재·타입·개수 무엇도 검사하지 않고 클라이언트 원문 그대로
// 저장됐다. 없는 ACP 를 가리켜도 200 이고(그러면 잠금이 조용히 풀린다),
// 8개째부터 varchar(200) 을 넘겨 400 이 아니라 HTTP 500 이 났다.
//
// resource.js 는 require 만 해도 sgn_man 이 MQTT 와 포트를 잡아 프로세스가
// 끝나지 않는다. 그래서 로직은 뽑아 놓은 규칙으로, 배선은 소스로 못박고,
// 실제 동작은 tools/discovery-compare 의 서버 실측으로 확인한다.
//
// 실측 (로컬 서버, 2026-08-29):
//   정상 1개                -> 200
//   비우기                   -> 200
//   없는 ACP                -> 400  "acpi refers to an accessControlPolicy that does not exist"
//   원소가 숫자              -> 400  "acpi entries must be strings"
//   배열이 아님              -> 400
//   서로 다른 8개            -> 400  "acpi is too long to store (200 characters when serialized)"
//   같은 것 2개              -> 200  (중복 제거)
//   ri / 구조화 경로         -> 둘 다 같은 내부 ri 로 저장

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');

function fn(name) {
    const m = SRC.match(new RegExp('(?:global\\.' + name + ' = function|function ' + name + ')[\\s\\S]*?\\n\\};?'));
    assert.ok(m, name + ' 를 찾지 못했다');
    return m[0];
}

// exports.create 의 앞부분 — acpi 배선만 잘라 본다.
function createWiring() {
    const m = SRC.match(/exports\.create = function[\s\S]*?function build_and_create\(\)/);
    assert.ok(m, 'create 배선을 찾지 못했다');
    return m[0];
}

test('varchar(200) 한도가 코드에 상수로 있다', function () {
    assert.ok(/ACPI_MAX_JSON = 200/.test(SRC), 'lookup.acpi 는 varchar(200) 이다');
});

test('validate_acpi 가 다섯 가지를 순서대로 본다', function () {
    const f = fn('validate_acpi');
    // 순서가 중요하다. 타입 검사가 먼저여야 make_internal_ri 의 .split 이
    // 숫자에 TypeError 를 던져 워커를 죽이는 일이 없다.
    const order = ['400-8', '400-61', 'make_internal_ri', 'get_ri_list_sri',
                   'ACPI_MAX_JSON', '400-62', 'select_acp_in', '400-63'];
    let at = -1;
    for (const token of order) {
        const i = f.indexOf(token);
        assert.ok(i > at, token + ' 이 순서에서 벗어났다');
        at = i;
    }
});

test('중복은 거부하지 않고 없앤다', function () {
    const f = fn('validate_acpi');
    assert.ok(/indexOf\(ri_list\[j\]\) === -1/.test(f), '중복 제거가 없다');
    // 중복을 거부하는 사유 코드를 새로 만들면 안 된다 — mid 와 같은 취급이다.
    const codes = (f.match(/'\d{3}-\d+'/g) || []).map((c) => c.slice(1, -1));
    assert.deepStrictEqual(
        codes.filter((c) => !['400-8', '400-61', '400-62', '400-63', '500-1'].includes(c)), [],
        '예상 밖의 사유 코드가 있다: ' + codes.join(', '));
});

test('acpi 를 안 보낸 요청에는 질의가 나가지 않는다', function () {
    // 배포 34,313 비-CIN 행 중 acpi 가 채워진 것은 2건이다. 검사 때문에
    // 모든 CREATE 에 질의가 늘면 안 된다.
    const f = fn('validate_acpi');
    assert.ok(/acpi\.length === 0[\s\S]{0,80}callback\(null, \[\]\)/.test(f),
        '빈 배열이면 질의 없이 끝나야 한다');
    assert.ok(/hasOwnProperty\('acpi'\)[\s\S]{0,120}build_and_create\(\)/.test(createWiring()),
        'body 에 acpi 가 없으면 검증을 건너뛰어야 한다');
});

test('CREATE 가 정규화한 값을 저장한다', function () {
    assert.ok(/body\.acpi = normalized/.test(createWiring()),
        '정규화 결과를 되쓰지 않으면 클라이언트 원문이 그대로 저장된다');
});

test('UPDATE 가 check_acp_update_acpi 앞에서 검증한다', function () {
    const u = SRC.match(/if \(!body_Obj\[rootnm\]\.hasOwnProperty\('acpi'\)\)[\s\S]*?function run_acp_check/);
    assert.ok(u, 'UPDATE 배선을 찾지 못했다');
    assert.ok(/validate_acpi\(request, response, body_Obj\[rootnm\]\.acpi/.test(u[0]));
    assert.ok(/body_Obj\[rootnm\]\.acpi = normalized/.test(u[0]));
    assert.ok(/resource_Obj\[rootnm\]\.acpi = normalized/.test(u[0]));
});

test('acpi 만 바꾸는 PUT 도 이 검증을 지난다', function () {
    // app.js 가 건너뛰는 것은 authorize_and_run(대상 리소스 권한)이지
    // update_resource 가 아니다. 그 사실이 바뀌면 검증이 통째로 새므로 못박는다.
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const m = app.match(/if \(!updates_beyond_acpi\(request\.bodyObj\)\)[\s\S]*?\n            \}/);
    assert.ok(m, 'acpi 전용 분기를 찾지 못했다');
    assert.ok(/resource\.update\(/.test(m[0]),
        'acpi 전용 PUT 이 resource.update 를 지나지 않으면 검증이 새어 나간다');
});

test('없는 ACP 목록은 로그에만 남는다 — 응답 msg 는 정적이다', function () {
    const f = fn('validate_acpi');
    assert.ok(/console\.log\([^)]*400-63/.test(f), '어느 것이 없는지 로그에 남겨야 한다');
});
