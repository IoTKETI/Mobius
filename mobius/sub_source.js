'use strict';
/**
 * 알림을 어느 구독들에 보낼 것인가 — 원천은 sub 테이블이다.
 *
 * 예전에는 부모 lookup 행의 subl(구독 사본 JSON)을 읽었다. 그 사본을 지키는 장치
 * (트랜잭션 잠금 · 되만드는 도구 · 감사의 불신)가 통째로 있었고, 그래도 어긋났다 —
 * 유령 9,475건. 스펙: docs/superpowers/specs/2026-09-05-notification-routing-source-design.md
 *
 * 규칙은 둘뿐이다.
 *   - 생성(3)·갱신(1)·자식 삭제(4): sub where pi = 구독이 붙은 리소스(parentObj).ri
 *     sgn.check 호출 넷의 parentObj 가 전부 "구독이 붙은 리소스 자신" 이라 질의가 하나다.
 *   - 구독 삭제(128): 지워진 구독 자신. FK CASCADE 로 행이 이미 없으므로 묻지 않는다.
 *     (옛 코드는 사본에 아직 남은 그 구독과 **형제 구독 전부**에 sud 를 보냈다 —
 *     형제에게 가던 것은 실수였고, 배포에 su 설정 구독은 0 이라 영향이 없다.)
 *
 * 행의 nu·enc 는 insert_sub 가 넣은 JSON 문자열이다 — 발송기(subl_entry.read)가 푼다.
 * sgn_man 을 끌어오지 않는다 — 시험이 로드할 수 있다.
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
            // 알림은 fire-and-forget 이다. 여기서 재시도하면 아픈 DB 를 더 아프게 한다.
            console.error('[sgn] 구독 조회 실패 — 이 알림을 건너뛴다: 부모=' + parentObj.ri +
                          ' ' + db_errors.text(rows));
            callback([]);
            return;
        }
        callback(rows || []);
    });
};
