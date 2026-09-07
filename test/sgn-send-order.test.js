'use strict';
/**
 * Notifications go out in event order with no delay before sending.
 *
 * A random 1..10ms setTimeout before sending did not prevent any collision (each worker sends on its own socket) and only reversed the order of two events within 10ms in the same worker.
 *
 * sgn.js opens an MQTT client through sgn_man on require, so an sgn_man stub is planted in require.cache first; it records post calls as-is.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const M = (n) => path.join(ROOT, 'mobius', n);

global.NOPRINT = 'true';
global.usecsebase = 'Mobius'; global.usecseid = '/Mobius'; global.usespid = '//sp.test'; global.uservi = '2a';
global.usecsebaseport = 7579; global.usedb = 'mysql';

const posts = [];
const smPath = require.resolve(M('sgn_man.js'));
require.cache[smPath] = { id: smPath, filename: smPath, loaded: true,
    exports: { post: (nu, xm2mri, body, ri) => posts.push({ nu, ri, con: (JSON.parse(body).pc || JSON.parse(body))['m2m:sgn'].nev.rep['m2m:cin'].con }) } };

const db = require(M('db'));
db.getConnection = (cb) => cb('200', { fake: true });
db.release = () => {};
const db_sql = require(M('sql_action'));
const SUBS = [
    { ri: '/M/p/s1', nu: '["mqtt://b/t1"]', enc: '{"net":[3]}', nct: 2, nec: null, cr: 'C' },
    { ri: '/M/p/s2', nu: '["http://h/a","http://h/b"]', enc: '{"net":[3]}', nct: 2, nec: null, cr: 'C' }
];
db_sql.select_subs_by_pi = (c, pi, cb) => setImmediate(() => cb(null, SUBS));

const sgn = require(M('sgn.js'));

function fire(con) {
    return new Promise((resolve) => {
        const request = { headers: { rootnm: 'cin' }, method: 'post', targetObject: { cnt: { ri: '/M/p', ty: '3' } } };
        sgn.check(request, { ri: '/M/p/' + con, sri: '4-' + con, pi: '/M/p', spi: '3-p', ty: '4', con: con, st: 1 }, 3, () => resolve());
    });
}
function quiet(fn) {
    const l = console.log, e = console.error; console.log = () => {}; console.error = () => {};
    return Promise.resolve().then(fn).finally(() => { console.log = l; console.error = e; });
}

test('한 사건의 알림은 구독 순서 · nu 순서대로, 지연 없이 나간다', async () => {
    posts.length = 0;
    const t0 = Date.now();
    await quiet(() => fire('one'));
    // sgn.check's callback arrives after sending; with a timer it would still be 0 here.
    assert.deepStrictEqual(posts.map((p) => p.nu), ['mqtt://b/t1', 'http://h/a', 'http://h/b']);
    assert.ok(posts.every((p) => p.con === 'one'));
    assert.ok(Date.now() - t0 < 50, '발송까지 ' + (Date.now() - t0) + 'ms — 지연이 되살아났다');
});

test('같은 워커의 연속 사건은 사건 순서대로 나간다 — 랜덤 지연이면 뒤집힐 수 있었다', async () => {
    posts.length = 0;
    // Fired back to back without waiting for callbacks.
    await quiet(() => Promise.all(['e1', 'e2', 'e3', 'e4', 'e5'].map((c) => fire(c))));
    const seq = posts.map((p) => p.con);
    // Each event produces 3 posts (s1 1 + s2 2). Event boundaries must not interleave.
    assert.deepStrictEqual(seq, ['e1', 'e1', 'e1', 'e2', 'e2', 'e2', 'e3', 'e3', 'e3', 'e4', 'e4', 'e4', 'e5', 'e5', 'e5']);
});

test('sgn.js 의 발송 경로에 setTimeout · Math.random 이 없다', () => {
    const src = fs.readFileSync(M('sgn.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.strictEqual(src.indexOf('Math.random'), -1, '랜덤 지연이 되살아났다');
    assert.strictEqual(src.indexOf('setTimeout('), -1, '발송 앞 타이머가 되살아났다');
    assert.match(src, /\n\s*sgn_man\.post\(nu, xm2mri, bodyString, ss_ri\);/, 'post 를 곧바로 부르지 않는다');
});
