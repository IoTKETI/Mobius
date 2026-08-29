'use strict';
// discovery 결과를 리소스별 ACP 로 거른다.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// 탐색은 **요청 대상 하나**만 검사하고 나온 결과를 그대로 냈다. 그래서
// "AE 아래 컨테이너 하나만 잠갔다" 가 성립하지 않았다. 실측:
//
//   AE(열림) / open(열림) / secret(팀 전용) / secret/inner + CIN
//   Cother 로 AE 탐색 -> 200, 5건 중 3건이 잠근 곳
//       Mobius/dx_ae/secret
//       Mobius/dx_ae/secret/inner
//       Mobius/dx_ae/secret/4-20260829164926672003000
//   같은 원본으로 잠근 곳을 직접 탐색/조회/la -> 전부 403
//
// 내용은 안 새고 **경로가 샌다** — 이름·트리 구조·CIN 개수·생성 시각(ri 에
// 타임스탬프가 들어 있다)이 그대로 나간다. 관리자는 잠갔다고 생각하는데
// 아니다. 이것이 "ACP 를 걸었더니 기대와 다르게 동작한다" 의 한 사례다.
//
// ── 어떻게 값싸게 하는가 ─────────────────────────────────────────────────
// 행마다 security.check 를 부르면 안 된다. 배포 기본 lim 이 2,000 이고
// 건마다 조상 체인을 DB 로 훑으면 요청 하나가 수천 질의가 된다.
//
// 세 가지가 맞물려 값싸진다.
//
//   1. **행에 이미 acpi 가 있다.** search_lookup 이 lookup 의 r.* 를 뽑는다.
//   2. **ri 가 경로다.** 조상은 문자열 접두사라 조상 탐색이 DB 가 아니다.
//   3. **루트는 이미 검사됐다.** 요청 단계에서 access_value '32' 로 통과했다.
//      그러므로 "루트에서 상속받는" 행은 더 볼 것이 없다.
//
// 그래서 실제로 평가해야 하는 것은 **루트와 다른 acpi 를 가진 행**뿐이고,
// 비용은 행 수가 아니라 **서로 다른 acpi 조합 수**에 비례한다.
// 배포 현황(acpi 가 채워진 리소스 2개)에서는 거의 모든 탐색이 추가 질의 0회다.
//
// cr 은 이미 손에 있다 — 이 함수는 select_spec_ri 뒤에 돌므로 타입별 컬럼이
// 합쳐져 있다. 그래서 생성자 우회도 질의 없이 적용된다.

var db_sql = require('./sql_action');
var security = require('./security');

// 조상 조회를 나눠 내보내는 단위. select_spec_ri 와 같은 값이다.
var CHUNK = 500;

// oneM2M DISCOVERY 비트.
var DISCOVERY = '32';

function parse_acpi(v) {
    if (Array.isArray(v)) { return v; }
    if (typeof v !== 'string' || v === '' || v === '[]') { return []; }
    try {
        var o = JSON.parse(v);
        return Array.isArray(o) ? o : [];
    }
    catch (e) { return []; }
}

// app.js 의 resolve_cr 과 같은 규칙. ae 와 remoteCSE 는 cr 컬럼이 없다.
function cr_of(row) {
    if (String(row.ty) === '2') { return row.aei; }
    if (String(row.ty) === '16') { return row.csi; }
    return row.cr;
}

// root 아래, ri 위의 조상 경로들을 가까운 것부터 돌려준다.
// '/Mobius/ae/a/b' 이고 root 가 '/Mobius/ae' 면 ['/Mobius/ae/a'] 다.
function ancestors_under(ri, root) {
    var out = [];
    var at = ri.lastIndexOf('/');
    while (at > 0) {
        var anc = ri.slice(0, at);
        if (anc.length <= root.length) { break; }
        out.push(anc);
        at = anc.lastIndexOf('/');
    }
    return out;
}

/**
 * foundObj 에서 이 원본이 탐색할 수 없는 항목을 걷어낸다.
 *
 * **select_spec_ri 뒤에 부른다.** 타입별 컬럼(cr 등)이 합쳐져 있어야 한다.
 *
 * @param root_ri  탐색 루트. 이미 권한 검사를 통과한 리소스다.
 * @returns callback(null, { kept, removed, evaluated, queries })
 *          실패는 파사드 규약대로 callback(true, errObj)
 */
