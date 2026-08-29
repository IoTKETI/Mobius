'use strict';
// 이미 저장된 ACP 와 acpi 를 전수 점검한다.
//
// 가드레일(acp.validate_privileges, validate_acpi)은 **새로 쓰는 값만** 막는다.
// 이미 저장된 잘못된 값은 그대로 남아 500 이나 조용한 거부를 계속 낸다.
// 배포에는 이미 dangling acpi 가 한 건 있다 — /Mobius/sch8 이 없는
// /Mobius/acp_sch1 을 가리켜, 수퍼유저 말고는 아무도 못 쓰는 상태다.
//
// **아무것도 고치지 않는다.** 목록만 돌려준다. 되돌릴 수 없는 조작은 관리자가
// 화면을 보고 정한다.

var db_sql = require('./sql_action');
var acp = require('./acp');

var LINT_MAX = 500;

// 새로 쓰는 값을 막는 사유 코드를 사람이 읽는 규칙 이름으로 바꾼다.
// 린터는 거부하지 않으므로 코드가 아니라 "무슨 일이 일어나는가" 를 보여 준다.
var BY_CODE = {
    '400-56': { rule: 'privileges_shape', severity: 'error',
        message: '권한 규칙 객체가 아니다 — 평가에서 이 ACP 가 통째로 건너뛰어진다' },
    '400-23': { rule: 'acr_missing_or_empty', severity: 'error',
        message: 'acr 이 없거나 비었다 — 평가가 여기서 끝나고 뒤 ACP 를 가린다' },
    '400-12': { rule: 'acr_not_array', severity: 'error',
        message: 'acr 이 배열이 아니다 — 아무것도 허용하지 않는다' },
    '400-57': { rule: 'acop_invalid', severity: 'error',
        message: 'acop 이 없거나 범위를 벗어났다 — 이 ACP 를 참조하는 요청이 HTTP 500 이 된다' },
    '400-13': { rule: 'acor_not_array', severity: 'error',
        message: 'acor 이 배열이 아니다' },
    '400-58': { rule: 'acor_not_string', severity: 'error',
        message: 'acor 원소가 문자열이 아니다' },
    '400-14': { rule: 'acco_not_array', severity: 'error',
        message: 'acco 가 배열이 아니다' },
    '400-59': { rule: 'actw_bad_arity', severity: 'error',
        message: 'actw 가 6자리가 아니다 — 평가할 때마다 로그를 찍고 언제나 거부한다' },
    '400-60': { rule: 'acip_both_families', severity: 'error',
        message: 'acip 에 ipv4 와 ipv6 가 함께 있다 — ipv6 는 무시된다' }
};

var WARN_MESSAGE = {
    actw_second_pinned: '초 또는 분이 * 가 아니다 — 하루에 그 순간만 열린다',
    acor_looks_like_regex: '정규식처럼 보인다 — 발신자 비교는 문자열 등치라 맞지 않는다',
    acor_not_normalized: "'/' 로 시작한다 — '/X' 와 'X' 는 서로 다른 주체로 본다",
    pvs_no_admin: '관리자가 없다 — 수퍼유저 말고는 이 ACP 를 못 고친다',
    acop_zero: '아무 권한도 주지 않는 규칙이다'
};

function problems_of(raw, attr, ri) {
    var out = [];
    var parsed = raw;

    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); }
        catch (e) {
            out.push({ severity: 'error', rule: 'parse_error', path: attr,
                message: attr + ' 를 JSON 으로 읽을 수 없다 — 평가에서 이 ACP 가 통째로 건너뛰어진다' });
            return out;
        }
    }
    if (raw === null || raw === undefined) {
        out.push({ severity: 'error', rule: 'body_missing', path: attr,
            message: attr + ' 가 없다 — acp 행이 반쪽이다' });
        return out;
    }

    var v = acp.validate_privileges(parsed, attr);
    if (v.code !== null) {
        var known = BY_CODE[v.code];
        out.push(known
            ? { severity: known.severity, rule: known.rule, path: v.path, message: known.message }
            : { severity: 'error', rule: 'invalid', path: v.path, message: '검증에 걸렸다 (' + v.code + ')' });
    }
    v.warnings.forEach(function (w) {
        out.push({ severity: 'warn', rule: w.rule, path: w.path,
            message: WARN_MESSAGE[w.rule] || w.message });
    });
    return out;
}

/**
 * 저장된 ACP 를 페이지 단위로 점검한다.
 *
 * 배치마다 질의 두 번이다(lookup 목록 + acp 본문 whereIn). N+1 이 아니다.
 *
 * @param opts { limit=200(상한 500), afterRi='' }
 * @returns callback(null, { rows, more, nextRi, counts })
 */
