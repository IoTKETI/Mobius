'use strict';
// acp_audit: change history of ACPs and acpi.
//
// The acp table has no cr column, so nothing records who created an ACP, and a changed acpi loses its old value. The admin console is a separate process and cannot read the worker's in-memory acp_observe.snapshot(), so this table is its only history source.
//
// A new table: no large table is touched; CREATE TABLE IF NOT EXISTS completes at once.
//
// Pruning is not automatic (no periodic registration in app.js), as for orphan and expiry cleanup; sql_action.prune_acp_audit does it on request.
//
// Rollback:
//   DROP TABLE acp_audit;

var TABLE = 'acp_audit';

var MYSQL_DDL =
    'create table if not exists `acp_audit` (\n' +
    '  `id` bigint unsigned not null auto_increment,\n' +
    '  `ts` varchar(21) not null,\n' +
    '  `op` varchar(16) not null,\n' +
    '  `ri` varchar(200) character set utf8 collate utf8_bin not null,\n' +
    '  `ty` int unsigned not null,\n' +
    '  `origin` varchar(45) default null,\n' +
    '  `cr` varchar(45) default null,\n' +
    '  `before_val` text,\n' +
    '  `after_val` text,\n' +
    '  primary key (`id`),\n' +
    '  key `idx_acp_audit_ri` (`ri`),\n' +
    '  key `idx_acp_audit_ts` (`ts`)\n' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8';

var SQLITE_DDL =
    'create table if not exists acp_audit (\n' +
    '  id integer primary key autoincrement,\n' +
    '  ts text not null,\n' +
    '  op text not null,\n' +
    '  ri text not null,\n' +
    '  ty integer not null,\n' +
    '  origin text,\n' +
    '  cr text,\n' +
    '  before_val text,\n' +
    '  after_val text\n' +
    ')';

var SQLITE_IDX = [
    'create index if not exists idx_acp_audit_ri on acp_audit (ri)',
    'create index if not exists idx_acp_audit_ts on acp_audit (ts)'
];

// timeoutMs: 0, as in 004: the driver must not give up before the server finishes the DDL. This DDL completes at once; the convention is kept.
function ddl(ctx, sql, cb) {
    ctx.db.run(ctx.db.raw(sql), ctx.conn, cb, { timeoutMs: 0 });
}

// The runner supplies the backend name: tools/migrate.js and mobius/db_bootstrap.js fill ctx.backend. A migration knowing the backend name is expected (backends: ['mysql', 'sqlite'] declares it, and emitting per-backend DDL is this file's job); it is not read from a global selector.
function isSqlite(ctx) {
    return ctx.backend === 'sqlite';
}

module.exports = {
    id: '007-acp-audit-table',
    description: 'acp_audit 테이블 — ACP 와 acpi 변경 이력 (acp 에 cr 컬럼이 없어 다른 근거가 없다)',
    backends: ['mysql', 'sqlite'],

    inspect: function (ctx, cb) {
        if (isSqlite(ctx)) {
            ctx.db.run(
                ctx.db.raw("select count(*) as n from sqlite_master where type='table' and name=?", [TABLE]),
                ctx.conn,
                function (err, rows) {
                    if (err) { return cb(err, rows); }
                    var has = !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0);
                    cb(null, has ? '이미 있음 — 적용하면 이력만 남긴다' : '없음 — 새 테이블 하나를 만든다');
                });
            return;
        }
        ctx.db.run(
            ctx.db.raw('select count(*) as n from information_schema.tables ' +
                       'where table_schema = database() and table_name = ?', [TABLE]),
            ctx.conn,
            function (err, rows) {
                if (err) { return cb(err, rows); }
                var has = !!(rows && rows[0] && parseInt(rows[0].n, 10) > 0);
                cb(null, has ? '이미 있음 — 적용하면 이력만 남긴다'
                             : '없음 — 새 테이블 하나를 만든다 (큰 테이블을 건드리지 않는다)');
            });
    },

    up: function (ctx, cb) {
        if (!isSqlite(ctx)) {
            return ddl(ctx, MYSQL_DDL, cb);
        }
        // SQLite creates the indexes separately.
        ddl(ctx, SQLITE_DDL, function (err, r) {
            if (err) { return cb(err, r); }
            var i = 0;
            (function next() {
                if (i >= SQLITE_IDX.length) { return cb(null, r); }
                ddl(ctx, SQLITE_IDX[i++], function (err2, r2) {
                    if (err2) { return cb(err2, r2); }
                    next();
                });
            })();
        });
    }
};
