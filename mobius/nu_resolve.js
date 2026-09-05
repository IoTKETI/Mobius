'use strict';
/**
 * 구독 nu 목록의 ID 형 항목을 보낼 주소(URL)로 푼다 — 질의 3번.
 *
 * 옛 sgn.js 의 get_nu_arr 은 nu 하나씩 재귀하며 ID 형마다 질의 2번(get_ri_sri →
 * select_resource_from_url)을 순차로 냈다. 이 파일은 같은 판정을 세 단계로 한다:
 *   1) 순수 분류 — URL 은 그대로, ID 는 옛 규칙대로 절대 경로와 첫 세그먼트 계산
 *   2) 질의 — get_ri_sri_in 한 번, select_resources_in 한 번(+ 나온 타입 수)
 *   3) 순수 재조립 — 원래 순서대로. ID 는 poa URL 들로(여럿이면 여럿), 못 풀면 뺀다
 *
 * 옛 판정 그대로: 매치 행이 없으면 뺀다. 프로토콜 없는 poa 는 localhost:7579 +
 * 절대 경로. 끝 '/' 는 뗀다. 로그 문구도 같다 — "[noti] fail - sub=… nu=… (…)".
 * 옛 코드에서 ri 매치와 sri 매치가 둘 다 있을 때 어느 행을 쓰는지는 DB 순서에 달린
 * 미정의였다. 여기서는 ri 매치를 먼저 쓴다.
 * 배치 질의가 실패하면 ID 항목 전부를 "DB 오류" 로 빼고 URL 항목은 보낸다 — 옛 코드도
 * 오류 상황에서는 nu 마다 같은 오류를 만났다.
 *
 * 배포에는 ID 형 nu 가 0 이라(2026-09-05 실측, 구독 3,463개 전부 mqtt URL) 오늘 실익은
 * 없다. 구조적 정확성(구독당 2M 왕복 → 3)이 목적이다. 남은 일 §5.6-1.
 *
 * sgn_man 을 끌어오지 않는다 — 그래서 시험이 이 파일을 로드할 수 있다
 * (sgn.js 는 require 만으로 MQTT 클라이언트가 열린다).
 */
var url = require('url');
var db_sql = require('./sql_action');
var poa_util = require('./poa');

// 옛 get_nu_arr 의 ID 판정과 접기 그대로. URL 이면 null.
function classify(nu) {
    if (url.parse(nu).protocol != null) { return null; }
    var absolute_url = nu.replace(usespid + usecseid + '/', '/').replace(usecseid + '/', '/');
    if (absolute_url.charAt(0) != '/') { absolute_url = '/' + absolute_url; }
    var seg_raw = absolute_url.split('/')[1];              // 쿼리가 붙어 있을 수 있다
    return { absolute_url: absolute_url, seg_raw: seg_raw, sri: seg_raw.split('?')[0] };
}

/**
 * @param connection  DB 핸들 (ID 형이 하나도 없으면 쓰지 않는다)
 * @param nu_arr      구독의 nu 목록
 * @param sub_ri      로그 역추적용 구독 ri
 * @param callback    callback(resolved) — URL 문자열 배열. 원래 순서, ID 는 늘어나거나 빠진다
 */
exports.resolve = function (connection, nu_arr, sub_ri, callback) {
    var items = nu_arr.map(function (nu) { return { nu: nu, id: classify(String(nu)), ri: null, out: null }; });
    var ids = items.filter(function (it) { return it.id; });

    function fail(it, why) {
        console.error('[noti] fail - sub=' + (sub_ri || '?') + ' nu=' + it.nu + ' (' + why + ')');
        it.out = [];
    }
    function finish() {
        var out = [];
        items.forEach(function (it) {
            if (!it.id) { out.push(it.nu); }
            else if (it.out) { Array.prototype.push.apply(out, it.out); }
        });
        callback(out);
    }
    if (ids.length === 0) { finish(); return; }

    db_sql.get_ri_sri_in(connection, ids.map(function (it) { return it.id.sri; }), function (err, rows) {
        if (err) {
            ids.forEach(function (it) { fail(it, 'nu 해석 중 DB 오류'); });
            finish();
            return;
        }
        var map = {};
        (rows || []).forEach(function (r) { if (!(r.sri in map)) { map[r.sri] = r.ri; } });
        ids.forEach(function (it) {
            // 옛 코드: absolute_url.replace('/' + <첫 세그먼트, 쿼리 포함>, <ri>)
            if (it.id.sri in map) {
                it.id.absolute_url = it.id.absolute_url.replace('/' + it.id.seg_raw, map[it.id.sri]);
            }
            it.ri = it.id.absolute_url.split('?')[0];
        });

        db_sql.select_resources_in(connection,
            ids.map(function (it) { return it.ri; }),
            ids.map(function (it) { return it.id.sri; }),
            function (err2, found) {
                if (err2) {
                    ids.forEach(function (it) { fail(it, '받을 리소스 조회 중 DB 오류'); });
                    finish();
                    return;
                }
                ids.forEach(function (it) {
                    var row = null;
                    for (var i = 0; i < found.length && !row; i++) { if (found[i].ri === it.ri) { row = found[i]; } }
                    for (var j = 0; j < found.length && !row; j++) { if (found[j].sri === it.id.sri) { row = found[j]; } }
                    if (!row) { fail(it, '받을 리소스가 없다: ' + it.ri); return; }

                    var poa_arr = poa_util.parse(row.poa, '[sgn_action] ' + it.ri);
                    if (poa_arr === null || poa_arr.length === 0) { fail(it, '받을 리소스에 poa 가 없다: ' + it.ri); return; }

                    it.out = poa_arr.map(function (p) {
                        if (url.parse(p).protocol == null) { return 'http://localhost:7579' + it.id.absolute_url; }
                        return (p.charAt(p.length - 1) == '/') ? p.slice(0, -1) : p;
                    });
                });
                finish();
            });
    });
};
