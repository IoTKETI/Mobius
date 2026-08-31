'use strict';
// 떠 있는 Mobius 에 고정 시나리오를 돌려 "관측 가능한 동작"의 스냅샷을 만든다.
// 리팩터링 전/후로 각각 돌리고 compare.js 로 비교한다.
//
//   node mobius.js sqlite &            # 서버를 먼저 띄운다
//   node tools/equivalence/run-scenarios.js tools/equivalence/out/before.json
//
// 실행마다 달라지는 값(생성된 ri, 타임스탬프)은 자리표시자로 치환해
// 두 스냅샷이 바이트 단위로 비교 가능하게 만든다.

const BASE = process.env.MOBIUS_BASE || 'http://127.0.0.1:7579';
const CSE = process.env.MOBIUS_CSE || 'Mobius';
const OUT = process.argv[2];

if (!OUT) {
    console.error('usage: node run-scenarios.js <output.json>');
    process.exit(1);
}

// 시나리오 전체에서 같은 이름을 쓴다. 시작할 때 지우고 시작하므로 재실행 가능하다.
const AE = 'eqv_ae';
const ORIGIN = 'C' + AE;

function headers(extra) {
    return Object.assign({
        'X-M2M-RI': 'eqv',
        'X-M2M-Origin': ORIGIN,
        'X-M2M-RVI': '2a',
        'Accept': 'application/json'
    }, extra || {});
}

async function call(method, path, opts) {
    opts = opts || {};
    const init = { method: method, headers: headers(opts.headers) };
    if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); }

    let res, text;
    try {
        res = await fetch(BASE + path, init);
        text = await res.text();
    } catch (e) {
        return { status: 0, rsc: null, body: { error: String(e.message) } };
    }

    let body;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }

    return {
        status: res.status,
        rsc: res.headers.get('x-m2m-rsc'),
        body: normalize(body)
    };
}

// 실행마다 달라지는 값을 자리표시자로 바꾼다.
//   생성된 ri:   "3-20260826034634188"  -> "<RI>"
//   타임스탬프:  "20260826T034634"      -> "<TS>"
//   AE 접두 ri:  "Ceqv_ae"              -> 그대로 (고정 이름이라 안정적)
const RI_RE = /^\d{1,2}-\d{15,}$/;
const TS_RE = /^\d{8}T\d{6}$/;

function normalize(v) {
    if (Array.isArray(v)) { return v.map(normalize); }
    if (v && typeof v === 'object') {
        const out = {};
        // 키 순서가 백엔드마다 다를 수 있으므로 정렬한다.
        Object.keys(v).sort().forEach(function (k) { out[k] = normalize(v[k]); });
        return out;
    }
    if (typeof v === 'string') {
        if (RI_RE.test(v)) { return '<RI>'; }
        if (TS_RE.test(v)) { return '<TS>'; }
        // uril 등 경로 안에 박힌 ri 도 치환한다
        return v.replace(/\b\d{1,2}-\d{15,}\b/g, '<RI>').replace(/\b\d{8}T\d{6}\b/g, '<TS>');
    }
    return v;
}

const CT_AE = 'application/vnd.onem2m-res+json;ty=2';
const CT_CNT = 'application/vnd.onem2m-res+json;ty=3';
const CT_CIN = 'application/vnd.onem2m-res+json;ty=4';
const CT_SUB = 'application/vnd.onem2m-res+json;ty=23';
const CT_ACP = 'application/vnd.onem2m-res+json;ty=1';
const CT_GRP = 'application/vnd.onem2m-res+json;ty=9';

