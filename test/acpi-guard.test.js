'use strict';
// acpi write guardrails.
//
// acpi used to be stored verbatim without checking existence, type or count: a reference to a missing ACP returned 200 (and the lock silently opened), and the eighth entry exceeded varchar(200) and produced HTTP 500 instead of 400.
//
// resource.js cannot be required in a test (sgn_man grabs MQTT and ports and the process never exits), so the logic is tested on the extracted rules, the wiring is pinned by source, and the behaviour is verified against a live server by tools/discovery-compare.
//
// Expected responses:
//   one valid entry            -> 200
//   emptied                    -> 200
//   missing ACP                -> 400  "acpi refers to an accessControlPolicy that does not exist"
//   numeric element            -> 400  "acpi entries must be strings"
//   not an array               -> 400
//   eight distinct entries     -> 400  "acpi is too long to store (200 characters when serialized)"
//   the same entry twice       -> 200  (deduplicated)
//   ri / structured path       -> both stored as the same internal ri

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

// The head of exports.create: only the acpi wiring is cut out.
function createWiring() {
    const m = SRC.match(/exports\.create = function[\s\S]*?function build_and_create\(\)/);
    assert.ok(m, 'create 배선을 찾지 못했다');
    return m[0];
}

test('varchar(200) 한도가 코드에 상수로 있다', function () {
    assert.ok(/ACPI_MAX_JSON = 200/.test(SRC), 'lookup.acpi 는 varchar(200) 이다');
});

test('validate_acpi 가 순서대로 본다 — 값싼 검사가 먼저', function () {
    const f = fn('validate_acpi');
    // Order matters.
    //  - The type check comes first, so make_internal_ri's .split cannot throw TypeError on a number and kill the worker.
    //  - The count check comes before get_ri_list_sri, which issues one query per element; without the count check one array could send thousands of queries.
    // The comment uses the same words, so the check looks for the call shapes.
    const order = ["'400-8'", "'400-61'", 'acpi.length > max_count',
                   'make_internal_ri(given)', 'get_ri_list_sri(request',
                   '.length > maxJson', 'select_acp_in(', "'400-63'"];
    let at = -1;
    for (const token of order) {
        const i = f.indexOf(token);
        assert.ok(i > at, token + ' 이 순서에서 벗어났다 (' + i + ' <= ' + at + ')');
        at = i;
    }
    // The count cap and the length cap are both 400-62 (the same meaning, 'cannot be stored'); which one was hit is told by the log.
    assert.strictEqual((f.match(/'400-62'/g) || []).length, 2);
});

test('원소 수 상한이 sri 해석보다 먼저 걸린다', function () {
    const f = fn('validate_acpi');
    const cap = f.indexOf('acpi.length > max_count');
    const resolve = f.indexOf('get_ri_list_sri(request');
    assert.ok(cap > 0, '개수 상한이 없다');
    assert.ok(resolve > 0, 'sri 해석을 찾지 못했다');
    assert.ok(cap < resolve, '개수 상한이 원소당 질의보다 뒤에 있으면 상한이 무의미하다');
});

test('macp 도 같은 검증을 지난다 — 안 그러면 워커가 죽는다', function () {
    // The group fan-out in app.js passes macp to security.check as is. A numeric element would make make_internal_ri throw with nothing to catch it.
    const grp = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'grp.js'), 'utf8');
    assert.ok(/validate_acpi\(request, response, body_Obj\[rootnm\]\.macp/.test(grp),
        'grp 생성이 macp 를 검증하지 않는다');
    assert.ok(/validate_acpi\(request, response, body_Obj\[rootnm\]\.macp/.test(SRC),
        'grp 수정이 macp 를 검증하지 않는다');
    // macp is mediumtext, so the varchar(200) limit must not apply.
    assert.ok(/maxJson: (MACP_MAX_JSON|2000)/.test(grp), 'macp 에 acpi 한도를 쓰고 있다');
});

test('make_internal_ri 는 문자열이 아닌 원소에 던지지 않는다', function () {
    // Blocks the crash point itself: every caller is inside a DB callback or security.check, where a throw kills the worker.
    const m = SRC.match(/global\.make_internal_ri = function[\s\S]*?\n\};/);
    assert.ok(m, 'make_internal_ri 를 찾지 못했다');
    assert.ok(/typeof resource_Obj\[index\] !== 'string'[\s\S]{0,40}continue/.test(m[0]),
        '문자열이 아닌 원소를 건너뛰지 않는다');
});

test('중복은 거부하지 않고 없앤다', function () {
    const f = fn('validate_acpi');
    assert.ok(/indexOf\(ri_list\[j\]\) === -1/.test(f), '중복 제거가 없다');
    // No new reason code for duplicates; they are treated like mid.
    const codes = (f.match(/'\d{3}-\d+'/g) || []).map((c) => c.slice(1, -1));
    assert.deepStrictEqual(
        codes.filter((c) => !['400-8', '400-61', '400-62', '400-63', '500-1'].includes(c)), [],
        '예상 밖의 사유 코드가 있다: ' + codes.join(', '));
});

test('acpi 를 안 보낸 요청에는 질의가 나가지 않는다', function () {
    // Almost no resource has acpi, so the check must not add a query to every CREATE.
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
});

test('권한은 **지금 걸려 있는** acpi 로 본다', function () {
    // Judged by the pvs of the ACP to be attached, 'attach the ACP I created' would always pass. resource_Obj must still be the row as read from the DB.
    const u = SRC.match(/if \(!body_Obj\[rootnm\]\.hasOwnProperty\('acpi'\)\)[\s\S]*?function run_acp_check/);
    assert.ok(/var existingAcpi = resource_Obj\[rootnm\]\.acpi/.test(u[0]),
        '기존 acpi 를 먼저 붙잡아야 한다');
    assert.ok(/run_acp_check\(existingAcpi, normalized\)/.test(u[0]),
        '권한 검사에 기존 acpi 를 넘겨야 한다');
    assert.ok(!/resource_Obj\[rootnm\]\.acpi = normalized/.test(u[0]),
        '검사 전에 resource_Obj 를 덮어쓰면 기존 값이 사라진다');
});

test('acpi 만 바꾸는 PUT 도 이 검증을 지난다', function () {
    // What app.js skips is authorize_and_run (access to the target resource), not update_resource. If that changes the validation would be bypassed entirely, so it is pinned.
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
