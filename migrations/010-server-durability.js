'use strict';
// Fixes two MySQL server settings with SET PERSIST.
//
// These are not schema, but this is the only place in the repository where a newly installed server receives them. my.cnf differs per deployment and needs root file access; SET PERSIST works over a DB connection, is written to mysqld-auto.cnf and survives restarts. The migration runner connects as root, and the ledger keeps it from running twice.
//
//   innodb_flush_log_at_trx_commit  1
//       Every commit is flushed. Nothing in this code absorbs a lost commit: there is no replica, CIN creation is not transactional (a loss could leave a lookup row without its cin), and orphan cleanup is manual.
//
//   transaction_isolation  REPEATABLE-READ
//       Transactions are opened in four places, each two statements long, so there are no long transactions. The change does not apply to already open connections; Mobius must be restarted for the pool to pick it up.
//
//   sync_binlog  stays 0
//       Point-in-time recovery needs a base backup plus binlog, and neither a backup procedure nor a replica exists. Set it to 1 when a backup or replication is added.
//
// Rollback:
//   RESET PERSIST innodb_flush_log_at_trx_commit;   (etc.)
// RESET PERSIST only removes the entry from mysqld-auto.cnf; it does not change the running value. Use SET GLOBAL for that, and transaction_isolation still does not reach open connections.

// max_connections is not here. Its default (151) is dangerous for this application, and a migration runs once, so it could not repair a lost value; mobius/db_bootstrap.js checks the floor at every boot and raises it when short. One owner only.
//
// The two values below already match their defaults (1 / REPEATABLE-READ), so a lost value is not dangerous and one application suffices.
var WANT = {
    innodb_flush_log_at_trx_commit: '1',
    transaction_isolation: 'REPEATABLE-READ'
};

// Only string values are quoted; a quoted number is accepted but stays quoted in persisted_variables.
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
    // The values this migration sets. Tests read this to check that max_connections did not return (comments cannot be filtered by regex).
    _WANT: WANT,

    id: '010-server-durability',
    description: '내구성·격리수준·접속 상한을 SET PERSIST 로 고정 (새 설치가 같은 값으로 뜨게)',
    backends: ['mysql'],

    // Safe to apply automatically at boot: SET PERSIST statements complete at once regardless of data volume. Migrations that build indexes on large tables must not carry this flag, because boot would stall for that long.
    //
    // Only migrations with this flag are applied by mobius/db_bootstrap.js at boot. Once applied it is recorded in schema_migrations and not repeated, so a value later changed by the operator is not overwritten.
    autoApply: true,

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
            // Not set here, but shown because this is where the operator looks at the state; mobius/db_bootstrap.js checks it at every boot.
            lines.push('  max_connections ' + got.max_connections +
                       ' / 필요 ' + require('../mobius/pool_sizing').currentFloor() +
                       ' (기동 시 db_bootstrap 이 모자라면 올린다)');
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
            // SET PERSIST takes no bindings (a variable name cannot be a placeholder). The values are constants of this file; no client input is involved.
            ctx.db.run(ctx.db.raw('SET PERSIST ' + k + ' = ' + literal(k, WANT[k])),
                ctx.conn, function (err, res) {
                    if (err) {
                        // Fails here without SYSTEM_VARIABLES_ADMIN; the missing privilege is named.
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
