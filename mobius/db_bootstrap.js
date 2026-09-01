'use strict';
// 기동 시 **즉시 끝나는** 마이그레이션만 자동으로 적용한다.
//
// ── 무엇을 푸는 문제인가 ────────────────────────────────────────────────
// MySQL 을 새로 설치하고 Mobius 를 띄우면 지금 배포와 상태가 달라진다.
// 스키마는 다르지 않다 — mobiusdb.sql 이 마이그레이션 결과와 같게 만들고,
// test/schema-drift.test.js 가 그것을 양방향으로 강제한다. SQLite 도
// 다르지 않다 — PRAGMA 를 connect 마다 건다.
//
// **딱 하나가 다르다: MySQL 서버 설정.** 그 값들은 conf.json 이 아니라 DB
// 서버 자신에 있어서 스키마 파일이 만들 수 없다. 그래서 새 설치는 내구성이
// 꺼진 채로, 격리수준이 다른 채로 뜬다.
//
// 사람이 명령을 한 번 치게 하는 방법은 쓰지 않는다 — 치는 것을 잊으면
// 그 설치는 영영 다른 상태로 남고, 무엇이 다른지 아무도 모른다.
//
// ── 왜 set_tuning 의 반복이 아닌가 ──────────────────────────────────────
// 예전 set_tuning 은 **기동마다** SET GLOBAL 로 값을 덮어썼다. 운영자가
// my.cnf 에 적어 둔 값을 앱이 조용히 뒤집었고, 그래서 지워졌다(f4e26ec).
//
// 여기는 다르다. 마이그레이션은 **한 번만** 돌고 schema_migrations 에
// 기록된다. 그 뒤 운영자가 값을 바꾸면 그대로 둔다 — 다시 덮어쓰지 않는다.
// "설치할 때 한 번" 과 "기동마다" 의 차이다.
//
// ── 왜 전부가 아니라 즉시 끝나는 것만인가 ───────────────────────────────
// 마이그레이션 001 은 배포에서 **20.6분** 걸렸다(lookup 5,740만 행에 인덱스).
// 그런 것이 기동 경로에서 돌면 재기동이 20분 멈춘다. 그래서 각 마이그레이션이
// autoApply 로 스스로 밝히고, 밝히지 않은 것은 여기서 절대 돌지 않는다.
//
// 남은 것은 로그로 알린다 — 조용히 넘어가면 "왜 안 도나" 를 알 수 없다.

var migrate = require('../tools/migrate');
var db = require('./db');

// 마스터에서만 돈다. 워커 24개가 동시에 같은 마이그레이션을 적용하려 들면
// schema_migrations 의 PK 가 충돌하고, 그중 하나만 이기고 나머지는 에러를
// 낸다. 기동 로그가 그 에러로 덮인다.
exports.run = function (callback) {
    var all;
    try {
        all = migrate.loadMigrations();
    }
    catch (e) {
        console.error('[db_bootstrap] 마이그레이션을 읽지 못했다: ' + ((e && e.message) || e));
        return callback(null);   // 기동을 막지 않는다
    }

    db.getConnection(function (code, connection) {
        if (code !== '200' || !connection) {
            // 커넥션이 없으면 그냥 넘어간다. DB 연결 실패는 app.js 가
            // 자기 방식으로 다룬다 — 여기서 기동을 막으면 원인이 가려진다.
            console.error('[db_bootstrap] 커넥션을 못 얻어 건너뛴다');
            return callback(null);
        }

        var ctx = { db: db, conn: connection, backend: global.usedb || 'mysql' };

        function finish(err) {
            db.release(connection);
            if (err) {
                console.error('[db_bootstrap] ' + ((err && err.message) || err));
            }
            callback(null);   // 어떤 경우에도 기동은 계속한다
        }

        migrate.ensureTable(ctx, function (terr) {
            if (terr) { return finish(terr); }

            migrate.appliedIds(ctx, function (aerr, applied) {
                if (aerr) { return finish(aerr); }

                var pending = migrate.pending(all, applied || [], ctx.backend);
                if (pending.length === 0) { return finish(null); }

                var auto = pending.filter(function (m) { return m.autoApply === true; });
                var manual = pending.filter(function (m) { return m.autoApply !== true; });

                if (manual.length > 0) {
                    // 시간이 오래 걸릴 수 있는 것들이다. 자동으로 돌리지 않는다.
                    console.log('[db_bootstrap] 적용되지 않은 마이그레이션 ' +
                                manual.length + '개 — 자동 적용 대상이 아니다:');
                    manual.forEach(function (m) { console.log('    ' + m.id); });
                    console.log('    적용하려면: node tools/migrate.js --apply ' + ctx.backend);
                }

                if (auto.length === 0) { return finish(null); }

                console.log('[db_bootstrap] 즉시 끝나는 마이그레이션 ' +
                            auto.length + '개를 적용한다');
                migrate.apply(ctx, auto, function (aerr2) { finish(aerr2); });
            });
        });
    });
};