exports.filter_found = function (connection, request, root_ri, foundObj, callback) {
    var stats = { kept: 0, removed: 0, evaluated: 0, queries: 0 };

    if (global.acp_discovery_filter === 'off') {
        stats.kept = Object.keys(foundObj).length;
        return callback(null, stats);
    }

    var from = request.headers ? request.headers['x-m2m-origin'] : undefined;
    var keys = Object.keys(foundObj);
    stats.kept = keys.length;

    if (keys.length === 0) { return callback(null, stats); }
    // 수퍼유저는 ACP 를 하나도 보지 않는다. 거를 것도 없다.
    if (from === global.usesuperuser || from === ('/' + global.usesuperuser)) {
        return callback(null, stats);
    }

    // 1) 행 자신의 acpi. 비어 있지 않은 것만 기억한다.
    var own = {};
    var need = {};
    for (var i = 0; i < keys.length; i++) {
        var a = parse_acpi(foundObj[keys[i]].acpi);
        if (a.length > 0) { own[keys[i]] = a; }
    }

    // 2) own 이 빈 행은 조상을 봐야 한다. 결과에 없는 조상만 조회한다.
    for (var j = 0; j < keys.length; j++) {
        if (own[keys[j]]) { continue; }
        var anc = ancestors_under(keys[j], root_ri);
        for (var k = 0; k < anc.length; k++) {
            if (!foundObj.hasOwnProperty(anc[k])) { need[anc[k]] = 1; }
        }
    }

    var need_list = Object.keys(need);
    fetch_ancestors(need_list, {}, 0, function (errA, ancMap) {
        if (errA) { return callback(errA, ancMap); }
        decide(ancMap);
    });

    // 조상 중 acpi 가 채워진 것만 가져온다. 배포에는 2개뿐이라 대개 빈 결과다.
    function fetch_ancestors(list, acc, at, cb) {
        if (at >= list.length) { return cb(null, acc); }
        var chunk = list.slice(at, at + CHUNK);
        stats.queries += 1;
        db_sql.select_lookup_acpi_in(connection, chunk, function (err, rows) {
            if (err) { return cb(err, rows); }
            for (var n = 0; n < (rows || []).length; n++) {
                var a = parse_acpi(rows[n].acpi);
                if (a.length > 0) { acc[rows[n].ri] = a; }
            }
            fetch_ancestors(list, acc, at + CHUNK, cb);
        });
    }

    function effective_acpi(ri, ancMap) {
        if (own[ri]) { return own[ri]; }
        var anc = ancestors_under(ri, root_ri);
        for (var n = 0; n < anc.length; n++) {
            if (own[anc[n]]) { return own[anc[n]]; }
            if (ancMap[anc[n]]) { return ancMap[anc[n]]; }
        }
        // 루트에서 상속받는다 — 루트는 이미 통과했으므로 볼 것이 없다.
        return null;
    }

    function decide(ancMap) {
        // 3) 실효 acpi 로 묶는다. null 인 행은 그대로 통과.
        var groups = {};
        for (var n = 0; n < keys.length; n++) {
            var ri = keys[n];
            var eff = effective_acpi(ri, ancMap);
            if (eff === null) { continue; }

            // 생성자는 ACP 와 무관하게 통과한다 — 직접 조회와 같아야 한다.
            if (security._creator_bypasses(foundObj[ri].ty, cr_of(foundObj[ri]), from)) { continue; }

            var key = JSON.stringify(db_sql.fold_acpi_list(eff));
            if (!groups[key]) { groups[key] = { acpi: db_sql.fold_acpi_list(eff), ris: [] }; }
            groups[key].ris.push(ri);
        }

        var gkeys = Object.keys(groups);
        if (gkeys.length === 0) { return callback(null, stats); }

        // 4) 묶음마다 ACP 행을 한 번 읽고, 행마다 순수 함수로 판정한다.
        run_group(gkeys, 0);

        function run_group(list, at) {
            if (at >= list.length) { return callback(null, stats); }
            var g = groups[list[at]];
            stats.queries += 1;
            db_sql.select_acp_in(connection, g.acpi, function (err, acp_rows) {
                if (err) { return callback(err, acp_rows); }

                for (var n = 0; n < g.ris.length; n++) {
                    var ri = g.ris[n];
                    var row = foundObj[ri];
                    stats.evaluated += 1;
                    var v = security._evaluate_acp_rows(
                        acp_rows || [], request, cr_of(row), DISCOVERY, 'pv', true, true);
                    if (v.code !== '1') {
                        delete foundObj[ri];
                        stats.removed += 1;
                        stats.kept -= 1;
                    }
                }
                run_group(list, at + 1);
            });
        }
    }
};

exports._ancestors_under = ancestors_under;
exports._parse_acpi = parse_acpi;
exports._cr_of = cr_of;
