'use strict';
// cb.srt 를 varchar(100) -> varchar(255) 로 넓힌다.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// srt(supportedResourceType)는 CSEBase 가 클라이언트에게 "내가 다루는 리소스
// 타입" 을 알리는 목록이다. 그런데 코드가 손으로 적은 부분집합을 쓰고 있었다:
//
//   srt      ['1','2','3','4','5','9','10','13','14','16','23']          11개
//   ty_list  위 + ['24','27','28','91'..'98']                            22개
//
// 즉 smd(24) / mms(27) / fcnt(28) / hd_*(91~98) 는 **실제로 만들 수 있는데
// 광고를 안 하고 있었다.** 클라이언트가 목록을 믿으면 쓸 수 있는 것을 안 쓴다.
//
// 그래서 srt 를 ty_list 하나로 통일하는데, 그러면 직렬화 길이가 넘친다:
//
//   현재 값   ["1","2",...,"23"]                    50자   varchar(100) 안에 들어감
//   ty_list   ["1","2",...,"97","98"]              105자   **넘친다**
//
// 배포 sql_mode 에 STRICT_TRANS_TABLES 가 있어 조용히 잘리는 대신 에러가 난다.
// 어느 쪽이든 CSEBase 갱신이 실패한다 — csr.poa 가 varchar(200) 을 넘겨 깨진
// JSON 이 됐던 것과 같은 종류다.
//
// 255 로 잡으면 지금 105자에 타입 30개쯤 더 들어갈 여유가 있다.
// test/removed-types.test.js 가 스키마의 선언 폭과 ty_list 직렬화 길이를
// 대조하므로, 타입을 더 넣다가 넘치면 테스트에서 먼저 걸린다.
//
// ── 위험 ─────────────────────────────────────────────────────────────────
// cb 는 1행짜리 테이블이라 즉시 끝난다. 넓히는 것이라 기존 값은 그대로다.
//
// 되돌리려면:
//   ALTER TABLE cb MODIFY srt varchar(100) NOT NULL;
//   (단, 그 전에 srt 값이 100자 이하인지 확인할 것)

var TARGET = 'varchar(255)';

function currentType(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select column_type as t from information_schema.columns ' +
            'where table_schema = database() and table_name = ? and column_name = ?',
            ['cb', 'srt']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows && rows[0]) ? String(rows[0].t) : null);
        });
}

module.exports = {
    id: '009-widen-cb-srt',
    description: 'cb.srt 를 varchar(255) 로 넓힌다 — srt 를 ty_list 로 통일하면 105자가 된다',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        currentType(ctx, function (err, t) {
            if (err) { return cb(err, null); }
            if (t === null) { return cb(null, 'cb.srt 컬럼이 없다'); }
            if (t.toLowerCase() === TARGET) {
                return cb(null, '이미 ' + TARGET + ' — 적용하면 이력만 남긴다');
            }
            ctx.db.run(ctx.db.raw('select char_length(srt) as n from cb'), ctx.conn,
                function (err2, rows) {
                    if (err2) { return cb(err2, rows); }
                    var n = (rows && rows[0]) ? rows[0].n : '?';
                    cb(null, '지금 ' + t + ', 저장된 값 ' + n + '자 — ' + TARGET +
                        ' 로 넓힌다 (cb 는 1행이라 즉시 끝난다)');
                });
        });
    },

    up: function (ctx, cb) {
        currentType(ctx, function (err, t) {
            if (err) { return cb(err, t); }
            if (t !== null && t.toLowerCase() === TARGET) {
                console.log('    (이미 ' + TARGET + ' 이다 — 넘어간다)');
                return cb(null, { affectedRows: 0 });
            }
            // 넓히는 변경이라 INPLACE / LOCK=NONE 으로 돈다.
            // timeoutMs: 0 — 004 와 같은 이유(드라이버가 먼저 끊으면 러너와
            // 서버 상태가 어긋난다). 이 DDL 은 1행이라 즉시 끝난다.
            ctx.db.run(
                ctx.db.raw('ALTER TABLE cb MODIFY srt varchar(255) NOT NULL, ' +
                           'ALGORITHM=INPLACE, LOCK=NONE'),
                ctx.conn, cb, { timeoutMs: 0 });
        });
    }
};
