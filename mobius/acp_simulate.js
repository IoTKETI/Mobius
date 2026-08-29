'use strict';
// ACP 시뮬레이터 — "이 원본이 이 리소스에 이 연산을 하면 어떻게 되나".
//
// 운영에서 가장 큰 고통은 **걸어 보기 전에는 뭐가 막힐지 모른다**는 것이다.
// 그렇다고 실제로 걸어 보면 그 사이 운영이 멈춘다. 관리 콘솔은 별도 프로세스이고
// 쓰기 origin 이 수퍼유저라, HTTP 로 왕복해도 정책을 원리적으로 검증할 수 없다
// (security.js 가 수퍼유저를 무조건 통과시킨다).
//
// 그래서 판정만 돌려준다. **security.js 의 evaluate_acp_rows 를 그대로 쓴다** —
// 두 번째 사본을 만들면 언젠가 갈라지고, 그러면 "미리 본 결과" 를 믿을 수 없다.
//
// acpiOverride / acpRowsOverride 가 "잠그기 전에 미리 본다" 를 성립시킨다.
// 아직 저장하지 않은 ACP 본문으로도 물어볼 수 있다.

var db_sql = require('./sql_action');
var security = require('./security');

// oneM2M acop 비트. sub 생성은 CREATE(1)+RETRIEVE(2) 라 '3' 이다(app.js 와 같다).
var OPS = {
    CREATE: '1', CREATE_SUB: '3', RETRIEVE: '2', UPDATE: '4',
    DELETE: '8', NOTIFY: '16', DISCOVERY: '32'
};

// 상속 탐색이 올라가는 타입. select_acp_cnt 와 같은 조건이다.
var INHERITS = { '3': 1, '4': 1, '23': 1, '33': 1 };

