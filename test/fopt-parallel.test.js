/**
 * 남은 일 §5.2 — 팬아웃이 직렬이라 최악 대기가 멤버 수만큼 곱해지던 것.
 *
 * `mobius/fanout.js` 가 멤버 요청을 **상한 있는 병렬**로 보낸다. 시험은 실물 HTTP 멤버
 * 서버를 띄워서 본다 — 가짜 요청 함수로 세면 "동시에 몇 개가 나갔나" 를 서버가 아니라
 * 시험이 정하게 되어 시험이 거짓말을 한다(CLAUDE.md: 테스트 대역은 실물보다 관대하면 안 된다).
 *
 * 무엇이 이 시험을 깨뜨리나:
 *   - 상한을 1 로(직렬로 되돌림)            → 최대 동시 요청이 1, 소요시간이 N배
 *   - 상한을 없앰                            → 최대 동시 요청이 N
 *   - 완료 순서대로 agr 에 넣음              → 키 순서가 mid 순서와 어긋남
 *   - 실패 멤버를 제외하지 않음/전체를 실패시킴 → 다른 멤버까지 사라지거나 콜백이 안 옴
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fanout = require('../mobius/fanout');

// 멤버 서버 하나가 여러 멤버 경로를 받는다. 경로별 응답 지연·본문을 정할 수 있고
// 동시에 열린 요청의 최대값을 센다.
function memberServer(rule) {
    const s = { inflight: 0, maxInflight: 0, hits: [], pending: [] };
    s.server = http.createServer((req, res) => {
        s.inflight++;
        s.maxInflight = Math.max(s.maxInflight, s.inflight);
        s.hits.push(req.url);
        req.resume();
        req.on('end', () => {
            const r = rule(req.url) || {};
            if (r.silent) { s.pending.push(res); return; }      // 영원히 답하지 않는다
            setTimeout(() => {
                s.inflight--;
                res.setHeader('X-M2M-RSC', '2000');
                res.setHeader('X-M2M-RI', 'rqi-' + req.url);
                res.setHeader('Content-Type', 'application/json');
                res.end(r.body !== undefined ? r.body : JSON.stringify({ 'm2m:cin': { con: req.url } }));
            }, r.delay || 0);
        });
    });
    s.start = () => new Promise((resolve) => s.server.listen(0, '127.0.0.1', () => { s.port = s.server.address().port; resolve(s); }));
    s.close = () => new Promise((resolve) => { s.pending.forEach((res) => { try { res.destroy(); } catch (e) { /* */ } }); s.server.close(() => resolve()); });
    return s;
}
function fakeRequest() {
    return { url: '/Mobius/g1/fopt', method: 'GET', body: '',
             headers: { 'X-M2M-RI': 'fo1', 'X-M2M-Origin': 'Stest', Accept: 'application/xml' } };
}
function targets(s, names) {
    return names.map((n) => ({ ri: '/Remote/' + n, hostname: '127.0.0.1', port: s.port }));
}
function run(request, list) {
    return new Promise((resolve) => fanout.run(request, list, (agr) => resolve(agr)));
}

test('멤버 12개가 각 300ms 걸릴 때 동시에 8개까지만 나가고 전부 집계된다', async () => {
    const s = await memberServer(() => ({ delay: 300 })).start();
    try {
        const names = Array.from({ length: 12 }, (_, i) => 'm' + i);
        const t0 = Date.now();
        const agr = await run(fakeRequest(), targets(s, names));
        const ms = Date.now() - t0;
        assert.strictEqual(fanout.MAX_INFLIGHT, 8, '설계값 — 멤버는 대개 이 CSE 자신이라 동시 N 개가 곧 워커·DB 커넥션 N 개다');
        assert.strictEqual(s.maxInflight, 8, '서버가 관측한 최대 동시 요청');
        assert.strictEqual(Object.keys(agr).length, 12);
        // 직렬이면 12 x 300 = 3,600ms. 상한 8 병렬이면 두 바퀴 = 약 600ms.
        assert.ok(ms < 2000, '소요 ' + ms + 'ms — 직렬로 되돌아갔다');
    } finally { await s.close(); }
});

