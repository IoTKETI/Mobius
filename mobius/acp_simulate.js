'use strict';
// ACP simulator: what happens when this originator performs this operation on this resource. Returns the decision only, using the same evaluator as security.js (evaluate_acp_rows). acpiOverride / acpRowsOverride allow asking about an ACP that is not stored yet.

var db_sql = require('./sql_action');
var security = require('./security');

// oneM2M acop bits. Subscription creation is CREATE(1)+RETRIEVE(2) = '3', as in app.js.
var OPS = {
    CREATE: '1', CREATE_SUB: '3', RETRIEVE: '2', UPDATE: '4',
    DELETE: '8', NOTIFY: '16', DISCOVERY: '32'
};

// The inheriting types, the field per type and the use_ra/cr_fallback options all come from security (INHERITS_ACPI, field_of, FIELD).

function access_value_of(op) {
    if (op === undefined || op === null) { return OPS.RETRIEVE; }
    var key = String(op).toUpperCase();
    if (OPS.hasOwnProperty(key)) { return OPS[key]; }
    // access_value passed directly
    if (/^\d+$/.test(String(op))) { return String(op); }
    return null;
}

function op_name_of(access_value) {
    var keys = Object.keys(OPS);
    for (var i = 0; i < keys.length; i++) {
        if (OPS[keys[i]] === access_value) { return keys[i]; }
    }
    return 'op' + access_value;
}

function parse_acpi(v) {
    if (Array.isArray(v)) { return v; }
    if (typeof v !== 'string' || v === '') { return []; }
    try {
        var o = JSON.parse(v);
        return Array.isArray(o) ? o : [];
    }
    catch (e) { return []; }
}

// A synthetic request carrying only what security.js reads from a request.
function fake_request(connection, params, ri) {
    return {
        headers: { 'x-m2m-origin': params.origin, remoteaddress: params.ip || undefined },
        connection: { remoteAddress: params.ip || '127.0.0.1' },
        url: ri,
        db_connection: connection
    };
}

function warn(list, rule, acp_ri, message) {
    list.push({ rule: rule, acp_ri: acp_ri || null, message: message });
}

/**
 * Evaluates one combination.
 *
 * @param params {
 *   ri, origin, op,
 *   ip=null,                  // for acip; 127.0.0.1 when null
 *   acpiOverride=null,        // evaluate with this instead of the stored acpi
 *   acpRowsOverride=null      // evaluate with ACP bodies that are not stored yet
 * }
 */
