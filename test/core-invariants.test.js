'use strict';
// Absence invariants over the whole core.
//
// Most source-guarding tests in this repository list files by hand. They guard 'that place' exactly, but the same code moved to a file outside the list passes silently. This test takes only what must be absent from any file and scans every tracked executable file (test/lib/sources.js). The original tests stay; the place and the evidence are there, this is the net around the list. A new invariant is one more row in the table below. `allow` names the files where the pattern legitimately lives; anywhere else it is suspect.

const test = require('node:test');
const assert = require('node:assert');
const sources = require('./lib/sources');

const INVARIANTS = [
    // ── Must not return (decisions to remove) ──
    { name: '워커별 리소스 캐시 (cache_resource_url · invalidate(request.url)) — test/no-resource-cache',
      re: /cache_resource_url|invalidate\(request\.url\)/ },
    { name: 'security.check 결과 캐시 (cache_security_check) — test/settle-helper',
      re: /cache_security_check/ },
    { name: 'AE 알림 중계 (check_ae_notify · notify_http · settle.raw(\'ae notify\')) — test/removed-paths',
      re: /check_ae_notify|notify_http|settle\.raw\('ae notify'/ },
    { name: 'WS 알림 (request_noti_ws · websocket 라이브러리) — test/removed-paths',
      re: /request_noti_ws|require\(['"]websocket['"]\)|WebSocketClient/ },
    { name: '옛 sri 생성기 (시각 + Math.random 세 자리) — test/short-ri',
      re: /YYYYMMDDHHmmssSSS'\)\s*\+\s*\(Math\.random\(\)/ },
    { name: '보조 포트 전역 (use_sgn_man_port · use_hit_man_port) — test/remaining-56',
      re: /use_sgn_man_port|use_hit_man_port/ },
    { name: '옛 MySQL 드라이버 require(\'mysql\') — test/db-mysql2-contract',
      re: /require\(['"]mysql['"]\)/, scope: 'all' },
    { name: '만료 삭제를 워커에서 스케줄 (setInterval(del_expired_resource) — test/expiry',
      re: /setInterval\s*\(\s*del_expired_resource/ },
    { name: 'morgan(\'combined\') 접근 로그 형식 — test/request-log-volume',
      re: /morgan\(\s*'combined'/ },
    { name: '요청마다 도는 계측 console.time(\'select_latest — test/request-log-volume',
      re: /console\.time\(\s*'select_latest/ },
    { name: 'MQTT 끊긴 동안 쌓기 (queueQoSZero: true) — test/sgn-connection',
      re: /queueQoSZero\s*:\s*true/ },

    // ── Where values must not come from (security, contracts) ──
    { name: '생성자(cr)를 요청 본문에서 받음 — test/creator-assignment · body-insert-table',
      re: /\.cr\s*=\s*body_Obj|body_Obj\[rootnm\]\.cr\b/ },
    { name: 'acpi 에 LIKE (5,740만 행 풀스캔) — test/acp-refs',
      re: /acpi'?\s*,\s*'like|like.{0,10}%.{0,10}acpi/i, scope: 'runtime' },
    { name: '상대에게 클라이언트 헤더를 통째로 넘김 (headers: request.headers) — test/relay-headers',
      re: /^\s*headers:\s*request\.headers\s*,?\s*$/ },
    { name: '상류 Content-Type 을 그대로 흘림 — test/relay-headers',
      re: /response\.(setHeader|header)\('Content-Type',\s*res\.headers/ },
    { name: '알림 모듈이 요청 커넥션을 씀 (request.db_connection) — test/sgn-connection',
      re: /request\.db_connection/, only: /^mobius\/(sgn|sgn_man|sub_source|nu_resolve|sub_entry)\.js$/ },

    // ── Must exist in one place only (single source) ──
    { name: '리소스 타입 표 본체 (var typeRsrc = {) 는 shape.js 에만 — test/shape',
      re: /var typeRsrc\s*=\s*\{/, allow: ['mobius/shape.js'] },
    { name: 'moduleclass 접두 문자열은 shape.js 에만 — test/shape',
      re: /org\.onem2m\.home\.moduleclass/, allow: ['mobius/shape.js'] },
    { name: 'typeRsrc 순회로 ty 를 정하는 것은 type_resolver 에만 — test/type-resolver',
      re: /for \(var key in responder\.typeRsrc\)/, allow: ['mobius/type_resolver.js'] },
    { name: '성공 응답의 배출구 respond({status:) 는 settle.js 에만 — test/responder-exit',
      re: /respond\([^)]*\{\s*status:/, allow: ['mobius/settle.js'] },
    { name: 'global.usedb / global.usespid 를 세우는 것은 conf_load 에만 — test/conf-load',
      re: /global\.(usedb|usespid)\s*=/, allow: ['mobius/conf_load.js'] },
    { name: 'shortid 는 요청 id(rqi · lease id) 용으로만 — 리소스 id 는 short_ri (test/short-ri)',
      re: /shortid'\)\.generate\(\)/, allow: ['mobius/grp.js', 'mobius/sgn.js', 'mobius/sql_action.js'] },
    { name: 'process.exit 는 진입점(app.js · mobius.js)에만 — 모듈이 exit 하면 시험 러너가 죽는다 (test/conf-load)',
      re: /process\.exit\(/, allow: ['app.js', 'mobius.js'] },
    { name: 'ACP 평가기를 따로 뺀 파일 (acp_eval) 없음 — test/acp-field-policy',
      re: /acp_eval/, scope: 'runtime' }
];

INVARIANTS.forEach(function (inv) {
    test(inv.name, function () {
        const hits = sources.grep(inv.re, { scope: inv.scope, allow: inv.allow })
            .filter((h) => !inv.only || inv.only.test(h.file));
        assert.deepStrictEqual(hits.map((h) => h.file + ':' + h.line + '  ' + h.text), [],
            '목록 밖에서 되살아났다 — 원래 시험은 이 파일을 모른다');
    });
});

test('불변식 표 자체의 건강 — 범위마다 파일이 있고, allow 는 실재하는 파일이다', function () {
    assert.ok(sources.files('core').length >= 40, 'core 파일이 ' + sources.files('core').length + '개뿐이다');
    assert.ok(sources.files('runtime').length > sources.files('core').length);
    assert.ok(sources.files('all').length > sources.files('runtime').length);
    const known = new Set(sources.files('all'));
    INVARIANTS.forEach((inv) => (inv.allow || []).forEach((f) => {
        assert.ok(known.has(f), inv.name + ' 의 allow "' + f + '" 가 추적되는 파일이 아니다 — 옮겨졌거나 지워졌다');
    }));
    // The files in allow must actually contain the pattern; otherwise allow is stale
    INVARIANTS.forEach((inv) => (inv.allow || []).forEach((f) => {
        if (!known.has(f)) { return; }
        assert.ok(inv.re.test(sources.code(f)), inv.name + ' — allow 의 ' + f + ' 에 패턴이 없다. allow 를 지워라');
    }));
});
