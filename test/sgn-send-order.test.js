'use strict';
/**
 * 알림은 발송 앞에 지연 없이, 사건 순서대로 나간다. (남은 일 §5.6 — 랜덤 지연 제거, 2026-09-06)
 *
 * 발송 앞에 setTimeout(1~10ms 랜덤) 이 두 자리 있었다. 처음 넣은 이유는 "워커 여럿이
 * 같은 순간에 같은 메시지를 보내면 충돌하지 않을까" 였는데, 발송은 워커마다 자기
 * 소켓으로 나가므로 충돌이 없고 지터가 프로세스 사이를 조정하지도 못한다. 지연이
 * 실제로 한 일은 같은 워커의 10ms 안 두 사건의 알림 순서를 뒤집는 것이었다.
 *
 * sgn.js 는 require 만으로 sgn_man 을 통해 MQTT 클라이언트를 연다. 그래서 require.cache
 * 에 sgn_man 스텁을 먼저 심고 로드한다 — post 호출을 그대로 기록한다.
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
    // sgn.check 의 콜백은 발송 뒤에 온다 — 타이머에 맡겼다면 여기서 아직 0건이었을 것이다.
    assert.deepStrictEqual(posts.map((p) => p.nu), ['mqtt://b/t1', 'http://h/a', 'http://h/b']);
    assert.ok(posts.every((p) => p.con === 'one'));
    assert.ok(Date.now() - t0 < 50, '발송까지 ' + (Date.now() - t0) + 'ms — 지연이 되살아났다');
});

test('같은 워커의 연속 사건은 사건 순서대로 나간다 — 랜덤 지연이면 뒤집힐 수 있었다', async () => {
    posts.length = 0;
    // 콜백을 기다리지 않고 잇달아 낸다 — 옛 코드는 사건마다 1~10ms 난수 지연이라 순서가 섞였다.
    await quiet(() => Promise.all(['e1', 'e2', 'e3', 'e4', 'e5'].map((c) => fire(c))));
    const seq = posts.map((p) => p.con);
    // 각 사건은 3건(s1 1 + s2 2). 사건 경계가 섞이지 않아야 한다.
    assert.deepStrictEqual(seq, ['e1', 'e1', 'e1', 'e2', 'e2', 'e2', 'e3', 'e3', 'e3', 'e4', 'e4', 'e4', 'e5', 'e5', 'e5']);
});

test('sgn.js 의 발송 경로에 setTimeout · Math.random 이 없다', () => {
    const src = fs.readFileSync(M('sgn.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.strictEqual(src.indexOf('Math.random'), -1, '랜덤 지연이 되살아났다');
    assert.strictEqual(src.indexOf('setTimeout('), -1, '발송 앞 타이머가 되살아났다');
    assert.match(src, /\n\s*sgn_man\.post\(nu, xm2mri, bodyString, ss_ri\);/, 'post 를 곧바로 부르지 않는다');
});