exports.lint_acp = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};
    var limit = Math.min(Math.max(parseInt(o.limit, 10) || 200, 1), LINT_MAX);

    db_sql.select_acp_list(connection, { limit: limit, afterRi: o.afterRi || '' },
        function (err, page) {
            if (err) { return callback(err, page); }
            if (page.rows.length === 0) {
                return callback(null, { rows: [], more: false, nextRi: null,
                                        counts: { error: 0, warn: 0, clean: 0 } });
            }

            var ris = page.rows.map(function (r) { return r.ri; });
            db_sql.select_acp_in(connection, ris, function (err2, bodies) {
                if (err2) { return callback(err2, bodies); }

                var byRi = {};
                (bodies || []).forEach(function (b) { byRi[b.ri] = b; });

                var counts = { error: 0, warn: 0, clean: 0 };
                var rows = page.rows.map(function (r) {
                    var body = byRi[r.ri];
                    var problems = [];
                    if (!body) {
                        // lookup 에는 있는데 acp 본문이 없다. 평가에서는 "참조한
                        // ACP 를 못 찾음" 이 되어 잠금이 조용히 풀린다.
                        problems.push({ severity: 'error', rule: 'body_missing', path: 'acp',
                            message: 'acp 행이 없다 — 이 ACP 를 참조하는 리소스는 생성자만 통과한다' });
                    }
                    else {
                        problems = problems_of(body.pv, 'pv', r.ri)
                            .concat(problems_of(body.pvs, 'pvs', r.ri));
                    }

                    if (problems.some(function (p) { return p.severity === 'error'; })) { counts.error++; }
                    else if (problems.length > 0) { counts.warn++; }
                    else { counts.clean++; }

                    return { ri: r.ri, rn: r.rn, ct: r.ct, lt: r.lt, et: r.et, problems: problems };
                });

                callback(null, { rows: rows, more: page.more, nextRi: page.nextRi, counts: counts });
            });
        });
};

/**
 * 저장된 acpi 참조를 점검한다 — 가리키는 ACP 가 실재하는가, 표기가 맞는가.
 *
 * @param opts { batch, scanCap, maxRefs, after }
 *        after 는 앞선 호출의 result.next 를 **그대로** 넘긴다.
 * @returns callback(null, { rows, counts, scanned, capped, broken, next })
 *          next 가 있으면 아직 남았다. 없으면 다 훑은 것이다.
 */
exports.lint_acpi_refs = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};

    // 존재하는 ACP ri 집합을 먼저 모은다. ty=1 이라 idx_lookup_ty 를 타고,
    // 배포에 ACP 는 1개라 한 페이지로 끝난다.
    var known = {};
    function collect(after) {
        db_sql.select_acp_list(connection, { limit: LINT_MAX, afterRi: after },
            function (err, page) {
                if (err) { return callback(err, page); }
                page.rows.forEach(function (r) { known[r.ri] = 1; });
                if (page.more) { return setImmediate(collect, page.nextRi); }
                scan();
            });
    }

    function scan() {
        db_sql.scan_acpi_refs(connection, {
            acpRi: null, batch: o.batch, scanCap: o.scanCap, maxRefs: o.maxRefs, after: o.after
        }, function (err, res) {
            if (err) { return callback(err, res); }

            // 표기 접기만으로 내부 ri 가 되지 않은 원소를 sri 로 풀어 본다.
            // 이걸 안 하면 sri 로 저장된 정상 참조가 전부 dangling 으로 보인다.
            db_sql.resolve_acpi_entries(connection, res.unresolved, function (err2, resolved) {
                if (err2) { return callback(err2, resolved); }
                judge(res, (resolved && resolved.map) ? resolved.map : {});
            });
        });
    }

    function judge(res, sriMap) {
            var counts = { error: 0, warn: 0, clean: 0 };
            var rows = res.refs.map(function (ref) {
                var problems = [];

                ref.acpi.forEach(function (entry) {
                    if (known[entry]) { return; }
                    var viaSri = sriMap[entry];
                    if (viaSri && known[viaSri]) {
                        // 실재하기는 한다. 다만 저장 표기가 내부 ri 가 아니다.
                        problems.push({ severity: 'warn', rule: 'not_normalized', entry: entry,
                            message: '내부 ri(' + viaSri + ') 가 아니라 sri 로 저장돼 역참조가 어긋난다' });
                        return;
                    }
                    problems.push({ severity: 'error', rule: 'dangling', entry: entry,
                        message: '가리키는 ACP 가 없다 — 잠금이 풀려 생성자만 통과한다' });
                });
                if (!ref.normalized) {
                    problems.push({ severity: 'warn', rule: 'raw_not_canonical', entry: ref.raw,
                        message: '저장된 문자열이 정규 형태가 아니다(공백·순서 등)' });
                }
                var len = JSON.stringify(ref.acpi).length;
                if (len > 180) {
                    problems.push({ severity: 'warn', rule: 'over_length', entry: String(len),
                        message: 'varchar(200) 에 근접했다 — 하나 더 붙이면 거부된다' });
                }
                if (ref.acpi.length >= 7) {
                    problems.push({ severity: 'warn', rule: 'count_at_limit', entry: String(ref.acpi.length),
                        message: '원소가 7개다 — 다음 하나를 붙이면 거부된다' });
                }

                if (problems.some(function (p) { return p.severity === 'error'; })) { counts.error++; }
                else if (problems.length > 0) { counts.warn++; }
                else { counts.clean++; }

                return { ri: ref.ri, ty: ref.ty, rn: ref.rn, acpi: ref.acpi, problems: problems };
            });

            callback(null, {
                rows: rows, counts: counts, scanned: res.scanned,
                capped: res.capped, broken: res.broken,
                refsTruncated: res.refsTruncated, unresolved: res.unresolved,
                // 스캐너의 커서를 그대로 흘려보낸다. 안 넘기면 capped 상태에서
                // 이어볼 방법이 없어 "여기까지가 전부" 로 오해하게 된다.
                next: res.next
            });
    }

    collect('');
};

exports._problems_of = problems_of;
