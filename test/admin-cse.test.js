'use strict';
// 콘솔의 CSE 클라이언트. 종합 테스트(2/2 계획)가 요청마다 소요 시간을 재고
// 케이스마다 X-M2M-Origin 을 바꿔야 해서, 요청별 헤더 덮어쓰기와 elapsedMs 를 더했다.
// 실제 http 서버를 띄워 검사한다 — 헤더가 정말 그렇게 나가는지는 소켓으로만 안다.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');

const { Client } = require(path.join(__dirname, '..', 'admin', 'cse.js'));

function serve(handler) {
    return new Promise((resolve) => {
        const srv = http.createServer(handler);
        srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
    });
}
function body_of(req) {
    return new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => resolve(s)); });
}

test('결과에 elapsedMs 가 실린다 — 성공·실패·타임아웃 모두', async function () {
    const { srv, port } = await serve(async (req, res) => {
        if (req.url === '/slow') { return; }             // 답하지 않는다 → 타임아웃
        res.setHeader('X-M2M-RSC', req.url === '/nf' ? '4004' : '2000');
        res.statusCode = req.url === '/nf' ? 404 : 200;
        res.end('{"m2m:cb":{}}');
    });
    const c = new Client({ host: '127.0.0.1', port, origin: 'Sponde', timeoutMs: 150 });
    const ok = await new Promise((r) => c.request('GET', '/Mobius', null, r));
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(typeof ok.elapsedMs, 'number');
    assert.ok(ok.elapsedMs >= 0 && ok.elapsedMs < 5000);
    const nf = await new Promise((r) => c.request('GET', '/nf', null, r));
    assert.strictEqual(nf.rsc, '4004');
    assert.strictEqual(typeof nf.elapsedMs, 'number');
    const to = await new Promise((r) => c.request('GET', '/slow', null, r));
    assert.match(to.error, /timeout/);
    assert.ok(to.elapsedMs >= 100, '타임아웃도 잰다: ' + to.elapsedMs);
    srv.close();
});

test('opts.headers 가 기본 헤더를 덮어쓴다 — Origin 을 케이스마다 바꿀 수 있다', async function () {
    let seen = null;
    const { srv, port } = await serve((req, res) => { seen = req.headers; res.setHeader('X-M2M-RSC', '2000'); res.end('{}'); });
    const c = new Client({ host: '127.0.0.1', port, origin: 'Sponde' });
    await new Promise((r) => c.request('GET', '/Mobius', null, r, { headers: { 'X-M2M-Origin': 'Cdev', 'X-M2M-RVI': '3' } }));
    assert.strictEqual(seen['x-m2m-origin'], 'Cdev');
    assert.strictEqual(seen['x-m2m-rvi'], '3');
    assert.ok(seen['x-m2m-ri'], '기본 헤더는 남는다');
    // 넷째 인자만 주는 옛 호출도 그대로다.
    await new Promise((r) => c.request('GET', '/Mobius', null, r));
    assert.strictEqual(seen['x-m2m-origin'], 'Sponde');
    srv.close();
});

test('create 는 POST 에 ty 를 Content-Type 으로 싣고 루트 이름으로 감싼다', async function () {
    let got = null;
    const { srv, port } = await serve(async (req, res) => {
        got = { method: req.method, url: req.url, ct: req.headers['content-type'], body: JSON.parse(await body_of(req)) };
        res.setHeader('X-M2M-RSC', '2001'); res.statusCode = 201; res.end('{"m2m:acp":{"ri":"/M/ae/acp1"}}');
    });
    const c = new Client({ host: '127.0.0.1', port, origin: 'Sponde' });
    const r = await new Promise((r) => c.create('/M/ae', 1, 'm2m:acp', { rn: 'acp1', pv: { acr: [] } }, r));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.rsc, '2001');
    assert.deepStrictEqual(got, { method: 'POST', url: '/M/ae', ct: 'application/json;ty=1',
                                  body: { 'm2m:acp': { rn: 'acp1', pv: { acr: [] } } } });
    srv.close();
});
