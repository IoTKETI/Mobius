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

// --- acco 커버리지 (acip.ipv4 / acip.ipv6 / actw) -------------------------
//
// 이 하네스는 오랫동안 acor 만 설정했다. 그래서 acco 계열 결함이 두 번 그대로
// 통과했다 — _pv/_pvs 사이의 remoteaddress 헤더 비대칭, 그리고 각 함수 안의
// ipv4/ipv6 분기 비대칭(리뷰 Critical 2). 아래 6개가 그 구멍을 막는다.
//
// 각 시나리오는 자기 ACP 와 자기 컨테이너를 만든다. 제약은 pv 에만 걸고 pvs 는
// ORIGIN 에게 전권을 줘서 ACP 자체는 계속 다룰 수 있게 둔다. 판정 대상은
// 그 컨테이너를 GET 했을 때의 허용/거부다.
const ACO_AE = 'eqv_acco_ae';

// 원본(bad4d4c:mobius/security.js)의 IP 출처:
//   ipv4 분기 -> remoteaddress 헤더가 있으면 그 값
//   ipv6 분기 -> request.connection.remoteAddress (헤더를 보지 않는다)
// 그래서 ipv6 시나리오는 헤더를 엉뚱한 값으로 채워 두 출처를 갈라놓는다.
const LOOPBACK_FORMS = ['::1', '::ffff:127.0.0.1', '127.0.0.1'];
const OFF_NET = '203.0.113.9';        // TEST-NET-3, 절대 실제 소스가 아니다

function accoScenarios() {
    // actw 필드 순서는 [초, 분, 시, 일, 월, 요일] 이고 원본은 6개 중 하나만
    // 맞아도 허용한다. 월은 실행 중에 바뀌지 않으므로 결정적으로 매치시킬 수 있다.
    const utcMonth = String(new Date().getUTCMonth() + 1);

    return [
        {
            name: 'acip-ipv4-match',
            acco: [{ acip: { ipv4: ['198.51.100.7'] } }],
            headers: { remoteaddress: '198.51.100.7' }
        },
        {
            name: 'acip-ipv4-nomatch',
            acco: [{ acip: { ipv4: ['198.51.100.7'] } }],
            headers: { remoteaddress: OFF_NET }
        },
        {
            // 헤더는 일부러 목록에 없는 값으로 둔다. ipv6 분기가 헤더를 보면
            // (= 유도된 clientIp 를 쓰면) 거부, 소켓 주소를 보면 허용이다.
            name: 'acip-ipv6-match',
            acco: [{ acip: { ipv6: LOOPBACK_FORMS } }],
            headers: { remoteaddress: OFF_NET }
        },
        {
            // 반대 방향. 클라이언트가 스스로 붙인 헤더로 ipv6 제약을 통과하면
            // 그게 권한 상승이다.
            name: 'acip-ipv6-nomatch',
            acco: [{ acip: { ipv6: ['2001:db8::5'] } }],
            headers: { remoteaddress: '2001:db8::5' }
        },
        {
            name: 'actw-match',
            acco: [{ actw: ['* * * * ' + utcMonth + ' *'] }],
            headers: {}
        },
        {
            // 어떤 필드도 실제 시간 성분이 될 수 없는 값(초/분 최대 59, 월 최대 12,
            // 일 최대 31, 요일 최대 6).
            name: 'actw-nomatch',
            acco: [{ actw: ['99 99 99 99 99 99'] }],
            headers: {}
        }
    ];
}

const ACCO_SCENARIOS = accoScenarios();

// acco 단계는 본문을 스냅샷에 넣지 않는다. 관심사는 "허용인가 거부인가" 하나뿐이고,
// 허용된 경우의 본문에는 실행마다 달라지는 필드가 섞여 비교를 흔든다.
async function accoStep(s) {
    const acpName = 'eqv_acp_' + s.name;
    const cntName = 'c_' + s.name.replace(/-/g, '_');

    await call('POST', '/' + CSE, {
        headers: { 'Content-Type': CT_ACP },
        body: {
            'm2m:acp': {
                rn: acpName,
                pv: { acr: [{ acor: [ORIGIN], acop: 63, acco: s.acco }] },
                pvs: { acr: [{ acor: [ORIGIN], acop: 63 }] }
            }
        }
    });

    const created = await call('POST', '/' + CSE + '/' + ACO_AE, {
        headers: { 'Content-Type': CT_CNT },
        body: { 'm2m:cnt': { rn: cntName, acpi: ['/' + CSE + '/' + acpName] } }
    });

    const got = await call('GET', '/' + CSE + '/' + ACO_AE + '/' + cntName, {
        headers: s.headers
    });

    return { setup: created.status, status: got.status, rsc: got.rsc };
}

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
    await call('DELETE', '/' + CSE + '/' + ACO_AE);
    for (const s of ACCO_SCENARIOS) {
        await call('DELETE', '/' + CSE + '/eqv_acp_' + s.name);
    }

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

    // mni=3 이므로 오래된 것이 정리되어야 한다. 디바운스(1초) + 정리 대기.
    await new Promise(function (r) { setTimeout(r, 3000); });
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

    // --- acco 단계는 여기부터. 기존 단계 뒤에 붙여 앞부분이 예전 기준선과
    // 그대로 정렬되게 한다 (tools/equivalence/README.md 참고).
    await step('acco-ae-create', () => call('POST', '/' + CSE, {
        headers: { 'Content-Type': CT_AE },
        body: { 'm2m:ae': { rn: ACO_AE, api: '0.2.481.2.0001.001.000111', rr: 'true' } }
    }));

    for (const s of ACCO_SCENARIOS) {
        await step('acco-' + s.name, () => accoStep(s));
    }

    // 정리 (결과는 스냅샷에 넣지 않는다)
    await call('DELETE', '/' + CSE + '/' + ACO_AE);
    for (const s of ACCO_SCENARIOS) {
        await call('DELETE', '/' + CSE + '/eqv_acp_' + s.name);
    }

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
