'use strict';
// MySQL 서버 튜닝 네 값을 SET PERSIST 로 고정한다.
//
// ── 왜 마이그레이션인가 ──────────────────────────────────────────────────
// 이 값들은 스키마가 아니다. 그런데 **새로 설치한 서버가 이 값을 갖게 하는
// 자리**가 저장소에 여기밖에 없다. my.cnf 는 배포마다 다르고 root 로 파일을
// 고쳐야 하지만, SET PERSIST 는 DB 접속만으로 되고 mysqld-auto.cnf 에 적혀
// 재기동을 넘어 살아남는다. 마이그레이션 러너가 이미 root 로 붙으므로
// 권한도 맞고, 적용 여부가 schema_migrations 에 남아 두 번 돌지 않는다.
//
// ── 왜 이 값인가 ────────────────────────────────────────────────────────
// 예전에는 sql_action.js 의 set_tuning 이 **기동마다** SET GLOBAL 로 네 값을
// 덮어썼다(f4e26ec 로 제거). 운영자가 my.cnf 에 적어 둔 값을 앱이 조용히
// 뒤집고 있었고, 그 값은 내구성과 정합성을 팔아 쓰기 성능을 사는 쪽이었다.
//
// 그렇게 한 이유는 DB 가 느리고 커넥션 풀이 말라 서버가 멈춰서였다. 그런데
// 멈춤의 원인은 이 네 값 어디에도 없었다 — mysql 드라이버의 queueLimit=0 이
// 만드는 **타임아웃 없는 무한 큐**였다(mobius/db/mysql.js 주석 참고).
// 풀이 마르던 원인들(커넥션 누수, discovery N+1, 30초 점유 질의)도 그동안
// 고쳐졌다. 배포 실측 Max_used_connections = 59 다.
//
// 그래서 판 것을 도로 산다. 배포 실측(2026-09-01, 적용 직후):
//
//   insert_cin  중앙값 2.31ms / p90 3.25ms / p99 5.66ms   (400건 표본)
//   Innodb_row_lock_time_avg 0,  Innodb_log_waits 0
//
// 내구성을 켰는데 성능 영향이 없다. 25.9건/초 부하에서 fsync 는 병목이 아니다.
//
//   innodb_flush_log_at_trx_commit  0 -> 1
//       0 은 커밋을 1초마다 모아서 굳힌다. 이 코드에는 유실을 흡수할 장치가
//       하나도 없다 — 복제 슬레이브 없음, CIN 생성이 트랜잭션을 안 써서
//       유실이 문장 단위로 찢어짐(lookup 은 남고 cin 만 사라지는 고아),
//       고아 정리는 주기 실행이 아니라 관리자가 손으로 돌린다.
//       그 고아를 GET .../la 하면 404 가, 직접 조회하면 con 이 빠진 200 이 나간다.
//
//   transaction_isolation  READ-UNCOMMITTED -> REPEATABLE-READ
//       되돌리는 비용을 코드에서 한 건도 찾지 못했다. 트랜잭션을 여는 곳이
//       네 군데뿐이고 전부 문장 2개짜리라 장시간 트랜잭션이 없다.
//       **이미 열린 커넥션에는 안 먹는다** — Mobius 를 재기동해야 풀의
//       커넥션이 새 값으로 바뀐다.
//
//   max_connections  -> 800
//       앱 요구는 dbConnectionLimit x 프로세스 수다. 권장값 25 x 25 = 625 이고
//       800 은 그 위 여유다. 이 값을 낮출 때는 dbConnectionLimit 과 **반드시
//       같이** 봐야 한다 — 따로 움직이면 어긋남만 커진다.
//
//   sync_binlog  0 그대로
//       시점 복구는 "기준 백업 + binlog" 로만 성립하는데 백업 절차가 저장소에
//       없고 복제 슬레이브도 없다. 지킬 대상이 없는데 요청당 fsync 4~5회를
//       내는 셈이라 지금은 0 이 맞다. **백업을 만들거나 복제를 붙이면 그때
//       1 로 바꿔야 한다** — flush_log=1 과 겹칠 때만 절단점이 일치한다.
//
// ── 되돌리려면 ──────────────────────────────────────────────────────────
//   RESET PERSIST innodb_flush_log_at_trx_commit;   (등)
// **주의: RESET PERSIST 는 실행 중인 값을 되돌리지 않는다.** mysqld-auto.cnf
// 에서 항목만 지운다. 지금 값을 바꾸려면 SET GLOBAL 을 따로 불러야 하고,
// transaction_isolation 은 그것도 이미 열린 커넥션에는 안 먹는다.