function access_value_of(op) {
    if (op === undefined || op === null) { return OPS.RETRIEVE; }
    var key = String(op).toUpperCase();
    if (OPS.hasOwnProperty(key)) { return OPS[key]; }
    // access_value 를 그대로 준 경우
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

// security.js 가 request 에서 읽는 것만 채운 합성 객체.
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
 * 한 조합을 판정한다.
 *
 * @param params {
 *   ri, origin, op,
 *   ip=null,                  // acip 판정용. null 이면 127.0.0.1
 *   acpiOverride=null,        // 저장된 acpi 대신 이것으로 본다
 *   acpRowsOverride=null      // 아직 저장하지 않은 ACP 본문으로 본다
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
        // ae 와 cb 는 cr 컬럼이 없다. app.js 의 resolve_cr 과 같은 규칙을 쓴다.
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

        // 어떤 acpi 로 볼 것인가.
        var field = (ty === '1') ? 'pvs' : 'pv';
        var use_ra = (ty !== '1');
        var cr_fallback = (ty !== '1');

        // acpiOverride 가 **빈 배열**이면 "이 ACP 를 떼면 어떻게 되나" 를 묻는
        // 것이다. 그때는 저장된 acpi 가 비었을 때와 똑같은 갈래를 타야 한다 —
        // 상속을 찾고, 없으면 기본 정책이다.
        //
        // 예전에는 빈 배열도 override 갈래로 보내 select_acp_in 에 빈 목록을
        // 넘겼고, 행이 없으니 no_acp_row(생성자만 통과)로 답했다. 실제로는
        // 기본 정책이라 **전원에게 열리는데** 미리보기는 "다 잠긴다" 고 했다.
        // 미리보기가 안전한 쪽이 아니라 **위험한 쪽으로** 틀렸다.
        //   실측: acpi 를 실제로 비우면 제3자 GET 200, 그런데 override:[] 는 거부.
        var overridden = Array.isArray(p.acpiOverride);
        if (overridden && p.acpiOverride.length > 0) {
            finish('override', null, p.acpiOverride);
            return;
        }

        // override 로 비운 경우에도 "저장된 acpi 가 비었다" 와 같게 본다.
        var own = overridden ? [] : parse_acpi(target.acpi);
        // 어디서 온 판정인지는 화면에 남아야 한다. 뗐다고 가정한 결과와
        // 지금 그대로의 결과를 구분하지 못하면 미리보기의 뜻이 사라진다.
        var src_own = overridden ? 'override' : 'own';
        var src_none = overridden ? 'override' : 'none';

        if (ty === '1' && own.length === 0) {
            // ACP 자신은 자기 pvs 로 판정한다. 이건 acpi 와 무관하므로
            // override 로 비워도 그대로다.
            finish(src_own, null, [target.ri]);
            return;
        }
        if (own.length > 0) {
            finish(src_own, null, own);
            return;
        }
        if (INHERITS[ty]) {
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
            // acpi 가 아무 데도 없다. security_default_check_action 과 같은 식.
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

            // **실제 판정 경로와 같게 표기를 먼저 푼다.**
            // security_check_action 은 make_internal_ri 로 접고 get_ri_list_sri 로
            // sri 를 ri 로 바꾼 뒤 조회한다. 그 단계를 건너뛰면 절대·SP상대·sri
            // 표기로 저장된 **정상 참조가 전부 dangling 으로 보인다** — 콘솔의
            // 첫 화면이 "이 ACP 가 없다" 고 거짓말을 하게 된다.
            var folded = db_sql.fold_acpi_list(given);
            var need = folded.filter(function (v) { return typeof v === 'string' && v.charAt(0) !== '/'; });

            if (need.length === 0) { return lookup_rows(folded); }
            db_sql.resolve_acpi_entries(connection, need, function (errR, res) {
                if (errR) { return callback(errR, res); }
                var map = (res && res.map) ? res.map : {};
                lookup_rows(folded.map(function (v) { return map[v] || v; }));
            });

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
                    // 아직 저장하지 않은 본문으로 본다. 순서는 select_acp_in 과
                    // 같게 ri 오름차순으로 맞춘다.
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
                    cr, access_value, field, use_ra, cr_fallback);

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
var MATRIX_OPS = 7;          // OPS 전부
var MATRIX_MAX = 120;

/**
 * 원본 × 연산 조합을 한 번에 본다. 대상 행과 ACP 행은 한 번만 읽는다.
 */
exports.simulate_many = function (connection, params, callback) {
    var p = params || {};
    var origins = p.origins || [];
    var ops = p.ops || ['RETRIEVE'];
    if (origins.length === 0) {
        return callback(true, { code: 'BAD_PARAMS', message: 'origins 가 필요하다' });
    }
    // 조용히 잘라내지 않는다. 그러면 화면이 물어본 것보다 적은 결과를 보여
    // 주면서 그 사실을 말하지 않는다 — 권한 판정에서 가장 나쁜 실패다.
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
    // 리소스 자체를 말하는 값(ty, cr, found)과 **acpi 출처**를 나눠서 모은다.
    var head = null;      // 리소스 자체 — 어느 결과에서 읽어도 같다
    var src = null;       // acpi 출처 — acpi 를 실제로 푼 결과에서만 읽는다
    var i = 0;

    // 수퍼유저와 생성자는 acpi 를 풀기 전에 단축 판정된다. 그 결과에는
    // source 가 'none', acpi 가 [] 로 들어 있는데 그건 "이 리소스에 ACP 가
    // 없다" 가 아니라 "볼 필요가 없었다" 는 뜻이다.
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
                // 모든 조합이 수퍼유저·생성자로 단축 판정됐다. acpi 출처를
                // **모른다** — 'none' 으로 적으면 "ACP 가 없다" 로 읽히고,
                // 그러면 상속 경고가 통째로 사라진다. 컨테이너 acpi 가
                // 조상을 덮어쓴다는 사실을 알리는 것이 그 경고인데,
                // 관리자가 자기 장치 ID 를 첫 칸에 적었다는 이유만으로
                // 사라지면 안 된다.
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
            // 순서와 무관하게, acpi 를 실제로 푼 첫 결과를 출처로 삼는다.
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
