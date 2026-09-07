'use strict';
/**
 * Selects the subscriptions a notification goes to. The source is the sub table.
 * 
 *   - create (3), update (1), child delete (4): sub rows where pi = the resource the subscriptions are attached to (parentObj.ri)
 *   - subscription delete (128): the deleted subscription itself, passed in as notiObj
 * 
 * Row nu and enc are JSON strings written by insert_sub; sub_entry.read decodes them. This module does not load sgn_man.
 */
var db_sql = require('./sql_action');
var db_errors = require('./db/errors');

exports.rows_for = function (connection, parentObj, notiObj, check_value, callback) {
    if (check_value == 128) {
        callback([notiObj]);
        return;
    }
    db_sql.select_subs_by_pi(connection, parentObj.ri, function (err, rows) {
        if (err) {
            // Notifications are fire-and-forget; a failed lookup skips this notification instead of retrying.
            console.error('[sgn] 구독 조회 실패 — 이 알림을 건너뛴다: 부모=' + parentObj.ri +
                          ' ' + db_errors.text(rows));
            callback([]);
            return;
        }
        callback(rows || []);
    });
};
