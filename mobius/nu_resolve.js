'use strict';
/**
 * Resolves the ID-form entries of a subscription's nu list into delivery URLs using three queries in total:
 *   1) pure classification: URLs stay as they are; IDs get their absolute path and first segment
 *   2) queries: get_ri_sri_in once, select_resources_in once
 *   3) pure reassembly in the original order: an ID becomes its poa URLs (one or more), unresolved IDs are dropped
 *
 * A poa without protocol becomes http://localhost:7579 + absolute path; a trailing '/' is removed. When the batch query fails every ID entry is dropped with a log line and URL entries are still delivered. Does not load sgn_man.
 */
var url = require('url');
var db_sql = require('./sql_action');
var poa_util = require('./poa');

// ID detection and folding. Returns null for URLs.
function classify(nu) {
    if (url.parse(nu).protocol != null) { return null; }
    var absolute_url = nu.replace(usespid + usecseid + '/', '/').replace(usecseid + '/', '/');
    if (absolute_url.charAt(0) != '/') { absolute_url = '/' + absolute_url; }
    var seg_raw = absolute_url.split('/')[1];              // may carry a query string
    return { absolute_url: absolute_url, seg_raw: seg_raw, sri: seg_raw.split('?')[0] };
}

/**
 * @param connection  DB handle (unused when there is no ID entry)
 * @param nu_arr      the subscription's nu list
 * @param sub_ri      subscription ri for the log line
 * @param callback    callback(resolved): array of URL strings in the original order; IDs may expand or drop out
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
            // Replace '/' + <first segment, query included> with the resolved ri.
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