var WANT = {
    innodb_flush_log_at_trx_commit: '1',
    transaction_isolation: 'REPEATABLE-READ',
    max_connections: '800'
};

// 값이 문자열인 것만 따옴표로 감싼다. 숫자에 따옴표를 씌우면 MySQL 이
// 거부하지는 않지만 persisted_variables 에 그대로 남아 대조가 지저분해진다.
function literal(name, value) {
    return (name === 'transaction_isolation') ? ("'" + value + "'") : value;
}

function current(ctx, cb) {
    ctx.db.run(ctx.db.raw(
        "select variable_name as n, variable_value as v" +
        " from performance_schema.global_variables" +
        " where variable_name in ('innodb_flush_log_at_trx_commit'," +
        " 'transaction_isolation','max_connections','sync_binlog')"),
        ctx.conn, function (err, rows) {
            if (err) { return cb(err, rows); }
            var got = {};
            (rows || []).forEach(function (r) { got[r.n] = String(r.v); });
            cb(null, got);
        });
}

module.exports = {
    id: '010-server-durability',
    description: '내구성·격리수준·접속 상한을 SET PERSIST 로 고정 (새 설치가 같은 값으로 뜨게)',
    backends: ['mysql'],

    inspect: function (ctx, cb) {
        current(ctx, function (err, got) {
            if (err) { return cb(err, null); }
            var lines = [];
            Object.keys(WANT).forEach(function (k) {
                var now = got[k];
                lines.push(now === WANT[k]
                    ? ('  ' + k + ' 이미 ' + WANT[k])
                    : ('  ' + k + ' ' + now + ' -> ' + WANT[k]));
            });
            lines.push('  sync_binlog ' + got.sync_binlog + ' (그대로 둔다)');
            lines.push('  * transaction_isolation 은 이미 열린 커넥션에 안 먹는다 —' +
                       ' Mobius 재기동이 필요하다');
            cb(null, '\n' + lines.join('\n'));
        });
    },

    up: function (ctx, cb) {
        var names = Object.keys(WANT);
        var applied = 0;

        (function next(i) {
            if (i >= names.length) {
                return cb(null, { affectedRows: applied });
            }
            var k = names[i];
            // SET PERSIST 는 바인딩을 받지 않는다(변수 이름이 자리표가 될 수
            // 없다). 값은 이 파일의 상수뿐이라 클라이언트 입력이 섞이지 않는다.
            ctx.db.run(ctx.db.raw('SET PERSIST ' + k + ' = ' + literal(k, WANT[k])),
                ctx.conn, function (err, res) {
                    if (err) {
                        // SYSTEM_VARIABLES_ADMIN 이 없으면 여기서 걸린다.
                        // 무엇이 모자란지 알려 준다 — 그냥 실패하면 원인을 모른다.
                        console.error('    ' + k + ' 실패: ' +
                            ((res && (res.sqlMessage || res.message)) || res));
                        console.error('    SET PERSIST 에는 SYSTEM_VARIABLES_ADMIN 과 ' +
                            'PERSIST_RO_VARIABLES_ADMIN 이 필요하다');
                        return cb(err, res);
                    }
                    applied++;
                    console.log('    ' + k + ' = ' + WANT[k]);
                    next(i + 1);
                });
        })(0);
    }
};
