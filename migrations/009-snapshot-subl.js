'use strict';
// lookup.subl 을 통째로 떠 둔다. 아무것도 바꾸지 않는다 — 읽어서 복사만 한다.
//
// ── 왜 뜨나 ──────────────────────────────────────────────────────────────
// subl 은 부모 리소스에 자식 <subscription> 들을 심어 둔 JSON 배열이고,
// sgn_action 이 sub 테이블이 아니라 **이 배열**을 훑어 알림을 보낸다.
// 그런데 둘이 크게 어긋나 있다. 배포 실측(2026-08-30, CIN 을 뺀 lookup
// 34,313행 전수 대조):
//
//     subl 항목 14,028   vs   sub 행 3,452
//     유령 (subl 에만 있고 sub 행이 없다)   9,475건  -> 지금도 발송 중
//     중복 (같은 subl 에 같은 ri)          1,481묶음
//     낡은 nu (subl 과 sub 이 다르다)         194건
//     침묵 (sub 은 있는데 어느 subl 에도 없다)  21건
//
// 문제는 유령의 라우팅 정보가 **여기 말고는 없다**는 것이다. 스키마 전체에서
// nu/enc/nct/nec/exc/su/bn 컬럼을 가진 테이블은 sub 하나뿐이고, 유령은
// 정의상 sub 행이 없다. 즉 "그 구독이 어디로 무엇을 보내고 있었나" 를 아는
// 사본이 부모의 subl 문자열 단 하나다.
//
// 앞으로 subl 쓰기 경로를 손보면 배열을 통째로 되쓰게 된다. 어떤 부모든
// 구독 생성/수정/삭제가 한 번만 일어나면 그 부모의 유령은 그 순간 사라진다.
// 사라진 뒤에는 "무엇이 끊겼나" 에 답할 데이터가 없다.
//
// 그래서 손대기 **전에** 뜬다.
//
// ── FK 를 걸지 않는 이유 ─────────────────────────────────────────────────
// lookup(ri) 에 외래키를 걸면 유령의 부모가 나중에 지워질 때 스냅샷도
// ON DELETE CASCADE 로 함께 사라진다. 정확히 남기려던 것을 잃는다.
// 그래서 ri 는 그냥 varchar 다.
//
// ── 규모 ────────────────────────────────────────────────────────────────
// 대상은 subl 이 비어 있지 않은 9,996행, 7.42MB 다. CIN(ty=4)은 sub 의
// 부모가 될 수 없으므로 idx_lookup_ty 로 34,313행만 훑는다 —
// 5,740만 행짜리 lookup 전수 스캔이 아니다.
//
// ── 되돌리기 ────────────────────────────────────────────────────────────
// DROP TABLE subl_snapshot 하나면 된다. 원본은 건드리지 않았다.
// 다 쓰고 나면 지우는 것이 맞다 — 7MB 짜리 옛 사본을 영구히 들고 있을
// 이유는 없다. 유령 정리가 끝나고 관리 UI 로 확인까지 마친 뒤 지운다.

var TABLE = 'subl_snapshot';

// sub 이 붙을 수 있는 타입만. CIN 은 제외한다(자식을 못 갖는다).
var PARENT_TYPES = "('1', '2', '3', '5', '9', '14', '16', '23')";

function tableExists(ctx, name, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.tables ' +
            'where table_schema = database() and table_name = ?', [name]),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

function countSource(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            "select count(*) as n, coalesce(sum(length(subl)), 0) as bytes " +
            "  from lookup " +
            " where ty in " + PARENT_TYPES +
            "   and subl is not null and subl <> '' and subl <> '[]'"),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, rows && rows[0]
                ? { n: parseInt(rows[0].n, 10), bytes: parseInt(rows[0].bytes, 10) }
                : { n: 0, bytes: 0 });
        });
}

module.exports = {
    id: '009-snapshot-subl',
    description: 'lookup.subl 을 통째로 떠 둔다 — 유령 구독의 유일한 사본이다',
    backends: ['mysql'],

    // 읽기 전용. --check 가 보여 줄 현재 상태.
    inspect: function (ctx, cb) {
        tableExists(ctx, TABLE, function (err, exists) {
            if (err) { return cb(err, null); }
            countSource(ctx, function (err2, src) {
                if (err2) { return cb(err2, null); }
                var what = 'lookup 의 subl 이 있는 행 ' + src.n + '개 (' +
                           (src.bytes / 1048576).toFixed(2) + 'MB)';
                if (!exists) {
                    return cb(null, what + ' — ' + TABLE + ' 테이블이 없다. 만들어 복사한다');
                }
                ctx.db.run(ctx.db.raw('select count(*) as n from ' + TABLE), ctx.conn,
                    function (err3, rows) {
                        if (err3) { return cb(err3, null); }
                        var have = (rows && rows[0]) ? parseInt(rows[0].n, 10) : 0;
                        cb(null, what + ' — 이미 ' + have + '행을 떠 뒀다. 다시 적용하면 갱신한다');
                    });
            });
        });
    },

    up: function (ctx, cb) {
        // (1) 테이블. lookup(ri) 에 FK 를 걸지 않는다 — 위 주석 참고.
        //     테이블 이름은 리터럴로 쓴다: test/schema-drift.test.js 가
        //     마이그레이션 소스를 정규식으로 읽는다.
        ctx.db.run(
            ctx.db.raw(
                'CREATE TABLE IF NOT EXISTS subl_snapshot (' +
                '  `ri` varchar(200) NOT NULL,' +
                '  `ty` varchar(45) DEFAULT NULL,' +
                '  `subl` mediumtext,' +
                '  `snapped_at` varchar(15) DEFAULT NULL,' +
                '  PRIMARY KEY (`ri`)' +
                ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb3'),
            ctx.conn,
            function (err, res) {
                if (err) { return cb(err, res); }

                countSource(ctx, function (err2, src) {
                    if (err2) { return cb(err2, src); }
                    console.log('    원본 ' + src.n + '행 (' +
                                (src.bytes / 1048576).toFixed(2) + 'MB) 을 뜬다');

                    // (2) 복사. 다시 돌려도 되도록 ri 로 덮어쓴다.
                    //     한 문장이지만 대상이 9,996행이라 오래 잡지 않는다.
                    ctx.db.run(
                        ctx.db.raw(
                            'INSERT INTO subl_snapshot (ri, ty, subl, snapped_at) ' +
                            '  SELECT ri, ty, subl, ' +
                            "         DATE_FORMAT(UTC_TIMESTAMP(), '%Y%m%dT%H%i%s') " +
                            '    FROM lookup ' +
                            '   WHERE ty in ' + PARENT_TYPES +
                            "     AND subl is not null AND subl <> '' AND subl <> '[]' " +
                            '  ON DUPLICATE KEY UPDATE ' +
                            '    ty = VALUES(ty), subl = VALUES(subl), snapped_at = VALUES(snapped_at)'),
                        ctx.conn,
                        function (err3, res3) {
                            if (err3) { return cb(err3, res3); }
                            var n = (res3 && res3.affectedRows) || 0;
                            console.log('    subl_snapshot 에 ' + n + '행 반영 ' +
                                        '(ON DUPLICATE 때문에 갱신은 2로 세어진다)');
                            console.log('    다 쓰고 나면 DROP TABLE subl_snapshot 으로 지운다');
                            cb(null, { affectedRows: n });
                        },
                        { timeoutMs: 0 });
                });
            },
            { timeoutMs: 0 });
    }
};
