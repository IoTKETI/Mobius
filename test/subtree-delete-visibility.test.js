'use strict';
// subtree 삭제가 중간에 멈추면 흔적을 남겨야 한다.
//
// 비동기 subtree 삭제는 응답을 먼저 보내고 자손을 백그라운드로 지운다.
// 도중에 실패하면 자손이 고아로 남는데, 예전에는 실패가 완전히 조용했다.
//
//   delete_lookup_action  err -> callback('500-1')   로그 없음
//   delete_lookup         실패 배치에서 중단          로그 없음
//   delete_descendants_background  code 를 안 봄      로그 없음
//
// 그래서 "고아가 왜 생기나" 를 물어도 답할 근거가 없었다. 데드락인지,
// 60초 쿼리 타임아웃인지, 커넥션이 끊긴 것인지 구분할 방법이 없다.

const test = require('node:test');
const assert = require('node:assert');

global.NOPRINT = 'true';
global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.uservi = '2a';
global.usedb = 'mysql';

const facade = require('../mobius/db');
const db_sql = require('../mobius/sql_action');

// facade.run 을 가로채 원하는 결과를 돌려준다.
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
    console.log = function () { /* 성공 줄은 관심 없다 */ };
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
            // 드라이버 오류를 흉내낸다 (데드락)
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
    // 32개씩 끊어 지운다. 33개를 주고 첫 배치에서 실패시키면
    // 배치 시작 인덱스(0)와 전체(33)가 남아야 한다 — pi_index 를 쓰면
    // 이미 32 로 전진해 있어 진행도를 과장한다.
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