exports.simulate = function (connection, params, callback) {
    var p = params || {};
    if (!p.ri) { return callback(true, { code: 'BAD_PARAMS', message: 'ri 가 필요하다' }); }
    if (!p.origin) { return callback(true, { code: 'BAD_PARAMS', message: 'origin 이 필요하다' }); }

    var access_value = access_value_of(p.op);
    if (access_value === null) {
        return callback(true, { code: 'BAD_PARAMS', message: '모르는 연산이다: ' + p.op });
    }

    db_sql.select_resource_from_url(connection, p.ri, p.ri, function (err, rows) {
        if (err) { return callback(err, rows); }
        if (!rows || rows.length === 0) {
            return callback(null, { found: false, ri: p.ri });
        }

        var target = rows[0];
        var ty = String(target.ty);
        // ae and cb have no cr column; same rule as resolve_cr in app.js.
        var cr = target.cr;
        if (ty === '2') { cr = target.aei; }
        else if (ty === '16') { cr = target.csi; }

        var base = {
            found: true, ri: target.ri, ty: target.ty, rn: target.rn, cr: cr || null,
            origin: p.origin, op: op_name_of(access_value), access_value: access_value,
            ip: p.ip || null
        };
        var warnings = [];

        if (p.origin === global.usesuperuser || p.origin === ('/' + global.usesuperuser)) {
            warn(warnings, 'superuser', null,
                '수퍼유저는 ACP 를 하나도 보지 않는다 — 이 결과는 정책 검증이 아니다');
            return callback(null, Object.assign(base, {
                source: 'none', inherited_from: null, acpi: [], resolved: [],
                allowed: true, code: '1', decided_by: 'superuser',
                acp_ri: null, field: null, acr_index: null, trace: null, warnings: warnings
            }));
        }

        if (security._creator_bypasses(ty, cr, p.origin)) {
            return callback(null, Object.assign(base, {
                source: 'none', inherited_from: null, acpi: [], resolved: [],
                allowed: true, code: '1', decided_by: 'creator',
                acp_ri: null, field: null, acr_index: null, trace: null, warnings: warnings
            }));
        }

        // Which field and which options apply is decided by security.
        var field = security.field_of(ty);
        var opt = security.FIELD[field];

        // An empty acpiOverride asks what happens when this ACP is removed; it takes the same path as a resource whose stored acpi is empty (inheritance, then the default policy).
        var overridden = Array.isArray(p.acpiOverride);
        if (overridden && p.acpiOverride.length > 0) {
            finish('override', null, p.acpiOverride);
            return;
        }

        // An override that empties acpi is treated like an empty stored acpi.
        var own = overridden ? [] : parse_acpi(target.acpi);
        // The source of the decision is reported so the caller can tell a hypothetical result from the current one.
        var src_own = overridden ? 'override' : 'own';
        var src_none = overridden ? 'override' : 'none';

        if (field === 'pvs' && own.length === 0) {
            // An ACP is judged by its own pvs; that does not depend on acpi, so an override does not change it.
            finish(src_own, null, [target.ri]);
            return;
        }
        if (own.length > 0) {
            finish(src_own, null, own);
            return;
        }
        if (security.INHERITS_ACPI[ty]) {
            var uri_arr = String(target.ri).split('/');
            db_sql.select_acp_cnt(connection, 0, uri_arr, function (err2, inherited, found_ri) {
                if (err2) { return callback(err2, inherited); }
                if (!inherited || inherited.length === 0) {
                    return finish_default(src_none, null);
                }
                finish(overridden ? 'override_inherited' : 'inherited', found_ri || null, inherited);
            });
            return;
        }
        finish_default(src_none, null);

        function finish_default(source, from) {
            // No acpi anywhere: same rule as security_default_check_action.
            var policy = global.useaccesscontrolpolicy;
            var allowed;
            if (policy === 'enable') { allowed = false; }
            else { allowed = !!(access_value & 1 || access_value & 2 || access_value & 32); }
            callback(null, Object.assign(base, {
                source: source, inherited_from: from, acpi: [], resolved: [],
                allowed: allowed, code: allowed ? '1' : '0', decided_by: 'default_policy',
                acp_ri: null, field: null, acr_index: null,
                trace: { decided_by: 'default_policy', policy: policy, cr_match: false },
                warnings: warnings
            }));
        }

        function finish(source, from, acpi_list) {
            var given = acpi_list.slice();

            // Fold the notation exactly as the real evaluation path does (make_internal_ri) and nothing more. sri-form entries are not resolved; they go into the IN as they are and show up as dangling, which is what the real path does.
            var folded = db_sql.fold_acpi_list(given);
            lookup_rows(folded);
            function lookup_rows(wanted) {
            db_sql.select_acp_in(connection, wanted, function (err3, rows2) {
                if (err3) { return callback(err3, rows2); }

                var have = {};
                (rows2 || []).forEach(function (r) { have[r.ri] = r; });

                var resolved = wanted.map(function (w, i) {
                    var exists = !!have[w];
                    if (!exists) {
                        warn(warnings, 'dangling', w,
                            '이 ACP 가 없다 — 잠금이 풀려 생성자만 통과한다');
                    }
                    return { given: given[i], ri: w, exists: exists };
                });

                var use_rows = rows2 || [];
                if (Array.isArray(p.acpRowsOverride)) {
                    // Evaluate with bodies that are not stored yet, ordered by ri ascending like select_acp_in.
                    use_rows = p.acpRowsOverride.slice().sort(function (a, b) {
                        return String(a.ri) < String(b.ri) ? -1 : (String(a.ri) > String(b.ri) ? 1 : 0);
                    });
                }

                use_rows.forEach(function (r) {
                    var body = r[field];
                    var obj = security._parse_acp_rule(body, field, r.ri);
                    if (obj === null) {
                        warn(warnings, 'parse_error', r.ri, field + ' 를 읽을 수 없어 이 ACP 를 건너뛴다');
                        return;
                    }
                    if (!obj.hasOwnProperty('acr')) {
                        warn(warnings, 'pv_no_acr', r.ri,
                            field + ' 에 acr 이 없어 여기서 평가가 끝난다 — 뒤 ACP 는 보지 않는다');
                    }
                });

                var verdict = security._evaluate_acp_rows(
                    use_rows, fake_request(connection, p, target.ri),
                    cr, access_value, field, opt.use_ra, opt.cr_fallback);

                callback(null, Object.assign(base, {
                    source: source, inherited_from: from,
                    acpi: wanted, resolved: resolved,
                    allowed: verdict.code === '1', code: verdict.code,
                    decided_by: verdict.trace.decided_by,
                    acp_ri: verdict.trace.acp_ri,
                    field: field,
                    acr_index: verdict.trace.acr_index,
                    trace: verdict.trace,
                    warnings: warnings
                }));
            });
            }
        }
    });
};

