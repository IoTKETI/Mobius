'use strict';
// Shared piece of the MySQL test lane.
//
// npm test runs without MySQL and only inspects statement shapes. This lane installs the schema from mobius/db/mobiusdb.sql into a separate DB (mobiusdb_test) on the same server, executes the queries for real, and checks index use with EXPLAIN.
//
//   npm run test:mysql          wherever MySQL is available. Without MySQL it fails; it does not skip silently.
//
// Connection: dbpass from conf.json, localhost:3306 root (same as the adapter). The DB name is the adapter's conf key dbName.
//
// Safety: the schema file starts with DROP TABLE, so a wrong connection would empty a development or production DB. Therefore (1) the DB name must end in _test, and (2) `select database()` re-checks the name before anything destructive.

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

// Recreates the test DB from the schema file. The existing one is dropped wholesale, only after the name check.
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

// Connects the core facade to the test DB. The caller calls close() when done.
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
                // One more check before a destructive test: the facade really points at the test DB.
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

// Intercepts the adapter but executes for real and records the statements; the opposite of the stub tests' tap.
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