test('첫 멤버가 가장 늦게 답해도 agr 의 키 순서는 mid 순서다 — 응답 본문이 직렬일 때와 같다', async () => {
    const delay = { '/Remote/a': 400, '/Remote/b': 300, '/Remote/c': 200, '/Remote/d': 100 };
    const s = await memberServer((u) => ({ delay: delay[u] })).start();
    try {
        const agr = await run(fakeRequest(), targets(s, ['a', 'b', 'c', 'd']));
        assert.deepStrictEqual(Object.keys(agr), ['Remote/a', 'Remote/b', 'Remote/c', 'Remote/d']);
        // 결과 객체의 모양은 옛 check_body 그대로 — fr · rsc · rqi · pc
        assert.deepStrictEqual(agr['Remote/c'], { fr: 'Remote/c', rsc: '2000', rqi: 'rqi-/Remote/c', pc: { 'm2m:cin': { con: '/Remote/c' } } });
    } finally { await s.close(); }
});

test('답하지 않는 멤버는 한도 뒤 그 멤버만 빠지고, 다른 멤버를 기다리게 하지 않는다', async () => {
    const s = await memberServer((u) => (u === '/Remote/mute' ? { silent: true } : { delay: 50 })).start();
    const saved = global.outbound_timeout_ms;
    const errors = [];
    const origError = console.error;
    console.error = (m) => { errors.push(String(m)); };
    global.outbound_timeout_ms = 300;
    try {
        const t0 = Date.now();
        const agr = await run(fakeRequest(), targets(s, ['x', 'mute', 'y']));
        const ms = Date.now() - t0;
        assert.deepStrictEqual(Object.keys(agr), ['Remote/x', 'Remote/y']);
        assert.ok(ms >= 250 && ms < 1500, '소요 ' + ms + 'ms — 한도(300ms) 한 번만큼이어야 한다');
        assert.ok(errors.some((e) => /\[outbound\] fopt member/.test(e)), '타임아웃 로그가 어느 경로인지 말해야 한다');
    } finally {
        console.error = origError;
        global.outbound_timeout_ms = saved;
        await s.close();
    }
});

test('JSON 이 아닌 응답을 준 멤버는 빠지고 나머지는 집계된다', async () => {
    const s = await memberServer((u) => (u === '/Remote/html' ? { body: '<html>502</html>' } : {})).start();
    const errors = [];
    const origError = console.error;
    console.error = (m) => { errors.push(String(m)); };
    try {
        const agr = await run(fakeRequest(), targets(s, ['p', 'html', 'q']));
        assert.deepStrictEqual(Object.keys(agr), ['Remote/p', 'Remote/q']);
        assert.ok(errors.some((e) => /check_body.*JSON 이 아니다.*\/Remote\/html/.test(e)), errors.join('\n'));
    } finally { console.error = origError; await s.close(); }
});

test('route — 자기 CSE 는 localhost, 아는 원격은 csr poa, 모르는 원격은 hostname null', () => {
    const out = fanout.route(['/Mobius/ae1/c1', '/Other/x', '/Known/y'],
                             { Known: 'http://10.9.8.7:7580' }, { cb: 'Mobius', port: 7579 });
    assert.deepStrictEqual(out, [
        { ri: '/Mobius/ae1/c1', hostname: 'localhost', port: 7579 },
        { ri: '/Other/x', hostname: null, port: null },
        { ri: '/Known/y', hostname: '10.9.8.7', port: '7580' }
    ]);
});

test('경로를 모르는 원격 멤버는 요청 자체를 보내지 않고 건너뛴다', async () => {
    const s = await memberServer(() => ({})).start();
    const logs = [];
    const origLog = console.log;
    console.log = (m) => { logs.push(String(m)); };
    try {
        const list = targets(s, ['k1', 'k2']);
        list.splice(1, 0, { ri: '/Unknown/z', hostname: null, port: null });
        const agr = await run(fakeRequest(), list);
        assert.deepStrictEqual(Object.keys(agr), ['Remote/k1', 'Remote/k2']);
        assert.deepStrictEqual(s.hits, ['/Remote/k1', '/Remote/k2'], '건너뛴 멤버로 요청이 나가면 안 된다');
        assert.ok(logs.some((l) => /\[fanout\].*\/Unknown\/z/.test(l)), '건너뛴 멤버는 로그에 남긴다');
    } finally { console.log = origLog; await s.close(); }
});

