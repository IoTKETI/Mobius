'use strict';
// lookup 에 cs / cnf 컬럼을 더한다. 값은 채우지 않는다 — 012 가 채운다.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// discovery 의 sza / szb / cty 는 cin 의 컬럼(cs, cnf)을 본다. 그런데 discovery
// 자체는 lookup 인덱스를 훑으면서 거른다. 그래서 이 세 필터만 후보마다 cin 을
// 한 번씩 찾아가야 하고, cin 은 249GB 에 PRIMARY 가 곧 행이라 한 건 확인하려고
// 평균 1.7KB 를 읽는다.
//
// 배포 실측 (limit 5만, 같은 부모 3개):
//
//   cin 조인 + cs 필터        콜드 209ms / 웜 193ms
//   lookup 컬럼으로 필터       콜드 65.7ms / 웜 65.5ms
//   필터 없음(기준선)          68.9ms
//
// **lookup 컬럼으로 거르는 것은 기준선과 같다.** 어차피 읽고 있는 행을 CPU 로
// 한 번 보는 것뿐이라 사실상 공짜다. 조인은 그 3배다.
//
// 같은 문제를 ct 로 한 번 풀었다. /la 는 배포 트래픽의 28%(1,318만 건)인데
// pi, ty 로 찾은 뒤 ct 로 정렬해야 해서 filesort 였고, ct 를 인덱스에 넣어
// 해결했다. 이것은 그 처방을 sza / szb / cty 에 적용한 것이다.
//
// ── 왜 INSTANT 인가 ─────────────────────────────────────────────────────
// MySQL 8.0.12 부터 행 끝에 컬럼을 더하는 것은 테이블을 다시 쓰지 않는다.
// 배포는 8.0.46 이다. lookup 이 6,190만 행 / 22.2GB 인데도 즉시 끝난다.
//
// **ALGORITHM=INSTANT 를 명시한다.** 안 적으면 서버가 조건이 안 맞을 때
// 조용히 INPLACE 나 COPY 로 떨어져 테이블을 통째로 다시 쓴다. 명시하면
// 그 경우 에러가 나므로, 우리가 모르는 사이에 긴 작업이 시작되지 않는다.
//
// ── 왜 값을 여기서 안 채우는가 ──────────────────────────────────────────
// 1억 4,560만 행을 갱신하는 일이라 성격이 완전히 다르다. 기동 경로에 두면
// 재기동이 몇 시간 멈춘다. 012 가 따로 맡고, 그쪽은 autoApply 가 없다.
//
// ── 되돌리려면 ──────────────────────────────────────────────────────────
//   ALTER TABLE lookup DROP COLUMN cs, DROP COLUMN cnf;
// (DROP 은 INSTANT 가 아니라 테이블을 다시 쓴다 — 되돌릴 일이 없게 할 것)

var COLS = [
    { name: 'cs',  ddl: 'add column `cs` int default null' },
    { name: 'cnf', ddl: 'add column `cnf` varchar(45) default null' }
];

function missing(ctx, cb) {
    ctx.db.run(ctx.db.raw(
        'select column_name as n from information_schema.columns' +
        " where table_schema = database() and table_name = 'lookup'" +
        " and column_name in ('cs','cnf')"),
        ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            var have = {};
            (rows || []).forEach(function (r) { have[r.n || r.N] = true; });
            cb(null, COLS.filter(function (c) { return !have[c.name]; }));
        });
}

module.exports = {
    id: '011-lookup-cin-attrs',
    description: 'lookup 에 cs / cnf 컬럼 추가 (INSTANT). 값은 012 가 채운다',
    backends: ['mysql'],

    // **기동 시 자동 적용해도 되는 마이그레이션이다.**
    //
    // INSTANT ADD COLUMN 은 데이터 양과 무관하게 즉시 끝난다 — 테이블을 다시
    // 쓰지 않고 메타데이터만 바꾼다. 010(SET PERSIST)과 같은 성격이다.
    //
    // 반대로 012(백필)는 1억 4,560만 행을 갱신하므로 이 표시를 절대 달면 안 된다.
    autoApply: true,

    inspect: function (ctx, cb) {
        missing(ctx, function (err, need) {
            if (err) { return cb(err, need); }
            if (need.length === 0) {
                return cb(null, '\n  cs / cnf 둘 다 이미 있다');
            }
            cb(null, '\n  더할 컬럼: ' + need.map(function (c) { return c.name; }).join(', ') +
                     '\n  INSTANT 라 즉시 끝난다 (테이블을 다시 쓰지 않는다)' +
                     '\n  * 값은 비어 있다 — 012 가 채우기 전까지 discovery 는 이 컬럼을 쓰지 않는다');
        });
    },

    up: function (ctx, cb) {
        missing(ctx, function (err, need) {
            if (err) { return cb(err, need); }
            if (need.length === 0) { return cb(null, { affectedRows: 0 }); }

            // 한 문장으로 둘을 더한다 — INSTANT 는 문장 단위라 나눌 이유가 없고,
            // 나누면 하나만 들어간 중간 상태가 생긴다.
            var sql = 'alter table `lookup` ' +
                need.map(function (c) { return c.ddl; }).join(', ') +
                ', algorithm=instant';

            // timeoutMs: 0 — 001·004 와 같은 이유다. 드라이버가 먼저 끊으면
            // 러너는 실패로 보고하는데 서버는 DDL 을 끝내는 어긋난 상태가 된다.
            // INSTANT 라 즉시 끝나지만 관례를 지킨다.
            ctx.db.run(ctx.db.raw(sql), ctx.conn, function (aerr, ares) {
                if (aerr) {
                    console.error('    ALTER 실패: ' +
                        ((ares && (ares.sqlMessage || ares.message)) || ares));
                    console.error('    ALGORITHM=INSTANT 를 못 쓰면 서버가 거절한다 —' +
                                  ' MySQL 8.0.12 이상인지 확인할 것');
                    return cb(aerr, ares);
                }
                console.log('    lookup 에 ' + need.map(function (c) { return c.name; }).join(', ') +
                            ' 추가 (INSTANT)');
                cb(null, { affectedRows: need.length });
            });
        });
    }
};
