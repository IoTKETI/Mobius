'use strict';
// tm / tr 테이블 제거.
//
// ── 왜 지우나 ────────────────────────────────────────────────────────────
// tm(ty=38, <transactionMgmt>) 과 tr(ty=39, <transaction>) 은 oneM2M 의 분산
// 트랜잭션(2단계 커밋)이다. tm 이 조정자로 rqps 에 담긴 요청들을
// LOCK -> EXECUTE -> COMMIT 순서로 진행시키고, 대상마다 tr 이 붙는다.
//
// 쓰는 배포가 없고, 실제로 동작한 적도 없다.
//   - tr 의 trsp_action 은 xml 분기가 항상 던지고(파싱된 객체에 JSON.parse),
//     cbor 분기는 비어 있어 콜백이 사라졌다.
//   - 로컬에서 tm 을 만들면 request_lock 이 하위 요청을 정확한 경로·포트로
//     보내는 것까지는 확인되나 완결되지 않고 400-37 로 끝난다.
//   - tools/ 와 test/ 어디에도 tm/tr 시나리오가 없다.
//
// 걷어내면서 모든 CRUD 요청이 무조건 하던 tr.check 조회도 함께 사라졌다 —
// 요청당 DB 왕복 1회다.
//
// ── 순서가 중요하다 ──────────────────────────────────────────────────────
// 둘 다 lookup(ri) 에 ON DELETE CASCADE 외래키가 걸려 있다.
//
//   CONSTRAINT `tm_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`)
//     ON DELETE CASCADE ON UPDATE CASCADE
//   CONSTRAINT `tr_ri` ... (같음)
//
// 그래서 lookup 의 ty=38/39 행을 지우면 tm/tr 행이 따라 사라진다. 반대로
// 테이블을 먼저 DROP 하면 lookup 에 고아 행이 남는다 — discovery 에는 안
// 잡히지만(ty_list 에서 뺐다) URI 를 알면 조회되고, 조회하면 이제 없는
// 테이블을 읽으려 든다.
//
// 따라서 (1) lookup 정리 -> (2) DROP TABLE 순이다. 003 과 같은 이유다.
//
// ── 되돌리기 ─────────────────────────────────────────────────────────────
// 테이블 구조는 mobiusdb.sql 의 git 이력에 있다. 다만 **행은 돌아오지 않는다.**
// 이 마이그레이션은 데이터를 지운다 — 되돌릴 수 없는 유일한 부분이다.
// 그 행들이 무엇인지는 위에 적었다: 한 번도 완결된 적 없는 트랜잭션 기록이다.
//
// ── SQLite 는 왜 대상이 아닌가 ───────────────────────────────────────────
// mobiusdb_sqlite.sql 에 tm/tr 테이블이 애초에 없다. SQLite 모드에서는
// ty=38/39 가 resource.js 의 check_db_support 에 걸려 생성 자체가 막혔다.

// 한 번에 지우는 행 수. lookup 은 배포에서 5,740만 행짜리 테이블이라
// 한 문장으로 지우면 그동안 행 락을 오래 붙잡는다.
var DELETE_BATCH = 1000;

// DROP TABLE 은 배타 MDL 을 잡는다. 대기를 짧게 끊고 여러 번 시도한다 —
// 대기가 길수록 그 테이블에 들어오는 질의가 줄을 선다.
var LOCK_WAIT_SEC = 5;
var MAX_ATTEMPTS = 20;
var RETRY_WAIT_MS = 15000;

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

function countLookupRows(ctx, cb) {
    ctx.db.run(
        ctx.db.raw("select count(*) as n from lookup where ty in ('38', '39')"),
        ctx.conn,
        function (err, rows) {
            if (err) { return cb(err, rows); }
            cb(null, (rows && rows[0]) ? parseInt(rows[0].n, 10) : 0);
        });
}

