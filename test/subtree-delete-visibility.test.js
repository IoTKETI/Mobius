'use strict';
// An interrupted subtree delete must leave a trace.
//
// Asynchronous subtree deletion responds first and removes descendants in the background. A failure midway leaves orphans, and each of delete_lookup_action, delete_lookup and delete_descendants_background must log it, so the cause (deadlock, query timeout, dropped connection) can be told apart.

const test = require('node:test');
const assert = require('node:assert');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';
global.usedb = 'mysql';

const facade = require('../mobius/db');
const db_sql = require('../mobius/sql_action');

// Intercepts facade.run and returns the desired result.
function withFacade(fake, fn) {
    const orig = facade.run;
    facade.run = fake;
    try { return fn(); }
    finally { facade.run = orig; }
}

function capture(fn) {
    const orig = console.error;
    const origLog = console.log;
    const lines = [];
    console.error = function (s) { lines.push(String(s)); };
    console.log = function () { /* success lines are not of interest */ };
    try { fn(); }
    finally { console.error = orig; console.log = origLog; }
    return lines;
}

test('삭제가 실패하면 어느 pi 에서 왜 멈췄는지 남긴다', function () {
    return new Promise(function (resolve) {
        const lines = [];
        const orig = console.error;
        const origLog = console.log;
        console.error = function (s) { lines.push(String(s)); };
        console.log = function () {};

        const fail = function (qb, conn, cb) {
            // Mimics a driver error (deadlock).
            cb(true, { driverCode: 'ER_LOCK_DEADLOCK', message: 'Deadlock found' });
        };

        withFacade(fail, function () {
            db_sql.delete_lookup(null, ['/Mobius/a', '/Mobius/b'], 0, [], 0, function (code) {
                console.error = orig;
                console.log = origLog;

                assert.notStrictEqual(code, '200', '실패는 실패로 전해져야 한다');

                const joined = lines.join('\n');
                assert.ok(/delete_lookup_action/.test(joined),
                    '어느 pi 에서 실패했는지 남아야 한다: ' + joined);
                assert.ok(/ER_LOCK_DEADLOCK/.test(joined),
                    '드라이버 코드가 남아야 원인을 가릴 수 있다: ' + joined);
                assert.ok(/delete_lookup\]/.test(joined),
                    '어디까지 가고 멈췄는지 남아야 한다: ' + joined);
                resolve();
            });
        });
    });
});

test('성공하면 실패 로그를 남기지 않는다', function () {
    return new Promise(function (resolve) {
        const ok = function (qb, conn, cb) { cb(null, { affectedRows: 1 }); };
        const lines = capture(function () {
            withFacade(ok, function () {
                db_sql.delete_lookup(null, ['/Mobius/a'], 0, [], 0, function (code) {
                    assert.strictEqual(code, '200');
                });
            });
        });
        assert.deepStrictEqual(lines, [], '정상 경로에서 에러 로그가 나오면 안 된다');
        resolve();
    });
});

test('배치 경계에서 멈춘 위치를 숫자로 남긴다', function () {
    // Deleted in batches of 32. With 33 rows and a failure in the first batch, the batch start index (0) and the total (33) must be reported; pi_index has already advanced to 32 and would overstate progress.
    return new Promise(function (resolve) {
        const list = [];
        for (let i = 0; i < 33; i++) { list.push('/Mobius/x' + i); }

        const lines = [];
        const orig = console.error;
        const origLog = console.log;
        console.error = function (s) { lines.push(String(s)); };
        console.log = function () {};

        const fail = function (qb, conn, cb) { cb(true, { driverCode: 'ER_X', message: 'x' }); };
        withFacade(fail, function () {
            db_sql.delete_lookup(null, list, 0, [], 0, function () {
                console.error = orig;
                console.log = origLog;
                const joined = lines.join('\n');
                assert.ok(/0\/33/.test(joined), '멈춘 위치가 숫자로 남아야 한다: ' + joined);
                resolve();
            });
        });
    });
});