var MATRIX_ORIGINS = 20;
var MATRIX_OPS = 7;          // all of OPS
var MATRIX_MAX = 120;

/** Evaluates an origins x operations matrix in one call. Each cell calls simulate again, so the target and ACP rows are re-read per cell; the matrix is capped at 20 origins x 7 operations = 120 cells. */
exports.simulate_many = function (connection, params, callback) {
    var p = params || {};
    var origins = p.origins || [];
    var ops = p.ops || ['RETRIEVE'];
    if (origins.length === 0) {
        return callback(true, { code: 'BAD_PARAMS', message: 'origins 가 필요하다' });
    }
    // Never truncate silently; the caller must know when it asked for more than the cap.
    if (origins.length > MATRIX_ORIGINS || ops.length > MATRIX_OPS ||
        origins.length * ops.length > MATRIX_MAX) {
        return callback(true, { code: 'TOO_MANY',
            message: 'origins 는 ' + MATRIX_ORIGINS + '개, ops 는 ' + MATRIX_OPS +
                     '개, 곱은 ' + MATRIX_MAX + ' 이하여야 한다' });
    }

    var jobs = [];
    origins.forEach(function (o) {
        ops.forEach(function (op) { jobs.push({ origin: o, op: op }); });
    });

    var matrix = [];
    var seen_warn = {};
    var warnings = [];
    // Values describing the resource itself (ty, cr, found) and the acpi source are collected separately.
    var head = null;      // resource itself: same in every result
    var src = null;       // acpi source: read only from a result that actually resolved acpi
    var i = 0;

    // Superuser and creator are decided before acpi is resolved; their results carry source 'none' and acpi [], which means 'not needed', not 'no ACP'.
    function resolved_acpi(r) {
        return r && r.found !== false &&
               r.decided_by !== 'superuser' && r.decided_by !== 'creator';
    }

    function next() {
        if (i >= jobs.length) {
            var out = {
                ri: p.ri,
                ty: head ? head.ty : null,
                cr: head ? head.cr : null,
                found: head ? head.found : false,
                matrix: matrix,
                warnings: warnings
            };
            if (src) {
                out.source = src.source;
                out.inherited_from = src.inherited_from || null;
                out.acpi = src.acpi;
                out.resolved = src.resolved;
            }
            else {
                // Every cell was decided as superuser or creator, so the acpi source is unknown. It is reported as null rather than 'none' so inheritance warnings are not lost.
                out.source = null;
                out.inherited_from = null;
                out.acpi = null;
                out.resolved = null;
                if (head && head.found !== false) {
                    warnings.push({ rule: 'source_unknown', acp_ri: null,
                        message: '모든 원본이 수퍼유저·생성자로 단축 판정돼 acpi 출처를 확인하지 못했다 — ' +
                                 '출처를 보려면 그 둘이 아닌 원본을 하나 넣는다' });
                }
            }
            return callback(null, out);
        }
        var job = jobs[i++];
        exports.simulate(connection, {
            ri: p.ri, origin: job.origin, op: job.op, ip: p.ip,
            acpiOverride: p.acpiOverride, acpRowsOverride: p.acpRowsOverride
        }, function (err, r) {
            if (err) { return callback(err, r); }
            if (head === null) { head = r; }
            // Regardless of order, the first result that actually resolved acpi is the source.
            if (src === null && resolved_acpi(r)) { src = r; }
            if (r.found === false) {
                matrix.push({ origin: job.origin, op: job.op, found: false });
            }
            else {
                matrix.push({ origin: job.origin, op: job.op, allowed: r.allowed,
                              code: r.code, decided_by: r.decided_by, acp_ri: r.acp_ri });
                (r.warnings || []).forEach(function (w) {
                    var key = w.rule + '|' + w.acp_ri;
                    if (!seen_warn[key]) { seen_warn[key] = 1; warnings.push(w); }
                });
            }
            setImmediate(next);
        });
    }

    next();
};

exports._OPS = OPS;
exports._access_value_of = access_value_of;
exports._fold = parse_acpi;
