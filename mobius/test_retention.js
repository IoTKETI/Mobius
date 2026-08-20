/**
 * 보관 정책과 정리 건수 계산 자체 점검.
 *   node mobius/test_retention.js
 * DB 없이 순수 함수만 검증한다.
 */

var assert = require('assert');
var policy = require('./cnt').retention_policy;
var purge_plan = require('./sql_action').purge_plan;

var MBS_DEFAULT = 3153600000;
var MBS_UNLIMITED = 1099511627776;

// ── 보관 정책 ──────────────────────────────────────────────
// disarm: 순환 보관
assert.strictEqual(policy('/Mobius/UMACAIR/Drone_Data/MUL3/disarm').mni, '100000');
assert.strictEqual(policy('/Mobius/UMACAIR/Mission_Data/DD200/msw_lte/disarm').mni, '100000');
// 용량은 기본값을 유지해 디스크 안전장치로 남긴다
assert.strictEqual(policy('/Mobius/UMACAIR/Drone_Data/MUL3/disarm').mbs, null);

// sortie: 삭제 없이 축적
var sortie = policy('/Mobius/UMACAIR/Drone_Data/DD200/2026_08_19_T_13_22');
assert.strictEqual(sortie.mni, '3153600000');
assert.strictEqual(sortie.mbs, String(MBS_UNLIMITED));

// KETI_Simul_*: sortie 든 disarm 이든 전부 최소 보관 (우선순위가 가장 높다)
assert.strictEqual(policy('/Mobius/KETI_GCS/Drone_Data/KETI_Simul_11/2026_08_16_T_18_05').mni, '10000');
assert.strictEqual(policy('/Mobius/KETI_GCS/Drone_Data/KETI_Simul_11/disarm').mni, '10000');
assert.strictEqual(policy('/Mobius/KETI_GCS/Mission_Data/KETI_Simul_3/msw_lte/2026_08_16_T_18_05').mni, '10000');

// 그 외는 정책 없음 → 기존 기본값 유지
assert.strictEqual(policy('/Mobius/UMACAIR/GCS_Data/DD200'), null);
assert.strictEqual(policy('/Mobius/KETI_GCS/Drone_Data/KETI_Drone'), null);
// 소티처럼 생겼지만 끝이 아닌 경로는 소티가 아니다
assert.strictEqual(policy('/Mobius/X/2026_08_19_T_13_22/sub'), null);

// ── 정리 건수 계산 ─────────────────────────────────────────
// 장애 상황 재현: 개수는 여유, 용량만 초과 (KETI_Simul_11 실측값)
var p = purge_plan(128041, 3279862511, 3153600000, MBS_DEFAULT);
assert.strictEqual(p.need_cnt, 0, '개수는 한도 이내');
assert.strictEqual(p.need_cs, 3279862511 - MBS_DEFAULT);
assert.ok(p.est_count > 1, '용량 초과인데 1건만 지우면 수렴하지 않는다');
assert.strictEqual(p.candidates, 500, '용량 초과는 상한만큼 후보를 가져온다');
// 초과 126MB / 평균 25.6KB ≈ 4,930건 → 패스 상한 500 으로 잘린다
assert.strictEqual(p.est_count, 500);

// 개수만 초과: 초과분만 지운다
p = purge_plan(10050, 1000, 10000, MBS_DEFAULT);
assert.strictEqual(p.need_cnt, 50);
assert.strictEqual(p.need_cs, 0);
assert.strictEqual(p.candidates, 50, '개수 초과는 필요한 만큼만 조회한다');
assert.strictEqual(p.est_count, 50);

// 개수 초과가 상한을 넘으면 잘리고, 나머지는 다음 패스에서 처리된다
p = purge_plan(128041, 1000, 10000, MBS_DEFAULT);
assert.strictEqual(p.need_cnt, 118041);
assert.strictEqual(p.candidates, 500);

// 한도 이내면 지울 것이 없다
p = purge_plan(500, 1000, 10000, MBS_DEFAULT);
assert.strictEqual(p.need_cnt, 0);
assert.strictEqual(p.need_cs, 0);
assert.strictEqual(p.candidates, 0);

// 빈 컨테이너에서 0 나누기가 나지 않는다
p = purge_plan(0, 5000, 0, 1000);
assert.strictEqual(p.need_cs, 4000);
assert.ok(Number.isFinite(p.est_count) && p.est_count > 0);

// ── 누적 절단 루프 (delete_oldest 안의 로직과 동일한 규칙) ──
// 개수·용량 조건이 모두 충족되는 지점에서 멈춘다.
function trim(rows, need_cnt, need_cs) {
    var total_cs = 0, total_cnt = 0;
    for (var i = 0; i < rows.length; i++) {
        total_cs += rows[i];
        total_cnt++;
        if (total_cnt >= need_cnt && total_cs >= need_cs) break;
    }
    return total_cnt;
}
var rows = [];
for (var i = 0; i < 500; i++) rows.push(26000);
// 용량만 130MB 초과 → 26KB 씩 5,000건이 필요하지만 후보 500건이 전부 쓰인다
assert.strictEqual(trim(rows, 0, 130000000), 500);
// 용량 52KB 초과 → 2건이면 충분
assert.strictEqual(trim(rows, 0, 52000), 2);
// 개수 10건 초과, 용량은 이미 충족 → 10건
assert.strictEqual(trim(rows, 10, 0), 10);
// 개수 3건 초과인데 용량은 5건분 필요 → 큰 쪽인 5건
assert.strictEqual(trim(rows, 3, 130000), 5);

console.log('test_retention: 통과');
