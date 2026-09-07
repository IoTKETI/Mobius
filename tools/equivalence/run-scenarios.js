'use strict';
// Runs a fixed scenario against a running Mobius and snapshots the observable behaviour. Run before and after a refactoring and compare with compare.js.
//
//   node mobius.js sqlite &            # start the server first
//   node tools/equivalence/run-scenarios.js tools/equivalence/out/before.json
//
// Values that change per run (generated ri, timestamps) are replaced by placeholders so the two snapshots compare byte for byte.

const BASE = process.env.MOBIUS_BASE || 'http://127.0.0.1:7579';
const CSE = process.env.MOBIUS_CSE || 'Mobius';
const OUT = process.argv[2];

if (!OUT) {
    console.error('usage: node run-scenarios.js <output.json>');
    process.exit(1);
}

// The same names throughout the scenario; they are deleted at the start, so the run is repeatable.
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

// Replaces values that change per run with placeholders.
//   generated ri:   "3-20260826034634188"  -> "<RI>"
//   timestamp:      "20260826T034634"      -> "<TS>"
//   AE-prefixed ri: "Ceqv_ae"              -> unchanged (a fixed name, so stable)
const RI_RE = /^\d{1,2}-\d{15,}$/;
const TS_RE = /^\d{8}T\d{6}$/;

function normalize(v) {
    if (Array.isArray(v)) { return v.map(normalize); }
    if (v && typeof v === 'object') {
        const out = {};
        // Key order may differ per backend, so keys are sorted.
        Object.keys(v).sort().forEach(function (k) { out[k] = normalize(v[k]); });
        return out;
    }
    if (typeof v === 'string') {
        if (RI_RE.test(v)) { return '<RI>'; }
        if (TS_RE.test(v)) { return '<TS>'; }
        // ri embedded in paths (uril etc.) are replaced too
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

// Checks first that the server answers. Otherwise every step would record the same fetch failure and two snapshots would 'match' with the server down.
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

    // 0) Remove remains of a previous run (not recorded in the snapshot)
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

    // With mni=3 the oldest ones must be purged.
    //
    // Purging is not synchronous with insertion: the primary's retention sweep (purge_sweep) runs every global.purge_sweep_ms (default 10 s) and purges containers over their limits, so the wait here must be longer than that period.
    await new Promise(function (r) { setTimeout(r, 13000); });
    await step('cnt-after-purge', () => call('GET', '/' + CSE + '/' + AE + '/c2'));
    await step('cin-latest', () => call('GET', '/' + CSE + '/' + AE + '/c2/la'));
    await step('cin-oldest', () => call('GET', '/' + CSE + '/' + AE + '/c2/ol'));

    await step('sub-create', () => call('POST', '/' + CSE + '/' + AE + '/c1', {
        headers: { 'Content-Type': CT_SUB },
        body: { 'm2m:sub': { rn: 's1', nu: ['http://127.0.0.1:59999'], nct: 2 } }
    }));

    // Subscription update, guarding against the same class of regression.
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

    // ACP policy update, guarding against a silent loss in SQLite mode.
    await step('acp-update', () => call('PUT', '/' + CSE + '/eqv_acp', {
        headers: { 'Content-Type': 'application/vnd.onem2m-res+json' },
        body: { 'm2m:acp': { pv: { acr: [{ acor: [ORIGIN], acop: 51 }] } } }
    }));
    await step('acp-after-update', () => call('GET', '/' + CSE + '/eqv_acp'));

    // A type SQLite does not support: must be 501
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

    // The server may have died during the scenario. status 0 means the fetch itself failed; with any such step the snapshot is not trustworthy and is not written.
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
