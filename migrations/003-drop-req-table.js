'use strict';
// req 테이블 제거.
//
// ── 왜 지우나 ────────────────────────────────────────────────────────────
// req(ty=17, <request>)는 논블로킹 요청(rt=1/2)의 임시 기록이었다. 논블로킹은
// 절반만 구현돼 있었다 — req 리소스를 만들고 202 를 돌려주지만 정작 요청한
// 연산은 수행하지 않아, 클라이언트가 영영 채워지지 않을 결과를 기다렸다.
//
// 지원하지 않기로 하고 만드는 경로를 전부 걷어냈다(app.js 의
// check_request_query_rt 가 405-4 로 막고, ty=17 직접 POST 는 405-2 가 막는다).
// 이제 이 테이블에는 새 행이 들어오지 않는다.
//
// ── 순서가 중요하다 ──────────────────────────────────────────────────────
// req 는 lookup(ri) 에 ON DELETE CASCADE 외래키가 걸려 있다.
//
//   CONSTRAINT `req_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`)
//     ON DELETE CASCADE ON UPDATE CASCADE
//
// 그래서 lookup 의 ty=17 행을 지우면 req 행이 따라 사라진다. 반대로 테이블을
// 먼저 DROP 하면 lookup 에 ty=17 행이 고아로 남는다 — 그 행은 discovery 에
// 안 잡히지만(ty_list 에서 '17' 을 뺐다) URI 를 알면 조회되고, 조회하면
// 이제 없는 테이블을 읽으려 든다.
//
// 따라서 (1) lookup 정리 -> (2) DROP TABLE 순이다.
//
// ── 되돌리기 ─────────────────────────────────────────────────────────────
// 테이블 구조는 mobiusdb.sql 의 git 이력에 있다. 다만 **행은 돌아오지 않는다.**
// 이 마이그레이션은 데이터를 지운다 — 되돌릴 수 없는 유일한 부분이다.
// 그 행들이 무엇인지는 위에 적었다: 결과가 채워지지 않는 논블로킹 요청 기록이다.
//
// ── SQLite 는 왜 대상이 아닌가 ───────────────────────────────────────────
// mobiusdb_sqlite.sql 에 req 테이블이 애초에 없다. SQLite 모드에서는 ty=17 이
// resource.js 의 check_db_support 에 걸려 생성 자체가 막혔다.

// 한 번에 지우는 행 수. lookup 은 배포에서 5,740만 행짜리 테이블이라
// 한 문장으로 지우면 그동안 행 락을 오래 붙잡는다.
var DELETE_BATCH = 1000;

// DROP TABLE 은 배타 MDL 을 잡는다. 002 와 같은 이유로 한 번의 대기를 짧게
// 끊고 여러 번 시도한다 — 대기가 길수록 그 테이블에 들어오는 질의가 줄을 선다.
var LOCK_WAIT_SEC = 5;
var MAX_ATTEMPTS = 20;
var RETRY_WAIT_MS = 15000;

function tableExists(ctx, cb) {
    ctx.db.run(
        ctx.db.raw(
            'select count(*) as n from information_schema.tables ' +
            'where table_schema = database() and table_name = ?', ['req']),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0));
        });
}

function countLookupRows(ctx, cb) {
    ctx.db.run(
        ctx.db.raw("select count(*) as n from lookup where ty = '17'"),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows && rows[0]) ? parseInt(rows[0].n, 10) : 0);
        });
}

module.exports = {
    id: '003-drop-req-table',
    description: 'req 테이블 제거 — 논블로킹 미지원으로 더 이상 쓰이지 않는다',
    backends: ['mysql'],

    // 읽기 전용. --check 가 보여 줄 현재 상태.
    inspect: function (ctx, cb) {
        tableExists(ctx, function (err, exists) {
            if (err) { return cb(err, null); }
            countLookupRows(ctx, function (err2, n) {
                if (err2) { return cb(err2, null); }
                if (!exists && n === 0) {
                    return cb(null, '이미 없음 — 적용하면 이력만 남긴다');
                }
                cb(null, (exists ? 'req 테이블 있음' : 'req 테이블 없음') +
                    ', lookup 의 ty=17 행 ' + n + '개' +
                    (n > 0 ? ' (지운다 — 되돌릴 수 없다)' : ''));
            });
        });
    },

    up: function (ctx, cb) {
        // (1) lookup 의 ty=17 행을 나눠서 지운다. FK CASCADE 로 req 행도 함께 간다.
        function purge(total) {
            ctx.db.run(
                ctx.db.raw("delete from lookup where ty = '17' limit " + DELETE_BATCH),
                ctx.conn,
                function (err, res) {
                    if (err) { return cb(err, res); }
                    var n = (res && res.affectedRows) || 0;
                    total += n;
                    if (n === DELETE_BATCH) {
                        console.log('    (lookup 의 ty=17 ' + total + '행 삭제, 계속)');
                        return purge(total);
                    }
                    if (total > 0) {
                        console.log('    lookup 의 ty=17 ' + total + '행 삭제 (req 행은 FK CASCADE 로 함께 삭제)');
                    }
                    dropTable(total);
                },
                { timeoutMs: 0 });
        }

        function dropTable(purged) {
            tableExists(ctx, function (err, exists) {
                if (err) { return cb(err, exists); }
                if (!exists) {
                    console.log('    (req 테이블이 이미 없다 — 이력만 남긴다)');
                    return cb(null, { affectedRows: purged });
                }
                ctx.db.run(ctx.db.raw('SET SESSION lock_wait_timeout = ' + LOCK_WAIT_SEC),
                    ctx.conn, function (serr, sres) {
                        if (serr) { return cb(serr, sres); }
                        attempt(1);
                    });
            });

            function attempt(n) {
                // 테이블 이름은 리터럴로 쓴다 — test/schema-drift.test.js 가
                // 마이그레이션 소스를 정규식으로 읽어 mobiusdb.sql 과 대조한다.
                ctx.db.run(
                    ctx.db.raw('DROP TABLE req'),
                    ctx.conn,
                    function (derr, dres) {
                        if (!derr) {
                            console.log('    req 테이블을 지웠다');
                            return cb(null, { affectedRows: purged });
                        }
                        var lockBusy = dres &&
                            (dres.driverCode === 'ER_LOCK_WAIT_TIMEOUT' || dres.errno === 1205);
                        if (!lockBusy) { return cb(derr, dres); }
                        if (n >= MAX_ATTEMPTS) {
                            console.log('    (' + MAX_ATTEMPTS + '번 모두 잠금 대기로 실패했다. ' +
                                        'lookup 정리는 이미 반영됐고 테이블만 남았다 — 다시 돌리면 된다)');
                            return cb(derr, dres);
                        }
                        console.log('    (잠금 대기 ' + n + '/' + MAX_ATTEMPTS + ' — ' +
                                    (RETRY_WAIT_MS / 1000) + '초 뒤 재시도)');
                        setTimeout(function () { attempt(n + 1); }, RETRY_WAIT_MS);
                    },
                    { timeoutMs: 0 });
            }
        }

        purge(0);
    }
};