// 서버가 실제로 응답하는지 먼저 확인한다. 이걸 안 하면 서버가 죽어 있을 때
// 모든 단계가 똑같은 fetch 실패 객체를 기록하고, 두 스냅샷이 "일치"해버린다.
async function waitReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(BASE + '/' + CSE, { method: 'GET', headers: headers() });
            if (res.status >= 200 && res.status < 500) { return true; }
            lastErr = 'HTTP ' + res.status;
        } catch (e) {
            lastErr = e.message;
        }
        await new Promise(function (r) { setTimeout(r, 1000); });
    }
    console.error('서버가 응답하지 않는다 (' + Math.round(timeoutMs / 1000) + 's 대기): ' + lastErr);
    console.error('  BASE=' + BASE + '  서버를 먼저 띄우세요: node mobius.js sqlite');
    process.exit(1);
}

async function main() {
    await waitReady(60000);

    const snap = [];
    const step = async function (name, fn) { snap.push({ step: name, result: await fn() }); };

    // 0) 이전 실행 잔재 제거 (결과는 스냅샷에 넣지 않는다)
    await call('DELETE', '/' + CSE + '/' + AE);
    await call('DELETE', '/' + CSE + '/eqv_acp');

    await step('cse-retrieve', () => call('GET', '/' + CSE));

    await step('ae-create', () => call('POST', '/' + CSE, {
        headers: { 'Content-Type': CT_AE },
        body: { 'm2m:ae': { rn: AE, api: '0.2.481.2.0001.001.000111', rr: 'true' } }
    }));

    await step('ae-create-duplicate', () => call('POST', '/' + CSE, {
        headers: { 'Content-Type': CT_AE },
        body: { 'm2m:ae': { rn: AE, api: '0.2.481.2.0001.001.000111', rr: 'true' } }
    }));

    await step('ae-retrieve', () => call('GET', '/' + CSE + '/' + AE));

    await step('cnt-create', () => call('POST', '/' + CSE + '/' + AE, {
        headers: { 'Content-Type': CT_CNT },
        body: { 'm2m:cnt': { rn: 'c1' } }
    }));

    await step('cnt-create-mni', () => call('POST', '/' + CSE + '/' + AE, {
        headers: { 'Content-Type': CT_CNT },
        body: { 'm2m:cnt': { rn: 'c2', mni: 3 } }
    }));

    for (let i = 1; i <= 5; i++) {
        await step('cin-create-' + i, () => call('POST', '/' + CSE + '/' + AE + '/c2', {
            headers: { 'Content-Type': CT_CIN },
            body: { 'm2m:cin': { con: 'v' + i } }
        }));
    }

    // mni=3 이므로 오래된 것이 정리되어야 한다.
    //
    // **정리는 삽입과 동기가 아니다.** 마스터의 보존 정책 스윕(purge_sweep)이
    // global.purge_sweep_ms(기본 10초)마다 돌면서 한도를 넘긴 컨테이너를
    // 정리한다. 그래서 여기서 기다려야 하는 시간은 그 주기보다 길어야 한다 —
    // 3초로 두었더니 스윕의 위상에 따라 정리된 채로도, 안 된 채로도 잡혔다
    // (SQLite 는 통과하고 MySQL 은 cni=5 로 잡혔다. 코드 차이가 아니라 타이밍이다).
    //
    // 예전에는 CIN 을 넣던 워커가 그 자리에서 정리해서 1초 디바운스면 됐다.
    // 그 구조를 버린 이유는 app.js 의 purge_sweep_tick 주석에 있다.
    await new Promise(function (r) { setTimeout(r, 13000); });
    await step('cnt-after-purge', () => call('GET', '/' + CSE + '/' + AE + '/c2'));
    await step('cin-latest', () => call('GET', '/' + CSE + '/' + AE + '/c2/la'));
    await step('cin-oldest', () => call('GET', '/' + CSE + '/' + AE + '/c2/ol'));

    await step('sub-create', () => call('POST', '/' + CSE + '/' + AE + '/c1', {
        headers: { 'Content-Type': CT_SUB },
        body: { 'm2m:sub': { rn: 's1', nu: ['http://127.0.0.1:59999'], nct: 2 } }
    }));

    // 구독 갱신 — 같은 계열 버그의 회귀 방지.
    await step('sub-update', () => call('PUT', '/' + CSE + '/' + AE + '/c1/s1', {
        headers: { 'Content-Type': 'application/vnd.onem2m-res+json' },
        body: { 'm2m:sub': { nu: ['http://127.0.0.1:59998'] } }
    }));
    await step('sub-after-update', () => call('GET', '/' + CSE + '/' + AE + '/c1/s1'));

    await step('acp-create', () => call('POST', '/' + CSE, {
        headers: { 'Content-Type': CT_ACP },
        body: {
            'm2m:acp': {
                rn: 'eqv_acp',
                pv: { acr: [{ acor: [ORIGIN], acop: 63 }] },
                pvs: { acr: [{ acor: [ORIGIN], acop: 63 }] }
            }
        }
    }));

    // ACP 정책 갱신 — SQLite 모드에서 조용히 유실되던 버그의 회귀 방지.
    await step('acp-update', () => call('PUT', '/' + CSE + '/eqv_acp', {
        headers: { 'Content-Type': 'application/vnd.onem2m-res+json' },
        body: { 'm2m:acp': { pv: { acr: [{ acor: [ORIGIN], acop: 51 }] } } }
    }));
    await step('acp-after-update', () => call('GET', '/' + CSE + '/eqv_acp'));

    // SQLite 미지원 타입 — 501 이어야 한다
    await step('grp-create-unsupported', () => call('POST', '/' + CSE + '/' + AE, {
        headers: { 'Content-Type': CT_GRP },
        body: { 'm2m:grp': { rn: 'g1', mt: 3, mnm: 10, mid: ['/' + CSE + '/' + AE + '/c1'] } }
    }));

    await step('discovery-all', () => call('GET', '/' + CSE + '/' + AE + '?fu=1'));
    await step('discovery-ty4', () => call('GET', '/' + CSE + '/' + AE + '?fu=1&ty=4'));
    await step('discovery-limit', () => call('GET', '/' + CSE + '/' + AE + '?fu=1&lim=2'));
    await step('discovery-rn', () => call('GET', '/' + CSE + '/' + AE + '?fu=1&rn=c1'));

    await step('cnt-update', () => call('PUT', '/' + CSE + '/' + AE + '/c1', {
        headers: { 'Content-Type': 'application/vnd.onem2m-res+json' },
        body: { 'm2m:cnt': { lbl: ['tag1', 'tag2'] } }
    }));
    await step('cnt-after-update', () => call('GET', '/' + CSE + '/' + AE + '/c1'));

    await step('retrieve-missing', () => call('GET', '/' + CSE + '/' + AE + '/nope'));

    await step('cnt-delete', () => call('DELETE', '/' + CSE + '/' + AE + '/c1'));
    await new Promise(function (r) { setTimeout(r, 2000); });
    await step('cnt-after-delete', () => call('GET', '/' + CSE + '/' + AE + '/c1'));

    await step('ae-delete', () => call('DELETE', '/' + CSE + '/' + AE));
    await step('acp-delete', () => call('DELETE', '/' + CSE + '/eqv_acp'));

    // 시나리오 도중 서버가 죽었을 수도 있다. status 0 은 fetch 자체가 실패한 것이므로
    // 그런 단계가 하나라도 있으면 스냅샷은 신뢰할 수 없다 — 쓰지 않는다.
    const dead = snap.filter(function (s) { return s.result && s.result.status === 0; });
    if (dead.length > 0) {
        console.error('연결 실패 단계 ' + dead.length + '개 — 스냅샷을 쓰지 않는다:');
        dead.forEach(function (s) { console.error('  ' + s.step); });
        process.exit(1);
    }

    require('fs').writeFileSync(OUT, JSON.stringify(snap, null, 2), 'utf8');
    console.log('스냅샷 ' + snap.length + '단계 -> ' + OUT);
}

main().catch(function (e) { console.error(e); process.exit(1); });
