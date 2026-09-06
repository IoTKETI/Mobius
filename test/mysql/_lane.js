'use strict';
// MySQL 시험 레인의 공통 조각 (요청 흐름 남은 일 §7.1).
//
// npm test 는 MySQL 없이 돌아야 해서 MySQL 용 SQL 을 실행하지 않았다 — 문장의 모양만 봤다.
// 그 빈틈으로 purge_sweep 결함과 2026-09-06 의 콜레이션 캐스트(discovery 30초 타임아웃)가
// 운영에서 터졌다. 이 레인은 **같은 서버의 별도 DB**(mobiusdb_test)에 mobius/db/mobiusdb.sql 로
// 스키마를 새로 깔고, 질의를 실제로 실행하고, EXPLAIN 으로 인덱스 사용을 본다.
//
//   npm run test:mysql          로컬·배포 서버 어디서든 MySQL 이 있으면. 없으면 실패한다 — 조용히 건너뛰지 않는다.
//
// 접속: conf.json 의 dbpass, localhost:3306 root (어댑터와 같다). DB 이름은 어댑터의 conf 키 dbName.
//
// ── 안전장치 ─────────────────────────────────────────────────────────────
// 스키마 파일은 DROP TABLE 로 시작한다. 잘못 연결되면 개발·운영 DB 를 비운다. 그래서
// (1) DB 이름은 반드시 _test 로 끝나야 하고, (2) 파괴적인 일을 하기 전에 `select database()`
// 로 그 이름을 다시 확인한다.

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2');

const ROOT = path.join(__dirname, '..', '..');
const DB_NAME = 'mobiusdb_test';
const HOST = 'localhost', PORT = 3306, USER = 'root';

function dbpass() {
    const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'conf.json'), 'utf8'));
    if (typeof conf.dbpass !== 'string') { throw new Error('conf.json 에 dbpass 가 없다'); }
    return conf.dbpass;
}

function rawConnection(database) {
    return mysql.createConnection({ host: HOST, port: PORT, user: USER, password: dbpass(),
        database: database, multipleStatements: true, charset: 'UTF8_GENERAL_CI' });
}

function q(conn, sql, args) {
    return new Promise((res, rej) => conn.query({ sql, values: args, timeout: 120000 }, (e, r) => (e ? rej(e) : res(r))));
}

// 시험 DB 를 스키마 파일로 새로 만든다. 기존 것은 통째로 지운다 — 이름 검사 뒤에만.
async function fresh() {
    if (!/_test$/.test(DB_NAME)) { throw new Error('시험 DB 이름이 _test 로 끝나지 않는다: ' + DB_NAME); }
    const admin = rawConnection(undefined);
    try {
        await q(admin, 'DROP DATABASE IF EXISTS `' + DB_NAME + '`');
        await q(admin, 'CREATE DATABASE `' + DB_NAME + '` DEFAULT CHARACTER SET utf8mb3');
    } finally { admin.end(); }

    const c = rawConnection(DB_NAME);
    try {
        const which = (await q(c, 'select database() as d'))[0].d;
        if (which !== DB_NAME) { throw new Error('연결된 DB 가 ' + which + ' 다 — 스키마를 깔지 않는다'); }
        const schema = fs.readFileSync(require(path.join(ROOT, 'mobius', 'db', 'mysql.js')).schemaPath, 'utf8');
        await q(c, schema);
        const tables = await q(c, "select table_name t from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE'", [DB_NAME]);
        if (tables.length < 10) { throw new Error('스키마를 깔았는데 표가 ' + tables.length + '개뿐이다'); }
        return tables.map((r) => r.t || r.T).sort();
    } finally { c.end(); }
}

// 코어 파사드를 시험 DB 로 연결한다. 호출부가 다 쓰면 close() 를 부른다.
function facade() {
    const DB = path.join(ROOT, 'mobius', 'db');
    delete require.cache[require.resolve(DB)];
    delete require.cache[require.resolve(path.join(DB, 'mysql.js'))];
    global.usedb = 'mysql';
    const db = require(DB);
    db.applyConf({ dbpass: dbpass(), dbName: DB_NAME });
    return new Promise((resolve, reject) => {
        db.connect((rsc) => {
            if (rsc !== '1') { return reject(new Error('파사드 연결 실패 ' + rsc)); }
            db.getConnection((code, conn) => {
                if (code !== '200') { return reject(new Error('커넥션 획득 실패 ' + code)); }
                // 파괴적인 시험 전에 한 번 더 — 파사드가 정말 시험 DB 를 보는가
                db.run(db.raw('select database() as d'), conn, (err, rows) => {
                    if (err) { return reject(new Error('database() 확인 실패')); }
                    const d = rows[0].d || rows[0].D;
                    if (d !== DB_NAME) { return reject(new Error('파사드가 ' + d + ' 에 붙었다 — dbName 이 안 먹는다')); }
                    resolve({ db, conn, close: () => new Promise((done) => { try { db.release(conn); } catch (e) { /* */ } require(path.join(DB, 'mysql.js')).end(() => done()); }) });
                });
            });
        });
    });
}

// 어댑터를 가로채되 **실제로 실행하고** 문장도 기록한다 — 스텁 시험의 tap 과 반대다.
function recordingTap() {
    const adapter = require(path.join(ROOT, 'mobius', 'db', 'mysql.js'));
    const seen = [];
    const real = adapter.execute;
    adapter.execute = function (conn, sql, bindings, cb, opts) {
        seen.push({ sql, bindings });
        return real.call(adapter, conn, sql, bindings, cb, opts);
    };
    return { seen, restore: () => { adapter.execute = real; } };
}

module.exports = { ROOT, DB_NAME, rawConnection, q, fresh, facade, recordingTap, dbpass };