test('멤버가 하나도 없으면 빈 집계를 준다 — fopt.check 가 404-5 로 낸다', async () => {
    const agr = await run(fakeRequest(), []);
    assert.deepStrictEqual(agr, {});
});

test('/fopt 뒤의 경로와 메서드·본문이 멤버 요청에 그대로 실린다', async () => {
    const seen = [];
    const s = memberServer(() => ({}));
    s.server.removeAllListeners('request');
    s.server.on('request', (req, res) => {
        let b = ''; req.on('data', (c) => { b += c; });
        req.on('end', () => { seen.push({ method: req.method, url: req.url, accept: req.headers.accept, body: b });
            res.setHeader('X-M2M-RSC', '2001'); res.end('{}'); });
    });
    await s.start();
    try {
        const request = { url: '/Mobius/g1/fopt/sub/la', method: 'POST', body: '{"m2m:cin":{"con":"1"}}',
                          headers: { 'X-M2M-RI': 'r', 'X-M2M-Origin': 'S', Accept: 'application/xml', 'Content-Type': 'application/json;ty=4' } };
        const agr = await run(request, targets(s, ['m']));
        assert.deepStrictEqual(seen, [{ method: 'POST', url: '/Remote/m/sub/la', accept: 'application/json', body: '{"m2m:cin":{"con":"1"}}' }]);
        assert.strictEqual(agr['Remote/m/sub/la'].rsc, '2001');
    } finally { await s.close(); }
});

// ── fopt.js 쪽 — 소스로 본다. resource.js 를 끌어오면 require 만으로 MQTT 클라이언트가 열린다.
function live(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

test('fopt.js 는 멤버마다 조회하지 않는다 — 원값과 접은 값을 합쳐 한 번에 풀고 옛 우선순위로 고른다', () => {
    const src = live('mobius/fopt.js');
    assert.strictEqual(src.indexOf('get_ri_sri('), -1, '멤버별 get_ri_sri 조회가 되살아났다');
    assert.strictEqual(src.indexOf('fopt_member'), -1, '직렬 재귀가 되살아났다');
    assert.strictEqual((src.match(/get_ri_list_sri\(/g) || []).length, 1, '풀기는 한 번');
    const fold = src.indexOf('make_internal_ri(');
    const resolve = src.indexOf('get_ri_list_sri(');
    assert.ok(fold > 0 && resolve > 0 && fold < resolve, '접기가 풀기보다 앞이어야 한 질의에 접은 값이 들어간다');
    // lookup 은 ri 가 구조 경로, sri 가 짧은 id 다. 원값이 sri 인지 접은 값이 sri 인지 미리
    // 모르므로 둘 다 묻는다 — 한쪽만 물으면 옛 코드와 결과가 갈리는 입력이 있다
    // (예: 'Mobius' 로 시작하는 AE-ID 를 mid 에 그대로 적은 경우).
    assert.match(src, /get_ri_list_sri\(request, response, raw\.concat\(folded\)/);
    assert.match(src, /\(resolved\[i\] !== r\) \? resolved\[i\] : resolved\[raw\.length \+ i\]/, '옛 우선순위 — 원값 적중이 먼저');
    assert.match(src, /fanout\.route\(ri_list, cse_poa/);
    assert.match(src, /fanout\.run\(request, targets/);
    // grp.mid 는 복사본을 접는다 — make_internal_ri 는 제자리에서 고친다
    assert.match(src, /var raw = grp\.mid\.slice\(\)/);
});

test('fanout.js 는 DB 와 전역을 모른다', () => {
    const src = live('mobius/fanout.js');
    ['sql_action', 'db_connection', 'usecsebase', 'require(\'./resource\')'].forEach((w) => {
        assert.strictEqual(src.indexOf(w), -1, w + ' — 이 모듈이 그것을 알면 시험이 실물 HTTP 로 돌 수 없다');
    });
    assert.match(src, /inflight < MAX_INFLIGHT/, '상한이 실행기에 쓰이지 않는다');
});
