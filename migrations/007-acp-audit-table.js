'use strict';
// acp_audit — ACP 와 acpi 변경 이력.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// "누가 어떻게 acp 를 설정했는지 알 수도 없는 노릇" 이 실제로 맞다.
//
//   - acp 테이블에는 cr 컬럼이 없다. ACP 를 누가 만들었는지 어디에도 없다.
//     (cr 컬럼이 있는 테이블: cin cnt fcnt grp lcp mgo mms nod req smd sub
//      tm tr ts tsi — acp 와 ae 는 없다. 배포 서버 information_schema 로 확인)
//   - acpi 를 바꾸면 옛 값이 사라진다. 삭제와 달리 "목록을 다시 조회하면
//     드러난다" 가 성립하지 않아 되돌릴 근거가 없다.
//
// 그리고 관리 콘솔은 **별도 프로세스**라 워커 메모리의 acp_observe.snapshot()
// 을 읽을 수 없다. 이 테이블이 콘솔의 유일한 이력 창구다.
//
// ── 왜 큰 ALTER 가 아닌가 ────────────────────────────────────────────────
// 새 테이블이다. 배포의 lookup(5,740만 행)이나 cin(1억4,560만 행)을 건드리지
// 않는다. CREATE TABLE IF NOT EXISTS 한 문장이고 즉시 끝난다.
//
// ── 정리는 자동으로 하지 않는다 ──────────────────────────────────────────
// app.js 에 주기 등록을 넣지 않는다. 고아 정리·만료 정리와 같은 관례다 —
// 되돌릴 수 없는 삭제는 관리자가 목록을 보고 정한다.
// sql_action.prune_acp_audit 이 그 자리를 맡는다.
//
// 되돌리려면:
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

// timeoutMs: 0 — 004 와 같은 이유다. 드라이버가 먼저 끊으면 러너는 실패로
// 보고하는데 서버는 DDL 을 끝내는 어긋난 상태가 된다. 이 DDL 은 즉시
// 끝나지만 관례를 지킨다.
function ddl(ctx, sql, cb) {
    ctx.db.run(ctx.db.raw(sql), ctx.conn, cb, { timeoutMs: 0 });
}

// 러너가 이미 알려 준다 — tools/migrate.js 와 mobius/db_bootstrap.js 가
// ctx.backend 를 채워서 넘긴다.
//
// 여기 `global.usesqlite === 'true'` 라고 적혀 있었다. 두 가지가 틀렸다.
// 하나는 파사드 밖에서 선택자를 직접 읽는 것이고(코어가 백엔드를 아는 자리),
// 다른 하나는 그 전역이 **불리언**이라는 것이다 — 백엔드를 둘까지밖에 못
// 말하므로 세 번째가 붙으면 'false' 가 'mysql' 을 뜻하게 되어 틀린 답을 낸다.
//
// 마이그레이션이 백엔드 **이름**을 아는 것 자체는 정상이다. 바로 위
// backends: ['mysql', 'sqlite'] 가 이미 이름으로 선언하고 있고, 백엔드마다
// 다른 DDL 을 내는 것이 이 파일의 일이다. 문제는 그 이름을 어디서 얻느냐였다.
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
        // SQLite 는 인덱스를 따로 만든다.
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