module.exports = {
    id: '008-drop-tm-tr-tables',
    description: 'tm / tr 테이블 제거 — 트랜잭션 리소스를 지원하지 않는다',
    backends: ['mysql'],

    // 읽기 전용. --check 가 보여 줄 현재 상태.
    inspect: function (ctx, cb) {
        tableExists(ctx, 'tm', function (err, hasTm) {
            if (err) { return cb(err, null); }
            tableExists(ctx, 'tr', function (err2, hasTr) {
                if (err2) { return cb(err2, null); }
                countLookupRows(ctx, function (err3, n) {
                    if (err3) { return cb(err3, null); }
                    if (!hasTm && !hasTr && n === 0) {
                        return cb(null, '이미 없음 — 적용하면 이력만 남긴다');
                    }
                    var t = [];
                    if (hasTm) { t.push('tm'); }
                    if (hasTr) { t.push('tr'); }
                    cb(null, (t.length ? t.join('/') + ' 테이블 있음' : '테이블 없음') +
                        ', lookup 의 ty=38/39 행 ' + n + '개' +
                        (n > 0 ? ' (지운다 — 되돌릴 수 없다)' : ''));
                });
            });
        });
    },

    up: function (ctx, cb) {
        // (1) lookup 의 ty=38/39 행을 나눠서 지운다.
        //     FK CASCADE 로 tm/tr 행도 함께 간다.
        function purge(total) {
            ctx.db.run(
                ctx.db.raw("delete from lookup where ty in ('38', '39') limit " + DELETE_BATCH),
                ctx.conn,
                function (err, res) {
                    if (err) { return cb(err, res); }
                    var n = (res && res.affectedRows) || 0;
                    total += n;
                    if (n === DELETE_BATCH) {
                        console.log('    (lookup 의 ty=38/39 ' + total + '행 삭제, 계속)');
                        return purge(total);
                    }
                    if (total > 0) {
                        console.log('    lookup 의 ty=38/39 ' + total +
                                    '행 삭제 (tm/tr 행은 FK CASCADE 로 함께 삭제)');
                    }
                    dropNext(0, total);
                },
                { timeoutMs: 0 });
        }

        // (2) 두 테이블을 차례로 지운다.
        var TABLES = ['tr', 'tm'];

        function dropNext(at, purged) {
            if (at >= TABLES.length) {
                return cb(null, { affectedRows: purged });
            }
            var name = TABLES[at];

            tableExists(ctx, name, function (err, exists) {
                if (err) { return cb(err, exists); }
                if (!exists) {
                    console.log('    (' + name + ' 테이블이 이미 없다 — 넘어간다)');
                    return dropNext(at + 1, purged);
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
                var sql = (name === 'tr') ? 'DROP TABLE tr' : 'DROP TABLE tm';
                ctx.db.run(
                    ctx.db.raw(sql),
                    ctx.conn,
                    function (derr, dres) {
                        if (!derr) {
                            console.log('    ' + name + ' 테이블을 지웠다');
                            return dropNext(at + 1, purged);
                        }
                        var lockBusy = dres &&
                            (dres.driverCode === 'ER_LOCK_WAIT_TIMEOUT' || dres.errno === 1205);
                        if (!lockBusy) { return cb(derr, dres); }
                        if (n >= MAX_ATTEMPTS) {
                            console.log('    (' + MAX_ATTEMPTS + '번 모두 잠금 대기로 실패했다. ' +
                                        'lookup 정리는 이미 반영됐고 테이블만 남았다 — 다시 돌리면 된다)');
                            return cb(derr, dres);
                        }
                        console.log('    (' + name + ' 잠금 대기 ' + n + '/' + MAX_ATTEMPTS + ' — ' +
                                    (RETRY_WAIT_MS / 1000) + '초 뒤 재시도)');
                        setTimeout(function () { attempt(n + 1); }, RETRY_WAIT_MS);
                    },
                    { timeoutMs: 0 });
            }
        }

        purge(0);
    }
};
